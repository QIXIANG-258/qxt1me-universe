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

## 实测基线（2026-10-14 重测）

| 层 | 结果 |
|---|---|
| static | **10/10 rc=0** —— 见下表逐项条数 |
| api | probe_visits **22/22**（需先 `wrangler dev` 在 8799 跑着，它才有 `/api/visits`） |

| 探针 | 实测条数（2026-10-14） |
|---|---|
| `probe_universe.js` | 138/138 |
| `probe_secret_code.js` | 72/72 |
| `probe_interact.js` | 34/34 |
| `probe_favicon.js` | 30/30 |
| `probe_scene_light.js` | 30/30 |
| `probe_scene_contrast.js` | 28 项（不达标 0 / 28） |
| `probe_light_baseline.js` | 28 项（新增不达标 0，原本不达标 0） |
| `probe_engine_route.js` | 22/22 |
| `probe_weather_fallback.js` | 10/10 |
| `probe_layer_isolation.js` | 6 情形（全部 ✓） |

> ⚠️ **这些数字必须实跑取，不能数源码里的 `ok(`。** 实测过：数 `ok(` 得到
> 45 / 75 / 59，与实跑的 138 / 22 / 34 **全不相等** —— 断言写在循环里、
> 或一条 `ok` 覆盖多个组合时就会对不上。

> ⚠️ **线上 `probe_universe.js` 是 flaky，别拿单次绿灯当验收证据。**
> 实测连跑 4 次：139/140 → 140/140 → 140/140 → 139/140（总数在 138 与 140
> 之间漂，失败项恒为「工具按钮文字对比度 ≥ 4.5 [3.22]」）。
> 这与本地口径的 138 也不一致 —— 线上会多出 `_headers` 相关判据。
> **判据是「失败数为 0」，不是某个固定总数。**

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

## 外站板块增删条目（2026-10-12 起）

`probe_universe.js` 里原先有一条 `ext.n === 4`（外站恰好 4 条），
以及一份钉住站名的 `EXPECT_EXT` 数组。**这两条都随条目数增长而失效**：

- `ext.n === 4` → 改成 **`ext.n >= 4`**。契约是**结构性**的（独立 `nav` 地标、
  每条都有图标 + 站名 + 说明行、都 `target=_blank` + `rel=noopener`、
  都不指向本域、无重复地址），**不是**「恰好 4 条」。
  写死条目数的问题是：作者每加一条，探针红一次，而红的原因不是站点坏了，
  是探针自己把「当前条目数」当成了契约。
- `EXPECT_EXT` → 只校验「列进去的名字原样出现」，**不要求全集相等**。
  所以新增条目不会让它假红，但它仍能挡住把官方名「顺手翻译」掉。

**加一条外站时探针侧不用改**；只有想钉住新站名时才往 `EXPECT_EXT` 里追加。

> ⚠️ **量探针数字前先禁缓存**。`python -m http.server` 会对静态文件回
> `Last-Modified`，无头实例复用同一个 `user-data-dir` 时会命中磁盘缓存 ——
> 症状是**「磁盘上已经改好、探针却读到旧数字」，看起来像改动没生效**。
> 本次改 `acg.rip` 图标时实际踩到：改完再跑，图标占宽仍是旧的 53.3%。
> 修法：`Network.enable` + `Network.setCacheDisabled({cacheDisabled:true})`
> 再 `Page.navigate`。`probe_universe.js` 自己起独立 profile，不受影响。

> ⚠️ **几何对不等于图画对**。图标只判「有 `svg` + 尺寸 ≥8px」是不够的：
> 15.95px 的方框里，`getTotalLength()` 采样出的**墨迹包围盒占 viewBox 的比例**
> 才反映视觉重量。本次三条新图标初版 `acg.rip` 只占 **53.3% 宽**（同板块其它
> 图标约 70%），会在同样大小的方框里显得小一圈。放大图形是**有用的**校验，
> 但本机模型无图像输入、读不了截图，所以改用**几何指纹**（采样点包围盒 +
> 8×8 墨迹分布）代替肉眼看图 —— 能确定笔画落在哪，不能确定「像不像」。

