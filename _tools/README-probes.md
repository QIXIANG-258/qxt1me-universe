# universe 探针套件 —— 分层单入口

```powershell
python _tools\run_probes.py                 # 全部
python _tools\run_probes.py --layer static  # 只跑静态层
python _tools\run_probes.py --list
```

## 分层（与 01-blog / 03-gear / 05-game-2048 / 06-GIS-Proj 对齐）

| 层 | 内容 | 什么时候跑 |
|---|---|---|
| `static` | 结构 / 配色 / 交互 / 场景 / 图标 / 引擎路由（9 套） | 改前端（不碰 Worker） |
| `api` | `probe_visits.js`（打 `/api/visits`） | 改访客接口或 KV 逻辑 |
| `online` | `probe_geo.js`（定位分支，必须线上） | 发布前 |

> 分层的价值：**改样式不用起 Worker（快），改接口不用跑全套（也快）。**

## ⚠️ 本站的特殊之处：它是家族里唯一有服务端代码的站

别的站 `python -m http.server` 起个静态服务就能跑全部探针；
**本站不行** —— `/api/visits` 是 Worker 提供的，静态服务看不到它。

所以 `api` 层要么：
- 打线上：`$env:PROBE_URL='https://universe.qxt1me.dpdns.org/'`
- 本地起真 Worker：`npx.cmd --yes wrangler@4 dev --port 8799 --local`

**拿静态服务去跑 `probe_visits.js` 会全红，那不是缺陷、是环境没配** ——
脚本会识别并提示，不会让你误以为产品坏了。

## 环境前提

1. **静态层要静态服务**（工作目录 `src/`）：
   `python -m http.server 8802 --bind 127.0.0.1`
2. **`NODE_PATH` 指向含 `ws` 的 node_modules** —— 脚本自动找三个候选位置，
   找不到就明确报「环境失败」而不是静默跳过全部。

## 实测基线（2026-10-12）

| 层 | 结果 |
|---|---|
| static | **9/9 rc=0** —— probe_universe 138/138、probe_interact 34/34、probe_engine_route 22/22、probe_favicon 30/30、probe_weather_fallback 10/10、probe_scene_light 30/30、probe_scene_contrast / probe_light_baseline / probe_layer_isolation 通过 |
| api | **1/1 rc=0** —— probe_visits **22/22**（打线上） |

> 线上 `probe_universe.js` 是 **139/139**（比本地多 1 条 —— 本地跑不到
> `_headers` 相关判据）。要验线上就设 `PROBE_URL`。

## 搜索引擎线路（`probe_engine_route.js`）

搜索框默认引擎按**网络连通性**自动选：直连得上 google → Google，否则 → 必应。
判定写在 `src/js/app.js` 的 `engineFor()`（纯函数，探针直接喂两组真值）。

配套两个脚本，**不是**分层套件的常规成员，改路由时才手动跑：

| 脚本 | 作用 |
|---|---|
| `_inject_google_reachable.js` | 故障注入：拦 `*generate_204*` 回一张 1×1 PNG，伪造「国外网络」，验另一条分支 |
| `_verify_hint_lang.js` | 提示条中英切换下引擎名是否正确、且不堆节点 |

> **为什么必须做注入**：本机（成都）google 直连 000，不注入就只能验到
> **必应这一条分支** —— 只验一条分支的探针，代码里写成恒返回 bing 也照样全绿。
> 注入应答必须是 **HTTP 200 + 真实 PNG 实体**：实测 `200 + 空体` 与
> `204 + 空体` 都会走 `Image.onerror`（`<img>` 的 onload 要求真的解码出图）。
