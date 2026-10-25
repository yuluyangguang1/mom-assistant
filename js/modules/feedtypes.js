/* ============================================================
 * feedtypes.js · 第 231 次：亲喂、瓶喂拆成两个独立页面（照用户给的参考截图）
 *
 * 亲喂（Modules.breast，粉色）
 *   摘要句 → 洞察小按钮 → 最近亲喂记录（竖向时间轴）→ 底部「▷ 开始亲喂 | ⊕」
 *   开始 → 全屏计时：夜灯背景、左右侧大按钮、中间大数字（当前这一侧）、
 *          开始时刻（可改）/ 总计 / 另一侧，底部 换边 · 暂停/继续 · 停止；
 *   收起 → 页面底部迷你条（时间 · 当前侧 · 换边 · 暂停）；
 *   停止 → 「保存亲喂」半屏：结束日期 / 结束时间 + 现在 / 5 / 10 / 15 分钟前。
 *   ⊕ → 手动补记（开始时间 + 左右分钟）。
 * 瓶喂（Modules.bottle，黄色）
 *   摘要句 → 洞察 → 最近瓶喂记录 → 「+ 记录瓶喂」
 *   面板：开始日期 / 时间、结束时间开关、母乳 | 配方奶、大号奶量 + 奶瓶刻度（可在奶瓶上拖）、
 *         建议奶量、「▷ 开始喂奶」（计时，结束时记结束时间）与「✓ 保存」。
 *
 * 数据不变形：仍写 d.feedings（亲喂 type=breast；瓶喂 母乳 type=bottle、配方奶 type=formula），
 * 亲喂多存 secL/secR（秒，计时得来的才有）；计时状态 d.feedingTimer（加 paused），
 * 瓶喂进行中 d.bottleTimer { start, src, amount }。
 * ============================================================ */
(function (global) {
  'use strict';
  var Storage = global.Storage, Util = global.Util;
  var Modules = global.Modules = global.Modules || {};
  var esc = function (s) { return Util.escapeHtml(String(s == null ? '' : s)); };
  var p2 = function (n) { return (n < 10 ? '0' : '') + n; };

  /* 内联小图标（图标库里没有的几枚） */
  var SV = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.8v14.4a.8.8 0 0 0 1.2.7l11.3-7.2a.8.8 0 0 0 0-1.4L8.2 4.1A.8.8 0 0 0 7 4.8z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
    stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2.5" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>',
    swap: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h13l-3.5-3.5M20 15H7l3.5 3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9.5l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    bright: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    plusc: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 8v8M8 12h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    cal: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5.5" width="16" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 3.5v4M16 3.5v4M4 10h16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="9" cy="14" r="1" fill="currentColor"/><circle cx="12" cy="14" r="1" fill="currentColor"/><circle cx="15" cy="14" r="1" fill="currentColor"/><circle cx="9" cy="17" r="1" fill="currentColor"/><circle cx="12" cy="17" r="1" fill="currentColor"/></svg>',
    clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="7.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 9.5V13l2.5 1.8M9.5 3.5h5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="18" cy="12" r="1.6" fill="currentColor"/></svg>',
    /* 亲喂：妈妈侧身抱着宝宝（参考图里的小人） */
    nurse: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="5" r="2.4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5 21v-6.5C5 10.9 6.9 9 9.5 9c1.6 0 2.8.7 3.6 1.9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M7.5 14.5c1.5 1.6 4.6 2.3 7.5 1.3 2-.7 3.4-2.1 3.8-3.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="16.4" cy="10.6" r="2.1" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
    pen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19l1-4L15.5 5.5a2 2 0 0 1 3 3L9 18z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>'
  };

  function loc(ms) {
    var d = new Date(ms);
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + 'T' + p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds());
  }
  function isoDay(ms) { return loc(ms).slice(0, 10); }
  function hm(ms) { var d = new Date(ms); return p2(d.getHours()) + ':' + p2(d.getMinutes()); }
  function ms(s) { var t = new Date(s).getTime(); return isFinite(t) ? t : NaN; }
  /* 「12秒」「3分钟」「1小时5分」 */
  function fmtSec(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    if (sec < 60) return sec + '秒';
    var m = Math.floor(sec / 60), s = sec % 60;
    if (m < 60) return m + '分' + (s ? s + '秒' : '钟');
    return Math.floor(m / 60) + '小时' + (m % 60 ? m % 60 + '分' : '');
  }
  function fmtMin(min) {
    min = Math.max(0, Math.round(min || 0));
    if (min < 60) return min + ' 分钟';
    return Math.floor(min / 60) + ' 小时' + (min % 60 ? ' ' + (min % 60) + ' 分' : '');
  }
  function dayLabel(ts, today) {
    var d = isoDay(ts);
    if (d === today) return '今天';
    if (d === isoDay(ms(today + 'T12:00:00') - 864e5)) return '昨天';
    var x = new Date(ts); return (x.getMonth() + 1) + '/' + x.getDate();
  }
  function dayKey(r, DS) { return Util.dayKeyOf(r.start, DS); }
  function valid(r) { return r && isFinite(ms(r.start)); }

  /* 亲喂一条的秒数（计时得来有 secL/secR；手记只有分钟） */
  function breastSec(r) {
    var L = r.secL != null ? Number(r.secL) || 0 : (r.durationL != null ? (Number(r.durationL) || 0) * 60 : null);
    var R = r.secR != null ? Number(r.secR) || 0 : (r.durationR != null ? (Number(r.durationR) || 0) * 60 : null);
    if (L == null && R == null) {
      var tot = (Number(r.durationMin) || 0) * 60;
      return { L: r.side === 'left' ? tot : 0, R: r.side === 'right' ? tot : 0, T: tot, legacy: true };
    }
    L = L || 0; R = R || 0;
    return { L: L, R: R, T: L + R };
  }
  function bottleSrc(r) {
    if (r.type === 'formula') return 'fm';
    if ((Number(r.amountFm) || 0) > 0 && !(Number(r.amountBm) || 0)) return 'fm';
    return 'bm';
  }
  function bottleAmt(r) { var a = Number(r.amount); return isFinite(a) && a > 0 ? Math.round(a) : 0; }

  /* ---------- 计时状态 ---------- */
  function tState(t, now) {
    var side = t.side === 'right' ? 'right' : 'left';
    var cur = t.paused ? 0 : Math.max(0, now - ms(t.sideStart || t.start));
    if (!isFinite(cur)) cur = 0;
    var L = (t.accL || 0) + (side === 'left' ? cur : 0);
    var R = (t.accR || 0) + (side === 'right' ? cur : 0);
    return { side: side, L: L, R: R, T: L + R, paused: !!t.paused };
  }
  function settle(t, now) {
    var s = tState(t, now);
    t.accL = s.L; t.accR = s.R;
    t.sideStart = loc(now);
  }

  /* ---------- 底部半屏面板（挂在 #modalRoot，sheet.js 自动贴底） ---------- */
  function openSheet(accent, title, bodyHTML, onReady) {
    var root = document.getElementById('modalRoot');
    if (!root) return null;
    root.innerHTML = '<div class="modal-mask" data-ft-mask><div class="modal rec-sheet ft-sheet" role="dialog" aria-modal="true" aria-labelledby="ftsTitle" data-accent="' + accent + '"><div class="rs-body">'
      + '<div class="rs-head"><button type="button" class="rs-x" data-x aria-label="关闭">' + icon('close') + '</button>'
      + '<h2 id="ftsTitle">' + esc(title) + '</h2>'
      + '<button type="button" class="rs-ok" data-ok aria-label="保存">' + icon('check') + '</button></div>'
      + bodyHTML + '</div></div></div>';
    var mask = root.querySelector('[data-ft-mask]');
    var box = root.querySelector('.rs-body');
    function onKey(e) { if (e.key === 'Escape') close(); }
    function close() { root.innerHTML = ''; document.removeEventListener('keydown', onKey); if (global.Sheet) Sheet.sync(); }
    document.addEventListener('keydown', onKey);
    mask.addEventListener('click', function (e) { if (e.target === mask) close(); });
    box.querySelector('[data-x]').addEventListener('click', close);
    var api = { box: box, close: close };
    bindWhen(box);
    if (onReady) onReady(api);
    return api;
  }
  function whenTiles(prefix, label, dateV, timeV, maxDate) {
    return '<p class="rs-lbl">' + esc(label) + '</p><div class="rs-when ft-when">'
      + '<label class="rs-tile ft-tile"><span class="ft-ti">' + SV.cal + '</span><span class="ft-tt"><small>' + (prefix === 'e' ? '结束日期' : '日期') + '</small>'
      + '<b data-show="' + prefix + 'Date">' + esc(dayWord(dateV)) + '</b>'
      + '<input type="date" class="ft-hid" id="' + prefix + 'Date" value="' + dateV + '" max="' + maxDate + '" aria-label="' + (prefix === 'e' ? '结束日期' : '日期') + '"></span></label>'
      + '<label class="rs-tile ft-tile"><span class="ft-ti">' + SV.clock + '</span><span class="ft-tt"><small>' + (prefix === 'e' ? '结束时间' : '时间') + '</small>'
      + '<b data-show="' + prefix + 'Time">' + esc(timeV) + '</b>'
      + '<input type="time" class="ft-hid" id="' + prefix + 'Time" value="' + timeV + '" aria-label="' + (prefix === 'e' ? '结束时间' : '时间') + '"></span></label></div>';
  }
  function dayWord(v) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v || '')) return '—';
    var t = isoDay(Date.now()), y = isoDay(Date.now() - 864e5);
    if (v === t) return '今天';
    if (v === y) return '昨天';
    return Number(v.slice(5, 7)) + '月' + Number(v.slice(8, 10)) + '日';
  }
  /* 日期 / 时间磁贴：真输入框透明铺满，上面显示「今天」「18:55」这样的字 */
  function bindWhen(box) {
    Array.prototype.forEach.call(box.querySelectorAll('[data-show]'), function (b) {
      var inp = box.querySelector('#' + b.getAttribute('data-show'));
      if (!inp) return;
      var paint = function () { b.textContent = inp.type === 'date' ? dayWord(inp.value) : (inp.value ? inp.value.slice(0, 5) : '—'); };
      inp.addEventListener('input', paint); inp.addEventListener('change', paint);
      inp._paint = paint;
    });
  }
  function setWhen(box, prefix, msv) {
    var dv = box.querySelector('#' + prefix + 'Date'), tv = box.querySelector('#' + prefix + 'Time');
    if (dv) { dv.value = isoDay(msv); if (dv._paint) dv._paint(); }
    if (tv) { tv.value = hm(msv); if (tv._paint) tv._paint(); }
  }
  function readWhen(box, prefix) {
    var dv = box.querySelector('#' + prefix + 'Date'), tv = box.querySelector('#' + prefix + 'Time');
    if (!dv || !tv || !/^\d{4}-\d{2}-\d{2}$/.test(dv.value) || !/^\d{2}:\d{2}/.test(tv.value)) return NaN;
    return ms(dv.value + 'T' + tv.value.slice(0, 5) + ':00');
  }

  /* ---------- 共用：时间轴 ---------- */
  function timeline(list, DS, title, subOf, icoOf, cls) {
    if (!list.length) return '';
    var h = '<section class="mod-tl ft-tl"><p class="ms-k">' + esc(title) + '</p><ul class="tl">';
    var today = Util.todayISO();
    list.slice(0, 30).forEach(function (r) {
      var t = ms(r.start);
      h += '<li class="tl-row ' + cls + '"><span class="tl-time ft-tlt"><small>' + esc(dayLabel(t, today)) + '</small>' + hm(t) + '</span><span class="tl-dot" aria-hidden="true"></span>'
        + '<button type="button" class="tl-card" data-open="' + esc(r.id) + '" aria-label="' + hm(t) + '，点按修改">'
        + '<span class="tl-ico">' + icoOf(r) + '</span><span class="tl-txt"><b>' + esc(subOf(r).title) + '</b>'
        + (subOf(r).sub ? '<small>' + esc(subOf(r).sub) + '</small>' : '') + '</span>'
        + '<span class="tl-more" aria-hidden="true">' + SV.more + '</span></button>'
        + '<button type="button" class="tl-del" data-del="' + esc(r.id) + '" aria-label="删除" title="删除">' + icon('trash') + '</button></li>';
    });
    return h + '</ul></section>';
  }
  function bindTimeline(view, d) {
    Array.prototype.forEach.call(view.querySelectorAll('[data-open]'), function (b) {
      b.addEventListener('click', function () {
        var it = d.feedings.filter(function (x) { return x.id === b.getAttribute('data-open'); })[0];
        if (it && global.RecordEdit) RecordEdit.open('feeding', it, d.feedings);
      });
    });
    Array.prototype.forEach.call(view.querySelectorAll('[data-del]'), function (b) {
      b.addEventListener('click', function () {
        Util.removeWithUndo(d.feedings, b.getAttribute('data-del'), {
          onSave: function () { Storage.save(); },
          onAfter: function () { global.App.rerender(); },
          deletedText: '已删除喂养记录'
        });
      });
    });
  }
  function insightChips(items) {
    var h = '<div class="ft-ins"><p class="ms-k ft-k">洞察</p><div class="ft-chips">';
    items.forEach(function (it, i) {
      h += '<button type="button" class="ft-chip" data-ins="' + i + '" aria-expanded="false">' + it.ico + '<span>' + esc(it.t) + '</span></button>';
    });
    h += '</div>';
    items.forEach(function (it, i) { h += '<div class="card ft-insc" data-insc="' + i + '" hidden>' + it.html + '</div>'; });
    return h + '</div>';
  }
  function bindChips(view) {
    Array.prototype.forEach.call(view.querySelectorAll('[data-ins]'), function (b) {
      b.addEventListener('click', function () {
        var i = b.getAttribute('data-ins');
        Array.prototype.forEach.call(view.querySelectorAll('[data-insc]'), function (c) {
          var on = c.getAttribute('data-insc') === i && c.hidden;
          c.hidden = !on;
          var bb = view.querySelector('[data-ins="' + c.getAttribute('data-insc') + '"]');
          if (bb) { bb.classList.toggle('is-on', on); bb.setAttribute('aria-expanded', on ? 'true' : 'false'); }
        });
      });
    });
  }

  /* ============================================================
     亲喂
     ============================================================ */
  var fullEl = null, fullTick = null;

  function startTimer(d, lastBreast) {
    var first = (lastBreast && lastBreast.side === 'left') ? 'right' : 'left';
    var now = Date.now();
    d.feedingTimer = { start: loc(now), side: first, sideStart: loc(now), accL: 0, accR: 0 };
    Storage.save();
  }

  function closeFull() {
    if (fullTick) { clearInterval(fullTick); fullTick = null; }
    if (fullEl && fullEl.parentNode) fullEl.parentNode.removeChild(fullEl);
    fullEl = null;
    document.body.classList.remove('ftf-open');
  }

  function openFull() {
    var d = Storage.get(), t = d.feedingTimer;
    if (!t) { closeFull(); return; }
    if (!fullEl) {
      fullEl = document.createElement('div');
      fullEl.className = 'ftf';
      fullEl.setAttribute('data-accent', 'breast');
      fullEl.setAttribute('role', 'dialog');
      fullEl.setAttribute('aria-label', '亲喂计时');
      document.body.appendChild(fullEl);
      document.body.classList.add('ftf-open');
      fullEl.addEventListener('click', onFullClick);
    }
    paintFull();
    if (!fullTick) fullTick = setInterval(tickFull, 500);
  }

  function paintFull() {
    var d = Storage.get(), t = d.feedingTimer;
    if (!t || !fullEl) { closeFull(); return; }
    var s = tState(t, Date.now());
    var other = s.side === 'left' ? 'right' : 'left';
    var sideTxt = s.side === 'left' ? '左侧' : '右侧';
    fullEl.innerHTML = '<div class="ftf-bg" aria-hidden="true"></div>'
      + '<div class="ftf-top"><button type="button" class="ftf-ib" data-f="down" aria-label="收起">' + SV.down + '</button>'
      + '<span class="ftf-tr"><button type="button" class="ftf-ib ftf-del" data-f="cancel" aria-label="放弃这次计时">' + icon('trash') + '</button>'
      + '<button type="button" class="ftf-ib" data-f="dim" aria-label="调暗画面" aria-pressed="' + (fullEl.classList.contains('is-dim') ? 'true' : 'false') + '">' + SV.bright + '</button></span></div>'
      + '<div class="ftf-main">'
      + '<p class="ftf-chip">' + SV.nurse + '<span>' + (s.paused ? '已暂停' : sideTxt + '亲喂中') + '</span><i class="' + (s.paused ? 'is-off' : '') + '"></i></p>'
      + '<div class="ftf-row"><button type="button" class="ftf-side' + (s.side === 'left' ? ' is-on' : '') + '" data-f="left" aria-label="左侧">' + SV.nurse + '<small>左</small></button>'
      + '<span class="ftf-big" data-fv="cur">' + Util.fmtClock(s.side === 'left' ? s.L : s.R).replace(/^0(\d:)/, '$1') + '</span>'
      + '<button type="button" class="ftf-side' + (s.side === 'right' ? ' is-on' : '') + '" data-f="right" aria-label="右侧">' + SV.nurse + '<small>右</small></button></div>'
      + '<div class="ftf-stats">'
      + '<label class="ftf-st ftf-start"><i>' + SV.clock + '</i><b>' + hm(ms(t.start)) + ' <em>' + SV.pen + '</em></b><span>开始</span>'
      + '<input type="time" data-f="start" value="' + hm(ms(t.start)) + '" aria-label="修改开始时刻"></label>'
      + '<div class="ftf-st"><i>' + SV.clock + '</i><b data-fv="tot">' + Util.fmtClock(s.T).replace(/^0(\d:)/, '$1') + '</b><span>总计</span></div>'
      + '<div class="ftf-st"><i>' + SV.nurse + '</i><b data-fv="oth">' + Util.fmtClock(other === 'left' ? s.L : s.R).replace(/^0(\d:)/, '$1') + '</b><span>' + (other === 'left' ? '左侧' : '右侧') + '</span></div>'
      + '</div>'
      + '<div class="ftf-ctl"><button type="button" class="ftf-rb" data-f="swap" aria-label="换到' + (other === 'left' ? '左' : '右') + '侧">' + SV.swap + '</button>'
      + '<button type="button" class="ftf-main-btn" data-f="pause">' + (s.paused ? '继续' : '暂停') + '</button>'
      + '<button type="button" class="ftf-rb" data-f="stop" aria-label="停止并保存">' + SV.stop + '</button></div>'
      + '</div>';
    var si = fullEl.querySelector('input[data-f="start"]');
    if (si) si.addEventListener('change', function () {
      var dd = Storage.get(), tt = dd.feedingTimer; if (!tt || !/^\d{2}:\d{2}/.test(si.value)) return;
      var now = Date.now(), cand = ms(isoDay(now) + 'T' + si.value.slice(0, 5) + ':00');
      if (cand > now) cand -= 864e5;
      var old = ms(tt.start), shift = old - cand; /* 往前改 = 多喂了 shift 毫秒，记到最先那一侧 */
      tt.start = loc(cand);
      var s0 = tState(tt, now);
      if (shift > 0) { if (s0.side === 'left' && !tt.accR) tt.accL = (tt.accL || 0) + shift; else if (s0.side === 'right' && !tt.accL) tt.accR = (tt.accR || 0) + shift; else tt.accL = (tt.accL || 0) + shift; }
      else if (shift < 0) {
        var cut = -shift;
        var takeL = Math.min(tt.accL || 0, cut); tt.accL = (tt.accL || 0) - takeL; cut -= takeL;
        var takeR = Math.min(tt.accR || 0, cut); tt.accR = (tt.accR || 0) - takeR; cut -= takeR;
        if (cut > 0 && !tt.paused) tt.sideStart = loc(Math.min(now, ms(tt.sideStart || tt.start) + cut));
      }
      Storage.save(); paintFull();
    });
  }

  function tickFull() {
    var d = Storage.get(), t = d.feedingTimer;
    if (!t) { closeFull(); return; }
    var s = tState(t, Date.now());
    var f = function (v) { return Util.fmtClock(v).replace(/^0(\d:)/, '$1'); };
    if (fullEl) {
      var a = fullEl.querySelector('[data-fv="cur"]'), b = fullEl.querySelector('[data-fv="tot"]'), c = fullEl.querySelector('[data-fv="oth"]');
      if (a) a.textContent = f(s.side === 'left' ? s.L : s.R);
      if (b) b.textContent = f(s.T);
      if (c) c.textContent = f(s.side === 'left' ? s.R : s.L);
    }
    var mini = document.querySelector('[data-mini-cur]');
    if (mini) mini.textContent = f(s.T);
  }

  function act(kind) {
    var d = Storage.get(), t = d.feedingTimer; if (!t) return;
    var now = Date.now();
    if (kind === 'left' || kind === 'right' || kind === 'swap') {
      var to = kind === 'swap' ? (tState(t, now).side === 'left' ? 'right' : 'left') : kind;
      if (to === tState(t, now).side && !t.paused) return;
      if (!t.paused) settle(t, now); else t.sideStart = loc(now);
      t.side = to; t.paused = false; delete t.paused;
    } else if (kind === 'pause') {
      if (t.paused) { t.sideStart = loc(now); delete t.paused; }
      else { settle(t, now); t.paused = true; }
    }
    Storage.save();
    if (Util.haptic) Util.haptic('ok');
    if (fullEl) paintFull();
    if (global.App && App.currentTab && App.currentTab() === 'breast') App.rerender();
  }

  function onFullClick(e) {
    var b = e.target.closest ? e.target.closest('[data-f]') : null;
    if (!b || b.tagName === 'INPUT') return;
    var k = b.getAttribute('data-f');
    if (k === 'down') { closeFull(); if (global.App) App.rerender(); return; }
    if (k === 'dim') { fullEl.classList.toggle('is-dim'); b.setAttribute('aria-pressed', fullEl.classList.contains('is-dim') ? 'true' : 'false'); return; }
    if (k === 'cancel') {
      Util.confirm({ title: '放弃这次计时？', message: '这次亲喂不会被记录。', okText: '放弃', danger: true, onConfirm: function () {
        var d = Storage.get(); d.feedingTimer = null; Storage.save(); closeFull(); Util.toast('已放弃这次计时', 'ok'); if (global.App) App.rerender();
      } });
      return;
    }
    if (k === 'stop') { openSaveBreast(); return; }
    act(k);
  }

  function openSaveBreast() {
    var d = Storage.get(), t = d.feedingTimer; if (!t) return;
    var now = Date.now();
    var body = whenTiles('e', '结束时间', isoDay(now), hm(now), isoDay(now))
      + '<div class="ft-quick">' + [0, 5, 10, 15].map(function (m) { return '<button type="button" class="ft-q' + (m ? '' : ' is-on') + '" data-back="' + m + '">' + (m ? m + ' 分钟前' : '现在') + '</button>'; }).join('') + '</div>'
      + '<p class="hint ft-hint" data-sum></p>'
      + '<button type="button" class="btn btn-primary ft-save" data-save>' + icon('check') + '保存</button>';
    openSheet('breast', '保存亲喂', body, function (api) {
      var box = api.box, endPick = 0; /* 0 = 现在（精确到秒）；>0 = N 分钟前；-1 = 手动改过 */
      function endMs() {
        if (endPick >= 0) return Date.now() - endPick * 60000;
        var e = readWhen(box, 'e'); return isFinite(e) ? e : Date.now();
      }
      function calc() {
        var tt = Storage.get().feedingTimer; if (!tt) return null;
        var n = Date.now(), s = tState(tt, n), e = Math.min(n, endMs());
        var cut = Math.max(0, n - e);
        var L = s.L, R = s.R;
        if (cut && !s.paused) { if (s.side === 'left') L = Math.max(0, L - cut); else R = Math.max(0, R - cut); }
        return { L: Math.round(L / 1000), R: Math.round(R / 1000), end: e };
      }
      function paintSum() {
        var c = calc(), el = box.querySelector('[data-sum]'); if (!c || !el) return;
        el.textContent = '共 ' + fmtSec(c.L + c.R) + '（左 ' + fmtSec(c.L) + ' · 右 ' + fmtSec(c.R) + '）';
      }
      paintSum();
      ['eDate', 'eTime'].forEach(function (id) { var el = box.querySelector('#' + id); if (el) el.addEventListener('change', function () { endPick = -1; Array.prototype.forEach.call(box.querySelectorAll('[data-back]'), function (x) { x.classList.remove('is-on'); }); paintSum(); }); });
      var sumTick = setInterval(function () { if (!box.isConnected) { clearInterval(sumTick); return; } if (endPick >= 0) paintSum(); }, 1000);
      Array.prototype.forEach.call(box.querySelectorAll('[data-back]'), function (b) {
        b.addEventListener('click', function () {
          var m = Number(b.getAttribute('data-back')) || 0, e = Date.now() - m * 60000;
          var tt = Storage.get().feedingTimer; if (tt && e < ms(tt.start)) { e = ms(tt.start); m = Math.max(0, (Date.now() - e) / 60000); }
          endPick = m;
          setWhen(box, 'e', e);
          Array.prototype.forEach.call(box.querySelectorAll('[data-back]'), function (x) { x.classList.toggle('is-on', x === b); });
          paintSum();
        });
      });
      function save() {
        var dd = Storage.get(), tt = dd.feedingTimer; if (!tt) { api.close(); return; }
        var c = calc();
        if (c.end < ms(tt.start)) { Util.toast('结束时间不能早于开始时间', 'warn'); return; }
        if (c.L + c.R < 1) { Util.toast('这次计时还不到 1 秒', 'warn'); return; }
        var rec = {
          id: Util.uid(), type: 'breast', start: tt.start, end: loc(c.end),
          secL: c.L, secR: c.R,
          durationL: Math.round(c.L / 60), durationR: Math.round(c.R / 60),
          durationMin: Math.max(1, Math.round((c.L + c.R) / 60)),
          side: (c.L && c.R) ? 'both' : (c.L ? 'left' : 'right'),
          amount: null, amountBm: null, amountFm: null, note: null, newFood: null, dish: null, ing: null, steps: null
        };
        dd.feedings.push(rec);
        dd.feedingTimer = null;
        if (Storage.save()) Util.toast('已记录亲喂 ' + fmtSec(c.L + c.R), 'ok');
        api.close(); closeFull(); global.App.rerender();
      }
      box.querySelector('[data-save]').addEventListener('click', save);
      box.parentNode.parentNode.querySelector('[data-ok]').addEventListener('click', save);
    });
  }

  function openManualBreast(d) {
    var now = Date.now();
    var body = whenTiles('s', '开始时间', isoDay(now), hm(now), isoDay(now))
      + ['L', 'R'].map(function (k) {
        return '<p class="rs-lbl">' + (k === 'L' ? '左侧' : '右侧') + '</p><div class="ft-step" data-step="' + k + '">'
          + '<button type="button" class="ft-sb" data-d="-1" aria-label="减少">−</button>'
          + '<span class="ft-sv"><input type="number" inputmode="numeric" min="0" max="120" value="0" id="m' + k + '" aria-label="' + (k === 'L' ? '左侧' : '右侧') + '分钟"><small>分钟</small></span>'
          + '<button type="button" class="ft-sb" data-d="1" aria-label="增加">+</button></div>';
      }).join('')
      + '<label class="rs-lbl ft-note">备注<input type="text" id="mNote" maxlength="40" placeholder="可选"></label>'
      + '<button type="button" class="btn btn-primary ft-save" data-save>' + icon('check') + '保存</button>';
    openSheet('breast', '补记亲喂', body, function (api) {
      var box = api.box;
      Array.prototype.forEach.call(box.querySelectorAll('[data-step]'), function (w) {
        var inp = w.querySelector('input');
        Array.prototype.forEach.call(w.querySelectorAll('[data-d]'), function (b) {
          b.addEventListener('click', function () {
            var v = Math.max(0, Math.min(120, (parseInt(inp.value, 10) || 0) + Number(b.getAttribute('data-d'))));
            inp.value = v;
          });
        });
      });
      function save() {
        var st = readWhen(box, 's');
        if (!isFinite(st)) { Util.toast('请选好开始时间', 'warn'); return; }
        if (st > Date.now() + 60000) { Util.toast('开始时间不能晚于现在', 'warn'); return; }
        var L = Math.max(0, Math.min(120, parseInt(box.querySelector('#mL').value, 10) || 0));
        var R = Math.max(0, Math.min(120, parseInt(box.querySelector('#mR').value, 10) || 0));
        if (!L && !R) { Util.toast('请至少填一侧的分钟数', 'warn'); return; }
        var note = (box.querySelector('#mNote').value || '').trim().slice(0, 40);
        var dd = Storage.get();
        dd.feedings.push({ id: Util.uid(), type: 'breast', start: loc(st), durationL: L, durationR: R, durationMin: L + R,
          side: (L && R) ? 'both' : (L ? 'left' : 'right'), amount: null, amountBm: null, amountFm: null,
          note: note || null, newFood: null, dish: null, ing: null, steps: null });
        if (Storage.save()) Util.toast('已补记亲喂 ' + (L + R) + ' 分钟', 'ok');
        api.close(); global.App.rerender();
      }
      box.querySelector('[data-save]').addEventListener('click', save);
      box.parentNode.parentNode.querySelector('[data-ok]').addEventListener('click', save);
    });
  }

  Modules.breast = {
    id: 'breast',
    title: '亲喂',
    render: function (view) {
      var d = Storage.get();
      var DS = Util.dayStartHour(d);
      var dayNow = Util.dayKeyOf(new Date(), DS);
      var list = d.feedings.filter(function (r) { return valid(r) && r.type === 'breast'; })
        .sort(function (a, b) { return ms(b.start) - ms(a.start); });
      var todayL = list.filter(function (r) { return dayKey(r, DS) === dayNow; });
      var todaySec = todayL.reduce(function (s, r) { return s + breastSec(r).T; }, 0);
      var last = list[0];
      var html = '';

      var sum = todayL.length
        ? '今天亲喂了 <b>' + esc(fmtSec(todaySec)) + '</b>，共 <b>' + todayL.length + '</b> 次。'
        : '今天还没有<b>亲喂</b>记录。';
      if (last) sum += '上次：<b>' + esc(Util.fmtAgo(last.start).replace(/\s/g, '')) + '</b>';
      html += '<div class="mod-sum ft-sum"><span class="ms-k">摘要</span><p>' + sum + '</p></div>';

      /* 洞察 */
      if (list.length) {
        var d7 = global.DayChart ? DayChart.lastDays(dayNow, 7) : [];
        var wk = list.filter(function (r) { return d7.indexOf(dayKey(r, DS)) >= 0; });
        var wL = 0, wR = 0; wk.forEach(function (r) { var s = breastSec(r); wL += s.L; wR += s.R; });
        var next = last && last.side === 'left' ? '右' : (last && last.side === 'right' ? '左' : null);
        var sideHtml = '<h2>左右侧</h2><p class="hint">近 7 天左侧 <b>' + esc(fmtMin(wL / 60)) + '</b>，右侧 <b>' + esc(fmtMin(wR / 60)) + '</b>。'
          + (next ? '上次是' + (next === '右' ? '左' : '右') + '侧，这次建议先喂 <b>' + next + '侧</b>。' : '') + '</p>';
        var cntHtml = '<h2>近 7 天</h2>';
        if (global.DayChart) {
          cntHtml += DayChart.bars(d7.map(function (k) {
            var n = list.filter(function (r) { return dayKey(r, DS) === k; }).length;
            return { key: k, v: n, txt: String(n) };
          }), dayNow, '近 7 天亲喂次数');
        }
        cntHtml += '<p class="hint">每天亲喂的次数。只和宝宝自己比就好。</p>';
        html += insightChips([{ ico: SV.nurse, t: '左右侧', html: sideHtml }, { ico: icon('clock'), t: '近 7 天', html: cntHtml }]);
      }

      html += timeline(list, DS, '最近亲喂记录', function (r) {
        var s = breastSec(r), parts = [];
        var cm = function (sec, exact) { return exact ? fmtSec(sec) : fmtMin(sec / 60).replace(/\s/g, ''); };
        if (s.legacy) parts.push(cm(s.T));
        else {
          parts.push(cm(s.T, r.secL != null || r.secR != null));
          if (s.L) parts.push('左' + cm(s.L, r.secL != null));
          if (s.R) parts.push('右' + cm(s.R, r.secR != null));
        }
        if (r.note) parts.push(r.note);
        return { title: '亲喂', sub: parts.join(' · ') };
      }, function () { return SV.nurse; }, 'tl-f-breast');
      if (!list.length) html += '<div class="mod-empty"><p>点「开始亲喂」边喂边计时，左右侧随时切换。<br>喂完了才想起来？点右边的 ⊕ 补记。</p></div>';

      /* 底部：计时中显示迷你条，否则「开始亲喂 | ⊕」 */
      var t = d.feedingTimer;
      if (t) {
        var s = tState(t, Date.now());
        html += '<div class="mod-cta ft-cta"><div class="ft-mini" data-accent="breast">'
          + '<button type="button" class="ft-mini-open" data-mini="open" aria-label="打开计时">' + SV.nurse
          + '<b data-mini-cur>' + Util.fmtClock(s.T).replace(/^0(\d:)/, '$1') + '</b></button>'
          + '<span class="ft-mini-side">' + (s.paused ? '暂停' : (s.side === 'left' ? '左' : '右')) + '</span>'
          + '<button type="button" class="ft-mini-b" data-mini="swap" aria-label="换边">' + SV.swap + '</button>'
          + '<button type="button" class="ft-mini-b" data-mini="pause" aria-label="' + (s.paused ? '继续' : '暂停') + '">' + (s.paused ? SV.play : SV.pause) + '</button></div></div>';
      } else {
        html += '<div class="mod-cta ft-cta"><div class="ft-split" data-accent="breast">'
          + '<button type="button" class="ft-split-main" data-start>' + SV.play + '<span>开始亲喂</span></button>'
          + '<button type="button" class="ft-split-add" data-manual aria-label="补记一次亲喂">' + SV.plusc + '</button></div></div>';
      }
      view.innerHTML = '<div class="ft-page" data-accent="breast">' + html + '</div>';

      bindChips(view);
      bindTimeline(view, d);
      var lastB = list.filter(function (r) { return r.side === 'left' || r.side === 'right'; })[0];
      var sb = view.querySelector('[data-start]');
      if (sb) sb.addEventListener('click', function () { startTimer(d, lastB); if (Util.haptic) Util.haptic('ok'); global.App.rerender(); openFull(); });
      var mb = view.querySelector('[data-manual]');
      if (mb) mb.addEventListener('click', function () { openManualBreast(d); });
      Array.prototype.forEach.call(view.querySelectorAll('[data-mini]'), function (b) {
        b.addEventListener('click', function () {
          var k = b.getAttribute('data-mini');
          if (k === 'open') openFull(); else act(k);
        });
      });
      if (t && !fullTick) fullTick = setInterval(tickFull, 1000);
      if (t && fullEl) paintFull();
    },
    _openFull: openFull,
    _act: function (k) { act(k); },
    _closeFull: closeFull,
    _state: tState,
    _fmtSec: fmtSec
  };

  /* ============================================================
     瓶喂
     ============================================================ */
  var BMAX = 300;
  /* 第 233 次：每日奶量参考——国家卫生健康委《婴幼儿营养喂养评估服务指南（试行）》
     （国卫办妇幼函〔2024〕452 号，2025-02-08 发布）。指南只给「每日总量」，并明确
     「允许每次喂奶量有波动，避免刻板要求每次摄入固定的奶量，但每日喂奶总量要达到要求」，
     所以这里不再给「每顿建议量」，只给全天参考；快捷奶量取自己最近常冲的量。
     满月、3 月龄两档是指南对混合喂养 / 人工喂养的口径；6 月龄起是每日奶类总量（含母乳）。 */
  var NHC_REF = [
    { from: 0, to: 2, label: '满月前后', lo: 600, hi: 700, mixed: true },
    { from: 2, to: 6, label: '3 月龄前后', lo: 800, hi: 900, mixed: true },
    { from: 6, to: 8, label: '6 月龄', lo: 800, hi: 1000, times: '5～6 次' },
    { from: 8, to: 12, label: '8 月龄', lo: 700, hi: 800, times: '4～5 次' },
    { from: 12, to: 18, label: '12 月龄', lo: 600, hi: 700, times: '2～3 次' },
    { from: 18, to: 37, label: '18～24 月龄', lo: 400, hi: 600, times: '2～3 次' }
  ];
  function ageMonthsOf(d) {
    var b = d && d.settings && d.settings.baby && d.settings.baby.birthDate;
    if (!b || !/^\d{4}-\d{2}-\d{2}/.test(b)) return null;
    var bd = new Date(b.slice(0, 10) + 'T00:00:00'), n = new Date();
    if (!isFinite(bd.getTime()) || bd > n) return null;
    return Math.max(0, (n.getFullYear() - bd.getFullYear()) * 12 + (n.getMonth() - bd.getMonth()) - (n.getDate() < bd.getDate() ? 1 : 0));
  }
  function nhcRef(d) {
    var m = ageMonthsOf(d); if (m == null) return null;
    for (var i = 0; i < NHC_REF.length; i++) if (m >= NHC_REF[i].from && m < NHC_REF[i].to) return NHC_REF[i];
    return null;
  }
  function refLine(ref) {
    if (!ref) return '';
    return ref.label + '每日' + (ref.mixed ? '喂奶' : '奶类') + '约 ' + ref.lo + '～' + ref.hi + ' mL' + (ref.times ? '，分 ' + ref.times : '')
      + (ref.mixed ? '（混合 / 人工喂养）' : '（含母乳）');
  }
  /* 快捷奶量：最近 20 条瓶喂里出现最多的 4 个量（按大小排），不足用 60/90/120/150 补 */
  function quickAmounts(list) {
    var cnt = {};
    list.slice(0, 20).forEach(function (r) { var a = bottleAmt(r); if (a) cnt[a] = (cnt[a] || 0) + 1; });
    var top = Object.keys(cnt).map(Number).sort(function (a, b) { return cnt[b] - cnt[a] || b - a; }).slice(0, 4);
    [60, 90, 120, 150, 180].forEach(function (v) { if (top.length < 4 && top.indexOf(v) < 0) top.push(v); });
    return top.sort(function (a, b) { return a - b; });
  }
  function bottleSVG(v) {
    /* 奶瓶：瓶身 x 40–140、y 92–232；刻度 100/200/300 */
    var top = 100, bot = 228, h = bot - top;
    var lv = bot - Math.max(0, Math.min(BMAX, v)) / BMAX * h;
    var ticks = '';
    for (var i = 1; i <= 12; i++) {
      var y = bot - i * h / 12, major = i % 4 === 0;
      ticks += '<line x1="' + (major ? 104 : 112) + '" x2="126" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '" class="' + (major ? 'bt-maj' : 'bt-min') + '"/>';
      if (major) ticks += '<text x="72" y="' + (y + 4).toFixed(1) + '" class="bt-num">' + (i / 4 * 100) + '</text>';
    }
    return '<svg class="ft-bottle" viewBox="0 0 180 250" role="img" aria-label="奶瓶刻度，上下拖动调奶量">'
      + '<defs><clipPath id="btClip"><path d="M44 96 Q40 100 40 112 L40 214 Q40 236 62 236 L118 236 Q140 236 140 214 L140 112 Q140 100 136 96 Z"/></clipPath>'
      + '<linearGradient id="btMilk" x1="0" x2="1"><stop offset="0" stop-color="#F4EFE4"/><stop offset=".55" stop-color="#FFFDF7"/><stop offset="1" stop-color="#E9E2D3"/></linearGradient>'
      + '<linearGradient id="btTeat" x1="0" x2="1"><stop offset="0" stop-color="#8FA3B3"/><stop offset=".5" stop-color="#B4C5D2"/><stop offset="1" stop-color="#7E93A4"/></linearGradient></defs>'
      + '<path d="M90 8 C84 8 82 16 84 24 C86 32 80 44 70 56 C60 66 50 70 46 78 L134 78 C130 70 120 66 110 56 C100 44 94 32 96 24 C98 16 96 8 90 8 Z" fill="url(#btTeat)"/>'
      + '<rect x="38" y="76" width="104" height="22" rx="8" class="bt-ring"/>'
      + '<path d="M44 96 Q40 100 40 112 L40 214 Q40 236 62 236 L118 236 Q140 236 140 214 L140 112 Q140 100 136 96 Z" class="bt-glass"/>'
      + '<g clip-path="url(#btClip)"><rect class="bt-milk" x="36" y="' + lv.toFixed(1) + '" width="108" height="' + (240 - lv).toFixed(1) + '" fill="url(#btMilk)"/>'
      + '<ellipse class="bt-surf" cx="90" cy="' + lv.toFixed(1) + '" rx="52" ry="3.2"/></g>'
      + ticks + '</svg>';
  }

  function openBottleSheet(d, startNow) {
    var list = d.feedings.filter(function (r) { return valid(r) && (r.type === 'bottle' || r.type === 'formula'); })
      .sort(function (a, b) { return ms(b.start) - ms(a.start); });
    var last = list[0];
    var src = last ? bottleSrc(last) : 'bm';
    var amt = last ? bottleAmt(last) : 90;
    if (!amt) amt = 90;
    var now = Date.now();
    var sugg = quickAmounts(list);
    var ref = nhcRef(d);
    var DSb = Util.dayStartHour(d), dnb = Util.dayKeyOf(new Date(), DSb);
    var todayMl = list.filter(function (r) { return Util.dayKeyOf(r.start, DSb) === dnb; }).reduce(function (s2, r) { return s2 + bottleAmt(r); }, 0);
    var body = whenTiles('s', '开始时间', isoDay(now), hm(now), isoDay(now))
      + '<div class="ft-endrow"><span>结束时间</span><button type="button" class="ft-switch" role="switch" aria-checked="false" data-endsw aria-label="记结束时间"><i></i></button></div>'
      + '<div class="ft-endbox" data-endbox hidden>' + whenTiles('e', '', isoDay(now), hm(now), isoDay(now)).replace('<p class="rs-lbl"></p>', '') + '</div>'
      + '<div class="ft-seg" role="radiogroup" aria-label="奶的种类">'
      + '<button type="button" role="radio" data-src="bm" aria-checked="' + (src === 'bm') + '" class="' + (src === 'bm' ? 'is-on' : '') + '">母乳</button>'
      + '<button type="button" role="radio" data-src="fm" aria-checked="' + (src === 'fm') + '" class="' + (src === 'fm' ? 'is-on' : '') + '">配方奶</button></div>'
      + '<p class="ft-amtk"><b>奶量</b> 1–' + BMAX + ' mL</p>'
      + '<div class="ft-amt"><label class="ft-amtbox"><input type="number" inputmode="numeric" min="1" max="' + BMAX + '" id="bAmt" value="' + amt + '" aria-label="奶量（毫升）"><small>mL</small></label>'
      + '<div class="ft-btl" data-btl>' + bottleSVG(amt) + '</div></div>'
      + '<p class="rs-lbl">常用奶量</p><div class="ft-quick ft-sugg">' + sugg.map(function (v) { return '<button type="button" class="ft-q' + (v === amt ? ' is-on' : '') + '" data-amt="' + v + '">' + v + 'mL</button>'; }).join('') + '</div>'
      + (ref ? '<p class="ft-ref">' + esc(refLine(ref)) + '。今天已瓶喂 <b>' + todayMl + ' mL</b>。每顿多一点少一点都正常，看全天总量就好。<small>出处：国家卫生健康委《婴幼儿营养喂养评估服务指南（试行）》，2025 年 2 月</small></p>' : '')
      + '<label class="rs-lbl ft-note">备注<input type="text" id="bNote" maxlength="40" placeholder="可选"></label>'
      + '<div class="ft-two"><button type="button" class="btn ft-go" data-go>' + SV.play + '开始喂奶</button>'
      + '<button type="button" class="btn btn-primary ft-save" data-save>' + icon('check') + '保存</button></div>';
    openSheet('bottle', '瓶喂', body, function (api) {
      var box = api.box, endOn = false;
      var inp = box.querySelector('#bAmt');
      function setAmt(v, fromInput) {
        v = Math.max(0, Math.min(BMAX, Math.round(v)));
        if (!fromInput) inp.value = v || '';
        box.querySelector('[data-btl]').innerHTML = bottleSVG(v);
        Array.prototype.forEach.call(box.querySelectorAll('[data-amt]'), function (b) { b.classList.toggle('is-on', Number(b.getAttribute('data-amt')) === v); });
      }
      inp.addEventListener('input', function () { setAmt(parseInt(inp.value, 10) || 0, true); });
      Array.prototype.forEach.call(box.querySelectorAll('[data-amt]'), function (b) {
        b.addEventListener('click', function () { setAmt(Number(b.getAttribute('data-amt'))); });
      });
      Array.prototype.forEach.call(box.querySelectorAll('[data-src]'), function (b) {
        b.addEventListener('click', function () {
          src = b.getAttribute('data-src');
          Array.prototype.forEach.call(box.querySelectorAll('[data-src]'), function (x) { var on = x === b; x.classList.toggle('is-on', on); x.setAttribute('aria-checked', on ? 'true' : 'false'); });
        });
      });
      var sw = box.querySelector('[data-endsw]');
      sw.addEventListener('click', function () {
        endOn = !endOn; sw.setAttribute('aria-checked', endOn ? 'true' : 'false'); sw.classList.toggle('is-on', endOn);
        box.querySelector('[data-endbox]').hidden = !endOn;
      });
      /* 在奶瓶上拖动调奶量（5 mL 一档） */
      var btl = box.querySelector('[data-btl]');
      btl.setAttribute('data-nodrag', '');
      function fromY(cy) {
        var svg = btl.querySelector('svg'); if (!svg) return;
        var r = svg.getBoundingClientRect(); if (!r.height) return;
        var y = (cy - r.top) / r.height * 250;
        var v = (228 - y) / (228 - 100) * BMAX;
        setAmt(Math.max(5, Math.round(v / 5) * 5));
      }
      var dragging = false;
      btl.addEventListener('pointerdown', function (e) { dragging = true; try { btl.setPointerCapture(e.pointerId); } catch (x) { /* */ } fromY(e.clientY); e.preventDefault(); });
      btl.addEventListener('pointermove', function (e) { if (dragging) { fromY(e.clientY); e.preventDefault(); } });
      ['pointerup', 'pointercancel'].forEach(function (ev) { btl.addEventListener(ev, function () { dragging = false; }); });

      function readAmt() {
        var v = parseInt(inp.value, 10);
        if (!isFinite(v) || v < 1 || v > BMAX) { Util.toast('奶量请填 1–' + BMAX + ' mL', 'warn'); return null; }
        return v;
      }
      function save() {
        var v = readAmt(); if (v == null) return;
        var st = readWhen(box, 's');
        if (!isFinite(st)) { Util.toast('请选好开始时间', 'warn'); return; }
        if (st > Date.now() + 60000) { Util.toast('开始时间不能晚于现在', 'warn'); return; }
        var en = null;
        if (endOn) {
          en = readWhen(box, 'e');
          if (!isFinite(en) || en < st) { Util.toast('结束时间不能早于开始时间', 'warn'); return; }
        }
        var note = (box.querySelector('#bNote').value || '').trim().slice(0, 40);
        var dd = Storage.get();
        var rec = { id: Util.uid(), type: src === 'fm' ? 'formula' : 'bottle', start: loc(st), amount: v,
          amountBm: src === 'bm' ? v : null, amountFm: src === 'fm' ? v : null,
          durationMin: en ? Math.max(1, Math.round((en - st) / 60000)) : null, durationL: null, durationR: null, side: null,
          note: note || null, newFood: null, dish: null, ing: null, steps: null };
        if (en) rec.end = loc(en);
        dd.feedings.push(rec);
        if (Storage.save()) {
          Util.toast('已记录瓶喂 ' + v + ' mL', 'ok', { label: '撤销', onClick: function () {
            var x = Storage.get();
            for (var i = x.feedings.length - 1; i >= 0; i--) { if (x.feedings[i].id === rec.id) { x.feedings.splice(i, 1); break; } }
            Storage.save(); global.App.rerender();
          } });
        }
        api.close(); global.App.rerender();
      }
      box.querySelector('[data-save]').addEventListener('click', save);
      box.parentNode.parentNode.querySelector('[data-ok]').addEventListener('click', save);
      box.querySelector('[data-go]').addEventListener('click', function () {
        var v = readAmt(); if (v == null) return;
        var dd = Storage.get();
        dd.bottleTimer = { start: loc(Date.now()), src: src, amount: v };
        Storage.save(); api.close(); global.App.rerender();
      });
      if (startNow) box.querySelector('[data-go]').focus();
    });
  }

  var btTick = null;
  Modules.bottle = {
    id: 'bottle',
    title: '瓶喂',
    render: function (view) {
      var d = Storage.get();
      var DS = Util.dayStartHour(d);
      var dayNow = Util.dayKeyOf(new Date(), DS);
      var list = d.feedings.filter(function (r) { return valid(r) && (r.type === 'bottle' || r.type === 'formula'); })
        .sort(function (a, b) { return ms(b.start) - ms(a.start); });
      var todayL = list.filter(function (r) { return dayKey(r, DS) === dayNow; });
      var todayMl = todayL.reduce(function (s, r) { return s + bottleAmt(r); }, 0);
      var last = list[0];
      var html = '';
      var sum = todayL.length
        ? '今天瓶喂了 <b>' + todayL.length + '</b> 次，共 <b>' + todayMl + ' mL</b>。'
        : '今天还没有<b>瓶喂</b>记录。';
      if (last) sum += '上次：<b>' + esc(Util.fmtAgo(last.start).replace(/\s/g, '')) + '</b>';
      html += '<div class="mod-sum ft-sum"><span class="ms-k">摘要</span><p>' + sum + '</p></div>';

      if (list.length) {
        var d7 = global.DayChart ? DayChart.lastDays(dayNow, 7) : [];
        var wk = list.filter(function (r) { return d7.indexOf(dayKey(r, DS)) >= 0; });
        var bm = 0, fm = 0; wk.forEach(function (r) { if (bottleSrc(r) === 'fm') fm += bottleAmt(r); else bm += bottleAmt(r); });
        var days = {}; wk.forEach(function (r) { days[dayKey(r, DS)] = 1; });
        var nd = Object.keys(days).length;
        var amtHtml = '<h2>近 7 天奶量</h2>';
        if (global.DayChart) {
          amtHtml += DayChart.bars(d7.map(function (k) {
            var v = list.filter(function (r) { return dayKey(r, DS) === k; }).reduce(function (s, r) { return s + bottleAmt(r); }, 0);
            return { key: k, v: v, txt: v ? String(v) : '' };
          }), dayNow, '近 7 天瓶喂奶量');
        }
        var refB = nhcRef(d);
        amtHtml += '<p class="hint">' + (nd ? '有记录的 ' + nd + ' 天，日均瓶喂 <b>' + Math.round((bm + fm) / nd) + ' mL</b>。' : '')
          + (refB ? '参考：' + esc(refLine(refB)) + '。亲喂的量没法算进来，混合喂养时只看这个数会偏低。' : '只统计你自己记的数。') + '</p>'
          + (refB ? '<p class="ms-ref">出处：国家卫生健康委《婴幼儿营养喂养评估服务指南（试行）》（国卫办妇幼函〔2024〕452 号）</p>' : '');
        var srcHtml = '<h2>母乳与配方奶</h2><p class="hint">近 7 天瓶喂母乳 <b>' + bm + ' mL</b>，配方奶 <b>' + fm + ' mL</b>。</p>';
        html += insightChips([{ ico: icon('bottle'), t: '近 7 天奶量', html: amtHtml }, { ico: icon('formula'), t: '母乳与配方', html: srcHtml }]);
      }

      html += timeline(list, DS, '最近瓶喂记录', function (r) {
        var parts = [];
        var a = bottleAmt(r); if (a) parts.push(a + 'mL');
        parts.push(bottleSrc(r) === 'fm' ? '配方奶' : '母乳');
        var lo = Number(r.leftover); if (lo > 0 && isFinite(lo)) parts.push('剩 ' + lo + 'mL');
        if (r.note) parts.push(r.note);
        return { title: '奶瓶喂养', sub: parts.join(' · ') };
      }, function () { return icon('bottle'); }, 'tl-f-bottle');
      if (!list.length) html += '<div class="mod-empty"><p>点「记录瓶喂」，选母乳或配方奶、定好奶量就能记下。<br>也可以先点「开始喂奶」，喂完再结束。</p></div>';

      var bt = d.bottleTimer;
      if (bt) {
        html += '<div class="mod-cta ft-cta"><div class="ft-mini" data-accent="bottle">'
          + '<span class="ft-mini-open">' + icon('bottle') + '<b data-bt-cur>' + Util.fmtClock(Date.now() - ms(bt.start)).replace(/^0(\d:)/, '$1') + '</b></span>'
          + '<span class="ft-mini-side">' + (bt.amount ? bt.amount + 'mL ' : '') + (bt.src === 'fm' ? '配方奶' : '母乳') + '</span>'
          + '<button type="button" class="ft-mini-b" data-bt="cancel" aria-label="放弃">' + icon('close') + '</button>'
          + '<button type="button" class="ft-mini-end" data-bt="end">结束</button></div></div>';
      } else {
        html += '<div class="mod-cta ft-cta"><button type="button" class="mc-main ft-bmain" data-accent="bottle" data-new>' + icon('plus') + '<span>记录瓶喂</span></button></div>';
      }
      view.innerHTML = '<div class="ft-page" data-accent="bottle">' + html + '</div>';
      bindChips(view);
      bindTimeline(view, d);
      var nb = view.querySelector('[data-new]');
      if (nb) nb.addEventListener('click', function () { openBottleSheet(d); });
      if (btTick) { clearInterval(btTick); btTick = null; }
      if (bt) {
        btTick = setInterval(function () {
          var el = document.querySelector('[data-bt-cur]'), x = Storage.get().bottleTimer;
          if (!el || !x) { clearInterval(btTick); btTick = null; return; }
          el.textContent = Util.fmtClock(Date.now() - ms(x.start)).replace(/^0(\d:)/, '$1');
        }, 1000);
        Array.prototype.forEach.call(view.querySelectorAll('[data-bt]'), function (b) {
          b.addEventListener('click', function () {
            var dd = Storage.get(), x = dd.bottleTimer; if (!x) return;
            if (b.getAttribute('data-bt') === 'cancel') {
              Util.confirm({ title: '放弃这次瓶喂？', message: '不会留下记录。', okText: '放弃', danger: true, onConfirm: function () { dd.bottleTimer = null; Storage.save(); global.App.rerender(); } });
              return;
            }
            var st = ms(x.start), en = Date.now();
            var v = x.amount || 0;
            dd.feedings.push({ id: Util.uid(), type: x.src === 'fm' ? 'formula' : 'bottle', start: x.start, end: loc(en), amount: v || null,
              amountBm: x.src === 'fm' ? null : (v || null), amountFm: x.src === 'fm' ? (v || null) : null,
              durationMin: Math.max(1, Math.round((en - st) / 60000)), durationL: null, durationR: null, side: null,
              note: null, newFood: null, dish: null, ing: null, steps: null });
            dd.bottleTimer = null;
            if (Storage.save()) Util.toast('已记录瓶喂' + (v ? ' ' + v + ' mL' : '') + '，用时 ' + fmtMin((en - st) / 60000), 'ok');
            global.App.rerender();
          });
        });
      }
    },
    _bottleSVG: bottleSVG,
    _nhcRef: nhcRef,
    _quick: quickAmounts
  };
  /* 第 241 次：睡眠页复用同一套面板 / 时间磁贴 / 洞察小按钮 */
  global.FTUI = { SV: SV, openSheet: openSheet, whenTiles: whenTiles, readWhen: readWhen, setWhen: setWhen,
    dayLabel: dayLabel, hm: hm, loc: loc, isoDay: isoDay, ms: ms, fmtMin: fmtMin, insightChips: insightChips, bindChips: bindChips };
})(window);
