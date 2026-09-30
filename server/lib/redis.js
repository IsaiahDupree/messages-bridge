// redis.js — Redis-shaped storage on Supabase Postgres (shared ecosystem project),
// with an in-memory fallback for local dev/tests. Only the small command surface
// the app needs: get/set/del/lpush/rpop/expire. Queue semantics are FIFO
// (lpush + rpop), implemented by the isolated mb_* storage RPC functions and actp_messagesbridge_* tables.
// Other bridge apps cannot collide with these keys.

const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const redisConfigured = !!(SUPA_URL && SUPA_KEY);

async function rpc(fn, args) {
  const r = await fetch(`${SUPA_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: SUPA_KEY,
      authorization: `Bearer ${SUPA_KEY}`,
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`Storage unavailable (${fn}, HTTP ${r.status}). Check the MessagesBridge storage migration and server credentials.`);
  const text = await r.text();
  return text && text !== 'null' ? JSON.parse(text) : null;
}

const asString = (v) => (typeof v === 'string' ? v : JSON.stringify(v));

function supabase() {
  return {
    get: (k) => rpc('mb_get', { p_k: k }),
    set: (k, v, ttlSec) => rpc('mb_set', { p_k: k, p_v: asString(v), p_ttl_sec: ttlSec ?? null }),
    del: (k) => rpc('mb_del', { p_k: k }),
    lpush: (k, v) => rpc('mb_lpush', { p_k: k, p_v: asString(v) }),
    rpop: (k) => rpc('mb_rpop', { p_k: k }),
    expire: (k, ttlSec) => rpc('mb_expire', { p_k: k, p_ttl_sec: ttlSec }),
    incr: (k, ttlSec) => rpc('mb_incr', { p_k: k, p_ttl_sec: ttlSec ?? null }),
  };
}

function memory() {
  const kv = new Map(); // key -> {v, exp}
  const lists = new Map(); // key -> {arr, exp}
  const alive = (e) => e && (!e.exp || e.exp > Date.now());
  const sweep = (map, k) => {
    const e = map.get(k);
    if (e && !alive(e)) map.delete(k);
  };
  return {
    async get(k) {
      sweep(kv, k);
      return kv.get(k)?.v ?? null;
    },
    async set(k, v, ttlSec) {
      kv.set(k, { v, exp: ttlSec ? Date.now() + ttlSec * 1000 : null });
      return 'OK';
    },
    async del(k) {
      kv.delete(k);
      lists.delete(k);
      return 1;
    },
    async lpush(k, v) {
      sweep(lists, k);
      const e = lists.get(k) || { arr: [], exp: null };
      e.arr.unshift(v);
      lists.set(k, e);
      return e.arr.length;
    },
    async rpop(k) {
      sweep(lists, k);
      const e = lists.get(k);
      if (!e || e.arr.length === 0) return null;
      const v = e.arr.pop();
      if (e.arr.length === 0) lists.delete(k);
      return v;
    },
    async expire(k, ttlSec) {
      const e = kv.get(k) || lists.get(k);
      if (e) e.exp = Date.now() + ttlSec * 1000;
      return e ? 1 : 0;
    },
    async incr(k, ttlSec) {
      sweep(kv, k);
      const e = kv.get(k);
      const v = (e ? parseInt(e.v, 10) || 0 : 0) + 1;
      // Keep the current window's expiry; set one when the key is created.
      const exp = e && e.exp ? e.exp : (ttlSec ? Date.now() + ttlSec * 1000 : null);
      kv.set(k, { v: String(v), exp });
      return v;
    },
  };
}

// Persist the memory store across module reloads within one process (dev only).
const g = globalThis;
if (!g.__memRedis) g.__memRedis = memory();

if (!redisConfigured && process.env.NODE_ENV === 'production') throw new Error('MessagesBridge storage must be configured in production');
export const redis = redisConfigured ? supabase() : g.__memRedis;
