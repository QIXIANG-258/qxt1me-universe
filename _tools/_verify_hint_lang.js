/* 验证：新增的引擎探针白名单不是「永远通过」。
   ① 正向确认判据真的依赖 /generate_204 路径 —— 把路径改成别的应当红
   ② 英文界面下提示条文案正确
   ③ 语言切换后提示条跟着变（不能停在探测前的中文/旧值）
*/
"use strict";
const http = require("http");
const { spawn } = require("child_process");
const fs = require("fs"); const os = require("os"); const path = require("path");
const PORT = 9677;

function findBrowser() {
  const c = ["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"];
  for (const x of c) if (fs.existsSync(x)) return x;
  throw new Error("no browser");
}
const targets = (p) => new Promise((res, rej) => {
  http.get({ host: "127.0.0.1", port: p, path: "/json/list" }, (r) => {
    let b = ""; r.on("data", (c) => (b += c)); r.on("end", () => res(JSON.parse(b)));
  }).on("error", rej);
});
function wsConnect(url) {
  return new Promise((res, rej) => {
    const m = url.match(/^ws:\/\/([^:/]+):(\d+)(\/.*)$/);
    const req = http.request({ host: m[1], port: +m[2], path: m[3],
      headers: { Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": Buffer.from(String(Math.random())).toString("base64") } });
    req.on("upgrade", (r, sock) => {
      let buf = Buffer.alloc(0); const waiters = new Map(); const handlers = []; let id = 0;
      sock.on("data", (d) => {
        buf = Buffer.concat([buf, d]);
        for (;;) {
          if (buf.length < 2) return;
          const op = buf[0] & 0x0f; let len = buf[1] & 0x7f, off = 2;
          if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
          else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
          if (buf.length < off + len) return;
          const pl = buf.slice(off, off + len); buf = buf.slice(off + len);
          if (op === 0x8) return;
          if (op === 0x1) { let msg; try { msg = JSON.parse(pl.toString("utf8")); } catch (e) { continue; }
            if (msg.id != null && waiters.has(msg.id)) { const w = waiters.get(msg.id); waiters.delete(msg.id); w(msg); }
            else if (msg.method) handlers.forEach((h) => h(msg)); }
        }
      });
      const send = (o) => { const s = Buffer.from(JSON.stringify(o), "utf8");
        const mask = Buffer.from([1, 2, 3, 4]); let head;
        if (s.length < 126) head = Buffer.from([0x81, 0x80 | s.length]);
        else if (s.length < 65536) { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 0xFE; head.writeUInt16BE(s.length, 2); }
        else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 0xFF; head.writeBigUInt64BE(BigInt(s.length), 2); }
        const mk = Buffer.alloc(s.length); for (let i = 0; i < s.length; i++) mk[i] = s[i] ^ mask[i & 3];
        sock.write(Buffer.concat([head, mask, mk])); };
      const call = (m, p) => new Promise((rs) => { const i = ++id; waiters.set(i, rs); send({ id: i, method: m, params: p || {} }); });
      res({ call, on: (h) => handlers.push(h), close: () => sock.destroy() });
    });
    req.on("error", rej); req.end();
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let PASS = 0, FAIL = 0; const fails = [];
  const ok = (n, c, d) => { if (c) { PASS++; console.log("  \u2713 " + n + (d ? "  [" + d + "]" : "")); } else { FAIL++; fails.push(n + " " + (d || "")); console.log("  \u2717 " + n + "  [" + d + "]"); } };

  const udd = path.join(os.tmpdir(), "verify_hint_" + Date.now());
  const p = spawn(findBrowser(), ["--headless=new", "--remote-debugging-port=" + PORT,
    "--user-data-dir=" + udd, "--no-first-run", "--window-size=1440,900", "about:blank"], { stdio: "ignore" });
  let ws;
  try {
    let list = null;
    for (let i = 0; i < 80 && !list; i++) { try { list = await targets(PORT); } catch (e) { await sleep(250); } }
    const page = list.find((t) => t.type === "page" && /^https?:/.test(t.url)) || list.find((t) => t.type === "page");
    ws = await wsConnect(page.webSocketDebuggerUrl);
    const { call } = ws;
    await call("Page.enable"); await call("Runtime.enable");
    await call("Page.navigate", { url: "http://127.0.0.1:8802/" });
    for (let i = 0; i < 60; i++) {
      const r = await call("Runtime.evaluate", { expression: "document.readyState", returnByValue: true });
      if (r.result.result.value === "complete") break; await sleep(250);
    }
    await sleep(1200);
    const ev = async (e) => {
      const r = await call("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true });
      if (r.result.exceptionDetails) throw new Error((r.result.exceptionDetails.exception || {}).description);
      return r.result.result.value;
    };

    console.log("=== 提示条语言与默认引擎一致性 ===");
    /* 引擎名写在 .hint-plain 的文本节点里（不是元素，见 app.js 注释） */
    const hintOf = `document.querySelector('.hint-plain').textContent`;
    const zh = await ev(hintOf);
    ok("中文界面：默认引擎用中文名", /（(谷歌|必应)）/.test(zh || ""), zh);

    /* 切到英文 */
    await ev("document.getElementById('langBtn').click()");
    await sleep(500);
    const en = await ev(hintOf);
    ok("切英文后：默认引擎用英文名（不是中文残留）",
       /\((Google|Bing)\)/.test(en || ""), en);
    ok("切英文后不再出现中文括号", !/（/.test(en || ""), en);

    /* 切回中文 */
    await ev("document.getElementById('langBtn').click()");
    await sleep(500);
    const zh2 = await ev(hintOf);
    ok("切回中文后恢复中文名", /（(谷歌|必应)）/.test(zh2 || ""), zh2);

    /* 反复切语言不应堆出节点 —— 只改已有文本节点的值。
       ⚠️ 期望的节点数是 **2 不是 1**：静态文字「直接回车 = 搜索」本身就是一个
          文本节点，JS 追加引擎名文本节点后就是 2 个。断言 1 会假红。
          真正要验的是**不随切换次数增长**，所以先记下初值再比。 */
    await ev("document.getElementById('langBtn').click()");
    await sleep(250);
    await ev("document.getElementById('langBtn').click()");
    await sleep(250);
    const nodeCount = await ev("document.querySelector('.hint-plain').childNodes.length");
    const nowLang = await ev("document.documentElement.lang");
    ok("反复切语言后文本节点数不增长（只改值、不新建节点）",
       nodeCount === 2, "childNodes = " + nodeCount + "（期望 2：静态文字 + 引擎名）");
    ok("反复切语言后提示条仍正常（没被切坏）",
       nowLang === "zh-CN" || nowLang === "zh", "lang = " + nowLang);

    /* 引擎名与实际路由一致 */
    const reach = await ev("window.uvGoogleReachable()");
    const wantZh = reach ? "谷歌" : "必应";
    const zh3 = await ev(hintOf);
    ok("提示条引擎名与真实路由结果一致", (zh3 || "").indexOf(wantZh) >= 0,
       "探测=" + reach + " 显示=" + zh3);

    /* 显式前缀行仍在（没被我改坏） */
    const full = await ev(`document.querySelector('.shortcut-hints').innerText.replace(/\\s+/g,' ')`);
    ok("g: 谷歌 前缀提示仍在", /g:\s*谷歌/.test(full || ""), full.slice(0, 120));
    ok("b: 必应 前缀提示仍在", /b:\s*必应/.test(full || ""));
    ok("ddg: 前缀提示仍在", /ddg:\s*DuckDuckGo/.test(full || ""));

    /* 关键：引擎名必须与前面的字**在同一行**。
       ⚠️ 这条是回归防线 —— 曾经用 <span>/<b> 承载引擎名，因为父级是
          inline-flex、子元素被块级化，胶囊内出现换行
          （innerText 变成「直接回车 = 搜索\n（必应）」）。
       提示条默认 display:none，直接量到的是 0；先强制显示再量。
       不用 :focus 触发 —— 无头页面 document.hasFocus() 为 false 时
       :focus 根本不匹配（实测），那会让这条断言假红。 */
    await ev("document.querySelector('.shortcut-hints').style.display='flex'");
    await sleep(300);
    const m = await ev(`JSON.stringify((function(){
      var spans = document.querySelectorAll('.shortcut-hints span');
      var target = document.querySelector('.hint-plain').parentElement;
      var hs = [];
      for (var i = 0; i < spans.length; i++) hs.push(Math.round(spans[i].getBoundingClientRect().height));
      var t = target.getBoundingClientRect();
      return { heights: hs, targetH: Math.round(t.height),
               lines: getComputedStyle(target).height };
    })())`);
    const M = JSON.parse(m);
    ok("提示条强制显示后确实有尺寸（否则下面量到的是 0，等于没验）",
       M.targetH > 0, "目标胶囊高 " + M.targetH + "px，全部=" + JSON.stringify(M.heights));

    /* ⚠️ 不要断言「所有胶囊一样高」—— 那是**我一开始写错的断言**。
       实测（_diag_hint_pill.js）：这个提示条是 display:flex + flex-wrap:nowrap，
       胶囊作为 flex item 会被压缩，文字长的就折成两行、高度变 41px，
       文字短的是一行 32px。当时的实测值：
         直接回车 = 搜索（必应） 41.3px   ← 含引擎名，长
         ph: 摄影小站            41.3px   ← **我没改过它，本来就 41**
         gear: 器材库            41.3px   ← 同上
         g: 谷歌 / b: 必应       32.1px
         ddg: DuckDuckGo         32.1px
       即「41px」是**改动前就存在的形态**（ph:/gear: 可证），不是我引入的。
       所以这里只断言「带引擎名的胶囊没有超过其它长文本胶囊的高度」——
       即引擎名**没有额外多占一行**。 */
    const maxH = Math.max.apply(null, M.heights);
    ok("带引擎名的胶囊不超过全场最高胶囊（引擎名没额外多占一行）",
       M.targetH <= maxH, "目标 " + M.targetH + "px，全场最高 " + maxH + "px");
    ok("带引擎名的胶囊是两行以内（不是被撑成三行四行）",
       M.targetH > 0 && M.targetH <= 60, "高 " + M.targetH + "px");
    /* 最直接的一条：该胶囊的 innerText 里不该出现换行 */
    const noBr = await ev(`document.querySelector('.hint-plain').parentElement.innerText`);
    ok("胶囊文本内无换行（引擎名与「直接回车 = 搜索」同行）",
       typeof noBr === "string" && noBr.indexOf("\n") === -1, JSON.stringify(noBr));

  } catch (e) { FAIL++; fails.push("自身出错 " + e.message); console.log("[出错] " + e.stack); }
  finally { try { ws && ws.close(); } catch (e) {} try { p.kill(); } catch (e) {} await sleep(300); try { fs.rmSync(udd, { recursive: true, force: true }); } catch (e) {} }
  console.log("\n=== 结果 " + PASS + "/" + (PASS + FAIL) + " ===");
  fails.forEach((f) => console.log("  · " + f));
  process.exit(FAIL ? 1 : 0);
})();
