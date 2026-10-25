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
  /* 第 262 次：状态栏改实色后颜色跟 theme-color 走。启动期间保持启动图同色，
     App 主题算好的颜色先存着，动画层移除时再写上，避免深色动画顶着一条浅色状态栏。 */
  var pendingTheme = null;
  function writeThemeColor(c) {
    var m = doc.querySelector('meta[name="theme-color"]');
    if (m && c) m.setAttribute('content', c);
  }
  function remove() {
    if (gone) return; gone = true;
    if (el && el.parentNode) el.parentNode.removeChild(el);
    doc.documentElement.classList.remove('is-booting');
    if (pendingTheme) writeThemeColor(pendingTheme);
  }
  function setThemeColor(c) { if (gone) writeThemeColor(c); else pendingTheme = c; }
  var standalone = false;
  try { standalone = global.navigator.standalone === true || (global.matchMedia && global.matchMedia('(display-mode: standalone)').matches); } catch (e) { /* */ }
  if (!el || !standalone) { remove(); global.Boot = { done: function () {}, setThemeColor: setThemeColor }; return; }
  /* 第 262 次：去掉沉浸式状态栏后，WebView 从状态栏下沿开始，而启动图铺满整屏。
     启动图里文字块中心在整屏 44% 处 → 换算到 WebView 坐标：0.44 × 屏高 − 状态栏高。
     状态栏高 = screen.height − innerHeight（旧装沉浸式时为 0，结果就是 44%）；
     WebView 首帧尺寸可能还没定，resize 时再算一次。 */
  function place() {
    var sh = global.screen && global.screen.height, ih = global.innerHeight;
    if (!sh || !ih) return;
    var bar = Math.max(0, Math.min(80, sh - ih));
    el.style.setProperty('--boot-y', (0.44 * sh - bar) + 'px');
  }
  place();
  global.addEventListener('resize', place);
  doc.documentElement.classList.add('is-booting');
  var reduce = false;
  try { reduce = global.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* */ }
  var fallback = setTimeout(remove, 5000);
  /* 第 260 次：防卡顿——首页渲染刚结束时主线程还在解码图片、算玻璃折射、注册 SW，
     此时开播会掉帧。等 window load + 两帧 + 一小段空闲再开播，动画只动 transform / opacity。 */
  function afterSettled(fn) {
    function go() {
      global.requestAnimationFrame(function () { global.requestAnimationFrame(function () { setTimeout(fn, 160); }); });
    }
    if (doc.readyState === 'complete') go(); else global.addEventListener('load', go, { once: true });
  }
  /* 第 261 次：收尾不再整层淡出——
     首次启动时下面是引导页，它也有一枚同尺寸的图标（.ob-logo），整层淡出会两枚图标、两行「咿呀记」叠成重影。
     有 .ob-logo：动画层的图标直接飞到它的位置（只动 transform），文字和泡泡先淡掉、背景色渐隐，
     落位后把引导页图标显出来、移除动画层——同一枚图标「落进」页面，没有第二枚。
     没有（日常启动直接进首页）：图标和文字先淡出，背景再淡，不和首页内容交叠。 */
  function finish() {
    if (gone) return;
    var ico = el.querySelector('.boot-ico img');
    var logo = doc.querySelector('.ob-logo');
    var b = logo && logo.getBoundingClientRect();
    if (ico && b && b.width > 0 && b.bottom > 0 && b.top < global.innerHeight) {
      var a = ico.getBoundingClientRect();
      logo.style.visibility = 'hidden';
      el.classList.add('is-fly');
      /* 下一帧再写目标位置，保证 transition 从当前位置起跑 */
      global.requestAnimationFrame(function () {
        ico.style.transform = 'translate(' + (b.left - a.left) + 'px,' + (b.top - a.top) + 'px) scale(' + (b.width / a.width) + ')';
      });
      setTimeout(function () { logo.style.visibility = ''; remove(); }, 560);
      return;
    }
    el.classList.add('is-out');
    setTimeout(remove, 520);
  }
  global.Boot = {
    setThemeColor: setThemeColor,
    done: function () {
      if (gone || el.classList.contains('is-play')) return;
      afterSettled(function () {
        if (gone) return;
        if (reduce) { el.classList.add('is-out'); setTimeout(remove, 460); return; }
        el.classList.add('is-play');
        clearTimeout(fallback); fallback = setTimeout(remove, 3000); /* 开播后重新计兜底，不在动画中途硬切 */
        setTimeout(finish, 1150);
      });
    }
  };
})(window);
