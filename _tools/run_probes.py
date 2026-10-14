#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""universe 探针套件 —— 分层单入口。

用法:
    python _tools/run_probes.py                 # 全部
    python _tools/run_probes.py --layer static
    python _tools/run_probes.py --list
    python _tools/run_probes.py probe_visits.js

## 分层（与 01-blog / 03-gear / 05-game-2048 / 06-GIS-Proj 对齐）

| 层 | 需要什么 | 什么时候跑 |
|---|---|---|
| `static` | 只要 node + 静态服务 `:8802` | 改结构/配色（不碰 Worker） |
| `api` | 需要真 Worker（本地 `wrangler dev` 或线上） | 改 `/api/visits` 或 KV 逻辑 |
| `online` | 需要线上地址 | 发布前终检 |

## 环境前提（不满足时**明说**，不假装通过）

1. **静态层要静态服务**：`python -m http.server 8802 --bind 127.0.0.1`（工作目录 `src/`）
2. **`NODE_PATH` 指向含 `ws` 的 node_modules**（脚本自动找）
3. **api 层要 `/api/visits` 可用** —— 这个接口**不在静态服务里**，
   `python -m http.server` 不跑 Worker。所以要么打线上，要么本机起
   `npx.cmd --yes wrangler@4 dev --port 8799 --local`。

> ⚠️ 本站在这点上与其他站不同：**它是唯一有服务端代码的站**，
> 所以 `probe_visits.js` 这类探针打本地静态服务会**全红**（拿不到 JSON）。
> 那不是缺陷，是环境没配 —— 脚本会识别并标明。
"""
import argparse
import glob
import io
import os
import socket
import subprocess
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
LOG_DIR = os.path.join(os.environ.get("TEMP", HERE), "universe_probe_logs")
STATIC_PORT = 8802

SUITE = [
    ("probe_universe.js",        "static",  True),
    ("probe_interact.js",        "static",  True),
    ("probe_engine_route.js",    "static",  True),
    ("probe_visits.js",          "api",     False),
    ("probe_geo.js",             "online",  False),
    ("probe_favicon.js",         "static",  True),
    ("probe_weather_fallback.js", "static", True),
    ("probe_scene_light.js",     "static",  True),
    ("probe_scene_contrast.js",  "static",  True),
    ("probe_light_baseline.js",  "static",  True),
    ("probe_layer_isolation.js", "static",  True),
    ("probe_secret_code.js",     "static",  True),
]


def find_node():
    for p in [r"D:\node.js\node.exe",
              r"C:\Users\qixiang\.workbuddy\binaries\node\versions\*\node.exe"]:
        hits = sorted(glob.glob(p))
        if hits:
            return hits[-1]
    return None


def find_node_path():
    for p in [r"D:\QX_t1me_plan\_dep\node_modules",
              r"C:\Users\qixiang\.workbuddy\binaries\node\workspace\node_modules",
              r"D:\dsh_blog_proj\_tmp_eval\node_modules"]:
        if os.path.isdir(p):
            return p
    return None


def port_up(port):
    s = socket.socket()
    s.settimeout(1.0)
    try:
        s.connect(("127.0.0.1", port))
        return True
    except Exception:
        return False
    finally:
        s.close()


def summarize(text):
    for ln in reversed(text.splitlines()):
        if "失败" in ln and ("通过" in ln or "项" in ln):
            return ln.strip()
    for ln in reversed(text.splitlines()):
        if "通过" in ln or "OK" in ln or "✗" in ln:
            return ln.strip()
    return ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--layer", choices=["static", "api", "online", "all"], default="all")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("files", nargs="*")
    args = ap.parse_args()

    if args.list:
        for f, layer, _ in SUITE:
            print("  %-28s %s" % (f, layer))
        return 0

    node = find_node()
    npath = find_node_path()
    if not node or not npath:
        print("🔴 环境失败：%s" % ("找不到 node" if not node else "找不到含 ws 的 node_modules"))
        return 2

    todo = [(f, l, need) for f, l, need in SUITE
            if (args.layer == "all" or l == args.layer)
            and (not args.files or f in args.files)]

    static_up = port_up(STATIC_PORT)
    print("环境：node=%s" % node)
    print("      NODE_PATH=%s" % npath)
    print("      静态服务 :%d %s" % (STATIC_PORT, "在跑 ✓" if static_up else "未启动 ✗"))
    if any(l == "static" for _, l, _ in todo) and not static_up:
        print("⚠️  静态层需要它：cd src; python -m http.server %d --bind 127.0.0.1" % STATIC_PORT)
    if any(l == "api" for _, l, _ in todo):
        print("      注意：api 层打的是 PROBE_URL，默认 http://127.0.0.1:8799/")
        print("            该端口需要 `npx.cmd --yes wrangler@4 dev --port 8799 --local`")
        print("            或设 PROBE_URL=https://universe.qxt1me.dpdns.org/ 打线上")
    print("")

    os.makedirs(LOG_DIR, exist_ok=True)
    rows = []
    for f, layer, _ in todo:
        cmd = [node, f] if f.endswith(".js") else [node, f]
        env = dict(os.environ)
        env["NODE_PATH"] = npath
        log = os.path.join(LOG_DIR, f.replace(".", "_") + ".txt")
        with io.open(log, "w", encoding="utf-8", errors="replace") as fh:
            rc = subprocess.run(cmd, cwd=HERE, env=env, stdout=fh,
                                stderr=subprocess.STDOUT, timeout=900).returncode
        txt = io.open(log, encoding="utf-8", errors="replace").read()
        rows.append((f, layer, rc, summarize(txt)))
        print("  %-28s [%-6s] rc=%d  %s" % (f, layer, rc, rows[-1][3] or "(无汇总行)"))
        sys.stdout.flush()

    bad = [r for r in rows if r[2] != 0]
    print("\n共 %d 套（层=%s），rc!=0 的 %d 套" % (len(rows), args.layer, len(bad)))
    for f, layer, rc, ln in bad:
        print("  - %-28s [%s] rc=%d  %s" % (f, layer, rc, ln))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
