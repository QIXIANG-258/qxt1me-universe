/* 会读 src/_headers 并真的把它当响应头发出去的静态服务。
   用途：本地端到端验证「_headers 的改动会不会被探针抓到」——
   python -m http.server 不读 _headers，所以以前这类判据只能等部署后才验。
   跑法：node _tools/_serve_with_headers.js [port] */
"use strict";
const fs = require("fs");
const path = require("path");
const http = require("http");

const SRC = path.join(__dirname, "..", "src");
const PORT = Number(process.argv[2] || 8820);

/* 解析 Workers/Pages 的 _headers 语法：
   <路径模式>            ← 顶格
     Header-Name: value  ← 缩进
   只实现本项目用到的：精确路径与 /* 兜底；取「首个命中」的规则（与 CF 一致）。 */
function parseHeaders(file) {
  if (!fs.existsSync(file)) return [];
  const blocks = [];
  let cur = null;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!raw.trim() || /^\s*#/.test(raw)) continue;
    if (/^\s/.test(raw)) {
      if (!cur) continue;
      const i = raw.indexOf(":");
      if (i > 0) cur.headers.push([raw.slice(0, i).trim(), raw.slice(i + 1).trim()]);
    } else {
      cur = { pattern: raw.trim(), headers: [] };
      blocks.push(cur);
    }
  }
  return blocks;
}

/* ⚠️ 每次请求都**重新读** _headers，不要缓存进常量 ——
   本服务的一个重要用途是「改了 _headers 后立刻重跑探针」做注入实证，
   缓存住的话改了文件也不生效，会让人误判成「探针抓不到」。
   （这个坑我自己踩过一次：注入故障后探针仍然全绿，差点误判判据失效。） */
function loadBlocks() {
  return parseHeaders(path.join(SRC, "_headers"));
}

function matchBlocks(blocks, pathname) {
  // 与 CF 行为近似：精确路径优先，其次 /* 兜底
  const exact = blocks.filter((b) => b.pattern === pathname);
  const star = blocks.filter((b) => b.pattern === "/*");
  return exact.concat(star);
}

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2", ".png": "image/png", ".ico": "image/x-icon",
  ".xml": "application/xml; charset=utf-8", ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  let f = path.join(SRC, urlPath);
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
  if (!fs.existsSync(f)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("404");
    return;
  }
  const buf = fs.readFileSync(f);
  const h = { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" };
  const blocks = loadBlocks();                       // ← 每次现读
  for (const b of matchBlocks(blocks, urlPath)) {
    for (const [k, v] of b.headers) if (!(k.toLowerCase() in h)) h[k] = v;
  }
  res.writeHead(200, h);
  res.end(buf);
}).listen(PORT, "127.0.0.1", () => {
  console.log("serving " + SRC + " on http://127.0.0.1:" + PORT +
              "  （_headers 每次请求现读；当前规则 " + loadBlocks().length + " 条）");
});
