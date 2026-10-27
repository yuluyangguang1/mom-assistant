/**
 * fetal.js - 胎动计数（2026-09-27 起；第 287 次迁到新骨架）
 * 孕 28 周后的每日功课：一键「+1」即记当前时间，带撤销；计数方法因医嘱而异，页面只做记录不给「达标线」（U-25）。
 *
 * 第 287 次：新骨架——页头插画 → 摘要（今天几次、上次）→「今天」看板（时间条 + 近 7 天次数）
 *   → 最近记录时间轴（计数段与单次胎动一条线，点按修改、左滑删除）
 *   → 底部固定：「开始计数 | ＋1 动了一下」；计数中变成迷你计时条（用时 · 本次几次 · × 取消 · 结束）+「＋1 动了一下」。
 * 数据形状不变：d.fetal = [{ id, time }]、d.fetalSession = { start } | null、d.fetalSessions = [{ id, start, end, count }]。
 *   都是妈妈的记录（不在 BABY_KEYS），切换宝宝不影响。
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
  var addLock = 0;
  function add(d, trusted) {
    /* 一下胎动只记一次：手指 400ms 内的第二下当作连点（触感层回声在委托里已滤掉），脚本派发的不受影响 */
    if (trusted && Date.now() - addLock < 400) return;
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
  function endSess(d) {
    var s0 = d.fetalSession; if (!s0) return;
    var cnt = sessCount(d, s0), end = Util.nowLocal();
    sessions(d).push({ id: Util.uid(), start: s0.start, end: end, count: cnt });
    d.fetalSession = null;
    Storage.save();
    Util.toast('本次 ' + cnt + ' 次，用时 ' + Util.fmtDuration(tms(end) - tms(s0.start)), 'ok');
    global.App.rerender();
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
          + '<p>感到胎动就点按底部「＋1」</p>'
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

      /* 底部：计数中 → 迷你计时条 + ＋1；否则「开始计数 | ＋1 动了一下」 */
      var plus = '<button type="button" class="mc-main fe-add" id="ftAdd"><b class="fe-plus" aria-hidden="true">＋1</b><span>动了一下</span></button>';
      if (sess) {
        html += '<div class="mod-cta ft-cta cta-col fe-cta">'
          + '<div class="ft-mini" data-accent="fetal"><span class="ft-mini-open">' + (SV.clock || icon('fetal')) + '<b id="fsElapsed">' + Util.fmtClock(Date.now() - tms(sess.start)) + '</b></span>'
          + '<span class="ft-mini-side"><i class="fe-k">本次 </i><b class="fe-n">' + sessCount(d, sess) + '</b> 次</span>'
          + '<button type="button" class="ft-mini-b" id="fsCancel" aria-label="取消本次计数（胎动记录保留）">' + icon('close') + '</button>'
          + '<button type="button" class="ft-mini-end" id="fsEnd">结束</button></div>' + plus + '</div>';
      } else {
        html += '<div class="mod-cta ft-cta fe-cta fe-row"><button type="button" class="fe-start" id="fsStart">' + (SV.clock || '') + '<span>开始计数</span></button>' + plus + '</div>';
      }

      view.innerHTML = '<div class="ft-page skel-page fe-page" data-accent="fetal">' + html + '</div>';

      var page = view.firstChild, lock = 0;
      page.addEventListener('click', function (e) {
        if (Util.hapEcho && Util.hapEcho(e)) return;
        var b = e.target.closest ? e.target.closest('button') : null;
        if (!b || !page.contains(b)) return;
        var dd = Storage.get(), v;
        if (b.id === 'ftAdd') { add(dd, e.isTrusted); return; }
        if (b.id === 'fsStart') { startSess(dd); return; }
        if (b.id === 'fsEnd') { endSess(dd); return; }
        if (b.id === 'fsCancel') { cancelSess(dd); return; }
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
          fsEl.textContent = Util.fmtClock(Date.now() - tms(Storage.get().fetalSession.start));
        }, 1000);
      }
    },
    /* 日期页 / 其它入口：修改、删除走这里的面板与撤销 */
    _edit: function (rec) { openTap(Storage.get(), rec); },
    _remove: function (id) { removeTap(Storage.get(), id); },
    _editSession: function (rec) { openSess(Storage.get(), rec); },
    _add: function () { add(Storage.get(), false); }
  };
})(window);
