'use strict';
/*
 * 第 335 次（v0.2.0）：预约提醒端到端测试。
 * 起真实进程（临时目录、随机端口）+ 本地自签 HTTPS 假推送服务；订阅用真的 P-256 密钥，
 * 假推送服务用 http_ece 把 aes128gcm 推送解开，核对负载里只有 { t, r, id, ct, at } 且 ct 原样转发。
 * 覆盖：注册 / 鉴权、单条增改删、整批替换（去重 / 跳过 / 上限）、到点发送后删除、重复续排与截止、
 * 前台心跳不推、订阅失效清理、重启后接着排（补发窗口内补、窗口外跳过、重复的续排）、限流、日志不泄露。
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { fork, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const crypto = require('node:crypto');
const ece = require('http_ece');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'yiya-remind-'));
const PORT = 19787 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let proc, fakePush, hits = [], pushStatus = 201;
const subs = {};   /* name → { ecdh, auth } */

const ENV = {
  YIYA_HOME: home, PORT: String(PORT), PUSH_ANY_ENDPOINT: '1', NODE_TLS_REJECT_UNAUTHORIZED: '0',
  MAX_REMINDERS: '5', REMIND_MIN_EVERY_SEC: '1', REMIND_STALE_SEC: '3', REMIND_PUSH_TTL_SEC: '1234',
  PRESENCE_SEC: '30', RATE_RDEV_PER_HOUR: '8'
};

function start(extra) {
  const p = fork(path.join(__dirname, '..', 'src', 'index.js'), [], {
    execArgv: ['--disable-warning=ExperimentalWarning'],
    env: { ...process.env, ...ENV, ...(extra || {}) },
    stdio: ['ignore', 'ignore', 'inherit', 'ipc']
  });
  return new Promise((res, rej) => { p.once('message', m => m === 'ready' && res(p)); p.once('exit', c => rej(new Error('exit ' + c))); });
}
function stop(p) {
  return new Promise(r => { if (!p || p.exitCode != null) return r(); p.once('exit', () => r()); p.kill('SIGTERM'); });
}

async function api(method, p, { body, tok } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (tok) headers.authorization = `Bearer ${tok.deviceId}:${tok.token}`;
  const r = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  return { status: r.status, headers: r.headers, json: text ? JSON.parse(text) : null };
}

function newSub(name) {
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  subs[name] = { ecdh, auth };
  return { endpoint: `https://127.0.0.1:${fakePush.address().port}/push/${name}`,
    keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } };
}
function decode(h) {
  const s = subs[h.name];
  const pt = ece.decrypt(h.body, { version: 'aes128gcm', privateKey: s.ecdh, authSecret: s.auth });
  return JSON.parse(pt.toString('utf8'));
}
async function waitHits(n, ms, filter) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (hits.filter(filter || (() => true)).length >= n) return true;
    await sleep(50);
  }
  return false;
}
const ct = n => crypto.randomBytes(n).toString('base64url');
let A, B;

before(async () => {
  const key = path.join(home, 'k.pem'), crt = path.join(home, 'c.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', key, '-out', crt, '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
  fakePush = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(crt) }, (req, res) => {
    const chunks = []; req.on('data', c => chunks.push(c));
    req.on('end', () => {
      hits.push({ name: req.url.split('/').pop(), headers: req.headers, body: Buffer.concat(chunks), t: Date.now() });
      res.statusCode = pushStatus; res.end();
    });
  });
  await new Promise(r => fakePush.listen(0, '127.0.0.1', r));
  proc = await start();
});

after(async () => {
  await stop(proc);
  fakePush && fakePush.close();
  fs.rmSync(home, { recursive: true, force: true });
});

test('health：v0.2.0，带 remind 能力标记', async () => {
  const h = await api('GET', '/v1/health');
  assert.equal(h.json.version, '0.2.0');
  assert.deepEqual(h.json.features, ['family', 'remind']);
});

test('注册提醒设备、鉴权', async () => {
  const r = await api('POST', '/v1/rdev', { body: {} });
  assert.equal(r.status, 201);
  A = r.json;
  assert.match(A.deviceId, /^r_[A-Za-z0-9_-]{16}$/); assert.equal(A.token.length, 43); assert.equal(A.max, 5);
  B = (await api('POST', '/v1/rdev', {})).json;
  assert.equal((await api('GET', '/v1/rdev/me/reminders')).status, 401);
  assert.equal((await api('GET', '/v1/rdev/me/reminders', { tok: { deviceId: A.deviceId, token: ct(32) } })).status, 401);
  assert.equal((await api('GET', '/v1/rdev/me/reminders', { tok: { deviceId: 'd_' + A.deviceId.slice(2), token: A.token } })).status, 401, '家庭设备 ID 格式不能冒充');
  const l = await api('GET', '/v1/rdev/me/reminders', { tok: A });
  assert.equal(l.status, 200); assert.deepEqual(l.json.reminders, []); assert.equal(l.json.push, false);
  assert.equal((await api('PUT', '/v1/rdev/me/push', { tok: A, body: { subscription: { endpoint: 'nope' } } })).status, 400);
  assert.equal((await api('PUT', '/v1/rdev/me/push', { tok: A, body: { subscription: newSub('a') } })).status, 200);
  assert.equal((await api('PUT', '/v1/rdev/me/push', { tok: B, body: { subscription: newSub('b') } })).status, 200);
  assert.equal((await api('GET', '/v1/rdev/me/reminders', { tok: A })).json.push, true);
});

test('单条：到点发 Web Push，负载只有不透明密文，发完删除；Topic = 提醒 ID、TTL 按配置', async () => {
  hits = [];
  const c1 = ct(120), at = Date.now() + 900;
  const r = await api('PUT', '/v1/rdev/me/reminders/feed', { tok: A, body: { at, ct: c1 } });
  assert.equal(r.status, 200); assert.equal(r.json.at, at);
  assert.equal((await api('GET', '/v1/rdev/me/reminders', { tok: A })).json.reminders.length, 1);
  assert.ok(await waitHits(1, 4000), '到点收到推送');
  const h = hits[0];
  assert.ok(h.t >= at - 50, '不早发');
  assert.ok(h.t - at < 1500, '准点（≤1.5 秒）');
  assert.equal(h.name, 'a');
  assert.equal(h.headers.topic, 'feed');
  assert.equal(h.headers.ttl, '1234');
  assert.equal(h.headers['content-encoding'], 'aes128gcm');
  const pl = decode(h);
  assert.deepEqual(Object.keys(pl).sort(), ['at', 'ct', 'id', 'r', 't']);
  assert.deepEqual(pl, { t: 'rem', r: A.deviceId, id: 'feed', ct: c1, at });
  await sleep(100);
  assert.equal((await api('GET', '/v1/rdev/me/reminders', { tok: A })).json.reminders.length, 0, '一次性的发完即删');
});

test('改约 / 撤销：同一 ID 覆盖不重复、删除后不再发', async () => {
  hits = [];
  const t = Date.now();
  await api('PUT', '/v1/rdev/me/reminders/x1', { tok: A, body: { at: t + 600, ct: ct(40) } });
  const c2 = ct(40);
  await api('PUT', '/v1/rdev/me/reminders/x1', { tok: A, body: { at: t + 1500, ct: c2 } });   /* 改到更晚 */
  await api('PUT', '/v1/rdev/me/reminders/x2', { tok: A, body: { at: t + 700, ct: ct(40) } });
  assert.equal((await api('DELETE', '/v1/rdev/me/reminders/x2', { tok: A })).status, 204);
  assert.equal((await api('DELETE', '/v1/rdev/me/reminders/x2', { tok: A })).status, 204, '删除幂等');
  await sleep(2600);
  assert.equal(hits.length, 1, '只发了改约后的那一次');
  const pl = decode(hits[0]);
  assert.equal(pl.id, 'x1'); assert.equal(pl.ct, c2); assert.ok(hits[0].t >= t + 1450);
});

test('重复：按间隔续排，到截止后删除', async () => {
  hits = [];
  const at = Date.now() + 500;
  const r = await api('PUT', '/v1/rdev/me/reminders/sup1', { tok: B, body: { at, every: 1000, until: at + 2500, ct: ct(30) } });
  assert.equal(r.status, 200);
  assert.ok(await waitHits(3, 5000, h => h.name === 'b'));
  await sleep(1300);
  const got = hits.filter(h => h.name === 'b').map(h => decode(h).at);
  assert.deepEqual(got, [at, at + 1000, at + 2000], '三次、计划时刻各不相同');
  assert.equal((await api('GET', '/v1/rdev/me/reminders', { tok: B })).json.reminders.length, 0);
});

test('整批替换：去重、跳过坏条目 / 已过点、过期重复的续到未来、旧的被替换、上限', async () => {
  const t = Date.now();
  await api('PUT', '/v1/rdev/me/reminders/old', { tok: A, body: { at: t + 3600e3, ct: ct(20) } });
  const list = [
    { id: 'v1', at: t + 86400e3, ct: ct(20) },
    { id: 'v1', at: t + 86400e3, ct: ct(20) },                    /* 重复 ID */
    { id: 'bad id!', at: t + 1e6, ct: ct(20) },                    /* ID 字符集 */
    { id: 'past', at: t - 3600e3, ct: ct(20) },                    /* 一次性已过点 */
    { id: 'rep', at: t - 3600e3 - 10, every: 86400e3, ct: ct(20) }, /* 重复的：续到明天 */
    { id: 'far', at: t + 500 * 86400e3, ct: ct(20) },              /* 太远 */
    { id: 'ev', at: t + 1e6, every: 10, ct: ct(20) },              /* 间隔低于下限 */
    { id: 'un', at: t + 1e6, until: t, ct: ct(20) },               /* 截止早于到点 */
    { id: 'ctx', at: t + 1e6, ct: 'not base64!' },
    { id: 'big', at: t + 1e6, ct: 'A'.repeat(2049) }
  ];
  const r = await api('PUT', '/v1/rdev/me/reminders', { tok: A, body: { reminders: list.slice(0, 5) } });
  assert.equal(r.status, 200);
  assert.equal(r.json.stored, 2);
  assert.deepEqual(r.json.skipped.map(x => x.why), ['dup', 'bad_id', 'past']);
  const r2 = await api('PUT', '/v1/rdev/me/reminders', { tok: A, body: { reminders: list.slice(5) } });
  assert.equal(r2.json.stored, 0);
  assert.deepEqual(r2.json.skipped.map(x => x.why), ['too_far', 'bad_every', 'bad_until', 'bad_ciphertext', 'bad_ciphertext']);
  await api('PUT', '/v1/rdev/me/reminders', { tok: A, body: { reminders: [list[0], list[4]] } });
  const l = (await api('GET', '/v1/rdev/me/reminders', { tok: A })).json.reminders;
  assert.deepEqual(l.map(x => x.id).sort(), ['rep', 'v1'], '旧的 old 被整批替换掉');
  const rep = l.find(x => x.id === 'rep');
  assert.ok(rep.at > t && rep.at < t + 86400e3 + 1000 && rep.every === 86400e3);
  assert.ok(!JSON.stringify(l).includes('ct'), '列表不回传密文');
  const six = Array.from({ length: 6 }, (_, i) => ({ id: 'n' + i, at: t + 1e7, ct: ct(10) }));
  assert.equal((await api('PUT', '/v1/rdev/me/reminders', { tok: A, body: { reminders: six } })).status, 413);
  assert.equal((await api('PUT', '/v1/rdev/me/reminders', { tok: A, body: { reminders: six.slice(0, 5) } })).json.stored, 5);
  assert.equal((await api('PUT', '/v1/rdev/me/reminders/n5', { tok: A, body: { at: t + 1e7, ct: ct(10) } })).status, 409, '单条也受上限');
  assert.equal((await api('PUT', '/v1/rdev/me/reminders/n4', { tok: A, body: { at: t + 2e7, ct: ct(10) } })).status, 200, '已有的可以改');
  /* 单条校验直接 400 */
  for (const [body, code] of [[{ at: 'x', ct: ct(5) }, 'bad_at'], [{ at: t - 3600e3, ct: ct(5) }, 'past'], [{ at: t + 1e6, ct: '' }, 'bad_ciphertext']]) {
    const x = await api('PUT', '/v1/rdev/me/reminders/n4', { tok: A, body });
    assert.equal(x.status, 400); assert.equal(x.json.error, code);
  }
  await api('PUT', '/v1/rdev/me/reminders', { tok: A, body: { reminders: [] } });
  assert.equal((await api('GET', '/v1/rdev/me/reminders', { tok: A })).json.reminders.length, 0, '空列表 = 全部撤销');
});

test('前台心跳：在前台时到点不推（App 用咿呀岛），回到后台恢复推送', async () => {
  hits = [];
  assert.ok((await api('POST', '/v1/rdev/me/presence', { tok: A, body: { visible: true } })).json.presentUntil > Date.now());
  await api('PUT', '/v1/rdev/me/reminders/fg', { tok: A, body: { at: Date.now() + 400, ct: ct(20) } });
  await sleep(1400);
  assert.equal(hits.length, 0, '前台不推');
  assert.equal((await api('GET', '/v1/rdev/me/reminders', { tok: A })).json.reminders.length, 0, '照常认领掉，不会回到后台又补一条');
  assert.equal((await api('POST', '/v1/rdev/me/presence', { tok: A, body: { visible: false } })).json.presentUntil, 0);
  await api('PUT', '/v1/rdev/me/reminders/bg', { tok: A, body: { at: Date.now() + 300, ct: ct(20) } });
  assert.ok(await waitHits(1, 3000), '后台照推');
});

test('订阅失效（410）：清掉订阅，之后的到点不再打推送服务', async () => {
  hits = []; pushStatus = 410;
  await api('PUT', '/v1/rdev/me/reminders/g1', { tok: B, body: { at: Date.now() + 300, ct: ct(20) } });
  assert.ok(await waitHits(1, 3000));
  pushStatus = 201;
  await sleep(200);
  assert.equal((await api('GET', '/v1/rdev/me/reminders', { tok: B })).json.push, false);
  hits = [];
  await api('PUT', '/v1/rdev/me/reminders/g2', { tok: B, body: { at: Date.now() + 300, ct: ct(20) } });
  await sleep(1200);
  assert.equal(hits.length, 0);
  await api('PUT', '/v1/rdev/me/push', { tok: B, body: { subscription: newSub('b') } });
});

test('扛重启：预约存库，停机期间过点的在补发窗口内补发、超出窗口的跳过，重复的续排', async () => {
  hits = [];
  const t = Date.now();
  await api('PUT', '/v1/rdev/me/reminders', { tok: A, body: { reminders: [
    { id: 'late', at: t + 2600, ct: ct(20) },                                  /* 停机期间过点 ~1.5s → 补发 */
    { id: 'stale', at: t + 300, ct: ct(20) },                                  /* 停机期间过点 >3s → 跳过 */
    { id: 'rep', at: t + 350, every: 2000, until: t + 8500, ct: ct(20) }       /* 第一次跳过，之后续排 */
  ] } });
  await stop(proc);
  await sleep(4100 - (Date.now() - t));
  proc = await start();
  assert.ok(await waitHits(1, 2000, h => decode(h).id === 'late'), '重启后补发 late');
  await sleep(Math.max(0, t + 9000 - Date.now()));
  const ids = hits.map(h => decode(h)), late = ids.filter(x => x.id === 'late'), st = ids.filter(x => x.id === 'stale'), rep = ids.filter(x => x.id === 'rep');
  assert.equal(late.length, 1); assert.equal(st.length, 0, '超出补发窗口的不补');
  assert.ok(rep.length >= 2 && rep.length <= 3, '重复的续排后照常发：' + rep.length);
  assert.ok(rep.every(x => x.at > t + 4000), '续排的是重启后的时刻');
  assert.equal((await api('GET', '/v1/rdev/me/reminders', { tok: A })).json.reminders.length, 0, '截止后删除');
});

test('注销设备：预约一并删除，token 失效；注册限流', async () => {
  await api('PUT', '/v1/rdev/me/reminders/z', { tok: B, body: { at: Date.now() + 1e7, ct: ct(10) } });
  assert.equal((await api('DELETE', '/v1/rdev/me', { tok: B })).status, 204);
  assert.equal((await api('GET', '/v1/rdev/me/reminders', { tok: B })).status, 401);
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(path.join(home, 'data', 'relay.db'), { readOnly: true });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM reminders WHERE device_id = ?').get(B.deviceId).n, 0);
  assert.equal(db.prepare("SELECT v FROM meta WHERE k = 'schema'").get().v, '2');
  db.close();
  let last;
  for (let i = 0; i < 9; i++) last = await api('POST', '/v1/rdev', {});   /* 限流在内存里，重启后重新计数 */
  assert.equal(last.status, 429, '注册每 IP 每小时 8 次（测试值）');
});

test('日志不含 token、推送地址、密文、提醒 ID', async () => {
  await api('PUT', '/v1/rdev/me/reminders/secretid', { tok: A, body: { at: 'bad', ct: ct(10) } });   /* 触发一条 400 日志 */
  const dir = path.join(home, 'logs');
  const all = fs.readdirSync(dir).map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('');
  assert.ok(all.includes('remind tick'));
  assert.ok(all.includes('/v1/rdev/me/reminders/:rid'), '路径里的提醒 ID 已脱敏');
  for (const s of [A.token, A.deviceId, '/push/a', 'secretid', subs.a.auth.toString('base64url')]) assert.ok(!all.includes(s), '泄露：' + s);
});
