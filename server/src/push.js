'use strict';
/* Web Push：VAPID 密钥首次启动时生成，存 secrets/vapid.json，之后不变（变了所有订阅都会失效）。 */
const fs = require('node:fs');
const path = require('node:path');
const webpush = require('web-push');
const log = require('./log');

const ALLOWED_PUSH_HOSTS = [
  /^web\.push\.apple\.com$/,
  /^([a-z0-9-]+\.)*push\.apple\.com$/,
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^([a-z0-9-]+\.)*push\.services\.mozilla\.com$/,
  /^([a-z0-9-]+\.)*notify\.windows\.com$/
];

let publicKey = null;
let anyEndpoint = false;

function init(cfg) {
  anyEndpoint = cfg.pushAnyEndpoint;
  fs.mkdirSync(cfg.secretsDir, { recursive: true });
  const file = path.join(cfg.secretsDir, 'vapid.json');
  let keys;
  if (fs.existsSync(file)) {
    keys = JSON.parse(fs.readFileSync(file, 'utf8'));
  } else {
    keys = webpush.generateVAPIDKeys();
    fs.writeFileSync(file, JSON.stringify(keys, null, 2), { mode: 0o600 });
    log.info('vapid keys generated');
  }
  webpush.setVapidDetails(cfg.vapidSubject, keys.publicKey, keys.privateKey);
  publicKey = keys.publicKey;
}

function getPublicKey() { return publicKey; }

/* 校验订阅对象；返回规范化后的订阅或 null */
function validateSubscription(sub) {
  if (!sub || typeof sub !== 'object') return null;
  const { endpoint, keys } = sub;
  if (typeof endpoint !== 'string' || endpoint.length > 1024) return null;
  let u;
  try { u = new URL(endpoint); } catch { return null; }
  if (u.protocol !== 'https:' && !anyEndpoint) return null;
  if (!anyEndpoint && !ALLOWED_PUSH_HOSTS.some(re => re.test(u.hostname))) return null;
  if (!keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') return null;
  if (!/^[A-Za-z0-9_-]{80,100}$/.test(keys.p256dh) || !/^[A-Za-z0-9_-]{16,32}$/.test(keys.auth)) return null;
  return { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

/* 发送一条；返回 'ok' | 'gone'（订阅已失效，应删除）| 'fail' */
async function send(sub, payload, opts = {}) {
  try {
    await webpush.sendNotification(sub, JSON.stringify(payload), {
      TTL: opts.ttl ?? 300,
      urgency: opts.urgency || 'high',
      topic: opts.topic,
      timeout: 8000
    });
    return 'ok';
  } catch (e) {
    const code = e && e.statusCode;
    if (code === 404 || code === 410) return 'gone';
    log.warn('push send failed', { status: code || null, err: String(e && e.message || e).slice(0, 120) });
    return 'fail';
  }
}

module.exports = { init, getPublicKey, validateSubscription, send };
