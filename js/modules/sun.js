/**
 * sun.js - 日晒记录（第 132 次起；第 251 次迁到新骨架 modskel.js）
 * 明确不做：不把日晒当退黄手段推荐——黄疸由医生判断，蓝光治疗与「晒太阳」不是一回事。
 * 数据：d.suns = [{ id, time, minutes, area, note }]，area ∈ face/limbs/all/hip。
 */
(function (global) {
  'use strict';
  var Util = global.Util;
  var Modules = global.Modules = global.Modules || {};

  var AREAS = [
    { v: 'face', label: '面部' },
    { v: 'limbs', label: '四肢' },
    { v: 'all', label: '全身' },
    { v: 'hip', label: '臀部' }
  ];
  function areaLabel(v) { for (var i = 0; i < AREAS.length; i++) if (AREAS[i].v === v) return AREAS[i].label; return ''; }

  function minTxt(r) { return (typeof r.minutes === 'number' && isFinite(r.minutes)) ? r.minutes + ' 分钟' : ''; }
  function summary(noun) {
    return function (c) {
      var s;
      if (c.today.length) s = '今天晒了 <b>' + c.today.length + ' 次</b>' + (c.todayMin ? '，合计 <b>' + c.todayMin + ' 分钟</b>' : '') + '。';
      else {
        s = '今天还没有<b>' + noun + '</b>记录。';
        if (c.last) s += '上次是<b>' + Util.escapeHtml(c.ago(c.last.time)) + '</b>' + (minTxt(c.last) ? '，<b>' + minTxt(c.last) + '</b>' : '') + '。';
      }
      return s;
    };
  }

  Modules.sun = {
    id: 'sun',
    title: '日晒',
    render: function (view) {
      global.ModSkel.render(view, {
        id: 'sun', accent: 'sun', noun: '日晒', listKey: 'suns', icon: 'sun', care: true, bars: 'minutes',
        ref: '避开 10:00–16:00 的强紫外线，<b>6 月龄以下避免阳光直射</b>；隔着玻璃晒基本没效果。日晒不能替代医生的退黄判断。',
        summary: summary('日晒'),
        fields: [
          { k: 'minutes', t: 'num', label: '时长', unit: '分钟', min: 1, max: 120, quick: [5, 10, 15, 20], ph: '如 15' },
          { k: 'area', t: 'seg', label: '部位', opts: AREAS, def: 'all' }
        ],
        notePh: '如 上午十点前 / 阴天',
        title: function (r) { return minTxt(r) ? '日晒 · ' + minTxt(r) : '日晒'; },
        sub: function (r) { return [areaLabel(r.area), r.note || ''].filter(Boolean).join(' · '); },
        empty: '到户外点「开始日晒」，回屋点结束。忘了计时就点右边的 ⊕ 补记。'
      });
    }
  };
})(window);
