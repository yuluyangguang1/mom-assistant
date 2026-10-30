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
  `);
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
