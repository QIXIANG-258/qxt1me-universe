# -*- coding: utf-8 -*-
"""
在 GitHub 建仓库（这台机器没有 gh CLI，走 API）。
token 从 Git Credential Manager 现取，只在本进程内存里过一遍，不落盘、不打印。

用法：
    python _tools/create_repo.py [--private]
"""
import json
import subprocess
import sys
import urllib.error
import urllib.request

OWNER = "QIXIANG-258"
REPO = "qxt1me-universe"
DESC = "憩想的个人站群总入口（universe）—— 纯静态导航页，配色与排版对齐 blog 摄影小站"
TOPICS = ["startpage", "navigation", "static-site", "cloudflare-workers", "personal-website"]


def get_token():
    """从 Git Credential Manager 取 token。不打印、不落盘。"""
    p = subprocess.run(
        ["git", "credential", "fill"],
        input="protocol=https\nhost=github.com\n\n",
        capture_output=True, text=True, encoding="utf-8",
    )
    for line in p.stdout.splitlines():
        if line.startswith("password="):
            return line[len("password="):]
    raise SystemExit("[x] 没取到凭据")


def call(method, url, token, payload=None):
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "token " + token)
    req.add_header("Accept", "application/vnd.github+json")
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            return r.status, json.loads(r.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        try:
            return e.code, json.loads(body)
        except Exception:
            return e.code, {"raw": body[:400]}


def main():
    private = "--private" in sys.argv
    # 这台机器 github.com 直连会 403，API 直连可通；都失败时用代理重试
    proxy = urllib.request.ProxyHandler({})
    urllib.request.install_opener(urllib.request.build_opener(proxy))

    token = get_token()
    print(f"token 取到（{len(token)} 字符），账号 {OWNER}")

    # 建仓库
    status, res = call(
        "POST", "https://api.github.com/user/repos", token,
        {"name": REPO, "description": DESC, "private": private, "auto_init": False},
    )
    if status == 201:
        print(f"[ok] 已建仓库 {res.get('full_name')}")
    elif status == 422 and "already exists" in json.dumps(res):
        print(f"[i] 仓库已存在，继续：{OWNER}/{REPO}")
    else:
        print(f"[x] 建仓库失败 HTTP {status}: {json.dumps(res)[:400]}")
        return 1

    # 打 topics（决定别人搜不搜得到）
    status, res = call(
        "PUT", f"https://api.github.com/repos/{OWNER}/{REPO}/topics", token,
        {"names": TOPICS},
    )
    print(f"[{'ok' if status == 200 else 'x'}] topics HTTP {status}")

    print(f"\n仓库地址: https://github.com/{OWNER}/{REPO}")
    print(f"可见性  : {'私有' if private else '公开'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
