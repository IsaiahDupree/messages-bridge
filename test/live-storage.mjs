// Real integration check against the configured Supabase project; unique keys,
// no message data or mock providers. Cleans up only keys this run created.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {redis,redisConfigured} from '../server/lib/redis.js';
assert(redisConfigured,'Live Supabase credentials required');
const root=`integration:${randomUUID()}`;
const keys=['kv','queue','counter'].map(k=>`${root}:${k}`);
try{
 await redis.set(keys[0],'roundtrip',60);assert.equal(await redis.get(keys[0]),'roundtrip');
 await redis.lpush(keys[1],'first');await redis.lpush(keys[1],'second');await redis.expire(keys[1],60);
 assert.equal(await redis.rpop(keys[1]),'first');assert.equal(await redis.rpop(keys[1]),'second');assert.equal(await redis.rpop(keys[1]),null);
 assert.equal(await redis.incr(keys[2],60),1);assert.equal(await redis.incr(keys[2],60),2);
 await redis.expire(keys[0],-1);assert.equal(await redis.get(keys[0]),null);
 console.log(JSON.stringify({ok:true,live_storage:true,fifo:true,expiry:true,counters:true}));
}finally{for(const k of keys)await redis.del(k);}
