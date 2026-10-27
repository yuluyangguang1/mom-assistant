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
 *
 * 第 276 次（用户同意重做）：浮起的圆角卡片 + 缩放在网页里阴影边缘硬切、圆角难看。
 * 改成和 iOS 导航推入一样的整屏页：侧拉页宽 100%、无圆角无投影，从左边滑进来盖住屏幕；
 * 底下的当前页同步向右平移 28% 并轻微变暗（视差）。全程跟手：一级页向右拉打开，
 * 在侧拉页上向左拉或点左上「返回」关闭，松手按位置 + 速度决定打开还是回弹。
 * 顶部放搜索框（点了直接进搜索页并弹出键盘）。打开时登记一条 history，系统返回 / popstate 先关它。
 * 减少动态效果时不平移，直接淡入淡出。
 *
 * 第 279 次（真机录屏：侧拉页上开着「宝宝资料」面板时划走侧拉页 → 面板跟着侧拉页被拖成一张圆角卡片、
 * 底下露出一张「侧拉页残留一条 + 首页右移压暗」的半开画面；再关侧拉页后面板孤零零留在首页上）：
 *   ① 那张跟着走的圆角卡片和底下的半开画面都是 iOS 系统返回手势的快照（WebKit 在 pushState 那一刻给当前画面拍照，
 *      拖开侧拉页时是松手才登记 history，拍下的正是拖到一半的样子）。改成拖拽一判定就先登记 history、再动画面，
 *      快照永远是没推开的首页；盖在侧拉页上的面板登记自己那条（App._pushOverlay），系统返回只退一层，
 *      不再「关面板再补推侧拉页记录」（补推时拍的是面板还在的画面）。
 *   ② 侧拉页上盖着面板 / 照片大图时，侧拉页自己的左拉不接管（面板下拉照旧）。
 *   ③ 侧拉页以任何方式关闭（左拉、返回、点底页、Esc、切页）都连同盖在它上面的面板、大图一起关，history 一次退干净。
 *   ④ 拖拽兜底：touchcancel / 系统返回 / 切后台 / 1.2 秒没有新的 touchmove（系统手势吞掉了 touchend）都按当前位置落到全开或全关。
 */
(function (global) {
  'use strict';

  var root = null, panel = null, mask = null;
  var isOpen = false, locked = false, ly = 0, unlockT = 0;
  function appEl() { return document.getElementById('app'); }
  /* 第 279 次：盖在侧拉页上面的层（面板 / 确认框 / 照片大图） */
  function modalMasks() {
    var mr = document.getElementById('modalRoot'); if (!mr) return [];
    return Array.prototype.filter.call(mr.children, function (m) { return !m.classList.contains('sheet-leaving') && !m.classList.contains('sheet-ghost'); });
  }
  function overlayOpen() { return modalMasks().length > 0 || !!document.querySelector('body > .ph-view'); }
  var ovRel = null; /* 盖在侧拉页上的面板登记的那条 history 的 release */
  function closeChildren() {
    ovRel = null;
    Array.prototype.forEach.call(document.querySelectorAll('body > .ph-view'), function (v) {
      try { if (v._phClose) v._phClose(true); } catch (e) {}
      if (v.parentNode) v.parentNode.removeChild(v);
    });
    var n = 0;
    while (n++ < 6 && modalMasks().length) {
      if (global.Sheet && Sheet.closeTop && Sheet.closeTop()) continue;
      var mr = document.getElementById('modalRoot'); if (mr) mr.innerHTML = ''; break;
    }
  }
  function watchOverlays() {
    var mr = document.getElementById('modalRoot');
    if (!mr || typeof MutationObserver === 'undefined') return;
    new MutationObserver(function () {
      var has = modalMasks().length > 0;
      if (isOpen && has && !ovRel && global.App && App._pushOverlay) {
        ovRel = App._pushOverlay(function () { ovRel = null; closeChildren(); });
      } else if (!has && ovRel) { var r = ovRel; ovRel = null; r(); }
    }).observe(mr, { childList: true });
  }
  function lock() {
    if (unlockT) { clearTimeout(unlockT); unlockT = 0; }
    if (root && root._tEnd) { root.removeEventListener('transitionend', root._tEnd); root._tEnd = null; }
    if (auditT) { clearTimeout(auditT); auditT = 0; }
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
  /* 第 286 次（真机：「左滑再左滑页面就消失了，要不就是卡住」）：
     根因——关闭后靠一个 440ms 定时器去掉 sd-lock，而收起过渡本身 420ms。关闭那一刻主线程很忙（history.back → popstate →
     dropForward 再 push / back 一轮、重画），过渡的第一帧被推迟，定时器先到：sd-lock 去掉时 #app / 遮罩的过渡还没跑完，
     WebKit 把这条「已经不再声明」的过渡停在半路——#app 停在右移 28px、遮罩停在 0.2~0.3 不透明且仍 visible（挡住点击 = 卡住；
     再叠一次左滑 / 关闭时整页停在推开的位置 = 页面消失）。WebKit 里连续三次左滑约 1/30 能复现。
     修法：① 解锁前把 #app / 遮罩 / 侧拉页身上还在跑的过渡全部取消，内联样式清干净；② 解锁时机改成「收起过渡真正结束（transitionend）
     或兜底 600ms」二者先到；③ 关闭后 700ms 再自检一次，侧拉页已关就把 sd-open / sd-drag / sd-half / inert / transform 全部归零。 */
  function killTransitions() {
    [appEl(), mask, root].forEach(function (el) {
      if (!el) return;
      try { if (el.getAnimations) el.getAnimations().forEach(function (a) { try { a.cancel(); } catch (e) {} }); } catch (e) {}
    });
  }
  function unlock() {
    if (!locked || isOpen) return;
    locked = false;
    killTransitions();
    document.body.classList.remove('sd-lock');
    var app = appEl(); if (app) { app.style.transform = ''; }
    if (mask) mask.style.opacity = '';
    if (root) { root.style.transform = ''; root.style.opacity = ''; }
    global.scrollTo(0, ly);
  }
  /* 关闭后自检：侧拉页处于「关」的状态时，页面必须完整可见、可点 */
  var auditT = 0;
  function audit() {
    auditT = 0;
    if (isOpen || document.body.classList.contains('sd-drag')) return;
    var b = document.body.classList;
    b.remove('sd-open'); b.remove('sd-half');
    var app = appEl();
    if (app) { try { app.inert = false; } catch (e) {} app.style.transform = ''; }
    if (mask) mask.style.opacity = '';
    if (root) { root.setAttribute('aria-hidden', 'true'); try { root.inert = true; } catch (e) {} }
    if (locked) { if (unlockT) { clearTimeout(unlockT); unlockT = 0; } unlock(); }
  }

  function esc(s) { return (global.Util && Util.escapeHtml) ? Util.escapeHtml(s) : String(s == null ? '' : s); }
  function ic(k) { return (global.icon && global.icon(k)) || ''; }
  var BACK = '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 5.5L8 12l6.5 6.5"/></svg>';
  var SWAP = '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 9.5l4-4 4 4M8 14.5l4 4 4-4"/></svg>';

  function babyBlock() {
    var d = Storage.get();
    var b = (Storage.activeBaby) ? Storage.activeBaby() : null;
    var name = (Storage.babyLabel && b) ? Storage.babyLabel(b) : ((d.settings.baby && (d.settings.baby.nickname || d.settings.baby.name)) || '宝宝');
    var bd = (b && b.birthDate) || (d.settings.baby && d.settings.baby.birthDate) || null;
    var age = (global.App && App._babyAge) ? App._babyAge(bd) : '';
    var gr = (d.growth || []).slice().sort(function (x, y) { return (String(y.date || '') + (y.at || '')).localeCompare(String(x.date || '') + (x.at || '')); }); /* 第 284 次：同一天按测量时刻 */
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
    /* 第 276 次：整屏页顶部 = 返回 + 搜索框（搜索从 dock 搬出来后的入口之一） */
    var top = '<div class="sd-top">'
      + '<button type="button" class="sd-back" data-sd="back" aria-label="返回">' + BACK + '</button>'
      + '<button type="button" class="sd-search" data-sd="search" aria-label="搜索记录、里程碑、用品"><span class="si-ico">' + ic('search') + '</span><span>搜索记录、里程碑、用品…</span></button>'
      + '</div>';
    panel.innerHTML = top + '<div class="sd-scroll"><div class="sd-inner">' + h + '</div></div>';
  }

  function build() {
    if (root) return;
    mask = document.createElement('div');
    mask.className = 'sd-mask'; mask.id = 'sdMask'; /* 挂在 #app 里：随页面一起推开，盖住页面接点击 */
    root = document.createElement('aside');
    root.id = 'sideDrawer'; root.className = 'side-drawer';
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', '全部功能');
    root.setAttribute('aria-hidden', 'true');
    root.setAttribute('tabindex', '-1');
    try { root.inert = true; } catch (e) {}
    panel = document.createElement('div'); panel.className = 'sd-panel';
    root.appendChild(panel);
    (appEl() || document.body).appendChild(mask);
    document.body.appendChild(root);
    watchOverlays();
    mask.addEventListener('click', function () { close(); });
    root.addEventListener('click', function (e) {
      var t = e.target && e.target.closest ? e.target.closest('[data-sd-go],[data-sd]') : null;
      if (!t) return;
      var go = t.getAttribute('data-sd-go'), act = t.getAttribute('data-sd');
      if (act === 'back') { close(); return; }
      if (act === 'search') {
        /* 同一次点击里切页并聚焦输入框，iOS 才会弹出键盘 */
        navigate(function () { if (App.openSearch) App.openSearch(); else App.showTab('search', { noVT: true }); });
        return;
      }
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

  /* 第 276 次：整屏宽；底下的页跟着推 28%（iOS 导航推入的视差比例） */
  var PAR = 0.28;
  var prog = 0, opener = null;
  function width() { return global.innerWidth || (root ? root.getBoundingClientRect().width : 0) || 390; }
  function reducedMotion() { try { return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; } }
  function setProgress(p, dragging) {
    /* p: 0 = 收起，1 = 全开；拖动中写内联样式，松手交给 CSS 过渡 */
    p = Math.max(0, Math.min(1, p));
    prog = p;
    var app = appEl();
    if (dragging) document.body.classList.add('sd-drag'); else document.body.classList.remove('sd-drag');
    if (dragging) {
      if (reducedMotion()) {
        /* 减少动态效果：不平移，只按进度淡入 */
        root.style.transform = 'none'; root.style.opacity = String(p);
        if (app) app.style.transform = '';
      } else {
        root.style.transform = 'translate3d(' + ((p - 1) * 100).toFixed(3) + '%,0,0)';
        root.style.opacity = '';
        if (app) app.style.transform = 'translate3d(' + (p * PAR * width()).toFixed(1) + 'px,0,0)';
      }
      mask.style.opacity = String(p);
    } else {
      if (app) app.style.transform = '';
      root.style.transform = ''; root.style.opacity = ''; mask.style.opacity = '';
    }
    /* 第 266 次：状态栏跟着侧拉页走（盖过一半就换成侧拉页底色）；第 276 次起由 syncStatusColor 按 Drawer.progress() 判定 */
    var half = dragging ? p >= 0.5 : null;
    if (half) document.body.classList.add('sd-half'); else document.body.classList.remove('sd-half');
    if (global.syncStatusColor) global.syncStatusColor();
  }
  function syncW() { try { document.documentElement.style.setProperty('--sd-w', width() + 'px'); } catch (e) {} }

  function open() {
    build();
    render();
    lock();
    syncW();
    var was = isOpen;
    isOpen = true;
    if (!was) {
      opener = document.activeElement;
      /* 键盘开着（例如日期记录页的输入框）先收起，不让它顶着侧拉页 */
      var ae = document.activeElement;
      if (ae && ae !== document.body && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) { try { ae.blur(); } catch (e) {} }
      if (global.App && App._drawerHist) App._drawerHist.open();
    }
    root.setAttribute('aria-hidden', 'false');
    try { root.inert = false; } catch (e) {}
    var app = appEl(); if (app) { try { app.inert = true; } catch (e) {} } /* 页面不再能被 Tab / 读屏走到 */
    setProgress(1, false);
    document.body.classList.add('sd-open');
    if (global.syncStatusColor) global.syncStatusColor();
    if (!was) {
      if (global.Util && Util.haptic) Util.haptic('light');
      /* 焦点移进侧拉页（对话框本身，不画焦点环）；键盘用户接着 Tab 就是「返回」 */
      setTimeout(function () { if (isOpen) { try { root.focus({ preventScroll: true }); } catch (e) {} } }, 60);
    }
  }
  /* opts.keepHist：由 navigate() 调用，history 的处理留给切页（它会复用侧拉页那条记录）；
     opts.fromPop：系统返回已经退掉了那条记录 */
  function close(opts) {
    if (!root) return;
    if (opts && opts.keepHist && isOpen) { ly = 0; document.documentElement.style.setProperty('--sd-ly', '0px'); } /* 切页：新页从顶部开始 */
    var was = isOpen;
    isOpen = false;
    setProgress(0, false);
    document.body.classList.remove('sd-open');
    if (global.syncStatusColor) global.syncStatusColor();
    root.setAttribute('aria-hidden', 'true');
    try { root.inert = true; } catch (e) {}
    var app = appEl(); if (app) { try { app.inert = false; } catch (e) {} }
    /* 第 279 次：拖开途中就登记了 history（was 还是 false），所以只要不是切页 / 系统返回，有记录就退；
       closed() 连同盖在上面的面板记录一次退干净，再关掉这些层 */
    if (!(opts && (opts.keepHist || opts.fromPop)) && global.App && App._drawerHist) App._drawerHist.closed();
    closeChildren();
    if (was && opener && opener.isConnected && !(opts && opts.keepHist)) { try { opener.focus({ preventScroll: true }); } catch (e) {} }
    if (!(opts && opts.keepHist)) opener = null;
    if (unlockT) clearTimeout(unlockT);
    if (root._tEnd) { root.removeEventListener('transitionend', root._tEnd); root._tEnd = null; }
    var fin = function () {
      if (root._tEnd) { root.removeEventListener('transitionend', root._tEnd); root._tEnd = null; }
      if (unlockT) { clearTimeout(unlockT); unlockT = 0; }
      unlock();
    };
    if (!reducedMotion()) {
      root._tEnd = function (e) { if (e.target === root && e.propertyName === 'transform' && !isOpen) fin(); };
      root.addEventListener('transitionend', root._tEnd);
    }
    unlockT = setTimeout(fin, reducedMotion() ? 220 : 600);
    if (auditT) clearTimeout(auditT);
    auditT = setTimeout(audit, 700);
  }
  /* 选了入口：侧拉页一边滑走一边换成新页（不再叠系统转场），回到顶部。
     进二级页时那次 pushHistory 直接复用侧拉页登记的 history 记录；没用上就退掉它。 */
  function navigate(fn) {
    ly = 0;
    document.documentElement.style.setProperty('--sd-ly', '0px');
    close({ keepHist: true });
    opener = null;
    try { fn(); } catch (e) {}
    if (global.App && App._drawerHist) App._drawerHist.closed();
  }

  /* 跟手：一级页向右拉打开；侧拉页开着时向左拉关闭。松手看位置和速度（≥0.35px/ms 视为甩动）。 */
  function bindDrag() {
    var sx = 0, sy = 0, mode = null, decided = false, lastP = 0, lx = 0, lt = 0, vel = 0;
    function canEdgeOpen() {
      if (!global.App || !App._isTop || !App._isTop()) return false;
      if (document.body.classList.contains('qd-open') || document.body.classList.contains('ob-open') || document.body.classList.contains('ftf-open') || document.body.classList.contains('ps-pull') || document.documentElement.classList.contains('wp-lock')) return false; /* 第 271 次：白噪音播放页开着时不拉抽屉 */
      var mr = document.getElementById('modalRoot');
      if (mr && mr.children.length) return false;
      if (overlayOpen()) return false;
      return !(App.inSub && App.inSub());
    }
    /* 第 246 次（真机录屏）：iPhone Safari 里从屏幕最左边缘右滑会被浏览器拿去做「后退」，
       露出上一条历史的截图（黑底、深色页、抽屉残影）。所以一级页上**任意位置向右横滑**都能拉出抽屉，
       不必贴边；只有会自己横向滑动的地方（横向滚动区、左滑删除行、输入框、编辑排序中的卡片、dock）不接管。 */
    var NO_PAN = 'input, textarea, select, .sw-row, .record-grid.is-editing, #tabbar, #dockOrb, #quickDock, .qd-mask, [data-no-drawer], .week-strip, .cal-grid, input[type=range]';
    function hScrollAncestor(el) {
      for (var n = el; n && n !== document.body && n.nodeType === 1; n = n.parentNode) {
        if (n.scrollWidth > n.clientWidth + 2) {
          var ox = global.getComputedStyle(n).overflowX;
          if (ox === 'auto' || ox === 'scroll') return true;
        }
      }
      return false;
    }
    var panAny = false;
    /* 第 279 次：上一次拖拽没收到 touchend / touchcancel（被系统手势吞掉）就又来了新的一次触摸——
       先把上一次按当前位置落定，否则 mode 被清掉后内联位移、sd-drag 永远留着，停在半开（真机录屏里的那一条） */
    function settleStray() {
      if (mode && decided) { vel = 0; end(); return; }
      mode = null;
      if (document.body.classList.contains('sd-drag')) {
        document.body.classList.remove('sd-drag');
        if (prog >= 0.5) open(); else { setProgress(0, false); close(); }
      }
    }
    document.addEventListener('touchstart', function (e) {
      settleStray();
      if (!e.touches || e.touches.length !== 1) return;
      var t = e.touches[0];
      mode = null; decided = false; panAny = false; vel = 0;
      if (isOpen) { if (!overlayOpen()) mode = 'close'; } /* 第 279 次：上面盖着面板 / 大图时不拖侧拉页 */
      else if (canEdgeOpen()) {
        var tg = e.target;
        if (t.clientX <= 24) { mode = 'open'; build(); }
        else if (!(tg && tg.closest && tg.closest(NO_PAN)) && !hScrollAncestor(tg)) { mode = 'open'; panAny = true; build(); }
      }
      if (!mode) return;
      sx = t.clientX; sy = t.clientY; lx = sx; lt = Date.now();
    }, { passive: true });
    document.addEventListener('touchmove', function (e) {
      if (!mode) return;
      var t = e.touches[0], dx = t.clientX - sx, dy = t.clientY - sy;
      if (!decided) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        if (Math.abs(dy) > Math.abs(dx) || (mode === 'close' && dx > 0)) { mode = null; return; }
        if (mode === 'open' && (dx < 0 || (panAny && Math.abs(dx) < Math.abs(dy) * 1.4))) { mode = null; return; }
        decided = true;
        if (mode === 'open') {
          /* 第 279 次：先登记 history 再动画面——WebKit 在 pushState 时给当前画面拍系统返回用的快照 */
          if (global.App && App._drawerHist) App._drawerHist.open();
          render(); lock(); syncW();
        }
        else { var app0 = appEl(); if (app0) { try { app0.inert = false; } catch (eI) {} } }
      }
      var now = Date.now(), dtm = Math.max(1, now - lt);
      vel = vel * 0.4 + ((t.clientX - lx) / dtm) * 0.6; /* px/ms，平滑一下 */
      lx = t.clientX; lt = now;
      var w = width();
      if (panAny) dx -= 8; /* 起步判定吃掉的那 8px 不算，免得一判定就跳一下 */
      lastP = mode === 'open' ? dx / w : 1 + dx / w;
      setProgress(lastP, true);
      arm();
      if (e.cancelable) e.preventDefault();
    }, { passive: false });
    /* 第 279 次：系统手势（返回 / 控制中心 / 切 App）可能把 touchend、touchcancel 都吞掉，
       1.2 秒没有新的 touchmove 就按当前位置落定，绝不停在半开 */
    var dogT = 0;
    function arm() { if (dogT) clearTimeout(dogT); dogT = setTimeout(function () { dogT = 0; settleStray(); }, 1200); }
    function end() {
      if (dogT) { clearTimeout(dogT); dogT = 0; }
      if (!mode) return;
      var m = mode; mode = null;
      if (!decided) return;
      if (Date.now() - lt > 120) vel = 0; /* 停住再松手不算甩 */
      document.body.classList.remove('sd-drag');
      var FLING = 0.35;
      if (m === 'open') {
        if (vel <= -FLING) { setProgress(0, false); close(); }
        else if (lastP > 0.5 || vel >= FLING) open();
        else { setProgress(0, false); close(); }
      } else {
        if (vel <= -FLING || (lastP < 0.5 && vel < FLING)) close();
        else open();
      }
    }
    document.addEventListener('touchend', end, { passive: true });
    document.addEventListener('touchcancel', function () { vel = 0; end(); }, { passive: true }); /* 第 279 次：被打断不算甩，只看位置 */
    settle = settleStray;
    global.addEventListener('popstate', function () { settle(); }, true);
    global.addEventListener('blur', function () { settle(); });
    global.addEventListener('pagehide', function () { settle(); });
    document.addEventListener('visibilitychange', function () { if (document.hidden) settle(); });
  }
  var settle = function () {};

  bindDrag(); /* 边缘拉出要在抽屉第一次建出来之前就能用 */
  global.Drawer = { open: open, close: close, isOpen: function () { return isOpen; }, _render: render, _settle: function () { settle(); },
    /* 第 276 次：0 = 收起，1 = 全开（拖动中是实时进度）；状态栏取色用 */
    progress: function () { return document.body.classList.contains('sd-lock') ? (document.body.classList.contains('sd-drag') ? prog : (isOpen ? 1 : 0)) : 0; } };
})(window);
