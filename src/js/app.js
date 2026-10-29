/* =========================================================
   universe · 交互
   基座 rjshkhr/startpage 的时钟与搜索逻辑保留，另加：
   中英切换、明暗切换、站点直达前缀。
   ========================================================= */
(function () {
  "use strict";

  var $ = function (s) { return document.querySelector(s); };

  /* ---------------------------------------------------------
     1. 时钟
     原版固定用 en-US 格式且不随语言变；这里跟随当前语言。
     --------------------------------------------------------- */
  var clockTime = $("#clockTime");
  var clockDate = $("#clockDate");

  function updateClock() {
    var now = new Date();
    var hh = String(now.getHours()).padStart(2, "0");
    var mm = String(now.getMinutes()).padStart(2, "0");
    if (clockTime) clockTime.textContent = hh + ":" + mm;

    if (clockDate) {
      var isEn = document.documentElement.lang === "en";
      clockDate.textContent = isEn
        ? now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
        : now.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "short" });
    }
  }

  updateClock();
  /* 原版是 setInterval 每秒跑一次只为刷分钟。这里对齐到整分再走 1 分钟，
     避免无意义地每秒重排一次日期（原版那句每秒都重写 date 文案）。 */
  var msToNextMinute = (60 - new Date().getSeconds()) * 1000;
  setTimeout(function () {
    updateClock();
    setInterval(updateClock, 60000);
  }, msToNextMinute);

  /* ---------------------------------------------------------
     2. 搜索 / 直达
     --------------------------------------------------------- */
  var BLOG = "https://blog.qxt1me.dpdns.org/";
  var GEAR = "https://gear-search.qxt1me.dpdns.org/";
  var G2048 = "https://2048.qxt1me.dpdns.org/";

  /* 站点直达。前缀对应「站点」栏里的站名，不是站内某页 ——
     universe 只负责把前缀解析到「哪个站」。
     ⚠️ 这里别放 ph:/gear: 这类站内视图前缀：blog 的视图是 JS 切 tab、
        没有 URL 路由，指不过去（详见 README 的「待办」）。
        gear 站自己**有** hash 路由（#k=lens&b=Canon），将来要深链可以指过去。 */
  var SITES = {
    "ph:": BLOG,        /* 摄影博客 Photo Blog */
    "blog:": BLOG,
    "gear:": GEAR,      /* 器材筛选库 Gear Index —— 注意域名是 gear-search. 不是 gear. */
    "gs:": GEAR,
    "2048:": G2048,     /* 2048 小游戏（2026-10-07 上线） */
    "game:": G2048
  };

  /* ---------------------------------------------------------
     搜索引擎前缀 + **按网络自动选线路**（2026-10-11 作者要求）

     作者原话：「我们的搜索引擎似乎默认的是谷歌，不如两种线路，
               国内网络连接的会使用 bing，国外的用谷歌」

     === 为什么是「网络先选」，而不是「浏览器语言先选」 ===
     我的第一直觉是「读 navigator.language，zh → 必应」。
     **这条路是错的**，用本机实测就能证伪：
     本机（成都、Chrome/Edge 中文）读到的不是 `zh-CN`，
     而是 **`en-US`** —— 因为作者登录了 Google 账号、
     浏览器开了「同步语言偏好」，语言列表被账号顺成了英文。
     即 **语言 ≠ 网络位置**：一个中国人用英文界面、或一个
     外国人在中国出差，语言判据都会给出相反的答案。
     真需求说的是「国内**网络**」——那只有一件事说了算：
     **这个网络到底连不连得上 google。** 所以只探测，不猜语言。

     === 怎么探测（异步无法参与「回车就跳」）===
     回车是同步路径，不能现探现用。做法是**页面加载时探一次、
     把结果存下来**，回车时读缓存。
       · 探测方式：`new Image()` 打 `https://www.google.com/generate_204`
         —— 这个端点**没有任何 CORS 头**，用 fetch 会在跨国
         预检上额外浪费几百毫秒；Image 不受 CORS 限制，
         只需知道「成没成」。
       · 成功 → google；出错 / 超时 → bing。
       · **超时 2500ms**：穿墙时 google 通常要么很快通、要么
         直接被 RST，真到 2.5 秒还没结果就是不可用。
       · **探测期间回车**：按 bing 走（`googleReachable` 初值 false）。
         理由是这个站群的作者与主要访客都在国内，且**万一判错**，
         必应在两边都能打开、谷歌在国内打不开 —— 押必应的
         失败代价更低。宁可慢一点，不要打不开。

     ⚠️ 家族铁律「界面零彩度」在这里同样成立：**不给线路
        加任何颜色标记**，不因为「选中谷歌」就点亮一个色块。
        默认项只用一行 11px 灰字说明，不引强调色。
     --------------------------------------------------------- */
  var ENGINES = {
    "g:": "https://www.google.com/search?q=",
    "b:": "https://www.bing.com/search?q=",
    "ddg:": "https://duckduckgo.com/?q="
  };

  /* 探测端点：/generate_204 成功返回 204 空体，是最省的连通性探针 */
  var PROBE_URL = "https://www.google.com/generate_204";
  var PROBE_TIMEOUT = 2500;

  /* 探测结果。**初值 = false（用必应）**，见上文「探测期间回车」。
     这个变量在页面加载时被异步改写，回车时读取。 */
  var googleReachable = false;

  /* 纯函数：把「可达性」映射到引擎名。单独抽出来是为了让探针
     能给**两组真值**直接喂进去验，不必靠真的断网来测分支
     （靠改网络测分支的探针，在 CI 或别人机器上跑不出第二种结果）。 */
  function engineFor(reachable) {
    return reachable === true ? "google" : "bing";
  }

  /* 探测 google 连通性，只回答 true/false，绝不抛错 */
  function probeGoogle(cb) {
    var settled = false;
    var img = new Image();
    var timer = setTimeout(function () {
      if (settled) return;
      settled = true;
      img.onload = img.onerror = null;
      img.src = "";                       /* 中止在途请求 */
      cb(false);
    }, PROBE_TIMEOUT);

    img.onload = function () {            /* 204 空体也算 load */
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cb(true);
    };
    img.onerror = function () {           /* RST / DNS 失败 / 被墙 */
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cb(false);
    };
    img.src = PROBE_URL;
  }

  probeGoogle(function (reachable) {
    googleReachable = reachable;
    /* 探测是异步的，结果可能晚于首帧。提示条上那个「默认」标记
       是随引擎变的，所以探完要重渲染一次。
       （不重渲染的话，提示条会永久停在探测前的 bing 文案上。） */
    syncEngineHint();
  });

  /* 回车时用的「最终默认引擎 URL」 */
  function defaultEngineUrl() {
    return ENGINES[engineFor(googleReachable) === "google" ? "g:" : "b:"];
  }

  /* 关键词 → 目标 URL 的完整解析。抽成函数是为了让探针能直接
     验「前缀优先于默认路由」这条分支，不必真的按键跳走。 */
  function resolveQuery(query) {
    var idx = query.indexOf(" ");
    var prefix = idx === -1 ? query : query.slice(0, idx);
    var rest = idx === -1 ? "" : query.slice(idx + 1).trim();

    /* 站点直达：前缀命中即跳，不要求后面还有词 */
    if (Object.prototype.hasOwnProperty.call(SITES, prefix)) return SITES[prefix];

    /* 搜索引擎前缀：要有词才搜，否则退回默认引擎搜整串 */
    if (Object.prototype.hasOwnProperty.call(ENGINES, prefix) && rest) {
      return ENGINES[prefix] + encodeURIComponent(rest);
    }

    return defaultEngineUrl() + encodeURIComponent(query);
  }

  var searchInput = $("#searchInput");
  if (searchInput) {
    searchInput.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;

      var query = this.value.trim();
      if (query === "") return;

      window.location.href = resolveQuery(query);
    });
  }

  /* 提示条上「直接回车 = 搜索 ⟨引擎⟩」的引擎名。
     两种语言下都要准：中文写「谷歌 / 必应」，英文写「Google / Bing」。
     引擎是 JS 选的，所以这里**不能**用 data-zh/data-en 那套静态属性 ——
     它的取值依赖运行时的网络探测结果，必须由 JS 生成。
     语言切换时也要重渲染（见 applyLang 里的 uv:lang 监听）。

     ⚠️ 实现上刻意**写成一个纯文本节点**，而不是往里面塞 <span>/<b>：
        外层 .shortcut-hints span 是 inline-flex，它的子元素会被
        块级化，胶囊内会出现换行、被撑成两行（实测：父胶囊 innerText
        变成「直接回车 = 搜索\n（必应）」）。所以这里改的是
        文本节点的 nodeValue，保证引擎名与前面的字在同一行。 */
  function syncEngineHint() {
    var host = document.querySelector(".hint-plain");
    if (!host) return;
    var isGoogle = engineFor(googleReachable) === "google";
    var isEn = document.documentElement.lang === "en";
    var name = isGoogle ? (isEn ? "Google" : "谷歌") : (isEn ? "Bing" : "必应");
    var suffix = isEn ? " (" + name + ")" : "（" + name + "）";

    /* 第一次调用时追加一个文本节点，之后只改它的值 —— 不再新建节点，
       免得反复切语言时堆出一串文本节点。 */
    var node = host.__engineNode;
    if (!node || node.parentNode !== host) {
      node = document.createTextNode(suffix);
      host.appendChild(node);
      host.__engineNode = node;
    } else {
      node.nodeValue = suffix;
    }
  }
  syncEngineHint();

  /* ---------------------------------------------------------
     3. 中英切换
     textContent 取 data-zh / data-en；INPUT 取 placeholder。
     --------------------------------------------------------- */
  function applyLang(lang) {
    document.documentElement.lang = lang === "en" ? "en" : "zh-CN";

    var nodes = document.querySelectorAll("[data-zh][data-en]");
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var text = lang === "en" ? el.getAttribute("data-en") : el.getAttribute("data-zh");
      if (el.tagName === "INPUT") el.setAttribute("placeholder", text);
      else el.textContent = text;
    }

    var langBtn = $("#langBtn");
    /* 按钮显示「可切换到的目标语言」，与 blog 的 langBtn 同一约定 */
    if (langBtn) langBtn.textContent = lang === "en" ? "中" : "EN";

    updateClock();

    /* 提示条上的默认引擎名是 JS 生成的（依赖网络探测结果），
       data-zh/data-en 管不到 —— 这里补一次。 */
    syncEngineHint();

    /* 广播语言切换：data-zh/data-en 覆盖不到的**JS 生成文本**
       （目前是天气的城市名与天气词）需要自己重渲染。 */
    try {
      document.dispatchEvent(new CustomEvent("uv:lang", { detail: { lang: lang } }));
    } catch (e) {}
  }

  var langBtn = $("#langBtn");
  if (langBtn) {
    langBtn.addEventListener("click", function () {
      var next = document.documentElement.lang === "en" ? "zh" : "en";
      try { localStorage.setItem("uvLang", next); } catch (e) {}
      applyLang(next);
    });
  }

  /* ---------------------------------------------------------
     4. 明暗切换
     --------------------------------------------------------- */
  var themeBtn = $("#themeBtn");
  if (themeBtn) {
    themeBtn.addEventListener("click", function () {
      var next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
      document.documentElement.setAttribute("data-theme", next);
      try { localStorage.setItem("uvTheme", next); } catch (e) {}

      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute("content", next === "light" ? "#f0eeea" : "#0f0f0f");
    });
  }

  /* ---------------------------------------------------------
     5. 关于本站弹窗（左上角按钮打开）
        三条关闭路径：× 按钮 / 点遮罩 / Esc —— 与 blog 的弹层约定一致。
        ⚠️ 打开时记住「是谁打开的」，关闭后把焦点还回去，
           否则键盘用户的焦点会掉到 body 上（可访问性问题）。
     --------------------------------------------------------- */
  var aboutBtn = $("#aboutBtn");
  var aboutModal = $("#aboutModal");

  if (aboutBtn && aboutModal) {
    var lastFocus = null;

    function openAbout() {
      lastFocus = document.activeElement;
      aboutModal.hidden = false;
      /* 焦点移到关闭按钮，键盘能直接 Esc / Tab */
      var x = aboutModal.querySelector(".modal-x");
      if (x) x.focus();
    }

    function closeAbout() {
      aboutModal.hidden = true;
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }

    aboutBtn.addEventListener("click", openAbout);

    /* × 与遮罩共用一个 data-modal-close 钩子 */
    var closers = aboutModal.querySelectorAll("[data-modal-close]");
    for (var ci = 0; ci < closers.length; ci++) {
      closers[ci].addEventListener("click", closeAbout);
    }

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !aboutModal.hidden) closeAbout();
    });
  }

  /* ---------------------------------------------------------
     5b. 设置弹窗 + 神秘码（2026-10-14）
     骨架与「关于」完全一致（三条关闭路径 + 焦点归还），
     这里只多一件事：把输入的码与 UNLOCK_CODE 比对。

     ★ 关于「神秘码」本身，两层必须分清：
       ① 它是**彩蛋/防误入**，不是安全机制。码就写在这个文件里，
          任何人打开 DevTools 或直接读 app.js 都能看到；localStorage
          也能手动改。所以它只挡住了「随便点进来的陌生人」，
          **绝不能**拿它保护任何真正私密的东西。
          https://gis.qxt1me.dpdns.org/ 本身是公开可访问的，
          这里做的只是「不在导航里给他看」。
       ② 解锁结果持久化的键是 uvUnlock，值固定为 "1"
          （不是存码本身 —— 存码等于把码留在本地明文里，
           而且以后改码时旧访客会莫名其妙失效）。
     --------------------------------------------------------- */
  var UNLOCK_CODE = "sicaugis";

  var settingsBtn = $("#settingsBtn");
  var settingsModal = $("#settingsModal");

  /* 反馈文案：两种语言各一份，跟着 data-zh/data-en 的当前语言走。
     ⚠️ 不放进 data-zh/data-en 属性里 —— 那是**静态**文案，
        这两条的结果依赖用户输入，必须由 JS 现算。 */
  var MSG = {
    ok:    { zh: "该有的都在了 —— 回首页看看。", en: "Everything is in place — take a look at the home page." },
    again: { zh: "已经解锁过了。",             en: "Already unlocked." },
    miss:  { zh: "这个码不对。再想想？",        en: "That code doesn't match. Try again?" }
  };

  function isUnlocked() {
    try { return localStorage.getItem("uvUnlock") === "1"; } catch (e) { return false; }
  }

  /* 应用解锁状态。★ 只改 <html data-gis>，不碰 #gisEntry.hidden ——
     两处都能让 gis 出现，但同时做会打架（一个改属性、一个改元素），
     而且**首帧**必须由 CSS 独力完成（内联脚本时 #gisEntry 还不存在）。 */
  function applyUnlock() {
    if (isUnlocked()) document.documentElement.setAttribute("data-gis", "on");
    else document.documentElement.removeAttribute("data-gis");
  }
  applyUnlock();

  function setMsg(key) {
    var el = $("#secretMsg");
    if (!el) return;
    var lang = document.documentElement.lang === "en" ? "en" : "zh";
    el.textContent = key ? MSG[key][lang] : "";
    /* 失败档压到 --fg-weak（灰阶区分，不用红色 —— 家族铁律「界面零彩度」）。
       ⚠️ 清空时必须同时摘掉这个类，否则下次成功也还是灰的。 */
    if (key === "miss") el.classList.add("is-miss");
    else el.classList.remove("is-miss");
  }

  function submitSecret() {
    var input = $("#secretInput");
    if (!input) return;
    var v = input.value.trim();

    /* 大小写不敏感 + 去首尾空白：这个码是给人手打的，
       因为大小写没进去就「不对」属于刁难，不是安全。
       （真安全靠的不是这个码，见上面的说明。） */
    if (v.toLowerCase() === UNLOCK_CODE) {
      if (isUnlocked()) {
        setMsg("again");
      } else {
        try { localStorage.setItem("uvUnlock", "1"); } catch (e) {}
        applyUnlock();
        setMsg("ok");
      }
      input.value = "";
    } else {
      setMsg("miss");
      /* 不清空、也不抖动 —— 保留用户刚打的，方便改一个字符重试。
         ⚠️ 不自动聚焦/不弹 alert：alert 会打断，且和弹窗的
            Esc 关闭路径冲突（alert 里的 Esc 关的是 alert）。 */
    }
  }

  if (settingsBtn && settingsModal) {
    var lastFocusS = null;

    function openSettings() {
      lastFocusS = document.activeElement;
      settingsModal.hidden = false;
      /* 打开时先把上一次的反馈清掉 —— 否则上次的「这个码不对」
         会留在框里，看着像这次也错了。 */
      setMsg(null);
      var input = $("#secretInput");
      if (input) { input.value = ""; input.focus(); }
      else {
        var x = settingsModal.querySelector(".modal-x");
        if (x) x.focus();
      }
    }

    function closeSettings() {
      settingsModal.hidden = true;
      setMsg(null);
      if (lastFocusS && lastFocusS.focus) lastFocusS.focus();
    }

    settingsBtn.addEventListener("click", openSettings);

    var closersS = settingsModal.querySelectorAll("[data-modal-close]");
    for (var si = 0; si < closersS.length; si++) {
      closersS[si].addEventListener("click", closeSettings);
    }

    var secretSubmit = $("#secretSubmit");
    if (secretSubmit) secretSubmit.addEventListener("click", submitSecret);

    var secretInput = $("#secretInput");
    if (secretInput) {
      /* 回车 = 点「确认」。没有用 <form>，所以不会有浏览器默认提交行为
         （那样会刷新页面并把码带进 URL）。 */
      secretInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          submitSecret();
        }
      });
      /* 边打边把上一次的失败提示收掉：留着旧结果会让人以为这次也错。 */
      secretInput.addEventListener("input", function () {
        var el = $("#secretMsg");
        if (el && el.textContent) setMsg(null);
      });
    }

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !settingsModal.hidden) closeSettings();
    });
  }

  /* ---------------------------------------------------------
     6. 点击复制（QQ 号）
        照 blog 的做法：点一下复制到剪贴板，并把按钮文字短暂换成「已复制」。
        ⚠️ navigator.clipboard 在非 HTTPS / 旧浏览器可能不可用，
           所以留一条 execCommand 的兜底路径，失败则提示手动复制。
     --------------------------------------------------------- */
  var copyBtns = document.querySelectorAll("[data-copy]");
  for (var bi = 0; bi < copyBtns.length; bi++) {
    (function (btn) {
      btn.addEventListener("click", function () {
        var text = btn.getAttribute("data-copy") || "";
        if (!text) return;

        /* 反馈方式：临时把**号码本身**换成「已复制」，1.4 秒后还原。
           ⚠️ 原实现依赖一个 .hint 元素，但作者要求页脚不放「点击复制」
              这类说明文字，那个元素已删除 —— 于是点击后毫无反馈。
              改成就地替换 .c-val，既不占额外空间，也不违背「只要图标 + 文本」。 */
        var val = btn.querySelector(".c-val");
        var orig = val ? val.textContent : "";
        var busy = false;

        function done(okFlag) {
          if (!val || busy) return;
          busy = true;
          var isEn = document.documentElement.lang === "en";
          val.textContent = okFlag
            ? (isEn ? "copied" : "已复制")
            : (isEn ? "copy failed" : "复制失败");
          setTimeout(function () {
            val.textContent = orig;
            busy = false;
          }, 1400);
        }

        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () { done(true); },
                                                   function () { done(false); });
        } else {
          /* 兜底：临时 textarea + execCommand */
          try {
            var ta = document.createElement("textarea");
            ta.value = text;
            ta.setAttribute("readonly", "");
            ta.style.position = "fixed";
            ta.style.opacity = "0";
            document.body.appendChild(ta);
            ta.select();
            var okFlag = document.execCommand("copy");
            document.body.removeChild(ta);
            done(okFlag);
          } catch (e) {
            done(false);
          }
        }
      });
    })(copyBtns[bi]);
  }

  /* ---------------------------------------------------------
     7. 天气（Open-Meteo，免费且无需 key）
        取数链：访客定位 → 失败落成都 → 再失败则整块隐藏。

        ⚠️ 三个必须处理的现实约束：
          1. navigator.geolocation **只在安全上下文可用**（HTTPS 或 localhost）。
             本地用 127.0.0.1 起服务时它可能是 undefined —— 所以先判存在性。
          2. 访客会拒绝授权，也可能设备定位超时（室内常见）。
             所以设 8 秒超时，超时即走兜底，不让界面一直空着。
          3. Open-Meteo 失败（离线 / 被墙 / 限流）不能让页面报错 ——
             整块保持 hidden，宁可没有天气，也不要一个 «--°» 的空壳。

        天气码 → 图标：Open-Meteo 用 WMO 码，这里只归成 5 类画线性图标
        （晴 / 多云 / 阴 / 雨 / 雪），够用且与站内手写图标的观感一致。
     --------------------------------------------------------- */
  var weatherBox = $("#weather");

  if (weatherBox) {
    var FALLBACK = { lat: 30.5728, lon: 104.0668, city: "成都", cityEn: "Chengdu" };  /* 兜底城市 */

    /* 记住最近一次取到的天气，供语言切换时重渲染城市名 */
    var lastWeather = null;

    /* WMO 天气码 → [图标形状, 中文, English] */
    function wmoInfo(code) {
      if (code === 0) return ["sun", "晴", "Clear"];
      if (code <= 3) return ["cloud", "多云", "Cloudy"];
      if (code === 45 || code === 48) return ["fog", "雾", "Fog"];
      if (code >= 51 && code <= 67) return ["rain", "雨", "Rain"];
      if (code >= 71 && code <= 77) return ["snow", "雪", "Snow"];
      if (code >= 80 && code <= 82) return ["rain", "阵雨", "Showers"];
      if (code >= 85 && code <= 86) return ["snow", "阵雪", "Snow showers"];
      if (code >= 95) return ["storm", "雷雨", "Storm"];
      return ["cloud", "多云", "Cloudy"];
    }

    /* 线性图标（24×24，与站内其它图标同规格同笔画） */
    var WICONS = {
      sun:   '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6"/>',
      cloud: '<path d="M7 17.5h9.5a3.6 3.6 0 0 0 .3-7.2A5.2 5.2 0 0 0 7 9.4a4 4 0 0 0 0 8.1z"/>',
      fog:   '<path d="M4 9.5h13M6 13h14M4 16.5h13"/>',
      rain:  '<path d="M7 15.5h9.5a3.6 3.6 0 0 0 .3-7.2A5.2 5.2 0 0 0 7 7.4a4 4 0 0 0 0 8.1z"/><path d="M9 18.5l-.8 2.2M13 18.5l-.8 2.2M17 18.5l-.8 2.2"/>',
      snow:  '<path d="M7 15.5h9.5a3.6 3.6 0 0 0 .3-7.2A5.2 5.2 0 0 0 7 7.4a4 4 0 0 0 0 8.1z"/><path d="M9 19h.01M12.5 20.5h.01M16 19h.01"/>',
      storm: '<path d="M7 15.5h9.5a3.6 3.6 0 0 0 .3-7.2A5.2 5.2 0 0 0 7 7.4a4 4 0 0 0 0 8.1z"/><path d="M13 17.5l-2 4h3l-2 4"/>'
    };

    function renderWeather(temp, code, city, cityEn, unknown) {
      var info = wmoInfo(code);
      var shape = info[0];
      var isEn = document.documentElement.lang === "en";
      var label = isEn ? info[2] : info[1];
      var cityName = isEn ? (cityEn || city) : city;

      /* 记下来，切语言时能原样重渲染（否则城市名会一直停在旧语言） */
      lastWeather = { temp: temp, code: code, city: city, cityEn: cityEn, unknown: !!unknown };

      var ico = $("#weatherIco");
      var tmp = $("#weatherTemp");
      var cty = $("#weatherCity");

      if (ico) ico.innerHTML = '<svg viewBox="0 0 24 24">' + (WICONS[shape] || WICONS.cloud) + "</svg>";
      /* 温度未知时留空，**不编造一个数字** —— 但天气词照作者要求按晴天走。
         （编造温度比留空更糟：那是在给用户一个假数据。） */
      if (tmp) tmp.textContent = unknown ? "" : Math.round(temp) + "°";
      if (cty) cty.textContent = cityName + " · " + label;

      weatherBox.hidden = false;
      /* 顺带把场景的天气也定下来（识别不到时 weatherKind 会返回 clear） */
      setSceneWeather(weatherKind(unknown ? -1 : code));
    }

    /* 语言切换后重渲染天气（applyLang 只管 data-zh/data-en，管不到 JS 生成的文本） */
    document.addEventListener("uv:lang", function () {
      if (lastWeather) {
        renderWeather(lastWeather.temp, lastWeather.code,
                      lastWeather.city, lastWeather.cityEn);
      }
    });

    function fetchWeather(lat, lon, city, cityEn) {
      /* current_weather=true 是 Open-Meteo 的当前天气开关；
         timezone=auto 让返回的 time 是当地时间（这里不展示，但便于以后加）。 */
      var url = "https://api.open-meteo.com/v1/forecast?latitude=" + lat +
                "&longitude=" + lon + "&current_weather=true&timezone=auto";
      fetch(url)
        .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status)); })
        .then(function (d) {
          var cw = d && d.current_weather;
          if (!cw || typeof cw.temperature !== "number") throw new Error("no data");
          renderWeather(cw.temperature, cw.weathercode, city, cityEn);
        })
        .catch(function () {
          /* ⚠️ 2026-10-07 改：取不到天气时**不再隐藏整块** ——
             按作者要求「识别不到天气默认按晴天」。
             做法：用 code=0（晴）渲染天气图标与文字，温度留空
             （不编造数字），并打上 unknown 标记供语言切换时保持。
             场景那边也同步落到 clear。 */
          renderWeather(null, 0, city, cityEn, true);
        });
    }

    if (navigator.geolocation && navigator.geolocation.getCurrentPosition) {
      /* 8 秒超时：室内 / 拒绝授权时不让界面一直空等 */
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        fetchWeather(FALLBACK.lat, FALLBACK.lon, FALLBACK.city, FALLBACK.cityEn);
      }, 8000);

      navigator.geolocation.getCurrentPosition(
        function (pos) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          /* 定位成功，但城市名取不到 —— 只显示坐标太丑，故仍用「当前位置」 */
          fetchWeather(pos.coords.latitude, pos.coords.longitude, "当前位置", "Current location");
        },
        function () {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          fetchWeather(FALLBACK.lat, FALLBACK.lon, FALLBACK.city, FALLBACK.cityEn);
        },
        { timeout: 7000, maximumAge: 600000 }
      );
    } else {
      /* 非安全上下文（如 http://127.0.0.1）没有 geolocation —— 直接兜底 */
      fetchWeather(FALLBACK.lat, FALLBACK.lon, FALLBACK.city, FALLBACK.cityEn);
    }
  }

  /* ---------------------------------------------------------
     8. 背景场景（随现实时间与定位天气变化）

        时段划分（**本地时间**，7 档）：
          0–4  night      深夜（星空）
          4–6  dawn       破晓（地平线泛冷紫、暖光将出）
          6–9  morning    清晨（金光斜射）
          9–16 noon       正午（高亮蓝天）
          16–18 afternoon 午后（转暖）
          18–20 dusk      黄昏（橙红压地平线）
          20–22 evening   蓝调时刻
          22–24 night     深夜

        天气（6 类，从 WMO code 归并）：
          clear / partly / overcast / fog / rain / snow
          ⚠️ 识别不到天气时按 **clear（晴）** 处理（作者要求）。

        实现约定：
          · 用 data-daypart / data-weather 两个属性驱动 CSS 色板，
            JS 只写属性、不写颜色 —— 改配色不必动 JS。
          · 每 60 秒重算一次（跨时段的边界最坏晚 1 分钟，可接受）。
          · 页面从后台切回前台时立刻重算（省电：后台不做无谓计算，
            但回来时不能还显示两小时前的天色）。
     --------------------------------------------------------- */
  var sceneEl = $("#scene");

  function daypartOf(h, m) {
    var t = h + m / 60;
    if (t < 4) return "night";
    if (t < 6) return "dawn";
    if (t < 9) return "morning";
    if (t < 16) return "noon";
    if (t < 18) return "afternoon";
    if (t < 20) return "dusk";
    if (t < 22) return "evening";
    return "night";
  }

  /* WMO code → 场景天气类别。code < 0 表示「已知识别不到」→ 按晴天。 */
  function weatherKind(code) {
    if (code === null || code === undefined || code < 0) return "clear";  /* 识别不到 → 晴 */
    if (code === 0) return "clear";
    if (code <= 2) return "partly";          /* 1 少云 / 2 多云 */
    if (code === 3) return "overcast";       /* 3 阴 */
    if (code === 45 || code === 48) return "fog";
    if (code >= 51 && code <= 67) return "rain";
    if (code >= 71 && code <= 77) return "snow";
    if (code >= 80 && code <= 82) return "rain";   /* 阵雨 */
    if (code >= 85 && code <= 86) return "snow";   /* 阵雪 */
    if (code >= 95) return "rain";                 /* 雷雨 → 按雨 */
    return "clear";
  }

  /* 日辉位置：把一天摊成一条弧，太阳从东（左）升到西（右）。
     只在 5:00–19:00 之间有意义；夜里由 CSS 的 night 档给月晕位置。

     ⚠️ 纵向范围**限制在 4%–66%**，不能落到地平线（62%）以下。
        实测（图层隔离，_tools/probe_layer_isolation.js）：
          浅色主题 · 黄昏 · .foot-note
            全部图层      → 4.26 ✗（底色 rgb(241,219,203)，被橙光染过）
            隐藏日辉      → 4.82 ✓（回到纸色）
          即：日辉的橙色叠在页脚所在的「地面」带上，把 --fg-weak 的
          对比度从 4.91 压到 4.26。
        物理上也该如此 —— 太阳落在**地平线**，不该沉到地面带里。 */
  function setGlowPosition(h, m) {
    if (!sceneEl) return;
    var t = h + m / 60;
    if (t < 5 || t > 19) return;                  /* 夜里不覆盖 CSS 的默认值 */
    var p = (t - 5) / 14;                          /* 0..1 across the day */
    var x = 12 + p * 76;                           /* 12% → 88% */
    /* 抛物线：正午最高（4%），早晚落到地平线（66%）为止 */
    var y = 66 - Math.sin(p * Math.PI) * 62;       /* 66% → 4% → 66% */
    sceneEl.style.setProperty("--glow-x", x.toFixed(1) + "%");
    sceneEl.style.setProperty("--glow-y", y.toFixed(1) + "%");
  }

  function setSceneWeather(kind) {
    if (!sceneEl) return;
    sceneEl.setAttribute("data-weather", kind || "clear");
  }

  function updateScene() {
    if (!sceneEl) return;
    var d = new Date();
    var h = d.getHours(), m = d.getMinutes();
    var part = daypartOf(h, m);
    if (sceneEl.getAttribute("data-daypart") !== part) {
      sceneEl.setAttribute("data-daypart", part);
    }
    setGlowPosition(h, m);
    /* 首帧填好后淡入（CSS 里 .scene 初始 opacity:0） */
    if (sceneEl.hidden) sceneEl.hidden = false;
    if (!sceneEl.classList.contains("is-ready")) {
      /* 下一帧再加，确保浏览器已经按新属性算过样式 —— 否则淡入的第一帧
         仍是默认色，等于白做防闪。 */
      requestAnimationFrame(function () { sceneEl.classList.add("is-ready"); });
    }
  }

  if (sceneEl) {
    /* 天气若还没回来，先按晴天（作者要求）—— 等真实数据到了再覆盖 */
    if (!sceneEl.getAttribute("data-weather")) setSceneWeather("clear");

    updateScene();
    setInterval(updateScene, 60000);

    /* 从后台切回前台：立刻重算（可能已经跨了好几个时段） */
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) updateScene();
    });
  }

  /* ---------------------------------------------------------
     8. 访客记录（左下角固定徽标，2026-10-10 作者要求新增）

     数据来自本站自己的 Worker 接口 `/api/visits`（Cloudflare KV 存储）。
     **不是前端编的数字** —— 真计数必须有持久化，见 worker/index.js。

     接口约定：
       POST /api/visits  → 记一次访问（同 IP 同日只计一次）
       GET  /api/visits  → 只读，不累加
     这里用 POST：/api/visits 的 GET 会被预取、爬虫、刷新反复重放，
     用 GET 计数等于每次路过都 +1。

     ★ 与「不挡住内容」相关的两条实现（对应作者的要求）：
       ① 页脚进入视窗时淡出（IntersectionObserver 打 .is-off）
          —— 实测页脚是左下角**唯一**真被压住的内容
       ② CSS 里给了 pointer-events:none，所以即使视觉上重叠，
          鼠标事件也会穿透到下面的元素上，**不会让任何东西点不到**
          （探针有专门断言验这两条）

     ★ 失败降级：接口不通就**整个徽标不显示**（保持 hidden）。
       不编造数字、不显示 «--»，宁可没有 —— 与天气那块的处理原则一致。

     ⚠️ 「接口不通」有两种，**两种都要挡**（2026-10-11 修）：
        ① HTTP 层失败（5xx / 网络断）→ 走 fetch 的 catch；
        ② 业务层失败（**HTTP 200 但 ok:false**，如 KV 故障）→ 响应体里
           total 仍是数字 0，若只判 typeof total === "number" 就会把
           「查询失败」渲染成「今天一位访客都没有」。所以判据里加了 `d.ok`。
       服务端也同时返回了失败状态码（两道防线），见 worker/index.js。
     --------------------------------------------------------- */
  var visitsEl = $("#visits");

  if (visitsEl) {
    var $total = $("#visits-total");
    var $label = $("#visits-label");
    var $today = $("#visits-today");
    var lastVisits = null;

    function renderVisits(d) {
      if (!d || typeof d.total !== "number") return;
      /* ⚠️ 必须同时判 `d.ok`：接口在 KV 故障时会**照旧返回 JSON**（带 ok:false
         与三个 0 值），若只看 total 是不是数字，就会把「查询失败」当成
         「今天真的一位访客都没有」渲染出来 —— 那是编数字。
         服务端现在也同时返回 503，两道防线都要有：状态码挡住大多数，
         ok 标志挡住「200 但业务失败」这类漏网。 */
      if (d.ok === false) return;
      /* 千分位：数字大了更好读。toLocaleString 在 Worker/浏览器都可用。 */
      $total.textContent = d.total.toLocaleString("en-US");
      /* 今日新增只在「今天确实有人来过」时显示，且不喧宾夺主 */
      var lang = document.documentElement.lang === "en" ? "en" : "zh";
      $today.textContent = d.today > 0
        ? (lang === "en" ? " · " + d.today + " today" : " · 今日 " + d.today)
        : "";
      visitsEl.hidden = false;
      visitsEl.setAttribute("title", visitsEl.getAttribute(
        lang === "en" ? "data-en-title" : "data-zh-title") || "");
    }

    function loadVisits() {
      fetch("/api/visits", {
        method: "POST",
        /* 不能让浏览器缓存这个响应 —— 否则第二个访客看到的是第一个人的数字 */
        cache: "no-store",
        headers: { "accept": "application/json" },
      })
        .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status)); })
        .then(function (d) {
          /* 业务层失败（HTTP 200 但 ok:false）同样视为不可用 —— 见 renderVisits 注释 */
          if (!d || d.ok === false) return Promise.reject(new Error("business failure"));
          lastVisits = d;
          renderVisits(d);
        })
        .catch(function () {
          /* 接口不可用（本地 file:// 预览、KV 抖动）→ 保持 hidden。
             不编数字、不显示占位符。 */
          visitsEl.hidden = true;
        });
    }

    /* 语言切换时重渲染（"位访客" 这个 label 走 data-zh/data-en，
       但「今日 N」是 JS 拼的，要跟着切） */
    document.addEventListener("uv:lang", function () {
      if (lastVisits) renderVisits(lastVisits);
    });

    /* ★ 2026-10-11 改：**彻底移除抬升逻辑**，让徽标真正钉死在屏幕左下角。

       作者原话：「访问人数是固定在我们视角的，而不是网页上，
       相当于它不是网页上面的元素，而是我们滑动时在屏幕上的元素」。

       前一版做的是「与页脚重叠时抬起来让位」—— 那让徽标在滚动中**飘移了 136px**
       （实测 scrollY 0→136 时视口 top 从 823 走到 687）。
       那满足「不挡页脚」，但违背了「固定在我们视角」这个更本质的要求：
       用户要的是**屏幕上不动的元素**，不是「会自己找空位的元素」。

       现在的取舍（明确写出来，便于以后回看）：
         · 徽标完全固定 → 滚到底时它会盖住页脚的一角
         · 但 `pointer-events:none` 让它**不吃点击**，页脚上的链接照样可点
         · 而且它只盖住页脚**文字的左端一小块**（左侧联系方式是图标+文字，
           右下角的落款「universe / 憩想 · 个人站群总入口」不受影响）
       即：用「视觉上轻微重叠页脚左角」换「屏幕上绝对不动」——这正是作者要的。

       ⚠️ 历史（别再走回头路）：抬升逻辑前后改过三版，
          v1「页脚可见就隐藏」→ 1440×900 下永远隐藏（文档高 1036 < 视口？ 否，
             是页脚 footTop=869 一直落在视窗内）；
          v2「按当前矩形算」→ 自我累加，71→83→126→30px 来回跳；
          v3 闭式解 → 数值稳定了，但**方向本身就错**（它让元素跟着内容走）。
          教训：先确认「要求到底是固定还是自适应」，再动手写。 */
    /* 无 JS 参与：位置完全由 CSS 的 .visits{position:fixed} 决定。 */

    loadVisits();
  }

  /* 首帧内联脚本已经按 localStorage 改过 <html lang>，这里把文案补齐 */
  applyLang(document.documentElement.lang === "en" ? "en" : "zh");

  /* ---------------------------------------------------------
     验收用接口（供 _tools/probe_engine_route.js 使用）

     ⚠️ 为什么不靠「真的断网 / 真的连上」来验两条分支：
        那样探针在 CI、在别人机器上、在海外的机器上都只能跑出
        一种结果，另一条分支等于没验过。这里把**判定逻辑**暴露
        出来，让探针能把两组真值直接喂进去，两条分支都被覆盖；
        而「本机真实探测到哪一边」再由 uvGoogleReachable() 单独报，
        两者分开，互不掩盖。
     --------------------------------------------------------- */
  window.uvEngines = ENGINES;
  window.uvEngineFor = engineFor;
  window.uvGoogleReachable = function () { return googleReachable; };
  window.uvDefaultEngine = function () { return engineFor(googleReachable); };
  window.uvResolve = resolveQuery;
})();
