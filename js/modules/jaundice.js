/**
 * jaundice.js - 黄疸记录（第 132 次 · 对标 Cali 21 工具里的 jaundice-tracker；第 252 次迁到新骨架 modskel.js）
 *
 * 定位：新生儿黄疸是「必须交给医生判断」的典型场景，这个页面只做两件事——
 *   1. 把每次测的数值留下来，方便复诊时给医生看趋势；
 *   2. 把「哪些情况要立刻就医」写清楚。
 * **不做的事**：不给阈值判读、不区分生理性/病理性、不建议晒太阳退黄。
 * 经皮测黄仪的读数受部位、肤色、日龄影响，任何「你这数值危险/安全」的结论都不该由本工具下。
 * 数据：d.jaundices = [{ id, time, value, unit, site, note }]，unit ∈ mgdl/umol。
 */
(function (global) {
  'use strict';
  var Storage = global.Storage, Util = global.Util;
  var Modules = global.Modules = global.Modules || {};

  var UNITS = [
    { v: 'mgdl', label: 'mg/dL', max: 30, step: '0.1' },
    { v: 'umol', label: 'µmol/L', max: 500, step: '1' }
  ];
  var SITES = [
    { v: 'forehead', label: '额头' },
    { v: 'cheek', label: '脸颊' },
    { v: 'chest', label: '胸口' }
  ];

  function unitLabel(v) {
    for (var i = 0; i < UNITS.length; i++) if (UNITS[i].v === v) return UNITS[i].label;
    return 'mg/dL';
  }
  function siteLabel(v) {
    for (var i = 0; i < SITES.length; i++) if (SITES[i].v === v) return SITES[i].label;
    return '';
  }

  /* 第 199 次：黄疸趋势。只画与最近一次同单位的记录（mg/dL 与 µmol/L 不混画），
     横轴按时间，端点标出生第几天（有生日时）；不画任何分区/光疗线（刻意不做黄疸分区，见 Cali 对标结论）。
     与体温图共用 .temp-chart 的线/点/网格样式。 */
  function jaChart(recs, unit, birthDate) {
    var pts = recs.filter(function (r) { return r.unit === unit && typeof r.value === 'number' && isFinite(r.value) && !isNaN(new Date(r.time).getTime()); })
      .map(function (r) { return { t: new Date(r.time).getTime(), v: r.value, time: String(r.time) }; })
      .sort(function (a, b) { return a.t - b.t; }).slice(-14);
    if (pts.length < 2) return '';
    var W = 320, H = 140, L = 34, R = 12, T = 12, B = 24;
    var t0 = pts[0].t, t1 = pts[pts.length - 1].t; if (t1 === t0) t1 = t0 + 3600000;
    var vs = pts.map(function (p) { return p.v; });
    var step = unit === 'umol' ? 50 : 3;
    var lo = Math.max(0, Math.floor(Math.min.apply(null, vs) / step) * step - step);
    var hi = Math.ceil(Math.max.apply(null, vs) / step) * step + step;
    function X(t) { return L + (W - L - R) * (t - t0) / (t1 - t0); }
    function Y(v) { return T + (H - T - B) * (hi - v) / (hi - lo); }
    var h = '<svg class="temp-chart ja-chart" viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="黄疸数值变化">';
    for (var g = lo; g <= hi; g += step) {
      h += '<line class="tc-grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(g).toFixed(1) + '" y2="' + Y(g).toFixed(1) + '"></line>'
        + '<text class="tc-ax" x="' + (L - 4) + '" y="' + (Y(g) + 3).toFixed(1) + '" text-anchor="end">' + g + '</text>';
    }
    function lab(p) {
      if (birthDate) {
        var dd = Util.daysBetween(birthDate, p.time.slice(0, 10));
        if (isFinite(dd) && dd >= 0) return '第 ' + (dd + 1) + ' 天';
      }
      return p.time.slice(5, 10).replace('-', '/');
    }
    h += '<text class="tc-ax" x="' + L + '" y="' + (H - 6) + '" text-anchor="start">' + lab(pts[0]) + '</text>'
      + '<text class="tc-ax" x="' + (W - R) + '" y="' + (H - 6) + '" text-anchor="end">' + lab(pts[pts.length - 1]) + '</text>';
    h += '<path class="tc-line" d="' + pts.map(function (p, i) { return (i ? 'L' : 'M') + X(p.t).toFixed(1) + ' ' + Y(p.v).toFixed(1); }).join(' ') + '"></path>';
    pts.forEach(function (p) { h += '<circle class="tc-dot" cx="' + X(p.t).toFixed(1) + '" cy="' + Y(p.v).toFixed(1) + '" r="3"></circle>'; });
    return h + '</svg>';
  }

  function okV(v) { return typeof v === 'number' && isFinite(v); }

  Modules.jaundice = {
    id: 'jaundice',
    title: '黄疸',
    render: function (view) {
      var d = Storage.get();
      var bd = (Storage.activeBaby && Storage.activeBaby() && Storage.activeBaby().birthDate) || (d.settings && d.settings.baby && d.settings.baby.birthDate) || null;
      global.ModSkel.render(view, {
        id: 'jaundice', accent: 'jaundice', noun: '黄疸', listKey: 'jaundices', icon: 'jaundice', bars: null,
        ref: '<b>黄疸要由医生评估，这里只帮你留记录。</b>出生 24 小时内就黄、黄到手心脚心、精神差或吃奶明显变少、哭声尖、大便发白、体温异常，请立即就医。',
        summary: function (c) {
          var all = c.all.filter(function (r) { return okV(r.value); });
          if (!all.length) return '还没有<b>黄疸</b>测量记录。复诊时把每次数值给医生看，比只记「黄不黄」有用得多。';
          var last = all[0], prev = all[1];
          var s = '最近一次是<b>' + Util.escapeHtml(c.ago(last.time)) + '</b>，<b>' + last.value + ' ' + unitLabel(last.unit) + '</b>';
          if (prev && prev.unit === last.unit) {
            var diff = Math.round((last.value - prev.value) * 10) / 10;
            s += '，较上次 <b>' + (diff > 0 ? '+' : '') + diff + '</b>';
          }
          return s + '。';
        },
        dash: function (c) {
          var last = c.all.filter(function (r) { return okV(r.value); })[0];
          if (!last) return '';
          var ch = jaChart(c.all, last.unit, bd);
          if (!ch) return '';
          return '<div class="card dash-card"><h2>数值变化</h2>' + ch + '<p class="hint">数值高低本身不能说明问题——要不要处理，请拿这份记录问医生。</p></div>';
        },
        fields: [
          { k: 'value', t: 'num', label: '数值', unit: '', min: 0, max: 500, step: 0.1, ph: '如 12.5', optional: false },
          { k: 'unit', t: 'seg', label: '单位', opts: UNITS.map(function (u) { return { v: u.v, label: u.label }; }), def: 'mgdl' },
          { k: 'site', t: 'seg', label: '测量部位', opts: SITES, def: 'forehead' }
        ],
        validate: function (v) {
          var max = v.unit === 'umol' ? 500 : 30;
          return (v.value < 0 || v.value > max) ? '数值填 0–' + max + '（单位 ' + unitLabel(v.unit) + '）' : null;
        },
        sheetHint: '1 mg/dL ≈ 17.1 µmol/L。按报告上的单位填，本工具不做换算后的判读。',
        notePh: '如 社区医院测的 / 出生第 5 天',
        title: function (r) { return okV(r.value) ? r.value + ' ' + unitLabel(r.unit) : '黄疸'; },
        sub: function (r) { return [siteLabel(r.site), r.note || ''].filter(Boolean).join(' · '); },
        foot: '黄疸记录仅供参考；是否需光疗、何时复查，一律以医生判断为准。',
        empty: '测一次就记一次，点下方「记录黄疸」。'
      });
    }
  };
})(window);
