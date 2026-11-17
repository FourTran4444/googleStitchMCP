import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../src/worker.mjs';
import { hash, random, seal, unseal } from '../src/oauth.mjs';
const origin='https://test.example';
function setup() {
 const db = new DatabaseSync(':memory:');
 db.exec(readFileSync(new URL('../migrations/0001_oauth.sql',import.meta.url),'utf8'));
 const DB = { prepare(sql) { return { bind(...params) { return {
  async run() { return db.prepare(sql).run(...params); },
  async first() { return db.prepare(sql).get(...params); },
  async all() { return { results: db.prepare(sql).all(...params) }; }
 }; } }; } };
 return {PUBLIC_ORIGIN:origin,ENCRYPTION_KEY:random(),DB,db};
}
const req=(path,options={})=>new Request(origin+path,options);
const post=(path,data,headers={})=>req(path,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',...headers},body:new URLSearchParams(data)});
const redirect='https://chatgpt.com/connector_platform_oauth_redirect';
async function start(env){const r=await worker.fetch(req('/register',{method:'POST',body:JSON.stringify({redirect_uris:[redirect],token_endpoint_auth_method:'none'})}),env);assert.equal(r.status,201);const client=(await r.json()).client_id;const verifier=random();const params={client_id:client,redirect_uri:redirect,response_type:'code',code_challenge_method:'S256',code_challenge:await hash(verifier),resource:origin+'/mcp',scope:'stitch offline_access',state:'preserved-state'};const form=await worker.fetch(req('/authorize?'+new URLSearchParams(params)),env);const cookie=form.headers.get('set-cookie').split(';')[0];const tx=(await form.text()).match(/name="tx" value="([^"]+)"/)[1];return {client,verifier,params,cookie,tx};}
async function approve(env,s){const r=await worker.fetch(post('/authorize',{tx:s.tx,key:'synthetic_key_123456789012345',consent:'yes',decision:'allow'},{origin,cookie:s.cookie}),env);assert.equal(r.status,303);const u=new URL(r.headers.get('location'));assert.equal(u.searchParams.get('state'),'preserved-state');assert.equal(u.searchParams.get('iss'),origin);return u.searchParams.get('code');}
const mockGoogle=t=>t.mock.method(globalThis,'fetch',async()=>Response.json({jsonrpc:'2.0',id:1,result:{protocolVersion:'2025-03-26',serverInfo:{name:'test'}}}));
test('OAuth discovery and MCP challenge',async()=>{const env=setup();const r=await worker.fetch(req('/.well-known/oauth-authorization-server'),env);const d=await r.json();assert.deepEqual(d.code_challenge_methods_supported,['S256']);assert.equal(d.registration_endpoint,origin+'/register');const a=await worker.fetch(req('/mcp'),env);assert.equal(a.status,401);assert.match(a.headers.get('www-authenticate'),/oauth-protected-resource\/mcp/);});
test('public UI explains why the open-source bridge exists and links to its code',async()=>{const env=setup();const r=await worker.fetch(req('/'),env);assert.equal(r.status,200);const html=await r.text();assert.match(html,/Open source · MIT/);assert.match(html,/Why we built it/);assert.match(html,/Google Stitch authenticates with an API key/);assert.match(html,/ChatGPT web custom MCP connections use OAuth/);assert.match(html,/trust boundary should be visible/);assert.match(html,/github\.com\/FourTran4444\/googleStitchMCP/);assert.match(html,/Not affiliated with Google, OpenAI, or Cloudflare/);assert.match(html,/https:\/\/test\.example\/mcp/);assert.match(r.headers.get('content-security-policy'),/style-src 'unsafe-inline'/);});
test('untrusted redirect and wrong audience rejected',async()=>{const env=setup();const r=await worker.fetch(req('/register',{method:'POST',body:JSON.stringify({redirect_uris:['https://evil.example/callback']})}),env);assert.equal(r.status,400);const s=await start(env);s.params.resource='https://evil.example';assert.equal((await worker.fetch(req('/authorize?'+new URLSearchParams(s.params)),env)).status,400);});
test('CSRF and missing consent rejected',async t=>{mockGoogle(t);const env=setup(),s=await start(env);assert.equal((await worker.fetch(post('/authorize',{tx:s.tx,key:'synthetic_key_123456789012345',consent:'yes'},{origin}),env)).status,403);assert.equal((await worker.fetch(post('/authorize',{tx:s.tx,key:'synthetic_key_123456789012345'},{origin,cookie:s.cookie}),env)).status,400);});
test('full flow: PKCE, client binding, code replay, refresh rotation, revocation',async t=>{
 mockGoogle(t);const env=setup(),s=await start(env),code=await approve(env,s);
 const fields={grant_type:'authorization_code',client_id:s.client,redirect_uri:redirect,code,code_verifier:s.verifier,resource:origin+'/mcp'};
 assert.equal((await worker.fetch(post('/token',{...fields,code_verifier:random()}),env)).status,400);
 assert.equal((await worker.fetch(post('/token',{...fields,client_id:'other'}),env)).status,400);
 const r=await worker.fetch(post('/token',fields),env);assert.equal(r.status,200);const tokens=await r.json();
 assert.equal((await worker.fetch(post('/token',fields),env)).status,400);
 assert.equal((await worker.fetch(req('/mcp',{headers:{authorization:'Bearer '+tokens.access_token}}),env)).status,200);
 const refresh={grant_type:'refresh_token',refresh_token:tokens.refresh_token,client_id:s.client};
 const rotated=await (await worker.fetch(post('/token',refresh),env)).json();assert.ok(rotated.access_token);
 assert.equal((await worker.fetch(post('/token',refresh),env)).status,400);
 await worker.fetch(post('/revoke',{token:rotated.refresh_token,client_id:s.client}),env);
 assert.equal((await worker.fetch(req('/mcp',{headers:{authorization:'Bearer '+tokens.access_token}}),env)).status,401);
 assert.equal((await worker.fetch(req('/mcp',{headers:{authorization:'Bearer '+rotated.access_token}}),env)).status,401);
 const dump=env.db.prepare('SELECT data FROM oauth_state').all();assert.ok(!JSON.stringify(dump).includes('synthetic_key_123456789012345'));
});
test('concurrent code exchange succeeds only once',async t=>{mockGoogle(t);const env=setup(),s=await start(env),code=await approve(env,s);const f={grant_type:'authorization_code',client_id:s.client,redirect_uri:redirect,code,code_verifier:s.verifier};const responses=await Promise.all([worker.fetch(post('/token',f),env),worker.fetch(post('/token',f),env)]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,400]);});
test('encrypted key is bound to its grant',async()=>{const env=setup(),cipher=await seal(env,'synthetic','grant-a');assert.equal(await unseal(env,cipher,'grant-a'),'synthetic');await assert.rejects(unseal(env,cipher,'grant-b'));});
test('expired access tokens rejected',async t=>{mockGoogle(t);const env=setup(),s=await start(env),code=await approve(env,s);const tok=await (await worker.fetch(post('/token',{grant_type:'authorization_code',client_id:s.client,redirect_uri:redirect,code,code_verifier:s.verifier}),env)).json();env.db.exec("UPDATE oauth_state SET expires=0 WHERE kind='access'");assert.equal((await worker.fetch(req('/mcp',{headers:{authorization:'Bearer '+tok.access_token}}),env)).status,401);});

// Native HTML form POSTs can send Origin: null under no-referrer.
// Keep the page policy compatible with strict same-origin CSRF validation.
test('authorization and management forms preserve same-origin POST origin', async () => {
 const env=setup(),s=await start(env);
 const auth=await worker.fetch(req('/authorize?'+new URLSearchParams(s.params)),env);
 assert.equal(auth.headers.get('referrer-policy'),'same-origin');
 const manage=await worker.fetch(req('/manage'),env);
 assert.equal(manage.headers.get('referrer-policy'),'same-origin');
});
test('null and foreign form origins remain forbidden', async () => {
 const env=setup(),s=await start(env);
 for(const badOrigin of ['null','https://evil.example']) {
  const r=await worker.fetch(post('/authorize',{tx:s.tx,decision:'deny'},{origin:badOrigin,cookie:s.cookie}),env);
  assert.equal(r.status,403);
 }
 const accepted=await worker.fetch(post('/authorize',{tx:s.tx,decision:'deny'},{origin,cookie:s.cookie}),env);
 assert.equal(accepted.status,303);
 assert.equal(new URL(accepted.headers.get('location')).searchParams.get('error'),'access_denied');
});
test('pasted whitespace and long opaque keys reach Google intact',async t=>{
 const env=setup(),s=await start(env),key='synthetic.'+'x'.repeat(400)+'=';
 let seen;
 t.mock.method(globalThis,'fetch',async(_,options)=>{seen=options.headers['X-Goog-Api-Key'];return Response.json({result:{serverInfo:{name:'mock'},protocolVersion:'2025-03-26'}});});
 const r=await worker.fetch(post('/authorize',{tx:s.tx,key:' \n'+key+'\n ',consent:'yes',decision:'allow'},{origin,cookie:s.cookie}),env);
 assert.equal(r.status,303);assert.equal(seen,key);
});
test('missing consent gives an actionable form without echoing the key',async t=>{
 const env=setup(),s=await start(env),key='synthetic-private-key';
 t.mock.method(globalThis,'fetch',()=>{throw Error('Must not call Google');});
 const r=await worker.fetch(post('/authorize',{tx:s.tx,key,decision:'allow'},{origin,cookie:s.cookie}),env);
 assert.equal(r.status,400);const html=await r.text();assert.match(html,/Please check the box/);assert.match(html,/name="tx"/);assert.ok(!html.includes(key));
});
test('Google rejection keeps a retry form without creating a grant',async t=>{
 const env=setup(),s=await start(env);
 t.mock.method(globalThis,'fetch',async()=>new Response('denied',{status:403}));
 const r=await worker.fetch(post('/authorize',{tx:s.tx,key:'synthetic-test-key',consent:'yes',decision:'allow'},{origin,cookie:s.cookie}),env);
 assert.equal(r.status,400);assert.match(await r.text(),/Google Stitch could not validate/);
 assert.equal(env.db.prepare("SELECT count(*) AS n FROM oauth_state WHERE kind='grant'").get().n,0);
});

test('consent CSP permits ChatGPT callback navigation while keeping other origins blocked', async () => {
 const env=setup(),s=await start(env);
 const r=await worker.fetch(req('/authorize?'+new URLSearchParams(s.params)),env);
 const csp=r.headers.get('content-security-policy');
 assert.match(csp,/form-action 'self' https:\/\/chatgpt\.com;/);
 assert.ok(!csp.includes('*'));
 assert.match(csp,/frame-ancestors 'none'/);
});
test('successful consent cannot be replayed even when callback navigation fails', async t => {
 mockGoogle(t);const env=setup(),s=await start(env);await approve(env,s);
 const retry=await worker.fetch(post('/authorize',{tx:s.tx,key:'synthetic_key_123456789012345',consent:'yes',decision:'allow'},{origin,cookie:s.cookie}),env);
 assert.equal(retry.status,403);
 assert.equal(env.db.prepare("SELECT count(*) AS n FROM oauth_state WHERE kind='grant'").get().n,1);
});
