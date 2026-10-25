/**
 * water.js - 饮水记录（第 132 次起；第 252 次迁到新骨架 modskel.js）
 *
 * 定位：辅食期之后才开始有意义的记录。**不做「每日应喝多少毫升」的达标线**——
 * 需水量按体重、天气、活动量和辅食含水量变化，个体差异极大，给死数字只会误导（U-25）。
 * 数据：d.waters = [{ id, time, ml, note }]。
 */
(function (global) {
  'use strict';
  var Util = global.Util;
  var Modules = global.Modules = global.Modules || {};

  var QUICK = [30, 50, 100, 150]; /* 常见杯子/学饮杯容量档位 */
  function mlOf(r) { return (typeof r.ml === 'number' && isFinite(r.ml)) ? r.ml : 0; }

  Modules.water = {
    id: 'water',
    title: '饮水',
    render: function (view) {
      global.ModSkel.render(view, {
        id: 'water', accent: 'water', noun: '饮水', listKey: 'waters', icon: 'water', bars: 'ml', barLabel: '毫升数',
        ref: '<b>6 月龄内纯母乳或配方奶喂养的宝宝，通常不需要额外喂水</b>；加辅食后再逐步引入。只统计喝进去的水，冲奶粉的水不算。',
        summary: function (c) {
          var ml = c.today.reduce(function (s, r) { return s + mlOf(r); }, 0);
          if (c.today.length) return '今天喝了 <b>' + ml + ' ml</b> 水，分 <b>' + c.today.length + ' 次</b>。';
          var s = '今天还没有<b>饮水</b>记录。';
          if (c.last) s += '上次是<b>' + Util.escapeHtml(c.ago(c.last.time)) + '</b>' + (mlOf(c.last) ? '，<b>' + mlOf(c.last) + ' ml</b>' : '') + '。';
          return s;
        },
        instant: QUICK.map(function (ml) { return { label: '+' + ml + ' ml', vals: { ml: ml } }; }),
        fields: [{ k: 'ml', t: 'num', label: '喝了多少', unit: 'ml', min: 1, max: 500, quick: QUICK, ph: '如 80', optional: false }],
        notePh: '如 用学饮杯 / 喝了半杯',
        title: function (r) { return mlOf(r) ? mlOf(r) + ' ml' : '饮水'; },
        empty: '喝完点上面的 +30 / +50 这些一键记下；量不一样就点下方「记录饮水」。'
      });
    }
  };
})(window);
