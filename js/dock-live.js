/**
 * dock-live.js — 底栏上方的「正在进行」胶囊（第 236 次）
 *
 * 以前只有白噪音在底栏里有「正在播放」，其他计时（睡眠、亲喂、瓶喂、宫缩、
 * 数胎动、洗澡/游泳/日晒）只在首页「此刻」条里出现，进了别的页面就看不到。
 * 现在统一收进一颗玻璃胶囊，浮在 dock 正上方，任何页面都在：
 *   - 点胶囊主体 → 进对应页面（亲喂会直接展开全屏计时）
 *   - 右侧一个就近动作：睡眠「醒了」、亲喂「暂停/继续」、白噪音「暂停/停止」，
 *     其余是「›」进页面结束（结束要填量/确认的，不在胶囊里一键做掉）
 *   - 同时有几项在跑时，最左显示「1/3」，点它轮换
 *   - 已经在那个页面里，就不再重复显示那一项
 */
(function (global) {
  'use strict';
  var doc = global.document;
  if (!doc) return;
  var DL = {};
  var el = null, idx = 0, tick = 0;

  function ms(s) { return new Date(s).getTime(); }
  function clock(t) {
    t = Math.max(0, Math.floor(t / 1000));
    var h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60;
    return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }
  function openMs(os) {
    var paused = (os.pausedMs || 0) + (os.pauseStart ? Date.now() - os.pauseStart : 0);
    return Math.max(0, Date.now() - ms(os.start) - paused);
  }
  function ic(n) { return global.icon ? icon(n) : ''; }
  function esc(s) { return global.Util && Util.escapeHtml ? Util.escapeHtml(String(s)) : String(s); }

  /* 所有在跑的计时，按「最需要随手操作」排序 */
  DL.runs = function () {
    var d; try { d = Storage.get(); } catch (e) { return []; }
    if (!d) return [];
    var out = [], M = global.Modules || {};
    var wn = d.whitenoise;
    if (wn && (wn.playing || wn.paused) && M.whitenoise) {
      var rm = M.whitenoise._remainingMin ? M.whitenoise._remainingMin() : null;
      out.push({ k: 'whitenoise', go: 'whitenoise', ico: 'noise',
        label: M.whitenoise._typeName ? M.whitenoise._typeName(wn.type) : '哄睡声音',
        val: function () { var r = M.whitenoise._remainingMin ? M.whitenoise._remainingMin() : null; return (wn.paused ? '已暂停 · ' : '') + (r != null ? '剩 ' + r + ' 分' : '不限时'); },
        state: wn.paused ? 'paused' : 'on',
        acts: [{ k: 'wn-pp', ico: wn.paused ? 'play' : 'pause', label: wn.paused ? '继续播放' : '暂停' }, { k: 'wn-stop', ico: 'close', label: '停止' }] });
      void rm;
    }
    if (d.openSleep && d.openSleep.start) {
      var os = d.openSleep;
      out.push({ k: 'sleep', go: 'sleep', ico: 'sleep', label: os.pauseStart ? '睡眠 · 暂停' : '睡眠中',
        val: function () { return clock(openMs(Storage.get().openSleep || os)); }, state: os.pauseStart ? 'paused' : 'on',
        acts: [{ k: 'sleep-end', text: '醒了', label: '醒了，结束睡眠' }] });
    }
    if (d.feedingTimer && d.feedingTimer.start && M.breast && M.breast._state) {
      var s0 = M.breast._state(d.feedingTimer, Date.now());
      out.push({ k: 'breast', go: 'breast', ico: 'breast', label: s0.paused ? '亲喂 · 暂停' : (s0.side === 'left' ? '亲喂 · 左侧' : '亲喂 · 右侧'),
        val: function () { var t = Storage.get().feedingTimer; return t ? clock(M.breast._state(t, Date.now()).T) : ''; },
        state: s0.paused ? 'paused' : 'on',
        acts: [{ k: 'breast-pp', ico: s0.paused ? 'play' : 'pause', label: s0.paused ? '继续' : '暂停' }] });
    }
    if (d.pumpTimer && d.pumpTimer.start && M.pump && M.pump._state) {
      var pt = d.pumpTimer, prun = !pt.paused && (pt.L || pt.R);
      out.push({ k: 'pump', go: 'pump', ico: 'pump', label: prun ? ((pt.L && pt.R) ? '双侧泵奶' : (pt.L ? '泵奶 · 左侧' : '泵奶 · 右侧')) : '泵奶 · 暂停',
        val: function () { var t = Storage.get().pumpTimer; return t ? clock(M.pump._state(t, Date.now()).T) : ''; },
        state: prun ? 'on' : 'paused',
        acts: [{ k: 'pump-pp', ico: prun ? 'pause' : 'play', label: prun ? '暂停' : '继续' }] });
    }
    if (d.bottleTimer && d.bottleTimer.start) {
      out.push({ k: 'bottle', go: 'bottle', ico: 'feeding', label: '瓶喂中',
        val: function () { var t = Storage.get().bottleTimer; return t ? clock(Date.now() - ms(t.start)) : ''; }, state: 'on', acts: [] });
    }
    if (d.openContraction && d.openContraction.start) {
      out.push({ k: 'contraction', go: 'contraction', ico: 'contraction', label: '宫缩中',
        val: function () { var t = Storage.get().openContraction; return t ? clock(Date.now() - ms(t.start)) : ''; }, state: 'on', acts: [] });
    }
    if (d.fetalSession && d.fetalSession.start) {
      var fs = d.fetalSession;
      var n = (d.fetal || []).filter(function (r) { return r.time >= fs.start; }).length;
      out.push({ k: 'fetal', go: 'fetal', ico: 'fetal', label: '数胎动 · ' + n + ' 次',
        val: function () { var t = Storage.get().fetalSession; return t ? clock(Date.now() - ms(t.start)) : ''; }, state: 'on', acts: [] });
    }
    if (d.openCare && d.openCare.start) {
      var CK = { bath: '洗澡中', swim: '游泳中', sun: '日晒中' }[d.openCare.kind];
      if (CK) out.push({ k: 'care', go: d.openCare.kind, ico: d.openCare.kind, label: CK,
        val: function () { var t = Storage.get().openCare; return t ? clock(Date.now() - ms(t.start)) : ''; }, state: 'on', acts: [] });
    }
    return out;
  };

  function current() { try { return global.App && App.currentTab ? App.currentTab() : ''; } catch (e) { return ''; } }
  function visibleRuns() {
    var cur = current();
    return DL.runs().filter(function (r) { return r.go !== cur; });
  }

  function doAct(k) {
    var M = global.Modules || {}, d = Storage.get();
    if (k === 'wn-pp') {
      var wn = d.whitenoise;
      if (wn && wn.paused) { if (M.whitenoise._resume) M.whitenoise._resume(); }
      else if (M.whitenoise._pause) M.whitenoise._pause();
    } else if (k === 'wn-stop') {
      if (M.whitenoise._stop) M.whitenoise._stop();
      Util.toast('哄睡声音已停止', 'ok');
    } else if (k === 'breast-pp') {
      if (M.breast._act) M.breast._act('pause');
    } else if (k === 'pump-pp') {
      if (M.pump && M.pump._act) M.pump._act('pause');
    } else if (k === 'sleep-end') {
      var os = d.openSleep;
      if (!os || !os.start) return;
      /* 第 241 次：和睡眠页同一个出口（带上全屏里记的醒来次数） */
      if (M.sleep && M.sleep._end) { M.sleep._end(Date.now()); if (M.sleep._closeFull) M.sleep._closeFull(); }
    }
    if (Util.haptic) Util.haptic('ok');
    if (global.App && App.rerender) App.rerender(); else DL.render();
  }

  function open(r) {
    var M = global.Modules || {};
    if (r.k === 'whitenoise' && M.whitenoise) M.whitenoise._open = true;
    if (global.App) App.showTab(r.go);
    if (r.k === 'breast' && M.breast && M.breast._openFull) setTimeout(function () { M.breast._openFull(); }, 0);
    if (r.k === 'pump' && M.pump && M.pump._openFull) setTimeout(function () { M.pump._openFull(); }, 0);
    if (r.k === 'sleep' && M.sleep && M.sleep._openFull) setTimeout(function () { M.sleep._openFull(); }, 0);
  }

  function ensure() {
    if (el && el.isConnected) return el;
    el = doc.createElement('div');
    el.id = 'dockLive'; el.className = 'dock-live';
    el.setAttribute('role', 'region'); el.setAttribute('aria-label', '正在进行');
    doc.body.appendChild(el);
    return el;
  }

  DL.render = function () {
    var runs = visibleRuns();
    var box = ensure();
    if (!runs.length) {
      box.hidden = true; box.innerHTML = ''; box._run = null; box._keys = '';
      doc.body.classList.remove('has-live');
      return;
    }
    if (idx >= runs.length) idx = 0;
    var r = runs[idx];
    box.hidden = false;
    doc.body.classList.add('has-live');
    box.setAttribute('data-accent', r.go);
    box.className = 'dock-live' + (r.state === 'paused' ? ' is-paused' : '');
    var art = '';
    if (r.k === 'whitenoise') {
      var wn = Storage.get().whitenoise || {};
      art = '<span class="dl-art" style="background-image:url(img/noise/' + esc(wn.type || 'white') + '.jpg)"></span>';
    }
    var h = (runs.length > 1 ? '<button type="button" class="dl-cycle" aria-label="下一项（共 ' + runs.length + ' 项进行中）"><b>' + (idx + 1) + '</b>/' + runs.length + '</button>' : '')
      + '<button type="button" class="dl-main" aria-label="' + esc(r.label) + '，打开">'
      + '<span class="dl-ico">' + (art || ic(r.ico)) + '<i class="dl-pulse" aria-hidden="true"></i></span>'
      + '<span class="dl-txt"><span class="dl-lbl">' + esc(r.label) + '</span><b class="dl-val" role="timer" aria-live="off">' + esc(r.val()) + '</b></span></button>';
    if (r.acts.length) {
      r.acts.forEach(function (a) {
        h += '<button type="button" class="dl-act' + (a.text ? ' dl-act-txt' : '') + '" data-act="' + a.k + '" aria-label="' + esc(a.label) + '">'
          + (a.text ? esc(a.text) : ic(a.ico)) + '</button>';
      });
    } else {
      h += '<button type="button" class="dl-act dl-go" aria-label="打开' + esc(r.label) + '">' + ic('chevron') + '</button>';
    }
    box.innerHTML = h;
    box.querySelector('.dl-main').addEventListener('click', function () { open(r); });
    var cy = box.querySelector('.dl-cycle');
    if (cy) cy.addEventListener('click', function () { idx = (idx + 1) % runs.length; DL.render(); });
    Array.prototype.forEach.call(box.querySelectorAll('[data-act]'), function (b) {
      b.addEventListener('click', function () { doAct(b.getAttribute('data-act')); });
    });
    var go = box.querySelector('.dl-go');
    if (go) go.addEventListener('click', function () { open(r); });
    box._run = r;
    box._keys = runs.map(function (x) { return x.k + (x.state || ''); }).join(',');
    if (!tick) tick = setInterval(function () {
      if (!el) return;
      var ks = visibleRuns().map(function (x) { return x.k + (x.state || ''); }).join(',');
      if (ks !== el._keys) { DL.render(); return; }
      if (el.hidden || !el._run) return;
      var v = el.querySelector('.dl-val'); if (v) v.textContent = el._run.val();
    }, 1000);
  };

  global.DockLive = DL;
})(window);
