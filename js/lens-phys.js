/**
 * lens-phys.js — 第 328 次（原型分支 proto-worker-lens）：dock 透镜物理抽成纯函数，主线程（liquid-dock.js）和 Worker（dock-worker.js）共用同一份代码。
 *
 * 只是搬家，不改任何数值：PHYS（第 314~322 次的全部弹簧参数）、springStep（半隐式欧拉 4ms 子步）、deformTarget（速度形变）、
 * step（原 liquid-dock.js 的 lensStep：17 帧点击节奏的两条边、撞端果冻、吸附 / 收回）、pace（长帧欠账分两帧摊）、
 * geom（原 lensApply 里纯算术的那一半：透镜宽高 / 中心 / 不透明度 / 栏端外凸 / 交给着色器的 uniform）。
 * DOM 副作用（.lg-shrink、选中图标小动作、胶囊透明度、挖洞遮罩、栏缩放）留在调用方：step 用 L.ev = 'shrink' 告诉它。
 * 主线程和 Worker 用同一个文件 → 「行为与参数不变」由构造保证，不靠两份代码对齐。
 */
(function (G) {
  'use strict';
  var LP = {};
  var PHYS = {
    grow: { k: 520, z: 0.58 },     /* 按下鼓起：约 0.11s 到 1、0.17s 过冲峰（~10%） */
    drag: { k: 6000, z: 1 },       /* 拖动跟手：临界阻尼。第 319 次 2200 → 6000：ω 47 → 77/s，稳态滞后 2/ω 42 → 26ms（匀速 357pt/s 时落后 14 → 9pt） */
    snap: { k: 560, z: 0.74 },     /* 松手吸附：轻微过冲一次（甩动速度先限到 ±700px/s，不会甩过头）；第 316 次 380 → 560：拖完松手到胶囊 11 帧 → ~9 帧（支付宝 120~130ms） */
    shape: { k: 420, z: 0.38 },    /* 形变：果冻回弹 1~2 次（第二个峰 < 8%） */
    shrink: { k: 1700, z: 1 },     /* 收回胶囊：第 316 次 900 → 1700，~70ms / 4 帧不回弹（支付宝 22:03 第 147→150 帧 3 帧、App Store 23:38 第 179→183 帧 4~5 帧；原来 6 帧） */
    /* 第 316 次：点击（没拖）时透镜从旧页签滑到新页签用单独一根临界阻尼弹簧，ω≈24.5/s：+5 帧 ≈60%、+8 帧 ≈84%、+13 帧 ≈97%。
       对照支付宝 22:03 逐帧（第 133 帧按下 → 137 ≈45%、140 ≈64%、145 ≈87%、150 到位收回）与 App Store 23:38（第 169 帧按下 → 172 ≈46%、175 ≈82%、≈178 到位）；
       原来点击也走拖动的 drag 弹簧（ω≈47），4 帧就到 90%，「啪」地一下到位、没有支付宝那种先冲后缓的滑行 */
    tap: { k: 600, z: 1 },
    tapV: 0.45,                    /* 点击滑行时速度形变 / 速度高光只按 45% 算：支付宝点击滑行透镜不被压扁，原来满形变 + 速度高光 = 鼓起头几帧透镜上半截发白 */
    exitPx: 2.5, exitV: 150, exitMs: 90,   /* 第 316 次：吸附基本到位（差 ≤2.5px、速度 ≤150px/s、松手 ≥90ms）就开始收回——支付宝在离中心还差约 6% 时就开始收回 */
    vFull: 0.9,                    /* px/ms：达到满形变的速度（≈ 900pt/s） */
    stretch: 0.12, squash: 0.11,   /* 沿速度方向拉长 / 垂直方向压扁上限 */
    rubber: 26, rubberC: 0.55,     /* 两端橡皮筋：最多拉出 26px，系数同 iOS 0.55 */
    fuse: 8,                       /* 透镜与 dock 的 smooth-min 融合半径（px） */
    /* 第 319 次：点击起步「先拉长、后滑、末端收拢」——透镜拆成左右两条边各走一根临界阻尼弹簧：前缘立刻走；后缘先停 2 帧（40ms 内不动）再跟上。
       报告建议前缘 k≈900 / 后缘 k≈300；但后缘停 2 帧后再用 300，中心进度 +4 帧只有 ~35%（现状 51%），用户要求点击滑行节奏保持现状（App Store 式），
       所以前缘 1200、后缘 560：中心进度 +4 / +8 / +12 帧 ≈ 48% / 83% / 95%（现状 51 / 84 / 95）。
       宽 = 两边之差（上限 104），中心 = 两边均值；鼓起 s 改临界阻尼（不过冲），约第 4 帧到 75% 才像透镜。 */
    lead: { k: 1200, z: 1 }, trail: { k: 560, z: 1 }, trailHold: 40,
    tapGrow: { k: 1600, z: 1 },
    tapMaxW: 104, tapDH: -4, tapBulge: 8, bigAfter: 160,   /* 按住超过 160ms 算长按（点击一般 80~120ms）→ 第十四版大透镜 */
    /* 第 319 次：按下整条 dock 放大（对照支付宝 22:03 +3.6% / App Store 23:38 +3.7%）——整块合成层 scale，GL 画布跟着一起缩放、不重新取样。
       按下 k 1500 ζ 0.8 朝 1.038；松手 k 250 ζ 0.6 回 1：83ms 松手时峰值 +3.6%（≈92ms）、≈268ms 回到 1、下冲 −0.32%（≈340ms）、≈470ms 停稳 */
    press: { k: 1500, z: 0.8, amp: 0.038 }, release: { k: 250, z: 0.6 },
    catchUp: 1.5,                  /* 帧间隔超过 1.5 帧：追赶量分两帧摊开 */
    /* 第 321 次（Telegram 参考 A2）：长按 / 拖动时的速度形变——横向 sx = 1 + min(0.15, |v| / 2400)，纵向 sy = (1/√sx)·(1 − 0.08·(sx−1)/0.15)（满形变 ≈ 0.92/√sx，面积近似守恒）；
       临界阻尼 k 1500：停手后 ≈120ms 内回到 1（残差 < 1%）。点击不用这套（仍是 tapV 0.45 的旧形变，17 帧节奏不变） */
    bigV: 2400, bigMax: 0.15, bigSq: 0.08, bigShape: { k: 1500, z: 1 },
    /* 第 321 次收尾：连点改目标时，两条边的弹簧目标不再一步跳到新页签——目标从透镜当前位置按一阶低通（τ 80ms）滑过去，
       原来目标突变、前缘 k 1200 第二帧就冲出 21pt（相邻帧阈值 14pt）。只管改目标那一下，第一次按下的 17 帧节奏不受影响 */
    retargetTau: 80,
    /* 第 322 次（Telegram 参考 B3）：撞端果冻——只在点到两端页签时：透镜外沿冲到栏内壁（栏端往里 endInset）还在往外走，
       前缘的速度（px/s ÷ 透镜宽）× hitGain 一次性变成压缩比 jc 的初速度（「撞上去被压扁」），jc 走 k 250 ζ 0.7 的弹簧（压到 ≈15% 再弹回、略过冲 = 果冻），上限 0.18；
       外沿始终夹在内壁上、内沿不动；竖向 sy = 1 + 0.8·jc（最多鼓出栏外 4pt）。透镜收回后余下的形变交给静止胶囊弹完。
       透镜中心的物理位置（两条边的弹簧）不变 = 17 帧节奏、单调不越过目标都不受影响；中间页签 jc 恒 0，透镜仍在栏内 */
    jelly: { k: 250, z: 0.7 }, hitGain: 3.6, hitZone: 3, hitV: 120, endInset: 4, jellySy: 0.8, jellyMax: 0.18, jellyDH: 4,
    /* 第 322 次（Telegram 参考 A3）：长按 / 拖动把透镜顶过端点页签（越过它在栏内的静止位置）时，栏端被拉出：外凸 = 0.6 × 越界量，上限 7pt；
       GL 里「透镜 × 一级 dock」这一对单独用 k_end = 10pt 的 smooth-min 并进去（dock-refract 的 dk()，不进二级融合的逐对 k 表）。无 GL（Chromium SVG）不外凸 */
    endPullK: 0.6, endPullMax: 7, kEnd: 10
  };
  /* 半隐式欧拉，4ms 子步；v 单位 px/s */
  function springStep(x, v, target, p, dt, crit) {
    var k = p.k, z = crit ? Math.max(1, p.z) : p.z, c = 2 * z * Math.sqrt(k);
    var n = Math.max(1, Math.ceil(dt / 4)), h = dt / 1000 / n;
    for (var i = 0; i < n; i++) { v += (-k * (x - target) - c * v) * h; x += v * h; }
    return [x, v];
  }
  /* 速度 → 形变目标（体积大致守恒：1.12 × 0.89 ≈ 1） */
  function deformTarget(vx, rb, red, tap, big) {
    if (red) return [1, 1, 0];
    if (big) {
      var ex = Math.min(PHYS.bigMax, Math.abs(vx) / PHYS.bigV), sxB = 1 + ex;
      var rB = Math.min(1, Math.abs(rb || 0) / PHYS.rubber);
      var aB = Math.min(1, Math.abs(vx) / 1000 / PHYS.vFull); aB = aB * (2 - aB);
      return [sxB + 0.10 * rB, (1 / Math.sqrt(sxB)) * (1 - PHYS.bigSq * ex / PHYS.bigMax) - 0.05 * rB, aB];
    }
    var a = Math.min(1, Math.abs(vx) * (tap ? PHYS.tapV : 1) / 1000 / PHYS.vFull); a = a * (2 - a);
    var r = Math.min(1, Math.abs(rb || 0) / PHYS.rubber);
    return [1 + PHYS.stretch * a + 0.10 * r, 1 - PHYS.squash * a - 0.05 * r, a];
  }
  var FRAME = 1000 / 60;
  function pace(o, raw) {
    if (o.debt) { var t2 = raw + o.debt; o.debt = 0; return t2; }   /* 上一帧欠下的另一半：这一帧补完（只摊两帧，不会越欠越多） */
    if (raw > PHYS.catchUp * FRAME) { var use = FRAME + (raw - FRAME) / 2; o.debt = raw - use; return use; }
    return raw;
  }
  /* 第 319 次：每帧耗时记录（Performance API）——rAF 间隔、这一帧物理 + 写样式 + GL 画的耗时、追赶量；长任务另由 PerformanceObserver 记 */
  function step(L, dt, red, gate) {
    var n = L.last;
    L.ev = '';
    var q;
    /* 第 319 次：长按（还按着、超过 bigAfter）或拖动 → 第十四版大透镜；点击 → 栏内小透镜。两者之间按 35ms 指数过渡，不跳 */
    var bigT = (!L.tap || (L.down && n - (L.tp || L.t0) > PHYS.bigAfter)) ? 1 : 0;   /* 第 321 次：tp = 这一次按下的时刻（连点改目标时重记，t0 不动） */
    L.bf += (bigT - L.bf) * (1 - Math.exp(-dt / 35));
    if (Math.abs(bigT - L.bf) < 0.002) L.bf = bigT;
    var edges = L.tap && L.bf < 0.5;   /* 点击：两条边各走各的弹簧，中心 = 两边均值 */
    var exitOK = false;
    /* 第 321 次收尾：弹簧实际追的目标 TX——只有连点改目标后才低通滑过去（gsm），拖动 / 第一次按下直接等于 tx */
    if (L.gsm && L.tap) {
      L.gx += (L.tx - L.gx) * (1 - Math.exp(-dt / PHYS.retargetTau));
      if (Math.abs(L.tx - L.gx) < 0.2) { L.gx = L.tx; L.gsm = false; }
    } else { L.gx = L.tx; L.gsm = false; }
    var TX = L.gx;
    if (L.phase === 'shrink') {
      q = springStep(L.s, L.vs, -0.25, PHYS.shrink, dt, true); L.s = q[0]; L.vs = q[1];
    } else {
      q = springStep(L.s, L.vs, 1, edges ? PHYS.tapGrow : PHYS.grow, dt, red || edges); L.s = q[0]; L.vs = q[1];
      if (L.phase === 'grow' && n - L.t0 > 150) L.phase = 'hold';
    }
    if (edges) {
      var hw = L.pw / 2, tL = TX - hw, tR = TX + hw, dir = L.tx > L.x + 0.01 ? 1 : L.tx < L.x - 0.01 ? -1 : 0;
      var trailGo = n - L.t0 > PHYS.trailHold || dir === 0;
      if (dir >= 0) {
        q = springStep(L.eR, L.veR, tR, PHYS.lead, dt, true); L.eR = q[0]; L.veR = q[1];
        if (trailGo) { q = springStep(L.eL, L.veL, tL, dir === 0 ? PHYS.lead : PHYS.trail, dt, true); L.eL = q[0]; L.veL = q[1]; }
      } else {
        q = springStep(L.eL, L.veL, tL, PHYS.lead, dt, true); L.eL = q[0]; L.veL = q[1];
        if (trailGo) { q = springStep(L.eR, L.veR, tR, PHYS.trail, dt, true); L.eR = q[0]; L.veR = q[1]; }
      }
      /* 宽上限 104：后缘被前缘拖着走 */
      if (L.eR - L.eL > PHYS.tapMaxW) { if (dir >= 0) { L.eL = L.eR - PHYS.tapMaxW; L.veL = Math.max(L.veL, L.veR); } else { L.eR = L.eL + PHYS.tapMaxW; L.veR = Math.min(L.veR, L.veL); } }
      L.x = (L.eL + L.eR) / 2; L.vx = (L.veL + L.veR) / 2;
      exitOK = Math.abs((L.eR - L.eL) - L.pw) < 3;
    } else {
      /* 拖动 / 长按 / 松手吸附：原来的中心弹簧；两条边跟着中心（切回点击形态时不跳） */
      var pX = L.phase === 'settle' || L.phase === 'shrink' ? (L.tap ? PHYS.tap : PHYS.snap) : (L.tap ? PHYS.tap : PHYS.drag);
      q = springStep(L.x, L.vx, TX, pX, dt, L.phase === 'settle' ? (L.tap || red) : true); L.x = q[0]; L.vx = q[1];
      L.eL = L.x - L.pw / 2; L.eR = L.x + L.pw / 2; L.veL = L.veR = L.vx;
      exitOK = true;
    }
    /* 第 322 次：撞端果冻——外沿冲到内壁那一帧把前缘速度换成 jc 的初速度（只撞一次）；之后 jc 走果冻弹簧。
       cT = 不压的话外沿会越过内壁多少（比例）：jc 不小于它（外沿不穿墙） */
    var cT = 0;
    if (edges && L.endSide && !red) {
      var wN = Math.max(1, Math.min(PHYS.tapMaxW, ((L.eR - L.eL) + PHYS.tapBulge * Math.max(0, L.s)) * L.sx));
      var lim = L.endSide > 0 ? L.br.right - PHYS.endInset - (L.ex || 0) : L.br.left + PHYS.endInset + (L.ex || 0);
      var gap = L.endSide * (lim - (L.x + L.endSide * wN / 2));   /* 外沿离内壁还有多远（负 = 已越过） */
      var vOut = L.endSide * (L.endSide > 0 ? L.veR : L.veL);
      if (!L.hit && gap < PHYS.hitZone && vOut > PHYS.hitV) { L.hit = true; L.vjc += PHYS.hitGain * vOut / wN; L.hitV = Math.round(vOut); }
      cT = Math.min(PHYS.jellyMax, Math.max(0, -gap) / wN);
    }
    if (red) { L.jc = 0; L.vjc = 0; }
    else if (L.jc !== 0 || L.vjc !== 0 || cT > 0) {
      q = springStep(L.jc, L.vjc, 0, PHYS.jelly, dt); L.jc = q[0]; L.vjc = q[1];
      if (L.jc < cT) { L.jc = cT; if (L.vjc < 0) L.vjc = 0; }
      if (L.jc > PHYS.jellyMax) { L.jc = PHYS.jellyMax; if (L.vjc > 0) L.vjc = 0; }
      if (L.jc < -0.06) L.jc = -0.06;
      if (cT === 0 && Math.abs(L.jc) < 0.0008 && Math.abs(L.vjc) < 0.02) { L.jc = 0; L.vjc = 0; }
    }
    if (L.jc > L.jcMax) L.jcMax = L.jc;
    if (L.phase === 'settle') {
      var el = n - L.ts;
      var due = (el > PHYS.exitMs && exitOK && Math.abs(L.tx - L.x) < PHYS.exitPx && Math.abs(L.vx) < PHYS.exitV && Math.abs(L.sx - 1) < 0.03 && Math.abs(L.sy - 1) < 0.03) || el > 520;
      /* 第 328 次：Worker 路径——收回那一刻主线程要同步改 DOM（.lg-shrink、选中图标露出、胶囊淡入），主线程卡住时先停在吸附态（gate 返回 false），不收 */
      if (due && gate && !gate(L)) { L.held = (L.held || 0) + 1; due = false; }
      if (due) {
        L.phase = 'shrink'; L.t1 = n; L.vs = Math.min(0, L.vs);
        L.ev = 'shrink';   /* 调用方（liquid-dock.js 主线程 / dock-worker.js 回传）据此改 DOM：.lg-shrink、popNow、胶囊透明度 */
      }
    } else if (L.phase === 'shrink') {
      if (L.s <= 0.02 || n - L.t1 > 400) return false;
    }
    var big = L.bf > 0.5 && L.phase !== 'shrink';   /* 第 321 次：长按 / 拖动（大透镜）才用速度形变新公式 */
    var tg = deformTarget(L.vx, L.rb, red, L.tap, big);
    if (red) { L.sx = L.sy = 1; L.vsx = L.vsy = 0; }
    else {
      var shp = big ? PHYS.bigShape : PHYS.shape;
      q = springStep(L.sx, L.vsx, tg[0], shp, dt, big); L.sx = q[0]; L.vsx = q[1];
      q = springStep(L.sy, L.vsy, tg[1], shp, dt, big); L.sy = q[0]; L.vsy = q[1];
    }
    L.a = tg[2];
    L.m += (tg[2] - L.m) * (1 - Math.exp(-dt / (tg[2] > L.m ? 40 : 170)));
    var dir2 = L.vx > 0 ? 1 : L.vx < 0 ? -1 : 0;
    L.hl += (dir2 * tg[2] - L.hl) * (1 - Math.exp(-dt / 60));
    L.flash *= Math.exp(-dt / 260);
    return true;
  }
  /* 第 319 次：帧间隔超过 1.5 帧（主线程被占住后的那一帧）时，这次只推进「1 帧 + 欠账的一半」，剩下的一半记到下一帧——
  /* 原 lensApply 的纯算术部分：返回透镜外形、给 CSS 透镜元素的变换、给着色器的 DR.lens 参数。会写 L.pull / L.pullMax（与原来相同） */
  function geom(L, ds, red) {
    var br = L.br, cy = br.top + br.height / 2, s = Math.max(0, L.s);
    var wT = Math.min(PHYS.tapMaxW, ((L.eR - L.eL) + PHYS.tapBulge * s) * L.sx), hT = Math.min(L.Ht, (L.ph + (L.Ht - L.ph) * s) * L.sy);
    var xT = L.x;
    if (L.jc && L.endSide) {
      var limA = L.endSide > 0 ? br.right - PHYS.endInset - (L.ex || 0) : br.left + PHYS.endInset + (L.ex || 0);
      var eo = L.x + L.endSide * wT / 2;
      if (L.endSide * (eo - limA) > 0) eo = limA;
      var wJ = wT * (1 - L.jc);
      xT = eo - L.endSide * wJ / 2; wT = wJ;
      var hJ = hT + Math.max(0, L.Ht - hT) * Math.max(0, Math.min(1, L.jc / 0.04));
      hT = Math.min(br.height - 2 * (L.ex || 0) + 2 * PHYS.jellyDH, hJ * (1 + PHYS.jellySy * L.jc));
    }
    var wB = (L.pw + (L.W - L.pw) * s) * L.sx, hB = (L.ph + (L.H - L.ph) * s) * L.sy;
    var w = wT + (wB - wT) * L.bf, h = hT + (hB - hT) * L.bf, sx = w / L.W, sy = h / L.H;
    var lxC = xT + (L.x - xT) * L.bf;
    ds = ds || 1;
    var ex = br.cx + (lxC - br.cx) * ds, ey = br.cy + (cy - br.cy) * ds;
    var op = L.phase === 'shrink' ? Math.min(1, s * 1.6) : 1;
    var lx = lxC - w / 2;
    var pull = 0;
    if (L.endC && L.bf > 0.5 && !red && L.phase !== 'shrink') {
      var ovP = L.x > L.endC[1] ? L.x - L.endC[1] : L.x < L.endC[0] ? L.x - L.endC[0] : 0;
      pull = (ovP > 0 ? 1 : -1) * Math.min(PHYS.endPullMax, PHYS.endPullK * Math.abs(ovP)) * Math.min(1, (L.bf - 0.5) * 2);
      if (Math.abs(pull) < 0.05) pull = 0;
    }
    L.pull = pull; if (Math.abs(pull) > L.pullMax) L.pullMax = Math.abs(pull);
    return { br: br, cy: cy, s: s, w: w, h: h, sx: sx, sy: sy, lxC: lxC, lx: lx, ex: ex, ey: ey, op: op, pull: pull,
      rect: { x: lx, y: cy - h / 2, w: w, h: h }, m: L.m, g: Math.max(0, Math.min(1, s)),
      fx: { hl: L.hl, flash: L.flash, fuse: red || L.bf < 0.5 ? 0 : PHYS.fuse, a: L.a, br: br, ds: ds, sh: L.bf, ep: pull, ek: PHYS.kEnd } };
  }
  /* 整条 dock 按下放大的一步（原 dsStep 的弹簧部分）：返回 false = 已停稳（s = 1） */
  function dsSpring(DS, dt) {
    var p = DS.down ? PHYS.press : PHYS.release, tg = DS.down ? 1 + PHYS.press.amp : 1;
    var q = springStep(DS.s, DS.v, tg, p, dt); DS.s = q[0]; DS.v = q[1];
    if (!DS.down && Math.abs(DS.s - 1) < 0.0004 && Math.abs(DS.v) < 0.01) { DS.s = 1; DS.v = 0; DS.on = false; return false; }
    return true;
  }
  /* 第 328 次：按下 / 松手后整条 dock 缩放的离线曲线（60fps 关键帧）——Worker 路径用它给栏写合成器动画（WAAPI scale），主线程卡住时栏缩放也不停；
     Worker 用同一条曲线算着色器里的 uDS，两边同源 */
  function dsCurve(s, v, down, maxMs) {
    var out = [[s, v]], DS = { s: s, v: v, down: down, on: true }, t = 0, dt = FRAME;
    while (t < (maxMs || 1200)) {
      var go = dsSpring(DS, dt); t += dt; out.push([DS.s, DS.v]);
      if (!go) break;
      if (down && Math.abs(DS.s - 1 - PHYS.press.amp) < 0.0004 && Math.abs(DS.v) < 0.01) break;
    }
    return out;
  }
  function curveAt(c, ms) {
    if (!c || !c.length) return [1, 0];
    var f = ms / FRAME, i = Math.floor(f);
    if (i >= c.length - 1) return c[c.length - 1];
    if (i < 0) return c[0];
    var u = f - i, a = c[i], b = c[i + 1];
    return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
  }
  LP.PHYS = PHYS; LP.springStep = springStep; LP.deformTarget = deformTarget; LP.pace = pace; LP.step = step; LP.geom = geom;
  LP.dsSpring = dsSpring; LP.dsCurve = dsCurve; LP.curveAt = curveAt; LP.FRAME = FRAME;
  G.LensPhys = LP;
})(typeof self !== 'undefined' ? self : this);
