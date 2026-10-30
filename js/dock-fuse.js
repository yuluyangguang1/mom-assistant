/**
 * dock-fuse.js — 第 320 次：二级页底部重设计与融合
 *
 * 二级页（模块页 / 页内二级）的底部从「返回 + ＋ 小胶囊 + 实色记录条 + 铺到屏幕底的不透明底衬」改成三块同材质的液态玻璃：
 *   · 返回、＋：两颗 52pt 玻璃圆钮（一左一右，玻璃 / 描边 / 高光和一级 dock 同一套，图标沿用 dock 图标 1.8 线宽）；
 *   · 记录条（.mod-cta）：同一张 GL 画布上的第三块玻璃，带模块色调（不是实色块），白字对比度按最坏背景（纯白）算出来 ≥ 4.5:1
 *     ——达不到就把色调压深（浅色）/ 改深色字 + 提亮色调（深色），见 safeTint()；
 *   · 正在进行胶囊在场时并进圆钮那一行（中间），记录条留在上面、不再下落（不遮挡优先）。
 *
 * 形状全部由这里逐帧算出来（视口坐标），交给 DockRefract.fuse() 在 dock 的 WebGL 画布上画成一个距离场（smooth-min 依次并入）：
 *   · 推入（一级 → 二级）：一级 dock 的胶囊缩成左边的返回钮、＋ 珠滑到右边，两块之间 k 先鼓后收（黏住 → 拉开 → 断开）；
 *     记录条从 dock 中间冒出一滴（k 16 → 6），约 320ms；返回反向合拢（记录条先被吸回），侧滑返回时形变跟手指进度；
 *   · 下滑：记录条下落到两颗圆钮中间那一行（弹簧 k 300、阻尼比 0.86），靠近时黏连半径鼓到 12 再归零；上滑 / 回顶 / 点它恢复展开；
 *   · 快速记录：记录条先被 ＋ 吸收（~150ms），面板再从 ＋ 弹出；收起后再冒出来；
 *   · 按下记录条：放大 3% + 提亮。
 * 一级页的画法不变（第 309~319 次的透镜 / 边带 + CSS 磨砂）；合拢回一级页的最后 120ms 由 GL 中间填充淡出、CSS 磨砂接上（不硬切）。
 *
 * DOM：按钮 / 文字留在 DOM（点击、读屏）；动画时它们的盒子跟着形状走（返回 / ＋ 钮写宽高 + translate，记录条写左右留白 + transform），
 *   GL 在画（html.fz-gl）时 DOM 没有底色，GL 没在画（Chromium、没快照、减少透明度、高对比）时 DOM 自己是 CSS 玻璃——形状照样动，
 *   只是没有黏连（两块叠放）。
 * 只写样式不读布局：几何在进二级页 / 改尺寸 / 记录条内容变时量一次（measure），动画帧里只用缓存。
 */
(function (global) {
  'use strict';
  var doc = global.document;
  if (!doc) return;
  var F = {};
  var CIR = 52, GAP = 10, PUSH_MS = 320, POP_MS = 300;
  var PRESS_PIECE = 0.03;   /* 第 320 次：形变途中按下单颗钮的放大量 */
  var K_REST = 6, K_DROP = 12, K_EMERGE = 16, K_SPLIT = 14;
  var reduced = false;
  try { reduced = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* */ }
  var clk = null;   /* QA：_clock(fn) 换成手动时钟（逐帧确定性采样） */
  function now() { return clk ? clk() : (global.performance ? performance.now() : Date.now()); }
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function smooth(a, b, x) { var t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); }
  function easeOut(x) { return 1 - Math.pow(1 - clamp01(x), 3); }
  function easeIO(x) { x = clamp01(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }
  /* 与横推同一条 cubic-bezier(.32,.72,0,1) 的近似（推入 / 返回 / 侧滑接续用） */
  function easeNav(x) { x = clamp01(x); return 1 - Math.pow(1 - x, 3.2); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function lerpR(a, b, t) { return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t) }; }
  function rect(r) { return { x: r.left, y: r.top, w: r.width, h: r.height }; }
  function cen(r) { return [r.x + r.w / 2, r.y + r.h / 2]; }
  function scaleR(r, s) { var c = cen(r); return { x: c[0] - r.w * s / 2, y: c[1] - r.h * s / 2, w: r.w * s, h: r.h * s }; }
  function spring(k, z) { return { x: 0, v: 0, t: 0, k: k, c: 2 * z * Math.sqrt(k) }; }
  function stepSpring(s, dt) {
    /* 半隐式欧拉，子步 4ms */
    var left = dt / 1000, moved = false;
    while (left > 1e-6) {
      var h = Math.min(0.004, left); left -= h;
      var a = -s.k * (s.x - s.t) - s.c * s.v;
      s.v += a * h; s.x += s.v * h;
    }
    if (Math.abs(s.x - s.t) < 0.0015 && Math.abs(s.v) < 0.01) { s.x = s.t; s.v = 0; } else moved = true;
    return moved;
  }

  var S = {
    sub: false,            /* 二级页 DOM 在场 */
    m: 1,                  /* 形变：0 = 一级 dock 的形状，1 = 二级（返回 / ＋ 分开） */
    e: 1,                  /* 当前页记录条冒出：0 = 在 dock 里，1 = 在外面 */
    eo: 0,                 /* 离开的旧记录条（返回 / 二级换二级时被吸回） */
    tw: null,              /* 推入 / 返回的时间线 {kind, m0, m1, e0, e1, eo0, t0, dur, t} */
    drag: false,           /* 侧滑返回跟手中 */
    c: spring(300, 0.86),  /* 下滑并入一行：0 展开 / 1 并入 */
    ab: spring(700, 1),    /* 快速记录吸收：0 在外 / 1 吸进 ＋ */
    pr: spring(600, 0.9),  /* 按下 */
    pp: spring(600, 0.9),  /* 第 320 次：分裂 / 合拢途中按下的那颗钮（只它放大 1.03，不缩放整个合成层） */
    pk: null,              /* 被按的是哪颗：'back'（返回钮 / 合拢中的胶囊）| 'plus' */
    fade: 0,               /* 合拢回一级页后中间填充淡出的起点（0 = 没在淡） */
    raf: 0, last: 0,
    L1: null,              /* 一级 dock 的形状（胶囊 / ＋ 珠） */
    G: null,               /* 二级几何缓存 */
    ghost: null,           /* 推入时一级页签的替身 / 返回时返回图标的替身 */
    fl: null,              /* 浮到 #ctaFloat 的记录条 {el, parent, next, old} */
    old: null,             /* 离开的旧记录条形状（被吸回时用） */
    gl: false,
    collapseOk: false,
    lastY: 0, upAcc: 0,
    perf: null
  };

  function $(s) { return doc.querySelector(s); }
  function bar() { return doc.getElementById('tabbar'); }
  function isSubDom() { var b = bar(); return !!(b && b.classList.contains('is-sub')); }
  function ctaRoot() {
    if (S.fl && S.fl.el && S.fl.el.isConnected && !S.fl.old) return S.fl.el;
    return doc.querySelector('#view .mod-cta:not(.fz-hide)') || doc.querySelector('#view .mod-cta');
  }
  function pieces(root) {
    if (!root) return [];
    return Array.prototype.filter.call(root.children, function (el) { return el.nodeType === 1 && !el.hidden && el.tagName !== 'TEMPLATE'; });
  }
  function tinted(el) { return el.classList.contains('mc-main') || el.classList.contains('ft-split'); }
  function liveEl() {
    var l = doc.getElementById('dockLive') || $('.dock-live');
    return l && !l.hidden && l.innerHTML ? l : null;
  }
  function body() { return doc.body; }
  function bodyCls(c, on) { var b = body(); if (!b) return; if (on) { if (!b.classList.contains(c)) b.classList.add(c); } else if (b.classList.contains(c)) b.classList.remove(c); }
  function htmlCls(c, on) { var h = doc.documentElement; if (on) { if (!h.classList.contains(c)) h.classList.add(c); } else if (h.classList.contains(c)) h.classList.remove(c); }

  /* ---------- 色调 / 对比度 ---------- */
  function hex(str) {
    str = (str || '').trim();
    var m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(str);
    if (m) { var h = m[1]; if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]; return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
    m = /rgba?\(([^)]+)\)/.exec(str);
    if (m) { var p = m[1].split(/[\s,\/]+/).filter(Boolean).map(parseFloat); return [p[0], p[1], p[2]]; }
    return null;
  }
  function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function lum(rgb) { return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]); }
  function contrast(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  /* 色调线性近似（与着色器 tone() 同系数，glass-optics.js） */
  function toneOf(dark) {
    var GO = global.GlassOptics;
    return GO && GO.toneLinear ? GO.toneLinear(dark) : (dark ? { contrast: 0.777, brightness: 0.848, chroma: 1.065 } : { contrast: 0.529, brightness: 1.223, chroma: 1.1 });
  }
  function toneV(v, t) { return Math.max(0, Math.min(1, ((v - 0.5) * t.contrast + 0.5) * t.brightness)); }
  /* 记录条玻璃中间的颜色（着色器：mix(tone(bg), T.rgb, T.a)，再按下最多混 10% 白）。最坏背景：
     白字 → 背后纯白（色调后最亮）+ 按下提亮；深色字 → 背后纯黑（色调后最暗）。返回这时的合成色 */
  function composite(T, a, bgV, lift) {
    var c = [0, 1, 2].map(function (i) { var v = (bgV * (1 - a) + (T[i] / 255) * a); v = v + (1 - v) * lift; return Math.round(Math.max(0, Math.min(1, v)) * 255); });
    return c;
  }
  var tintCache = {};
  /* 两种做法都算：A 白字 + 压深色调；B 深色字 + 提亮色调。浅色模式优先 A，A 要压深超过 5 档（色相发脏，如金色变橄榄）就改用 B；
     深色模式（模块色本来就是提亮的浅色）优先 B。两种都按最坏背景保证 ≥ 4.6:1。 */
  function solve(base, a, t, white, dark) {
    var T = base.slice(), steps = 0, worst, cr;
    var text = white ? [255, 255, 255] : (dark || [42, 33, 22]);
    var bgV = white ? toneV(1, t) : toneV(0, t), lift = white ? 0.1 : 0;
    while (steps < 40) {
      worst = composite(T, a, bgV, lift); cr = contrast(text, worst);
      if (cr >= 4.6) break;
      T = white ? T.map(function (v) { return Math.round(v * 0.94); }) : T.map(function (v) { return Math.round(v + (255 - v) * 0.08); });
      steps++;
    }
    /* B（深色字）还要顾另一头：背后纯白 + 按下提亮时也 ≥ 4.6（浅色调 + 白背景本来就更亮，通常自动满足） */
    if (!white) { var w2 = composite(T, a, toneV(1, t), 0.1); cr = Math.min(cr, contrast(text, w2)); }
    return { T: T, a: a, on: text, cr: Math.round(cr * 100) / 100, worst: worst, base: base, steps: steps, mode: white ? 'white' : 'dark' };
  }
  function hueOf(c) {
    var r = c[0] / 255, g = c[1] / 255, b = c[2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (d < 1e-6) return 0;
    var h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60; return h < 0 ? h + 360 : h;
  }
  function lighten(c, k) { return c.map(function (v) { return Math.round(v + (255 - v) * k); }); }
  F.safeTint = function (base, darkMode, on, light) {
    var key = base.join(',') + (darkMode ? 'd' : 'l') + (on || []).join(',') + (light || []).join(',');
    if (tintCache[key]) return tintCache[key];
    var t = toneOf(darkMode), out;
    if (!darkMode) {
      /* 白字：色调 86%，最多压深 7 档（约 35%）；压不到（浅粉 / 金黄 / 奶黄这些浅色模块）改深色字 + 提亮色调 82% */
      out = solve(base, 0.86, t, true);
      /* 金 / 黄色相（35°~75°）压深后发橄榄、发脏：直接走深色字方案 */
      if (out.steps > 7 || (hueOf(base) >= 35 && hueOf(base) <= 75 && out.steps > 2)) {
        var b2 = solve(light || lighten(base, 0.45), 0.82, t, false, [42, 33, 22]);
        if (b2.cr >= 4.5) out = b2;
      }
    } else {
      out = solve(base, 0.82, t, false, on || [42, 33, 22]);
      if (out.cr < 4.5) out = solve(base, 0.86, t, true);
    }
    out.alt = !darkMode ? 'white-first' : 'dark-first';
    tintCache[key] = out;
    return out;
  };
  function pageTint(root) {
    if (!root) return null;
    var tp = pieces(root).filter(tinted)[0] || root.firstElementChild || root;
    var cs = global.getComputedStyle(tp), dark = body().classList.contains('dark');
    var base = hex(cs.getPropertyValue('--tile-fill')) || hex(cs.getPropertyValue('--tile')) || [200, 120, 100];
    if (dark) base = hex(cs.getPropertyValue('--tile')) || base;
    var on = dark ? (hex(cs.getPropertyValue('--tile-on')) || [42, 33, 22]) : null;
    /* 浅色模式的 B 方案用模块色本身（--tile，比 --tile-fill 亮）再提亮 */
    var light = !dark ? lighten(hex(cs.getPropertyValue('--tile')) || base, 0.35) : null;
    return F.safeTint(base, dark, on, light);
  }

  /* ---------- 几何 ---------- */
  function l1Default(G) {
    var W = global.innerWidth || 390, cs = global.getComputedStyle(doc.documentElement);
    var dw = parseFloat(cs.getPropertyValue('--dock-w')) || 218, bh = parseFloat(cs.getPropertyValue('--dock-bh')) || 60;
    var x = W / 2 - dw / 2 - (bh + 8) / 2;
    return { cap: { x: x, y: G.cy - bh / 2, w: dw, h: bh }, orb: { x: x + dw + 8, y: G.cy - bh / 2, w: bh, h: bh } };
  }
  function captureL1() {
    var b = bar(), o = doc.getElementById('dockOrb');
    if (!b || b.classList.contains('is-sub') || !o || o.hidden) return null;
    var k = (global.LiquidDock && LiquidDock.dockScale) ? LiquidDock.dockScale() : 1;
    var br = b.getBoundingClientRect(), orr = o.getBoundingClientRect();
    if (br.width < 40 || orr.width < 20) return null;
    var cap = rect(br);
    if (k !== 1) { cap = scaleR(cap, 1 / k); }
    S.L1 = { cap: cap, orb: rect(orr), live: liveEl() ? rect(liveEl().getBoundingClientRect()) : null };
    return S.L1;
  }
  /* 栏此刻的视口矩形（未缩放；GL 画布按它定位）。DOM 换页 / 尺寸变时重读，动画帧里用缓存 */
  function barRectNow() {
    var b = bar(); if (!b) return null;
    var r = b.getBoundingClientRect(), k = (!isSubDom() && global.LiquidDock && LiquidDock.dockScale) ? LiquidDock.dockScale() : 1;
    var cx = r.left + r.width / 2, cy = r.top + r.height / 2, w = r.width / k, h = r.height / k;
    return { left: cx - w / 2, top: cy - h / 2, width: w, height: h, right: cx + w / 2, bottom: cy + h / 2 };
  }
  /* 二级几何：栏（透明容器，60 高）中线 = 圆钮中线；记录条在圆钮上方 10pt */
  function measure() {
    var b = bar(); if (!b) return null;
    var W = global.innerWidth || 390, H = global.innerHeight || 844;
    var br = b.getBoundingClientRect();
    var colL = Math.max(0, (W - 640) / 2) + 16, colR = W - colL;
    var cy = br.top + br.height / 2;
    var G = { W: W, H: H, bar: br.width > 0 ? { left: br.left, top: br.top, width: br.width, height: br.height, right: br.right, bottom: br.bottom } : null,
      colL: colL, colR: colR, cy: cy,
      back: { x: colL, y: cy - CIR / 2, w: CIR, h: CIR }, plus: { x: colR - CIR, y: cy - CIR / 2, w: CIR, h: CIR } };
    var lv = liveEl();
    G.live = lv && isSubDom() ? { x: colL + CIR + GAP, y: cy - CIR / 2, w: colR - colL - 2 * (CIR + GAP), h: CIR } : null;
    var root = ctaRoot();
    G.cta = null;
    if (root && isSubDom()) {
      var ps = pieces(root);
      if (ps.length) {
        var tf = root.style.transform, pl = root.style.paddingLeft, prr = root.style.paddingRight;
        var dirty = !!(tf || pl || prr);
        if (dirty) { root.style.transform = 'none'; root.style.paddingLeft = ''; root.style.paddingRight = ''; }
        var rr = root.getBoundingClientRect();
        var pe = ps.map(function (el) { return rect(el.getBoundingClientRect()); });
        if (dirty) { root.style.transform = tf; root.style.paddingLeft = pl; root.style.paddingRight = prr; }
        var tn = pageTint(root);
        /* 并入一行时的几何（pc）要改左右留白再量一次 = 多一次强制排版：不在进页那一帧做，空闲时补（第一次要下落时还没量就当场量） */
        G.cta = { root: rect(rr), pe: pe, pc: null, kinds: ps.map(function (el) { return tinted(el) ? 1 : 0; }), els: ps, tint: tn, cy: cy };
        root.style.setProperty('--fz-t', tn.T.join(','));
        root.style.setProperty('--fz-a', String(tn.a));
        root.style.setProperty('--fz-on', 'rgb(' + tn.on.join(',') + ')');
      }
    }
    /* 计时条（ft-mini：计时中的时钟 + 结束）不下落——并进一行放不下，计时信息不该被挤掉；正在进行胶囊占着那一行时也不下落 */
    S.collapseOk = !!(G.cta && !G.live && !G.cta.els.some(function (el) { return el.classList.contains('ft-mini'); }));
    S.G = G; S.barR = G.bar;
    if (S.collapseOk) idlePc();
    if (!S.L1) S.L1 = l1Default(G);
    return G;
  }

  /* 并入一行的几何：改左右留白量一次再还原（只在需要 / 空闲时） */
  function pcOf(G) {
    if (!G || !G.cta) return null;
    if (G.cta.pc) return G.cta.pc;
    var root = ctaRoot(), cy = G.cta.cy;
    if (!root || !G.cta.els[0] || !G.cta.els[0].isConnected) { G.cta.pc = G.cta.pe.map(function (r) { return { x: r.x, y: cy - r.h / 2, w: r.w, h: r.h }; }); return G.cta.pc; }
    var tf = root.style.transform, pl = root.style.paddingLeft, prr = root.style.paddingRight;
    root.style.transform = 'none'; root.style.paddingLeft = root.style.paddingRight = (16 + CIR + GAP) + 'px';
    G.cta.pc = G.cta.els.map(function (el) { var r = rect(el.getBoundingClientRect()); r.y = cy - r.h / 2; return r; });
    root.style.transform = tf; root.style.paddingLeft = pl; root.style.paddingRight = prr;
    return G.cta.pc;
  }
  var pcIdle = 0;
  function idlePc() {
    if (pcIdle) return;
    var ric = global.requestIdleCallback || function (f) { return setTimeout(f, 200); };
    pcIdle = ric(function () { pcIdle = 0; if (S.tw || S.drag || !S.G || !S.G.cta || S.G.cta.pc) return; if (!isSubDom()) return; pcOf(S.G); }, { timeout: 1500 });
  }

  /* ---------- 形状 ---------- */
  function ctaShapes(G, e, c, ab, pr, seed, absorbTo) {
    if (!G.cta || (e < 0.0005 && ab < 0.0005)) return [];
    var out = [];
    /* 先往上冒（y 前 60% 走完），再横向铺开（宽从 15% 开始）；色调随冒出渐显（在 dock 里时是中性玻璃） */
    var cy = easeOut(clamp01(e / 0.6)), ce = easeOut(clamp01((e - 0.15) / 0.85)), ch = easeOut(clamp01(e / 0.7)), tmE = smooth(0.15, 0.7, e);
    /* 种子（dock 中间的一滴）随 e → 0 缩成一个点：冒出 / 吸回的头尾没有凭空出现 / 消失的那一帧 */
    var ss = smooth(0, 0.3, e); seed = scaleR(seed, Math.max(0.02, ss));
    var kC = Math.max(K_REST * (1 - c), K_DROP * Math.sin(Math.PI * clamp01(c)));
    var PC = c > 0.0005 ? pcOf(G) : G.cta.pe;
    for (var i = 0; i < G.cta.pe.length; i++) {
      var T = c > 0.0005 ? lerpR(G.cta.pe[i], PC[i], c) : G.cta.pe[i];
      var w = lerp(seed.w, T.w, ce), h = lerp(seed.h, T.h, ch), cyy = lerp(seed.y + seed.h / 2, T.y + T.h / 2, cy), cxx = lerp(seed.x + seed.w / 2, T.x + T.w / 2, ce);
      var sh = { x: cxx - w / 2, y: cyy - h / 2, w: w, h: h };
      var k = lerp(K_EMERGE, kC, smooth(0.3, 0.8, e));
      if (ab > 0.001 && absorbTo) {
        var ae = easeIO(ab);
        sh = lerpR(sh, absorbTo, ae);
        k = Math.max(k, K_EMERGE * Math.sin(Math.PI * Math.min(1, ab * 1.2)));
      }
      if (pr > 0.001) sh = scaleR(sh, 1 + 0.03 * pr);
      out.push({ x: sh.x, y: sh.y, w: sh.w, h: sh.h, k: k, tm: G.cta.kinds[i] ? tmE : 0, a: 1, lf: pr, band: 18, _i: i });
    }
    return out;
  }
  function shapes() {
    var G = S.G; if (!G) return [];
    var L1 = S.L1 || l1Default(G), m = S.m;
    /* m 本身已按时间缓动过（推入 / 返回 easeNav(p)；侧滑 = 手指进度），这里不再套一层（原来双重缓动：第一帧就走掉 43%） */
    var mb = m, mp = m;
    var back = lerpR(L1.cap, G.back, mb), plus = lerpR(L1.orb, G.plus, mp);
    /* 胶囊和 ＋ 珠之间：分开前先黏住（k 鼓起）再拉断；m = 0（一级）时 k 必须是 0，和一级 dock 的两块各自的边完全一样 */
    var kp = m < 1 ? K_SPLIT * Math.sin(Math.PI * clamp01(m / 0.75)) : 0;
    /* 第 320 次（Telegram 参考）：形变途中按下 → 只放大被按的那颗（1.03，绕自身中心），黏连的颈部 / 另一颗 / 记录条都不动 */
    var back0 = back, plus0 = plus;
    if (S.pk && S.pp.x > 0.0005) { var ps = 1 + PRESS_PIECE * S.pp.x; if (S.pk === 'back') back = scaleR(back, ps); else plus = scaleR(plus, ps); }
    var list = [
      { x: back.x, y: back.y, w: back.w, h: back.h, k: 0, tm: 0, a: 1, lf: 0, band: 18, id: 'back' },
      { x: plus.x, y: plus.y, w: plus.w, h: plus.h, k: kp, tm: 0, a: 1, lf: 0, band: 18, id: 'plus' }
    ];
    var dockMid = { x: (back0.x + plus0.x + plus0.w) / 2 - 22, y: G.cy - 20, w: 44, h: 22 };   /* 用按下放大前的位置：按住一颗钮时记录条 / 种子不跟着挪 */
    var plusSeed = { x: G.plus.x + 11, y: G.cy - 10, w: 30, h: 20 };
    if (G.cta) {
      var cs = ctaShapes(G, S.e, S.c.x, S.ab.x, S.pr.x, dockMid, plusSeed);
      cs.forEach(function (q) { q.id = 'cta' + q._i; list.push(q); });
    }
    if (S.old && S.eo > 0.0005) {
      var oe = easeOut(S.eo), oseed = scaleR(dockMid, Math.max(0.02, smooth(0, 0.3, S.eo)));
      S.old.forEach(function (q, i) {
        var sh = lerpR(oseed, q, oe);
        list.push({ x: sh.x, y: sh.y, w: sh.w, h: sh.h, k: lerp(K_EMERGE, K_REST, smooth(0.3, 0.8, S.eo)), tm: q.tm * smooth(0.15, 0.7, S.eo), a: 1, lf: 0, band: 18, id: 'old' + i });
      });
    }
    if (G.live) {
      var lf = L1.live && m < 1 ? lerpR(L1.live, G.live, m) : G.live;
      list.push({ x: lf.x, y: lf.y, w: lf.w, h: lf.h, k: K_REST * m, tm: 0, a: 1, lf: 0, band: 18, id: 'live' });
    }
    return list.slice(0, 5);
  }
  /* 画布外接矩形：整段固定（推入 / 返回含一级形状，静止含展开 / 并入两态），不逐帧改画布尺寸 */
  function extent(list) {
    var G = S.G, rs = list.slice();
    if (G) {
      rs.push(G.back, G.plus);
      if (G.cta) rs = rs.concat(G.cta.pe, G.cta.pc || []);
      if (G.live) rs.push(G.live);
      /* 一级形状一直算进来（它几乎就在圆钮那一行里，只高出 4px）：静止 ⇄ 推入 / 返回之间画布尺寸不变，开始返回那一帧不重新分配画布 */
      if (S.L1) rs.push(S.L1.cap, S.L1.orb);
    }
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    rs.forEach(function (q) { if (!q) return; x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x + q.w); y1 = Math.max(y1, q.y + q.h); });
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  /* ---------- DOM 跟随 ---------- */
  function boxTo(el, fin, sh, op) {
    if (!el) return;
    if (!sh) { el.style.transform = ''; el.style.width = ''; el.style.height = ''; el.style.removeProperty('--fz-io'); return; }
    el.style.width = sh.w.toFixed(2) + 'px'; el.style.height = sh.h.toFixed(2) + 'px';
    el.style.transform = 'translate(' + (sh.x - fin.x).toFixed(2) + 'px,' + (sh.y - fin.y).toFixed(2) + 'px)';
    if (op != null) el.style.setProperty('--fz-io', op.toFixed(3)); else el.style.removeProperty('--fz-io');
  }
  function scaleTo(el, fin, sh) {
    if (!el) return;
    if (!sh) { el.style.removeProperty('transform'); el.style.removeProperty('transform-origin'); return; }
    el.style.transformOrigin = '0 0';
    el.style.transform = 'translate(' + (sh.x - fin.x).toFixed(2) + 'px,' + (sh.y - fin.y).toFixed(2) + 'px) scale(' + (sh.w / fin.w).toFixed(4) + ',' + (sh.h / fin.h).toFixed(4) + ')';
  }
  function union(rs) {
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    rs.forEach(function (q) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x + q.w); y1 = Math.max(y1, q.y + q.h); });
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  function applyDom(list) {
    var G = S.G; if (!G) return;
    var byId = {}; list.forEach(function (q) { byId[q.id] = q; });
    var anim = !!(S.tw || S.drag || S.m < 1);
    var b = bar(), sub = isSubDom();
    var backEl = doc.getElementById('backBtn'), plusEl = doc.querySelector('[data-qd-toggle].tab-plus'), orb = doc.getElementById('dockOrb');
    if (sub) {
      /* 二级 DOM：返回 / ＋ 钮的盒子 = 形状（GL 在画时只是图标跟着走；GL 不在时盒子自己就是 CSS 玻璃） */
      boxTo(backEl, G.back, anim ? byId.back : null, anim ? smooth(0.35, 0.9, S.m) : null);
      boxTo(plusEl, G.plus, anim ? byId.plus : null, null);
      if (b) b.style.removeProperty('--fz-ta');
    } else if (S.L1) {
      /* 一级 DOM（返回途中）：GL 在画时胶囊 / ＋ 珠不动（GL 画布是栏的子节点，不能跟着缩放），只让页签在形状长回来时淡入、＋ 跟着形状走；
         GL 不在时胶囊 / ＋ 珠自己就是玻璃，整块缩放到形状 */
      if (S.gl) {
        scaleTo(b, null, null); scaleTo(orb, null, null);
        var pq = byId.plus, pl1 = orb && orb.querySelector('[data-qd-toggle]');
        if (pl1) pl1.style.transform = anim && pq ? 'translate(' + (pq.x + pq.w / 2 - S.L1.orb.x - S.L1.orb.w / 2).toFixed(2) + 'px,' + (pq.y + pq.h / 2 - S.L1.orb.y - S.L1.orb.h / 2).toFixed(2) + 'px)' : '';
      } else {
        scaleTo(b, S.L1.cap, anim ? byId.back : null);
        scaleTo(orb, S.L1.orb, anim ? byId.plus : null);
      }
      if (b) { if (anim) b.style.setProperty('--fz-ta', (1 - smooth(0.05, 0.55, S.m)).toFixed(3)); else b.style.removeProperty('--fz-ta'); }
    }
    /* 替身：推入时一级页签跟着胶囊缩走淡出；返回时返回图标跟着长回去淡出 */
    var gh = S.ghost;
    if (gh && gh.el) {
      var q = byId.back;
      if (!anim || !q) { killGhost(); }
      else {
        var f = gh.fin, s = Math.min(1, q.h / f.h);
        gh.el.style.transform = 'translate(' + (q.x + q.w / 2 - f.x - f.w / 2).toFixed(2) + 'px,' + (q.y + q.h / 2 - f.y - f.h / 2).toFixed(2) + 'px) scale(' + s.toFixed(4) + ')';
        gh.el.style.opacity = (gh.kind === 'tabs' ? 1 - smooth(0, 0.42, S.m) : smooth(0.35, 0.9, S.m)).toFixed(3);
      }
    }
    /* 记录条：左右留白（并入一行）+ transform（冒出 / 吸收 / 按下）+ 内容透明度 */
    var root = ctaRoot();
    if (root && G.cta && sub) {
      var c = S.c.x, pad = 16 + (CIR + GAP) * c;
      root.style.paddingLeft = root.style.paddingRight = (c > 0.0005 ? pad.toFixed(2) + 'px' : '');
      var cur = list.filter(function (x) { return /^cta/.test(x.id); });
      if (cur.length) {
        var PCd = c > 0.0005 ? pcOf(G) : G.cta.pe;
        var lay = union(G.cta.pe.map(function (p, i) { var r = c > 0.0005 ? lerpR(p, PCd[i], c) : { x: p.x, y: p.y, w: p.w, h: p.h }; r.y = G.cta.pe[i].y; return r; }));
        var U = union(cur);
        var dx = U.x + U.w / 2 - (lay.x + lay.w / 2), dy = U.y + U.h / 2 - (lay.y + lay.h / 2);
        var sx = U.w / lay.w, sy = U.h / lay.h;
        var idle = Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01 && Math.abs(sx - 1) < 0.0005 && Math.abs(sy - 1) < 0.0005;
        if (idle) { root.style.transform = ''; root.style.transformOrigin = ''; }
        else {
          root.style.transformOrigin = (lay.x + lay.w / 2 - G.cta.root.x).toFixed(1) + 'px ' + (lay.y + lay.h / 2 - G.cta.root.y).toFixed(1) + 'px';
          root.style.transform = 'translate(' + dx.toFixed(2) + 'px,' + dy.toFixed(2) + 'px) scale(' + sx.toFixed(4) + ',' + sy.toFixed(4) + ')';
        }
        var op = smooth(0.55, 1, S.e) * (1 - smooth(0, 0.5, S.ab.x));
        if (op > 0.999) root.style.removeProperty('--fz-co'); else root.style.setProperty('--fz-co', op.toFixed(3));
        root.classList.toggle('fz-press', S.pr.x > 0.01);
        root.classList.toggle('fz-min', c > 0.5);
      } else { root.style.setProperty('--fz-co', '0'); root.style.transform = ''; }
    }
    /* 离开的旧记录条（浮层里）：跟着被吸回的形状缩 */
    if (S.fl && S.fl.old && S.fl.el && S.old) {
      var oc = list.filter(function (x) { return /^old/.test(x.id); });
      var ou = oc.length ? union(oc) : null, ol = union(S.old);
      if (ou) {
        S.fl.el.style.transformOrigin = (ol.x + ol.w / 2 - S.fl.box.x).toFixed(1) + 'px ' + (ol.y + ol.h / 2 - S.fl.box.y).toFixed(1) + 'px';
        S.fl.el.style.transform = 'translate(' + (ou.x + ou.w / 2 - ol.x - ol.w / 2).toFixed(2) + 'px,' + (ou.y + ou.h / 2 - ol.y - ol.h / 2).toFixed(2) + 'px) scale(' + (ou.w / ol.w).toFixed(4) + ',' + (ou.h / ol.h).toFixed(4) + ')';
        S.fl.el.style.setProperty('--fz-co', smooth(0.55, 1, S.eo).toFixed(3));
      } else S.fl.el.style.setProperty('--fz-co', '0');
    }
    var lv = liveEl();
    if (lv) { if (anim) lv.style.setProperty('--fz-lo', smooth(0.7, 1, sub ? S.m : 1 - S.m).toFixed(3)); else lv.style.removeProperty('--fz-lo'); }
  }

  /* ---------- 帧 ---------- */
  function frame() {
    S.raf = 0;
    var t = now(), dt = S.last ? Math.min(50, Math.max(1, t - S.last)) : 16.7; S.last = t;
    var w0 = now();
    var moving = false;
    if (S.tw) {
      var tw = S.tw;
      tw.t = clamp01((t - tw.t0) / tw.dur);
      var p = tw.t;
      S.m = lerp(tw.m0, tw.m1, easeNav(p));
      if (tw.kind === 'push') S.e = clamp01((S.m - 0.1) / 0.9);
      else if (tw.kind === 'pop') S.eo = clamp01((S.m - 0.2) / 0.8) * tw.eo0;
      else if (tw.kind === 'swapOut') S.eo = 1 - easeOut(p);
      else if (tw.kind === 'emerge') S.e = easeOut(p);
      else if (tw.kind === 'back') { /* 侧滑没过阈值：回到二级 */ }
      if (p >= 1) { var k = tw.kind; S.tw = null; twDone(k); }
      else moving = true;
    }
    if (stepSpring(S.c, dt)) moving = true;
    if (stepSpring(S.ab, dt)) moving = true;
    if (stepSpring(S.pr, dt)) moving = true;
    if (stepSpring(S.pp, dt)) moving = true; else if (S.pp.t === 0 && S.pp.x === 0) S.pk = null;
    var fill = 1;
    if (S.fade) {
      var fp = clamp01((t - S.fade) / 120);
      fill = 1 - fp;
      if (fp >= 1) { S.fade = 0; endFuse(); perfMark(w0, dt); return; }
      moving = true;
    }
    S.moving = !!(moving || S.drag);
    render(fill);
    perfMark(w0, dt);
    if (moving || S.drag) S.raf = global.requestAnimationFrame(frame);
  }
  function perfMark(w0, dt) {
    if (!S.perf) return;
    S.perf.frames.push({ work: Math.round((now() - w0) * 100) / 100, dt: Math.round(dt * 10) / 10, m: Math.round(S.m * 1000) / 1000, c: Math.round(S.c.x * 1000) / 1000 });
    if (S.perf.frames.length > 600) S.perf.frames.shift();
  }
  function kick() { if (!S.raf) { S.last = now(); S.raf = global.requestAnimationFrame(frame); } }
  var lastList = null;
  function render(fill) {
    if (!S.G) return;
    var list = shapes();
    lastList = list;
    if (S.fade) {
      /* 回到一级页的交叉淡出：胶囊保留边带（一级 dock 本来就由 GL 画边带）、中间填充淡掉；＋ 珠整块淡掉（一级的 ＋ 珠是 CSS 玻璃） */
      list = list.slice(0, 2); list[1] = Object.assign({}, list[1], { a: fill });
    }
    var DR = global.DockRefract, drawn = false;
    if (!S.barR) S.barR = barRectNow();
    if (DR && DR.fuse && DR.fuseOk && DR.fuseOk() && !reducedTransparency() && !body().classList.contains('hc')) {
      drawn = DR.fuse(list, { ext: extent(list), bar: S.barR, fill: fill, tint: S.G.cta && S.G.cta.tint ? S.G.cta.tint.T.concat([S.G.cta.tint.a]) : null, moving: S.moving });
    }
    S.gl = drawn;
    htmlCls('fz-gl', drawn);
    if (!S.fade) applyDom(list);
  }
  function reducedTransparency() { try { return global.matchMedia('(prefers-reduced-transparency: reduce)').matches; } catch (e) { return false; } }

  function settledSoon() { var DR = global.DockRefract; if (DR && DR.settled) setTimeout(function () { if (!morphing()) DR.settled(); }, 0); }
  function twDone(kind) {
    settledSoon();   /* 推迟的整页快照现在可以拍了 */
    if (kind === 'pop' && !isSubDom()) {
      /* 合拢完：一级 DOM 的 CSS 毛玻璃回来，GL 中间填充 120ms 淡出 */
      dropOld();
      bodyCls('fz-morph', false);
      var b = bar(), orb = doc.getElementById('dockOrb');
      scaleTo(b, null, null); scaleTo(orb, null, null); if (b) b.style.removeProperty('--fz-ta');
      var pl1 = orb && orb.querySelector('[data-qd-toggle]'); if (pl1) pl1.style.transform = '';
      killGhost();
      if (S.gl) {
        S.fade = now(); kick();
        /* 兜底：掉帧 / rAF 被节流时 200ms 后直接收尾（淡出本身 120ms） */
        clearTimeout(S.fadeT);
        var fb = function () { if (!S.fade || isSubDom()) return; if (now() - S.fade >= 120 || doc.hidden) { S.fade = 0; endFuse(); } else S.fadeT = setTimeout(fb, 80); };
        S.fadeT = setTimeout(fb, 200);
      } else endFuse();
      return;
    }
    if (kind === 'swapOut' || kind === 'pop') dropOld();
    if (kind === 'swapOut') { bodyCls('fz-morph', false); S.m = 1; if (S.swapWait) return; measure(); render(1); return; }
    bodyCls('fz-morph', false);
    killGhost();
    S.m = isSubDom() ? 1 : 0; S.e = 1;
    /* 推入落定：几何在 navAfter 已量过（版面没变），不再强制排版重量一遍（原来这一帧 +10ms） */
    if (isSubDom()) { if (!geoFresh()) measure(); render(1); }
  }
  /* 缓存的几何还对得上 DOM（记录条节点还在、栏没换尺寸）就不用重量 */
  function geoFresh() {
    var G = S.G; if (!G) return false;
    if ((global.innerWidth || 0) !== G.W || (global.innerHeight || 0) !== G.H) return false;
    var root = (S.fl && !S.fl.old && S.fl.real) ? S.fl.real : ctaRoot(), ps = root ? pieces(root) : [];
    if (!G.cta) return !ps.length && !!liveEl() === !!G.live;
    if (ps.length !== G.cta.els.length) return false;
    for (var i = 0; i < ps.length; i++) if (ps[i] !== G.cta.els[i]) return false;
    return !!liveEl() === !!G.live;
  }
  function endFuse() {
    var DR = global.DockRefract;
    if (DR && DR.fuse) DR.fuse(null);
    settledSoon();
    htmlCls('fz-gl', false);
    S.gl = false; S.G = null; S.barR = null; lastList = null;
    bodyCls('fz-sub', false);
    bodyCls('fz-morph', false);
    clearDom();
  }
  function clearDom() {
    var backEl = doc.getElementById('backBtn'), plusEl = doc.querySelector('[data-qd-toggle].tab-plus');
    boxTo(backEl, null, null); boxTo(plusEl, null, null);
    var root = ctaRoot();
    if (root) { root.style.transform = ''; root.style.transformOrigin = ''; root.style.paddingLeft = root.style.paddingRight = ''; root.style.removeProperty('--fz-co'); root.classList.remove('fz-press', 'fz-min'); }
    var lv = liveEl(); if (lv) lv.style.removeProperty('--fz-lo');
  }
  function killGhost() { if (S.ghost && S.ghost.el && S.ghost.el.parentNode) S.ghost.el.parentNode.removeChild(S.ghost.el); S.ghost = null; }
  function dropOld() {
    if (S.fl && S.fl.old) { if (S.fl.wrap && S.fl.wrap.parentNode) S.fl.wrap.parentNode.removeChild(S.fl.wrap); S.fl = null; floatLayerTidy(); }
    S.old = null; S.eo = 0;
  }

  /* ---------- 浮层：推入 / 返回的横推里记录条不跟着页面走（#view 有 transform、叠放层在 dock 下面） ---------- */
  function floatLayer() {
    var l = doc.getElementById('ctaFloat');
    if (!l) { l = doc.createElement('div'); l.id = 'ctaFloat'; l.setAttribute('aria-hidden', 'false'); doc.body.appendChild(l); }
    return l;
  }
  function floatLayerTidy() { var l = doc.getElementById('ctaFloat'); if (l && !l.firstChild) l.parentNode.removeChild(l); }
  function copyVars(src, dst) {
    var cs = global.getComputedStyle(src);
    ['--tile', '--tile-fill', '--tile-on', '--tile-text', '--tile-weak'].forEach(function (k) { var v = cs.getPropertyValue(k); if (v) dst.style.setProperty(k, v.trim()); });
  }
  /* 浮起来的是替身（克隆、inert）：真记录条留在原处藏起来（模块在横推里可能重画 #view，真节点随时会被换掉；
     落定时摘掉替身、露出 #view 里此刻真正的记录条）。 */
  function floatOut(el, old) {
    if (!el || !el.parentNode) return null;
    var pageRoot = el.closest('#view > *') || el.parentNode;
    var wrap = doc.createElement('div');
    wrap.className = 'fz-fl ' + (pageRoot === el ? '' : String(pageRoot.className || '').replace(/\bview-enter\b/g, ''));
    if (pageRoot.getAttribute && pageRoot.getAttribute('data-accent')) wrap.setAttribute('data-accent', pageRoot.getAttribute('data-accent'));
    copyVars(el, wrap);
    var c = el.cloneNode(true);
    c.removeAttribute('id'); c.setAttribute('aria-hidden', 'true'); try { c.inert = true; } catch (e) { /* */ }
    Array.prototype.forEach.call(c.querySelectorAll('[id]'), function (n) { n.removeAttribute('id'); });
    c.style.top = ''; c.style.bottom = '';
    floatLayer().appendChild(wrap);
    wrap.appendChild(c);
    el.classList.add('fz-hide');
    return { el: c, real: el, wrap: wrap, old: !!old, box: S.G && S.G.cta ? S.G.cta.root : rect(el.getBoundingClientRect()) };
  }
  function floatBack() {
    var f = S.fl; if (!f || f.old) return;
    S.fl = null;
    if (f.wrap && f.wrap.parentNode) f.wrap.parentNode.removeChild(f.wrap);
    Array.prototype.forEach.call(doc.querySelectorAll('#view .mod-cta.fz-hide'), function (x) { x.classList.remove('fz-hide'); });
    floatLayerTidy();
  }
  F.floating = function () { return S.fl && !S.fl.old ? S.fl.real : null; };

  /* ---------- 外部入口 ---------- */
  function topTarget(id) { try { return !!(global.App && App.isTopTab && App.isTopTab(id)); } catch (e) { return false; } }
  /* 横推开始前（DOM 还是旧页）：记下旧形状 / 旧记录条 */
  F.navBegin = function (kind, fromId, toId) {
    if (reduced) return null;
    /* 上一次合拢的淡出还没走完（掉帧时可能拖住）：立刻收尾，免得它在新页上把融合状态整个清掉 */
    if (S.fade) { S.fade = 0; endFuse(); }
    S.navPending = true;
    var fromTop = !isSubDom(), toTop = topTarget(toId);
    var info = { kind: kind, fromTop: fromTop, toTop: toTop };
    if (fromTop && !toTop) {
      captureL1();
      /* 一级页签的替身（推入时跟着胶囊缩走、淡出） */
      var b = bar();
      if (b) {
        killGhost();
        var g = b.cloneNode(true), br = S.L1.cap;
        g.removeAttribute('id'); g.className = 'tabbar lg fz-ghost'; g.setAttribute('aria-hidden', 'true');
        Array.prototype.forEach.call(g.querySelectorAll('canvas, .lg-thumb, #backBtn, [id]'), function (n) { if (n.tagName === 'CANVAS' || n.classList.contains('lg-thumb') || n.id === 'backBtn') n.parentNode.removeChild(n); else n.removeAttribute('id'); });
        g.style.cssText = 'left:' + br.x + 'px;top:' + br.y + 'px;width:' + br.w + 'px;height:' + br.h + 'px;right:auto;bottom:auto;margin:0;';
        doc.body.appendChild(g);
        S.ghost = { el: g, fin: br, kind: 'tabs' };
      }
    } else if (!fromTop) {
      /* 离开二级页：旧记录条浮出来（不跟旧页横走），被吸回 dock */
      var root = ctaRoot();
      if (root && S.G && S.G.cta && root.closest('#view')) {
        S.old = lastList ? lastList.filter(function (q) { return /^cta/.test(q.id); }).map(function (q) { return { x: q.x, y: q.y, w: q.w, h: q.h, tm: q.tm }; }) : null;
        if (S.old && S.old.length) { S.fl = floatOut(root, true); S.eo = S.e; }
        else S.old = null;
      }
      if (toTop) {
        killGhost();
        var bb = doc.getElementById('backBtn');
        if (bb && S.G) {
          var gg = bb.cloneNode(true); gg.removeAttribute('id'); gg.className = 'fz-ghost fz-ghost-back'; gg.setAttribute('aria-hidden', 'true');
          gg.style.cssText = 'left:' + S.G.back.x + 'px;top:' + S.G.back.y + 'px;width:' + CIR + 'px;height:' + CIR + 'px;';
          doc.body.appendChild(gg);
          S.ghost = { el: gg, fin: S.G.back, kind: 'back' };
        }
      }
    }
    return info;
  };
  /* 新页已渲染（DOM 是新页）：开始形变 */
  F.navAfter = function (info, dur) {
    S.navPending = false;
    if (!info) { F.sync(); return; }
    var sub = isSubDom();
    bodyCls('fz-sub', sub || !!S.old || (!info.fromTop && info.toTop));
    if (info.fromTop && sub) {
      /* 推入：新记录条先浮起来（横推里不跟页走），一级 → 二级 */
      bodyCls('fz-morph', true);
      /* 横推的 freezeCta 把新页记录条换算成了相对 #view 的 top（按旧的 --cta-b 算的）：量之前还原，真节点之后藏起来、由替身代演 */
      var r0 = doc.querySelector('#view .mod-cta'); if (r0) { r0.style.top = ''; r0.style.bottom = ''; }
      measure();
      var root = ctaRoot();
      if (root && root.closest('#view') && S.G.cta) S.fl = floatOut(root, false);
      S.m = 0; S.e = 0; S.c.x = S.c.t = S.c.v = 0; S.ab.x = S.ab.t = 0; S.pr.x = S.pr.t = 0;
      S.tw = { kind: 'push', m0: 0, m1: 1, t0: now(), dur: PUSH_MS, t: 0 };
    } else if (!info.fromTop && !sub) {
      /* 返回一级：从当前形变量（侧滑可能已经走了一段）合拢到一级 */
      captureL1(); S.barR = barRectNow();
      bodyCls('fz-morph', true);
      var m0 = S.m;
      S.drag = false;
      S.tw = { kind: 'pop', m0: m0, m1: 0, t0: now(), dur: Math.max(120, (dur || POP_MS) * Math.max(0.35, m0)), t: 0, eo0: 1 };
      S.e = 0;
    } else if (!info.fromTop && sub) {
      /* 二级换二级：圆钮不动；旧记录条（浮层里）吸回 dock，新记录条等横推落定（navEnd）再从 dock 冒出——
         横推中新页在 #view 里（有 transform），这时量它的位置是错的 */
      S.m = 1; S.e = 0; S.c.x = S.c.t = S.c.v = 0; S.swapWait = true;
      if (S.G) S.G.cta = null;
      S.tw = S.old ? { kind: 'swapOut', m0: 1, m1: 1, t0: now(), dur: 260, t: 0 } : null;
      bodyCls('fz-swap', true);
    } else { F.sync(); return; }
    render(1);
    kick();
  };
  F.navEnd = function () {
    if (S.swapWait) {
      /* 二级换二级落定：量新页、新记录条从 dock 冒出 */
      S.swapWait = false; bodyCls('fz-swap', false);
      if (S.tw && S.tw.kind === 'swapOut') { S.tw = null; dropOld(); }
      if (isSubDom()) {
        measure();
        if (S.G.cta && !reduced) { S.e = 0; S.tw = { kind: 'emerge', m0: 1, m1: 1, t0: now(), dur: 280, t: 0 }; kick(); }
        else S.e = 1;
        render(1);
      }
      return;
    }
    /* 横推落定：浮出来的新记录条放回 #view（模块里的委托事件、测试选择器都认 #view .mod-cta） */
    if (S.fl && !S.fl.old) {
      var root = S.fl.el;
      floatBack();
      if (isSubDom() && !S.tw) { if (!geoFresh()) measure(); render(1); }
    }
  };
  /* 侧滑返回跟手：p = 页面已拖出去的比例 */
  F.swipe = function (p) {
    if (reduced || !isSubDom()) return;
    try { if (global.App && App._histDepth && App._histDepth() > 1) return; } catch (eH) { /* */ }
    if (global.App && App.inSub && App.inSub()) return;
    if (!S.G) measure();
    if (!S.drag) { S.drag = true; bodyCls('fz-morph', true); if (!S.L1) S.L1 = l1Default(S.G); }
    S.tw = null;
    S.m = 1 - clamp01(p) * 0.85;
    kick();
  };
  F.swipeEnd = function (passed) {
    if (!S.drag) return;
    if (passed) {   /* 由返回横推（navBegin / navAfter）接着走；popstate 万一没来，0.9 秒后自己回到二级 */
      clearTimeout(S.dragT); S.dragT = setTimeout(function () { if (S.drag && !S.tw) F.swipeEnd(false); }, 900);
      return;
    }
    S.drag = false;
    S.tw = { kind: 'back', m0: S.m, m1: 1, t0: now(), dur: 240, t: 0 };
    kick();
  };
  /* 快速记录面板开 / 关：记录条先被 ＋ 吸收，收起后再冒出来 */
  F.absorb = function (on) {
    if (!isSubDom() || !S.G || !S.G.cta) return;
    S.ab.t = on ? 1 : 0;
    if (reduced) { S.ab.x = S.ab.t; S.ab.v = 0; }
    kick();
  };
  /* 下滑并入一行 / 展开 */
  F.collapse = function (on) {
    if (!S.collapseOk || !isSubDom()) on = false;
    var t = on ? 1 : 0;
    if (S.c.t === t) return;
    if (t && S.G) pcOf(S.G);
    S.c.t = t;
    if (reduced) { S.c.x = t; S.c.v = 0; }
    kick();
  };
  function onScroll() {
    if (!S.G || !isSubDom() || S.tw || S.drag) return;
    var y = global.scrollY || global.pageYOffset || 0, dy = y - S.lastY; S.lastY = y;
    if (!S.collapseOk) return;
    if (y <= 8) { S.upAcc = 0; F.collapse(false); return; }
    if (dy > 0) { S.upAcc = 0; if (y > 24 && dy > 1) F.collapse(true); }
    else if (dy < 0) { S.upAcc += -dy; if (S.upAcc >= 8) F.collapse(false); }
  }
  /* 并入一行时点记录条：先展开（这一下不触发它的动作） */
  function onClickCap(e) {
    if (!S.G || S.c.t < 1 || !isSubDom()) return;
    var root = ctaRoot();
    if (root && e.target && root.contains(e.target)) { e.preventDefault(); e.stopPropagation(); if (e.stopImmediatePropagation) e.stopImmediatePropagation(); F.collapse(false); }
  }
  /* 分裂 / 合拢 / 侧滑跟手 / 合拢后淡出期间 = 形变中（liquid-dock.js 据此不做整条 dock 放大、不出透镜） */
  function morphing() { return !!((S.tw && S.tw.kind !== 'emerge' && S.tw.kind !== 'swapOut') || S.drag || S.fade); }
  F.morphing = morphing;
  function pieceOf(t) {
    if (!t || !t.closest) return null;
    if (t.closest('[data-qd-toggle]')) return 'plus';
    if (t.closest('#backBtn')) return 'back';
    var b = bar();
    if (b && !isSubDom() && b.contains(t) && t.closest('button')) return 'back';   /* 合拢回一级途中：胶囊（形状表里的 back）上的页签 */
    return null;
  }
  F.pressPiece = function (t, down) {
    if (down) { var id = pieceOf(t); if (!id) return false; S.pk = id; S.pp.t = 1; }
    else S.pp.t = 0;
    if (reduced) { S.pp.x = S.pp.t; S.pp.v = 0; }
    kick();
    return true;
  };
  function onDown(e) {
    if (morphing() && F.pressPiece(e.target, true)) return;
    var root = ctaRoot();
    if (!root || !S.G || !S.G.cta || !isSubDom() || !e.target || !root.contains(e.target)) return;
    if (e.target.closest && !e.target.closest('button, [role="button"], a')) return;
    S.pr.t = 1; kick();
  }
  function onUp() { if (S.pr.t !== 0) { S.pr.t = 0; kick(); } if (S.pp.t !== 0) F.pressPiece(null, false); }

  /* 底栏重建 / 换页（没走横推）/ 记录条内容变 / 窗口变：按当前 DOM 定状态，不做形变 */
  F.sync = function () {
    if (S.tw || S.drag || S.fade || S.navPending) return;
    var sub = isSubDom();
    if (!sub) {
      if (body() && body().classList.contains('fz-sub')) endFuse();
      if (!S.fl) captureL1();
      S.m = 0; return;
    }
    if (S.fl && !S.fl.old) return;
    bodyCls('fz-sub', true);
    S.m = 1; S.e = 1;
    var hadCta = !!(S.G && S.G.cta);
    measure();
    if (!S.collapseOk) { S.c.x = S.c.t = S.c.v = 0; }
    if (!hadCta && S.G.cta && S.c.x > 0) { S.c.x = S.c.t = 0; }
    S.lastY = global.scrollY || 0;
    if ((global.scrollY || 0) <= 8) { S.c.t = 0; }
    S.moving = S.c.x !== S.c.t;
    render(1);
    if (S.c.x !== S.c.t) kick();
  };
  F.ctaChanged = function () { if (!S.tw && !S.drag && isSubDom()) F.sync(); };
  F._state = function () {
    return { sub: isSubDom(), m: S.m, e: S.e, eo: S.eo, c: S.c.x, ct: S.c.t, ab: S.ab.x, pr: S.pr.x, pp: S.pp.x, pk: S.pk, morphing: morphing(), tw: S.tw ? S.tw.kind : null, drag: S.drag, fade: !!S.fade,
      gl: S.gl, collapseOk: S.collapseOk, fl: S.fl ? (S.fl.old ? 'old' : 'new') : null, ghost: S.ghost ? S.ghost.kind : null,
      G: S.G ? { back: S.G.back, plus: S.G.plus, live: S.G.live, cta: S.G.cta ? { pe: S.G.cta.pe, pc: pcOf(S.G), kinds: S.G.cta.kinds, tint: S.G.cta.tint } : null, cy: S.G.cy } : null,
      L1: S.L1, list: lastList };
  };
  F._shapes = function () { return lastList; };
  F._perf = function (on) { if (on === true) { S.perf = { frames: [] }; return true; } var p = S.perf; if (on === false) S.perf = null; return p; };
  F._step = function (ms) { S.last = now() - (ms || 16.67); if (S.raf) { global.cancelAnimationFrame(S.raf); S.raf = 0; } frame(); return F._state(); };
  F._measure = function () { return measure(); };
  F._clock = function (f) { clk = typeof f === 'function' ? f : null; };
  F.K = { REST: K_REST, DROP: K_DROP, EMERGE: K_EMERGE, SPLIT: K_SPLIT, CIR: CIR, GAP: GAP, PRESS_PIECE: PRESS_PIECE, PUSH_MS: PUSH_MS, SPRING: { k: 300, z: 0.86 } };

  function init() {
    global.addEventListener('scroll', onScroll, { passive: true });
    global.addEventListener('resize', function () { if (isSubDom() && !S.tw && !S.drag) { S.L1 = null; F.sync(); } }, { passive: true });
    doc.addEventListener('click', onClickCap, true);
    doc.addEventListener('pointerdown', onDown, true);
    doc.addEventListener('pointerup', onUp, true);
    doc.addEventListener('pointercancel', onUp, true);
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init); else init();
  global.DockFuse = F;
})(window);
