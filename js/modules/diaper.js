/**
 * diaper.js - 换尿布记录（产后「吃睡拉」三大日常之一）
 * 一键快记：尿 / 便 / 混合，点一下即记下当前时间；可补备注。
 * 设计理由：新生儿期换尿布场景单手操作、时间紧迫，不做表单，做「大按钮即记」。
 */
(function (global) {
  'use strict';
  var Storage = global.Storage, Util = global.Util;
  var Modules = global.Modules = global.Modules || {};

  var TYPES = [
    { v: 'pee', t: '尿', icon: 'pee' },
    { v: 'poop', t: '便', icon: 'poop' },
    { v: 'both', t: '尿+便', icon: 'diaper' }
  ];

  function typeInfo(v) {
    for (var i = 0; i < TYPES.length; i++) if (TYPES[i].v === v) return TYPES[i];
    return { v: v, t: v, icon: 'diaper' };
  }

  Modules.diaper = {
    id: 'diaper',
    title: '换尿布',
    render: function (view) {
      var d = Storage.get();
      var today = Util.todayISO();
      var html = '';

      /* 一键快记：三个大按钮，按下即保存当前时间 */
      html += '<div class="card"><h2>' + icon('diaper') + '一键记录</h2>';
      html += '<p class="hint">换完尿布点一下，自动记下现在的时间。</p>';
      html += '<div class="quick-row">';
      TYPES.forEach(function (t) {
        html += '<button type="button" class="quick-btn" data-quick="' + t.v + '">'
          + '<span class="quick-ico">' + icon(t.icon) + '</span><span>' + t.t + '</span></button>';
      });
      html += '</div></div>';

      /* 今日小结 */
      var todayList = (d.diapers || []).filter(function (r) { return (r.time || '').slice(0, 10) === today; });
      var peeN = todayList.filter(function (r) { return r.type === 'pee' || r.type === 'both'; }).length;
      var poopN = todayList.filter(function (r) { return r.type === 'poop' || r.type === 'both'; }).length;
      var latest = (d.diapers || []).slice().sort(function (a, b) { return new Date(b.time) - new Date(a.time); })[0];
      html += '<div class="card"><h2>' + icon('diaper') + '今日小结</h2>';
      if (todayList.length) {
        html += '<div class="stat-row">'
          + '<div class="stat"><span class="stat-num">' + todayList.length + '<i class="stat-unit">次</i></span><span class="stat-lbl">今日共换</span></div>'
          + '<div class="stat"><span class="stat-num">' + peeN + '<i class="stat-unit">次</i></span><span class="stat-lbl">有尿</span></div>'
          + '<div class="stat"><span class="stat-num">' + poopN + '<i class="stat-unit">次</i></span><span class="stat-lbl">有便</span></div>'
          + '</div>';
        if (latest) html += '<p class="hint">上次：' + Util.fmtDateTime(latest.time) + '（' + typeInfo(latest.type).t + '）</p>';
      } else {
        html += '<p class="hint">今天还没有换尿布记录。</p>';
      }
      html += '</div>';

      /* 最近记录 */
      html += '<div class="card"><h2>' + icon('diaper') + '最近记录</h2>';
      var list = (d.diapers || []).slice().sort(function (a, b) { return new Date(b.time) - new Date(a.time); }).slice(0, 20);
      if (list.length) {
        html += '<ul class="list">';
        list.forEach(function (r) {
          var ti = typeInfo(r.type);
          html += '<li><span class="row-ico">' + icon(ti.icon) + '</span><span>' + Util.fmtDateTime(r.time) + ' ｜ ' + ti.t
            + (r.note ? ' ｜ ' + Util.escapeHtml(r.note) : '')
            + '</span><button class="icon-btn" data-del="' + r.id + '" aria-label="删除" title="删除">' + icon('trash') + '</button></li>';
        });
        html += '</ul>';
      } else {
        html += '<p class="hint">暂无记录，点上方按钮记一次吧。</p>';
      }
      html += '</div>';

      view.innerHTML = html;

      Array.prototype.forEach.call(view.querySelectorAll('[data-quick]'), function (b) {
        b.addEventListener('click', function () {
          d.diapers.push({ id: Util.uid(), type: b.getAttribute('data-quick'), time: Util.nowLocal(), note: null });
          if (Storage.save()) Util.toast('已记录：' + typeInfo(b.getAttribute('data-quick')).t, 'ok');
          global.App.rerender();
        });
      });
      Array.prototype.forEach.call(view.querySelectorAll('[data-del]'), function (b) {
        b.addEventListener('click', function () {
          Util.removeWithUndo(d.diapers, b.getAttribute('data-del'), {
            onSave: function () { Storage.save(); },
            onAfter: function () { global.App.rerender(); },
            deletedText: '已删除尿布记录'
          });
        });
      });
    }
  };
})(window);
