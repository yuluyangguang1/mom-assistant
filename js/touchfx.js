/**
 * touchfx.js —— 第 246 次：触摸反馈（用户：点按反馈很小、手指划过卡片没有任何反馈、苹果网页没震动）
 *
 * ① 按压：手指按上按钮 / 卡片立刻缩一点（按钮 0.95，卡片 0.98），松手带一点回弹（弹簧曲线）。
 *    用 Web Animations 动 CSS 的 scale 属性——不碰元素自己的 transform / transition，不和已有样式打架。
 * ② 光斑：手指在卡片上（包括滑动页面时手指扫过的卡片）出现一团跟手的柔光，离开淡出。
 *    一个全局浮层，按当前卡片的位置和圆角贴上去，z-index 低于 dock。
 * ③ 触感：真正点下去（没滑动）的按钮给一次轻触感；iOS 走 Util.haptic 里的 switch 方案。
 * 只处理触摸（pointerType / touch 事件），鼠标不受影响；系统「减少动态效果」时不做按压动画和光斑。
 */
(function (global) {
  'use strict';
  var PRESS_SEL = 'button, [role="button"], a[href], summary, label.row-switch, .record-tile, .canvas-card[data-go], .tool-item, .sd-row, .sheet-card, .seg-btn';
  var GLOW_SEL = '.card, .record-tile, .canvas-card, .tool-item, .sd-row, .sheet-card, .set-group > summary, .hq-b, .hn-q';
  var SKIP_SEL = '#tabbar, #dockOrb, #quickDock .qd-fab, .record-grid.is-editing, .tp-off, input, textarea, select';
  var BIG_SEL = '.card, .record-tile, .canvas-card, .sheet-card, .sd-row, .set-group > summary';

  var reduce = false;
  try { reduce = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

  var glow = null, glowEl = null, gx = 0, gy = 0, raf = 0;
  var pressEl = null, pressAnim = null, sx = 0, sy = 0, moved = false, startT = 0;

  function ensureGlow() {
    if (glow) return glow;
    glow = document.createElement('div');
    glow.className = 'touch-glow';
    glow.setAttribute('aria-hidden', 'true');
    document.body.appendChild(glow);
    return glow;
  }
  function closest(el, sel) { return (el && el.closest) ? el.closest(sel) : null; }

  function paintGlow() {
    raf = 0;
    if (!glowEl || !glow) return;
    var r = glowEl.getBoundingClientRect();
    if (!r.width || !r.height) return;
    var cs = global.getComputedStyle(glowEl);
    glow.style.left = r.left + 'px'; glow.style.top = r.top + 'px';
    glow.style.width = r.width + 'px'; glow.style.height = r.height + 'px';
    glow.style.borderRadius = cs.borderRadius;
    glow.style.setProperty('--gx', (gx - r.left) + 'px');
    glow.style.setProperty('--gy', (gy - r.top) + 'px');
    glow.classList.add('on');
  }
  function moveGlow(x, y) {
    if (reduce) return;
    gx = x; gy = y;
    var el = document.elementFromPoint ? document.elementFromPoint(x, y) : null;
    var g = closest(el, GLOW_SEL);
    if (g && closest(g, SKIP_SEL)) g = null;
    if (g && document.body.classList.contains('home-dragging')) g = null;
    if (!g) { hideGlow(); return; }
    ensureGlow();
    if (g !== glowEl) { glowEl = g; glow.classList.remove('on'); }
    if (!raf) raf = requestAnimationFrame(paintGlow);
  }
  function hideGlow() {
    glowEl = null;
    if (glow) glow.classList.remove('on');
  }

  function pressDown(el) {
    if (reduce || !el.animate) return;
    var s = el.matches(BIG_SEL) ? 0.98 : 0.94;
    try {
      pressAnim = el.animate([{ scale: '1' }, { scale: String(s) }], { duration: 110, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' });
    } catch (e) { pressAnim = null; }
  }
  function pressUp(el) {
    if (!el) return;
    var from = '1';
    try { from = global.getComputedStyle(el).scale || '1'; } catch (e) {}
    if (pressAnim) { try { pressAnim.cancel(); } catch (e) {} pressAnim = null; }
    if (reduce || !el.animate || from === '1' || from === 'none') return;
    try { el.animate([{ scale: from }, { scale: '1' }], { duration: 420, easing: 'cubic-bezier(.34,1.56,.64,1)' }); } catch (e) {}
  }

  /* 第 249 次（真机：iPhone 还是不震）：新版 iOS 只认「手指真实点到」switch 的 label，脚本调 label.click() 不再出触感。
     做法同 ios-haptics：手指按下时，给被按的按钮里塞一层透明 label（盖满按钮、内含隐藏的 switch）。
     松手时系统把点击真正派给这层 label → 切换 switch → 系统触感；点击事件照常冒泡到按钮，原有逻辑不受影响。
     只给「叶子」按钮装：里面还有别的按钮 / 链接 / 输入框的卡片不装，免得挡住里面的小按钮。 */
  var IOS_HAP = !(global.navigator && typeof navigator.vibrate === 'function') && ('ontouchstart' in global);
  var HAP_SEL = 'button, [role="button"], .record-tile, .canvas-card[data-go], .sd-row, .tool-item, .seg-btn';
  var HAP_SKIP = 'a, label, input, select, textarea, .record-grid.is-editing, .sw-row, [data-no-haptic]';
  var INNER = 'button, a, input, select, textarea, label, [role="button"], [data-go], [data-act], [data-del]';
  function hapOn() {
    try { var d = global.Storage && Storage.get && Storage.get(); return !(d && d.settings && d.settings.hapticEnabled === false); } catch (e) { return true; }
  }
  function armHaptic(el) {
    if (!el || el.disabled || el.querySelector(':scope > label[data-hap]')) return;
    if (el.querySelector(INNER)) return;
    var lb = document.createElement('label');
    lb.setAttribute('data-hap', ''); lb.setAttribute('aria-hidden', 'true');
    lb.className = 'hap-layer';
    var sw = document.createElement('input');
    sw.type = 'checkbox'; sw.setAttribute('switch', ''); sw.tabIndex = -1;
    sw.className = 'hap-sw';
    sw.addEventListener('click', function (ev) { ev.stopPropagation(); });
    lb.appendChild(sw);
    if (global.getComputedStyle(el).position === 'static') el.style.position = 'relative';
    el.appendChild(lb);
  }
  /* 提前装好（iOS 在手指按下那一刻就定好点击目标，按下时才塞可能来不及）：
     页面每次重绘后，下一帧把可见的叶子按钮都装上；按下时再兜底装一次 */
  var armQueued = false;
  function armAll() {
    armQueued = false;
    if (!hapOn()) return;
    var list = document.querySelectorAll(HAP_SEL);
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (el.querySelector(':scope > label[data-hap]') || closest(el, HAP_SKIP)) continue;
      armHaptic(el);
    }
  }
  function queueArm() { if (!armQueued) { armQueued = true; requestAnimationFrame(armAll); } }
  /* 第 281 次：label 激活派发给 switch 的合成 click 不再进到任何人的捕获阶段监听（文档里的那份在 window 捕获最先拦下；
     按钮已脱离文档的那份到不了 window，由各委托监听用 Util.hapEcho 过滤）。只停传播、不 preventDefault，switch 照常切换出触感。 */
  if (IOS_HAP) {
    global.addEventListener('click', function (ev) {
      var t = ev.target;
      if (t && t.nodeType === 1 && t.tagName === 'INPUT' && (t.id === '__hapSw' || (t.classList && t.classList.contains('hap-sw')))) ev.stopImmediatePropagation();
    }, true);
  }
  if (IOS_HAP) {
    try {
      new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          var n = muts[i].addedNodes;
          for (var k = 0; k < n.length; k++) {
            if (n[k].nodeType === 1 && !(n[k].hasAttribute && n[k].hasAttribute('data-hap'))) { queueArm(); return; }
          }
        }
      }).observe(document.body, { childList: true, subtree: true });
    } catch (e) {}
    queueArm();
    document.addEventListener('touchstart', function (e) {
      if (!hapOn()) return;
      var el = closest(e.target, HAP_SEL);
      if (!el || closest(el, HAP_SKIP) || el.getAttribute('aria-disabled') === 'true') return;
      armHaptic(el);
    }, { passive: true, capture: true });
  }

  document.addEventListener('touchstart', function (e) {
    if (!e.touches || e.touches.length !== 1) return;
    var t = e.touches[0];
    sx = t.clientX; sy = t.clientY; moved = false; startT = Date.now();
    var el = closest(e.target, PRESS_SEL);
    if (el && (el.disabled || el.getAttribute('aria-disabled') === 'true' || closest(el, SKIP_SEL))) el = null;
    pressEl = el;
    if (el) pressDown(el);
    moveGlow(sx, sy);
  }, { passive: true, capture: true });

  document.addEventListener('touchmove', function (e) {
    var t = e.touches && e.touches[0];
    if (!t) return;
    if (!moved && (Math.abs(t.clientX - sx) > 8 || Math.abs(t.clientY - sy) > 8)) {
      moved = true;
      if (pressEl) { pressUp(pressEl); pressEl = null; }
    }
    /* 第 286 次：日期页分页（内容区 / 周条）手指一动就收起光斑、不再跟——跟着走要每帧量一次被拖动元素的位置，等于每帧强制排版 */
    if (moved && closest(e.target, '.cal-pager, .ws-pager')) { if (glowEl) hideGlow(); return; }
    moveGlow(t.clientX, t.clientY);
  }, { passive: true, capture: true });

  function end() {
    var el = pressEl;
    pressEl = null;
    if (el) {
      pressUp(el);
      /* 点下去（没滑动、不是长按）才给触感；在 touchend 里调用，iOS 认作用户手势 */
      if (!IOS_HAP && !moved && Date.now() - startT < 600 && global.Util && Util.haptic) Util.haptic('light');
    }
    setTimeout(hideGlow, 60);
  }
  document.addEventListener('touchend', end, { passive: true, capture: true });
  document.addEventListener('touchcancel', function () { if (pressEl) { pressUp(pressEl); pressEl = null; } hideGlow(); }, { passive: true, capture: true });
  global.addEventListener('scroll', function () { if (glowEl && !raf) raf = requestAnimationFrame(paintGlow); }, { passive: true });

  global.TouchFX = { _glow: function () { return glow; } };
})(window);
