'use strict';
/* 日志：一天一个文件，JSON 一行一条，保留 14 天。绝不记录 token、密文、推送地址。 */
const fs = require('node:fs');
const path = require('node:path');

let dir = null;
const KEEP_DAYS = 14;

function init(logDir) {
  dir = logDir;
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  prune();
}

function day(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function prune() {
  if (!dir) return;
  try {
    const cutoff = day(new Date(Date.now() - KEEP_DAYS * 864e5));
    for (const f of fs.readdirSync(dir)) {
      const m = /^relay-(\d{4}-\d{2}-\d{2})\.log$/.exec(f);
      if (m && m[1] < cutoff) fs.unlinkSync(path.join(dir, f));
    }
  } catch {}
}

function write(level, msg, extra) {
  const line = JSON.stringify(Object.assign({ t: new Date().toISOString(), level, msg }, extra || {}));
  if (level === 'error') console.error(line); else console.log(line);
  if (dir) {
    try { fs.appendFileSync(path.join(dir, 'relay-' + day() + '.log'), line + '\n'); } catch {}
  }
}

module.exports = {
  init, prune,
  info: (m, e) => write('info', m, e),
  warn: (m, e) => write('warn', m, e),
  error: (m, e) => write('error', m, e)
};
