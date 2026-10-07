/* 量「文字在视口里的真实纵向位置」—— 决定浅色主题每个渐变停靠点该多亮。 */
"use strict";
const { spawn } = require("child_process");
const fs = require("fs"); const os = require("os"); const path = require("path");
const http = require("http"); const WebSocket = require("ws");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9451;
const URL_ = process.env.PROBE_URL || "http://127.0.0.1:8802/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const W = 1280, H = 800;
  const child = spawn(EDGE, ["--headless=new","--disable-gpu","--no-first-run","--hide-scrollbars",
    "--remote-debugging-port="+PORT,
    "--user-data-dir="+fs.mkdtempSync(path.join(os.tmpdir(),"uv-pos-")),
    "--window-size="+W+","+H, "about:blank"], { stdio: "ignore" });
  const wsUrl = await (async () => {
    for (let i=0;i<80;i++){ try{
      const list = await new Promise((res,rej)=>{const r=http.get({host:"127.0.0.1",port:PORT,path:"/json/list"},x=>{let d="";x.on("data",c=>d+=c);x.on("end",()=>res(JSON.parse(d)))});r.on("error",rej);r.setTimeout(1000,()=>r.destroy(new Error("t")))});
      const p=list.find(t=>t.type==="page"&&t.webSocketDebuggerUrl); if(p) return p.webSocketDebuggerUrl;
    }catch(e){} await sleep(250);} throw new Error("no target");
  })();
  const ws = new WebSocket(wsUrl,{perMessageDeflate:false});
  let id=0; const pend=new Map();
  ws.on("message",raw=>{const m=JSON.parse(raw.toString()); if(m.id&&pend.has(m.id)){const p=pend.get(m.id);pend.delete(m.id);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result)}});
  await new Promise((res,rej)=>{ws.on("open",res);ws.on("error",rej)});
  const send=(m,p)=>new Promise((res,rej)=>{const i=++id;pend.set(i,{resolve:res,reject:rej});ws.send(JSON.stringify({id:i,method:m,params:p||{}}))});
  const ev=async e=>{const r=await send("Runtime.evaluate",{expression:e,returnByValue:true,awaitPromise:true}); if(r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0,150)); return r.result.value};
  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride",{width:W,height:H,deviceScaleFactor:1,mobile:false});
  await send("Page.navigate",{url:URL_});
  for(let i=0;i<60;i++){const st=await ev(`({r:document.readyState,s:!!document.querySelector('#scene.is-ready')})`); if(st.r==="complete"&&st.s) break; await sleep(250);}
  await sleep(1200);

  const info = await ev(`(() => {
    const vh = window.innerHeight;
    const out = { vh, gradient: 'sky-top 0% / sky-mid 38% / sky-horizon 62% / ground 80-100%', els: [] };
    const pick = (sel, who) => { const e = document.querySelector(sel); if (!e) return;
      const r = e.getBoundingClientRect();
      out.els.push({ who, sel, top: +(r.top/vh*100).toFixed(1), bottom: +(r.bottom/vh*100).toFixed(1),
                     mid: +((r.top+r.height/2)/vh*100).toFixed(1),
                     fs: parseFloat(getComputedStyle(e).fontSize),
                     color: getComputedStyle(e).color }); };
    pick('#clockTime','时钟'); pick('#clockDate','日期');
    pick('.foot-name','页脚名'); pick('.foot-note','页脚小字');
    pick('.social-container','站点卡片'); pick('#weather','天气');
    return out; })()`);

  console.log("  视口高 " + info.vh + "px");
  console.log("  渐变：" + info.gradient + "\n");
  console.log("  " + "元素".padEnd(12) + "占视口纵向区间".padEnd(20) + "中心".padEnd(9) + "字号");
  console.log("  " + "-".repeat(58));
  for (const e of info.els) {
    console.log("  " + e.who.padEnd(12) + `${e.top}% – ${e.bottom}%`.padEnd(20) + (e.mid+"%").padEnd(9) + e.fs + "px");
  }
  try { child.kill(); } catch(e){}
})().catch(e=>{console.error("[出错] "+(e.stack||e));process.exit(2)});
