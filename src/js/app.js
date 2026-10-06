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

  /* 站点直达。前缀对应「站点」栏里的站名，不是站内某页 ——
     universe 只负责把前缀解析到「哪个站」。
     ⚠️ 这里别放 ph:/gear: 这类站内视图前缀：blog 的视图是 JS 切 tab、
        没有 URL 路由，指不过去（详见 README 的「待办」）。 */
  var SITES = {
    "ph:": BLOG,      /* 摄影小站 Photo Journal */
    "blog:": BLOG
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

  /* 首帧内联脚本已经按 localStorage 改过 <html lang>，这里把文案补齐 */
  applyLang(document.documentElement.lang === "en" ? "en" : "zh");
})();
