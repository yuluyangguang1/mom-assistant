/**
 * sky.js — 程序化动态天空（Web 版 swiftui-sky）
 * 纯 Canvas、零依赖、零网络：由本地时钟 + 年内天数驱动昼夜曲线与季节色板。
 * 水彩云朵缓慢漂移、晨昏转粉金、夜间星空偶有流星。
 * 背景忽略点击、对无障碍隐藏；尊重 prefers-reduced-motion；离开 DOM 自动停止。
 *
 * 设计渊源：github.com/zolplay-labs/swiftui-sky（Cali Baby 首页），
 * 经 Web Canvas 还原「安静的陪伴」气质：低饱和、暖调、克制。
 */
(function (global) {
  'use strict';

  /* 关键时段色板（顶 → 底），RGB；保持低饱和、暖调 */
  var STOPS = {
    night: { top: [27, 33, 56],  bottom: [60, 58, 96] },
    dawn:  { top: [247, 200, 192], bottom: [255, 226, 184] },
    day:   { top: [173, 211, 236], bottom: [233, 243, 247] },
    dusk:  { top: [231, 183, 166], bottom: [246, 217, 168] }
  };

  function lerp(a, b, t) { return a + (b - a) * t; }
  function lerpC(c1, c2, t) {
    return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
  }
  function rgb(c, a) {
    return 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + (a == null ? 1 : a) + ')';
  }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /* 依据本地时间得到当前天空色板（顶/底），分段插值 */
  function skyPalette(date) {
    var h = date.getHours() + date.getMinutes() / 60;
    var top, bottom;
    if (h < 5) { top = STOPS.night.top; bottom = STOPS.night.bottom; }
    else if (h < 7) { var t = (h - 5) / 2; top = lerpC(STOPS.night.top, STOPS.dawn.top, t); bottom = lerpC(STOPS.night.bottom, STOPS.dawn.bottom, t); }
    else if (h < 9) { var t2 = (h - 7) / 2; top = lerpC(STOPS.dawn.top, STOPS.day.top, t2); bottom = lerpC(STOPS.dawn.bottom, STOPS.day.bottom, t2); }
    else if (h < 16) { top = STOPS.day.top; bottom = STOPS.day.bottom; }
    else if (h < 18) { var t3 = (h - 16) / 2; top = lerpC(STOPS.day.top, STOPS.dusk.top, t3); bottom = lerpC(STOPS.day.bottom, STOPS.dusk.bottom, t3); }
    else if (h < 20) { var t4 = (h - 18) / 2; top = lerpC(STOPS.dusk.top, STOPS.night.top, t4); bottom = lerpC(STOPS.dusk.bottom, STOPS.night.bottom, t4); }
    else { top = STOPS.night.top; bottom = STOPS.night.bottom; }
    return { top: top, bottom: bottom };
  }

  /* 昼夜因子 0（夜）..1（正午） */
  function daylight(date) {
    var h = date.getHours() + date.getMinutes() / 60;
    return clamp(Math.sin((h - 6) / 12 * Math.PI), 0, 1);
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

  /* 生成一层云：不同高度 / 速度 / 缩放 / 透明度 */
  function makeClouds(seed, count, baseY, scale, speed, alpha) {
    var r = rng(seed), arr = [];
    for (var i = 0; i < count; i++) {
      arr.push({
        x: r() * 1.3 - 0.15,
        y: baseY + (r() - 0.5) * 0.18,
        s: scale * (0.7 + r() * 0.6),
        sp: speed * (0.7 + r() * 0.6),
        a: alpha * (0.7 + r() * 0.5),
        w: 0.18 + r() * 0.22
      });
    }
    return arr;
  }

  function drawCloud(ctx, x, y, w, h, alpha) {
    var g = ctx.createRadialGradient(x, y, 0, x, y, w);
    g.addColorStop(0, 'rgba(255,255,255,' + alpha + ')');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y, w, h, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  var Sky = {};

  Sky.mount = function (canvas) {
    if (!canvas || !canvas.getContext) return;
    if (canvas.__skyId) cancelAnimationFrame(canvas.__skyId);

    var ctx = canvas.getContext('2d');
    var W = 1, H = 1;
    var dpr = Math.min(global.devicePixelRatio || 1, 2);
    var reduced = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;

    var stars = (function () {
      var r = rng(2026), a = [];
      for (var i = 0; i < 70; i++) a.push({ x: r(), y: r() * 0.6, r: 0.6 + r() * 1.3, p: r() * Math.PI * 2 });
      return a;
    })();
    var clouds = [
      makeClouds(11, 3, 0.30, 1.0, 0.004, 0.55),
      makeClouds(29, 3, 0.46, 1.35, 0.006, 0.42),
      makeClouds(47, 4, 0.62, 1.7, 0.009, 0.30)
    ];
    var meteors = [];

    function resize() {
      var rect = canvas.getBoundingClientRect();
      W = Math.max(1, rect.width); H = Math.max(1, rect.height);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    var ro = null;
    if (global.ResizeObserver) { ro = new ResizeObserver(resize); ro.observe(canvas); }
    else { global.addEventListener('resize', resize); }

    function paintSky(pal, dl, bright) {
      var grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, rgb(pal.top, 1));
      grad.addColorStop(1, rgb(pal.bottom, 1));
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);

      if (dl > 0.05) {
        var cloudAlpha = clamp(dl * 1.4, 0, 1) * bright;
        for (var L = 0; L < clouds.length; L++) {
          var layer = clouds[L];
          for (var i = 0; i < layer.length; i++) {
            var c = layer[i];
            var cx = c.x * W, cy = c.y * H, cw = c.w * W * c.s, ch = cw * 0.42;
            drawCloud(ctx, cx, cy, cw, ch, c.a * cloudAlpha);
            drawCloud(ctx, cx + cw * 0.5, cy - ch * 0.2, cw * 0.7, ch * 0.8, c.a * 0.7 * cloudAlpha);
          }
        }
      }
      if (dl < 0.3) {
        var sa = clamp((0.3 - dl) / 0.3, 0, 1);
        for (var s = 0; s < stars.length; s++) {
          var st = stars[s];
          ctx.beginPath();
          ctx.arc(st.x * W, st.y * H, st.r, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255,255,255,' + (0.45 * sa + 0.08) + ')';
          ctx.fill();
        }
      }
    }

    function maybeSpawnMeteor(dl) {
      if (dl > 0.25) return;
      if (Math.random() < 0.004 && meteors.length < 2) {
        meteors.push({ x: 0.1 + Math.random() * 0.5, y: 0.05 + Math.random() * 0.25,
          vx: 0.012 + Math.random() * 0.01, vy: 0.006 + Math.random() * 0.006, life: 1 });
      }
    }

    function paintMeteors() {
      for (var m = meteors.length - 1; m >= 0; m--) {
        var me = meteors[m];
        me.x += me.vx; me.y += me.vy; me.life -= 0.012;
        if (me.life <= 0 || me.x > 1.1 || me.y > 0.7) { meteors.splice(m, 1); continue; }
        var mx = me.x * W, my = me.y * H, len = 40;
        var g2 = ctx.createLinearGradient(mx, my, mx - me.vx * len * 60, my - me.vy * len * 60);
        g2.addColorStop(0, 'rgba(255,255,255,' + (0.9 * me.life) + ')');
        g2.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.strokeStyle = g2; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(mx, my);
        ctx.lineTo(mx - me.vx * len * 60, my - me.vy * len * 60);
        ctx.stroke();
      }
    }

    function cleanup() {
      if (ro) ro.disconnect();
      if (canvas.__skyId) cancelAnimationFrame(canvas.__skyId);
      canvas.__skyId = null;
    }

    function frame(time) {
      if (!canvas.isConnected) { cleanup(); return; } // 离开首页 → 自动停止，释放资源
      var now = new Date();
      var pal = skyPalette(now);
      var dl = daylight(now);
      var bright = 1 + seasonOffset(now) * 0.05;
      paintSky(pal, dl, bright);
      // 云缓慢漂移（仅在画面内循环）
      for (var L = 0; L < clouds.length; L++) {
        var layer = clouds[L];
        for (var i = 0; i < layer.length; i++) {
          var c = layer[i];
          c.x += c.sp * 0.016;
          if (c.x - c.w > 1.2) c.x = -0.2 - c.w;
        }
      }
      maybeSpawnMeteor(dl);
      paintMeteors();
      canvas.__skyId = requestAnimationFrame(frame);
    }

    function paintStatic() {
      var now = new Date();
      var pal = skyPalette(now);
      var dl = daylight(now);
      paintSky(pal, dl, 1);
      for (var s = 0; s < stars.length; s++) {
        var st = stars[s];
        ctx.beginPath();
        ctx.arc(st.x * W, st.y * H, st.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fill();
      }
    }

    if (reduced) { paintStatic(); }
    else { canvas.__skyId = requestAnimationFrame(frame); }

    canvas.__skyStop = cleanup;
  };

  Sky.stop = function (canvas) { if (canvas && canvas.__skyStop) canvas.__skyStop(); };

  global.Sky = Sky;
})(window);
