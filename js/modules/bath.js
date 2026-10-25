/**
 * bath.js - 洗澡记录（第 132 次起；第 251 次迁到新骨架 modskel.js）
 * 只记录不判读（U-25 口径）：不评价频率、不给「应该多久洗一次」的结论。
 * 数据：d.baths = [{ id, time, minutes, note }]；计时逻辑在 care.js（洗澡 / 游泳 / 日晒共用）。
 */
(function (global) {
  'use strict';
  var Util = global.Util;
  var Modules = global.Modules = global.Modules || {};

  function minTxt(r) { return (typeof r.minutes === 'number' && isFinite(r.minutes)) ? r.minutes + ' 分钟' : ''; }
  function summary(noun) {
    return function (c) {
      var s;
      if (c.today.length) s = '今天洗了 <b>' + c.today.length + ' 次</b>' + (c.todayMin ? '，合计 <b>' + c.todayMin + ' 分钟</b>' : '') + '。';
      else {
        s = '今天还没有<b>' + noun + '</b>记录。';
        if (c.last) s += '上次是<b>' + Util.escapeHtml(c.ago(c.last.time)) + '</b>' + (minTxt(c.last) ? '，<b>' + minTxt(c.last) + '</b>' : '') + '。';
      }
      return s;
    };
  }

  Modules.bath = {
    id: 'bath',
    title: '洗澡',
    render: function (view) {
      global.ModSkel.render(view, {
        id: 'bath', accent: 'bath', noun: '洗澡', listKey: 'baths', icon: 'bath', care: true, bars: 'count',
        ref: '水温 37–38°C、水深不超过 5 厘米，<b>全程不要离开宝宝</b>。只做记录，不替代护理与就医建议。',
        summary: summary('洗澡'),
        fields: [{ k: 'minutes', t: 'num', label: '时长', unit: '分钟', min: 1, max: 180, quick: [5, 10, 15, 20], ph: '如 10' }],
        notePh: '如 用了新浴盆 / 洗头哭了',
        title: function (r) { return minTxt(r) ? '洗澡 · ' + minTxt(r) : '洗澡'; },
        empty: '下水前点「开始洗澡」，洗完点结束，时长自动算好。忘了计时就点右边的 ⊕ 补记。'
      });
    }
  };
})(window);
