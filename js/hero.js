/* ============================================================
 * hero.js · 第 183 次：模块状态插画（样稿：喂养/睡眠/尿布/生长/疫苗/体温）
 *
 * 第 184 次：铺满其余 17 个模块（洗澡/游泳/日晒/饮水/黄疸/吃药/补剂/里程碑/情绪/胎动/宫缩/经期/记账/消耗品/待产包/孕期/白噪音）。
 *
 * 进入模块页时，页头从「小图标 + 标题」换成「大物件插画 + 标题 + 一句当前状态」。
 * 插画不是装饰：它跟着数据动——
 *   喂养：计时中奶瓶轻摇；超过 3 小时没喂也轻摇提示。
 *   睡眠：睡着时摇篮上飘 Zzz、整体调暗。
 *   尿布：今天换得越多，右上角小叠数越高。
 *   生长：小树苗按月龄长大（0 月 0.78 → 36 月 1.0）。
 *   疫苗：底部进度环（已打 / 计划总数）。
 *   体温：上次 ≥37.3℃ 时外圈变暖红光晕。
 * 图片为本地 webp（assets/hero/），离线可用；减少动态效果时只保留静态画面。
 * 纯渲染期派生，只读不落库。
 * ============================================================ */
(function () {
  'use strict';

  function lastOf(arr, key) {
    var best = null, bt = 0, now = Date.now();
    (arr || []).forEach(function (x) {
      if (!x || !x[key]) return;
      var t = new Date(x[key]).getTime();
      if (!isFinite(t) || t > now) return;
      if (t > bt) { bt = t; best = x; }
    });
    return best;
  }
  function todayCount(arr, key) {
    var t = Util.todayISO();
    return (arr || []).filter(function (x) { return x && x[key] && Util.dayKeyOf(x[key]) === t; }).length;
  }
  function ageMonths(d) {
    var b = d && d.settings && d.settings.baby && d.settings.baby.birthDate;
    if (!b) return null;
    var bd = new Date(b), n = new Date();
    if (!isFinite(bd.getTime())) return null;
    return Math.max(0, (n.getFullYear() - bd.getFullYear()) * 12 + (n.getMonth() - bd.getMonth()) - (n.getDate() < bd.getDate() ? 1 : 0));
  }
  var esc = function (s) { return Util.escapeHtml(String(s == null ? '' : s)); };

  var HERO = {
    feeding: function (d) {
      var timer = d.feedingTimer && d.feedingTimer.start;
      if (timer) return { status: '正在喂奶 · 已 ' + Util.fmtGap(Date.now() - new Date(timer).getTime()).num + Util.fmtGap(Date.now() - new Date(timer).getTime()).unit, state: 'live' };
      var r = lastOf(d.feedings, 'start');
      if (!r) return { status: '还没有喂养记录，点底部 + 记第一笔' };
      var gap = Date.now() - new Date(r.start).getTime();
      var amt = r.amount != null ? ' · ' + r.amount + ' mL' : '';
      return { status: '上次 ' + Util.fmtAgo(r.start) + amt, state: gap > 3 * 3600000 ? 'nudge' : '' };
    },
    sleep: function (d) {
      if (d.openSleep && d.openSleep.start) {
        var st = new Date(d.openSleep.start), p2 = function (x) { return (x < 10 ? '0' : '') + x; };
        return { status: '睡着了 · ' + p2(st.getHours()) + ':' + p2(st.getMinutes()) + ' 入睡', state: 'asleep' };
      }
      var r = lastOf(d.sleeps, 'end') || lastOf(d.sleeps, 'start');
      return { status: r ? '醒着 · 上次醒来 ' + Util.fmtAgo(r.end || r.start) : '还没有睡眠记录' };
    },
    diaper: function (d) {
      var n = todayCount(d.diapers, 'time');
      var r = lastOf(d.diapers, 'time');
      return { status: r ? '今天 ' + n + ' 片 · 上次 ' + Util.fmtAgo(r.time) : '还没有尿布记录', badge: n ? String(n) : '' };
    },
    growth: function (d) {
      var m = ageMonths(d);
      var r = lastOf(d.growth, 'date');
      var scale = m == null ? 0.86 : 0.78 + Math.min(m, 36) / 36 * 0.22;
      var parts = [];
      if (m != null) parts.push(m + ' 个月');
      if (r && r.heightCm != null) parts.push(r.heightCm + ' cm');
      if (r && r.weightKg != null) parts.push(r.weightKg + ' kg');
      return { status: parts.length ? parts.join(' · ') : '记一次身高体重，小树苗就开始长', scale: scale };
    },
    vaccine: function (d) {
      var p = Modules.vaccine && Modules.vaccine.progress ? Modules.vaccine.progress(d) : null;
      if (!p) return { status: '填写宝宝生日后自动生成接种表' };
      return { status: '已接种 ' + p.done + ' / ' + p.total + ' 剂', ring: p.total ? Math.min(1, p.done / p.total) : 0 };
    },
    temp: function (d) {
      var r = lastOf(d.temps, 'time');
      if (!r || r.value == null) return { status: '还没有体温记录' };
      var hot = Number(r.value) >= 37.3;
      return { status: '上次 ' + r.value + '℃ · ' + Util.fmtAgo(r.time), state: hot ? 'hot' : '' };
    }
  };


  function todaySum(arr, key, field) {
    var t = Util.todayISO();
    return (arr || []).reduce(function (sum, x) { return (x && x[key] && Util.dayKeyOf(x[key]) === t) ? sum + (parseFloat(x[field]) || 0) : sum; }, 0);
  }
  function hm(iso) { var t = new Date(iso), p2 = function (x) { return (x < 10 ? '0' : '') + x; }; return p2(t.getHours()) + ':' + p2(t.getMinutes()); }
  function md(iso) { var t = new Date(String(iso).length === 10 ? iso + 'T00:00:00' : iso); return (t.getMonth() + 1) + '月' + t.getDate() + '日'; }
  function timed(arr, empty) {
    var r = lastOf(arr, 'time');
    if (!r) return { status: empty };
    return { status: '上次 ' + Util.fmtAgo(r.time) + (r.minutes ? ' · ' + r.minutes + ' 分钟' : '') };
  }
  var MOOD_TXT = { 1: '很低落', 2: '有点低', 3: '一般', 4: '不错', 5: '很好' };

  var HERO2 = {
    bath: function (d) { return timed(d.baths, '还没有洗澡记录'); },
    swim: function (d) { return timed(d.swims, '还没有游泳记录'); },
    sun: function (d) {
      var m = todaySum(d.suns, 'time', 'minutes');
      return m ? { status: '今天晒了 ' + m + ' 分钟', state: 'shine' } : timed(d.suns, '还没有日晒记录');
    },
    water: function (d) {
      var ml = todaySum(d.waters, 'time', 'ml');
      return ml ? { status: '今天喝了 ' + ml + ' mL' } : timed(d.waters, '还没有饮水记录');
    },
    jaundice: function (d) {
      var r = lastOf(d.jaundices, 'time');
      if (!r || r.value == null) return { status: '还没有黄疸记录' };
      return { status: '上次 ' + r.value + (r.unit === 'umol' ? ' μmol/L' : ' mg/dL') + ' · ' + Util.fmtAgo(r.time) };
    },
    meds: function (d) {
      var n = todayCount(d.meds, 'time'), r = lastOf(d.meds, 'time');
      if (!r) return { status: '还没有用药记录' };
      return { status: (n ? '今天已记 ' + n + ' 次 · ' : '') + '上次 ' + Util.fmtAgo(r.time), badge: n ? String(n) : '' };
    },
    supplement: function (d) {
      var n = (d.supplementPlans || []).filter(function (x) { return x && x.active !== false; }).length;
      var t = todayCount(d.supplements, 'time');
      return { status: n ? n + ' 种营养品' + (t ? ' · 今天已吃 ' + t + ' 次' : '') : '添加营养品，安排服用日程' };
    },
    milestone: function (d) {
      var r = lastOf(d.milestones, 'date');
      var n = (d.milestones || []).length;
      return { status: r ? '已记 ' + n + ' 个 · 最近：' + r.title : '记下宝宝的每一个第一次' };
    },
    mood: function (d) {
      var r = lastOf(d.moods, 'time');
      if (!r) return { status: '今天感觉怎么样？' };
      var lv = parseInt(r.level, 10);
      return { status: '上次「' + (MOOD_TXT[lv] || '已记录') + '」· ' + Util.fmtAgo(r.time), state: lv <= 2 ? 'low' : '' };
    },
    fetal: function (d) {
      var n = todayCount(d.fetal, 'time'), r = lastOf(d.fetal, 'time');
      if (!r) return { status: '感到胎动就点一下' };
      return { status: '今天 ' + n + ' 次 · 上次 ' + Util.fmtAgo(r.time), state: (Date.now() - new Date(r.time).getTime()) < 3600000 ? 'beat' : '', badge: n ? String(n) : '' };
    },
    contraction: function (d) {
      if (d.openContraction && d.openContraction.start) return { status: '宫缩中 · ' + hm(d.openContraction.start) + ' 开始', state: 'live' };
      var n = todayCount(d.contractions, 'start'), r = lastOf(d.contractions, 'start');
      return { status: r ? (n ? '今天 ' + n + ' 次 · ' : '') + '上次 ' + Util.fmtAgo(r.start) : '宫缩开始时点一下计时' };
    },
    period: function (d) {
      var r = lastOf(d.periods, 'start');
      if (!r) return { status: '还没有经期记录' };
      var days = Util.daysBetween(String(r.start).slice(0, 10), Util.todayISO());
      if (!r.end && days >= 0 && days < 10) return { status: '经期第 ' + (days + 1) + ' 天', state: 'live' };
      return { status: '上次 ' + md(r.start) + ' 开始' };
    },
    finance: function (d) {
      var ym = Util.todayISO().slice(0, 7);
      var recs = (d.finance && d.finance.records) || [];
      var sum = recs.reduce(function (a, r) { return (r && String(r.date || '').slice(0, 7) === ym) ? a + (parseFloat(r.amount) || 0) : a; }, 0);
      return { status: sum ? '本月已花 ¥' + (Math.round(sum * 100) / 100) : '本月还没有记账' };
    },
    supplies: function (d) {
      var list = d.supplies || [];
      if (!list.length) return { status: '添加消耗品，快用完时提醒你' };
      var low = list.filter(function (x) {
        var tot = parseInt(x.availDays, 10); if (isNaN(tot)) return false;
        var used = Math.max(0, Util.daysBetween(x.date, Util.todayISO()) || 0);
        return tot - used <= 3;
      }).length;
      return { status: low ? low + ' 样快用完了' : list.length + ' 样 · 库存都够用', state: low ? 'warn' : '', badge: low ? String(low) : '' };
    },
    packing: function (d) {
      var items = (d.packing && d.packing.items) || [];
      if (!items.length) return { status: '待产包清单' };
      var c = items.filter(function (x) { return x && x.checked; }).length;
      return { status: '已备 ' + c + ' / ' + items.length + ' 件', ring: c / items.length };
    },
    pregnancy: function (d) {
      var pg = d.pregnancy || {};
      var base = pg.lmp || (pg.dueDate ? Util.addDays(pg.dueDate, -280) : null);
      if (!base) return { status: '填写末次月经或预产期' };
      var el = Util.daysBetween(base, Util.todayISO());
      if (el < 0) return { status: '填写末次月经或预产期' };
      /* 第 220 次：这次怀孕之后已有宝宝出生 → 孕期已结束 */
      if (window.App && typeof App.pregnancyWeekOf === 'function' && App.pregnancyWeekOf(d) === null
        && [(d.settings.baby || {}).birthDate].concat((d.babies || []).map(function (b) { return b && b.birthDate; })).some(function (x) { return x && x >= base; })) {
        return { status: '孕期已结束', ring: 1 };
      }
      if (el > 280) return { status: '已过预产期 ' + (el - 280) + ' 天', ring: 1 }; /* 第 193 次：不再显示「孕 43 周」 */
      return { status: '孕 ' + Math.floor(el / 7) + ' 周 ' + (el % 7) + ' 天', ring: Math.min(1, el / 280) };
    },
    whitenoise: function (d) {
      var w = d.whitenoise || {};
      var on = w.playing && (!w.until || w.until > Date.now());
      return { status: on ? '正在播放' : '选一个声音，陪宝宝入睡', state: on ? 'live' : '' };
    }
  };
  Object.keys(HERO2).forEach(function (k) { HERO[k] = HERO2[k]; });

  /* 状态类名（供 CSS 死类名检查识别）：'is-live' 'is-nudge' 'is-asleep' 'is-hot' 'is-shine' 'is-low' 'is-beat' 'is-warn' */
  var STATE_CLASS = { live: 'is-live', nudge: 'is-nudge', asleep: 'is-asleep', hot: 'is-hot', shine: 'is-shine', low: 'is-low', beat: 'is-beat', warn: 'is-warn' };

  window.Hero = {
    has: function (id) { return !!HERO[id]; },
    html: function (id, title) {
      var d = (window.Storage && Storage.get()) || {};
      var s = {};
      try { s = HERO[id](d) || {}; } catch (e) { s = {}; }
      var style = s.scale ? ' style="--hero-scale:' + s.scale.toFixed(3) + '"' : '';
      var ring = '';
      if (s.ring != null) {
        var C = 2 * Math.PI * 46;
        if (s.ring > 0) ring = '<svg class="hero-ring" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="46"/><circle class="on" cx="50" cy="50" r="46" stroke-dasharray="' + (C * s.ring).toFixed(1) + ' ' + C.toFixed(1) + '"/></svg>';
        else ring = '<svg class="hero-ring" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="46"/></svg>';
      }
      return '<div class="mod-hero' + (STATE_CLASS[s.state] ? ' ' + STATE_CLASS[s.state] : '') + '" data-hero="' + id + '"' + style + '>'
        + '<button type="button" class="hero-art" aria-label="' + esc(title) + '">'
        + ring
        + '<img src="assets/hero/' + id + '.webp" alt="" width="160" height="160" decoding="async">'
        + (s.state === 'asleep' ? '<span class="hero-z" aria-hidden="true"><i>z</i><i>z</i><i>Z</i></span>' : '')
        + (s.badge ? '<span class="hero-badge">' + esc(s.badge) + '</span>' : '')
        + '</button>'
        + '<h1>' + esc(title) + '</h1>'
        + '<p class="hero-status">' + esc(s.status || '') + '</p>'
        + '</div>';
    }
  };

  /* 点一下插画：小小的弹跳彩蛋 */
  document.addEventListener('click', function (e) {
    var art = e.target.closest && e.target.closest('.hero-art');
    if (!art) return;
    art.classList.remove('boing'); void art.offsetWidth; art.classList.add('boing');
  });
})();
