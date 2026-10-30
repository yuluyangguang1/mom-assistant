'use strict';
/* 配置：先读 SECRETS_DIR/.env（不存在就跳过），再读环境变量。所有值都有默认。 */
const fs = require('node:fs');
const path = require('node:path');

function loadEnvFile(file) {
  try {
    if (fs.existsSync(file) && typeof process.loadEnvFile === 'function') process.loadEnvFile(file);
  } catch (e) {
    console.error('[config] .env 读取失败：' + e.message);
  }
}

const base = process.env.YIYA_HOME || (process.platform === 'win32' ? 'D:\\yiya-relay' : path.join(process.cwd(), '.yiya-relay'));
loadEnvFile(path.join(process.env.SECRETS_DIR || path.join(base, 'secrets'), '.env'));

const num = (k, d) => {
  const v = Number(process.env[k]);
  return Number.isFinite(v) && v > 0 ? v : d;
};

const cfg = {
  host: process.env.HOST || '127.0.0.1',
  port: num('PORT', 8787),
  dataDir: process.env.DATA_DIR || path.join(base, 'data'),
  secretsDir: process.env.SECRETS_DIR || path.join(base, 'secrets'),
  logDir: process.env.LOG_DIR || path.join(base, 'logs'),
  allowedOrigins: (process.env.ALLOWED_ORIGINS || 'https://yuluyangguang1.github.io,http://localhost:8000,http://127.0.0.1:8000')
    .split(',').map(s => s.trim()).filter(Boolean),
  vapidSubject: process.env.VAPID_SUBJECT || 'mailto:admin@yiya.help',
  /* 只在本机测试时打开：允许任意推送地址（默认只允许 Apple / Google / Mozilla / Microsoft 推送服务，防 SSRF） */
  pushAnyEndpoint: process.env.PUSH_ANY_ENDPOINT === '1',
  limits: {
    bodyBytes: num('MAX_BODY_BYTES', 512 * 1024),
    msgChars: num('MAX_MSG_CHARS', 350 * 1024),        /* 单条密文（base64url 字符数，约 256KB 原文） */
    notifyChars: num('MAX_NOTIFY_CHARS', 2048),         /* 推送里带的小密文 */
    familyBytes: num('FAMILY_QUOTA_BYTES', 64 * 1024 * 1024),
    devicesPerFamily: num('MAX_DEVICES', 12),
    msgTtlDays: num('MSG_TTL_DAYS', 30),
    familyIdleDays: num('FAMILY_IDLE_DAYS', 180),
    inviteMinutes: num('INVITE_MINUTES', 15),
    pageSize: 100
  },
  rate: {
    createFamilyPerHour: num('RATE_CREATE_PER_HOUR', 6),
    joinPerHour: num('RATE_JOIN_PER_HOUR', 30),
    devicePerMinute: num('RATE_DEVICE_PER_MIN', 240),
    notifyPerMinute: num('RATE_NOTIFY_PER_MIN', 12)
  }
};

module.exports = cfg;
