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
 *   - 第 291 次起每个页面都显示（包括那一项自己的页）；只有全屏播放页 / 面板盖住时临时藏起
 *
 * 第 277 次：胶囊接进 dock 的同一套折射（DockRefract.surface('live')）：直接画在 dock 那块 WebGL 画布里
 *   （画布扩到 dock ∪ 胶囊的外接矩形，两块玻璃同一个距离场），不另起上下文、不拷贝。
 *   折射开着时胶囊自身不再整块 backdrop-filter（否则会把折射边再糊一遍），改由内圈 .dl-glass 负责中间的实时模糊。
 *   - 出现：从 dock 顶边中间冒出一滴小胶囊（56×26），上升、先长高再拉宽，内容后半程淡入；
 *     DOM 用 clip-path（圆角 inset）+ translateY 给出当前形状，同一形状逐帧交给 DockRefract.shape，
 *     前 30%~80% 两块玻璃的距离场 smooth-min 融合（颈部变细后断开）。
 *   - 消失：克隆一个替身（inert、aria-hidden、不可点）倒放这段动画缩回 dock，原胶囊立刻 hidden（状态与读屏不等动画）。
 *   - 改尺寸（换一项 / 文字变长变短）：宽度从旧值过渡到新值（FLIP），折射形状跟着逐帧插值。
 *   - 按下：胶囊轻微放大（scale 1.02）、边缘折射增强（DockRefract.press）。
 *   减少动态效果 / 左右手竖排：不做形变，只淡入。
 */
(function (global) {
  'use strict';
  var doc = global.document;
  if (!doc) return;
  var DL = {};
  var el = null, idx = 0, tick = 0, morph = null, ghost = null, SLOW = 1;
  var reduced = false;
  try { reduced = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* */ }

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
        /* 第 291 次：「已暂停」挪到上面一行（和睡眠「睡眠 · 暂停」同一写法）——大字号窄屏下数字一行放不下「已暂停 · 剩 20 分」，会顶到暂停键上 */
        label: (M.whitenoise._typeName ? M.whitenoise._typeName(wn.type) : '哄睡声音') + (wn.paused ? ' · 已暂停' : ''),
        val: function () { var r = M.whitenoise._remainingMin ? M.whitenoise._remainingMin() : null; return r != null ? '剩 ' + r + ' 分' : '不限时'; },
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

  /* 第 291 次（真机：「有些界面开着白噪音的胶囊显示不出来」）：以前进了那一项自己的页（白噪音页、睡眠页……）就把它从胶囊里拿掉，
     胶囊在这些页上整颗消失、还倒放一遍缩回 dock 的形变（和 dock 变二级态叠在一起像框塌了）。现在每个页面都显示，
     只有盖满全屏的层（白噪音播放页 wp-lock、＋ / 菜单面板 qd-open）在 CSS 里临时藏起来。 */
  function visibleRuns() { return DL.runs(); }

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
    /* 按下：轻微放大 + 边缘折射增强；松开回弹 */
    el.addEventListener('pointerdown', function () { if (reduced) return; el.classList.add('lg-press'); if (global.DockRefract) DockRefract.press('live', true); }, { passive: true });
    var up = function () { el.classList.remove('lg-press'); if (global.DockRefract) DockRefract.press('live', false); };
    global.addEventListener('pointerup', up, { passive: true });
    global.addEventListener('pointercancel', up, { passive: true });
    return el;
  }

  DL.render = function () {
    var runs = visibleRuns();
    var box = ensure();
    if (!runs.length) {
      if (!box.hidden && box.innerHTML) leave(box);
      box.hidden = true; box.innerHTML = ''; box._run = null; box._keys = ''; box._sig = '';
      doc.body.classList.remove('has-live');
      return;
    }
    if (idx >= runs.length) idx = 0;
    var r = runs[idx];
    var appearing = box.hidden || !box.innerHTML;
    box.hidden = false;
    doc.body.classList.add('has-live');
    box.setAttribute('data-accent', r.go);
    /* 第 291 次：每次换页 / 原地重画都会走到这里。以前整串重写 className 把 dl-shown（形变出现过、不再补播 CSS 入场动画）和 lg-band
       （折射边正在画）一起洗掉：每切一页胶囊都从透明重新弹一次、折射边先断再接——切页时胶囊「出不来」、框一闪一闪的根因。
       现在只增删 is-paused；内容没变（同一项、同样的文字和按钮）就不重写 innerHTML，只更新计时数字。 */
    box.classList.toggle('is-paused', r.state === 'paused');
    var sig = runs.length + '|' + idx + '|' + r.k + '|' + r.label + '|' + (r.state || '') + '|' + r.acts.map(function (a) { return a.k + ':' + (a.ico || a.text || ''); }).join(',')
      + (r.k === 'whitenoise' ? '|' + ((Storage.get().whitenoise || {}).type || '') : '');
    if (!appearing && box._sig === sig && box.querySelector('.dl-main')) {
      var v0 = box.querySelector('.dl-val'); if (v0) v0.textContent = r.val();
      box._run = r;
      box._keys = runs.map(function (x) { return x.k + (x.state || ''); }).join(',');
      return;
    }
    var oldW = appearing ? 0 : box.getBoundingClientRect().width;
    var art = '';
    if (r.k === 'whitenoise') {
      var wn = Storage.get().whitenoise || {};
      /* 第 271 次：原来指向不存在的 img/noise/*.jpg，胶囊里的封面一直是空的灰圈（IMG_4662） */
      var artUrl = global.Modules && Modules.whitenoise && Modules.whitenoise._art ? Modules.whitenoise._art(String(wn.type || 'white').replace(/[^a-z]/g, '')) : '';
      art = '<span class="dl-art" style="background-image:url(' + esc(artUrl) + ')"></span>';
    }
    /* 第 277 次：.dl-glass 是折射开着时的「内圈毛玻璃」——外圈一圈由 dock 的 WebGL 画布画折射边（.lg-band），中间仍是实时模糊 */
    var h = '<i class="dl-glass" aria-hidden="true"></i>' + (runs.length > 1 ? '<button type="button" class="dl-cycle" aria-label="下一项（共 ' + runs.length + ' 项进行中）"><b>' + (idx + 1) + '</b>/' + runs.length + '</button>' : '')
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
    box._sig = sig;
    box._keys = runs.map(function (x) { return x.k + (x.state || ''); }).join(',');
    /* 第 277 次：玻璃面重新挂上（innerHTML 换掉了画布）+ 出现 / 改尺寸动画 */
    glass(box);
    if (appearing) appear(box);
    else if (!morph) resize(box, oldW);
    if (!tick) tick = setInterval(function () {
      if (!el) return;
      var ks = visibleRuns().map(function (x) { return x.k + (x.state || ''); }).join(',');
      if (ks !== el._keys) { DL.render(); return; }
      if (el.hidden || !el._run) return;
      var v = el.querySelector('.dl-val'); if (v) v.textContent = el._run.val();
    }, 1000);
  };

  /* ---------- 第 277 次：玻璃与形变 ---------- */
  function sideMode() { var c = doc.body.classList; return c.contains('dock-left') || c.contains('dock-right'); }
  function glass(box) {
    var DR = global.DockRefract;
    if (!DR || !DR.isOn || !box || box.hidden) return false;
    return DR.surface('live', box);
  }
  DL.syncGlass = function () { if (el && !el.hidden && el.innerHTML) glass(el); };
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function easeOutCubic(x) { return 1 - Math.pow(1 - x, 3); }
  function easeOutBack(x) { var c = 1.4; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); }
  function smooth(a, b, x) { var t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); }
  /* 进度 p（0→1）时胶囊的形状：从 dock 顶边中间的一滴（56×26）长成最终的胶囊 */
  function frameAt(p, R1, D) {
    var hP = easeOutBack(clamp01(p / 0.55)), wP = easeOutCubic(clamp01((p - 0.12) / 0.78)), yP = easeOutBack(clamp01(p / 0.8));
    var w = 56 + (R1.width - 56) * wP, h = 26 + (R1.height - 26) * Math.min(hP, 1.06);
    h = Math.min(h, R1.height); w = Math.min(w, R1.width);
    var cy0 = D.top + 4, cy1 = R1.top + R1.height / 2, cy = cy0 + (cy1 - cy0) * yP;
    /* 从 dock 的中线冒出来（dock 和胶囊不一定同中线：一级页左边还有宝宝圆钮），再横移到胶囊自己的位置 */
    var cx0 = D.left + D.width / 2, cx1 = R1.left + R1.width / 2, cx = cx0 + (cx1 - cx0) * easeOutCubic(clamp01(p / 0.7));
    return { w: w, h: h, tx: cx - cx1, ty: cy - cy1, iv: (R1.height - h) / 2, ih: (R1.width - w) / 2, k: 14 * (1 - smooth(0.25, 0.65, p)), fade: clamp01((p - 0.45) / 0.4) };
  }
  function applyFrame(node, f, R1, id) {
    node.style.transform = 'translateX(-50%) translate(' + f.tx.toFixed(2) + 'px,' + f.ty.toFixed(2) + 'px)';
    var rr = Math.min(f.w, f.h) / 2;
    node.style.clipPath = node.style.webkitClipPath = 'inset(' + f.iv.toFixed(2) + 'px ' + f.ih.toFixed(2) + 'px round ' + rr.toFixed(2) + 'px)';
    node.style.setProperty('--dl-fade', f.fade.toFixed(3));
    /* 内圈毛玻璃跟着当前形状走（外圈留给 WebGL 折射边） */
    var gi = Math.min(9, f.h * 0.3);
    node.style.setProperty('--dl-gv', (f.iv + gi).toFixed(2) + 'px'); node.style.setProperty('--dl-gh', (f.ih + gi).toFixed(2) + 'px');
    var DR = global.DockRefract;
    if (DR && DR.shape) DR.shape(id, { x: R1.left + f.tx + f.ih, y: R1.top + f.ty + f.iv, w: f.w, h: f.h }, f.k);
  }
  function clearFrame(node) {
    node.style.transform = ''; node.style.clipPath = ''; node.style.webkitClipPath = ''; node.style.removeProperty('--dl-fade');
    node.style.removeProperty('--dl-gv'); node.style.removeProperty('--dl-gh');
  }
  function appear(box) {
    if (ghost) { endGhost(); }
    var bar = doc.getElementById('tabbar');
    box.classList.remove('dl-shown');
    if (reduced || sideMode() || !bar || !box.animate) { box.classList.add('dl-fade'); setTimeout(function () { box.classList.remove('dl-fade'); }, 400); return; }
    if (morph) cancelAnimationFrame(morph.raf);
    /* dl-shown：形变走完后摘掉 dl-morph 时不让 CSS 入场动画 dl-in 再播一遍（会从透明再弹一次，折射边也会因「看不见」被关掉） */
    box.classList.add('dl-morph', 'dl-shown');
    var R1 = box.getBoundingClientRect(), D = bar.getBoundingClientRect();
    if (R1.width < 20 || D.width < 20) { box.classList.remove('dl-morph'); return; }
    var t0 = 0, dur = 620 * SLOW;
    morph = { raf: 0 };
    var step = function (t) {
      if (!t0) t0 = t;
      var p = clamp01((t - t0) / dur);
      applyFrame(box, frameAt(p, R1, D), R1, 'live');
      if (p < 1 && box.isConnected && !box.hidden) { morph.raf = requestAnimationFrame(step); return; }
      clearFrame(box); box.classList.remove('dl-morph'); morph = null;
      if (global.DockRefract && DockRefract.shape) { DockRefract.shape('live', null, 0); if (DockRefract.kick) DockRefract.kick(160); }
    };
    applyFrame(box, frameAt(0, R1, D), R1, 'live');
    morph.raf = requestAnimationFrame(step);
  }
  /* 消失：替身倒放缩回 dock；原胶囊已经 hidden */
  function leave(box) {
    var bar = doc.getElementById('tabbar');
    if (morph) { cancelAnimationFrame(morph.raf); morph = null; clearFrame(box); box.classList.remove('dl-morph'); }
    box.classList.remove('dl-shown');
    if (reduced || sideMode() || !bar || !box.animate) { if (global.DockRefract && DockRefract.unsurface) DockRefract.unsurface('live'); return; }
    var R1 = box.getBoundingClientRect(), D = bar.getBoundingClientRect();
    if (R1.width < 20) { if (global.DockRefract) DockRefract.unsurface('live'); return; }
    if (ghost) endGhost();
    var g = box.cloneNode(true);
    g.removeAttribute('id'); g.setAttribute('aria-hidden', 'true'); g.setAttribute('inert', '');
    g.classList.add('dl-ghost', 'dl-morph'); g.classList.remove('lg-press');
    Array.prototype.forEach.call(g.querySelectorAll('[id]'), function (n) { n.removeAttribute('id'); });
    doc.body.appendChild(g);
    var hasGlass = global.DockRefract && DockRefract.isOn && DockRefract.isOn() && DockRefract.surface('live', g);
    var t0 = 0, dur = 380 * SLOW;
    ghost = { el: g, raf: 0 };
    var step = function (t) {
      if (!ghost || ghost.el !== g) return;
      if (!t0) t0 = t;
      var q = clamp01((t - t0) / dur), p = 1 - easeOutCubic(q) * 0.999;
      var f = frameAt(p, R1, D); f.fade = clamp01((p - 0.55) / 0.3);
      applyFrame(g, f, R1, 'live');
      if (q < 1) { ghost.raf = requestAnimationFrame(step); return; }
      endGhost();
    };
    ghost.raf = requestAnimationFrame(step);
    void hasGlass;
  }
  function endGhost() {
    if (!ghost) return;
    cancelAnimationFrame(ghost.raf);
    var g = ghost.el; ghost = null;
    if (g.parentNode) g.parentNode.removeChild(g);
    var DR = global.DockRefract;
    if (DR && DR.unsurface) {
      if (el && !el.hidden && el.innerHTML) { DR.shape && DR.shape('live', null, 0); glass(el); }
      else DR.unsurface('live');
    }
  }
  /* 改尺寸：宽度从旧值过渡到新值，折射形状逐帧跟着 */
  function resize(box, oldW) {
    if (reduced || sideMode() || !oldW) return;
    var newW = box.getBoundingClientRect().width;
    if (Math.abs(newW - oldW) < 2) return;
    box.classList.add('dl-resizing');
    box.style.width = oldW + 'px';
    void box.offsetWidth;
    box.style.width = newW + 'px';
    if (global.DockRefract && DockRefract.kick) DockRefract.kick(420);
    clearTimeout(box._rzT);
    box._rzT = setTimeout(function () { box.style.width = ''; box.classList.remove('dl-resizing'); }, 380);
  }
  DL._slow = function (k) { SLOW = k || 1; };   /* 调试 / 截图：放慢形变 */
  DL._morphing = function () { return { morph: !!morph, ghost: !!ghost }; };

  global.DockLive = DL;
})(window);
