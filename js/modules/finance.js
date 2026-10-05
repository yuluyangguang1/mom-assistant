/**
 * finance.js - 母婴记账
 * 预设母婴分类；一键快速记一笔；列表 + 简单统计；支持导出 CSV。
 */
(function (global) {
  'use strict';
  var Storage = global.Storage, Util = global.Util;
  var Modules = global.Modules = global.Modules || {};

  /* C5：母婴日常高频是奶粉/纸尿裤，原表缺「纸尿裤」「用品」（研究清单模块 12） */
  var CATS = ['产检', '待产', '奶粉', '纸尿裤', '用品', '药品', '早教', '衣物', '玩具', '其他'];

  Modules.finance = {
    id: 'finance',
    title: '记账',
    render: function (view) {
      var d = Storage.get();
      var html = '';

      /* C5：分类默认取上一次所选（U-06 同款），不再永远停在「产检」 */
      var lastRec = d.finance.records[d.finance.records.length - 1];
      var defCat = (lastRec && CATS.indexOf(lastRec.category) >= 0) ? lastRec.category : CATS[0];

      html += '<div class="card"><h2>记一笔</h2>';
      html += '<label>金额（元）<input type="number" step="0.01" inputmode="decimal" id="fAmt" min="0"></label>';
      html += '<label>分类<select id="fCat">';
      CATS.forEach(function (c) { html += '<option value="' + c + '"' + (c === defCat ? ' selected' : '') + '>' + c + '</option>'; });
      html += '</select></label>';
      html += '<label>备注<input type="text" id="fNote" placeholder="可选"></label>';
      html += Util.dateSlider({ id: 'fDate', title: '日期', value: Util.todayISO(), min: Util.addDays(Util.todayISO(), -31), max: Util.todayISO() });
      html += '<button class="btn btn-primary" id="fSave">保存</button></div>';

      var recs = d.finance.records.slice().sort(function (a, b) { return new Date(b.date) - new Date(a.date); });
      var total = recs.reduce(function (s, r) { return s + (parseFloat(r.amount) || 0); }, 0);
      var byCat = {};
      recs.forEach(function (r) { byCat[r.category] = (byCat[r.category] || 0) + (parseFloat(r.amount) || 0); });
      html += '<div class="card"><h2>统计</h2>';
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
          /* 第 61 次：行改「左日期+分类 / 右金额」双列，金额是这行的主数据 */
          html += '<li>' + icon('finance')
            + '<span class="li-main"><b>' + Util.fmtDate(r.date) + '</b>' + Util.escapeHtml(r.category) + '</span>'
            + '<span class="li-sub">' + (r.note ? Util.escapeHtml(r.note) : '') + '</span>'
            + '<span class="li-num">' + (parseFloat(r.amount) || 0).toFixed(2) + '<i>元</i></span>' /* 第 89 次（审计 B4）：坏金额回落 0，不渲染 NaN */
            + '<button class="icon-btn" data-del="' + r.id + '" aria-label="删除" title="删除">' + icon('trash') + '</button></li>';
        });
        html += '</ul><button class="btn-mini" id="fClear">清空</button>';
      } else {
        html += '<p class="hint">暂无</p>';
      }
      html += '</div>';

      view.innerHTML = html;
      Util.bindDateSliders(view);

      view.querySelector('#fSave').addEventListener('click', function () {
        var amt = view.querySelector('#fAmt').value;
        if (amt === '' || parseFloat(amt) < 0) { Util.markInvalid(view.querySelector('#fAmt'), '请填写正确金额'); return; }
        var cat = view.querySelector('#fCat').value;
        d.finance.records.push({
          id: Util.uid(),
          amount: parseFloat(amt),
          category: cat,
          note: view.querySelector('#fNote').value.trim() || null,
          date: view.querySelector('#fDate').value
        });
        if (Storage.save()) Util.toast('已记录：' + parseFloat(amt).toFixed(2) + ' 元 · ' + cat, 'ok'); /* C1：金额落库必须可见 */
        global.App.rerender();
      });
      var fExp = view.querySelector('#fExp');
      if (fExp) fExp.addEventListener('click', function () {
        var lines = ['日期,分类,金额,备注'];
        recs.forEach(function (r) { lines.push([r.date, r.category, r.amount, r.note || ''].join(',')); });
        Util.download('母婴账单_' + Util.todayISO() + '.csv', '﻿' + lines.join('\n'), 'text/csv;charset=utf-8');
      });
      var fClear = view.querySelector('#fClear');
      if (fClear) fClear.addEventListener('click', function () {
        /* U-33：不可逆批量操作走阻断路径——后果说明 + 立即导出口 + 防误触（复用确认框的 extra 出口） */
        Util.confirm({
          title: '清空全部账单',
          message: '将删除本机保存的全部记账记录，此操作不可恢复。',
          okText: '仍要清空',
          danger: true,
          extra: { text: '先导出备份', onClick: function () { global.App.exportAll(); } },
          onConfirm: function () { d.finance.records = []; Storage.save(); global.App.rerender(); }
        });
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
