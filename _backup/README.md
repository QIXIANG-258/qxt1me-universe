# KV 访客统计留档

> 这里放 `export_visits.py` 导出的**访客统计快照**。
> 一天一个文件，`visits-<YYYY-MM-DD>.json`。

## 为什么要留档

访客统计只存在于 Cloudflare KV（命名空间 `UV_VISITS`），**不在任何 git 仓库里**。
按备份分类：

- **不是不可再生数据** —— 丢了站点功能完全不受影响，数字从 0 重来
- **但历史累计值找不回来** —— 那是「这个站被多少人看过」的唯一记录

所以它的定位是「**值得留档，但不值得为它上高可用**」。本目录就是那个留档动作。

## 怎么留

```powershell
python _tools\export_visits.py
```

建议节奏：**每周或每月跑一次**（数据变化极慢，没必要天天）。
想自动化就挂一个计划任务。

## 为什么直接读 KV，而不是 GET /api/visits

那个接口只返回 `total / today / days` **三个数**，拿不到**逐日明细**。
真正的历史在 KV 的日期键里（`2026-10-11` → 7），所以直接读 KV 才是完整导出。

⚠️ 读的时候**必须带 `--remote`**，否则 wrangler 读的是本地
`.wrangler/state` 里的模拟 KV（空的），会导出一份「全 0」的假快照还显示成功。

## 快照长这样

```json
{
 "exportedAt": "2026-10-11T22:58:17+08:00",
 "namespaceId": "c6631cf23aeb427f97f2c22d84eb5d0b",
 "counts": { "days": 1, "total": 7 },
 "daily": { "2026-10-11": 7 },
 "seenMarkers": 7,
 "keysTotal": 10,
 "dailyTotal": 7
}
```

- `counts` —— 累计类的键原值（`total` / `days`）
- `daily` —— **逐日明细**，这是 API 拿不到的部分
- `seenMarkers` —— 去重标记的**数量**（它们有 TTL、过期即消失，导出具体值没意义）
- `dailyTotal` —— 逐日求和，**仅为便于阅读**，不替代 `total`

## 🔴 `total` 与 `dailyTotal` 可能不相等

脚本会**保留两者原值、不做对齐**。原因：

- `total` 是「曾被计入的次数」，`daily` 是「每一天当时的计数」
- 早期版本的行为差异、以及**读-改-写非原子导致的并发丢计数**
  （见 `worker/index.js` 的 `readCounts` → `put` 序列），都可能让两者出现差额

**把差额抹平就等于掩盖了真实的丢计数证据。** 留档的意义恰恰是能事后发现它。

## 这个目录会被部署上去吗

**不会。** `wrangler.jsonc` 的 `assets.directory` 指向 `./src`，
而本目录在仓库根 —— 不在部署范围内。

## 为什么入库而不是 gitignore

因为它**就是**「历史累计值」的载体。不入库等于没留档：
KV 真丢了的时候，本地这份 JSON 是唯一的凭据。
体积很小（一天不到 1 KB），没有理由排除。
