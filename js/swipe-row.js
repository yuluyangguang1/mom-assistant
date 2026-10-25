/* ============================================================
 * swipe-row.js · 第 159 次（原生感）：列表行左滑删除
 *
 * 不改各模块：凡是 #view 里带 [data-del] 删除按钮的 <li>，都可以往左滑。
 *  - 往左拖：行跟手左移，右侧长出一块红色「删除」卡片（宽度 = 拖动距离）。
 *  - 松手：拖过 44px 停在打开状态（露出 88px 的删除）；拖过行宽 55% 或快速左甩直接删除。
 *  - 删除就是替用户点一下这行原来的 [data-del] 按钮，所以撤销提示、动画、存档全部沿用原逻辑。
 *  - 同一时间只开一行；点别处、滚动、再往右拖都会收回。
 *  - 竖向滑动优先给页面滚动；从屏幕左边缘起手的右滑留给返回手势。
 * ============================================================ */
(function () {
  'use strict';
  var view = document.getElementById('view');
  if (!view || !('ontouchstart' in window || navigator.maxTouchPoints > 0)) return;

  var OPEN_W = 88, OPEN_AT = 44, FULL_RATIO = 0.55;
  var row = null, act = null, x0 = 0, y0 = 0, base = 0, dx = 0, axis = '', lastX = 0, lastT = 0, vel = 0;
  var openRow = null;

  function delBtnOf(li) {
    var b = li.querySelector('[data-del]');
    return (b && b.closest('li') === li) ? b : null;
  }
  function ensureAct(li) {
    var a = li.querySelector(':scope > .swipe-act');
    if (!a) {
      a = document.createElement('button');
      a.type = 'button';
      a.className = 'swipe-act';
      a.setAttribute('aria-hidden', 'true');
      a.tabIndex = -1;
      a.innerHTML = (window.icon ? icon('trash') : '') + '<span>删除</span>';
      a.addEventListener('click', function (e) { e.stopPropagation(); doDelete(li); });
      li.appendChild(a);
    }
    li.classList.add('sw-row');
    /* 某些行的定位基准落在内容框而不是内边距框（实测偏 10px），这里按实际位置校正，保证删除块与行等高对齐 */
    a.style.top = '0px'; a.style.height = '';
    var lr = li.getBoundingClientRect(), ar = a.getBoundingClientRect();
    a.style.top = (lr.top - ar.top) + 'px';
    a.style.height = lr.height + 'px';
    /* 在所在卡片处横向裁切：行左移不会伸出卡片，删除块从卡片右边缘长出来 */
    var host = li.closest('.card') || li.parentElement;
    if (host) host.classList.add('sw-clip');
    return a;
  }
  function setX(li, a, x, animate) {
    var tr = animate ? 'transform .3s cubic-bezier(.32,.72,0,1)' : 'none';
    li.style.transition = tr;
    li.style.transform = x ? 'translate3d(' + x + 'px,0,0)' : '';
    if (a) {
      a.style.transition = animate ? 'width .3s cubic-bezier(.32,.72,0,1), opacity .2s' : 'none';
      /* 第 174 次：缝隙按删除块的实际位置算——分组列表里删除块贴边（0），卡片里留 8px */
      var gap = Math.max(0, a.offsetLeft - li.clientWidth);
      var w = Math.max(0, -x - gap);
      a.style.width = w + 'px';
      a.style.opacity = w > 4 ? '1' : '0';
      a.classList.toggle('is-full', -x > li.offsetWidth * FULL_RATIO);
    }
  }
  function close(li, animate) {
    if (!li) return;
    var a = li.querySelector(':scope > .swipe-act');
    setX(li, a, 0, animate !== false);
    if (openRow === li) openRow = null;
  }
  function doDelete(li) {
    var b = delBtnOf(li);
    var a = li.querySelector(':scope > .swipe-act');
    openRow = null;
    setX(li, a, -li.offsetWidth - 16, true);
    if (window.Util && window.Util.haptic) window.Util.haptic('light'); else if (navigator.vibrate) { try { navigator.vibrate(10); } catch (e) { /* 忽略 */ } }
    setTimeout(function () {
      li.style.transform = ''; li.style.transition = '';
      if (a) a.remove();
      if (b) b.click();
    }, 180);
  }

  view.addEventListener('touchstart', function (e) {
    if (e.touches.length !== 1) return;
    var t = e.touches[0];
    var li = e.target.closest && e.target.closest('li');
    if (openRow && openRow !== li) close(openRow);
    if (!li || !view.contains(li) || !delBtnOf(li)) { row = null; return; }
    if (e.target.closest('input, textarea, select, .swipe-act, [data-noswipe]')) { row = null; return; }
    if (t.clientX < 24) { row = null; return; } /* 左边缘留给返回手势 */
    row = li; act = null; axis = ''; dx = 0; vel = 0;
    x0 = lastX = t.clientX; y0 = t.clientY; lastT = Date.now();
    base = (openRow === li) ? -OPEN_W : 0;
  }, { passive: true });

  view.addEventListener('touchmove', function (e) {
    if (!row) return;
    var t = e.touches[0];
    var mx = t.clientX - x0, my = t.clientY - y0;
    if (!axis) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      axis = (Math.abs(mx) > Math.abs(my) * 1.2 && (mx < 0 || base < 0)) ? 'x' : 'y';
      if (axis === 'y') { if (openRow) close(openRow); row = null; return; }
      act = ensureAct(row);
      row.classList.add('sw-active');
    }
    if (e.cancelable) e.preventDefault();
    var now = Date.now();
    vel = (t.clientX - lastX) / Math.max(1, now - lastT);
    lastX = t.clientX; lastT = now;
    dx = base + mx;
    if (dx > 0) dx = dx / 5; /* 往右拖过头给阻尼 */
    setX(row, act, dx, false);
  }, { passive: false });

  function end() {
    if (!row) return;
    var li = row; row = null;
    if (axis !== 'x') return;
    li.classList.remove('sw-active');
    /* 吞掉这次拖动后浏览器补发的 click，免得误触行内的编辑 / 删除按钮 */
    var swallow = function (ev) { if (!ev.isTrusted) return; ev.stopPropagation(); ev.preventDefault(); }; /* 只吞系统补发的点击，放行删除时代码触发的那一下 */
    li.addEventListener('click', swallow, true);
    setTimeout(function () { li.removeEventListener('click', swallow, true); }, 350);
    var w = li.offsetWidth || 1;
    if (-dx > w * FULL_RATIO || (vel < -0.9 && -dx > OPEN_AT)) { doDelete(li); return; }
    if (-dx > OPEN_AT) { setX(li, act, -OPEN_W, true); openRow = li; return; }
    close(li);
  }
  view.addEventListener('touchend', end);
  view.addEventListener('touchcancel', end);
  window.addEventListener('scroll', function () { if (openRow && !row) close(openRow); }, { passive: true });
  /* 切页 / 重渲染后旧行已不在，引用自然失效 */
  new MutationObserver(function () { if (openRow && !openRow.isConnected) openRow = null; }).observe(view, { childList: true });
})();
