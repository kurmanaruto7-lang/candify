// Builds a static copy of Candify in ./dist for hosts that can't run Node (Firebase, Azure, S3, etc.)
// Usage:
//   node build.js static                       no backend: sites shown in iframes only (limited)
//   node build.js wss://your-backend/wisp/      full proxy + owner dashboard (needs our Node server)
//   node build.js wss://xxx.workers.dev/        full proxy via a Cloudflare Workers Wisp server
//                                               (no PC needed; owner dashboard/status are disabled)
// A *.workers.dev URL (or adding "noapi" as a 2nd arg) builds in no-API mode: the proxy works but
// the owner dashboard, live status and maintenance mode are hidden, since those need our Node server.
const fs=require("fs"),path=require("path")
const arg=process.argv[2]
const isStatic=arg==="static"
const noApi=process.argv[3]==="noapi"||/\.workers\.dev\/?$/i.test(arg||"")
if(!isStatic&&!/^wss?:\/\//.test(arg||"")){console.log("Usage: node build.js static  |  node build.js wss://your-backend/wisp/  |  node build.js wss://xxx.workers.dev/");process.exit(1)}
const out=path.join(__dirname,"dist")
fs.mkdirSync(out,{recursive:true})
for(const f of fs.readdirSync(out))fs.rmSync(path.join(out,f),{recursive:true,force:true})
const nm=(...p)=>path.join(__dirname,"node_modules",...p)
fs.cpSync(path.join(__dirname,"public"),out,{recursive:true})
fs.cpSync(require("@titaniumnetwork-dev/ultraviolet").uvPath,path.join(out,"uv"),{recursive:true})
fs.cpSync(require("@mercuryworkshop/bare-mux/node").baremuxPath,path.join(out,"baremux"),{recursive:true})
fs.cpSync(nm("@mercuryworkshop","epoxy-transport","dist"),path.join(out,"epoxy"),{recursive:true})
// .mjs is often served with the wrong type by static hosts, so ship .js copies
fs.copyFileSync(path.join(out,"baremux","index.mjs"),path.join(out,"baremux","index.esm.js"))
fs.copyFileSync(path.join(out,"epoxy","index.mjs"),path.join(out,"epoxy","index.esm.js"))
for(const d of["uv","baremux","epoxy"])for(const f of fs.readdirSync(path.join(out,d)))if(f.endsWith(".map")||f.endsWith(".d.ts"))fs.rmSync(path.join(out,d,f))
fs.writeFileSync(path.join(out,"config.js"),`window.CANDIFY_WISP=${JSON.stringify(isStatic?"":arg)}
window.CANDIFY_STATIC=${isStatic}
window.CANDIFY_NOAPI=${noApi}
window.CANDIFY_ESM=".esm.js"
`)
console.log("Built ./dist -> upload its contents to your static host")
console.log(isStatic?"  mode: static (iframe only, no backend)":"  backend: "+arg)
if(noApi)console.log("  mode: no-API (Workers Wisp) — owner dashboard/status/maintenance are disabled")
else if(!isStatic)console.log("  note: /admin owner dashboard is served by our Node backend")
