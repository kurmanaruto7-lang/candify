const http=require("http")
const fs=require("fs")
const path=require("path")
const crypto=require("crypto")
const wispMod=require("@mercuryworkshop/wisp-js/server")
const wisp=wispMod.server||wispMod
try{(wispMod.logging||wisp.logging)?.set_level?.((wispMod.logging||wisp.logging).NONE)}catch(e){}
const {uvPath}=require("@titaniumnetwork-dev/ultraviolet")
const {baremuxPath}=require("@mercuryworkshop/bare-mux/node")
const epoxyPath=path.join(__dirname,"node_modules","@mercuryworkshop","epoxy-transport","dist")

const PORT=process.env.PORT||3000
const PUB=path.join(__dirname,"public")
const S3="https://s3.amazonaws.com"
const VERSION=(()=>{try{return require("./package.json").version}catch(e){return "2.0.0"}})()
const BUILD=new Date().toISOString()
const SESSION_MS=1000*60*60*2            // owner session lifetime: 2 hours
const LOGIN_MAX=8, LOGIN_WINDOW=1000*60*10 // 8 tries / 10 min per IP

const types={".html":"text/html; charset=utf-8",".js":"text/javascript",".mjs":"text/javascript",".css":"text/css",".svg":"image/svg+xml",".png":"image/png",".ico":"image/x-icon",".json":"application/json",".wasm":"application/wasm",".woff2":"font/woff2"}
const mounts=[["/uv/",uvPath],["/baremux/",baremuxPath],["/epoxy/",epoxyPath],["/",PUB]]
const drop=new Set(["content-encoding","content-length","transfer-encoding","connection","x-frame-options","content-security-policy","content-security-policy-report-only","strict-transport-security","set-cookie"])
const textType=/text\/|javascript|json|xml/
const abs=/(https?:)?\/\/s3\.amazonaws\.com\//g

// ---------- live metrics (all real, measured here) ----------
const metrics={reqTotal:0,errTotal:0,wispNow:0,wispTotal:0,startedAt:Date.now(),perMin:[]}
function bump(){
const m=Math.floor(Date.now()/60000)
const last=metrics.perMin[metrics.perMin.length-1]
if(last&&last.m===m)last.c++
else{metrics.perMin.push({m,c:1});if(metrics.perMin.length>60)metrics.perMin.shift()}
metrics.reqTotal++
}

// ---------- owner auth (server-side only; secret comes from OWNER_PASSWORD env) ----------
const OWNER_SALT=crypto.randomBytes(16)
const OWNER_HASH=process.env.OWNER_PASSWORD?crypto.scryptSync(String(process.env.OWNER_PASSWORD),OWNER_SALT,32):null
const OWNER_CONFIGURED=!!OWNER_HASH
const sessions=new Map()            // token -> expiry ms
const loginHits=new Map()           // ip -> {n, at}
function verifyPassword(attempt){
if(!OWNER_HASH)return false
let h;try{h=crypto.scryptSync(String(attempt),OWNER_SALT,32)}catch(e){return false}
return h.length===OWNER_HASH.length&&crypto.timingSafeEqual(h,OWNER_HASH)
}
function newSession(){
const token=crypto.randomBytes(32).toString("hex")
const exp=Date.now()+SESSION_MS
sessions.set(token,exp)
return {token,exp}
}
function sessionValid(token){
const exp=sessions.get(token)
if(!exp)return false
if(Date.now()>exp){sessions.delete(token);return false}
return true
}
function bearer(req){
const a=req.headers.authorization||""
const m=/^Bearer\s+([a-f0-9]{64})$/i.exec(a)
return m?m[1]:""
}
function clientIp(req){
return (req.headers["cf-connecting-ip"]||req.headers["x-forwarded-for"]||"").split(",")[0].trim()||req.socket.remoteAddress||"?"
}

// ---------- owner config + activity log (no secrets, git-ignored) ----------
const CONFIG_FILE=path.join(__dirname,"admin-config.json")
const LOG_FILE=path.join(__dirname,"admin-log.json")
const DEFAULT_CONFIG={siteName:"Candify",announcement:"",maintenance:false,maintenanceMsg:"Candify is down for a quick tune-up. Check back soon.",theme:"candy",features:{history:true,favorites:true,quickLaunch:true,cloak:true}}
function readConfig(){
try{return Object.assign({},DEFAULT_CONFIG,JSON.parse(fs.readFileSync(CONFIG_FILE,"utf8")))}
catch(e){return Object.assign({},DEFAULT_CONFIG)}
}
function writeConfig(c){try{fs.writeFileSync(CONFIG_FILE,JSON.stringify(c,null,2))}catch(e){}}
function publicConfig(){
const c=readConfig()
return {siteName:c.siteName,announcement:c.announcement,maintenance:c.maintenance,maintenanceMsg:c.maintenanceMsg,theme:c.theme,features:c.features}
}
function readLog(){try{return JSON.parse(fs.readFileSync(LOG_FILE,"utf8"))}catch(e){return []}}
function logAction(action,req,extra){
const l=readLog()
l.unshift({t:Date.now(),action,ip:clientIp(req),...(extra||{})})
try{fs.writeFileSync(LOG_FILE,JSON.stringify(l.slice(0,500),null,2))}catch(e){}
}

// ---------- JSON API ----------
function sendJSON(res,code,obj){
res.writeHead(code,{"content-type":"application/json","cache-control":"no-store","access-control-allow-origin":"*"})
res.end(JSON.stringify(obj))
}
async function readBody(req,limit=4096){
const chunks=[];let size=0
for await(const c of req){size+=c.length;if(size>limit)throw new Error("too large");chunks.push(c)}
try{return JSON.parse(Buffer.concat(chunks).toString()||"{}")}catch(e){return {}}
}
function requireOwner(req,res){
const t=bearer(req)
if(!sessionValid(t)){sendJSON(res,401,{error:"Unauthorized"});return null}
return t
}

async function api(req,res){
const url=new URL(req.url,"http://x")
const p=url.pathname
res.setHeader("access-control-allow-origin","*")
res.setHeader("access-control-allow-headers","content-type,authorization")
res.setHeader("access-control-allow-methods","GET,POST,OPTIONS")
if(req.method==="OPTIONS"){res.writeHead(204);return res.end()}

if(p==="/api/status"){
const c=readConfig()
return sendJSON(res,200,{
ok:true,version:VERSION,build:BUILD,
uptime:Math.floor((Date.now()-metrics.startedAt)/1000),
requests:metrics.reqTotal,errors:metrics.errTotal,
sessions:metrics.wispNow,connectionsTotal:metrics.wispTotal,
maintenance:!!c.maintenance,ownerLogin:OWNER_CONFIGURED,
node:process.version,platform:process.platform
})
}
if(p==="/api/config"&&req.method==="GET")return sendJSON(res,200,publicConfig())

if(p==="/api/admin/login"&&req.method==="POST"){
const ip=clientIp(req)
const h=loginHits.get(ip)||{n:0,at:Date.now()}
if(Date.now()-h.at>LOGIN_WINDOW){h.n=0;h.at=Date.now()}
if(h.n>=LOGIN_MAX)return sendJSON(res,429,{error:"Too many attempts. Wait a few minutes."})
if(!OWNER_CONFIGURED)return sendJSON(res,503,{error:"Owner login is not configured on this server."})
const body=await readBody(req)
if(!verifyPassword(body.password||"")){
h.n++;loginHits.set(ip,h);logAction("login.fail",req)
return sendJSON(res,401,{error:"Incorrect password"})
}
loginHits.delete(ip)
const s=newSession();logAction("login.ok",req)
return sendJSON(res,200,{token:s.token,exp:s.exp})
}
if(p==="/api/admin/logout"&&req.method==="POST"){
const t=bearer(req);if(t){sessions.delete(t);logAction("logout",req)}
return sendJSON(res,200,{ok:true})
}
if(p==="/api/admin/session"){
const t=bearer(req)
return sendJSON(res,200,{ok:sessionValid(t),exp:sessions.get(t)||0})
}
if(p==="/api/admin/overview"){
if(!requireOwner(req,res))return
const c=readConfig()
return sendJSON(res,200,{
status:{version:VERSION,build:BUILD,uptime:Math.floor((Date.now()-metrics.startedAt)/1000),
requests:metrics.reqTotal,errors:metrics.errTotal,sessions:metrics.wispNow,connectionsTotal:metrics.wispTotal,
node:process.version,platform:process.platform,activeTokens:sessions.size},
traffic:metrics.perMin.slice(),
config:c,
log:readLog().slice(0,50)
})
}
if(p==="/api/admin/config"&&req.method==="POST"){
if(!requireOwner(req,res))return
const body=await readBody(req)
const c=readConfig()
const next=Object.assign({},c)
if(typeof body.siteName==="string")next.siteName=body.siteName.slice(0,60)
if(typeof body.announcement==="string")next.announcement=body.announcement.slice(0,280)
if(typeof body.maintenance==="boolean")next.maintenance=body.maintenance
if(typeof body.maintenanceMsg==="string")next.maintenanceMsg=body.maintenanceMsg.slice(0,280)
if(typeof body.theme==="string")next.theme=body.theme.slice(0,20)
if(body.features&&typeof body.features==="object")next.features=Object.assign({},c.features,body.features)
writeConfig(next)
const changed=Object.keys(body).filter(k=>k!=="password")
logAction("config.update",req,{fields:changed})
return sendJSON(res,200,{ok:true,config:next})
}
if(p==="/api/admin/log"){
if(!requireOwner(req,res))return
return sendJSON(res,200,{log:readLog().slice(0,200)})
}
sendJSON(res,404,{error:"Unknown endpoint"})
}

function serveStatic(req,res){
let p=decodeURIComponent(new URL(req.url,"http://x").pathname)
if(p==="/")p="/index.html"
if(p==="/app")p="/app.html"
if(p==="/admin")p="/admin.html"
for(const [pre,dir] of mounts){
if(!p.startsWith(pre))continue
const f=path.join(dir,path.normalize(p.slice(pre.length)))
if(!f.startsWith(dir)||!fs.existsSync(f)||fs.statSync(f).isDirectory())continue
res.writeHead(200,{"content-type":types[path.extname(f)]||"application/octet-stream","cache-control":"no-cache","access-control-allow-origin":"*"})
return fs.createReadStream(f).pipe(res)
}
res.writeHead(404,{"content-type":"text/plain"});res.end("Not found")
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
}catch(e){metrics.errTotal++;res.writeHead(502);res.end("Upstream error")}
}

const server=http.createServer((req,res)=>{
bump()
res.setHeader("access-control-allow-origin","*")
res.on("finish",()=>{if(res.statusCode>=500)metrics.errTotal++})
if(req.url.startsWith("/api/"))return api(req,res).catch(()=>{metrics.errTotal++;try{sendJSON(res,500,{error:"Server error"})}catch(e){}})
if(req.url.startsWith("/s3/"))return s3(req,res)
serveStatic(req,res)
})
server.on("upgrade",(req,socket,head)=>{
if(!req.url.startsWith("/wisp/"))return socket.destroy()
// maintenance mode genuinely stops proxying, except for the owner (valid token in ?owner=)
const c=readConfig()
if(c.maintenance){
const owner=new URL(req.url,"http://x").searchParams.get("owner")
if(!owner||!sessionValid(owner))return socket.destroy()
}
metrics.wispNow++;metrics.wispTotal++
socket.on("close",()=>{metrics.wispNow=Math.max(0,metrics.wispNow-1)})
wisp.routeRequest(req,socket,head)
})
server.keepAliveTimeout=65000
server.listen(PORT,()=>console.log("Candify V"+VERSION+" on "+PORT+(OWNER_CONFIGURED?" (owner login enabled)":" (owner login disabled — set OWNER_PASSWORD to enable /admin)")))
