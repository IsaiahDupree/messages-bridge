// Real local repeated-read regression; no content or identifiers in output.
import assert from 'node:assert/strict';
import {runTool} from '../agent/messages-jxa.mjs';
const {threads}=await runTool('list_recent_threads',{limit:3});
assert(threads.length>=2);const initial=new Map();let reads=0;
for(const i of [0,1,0,1,0,1]){
 const id=threads[i].id;const r=await runTool('get_thread',{thread:id,limit:2});reads++;
 assert.equal(r.resolved_thread_id,id);assert(r.messages.every(m=>m.thread_guid===id));
 assert(r.messages.every(m=>!m.decode_error));
 const baseline=initial.get(id);if(baseline)assert.deepEqual(r.messages,baseline.messages,'Latest page changed during test; inspect for newly synced messages');else initial.set(id,r);
 if(r.next_cursor){const p=await runTool('get_thread',{thread:id,limit:2,cursor:r.next_cursor});reads++;assert.equal(p.resolved_thread_id,id);assert(p.messages.every(m=>m.thread_guid===id&&!r.messages.some(n=>n.id===m.id)));}
}
await assert.rejects(runTool('get_thread',{thread:'not-a-real-conversation-id'}),/No conversation found/);
// A failed lookup must not poison the next valid request.
const r=await runTool('get_thread',{thread:threads[0].id,limit:2});reads++;assert.equal(r.resolved_thread_id,threads[0].id);
console.log(JSON.stringify({ok:true,reads,alternating_conversations:2,stable_reaccess:true,pagination_isolated:true,error_recovery:true,no_messages_sent:true}));
