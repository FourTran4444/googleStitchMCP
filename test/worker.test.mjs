import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.mjs';
const key = 'synthetic_test_key_1234567890';
const request = (path='/mcp', options={}) => new Request('https://proxy.example'+path, options);

test('health reports proxy status, not upstream authentication', async () => {
 const r=await worker.fetch(request('/health'));
 assert.equal(r.status,200);
 assert.equal((await r.json()).upstreamVerified,false);
});
test('invalid routes, methods and keys never reach Google', async t => {
 t.mock.method(globalThis,'fetch',()=>{throw new Error('Unexpected network call');});
 for(const [path,options,status] of [
  ['/other',{},404], ['/mcp?key=secret',{},404], ['/mcp',{method:'PUT'},405],
  ['/mcp',{},401], ['/mcp',{headers:{'X-Goog-Api-Key':'bad'}},401]
 ]) assert.equal((await worker.fetch(request(path,options))).status,status);
});
test('forwards JSON and MCP headers while isolating credentials and cookies', async t => {
 let calls=0;
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  calls++;
  assert.equal(url,'https://stitch.googleapis.com/mcp');
  assert.equal(options.redirect,'manual');
  assert.equal(options.headers.get('X-Goog-Api-Key'),key);
  assert.equal(options.headers.get('Authorization'),null);
  assert.equal(options.headers.get('Cookie'),null);
  assert.equal(options.headers.get('Mcp-Session-Id'),'session');
  assert.equal(options.headers.get('Mcp-Protocol-Version'),'2025-03-26');
  assert.equal(await new Response(options.body).text(),'{"jsonrpc":"2.0","id":1,"method":"tools/list"}');
  return new Response('{"result":{}}',{headers:{'content-type':'application/json','set-cookie':'blocked=1'}});
 });
 const r=await worker.fetch(request('/mcp',{method:'POST',headers:{'X-Goog-Api-Key':key,Cookie:'private=1','Mcp-Session-Id':'session','Mcp-Protocol-Version':'2025-03-26','content-type':'application/json'},body:'{"jsonrpc":"2.0","id":1,"method":"tools/list"}'}));
 assert.equal(calls,1); assert.equal(r.status,200);
 assert.equal(r.headers.get('set-cookie'),null);
 assert.equal(r.headers.get('cache-control'),'no-store');
 assert.equal(await r.text(),'{"result":{}}');
});
test('preserves event streams and session response headers',async t=>{
 t.mock.method(globalThis,'fetch',async()=>new Response('data: test\n\n',{headers:{'content-type':'text/event-stream','mcp-session-id':'session'}}));
 const r=await worker.fetch(request('/mcp',{headers:{'X-Goog-Api-Key':key}}));
 assert.equal(await r.text(),'data: test\n\n');
 assert.equal(r.headers.get('mcp-session-id'),'session');
});
test('preserves upstream authorization and quota failures',async t=>{
 for(const status of [401,403,429]) {
  t.mock.method(globalThis,'fetch',async()=>new Response('failure',{status,headers:{'retry-after':'30'}}));
  const r=await worker.fetch(request('/mcp',{headers:{'X-Goog-Api-Key':key}}));
  assert.equal(r.status,status); assert.equal(r.headers.get('retry-after'),'30');
 }
});
test('rejects redirects without following them',async t=>{
 t.mock.method(globalThis,'fetch',async()=>new Response(null,{status:307,headers:{location:'https://untrusted.example'}}));
 assert.equal((await worker.fetch(request('/mcp',{headers:{'X-Goog-Api-Key':key}}))).status,502);
});
test('network failures do not leak exception details or retry mutations',async t=>{
 let calls=0;
 t.mock.method(globalThis,'fetch',async()=>{calls++;throw new Error(key);});
 const r=await worker.fetch(request('/mcp',{method:'POST',headers:{'X-Goog-Api-Key':key},body:'{}'}));
 assert.equal(r.status,502); assert.equal(calls,1); assert.ok(!(await r.text()).includes(key));
});
test('DELETE preserves method and empty response',async t=>{
 t.mock.method(globalThis,'fetch',async(_,options)=>{assert.equal(options.method,'DELETE');assert.equal(options.body,undefined);return new Response(null,{status:204});});
 const r=await worker.fetch(request('/mcp',{method:'DELETE',headers:{'X-Goog-Api-Key':key}}));
 assert.equal(r.status,204); assert.equal(await r.text(),'');
});
