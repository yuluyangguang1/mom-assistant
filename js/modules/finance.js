/**
 * finance.js - 母婴记账
 * 预设母婴分类；一键快速记一笔；列表 + 简单统计；支持导出 CSV。
 */
(function (global) {
  'use strict';
  var Storage = global.Storage, Util = global.Util;
  var Modules = global.Modules = global.Modules || {};

  var CATS = ['产检', '待产', '奶粉', '早教', '药品', '衣物', '玩具', '其他'];

  Modules.finance = {
    id: 'finance',
    title: '记账',
    render: function (view) {
      var d = Storage.get();
      var html = '';

      html += '<div class="card"><h2>' + icon('finance') + '记一笔</h2>';
      html += '<label>金额（元）<input type="number" step="0.01" id="fAmt" min="0"></label>';
      html += '<label>分类<select id="fCat">';
      CATS.forEach(function (c) { html += '<option value="' + c + '">' + c + '</option>'; });
      html += '</select></label>';
      html += '<label>备注<input type="text" id="fNote" placeholder="可选"></label>';
      html += '<label>日期<input type="date" id="fDate" value="' + Util.todayISO() + '"></label>';
      html += '<button class="btn btn-primary" id="fSave">保存</button></div>';

      var recs = d.finance.records.slice().sort(function (a, b) { return new Date(b.date) - new Date(a.date); });
      var total = recs.reduce(function (s, r) { return s + (parseFloat(r.amount) || 0); }, 0);
      var byCat = {};
      recs.forEach(function (r) { byCat[r.category] = (byCat[r.category] || 0) + (parseFloat(r.amount) || 0); });
      html += '<div class="card"><h2>' + icon('finance') + '统计</h2>';
      html += '<p>总支出：<b>' + total.toFixed(2) + ' 元</b></p>';
      var keys = Object.keys(byCat);
      if (keys.length) {
        html += '<ul class="kv">';
        keys.sort(function (a, b) { return byCat[b] - byCat[a]; }).forEach(function (k) {
          html += '<li>' + k + '：' + byCat[k].toFixed(2) + ' 元</li>';
        });
        html += '</ul>';
      }
      html += '<button class="btn" id="fExp">导出本模块 CSV</button></div>';

      html += '<div class="card"><h2>明细</h2>';
      if (recs.length) {
        html += '<ul class="list">';
        recs.slice(0, 50).forEach(function (r) {
          html += '<li>' + icon('finance') + '<span>' + Util.fmtDate(r.date) + ' ｜ ' + Util.escapeHtml(r.category) + ' ｜ ' +
            (parseFloat(r.amount)).toFixed(2) + '元' + (r.note ? ' ｜ ' + Util.escapeHtml(r.note) : '') +
            '</span><button class="icon-btn" data-del="' + r.id + '" aria-label="删除" title="删除">' + icon('trash') + '</button></li>';
        });
        html += '</ul><button class="btn-mini" id="fClear">清空</button>';
      } else {
        html += '<div class="empty-illo">' + illo('empty') + '</div><p class="hint">暂无</p>';
      }
      html += '</div>';

      view.innerHTML = html;

      view.querySelector('#fSave').addEventListener('click', function () {
        var amt = view.querySelector('#fAmt').value;
        if (amt === '' || parseFloat(amt) < 0) { Util.markInvalid(view.querySelector('#fAmt'), '请填写正确金额'); return; }
        d.finance.records.push({
          id: Util.uid(),
          amount: parseFloat(amt),
          category: view.querySelector('#fCat').value,
          note: view.querySelector('#fNote').value.trim() || null,
          date: view.querySelector('#fDate').value
        });
        Storage.save(); global.App.rerender();
      });
      var fExp = view.querySelector('#fExp');
      if (fExp) fExp.addEventListener('click', function () {
        var lines = ['日期,分类,金额,备注'];
        recs.forEach(function (r) { lines.push([r.date, r.category, r.amount, r.note || ''].join(',')); });
        Util.download('母婴账单_' + Util.todayISO() + '.csv', '﻿' + lines.join('\n'), 'text/csv;charset=utf-8');
      });
      var fClear = view.querySelector('#fClear');
      if (fClear) fClear.addEventListener('click', function () {
        Util.confirm({ title: '清空账单', message: '确定清空全部账单？', okText: '清空', danger: true, onConfirm: function () { d.finance.records = []; Storage.save(); global.App.rerender(); } });
      });
      Array.prototype.forEach.call(view.querySelectorAll('[data-del]'), function (b) {
        b.addEventListener('click', function () {
          var id = b.getAttribute('data-del');
          Util.removeWithUndo(d.finance.records, id, {
            onSave: function () { Storage.save(); },
            onAfter: function () { global.App.rerender(); },
            deletedText: '已删除一笔账单'
          });
        });
      });
    }
  };
})(window);
