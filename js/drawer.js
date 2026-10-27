/**
 * drawer.js —— 左侧整屏侧拉页（全部功能 + 设置入口 + 顶部搜索框）
 *
 * 第 288 次：整体重写（用户：「侧拉页从一开始就问题不断、反复修，不要再打补丁」）。
 *
 * 旧实现（第 245–286 次）为什么一直出问题：
 *   ① 「推整页」结构要同步的东西太多：侧拉页、#app（锁成 fixed + 滚动量写成顶栏负 margin）、遮罩（挂在 #app 里）、dock（在 #app 里跟着走）、
 *      body 锁定、状态栏取色，六样东西各有各的 CSS 过渡，由 sd-lock / sd-open / sd-drag / sd-half 四个 class 组合驱动；
 *   ② 落定靠多个互相独立的计时器各自清理：440ms 解锁、600ms 兜底、transitionend、700ms 自检、1.2 秒拖拽看门狗……
 *      谁先到谁说了算，WebKit 主线程一忙就会把「已经不再声明」的过渡停在半路（第 286 次）；
 *   ③ history 操作发生在动画中途：关闭一开始就 history.back()，popstate 里再 dropForward（pushState + back）。
 *      WebKit 在每次 pushState / back 时都会给「当前这条记录」拍一张系统返回手势用的快照（WebBackForwardList::addItem /
 *      goToItem → recordAutomaticNavigationSnapshot），动画中途拍下的就是「首页右移 + 压暗」的半路画面；
 *      之后用户系统返回（左缘右滑）回到这条记录时，iOS 先盖上这张旧快照，等页面「重绘 / 滚动位置恢复」等事件，
 *      等不齐就要到 3 秒看门狗（ViewGestureController swipeSnapshotRemovalWatchdogDuration = 3s）才淡出——
 *      这就是第 288 次录屏里「右移约 55px + 灰遮罩，2 秒多后突然弹回（淡出时有两层叠影）」的来源：那 2.8 秒是一张静止截图，不是页面本身。
 *
 * 新结构：
 *   - 覆盖式：侧拉页从左边滑进来盖在页面上，底下页面（#app、dock、WebGL 折射层）完全不动，只多一层压暗遮罩。
 *     要同步的元素从六样减到两样（侧拉页 transform、遮罩 opacity）。侧拉页本来就是 100% 宽，全开时外观与原来一致。
 *   - 单一状态机：closed / dragging / opening / open / closing，任何时刻只有 state + 进度 p 两个权威值；
 *     页面上的一切（侧拉页位移、遮罩透明度、pointer-events、body 锁定、inert / aria、状态栏）都只由 paint() 按 state + p 一次写出。
 *   - 动画由 rAF 自驱（不靠 CSS 过渡；每帧最多前进 34ms，首帧卡顿不跳变），随时可以取消并从当前进度接着走（动画中反向 / 动画中再按住拖）；
 *     结束时统一进 settle()。rAF 被节流时同一个动画令牌的兜底计时器也只会调 settle()，不另做清理。
 *   - touchcancel / 拖拽中来了系统返回：按位置落到最近的稳定态；visibilitychange / pagehide / 宽度变化：拖拽按位置、动画按目标，立即落定。
 *   - history：打开时只登记一条 {baoma:'drawer'}，而且在画面开始变化之前登记（快照永远是没打开的页面）；
 *     关闭（左拉 / 点遮罩 / 返回钮 / Esc / 点当前页）先播收起动画，**落定之后**才 history.back()——动画中途不做任何 history 操作，
 *     所以动画中反向不需要补推记录、也不会把半路画面拍进快照；这条记录以 popstate 到达为准才算退掉（app.js ignorePop），
 *     那之前再打开会排到 popstate 之后（App._histIdle）。系统返回走 popstate：直接落定为关（系统手势本身已经播过转场，
 *     页面要和系统快照一致），清前进栈（dropForward）推迟到干净画面提交之后。
 *   - 入口（宝宝圆钮 / 一级页任意位置右滑 / 菜单项跳转 / 搜索框）与外观不变；菜单项跳转时新页先在底下画好，侧拉页再滑走。
 */
(function (global) {
  'use strict';

  var root = null, panel = null, mask = null;
  var state = 'closed';   /* closed | dragging | opening | open | closing */
  var p = 0;              /* 0 = 收起，1 = 全开 */
  var anim = null;        /* { raf, guard, target } —— 当前动画令牌 */
  var closeOpts = null;   /* 这次收起的来由：{ keepHist } / { fromPop } / null */
  var opener = null;
  var pendingOpen = false; /* 上一次关闭的 back 还没落地时的打开请求（落地后执行；期间关闭则作废） */
  var DUR = 420;          /* 与 iOS 推入一致 */
  var SLOW = 1;           /* Drawer._slow(n)：放慢 n 倍方便逐帧截图（同 DockLive._slow） */
  function appEl() { return document.getElementById('app'); }
  function reducedMotion() { try { return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; } }
  function width() { return global.innerWidth || (root ? root.getBoundingClientRect().width : 0) || 390; }

  /* cubic-bezier(.32,.72,0,1)（iOS 推入曲线） */
  var ease = (function (x1, y1, x2, y2) {
    function bx(t) { return ((1 - 3 * x2 + 3 * x1) * t + (3 * x2 - 6 * x1)) * t * t + 3 * x1 * t; }
    function by(t) { return ((1 - 3 * y2 + 3 * y1) * t + (3 * y2 - 6 * y1)) * t * t + 3 * y1 * t; }
    function dbx(t) { return 3 * (1 - 3 * x2 + 3 * x1) * t * t + 2 * (3 * x2 - 6 * x1) * t + 3 * x1; }
    return function (x) {
      if (x <= 0) return 0; if (x >= 1) return 1;
      var t = x;
      for (var i = 0; i < 8; i++) { var d = bx(t) - x; if (Math.abs(d) < 1e-5) break; var s = dbx(t); if (Math.abs(s) < 1e-6) break; t -= d / s; }
      t = Math.max(0, Math.min(1, t));
      return by(t);
    };
  })(0.32, 0.72, 0, 1);

  /* ———— 盖在侧拉页上面的层（第 279 次：面板 / 确认框 / 照片大图） ———— */
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
      if (isOpen() && has && !ovRel && global.App && App._pushOverlay) {
        ovRel = App._pushOverlay(function () { ovRel = null; closeChildren(); });
      } else if (!has && ovRel) { var r = ovRel; ovRel = null; r(); }
    }).observe(mr, { childList: true });
  }

  /* ———— 唯一的「写画面」函数 ———— */
  function tog(cl, c, on) { if (on) cl.add(c); else cl.remove(c); }
  function paint() {
    if (!root) return;
    var b = document.body.classList;
    var vis = state !== 'closed';
    var settled = state === 'open' || state === 'closed';
    var interactive = state === 'open' || state === 'opening';
    tog(b, 'sd-lock', vis);                 /* 侧拉页在屏幕上（含动画 / 拖动）：body 不滚动；其他模块据此让路 */
    tog(b, 'sd-open', interactive);         /* 目标是「开」：遮罩接点击 */
    tog(b, 'sd-drag', state === 'dragging');
    tog(b, 'sd-half', vis && !settled && p >= 0.5);
    if (settled) {
      root.style.transform = ''; root.style.opacity = ''; mask.style.opacity = '';
    } else if (reducedMotion()) {
      root.style.transform = 'none'; root.style.opacity = String(p); mask.style.opacity = String(p);
    } else {
      root.style.transform = 'translate3d(' + ((p - 1) * 100).toFixed(3) + '%,0,0)'; root.style.opacity = ''; mask.style.opacity = String(p);
    }
    var on = state === 'open' || state === 'opening' || state === 'dragging';
    root.setAttribute('aria-hidden', on ? 'false' : 'true');
    try { root.inert = !on; } catch (e) {}
    var app = appEl(); if (app) { try { app.inert = interactive; } catch (e) {} }
    if (global.syncStatusColor) global.syncStatusColor();
  }

  function cancelAnim() {
    if (!anim) return;
    if (anim.raf) { try { global.cancelAnimationFrame(anim.raf); } catch (e) {} }
    if (anim.guard) clearTimeout(anim.guard);
    anim = null;
  }
  /* 从当前进度走到 target（0 / 1）。vel：松手速度 px/ms（带方向），甩得快就走得快 */
  function animateTo(target, vel) {
    cancelAnim();
    state = target ? 'opening' : 'closing';
    var from = p, dist = Math.abs(target - from);
    var rm = reducedMotion();
    var dur = rm ? 200 * dist : Math.max(160, DUR * Math.sqrt(dist));
    if (!rm && vel && (target ? vel > 0 : vel < 0)) {
      var byVel = dist * width() / Math.abs(vel) * 1.6;
      dur = Math.max(140, Math.min(dur, byVel));
    }
    dur *= SLOW;
    paint();
    if (dist < 0.002 || dur < 1) { settle(target); return; }
    var tok = { target: target, raf: 0, guard: 0 }, last = -1, el = 0;
    var frame = function (ts) {
      if (anim !== tok) return;
      /* 每帧最多前进 34ms：第一帧要排版整张侧拉页、主线程偶尔卡一下时，画面不会从 0 一下跳到 0.9（宁可慢一点也不跳） */
      if (last >= 0) el += Math.min(34, Math.max(0, ts - last));
      last = ts;
      var k = Math.min(1, el / dur);
      if (k >= 1) { settle(target); return; }
      p = from + (target - from) * (rm ? k : ease(k));
      paint();
      tok.raf = global.requestAnimationFrame(frame);
    };
    tok.raf = global.requestAnimationFrame(frame);
    /* rAF 被节流（后台 / 无头浏览器偶发）时也必须落定：同一个令牌，只调 settle */
    tok.guard = setTimeout(function () { if (anim === tok) settle(target); }, dur * 2 + 300);
    anim = tok;
  }
  /* 唯一的落定点 */
  function settle(target) {
    cancelAnim();
    p = target ? 1 : 0;
    state = target ? 'open' : 'closed';
    paint();
    if (target) {
      closeOpts = null;
      if (global.App && App._histFlush) App._histFlush();
      setTimeout(function () { if (state === 'open' && root && !root.contains(document.activeElement)) { try { root.focus({ preventScroll: true }); } catch (e) {} } }, 60);
      return;
    }
    var o = closeOpts || {}; closeOpts = null;
    closeChildren();
    /* 退掉侧拉页那条记录（连同盖在上面的面板记录）；系统返回已经退掉了，切页时由 pushHistory 改写复用或 showTabNow 自己退 */
    if (!o.fromPop && global.App && App._drawerHist) App._drawerHist.closed();
    /* 动画中排队的 history 写入（菜单项进二级页的改写 / 进设置分组）现在放行——画面已经静止 */
    if (global.App && App._histFlush) App._histFlush();
    if (opener && opener.isConnected && !o.keepHist) { try { opener.focus({ preventScroll: true }); } catch (e) {} }
    opener = null;
  }
  /* 立即落到最近的稳定态（touchcancel / 切后台 / 宽度变化 / 拖拽中的系统返回） */
  function settleNearest() {
    if (state === 'dragging') { drag.reset(); settle(p >= 0.5 ? 1 : 0); return; }
    if (anim) settle(anim.target);
  }

  /* ———— 打开 / 关闭 ———— */
  function isOpen() { return state === 'open' || state === 'opening' || (state === 'dragging' && drag.fromOpen); }
  function histBusy() { return !!(global.App && App._histBusy && App._histBusy()); }
  /* 侧拉页那条记录：画面开始变化之前登记 */
  function ensureEntry() {
    if (global.App && App._drawerHist && !App._drawerHist._entry()) App._drawerHist.open();
  }
  function beginOpen() {
    var ae = document.activeElement;
    /* 键盘开着（例如日期记录页的输入框）先收起，不让它顶着侧拉页 */
    if (ae && ae !== document.body && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) { try { ae.blur(); } catch (e) {} }
    if (!opener || !opener.isConnected) opener = (ae && ae !== document.body) ? ae : null;
    ensureEntry();
    render(); syncW();
  }
  function open() {
    build();
    if (state === 'open' || state === 'opening') return;
    /* 菜单项切页后正在收起（记录已被新页改写）：不倒回去，先落定再按「从关开始」打开 */
    if (state === 'closing' && closeOpts && closeOpts.keepHist) settle(0);
    /* 上一次关闭的 history.back() 还没落地：等 popstate 到了再开（否则新记录会压在马上要被退掉的那条上） */
    if (state === 'closed' && histBusy()) {
      if (!pendingOpen) { pendingOpen = true; App._histIdle(function () { if (pendingOpen && state === 'closed') { pendingOpen = false; open(); } pendingOpen = false; }); }
      return;
    }
    pendingOpen = false;
    var wasClosed = state === 'closed';
    closeOpts = null;
    if (state === 'dragging') drag.reset();
    if (wasClosed) beginOpen();
    if (wasClosed && global.Util && Util.haptic) Util.haptic('light');
    animateTo(1, 0);
    /* 焦点移进侧拉页（对话框本身，不画焦点环）；键盘用户接着 Tab 就是「返回」 */
    if (wasClosed) setTimeout(function () { if (isOpen() && root && !root.contains(document.activeElement)) { try { root.focus({ preventScroll: true }); } catch (e) {} } }, 60);
  }
  /* opts.keepHist：切页（history 由切页处理：进二级页改写复用侧拉页那条，否则 showTabNow 自己退）
     opts.fromPop：系统返回已经退掉了那条记录——直接落定（系统手势已经播过转场） */
  function close(opts) {
    pendingOpen = false; /* 排队等 popstate 的打开一并取消 */
    if (!root || state === 'closed') return;
    opts = opts || {};
    if (state === 'dragging') drag.reset();
    if (opts.fromPop) { closeOpts = { fromPop: true }; settle(0); return; }
    closeOpts = { keepHist: !!opts.keepHist };
    if (state === 'closing') return;
    animateTo(0, opts.vel || 0);
  }
  /* 选了入口：先开始收起，再在同一个任务里画新页——新页在第一帧之前就画好在底下，侧拉页滑走时露出的就是新页。
     先收起再切页，showTabNow 就不会把它当成「侧拉页开着时被别处切页」；进二级页时 pushHistory 改写复用侧拉页那条记录，
     没复用（首页 / 日期记录这类一级页）就在落定时退掉（settle → closed()，没有记录时是空操作）。 */
  function navigate(fn) {
    opener = null;
    if (state !== 'closed') close({ keepHist: true });
    try { fn(); } catch (e) {}
  }
  function syncW() { try { document.documentElement.style.setProperty('--sd-w', width() + 'px'); } catch (e) {} }

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
    mask.className = 'sd-mask'; mask.id = 'sdMask'; /* 第 288 次：挂在 body 上、页面之上侧拉页之下；页面本身不再移动 */
    root = document.createElement('aside');
    root.id = 'sideDrawer'; root.className = 'side-drawer';
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', '全部功能');
    root.setAttribute('aria-hidden', 'true');
    root.setAttribute('tabindex', '-1');
    try { root.inert = true; } catch (e) {}
    panel = document.createElement('div'); panel.className = 'sd-panel';
    root.appendChild(panel);
    document.body.appendChild(mask);
    document.body.appendChild(root);
    watchOverlays();
    /* 冒泡阶段的点击委托（触感层的回声点击见 Util.hapEcho；这里只在开着时响应，收起中 / 已关的点击一律不算） */
    mask.addEventListener('click', function () { if (isOpen()) close(); });
    root.addEventListener('click', function (e) {
      if (state !== 'open' && state !== 'opening') return;
      if (global.Util && Util.hapEcho && Util.hapEcho(e)) return;
      var t = e.target && e.target.closest ? e.target.closest('[data-sd-go],[data-sd]') : null;
      if (!t) return;
      var go = t.getAttribute('data-sd-go'), act = t.getAttribute('data-sd');
      if (act === 'back') { close(); return; }
      if (act === 'search') {
        /* 同一次点击里切页并聚焦输入框，iOS 才会弹出键盘 */
        navigate(function () { if (App.openSearch) App.openSearch(); else App.showTab('search', { noVT: true }); });
        return;
      }
      if (act === 'swap') { if (App._openBabySheet) App._openBabySheet(); return; } /* 面板盖在侧拉页上，选完回到侧拉页 */
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
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && isOpen() && !overlayOpen()) close(); });

  /* ———— 跟手 ————
     一级页任意位置向右横拉打开（第 246 次：最左边缘归 Safari「后退」，不必贴边）；侧拉页开着时向左拉关闭；
     动画进行中按住可以接着拖（从当前进度起步）。松手看位置和速度（≥0.35px/ms 视为甩动）。 */
  var drag = {
    mode: null, decided: false, fromOpen: false, sx: 0, sy: 0, p0: 0, lx: 0, lt: 0, vel: 0, panAny: false, dogT: 0,
    reset: function () { this.mode = null; this.decided = false; this.fromOpen = false; if (this.dogT) { clearTimeout(this.dogT); this.dogT = 0; } }
  };
  function canEdgeOpen() {
    if (!global.App || !App._isTop || !App._isTop()) return false;
    var b = document.body.classList;
    if (b.contains('qd-open') || b.contains('ob-open') || b.contains('ftf-open') || b.contains('ps-pull') || document.documentElement.classList.contains('wp-lock')) return false; /* 第 271 次：白噪音播放页开着时不拉 */
    var mr = document.getElementById('modalRoot');
    if (mr && mr.children.length) return false;
    if (overlayOpen()) return false;
    return !(App.inSub && App.inSub());
  }
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
  function armDog() {
    /* 第 279 次：系统手势（返回 / 控制中心 / 切 App）可能把 touchend、touchcancel 都吞掉：1.2 秒没有新的 touchmove 就按位置落定 */
    if (drag.dogT) clearTimeout(drag.dogT);
    drag.dogT = setTimeout(function () { drag.dogT = 0; if (state === 'dragging') settleNearest(); }, 1200);
  }
  document.addEventListener('touchstart', function (e) {
    /* 上一次拖拽没收到 touchend（被系统手势吞掉）就来了新的触摸：先按位置落定 */
    if (state === 'dragging') settleNearest();
    drag.reset();
    if (!e.touches || e.touches.length !== 1) return;
    var t = e.touches[0];
    drag.panAny = false; drag.vel = 0;
    if (state === 'open' || state === 'opening' || (state === 'closing' && !(closeOpts && closeOpts.keepHist))) {
      if (!overlayOpen()) { drag.mode = 'grab'; drag.fromOpen = state !== 'closing'; } /* 第 279 次：上面盖着面板 / 大图时不拖侧拉页 */
    } else if (state === 'closed' && canEdgeOpen()) {
      var tg = e.target;
      if (t.clientX <= 24) drag.mode = 'open';
      else if (!(tg && tg.closest && tg.closest(NO_PAN)) && !hScrollAncestor(tg)) { drag.mode = 'open'; drag.panAny = true; }
      if (drag.mode) build();
    }
    if (!drag.mode) return;
    drag.sx = t.clientX; drag.sy = t.clientY; drag.lx = drag.sx; drag.lt = Date.now();
  }, { passive: true });
  document.addEventListener('touchmove', function (e) {
    if (!drag.mode || !e.touches || !e.touches.length) return;
    var t = e.touches[0], dx = t.clientX - drag.sx, dy = t.clientY - drag.sy;
    if (!drag.decided) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (Math.abs(dy) > Math.abs(dx)) { drag.reset(); return; }
      if (drag.mode === 'grab' && state === 'open' && dx > 0) { drag.reset(); return; } /* 全开时向右拉没有意义，留给内容 */
      if (drag.mode === 'open' && (dx < 0 || (drag.panAny && Math.abs(dx) < Math.abs(dy) * 1.4))) { drag.reset(); return; }
      if (drag.mode === 'open') {
        if (histBusy()) { drag.reset(); return; } /* 上一次关闭的 history 还没落地，这一下不接管 */
        beginOpen(); /* 先登记 history 再动画面：WebKit 在 pushState 时给当前画面拍系统返回用的快照 */
        drag.p0 = 0;
      } else {
        drag.p0 = p;
      }
      cancelAnim();
      drag.decided = true;
      state = 'dragging';
    }
    var now = Date.now(), dtm = Math.max(1, now - drag.lt);
    drag.vel = drag.vel * 0.4 + ((t.clientX - drag.lx) / dtm) * 0.6; /* px/ms，平滑一下 */
    drag.lx = t.clientX; drag.lt = now;
    var off = dx + (dx > 0 ? -8 : 8); /* 起步判定吃掉的那 8px 不算，免得一判定就跳一下 */
    if (drag.mode === 'open' && !drag.panAny) off = dx; /* 贴边起手不吃 */
    p = Math.max(0, Math.min(1, drag.p0 + off / width()));
    paint();
    armDog();
    if (e.cancelable) e.preventDefault();
  }, { passive: false });
  function endDrag(cancelled) {
    if (!drag.mode) return;
    var decided = drag.decided, vel = drag.vel;
    if (Date.now() - drag.lt > 120) vel = 0; /* 停住再松手不算甩 */
    drag.reset();
    if (!decided || state !== 'dragging') return;
    if (cancelled) { settle(p >= 0.5 ? 1 : 0); return; } /* 第 279 次：被打断不算甩，只看位置，直接落定 */
    var FLING = 0.35;
    var target = vel <= -FLING ? 0 : (vel >= FLING ? 1 : (p >= 0.5 ? 1 : 0));
    if (!target) closeOpts = { keepHist: false };
    animateTo(target, vel);
  }
  document.addEventListener('touchend', function () { endDrag(false); }, { passive: true });
  document.addEventListener('touchcancel', function () { endDrag(true); }, { passive: true });
  /* 拖拽中来了系统返回：先按位置落定，再交给 app.js 的 popstate（侧拉页开着就关） */
  global.addEventListener('popstate', function () { if (state === 'dragging') settleNearest(); }, true);
  global.addEventListener('blur', function () { if (state === 'dragging') settleNearest(); });
  global.addEventListener('pagehide', settleNearest);
  document.addEventListener('visibilitychange', function () { if (document.hidden) settleNearest(); });
  var lastW = global.innerWidth;
  global.addEventListener('resize', function () {
    if (global.innerWidth === lastW) return; /* 只认宽度变化（旋转 / 分屏），键盘收起的高度变化不算 */
    lastW = global.innerWidth; syncW(); settleNearest();
  });

  global.Drawer = {
    open: open, close: close, isOpen: isOpen, _render: render, _settle: settleNearest,
    /* 第 288 次：侧拉页是否还在屏幕上（含收起动画）；状态机当前状态 */
    visible: function () { return state !== 'closed'; },
    state: function () { return state; },
    _slow: function (n) { SLOW = n > 0 ? n : 1; },
    /* 0 = 收起，1 = 全开（拖动 / 动画中是实时进度）；状态栏取色用 */
    progress: function () { return state === 'closed' ? 0 : p; }
  };
})(window);
