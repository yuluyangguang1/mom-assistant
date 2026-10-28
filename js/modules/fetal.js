/**
 * fetal.js - 胎动计数（2026-09-27 起；第 287 次迁到新骨架）
 * 孕 28 周后的每日功课：一键「+1」即记当前时间，带撤销；计数方法因医嘱而异，页面只做记录不给「达标线」（U-25）。
 *
 * 第 287 次：新骨架——页头插画 → 摘要（今天几次、上次）→「今天」看板（时间条 + 近 7 天次数）
 *   → 最近记录时间轴（计数段与单次胎动一条线，点按修改、左滑删除）
 *   → 底部固定：「开始计数 | ＋1 动了一下」；计数中变成迷你计时条（用时 · 本次几次 · × 取消 · 结束）+「＋1 动了一下」。
 * 数据形状不变：d.fetal = [{ id, time }]、d.fetalSession = { start } | null、d.fetalSessions = [{ id, start, end, count }]。
 *   都是妈妈的记录（不在 BABY_KEYS），切换宝宝不影响。
 * 第 296 次：数胎动搬进沉浸式全屏（扶手椅）：N / 10，5 分钟内连续的胎动算 1 次，撤销 / ■ 保存成一段计数（count = 有效次数、taps = 点了几下）。
 *   页面底部只剩「开始数胎动」或迷你条（点按回到全屏）。
 */
(function (global) {
  'use strict';
  var Storage = global.Storage, Util = global.Util;
  var Modules = global.Modules = global.Modules || {};

  function esc(s) { return Util.escapeHtml(s == null ? '' : String(s)); }
  function tms(s) { var t = new Date(s).getTime(); return isFinite(t) ? t : NaN; }
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  function hm(ms) { var d = new Date(ms); return p2(d.getHours()) + ':' + p2(d.getMinutes()); }
  function loc(ms) {
    var d = new Date(ms);
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + 'T' + p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds());
  }
  function taps(d) { if (!Array.isArray(d.fetal)) d.fetal = []; return d.fetal; }
  function sessions(d) { if (!Array.isArray(d.fetalSessions)) d.fetalSessions = []; return d.fetalSessions; }
  function sessCount(d, s) {
    var a = tms(s.start); /* 第 287 次：按时间比，不按字符串（导入的坏时间「zz」不再算进本次） */
    return (d.fetal || []).filter(function (r) { return r && tms(r.time) >= a; }).length;
  }

  /* ---------- 计数：+1 / 开始 / 结束 / 取消 ---------- */
  var addLock = 0, ADD_GAP = 200;
  function add(d, trusted) {
    /* 一下胎动只记一次：手指 ADD_GAP 内的第二下当作误触连击（触感层回声在委托里已滤掉），脚本派发的不受影响。
       第 288 次：400ms → 200ms。录屏里页面计数逐次 +1（约 0.5–1 秒一下），提示里「5→5、8→8」是同一条提示被连续看到两次，
       不是点按被吞；但两次真实胎动可以在 1 秒内接连出现，手快的人连点约 150–250ms 一下，400ms 会吞掉其中一部分。
       手指一下点出两下（抖动 / 触感层之外的重复派发）间隔在 100ms 以内，200ms 挡住它又不吞有意的点按。 */
    if (trusted && Date.now() - addLock < ADD_GAP) return;
    addLock = Date.now();
    var DS = Util.dayStartHour(d), dayNow = Util.dayKeyOf(new Date(), DS);
    var rec = { id: Util.uid(), time: Util.nowLocal() };
    taps(d).push(rec);
    if (Util.haptic) Util.haptic('light');
    if (Storage.save()) {
      var n = d.fetal.filter(function (r) { return Util.dayKeyOf(r.time, DS) === dayNow; }).length;
      Util.toast('已记录一次胎动（今天第 ' + n + ' 次）', 'ok', { label: '撤销', onClick: function () {
        for (var i = d.fetal.length - 1; i >= 0; i--) if (d.fetal[i].id === rec.id) { d.fetal.splice(i, 1); break; }
        Storage.save(); global.App.rerender(); Util.toast('已撤销', 'ok');
      } });
    }
    global.App.rerender();
  }
  function startSess(d) {
    if (d.fetalSession) return;
    d.fetalSession = { start: Util.nowLocal() };
    Storage.save(); global.App.rerender();
  }
  function endSess(d, quiet) {
    var s0 = d.fetalSession; if (!s0) return;
    var c = count(d), end = Util.nowLocal();
    if (c.raw) sessions(d).push({ id: Util.uid(), start: s0.start, end: end, count: c.n, taps: c.raw });
    d.fetalSession = null;
    Storage.save();
    if (!quiet) Util.toast('本次 ' + c.n + ' 次，用时 ' + Util.fmtDuration(tms(end) - tms(s0.start)), 'ok');
    rr();
  }
  function rr() { if (immEl) paintImm(); if (global.App && App.currentTab && App.currentTab() === 'fetal') global.App.rerender(); }

  /* ---------- 第 296 次：沉浸式数胎动（对标 Cali：扶手椅场景，N / 10） ----------
     一组从第一次点「记一次胎动」开始（d.fetalSession.start）；5 分钟内连续的胎动算 1 次（同一组内可继续补记，不加次数）。
     撤销上一次、■ → 取消 | 保存胎动记录；右上 放弃本次（连同这次点的胎动一起删，可撤销）。 */
  var GOAL = 10, MERGE = 5 * 60000;
  var immEl = null, immTick = null, immConfirm = false;
  function sessTaps(d) {
    var s0 = d.fetalSession; if (!s0) return [];
    var a = tms(s0.start);
    return (d.fetal || []).filter(function (r) { return r && tms(r.time) >= a; }).sort(function (x, y) { return tms(x.time) - tms(y.time); });
  }
  function count(d) {
    var t = sessTaps(d), n = 0, g0 = NaN, merged = false;
    t.forEach(function (r) { var x = tms(r.time); if (!(x - g0 < MERGE)) { n++; g0 = x; merged = false; } else merged = true; });
    return { n: n, raw: t.length, g0: g0, merged: merged, last: t[t.length - 1] || null };
  }
  function clk(ms) {
    var t = Math.floor(Math.max(0, ms || 0) / 1000), h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), x = t % 60;
    return (h ? h + ':' + p2(m) : String(m)) + ':' + p2(x);
  }
  function openImm() {
    if (!immEl) {
      immEl = document.createElement('div');
      immEl.className = 'ftf ftf-fe';
      immEl.setAttribute('data-accent', 'fetal');
      immEl.setAttribute('role', 'dialog');
      immEl.setAttribute('aria-label', '数胎动');
      document.body.appendChild(immEl);
      document.body.classList.add('ftf-open');
      immEl.addEventListener('click', onImmClick);
    }
    immConfirm = false; paintImm();
    if (!immTick) immTick = setInterval(tickImm, 500);
  }
  function closeImm() {
    if (immTick) { clearInterval(immTick); immTick = null; }
    if (immEl && immEl.parentNode) immEl.parentNode.removeChild(immEl);
    immEl = null; immConfirm = false;
    if (!document.querySelector('body > .ftf')) document.body.classList.remove('ftf-open');
  }
  var UNDO = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14L4.5 9.5 9 5M5 9.5h9.5a5 5 0 0 1 0 10H11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var FOOT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 3.5c2.2 0 3.3 2.2 3.3 5.2 0 2.6-.8 4.6-.8 6.8 0 2.6-1.3 5-3.6 5S5 18.6 5 16.3c0-2.4 1-3.9 1.2-6.6C6.5 6.3 7.4 3.5 9.5 3.5z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="16" cy="5.5" r="1.4" fill="currentColor"/><circle cx="18.6" cy="8.6" r="1.2" fill="currentColor"/><circle cx="19.4" cy="12.2" r="1" fill="currentColor"/></svg>';
  function chipOf(d, c) {
    if (!c.raw) return '还差 ' + GOAL + ' 次';
    if (Date.now() - c.g0 < MERGE) return '同一组内，可继续补记';
    return c.n >= GOAL ? '已数满 ' + GOAL + ' 次' : '还差 ' + (GOAL - c.n) + ' 次';
  }
  function paintImm() {
    var d = Storage.get(); if (!immEl) return;
    var SV = (global.FTUI && FTUI.SV) || {}, s0 = d.fetalSession, c = count(d), now = Date.now();
    var ctl;
    if (immConfirm) {
      ctl = '<div class="ftf-ctl ftf-ctl2"><button type="button" class="ftf-sec" data-f="back">取消</button>'
        + '<button type="button" class="ftf-main-btn" data-f="save">' + (SV.stop || '') + '<span>保存胎动记录</span></button></div>';
    } else {
      ctl = '<div class="ftf-ctl">' + (c.raw ? '<button type="button" class="ftf-rb" data-f="undo" aria-label="撤销上一次">' + UNDO + '</button>' : '<span></span>')
        + '<button type="button" class="ftf-main-btn" id="ftAdd" data-f="tap">记一次胎动</button>'
        + '<button type="button" class="ftf-rb" data-f="stop" aria-label="结束这次计数">' + (SV.stop || '') + '</button></div>';
    }
    var note = c.raw ? (c.merged ? '同一组胎动，已补记一次' : '已计入第 ' + c.n + ' 次胎动') : '5 分钟内连续的胎动算 1 次';
    immEl.innerHTML = '<div class="ftf-bg" aria-hidden="true"></div>'
      + '<div class="ftf-top"><button type="button" class="ftf-ib" data-f="down" aria-label="收起">' + (SV.down || '') + '</button>'
      + '<span class="ftf-tr">' + (c.raw ? '<button type="button" class="ftf-ib ftf-del" data-f="drop" aria-label="放弃这次计数">' + icon('trash') + '</button>' : '') + '</span></div>'
      + '<div class="ftf-main">'
      + '<p class="ftf-chip">' + FOOT + '<span data-fv="chip">' + chipOf(d, c) + '</span><i></i></p>'
      + '<p class="ftf-big fe-big"><b data-fv="n">' + c.n + '</b><small>/ ' + GOAL + '</small></p>'
      + '<div class="ftf-stats">'
      + '<div class="ftf-st"><i>' + (SV.clock || '') + '</i><b>' + (s0 && c.raw ? hm(tms(s0.start)) : '--') + '</b><span>开始</span></div>'
      + '<div class="ftf-st"><i>' + (SV.clock || '') + '</i><b data-fv="el">' + (s0 && c.raw ? clk(now - tms(s0.start)) : '--') + '</b><span>已用时</span></div>'
      + '<div class="ftf-st"><i>' + FOOT + '</i><b>' + (c.last ? hm(tms(c.last.time)) : '--') + '</b><span>最近</span></div>'
      + '</div><p class="ftf-note">' + note + '</p>' + ctl + '</div>';
  }
  function tickImm() {
    var d = Storage.get(); if (!immEl || !d.fetalSession) return;
    var c = count(d), el = immEl.querySelector('[data-fv="el"]'), ch = immEl.querySelector('[data-fv="chip"]');
    if (el && c.raw) el.textContent = clk(Date.now() - tms(d.fetalSession.start));
    if (ch) ch.textContent = chipOf(d, c);
  }
  var tapLock = 0;
  function tapImm(d, trusted) {
    if (trusted && Date.now() - tapLock < ADD_GAP) return;
    tapLock = Date.now();
    var now = Util.nowLocal();
    if (!d.fetalSession || !sessTaps(d).length) d.fetalSession = { start: now };
    taps(d).push({ id: Util.uid(), time: now });
    var c = count(d);
    if (Util.haptic) Util.haptic(c.merged ? 'light' : 'ok');
    Storage.save(); immConfirm = false; rr();
    if (!c.merged && c.n === GOAL) Util.toast('已数满 ' + GOAL + ' 次', 'ok');
  }
  function undoLast(d) {
    var c = count(d), last = c.last; if (!last) return;
    var list = taps(d), i = list.indexOf(last); if (i >= 0) list.splice(i, 1);
    Storage.save(); rr();
  }
  function dropSess(d) {
    Util.confirm({ title: '放弃这次计数？', message: '这次记下的胎动都会删除，可以撤销。', okText: '放弃', danger: true, onConfirm: function () {
      var dd = Storage.get(), s0 = dd.fetalSession; if (!s0) return;
      var gone = sessTaps(dd), ids = gone.map(function (r) { return r.id; });
      dd.fetal = taps(dd).filter(function (r) { return ids.indexOf(r.id) < 0; });
      dd.fetalSession = null; Storage.save(); closeImm(); if (global.App) global.App.rerender();
      Util.toast('已放弃这次计数', 'ok', { label: '撤销', onClick: function () {
        var d3 = Storage.get(); if (d3.fetalSession) return;
        d3.fetalSession = s0; d3.fetal = taps(d3).concat(gone); Storage.save(); if (global.App) global.App.rerender();
      } });
    } });
  }
  var immLock = 0;
  function onImmClick(e) {
    if (Util.hapEcho && Util.hapEcho(e)) return;
    var b = e.target.closest ? e.target.closest('[data-f]') : null; if (!b) return;
    var k = b.getAttribute('data-f'), d = Storage.get();
    if (k === 'tap') { tapImm(d, e.isTrusted); return; }
    if (k === 'down') { closeImm(); if (global.App) App.rerender(); return; }
    if (e.isTrusted && Date.now() - immLock < 300) return;
    immLock = Date.now();
    if (k === 'undo') { undoLast(d); return; }
    if (k === 'stop') {
      if (!d.fetalSession || !sessTaps(d).length) { d.fetalSession = null; Storage.save(); closeImm(); if (global.App) App.rerender(); return; }
      immConfirm = true; paintImm(); return;
    }
    if (k === 'back') { immConfirm = false; paintImm(); return; }
    if (k === 'save') { var n = count(d).n; endSess(d, true); closeImm(); Util.toast('已保存：' + n + ' 次胎动', 'ok'); if (global.App) App.rerender(); return; }
    if (k === 'drop') dropSess(d);
  }
  function cancelSess(d) {
    if (!d.fetalSession) return;
    d.fetalSession = null; Storage.save(); Util.toast('已取消本次计数（胎动记录保留）', 'ok'); global.App.rerender();
  }

  /* ---------- 半屏面板：修改一次胎动 / 一段计数 ---------- */
  var openAt = 0;
  function openTap(d, rec) {
    var FT = global.FTUI;
    if (!FT || !rec || Date.now() - openAt < 450) return;
    openAt = Date.now();
    var t0 = isFinite(tms(rec.time)) ? loc(tms(rec.time)) : Util.nowLocal(), now = Util.nowLocal();
    var body = FT.whenTiles('fe', '时间', t0.slice(0, 10), t0.slice(11, 16), now.slice(0, 10))
      + '<button type="button" class="btn rs-del" data-fedel>删除这条记录</button>'
      + '<div class="rs-savebar"><button type="button" class="btn btn-primary rs-save" id="feSave">保存修改</button></div>';
    FT.openSheet('fetal', '修改胎动', body, function (api) {
      var box = api.box, closed = false;
      api.onClose = (function (prev) { return function () { closed = true; if (prev) prev.apply(this, arguments); }; })(api.onClose);
      box.addEventListener('click', function (e) {
        if (closed || (Util.hapEcho && Util.hapEcho(e))) return;
        var b = e.target.closest ? e.target.closest('button') : null;
        if (!b || !box.contains(b)) return;
        if (b.hasAttribute('data-fedel')) { closed = true; api.close(); removeTap(d, rec.id); return; }
        if (b.id !== 'feSave' && !b.hasAttribute('data-ok')) return;
        var when = FT.readWhen(box, 'fe');
        if (!isFinite(when)) { Util.toast('日期或时间不完整', 'warn'); return; }
        if (when > Date.now() + 60000) { Util.toast('这个时间还没到，请检查一下', 'warn'); return; }
        var stamp = loc(when);
        if (String(rec.time).slice(0, 16) !== stamp.slice(0, 16)) rec.time = stamp; /* 分钟没变保留原来的秒 */
        closed = true;
        if (!Storage.save()) return;
        api.close(); global.App.rerender(); Util.toast('已保存', 'ok');
      });
    });
  }
  function openSess(d, rec) {
    var FT = global.FTUI;
    if (!FT || !rec || Date.now() - openAt < 450) return;
    openAt = Date.now();
    var now = Util.nowLocal();
    var s0 = isFinite(tms(rec.start)) ? loc(tms(rec.start)) : now, e0 = isFinite(tms(rec.end)) ? loc(tms(rec.end)) : now;
    var body = FT.whenTiles('fs', '开始', s0.slice(0, 10), s0.slice(11, 16), now.slice(0, 10))
      + FT.whenTiles('e', '结束', e0.slice(0, 10), e0.slice(11, 16), now.slice(0, 10))
      + '<p class="rs-lbl">次数</p><label class="rs-tile sk-num"><input type="number" id="fsCnt" inputmode="numeric" min="0" max="999" value="' + ((rec.count | 0) || 0) + '" aria-label="次数"><span>次</span></label>'
      + '<button type="button" class="btn rs-del" data-fsdel>删除这次计数</button>'
      + '<div class="rs-savebar"><button type="button" class="btn btn-primary rs-save" id="fsSave">保存修改</button></div>';
    FT.openSheet('fetal', '修改计数', body, function (api) {
      var box = api.box, closed = false;
      api.onClose = (function (prev) { return function () { closed = true; if (prev) prev.apply(this, arguments); }; })(api.onClose);
      box.addEventListener('click', function (e) {
        if (closed || (Util.hapEcho && Util.hapEcho(e))) return;
        var b = e.target.closest ? e.target.closest('button') : null;
        if (!b || !box.contains(b)) return;
        if (b.hasAttribute('data-fsdel')) { closed = true; api.close(); removeSess(d, rec.id); return; }
        if (b.id !== 'fsSave' && !b.hasAttribute('data-ok')) return;
        var a = FT.readWhen(box, 'fs'), z = FT.readWhen(box, 'e');
        if (!isFinite(a) || !isFinite(z)) { Util.toast('日期或时间不完整', 'warn'); return; }
        if (z > Date.now() + 60000) { Util.toast('这个时间还没到，请检查一下', 'warn'); return; }
        if (!(z > a)) { Util.toast('结束要晚于开始', 'warn'); return; }
        var ci = box.querySelector('#fsCnt'), n = parseInt(ci.value, 10);
        if (!isFinite(n) || n < 0 || n > 999) { Util.markInvalid(ci, '次数填 0–999'); return; }
        var sa = loc(a), sz = loc(z);
        if (String(rec.start).slice(0, 16) !== sa.slice(0, 16)) rec.start = sa;
        if (String(rec.end).slice(0, 16) !== sz.slice(0, 16)) rec.end = sz;
        rec.count = n;
        closed = true;
        if (!Storage.save()) return;
        api.close(); global.App.rerender(); Util.toast('已保存', 'ok');
      });
    });
  }
  function removeTap(d, id) {
    Util.removeWithUndo(taps(d), id, { onSave: function () { Storage.save(); }, onAfter: function () { global.App.rerender(); }, deletedText: '已删除胎动记录' });
  }
  function removeSess(d, id) {
    Util.removeWithUndo(sessions(d), id, { onSave: function () { Storage.save(); }, onAfter: function () { global.App.rerender(); }, deletedText: '已删除这次计数' });
  }

  Modules.fetal = {
    id: 'fetal',
    title: '胎动',
    render: function (view) {
      var d = Storage.get();
      var FT = global.FTUI, DC = global.DayChart, SV = (FT && FT.SV) || {};
      /* 第 131 次（P1-a）：「今天数胎动」走照护日口径（dayStart 可配，默认 0 = 公历日）。 */
      var DS = Util.dayStartHour(d);
      var dayNow = Util.dayKeyOf(new Date(), DS);
      var all = (d.fetal || []).filter(function (r) { return r && isFinite(tms(r.time)); })
        .slice().sort(function (a, b) { return tms(b.time) - tms(a.time); });
      var ss = (d.fetalSessions || []).filter(function (r) { return r && isFinite(tms(r.start)); });
      var today = all.filter(function (r) { return Util.dayKeyOf(r.time, DS) === dayNow; });
      var sess = d.fetalSession && isFinite(tms(d.fetalSession.start)) ? d.fetalSession : null;
      var last = all[0];
      var html = '';
      var isEmpty = !all.length && !ss.length && !sess;

      if (isEmpty) {
        html += '<div class="sk-empty"><img src="assets/hero/fetal.webp" alt="" width="220" height="220" decoding="sync">'
          + '<p>点按底部「开始数胎动」开始记录</p>'
          + '<p class="sk-empty-ref">怎么数、数多久，以产检医生教你的方法为准；胎动明显减少请立即就医。</p></div>';
      } else {
        var s = today.length
          ? '今天 <b>' + today.length + ' 次</b>，上次 <b>' + esc(hm(tms(last.time))) + '</b>（' + esc(Util.fmtAgo(last.time)) + '）。'
          : '今天还没有记录。' + (last ? '上次是 <b>' + esc(Util.fmtAgo(last.time)) + '</b>。' : '');
        html += '<div class="mod-sum"><span class="ms-k">摘要</span><p>' + s + '</p>'
          + '<p class="ms-ref">怎么数、数多久，以产检医生教你的方法为准；胎动明显减少请立即就医。</p></div>';

        /* 今天：时间条 + 近 7 天次数（与新骨架各页同一套 DayChart） */
        if (all.length && DC) {
          html += '<div class="card dash-card fe-dash"><h2>今天</h2>'
            + DC.strip({ win: DC.windowOf(dayNow, DS), ds: DS, now: Date.now(), label: '今天胎动的时间',
              marks: today.map(function (r) { return { t: tms(r.time), cls: '', title: hm(tms(r.time)) + ' 胎动' }; }) });
          var d7 = DC.lastDays(dayNow, 7).map(function (k) {
            var v = all.filter(function (r) { return Util.dayKeyOf(r.time, DS) === k; }).length;
            return { key: k, v: v, txt: String(v) };
          });
          if (d7.filter(function (x) { return x.v; }).length >= 2) html += '<p class="dash-sub">近 7 天胎动次数</p>' + DC.bars(d7, dayNow, '近 7 天胎动次数');
          html += '</div>';
        }

        /* 时间轴：计数段 + 单次胎动 */
        var rows = [];
        ss.forEach(function (r) { rows.push({ t: tms(r.start), s: r }); });
        /* 计数段里的那几下已经合在计数那一行（修改 / 删除计数在它的面板里；单次仍可在日期页修改） */
        var inSess = function (t) { return ss.some(function (x) { var a = tms(x.start), z = tms(x.end); return isFinite(a) && isFinite(z) && t >= a && t <= z; }); };
        all.forEach(function (r) { var t = tms(r.time); if (!inSess(t)) rows.push({ t: t, f: r }); });
        rows.sort(function (a, b) { return b.t - a.t; });
        if (rows.length) {
          var todayIso = Util.todayISO();
          html += '<section class="mod-tl ft-tl"><p class="ms-k">最近记录</p><ul class="tl">';
          rows.slice(0, 40).forEach(function (x) {
            var lab = FT ? FT.dayLabel(x.t, todayIso) : '', title, sub = '', id, k;
            if (x.s) {
              id = x.s.id; k = 's';
              title = '计数 · ' + ((x.s.count | 0) || 0) + ' 次';
              var ms = tms(x.s.end) - tms(x.s.start);
              sub = isFinite(ms) ? '用时 ' + Util.fmtDuration(ms) : '';
            } else { id = x.f.id; k = 'f'; title = '胎动'; }
            html += '<li class="tl-row' + (x.s ? ' fe-sess' : '') + '"><span class="tl-time ft-tlt"><small>' + esc(lab) + '</small>' + hm(x.t) + '</span><span class="tl-dot" aria-hidden="true"></span>'
              + '<button type="button" class="tl-card" data-feopen="' + esc(id) + '" data-k="' + k + '" aria-label="' + esc(hm(x.t) + ' ' + title + '，点按修改') + '">'
              + '<span class="tl-ico">' + icon('fetal') + '</span><span class="tl-txt"><b>' + esc(title) + '</b>'
              + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span>'
              + '<span class="tl-more" aria-hidden="true">' + (SV.more || '') + '</span></button>'
              + '<button type="button" class="tl-del" data-del="' + esc(id) + '" data-k="' + k + '" aria-label="删除" title="删除">' + icon('trash') + '</button></li>';
          });
          html += '</ul></section>';
        }
      }

      /* 底部（第 296 次）：没在数 →「▷ 开始数胎动」打开全屏；在数 → 迷你条（点按回到全屏） */
      if (sess) {
        var cM = count(d);
        html += '<div class="mod-cta ft-cta"><div class="ft-mini" data-accent="fetal"><button type="button" class="ft-mini-open" data-fe="imm" aria-label="回到数胎动">' + (SV.clock || icon('fetal')) + '<b id="fsElapsed">' + clk(Date.now() - tms(sess.start)) + '</b></button>'
          + '<span class="ft-mini-side">数胎动 · <b class="fe-n">' + cM.n + '</b> / ' + GOAL + '</span>'
          + '<button type="button" class="ft-mini-end" data-fe="imm">继续</button></div></div>';
      } else {
        html += '<div class="mod-cta ft-cta"><button type="button" class="mc-main fe-open" id="fsOpen" data-fe="imm">' + (SV.play || '') + '<span>开始数胎动</span></button></div>';
      }

      view.innerHTML = '<div class="ft-page skel-page fe-page" data-accent="fetal">' + html + '</div>';

      var page = view.firstChild, lock = 0;
      page.addEventListener('click', function (e) {
        if (Util.hapEcho && Util.hapEcho(e)) return;
        var b = e.target.closest ? e.target.closest('button') : null;
        if (!b || !page.contains(b)) return;
        var dd = Storage.get(), v;
        if (b.getAttribute('data-fe') === 'imm') { openImm(); return; }
        if ((v = b.getAttribute('data-feopen'))) {
          var k = b.getAttribute('data-k');
          var rec = (k === 's' ? sessions(dd) : taps(dd)).filter(function (x) { return x && String(x.id) === v; })[0];
          if (rec) { if (k === 's') openSess(dd, rec); else openTap(dd, rec); }
          return;
        }
        if ((v = b.getAttribute('data-del'))) {
          if (e.isTrusted && Date.now() - lock < 500) return;
          lock = Date.now();
          if (b.getAttribute('data-k') === 's') removeSess(dd, v); else removeTap(dd, v);
        }
      });
      var fsEl = view.querySelector('#fsElapsed');
      if (fsEl && d.fetalSession) {
        var fsTick = setInterval(function () {
          if (!view.contains(fsEl) || !Storage.get().fetalSession) { clearInterval(fsTick); return; }
          fsEl.textContent = clk(Date.now() - tms(Storage.get().fetalSession.start));
        }, 1000);
      }
    },
    /* 日期页 / 其它入口：修改、删除走这里的面板与撤销 */
    _edit: function (rec) { openTap(Storage.get(), rec); },
    _remove: function (id) { removeTap(Storage.get(), id); },
    _editSession: function (rec) { openSess(Storage.get(), rec); },
    _add: function () { add(Storage.get(), false); },
    _addGap: function () { return ADD_GAP; },
    _openFull: openImm,
    _closeFull: closeImm,
    _count: count,
    _startSess: function () { startSess(Storage.get()); },
    _endSess: function () { endSess(Storage.get()); },
    _cancelSess: function () { cancelSess(Storage.get()); }
  };
})(window);
