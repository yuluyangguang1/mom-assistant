'use strict';
/* 第 335 次：升级与调度的纯函数单测（不起进程） */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

test('从 v0.1.x 的库原地升级：旧表数据不动，新表 / 索引 / schema 版本补上，可重复打开', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yiya-mig-'));
  const old = new DatabaseSync(path.join(dir, 'relay.db'));
  old.exec(`CREATE TABLE families (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, last_active INTEGER NOT NULL);
    CREATE TABLE devices (id TEXT PRIMARY KEY, family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE, token_hash TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL, push_sub TEXT);
    INSERT INTO families VALUES ('f_x', 1, 2); INSERT INTO devices VALUES ('d_y', 'f_x', 'h', '', 1, 2, '{"endpoint":"e"}');`);
  old.close();
  const { open } = require('../src/db');
  for (let i = 0; i < 2; i++) {
    const db = open(dir);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM devices').get().n, 1);
    assert.equal(db.prepare('SELECT push_sub FROM devices').get().push_sub, '{"endpoint":"e"}');
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
    for (const t of ['rdevs', 'reminders', 'meta', 'messages', 'pending', 'invites']) assert.ok(tables.includes(t), t);
    assert.equal(db.prepare("SELECT v FROM meta WHERE k='schema'").get().v, '2');
    db.close();
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('重复规则 nextAt：严格晚于现在、按整倍数对齐原时刻、过截止返回 null', () => {
  const { createScheduler } = require('../src/scheduler');
  const fake = { prepare: () => ({ all: () => [], get: () => ({}), run: () => ({}) }) };
  const s = createScheduler({ limits: { remindStaleSec: 10, remindPushTtlSec: 1 } }, fake, {});
  const H = 3600e3, D = 24 * H;
  assert.equal(s.nextAt({ at: 1000, every: null }, 5000), null);
  assert.equal(s.nextAt({ at: 0, every: D }, 0), D, '恰好到点 → 下一天');
  assert.equal(s.nextAt({ at: 0, every: D }, 3 * D + 5), 4 * D, '停了三天 → 对齐到第四天同一时刻，不补发中间的');
  assert.equal(s.nextAt({ at: 0, every: D, until: 2 * D }, D + 1), 2 * D);
  assert.equal(s.nextAt({ at: 0, every: D, until: 2 * D - 1 }, D + 1), null);
});
