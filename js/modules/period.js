/**
 * period.js - 经期 / 排卵期
 * 仅记录起止日期 + 少量症状；预测下次经期与排卵期，明确标注"仅供参考"。
 */
(function (global) {
  'use strict';
  var Storage = global.Storage, Util = global.Util;
  var Modules = global.Modules = global.Modules || {};

  var SYMPTOMS = ['腹痛', '头痛', '情绪波动', '胸胀', '腰酸', '其他'];

  function predict() {
    var periods = Storage.get().periods.slice()
      .sort(function (a, b) { return new Date(a.start) - new Date(b.start); });
    if (!periods.length) return null;
    var avg;
    if (periods.length >= 2) {
      var gaps = [];
      for (var i = 1; i < periods.length; i++) {
        gaps.push(Util.daysBetween(periods[i - 1].start, periods[i].start));
      }
      avg = Math.round(gaps.reduce(function (s, x) { return s + x; }, 0) / gaps.length);
    } else {
      avg = 28;
    }
    if (avg < 20 || avg > 45) avg = 28;
    var last = periods[periods.length - 1].start;
    var next = Util.addDays(last, avg);
    var ovulation = Util.addDays(next, -14);
    return {
      avg: avg, next: next, ovulation: ovulation,
      fertileStart: Util.addDays(ovulation, -3), fertileEnd: Util.addDays(ovulation, 3)
    };
  }

  Modules.period = {
    id: 'period',
    title: '经期',
    render: function (view) {
      var d = Storage.get();
      var p = predict();
      var html = '';

      html += '<div class="card"><h2>' + icon('period') + '记录一次经期</h2>';
      html += '<label>开始日期<input type="date" id="pStart" value="' + Util.todayISO() + '"></label>';
      html += '<label>结束日期（可选）<input type="date" id="pEnd"></label>';
      html += '<div class="chk-group">症状：';
      SYMPTOMS.forEach(function (s) {
        html += '<label class="chk"><input type="checkbox" class="pSym" value="' + s + '"> ' + s + '</label>';
      });
      html += '</div>';
      html += '<button class="btn btn-primary" id="pSave">保存</button> ';
      html += '<button class="btn" id="pClear">清空记录</button></div>';

      if (p) {
        html += '<div class="card"><h2>' + icon('period') + '预测（仅供参考）</h2><ul class="kv">';
        html += '<li>平均周期：' + p.avg + ' 天</li>';
        html += '<li>下次经期（预计）：<b>' + Util.fmtDate(p.next) + '</b></li>';
        html += '<li>排卵日（预计）：' + Util.fmtDate(p.ovulation) + '</li>';
        html += '<li>易孕期：' + Util.fmtDate(p.fertileStart) + ' 至 ' + Util.fmtDate(p.fertileEnd) + '</li>';
        html += '</ul><p class="warn">预测仅供参考，个体差异大，请勿据此避孕或判断健康。</p></div>';
      } else {
        html += '<div class="card hint"><div class="empty-illo">' + illo('empty') + '</div><p>还没有记录。记下第一次经期开始日期即可开始预测。</p></div>';
      }

      html += '<div class="card"><h2>' + icon('period') + '历史记录</h2>';
      if (d.periods.length) {
        html += '<ul class="list">';
        d.periods.slice().sort(function (a, b) { return new Date(b.start) - new Date(a.start); })
          .forEach(function (r) {
            html += '<li>' + icon('period') + '<span>' + Util.fmtDate(r.start) +
              (r.end ? ' ~ ' + Util.fmtDate(r.end) : '') +
              (r.symptoms && r.symptoms.length ? ' ｜ ' + Util.escapeHtml(r.symptoms.join('、')) : '') +
              '</span><button class="icon-btn" data-del="' + r.id + '" aria-label="删除" title="删除">' + icon('trash') + '</button></li>';
          });
        html += '</ul>';
      } else {
        html += '<div class="empty-illo">' + illo('empty') + '</div><p class="hint">暂无</p>';
      }
      html += '</div>';

      view.innerHTML = html;

      view.querySelector('#pSave').addEventListener('click', function () {
        var start = view.querySelector('#pStart').value;
        if (!start) { Util.markInvalid(view.querySelector('#pStart'), '请填写开始日期'); return; }
        var end = view.querySelector('#pEnd').value;
        if (end && Util.daysBetween(start, end) < 0) { Util.markInvalid(view.querySelector('#pEnd'), '结束日期不能早于开始日期'); return; }
        var syms = Array.prototype.map.call(view.querySelectorAll('.pSym:checked'), function (c) { return c.value; });
        d.periods.push({ id: Util.uid(), start: start, end: end || null, symptoms: syms });
        Storage.save();
        global.App.rerender();
      });
      view.querySelector('#pClear').addEventListener('click', function () {
        Util.confirm({ title: '清空经期记录', message: '确定清空全部经期记录？', okText: '清空', danger: true, onConfirm: function () { d.periods = []; Storage.save(); global.App.rerender(); } });
      });
      Array.prototype.forEach.call(view.querySelectorAll('[data-del]'), function (b) {
        b.addEventListener('click', function () {
          var id = b.getAttribute('data-del');
          Util.removeWithUndo(d.periods, id, {
            onSave: function () { Storage.save(); },
            onAfter: function () { global.App.rerender(); },
            deletedText: '已删除经期记录'
          });
        });
      });
    }
  };
})(window);
