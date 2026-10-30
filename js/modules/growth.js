/**
 * growth.js - 生长（身高 / 体重 / 头围）
 *
 * 第 284 次：照竞品参考截图重做，迁到新骨架——
 *   首页：页头插画 → 摘要句 → 洞察（生长趋势 / 喂养与体重）→ 生长记录时间轴（点按修改、… 菜单编辑 / 删除、左滑删除）
 *        → 底部固定「+ 记录生长」（第 282 次共用实现）；右上角齿轮 = 生长设置半屏（记录头围开关、早产矫正月龄）。
 *   记录面板（全屏）：测量时间（日期 / 时间）→ 身高 / 体重 / 头围三段（每段显示已填值或「未填」）→ 大数字 + 单位 + 范围
 *        → 身高、头围用横向刻度尺，体重用半圆刻度表盘（都是自绘 SVG，可拖、可甩、可用方向键）→ 吸底「✓ 保存」。
 *        只保存实际填写（拖过 / 输入过）的项，没量的留空（第 278 次口径）。
 *   生长趋势（页内二级页，App.enterSub）：标准（中国 / WHO）、性别（读宝宝档案）、时间范围筛选；三项指标卡切换；
 *        曲线（实测点 + 线，叠加 P3–P97 参考带与 P50 虚线）；「标准对照」卡（P50 参考值、P3–P97 区间条、实测点位置）。
 *   喂养与体重（二级页）：同一时间轴上放每天的喂奶量 / 次数和体重点，只列记录到的数字。
 *
 * 百分位（第 119 次红线，第 284 次用户确认放开）：只说「参考范围内 / 高于参考范围 / 低于参考范围」和 P50 参考值，
 *   不给宝宝算具体百分位数，不出现任何判定词。参考值内置在 js/growth-std.js（WHO 0–5 岁 L/M/S；WS/T 423—2022 附录 A），
 *   月龄按宝宝生日计算，超出 0–5 岁（中国标准头围超出 0–3 岁）不画参考带、不做对照。
 *
 * 数据形状不变：d.growth = [{ id, date:'yyyy-mm-dd', weightKg, heightCm, headCm }]，新记录多一个可选的 at:'HH:MM'（测量时刻）。
 *   老字段兼容只读：weight / height / length / head（更早的导入数据）。
 */
(function (global) {
  'use strict';
  var Storage = global.Storage, Util = global.Util;
  var Modules = global.Modules = global.Modules || {};

  var MET = {
    height: { k: 'height', field: 'heightCm', alt: ['height', 'length', 'lengthCm'], name: '身高', unit: 'cm', min: 30, max: 160, step: 0.1, dec: 1, def: 50, std: 'h', ctl: 'ruler' },
    weight: { k: 'weight', field: 'weightKg', alt: ['weight', 'kg'], name: '体重', unit: 'kg', min: 1, max: 40, step: 0.01, drag: 0.05, dec: 2, def: 3.5, std: 'w', ctl: 'dial' },
    head: { k: 'head', field: 'headCm', alt: ['head', 'headCirc'], name: '头围', unit: 'cm', min: 20, max: 70, step: 0.1, dec: 1, def: 34, std: 'hc', ctl: 'ruler' }
  };
  var ORDER = ['height', 'weight', 'head'];
  var RANGES = [{ v: '30d', t: '30 天', days: 30 }, { v: '6m', t: '6 月', months: 6 }, { v: '1y', t: '1 年', months: 12 }, { v: 'all', t: '全部' }];
  var STDS = [{ v: 'cn', t: '中国标准' }, { v: 'who', t: 'WHO 标准' }];
  var STATUS = { 'in': '参考范围内', high: '高于参考范围', low: '低于参考范围' };
  var BCLS = { 'in': 'is-in', high: 'is-high', low: 'is-low' };
  var SRC_LINE = '参考值来自 WHO 儿童生长标准 / 国家卫健委 WS/T 423-2022，仅供参考，有疑问请咨询儿科医生';
  var MD = 30.4375; /* 一个月的天数（WHO 口径） */

  function esc(s) { return Util.escapeHtml(s == null ? '' : String(s)); }
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  function validDay(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }
  function validHM(s) { return /^\d{2}:\d{2}$/.test(String(s || '')); }
  function num(v) {
    if (v == null || v === '' || typeof v === 'boolean') return null;
    var n = typeof v === 'number' ? v : Number(String(v).trim());
    return isFinite(n) ? n : null;
  }
  /* 13.00 → 13，90.20 → 90.2 */
  function fmtV(m, v) { return String(Number(Number(v).toFixed(m.dec))); }
  function fmtU(m, v) { return fmtV(m, v) + ' ' + m.unit; }
  function SV() { return (global.FTUI && global.FTUI.SV) || {}; }

  function headOn(d) { return !(d.settings && d.settings.growthHead === false); }
  function metsOf(d) { return ORDER.filter(function (k) { return k !== 'head' || headOn(d); }); }
  function baby(d) { return (d.settings && d.settings.baby) || {}; }
  function sexOf(d) { var s = baby(d).sex; return s === 'boy' || s === 'girl' ? s : null; }
  function birthOf(d) { var b = baby(d).birthDate; return validDay(b) ? b : null; }

  /* 读一条记录的某项（老字段兼容） */
  function valOf(r, m) {
    if (!r) return null;
    var v = num(r[m.field]);
    if (v == null) for (var i = 0; i < m.alt.length && v == null; i++) v = num(r[m.alt[i]]);
    return v != null && v > 0 ? v : null;
  }
  function tOf(r) { return new Date(r.date + 'T' + (validHM(r.at) ? r.at : '12:00') + ':00').getTime(); }
  function list(d) { if (!Array.isArray(d.growth)) d.growth = []; return d.growth; }
  function recs(d) {
    return list(d).filter(function (r) { return r && validDay(r.date); }).slice()
      .sort(function (a, b) { return tOf(b) - tOf(a) || (b.id > a.id ? 1 : -1); });
  }
  function ageAt(d, ms) {
    var b = birthOf(d);
    if (!b) return null;
    return (ms - new Date(b + 'T00:00:00').getTime()) / 864e5 / MD;
  }
  /* 对照用的月龄：早产且实际月龄 < 24 时按矫正月龄 */
  function refAge(d, ms) {
    var a = ageAt(d, ms);
    if (a == null) return null;
    var bb = baby(d), g = parseInt(bb.birthGestWeeks, 10);
    if (bb.preterm && g >= 22 && g < 40 && a < 24) return Math.max(0, a - (40 - g) * 7 / MD);
    return a;
  }
  function corrected(d) { var bb = baby(d), g = parseInt(bb.birthGestWeeks, 10); return !!(bb.preterm && g >= 22 && g < 40); }

  /* ---------------- 参考值 ---------------- */
  var Z = { 3: -1.880794, 10: -1.281552, 15: -1.036433, 25: -0.67449, 50: 0, 75: 0.67449, 85: 1.036433, 90: 1.281552, 97: 1.880794 };
  function lmsVal(l, z) { return Math.abs(l[0]) < 1e-9 ? l[1] * Math.exp(l[2] * z) : l[1] * Math.pow(1 + l[0] * l[2] * z, 1 / l[0]); }
  /* std: 'who' | 'cn'；返回 { p3, lo, p50, hi, p97, inner } 或 null（没有数据 / 超出月龄范围） */
  function ref(std, sex, k, age) {
    var S = global.GrowthStd, m = MET[k];
    if (!S || !m || (sex !== 'boy' && sex !== 'girl') || age == null || !isFinite(age) || age < 0) return null;
    if (std === 'who') {
      var a = S.who[sex][m.std];
      if (age > a.length - 1) return null;
      var i = Math.min(a.length - 1, Math.floor(age)), f = age - i, j = Math.min(a.length - 1, i + 1);
      var l = [0, 1, 2].map(function (n) { return a[i][n] + (a[j][n] - a[i][n]) * f; });
      return { p3: lmsVal(l, Z[3]), lo: lmsVal(l, Z[15]), p50: lmsVal(l, Z[50]), hi: lmsVal(l, Z[85]), p97: lmsVal(l, Z[97]), inner: 'P15–P85' };
    }
    var c = S.cn, ser = c[sex][m.std], ages = c.ages.slice(0, ser.length);
    if (age > ages[ages.length - 1]) return null;
    var hi = 1;
    while (hi < ages.length - 1 && ages[hi] < age) hi++;
    var lo = hi - 1, t = Math.max(0, Math.min(1, (age - ages[lo]) / (ages[hi] - ages[lo])));
    var v = ser[lo].map(function (x, n) { return x + (ser[hi][n] - x) * t; });
    /* c.pcts = [3, 10, 25, 50, 75, 90, 97] */
    return { p3: v[0], lo: v[2], p50: v[3], hi: v[4], p97: v[6], inner: 'P25–P75' };
  }
  function bandOf(v, r) { return v < r.p3 ? 'low' : v > r.p97 ? 'high' : 'in'; }
  function stdMax(std, k) { return (std === 'cn' && k === 'head') ? 36 : 60; }

  function stdOf(d) { var s = d.settings && d.settings.growthStd; return s === 'who' ? 'who' : 'cn'; }
  function rangeOf(d, key, def) { var s = d.settings && d.settings[key]; return RANGES.some(function (x) { return x.v === s; }) ? s : def; }
  function labelOf(arr, v) { for (var i = 0; i < arr.length; i++) if (arr[i].v === v) return arr[i].t; return ''; }
  function setPref(k, v) { var d = Storage.get(); d.settings[k] = v; Storage.save(); }

  function ageWord(a) {
    if (a == null) return '';
    if (a < 1) return Math.max(0, Math.round(a * MD)) + ' 天';
    return Math.floor(a + 1e-9) + ' 月龄';
  }
  function mdOf(iso) { return +iso.slice(5, 7) + '/' + +iso.slice(8, 10); }

  /* ---------------- 小菜单（筛选下拉、时间轴 … ） ---------------- */
  var menuEl = null;
  function closeMenu() {
    if (!menuEl) return;
    var m = menuEl; menuEl = null;
    if (m.parentNode) m.parentNode.removeChild(m);
    document.removeEventListener('keydown', menuKey, true);
    global.removeEventListener('popstate', closeMenu);
    if (m._anchor) { m._anchor.setAttribute('aria-expanded', 'false'); try { m._anchor.focus({ preventScroll: true }); } catch (e) {} }
  }
  function menuKey(e) { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); closeMenu(); } }
  function popMenu(anchor, items) {
    closeMenu();
    var r = anchor.getBoundingClientRect();
    var wrap = document.createElement('div');
    wrap.className = 'gr-menu-mask';
    wrap.setAttribute('data-accent', 'growth');
    var h = '<div class="gr-menu" role="menu">';
    items.forEach(function (it, i) {
      h += '<button type="button" class="' + (it.danger ? 'is-danger' : '') + '" role="' + (it.on != null ? 'menuitemradio' : 'menuitem') + '"'
        + (it.on != null ? ' aria-checked="' + !!it.on + '"' : '') + ' data-mi="' + i + '">'
        + '<span class="gm-ck" aria-hidden="true">' + (it.on ? icon('check') : '') + '</span><span>' + esc(it.t) + '</span></button>';
    });
    wrap.innerHTML = h + '</div>';
    document.body.appendChild(wrap);
    var menu = wrap.firstChild;
    var mw = Math.max(176, menu.offsetWidth), vw = global.innerWidth || 390, vh = global.innerHeight || 800;
    var left = Math.min(Math.max(12, r.right - mw), vw - mw - 12);
    var top = r.bottom + 8;
    if (top + menu.offsetHeight > vh - 90) top = Math.max(12, r.top - 8 - menu.offsetHeight);
    menu.style.left = left + 'px'; menu.style.top = top + 'px'; menu.style.minWidth = mw + 'px';
    wrap.addEventListener('click', function (e) {
      if (Util.hapEcho && Util.hapEcho(e)) return;
      var b = e.target.closest ? e.target.closest('[data-mi]') : null;
      var it = b ? items[+b.getAttribute('data-mi')] : null;
      closeMenu();
      if (it && it.act) it.act();
    });
    wrap._anchor = anchor; anchor.setAttribute('aria-expanded', 'true');
    menuEl = wrap;
    document.addEventListener('keydown', menuKey, true);
    global.addEventListener('popstate', closeMenu);
    var first = menu.querySelector('[aria-checked="true"]') || menu.querySelector('button');
    try { first.focus({ preventScroll: true }); } catch (e) {}
  }

  /* ---------------- 刻度尺 / 表盘 ---------------- */
  /* host：容器；m：指标；o.get() / o.set(v, fromUser) */
  function makeCtl(host, m, o) {
    var dial = m.ctl === 'dial';
    var step = m.drag || m.step;
    var raw = o.get(), vel = 0, raf = 0, drag = null;
    var PX = 8;            /* 刻度尺：0.1 一格 8px */
    var DEG = 6;           /* 表盘：0.1 一格 6° */
    function clamp(v) { return Math.min(m.max, Math.max(m.min, v)); }
    function snap(v) { return Math.round(clamp(v) / step) * step; }
    function W() { return host.clientWidth || 340; }
    function paint() {
      var v = clamp(raw), w = W(), s = '', t, val, x, i0, i1;
      if (!dial) {
        var H = 112, cx = w / 2, span = cx / (PX * 10) + 0.3;
        i0 = Math.ceil((v - span) * 10); i1 = Math.floor((v + span) * 10);
        for (t = i0; t <= i1; t++) {
          val = t / 10;
          if (val < m.min - 1e-9 || val > m.max + 1e-9) continue;
          x = cx + (val - v) * PX * 10;
          var big = t % 10 === 0, mid = t % 5 === 0, len = big ? 30 : mid ? 22 : 13;
          s += '<line class="' + (big ? 'gt-big' : 'gt') + '" x1="' + x.toFixed(1) + '" y1="10" x2="' + x.toFixed(1) + '" y2="' + (10 + len) + '"/>';
          if (big) s += '<text x="' + x.toFixed(1) + '" y="72" text-anchor="middle">' + (t / 10) + '</text>';
        }
        s += '<line class="gt-needle" x1="' + cx + '" y1="8" x2="' + cx + '" y2="' + (H - 8) + '"/><circle class="gt-dot" cx="' + cx + '" cy="9" r="4.5"/>';
        host.innerHTML = '<svg class="gr-ruler" width="' + w + '" height="' + H + '" viewBox="0 0 ' + w + ' ' + H + '" aria-hidden="true">' + s + '</svg>';
      } else {
        var R = Math.min(w / 2 - 6, 176), cx2 = w / 2, cy = R + 12, Hd = cy + 16, deg;
        var band = 'M' + (cx2 - R + 26) + ' ' + cy + ' A' + (R - 26) + ' ' + (R - 26) + ' 0 0 1 ' + (cx2 + R - 26) + ' ' + cy;
        s += '<path class="gd-band" d="' + band + '" stroke-width="52"/>';
        i0 = Math.ceil((v - 1.6) * 10); i1 = Math.floor((v + 1.6) * 10);
        for (t = i0; t <= i1; t++) {
          val = t / 10;
          if (val < m.min - 1e-9 || val > m.max + 1e-9) continue;
          deg = (val - v) * 10 * DEG;
          if (Math.abs(deg) > 93) continue;
          var a = deg * Math.PI / 180, big2 = t % 10 === 0, mid2 = t % 5 === 0, ln = big2 ? 30 : mid2 ? 24 : 14;
          var r1 = R - 4, r2 = R - 4 - ln, sx = Math.sin(a), cyy = Math.cos(a);
          s += '<line class="' + (big2 ? 'gt-big' : 'gt') + '" x1="' + (cx2 + r1 * sx).toFixed(1) + '" y1="' + (cy - r1 * cyy).toFixed(1) + '" x2="' + (cx2 + r2 * sx).toFixed(1) + '" y2="' + (cy - r2 * cyy).toFixed(1) + '"/>';
          if (big2) { var rt = R - 64; s += '<text x="' + (cx2 + rt * sx).toFixed(1) + '" y="' + (cy - rt * cyy + 4).toFixed(1) + '" text-anchor="middle">' + (t / 10) + '</text>'; }
        }
        s += '<line class="gt-needle" x1="' + cx2 + '" y1="' + (cy - R - 6) + '" x2="' + cx2 + '" y2="' + (cy - R + 46) + '"/><circle class="gt-dot" cx="' + cx2 + '" cy="' + (cy - R + 46) + '" r="5"/>';
        host.innerHTML = '<svg class="gr-dial" width="' + w + '" height="' + Hd + '" viewBox="0 0 ' + w + ' ' + Hd + '" aria-hidden="true">' + s + '</svg>';
        host._c = { cx: cx2, cy: cy };
      }
      host.setAttribute('aria-valuenow', fmtV(m, clamp(raw)));
      host.setAttribute('aria-valuetext', fmtU(m, snap(raw)));
    }
    function emit() { o.set(Number(snap(raw).toFixed(m.dec)), true); }
    function stopAnim() { if (raf) { cancelAnimationFrame(raf); raf = 0; } }
    function angleOf(e) {
      var rc = host.getBoundingClientRect(), c = host._c || { cx: rc.width / 2, cy: rc.height };
      return Math.atan2(e.clientX - rc.left - c.cx, c.cy - (e.clientY - rc.top)) * 180 / Math.PI;
    }
    host.addEventListener('pointerdown', function (e) {
      if (e.button != null && e.button > 0) return;
      stopAnim();
      raw = o.get();
      drag = { x: e.clientX, a: dial ? angleOf(e) : 0, t: performance.now(), moved: false, hist: [] };
      try { host.setPointerCapture(e.pointerId); } catch (eC) {}
      e.preventDefault();
    });
    host.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var dv;
      if (dial) {
        var a = angleOf(e), da = a - drag.a;
        if (da > 180) da -= 360; else if (da < -180) da += 360;
        drag.a = a; dv = -da / DEG / 10;
      } else { dv = -(e.clientX - drag.x) / PX / 10; drag.x = e.clientX; }
      if (!drag.moved && Math.abs(dv) < 1e-6) return;
      drag.moved = true;
      raw = clamp(raw + dv);
      var now = performance.now();
      drag.hist.push([now, raw]);
      while (drag.hist.length > 2 && now - drag.hist[0][0] > 90) drag.hist.shift();
      paint(); emit();
    });
    function end() {
      if (!drag) return;
      var h = drag.hist, moved = drag.moved; drag = null;
      if (!moved) return;
      vel = 0;
      if (h.length >= 2) { var dt = h[h.length - 1][0] - h[0][0]; if (dt > 0) vel = (h[h.length - 1][1] - h[0][1]) / dt; }
      var reduce = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduce || Math.abs(vel) < 0.0008) { raw = snap(raw); paint(); emit(); return; }
      var last = performance.now();
      var tick = function (now) {
        var dt2 = Math.min(40, now - last); last = now;
        raw = clamp(raw + vel * dt2); vel *= Math.exp(-dt2 / 300);
        paint(); emit();
        if (Math.abs(vel) < 0.0002 || raw <= m.min || raw >= m.max) { raf = 0; raw = snap(raw); paint(); emit(); return; }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }
    host.addEventListener('pointerup', end);
    host.addEventListener('pointercancel', end);
    host.addEventListener('keydown', function (e) {
      var k = e.key, dv = 0;
      if (k === 'ArrowRight' || k === 'ArrowUp') dv = step; else if (k === 'ArrowLeft' || k === 'ArrowDown') dv = -step;
      else if (k === 'PageUp') dv = step * 10; else if (k === 'PageDown') dv = -step * 10;
      if (!dv) return;
      e.preventDefault(); stopAnim();
      raw = snap(o.get() + dv); paint(); emit();
    });
    host.setAttribute('role', 'slider'); host.setAttribute('tabindex', '0');
    host.setAttribute('aria-label', m.name + '（' + m.unit + '）'); host.setAttribute('aria-valuemin', m.min); host.setAttribute('aria-valuemax', m.max);
    host.setAttribute('data-nodrag', '');
    paint();
    return { paint: function () { stopAnim(); raw = o.get(); paint(); }, stop: stopAnim };
  }

  /* ---------------- 记录面板（新建 / 修改） ---------------- */
  var openAt = 0;
  function openRec(d, rec) {
    var FT = global.FTUI;
    if (!FT) return;
    if (Date.now() - openAt < 450) return; /* 第 281 次同款：手指连点不开两个 */
    openAt = Date.now();
    closeMenu();
    var editing = !!rec;
    var newId = editing ? rec.id : Util.uid();
    var all = recs(d), mets = metsOf(d);
    var now = Util.nowLocal(), today = now.slice(0, 10);
    var date0 = editing ? rec.date : today, hm0 = editing ? (validHM(rec.at) ? rec.at : '') : now.slice(11, 16);
    var st = {};
    ORDER.forEach(function (k) {
      var m = MET[k], v = editing ? valOf(rec, m) : null, start = v;
      if (start == null) { var last = all.filter(function (r) { return valOf(r, m) != null; })[0]; start = last ? valOf(last, m) : null; }
      if (start == null) { var rf = ref(stdOf(d), sexOf(d), k, refAge(d, Date.now())); start = rf ? rf.p50 : m.def; }
      start = Math.min(m.max, Math.max(m.min, start));
      /* orig：修改时这项原来的值。没动过的项保存时原样留着、不按新范围校验（老数据里可能有范围外的值，第 278 次 #38 口径） */
      st[k] = { v: v != null ? v : Number(start.toFixed(m.dec)), filled: v != null, bad: false, touched: false, orig: v };
    });
    var active = mets.indexOf('weight') >= 0 ? 'weight' : mets[0];
    var birth = birthOf(d);
    var body = FT.whenTiles('gr', '测量时间', date0, hm0 || '--:--', today, birth || '').replace('value="--:--"', 'value=""')
      + '<div class="gr-seg n' + mets.length + '" role="tablist" aria-label="测量项">';
    mets.forEach(function (k) {
      body += '<button type="button" role="tab" data-gm="' + k + '" aria-selected="' + (k === active) + '"><b>' + MET[k].name + '</b><small data-gmv="' + k + '"></small></button>';
    });
    body += '</div><div class="gr-big"><label class="gr-numwrap"><input type="text" id="grNum" class="gr-num" inputmode="decimal" autocomplete="off" enterkeyhint="done"><span class="gr-unit" data-gunit></span></label></div>'
      + '<p class="gr-range" data-grange></p>'
      + '<div class="gr-ctl" id="grCtl"></div>'
      + '<p class="gr-clr-row"><button type="button" class="btn-mini gr-clear" data-gclear hidden>不记这一项</button></p>'
      + (editing ? '<button type="button" class="btn rs-del" data-gdel>删除这条记录</button>' : '')
      + '<div class="rs-savebar"><button type="button" class="btn btn-primary rs-save gr-save" id="grSave">' + '<span>' + (editing ? '保存修改' : '保存') + '</span></button></div>';

    FT.openSheet('growth', editing ? '修改生长记录' : '记录生长', body, function (api) {
      var box = api.box, closed = false, saving = false, ctl = null;
      var panel = box.closest('.modal');
      if (panel) panel.classList.add('gr-sheet');
      api.onClose = (function (prev) { return function () { closed = true; if (ctl) ctl.stop(); if (prev) prev.apply(this, arguments); }; })(api.onClose);
      var inp = box.querySelector('#grNum'), host = box.querySelector('#grCtl');
      if (!hm0) { var ti = box.querySelector('#grTime'); if (ti && ti._paint) ti._paint(); }
      function paintSeg() {
        mets.forEach(function (k) {
          var s = st[k], b = box.querySelector('[data-gm="' + k + '"]');
          var lab = box.querySelector('[data-gmv="' + k + '"]');
          if (lab) lab.textContent = s.filled ? (MET[k].dec === 2 ? Number(s.v).toFixed(2) : fmtV(MET[k], s.v)) + ' ' + MET[k].unit : '未填';
          if (b) { b.setAttribute('aria-selected', String(k === active)); b.classList.toggle('is-on', k === active); b.classList.toggle('is-filled', s.filled); }
        });
        var c = box.querySelector('[data-gclear]');
        if (c) c.hidden = !st[active].filled;
      }
      function showNum() {
        var m = MET[active], s = st[active];
        inp.value = Number(s.v).toFixed(m.dec);
        inp.classList.toggle('is-empty', !s.filled);
        Util.markInvalid(inp, null); s.bad = false;
      }
      function switchTo(k) {
        commitTyped();
        active = k;
        var m = MET[k];
        inp.setAttribute('aria-label', m.name + '（' + m.unit + '）');
        box.querySelector('[data-gunit]').textContent = m.unit;
        box.querySelector('[data-grange]').textContent = m.min + '–' + m.max + m.unit;
        host.className = 'gr-ctl ' + (m.ctl === 'dial' ? 'is-dial' : 'is-ruler');
        if (ctl) ctl.stop();
        host.innerHTML = '';
        host.replaceWith(host = host.cloneNode(false));
        ctl = makeCtl(host, m, {
          get: function () { return st[active].v; },
          set: function (v) { st[active].v = v; st[active].filled = true; st[active].touched = true; showNum(); paintSeg(); }
        });
        showNum(); paintSeg();
      }
      /* 大数字也能直接输入：范围外标红，不改刻度 */
      function readTyped() {
        var m = MET[active], t = String(inp.value).trim().replace(/[,，]/g, '.');
        if (t === '') return { empty: true };
        var n = Number(t);
        if (!isFinite(n) || n < m.min || n > m.max) return { bad: true };
        return { v: Number(n.toFixed(m.dec)) };
      }
      function commitTyped() {
        if (!inp || document.activeElement !== inp) return;
        var r = readTyped();
        if (r.v != null && r.v !== st[active].v) { st[active].v = r.v; st[active].filled = true; st[active].touched = true; }
        st[active].bad = false; Util.markInvalid(inp, null);
      }
      inp.addEventListener('input', function () {
        var r = readTyped(), m = MET[active], s = st[active];
        if (r.empty) { s.bad = false; Util.markInvalid(inp, null); return; }
        if (r.bad) { s.bad = true; inp.classList.add('is-invalid'); inp.setAttribute('aria-invalid', 'true'); return; }
        s.bad = false; Util.markInvalid(inp, null);
        if (r.v !== s.v || !s.filled) { s.v = r.v; s.filled = true; s.touched = true; }
        inp.classList.remove('is-empty');
        if (ctl) ctl.paint();
        paintSeg();
      });
      inp.addEventListener('focus', function () { try { inp.select(); } catch (e) {} });
      inp.addEventListener('blur', function () {
        var s = st[active], r = readTyped(), m = MET[active];
        if (r.bad) { Util.markInvalid(inp, m.name + '填 ' + m.min + '–' + m.max + ' ' + m.unit); return; }
        if (r.empty) { showNum(); return; }
        inp.value = Number(s.v).toFixed(m.dec);
      });
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } });

      box.addEventListener('click', function (e) {
        if (closed || (Util.hapEcho && Util.hapEcho(e))) return;
        var b = e.target.closest ? e.target.closest('button') : null;
        if (!b || !box.contains(b)) return;
        if (b.id === 'grSave' || b.hasAttribute('data-ok')) { save(); return; }
        if (b.hasAttribute('data-gdel')) { closed = true; api.close(); remove(d, rec.id); return; }
        if (b.hasAttribute('data-gclear')) { st[active].filled = false; st[active].touched = true; showNum(); paintSeg(); return; }
        var k = b.getAttribute('data-gm');
        if (k && k !== active) switchTo(k);
      });
      switchTo(active);

      function save() {
        if (saving || closed) return;
        /* 正在输入的大数字先认下来；范围外的拦下 */
        var tr = readTyped();
        if (document.activeElement === inp || st[active].bad) {
          if (tr.bad) { var mm = MET[active]; Util.markInvalid(inp, mm.name + '填 ' + mm.min + '–' + mm.max + ' ' + mm.unit); return; }
          if (tr.v != null && (tr.v !== st[active].v || !st[active].filled)) { st[active].v = tr.v; st[active].filled = true; st[active].touched = true; }
        }
        var when = FT.readWhen(box, 'gr');
        var dv = (box.querySelector('#grDate') || {}).value;
        if (!validDay(dv)) { Util.toast('日期不完整', 'warn'); return; }
        var tv = (box.querySelector('#grTime') || {}).value || '';
        if (isFinite(when) && when > Date.now() + 60000) { Util.toast('这个时间还没到，请检查一下', 'warn'); return; }
        if (dv > Util.todayISO()) { Util.toast('这一天还没到，请检查一下', 'warn'); return; }
        if (birth && dv < birth) { Util.toast('测量日期早于宝宝生日，请检查一下', 'warn'); return; }
        var vals = {}, any = false;
        for (var i = 0; i < mets.length; i++) {
          var k = mets[i], m = MET[k], s = st[k];
          if (!s.filled) { vals[m.field] = null; continue; }
          if (!s.touched && s.orig != null) { vals[m.field] = s.orig; any = true; continue; }
          var v = Number(Number(s.v).toFixed(m.dec));
          if (!isFinite(v) || v < m.min || v > m.max) {
            switchTo(k); Util.markInvalid(inp, m.name + '填 ' + m.min + '–' + m.max + ' ' + m.unit); return;
          }
          vals[m.field] = v; any = true;
        }
        if (!any) { Util.toast('先在刻度上量一项再保存', 'warn'); return; }
        saving = true;
        var arr = list(d), r = null;
        for (var j = 0; j < arr.length; j++) if (arr[j] && arr[j].id === newId) { r = arr[j]; break; }
        var isNew = !r;
        if (isNew) { r = { id: newId }; arr.push(r); }
        r.date = dv;
        if (validHM(String(tv).slice(0, 5))) r.at = String(tv).slice(0, 5); else delete r.at;
        ORDER.forEach(function (k) {
          var m = MET[k];
          if (mets.indexOf(k) < 0) { if (isNew) r[m.field] = null; return; } /* 头围关着：老记录里的头围原样留着 */
          r[m.field] = vals[m.field];
          m.alt.forEach(function (a) { if (a in r) delete r[a]; });
        });
        if (!Storage.save()) { saving = false; return; }
        closed = true; api.close();
        global.App.rerender();
        if (isNew) Util.toast('已记录生长', 'ok', { label: '撤销', onClick: function () {
          var a2 = list(Storage.get());
          for (var q = a2.length - 1; q >= 0; q--) if (a2[q] && a2[q].id === newId) { a2.splice(q, 1); break; }
          Storage.save(); global.App.rerender();
        } });
        else Util.toast('已保存', 'ok');
      }
    });
  }

  function remove(d, id) {
    Util.removeWithUndo(list(d), id, {
      onSave: function () { Storage.save(); },
      onAfter: function () { global.App.rerender(); },
      deletedText: '已删除生长记录'
    });
  }

  /* ---------------- 生长设置（半屏） ---------------- */
  function openSettings() {
    var FT = global.FTUI;
    if (!FT) return;
    closeMenu();
    var d = Storage.get(), bb = baby(d);
    var g = parseInt(bb.birthGestWeeks, 10); if (!(g >= 22 && g <= 39)) g = 36;
    var body = '<p class="gr-set-lead">调整生长记录的测量项。</p>'
      + '<div class="row-switch gr-sw"><label for="grHeadSw"><b>记录头围</b><small>开启后创建、编辑和趋势图表会显示头围。</small></label>'
      + '<input type="checkbox" id="grHeadSw" role="switch"' + (headOn(d) ? ' checked' : '') + '></div>'
      + '<div class="row-switch gr-sw"><label for="grPreSw"><b>早产宝宝按矫正月龄对照</b><small>2 岁以内对照参考范围时，扣掉提前出生的周数。</small></label>'
      + '<input type="checkbox" id="grPreSw" role="switch"' + (bb.preterm ? ' checked' : '') + '></div>'
      + '<label class="rs-tile sk-num gr-gest"' + (bb.preterm ? '' : ' hidden') + '><span class="gr-gest-k">出生孕周</span><input type="number" id="grGest" inputmode="numeric" min="22" max="39" value="' + g + '" aria-label="出生孕周"><span>周</span></label>';
    FT.openSheet('growth', '生长设置', body, function (api) {
      var box = api.box;
      var panel = box.closest('.modal');
      if (panel) panel.classList.add('gr-set');
      box.addEventListener('click', function (e) {
        if (Util.hapEcho && Util.hapEcho(e)) return;
        var b = e.target.closest ? e.target.closest('[data-ok]') : null;
        if (b) api.close();
      });
      function put(patch) {
        var dd = Storage.get();
        dd.settings.baby = Object.assign({}, dd.settings.baby || {}, patch);
        if (Storage.syncBabyFromSettings) Storage.syncBabyFromSettings();
        Storage.save(); global.App.rerender();
      }
      box.querySelector('#grHeadSw').addEventListener('change', function () {
        var dd = Storage.get(); dd.settings.growthHead = this.checked ? true : false; Storage.save(); global.App.rerender();
      });
      box.querySelector('#grPreSw').addEventListener('change', function () {
        box.querySelector('.gr-gest').hidden = !this.checked;
        var gv = parseInt(box.querySelector('#grGest').value, 10);
        put({ preterm: this.checked, birthGestWeeks: gv >= 22 && gv <= 39 ? gv : 36 });
      });
      box.querySelector('#grGest').addEventListener('change', function () {
        var gv = parseInt(this.value, 10);
        if (!(gv >= 22 && gv <= 39)) { Util.markInvalid(this, '孕周填 22–39'); return; }
        Util.markInvalid(this, null);
        put({ birthGestWeeks: gv });
      });
    });
  }

  function openProfile() {
    var d = Storage.get();
    if (Storage.syncBabyFromSettings) Storage.syncBabyFromSettings();
    if (Modules.settings && Modules.settings._babyForm) Modules.settings._babyForm(d.settings.activeBabyId || null);
  }

  /* ---------------- 图表（自绘 SVG） ---------------- */
  function niceStep(span, n) {
    var raw = span / Math.max(1, n), p = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }
  /* o: { t0, t1, pts:[{t,v}], band:[{t,p3,lo,p50,hi,p97}], dec, xt:[{t,lab}], bars:[{t,v}], barsDec, label } */
  function chart(o) {
    var W = 320, H = 186, L = 6, R = 36, T = 10, B = 24;
    var t0 = o.t0, t1 = o.t1 > o.t0 ? o.t1 : o.t0 + 864e5;
    var vs = [];
    (o.pts || []).forEach(function (p) { vs.push(p.v); });
    (o.band || []).forEach(function (b) { vs.push(b.p3, b.p97); });
    var s = '';
    function X(t) { return L + (W - L - R) * (t - t0) / (t1 - t0); }
    if (vs.length) {
      var lo = Math.min.apply(null, vs), hi = Math.max.apply(null, vs);
      if (hi - lo < 1e-6) { lo -= 1; hi += 1; }
      var pad = (hi - lo) * 0.1; lo -= pad; hi += pad;
      var st = niceStep(hi - lo, 4);
      lo = Math.floor(lo / st) * st; hi = Math.ceil(hi / st) * st;
      var Y = function (v) { return T + (H - T - B) * (1 - (v - lo) / (hi - lo)); };
      for (var g = lo; g <= hi + 1e-9; g += st) {
        s += '<line class="gc-grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(g).toFixed(1) + '" y2="' + Y(g).toFixed(1) + '"/>'
          + '<text class="gc-yl" x="' + (W - R + 6) + '" y="' + (Y(g) + 3.5).toFixed(1) + '">' + Number(g.toFixed(2)) + '</text>';
      }
      var bd = o.band || [];
      if (bd.length >= 2) {
        var path = function (ka, kb) {
          return 'M' + bd.map(function (b) { return X(b.t).toFixed(1) + ' ' + Y(b[ka]).toFixed(1); }).join(' L')
            + ' L' + bd.slice().reverse().map(function (b) { return X(b.t).toFixed(1) + ' ' + Y(b[kb]).toFixed(1); }).join(' L') + ' Z';
        };
        s += '<path class="gc-band" d="' + path('p97', 'p3') + '"/><path class="gc-band2" d="' + path('hi', 'lo') + '"/>'
          + '<path class="gc-p50" d="M' + bd.map(function (b) { return X(b.t).toFixed(1) + ' ' + Y(b.p50).toFixed(1); }).join(' L') + '"/>';
      }
      var pts = (o.pts || []).slice().sort(function (a, b) { return a.t - b.t; });
      if (pts.length >= 2) s += '<path class="gc-line" d="M' + pts.map(function (p) { return X(p.t).toFixed(1) + ' ' + Y(p.v).toFixed(1); }).join(' L') + '"/>';
      pts.forEach(function (p, i) {
        s += '<circle class="gc-pt' + (i === pts.length - 1 ? ' is-last' : '') + '" cx="' + X(p.t).toFixed(1) + '" cy="' + Y(p.v).toFixed(1) + '" r="' + (i === pts.length - 1 ? 5 : 3.6) + '"/>';
      });
    }
    (o.bars || []).length && (function () {
      var bars = o.bars, mx = Math.max.apply(null, bars.map(function (b) { return b.v; }).concat([1]));
      var bst = niceStep(mx, 3), top = Math.ceil(mx / bst) * bst;
      var bw = Math.max(2, Math.min(14, (W - L - R) / Math.max(bars.length, 1) * 0.62));
      var Yb = function (v) { return T + (H - T - B) * (1 - v / top); };
      if (!vs.length) {
        for (var g2 = 0; g2 <= top + 1e-9; g2 += bst) s += '<line class="gc-grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + Yb(g2).toFixed(1) + '" y2="' + Yb(g2).toFixed(1) + '"/>';
      }
      var bs = '';
      bars.forEach(function (b) {
        var x = X(b.t), y = Yb(b.v);
        bs += '<rect class="gc-bar" x="' + (x - bw / 2).toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(0, (H - B) - y).toFixed(1) + '" rx="1.5"/>';
      });
      s = bs + s;
      s += '<text class="gc-yl gc-bl" x="' + (L + 2) + '" y="' + (T + 9) + '">' + esc(o.barLabel || '') + ' ' + Number(top.toFixed(0)) + '</text>';
    })();
    (o.xt || []).forEach(function (x) {
      var px = X(x.t);
      if (px < L - 1 || px > W - R + 1) return;
      s += '<text class="gc-xl" x="' + px.toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle">' + esc(x.lab) + '</text>';
    });
    return '<svg class="gr-ch" viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="' + esc(o.label || '') + '">' + s + '</svg>';
  }
  /* x 轴刻度：有生日按月龄（整月），没有按日期 */
  function xTicks(d, t0, t1) {
    var out = [], b = birthOf(d), span = (t1 - t0) / 864e5;
    if (b && span >= 75) {
      var a0 = ageAt(d, t0), a1 = ageAt(d, t1), stp = niceStep(Math.max(1, a1 - a0), 4);
      stp = Math.max(1, Math.round(stp));
      for (var a = Math.ceil(Math.max(0, a0) / stp) * stp; a <= a1 + 1e-9; a += stp) {
        out.push({ t: new Date(b + 'T00:00:00').getTime() + a * MD * 864e5, lab: a + '月龄' });
      }
      if (out.length) return out;
    }
    var n = 4;
    for (var i = 0; i <= n; i++) {
      var t = t0 + (t1 - t0) * i / n, dd = new Date(t);
      out.push({ t: t, lab: (dd.getMonth() + 1) + '/' + dd.getDate() });
    }
    return out;
  }
  function windowOf(d, rg, all) {
    var t1 = Date.now(), t0;
    var R = RANGES.filter(function (x) { return x.v === rg; })[0] || RANGES[1];
    if (R.days) t0 = t1 - R.days * 864e5;
    else if (R.months) t0 = t1 - R.months * MD * 864e5;
    else {
      var first = all.length ? Math.min.apply(null, all.map(tOf)) : t1 - 30 * 864e5;
      var b = birthOf(d); if (b) first = Math.min(first, new Date(b + 'T00:00:00').getTime());
      t0 = Math.min(first, t1 - 30 * 864e5);
    }
    return { t0: t0, t1: t1 };
  }

  /* ---------------- 生长趋势页 ---------------- */
  function renderTrend(view, d) {
    var all = recs(d), mets = metsOf(d), std = stdOf(d), sex = sexOf(d), birth = birthOf(d);
    var rg = rangeOf(d, 'growthRange', '6m');
    var G = Modules.growth;
    if (mets.indexOf(G._metric) < 0) G._metric = 'height';
    var k = G._metric, m = MET[k];
    var win = windowOf(d, rg, all);
    var stdT = labelOf(STDS, std), rgT = labelOf(RANGES, rg);
    var h = '<div class="gr-filt"><span class="gr-filt-k">生长趋势</span>'
      + '<button type="button" class="gr-pill" data-gf="std" aria-haspopup="menu" aria-expanded="false">' + trendIco() + '<span>' + esc(stdT) + '</span>' + (SV().down || '') + '</button>'
      + '<button type="button" class="gr-pill" data-gf="sex" aria-label="性别：' + (sex ? (sex === 'girl' ? '女宝' : '男宝') : '未设置') + '，点按修改宝宝资料">' + icon('baby') + '<span>' + (sex ? (sex === 'girl' ? '女宝' : '男宝') : '未设置') + '</span></button>'
      + '<button type="button" class="gr-pill" data-gf="range" aria-haspopup="menu" aria-expanded="false">' + (SV().cal || '') + '<span>' + esc(rgT) + '</span>' + (SV().down || '') + '</button></div>';
    if (!birth || !sex) {
      h += '<div class="gr-note"><p>' + (!birth && !sex ? '填写宝宝的生日和性别' : !birth ? '填写宝宝的生日' : '设置宝宝的性别') + '后，才能对照参考范围。</p>'
        + '<button type="button" class="btn-mini" data-gprof>去填写宝宝资料</button></div>';
    }
    /* 指标卡 + 曲线 */
    var latest = {}, prev = {};
    ORDER.forEach(function (kk) {
      var hs = all.filter(function (r) { return valOf(r, MET[kk]) != null; });
      latest[kk] = hs[0] || null; prev[kk] = hs[1] || null;
    });
    var lr = latest[k];
    h += '<div class="card gr-tcard"><div class="gr-th"><div><h2>' + m.name + '趋势</h2><p>' + esc(rg === 'all' ? '全部' : '近 ' + rgT) + ' · ' + m.unit + ' · ' + esc(stdT) + '</p></div>'
      + (lr ? '<div class="gr-tv"><b>' + esc(fmtV(m, valOf(lr, m))) + '<small>' + m.unit + '</small></b><span>最新记录</span></div>' : '') + '</div>';
    h += '<div class="gr-mets n' + mets.length + '" role="tablist" aria-label="指标">';
    mets.forEach(function (kk) {
      var mm = MET[kk], a = latest[kk], b = prev[kk], dl = '首次';
      if (a && b) { var df = valOf(a, mm) - valOf(b, mm); dl = (df >= 0 ? '+' : '−') + fmtU(mm, Math.abs(df)); }
      h += '<button type="button" role="tab" data-gmet="' + kk + '" aria-selected="' + (kk === k) + '" class="' + (kk === k ? 'is-on' : '') + '"><b>' + mm.name + '</b>'
        + '<span>' + (a ? esc(fmtU(mm, valOf(a, mm))) : '未记录') + '</span><small>' + (a ? esc(dl) : '—') + '</small></button>';
    });
    h += '</div>';
    var pts = all.filter(function (r) { var t = tOf(r); return valOf(r, m) != null && t >= win.t0 && t <= win.t1 + 864e5; })
      .map(function (r) { return { t: tOf(r), v: valOf(r, m) }; });
    var band = [];
    if (birth && sex) {
      for (var i = 0; i <= 48; i++) {
        var t = win.t0 + (win.t1 - win.t0) * i / 48, rf = ref(std, sex, k, refAge(d, t));
        if (rf) band.push({ t: t, p3: rf.p3, lo: rf.lo, p50: rf.p50, hi: rf.hi, p97: rf.p97 });
      }
    }
    h += '<div class="gr-chbox">' + chart({ t0: win.t0, t1: win.t1, pts: pts, band: band, xt: xTicks(d, win.t0, win.t1), label: m.name + '趋势图' }) + '</div>';
    if (!pts.length) h += '<p class="gr-cap">这段时间没有' + m.name + '记录' + (lr ? '，最近一次在 ' + esc(Util.fmtDate(lr.date)) : '') + '。</p>';
    if (lr) h += '<p class="gr-cap">' + esc(capOf(d, std, sex, k, lr)) + '</p>';
    if (band.length) {
      var anyRf = ref(std, sex, k, refAge(d, win.t1)) || ref(std, sex, k, refAge(d, win.t0));
      h += '<p class="gr-legend"><i class="gr-lg-pt"></i>宝宝的测量值　<i class="gr-lg-p50"></i>P50　<i class="gr-lg-band"></i>P3–P97' + (anyRf ? '（深色 ' + anyRf.inner + '）' : '') + '</p>';
    } else if (birth && sex) {
      h += '<p class="gr-legend">' + esc(stdT) + (std === 'cn' && k === 'head' ? '头围参考值只到 3 岁' : '参考值只到 5 岁') + '，这段时间不画参考带。</p>';
    }
    h += '</div>';
    /* 标准对照 */
    if (birth && sex) {
      var anyRec = mets.map(function (kk) { return latest[kk]; }).filter(Boolean).sort(function (a, b) { return tOf(b) - tOf(a); })[0];
      h += '<div class="card gr-cmp"><div class="gr-th"><div><h2>标准对照</h2><p>' + esc(stdT) + ' · ' + (sex === 'girl' ? '女宝' : '男宝') + ' · P3–P97' + (corrected(d) ? ' · 按矫正月龄' : '') + '</p></div>'
        + (anyRec ? '<span class="gr-cmp-d">' + esc(mdOf(anyRec.date)) + '</span>' : '') + '</div>';
      mets.forEach(function (kk) {
        var mm = MET[kk], r = latest[kk];
        h += '<div class="gr-row" data-grow="' + kk + '">';
        if (!r) { h += '<div class="gr-rh"><div><b>' + mm.name + '</b><small>还没有记录</small></div></div></div>'; return; }
        var v = valOf(r, mm), age = refAge(d, tOf(r)), rf = ref(std, sex, kk, age);
        if (!rf) {
          h += '<div class="gr-rh"><div><b>' + mm.name + '</b><small>' + (age != null && age < 0 ? '测量日期早于生日，不做对照' : '超出' + esc(stdT) + '的月龄范围（0–' + (stdMax(std, kk) / 12) + ' 岁），不做对照') + '</small></div>'
            + '<div class="gr-rv"><b>' + esc(fmtU(mm, v)) + '</b></div></div></div>';
          return;
        }
        var bd = bandOf(v, rf), diff = v - rf.p50;
        var dTxt = Math.abs(diff) < Math.pow(10, -mm.dec) / 2 ? '与 P50 相同' : '比 P50 ' + (diff > 0 ? '高 ' : '低 ') + fmtV(mm, Math.abs(diff)) + ' ' + mm.unit;
        if (kk === 'weight' && Math.abs(diff) >= 0.005) dTxt = '比 P50 ' + (diff > 0 ? '重 ' : '轻 ') + fmtV(mm, Math.abs(diff)) + ' ' + mm.unit;
        if (kk === 'head' && Math.abs(diff) >= 0.05) dTxt = '比 P50 ' + (diff > 0 ? '大 ' : '小 ') + fmtV(mm, Math.abs(diff)) + ' ' + mm.unit;
        var pos = Math.max(0, Math.min(1, (v - rf.p3) / (rf.p97 - rf.p3))), p50pos = (rf.p50 - rf.p3) / (rf.p97 - rf.p3);
        var dateNote = anyRec && r.date !== anyRec.date ? ' · ' + mdOf(r.date) + ' 测' : '';
        h += '<div class="gr-rh"><div><b>' + mm.name + '</b><small>P50 ' + esc(fmtU(mm, rf.p50)) + ' · ' + esc(dTxt) + dateNote + '</small></div>'
          + '<div class="gr-rv ' + BCLS[bd] + '"><b>' + esc(fmtU(mm, v)) + '</b><small data-gst="' + bd + '">' + STATUS[bd] + '</small></div></div>'
          + '<div class="gr-bar" role="img" aria-label="' + esc(mm.name + ' ' + fmtU(mm, v) + '，' + STATUS[bd] + '，P3 ' + fmtU(mm, rf.p3) + '，P50 ' + fmtU(mm, rf.p50) + '，P97 ' + fmtU(mm, rf.p97)) + '">'
          + '<i class="gb-p50" style="left:' + (p50pos * 100).toFixed(1) + '%"></i><i class="gb-pt ' + BCLS[bd] + '" style="left:' + (pos * 100).toFixed(1) + '%"></i></div>'
          + '<div class="gr-bl"><span>' + esc(fmtU(mm, rf.p3)) + '</span><span>P50 ' + esc(fmtU(mm, rf.p50)) + '</span><span>' + esc(fmtU(mm, rf.p97)) + '</span></div></div>';
      });
      h += '<p class="gr-src">' + SRC_LINE + '</p></div>';
    } else {
      h += '<p class="gr-src gr-src-solo">' + SRC_LINE + '</p>';
    }
    view.innerHTML = '<div class="ft-page gr-page gr-trend" data-accent="growth">' + h + '</div>';

    view.querySelector('[data-gf="std"]').addEventListener('click', function () {
      var b = this;
      popMenu(b, STDS.map(function (x) { return { t: x.t, on: x.v === std, act: function () { setPref('growthStd', x.v); global.App.rerender(); } }; }));
    });
    view.querySelector('[data-gf="range"]').addEventListener('click', function () {
      var b = this;
      popMenu(b, RANGES.map(function (x) { return { t: x.t, on: x.v === rg, act: function () { setPref('growthRange', x.v); global.App.rerender(); } }; }));
    });
    view.querySelector('[data-gf="sex"]').addEventListener('click', openProfile);
    var pf = view.querySelector('[data-gprof]');
    if (pf) pf.addEventListener('click', openProfile);
    Array.prototype.forEach.call(view.querySelectorAll('[data-gmet]'), function (b) {
      b.addEventListener('click', function () { Modules.growth._metric = b.getAttribute('data-gmet'); global.App.rerender(); });
    });
  }
  function trendIco() {
    return '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 16.5l5-5 4 3.5 7.5-8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3.5 20.5h17" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" opacity=".5"/></svg>';
  }
  /* 「10/26 · 23 月龄 · 90.2 cm · 参考范围内 · P50 87 cm」 */
  function capOf(d, std, sex, k, r) {
    var m = MET[k], v = valOf(r, m), parts = [mdOf(r.date)];
    var a = ageAt(d, tOf(r));
    if (a != null && a >= 0) parts.push(ageWord(a));
    parts.push(fmtU(m, v));
    var rf = ref(std, sex, k, refAge(d, tOf(r)));
    if (rf) {
      parts.push(STATUS[bandOf(v, rf)]); parts.push('P50 ' + fmtU(m, rf.p50));
      var df = v - rf.p50, W = { height: ['高', '低'], weight: ['重', '轻'], head: ['大', '小'] }[k];
      if (Math.abs(df) >= Math.pow(10, -m.dec) / 2) parts.push('比 P50 ' + (df > 0 ? W[0] : W[1]) + ' ' + fmtU(m, Math.abs(df)));
    }
    return parts.join(' · ');
  }

  /* ---------------- 喂养与体重 ---------------- */
  function renderFeed(view, d) {
    var rg = rangeOf(d, 'growthFeedRange', '30d'), rgT = labelOf(RANGES, rg);
    var all = recs(d), win = windowOf(d, rg, all), DS = Util.dayStartHour(d);
    var fs = (d.feedings || []).filter(function (r) {
      if (!r || !(r.type === 'breast' || r.type === 'bottle' || r.type === 'formula')) return false;
      var t = new Date(r.start).getTime();
      return isFinite(t) && t >= win.t0 && t <= win.t1;
    });
    var days = {};
    fs.forEach(function (r) {
      var k = Util.dayKeyOf(r.start, DS);
      var o = days[k] || (days[k] = { n: 0, ml: 0, min: 0 });
      o.n++;
      if (r.type === 'breast') { var mn = Number(r.durationMin); if (!(mn > 0)) mn = (Number(r.durationL) || 0) + (Number(r.durationR) || 0); if (!(mn > 0) && (r.secL || r.secR)) mn = ((Number(r.secL) || 0) + (Number(r.secR) || 0)) / 60; o.min += mn > 0 ? mn : 0; }
      else { var a = Number(r.amount); o.ml += isFinite(a) && a > 0 ? a : 0; }
    });
    var keys = Object.keys(days).sort(), nd = keys.length;
    var totN = 0, totMl = 0, totMin = 0, mlDays = 0;
    keys.forEach(function (k) { totN += days[k].n; totMl += days[k].ml; totMin += days[k].min; if (days[k].ml > 0) mlDays++; });
    var useMl = totMl > 0;
    var weekly = (win.t1 - win.t0) / 864e5 > 62;
    var bars = [];
    if (weekly) {
      var wk = {};
      keys.forEach(function (k) {
        var t = new Date(k + 'T12:00:00').getTime(), wi = Math.floor((t - win.t0) / (7 * 864e5));
        var o = wk[wi] || (wk[wi] = { s: 0, n: 0 });
        o.s += useMl ? days[k].ml : days[k].n; o.n++;
      });
      Object.keys(wk).forEach(function (wi) { bars.push({ t: win.t0 + (+wi + 0.5) * 7 * 864e5, v: wk[wi].s / wk[wi].n }); });
    } else keys.forEach(function (k) { bars.push({ t: new Date(k + 'T12:00:00').getTime(), v: useMl ? days[k].ml : days[k].n }); });
    var wpts = all.filter(function (r) { var t = tOf(r); return valOf(r, MET.weight) != null && t >= win.t0 && t <= win.t1 + 864e5; })
      .map(function (r) { return { t: tOf(r), v: valOf(r, MET.weight), r: r }; }).sort(function (a, b) { return a.t - b.t; });

    var h = '<div class="gr-filt"><span class="gr-filt-k">喂养与体重</span>'
      + '<button type="button" class="gr-pill" data-gf="frange" aria-haspopup="menu" aria-expanded="false">' + (SV().cal || '') + '<span>' + esc(rgT) + '</span>' + (SV().down || '') + '</button></div>';
    h += '<div class="card gr-tcard gr-fcard"><div class="gr-th"><div><h2>喂养与体重</h2><p>' + (rg === 'all' ? '全部' : '近 ' + esc(rgT)) + ' · '
      + (useMl ? (weekly ? '每周平均每天瓶喂奶量（ml）' : '每天瓶喂奶量（ml）') : (weekly ? '每周平均每天喂奶次数' : '每天喂奶次数')) + ' · 体重（kg）</p></div></div>';
    if (!fs.length && !wpts.length) {
      h += '<p class="gr-cap">这段时间没有喂养和体重记录。</p>';
    } else {
      h += '<div class="gr-chbox">' + chart({ t0: win.t0, t1: win.t1, pts: wpts, bars: bars, barLabel: useMl ? 'ml' : '次', xt: xTicks(d, win.t0, win.t1), label: '喂养量与体重' }) + '</div>'
        + '<p class="gr-legend"><i class="gr-lg-bar"></i>' + (useMl ? '瓶喂奶量（母乳 + 配方）' : '喂奶次数（亲喂 + 瓶喂）') + '　<i class="gr-lg-pt"></i>体重（右侧刻度）</p>';
    }
    h += '</div>';
    /* 数字（只列记下来的） */
    h += '<div class="card gr-fstat"><h2>' + (rg === 'all' ? '全部记录' : '近 ' + esc(rgT)) + '</h2><ul class="kv">';
    if (nd) {
      h += '<li><span>有喂养记录的天数</span><b>' + nd + ' 天</b></li>'
        + '<li><span>每天喂奶（亲喂 + 瓶喂）</span><b>平均 ' + (Math.round(totN / nd * 10) / 10) + ' 次</b></li>';
      if (totMl > 0) h += '<li><span>瓶喂奶量（母乳 + 配方）</span><b>平均每天 ' + Math.round(totMl / mlDays) + ' ml</b></li>';
      if (totMin > 0) h += '<li><span>亲喂时长</span><b>平均每天 ' + Math.round(totMin / nd) + ' 分钟</b></li>';
    } else h += '<li><span>喂养</span><b>这段时间没有记录</b></li>';
    if (wpts.length >= 2) {
      var w0 = wpts[0], w1 = wpts[wpts.length - 1], dkg = w1.v - w0.v, dd = (w1.t - w0.t) / 864e5;
      h += '<li><span>体重</span><b>' + esc(fmtV(MET.weight, w0.v)) + ' → ' + esc(fmtV(MET.weight, w1.v)) + ' kg</b></li>'
        + '<li><span>' + esc(mdOf(w0.r.date)) + ' 到 ' + esc(mdOf(w1.r.date)) + '</span><b>' + (dkg >= 0 ? '+' : '−') + Math.round(Math.abs(dkg) * 1000) + ' g' + (dd >= 7 ? '（平均每周 ' + (dkg >= 0 ? '+' : '−') + Math.round(Math.abs(dkg) * 1000 / dd * 7) + ' g）' : '') + '</b></li>';
    } else if (wpts.length === 1) {
      h += '<li><span>体重（' + esc(mdOf(wpts[0].r.date)) + '）</span><b>' + esc(fmtU(MET.weight, wpts[0].v)) + '</b></li>';
    } else h += '<li><span>体重</span><b>这段时间没有记录</b></li>';
    h += '</ul><p class="gr-src">只统计这段时间里记下的喂养和体重；漏记的那几顿不在平均数里。喂得够不够、长得怎么样，请以儿保医生的评估为准。</p></div>';
    view.innerHTML = '<div class="ft-page gr-page gr-trend gr-feed" data-accent="growth">' + h + '</div>';
    view.querySelector('[data-gf="frange"]').addEventListener('click', function () {
      var b = this;
      popMenu(b, RANGES.map(function (x) { return { t: x.t, on: x.v === rg, act: function () { setPref('growthFeedRange', x.v); global.App.rerender(); } }; }));
    });
  }

  /* ---------------- 首页 ---------------- */
  function renderMain(view, d) {
    var all = recs(d), mets = metsOf(d), FT = global.FTUI;
    var h = '<button type="button" class="gr-gear" data-gset aria-label="生长设置">' + icon('settings') + '</button>';
    if (!all.length) {
      h += '<div class="sk-empty"><img src="assets/hero/growth.webp" alt="" width="220" height="220" decoding="sync"><p>点按底部 + 开始记录</p></div>';
    } else {
      var last = all[0], lk = ['weight', 'height', 'head'].filter(function (k) { return mets.indexOf(k) >= 0 && valOf(last, MET[k]) != null; })[0];
      if (!lk) lk = ['weight', 'height', 'head'].filter(function (k) { return valOf(last, MET[k]) != null; })[0];
      var dAgo = Util.daysBetween(last.date, Util.todayISO());
      var ago = validHM(last.at) ? Util.fmtAgo(tOf(last)) : dAgo <= 0 ? '今天' : dAgo === 1 ? '昨天' : dAgo < 30 ? dAgo + ' 天前' : Util.fmtDate(last.date);
      var sum = '最近一次<b>' + MET[lk].name + '</b>为 <b>' + esc(fmtU(MET[lk], valOf(last, MET[lk]))) + '</b>。 <span class="gr-ago">上次：<b>' + esc(ago) + '</b></span>';
      h += '<div class="mod-sum"><span class="ms-k">摘要</span><p>' + sum + '</p></div>';
      h += '<div class="ft-ins gr-ins"><p class="ms-k ft-k">洞察</p><div class="ft-chips">'
        + '<button type="button" class="ft-chip" data-gsub="trend">' + icon('growth') + '<span>生长趋势</span></button>'
        + '<button type="button" class="ft-chip" data-gsub="feed">' + icon('growth') + '<span>喂养与体重</span></button></div></div>';
      var today = Util.todayISO();
      h += '<section class="mod-tl ft-tl gr-tl"><p class="ms-k">生长记录</p><ul class="tl">';
      all.slice(0, 60).forEach(function (r) {
        var parts = [];
        mets.forEach(function (k) { var v = valOf(r, MET[k]); if (v != null) parts.push(MET[k].name + ' ' + fmtU(MET[k], v)); });
        var lab = r.date === today ? '今天' : r.date === Util.addDays(today, -1) ? '昨天' : (r.date.slice(0, 4) === today.slice(0, 4) ? '' : r.date.slice(2, 4) + '/') + mdOf(r.date);
        h += '<li class="tl-row"><span class="tl-time ft-tlt"><small>' + esc(lab) + '</small>' + (validHM(r.at) ? r.at : '') + '</span><span class="tl-dot" aria-hidden="true"></span>'
          + '<button type="button" class="tl-card" data-gopen="' + esc(r.id) + '" aria-label="' + esc(Util.fmtDate(r.date) + ' 生长记录：' + (parts.join('，') || '无数值')) + '，点按修改">'
          + '<span class="tl-ico">' + icon('growth') + '</span><span class="tl-txt"><b>生长记录</b>'
          + (parts.length ? '<small>' + parts.map(function (x) { return '<span class="gr-it">' + esc(x) + '</span>'; }).join(' · ') + '</small>' : '') + '</span>'
          + '<span class="tl-more gr-more" data-gmore aria-hidden="true">' + ((FT && FT.SV && FT.SV.more) || '') + '</span></button>'
          + '<button type="button" class="tl-del" data-del="' + esc(r.id) + '" aria-label="删除" title="删除">' + icon('trash') + '</button></li>';
      });
      h += '</ul></section>';
      h += '<p class="hint med-note">生长数据仅作日常记录参考，不构成医疗建议；发育评估请以儿保体检医生的意见为准。</p>';
    }
    h += '<div class="mod-cta"><button type="button" class="mc-main" data-gnew>' + icon('plus') + '<span>记录生长</span></button></div>';
    view.innerHTML = '<div class="ft-page gr-page" data-accent="growth">' + h + '</div>';

    view.querySelector('[data-gnew]').addEventListener('click', function () { openRec(Storage.get(), null); });
    view.querySelector('[data-gset]').addEventListener('click', openSettings);
    Array.prototype.forEach.call(view.querySelectorAll('[data-gsub]'), function (b) {
      b.addEventListener('click', function () { enterSub(b.getAttribute('data-gsub')); });
    });
    Array.prototype.forEach.call(view.querySelectorAll('[data-gopen]'), function (b) {
      b.addEventListener('click', function (e) {
        var id = b.getAttribute('data-gopen');
        var dd = Storage.get(), it = list(dd).filter(function (x) { return x && x.id === id; })[0];
        if (!it) return;
        if (e.target.closest && e.target.closest('[data-gmore]')) {
          popMenu(b.querySelector('[data-gmore]') || b, [
            { t: '编辑', act: function () { openAt = 0; openRec(Storage.get(), it); } },
            { t: '删除', danger: true, act: function () { remove(Storage.get(), id); } }
          ]);
          return;
        }
        openRec(dd, it);
      });
    });
    Array.prototype.forEach.call(view.querySelectorAll('[data-del]'), function (b) {
      b.addEventListener('click', function () { remove(Storage.get(), b.getAttribute('data-del')); });
    });
  }

  function enterSub(which) {
    var G = Modules.growth;
    closeMenu();
    G._y = global.pageYOffset || 0;
    G._sub = which;
    if (global.App && App.enterSub) App.enterSub(function () {
      G._sub = null; closeMenu();
      global.App.rerender();
      var y = G._y || 0; G._y = 0;
      try { global.scrollTo(0, y); } catch (e) {}
    });
    global.App.rerender();
    try { global.scrollTo(0, 0); } catch (e) {}
  }

  Modules.growth = {
    _makeCtl: makeCtl, /* 第 297 次：宝妈体重的表盘共用 */
    id: 'growth',
    title: '生长',
    subTitle: function () { var s = Modules.growth._sub; return s === 'trend' ? '生长趋势' : s === 'feed' ? '喂养与体重' : null; },
    _sub: null,
    _metric: 'height',
    render: function (view) {
      var d = Storage.get();
      var G = Modules.growth;
      closeMenu();
      if (!(global.App && App.inSub && App.inSub())) G._sub = null;
      if (G._sub === 'trend') renderTrend(view, d);
      else if (G._sub === 'feed') renderFeed(view, d);
      else renderMain(view, d);
      /* 首页「宝宝已出生？」入口：原来展开本页的宝宝信息表单，现在直接打开宝宝资料 */
      if (G._bExpand) { G._bExpand = false; setTimeout(openProfile, 0); }
      if (global.App && App.pendingDate && !G._sub) {
        var pd = App.pendingDate; App.pendingDate = null;
        if (validDay(pd)) setTimeout(function () {
          openRec(Storage.get(), null);
          var di = document.querySelector('#grDate'); if (di) { di.value = pd; if (di._paint) di._paint(); }
        }, 0);
      }
    },
    /* 测试 / 其他模块用 */
    _ref: function (std, sex, k, age) { return ref(std, sex, k, age); },
    _band: function (v, r) { return STATUS[bandOf(v, r)]; },
    _open: function (rec) { openAt = 0; openRec(Storage.get(), rec || null); },
    _remove: function (id) { remove(Storage.get(), id); },
    _settings: openSettings,
    _enter: enterSub,
    _MET: MET
  };
})(window);
