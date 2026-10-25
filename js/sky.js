/**
 * sky.js — 程序化动态天空（Web 版 swiftui-sky）
 * 纯 Canvas、零依赖、零网络：由本地时钟 + 年内天数驱动昼夜曲线与季节色板。
 *
 * 对齐参考项目 github.com/zolplay-labs/swiftui-sky（Cali Baby 首页）的最终效果：
 * - 三停渐变（顶/中/底）：白天长治蓝→近白，黎明/黄昏顶部灰紫、地平线金奶油，夜晚紫罗兰；
 * - 大朵水彩积云占满画面、按时段染色（白天纯白 / 晨昏粉调 / 夜晚深紫剪影），缓慢漂移；
 * - 夜晚星星闪烁 + 偶发流星；晨昏在无日月圆盘的前提下，以地平线暖辉光表达「太阳在山那边」；
 * - 云与云絮作为预渲染精灵绘制（模糊内置于精灵本身，性能与参考实现思路一致）。
 * 背景忽略点击、对无障碍隐藏；尊重 prefers-reduced-motion；离开 DOM 自动停止。
 */
(function (global) {
  'use strict';

  /* 关键时段色板（顶 / 中 / 底，RGB），取样自参考项目 sky-preview.png 并做低饱和微调。
     第 55 次（夜色减负）：夜晚从饱和紫罗兰调轻调蓝（用户反馈「夜色有点重」）——
     提亮 ~15、紫味让给蓝味；夜云剪影同步跟随，保住「比夜空略浅一档」的云形可读性。 */
  var STOPS = {
    night: { top: [70, 74, 112],   mid: [108, 106, 148],   bottom: [168, 154, 184] },
    dawn:  { top: [203, 177, 215], mid: [238, 199, 200], bottom: [250, 231, 188] },
    /* 第 90 次（修「白色条」）：day.bottom 旧冷白值(246,244,243) → 253,249,244
       (#FDF9F4 = --bg-grad 首档暖奶油)。此前接缝带/veil 终档把冷白实色压在
       暖奶油页面上，问候卡与磁贴之间显出一道偏白的横条（用户实测反馈）。
       接缝两侧从"都假设对方是自己的颜色"改为真正同色；晨昏/夜晚的
       环境光下渗（golden/淡紫）保持不变。 */
    day:   { top: [167, 189, 236], mid: [200, 216, 242], bottom: [253, 249, 244] },
    dusk:  { top: [176, 164, 202], mid: [229, 196, 193], bottom: [247, 227, 195] }
  };
  var CLOUD_NIGHT = [118, 114, 164];  /* 夜云剪影色（比夜空略浅一档，读得出云形） */
  var CLOUD_WARM  = [247, 217, 224]; /* 晨昏云的粉调染色 */
  var GLOW_DAWN = [249, 216, 160], GLOW_DUSK = [243, 190, 133];

  function lerp(a, b, t) { return a + (b - a) * t; }
  function lerpC(c1, c2, t) {
    return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
  }
  function rgb(c, a) {
    /* 第 78 次（修天空白屏）：此处此前漏了 alpha 前的逗号——拼出 "rgba(165,187,2341)"，
       蓝通道被钳到 255、alpha 丢失，整片天空渐变/辉光/星星全部失色发白，
       白色大日期随之隐形。对齐 glass.js 的正确写法。 */
    return 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + (a == null ? 1 : a) + ')';
  }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /* 依据本地时间得到当前天空三停色板与两个氛围因子：
     night ∈ [0,1]（夜晚程度，驱动星星与云剪影染色）、warm ∈ [0,1]（晨昏程度，驱动云粉染与地平线辉光） */
  function skyPalette(date) {
    var h = date.getHours() + date.getMinutes() / 60;
    var top, mid, bottom, night = 0, warm = 0, glowX = 0.3;
    if (h < 5) {
      top = STOPS.night.top; mid = STOPS.night.mid; bottom = STOPS.night.bottom; night = 1;
    } else if (h < 7.5) {
      var t = (h - 5) / 2.5;
      top = lerpC(STOPS.night.top, STOPS.dawn.top, t); mid = lerpC(STOPS.night.mid, STOPS.dawn.mid, t); bottom = lerpC(STOPS.night.bottom, STOPS.dawn.bottom, t);
      night = 1 - t;
    } else if (h < 9.5) {
      var t2 = (h - 7.5) / 2;
      top = lerpC(STOPS.dawn.top, STOPS.day.top, t2); mid = lerpC(STOPS.dawn.mid, STOPS.day.mid, t2); bottom = lerpC(STOPS.dawn.bottom, STOPS.day.bottom, t2);
      /* 晨→昼：暖辉不在此段单独计算，见函数末尾的整段单峰曲线（第 45 次修） */
    } else if (h < 16) {
      top = STOPS.day.top; mid = STOPS.day.mid; bottom = STOPS.day.bottom;
    } else if (h < 18.5) {
      var t3 = (h - 16) / 2.5;
      top = lerpC(STOPS.day.top, STOPS.dusk.top, t3); mid = lerpC(STOPS.day.mid, STOPS.dusk.mid, t3); bottom = lerpC(STOPS.day.bottom, STOPS.dusk.bottom, t3);
      /* 昼→昏：暖辉同上，见末尾单峰曲线 */
    } else if (h < 21) {
      var t4 = (h - 18.5) / 2.5;
      top = lerpC(STOPS.dusk.top, STOPS.night.top, t4); mid = lerpC(STOPS.dusk.mid, STOPS.night.mid, t4); bottom = lerpC(STOPS.dusk.bottom, STOPS.night.bottom, t4);
      night = t4;
    } else {
      top = STOPS.night.top; mid = STOPS.night.mid; bottom = STOPS.night.bottom; night = 1;
    }
    /* 晨昏暖辉（第 45 次修 —— 这是「生硬」的主因）。
       原先暖辉在两段里各算一半：5→7.5 用 sin(t·π)（0→1→0），而紧接的 7.5→9.5
       却从 1 起步衰减——于是 07:30 暖辉从 0 瞬间跳到 1，地平线暖光「啪」地弹出、
       云朵粉染同时跳色；18:30 同样。现在改为覆盖整个晨间（5:00–9:30）/
       黄昏（16:00–21:00）窗口的单峰曲线，两端严格归零，与相邻白天/夜晚无缝相接。 */
    if (h >= 5 && h < 9.5) {
      var pd = (h - 5) / 4.5;
      warm = Math.sin(pd * Math.PI);
      /* 第 46 次：辉光位置不再钉死——随「日出进程」沿地平线自左向中滑动（0.12→0.42），
         表达「太阳在山那边移动」；窗口内线性、与 warm 同窗，出窗即被 warm=0 隐藏 */
      glowX = 0.12 + pd * 0.3;
    } else if (h >= 16 && h < 21) {
      var pe = (h - 16) / 5;
      warm = Math.sin(pe * Math.PI);
      /* 黄昏反向：自中向右滑落（0.58→0.88） */
      glowX = 0.58 + pe * 0.3;
    }
    return { top: top, mid: mid, bottom: bottom, night: night, warm: warm, glowX: glowX };
  }

  /* 季节微调：以夏至为最亮、冬至为最暗，仅轻微影响亮度（不偏移色相） */
  function seasonOffset(date) {
    var doy = Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) -
      Date.UTC(date.getFullYear(), 0, 0)) / 86400000);
    var phase = (doy - 172) / 365 * Math.PI * 2;
    return Math.cos(phase); // -1(冬) .. 1(夏)
  }

  /* 确定性伪随机（同一 seed 同一场景，呼应 swiftui-sky 的可复现性） */
  function rng(seed) {
    var s = seed % 2147483647; if (s <= 0) s += 2147483646;
    return function () { s = s * 16807 % 2147483647; return (s - 1) / 2147483646; };
  }

  /* 云的定义（确定性）：三层积云 + 低层薄絮，参考预览的构图——
     顶部一行被上缘裁切、中部一排大朵、底部薄絮。
     单朵宽 0.24–0.48W（参考里云间要留得出天空缝隙，勿再放大）。 */
  function makeCloudDefs() {
    function row(seed, count, baseY, ySpread, wMin, wMax, speed, alphaMul) {
      var r = rng(seed), arr = [];
      for (var i = 0; i < count; i++) {
        arr.push({
          x: r() * 1.35 - 0.2,
          y: baseY + (r() - 0.5) * ySpread,
          w: wMin + r() * (wMax - wMin),
          sp: speed * (0.7 + r() * 0.6),
          am: alphaMul * (0.75 + r() * 0.5),
          /* 第 46 次：垂直微浮动（呼吸感）。bp 相位 / bt 周期 9–15s / ba 归一化振幅
             （相对 H，约 1.7–3.2px @216px 天空）——纯时间函数，无需持久化 */
          bp: r() * Math.PI * 2,
          bt: 9 + r() * 6,
          ba: 0.008 + r() * 0.007,
          seed: seed * 100 + i
        });
      }
      return arr;
    }
    var rows = [
      row(11, 3, 0.10, 0.12, 0.26, 0.40, 0.003, 0.8),  /* L0 顶部：被上缘裁切的一行 */
      row(29, 3, 0.44, 0.18, 0.30, 0.48, 0.005, 0.95), /* L1 中部：主角大朵积云 */
      row(47, 3, 0.76, 0.08, 0.24, 0.36, 0.008, 0.45)  /* L2 底部：薄云絮（近地平线，暖染加码） */
    ];
    /* 第 49 次：给每朵云打上层号 layerIdx（分景深染色用） */
    for (var L = 0; L < rows.length; L++)
      for (var i = 0; i < rows[L].length; i++) rows[L][i].layerIdx = L;
    return rows;
  }

  /* 把一朵积云预渲染成离屏精灵（软边水彩感内置于精灵，避免每帧大半径渐变）。
     画法：底边平、顶部起伏的一排软圆——泡径必须小于泡距，让天空从缝隙里透出来，
     否则会糊成一整片（已实测踩坑：泡径过大时整块天空被白云盖满）。 */
  function renderCloudSprite(cloud, W, H, tint, alpha, dpr, vol) {
    vol = vol || { hi: 0.22, sh: 0.18, shade: [150, 160, 178] };
    var cw = cloud.w * W, ch = cw * 0.42;
    /* 第 47 次（修「云太生硬」）：精灵按 0.45 倍分辨率预渲染、绘制时再放大——
       双线性放大插值天然带雾化柔边，泡与泡的融合不再有「剪出来的圆弧硬边」。
       不用 ctx.filter='blur()'：Safari 至今不支持，兼容性差；降采样全浏览器一致。 */
    var RES = 0.45;
    /* 第 48 次（修「有的云顶部是平的」）：主泡最高点 py−pr 可达 −0.26ch，超出原
       画布上缘被直接裁掉——就是用户看到的平顶。给画布加 0.35ch 顶部余量并整体
       下移绘制，任何随机组合都不会再有裁切。 */
    var HEAD = 0.35;
    var chAll = ch * (1 + HEAD);
    var cv = document.createElement('canvas');
    cv.width = Math.max(2, Math.round(cw * RES * dpr));
    cv.height = Math.max(2, Math.round(chAll * RES * dpr));
    var c = cv.getContext('2d');
    if (!c) return null;
    c.setTransform(RES * dpr, 0, 0, RES * dpr, 0, 0);
    var r = rng(cloud.seed);
    var puffs = 7 + Math.floor(r() * 3);
    var baseY = ch * 0.74 + ch * HEAD; /* 原基座位置 + 顶部余量整体下移 */
    for (var i = 0; i < puffs; i++) {
      var px = cw * (0.16 + 0.68 * (i / (puffs - 1))) + (r() - 0.5) * cw * 0.04;
      var bell = Math.sin((i / (puffs - 1)) * Math.PI);           /* 两端小、中间大 */
      /* 第 48 次：泡径方差 0.25→0.3、纵向抖动 0.05→0.08ch——顶部起伏更不规则，云形不再雷同 */
      var pr = ch * (0.24 + 0.2 * bell) * (0.85 + r() * 0.3);
      var py = baseY - pr * (0.45 + 0.55 * bell) - r() * ch * 0.08;
      var g = c.createRadialGradient(px, py, 0, px, py, pr);
      /* 第 47 次：渐变更早更快衰减（0.62→0.55 处只剩 55%），配合降采样，边缘彻底雾化 */
      g.addColorStop(0, rgb(tint, alpha));
      g.addColorStop(0.55, rgb(tint, alpha * 0.55));
      g.addColorStop(1, rgb(tint, 0));
      c.fillStyle = g;
      c.beginPath();
      c.arc(px, py, pr, 0, Math.PI * 2);
      c.fill();
    }
    /* 第 215 次（用户：云彩更自然）：①顶部再撒一圈小泡，轮廓从「一排圆」变成菜花状的不规则顶；
       ②两端加几缕很淡的絮，云边散开而不是戛然而止 */
    var small = 5 + Math.floor(r() * 4);
    for (var k = 0; k < small; k++) {
      var t = 0.12 + r() * 0.76, bell2 = Math.sin(t * Math.PI);
      var sx = cw * t, sr = ch * (0.16 + 0.12 * r()) * (0.75 + bell2 * 0.5);
      /* 小泡圆心压在主体轮廓线内侧，只让外缘鼓出一点——避免浮成一颗颗白点 */
      var sy = baseY - ch * (0.2 + 0.42 * bell2) - r() * ch * 0.06;
      var gs = c.createRadialGradient(sx, sy, 0, sx, sy, sr);
      gs.addColorStop(0, rgb(tint, alpha * 0.45)); gs.addColorStop(0.5, rgb(tint, alpha * 0.22)); gs.addColorStop(1, rgb(tint, 0));
      c.fillStyle = gs; c.beginPath(); c.arc(sx, sy, sr, 0, Math.PI * 2); c.fill();
    }
    for (var w = 0; w < 4; w++) {
      var side = w % 2 ? 1 : -1;
      var wx = cw / 2 + side * cw * (0.36 + r() * 0.12), wy = baseY - ch * (0.08 + r() * 0.14);
      var wr = ch * (0.16 + r() * 0.1);
      var gw = c.createRadialGradient(wx, wy, 0, wx, wy, wr);
      gw.addColorStop(0, rgb(tint, alpha * 0.3)); gw.addColorStop(1, rgb(tint, 0));
      c.fillStyle = gw; c.beginPath(); c.ellipse(wx, wy, wr * 1.6, wr * 0.7, 0, 0, Math.PI * 2); c.fill();
    }
    /* 底部收一条略实的基座，让云「坐得住」而不是一坨雾（第 47 次：同步调软） */
    var bw = cw * 0.55, bh = ch * 0.15;
    var g2 = c.createRadialGradient(cw / 2, baseY, 0, cw / 2, baseY, bw / 2);
    g2.addColorStop(0, rgb(tint, alpha * 0.55));
    g2.addColorStop(0.6, rgb(tint, alpha * 0.28));
    g2.addColorStop(1, rgb(tint, 0));
    c.fillStyle = g2;
    c.beginPath();
    c.ellipse(cw / 2, baseY, bw / 2, bh, 0, 0, Math.PI * 2);
    c.fill();
    /* ③体积感：只在云本体上（source-atop）做顶亮底暗——上沿受光、下腹微灰，阴雨天下腹更沉 */
    c.globalCompositeOperation = 'source-atop';
    var gv = c.createLinearGradient(0, baseY - ch * 0.95, 0, baseY + ch * 0.1);
    gv.addColorStop(0, 'rgba(255,255,255,' + vol.hi.toFixed(3) + ')');
    gv.addColorStop(0.45, 'rgba(255,255,255,0)');
    gv.addColorStop(0.7, rgb(vol.shade, 0));
    gv.addColorStop(1, rgb(vol.shade, vol.sh));
    c.fillStyle = gv; c.fillRect(0, 0, cw, chAll);
    c.globalCompositeOperation = 'source-over';
    return { cv: cv, w: cw, h: chAll };
  }

  /* 第 45 次：跨 mount 保留的状态。
     问题背景：home.js 每次重渲染都会重建 canvas 并重新 Sky.mount，而云的位置与
     云精灵原先都定义在 mount 内部——于是每次回首页/每次保存后重渲染，云都会
     「瞬移回起点」，9 个精灵还要全部重渲染一次（可见的卡顿 + 跳变）。
     现在把「云的水平位置」和「已渲染精灵」提到模块级：位置用规范化坐标（0–1.35
     相对宽度）表示，与画布尺寸无关，恢复后与原位置完全一致。 */
  var skyPersist = {
    cloudX: null,                          /* 上次离开时各朵云的 x（按层展开的顺序） */
    sprite: { key: null, imgs: null }      /* 已渲染精灵缓存（键含染色档 + 画布宽 + dpr） */
  };

  /* 云漂移速度换算：原实现按「60fps 每帧 sp*0.016」推进，折合每秒 sp*0.96。
     第 45 次改为按真实秒数推进（帧率无关），此常量保持与旧版观感一致。 */
  var DRIFT_PER_SEC = 0.96;

  var Sky = {};

  /* opts.hour（0–24 浮点）：调试 / QA 时段覆盖；不传即真实本地时钟。
     Sky.previewHour（第 54 次）：设置 · 外观「天空时刻预览」的运行时覆盖——
     与 opts.hour 不同，它随帧生效（改完不用重挂载），会话级、不落盘。 */
  /* 第 53 次（时光沉浸）：把当前色板写进 CSS 变量，供全页环境光层（styles.css
     body 的背景第一层）使用——太阳的色温浸到页面底色上，整页与天空按同一
     时刻呼吸。色板是连续渐变，这里量化到整数 RGB、只在变化时写 DOM。
     透明度随色板亮度自适应（第 54 次）：亮色板（正午）低透明度够用，
     暗色板（深夜）必须更高透明度才能染上页面——固定 9% 在夜里等于没染。
     第 64 次（接缝同色）：额外把 pal.bottom 写进 --sky-live-rgb——
     styles.css 的 --sky-seam-rgb 映射它（浅色模式），veil 终档与 .sky-seam
     过渡带都消费同一颜色，天空与页面在底边逐像素同色。暗色模式不用
     live 值（seam 固定 34,30,26），写下去也无妨。
     沙箱 / 无 DOM 环境静默跳过——环境光只是锦上添花，任何异常都不能影响天空本体。 */
  function relLum(c) {
    var f = function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  }
  var ambientCache = '';
  function syncAmbient(pal) {
    try {
      if (typeof document === 'undefined' || !document.documentElement || !document.documentElement.style) return;
      var key = [pal.top, pal.mid, pal.bottom].map(function (c) { return c.map(Math.round).join(','); }).join('|');
      if (key === ambientCache) return;
      ambientCache = key;
      var lum = (0.2126 * pal.top[0] + 0.7152 * pal.top[1] + 0.0722 * pal.top[2]) / 255;
      var ambA = (0.10 + 0.07 * (1 - Math.min(1, lum * 2))).toFixed(3);
      /* 第 55 次：暗色压暗罩强度随色板亮度走（--sky-dim-o）——罩子的职责是压暗
         「暗色主题下的白天亮板」；夜晚板本身已暗，再叠 40% 炭罩是双重压暗，
         正是「夜色发重发闷」的第二根源。白天 lum≥.5 时满强度，夜晚降到 30%。 */
      var dim = Math.max(0.3, Math.min(1, 0.3 + (lum - 0.25) * 2.8)).toFixed(3);
      var s = document.documentElement.style;
      s.setProperty('--sky-ambient-top', pal.top.map(Math.round).join(','));
      s.setProperty('--sky-ambient-bottom', pal.bottom.map(Math.round).join(','));
      s.setProperty('--sky-live-rgb', pal.bottom.map(Math.round).join(','));
      s.setProperty('--sky-ambient-a', ambA);
      s.setProperty('--sky-dim-o', dim);
      /* 第 155 次：hero 文字直接写在天空上，按天色中段亮度选墨色（白天深字、夜晚 / 晨昏偏暗时浅字） */
      /* 第 181 次（修 19:45 前后白字隐形）：原判据是「中段 gamma 亮度 < .62 切白字」——
         gamma 值不是视觉亮度，黄昏→夜晚过渡里 19:40 左右就判成浅字，可问候文字实际压在
         天空下缘（中段与底段之间、底段更亮），白字只剩 1.4–1.7:1。改为 WCAG 相对亮度：
         取文字真实所在的「中段 40% + 底段 60%」色，深墨与白字谁对比更高用谁。 */
      var under = [0, 1, 2].map(function (k) { return pal.mid[k] * 0.4 + pal.bottom[k] * 0.6; });
      var L = relLum(under);
      var crDark = (L + 0.05) / (0.0245 + 0.05);   /* #2B2A33 相对亮度 ≈ .0245 */
      var crLight = 1.05 / (L + 0.05);
      document.documentElement.setAttribute('data-sky-ink', crLight > crDark ? 'light' : 'dark');
    } catch (e) { /* 静默 */ }
  }

  /* 会话级时段预览（设置 · 外观写它，帧循环每帧读它） */
  Sky.previewHour = null;

  /* 第 214 次（用户：天气层与背景更融合自然）：天气不再在天空上另叠遮罩，
     而是直接改天空本身的「画法」——色板去饱和+压暗、云变灰变厚、阴天藏星、雷雨闪电都在同一张画布里完成，
     玻璃卡（glass.js 采样 skyCanvas）与环境光变量也就自动跟着天气走。
     WX 为每种天气的目标值；运行时 mood 以约 1.5s 的时间常数缓动过去，切换天气不跳变。 */
  var WX = {
    '':      { g: 0,    k: 1,    c: 0,    ca: 1,    fog: 0 },
    clear:   { g: 0,    k: 1,    c: 0,    ca: 1,    fog: 0 },
    partly:  { g: 0.14, k: 0.99, c: 0.18, ca: 1.12, fog: 0 },
    cloudy:  { g: 0.62, k: 0.9,  c: 0.62, ca: 1.35, fog: 0 },
    fog:     { g: 0.7,  k: 0.97, c: 0.45, ca: 1.2,  fog: 0.8 },
    rain:    { g: 0.72, k: 0.74, c: 0.85, ca: 1.4,  fog: 0.12 },
    thunder: { g: 0.8,  k: 0.64, c: 1,    ca: 1.45, fog: 0.1 },
    snow:    { g: 0.55, k: 0.96, c: 0.5,  ca: 1.3,  fog: 0.18 }
  };
  Sky.weather = '';
  Sky.setWeather = function (k) { Sky.weather = WX[k] ? k : ''; };
  var mood = { g: 0, k: 1, c: 0, ca: 1, fog: 0 };
  var moodInit = false;
  function stepMood(dt) {
    var t = WX[Sky.weather] || WX[''];
    if (!moodInit || dt == null) { mood = { g: t.g, k: t.k, c: t.c, ca: t.ca, fog: t.fog }; moodInit = true; return; }
    var a = 1 - Math.exp(-dt / 1.5);
    for (var key in t) mood[key] += (t[key] - mood[key]) * a;
  }
  var WX_GREY_DAY = [176, 186, 200];   /* 阴天的天：偏冷的灰蓝，不是死灰 */
  var WX_CLOUD = [196, 202, 212];      /* 阴天的云：带一点蓝的浅灰 */
  function weatherPal(pal) {
    if (mood.g < 0.004 && Math.abs(mood.k - 1) < 0.004) return pal;
    function f(c) {
      var l = c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
      /* 去饱和到自身亮度，再朝冷灰拉一点（夜里冷灰按亮度缩放，不会把夜空提亮） */
      var grey = [l, l, l];
      var tone = WX_GREY_DAY.map(function (v) { return v * Math.min(1, l / 190); });
      var g = lerpC(c, lerpC(grey, tone, 0.5), mood.g);
      return [g[0] * mood.k, g[1] * mood.k, g[2] * mood.k];
    }
    return { top: f(pal.top), mid: f(pal.mid), bottom: lerpC(f(pal.bottom), pal.bottom, 0.35),
      night: pal.night, warm: pal.warm * (1 - mood.g * 0.85), glowX: pal.glowX, dark: pal.dark };
  }

  Sky.mount = function (canvas, opts) {
    if (!canvas || !canvas.getContext) return;
    if (canvas.__skyId) cancelAnimationFrame(canvas.__skyId);

    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    var W = 1, H = 1;
    var dpr = Math.min(global.devicePixelRatio || 1, 2);
    var reduced = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* 第 92 次（暗色天空适配）：色板按亮色页面设计——昼板亮蓝、夜板浅紫，
       而暗色主题整页是暖炭底（#221E1A）。画布底边透明化后（第 91 次），
       浅紫/亮蓝与暗页的亮度落差全靠 28% 线性擦除硬接，过渡明显不如亮色
       模式（亮色昼板底色与页面同色、几乎无缝）。暗色下对三停色统一乘暗
       系数（保色相只降亮度），云染色同步压暗——天空与暗页从「靠 ::after
       暗罩硬压」改为「色板本身适配暗页」。逐帧检测 body.dark（开销可忽略），
       设置页切主题下一帧生效，无需重挂载。
       第 93 次（亮带折返）：只压暗还不够——夜板地平线本来就比夜空中段亮
       （bottom 97,89,107 > mid 63,61,86），这条亮带正落在擦除区里，过渡带
       内亮度「先升后降再归暗」，用户复测仍是「过渡没改好」。把 bottom 额外
       向页面顶色（#221E1A = 34,30,26）插值，底边序列变成 top→mid→bottom
       单调趋暗，擦除区不再有亮带残影。 */
    var DARK_PAGE = [34, 30, 26];
    function isDarkTheme() {
      try { return !!(document.body && document.body.classList && document.body.classList.contains('dark')); }
      catch (e) { return false; }
    }
    var DARK_K = 0.58;
    function scaleC(c, k) { return [c[0] * k, c[1] * k, c[2] * k]; }
    function themePal(pal) {
      if (!pal.dark && !isDarkTheme()) return pal;
      if (pal.dark) return pal;
      var p = {
        top: scaleC(pal.top, DARK_K), mid: scaleC(pal.mid, DARK_K), bottom: scaleC(pal.bottom, DARK_K),
        night: pal.night, warm: pal.warm, glowX: pal.glowX, dark: 1
      };
      /* 第 142 次（夜间天空与页面融合）：原来只把「底」朝页面拉 0.45，
         顶部与中部仍是纯冷紫 —— 暗色下就是「一块紫天 + 一片暖褐地面」，
         用户反馈的分裂感。现在三段都往 DARK_PAGE 拉，且越往下拉得越多
         （顶 0.18 / 中 0.34 / 底 0.62）：既保住夜空该有的冷调，
         又让整块天空落在同一个暖炭色温家族里，接缝只剩明暗差、没有色相差。 */
      p.top = lerpC(p.top, DARK_PAGE, 0.18);
      p.mid = lerpC(p.mid, DARK_PAGE, 0.34);
      p.bottom = lerpC(p.bottom, DARK_PAGE, 0.62);
      return p;
    }
    var nowFn = (opts && opts.hour != null)
      ? function () { var d = new Date(); d.setHours(Math.floor(opts.hour), Math.round((opts.hour % 1) * 60), 0, 0); return d; }
      : function () { return new Date(); };
    /* 第 54 次：预览时刻优先于真实时钟——设置页点「黄昏」，帧循环下一拍就换色板，
       不用重挂载。opts.hour（QA 注入）仍最优先，两者都不设走真实时间。 */
    function effNow() {
      if (Sky.previewHour == null) return nowFn();
      var d = new Date();
      d.setHours(Math.floor(Sky.previewHour), Math.round((Sky.previewHour % 1) * 60), 0, 0);
      return d;
    }

    /* 星星：位置确定性，闪烁相位各异 */
    var stars = (function () {
      var r = rng(2026), a = [];
      for (var i = 0; i < 64; i++) a.push({ x: r(), y: r() * 0.72, r: 0.6 + r() * 1.2, p: r() * Math.PI * 2, s: 0.8 + r() * 1.6 });
      return a;
    })();
    var cloudLayers = makeCloudDefs();
    /* 第 46 次：亮星层——更大更亮、带柔光晕，与暗星独立相位。
       光晕用预渲染小精灵 drawImage，避免每帧 shadowBlur（jsdom 无 2d context 时为 null，绘制处守卫）。 */
    var brightStars = (function () {
      var r = rng(77), a = [];
      for (var i = 0; i < 10; i++) a.push({ x: r(), y: r() * 0.6, r: 1.1 + r() * 0.9, p: r() * Math.PI * 2, s: 0.6 + r() * 0.9 });
      return a;
    })();
    var starGlow = (function () {
      var sz = 18, cv = document.createElement('canvas');
      cv.width = cv.height = Math.max(2, Math.round(sz * dpr));
      var c = cv.getContext('2d');
      if (!c) return null;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      var g = c.createRadialGradient(sz / 2, sz / 2, 0, sz / 2, sz / 2, sz / 2);
      g.addColorStop(0, 'rgba(255,255,255,.95)');
      g.addColorStop(0.25, 'rgba(255,255,255,.5)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, sz, sz);
      return { cv: cv, sz: sz };
    })();
    /* 第 45 次：恢复上次的云位置。home 重渲染会重新 mount，若不恢复，
       云会「瞬移回起点」——这是回首页时最明显的一处跳变。 */
    (function restoreCloudX() {
      var saved = skyPersist.cloudX;
      if (!saved) return;
      var n = 0;
      for (var L = 0; L < cloudLayers.length; L++) {
        for (var i = 0; i < cloudLayers[L].length; i++) {
          if (typeof saved[n] === 'number') cloudLayers[L][i].x = saved[n];
          n++;
        }
      }
    })();
    var meteors = [];
    var sprites = []; /* 精灵缓存与分摊重建状态（spriteKey/spriteImgs/rebuildLeft）见下方第 49 次块 */

    function resize() {
      var rect = canvas.getBoundingClientRect();
      W = Math.max(1, rect.width); H = Math.max(1, rect.height);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      spriteKey = null; /* 尺寸变了，精灵按新宽度重渲染 */
    }
    resize();
    var ro = null;
    if (global.ResizeObserver) { ro = new ResizeObserver(resize); ro.observe(canvas); }
    else { global.addEventListener('resize', resize); }

    /* 云染色（第 49 次分景深）：白天纯白 → 晨昏粉调 → 夜晚深紫剪影；夜里整体更透。
       三层云不再同色：底层薄絮（L=2，y≈0.76H）贴近地平线，晨昏时被辉光「从下面
       打亮」，暖染加码 1.3 倍；顶层（L=0）离辉光最远，暖染收 0.75 倍——
       同一时刻的云有了「远近受光不同」的空间感。夜里仍统一剪影。 */
    function cloudTint(night, warm, L, dark, wc) {
      wc = wc || 0;
      var warmMul = (L === 2) ? 1.3 : (L === 0 ? 0.75 : 1);
      var c = lerpC([255, 255, 255], CLOUD_WARM, warm * 0.85 * warmMul);
      c = lerpC(c, CLOUD_NIGHT, night);
      var a = lerp(0.72, 0.3, night) * lerp(1, 0.92, warm);
      /* 第 92 次：暗色主题下云与天空一起压暗（否则天空暗了云仍亮白，浮在暗底上扎眼） */
      if (dark) { c = scaleC(c, DARK_K); a *= 0.92; }
      /* 第 214 次：阴雨时云朝浅灰蓝、更实（夜里同样按亮度缩放） */
      if (wc > 0) {
        var cl = (c[0] + c[1] + c[2]) / 3 / 255;
        c = lerpC(c, WX_CLOUD.map(function (v) { return v * Math.min(1, cl * 1.05); }), wc);
        a = Math.min(0.95, a * (1 + wc * 0.35));
      }
      return { tint: c, alpha: a };
    }
    var TARGET = 24; /* 染色档位（第 45 次从 12 提到 24）：晨昏过渡更细腻 */
    /* 第 49 次：精灵「分摊重建」。晨昏窗口内染色档位每约 5 分钟变一档，原实现
       一次性重渲染 9 个精灵（10–25ms，低端机上是一顿）；改为 round-robin——
       key 变了先把全部索引排队，每帧最多重建 1 个，约 9 帧（~150ms）完成过渡。
       过渡期新旧染色短暂混用无妨（云与云本来就色差），肉眼只见渐变不见顿挫。
       skyPersist 仍只存「完整重建后」的整套图（半新半旧的套不落缓存）。 */
    var spriteKey = null;   /* 已完整就绪的档位 key（null = 尚无完整套） */
    var spriteImgs = null;  /* 当前使用的精灵图（重建过渡期允许新旧混用） */
    var rebuildLeft = -1;   /* >=0 = 重建进行中（还剩几个未重建）；-1 = 空闲 */
    var rebuildPal = null;  /* 重建目标档位的染色参数 */
    var flatDefs = [];
    (function flatten() {
      for (var L = 0; L < cloudLayers.length; L++)
        for (var i = 0; i < cloudLayers[L].length; i++) flatDefs.push(cloudLayers[L][i]);
    })();
    function buildSprite(i, night, warm, dark) { /* wc 取 rebuildPal.wc */
      var def = flatDefs[i];
      var ct = cloudTint(night, warm, def.layerIdx, dark, rebuildPal ? rebuildPal.wc : 0);
      var wc = rebuildPal ? rebuildPal.wc : 0;
      var nt = rebuildPal ? rebuildPal.night : 0;
      var vol = {
        hi: (1 - nt) * (0.12 - wc * 0.08) * (rebuildPal && rebuildPal.dark ? 0.5 : 1),
        sh: 0.14 + wc * 0.32 + nt * 0.05,
        shade: lerpC(scaleC(ct.tint, 0.72), [110, 122, 142], wc * 0.6)
      };
      return renderCloudSprite(def, W, H, ct.tint, ct.alpha * def.am, dpr, vol);
    }
    function pairSprites() {
      sprites = [];
      for (var i = 0; i < flatDefs.length; i++) sprites.push({ def: flatDefs[i], img: spriteImgs[i] });
    }
    function ensureSprites(pal, full) {
      /* 第 92 次：key 首位加暗色标志——切主题后染色档位不变也能触发整套重建 */
      var wcq = Math.round(mood.c * 8) / 8;
      var key = 'v215:' + (pal.dark ? 1 : 0) + ':w' + wcq + ':' + Math.round(pal.night * TARGET) + ':' + Math.round(pal.warm * TARGET) + ':' + Math.round(W) + ':' + dpr;
      if (key === spriteKey && rebuildLeft < 0) return;
      if (rebuildLeft < 0) {
        /* 进入新档位：跨 mount 缓存命中则整套即用（不排队），否则开始分摊重建 */
        if (skyPersist.sprite.key === key && skyPersist.sprite.imgs) {
          spriteKey = key;
          spriteImgs = skyPersist.sprite.imgs;
          pairSprites();
          return;
        }
        rebuildPal = { night: pal.night, warm: pal.warm, dark: pal.dark, wc: wcq, key: key };
        rebuildLeft = flatDefs.length;
        if (!spriteImgs || spriteImgs.length !== flatDefs.length) spriteImgs = new Array(flatDefs.length);
      }
      var budget = full ? rebuildLeft : 1; /* 每帧最多 1 个；paintStatic 一次做完 */
      while (budget-- > 0 && rebuildLeft > 0) {
        rebuildLeft--;
        spriteImgs[rebuildLeft] = buildSprite(rebuildLeft, rebuildPal.night, rebuildPal.warm, rebuildPal.dark);
      }
      pairSprites();
      if (rebuildLeft === 0) {
        rebuildLeft = -1;
        spriteKey = rebuildPal.key;
        skyPersist.sprite = { key: rebuildPal.key, imgs: spriteImgs };
      }
    }

    function paintSky(pal, tSec) {
      var grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, rgb(pal.top, 1));
      grad.addColorStop(0.52, rgb(pal.mid, 1));
      grad.addColorStop(1, rgb(pal.bottom, 1));
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);

      /* 晨昏地平线暖辉光：参考项目无日月圆盘，光感即来自这团光 */
      if (pal.warm > 0.02) {
        /* 第 46 次：辉光 9s 缓慢呼吸（半径与强度同相 ±6%），像低空的雾光在吐纳；
           reduced-motion 下取常量 1，静帧不受影响 */
        var breathe = reduced ? 1 : 1 + 0.06 * Math.sin(tSec * Math.PI * 2 / 9);
        var gr = Math.max(W, H) * 0.55 * breathe;
        var gx = W * pal.glowX, gy = H * 0.92;
        var glow = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
        var gc = pal.glowX < 0.5 ? GLOW_DAWN : GLOW_DUSK;
        glow.addColorStop(0, rgb(gc, 0.5 * pal.warm * breathe));
        glow.addColorStop(1, rgb(gc, 0));
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, W, H);
      }

      /* 星星（在云后面）：夜里出现，各自相位闪烁 */
      if (pal.night > 0.12 && mood.c < 0.9) {
        var sa = clamp((pal.night - 0.12) / 0.88, 0, 1) * (1 - mood.c);
        for (var s = 0; s < stars.length; s++) {
          var st = stars[s];
          var tw = reduced ? 0.75 : (0.55 + 0.45 * Math.sin(tSec * st.s + st.p));
          ctx.beginPath();
          ctx.arc(st.x * W, st.y * H, st.r, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255,255,255,' + ((0.28 + 0.5 * tw) * sa).toFixed(3) + ')';
          ctx.fill();
        }
        /* 第 46 次：亮星——预渲染光晕精灵 + 独立相位，夜空有了「主角星」层次 */
        if (starGlow) {
          for (var b = 0; b < brightStars.length; b++) {
            var bs = brightStars[b];
            var tw2 = reduced ? 0.8 : 0.55 + 0.45 * Math.sin(tSec * bs.s + bs.p);
            var sr = bs.r * 5;
            ctx.globalAlpha = (0.35 + 0.55 * tw2) * sa;
            ctx.drawImage(starGlow.cv, bs.x * W - sr, bs.y * H - sr, sr * 2, sr * 2);
          }
          ctx.globalAlpha = 1;
        }
      }
    }

    /* 第 46 次：入参 tSec——云除了水平漂移，再做垂直微浮动（各自相位/周期），
       纯时间函数，静态帧（reduced-motion / paintStatic 传 0）只是固定偏移，无碍 */
    function paintClouds(tSec) {
      for (var i = 0; i < sprites.length; i++) {
        var sp = sprites[i];
        if (!sp.img) continue;
        var bob = Math.sin(tSec * Math.PI * 2 / sp.def.bt + sp.def.bp) * sp.def.ba * H;
        var cx = sp.def.x * W - sp.img.w / 2, cy = sp.def.y * H - sp.img.h / 2 + bob;
        /* 第 47 次：先叠一层放大 1.18 倍、16% 透明的「雾晕」，再画本体——
           云与天空的交界多一圈过渡，水彩感更强（每朵多一次 drawImage，开销可忽略） */
        ctx.globalAlpha = 0.16;
        ctx.drawImage(sp.img.cv, cx - sp.img.w * 0.09, cy - sp.img.h * 0.09, sp.img.w * 1.18, sp.img.h * 1.18);
        ctx.globalAlpha = 1;
        ctx.drawImage(sp.img.cv, cx, cy, sp.img.w, sp.img.h);
      }
    }

    /* 第 215 次：阴雨天不再把同一朵云放大重叠（会有重影），而是在积云后面铺一层层云——
       几条横向拉长、边缘极软的云带缓慢漂移，颜色取自天空本身提亮/压暗，天越阴越密 */
    var STRATUS = [
      { y: 0.06, h: 0.16, x: 0.2, w: 1.1, sp: 0.0016, a: 1 },
      { y: 0.24, h: 0.14, x: 0.75, w: 0.9, sp: 0.0024, a: 0.85 },
      { y: 0.42, h: 0.12, x: 0.35, w: 1.0, sp: 0.002, a: 0.7 },
      { y: 0.58, h: 0.1, x: 0.9, w: 0.8, sp: 0.003, a: 0.5 }
    ];
    function paintStratus(pal, dt) {
      if (mood.c < 0.03) return;
      var lum = (pal.mid[0] + pal.mid[1] + pal.mid[2]) / 3;
      var col = lum > 120 ? lerpC(pal.top, [238, 240, 244], 0.45) : lerpC(pal.top, pal.mid, 0.6).map(function (v) { return v * 1.18; });
      for (var i = 0; i < STRATUS.length; i++) {
        var b = STRATUS[i];
        if (dt) { b.x += b.sp * DRIFT_PER_SEC * dt; if (b.x - b.w / 2 > 1.3) b.x = -0.3 - b.w / 2; }
        var cx = b.x * W, cy = b.y * H, rx = b.w * W * 0.6, ry = b.h * H;
        ctx.save();
        ctx.translate(cx, cy); ctx.scale(rx / ry, 1);
        var g = ctx.createRadialGradient(0, 0, 0, 0, 0, ry);
        var a = Math.min(1, mood.c) * 0.5 * b.a;
        g.addColorStop(0, rgb(col, a)); g.addColorStop(0.5, rgb(col, a * 0.55)); g.addColorStop(1, rgb(col, 0));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, ry, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    }

    /* 第 214 次：雾——一层从下往上变淡的同色系薄纱；雷雨——偶尔一道很短的冷白闪 */
    var flash = 0, nextFlash = 4 + Math.random() * 8;
    function paintWeather(pal, dt) {
      if (mood.fog > 0.01) {
        var fc = lerpC(pal.mid, [236, 238, 242], 0.55);
        if (pal.dark || pal.night > 0.5) fc = lerpC(pal.mid, pal.bottom, 0.5);
        var fgd = ctx.createLinearGradient(0, 0, 0, H);
        fgd.addColorStop(0, rgb(fc, mood.fog * 0.35));
        fgd.addColorStop(0.6, rgb(fc, mood.fog * 0.8));
        fgd.addColorStop(1, rgb(fc, mood.fog * 0.5));
        ctx.fillStyle = fgd; ctx.fillRect(0, 0, W, H);
      }
      if (Sky.weather === 'thunder' && !reduced && dt) {
        nextFlash -= dt;
        if (nextFlash <= 0) { flash = 1; nextFlash = 6 + Math.random() * 10; }
        if (flash > 0.01) {
          var fl = ctx.createRadialGradient(W * 0.6, 0, 0, W * 0.6, 0, Math.max(W, H));
          fl.addColorStop(0, 'rgba(235,240,255,' + (0.42 * flash).toFixed(3) + ')');
          fl.addColorStop(1, 'rgba(235,240,255,0)');
          ctx.fillStyle = fl; ctx.fillRect(0, 0, W, H);
          /* 两段式：一闪、稍暗、再闪一下后熄 */
          flash *= Math.exp(-dt * 9);
          if (flash < 0.25 && flash > 0.2 && Math.random() < 0.5) flash = 0.75;
        }
      }
    }

    /* 第 45 次：概率按真实时间折算。原先「每帧 0.004」在 120Hz 屏上出现频率
       会翻倍；改为「每秒 0.24」再乘 dt，任何帧率下观感一致。 */
    function maybeSpawnMeteor(night, dt) {
      if (night < 0.6) return;
      if (Math.random() < 0.24 * dt && meteors.length < 2) {
        meteors.push({ x: 0.1 + Math.random() * 0.5, y: 0.05 + Math.random() * 0.25,
          vx: 0.012 + Math.random() * 0.01, vy: 0.006 + Math.random() * 0.006, life: 1 });
      }
    }

    /* 同上：位移与寿命都按真实秒推进（原为每帧固定增量，等效 60fps） */
    function paintMeteors(dt) {
      var k = DRIFT_PER_SEC * dt / 0.016; // 保持与旧版「每帧增量」观感一致
      for (var m = meteors.length - 1; m >= 0; m--) {
        var me = meteors[m];
        me.x += me.vx * k; me.y += me.vy * k; me.life -= 0.012 * k;
        if (me.life <= 0 || me.x > 1.1 || me.y > 0.7) { meteors.splice(m, 1); continue; }
        /* 第 46 次：出现后前 20% 寿命内淡入（原 life=1 直接全亮弹出很突兀），
           并在头部补一个亮点，尾迹方向感更强 */
        var fade = clamp((1 - me.life) * 5, 0, 1);
        var alpha = 0.9 * me.life * fade;
        var mx = me.x * W, my = me.y * H, len = 40;
        var g2 = ctx.createLinearGradient(mx, my, mx - me.vx * len * 60, my - me.vy * len * 60);
        g2.addColorStop(0, 'rgba(255,255,255,' + alpha.toFixed(3) + ')');
        g2.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.strokeStyle = g2; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(mx, my);
        ctx.lineTo(mx - me.vx * len * 60, my - me.vy * len * 60);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(mx, my, 1.8, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,240,' + (alpha * 0.95).toFixed(3) + ')';
        ctx.fill();
      }
    }

    function cleanup() {
      if (ro) ro.disconnect();
      if (canvas.__skyId) cancelAnimationFrame(canvas.__skyId);
      canvas.__skyId = null;
    }

    /* 第 45 次：帧率无关推进。原先每帧固定推进 sp*0.016（等于假定 60fps），
       在 120Hz 手机上云会快一倍、低帧率设备上又变慢；掉帧时还会「一跳一跳」。
       现改为按两帧之间的真实秒数推进，并对 dt 设上限（切后台回来时 dt 可能是
       几十秒，不封顶会让云瞬间横穿画面、流星也一次性走完）。 */
    var lastT = 0;
    /* 第 91 次（白色条根治）：天空底边淡出为透明，交界处直接露出页面真实
       背景（--bg-grad + 环境色温层）。此前画布铺实色、veil/seam 静态「对色」，
       但页面侧永远多一层环境光——任何静态色都对不齐（白天偏白、夜晚浅紫
       夜板在中段泛灰）。透明化后任何色板/主题/时段都不可能再出现横带。 */
    function fadeBottomOut() {
      ctx.globalCompositeOperation = 'destination-out';
      /* 第 145 次（夜间天空与页面仍有断层）：淡出原来一直拖到画布最底（100%），
         而问候卡是「沉底」布局（margin-top:auto + 天空 padding-bottom 14px），
         卡片底边恒定在 H-14。于是卡片下方那 14px 里，画布还剩约 23% 的紫 ——
         正好是唯一露在卡片外的一段，看起来就是一条紫色→棕色的急转。
         现在把擦除终点提前到 88%：渐变只映射 0.72~0.88，88% 之后保持全透明，
         淡出整个发生在卡片背后；卡片下方露出的直接就是页面底色。 */
      var fg = ctx.createLinearGradient(0, H * 0.72, 0, H * 0.88);
      /* 第 92 次：加 S 曲线中间档——线性 alpha 人眼感知中段偏陡，暗色板与暗页
         亮度差大时过渡带里会显出「赶」。三档近似平滑曲线，交界更绵。 */
      fg.addColorStop(0, 'rgba(0,0,0,0)');
      fg.addColorStop(0.5, 'rgba(0,0,0,.32)');
      fg.addColorStop(1, 'rgba(0,0,0,1)');
      ctx.fillStyle = fg;
      /* 第 155 次：多擦 2px。canvas.height = round(H*dpr)，H 带小数时位图会比 H*dpr 多出半行，
         原来只擦到 H，最底那半行没擦掉，天空底边就留下一条 1px 的深色细线（夜间最明显）。 */
      ctx.fillRect(0, H * 0.72, W, H * 0.28 + 2);
      ctx.globalCompositeOperation = 'source-over';
    }

    function frame(time) {
      if (!canvas.isConnected) { cleanup(); return; } // 离开首页 → 自动停止，释放资源
      var t = time || 0;
      var dt = lastT ? Math.min((t - lastT) / 1000, 0.05) : 0.016;
      lastT = t;
      var now = effNow();
      var pal = skyPalette(now);
      var bright = 1 + seasonOffset(now) * 0.05;
      if (bright !== 1) { /* 季节亮度：直接乘在三停色上（幅度 5%，肉眼柔和） */
        pal.top = pal.top.map(function (v) { return v * bright; });
        pal.mid = pal.mid.map(function (v) { return v * bright; });
        pal.bottom = pal.bottom.map(function (v) { return v * bright; });
      }
      pal = themePal(pal); /* 第 92 次：暗色主题压暗（亮色原样返回，无额外开销） */
      stepMood(dt);
      pal = weatherPal(pal);
      syncAmbient(pal); /* 第 53 次：环境光 CSS 变量随色板更新（量化节流，变了才写 DOM） */
      ensureSprites(pal, false);
      paintSky(pal, t / 1000);
      paintStratus(pal, dt);
      paintClouds(t / 1000);
      paintWeather(pal, dt);
      /* 云缓慢漂移（仅在画面内循环），按真实时间推进 */
      for (var L = 0; L < cloudLayers.length; L++) {
        var layer = cloudLayers[L];
        for (var i = 0; i < layer.length; i++) {
          layer[i].x += layer[i].sp * DRIFT_PER_SEC * dt;
          if (layer[i].x - layer[i].w / 2 > 1.2) layer[i].x = -0.2 - layer[i].w / 2;
        }
      }
      saveCloudX();
      maybeSpawnMeteor(pal.night, dt);
      paintMeteors(dt);
      fadeBottomOut();
      canvas.__skyId = requestAnimationFrame(frame);
    }

    /* 把当前云位置存到模块级：home 重渲染后再次 mount 时接着走，而不是跳回起点 */
    function saveCloudX() {
      var arr = [];
      for (var L = 0; L < cloudLayers.length; L++) {
        for (var i = 0; i < cloudLayers[L].length; i++) arr.push(cloudLayers[L][i].x);
      }
      skyPersist.cloudX = arr;
    }

    function paintStatic() {
      stepMood(null);
      var pal = weatherPal(themePal(skyPalette(effNow()))); /* 第 92 次：静帧同样走暗色适配 */
      syncAmbient(pal);
      ensureSprites(pal, true); /* reduced-motion：一次性建完整套，不做分摊 */
      paintSky(pal, 0);
      paintStratus(pal, 0);
      paintClouds(0);
      paintWeather(pal, 0);
      fadeBottomOut();
    }

    if (reduced) { paintStatic(); }
    else { canvas.__skyId = requestAnimationFrame(frame); }

    canvas.__skyStop = cleanup;
  };

  Sky.stop = function (canvas) { if (canvas && canvas.__skyStop) canvas.__skyStop(); };

  /* 供 QA 断言昼夜色板逐分钟连续（第 45 次：07:30 / 18:30 的暖辉跳变必须防回退）。
     下划线前缀 = 内部实现，不供业务调用，与 Modules.feeding._pendingDur 同类。 */
  Sky._palette = skyPalette;

  /* 第 85 次：日轮时刻表函数已撤下——日轮弧线与太阳/月亮从首页移除后，
     时刻表本身无消费方。天空色板/云/星/环境光不受影响。 */

  global.Sky = Sky;
})(window);
