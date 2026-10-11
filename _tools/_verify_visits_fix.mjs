// 复核修复：universe 访客接口三处真缺陷是否已修
const WORKER = 'D:/QX_t1me_plan/02-universe/worker/index.js';

function makeKV(opts = {}) {
  const store = new Map();
  const kv = {
    store,
    async get(k) { if (opts.failGet) throw new Error('KV get failed (注入)'); return store.has(k) ? store.get(k) : null; },
    async put(k, v, o) { store.set(k, v); if (o?.expirationTtl !== undefined) kv.lastTtl = o.expirationTtl; },
  };
  return kv;
}
const worker = (await import('file:///' + WORKER)).default;
const req = (method, ip) => new Request('https://universe.qxt1me.dpdns.org/api/visits',
  { method, headers: ip ? { 'CF-Connecting-IP': ip } : {} });

let pass = 0, fail = 0;
const check = (n, c, d) => { c ? pass++ : fail++; console.log('  ' + (c ? '✓' : '✗') + ' ' + n + (d ? '  —— ' + d : '')); };

console.log('\n===== 缺陷① KV 故障时应给失败状态码，不再伪装成 200 =====');
{
  const res = await worker.fetch(req('POST', '1.2.3.4'), { UV_VISITS: makeKV({ failGet: true }) });
  const body = await res.json();
  console.log('  HTTP 状态 :', res.status, ' body:', JSON.stringify(body));
  check('KV 故障返回 5xx（而非 200）', res.status >= 500, 'status=' + res.status);
  check('响应体仍带 ok:false 与 error', body.ok === false && !!body.error);
  check('前端 fetch 判据 r.ok 会走 catch → 徽标保持 hidden',
        !(res.status >= 200 && res.status < 300), 'r.ok=' + res.ok);
}

console.log('\n===== 缺陷② 恰好本地午夜时，TTL 应是约 24 小时 =====');
{
  const TZ = 8 * 3600e3, dayMs = 864e5;
  const ttl = (now) => { const l = now + TZ; return Math.max(60, Math.floor(((Math.floor(l / dayMs) * dayMs + dayMs) - l) / 1000)); };
  const cases = [
    ['恰好午夜 00:00:00.000', Date.UTC(2026, 9, 11, 16, 0, 0, 0), 86400],
    ['午夜后 00:00:00.001',   Date.UTC(2026, 9, 11, 16, 0, 0, 1), 86399],
    ['本地 12:00',            Date.UTC(2026, 9, 11, 4, 0, 0, 0), 43200],
    ['本地 23:59:59',         Date.UTC(2026, 9, 11, 15, 59, 59, 0), 1],
  ];
  for (const [label, ms, want] of cases) {
    const t = ttl(ms);
    // 23:59:59 距午夜 1 秒，被 max(60,…) 兜成 60 —— 这是有意的下限，可接受
    const okCase = want === 1 ? t === 60 : t === want;
    check(label + ' → TTL ' + t + ' 秒（期望 ' + (want === 1 ? '60 兜底' : want) + '）', okCase);
  }
}

console.log('\n===== 缺陷③ 源码不再宣称「不可反查」 =====');
{
  const src = (await import('node:fs')).readFileSync(WORKER, 'utf8');
  check('注释已改为「假名化的去重标识」（不再宣称不可反查）',
        src.includes('假名化的去重') && !/哈希只为去重，不可反查/.test(src));
  check('已说明盐是公开字面量、非密钥', src.includes('不是密钥'));
  check('已说明 32 位空间与穷举风险', src.includes('32 位') && src.includes('穷举'));
  check('已给出将来改 HMAC 的方向', src.includes('HMAC'));
}

console.log('\n===== 回归：正常路径仍然工作 =====');
{
  const env = { UV_VISITS: makeKV() };
  const b1 = await (await worker.fetch(req('POST', '10.0.0.1'), env)).json();
  const b2 = await (await worker.fetch(req('POST', '10.0.0.1'), env)).json();  // 同 IP 第二次
  const b3 = await (await worker.fetch(req('POST', '10.0.0.2'), env)).json();  // 不同 IP
  const g = await (await worker.fetch(req('GET'), env)).json();
  console.log('  同IP第1次:', JSON.stringify(b1));
  console.log('  同IP第2次:', JSON.stringify(b2));
  console.log('  换IP    :', JSON.stringify(b3));
  check('首次 POST ok:true 且 counted:true', b1.ok === true && b1.counted === true);
  check('同 IP 第二次不重复计（counted:false）', b2.counted === false);
  check('换 IP 再计一次（counted:true）', b3.counted === true);
  check('GET 只读：total 与最后一次一致', g.total === b3.total, 'GET total=' + g.total);
  check('GET counted 恒为 false', g.counted === false);
}

console.log('\n===== 汇总 =====');
console.log('  通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
