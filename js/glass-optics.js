/**
 * glass-optics.js — 第 312 次：dock / 透镜共用的「真液态玻璃」光学模块
 *
 * 参考（只借算法与参数，没有整套引入）：
 *   · kube.io《Liquid Glass in the browser: refraction with CSS and SVG》：
 *     凸 squircle 截面 y = (1 − (1 − x)^4)^(1/4)；按 Snell 定律（n = 1.5）沿 bezel 半径预算 127 个位移量，
 *     归一化后按边界法线方向写进 R/G 位移图，feDisplacementMap 的 scale = 最大位移；
 *     凸面让光线往里取样（不会取到玻璃外面）；高光是按固定光照角的边缘 rim light，混入时对背景提饱和。
 *   · Glass-HQ/liquid-glass（core/optics.ts、core/materials.ts、dom/material-graph.ts）：
 *     regular 材质 = 模糊 7.33 + 23px 宽模糊 lighten 混 34% + 色调曲线 [0.36, 0.67, −0.1113]（权重 0.8）+ chroma 1.10；
 *     深色 = 21.8px 宽模糊 darken 混 65% + [0.105, 0.83, −0.2091]（权重 0.9）+ chroma 1.0648。
 *     它的 WebGPU 渲染在 Safari / 手机上还不稳，所以这里只用 canvas 生成贴图、SVG 滤镜（Chromium）和 WebGL1 着色器（iOS）。
 *
 * 全部纯函数 + 结果缓存：位移图 / 高光图只在尺寸、参数变化时重建；拖动时调用方只改 scale / uniform。
 */
(function (global) {
  'use strict';
  var doc = global.document;
  var GO = {};

  /* ---------- 1. 截面与 Snell 位移表 ---------- */
  /* 凸 squircle：x ∈ [0,1]，0 = 玻璃外沿，1 = bezel 内侧（平顶开始） */
  GO.surface = function (x) { x = Math.max(0, Math.min(1, x)); return Math.pow(1 - Math.pow(1 - x, 4), 0.25); };

  /* 竖直入射的光线穿过曲面（法线由截面导数给出），按 Snell 折射后走到玻璃底面，横向走了多远 = 位移。
     height = bezel 高度 / bezel 宽度（越大越「鼓」），base = 平顶以下的玻璃厚度。返回归一化到 [0,1] 的 N 个值，正 = 往里。 */
  var tableCache = {};
  GO.table = function (o) {
    o = o || {};
    var n = o.n || 1.5, N = o.samples || 127, H = o.height == null ? 1 : o.height, base = o.base == null ? 0.2 : o.base;
    var key = [n, N, H, base].join(',');
    if (tableCache[key]) return tableCache[key];
    var raw = new Float32Array(N), max = 0, eta = 1 / n;
    for (var i = 0; i < N; i++) {
      var x = i / (N - 1), e = 1e-4, a = Math.max(0, x - e), b = Math.min(1, x + e);
      var y = H * GO.surface(x), dy = H * (GO.surface(b) - GO.surface(a)) / (b - a);
      var L = Math.sqrt(dy * dy + 1), nx = -dy / L, nz = 1 / L;     /* 曲面朝上的法线（x 往里为正） */
      var cosi = nz, k = 1 - eta * eta * (1 - cosi * cosi), d = 0;
      if (k >= 0) {
        var c = eta * cosi - Math.sqrt(k), tx = c * nx, tz = -eta + c * nz;
        d = tz < -1e-6 ? tx / -tz * (y + base) : 0;
      }
      raw[i] = Math.max(0, d); if (raw[i] > max) max = raw[i];
    }
    for (var j = 0; j < N; j++) raw[j] = max > 0 ? raw[j] / max : 0;
    raw.maxRaw = max;
    tableCache[key] = raw;
    return raw;
  };
  /* t = 离外沿的距离 / bezel 宽（0..1），线性插值 */
  GO.sample = function (tab, t) {
    if (!(t >= 0) || t >= 1) return t >= 1 ? 0 : tab[0];
    var f = t * (tab.length - 1), i = Math.floor(f), r = f - i;
    return tab[i] * (1 - r) + (tab[Math.min(tab.length - 1, i + 1)] || 0) * r;
  };
  /* 给 WebGL 的 1D 纹理（128 × 1 RGBA，R = 位移） */
  GO.tableBytes = function (tab) {
    var W = 128, out = new Uint8Array(W * 4);
    for (var i = 0; i < W; i++) {
      var v = Math.round(255 * Math.max(0, Math.min(1, i < tab.length ? tab[i] : 0)));
      out[i * 4] = v; out[i * 4 + 1] = v; out[i * 4 + 2] = v; out[i * 4 + 3] = 255;
    }
    return out;
  };

  /* ---------- 2. 圆角矩形距离场与法线 ---------- */
  GO.sdRR = function (px, py, hx, hy, r) {
    var cx = Math.abs(px) - (hx - r), cy = Math.abs(py) - (hy - r);
    var ox = Math.max(cx, 0), oy = Math.max(cy, 0);
    return Math.sqrt(ox * ox + oy * oy) - r + Math.min(Math.max(cx, cy), 0);
  };
  /* 外法线（有限差分，圆角处连续） */
  GO.normalRR = function (px, py, hx, hy, r) {
    var gx = GO.sdRR(px + 0.5, py, hx, hy, r) - GO.sdRR(px - 0.5, py, hx, hy, r);
    var gy = GO.sdRR(px, py + 0.5, hx, hy, r) - GO.sdRR(px, py - 0.5, hx, hy, r);
    var l = Math.sqrt(gx * gx + gy * gy) || 1;
    return [gx / l, gy / l];
  };

  /* ---------- 3. 光照 ---------- */
  /* 固定光照角 −60°（屏幕坐标，y 朝下：从左上偏顶部打来）；rim = |n·L|^power，两侧对边都亮（像 kube.io） */
  GO.LIGHT = -120;   /* 度：方向向量 (cos, sin) = (−0.5, −0.866)，即与水平线成 60°、来自左上 */
  GO.lightVec = function (deg) { var a = (deg == null ? GO.LIGHT : deg) * Math.PI / 180; return [Math.cos(a), Math.sin(a)]; };

  /* ---------- 4. 贴图 ---------- */
  function canvasOf(W, H) {
    var c = doc.createElement('canvas'); c.width = W; c.height = H;
    var g = c.getContext('2d');
    return g ? { c: c, g: g } : null;
  }
  /* 位移图：
     o.bezel   折射边宽（CSS px）    o.maxPx 最大位移（水平法线方向；o.maxPxV 竖直方向，默认同 maxPx）
     o.dir     +1 = 凸面往里取样（dock 本体），−1 = 往外取样（透镜：把透镜外的内容压成贴边的彩带）
     o.pad     四周留白（透镜往外取样要用）   o.K 每 CSS px 像素数   o.mask B 通道写形状遮罩
     o.zoom    中心放大（0 = 1:1；0.06 = 放大 6%，第二张「放大镜」位移叠在同一张图里）
     o.maxDown 往下取样最远到哪（视口底下没有背景）
     o.scaleHead 编码余量：±127 对应 ±(maxPx·scaleHead)
     返回 { url, scale(= feDisplacementMap 的 scale), W, H } */
  GO.dispMap = function (w, h, o) {
    o = o || {};
    var pad = o.pad || 0, K = o.K || 1, dir = o.dir == null ? 1 : o.dir;
    var r = o.radius == null ? Math.min(w, h) / 2 : o.radius;
    var bezel = Math.max(1, o.bezel || 16), mH = o.maxPx == null ? 12 : o.maxPx, mV = o.maxPxV == null ? mH : o.maxPxV;
    var tab = o.table || GO.table(o.optics);
    var MX = o.mx || Math.max(mH, mV) * (o.scaleHead || 1);
    var zoom = o.zoom || 0, lim = o.maxDown == null ? 1e9 : o.maxDown, kmax = o.kmax || 1;
    var CW = Math.max(2, Math.round((w + 2 * pad) * K)), CH = Math.max(2, Math.round((h + 2 * pad) * K));
    var cv = canvasOf(CW, CH); if (!cv) return null;
    var img = cv.g.createImageData(CW, CH), dd = img.data;
    var hx = w / 2, hy = h / 2;
    for (var j = 0; j < CH; j++) {
      for (var i = 0; i < CW; i++) {
        var x = (i + 0.5) / K - pad - hx, y = (j + 0.5) / K - pad - hy;
        var sd = GO.sdRR(x, y, hx, hy, r), d = -sd, ox = 0, oy = 0;
        if (sd < 1.5 && d < bezel) {
          var nv = GO.normalRR(x, y, hx, hy, r), ay = Math.abs(nv[1]);
          var m = GO.sample(tab, Math.max(0, d) / bezel) * (mH * (1 - ay) + mV * ay);
          if (dir > 0) { ox = -nv[0] * m; oy = -nv[1] * m; } else { ox = nv[0] * m; oy = nv[1] * m; }
          var yl = (hy + lim - 0.5 - y) / kmax;
          if (oy > yl) { var sc = Math.max(0, yl) / oy; oy *= sc; ox *= sc; }
        }
        if (zoom && sd < 0) { ox -= x * zoom / (1 + zoom); oy -= y * zoom / (1 + zoom); }
        var k = (j * CW + i) * 4;
        dd[k] = Math.round(128 + 127 * Math.max(-1, Math.min(1, ox / MX)));
        dd[k + 1] = Math.round(128 + 127 * Math.max(-1, Math.min(1, oy / MX)));
        dd[k + 2] = o.mask ? Math.round(255 * Math.max(0, Math.min(1, 0.5 - sd))) : 128;
        dd[k + 3] = 255;
      }
    }
    cv.g.putImageData(img, 0, 0);
    return { url: cv.c.toDataURL('image/png'), scale: 2 * MX, mx: MX, W: w + 2 * pad, H: h + 2 * pad };
  };
  /* 高光图（白色，alpha = 强度）：外沿 width px 内 |n·L|^power，另加一圈很淡的全周亮边 base */
  GO.specMap = function (w, h, o) {
    o = o || {};
    var pad = o.pad || 0, K = o.K || 1, r = o.radius == null ? Math.min(w, h) / 2 : o.radius;
    var width = o.width || 2.2, power = o.power || 2, base = o.base == null ? 0.18 : o.base, L = GO.lightVec(o.angle);
    var CW = Math.max(2, Math.round((w + 2 * pad) * K)), CH = Math.max(2, Math.round((h + 2 * pad) * K));
    var cv = canvasOf(CW, CH); if (!cv) return null;
    var img = cv.g.createImageData(CW, CH), dd = img.data, hx = w / 2, hy = h / 2;
    for (var j = 0; j < CH; j++) {
      for (var i = 0; i < CW; i++) {
        var x = (i + 0.5) / K - pad - hx, y = (j + 0.5) / K - pad - hy;
        var sd = GO.sdRR(x, y, hx, hy, r), a = 0;
        if (sd < 0.5 && -sd < width * 3) {
          var nv = GO.normalRR(x, y, hx, hy, r), ld = Math.abs(nv[0] * L[0] + nv[1] * L[1]);
          var fall = Math.exp(-Math.max(0, -sd) / width), cover = Math.max(0, Math.min(1, 0.5 - sd));
          a = Math.min(1, (base + (1 - base) * Math.pow(ld, power)) * fall) * cover;
        }
        var k = (j * CW + i) * 4;
        dd[k] = dd[k + 1] = dd[k + 2] = 255; dd[k + 3] = Math.round(255 * a);
      }
    }
    cv.g.putImageData(img, 0, 0);
    return { url: cv.c.toDataURL('image/png'), W: w + 2 * pad, H: h + 2 * pad };
  };

  /* ---------- 5. 材质（Glass-HQ regular / clear） ---------- */
  GO.MAT = {
    regular: {
      blur: 7.33,
      light: { fillSigma: 23, fillOpacity: 0.34, tone: [0.36, 0.67, -0.1113], toneWeight: 0.8, chroma: 1.10, blend: 'lighten' },
      dark: { fillSigma: 21.8, fillOpacity: 0.65, tone: [0.105, 0.83, -0.2091], toneWeight: 0.9, chroma: 1.0648, blend: 'darken' }
    },
    clear: { light: { shadowLift: 0.18, highlightRolloff: 0 }, dark: { shadowLift: 0.15, highlightRolloff: 0.2 } },
    specSat: 7    /* 高光处背景提饱和（kube.io specular saturation 6~9） */
  };
  GO.toneTable = function (dark) {
    var s = dark ? GO.MAT.regular.dark : GO.MAT.regular.light, out = [];
    for (var n = 0; n <= 32; n++) {
      var v = n / 32, t = s.tone[0] + s.tone[1] * v + s.tone[2] * v * v;
      out.push((s.toneWeight * t + (1 - s.toneWeight) * v).toFixed(4));
    }
    return out.join(' ');
  };
  /* 色调曲线的线性近似（给不支持 SVG 滤镜的 CSS backdrop-filter 与 WebGL 用，二者一致）：
     out = brightness · ((v − .5)·contrast + .5)，两端与曲线重合 */
  GO.toneLinear = function (dark) {
    var s = dark ? GO.MAT.regular.dark : GO.MAT.regular.light, w = s.toneWeight;
    var f = function (v) { var t = s.tone[0] + s.tone[1] * v + s.tone[2] * v * v; return w * t + (1 - w) * v; };
    var y0 = f(0), y1 = f(1), kc = y1 - y0, k = 2 * (y0 + kc / 2);
    return { contrast: kc / k, brightness: k, chroma: s.chroma };
  };
  /* SVG 滤镜片段：输入 input，输出 p + 'col'。透明边先把 alpha 归一回 1（feComponentTransfer 在非预乘空间里做，
     等于模糊在边上「只对玻璃里的像素取平均」，不会把边缘洗成透明 / 发黑） */
  GO.frostSVG = function (p, input, dark, soften) {
    var s = dark ? GO.MAT.regular.dark : GO.MAT.regular.light, k = soften == null ? 1 : soften;
    var a1 = '<feComponentTransfer in="' + p + 'f0" result="' + p + 'f1"><feFuncA type="linear" slope="0" intercept="1"/></feComponentTransfer>';
    var a2 = '<feComponentTransfer in="' + p + 'w0" result="' + p + 'w1"><feFuncA type="linear" slope="0" intercept="1"/></feComponentTransfer>';
    var tt = GO.toneTable(dark);
    return '<feGaussianBlur in="' + input + '" stdDeviation="' + (GO.MAT.regular.blur * k).toFixed(2) + '" result="' + p + 'f0"/>' + a1
      + '<feGaussianBlur in="' + input + '" stdDeviation="' + (s.fillSigma * k).toFixed(2) + '" result="' + p + 'w0"/>' + a2
      + '<feBlend in="' + p + 'f1" in2="' + p + 'w1" mode="' + s.blend + '" result="' + p + 'bl"/>'
      + '<feComposite in="' + p + 'bl" in2="' + p + 'f1" operator="arithmetic" k2="' + s.fillOpacity + '" k3="' + (1 - s.fillOpacity).toFixed(2) + '" result="' + p + 'mix"/>'
      + '<feComponentTransfer in="' + p + 'mix" result="' + p + 'tone"><feFuncR type="table" tableValues="' + tt + '"/><feFuncG type="table" tableValues="' + tt + '"/><feFuncB type="table" tableValues="' + tt + '"/></feComponentTransfer>'
      + '<feColorMatrix in="' + p + 'tone" type="saturate" values="' + s.chroma + '" result="' + p + 'col"/>';
  };
  /* 高光混入：spec 图的 alpha 当遮罩，把提饱和的背景 + 白色 rim 叠到 base 上，输出 p + 'out' */
  GO.specSVG = function (p, base, spec, o) {
    o = o || {};
    var sat = o.sat == null ? GO.MAT.specSat : o.sat, white = o.white == null ? 0.55 : o.white, satA = o.satA == null ? 0.85 : o.satA;
    return '<feColorMatrix in="' + base + '" type="saturate" values="' + sat + '" result="' + p + 'ss"/>'
      + '<feComposite in="' + p + 'ss" in2="' + spec + '" operator="in" result="' + p + 'ssm"/>'
      + '<feComponentTransfer in="' + p + 'ssm" result="' + p + 'ssa"><feFuncA type="linear" slope="' + satA + '"/></feComponentTransfer>'
      + '<feComponentTransfer in="' + spec + '" result="' + p + 'rim"><feFuncA type="linear" slope="' + white + '"/></feComponentTransfer>'
      + '<feMerge result="' + p + 'out"><feMergeNode in="' + base + '"/><feMergeNode in="' + p + 'ssa"/><feMergeNode in="' + p + 'rim"/></feMerge>';
  };

  global.GlassOptics = GO;
})(window);
