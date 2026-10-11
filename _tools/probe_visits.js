/* 验左下角访客徽标的行为（对应作者三条要求：
     ① 固定在视窗、不随滚动移动
     ② 不挡住内容
     ③ 与网站风格搭配
   判据全部用几何与计算样式，不看截图观感。
   跑法：node _tools/probe_visits.js
   需要 wrangler dev 在 8799 跑着（它有 /api/visits）。 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");
const WebSocket = require("ws");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = Number(process.env.CDP_PORT || 9610);
const URL_ = process.env.PROBE_URL || "http://127.0.0.1:8799/";
const ONLINE = !/^http:\/\/(127\.0\.0\.1|localhost)/.test(URL_);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const fails = [];
function ok(c, n, e) {
  if (c) { pass++; console.log("  \u2713 " + n + (e ? "  [" + e + "]" : "")); }
  else { fail++; fails.push(n); console.log("  \u2717 " + n + (e ? "  \u2014 " + e : "")); }
}

(async () => {
  const args = ["--headless=new", "--disable-gpu", "--no-first-run", "--hide-scrollbars",
    "--remote-debugging-port=" + PORT,
    "--user-data-dir=" + fs.mkdtempSync(path.join(os.tmpdir(), "visits-")),
    "--window-size=1440,900"];
  args.push(ONLINE ? "--proxy-server=http://127.0.0.1:7897" : "--no-proxy-server");
  args.push("about:blank");
  const child = spawn(EDGE, args, { stdio: "ignore" });
  const cleanup = () => { try { child.kill(); } catch (e) {} };
  process.on("exit", cleanup);

  const wsUrl = await (async () => {
    for (let i = 0; i < 100; i++) {
      try {
        const list = await new Promise((resolve, reject) => {
          const rq = http.get({ host: "127.0.0.1", port: PORT, path: "/json/list" }, (x) => {
            let d = ""; x.on("data", (c) => (d += c)); x.on("end", () => resolve(JSON.parse(d))); });
          rq.on("error", reject); rq.setTimeout(1000, () => rq.destroy(new Error("t"))); });
        const p = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
        if (p) return p.webSocketDebuggerUrl;
      } catch (e) {}
      await sleep(250);
    }
    throw new Error("拿不到 CDP target");
  })();
  const ws = new WebSocket(wsUrl, { perMessageDeflate: false, maxPayload: 1 << 28 });
  await new Promise((res, rej) => { ws.on("open", res); ws.on("error", rej); });
  let id = 0; const wm = new Map();
  ws.on("message", (raw) => { let m; try { m = JSON.parse(raw.toString()); } catch (e) { return; }
    if (m.id && wm.has(m.id)) { wm.get(m.id)(m); wm.delete(m.id); } });
  const send = (method, params) => new Promise((res) => {
    const mid = ++id; wm.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params: params || {} })); });
  const ev = async (e) => {
    const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails)
      throw new Error("页面内异常：" + JSON.stringify(r.result.exceptionDetails).slice(0, 240));
    return r.result && r.result.result ? r.result.result.value : undefined;
  };

  await send("Page.enable", {}); await send("Runtime.enable", {});
  await send("Emulation.setDeviceMetricsOverride",
    { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: URL_ });
  for (let i = 0; i < 160; i++) {
    if (await ev("document.readyState==='complete' && !!document.querySelector('.boards')") === true) break;
    await sleep(200);
  }
  /* 等徽标真的出来（接口往返） */
  let shown = false;
  for (let i = 0; i < 60; i++) {
    shown = await ev("(function(){var v=document.getElementById('visits');return !!v && !v.hidden;})()");
    if (shown) break;
    await sleep(200);
  }

  console.log("=== 访客记录徽标验收 ===\n");
  console.log("── ① 出现与内容 ──");
  ok(shown, "徽标已显示（接口返回后取消 hidden）");
  const txt = await ev(`(function(){
    var v=document.getElementById('visits');
    return JSON.stringify({
      total: (document.getElementById('visits-total')||{}).textContent||'',
      label: (document.getElementById('visits-label')||{}).textContent||'',
      today: (document.getElementById('visits-today')||{}).textContent||'',
      title: v?v.getAttribute('title'):null,
      hasIcon: !!v.querySelector('.ico svg')
    });
  })()`);
  const t = JSON.parse(txt);
  console.log("    内容：" + JSON.stringify(t));
  ok(/^[\d,]+$/.test(t.total.trim()) && t.total.trim() !== "—",
     "数字是真实值（不是占位符 «—»）", t.total);
  ok(t.label.length > 0, "有单位标签（中文/英文随语言）", t.label);
  ok(t.hasIcon, "有线性图标（不是裸文字）");

  console.log("\n── ② 固定定位：不随滚动移动 ──");
  const posBefore = await ev(`(function(){
    var v=document.getElementById('visits');
    var cs=getComputedStyle(v), r=v.getBoundingClientRect();
    return JSON.stringify({pos:cs.position, left:Math.round(r.left), bottom:Math.round(innerHeight-r.bottom),
                           top:Math.round(r.top), absTop:Math.round(r.top+scrollY)});
  })()`);
  const pb = JSON.parse(posBefore);
  ok(pb.pos === "fixed", "CSS position 是 fixed", pb.pos);

  /* ★ 作者口径（2026-10-11 澄清）：「访问人数是固定在我们视角的，而不是网页上，
     相当于它不是网页上面的元素，而是我们滑动时在屏幕上的元素」。
     → 判据就是**全程在视口里一动不动**：任何滚动位置下 top/left/距底都必须相同。

     ⚠️ 这条断言的历史很值得留档，因为前后写错过两种相反的：
       · 更早的版本有「与页脚重叠时抬升让位」—— 那是**会移动**的（实测飘 136px），
         当时为了迁就它，断言被写成「只在抬升量不变的两点间比较」，
         等于**把错误的方向写进了判据**（判据迁就实现）。
       · 更早还有一版为了避开 .22s 过渡，写死 sleep(500)，读到动画中间帧。
     现在抬升逻辑已整体移除，位置纯由 CSS `position:fixed` 决定，
     所以可以恢复最严格、也最直白的判据：**逐档滚动，视口坐标极差必须为 0**。 */
  async function readPos() {
    return JSON.parse(await ev(`(function(){
      var v=document.getElementById('visits');var r=v.getBoundingClientRect();
      return JSON.stringify({top:Math.round(r.top), left:Math.round(r.left),
        right:Math.round(r.right),
        bottomGap:Math.round(innerHeight-r.bottom), scrollY:Math.round(scrollY),
        absTop:Math.round(r.top+scrollY)});
    })()`));
  }

  /* 沿整条滚动区间取多档（不是只取两点）—— 「固定在视角」要全程成立 */
  const maxScroll = await ev("Math.max(0, document.documentElement.scrollHeight - innerHeight)");
  const STEPS = 6;
  const samples = [];
  for (let i = 0; i <= STEPS; i++) {
    const y = Math.round(maxScroll * i / STEPS);
    await ev("window.scrollTo(0, " + y + "); 1");
    await sleep(350);
    samples.push(await readPos());
  }
  console.log("    可滚 " + maxScroll + "px，采 " + samples.length + " 档：");
  for (const s of samples) {
    console.log("      scrollY=" + String(s.scrollY).padStart(4) +
                "  视口 top=" + String(s.top).padStart(4) +
                "  距底=" + String(s.bottomGap).padStart(4) +
                "  文档绝对=" + s.absTop);
  }
  const tops = samples.map((s) => s.top);
  const gaps = samples.map((s) => s.bottomGap);
  const lefts = samples.map((s) => s.left);
  const spreadTop = Math.max(...tops) - Math.min(...tops);
  const spreadGap = Math.max(...gaps) - Math.min(...gaps);
  const spreadLeft = Math.max(...lefts) - Math.min(...lefts);
  ok(samples[samples.length - 1].scrollY > 0,
     "确实发生了滚动（否则这条断言没意义）",
     "最大 scrollY=" + samples[samples.length - 1].scrollY);
  ok(spreadTop === 0 && spreadGap === 0 && spreadLeft === 0,
     "★ 全程滚动中视口坐标**一动不动**（极差恒为 0 —— 真正固定在屏幕上）",
     "top极差=" + spreadTop + " 距底极差=" + spreadGap + " left极差=" + spreadLeft);
  /* 反向：相对文档的绝对位置必须随滚动等量变化 —— 证明它没跟着文档走 */
  const dAbs = samples[samples.length - 1].absTop - samples[0].absTop;
  const dScroll = samples[samples.length - 1].scrollY - samples[0].scrollY;
  ok(Math.abs(dAbs - dScroll) <= 2,
     "★ 相对文档的绝对位置随滚动等量变化（证明它没跟着文档走）",
     "绝对 " + samples[0].absTop + "→" + samples[samples.length - 1].absTop +
     "，scrollY " + samples[0].scrollY + "→" + samples[samples.length - 1].scrollY);

  console.log("\n── ③ 不挡住内容：两个层面都要验 ──");
  /* ③a 交互层面：徽标必须不吃鼠标事件（pointer-events:none），
         所以即使视觉重叠，下面的元素照样可点 */
  const pe = await ev("getComputedStyle(document.getElementById('visits')).pointerEvents");
  ok(pe === "none", "★ 徽标 pointer-events:none（鼠标事件穿透，不会让任何东西点不到）", pe);
  await ev("window.scrollTo(0,0); 1");
  await sleep(400);
  const thru = await ev(`(function(){
    var v=document.getElementById('visits');
    var r=v.getBoundingClientRect();
    /* 在徽标正中心取最上层元素 —— 因为 pointer-events:none，
       拿到的必须是**它下面的**元素，而不是它自己 */
    var el=document.elementFromPoint(Math.round(r.left+r.width/2), Math.round(r.top+r.height/2));
    return JSON.stringify({ hit: el ? (el.tagName+'.'+String(el.className||'').split(' ')[0]) : null,
                            isSelf: el===v || v.contains(el) });
  })()`);
  const th = JSON.parse(thru);
  console.log("    徽标中心点最上层元素：" + th.hit);
  ok(th.isSelf === false, "★ 鼠标命中的不是徽标本身（实测穿透生效）", JSON.stringify(th));

  /* ③b 滚到底时徽标确实会压到页脚 —— 这是**已知且接受**的取舍。
     作者口径（2026-10-11 澄清）：「访问人数是固定在我们视角的，而不是网页上，
     相当于它不是网页上面的元素，而是我们滑动时在屏幕上的元素」。
     所以**不再抬升让位**；重叠靠 `pointer-events:none` 保证「不影响点击」。

     ⚠️ 这一节历史上的断言是「抬升后与页脚不相交」—— 那是**按错误的实现写的判据**
        （判据迁就实现）。现在改成断言「位置不动 + 重叠不影响点击」，
        把取舍本身钉住：若有人想「顺手把重叠也修掉」，这些断言会提醒他
        那是**故意的**，修它就会破坏「固定」这个更本质的要求。 */
  await ev("window.scrollTo(0, document.body.scrollHeight); 1");
  await sleep(900);
  const ov = JSON.parse(await ev(`(function(){
    var v=document.getElementById('visits');
    var f=document.querySelector('.foot');
    var vr=v.getBoundingClientRect(), fr=f.getBoundingClientRect();
    return JSON.stringify({
      vTop:Math.round(vr.top), vBottom:Math.round(vr.bottom), vLeft:Math.round(vr.left),
      fTop:Math.round(fr.top),
      opacity: parseFloat(getComputedStyle(v).opacity),
      overlapY: vr.bottom > fr.top && vr.top < fr.bottom,
      overlapX: vr.left < fr.right && vr.right > fr.left,
      bottomGap: Math.round(innerHeight - vr.bottom),
      liftVar: getComputedStyle(v).getPropertyValue('--visits-lift').trim()
    });
  })()`));
  console.log("    滚到底：徽标 [" + ov.vTop + "," + ov.vBottom + "]  页脚 top=" + ov.fTop +
              "  距底=" + ov.bottomGap + "  opacity=" + ov.opacity);
  ok(ov.opacity > 0.85,
     "★ 滚到底时徽标**仍然可见**（不因与页脚重叠而隐藏）", "opacity=" + ov.opacity);
  ok(Math.abs(ov.bottomGap - 14) <= 1,
     "★ 滚到底时位置与页顶时**完全一致**（距底仍是 14px，没有为避让而移动）",
     "距底=" + ov.bottomGap);
  ok(ov.liftVar === "",
     "★ 已无抬升变量（--visits-lift 彻底移除；走回头路会在这里报红）",
     JSON.stringify(ov.liftVar));

  /* 重叠若存在，必须靠穿透保证可点 —— 这是取舍成立的前提 */
  if (ov.overlapX && ov.overlapY) {
    const clickable = JSON.parse(await ev(`(function(){
      var v=document.getElementById('visits');
      var vr=v.getBoundingClientRect();
      var f=document.querySelector('.foot');
      var fr=f.getBoundingClientRect();
      var x=Math.round(vr.left+vr.width/2);
      var y=Math.round(Math.max(vr.top+2, fr.top+2));
      var el=document.elementFromPoint(x,y);
      return JSON.stringify({ x:x, y:y, hitTag: el?el.tagName:null,
        hitInFoot: el ? !!el.closest('.foot') : false,
        hitIsBadge: el===v || v.contains(el) });
    })()`));
    console.log("    重叠区取点 (" + clickable.x + "," + clickable.y + ") 命中：" +
                clickable.hitTag);
    ok(clickable.hitIsBadge === false,
       "★ 重叠区鼠标命中的不是徽标（穿透生效 ⇒ 页脚照样可点，取舍成立）",
       JSON.stringify(clickable));
  } else {
    console.log("    （本尺寸下徽标与页脚不重叠；穿透已由 ③a 独立验过）");
  }

  /* 换一个更高的视口：位置必须**一模一样**（固定是相对视口底，与内容长度无关） */
  await send("Emulation.setDeviceMetricsOverride",
    { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await sleep(1000);
  const tall = JSON.parse(await ev(`(function(){
    var v=document.getElementById('visits');
    var vr=v.getBoundingClientRect();
    return JSON.stringify({ bottom:Math.round(innerHeight-vr.bottom),
      left:Math.round(vr.left),
      fTop:Math.round(document.querySelector('.foot').getBoundingClientRect().top),
      vh:innerHeight });
  })()`));
  console.log("    1280×800：" + JSON.stringify(tall));
  ok(Math.abs(tall.bottom - 14) <= 2 && Math.abs(tall.left - 14) <= 2,
     "★ 换视口后仍贴左下角 14px（固定相对视口，与内容长度无关）",
     "距底=" + tall.bottom + " left=" + tall.left);

  console.log("\n── ④ 与网站风格搭配：零彩度 + 令牌一致 ──");
  const style = await ev(`(function(){
    var v=document.getElementById('visits');
    var cs=getComputedStyle(v);
    function rgb(s){ var m=(s||'').match(/\\d+/g); return m?m.slice(0,3).map(Number):null; }
    var fg=rgb(cs.color);
    /* 零彩度：R/G/B 三通道极差必须很小 */
    var spread = fg ? Math.max.apply(null,fg)-Math.min.apply(null,fg) : 999;
    return JSON.stringify({ color:cs.color, spread:spread,
      font:cs.fontFamily.split(',')[0].replace(/"/g,''),
      radius:cs.borderRadius, bg:cs.backgroundColor,
      hasBlur: cs.backdropFilter!=='none' || cs.webkitBackdropFilter!=='none' });
  })()`);
  const st = JSON.parse(style);
  console.log("    " + JSON.stringify(st));
  ok(st.spread <= 12, "★ 文字零彩度（R/G/B 极差 ≤12，符合家族「界面零彩度」铁律）",
     "spread=" + st.spread);
  ok(st.font.indexOf("PingFang") >= 0 || st.font.indexOf("Microsoft YaHei") >= 0,
     "字族用的是家族 --f-cn", st.font);
  ok(st.hasBlur, "与「关于」弹窗同款毛玻璃（视觉语言一致）");

  console.log("\n── ⑤ 窄屏仍固定且可见 ──");
  await send("Emulation.setDeviceMetricsOverride",
    { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(900);
  const mob = await ev(`(function(){
    var v=document.getElementById('visits');
    if (v.hidden) return JSON.stringify({hidden:true});
    var cs=getComputedStyle(v), r=v.getBoundingClientRect();
    return JSON.stringify({pos:cs.position, left:Math.round(r.left),
      bottom:Math.round(innerHeight-r.bottom), w:Math.round(r.width),
      overflow: document.documentElement.scrollWidth > innerWidth+1,
      pe: cs.pointerEvents});
  })()`);
  const mb = JSON.parse(mob);
  console.log("    390px：" + JSON.stringify(mb));
  ok(!mb.hidden && mb.pos === "fixed", "窄屏仍是 fixed 且可见", JSON.stringify(mb));
  ok(Math.abs(mb.left - 10) <= 2 && Math.abs(mb.bottom - 10) <= 2,
     "窄屏贴左下角（10px 边距，与 CSS 媒体查询一致）",
     "left=" + mb.left + " bottom=" + mb.bottom);
  ok(!mb.overflow, "窄屏无横向溢出（徽标没有撑宽页面）");
  ok(mb.pe === "none", "窄屏同样不吃鼠标事件");

  console.log("\n通过 " + pass + " / " + (pass + fail));
  if (fail) console.log("失败项：\n - " + fails.join("\n - "));
  try { ws.close(); } catch (e) {}
  cleanup();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("探针异常：" + e.message); process.exit(2); });
