/* =========================================================
   universe 验收探针（55 项）
   默认基线：http://127.0.0.1:8802/（需先起静态服务，见 README）
   验线上：set PROBE_URL=https://universe.qxt1me.dpdns.org/

   判据来源：**现读** blog 的 style.css 取设计令牌，
   不写死颜色常量 —— 否则「是否与 blog 匹配」就变成自己对自己抄答案。
   blog 路径用 BLOG_CSS 指定（本仓库不含 blog 源码）。

   依赖：ws（Node 的 WebSocket 客户端），用 NODE_PATH 指向装了它的目录。
   跑法：
     node _tools/probe_universe.js
   ========================================================= */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const WebSocket = require("ws");

const EDGE = process.env.EDGE || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = Number(process.env.CDP_PORT || 9411);
const URL_ = process.env.PROBE_URL || "http://127.0.0.1:8802/";
/* 判据来源：**现读** blog 的 style.css 取设计令牌，不写死颜色常量。
   路径按「站群新结构」推导，并兼容搬迁前的旧结构 —— 站群曾整体搬过一次
   （D:\Photo_proj + D:\universe_proj → D:\QX_t1me_plan\{01-blog,02-universe}），
   写死路径的脚本全部失效过。可用 BLOG_CSS 覆盖。 */
const BLOG_CSS = (() => {
  if (process.env.BLOG_CSS) return process.env.BLOG_CSS;
  const up2 = path.resolve(__dirname, "..", "..");        // 站群根
  const candidates = [
    path.join(up2, "01-blog", "src", "css", "style.css"),   // 新结构
    path.join(up2, "Photo_proj", "src", "css", "style.css"),// 搬迁前
    path.join(up2, "..", "Photo_proj", "src", "css", "style.css"),
  ];
  return candidates.find((p) => fs.existsSync(p)) || candidates[0];
})();
const SHOT_DIR = process.env.SHOT_DIR || path.resolve(__dirname, "..", "_shots");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- 从 blog 的 CSS 现读令牌 ---------- */
function hexToTriplet(hex) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function readBlogTokens() {
  if (!fs.existsSync(BLOG_CSS)) {
    throw new Error(
      "找不到 blog 的设计令牌文件：\n  " + BLOG_CSS + "\n" +
      "探针的配色判据是**现读** blog 的 style.css 得来的（这样验的才是「是否真与 blog 匹配」，\n" +
      "而不是对着自己的抄件打勾）。这个仓库不含 blog 源码，所以要么把它放在上面这个路径，\n" +
      "要么用环境变量指定：set BLOG_CSS=<你的 style.css 绝对路径>"
    );
  }
  const css = fs.readFileSync(BLOG_CSS, "utf8");

  function block(re) {
    const m = css.match(re);
    if (!m) throw new Error("没在 blog 的 CSS 里定位到色板块：" + re);
    return m[0];
  }
  const grab = (txt, name) => {
    const m = txt.match(new RegExp("--" + name + ":\\s*(#[0-9a-fA-F]{3,8})"));
    if (!m) throw new Error("blog CSS 里找不到 --" + name);
    return m[1];
  };

  const dark = block(/:root,\s*html\[data-theme="dark"\]\s*\{[^}]*\}/);
  const light = block(/html\[data-theme="light"\]\s*\{[^}]*\}/);

  return {
    dark: {
      bg: grab(dark, "bg"),
      card: grab(dark, "card"),
      ink: grab(dark, "ink"),
      ink2: grab(dark, "ink-2"),
      ink3: grab(dark, "ink-3"),
    },
    light: {
      bg: grab(light, "bg"),
      card: grab(light, "card"),
      ink: grab(light, "ink"),
      ink2: grab(light, "ink-2"),
      ink3: grab(light, "ink-3"),
    },
  };
}

/* ---------- WCAG 对比度 ---------- */
function lum([r, g, b]) {
  const f = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a, b) {
  const l1 = lum(a), l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
function parseRgb(s) {
  const m = String(s).match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  return m ? [+m[1], +m[2], +m[3]] : null;
}

/* ---------- 断言收集 ---------- */
const results = [];
function ok(cond, label, extra) {
  results.push({ pass: !!cond, label, extra: extra === undefined ? "" : String(extra) });
}

/* ---------- CDP 连接 ---------- */
async function connect() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await new Promise((res, rej) => {
        const req = require("http").get(
          { host: "127.0.0.1", port: PORT, path: "/json/list" },
          (r) => {
            let d = "";
            r.on("data", (c) => (d += c));
            r.on("end", () => res(JSON.parse(d)));
          }
        );
        req.on("error", rej);
        req.setTimeout(1000, () => req.destroy(new Error("timeout")));
      });
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch (e) {
      /* 还没起来，继续等 */
    }
    await sleep(250);
  }
  throw new Error("拿不到 CDP target");
}

function mkClient(wsUrl) {
  const ws = new WebSocket(wsUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
  let id = 0;
  const pending = new Map();
  const events = [];

  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    } else if (msg.method) {
      events.push(msg);
    }
  });

  const ready = new Promise((res, rej) => {
    ws.on("open", res);
    ws.on("error", rej);
  });

  function send(method, params) {
    const mid = ++id;
    return new Promise((resolve, reject) => {
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
    });
  }

  async function ev(expr) {
    const r = await send("Runtime.evaluate", {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) {
      throw new Error("页面内异常：" + JSON.stringify(r.exceptionDetails).slice(0, 400));
    }
    return r.result.value;
  }

  return { ws, ready, send, ev, events };
}

/* ---------- 页面内取数（一段大表达式，避免多次往返造成时序漂移） ---------- */
const SNAPSHOT = `(() => {
  const cs = (sel, prop) => {
    const e = document.querySelector(sel);
    if (!e) return null;
    return getComputedStyle(e)[prop];
  };
  const rect = (sel) => {
    const e = document.querySelector(sel);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left), y: Math.round(r.top) };
  };
  /* ⚠️ 隐藏元素（display:none）的 getBoundingClientRect 全是 0，
     不能拿去判「图标塌了」。.shortcut-hints 默认就是 display:none，
     里面那 3 个图标会稳定误报。用 getClientRects().length 过滤。 */
  const allIcons = [...document.querySelectorAll('.ico svg')];
  const hiddenIcons = allIcons.filter(s => s.getClientRects().length === 0);
  const icons = allIcons
    .filter(s => s.getClientRects().length > 0)
    .map(s => {
      const r = s.getBoundingClientRect();
      return { w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 };
    });
  /* 隐藏的图标必须全在 .shortcut-hints 里 —— 否则说明有别的块意外被藏了 */
  const hiddenOutsideHints = hiddenIcons.filter(s => !s.closest('.shortcut-hints')).length;
  const links = [...document.querySelectorAll('.container a')].map(a => a.getAttribute('href'));
  return {
    htmlTheme: document.documentElement.getAttribute('data-theme'),
    htmlLang: document.documentElement.lang,

    bodyBg: cs('body', 'backgroundColor'),
    bodyColor: cs('body', 'color'),
    bodyFont: cs('body', 'fontFamily'),
    cardBg: cs('.container', 'backgroundColor'),
    cardBorder: cs('.container', 'borderTopColor'),

    clockFont: cs('.clock-time', 'fontFamily'),
    clockSize: cs('.clock-time', 'fontSize'),
    dateFont: cs('.clock-date', 'fontFamily'),
    h2Font: cs('.container h2', 'fontFamily'),
    h2Spacing: cs('.container h2', 'letterSpacing'),

    /* 花体守卫：Great Vibes 只含 latin 字形，只能用在固定为拉丁的文本上。
       曾经把它套到 .clock-date 上 → 英文态日期变成一串认不出的花字。 */
    scriptFontEls: [...document.querySelectorAll('*')]
      .filter(el => /Great Vibes/.test(getComputedStyle(el).fontFamily))
      .map(el => ({
        tag: el.tagName,
        cls: String(el.className || '').slice(0, 40),
        text: (el.textContent || '').trim().slice(0, 40),
      })),

    /* 明度层级：现在只有一栏（站点），所以不再验「三栏明度梯」，
       改验仍然存在的层级：栏目标题 > 右侧说明。
       .soon 相关取样保留，但**允许为空** —— gear-search 上线后页面上已无
       未上线的站；以后再加 .soon 时，下面的断言会自动开始生效。
       ⚠️ 本段在模板字符串内，注释里**不能出现反引号**（会提前终止字符串）。 */
    headPrimary: cs('.container h2', 'color'),
    hintColor: cs('.container a .hint', 'color'),

    linkColor: cs('.container a', 'color'),
    /* .soon 是可选的：没有未上线站时为 null */
    soonExists: !!document.querySelector('.soon'),
    soonColor: cs('.soon', 'color'),
    soonIsLink: document.querySelector('.soon') ? document.querySelector('.soon').tagName === 'A' : null,
    toolBg: cs('.tool-btn', 'backgroundColor'),
    toolColor: cs('.tool-btn', 'color'),

    cardRect: rect('.container'),
    iconCount: icons.length,
    iconsTooSmall: icons.filter(i => i.w < 8 || i.h < 8).length,
    hiddenIcons: hiddenIcons.length,
    hiddenOutsideHints: hiddenOutsideHints,

    hrefs: links,
    /* 指向站群之外的所有链接（判据 §6 用）。
       原来写死 blog 域，加 gear-search 后会把它误判成「外链」——
       改成按「是不是本域」判。
       ⚠️ 本表达式在模板字符串内，**正则里的反斜杠会被模板字符串吞掉**，
          所以这里不用正则，改用 startsWith 判域名（本文件踩过一次）。 */
    externalLinks: links.filter(function (h) {
      return h && h.indexOf('qxt1me.dpdns.org') === -1;
    }),

    /* 横向溢出 */
    scrollW: document.documentElement.scrollWidth,
    innerW: window.innerWidth,

    /* 字体是否真的装载（不是只写了 font-family） */
    qxLoaded: document.fonts.check('300 40px "QX Serif"'),

    /* 全局过渡是否还挂在所有属性上（原版 * { transition: .2s ease-in-out }） */
    bodyTransitionProp: getComputedStyle(document.body).transitionProperty,
    imgTransition: (() => { const i = document.querySelector('img'); return i ? getComputedStyle(i).transitionProperty : null; })()
  };
})()`;

/* ---------- 主流程 ---------- */
(async () => {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), "uv-probe-"));
  /* ★ 代理开关：本地探测（127.0.0.1）不挂代理；
     线上探测必须走代理 —— 这台机器直连 workers.dev / 自定义域会 000。
     用 PROBE_PROXY 指定，默认按目标是否是本机自动判断。 */
  const isLocal = /^http:\/\/127\.0\.0\.1|^http:\/\/localhost/.test(URL_);
  const proxy = process.env.PROBE_PROXY || (isLocal ? "" : "http://127.0.0.1:7897");
  const netArgs = proxy ? ["--proxy-server=" + proxy] : ["--no-proxy-server"];

  const child = spawn(
    EDGE,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--hide-scrollbars",
      "--remote-debugging-port=" + PORT,
      "--user-data-dir=" + userDir,
      "--window-size=1440,900",
      ...netArgs,
      "about:blank",
    ],
    { stdio: "ignore" }
  );

  let client;
  try {
    const wsUrl = await connect();
    client = mkClient(wsUrl);
    await client.ready;
    const { send, ev, events } = client;

    const exceptions = [];
    events.length = 0;

    await send("Page.enable");
    await send("Runtime.enable");
    await send("Network.enable");

    /* 收集未捕获异常 */
    const drainExceptions = () => {
      for (const e of events) {
        if (e.method === "Runtime.exceptionThrown") {
          exceptions.push(JSON.stringify(e.params.exceptionDetails).slice(0, 300));
        }
      }
      events.length = 0;
    };

    /* 导航前把语言固定成中文，避免上次的 localStorage 干扰 */
    await send("Page.addScriptToEvaluateOnNewDocument", {
      source: `try { localStorage.setItem('uvLang','zh'); localStorage.setItem('uvTheme','dark'); } catch(e){}`,
    });

    /* ---------- 网络台账：抓所有请求的 origin ---------- */
    const origins = new Set();
    const onReq = (m) => {
      if (m.method === "Network.requestWillBeSent") {
        try {
          const u = new URL(m.params.request.url);
          /* ⚠️ 只记 http/https。起始页 about:blank 的 origin 是字符串 "null"，
             不滤掉会稳定误报「有第三方请求」。 */
          if (u.protocol === "http:" || u.protocol === "https:") origins.add(u.origin);
        } catch (e) {}
      }
    };
    client.ws.on("message", (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.method) onReq(m);
    });

    await send("Page.navigate", { url: URL_ });

    /* 两段式等就绪：DOM + 字体 + 时钟有值 */
    let ready = false;
    for (let i = 0; i < 60; i++) {
      const st = await ev(
        `({ rs: document.readyState, t: (document.querySelector('#clockTime')||{}).textContent || '' })`
      );
      if (st.rs === "complete" && /\d\d:\d\d/.test(st.t)) {
        ready = true;
        break;
      }
      await sleep(200);
    }
    ok(ready, "页面就绪（readyState complete 且时钟已填值）");
    await ev("document.fonts.ready.then(()=>1)");
    await sleep(500);

    const blog = readBlogTokens();

    /* ★ 不能只 sleep 固定时长，也不能只等「连续两次一致」：
       主题色有 .25s 过渡，采样间隔可能整段落在过渡中 ——
       实测取到过 rgb(206,204,201) 这种中间帧（目标 240,238,234）。
       正确做法是**轮询到目标值**：判据本身是确定的，等它真到达该在的位置。
       tries 给足（0.15s × 40 = 6s），超时后返回最后值，让断言如实报错。 */
    async function waitColorReaches(sel, expectRgb, tries = 40, prop = "color") {
      const want = expectRgb.join(",");
      let last = null;
      for (let i = 0; i < tries; i++) {
        const cur = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)});
          return e ? getComputedStyle(e)[${JSON.stringify(prop)}] : null; })()`);
        last = cur;
        const got = parseRgb(cur);
        if (got && got.join(",") === want) return cur;
        await sleep(150);
      }
      return last;
    }

    /* ============ 1. 深色态：计算值 vs blog 令牌 ============ */
    let s = await ev(SNAPSHOT);
    drainExceptions();
    s.bodyColor = await waitColorReaches("body", hexToTriplet(blog.dark.ink)) || s.bodyColor;
    s.headPrimary = await waitColorReaches(".container h2", hexToTriplet(blog.dark.ink)) || s.headPrimary;

    const expectDark = {
      bodyBg: blog.dark.bg,
      cardBg: blog.dark.card,
      bodyColor: blog.dark.ink,
      /* 栏目标题取最强对比档 —— 明度梯的最高一级 */
      headPrimary: blog.dark.ink,
      /* 右侧说明是次级信息，取中间档 */
      hintColor: blog.dark.ink2,
    };

    for (const [key, hex] of Object.entries(expectDark)) {
      const want = hexToTriplet(hex);
      const got = parseRgb(s[key]);
      const same = got && got.join(",") === want.join(",");
      ok(same, `深色 ${key} = blog ${hex}`, `实测 ${s[key]}`);
    }

    /* ============ 2. 字体层级：正文无衬线 / 标题衬线 ============ */
    ok(/QX Serif/.test(s.clockFont), "时钟用 QX Serif（衬线）", s.clockFont);
    ok(/QX Serif/.test(s.h2Font), "分类标题用 QX Serif", s.h2Font);
    ok(!/QX Serif|serif$/.test(s.bodyFont) || /PingFang|sans-serif/.test(s.bodyFont),
       "正文走无衬线（与 blog 一致：衬线只用在标题）", s.bodyFont);
    ok(s.qxLoaded, "QX Serif 字体文件真的装载了（不只是写了 font-family）");
    ok(parseFloat(s.h2Spacing) >= 2, "标题字距已放大（blog 的 .sec-title 走 .14em）", s.h2Spacing);

    /* 花体守卫（中文态） */
    const scriptOnDate = /Great Vibes/.test(s.dateFont);
    const scriptOnClock = /Great Vibes/.test(s.clockFont);
    ok(!scriptOnDate, "日期没有用花体（花体仅拉丁字形且不可读）", s.dateFont);
    ok(!scriptOnClock, "时钟没有用花体", s.clockFont);
    const scriptBadText = s.scriptFontEls.filter((e) => /[^\x00-\x7F]/.test(e.text));
    ok(scriptBadText.length === 0, "用花体的元素文本全是 ASCII（不会掉字形）",
       JSON.stringify(s.scriptFontEls));

    /* ============ 3. 明度层级：标题 > 条目说明 ============
       验的是「层级成立」而不是「等于某个具体值」。
       ⚠️ 原来还有一条「可点条目的说明比『筹备中』更亮」——
       gear-search 上线后「器材库」从 .soon 占位改成真链接，
       **页面上已经没有 .soon 了**，那条判据的语义随之消失（已移除）。
       以后再加未上线的站时，可以把它连同 .soon 一起恢复。 */
    const lHead = lum(parseRgb(s.headPrimary));
    const lHint = lum(parseRgb(s.hintColor));
    ok(lHead > lHint, "栏目标题比右侧说明更亮（主次分明）",
       `${lHead.toFixed(3)} > ${lHint.toFixed(3)}`);

    /* ============ 4. 对比度 ============ */
    const cardBg = parseRgb(s.cardBg);
    const cBody = contrast(parseRgb(s.bodyColor), cardBg);
    const cLink = contrast(parseRgb(s.linkColor), cardBg);
    ok(cBody >= 4.5, "正文/卡片对比度 ≥ 4.5 (WCAG AA)", cBody.toFixed(2));
    ok(cLink >= 4.5, "链接/卡片对比度 ≥ 4.5", cLink.toFixed(2));
    /* 弱化项（「筹备中」）不要求 AA，但不能糊到读不出。
       仅当页面上确实有未上线的站时才验 —— 现在没有了，跳过而不是假红。 */
    if (s.soonExists) {
      const cSoon = contrast(parseRgb(s.soonColor), cardBg);
      ok(cSoon >= 3.0, "「筹备中」标签仍可读（≥ 3.0）", cSoon.toFixed(2));
    } else {
      ok(true, "页面上没有未上线的站（.soon 不存在，跳过弱化项对比度）");
    }

    /* ============ 5. 图标与几何 ============ */
    /* 可见图标：站点栏标题 + 2 个条目 + 搜索 + 日期 = 5。
       删掉两栏后自然变少，阈值跟着实际结构走，不写死大数字。 */
    ok(s.iconCount >= 5, "线性图标数量正常（可见）", s.iconCount);
    ok(s.iconsTooSmall === 0, "没有塌成 0 尺寸的图标", s.iconsTooSmall + " 个过小");
    ok(s.hiddenOutsideHints === 0, "被隐藏的图标只出现在快捷提示块里（无意外藏块）",
       `${s.hiddenIcons} 个隐藏 / ${s.hiddenOutsideHints} 个在别处`);
    ok(s.cardRect && s.cardRect.y > 100 && s.cardRect.y < 700,
       "站点栏落在首屏内", JSON.stringify(s.cardRect));
    /* 单栏铺开：卡片应占满版心（max-width 44em ≈ 704px），
       而不是缩回原版那种 15em 的窄条 */
    ok(s.cardRect && s.cardRect.w > 500, "站点栏横向铺开（单栏占满版心）",
       `宽 ${s.cardRect && s.cardRect.w}px`);

    /* ============ 6. 内容守卫：不臆造深链、不重复列同一站 ============ */
    /* ★ 断言从「全部指向 blog 域」放宽为「全部指向本站群自己的域」——
       原来只有 blog 一个子站，现在加了 gear-search，旧断言会假红。
       真正要守的是：**不臆造指向站外的深链**。 */
    const OWN_DOMAINS = /^https:\/\/([a-z0-9-]+\.)?qxt1me\.dpdns\.org(\/|$)/;
    const strays = s.hrefs.filter((h) => h && !OWN_DOMAINS.test(h));
    ok(strays.length === 0, "所有子站链接都指向本站群自己的域名（无臆造外链）",
       JSON.stringify(strays));
    /* .soon 只在有未上线站时存在 */
    if (s.soonExists) {
      ok(s.soonIsLink === false, "未上线的站是不可点的，不是死链");
    } else {
      ok(true, "没有未上线的站（.soon 不存在，跳过死链检查）");
    }
    /* ★ 守卫「一个站只出现一次」：universe 是站群入口，
       同一个 URL 不该在页面上出现两次 —— 曾经有 影集/延时/闲聊/每日颜色/
       关于我/音乐/联系 七条全指向 blog 首页。加第二个站时这条依然成立。 */
    const uniqHrefs = [...new Set(s.hrefs)];
    ok(uniqHrefs.length === s.hrefs.length,
       "同一站不在页面上重复出现（一个站只列一次）",
       `${s.hrefs.length} 条链接 / ${uniqHrefs.length} 个不同地址`);

    /* ============ 7. 零第三方请求（原版会拉 cdnjs 的 Font Awesome） ============
       白名单从 PROBE_URL 现取 —— 写死端口会在换端口时把它误判成第三方请求。
       ★ 线上探测会多出一个 static.cloudflareinsights.com：那是 Cloudflare 给
         部署在它平台上的站点**自动注入**的 Web Analytics beacon，不是页面代码里的引用
         （本地探测为 0，可以对比验证）。所以这里把平台注入排除，
         但要单独断言「除了平台注入，确实没有别的外站」——
         否则这段判据会退化成「永远通过」。 */
    const selfOrigin = new URL(URL_).origin;
    const CF_INJECTED = /^https:\/\/static\.cloudflareinsights\.com$/;
    const thirdParty = [...origins].filter((o) => o !== selfOrigin && !CF_INJECTED.test(o));
    ok(thirdParty.length === 0,
       "除平台注入外零第三方请求（页面自身不引外站）",
       JSON.stringify(thirdParty));
    /* 正向确认：如果出现了 cloudflareinsights，应当只在线上出现 */
    const cfInjected = [...origins].filter((o) => CF_INJECTED.test(o));
    const isLocalProbe = /^http:\/\/127\.0\.0\.1|^http:\/\/localhost/.test(URL_);
    ok(isLocalProbe ? cfInjected.length === 0 : cfInjected.length <= 1,
       isLocalProbe ? "本地探测不应有 CF 注入" : "线上最多一条 CF 平台注入",
       `${cfInjected.length} 条 / 目标 ${isLocalProbe ? "本地" : "线上"}`);

    /* ============ 8. 过渡已收窄（原版是 * 全属性过渡） ============ */
    ok(/background-color/.test(s.bodyTransitionProp) && !/^\s*all\b/.test(s.bodyTransitionProp),
       "过渡只作用于颜色，不再是全属性", s.bodyTransitionProp);

    /* ============ 9. 零未捕获异常 ============ */
    ok(exceptions.length === 0, "无未捕获 JS 异常", exceptions.slice(0, 2).join(" | "));

    /* ============ 10. 悬停：铺反色块 ============ */
    await ev(
      `(() => { const a = document.querySelector('.container a'); a.scrollIntoView({block:'center',behavior:'instant'}); return 1; })()`
    );
    await sleep(150);
    const box = await ev(`(() => {
      const a = document.querySelector('.container a');
      const r = a.getBoundingClientRect();
      return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
    })()`);
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y });
    await sleep(420);
    const hover = await ev(`(() => {
      const a = document.querySelector('.container a');
      const before = getComputedStyle(a, '::before');
      return { color: getComputedStyle(a).color, beforeW: before.width, beforeBg: before.backgroundColor };
    })()`);
    const beforeW = parseFloat(hover.beforeW);
    const linkRgb = parseRgb(hover.color);
    const hlInk = hexToTriplet(blog.dark.bg);
    ok(beforeW > 40, "悬停时反色块真的铺开了（::before 宽度 > 40px）", hover.beforeW);
    ok(linkRgb && linkRgb.join(",") === hlInk.join(","),
       "悬停文字转成反色（= blog --bg，与 ::selection 同一对）", hover.color + " / 底 " + hover.beforeBg);

    /* ★ 把鼠标移开再继续：悬停会改 .hint 的颜色（转成 --hl-ink），
       鼠标停着不走，后面切浅色时取到的就是「悬停态」而非静止态 ——
       曾经因此把浅色 .hint 测成 rgb(255,255,255) 纯白，假红。
       移到页面右下空白处（不在任何链接上）。 */
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 5 });
    await sleep(300);
    const afterUnhover = await ev(`getComputedStyle(document.querySelector('.container a .hint')).color`);
    ok(parseRgb(afterUnhover) && parseRgb(afterUnhover).join(",") === hexToTriplet(blog.dark.ink2).join(","),
       "鼠标移开后说明文字回到静止色（悬停态没有粘住）", afterUnhover);

    /* ---------- 截图：深色 ---------- */
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    let shot = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(SHOT_DIR, "dark.png"), Buffer.from(shot.data, "base64"));

    /* ============ 11. 切浅色态 ============ */
    await ev(
      `(() => { document.documentElement.setAttribute('data-theme','light'); try{localStorage.setItem('uvTheme','light');}catch(e){} return 1; })()`
    );
    /* ★ 不能只 sleep 固定时长：主题色有 .25s 过渡，线上还有网络往返，
       固定等待会取到过渡中间帧（曾把 #161616 测成 rgb(23,23,23)，差 1 个色阶）。
       用前面定义的 waitStableColor 轮询到落定。 */
    /* ★ 先等「主题真的切过去了」，再等「颜色落定」。
       只做后者会踩坑：切换动作发出后、样式还没重算时连采两次，
       两次当然一致 —— 于是把**切换前的深色值**当成稳定值返回，
       浅色态一排断言全部取到深色值（实测踩过）。
       判据用 body 的 data-theme 属性生效 + 颜色确实离开了深色底。 */
    const bgIsLight = () => ev(`(() => {
      const c = getComputedStyle(document.body).backgroundColor;
      const m = c.match(/(\\d+)/g);
      return m ? (Number(m[0]) > 128) : false;
    })()`);
    let switched = false;
    for (let i = 0; i < 25; i++) {
      if (await bgIsLight()) { switched = true; break; }
      await sleep(120);
    }
    ok(switched, "切浅色后底色确实变亮了（主题真的切换成功）");

    s = await ev(SNAPSHOT);
    s.headPrimary = await waitColorReaches('.container h2', hexToTriplet(blog.light.ink)) || s.headPrimary;
    s.bodyColor = await waitColorReaches('body', hexToTriplet(blog.light.ink)) || s.bodyColor;
    s.hintColor = await waitColorReaches('.container a .hint', hexToTriplet(blog.light.ink2)) || s.hintColor;
    /* 底色同理 —— 这三项是过渡最明显的，必须等它落到目标值 */
    s.bodyBg = await waitColorReaches('body', hexToTriplet(blog.light.bg), 40, 'backgroundColor') || s.bodyBg;
    s.cardBg = await waitColorReaches('.container', hexToTriplet(blog.light.card), 40, 'backgroundColor') || s.cardBg;

    const expectLight = {
      bodyBg: blog.light.bg,
      cardBg: blog.light.card,
      bodyColor: blog.light.ink,
      headPrimary: blog.light.ink,
      hintColor: blog.light.ink2,
    };
    for (const [key, hex] of Object.entries(expectLight)) {
      const want = hexToTriplet(hex);
      const got = parseRgb(s[key]);
      ok(got && got.join(",") === want.join(","), `浅色 ${key} = blog ${hex}`, `实测 ${s[key]}`);
    }
    const cBodyL = contrast(parseRgb(s.bodyColor), parseRgb(s.cardBg));
    ok(cBodyL >= 4.5, "浅色态正文对比度 ≥ 4.5", cBodyL.toFixed(2));

    /* 工具按钮要跟着主题走：浅色态必须是浅底深字，别停在深色皮肤 */
    const tBg = parseRgb(s.toolBg), tFg = parseRgb(s.toolColor);
    ok(lum(tBg) > lum(tFg), "浅色态工具按钮是浅底深字（跟随主题）",
       `${s.toolBg} on ${s.toolColor}`);
    ok(contrast(tFg, tBg) >= 4.5, "工具按钮文字对比度 ≥ 4.5", contrast(tFg, tBg).toFixed(2));

    shot = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(SHOT_DIR, "light.png"), Buffer.from(shot.data, "base64"));

    /* ============ 12. 切英文态 ============ */
    await ev(`document.querySelector('#langBtn').click(); 1`);
    await sleep(300);
    const en = await ev(`({
      lang: document.documentElement.lang,
      btn: document.querySelector('#langBtn').textContent,
      firstHead: document.querySelector('.container h2 span').textContent,
      firstLink: document.querySelector('.container a span').textContent,
      foot: document.querySelector('.foot-note').textContent,
      date: document.querySelector('#clockDate').textContent
    })`);
    ok(en.lang === "en", "切英文后 <html lang> 变了", en.lang);
    ok(en.btn === "中", "语言按钮显示「可切换到的目标语言」（与 blog 同约定）", en.btn);
    ok(/Sites/.test(en.firstHead), "标题文案已切英文", en.firstHead);
    ok(/Photo Journal/.test(en.firstLink), "链接文案已切英文", en.firstLink);
    ok(/[A-Za-z]{3}/.test(en.date), "日期跟随语言切换", en.date);

    /* 切到英文后再查一次花体 —— 这条 bug 当初就只在英文态出现 */
    const sEn = await ev(SNAPSHOT);
    ok(!/Great Vibes/.test(sEn.dateFont), "英文态日期同样不用花体（回归守卫）", sEn.dateFont);
    const scriptBadEn = sEn.scriptFontEls.filter((e) => /[^\x00-\x7F]/.test(e.text));
    ok(scriptBadEn.length === 0, "英文态用花体的元素文本仍全是 ASCII",
       JSON.stringify(sEn.scriptFontEls));
    ok(sEn.scriptFontEls.length === 0 || sEn.scriptFontEls.every((e) => /foot-name/.test(e.cls)),
       "花体只出现在页脚署名一处", JSON.stringify(sEn.scriptFontEls.map((e) => e.cls)));
    drainExceptions();
    ok(exceptions.length === 0, "切主题+切语言过程中无异常", exceptions.slice(0, 2).join(" | "));

    /* ============ 13. 手机视口：横向不溢出 ============ */
    await send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await ev(`document.documentElement.setAttribute('data-theme','dark'); 1`);
    await sleep(600);
    const m = await ev(SNAPSHOT);
    ok(m.scrollW <= m.innerW + 1, "手机视口无横向溢出",
       `scrollW ${m.scrollW} vs innerW ${m.innerW}`);
    ok(m.iconsTooSmall === 0, "手机视口图标仍不塌", m.iconsTooSmall + " 个过小");
    const mCard = await ev(`(() => {
      const r = document.querySelector('.container').getBoundingClientRect();
      return { w: Math.round(r.width), sw: window.innerWidth };
    })()`);
    ok(mCard.w <= mCard.sw, "手机视口卡片不超出视口宽", JSON.stringify(mCard));

    shot = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(SHOT_DIR, "mobile.png"), Buffer.from(shot.data, "base64"));

    await send("Emulation.clearDeviceMetricsOverride");
  } catch (err) {
    console.error("\n[探针自身出错] " + (err && err.stack ? err.stack : err));
    try { child.kill(); } catch (e) {}
    process.exit(2);
  }

  try { child.kill(); } catch (e) {}

  /* ---------- 汇总 ---------- */
  const failed = results.filter((r) => !r.pass);
  console.log("\n================ universe 探针 ================");
  for (const r of results) {
    console.log(`${r.pass ? "  OK  " : "  XX  "} ${r.label}${r.extra ? "   [" + r.extra + "]" : ""}`);
  }
  console.log("-----------------------------------------------");
  console.log(`共 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`);
  if (failed.length) {
    console.log("\n失败项：");
    failed.forEach((f) => console.log("  - " + f.label + (f.extra ? "  [" + f.extra + "]" : "")));
  }
  console.log("截图：dark.png / light.png / mobile.png -> " + SHOT_DIR);
  process.exit(failed.length ? 1 : 0);
})();
