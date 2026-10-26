/**
 * dock-refract.js — 第 275 次：iOS（WebKit）上 dock 的「真折射」液态玻璃（试做）
 *
 * 为什么要单独做：
 *   第 235 次的折射走 backdrop-filter: url(#svg位移贴图)，只有 Chromium 支持；
 *   iOS 上所有浏览器都是 WebKit，backdrop-filter 里写 url() 整块玻璃会消失，所以 iOS 只有模糊 + 高光。
 *
 * 参考过的开源项目（只借思路、未拷贝代码，三者均为 MIT）：
 *   · naughtyduk/liquidGL（MIT）：把页面「快照」成一张纹理交给 WebGL，滚动时只改采样偏移，不重拍。
 *   · samasante/liquid-glass（MIT）：普通 filter:url() 作用在内容自身，WebKit 可用，但要把背景内容复制一份。
 *   · amnn-in/glasskit（MIT）：CSS / SVG / DOM 克隆 / WebGL 四种引擎可切换，克隆模式要逐帧同步克隆层位置。
 *   选 liquidGL 的路子（快照 + WebGL），理由：
 *   ① DOM 克隆要把整页复制一份（节点翻倍、querySelectorAll 会捞到克隆、画布克隆是空白、
 *     计时文字每秒变化要跟着改），且 SVG 滤镜在 WebKit 里每个滚动帧都要软件重算；
 *   ② html2canvas / foreignObject 截图在 Safari 会污染画布，WebGL 读不了；
 *   所以这里自带一个「够用」的小光栅器：把 #view 里的卡片底色 / 渐变 / 圆角 / 图片 / 画布 / 文字
 *   按页面坐标画进一张低分辨率（每 2 个 CSS 像素一个纹素）的离屏画布，整页一张纹理；
 *   滚动时着色器只改采样偏移，主线程每帧只有一次 uniform 更新和一次绘制。
 *
 * 画法（与 Kyant backdrop / liquid-dock.js 同一套公式）：
 *   · 只画胶囊边缘一圈（宽 band）——圆角矩形距离场，越靠边按 circleMap 往外偏移采样（把背景「拉弯」）；
 *   · 色散：R / G / B 三个通道偏移量不同（蓝最大）；高光：法线与左上 45° 光线的点积；
 *   · 中间仍是原来实时的 backdrop-filter 模糊（真实、永远不会与页面错位），边缘一圈透明度渐变过渡；
 *     即使快照与页面有细微出入，也只出现在被拉弯的那一圈里。
 *
 * 何时开：仅 WebKit / 非 Chromium（Chromium 走第 235 次的 SVG 路径）；设置「真实玻璃折射」开、
 *   「dock 液态玻璃折射」开；高对比 / 减少透明度时关；减少动态效果时只在静止时重拍、不跟随动画。
 *   「自动」档下首次快照超过 120ms（低端机）就自动关闭本次会话的折射，回落为原来的模糊玻璃。
 *
 * 资源：全程只有 1 个 WebGL 上下文、2 张纹理（整页快照 + 视口底色条）、1 个缓冲；重拍复用同一张纹理
 *   （尺寸不变用 texSubImage2D）。关掉开关 / 降级时 stop()：取消 rAF 与定时器、断开观察器、
 *   删纹理 / 程序 / 缓冲、loseContext、移除画布、两张离屏画布缩成 0×0。
 */
(function (global) {
  'use strict';
  var doc = global.document;
  if (!doc) return;

  var DR = {};
  var S_MAX = 0.5;          /* 快照分辨率：每 CSS 像素 0.5 纹素 */
  var TEX_MAX = 4096;       /* iOS 最大纹理边长的稳妥值；超长页面整体降分辨率 */
  var SLOW_MS = 150;        /* 自动档：快照超过这个就判为「性能不够」（不算第一次——首次要建字形缓存、解码图片） */
  var BAND = 15;            /* 折射边带宽（CSS px） */

  var bar = null, cv = null, gl = null, prog = null, buf = null, texP = null, texB = null, U = {};
  var pageCv = null, pctx = null, stripCv = null, sctx = null;
  var on = false, ready = false, lost = false, dirty = true, hiddenForNav = false;
  var raf = 0, rasterTimer = 0, scrollIdleTimer = 0, scrolling = false, lastRaster = 0, slowHits = 0, disabledReason = '';
  /* 画质档：2 = 2 倍像素 + 9 点模糊；1 = 1 倍像素 + 5 点；0 = 只在静止时折射（滚动时边缘淡出）。
     滚动中连续 40 帧中位帧间隔 > 22ms（不到 45fps）就降一档，本次会话不再升回 */
  var quality = 2, fq = [], fqLast = 0;
  var mo = null, moBody = null, ro = null, roView = null, bodyKey = '', animWait = 0, settleTimer = 0;
  var pageMeta = { w: 0, h: 0, s: S_MAX, sx: 0, sy: 0 }, stripMeta = { x: 0, y: 0, w: 1, h: 1, opaque: false };
  var stats = { ctxCreated: 0, ctxLive: 0, texLive: 0, texCreated: 0, rasters: 0, rasterMs: 0, rasterMax: 0, draws: 0, uploadsRealloc: 0, uploadsSub: 0, nodes: 0 };
  var reduced = false;
  try { reduced = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* */ }
  var IMG = {};             /* 背景图 url → Image（同源，已在 SW 缓存里） */

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
    var cs = global.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    if (el.hasAttribute && el.hasAttribute('data-lg-skip')) return;
    var pos = cs.position;
    if (pos === 'fixed' || pos === 'sticky') return;  /* 视口坐标 / 吸附的东西不进整页快照（多是 dock 上方的主按钮条） */
    var op = parseFloat(cs.opacity); if (!(op >= 0)) op = 1;
    alpha *= op; if (alpha < 0.03) return;
    var r = el.getBoundingClientRect();
    if (r.bottom < cullTop || r.top > cullBot) return;   /* 快照段之外的整棵子树不画 */
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

  /* 视口底色条：dock 周围一块（视口坐标），先铺 body 背景，再盖 dock 之下的全屏层（白噪音播放页等） */
  function rasterStrip(dock) {
    var m = BAND + 24;
    var x = Math.max(0, dock.left - m), y = Math.max(0, dock.top - m);
    var w = Math.min(global.innerWidth, dock.right + m) - x, h = Math.min(global.innerHeight, dock.bottom + m) - y;
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
    stripMeta = { x: x, y: y, w: w, h: h, opaque: opaque, fade: fade };
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

  /* 只拍「当前视口上方 0.75 屏 ~ 下方 0.75 屏」这一段（共 2.5 屏高），纹理尺寸基本固定、可原地复用；
     滚出这段时停下再重拍（期间边缘折射淡出，中间照旧是实时模糊） */
  var WIN_UP = 0.75, WIN_DOWN = 1.75;
  var cullTop = -1e9, cullBot = 1e9;
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
    var roots = [doc.querySelector('#app > .app-header'), doc.getElementById('view')];
    for (var i = 0; i < roots.length; i++) if (roots[i]) walk(pctx, roots[i], 1, 0);
    cullTop = -1e9; cullBot = 1e9;
    pageMeta = { w: W, h: H, s: s, y0: y0, y1: y1 };
  }
  /* 当前 dock 的采样范围是否还在快照这一段里 */
  function inWindow() {
    if (!bar || pageMeta.y1 == null) return false;
    var r = bar.getBoundingClientRect(), sy = global.scrollY || 0, m = BAND + 16;
    var top = r.top - m + sy, bot = r.bottom + m + sy;
    var dh = doc.documentElement.scrollHeight;
    return top >= pageMeta.y0 - 1 && (bot <= pageMeta.y1 + 1 || pageMeta.y1 >= dh - 1);
  }

  /* ---------- WebGL ---------- */
  var VS = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';
  var FS = [
    'precision highp float;',
    'uniform sampler2D uP,uB;uniform vec2 uCv,uPS,uScroll;uniform vec4 uDock,uStrip,uTint,uFade;uniform vec3 uFadeC;',
    'uniform float uTaps,uS,uY0,uPageOn,uBand,uAmt,uDisp,uBlur,uSpec,uDark,uDbg;',
    'float sdR(vec2 p,vec2 b,float r){vec2 q=abs(p)-b+r;return length(max(q,0.))+min(max(q.x,q.y),0.)-r;}',
    'vec3 bg(vec2 v){',
    '  vec4 b=texture2D(uB,(v-uStrip.xy)/uStrip.zw);',
    '  vec4 p=texture2D(uP,(v+uScroll-vec2(0.,uY0))*uS/uPS)*uPageOn;',
    '  vec3 c=p.rgb+b.rgb*(1.-p.a);',
    '  float fa=uFade.w>0.?clamp((v.y-uFade.x)/uFade.y,0.,1.)*uFade.w:0.;',
    '  return mix(c,uFadeC,fa);}',
    'void main(){',
    '  vec2 f=vec2(gl_FragCoord.x,uCv.y-gl_FragCoord.y)/uCv*uDock.zw;',
    '  vec2 h=uDock.zw*.5;vec2 p=f-h;float r=min(h.x,h.y);',
    '  float sd=sdR(p,h,r);',
    '  if(sd>.5){gl_FragColor=vec4(0.);return;}',
    '  float d=-sd;',
    '  vec2 e=vec2(.5,0.);',
    '  vec2 n=normalize(vec2(sdR(p+e.xy,h,r)-sdR(p-e.xy,h,r),sdR(p+e.yx,h,r)-sdR(p-e.yx,h,r))+1e-5);',
    '  float t=clamp(1.-d/uBand,0.,1.);',
    '  float m=(1.-sqrt(max(0.,1.-t*t)))*uAmt;',
    '  vec2 dir=normalize(n+.25*p/max(length(p),1e-3));',
    '  vec2 o=dir*m;vec2 v=uDock.xy+f;',
    '  vec3 c=vec3(0.);',
    '  float nt=0.;',
    '  for(int i=0;i<9;i++){',
    '    if(float(i)>=uTaps)break;nt+=1.;',
    '    float a=float(i)*2.39996;float rr=i==0?0.:uBlur*sqrt(float(i)/(uTaps-1.));',
    '    vec2 k=vec2(cos(a),sin(a))*rr;',
    '    c.r+=bg(v+o*(1.+uDisp)+k).r;c.g+=bg(v+o+k).g;c.b+=bg(v+o*(1.-uDisp)+k).b;}',
    '  c/=nt;',
    '  float l=dot(c,vec3(.2126,.7152,.0722));c=clamp(mix(vec3(l),c,1.9)*1.04,0.,1.);',
    '  c=mix(c,uTint.rgb,uTint.a);',
    '  float sp=pow(abs(dot(n,vec2(-.7071,-.7071))),3.)*(1.-smoothstep(0.,3.,d))*uSpec;',
    '  c=min(c+sp,1.);',
    '  float al=(1.-smoothstep(uBand*.45,uBand+5.,d))*clamp(.5-sd,0.,1.);',
    '  if(uDbg>.5){c=bg(v);al=clamp(.5-sd,0.,1.);}',
    '  gl_FragColor=vec4(c*al,al);}'
  ].join('\n');

  function mkTex() {
    var t = gl.createTexture(); stats.texCreated++; stats.texLive++;
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
  function initGL() {
    var opts = { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'low-power' };
    gl = cv.getContext('webgl', opts) || cv.getContext('experimental-webgl', opts);
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
    ['uP', 'uB', 'uCv', 'uPS', 'uScroll', 'uDock', 'uStrip', 'uTint', 'uFade', 'uFadeC', 'uTaps', 'uS', 'uY0', 'uPageOn', 'uBand', 'uAmt', 'uDisp', 'uBlur', 'uSpec', 'uDark', 'uDbg'].forEach(function (k) { U[k] = gl.getUniformLocation(prog, k); });
    texP = mkTex(); texB = mkTex();
    gl.uniform1i(U.uP, 0); gl.uniform1i(U.uB, 1);
    return true;
  }
  function freeGL(lose) {
    if (gl) {
      try {
        if (texP) gl.deleteTexture(texP); if (texB) gl.deleteTexture(texB);
        if (buf) gl.deleteBuffer(buf); if (prog) gl.deleteProgram(prog);
      } catch (e) { /* */ }
      stats.texLive = 0;
      if (lose) { var ext = gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext(); }
    }
    gl = null; prog = null; buf = null; texP = null; texB = null; U = {}; stats.ctxLive = 0;
  }

  /* ---------- 绘制 ---------- */
  function sizeCanvas(r) {
    var dpr = quality >= 2 ? Math.min(global.devicePixelRatio || 1, 2) : 1;
    var W = Math.max(2, Math.round(r.width * dpr)), H = Math.max(2, Math.round(r.height * dpr));
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  }
  function draw(ts) {
    raf = 0;
    if (scrolling && ts) frameCheck(ts);
    if (quality === 0 && scrolling) return;
    if (!on || !ready || lost || !gl || !bar) return;
    var t0 = global.performance ? performance.now() : 0;
    var r = bar.getBoundingClientRect();
    if (r.width < 20 || r.height < 20) return;
    /* 滚出快照段：边缘折射先淡出，停下后重拍 */
    if (!stripMeta.opaque && !inWindow()) { cv.classList.remove('on'); dirty = true; if (!scrolling) markDirty(); return; }
    if (!hiddenForNav && !cv.classList.contains('on')) cv.classList.add('on');
    var cr = cv.getBoundingClientRect();   /* 画布比胶囊大 1px 一圈（盖住透明边框） */
    var dock = cr.width > 20 ? { left: cr.left, top: cr.top, width: cr.width, height: cr.height } : { left: r.left, top: r.top, width: r.width, height: r.height };
    sizeCanvas(dock);
    gl.viewport(0, 0, cv.width, cv.height);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texP);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texB);
    gl.uniform2f(U.uCv, cv.width, cv.height);
    gl.uniform2f(U.uPS, pageMeta.w, pageMeta.h);
    gl.uniform2f(U.uScroll, global.scrollX || 0, global.scrollY || 0);
    gl.uniform4f(U.uDock, dock.left, dock.top, dock.width, dock.height);
    gl.uniform4f(U.uStrip, stripMeta.x, stripMeta.y, stripMeta.w, stripMeta.h);
    var tint = parseColor(global.getComputedStyle(bar).backgroundColor) || [255, 255, 255, 0.3];
    gl.uniform4f(U.uTint, tint[0] / 255, tint[1] / 255, tint[2] / 255, tint[3]);
    var fd = stripMeta.fade;
    gl.uniform4f(U.uFade, fd ? fd.top : 0, fd ? Math.max(1, fd.h) : 1, 0, fd ? fd.c[3] : 0);
    gl.uniform3f(U.uFadeC, fd ? fd.c[0] / 255 : 0, fd ? fd.c[1] / 255 : 0, fd ? fd.c[2] / 255 : 0);
    gl.uniform1f(U.uS, pageMeta.s);
    gl.uniform1f(U.uTaps, quality >= 2 ? 9 : 5);
    gl.uniform1f(U.uY0, pageMeta.y0 || 0);
    gl.uniform1f(U.uPageOn, stripMeta.opaque ? 0 : 1);
    var dark = doc.body.classList.contains('dark');
    gl.uniform1f(U.uBand, Math.min(BAND, dock.height / 2 - 2, dock.width / 2 - 2));
    gl.uniform1f(U.uAmt, 12);
    gl.uniform1f(U.uDisp, 0.22);
    gl.uniform1f(U.uBlur, 4.5);
    gl.uniform1f(U.uSpec, dark ? 0.18 : 0.32);
    gl.uniform1f(U.uDark, dark ? 1 : 0);
    gl.uniform1f(U.uDbg, DR._debug ? 1 : 0);   /* 调试：整块显示快照本身（不折射、不调色），用来核对快照与页面是否对齐 */
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    stats.draws++;
    if (global.performance) stats.drawMs = Math.round((performance.now() - t0) * 100) / 100;
  }
  function schedule() { if (on && !raf) raf = global.requestAnimationFrame(draw); }

  function doRaster() {
    rasterTimer = 0;
    if (!on || !gl || lost) return;
    if (scrolling) { rasterTimer = setTimeout(doRaster, 220); return; }
    if (doc.documentElement.hasAttribute('data-nav')) { rasterTimer = setTimeout(doRaster, 160); return; }
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
    animWait = 0;
    /* 启动动画还在播：不和它抢主线程，等它结束 */
    if (doc.documentElement.classList.contains('is-booting')) { rasterTimer = setTimeout(doRaster, 300); return; }
    var t0 = performance.now();
    stats.nodes = 0;
    try {
      rasterPage();
      rasterStrip(bar.getBoundingClientRect());
    } catch (e) { DR._err = String(e); return; }
    upload(texP, pageCv); upload(texB, stripCv);
    var ms = performance.now() - t0;
    stats.rasters++; stats.rasterMs = Math.round(ms * 10) / 10; stats.rasterMax = Math.max(stats.rasterMax, stats.rasterMs);
    lastRaster = Date.now(); dirty = false; ready = true;
    /* 自动档的性能闸门：连续两次快照都慢 → 本次会话关掉折射 */
    if (ms > SLOW_MS && stats.rasters > 1 && setting().dockGlass !== 'on') {
      if (++slowHits >= 2) { disabledReason = 'slow:' + Math.round(ms) + 'ms'; DR.stop(); return; }
    } else slowHits = 0;
    /* 换页后的第一次快照之后，1.2 秒再补拍一次：图片晚到、进场位移、天气卡异步填充都会让版面再动一下 */
    if (hiddenForNav) { hiddenForNav = false; settleTimer = setTimeout(function () { settleTimer = 0; markDirty(); }, 1200); }
    cv.classList.add('on');
    draw();
  }
  function markDirty(urgent) {
    dirty = true;
    if (!on) return;
    if (urgent) { hiddenForNav = true; if (cv) cv.classList.remove('on'); }
    if (rasterTimer) clearTimeout(rasterTimer);
    var since = Date.now() - lastRaster;
    var wait = urgent ? 120 : Math.max(300, 1200 - since);
    rasterTimer = setTimeout(function () {
      if (global.requestIdleCallback && !urgent) global.requestIdleCallback(doRaster, { timeout: 800 }); else doRaster();
    }, wait);
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
  function onScroll() {
    if (quality === 0) {
      /* 最低档：滚动时边缘折射淡出（中间实时模糊照旧），停下后对齐再显示 */
      if (cv) cv.classList.remove('on');
      scrolling = true;
      if (scrollIdleTimer) clearTimeout(scrollIdleTimer);
      scrollIdleTimer = setTimeout(function () { scrolling = false; scrollIdleTimer = 0; if (dirty || !inWindow()) markDirty(); else schedule(); }, 180);
      return;
    }
    scrolling = true;
    if (scrollIdleTimer) clearTimeout(scrollIdleTimer);
    scrollIdleTimer = setTimeout(function () { scrolling = false; scrollIdleTimer = 0; if (dirty) markDirty(); }, 180);
    if (!reduced) schedule();
    else { /* 减少动态效果：滚动时不逐帧跟随，停下再画 */ clearTimeout(DR._rt); DR._rt = setTimeout(schedule, 200); }
  }
  function onResize() { markDirty(true); }
  function onVis() { if (doc.visibilityState === 'visible' && on) markDirty(); }
  function onLost(e) { e.preventDefault(); lost = true; ready = false; if (cv) cv.classList.remove('on'); }
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
    if (!pageCv) { pageCv = doc.createElement('canvas'); pctx = pageCv.getContext('2d'); }
    if (!stripCv) { stripCv = doc.createElement('canvas'); sctx = stripCv.getContext('2d'); }
    if (!pctx || !sctx || !initGL()) { freeGL(true); cv = null; disabledReason = disabledReason || 'no-webgl'; return false; }
    cv.addEventListener('webglcontextlost', onLost, false);
    cv.addEventListener('webglcontextrestored', onRestored, false);
    on = true; ready = false;
    DR.attach(bar);
    doc.documentElement.classList.add('lg-gl');
    global.addEventListener('scroll', onScroll, { passive: true });
    global.addEventListener('resize', onResize, { passive: true });
    doc.addEventListener('visibilitychange', onVis);
    var view = doc.getElementById('view');
    if (global.MutationObserver) {
      mo = new MutationObserver(function (list) {
        var big = false;
        for (var i = 0; i < list.length; i++) if (list[i].target === view && list[i].type === 'childList') { big = true; break; }
        markDirty(big);
      });
      if (view) mo.observe(view, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'src', 'hidden', 'open'], characterData: true });
      moBody = new MutationObserver(function () {
        /* 高对比等切换：不该开了就整个停掉（liquid-dock 顺带把模糊玻璃的状态刷新） */
        if (!DR.wanted()) { if (global.LiquidDock && LiquidDock.refresh) LiquidDock.refresh(); else DR.stop(); return; }
        var cl = doc.body.classList, k = [cl.contains('dark'), cl.contains('hc'), cl.contains('dock-left'), cl.contains('dock-right')].join();
        if (k === bodyKey) return;   /* in-home / qd-open 之类不影响背后的画面 */
        bodyKey = k; markDirty(true);
      });
      moBody.observe(doc.body, { attributes: true, attributeFilter: ['class'] });
    }
    if (global.ResizeObserver) {
      ro = new ResizeObserver(function () { schedule(); }); ro.observe(bar);
      /* 页面内容高度变了（图片载入、折叠展开）= 版面挪了，快照要重拍 */
      if (view) { roView = new ResizeObserver(function () { markDirty(); }); roView.observe(view); }
    }
    markDirty(true);
    return true;
  };
  /* 底栏被 app.js 整个重建后，把同一块画布放回第一个子节点（在水滴指示器之前，水滴画在它上面） */
  DR.attach = function (b) {
    if (!on || !cv) return;
    if (b && b !== bar) { if (ro) { ro.disconnect(); ro.observe(b); } bar = b; }
    if (bar.firstChild !== cv) bar.insertBefore(cv, bar.firstChild);
    schedule();
  };
  DR.stop = function () {
    if (!on && !cv) return;
    on = false; ready = false;
    if (raf) global.cancelAnimationFrame(raf); raf = 0;
    if (rasterTimer) clearTimeout(rasterTimer); rasterTimer = 0;
    if (scrollIdleTimer) clearTimeout(scrollIdleTimer); scrollIdleTimer = 0;
    if (settleTimer) clearTimeout(settleTimer); settleTimer = 0;
    if (mo) mo.disconnect(); if (moBody) moBody.disconnect(); if (ro) ro.disconnect(); if (roView) roView.disconnect();
    mo = moBody = ro = roView = null;
    global.removeEventListener('scroll', onScroll);
    global.removeEventListener('resize', onResize);
    doc.removeEventListener('visibilitychange', onVis);
    if (cv) { cv.removeEventListener('webglcontextlost', onLost); cv.removeEventListener('webglcontextrestored', onRestored); }
    freeGL(true);
    if (cv && cv.parentNode) cv.parentNode.removeChild(cv);
    if (cv) { cv.width = 0; cv.height = 0; }
    cv = null;
    if (pageCv) { pageCv.width = 0; pageCv.height = 0; } if (stripCv) { stripCv.width = 0; stripCv.height = 0; }
    pageCv = stripCv = pctx = sctx = null;
    IMG = {}; range = null;
    doc.documentElement.classList.remove('lg-gl');
  };
  /* liquid-dock.js 每次刷新（建好 / 重建底栏 / 换设置）都会调它 */
  DR.sync = function (b) {
    if (DR.wanted()) { if (!on) DR.start(b); else DR.attach(b); }
    else if (on) DR.stop();
    return on;
  };
  DR.reset = function () { disabledReason = ''; slowHits = 0; };
  DR.isOn = function () { return on && ready; };
  DR._stats = function () {
    return {
      on: on, ready: ready, reason: disabledReason, ctxCreated: stats.ctxCreated, ctxLive: stats.ctxLive,
      texLive: stats.texLive, texCreated: stats.texCreated, rasters: stats.rasters, rasterMs: stats.rasterMs, rasterMax: stats.rasterMax,
      quality: quality, downgrades: stats.downgrades || 0, nodes: stats.nodes, draws: stats.draws, drawMs: stats.drawMs, uploadsRealloc: stats.uploadsRealloc, uploadsSub: stats.uploadsSub,
      page: pageCv ? [pageCv.width, pageCv.height] : null, strip: stripCv ? [stripCv.width, stripCv.height] : null,
      canvas: cv ? [cv.width, cv.height] : null, inDom: !!(cv && cv.isConnected), err: DR._err || ''
    };
  };
  DR._raster = function () { doRaster(); };
  DR._draw = function () { draw(); };
  DR._q = function (q) { if (q != null) { quality = q; schedule(); } return quality; };
  DR._meta = function () { return { page: pageMeta, strip: stripMeta, inWin: inWindow() }; };
  DR._snap = function () { return pageCv ? pageCv.toDataURL() : ''; };
  global.DockRefract = DR;
})(window);
