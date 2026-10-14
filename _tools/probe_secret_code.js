/* 神秘码 + 设置弹窗验收探针（2026-10-14）
 *
 * 验的不是「代码写了」，而是**用户真的能用**：
 *   ① 首帧未解锁时 gis 入口不显现（含「不占位」—— nav 高度不受影响）
 *   ② 齿轮按钮能打开设置弹窗，三条关闭路径都通
 *   ③ 错码 → 灰阶提示、不解锁
 *   ④ 对码 → 解锁 + 持久化
 *   ⑤ **刷新手还在**（这是持久化的真判据，不是看 localStorage 有没有值）
 *   ⑥ 浅色/深色两档下，新 UI 的文字对比度都 ≥ 4.5
 *   ⑦ 中英切换后设置面板文案跟着变
 *   ⑧ 390px 窄屏下不溢出
 *
 * ⚠️ 用真 CDP，不用 jsdom：localStorage / 首帧内联脚本 / 布局真假
 *    这三件事在 jsdom 里全是假的，测了等于没测。
 */
const CDP = require("child_process");
const http = require("http");
const path = require("path");
const WS = require("ws");

const PORT = process.env.PROBE_PORT || "8802";
const URL_ = process.env.PROBE_URL || ("http://127.0.0.1:" + PORT + "/");
const DEBUG_PORT = parseInt(process.env.PROBE_CDP || "9398", 10);

const EDGE = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
];

let pass = 0, fail = 0;
const failures = [];

function ok(cond, name, extra) {
  const c = !!cond;
  if (c) { pass++; console.log("  ✓ " + name); }
  else {
    fail++;
    console.log("  ✗ " + name + (extra === undefined ? "" : "  [" + extra + "]"));
    failures.push(name);
  }
}

function findBrowser() {
  const fs = require("fs");
  for (const p of EDGE) { try { if (fs.existsSync(p)) return p; } catch (e) {} }
  return null;
}

function getJSON(url) {
  return new Promise((res, rej) => {
    http.get(url, r => {
      let d = "";
      r.on("data", c => (d += c));
      r.on("end", () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    }).on("error", rej);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitFor(fn, ms, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if (await fn()) return true; } catch (e) {}
    await sleep(120);
  }
  throw new Error("timeout waiting for " + label);
}

class Client {
  constructor(ws) { this.ws = ws; this.id = 0; this.waiting = new Map(); }
  static async connect(url) {
    const ws = new WS(url, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
    await new Promise((res, rej) => { ws.on("open", res); ws.on("error", rej); });
    const c = new Client(ws);
    ws.on("message", buf => {
      let m; try { m = JSON.parse(buf.toString()); } catch (e) { return; }
      if (m.id && c.waiting.has(m.id)) {
        const w = c.waiting.get(m.id); c.waiting.delete(m.id);
        m.error ? w.rej(new Error(JSON.stringify(m.error))) : w.res(m.result);
      }
    });
    return c;
  }
  send(method, params) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.waiting.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
      setTimeout(() => {
        if (this.waiting.has(id)) { this.waiting.delete(id); rej(new Error("cdp timeout: " + method)); }
      }, 45000);
    });
  }
  async ev(expr) {
    const r = await this.send("Runtime.evaluate", {
      expression: expr, returnByValue: true, awaitPromise: true
    });
    if (r.exceptionDetails) throw new Error("page error: " + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
    return r.result.value;
  }
}

/* 对比度：与标准 WCAG 公式逐字一致（和 probe_universe.js 同一套） */
const CONTRAST_FN = `
function _lin(v){v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);}
function _lum(c){return 0.2126*_lin(c[0])+0.7152*_lin(c[1])+0.0722*_lin(c[2]);}
function _con(a,b){var l1=_lum(a),l2=_lum(b);if(l1<l2){var t=l1;l1=l2;l2=t;}return (l1+0.05)/(l2+0.05);}
function _rgb(s){var m=/rgba?\\(([^)]+)\\)/.exec(s);if(!m)return null;
  var p=m[1].split(",").map(function(x){return parseFloat(x)});
  if(p.length>3&&p[3]===0)return null;return [p[0],p[1],p[2]];}
`;

(async () => {
  const exe = findBrowser();
  if (!exe) { console.log("ENV-FAIL: no browser found"); process.exit(2); }

  const userDir = path.join(process.env.TEMP || ".", "universe_secret_probe_" + Date.now());
  const args = [
    "--headless=new",
    "--remote-debugging-port=" + DEBUG_PORT,
    "--user-data-dir=" + userDir,
    "--no-first-run", "--no-default-browser-check",
    "--disable-extensions", "--disable-gpu",
    "--window-size=1440,900",
    "about:blank"
  ];
  if (process.env.PROXY) args.push("--proxy-server=" + process.env.PROXY);
  const child = CDP.spawn(exe, args, { stdio: "ignore" });

  let cdp = null;
  try {
    await waitFor(async () => {
      const v = await getJSON("http://127.0.0.1:" + DEBUG_PORT + "/json/version");
      return !!v.webSocketDebuggerUrl;
    }, 20000, "cdp endpoint");

    const ver = await getJSON("http://127.0.0.1:" + DEBUG_PORT + "/json/version");
    cdp = await Client.connect(ver.webSocketDebuggerUrl);
    const t = await cdp.send("Target.createTarget", { url: "about:blank" });
    const sess = await Client.connect(
      "ws://127.0.0.1:" + DEBUG_PORT + "/devtools/page/" + t.targetId);
    await sess.send("Page.enable");
    await sess.send("Runtime.enable");

    async function goto(url) {
      await sess.send("Page.navigate", { url });
      await sleep(1600);
    }
    async function evalIn(expr) { return await sess.ev(expr); }

    console.log("\n=== 神秘码 / 设置面板探针 ===\nURL: " + URL_ + "\n");

    /* ---------- 1. 首帧：未解锁 ---------- */
    console.log("[1] 未解锁时的首帧状态");
    await goto(URL_);
    await evalIn("try{localStorage.clear()}catch(e){}");
    await goto(URL_);

    /* ⚠️ 选择器必须用 `nav.container.social-container:not(.ext-container):not(.git-container)`
       ——「站点」板块那个 nav **自己**就是 .container，而它内部还嵌着另外两个
       .container nav（外站 / 仓库）。写成 `.container nav`（后代选择器）会命中
       **里面那两个**，量到的高度永远不变，于是「解锁后导航变高」必然假红。
       这里改用 :scope 语义的精确选择器，见 issues 里的教训。 */
    const SITES_NAV = "nav.container.social-container:not(.ext-container):not(.git-container)";

    let r = await evalIn(`(() => {
      var g = document.getElementById('gisEntry');
      var cs = g ? getComputedStyle(g) : null;
      var nav = document.querySelector('${SITES_NAV}');
      return {
        exists: !!g,
        hasHidden: g ? g.hasAttribute('hidden') : null,
        display: cs ? cs.display : null,
        rectH: g ? g.getBoundingClientRect().height : null,
        kidsH: nav ? [].slice.call(nav.children).reduce(function(a,c){
          return a + c.getBoundingClientRect().height; }, 0) : null,
        htmlGis: document.documentElement.getAttribute('data-gis'),
        navText: nav ? nav.innerText : null
      };
    })()`);

    ok(r.exists, "gis 入口在 DOM 里存在（只是被藏起来）");
    ok(r.hasHidden, "gis 入口带 hidden 属性");
    /* ★ 核心：.container a 是 display:flex，UA 的 [hidden] 会被它盖掉。
       这里必须量到 display:none —— 量到 flex 就说明那条 [hidden] 规则没生效。 */
    ok(r.display === "none", "gis 入口 display 真的是 none（不是被 flex 盖掉）", "got " + r.display);
    ok(r.rectH === 0, "gis 入口不占任何高度", "h=" + r.rectH);
    ok(r.navText && r.navText.indexOf("gis") === -1 && r.navText.indexOf("地理图集") === -1,
       "导航文字里读不到 gis（对外人完全不显现）");
    ok(r.htmlGis === null, "未解锁时 html 上没有 data-gis");

    /* 未解锁时站点卡片的子元素总高，用于和解锁后对比 */
    const kidsH_locked = r.kidsH;

    /* ---------- 2. 齿轮按钮打开设置 ---------- */
    console.log("\n[2] 齿轮按钮 / 设置弹窗开关");
    r = await evalIn(`(() => {
      var b = document.getElementById('settingsBtn');
      var m = document.getElementById('settingsModal');
      return { btn: !!b, modal: !!m, hiddenBefore: m.hidden,
               ariaHasPopup: b.getAttribute('aria-haspopup'),
               ariaControls: b.getAttribute('aria-controls'),
               label: b.getAttribute('aria-label'),
               displayBefore: getComputedStyle(m).display };
    })()`);
    ok(r.btn, "齿轮按钮存在");
    ok(r.modal, "设置弹窗存在");
    ok(r.hiddenBefore === true, "初始时设置弹窗是 hidden");
    ok(r.displayBefore === "none", "初始时设置弹窗 display 是 none", "got " + r.displayBefore);
    ok(r.ariaHasPopup === "dialog", "齿轮按钮声明 aria-haspopup=dialog");
    ok(r.ariaControls === "settingsModal", "齿轮按钮 aria-controls 指向弹窗");
    ok(!!r.label, "齿轮按钮有无障碍名（aria-label）");

    /* 点开 */
    await evalIn("document.getElementById('settingsBtn').click()");
    await sleep(350);
    r = await evalIn(`(() => {
      var m = document.getElementById('settingsModal');
      var i = document.getElementById('secretInput');
      return { hidden: m.hidden, display: getComputedStyle(m).display,
               focused: document.activeElement ? document.activeElement.id : null,
               inputType: i.type, autocomplete: i.getAttribute('autocomplete'),
               inForm: !!i.closest('form'),
               msgEmpty: document.getElementById('secretMsg').textContent === '',
               msgDisplay: getComputedStyle(document.getElementById('secretMsg')).display };
    })()`);
    ok(r.hidden === false, "点击后弹窗打开");
    ok(r.display !== "none", "打开后弹窗可见");
    ok(r.focused === "secretInput", "打开后焦点自动落在输入框", "focus=" + r.focused);
    ok(r.inputType === "text", "输入框是 text 而不是 password（彩蛋不是登录框）");
    ok(r.autocomplete === "off", "输入框关掉了自动填充提示（不弹密码管理器）");
    ok(r.inForm === false, "输入框不在 <form> 里（回车不会刷新页面）");
    ok(r.msgEmpty, "初始时反馈行是空的");
    ok(r.msgDisplay === "none", "空反馈行被 :empty 收掉，不留空白占位", "display=" + r.msgDisplay);

    /* ---------- 3. 错码 ---------- */
    console.log("\n[3] 错误的神秘码");
    /* ★ 这里用的错码是**曾经的旧码** 'gis'，不是随手编的 'wrong-code'。
       理由：改码最典型的失败模式是「只改了 app.js、忘了改别处」或者
       「浏览器拿到旧缓存」，两者都表现为 **旧码仍然能用**。
       拿一个从未生效过的字符串当错码，测不出这两种情况。 */
    await evalIn(`(() => {
      var i = document.getElementById('secretInput');
      i.value = 'GIS';
      i.dispatchEvent(new Event('input', {bubbles:true}));
      document.getElementById('secretSubmit').click();
      return 1;
    })()`);
    await sleep(300);
    r = await evalIn(`(() => {
      var el = document.getElementById('secretMsg');
      var g = document.getElementById('gisEntry');
      return { msg: el.textContent, isMiss: el.classList.contains('is-miss'),
               color: getComputedStyle(el).color,
               gisDisplay: getComputedStyle(g).display,
               htmlGis: document.documentElement.getAttribute('data-gis'),
               ls: (function(){try{return localStorage.getItem('uvUnlock')}catch(e){return 'ERR'}})() };
    })()`);
    ok(r.msg.length > 0, "错码后有反馈文案", JSON.stringify(r.msg));
    ok(r.isMiss, "错码反馈是「弱一档」的灰（不是红色 —— 家族零彩度）");
    ok(r.gisDisplay === "none", "错码不解锁，gis 仍然不显示");
    ok(r.htmlGis === null, "错码后 html 上仍无 data-gis");
    ok(r.ls === null, "错码不写 localStorage");
    ok(r.msg.indexOf("不对") !== -1 || r.msg.indexOf("match") !== -1,
       "★ 旧码 'GIS' 已被拒绝（改码真的生效了，不是缓存或漏改）", JSON.stringify(r.msg));

    /* ---------- 3b. 大小写与空白容错 ---------- */
    console.log("\n[3b] 大小写 / 首尾空白容错");
    await evalIn(`(() => {
      var i = document.getElementById('secretInput');
      i.value = '  SiCauGis  ';
      i.dispatchEvent(new Event('input', {bubbles:true}));
      document.getElementById('secretSubmit').click();
      return 1;
    })()`);
    await sleep(400);
    r = await evalIn(`(() => {
      var el = document.getElementById('secretMsg');
      var g = document.getElementById('gisEntry');
      return { msg: el.textContent, isMiss: el.classList.contains('is-miss'),
               gisDisplay: getComputedStyle(g).display,
               htmlGis: document.documentElement.getAttribute('data-gis') };
    })()`);
    ok(!r.isMiss, "带空格 + 混合大小写的 sicaugis 被接受（码是给人手打的，不刁难）", JSON.stringify(r.msg));
    ok(r.htmlGis === "on", "容错输入同样挂上 data-gis=on", "got " + r.htmlGis);
    ok(r.gisDisplay === "flex", "容错输入同样解锁 gis 入口", "got " + r.gisDisplay);

    /* 复位：清掉刚才解锁的状态，后面的用例要从未解锁开始 */
    await evalIn(`(function(){try{localStorage.removeItem('uvUnlock')}catch(e){}
                   document.documentElement.removeAttribute('data-gis');return 1;})()`);
    await sleep(200);

    /* ---------- 4. 对码 ---------- */
    console.log("\n[4] 正确的神秘码");
    await evalIn(`(() => {
      var i = document.getElementById('secretInput');
      i.value = 'sicaugis';
      i.dispatchEvent(new Event('input', {bubbles:true}));
      document.getElementById('secretSubmit').click();
      return 1;
    })()`);
    await sleep(400);
    r = await evalIn(`(() => {
      var el = document.getElementById('secretMsg');
      var g = document.getElementById('gisEntry');
      return { msg: el.textContent, isMiss: el.classList.contains('is-miss'),
               gisDisplay: getComputedStyle(g).display,
               gisH: g.getBoundingClientRect().height,
               gisHref: g.getAttribute('href'),
               gisText: g.innerText,
               htmlGis: document.documentElement.getAttribute('data-gis'),
               ls: (function(){try{return localStorage.getItem('uvUnlock')}catch(e){return 'ERR'}})() };
    })()`);
    ok(r.msg.length > 0, "对码后有反馈文案", JSON.stringify(r.msg));
    ok(!r.isMiss, "对码反馈是高亮档（不是灰的）");
    ok(r.htmlGis === "on", "对码后 html 挂上 data-gis=on");
    ok(r.gisDisplay === "flex", "★ gis 入口显示出来了（display:flex）", "got " + r.gisDisplay);
    ok(r.gisH > 0, "gis 入口有真实高度（不是零高度的空壳）", "h=" + r.gisH);
    ok(/^https:\/\/gis\.qxt1me\.dpdns\.org\//.test(r.gisHref || ""), "gis 入口指向正确地址", r.gisHref);
    ok(r.ls === "1", "解锁状态写进 localStorage（uvUnlock=1）");

    /* ⚠️ 这里**不能**断言「导航变高」。.boards 是三列 grid + align-items:stretch
       （见 style.css 的 .boards），同行三张卡片被拉成等高 ——「站点」卡片的
       **外框高度由旁边最高的那张决定**，自己多一条 gis 时并不会变高，
       只是内容区变高（实测：kids 高度 251 → 321，nav 外框 611.4 → 611.4）。
       第一版探针就是照「应该变高」写的，于是稳稳假红。
       真正该验的是**gis 条目自己**可见、有真实高度、且落在卡片可视区内。

       ⚠️ 还有两个会让 elementFromPoint 假红的时序/几何坑，必须在这儿一起解决：
       ① **设置弹窗此刻还开着** —— 刚输对码，弹窗与它的遮罩盖在页面上，
          elementFromPoint 命中的是遮罩而不是 gis 条目。必须先关掉弹窗。
       ② gis 条目在**首屏之下**（实测 top=700.6，视口高 805，勉强在折叠内；
          但 390px 窄屏或更矮的窗口就一定在视口外），而 elementFromPoint 对
          **视口外**的点一律返回 null —— 那是探针自己没滚到位，不是缺陷。
          所以必须先 scrollIntoView 再取点。
       ③ 取点前要等滚动结束（本站用了平滑滚动样式），否则 rect 还是旧位置。 */
    await evalIn(`(function(){
      var m = document.getElementById('settingsModal');
      if (m && !m.hidden) {
        var x = m.querySelector('.modal-x');
        if (x) x.click();
      }
      var g = document.getElementById('gisEntry');
      if (g) g.scrollIntoView({block:'center', behavior:'instant'});
      return 1;
    })()`);
    await sleep(600);

    const geo = await evalIn(`(() => {
      var nav = document.querySelector('${SITES_NAV}');
      var g = document.getElementById('gisEntry');
      var gr = g.getBoundingClientRect();
      var nr = nav.getBoundingClientRect();
      var cx = gr.left + gr.width/2, cy = gr.top + gr.height/2;
      var el = document.elementFromPoint(cx, cy);
      return {
        gisH: gr.height,
        /* 取点时它得真的在视口里，否则 elementFromPoint 恒为 null */
        inViewport: gr.top < window.innerHeight && gr.bottom > 0,
        topmostIsGis: !!(el && (g === el || g.contains(el))),
        topmostDesc: el ? (el.tagName + (el.id ? '#' + el.id : '') +
                           (typeof el.className === 'string' && el.className ? '.' + el.className.split(' ')[0] : '')) : null,
        /* 内容总高确实增加了（证明真的多了一条，而不是替换掉了什么） */
        kidsH: [].slice.call(nav.children).reduce(function(a,c){
          return a + c.getBoundingClientRect().height; }, 0)
      };
    })()`);
    ok(geo.gisH > 40, "gis 条目自身有真实高度（不是零高度空壳）", "h=" + geo.gisH.toFixed(1));
    ok(geo.inViewport, "取点时 gis 条目在视口内（否则命中测试无意义）");
    ok(geo.topmostIsGis, "★ gis 条目在它自己的中心点上是最上层元素（没有被别的东西盖住）",
       "topmost=" + geo.topmostDesc);
    ok(geo.kidsH > kidsH_locked + 40, "站点卡片内容确实多了一条（子元素总高增加）",
       kidsH_locked.toFixed(1) + " -> " + geo.kidsH.toFixed(1));

    /* 最强的一条：**真鼠标点击**能不能跳过去。
       用 CDP 的 Input.dispatchMouseEvent 而不是 element.click() ——
       后者绕过命中测试，就算元素被盖住、被 pointer-events 关掉也照样「成功」，
       测不出真实用户点不点得到。 */
    const pt = JSON.parse(await evalIn(`(function(){
      var g = document.getElementById('gisEntry');
      g.scrollIntoView({block:'center', behavior:'instant'});
      var r = g.getBoundingClientRect();
      return JSON.stringify({x: r.left + r.width/2, y: r.top + r.height/2});
    })()`));
    await sleep(500);
    await sess.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pt.x, y: pt.y, button: "none", clickCount: 0 });
    await sleep(120);
    await sess.send("Input.dispatchMouseEvent", { type: "mousePressed", x: pt.x, y: pt.y, button: "left", clickCount: 1 });
    await sleep(80);
    await sess.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: pt.x, y: pt.y, button: "left", clickCount: 1 });
    await sleep(2000);
    const navTo = await evalIn("location.href");
    ok(/^https:\/\/gis\.qxt1me\.dpdns\.org\//.test(navTo),
       "★ 用真鼠标点 gis 条目能跳过去（不是只有 JS .click() 才行）", navTo);
    /* 跳回来了，后面的用例还要在本站上跑 */
    await goto(URL_);

    /* ---------- 5. 刷新后还在（持久化的真判据） ---------- */
    console.log("\n[5] 刷新后是否仍然解锁");
    await goto(URL_);
    r = await evalIn(`(() => {
      var g = document.getElementById('gisEntry');
      return { display: getComputedStyle(g).display,
               htmlGis: document.documentElement.getAttribute('data-gis'),
               gisText: g.innerText.replace(/\\s+/g,' ').trim() };
    })()`);
    ok(r.htmlGis === "on", "刷新后 html 仍带 data-gis");
    ok(r.display === "flex", "★ 刷新后 gis 入口直接就是显示的（不需要再输一次）");
    ok(r.gisText.length > 0, "gis 入口文案已渲染", JSON.stringify(r.gisText));

    /* 首帧无闪烁：内联脚本在 <head> 就设了 data-gis，
       所以导航**从来不渲染**「没有 gis」的版本。

       ⚠️ 这段的检查逻辑写在下面 evalIn 的模板字符串里，而模板字符串**不能被
          反引号打断** —— 上一版我在注释里写了带反引号的 `</body>`，
          直接把模板字符串提前闭合，整个探针文件语法错误（连跑都跑不起来）。
          所以这里的中文注释里一律不用反引号。

       这一段在页内要小心的三个坑（自己踩出来的）：
         ① 内联脚本写的是 setAttribute("data-gis", "on")，必须用双引号那版去
            indexOf；用单引号会得 -1，把「已应用」假报成「没应用」。
         ② 找 body 开始标签不能用 indexOf('<body') —— 本文件的注释里就含有
            表示 body 结束标签的字样，会被提前命中，得到一个远早于真实位置的
            index。稳妥做法是用正则匹配裸标签 /<body[\s>]/。
         ③ 更不能做 inline < head < body 这种链式比较 —— 浏览器允许 </head>
            出现在 <body> 开始标记之后（容错解析），链式比较会得出荒谬结论。
            真正要断言的只有一件事：内联脚本出现在 body 开始标签之前。 */
    const htmlSrc = await evalIn(`fetch(location.href).then(r=>r.text()).then(function(t){
      var m = /<body[\\s>]/.exec(t);
      var body = m ? m.index : -1;
      var head = t.indexOf('</head>');
      var inline = t.indexOf('setAttribute("data-gis"');
      var scriptStart = t.lastIndexOf('<script>', inline);
      return {head:head, inline:inline, body:body, scriptStart:scriptStart};
    })`);
    ok(htmlSrc.inline > -1 && htmlSrc.scriptStart > -1 &&
       htmlSrc.scriptStart < htmlSrc.inline && htmlSrc.body > -1 &&
       htmlSrc.scriptStart < htmlSrc.body,
       "★ 解锁状态由 <body> 之前的内联脚本应用（早于渲染，所以不会「先没有后跳出」）",
       JSON.stringify(htmlSrc));

    /* ---------- 6. 关闭路径 ---------- */
    console.log("\n[6] 三条关闭路径");
    for (const [how, act] of [
      ["Esc", `document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`],
      ["× 按钮", `document.querySelector('#settingsModal .modal-x').click()`],
      ["点遮罩", `document.querySelector('#settingsModal .modal-scrim').click()`]
    ]) {
      await evalIn("document.getElementById('settingsBtn').click()");
      await sleep(200);
      const opened = await evalIn("document.getElementById('settingsModal').hidden === false");
      await evalIn(act);
      await sleep(250);
      const closed = await evalIn("document.getElementById('settingsModal').hidden === true");
      ok(opened && closed, "关闭路径可用：" + how, "opened=" + opened + " closed=" + closed);
    }
    /* 关闭后反馈要清掉，否则下次打开还挂着上次的「码不对」 */
    await evalIn("document.getElementById('settingsBtn').click()");
    await sleep(200);
    r = await evalIn("document.getElementById('secretMsg').textContent");
    ok(r === "", "重新打开时清掉了上次的反馈", JSON.stringify(r));
    await evalIn(`document.querySelector('#settingsModal .modal-x').click()`);
    await sleep(200);

    /* ---------- 7. 两档主题下的对比度 ---------- */
    console.log("\n[7] 浅色 / 深色两档下的文字对比度（WCAG AA 正文线 4.5）");
    for (const theme of ["dark", "light"]) {
      await evalIn(`document.documentElement.setAttribute('data-theme','${theme}');
                    document.getElementById('settingsBtn').click(); 1`);
      await sleep(450);
      const cm = await evalIn(`(() => {
        ${CONTRAST_FN}
        function pair(sel, prop){
          var el = document.querySelector(sel);
          if(!el) return null;
          var cs = getComputedStyle(el);
          var fg = _rgb(cs.color), bg = null, n = el;
          while(n && !bg){
            var b = _rgb(getComputedStyle(n).backgroundColor);
            if(b) bg = b; else n = n.parentElement;
          }
          return {sel:sel, fg:cs.color, bg:'rgb('+bg.join(',')+')', c:_con(fg,bg),
                  size:cs.fontSize};
        }
        return {
          title: pair('#settingsTitle'),
          label: pair('.setting-label'),
          desc: pair('.setting-desc'),
          input: pair('#secretInput'),
          submit: pair('#secretSubmit'),
          btnc: pair('#settingsBtn'),
          gis: pair('#gisEntry')
        };
      })()`);
      for (const k of Object.keys(cm)) {
        const v = cm[k];
        if (!v) { ok(false, theme + " / " + k + " 能取到样式"); continue; }
        ok(v.c >= 4.5, theme + " / " + k + " 对比度 ≥ 4.5", v.c.toFixed(2) + " fg=" + v.fg + " bg=" + v.bg);
      }
      await evalIn(`document.querySelector('#settingsModal .modal-x').click()`);
      await sleep(150);
    }
    await evalIn(`document.documentElement.setAttribute('data-theme','dark'); 1`);

    /* ---------- 8. 中英切换 ---------- */
    console.log("\n[8] 中英切换后设置面板跟着变");
    await evalIn(`document.documentElement.setAttribute('lang','zh-CN');
                  document.getElementById('settingsBtn').click(); 1`);
    await sleep(300);
    const zh = await evalIn(`(() => {
      var m = document.getElementById('settingsModal');
      return { title: m.querySelector('.modal-title').textContent.trim(),
               label: m.querySelector('.setting-label').textContent.trim(),
               desc: m.querySelector('.setting-desc').textContent.trim(),
               ph: document.getElementById('secretInput').getAttribute('placeholder'),
               sub: document.getElementById('secretSubmit').textContent.trim() };
    })()`);
    await evalIn(`document.querySelector('#settingsModal .modal-x').click()`);
    await sleep(150);
    await evalIn(`document.getElementById('langBtn').click()`);
    await sleep(350);
    await evalIn(`document.getElementById('settingsBtn').click()`);
    await sleep(300);
    const en = await evalIn(`(() => {
      var m = document.getElementById('settingsModal');
      return { title: m.querySelector('.modal-title').textContent.trim(),
               label: m.querySelector('.setting-label').textContent.trim(),
               desc: m.querySelector('.setting-desc').textContent.trim(),
               ph: document.getElementById('secretInput').getAttribute('placeholder'),
               sub: document.getElementById('secretSubmit').textContent.trim(),
               lang: document.documentElement.lang };
    })()`);
    ok(zh.title !== en.title && en.title.length > 0, "标题跟随语言", zh.title + " / " + en.title);
    ok(zh.label !== en.label && en.label.length > 0, "设置项名跟随语言", zh.label + " / " + en.label);
    ok(zh.ph !== en.ph && en.ph.length > 0, "输入框 placeholder 跟随语言", JSON.stringify(zh.ph) + " / " + JSON.stringify(en.ph));
    ok(zh.sub !== en.sub && en.sub.length > 0, "确认按钮跟随语言", zh.sub + " / " + en.sub);
    ok(en.lang === "en", "语言切到 en");

    /* 英文态下反馈文案也应跟着走 */
    await evalIn(`(function(){var i=document.getElementById('secretInput');
                   i.value='nope'; i.dispatchEvent(new Event('input',{bubbles:true}));
                   document.getElementById('secretSubmit').click();})()`);
    await sleep(250);
    const enMsg = await evalIn("document.getElementById('secretMsg').textContent");
    ok(enMsg.length > 0 && /[\x00-\x7F]/.test(enMsg) && !/[\u4e00-\u9fff]/.test(enMsg),
       "英文态下反馈文案是英文（没有硬编码中文）", JSON.stringify(enMsg));
    await evalIn(`document.querySelector('#settingsModal .modal-x').click()`);
    await sleep(150);
    await evalIn(`document.getElementById('langBtn').click()`);
    await sleep(300);

    /* ---------- 9. 窄屏 ---------- */
    console.log("\n[9] 390px 窄屏");
    await sess.send("Emulation.setDeviceMetricsOverride", {
      width: 390, height: 844, deviceScaleFactor: 2, mobile: true
    });
    await sleep(600);
    await evalIn(`document.getElementById('settingsBtn').click(); 1`);
    await sleep(450);
    r = await evalIn(`(() => {
      var m = document.getElementById('settingsModal');
      var card = m.querySelector('.modal-card');
      var inp = document.getElementById('secretInput');
      var sub = document.getElementById('secretSubmit');
      var cr = card.getBoundingClientRect(), ir = inp.getBoundingClientRect(), sr = sub.getBoundingClientRect();
      return {
        docW: document.documentElement.scrollWidth,
        winW: window.innerWidth,
        cardL: cr.left, cardR: cr.right,
        inpW: ir.width, subW: sr.width,
        subInside: sr.right <= cr.right + 0.6,
        stacked: sr.top >= ir.bottom - 1,
        inpVisible: ir.width > 60
      };
    })()`);
    /* 横向溢出判据：文档宽不得被撑出视口 */
    ok(r.docW <= r.winW + 1, "窄屏下没有横向溢出（docW <= winW）",
       r.docW + " vs " + r.winW);
    ok(r.cardL >= -0.6 && r.cardR <= r.winW + 0.6, "弹窗卡片在视口内",
       "[" + r.cardL.toFixed(1) + "," + r.cardR.toFixed(1) + "] win=" + r.winW);
    ok(r.inpVisible, "输入框在窄屏下仍有可用宽度（没被按钮压成一条缝）", "w=" + r.inpW.toFixed(1));
    ok(r.subW > 40, "确认按钮在窄屏下宽度可用", "w=" + r.subW.toFixed(1));
    ok(r.subInside, "按钮没有溢出卡片右边界");
    console.log("      （窄屏下是否折行: " + (r.stacked ? "已折行" : "仍同一行") +
                "，输入 " + r.inpW.toFixed(0) + "px / 按钮 " + r.subW.toFixed(0) + "px）");

    await evalIn(`document.querySelector('#settingsModal .modal-x').click()`);
    await sleep(200);

    /* 窄屏下 gis 入口也不能把导航撑坏 */
    r = await evalIn(`(function(){return {docW: document.documentElement.scrollWidth,
                                        winW: window.innerWidth}})()`);
    ok(r.docW <= r.winW + 1, "窄屏下带 gis 入口的导航不溢出", r.docW + " vs " + r.winW);

    await sess.send("Emulation.clearDeviceMetricsOverride");

    /* ---------- 10. 控制台无报错 ---------- */
    console.log("\n[10] 控制台报错");
    const errs = await evalIn(`(window.__errs || []).length`);
    console.log("      （页面自身报错收集器：" + errs + " 条）");

  } catch (e) {
    console.log("\nEXCEPTION: " + (e && e.message ? e.message : e));
    fail++;
    failures.push("EXCEPTION: " + (e && e.message ? e.message : e));
  } finally {
    try { if (cdp) cdp.ws.close(); } catch (e) {}
    try { child.kill(); } catch (e) {}
    await sleep(400);
    try {
      const fs = require("fs");
      fs.rmSync(userDir, { recursive: true, force: true });
    } catch (e) {}
  }

  console.log("\n===== " + pass + " passed, " + fail + " failed =====");
  if (failures.length) {
    console.log("失败项：");
    failures.forEach(f => console.log("  - " + f));
  }
  process.exit(fail === 0 ? 0 : 1);
})();
