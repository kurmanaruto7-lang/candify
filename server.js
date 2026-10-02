const http=require("http")
const fs=require("fs")
const path=require("path")
const wisp=require("wisp-server-node")
const {uvPath}=require("@titaniumnetwork-dev/ultraviolet")
const {baremuxPath}=require("@mercuryworkshop/bare-mux/node")
const epoxyPath=path.join(__dirname,"node_modules","@mercuryworkshop","epoxy-transport","dist")
const PORT=process.env.PORT||3000
const PUB=path.join(__dirname,"public")
const S3="https://s3.amazonaws.com"
const types={".html":"text/html; charset=utf-8",".js":"text/javascript",".mjs":"text/javascript",".css":"text/css",".svg":"image/svg+xml",".png":"image/png",".ico":"image/x-icon",".json":"application/json",".wasm":"application/wasm"}
const mounts=[["/uv/",uvPath],["/baremux/",baremuxPath],["/epoxy/",epoxyPath],["/",PUB]]
const drop=new Set(["content-encoding","content-length","transfer-encoding","connection","x-frame-options","content-security-policy","content-security-policy-report-only","strict-transport-security","set-cookie"])
const textType=/text\/|javascript|json|xml/
const abs=/(https?:)?\/\/s3\.amazonaws\.com\//g

function serveStatic(req,res){
let p=decodeURIComponent(new URL(req.url,"http://x").pathname)
if(p==="/")p="/index.html"
if(p==="/app")p="/app.html"
for(const [pre,dir] of mounts){
if(!p.startsWith(pre))continue
const f=path.join(dir,path.normalize(p.slice(pre.length)))
if(!f.startsWith(dir)||!fs.existsSync(f)||fs.statSync(f).isDirectory())continue
res.writeHead(200,{"content-type":types[path.extname(f)]||"application/octet-stream","cache-control":"no-cache","access-control-allow-origin":"*"})
return fs.createReadStream(f).pipe(res)
}
res.writeHead(404);res.end("Not found")
}

// mirror of the original S3 bucket at /s3/...
async function s3(req,res){
try{
const u=new URL(req.url,"http://x")
let p=u.pathname.slice(3)
if(/^\/[^/]+$/.test(p)){res.writeHead(302,{location:"/s3"+p+"/"+u.search});return res.end()}
if(p.endsWith("/"))p+="index.html"
const h={"user-agent":req.headers["user-agent"]||"","accept":req.headers.accept||"*/*"}
if(req.headers.range)h.range=req.headers.range
const m=req.method==="HEAD"?"HEAD":"GET"
const get=x=>fetch(S3+x,{method:m,headers:h,redirect:"manual"})
let r=await get(p+u.search)
if((r.status===403||r.status===404)&&(req.headers.accept||"").includes("text/html"))r=await get("/"+p.split("/")[1]+"/index.html")
const headers={}
r.headers.forEach((v,k)=>{if(!drop.has(k))headers[k]=v})
if(headers.location)headers.location=headers.location.replace(abs,"/s3/")
const type=r.headers.get("content-type")||""
let body
if(textType.test(type))body=(await r.text()).replace(abs,"/s3/")
else body=Buffer.from(await r.arrayBuffer())
res.writeHead(r.status,headers)
res.end(m==="HEAD"?undefined:body)
}catch(e){res.writeHead(502);res.end("Upstream error")}
}

const server=http.createServer((req,res)=>{
if(req.url.startsWith("/s3/"))return s3(req,res)
serveStatic(req,res)
})
server.on("upgrade",(req,socket,head)=>{
if(req.url.startsWith("/wisp/"))wisp.routeRequest(req,socket,head)
else socket.destroy()
})
server.listen(PORT,()=>console.log("Candify on "+PORT))
