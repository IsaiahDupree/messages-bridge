// Real, read-only integration checks. No stored message content or test sends.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {runTool} from '../agent/messages-jxa.mjs';
const report={};
const status=await runTool('messages_status');assert(status.readable);report.local_messages=status.messages;
let cursor;const threads=new Set();let pages=0;
do {
 const r=await runTool('list_recent_threads',{limit:25,...(cursor?{cursor}:{})});
 for(const t of r.threads){assert(!threads.has(t.id),'Duplicate conversation across pages');threads.add(t.id);}
 assert(r.next_cursor!==cursor);cursor=r.next_cursor;if(++pages>1000)throw new Error('Pagination did not terminate');
}while(cursor);
assert.equal(threads.size,status.conversations);report.conversations=threads.size;
const [largest]=JSON.parse(execFileSync('/usr/bin/sqlite3',['-readonly','-json',join(homedir(),'Library/Messages/chat.db'),
 'SELECT c.guid,count(*) AS n FROM chat c JOIN chat_message_join j ON j.chat_id=c.ROWID GROUP BY c.ROWID ORDER BY n DESC LIMIT 1'],{encoding:'utf8'}));
const ids=new Set();cursor=undefined;let sample;let decoded=0;let decodeErrors=0;
do{
 const r=await runTool('get_thread',{thread:largest.guid,limit:50,...(cursor?{cursor}:{})});
 for(const m of r.messages){assert(!ids.has(m.id));ids.add(m.id);if(m.text_source==='attributedBody')decoded++;if(m.decode_error)decodeErrors++;if(m.text?.length>10) sample=m;}
 cursor=r.next_cursor;
}while(cursor);
assert.equal(ids.size,largest.n);assert.equal(decodeErrors,0);report.largest_conversation_messages=ids.size;report.decoded_attributed_messages=decoded;
assert(sample);const query=sample.text.slice(0,20);cursor=undefined;let found=false;
do{
 const r=await runTool('search_messages',{query,limit:10,...(cursor?{cursor}:{})});
 if(r.results.some(m=>m.id===sample.id)){found=true;break;}cursor=r.next_cursor;
}while(cursor);
assert(found,'Decoded text must be searchable');report.decoded_search=true;
for(const value of ['0','-1',"1' OR 1=1",'abc'])await assert.rejects(runTool('get_thread',{thread:largest.guid,cursor:value}),/Invalid cursor/);
await assert.rejects(runTool('search_messages',{query:''}),/must not be empty/);
report.invalid_inputs_rejected=true;
console.log(JSON.stringify({ok:true,...report},null,2));
