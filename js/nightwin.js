/* ============================================================
 * nightwin.js · 第 330 次：夜里的窗（凌晨三点的妈妈 · 第一批）
 *
 * 22:00–05:00，亲喂 / 睡眠的全屏计时背景换成「窗外此刻真实的夜空」：
 *   · 真实月相与月亮的方位 / 高度（低精度星历，误差约 1°，肉眼够用）；
 *   · 60 颗亮星 + 一批暗星，按当地恒星时转动；几组好认的星座连线淡淡画出；
 *   · 天气缓存里有当前天气就跟着变：多云星星变淡、阴雨只剩一团朦胧月光；
 *   · 全部本机计算，不联网、不要定位权限：位置优先用天气功能缓存的经纬度，
 *     没有就按时区估经度（东八区 → 120°E），纬度取 32°N。
 * 窗口只能「瞥一眼」：没有可点的东西、画面每分钟才重画一次（星星本来就走得这么慢），
 * 妈妈抬头看宝宝、再低头，什么都不会错过。
 *
 * 窗顶一句话（每晚固定一句，不随重画跳）：
 *   · 有生日时，按月龄给「这很正常」的一句（来源见 AGE_LINES 注释），和给妈妈的话隔晚轮换；
 *   · 最近情绪记录多次偏低（且没关掉情绪提示）→ 换成安全网：先找身边的人，再给 12356。
 * 结束喂奶并保存后（夜里）：一层很暗的「去睡吧」，2.6 秒自己淡掉，不挡撤销提示。
 *
 * 设置：settings.nightWindow（默认开，false = 关，回到原来的夜灯插画）。
 * 测试钩子：NightWin._now = 毫秒时间戳（固定「现在」），NightWin._calc 暴露星历计算。
 * ============================================================ */
(function (global) {
  'use strict';
  var RAD = Math.PI / 180;

  /* ---------- 星表：RA（时）、Dec（度）、星等 ---------- */
  var STARS = [
    ['Sirius', 6.752, -16.716, -1.46], ['Canopus', 6.399, -52.696, -0.74], ['Arcturus', 14.261, 19.182, -0.05],
    ['Vega', 18.616, 38.784, 0.03], ['Capella', 5.278, 45.998, 0.08], ['Rigel', 5.242, -8.202, 0.13],
    ['Procyon', 7.655, 5.225, 0.34], ['Betelgeuse', 5.919, 7.407, 0.5], ['Altair', 19.846, 8.868, 0.76],
    ['Aldebaran', 4.599, 16.509, 0.86], ['Antares', 16.490, -26.432, 0.96], ['Spica', 13.420, -11.161, 0.97],
    ['Pollux', 7.755, 28.026, 1.14], ['Fomalhaut', 22.961, -29.622, 1.16], ['Deneb', 20.690, 45.280, 1.25],
    ['Regulus', 10.140, 11.967, 1.35], ['Adhara', 6.977, -28.972, 1.5], ['Castor', 7.577, 31.888, 1.58],
    ['Shaula', 17.560, -37.104, 1.62], ['Bellatrix', 5.419, 6.350, 1.64], ['Elnath', 5.438, 28.608, 1.65],
    ['Alnilam', 5.604, -1.202, 1.69], ['Alnair', 22.137, -46.961, 1.74], ['Alnitak', 5.679, -1.943, 1.74],
    ['Alioth', 12.900, 55.960, 1.77], ['Dubhe', 11.062, 61.751, 1.79], ['Mirfak', 3.405, 49.861, 1.79],
    ['KausAus', 18.403, -34.385, 1.85], ['Alkaid', 13.792, 49.313, 1.86], ['Menkalinan', 5.992, 44.948, 1.9],
    ['Polaris', 2.530, 89.264, 1.98], ['Alphard', 9.460, -8.659, 1.98], ['Hamal', 2.120, 23.462, 2.0],
    ['Nunki', 18.921, -26.297, 2.05], ['Saiph', 5.796, -9.670, 2.06], ['Alpheratz', 0.140, 29.091, 2.06],
    ['Mirach', 1.162, 35.621, 2.07], ['Rasalhague', 17.582, 12.560, 2.08], ['Kochab', 14.845, 74.156, 2.08],
    ['Algieba', 10.333, 19.842, 2.08], ['Algol', 3.136, 40.956, 2.1], ['Almach', 2.065, 42.330, 2.1],
    ['Denebola', 11.818, 14.572, 2.13], ['Mintaka', 5.533, -0.299, 2.23], ['Mizar', 13.399, 54.925, 2.23],
    ['Sadr', 20.370, 40.257, 2.23], ['Alphecca', 15.578, 26.715, 2.23], ['Schedar', 0.675, 56.537, 2.24],
    ['Caph', 0.153, 59.150, 2.28], ['Merak', 11.031, 56.382, 2.37], ['Enif', 21.736, 9.875, 2.38],
    ['Scheat', 23.063, 28.083, 2.42], ['Phecda', 11.897, 53.695, 2.44], ['GammaCas', 0.945, 60.717, 2.47],
    ['Markab', 23.079, 15.205, 2.48], ['Ruchbah', 1.430, 60.235, 2.68], ['Algenib', 0.221, 15.184, 2.83],
    ['Alcyone', 3.791, 24.105, 2.87], ['Albireo', 19.512, 27.960, 3.05], ['Megrez', 12.257, 57.033, 3.31],
    ['Segin', 1.907, 63.670, 3.37]
  ];
  var LINES = [
    ['Betelgeuse', 'Bellatrix'], ['Bellatrix', 'Mintaka'], ['Betelgeuse', 'Alnitak'], ['Mintaka', 'Alnilam'], ['Alnilam', 'Alnitak'],
    ['Mintaka', 'Rigel'], ['Alnitak', 'Saiph'],
    ['Dubhe', 'Merak'], ['Merak', 'Phecda'], ['Phecda', 'Megrez'], ['Megrez', 'Dubhe'], ['Megrez', 'Alioth'], ['Alioth', 'Mizar'], ['Mizar', 'Alkaid'],
    ['Caph', 'Schedar'], ['Schedar', 'GammaCas'], ['GammaCas', 'Ruchbah'], ['Ruchbah', 'Segin'],
    ['Vega', 'Deneb'], ['Deneb', 'Altair'], ['Altair', 'Vega'],
    ['Markab', 'Scheat'], ['Scheat', 'Alpheratz'], ['Alpheratz', 'Algenib'], ['Algenib', 'Markab']
  ];
  var BYNAME = {};
  STARS.forEach(function (s) { BYNAME[s[0]] = s; });
  /* 暗星：固定种子撒在天球上（随恒星时一起转），只做质感 */
  var FAINT = (function () {
    var out = [], seed = 20261031;
    function rnd() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }
    for (var i = 0; i < 220; i++) out.push([rnd() * 24, Math.asin(rnd() * 2 - 1) / RAD, 3.6 + rnd() * 1.9]);
    return out;
  })();

  /* ---------- 星历（低精度） ---------- */
  function jd(ms) { return ms / 86400000 + 2440587.5; }
  function norm(a) { a %= 360; return a < 0 ? a + 360 : a; }
  function sunEcl(d) {
    var L = norm(280.460 + 0.9856474 * d), g = norm(357.528 + 0.9856003 * d) * RAD;
    return norm(L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g));
  }
  function moonEcl(d) {
    var Lm = norm(218.316 + 13.176396 * d), M = norm(134.963 + 13.064993 * d) * RAD;
    var F = norm(93.272 + 13.229350 * d) * RAD, D = norm(297.850 + 12.190749 * d) * RAD;
    var Ms = norm(357.528 + 0.9856003 * d) * RAD;
    var lon = Lm + 6.289 * Math.sin(M) + 1.274 * Math.sin(2 * D - M) + 0.658 * Math.sin(2 * D)
      - 0.186 * Math.sin(Ms) + 0.059 * Math.sin(2 * D - 2 * M) + 0.057 * Math.sin(2 * D - M - Ms)
      + 0.053 * Math.sin(2 * D + M) + 0.046 * Math.sin(2 * D - Ms) + 0.041 * Math.sin(M - Ms) - 0.035 * Math.sin(D) - 0.031 * Math.sin(M + Ms);
    var lat = 5.128 * Math.sin(F) + 0.281 * Math.sin(M + F) + 0.278 * Math.sin(M - F) + 0.173 * Math.sin(2 * D - F);
    return { lon: norm(lon), lat: lat };
  }
  function ecl2eq(lon, lat, d) {
    var e = (23.439 - 0.0000004 * d) * RAD, l = lon * RAD, b = lat * RAD;
    var ra = Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l));
    var dec = Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l));
    return { ra: norm(ra / RAD), dec: dec / RAD };
  }
  /* 赤道 → 地平（东、北、天顶 单位向量） */
  function enu(raDeg, decDeg, lst, latDeg) {
    var H = (lst - raDeg) * RAD, dc = decDeg * RAD, ph = latDeg * RAD;
    return [-Math.cos(dc) * Math.sin(H),
      Math.cos(ph) * Math.sin(dc) - Math.sin(ph) * Math.cos(dc) * Math.cos(H),
      Math.sin(ph) * Math.sin(dc) + Math.cos(ph) * Math.cos(dc) * Math.cos(H)];
  }
  function altAz(v) { return { alt: Math.asin(Math.max(-1, Math.min(1, v[2]))) / RAD, az: norm(Math.atan2(v[0], v[1]) / RAD) }; }

  /* 月亮视差：地心 → 站心，高度约降 0.95°·cos(高度) */
  function topo(h) { h.alt -= 0.95 * Math.cos(h.alt * RAD); return h; }
  var PHASES = ['新月', '娥眉月', '上弦月', '盈凸月', '满月', '亏凸月', '下弦月', '残月'];
  function calc(ms, lat, lon) {
    var d = jd(ms) - 2451545.0;
    var lst = norm(280.46061837 + 360.98564736629 * d + lon);
    var sl = sunEcl(d), mo = moonEcl(d);
    var sEq = ecl2eq(sl, 0, d), mEq = ecl2eq(mo.lon, mo.lat, d);
    var elong = norm(mo.lon - sl);                      /* 0 新月 → 180 满月 → 360 */
    var illum = (1 - Math.cos(elong * RAD)) / 2;
    var idx = Math.floor(((elong + 22.5) % 360) / 45);  /* 8 档 */
    var mv = enu(mEq.ra, mEq.dec, lst, lat), sv = enu(sEq.ra, sEq.dec, lst, lat);
    return { d: d, lst: lst, lat: lat, lon: lon, elong: elong, illum: illum, waxing: elong < 180,
      phase: PHASES[idx], moon: topo(altAz(mv)), sun: altAz(sv), mv: mv, sv: sv };
  }

  /* ---------- 位置：天气缓存的经纬度 > 时区估算 ---------- */
  function where() {
    try {
      var c = JSON.parse(localStorage.getItem('yiya-weather') || 'null');
      if (c && typeof c.lat === 'number' && typeof c.lon === 'number') return { lat: c.lat, lon: c.lon, wx: c.data || null, at: c.at || 0 };
    } catch (e) { /* 落到估算 */ }
    var off = -new Date(now()).getTimezoneOffset();     /* 分钟，东八区 480 */
    var lon = Math.max(-180, Math.min(180, off / 4));
    return { lat: (lon > 70 && lon < 140) ? 32 : 38, lon: lon, wx: null, at: 0 };
  }
  /* 天气 → 遮挡：0 晴 … 1 全遮。超过 3 小时的天气不用 */
  function cover(w) {
    if (!w || !w.wx || now() - (w.at || 0) > 3 * 3600000) return 0;
    var c = w.wx.code;
    if (c == null) return 0;
    if (c <= 1) return 0;
    if (c === 2) return 0.45;
    if (c === 3) return 0.85;
    if (c === 45 || c === 48) return 0.8;
    return 0.95;                                         /* 雨、雪、雷 */
  }

  function now() { return NightWin._now || Date.now(); }
  function isNight(ms) { var h = new Date(ms || now()).getHours(); return h >= 22 || h < 5; }
  function enabled() {
    try { var d = global.Storage && Storage.get(); return !(d && d.settings && d.settings.nightWindow === false); } catch (e) { return true; }
  }

  /* ---------- 那一句话 ---------- */
  /* 月龄句（只说「常见」，不下判断）：
     · 一天 8–12 次：美国儿科学会 HealthyChildren.org《How Often and How Much Should Your Baby Eat?》（2024-04-02 更新）——
       母乳新生儿 24 小时 10–12 次是常态，瓶喂至少 8 次；同文「宝宝的胃只有鸡蛋大」。
     · 6 / 12 月龄：Pennestri 等，Pediatrics 2018;142(6):e20174330（n=388）——6 月龄 37.6% 睡不满连续 6 小时，
       12 月龄 43.4% 睡不满连续 8 小时，且与发育、妈妈情绪无关联。
     · 吃得特别勤的几天、四个月前后夜醒变多：只用「常有 / 不少宝宝」这种松口径。 */
  var AGE_LINES = [
    [0, 30, '新生儿一天吃 8 到 12 次很常见，夜里也一样。'],
    [0, 90, '宝宝的胃只有鸡蛋那么大，所以才要一次一次地吃。'],
    [7, 120, '有几天突然吃得特别勤，是常有的事，一般几天就过去。'],
    [100, 170, '四个月前后，不少宝宝夜醒会多一阵子，不是你哪里做错了。'],
    [170, 360, '六个月大时，近四成宝宝还睡不满连续 6 小时。夜里醒，很常见。'],
    [360, 730, '一岁时，仍有四成多的宝宝睡不满连续 8 小时。']
  ];
  var MOM_LINES = [
    '今晚做到这里，已经够了。',
    '想念以前的自己，不代表你不爱宝宝。',
    '喂奶时发会儿呆，也是在休息。',
    '累了就是累了，不需要理由。',
    '你也是第一次当妈妈。',
    '外面很安静，你也可以慢一点。'
  ];
  function nightKey(ms) {
    var t = new Date(ms); if (t.getHours() < 12) t = new Date(ms - 864e5);
    return t.getFullYear() * 10000 + (t.getMonth() + 1) * 100 + t.getDate();
  }
  function hash(n) { n = (n ^ 61) ^ (n >>> 16); n = n + (n << 3); n = n ^ (n >>> 4); n = Math.imul(n, 0x27d4eb2d); return (n ^ (n >>> 15)) >>> 0; }
  function ageDays(d, ms) {
    var bd = d && d.settings && d.settings.baby && d.settings.baby.birthDate;
    if (!bd || !/^\d{4}-\d{2}-\d{2}$/.test(bd)) return null;
    var p = bd.split('-'), b = new Date(+p[0], +p[1] - 1, +p[2]).getTime();
    var a = Math.floor((ms - b) / 864e5);
    return a >= 0 ? a : null;
  }
  function babyName(d) {
    try {
      var b = (d.babies || []).filter(function (x) { return x.id === d.settings.activeBabyId; })[0];
      var n = (Storage.babyLabel && b) ? Storage.babyLabel(b) : (d.settings.baby && (d.settings.baby.nickname || d.settings.baby.name));
      return n ? String(n).slice(0, 12) : '宝宝';
    } catch (e) { return '宝宝'; }
  }
  /* 情绪偏低：最近 7 天里 ≥3 次记在低两档，或最近 5 次全在低两档；用户关掉过情绪提示就不出 */
  function lowMood(d, ms) {
    if (!d || (d.settings && d.settings.moodHintDismissed === true)) return false;
    var ms7 = ms - 7 * 864e5, list = (d.moods || []).filter(function (r) { return r && r.time && (r.level | 0) >= 1; })
      .sort(function (a, b) { return new Date(b.time) - new Date(a.time); });
    var recent = list.filter(function (r) { return new Date(r.time).getTime() >= ms7 && r.level <= 2; }).length;
    var last5 = list.length >= 5 && list.slice(0, 5).every(function (r) { return r.level <= 2; });
    return recent >= 3 || last5;
  }
  function line(ms, c) {
    var d = null; try { d = global.Storage && Storage.get(); } catch (e) {}
    if (d && lowMood(d, ms)) return { care: true, text: '撑不住的时候，先叫醒身边的人。想找人说说话，也可以拨 12356 心理援助热线。' };
    var k = nightKey(ms), h = hash(k);
    var a = d ? ageDays(d, ms) : null;
    var ages = a == null ? [] : AGE_LINES.filter(function (x) { return a >= x[0] && a < x[1]; }).map(function (x) { return x[2]; });
    var pool = MOM_LINES.slice();
    if (c && c.moon.alt > 3) pool.push('抬头看看月亮，再低头看看' + esc(d ? babyName(d) : '宝宝') + '。');
    if (ages.length && h % 2 === 0) return { text: ages[(h >>> 1) % ages.length] };
    return { text: pool[(h >>> 1) % pool.length] };
  }
  function esc(s) { return global.Util ? Util.escapeHtml(s) : String(s).replace(/[&<>"']/g, ''); }
  function moonLine(c) {
    var dir = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'][Math.round(c.moon.az / 45) % 8];
    if (c.moon.alt > 0) return '今晚是' + c.phase + '，在' + dir + '边的天上';
    return '今晚是' + c.phase + '，' + (c.moon.az < 180 ? '月亮还没升起来' : '月亮已经落下了');
  }

  /* ---------- 画 ---------- */
  function draw(cv, c, w) {
    var dpr = Math.min(2, global.devicePixelRatio || 1);
    var W = cv.clientWidth || cv.parentNode.clientWidth || 390, H = cv.clientHeight || cv.parentNode.clientHeight || 844;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    var g = cv.getContext('2d'); if (!g) return null;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    var cov = cover(w);
    /* 朝向：月亮在天上就朝着月亮，否则朝南（南半球朝北） */
    var up = c.moon.alt > -1;
    var A0 = up ? c.moon.az : bestAz(c);
    var c0 = up ? Math.max(22, Math.min(60, c.moon.alt - 16)) : 32;
    var fov = 82, sc = (W / 2) / Math.tan(fov / 2 * RAD), cy = H * 0.30;
    var a = A0 * RAD, e = c0 * RAD;
    var F = [Math.sin(a) * Math.cos(e), Math.cos(a) * Math.cos(e), Math.sin(e)];
    var R = [Math.cos(a), -Math.sin(a), 0];
    var U = [-Math.sin(a) * Math.sin(e), -Math.cos(a) * Math.sin(e), Math.cos(e)];
    function proj(v) {
      var z = v[0] * F[0] + v[1] * F[1] + v[2] * F[2];
      if (z < 0.12) return null;
      return [W / 2 + (v[0] * R[0] + v[1] * R[1] + v[2] * R[2]) / z * sc, cy - (v[0] * U[0] + v[1] * U[1] + v[2] * U[2]) / z * sc];
    }
    /* 地平线的屏幕高度（视线正前方） */
    var hz = proj([Math.sin(a), Math.cos(a), 0]); var hy = hz ? hz[1] : H * 0.5;
    /* 天色：太阳越接近地平线越透一点蓝（5 点前后的晨昏蒙影） */
    var tw = Math.max(0, Math.min(1, (c.sun.alt + 18) / 14));
    var sky = g.createLinearGradient(0, 0, 0, hy);
    sky.addColorStop(0, mix('#070A1C', '#14213F', tw));
    sky.addColorStop(0.7, mix('#0E1430', '#2A3560', tw));
    sky.addColorStop(1, mix('#231C38', '#4A4A70', tw));
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    /* 地平线附近一层暖色城市光 */
    var glow = g.createLinearGradient(0, hy - H * 0.16, 0, hy + 8);
    glow.addColorStop(0, 'rgba(120,80,90,0)'); glow.addColorStop(1, 'rgba(150,96,92,' + (0.22 + 0.1 * cov) + ')');
    g.fillStyle = glow; g.fillRect(0, hy - H * 0.16, W, H * 0.16 + 8);

    var starA = (1 - cov) * (1 - 0.85 * tw), shown = 0;
    if (starA > 0.02) {
      /* 暗星 */
      FAINT.forEach(function (s) {
        var v = enu(s[0] * 15, s[1], c.lst, c.lat); if (v[2] < 0.02) return;
        var p = proj(v); if (!p || p[0] < -4 || p[0] > W + 4 || p[1] < -4 || p[1] > hy) return;
        var al = starA * Math.max(0, 0.55 - (s[2] - 3.6) * 0.22) * Math.min(1, v[2] * 6);
        if (al < 0.03) return;
        g.fillStyle = 'rgba(225,230,255,' + al.toFixed(3) + ')';
        g.fillRect(p[0], p[1], 1, 1);
      });
      /* 星座连线（很淡） */
      var pos = {};
      STARS.forEach(function (s) { var v = enu(s[1] * 15, s[2], c.lst, c.lat); pos[s[0]] = v[2] > 0 ? proj(v) : null; });
      g.strokeStyle = 'rgba(200,210,255,' + (0.13 * starA).toFixed(3) + ')'; g.lineWidth = 0.7;
      g.beginPath();
      LINES.forEach(function (l) {
        var p1 = pos[l[0]], p2 = pos[l[1]]; if (!p1 || !p2) return;
        if (Math.abs(p1[0] - p2[0]) > W * 0.6) return;
        g.moveTo(p1[0], p1[1]); g.lineTo(p2[0], p2[1]);
      });
      g.stroke();
      /* 亮星 */
      STARS.forEach(function (s) {
        var p = pos[s[0]]; if (!p || p[0] < -6 || p[0] > W + 6 || p[1] < -6 || p[1] > hy - 1) return;
        var v = enu(s[1] * 15, s[2], c.lst, c.lat);
        var ext = Math.min(1, 0.35 + v[2] * 3);            /* 低空大气消光 */
        var r = Math.max(0.6, 2.1 - 0.42 * s[3]), al = starA * ext * Math.min(1, 1.15 - s[3] * 0.18);
        if (al < 0.04) return;
        shown++;
        if (s[3] < 1.2) {
          var hg = g.createRadialGradient(p[0], p[1], 0, p[0], p[1], r * 4);
          hg.addColorStop(0, 'rgba(230,235,255,' + (al * 0.35).toFixed(3) + ')'); hg.addColorStop(1, 'rgba(230,235,255,0)');
          g.fillStyle = hg; g.beginPath(); g.arc(p[0], p[1], r * 4, 0, 7); g.fill();
        }
        g.fillStyle = 'rgba(240,242,255,' + al.toFixed(3) + ')';
        g.beginPath(); g.arc(p[0], p[1], r, 0, 7); g.fill();
      });
    }
    /* 月亮 */
    var mp = c.moon.alt > -1 ? proj(c.mv) : null, moonBox = null;
    if (mp && c.illum > 0.015) {
      var mr = Math.max(15, Math.min(24, W * 0.052));
      /* 亮边朝太阳：在天球上从月亮往太阳挪一点，投到屏幕上取方向 */
      var tv = [c.mv[0] + (c.sv[0] - c.mv[0]) * 0.02, c.mv[1] + (c.sv[1] - c.mv[1]) * 0.02, c.mv[2] + (c.sv[2] - c.mv[2]) * 0.02];
      var tp = proj(tv), ang = tp ? Math.atan2(tp[1] - mp[1], tp[0] - mp[0]) : 0;
      var ma = 1 - cov * 0.55;
      var halo = g.createRadialGradient(mp[0], mp[1], mr * 0.6, mp[0], mp[1], mr * (4 + 3 * cov));
      halo.addColorStop(0, 'rgba(255,236,200,' + (0.16 + 0.22 * c.illum * ma).toFixed(3) + ')'); halo.addColorStop(1, 'rgba(255,236,200,0)');
      g.fillStyle = halo; g.beginPath(); g.arc(mp[0], mp[1], mr * (4 + 3 * cov), 0, 7); g.fill();
      g.save(); g.translate(mp[0], mp[1]); g.rotate(ang);
      g.fillStyle = 'rgba(255,240,215,' + (0.045 * ma).toFixed(3) + ')';      /* 地照：暗面淡淡一圈 */
      g.beginPath(); g.arc(0, 0, mr, 0, 7); g.fill();
      /* 亮面：亮侧半圆（朝 +x，太阳方向） + 明暗界线椭圆 */
      var k = Math.cos(c.elong * RAD);                                  /* 1 新月 … -1 满月 */
      g.fillStyle = 'rgba(255,244,222,' + ma.toFixed(3) + ')';
      g.beginPath();
      g.arc(0, 0, mr, -Math.PI / 2, Math.PI / 2, false);
      g.ellipse(0, 0, Math.abs(k) * mr, mr, 0, Math.PI / 2, -Math.PI / 2, k > 0);
      g.closePath(); g.fill();
      g.restore();
      if (cov > 0.6) { g.fillStyle = 'rgba(40,40,60,' + ((cov - 0.6) * 0.9).toFixed(3) + ')'; g.beginPath(); g.arc(mp[0], mp[1], mr + 1, 0, 7); g.fill(); }
      moonBox = { x: mp[0], y: mp[1], r: mr, ang: ang };
    }
    /* 云：多云 / 阴天时几团慢慢糊开的暗云（静态，不动） */
    if (cov > 0.3) {
      var seed = nightKey(now());
      for (var i = 0; i < 5; i++) {
        var x = ((hash(seed + i * 7) % 1000) / 1000) * W, y = hy * (0.15 + ((hash(seed + i * 13) % 1000) / 1000) * 0.7);
        var rr = W * (0.25 + ((hash(seed + i) % 100) / 100) * 0.25);
        var cg = g.createRadialGradient(x, y, 0, x, y, rr);
        cg.addColorStop(0, 'rgba(70,66,92,' + (0.35 * cov).toFixed(3) + ')'); cg.addColorStop(1, 'rgba(70,66,92,0)');
        g.fillStyle = cg; g.beginPath(); g.arc(x, y, rr, 0, 7); g.fill();
      }
    }
    var lit = skyline(g, W, H, hy);
    return { horizon: hy, stars: shown, moon: moonBox, cover: cov, A0: A0, c0: c0, windows: lit };
  }
  /* 月亮不在天上：朝亮星最多的那一边（每 30° 试一次，按亮度加权） */
  function bestAz(c) {
    var best = c.lat >= 0 ? 180 : 0, bs = -1;
    for (var az = 0; az < 360; az += 30) {
      var sc = 0;
      STARS.forEach(function (s) {
        var h = altAz(enu(s[1] * 15, s[2], c.lst, c.lat));
        if (h.alt < 8 || h.alt > 70) return;
        var dz = Math.abs(((h.az - az + 540) % 360) - 180);
        if (dz < 40) sc += Math.pow(10, -0.4 * s[3]);
      });
      if (sc > bs + 0.05) { bs = sc; best = az; }
    }
    return best;
  }
  /* 远处一排低矮的楼顶剪影，偶尔几扇亮着暖灯的窗——别人家也有人醒着（只是装饰，不是统计） */
  function skyline(g, W, H, hy) {
    var seed = nightKey(now()) * 31, x = -4, lit = 0;
    g.fillStyle = '#0D0912';
    g.beginPath(); g.moveTo(-4, H);
    var tops = [];
    while (x < W + 4) {
      var bw = 9 + (hash(seed + x) % 20), bh = 3 + (hash(seed + x * 3 + 1) % 14);
      if (hash(seed + x * 7) % 5 === 0) bh = 2 + (hash(seed + x) % 4);   /* 空地 / 树 */
      g.lineTo(x, hy - bh); g.lineTo(x + bw, hy - bh);
      tops.push([x, bw, bh]); x += bw;
    }
    g.lineTo(W + 4, H); g.closePath(); g.fill();
    var budget = 2 + (seed % 4);
    for (var i = 0; i < tops.length && lit < budget; i++) {
      var t = tops[i]; if (t[2] < 9 || hash(seed + i * 17) % 3) continue;
      var wx = t[0] + 4 + (hash(seed + i) % Math.max(1, t[1] - 9)), wy = hy - t[2] + 3 + (hash(seed + i * 5) % Math.max(1, t[2] - 7));
      g.fillStyle = 'rgba(255,196,128,.55)'; g.fillRect(Math.round(wx), Math.round(wy), 1.5, 2);
      lit++;
    }
    return lit;
  }
  function mix(a, b, t) {
    var x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16);
    var r = Math.round(((x >> 16) & 255) * (1 - t) + ((y >> 16) & 255) * t);
    var gg = Math.round(((x >> 8) & 255) * (1 - t) + ((y >> 8) & 255) * t);
    var bb = Math.round((x & 255) * (1 - t) + (y & 255) * t);
    return 'rgb(' + r + ',' + gg + ',' + bb + ')';
  }

  /* ---------- 挂到全屏计时上 ---------- */
  var cv = null, cap = null, timer = null, host = null, lastInfo = null;
  function mount(fullEl) {
    if (!fullEl) return false;
    var bg = fullEl.querySelector('.ftf-bg');
    var on = enabled() && isNight() && !fullEl.classList.contains('is-dark') && !!bg;
    if (!on) { unmount(fullEl); return false; }
    if (!cv) { cv = document.createElement('canvas'); cv.className = 'nw-sky'; cv.setAttribute('aria-hidden', 'true'); }
    if (!cap) { cap = document.createElement('div'); cap.className = 'nw-cap'; }
    bg.classList.add('nw-on'); fullEl.classList.add('nw-open');
    if (cv.parentNode !== bg) bg.insertBefore(cv, bg.firstChild);
    if (cap.parentNode !== fullEl) fullEl.appendChild(cap);
    host = fullEl;
    paint();
    if (!timer) timer = setInterval(function () {
      if (!host || !host.isConnected) { stop(); return; }
      if (!isNight()) { unmount(host); return; }
      paint();
    }, 60000);
    return true;
  }
  function paint() {
    if (!cv || !host) return;
    var w = where(), ms = now(), c = calc(ms, w.lat, w.lon);
    lastInfo = draw(cv, c, w);
    var ln = line(ms, c);
    var html = '<p class="nw-moon">' + moonLine(c) + '</p><p class="nw-line' + (ln.care ? ' is-care' : '') + '">' + ln.text + '</p>';
    if (ln.care) html += '<a class="nw-tel" href="tel:12356">拨打 12356</a>';
    if (cap.getAttribute('data-k') !== html) { cap.innerHTML = html; cap.setAttribute('data-k', html); }
    if (lastInfo) { lastInfo.phase = c.phase; lastInfo.line = ln.text; lastInfo.care = !!ln.care; }
  }
  function stop() { if (timer) { clearInterval(timer); timer = null; } host = null; }
  function unmount(fullEl) {
    if (fullEl) {
      var bg = fullEl.querySelector('.ftf-bg'); if (bg) bg.classList.remove('nw-on');
      fullEl.classList.remove('nw-open');
    }
    if (cv && cv.parentNode) cv.parentNode.removeChild(cv);
    if (cap && cap.parentNode) cap.parentNode.removeChild(cap);
    if (!fullEl || fullEl === host) stop();
  }

  /* ---------- 去睡吧 ---------- */
  function goodnight() {
    if (!enabled() || !isNight()) return false;
    var old = document.querySelector('.nw-gn'); if (old) old.parentNode.removeChild(old);
    var el = document.createElement('div');
    el.className = 'nw-gn'; el.setAttribute('role', 'status');
    el.innerHTML = '<span class="nw-gn-moon" aria-hidden="true"></span><p>去睡吧，剩下的天亮再说。</p>';
    document.body.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('is-in'); });
    var hold = (global.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) ? 2000 : 2600;
    setTimeout(function () { el.classList.remove('is-in'); el.classList.add('is-out'); }, hold);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, hold + 900);
    return true;
  }

  var NightWin = global.NightWin = {
    _now: 0,
    _calc: calc,
    _line: line,
    _info: function () { return lastInfo; },
    isNight: isNight,
    enabled: enabled,
    mount: mount,
    unmount: unmount,
    goodnight: goodnight
  };
})(window);
