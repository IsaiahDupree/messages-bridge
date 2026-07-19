// messages-jxa.mjs — runs MessagesBridge tools against real iMessage + Contacts.
//
// Three execution paths, dispatched by runTool():
//   • message reads  → sqlite3 over ~/Library/Messages/chat.db (needs Full Disk
//     Access; read-only, opened immutably so we never touch the live DB).
//   • send_message   → AppleScript via `osascript` (Messages automation). Every
//     send is confirmed by the user inside ChatGPT before this ever runs.
//   • contacts       → JXA via `osascript -l JavaScript` (Contacts automation).
//
// Args always travel as one JSON string in argv (execFile, no shell) — never
// interpolated into source. SQL string literals are escaped (' → '').

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { join } from 'node:path';

const exec = promisify(execFile);

const JOB_TIMEOUT_MS = 40_000; // relay's MCP side gives up at 50s; leave headroom
const CHAT_DB = join(homedir(), 'Library', 'Messages', 'chat.db');
const APPLE_EPOCH = 978307200; // seconds between 1970-01-01 and 2001-01-01

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

// SQL string-literal escape.
const sq = (v) => String(v == null ? '' : v).replace(/'/g, "''");
const int = (v, dflt, max) => Math.min(Math.max(parseInt(v, 10) || dflt, 1), max);

// A chat.db-local ISO-ish datetime for a message.date column (handles both the
// modern nanosecond epoch and the legacy seconds epoch).
const DATE_EXPR = (col) =>
  `datetime((CASE WHEN ${col}>100000000000 THEN ${col}/1000000000 ELSE ${col} END)+${APPLE_EPOCH},'unixepoch','localtime')`;

async function sqlite(query) {
  // -readonly + immutable so a live/locked Messages DB still reads; -json output.
  const uri = `file:${CHAT_DB}?immutable=1`;
  let stdout;
  try {
    ({ stdout } = await exec('sqlite3', ['-readonly', '-json', uri, query], {
      timeout: JOB_TIMEOUT_MS,
      killSignal: 'SIGKILL',
      maxBuffer: 32 * 1024 * 1024,
    }));
  } catch (err) {
    if (err.killed || err.signal) throw new Error('timed out reading Messages on the Mac');
    throw new Error(cleanOsascriptError(err.stderr || err.message));
  }
  const t = String(stdout || '').trim();
  return t ? JSON.parse(t) : [];
}

async function osa(args, source, argvJson) {
  let stdout;
  try {
    ({ stdout } = await exec('osascript', [...args, source, argvJson], {
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
  return { id: safeId(p), name: name, phones: vals(function(){return p.phones;}), emails: vals(function(){return p.emails;}) };
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
    if (!q || nm.indexOf(q) !== -1) out.push(personOut(people[i]));
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
    case 'search_messages': {
      const q = sq(args.query);
      const limit = int(args.limit, 20, 100);
      const rows = await sqlite(
        `SELECT m.ROWID as id, m.text as text, m.is_from_me as fromMe,
           ${DATE_EXPR('m.date')} as date, h.id as handle,
           c.display_name as thread_name, c.chat_identifier as thread_id
         FROM message m
         LEFT JOIN handle h ON h.ROWID=m.handle_id
         LEFT JOIN chat_message_join cmj ON cmj.message_id=m.ROWID
         LEFT JOIN chat c ON c.ROWID=cmj.chat_id
         WHERE m.text IS NOT NULL AND m.text LIKE '%${q}%'
         ORDER BY m.date DESC LIMIT ${limit};`
      );
      return { results: rows.map(rowOut) };
    }
    case 'list_recent_threads': {
      const limit = int(args.limit, 20, 100);
      const rows = await sqlite(
        `SELECT c.chat_identifier as id, c.display_name as name,
           MAX(m.date) as last,
           (SELECT m2.text FROM message m2 JOIN chat_message_join j2 ON j2.message_id=m2.ROWID
              WHERE j2.chat_id=c.ROWID AND m2.text IS NOT NULL ORDER BY m2.date DESC LIMIT 1) as last_text,
           (SELECT h.id FROM chat_handle_join chj JOIN handle h ON h.ROWID=chj.handle_id
              WHERE chj.chat_id=c.ROWID LIMIT 1) as handle
         FROM chat c
         JOIN chat_message_join cmj ON cmj.chat_id=c.ROWID
         JOIN message m ON m.ROWID=cmj.message_id
         GROUP BY c.ROWID ORDER BY last DESC LIMIT ${limit};`
      );
      return {
        threads: rows.map((r) => ({
          id: r.id || r.handle || '',
          name: r.name || r.handle || r.id || '(unknown)',
          handle: r.handle || null,
          last_text: r.last_text || '',
        })),
      };
    }
    case 'get_thread': {
      const t = sq(args.thread || args.id || args.handle);
      const limit = int(args.limit, 30, 200);
      const rows = await sqlite(
        `SELECT m.text as text, m.is_from_me as fromMe, ${DATE_EXPR('m.date')} as date, h.id as handle
         FROM message m
         JOIN chat_message_join cmj ON cmj.message_id=m.ROWID
         JOIN chat c ON c.ROWID=cmj.chat_id
         LEFT JOIN handle h ON h.ROWID=m.handle_id
         WHERE (c.chat_identifier='${t}' OR c.guid='${t}' OR EXISTS(
                  SELECT 1 FROM chat_handle_join chj JOIN handle hh ON hh.ROWID=chj.handle_id
                  WHERE chj.chat_id=c.ROWID AND hh.id='${t}'))
           AND m.text IS NOT NULL
         ORDER BY m.date DESC LIMIT ${limit};`
      );
      if (!rows.length) throw new Error('No conversation found for: ' + (args.thread || args.id || args.handle || ''));
      return {
        thread: args.thread || args.id || args.handle,
        messages: rows.reverse().map((r) => ({
          from: r.fromMe ? 'me' : (r.handle || 'them'),
          text: r.text,
          date: r.date,
        })),
      };
    }
    case 'send_message': {
      const to = String(args.to || '').trim();
      const text = String(args.text || '');
      if (!to) throw new Error('send_message needs a "to" (phone number or email).');
      if (!text) throw new Error('send_message needs a "text".');
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

function rowOut(r) {
  return {
    id: String(r.id),
    text: r.text,
    from: r.fromMe ? 'me' : (r.handle || 'them'),
    date: r.date,
    thread: r.thread_name || r.thread_id || r.handle || null,
    thread_id: r.thread_id || r.handle || null,
  };
}
