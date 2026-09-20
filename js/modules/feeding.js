/**
 * feeding.js - 喂养记录
 * 母乳/奶瓶/奶粉/辅食；一键快速记录（时长/奶量）；支持夜间深色模式（全局）。
 */
(function (global) {
  'use strict';
  var Storage = global.Storage, Util = global.Util;
  var Modules = global.Modules = global.Modules || {};

  var TYPES = [
    { v: 'breast', t: '母乳' },
    { v: 'bottle', t: '奶瓶' },
    { v: 'formula', t: '奶粉' },
    { v: 'solid', t: '辅食' }
  ];

  Modules.feeding = {
    id: 'feeding',
    title: '喂养',
    render: function (view) {
      var d = Storage.get();
      var html = '';

      html += '<div class="card"><h2>' + icon('feeding') + '快速记录</h2>';
      html += '<div class="seg" id="fType">';
      TYPES.forEach(function (t, i) {
        html += '<button type="button" class="seg-btn' + (i === 0 ? ' active' : '') + '" data-t="' + t.v + '">' + icon(t.v) + t.t + '</button>';
      });
      html += '</div>';
      html += '<label id="lblDur">时长（分钟）<input type="number" id="fDur" min="0" placeholder="如 15"></label>';
      html += '<label id="lblAmt">奶量/克数（ml/g）<input type="number" id="fAmt" min="0" placeholder="如 120"></label>';
      html += '<label>备注<input type="text" id="fNote" placeholder="可选"></label>';
      html += '<button class="btn btn-primary" id="fSave">保存</button></div>';

      html += '<div class="card"><h2>' + icon('feeding') + '最近记录</h2>';
      var list = d.feedings.slice().sort(function (a, b) { return new Date(b.start) - new Date(a.start); }).slice(0, 20);
      if (list.length) {
        html += '<ul class="list">';
        list.forEach(function (r) {
          var typeName = (TYPES.filter(function (t) { return t.v === r.type; })[0] || {}).t || r.type;
          var detail = (r.type === 'breast')
            ? (r.durationMin ? r.durationMin + ' 分' : '')
            : (r.amount ? r.amount + ' ml/g' : '');
          html += '<li><span class="row-ico">' + icon(r.type) + '</span><span>' + Util.fmtDateTime(r.start) + ' ｜ ' + typeName +
            (detail ? ' ｜ ' + detail : '') + (r.note ? ' ｜ ' + Util.escapeHtml(r.note) : '') +
            '</span><button class="icon-btn" data-del="' + r.id + '" aria-label="删除" title="删除">' + icon('trash') + '</button></li>';
        });
        html += '</ul>';
      } else {
        html += '<div class="empty-illo">' + illo('empty') + '</div><p class="hint">暂无</p>';
      }
      html += '</div>';

      view.innerHTML = html;

      var type = 'breast';
      function syncType() {
        var isBreast = (type === 'breast');
        view.querySelector('#lblDur').style.display = isBreast ? '' : 'none';
        view.querySelector('#lblAmt').style.display = isBreast ? 'none' : '';
      }
      Array.prototype.forEach.call(view.querySelectorAll('#fType .seg-btn'), function (b) {
        b.addEventListener('click', function () {
          type = b.getAttribute('data-t');
          Array.prototype.forEach.call(view.querySelectorAll('#fType .seg-btn'), function (x) { x.classList.remove('active'); });
          b.classList.add('active');
          syncType();
        });
      });
      syncType();

      view.querySelector('#fSave').addEventListener('click', function () {
        var dur = view.querySelector('#fDur').value;
        var amt = view.querySelector('#fAmt').value;
        var note = view.querySelector('#fNote').value.trim();
        if (type === 'breast') {
          if (!dur) { Util.markInvalid(view.querySelector('#fDur'), '请填写时长'); return; }
        } else {
          if (!amt) { Util.markInvalid(view.querySelector('#fAmt'), '请填写奶量/克数'); return; }
        }
        d.feedings.push({
          id: Util.uid(),
          type: type,
          start: Util.nowLocal(),
          durationMin: type === 'breast' ? parseInt(dur, 10) : null,
          amount: type === 'breast' ? null : parseInt(amt, 10),
          note: note || null
        });
        Storage.save();
        global.App.rerender();
      });
      Array.prototype.forEach.call(view.querySelectorAll('[data-del]'), function (b) {
        b.addEventListener('click', function () {
          var id = b.getAttribute('data-del');
          Util.removeWithUndo(d.feedings, id, {
            onSave: function () { Storage.save(); },
            onAfter: function () { global.App.rerender(); },
            deletedText: '已删除喂养记录'
          });
        });
      });
    }
  };
})(window);
