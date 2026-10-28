/* ============================================================
 * motion.js · 第 292 次：跟手动画的共用物理（半屏面板、＋/菜单面板的下拉关闭）
 *
 * 以前每处下拉关闭各写一套：速度只取最后两次 touchmove 的差（抖），松手一律走固定 .28s 曲线——
 * 慢慢拖到一半松手和用力一甩，收起 / 弹回的速度一样，看着像「放了一段动画」，不像被手推出去的东西。
 * 这里给三样：
 *   tracker()  最近 100ms 的触点采样，松手速度用首尾差（px/ms），手指停住超过 80ms 视为 0；
 *   spring()   临界阻尼弹簧（rAF 自驱，可随时 stop / 被新触摸接住），带初速度：甩得越快收得越快；
 *              按真实时间推进（掉帧不变慢动作），单帧最多算 100ms，最长 900ms 必然落定；
 *   rubber()   iOS 橡皮筋阻尼（往不该去的方向拖：越拖越重，永远到不了 dim）。
 *   project()  按 iOS 滚动减速率估算松手后还会「滑」多远，用来判断甩没甩过半。
 * 减少动态效果：spring 直接落到终点（同步回调 onUpdate(to) + onDone）。
 * ============================================================ */
(function (global) {
  'use strict';
  var raf = global.requestAnimationFrame ? global.requestAnimationFrame.bind(global) : function (f) { return setTimeout(function () { f(Date.now()); }, 16); };
  var caf = global.cancelAnimationFrame ? global.cancelAnimationFrame.bind(global) : clearTimeout;
  function now() { return (global.performance && performance.now) ? performance.now() : Date.now(); }
  function reduced() { try { return global.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }

  function tracker() {
    var s = [];
    return {
      reset: function (v) { s = []; if (v != null) s.push([now(), v]); },
      add: function (v) {
        var t = now(); s.push([t, v]);
        while (s.length > 2 && t - s[0][0] > 100) s.shift();
      },
      /* px/ms；手指在最后一个位置停了超过 80ms = 没有甩 */
      velocity: function () {
        if (s.length < 2) return 0;
        var a = s[0], b = s[s.length - 1];
        if (now() - b[0] > 80) return 0;
        var dt = b[0] - a[0];
        return dt > 0 ? (b[1] - a[1]) / dt : 0;
      }
    };
  }

  /* opts: from, to, velocity(px/ms), response(秒，越小越快，默认 .38), damping(1 = 临界阻尼不过冲；<1 轻微回弹),
           onUpdate(v, progress), onDone() */
  function spring(opts) {
    var from = +opts.from || 0, to = +opts.to || 0;
    var x = from - to, v = (+opts.velocity || 0) * 1000; /* 相对终点的位移、px/s */
    var resp = opts.response || 0.38, zeta = opts.damping == null ? 1 : opts.damping;
    var k = Math.pow(2 * Math.PI / resp, 2), c = 4 * Math.PI * zeta / resp;
    var id = 0, last = 0, t0 = 0, done = false, span = Math.abs(from - to) || 1;
    function report(val) { if (opts.onUpdate) opts.onUpdate(val, Math.min(1, Math.max(0, 1 - Math.abs(val - to) / span))); }
    function finish() { if (done) return; done = true; if (id) caf(id); id = 0; report(to); if (opts.onDone) opts.onDone(); }
    function step(ts) {
      id = 0; if (done) return;
      /* 按真实经过时间推进（掉帧时不变成慢动作），单帧最多算 100ms（切后台回来不一步跳过头）；半隐式欧拉每小步 ≤4ms，稳定 */
      var t = now(); var dt = Math.min(0.1, Math.max(0.001, (t - last) / 1000)); last = t;
      var n = Math.ceil(dt / 0.004), h = dt / n;
      for (var i = 0; i < n; i++) { v += (-k * x - c * v) * h; x += v * h; }
      if ((Math.abs(x) < 0.5 && Math.abs(v) < 30) || t - t0 > 900) { finish(); return; }
      report(to + x);
      id = raf(step);
    }
    var api = {
      stop: function () { if (done) return to + x; done = true; if (id) caf(id); id = 0; return to + x; },
      value: function () { return to + x; },
      velocity: function () { return v / 1000; },
      get done() { return done; }
    };
    if (reduced() || opts.instant) { finish(); return api; }
    last = t0 = now();
    id = raf(step);
    return api;
  }

  function rubber(d, dim) {
    if (!dim) return 0;
    var s = d < 0 ? -1 : 1, a = Math.abs(d);
    return s * (1 - 1 / (a * 0.55 / dim + 1)) * dim;
  }

  /* iOS UIScrollView 正常减速率 0.998/ms：松手后还会走 v·r/(1-r) */
  function project(v) { return v * 0.998 / (1 - 0.998); }

  /* 下拉关闭的统一判定：拖过 1/4 高，或下甩 ≥ 0.5px/ms，或按惯性会滑过一半；往回（向上）甩 ≥ 0.25px/ms 一律弹回 */
  function shouldDismiss(off, vel, h) {
    if (vel <= -0.25) return false;
    return off > h * 0.25 || vel >= 0.5 || off + project(Math.max(0, vel)) * 0.35 > h * 0.5;
  }

  global.Motion = { tracker: tracker, spring: spring, rubber: rubber, project: project, shouldDismiss: shouldDismiss, reduced: reduced };
})(typeof window !== 'undefined' ? window : this);
