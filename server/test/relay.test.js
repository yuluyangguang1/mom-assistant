'use strict';
/* 端到端：起一个真实进程（临时目录、随机端口），用 HTTP 打全部接口；推送打到本地自签 HTTPS 假推送服务。 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { fork, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const crypto = require('node:crypto');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'yiya-relay-'));
const PORT = 18787 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
let proc, fakePush, pushHits = [], pushStatus = 201;

async function api(method, p, { body, tok, origin, raw } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (tok) headers.authorization = `Bearer ${tok.deviceId}:${tok.token}`;
  if (origin) headers.origin = origin;
  const r = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : (raw ? body : JSON.stringify(body)) });
  const text = await r.text();
  return { status: r.status, headers: r.headers, json: text ? JSON.parse(text) : null };
}

before(async () => {
  /* 自签证书的假推送服务 */
  const key = path.join(home, 'k.pem'), crt = path.join(home, 'c.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', key, '-out', crt, '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
  fakePush = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(crt) }, (req, res) => {
    const chunks = []; req.on('data', c => chunks.push(c));
    req.on('end', () => { pushHits.push({ path: req.url, headers: req.headers, size: Buffer.concat(chunks).length }); res.statusCode = pushStatus; res.end(); });
  });
  await new Promise(r => fakePush.listen(0, '127.0.0.1', r));

  proc = fork(path.join(__dirname, '..', 'src', 'index.js'), [], {
    execArgv: ['--disable-warning=ExperimentalWarning'],
    env: { ...process.env, YIYA_HOME: home, PORT: String(PORT), PUSH_ANY_ENDPOINT: '1', NODE_TLS_REJECT_UNAUTHORIZED: '0',
      RATE_CREATE_PER_HOUR: '3', MAX_DEVICES: '3', FAMILY_QUOTA_BYTES: '4000', RATE_NOTIFY_PER_MIN: '3' },
    stdio: ['ignore', 'ignore', 'inherit', 'ipc']
  });
  await new Promise((res, rej) => { proc.once('message', m => m === 'ready' && res()); proc.once('exit', c => rej(new Error('exit ' + c))); });
});

after(async () => {
  proc && proc.kill('SIGTERM');
  fakePush && fakePush.close();
  await new Promise(r => setTimeout(r, 200));
  fs.rmSync(home, { recursive: true, force: true });
});

const ct = n => crypto.randomBytes(n).toString('base64url');
let fam, A, B, C;

test('health 与 VAPID 公钥', async () => {
  const h = await api('GET', '/v1/health');
  assert.equal(h.status, 200); assert.equal(h.json.ok, true);
  assert.equal(h.headers.get('cache-control'), 'no-store');
  const k = await api('GET', '/v1/push/key');
  assert.match(k.json.publicKey, /^[A-Za-z0-9_-]{87}$/);
  assert.ok(fs.existsSync(path.join(home, 'secrets', 'vapid.json')));
  assert.ok(fs.existsSync(path.join(home, 'data', 'relay.db')));
});

test('CORS：白名单回显，其他来源不给头', async () => {
  const ok = await api('GET', '/v1/health', { origin: 'https://yuluyangguang1.github.io' });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://yuluyangguang1.github.io');
  const bad = await api('GET', '/v1/health', { origin: 'https://evil.example' });
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
  const pre = await fetch(BASE + '/v1/families', { method: 'OPTIONS', headers: { origin: 'https://yuluyangguang1.github.io' } });
  assert.equal(pre.status, 204);
});

test('建家、发邀请、扫码加入、邀请一次性', async () => {
  const r = await api('POST', '/v1/families', { body: { name: '妈妈的手机' } });
  assert.equal(r.status, 201);
  fam = r.json.familyId; A = r.json;
  assert.match(fam, /^f_/); assert.match(A.deviceId, /^d_/); assert.equal(A.token.length, 43);

  const inv = await api('POST', `/v1/families/${fam}/invites`, { tok: A });
  assert.equal(inv.status, 201);
  const j = await api('POST', '/v1/join', { body: { familyId: fam, invite: inv.json.invite, name: '爸爸' } });
  assert.equal(j.status, 201); B = j.json;
  assert.equal(j.json.devices.length, 2);
  const again = await api('POST', '/v1/join', { body: { familyId: fam, invite: inv.json.invite } });
  assert.equal(again.status, 403);

  const inv2 = await api('POST', `/v1/families/${fam}/invites`, { tok: B });
  C = (await api('POST', '/v1/join', { body: { familyId: fam, invite: inv2.json.invite, name: '外婆' } })).json;
  /* 满员（测试设成 3 台） */
  const inv3 = await api('POST', `/v1/families/${fam}/invites`, { tok: A });
  assert.equal(inv3.status, 409);
});

test('鉴权：错 token、跨家、格式错都 401', async () => {
  assert.equal((await api('GET', `/v1/families/${fam}/devices`)).status, 401);
  assert.equal((await api('GET', `/v1/families/${fam}/devices`, { tok: { deviceId: A.deviceId, token: ct(32) } })).status, 401);
  const other = (await api('POST', '/v1/families', { body: {} })).json;
  assert.equal((await api('GET', `/v1/families/${other.familyId}/devices`, { tok: A })).status, 401);
  assert.equal((await api('GET', `/v1/families/${fam}/devices`, { tok: other })).status, 401);
  const d = await api('GET', `/v1/families/${fam}/devices`, { tok: A });
  assert.equal(d.status, 200); assert.equal(d.json.me, A.deviceId); assert.equal(d.json.devices.length, 3);
  assert.ok(!JSON.stringify(d.json).includes('token'));
});

test('消息：发给其他人、各自取、全部确认后删除', async () => {
  const m1 = await api('POST', `/v1/families/${fam}/messages`, { tok: A, body: { ct: ct(300), kind: 'rec' } });
  assert.equal(m1.status, 201); assert.equal(m1.json.recipients, 2);
  const m2 = await api('POST', `/v1/families/${fam}/messages`, { tok: A, body: { ct: ct(100), to: [B.deviceId] } });
  assert.equal(m2.json.recipients, 1);

  const a = await api('GET', `/v1/families/${fam}/messages`, { tok: A });
  assert.equal(a.json.messages.length, 0, '自己发的自己不收');
  const b = await api('GET', `/v1/families/${fam}/messages`, { tok: B });
  assert.deepEqual(b.json.messages.map(m => m.seq), [m1.json.seq, m2.json.seq]);
  assert.equal(b.json.messages[0].from, A.deviceId);
  const c = await api('GET', `/v1/families/${fam}/messages`, { tok: C });
  assert.deepEqual(c.json.messages.map(m => m.seq), [m1.json.seq]);

  const after1 = await api('GET', `/v1/families/${fam}/messages?after=${m1.json.seq}`, { tok: B });
  assert.deepEqual(after1.json.messages.map(m => m.seq), [m2.json.seq]);

  assert.equal((await api('POST', `/v1/families/${fam}/ack`, { tok: B, body: { upTo: m2.json.seq } })).json.pending, 0);
  assert.equal((await api('GET', `/v1/families/${fam}/messages`, { tok: B })).json.messages.length, 0);
  assert.equal((await api('GET', `/v1/families/${fam}/messages`, { tok: C })).json.messages.length, 1, 'C 没确认，还在');
  await api('POST', `/v1/families/${fam}/ack`, { tok: C, body: { upTo: m1.json.seq } });

  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(path.join(home, 'data', 'relay.db'), { readOnly: true });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM messages').get().n, 0, '全部确认后密文已删除');
  db.close();
});

test('消息校验与家庭容量', async () => {
  assert.equal((await api('POST', `/v1/families/${fam}/messages`, { tok: A, body: { ct: 'not base64!' } })).status, 400);
  assert.equal((await api('POST', `/v1/families/${fam}/messages`, { tok: A, body: { ct: ct(10), kind: 'BAD KIND' } })).status, 400);
  assert.equal((await api('POST', `/v1/families/${fam}/messages`, { tok: A, body: '{bad', raw: true })).status, 400);
  /* 容量测试设成 4000 字符 */
  assert.equal((await api('POST', `/v1/families/${fam}/messages`, { tok: A, body: { ct: ct(2200) } })).status, 201);
  assert.equal((await api('POST', `/v1/families/${fam}/messages`, { tok: A, body: { ct: ct(2200) } })).status, 413);
  for (const t of [B, C]) {
    const r = await api('GET', `/v1/families/${fam}/messages`, { tok: t });
    await api('POST', `/v1/families/${fam}/ack`, { tok: t, body: { upTo: r.json.messages.at(-1).seq } });
  }
  assert.equal((await api('POST', `/v1/families/${fam}/messages`, { tok: A, body: { ct: ct(2200) } })).status, 201);
  for (const t of [B, C]) {
    const r = await api('GET', `/v1/families/${fam}/messages`, { tok: t });
    await api('POST', `/v1/families/${fam}/ack`, { tok: t, body: { upTo: r.json.messages.at(-1).seq } });
  }
});

test('推送：订阅、叫醒、失效订阅自动清掉、限流', async () => {
  const port = fakePush.address().port;
  const p256dh = crypto.createECDH('prime256v1'); p256dh.generateKeys();
  const sub = { endpoint: `https://127.0.0.1:${port}/push/b`, keys: { p256dh: p256dh.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') } };
  assert.equal((await api('PUT', `/v1/families/${fam}/devices/me/push`, { tok: B, body: { subscription: { endpoint: 'x' } } })).status, 400);
  assert.equal((await api('PUT', `/v1/families/${fam}/devices/me/push`, { tok: B, body: { subscription: sub } })).status, 200);

  pushHits = [];
  const n = await api('POST', `/v1/families/${fam}/notify`, { tok: A, body: { kind: 'come', ct: ct(64) } });
  assert.equal(n.status, 200);
  assert.deepEqual(n.json, { sent: 1, failed: 0, noSub: 1 });
  assert.equal(pushHits.length, 1);
  assert.match(pushHits[0].headers.authorization, /^vapid t=/);
  assert.equal(pushHits[0].headers['content-encoding'], 'aes128gcm');
  assert.equal(pushHits[0].headers.urgency, 'high');

  pushStatus = 410;
  const g = await api('POST', `/v1/families/${fam}/notify`, { tok: A, body: { kind: 'come' } });
  assert.equal(g.json.failed, 1);
  const devs = (await api('GET', `/v1/families/${fam}/devices`, { tok: A })).json.devices;
  assert.equal(devs.find(d => d.deviceId === B.deviceId).push, false, '410 后订阅被清除');
  pushStatus = 201;

  assert.equal((await api('POST', `/v1/families/${fam}/notify`, { tok: A, body: { kind: 'come' } })).status, 200);
  assert.equal((await api('POST', `/v1/families/${fam}/notify`, { tok: A, body: { kind: 'come' } })).status, 429, '每分钟 3 次（测试值）');
});

test('移除设备：踢掉丢失的手机后它的 token 失效；最后一台退出整个家删除', async () => {
  assert.equal((await api('DELETE', `/v1/families/${fam}/devices/${C.deviceId}`, { tok: A })).status, 204);
  assert.equal((await api('GET', `/v1/families/${fam}/devices`, { tok: C })).status, 401);
  assert.equal((await api('DELETE', `/v1/families/${fam}/devices/me`, { tok: B })).status, 204);
  assert.equal((await api('DELETE', `/v1/families/${fam}/devices/me`, { tok: A })).status, 204);
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(path.join(home, 'data', 'relay.db'), { readOnly: true });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM families WHERE id = ?').get(fam).n, 0);
  db.close();
});

test('建家限流（测试值每小时 3 次）与 404/405', async () => {
  let last;
  for (let i = 0; i < 3; i++) last = await api('POST', '/v1/families', { body: {} });
  assert.equal(last.status, 429);
  assert.equal((await api('GET', '/v1/nope')).status, 404);
  assert.equal((await api('PUT', '/v1/health')).status, 405);
  const h = await fetch(BASE + '/v1/health', { method: 'HEAD' });
  assert.equal(h.status, 200, 'HEAD 探活');
  assert.equal((await h.text()).length, 0);
});

test('日志不含 token / 密文', async () => {
  const dir = path.join(home, 'logs');
  const all = fs.readdirSync(dir).map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('');
  assert.ok(all.includes('listening'));
  for (const t of [A.token, B.token]) assert.ok(!all.includes(t));
  assert.ok(!all.includes(fam), '家庭 ID 只记前缀');
});
