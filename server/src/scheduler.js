'use strict';
/*
 * 第 335 次（v0.2.0）：预约提醒调度循环。
 *
 * - 状态全在 SQLite（reminders 表），进程里只有一个定时器：重启 / 崩溃后从库里接着排，不丢预约。
 * - 时间一律 UTC 毫秒（Date.now()），不碰时区；「每天 8 点」这种本地时刻由 App 换算成 UTC 再上传，
 *   换时区 / 夏令时由 App 下次打开时重新上传纠正。
 * - 到点后先在一个事务里「认领」：一次性的删掉，重复的续排到下一个未来时刻，然后才异步发推送。
 *   所以是「最多送一次」：进程恰好在认领后、发送前崩溃，这一条会丢（App 打开时的本地补发兜底），但绝不重复轰炸。
 * - 停机太久（过点超过 remindStaleSec，默认 6 小时）的不再补发：半夜停电早上恢复，不该一口气弹出一串过期提醒；
 *   重复的照常续排到下一次。
 * - App 在前台（present_until > now）时不发系统推送，App 自己用咿呀岛提醒；认领照常进行。
 * - 推送负载只有 { t:'rem', r: 设备 ID, id: 提醒 ID, ct: 原样密文, at: 计划时刻 }；Topic = 提醒 ID（同一条没送达的旧推送会被新的替换）。
 */
const log = require('./log');

function createScheduler(cfg, db, push) {
  const L = cfg.limits;
  const q = {
    due: db.prepare(`SELECT r.device_id, r.rid, r.at, r.every, r.until, r.ct, d.push_sub, d.present_until
                     FROM reminders r JOIN rdevs d ON d.id = r.device_id WHERE r.at <= ? ORDER BY r.at LIMIT 200`),
    next: db.prepare('SELECT MIN(at) AS at FROM reminders'),
    del: db.prepare('DELETE FROM reminders WHERE device_id = ? AND rid = ? AND at = ?'),
    resched: db.prepare('UPDATE reminders SET at = ?, sent = sent + 1 WHERE device_id = ? AND rid = ? AND at = ?'),
    clearPush: db.prepare('UPDATE rdevs SET push_sub = NULL WHERE id = ?')
  };
  let timer = null, running = false, stopped = true, again = false;
  const stats = { ticks: 0, sent: 0, skippedPresent: 0, skippedStale: 0, noSub: 0, failed: 0, gone: 0 };

  /** 下一次到点（重复规则）：严格晚于 now 的第一个 at + k·every；超过 until 返回 null */
  function nextAt(row, now) {
    if (!row.every || row.every <= 0) return null;
    const k = Math.floor((now - row.at) / row.every) + 1;
    const n = row.at + Math.max(1, k) * row.every;
    if (row.until != null && n > row.until) return null;
    return n;
  }

  async function tick() {
    if (running) { again = true; return; }
    running = true;
    stats.ticks++;
    try {
      for (let round = 0; round < 20; round++) {
        const t = Date.now();
        const rows = q.due.all(t);
        if (!rows.length) break;
        const sends = [];
        db.exec('BEGIN IMMEDIATE');
        try {
          for (const r of rows) {
            const n = nextAt(r, t);
            if (n == null) q.del.run(r.device_id, r.rid, r.at); else q.resched.run(n, r.device_id, r.rid, r.at);
            if (t - r.at > L.remindStaleSec * 1000) { stats.skippedStale++; continue; }
            if (r.present_until > t) { stats.skippedPresent++; continue; }
            if (!r.push_sub) { stats.noSub++; continue; }
            sends.push(r);
          }
          db.exec('COMMIT');
        } catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
        /* 并发 8 路发送 */
        let i = 0;
        const worker = async () => {
          while (i < sends.length) {
            const r = sends[i++];
            let sub;
            try { sub = JSON.parse(r.push_sub); } catch { stats.failed++; continue; }
            const res = await push.send(sub, { t: 'rem', r: r.device_id, id: r.rid, ct: r.ct, at: r.at },
              { ttl: L.remindPushTtlSec, urgency: 'high', topic: r.rid });
            if (res === 'ok') stats.sent++;
            else { stats.failed++; if (res === 'gone') { stats.gone++; q.clearPush.run(r.device_id); } }
          }
        };
        await Promise.all(Array.from({ length: Math.min(8, sends.length) }, worker));
        if (sends.length || rows.length) log.info('remind tick', { due: rows.length, push: sends.length });
        if (rows.length < 200) break;
      }
    } catch (e) {
      log.error('remind tick failed', { err: String(e && e.message || e).slice(0, 200) });
    } finally {
      running = false;
      if (again) { again = false; setImmediate(() => { tick().then(arm); }); }
    }
  }

  /** 按库里最近的到点时间排下一次：最长 30 秒醒一次（兜底系统时钟跳变），最短 200ms */
  function arm() {
    if (stopped) return;
    clearTimeout(timer);
    let wait = 30e3;
    try {
      const n = q.next.get().at;
      if (n != null) wait = Math.max(200, Math.min(30e3, n - Date.now()));
    } catch {}
    timer = setTimeout(() => { tick().then(arm); }, wait);
    timer.unref && timer.unref();
  }

  return {
    start() { stopped = false; tick().then(arm); },
    stop() { stopped = true; clearTimeout(timer); },
    /** 预约有增改时调用：可能有更早的到点 */
    poke() { if (!stopped) arm(); },
    tick, nextAt, stats
  };
}

module.exports = { createScheduler };
