/**
 * liquid-dock.js — 底部胶囊 dock 的液态玻璃（第 235 次）
 *
 * 参考了用户给的 Apple Music 安卓包。拆包后发现：玻璃效果不是 Apple 官方写的，
 * 而是 NPatch 注入的第三方模块 AM Enhancer（AMPlusPlus），它用的是开源库
 * Kyant「AndroidLiquidGlass / backdrop」（Apache-2.0，AGSL RuntimeShader）。
 * 那套着色器的思路分三层，这里按网页能做到的程度逐层对应：
 *
 *   1. 折射（RoundedRectRefraction）：用圆角矩形的距离场 sd 算「离边多远」，
 *      在边缘 refractionHeight 这一圈里按 circleMap(x)=1-√(1-x²) 往外偏移采样，
 *      所以越靠边、背景被「拉弯」得越厉害，中间保持清晰。
 *      → 网页：Chromium 支持 backdrop-filter: url(#svg滤镜)，这里用同一套公式
 *        在 canvas 里画出位移贴图，交给 feDisplacementMap。
 *        iOS Safari 不支持 backdrop-filter 里的 url()（整块玻璃会消失），
 *        所以 iOS 只开模糊 + 饱和度，不开折射。
 *   2. 高光（Highlight）：intensity = |dot(边缘法线, 光线方向)|^falloff，
 *      光从左上 45° 打来，左上和右下两条边最亮。
 *      → 网页：双层渐变描边（mask 只留 1px 边）＋ 内阴影，两个平台都有。
 *   3. 交互：选中的那个「玻璃水滴」跟着手指滑动，按下时压扁、松开回弹
 *      （模块里的 MiniSinkBounce / ReboundPercent）。
 *      → 网页：.lg-thumb 指示器 + 弹簧曲线；整条胶囊按下轻微下沉。
 *
 * 第 309 次：选中指示器做成定稿的「第十四版透镜」（fix303/mock303n）：
 *   静止 = 栏内浅灰小胶囊（.lg-thumb）；按下约 0.15 秒鼓成比栏高、略宽的透镜（#lgLens），拖动跟手，
 *   松手吸附到页签再缩回灰胶囊。透镜中间 1:1 不变形（图标原位原大，只换成彩色选中态 .dk-c），
 *   折射只在外沿约 7px 一圈：往外 17px（左右）/ 30px（上下）取样，把透镜外的内容压成贴边的彩色细带；
 *   栏的上下边在透镜里是两条水平直细线；色散 R/G/B 三通道（IOR 1.47 / 1.5 / 1.535），静止淡、拖动随速度变重。
 *   Chromium：透镜元素 backdrop-filter:url(#lgLens)（位移贴图按透镜尺寸生成，透镜外 B 通道遮罩 = 原样）；
 *   iOS / WebKit：dock-refract.js 的 WebGL 在 dock 画布里画同一套外沿折射（DR.lens）。
 *
 * 第 312 次：「真液态玻璃」——位移表、高光、磨砂配方都来自共享的 js/glass-optics.js（kube.io 凸 squircle + Snell；
 *   Glass-HQ regular 材质）。dock 本体凸面往里取样 + 磨砂 + rim light；透镜外沿用同一张 Snell 表往外取样 + 色散 + rim light；
 *   iOS 着色器（dock-refract.js）用同一张表（1D 纹理）、同样的色调与高光，并把 dock 图标画进单独纹理，让邻近图标在透镜边上真的弯进去。
 *
 * 第 313 次（真机录屏修透镜）：透镜改成宽而扁（136 × 栏高+6）；iOS 透镜外沿不再画 dock 图标纹理（对不齐 → 碎块 / 重影，退回 DOM 图标干净换色）；
 *   DR.lens 带上不透明度并当场同步重画（GL 透镜与 CSS 外形同一帧）；透镜内部由 GL 画成放大 1.06、略提亮的玻璃体。
 *   浅色「白胶囊」/ 深色「黑胶囊」的真凶是触屏 :hover 粘住 + .tab:hover{background:var(--surface)}，CSS 第 313 次段落清掉。
 *
 * 第 314 次（用户：「仅仅是一块玻璃，没有液态感」）：透镜改成弹簧物理（PHYS：鼓起欠阻尼过冲、拖动临界阻尼跟手、松手欠阻尼吸附、
 *   速度形变 +12% / −11% 带果冻回弹、两端橡皮筋）；凸透镜光学（中心放大 1.15、外沿 bezel 14 往里取样 18 / 11px 的拉丝折射带、色散只在边上随速度）；
 *   动态高光（随运动方向 / 速度、按下亮弧）；iOS 上透镜里的彩色图标由 GL 的「透镜图标层」画，DOM 图标按透镜形状挖洞；与 dock 的 smooth-min 融合在着色器里。
 *   Chromium 路径：一张贴图（静止尺寸）+ 元素 scale 形变，融合不做（CSS 做不了 smooth-min，降级为两个形状叠放）。
 *
 * 不改 app.js 的构建逻辑：MutationObserver 盯着 #tabbar，每次重建后补回指示器、
 * 把它从上一次的位置滑到新位置（FLIP）。减少动态效果 / 高对比 / 减少透明度时降级。
 */
(function (global) {
  'use strict';
  var doc = global.document;
  if (!doc) return;

  var LD = {};
  var bar = null, thumb = null, lastRect = null, mo = null, ro = null, refractOn = false, mapKey = '';
  var reduced = false;
  try { reduced = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* 老内核 */ }

  /* ---------- 1. 折射：Kyant 距离场公式 → 位移贴图 ---------- */
  function sdRoundRect(px, py, hx, hy, r) {
    var cx = Math.abs(px) - (hx - r), cy = Math.abs(py) - (hy - r);
    var ox = Math.max(cx, 0), oy = Math.max(cy, 0);
    return Math.sqrt(ox * ox + oy * oy) - r + Math.min(Math.max(cx, cy), 0);
  }
  function gradRoundRect(px, py, hx, hy, r) {
    var cx = Math.abs(px) - (hx - r), cy = Math.abs(py) - (hy - r);
    var sx = px < 0 ? -1 : 1, sy = py < 0 ? -1 : 1;
    if (cx >= 0 || cy >= 0) {
      var ax = Math.max(cx, 0), ay = Math.max(cy, 0), l = Math.max(Math.sqrt(ax * ax + ay * ay), 1e-4);
      return [sx * ax / l, sy * ay / l];
    }
    var gx = cy <= cx ? 1 : 0;
    return [sx * gx, sy * (1 - gx)];
  }
  function circleMap(x) { return 1 - Math.sqrt(Math.max(0, 1 - x * x)); }

  /* 返回位移贴图的 dataURL；R/G 通道 128 为不动，±127 对应 ±scale/2 像素。
     第 312 次：改用 glass-optics.js 的凸 squircle + Snell 位移表，凸面「往里」取样（不出玻璃边界）；
     opts.amount = 最大位移（px），opts.height = bezel 宽（px）。没有 GlassOptics 时退回旧的 circleMap。 */
  LD.buildMap = function (w, h, opts) {
    opts = opts || {};
    var GO = global.GlassOptics;
    if (GO) return GO.dispMap(w, h, { bezel: Math.min(opts.height || 18, w / 2, h / 2), maxPx: opts.amount != null ? opts.amount : 14, dir: 1 });
    var amount = opts.amount != null ? opts.amount : 14;
    var W = Math.max(2, Math.round(w)), H = Math.max(2, Math.round(h));
    var c = doc.createElement('canvas'); c.width = W; c.height = H;
    var g = c.getContext('2d'); if (!g) return null;
    var img = g.createImageData(W, H), d = img.data;
    var hx = w / 2, hy = h / 2, r = Math.min(hx, hy);
    var height = Math.min(opts.height || 18, hx, hy), gr = Math.min(r * 1.5, hx, hy);
    var scale = amount * 2;
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var px = x + 0.5 - hx, py = y + 0.5 - hy;
        var sd = sdRoundRect(px, py, hx, hy, r), dx = 0, dy = 0;
        if (-sd < height) {
          var t = Math.min(Math.max(1 - (-Math.min(sd, 0)) / height, 0), 1);
          var m = circleMap(t) * amount, gv = gradRoundRect(px, py, hx, hy, gr);
          dx = -m * gv[0]; dy = -m * gv[1];
        }
        var i = (y * W + x) * 4;
        d[i] = Math.round(128 + 127 * Math.max(-1, Math.min(1, dx / (scale / 2))));
        d[i + 1] = Math.round(128 + 127 * Math.max(-1, Math.min(1, dy / (scale / 2))));
        d[i + 2] = 128; d[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return { url: c.toDataURL('image/png'), scale: scale };
  };

  /* Chromium（含安卓 Chrome / Edge）才开折射；iOS 上所有浏览器都是 WebKit，
     backdrop-filter:url() 会让整块玻璃消失，必须排除。 */
  function canRefract() {
    try {
      var ua = global.navigator.userAgent || '';
      if (/iPhone|iPad|iPod|CriOS|FxiOS/.test(ua)) return false;
      if (!/Chrome\/\d+/.test(ua) || /Firefox/.test(ua)) return false;
      return !!(global.CSS && CSS.supports('backdrop-filter', 'url(#a)'));
    } catch (e) { return false; }
  }
  function settingsAllow() {
    try { var s = global.Storage && Storage.get && Storage.get().settings; if (doc.body.classList.contains('hc')) return false; return !(s && s.realRefraction === false); }
    catch (e) { return true; }
  }

  function ensureDefs() {
    var svg = doc.getElementById('lgDefs');
    if (svg) return svg;
    svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('id', 'lgDefs'); svg.setAttribute('class', 'glass-defs'); svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = '<filter id="lgDock" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">'
      + '<feImage id="lgDockMap" x="0" y="0" width="1" height="1" preserveAspectRatio="none" result="map"/>'
      + '<feDisplacementMap in="SourceGraphic" in2="map" scale="28" xChannelSelector="R" yChannelSelector="G"/></filter>';
    doc.body.appendChild(svg);
    return svg;
  }
  function setHref(el, url) { el.setAttributeNS('http://www.w3.org/1999/xlink', 'href', url); el.setAttribute('href', url); }
  function isDark() { return doc.body.classList.contains('dark'); }

  /* 第 312 次：dock 本体的「真液态玻璃」滤镜（Chromium）——
     ① 凸 squircle + Snell 位移图，边缘往里取样（bezel 18px、最大 14px）；
     ② Glass-HQ regular 磨砂：模糊 7.33 + 23px 宽模糊 lighten 混 34% + 色调曲线 + chroma 1.10（替掉第 235 次的 saturate 1.9，
        真机上那会把背后的字糊成灰黑斑块）；深色 = 21.8px darken 混 65%；
     ③ 固定光照角的边缘 rim light，高光处背景提饱和 7 倍（kube.io specular saturation）。 */
  /* 第 314 次：最大位移 14 → 20（与 iOS 着色器同值）。iOS 着色器另在外沿几 px 减轻磨砂让折弯看得清；Chromium 试过同样叠一层「外沿清晰带」
     （多一张 feImage + merge），整条 dock 滤镜每帧变重、拖累同屏其它动画（第 290 次面板回弹测试超时），所以 Chromium 只加大位移 */
  var DOCK_OPT = { bezel: 18, maxPx: 20, spec: { width: 2.4, power: 2, base: 0.2 }, white: 0.5, satA: 0.7 };
  function buildDockFilter(w, h, dark) {
    var GO = global.GlassOptics, svg = ensureDefs();
    var old = doc.getElementById('lgDock'); if (old) old.parentNode.removeChild(old);
    var f = doc.createElementNS('http://www.w3.org/2000/svg', 'filter');
    f.setAttribute('id', 'lgDock'); f.setAttribute('x', '0'); f.setAttribute('y', '0'); f.setAttribute('width', '100%'); f.setAttribute('height', '100%');
    f.setAttribute('color-interpolation-filters', 'sRGB');
    var bz = Math.min(DOCK_OPT.bezel, h / 2 - 1, w / 2 - 1);
    if (!GO) {
      var mp0 = LD.buildMap(w, h, { amount: 12, height: bz });
      if (!mp0) return null;
      f.innerHTML = '<feImage id="lgDockMap" x="0" y="0" width="' + w + '" height="' + h + '" preserveAspectRatio="none" result="map"/>'
        + '<feDisplacementMap in="SourceGraphic" in2="map" scale="' + mp0.scale + '" xChannelSelector="R" yChannelSelector="G"/>';
      setHref(f.firstChild, mp0.url); svg.appendChild(f);
      return mp0;
    }
    var mp = GO.dispMap(w, h, { bezel: bz, maxPx: DOCK_OPT.maxPx, dir: 1 });
    var sp = GO.specMap(w, h, DOCK_OPT.spec);
    if (!mp || !sp) return null;
    f.innerHTML = '<feImage id="lgDockMap" x="0" y="0" width="' + w + '" height="' + h + '" preserveAspectRatio="none" result="map"/>'
      + '<feImage id="lgDockSpec" x="0" y="0" width="' + w + '" height="' + h + '" preserveAspectRatio="none" result="spec"/>'
      + '<feDisplacementMap in="SourceGraphic" in2="map" scale="' + mp.scale + '" xChannelSelector="R" yChannelSelector="G" result="ref"/>'
      + GO.frostSVG('d', 'ref', dark)
      + GO.specSVG('s', 'dcol', 'spec', { white: dark ? 0.32 : DOCK_OPT.white, satA: DOCK_OPT.satA });
    var ims = f.getElementsByTagName('feImage');
    setHref(ims[0], mp.url); setHref(ims[1], sp.url);
    svg.appendChild(f);
    return mp;
  }

  function updateRefraction() {
    if (!bar) return;
    /* 第 275 次：iOS / WebKit 走 dock-refract.js（快照 + WebGL 边缘折射）；Chromium 仍走下面的 SVG 位移贴图 */
    var gl = global.DockRefract ? global.DockRefract.sync(bar) : false;
    var on = !gl && canRefract() && settingsAllow();
    if (!on) { doc.documentElement.classList.remove('lg-refract'); refractOn = false; return; }
    var w = Math.round(bar.offsetWidth), h = Math.round(bar.offsetHeight);
    if (w < 20 || h < 20) return;
    /* 位移图 / 高光图只在尺寸（或深浅色）变化时重建 */
    var key = w + 'x' + h + (isDark() ? 'd' : 'l');
    if (key !== mapKey || !doc.getElementById('lgDock')) {
      if (!buildDockFilter(w, h, isDark())) return;
      mapKey = key;
    }
    doc.documentElement.classList.add('lg-refract'); refractOn = true;
  }


  /* ---------- 第 309 次：拖动透镜；第 314 次：液态透镜（弹簧物理 + 形变 + 清透放大 + 宽折射带 + 动态高光） ---------- */
  /* 第 314 次参数来自支付宝原生录屏（16:57，1180×330@60fps，3 倍屏）逐帧量化：
     · 静止 / 慢拖：透镜约 105pt 宽、74~84pt 高（dock 64pt），上下各冒出 5~7pt；中心对背景放大约 1.2×；
     · 快拖（≳570pt/s）：高度塌到约 dock 高（−11~−20%），宽 +5~8%；内容放大更强、边缘出现 10~13pt 宽的拉丝折射带；
     · 按下 → 透镜出现 ≤50ms、冒出 ~70ms；减速后 250~300ms 鼓回最高并轻微回落；松手 120~130ms 收回胶囊。
     这里：透镜宽 136（第 313 次用户认可的宽扁），静止比栏高 10（上下各 5），快拖时宽 +12%、高 −11%；中心放大 1.15（≈ 第 311 次认可的图标 1.15），
     外沿 bezel 14px、往里取样最多 18px（左右）/ 11px（上下，再大会把页签文字翻折到透镜下沿成碎块）——凸透镜的边：靠边的内容被拉长、翻折成拉丝带，而不是 313 那样往外压成一条细线。 */
  var LENS_RIM = { rb: 14, re: 18, rev: 11 };  /* bezel / 左右 / 上下最大往里位移（CSS px，静止；快拖 ×(1+0.35·m)） */
  var LENS_MAG = -0.03;                        /* 第 317 次：+0.15 放大 → −0.03 缩小（显示 0.97×，与 iOS 着色器 LENS_MAG_I 同值；对照支付宝 / App Store 透镜里背景约 0.98×、边带压缩） */
  var LENS_MX = 44;                            /* 贴图里 ±127 对应的最大偏移（CSS px）：rim 18 + 放大 68·0.15/1.15 ≈ 27，再加色散 / 速度余量 */
  var LENS_PAD = 60;                           /* 透镜元素四周留白（贴图同尺寸；clip-path 只留透镜本身） */
  var LENS_K = 2;                              /* 贴图分辨率：每 CSS px 2 像素 */
  var LENS_W = 110, LENS_DH = 12, LENS_ZOOM = .15;   /* 第 313 次：136 × 栏高+6；第 314 次：静止栏高 + 10（上下各冒出 5，对照支付宝 5~7pt），快拖时由形变压回约栏高 */
  /* 第 313 次：iOS 透镜外沿不画「dock 线条图标纹理」（和 DOM 图标对不齐 → 碎块 / 双字）。保持关闭。
     第 314 次：换成「透镜图标层」——透镜里的彩色图标 + 选中色文字整块由 GL 从一张纹理画（中心放大、边上一起被折弯），
     DOM 图标只在透镜外（每个页签 clip-path 挖掉透镜形状），两份内容不再在同一处叠着，透镜边就是唯一的分界 */
  var LENS_ICON_TEX = false;
  var LENS_TEX = true;
  var IOR_D = [-0.03, 0, 0.035];               /* n − 1.5，n = [1.47, 1.5, 1.535]；第 314 次只乘很小的 chx（1.2 → 3.6），色散只在边上、随速度增强、保持淡 */
  var lens = null, lensEl = null, lensKey = '', lensRaf = 0;

  /* 第 314 次：弹簧（质量-弹簧-阻尼，单位质量；k = 刚度 /s²，z = 阻尼比）。全部参数集中在这里，测试 / 截图读同一份 */
  /* 第 328 次：弹簧参数 PHYS、springStep、deformTarget、lensStep 的物理、pace、lensApply 的几何搬到 js/lens-phys.js（Worker 共用同一份），这里只取别名，数值一个没动 */
  var LP = global.LensPhys;
  var PHYS = LP.PHYS, springStep = LP.springStep, deformTarget = LP.deformTarget;
  /* 离线模拟（测试 / 调参用）：返回按 dt 采样的状态序列 */
  LD._simulate = function (o) {
    o = o || {}; var dt = o.dt || 16, out = [], red = !!o.reduced;
    if (o.kind === 'grow') { var s = 0, vs = 0; for (var t = 0; t <= (o.ms || 500); t += dt) { out.push(s); var q = springStep(s, vs, 1, PHYS.grow, dt, red); s = q[0]; vs = q[1]; } return out; }
    if (o.kind === 'deform') { var tg = deformTarget(o.vx || 0, o.rb || 0, red, !!o.tap, !!o.big); return { sx: tg[0], sy: tg[1], a: tg[2] }; }
    /* 第 319 次：拖动跟手滞后——手指匀速 v（pt/s）走 ms 毫秒，返回稳态落后的距离（pt）与时间（ms） */
    if (o.kind === 'follow') {
      var v0 = o.v || 357, x = 0, vx = 0, tgt = 0, T = o.ms || 600;
      for (var tt = 0; tt < T; tt += dt) { tgt = v0 * tt / 1000; var f = springStep(x, vx, tgt, PHYS.drag, dt, true); x = f[0]; vx = f[1]; }
      tgt = v0 * T / 1000;
      return { lagPx: Math.round((tgt - x) * 100) / 100, lagMs: Math.round((tgt - x) / v0 * 100000) / 100, k: PHYS.drag.k };
    }
    /* 第 319 次：按下放大曲线——按住 up 毫秒后松手，返回 [t, scale] 序列 */
    if (o.kind === 'press') {
      var sc = 1, vs2 = 0, up = o.up == null ? 83 : o.up;
      for (var t2 = 0; t2 <= (o.ms || 700); t2 += dt) { out.push([t2, Math.round(sc * 100000) / 100000]); var dn = t2 < up; var g = springStep(sc, vs2, dn ? 1 + PHYS.press.amp : 1, dn ? PHYS.press : PHYS.release, dt); sc = g[0]; vs2 = g[1]; }
      return out;
    }
    if (o.kind === 'release') {   /* 以速度 vx 甩动中松手：形变从对应目标回到 1 的果冻曲线 */
      var t0 = deformTarget(o.vx || 1200, 0, red), sx = t0[0], vsx = 0;
      for (var u = 0; u <= (o.ms || 700); u += dt) { out.push(sx); var r2 = springStep(sx, vsx, 1, PHYS.shape, dt, red); sx = r2[0]; vsx = r2[1]; }
      return out;
    }
    return null;
  };

  /* 位移贴图（Chromium #lgLens）：第 314 次改成凸透镜——外沿 bezel 内沿内法线「往里」取样（Snell 表），中心再叠一张放大 LENS_MAG 的位移；
     R/G = 绿通道（n=1.5）的偏移，B = 透镜形状遮罩。和 iOS 着色器同一张表、同一组参数。 */
  LD.buildLensMap = function (w, h, pad, K, maxDown) {
    pad = pad == null ? LENS_PAD : pad; K = K || LENS_K;
    var P = LENS_RIM, GO = global.GlassOptics;
    if (GO) {
      var mp = GO.dispMap(w, h, { pad: pad, K: K, dir: 1, bezel: Math.min(P.rb, h / 2 - 1), maxPx: P.re, maxPxV: P.rev, mx: LENS_MX, mask: true, zoom: LENS_MAG, rows: true });
      return mp ? { url: mp.url, mx: LENS_MX, W: mp.W, H: mp.H } : null;
    }
    /* 没有光学模块：退回只有中心放大的贴图 */
    var CW = Math.round((w + 2 * pad) * K), CH = Math.round((h + 2 * pad) * K);
    var c = doc.createElement('canvas'); c.width = CW; c.height = CH;
    var g = c.getContext('2d'); if (!g) return null;
    var img = g.createImageData(CW, CH), dd = img.data, hx = w / 2, hy = h / 2, r = Math.min(hx, hy);
    for (var j = 0; j < CH; j++) for (var i = 0; i < CW; i++) {
      var x = (i + 0.5) / K - pad - hx, y = (j + 0.5) / K - pad - hy, sd = sdRoundRect(x, y, hx, hy, r), ox = 0, oy = 0;
      if (sd < 0) { ox = -x * LENS_MAG / (1 + LENS_MAG); oy = -y * LENS_MAG / (1 + LENS_MAG); }
      var k = (j * CW + i) * 4;
      dd[k] = Math.round(128 + 127 * Math.max(-1, Math.min(1, ox / LENS_MX)));
      dd[k + 1] = Math.round(128 + 127 * Math.max(-1, Math.min(1, oy / LENS_MX)));
      dd[k + 2] = Math.round(255 * Math.max(0, Math.min(1, 0.5 - sd))); dd[k + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return { url: c.toDataURL('image/png'), mx: LENS_MX, W: w + 2 * pad, H: h + 2 * pad };
  };
  function reducedTransparencyNow() {
    try { return !!(global.matchMedia && global.matchMedia('(prefers-reduced-transparency: reduce)').matches); } catch (e) { return false; }
  }
  /* 透镜走哪条路：gl（iOS WebGL）/ svg（Chromium 位移贴图）/ plain（不支持折射：只有透镜外形）/ ''（高对比、减少透明度：不出透镜，保留旧的灰胶囊按下放大） */
  function lensMode() {
    if (!bar || doc.body.classList.contains('hc') || reducedTransparencyNow()) return '';
    if (global.DockRefract && DockRefract.isOn && DockRefract.isOn()) return 'gl';
    if (canRefract() && settingsAllow()) return 'svg';
    return 'plain';
  }
  function ensureLensFilter(W, H) {
    var key = W + 'x' + H + (isDark() ? 'd' : 'l');
    if (key === lensKey && doc.getElementById('lgLens')) return true;
    var mp = LD.buildLensMap(W, H, LENS_PAD, LENS_K);
    if (!mp) return false;
    var GO = global.GlassOptics;
    var sp = GO ? GO.specMap(W, H, { pad: LENS_PAD, K: LENS_K, width: 2.6, power: 2, base: 0.22 }) : null;
    var svg = ensureDefs(), old = doc.getElementById('lgLens');
    if (old) old.parentNode.removeChild(old);
    var ch = ['R', 'G', 'B'], m = '';
    var row = function (c) { return [c === 'R' ? '1 0 0 0 0' : '0 0 0 0 0', c === 'G' ? '0 1 0 0 0' : '0 0 0 0 0', c === 'B' ? '0 0 1 0 0' : '0 0 0 0 0', '0 0 0 1 0'].join(' '); };
    ch.forEach(function (c) {
      m += '<feDisplacementMap in="SourceGraphic" in2="m" scale="' + (2 * mp.mx) + '" xChannelSelector="R" yChannelSelector="G" result="d' + c + '"/>'
        + '<feColorMatrix in="d' + c + '" type="matrix" values="' + row(c) + '" result="c' + c + '"/>';
    });
    var f = doc.createElementNS('http://www.w3.org/2000/svg', 'filter');
    f.setAttribute('id', 'lgLens'); f.setAttribute('x', '0'); f.setAttribute('y', '0'); f.setAttribute('width', '100%'); f.setAttribute('height', '100%');
    f.setAttribute('color-interpolation-filters', 'sRGB');
    f.innerHTML = '<feImage x="0" y="0" width="' + mp.W + '" height="' + mp.H + '" preserveAspectRatio="none" href="' + mp.url + '" result="m"/>' + m
      + '<feComposite in="cR" in2="cG" operator="arithmetic" k2="1" k3="1" result="rg"/>'
      + '<feComposite in="rg" in2="cB" operator="arithmetic" k2="1" k3="1" result="rgb"/>'
      /* 第 314 次：清透——提饱和 1.3 → 1.12，亮度保持 1.03（透镜本身几乎不加料，中心就是被放大的 dock / 背景） */
      + '<feColorMatrix in="rgb" type="saturate" values="1.12" result="sat"/>'
      + '<feComponentTransfer in="sat" result="lit"><feFuncR type="linear" slope="1.03"/><feFuncG type="linear" slope="1.03"/><feFuncB type="linear" slope="1.03"/></feComponentTransfer>'
      + (sp ? '<feImage x="0" y="0" width="' + mp.W + '" height="' + mp.H + '" preserveAspectRatio="none" href="' + sp.url + '" result="sp"/>'
        + GO.specSVG('h', 'lit', 'sp', { white: isDark() ? 0.35 : 0.6, satA: 0.8 }) : '')
      + '<feColorMatrix in="m" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 1 0 0" result="mk"/>'
      + '<feComposite in="' + (sp ? 'hout' : 'lit') + '" in2="mk" operator="in" result="ln"/>'
      + '<feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="ln"/></feMerge>';
    var ims = f.getElementsByTagName('feImage');
    setHref(ims[0], mp.url); if (sp && ims[1]) setHref(ims[1], sp.url);
    svg.appendChild(f);
    lensKey = key;
    return true;
  }
  function ensureLensEl() {
    if (lensEl && lensEl.isConnected) return lensEl;
    lensEl = doc.getElementById('lgLensEl');
    if (!lensEl) {
      lensEl = doc.createElement('div');
      lensEl.id = 'lgLensEl'; lensEl.className = 'lg-lens-el'; lensEl.setAttribute('aria-hidden', 'true');
      lensEl.innerHTML = '<i class="lgl-body"><i class="lgl-line lgl-t"></i><i class="lgl-line lgl-b"></i></i>';
    }
    if (bar && bar.parentNode && lensEl.parentNode !== bar.parentNode) bar.parentNode.insertBefore(lensEl, bar.nextSibling);
    return lensEl;
  }
  function nowMs() { return LD._now ? LD._now() : (global.performance ? performance.now() : Date.now()); }
  /* 第 319 次：整条 dock 按下时有 scale（以栏中心为原点）。透镜 / GL 一律用「未缩放」的栏坐标：读到的视口坐标按当前 scale 换回去 */
  function unscaleX(x) { var g = barGeo(); return g.cx + (x - g.cx) / (DS.s || 1); }
  function tabCenter(t) { var r = t.getBoundingClientRect(); return unscaleX(r.left + r.width / 2); }
  /* 栏的未缩放矩形（视口坐标）。动画（透镜在场 / dock 缩放中）期间不读布局，用按下那一刻量好的缓存 */
  var geo = null;
  /* 第 327 次：GL 模式下一级栏的透明边框 1 → 2px（styles.css 第 327 次段，GL 轮廓 = 边框盒、外观尺寸不变）——透镜高、点击胶囊高、水滴高、栏内壁 / 果冻这些
     「按栏高 / 栏端算」的量扣掉多出来的这 1px（ex），和原来逐像素相同 */
  function bEx() { return bar ? Math.max(0, (bar.clientTop || 1) - 1) : 0; }
  function barGeo(fresh) {
    if (geo && !fresh && (lens || DS.on)) return geo;
    var r = bar.getBoundingClientRect(), k = DS.s || 1, cx = r.left + r.width / 2, cy = r.top + r.height / 2, w = r.width / k, h = r.height / k;
    geo = { left: cx - w / 2, top: cy - h / 2, width: w, height: h, right: cx + w / 2, bottom: cy + h / 2, cx: cx, cy: cy };
    return geo;
  }
  /* 第 314 次：每个页签的线条图标 / 文字在栏内（未缩放）坐标里的左上角——按下时量一次，拖动时不再逐帧 getBoundingClientRect */
  function iconBoxes() {
    var br = bar.getBoundingClientRect(), k = bar.offsetWidth ? br.width / bar.offsetWidth : 1, out = [];   /* 局部坐标：缩放已除掉 */
    tabsOf().forEach(function (t) {
      var els = t.querySelectorAll('.dk-l, .dk-t');
      for (var i = 0; i < els.length; i++) { var r = els[i].getBoundingClientRect(); out.push({ el: els[i], x: (r.left - br.left) / k, y: (r.top - br.top) / k, w: r.width / k, h: r.height / k }); }
    });
    return out;
  }
  /* 第 322 次：t 是两端页签吗（−1 左端 / 1 右端 / 0 中间） */
  function endSideOf(t) {
    var ts = tabsOf();
    if (ts.length < 2) return 0;
    return t === ts[0] ? -1 : t === ts[ts.length - 1] ? 1 : 0;
  }
  function endCenters() { var ts = tabsOf(); return ts.length ? [tabCenter(ts[0]), tabCenter(ts[ts.length - 1])] : null; }
  function lensStart(t) {
    if (lens || !bar || !t || !t.classList.contains('dk-tab') || bar.classList.contains('is-sub')) return false;
    var mode = lensMode();
    if (!mode) return false;
    var W = LENS_W, H = Math.round(bar.offsetHeight - 2 * bEx() + LENS_DH);
    if (mode === 'svg' && !ensureLensFilter(W, H)) mode = 'plain';
    var el = ensureLensEl();
    var body = el.firstChild;
    el.style.width = (W + 2 * LENS_PAD) + 'px'; el.style.height = (H + 2 * LENS_PAD) + 'px';
    body.style.left = body.style.top = LENS_PAD + 'px'; body.style.width = W + 'px'; body.style.height = H + 'px';
    el.style.clipPath = 'inset(' + (LENS_PAD - 1) + 'px round ' + (H / 2 + 1) + 'px)';
    el.classList.remove('svg', 'gl', 'plain'); el.classList.add(mode);
    /* 第 315 次：点哪个页签，透镜都从「当前选中的胶囊」那里鼓起、用拖动弹簧（临界阻尼）滑到手指下的页签——
       对照支付宝 22:03 深色录屏逐帧：点下第 1 帧胶囊就开始往目标走，约 8 帧（≈130ms）到位，途中鼓成透镜（比栏高）、到位后 ~120ms 收回胶囊。
       原来透镜直接在目标处冒出、旧胶囊当场消失 = 「生硬切换 + 闪」。 */
    var G = barGeo(true);
    var a0 = activeTab(), x0 = a0 && a0 !== t && a0.classList.contains('dk-tab') ? tabCenter(a0) : tabCenter(t), x = tabCenter(t), n = nowMs();
    var pw0 = t.offsetWidth + THUMB_PX;
    lens = { mode: mode, W: W, H: H, x: x0, vx: 0, tx: x, s: 0, vs: 0, sx: 1, vsx: 0, sy: 1, vsy: 0, rb: 0, m: 0, a: 0, hl: 0, flash: 1,
      phase: 'grow', tap: true, t0: n, last: n, pw: pw0, ph: Math.max(t.offsetHeight, bar.offsetHeight - 2 * bEx() - 2 * THUMB_INSET), tab: t, ex: bEx(), boxes: mode === 'gl' ? iconBoxes() : [],
      /* 第 319 次：点击的两条边（未缩放视口 x）、长按 / 拖动的「大透镜」比例 bf（0 = 点击：栏内 56 高、宽 ≤104；1 = 第十四版：栏高 + 12、宽 110） */
      eL: x0 - pw0 / 2, eR: x0 + pw0 / 2, veL: 0, veR: 0, bf: 0, down: true, br: G, Ht: Math.round(bar.offsetHeight - 2 * bEx() + PHYS.tapDH), debt: 0, tp: n, retargets: 0,
      endSide: endSideOf(t), jc: 0, vjc: 0, jcMax: 0, endC: endCenters(), pull: 0, pullMax: 0 };
    jellyLast = null;
    bar.classList.remove('lg-lensend', 'lg-shrink'); bar.classList.add('lg-lensing');
    bar.classList.toggle('lg-lens-gl', mode === 'gl');
    if (thumb) { thumb.classList.add('lg-lhide'); thumb.classList.remove('lg-grow'); }
    lensApply();
    el.classList.add('on');
    if (!lensRaf && !LD._manual) lensRaf = global.requestAnimationFrame(lensFrame);
    return true;
  }
  /* 第 321 次（Telegram 参考 A1）：透镜还在（鼓起 / 滑行 / 吸附 / 收回任一阶段）时再次按下别的（或同一个）页签——
     不重启：位置 x、速度 vx、左右两条边 eL / eR 和各自速度、鼓起 s 都保留，只改目标 tx；正在收回就回到滑行（s 从当前值接着鼓）；
     整条 dock 按下放大从当前缩放接着按（DS.s 不归 1）。原来 lensStart 见到 lens 在场直接返回 false，透镜照旧滑回第一次点的页签、页面却切到第二个 → 落定时胶囊一跳 */
  function lensRetarget(t) {
    var L = lens;
    if (!L || !bar || !t || !t.classList.contains('dk-tab') || bar.classList.contains('is-sub')) return false;
    var n = nowMs();
    /* 第 321 次收尾：tp 记在透镜自己的时间轴上（手动时钟下 nowMs 是墙钟，会比 L.last 超前）；
       目标平滑：gx 从透镜当前位置出发，逐帧低通滑向新页签（lensStep 里），两条边追 gx 而不是一步跳到 tx；
       鼓起速度 vs 清零——收回中的 vs 很负，不清零回到滑行后 s 还会先掉到 0.68 再鼓 */
    L.tab = t; L.tx = tabCenter(t); L.down = true; L.tap = true; L.tp = L.last || n; L.rb = 0;
    L.gx = L.x; L.gsm = true; L.vs = 0;
    L.endSide = endSideOf(t); L.hit = false;   /* 第 322 次：连点改到端点页签同样撞端；改离端点时 jc 自己弹回 */
    L.pw = t.offsetWidth + THUMB_PX;
    if (L.phase === 'shrink' || L.phase === 'settle') {
      L.phase = 'hold';
      if (bar.classList.contains('lg-shrink')) bar.classList.remove('lg-shrink');
      if (thumb) { thumb.style.removeProperty('opacity'); thumb.style.removeProperty('transition'); thumb.classList.add('lg-lhide'); }
    }
    L.retargets = (L.retargets || 0) + 1;
    if (!lensRaf && !LD._manual) lensRaf = global.requestAnimationFrame(lensFrame);
    return true;
  }
  function lensRelease(x) {
    if (lens) lens.down = false;
    if (!lens || lens.phase === 'settle' || lens.phase === 'shrink') return;
    if (x != null) lens.tx = x;
    lens.rb = 0; lens.vx = Math.max(-700, Math.min(700, lens.vx));
    lens.phase = 'settle'; lens.ts = lens.last;   /* 透镜自己的时间轴（手动时钟下与墙钟不同） */
    if (!lensRaf && !LD._manual) lensRaf = global.requestAnimationFrame(lensFrame);
  }
  function lensEnd() {
    if (lensRaf) { global.cancelAnimationFrame(lensRaf); lensRaf = 0; }
    var L = lens;
    lens = null;
    if (lensEl) { lensEl.classList.remove('on', 'fast'); lensEl.style.opacity = ''; }
    if (L && L.boxes) L.boxes.forEach(function (b) { ['--hx', '--hy', '--hw', '--hh'].forEach(function (k) { b.el.style.removeProperty(k); }); if (b.el.classList.contains('lg-hole')) b.el.classList.remove('lg-hole'); });
    if (L && L.boxesC) L.boxesC.forEach(function (b) { b.el.style.removeProperty('--la'); b.el.style.removeProperty('--lb'); });
    if (bar) {
      /* 第 313 次：收起那一刻关掉图标过渡两帧，没选中的页签不闪彩色图标 */
      var b0 = bar;
      b0.classList.add('lg-lensend');
      b0.classList.remove('lg-lensing', 'lg-lens-gl', 'lg-shrink'); b0.style.removeProperty('--lz');
      var rq = global.requestAnimationFrame || function (f) { return setTimeout(f, 16); };
      rq(function () { rq(function () { if (!lens) b0.classList.remove('lg-lensend'); }); });
    }
    if (thumb) { thumb.classList.remove('lg-lhide'); thumb.style.removeProperty('opacity'); thumb.style.removeProperty('transition'); }
    if (L && L.endSide && Math.abs(L.jc || 0) > 0.004) thumbJelly(L.jc, L.vjc || 0, L.endSide);
    popNow();
    if (global.DockRefract && DockRefract.lens) DockRefract.lens(null);
    if (DS.on && !DS.raf && !LD._manual) { DS.last = nowMs(); DS.raf = global.requestAnimationFrame(dsFrame); }
    settledCheck();
  }
  /* 第 322 次：撞端果冻的后半段——透镜收回时还没弹完的压缩（jc、速度 vjc）交给静止胶囊，同一个弹簧（k 250 ζ 0.7）离线算成关键帧：
     宽 1 − jc、高 1 + 0.8·jc，以靠栏端那一侧为原点（外沿贴着栏端不动） */
  var jellyLast = null;
  function thumbJelly(j, vj, side) {
    if (!thumb || !thumb.animate || reduced || !lastRect) return;
    var w = parseFloat(thumb.style.width) || 0, h = parseFloat(thumb.style.height) || 0, r = lastRect;
    var ox = side > 0 ? w : 0, oy = h / 2, fr = [], t = 0, x = j, v = vj, dt = 1000 / 60;
    var tf = function (q) {
      return 'translate(' + r.x + 'px,' + r.y + 'px) translate(' + ox + 'px,' + oy + 'px) scale(' + (1 - q).toFixed(4) + ',' + (1 + PHYS.jellySy * q).toFixed(4) + ') translate(' + (-ox) + 'px,' + (-oy) + 'px)';
    };
    while (t < 900) {
      fr.push(x);
      var q = springStep(x, v, 0, PHYS.jelly, dt); x = q[0]; v = q[1]; t += dt;
      if (Math.abs(x) < 0.0008 && Math.abs(v) < 0.02) break;
    }
    fr.push(0);
    jellyLast = { j0: j, frames: fr.length, peak: Math.max.apply(null, fr.map(Math.abs)), min: Math.min.apply(null, fr), side: side };
    try {
      thumb.animate(fr.map(function (q) { return { transform: tf(q) }; }), { duration: Math.round((fr.length - 1) * dt), easing: 'linear' });
      if (global.DockRefract && DockRefract.kick) DockRefract.kick(Math.round(fr.length * dt) + 40);
    } catch (e) { /* 老内核：不弹 */ }
  }
  LD._jelly = function () { return jellyLast; };
  /* 第 319 次：选中图标的小动作（dk-pop）在透镜开始收回时才播（原来 pointerup 就播、被透镜遮着，露出来只剩后 2/3 = 落定后又「抽」一下） */
  function popNow() {
    if (!bar) return;
    var t = bar.querySelector('.tab.dk-tab.active[data-pop-pending]');
    if (!t) return;
    t.removeAttribute('data-pop-pending');
    t.classList.add('dk-pop');
    setTimeout(function () { t.classList.remove('dk-pop'); }, 320);
  }
  /* 第 314 次：一帧物理（dt ms）。拖动 = 临界阻尼跟手；松手 = 欠阻尼吸附；鼓起 / 形变 = 欠阻尼弹簧；收回 = 临界阻尼。
     第 328 次：物理本身在 LensPhys.step（与 Worker 同一份），这里只做收回那一刻的 DOM 副作用 */
  function lensStep(dt) {
    var L = lens, ok = LP.step(L, dt, reduced, null);
    if (L.ev === 'shrink') shrinkDom();
    return ok;
  }
  /* 第 315 次：开始收回时 DOM 先换成最终样子（选中页签的填色图标 + 选中色文字原位露出），GL 透镜在它上面缩小、放大回到 1:1 再淡出——
     原来收回期间透镜里的图标跟着透镜一起淡出、DOM 那份还被遮着，松手后图标先变淡再「啪」地出现 */
  function shrinkDom() {
    if (bar) bar.classList.add('lg-shrink');
    popNow();
    if (thumb) {
      try { thumb.getAnimations().forEach(function (a) { a.finish(); }); } catch (e) { /* 老内核 */ }
      thumb.style.transition = 'none'; thumb.style.opacity = '0';
      thumb.classList.remove('lg-lhide');
    }
  }
  /* 第 319 次：帧间隔超过 1.5 帧（主线程被占住后的那一帧）时，这次只推进「1 帧 + 欠账的一半」，剩下的一半记到下一帧——
     原来一帧补完（真机第 46 帧从 64% 跳到 93%）；4ms 子步积分本身稳定，这里只管「看起来不跳」 */
  var FRAME = LP.FRAME, pace = LP.pace;   /* 第 328 次：搬到 lens-phys.js */
  /* 第 319 次：每帧耗时记录（Performance API）——rAF 间隔、这一帧物理 + 写样式 + GL 画的耗时、追赶量；长任务另由 PerformanceObserver 记 */
  var perf = { on: true, frames: [], long: [] };
  function perfPush(rec) { if (!perf.on) return; perf.frames.push(rec); if (perf.frames.length > 240) perf.frames.shift(); }
  try {
    if (global.PerformanceObserver && PerformanceObserver.supportedEntryTypes && PerformanceObserver.supportedEntryTypes.indexOf('longtask') >= 0) {
      new PerformanceObserver(function (l) { l.getEntries().forEach(function (e) { perf.long.push({ t: Math.round(e.startTime), ms: Math.round(e.duration) }); if (perf.long.length > 60) perf.long.shift(); }); }).observe({ entryTypes: ['longtask'] });
    }
  } catch (ePO) { /* 不支持就只记帧 */ }
  function lensFrame(ts) {
    lensRaf = 0;
    if (!lens) return;
    if (!bar || !bar.isConnected) { lensEnd(); return; }
    var t0 = global.performance ? performance.now() : Date.now();
    var n = nowMs(), raw = Math.min(100, Math.max(1, n - lens.last)); lens.last = n;   /* 4ms 子步积分，长帧也稳定；上限 100ms 只防后台切回 */
    var dt = pace(lens, raw);
    var ok = lensStep(dt);
    if (DS.on) dsStep(dt);
    if (!ok) { lensEnd(); perfPush({ t: Math.round(t0), raw: Math.round(raw * 10) / 10, dt: Math.round(dt * 10) / 10, work: Math.round(((global.performance ? performance.now() : Date.now()) - t0) * 100) / 100, k: 'end' }); return; }
    lensApply();
    perfPush({ t: Math.round(t0), raw: Math.round(raw * 10) / 10, dt: Math.round(dt * 10) / 10, work: Math.round(((global.performance ? performance.now() : Date.now()) - t0) * 100) / 100, k: lens ? lens.phase : '' });
    if (!LD._manual) lensRaf = global.requestAnimationFrame(lensFrame);
  }
  /* ---------- 第 319 次：按下整条 dock 放大（整块合成层 scale，GL 画布作为子节点跟着缩放，不重新取样） ---------- */
  var DS = { s: 1, v: 0, down: false, on: false, raf: 0, last: 0, debt: 0 };
  function dsPress(down) {
    if (reduced || !bar) return;
    DS.down = !!down;
    if (!DS.on) { DS.on = true; DS.last = nowMs(); DS.debt = 0; bar.style.transition = 'box-shadow .3s'; }
    if (!DS.raf && !lensRaf && !LD._manual) DS.raf = global.requestAnimationFrame(dsFrame);
  }
  function dsStep(dt) {
    var p = DS.down ? PHYS.press : PHYS.release, tg = DS.down ? 1 + PHYS.press.amp : 1;
    var q = springStep(DS.s, DS.v, tg, p, dt); DS.s = q[0]; DS.v = q[1];
    if (!DS.down && Math.abs(DS.s - 1) < 0.0004 && Math.abs(DS.v) < 0.01) {
      DS.s = 1; DS.v = 0; DS.on = false;
      if (bar) { bar.style.removeProperty('scale'); bar.style.removeProperty('transition'); }
      settledCheck();
      return false;
    }
    if (bar) bar.style.scale = DS.s.toFixed(5);
    return true;
  }
  function dsFrame() {
    DS.raf = 0;
    if (!DS.on) return;
    if (lens && lensRaf) return;   /* 透镜在场时由 lensFrame 一起推进（同一帧、同一个 dt） */
    var n = nowMs(), raw = Math.min(100, Math.max(1, n - DS.last)); DS.last = n;
    if (dsStep(pace(DS, raw)) && !LD._manual) DS.raf = global.requestAnimationFrame(dsFrame);
  }
  /* 透镜收起、dock 缩放也停稳 → 通知折射层：推迟的整页快照现在可以拍了 */
  function settledCheck() {
    if (lens || DS.on) return;
    geo = null;
    if (global.DockRefract && DockRefract.settled) DockRefract.settled();
  }
  /* 测试 / 截图：手动时钟（不跑 rAF，按 ms 推进物理并当场画一帧） */
  LD._manualMode = function (on) {
    LD._manual = !!on;
    if (on && lensRaf) { global.cancelAnimationFrame(lensRaf); lensRaf = 0; }
    if (on && DS.raf) { global.cancelAnimationFrame(DS.raf); DS.raf = 0; }
    if (!on && lens && !lensRaf) { lens.last = nowMs(); lensRaf = global.requestAnimationFrame(lensFrame); }
    if (!on && DS.on && !DS.raf && !lens) { DS.last = nowMs(); DS.raf = global.requestAnimationFrame(dsFrame); }
  };
  LD._step = function (ms) {
    if (!lens) { if (DS.on) { var l0 = ms; while (l0 > 0 && DS.on) { var d0 = Math.min(16.67, l0); l0 -= d0; dsStep(d0); } } return null; }
    var left = ms;
    while (left > 0 && lens) {
      var d = Math.min(16.67, left); left -= d; lens.last += d;
      if (DS.on) dsStep(d);
      if (!lensStep(d)) { lensEnd(); return null; }
    }
    if (lens) lensApply();
    return LD._state().lens;
  };
  var lensPin = null;   /* 测试 / 截图用：钉住 s（鼓起）/ m（速度 0..1）/ vx（px/s，形变直接取目标）/ hl / flash */
  function lensApply() {
    if (!lens || !lensEl) return;
    var L = lens;
    if (lensPin) {
      if (lensPin.s != null) { L.s = lensPin.s; L.vs = 0; }
      if (lensPin.m != null) L.m = lensPin.m;
      if (lensPin.vx != null) { var tg = deformTarget(lensPin.vx, 0, reduced); L.vx = lensPin.vx; L.sx = tg[0]; L.sy = tg[1]; L.a = tg[2]; L.vsx = L.vsy = 0; }
      if (lensPin.hl != null) L.hl = lensPin.hl;
      if (lensPin.flash != null) L.flash = lensPin.flash;
    }
    /* 第 319 次：不再逐帧 getBoundingClientRect（按下那一刻量好的未缩放栏矩形）；整条 dock 的 scale 只在最后给 CSS 透镜元素合成一次。
       第 328 次：几何（宽高 / 中心 / 果冻 / 栏端外凸）在 LensPhys.geom，与 Worker 同一份 */
    lensDom(LP.geom(L, DS.s || 1, reduced), true);
  }
  /* 第 328 次：透镜的 DOM 一半（CSS 透镜元素、胶囊透明度、栏上下细边、挖洞遮罩）。gl = true 时同步调 DR.lens 当场画；Worker 路径（gl = false）由 Worker 自己画 */
  function lensDom(G, gl) {
    var L = lens;
    var br = G.br, cy = G.cy, s = G.s, w = G.w, h = G.h, sx = G.sx, sy = G.sy, ex = G.ex, ey = G.ey, ds = G.fx.ds;
    lensEl.style.transform = 'translate(' + (ex - L.W / 2 - LENS_PAD) + 'px,' + (ey - L.H / 2 - LENS_PAD) + 'px) scale(' + (sx * ds).toFixed(4) + ',' + (sy * ds).toFixed(4) + ')';
    /* 第 315 次：鼓起时一开始就不透明（透镜从胶囊同尺寸起步，原来 0.35 起淡入 = 按下第 1~3 帧选中图标半透明「闪一下」） */
    var op = G.op;
    lensEl.style.opacity = op;
    /* 第 316 次：收回时静止胶囊按透镜的鼓起比例逐帧显出（1 − s），不再靠 CSS 0.2s 淡入——
       原来 4 帧收回里胶囊只淡到 ~1/3、透镜消失后还要再淡 0.13s；中途透镜里又能看见一圈完整的胶囊轮廓（第 16~17 帧两道轮廓）。
       支付宝 22:03 第 147→150 帧：透镜缩进去的同时胶囊出现，透镜一没胶囊就是实的 */
    if (thumb && L.phase === 'shrink') { thumb.style.transition = 'none'; thumb.style.opacity = Math.max(0, Math.min(1, 1 - s)).toFixed(3); }
    /* 色散随速度、保持淡：rim 位移 ×(1 + 0.35·m)。Chromium 的贴图里放大和 rim 在同一张图，三通道 scale 差会连中心一起色散，
       所以这里只给 chx 0.6 → 1.8（R/B 差 2%~6%）；iOS 着色器的色散只乘在 rim 带里（1.2 → 3.6） */
    var chx = 0.6 + 1.2 * L.m, gm = 1 + 0.35 * L.m;
    if ((L.m > 0.45) !== lensEl.classList.contains('fast')) lensEl.classList.toggle('fast', L.m > 0.45);
    /* 动态高光（CSS 路径）：高光朝运动方向偏移、随速度增强；按下时一道亮弧（flash） */
    lensEl.style.setProperty('--lhx', L.hl.toFixed(3));
    lensEl.style.setProperty('--lho', Math.min(1, L.m * 0.8 + L.flash).toFixed(3));
    if (L.mode === 'svg') {
      var f = doc.getElementById('lgLens');
      if (f) {
        var dms = f.getElementsByTagName('feDisplacementMap');
        for (var c = 0; c < 3 && c < dms.length; c++) dms[c].setAttribute('scale', (2 * LENS_MX * (1 + IOR_D[c] * chx) * gm).toFixed(2));
      }
    }
    var lx = G.lx;
    /* 栏的上下细边：只在 plain（没有真折射）时用两条直线示意；svg / gl 里栏边是被真折弯进来的 */
    var R = br.height / 2;
    var a0 = Math.max(14, (br.left + R - lx) / sx), b0 = Math.min(L.W - 14, (br.right - R - lx) / sx);
    var lines = lensEl.firstChild.children;
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i], yy = (i === 0 ? br.top : br.bottom) - cy;
      ln.style.top = (L.H / 2 + yy / sy) + 'px';
      ln.style.left = a0 + 'px'; ln.style.width = Math.max(0, b0 - a0) + 'px';
      ln.style.opacity = b0 - a0 > 6 ? Math.min(1, s * s) : 0;
    }
    /* 图标：
       · gl：透镜里的彩色图标 + 文字由 GL 从「透镜图标层」画（随透镜放大、在边上一起被折弯）；DOM 图标每个页签用 clip-path 挖掉透镜形状，只露在透镜外。
       · svg：DOM 彩色图标遮罩到透镜范围，透镜的 backdrop 把它们和背景一起放大 / 折弯（--lz = 1，不再二次放大）。
       · plain：没有折射，DOM 彩色图标放大 1.15（第 311 次）。 */
    var zf = L.mode === 'plain' ? 1 + LENS_ZOOM * Math.max(0, Math.min(1, s)) : 1;
    bar.style.setProperty('--lz', zf.toFixed(3));
    if (L.mode === 'gl') {
      /* 透镜（圆角胶囊）在每个元素局部坐标里的盒子 → CSS 遮罩挖洞（全图 − 矩形 ∪ 两个圆），透镜里只剩 GL 画的那份。
         不用 clip-path：WPE WebKit 里页签一带 clip-path，栏里的 WebGL 画布整块不合成（实测） */
      var kk = 1;   /* br 已是未缩放坐标 */
      var hx0 = (lx - br.left) / kk, hy0 = (cy - h / 2 - br.top) / kk, hw = (w / kk).toFixed(2) + 'px', hh = (Math.min(w, h) / kk).toFixed(2) + 'px';
      var hwn = w / kk;
      L.boxes.forEach(function (b) {
        var st = b.el.style;
        /* 第 315 次：只给透镜真正盖到的图标 / 文字开挖洞遮罩（.lg-hole）。原来一按下所有页签都套上遮罩——离透镜很远的图标 / 文字也换成遮罩合成，
           抗锯齿方式一变就是「按下时远处的图标轻微闪一下」（Chromium 逐帧帧差 0.36） */
        var hit = hx0 - 2 < b.x + (b.w || 0) && hx0 + hwn + 2 > b.x;
        if (hit !== b.el.classList.contains('lg-hole')) b.el.classList.toggle('lg-hole', hit);
        st.setProperty('--hx', (hx0 - b.x).toFixed(2) + 'px'); st.setProperty('--hy', (hy0 - b.y).toFixed(2) + 'px');
        st.setProperty('--hw', hw); st.setProperty('--hh', hh);
      });
    } else {
      /* 第 319 次：元素盒子按下时量一次（L.boxesC），之后不逐帧 getBoundingClientRect */
      if (!L.boxesC) {
        L.boxesC = [];
        var bR = bar.getBoundingClientRect(), kq = bar.offsetWidth ? bR.width / bar.offsetWidth : 1;
        tabsOf().forEach(function (t) {
          var els = t.querySelectorAll('.dk-c, .dk-l, .dk-t');
          for (var j = 0; j < els.length; j++) { var r = els[j].getBoundingClientRect(), isC = els[j].classList.contains('dk-c'); L.boxesC.push({ el: els[j], x: br.left + (r.left - bR.left) / kq, isC: isC }); }
        });
      }
      L.boxesC.forEach(function (b) {
        var k = b.isC ? zf : 1, e = b.el;
        e.style.setProperty('--la', ((lx - b.x) / k).toFixed(2) + 'px');
        e.style.setProperty('--lb', ((lx - b.x + w) / k).toFixed(2) + 'px');
        e.style.removeProperty('--lr');
      });
    }
    /* GL：形状 / 折射 / 高光 / 融合全在着色器里按 uniform 尺寸算（不生成贴图）；DR.lens 当场同步重画，GL 与 CSS 外形同一帧
       第 322 次（A3）：栏端外凸量 G.pull（LensPhys.geom 里算，带符号：右端 +、左端 −） */
    if (gl && L.mode === 'gl' && global.DockRefract && DockRefract.lens) {
      DockRefract.lens(G.rect, L.m, G.g, op, G.fx);   /* 点击透镜在栏内、不冒出：不融合、不投影（sh = bf） */
    }
  }

  /* ---------- 3. 选中水滴：跟随 + 弹簧 ---------- */
  /* 第 316 次：静止选中胶囊按原生比例——高 = 栏高 − 2×THUMB_INSET（上下各留约 4px），宽 = 页签宽 + THUMB_PX。
     对照：支付宝 22:03 深色胶囊约 83×55pt（栏 62pt，上下各约 3.5pt）、App Store 23:38 约 85pt 宽几乎贴栏高；第 315 次是页签本身 64×44（栏 60，上下各 8），
     比原生小一圈、看着「缩在里面」。透镜从这块胶囊同尺寸鼓起（lensStart 的 pw / ph）。 */
  var THUMB_INSET = 4, THUMB_PX = 12;
  function thumbBox(a) {
    var H = bar.offsetHeight - 2 * bEx(), h = Math.max(a.offsetHeight, H - 2 * THUMB_INSET), w = a.offsetWidth + THUMB_PX;
    return { x: a.offsetLeft - THUMB_PX / 2, y: (bar.clientHeight - h) / 2, w: w, h: h };
  }
  function activeTab() {
    if (!bar || bar.classList.contains('is-sub')) return null;
    var a = bar.querySelector('.tab.active:not(.tab-plus)');
    return a && a.offsetParent ? a : null;
  }
  function place(animate) {
    if (!bar) return;
    if (!thumb || thumb.parentNode !== bar) {
      thumb = doc.createElement('span');
      thumb.className = 'lg-thumb'; thumb.setAttribute('aria-hidden', 'true');
      /* 第 275 次：折射画布（canvas.lg-gl）要在水滴之前，水滴才画在它上面 */
      var glc = bar.firstChild && bar.firstChild.classList && bar.firstChild.classList.contains('lg-gl') ? bar.firstChild : null;
      bar.insertBefore(thumb, glc ? glc.nextSibling : bar.firstChild);
    }
    var a = activeTab();
    if (!a) { thumb.classList.remove('on'); return; }
    var r = thumbBox(a);
    thumb.style.width = r.w + 'px'; thumb.style.height = r.h + 'px';
    thumb.style.transform = 'translate(' + r.x + 'px,' + r.y + 'px)';
    var was = thumb.classList.contains('on');
    thumb.classList.add('on');
    if (animate && lastRect && was !== false && !reduced && thumb.animate && (lastRect.x !== r.x || lastRect.y !== r.y)) {
      var dist = Math.abs(lastRect.x - r.x) + Math.abs(lastRect.y - r.y);
      var stretch = 1 + Math.min(0.35, dist / 260);
      var horiz = Math.abs(lastRect.x - r.x) >= Math.abs(lastRect.y - r.y);
      var mid = 'translate(' + ((lastRect.x + r.x) / 2) + 'px,' + ((lastRect.y + r.y) / 2) + 'px) ' + (horiz ? 'scale(' + stretch + ',' + (2 - stretch) + ')' : 'scale(' + (2 - stretch) + ',' + stretch + ')');
      thumb.animate([
        { transform: 'translate(' + lastRect.x + 'px,' + lastRect.y + 'px)' },
        { transform: mid, offset: 0.45 },
        { transform: 'translate(' + r.x + 'px,' + r.y + 'px) scale(1.06,.94)', offset: 0.78 },
        { transform: 'translate(' + r.x + 'px,' + r.y + 'px)' }
      ], { duration: 460, easing: 'cubic-bezier(.3,.7,.3,1)' });
      /* 第 277 次：水滴是一块折射透镜，滑动拉伸期间逐帧重画（dock-refract.js 跟着 getAnimations 一直画到动画结束） */
      if (global.DockRefract && DockRefract.kick) DockRefract.kick(480);
    }
    lastRect = r;
  }

  /* 按下：整条胶囊下沉 + 水滴鼓起；松开回弹（用 scale 属性，不覆盖居中用的 transform） */
  function onDown(e) {
    if (reduced || !bar) return;
    var t = e.target && e.target.closest && e.target.closest('button');
    if (!t || !bar.contains(t)) return;
    /* 第 320 次（Telegram 参考）：二级页分裂 / 合拢途中按下——不缩放整个合成层（GL 画布是栏的子节点，整条 scale 会把黏连的颈部一起放大）、
       不出透镜；dock-fuse.js 只让被按的那颗钮放大 1.03 */
    if (global.DockFuse && DockFuse.morphing && DockFuse.morphing()) return;
    dragStart(e, t);
    /* 第 309 次：页签上按下 → 灰胶囊鼓成透镜；不出透镜时（高对比 / 减少透明度）仍是旧的放大 */
    if (lens && lensRetarget(t)) { dsPress(true); return; }   /* 第 321 次：连点不重启，只改目标 */
    if (lensStart(t)) { dsPress(true); return; }
    /* 第 315 次：出透镜时整条 dock 不再按下放大（CSS scale 1.02）、边缘折射也不加强——真机逐帧（21:56 第 186 / 188 帧）
       离透镜很远的「宝宝」一带 dock 背景、图标、外轮廓都跟着变了（帧差 7）；支付宝透镜外的 dock 纹丝不动。只有不出透镜的降级路径保留旧按压 */
    bar.classList.add('lg-press');
    if (thumb && t.classList.contains('active')) thumb.classList.add('lg-grow');
    /* 第 277 次：按下时玻璃轻微放大（CSS scale 1.02），边缘折射同步增强（dock-refract.js 逐帧缓动） */
    if (global.DockRefract && DockRefract.press) DockRefract.press('dock', true);
  }
  function onUp(e) {
    if (!bar) return;
    /* 第 309 次：松手 → 透镜吸到页签（拖过的那个；没拖就是按下的那个；取消 = 回到当前页签）再缩回灰胶囊。
       落点要在 dragEnd 之前量：拖完切页会立刻重建页签节点 */
    var lx = null;
    if (lens) {
      var tg = e && e.type === 'pointercancel' ? activeTab() : ((drag && drag.on && drag.hover) || lens.tab);
      if (tg && tg.isConnected) lx = tabCenter(tg);
    }
    dragEnd(e && e.type === 'pointercancel');
    if (lens) lensRelease(lx);
    if (DS.down) dsPress(false);
    var was = bar.classList.contains('lg-press');
    bar.classList.remove('lg-press');
    if (thumb) thumb.classList.remove('lg-grow');
    if (was && global.DockRefract && DockRefract.press) DockRefract.press('dock', false);
  }

  /* 第 304 次：按住页签左右拖，水滴跟着手指走；经过哪个页签哪个就换成彩色图标，松手切到那一页 */
  var drag = null, swallowUntil = 0;
  function tabsOf() { return bar ? Array.prototype.filter.call(bar.querySelectorAll('.tab.dk-tab'), function (t) { return t.offsetParent; }) : []; }
  function dragStart(e, t) {
    if (!t.classList.contains('dk-tab') || bar.classList.contains('is-sub')) return;
    drag = { id: e.pointerId, x0: e.clientX, on: false, hover: null };
  }
  function nearest(x) {
    var best = null, bd = 1e9;
    tabsOf().forEach(function (t) { var r = t.getBoundingClientRect(), c = r.left + r.width / 2, dd = Math.abs(c - x); if (dd < bd) { bd = dd; best = t; } });
    return best;
  }
  function onMove(e) {
    if (!drag || e.pointerId !== drag.id || !bar || !thumb) return;
    var dx = e.clientX - drag.x0;
    if (!drag.on) {
      if (Math.abs(dx) < 8) return;
      drag.on = true; bar.classList.add('lg-drag');
    }
    var tabs = tabsOf(); if (!tabs.length) return;
    var br = bar.getBoundingClientRect(), a = activeTab() || tabs[0];
    var w = a.offsetWidth, first = tabs[0], last = tabs[tabs.length - 1];
    var kx = br.width / (bar.offsetWidth || br.width);
    var x = (e.clientX - br.left) / kx - w / 2;
    /* 第 314 次：两端橡皮筋——超出首尾页签的部分按 iOS 公式 (1 − 1/(d·c/R + 1))·R 衰减（最多拉出 R = 26px），透镜同时朝那一端拉长 */
    var lo = first.offsetLeft, hi = last.offsetLeft, rb = 0;
    if (x < lo || x > hi) {
      var d = x < lo ? lo - x : x - hi, R = PHYS.rubber;
      rb = (1 - 1 / (d * PHYS.rubberC / R + 1)) * R * (x < lo ? -1 : 1);
      x = (x < lo ? lo : hi) + rb;
    }
    var tb = thumbBox(a);
    thumb.style.transform = 'translate(' + (Math.max(lo - 4, Math.min(hi + 4, x)) - THUMB_PX / 2) + 'px,' + tb.y + 'px)';
    if (lens) { lens.tx = lens.br.left + (x + w / 2); lens.rb = rb; lens.tap = false; }   /* 第 309 次：透镜跟手（第 319 次：未缩放坐标，dock 按下放大时不偏） */
    else thumb.classList.add('lg-grow');
    var h = nearest(e.clientX);
    if (h !== drag.hover) {
      if (drag.hover) drag.hover.classList.remove('lg-hover');
      if (h) h.classList.add('lg-hover');
      drag.hover = h;
    }
    if (global.DockRefract && DockRefract.kick) DockRefract.kick(120);
  }
  function dragEnd(cancel) {
    var d = drag; drag = null;
    if (!d || !d.on || !bar) return;
    bar.classList.remove('lg-drag');
    if (d.hover) d.hover.classList.remove('lg-hover');
    var t = d.hover;
    if (!cancel && t && !t.classList.contains('active')) { try { t.click(); } catch (e) {} }
    else { place(true); }
    swallowUntil = Date.now() + 450; /* 拖完松手浏览器还会补一下 click，吞掉 */
  }

  function refresh() { place(true); updateRefraction(); }

  LD.init = function () {
    bar = doc.getElementById('tabbar');
    if (!bar || bar.__lg) return;
    bar.__lg = true;
    bar.classList.add('lg');
    if (global.MutationObserver) {
      mo = new MutationObserver(function (list) {
        /* 只关心子节点增删和 class（active / is-sub）；忽略指示器自己的改动 */
        for (var i = 0; i < list.length; i++) {
          var m = list[i];
          if (m.target === thumb) continue;
          if (m.type === 'attributes' && m.target === bar && (/is-sub/.test(m.oldValue || '') === bar.classList.contains('is-sub'))) continue;
          if (m.type === 'childList' && m.addedNodes.length === 1 && m.addedNodes[0] === thumb) continue;
          if (m.type === 'childList' && m.addedNodes.length === 1 && m.addedNodes[0].classList && m.addedNodes[0].classList.contains('lg-gl')) continue;
          if (m.type === 'attributes' && m.target.classList && m.target.classList.contains('lg-gl')) continue;
          global.requestAnimationFrame ? requestAnimationFrame(refresh) : refresh();
          return;
        }
      });
      mo.observe(bar, { childList: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true, subtree: true });
    }
    if (global.ResizeObserver) { ro = new ResizeObserver(function () { place(false); updateRefraction(); }); ro.observe(bar); }
    /* 第 312 次：深浅色切换时磨砂配方不同（lighten 34% / darken 65%），Chromium 滤镜要重建（只比对 key，不变就不动） */
    if (global.MutationObserver) new MutationObserver(function () { if (refractOn) updateRefraction(); }).observe(doc.body, { attributes: true, attributeFilter: ['class'] });
    bar.addEventListener('pointerdown', onDown, { passive: true });
    global.addEventListener('pointermove', onMove, { passive: true });
    bar.addEventListener('click', function (e) { if (Date.now() < swallowUntil) { e.stopPropagation(); e.preventDefault(); swallowUntil = 0; } }, true);
    global.addEventListener('pointerup', onUp, { passive: true });
    global.addEventListener('pointercancel', onUp, { passive: true });
    place(false); updateRefraction();
  };
  LD.refresh = function () { if (bar) { place(false); updateRefraction(); } };
  LD.RIM = LENS_RIM;   /* 第 312 次：iOS 着色器读同一组透镜 rim 参数 */
  LD.ICON_TEX = LENS_ICON_TEX;   /* 第 313 次：dock-refract.js 据此决定要不要栅格化图标层 */
  LD.LENS_TEX = LENS_TEX;     /* 第 314 次：GL 画透镜里的彩色图标 + 选中色文字（透镜图标层） */
  LD.LENS = { W: LENS_W, DH: LENS_DH, ZOOM: LENS_ZOOM, MAG: LENS_MAG };
  LD.THUMB = { INSET: THUMB_INSET, PX: THUMB_PX };
  LD.PHYS = PHYS;
  /* 第 319 次：dock 是否在动（透镜在场 / 按下缩放回弹中）——折射层据此推迟整页快照、不读布局；当前缩放；每帧耗时记录 */
  LD.animating = function () { return !!(lens || DS.on); };
  LD.dockScale = function () { return DS.s || 1; };
  LD._perf = function (clear) { var o = { frames: perf.frames.slice(), long: perf.long.slice() }; if (clear) { perf.frames.length = 0; perf.long.length = 0; } return o; };
  LD._paceTest = function () { var o = {}; return [pace(o, 50), pace(o, 1000 / 60), pace(o, 1000 / 60)].map(function (v) { return Math.round(v * 100) / 100; }); };
  LD._ds = function () { return { s: DS.s, v: DS.v, on: DS.on, down: DS.down }; };
  LD._phys = function () { return { reduced: reduced, PHYS: PHYS }; };
  LD._pin = function (o) { lensPin = o || null; if (lens) lensApply(); };
  var r3 = function (v) { return Math.round(v * 1000) / 1000; };
  LD._state = function () { return { refract: refractOn, thumb: !!(thumb && thumb.classList.contains('on')), map: mapKey,
    lens: lens ? { mode: lens.mode, phase: lens.phase, s: r3(lens.s), m: r3(lens.m), x: Math.round(lens.x * 10) / 10, vx: Math.round(lens.vx),
      sx: r3(lens.sx), sy: r3(lens.sy), tap: !!lens.tap, eL: Math.round(lens.eL * 10) / 10, eR: Math.round(lens.eR * 10) / 10, bf: r3(lens.bf), retargets: lens.retargets || 0, jc: r3(lens.jc || 0), jcMax: r3(lens.jcMax || 0), end: lens.endSide || 0, hitV: lens.hitV || 0, pull: Math.round((lens.pull || 0) * 100) / 100, pullMax: Math.round((lens.pullMax || 0) * 100) / 100, w: Math.round((lens.eR - lens.eL) * 10) / 10, hl: r3(lens.hl), flash: r3(lens.flash), rb: Math.round(lens.rb * 10) / 10, tx: Math.round(lens.tx * 10) / 10 } : null }; };

  global.LiquidDock = LD;
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', function () { setTimeout(LD.init, 0); });
  else setTimeout(LD.init, 0);
})(window);
