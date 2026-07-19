# MessagesBridge — paste-ready submission answers

Fill the OpenAI plugin submission form (platform.openai.com/plugins → **Create
plugin** → **With MCP**) with the values below. Fields verified against the live
portal on 2026-07-17. Requires developer identity verification first (see
SUBMISSION.md).

---

## Connection

| Field | Value |
|---|---|
| MCP Server URL | `https://messagesbridge.vercel.app/mcp` |
| Authentication | OAuth |
| OAuth — the portal auto-discovers these from the URL's `/.well-known` metadata | authorization: `https://messagesbridge.vercel.app/oauth/authorize` · token: `https://messagesbridge.vercel.app/api/oauth/token` · registration (DCR): `https://messagesbridge.vercel.app/api/oauth/register` · PKCE S256 · scope `messages` |

After entering the URL, click **Scan Tools** — it should discover all 7 tools.

## Listing (App Info section — exact fields on the live form)

| Field | Value |
|---|---|
| **Name** | MessagesBridge |
| **Subtitle** ⚠️ ≤30 chars | `Your iMessage & Contacts` |
| **Category** | Communication |
| **Developer Identity** | Business — Dupree Ops LLC *(the verified identity; requires ID verification first)* |
| **Plugin Author** | Isaiah Dupree |
| **Website URL** | `https://messagesbridge.vercel.app` |
| **Customer support URL** | `https://messagesbridge.vercel.app/support` |
| **Privacy policy URL** | `https://messagesbridge.vercel.app/privacy` |
| **Terms of Service URL** | `https://messagesbridge.vercel.app/terms` |
| **Demo Recording URL** ⚠️ required | *(a hosted screen-recording of the plugin working — you must record this)* |
| **Directory icon / composer icon** | `assets/icon-512.png` (512×512 PNG) |
| **Commerce & Purchasing** | leave unchecked (no purchases) |

**Description:**
> MessagesBridge connects ChatGPT to the iMessage conversations and contacts on your Mac. Browse your recent threads, search and read any conversation, look up a contact, add a new contact, or send an iMessage to one person — all from a chat. Your messages never live on our servers: every action is executed on your own Mac by a small open-source agent you install with one command (`npx apple-messages-agent`), and the relay only carries each request for the seconds it's in flight. Reads come first, and every send is confirmed by you in ChatGPT before it happens — one recipient at a time, never bulk. Open source (MIT) and self-hostable.

*These values are also encoded in [`kit/submission.config.json`](./kit/submission.config.json), which `kit/submit-plugin.mjs` fills automatically.*

## Demo / reviewer account (no MFA)

> This connector normally relays to the user's own Mac. For review, sign in with
> the account below — it runs every tool against built-in server-side **fictional
> sample conversations**, so all 7 tools work 24/7 with no desktop app or pairing
> required.

- Email: `reviewer@messagesbridge.demo`
- Password: *(the `DEMO_PASSWORD` value in `.env.local` — paste it here at submission)*

## Test prompts & expected responses

Sign in as the reviewer account, add the connector via OAuth, then (all against
the account's fictional sample data):

1. **"Show my recent conversations"** → `list_recent_threads` →
   `{ "threads": [ { "id": "sarah-ashley", "name": "Sarah Ashley", "last": "Are we still on for dinner Friday?" }, { "id": "mom", "name": "Mom", "last": "Call me when you land ❤️" }, { "id": "weekend-trip", "name": "Weekend Trip", "last": "I booked the cabin!" } ] }`
2. **"Search my messages for dinner"** → `search_messages` (query `dinner`) →
   `{ "results": [ { "thread": "sarah-ashley", "from": "Sarah Ashley", "text": "Are we still on for dinner Friday?" } ] }`
3. **"Find Sarah in my contacts"** → `search_contacts` (query `Sarah`) →
   `{ "contacts": [ { "id": "c-sarah", "name": "Sarah Ashley", "phones": ["+15550142"], "emails": ["sarah@example.com"] } ] }`
4. **"Open my conversation with Sarah"** → `get_thread` (id `sarah-ashley`) →
   `{ "thread": "sarah-ashley", "messages": [ { "from": "Sarah Ashley", "text": "Are we still on for dinner Friday?" }, { "from": "me", "text": "Yes! 7pm works." } ] }`
5. **"Text Sarah at +15550142 that I'm running 10 minutes late"** → `send_message` →
   `{ "sent": { "to": "+15550142", "text": "Running 10 minutes late!" } }` (ChatGPT confirms before sending; one recipient only, never bulk)

## Negative test cases (exactly 3 — prompts where MessagesBridge should NOT trigger)

1. **General communication advice** — *"What's a good way to stay in touch with old
   friends?"* — abstract question, no action on the user's own iMessage or contacts.
2. **A different app** — *"Send this on WhatsApp."* — MessagesBridge only works with
   iMessage/SMS through the Messages app, not WhatsApp/Telegram/Signal.
3. **A bulk / broadcast request** — *"Text this announcement to all my contacts."* —
   MessagesBridge sends to one confirmed recipient at a time and never does bulk sends.

## Release notes (first release)

> Initial release. MessagesBridge connects ChatGPT to your iMessage conversations and
> contacts through a small open-source agent that runs on your own Mac — browse recent
> threads, search and read any conversation, look up contacts, add a contact, or send
> an iMessage to one person. Reads come first; every send is confirmed by you before it
> happens, one recipient at a time, never bulk. Your messages never live on our servers;
> the cloud piece is only a stateless relay. Open source (MIT) and self-hostable.

## Tools declared (7)

`search_messages`, `list_recent_threads`, `get_thread`, `send_message`,
`search_contacts`, `get_contact`, `create_contact` (the write tools —
`send_message` and `create_contact` — are annotated destructive → ChatGPT
confirms before sending a message or adding a contact).
