'use strict';
/*
 * 第 335 次：回归测试用的假 Web Push 服务（自签 HTTPS）。
 * 启动时生成一份真的订阅密钥（P-256 + auth），把 { port, endpoint, p256dh, auth } 打到 stdout 第一行；
 * 中转按 Web Push 标准（aes128gcm + VAPID）推过来时，用 http_ece 解开，把明文负载一行一条追加到 HITS_FILE。
 * 用法：NODE_PATH=<中转 server/node_modules> HITS_FILE=/path/hits.jsonl node tests/fakepush.js
 */
const https = require('node:https');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ece = require('http_ece');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yiya-fp-'));
const key = path.join(dir, 'k.pem'), crt = path.join(dir, 'c.pem');
execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', key, '-out', crt, '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
const subs = {};
function mk(name) {
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  subs[name] = { ecdh, auth };
  return { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') };
}
const out = process.env.HITS_FILE;
const srv = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(crt) }, (req, res) => {
  const chunks = []; req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const name = req.url.split('/').pop();
    const rec = { name, t: Date.now(), topic: req.headers.topic || null, ttl: req.headers.ttl || null, ok: false };
    try {
      const s = subs[name];
      rec.payload = JSON.parse(ece.decrypt(Buffer.concat(chunks), { version: 'aes128gcm', privateKey: s.ecdh, authSecret: s.auth }).toString('utf8'));
      rec.ok = true;
    } catch (e) { rec.err = String(e.message).slice(0, 80); }
    fs.appendFileSync(out, JSON.stringify(rec) + '\n');
    res.statusCode = 201; res.end();
  });
});
srv.listen(0, '127.0.0.1', () => {
  const port = srv.address().port;
  const info = { port, subs: {} };
  for (const n of ['a', 'b', 'c']) info.subs[n] = Object.assign({ endpoint: `https://127.0.0.1:${port}/push/${n}` }, mk(n));
  process.stdout.write(JSON.stringify(info) + '\n');
});
process.on('SIGTERM', () => { srv.close(); fs.rmSync(dir, { recursive: true, force: true }); process.exit(0); });
