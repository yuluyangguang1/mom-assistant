/**
 * packing.js - 待产包清单
 * 按场景（入院/产房/月子房）预置清单 + 自定义；可勾选防遗漏；标注"易闲置/非必需"。
 */
(function (global) {
  'use strict';
  var Storage = global.Storage, Util = global.Util;
  var Modules = global.Modules = global.Modules || {};

  var PRESET = [
    { cat: '入院', items: [
      { name: '身份证 / 医保卡', hint: '' },
      { name: '产检病历本', hint: '' },
      { name: '待产包', hint: '' },
      { name: '手机 + 充电器', hint: '' },
      { name: '吸管杯', hint: '' },
      { name: '零食 / 巧克力', hint: '易闲置' },
      { name: '一次性内裤', hint: '' },
      { name: '产褥垫', hint: '' }
    ]},
    { cat: '产房', items: [
      { name: '产褥垫', hint: '' },
      { name: '胎心监护带', hint: '' },
      { name: '能量补给（红牛/巧克力）', hint: '' },
      { name: '纸巾', hint: '' },
      { name: '湿巾', hint: '非必需' }
    ]},
    { cat: '月子房', items: [
      { name: '哺乳衣', hint: '' },
      { name: '防溢乳垫', hint: '' },
      { name: '月子帽', hint: '看季节' },
      { name: '宝宝衣物', hint: '' },
      { name: '纸尿裤', hint: '' },
      { name: '婴儿湿巾', hint: '' },
      { name: '束腹带', hint: '易闲置' },
      { name: '吸奶器', hint: '按需' }
    ]}
  ];

  function ensurePreset() {
    var d = Storage.get();
    if (!d.packing.seeded) {
      PRESET.forEach(function (g) {
        g.items.forEach(function (it) {
          d.packing.items.push({ id: Util.uid(), cat: g.cat, name: it.name, checked: false, hint: it.hint });
        });
      });
      d.packing.seeded = true;
      Storage.save();
    }
  }

  Modules.packing = {
    id: 'packing',
    title: '待产包',
    render: function (view) {
      ensurePreset();
      var d = Storage.get();
      var html = '';
      html += '<div class="card"><p class="hint">按场景勾选，防遗漏。标注“易闲置/非必需”的可酌情准备。</p></div>';

      var cats = [];
      d.packing.items.forEach(function (it) { if (cats.indexOf(it.cat) < 0) cats.push(it.cat); });
      cats.forEach(function (cat) {
        var items = d.packing.items.filter(function (x) { return x.cat === cat; });
        var done = items.filter(function (x) { return x.checked; }).length;
        html += '<div class="card"><h2>' + icon('packing') + Util.escapeHtml(cat) + ' (' + done + '/' + items.length + ')</h2><ul class="list">';
        items.forEach(function (it) {
          html += '<li class="pack-item' + (it.checked ? ' done' : '') + '">' +
            '<label><input type="checkbox" ' + (it.checked ? 'checked' : '') + ' data-chk="' + it.id + '"> ' +
            Util.escapeHtml(it.name) + (it.hint ? ' <span class="tag">' + Util.escapeHtml(it.hint) + '</span>' : '') + '</label>' +
            '<button class="icon-btn" data-del="' + it.id + '" aria-label="删除" title="删除">' + icon('trash') + '</button></li>';
        });
        html += '</ul></div>';
      });

      html += '<div class="card"><h2>' + icon('packing') + '添加自定义物品</h2>';
      html += '<label>场景/分组<input type="text" id="pkCat" placeholder="如 其他"></label>';
      html += '<label>物品名称<input type="text" id="pkName"></label>';
      html += '<label>提示（可选）<input type="text" id="pkHint" placeholder="如 易闲置"></label>';
      html += '<button class="btn" id="pkAdd">添加</button></div>';

      view.innerHTML = html;

      Array.prototype.forEach.call(view.querySelectorAll('[data-chk]'), function (c) {
        c.addEventListener('change', function () {
          var id = c.getAttribute('data-chk');
          var it = d.packing.items.filter(function (x) { return x.id === id; })[0];
          if (it) { it.checked = c.checked; Storage.save(); global.App.rerender(); }
        });
      });
      Array.prototype.forEach.call(view.querySelectorAll('[data-del]'), function (b) {
        b.addEventListener('click', function () {
          var id = b.getAttribute('data-del');
          Util.removeWithUndo(d.packing.items, id, {
            onSave: function () { Storage.save(); },
            onAfter: function () { global.App.rerender(); },
            deletedText: '已删除物品'
          });
        });
      });
      view.querySelector('#pkAdd').addEventListener('click', function () {
        var cat = view.querySelector('#pkCat').value.trim() || '其他';
        var name = view.querySelector('#pkName').value.trim();
        var hint = view.querySelector('#pkHint').value.trim();
        if (!name) { Util.markInvalid(view.querySelector('#pkName'), '请填写物品名称'); return; }
        d.packing.items.push({ id: Util.uid(), cat: cat, name: name, checked: false, hint: hint });
        Storage.save(); global.App.rerender();
      });
    }
  };
})(window);
