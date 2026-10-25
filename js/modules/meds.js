/**
 * meds.js - 吃药 / 维生素 D 记录（第 253 次迁到新骨架 modskel.js：页面只看记录，记录走底部按钮 → 半屏面板）
 * 新生儿期最常见的是每天一滴维生素 D3，偶尔有 AD、益生菌、铁剂；面板里预设名称一点即填，其他手输。
 * 数据：d.meds = [{ id, name, time, note }]（不变）。
 */
(function (global) {
  'use strict';
  var Util = global.Util;
  var Modules = global.Modules = global.Modules || {};

  var PRESETS = ['维生素 D3', '维生素 AD', '益生菌', '铁剂'];

  Modules.meds = {
    id: 'meds',
    title: '吃药/维D',
    render: function (view) {
      var d = global.Storage.get();
      var all = d.meds || [];
      /* 面板里默认填上一次的药名：每天一滴 D3 的人，打开就能直接保存 */
      var lastName = null;
      all.slice().sort(function (a, b) { return new Date(b.time) - new Date(a.time); }).some(function (r) { if (r && r.name) { lastName = r.name; return true; } return false; });
      global.ModSkel.render(view, {
        id: 'meds', accent: 'meds', noun: '用药', listKey: 'meds', icon: 'meds',
        ref: '药名与剂量请遵医嘱；这里只做记录，不提供用药建议。',
        summary: function (c) {
          if (c.today.length) {
            var names = {};
            c.today.forEach(function (r) { var n = r.name || '用药'; names[n] = (names[n] || 0) + 1; });
            return '今天已服 <b>' + c.today.length + ' 次</b>：' + Object.keys(names).map(function (n) {
              return '<b>' + Util.escapeHtml(n) + '</b>' + (names[n] > 1 ? ' ×' + names[n] : '');
            }).join('、') + '。';
          }
          var s = '今天还没有<b>用药</b>记录。';
          if (c.last) s += '上次是<b>' + Util.escapeHtml(c.ago(c.last.time)) + '</b>，' + Util.escapeHtml(c.last.name || '用药') + '。';
          return s;
        },
        fields: [{ k: 'name', t: 'text', label: '药名 / 剂量', max: 30, quick: PRESETS, ph: '如 退烧药 2ml', optional: false, def: lastName }],
        notePh: '如 混在奶里喂的',
        title: function (r) { return r.name || '用药'; },
        foot: '用药名称与剂量请遵医嘱；本页只做记录，不提供任何用药建议。'
      });
    }
  };
})(window);
