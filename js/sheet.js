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
    setTimeout(function () { if (mask.isConnected) root.innerHTML = ''; sync(); }, 30);
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

  function bindDrag(mask, panel) {
    var y0 = 0, t0 = 0, dy = 0, lastY = 0, lastT = 0, vel = 0, active = false, fromGrab = false;
    function start(e) {
      var t = e.touches ? e.touches[0] : e;
      fromGrab = !!(e.target.closest && e.target.closest('.sheet-grab'));
      /* 内容区：只有面板已在顶部时才接管下拉，否则让它正常滚动 */
      if (!fromGrab && panel.scrollTop > 0) return;
      /* 输入控件里的拖动交给控件（滑块、日期滚轮等） */
      if (!fromGrab && e.target.closest && e.target.closest('input, textarea, select, .date-slider, .ruler, [data-nodrag]')) return;
      active = true; y0 = lastY = t.clientY; t0 = lastT = Date.now(); dy = 0; vel = 0;
    }
    function move(e) {
      if (!active) return;
      var t = e.touches ? e.touches[0] : e;
      var d = t.clientY - y0;
      if (d <= 0 && !fromGrab) { if (dy === 0) { active = false; } return; }
      var now = Date.now();
      vel = (t.clientY - lastY) / Math.max(1, now - lastT);
      lastY = t.clientY; lastT = now;
      dy = d > 0 ? d : d / 4; /* 往上拖给阻尼 */
      panel.style.transition = 'none';
      panel.style.transform = 'translate3d(0,' + dy + 'px,0)';
      mask.style.setProperty('--sheet-dim', String(Math.max(0, 1 - dy / (panel.offsetHeight || 1))));
      if (e.cancelable) e.preventDefault();
    }
    function end() {
      if (!active) return;
      active = false;
      var h = panel.offsetHeight || 1;
      panel.style.transition = 'transform .28s cubic-bezier(.32,.72,0,1)';
      if (dy > h * 0.25 || (vel > 0.6 && dy > 24)) {
        panel.style.transform = 'translate3d(0,100%,0)';
        mask.classList.add('sheet-leaving');
        setTimeout(function () { closeVia(mask); }, 200);
      } else {
        panel.style.transform = '';
        mask.style.removeProperty('--sheet-dim');
        setTimeout(function () { panel.style.transition = ''; }, 300);
      }
    }
    panel.addEventListener('touchstart', start, { passive: true });
    panel.addEventListener('touchmove', move, { passive: false });
    panel.addEventListener('touchend', end);
    panel.addEventListener('touchcancel', end);
    /* 鼠标只从横条拖（桌面调试用） */
    panel.addEventListener('mousedown', function (e) {
      if (!(e.target.closest && e.target.closest('.sheet-grab'))) return;
      start(e);
      function mm(ev) { move(ev); }
      function mu() { end(); document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); }
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
      if (reduceMq.matches || mask.classList.contains('sheet-leaving') || mask.classList.contains('sheet-ghost')) return;
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
      if (gp) { gp.style.transform = ''; gp.style.transition = ''; }
      document.body.appendChild(g);
      if (gp && mask._st) gp.scrollTop = mask._st;
      setTimeout(function () { if (g.parentNode) g.parentNode.removeChild(g); }, 340);
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
  }

  new MutationObserver(sync).observe(root, { childList: true, subtree: false });
  sync();
  /* 第 230 次：#view 里自带的面板（喂养记录表单常驻页面、靠 hidden 开合）也走同一套底部面板呈现。
     attach 在打开时调；reset 在关闭时调，清掉下拉关闭留下的位移，下次打开从头推入。 */
  function attach(mask) {
    enhance(mask);
    document.body.classList.add('sheet-open');
  }
  function reset(mask) {
    var panel = panelOf(mask);
    mask.classList.remove('sheet-leaving');
    mask.style.removeProperty('--sheet-dim');
    if (panel) { panel.style.transform = ''; panel.style.transition = ''; }
    sync();
  }
  window.Sheet = { sync: sync, attach: attach, reset: reset };
})();
