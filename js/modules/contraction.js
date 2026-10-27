/**
 * contraction.js - 宫缩计时（第 287 次迁到新骨架）
 * 记录每次宫缩开始 / 结束；间隔按 START-to-START 计算，时长 = 结束 − 开始，都精确到秒（第 273 次）。
 *
 * 第 287 次：新骨架——页头插画 → 摘要（距上次开始实时走秒 + 规则提示 + 一行免责）→ 破水 / 见红 48 小时横幅
 *   →「近一小时」看板（次数 · 平均持续 · 平均间隔；提示规则 / 导出）→ 最近记录时间轴（宫缩与破水 / 见红一条线，
 *   点按修改、左滑删除）→ 底部固定：「▷ 开始宫缩 | ⊕ 补记」；计时中变成「轻 / 中 / 强」+ 迷你计时条（× 取消 · 结束）。
 *   补记 / 修改 / 提示规则都在半屏面板里。
 * 数据形状不变：d.contractions = [{ id, start, end, intensity? }]、d.openContraction、d.laborEvents = [{ id, time, type, note }]、
 *   d.pregnancy.contractionRule = { iv, dur, span }。都是妈妈的记录（不在 BABY_KEYS），切换宝宝不影响。
 */
(function (global) {
  'use strict';
  var Storage = global.Storage, Util = global.Util;
  var Modules = global.Modules = global.Modules || {};

  var INT = { 1: '轻', 2: '中', 3: '强' };
  function esc(s) { return Util.escapeHtml(s == null ? '' : String(s)); }
  function tms(s) { var t = new Date(s).getTime(); return isFinite(t) ? t : NaN; }
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  function loc(ms) {
    var d = new Date(ms);
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + 'T' + p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds());
  }
  function hm(ms) { var d = new Date(ms); return p2(d.getHours()) + ':' + p2(d.getMinutes()); }
  function openC() { return (Storage.get() || {}).openContraction || null; } /* 第 146 次：早于 load 的定时器调用时判空 */
  function arr(d) { if (!Array.isArray(d.contractions)) d.contractions = []; return d.contractions; }
  function labArr(d) { if (!Array.isArray(d.laborEvents)) d.laborEvents = []; return d.laborEvents; }

  /* 第 273 次（审计 #13）：时长、间隔都精确到秒 */
  function secTxt(ms) { return Util.fmtSecDur(Math.max(0, ms)); }
  /* 大数字：「4分55秒」拆成数字 + 小号单位 */
  function secStat(ms) { return esc(secTxt(ms)).replace(/(\d+)(小时|分|秒|天)/g, '$1<i>$2</i>'); }
  function agoText(ms) {
    var m = Math.max(0, Math.round(ms / 60000));
    return m < 1 ? '不到 1 分钟' : m < 60 ? m + ' 分钟' : (Math.floor(m / 60) + ' 小时' + (m % 60 ? ' ' + (m % 60) + ' 分' : ''));
  }

  function cTick() {
    var oc = openC();
    var el = document.getElementById('cTimer');
    if (oc && el) el.textContent = Util.fmtSecDur(Date.now() - tms(oc.start)); /* 第 273 次：计时中也按秒走 */
    var sn = document.querySelector('[data-ct-since]');
    if (sn) { var t0 = Number(sn.getAttribute('data-ct-since')); if (isFinite(t0)) sn.textContent = secTxt(Date.now() - t0); }
  }

  /* 第 186 次：规则只收整数，导入脏值一律当未设置 */
  function normRule(r) {
    if (!r || typeof r !== 'object') return null;
    var iv = parseInt(r.iv, 10), du = parseInt(r.dur, 10), sp = parseInt(r.span, 10);
    if (!(iv >= 1 && iv <= 30 && du >= 10 && du <= 180 && sp >= 10 && sp <= 240)) return null;
    return { iv: iv, dur: du, span: sp };
  }
  /* 第 197 次：破水 / 见红。只记时刻与事实，提示语是通用就医信号，不判断是否临产。显示只走这张表，导入的坏 type 不显示。 */
  var LABOR = {
    water: { label: '破水', tip: '破水后请尽快联系医院或前往就医，路上怎么做按医生交代。记下时间和羊水颜色，到医院告诉医生。' },
    show:  { label: '见红', tip: '少量见红常见于临产前几天。若出血像月经量或更多、颜色鲜红，或伴持续腹痛、胎动明显减少，请立即就医。' }
  };
  function laborList(d) {
    return (d.laborEvents || []).filter(function (e) { return e && LABOR[e.type] && e.time && isFinite(tms(e.time)); })
      .sort(function (a, b) { return tms(b.time) - tms(a.time); });
  }
  function doneAsc(d) {
    return (d.contractions || []).filter(function (c) { return c && isFinite(tms(c.start)); })
      .slice().sort(function (a, b) { return tms(a.start) - tms(b.start); });
  }
  /* 规则窗口内：每次间隔 ≤ iv 分、每次时长 ≥ dur 秒、且覆盖 ≥ span 分钟（窗口放宽一个间隔；最近一次结束距现在不超过一个间隔） */
  function ruleMet(done, rule, nowMs) {
    var winStart = nowMs - (rule.span + rule.iv) * 60000;
    var inWin = done.filter(function (c) { return c.end && tms(c.start) >= winStart; });
    var ok = inWin.length >= 2
      && (tms(inWin[inWin.length - 1].start) - tms(inWin[0].start)) >= (rule.span - rule.iv) * 60000
      && (nowMs - tms(inWin[inWin.length - 1].end)) <= rule.iv * 60000;
    for (var wi = 0; ok && wi < inWin.length; wi++) {
      if ((tms(inWin[wi].end) - tms(inWin[wi].start)) < rule.dur * 1000) ok = false;
      if (wi > 0 && (tms(inWin[wi].start) - tms(inWin[wi - 1].start)) > rule.iv * 60000) ok = false;
    }
    return ok;
  }
  function ruleTxt(r) { return '间隔 ≤' + r.iv + ' 分、每次 ≥' + r.dur + ' 秒'; }

  /* ---------- 计时：开始 / 强度 / 结束 / 取消（都按当前状态幂等，连点 / 回声不会多记） ---------- */
  function start(d) {
    if (d.openContraction) return;
    d.openContraction = { id: Util.uid(), start: Util.nowLocal() };
    Storage.save(); if (Util.haptic) Util.haptic('light'); global.App.rerender();
  }
  function setInt(d, v) {
    if (!d.openContraction) return;
    var n = parseInt(v, 10);
    d.openContraction.intensity = d.openContraction.intensity === n ? null : n; /* 再点一次取消 */
    if (!d.openContraction.intensity) delete d.openContraction.intensity;
    Storage.save(); global.App.rerender();
  }
  function finish(d) {
    var oc = d.openContraction;
    if (!oc) return;
    oc.end = Util.nowLocal();
    arr(d).push(oc);
    var durMs = tms(oc.end) - tms(oc.start);
    d.openContraction = null;
    if (Storage.save()) Util.toast('已记录：本次宫缩 ' + secTxt(durMs), 'ok'); /* C1 */
    global.App.rerender();
  }
  function cancel(d) {
    if (!d.openContraction) return;
    d.openContraction = null; Storage.save(); Util.toast('已取消本次计时', 'ok'); global.App.rerender();
  }

  /* ---------- 半屏面板：补记 / 修改宫缩、破水、见红 ---------- */
  var openAt = 0;
  function guardOpen() { if (Date.now() - openAt < 450) return false; openAt = Date.now(); return true; }
  /* kind: 'c' 宫缩 | 'water' | 'show'；rec 有值 = 修改 */
  function openSheet(d, kind, rec) {
    var FT = global.FTUI;
    if (!FT || !guardOpen()) return;
    var editing = !!rec, now = Util.nowLocal();
    var newId = editing ? rec.id : Util.uid();
    var st = { kind: kind || 'c', intensity: editing && kind === 'c' && INT[rec.intensity] ? String(rec.intensity) : null };
    var t0 = editing ? String(kind === 'c' ? rec.start : rec.time) : now;
    if (!isFinite(tms(t0))) t0 = now;
    var t0s = loc(tms(t0));
    var dur0 = editing && kind === 'c' && rec.end && isFinite(tms(rec.end)) ? Math.max(0, Math.round((tms(rec.end) - tms(rec.start)) / 1000)) : null;
    var body = '';
    if (!editing) {
      body += '<div class="rs-seg sk-seg ct-kind" role="radiogroup" aria-label="记录什么">';
      [['c', '宫缩'], ['water', '破水'], ['show', '见红']].forEach(function (o) {
        var on = st.kind === o[0];
        body += '<button type="button" class="' + (on ? 'on' : '') + '" data-ctk="' + o[0] + '" role="radio" aria-checked="' + on + '">' + o[1] + '</button>';
      });
      body += '</div>';
    }
    body += FT.whenTiles('ct', '开始', t0s.slice(0, 10), t0s.slice(11, 16), now.slice(0, 10))
      + '<div class="ct-cf"' + (st.kind === 'c' ? '' : ' hidden') + '>'
      + '<p class="rs-lbl">持续 <span class="rs-lbl-n">可选</span></p>'
      + '<label class="rs-tile sk-num"><input type="number" id="ctDur" inputmode="numeric" min="1" max="600" placeholder="如 50" value="' + (dur0 != null ? dur0 : '') + '" aria-label="持续（秒）"><span>秒</span></label>'
      + '<div class="rs-pills sk-quick">' + [30, 45, 60, 90].map(function (q) {
        return '<button type="button" class="dp-pill' + (dur0 === q ? ' active' : '') + '" data-ctq="' + q + '">' + q + ' 秒</button>';
      }).join('') + '</div>'
      + '<p class="rs-lbl">强度 <span class="rs-lbl-n">可选</span></p><div class="rs-seg sk-seg" role="radiogroup" aria-label="强度">'
      + ['1', '2', '3'].map(function (v) {
        var on = st.intensity === v;
        return '<button type="button" class="' + (on ? 'on' : '') + '" data-cti="' + v + '" role="radio" aria-checked="' + on + '">' + INT[v] + '</button>';
      }).join('') + '</div></div>'
      + '<label class="rs-note ct-lf"' + (st.kind === 'c' ? ' hidden' : '') + '><span class="rs-lbl">备注</span><input type="text" id="ctNote" maxlength="40" placeholder="可选，如 羊水颜色" value="' + esc((editing && kind !== 'c' && rec.note) || '') + '"></label>'
      + (editing ? '<button type="button" class="btn rs-del" data-ctdel>删除这条记录</button>' : '')
      + '<div class="rs-savebar"><button type="button" class="btn btn-primary rs-save" id="ctSave">' + (editing ? '保存修改' : '保存') + '</button></div>';
    var title = function (k) { return (editing ? '修改' : '记录') + (k === 'c' ? '宫缩' : LABOR[k].label); };

    FT.openSheet('contraction', title(st.kind), body, function (api) {
      var box = api.box, closed = false, saving = false;
      api.onClose = (function (prev) { return function () { closed = true; if (prev) prev.apply(this, arguments); }; })(api.onClose);
      var lblStart = box.querySelector('.rs-lbl');
      function syncKind() {
        var c = st.kind === 'c';
        box.querySelector('.ct-cf').hidden = !c;
        box.querySelector('.ct-lf').hidden = c;
        if (lblStart) lblStart.textContent = c ? '开始' : '时间';
        var h = document.getElementById('ftsTitle'); if (h) h.textContent = title(st.kind);
      }
      syncKind();
      var di = box.querySelector('#ctDur');
      di.addEventListener('input', function () {
        Array.prototype.forEach.call(box.querySelectorAll('[data-ctq]'), function (x) { x.classList.toggle('active', di.value !== '' && Number(x.getAttribute('data-ctq')) === Number(di.value)); });
      });
      box.addEventListener('click', function (e) {
        if (closed || (Util.hapEcho && Util.hapEcho(e))) return;
        var b = e.target.closest ? e.target.closest('button') : null;
        if (!b || !box.contains(b)) return;
        if (b.id === 'ctSave' || b.hasAttribute('data-ok')) { save(); return; }
        if (b.hasAttribute('data-ctdel')) { closed = true; api.close(); remove(d, kind === 'c' ? 'c' : 'l', rec.id); return; }
        var v;
        if ((v = b.getAttribute('data-ctk'))) {
          st.kind = v;
          Array.prototype.forEach.call(box.querySelectorAll('[data-ctk]'), function (x) { var on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', String(on)); });
          syncKind(); return;
        }
        if ((v = b.getAttribute('data-ctq'))) {
          di.value = v;
          try { di.dispatchEvent(new Event('input', { bubbles: true })); } catch (eI) {}
          return;
        }
        if ((v = b.getAttribute('data-cti'))) {
          st.intensity = st.intensity === v ? null : v;
          Array.prototype.forEach.call(box.querySelectorAll('[data-cti]'), function (x) { var on = x.getAttribute('data-cti') === st.intensity; x.classList.toggle('on', on); x.setAttribute('aria-checked', String(on)); });
        }
      });
      function save() {
        if (saving || closed) return;
        var when = FT.readWhen(box, 'ct');
        if (!isFinite(when)) { Util.toast('日期或时间不完整', 'warn'); return; }
        if (when > Date.now() + 60000) { Util.toast('这个时间还没到，请检查一下', 'warn'); return; }
        /* 分钟没变就保留原来的秒（第 273 次 #14：只改强度时起止秒数原样） */
        var stamp = loc(when);
        var keepStart = editing && String(t0).slice(0, 16) === stamp.slice(0, 16);
        var sStr = keepStart ? String(t0) : (!editing && stamp.slice(0, 16) === now.slice(0, 16) ? now : stamp);
        if (st.kind === 'c') {
          var raw = String(di.value).trim(), sec = null;
          if (raw !== '') {
            sec = parseInt(raw, 10);
            /* 老记录的原值（可能超出范围）没改就照存 */
            if (!isFinite(sec) || (sec !== dur0 && (sec < 1 || sec > 600))) { Util.markInvalid(di, '持续填 1–600 秒'); return; }
          }
          saving = true;
          var list = arr(d), r = null;
          for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === newId) { r = list[i]; break; }
          var isNew = !r;
          if (isNew) { r = { id: newId }; list.push(r); }
          var endStr = null;
          if (sec != null) endStr = (keepStart && dur0 === sec && rec.end) ? rec.end : loc(tms(sStr) + sec * 1000);
          r.start = sStr; r.end = endStr;
          if (!endStr) delete r.end;
          if (st.intensity) r.intensity = parseInt(st.intensity, 10); else delete r.intensity;
          if (!Storage.save()) { saving = false; return; }
          closed = true; api.close(); global.App.rerender();
          if (isNew) Util.toast('已记录宫缩 ' + sStr.slice(11, 16), 'ok', { label: '撤销', onClick: function () { undoAdd(d.contractions, newId); } });
          else Util.toast('已保存', 'ok');
        } else {
          saving = true;
          var la = labArr(d), q = null;
          for (var j = 0; j < la.length; j++) if (la[j] && la[j].id === newId) { q = la[j]; break; }
          var isN = !q;
          if (isN) { q = { id: newId }; la.push(q); }
          q.time = sStr; q.type = st.kind;
          q.note = (((box.querySelector('#ctNote') || {}).value) || '').trim().slice(0, 40) || null;
          if (!Storage.save()) { saving = false; return; }
          closed = true; api.close(); global.App.rerender();
          if (isN) Util.toast('已记录' + LABOR[st.kind].label + ' ' + sStr.slice(11, 16), 'ok', { label: '撤销', onClick: function () { undoAdd(d.laborEvents, newId); } });
          else Util.toast('已保存', 'ok');
        }
      }
    });
  }
  function undoAdd(list, id) {
    if (!Array.isArray(list)) return;
    for (var i = list.length - 1; i >= 0; i--) if (list[i] && list[i].id === id) { list.splice(i, 1); break; }
    Storage.save(); global.App.rerender();
  }

  /* ---------- 半屏面板：医生交代的提示规则 ---------- */
  function openRule(d) {
    var FT = global.FTUI;
    if (!FT || !guardOpen()) return;
    var cr = normRule(d.pregnancy && d.pregnancy.contractionRule) || {};
    var num = function (id, lbl, unit, min, max, v, ph) {
      return '<p class="rs-lbl">' + lbl + '</p><label class="rs-tile sk-num"><input type="number" id="' + id + '" inputmode="numeric" min="' + min + '" max="' + max + '" placeholder="' + ph + '" value="' + (v || '') + '" aria-label="' + lbl + '（' + unit + '）"><span>' + unit + '</span></label>';
    };
    var body = '<p class="rs-hint sk-hint">按产检医生告诉你的标准填（例如「5-1-1」），只做中性提示，不替你判断是否临产。</p>'
      + num('crIv', '间隔不超过', '分钟', 1, 30, cr.iv, '如 5') + num('crDur', '每次至少', '秒', 10, 180, cr.dur, '如 60') + num('crSpan', '持续', '分钟', 10, 240, cr.span, '如 60')
      + (cr.iv ? '<button type="button" class="btn rs-del" data-crclear>清除规则</button>' : '')
      + '<div class="rs-savebar"><button type="button" class="btn btn-primary rs-save" id="crSave">保存</button></div>';
    FT.openSheet('contraction', '提示规则', body, function (api) {
      var box = api.box, closed = false;
      api.onClose = (function (prev) { return function () { closed = true; if (prev) prev.apply(this, arguments); }; })(api.onClose);
      box.addEventListener('click', function (e) {
        if (closed || (Util.hapEcho && Util.hapEcho(e))) return;
        var b = e.target.closest ? e.target.closest('button') : null;
        if (!b || !box.contains(b)) return;
        if (b.hasAttribute('data-crclear')) {
          closed = true;
          if (d.pregnancy) delete d.pregnancy.contractionRule;
          Storage.save(); api.close(); global.App.rerender(); Util.toast('已清除提示规则', 'ok'); return;
        }
        if (b.id !== 'crSave' && !b.hasAttribute('data-ok')) return;
        var iv = parseInt(box.querySelector('#crIv').value, 10), du = parseInt(box.querySelector('#crDur').value, 10), sp = parseInt(box.querySelector('#crSpan').value, 10);
        if (!(iv >= 1 && iv <= 30 && du >= 10 && du <= 180 && sp >= 10 && sp <= 240)) {
          Util.toast('请填完整：间隔 1–30 分、每次 10–180 秒、持续 10–240 分', 'warn'); return;
        }
        closed = true;
        if (!d.pregnancy || typeof d.pregnancy !== 'object') d.pregnancy = {};
        d.pregnancy.contractionRule = { iv: iv, dur: du, span: sp };
        Storage.save(); api.close(); global.App.rerender(); Util.toast('已保存', 'ok');
      });
    });
  }

  function remove(d, which, id) {
    if (which === 'l') {
      Util.removeWithUndo(labArr(d), id, { onSave: function () { Storage.save(); }, onAfter: function () { global.App.rerender(); }, deletedText: '已删除' });
      return;
    }
    Util.removeWithUndo(arr(d), id, {
      onSave: function () { if (d.openContraction && d.openContraction.id === id) d.openContraction = null; Storage.save(); },
      onAfter: function () { global.App.rerender(); },
      deletedText: '已删除宫缩记录'
    });
  }

  function exportTimeline(d, json) {
    var list = doneAsc(d);
    if (json) {
      Util.download('宫缩时间线_' + Util.todayISO() + '.json', JSON.stringify(list, null, 2), 'application/json');
      return;
    }
    var lines = ['咿呀记 宫缩时间线（仅供参考）', '生成时间：' + Util.nowLocal(), ''];
    for (var i = 0; i < list.length; i++) {
      var cc = list[i];
      var dur = cc.end ? secTxt(tms(cc.end) - tms(cc.start)) : '未结束';
      var iv = i > 0 ? secTxt(tms(cc.start) - tms(list[i - 1].start)) : '-';
      lines.push('第' + (i + 1) + '次 开始 ' + Util.fmtDateTime(cc.start) + ' 时长 ' + dur + ' 距上次 ' + iv + (cc.intensity ? ' 强度 ' + (INT[cc.intensity] || '') : ''));
    }
    /* 第 197 次：破水/见红一并写进时间线，按时刻正序 */
    var le = laborList(d).slice().reverse();
    if (le.length) {
      lines.push('', '破水 / 见红');
      le.forEach(function (e) { lines.push(LABOR[e.type].label + ' ' + Util.fmtDateTime(e.time)); });
    }
    Util.download('宫缩时间线_' + Util.todayISO() + '.txt', lines.join('\n'), 'text/plain;charset=utf-8');
  }

  Modules.contraction = {
    id: 'contraction',
    title: '宫缩',
    render: function (view) {
      var d = Storage.get();
      var FT = global.FTUI, SV = (FT && FT.SV) || {};
      var oc = openC();
      var nowMs = Date.now();
      var done = doneAsc(d);
      var lev = laborList(d);
      var rule = normRule(d.pregnancy && d.pregnancy.contractionRule);
      var html = '';
      var isEmpty = !done.length && !lev.length && !oc;

      if (isEmpty) {
        html += '<div class="sk-empty"><img src="assets/hero/contraction.webp" alt="" width="220" height="220" decoding="sync">'
          + '<p>宫缩开始时点按底部「开始」</p>'
          + '<p class="sk-empty-ref">仅供参考，一切以医生判断为准；出血、破水、剧烈腹痛或任何担心，请及时就医。</p></div>';
      } else {
        /* 1. 摘要：计时中 / 距上次开始（3 小时内实时走秒）/ 上次是多久前 */
        var last = done[done.length - 1], s;
        if (oc) s = '宫缩中，<b>' + esc(hm(tms(oc.start))) + '</b> 开始' + (last ? '，距上次开始 <b>' + secTxt(tms(oc.start) - tms(last.start)) + '</b>' : '') + '。';
        else if (last && nowMs - tms(last.start) < 3 * 3600000) {
          s = '距上次开始 <b data-ct-since="' + tms(last.start) + '">' + secTxt(nowMs - tms(last.start)) + '</b>'
            + (last.end ? '，上次持续 <b>' + secTxt(tms(last.end) - tms(last.start)) + '</b>' : '') + '。';
        } else if (last) s = '上次宫缩是 <b>' + esc(Util.fmtAgo(last.start)) + '</b>' + (last.end ? '，持续 <b>' + secTxt(tms(last.end) - tms(last.start)) + '</b>' : '') + '。';
        else s = '还没有宫缩记录。';
        var ended = done.filter(function (c) { return c.end && isFinite(tms(c.end)); });
        var hourDone = ended.filter(function (c) { return nowMs - tms(c.start) <= 3600000; });
        var ref = '';
        if (rule && hourDone.length) {
          ref = ruleMet(ended, rule, nowMs)
            ? '<p class="ms-ref ct-met">最近 ' + rule.span + ' 分钟的记录已符合你填写的「' + ruleTxt(rule) + '」。请按医生交代的做。</p>'
            : '<p class="ms-ref">最近 ' + rule.span + ' 分钟尚未符合你填写的「' + ruleTxt(rule) + '」。</p>';
        }
        html += '<div class="mod-sum"><span class="ms-k">摘要</span><p>' + s + '</p>' + ref
          + '<p class="ms-ref">仅供参考，一切以医生判断为准；出血、破水、剧烈腹痛或任何担心，请及时就医。</p></div>';
      }

      /* 2. 破水 / 见红：最近 48 小时内的事件顶在上面显示「已过多久」+ 通用就医信号 */
      lev.filter(function (e) { return nowMs - tms(e.time) <= 48 * 3600000 && tms(e.time) <= nowMs + 60000; }).slice(0, 2).forEach(function (e) {
        var L = LABOR[e.type];
        html += '<div class="mod-note" data-accent="contraction"><p><b>' + L.label + ' ' + esc(hm(tms(e.time))) + '</b>已过 ' + agoText(nowMs - tms(e.time)) + '。' + L.tip + '</p></div>';
      });

      if (!isEmpty) {
        /* 3. 近一小时看板 */
        html += '<div class="card dash-card ct-dash"><h2>近一小时</h2>';
        if (hourDone.length) {
          var avgDur = hourDone.reduce(function (a, c) { return a + (tms(c.end) - tms(c.start)); }, 0) / hourDone.length;
          var ivs = [];
          for (var hi = 1; hi < ended.length; hi++) if (nowMs - tms(ended[hi].start) <= 3600000) ivs.push(tms(ended[hi].start) - tms(ended[hi - 1].start));
          var avgIv = ivs.length ? ivs.reduce(function (a, x) { return a + x; }, 0) / ivs.length : null;
          html += '<div class="mod-stats"><p><small>次数</small><b>' + hourDone.length + '<i>次</i></b></p>'
            + '<p><small>平均持续</small><b>' + secStat(avgDur) + '</b></p>'
            + (avgIv != null ? '<p><small>平均间隔</small><b>' + secStat(avgIv) + '</b></p>' : '') + '</div>';
        } else html += '<p class="dash-sub ct-none">最近一小时没有已结束的宫缩记录</p>';
        html += '<div class="fin-acts ct-acts"><button type="button" class="btn-mini" data-ct="rule">' + (rule ? '提示规则 · 已设置' : '提示规则') + '</button>'
          + (done.length ? '<button type="button" class="btn-mini" id="cExport">导出文本</button><button type="button" class="btn-mini" id="cExportJson">导出 JSON</button>' : '') + '</div></div>';

        /* 4. 时间轴：宫缩 + 破水 / 见红，新的在上 */
        var rows = [];
        done.forEach(function (c, i) { rows.push({ t: tms(c.start), c: c, iv: i > 0 ? tms(c.start) - tms(done[i - 1].start) : null }); });
        lev.forEach(function (e) { rows.push({ t: tms(e.time), l: e }); });
        rows.sort(function (a, b) { return b.t - a.t; });
        if (rows.length) {
          var todayIso = Util.todayISO();
          html += '<section class="mod-tl ft-tl"><p class="ms-k">最近记录</p><ul class="tl">';
          rows.slice(0, 40).forEach(function (x) {
            var lab = FT ? FT.dayLabel(x.t, todayIso) : '';
            var title, sub = '', id, kind;
            if (x.c) {
              id = x.c.id; kind = 'c';
              title = x.c.end ? '持续 ' + secTxt(tms(x.c.end) - tms(x.c.start)) : '宫缩';
              sub = [x.iv != null ? '间隔 ' + secTxt(x.iv) : '', INT[x.c.intensity] || ''].filter(Boolean).join(' · ');
            } else {
              id = x.l.id; kind = x.l.type; title = LABOR[x.l.type].label; sub = x.l.note || '';
            }
            html += '<li class="tl-row' + (x.l ? ' ct-lab' : '') + '"><span class="tl-time ft-tlt"><small>' + esc(lab) + '</small>' + hm(x.t) + '</span><span class="tl-dot" aria-hidden="true"></span>'
              + '<button type="button" class="tl-card" data-ctopen="' + esc(id) + '" data-k="' + esc(kind) + '" aria-label="' + esc(hm(x.t) + ' ' + title + '，点按修改') + '">'
              + '<span class="tl-ico">' + icon('contraction') + '</span><span class="tl-txt"><b>' + esc(title) + '</b>'
              + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span>'
              + '<span class="tl-more" aria-hidden="true">' + (SV.more || '') + '</span></button>'
              + '<button type="button" class="tl-del" data-del="' + esc(id) + '" data-k="' + (x.c ? 'c' : 'l') + '" aria-label="删除" title="删除">' + icon('trash') + '</button></li>';
          });
          html += '</ul></section>';
        }
      }

      /* 5. 底部：计时中 → 强度 + 迷你计时条；否则「▷ 开始宫缩 | ⊕ 补记」 */
      if (oc) {
        html += '<div class="mod-cta ft-cta cta-col"><div class="ct-int" role="radiogroup" aria-label="这次感觉">'
          + ['1', '2', '3'].map(function (v) {
            var on = String(oc.intensity) === v;
            return '<button type="button" class="' + (on ? 'on' : '') + '" data-int="' + v + '" role="radio" aria-checked="' + on + '">' + INT[v] + '</button>';
          }).join('') + '</div>'
          + '<div class="ft-mini" data-accent="contraction"><span class="ft-mini-open">' + icon('contraction') + '<b id="cTimer">' + secTxt(nowMs - tms(oc.start)) + '</b></span>'
          + '<span class="ft-mini-side">宫缩中</span>'
          + '<button type="button" class="ft-mini-b" id="cCancel" aria-label="取消本次计时">' + icon('close') + '</button>'
          + '<button type="button" class="ft-mini-end" id="cEnd">结束</button></div></div>';
      } else {
        html += '<div class="mod-cta ft-cta"><div class="ft-split" data-accent="contraction">'
          + '<button type="button" class="ft-split-main" id="cStart">' + (SV.play || '') + '<span>开始宫缩</span></button>'
          + '<button type="button" class="ft-split-add" data-ct="add" aria-label="补记宫缩、破水或见红">' + (SV.plusc || icon('plus')) + '</button></div></div>';
      }

      view.innerHTML = '<div class="ft-page skel-page ct-page" data-accent="contraction">' + html + '</div>';
      cTick();

      var page = view.firstChild, lock = 0;
      page.addEventListener('click', function (e) {
        if (Util.hapEcho && Util.hapEcho(e)) return;
        var b = e.target.closest ? e.target.closest('button') : null;
        if (!b || !page.contains(b)) return;
        var dd = Storage.get(), v;
        if (b.id === 'cStart') { start(dd); return; }
        if (b.id === 'cEnd') { finish(dd); return; }
        if (b.id === 'cCancel') { cancel(dd); return; }
        if (b.id === 'cExport') { exportTimeline(dd, false); return; }
        if (b.id === 'cExportJson') { exportTimeline(dd, true); return; }
        if ((v = b.getAttribute('data-int'))) {
          if (e.isTrusted && Date.now() - lock < 300) return;
          lock = Date.now(); setInt(dd, v); return;
        }
        var a = b.getAttribute('data-ct');
        if (a === 'add') { openSheet(dd, 'c', null); return; }
        if (a === 'rule') { openRule(dd); return; }
        if ((v = b.getAttribute('data-ctopen'))) {
          var k = b.getAttribute('data-k');
          var rec = (k === 'c' ? arr(dd) : labArr(dd)).filter(function (x) { return x && String(x.id) === v; })[0];
          if (rec) openSheet(dd, k === 'c' ? 'c' : rec.type, rec);
          return;
        }
        if ((v = b.getAttribute('data-del'))) {
          if (e.isTrusted && Date.now() - lock < 500) return;
          lock = Date.now(); remove(dd, b.getAttribute('data-k'), v);
        }
      });
    },
    /* 日期页 / 其它入口：修改、删除走这里的面板与撤销 */
    _edit: function (rec) { if (rec) openSheet(Storage.get(), 'c', rec); },
    _editLabor: function (rec) { if (rec && LABOR[rec.type]) openSheet(Storage.get(), rec.type, rec); },
    _remove: function (id) { remove(Storage.get(), 'c', id); },
    _removeLabor: function (id) { remove(Storage.get(), 'l', id); },
    _open: function (kind) { openSheet(Storage.get(), kind || 'c', null); },
    _ruleMet: ruleMet
  };

  setInterval(cTick, 1000);
})(window);
