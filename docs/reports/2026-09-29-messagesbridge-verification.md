# MessagesBridge verification — 2026-09-29

## Delivered

- Agent 1.1.0 installed globally from this repository, paired to the owner account, and installed as the com.messagesbridge.apple-messages-agent LaunchAgent. The owner dashboard reports Mac connected.
- Relay 1.4.0 deployed to https://messagesbridge.vercel.app.
- Production storage moved from the unreachable `gqjgxltroyysjoxswbmn` project to the required shared `ivhfuhxorppptyuofbgq` project. No old account data was recovered or silently substituted.
- Applied isolated `actp_messagesbridge_*` tables and service-role-only `mb_*` RPCs. Verified anon/authenticated cannot execute those RPCs.
- Reads include the live SQLite WAL, Apple attributed-text decoding, stable database-ID pagination, attachment indicators, and explicit local-sync coverage.
- Fixed osascript source invocation, Contacts ID lookup and phone/email collection. Removed message arguments from agent logs.
- Added a local `doctor` command and MCP `messages_status`. Health now returns 503 when storage is broken instead of reporting success.
- Updated dependency lockfile: npm audit reports zero vulnerabilities.

## Verified

- Existing agent tests: 9 passed.
- Existing server tests: 23 passed using their documented isolated local environment. An initial rerun inherited live Supabase variables and failed a fixed-ID epoch assertion; rerunning with those variables removed passed. Session-created fixed-ID records were cleaned up.
- Real read-only Mac integration: 3,158 messages available locally, 204 conversations enumerated without duplicate pages, all 503 messages in the largest conversation read across pages, all 503 attributed strings decoded without errors, decoded-text keyword search passed, invalid cursor/input rejection passed.
- Real Supabase integration: KV roundtrip, FIFO queue, expiry, counter operations passed; unique test keys cleaned up.
- Public production health: storage configured, storage responding, JWT configured, HTTP 200.
- Owner completed signup and ChatGPT OAuth reconnect through Safari. Restored the missing public OAuth client registration using the exact client ID and ChatGPT callback observed in that reconnect, then completed normal owner consent.
- A real installed ChatGPT connector list_recent_threads call authenticated and reached the background agent. It returned the explicit macOS Full Disk Access error; that initial call preceded the permission grant.
- After owner permission changes, the first call passed database access but timed out decoding attributed text. Restarting the LaunchAgent cleared the error. Real installed ChatGPT connector verification then passed: list_recent_threads returned 2 conversations; get_thread returned 5 messages with zero decoding errors; search_messages returned 5 matches from 88 scanned messages with zero decoding errors. This exercised ChatGPT authentication -> production relay -> paired launchd agent -> local Messages database and native decoding. No message bodies are recorded in this report.

## Outstanding

- The only saved repository login is a reviewer/demo account. It was not paired to real messages.
- The standalone password-based `test/live-relay.mjs` was not run successfully; the installed ChatGPT connector was used for the real authenticated end-to-end verification instead.
- Contacts read timed out on this Mac; its permissions/runtime remain unverified. Sending and contact creation were not exercised, and no messages were sent.
- This only covers data stored on the Mac; complete iPhone/iCloud history and attachment contents are not established.

## Exhaustive local read verification — 2026-09-30 UTC

- Added `node test/live-all-messages.mjs`, a real read-only integration test. It retains message text only in process memory and prints aggregate counts.
- Stable database baseline: 3,158 message rows, 204 conversations. Read all 3,156 conversation-linked messages across 263 thread pages and all conversation previews across 12 list pages. No duplicate or missing linked messages; no decoding errors.
- Decoded 3,148 attributed-text messages. Verified 354 attachment indicators and sender direction against raw database metadata; four returned messages had empty text. Attachment content was not tested.
- Derived a keyword from real decoded text, then compared all expected matches against paginated search: 604 matches over 47 pages, no missing matches or false positives. The keyword and content were not persisted.
- Coverage limitation: two additional attributed-body records have no chat_message_join entry. Existing thread/search APIs exclude these unlinked records; their text decoding was not tested. Thus this is exhaustive for conversation-linked history, not all raw database rows.
- Initial baseline read encountered SQLite busy/locked. Added a bounded 5-second SQLite busy timeout to production reads and the test baseline. The exhaustive run then passed.
- Restarted the installed LaunchAgent to load the fix; a real authenticated ChatGPT connector request returned 100 conversations with zero preview decoding errors. Exhaustive per-message checks ran locally through the agent adapter, not through thousands of cloud connector calls.
- Regression checks passed: 9 agent tests and 23 server tests. Existing server tests include demo-mode behavior; actual message coverage above uses the real Mac database. No messages sent, Contacts modified, or message contents saved to reports.
