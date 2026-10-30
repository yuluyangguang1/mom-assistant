/**
 * dock-worker.js — 第 328 次（原型分支 proto-worker-lens）：dock 的 WebGL 画在 Worker 里（OffscreenCanvas），透镜物理也在这里推进。
 *
 * 为什么：切页时主线程要建新页面（几十到几百毫秒），透镜动画原来跑在主线程 rAF 上，这段时间整块停住、再一下跳到位。
 * 这里把「画」和「透镜弹簧」都搬过来，Worker 自己用 requestAnimationFrame（没有就 setTimeout 16ms）推进，主线程再忙透镜也照走。
 *
 * 分工：
 *   · 主线程（dock-refract.js）仍然做所有要读 DOM 的事：页面快照光栅化、图标层、布局量测（静止时）、决定画什么。
 *     它对一个「录制代理」调 WebGL（同一份着色器、同一套 uniform 代码），代理把调用打包发过来，这里原样重放到真上下文。
 *     画布纹理（快照 / 底色条 / 透镜图标层）用 createImageBitmap 转成 ImageBitmap，transferable 发过来，不拷贝。
 *   · 透镜：按下时主线程把量好的透镜状态（与 liquid-dock.js 同一个对象）发过来；之后每帧在这里用 LensPhys.step / geom（与主线程同一份代码）推进、
 *     只改透镜相关的 uniform 重画一遍（其它 uniform 留在程序对象里，就是主线程上一次画 dock 时设的值）。
 *     主线程只转发指针事件（mv / rt / rl / ds），这里每帧把状态回传（L），主线程空闲时据此改 DOM（挖洞遮罩、胶囊透明度、.lg-shrink）。
 *   · 收回那一刻要主线程同步改 DOM：主线程心跳（hb）超过 40ms 没来（它正忙），透镜先停在吸附态，主线程一回来就收。
 */
'use strict';
importScripts('lens-phys.js');
var LP = self.LensPhys;
var cvs = null, gl = null, OBJ = {}, ULOC = {}, info = {}, mainOrigin = 0;
var mainProg = 0, dockDark = false, dockRed = false, haveDock = false;
var L = null, red = false, DSC = null, raf = 0, lastHB = -1e9, frames = [], drawsL = 0, drawsM = 0, errs = [];
var LENS_MAG_I = 0.97;
var rAF = self.requestAnimationFrame ? function (f) { return self.requestAnimationFrame(f); } : function (f) { return setTimeout(function () { f(performance.now()); }, 16); };
var cAF = self.cancelAnimationFrame ? function (h) { self.cancelAnimationFrame(h); } : function (h) { clearTimeout(h); };
/* 主线程时间轴（L 里的时刻都按主线程 performance.now 记） */
function nowM() { return performance.now() + (performance.timeOrigin - mainOrigin); }

function obj(a) { return a && typeof a === 'object' && a.$ != null ? OBJ[a.$] : a; }
function uloc(a) {
  var k = a.$u[0] + '|' + a.$u[1];
  if (!(k in ULOC)) { var p = OBJ[a.$u[0]]; ULOC[k] = p ? gl.getUniformLocation(p, a.$u[1]) : null; }
  return ULOC[k];
}
function arg(a) {
  if (a && typeof a === 'object') { if (a.$ != null) return OBJ[a.$]; if (a.$u) return uloc(a); }
  return a;
}
function replay(q) {
  var sawDock = false;
  for (var i = 0; i < q.length; i++) {
    var c = q[i], op = c[0];
    try {
      if (op === 'create') {
        var t = c[1], o = null;
        if (t === 'Shader') o = gl.createShader(c[3]); else if (t === 'Program') o = gl.createProgram(); else if (t === 'Texture') o = gl.createTexture(); else if (t === 'Buffer') o = gl.createBuffer();
        OBJ[c[2]] = o;
      } else if (op === 'size') {
        if (cvs.width !== c[1]) cvs.width = c[1];
        if (cvs.height !== c[2]) cvs.height = c[2];
      } else if (op === '@dock') {
        mainProg = c[1]; dockDark = !!c[2]; dockRed = !!c[3]; haveDock = true; sawDock = true; drawsM++;
      } else if (op === 'lose') {
        var ex = gl.getExtension('WEBGL_lose_context'); if (ex) ex.loseContext();
      } else if (op === 'linkProgram') {
        var pp = obj(c[1]);
        gl.bindAttribLocation(pp, 0, 'a');   /* 主线程代理的 getAttribLocation 恒返回 0 */
        gl.linkProgram(pp);
        if (!gl.getProgramParameter(pp, gl.LINK_STATUS)) errs.push('link:' + gl.getProgramInfoLog(pp));
      } else if (op === 'compileShader') {
        var sh = obj(c[1]); gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) errs.push('compile:' + gl.getShaderInfoLog(sh));
      } else if (op === 'texImage2D') {
        if (c.length === 7) gl.texImage2D(c[1], c[2], c[3], c[4], c[5], c[6]);
        else gl.texImage2D(c[1], c[2], c[3], c[4], c[5], c[6], c[7], c[8], c[9]);
        if (c[6] && c[6].close) c[6].close();
      } else if (op === 'texSubImage2D') {
        if (c.length === 8) gl.texSubImage2D(c[1], c[2], c[3], c[4], c[5], c[6], c[7]);
        else gl.texSubImage2D(c[1], c[2], c[3], c[4], c[5], c[6], c[7], c[8], c[9]);
        if (c[7] && c[7].close) c[7].close();
      } else if (op === 'nop') {
      } else {
        var f = gl[op];
        if (typeof f === 'function') {
          var a = []; for (var j = 1; j < c.length; j++) a.push(arg(c[j]));
          f.apply(gl, a);
        }
      }
    } catch (e) { errs.push(op + ':' + e); if (errs.length > 20) errs.shift(); }
  }
  return sawDock;
}

/* ---------- 透镜（物理 + 只改透镜 uniform 的重画） ---------- */
function U(n) { return uloc({ $u: [mainProg, n] }); }
function dsNow(t) {
  if (!DSC) return 1;
  return LP.curveAt(DSC.c, t - DSC.t0)[0];
}
function drawLens(G) {
  if (!haveDock || !gl || !OBJ[mainProg]) return;
  gl.useProgram(OBJ[mainProg]);
  if (G) {
    var r = G.rect, fx = G.fx, br = fx.br;
    gl.uniform1f(U('uHasT'), 1);
    gl.uniform4f(U('uT'), r.x, r.y, r.w, r.h); gl.uniform1f(U('uRT'), Math.min(r.w, r.h) / 2);
    gl.uniform1f(U('uLM'), G.m); gl.uniform1f(U('uLG'), G.g); gl.uniform1f(U('uLA'), Math.max(0, Math.min(1, G.op)));
    gl.uniform1f(U('uMagI'), 1 + (LENS_MAG_I - 1) * Math.max(0, Math.min(1, G.g)));
    gl.uniform4f(U('uLX'), dockRed ? 0 : (fx.hl || 0), dockRed ? 0 : (fx.flash || 0), fx.fuse || 0, fx.a || 0);
    gl.uniform3f(U('uLO'), (dockDark ? 0.26 : 0.06) * (fx.sh == null ? 1 : fx.sh), dockDark ? 0 : 0.45, 0);
    gl.uniform3f(U('uDS'), br.left + br.width / 2, br.top + br.height / 2, fx.ds || 1);
    gl.uniform4f(U('uEP'), fx.ep || 0, fx.ep ? (fx.ek || 10) : 0, 0, 0);
  } else {
    gl.uniform1f(U('uHasT'), 0); gl.uniform4f(U('uEP'), 0, 0, 0, 0); gl.uniform1f(U('uLA'), 1); gl.uniform1f(U('uLG'), 1); gl.uniform1f(U('uMagI'), LENS_MAG_I);
  }
  gl.viewport(0, 0, cvs.width, cvs.height);
  gl.uniform2f(U('uCv'), cvs.width, cvs.height);
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  drawsL++;
}
function snap(Lx) {
  /* 回传给主线程的数值字段（主线程的镜像对象逐字段覆盖） */
  var o = {};
  for (var k in Lx) { var v = Lx[k]; if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') o[k] = v; }
  return o;
}
function gate() { return nowM() - lastHB < 40; }
function frame() {
  raf = 0;
  if (!L) return;
  var t0 = performance.now(), n = nowM();
  var raw = Math.min(100, Math.max(1, n - L.last)); L.last = n;
  var dt = LP.pace(L, raw);
  var ok = LP.step(L, dt, red, gate), ev = L.ev;
  var ds = dsNow(n);
  if (!ok) {
    drawLens(null);
    frames.push({ t: Math.round(n), raw: Math.round(raw * 10) / 10, dt: Math.round(dt * 10) / 10, work: Math.round((performance.now() - t0) * 100) / 100, k: 'end', x: L.x });
    self.postMessage({ t: 'L', ev: 'end', L: snap(L), n: n });
    L = null;
    return;
  }
  var G = LP.geom(L, ds, red);
  drawLens(G);
  frames.push({ t: Math.round(n), raw: Math.round(raw * 10) / 10, dt: Math.round(dt * 10) / 10, work: Math.round((performance.now() - t0) * 100) / 100, k: L.phase, x: Math.round(L.x * 100) / 100, s: Math.round(L.s * 1000) / 1000, held: L.held || 0 });
  if (frames.length > 600) frames.shift();
  self.postMessage({ t: 'L', ev: ev, L: snap(L), n: n, ds: ds });
  raf = rAF(frame);
}
function kick() { if (L && !raf) raf = rAF(frame); }

self.onmessage = function (e) {
  var d = e.data, t = d.t;
  if (t === 'init') {
    cvs = d.c; mainOrigin = d.mo || performance.timeOrigin;
    try { gl = cvs.getContext('webgl', d.opts) || cvs.getContext('experimental-webgl', d.opts); } catch (er) { gl = null; info.err = String(er); }
    if (gl) {
      try {
        cvs.addEventListener('webglcontextlost', function (ev) { ev.preventDefault(); self.postMessage({ t: 'lost' }); }, false);
        cvs.addEventListener('webglcontextrestored', function () { OBJ = {}; ULOC = {}; haveDock = false; self.postMessage({ t: 'restored' }); }, false);
      } catch (er2) { /* 不支持事件的老实现 */ }
    }
    self.postMessage({ t: 'ready', ok: !!gl, raf: !!self.requestAnimationFrame, ver: gl ? String(gl.getParameter(gl.VERSION)) : '', err: info.err || '' });
    return;
  }
  if (!gl) return;
  if (t === 'cmd') {
    var e0 = errs.length;
    var saw = replay(d.q);
    /* 透镜在 Worker 里跑着：主线程这一帧画的 dock（透镜 uniform 是它的旧镜像）之后马上用最新透镜重画一遍，同一个任务里只有最后一次会提交 */
    if (saw && L) drawLens(LP.geom(L, dsNow(nowM()), red));
    if (errs.length > e0) self.postMessage({ t: 'err', errs: errs.slice(e0) });
    return;
  }
  if (t === 'ls') {   /* 透镜开始（主线程 lensStart 量好的状态） */
    L = d.L; red = !!d.red; L.ev = '';
    lastHB = nowM();
    kick();
    return;
  }
  if (t === 'hb') { lastHB = nowM(); return; }
  if (!L && t !== 'ds' && t !== 'perf' && t !== 'stop') return;
  if (t === 'mv') { L.tx = d.tx; L.rb = d.rb; L.tap = false; kick(); return; }
  if (t === 'rt') {   /* 连点改目标（同 liquid-dock.js lensRetarget 的字段改动） */
    L.tx = d.tx; L.down = true; L.tap = true; L.tp = L.last || nowM(); L.rb = 0;
    L.gx = L.x; L.gsm = true; L.vs = 0;
    L.endSide = d.endSide; L.hit = false; L.pw = d.pw;
    if (L.phase === 'shrink' || L.phase === 'settle') L.phase = 'hold';
    L.retargets = (L.retargets || 0) + 1;
    kick();
    return;
  }
  if (t === 'rl') {   /* 松手（同 lensRelease） */
    L.down = false;
    if (L.phase === 'settle' || L.phase === 'shrink') return;
    if (d.x != null) L.tx = d.x;
    L.rb = 0; L.vx = Math.max(-700, Math.min(700, L.vx));
    L.phase = 'settle'; L.ts = L.last;
    kick();
    return;
  }
  if (t === 'lx') { if (raf) cAF(raf); raf = 0; L = null; drawLens(null); return; }
  if (t === 'ds') {   /* 整条 dock 按下 / 松手：与主线程的合成器动画同一条离线曲线 */
    var cur = DSC ? LP.curveAt(DSC.c, d.at - DSC.t0) : [1, 0];
    DSC = { t0: d.at, c: LP.dsCurve(cur[0], cur[1], !!d.down) };
    return;
  }
  if (t === 'perf') { self.postMessage({ t: 'perf', frames: frames.slice(), drawsL: drawsL, drawsM: drawsM, errs: errs.slice(), lens: !!L }); if (d.clear) frames.length = 0; return; }
  if (t === 'stop') {
    if (raf) cAF(raf); raf = 0; L = null;
    try { var ex2 = gl.getExtension('WEBGL_lose_context'); if (ex2) ex2.loseContext(); } catch (er3) { /* */ }
    gl = null; OBJ = {}; ULOC = {};
    self.close();
  }
};
