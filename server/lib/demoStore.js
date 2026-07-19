// demoStore.js — server-side FICTIONAL Messages + Contacts for the reviewer/demo
// account. Lets app reviewers exercise every tool 24/7 with no Mac agent and,
// crucially, without ever touching a real person's messages. All names, numbers,
// and threads below are invented. State persists under demoMessages:<userId>.
// Result shapes mirror the real apple-messages-agent exactly.

import { redis } from './redis.js';

export const DEMO_EMAIL = (process.env.DEMO_EMAIL || 'reviewer@messagesbridge.demo').toLowerCase();

const KEY = (userId) => `demoMessages:${userId}`;
const iso = (d) => new Date(d).toISOString();

function seed() {
  const base = new Date('2026-07-18T18:00:00Z').getTime();
  const t = (minsAgo) => iso(base - minsAgo * 60000);
  return {
    contacts: {
      'demo-c1': { id: 'demo-c1', name: 'Sarah Chen', phones: ['+15550142'], emails: ['sarah.chen@example.com'] },
      'demo-c2': { id: 'demo-c2', name: 'Mom', phones: ['+15550177'], emails: [] },
      'demo-c3': { id: 'demo-c3', name: 'Marcus Reed', phones: ['+15550199'], emails: ['marcus@acme.example'] },
      'demo-c4': { id: 'demo-c4', name: 'Priya Patel', phones: [], emails: ['priya@example.com'] },
    },
    threads: {
      '+15550142': {
        id: '+15550142', name: 'Sarah Chen', handle: '+15550142',
        messages: [
          { from: 'them', text: 'Are we still on for dinner Friday?', date: t(180) },
          { from: 'me', text: 'Yes! 7pm at the usual place?', date: t(175) },
          { from: 'them', text: 'Perfect. I made a reservation for two.', date: t(170) },
        ],
      },
      '+15550177': {
        id: '+15550177', name: 'Mom', handle: '+15550177',
        messages: [
          { from: 'them', text: 'Call me when you get a chance, nothing urgent 💛', date: t(90) },
          { from: 'me', text: 'Will do after this meeting!', date: t(85) },
        ],
      },
      'Q3 Launch': {
        id: 'Q3 Launch', name: 'Q3 Launch', handle: null,
        messages: [
          { from: 'them', text: 'Marcus: pushed the release notes to the shared doc', date: t(240) },
          { from: 'them', text: 'Priya: reviewing now, looks solid', date: t(230) },
          { from: 'me', text: 'Nice work both — shipping Thursday then', date: t(225) },
        ],
      },
    },
  };
}

async function load(userId) {
  const raw = await redis.get(KEY(userId));
  if (!raw) {
    const db = seed();
    await redis.set(KEY(userId), JSON.stringify(db));
    return db;
  }
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}
const save = (userId, db) => redis.set(KEY(userId), JSON.stringify(db));

const lastDate = (thr) => (thr.messages.length ? thr.messages[thr.messages.length - 1].date : '0');

function findThread(db, key) {
  const k = String(key || '').toLowerCase();
  return (
    db.threads[key] ||
    Object.values(db.threads).find((t) => (t.handle || '').toLowerCase() === k) ||
    Object.values(db.threads).find((t) => t.name.toLowerCase() === k) ||
    Object.values(db.threads).find((t) => t.name.toLowerCase().includes(k) && k)
  );
}

export async function demoExec(userId, tool, args = {}) {
  const db = await load(userId);

  switch (tool) {
    case 'search_messages': {
      const q = String(args.query || '').toLowerCase();
      const out = [];
      for (const thr of Object.values(db.threads)) {
        for (const m of thr.messages) {
          if (m.text.toLowerCase().includes(q)) {
            out.push({ id: `${thr.id}:${m.date}`, text: m.text, from: m.from === 'me' ? 'me' : (thr.handle || 'them'), date: m.date, thread: thr.name, thread_id: thr.id });
          }
        }
      }
      out.sort((a, b) => (a.date < b.date ? 1 : -1));
      return { results: out.slice(0, Math.min(args.limit || 20, 100)) };
    }
    case 'list_recent_threads': {
      const threads = Object.values(db.threads)
        .sort((a, b) => (lastDate(a) < lastDate(b) ? 1 : -1))
        .slice(0, Math.min(args.limit || 20, 100))
        .map((t) => ({ id: t.id, name: t.name, handle: t.handle, last_text: t.messages.length ? t.messages[t.messages.length - 1].text : '' }));
      return { threads };
    }
    case 'get_thread': {
      const thr = findThread(db, args.thread || args.id || args.handle);
      if (!thr) throw new Error('No conversation found for: ' + (args.thread || args.id || args.handle || ''));
      const msgs = thr.messages.slice(-Math.min(args.limit || 30, 200)).map((m) => ({ from: m.from === 'me' ? 'me' : (thr.handle || 'them'), text: m.text, date: m.date }));
      return { thread: thr.id, messages: msgs };
    }
    case 'send_message': {
      const to = String(args.to || '').trim();
      const text = String(args.text || '');
      if (!to) throw new Error('send_message needs a "to".');
      if (!text) throw new Error('send_message needs a "text".');
      let thr = findThread(db, to);
      if (!thr) { thr = { id: to, name: to, handle: to, messages: [] }; db.threads[to] = thr; }
      thr.messages.push({ from: 'me', text, date: iso('2026-07-18T18:05:00Z') });
      await save(userId, db);
      return { sent: true, to, text };
    }
    case 'search_contacts': {
      const q = String(args.query || '').toLowerCase();
      const results = Object.values(db.contacts).filter((c) => !q || c.name.toLowerCase().includes(q)).slice(0, Math.min(args.limit || 20, 100));
      return { results };
    }
    case 'get_contact': {
      const q = String(args.name || args.id || '').toLowerCase();
      const c = db.contacts[args.id] || Object.values(db.contacts).find((x) => x.name.toLowerCase() === q) || Object.values(db.contacts).find((x) => x.name.toLowerCase().includes(q) && q);
      if (!c) throw new Error('No contact matching: ' + (args.name || args.id || ''));
      return { contact: c };
    }
    case 'create_contact': {
      const id = `demo-c${Object.keys(db.contacts).length + 1}`;
      const name = [args.first_name, args.last_name].filter(Boolean).join(' ') || 'New Contact';
      const c = { id, name, phones: args.phone ? [String(args.phone)] : [], emails: args.email ? [String(args.email)] : [] };
      db.contacts[id] = c;
      await save(userId, db);
      return { contact: c };
    }
    default:
      throw new Error(`Unknown tool: ${tool}`);
  }
}
