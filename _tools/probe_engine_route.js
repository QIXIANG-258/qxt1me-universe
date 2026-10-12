/* =========================================================
   probe_engine_route.js · 搜索引擎线路选择验收

   验收对象（2026-10-11 作者要求）：
     「搜索引擎默认是谷歌，不如两种线路，
      国内网络连接的会使用 bing，国外的用谷歌」

   即：默认引擎 = 按访客网络自动选。
     · 能直连 google  → Google
     · 直连不通        → 必应

   ⚠️ 这个探针**必须用真实浏览器**跑，不能用 curl 代替：
      判据是「浏览器里这个请求成不成功」，涉及 CORS、
      image 加载策略、以及浏览器自己的 DNS/代理设置。
      curl 通不代表浏览器通。

   探针不靠截图，全部是确定性断言：
     ① 路由判定函数在多组「可达性真值表」下给出规定的引擎
     ② 引擎表本身完整（g: / b: / ddg: 三个前缀都在）
     ③ 前缀优先于默认路由（显式 b: 不能被路由改写）
     ④ 判定失败时的兜底必须是 bing（国内网络是主场景）
     ⑤ 提示条上的默认项文案与实际默认引擎一致
     ⑥ 无障碍与零彩度未被破坏

   用法：
     node probe_engine_route.js                       # 打默认 http://127.0.0.1:8802/
     PROBE_URL=https://universe.qxt1me.dpdns.org/ node probe_engine_route.js
   ========================================================= */
"use strict";

const http = require("http");
const https = require("https");
const path = require("path");

const URL_ = process.env.PROBE_URL || "http://127.0.0.1:8802/";

/* ---- 极简 CDP：不引外部依赖（与本站其它探针同一套写法）---- */
function cdpTargets(port) {
  return new Promise((res, rej) => {
    http.get({ host: "127.0.0.1", port, path: "/json/list" }, (r) => {
      let b = ""; r.on("data", (c) => (b += c));
      r.on("end", () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
    }).on("error", rej);
  });
}

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");

/* 找 Edge / Chrome 可执行文件（与家族其它探针一致，写多个候选而不是写死一个） */
function findBrowser() {
  const cands = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
  ];
  for (const c of cands) if (fs.existsSync(c)) return c;
  throw new Error("找不到 Edge / Chrome，候选都试过了：" + cands.join(" | "));
}

const PORT = 9461 + Math.floor(Math.random() * 90);

function launch() {
  const exe = findBrowser();
  const udd = path.join(os.tmpdir(), "probe_engine_route_" + Date.now());
  const p = spawn(exe, [
    "--headless=new",
    "--remote-debugging-port=" + PORT,
    "--user-data-dir=" + udd,
    "--no-first-run", "--no-default-browser-check",
    "--disable-extensions", "--disable-sync",
    "--window-size=1440,900",
    "about:blank"
  ], { stdio: "ignore", detached: false });
  return { p, udd };
}

async function waitPort(ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const l = await cdpTargets(PORT); if (l && l.length) return l; } catch (e) {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("浏览器调试端口没起来（" + ms + "ms）");
}

/* ---- WebSocket 极简客户端（CDP 用）---- */
function wsConnect(url) {
  return new Promise((res, rej) => {
    const m = url.match(/^ws:\/\/([^:/]+):(\d+)(\/.*)$/);
    if (!m) return rej(new Error("bad ws url " + url));
    const req = http.request({
      host: m[1], port: +m[2], path: m[3],
      headers: {
        Connection: "Upgrade", Upgrade: "websocket",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": Buffer.from(String(Math.random())).toString("base64")
      }
    });
    req.on("upgrade", (r, sock) => {
      let buf = Buffer.alloc(0);
      const waiters = new Map();
      let id = 0;
      sock.on("data", (d) => {
        buf = Buffer.concat([buf, d]);
        for (;;) {
          if (buf.length < 2) return;
          const fin = (buf[0] & 0x80) !== 0;
          const op = buf[0] & 0x0f;
          let len = buf[1] & 0x7f, off = 2;
          if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
          else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
          if (buf.length < off + len) return;
          const payload = buf.slice(off, off + len);
          buf = buf.slice(off + len);
          if (op === 0x8) return;
          if (op === 0x1 && fin) {
            let msg; try { msg = JSON.parse(payload.toString("utf8")); } catch (e) { continue; }
            if (msg.id != null && waiters.has(msg.id)) {
              const w = waiters.get(msg.id); waiters.delete(msg.id); w(msg);
            }
          }
        }
      });
      const send = (obj) => {
        const s = Buffer.from(JSON.stringify(obj), "utf8");
        const mask = Buffer.from([1, 2, 3, 4]);
        let head;
        if (s.length < 126) head = Buffer.from([0x81, 0x80 | s.length]);
        else if (s.length < 65536) { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 0xFE; head.writeUInt16BE(s.length, 2); }
        else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 0xFF; head.writeBigUInt64BE(BigInt(s.length), 2); }
        const masked = Buffer.alloc(s.length);
        for (let i = 0; i < s.length; i++) masked[i] = s[i] ^ mask[i & 3];
        sock.write(Buffer.concat([head, mask, masked]));
      };
      const call = (method, params) => new Promise((rs) => {
        const i = ++id; waiters.set(i, rs); send({ id: i, method, params: params || {} });
      });
      res({ call, close: () => sock.destroy() });
    });
    req.on("error", rej);
    req.end();
  });
}

/* ---- 断言框架 ---- */
let PASS = 0, FAIL = 0;
const FAILS = [];
function ok(name, cond, detail) {
  if (cond) { PASS++; console.log("  \u2713 " + name + (detail ? "  [" + detail + "]" : "")); }
  else { FAIL++; FAILS.push(name + (detail ? "  [" + detail + "]" : "")); console.log("  \u2717 " + name + (detail ? "  [" + detail + "]" : "")); }
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

(async () => {
  console.log("=== 搜索引擎线路选择探针 ===");
  console.log("目标：" + URL_);

  const { p, udd } = launch();
  let ws;
  try {
    const list = await waitPort(20000);
    const page = list.find((t) => t.type === "page") || list[0];
    ws = await wsConnect(page.webSocketDebuggerUrl);
    const call = ws.call;

    await call("Page.enable");
    await call("Runtime.enable");
    await call("Page.navigate", { url: URL_ });
    /* 等就绪：两段式（先等 load，再等目标选择器） */
    for (let i = 0; i < 60; i++) {
      const r = await call("Runtime.evaluate", { expression: "document.readyState", returnByValue: true });
      if (r.result && r.result.result && r.result.result.value === "complete") break;
      await sleep(250);
    }
    for (let i = 0; i < 40; i++) {
      const r = await call("Runtime.evaluate", {
        expression: "!!document.getElementById('searchInput')", returnByValue: true
      });
      if (r.result && r.result.result && r.result.result.value === true) break;
      await sleep(250);
    }

    const ev = async (expr) => {
      const r = await call("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.result && r.result.exceptionDetails) {
        throw new Error("页面内异常: " + JSON.stringify(r.result.exceptionDetails.exception || r.result.exceptionDetails));
      }
      return r.result && r.result.result ? r.result.result.value : undefined;
    };

    /* ---------- ① 路由判定：真值表 ---------- */
    console.log("\n--- 1. 路由判定真值表 ---");
    const routeExists = await ev("typeof window.uvEngineFor === 'function'");
    ok("页面暴露了路由判定函数 uvEngineFor()", routeExists === true, "typeof = " + routeExists);

    if (routeExists === true) {
      /* [google 可达?, 期望引擎] */
      const cases = [
        [true, "google", "能直连 google → 用 Google"],
        [false, "bing", "直连不通 → 用必应（国内主场景）"]
      ];
      for (const [reachable, want, label] of cases) {
        const got = await ev("window.uvEngineFor(" + reachable + ")");
        ok(label, got === want, "uvEngineFor(" + reachable + ") = " + got + "，期望 " + want);
      }
      /* 非布尔输入 / undefined 也必须落到 bing，不能落 google */
      for (const bad of ["undefined", "null"]) {
        const got = await ev("window.uvEngineFor(" + bad + ")");
        ok("输入 " + bad + " 时兜底为 bing", got === "bing", "得到 " + got);
      }
    }

    /* ---------- ② 引擎表完整 ---------- */
    console.log("\n--- 2. 引擎前缀表 ---");
    const engines = await ev("JSON.stringify(window.uvEngines || null)");
    ok("页面暴露了引擎表 uvEngines", engines && engines !== "null", engines || "null");
    if (engines && engines !== "null") {
      const E = JSON.parse(engines);
      ok("g: → google.com/search", /google\.com\/search/.test(E["g:"] || ""), E["g:"]);
      ok("b: → bing.com/search", /bing\.com\/search/.test(E["b:"] || ""), E["b:"]);
      ok("ddg: → duckduckgo", /duckduckgo\.com/.test(E["ddg:"] || ""), E["ddg:"]);
    }

    /* ---------- ③ 前缀优先于默认路由 ---------- */
    console.log("\n--- 3. 显式前缀优先（不被默认路由改写）---");
    const forcedGoogle = await ev("window.uvResolve('g: 摄影')");
    ok("「g: 摄影」强制走 Google（无视网络）",
       typeof forcedGoogle === "string" && /google\.com\/search\?q=/.test(forcedGoogle),
       forcedGoogle);
    const forcedBing = await ev("window.uvResolve('b: 摄影')");
    ok("「b: 摄影」强制走必应（无视网络）",
       typeof forcedBing === "string" && /bing\.com\/search\?q=/.test(forcedBing),
       forcedBing);

    /* ---------- ④ 默认路由实际值 ---------- */
    console.log("\n--- 4. 本机默认路由（真实探测结果）---");
    const probed = await ev("window.uvGoogleReachable()");
    ok("可达性探测有确定布尔结果（不是 undefined）",
       probed === true || probed === false, "uvGoogleReachable() = " + probed);
    const def = await ev("window.uvDefaultEngine()");
    const wantDef = probed === true ? "google" : "bing";
    ok("默认引擎 = 按探测结果路由", def === wantDef,
       "探测=" + probed + " → 默认=" + def + "（期望 " + wantDef + "）");

    /* 无前缀搜索应落到默认引擎 */
    const plain = await ev("window.uvResolve('摄影')");
    const wantHost = probed === true ? /google\.com/ : /bing\.com/;
    ok("无前缀搜索走默认引擎", wantHost.test(plain || ""), plain);

    /* ---------- ⑤ 提示条文案 ---------- */
    console.log("\n--- 5. 提示条与实际默认一致 ---");
    const hintTxt = await ev(`(function(){
      var h = document.querySelector('.shortcut-hints');
      return h ? h.innerText.replace(/\\s+/g,' ') : null;
    })()`);
    ok("提示条存在", !!hintTxt, hintTxt ? hintTxt.slice(0, 90) : "null");
    /* 引擎名是 .hint-plain 里的文本节点（不是元素，见 app.js 的注释）。
       ⚠️ 变量名别叫 plain —— 上面第 4 组已经有一个同名的放了「无前缀搜索结果」。 */
    const engineName = await ev(`(function(){
      var e = document.querySelector('.hint-plain');
      return e ? e.textContent : null;
    })()`);
    ok("提示条上有「直接回车」的引擎名（.hint-plain）", !!engineName, JSON.stringify(engineName));
    if (hintTxt) {
      const saysGoogle = /Google|谷歌/i.test(hintTxt);
      const saysBing = /必应|Bing/.test(hintTxt);
      ok("提示条写明了「直接回车」用的引擎",
         saysGoogle || saysBing, "提到 google=" + saysGoogle + " bing=" + saysBing);
      /* 若默认是 bing，提示条不该只提 google 而不提 bing */
      if (probed === false) {
        ok("默认=必应时，提示条不能仍宣称默认是 Google", saysBing, "提到必应=" + saysBing);
      }
    }
    /* 引擎名必须与前面的字在同一行（曾经被块级化成两行） */
    const inline = await ev(`(function(){
      var e = document.querySelector('.hint-plain');
      if (!e) return 'no-node';
      var t = e.parentElement.innerText;
      return t.indexOf('\\n') === -1 ? '' : ('出现换行: ' + JSON.stringify(t));
    })()`);
    ok("胶囊内无换行（引擎名与「直接回车 = 搜索」同行）", inline === "", inline || "(同行)");

    /* ---------- ⑥ 零彩度 / 无障碍未被破坏 ---------- */
    console.log("\n--- 6. 风格与无障碍回归 ---");
    const chroma = await ev(`(function(){
      var bad = [];
      document.querySelectorAll('.shortcut-hints span, .search-input').forEach(function(el){
        var c = getComputedStyle(el).color;
        var m = c.match(/rgba?\\(([^)]+)\\)/);
        if (!m) return;
        var p = m[1].split(',').map(function(x){return parseFloat(x);});
        if (p.length >= 3 && Math.abs(p[0]-p[1]) > 6 || Math.abs(p[1]-p[2]) > 6) bad.push(el.className + ':' + c);
      });
      return bad.join(' | ');
    })()`);
    ok("提示条与搜索框仍为零彩度（不引强调色）", chroma === "", chroma || "(无彩色)");

    const ariaOk = await ev(`(function(){
      var i = document.getElementById('searchInput');
      return !!(i && i.getAttribute('aria-label'));
    })()`);
    ok("搜索框仍有 aria-label", ariaOk === true);

    /* 提示条里若新增了「默认」标记，必须不破坏布局（不横向溢出） */
    const overflow = await ev(`(function(){
      var h = document.querySelector('.shortcut-hints');
      if (!h) return 'no-hints';
      var r = h.getBoundingClientRect();
      return (r.right > innerWidth + 1 || r.left < -1) ? ('溢出 ' + Math.round(r.left) + '..' + Math.round(r.right) + ' vw=' + innerWidth) : '';
    })()`);
    ok("提示条未横向溢出视口", overflow === "", overflow || "(未溢出)");

  } catch (e) {
    FAIL++;
    FAILS.push("探针自身出错: " + e.message);
    console.log("\n[探针自身出错] " + e.stack);
  } finally {
    try { if (ws) ws.close(); } catch (e) {}
    try { p.kill(); } catch (e) {}
    await sleep(300);
    try { fs.rmSync(udd, { recursive: true, force: true }); } catch (e) {}
  }

  console.log("\n=== 结果 " + PASS + "/" + (PASS + FAIL) + " ===");
  if (FAILS.length) {
    console.log("未通过：");
    FAILS.forEach((f) => console.log("  · " + f));
  }
  process.exit(FAIL > 0 ? 1 : 0);
})();
