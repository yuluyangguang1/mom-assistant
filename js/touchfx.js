/**
 * touchfx.js —— 第 246 次：触摸反馈（用户：点按反馈很小、手指划过卡片没有任何反馈、苹果网页没震动）
 *
 * ① 按压：手指按上按钮 / 卡片立刻缩一点，松手带一点回弹（弹簧曲线）。第 334 次起三档缩放 + 列表行底色都读 CSS 变量 --press-*（见 styles.css :root）。
 *    用 Web Animations 动 CSS 的 scale 属性——不碰元素自己的 transform / transition，不和已有样式打架。
 * ② 光斑：手指在卡片上（包括滑动页面时手指扫过的卡片）出现一团跟手的柔光，离开淡出。
 *    一个全局浮层，按当前卡片的位置和圆角贴上去，z-index 低于 dock。
 * ③ 触感：真正点下去（没滑动）的按钮给一次轻触感；iOS 走 Util.haptic 里的 switch 方案。
 * 只处理触摸（pointerType / touch 事件），鼠标不受影响；系统「减少动态效果」时不做按压动画和光斑。
 */
(function (global) {
  'use strict';
  var PRESS_SEL = 'button, [role="button"], a[href], summary, label.row-switch, .record-tile, .canvas-card[data-go], .tool-item, .sheet-card, .seg-btn, [data-go], [data-tab]';
  var GLOW_SEL = '.card, .record-tile, .canvas-card, .tool-item, .sheet-card, .set-group > summary, .hq-b, .hn-q';
  var SKIP_SEL = '#tabbar, #dockOrb, #quickDock .qd-fab, .record-grid.is-editing, .tp-off, input, textarea, select';
  var BIG_SEL = '.card, .record-tile, .canvas-card, .sheet-card, .alltools-entry, .bp-search, .gs-cell, .hl2, .home-search, .lc-card, .ob-card, .sp-card, .tl-card, .vb-cover';
  /* 第 334 次：按压态三档 + 行底色，全部读 CSS 变量（styles.css :root 的 --press-*），和鼠标的 :active 同一套数 */
  var ICO_SEL = '.bp-gear, .btn-mini, .header-back, .header-gear, .home-avatar, .icon-btn, .sb-clear, .tile-del, .tl-more, .gr-gear, .rs-x, .ftf-rb';
  /* 分组列表行：iOS 式按下整行变灰、不缩放（行贴着卡片边，缩放会露出缝） */
  var ROW_SEL = '.set-group > summary, .st-act, .st-link, .vt-row, .sr-row, .su-row, label.row-switch, .wt-row';
  var TOK = null;
  function tok() {
    if (TOK) return TOK;
    var cs = null; try { cs = global.getComputedStyle(document.documentElement); } catch (e) { cs = null; }
    var g = function (k, d) { var v = cs ? String(cs.getPropertyValue(k)).trim() : ''; return v || d; };
    var ms = function (v, d) { var n = parseFloat(v); return isFinite(n) ? (/ms$/.test(v) ? n : n * 1000) : d; };
    TOK = {
      btn: g('--press-btn', '.96'), card: g('--press-card', '.985'), ico: g('--press-ico', '.92'),
      inMs: ms(g('--dur-press', '120ms'), 120), outMs: ms(g('--dur-release', '420ms'), 420),
      inEase: g('--ease-out', 'cubic-bezier(.2,.8,.2,1)'), outEase: g('--spring', 'cubic-bezier(.34,1.56,.64,1)')
    };
    return TOK;
  }
  function rowTint() {
    /* --press-row 是 color-mix（随深浅色变）：取当前算好的颜色 */
    try {
      var p = document.createElement('i'); p.style.cssText = 'position:absolute;width:0;height:0;background:var(--press-row)';
      document.body.appendChild(p); var c = global.getComputedStyle(p).backgroundColor; p.remove(); return c;
    } catch (e) { return 'rgba(0,0,0,.06)'; }
  }
  var rowAnim = null, rowEl = null;

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

  function tierOf(el) { return el.matches(ROW_SEL) ? 'row' : el.matches(BIG_SEL) ? 'card' : el.matches(ICO_SEL) ? 'ico' : 'btn'; }
  function pressDown(el) {
    if (!el.animate) return;
    var T = tok(), tier = tierOf(el);
    if (tier === 'row') {
      /* 行底色：减少动态效果时也给（颜色变化不是运动），只是不渐变 */
      rowEl = el;
      try { rowAnim = el.animate([{ backgroundColor: rowTint() }], { duration: reduce ? 0 : T.inMs, easing: T.inEase, fill: 'forwards' }); } catch (e) { rowAnim = null; }
      return;
    }
    if (reduce) return;
    try {
      pressAnim = el.animate([{ scale: '1' }, { scale: String(T[tier]) }], { duration: T.inMs, easing: T.inEase, fill: 'forwards' });
    } catch (e) { pressAnim = null; }
  }
  function pressUp(el) {
    if (!el) return;
    var T = tok();
    if (rowEl === el && rowAnim) {
      var a = rowAnim; rowAnim = null; rowEl = null;
      var c0 = ''; try { c0 = global.getComputedStyle(el).backgroundColor; } catch (e) { /* */ }
      try { a.cancel(); } catch (e) { /* */ }
      if (!reduce && c0) { try { el.animate([{ backgroundColor: c0 }, {}], { duration: 220, easing: T.inEase }); } catch (e) { /* */ } }
      return;
    }
    var from = '1';
    try { from = global.getComputedStyle(el).scale || '1'; } catch (e) {}
    if (pressAnim) { try { pressAnim.cancel(); } catch (e) {} pressAnim = null; }
    if (reduce || !el.animate || from === '1' || from === 'none') return;
    try { el.animate([{ scale: from }, { scale: '1' }], { duration: T.outMs, easing: T.outEase }); } catch (e) {}
  }

  /* 第 249 次（真机：iPhone 还是不震）：新版 iOS 只认「手指真实点到」switch 的 label，脚本调 label.click() 不再出触感。
     做法同 ios-haptics：手指按下时，给被按的按钮里塞一层透明 label（盖满按钮、内含隐藏的 switch）。
     松手时系统把点击真正派给这层 label → 切换 switch → 系统触感；点击事件照常冒泡到按钮，原有逻辑不受影响。
     只给「叶子」按钮装：里面还有别的按钮 / 链接 / 输入框的卡片不装，免得挡住里面的小按钮。 */
  var IOS_HAP = !(global.navigator && typeof navigator.vibrate === 'function') && ('ontouchstart' in global);
  var HAP_SEL = 'button, [role="button"], .record-tile, .canvas-card[data-go], .tool-item, .seg-btn';
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

  global.TouchFX = { _glow: function () { return glow; }, _tier: tierOf, _tok: function () { TOK = null; return tok(); }, _down: pressDown, _up: pressUp, PRESS_SEL: PRESS_SEL, ROW_SEL: ROW_SEL };
})(window);
