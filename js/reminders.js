/**
 * reminders.js - 本地提醒引擎（纯本地、零网络、无系统推送）
 *
 * 定位：基于「当前时间 × 已有数据」在首页顶部生成提醒卡，点击直达对应模块。
 * 不能用系统推送（无网络、无 Service Worker、file:// 环境），故做成页面内提醒。
 *
 * 规则设计原则：
 * 1. 每条规则返回 { accent, icon, text, go } 或 null（不触发）。
 * 2. 纯函数 evaluate(d, now)，不读 DOM，可单测。
 * 3. 提醒是「温和的注意」，不是告警——文案不制造焦虑。
 */
(function (global) {
  'use strict';

  function isoOf(s) { return (s || '').slice(0, 10); }
  function hoursSince(iso, now) {
    if (!iso) return null;
    var t = new Date(iso).getTime();
    if (isNaN(t)) return null;
    return Math.max(0, (now - t) / 3600000);
  }
  function daysBetween(a, b) {
    return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
  }

  /* ---------- 各规则（返回提醒对象或 null） ---------- */

  /* 喂养间隔：距上次喂养 > 3 小时 */
  function ruleFeeding(d, now) {
    var latest = (d.feedings || []).slice()
      .sort(function (a, b) { return new Date(b.start) - new Date(a.start); })[0];
    if (!latest) return null;
    var h = hoursSince(latest.start, now);
    if (h === null || h < 3) return null;
    return {
      accent: 'feeding', go: 'feeding',
      text: '距上次喂养已过 ' + Math.floor(h) + ' 小时，宝宝可能该吃了。'
    };
  }

  /* 睡眠计时进行中 */
  function ruleSleep(d) {
    if (!d.openSleep) return null;
    return {
      accent: 'sleep', go: 'sleep',
      text: '睡眠计时进行中，宝宝醒来后记得点「结束并记录」。'
    };
  }

  /* 宫缩记录进行中 */
  function ruleContraction(d) {
    if (!d.openContraction) return null;
    return {
      accent: 'contraction', go: 'contraction',
      text: '宫缩记录进行中，注意间隔与强度变化。'
    };
  }

  /* 经期临近：按已有记录的平均周期预测下次，≤2 天提醒 */
  function rulePeriod(d, now) {
    var ps = (d.periods || []).filter(function (p) { return p.start; })
      .sort(function (a, b) { return new Date(a.start) - new Date(b.start); });
    if (ps.length < 2) return null;
    /* 平均周期（最近最多 4 个间隔） */
    var gaps = [];
    for (var i = 1; i < ps.length; i++) {
      gaps.push(daysBetween(isoOf(ps[i - 1].start), isoOf(ps[i].start)));
    }
    gaps = gaps.slice(-4);
    var avg = gaps.reduce(function (s, x) { return s + x; }, 0) / gaps.length;
    if (avg < 15 || avg > 60) return null; /* 异常周期不预测，避免误导 */
    var lastStart = isoOf(ps[ps.length - 1].start);
    var nextIn = Math.round(avg - daysBetween(lastStart, new Date(now)));
    if (nextIn > 2 || nextIn < -7) return null; /* 已过 7 天以上也不再提醒 */
    return {
      accent: 'period', go: 'period',
      text: nextIn >= 0
        ? ('按近 ' + gaps.length + ' 个周期估算，经期可能 ' + (nextIn === 0 ? '就在今天' : nextIn + ' 天后') + ' 到来。')
        : '经期比预估晚了 ' + (-nextIn) + ' 天，留意身体变化。'
    };
  }

  /* 待产包告急：预产期 ≤30 天且完成度 <100% */
  function rulePacking(d, now) {
    var pg = d.pregnancy;
    if (!pg || !(pg.lmp || pg.dueDate)) return null;
    var Util = global.Util;
    var due = pg.dueDate || (Util && pg.lmp ? Util.addDays(pg.lmp, 280) : null);
    if (!due) return null;
    var left = daysBetween(new Date(now), isoOf(due));
    if (left < 0 || left > 30) return null;
    var items = (d.packing && d.packing.items) || [];
    if (!items.length) return {
      accent: 'packing', go: 'packing',
      text: '预产期还有 ' + left + ' 天，待产包还没开始准备。'
    };
    var done = items.filter(function (x) { return x.checked; }).length;
    var pct = Math.round(done / items.length * 100);
    if (pct >= 100) return null;
    return {
      accent: 'packing', go: 'packing',
      text: '预产期还有 ' + left + ' 天，待产包已完成 ' + pct + '%，抓紧收尾。'
    };
  }

  /* 备份提醒：已有数据且 >7 天未导出（与启动 toast 互补，并入提醒卡） */
  function ruleBackup(d, now) {
    var has = (d.feedings || []).length || (d.sleeps || []).length || (d.growth || []).length
      || (d.periods || []).length || (d.contractions || []).length
      || (d.packing && d.packing.items && d.packing.items.length)
      || (d.finance && d.finance.records && d.finance.records.length);
    if (!has) return null;
    var last = d.settings && d.settings.lastExportISO;
    var days = last ? daysBetween(last, new Date(now)) : 999;
    if (days <= 7) return null;
    return {
      accent: 'finance', go: 'settings',
      text: last ? ('已 ' + days + ' 天未备份数据。') : '还没有备份过数据，建议导出一次防丢。'
    };
  }

  var RULES = [ruleSleep, ruleContraction, ruleFeeding, rulePacking, rulePeriod, ruleBackup];

  var Reminders = {
    /** 评估全部规则，返回触发的提醒数组（now 默认当前时间，可注入便于测试） */
    evaluate: function (d, now) {
      now = now || Date.now();
      d = d || {};
      var out = [];
      RULES.forEach(function (r) {
        try { var hit = r(d, now); if (hit) out.push(hit); } catch (e) {}
      });
      return out;
    }
  };

  global.Reminders = Reminders;
})(window);
