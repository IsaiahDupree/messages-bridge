// Unit tests for the pure functions in messages-jxa.mjs — no sqlite3, no
// osascript, no real Messages/Contacts. Run: node --test test-agent-unit.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildJxaArgs, cleanOsascriptError, runTool } from './messages-jxa.mjs';
import { buildPlist, xmlEscape } from './cli.mjs';

// Args pass through unchanged (the adapter builds SQL/AppleScript itself).
test('buildJxaArgs passes read args through untouched', () => {
  const s = { query: 'dinner', limit: 10 };
  assert.deepEqual(buildJxaArgs('search_messages', s), s);
  const g = { thread: '+15550142', limit: 30 };
  assert.deepEqual(buildJxaArgs('get_thread', g), g);
  assert.deepEqual(buildJxaArgs('list_recent_threads', {}), {});
});

test('buildJxaArgs passes write args through untouched', () => {
  const send = { to: '+15550142', text: 'on my way' };
  assert.deepEqual(buildJxaArgs('send_message', send), send);
  const c = { first_name: 'Sarah', last_name: 'Chen', phone: '+15550142' };
  assert.deepEqual(buildJxaArgs('create_contact', c), c);
});

test('args survive the JSON round-trip used for the argv handoff', () => {
  const out = buildJxaArgs('send_message', { to: '+1 (555) 0142', text: `quote " tick ' emoji 💛` });
  assert.deepEqual(JSON.parse(JSON.stringify(out)), out);
});

test('cleanOsascriptError surfaces the Full Disk Access hint for DB permission errors', () => {
  for (const raw of ['unable to open database file', 'Error: authorization denied', 'operation not permitted']) {
    assert.match(cleanOsascriptError(raw), /Full Disk Access/);
  }
});

test('cleanOsascriptError strips osascript noise otherwise', () => {
  assert.equal(cleanOsascriptError('execution error: Error: No conversation found: x (-2700)'), 'No conversation found: x');
  assert.equal(cleanOsascriptError('plain failure'), 'plain failure');
  assert.equal(cleanOsascriptError(''), 'command failed');
});

test('runTool rejects unknown tools without spawning anything', async () => {
  await assert.rejects(() => runTool('nope', {}), /Unknown tool: nope/);
});

test('xmlEscape escapes &, <, > for plist text nodes', () => {
  assert.equal(xmlEscape('a & b < c > d'), 'a &amp; b &lt; c &gt; d');
  assert.equal(xmlEscape('/Users/me/App & Co'), '/Users/me/App &amp; Co');
});

test('buildPlist emits the correct label, ProgramArguments and KeepAlive', () => {
  const xml = buildPlist({
    label: 'com.messagesbridge.apple-messages-agent',
    nodePath: '/usr/local/bin/node',
    cliPath: '/Users/me/agent/cli.mjs',
    workingDir: '/Users/me',
    outLog: '/Users/me/Library/Logs/messagesbridge-agent.log',
    errLog: '/Users/me/Library/Logs/messagesbridge-agent.err.log',
  });
  assert.match(xml, /<key>Label<\/key>\s*<string>com\.messagesbridge\.apple-messages-agent<\/string>/);
  assert.match(xml, /<string>\/usr\/local\/bin\/node<\/string>\s*<string>\/Users\/me\/agent\/cli\.mjs<\/string>\s*<string>run<\/string>/);
  assert.match(xml, /<key>KeepAlive<\/key>\s*<true\/>/);
  assert.match(xml, /<key>StandardOutPath<\/key>\s*<string>\/Users\/me\/Library\/Logs\/messagesbridge-agent\.log<\/string>/);
});

test('buildPlist starts with the standard plist header', () => {
  const xml = buildPlist({ label: 'x', nodePath: 'n', cliPath: 'c', workingDir: 'w', outLog: 'o', errLog: 'e' });
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<!DOCTYPE plist PUBLIC "-\/\/Apple\/\/DTD PLIST 1\.0\/\/EN"/);
});
