/**
 * dock-refract.js — 第 275 次：iOS（WebKit）上 dock 的「真折射」液态玻璃；第 277 次扩成「一套折射、多块玻璃」
 *
 * 为什么要单独做：
 *   第 235 次的折射走 backdrop-filter: url(#svg位移贴图)，只有 Chromium 支持；
 *   iOS 上所有浏览器都是 WebKit，backdrop-filter 里写 url() 整块玻璃会消失，所以 iOS 只有模糊 + 高光。
 *
 * 参考过的开源项目（只借思路、未拷贝代码，三者均为 MIT）：
 *   · naughtyduk/liquidGL（MIT）：把页面「快照」成一张纹理交给 WebGL，滚动时只改采样偏移，不重拍。
 *   · samasante/liquid-glass（MIT）：普通 filter:url() 作用在内容自身，WebKit 可用，但要把背景内容复制一份。
 *   · amnn-in/glasskit（MIT）：CSS / SVG / DOM 克隆 / WebGL 四种引擎可切换，克隆模式要逐帧同步克隆层位置。
 *   选 liquidGL 的路子（快照 + WebGL），理由见第 275 次记录；这里自带一个「够用」的小光栅器，
 *   把 #view 里的卡片底色 / 渐变 / 圆角 / 图片 / 画布 / 文字按页面坐标画进一张低分辨率离屏画布。
 *
 * 画法（与 Kyant backdrop / liquid-dock.js 同一套公式）：
 *   · 只画玻璃边缘一圈（宽 band）——圆角矩形距离场，越靠边按 circleMap 往外偏移采样（把背景「拉弯」）；
 *   · 色散：R / G / B 三个通道偏移量不同；高光：法线与光线方向的点积；深色模式多一道细光边；
 *   · 中间仍是各自实时的 backdrop-filter 模糊，边缘一圈透明度渐变过渡。
 *
 * 第 277 次（多块玻璃，共用一个上下文、一张快照纹理）：
 *   · 「玻璃面」surface：dock、正在进行胶囊（live）、顶部提示岛（toast）。上下文永远 1 个、纹理永远 2 张（整页快照 + 视口底色条）。
 *   · 胶囊直接画在 dock 那块 WebGL 画布里：胶囊在场时画布扩成 dock ∪ 胶囊的外接矩形，两块玻璃写成同一个距离场
 *     （平时 k = 0 就是两块各自的边），零拷贝。胶囊自身的整块 backdrop-filter 换成内圈 .dl-glass（.lg-band），
 *     外圈折射边不会被再糊一遍。（试过「每帧 drawImage 拷进胶囊自己的 2D 小画布」：Chromium/SwiftShader 下
 *     滚动掉到 14fps——drawImage 读 WebGL 画布会逼 GPU 同步，弃用；只有离 dock 很远、层级又在面板之上的提示岛这样做，它只停留几秒。）
 *   · 胶囊出现 / 消失：dock-live.js 逐帧告诉这里胶囊当前的形状（DR.shape），距离场随尺寸插值；
 *     出现动画前段两块玻璃的距离场做 smooth-min（metaball），融合半径只在中线附近大（高斯衰减）——
 *     像一滴水从 dock 顶上拉出来、颈部变细后断开；稳定后 k = 0。
 *   · 质感：按压时边缘折射增强（DR.press）、水滴指示器是一块小透镜（放大 + 边缘折射，拉伸时跟着形变）、
 *     高光方向随设备倾斜（只在系统已经给了方向数据时，不弹授权）或随滚动方向微移，再慢慢回到左上 45°。
 *   · 快照局部更新：#view 里的小改动（计时文字、class 切换）只记下改动元素，按它的页面 y 范围重拍一条横带
 *     （clip + 只重画与横带相交的子树 + texSubImage2D 只传那几行）；离所有玻璃面都远的改动先攒着，
 *     滚到玻璃面附近或 4 秒后再拍。换页 / 窗口尺寸 / 页面高度变化仍整张重拍。
 *
 * 第 309 次：选中指示器换成定稿的拖动透镜（liquid-dock.js 逐帧调 DR.lens）：透镜中间 1:1（栏内透明、栏外照画页面），
 *   只有外沿约 7px 一圈按 mock303n 的 rim 公式往外取样 + R/G/B 三通道色散，栏边细灰线折进来是上下两条直线。
 *
 * 第 312 次：「真液态玻璃」——共用 js/glass-optics.js：dock 边带改成凸 squircle + Snell 位移表（1D 纹理 uD）沿内法线往里取样，
 *   色调换成 Glass-HQ regular 曲线的线性近似（与 CSS backdrop-filter 同系数，替掉 saturate 1.9 的灰黑斑块），
 *   高光 = 固定光照的 |n·L|² 边缘 rim + 高光处提饱和；透镜 rim 同一张表 + 厚玻璃亮边。
 *   dock 图标（线条图标 + 文字）单独画进一张纹理 uI：透镜外沿往外取样时邻近图标真的被折弯进来，DOM 那一圈让开（--lr）。
 *
 * 第 313 次：透镜内部画成玻璃体（以中心放大 uMagI、提亮 uLB，不再透明露出页签底色）；外沿沿法线双点取样 + 栏外快照 1.5px 预滤波（压掉彩色噪点）；
 *   透镜在场时画布不降到 1.5 倍、不继承栏圆角；DR.lens 同步重画、带整体不透明度 uLA；图标纹理随 LiquidDock.ICON_TEX（默认关）。
 *
 * 第 314 次：液态透镜——透镜距离场按 uniform（形变后的宽高）现算、冒出 dock 的部分与 dock 做 smooth-min 融合；凸透镜（中心放大 uMagI 1.15、
 *   外沿往里取样的 Snell 拉丝带、rim 带里随速度的淡色散）；高光随运动方向 / 速度 + 按下亮弧；透镜四周淡投影；透镜里的彩色图标 + 选中色文字来自「透镜图标层」纹理。
 *   清透：透镜本身几乎不加料（uLB 0.02），快照 0.5 → 0.75 倍；dock 外沿几 px 减轻模糊 / 色调，折弯的背景看得清。透镜在场时画布一次外扩定尺寸，拖动只改 uniform。
 *
 * 何时开：仅 WebKit / 非 Chromium（Chromium 走第 235 次的 SVG 路径）；设置「真实玻璃折射」开、
 *   「dock 液态玻璃折射」开；高对比 / 减少透明度时关；减少动态效果时只在静止时重拍、不跟随动画、高光不动。
 *   「自动」档下快照连续两次超过 150ms 就关闭本次会话的折射；滚动 <45fps 逐档降画质。
 *
 * 第 328 次（原型分支 proto-worker-lens，不进 main）：支持 OffscreenCanvas + Worker WebGL 时，画布 transferControlToOffscreen 交给 js/dock-worker.js：
 *   这里的 WebGL 调用全打到「录制代理」gl 上（同一份着色器 / uniform 代码），打包 postMessage 过去原样重放；画布纹理转 ImageBitmap（transferable）。
 *   透镜的物理和逐帧重画也在 Worker（liquid-dock.js 只转发指针事件），切页时主线程再忙透镜也不停。不支持（没有 OffscreenCanvas / Worker 里拿不到 webgl）
 *   自动退回原来的主线程实现；localStorage lgWorker = '0' 强制退回。顶部提示岛（要 drawImage 读 GL 画布）在 Worker 模式下只用 CSS 毛玻璃。
 *
 * 资源：全程只有 1 个 WebGL 上下文、2 张纹理、1 个缓冲；提示岛在场时多 1 块 2D 小画布，消失即缩成 0×0 移除。
 *   关掉开关 / 降级时 stop()：取消 rAF 与定时器、断开观察器、删纹理 / 程序 / 缓冲、loseContext、移除全部画布。
 */
(function (global) {
  'use strict';
  var doc = global.document;
  if (!doc) return;

  var DR = {};
  var S_MAX = 0.75;         /* 快照分辨率：每 CSS 像素 0.75 纹素（第 314 次 0.5 → 0.75：透镜清透、放大 1.15 后背后的字 / 色块边要看得清，0.5 倍放大后是一团） */
  var TEX_MAX = 4096;       /* iOS 最大纹理边长的稳妥值；超长页面整体降分辨率 */
  var SLOW_MS = 150;        /* 自动档：快照超过这个就判为「性能不够」（不算第一次——首次要建字形缓存、解码图片） */
  var BAND = 18;            /* 折射边带宽（CSS px；第 314 次 15 → 18） */
  var STRIPE_GAP = 500;     /* 局部重拍最短间隔（ms） */
  var FUSE_EXT = 28;        /* 视口底色条 / 采样范围在 dock 上方多留的高度（胶囊冒出来的颈部） */
  var HOT_M = BAND + 40;    /* 玻璃面采样范围外扩（边带 + 偏移 + 模糊 + 余量） */

  var bar = null, cv = null, gl = null, prog = null, buf = null, texP = null, texB = null, U = {};
  var texD = null, texI = null, icCv = null, icKey = '', icReady = false, icGen = 0;   /* 第 312 次：位移表 / dock 图标层 */
  var pageCv = null, pctx = null, stripCv = null, sctx = null;
  var on = false, ready = false, lost = false, dirty = true, hiddenForNav = false;
  var raf = 0, rasterTimer = 0, stripeTimer = 0, staleTimer = 0, scrollIdleTimer = 0, scrolling = false, lastRaster = 0, lastStripe = 0, slowHits = 0, disabledReason = '';
  /* 画质档：2 = 2 倍像素 + 9 点模糊；1 = 1 倍像素 + 5 点；0 = 只在静止时折射（滚动时边缘淡出）。
     滚动中连续 40 帧中位帧间隔 > 22ms（不到 45fps）就降一档，本次会话不再升回 */
  var quality = 2, fq = [], fqLast = 0;
  var mo = null, moBody = null, ro = null, roView = null, bodyKey = '', animWait = 0, settleTimer = 0;
  var pageMeta = { w: 0, h: 0, s: S_MAX, sx: 0, sy: 0 }, stripMeta = { x: 0, y: 0, w: 1, h: 1, opaque: false };
  var stats = { ctxCreated: 0, ctxLive: 0, texLive: 0, texCreated: 0, rasters: 0, rasterMs: 0, rasterMax: 0, draws: 0, uploadsRealloc: 0, uploadsSub: 0, nodes: 0,
    stripes: 0, stripeMs: 0, stripeMax: 0, stripeRows: 0, deferred: 0, strips: 0, copies: 0, frames: 0 };
  var reduced = false;
  try { reduced = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* */ }
  /* 第 328 次：Worker 渲染。wm = 本次 start 走 Worker；wOK 1 = Worker 里 webgl 建好了 / −1 = 失败（本次会话不再试）；cvW / cvH = 画布缓冲尺寸（转交后主线程不能再读写 cv.width） */
  var W_ = null, wm = false, wOK = 0, wNo = false, wInfo = null, cvW = 0, cvH = 0, wPerf = null, wQ = null;
  var IMG = {};             /* 背景图 url → Image（同源，已在 SW 缓存里） */
  /* 第 277 次：玻璃面（live / toast；dock 自己不在表里）、局部重拍队列、动画循环、光线、按压 */
  var surf = {}, pend = [], stale = [], loopUntil = 0;
  var light = { x: -0.7071, y: -0.7071, tx: -0.7071, ty: -0.7071, src: 'static', tiltAt: 0, lastSy: 0, lastAng: '' };
  var press = { dock: 0, live: 0, tdock: 0, tlive: 0 };
  var lastT = 0;
  /* 第 309 次：拖动透镜（liquid-dock.js 逐帧给）：视口矩形、速度 0..1、鼓起比例（偏移随尺寸缩放） */
  var lensR = null, lensM = 0, lensG = 1, lensA = 1;
  /* 第 314 次：透镜动态量（liquid-dock.js 逐帧给）：hl = 运动方向 × 速度（−1..1，高光朝运动方向偏）、flash = 按下亮弧（1 → 0）、fuse = 与 dock 的 smooth-min 半径、a = 形变速度 0..1 */
  var lensFx = { hl: 0, flash: 0, fuse: 0, a: 0 };
  /* 第 319 次：dock 在动（透镜在场 / 按下缩放回弹）时——不重拍整页快照（推迟到落定）、不读布局（用缓存的未缩放栏矩形）、不藏画布 */
  /* 第 320 次：二级页融合层分裂 / 合拢 / 侧滑跟手中也算「在动」（整页快照、回读像素推迟到落定，DockFuse 落定时调 DR.settled） */
  function busy() { return !!(lensR || (global.LiquidDock && LiquidDock.animating && LiquidDock.animating()) || (global.DockFuse && DockFuse.morphing && DockFuse.morphing())); }
  var geoC = null, pendRaster = 0, tintC = { k: '', v: null };
  function barRect() {
    if (geoC && busy()) return geoC;
    var r = bar.getBoundingClientRect(), k = (global.LiquidDock && LiquidDock.dockScale) ? LiquidDock.dockScale() : 1;
    var cx = r.left + r.width / 2, cy = r.top + r.height / 2, w = r.width / k, h = r.height / k;
    geoC = { left: cx - w / 2, top: cy - h / 2, width: w, height: h, right: cx + w / 2, bottom: cy + h / 2 };
    return geoC;
  }
  var LENS_MAG_I = 0.97;    /* 第 317 次：1.15 放大 → 0.97 缩小（支付宝 22:03 第 13 帧背后字行互相关：取样比例 1.02，即显示约 0.98×；透镜外内容压进边带，整体是缩小）。图标层不缩（gIc） */
  var LENS_SHADOW = 14;     /* 第 314 次：画布在透镜四周多留的边（投影 + 融合圆角） */

  /* ---------- 开关判断 ---------- */
  function setting() {
    try { var s = global.Storage && Storage.get && Storage.get().settings; return s || {}; } catch (e) { return {}; }
  }
  function isChromiumRefract() {
    try {
      var ua = global.navigator.userAgent || '';
      if (/iPhone|iPad|iPod|CriOS|FxiOS/.test(ua)) return false;
      if (!/Chrome\/\d+/.test(ua) || /Firefox/.test(ua)) return false;
      return !!(global.CSS && CSS.supports('backdrop-filter', 'url(#a)'));
    } catch (e) { return false; }
  }
  function forced() { try { return global.localStorage.getItem('lgGlForce') === '1'; } catch (e) { return false; } }
  function reducedTransparency() {
    try { return global.matchMedia('(prefers-reduced-transparency: reduce)').matches; } catch (e) { return false; }
  }
  DR.wanted = function () {
    var s = setting();
    if (s.realRefraction === false || s.dockGlass === 'off') return false;
    if (doc.body && doc.body.classList.contains('hc')) return false;
    if (reducedTransparency()) return false;
    if (isChromiumRefract() && !forced()) return false;   /* Chromium 用第 235 次的 SVG 折射 */
    if (disabledReason && s.dockGlass !== 'on') return false;
    return true;
  };

  /* ---------- 小光栅器 ---------- */
  function parseColor(str) {
    if (!str) return null;
    var m = /rgba?\(([^)]+)\)/.exec(str);
    if (m) {
      var p = m[1].split(/[\s,\/]+/).filter(Boolean).map(parseFloat);
      return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
    }
    m = /color\(srgb\s+([^)]+)\)/.exec(str);    /* Safari 对 color-mix 的计算值 */
    if (m) {
      var q = m[1].split(/[\s\/]+/).filter(Boolean).map(parseFloat);
      return [q[0] * 255, q[1] * 255, q[2] * 255, q.length > 3 ? q[3] : 1];
    }
    return null;
  }
  function css(c, a) { return 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + (c[3] * (a == null ? 1 : a)) + ')'; }
  function splitTop(s) {
    var out = [], depth = 0, cur = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (ch === '(') depth++; else if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }
  function rr(g, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    g.beginPath();
    if (r < 0.5) { g.rect(x, y, w, h); return; }
    g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }
  function radiusOf(cs, w, h) {
    var v = cs.borderTopLeftRadius || '0';
    var n = parseFloat(v) || 0;
    if (v.indexOf('%') > 0) n = Math.min(w, h) * n / 100;
    return n;
  }
  function paintGradient(g, layer, x, y, w, h, alpha) {
    var lin = /^(repeating-)?linear-gradient\((.*)\)$/.exec(layer);
    var rad = !lin && /^(repeating-)?radial-gradient\((.*)\)$/.exec(layer);
    var body = lin ? lin[2] : rad ? rad[2] : null;
    if (!body) return false;
    var parts = splitTop(body), ang = 180;
    if (lin && parts.length && !/rgb|color\(|#|transparent/.test(parts[0])) {
      var a0 = parts.shift();
      var dm = /(-?[\d.]+)deg/.exec(a0);
      if (dm) ang = parseFloat(dm[1]);
      else if (/to right/.test(a0)) ang = 90; else if (/to left/.test(a0)) ang = 270; else if (/to top/.test(a0)) ang = 0; else ang = 180;
    } else if (rad && parts.length && !/^(rgb|color\(|#|transparent)/.test(parts[0])) parts.shift();
    var stops = [];
    parts.forEach(function (p, i) {
      var c = parseColor(p); if (!c) { if (/transparent/.test(p)) c = [0, 0, 0, 0]; else return; }
      var pm = /\)\s*(-?[\d.]+)%/.exec(p) || /transparent\s+(-?[\d.]+)%/.exec(p);
      stops.push([pm ? parseFloat(pm[1]) / 100 : null, c]);
    });
    if (!stops.length) return true;
    stops.forEach(function (s, i) { if (s[0] == null) s[0] = stops.length === 1 ? 0 : i / (stops.length - 1); });
    var gr;
    if (lin) {
      var r = (ang - 90) * Math.PI / 180, cx = x + w / 2, cy = y + h / 2;
      var L = Math.abs(w * Math.sin(ang * Math.PI / 180)) + Math.abs(h * Math.cos(ang * Math.PI / 180));
      var dx = Math.cos(r) * L / 2, dy = Math.sin(r) * L / 2;
      gr = g.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
    } else {
      gr = g.createRadialGradient(x + w / 2, y + h / 2, 0, x + w / 2, y + h / 2, Math.max(w, h) / 2);
    }
    stops.forEach(function (s) { gr.addColorStop(Math.max(0, Math.min(1, s[0])), css(s[1], alpha)); });
    g.fillStyle = gr;
    return true;
  }
  function imageFor(url) {
    var im = IMG[url];
    if (!im) { im = IMG[url] = new Image(); im.decoding = 'async'; im.onload = function () { markDirty(); }; im.src = url; }
    return im.complete && im.naturalWidth ? im : null;
  }
  function drawCover(g, im, x, y, w, h, fit, iw, ih) {
    iw = iw || im.naturalWidth || im.width; ih = ih || im.naturalHeight || im.height;
    if (!iw || !ih) return;
    if (fit === 'cover' || fit === 'contain') {
      var k = fit === 'cover' ? Math.max(w / iw, h / ih) : Math.min(w / iw, h / ih);
      var dw = iw * k, dh = ih * k;
      g.drawImage(im, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    } else g.drawImage(im, x, y, w, h);
  }
  function paintBox(g, el, cs, r, alpha) {
    var x = r.left, y = r.top, w = r.width, h = r.height, rad = radiusOf(cs, w, h);
    var bg = parseColor(cs.backgroundColor);
    if (bg && bg[3] > 0.01) { rr(g, x, y, w, h, rad); g.fillStyle = css(bg, alpha); g.fill(); }
    var bi = cs.backgroundImage;
    if (bi && bi !== 'none') {
      var layers = splitTop(bi);
      for (var i = layers.length - 1; i >= 0; i--) {
        var L = layers[i];
        if (L.indexOf('url(') === 0) {
          var u = /url\(["']?([^"')]+)["']?\)/.exec(L);
          var im = u && imageFor(u[1]);
          if (im) { g.save(); rr(g, x, y, w, h, rad); g.clip(); g.globalAlpha = alpha; drawCover(g, im, x, y, w, h, /contain/.test(cs.backgroundSize) ? 'contain' : 'cover'); g.restore(); }
        } else if (paintGradient(g, L, x, y, w, h, alpha)) { rr(g, x, y, w, h, rad); g.fill(); }
      }
    }
    var bw = parseFloat(cs.borderTopWidth) || 0;
    if (bw > 0.4) {
      var bc = parseColor(cs.borderTopColor);
      if (bc && bc[3] > 0.05) { rr(g, x + bw / 2, y + bw / 2, w - bw, h - bw, Math.max(0, rad - bw / 2)); g.lineWidth = bw; g.strokeStyle = css(bc, alpha); g.stroke(); }
    }
    return rad;
  }
  var range = null;
  function paintText(g, node, cs, alpha) {
    var t = node.nodeValue; if (!t || !/\S/.test(t)) return;
    var col = parseColor(cs.color); if (!col || col[3] < 0.05) return;
    if (!range) range = doc.createRange();
    range.selectNodeContents(node);
    var rects = range.getClientRects();
    if (!rects.length) return;
    var fs = parseFloat(cs.fontSize) || 15;
    g.fillStyle = css(col, alpha);
    if (rects.length === 1) {
      var b = rects[0]; if (b.width < 1) return;
      g.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + fs + 'px ' + cs.fontFamily;
      g.textBaseline = 'middle';
      g.fillText(t.trim(), b.left, b.top + b.height / 2, b.width + 2);
      return;
    }
    /* 多行：画成与字同色、约字高 55% 的条，模糊后与真字的观感一致 */
    g.globalAlpha = 0.55;
    for (var i = 0; i < rects.length; i++) { var q = rects[i]; if (q.width > 1) g.fillRect(q.left, q.top + (q.height - fs * 0.6) / 2, q.width, fs * 0.6); }
    g.globalAlpha = 1;
  }
  function walk(g, el, alpha, depth) {
    if (depth > 40) return;
    if (el.hasAttribute && el.hasAttribute('data-lg-skip')) return;
    /* 第 277 次：先按矩形裁掉快照段 / 条带之外的整棵子树，再取计算样式（局部重拍时大部分节点只付一次 getBoundingClientRect） */
    var r = el.getBoundingClientRect();
    if (depth > 0 && (r.bottom < cullTop || r.top > cullBot)) return;
    var cs = global.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    var pos = cs.position;
    if (pos === 'fixed' || pos === 'sticky') return;  /* 视口坐标 / 吸附的东西不进整页快照（多是 dock 上方的主按钮条） */
    var op = parseFloat(cs.opacity); if (!(op >= 0)) op = 1;
    alpha *= op; if (alpha < 0.03) return;
    stats.nodes++;
    var tag = el.tagName;
    var rad = 0;
    if (r.width > 0.5 && r.height > 0.5) {
      rad = paintBox(g, el, cs, r, alpha);
      if (tag === 'IMG') {
        if (el.complete && el.naturalWidth) { g.save(); rr(g, r.left, r.top, r.width, r.height, rad); g.clip(); g.globalAlpha = alpha; try { drawCover(g, el, r.left, r.top, r.width, r.height, cs.objectFit); } catch (e) { /* 解码中 */ } g.restore(); }
        return;
      }
      if (tag === 'CANVAS') {
        if (el.width && el.height && !el.classList.contains('lg-gl')) { g.save(); g.globalAlpha = alpha; try { g.drawImage(el, r.left, r.top, r.width, r.height); } catch (e) { /* */ } g.restore(); }
        return;
      }
      if (tag === 'svg' || tag === 'SVG') {
        /* 图标：画成同色淡块（模糊后就是图标的一团颜色） */
        var ic = parseColor(cs.color);
        if (ic && r.width <= 64 && r.height <= 64) { rr(g, r.left + r.width * 0.18, r.top + r.height * 0.18, r.width * 0.64, r.height * 0.64, r.width * 0.2); g.fillStyle = css(ic, alpha * 0.32); g.fill(); }
        return;
      }
      if (tag === 'VIDEO' || tag === 'AUDIO' || tag === 'IFRAME') return;
    }
    var clip = (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') && r.width > 0.5;
    if (clip) { g.save(); rr(g, r.left, r.top, r.width, r.height, rad); g.clip(); }
    for (var c = el.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 1) walk(g, c, alpha, depth + 1);
      else if (c.nodeType === 3) paintText(g, c, cs, alpha);
    }
    if (clip) g.restore();
  }

  /* 视口底色条（视口坐标）：先铺 body 背景，再盖 dock 之下的全屏层（白噪音播放页等）。
     第 277 次：范围 = 所有在场玻璃面采样范围的并集（只有 dock 时与第 275 次相同；顶部提示岛出现时扩到顶上） */
  function stripRegion() {
    var rs = [];
    if (bar) rs.push(bar.getBoundingClientRect());
    for (var k in surf) if (surf[k].el && surf[k].el.isConnected) rs.push(surf[k].el.getBoundingClientRect());
    if (fz && fz.ext) rs.push({ left: fz.ext.x, top: fz.ext.y, right: fz.ext.x + fz.ext.w, bottom: fz.ext.y + fz.ext.h, width: fz.ext.w });   /* 第 320 次：记录条在 dock 上方 */
    var m = BAND + 24, vw = global.innerWidth, vh = global.innerHeight;
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    rs.forEach(function (r) { if (r.width < 1) return; x0 = Math.min(x0, r.left - m); y0 = Math.min(y0, r.top - m); x1 = Math.max(x1, r.right + m); y1 = Math.max(y1, r.bottom + m); });
    if (x0 > x1) { x0 = 0; y0 = 0; x1 = vw; y1 = vh; }
    /* dock 上方的融合颈部也要有底色 */
    y0 -= FUSE_EXT;
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(vw, x1); y1 = Math.min(vh, y1);
    return { x: x0, y: y0, w: Math.max(2, x1 - x0), h: Math.max(2, y1 - y0) };
  }
  function stripCovers(g) {
    var s = stripMeta;
    return g.x >= s.x - 1 && g.y >= s.y - 1 && g.x + g.w <= s.x + s.w + 1 && g.y + g.h <= s.y + s.h + 1;
  }
  function rasterStrip() {
    var g = stripRegion(), x = g.x, y = g.y, w = g.w, h = g.h;
    var W = Math.max(2, Math.ceil(w * S_MAX)), H = Math.max(2, Math.ceil(h * S_MAX));
    if (stripCv.width !== W || stripCv.height !== H) { stripCv.width = W; stripCv.height = H; } else { sctx.setTransform(1, 0, 0, 1, 0, 0); sctx.clearRect(0, 0, W, H); }
    sctx.setTransform(W / w, 0, 0, H / h, -x * W / w, -y * H / h);
    var vw = global.innerWidth, vh = global.innerHeight;
    var hb = global.getComputedStyle(doc.documentElement), bcs = global.getComputedStyle(doc.body);
    var c0 = parseColor(hb.backgroundColor); if (c0 && c0[3] > 0) { sctx.fillStyle = css(c0); sctx.fillRect(0, 0, vw, vh); }
    var c1 = parseColor(bcs.backgroundColor); if (c1 && c1[3] > 0) { sctx.fillStyle = css(c1); sctx.fillRect(0, 0, vw, vh); }
    var bi = bcs.backgroundImage;
    if (bi && bi !== 'none') { var L = splitTop(bi); for (var i = L.length - 1; i >= 0; i--) if (paintGradient(sctx, L[i], 0, 0, vw, vh, 1)) sctx.fillRect(0, 0, vw, vh); }
    /* dock 之下（z-index < 10）的全屏 fixed 层：盖住就整块不透明，整页快照不再参与 */
    var opaque = false;
    var cand = doc.querySelectorAll('body > .wn-player.open');
    for (var k = 0; k < cand.length; k++) {
      var el = cand[k], r = el.getBoundingClientRect();
      if (r.width < vw * 0.9 || r.height < vh * 0.9) continue;
      sctx.save(); sctx.setTransform(W / w, 0, 0, H / h, -x * W / w, -y * H / h);
      walkFixed(sctx, el, 1, 0);
      sctx.restore();
      opaque = true;
    }
    /* 浏览器里（非主屏应用）页底还有一条 body::after 渐隐带（z 9，盖在内容上、dock 之下），按解析式在着色器里叠 */
    var fade = null;
    try {
      var ac = global.getComputedStyle(doc.body, '::after');
      if (ac.display !== 'none' && ac.content !== 'none' && !opaque) {
        var fh = parseFloat(ac.height) || 0, stops = /linear-gradient\((.*)\)$/.exec(ac.backgroundImage || '');
        var cols = stops ? splitTop(stops[1]).map(parseColor).filter(Boolean) : [];
        var fc = cols.length ? cols[cols.length - 1] : null;
        if (fh > 0 && fc) fade = { top: vh - fh, h: fh * 0.78, c: fc };
      }
    } catch (eF) { /* */ }
    /* 第 320 次：原第 282 次「页面底部主按钮底衬（#view .mod-cta::before）」的渐隐叠加已删——底衬本身已去掉，记录条是玻璃，dock 后面就是滚动内容 */
    stripMeta = { x: x, y: y, w: w, h: h, opaque: opaque, fade: fade };
    stats.strips++;
  }
  function walkFixed(g, el, alpha, depth) {
    /* 与 walk 相同，但 fixed 层本身要画（它就在视口坐标里） */
    var cs = global.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || depth > 30) return;
    var r = el.getBoundingClientRect();
    var op = parseFloat(cs.opacity); if (!(op >= 0)) op = 1; alpha *= op;
    var rad = paintBox(g, el, cs, r, alpha);
    for (var c = el.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 1) {
        var ccs = global.getComputedStyle(c);
        if (ccs.position === 'fixed' || ccs.position === 'absolute') walkFixed(g, c, alpha, depth + 1); else walk(g, c, alpha, depth + 1);
      } else if (c.nodeType === 3) paintText(g, c, cs, alpha);
    }
    return rad;
  }

  /* 只拍「当前视口上方 0.75 屏 ~ 下方 1.75 屏」这一段，纹理尺寸基本固定、可原地复用；
     滚出这段时停下再重拍（期间边缘折射淡出，中间照旧是实时模糊） */
  var WIN_UP = 0.75, WIN_DOWN = 1.75;
  var cullTop = -1e9, cullBot = 1e9;
  function rasterRoots(g) {
    var roots = [doc.querySelector('#app > .app-header'), doc.getElementById('view')];
    for (var i = 0; i < roots.length; i++) if (roots[i]) walk(g, roots[i], 1, 0);
  }
  function rasterPage() {
    var de = doc.documentElement, vh = global.innerHeight;
    var dh = Math.max(de.scrollHeight, vh), dw = Math.max(de.clientWidth || global.innerWidth, 1);
    var sx = global.scrollX || global.pageXOffset || 0, sy = global.scrollY || global.pageYOffset || 0;
    var y0 = Math.max(0, Math.floor(sy - WIN_UP * vh)), y1 = Math.min(dh, Math.ceil(sy + WIN_DOWN * vh));
    var hh = Math.max(1, y1 - y0);
    var s = Math.min(S_MAX, TEX_MAX / hh);
    var W = Math.max(2, Math.ceil(dw * s)), H = Math.max(2, Math.ceil(Math.ceil((WIN_UP + WIN_DOWN) * vh) * s));
    if (pageCv.width !== W || pageCv.height !== H) { pageCv.width = W; pageCv.height = H; } else { pctx.setTransform(1, 0, 0, 1, 0, 0); pctx.clearRect(0, 0, W, H); }
    /* 元素用 getBoundingClientRect（视口坐标）画：视口 y → 整页 y（+sy）→ 本段 y（-y0） */
    pctx.setTransform(s, 0, 0, s, sx * s, (sy - y0) * s);
    cullTop = y0 - sy - 160; cullBot = y1 - sy + 160;   /* 视口坐标下的裁剪范围（留 160px 给溢出的子元素） */
    rasterRoots(pctx);
    cullTop = -1e9; cullBot = 1e9;
    pageMeta = { w: W, h: H, s: s, y0: y0, y1: y1, sx: sx };
    pend.length = 0; stale.length = 0;
  }
  /* 第 277 次：局部重拍——只重画页面 y ∈ [a, b] 这一条（整页坐标），并只把这几行传进纹理 */
  function rasterStripe(a, b) {
    var pm = pageMeta, s = pm.s;
    var sx = global.scrollX || 0, sy = global.scrollY || 0;
    if (Math.abs(sx - (pm.sx || 0)) > 0.5) return false;
    var r0 = Math.max(0, Math.floor((a - pm.y0) * s)), r1 = Math.min(pm.h, Math.ceil((b - pm.y0) * s));
    if (r1 - r0 < 1) return true;
    pctx.save();
    pctx.setTransform(1, 0, 0, 1, 0, 0);
    pctx.beginPath(); pctx.rect(0, r0, pm.w, r1 - r0); pctx.clip();
    pctx.clearRect(0, r0, pm.w, r1 - r0);
    pctx.setTransform(s, 0, 0, s, sx * s, (sy - pm.y0) * s);
    /* 视口坐标下的条带范围；子树按它裁剪（留 160px 给溢出的子元素），画出去的部分被 clip 掉 */
    cullTop = r0 / s + pm.y0 - sy - 160; cullBot = r1 / s + pm.y0 - sy + 160;
    rasterRoots(pctx);
    cullTop = -1e9; cullBot = 1e9;
    pctx.restore();
    var data = pctx.getImageData(0, r0, pm.w, r1 - r0);
    gl.bindTexture(gl.TEXTURE_2D, texP);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, r0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    stats.stripeRows += r1 - r0;
    return true;
  }
  /* 页面坐标范围：当前视口里所有玻璃面的采样范围（它们是 fixed，换算成整页 y） */
  function hotRanges() {
    var sy = global.scrollY || 0, out = [];
    var add = function (r, up) { if (r && r.height > 0) out.push([r.top - HOT_M - (up || 0) + sy, r.bottom + HOT_M + sy]); };
    if (bar) add(bar.getBoundingClientRect(), FUSE_EXT);
    if (fz && fz.ext) add({ top: fz.ext.y, bottom: fz.ext.y + fz.ext.h, height: fz.ext.h });
    for (var k in surf) if (surf[k].el && surf[k].el.isConnected && !surf[k].el.hidden) add(surf[k].el.getBoundingClientRect());
    return out;
  }
  function overlaps(a, list) { for (var i = 0; i < list.length; i++) if (a[0] < list[i][1] && a[1] > list[i][0]) return true; return false; }
  function mergeRanges(list) {
    list.sort(function (p, q) { return p[0] - q[0]; });
    var out = [];
    list.forEach(function (r) { var l = out[out.length - 1]; if (l && r[0] <= l[1] + 24) l[1] = Math.max(l[1], r[1]); else out.push([r[0], r[1]]); });
    return out;
  }
  /* 当前采样范围是否还在快照这一段里 */
  function inWin(r, up) {
    if (pageMeta.y1 == null || !r) return false;
    var sy = global.scrollY || 0, m = BAND + 16;
    var top = Math.max(0, r.top - m - (up || 0) + sy), bot = r.bottom + m + sy;   /* 页面顶上方没有内容，不算出界 */
    var dh = doc.documentElement.scrollHeight;
    return top >= pageMeta.y0 - 1 && (bot <= pageMeta.y1 + 1 || pageMeta.y1 >= dh - 1);
  }
  function inWindow() { return !!bar && inWin(bar.getBoundingClientRect()); }

  /* ---------- WebGL ---------- */
  var VS = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';
  var FS = [
    'precision highp float;',
    'uniform sampler2D uP,uB;uniform vec2 uCv,uPS,uScroll,uL;uniform vec4 uBox,uStrip,uTint,uFade,uA,uBr,uCut,uT;uniform vec3 uFadeC;',
    'uniform float uTaps,uS,uY0,uPageOn,uBand,uAmt,uDisp,uBlur,uSpec,uRim,uDbg,uRA,uRB,uK,uHasB,uRC,uHasCut,uFill,uRT,uHasT,uBandB,uLM,uLG;uniform vec4 uLine;',
    /* 第 312 次：uD = Snell 位移表（128×1，glass-optics.js 同一张）；uI = dock 图标层（栏内坐标）；uTone = 色调曲线线性近似（与 CSS 一致）；
       uSS = 高光处提饱和；uLR = 透镜 rim（bezel、左右、上下最大位移）；uSW = rim 白光强度 */
    'uniform sampler2D uD,uI;uniform vec3 uTone,uLR;uniform vec4 uIB;uniform float uHasI,uSS,uSW;',
    /* 第 313 次：uMagI = 透镜内部背景放大倍数；uLB = 透镜玻璃体提亮（x = 混白比例，y = 乘数）；uLA = 透镜整体不透明度（跟透镜元素一起淡出） */
    'uniform float uMagI,uLA;uniform vec2 uLB;',
    /* 第 314 次：uLX = (运动方向×速度 hl, 按下亮弧 flash, 与 dock 的融合半径 fuse, 形变速度 a)；uLO = (投影浓度, 外沿细描边, —) */
    'uniform vec4 uLX;uniform vec3 uLO;',
    /* 第 319 次：uDS = (栏中心 x, y, 整条 dock 按下缩放 ds)——画布作为栏的子节点被合成器整块放大，透镜里按视觉位置取样，内部看起来仍是 0.97×（透镜外不重新取样） */
    'uniform vec3 uDS;',
    /* 第 322 次（A3）：uEP = (栏端外凸量，带符号：右端 + / 左端 −；透镜 × dock 专用 k_end；—；—)。0 = 不外凸 */
    'uniform vec4 uEP;',
    /* 第 327 次：uPX = (每 CSS px 的画布像素数 = 1 物理像素的倒数, 深色 0/1)——抗锯齿 / 描边 / 亮边按物理像素算 */
    'uniform vec2 uPX;',
    /* 第 327 次：轮廓抗锯齿 = 1 物理像素，按距离场梯度归一化（smooth-min 颈部 |∇f| < 1）；融合颈部（并集比两块原形状都深的地方）放宽到 2.5 物理像素，细颈不闪 */
    'float aaC(float sd,float g,float kn){return clamp(.5-sd*uPX.x/(max(g,.5)*mix(1.,2.5,clamp(kn/6.,0.,1.))),0.,1.);}',
    /* 第 327 次：1 物理像素暗描边（浅色，端帽重、直边轻）/ 深色 .16 亮细线；dn = 离轮廓的距离（CSS px，已按梯度归一化） */
    'vec3 hair(vec3 c,float dn,float nx){float w=1.-smoothstep(0.,1./uPX.x,dn);if(uPX.y>.5)return mix(c,vec3(1.),.16*w);return c*(1.-mix(.12,.30,smoothstep(.5,.95,abs(nx)))*w);}',
    'vec3 lbody(vec3 c){return min(mix(c*uLB.y,vec3(1.),uLB.x),1.);}',
    'float tabl(float t){return t>=1.?0.:texture2D(uD,vec2((clamp(t,0.,1.)*126.+.5)/128.,.5)).r;}',
    'vec3 satv(vec3 c,float s){float l=dot(c,vec3(.2126,.7152,.0722));return clamp(mix(vec3(l),c,s),0.,1.);}',
    'vec3 tone(vec3 c){return satv(clamp(((c-.5)*uTone.x+.5)*uTone.y,0.,1.),uTone.z);}',
    /* Glass-HQ regular 的「23px 宽模糊 lighten 混 34%」（深色 darken 65%）：6 个点的宽环平均，压掉背后深色字的斑块 */
    'uniform vec2 uWF;',
    /* 第 317 次：gIc = 图标层相对背景取样点的偏移——背景在透镜里缩小 uMagI（0.97），彩色图标层不缩（支付宝 16:57 透镜里「推荐」圆钮内外同为 110px） */
    'vec2 gIc=vec2(0.);',
    'vec4 icon(vec2 p){if(uHasI<.5)return vec4(0.);p+=gIc;vec2 q=(p-uIB.xy)/uIB.zw;if(q.x<0.||q.y<0.||q.x>1.||q.y>1.)return vec4(0.);return texture2D(uI,q);}',
    'float sdR(vec2 p,vec2 b,float r){vec2 q=abs(p)-b+r;return length(max(q,0.))+min(max(q.x,q.y),0.)-r;}',
    'float sdBox(vec2 v,vec4 R,float r){return sdR(v-R.xy-R.zw*.5,R.zw*.5,r);}',
    /* smooth-min（多项式）：k=0 时就是普通并集 */
    'float smin(float a,float b,float k){if(k<=.01)return min(a,b);float h=clamp(.5+.5*(b-a)/k,0.,1.);return mix(b,a,h)-k*h*(1.-h);}',
    /* 第 322 次（A3）：一级 dock 的距离场 dk()——长按把透镜顶过端点时，栏端被拉出：在栏端放一颗 0.62 栏高的胶囊（外沿 = 栏端 + 外凸量），
       与 dock 用 k_end（10pt）smooth-min 并起来 = 栏端中间局部外凸、上下圆滑接回直边。只作用于「透镜 × 一级 dock」，二级融合程序（FSF）不用它 */
    'float dk(vec2 v){float a=sdBox(v,uA,uRA);if(abs(uEP.x)<.05)return a;float s=sign(uEP.x);float ex=s>0.?uA.x+uA.z:uA.x;float x0=ex-s*30.,x1=ex+uEP.x;float hh=uA.w*.62;vec4 P=vec4(min(x0,x1),uA.y+(uA.w-hh)*.5,abs(x1-x0),hh);return smin(a,sdBox(v,P,hh*.5),uEP.y);}',
    /* 融合半径只在两块玻璃的中线附近大（高斯衰减）：长而平的两条边之间不会整条糊成一块板，而是中间拉出一道颈 */
    'float field(vec2 v){float a=dk(v);if(uHasB<.5)return a;float cx=uBr.x+uBr.z*.5;float q=(v.x-cx)/(18.+uBr.z*.18);return smin(a,sdBox(v,uBr,uRB),uK*exp(-q*q));}',
    /* 第 314 次：透镜距离场——圆角矩形按 uniform 尺寸（形变后的宽高）现算；冒出 dock 的上下部分与 dock 边做 smooth-min（metaball），
       接缝处是一道圆滑的「液体粘连」而不是两个形状硬叠（dock 里面仍用透镜本身的形状） */
    'float lf(vec2 v){float sL=sdBox(v,uT,uRT);if(uLX.z<.01)return sL;float sD=dk(v);return mix(sL,smin(sD,sL,uLX.z),smoothstep(-2.,2.,sD));}',
    'vec3 bg(vec2 v){',
    '  vec4 b=texture2D(uB,(v-uStrip.xy)/uStrip.zw);',
    '  vec4 p=texture2D(uP,(v+uScroll-vec2(0.,uY0))*uS/uPS)*uPageOn;',
    '  vec3 c=p.rgb+b.rgb*(1.-p.a);',
    '  float fa=uFade.w>0.&&uDbg<1.5?clamp((v.y-uFade.x)/uFade.y,0.,1.)*uFade.w:0.;',
    '  return mix(c,uFadeC,fa);}',
    'vec3 wfill(vec2 p,vec3 c){vec3 w=vec3(0.);for(int i=0;i<6;i++){float a=float(i)*1.0472+.4;w+=bg(p+vec2(cos(a),sin(a))*22.);}w/=6.;return mix(c,uWF.x>0.?max(c,w):min(c,w),abs(uWF.y));}',
    /* 第 309 次：透镜用的「场景」——栏里是毛玻璃（模糊 + 提饱和 + 栏底色），栏外是页面（略提亮提饱和，定稿 1.07 / 1.3），
       栏边一条细灰线（折进透镜后就是上下两条直线） */
    'vec3 lift(vec3 c){float l=dot(c,vec3(.2126,.7152,.0722));return clamp(mix(vec3(l),c,1.3)*1.07,0.,1.);}',
    /* 第 317 次：uDbg = 2 时透镜里直接显示原快照（不磨砂、不调色、不叠图标）——测试 / 对比图核对折射几何（横线是否仍直、缩放比例） */
    /* 第 319 次：gCh = 背景彩度系数（透镜上下边带 < 1，压掉彩色模糊带）；gDisp = dock 本体色散（只在左右两端） */
    'float gCh=1.,gDisp=0.;',
    'vec3 chc(vec3 c,float k){return mix(vec3(dot(c,vec3(.2126,.7152,.0722))),c,k);}',
    'vec3 scn(vec2 p){if(uDbg>1.5)return bg(p);float sa=dk(p);vec3 c;',
    /* 第 312 次：栏内 = 同 CSS 的磨砂（模糊 + 色调曲线近似 + 底色）再叠上 dock 图标层——透镜外沿往外取样时，邻近图标是被折弯进来的 */
    /* 第 319 次：透镜里不预模糊（原来 7 点 8px 模糊 + 22px 宽环：dock 上方那行字被糊成一团灰影进透镜）——单点取样，色调 / 栏底色仍与 dock 同一套（材质不变，只是不糊） */
    '  if(sa<0.){c=chc(mix(tone(bg(p)),uTint.rgb,uTint.a),gCh);vec4 ic=icon(p);c=c*(1.-ic.a)+ic.rgb;}',
    /* 第 313 次：栏外页面取样带一点十字预滤波；第 314 次：透镜改成往里取样（放大、不压缩），快照升到 0.75 倍，预滤波 1.5 → 0.8px，背后的字更清楚 */
    '  else{c=chc(lift(bg(p)),gCh);}',
    '  return mix(c,uLine.rgb,uLine.a*(1.-smoothstep(.15,.9,abs(sa))));}',
    /* 第 314 次：tw = 磨砂 / 色调权重——dock 外沿几 px 里模糊半径和色调都减轻（tw 0.5 → 1），被折弯的卡片字 / 色块边在边上看得清，往里平滑并回 CSS 磨砂 */
    'vec3 glass(vec2 v,vec2 o,float rad,float tw){',
    '  vec3 c=vec3(0.);float nt=0.;',
    '  for(int i=0;i<9;i++){',
    '    if(float(i)>=uTaps)break;nt+=1.;',
    '    float a=float(i)*2.39996;float rr=i==0?0.:rad*sqrt(float(i)/(uTaps-1.));',
    '    vec2 k=vec2(cos(a),sin(a))*rr;',
    '    c.r+=bg(v+o*(1.+gDisp)+k).r;c.g+=bg(v+o+k).g;c.b+=bg(v+o*(1.-gDisp)+k).b;}',
    '  c/=nt;vec3 r=c;c=wfill(v+o,c);',
    '  return mix(mix(lift(r),uTint.rgb,uTint.a*.5),mix(tone(c),uTint.rgb,uTint.a),tw);}',
    'void main(){',
    '  vec2 v=uBox.xy+vec2(gl_FragCoord.x,uCv.y-gl_FragCoord.y)/uCv*uBox.zw;',
    '  vec2 e=vec2(.5,0.);',
    '  vec4 outc=vec4(0.);',
    /* 先用两块原形状粗筛：离所有边都远的像素（外面 / 深处）直接透明，不算并集、法线和 27 次采样 */
    '  bool inT=uHasT>.5&&v.x>uT.x-16.&&v.x<uT.x+uT.z+16.&&v.y>uT.y-16.&&v.y<uT.y+uT.w+16.;',
    '  if(!inT&&uDbg<.5){',
    '    float qa=sdBox(v,uA,uRA),qb=uHasB>.5?sdBox(v,uBr,uRB):1e5;',
    '    if(min(qa,qb)>uK+.5||qa<-(uBand+7.)||qb<-(uBandB+7.)){gl_FragColor=vec4(0.);return;}',
    '  }',
    '  float sd=field(v);',
    '  float gm=1.,kn=0.;',
    '  if(abs(sd)<1.5){gm=length(vec2(field(v+e.xy)-field(v-e.xy),field(v+e.yx)-field(v-e.yx)));if(uHasB>.5){float mn0=min(dk(v),sdBox(v,uBr,uRB));kn=4.*max(mn0-sd,0.);}}',
    '  float aa=aaC(sd,gm,kn);',
    '  if(sd<.5){',
    '    float d=-sd,dn=d/max(gm,.5);',
    /* 两块玻璃各有自己的边带宽：离谁近用谁的（4px 内平滑过渡） */
    '    float band=uBand;if(uHasB>.5){float da=sdBox(v,uA,uRA),db=sdBox(v,uBr,uRB);band=mix(uBandB,uBand,smoothstep(-4.,4.,db-da));}',
    '    float al=(1.-smoothstep(band*.45,band+5.,d))*aa;',
    /* 融合颈部：在两块原形状之外、并集之内的部分没有 DOM 毛玻璃垫底，整块画满 */
    /* 第 322 次（A3）：栏端被拉出的那一截在 DOM 毛玻璃外面，GL 画满 */
    '    if(abs(uEP.x)>.05)al=max(al,smoothstep(-.5,.5,sdBox(v,uA,uRA))*aa);',
    '    if(uHasB>.5&&uFill>.5){float mn=min(sdBox(v,uA,uRA),sdBox(v,uBr,uRB));al=max(al,smoothstep(-.5,.5,mn)*aa*clamp(uK/6.,0.,1.));}',
    '    if(uHasCut>.5)al*=smoothstep(-.5,.5,sdBox(v,uCut,uRC));',
    '    if(uDbg>.5)al=aa;',
    '    if(al>.002){',
    '      vec2 n=normalize(vec2(field(v+e.xy)-field(v-e.xy),field(v+e.yx)-field(v-e.yx))+1e-5);',
    /* 第 312 次：凸 squircle + Snell 位移表，沿内法线「往里」取样（kube.io：凸面不会取到玻璃外面）；
       高光 = |n·L|² 的边缘 rim light，高光处背景提饱和 */
    '      float m=tabl(max(d,0.)/band)*uAmt;',
    /* 第 319 次：dock 本体色散只在左右两端（|n.x| 大），上下边不分 R/G/B；上下边外沿几 px 压彩度、高光处不再 7 倍提饱和——宝宝页紫卡片被折进上沿的五彩模糊带 */
    '      float wxD=smoothstep(.55,.85,abs(n.x));gDisp=uDisp*wxD;',
    '      float tw=mix(.8,1.,smoothstep(0.,band*.8,d));',
    '      vec3 c=glass(v,-n*m,uBlur*mix(.25,1.,smoothstep(0.,band*.7,d)),tw);',
    '      float ld=dot(n,uL);',
    '      float sk=pow(abs(ld),2.)*exp(-max(d,0.)/1.2);',
    '      c=mix(c,satv(c,mix(1.1,uSS,wxD)),clamp(sk*.6,0.,1.));',
    '      c=chc(c,1.-.5*(1.-wxD)*exp(-max(d,0.)/3.));',
    '      float sp=sk*uSpec;',
    /* 细光边（深色模式更亮）：迎光一侧亮、背光一侧弱 */
    '      float rim=(1.-smoothstep(0.,2./uPX.x,dn))*(.25+.75*pow(max(ld,0.),1.5))*uRim;',
    '      c=min(c+sp+rim*vec3(1.,.97,.92),1.);',
    '      c=hair(c,dn,n.x);',
    '      if(uDbg>.5)c=bg(v);',
    '      outc=vec4(c*al,al);',
    '    }',
    '  }',
    /* 第 309 次：拖动透镜（定稿第十四版）——中间 1:1：栏内透明（下面就是 DOM 的毛玻璃和原位图标），栏外照原样画页面（盖住栏的投影，不出灰团）；
       只有外沿 rb≈7px 一圈折射：沿外法线往外取样 17px（左右）/ 30px（上下）× t^(1.6+0.8|ny|)，R/G/B 按 IOR 1.47/1.5/1.535 分开（chx 9→18 随速度） */
    /* 第 314 次：液态透镜——清透的凸透镜：
       · （第 317 次改：中心缩小 0.97、行对齐往外取样，见下方 tx/ty）中心以透镜中心放大 uMagI（1.15，快拖 +0.06），dock 范围里看到的是 dock 的磨砂 + 透镜图标层（彩色图标 + 选中色文字），冒出 dock 的部分是页面；
       · 外沿 bezel uLR.x（14px）内沿内法线往里取样（同一张 Snell 表，左右最多 18 / 上下 11px，快拖 ×1.35）：靠边的内容被拉长、翻折成拉丝带，
         栏边细线 / 卡片字在透镜边上明显弯进来；R/B 两通道的偏移差只有 4%~13%（随速度），色散只在边上、保持淡；
       · 形状 = lf()：形变后的圆角矩形 + 冒出部分与 dock 的 smooth-min 融合；
       · 高光：迎光 |n·L|²，光向随运动方向偏（uLX.x），随速度增强；按下时顶部一道亮弧（uLX.y）；四周 14px 一圈柔和投影。 */
    '  if(uHasT>.5){',
    '    float st=lf(v);',
    '    if(st<.5){',
    '      vec2 gt=vec2(lf(v+e.xy)-lf(v-e.xy),lf(v+e.yx)-lf(v-e.yx));float gtm=max(length(gt),.5);',
    '      float dt=-st,at=clamp(.5-st*uPX.x/gtm,0.,1.),dtn=dt/gtm;',
    '      vec2 nt=normalize(gt+1e-5);',
    '      vec2 c0=uT.xy+uT.zw*.5;',
    '      float B=max(2.,uLR.x*uLG);',
    /* 第 317 次：行对齐折射（对照支付宝 22:03 / 16:57、App Store 23:38 逐帧：背后的横线 / 一行字穿过透镜仍是水平直线，
       内部几乎 1:1 略缩小，只在左右两端水平压缩、上下边带竖直压缩）——
       · 内部：以透镜中心缩小 uMagI（0.97），取样点比像素离中心更远；
       · 横向位移只看「这一行里离左右边的距离」（xe = 本行透镜半宽，胶囊两端按圆弧算），纵向位移只看 y（离上下边的距离），与 x 无关 → 横线不弯；
       · 都往外取样（透镜外的内容被压进边带 = 缩小），取样点随像素单调外移，不翻折。 */
    '      vec2 hz=uT.zw*.5,q=v-c0;float rr=min(uRT,hz.y),ya=abs(q.y),yc=max(ya-(hz.y-rr),0.);',
    '      float xe=hz.x-rr+sqrt(max(rr*rr-yc*yc,0.));',
    '      float tx=tabl(clamp((xe-abs(q.x))/B,0.,1.)),ty=tabl(clamp((hz.y-ya)/B,0.,1.));',
    '      float tb=max(tx,ty);',
    '      vec2 base=uDS.xy+(c0-uDS.xy)*uDS.z+q*uDS.z/uMagI;',
    '      vec2 o=vec2(sign(q.x)*uLR.y*tx,sign(q.y)*uLR.z*ty)*(1.+.35*uLM)*uLG;',
    '      gIc=v-base;',
    '      vec3 lc;',
    /* 第 319 次：透镜色散只在左右两端（|n.x| > ~0.7），上下边带限制彩度（gCh） */
    '      float wx=smoothstep(.55,.85,abs(nt.x));gCh=1.-.55*(ty>tx?1.:0.)*(1.-wx);',
    '      if(tb>.01){vec3 ac=vec3(0.);float cs=.035*(1.2+2.4*uLM)*wx;',
    '        for(int j=0;j<2;j++){vec2 oo=o*(.94+.12*float(j));ac.r+=scn(base+oo*(1.-cs)).r;ac.g+=scn(base+oo).g;ac.b+=scn(base+oo*(1.+cs)).b;}',
    '        lc=ac*.5;}',
    '      else lc=scn(base);',
    '      gCh=1.;',
    '      lc=lbody(lc);',
    '      vec2 Ld=normalize(vec2(uL.x+1.6*uLX.x,uL.y));',
    '      float ndl=dot(nt,Ld);',
    /* 第 319 次：边宽 ~3pt → 1~1.5pt（亮边衰减 2.2 → 0.9px、亮弧 3.5 → 1.4px、暗描边 1.3 → 1px） */
    '      float edge=exp(-max(dt,0.)/.9);',
    /* 第 316 次：高光 / 亮弧 / 投影随鼓起比例渐显（gr）——按下第 1 帧透镜还是胶囊大小时就带满亮边和投影，像「啪」地换成一块玻璃；
       支付宝 22:03 第 133~136 帧胶囊先只是变大，第 137 帧鼓成透镜才有亮边 */
    '      float gr=smoothstep(.05,.5,uLG);',
    '      float sp=(.3+.7*pow(max(ndl,0.),2.)+.25*pow(max(-ndl,0.),3.))*edge*uSW*(1.+.9*uLM)*gr;',
    '      float arc=uLX.y*smoothstep(.15,.85,-nt.y)*exp(-max(dt,0.)/1.4)*.85*gr;',
    '      float sk=clamp(sp*1.4+arc,0.,1.);',
    '      lc=mix(lc,satv(lc,1.+uSS*.15),sk*.6);',
    '      lc=min(lc+vec3(sp+arc),1.);',
    '      lc=mix(lc,hair(lc,dtn,nt.x),gr);',
    '      float la=at*uLA;',
    '      outc=vec4(lc,1.)*la+outc*(1.-la);',
    '    }else if(uLO.x>0.){',
    '      float ss=sdBox(v-vec2(0.,3.5),uT,uRT);',
    '      float sa=uLO.x*exp(-max(ss,0.)/5.)*(1.-smoothstep(6.,13.,ss))*uLA*smoothstep(-.5,.5,st)*smoothstep(.05,.5,uLG);',
    '      outc=vec4(outc.rgb*(1.-sa),outc.a+sa*(1.-outc.a));',
    '    }',
    '  }',
  '  gl_FragColor=outc;}'
  ].join('\n');
  /* 第 320 次：二级页融合玻璃（DockFuse）——单独一个程序（不往主着色器里加 uniform：iOS WebGL1 片元 uniform 只保证 64 个 vec4）。
     最多 5 块圆角矩形（返回钮 / ＋ 钮 / 记录条最多两块 / 正在进行胶囊）写成同一个距离场：依次 smooth-min 并进来，每块自己的 k
     （静止时记录条和圆钮 k≈6 = 轻微黏连，分裂 / 下落时鼓到 12~16 再归零）。和一级 dock 同一套材质：边带 Snell 往里取样 + 色散只在两端 +
     迎光高光 + 细光边，只是中间也由 GL 画满（uFA = 1，DOM 只放按钮和文字）；色调按块混（中性玻璃 uTint ↔ 模块色调 uFT，权重随离哪块近）。
     uFP[i] = (圆角, 并入 k, 色调比例, 不透明度)；uFQ[i] = (按下提亮, 边带宽, —, —)。uFA < 1 = 只剩边带（合拢回一级页时和 CSS 毛玻璃交叉淡出）。 */
  var FSF = [
    'precision highp float;',
    'uniform sampler2D uP,uB,uD;uniform vec2 uCv,uPS,uScroll,uL,uWF;uniform vec4 uBox,uStrip,uTint,uFade;uniform vec3 uFadeC,uTone;',
    'uniform float uTaps,uS,uY0,uPageOn,uAmt,uDisp,uBlur,uSpec,uRim,uDbg,uSS;uniform vec4 uLine;',
    'uniform float uFN,uFA,uSh;uniform vec4 uFR[5],uFP[5],uFQ[5],uFT;',
    'uniform vec2 uPX;',
    'float tabl(float t){return t>=1.?0.:texture2D(uD,vec2((clamp(t,0.,1.)*126.+.5)/128.,.5)).r;}',
    'vec3 satv(vec3 c,float s){float l=dot(c,vec3(.2126,.7152,.0722));return clamp(mix(vec3(l),c,s),0.,1.);}',
    'vec3 tone(vec3 c){return satv(clamp(((c-.5)*uTone.x+.5)*uTone.y,0.,1.),uTone.z);}',
    'float sdR(vec2 p,vec2 b,float r){vec2 q=abs(p)-b+r;return length(max(q,0.))+min(max(q.x,q.y),0.)-r;}',
    'float sdBox(vec2 v,vec4 R,float r){return sdR(v-R.xy-R.zw*.5,R.zw*.5,r);}',
    'float smin(float a,float b,float k){if(k<=.01)return min(a,b);float h=clamp(.5+.5*(b-a)/k,0.,1.);return mix(b,a,h)-k*h*(1.-h);}',
    'vec3 bg(vec2 v){',
    '  vec4 b=texture2D(uB,(v-uStrip.xy)/uStrip.zw);',
    '  vec4 p=texture2D(uP,(v+uScroll-vec2(0.,uY0))*uS/uPS)*uPageOn;',
    '  vec3 c=p.rgb+b.rgb*(1.-p.a);',
    '  float fa=uFade.w>0.?clamp((v.y-uFade.x)/uFade.y,0.,1.)*uFade.w:0.;',
    '  return mix(c,uFadeC,fa);}',
    'vec3 wfill(vec2 p,vec3 c){vec3 w=vec3(0.);for(int i=0;i<6;i++){float a=float(i)*1.0472+.4;w+=bg(p+vec2(cos(a),sin(a))*22.);}w/=6.;return mix(c,uWF.x>0.?max(c,w):min(c,w),abs(uWF.y));}',
    'vec3 lift(vec3 c){float l=dot(c,vec3(.2126,.7152,.0722));return clamp(mix(vec3(l),c,1.3)*1.07,0.,1.);}',
    'vec3 chc(vec3 c,float k){return mix(vec3(dot(c,vec3(.2126,.7152,.0722))),c,k);}',
    'float ff(vec2 v){float f=1e5;for(int i=0;i<5;i++){if(float(i)>=uFN)break;float s=sdBox(v,uFR[i],uFP[i].x);f=i==0?s:smin(f,s,uFP[i].y);}return f;}',
    /* 第 327 次：同时给出各块原形状的最小距离（颈部 = 并集比它们都深的部分） */
    'float ffm(vec2 v,out float mn){float f=1e5;mn=1e5;for(int i=0;i<5;i++){if(float(i)>=uFN)break;float s=sdBox(v,uFR[i],uFP[i].x);mn=min(mn,s);f=i==0?s:smin(f,s,uFP[i].y);}return f;}',
    'vec3 hair(vec3 c,float dn,float nx){float w=1.-smoothstep(0.,1./uPX.x,dn);if(uPX.y>.5)return mix(c,vec3(1.),.16*w);return c*(1.-mix(.12,.30,smoothstep(.5,.95,abs(nx)))*w);}',
    /* 同一套磨砂：色散只在 gd > 0 时三通道分采（中间一块一次采样，省 2/3） */
    'vec3 glass(vec2 v,vec2 o,float rad,float tw,vec4 T,float gd,float tp,float wf){',
    '  vec3 c=vec3(0.);float nt=0.;',
    '  for(int i=0;i<9;i++){',
    '    if(float(i)>=tp)break;nt+=1.;',
    '    float a=float(i)*2.39996;float rr=i==0?0.:rad*sqrt(float(i)/(tp-1.));',
    '    vec2 k=vec2(cos(a),sin(a))*rr;',
    '    if(gd>.001){c.r+=bg(v+o*(1.+gd)+k).r;c.g+=bg(v+o+k).g;c.b+=bg(v+o*(1.-gd)+k).b;}else c+=bg(v+o+k);}',
    '  c/=nt;vec3 r=c;if(wf>.5)c=wfill(v+o,c);',
    '  return mix(mix(lift(r),T.rgb,T.a*.5),mix(tone(c),T.rgb,T.a),tw);}',
    'void main(){',
    '  vec2 v=uBox.xy+vec2(gl_FragCoord.x,uCv.y-gl_FragCoord.y)/uCv*uBox.zw;',
    '  float mn0;float sd=ffm(v,mn0);',
    /* 外面一圈柔和投影（向下 4px，与一级 dock 的 CSS 投影同一档；DOM 在 GL 模式下不画投影） */
    '  if(sd>.5){if(uSh<.001||sd>10.){gl_FragColor=vec4(0.);return;}float ss=ff(v-vec2(0.,4.));float sa=uSh*exp(-max(ss,0.)/3.)*(1.-smoothstep(2.,8.,ss))*smoothstep(.5,1.5,sd);gl_FragColor=vec4(0.,0.,0.,sa);return;}',
    '  float ws=0.,tm=0.,am=0.,lf=0.,bd=0.;',
    '  for(int i=0;i<5;i++){if(float(i)>=uFN)break;float s=sdBox(v,uFR[i],uFP[i].x);float w=exp(-max(s,0.)*.3)*(s<0.?3.:1.)+1e-4;',
    '    ws+=w;tm+=w*uFP[i].z;am+=w*uFP[i].w;lf+=w*uFQ[i].x;bd+=w*uFQ[i].y;}',
    '  tm/=ws;am/=ws;lf/=ws;bd/=ws;',
    '  vec4 T=mix(uTint,uFT,tm);',
    '  float d=-sd,band=max(2.,bd);',
    '  vec2 e=vec2(.5,0.);',
    '  vec2 g0=abs(sd)<1.5||d<=band+6.?vec2(ff(v+e.xy)-ff(v-e.xy),ff(v+e.yx)-ff(v-e.yx)):vec2(0.,-1.);',
    '  float gm=max(length(g0),.5),kn=4.*max(mn0-sd,0.);',
    '  float aa=clamp(.5-sd*uPX.x/(gm*mix(1.,2.5,clamp(kn/6.,0.,1.))),0.,1.),dn=d/gm;',
    '  float al=aa*mix(1.-smoothstep(band*.45,band+5.,d),1.,uFA)*am;',
    '  if(uDbg>.5)al=aa;',
    '  if(al<.002){gl_FragColor=vec4(0.);return;}',
    /* 第 320 次：边带以内很深的地方（离边 > 边带 + 6）折射位移、高光、亮边、色散都是 0——不算法线（省 4 次距离场）、少取样（带色调的记录条中间背景只占 14~18%：3 次采样、不做邻域填充） */
    '  bool deep=d>band+6.;',
    '  vec2 n=deep?vec2(0.,-1.):normalize(g0+1e-5);',
    '  float m=deep?0.:tabl(max(d,0.)/band)*uAmt;',
    '  float wxD=deep?0.:smoothstep(.55,.85,abs(n.x));',
    '  float tp=deep?(tm>.5?3.:min(uTaps,5.)):uTaps;',
    /* 带色调的记录条：边带里色调只淡一点（.85 → 1，3px 内回满），不再是一圈发白的晕；中性玻璃同一级 dock（.5 → 1） */
    '  float tw=mix(mix(.8,1.,smoothstep(0.,band*.8,d)),mix(.86,1.,smoothstep(0.,3.,d)),tm);',
    '  vec3 c=glass(v,-n*m,uBlur*mix(.25,1.,smoothstep(0.,band*.7,d)),tw,T,uDisp*wxD*(1.-tm*.6),tp,(deep&&tm>.5)?0.:1.);',
    '  float ld=dot(n,uL);',
    '  float sk=pow(abs(ld),2.)*exp(-max(d,0.)/1.2);',
    '  c=mix(c,satv(c,mix(1.1,uSS,wxD)),clamp(sk*.6,0.,1.)*(1.-tm));',
    '  c=chc(c,1.-.5*(1.-wxD)*exp(-max(d,0.)/3.)*(1.-tm));',
    '  float sp=sk*uSpec;',
    '  float rim=(1.-smoothstep(0.,2./uPX.x,dn))*(.25+.75*pow(max(ld,0.),1.5))*uRim;',
    '  c=min(c+sp+rim*vec3(1.,.97,.92),1.);',
    '  c=hair(c,dn,n.x);',
    '  c=mix(c,vec3(1.),lf*.1);',
    '  if(uDbg>.5)c=bg(v);',
    '  gl_FragColor=vec4(c*al,al);}'
  ].join('\n');
  var progF = null, UF = {}, fzErr = '', fzWarm = false;
  var UNI = ['uP', 'uB', 'uCv', 'uPS', 'uScroll', 'uL', 'uBox', 'uStrip', 'uTint', 'uFade', 'uA', 'uBr', 'uCut', 'uT', 'uFadeC', 'uTaps', 'uS', 'uY0', 'uPageOn', 'uBand', 'uAmt', 'uDisp', 'uBlur', 'uSpec', 'uRim', 'uDbg',
    'uRA', 'uRB', 'uK', 'uHasB', 'uRC', 'uHasCut', 'uFill', 'uRT', 'uHasT', 'uBandB', 'uLM', 'uLG', 'uLine',
    'uD', 'uI', 'uTone', 'uLR', 'uIB', 'uHasI', 'uSS', 'uSW', 'uWF', 'uMagI', 'uLA', 'uLB', 'uLX', 'uLO', 'uDS', 'uEP', 'uPX'];
  var UNIF = ['uP', 'uB', 'uD', 'uCv', 'uPS', 'uScroll', 'uL', 'uWF', 'uBox', 'uStrip', 'uTint', 'uFade', 'uFadeC', 'uTone', 'uTaps', 'uS', 'uY0', 'uPageOn', 'uAmt', 'uDisp', 'uBlur', 'uSpec', 'uRim', 'uDbg', 'uSS', 'uLine',
    'uFN', 'uFA', 'uFR', 'uFP', 'uFQ', 'uFT', 'uSh', 'uPX'];

  function mkTex(aux) {
    /* 第 312 次：aux = 位移表 / 图标层这两张小纹理，单独计数（texLive / texCreated 仍只算整页快照 + 底色条两张） */
    var t = gl.createTexture();
    if (aux) stats.texAux = (stats.texAux || 0) + 1; else { stats.texCreated++; stats.texLive++; }
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    t._w = 0; t._h = 0;
    return t;
  }
  function upload(t, src) {
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    if (t._w === src.width && t._h === src.height) { gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, src); stats.uploadsSub++; }
    else { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src); t._w = src.width; t._h = src.height; stats.uploadsRealloc++; }
  }
  /* ---------- 第 328 次：Worker 渲染（录制代理 + 消息） ---------- */
  function setCv(W, H) {
    cvW = W; cvH = H;
    if (wm) { if (gl && gl._size) gl._size(W, H); }
    else { cv.width = W; cv.height = H; }
  }
  function workerWanted() {
    if (wNo) return false;
    try { if (global.localStorage.getItem('lgWorker') === '0') return false; } catch (e) { /* */ }
    if (global.__lgNoWorker) return false;
    return !!(global.Worker && global.OffscreenCanvas && global.HTMLCanvasElement && HTMLCanvasElement.prototype.transferControlToOffscreen && global.createImageBitmap && global.LensPhys);
  }
  /* 录制代理：和 WebGLRenderingContext 同样的调用，记下来按顺序发给 Worker。
     · 创建对象 / 取 uniform 位置同步返回句柄（{$: id} / {$u: [程序 id, 名字]}），Worker 端懒解析；编译 / 链接状态乐观返回 true，真错误由 Worker 回报（→ 退回主线程实现）。
     · 纹理源是画布 / 图片：createImageBitmap 转成 ImageBitmap（premultiply，对应原来的 UNPACK_PREMULTIPLY_ALPHA），等它好了再连同后面的命令一起发，顺序不乱
       （快照纹理与它对应的 uPS / uS / uY0 一定同一批到）；ImageData / 数组拷一份、buffer transferable。 */
  function mkProxy() {
    var P = {}, q = [], ids = 0, sched = false;
    var proto = global.WebGLRenderingContext && WebGLRenderingContext.prototype;
    if (proto) for (var k in proto) { if (/^[A-Z][A-Z0-9_]*$/.test(k)) { try { P[k] = proto[k]; } catch (e) { /* */ } } }
    function enc(a) {
      if (a && typeof a === 'object') {
        if (a.$ != null || a.$u) return a;
        if (a instanceof Float32Array) return new Float32Array(a);
        if (ArrayBuffer.isView(a)) return a.slice ? a.slice() : a;
      }
      return a;
    }
    function flush() {
      sched = false;
      if (!W_) { q.length = 0; return; }
      var n = 0; while (n < q.length && !q[n].pend) n++;
      if (!n) return;
      var part = q.splice(0, n), cmds = [], tr = [];
      for (var i = 0; i < part.length; i++) { cmds.push(part[i].a); if (part[i].tr) for (var j = 0; j < part[i].tr.length; j++) tr.push(part[i].tr[j]); }
      try { W_.postMessage({ t: 'cmd', q: cmds }, tr); } catch (e) { DR._err = 'post:' + e; }
      wQ.batches++; wQ.cmds += cmds.length;
    }
    function push(c) { q.push(c); if (!sched) { sched = true; Promise.resolve().then(flush); } }
    function rec(name) { return function () { var a = [name]; for (var i = 0; i < arguments.length; i++) a.push(enc(arguments[i])); push({ a: a }); }; }
    ['activeTexture', 'bindTexture', 'texParameteri', 'pixelStorei', 'uniform1f', 'uniform2f', 'uniform3f', 'uniform4f', 'uniform1i', 'uniform4fv', 'useProgram', 'viewport',
      'clearColor', 'clear', 'drawArrays', 'deleteTexture', 'deleteShader', 'deleteProgram', 'deleteBuffer', 'attachShader', 'shaderSource', 'compileShader', 'linkProgram',
      'bindBuffer', 'bufferData', 'enableVertexAttribArray', 'vertexAttribPointer', 'bindAttribLocation'].forEach(function (n) { P[n] = rec(n); });
    function mk(type) { return function (x) { var id = ++ids; push({ a: ['create', type, id, x] }); return { $: id }; }; }
    P.createShader = mk('Shader'); P.createProgram = mk('Program'); P.createTexture = mk('Texture'); P.createBuffer = mk('Buffer');
    P.getUniformLocation = function (p, n) { return p ? { $u: [p.$, n] } : null; };
    P.getAttribLocation = function () { return 0; };
    P.getShaderParameter = P.getProgramParameter = function () { return true; };
    P.getShaderInfoLog = P.getProgramInfoLog = function () { return ''; };
    P.isContextLost = function () { return false; };
    P.getExtension = function (n) { return n === 'WEBGL_lose_context' ? { loseContext: function () { push({ a: ['lose'] }); } } : null; };
    function isSrc(x) { return x && typeof x === 'object' && (('getContext' in x) || ('naturalWidth' in x) || (global.ImageBitmap && x instanceof ImageBitmap)); }
    function bitmap(c, idx, src) {
      var w = src.width || src.naturalWidth || 0, h = src.height || src.naturalHeight || 0;
      if (!w || !h) { c.a = ['nop']; return; }
      c.pend = true; wQ.bitmaps++;
      var t0 = global.performance ? performance.now() : Date.now();
      global.createImageBitmap(src, { premultiplyAlpha: 'premultiply' }).then(function (bm) {
        c.a[idx] = bm; c.tr = [bm]; c.pend = false;
        wQ.bmMs = Math.round(((global.performance ? performance.now() : Date.now()) - t0) * 10) / 10;
        flush();
      }, function (e) { c.a = ['nop']; c.pend = false; DR._err = 'bitmap:' + e; flush(); });
    }
    function imgData(x) { return x && typeof x === 'object' && x.data && x.width != null && !('getContext' in x); }
    P.texImage2D = function () {
      var a = Array.prototype.slice.call(arguments);
      if (a.length === 6) {
        var src = a[5];
        if (imgData(src)) { var u = new Uint8Array(src.data); push({ a: ['texImage2D', a[0], a[1], a[2], src.width, src.height, 0, a[3], a[4], u], tr: [u.buffer] }); return; }
        var c = { a: ['texImage2D', a[0], a[1], a[2], a[3], a[4], null] };
        push(c); if (isSrc(src)) bitmap(c, 6, src); else c.a = ['nop'];
        return;
      }
      var arr = a[8] ? enc(a[8]) : null;
      push({ a: ['texImage2D'].concat(a.slice(0, 8)).concat([arr]), tr: arr && arr.buffer ? [arr.buffer] : null });
    };
    P.texSubImage2D = function () {
      var a = Array.prototype.slice.call(arguments);
      if (a.length === 7) {
        var src = a[6];
        if (imgData(src)) { var u = new Uint8Array(src.data); push({ a: ['texSubImage2D', a[0], a[1], a[2], a[3], src.width, src.height, a[4], a[5], u], tr: [u.buffer] }); return; }
        var c = { a: ['texSubImage2D', a[0], a[1], a[2], a[3], a[4], a[5], null] };
        push(c); if (isSrc(src)) bitmap(c, 7, src); else c.a = ['nop'];
        return;
      }
      var arr = enc(a[8]);
      push({ a: ['texSubImage2D'].concat(a.slice(0, 8)).concat([arr]), tr: arr && arr.buffer ? [arr.buffer] : null });
    };
    P._size = function (w, h) { push({ a: ['size', w, h] }); };
    P._mark = function (m) { push({ a: m }); };
    P._flush = flush;
    P._proxy = true;
    return P;
  }
  function wMsg(e) {
    var d = e.data || {};
    if (d.t === 'ready') {
      wInfo = d;
      if (d.ok) { wOK = 1; return; }
      workerFail('no-webgl-in-worker' + (d.err ? ':' + d.err : ''));
      return;
    }
    if (d.t === 'L') { if (global.LiquidDock && LiquidDock._wmsg) LiquidDock._wmsg(d); return; }
    if (d.t === 'perf') { wPerf = d; return; }
    if (d.t === 'err') {
      wQ.errs = (wQ.errs || []).concat(d.errs).slice(-10);
      if (d.errs.some(function (x) { return /^(compile|link):/.test(x); })) workerFail('shader:' + d.errs[0]);
      return;
    }
    if (d.t === 'lost') { lost = true; ready = false; if (cv) cv.classList.remove('on'); return; }
    if (d.t === 'restored') { lost = false; freeGL(false); stats.ctxLive = 0; if (initGL()) markDirty(true); }
  }
  /* Worker 里建不出 webgl（WebKit 旧版 / 某些 GPU 黑名单）或着色器出错：本次会话退回主线程实现（换一块新画布重来） */
  function workerFail(why) {
    wOK = -1; wNo = true; DR._wfail = why;
    if (!on) return;
    var b = bar;
    DR.stop();
    if (global.LiquidDock && LiquidDock.refresh) LiquidDock.refresh(); else DR.start(b);
  }
  var GLOPTS = { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'low-power' };
  var WURL = (function () { try { var sc = doc.currentScript && doc.currentScript.src; if (sc) return sc.replace(/dock-refract\.js(\?.*)?$/, 'dock-worker.js'); } catch (e) { /* */ } return 'js/dock-worker.js'; })();
  function initGL() {
    var opts = GLOPTS;
    gl = wm ? mkProxy() : (cv.getContext('webgl', opts) || cv.getContext('experimental-webgl', opts));
    if (!gl) return false;
    stats.ctxCreated++; stats.ctxLive = 1;
    function sh(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { DR._err = gl.getShaderInfoLog(s); return null; } return s; }
    var v = sh(gl.VERTEX_SHADER, VS), f = sh(gl.FRAGMENT_SHADER, FS);
    if (!v || !f) return false;
    prog = gl.createProgram(); gl.attachShader(prog, v); gl.attachShader(prog, f); gl.linkProgram(prog);
    gl.deleteShader(v); gl.deleteShader(f);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { DR._err = gl.getProgramInfoLog(prog); return false; }
    gl.useProgram(prog);
    buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    var al = gl.getAttribLocation(prog, 'a'); gl.enableVertexAttribArray(al); gl.vertexAttribPointer(al, 2, gl.FLOAT, false, 0, 0);
    UNI.forEach(function (k) { U[k] = gl.getUniformLocation(prog, k); });
    texP = mkTex(); texB = mkTex();
    gl.uniform1i(U.uP, 0); gl.uniform1i(U.uB, 1);
    /* 第 312 次：Snell 位移表（128×1）只建一次；图标层纹理按需上传 */
    texD = mkTex(true); texI = mkTex(true); icKey = '';
    gl.bindTexture(gl.TEXTURE_2D, texD);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 128, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, tableBytes());
    gl.bindTexture(gl.TEXTURE_2D, texI);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    gl.uniform1i(U.uD, 2); gl.uniform1i(U.uI, 3);
    /* 第 320 次：融合玻璃程序（编不过 = 二级页退回 CSS 玻璃，不影响 dock） */
    progF = null; UF = {}; fzErr = ''; fzWarm = false;
    var err0 = DR._err;
    try {
      var v2 = sh(gl.VERTEX_SHADER, VS), f2 = sh(gl.FRAGMENT_SHADER, FSF);
      if (v2 && f2) {
        progF = gl.createProgram(); gl.attachShader(progF, v2); gl.attachShader(progF, f2);
        gl.bindAttribLocation(progF, al, 'a'); gl.linkProgram(progF);
        gl.deleteShader(v2); gl.deleteShader(f2);
        if (!gl.getProgramParameter(progF, gl.LINK_STATUS)) { fzErr = gl.getProgramInfoLog(progF) || 'link'; gl.deleteProgram(progF); progF = null; }
        else {
          gl.useProgram(progF);
          UNI.concat(UNIF).forEach(function (k) { UF[k] = gl.getUniformLocation(progF, k) || gl.getUniformLocation(progF, k + '[0]') || null; });
          gl.uniform1i(UF.uP, 0); gl.uniform1i(UF.uB, 1); gl.uniform1i(UF.uD, 2);
          gl.useProgram(prog);
        }
      } else fzErr = DR._err || 'compile';
    } catch (eF) { fzErr = String(eF); progF = null; }
    DR._err = err0;
    return true;
  }
  function freeGL(lose) {
    if (gl) {
      try {
        if (texP) gl.deleteTexture(texP); if (texB) gl.deleteTexture(texB);
        if (texD) gl.deleteTexture(texD); if (texI) gl.deleteTexture(texI);
        if (buf) gl.deleteBuffer(buf); if (prog) gl.deleteProgram(prog); if (progF) gl.deleteProgram(progF);
      } catch (e) { /* */ }
      stats.texLive = 0;
      if (lose) { var ext = gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext(); }
    }
    gl = null; prog = null; progF = null; UF = {}; buf = null; texP = null; texB = null; texD = null; texI = null; U = {}; stats.ctxLive = 0; stats.texAux = 0; icKey = ''; icReady = false; lcKey = '';
  }

  /* ---------- 玻璃面（第 277 次） ---------- */
  function boxOf(r) { return { x: r.left, y: r.top, w: r.width, h: r.height }; }
  /* 第 327 次：封顶 2 → 3（iPhone 3 倍屏上 2 倍画布被拉成 1 纹素 = 1.5 物理像素，整圈轮廓发虚）；画质档 ≤ 1 仍是 1 */
  function surfDpr() { return quality >= 2 ? Math.min(global.devicePixelRatio || 1, 3) : 1; }
  /* 第 327 次：取整到物理像素（画布位置、着色器 box 用同一个值） */
  function pxDpr() { return global.devicePixelRatio || 1; }
  function snapLo(v) { var d = pxDpr(); return Math.floor(v * d + 1e-4) / d; }
  function snapHi(v) { var d = pxDpr(); return Math.ceil(v * d - 1e-4) / d; }
  function snapR(u) { var x0 = snapLo(u.x), y0 = snapLo(u.y); return { x: x0, y: y0, w: snapHi(u.x + u.w) - x0, h: snapHi(u.y + u.h) - y0 }; }
  /* 第 327 次：栏落在半个物理像素上（视口 393 是奇数，left = 53.5）——用 margin-left 把边框盒左缘挪到整数 CSS px（3 倍屏上也是整物理像素）。
     只在静止时量（动画帧不读布局）；视口 / 栏宽变了下一次静止重画时再对一次 */
  function snapEl(el) {
    var ml = parseFloat(el.style.marginLeft) || 0;
    var r = el.getBoundingClientRect(), d = pxDpr();
    if (!r.width) return null;
    var l0 = r.left - ml, t = Math.abs(d - Math.round(d)) < 1e-3 ? Math.round(l0) : Math.round(l0 * d) / d;
    var m = Math.round((t - l0) * 1000) / 1000;
    if (Math.abs(m - ml) > 0.004) el.style.marginLeft = m ? m + 'px' : '';
    return m;
  }
  /* 第 327 次：GL 模式下一级栏边框盒大 2px（styles.css 第 327 次段）——lg-gl 开关时重量 --dock-w / --dock-bh（app.js syncOrb 量的时候 lg-gl 可能还没加上） */
  function remeasureDock() {
    try {
      var b = bar || doc.getElementById('tabbar');
      if (!b || !doc.body.classList.contains('has-orb') || b.classList.contains('is-sub') || !b.offsetWidth) return;
      doc.documentElement.style.setProperty('--dock-w', b.offsetWidth + 'px');
      doc.documentElement.style.setProperty('--dock-bh', b.offsetHeight + 'px');
    } catch (e) { /* QA 桩无布局 */ }
  }
  function snapBar() {
    if (!bar || busy()) return;
    var k = (global.LiquidDock && LiquidDock.dockScale) ? LiquidDock.dockScale() : 1;
    if (Math.abs(k - 1) > 1e-3) return;
    var m = snapEl(bar);
    if (m != null && m !== stats.snap) { stats.snap = m; geoC = null; }
    /* ＋ 珠（CSS 毛玻璃）同样落在半像素上，一起对齐；它在 scale 动画里时不量 */
    var o = doc.getElementById('dockOrb');
    if (o && !o.hidden && !o.style.scale && !o.style.transform) stats.snapOrb = snapEl(o);
  }
  /* 盖在顶部提示岛下面的层（面板、全屏计时、快记 / 菜单面板、看图、引导）：快照里没有它们，提示岛就只用 CSS 毛玻璃 */
  var OVL = '.ftf, #modalRoot > .modal-mask, #view .modal-mask:not([hidden]), .home-sheet, .qd-mask, .ph-view';
  var blkCache = { t: 0, v: false };
  function blockedTop(b) {
    var now = Date.now();
    if (now - blkCache.t < 200) return blkCache.v;
    var v = false, body = doc.body;
    if (body.classList.contains('ob-open')) v = true;
    else {
      var list = doc.querySelectorAll(OVL);
      for (var i = 0; i < list.length && !v; i++) {
        var el = list[i];
        if (el.classList.contains('sheet-ghost') || el.hidden || !el.getClientRects().length) continue;
        var cs = global.getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) < 0.05) continue;
        var q = el.getBoundingClientRect();
        if (q.left < b.x + b.w && q.right > b.x && q.top < b.y + b.h && q.bottom > b.y) v = true;
      }
    }
    blkCache = { t: now, v: v };
    return v;
  }
  /* 登记 / 重新挂上一块玻璃面：在 el 里放一块 2D 小画布（第一个子节点），每帧从共用的 WebGL 画布拷过来 */
  DR.surface = function (id, el) {
    if (!on || !el || id === 'dock') return false;
    var s = surf[id];
    if (!s) s = surf[id] = { id: id, el: null, c: null, g: null, shape: null, k: 0 };
    if (id === 'live') {
      /* 胶囊画在 dock 的画布里，不另起画布 */
      if (s.el && s.el !== el) { s.el.classList.remove('lg-on', 'lg-band'); }
      s.el = el; el.classList.add('lg-on');
      if (ready && stripCv && !stripCovers(stripRegion())) { try { rasterStrip(); upload(texB, stripCv); } catch (e) { /* */ } }
      schedule();
      return true;
    }
    if (wm) { delete surf[id]; return false; }   /* 第 328 次：Worker 模式下主线程读不到 GL 画布（不能 drawImage），提示岛只用 CSS 毛玻璃 */
    if (!s.c) {
      s.c = doc.createElement('canvas'); s.c.className = 'lg-gl2'; s.c.setAttribute('aria-hidden', 'true');
      s.g = s.c.getContext('2d');
      if (!s.g) { delete surf[id]; return false; }
    }
    if (s.el && s.el !== el) s.el.classList.remove('lg-on');
    s.el = el;
    if (el.firstChild !== s.c) el.insertBefore(s.c, el.firstChild);
    el.classList.add('lg-on');
    if (ready && stripCv && !stripCovers(stripRegion())) { try { rasterStrip(); upload(texB, stripCv); } catch (e) { /* */ } }
    schedule();
    return true;
  };
  DR.unsurface = function (id) {
    var s = surf[id]; if (!s) return;
    if (s.c) { if (s.c.parentNode) s.c.parentNode.removeChild(s.c); s.c.width = 0; s.c.height = 0; }
    if (s.el) s.el.classList.remove('lg-on', 'lg-band');
    delete surf[id];
    schedule();
  };
  /* 动画期间由调用方逐帧给出玻璃面的形状（视口坐标）和与 dock 的融合强度 k；传 null 回到元素本身的盒子 */
  DR.shape = function (id, rect, k) {
    var s = surf[id]; if (!s) return;
    s.shape = rect || null; s.k = rect ? (k || 0) : 0;
    schedule();
  };
  DR.kick = function (ms) {
    var now = global.performance ? performance.now() : Date.now();
    loopUntil = Math.max(loopUntil, now + (ms || 300));
    schedule();
  };
  /* 第 309 次：拖动透镜。rect = 视口坐标 {x,y,w,h}（null = 收起）；m = 拖动速度 0..1（色散 / 偏移加重）；g = 鼓起比例 */
  DR.lens = function (rect, m, g, a, fx) {
    var had = !!lensR;
    lensR = rect && rect.w > 6 && rect.h > 6 ? rect : null; lensM = m || 0; lensG = g == null ? 1 : g; lensA = a == null ? 1 : Math.max(0, Math.min(1, a));
    lensFx = fx || { hl: 0, flash: 0, fuse: 0, a: 0 };
    if (fx && fx.br) geoC = { left: fx.br.left, top: fx.br.top, width: fx.br.width, height: fx.br.height, right: fx.br.right, bottom: fx.br.bottom };
    /* 第 314 次：透镜一出现就确保「透镜图标层」是最新的（只比对 key，没变不动） */
    if (lensR && !had && on && ready && gl && lensTexOn()) rasterLensIcons();
    /* 第 313 次：当场同步重画（不等下一帧 rAF）。liquid-dock.js 在同一个回调里刚改了透镜元素的 transform / 遮罩，
       GL 也在这一刻画，两者进同一次合成——真机录屏里 GL 彩虹环落后 CSS 外形一两帧、成了两条错开的轮廓。 */
    if ((had || lensR) && on && ready && !lost && gl && bar) {
      if (raf) { global.cancelAnimationFrame(raf); raf = 0; }
      draw();
    } else schedule();
  };
  /* 第 319 次：透镜收起、dock 缩放停稳（liquid-dock.js 通知）——补拍动画期间推迟的整页快照 / 横带 */
  DR.settled = function () {
    geoC = null;
    if (!on) return;
    if (pendRaster) {
      var force = pendRaster === 2; pendRaster = 0; stats.deferredRasters = (stats.deferredRasters || 0) + 1;
      if (rasterTimer) clearTimeout(rasterTimer);
      rasterTimer = setTimeout(function () { doRaster(force); }, 0);
    }
    if (pend.length || stale.length) { if (!stripeTimer) stripeTimer = setTimeout(function () { stripeTimer = 0; stripePass(false); }, 60); }
    schedule();
  };
  /* ---------- 第 320 次：二级页融合玻璃（js/dock-fuse.js 给形状表） ----------
     list：[{x,y,w,h,r,k,tm,a,lf,band}]（视口坐标、未缩放），按顺序 smooth-min 并进同一个距离场（第一块 k 不用）；
     o.ext = 画布外接矩形（整段动画固定一个，避免逐帧改画布尺寸）；o.bar = 栏的视口矩形（动画帧不读布局）；
     o.fill = 中间画满的比例（1 = 整块由 GL 画；合拢回一级页的最后 120ms 从 1 淡到 0，和恢复的 CSS 毛玻璃交叉）；o.tint = 记录条模块色调 [r,g,b,a]。
     返回这一帧是否真的画了（没快照 / 采样范围不在快照段里时 false，调用方退回 CSS 玻璃）。 */
  /* 第 327 次：0.5 → 0.67（配合满 dpr，运动中 2 倍 = 1 纹素 1.5 物理像素）；形状这一帧位移 < 0.25 物理像素就按满分辨率画（弹簧尾段看着已停）——
     切到满分辨率后，除非又动了 ≥ 1 物理像素，这段运动里不再降回去 */
  var FZ_LOW = 0.67, fzPrev = null, fzHi = false;
  function fzDelta(a, b) {
    if (!a || !b || a.length !== b.length) return 1e9;
    var m = 0;
    for (var i = 0; i < a.length; i++) { var p = a[i], q = b[i]; m = Math.max(m, Math.abs(p.x - q.x), Math.abs(p.y - q.y), Math.abs(p.x + p.w - q.x - q.w), Math.abs(p.y + p.h - q.y - q.h), Math.abs((p.k || 0) - (q.k || 0)) / 4); }
    return m;
  }
  var fz = null, fzDrawn = false, fzNeu = { k: '', v: null }, fzSt = { draws: 0, ms: 0, max: 0, px: 0, sumMs: 0 };
  var fzR = new Float32Array(20), fzP = new Float32Array(20), fzQ = new Float32Array(20);
  function hexOrRgb(str) {
    str = (str || '').trim();
    var m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(str);
    if (m) { var h = m[1]; if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]; return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1]; }
    return parseColor(str);
  }
  /* 中性玻璃的底色 = 一级 dock 同一档（页面表面色 28% / 深色 22%）；栏在二级页是透明容器，不能再从它身上取 */
  function fuseNeutral() {
    var dark = doc.body.classList.contains('dark'), k = dark ? 'd' : 'l';
    if (fzNeu.k === k && fzNeu.v) return fzNeu.v;
    var c = hexOrRgb(global.getComputedStyle(doc.body).getPropertyValue('--surface')) || (dark ? [42, 36, 31, 1] : [255, 255, 255, 1]);
    fzNeu = { k: k, v: [c[0], c[1], c[2], dark ? 0.22 : 0.28] };
    return fzNeu.v;
  }
  function fuseExt(list) {
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    list.forEach(function (q) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x + q.w); y1 = Math.max(y1, q.y + q.h); });
    return { x: x0, y: y0, w: Math.max(2, x1 - x0), h: Math.max(2, y1 - y0) };
  }
  function drawFuse() {
    var t0 = global.performance ? performance.now() : Date.now();
    fzDrawn = false;
    if (!progF || !fz || !fz.list.length) { cv.classList.remove('on'); return false; }
    var L = fz.list, n = Math.min(5, L.length);
    var E = fz.ext || fuseExt(L);
    var u = snapR({ x: E.x - 14, y: E.y - 10, w: E.w + 28, h: E.h + 30 });
    if (!stripMeta.opaque && !inWin({ top: u.y, bottom: u.y + u.h })) { cv.classList.remove('on'); if (!scrolling) markDirty(); return false; }
    var r = fz.bar || barRect();
    placeCanvas(r, u);
    /* 第 320 次：分裂 / 合拢 / 下落等动画帧按 0.5 倍分辨率画、取样 5 次、不分色散通道（运动中看不出；软件 GL 实测每帧从 ~80ms 降下来，真机省电），停下那一帧回到满分辨率 */
    var sd0 = surfDpr(), pd = pxDpr(), mv = fz.moving;
    if (mv) {
      var dl = fzDelta(L, fzPrev);
      if (dl < 0.25 / pd) fzHi = true; else if (dl >= 1 / pd) fzHi = false;
      if (fzHi) mv = false;
    } else fzHi = false;
    fzPrev = L.map(function (q) { return { x: q.x, y: q.y, w: q.w, h: q.h, k: q.k || 0 }; });
    var dpr = sd0 * (mv ? FZ_LOW : 1);
    var W = Math.max(2, Math.round(u.w * dpr)), H = Math.max(2, Math.round(u.h * dpr));
    fzSt.low = mv; fzSt.dpr = Math.round(dpr * 100) / 100;
    if (cvW !== W || cvH !== H) {
      var up = W > cvW;
      setCv(W, H);
      /* 第 327 次：WebKit 改了画布缓冲尺寸后这一帧不一定立即合成（第 314 次注释）——升回满分辨率那一帧顺手改一个无视觉影响的样式，逼它合成新缓冲，不多停一帧糊图 */
      if (up) { cv.style.outlineOffset = (cv.style.outlineOffset === '0.001px' ? '0.002px' : '0.001px'); fzSt.ups = (fzSt.ups || 0) + 1; }
    }
    gl.useProgram(progF);
    setCommon(UF);
    if (mv) { gl.uniform1f(UF.uTaps, 5); gl.uniform1f(UF.uDisp, 0); }   /* 运动中不分通道取样（色散在静止时才看得出） */
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform4f(UF.uBox, u.x, u.y, u.w, u.h);
    for (var i = 0; i < 5; i++) {
      var q = L[i] || { x: -1e4, y: -1e4, w: 1, h: 1 };
      fzR[i * 4] = q.x; fzR[i * 4 + 1] = q.y; fzR[i * 4 + 2] = q.w; fzR[i * 4 + 3] = q.h;
      fzP[i * 4] = q.r != null ? Math.min(q.r, q.w / 2, q.h / 2) : Math.min(q.w, q.h) / 2; fzP[i * 4 + 1] = q.k || 0; fzP[i * 4 + 2] = q.tm || 0; fzP[i * 4 + 3] = q.a == null ? 1 : q.a;
      fzQ[i * 4] = q.lf || 0; fzQ[i * 4 + 1] = Math.max(2, Math.min(q.band || BAND, Math.min(q.w, q.h) / 2 - 2)); fzQ[i * 4 + 2] = 0; fzQ[i * 4 + 3] = 0;
    }
    gl.uniform4fv(UF.uFR, fzR); gl.uniform4fv(UF.uFP, fzP); gl.uniform4fv(UF.uFQ, fzQ);
    gl.uniform1f(UF.uFN, n); gl.uniform1f(UF.uFA, fz.fill == null ? 1 : fz.fill);
    var nt = fuseNeutral(), tt = fz.tint || nt;
    gl.uniform4f(UF.uTint, nt[0] / 255, nt[1] / 255, nt[2] / 255, nt[3]);
    gl.uniform4f(UF.uFT, tt[0] / 255, tt[1] / 255, tt[2] / 255, tt[3]);
    gl.uniform1f(UF.uAmt, 20);
    /* 第 327 次：浅色投影 .12 → .06（衰减 /3、截断 8px，和一级 dock 收紧后的 CSS 投影同一档） */
    gl.uniform1f(UF.uSh, (doc.body.classList.contains('dark') ? 0.34 : 0.06) * (fz.fill == null ? 1 : fz.fill));
    if (UF.uPX) gl.uniform2f(UF.uPX, W / u.w, doc.body.classList.contains('dark') ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.useProgram(prog);
    stats.draws++; fzSt.draws++; fzSt.px = W * H;
    if (!cv.classList.contains('on')) cv.classList.add('on');
    fzDrawn = true;
    var ms = (global.performance ? performance.now() : Date.now()) - t0;
    fzSt.ms = Math.round(ms * 100) / 100; fzSt.sumMs += ms; if (ms > fzSt.max) fzSt.max = Math.round(ms * 100) / 100;
    return true;
  }
  DR.fuse = function (list, o) {
    o = o || {};
    var was = !!fz;
    fz = list && list.length ? { list: list, ext: o.ext || null, bar: o.bar || null, fill: o.fill, tint: o.tint || null, moving: !!o.moving } : null;
    if (!fz) {
      fzDrawn = false;
      if (was && on && cv) { placeCanvas(barRect(), null); cv._key = 'x'; geoC = null; schedule(); }
      return false;
    }
    if (!on || !ready || lost || !gl || !bar || !progF) return false;
    if (raf) { global.cancelAnimationFrame(raf); raf = 0; }
    lastT = global.performance ? performance.now() : Date.now();
    return drawFuse();
  };
  DR.fuseOk = function () { return !!(on && ready && !lost && gl && progF); };
  DR.fuseDrawn = function () { return !!(fz && fzDrawn); };
  DR._fz = function () { return { on: !!fz, drawn: fzDrawn, n: fz ? fz.list.length : 0, list: fz ? fz.list : null, ext: fz ? fz.ext : null, fill: fz ? fz.fill : null, tint: fz ? fz.tint : null, moving: fz ? fz.moving : null, err: fzErr, prog: !!progF, st: fzSt, canvas: cv ? [cvW, cvH] : null }; };
  DR.press = function (id, down) {
    if (!on || reduced) return;
    press['t' + id] = down ? 1 : 0;
    schedule();
  };

  /* ---------- 光线：设备倾斜（系统已给数据时）/ 滚动方向 ---------- */
  var BASE_ANG = Math.atan2(-0.7071, -0.7071);
  function onTilt(e) {
    if (reduced || e.beta == null || e.gamma == null) return;
    var now = Date.now();
    /* 左右倾（gamma）和前后倾（beta，竖拿约 45° 为中立）把光线方向绕左上 45° 转动，最多约 ±50° */
    var g = Math.max(-1, Math.min(1, e.gamma / 35)), bt = Math.max(-1, Math.min(1, (e.beta - 45) / 35));
    var a = BASE_ANG + g * 0.6 - bt * 0.3;
    light.tx = Math.cos(a); light.ty = Math.sin(a); light.tiltAt = now; light.src = 'tilt';
    if (!raf && now - (light.drawAt || 0) > 33) { light.drawAt = now; schedule(); }
  }
  function lightTarget(now) {
    if (reduced) { light.tx = -0.7071; light.ty = -0.7071; return; }
    if (light.src === 'tilt' && Date.now() - light.tiltAt < 1500) return;
    var v = light.vel || 0;
    if (now - (light.velAt || 0) > 90) { v *= 0.86; if (Math.abs(v) < 0.002) v = 0; light.vel = v; }
    var a = BASE_ANG + Math.max(-0.38, Math.min(0.38, v * 0.22));
    light.tx = Math.cos(a); light.ty = Math.sin(a);
    if (v !== 0) light.src = 'scroll';
  }
  function stepAnim(dt, now) {
    var mv = false, a = 1 - Math.exp(-dt / 70);
    ['dock', 'live'].forEach(function (k) {
      var t = press['t' + k], v = press[k];
      if (Math.abs(t - v) > 0.004) { press[k] = v + (t - v) * a; mv = true; } else press[k] = t;
    });
    lightTarget(now);
    var dx = light.tx - light.x, dy = light.ty - light.y;
    if (Math.abs(dx) + Math.abs(dy) > 0.004) {
      var b = 1 - Math.exp(-dt / 120);
      var x = light.x + dx * b, y = light.y + dy * b, l = Math.sqrt(x * x + y * y) || 1;
      light.x = x / l; light.y = y / l; mv = true;
    } else { light.x = light.tx; light.y = light.ty; }
    if (light.vel) mv = true;
    /* CSS 高光描边跟着转（≥2° 才写，只写三个元素） */
    var ang = Math.round(Math.atan2(-light.x, light.y) * 180 / Math.PI / 2) * 2 + 'deg';
    light.lastAng = ang;
    var els = [bar]; for (var k in surf) els.push(surf[k].el);
    els.forEach(function (el) { if (el && el.style && el._lgAng !== ang) { el._lgAng = ang; el.style.setProperty('--lg-ang', ang); } });
    return mv;
  }
  function thumbMoving(th) {
    try { return !!(th && th.getAnimations && th.getAnimations().some(function (x) { return x.playState === 'running'; })); } catch (e) { return false; }
  }


  /* ---------- 第 312 次：共享光学参数（js/glass-optics.js）与 dock 图标层 ---------- */
  function GOx() { return global.GlassOptics || null; }
  function tableBytes() {
    var GO = GOx();
    if (GO) return GO.tableBytes(GO.table());
    var out = new Uint8Array(512);   /* 没有光学模块时退回 circleMap 形状（边上最大） */
    for (var i = 0; i < 128; i++) { var t = 1 - i / 127, v = Math.round(255 * (1 - Math.sqrt(Math.max(0, 1 - t * t)))); out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = v; out[i * 4 + 3] = 255; }
    return out;
  }
  function toneOf(dark) {
    var GO = GOx();
    return GO ? GO.toneLinear(dark) : (dark ? { contrast: 0.777, brightness: 0.848, chroma: 1.065 } : { contrast: 0.529, brightness: 1.223, chroma: 1.1 });
  }
  function specSat() { var GO = GOx(); return GO ? GO.MAT.specSat : 7; }
  function iconTexOn() { return !!(global.LiquidDock && LiquidDock.ICON_TEX); }
  function lensRim() { return (global.LiquidDock && LiquidDock.RIM) || { rb: 10, re: 20, rev: 30 }; }
  /* dock 图标层：把每个页签的线条图标（.dk-l，内联 SVG，按计算样式内联颜色 / 线宽）和文字画进一张栏内坐标的 2 倍画布。
     只在页签集合 / 选中项 / 栏尺寸 / 深浅色变化时重画（SVG 转图片是异步的，画好再上传纹理）；拖动时不重画。 */
  var SVGNS_ATTR = ['stroke', 'fill', 'stroke-width', 'opacity', 'stroke-linecap', 'stroke-linejoin', 'fill-opacity', 'stroke-opacity', 'display'];
  function svgUrl(el) {
    var cl = el.cloneNode(true), src = [el].concat([].slice.call(el.querySelectorAll('*'))), dst = [cl].concat([].slice.call(cl.querySelectorAll('*')));
    for (var i = 0; i < src.length && i < dst.length; i++) {
      var cs = global.getComputedStyle(src[i]);
      SVGNS_ATTR.forEach(function (a) { var v = cs.getPropertyValue(a); if (v) dst[i].setAttribute(a, v); });
      dst[i].removeAttribute('class');
      if (i > 0) dst[i].removeAttribute('vector-effect');
    }
    var r = el.getBoundingClientRect();
    cl.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); cl.setAttribute('width', Math.max(1, r.width)); cl.setAttribute('height', Math.max(1, r.height));
    cl.removeAttribute('style');
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(cl));
  }
  function iconKeyNow(noAct) {
    if (!bar) return '';
    var tabs = bar.querySelectorAll('.tab.dk-tab'), k = [bar.offsetWidth, bar.offsetHeight, doc.body.classList.contains('dark') ? 1 : 0];
    for (var i = 0; i < tabs.length; i++) k.push(tabs[i].offsetLeft + (!noAct && tabs[i].classList.contains('active') ? 'a' : '') + (tabs[i].getAttribute('data-tab') || tabs[i].textContent.length));
    return k.join('|');
  }
  function rasterIcons() {
    if (!gl || !bar) return;
    var key = iconKeyNow();
    if (key === icKey) return;
    icKey = key; var gen = ++icGen;
    var br = bar.getBoundingClientRect(), W0 = bar.offsetWidth, H0 = bar.offsetHeight;
    if (W0 < 20 || H0 < 20) return;
    var k = br.width / W0 || 1, S = 2;
    var jobs = [];
    Array.prototype.forEach.call(bar.querySelectorAll('.tab.dk-tab'), function (t) {
      if (!t.offsetParent) return;
      var l = t.querySelector('.dk-l'), tx = t.querySelector('.dk-t');
      if (l) { var r = l.getBoundingClientRect(); if (r.width > 1) jobs.push({ url: svgUrl(l), x: (r.left - br.left) / k, y: (r.top - br.top) / k, w: r.width / k, h: r.height / k }); }
      if (tx) {
        var q = tx.getBoundingClientRect(), cs = global.getComputedStyle(tx);
        /* 选中项的文字在透镜外是主色、透镜里另有 DOM：这里按「不在透镜里」的样子画（线条图标同理） */
        if (q.width > 1) jobs.push({ text: tx.textContent, font: cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily, color: cs.color, x: (q.left - br.left) / k + q.width / 2, y: (q.top - br.top) / k + q.height / 2 });
      }
    });
    var pending = 0, imgs = [];
    function finish() {
      if (gen !== icGen || !gl) return;
      if (!icCv) icCv = doc.createElement('canvas');
      icCv.width = Math.round(W0 * S); icCv.height = Math.round(H0 * S);
      var g = icCv.getContext('2d'); if (!g) return;
      g.setTransform(S, 0, 0, S, 0, 0); g.clearRect(0, 0, W0, H0);
      jobs.forEach(function (j, i) {
        if (j.text) { g.font = j.font; g.fillStyle = j.color; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(j.text, j.x, j.y + 0.5); }
        else if (imgs[i] && imgs[i].complete && imgs[i].naturalWidth) { try { g.drawImage(imgs[i], j.x, j.y, j.w, j.h); } catch (e) { /* */ } }
      });
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texI);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, icCv); icReady = true; stats.icons = (stats.icons || 0) + 1; } catch (e) { icReady = false; DR._err = 'icons:' + e; }
      schedule();
    }
    jobs.forEach(function (j, i) {
      if (!j.url) return;
      pending++;
      var im = new Image(); imgs[i] = im;
      im.onload = im.onerror = function () { if (--pending === 0) finish(); };
      im.src = j.url;
    });
    if (!pending) finish();
  }

  /* 第 314 次：「透镜图标层」——透镜里看到的样子：每个页签的彩色图标（.dk-c，按 .dk-ic 盒子原位原大）+ 选中色粗体文字，画进一张栏内坐标的
     devicePixelRatio 倍画布。着色器在透镜里按折射后的取样点读它，第 317 次起图标层不缩放（背景缩小 0.97、图标原大，对照支付宝），只在边带和背景一起被压缩；
     DOM 图标此时只露在透镜外（liquid-dock.js 给每个页签 clip-path 挖掉透镜），同一处不会有两份图标。
     .dk-c 是同源 webp（<img>，已解码），同步 drawImage，不走 313 那条 SVG → 图片的异步路径；只在页签 / 尺寸 / 深浅色变化时重画。 */
  function lensTexOn() { return !!(global.LiquidDock && LiquidDock.LENS_TEX); }
  var lcKey = '';
  function rasterLensIcons() {
    if (!gl || !bar) return;
    var key = 'L' + iconKeyNow(true);   /* 第 319 次：透镜图标层与「选中哪一页」无关（全彩图标 + 主色字），切页不重画 */
    if (key === lcKey && icReady) return;
    stats.lensIconRasters = (stats.lensIconRasters || 0) + 1;
    var br = bar.getBoundingClientRect(), W0 = bar.offsetWidth, H0 = bar.offsetHeight;
    if (W0 < 20 || H0 < 20) return;
    var k = br.width / W0 || 1, S = Math.min(3, Math.max(2, global.devicePixelRatio || 2));
    if (!icCv) icCv = doc.createElement('canvas');
    icCv.width = Math.round(W0 * S); icCv.height = Math.round(H0 * S);
    var g = icCv.getContext('2d'); if (!g) return;
    g.setTransform(S, 0, 0, S, 0, 0); g.clearRect(0, 0, W0, H0);
    /* 第 319 次：主色直接取主题变量（透镜在场时选中页签的 DOM 文字是灰的，不能从它取色） */
    var bcs = global.getComputedStyle(bar), pc = (bcs.getPropertyValue('--primary-text') || bcs.getPropertyValue('--primary') || '').trim() || '#B4523A';
    var waiting = false;
    Array.prototype.forEach.call(bar.querySelectorAll('.tab.dk-tab'), function (t) {
      if (!t.offsetParent) return;
      var ic = t.querySelector('.dk-ic'), im = t.querySelector('img.dk-c'), tx = t.querySelector('.dk-t');
      /* 第 315 次：彩色图标换成和线条版同路径的填色 SVG（js/dock-icons.js）——GL 用它预解码好的位图，按 .dk-c 盒子原位原大画 */
      var sv = t.querySelector('svg.dk-c'), dk = sv && sv.getAttribute('data-dk');
      if (sv && dk && global.DockIcons) { im = DockIcons.img(dk, doc.body.classList.contains('dark')); }
      /* 第 319 次：位置一律按 .dk-ic 盒子量（空闲预拍时没选中页签的 svg.dk-c 还是 scale .55，按它量图标会小一圈） */
      ic = t.querySelector('.dk-ic') || ic;
      if (ic && im) {
        var r = ic.getBoundingClientRect(), x = (r.left - br.left) / k, y = (r.top - br.top) / k, w = r.width / k, h = r.height / k;
        if (!sv && ic.classList.contains('dk-baby')) { x -= 1; y -= 1; w += 2; h += 2; }
        if (im.complete && im.naturalWidth) {
          var iw = im.naturalWidth, ih = im.naturalHeight, f = Math.min(w / iw, h / ih);
          try { g.drawImage(im, x + (w - iw * f) / 2, y + (h - ih * f) / 2, iw * f, ih * f); } catch (e) { /* 解码中 */ }
        } else { waiting = true; im.addEventListener('load', function () { lcKey = ''; if (lensR) rasterLensIcons(); }, { once: true }); }
      }
      if (tx) {
        var q = tx.getBoundingClientRect(), cs = global.getComputedStyle(tx);
        g.font = cs.fontStyle + ' 600 ' + cs.fontSize + ' ' + cs.fontFamily; g.fillStyle = pc; g.textAlign = 'center'; g.textBaseline = 'middle';   /* 第 319 次：字重与 DOM 统一 600 */
        if (q.width > 1) g.fillText(tx.textContent, (q.left - br.left) / k + q.width / 2, (q.top - br.top) / k + q.height / 2 + 0.5);
      }
    });
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texI);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, icCv); icReady = true; stats.icons = (stats.icons || 0) + 1; } catch (e) { icReady = false; DR._err = 'lensIcons:' + e; }
    lcKey = waiting ? '' : key;
  }

  /* ---------- 绘制 ---------- */
  function setCommon(L) {
    L = L || U;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texP);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texB);
    gl.uniform2f(L.uCv, cvW, cvH);
    gl.uniform2f(L.uPS, pageMeta.w, pageMeta.h);
    gl.uniform2f(L.uScroll, global.scrollX || 0, global.scrollY || 0);
    gl.uniform4f(L.uStrip, stripMeta.x, stripMeta.y, stripMeta.w, stripMeta.h);
    var fd = stripMeta.fade;
    gl.uniform4f(L.uFade, fd ? fd.top : 0, fd ? Math.max(1, fd.h) : 1, 0, fd ? fd.c[3] : 0);
    gl.uniform3f(L.uFadeC, fd ? fd.c[0] / 255 : 0, fd ? fd.c[1] / 255 : 0, fd ? fd.c[2] / 255 : 0);
    gl.uniform1f(L.uS, pageMeta.s);
    gl.uniform1f(L.uTaps, quality >= 2 ? 9 : 5);
    gl.uniform1f(L.uY0, pageMeta.y0 || 0);
    gl.uniform1f(L.uPageOn, stripMeta.opaque ? 0 : 1);
    var dark = doc.body.classList.contains('dark');
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, texD);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, texI);
    gl.activeTexture(gl.TEXTURE0);
    /* 第 312 次：色调与 CSS backdrop-filter 用同一组系数（glass-optics.js · Glass-HQ regular 的线性近似） */
    var tl = toneOf(dark);
    gl.uniform3f(L.uTone, tl.contrast, tl.brightness, tl.chroma);
    gl.uniform1f(L.uSS, specSat());
    gl.uniform2f(L.uWF, dark ? -1 : 1, dark ? 0.65 : 0.34);
    var rim = lensRim();
    gl.uniform3f(L.uLR, rim.rb, rim.re, rim.rev);
    gl.uniform1f(L.uSW, dark ? 0.22 : 0.42);
    var bb = barRect();
    gl.uniform4f(L.uIB, bb.left, bb.top, Math.max(1, bb.width), Math.max(1, bb.height));
    gl.uniform1f(L.uHasI, icReady && (iconTexOn() || lensTexOn()) ? 1 : 0);
    /* 第 313 次：透镜玻璃体——内部放大、提亮（深色多提一点，真机深色透镜里只剩黑底 + 空心细线）、整体不透明度 */
    var fx = lensFx || {};
    /* 第 315 次：放大倍数随鼓起比例（收回胶囊时回到 1:1，和下面已换回的 DOM 选中图标对齐，透镜淡出时不闪图标） */
    gl.uniform1f(L.uMagI, 1 + (LENS_MAG_I - 1) * Math.max(0, Math.min(1, lensG)));
    /* 第 314 次：清透——透镜本身几乎不加料（313 是混白 4.5% / 深色 ×1.12 的「玻璃体」） */
    gl.uniform2f(L.uLB, 0.02, dark ? 1.06 : 1.0);
    gl.uniform4f(L.uLX, reduced ? 0 : (fx.hl || 0), reduced ? 0 : (fx.flash || 0), fx.fuse || 0, fx.a || 0);
    gl.uniform3f(L.uLO, (dark ? 0.26 : 0.06) * (fx.sh == null ? 1 : fx.sh), dark ? 0 : 0.45, 0);   /* 第 327 次：浅色投影 .1 → .06 */
      /* 第 319 次：投影只给冒出栏的大透镜（点击透镜在栏内，sh = 0） */
    gl.uniform1f(L.uLA, lensA);
    gl.uniform3f(L.uDS, bb.left + bb.width / 2, bb.top + bb.height / 2, (lensFx && lensFx.ds) || ((global.LiquidDock && LiquidDock.dockScale) ? LiquidDock.dockScale() : 1));
    gl.uniform1f(L.uDisp, 0.22);
    gl.uniform1f(L.uBlur, 9);
    gl.uniform1f(L.uSpec, dark ? 0.18 : 0.32);
    gl.uniform1f(L.uRim, dark ? 0.42 : 0.16);
    if (dark) gl.uniform4f(L.uLine, 1, 1, 1, 0.16); else gl.uniform4f(L.uLine, 120 / 255, 106 / 255, 96 / 255, 0.36);
    gl.uniform1f(L.uLM, lensM); gl.uniform1f(L.uLG, lensG);
    gl.uniform2f(L.uL, light.x, light.y);
    gl.uniform1f(L.uDbg, DR._debug ? (DR._debug === 2 ? 2 : 1) : 0);   /* 调试：整块显示快照本身（不折射、不调色），用来核对快照与页面是否对齐 */
  }
  function rect4(u, r) { gl.uniform4f(u, r.x, r.y, r.w, r.h); }
  /* 画一块玻璃面：box = 画布在视口里的位置；A = 本体形状；B = 融合对象（k>0）；cut = 挖掉的形状；T = 透镜 */
  function render(o) {
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    rect4(U.uBox, o.box); rect4(U.uA, o.A); gl.uniform1f(U.uRA, Math.min(o.A.w, o.A.h) / 2);
    gl.uniform1f(U.uHasB, o.B ? 1 : 0); gl.uniform1f(U.uK, o.k || 0); gl.uniform1f(U.uFill, o.B && o.k > 0.05 ? 1 : 0);
    if (o.B) { rect4(U.uBr, o.B); gl.uniform1f(U.uRB, Math.min(o.B.w, o.B.h) / 2); }
    gl.uniform1f(U.uHasT, o.T ? 1 : 0);
    if (o.T) { rect4(U.uT, o.T); gl.uniform1f(U.uRT, Math.min(o.T.w, o.T.h) / 2); }
    /* 第 322 次（A3）：栏端外凸只在一级 dock + 透镜这一遍（o.T）里给，其它玻璃面恒 0 */
    var ep = o.T && lensFx && lensFx.ep ? lensFx.ep : 0;
    if (U.uEP) gl.uniform4f(U.uEP, ep, ep ? (lensFx.ek || 10) : 0, 0, 0);
    stats.ep = ep;
    var tint = o.tint || [255, 255, 255, 0.3];
    gl.uniform4f(U.uTint, tint[0] / 255, tint[1] / 255, tint[2] / 255, tint[3]);
    var p = o.press || 0;
    gl.uniform1f(U.uBand, Math.max(2, Math.min(o.band + 2 * p, o.A.h / 2 - 2, o.A.w / 2 - 2)));
    gl.uniform1f(U.uBandB, o.B ? Math.max(2, Math.min(13 + 2 * p, o.B.h / 2 - 2, o.B.w / 2 - 2)) : 0);
    gl.uniform1f(U.uHasCut, 0);
    if (U.uPX) gl.uniform2f(U.uPX, (o.px || 1), doc.body.classList.contains('dark') ? 1 : 0);   /* 第 327 次 */
    gl.uniform1f(U.uAmt, 20 * (1 + 0.38 * p));   /* 第 312 次：最大 14px；第 314 次：20px（边带 18，外沿模糊 / 色调减轻后折弯才看得出），与 Chromium #lgDock 同值 */
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    stats.draws++;
  }
  function tintOf(el) {
    /* 第 319 次：dock 的底色按（深浅色 + 栏 class）缓存，动画帧里不取计算样式 */
    if (el === bar) { var k = (doc.body.classList.contains('dark') ? 'd' : 'l') + bar.className; if (tintC.k === k && tintC.v) return tintC.v; tintC.k = k; return (tintC.v = parseColor(global.getComputedStyle(el).backgroundColor) || [255, 255, 255, 0.3]); }
    return parseColor(global.getComputedStyle(el).backgroundColor) || [255, 255, 255, 0.3];
  }
  /* 胶囊此刻是否真的看得见（快记展开、白噪音播放页、左右手竖排时都不画它的折射边） */
  function liveShown(s) {
    if (!s || !s.el || !s.el.isConnected || s.el.hidden) return false;
    var c = doc.body.classList;
    var cs = global.getComputedStyle(s.el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && parseFloat(cs.opacity) > 0.05;
  }
  function setBand(s, onOff) {
    if (!s || !s.el) return;
    if (s.el.classList.contains('lg-band') !== onOff) s.el.classList.toggle('lg-band', onOff);
  }
  /* dock 画布的位置：没有胶囊时就是 CSS 默认（盖住 dock 边框盒）；有胶囊时扩成 dock ∪ 胶囊的外接矩形 */
  function placeCanvas(r, u) {
    var key = u ? [u.x - r.left, u.y - r.top, u.w, u.h, r.width].map(function (v) { return Math.round(v * 64) / 64; }).join(',') : '';
    if (cv._key === key) return;
    cv._key = key;
    /* 第 313 次：画布扩出去时不要再继承栏的胶囊圆角（会把栏两端的透镜上下沿裁掉一角）；形状全由着色器的距离场决定 */
    if (!u) { cv.style.left = cv.style.top = cv.style.width = cv.style.height = cv.style.borderRadius = ''; return; }
    cv.style.borderRadius = '0';
    var k = 1;   /* 第 319 次：r 已是未缩放矩形 */
    var bl = bar.clientLeft || 0, bt = bar.clientTop || 0;
    cv.style.left = ((u.x - r.left) / k - bl) + 'px'; cv.style.top = ((u.y - r.top) / k - bt) + 'px';
    cv.style.width = (u.w / k) + 'px'; cv.style.height = (u.h / k) + 'px';
  }
  function draw(ts) {
    raf = 0;
    var now = global.performance ? performance.now() : Date.now();
    var dt = lastT ? Math.min(64, Math.max(1, now - lastT)) : 16; lastT = now;
    if (scrolling && ts) frameCheck(ts);
    if (!on || !ready || lost || !gl || !bar) return;
    var moving = stepAnim(dt, now);
    /* 第 320 次：二级页融合玻璃（返回 / ＋ / 记录条 / 正在进行）整块由融合程序画，一级 dock 的画法不走 */
    if (fz) { drawFuse(); if (moving || now < loopUntil) schedule(); return; }
    if (iconTexOn()) rasterIcons();   /* 第 312 次：只比对 key，没变就不动；第 313 次：透镜外沿不画图标纹理时整个跳过 */
    var th = (quality >= 1 && !DR._debug) ? bar.querySelector('.lg-thumb.on') : null;
    /* 第 314 次：透镜在场时不再因为 lensR 自己空转——liquid-dock.js 每帧都会调 DR.lens 当场画一次，原来这里再画一次 = 每帧两遍着色器 */
    var looping = moving || now < loopUntil || thumbMoving(th);
    if (quality === 0 && scrolling) { if (looping) schedule(); return; }
    var t0 = now;
    if (!looping) snapBar();
    var r = barRect();   /* 第 319 次：未缩放矩形；动画期间是缓存，不读布局 */
    if (r.width < 20 || r.height < 20) return;
    stats.frames++;
    /* 正在进行胶囊：画在 dock 这块画布里（画布扩到两者的外接矩形），和 dock 用同一个距离场——
       平时 k = 0（两块各自的边），出现 / 消失动画里 k > 0（smooth-min 融合出颈部）。不拷贝、不另起画布。 */
    var ls = surf.live;
    var lsOn = liveShown(ls) && !DR._debug;
    var lshape = lsOn ? (ls.shape || boxOf(ls.el.getBoundingClientRect())) : null;
    if (lshape && (lshape.w < 6 || lshape.h < 6)) lshape = null;
    var fk = lshape && ls.shape && quality >= 1 && !reduced ? ls.k : 0;
    /* 第 327 次：GL 轮廓 = 栏的边框盒（原来外扩 1 CSS px，和 CSS 层 / 融合一级形状 S.L1.cap 差 1px，推入时跳一下）；栏的 DOM 在 GL 模式下一起大 2px，外观尺寸不变 */
    var dockShape = { x: r.left, y: r.top, w: r.width, h: r.height };
    var u = null;
    /* 第 309 次：透镜比栏高，画布也要扩到透镜（和胶囊一样走外接矩形） */
    var LT = lensR && DR._debug !== 1 && DR._debug !== true ? lensR : null;   /* 第 317 次：_debug = 2（折射几何调试）照画透镜 */
    /* 第 315 次：画布一直按「dock 四周固定外扩」的尺寸（不再只在透镜在场时扩）——透镜出现 / 收起那一帧画布尺寸和像素映射一变，
       整条 dock 背景（离透镜很远的地方也算）都被重新取样一次，WebKit 逐帧帧差 2.6（支付宝透镜外纹丝不动） */
    var FIX = (!DR._debug || DR._debug === 2) && quality >= 1;
    if (lshape || LT || FIX) {
      var x0 = dockShape.x, y0 = dockShape.y, x1 = dockShape.x + dockShape.w, y1 = dockShape.y + dockShape.h;
      if (FIX) { x0 -= 64; x1 += 64; y0 -= 32; y1 += 32; }
      /* 第 314 次：透镜在场时画布按「dock 四周固定外扩」一次定好尺寸，整段按压 / 拖动不再逐帧改 canvas 宽高——
         逐帧改尺寸 = 每帧重新分配绘制缓冲；WPE WebKit 实测改完尺寸后的绘制要等下一次样式失效才合成（GL 透镜停在旧位置 = 真机录屏里的第二条轮廓） */
      if (LT) { x0 = Math.min(x0, dockShape.x - 44); x1 = Math.max(x1, dockShape.x + dockShape.w + 44); y0 = Math.min(y0, dockShape.y - 32); y1 = Math.max(y1, dockShape.y + dockShape.h + 32);
        x0 = Math.min(x0, LT.x - LENS_SHADOW); x1 = Math.max(x1, LT.x + LT.w + LENS_SHADOW); y0 = Math.min(y0, LT.y - LENS_SHADOW); y1 = Math.max(y1, LT.y + LT.h + LENS_SHADOW); }
      if (lshape) { x0 = Math.min(x0, lshape.x - 2); y0 = Math.min(y0, lshape.y - 2); x1 = Math.max(x1, lshape.x + lshape.w + 2); y1 = Math.max(y1, lshape.y + lshape.h + 2); }
      u = snapR({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    }
    placeCanvas(r, u);
    /* 第 319 次：画布位置就是 u（未缩放视口坐标），不再 getBoundingClientRect；dock 按下缩放时画布作为子节点由合成器整块缩放，着色器的取样坐标不变 = 透镜外不闪 */
    /* 第 327 次：着色器 box 与画布位置是同一个取整到物理像素的 u（原来各自按 0.5 CSS px 取整） */
    var box = u ? { x: u.x, y: u.y, w: u.w, h: u.h } : boxOf(cv.getBoundingClientRect());
    if (!u && box.w <= 20) box = dockShape;
    /* 顶部提示岛（离 dock 很远、层级在面板之上）：同一块 WebGL 画布先按它的位置画一遍，drawImage 拷进它自己的小画布 */
    var dpr = surfDpr(), job = null, ts2 = surf.toast;
    if (ts2 && ts2.el && ts2.el.isConnected && !ts2.el.hidden && ts2.c && !wm) {
      if (ts2.c.parentNode !== ts2.el) ts2.el.insertBefore(ts2.c, ts2.el.firstChild);
      var tb = boxOf(ts2.el.getBoundingClientRect());
      if (tb.w < 10 || tb.h < 10 || blockedTop(tb) || (!stripMeta.opaque && !inWin(ts2.el.getBoundingClientRect())) || hiddenForNav) ts2.c.classList.remove('on');
      else job = { s: ts2, b: tb };
    }
    /* 画布扩到胶囊时像素多了一倍多：2 倍屏降到 1.5 倍（折射边本来就带模糊，看不出差别） */
    /* 第 313 次：透镜在场时不降（真机 3 倍屏上 1.5 倍画布把透镜边放大成锯齿 / 像素块）；只有胶囊在场时才降到 1.5 */
    var gdpr = lshape && !LT ? Math.min(dpr, 1.5) : dpr;
    stats.box = box; stats.shape = dockShape;
    var W = Math.max(2, Math.round(box.w * gdpr)), H = Math.max(2, Math.round(box.h * gdpr));
    if (cvW !== W || cvH !== H) setCv(W, H);
    setCommon();
    /* 第 320 次：融合程序预热——第一次用一个着色器程序画时驱动才真正编译（软件 GL 实测第一次推入卡 ~700ms，iOS 首帧也会卡一下）。
       空闲时（不在动）先用它画 1×1 一次，紧接着下面的 dock 正常画会整块清掉重画，看不见 */
    if (progF && !fzWarm && !busy() && !scrolling) {
      fzWarm = true;
      try { gl.useProgram(progF); setCommon(UF); gl.uniform1f(UF.uFN, 0); gl.viewport(0, 0, 1, 1); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); } catch (eW) { /* */ }
      gl.useProgram(prog); setCommon(); stats.fuseWarm = (stats.fuseWarm || 0) + 1;
    }
    if (job) {
      /* 提示岛按自己的像素尺寸画在左下角一块视口里（不超过画布），再拷走 */
      var cw = Math.max(2, Math.round(job.b.w * dpr)), ch = Math.max(2, Math.round(job.b.h * dpr));
      var vw2 = Math.min(W, cw), vh2 = Math.min(H, ch);
      gl.viewport(0, 0, vw2, vh2);
      gl.uniform2f(U.uCv, vw2, vh2);
      render({ box: job.b, A: job.b, tint: tintOf(job.s.el), band: 12, press: 0, clearAll: true, px: cw / job.b.w });
      var c2 = job.s.c;
      if (c2.width !== cw || c2.height !== ch) { c2.width = cw; c2.height = ch; } else job.s.g.clearRect(0, 0, cw, ch);
      job.s.g.drawImage(cv, 0, H - vh2, vw2, vh2, 0, 0, cw, ch);
      stats.copies++;
      c2.classList.add('on');
      gl.uniform2f(U.uCv, W, H);
    }
    gl.viewport(0, 0, W, H);
    /* dock（+ 胶囊）最后画，WebGL 画布上留下的就是这一帧 */
    if (!stripMeta.opaque && !busy() && !inWin(r, lshape ? r.top - lshape.y : 0)) {
      cv.classList.remove('on'); setBand(ls, false); dirty = true; if (!scrolling) markDirty();
    } else {
      if (!hiddenForNav && !cv.classList.contains('on')) cv.classList.add('on');
      /* 第 309 次：选中指示器静止时是 CSS 灰胶囊；透镜只在按下 / 拖动时由 liquid-dock.js 给出（DR.lens）。
         .lg-lens 仍表示「WebGL 接管了透镜」 */
      var T = LT;
      bar.classList.toggle('lg-lens', !!th);
      render({ box: box, A: dockShape, B: lshape, k: fk, T: T, tint: tintOf(bar), band: BAND, press: Math.max(press.dock, press.live), px: W / box.w });
      if (wm && gl._mark) gl._mark(['@dock', prog.$, doc.body.classList.contains('dark') ? 1 : 0, reduced ? 1 : 0]);   /* 第 328 次：Worker 据此知道哪个程序是 dock 主程序、透镜帧在它上面只改透镜 uniform 重画 */
      setBand(ls, !!lshape && !hiddenForNav);
    }
    if (ls && !lsOn) setBand(ls, false);
    if (global.performance) stats.drawMs = Math.round((performance.now() - t0) * 100) / 100;
    if (looping) schedule();
  }
  function schedule() { if (on && !raf) raf = global.requestAnimationFrame(draw); }

  function doRaster(force) {
    rasterTimer = 0;
    if (force === true && !scrolling) { animWait = 99; }
    if (!on || !gl || lost) return;
    /* 第 319 次：透镜在场 / dock 弹簧在动 → 推迟到落定（DR.settled），这 0.2~0.5 秒用旧快照，看不出来；同一帧不和透镜抢主线程 */
    if (busy()) { pendRaster = Math.max(pendRaster, force === true || animWait === 99 ? 2 : 1); stats.rasterDeferredHits = (stats.rasterDeferredHits || 0) + 1; return; }
    if (scrolling) { rasterTimer = setTimeout(doRaster, 220); return; }
    if (doc.documentElement.hasAttribute('data-nav')) { rasterTimer = setTimeout(doRaster, 160); return; }
    /* 第 318 次：二级页横推进行中（html.nav-anim / 侧滑拖动 html.nav-drag）：#view 在动、旧页在 body 上的另一张纸里，此刻拍的是半截——
       画布留着上一张快照不藏（透镜外 dock 背景不变），转场一结束再拍 */
    if (doc.documentElement.classList.contains('nav-anim') || doc.documentElement.classList.contains('nav-drag')) { rasterTimer = setTimeout(function () { doRaster(force); }, 60); return; }
    /* 页面进场动画（.view-enter 淡入 / 列表逐行进场）还在跑：此刻拍下来是半透明的，等它跑完 */
    var vw = doc.getElementById('view');
    if (vw && vw.getAnimations && animWait < 12) {
      try {
        var an = vw.getAnimations({ subtree: true }).some(function (a) {
          var t = a.effect && a.effect.getComputedTiming && a.effect.getComputedTiming();
          return a.playState === 'running' && t && isFinite(t.endTime) && t.endTime < 5000;
        });
        if (an) { animWait++; rasterTimer = setTimeout(doRaster, 120); return; }
      } catch (eA) { /* */ }
    }
    var forced = animWait === 99;
    animWait = 0;
    /* 启动动画还在播：不和它抢主线程，等它结束 */
    if (!forced && doc.documentElement.classList.contains('is-booting')) { rasterTimer = setTimeout(doRaster, 300); return; }
    var t0 = performance.now();
    stats.nodes = 0;
    try {
      rasterPage();
      rasterStrip();
    } catch (e) { DR._err = String(e); return; }
    upload(texP, pageCv); upload(texB, stripCv);
    var ms = performance.now() - t0;
    stats.rasters++; stats.rasterMs = Math.round(ms * 10) / 10; stats.rasterMax = Math.max(stats.rasterMax, stats.rasterMs);
    lastRaster = Date.now(); dirty = false; ready = true;
    if (stripeTimer) { clearTimeout(stripeTimer); stripeTimer = 0; }
    if (staleTimer) { clearTimeout(staleTimer); staleTimer = 0; }
    /* 自动档的性能闸门：连续两次快照都慢 → 本次会话关掉折射 */
    if (ms > SLOW_MS && stats.rasters > 1 && setting().dockGlass !== 'on') {
      if (++slowHits >= 2) { disabledReason = 'slow:' + Math.round(ms) + 'ms'; DR.stop(); return; }
    } else slowHits = 0;
    /* 换页后的第一次快照之后，1.2 秒再补拍一次：图片晚到、进场位移、天气卡异步填充都会让版面再动一下 */
    if (hiddenForNav || navSettle) { hiddenForNav = false; navSettle = false; settleTimer = setTimeout(function () { settleTimer = 0; markDirty(); }, 1200); }
    cv.classList.add('on');
    draw();
    prewarmLensIcons();
  }
  /* 第 319 次：启动空闲时（以及换深浅色 / 重建 dock 后的快照之后）预先栅格化透镜图标层，第一次按下 dock 时不再当场拍 */
  var warmT = 0;
  function prewarmLensIcons() {
    if (warmT || !lensTexOn()) return;
    var run = function () { warmT = 0; if (on && ready && gl && !lensR && !busy()) { rasterLensIcons(); stats.lensWarm = (stats.lensWarm || 0) + 1; } };
    warmT = 1;
    if (global.requestIdleCallback) global.requestIdleCallback(run, { timeout: 1200 }); else setTimeout(run, 250);
  }
  function markDirty(urgent) {
    dirty = true;
    if (!on) return;
    if (urgent) { hiddenForNav = true; if (cv) cv.classList.remove('on'); for (var k in surf) { if (surf[k].c) surf[k].c.classList.remove('on'); setBand(surf[k], false); } }
    if (rasterTimer) clearTimeout(rasterTimer);
    var since = Date.now() - lastRaster;
    var wait = urgent ? 120 : Math.max(300, 1200 - since);
    rasterTimer = setTimeout(function () {
      if (global.requestIdleCallback && !urgent) global.requestIdleCallback(doRaster, { timeout: 800 }); else doRaster();
    }, wait);
  }
  var navSettle = false;
  function navDirty() {
    dirty = true;
    if (!on) return;
    navSettle = true;
    if (rasterTimer) clearTimeout(rasterTimer);
    rasterTimer = 0;
    /* 换页的 MutationObserver 回调在点击处理完、下一次绘制之前跑：当场同步重拍，新页第一帧 dock 里就是新快照
       （等到下一帧再拍：第一帧 GL 用旧快照判断「dock 不在快照范围」会把画布藏一帧，透镜也跟着消失 = WebKit 逐帧第 9 帧） */
    if (doc.documentElement.hasAttribute('data-nav')) { rasterTimer = setTimeout(doRaster, 160); return; }
    if (doc.documentElement.classList.contains('nav-anim')) { rasterTimer = setTimeout(function () { doRaster(true); }, 60); return; }
    /* 进 / 出二级页仍有整页入场淡入：此刻拍是半透明的，照旧等入场跑完（画布留着旧快照，不藏） */
    var vw = doc.getElementById('view');
    if (vw && vw.classList.contains('view-enter')) { rasterTimer = setTimeout(doRaster, 120); return; }
    if (busy()) { pendRaster = 2; stats.rasterDeferredHits = (stats.rasterDeferredHits || 0) + 1; return; }   /* 第 319 次：点 dock 切页——透镜在场，落定再拍 */
    doRaster(true);
  }
  DR._navDirty = navDirty;
  /* ---------- 局部重拍（第 277 次） ---------- */
  function noteMut(el) {
    if (!on) return;
    if (el && el.nodeType !== 1) el = el.parentElement;
    if (!el) return;
    if (pend.indexOf(el) < 0) {
      if (pend.length >= 40) { pend.length = 0; markDirty(); return; }
      pend.push(el);
    }
    if (stripeTimer) return;
    var wait = Math.max(120, STRIPE_GAP - (Date.now() - lastStripe));
    stripeTimer = setTimeout(function () { stripeTimer = 0; stripePass(false); }, wait);
  }
  function stripePass(force) {
    if (!on || !gl || lost || !ready) return;
    if (dirty && rasterTimer) { pend.length = 0; return; }   /* 整张重拍马上要来，它会覆盖这些改动 */
    if (busy()) return;   /* 第 319 次：动画期间不回读像素（getImageData），落定后 DR.settled 再补 */
    if (scrolling || doc.documentElement.hasAttribute('data-nav') || doc.documentElement.classList.contains('nav-anim')) { if (!stripeTimer) stripeTimer = setTimeout(function () { stripeTimer = 0; stripePass(force); }, 220); return; }
    var sy = global.scrollY || 0, ranges = [];
    for (var i = 0; i < pend.length; i++) {
      var el = pend[i]; if (!el.isConnected) continue;
      var q = el.getBoundingClientRect(); if (!q.width && !q.height) continue;
      ranges.push([q.top + sy - 8, q.bottom + sy + 8]);
    }
    pend.length = 0;
    ranges = ranges.concat(stale); stale = [];
    var y0 = pageMeta.y0 || 0, y1 = pageMeta.y1 || 0;
    ranges = ranges.map(function (x) { return [Math.max(x[0], y0), Math.min(x[1], y1)]; }).filter(function (x) { return x[1] - x[0] > 0.5; });
    if (!ranges.length) return;
    var hot = hotRanges(), now = [], later = [];
    ranges.forEach(function (x) { (force || overlaps(x, hot) ? now : later).push(x); });
    if (later.length) {
      stale = mergeRanges(later); stats.deferred += later.length;
      if (!staleTimer) staleTimer = setTimeout(function () { staleTimer = 0; stripePass(true); }, 4000);
    }
    if (!now.length) return;
    now = mergeRanges(now);
    var tot = 0; now.forEach(function (x) { tot += x[1] - x[0]; });
    if (tot > 0.5 * (y1 - y0)) { markDirty(); return; }
    var t0 = performance.now();
    try {
      for (var j = 0; j < now.length; j++) if (!rasterStripe(now[j][0], now[j][1])) { markDirty(); return; }
    } catch (e) { DR._err = String(e); markDirty(); return; }
    var ms = performance.now() - t0;
    stats.stripes++; stats.stripeMs = Math.round(ms * 10) / 10; stats.stripeMax = Math.max(stats.stripeMax, stats.stripeMs);
    lastStripe = Date.now();
    schedule();
  }

  /* ---------- 事件 ---------- */
  function frameCheck(t) {
    if (fqLast && t - fqLast < 200) fq.push(t - fqLast);
    fqLast = t;
    if (fq.length >= 40) {
      var a = fq.slice().sort(function (x, y) { return x - y; }), med = a[a.length >> 1];
      fq.length = 0;
      if (med > 22 && quality > 0 && setting().dockGlass !== 'on') { quality--; stats.downgrades = (stats.downgrades || 0) + 1; }
    }
  }
  function scrollEnd() {
    scrolling = false; scrollIdleTimer = 0;
    if (dirty) { markDirty(); return; }
    if (stale.length && overlaps([stale[0][0], stale[stale.length - 1][1]], hotRanges())) stripePass(false);
    if (quality === 0) { if (!inWindow()) markDirty(); else schedule(); }
  }
  function onScroll() {
    var sy = global.scrollY || 0, now = global.performance ? performance.now() : Date.now();
    if (!reduced) { var dtS = Math.max(8, now - (light.velAt || now - 16)); light.vel = Math.max(-3, Math.min(3, (sy - light.lastSy) / dtS)); light.velAt = now; }
    light.lastSy = sy;
    if (quality === 0) {
      /* 最低档：滚动时边缘折射淡出（中间实时模糊照旧），停下后对齐再显示 */
      if (cv) cv.classList.remove('on');
      for (var k in surf) { if (surf[k].c) surf[k].c.classList.remove('on'); setBand(surf[k], false); }
      scrolling = true;
      if (scrollIdleTimer) clearTimeout(scrollIdleTimer);
      scrollIdleTimer = setTimeout(scrollEnd, 180);
      return;
    }
    scrolling = true;
    if (scrollIdleTimer) clearTimeout(scrollIdleTimer);
    scrollIdleTimer = setTimeout(scrollEnd, 180);
    if (!reduced) schedule();
    else { /* 减少动态效果：滚动时不逐帧跟随，停下再画 */ clearTimeout(DR._rt); DR._rt = setTimeout(schedule, 200); }
  }
  function onResize() { markDirty(true); }
  function onVis() { if (doc.visibilityState === 'visible' && on) markDirty(); }
  function onLost(e) { e.preventDefault(); lost = true; ready = false; if (cv) cv.classList.remove('on'); for (var k in surf) { if (surf[k].c) surf[k].c.classList.remove('on'); setBand(surf[k], false); } }
  function onRestored() {
    lost = false; freeGL(false); stats.ctxLive = 0;
    if (initGL()) markDirty(true);
  }

  DR.start = function (b) {
    if (on) { DR.attach(b); return true; }
    bar = b || doc.getElementById('tabbar');
    if (!bar) return false;
    cv = doc.createElement('canvas');
    cv.className = 'lg-gl'; cv.setAttribute('aria-hidden', 'true');
    cvW = cv.width; cvH = cv.height;
    /* 第 328 次：能用 Worker 就把画布交出去（之后主线程只往录制代理上画）；Worker 回报建不出 webgl 再整套退回主线程 */
    wm = workerWanted(); wOK = 0; wInfo = null; wPerf = null;
    if (wm) {
      try {
        var off = cv.transferControlToOffscreen();
        W_ = new Worker(WURL);
        W_.onmessage = wMsg;
        W_.onerror = function (ev) { workerFail('worker-error:' + (ev && ev.message || '')); };
        wQ = { batches: 0, cmds: 0, bitmaps: 0, bmMs: 0 };
        W_.postMessage({ t: 'init', c: off, opts: GLOPTS, mo: global.performance && performance.timeOrigin || 0 }, [off]);
      } catch (eW) {
        DR._wfail = 'spawn:' + eW; wm = false; wNo = true; W_ = null;
        cv = doc.createElement('canvas'); cv.className = 'lg-gl'; cv.setAttribute('aria-hidden', 'true'); cvW = cv.width; cvH = cv.height;
      }
    }
    if (!pageCv) {
      pageCv = doc.createElement('canvas');
      /* 第 277 次：局部重拍要回读一条横带，整页快照画布按「常回读」建（CPU 位图，读回不经 GPU） */
      try { pctx = pageCv.getContext('2d', { willReadFrequently: true }); } catch (eW) { pctx = null; }
      if (!pctx) pctx = pageCv.getContext('2d');
    }
    if (!stripCv) { stripCv = doc.createElement('canvas'); sctx = stripCv.getContext('2d'); }
    if (!pctx || !sctx || !initGL()) { freeGL(true); cv = null; if (W_) { W_.terminate(); W_ = null; } wm = false; disabledReason = disabledReason || 'no-webgl'; return false; }
    if (!wm) {
      cv.addEventListener('webglcontextlost', onLost, false);
      cv.addEventListener('webglcontextrestored', onRestored, false);
    }
    on = true; ready = false;
    DR.attach(bar);
    doc.documentElement.classList.add('lg-gl');
    remeasureDock();
    global.addEventListener('scroll', onScroll, { passive: true });
    global.addEventListener('resize', onResize, { passive: true });
    doc.addEventListener('visibilitychange', onVis);
    /* 高光随设备倾斜：只监听、不申请权限（iOS 没授权时根本不会来事件，就按滚动方向微移） */
    if (!reduced && 'DeviceOrientationEvent' in global) global.addEventListener('deviceorientation', onTilt, { passive: true });
    var view = doc.getElementById('view');
    if (global.MutationObserver) {
      mo = new MutationObserver(function (list) {
        /* 第 315 次：换页（#view 子节点整换）不再 markDirty(true) 把 GL 画布藏起来等 120ms+ 再拍——真机逐帧（21:56 第 193~199 帧）
           藏起来的那几帧整条 dock 背景退回 CSS 磨砂（色调 / 边缘高光 / 折射全变），拍好后再跳回 GL = 「整条 dock 闪一下」。
           现在画布留着上一张快照，下一帧就重拍、同一帧换上（只有透出来的页面内容变，和支付宝换页时一样） */
        if (global.__drSkipNav) return;   /* 第 319 次：一级页空闲预渲染（同一任务里摘下又挂回当前页），不是换页 */
        for (var i = 0; i < list.length; i++) if (list[i].target === view && list[i].type === 'childList') { navDirty(); return; }
        for (var j = 0; j < list.length; j++) noteMut(list[j].target);
      });
      if (view) mo.observe(view, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'src', 'hidden', 'open'], characterData: true });
      moBody = new MutationObserver(function () {
        /* 高对比等切换：不该开了就整个停掉（liquid-dock 顺带把模糊玻璃的状态刷新） */
        if (!DR.wanted()) { if (global.LiquidDock && LiquidDock.refresh) LiquidDock.refresh(); else DR.stop(); return; }
        var cl = doc.body.classList, k = [cl.contains('dark'), cl.contains('hc')].join();
        if (k === bodyKey) return;   /* in-home / qd-open 之类不影响背后的画面 */
        bodyKey = k; markDirty(true);
      });
      /* 第 315 次：bodyKey 起始就按当前状态记下——原来是空串，开机后第一次 body class 变化（第一次切页 in-home 去掉）就被当成换主题，
         markDirty(true) 把 GL 画布藏起来重拍 = 第一次点 dock 整条背景闪一下 */
      var cl0 = doc.body.classList; bodyKey = [cl0.contains('dark'), cl0.contains('hc')].join();
      moBody.observe(doc.body, { attributes: true, attributeFilter: ['class'] });
    }
    if (global.ResizeObserver) {
      ro = new ResizeObserver(function () { schedule(); }); ro.observe(bar);
      /* 页面内容高度变了（图片载入、折叠展开）= 版面挪了，快照要重拍 */
      if (view) { roView = new ResizeObserver(function () { markDirty(); }); roView.observe(view); }
    }
    markDirty(true);
    /* 已经在场的胶囊 / 提示岛重新挂上 */
    try { if (global.DockLive && DockLive.syncGlass) DockLive.syncGlass(); } catch (eS) { /* */ }
    try { if (global.Util && Util.toastGlass) Util.toastGlass(); } catch (eT) { /* */ }
    return true;
  };
  /* 底栏被 app.js 整个重建后，把同一块画布放回第一个子节点（在水滴指示器之前，水滴画在它上面） */
  DR.attach = function (b) {
    if (!on || !cv) return;
    if (b && b !== bar) { if (ro) { ro.disconnect(); ro.observe(b); } if (bar) bar.classList.remove('lg-lens'); bar = b; }
    if (bar.firstChild !== cv) bar.insertBefore(cv, bar.firstChild);
    schedule();
  };
  DR.stop = function () {
    if (!on && !cv) return;
    on = false; ready = false;
    if (raf) global.cancelAnimationFrame(raf); raf = 0;
    [rasterTimer, stripeTimer, staleTimer, scrollIdleTimer, settleTimer].forEach(function (t) { if (t) clearTimeout(t); });
    rasterTimer = stripeTimer = staleTimer = scrollIdleTimer = settleTimer = 0;
    if (mo) mo.disconnect(); if (moBody) moBody.disconnect(); if (ro) ro.disconnect(); if (roView) roView.disconnect();
    mo = moBody = ro = roView = null;
    global.removeEventListener('scroll', onScroll);
    global.removeEventListener('resize', onResize);
    global.removeEventListener('deviceorientation', onTilt);
    doc.removeEventListener('visibilitychange', onVis);
    if (cv) { cv.removeEventListener('webglcontextlost', onLost); cv.removeEventListener('webglcontextrestored', onRestored); }
    Object.keys(surf).forEach(function (k) { DR.unsurface(k); });
    var px0 = gl;
    freeGL(true);
    if (W_) { try { if (px0 && px0._flush) px0._flush(); W_.postMessage({ t: 'stop' }); } catch (eS) { /* */ } W_ = null; }
    if (cv && cv.parentNode) cv.parentNode.removeChild(cv);
    if (cv && !wm) { cv.width = 0; cv.height = 0; }
    cv = null;
    if (bar) { bar.classList.remove('lg-lens'); bar.style.removeProperty('--lg-ang'); }
    if (pageCv) { pageCv.width = 0; pageCv.height = 0; } if (stripCv) { stripCv.width = 0; stripCv.height = 0; }
    pageCv = stripCv = pctx = sctx = null;
    IMG = {}; range = null; pend.length = 0; stale.length = 0;
    press.dock = press.live = press.tdock = press.tlive = 0;
    lensR = null; fz = null; fzDrawn = false;
    doc.documentElement.classList.remove('lg-gl');
    if (bar) bar.style.marginLeft = '';
    var orb0 = doc.getElementById('dockOrb'); if (orb0) orb0.style.marginLeft = '';
    stats.snap = stats.snapOrb = null;
    remeasureDock();
  };
  /* liquid-dock.js 每次刷新（建好 / 重建底栏 / 换设置）都会调它 */
  DR.sync = function (b) {
    if (DR.wanted()) { if (!on) DR.start(b); else DR.attach(b); }
    else if (on) DR.stop();
    return on;
  };
  DR.reset = function () { disabledReason = ''; slowHits = 0; };
  /* 第 328 次：Worker 透镜接口（liquid-dock.js 用）——wlOn = 透镜交给 Worker 推进；wl = 转发事件；lensMirror = 只记下透镜形状（主线程之后画 dock 时画布外扩 / 镜像 uniform 用），不当场画 */
  DR.wlOn = function () { return !!(wm && wOK === 1 && on && ready && !lost && W_); };
  DR.wl = function (t, d) { if (!W_) return; var m = d || {}; m.t = t; try { W_.postMessage(m); } catch (e) { /* */ } };
  DR.lensMirror = function (rect, m, g, a, fx) {
    var had = !!lensR;
    lensR = rect && rect.w > 6 && rect.h > 6 ? rect : null; lensM = m || 0; lensG = g == null ? 1 : g; lensA = a == null ? 1 : Math.max(0, Math.min(1, a));
    lensFx = fx || { hl: 0, flash: 0, fuse: 0, a: 0 };
    if (fx && fx.br) geoC = { left: fx.br.left, top: fx.br.top, width: fx.br.width, height: fx.br.height, right: fx.br.right, bottom: fx.br.bottom };
    if (lensR && !had && on && ready && gl && lensTexOn()) rasterLensIcons();
  };
  DR.workerMode = function () { return wm ? (wOK === 1 ? 'on' : wOK === 0 ? 'pending' : 'fail') : 'off'; };
  DR._wperf = function (clear) { if (W_) W_.postMessage({ t: 'perf', clear: !!clear }); return wPerf; };
  DR._wstate = function () { return { wm: wm, wOK: wOK, info: wInfo, fail: DR._wfail || '', q: wQ, url: WURL }; };
  DR.isOn = function () { return on && ready; };
  DR._stats = function () {
    return {
      on: on, ready: ready, reason: disabledReason, worker: DR.workerMode(), wfail: DR._wfail || '', ctxCreated: stats.ctxCreated, ctxLive: stats.ctxLive,
      texLive: stats.texLive, texCreated: stats.texCreated, texAux: stats.texAux || 0, icons: icReady ? (stats.icons || 0) : 0, rasters: stats.rasters, rasterMs: stats.rasterMs, rasterMax: stats.rasterMax,
      quality: quality, downgrades: stats.downgrades || 0, nodes: stats.nodes, draws: stats.draws, drawMs: stats.drawMs, uploadsRealloc: stats.uploadsRealloc, uploadsSub: stats.uploadsSub,
      page: pageCv ? [pageCv.width, pageCv.height] : null, strip: stripCv ? [stripCv.width, stripCv.height] : null,
      canvas: cv ? [cvW, cvH] : null, inDom: !!(cv && cv.isConnected), err: DR._err || '',
      stripes: stats.stripes, stripeMs: stats.stripeMs, stripeMax: stats.stripeMax, stripeRows: stats.stripeRows, deferred: stats.deferred, pending: pend.length + stale.length,
      strips: stats.strips, copies: stats.copies, frames: stats.frames,
      deferredRasters: stats.deferredRasters || 0, rasterDeferredHits: stats.rasterDeferredHits || 0, pendRaster: pendRaster, lensIconRasters: stats.lensIconRasters || 0, lensWarm: stats.lensWarm || 0, fuseWarm: stats.fuseWarm || 0, lcKey: !!lcKey,
      surfaces: Object.keys(surf).map(function (k) { var s = surf[k]; return { id: k, canvas: s.c ? [s.c.width, s.c.height] : null, on: s.c ? s.c.classList.contains('on') : !!(s.el && s.el.classList.contains('lg-band')), inDom: s.c ? s.c.isConnected : !!(s.el && s.el.isConnected), shape: !!s.shape, k: s.k }; }),
      light: { src: light.src, x: Math.round(light.x * 1000) / 1000, y: Math.round(light.y * 1000) / 1000 }, press: { dock: press.dock, live: press.live },
      ext: cv && cv._key ? 1 : 0, cvRadius: cv ? cv.style.borderRadius : '', lens: !!(bar && bar.classList.contains('lg-lens')), ep: stats.ep || 0, lensT: lensR ? { x: Math.round(lensR.x), y: Math.round(lensR.y), w: Math.round(lensR.w), h: Math.round(lensR.h), m: Math.round(lensM * 100) / 100, a: Math.round(lensA * 100) / 100, fuse: lensFx.fuse || 0, hl: Math.round((lensFx.hl || 0) * 100) / 100, flash: Math.round((lensFx.flash || 0) * 100) / 100 } : null,
      box: stats.box || null, shape: stats.shape || null, snap: stats.snap == null ? null : stats.snap, snapOrb: stats.snapOrb == null ? null : stats.snapOrb,
      idle: !!(on && ready && !dirty && !rasterTimer && !stripeTimer && !settleTimer && !pend.length)
    };
  };
  DR._raster = function () { doRaster(); };
  DR._stripe = function (force) { stripePass(!!force); };
  DR._draw = function () { draw(); };
  DR._q = function (q) { if (q != null) { quality = q; schedule(); } return quality; };
  DR._meta = function () { return { page: pageMeta, strip: stripMeta, inWin: inWindow() }; };
  DR._snap = function () { return pageCv ? pageCv.toDataURL() : ''; };
  DR._light = function (x, y, src) { light.tx = light.x = x; light.ty = light.y = y; light.src = src || 'test'; light.tiltAt = Date.now(); schedule(); };
  global.DockRefract = DR;
})(window);
