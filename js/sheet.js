/* ============================================================
 * sheet.js · 第 153 次（原生感）：编辑 / 快记类弹窗统一呈现为 iOS 半屏底部面板
 *
 * 不改任何模块的弹窗代码：监听 #modalRoot，凡是新插入的
 *   .modal-mask > .modal[role="dialog"]   （编辑、补记、分享卡片、物品编辑……）
 *   .modal-mask.sheet-mask > .sheet        （宝宝切换，已是底部面板）
 * 在窄屏（≤ 640px）上：
 *   1. 遮罩加 .as-sheet → 面板贴底、通宽、上圆角、从底部推入（CSS）；
 *   2. 顶部插入拖拽横条；
 *   3. 支持下拉关闭：从横条拖，或面板已滚到顶时往下拖；超过 1/4 高度或快速下甩即关闭，否则回弹；
 *   4. 打开期间 body.sheet-open → 背后页面轻微缩小、变暗（iOS 卡片式呈现）。
 * role="alertdialog"（Util.confirm 的确认框）保持居中——iOS 上「确认 / 危险操作」本来就是居中警告框。
 * 关闭沿用各弹窗自己的逻辑：派发一次「点遮罩」事件（各模块都绑了 e.target === mask 即关闭），
 * 兜底再清空 #modalRoot。
 * ============================================================ */
(function () {
  'use strict';
  var root = document.getElementById('modalRoot');
  if (!root || typeof MutationObserver === 'undefined') return;
  var mq = window.matchMedia ? window.matchMedia('(max-width: 640px)') : { matches: true };

  function panelOf(mask) {
    return mask.querySelector(':scope > .modal[role="dialog"]') || mask.querySelector(':scope > .sheet');
  }

  function closeVia(mask) {
    try { mask.dispatchEvent(new MouseEvent('click', { bubbles: true })); } catch (e) { /* 旧内核 */ }
    setTimeout(function () { if (mask.parentNode === root) root.removeChild(mask); sync(); }, 30);
  }

  function enhance(mask) {
    if (mask._sheetDone) return;
    mask._sheetDone = true;
    var panel = panelOf(mask);
    if (!panel || !mq.matches) return;
    mask.classList.add('as-sheet');
    panel.classList.add('is-sheet');
    if (!panel.querySelector(':scope > .sheet-grab')) {
      var g = document.createElement('div');
      g.className = 'sheet-grab';
      g.setAttribute('aria-hidden', 'true');
      g.innerHTML = '<i></i>';
      panel.insertBefore(g, panel.firstChild);
    }
    bindDrag(mask, panel);
    panel.addEventListener('scroll', function () { mask._st = panel.scrollTop; }, { passive: true });
  }

  /* 第 292 次：下拉关闭重写成「被手推着走」——
     ① 跟手：按住横条可上下拖（往上是橡皮筋）；内容区在顶部时往下拖接管；内容区先往上滚、滚回顶部后继续往下拉，
        在那一刻无缝转成拖面板（以前这一下什么都不发生，要松手重来）；拖下去再拖回来不会卡在半路；横向先动交给控件。
     ② 松手：速度取最近 100ms 首尾差（Motion.tracker），用带初速度的临界阻尼弹簧落定——
        轻轻放下慢慢回去，用力一甩飞快收走；收起时遮罩按面板位置逐帧变淡，到底才真正关掉（不再「到 90% 就消失」）。
     ③ 打断：弹回途中再按住 = 从当前位置接着拖；收走途中不接点击（sheet-flinging）。
     ④ touchcancel / 切后台 / 失焦：弹回原位，不停在半路。 */
  function bindDrag(mask, panel) {
    var M = window.Motion;
    var st = null; /* 一次触摸：{ y0, x0, ly, grab, on, base, off, h, cancel } */
    var tr = M ? M.tracker() : null;
    var spr = null;
    function H() { return panel.offsetHeight || 1; }
    function paint(off, h) {
      /* 推入动画是 fill: both，会一直压着内联 transform（动画层级高于内联样式）——第一次跟手就把它摘掉 */
      if (panel.style.animation !== 'none') panel.style.animation = 'none';
      panel.style.transition = 'none';
      panel.style.transform = off ? 'translate3d(0,' + off.toFixed(2) + 'px,0)' : '';
      mask.style.setProperty('--sheet-dim', String(Math.max(0, Math.min(1, 1 - Math.max(0, off) / (h || H()))).toFixed(3)));
    }
    function settleClean() {
      panel.style.transform = ''; panel.style.transition = '';
      mask.style.removeProperty('--sheet-dim');
      mask.classList.remove('sheet-dragging');
    }
    function stopSpr() { var v = null; if (spr) { v = spr.stop(); spr = null; } mask._spr = null; return v; }
    function snapBack(off, vel) {
      stopSpr();
      if (!M || !off) { settleClean(); return; }
      var h = H();
      spr = mask._spr = M.spring({ from: off, to: 0, velocity: vel, response: 0.3, damping: 1,
        onUpdate: function (v) { paint(v, h); },
        onDone: function () { spr = mask._spr = null; settleClean(); } });
    }
    function dismiss(off, vel) {
      stopSpr();
      var h = H();
      mask.classList.add('sheet-flinging');
      var fin = function () { spr = mask._spr = null; panel.style.transform = 'translate3d(0,100%,0)'; mask.classList.add('sheet-leaving'); closeVia(mask); };
      if (!M) { fin(); return; }
      /* 目标放在屏幕外一截，弹簧尾巴不拖沓：一出屏就收工 */
      spr = mask._spr = M.spring({ from: off, to: h + 60, velocity: Math.max(vel, 0.6), response: 0.34, damping: 1,
        onUpdate: function (v) { paint(Math.min(v, h), h); if (v >= h && spr) { spr.stop(); fin(); } },
        onDone: function () { if (mask._spr) fin(); } });
    }
    function begin(t, base) {
      st.on = true; st.base = base; st.h = H();
      mask.classList.add('sheet-dragging');
      if (tr) tr.reset(t.clientY);
    }
    function start(e) {
      if (mask.classList.contains('sheet-flinging') || mask.classList.contains('sheet-leaving')) return;
      var t = e.touches ? e.touches[0] : e;
      if (e.touches && e.touches.length !== 1) { st = null; return; }
      var grab = !!(e.target.closest && e.target.closest('.sheet-grab'));
      /* 弹回途中被按住：从当前位置接着拖 */
      if (spr) {
        var cur = stopSpr() || 0;
        st = { x0: t.clientX, y0: t.clientY, ly: t.clientY, grab: true, on: false, off: cur };
        begin(t, t.clientY - cur); paint(cur, st.h);
        return;
      }
      /* 输入控件里的拖动交给控件（滑块、日期滚轮等） */
      if (!grab && e.target.closest && e.target.closest('input, textarea, select, .date-slider, .ruler, [data-nodrag]')) { st = null; return; }
      st = { x0: t.clientX, y0: t.clientY, ly: t.clientY, grab: grab, on: false, off: 0 };
    }
    function move(e) {
      if (!st) return;
      var t = e.touches ? e.touches[0] : e;
      if (!t) return;
      var dx = t.clientX - st.x0, dy = t.clientY - st.y0, down = t.clientY > st.ly;
      st.ly = t.clientY;
      if (!st.on) {
        if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) { st = null; return; }
        if (st.grab) { if (Math.abs(dy) < 4) return; begin(t, st.y0); }
        else {
          /* 内容区：面板在顶部且手指往下走才接管；滚动中途回到顶部也在这一刻接管（基线取当前点，面板从 0 开始跟） */
          if (panel.scrollTop > 0 || !down) { if (dy < -6 && panel.scrollTop <= 0 && !st.moved) { st = null; return; } st.moved = st.moved || Math.abs(dy) > 6; return; }
          if (e.cancelable === false) return; /* 原生滚动已经在走，这一下拦不住：不抢 */
          if (Math.abs(dy) < 4 && !st.moved) return;
          begin(t, st.moved ? t.clientY : st.y0);
        }
      }
      var raw = t.clientY - st.base;
      st.off = raw >= 0 ? raw : (st.grab && M ? M.rubber(raw, st.h * 0.4) : 0);
      if (tr) tr.add(t.clientY);
      paint(st.off, st.h);
      if (e.cancelable) e.preventDefault();
    }
    function end(cancelled) {
      var s = st; st = null;
      if (!s || !s.on) return;
      mask.classList.remove('sheet-dragging');
      var vel = cancelled || !tr ? 0 : tr.velocity();
      var h = s.h || H();
      var go = !cancelled && s.off > 0 && (M ? M.shouldDismiss(s.off, vel, h) : (s.off > h * 0.25 || vel > 0.5));
      /* 被打断（touchcancel / 切后台：后台 rAF 不跑）= 立刻回原位 */
      if (go) dismiss(s.off, vel); else if (cancelled) { stopSpr(); settleClean(); } else snapBack(s.off, vel);
    }
    panel.addEventListener('touchstart', start, { passive: true });
    panel.addEventListener('touchmove', move, { passive: false });
    panel.addEventListener('touchend', function () { end(false); });
    panel.addEventListener('touchcancel', function () { end(true); });
    function cancelAll() { if (st && st.on) end(true); }
    window.addEventListener('blur', cancelAll);
    window.addEventListener('pagehide', cancelAll);
    document.addEventListener('visibilitychange', function () { if (document.hidden) cancelAll(); });
    /* 鼠标只从横条拖（桌面调试用） */
    panel.addEventListener('mousedown', function (e) {
      if (!(e.target.closest && e.target.closest('.sheet-grab'))) return;
      start(e);
      function mm(ev) { move(ev); }
      function mu() { end(false); document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); }
      document.addEventListener('mousemove', mm);
      document.addEventListener('mouseup', mu);
    });
  }

  /* 第 270 次（真机录屏：点 ✕ / 保存后，记录面板一帧之内整块消失，页面「跳」回来）：
     各模块关面板都是直接把节点从 #modalRoot 删掉。这里在删掉的那一刻放一个「替身」到 body 上——
     原面板的克隆（去掉 id、不可交互、读屏忽略），让它沿原路滑下去、遮罩淡掉，再移除。
     下拉关闭（已滑出屏幕，带 sheet-leaving）、换成另一个面板、减少动态效果时不放替身。 */
  var reduceMq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  function ghostOut(mask) {
    try {
      if (reduceMq.matches || mask.classList.contains('sheet-leaving') || mask.classList.contains('sheet-flinging') || mask.classList.contains('sheet-ghost')) return;
      if (root.querySelector('.modal-mask.as-sheet')) return;
      var panel = panelOf(mask); if (!panel) return;
      var g = mask.cloneNode(true);
      var src = mask.querySelectorAll('input, textarea, select'), dst = g.querySelectorAll('input, textarea, select');
      for (var i = 0; i < src.length && i < dst.length; i++) {
        try { if (src[i].type === 'checkbox' || src[i].type === 'radio') dst[i].checked = src[i].checked; else if (src[i].type !== 'file') dst[i].value = src[i].value; } catch (eV) {}
      }
      g.removeAttribute('id');
      Array.prototype.forEach.call(g.querySelectorAll('[id]'), function (n) { n.removeAttribute('id'); });
      g.classList.add('sheet-ghost');
      g.setAttribute('aria-hidden', 'true');
      try { g.inert = true; } catch (eI) {}
      var gp = panelOf(g);
      if (gp) { gp.style.transform = ''; gp.style.transition = ''; gp.style.animation = ''; }
      document.body.appendChild(g);
      if (gp && mask._st) gp.scrollTop = mask._st;
      setTimeout(function () { if (g.parentNode) g.parentNode.removeChild(g); }, 380);
    } catch (e) { /* 替身只是观感，失败不影响关闭 */ }
  }

  function sync(muts) {
    if (muts && muts.length) {
      muts.forEach(function (m) {
        Array.prototype.forEach.call(m.removedNodes || [], function (n) {
          if (n.nodeType === 1 && n.classList.contains('modal-mask') && n.classList.contains('as-sheet')) ghostOut(n);
        });
      });
    }
    var masks = root.querySelectorAll('.modal-mask');
    var anySheet = false;
    Array.prototype.forEach.call(masks, function (m) { enhance(m); if (m.classList.contains('as-sheet')) anySheet = true; });
    document.body.classList.toggle('sheet-open', anySheet);
    if (window.Util && Util.placeToasts) Util.placeToasts(); /* 第 272 次：提示条让开面板的吸底保存条 */
  }

  new MutationObserver(sync).observe(root, { childList: true, subtree: false });
  sync();
  /* 第 230 次：#view 里自带的面板（喂养记录表单常驻页面、靠 hidden 开合）也走同一套底部面板呈现。
     attach 在打开时调；reset 在关闭时调，清掉下拉关闭留下的位移，下次打开从头推入。 */
  function attach(mask) {
    enhance(mask);
    document.body.classList.add('sheet-open');
    if (window.Util && Util.placeToasts) Util.placeToasts();
  }
  function reset(mask) {
    var panel = panelOf(mask);
    if (mask._spr) { try { mask._spr.stop(); } catch (eS) {} mask._spr = null; }
    mask.classList.remove('sheet-leaving'); mask.classList.remove('sheet-flinging'); mask.classList.remove('sheet-dragging');
    mask.style.removeProperty('--sheet-dim');
    if (panel) { panel.style.transform = ''; panel.style.transition = ''; panel.style.animation = ''; }
    sync();
  }
  /* 第 272 次（审计 #11：键盘弹出时备注框被遮）：
     ① iOS 弹键盘只缩 visualViewport、不缩布局视口，贴底的面板（连同吸底保存条）整块压在键盘后面。
        键盘高度 = 布局视口底 − visualViewport 底，超过 80px 就把遮罩底边抬到键盘上沿（--kb），面板最高也收到可见高度内，
        保存条跟着停在键盘上方。
     ② 聚焦的输入框要落在「吸底保存条上沿」之上：聚焦时、键盘动画结束后、visualViewport 变化时各量一次，
        不够就滚面板（滚不动时面板底部临时多垫出空间）。 */
  var vv = window.visualViewport || null;
  function kbHeight() {
    if (!vv) return 0;
    var k = (window.innerHeight || 0) - (vv.offsetTop + vv.height);
    return k > 80 ? Math.round(k) : 0;
  }
  function focusedField() {
    var el = document.activeElement;
    if (!el || !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || /^(button|checkbox|radio|range|file)$/.test(el.type || '')) return null;
    var panel = el.closest && el.closest('.is-sheet');
    return panel ? { el: el, panel: panel } : null;
  }
  function fitKeyboard() {
    var kb = kbHeight();
    Array.prototype.forEach.call(document.querySelectorAll('.modal-mask.as-sheet'), function (m) {
      if (kb) { m.style.setProperty('--kb', kb + 'px'); m.classList.add('kb-up'); }
      else { m.style.removeProperty('--kb'); m.classList.remove('kb-up'); }
    });
    var f = focusedField(); if (!f) return;
    var vb = vv ? vv.offsetTop + vv.height : window.innerHeight;
    var lim = vb - 12;
    var bar = f.panel.querySelector('.rs-savebar, .modal-actions');
    if (bar && !bar.contains(f.el)) {
      var br = bar.getBoundingClientRect();
      if (br.top < lim && br.bottom > br.top) lim = Math.min(lim, br.top - 2);
    }
    var r = f.el.getBoundingClientRect();
    var pr = f.panel.getBoundingClientRect();
    var topLim = Math.max(pr.top, vv ? vv.offsetTop : 0) + 30;
    var need = 0;
    if (r.bottom > lim) need = r.bottom - lim;
    else if (r.top < topLim) need = r.top - topLim;
    if (!need) return;
    var room = f.panel.scrollHeight - f.panel.clientHeight - f.panel.scrollTop;
    if (need > room) f.panel.style.paddingBottom = 'calc(18px + env(safe-area-inset-bottom) + ' + Math.ceil(need - room + 4) + 'px)';
    f.panel.scrollTop += need;
  }
  var fitT = 0;
  function queueFit(delay) { clearTimeout(fitT); fitT = setTimeout(fitKeyboard, delay || 0); }
  document.addEventListener('focusin', function (e) {
    if (!e.target || !e.target.closest || !e.target.closest('.is-sheet')) return;
    queueFit(60); setTimeout(fitKeyboard, 360); /* 键盘推起动画约 0.3 秒 */
  }, true);
  document.addEventListener('focusout', function (e) {
    var p = e.target && e.target.closest && e.target.closest('.is-sheet');
    if (p) setTimeout(function () { if (!focusedField()) { p.style.paddingBottom = ''; queueFit(0); } }, 120);
  }, true);
  if (vv) { vv.addEventListener('resize', function () { queueFit(30); }); vv.addEventListener('scroll', function () { queueFit(30); }); }
  window.addEventListener('resize', function () { queueFit(30); });

  /* 第 272 次（审计 #2：面板开着时侧滑 / 系统返回，页面回了首页、面板还浮在上面，点保存照样写进去）：
     给 app.js 一个「关掉最上面那层面板」的出口：返回时先关面板、留在原页；真正切页时关掉全部。
     关法与下拉关闭相同：派发一次「点遮罩」（各模块都绑了 e.target === mask 即关闭），没关掉再兜底移除 / 藏起。 */
  function openMasks() {
    var a = Array.prototype.filter.call(root.querySelectorAll(':scope > .modal-mask'), function (m) {
      return !m.classList.contains('sheet-ghost') && !m.classList.contains('sheet-leaving');
    });
    var v = document.getElementById('view');
    if (v) Array.prototype.forEach.call(v.querySelectorAll('.modal-mask:not([hidden])'), function (m) { a.push(m); });
    return a;
  }
  function closeMask(m) {
    try { m.dispatchEvent(new MouseEvent('click', { bubbles: true })); } catch (e) { /* 旧内核 */ }
    if (m.parentNode === root) { if (m.isConnected) root.removeChild(m); }
    else if (m.isConnected && !m.hidden) { m.hidden = true; reset(m); }
    else if (m.parentNode !== root) reset(m);
    sync();
  }
  function isOpen() { return openMasks().length > 0; }
  function closeTop() { var a = openMasks(); if (!a.length) return false; closeMask(a[a.length - 1]); return true; }
  /* 换页时不放下滑替身（新页已经画出来了），直接收掉 */
  function closeAll() { var a = openMasks(), n = 0; a.forEach(function (m) { m.classList.add('sheet-leaving'); }); while (a.length && n++ < 6) { closeMask(a.pop()); } return n > 0; }
  window.Sheet = { sync: sync, attach: attach, reset: reset, isOpen: isOpen, closeTop: closeTop, closeAll: closeAll };
})();
