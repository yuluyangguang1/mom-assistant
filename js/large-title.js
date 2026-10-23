/* ============================================================
 * large-title.js · 第 161 次（原生感）：导航大标题收缩
 *
 * 仿 iOS「设置」「健康」：页面顶部是大号标题（.mod-head h1 / .page-head h1），
 * 往下滚到大标题钻进顶栏底下时，顶栏中间的小日期淡出、同名小标题淡入，
 * 进度跟滚动连续变化（不是一下切换）。往下拉过头（橡皮筋回弹）时大标题轻微放大。
 * 首页没有大标题，什么都不做。
 * ============================================================ */
(function () {
  'use strict';
  var view = document.getElementById('view');
  var header = document.querySelector('.app-header');
  var small = document.getElementById('hdrTitle');
  var date = document.getElementById('modDate');
  if (!view || !header || !small) return;

  var h1 = null, raf = 0, lastP = -1;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function bind() {
    var next = view.querySelector('.mod-head h1, .page-head h1');
    if (next !== h1) {
      if (h1) { h1.style.transform = ''; h1.classList.remove('lt-src'); }
      h1 = next;
      if (h1) h1.classList.add('lt-src');
      small.textContent = h1 ? h1.textContent : '';
      lastP = -1;
    }
    update();
  }

  function update() {
    raf = 0;
    if (!h1 || !h1.isConnected || document.body.classList.contains('in-home')) {
      header.classList.remove('lt-on');
      header.style.removeProperty('--lt');
      return;
    }
    var hb = header.getBoundingClientRect().bottom;
    var r = h1.getBoundingClientRect();
    /* 大标题底边越过顶栏底边 → 0；完全没入顶栏 → 1 */
    var p = (hb - (r.top + r.height * 0.2)) / (r.height * 0.8);
    p = p < 0 ? 0 : p > 1 ? 1 : p;
    if (reduce) p = p > 0.5 ? 1 : 0;
    if (Math.abs(p - lastP) > 0.01) {
      header.style.setProperty('--lt', p.toFixed(3));
      header.classList.toggle('lt-on', p > 0.5);
      lastP = p;
    }
    /* 橡皮筋下拉：大标题跟着轻微放大（以左侧为原点），最多 +12% */
    var over = -(window.scrollY || 0);
    if (!reduce && over > 0) h1.style.transform = 'scale(' + (1 + Math.min(over, 120) / 1000) + ')';
    else if (h1.style.transform) h1.style.transform = '';
  }
  function schedule() { if (!raf) raf = requestAnimationFrame(update); }

  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule, { passive: true });
  new MutationObserver(bind).observe(view, { childList: true });
  bind();
})();
