/**
 * sleep.js - 睡眠
 * 第 241 次：照用户给的参考截图重做（与亲喂 / 瓶喂同一套骨架）：
 *   页面：摘要句 → 洞察小按钮（今日睡眠 / 作息 / 睡眠参考）→ 最近记录（竖向时间轴）
 *         → 底部「▷ 开始睡眠 | ⊕ 补记」；睡眠中换成迷你条（时间 · 暂停 · 醒了）。
 *   全屏计时：夜里的婴儿床（可关灯成纯黑）、「睡眠中 ●」「哄睡 >」、大号计时，
 *         开始时刻（可改）/ 醒来次数 / 已暂停；底部 宝宝醒了 +1 · 暂停/继续 · 停止，
 *         停止后变「取消 | ■ 结束睡眠」两步确认，免得半夜误触。
 * 数据不变形：仍是 d.openSleep { id, start, pausedMs, pauseStart }，多一个 wakes（中途醒来次数），
 * 结束写 d.sleeps，wakings = wakes，longestMin 仍按「时长 ÷ (醒来+1)」折算（U-16）。
 * 只和宝宝自己比（U-18 / U-24），不给睡眠效率（U-19）；漏记随时补（U-11）。
 */
(function (global) {
  'use strict';
  var Storage = global.Storage, Util = global.Util;
  var Modules = global.Modules = global.Modules || {};
  var esc = function (s) { return Util.escapeHtml(String(s == null ? '' : s)); };
  var p2 = function (n) { return (n < 10 ? '0' : '') + n; };

  function openSleep() { return (Storage.get() || {}).openSleep || null; } /* 第 146 次：早于 load 的定时器调用时判空 */

  /* ---- 睡眠四字段的取值与折算（首页复用 _longestOf）---- */
  function durMs(s) { return new Date(s.end).getTime() - new Date(s.start).getTime() - (s.pausedMs || 0); }
  function longestMin(s) {
    if (s.longestMin != null) return s.longestMin;
    var w = (s.wakings == null) ? 0 : s.wakings;
    return Math.max(0, Math.round(durMs(s) / 60000 / (w + 1)));
  }
  function fmtH(h) { return (Math.round(h * 10) / 10).toFixed(1); }
  function loc(t) {
    var d = new Date(t);
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + 'T' + p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds());
  }
  function hm(t) { var d = new Date(t); return p2(d.getHours()) + ':' + p2(d.getMinutes()); }
  function tms(s) { var t = new Date(s).getTime(); return isFinite(t) ? t : NaN; }
  function clock(v) { return Util.fmtClock(v).replace(/^0(\d:)/, '$1'); }
  /* 「1 分钟」「2 小时 5 分」 */
  function fmtMin(min) {
    min = Math.max(0, Math.round(min || 0));
    if (min < 60) return min + ' 分钟';
    return Math.floor(min / 60) + ' 小时' + (min % 60 ? ' ' + (min % 60) + ' 分' : '');
  }
  function osState(os, now) {
    var paused = (os.pausedMs || 0) + (os.pauseStart ? Math.max(0, now - os.pauseStart) : 0);
    return { el: Math.max(0, now - tms(os.start) - paused), paused: paused, isPaused: !!os.pauseStart, wakes: Math.max(0, os.wakes | 0) };
  }

  var SVs = {
    /* 宝宝醒了：睁眼的小脸 + 小星星 */
    wake: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11.5" cy="13" r="7.5" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M8.6 7.2c.9-1.3 2.4-1.8 3.6-1.2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="9" cy="12.4" r="1.15" fill="currentColor"/><circle cx="14" cy="12.4" r="1.15" fill="currentColor"/><path d="M9.3 15.6c1.3 1.1 3.1 1.1 4.4 0" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M19.5 2.8l.55 1.45 1.45.55-1.45.55-.55 1.45-.55-1.45-1.45-.55 1.45-.55z" fill="currentColor"/></svg>',
    lullaby: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18.5V7.5l8-2v10" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><circle cx="7" cy="18.5" r="2.2" fill="none" stroke="currentColor" stroke-width="1.9"/><circle cx="15" cy="15.5" r="2.2" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M2.5 4h2.6L2.5 7h2.6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    chev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    lightOff: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M4 20L20 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    hourglass: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12.5" r="8" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 8v4.5l3 1.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>'
  };
  function UI() { return global.FTUI || null; }

  /* ---------- 开始 / 结束（首页、dock 胶囊也走这里） ---------- */
  function startSleep(atMs) {
    var d = Storage.get();
    d.openSleep = { id: Util.uid(), start: loc(atMs || Date.now()), pausedMs: 0, pauseStart: null, wakes: 0 };
    return Storage.save();
  }
  function endSleep(endMs) {
    var d = Storage.get(), os2 = d.openSleep; if (!os2) return false;
    var startMs = tms(os2.start), nowMs = Date.now();
    if (!(endMs > startMs)) { Util.toast('醒来时间要晚于入睡时间（' + Util.fmtDateTime(os2.start) + '）', 'warn'); return false; }
    if (endMs > nowMs) endMs = nowMs;
    var paused = (os2.pausedMs || 0) + (os2.pauseStart ? Math.max(0, endMs - os2.pauseStart) : 0);
    var totalMs = endMs - startMs - paused;
    var wk = os2.wakes != null ? Math.max(0, os2.wakes | 0) : null;
    /* 第 272 次（审计 #1：误触「睡了」→「醒了」存下一条 0 分钟睡眠、没有撤销）：
       不到 1 分钟的不存，只结束计时，toast 给「撤销」把计时原样放回去；
       正常结束的也给「撤销」：删掉这条记录、恢复成还在睡（与其他记录的保存一致）。 */
    var keep = JSON.parse(JSON.stringify(os2));
    var undoOpen = function (recId) {
      var dd = Storage.get(); if (!dd) return;
      if (recId) dd.sleeps = (dd.sleeps || []).filter(function (x) { return !x || x.id !== recId; });
      if (!dd.openSleep) dd.openSleep = keep;
      Storage.save();
      if (global.App && App.rerender) App.rerender();
    };
    if (totalMs < 60000) {
      d.openSleep = null;
      if (Storage.save()) Util.toast('睡了不到 1 分钟，没有记录', 'info', { label: '撤销', onClick: function () { undoOpen(null); } });
      return true;
    }
    var rec = { id: os2.id, start: os2.start, end: loc(endMs), pausedMs: paused, note: null, wakings: wk,
      longestMin: wk == null ? null : Math.max(0, Math.round(totalMs / 60000 / (wk + 1))) };
    d.sleeps.push(rec);
    d.openSleep = null;
    if (Storage.save()) Util.toast('已记录：睡眠 ' + Util.fmtDuration(Math.max(0, totalMs)) + (wk ? '，中途醒来 ' + wk + ' 次' : ''), 'ok', { label: '撤销', onClick: function () { undoOpen(rec.id); } }); /* C1：计时类带时长 */
    return true;
  }
  function togglePause() {
    var d = Storage.get(), os = d.openSleep; if (!os) return;
    if (os.pauseStart) { os.pausedMs = (os.pausedMs || 0) + (Date.now() - os.pauseStart); os.pauseStart = null; }
    else os.pauseStart = Date.now();
    Storage.save();
  }

  /* ---------- 全屏计时 ---------- */
  var fullEl = null, fullTick = null, fullDim = false, fullConfirm = false;
  function closeFull() {
    if (fullTick) { clearInterval(fullTick); fullTick = null; }
    if (global.NightWin && fullEl) NightWin.unmount(fullEl);
    if (fullEl && fullEl.parentNode) fullEl.parentNode.removeChild(fullEl);
    if (fullEl) document.body.classList.remove('ftf-open'); /* 亲喂全屏也用这个类：没开过就别动它 */
    fullEl = null; fullConfirm = false;
  }
  function openFull() {
    if (!openSleep()) { closeFull(); return; }
    if (!fullEl) {
      fullEl = document.createElement('div');
      fullEl.className = 'ftf ftf-sleep';
      fullEl.setAttribute('data-accent', 'sleep');
      fullEl.setAttribute('role', 'dialog');
      fullEl.setAttribute('aria-label', '睡眠计时');
      document.body.appendChild(fullEl);
      document.body.classList.add('ftf-open');
      fullEl.addEventListener('click', onFullClick);
    }
    paintFull();
    if (!fullTick) fullTick = setInterval(tickFull, 500);
  }
  function paintFull() {
    var os = openSleep();
    if (!os || !fullEl) { closeFull(); return; }
    var s = osState(os, Date.now());
    var sv = (UI() && UI().SV) || {};
    fullEl.classList.toggle('is-dark', fullDim);
    var stateTxt = s.isPaused ? '已暂停' : '睡眠中';
    var lull = '<button type="button" class="ftf-chip ftf-lull" data-f="lull">' + SVs.lullaby + '<span>哄睡</span>' + SVs.chev + '</button>';
    fullEl.innerHTML = '<div class="ftf-bg" aria-hidden="true"></div>'
      + '<div class="ftf-top"><button type="button" class="ftf-ib" data-f="down" aria-label="收起">' + (sv.down || '') + '</button>'
      + '<span class="ftf-tr"><button type="button" class="ftf-ib ftf-del" data-f="cancel" aria-label="放弃这次计时">' + icon('trash') + '</button>'
      + '<button type="button" class="ftf-ib" data-f="dim" aria-label="' + (fullDim ? '打开夜景' : '关掉夜景') + '" aria-pressed="' + (fullDim ? 'true' : 'false') + '">' + (fullDim ? SVs.lightOff : (sv.bright || '')) + '</button></span></div>'
      + (fullDim ? '<div class="sl-dk"><span class="sl-dk-ico">' + icon('sleep') + '</span><b>' + stateTxt + '</b>' + lull + '</div>' : '')
      + '<div class="ftf-main">'
      + (fullDim ? '' : '<div class="sl-chips"><p class="ftf-chip">' + icon('sleep') + '<span>' + stateTxt + '</span><i class="' + (s.isPaused ? 'is-off' : '') + '"></i></p>' + lull + '</div>')
      + '<span class="ftf-big sl-big" data-fv="el">' + clock(s.el) + '</span>'
      + '<div class="ftf-stats">'
      + '<label class="ftf-st ftf-start"><i>' + (sv.clock || '') + '</i><b>' + hm(tms(os.start)) + ' <em>' + (sv.pen || '') + '</em></b><span>开始</span>'
      + '<input type="time" data-f="start" value="' + hm(tms(os.start)) + '" aria-label="修改入睡时刻"></label>'
      + '<button type="button" class="ftf-st sl-wk" data-f="unwake" aria-label="中途醒来 ' + s.wakes + ' 次' + (s.wakes ? '，点按减一' : '') + '"><i>' + SVs.wake + '</i><b data-fv="wk">' + s.wakes + (s.wakes ? '<u></u>' : '') + '</b><span>醒来</span></button>'
      + '<div class="ftf-st"><i>' + SVs.hourglass + '</i><b data-fv="pz">' + clock(s.paused) + '</b><span>已暂停</span></div>'
      + '</div>'
      + (fullConfirm
        ? endBackHTML(os) + '<div class="sl-two"><button type="button" class="sl-cancel" data-f="noend">取消</button>'
          + '<button type="button" class="ftf-main-btn sl-endbtn" data-f="end">' + (sv.stop || '') + '<span>结束睡眠</span></button></div>'
        : '<div class="ftf-ctl"><button type="button" class="ftf-rb sl-wake' + (s.wakes ? ' is-on' : '') + '" data-f="wake" aria-label="宝宝醒了一次">' + SVs.wake + '</button>'
          + '<button type="button" class="ftf-main-btn" data-f="pause">' + (s.isPaused ? '继续' : '暂停') + '</button>'
          + '<button type="button" class="ftf-rb" data-f="stop" aria-label="结束睡眠">' + (sv.stop || '') + '</button></div>')
      + '</div>';
    if (global.NightWin) NightWin.mount(fullEl); /* 第 330 次：夜里（没关灯时）背景换成窗外真实夜空 */
    var si = fullEl.querySelector('input[data-f="start"]');
    if (si) si.addEventListener('change', function () {
      var dd = Storage.get(), o = dd.openSleep; if (!o || !/^\d{2}:\d{2}/.test(si.value)) return;
      var now = Date.now(), cand = tms(loc(now).slice(0, 10) + 'T' + si.value.slice(0, 5) + ':00');
      if (cand > now) cand -= 864e5;
      o.start = loc(cand);
      Storage.save(); paintFull();
      if (global.App && App.currentTab && App.currentTab() === 'sleep') App.rerender();
    });
  }
  /* 计时超过 6 小时：多半是忘了按结束，结束前可以按实际醒来时间回填（第 194 次的回填挪到这里） */
  function endBackHTML(os) {
    if (Date.now() - tms(os.start) < 6 * 3600000) return '';
    return '<div class="sl-back" role="group" aria-label="实际醒来时间"><span>已经计时 ' + Math.floor((Date.now() - tms(os.start)) / 3600000) + ' 小时，按实际醒来时间：</span>'
      + [10, 20, 30].map(function (m) { return '<button type="button" data-f="endago" data-m="' + m + '">' + m + ' 分钟前</button>'; }).join('') + '</div>';
  }
  function tickFull() {
    var os = openSleep();
    if (!os) { if (fullEl) closeFull(); return; }
    var s = osState(os, Date.now());
    if (fullEl) {
      var a = fullEl.querySelector('[data-fv="el"]'), b = fullEl.querySelector('[data-fv="pz"]');
      if (a) a.textContent = clock(s.el);
      if (b) b.textContent = clock(s.paused);
    }
    var mini = document.querySelector('[data-sl-mini]');
    if (mini) mini.textContent = clock(s.el);
  }
  function after() {
    if (fullEl) paintFull();
    if (global.App && App.currentTab && App.currentTab() === 'sleep') App.rerender();
    else if (global.DockLive) try { DockLive.render(); } catch (e) { /* */ }
  }
  function onFullClick(e) {
    var b = e.target.closest ? e.target.closest('[data-f]') : null;
    if (!b || b.tagName === 'INPUT') return;
    var k = b.getAttribute('data-f'), d = Storage.get(), os = d.openSleep;
    if (k === 'down') { closeFull(); if (global.App) App.rerender(); return; }
    if (k === 'dim') { fullDim = !fullDim; paintFull(); return; }
    if (k === 'lull') { closeFull(); if (Modules.whitenoise) Modules.whitenoise._open = true; if (global.App) App.showTab('whitenoise'); return; }
    if (!os) { closeFull(); return; }
    if (k === 'cancel') {
      Util.confirm({ title: '放弃这次计时？', message: '这一觉不会被记录。', okText: '放弃', danger: true, onConfirm: function () {
        var dd = Storage.get(); dd.openSleep = null; Storage.save(); closeFull(); Util.toast('已放弃这次计时', 'ok'); if (global.App) App.rerender();
      } });
      return;
    }
    if (k === 'wake') { os.wakes = Math.max(0, os.wakes | 0) + 1; Storage.save(); if (Util.haptic) Util.haptic('ok'); after(); return; }
    if (k === 'unwake') { if ((os.wakes | 0) > 0) { os.wakes = (os.wakes | 0) - 1; Storage.save(); Util.toast('醒来次数改为 ' + os.wakes, 'ok'); after(); } return; }
    if (k === 'pause') { togglePause(); if (Util.haptic) Util.haptic('ok'); after(); return; }
    if (k === 'stop') { fullConfirm = true; paintFull(); return; }
    if (k === 'noend') { fullConfirm = false; paintFull(); return; }
    if (k === 'end' || k === 'endago') {
      var at = Date.now() - (k === 'endago' ? (Number(b.getAttribute('data-m')) || 0) * 60000 : 0);
      if (endSleep(at)) { if (Util.haptic) Util.haptic('ok'); closeFull(); if (global.App) App.rerender(); }
    }
  }

  /* ---------- 补记一觉 ---------- */
  function openManual() {
    var ui = UI(); if (!ui) return;
    var now = Date.now(), st0 = now - 2 * 3600000;
    var body = ui.whenTiles('s', '入睡', ui.isoDay(st0), ui.hm(st0), ui.isoDay(now))
      + ui.whenTiles('e', '醒来', ui.isoDay(now), ui.hm(now), ui.isoDay(now)).replace('结束日期', '日期').replace('结束时间', '时间').replace(/aria-label="结束日期"/, 'aria-label="醒来日期"').replace(/aria-label="结束时间"/, 'aria-label="醒来时间"')
      + '<p class="rs-lbl">中途醒来</p><div class="ft-step" data-step>'
      + '<button type="button" class="ft-sb" data-d="-1" aria-label="减少">−</button>'
      + '<span class="ft-sv"><input type="number" inputmode="numeric" min="0" max="30" value="0" id="slWk" aria-label="中途醒来次数"><small>次</small></span>'
      + '<button type="button" class="ft-sb" data-d="1" aria-label="增加">+</button></div>'
      + '<label class="rs-lbl ft-note">备注<input type="text" id="slNote" maxlength="40" placeholder="可选"></label>'
      + '<p class="hint">忘了记也没关系，漏记不会清零，回来补上就行。</p>'
      + '<div class="rs-savebar"><button type="button" class="btn btn-primary ft-save" data-save>保存</button></div>';
    ui.openSheet('sleep', '补记睡眠', body, function (api) {
      var box = api.box, inp = box.querySelector('#slWk');
      Array.prototype.forEach.call(box.querySelectorAll('[data-d]'), function (b) {
        b.addEventListener('click', function () { inp.value = Math.max(0, Math.min(30, (parseInt(inp.value, 10) || 0) + Number(b.getAttribute('data-d')))); });
      });
      function save() {
        var st = ui.readWhen(box, 's'), en = ui.readWhen(box, 'e');
        if (!isFinite(st) || !isFinite(en)) { Util.toast('请选好入睡和醒来时间', 'warn'); return; }
        if (!(en > st)) { Util.toast('醒来时间要晚于入睡时间', 'warn'); return; }
        if (en > Date.now() + 60000) { Util.toast('醒来时间不能晚于现在', 'warn'); return; }
        if (en - st > 24 * 3600000) { Util.toast('一觉超过 24 小时了，检查一下日期', 'warn'); return; }
        var wk = Math.max(0, Math.min(30, parseInt(inp.value, 10) || 0));
        var note = (box.querySelector('#slNote').value || '').trim().slice(0, 40);
        var rec = { id: Util.uid(), start: loc(st), end: loc(en), pausedMs: 0, note: note || null, wakings: wk, longestMin: null };
        rec.longestMin = Math.max(0, Math.round(durMs(rec) / 60000 / (wk + 1)));
        var dd = Storage.get(); dd.sleeps.push(rec);
        if (Storage.save()) Util.toast('已补记这一觉 ' + fmtMin(durMs(rec) / 60000), 'ok');
        api.close(); global.App.rerender();
      }
      box.querySelector('[data-save]').addEventListener('click', save);
      var hok = box.parentNode.parentNode.querySelector('.rs-head > [data-ok]'); if (hok) hok.addEventListener('click', save);
    });
  }

  Modules.sleep = {
    id: 'sleep',
    title: '睡眠',
    render: function (view) {
      var d = Storage.get();
      var os = openSleep();
      var ui = UI();
      var DS = Util.dayStartHour(d), dayNow = Util.dayKeyOf(new Date(), DS), nowMs = Date.now();
      var done = (d.sleeps || []).filter(function (x) { return x && x.start && x.end && isFinite(tms(x.start)) && isFinite(tms(x.end)); })
        .sort(function (a, b) { return tms(b.start) - tms(a.start); });
      var html = '';

      /* 摘要：今天已结束的睡眠 + 最近一段 + 上次（参考图原句） */
      /* 第 274 次（审计 #23）：跨午夜的觉按照护日切开，只算落在今天的那部分（Util.daySleep，与日历、首页同口径） */
      var todayAgg = Util.daySleep(done, dayNow, DS);
      var todayDone = todayAgg.n ? [1] : [];
      var todayMin = Math.round(todayAgg.min);
      var last = done.slice().sort(function (a, b) { return tms(b.end) - tms(a.end); })[0];
      var sum = '';
      if (os) {
        var so = osState(os, nowMs);
        sum += '宝宝<b>睡着了</b>，' + hm(tms(os.start)) + ' 入睡，已睡 <b data-sl-sum>' + esc(fmtMin(so.el / 60000)) + '</b>' + (so.isPaused ? '（已暂停）' : '') + '。';
      }
      if (todayDone.length) sum += '今天已结束的睡眠共 <b>' + esc(fmtMin(todayMin)) + '</b>。';
      else if (!os) sum += '今天还没有<b>睡眠</b>记录。';
      if (last) {
        var le = new Date(tms(last.end));
        sum += '最近一段睡了 <b>' + esc(fmtMin(durMs(last) / 60000)) + '</b>，结束于 <b>' + esc(Util.fmtDayHM(le)) + '</b>。' /* 第 272 次：今天 / 昨天用相对写法，不再写满年月日 */
          + '<span class="ms-ago">上次：' + esc(Util.fmtAgo(last.end).replace(/\s/g, '')) + '</span>';
      }
      html += '<div class="mod-sum ft-sum"><span class="ms-k">摘要</span><p>' + sum + '</p></div>';

      /* 洞察 ① 今日睡眠（第 223 次看板原样搬进来）：按照护日切，跨日的觉只算落在今天的部分，进行中的觉算到现在 */
      var ins = [];
      if (global.DayChart && (done.length || os)) {
        var segs = done.map(function (x) {
          var a = tms(x.start), b = tms(x.end);
          return { s: a, e: b, k: (b > a) ? Math.max(0, Math.min(1, durMs(x) / (b - a))) : 0 };
        });
        if (os) {
          var oa = tms(os.start), op = osState(os, nowMs).paused;
          if (nowMs > oa) segs.push({ s: oa, e: nowMs, k: Math.max(0, Math.min(1, (nowMs - oa - op) / (nowMs - oa))), live: true });
        }
        var minIn = function (w) {
          var tot = 0, n = 0, lon = 0;
          segs.forEach(function (g) {
            var m = DayChart.overlapMin(g.s, g.e, w[0], w[1]) * g.k;
            if (m > 0) { tot += m; n++; if (m > lon) lon = m; }
          });
          return { tot: tot, n: n, lon: lon };
        };
        var sWin = DayChart.windowOf(dayNow, DS), st0 = minIn(sWin);
        var s7 = DayChart.lastDays(dayNow, 7).map(function (k) {
          var m = minIn(DayChart.windowOf(k, DS)).tot;
          return { key: k, v: Math.round(m), txt: m ? (Math.round(m / 6) / 10) + 'h' : '' };
        });
        var dh = '<div class="dash-card sl-dash" data-accent="sleep"><h2>今日睡眠</h2>';
        dh += '<div class="dash-big"><span class="dash-num">' + (st0.tot >= 1 ? DayChart.bigMin(st0.tot) : '0<i>分</i>') + '</span>'
          + '<span class="dash-lbl">' + (os ? '今天已睡（含正在睡的这一觉）' : '今天已睡') + '</span></div>';
        if (st0.n) dh += '<div class="dash-chips"><span><b>' + st0.n + '</b> 觉</span><span>最长 <b>' + esc(DayChart.fmtMin(st0.lon)) + '</b></span></div>';
        dh += DayChart.strip({ win: sWin, ds: DS, now: nowMs, label: '今天的睡眠时段',
          spans: segs.map(function (g) { return { s: g.s, e: g.e, cls: g.live ? 'live' : '' }; }) });
        if (s7.filter(function (x) { return x.v; }).length >= 2) dh += '<p class="dash-sub">近 7 天每天睡眠</p>' + DayChart.bars(s7, dayNow, '近 7 天每天睡眠时长');
        dh += '</div>';
        ins.push({ ico: icon('sleep'), t: '睡眠', html: dh });
      }

      /* 洞察 ② 作息（第 106 次：昨晚合计 / 清醒间隔；U-24 近 7 天最长连续）——只和自己比 */
      var zh = '';
      var ln = Modules.sleep._lastNightTotal(d.sleeps);
      if (ln.segs > 0) zh += '<p class="hint"><b>昨晚共睡了约 ' + fmtH(ln.minutes / 60) + ' 小时</b>（' + ln.segs + ' 段）。凌晨入睡的那几段也算进昨晚。</p>';
      var wgs = Modules.sleep._wakeGapSummary(d.sleeps, 7);
      if (wgs) zh += '<p class="hint">近 ' + wgs.days + ' 天，清醒间隔（醒到下次入睡）在 ' + fmtH(wgs.min / 60) + '–' + fmtH(wgs.max / 60) + ' 小时之间，中间那档约 ' + fmtH(wgs.median / 60) + ' 小时。</p>';
      var cut7 = nowMs - 7 * 864e5;
      var vals = done.filter(function (s) { return tms(s.end) >= cut7; }).map(function (s) { return longestMin(s); }).filter(function (v) { return v > 0; });
      if (vals.length >= 2) zh += '<p class="hint">近 7 天最长连续睡眠在 ' + fmtH(Math.min.apply(null, vals) / 60) + '–' + fmtH(Math.max.apply(null, vals) / 60) + ' 小时之间。</p>';
      if (zh) ins.push({ ico: icon('routine'), t: '作息', html: '<h2>作息</h2>' + zh + '<p class="hint">都是你自己的记录，和宝宝自己比就好。</p>' });

      /* 洞察 ③ 睡眠参考（第 73 次：清醒窗口 / 猛长期，教育性科普，不与数据对照） */
      var sBd = (d.settings.baby && d.settings.baby.birthDate) || null;
      if (sBd && global.Knowledge) {
        var sAge = Util.daysBetween(sBd, Util.todayISO());
        if (sAge >= 0 && sAge <= 1095) {
          var slRef = Knowledge.all('sleep').filter(function (e) { return sAge >= e.from && sAge <= e.to; });
          if (slRef.length) {
            ins.push({ ico: icon('sources'), t: '睡眠参考', html: '<h2>睡眠参考</h2>' + slRef.map(function (e) { return '<p class="hint">' + esc(e.text) + '</p>'; }).join('')
              + '<p class="hint">以上是哄睡时机的参考，不是你家宝宝要达到的标准——他的节奏说了算。</p>' });
          }
        }
      }
      if (ins.length && ui) html += ui.insightChips(ins);

      /* 最近记录：竖向时间轴（点卡片修改，左滑 / 垃圾桶删除可撤销） */
      if (done.length) {
        html += '<section class="mod-tl ft-tl"><p class="ms-k">最近记录</p><ul class="tl">';
        done.slice(0, 30).forEach(function (r) {
          var t = tms(r.start), dt = new Date(t);
          var parts = [fmtMin(durMs(r) / 60000)];
          if (r.wakings) parts.push('醒来 ' + r.wakings + ' 次');
          var sub = r.note ? r.note : '';
          html += '<li class="tl-row tl-f-sleep"><span class="tl-time ft-tlt"><small>' + (dt.getMonth() + 1) + '/' + dt.getDate() + '</small>' + hm(t) + '</span><span class="tl-dot" aria-hidden="true"></span>'
            + '<button type="button" class="tl-card" data-open="' + esc(r.id) + '" aria-label="' + hm(t) + ' 入睡，点按修改">'
            + '<span class="tl-ico">' + icon('sleep') + '</span><span class="tl-txt"><b>' + esc(parts.join(' · ')) + '</b>'
            + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span>'
            + '<span class="tl-more" aria-hidden="true">' + ((ui && ui.SV.more) || '') + '</span></button>'
            + '<button type="button" class="tl-del" data-del="' + esc(r.id) + '" aria-label="删除" title="删除">' + icon('trash') + '</button></li>';
        });
        html += '</ul></section>';
      } else if (!os) {
        html += '<div class="mod-empty"><p>宝宝睡着了点「开始睡眠」，醒了再结束。<br>已经睡醒才想起来？点右边的 ⊕ 补记。</p></div>';
      }

      /* 底部：睡眠中 → 迷你条；否则「▷ 开始睡眠 | ⊕」 */
      var sv = (ui && ui.SV) || {};
      if (os) {
        var sm = osState(os, nowMs);
        html += '<div class="mod-cta ft-cta"><div class="ft-mini" data-accent="sleep">'
          + '<button type="button" class="ft-mini-open" data-slm="open" aria-label="打开睡眠计时">' + icon('sleep')
          + '<b data-sl-mini>' + clock(sm.el) + '</b></button>'
          + '<span class="ft-mini-side">' + (sm.isPaused ? '已暂停' : '睡眠中') + '</span>'
          + '<button type="button" class="ft-mini-b" data-slm="pause" aria-label="' + (sm.isPaused ? '继续' : '暂停') + '">' + (sm.isPaused ? (sv.play || '') : (sv.pause || '')) + '</button>'
          + '<button type="button" class="ft-mini-end" data-slm="end">醒了</button></div></div>';
      } else {
        html += '<div class="mod-cta ft-cta"><div class="ft-split" data-accent="sleep">'
          + '<button type="button" class="ft-split-main" id="sStart" data-start>' + (sv.play || '') + '<span>开始睡眠</span></button>'
          + '<button type="button" class="ft-split-add" data-manual aria-label="补记一觉">' + (sv.plusc || '') + '</button></div></div>';
      }
      view.innerHTML = '<div class="ft-page" data-accent="sleep">' + html + '</div>';

      if (ui) ui.bindChips(view);
      Array.prototype.forEach.call(view.querySelectorAll('[data-open]'), function (b) {
        b.addEventListener('click', function () {
          var it = d.sleeps.filter(function (x) { return x.id === b.getAttribute('data-open'); })[0];
          if (it && global.RecordEdit) RecordEdit.open('sleep', it, d.sleeps);
        });
      });
      Array.prototype.forEach.call(view.querySelectorAll('[data-del]'), function (b) {
        b.addEventListener('click', function () {
          Util.removeWithUndo(d.sleeps, b.getAttribute('data-del'), {
            onSave: function () { Storage.save(); },
            onAfter: function () { global.App.rerender(); },
            deletedText: '已删除睡眠记录'
          });
        });
      });
      var sb = view.querySelector('[data-start]');
      if (sb) sb.addEventListener('click', function () { startSleep(); if (Util.haptic) Util.haptic('ok'); global.App.rerender(); openFull(); });
      var mb = view.querySelector('[data-manual]');
      if (mb) mb.addEventListener('click', openManual);
      Array.prototype.forEach.call(view.querySelectorAll('[data-slm]'), function (b) {
        b.addEventListener('click', function () {
          var k = b.getAttribute('data-slm');
          if (k === 'open') openFull();
          else if (k === 'pause') { togglePause(); global.App.rerender(); }
          else if (k === 'end') { if (endSleep(Date.now())) { closeFull(); global.App.rerender(); } }
        });
      });
      if (os && fullEl) paintFull();
      if (!os && fullEl) closeFull();
    },
    _openFull: openFull,
    _manual: openManual, /* 第 286 次：日期页快捷条 */
    _closeFull: closeFull,
    _start: startSleep,
    _end: endSleep,
    _pause: togglePause
  };

  /* 暴露给首页：最近一觉的最长连续分钟数（U-17 首页主指标用） */
  Modules.sleep._longestMin = longestMin;

  /* ============================================================
     第 106 次 · GAP-01 睡眠跨夜归属 + CN-03 清醒间隔统计
     ------------------------------------------------------------
     两者都是【纯读取计算】：不改 storage.js、不改 DATA_VERSION、
     不新增任何落库字段、不迁移旧数据。全部从既有 sleeps[] 派生。

     GAP-01 的问题不是「数据缺失」而是【口径错位】：
     durMs() 已正确算出扣除暂停后的真实时长（sleep.js:21-26），
     但「这一觉算哪一天」用的是日历日语义 —— 01:30 入睡的觉被算成
     「1 月 2 日」那天，于是「昨晚睡了多久」这个问题在凌晨问时拿到的是
     一个空值/错值。家长真正的直觉是：凌晨 1 点睡的那觉，属于**前一夜**。

     口径（对齐 BabyTrack 官方「Sleep that starts before 6am counts
     toward the night before」）：入睡时刻早于 06:00 的睡眠，归到**前一日**。
     06:00 是刻意选的折中点——比它更早（如 03:00）几乎必然是夜觉，
     而 06:00–07:00 已是晨觉边界；这个阈值只影响【归属到哪天】，
     绝不影响【时长本身】。

     U-19 边界：不因为归属变了就出「睡眠效率」「深睡比例」等结论，
     只做「哪一夜的睡眠合计」这一个中性统计。
     U-24 / U-25：参照只与用户自身历史比，不出「该不该睡这么久」。
     ============================================================ */

  /* 跨夜归属：返回该条睡眠应当归属的「夜」的日期键（yyyy-mm-dd）。
     规则：入睡本地时刻早于 06:00 → 归前一日，否则归当日。
     纯函数，不依赖当前时间，便于单测覆盖。 */
  function nightKeyOf(s) {
    if (!s || !s.start) return null;
    var st = new Date(s.start);
    if (isNaN(st.getTime())) return null;
    var iso = Util.fmtDate(s.start);
    /* getHours() 是本地小时，正是家长直觉里的「几点睡的」 */
    return st.getHours() < 6 ? Util.addDays(iso, -1) : iso;
  }

  /* 「昨夜」= 归属到前一夜的那一组。
     基准恒为「昨天」这一夜，与当前时刻无关 —— 因为 nightKeyOf 已把
     凌晨 1 点入睡的觉归到前一日：
       · 下午 14:00 查 → 昨晚 22:00→今晨 6:00 的那几段（nightKey = 昨天）✓
       · 凌晨 03:00 查 → 同一批（还没结束的不会被算进来，因为 sleeps[] 只存已结束的）✓
       · 深夜 23:00 查 → 仍是昨天那批（不是刚开始的今批）✓
     所以这里不需要按时刻分情况。06:00 阈值只作用在 nightKeyOf（决定单条睡眠归属哪天），
     不用在这里再判一次 —— 那是两件事，混在一起写就会出现两套日期口径。 */
  function lastNightRecords(sleeps, refDate) {
    var now = refDate ? new Date(refDate) : new Date();
    var base = Util.addDays(Util.fmtDate(now), -1);
    return (sleeps || []).filter(function (s) {
      return s && s.end && nightKeyOf(s) === base;
    }).sort(function (a, b) { return new Date(a.start) - new Date(b.start); });
  }

  /* 昨夜的合计睡眠分钟数与段数（不含任何「该睡多久」的参照） */
  function lastNightTotal(sleeps, refDate) {
    var recs = lastNightRecords(sleeps, refDate);
    var ms = 0;
    recs.forEach(function (s) { ms += durMs(s); });
    return { minutes: Math.max(0, Math.round(ms / 60000)), segs: recs.length, records: recs };
  }

  /* ============================================================
     CN-03 清醒间隔统计
     ------------------------------------------------------------
     数据基础已有（WAKE_WINDOWS，sleep.js:230-240），但那只是【按月龄给
     一个哄睡时机参考】，完全没有统计用户自己实际清醒了多久。

     清醒间隔 = 相邻两觉之间的醒来时刻到下一觉入睡时刻。
     注意口径细节：
       · 只统计【已结束】且相邻的两觉，中断的计时（openSleep）不参与；
       · 同一夜内的间隔归到同一个「夜」，跨夜的间隔单独归到后一夜
         （用 nightKeyOf 保证与 GAP-01 同一套归属，不出现两套日期口径）；
       · 间隔为负（补记时录入错乱）或为 0 不计入，避免污染统计。
     只出统计数字与用户自身区间，不与人群参照对比（U-25）。
     ============================================================ */
  function wakeGaps(sleeps, opts) {
    opts = opts || {};
    /* 第 125 次：原 `opts.days || 7` 会把调用方显式传入的 0 吞成 7。
       下方 `if (days > 0 ...)` 分支说明「传 0 = 不限天数」是本接口本意，
       与 `|| 7` 直接冲突（0 被改写后就永远不会走那条分支）。
       改用显式 null 判断，只在「未传」时套默认 7。 */
    var days = (opts.days == null) ? 7 : opts.days;
    var done = (sleeps || []).filter(function (s) { return s && s.start && s.end; })
      .sort(function (a, b) { return new Date(a.start) - new Date(b.start); });
    var out = [];
    for (var i = 1; i < done.length; i++) {
      var prev = done[i - 1], cur = done[i];
      /* 清醒起点 = 上一觉醒来；清醒终点 = 下一觉入睡 */
      var gapMin = Math.round((new Date(cur.start) - new Date(prev.end)) / 60000);
      if (!(gapMin > 0)) continue;             /* 负数=补记错乱，0=连续，不计 */
      /* 归属夜：用「醒来那一刻」所属的夜，也就是上一觉的夜 */
      var nk = nightKeyOf(prev);
      if (!nk) continue;
      out.push({ minutes: gapMin, night: nk, fromEnd: prev.end, toStart: cur.start });
    }
    if (days > 0 && out.length) {
      var cut = Util.addDays(Util.todayISO(), -(days - 1));
      out = out.filter(function (g) { return g.night >= cut; });
    }
    return out;
  }

  /* 清醒间隔的自身历史区间（U-24：只用近 N 天自己的数据） */
  function wakeGapSummary(sleeps, days) {
    /* 第 125 次：同上，`days || 7` 吞 0；显式判断只在未传时兜底。 */
    var ds = (days == null) ? 7 : days;
    var gs = wakeGaps(sleeps, { days: ds });
    if (!gs.length) return null;
    var vs = gs.map(function (g) { return g.minutes; }).sort(function (a, b) { return a - b; });
    return {
      count: vs.length,
      min: vs[0],
      max: vs[vs.length - 1],
      median: vs[Math.floor((vs.length - 1) / 2)],
      days: ds
    };
  }

  /* 对外暴露（供单测与后续页面复用；均为纯函数，不写库） */
  Modules.sleep._nightKeyOf = nightKeyOf;
  Modules.sleep._lastNightRecords = lastNightRecords;
  Modules.sleep._lastNightTotal = lastNightTotal;
  Modules.sleep._wakeGaps = wakeGaps;
  Modules.sleep._wakeGapSummary = wakeGapSummary;

  /* 第 85 次（C2 磁贴副文案）：清醒窗口数值表——与 knowledge.js KN-S-1~6 同区间
     同源（AAP 共识的多源近似值），这里只出紧凑数字串给首页磁贴一行带过；
     完整措辞与困意信号仍由 sleep 页「睡眠参考」卡呈现。展示时一律带
     「参考」二字（home.js 拼接），不做达标判断、不与用户数据对照（U-25）。 */
  var WAKE_WINDOWS = [
    [0, 90, '1–1.5 小时'], [91, 180, '1.5–2.5 小时'], [181, 270, '2.5–3 小时'],
    [271, 365, '3–4 小时'], [366, 540, '4–5 小时'], [541, 1095, '4–6 小时']
  ];
  Modules.sleep._wakeWindow = function (ageDays) {
    if (ageDays == null || ageDays < 0) return null;
    for (var w = 0; w < WAKE_WINDOWS.length; w++) {
      if (ageDays >= WAKE_WINDOWS[w][0] && ageDays <= WAKE_WINDOWS[w][1]) return WAKE_WINDOWS[w][2];
    }
    return null; /* 满 3 岁后个体差异太大，不再给参考 */
  };

  /* 迷你条 / 摘要的秒表（全屏开着时由 tickFull 负责） */
  setInterval(function () { if (!fullTick) tickFull(); }, 1000);
})(window);
