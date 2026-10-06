# -*- coding: utf-8 -*-
"""
从 Photo_proj 的 style.css 里抽出全部 @font-face 声明，写成 universe 的 fonts.css。

为什么不手抄：blog 的衬线按 unicode-range 切成了 core/rest 两片，声明区有 170 多行
字符区间。手抄一个码位写错，浏览器会静默丢弃整条声明（blog 的 CSS 注释里记过这个坑），
表现为字体悄悄退回系统宋体，肉眼很难发现。所以这里做机械抽取。

用法：
    python _tools/extract_fonts.py
"""
import re
import sys
from pathlib import Path

SRC = Path(r"D:\Photo_proj\src\css\style.css")
DST = Path(r"D:\universe_proj\src\css\fonts.css")

# 深色主题块之前的内容就是字体声明区
STOP_MARKER = "深色主题"


def main() -> int:
    if not SRC.exists():
        print(f"[x] 源文件不存在：{SRC}")
        return 1

    lines = SRC.read_text(encoding="utf-8").splitlines()

    # 找第一个 @font-face，以及"深色主题"标记行（声明区的右边界）
    start = next((i for i, l in enumerate(lines) if "@font-face" in l), None)
    stop = next((i for i, l in enumerate(lines) if STOP_MARKER in l), None)
    if start is None or stop is None or stop <= start:
        print("[x] 没定位到字体声明区，源文件结构可能变了")
        return 1

    # 往前回退，把紧贴 @font-face 的那段说明注释也带上
    while start > 0 and lines[start - 1].strip().startswith(("/*", "*", "自托管")):
        start -= 1

    block = lines[start:stop]
    # 去掉尾部空行
    while block and not block[-1].strip():
        block.pop()

    text = "\n".join(block)

    # 自校验：抽出来的 @font-face 条数与 unicode-range 条数
    n_face = len(re.findall(r"@font-face", text))
    n_range = len(re.findall(r"unicode-range", text))
    if n_face < 3:
        print(f"[x] 只抽到 {n_face} 条 @font-face，明显偏少，中止")
        return 1

    header = (
        "/* =========================================================\n"
        "   自托管字体声明 —— 由 _tools/extract_fonts.py 从 blog 的 style.css 机械抽取，\n"
        "   请勿手改。改字体请回 Photo_proj 改，再重跑脚本同步过来。\n"
        f"   抽出 @font-face {n_face} 条，其中带 unicode-range 切片 {n_range} 条。\n"
        "   路径：字体文件在 ../fonts/（与 blog 同一批 woff2）\n"
        "   ========================================================= */\n"
    )
    DST.parent.mkdir(parents=True, exist_ok=True)
    # ⚠️ 必须用 write_bytes 而不是 write_text：
    #    Windows 上 Path.write_text 的默认换行会把 \n 翻成 \r\n（Python 3.9
    #    没有 newline= 参数），于是抽出来的 fonts.css 是 CRLF，而仓库按
    #    「* text=auto eol=lf」存成 LF → 部署出去的字节与本地验证过的字节不一致。
    #    统一按 LF 落盘，保证脚本可重复、产物与仓库一致。
    DST.write_bytes((header + text + "\n").encode("utf-8"))

    # 自校验：确认落盘的是纯 LF（CR 必须为 0）
    raw = DST.read_bytes()
    n_cr = raw.count(b"\r")
    if n_cr:
        print(f"[x] 落盘后仍有 {n_cr} 个 CR，行尾没规范成功")
        return 1

    print(f"[ok] 写入 {DST}")
    print(f"     @font-face {n_face} 条 / unicode-range {n_range} 条 / "
          f"{len(block)} 行 / {DST.stat().st_size / 1024:.1f} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
