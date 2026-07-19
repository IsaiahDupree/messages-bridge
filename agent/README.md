# apple-messages-agent

The Mac-side half of **MessagesBridge** — it lets ChatGPT and Claude read and write your
**iMessage conversations and Contacts**. This tiny agent runs on your Mac, connects to the
MessagesBridge relay, and does the actual talking to Messages and Contacts (via macOS
automation). Your message content never leaves your machine except for the specific request
you make.

- No account, no password, no cloud copy of your messages.
- One command to pair, one command to keep it running forever.
- No dependencies — just Node 18+.

---

## Quick start

You need [Node.js 18 or newer](https://nodejs.org). Then:

```sh
# 1. On the MessagesBridge site, click "Connect my Mac" to get a pairing code.
# 2. Pair this Mac (replace ABCD-1234 with your code):
npx apple-messages-agent pair ABCD-1234

# 3. Keep it running in the background — starts on login, restarts if it crashes:
npx apple-messages-agent install
```

That's it. You can close the terminal — the agent keeps running.

### One-time macOS permissions (required)

MessagesBridge needs **two** macOS permissions the first time it runs. Both are
one-time grants:

1. **Full Disk Access** — so the agent can **read** your iMessage/SMS history. Message
   history lives in a protected SQLite database (`~/Library/Messages/chat.db`), and macOS
   only lets an app read it if it has Full Disk Access. Grant it under
   **System Settings → Privacy & Security → Full Disk Access** and add your terminal
   (and/or `node`). Without this, the read tools return nothing.
2. **Automation** — so the agent can **send** messages and **read/create** Contacts. The
   first time the agent touches Messages or Contacts, macOS shows a one-time prompt asking
   to allow automation of "Messages" and "Contacts". Click **OK**. If you miss it, enable
   it later under **System Settings → Privacy & Security → Automation** (allow your
   terminal / `node` to control **Messages** and **Contacts**).

After granting both, run `apple-messages-agent uninstall` and `install` again so the
background agent picks up the new permissions.

### Want it permanent? Install globally

`npx` runs from a cache that npm can prune, which would break the background agent.
For an always-on setup, install it globally so the path is stable:

```sh
npm install -g apple-messages-agent
apple-messages-agent pair ABCD-1234
apple-messages-agent install
```

---

## Commands

| Command | What it does |
|---|---|
| `apple-messages-agent pair <CODE>` | Claim a pairing code and save the agent token to `~/.messagesbridge-agent.json` (mode 600). |
| `apple-messages-agent install` | Install a macOS LaunchAgent so the agent auto-starts on login and restarts on crash. |
| `apple-messages-agent run` | Run the agent in the foreground (Ctrl-C to stop). `install` does this for you in the background. |
| `apple-messages-agent status` | Check that you're paired, the server is reachable, and whether auto-start is installed. |
| `apple-messages-agent logs` | Show the last ~50 lines of the background agent log. |
| `apple-messages-agent uninstall` | Stop and remove the background agent (LaunchAgent). |
| `apple-messages-agent --version` | Print the version. |
| `apple-messages-agent --help` | Show usage. |

All commands accept `--server <URL>` to point at a different relay
(default: `https://messagesbridge.vercel.app`).

---

## How it works

```
ChatGPT / Claude  ──MCP──▶  MessagesBridge relay  ◀──poll──  apple-messages-agent (your Mac)
                                                             │
                                                             ▼
                                          iMessage  — read chat.db (sqlite3, read-only)
                                                    — send via AppleScript
                                          Contacts  — read/create via JXA (osascript)
```

The agent long-polls the relay for jobs, runs each one on your Mac, and posts the result
back. Reads of your message history query the Messages database
(`~/Library/Messages/chat.db`) directly with `sqlite3` in **read-only** mode. Sending a
message is done through Apple's AppleScript automation of the Messages app. Contacts are
read and created through Apple's JavaScript automation (JXA / `osascript -l JavaScript`).
When there's nothing to do it just idles. It serves seven tools — `search_messages`,
`list_recent_threads`, `get_thread`, `send_message`, `search_contacts`, `get_contact`,
and `create_contact` — which operate on your conversations, messages, and contacts.

- Config/token: `~/.messagesbridge-agent.json` (permissions `600`).
- Background logs: `~/Library/Logs/messagesbridge-agent.log` and `messagesbridge-agent.err.log`.
- LaunchAgent: `~/Library/LaunchAgents/com.messagesbridge.apple-messages-agent.plist`.

---

## Troubleshooting

**"Not paired" / it stopped working after a while.**
Your pairing token may have been revoked. Re-pair and reinstall:

```sh
apple-messages-agent pair <NEW-CODE>
apple-messages-agent install
```

If the background agent hit a `401`, it writes `~/.messagesbridge-agent.unauthorized`
and keeps the reason in the error log — check `apple-messages-agent logs`.

**Messages history comes back empty.**
This is almost always **Full Disk Access**. The agent can't read
`~/Library/Messages/chat.db` without it. Grant it under
**System Settings → Privacy & Security → Full Disk Access** (add your terminal / `node`),
then `apple-messages-agent uninstall` and `install` again.

**Messages aren't being sent, or contacts aren't readable.**
Make sure **Messages** and **Contacts** are allowed under
**System Settings → Privacy & Security → Automation** (allow your terminal / `node`
to control **Messages** and **Contacts**). Then `apple-messages-agent uninstall` and
`install` again.

**Check what's happening.**

```sh
apple-messages-agent status   # paired? reachable? auto-start installed?
apple-messages-agent logs     # recent activity + errors
```

**Uninstall completely.**

```sh
apple-messages-agent uninstall
rm ~/.messagesbridge-agent.json   # also forget the pairing token
```

**Non-macOS.** `install`/`uninstall`/`logs` are macOS-only (they use LaunchAgents).
`pair`, `run`, and `status` work anywhere Node runs, but the iMessage and Contacts
automation itself requires macOS.

---

## Privacy

The agent only contacts the relay server you paired with. It sends the result of the
specific messages or contacts operation you (via ChatGPT/Claude) requested — nothing else.
Your conversations are not uploaded or indexed anywhere; message content stays on your Mac.

## License

MIT © Isaiah Dupree
