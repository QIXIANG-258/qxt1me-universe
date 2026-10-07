# universe_proj

憩想的个人站群总入口（**universe**）—— blog 摄影小站只是其中一个子站。

本目录是 **startpage 模板的「换皮」**：结构、类名、交互沿用上游，
只替换配色 / 排版 / 质感，让每个子站看起来是同一个人的东西。

| | |
|---|---|
| 线上 | <https://universe.qxt1me.dpdns.org> |
| 仓库 | <https://github.com/QIXIANG-258/qxt1me-universe> |

---

## 基座与许可

| | |
|---|---|
| 上游 | [rjshkhr/startpage](https://github.com/rjshkhr/startpage) |
| 上游许可 | **GPL-3.0** |
| 本项目许可 | **GPL-3.0**（派生作品，义务同源） |
| 改动范围 | 设计令牌、字体层级、图标实现、内容文案、少量结构与交互 |

许可证全文见 [LICENSE](LICENSE)，派生关系与第三方字体说明见 [NOTICE](NOTICE)。

> **为什么必须是 GPL-3.0：** 上游是 GPL-3.0，而 GPL 是传染性（copyleft）许可 ——
> 派生作品再分发时须以同一许可发布，并提供完整源码。
> 本站已公开可访问，这构成分发行为；本仓库公开即履行了源码提供义务。
>
> **如果你要拿这份代码做自己的站**，同样需要以 GPL-3.0 开源。
> 若不想受此约束，只有两条路：照自己的设计重写一个单页入口（结构简单，约 200 行），
> 或换用宽松许可的基座（如 `xvvvyz/tilde` 是 Unlicense 公有领域式）。

---

## 目录

```
src/
  index.html        页面（内联线性 SVG 图标，无外部 CDN）
  css/fonts.css     字体声明 —— 从 blog 机械抽取，勿手改
  css/style.css     设计令牌 + 排版 + 质感
  js/app.js         时钟 / 搜索 / 中英切换 / 明暗切换
  fonts/            与 blog 同一批 woff2（QX Serif 4 片 + Great Vibes）
_tools/
  extract_fonts.py      从 blog 的 style.css 抽字体声明过来
  probe_universe.js     浏览器验收探针（52 项）
_shots/                 探针产出的截图与日志
```

---

## 配色映射（这是「不反差」的关键）

上游用 **RGB 三元组**而非十六进制，因为 hover 要写 `rgba(var(--x-rgb), .05)`。
所以本页也保留三元组 —— 改成十六进制会让那些 `rgba()` 全部失效。

| 上游变量 | 上游取值 | 本页取值 | 来源（blog 的令牌） |
|---|---|---|---|
| `--bg-alt-rgb`（页底） | `29,35,38` 冷灰 | `15,15,15` | `--bg` `#0f0f0f` |
| `--bg-rgb`（卡片） | `36,43,45` 冷灰 | `24,24,24` | `--card` `#181818` |
| `--fg-rgb`（主文字） | `230,231,230` 冷白 | `242,241,237` | `--ink` `#f2f1ed` |
| `--fg-alt-rgb` | `206,211,220` | `181,180,174` | `--ink-2` `#b5b4ae` |
| `--fg-weak-rgb` | （无） | `130,129,122` | `--ink-3` `#82817a` |
| `--primary-rgb` | `126,154,171` 雾蓝 | `242,241,237` | `--ink` |
| `--secondary-rgb` | `188,143,125` 陶土 | `181,180,174` | `--ink-2` |
| `--tertiary-rgb` | `150,176,136` 鼠尾草 | `130,129,122` | `--ink-3` |

### 三个决定性的改动

1. **三色降成同色系明度梯。** 上游的三个分类色（雾蓝 / 陶土 / 鼠尾草）是和 blog 反差的最大来源：
   blog 的界面**零彩度**，颜色全部来自照片与色卡本身。所以这里只用「明度」区分三个分类
   （一级最亮 → 三级最弱），界面不再引入任何色相。
2. **页底与卡片的明暗方向翻过来。** 上游是「页底比卡片亮」（页 `#242B2D` / 卡 `#1D2326`），
   blog 是「页底更深、卡片浮起」。这里跟 blog。
3. **发丝描边 + 重投影。** 上游只靠一层极轻的阴影、没有描边；blog 大量使用
   `1px rgba(255,255,255,.13)` 的发丝线配更深更散的阴影。这里补上。

---

## 字体层级（照抄 blog，不是整站衬线）

blog 的实际层级是「**正文无衬线 + 标题衬线**」，不是整站衬线：

| 用途 | 字体 | 备注 |
|---|---|---|
| 正文 / 导航 / 链接 | `--f-cn` 系统无衬线 | 与 blog `body` 一致 |
| 时钟数字 / 三栏标题 / 页脚署名 | `QX Serif`（自托管衬线） | 对应 blog `.sec-title` / `.month-date` / `.foot-name` |
| 日期小字 | `--f-serif` 系统衬线栈 | 对应 blog 的 eyebrow（13px / 字距 .24em） |
| 英文站名署名 | `Great Vibes`（花体） | 对应 blog 英文态站名 |

> ⚠️ **花体只能用在固定为拉丁的文本上。** Great Vibes 仅含 latin 字形，
> 套到含中文或需要阅读的信息上会掉字形 / 读不出来。
> 这里只给页脚的 `universe` 用；探针有一条守卫专门盯它（曾把日期套错，已修）。

---

## 与上游的其它差异

| 项 | 上游 | 本页 | 原因 |
|---|---|---|---|
| 图标 | Font Awesome 6.5.1，走 **cdnjs 外部 CDN**，实心 | 内联线性 SVG（24×24 / `currentColor`） | blog 零第三方请求；实心图标与克制风不符 |
| 全局过渡 | `* { transition: .2s ease-in-out }` **全属性** | 收窄到 `background-color / color / border-color` | 全属性过渡会让 width/height/box-shadow 也参与，悬停触发布局重算 |
| 圆角 | `1em` / `0.5em` | `5px` / `4px` | blog 控件 `--r: 5px` |
| 悬停 | 低透明度分类色叠一层 | **反色胶囊**（`--hl` 底 / `--hl-ink` 字） | blog 的 `::selection` 就是这一对，沿用同一语义 |
| 时钟字号 | `5rem` 固定 | `clamp(3rem, 11vw, 5rem)` | 5rem 在窄屏会顶出横向滚动条 |
| 搜索 | 仅 Google | `g:` / `b:` / `ddg:` 前缀 + `ph:` 直达摄影小站 | — |
| 布局 | 固定三栏（General / Social / Dev） | **单栏、一行式条目**（左图标 + 站名 …… 右说明） | 只有一个真站；三栏是硬凑，一行式把横向空间用起来 |
| 主题 | 无 | 明暗双主题 + 中英双语，首帧防闪 | 与 blog 一致 |
| 页脚 | 无 | 补一条落款 | — |

---

## 本地预览

```bash
cd src
python -m http.server 8801 --bind 127.0.0.1
# 打开 http://127.0.0.1:8802/
```

## 验收（浏览器探针，55 项）

```bash
# 需要 src 已在跑（同上），并已装 ws（Node 的 WebSocket 客户端）
set NODE_PATH=<放 ws 的 node_modules 目录>
node _tools/probe_universe.js
```

**验线上**（这个才是真验收）：

```bash
set PROBE_URL=https://universe.qxt1me.dpdns.org/
node _tools/probe_universe.js
```

> ⚠️ 探针会按 `PROBE_URL` 自动决定挂不挂代理：目标是本机就不挂，
> 是线上就挂 `127.0.0.1:7897`（本机直连 `workers.dev` 与自定义域会失败）。
> 用 `PROBE_PROXY` 可覆盖。

探针的判据**现读** blog 的 `style.css` 取令牌再比对，
不写死颜色常量 —— 所以它验的是「是否真的与 blog 匹配」，不是对着自己的抄件打勾。

覆盖：深浅两套配色是否等于 blog 令牌、字体层级、三栏明度梯、WCAG 对比度、
图标不塌、悬停反色、零第三方请求、过渡收窄、零未捕获异常、中英切换、
手机视口不横向溢出。截图输出到 `_shots/`。

## 同步字体声明

blog 那边换了字体，跑一次即可同步过来（勿手抄 unicode-range，一个码位写错会被浏览器静默丢弃整条声明）：

```bash
python _tools\extract_fonts.py
```

## 部署

> 📘 **完整操作流程见 [`docs/手动上线操作手册.md`](docs/手动上线操作手册.md)** ——
> 含三步法、改什么的注意事项、三套探针的跑法、以及本站特有的坑。

universe 是**纯静态、无构建步骤** —— `src/` 里就是最终产物。
`wrangler.jsonc` 的 `assets.directory` 指向 `./src`，Worker 名 `qxt1me-universe`。

两条路，任选：

### 路线 A：本地直发（最快，不碰 git）

Cloudflare 凭据本机已登录（`%APPDATA%\xdg.config\.wrangler\config\default.toml` 里有 OAuth token），
所以直接：

```bash
cd /d D:\universe_proj
npx --yes wrangler@4 deploy
```

产出 `https://qxt1me-universe.2088801789.workers.dev`（Workers 预览入口），
自定义域 `universe.qxt1me.dpdns.org` 已在控制台绑定。

> ⚠️ **必须钉住 `@4`，不要只写 `npx wrangler`。**
> 本机 npx 缓存里同时存在 wrangler **3.114.17** 和 **4.147.0**。
> v3 **不支持 `assets` 配置** —— 它不会报错，会**静默跳过整个资源目录**，
> 只上传一个 376 字节的空 Worker（症状：部署显示成功，打开站点是 404 或裸 HTML）。
> 判据：正确运行时会打印 `✨ Read N files from the assets directory`（本项目 N=13，10 个文件 + 3 个目录），
> v3 没有这一行。`package.json` 里也钉了 `wrangler ^4.147.0`。

> ⚠️ **在 cmd 里切盘符必须用 `cd /d`。** 只写 `cd <盘符>:\<路径>` 在 cmd 中
> **不会换盘**（且不报错），prompt 仍停在原盘符，wrangler 于是在用户主目录里
> 找不到配置、转入自动配置流程，把 Windows 用户名当成 Worker 名。
> 判断有没有进对目录：看 prompt 是否变成项目所在盘符，以及输出里有没有那行 `Read N files`。

### 自动部署（可选）

仓库已公开。若要 `git push` 即上线，在 Cloudflare 控制台
→ Workers → 连接 Git 仓库 → 选 `qxt1me-universe`，
**构建命令留空**，输出目录填 `src`。

---

## Git 注意事项（这台机器特有，踩过）

| 事项 | 说明 |
|---|---|
| **必须显式配代理** | 直连 `github.com` 返回 **403**（实测 2026-10-06）；走 `127.0.0.1:7897` 返回 **200**。git 只靠 Windows 系统代理会报 `CONNECT tunnel failed 502`，**必须** `git config http.proxy http://127.0.0.1:7897` |
| **没有 gh CLI** | 建仓库走 `api.github.com`（直连也通，实测 200） |
| **写不进 `refs/remotes/origin/*`** | `git fetch` 会打印新建 `origin/main` 但引用留不下来；要用 `git reset --mixed "$(head -1 .git/FETCH_HEAD \| cut -f1)"` |
| **别用 heredoc 写含中文的提交信息** | 会被截断；单行用 `-m`，多段用 Write 写文件后 `git commit -F` |
| **推送结果核实** | 别信 `Everything up-to-date`（那是推送前的探测输出）；用 `git ls-remote origin -h refs/heads/main` 比 sha |

---


## 待办 / 已知限制

1. **现在只有「站点」一栏**，因为确实只有一个真站。
   原设计的三栏里，另两栏（内容 / 关于）共七条链接**全部指向 blog 首页** ——
   同一个站写七遍，且都不通向各自声称的页面。按「一个站只出现一次」的原则整栏删除
   （决定来自作者：*「内容入口可以去掉，因为找的是同一个网站」*）。
   探针里有一条守卫盯着这件事：**页面上不允许出现重复的 URL**。
   blog 的站内导航（影集 / 延时 / 闲聊 / 关于 / 音乐）由 blog 自己的顶栏负责。
2. **加第二个站时**：在 `index.html` 的「站点」栏加一条 `<a>`（模板见文件内注释），
   未上线的站用 `<span class="soon">` 而不是死链。
   三栏的明度梯（`.social-container` 最亮 / `.dev-container` 中 / `.general-container` 最弱）
   在 CSS 里还留着，回到多栏时直接可用。
3. **器材库未上线**，页面上是「筹备中」的不可点状态（`.soon`）。
4. **域名未定。** `qxt1me.dpdns.org` 根域与 `universe.qxt1me.dpdns.org` 当前都无 DNS 记录，两个都可用。
   ⚠️ `gallery.qxt1me.dpdns.org` 是 CF 隧道站、依赖作者本机开机，**不要**作为对外子站列进来。
   ⚠️ `img.qxt1me.dpdns.org` 是 R2 媒体域、根路径没有 index（404 属正常），它是资源域不是站，
   同样不该出现在导航栏里。
5. **GPL-3.0 传染**（见上）。
6. `_shots/` 是探针产物，可按需清理。
