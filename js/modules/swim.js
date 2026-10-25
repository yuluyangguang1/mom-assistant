/**
 * swim.js - 游泳记录（第 132 次起；第 251 次迁到新骨架 modskel.js）
 * 数据：d.swims = [{ id, time, minutes, note }]；计时逻辑在 care.js。
 */
(function (global) {
  'use strict';
  var Util = global.Util;
  var Modules = global.Modules = global.Modules || {};

  function minTxt(r) { return (typeof r.minutes === 'number' && isFinite(r.minutes)) ? r.minutes + ' 分钟' : ''; }
  function summary(noun) {
    return function (c) {
      var s;
      if (c.today.length) s = '今天游了 <b>' + c.today.length + ' 次</b>' + (c.todayMin ? '，合计 <b>' + c.todayMin + ' 分钟</b>' : '') + '。';
      else {
        s = '今天还没有<b>' + noun + '</b>记录。';
        if (c.last) s += '上次是<b>' + Util.escapeHtml(c.ago(c.last.time)) + '</b>' + (minTxt(c.last) ? '，<b>' + minTxt(c.last) + '</b>' : '') + '。';
      }
      return s;
    };
  }

  Modules.swim = {
    id: 'swim',
    title: '游泳',
    render: function (view) {
      global.ModSkel.render(view, {
        id: 'swim', accent: 'swim', noun: '游泳', listKey: 'swims', icon: 'swim', care: true, bars: 'count',
        ref: '<b>宝宝在水里时，大人必须始终用手护着，一秒都不能离开。</b>水温 32–34°C、单次不超过 15–20 分钟；皮肤破损、发热或刚打完疫苗先别游。',
        summary: summary('游泳'),
        fields: [{ k: 'minutes', t: 'num', label: '时长', unit: '分钟', min: 1, max: 120, quick: [5, 10, 15, 20], ph: '如 15' }],
        notePh: '如 游泳馆 / 很开心',
        title: function (r) { return minTxt(r) ? '游泳 · ' + minTxt(r) : '游泳'; },
        empty: '下水点「开始游泳」，上岸点结束。忘了计时就点右边的 ⊕ 补记。'
      });
    }
  };
})(window);
