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
- A real installed ChatGPT connector list_recent_threads call authenticated and reached the background agent. It returned the explicit macOS Full Disk Access error; message retrieval through launchd is not yet verified.

## Outstanding

- The only saved repository login is a reviewer/demo account. It was not paired to real messages.
- Full Disk Access is required for the launchd executable `/opt/homebrew/Cellar/node/26.7.0/bin/node`. System Settings is at the administrator authentication prompt; owner confirmation and unlock are pending. Local reads inherited the interactive host permission and do not prove background-agent access.
- After permission is granted, restart the agent and verify real installed-connector list -> thread -> search reads. `test/live-relay.mjs` has not passed. Do not count local tests, pairing, OAuth, or health as a successful end-to-end message read.
- Contacts read timed out on this Mac; its permissions/runtime remain unverified. Sending and contact creation were not exercised, and no messages were sent.
- This only covers data stored on the Mac; complete iPhone/iCloud history and attachment contents are not established.
