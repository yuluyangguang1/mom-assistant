'use strict';
/* SQLite（Node 22 自带 node:sqlite，无原生编译依赖）。服务器只存密文、设备令牌哈希、推送订阅。 */
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function open(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'relay.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 3000;

    CREATE TABLE IF NOT EXISTS families (
      id          TEXT PRIMARY KEY,
      created_at  INTEGER NOT NULL,
      last_active INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS devices (
      id          TEXT PRIMARY KEY,
      family_id   TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
      token_hash  TEXT NOT NULL,
      name        TEXT NOT NULL DEFAULT '',
      created_at  INTEGER NOT NULL,
      last_seen   INTEGER NOT NULL,
      push_sub    TEXT
    );
    CREATE INDEX IF NOT EXISTS devices_family ON devices(family_id);
    CREATE TABLE IF NOT EXISTS invites (
      code_hash   TEXT PRIMARY KEY,
      family_id   TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
      created_by  TEXT NOT NULL,
      expires_at  INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      seq         INTEGER PRIMARY KEY AUTOINCREMENT,
      family_id   TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
      sender      TEXT NOT NULL,
      kind        TEXT NOT NULL DEFAULT '',
      ct          TEXT NOT NULL,
      size        INTEGER NOT NULL,
      created_at  INTEGER NOT NULL,
      expires_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS messages_family ON messages(family_id);
    CREATE INDEX IF NOT EXISTS messages_expiry ON messages(expires_at);
    CREATE TABLE IF NOT EXISTS pending (
      seq         INTEGER NOT NULL REFERENCES messages(seq) ON DELETE CASCADE,
      device_id   TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
      PRIMARY KEY (device_id, seq)
    ) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS pending_seq ON pending(seq);

    /* 第 335 次（v0.2.0）：预约提醒。设备与家庭无关（单机用户也能用），每台手机注册一次。 */
    CREATE TABLE IF NOT EXISTS rdevs (
      id            TEXT PRIMARY KEY,
      token_hash    TEXT NOT NULL,
      push_sub      TEXT,
      present_until INTEGER NOT NULL DEFAULT 0,
      created_at    INTEGER NOT NULL,
      last_seen     INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reminders (
      device_id   TEXT NOT NULL REFERENCES rdevs(id) ON DELETE CASCADE,
      rid         TEXT NOT NULL,
      at          INTEGER NOT NULL,          /* 下次到点，UTC 毫秒 */
      every       INTEGER,                   /* 重复间隔（毫秒），NULL = 一次性 */
      until       INTEGER,                   /* 重复截止（UTC 毫秒），NULL = 不截止 */
      ct          TEXT NOT NULL,             /* 不透明密文：服务器解不开 */
      updated_at  INTEGER NOT NULL,
      sent        INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (device_id, rid)
    ) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS reminders_at ON reminders(at);
    CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
    INSERT OR IGNORE INTO meta (k, v) VALUES ('schema', '2');
  `);
  db.exec(`UPDATE meta SET v = '2' WHERE k = 'schema' AND CAST(v AS INTEGER) < 2`);
  return db;
}

/* 简单事务包装（DatabaseSync 是同步的，单进程内不会交错） */
function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch {}
    throw e;
  }
}

module.exports = { open, tx };
