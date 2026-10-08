// Candify host runner: starts the proxy server + a Cloudflare tunnel, and every time the
// tunnel URL changes it rebuilds ./dist and redeploys to Firebase — so your stable Firebase
// link (https://candify-64751.web.app) always points at the current backend. No manual steps.
//
// Run it with:  node host.js     (candify.bat does this for you)
const {spawn}=require("child_process")

const PORT=process.env.PORT||3001
const FIREBASE_URL="https://candify-64751.web.app"   // your stable link; stays the same forever
let lastUrl="", deploying=false

const log=m=>console.log("\x1b[35m[candify]\x1b[0m "+m)

// ---- 1. the proxy server, auto-restarting ----
function startServer(){
  const s=spawn("node",["server.js"],{env:{...process.env,PORT:String(PORT)},stdio:"inherit"})
  s.on("exit",c=>{log("server stopped (code "+c+") — restarting in 3s");setTimeout(startServer,3000)})
}

// ---- 2. the tunnel; on a new URL, rebuild + redeploy ----
function startTunnel(){
  log("starting Cloudflare tunnel…")
  const t=spawn("cloudflared",["tunnel","--url","http://localhost:"+PORT],{shell:true})
  const onData=d=>{
    const s=d.toString()
    process.stdout.write(s)
    const m=s.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)
    if(m&&m[0]!==lastUrl){lastUrl=m[0];sync(m[0])}
  }
  t.stdout.on("data",onData);t.stderr.on("data",onData)
  t.on("exit",c=>{log("tunnel stopped (code "+c+") — restarting in 3s");lastUrl="";setTimeout(startTunnel,3000)})
}

// ---- 3. point Firebase at the current tunnel ----
function sync(url){
  if(deploying)return
  deploying=true
  const wss=url.replace("https://","wss://")+"/wisp/"
  log("tunnel is up: "+url)
  log("pointing Firebase at this backend (rebuild + deploy)…")
  run("node",["build.js",wss],()=>{
    run("firebase",["deploy","--only","hosting"],code=>{
      deploying=false
      if(code===0)log("DONE ✓  share your link:  "+FIREBASE_URL)
      else log("firebase deploy failed (code "+code+"). If it says you're not logged in, run:  firebase login")
    })
  })
}
function run(cmd,args,done){
  const p=spawn(cmd,args,{stdio:"inherit",shell:true})
  p.on("exit",done)
  p.on("error",e=>{log(cmd+" failed to start: "+e.message);done(1)})
}

log("Candify host starting — keep this window open. Your link will be: "+FIREBASE_URL)
startServer()
startTunnel()
