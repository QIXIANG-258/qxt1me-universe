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

  /* ⚠️ 这条断言要小心：本徽标有一个**故意的**纵向位移 ——
     与页脚重叠时会抬升让位（见 ③b）。所以不能简单地断言「滚动前后 top 完全相同」，
     否则会把那个特性判成 bug（第一版就是这么误报的）。
     ⚠️ 还有一个坑：抬升带 .22s transition，滚动后**必须等它落定**再量，
        否则量到的是动画中间帧（实测 500ms 等待仍会读到 4px 的残留位移）。
     做法：轮询到「距底边偏移在两次采样间稳定」再取值。 */
  async function readPos() {
    return JSON.parse(await ev(`(function(){
      var v=document.getElementById('visits');var r=v.getBoundingClientRect();
      return JSON.stringify({top:Math.round(r.top), left:Math.round(r.left),
        bottomGap:Math.round(innerHeight-r.bottom), scrollY:Math.round(scrollY),
        absTop:Math.round(r.top+scrollY),
        lift:getComputedStyle(v).getPropertyValue('--visits-lift').trim()||'0px'});
    })()`));
  }
  async function settlePos() {
    let prev = null;
    for (let i = 0; i < 40; i++) {           // 最多 2s
      const cur = await readPos();
      if (prev && prev.top === cur.top && prev.bottomGap === cur.bottomGap) return cur;
      prev = cur;
      await sleep(50);
    }
    return await readPos();
  }

  await ev("window.scrollTo(0, 60); 1");
  const at60 = await settlePos();
  await ev("window.scrollTo(0, 90); 1");
  const at90 = await settlePos();
  console.log("    scrollY=" + at60.scrollY + ": 视口 top=" + at60.top + " 距底=" + at60.bottomGap +
              " 抬升=" + at60.lift + " 文档绝对=" + at60.absTop);
  console.log("    scrollY=" + at90.scrollY + ": 视口 top=" + at90.top + " 距底=" + at90.bottomGap +
              " 抬升=" + at90.lift + " 文档绝对=" + at90.absTop);
  ok(at90.scrollY > at60.scrollY, "两次采样间确实滚动了（否则断言无意义）",
     at60.scrollY + " → " + at90.scrollY);
  /* 抬升量相同 ⇒ 没有触发新的让位 ⇒ 两次的视口坐标应当完全一致 */
  ok(at60.lift === at90.lift,
     "两次采样的抬升量相同（说明这一段没有触发新的让位，可直接比较视口坐标）",
     at60.lift + " vs " + at90.lift);
  if (at60.lift === at90.lift) {
    ok(Math.abs(at90.top - at60.top) <= 1 && Math.abs(at90.left - at60.left) <= 1 &&
       Math.abs(at90.bottomGap - at60.bottomGap) <= 1,
       "★ 滚动 30px 后视口坐标不变（真的固定在视窗，不随滑动移动）",
       "距底 " + at60.bottomGap + "→" + at90.bottomGap);
    ok(Math.abs((at90.absTop - at60.absTop) - (at90.scrollY - at60.scrollY)) <= 2,
       "★ 相对文档的绝对位置随滚动等量变化（证明它没跟着文档走）",
       "绝对 " + at60.absTop + "→" + at90.absTop);
  }

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

  /* ③b 视觉层面：与页脚重叠时必须**让位**（抬到页脚之上），而不是消失。
     实测背景：1440×900 下文档高 1036 / 视口 900，页脚 footTop=869 一直在视窗里；
     徽标 [858,892] 与页脚 [869,1036] 相交 23px。若「相交就隐藏」，
     这个最常见尺寸就永远看不到徽标（第一版就是这么写的，探针抓到过）。 */
  await ev("window.scrollTo(0, document.body.scrollHeight); 1");
  await sleep(900);
  const liftState = await ev(`(function(){
    var v=document.getElementById('visits');
    var f=document.querySelector('.foot');
    var vr=v.getBoundingClientRect(), fr=f.getBoundingClientRect();
    return JSON.stringify({
      vTop:Math.round(vr.top), vBottom:Math.round(vr.bottom),
      fTop:Math.round(fr.top),
      opacity: parseFloat(getComputedStyle(v).opacity),
      lift: getComputedStyle(v).getPropertyValue('--visits-lift').trim() || '0px',
      overlapY: vr.bottom > fr.top && vr.top < fr.bottom,
      overlapX: vr.left < fr.right && vr.right > fr.left
    });
  })()`);
  const ls = JSON.parse(liftState);
  console.log("    滚到底：徽标 [" + ls.vTop + "," + ls.vBottom + "]  页脚 top=" + ls.fTop +
              "  抬升=" + ls.lift + "  opacity=" + ls.opacity);
  ok(!(ls.overlapX && ls.overlapY),
     "★ 滚到底时徽标与页脚不相交（让位生效，未盖住页脚）",
     JSON.stringify({ ox: ls.overlapX, oy: ls.overlapY }));
  ok(ls.vBottom <= ls.fTop,
     "★ 徽标底边在页脚顶边之上（真的抬上去了）",
     "vBottom=" + ls.vBottom + " <= fTop=" + ls.fTop);
  ok(ls.opacity > 0.85,
     "★ 让位方式是**抬升**而不是隐藏（滚到底仍可见）", "opacity=" + ls.opacity);

  /* 回到顶部：抬升量应当**按几何重新算**，而不是残留。
     ⚠️ 注意不能断言「归零」—— 1440×900 这个尺寸下文档高仅 1036px、视口 900px，
        页脚 nearly 一直在视窗里，所以滚回顶部**仍然需要抬升**（这是正确行为）。
        真正该断言的是：抬升后**不重叠**，且抬升量与几何自洽。 */
  await ev("window.scrollTo(0,0); 1");
  await sleep(900);
  const backState = await ev(`(function(){
    var v=document.getElementById('visits');
    var f=document.querySelector('.foot');
    var vr=v.getBoundingClientRect(), fr=f.getBoundingClientRect();
    return JSON.stringify({ bottom:Math.round(innerHeight-vr.bottom),
      vBottom:Math.round(vr.bottom), fTop:Math.round(fr.top),
      lift: getComputedStyle(v).getPropertyValue('--visits-lift').trim() || '0px',
      overlapY: vr.bottom > fr.top && vr.top < fr.bottom,
      opacity: parseFloat(getComputedStyle(v).opacity) });
  })()`);
  const bs = JSON.parse(backState);
  console.log("    滚回顶部：" + JSON.stringify(bs));
  ok(bs.opacity > 0.85, "滚回顶部后徽标可见", "opacity=" + bs.opacity);
  /* 有抬升就必须已经让开；没有抬升就必须本来就不重叠 —— 两者都算自洽 */
  const liftVal = parseFloat(bs.lift) || 0;
  ok(liftVal > 0 ? !bs.overlapY : true,
     "★ 抬升量与重叠状态自洽（抬了就一定不重叠）",
     "lift=" + bs.lift + " overlapY=" + bs.overlapY);
  ok(liftVal === 0 || Math.abs(bs.bottom - 14 - liftVal) <= 2,
     "★ 抬升量与实际位置一致（距底 = 14 + lift）",
     "距底=" + bs.bottom + " 应为 14+" + liftVal + "=" + (14 + liftVal));

  /* 另找一个「页脚不在视窗内」的尺寸，验抬升确实归零 */
  await send("Emulation.setDeviceMetricsOverride",
    { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await sleep(1000);
  const tall = JSON.parse(await ev(`(function(){
    var v=document.getElementById('visits');
    var f=document.querySelector('.foot');
    var vr=v.getBoundingClientRect(), fr=f.getBoundingClientRect();
    return JSON.stringify({ bottom:Math.round(innerHeight-vr.bottom),
      lift:getComputedStyle(v).getPropertyValue('--visits-lift').trim()||'0px',
      fTop:Math.round(fr.top), vh:innerHeight });
  })()`));
  console.log("    1280×800（页脚在折叠线下）：" + JSON.stringify(tall));
  ok((parseFloat(tall.lift) || 0) === 0 && Math.abs(tall.bottom - 14) <= 2,
     "★ 页脚不在视窗内时不抬升（回到 14px 基准位）",
     "距底=" + tall.bottom + " lift=" + tall.lift);

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
