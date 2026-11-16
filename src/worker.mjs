const UPSTREAM = "https://stitch.googleapis.com/mcp";
const reply = (message,status) => Response.json({error:message},{status,headers:{"Cache-Control":"no-store"}});
export default {
 async fetch(request) {
  const url=new URL(request.url);
  if(url.pathname==="/health" && request.method==="GET") return Response.json({service:"stitch-mcp",status:"ok",authentication:"per-user-api-key",upstreamVerified:false});
  if(url.pathname!=="/mcp" || url.search) return reply("Not found",404);
  if(!["POST","GET","DELETE"].includes(request.method)) return reply("Method not allowed",405);
  const key=request.headers.get("x-goog-api-key");
  if(!key || !/^[A-Za-z0-9_-]{20,256}$/.test(key)) return reply("Connect with a valid Stitch API key",401);
  const headers=new Headers({"X-Goog-Api-Key":key,"Accept":"application/json, text/event-stream"});
  for(const name of ["content-type","mcp-session-id","mcp-protocol-version","last-event-id"]) {
   const value=request.headers.get(name); if(value) headers.set(name,value);
  }
  try {
   const upstream=await fetch(UPSTREAM,{method:request.method,headers,body:request.method==="POST"?request.body:undefined,redirect:"manual"});
   if(upstream.status>=300 && upstream.status<400) return reply("Unexpected upstream redirect",502);
   const out=new Headers({"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"});
   for(const name of ["content-type","mcp-session-id","mcp-protocol-version","retry-after"]) {
    const value=upstream.headers.get(name); if(value) out.set(name,value);
   }
   return new Response(upstream.body,{status:upstream.status,headers:out});
  } catch { return reply("Stitch upstream unavailable; check project state before retrying a design request",502); }
 }
};
