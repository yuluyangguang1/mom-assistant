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

  /* 返回位移贴图的 dataURL；R/G 通道 128 为不动，±127 对应 ±scale/2 像素 */
  LD.buildMap = function (w, h, opts) {
    opts = opts || {};
    var amount = opts.amount != null ? opts.amount : 14;     /* 最大偏移（CSS px） */
    var depth = opts.depth != null ? opts.depth : 0.25;      /* depthEffect：往中心方向的附加弯曲 */
    var k = 1;                                               /* 贴图按 1x 画，够用且快 */
    var W = Math.max(2, Math.round(w * k)), H = Math.max(2, Math.round(h * k));
    var c = doc.createElement('canvas'); c.width = W; c.height = H;
    var g = c.getContext('2d'); if (!g) return null;
    var img = g.createImageData(W, H), d = img.data;
    var hx = w / 2, hy = h / 2, r = Math.min(hx, hy);
    var height = Math.min(opts.height || 18, hx, hy), gr = Math.min(r * 1.5, hx, hy);
    var scale = amount * 2;
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var px = (x + 0.5) / k - hx, py = (y + 0.5) / k - hy;
        var sd = sdRoundRect(px, py, hx, hy, r), dx = 0, dy = 0;
        if (-sd < height) {
          var t = Math.min(Math.max(1 - (-Math.min(sd, 0)) / height, 0), 1);
          var m = circleMap(t) * amount;
          var gv = gradRoundRect(px, py, hx, hy, gr);
          var cl = Math.max(Math.sqrt(px * px + py * py), 1e-4);
          var nx = gv[0] + depth * px / cl, ny = gv[1] + depth * py / cl;
          var nl = Math.max(Math.sqrt(nx * nx + ny * ny), 1e-4);
          dx = m * nx / nl; dy = m * ny / nl;
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

  function updateRefraction() {
    if (!bar) return;
    /* 第 275 次：iOS / WebKit 走 dock-refract.js（快照 + WebGL 边缘折射）；Chromium 仍走下面的 SVG 位移贴图 */
    var gl = global.DockRefract ? global.DockRefract.sync(bar) : false;
    var on = !gl && canRefract() && settingsAllow();
    if (!on) { doc.documentElement.classList.remove('lg-refract'); refractOn = false; return; }
    var w = Math.round(bar.offsetWidth), h = Math.round(bar.offsetHeight);
    if (w < 20 || h < 20) return;
    var key = w + 'x' + h;
    if (key !== mapKey) {
      var mp = LD.buildMap(w, h, { amount: 12, height: Math.min(18, h / 2), depth: 0.25 });
      if (!mp) return;
      ensureDefs();
      var fe = doc.getElementById('lgDockMap');
      fe.setAttribute('width', w); fe.setAttribute('height', h);
      fe.setAttributeNS('http://www.w3.org/1999/xlink', 'href', mp.url);
      fe.setAttribute('href', mp.url);
      var dm = fe.nextSibling; if (dm) dm.setAttribute('scale', mp.scale);
      mapKey = key;
    }
    doc.documentElement.classList.add('lg-refract'); refractOn = true;
  }


  /* ---------- 第 309 次：拖动透镜（定稿 mock303n · 第十四版） ---------- */
  var LENS_RIM = { rb: 7, re: 17, rev: 30 };   /* 静止参数；拖动时偏移 ×(1+0.12·速度)（≈ 移动中 re 19 / rev 32） */
  var LENS_MX = 34;                            /* 贴图里 ±127 对应的最大偏移（CSS px，绿通道基准） */
  var LENS_PAD = 60;                           /* 透镜元素四周留白：外沿取样最远 ≈ 30 × 1.12 × 1.315（蓝）≈ 44px，再加余量 */
  var LENS_K = 2;                              /* 贴图分辨率：每 CSS px 2 像素 */
  var LENS_W = 124, LENS_DH = 20;              /* 透镜宽 112（≈ 页签 2 倍、比灰胶囊略宽，宽高比约 1.33）；高 = 栏高 + 20（上下各冒出栏 10px，与定稿同比） */
  var IOR_D = [-0.03, 0, 0.035];               /* n − 1.5，n = [1.47, 1.5, 1.535] */
  var lens = null, lensEl = null, lensKey = '', lensRaf = 0;

  /* 定稿 rim 算法：中间 0 偏移；外沿 rb 内 off = (re·(1−|ny|) + rev·|ny|) · t^(1.6+0.8|ny|)，沿外法线往外取样。
     R/G = 绿通道（n=1.5）的偏移，B = 透镜形状遮罩（滤镜里只在透镜内用折射结果，其余原样）。 */
  LD.buildLensMap = function (w, h, pad, K, maxDown) {
    pad = pad == null ? LENS_PAD : pad; K = K || LENS_K;
    /* 视口外没有背景可取（backdrop 是透明的，会折出一道黑 / 彩线）：透镜下沿离屏幕底不远时，往下取样不超过屏幕底
       （按最重的蓝通道 + 拖动加重 1.63 × 1.12 留余量）。真机有 home 条安全区，一般用不到。 */
    var KMAX = (1 + IOR_D[2] * 18) * 1.12, lim = maxDown == null ? 1e9 : maxDown;
    var CW = Math.round((w + 2 * pad) * K), CH = Math.round((h + 2 * pad) * K);
    var c = doc.createElement('canvas'); c.width = CW; c.height = CH;
    var g = c.getContext('2d'); if (!g) return null;
    var img = g.createImageData(CW, CH), dd = img.data;
    var hx = w / 2, hy = h / 2, r = Math.min(hx, hy), P = LENS_RIM;
    for (var j = 0; j < CH; j++) {
      for (var i = 0; i < CW; i++) {
        var x = (i + 0.5) / K - pad - hx, y = (j + 0.5) / K - pad - hy;
        var sd = sdRoundRect(x, y, hx, hy, r), d = -sd, ox = 0, oy = 0;
        if (sd < 1.5 && d < P.rb) {
          var gx = sdRoundRect(x + 0.5, y, hx, hy, r) - sdRoundRect(x - 0.5, y, hx, hy, r);
          var gy = sdRoundRect(x, y + 0.5, hx, hy, r) - sdRoundRect(x, y - 0.5, hx, hy, r);
          var nl = Math.sqrt(gx * gx + gy * gy) || 1, nx = gx / nl, ny = gy / nl, ay = Math.abs(ny);
          var t = 1 - Math.max(d, 0) / P.rb;
          var off = (P.re * (1 - ay) + P.rev * ay) * Math.pow(t, 1.6 + ay * 0.8);
          ox = nx * off; oy = ny * off;
          var yl = (h / 2 + lim - 0.5 - y) / KMAX;
          if (oy > yl) { var sc = Math.max(0, yl) / oy; oy *= sc; ox *= sc; }
        }
        var k = (j * CW + i) * 4;
        dd[k] = Math.round(128 + 127 * Math.max(-1, Math.min(1, ox / LENS_MX)));
        dd[k + 1] = Math.round(128 + 127 * Math.max(-1, Math.min(1, oy / LENS_MX)));
        dd[k + 2] = Math.round(255 * Math.max(0, Math.min(1, 0.5 - sd)));
        dd[k + 3] = 255;
      }
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
  function ensureLensFilter(W, H, maxDown) {
    var key = W + 'x' + H + '/' + maxDown;
    if (key === lensKey && doc.getElementById('lgLens')) return true;
    var mp = LD.buildLensMap(W, H, LENS_PAD, LENS_K, maxDown);
    if (!mp) return false;
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
      /* 定稿：透镜里的内容略提亮、提饱和（brightness 1.07 / saturate 1.3） */
      + '<feColorMatrix in="rgb" type="saturate" values="1.3" result="sat"/>'
      + '<feComponentTransfer in="sat" result="lit"><feFuncR type="linear" slope="1.07"/><feFuncG type="linear" slope="1.07"/><feFuncB type="linear" slope="1.07"/></feComponentTransfer>'
      + '<feColorMatrix in="m" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 1 0 0" result="mk"/>'
      + '<feComposite in="lit" in2="mk" operator="in" result="ln"/>'
      + '<feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="ln"/></feMerge>';
    var im = f.firstChild; im.setAttributeNS('http://www.w3.org/1999/xlink', 'href', mp.url);
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
  function nowMs() { return global.performance ? performance.now() : Date.now(); }
  function tabCenter(t) { var r = t.getBoundingClientRect(); return r.left + r.width / 2; }
  function lensStart(t) {
    if (lens || !bar || !t || !t.classList.contains('dk-tab') || bar.classList.contains('is-sub') || bar.classList.contains('is-vertical')) return false;
    var mode = lensMode();
    if (!mode) return false;
    var W = LENS_W, H = Math.round(bar.offsetHeight + LENS_DH);
    var br0 = bar.getBoundingClientRect();
    var maxDown = Math.max(0, Math.floor(global.innerHeight - (br0.top + br0.height / 2 + H / 2)));
    if (maxDown > 60) maxDown = 60;   /* 够远就不限（贴图键稳定，不反复重建） */
    if (mode === 'svg' && !ensureLensFilter(W, H, maxDown >= 60 ? null : maxDown)) mode = 'plain';
    var el = ensureLensEl();
    var body = el.firstChild;
    el.style.width = (W + 2 * LENS_PAD) + 'px'; el.style.height = (H + 2 * LENS_PAD) + 'px';
    body.style.left = body.style.top = LENS_PAD + 'px'; body.style.width = W + 'px'; body.style.height = H + 'px';
    /* 第 310 次：四周留白只为折射取样用，画面只留透镜本身（Chromium 的 backdrop 在留白区会出一道倒影） */
    el.style.clipPath = 'inset(' + (LENS_PAD - 1) + 'px round ' + (H / 2 + 1) + 'px)';
    el.classList.remove('svg', 'gl', 'plain'); el.classList.add(mode);
    var x = tabCenter(t), n = nowMs();
    lens = { mode: mode, W: W, H: H, x: x, tx: x, s: 0, m: 0, phase: 'grow', t0: n, last: n, pw: t.offsetWidth, ph: t.offsetHeight, tab: t };
    bar.classList.add('lg-lensing');
    if (thumb) { thumb.classList.add('lg-lhide'); thumb.classList.remove('lg-grow'); }
    lensApply();
    el.classList.add('on');
    if (!lensRaf) lensRaf = global.requestAnimationFrame(lensFrame);
    return true;
  }
  function lensRelease(x) {
    if (!lens || lens.phase === 'settle' || lens.phase === 'shrink') return;
    if (x != null) lens.tx = x;
    lens.phase = 'settle'; lens.ts = nowMs();
    if (!lensRaf) lensRaf = global.requestAnimationFrame(lensFrame);
  }
  function lensEnd() {
    if (lensRaf) { global.cancelAnimationFrame(lensRaf); lensRaf = 0; }
    lens = null;
    if (lensEl) { lensEl.classList.remove('on'); lensEl.style.opacity = ''; }
    if (bar) bar.classList.remove('lg-lensing');
    if (thumb) thumb.classList.remove('lg-lhide');
    if (global.DockRefract && DockRefract.lens) DockRefract.lens(null);
  }
  function ease(k) { return 1 - Math.pow(1 - k, 3); }
  function lensFrame() {
    lensRaf = 0;
    if (!lens) return;
    if (!bar || !bar.isConnected) { lensEnd(); return; }
    var n = nowMs(), dt = Math.min(48, Math.max(1, n - lens.last)); lens.last = n;
    var px = lens.x;
    /* 拖动时跟手（只留一点点平滑）；松手后像被磁吸一样落到页签中心 */
    var tau = (lens.phase === 'settle' || lens.phase === 'shrink') ? 55 : 14;
    lens.x += (lens.tx - lens.x) * (1 - Math.exp(-dt / tau));
    var v = Math.abs(lens.x - px) / dt;                          /* px / ms */
    var mt = Math.min(1, v / 0.45);
    lens.m += (mt - lens.m) * (1 - Math.exp(-dt / (mt > lens.m ? 40 : 170)));
    if (lens.phase === 'grow') {
      var k = (n - lens.t0) / 150;
      if (k >= 1) { k = 1; lens.phase = 'hold'; }
      lens.s = ease(k);
    } else if (lens.phase === 'hold') {
      lens.s += (1 - lens.s) * (1 - Math.exp(-dt / 40));
    } else if (lens.phase === 'settle') {
      lens.s += (1 - lens.s) * (1 - Math.exp(-dt / 40));
      if (n - lens.ts > 260 || (n - lens.ts > 110 && Math.abs(lens.tx - lens.x) < 0.6 && lens.m < 0.15)) {
        lens.phase = 'shrink'; lens.t1 = n; lens.s1 = lens.s;
        if (thumb) {
          try { thumb.getAnimations().forEach(function (a) { a.finish(); }); } catch (e) { /* 老内核 */ }
          thumb.classList.remove('lg-lhide');
        }
      }
    } else if (lens.phase === 'shrink') {
      var q = (n - lens.t1) / 160;
      if (q >= 1) { lensEnd(); return; }
      lens.s = lens.s1 * (1 - ease(q));
    }
    lensApply();
    lensRaf = global.requestAnimationFrame(lensFrame);
  }
  var lensPin = null;   /* 测试 / 截图用：钉住鼓起比例 s 与速度 m（截图要几百毫秒，逐帧状态等不到） */
  function lensApply() {
    if (!lens || !lensEl) return;
    if (lensPin) { if (lensPin.s != null) lens.s = lensPin.s; if (lensPin.m != null) lens.m = lensPin.m; }
    var L = lens, br = bar.getBoundingClientRect(), cy = br.top + br.height / 2, s = L.s;
    var w = L.pw + (L.W - L.pw) * s, h = L.ph + (L.H - L.ph) * s, sx = w / L.W, sy = h / L.H;
    lensEl.style.transform = 'translate(' + (L.x - L.W / 2 - LENS_PAD) + 'px,' + (cy - L.H / 2 - LENS_PAD) + 'px) scale(' + sx + ',' + sy + ')';
    lensEl.style.opacity = L.phase === 'shrink' ? Math.min(1, s * 1.6) : Math.min(1, 0.35 + s * 1.3);
    /* 色散随速度：chx 9（静止）→ 18（快速拖动）；偏移 ×(1 + 0.12·m) */
    var chx = 9 + 9 * L.m, gm = 1 + 0.12 * L.m;
    if (L.mode === 'svg') {
      var f = doc.getElementById('lgLens');
      if (f) {
        var dms = f.getElementsByTagName('feDisplacementMap');
        for (var c = 0; c < 3 && c < dms.length; c++) dms[c].setAttribute('scale', (2 * LENS_MX * (1 + IOR_D[c] * chx) * gm).toFixed(2));
      }
    }
    /* 栏的上下细边：透镜里两条水平直线（局部坐标里抵消缩放，始终贴在栏边上；只画栏的直边段） */
    var lx = L.x - w / 2, R = br.height / 2;
    var a = Math.max(14, (br.left + R - lx) / sx), b = Math.min(L.W - 14, (br.right - R - lx) / sx);
    var lines = lensEl.firstChild.children;
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i], yy = (i === 0 ? br.top : br.bottom) - cy;
      ln.style.top = (L.H / 2 + yy / sy) + 'px';
      ln.style.left = a + 'px'; ln.style.width = Math.max(0, b - a) + 'px';
      ln.style.opacity = b - a > 6 ? Math.min(1, s * s) : 0;
    }
    /* 透镜范围内的页签：彩色图标只在透镜里露出，线条图标只在透镜外（原位、原大，不缩放） */
    tabsOf().forEach(function (t) {
      var els = t.querySelectorAll('.dk-c, .dk-l');
      for (var j = 0; j < els.length; j++) {
        var r = els[j].getBoundingClientRect();
        els[j].style.setProperty('--la', (lx - r.left).toFixed(2) + 'px');
        els[j].style.setProperty('--lb', (lx - r.left + w).toFixed(2) + 'px');
      }
    });
    if (L.mode === 'gl' && global.DockRefract && DockRefract.lens) DockRefract.lens({ x: lx, y: cy - h / 2, w: w, h: h }, L.m, sy);
  }

  /* ---------- 3. 选中水滴：跟随 + 弹簧 ---------- */
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
    var r = { x: a.offsetLeft, y: a.offsetTop, w: a.offsetWidth, h: a.offsetHeight };
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
    bar.classList.add('lg-press');
    dragStart(e, t);
    /* 第 309 次：页签上按下 → 灰胶囊鼓成透镜；不出透镜时（高对比 / 减少透明度）仍是旧的放大 */
    if (!lensStart(t) && thumb && t.classList.contains('active')) thumb.classList.add('lg-grow');
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
    var was = bar.classList.contains('lg-press');
    bar.classList.remove('lg-press');
    if (thumb) thumb.classList.remove('lg-grow');
    if (was && global.DockRefract && DockRefract.press) DockRefract.press('dock', false);
  }

  /* 第 304 次：按住页签左右拖，水滴跟着手指走；经过哪个页签哪个就换成彩色图标，松手切到那一页 */
  var drag = null, swallowUntil = 0;
  function tabsOf() { return bar ? Array.prototype.filter.call(bar.querySelectorAll('.tab.dk-tab'), function (t) { return t.offsetParent; }) : []; }
  function dragStart(e, t) {
    if (!t.classList.contains('dk-tab') || bar.classList.contains('is-sub') || bar.classList.contains('is-vertical')) return;
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
    var x = e.clientX - br.left - w / 2;
    x = Math.max(first.offsetLeft - 4, Math.min(last.offsetLeft + 4, x));
    thumb.style.transform = 'translate(' + x + 'px,' + a.offsetTop + 'px)';
    if (lens) lens.tx = br.left + (x + w / 2) * (br.width / (bar.offsetWidth || br.width));   /* 第 309 次：透镜跟手 */
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
    bar.addEventListener('pointerdown', onDown, { passive: true });
    global.addEventListener('pointermove', onMove, { passive: true });
    bar.addEventListener('click', function (e) { if (Date.now() < swallowUntil) { e.stopPropagation(); e.preventDefault(); swallowUntil = 0; } }, true);
    global.addEventListener('pointerup', onUp, { passive: true });
    global.addEventListener('pointercancel', onUp, { passive: true });
    place(false); updateRefraction();
  };
  LD.refresh = function () { if (bar) { place(false); updateRefraction(); } };
  LD._pin = function (o) { lensPin = o || null; if (lens) lensApply(); };
  LD._state = function () { return { refract: refractOn, thumb: !!(thumb && thumb.classList.contains('on')), map: mapKey,
    lens: lens ? { mode: lens.mode, phase: lens.phase, s: Math.round(lens.s * 1000) / 1000, m: Math.round(lens.m * 1000) / 1000, x: Math.round(lens.x * 10) / 10 } : null }; };

  global.LiquidDock = LD;
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', function () { setTimeout(LD.init, 0); });
  else setTimeout(LD.init, 0);
})(window);
