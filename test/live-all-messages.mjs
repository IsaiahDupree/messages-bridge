// Exhaustive read-only checks against the owner's real local database.
// Outputs counts only; message bodies and identifiers remain in memory.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {runTool} from '../agent/messages-jxa.mjs';
const sql=q=>JSON.parse(execFileSync('/usr/bin/sqlite3',['-readonly','-cmd','.timeout 5000','-json',join(homedir(),'Library/Messages/chat.db'),q],{encoding:'utf8',maxBuffer:16*1024*1024})||'[]');
const baseline=()=>sql('SELECT m.ROWID AS id,c.guid AS thread,m.cache_has_attachments AS attachments,m.is_from_me AS from_me FROM message m LEFT JOIN chat_message_join j ON j.message_id=m.ROWID LEFT JOIN chat c ON c.ROWID=j.chat_id ORDER BY m.ROWID,c.ROWID');
const initial=baseline();
const expected=new Map();const allIds=new Set();let unlinked=0;
for(const r of initial){allIds.add(String(r.id));if(!r.thread){unlinked++;continue;}if(!expected.has(r.thread))expected.set(r.thread,new Map());expected.get(r.thread).set(String(r.id),r);}
const report={local_messages:allIds.size,conversations:expected.size,unlinked_messages:unlinked};
const listed=new Set();let cursor;let listPages=0;
do{
 const r=await runTool('list_recent_threads',{limit:17,...(cursor?{cursor}:{})});
 for(const t of r.threads){assert(!listed.has(t.id),'Repeated conversation');assert(expected.has(t.id),'Unexpected conversation');assert(!t.decode_error,'Conversation preview decode failed');listed.add(t.id);}
 if(r.next_cursor){assert(Number(r.next_cursor)<Number(cursor||Number.MAX_SAFE_INTEGER),'List cursor did not advance');}
 cursor=r.next_cursor;assert(++listPages<=expected.size+1,'List pagination did not terminate');
}while(cursor);
assert.equal(listed.size,expected.size,'Conversation coverage mismatch');
const decoded=new Map();let threadPages=0;let memberships=0;let attributed=0;let attachments=0;let empty=0;let complete=0;
for(const [thread,rows] of expected){
 const seen=new Set();cursor=undefined;
 do{
  const r=await runTool('get_thread',{thread,limit:37,...(cursor?{cursor}:{})});
  let previous=0;
  for(const m of r.messages){
   assert(Number(m.id)>previous,'Page insertion order incorrect');previous=Number(m.id);
   assert(!seen.has(m.id),'Repeated message');assert(rows.has(m.id),'Unexpected message');
   assert(!m.decode_error,'Message decode failed');assert.equal(m.has_attachments,!!rows.get(m.id).attachments,'Attachment indicator mismatch');
   assert.equal(m.from==='me',!!rows.get(m.id).from_me,'Sender direction mismatch');
   assert(m.text===null||typeof m.text==='string','Invalid text type');
   seen.add(m.id);decoded.set(`${thread}:${m.id}`,m);memberships++;
   if(m.text_source==='attributedBody')attributed++;
   if(m.has_attachments)attachments++;
   if(!m.text)empty++;
  }
  if(r.next_cursor)assert(Number(r.next_cursor)<Number(cursor||Number.MAX_SAFE_INTEGER),'Thread cursor did not advance');
  cursor=r.next_cursor;threadPages++;
  assert(seen.size<=rows.size,'Thread coverage exceeded baseline');
 }while(cursor);
 assert.equal(seen.size,rows.size,'Thread missing messages');
 if(++complete%25===0)console.log(JSON.stringify({progress_conversations:complete,total_conversations:expected.size,messages_read:memberships}));
}
const frequencies=new Map();
for(const m of decoded.values())for(const word of new Set((m.text||'').toLowerCase().match(/[a-z]{4,}/g)||[]))frequencies.set(word,(frequencies.get(word)||0)+1);
assert(frequencies.size,'No searchable text');
const query=[...frequencies].sort((a,b)=>b[1]-a[1])[0][0];
const searchExpected=new Set([...decoded].filter(([,m])=>m.text?.toLowerCase().includes(query)).map(([k])=>k));
const found=new Set();cursor=undefined;let searchPages=0;
do{
 const r=await runTool('search_messages',{query,limit:13,...(cursor?{cursor}:{})});
 assert.equal(r.decode_errors,0,'Search decode failure');
 for(const m of r.results){const key=`${m.thread_guid}:${m.id}`;assert(searchExpected.has(key),'False positive');assert(!found.has(key),'Repeated search result');found.add(key);}
 if(r.next_cursor)assert(Number(r.next_cursor)<Number(cursor||Number.MAX_SAFE_INTEGER),'Search cursor did not advance');
 cursor=r.next_cursor;assert(++searchPages<=allIds.size+1,'Search pagination did not terminate');
}while(cursor);
assert.equal(found.size,searchExpected.size,'Search missing matches');
assert.deepEqual(baseline(),initial,'Live database changed during test; rerun against stable data');
console.log(JSON.stringify({ok:true,...report,message_memberships_read:memberships,unique_messages_read:new Set([...decoded.values()].map(m=>m.id)).size,attributed_messages_decoded:attributed,attachment_indicators:attachments,empty_text_messages:empty,list_pages:listPages,thread_pages:threadPages,search_pages:searchPages,search_matches:found.size,decode_errors:0,duplicate_or_missing_linked_messages:0,baseline_stable:true},null,2));
