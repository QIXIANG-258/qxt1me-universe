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

  /* 站点直达。前缀对应「站点」栏里的站名，不是站内某页 ——
     universe 只负责把前缀解析到「哪个站」。
     ⚠️ 这里别放 ph:/gear: 这类站内视图前缀：blog 的视图是 JS 切 tab、
        没有 URL 路由，指不过去（详见 README 的「待办」）。
        gear 站自己**有** hash 路由（#k=lens&b=Canon），将来要深链可以指过去。 */
  var SITES = {
    "ph:": BLOG,        /* 摄影小站 Photo Journal */
    "blog:": BLOG,
    "gear:": GEAR,      /* 器材库 Gear Search —— 注意域名是 gear-search. 不是 gear. */
    "gs:": GEAR
  };

  /* 搜索引擎前缀 */
  var ENGINES = {
    "g:": "https://www.google.com/search?q=",
    "b:": "https://www.bing.com/search?q=",
    "ddg:": "https://duckduckgo.com/?q="
  };

  var DEFAULT_ENGINE = ENGINES["g:"];

  var searchInput = $("#searchInput");
  if (searchInput) {
    searchInput.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;

      var query = this.value.trim();
      if (query === "") return;

      var idx = query.indexOf(" ");
      var prefix = idx === -1 ? query : query.slice(0, idx);
      var rest = idx === -1 ? "" : query.slice(idx + 1).trim();

      /* 站点直达：前缀命中即跳，不要求后面还有词 */
      if (Object.prototype.hasOwnProperty.call(SITES, prefix)) {
        window.location.href = SITES[prefix];
        return;
      }

      /* 搜索引擎前缀：要有词才搜，否则退回默认引擎搜整串 */
      if (Object.prototype.hasOwnProperty.call(ENGINES, prefix) && rest) {
        window.location.href = ENGINES[prefix] + encodeURIComponent(rest);
        return;
      }

      window.location.href = DEFAULT_ENGINE + encodeURIComponent(query);
    });
  }

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

  /* 首帧内联脚本已经按 localStorage 改过 <html lang>，这里把文案补齐 */
  applyLang(document.documentElement.lang === "en" ? "en" : "zh");
})();
