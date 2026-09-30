// messages-jxa.mjs — runs MessagesBridge tools against real iMessage + Contacts.
//
// Three execution paths, dispatched by runTool():
//   • message reads  → sqlite3 over ~/Library/Messages/chat.db (needs Full Disk
//     Access; read-only, including the live WAL).
//   • send_message   → AppleScript via `osascript` (Messages automation). Every
//     send is confirmed by the user inside ChatGPT before this ever runs.
//   • contacts       → JXA via `osascript -l JavaScript` (Contacts automation).
//
// Args always travel as one JSON string in argv (execFile, no shell) — never
// interpolated into source. SQL string literals are escaped (' → '').

import { readMessages } from './messages-db.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

const JOB_TIMEOUT_MS = 40_000; // relay's MCP side gives up at 50s; leave headroom

// Reads are pure lookups; args pass through. (Write tools take no rendering.)
export function buildJxaArgs(tool, args = {}) {
  return args;
}

// osascript / sqlite3 stderr looks like "execution error: Error: <msg> (-2700)".
export function cleanOsascriptError(msg) {
  const s = String(msg || '').trim();
  if (/unable to open database|authorization denied|not authorized|operation not permitted/i.test(s)) {
    return 'Cannot read Messages. Grant Full Disk Access to the agent in System Settings ▸ Privacy & Security ▸ Full Disk Access, then try again.';
  }
  const m = s.match(/execution error:\s*(?:Error:\s*)?([\s\S]*?)(?:\s*\(-?\d+\))?$/);
  return (m && m[1].trim()) || s || 'command failed';
}

async function osa(args, source, argvJson) {
  let stdout;
  try {
    ({ stdout } = await exec('osascript', [...args, '-e', source, argvJson], {
      timeout: JOB_TIMEOUT_MS,
      killSignal: 'SIGKILL',
      maxBuffer: 16 * 1024 * 1024,
    }));
  } catch (err) {
    if (err.killed || err.signal) throw new Error('timed out on the Mac');
    throw new Error(cleanOsascriptError(err.stderr || err.message));
  }
  return String(stdout || '').trim();
}

// ---- Contacts (JXA) ----
const CONTACTS_JXA = `
function personOut(p) {
  function vals(list) { var out = []; try { var v = list(); for (var i=0;i<v.length;i++){ try { out.push(String(v[i].value())); } catch(e){} } } catch(e){} return out; }
  var name = '';
  try { name = String(p.name()); } catch (e) {}
  return { id: safeId(p), name: name, phones: vals(function(){return p.phones();}), emails: vals(function(){return p.emails();}) };
}
function safeId(p) { try { return String(p.id()); } catch (e) { return ''; } }
function run(argv) {
  var args = JSON.parse(argv[0]);
  var tool = args.__tool;
  var Contacts = Application('Contacts');
  if (tool === 'create_contact') {
    var props = {};
    if (args.first_name) props.firstName = String(args.first_name);
    if (args.last_name) props.lastName = String(args.last_name);
    var p = Contacts.Person(props);
    Contacts.people.push(p);
    if (args.phone) { var ph = Contacts.Phone({ label: 'mobile', value: String(args.phone) }); p.phones.push(ph); }
    if (args.email) { var em = Contacts.Email({ label: 'home', value: String(args.email) }); p.emails.push(em); }
    Contacts.save();
    return JSON.stringify({ contact: personOut(p) });
  }
  var q = String(args.query || args.name || args.id || '').toLowerCase();
  var limit = Math.min(args.limit || 20, 100);
  var people = [];
  try { people = Contacts.people(); } catch (e) { throw new Error('Cannot read Contacts. Allow the agent to control Contacts in System Settings > Privacy & Security > Contacts.'); }
  var out = [];
  for (var i = 0; i < people.length && out.length < limit; i++) {
    var nm = '';
    try { nm = String(people[i].name()).toLowerCase(); } catch (e) { continue; }
    if (args.id ? safeId(people[i]) === String(args.id) : (!q || nm.indexOf(q) !== -1)) out.push(personOut(people[i]));
  }
  if (tool === 'get_contact') {
    if (!out.length) throw new Error('No contact matching: ' + (args.name || args.id || args.query || ''));
    return JSON.stringify({ contact: out[0] });
  }
  return JSON.stringify({ results: out });
}
`;

// ---- send_message (AppleScript) ----
const SEND_APPLESCRIPT = `
on run argv
  set jsonText to item 1 of argv
  set AppleScript's text item delimiters to "\\u241F"
  set parts to text items of jsonText
  set theRecipient to item 1 of parts
  set theBody to item 2 of parts
  tell application "Messages"
    set targetService to 1st account whose service type = iMessage
    set targetBuddy to participant theRecipient of targetService
    send theBody to targetBuddy
  end tell
  return "sent"
end run
`;

export async function runTool(tool, args = {}) {
  switch (tool) {
    case 'search_messages':
    case 'list_recent_threads':
    case 'get_thread':
    case 'messages_status':
      return readMessages(tool,args);
    case 'send_message': {
      const to = String(args.to || '').trim();
      const text = String(args.text || '');
      if (!to) throw new Error('send_message needs a "to" (phone number or email).');
      if (!text) throw new Error('send_message needs a "text".');
      if (to.includes('␟') || text.includes('␟')) throw new Error('Unsupported delimiter in recipient or message');
      const payload = `${to}␟${text}`;
      const out = await osa([], SEND_APPLESCRIPT, payload);
      if (out !== 'sent') throw new Error('Send did not confirm: ' + out.slice(0, 120));
      return { sent: true, to, text };
    }
    case 'search_contacts':
    case 'get_contact':
    case 'create_contact': {
      const out = await osa(['-l', 'JavaScript'], CONTACTS_JXA, JSON.stringify({ ...args, __tool: tool }));
      try { return JSON.parse(out); } catch { throw new Error(`Bad contacts output: ${out.slice(0, 160)}`); }
    }
    default:
      throw new Error(`Unknown tool: ${tool}`);
  }
}
