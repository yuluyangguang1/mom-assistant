/**
 * contraction.js - 宫缩计时
 * 记录每次宫缩开始；用 START-to-START 计算间隔，结合开始/结束计算时长；
 * 显示最近几次趋势；显式免责声明；支持导出时间线（文本/JSON）。
 */
(function (global) {
  'use strict';
  var Storage = global.Storage, Util = global.Util;
  var Modules = global.Modules = global.Modules || {};

  function openC() { return Storage.get().openContraction || null; }

  function cTick() {
    var oc = openC();
    var el = document.getElementById('cTimer');
    if (!oc || !el) return;
    el.textContent = Util.fmtDuration(Date.now() - new Date(oc.start).getTime());
  }

  Modules.contraction = {
    id: 'contraction',
    title: '宫缩',
    render: function (view) {
      var d = Storage.get();
      var oc = openC();
      var html = '';

      html += '<div class="warn-box"><p>本工具仅用于自我观察记录，<b>仅供参考，一切以医生判断为准</b>。' +
        '如有出血、破水、剧烈腹痛或任何担心，请及时联系医生/就医。</p></div>';

      html += '<div class="card"><h2>' + icon('contraction') + '宫缩计时</h2>';
      if (oc) {
        html += '<p class="big">本次时长 <span id="cTimer">--</span></p>';
        html += '<p class="hint">开始：' + Util.fmtDateTime(oc.start) + '</p>';
        html += '<button class="btn btn-primary" id="cEnd">结束本次</button> ';
        html += '<button class="btn" id="cCancel">取消</button>';
      } else {
        html += '<button class="btn btn-primary" id="cStart">记录一次宫缩（开始）</button>';
        html += '<p class="hint">每次宫缩到来时点"开始"，结束时点"结束"。间隔按"下一次开始 − 本次开始"(START-to-START)计算。</p>';
      }
      html += '</div>';

      html += '<div class="card"><h2>' + icon('contraction') + '最近几次</h2>';
      var list = d.contractions.slice().sort(function (a, b) { return new Date(a.start) - new Date(b.start); });
      if (list.length) {
        html += '<ul class="list">';
        for (var i = 0; i < list.length; i++) {
          var c = list[i];
          var dur = c.end ? (new Date(c.end).getTime() - new Date(c.start).getTime()) : null;
          var interval = (i > 0) ? (new Date(c.start).getTime() - new Date(list[i - 1].start).getTime()) : null;
          html += '<li>' + icon('contraction') + '<span>#' + (i + 1) + ' ' + Util.fmtDateTime(c.start) +
            (dur != null ? ' ｜ 时长 ' + Util.fmtDuration(dur) : ' ｜ 进行中') +
            (interval != null ? ' ｜ 距上次 ' + Util.fmtDuration(interval) : '') +
            '</span><button class="icon-btn" data-del="' + c.id + '" aria-label="删除" title="删除">' + icon('trash') + '</button></li>';
        }
        html += '</ul>';
        html += '<button class="btn" id="cExport">导出时间线（文本）</button> ';
        html += '<button class="btn" id="cExportJson">导出 JSON</button>';
      } else {
        html += '<p class="hint">暂无记录</p>';
      }
      html += '</div>';

      view.innerHTML = html;
      cTick();

      var cStart = view.querySelector('#cStart');
      if (cStart) cStart.addEventListener('click', function () {
        d.openContraction = { id: Util.uid(), start: Util.nowLocal() };
        Storage.save(); global.App.rerender();
      });
      var cEnd = view.querySelector('#cEnd');
      if (cEnd) cEnd.addEventListener('click', function () {
        d.openContraction.end = Util.nowLocal();
        d.contractions.push(d.openContraction);
        d.openContraction = null;
        Storage.save(); global.App.rerender();
      });
      var cCancel = view.querySelector('#cCancel');
      if (cCancel) cCancel.addEventListener('click', function () {
        d.openContraction = null; Storage.save(); global.App.rerender();
      });
      var cExp = view.querySelector('#cExport');
      if (cExp) cExp.addEventListener('click', function () { exportTimeline(false); });
      var cExpJ = view.querySelector('#cExportJson');
      if (cExpJ) cExpJ.addEventListener('click', function () { exportTimeline(true); });

      Array.prototype.forEach.call(view.querySelectorAll('[data-del]'), function (b) {
        b.addEventListener('click', function () {
          var id = b.getAttribute('data-del');
          Util.removeWithUndo(d.contractions, id, {
            onSave: function () { if (d.openContraction && d.openContraction.id === id) d.openContraction = null; Storage.save(); },
            onAfter: function () { global.App.rerender(); },
            deletedText: '已删除宫缩记录'
          });
        });
      });

      function exportTimeline(json) {
        var arr = d.contractions.slice().sort(function (a, b) { return new Date(a.start) - new Date(b.start); });
        if (json) {
          Util.download('宫缩时间线_' + Util.todayISO() + '.json', JSON.stringify(arr, null, 2), 'application/json');
        } else {
          var lines = ['宝妈助手 宫缩时间线（仅供参考）', '生成时间：' + Util.nowLocal(), ''];
          for (var i = 0; i < arr.length; i++) {
            var cc = arr[i];
            var dur = cc.end ? Util.fmtDuration(new Date(cc.end).getTime() - new Date(cc.start).getTime()) : '未结束';
            var iv = i > 0 ? Util.fmtDuration(new Date(cc.start).getTime() - new Date(arr[i - 1].start).getTime()) : '-';
            lines.push('第' + (i + 1) + '次 开始 ' + Util.fmtDateTime(cc.start) + ' 时长 ' + dur + ' 距上次 ' + iv);
          }
          Util.download('宫缩时间线_' + Util.todayISO() + '.txt', lines.join('\n'), 'text/plain;charset=utf-8');
        }
      }
    }
  };

  setInterval(cTick, 1000);
})(window);
