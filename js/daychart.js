/* 第 223 次：喂养/睡眠页「今日看板」共用的小图表（纯 HTML + CSS，无依赖）。
   - strip：一条 24 小时时间轴，点 = 某一刻发生的事（喂奶），段 = 一段时间（睡眠）
   - bars：近 7 天小柱状图
   时间轴按照护日（settings.dayStart）切：dayStart=6 时轴从早 6 点到次日 6 点。
   所有文字都经 Util.escapeHtml；数值只来自本地记录。 */
(function (global) {
  'use strict';
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function esc(s) { return global.Util ? Util.escapeHtml(String(s)) : String(s); }

  var DayChart = {
    /** 照护日 dayKey（yyyy-mm-dd）对应的时间窗 [start, end)（毫秒） */
    windowOf: function (dayKey, ds) {
      var p = dayKey.split('-');
      var s = new Date(+p[0], +p[1] - 1, +p[2], ds || 0, 0, 0, 0).getTime();
      var e = new Date(+p[0], +p[1] - 1, +p[2] + 1, ds || 0, 0, 0, 0).getTime(); /* 跨夏令时也按日历加一天 */
      return [s, e];
    },
    /** 时段 [a,b) 与 [s,e) 的重叠分钟数 */
    overlapMin: function (a, b, s, e) {
      var x = Math.max(a, s), y = Math.min(b, e);
      return y > x ? (y - x) / 60000 : 0;
    },
    /** 最近 n 个照护日的 dayKey，最早在前 */
    lastDays: function (todayKey, n) {
      var out = [];
      for (var i = n - 1; i >= 0; i--) out.push(Util.addDays(todayKey, -i));
      return out;
    },
    /** 「周三」/「今天」 */
    dayLabel: function (key, todayKey) {
      if (key === todayKey) return '今天';
      var p = key.split('-');
      return '周' + '日一二三四五六'.charAt(new Date(+p[0], +p[1] - 1, +p[2]).getDay());
    },
    /** 24 小时时间轴
        opts: { win:[s,e], ds, marks:[{t, cls, title}], spans:[{s, e, cls, title}], now, label } */
    strip: function (opts) {
      var s = opts.win[0], e = opts.win[1], len = e - s, ds = opts.ds || 0;
      function pct(t) { return Math.max(0, Math.min(100, (t - s) / len * 100)); }
      var h = '<div class="dc-strip" role="img" aria-label="' + esc(opts.label || '今日时间轴') + '"><div class="dc-track">';
      (opts.spans || []).forEach(function (sp) {
        var a = Math.max(sp.s, s), b = Math.min(sp.e, e);
        if (b <= a) return;
        h += '<span class="dc-span ' + (sp.cls || '') + '" style="left:' + pct(a).toFixed(2) + '%;width:' + Math.max(0.8, pct(b) - pct(a)).toFixed(2) + '%"'
          + (sp.title ? ' title="' + esc(sp.title) + '"' : '') + '></span>';
      });
      (opts.marks || []).forEach(function (m) {
        if (m.t < s || m.t >= e) return;
        h += '<span class="dc-dot ' + (m.cls || '') + '" style="left:' + pct(m.t).toFixed(2) + '%"'
          + (m.title ? ' title="' + esc(m.title) + '"' : '') + '></span>';
      });
      if (opts.now && opts.now >= s && opts.now < e) h += '<span class="dc-now" style="left:' + pct(opts.now).toFixed(2) + '%"></span>';
      h += '</div><div class="dc-ticks">';
      for (var i = 0; i <= 4; i++) {
        var hr = (ds + i * 6) % 24;
        h += '<span style="left:' + (i * 25) + '%">' + pad(hr) + '</span>';
      }
      return h + '</div></div>';
    },
    /** 近 7 天柱状图；items: [{key, v, txt}]，v 为数值，txt 为柱顶文字 */
    bars: function (items, todayKey, label) {
      var max = 0;
      items.forEach(function (it) { if (it.v > max) max = it.v; });
      var h = '<div class="dc-bars" role="img" aria-label="' + esc(label || '近 7 天') + '">';
      items.forEach(function (it) {
        var ht = max ? Math.round(it.v / max * 100) : 0;
        h += '<div class="dc-bar' + (it.key === todayKey ? ' today' : '') + '">'
          + '<span class="dc-bv">' + (it.v ? esc(it.txt) : '') + '</span>'
          + '<span class="dc-bcol"><i style="height:' + (it.v ? Math.max(6, ht) : 0) + '%"></i></span>'
          + '<span class="dc-bl">' + esc(DayChart.dayLabel(it.key, todayKey)) + '</span></div>';
      });
      return h + '</div>';
    },
    /** 分钟 → 「9 小时 40 分」 */
    fmtMin: function (min) {
      min = Math.round(min);
      var hh = Math.floor(min / 60), mm = min % 60;
      if (!hh) return mm + ' 分';
      return hh + ' 小时' + (mm ? ' ' + mm + ' 分' : '');
    },
    /** 大号数字版：返回 HTML，单位缩小 */
    bigMin: function (min) {
      min = Math.round(min);
      var hh = Math.floor(min / 60), mm = min % 60;
      if (!hh) return mm + '<i>分</i>';
      return hh + '<i>小时</i>' + (mm ? mm + '<i>分</i>' : '');
    }
  };
  global.DayChart = DayChart;
})(window);
