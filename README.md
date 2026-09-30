<div align="center">

# 💬 MessagesBridge

**Use your iMessage & Contacts inside ChatGPT — through your own Mac.**

[![License: MIT](https://img.shields.io/badge/License-MIT-f5b942.svg)](./LICENSE)
[![npm](https://img.shields.io/npm/v/apple-messages-agent.svg?color=4ade80&label=apple-messages-agent)](https://www.npmjs.com/package/apple-messages-agent)

</div>

MessagesBridge is a [Model Context Protocol](https://modelcontextprotocol.io) (MCP) connector that lets ChatGPT work with your **iMessage conversations and Contacts**. Reads execute on **your own Mac** through a small local agent. Requested results pass through the hosted relay and are returned to ChatGPT. The relay temporarily stores request/result payloads in its queue; it does not maintain a permanent copy of your message history.

```
  ChatGPT  ──OAuth──►  MessagesBridge relay  ──job queue──►  apple-messages-agent  ──►  Messages.app + Contacts
 (connector)          (Vercel, stateless)      (your Mac, polls & executes)        (on your Mac)
```

Your Mac is the only place your messages are ever read or contacts written. The relay stores only short-lived job payloads and your account record; it never sees a message unless a job is in flight, and queue payloads have short expiry windows.

---

## For users — 3 steps

**1. Create your account** at **[messagesbridge.vercel.app](https://messagesbridge.vercel.app)** and generate a pairing code.

**2. Install the Mac agent** (needs [Node 18+](https://nodejs.org)):

```bash
npx apple-messages-agent pair <YOUR-CODE>   # link this Mac to your account
npx apple-messages-agent install            # keep it running on every restart
```

The agent needs two macOS permissions, granted once: **Full Disk Access** so it can *read* your message history (System Settings → Privacy & Security → Full Disk Access), and **Automation** the first time it *sends* a message or reads Contacts — macOS asks **"Terminal wants to control Messages"** and to access **Contacts**; click **OK**.

**3. Connect ChatGPT:** Settings → **Plugins** → turn on **Developer mode** (Security & login) → **Create** a custom plugin → paste the MCP Server URL **`https://messagesbridge.vercel.app/mcp`** → Authentication **OAuth** → sign in & **Allow**.

That's it. In a new chat: *"Search my messages for the dinner plans"* or *"Text Sarah that I'm running 10 minutes late."* (You confirm every send before it goes out.)

> Your Mac must be awake with the agent running. `npx apple-messages-agent install` makes it start automatically at login and restart if it ever crashes.

### Managing the agent

```bash
npx apple-messages-agent status      # is it paired & reachable?
npx apple-messages-agent logs        # recent activity
npx apple-messages-agent uninstall   # stop auto-start
```

---

## What ChatGPT can do

| Tool | Action |
|------|--------|
| `search_messages` | Search plain and Apple attributed text; follow `next_cursor` even on empty result pages |
| `list_recent_threads` | List recent conversations, newest first, with a last-message preview |
| `get_thread` | Read pages of one conversation using an exact chat id; pass `next_cursor` as `cursor` until null |
| `messages_status` | Check local access, counts and coverage without returning message content |
| `send_message` | Send an iMessage to one recipient (you confirm first — no bulk) |
| `search_contacts` | Find people by name (returns their phones + emails) |
| `get_contact` | Read one contact by name or id |
| `create_contact` | Add a contact (name, optional phone/email) |

Reads come first; the only write tools are `send_message` and `create_contact`, and each is confirmed by you in ChatGPT before it runs. Sends always go to **one recipient at a time — never in bulk**.

---

## Self-hosting

You can run your own relay so nothing depends on the hosted instance.

**Prereqs:** a [Vercel](https://vercel.com) account and a [Supabase](https://supabase.com) project (free tiers are fine).

1. **Storage** — in your Supabase project's SQL editor, run [`supabase/schema.sql`](./supabase/schema.sql). It creates isolated `actp_messagesbridge_*` tables and `mb_*` storage functions with RLS and service-role-only grants.
2. **Deploy** the `server/` directory to Vercel.
3. **Set env vars** (see [`server/.env.example`](./server/.env.example)):
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — your project + service-role key
   - `JWT_SECRET` — `openssl rand -hex 32`
4. **Verify:** `curl https://YOUR-APP.vercel.app/api/health` → `redisConfigured`, `redisOk`, `jwtSecretSet` all `true`.
5. Point the agent at it: `npx apple-messages-agent pair <CODE> --server https://YOUR-APP.vercel.app`.

---

## How it works

- **Auth** — OAuth 2.1 with PKCE and Dynamic Client Registration (RFC 7591). ChatGPT registers itself, the user signs in on the MessagesBridge consent page, and ChatGPT gets a scoped MCP access token. JWTs are HMAC-signed; three kinds (`session`, `agent`, `mcp`) with distinct privileges. Optional email verification via Resend (`RESEND_API_KEY`); off unless configured, and enforcement is opt-in (`REQUIRE_EMAIL_VERIFICATION`).
- **Relay** — MCP tool call → job pushed to `jobs:<user>` (TTL ≤ the caller's wait window, so an abandoned job can't run late) → the Mac agent (holding a hanging long-poll) is handed the job within ~200ms, executes it, pushes the result → the MCP handler returns it. The long-poll means jobs are delivered on arrival rather than on a fixed interval, so relay overhead is ~300ms instead of ~1s. The agent is considered "online" only while it's actively connected.
- **Agent** — a dependency-free Node CLI. Read tools query the Messages `chat.db` directly (read-only SQLite); send and contact tools run via JXA (`osascript -l JavaScript`) against Messages.app and Contacts; arguments are passed as JSON over argv (never shell-interpolated). A macOS LaunchAgent keeps it alive across logins and crashes.

## Repository layout

```
server/    Vercel functions: OAuth + MCP endpoint + relay        (deploy this)
agent/     apple-messages-agent — the npm-published Mac CLI          (users npx this)
kit/       Browser automations: register the dev-mode connector AND
           fill the OpenAI directory submission (see kit/README.md)
supabase/  schema.sql for self-hosting the storage
test/      end-to-end OAuth + MCP integration test
```

## Development

```bash
# server
cd server && cp .env.example .env.local   # fill in, then: vercel dev
# end-to-end test against a live deployment (reads ../.env.local)
node test/e2e-oauth.mjs
# agent unit tests
node --test agent/test-agent-unit.mjs
```

## Security & privacy

- Messages are read and sent, and contacts read and added, **only on your Mac**. The relay temporarily persists requested content in its job/result queues with short TTLs; results are consumed on delivery.
- The agent token is stored at `~/.messagesbridge-agent.json` (mode `600`).
- No secrets are committed; see [`.gitignore`](./.gitignore) and the `.env.example` files.
- Write tools are marked destructive so ChatGPT asks before it sends a message or adds a contact — every send goes to one confirmed recipient at a time, never in bulk.

## License

[MIT](./LICENSE) © Isaiah Dupree

## Verified read coverage and live tests

Agent 1.1 reads the live SQLite WAL, decodes Apple attributed strings using macOS Foundation, and provides bounded cursor pagination. Cursors follow database insertion order. Attachment-only records remain visible through `has_attachments`; attachment files are not uploaded or decoded. The Mac database is the coverage boundary: this does not establish that every iPhone/iCloud message has synced.

```sh
apple-messages-agent doctor
node test/live-messages.mjs
# After pairing your own account and starting the agent:
MB_EMAIL=your-email MB_PASSWORD=your-password node test/live-relay.mjs
```

Provide credentials through your secure environment, not a shared transcript or committed file. The live tests only read and print aggregate results. `live-messages` checks every local conversation page, all messages in the largest thread, decoded search, and cursor validation. `live-relay` validates actual OAuth, MCP and paired-Mac reads; it fails if the Mac is offline. Reviewer/demo output is never accepted as evidence of a live integration.

Production requires the storage migration and valid Supabase configuration. `/api/health` returns HTTP 503 when storage is unavailable. If the old relay database is unavailable, accounts, pairing and OAuth sessions from it cannot be recovered automatically; sign in/create an owner account and reconnect the plugin.
