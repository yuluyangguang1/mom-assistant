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
    pageSize: 100,
    /* 第 335 次（v0.2.0）：预约提醒（每台设备自己的到点提醒，服务器只存「到点时间 + 不透明密文 + 推送订阅」） */
    maxReminders: num('MAX_REMINDERS', 64),             /* 每台设备最多几条预约 */
    remindChars: num('MAX_REMIND_CHARS', 2048),         /* 单条提醒密文（base64url 字符数） */
    remindAheadDays: num('REMIND_AHEAD_DAYS', 400),     /* 最远能约到多少天后 */
    remindMinEverySec: num('REMIND_MIN_EVERY_SEC', 900),/* 重复间隔下限（15 分钟），防止拿来当高频叫醒 */
    remindStaleSec: num('REMIND_STALE_SEC', 6 * 3600),  /* 服务停机后补发窗口：过点超过 6 小时的不再补发（重复的直接续排到下一次） */
    remindPushTtlSec: num('REMIND_PUSH_TTL_SEC', 4 * 3600), /* 手机离线时推送服务替我们留多久 */
    presenceSec: num('PRESENCE_SEC', 90),               /* App 在前台的心跳有效期：在前台时不发系统推送，由 App 自己弹咿呀岛 */
    rdevIdleDays: num('RDEV_IDLE_DAYS', 180)            /* 提醒设备多久没出现就整台删除（连同预约） */
  },
  rate: {
    createFamilyPerHour: num('RATE_CREATE_PER_HOUR', 6),
    joinPerHour: num('RATE_JOIN_PER_HOUR', 30),
    devicePerMinute: num('RATE_DEVICE_PER_MIN', 240),
    notifyPerMinute: num('RATE_NOTIFY_PER_MIN', 12),
    rdevCreatePerHour: num('RATE_RDEV_PER_HOUR', 10),
    remindWritePerMinute: num('RATE_REMIND_WRITE_PER_MIN', 60)
  }
};

module.exports = cfg;
