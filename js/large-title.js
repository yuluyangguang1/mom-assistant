/* ============================================================
 * large-title.js · 第 161 次（原生感）：导航大标题
 *
 * 页面顶部的大号标题（.mod-head h1 / .page-head h1）在往下拉过头（橡皮筋回弹）时
 * 以左侧为原点轻微放大，最多 +12%，仿 iOS「设置」「健康」。
 * 第 169 次：顶栏改为 static 后，滚动时顶栏出现小标题的部分已删除，只保留这一项。
 * 首页没有大标题，什么都不做。
 * ============================================================ */
(function () {
  'use strict';
  var view = document.getElementById('view');
  if (!view) return;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return;
  var h1 = null, raf = 0;

  function bind() {
    var next = view.querySelector('.mod-head h1, .page-head h1');
    if (next !== h1) {
      if (h1) { h1.style.transform = ''; h1.classList.remove('lt-src'); }
      h1 = next;
      if (h1) h1.classList.add('lt-src');
    }
    update();
  }
  function update() {
    raf = 0;
    if (!h1 || !h1.isConnected) return;
    var over = -(window.scrollY || 0);
    if (over > 0) h1.style.transform = 'scale(' + (1 + Math.min(over, 120) / 1000) + ')';
    else if (h1.style.transform) h1.style.transform = '';
  }
  function schedule() { if (!raf) raf = requestAnimationFrame(update); }

  window.addEventListener('scroll', schedule, { passive: true });
  new MutationObserver(bind).observe(view, { childList: true });
  bind();
})();
