/**
 * meds.js - 吃药 / 维生素 D 记录
 * 新生儿期最常见的是每天一滴维生素 D3，偶尔有 AD、益生菌、铁剂。
 * 设计：预设项一键即记（同尿布的大按钮思路），「其他」可自定义名称。
 */
(function (global) {
  'use strict';
  var Storage = global.Storage, Util = global.Util;
  var Modules = global.Modules = global.Modules || {};

  var PRESETS = ['维生素 D3', '维生素 AD', '益生菌', '铁剂'];

  Modules.meds = {
    id: 'meds',
    title: '吃药/维D',
    render: function (view) {
      var d = Storage.get();
      var today = Util.todayISO();
      var html = '';

      /* 一键快记：预设项大按钮 */
      html += '<div class="card"><h2>' + icon('meds') + '一键记录</h2>';
      html += '<p class="hint">喂完点一下，自动记下现在的时间。</p>';
      html += '<div class="quick-row">';
      PRESETS.forEach(function (p) {
        html += '<button type="button" class="quick-btn" data-quick="' + p + '">'
          + '<span class="quick-ico">' + icon('meds') + '</span><span>' + p + '</span></button>';
      });
      html += '</div>';
      html += '<div class="row" style="margin-top:10px">'
        + '<input type="text" id="mCustom" placeholder="其他（如 退烧药 2ml）" style="flex:1">'
        + '<button type="button" class="btn" id="mCustomSave">记录</button></div>';
      html += '</div>';

      /* 今日小结 */
      var todayList = (d.meds || []).filter(function (r) { return (r.time || '').slice(0, 10) === today; });
      html += '<div class="card"><h2>' + icon('meds') + '今日小结</h2>';
      if (todayList.length) {
        var names = {};
        todayList.forEach(function (r) { names[r.name] = (names[r.name] || 0) + 1; });
        var parts = Object.keys(names).map(function (n) { return n + (names[n] > 1 ? ' ×' + names[n] : ''); });
        html += '<p>今日已服 <b>' + todayList.length + '</b> 次：' + parts.join('、') + '</p>';
      } else {
        html += '<p class="hint">今天还没有服药记录。</p>';
      }
      html += '</div>';

      /* 最近记录 */
      html += '<div class="card"><h2>' + icon('meds') + '最近记录</h2>';
      var list = (d.meds || []).slice().sort(function (a, b) { return new Date(b.time) - new Date(a.time); }).slice(0, 20);
      if (list.length) {
        html += '<ul class="list">';
        list.forEach(function (r) {
          html += '<li><span class="row-ico">' + icon('meds') + '</span><span>' + Util.fmtDateTime(r.time) + ' ｜ ' + Util.escapeHtml(r.name)
            + (r.note ? ' ｜ ' + Util.escapeHtml(r.note) : '')
            + '</span><button class="icon-btn" data-del="' + r.id + '" aria-label="删除" title="删除">' + icon('trash') + '</button></li>';
        });
        html += '</ul>';
      } else {
        html += '<p class="hint">暂无记录，点上方按钮记一次吧。</p>';
      }
      html += '</div>';

      view.innerHTML = html;

      function record(name) {
        if (!name) return;
        d.meds.push({ id: Util.uid(), name: name, time: Util.nowLocal(), note: null });
        if (Storage.save()) Util.toast('已记录：' + name, 'ok');
        global.App.rerender();
      }
      Array.prototype.forEach.call(view.querySelectorAll('[data-quick]'), function (b) {
        b.addEventListener('click', function () { record(b.getAttribute('data-quick')); });
      });
      view.querySelector('#mCustomSave').addEventListener('click', function () {
        var inp = view.querySelector('#mCustom');
        var name = (inp.value || '').trim();
        if (!name) { Util.markInvalid(inp, '请填写名称'); return; }
        record(name);
      });
      Array.prototype.forEach.call(view.querySelectorAll('[data-del]'), function (b) {
        b.addEventListener('click', function () {
          Util.removeWithUndo(d.meds, b.getAttribute('data-del'), {
            onSave: function () { Storage.save(); },
            onAfter: function () { global.App.rerender(); },
            deletedText: '已删除服药记录'
          });
        });
      });
    }
  };
})(window);
