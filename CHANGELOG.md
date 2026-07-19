# Changelog

All notable changes to MessagesBridge. Versions cover the server (relay) and the
`apple-messages-agent` npm package together.

## [Unreleased]

### Changed
- **Forked from RemindersBridge into MessagesBridge** — the **iMessage + Contacts**
  connector. Same architecture (local Mac agent + passthrough relay, OAuth 2.1
  with PKCE + DCR); the agent now drives Messages and Contacts and serves seven
  tools: `search_messages`, `list_recent_threads`, `get_thread`, `send_message`,
  `search_contacts`, `get_contact`, and `create_contact`. Reads pull from the
  Messages database (`~/Library/Messages/chat.db`, `sqlite3` read-only); sends go
  through AppleScript; Contacts are read/created via JXA.

## [1.3.0] — 2026-07-17

### Added
- **Agent token revocation.** Agent tokens now carry a per-device id (`jti`) and
  a per-user revocation epoch. A new **Paired Macs** dashboard card lists linked
  Macs (name, paired date, last seen) and lets you remove one device or unpair
  all. Endpoints: `GET /api/agent/devices`, `POST /api/agent/revoke`.
- The Mac agent sends its hostname as the device label when pairing.

### Security
- Agent endpoints (`poll`/`result`/`ping`) now reject revoked tokens on the next
  request; legacy tokens (pre-1.3) are grandfathered until re-paired.

## [1.2.0] — 2026-07-17

### Added
- **Push-based relay (long-poll).** The agent holds a connection open and the
  server returns the instant a job is enqueued — relay overhead dropped from
  ~950 ms to ~300 ms. Backward-compatible with older agents.
- **Message + contact read tools.** `search_messages`, `list_recent_threads`,
  `get_thread`, `search_contacts`, and `get_contact` return structured data
  (conversations/threads, messages, and contact name/phones/emails) to ChatGPT.
- **Email verification** via Resend (soft by default; opt-in enforcement via
  `REQUIRE_EMAIL_VERIFICATION`). `/verify`, `/api/resend-verification`, `/api/me`.
- Reviewer **demo mode** — the `reviewer@…` account exercises all tools against
  server-side fictional conversations with no Mac agent.
- **Rate limiting** on all auth/OAuth endpoints. Privacy & support pages.
- macOS **LaunchAgent** auto-start (`install`/`uninstall`/`logs`) so the agent
  survives login/restart and crashes.

### Security
- Adversarial auth + relay review; fixes: rate-limit IP no longer trusts the
  spoofable leftmost `X-Forwarded-For`; `JWT_SECRET` fails closed in production;
  login normalization + timing equalization; jobId-ownership check on results;
  atomic rate-limit TTL; password-length cap; `PUBLIC_BASE_URL`
  host pinning. See [SECURITY.md](./SECURITY.md).

### Added (project)
- Server + agent unit tests, GitHub Actions CI, SECURITY.md.

## [1.1.0] — 2026-07-15

### Changed
- Storage moved from Upstash Redis to a Redis-shaped surface on Supabase
  Postgres (`nb_*` RPCs). `JWT_SECRET` support.

## [1.0.0] — 2026-07-15

### Added
- Initial release: OAuth 2.1 + PKCE + DCR, streamable-HTTP MCP endpoint, job
  relay, and the `apple-messages-agent` Mac CLI (iMessage + Contacts automation).

Releases: https://github.com/IsaiahDupree/messages-bridge/releases
