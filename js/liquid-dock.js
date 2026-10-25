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
    var on = canRefract() && settingsAllow();
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
      bar.insertBefore(thumb, bar.firstChild);
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
    }
    lastRect = r;
  }

  /* 按下：整条胶囊下沉 + 水滴鼓起；松开回弹（用 scale 属性，不覆盖居中用的 transform） */
  function onDown(e) {
    if (reduced || !bar) return;
    var t = e.target && e.target.closest && e.target.closest('button');
    if (!t || !bar.contains(t)) return;
    bar.classList.add('lg-press');
    if (thumb && t.classList.contains('active')) thumb.classList.add('lg-grow');
  }
  function onUp() {
    if (!bar) return;
    bar.classList.remove('lg-press');
    if (thumb) thumb.classList.remove('lg-grow');
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
          global.requestAnimationFrame ? requestAnimationFrame(refresh) : refresh();
          return;
        }
      });
      mo.observe(bar, { childList: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true, subtree: true });
    }
    if (global.ResizeObserver) { ro = new ResizeObserver(function () { place(false); updateRefraction(); }); ro.observe(bar); }
    bar.addEventListener('pointerdown', onDown, { passive: true });
    global.addEventListener('pointerup', onUp, { passive: true });
    global.addEventListener('pointercancel', onUp, { passive: true });
    place(false); updateRefraction();
  };
  LD._state = function () { return { refract: refractOn, thumb: !!(thumb && thumb.classList.contains('on')), map: mapKey }; };

  global.LiquidDock = LD;
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', function () { setTimeout(LD.init, 0); });
  else setTimeout(LD.init, 0);
})(window);
