/**
 * pull-search.js —— 第 276 次：首页下拉出搜索（用户同意把搜索移出 dock）
 *
 * 首页滚到最顶以后继续往下拉：页面跟手往下走（越拉越沉），顶上浮出一条搜索栏；
 * 拉过阈值（72px）松手 = 进搜索页并在同一次松手里聚焦输入框（iOS 只有在用户手势里 focus 才弹键盘）；
 * 没过阈值松手 = 弹回去。
 *
 * 不和系统冲突：只有「起手时页面已在最顶、手指向下、竖向为主、这次 touchmove 还能取消」才接管，
 * 接管后 preventDefault，Safari 标签页的下拉刷新 / 橡皮筋不会同时出现；iOS 主屏应用本来就没有系统刷新。
 * 页面正在惯性滚动（touchmove 不可取消）时不接管。横向手势不接管。
 * 减少动态效果：不跟手平移，只淡入搜索栏，松手不回弹。
 */
(function (global) {
  'use strict';
  var doc = global.document;
  if (!doc) return;

  var TH = 72;        /* 触发阈值（阻尼后的位移，CSS px） */
  var MAX = 150;      /* 位移上限 */
  var bar = null, view = null;
  var sx = 0, sy = 0, oy = 0, mode = null, d = 0, armed = false;

  function reduced() { try { return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; } }
  function ic() { return (global.icon && global.icon('search')) || ''; }
  function ensureBar() {
    if (bar && bar.isConnected) return bar;
    bar = doc.createElement('div');
    bar.className = 'pull-search';
    bar.setAttribute('aria-hidden', 'true');
    bar.innerHTML = '<span class="ps-ico">' + ic() + '</span><span class="ps-txt">下拉搜索</span>';
    doc.body.appendChild(bar);
    return bar;
  }
  function canStart(tg) {
    var b = doc.body, A = global.App;
    if (!A || !A.currentTab || A.currentTab() !== 'home' || !A._isTop || !A._isTop()) return false;
    if ((global.pageYOffset || doc.documentElement.scrollTop || 0) > 0) return false;
    if (b.classList.contains('qd-open') || b.classList.contains('ob-open') || b.classList.contains('ftf-open') || b.classList.contains('sheet-open')) return false;
    if (doc.documentElement.classList.contains('wp-lock') || doc.documentElement.classList.contains('is-booting')) return false;
    var mr = doc.getElementById('modalRoot');
    if (mr && mr.children.length) return false;
    /* 第 278 次（审计 #35）：首页编辑布局 / 「添加组件」面板（#homeSheet 在 #view 里，不进 #modalRoot）开着时不接管下拉 */
    var H = global.Modules && global.Modules.home;
    if (H && (H._edit || H._sheet)) return false;
    if (doc.querySelector('#homeSheet:not([hidden]), .home-sheet:not([hidden]), body > .ph-view')) return false;
    if (tg && tg.closest && tg.closest('input, textarea, select, input[type=range], #tabbar, #dockOrb, #quickDock, .dock-live, [data-no-pull], .record-grid.is-editing')) return false;
    return true;
  }
  /* 阻尼：前 TH 几乎跟手，越往后越沉 */
  function damp(dy) { return Math.min(MAX, dy <= 0 ? 0 : dy * 0.55 / (1 + dy / 700)); }

  function paint(px, dragging) {
    view = view || doc.getElementById('view');
    var red = reduced();
    var p = Math.min(1, px / TH);
    [view, doc.querySelector('#app > .app-header')].forEach(function (el) {
      if (!el) return;
      el.style.transition = dragging ? 'none' : (red ? 'none' : 'transform .5s cubic-bezier(.34, 1.4, .64, 1)');
      el.style.transform = (px > 0 && !red) ? 'translate3d(0,' + px.toFixed(1) + 'px,0)' : '';
    });
    var b = ensureBar();
    b.style.transition = dragging ? 'none' : 'opacity .25s ease, transform .5s cubic-bezier(.34, 1.4, .64, 1)';
    b.style.opacity = String(p);
    b.style.transform = red ? 'none' : 'translate3d(0,' + (Math.min(px, TH) - TH) * 0.5 + 'px,0) scale(' + (0.86 + 0.14 * p).toFixed(3) + ')';
    var now = px >= TH;
    if (now !== armed) {
      armed = now;
      b.classList.toggle('is-armed', now);
      b.querySelector('.ps-txt').textContent = now ? '松手搜索' : '下拉搜索';
      if (now && global.Util && Util.haptic) Util.haptic('light');
    }
  }
  function clearInline() {
    [doc.getElementById('view'), doc.querySelector('#app > .app-header')].forEach(function (el) { if (el) { el.style.transition = ''; el.style.transform = ''; } });
  }
  function reset(animated) {
    doc.body.classList.remove('ps-pull');
    if (animated) paint(0, false);
    else {
      clearInline();
      if (bar) { bar.style.transition = 'none'; bar.style.opacity = '0'; bar.style.transform = ''; bar.classList.remove('is-armed'); }
      armed = false;
    }
    /* 回弹结束后清掉内联样式（不留 transform，免得 #view 成为 fixed 子元素的包含块） */
    setTimeout(function () {
      if (mode) return;
      if (!doc.body.classList.contains('ps-pull')) clearInline();
    }, animated ? 520 : 0);
    if (global.queueStatusColor) global.queueStatusColor();
  }

  doc.addEventListener('touchstart', function (e) {
    mode = null; d = 0;
    if (!e.touches || e.touches.length !== 1) return;
    if (!canStart(e.target)) return;
    var t = e.touches[0];
    sx = t.clientX; sy = t.clientY; oy = sy; mode = 'maybe';
    view = doc.getElementById('view');
  }, { passive: true });

  doc.addEventListener('touchmove', function (e) {
    if (!mode) return;
    var t = e.touches && e.touches[0]; if (!t) return;
    var dx = t.clientX - sx, dy = t.clientY - sy;
    if (mode === 'maybe') {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      /* 向下、竖向为主、页面仍在最顶、本次 move 可取消，才接管 */
      if (dy <= 0 || Math.abs(dy) < Math.abs(dx) * 1.2 || !e.cancelable || (global.pageYOffset || 0) > 0) { mode = null; return; }
      mode = 'pull'; oy = t.clientY;
      doc.body.classList.add('ps-pull');
    }
    if (mode !== 'pull') return;
    if (e.cancelable) e.preventDefault();
    d = damp(t.clientY - oy);
    paint(d, true);
  }, { passive: false });

  function end() {
    if (mode !== 'pull') { mode = null; return; }
    mode = null;
    var go = d >= TH;
    d = 0;
    if (go) {
      reset(false);
      /* 仍在 touchend 里：同步切页 + focus，iOS 会弹出键盘 */
      if (global.App && App.openSearch) App.openSearch();
    } else {
      reset(true);
    }
  }
  doc.addEventListener('touchend', end, { passive: true });
  doc.addEventListener('touchcancel', function () { if (mode === 'pull') { mode = null; d = 0; reset(true); } else mode = null; }, { passive: true });

  global.PullSearch = { _th: TH, _state: function () { return { mode: mode, d: d, armed: armed }; } };
})(window);
