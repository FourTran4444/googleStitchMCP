const enc = new TextEncoder();
const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const un64 = s => Uint8Array.from(atob(s.replaceAll('-','+').replaceAll('_','/')), c=>c.charCodeAt(0));
export const random = () => b64(crypto.getRandomValues(new Uint8Array(32)));
export const hash = async s => b64(await crypto.subtle.digest('SHA-256',enc.encode(s)));
const now = () => Math.floor(Date.now()/1000);
const scope = 'stitch offline_access';
const headers = {'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'};
export const json = (data,status=200,extra={}) => Response.json(data,{status,headers:{...headers,...extra}});
const error = (message='invalid_request',status=400) => json({error:message},status);
const escape = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const page = (body,cookie) => new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Stitch Cloudflare authorization</title><body><main><h1>Stitch Cloudflare</h1>${body}</main></body></html>`,{headers:{...headers,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",...(cookie?{'Set-Cookie':cookie}:{})}});
async function put(env,id,kind,data,ttl){await env.DB.prepare('INSERT OR REPLACE INTO oauth_state VALUES (?, ?, ?, ?)').bind(id,kind,JSON.stringify(data),now()+ttl).run();}
async function get(env,id,kind,consume=false){const row=await env.DB.prepare(`${consume?'DELETE FROM':'SELECT * FROM'} oauth_state WHERE id = ? AND kind = ? AND expires > ?${consume?' RETURNING *':''}`).bind(id,kind,now()).first();return row?JSON.parse(row.data):null;}
async function drop(env,id){await env.DB.prepare('DELETE FROM oauth_state WHERE id = ?').bind(id).run();}
async function cryptKey(env){return crypto.subtle.importKey('raw',un64(env.ENCRYPTION_KEY),{name:'AES-GCM'},false,['encrypt','decrypt']);}
export async function seal(env,value,aad){const iv=crypto.getRandomValues(new Uint8Array(12));const data=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(aad)},await cryptKey(env),enc.encode(value));return `${b64(iv)}.${b64(data)}`;}
export async function unseal(env,value,aad){const [iv,data]=value.split('.');return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:un64(iv),additionalData:enc.encode(aad)},await cryptKey(env),un64(data)));}
export function validRedirect(value){try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='chatgpt.com'&&!u.port&&!u.search&&!u.hash&&!u.username&&!u.password&&(u.pathname==='/connector_platform_oauth_redirect'||/^\/connector\/oauth\/[A-Za-z0-9_-]+$/.test(u.pathname));}catch{return false;}}
async function form(request){if(!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded'))throw Error();const text=await request.text();if(text.length>16000)throw Error();const p=new URLSearchParams(text);for(const k of new Set(p.keys()))if(p.getAll(k).length!==1)throw Error();return p;}
function cookie(request){return request.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith('__Host-stitch_csrf='))?.split('=')[1];}
async function issue(env,grant,client){const access=random(),refresh=random();await put(env,await hash(access),'access',{grant,client,resource:env.PUBLIC_ORIGIN+'/mcp',scope:'stitch'},3600);await put(env,await hash(refresh),'refresh',{grant,client,resource:env.PUBLIC_ORIGIN+'/mcp',scope:'stitch'},2592000);return json({access_token:access,refresh_token:refresh,token_type:'Bearer',expires_in:3600,scope});}
export async function bearerKey(request,env){const token=request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/i)?.[1];if(!token)return null;const a=await get(env,await hash(token),'access');if(!a||a.resource!==env.PUBLIC_ORIGIN+'/mcp'||a.scope!=='stitch')return null;const grant=await get(env,a.grant,'grant');if(!grant||grant.client!==a.client)return null;return unseal(env,grant.key,a.grant);}
export async function oauth(request,env){
 const url=new URL(request.url),base=env.PUBLIC_ORIGIN,resource=base+'/mcp',path=url.pathname;
 if(path==='/.well-known/oauth-protected-resource'||path==='/.well-known/oauth-protected-resource/mcp')return json({resource,authorization_servers:[base],scopes_supported:['stitch','offline_access'],bearer_methods_supported:['header']});
 if(path==='/.well-known/oauth-authorization-server')return json({issuer:base,authorization_endpoint:base+'/authorize',token_endpoint:base+'/token',registration_endpoint:base+'/register',revocation_endpoint:base+'/revoke',response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],token_endpoint_auth_methods_supported:['none'],revocation_endpoint_auth_methods_supported:['none'],code_challenge_methods_supported:['S256'],scopes_supported:['stitch','offline_access'],authorization_response_iss_parameter_supported:true});
 if(path==='/'&&request.method==='GET')return page('<p>Connect this server in ChatGPT using OAuth and dynamic client registration.</p><p>MCP endpoint: '+escape(resource)+'</p><p>Enter your Stitch key only during authorization. No Gmail password is required.</p><p><a href="/manage">Revoke a connection</a></p>');
 if(!['/register','/authorize','/token','/revoke','/manage'].includes(path))return error('not_found',404);
 if(!env.DB||!env.ENCRYPTION_KEY)return error('server_not_configured',503);
 if(path==='/register'&&request.method==='POST'){
  const raw=await request.text();if(raw.length>8000)return error();const data=JSON.parse(raw);
  if(!Array.isArray(data.redirect_uris)||data.redirect_uris.length<1||data.redirect_uris.length>5||!data.redirect_uris.every(validRedirect)||data.token_endpoint_auth_method&&data.token_endpoint_auth_method!=='none')return error('invalid_client_metadata');
  const id=random();await put(env,id,'client',{redirects:data.redirect_uris},31536000);
  return json({client_id:id,client_id_issued_at:now(),redirect_uris:data.redirect_uris,token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']},201);
 }
 if(path==='/authorize'&&request.method==='GET'){
  const p=url.searchParams;for(const k of new Set(p.keys()))if(p.getAll(k).length!==1)return error();
  const client=await get(env,p.get('client_id')||'','client');
  if(!client||!client.redirects.includes(p.get('redirect_uri'))||!validRedirect(p.get('redirect_uri')))return error('invalid_client');
  if(p.get('response_type')!=='code'||p.get('code_challenge_method')!=='S256'||! /^[A-Za-z0-9_-]{43}$/.test(p.get('code_challenge')||'')||p.get('resource')!==resource)return error();
  if((p.get('scope')||'stitch').split(' ').some(s=>!['stitch','offline_access'].includes(s)))return error('invalid_scope');
  const csrf=random(),tx=random();await put(env,await hash(tx),'pending',{params:Object.fromEntries(p),csrf:await hash(csrf)},600);
  return page(`<p>Authorize ChatGPT to read, create, and edit designs accessible to your Stitch API key.</p><p>Your key will be encrypted in this server's database for up to 30 days. The operator can process it at runtime. No Google password is requested.</p><form method="post" action="/authorize"><input type="hidden" name="tx" value="${tx}"><label>Stitch API key <input type="password" name="key" required autocomplete="off" maxlength="256"></label><p><label><input type="checkbox" name="consent" value="yes" required>Allow access to my Stitch projects and screens</label></p><button name="decision" value="allow">Authorize</button><button name="decision" value="deny" formnovalidate>Cancel</button></form>`,`__Host-stitch_csrf=${csrf}; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`);
 }
 if(path==='/authorize'&&request.method==='POST'){
  if(request.headers.get('origin')!==base)return error('invalid_origin',403);
  const p=await form(request),id=await hash(p.get('tx')||''),pending=await get(env,id,'pending');
  if(!pending||pending.csrf!==await hash(cookie(request)||''))return error('invalid_session',403);
  const a=pending.params,redirect=new URL(a.redirect_uri);redirect.searchParams.set('iss',base);if(a.state)redirect.searchParams.set('state',a.state);
  if(p.get('decision')==='deny'){await drop(env,id);redirect.searchParams.set('error','access_denied');return Response.redirect(redirect,303);}
  const key=p.get('key')||'';if(p.get('consent')!=='yes'||! /^[A-Za-z0-9_-]{20,256}$/.test(key))return error('invalid_key_or_consent');
  // Read-only handshake verifies the credential; never generate a design to test it.
  const probe=await fetch('https://stitch.googleapis.com/mcp',{method:'POST',redirect:'manual',headers:{'X-Goog-Api-Key':key,'Content-Type':'application/json','Accept':'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'stitch-oauth-validation',version:'2.0.0'}}})});
  const result=await probe.text();if(!probe.ok||!result.includes('serverInfo')||!result.includes('protocolVersion'))return page('<p>Stitch did not accept the credential or its service is unavailable. Go back and try again. No connection was saved.</p>');
  if(!await get(env,id,'pending',true))return error('invalid_session');
  const grant=random(),code=random();await put(env,grant,'grant',{client:a.client_id,keyHash:await hash(key),key:await seal(env,key,grant)},2592000);
  await put(env,await hash(code),'code',{grant,client:a.client_id,redirect:a.redirect_uri,challenge:a.code_challenge,resource},300);
  redirect.searchParams.set('code',code);return Response.redirect(redirect,303);
 }
 if(path==='/token'&&request.method==='POST'){
  const p=await form(request);if(p.get('resource')&&p.get('resource')!==resource)return error('invalid_target');
  const kind=p.get('grant_type');
  if(kind==='authorization_code'){
   const id=await hash(p.get('code')||''),data=await get(env,id,'code');const verifier=p.get('code_verifier')||'';
   if(!data||data.client!==p.get('client_id')||data.redirect!==p.get('redirect_uri')||! /^[A-Za-z0-9._~-]{43,128}$/.test(verifier)||await hash(verifier)!==data.challenge)return error('invalid_grant');
   if(!await get(env,data.grant,'grant')||!await get(env,id,'code',true))return error('invalid_grant');return issue(env,data.grant,data.client);
  }
  if(kind==='refresh_token'){
   const id=await hash(p.get('refresh_token')||''),data=await get(env,id,'refresh');
   if(!data||data.resource!==resource||data.client!==p.get('client_id')||!await get(env,data.grant,'grant'))return error('invalid_grant');
   if(!await get(env,id,'refresh',true))return error('invalid_grant');return issue(env,data.grant,data.client);
  }
  return error('unsupported_grant_type');
 }
 if(path==='/revoke'&&request.method==='POST'){
  const p=await form(request),id=await hash(p.get('token')||'');const data=await get(env,id,'access')||await get(env,id,'refresh');if(data&&data.client===p.get('client_id'))await drop(env,data.grant);return json({});
 }
 if(path==='/manage'&&request.method==='GET'){
  const csrf=random();await put(env,await hash(csrf),'manage',{},600);
  return page(`<p>Enter the Stitch key used for a connection to delete all grants stored here for that key. You can also revoke the API key in Google Stitch.</p><form method="post" action="/manage"><input type="hidden" name="csrf" value="${csrf}"><label>Stitch key <input type="password" name="key" required autocomplete="off"></label><button>Revoke connections</button></form>`,`__Host-stitch_csrf=${csrf}; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`);
 }
 if(path==='/manage'&&request.method==='POST'){
  const p=await form(request),csrf=p.get('csrf');if(request.headers.get('origin')!==base||!csrf||cookie(request)!==csrf||!await get(env,await hash(csrf),'manage',true))return error('invalid_session',403);
  // Key possession authorizes revocation; no account or key data is returned.
  await env.DB.prepare("DELETE FROM oauth_state WHERE kind = 'grant' AND json_extract(data, '$.keyHash') = ?").bind(await hash(p.get('key')||'')).run();
  return page('<p>Matching connections have been revoked. You may close this page.</p>');
 }
 return error('not_found',404);
}
