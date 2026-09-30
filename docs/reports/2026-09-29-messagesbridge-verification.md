# MessagesBridge verification — 2026-09-29

## Delivered

- Agent 1.1.0 installed globally from this repository. Pairing and launchd startup remain pending an owner pairing code.
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
- Installed connector call now returns reauthentication required, rather than the original internal error.

## Outstanding

- The only saved repository login is a reviewer/demo account. It was not paired to real messages.
- Owner must sign in/create an owner account, provide its pairing code, and reconnect MessagesBridge. The old project's account/OAuth state is unavailable.
- `test/live-relay.mjs` is ready to verify normal OAuth -> MCP -> paired agent -> real Messages, but cannot pass before owner pairing. Do not count local tests or health as this end-to-end result.
- Contacts read timed out on this Mac; its permissions/runtime remain unverified. Sending and contact creation were not exercised, and no messages were sent.
- This only covers data stored on the Mac; complete iPhone/iCloud history and attachment contents are not established.
