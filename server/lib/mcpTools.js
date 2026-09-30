// mcpTools.js — the MCP server exposed to ChatGPT. Every tool forwards to the
// paired Mac agent through the relay; the agent does the actual Messages /
// Contacts work. (Tool names match the agent's messages-jxa executor keys 1:1.)
//
// Safety posture (this is a review-sensitive surface): reads are read-only,
// send_message is openWorld (it reaches a real person) + non-idempotent and is
// always confirmed by the user in ChatGPT before it runs, and there is no bulk
// send. Demo accounts run entirely against fictional sample data.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { enqueueJob } from './relay.js';
import { demoExec } from './demoStore.js';

const asText = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] });
const asError = (err) => ({
  isError: true,
  content: [{ type: 'text', text: `Error: ${err.message || String(err)}` }],
});

// Read-only lookups: safe, non-mutating, local to the user's own Mac.
const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

export function buildServer(userId, { demo = false } = {}) {
  const server = new McpServer({ name: 'apple-messages-relay', version: '1.4.0' });

  // Demo accounts run against server-side fictional threads/contacts (no Mac
  // agent, no real messages); real accounts relay to the user's paired Mac.
  const exec = demo ? (tool, args) => demoExec(userId, tool, args) : (tool, args) => enqueueJob(userId, tool, args);
  const forward = (tool) => async (args) => {
    try {
      return asText(await exec(tool, args ?? {}));
    } catch (e) {
      return asError(e);
    }
  };

  server.registerTool(
    'search_messages',
    {
      title: 'Search messages',
      description: "Search the text of the user's iMessage / SMS history by keyword. Searches plain and attributed text on this Mac. Follow next_cursor until null, including pages with no matches. Returns sender, date and thread; does not prove complete iPhone sync.",
      inputSchema: { query: z.string(), limit: z.number().int().min(1).max(100).optional(), cursor: z.string().regex(/^[1-9][0-9]*$/).optional() },
      annotations: RO,
    },
    forward('search_messages')
  );

  server.registerTool(
    'list_recent_threads',
    {
      title: 'List recent conversations',
      description: "List the user's most recent Messages conversations (people and group chats), newest first, each with a preview of the last message. Pass next_cursor as cursor for older conversations. Each returned id is the exact get_thread thread argument. If the user selects a numbered list item, map that position to its id from that same result; never send the position as the thread identifier.",
      inputSchema: { limit: z.number().int().min(1).max(100).optional(), cursor: z.string().regex(/^[1-9][0-9]*$/).optional() },
      annotations: RO,
    },
    forward('list_recent_threads')
  );

  server.registerTool(
    'get_thread',
    {
      title: 'Read a conversation',
      description: 'Read one page of messages in a conversation, oldest database record first within the page. Pass next_cursor as cursor to read older history until null. Includes attributed text and attachment indicators, not attachment contents. Prefer the exact id from list_recent_threads or thread_guid from search_messages. A displayed list number is not a thread ID. For each new request call this tool again, and verify resolved_thread_id matches the requested conversation; do not reuse an earlier conversation response. Omit cursor to read the latest page again; use next_cursor only to continue older history.',
      inputSchema: { thread: z.string(), limit: z.number().int().min(1).max(200).optional(), cursor: z.string().regex(/^[1-9][0-9]*$/).optional() },
      annotations: RO,
    },
    forward('get_thread')
  );

  server.registerTool(
    'send_message',
    {
      title: 'Send a message',
      description: "Send an iMessage to one recipient (a phone number or email). WARNING: this sends a real message to another person — always confirm the recipient and exact text with the user first. One recipient per call; no bulk sends.",
      inputSchema: { to: z.string(), text: z.string() },
      // openWorldHint: sending reaches an external person outside this system.
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    forward('send_message')
  );

  server.registerTool(
    'search_contacts',
    {
      title: 'Search contacts',
      description: "Search the user's Contacts by name. Returns matching people with their phone numbers and email addresses.",
      inputSchema: { query: z.string(), limit: z.number().int().min(1).max(100).optional() },
      annotations: RO,
    },
    forward('search_contacts')
  );

  server.registerTool(
    'get_contact',
    {
      title: 'Read a contact',
      description: 'Get one contact by name (fuzzy) or id: their phone numbers and email addresses.',
      inputSchema: { name: z.string().optional(), id: z.string().optional() },
      annotations: RO,
    },
    forward('get_contact')
  );

  server.registerTool(
    'create_contact',
    {
      title: 'Create a contact',
      description: "Add a new person to the user's Contacts. Optionally include a phone number and email.",
      inputSchema: {
        first_name: z.string().optional(),
        last_name: z.string().optional(),
        phone: z.string().optional(),
        email: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    forward('create_contact')
  );

  server.registerTool('messages_status', {title:'Messages access status',description:'Check local Messages database access, message counts and sync coverage limitations without returning message content.',inputSchema:{},annotations:RO},forward('messages_status'));

  return server;
}
