/**
 * momweight.js - 宝妈体重（第 297 次，对标 Cali「宝妈体重」）
 *
 * 页面：孕前信息（身高 + 孕前体重，填一次）→ 增重参考（孕前 BMI · 推荐总增重 · 当前增重）→ 最近一次（较孕前 / 较上次）
 *   → 摘要 → 变化曲线（自己的记录，≥2 条）→ 体重记录时间轴（点按修改、删除带撤销）→ 底部固定「＋ 记录体重」。
 * 记录面板：测量时间（日期 + 时刻）+ 半圆表盘拨数值（0.1 kg 一格，也可直接输入），不弹数字键盘。
 * 推荐总增重按《妊娠期妇女体重增长推荐值标准》WS/T 801—2022 表 1（单胎自然妊娠）按孕前 BMI 分档取值；
 *   页面只写数值区间与出处，不写「偏高 / 不足 / 超重」之类判定词（第 284 次生长页同口径：中性参考，不替代医生判断）。
 *   身高 < 140 cm 或孕前体重 > 125 kg 时标准不适用，只显示 BMI 并说明。
 * 数据：d.pregnancy.weights = [{ id, date, at?, kg, week }]（沿用旧数据，at 为 HH:MM，新增）；
 *   d.pregnancy.heightCm、d.pregnancy.preKg（新增）。都是妈妈的记录，切换宝宝不影响。
 */
(function (global) {
  'use strict';
  var Storage = global.Storage, Util = global.Util;
  var Modules = global.Modules = global.Modules || {};

  var M = { k: 'mw', name: '体重', unit: 'kg', min: 30, max: 200, step: 0.1, drag: 0.1, dec: 1, ctl: 'dial' };
  /* WS/T 801—2022 表 1：孕前 BMI 分档 → 总增长值范围（kg） */
  var GWG = [
    { lt: 18.5, lo: 11, hi: 16, band: '＜18.5' },
    { lt: 24, lo: 8, hi: 14, band: '18.5–23.9' },
    { lt: 28, lo: 7, hi: 11, band: '24.0–27.9' },
    { lt: Infinity, lo: 5, hi: 9, band: '≥28.0' }
  ];

  function esc(s) { return Util.escapeHtml(s == null ? '' : String(s)); }
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  function num(v) { var n = Number(v); return isFinite(n) ? n : null; }
  function f1(v) { return String(Math.round(v * 10) / 10); }
  function sgn(v) { var r = Math.round(v * 10) / 10; return (r > 0 ? '+' : r < 0 ? '−' : '±') + f1(Math.abs(r)); }
  function pg(d) { if (!d.pregnancy || typeof d.pregnancy !== 'object') d.pregnancy = {}; return d.pregnancy; }
  function list(d) { var p = pg(d); if (!Array.isArray(p.weights)) p.weights = []; return p.weights; }
  function okDay(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T00:00:00').getTime()); }
  function okHM(s) { return typeof s === 'string' && /^\d{2}:\d{2}$/.test(s); }
  function key(r) { return String(r.date) + 'T' + (okHM(r.at) ? r.at : '00:00'); }
  /* 有效记录，新的在前 */
  function recs(d) {
    return list(d).filter(function (r) { return r && okDay(r.date) && num(r.kg) != null; })
      .slice().sort(function (a, b) { return key(b).localeCompare(key(a)); });
  }
  function preOf(d) {
    var p = pg(d), h = num(p.heightCm), w = num(p.preKg);
    if (h == null || w == null || h < 120 || h > 220 || w < 30 || w > 200) return null;
    var bmi = w / Math.pow(h / 100, 2), g = null;
    for (var i = 0; i < GWG.length; i++) if (bmi < GWG[i].lt) { g = GWG[i]; break; }
    return { h: h, w: w, bmi: Math.round(bmi * 10) / 10, g: g, na: h < 140 || w > 125 };
  }
  function weekAt(d, day) {
    var p = pg(d), base = p.lmp || (p.dueDate ? Util.addDays(p.dueDate, -280) : null);
    if (!base || !okDay(day)) return null;
    var el = Util.daysBetween(base, day);
    return el >= 0 && el <= 45 * 7 ? Math.floor(el / 7) : null;
  }
  function dayLab(day) {
    var t = Util.todayISO();
    if (day === t) return '今天';
    if (day === Util.addDays(t, -1)) return '昨天';
    var m = +day.slice(5, 7), dd = +day.slice(8, 10);
    return day.slice(0, 4) === t.slice(0, 4) ? m + '月' + dd + '日' : day.slice(2, 4) + '/' + m + '/' + dd;
  }

  /* ---------- 孕前信息：页面卡片（未填时）/ 半屏（修改时）共用保存 ---------- */
  function preFields(p, pre) {
    return '<label class="mw-in"><span><b>身高</b><small>120–220 cm</small></span><span class="mw-inbox"><input type="text" id="mwH" inputmode="decimal" autocomplete="off" enterkeyhint="next" placeholder="165" value="' + (pre ? esc(f1(pre.h)) : esc(p.heightCm != null ? p.heightCm : '')) + '" aria-label="身高（cm）"><i>cm</i></span></label>'
      + '<label class="mw-in"><span><b>孕前体重</b><small>30–200 kg</small></span><span class="mw-inbox"><input type="text" id="mwP" inputmode="decimal" autocomplete="off" enterkeyhint="done" placeholder="55" value="' + (pre ? esc(f1(pre.w)) : esc(p.preKg != null ? p.preKg : '')) + '" aria-label="孕前体重（kg）"><i>kg</i></span></label>';
  }
  function savePre(box) {
    var hI = box.querySelector('#mwH'), pI = box.querySelector('#mwP');
    var h = Number(String(hI.value).trim().replace(/[,，]/g, '.')), w = Number(String(pI.value).trim().replace(/[,，]/g, '.'));
    var bad = false;
    Util.markInvalid(hI, null); Util.markInvalid(pI, null);
    if (!String(hI.value).trim() || !isFinite(h) || h < 120 || h > 220) { Util.markInvalid(hI, '身高填 120–220 cm'); bad = true; }
    if (!String(pI.value).trim() || !isFinite(w) || w < 30 || w > 200) { Util.markInvalid(pI, '孕前体重填 30–200 kg'); bad = true; }
    if (bad) return false;
    var d = Storage.get(), p = pg(d);
    p.heightCm = Math.round(h * 10) / 10; p.preKg = Math.round(w * 10) / 10;
    if (Storage.save()) Util.toast('已保存孕前信息', 'ok');
    return true;
  }
  var openAt = 0;
  function canOpen() { if (Date.now() - openAt < 450) return false; openAt = Date.now(); return true; }
  function openPre(d) {
    var FT = global.FTUI; if (!FT || !canOpen()) return;
    var body = '<p class="mw-tip">填写孕前身高和体重后，可显示孕前 BMI 和推荐增重区间。</p>' + preFields(pg(d), preOf(d))
      + '<div class="rs-savebar"><button type="button" class="btn btn-primary rs-save" id="mwPreSave">' + icon('check') + '<span>保存孕前信息</span></button></div>';
    FT.openSheet('momweight', '孕前信息', body, function (api) {
      var box = api.box, done = false;
      box.addEventListener('click', function (e) {
        if (done || (Util.hapEcho && Util.hapEcho(e))) return;
        var b = e.target.closest ? e.target.closest('button') : null;
        if (b && (b.id === 'mwPreSave' || b.hasAttribute('data-ok'))) { if (savePre(box)) { done = true; api.close(); global.App.rerender(); } }
      });
      box.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        if (e.target.id === 'mwH') { var n = box.querySelector('#mwP'); if (n) n.focus(); }
        else if (!done && savePre(box)) { done = true; api.close(); global.App.rerender(); }
      });
    });
  }

  /* ---------- 记录面板：测量时间 + 半圆表盘 ---------- */
  function openRec(d, rec) {
    var FT = global.FTUI, G = Modules.growth;
    if (!FT || !G || !G._makeCtl || !canOpen()) return;
    var editing = !!rec, all = recs(d), pre = preOf(d);
    var now = Util.nowLocal(), today = now.slice(0, 10);
    var date0 = editing ? rec.date : today, hm0 = editing ? (okHM(rec.at) ? rec.at : '') : now.slice(11, 16);
    var v0 = editing ? num(rec.kg) : (all[0] ? num(all[0].kg) : (pre ? pre.w : 60));
    var st = { v: Math.min(M.max, Math.max(M.min, Number(v0.toFixed(1)))), bad: false };
    var body = FT.whenTiles('mw', '测量时间', date0, hm0 || '--:--', today).replace('value="--:--"', 'value=""')
      + '<p class="rs-lbl mw-lbl"><b>当前体重</b> <span class="rs-lbl-n">30–200 kg</span></p>'
      + '<div class="gr-big"><label class="gr-numwrap"><input type="text" id="mwNum" class="gr-num" inputmode="decimal" autocomplete="off" enterkeyhint="done" aria-label="体重（kg）"><span class="gr-unit">kg</span></label></div>'
      + '<p class="mw-delta" data-mwdelta></p>'
      + '<div class="gr-ctl is-dial" id="mwCtl"></div>'
      + (editing ? '<button type="button" class="btn rs-del" data-mwdel>删除这条记录</button>' : '')
      + '<div class="rs-savebar"><button type="button" class="btn btn-primary rs-save" id="mwSave">' + icon('check') + '<span>' + (editing ? '保存修改' : '保存') + '</span></button></div>';
    FT.openSheet('momweight', editing ? '修改体重记录' : '新增体重记录', body, function (api) {
      var box = api.box, closed = false, saving = false;
      var panel = box.closest('.modal'); if (panel) panel.classList.add('gr-sheet', 'mw-sheet');
      var inp = box.querySelector('#mwNum'), host = box.querySelector('#mwCtl'), ctl = null;
      api.onClose = (function (prev) { return function () { closed = true; if (ctl) ctl.stop(); if (prev) prev.apply(this, arguments); }; })(api.onClose);
      if (!hm0) { var ti = box.querySelector('#mwTime'); if (ti && ti._paint) ti._paint(); }
      function paintDelta() {
        var el = box.querySelector('[data-mwdelta]'); if (!el) return;
        var bits = [];
        if (pre) bits.push('较孕前 ' + sgn(st.v - pre.w) + ' kg');
        var prev = all.filter(function (r) { return !editing || r.id !== rec.id; })[0];
        if (prev) bits.push('较上次 ' + sgn(st.v - num(prev.kg)) + ' kg');
        el.textContent = bits.join(' · ');
      }
      function show() { inp.value = st.v.toFixed(1); Util.markInvalid(inp, null); st.bad = false; paintDelta(); }
      ctl = G._makeCtl(host, M, { get: function () { return st.v; }, set: function (v) { st.v = v; show(); } });
      show();
      function readTyped() {
        var t = String(inp.value).trim().replace(/[,，]/g, '.');
        if (t === '') return { empty: true };
        var n = Number(t);
        if (!isFinite(n) || n < M.min || n > M.max) return { bad: true };
        return { v: Number(n.toFixed(1)) };
      }
      inp.addEventListener('input', function () {
        var r = readTyped();
        if (r.empty) { st.bad = false; return; }
        if (r.bad) { st.bad = true; inp.classList.add('is-invalid'); inp.setAttribute('aria-invalid', 'true'); return; }
        st.bad = false; Util.markInvalid(inp, null); st.v = r.v; if (ctl) ctl.paint(); paintDelta();
      });
      inp.addEventListener('focus', function () { try { inp.select(); } catch (e) {} });
      inp.addEventListener('blur', function () { var r = readTyped(); if (r.bad) { Util.markInvalid(inp, '体重填 30–200 kg'); return; } show(); });
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } });
      box.addEventListener('click', function (e) {
        if (closed || (Util.hapEcho && Util.hapEcho(e))) return;
        var b = e.target.closest ? e.target.closest('button') : null;
        if (!b || !box.contains(b)) return;
        if (b.id === 'mwSave' || b.hasAttribute('data-ok')) { save(); return; }
        if (b.hasAttribute('data-mwdel')) { closed = true; api.close(); remove(rec.id); }
      });
      function save() {
        if (saving || closed) return;
        var r = readTyped();
        if (r.bad || st.bad) { Util.markInvalid(inp, '体重填 30–200 kg'); return; }
        if (r.v != null) st.v = r.v;
        var dv = (box.querySelector('#mwDate') || {}).value, tv = (box.querySelector('#mwTime') || {}).value || '';
        if (!okDay(dv)) { Util.toast('日期不完整', 'warn'); return; }
        if (dv > Util.todayISO()) { Util.toast('这一天还没到，请检查一下', 'warn'); return; }
        var when = FT.readWhen(box, 'mw');
        if (okHM(tv) && isFinite(when) && when > Date.now() + 60000) { Util.toast('这个时间还没到，请检查一下', 'warn'); return; }
        saving = true;
        var dd = Storage.get(), L = list(dd), kg = Math.round(st.v * 10) / 10, wk = weekAt(dd, dv), target;
        if (editing) {
          target = L.filter(function (x) { return x && x.id === rec.id; })[0];
          if (!target) { saving = false; api.close(); return; }
        } else { target = { id: Util.uid() }; L.push(target); }
        if (wk == null && editing && target.date === dv && typeof target.week === 'number') wk = target.week; /* 没填预产期时，原来记下的孕周照留 */
        target.date = dv; target.kg = kg; target.week = wk;
        if (okHM(tv)) target.at = tv.slice(0, 5); else delete target.at;
        var newId = target.id;
        if (Storage.save()) {
          if (editing) Util.toast('已保存修改', 'ok');
          else Util.toast('已记录体重 ' + f1(kg) + ' kg' + (wk != null ? '（孕 ' + wk + ' 周）' : ''), 'ok', { label: '撤销', onClick: function () {
            var d3 = Storage.get(); pg(d3).weights = list(d3).filter(function (x) { return !x || x.id !== newId; }); Storage.save(); global.App.rerender(); Util.toast('已撤销', 'ok');
          } });
        }
        closed = true; api.close(); global.App.rerender();
      }
    });
  }
  function remove(id) {
    var d = Storage.get();
    Util.removeWithUndo(list(d), id, { onSave: function () { Storage.save(); }, onAfter: function () { global.App.rerender(); }, deletedText: '已删除体重记录' });
  }

  /* ---------- 页面 ---------- */
  function pageHTML(d) {
    var FT = global.FTUI, SV = (FT && FT.SV) || {};
    var p = pg(d), pre = preOf(d), rs = recs(d), last = rs[0], prev = rs[1];
    var html = '';
    if (!pre) {
      html += '<div class="card mw-card mw-pre"><p class="ms-k">孕前信息</p><p class="mw-tip">填写孕前身高和体重后，可显示孕前 BMI 和推荐增重区间。</p>'
        + preFields(p, null)
        + '<button type="button" class="btn btn-primary mw-presave" id="mwPreSave">' + icon('check') + '<span>保存孕前信息</span></button></div>';
    } else {
      var gain = last ? num(last.kg) - pre.w : null;
      html += '<div class="card mw-card mw-ref"><div class="mw-hd"><p class="ms-k">增重参考</p><button type="button" class="btn-mini" data-mw="pre">修改孕前信息</button></div>'
        + '<div class="mw-tiles"><p><small>孕前 BMI</small><b>' + esc(pre.bmi.toFixed(1)) + '</b></p>'
        + (pre.na ? '<p><small>推荐总增重</small><b class="mw-na">不适用</b></p>'
          : '<p><small>推荐总增重</small><b>' + pre.g.lo.toFixed(1) + '–' + pre.g.hi.toFixed(1) + '<i>kg</i></b></p>') + '</div>'
        + (gain != null ? '<p class="mw-gain">当前增重 <b>' + esc(sgn(gain)) + ' kg</b></p>' : '')
        + '<p class="ms-ref">' + (pre.na ? '身高低于 140 cm 或孕前体重高于 125 kg 时，国家推荐值标准不适用，请以产检医生意见为准。'
          : '按孕前 BMI ' + esc(pre.g.band) + ' 一档取《妊娠期妇女体重增长推荐值标准》（WS/T 801—2022，单胎）的总增重区间，仅供记录和产检沟通，不替代医生判断。') + '</p></div>';
    }
    if (last) {
      html += '<div class="card mw-card mw-last"><p class="ms-k">最近一次</p><div class="mw-lastrow"><p class="mw-big"><b>' + esc(f1(num(last.kg))) + '</b><i>kg</i></p>'
        + '<span class="mw-when">' + esc(dayLab(last.date)) + (okHM(last.at) ? ' ' + esc(last.at) : '') + '</span></div>'
        + '<p class="mw-sub">' + [pre ? '较孕前 ' + sgn(num(last.kg) - pre.w) + ' kg' : '', prev ? '较上次 ' + sgn(num(last.kg) - num(prev.kg)) + ' kg' : ''].filter(Boolean).map(esc).join(' · ') + '</p></div>';
      html += '<div class="mod-sum"><span class="ms-k">摘要</span><p>最近一次体重为 <b>' + esc(f1(num(last.kg))) + ' kg</b>。上次：<b>' + esc(okHM(last.at) ? Util.fmtAgo(last.date + 'T' + last.at + ':00') : dayLab(last.date)) + '</b>'
        + (last.week != null ? '（孕 ' + esc(last.week) + ' 周）' : '') + '。</p></div>';
      var chart = Modules.pregnancy && Modules.pregnancy._weightChart ? Modules.pregnancy._weightChart(rs.slice().reverse()) : '';
      if (chart) html += '<div class="card dash-card mw-chart"><h2>变化曲线</h2>' + chart + '</div>';
      html += '<section class="mod-tl ft-tl"><p class="ms-k">体重记录</p><ul class="tl">';
      rs.slice(0, 60).forEach(function (r, i) {
        var nx = rs[i + 1], sub = [r.week != null ? '孕 ' + r.week + ' 周' : '', nx ? '较上次 ' + sgn(num(r.kg) - num(nx.kg)) + ' kg' : ''].filter(Boolean).join(' · ');
        var t = f1(num(r.kg)) + ' kg';
        html += '<li class="tl-row"><span class="tl-time ft-tlt"><small>' + esc(dayLab(r.date)) + '</small>' + (okHM(r.at) ? esc(r.at) : '') + '</span><span class="tl-dot" aria-hidden="true"></span>'
          + '<button type="button" class="tl-card" data-mwopen="' + esc(r.id) + '" aria-label="' + esc(dayLab(r.date) + ' ' + t + '，点按修改') + '">'
          + '<span class="tl-ico">' + icon('momweight') + '</span><span class="tl-txt"><b>' + esc(t) + '</b>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span>'
          + '<span class="tl-more" aria-hidden="true">' + (SV.more || '') + '</span></button>'
          + '<button type="button" class="tl-del" data-del="' + esc(r.id) + '" aria-label="删除" title="删除">' + icon('trash') + '</button></li>';
      });
      html += '</ul></section>';
    } else {
      html += '<p class="ms-k mw-k">体重记录</p><div class="sk-empty mw-empty"><img src="assets/hero/momweight.webp" alt="" width="200" height="200" decoding="sync">'
        + '<p>点按底部「记录体重」开始记录</p></div>';
    }
    html += '<div class="mod-cta ft-cta"><button type="button" class="mc-main" id="mwAdd">' + (SV.plusc || icon('plus')) + '<span>记录体重</span></button></div>';
    return html;
  }

  Modules.momweight = {
    id: 'momweight',
    title: '宝妈体重',
    render: function (view) {
      var d = Storage.get();
      view.innerHTML = '<div class="ft-page skel-page mw-page" data-accent="momweight">' + pageHTML(d) + '</div>';
      var page = view.firstChild, lock = 0;
      page.addEventListener('click', function (e) {
        if (Util.hapEcho && Util.hapEcho(e)) return;
        var b = e.target.closest ? e.target.closest('button') : null;
        if (!b || !page.contains(b)) return;
        var dd = Storage.get(), v;
        if (b.id === 'mwAdd') { openRec(dd, null); return; }
        if (b.id === 'mwPreSave') { if (savePre(page)) global.App.rerender(); return; }
        if (b.getAttribute('data-mw') === 'pre') { openPre(dd); return; }
        if ((v = b.getAttribute('data-mwopen'))) {
          var rec = list(dd).filter(function (x) { return x && String(x.id) === v; })[0];
          if (rec) openRec(dd, rec);
          return;
        }
        if ((v = b.getAttribute('data-del'))) {
          if (e.isTrusted && Date.now() - lock < 500) return;
          lock = Date.now(); remove(v);
        }
      });
      page.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' || !e.target || !e.target.id) return;
        if (e.target.id === 'mwH') { e.preventDefault(); var n = page.querySelector('#mwP'); if (n) n.focus(); }
        else if (e.target.id === 'mwP') { e.preventDefault(); if (savePre(page)) global.App.rerender(); }
      });
    },
    _edit: function (rec) { if (rec) openRec(Storage.get(), rec); },
    _remove: remove,
    _pre: preOf,
    _gwg: GWG
  };
})(window);
