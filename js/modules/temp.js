/**
 * temp.js - 体温记录（对标 Cali 宝宝补齐，2026-09-27 第 38 次；第 252 次迁到新骨架 modskel.js）
 * 发热期的按需记录：温度 + 时间 + 备注；今日小结给「最新 / 今日最高」，
 * ≥38.5°C 的数值用警示色显示并提示就医边界——不做发热判读、不给用药建议（U-25/U-37）。
 *
 * 第 139 次（P1-4 · 对标 Cali TemperatureObservationEpisode + 部位字段）：
 *   ① 测量部位 site（腋下/耳温/额温/肛温）——不同部位参考值不同，记录它才有回溯意义；
 *      这里只记录部位、提示「部位不同参考值不同」，不解释任何个体的数值含义。
 *   ② 病程（观察期）：把零散测温聚成「本次观察」，按距今 >36h 的分界线切段，
 *      每次记录标记「第 N 天」，今日小结提示「本次观察已第 N 天」。
 *      命名刻意用「观察」而不是「发热」——是不是发热由医生判断，这里只记录事实。
 * 数据：d.temps = [{ id, time, value, note, site }]
 */
(function (global) {
  'use strict';
  var Storage = global.Storage, Util = global.Util;
  var Modules = global.Modules = global.Modules || {};

  var HIGH = 38.5; /* 展示用提示阈值：只变色+提示就医，不做任何判读 */

  /* 第 139 次：测量部位。默认腋下（婴幼儿最常用）。 */
  var SITES = [
    { v: 'axillary',  label: '腋下', hint: '最常用' },
    { v: 'ear',       label: '耳温', hint: '' },
    { v: 'forehead',  label: '额温', hint: '' },
    { v: 'rectal',    label: '肛温', hint: '' }
  ];
  function siteOf(v) {
    for (var i = 0; i < SITES.length; i++) if (SITES[i].v === v) return SITES[i];
    return null;
  }

  /* 第 139 次：病程（观察期）划分。
     规则只有一条：相邻两条记录间隔 >36h → 视为新一轮观察。
     36h 的依据：发热观察通常按天进行（早中晚数次），隔一整天以上再出现，
     基本是另一轮不适，归到同一段里反而误导。
     返回给每条记录的挂件：{ day: N, days: 总天数, active: 是否最近一段, isLast: 段内最后一条 }。
     故意不做「退温算结束」这种判定——那是医疗判断，不是记录软件该有的逻辑。 */
  function episodeMap(list) {
    var asc = list.slice().sort(function (a, b) { return new Date(a.time) - new Date(b.time); });
    var gapMs = 36 * 3600 * 1000;
    var segs = [];       /* 每段 = { start, count, end } */
    var cur = null;
    var prevT = null;
    asc.forEach(function (r) {
      var t = new Date(r.time).getTime();
      if (!isFinite(t)) { prevT = null; return; }   /* 坏时间戳的记录不参与分段 */
      if (!cur || (prevT != null && t - prevT > gapMs)) {
        cur = { start: t, count: 0, end: t };
        segs.push(cur);
      }
      cur.count++; cur.end = t;
      prevT = t;
    });
    /* 找活跃段（含最近一条有效记录的段） */
    var activeIdx = -1;
    var maxT = -Infinity;
    segs.forEach(function (sg, i) { if (sg.end > maxT) { maxT = sg.end; activeIdx = i; } });
    var idxByRecord = {};
    asc.forEach(function (r) {
      var t = new Date(r.time).getTime();
      if (!isFinite(t)) return;
      var seg = null;
      for (var i = 0; i < segs.length; i++) {
        if (t >= segs[i].start - 1 && t <= segs[i].end + 1) { seg = segs[i]; break; }
      }
      if (!seg) return;
      /* 第 N 天按公历日差算：同一天所有记录都是第 1 天 */
      var d0 = new Date(seg.start); d0.setHours(0, 0, 0, 0);
      var dd = new Date(t); dd.setHours(0, 0, 0, 0);
      var day = Math.round((dd.getTime() - d0.getTime()) / 86400000) + 1;
      var spans = Math.round((new Date(seg.end).setHours(0,0,0,0) - d0.getTime()) / 86400000) + 1;
      idxByRecord[r.id] = { day: day, days: spans, active: (segs.indexOf(seg) === activeIdx), count: seg.count };
    });
    return idxByRecord;
  }

  /* 第 186 次：体温趋势（最近 72 小时）+ 用药时刻竖线。
     只画记录，不画「发热线」之外的任何判读；HIGH 虚线与今日小结同一口径。 */
  function tempChart(temps, meds, HIGHV) {
    var now = Date.now(), from = now - 72 * 3600000;
    var pts = temps.filter(function (r) {
      var t = new Date(r.time).getTime();
      return typeof r.value === 'number' && isFinite(r.value) && t >= from && t <= now + 60000;
    }).map(function (r) { return { t: new Date(r.time).getTime(), v: r.value }; })
      .sort(function (a, b) { return a.t - b.t; });
    if (pts.length < 2) return '';
    var t0 = Math.max(from, pts[0].t - 3600000), t1 = now;
    var ms = meds.filter(function (r) { var t = new Date(r.time).getTime(); return t >= t0 && t <= t1; })
      .map(function (r) { return { t: new Date(r.time).getTime(), n: String(r.name || '用药') }; });
    var W = 320, H = 150, L = 30, R = 10, T = 12, B = 24;
    var vmin = Math.min(36, Math.min.apply(null, pts.map(function (p) { return p.v; }))) - 0.2;
    var vmax = Math.max(38.5, Math.max.apply(null, pts.map(function (p) { return p.v; }))) + 0.2;
    function X(t) { return L + (W - L - R) * (t - t0) / Math.max(1, t1 - t0); }
    function Y(v) { return T + (H - T - B) * (vmax - v) / (vmax - vmin); }
    var h = '<svg class="temp-chart" viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="最近 72 小时体温趋势">';
    [36, 37, 38, 39, 40].forEach(function (g) {
      if (g < vmin || g > vmax) return;
      h += '<line class="tc-grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(g).toFixed(1) + '" y2="' + Y(g).toFixed(1) + '"></line>'
        + '<text class="tc-ax" x="' + (L - 4) + '" y="' + (Y(g) + 3).toFixed(1) + '" text-anchor="end">' + g + '</text>';
    });
    if (HIGHV >= vmin && HIGHV <= vmax) h += '<line class="tc-high" x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(HIGHV).toFixed(1) + '" y2="' + Y(HIGHV).toFixed(1) + '"></line>';
    ms.forEach(function (m) {
      var x = X(m.t).toFixed(1);
      h += '<line class="tc-med" x1="' + x + '" x2="' + x + '" y1="' + T + '" y2="' + (H - B) + '"></line>'
        + '<text class="tc-medt" x="' + x + '" y="' + (H - B + 12) + '" text-anchor="middle">' + Util.escapeHtml(m.n.slice(0, 3)) + '</text>';
    });
    h += '<path class="tc-line" d="' + pts.map(function (p, i) { return (i ? 'L' : 'M') + X(p.t).toFixed(1) + ' ' + Y(p.v).toFixed(1); }).join(' ') + '"></path>';
    pts.forEach(function (p) { h += '<circle class="tc-dot" cx="' + X(p.t).toFixed(1) + '" cy="' + Y(p.v).toFixed(1) + '" r="3"></circle>'; });
    h += '</svg>';
    return h;
  }

  function okV(v) { return typeof v === 'number' && isFinite(v); }

  Modules.temp = {
    id: 'temp',
    title: '体温',
    render: function (view) {
      var d = Storage.get();
      var epMap = episodeMap(d.temps || []);   /* id -> { day, days, active, count } */
      global.ModSkel.render(view, {
        id: 'temp', accent: 'temp', noun: '体温', listKey: 'temps', icon: 'temp', bars: null,
        ref: '只帮你记录体温变化，<b>不能替代医疗判断</b>。持续发热、高热不退或伴有其他症状，请及时就医。',
        summary: function (c) {
          var vl = c.today.filter(function (r) { return okV(r.value); });
          var s;
          if (vl.length) {
            var mx = Math.max.apply(null, vl.map(function (r) { return r.value; }));
            s = '今天量了 <b>' + vl.length + ' 次</b>，最近一次 <b>' + vl[0].value + '°C</b>' + (vl.length > 1 ? '，最高 <b>' + mx + '°C</b>' : '') + '。';
            if (mx >= HIGH) s += '有 ≥' + HIGH + '°C 的记录，发热处理请遵医嘱，必要时就医。';
            var ep = epMap[vl[0].id];
            if (ep && ep.active && ep.days > 1) s += '这是本次观察的第 <b>' + ep.day + ' 天</b>。';
          } else if (c.last && okV(c.last.value)) {
            s = '今天还没量。上次是<b>' + Util.escapeHtml(c.ago(c.last.time)) + '</b>，<b>' + c.last.value + '°C</b>。';
          } else {
            s = '今天还没有<b>体温</b>记录。平时不用天天测，发热期按需记就好。';
          }
          return s;
        },
        dash: function () {
          var medsAll = (d.meds || []).filter(function (r) { return r && r.time && !isNaN(new Date(r.time).getTime()) && new Date(r.time).getTime() <= Date.now() + 60000; });
          var lastMed = medsAll.slice().sort(function (a, b) { return new Date(b.time) - new Date(a.time); })[0];
          var chart = tempChart(d.temps || [], medsAll, HIGH);
          var medLine = (lastMed && Date.now() - new Date(lastMed.time).getTime() < 24 * 3600000)
            ? '<p class="hint">距上次用药（' + Util.escapeHtml(lastMed.name || '用药') + '）已 <b>' + Util.escapeHtml(Util.fmtDuration(Date.now() - new Date(lastMed.time).getTime())) + '</b>。两次用药间隔请按医嘱或说明书。</p>' : '';
          if (!chart && !medLine) return '';
          return '<div class="card dash-card"><h2>最近 72 小时</h2>' + chart + (chart ? '<p class="hint">竖线是吃药页记下的用药时刻。</p>' : '') + medLine + '</div>';
        },
        fields: [
          { k: 'value', t: 'num', label: '温度', unit: '°C', min: 35, max: 42.5, step: 0.1, quick: [36.5, 37.0, 37.5, 38.0, 38.5], ph: '如 37.2', optional: false },
          { k: 'site', t: 'seg', label: '测量部位', opts: SITES.map(function (x) { return { v: x.v, label: x.label }; }), def: 'axillary' }
        ],
        sheetHint: '不同部位的参考值不同，记下部位，回看时才知道是不是同一把尺子量的。',
        notePh: '如 午睡后 / 精神还行',
        title: function (r) { return okV(r.value) ? r.value + '°C' : '体温'; },
        sub: function (r) {
          var ep = epMap[r.id], st = siteOf(r.site);
          return [ep && ep.days > 1 ? '第 ' + ep.day + ' 天' : '', st ? st.label : '', r.note || ''].filter(Boolean).join(' · ');
        },
        rowCls: function (r) { return okV(r.value) && r.value >= HIGH ? 'tl-warn' : ''; },
        foot: '体温记录仅供参考；发热或持续异常请及时就医，用药请遵医嘱。',
        empty: '发热时量几次记几次，就能看到变化。点下方「记录体温」。'
      });
    }
  };
})(window);
