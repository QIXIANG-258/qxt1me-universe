#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""导出 universe 访客统计（KV `UV_VISITS`）到本地 JSON 快照。

用法:
    python _tools/export_visits.py                 # 写到 _backup/visits-<日期>.json
    python _tools/export_visits.py --out <路径>

## 为什么需要它（E09 的已知缺口）

访客统计**只存在于 Cloudflare KV**，不在任何 git 仓库里。
按备份分类：
  - 它**不是不可再生数据**（丢了站点功能完全不受影响，数字从 0 重来）
  - 但**历史累计值找不回来** —— 那是「这个站被多少人看过」的唯一记录
所以它属于「值得留档、但不值得为它上高可用」的那一档。
本脚本就是那个留档动作：定期跑一次，把全量键值落成可读的 JSON。

## 为什么不用 GET /api/visits

那个接口只返回 **total / today / days 三个数**，拿不到**逐日明细**。
真正的历史在 KV 的日期键里（`2026-10-11` → 数字），
所以这里直接读 KV —— 这才是完整导出。

## 读的是**远端** KV

必须带 `--remote`，否则 wrangler 读的是本地 `.wrangler/state` 的模拟 KV
（那是空的，会导出一份「全 0」的假快照还显示成功）。
"""
import argparse
import io
import json
import os
import re
import subprocess
import sys
import datetime

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
NS = "c6631cf23aeb427f97f2c22d84eb5d0b"      # UV_VISITS
OUTDIR = os.path.join(ROOT, "_backup")

# wrangler 往 stderr 打彩色 WARNING，会污染 stdout 的 JSON —— 必须剥掉 ANSI
ANSI = re.compile(r"\x1b\[[0-9;]*m")


def wrangler(args, timeout=180):
    env = dict(os.environ)
    env.setdefault("PYTHONIOENCODING", "utf-8")
    r = subprocess.run(["npx.cmd", "--yes", "wrangler@4"] + args,
                       cwd=ROOT, env=env, capture_output=True,
                       text=True, encoding="utf-8", errors="replace",
                       timeout=timeout)
    return ANSI.sub("", (r.stdout or "")), ANSI.sub("", (r.stderr or "")), r.returncode


def parse_json(out):
    """从 wrangler 输出里抠出第一段 JSON（前面可能有提示行）。"""
    i = out.find("[")
    if i < 0:
        i = out.find("{")
    if i < 0:
        return None
    for end in range(len(out), i, -1):
        try:
            return json.loads(out[i:end])
        except Exception:
            continue
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    print("== 导出 universe 访客统计 ==\n  KV 命名空间: %s" % NS)

    # ① 列键
    #
    # 为什么要重试一次：**冷启动的第一次调用会失败**。实测第一次跑时 wrangler
    # 先做登录态/账号解析（stdout 打出 "Getting User settings..."、OAuth 邮箱、
    # 一张账号表格），然后**根本没执行 kv 命令就退出了** —— stdout 里没有 JSON，
    # parse_json 返回 None，脚本报「列键失败」。紧接着手工再跑同一条命令就正常。
    # 这属于 CLI 首次运行的预热行为，不是配置错误，所以**自动重试一次**，
    # 而不是让人看到红色报错就以为 KV 坏了。
    keys = None
    for attempt in (1, 2):
        out, err, rc = wrangler(["kv", "key", "list", "--namespace-id", NS, "--remote"])
        keys = parse_json(out)
        if keys:
            break
        if attempt == 1:
            print("  ⚠️ 第 1 次列键没拿到 JSON（rc=%s，常见于 CLI 冷启动），重试…" % rc)
    if not keys:
        print("🔴 列键失败（拿不到 JSON，已重试 1 次）。原始输出前 300 字：")
        print((out + err)[:300])
        return 2
    print("  键总数: %d" % len(keys))

    # ② 逐键取值（累计类 + 逐日明细；seen:* 去重标记只记数量，无留档价值）
    snapshot = {
        "exportedAt": datetime.datetime.now().astimezone().isoformat(),
        "namespaceId": NS,
        "counts": {},       # total / days
        "daily": {},        # 逐日明细 {"2026-10-11": 7}
        "seenMarkers": 0,   # 去重标记数量（有 TTL，不导出具体值）
        "keysTotal": len(keys),
    }
    for k in keys:
        name = k.get("name", "")
        if name.startswith("seen:"):
            snapshot["seenMarkers"] += 1
            continue
        o2, e2, _ = wrangler(["kv", "key", "get", "--namespace-id", NS,
                              "--remote", name])
        val = o2.strip()
        if re.match(r"^\d{4}-\d{2}-\d{2}$", name):
            snapshot["daily"][name] = int(val) if val.isdigit() else val
        else:
            snapshot["counts"][name] = int(val) if val.isdigit() else val

    snapshot["dailyTotal"] = sum(v for v in snapshot["daily"].values()
                                 if isinstance(v, int))

    # ③ 落盘
    out_path = args.out or os.path.join(
        OUTDIR, "visits-%s.json" % datetime.date.today().isoformat())
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    io.open(out_path, "w", encoding="utf-8", newline="\n").write(
        json.dumps(snapshot, ensure_ascii=False, indent=1) + "\n")

    print("\n  累计类:")
    for k, v in snapshot["counts"].items():
        print("    %-8s %s" % (k, v))
    print("  逐日明细: %d 天，合计 %d" % (len(snapshot["daily"]), snapshot["dailyTotal"]))
    for d in sorted(snapshot["daily"]):
        print("    %s  %s" % (d, snapshot["daily"][d]))
    print("  去重标记: %d 个（有 TTL，不导出具体值）" % snapshot["seenMarkers"])
    print("\n  ✅ 已写出: %s" % out_path)
    print("  ⚠️ 注意：`total` 与 `daily 合计` 可能不相等 ——")
    print("     total 是「曾被计入的次数」，早期版本或并发丢计数都会让两者有差。")
    print("     留档保留两者原值，**不做对齐**，以免抹掉真实差异。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
