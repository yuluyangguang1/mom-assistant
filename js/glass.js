/**
 * glass.js — 跨平台「真·折射」引擎（全浏览器含 Chrome/Edge/Firefox/Safari）
 *
 * 原理：
 *   之前 #11 的「折射」依赖 backdrop-filter: url()，而 Chrome/Edge 不支持在
 *   backdrop-filter 中引用 SVG 滤镜，只接受 blur() 等标准函数，所以真折射只能
 *   在 Safari/WebKit 上出现。本模块改用「canvas 镜像背景 + 普通 filter:url()」：
 *     1) 把页面背景（body 渐变 + 首页程序化 skyCanvas）精确重绘进一张离屏场景 canvas；
 *     2) 给每个玻璃面注入一个子 <canvas class="grefract">，从场景里「摘取」正后方
 *        的那块背景，并做轻微放大（模拟透镜），再施加 #liquidRefract 滤镜（模糊+位移）；
 *     3) 普通 filter:url() 在四大引擎均支持 —— 于是任意浏览器都能看到「透过玻璃
 *        扭曲的背景」，而非只在 Safari 才有。
 *
 * 性能与降级：
 *   - 仅首页（存在 skyCanvas）开常驻 rAF 循环；其余页面靠滚动/切页/缩放触发单帧刷新。
 *   - prefers-reduced-motion：不跑循环，只在切页/滚动时静态重绘一次。
 *   - 不支持 2D canvas 上下文 或 不支持 filter:url() 的环境：整个模块自动禁用，
 *     页面回退为原磨砂玻璃，零报错。
 *   - 可在「设置-真实玻璃折射」开关关闭（Storage.settings.realRefraction=false）。
 *
 * 设计要点：折射层与卡片自身的 backdrop-filter 磨砂叠加，读起来像更厚、更有层次的
 *   液态玻璃，而非两层背景重影（两者本是同一场景的不同渲染）。
 */
(function (global) {
  'use strict';
  var doc = global.document;
  if (!doc) return;

  var Glass = {};

  /* 与 styles.css 的 --bg-grad 完全对应，用于把背景「原样」重绘进场景 canvas */
  var BG = {
    light: [[244, 241, 251], [251, 247, 243], [247, 243, 248]],
    dark:  [[27, 24, 34], [33, 28, 42], [30, 26, 38]]
  };
  var FADE = { light: 'rgba(249,246,251,0.92)', dark: 'rgba(28,24,36,0.92)' };

  /* 需要折射的玻璃宿主（大面板为主；小控件靠 rim 液态边即可） */
  var SEL = '.card, .record-tile, .stat, .modal, .mod-item';

  var scene = null, sctx = null;
  var enabled = true, reduced = false, loopOn = false, raf = 0, lastScene = 0, bound = false;

  function rgb(c, a) {
    return 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + (a == null ? 1 : a) + ')';
  }
  function hasCtx() {
    try { var c = doc.createElement('canvas'); return !!(c.getContext && c.getContext('2d')); } catch (e) { return false; }
  }
  function hasFilter() {
    try { return !!(global.CSS && global.CSS.supports && global.CSS.supports('filter', 'url(#x)')); }
    catch (e) { return true; } /* 无法探测时乐观开启，运行时 filter 无效也只是不折射 */
  }

  /* 把「页面真实背景」重绘进场景 canvas：body 渐变 +（首页）skyCanvas 合成并底部淡入 */
  function paintScene() {
    if (!scene || !sctx) return;
    var w = global.innerWidth, h = global.innerHeight;
    if (w < 1 || h < 1) return;
    var dpr = Math.min(global.devicePixelRatio || 1, 2);
    if (scene.width !== Math.round(w * dpr)) { scene.width = Math.round(w * dpr); scene.height = Math.round(h * dpr); }
    sctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var dark = doc.body.classList.contains('dark');
    var cols = dark ? BG.dark : BG.light;
    var g = sctx.createLinearGradient(w * 0.78, 0, w * 0.20, h); /* ≈165deg 对角 */
    g.addColorStop(0, rgb(cols[0]));
    g.addColorStop(0.55, rgb(cols[1]));
    g.addColorStop(1, rgb(cols[2]));
    sctx.fillStyle = g;
    sctx.fillRect(0, 0, w, h);

    var sky = doc.getElementById('skyCanvas');
    if (sky && sky.isConnected) {
      var r = sky.getBoundingClientRect();
      if (r.width > 1 && r.height > 1) {
        try { sctx.drawImage(sky, r.left, r.top, r.width, r.height); } catch (e) {}
        /* 天空底部淡入页面底色，模拟 .sky-veil，避免硬边 */
        var fg = sctx.createLinearGradient(0, r.top + r.height * 0.5, 0, r.top + r.height);
        fg.addColorStop(0, 'rgba(0,0,0,0)');
        fg.addColorStop(1, dark ? FADE.dark : FADE.light);
        sctx.fillStyle = fg;
        sctx.fillRect(r.left, r.top, r.width, r.height);
      }
    }
  }

  function ensureCanvas(el) {
    var c = el.querySelector('canvas.grefract');
    if (c) return c;
    c = doc.createElement('canvas');
    c.className = 'grefract';
    el.insertBefore(c, el.firstChild);
    return c;
  }

  /* 把卡片正后方的背景「摘取 + 放大」画进折射 canvas；真正的扭曲由 CSS filter 完成 */
  function drawInto(el) {
    var rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    var c = ensureCanvas(el);
    var ctx = c.getContext ? c.getContext('2d') : null;
    if (!ctx) return;
    var dpr = Math.min(global.devicePixelRatio || 1, 2);
    if (c.width !== Math.round(rect.width * dpr)) { c.width = Math.round(rect.width * dpr); c.height = Math.round(rect.height * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var scale = 1.10;                 /* 轻微放大 → 透镜感 */
    var sw = rect.width * scale, sh = rect.height * scale;
    var sx = rect.left + rect.width / 2 - sw / 2;
    var sy = rect.top + rect.height / 2 - sh / 2;

    /* 场景 canvas 的像素 = CSS 像素 × (scene.width / innerWidth) */
    var k = scene.width / (global.innerWidth || scene.width);
    ctx.clearRect(0, 0, rect.width, rect.height);
    try { ctx.drawImage(scene, sx * k, sy * k, sw * k, sh * k, 0, 0, rect.width, rect.height); } catch (e) {}
  }

  function refresh() {
    if (!enabled || !scene) return;
    var now = (global.performance && global.performance.now) ? global.performance.now() : Date.now();
    if (now - lastScene > 220) { paintScene(); lastScene = now; }
    var els = doc.querySelectorAll(SEL);
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (!el.isConnected) continue;
      var r = el.getBoundingClientRect();
      if (r.bottom < -60 || r.top > (global.innerHeight + 60)) continue; /* 只刷视口内，节流 */
      drawInto(el);
    }
  }

  function pulse() {
    if (!enabled || !scene || raf) return; /* 一帧只排一次 */
    raf = global.requestAnimationFrame(function () { raf = 0; refresh(); });
  }

  function loop() {
    if (!loopOn || !enabled || !scene) return;
    if (doc.hidden) { global.requestAnimationFrame(loop); return; }
    var sky = doc.getElementById('skyCanvas');
    if (sky && sky.isConnected) { refresh(); global.requestAnimationFrame(loop); }
    else { loopOn = false; } /* 离开首页：停常驻循环，改由滚动/切页触发 */
  }
  function startLoop() { if (!loopOn) { loopOn = true; global.requestAnimationFrame(loop); } }

  function bind() {
    if (bound) return; bound = true;
    reduced = !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
    global.addEventListener('scroll', pulse, { passive: true });
    global.addEventListener('resize', pulse, { passive: true });
    doc.addEventListener('visibilitychange', function () {
      if (!doc.hidden && !loopOn && enabled) {
        var sky = doc.getElementById('skyCanvas');
        if (sky && sky.isConnected) startLoop();
      }
    });
  }

  function start() {
    if (scene) { bind(); return; }
    if (!hasCtx() || !hasFilter()) { bind(); return; } /* 降级：仅绑定，不创建场景 */
    scene = doc.createElement('canvas');
    sctx = scene.getContext('2d');
    if (!sctx) { scene = null; bind(); return; }
    bind();
  }

  function clearAll() {
    var els = doc.querySelectorAll('canvas.grefract');
    for (var i = 0; i < els.length; i++) { if (els[i].parentNode) els[i].parentNode.removeChild(els[i]); }
  }

  /* 每次切 tab / 初始化调用：读开关、重绘、刷新；非减少动效时开首页常驻循环 */
  Glass.wake = function () {
    var s = (global.Storage && global.Storage.get && global.Storage.get().settings) || {};
    enabled = (s.realRefraction !== false);
    if (!enabled) { clearAll(); return; }
    /* 折射只服务于「首页程序化天空」：离开首页后背景只是纯色渐变，强行折射
       只会摘取到色带并位移成难看的色块、压低对比、破坏可读性（真机暴露）。
       因此非首页一律清除折射层，只保留磨砂玻璃 + rim 高光边。 */
    var sky = doc.getElementById('skyCanvas');
    if (!sky || !sky.isConnected) { clearAll(); return; }
    start();
    if (!scene) return;
    paintScene();
    refresh();
    if (!reduced) startLoop();
  };

  Glass.setTheme = function () { if (scene) { paintScene(); pulse(); } };
  Glass.setEnabled = function (on) {
    enabled = !!on;
    if (!enabled) clearAll();
    else Glass.wake();
  };

  global.Glass = Glass;
})(window);
