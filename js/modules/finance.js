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
      html += '<label>金额（元）<input type="number" step="0.01" inputmode="decimal" id="fAmt" min="0.01"></label>';
      html += '<label>分类<select id="fCat">';
      CATS.forEach(function (c) { html += '<option value="' + c + '"' + (c === defCat ? ' selected' : '') + '>' + c + '</option>'; });
      html += '</select></label>';
      html += '<label>备注<input type="text" id="fNote" placeholder="可选"></label>';
      html += Util.dateSlider({ id: 'fDate', title: '日期', value: Util.todayISO(), min: Util.addDays(Util.todayISO(), -31), max: Util.todayISO() });
      html += '<button class="btn btn-primary btn-save" id="fSave">保存</button></div>';

      var recs = d.finance.records.slice().sort(function (a, b) { return new Date(b.date) - new Date(a.date); });
      /* 第 274 次（审计 #26：页头「本月已花 ¥0.3」、统计「总支出 100.30 元」挨着像算错）：
         统计卡分开写「本月」和「全部（自最早一笔起）」，分类小计标明是全部记录；金额统一 ¥ 两位小数（Util.fmtYuan）。 */
      var amtOf = function (r) { var v = parseFloat(r.amount); return isFinite(v) ? v : 0; };
      var ym = Util.todayISO().slice(0, 7);
      var total = recs.reduce(function (s, r) { return s + amtOf(r); }, 0);
      var mTotal = recs.reduce(function (s, r) { return String(r.date || '').slice(0, 7) === ym ? s + amtOf(r) : s; }, 0);
      var first = recs.length ? recs[recs.length - 1].date : '';
      var byCat = {};
      recs.forEach(function (r) { byCat[r.category] = (byCat[r.category] || 0) + amtOf(r); });
      html += '<div class="card"><h2>统计</h2>';
      html += '<p>本月（' + (+ym.slice(5)) + ' 月）支出：<b>' + Util.fmtYuan(mTotal) + '</b></p>';
      html += '<p>全部' + (first ? '（' + Util.escapeHtml(Util.fmtDate(first)) + ' 起）' : '') + '支出：<b>' + Util.fmtYuan(total) + '</b></p>';
      var keys = Object.keys(byCat);
      if (keys.length) {
        html += '<p class="hint">按分类（全部记录）</p><ul class="kv">';
        keys.sort(function (a, b) { return byCat[b] - byCat[a]; }).forEach(function (k) {
          html += '<li>' + Util.escapeHtml(k) + '：' + Util.fmtYuan(byCat[k]) + '</li>';
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
            + '<span class="li-num">' + Util.fmtYuan(parseFloat(r.amount) || 0) + '</span>' /* 第 89 次（审计 B4）：坏金额回落 0，不渲染 NaN */
            + '<button class="icon-btn" data-del="' + r.id + '" aria-label="删除" title="删除">' + icon('trash') + '</button></li>';
        });
        html += '</ul><button class="btn-mini" id="fClear">清空</button>';
      } else {
        html += '<div class="empty-state"><span class="es-ico">' + icon('finance') + '</span><p>还没有开销记录</p><span class="hint">买了东西顺手记一笔。</span></div>';
      }
      html += '</div>';

      view.innerHTML = html;
      Util.bindDateSliders(view);

      view.querySelector('#fSave').addEventListener('click', function () {
        var amt = view.querySelector('#fAmt').value;
        /* 第 273 次（审计 #20：0 元也能存）：金额必须是大于 0 的数 */
        if (!(parseFloat(amt) > 0) || !isFinite(Number(amt))) { Util.markInvalid(view.querySelector('#fAmt'), '请填写大于 0 的金额'); return; }
        var cat = view.querySelector('#fCat').value;
        d.finance.records.push({
          id: Util.uid(),
          amount: parseFloat(amt),
          category: cat,
          note: view.querySelector('#fNote').value.trim() || null,
          date: view.querySelector('#fDate').value
        });
        if (Storage.save()) Util.toast('已记录：' + Util.fmtYuan(parseFloat(amt)) + ' · ' + cat, 'ok'); /* C1：金额落库必须可见 */
        global.App.rerender();
      });
      var fExp = view.querySelector('#fExp');
      if (fExp) fExp.addEventListener('click', function () {
        /* 第 273 次（审计 #18：备注里有逗号 / 引号时整行错列）：按 RFC 4180 转义，带 BOM、CRLF */
        var csv = Util.toCsv(['日期', '分类', '金额', '备注'], recs.map(function (r) { return [r.date, r.category, r.amount, r.note || '']; }));
        Util.download('母婴账单_' + Util.todayISO() + '.csv', csv, 'text/csv;charset=utf-8');
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
