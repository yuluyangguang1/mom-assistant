/* ============================================================
 * boot.js · 第 259 次：启动动画
 *
 * iOS 的启动画面（apple-touch-startup-image）是一张静态图，而且不分深浅色——
 * 它只认第一张匹配的图。所以启动画面统一做成深暖棕底（白天晚上都不刺眼），
 * index.html 里的 #boot 与它逐像素同布局，接住静态图，
 * 等首页画好后播一小段：宝宝图标轻轻一弹、冒出三个「咿呀」泡泡，然后整层淡出。
 *
 * 只在「添加到主屏幕」的独立模式下播（那里才有静态启动图要接）；
 * 浏览器里直接拿掉。减少动态效果时只淡出。任何情况下 5 秒兜底移除。
 * ============================================================ */
(function (global) {
  'use strict';
  var doc = global.document;
  var el = doc.getElementById('boot');
  var gone = false;
  function remove() {
    if (gone) return; gone = true;
    if (el && el.parentNode) el.parentNode.removeChild(el);
    doc.documentElement.classList.remove('is-booting');
  }
  var standalone = false;
  try { standalone = global.navigator.standalone === true || (global.matchMedia && global.matchMedia('(display-mode: standalone)').matches); } catch (e) { /* */ }
  if (!el || !standalone) { remove(); global.Boot = { done: function () {} }; return; }
  doc.documentElement.classList.add('is-booting');
  var reduce = false;
  try { reduce = global.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* */ }
  setTimeout(remove, 5000);
  /* 第 260 次：防卡顿——首页渲染刚结束时主线程还在解码图片、算玻璃折射、注册 SW，
     此时开播会掉帧。等 window load + 两帧 + 一小段空闲再开播，动画只动 transform / opacity。 */
  function afterSettled(fn) {
    function go() {
      global.requestAnimationFrame(function () { global.requestAnimationFrame(function () { setTimeout(fn, 160); }); });
    }
    if (doc.readyState === 'complete') go(); else global.addEventListener('load', go, { once: true });
  }
  global.Boot = {
    done: function () {
      if (gone || el.classList.contains('is-play')) return;
      afterSettled(function () {
        if (gone) return;
        if (reduce) { el.classList.add('is-out'); setTimeout(remove, 460); return; }
        el.classList.add('is-play');
        setTimeout(function () { el.classList.add('is-out'); }, 1250);
        setTimeout(remove, 1720);
      });
    }
  };
})(window);
