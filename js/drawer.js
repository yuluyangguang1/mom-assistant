/**
 * drawer.js —— 第 245 次：首页左侧功能抽屉（「全部功能」半页）
 *
 * 用户：把全部功能做成首页左拉的功能半页，dock 上的设置入口也移到这里（参考截图：
 * 顶部宝宝头像 + 小名 + 月龄 / 身高 / 体重，下面一组单色入口，再下面一列彩色功能）。
 *
 * 打开方式：
 *   ① 点 dock 左边的宝宝圆钮（左右手竖排时是胶囊里的头像）；
 *   ② 一级页（首页 / 日期记录 / 搜索）从屏幕左边缘向右拉，抽屉跟手出来。
 * 关闭：点右侧遮罩、向左拉、按 Esc、选了任意入口。
 * 宝宝切换：头像右边的 ⇅ 按钮（原来点圆钮直接弹的宝宝面板）。
 *
 * 第 246 次（用户录屏参考）：改成「整页向右推开」——页面变成圆角卡片滑到右边、微微变暗，
 * 抽屉在页面底下，带一点视差从左边滑出来。
 * 推 #app 之前先把它锁成一屏高的 fixed 容器（滚动位置挪进 #app.scrollTop），
 * 否则 #app 带 transform 后里面 fixed 的 dock 会改成相对整页定位、跑到页面最底下。
 */
(function (global) {
  'use strict';

  var root = null, panel = null, mask = null;
  var isOpen = false, locked = false, ly = 0, unlockT = 0;
  function appEl() { return document.getElementById('app'); }
  function lock() {
    if (unlockT) { clearTimeout(unlockT); unlockT = 0; }
    if (locked) return;
    var app = appEl(); if (!app) return;
    ly = global.pageYOffset || 0;
    locked = true;
    /* 滚动量写成顶栏的负 margin（不用 #app.scrollTop：#app 带 transform 后里面 fixed 的 dock
       等同 absolute，会跟着 scrollTop 一起被卷上去） */
    document.documentElement.style.setProperty('--sd-ly', ly + 'px');
    document.body.classList.add('sd-lock');
    if (mask && mask.parentNode !== app) app.appendChild(mask);
  }
  function unlock() {
    if (!locked || isOpen) return;
    locked = false;
    document.body.classList.remove('sd-lock');
    var app = appEl(); if (app) { app.style.transform = ''; }
    global.scrollTo(0, ly);
  }

  function esc(s) { return (global.Util && Util.escapeHtml) ? Util.escapeHtml(s) : String(s == null ? '' : s); }
  function ic(k) { return (global.icon && global.icon(k)) || ''; }
  var SWAP = '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 9.5l4-4 4 4M8 14.5l4 4 4-4"/></svg>';

  function babyBlock() {
    var d = Storage.get();
    var b = (Storage.activeBaby) ? Storage.activeBaby() : null;
    var name = (Storage.babyLabel && b) ? Storage.babyLabel(b) : ((d.settings.baby && (d.settings.baby.nickname || d.settings.baby.name)) || '宝宝');
    var bd = (b && b.birthDate) || (d.settings.baby && d.settings.baby.birthDate) || null;
    var age = (global.App && App._babyAge) ? App._babyAge(bd) : '';
    var gr = (d.growth || []).slice().sort(function (x, y) { return String(y.date || '').localeCompare(String(x.date || '')); });
    var h = null, w = null;
    gr.forEach(function (r) { if (h == null && r.heightCm != null) h = r.heightCm; if (w == null && r.weightKg != null) w = r.weightKg; });
    var meta = [age, h != null ? h + 'cm' : '', w != null ? w + 'kg' : ''].filter(Boolean).map(function (x) { return '<span>' + esc(x) + '</span>'; }).join('');
    var ava = (b && b.photo) ? '<img src="' + esc(b.photo) + '" alt="">' : (global.illo ? illo('avatar') : '');
    return '<div class="sd-baby">'
      + '<div class="sd-baby-top"><button type="button" class="sd-ava" data-sd="baby" aria-label="宝宝资料">' + ava + '</button>'
      + '<button type="button" class="sd-swap" data-sd="swap" aria-label="切换宝宝">' + SWAP + '</button></div>'
      + '<b class="sd-name">' + esc(name) + '</b>'
      + (meta ? '<p class="sd-meta">' + meta + '</p>' : '')
      + '</div>';
  }

  var TOP = [
    { go: 'home', ico: 'dk-home', name: '首页' },
    { go: 'calendar', ico: 'calendar', name: '日期记录' },
    { go: 'whitenoise', ico: 'noise', name: '哄睡声音' },
    { go: '__edit', ico: 'edit', name: '编辑首页卡片' },
    { go: 'settings', ico: 'settings', name: '设置' }
  ];

  function render() {
    if (!panel) return;
    var d = Storage.get();
    var stage = (global.App && App.stageOf) ? App.stageOf(d) : null;
    var groups = ((global.Modules && Modules.alltools && Modules.alltools._groups) || []).filter(function (g) { return g.key !== 'tools'; });
    if (stage === 'pregnancy') groups = groups.slice().sort(function (a, b) { return a.key === 'pregnancy' ? -1 : (b.key === 'pregnancy' ? 1 : 0); });
    var cur = (global.App && App.currentTab) ? App.currentTab() : '';
    var h = babyBlock();
    h += '<nav class="sd-sec sd-mono" aria-label="常用">';
    TOP.forEach(function (t) {
      h += '<button type="button" class="sd-row' + (cur === t.go ? ' on' : '') + '" data-sd-go="' + t.go + '"><span class="sd-ico">' + ic(t.ico) + '</span><span>' + t.name + '</span></button>';
    });
    h += '</nav>';
    groups.forEach(function (g) {
      h += '<nav class="sd-sec" aria-label="' + esc(g.title) + '"><h3 class="sd-gh">' + esc(g.title === '通用' ? '全部功能' : g.title) + '</h3>';
      g.items.forEach(function (it) {
        if (it.id === 'whitenoise') return; /* 上面「哄睡声音」已有 */
        var acc = it.id === 'whitenoise' ? 'whitenoise' : it.id;
        h += '<button type="button" class="sd-row sd-color' + (cur === it.id ? ' on' : '') + '" data-accent="' + esc(acc) + '" data-sd-go="' + esc(it.id) + '">'
          + '<span class="sd-ico">' + ic(it.id === 'whitenoise' ? 'noise' : it.id) + '</span><span>' + esc(it.name) + '</span></button>';
      });
      h += '</nav>';
    });
    panel.innerHTML = '<div class="sd-scroll">' + h + '</div>';
  }

  function build() {
    if (root) return;
    mask = document.createElement('div');
    mask.className = 'sd-mask'; mask.id = 'sdMask'; /* 挂在 #app 里：随页面一起推开，盖住页面接点击 */
    root = document.createElement('aside');
    root.id = 'sideDrawer'; root.className = 'side-drawer';
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', '全部功能');
    root.setAttribute('aria-hidden', 'true');
    try { root.inert = true; } catch (e) {}
    panel = document.createElement('div'); panel.className = 'sd-panel';
    root.appendChild(panel);
    (appEl() || document.body).appendChild(mask);
    document.body.appendChild(root);
    mask.addEventListener('click', function () { close(); });
    root.addEventListener('click', function (e) {
      var t = e.target && e.target.closest ? e.target.closest('[data-sd-go],[data-sd]') : null;
      if (!t) return;
      var go = t.getAttribute('data-sd-go'), act = t.getAttribute('data-sd');
      if (act === 'swap') { if (App._openBabySheet) App._openBabySheet(); return; } /* 面板盖在抽屉上，选完回到抽屉 */
      if (act === 'baby') { navigate(function () { if (App.openSettingsGroup) App.openSettingsGroup('称呼与阶段'); }); return; }
      if (!go) return;
      if (go === '__edit') {
        navigate(function () {
          if (global.Modules && Modules.home) Modules.home._edit = true;
          if (App.currentTab() === 'home') App.rerender(); else App.showTab('home', { noVT: true });
        });
        return;
      }
      if (go === App.currentTab()) { close(); return; }
      navigate(function () { App.showTab(go, { noVT: true }); });
    });
  }
  document.addEventListener('keydown', function (e) { if (isOpen && e.key === 'Escape') close(); });

  function width() { return root ? (root.getBoundingClientRect().width || 320) : 320; }
  function setProgress(p, dragging) {
    /* p: 0 = 收起，1 = 全开；拖动中写内联样式，松手交给 CSS 过渡 */
    p = Math.max(0, Math.min(1, p));
    var app = appEl();
    if (dragging) document.body.classList.add('sd-drag'); else document.body.classList.remove('sd-drag');
    if (dragging) {
      if (app) app.style.transform = 'translateX(' + (p * width()) + 'px)';
      root.style.transform = 'translateX(' + ((p - 1) * 26) + '%)';
      root.style.opacity = String(0.4 + 0.6 * p);
      mask.style.opacity = String(p);
    } else {
      if (app) app.style.transform = '';
      root.style.transform = ''; root.style.opacity = ''; mask.style.opacity = '';
    }
  }
  function syncW() { try { document.documentElement.style.setProperty('--sd-w', width() + 'px'); } catch (e) {} }

  function open() {
    build();
    render();
    lock();
    syncW();
    isOpen = true;
    root.setAttribute('aria-hidden', 'false');
    try { root.inert = false; } catch (e) {}
    setProgress(1, false);
    document.body.classList.add('sd-open');
    if (global.Util && Util.haptic) Util.haptic('light');
  }
  function close() {
    if (!root) return;
    isOpen = false;
    setProgress(0, false);
    document.body.classList.remove('sd-open');
    root.setAttribute('aria-hidden', 'true');
    try { root.inert = true; } catch (e) {}
    if (unlockT) clearTimeout(unlockT);
    unlockT = setTimeout(function () { unlockT = 0; unlock(); }, 420);
  }
  /* 选了入口：页面一边滑回来一边换成新页（不再叠系统转场），回到顶部 */
  function navigate(fn) {
    ly = 0;
    document.documentElement.style.setProperty('--sd-ly', '0px');
    close();
    try { fn(); } catch (e) {}
  }

  /* 跟手：一级页左边缘向右拉打开；抽屉开着时向左拉关闭 */
  function bindDrag() {
    var sx = 0, sy = 0, st = 0, mode = null, decided = false, lastP = 0;
    function canEdgeOpen() {
      if (!global.App || !App._isTop || !App._isTop()) return false;
      if (document.body.classList.contains('qd-open') || document.body.classList.contains('ob-open') || document.body.classList.contains('ftf-open')) return false;
      var mr = document.getElementById('modalRoot');
      if (mr && mr.children.length) return false;
      return !(App.inSub && App.inSub());
    }
    document.addEventListener('touchstart', function (e) {
      if (!e.touches || e.touches.length !== 1) return;
      var t = e.touches[0];
      mode = null; decided = false;
      if (isOpen) mode = 'close';
      else if (t.clientX <= 24 && canEdgeOpen()) { mode = 'open'; build(); }
      if (!mode) return;
      sx = t.clientX; sy = t.clientY; st = Date.now();
    }, { passive: true });
    document.addEventListener('touchmove', function (e) {
      if (!mode) return;
      var t = e.touches[0], dx = t.clientX - sx, dy = t.clientY - sy;
      if (!decided) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        if (Math.abs(dy) > Math.abs(dx) || (mode === 'close' && dx > 0)) { mode = null; return; }
        decided = true;
        if (mode === 'open') { render(); lock(); syncW(); }
      }
      var w = width();
      lastP = mode === 'open' ? dx / w : 1 + dx / w;
      setProgress(lastP, true);
      if (e.cancelable) e.preventDefault();
    }, { passive: false });
    function end() {
      if (!mode) return;
      var m = mode; mode = null;
      if (!decided) return;
      var fast = (Date.now() - st) < 260;
      document.body.classList.remove('sd-drag');
      if (m === 'open') { if (lastP > 0.35 || (fast && lastP > 0.12)) open(); else { setProgress(0, false); close(); } }
      else { if (lastP < 0.65 || (fast && lastP < 0.9)) close(); else open(); }
    }
    document.addEventListener('touchend', end, { passive: true });
    document.addEventListener('touchcancel', end, { passive: true });
  }

  bindDrag(); /* 边缘拉出要在抽屉第一次建出来之前就能用 */
  global.Drawer = { open: open, close: close, isOpen: function () { return isOpen; }, _render: render };
})(window);
