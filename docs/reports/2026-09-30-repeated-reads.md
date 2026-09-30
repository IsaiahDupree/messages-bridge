# MessagesBridge repeated-read verification — 2026-09-30

## Reproduced

- Installed ChatGPT connector A -> B -> A -> B reads selected the correct exact conversation IDs; no stale cross-conversation result reproduced.
- Two background attributed-text failures occurred before the native-decoder change. The added error classification confirmed a decoder timeout rather than invalid input or a wrong conversation.
- This task's initially exposed connector schema lacked cursor parameters, although the deployed server supported them. Used ChatGPT Settings -> MessagesBridge -> Refresh tools after deploying improved descriptions. Existing task tool definitions can retain their initial schema; new-chat behavior is checked separately below.

## Changes

- Replaced per-read osascript/JXA attributed-text decoding with a small native Foundation program. Compiled once per source/architecture hash with Apple's clang into a private local directory. It reads JSON from stdin, writes JSON to stdout, and does not persist message contents. No message-result cache was added; every read still queries the live database.
- Agent package 1.2.0 includes decoder source; Apple Command Line Tools are required on first use. Compilation and reads have bounded timeouts; failures remain explicit.
- get_thread returns resolved_thread_id so callers can verify the actual conversation. Tool descriptions explain mapping numbered choices to exact IDs from the same listing and omitting cursors for a fresh latest-page read.
- Added test/live-repeat-reads.mjs with alternating conversations, repeat reads, isolated pagination, and recovery after an invalid ID. No message sends.

## Verified

- 13 local reads passed across two alternating conversations, with stable reaccess, no page overlap, correct thread identifiers, and error recovery.
- Native and previous JXA text results matched exactly for three real conversations (up to 30 messages each).
- Full local coverage passed after the decoder change: 205 conversations; 3,176 linked messages; 3,169 attributed strings decoded; 605 expected keyword matches across 47 search pages. Zero decoding errors or missing/duplicate linked messages. Two unlinked raw database records remain outside the thread APIs.
- Four installed connector reads after restarting the LaunchAgent passed in A -> B -> A -> B order. Correct resolved IDs and per-message thread GUIDs; each returned three messages. Observed request durations: 5.7, 19.6, 4.8, 9.2 seconds. This is a bounded successful sample, not a latency guarantee.
- 9 agent and 23 server regression tests passed. Improved server tool descriptions deployed to production. Native decoder tested locally and in the installed background agent.

## Browser conversation test

- Test chat: https://chatgpt.com/c/6abd78c0-9db0-83e9-97d0-4a0ac2cd7820
- First prompt requested two conversation choices while suppressing private details; ChatGPT returned Yes after real list calls.
- Follow-up choice 2 -> choice 1 -> choice 2 completed: ChatGPT reported “Pass — counts: 2, 2, 2.” Background agent logs showed successful get_thread jobs.
- A subsequent prompt requested next_cursor for choice 2, checked non-overlap, then requested the latest page without cursor. ChatGPT reported “Pass — older page: 2; latest reread: 2; overlaps: 0.” This demonstrates cursor availability and successful follow-up use in the fresh browser test chat after Refresh tools.
- User's exact originally stuck prompt has not been supplied, so that specific conversation is not yet reproduced.
