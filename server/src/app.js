'use strict';
/*
 * 咿呀中转：所有接口在 /v1 下。
 * 服务器只看得到：家庭 ID、设备 ID、令牌哈希、设备名（客户端可自行加密/留空）、密文、推送订阅。
 * 家庭密钥只在扫码时从手机传到手机，永远不经过服务器。
 */
const crypto = require('node:crypto');
const { tx } = require('./db');
const push = require('./push');
const log = require('./log');
const { createScheduler } = require('./scheduler');

const VERSION = require('../package.json').version;
const now = () => Date.now();
const b64u = n => crypto.randomBytes(n).toString('base64url');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const ID_RE = { family: /^f_[A-Za-z0-9_-]{22}$/, device: /^d_[A-Za-z0-9_-]{16}$/, rdev: /^r_[A-Za-z0-9_-]{16}$/ };
const RID_RE = /^[A-Za-z0-9_-]{1,32}$/;
const CT_RE = /^[A-Za-z0-9_-]+$/;
const KIND_RE = /^[a-z0-9._-]{0,32}$/;

class HttpError extends Error {
  constructor(status, code, msg) { super(msg || code); this.status = status; this.code = code; }
}

/* ---------- 限流：内存令牌桶 ---------- */
function makeLimiter() {
  const buckets = new Map();
  function take(key, perWindow, windowMs) {
    const t = now();
    let b = buckets.get(key);
    if (!b) { b = { tokens: perWindow, at: t }; buckets.set(key, b); }
    b.tokens = Math.min(perWindow, b.tokens + (t - b.at) * perWindow / windowMs);
    b.at = t;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }
  setInterval(() => {
    const t = now();
    for (const [k, b] of buckets) if (t - b.at > 3600e3) buckets.delete(k);
  }, 600e3).unref();
  return take;
}

function createApp(cfg, db) {
  const L = cfg.limits;
  const take = makeLimiter();
  const limit = (key, per, ms) => { if (!take(key, per, ms)) throw new HttpError(429, 'rate_limited', '请求太频繁'); };

  const q = {
    insFamily: db.prepare('INSERT INTO families (id, created_at, last_active) VALUES (?, ?, ?)'),
    touchFamily: db.prepare('UPDATE families SET last_active = ? WHERE id = ?'),
    delFamily: db.prepare('DELETE FROM families WHERE id = ?'),
    getFamily: db.prepare('SELECT id FROM families WHERE id = ?'),
    insDevice: db.prepare('INSERT INTO devices (id, family_id, token_hash, name, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?)'),
    getDevice: db.prepare('SELECT id, family_id, token_hash, last_seen, push_sub FROM devices WHERE id = ?'),
    touchDevice: db.prepare('UPDATE devices SET last_seen = ? WHERE id = ?'),
    renameDevice: db.prepare('UPDATE devices SET name = ? WHERE id = ?'),
    listDevices: db.prepare('SELECT id, name, created_at, last_seen, push_sub IS NOT NULL AS push FROM devices WHERE family_id = ? ORDER BY created_at'),
    countDevices: db.prepare('SELECT COUNT(*) AS n FROM devices WHERE family_id = ?'),
    familyDeviceIds: db.prepare('SELECT id FROM devices WHERE family_id = ?'),
    delDevice: db.prepare('DELETE FROM devices WHERE id = ? AND family_id = ?'),
    setPush: db.prepare('UPDATE devices SET push_sub = ? WHERE id = ?'),
    pushTargets: db.prepare('SELECT id, push_sub FROM devices WHERE family_id = ? AND id != ?'),
    insInvite: db.prepare('INSERT INTO invites (code_hash, family_id, created_by, expires_at) VALUES (?, ?, ?, ?)'),
    takeInvite: db.prepare('DELETE FROM invites WHERE code_hash = ? AND family_id = ? AND expires_at > ? RETURNING code_hash'),
    familyBytes: db.prepare('SELECT COALESCE(SUM(size), 0) AS b FROM messages WHERE family_id = ?'),
    insMessage: db.prepare('INSERT INTO messages (family_id, sender, kind, ct, size, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    insPending: db.prepare('INSERT INTO pending (seq, device_id) VALUES (?, ?)'),
    fetch: db.prepare(`SELECT m.seq, m.sender, m.kind, m.ct, m.created_at FROM pending p JOIN messages m ON m.seq = p.seq
                       WHERE p.device_id = ? AND p.seq > ? ORDER BY p.seq LIMIT ?`),
    ack: db.prepare('DELETE FROM pending WHERE device_id = ? AND seq <= ?'),
    pendingCount: db.prepare('SELECT COUNT(*) AS n FROM pending WHERE device_id = ?'),
    delOrphanMsgs: db.prepare('DELETE FROM messages WHERE family_id = ? AND seq NOT IN (SELECT seq FROM pending)'),
    gcMsgs: db.prepare('DELETE FROM messages WHERE expires_at <= ?'),
    gcOrphans: db.prepare('DELETE FROM messages WHERE seq NOT IN (SELECT seq FROM pending)'),
    gcInvites: db.prepare('DELETE FROM invites WHERE expires_at <= ?'),
    gcFamilies: db.prepare('DELETE FROM families WHERE last_active <= ?'),
    gcEmpty: db.prepare('DELETE FROM families WHERE id NOT IN (SELECT DISTINCT family_id FROM devices)'),
    /* 第 335 次：预约提醒 */
    insRdev: db.prepare('INSERT INTO rdevs (id, token_hash, created_at, last_seen) VALUES (?, ?, ?, ?)'),
    getRdev: db.prepare('SELECT id, token_hash, last_seen, push_sub FROM rdevs WHERE id = ?'),
    touchRdev: db.prepare('UPDATE rdevs SET last_seen = ? WHERE id = ?'),
    delRdev: db.prepare('DELETE FROM rdevs WHERE id = ?'),
    setRdevPush: db.prepare('UPDATE rdevs SET push_sub = ? WHERE id = ?'),
    setPresence: db.prepare('UPDATE rdevs SET present_until = ? WHERE id = ?'),
    listRem: db.prepare('SELECT rid, at, every, until, updated_at FROM reminders WHERE device_id = ? ORDER BY at'),
    countRem: db.prepare('SELECT COUNT(*) AS n FROM reminders WHERE device_id = ?'),
    hasRem: db.prepare('SELECT 1 AS x FROM reminders WHERE device_id = ? AND rid = ?'),
    upRem: db.prepare(`INSERT INTO reminders (device_id, rid, at, every, until, ct, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
                       ON CONFLICT (device_id, rid) DO UPDATE SET at = excluded.at, every = excluded.every, until = excluded.until,
                       ct = excluded.ct, updated_at = excluded.updated_at, sent = 0`),
    delRem: db.prepare('DELETE FROM reminders WHERE device_id = ? AND rid = ?'),
    delAllRem: db.prepare('DELETE FROM reminders WHERE device_id = ?'),
    gcRdevs: db.prepare('DELETE FROM rdevs WHERE last_seen <= ?'),
    gcStaleRem: db.prepare('DELETE FROM reminders WHERE every IS NULL AND at <= ?')
  };
  const sched = createScheduler(cfg, db, push);

  function cleanName(s) {
    if (s == null) return '';
    if (typeof s !== 'string') throw new HttpError(400, 'bad_name');
    return s.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 64);
  }

  function newDevice(familyId, name) {
    const id = 'd_' + b64u(12), token = b64u(32), t = now();
    q.insDevice.run(id, familyId, sha(token), cleanName(name), t, t);
    return { deviceId: id, token };
  }

  /* Authorization: Bearer <deviceId>:<token> */
  function auth(req, familyId) {
    const h = req.headers['authorization'] || '';
    const m = /^Bearer (d_[A-Za-z0-9_-]{16}):([A-Za-z0-9_-]{43})$/.exec(h);
    if (!m) throw new HttpError(401, 'unauthorized');
    const dev = q.getDevice.get(m[1]);
    const ok = dev && crypto.timingSafeEqual(Buffer.from(dev.token_hash, 'hex'), Buffer.from(sha(m[2]), 'hex'));
    if (!ok || dev.family_id !== familyId) throw new HttpError(401, 'unauthorized');
    const t = now();
    if (t - dev.last_seen > 60e3) { q.touchDevice.run(t, dev.id); q.touchFamily.run(t, familyId); }
    limit('dev:' + dev.id, cfg.rate.devicePerMinute, 60e3);
    return dev;
  }

  function gc() {
    const t = now();
    try {
      const a = q.gcMsgs.run(t).changes, b = q.gcOrphans.run().changes, c = q.gcInvites.run(t).changes;
      const d = q.gcFamilies.run(t - L.familyIdleDays * 864e5).changes, e = q.gcEmpty.run().changes;
      const f = q.gcRdevs.run(t - L.rdevIdleDays * 864e5).changes, g = q.gcStaleRem.run(t - 2 * L.remindStaleSec * 1000).changes;
      if (a + b + c + d + e + f + g) log.info('gc', { expiredMsgs: a, orphanMsgs: b, invites: c, idleFamilies: d, emptyFamilies: e, idleRdevs: f, staleReminders: g });
    } catch (err) { log.error('gc failed', { err: err.message }); }
    log.prune();
  }

  async function notify(familyId, fromId, to, payload) {
    const targets = q.pushTargets.all(familyId, fromId).filter(r => !to || to.includes(r.id));
    let sent = 0, failed = 0, noSub = 0;
    await Promise.all(targets.map(async r => {
      if (!r.push_sub) { noSub++; return; }
      const res = await push.send(JSON.parse(r.push_sub), payload, { urgency: 'high', ttl: 600 });
      if (res === 'ok') sent++;
      else { failed++; if (res === 'gone') q.setPush.run(null, r.id); }
    }));
    return { sent, failed, noSub };
  }

  /* ---------- 路由 ---------- */
  const routes = [];
  const route = (method, pattern, fn) => routes.push({ method, re: new RegExp('^' + pattern + '$'), fn });

  route('GET', '/v1/health', () => ({ ok: true, version: VERSION, time: now(), features: ['family', 'remind'] }));
  route('GET', '/v1/push/key', () => ({ publicKey: push.getPublicKey() }));

  /* 建一个家：创建者成为第一台设备 */
  route('POST', '/v1/families', (ctx) => {
    limit('create:' + ctx.ip, cfg.rate.createFamilyPerHour, 3600e3);
    const familyId = 'f_' + b64u(16), t = now();
    const dev = tx(db, () => { q.insFamily.run(familyId, t, t); return newDevice(familyId, ctx.body.name); });
    log.info('family created', { family: familyId.slice(0, 8) });
    return { status: 201, body: { familyId, ...dev } };
  });

  /* 扫码加入：二维码里带 familyId + invite（+ 家庭密钥，只在客户端用） */
  route('POST', '/v1/join', (ctx) => {
    limit('join:' + ctx.ip, cfg.rate.joinPerHour, 3600e3);
    const { familyId, invite } = ctx.body;
    if (typeof familyId !== 'string' || !ID_RE.family.test(familyId) || typeof invite !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(invite))
      throw new HttpError(400, 'bad_request');
    const dev = tx(db, () => {
      if (!q.takeInvite.get(sha(invite), familyId, now())) throw new HttpError(403, 'invite_invalid', '邀请码无效或已过期');
      if (q.countDevices.get(familyId).n >= L.devicesPerFamily) throw new HttpError(409, 'family_full', '这个家的设备已满');
      return newDevice(familyId, ctx.body.name);
    });
    q.touchFamily.run(now(), familyId);
    log.info('device joined', { family: familyId.slice(0, 8) });
    return { status: 201, body: { familyId, ...dev, devices: q.listDevices.all(familyId).map(pubDevice) } };
  });

  const pubDevice = r => ({ deviceId: r.id, name: r.name, createdAt: r.created_at, lastSeen: r.last_seen, push: !!r.push });
  const F = '/v1/families/(f_[A-Za-z0-9_-]{22})';

  route('POST', F + '/invites', (ctx, fid) => {
    const dev = auth(ctx.req, fid);
    if (q.countDevices.get(fid).n >= L.devicesPerFamily) throw new HttpError(409, 'family_full', '这个家的设备已满');
    const invite = b64u(16), expiresAt = now() + L.inviteMinutes * 60e3;
    q.insInvite.run(sha(invite), fid, dev.id, expiresAt);
    return { status: 201, body: { invite, expiresAt } };
  });

  route('GET', F + '/devices', (ctx, fid) => {
    const dev = auth(ctx.req, fid);
    return { me: dev.id, devices: q.listDevices.all(fid).map(pubDevice) };
  });

  route('PATCH', F + '/devices/me', (ctx, fid) => {
    const dev = auth(ctx.req, fid);
    q.renameDevice.run(cleanName(ctx.body.name), dev.id);
    return { ok: true };
  });

  /* 移除设备：自己退出，或家里任一成员移除丢失的手机。最后一台走了整个家删除。 */
  route('DELETE', F + '/devices/(me|d_[A-Za-z0-9_-]{16})', (ctx, fid, did) => {
    const dev = auth(ctx.req, fid);
    const target = did === 'me' ? dev.id : did;
    const gone = tx(db, () => {
      if (!q.delDevice.run(target, fid).changes) throw new HttpError(404, 'not_found');
      q.delOrphanMsgs.run(fid);
      if (q.countDevices.get(fid).n === 0) { q.delFamily.run(fid); return true; }
      return false;
    });
    log.info('device removed', { family: fid.slice(0, 8), self: target === dev.id, familyDeleted: gone });
    return { status: 204 };
  });

  route('PUT', F + '/devices/me/push', (ctx, fid) => {
    const dev = auth(ctx.req, fid);
    const sub = push.validateSubscription(ctx.body.subscription);
    if (!sub) throw new HttpError(400, 'bad_subscription', '推送订阅无效或推送服务不在白名单');
    q.setPush.run(JSON.stringify(sub), dev.id);
    return { ok: true };
  });

  route('DELETE', F + '/devices/me/push', (ctx, fid) => {
    const dev = auth(ctx.req, fid);
    q.setPush.run(null, dev.id);
    return { status: 204 };
  });

  /* 发一条密文给家里其他设备（默认全部，也可指定 to） */
  route('POST', F + '/messages', (ctx, fid) => {
    const dev = auth(ctx.req, fid);
    const { ct, kind = '', to } = ctx.body;
    if (typeof ct !== 'string' || !ct || ct.length > L.msgChars || !CT_RE.test(ct)) throw new HttpError(400, 'bad_ciphertext', '密文需为 base64url 且不超过上限');
    if (typeof kind !== 'string' || !KIND_RE.test(kind)) throw new HttpError(400, 'bad_kind');
    let recipients = q.familyDeviceIds.all(fid).map(r => r.id).filter(id => id !== dev.id);
    if (to != null) {
      if (!Array.isArray(to) || to.some(x => typeof x !== 'string')) throw new HttpError(400, 'bad_to');
      recipients = recipients.filter(id => to.includes(id));
    }
    if (!recipients.length) return { seq: null, recipients: 0 };
    const t = now();
    const seq = tx(db, () => {
      if (q.familyBytes.get(fid).b + ct.length > L.familyBytes) throw new HttpError(413, 'family_quota', '家庭待取消息超出容量，请让其他设备先同步');
      const s = Number(q.insMessage.run(fid, dev.id, kind, ct, ct.length, t, t + L.msgTtlDays * 864e5).lastInsertRowid);
      for (const r of recipients) q.insPending.run(s, r);
      return s;
    });
    return { status: 201, body: { seq, recipients: recipients.length } };
  });

  route('GET', F + '/messages', (ctx, fid) => {
    const dev = auth(ctx.req, fid);
    const after = Math.max(0, parseInt(ctx.url.searchParams.get('after') || '0', 10) || 0);
    const lim = Math.min(L.pageSize, Math.max(1, parseInt(ctx.url.searchParams.get('limit') || String(L.pageSize), 10) || L.pageSize));
    const rows = q.fetch.all(dev.id, after, lim + 1);
    const more = rows.length > lim;
    return {
      messages: rows.slice(0, lim).map(r => ({ seq: r.seq, from: r.sender, kind: r.kind, ct: r.ct, at: r.created_at })),
      more
    };
  });

  /* 确认收到 upTo 及之前的全部消息；所有收件设备都确认后密文立即删除 */
  route('POST', F + '/ack', (ctx, fid) => {
    const dev = auth(ctx.req, fid);
    const upTo = Number(ctx.body.upTo);
    if (!Number.isSafeInteger(upTo) || upTo < 0) throw new HttpError(400, 'bad_upTo');
    tx(db, () => { q.ack.run(dev.id, upTo); q.delOrphanMsgs.run(fid); });
    return { pending: q.pendingCount.get(dev.id).n };
  });

  /* 推送叫醒（「你来一下」/ 有新同步）。通知文字由客户端 SW 决定，这里只转发小密文。 */
  route('POST', F + '/notify', async (ctx, fid) => {
    const dev = auth(ctx.req, fid);
    limit('notify:' + dev.id, cfg.rate.notifyPerMinute, 60e3);
    const { kind = 'sync', ct, to } = ctx.body;
    if (typeof kind !== 'string' || !KIND_RE.test(kind) || !kind) throw new HttpError(400, 'bad_kind');
    if (ct != null && (typeof ct !== 'string' || ct.length > L.notifyChars || !CT_RE.test(ct))) throw new HttpError(400, 'bad_ciphertext');
    if (to != null && (!Array.isArray(to) || to.some(x => typeof x !== 'string'))) throw new HttpError(400, 'bad_to');
    const r = await notify(fid, dev.id, to || null, { t: kind, f: fid, from: dev.id, ct: ct || null, at: now() });
    return r;
  });

  /* ================= 第 335 次（v0.2.0）：预约提醒 =================
     每台手机注册一个「提醒设备」（和家庭无关，没加入家庭的单机用户也能用）。
     服务器只存：到点时间（UTC 毫秒）、可选的重复间隔 / 截止、不透明密文、推送订阅。
     密文由 App 用只存在本机 IndexedDB 的设备密钥加密，服务器和推送服务都解不开；到点原样推给 SW 解密。 */
  function rauth(req) {
    const h = req.headers['authorization'] || '';
    const m = /^Bearer (r_[A-Za-z0-9_-]{16}):([A-Za-z0-9_-]{43})$/.exec(h);
    if (!m) throw new HttpError(401, 'unauthorized');
    const dev = q.getRdev.get(m[1]);
    const ok = dev && crypto.timingSafeEqual(Buffer.from(dev.token_hash, 'hex'), Buffer.from(sha(m[2]), 'hex'));
    if (!ok) throw new HttpError(401, 'unauthorized');
    const t = now();
    if (t - dev.last_seen > 60e3) q.touchRdev.run(t, dev.id);
    limit('rdev:' + dev.id, cfg.rate.devicePerMinute, 60e3);
    return dev;
  }

  /** 校验一条预约；返回规范化对象，或 { skip: 原因 }（批量时跳过），single=true 时直接抛 400 */
  function cleanReminder(x, rid, single) {
    const bad = (code) => { if (single) throw new HttpError(400, code); return { skip: code }; };
    if (!x || typeof x !== 'object' || Array.isArray(x)) return bad('bad_reminder');
    const id = rid != null ? rid : x.id;
    if (typeof id !== 'string' || !RID_RE.test(id)) return bad('bad_id');
    const t = now();
    if (!Number.isSafeInteger(x.at)) return bad('bad_at');
    if (x.at > t + L.remindAheadDays * 864e5) return bad('too_far');
    let every = null, until = null;
    if (x.every != null) {
      if (!Number.isSafeInteger(x.every) || x.every < L.remindMinEverySec * 1000 || x.every > L.remindAheadDays * 864e5) return bad('bad_every');
      every = x.every;
    }
    if (x.until != null) {
      if (!Number.isSafeInteger(x.until) || x.until < x.at) return bad('bad_until');
      until = x.until;
    }
    let at = x.at;
    /* 已经过点：一次性的超过 5 分钟就不收（App 本地补发）；重复的往后续到下一个未来时刻 */
    if (at < t - 5 * 60e3) {
      if (!every) return bad('past');
      at = sched.nextAt({ at, every, until }, t);
      if (at == null) return bad('past');
    }
    if (typeof x.ct !== 'string' || !x.ct || x.ct.length > L.remindChars || !CT_RE.test(x.ct)) return bad('bad_ciphertext');
    return { id, at, every, until, ct: x.ct };
  }
  const pubRem = r => ({ id: r.rid, at: r.at, every: r.every, until: r.until, updatedAt: r.updated_at });

  /* 注册：返回 { deviceId, token }，token 只在这一次返回，服务器只存哈希 */
  route('POST', '/v1/rdev', (ctx) => {
    limit('rdevc:' + ctx.ip, cfg.rate.rdevCreatePerHour, 3600e3);
    const id = 'r_' + b64u(12), token = b64u(32), t = now();
    q.insRdev.run(id, sha(token), t, t);
    log.info('rdev created', {});
    return { status: 201, body: { deviceId: id, token, max: L.maxReminders } };
  });

  route('DELETE', '/v1/rdev/me', (ctx) => {
    const dev = rauth(ctx.req);
    q.delRdev.run(dev.id);
    return { status: 204 };
  });

  route('PUT', '/v1/rdev/me/push', (ctx) => {
    const dev = rauth(ctx.req);
    const sub = push.validateSubscription(ctx.body.subscription);
    if (!sub) throw new HttpError(400, 'bad_subscription', '推送订阅无效或推送服务不在白名单');
    q.setRdevPush.run(JSON.stringify(sub), dev.id);
    return { ok: true };
  });

  route('DELETE', '/v1/rdev/me/push', (ctx) => {
    const dev = rauth(ctx.req);
    q.setRdevPush.run(null, dev.id);
    return { status: 204 };
  });

  /* 前台心跳：{ visible: true } → 接下来 presenceSec 秒内到点的不发系统推送（App 自己弹咿呀岛）；{ visible: false } 立即恢复推送 */
  route('POST', '/v1/rdev/me/presence', (ctx) => {
    const dev = rauth(ctx.req);
    const until = ctx.body.visible === true ? now() + L.presenceSec * 1000 : 0;
    q.setPresence.run(until, dev.id);
    return { presentUntil: until };
  });

  route('GET', '/v1/rdev/me/reminders', (ctx) => {
    const dev = rauth(ctx.req);
    return { reminders: q.listRem.all(dev.id).map(pubRem), max: L.maxReminders, push: !!dev.push_sub };
  });

  /* 整批替换（App 的常用路径：离线排队后一次同步，天然去重、幂等） */
  route('PUT', '/v1/rdev/me/reminders', (ctx) => {
    const dev = rauth(ctx.req);
    limit('rw:' + dev.id, cfg.rate.remindWritePerMinute, 60e3);
    const list = ctx.body.reminders;
    if (!Array.isArray(list)) throw new HttpError(400, 'bad_request');
    if (list.length > L.maxReminders) throw new HttpError(413, 'too_many', '预约条数超过上限');
    const ok = [], skipped = [], seen = new Set();
    for (const x of list) {
      const c = cleanReminder(x, null, false);
      const id = x && typeof x.id === 'string' ? x.id.slice(0, 40) : null;
      if (c.skip) { skipped.push({ id, why: c.skip }); continue; }
      if (seen.has(c.id)) { skipped.push({ id: c.id, why: 'dup' }); continue; }
      seen.add(c.id); ok.push(c);
    }
    const t = now();
    tx(db, () => {
      q.delAllRem.run(dev.id);
      for (const c of ok) q.upRem.run(dev.id, c.id, c.at, c.every, c.until, c.ct, t);
    });
    sched.poke();
    return { stored: ok.length, skipped, max: L.maxReminders };
  });

  route('PUT', '/v1/rdev/me/reminders/([A-Za-z0-9_-]{1,32})', (ctx, rid) => {
    const dev = rauth(ctx.req);
    limit('rw:' + dev.id, cfg.rate.remindWritePerMinute, 60e3);
    const c = cleanReminder(ctx.body, rid, true);
    tx(db, () => {
      if (!q.hasRem.get(dev.id, rid) && q.countRem.get(dev.id).n >= L.maxReminders) throw new HttpError(409, 'reminder_quota', '预约条数已满');
      q.upRem.run(dev.id, c.id, c.at, c.every, c.until, c.ct, now());
    });
    sched.poke();
    return { id: c.id, at: c.at, every: c.every, until: c.until };
  });

  route('DELETE', '/v1/rdev/me/reminders/([A-Za-z0-9_-]{1,32})', (ctx, rid) => {
    const dev = rauth(ctx.req);
    limit('rw:' + dev.id, cfg.rate.remindWritePerMinute, 60e3);
    q.delRem.run(dev.id, rid);
    return { status: 204 };
  });

  /* ---------- HTTP ---------- */
  /* 日志里的路径：家庭 / 设备 / 提醒 ID 一律换成 :id */
  function redact(p) { return p.replace(/f_[\w-]+|d_[\w-]+|r_[\w-]+/g, ':id').replace(/(\/reminders\/)[\w-]+/, '$1:rid'); }

  function cors(req, res) {
    const origin = req.headers.origin;
    if (origin && cfg.allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Max-Age', '600');
    }
  }

  function send(res, status, body) {
    res.statusCode = status;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (status === 204 || body === undefined) return res.end();
    if (res.req && res.req.method === 'HEAD') { res.setHeader('Content-Type', 'application/json; charset=utf-8'); return res.end(); }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return resolve({});
      const len = Number(req.headers['content-length'] || 0);
      if (len > L.bodyBytes) return reject(new HttpError(413, 'too_large'));
      let size = 0; const chunks = [];
      req.on('data', c => {
        size += c.length;
        if (size > L.bodyBytes) { reject(new HttpError(413, 'too_large')); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        if (!size) return resolve({});
        if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return reject(new HttpError(415, 'json_only'));
        try {
          const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
          resolve(v);
        } catch { reject(new HttpError(400, 'bad_json')); }
      });
      req.on('error', reject);
    });
  }

  async function handle(req, res) {
    const started = now();
    cors(req, res);
    if (req.method === 'OPTIONS') return send(res, 204);
    let url;
    try { url = new URL(req.url, 'http://local'); } catch { return send(res, 400, { error: 'bad_url' }); }
    const ip = String(req.headers['cf-connecting-ip'] || req.socket.remoteAddress || '?');
    let status = 500;
    try {
      let match = null, methodMismatch = false;
      for (const r of routes) {
        const m = r.re.exec(url.pathname);
        if (!m) continue;
        if (r.method !== req.method && !(req.method === 'HEAD' && r.method === 'GET')) { methodMismatch = true; continue; }
        match = { r, args: m.slice(1) }; break;
      }
      if (!match) throw methodMismatch ? new HttpError(405, 'method_not_allowed') : new HttpError(404, 'not_found');
      const body = await readBody(req);
      const out = await match.r.fn({ req, url, ip, body }, ...match.args);
      if (out && typeof out.status === 'number') { status = out.status; send(res, status, out.body); }
      else { status = 200; send(res, 200, out); }
    } catch (e) {
      if (e instanceof HttpError) { status = e.status; send(res, status, { error: e.code, message: e.message !== e.code ? e.message : undefined }); }
      else { status = 500; log.error('unhandled', { path: redact(url.pathname), err: String(e && e.stack || e).slice(0, 500) }); send(res, 500, { error: 'internal' }); }
    } finally {
      if (status >= 500 || (status >= 400 && status !== 404 && status !== 401)) {
        log.warn('req', { m: req.method, p: redact(url.pathname), s: status, ms: now() - started });
      }
    }
  }

  return { handle, gc, scheduler: sched };
}

module.exports = { createApp };
