// Live OAuth -> MCP -> paired Mac -> real read-only Messages checks.
// Requires an OWNER account: MB_EMAIL, MB_PASSWORD. Never uses reviewer/demo data.
// Run after `apple-messages-agent pair ...` and `apple-messages-agent install`.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const base=process.env.MB_SERVER || 'https://messagesbridge.vercel.app';
const email=process.env.MB_EMAIL,password=process.env.MB_PASSWORD;
assert(email && password,'Set MB_EMAIL and MB_PASSWORD to your own MessagesBridge account');
assert(!email.endsWith('.demo'),'Reviewer accounts cannot validate real Mac integration');
const post=async(path,body,token)=>{
 const r=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
 const data=await r.json();assert(r.ok,`${path}: HTTP ${r.status}`);return data;
};
const health=await (await fetch(base+'/api/health')).json();assert(health.ok && health.redisOk);
const session=await post('/api/login',{email,password});assert(session.token);
const me=await (await fetch(base+'/api/me',{headers:{authorization:`Bearer ${session.token}`}})).json();assert(!me.demo);
const redirect='https://chatgpt.com/connector_platform_oauth_redirect';
const client=await post('/api/oauth/register',{redirect_uris:[redirect],client_name:'MessagesBridge live read integration'});
const verifier=crypto.randomBytes(32).toString('base64url');
const auth=await post('/api/oauth/authorize',{client_id:client.client_id,redirect_uri:redirect,state:'live-read',code_challenge:crypto.createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'},session.token);
const code=new URL(auth.redirect).searchParams.get('code');assert(code);
const token=await post('/api/oauth/token',{grant_type:'authorization_code',code,code_verifier:verifier,redirect_uri:redirect});assert(token.access_token);
let id=0;
async function mcp(method,params){
 const r=await fetch(base+'/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream',authorization:`Bearer ${token.access_token}`},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params}),signal:AbortSignal.timeout(60000)});
 const raw=await r.text();assert(r.ok,`MCP HTTP ${r.status}`);const match=raw.match(/^data: (.*)$/m);const data=JSON.parse(match?match[1]:raw);assert(!data.error,'MCP protocol error');return data.result;
}
async function tool(name,args={}){const r=await mcp('tools/call',{name,arguments:args});assert(!r.isError,r.content?.[0]?.text || 'Tool failed');return JSON.parse(r.content[0].text);}
await mcp('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'live-read-test',version:'1.0'}});
const tools=await mcp('tools/list',{});assert(tools.tools.some(t=>t.name==='messages_status'));
const status=await tool('messages_status');assert(status.readable && status.messages>0);
const threads=await tool('list_recent_threads',{limit:2});assert(threads.threads.length);
const thread=await tool('get_thread',{thread:threads.threads[0].id,limit:2});assert(thread.messages.length);
if(thread.next_cursor){const page=await tool('get_thread',{thread:threads.threads[0].id,limit:2,cursor:thread.next_cursor});assert(page.messages.every(m=>!thread.messages.some(n=>n.id===m.id)));}
const sample=thread.messages.find(m=>m.text?.trim());assert(sample);
let cursor,found=false;
do {const result=await tool('search_messages',{query:sample.text.slice(0,20),limit:5,...(cursor?{cursor}:{})});found=result.results.some(m=>m.id===sample.id);cursor=result.next_cursor;}while(!found && cursor);
assert(found);
console.log(JSON.stringify({ok:true,health:true,oauth:true,mcp:true,real_mac_reads:true,decoded_search:true,messages:status.messages,conversations:status.conversations,no_messages_sent:true},null,2));
