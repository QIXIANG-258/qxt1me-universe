# -*- coding: utf-8 -*-
"""
push 前隐私预检：在**将要提交的文件**里找凭据、本机路径、个人信息。

清单从 git 现取（不自己模拟 .gitignore —— 自己写的规则表迟早和真实规则跑偏）。
用法：
    python _tools/precheck.py
"""
import re
import subprocess
import sys
from pathlib import Path

# 用脚本自身位置推导项目根，不写死盘符路径（站群搬过一次，写死的全失效了）
ROOT = Path(__file__).resolve().parent.parent

# (说明, 正则)
PATTERNS = [
    ("长十六进制串（可能是 key/token）", re.compile(r"\b[0-9a-fA-F]{40,}\b")),
    # 赋值语句要求右侧**确实跟着一个像凭据的长串**（≥16 字符的连续非空白、非引号结束）。
    # 不放行 `password="` 这种字段名比较、也不放行 `token = get_token()` 这类变量赋值 ——
    # 那些是代码本身，不是泄漏。判据收窄的是「误报」，不是「覆盖面」。
    ("疑似硬编码凭据",
     re.compile(r"(?i)\b(secret|access_key|api[_-]?key|token|password|passwd)\b\s*[:=]\s*[\"']?[A-Za-z0-9_\-]{16,}")),
    ("Bearer 令牌", re.compile(r"(?i)bearer\s+[A-Za-z0-9._\-]{16,}")),
    ("私钥块", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    ("GitHub 令牌形态（ghp_/github_pat_）", re.compile(r"\b(ghp_|github_pat_)[A-Za-z0-9_]{20,}")),
    ("AWS 访问密钥形态（AKIA…）", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    # 本机路径与身份：要求出现真实的用户名段（不是举例里的占位）
    ("Windows 本机绝对路径", re.compile(r"[A-Z]:\\Users\\[A-Za-z0-9._\-]+")),
    ("邮箱地址", re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")),
]

# 允许出现的白名单（正则）
ALLOW = [
    # universe.qxt1me.dpdns.org / blog.qxt1me.dpdns.org 是公开域名，不是敏感信息
    re.compile(r"qxt1me\.dpdns\.org"),
    # GitHub 仓库地址（本来就是要公开的）
    re.compile(r"github\.com/QIXIANG-258"),
    # 文档里说明性的占位
    re.compile(r"0\.0\.0\.0|127\.0\.0\.1"),
]


def git_files():
    out = subprocess.run(
        ["git", "-C", str(ROOT), "diff", "--cached", "--name-only"],
        capture_output=True, text=True, encoding="utf-8",
    )
    return [l.strip() for l in out.stdout.splitlines() if l.strip()]


def main():
    files = git_files()
    if not files:
        print("[!] 暂存区是空的，先 git add -A")
        return 1

    print(f"待检查 {len(files)} 个文件\n")
    hits = []

    for rel in files:
        p = ROOT / rel
        if not p.is_file():
            continue
        # 二进制（字体）跳过文本扫描
        if p.suffix.lower() in {".woff2", ".woff", ".ttf", ".png", ".jpg", ".jpeg", ".webp", ".ico"}:
            print(f"  [跳过二进制] {rel}")
            continue
        try:
            text = p.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            print(f"  [非 UTF-8，跳过] {rel}")
            continue

        for lineno, line in enumerate(text.splitlines(), 1):
            for label, rx in PATTERNS:
                for m in rx.finditer(line):
                    frag = m.group(0)
                    if any(a.search(frag) for a in ALLOW):
                        continue
                    hits.append((rel, lineno, label, frag[:70]))

    if not hits:
        print("\n[ok] 未发现凭据 / 本机路径 / 个人信息")
        return 0

    print(f"\n[!] 命中 {len(hits)} 处，逐条确认：")
    for rel, lineno, label, frag in hits:
        print(f"  {rel}:{lineno}  [{label}]  {frag}")
    return 2


if __name__ == "__main__":
    sys.exit(main())
