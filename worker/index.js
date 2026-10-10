/* universe 的 Worker 入口 —— 只做一件事：访客计数（2026-10-10 新增）

   背景：universe 此前是**纯静态 Worker**（wrangler.jsonc 里没有 main，
   assets.directory 直接指向 ./src）。作者要在左下角放一份**真实的**访客记录，
   而真实计数必须有持久化存储 —— 前端算不出来。所以这里加一个极小的 Worker：
   静态资源照旧由 assets 托管，只有 /api/visits 这一个路径走代码。

   ⚠️ 家族铁律：**零第三方依赖**。所以没用不蒜子之类的公共计数服务，
      而是用本账号自己的 KV（`UV_VISITS`）。
   ⚠️ 不能让 /api/* 落到静态资源兜底上（那样会返回 404 页而不是 JSON），
      所以 assets 配了 `run_worker_first: ["/api/*"]`（见 wrangler.jsonc）。

   接口设计：
     POST /api/visits   记一次访问 → { total, today, days }
     GET  /api/visits   只读当前值（不 +1）→ 同上
   为什么要 POST 才 +1：GET 会被浏览器、爬虫、预取**自动重放**，
   一个 GET 计数器等于每次爬虫路过都 +1，数字很快就不像人看的了。

   防刷（务实而非严密）：
     · 同一 IP 同日只计一次 —— 用 KV 的 `seen:<日期>:<IP哈希>` 键，TTL 到当日结束
     · IP 只存**哈希**不存明文（本站零追踪原则；哈希只为去重，不可反查）
     · 计数本身照旧每次都读，所以刷新页面数字不会跳（同日同 IP 不重复累加）

   KV 键设计：
     total          累计总访问（字符串数字）
     d:<YYYY-MM-DD> 当日访问数
     days           有过访问的天数（用于「第多少天」这类展示留白）
     seen:<日期>:<h>  当日去重标记（TTL 至当日 24:00 UTC+8）
*/

const TZ_OFFSET_MS = 8 * 60 * 60 * 1000;      // 站群所在地：UTC+8

/* 站点本地日期（YYYY-MM-DD）。用固定偏移而不是 toLocaleDateString，
   避免 Worker 运行环境的时区/ICU 差异导致「今天」算错。 */
function localDate(now) {
  const d = new Date(now + TZ_OFFSET_MS);
  return d.toISOString().slice(0, 10);
}

/* 距当日 24:00（站点本地）还有多少秒 —— 用作去重键的 TTL */
function secondsUntilLocalMidnight(now) {
  const local = now + TZ_OFFSET_MS;
  const dayMs = 24 * 60 * 60 * 1000;
  const next = Math.ceil(local / dayMs) * dayMs;
  return Math.max(60, Math.floor((next - local) / 1000));
}

/* IP → 短哈希（FNV-1a）。只为当日去重，不可反查。 */
async function ipHash(ip) {
  const data = new TextEncoder().encode("uv-salt-2026::" + ip);
  const buf = await crypto.subtle.digest("SHA-256", data);
  const arr = new Uint8Array(buf);
  let h = 0x811c9dc5;
  for (let i = 0; i < 8; i++) {
    h ^= arr[i];
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(36);
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      /* 计数接口绝不能被缓存 —— 否则第二个访客看到的是第一个人的数字。
         用 no-store 而不是 no-cache：后者仍可能被 CDN 缓存后回源验证。 */
      "cache-control": "no-store",
    },
  });
}

async function readCounts(env, date) {
  const [total, today, days] = await Promise.all([
    env.UV_VISITS.get("total"),
    env.UV_VISITS.get(date),
    env.UV_VISITS.get("days"),
  ]);
  return {
    total: parseInt(total || "0", 10),
    today: parseInt(today || "0", 10),
    days: parseInt(days || "0", 10),
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/api/visits") {
      /* 非计数路径交回静态资源（正常情况下走不到这里，因为
         assets 只把 /api/* 标记为 run_worker_first） */
      return env.ASSETS ? env.ASSETS.fetch(request) : new Response("Not found", { status: 404 });
    }

    const now = Date.now();
    const date = localDate(now);

    /* 只读：不累加（轮询/复核用） */
    if (request.method === "GET") {
      const c = await readCounts(env, date);
      return json({ ok: true, date: date, ...c, counted: false });
    }

    if (request.method !== "POST") {
      return json({ ok: false, error: "method not allowed" }, 405);
    }

    /* 取客户端 IP：Cloudflare 提供 CF-Connecting-IP */
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const seenKey = "seen:" + date + ":" + (await ipHash(ip));

    let counted = false;
    try {
      const already = await env.UV_VISITS.get(seenKey);
      if (!already) {
        const cur = await readCounts(env, date);
        const isNewDay = cur.today === 0;
        await Promise.all([
          env.UV_VISITS.put("total", String(cur.total + 1)),
          env.UV_VISITS.put(date, String(cur.today + 1)),
          env.UV_VISITS.put("days", String(isNewDay ? cur.days + 1 : cur.days)),
          /* 去重标记：TTL 到当日结束，过了午夜自动失效 ——
             这样「同一天同一人只算一次」不需要额外的清理任务 */
          env.UV_VISITS.put(seenKey, "1", {
            expirationTtl: secondsUntilLocalMidnight(now),
          }),
        ]);
        counted = true;
      }
    } catch (e) {
      /* KV 抖动不应该让页面报错 —— 计数失败就退回只读结果 */
      const c = await readCounts(env, date).catch(() => ({ total: 0, today: 0, days: 0 }));
      return json({ ok: false, date: date, ...c, counted: false, error: "kv unavailable" });
    }

    const c = await readCounts(env, date);
    return json({ ok: true, date: date, ...c, counted: counted });
  },
};
