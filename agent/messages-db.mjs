// Read only the owner's local synced Messages database. Never use immutable=1:
// it ignores the live WAL and can hide newly received messages.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { join } from 'node:path';
const exec = promisify(execFile);
const db = join(homedir(), 'Library', 'Messages', 'chat.db');
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const limitFor = (value, fallback, max) => {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new Error(`limit must be an integer from 1 to ${max}`);
  return value;
};
function boundary(cursor) {
  if (cursor === undefined) return Number.MAX_SAFE_INTEGER;
  if (!/^[1-9][0-9]*$/.test(String(cursor)) || !Number.isSafeInteger(Number(cursor))) throw new Error('Invalid cursor');
  return Number(cursor);
}
async function sql(query) {
  try {
    const {stdout} = await exec('/usr/bin/sqlite3', ['-readonly','-json',db,query], {timeout:15000,maxBuffer:16*1024*1024});
    return JSON.parse(stdout || '[]');
  } catch(e) {
    if (/unable to open|authorization denied|not authorized|operation not permitted/i.test(e.stderr || e.message)) throw new Error('Cannot read Messages. Grant Full Disk Access to the agent in System Settings > Privacy & Security > Full Disk Access.');
    throw new Error(e.killed ? 'Messages database read timed out' : 'Messages database query failed: '+String(e.stderr || e.message).slice(0,250));
  }
}
const DECODE = `ObjC.import('Foundation');
function run(){
 var input=$.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;
 var rows=JSON.parse(ObjC.unwrap($.NSString.alloc.initWithDataEncoding(input,$.NSUTF8StringEncoding)));
 return JSON.stringify(rows.map(function(r){
  if(r.text==null && r.body){
   try {var d=$.NSData.alloc.initWithBase64EncodedStringOptions(r.body,0); r.text=ObjC.unwrap($.NSUnarchiver.unarchiveObjectWithData(d).string); r.text_source='attributedBody';}
   catch(e){r.text=null;r.decode_error=true;}
  }else{r.text_source=r.text==null?'none':'text';}
  delete r.body;return r;
 }));
}`;
async function decode(rows) {
  if (!rows.length) return rows;
  const input = rows.map(r=>({...r,body:r.body ? Buffer.from(r.body,'hex').toString('base64') : null}));
  const stdout = await new Promise((resolve,reject)=>{
    const child=execFile('/usr/bin/osascript',['-l','JavaScript','-e',DECODE],{timeout:15000,maxBuffer:16*1024*1024},(err,out)=>err?reject(new Error('Apple attributed-text decoding failed')):resolve(out));
    child.stdin.on('error',()=>{}); child.stdin.end(JSON.stringify(input));
  });
  return JSON.parse(stdout);
}
const select = `m.ROWID AS id,m.guid,m.text,hex(m.attributedBody) AS body,m.is_from_me AS from_me,
 datetime((CASE WHEN m.date>100000000000 THEN m.date/1000000000 ELSE m.date END)+978307200,'unixepoch')||'Z' AS date,
 h.id AS handle,m.cache_has_attachments AS has_attachments,c.chat_identifier AS thread_id,c.guid AS thread_guid,c.display_name AS thread_name`;
const joins = `FROM message m JOIN chat_message_join j ON j.message_id=m.ROWID JOIN chat c ON c.ROWID=j.chat_id LEFT JOIN handle h ON h.ROWID=m.handle_id`;
const out = r => ({id:String(r.id),guid:r.guid,text:r.text ?? null,text_source:r.text_source,decode_error:!!r.decode_error,from:r.from_me?'me':r.handle || 'them',date:r.date,has_attachments:!!r.has_attachments,thread_id:r.thread_id,thread_guid:r.thread_guid});
const scope = {source:'mac_messages_database',coverage:'Messages currently stored on this Mac; not proof of complete iPhone or iCloud history',attachment_content_included:false};
export async function readMessages(tool,args={}) {
 if(tool==='messages_status') {
  const [r]=await sql(`SELECT count(*) AS messages,sum(text IS NOT NULL) AS plain_text_messages,sum(attributedBody IS NOT NULL) AS attributed_messages, (SELECT count(DISTINCT chat_id) FROM chat_message_join) AS conversations FROM message m`);
  return {...r,...scope,readable:true};
 }
 const before=boundary(args.cursor);
 if(tool==='list_recent_threads') {
  const limit=limitFor(args.limit,20,100);
  const rows=await decode(await sql(`WITH latest AS (SELECT chat_id,max(message_id) AS last_id FROM chat_message_join GROUP BY chat_id)
  SELECT ${select} FROM latest l JOIN chat c ON c.ROWID=l.chat_id JOIN message m ON m.ROWID=l.last_id LEFT JOIN handle h ON h.ROWID=m.handle_id
  WHERE m.ROWID<${before} ORDER BY m.ROWID DESC,c.ROWID DESC LIMIT ${limit+1}`));
  // A message may belong to multiple chats. Keep all tied rows on the page.
  let page=rows.slice(0,limit);
  if(rows.length>limit && rows[limit].id===page.at(-1).id) {
   const last=page.at(-1).id;
   const tied=await decode(await sql(`SELECT ${select} ${joins} WHERE m.ROWID=${last}`));
   page=[...page.filter(r=>r.id!==last),...tied];
  }
  return {threads:page.map(r=>({id:r.thread_guid || r.thread_id,name:r.thread_name || r.thread_id,handle:r.handle,last_text:r.text,date:r.date,decode_error:!!r.decode_error})),next_cursor:rows.length>limit?String(page.at(-1).id):null,...scope};
 }
 if(tool==='get_thread') {
  const thread=String(args.thread || '').trim(); if(!thread) throw new Error('thread is required');
  let chats=await sql(`SELECT ROWID AS id FROM chat WHERE chat_identifier=${quote(thread)} OR guid=${quote(thread)}`);
  if(!chats.length) chats=await sql(`SELECT c.ROWID AS id FROM chat c JOIN chat_handle_join j ON j.chat_id=c.ROWID JOIN handle h ON h.ROWID=j.handle_id WHERE h.id=${quote(thread)} AND (SELECT count(*) FROM chat_handle_join x WHERE x.chat_id=c.ROWID)=1`);
  if(chats.length!==1) throw new Error(chats.length?'Multiple conversations match; use an exact thread id from list_recent_threads':'No conversation found');
  const limit=limitFor(args.limit,30,200);
  const rows=await decode(await sql(`SELECT ${select} ${joins} WHERE c.ROWID=${chats[0].id} AND m.ROWID<${before} ORDER BY m.ROWID DESC LIMIT ${limit+1}`));
  const page=rows.slice(0,limit);
  return {thread,messages:page.map(out).reverse(),next_cursor:rows.length>limit?String(page.at(-1).id):null,...scope};
 }
 if(tool==='search_messages') {
  const query=String(args.query || '').trim().toLowerCase(); if(!query) throw new Error('query must not be empty');
  const limit=limitFor(args.limit,20,100);
  // Decode a bounded page so attributed-only messages participate in search.
  // next_cursor advances the scanned records, even when this page has no hits.
  const rows=await decode(await sql(`SELECT ${select} ${joins} WHERE m.ROWID IN (SELECT ROWID FROM message WHERE ROWID<${before} ORDER BY ROWID DESC LIMIT 500) ORDER BY m.ROWID DESC,c.ROWID DESC`));
  const matches=[];let scanned=0;let last=null;const seen=new Set();
  for(const row of rows) {
   if(matches.length>=limit && row.id!==last) break;
   last=row.id;if(!seen.has(row.id)){seen.add(row.id);scanned++;}
   if(row.text?.toLowerCase().includes(query)) matches.push(out(row));
  }
  const more=last!==null && (await sql(`SELECT 1 FROM message WHERE ROWID<${last} LIMIT 1`)).length>0;
  return {results:matches,scanned_messages:scanned,decode_errors:rows.filter(r=>r.decode_error).length,next_cursor:more?String(last):null,...scope};
 }
 throw new Error('Unknown read tool');
}
