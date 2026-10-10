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

      /* C7 补记：一次性日期覆盖（App.pendingDate，读取即消费） */
      var backfill = (global.App && App.pendingDate) ? App.pendingDate : null;
      if (global.App) global.App.pendingDate = null;

      /* 一键快记：三个大按钮，按下即保存当前时间 */
      html += '<div class="card"><h2>一键记录</h2>';
      html += backfill
        ? '<p class="hint"><b>补记模式</b>：这条会记到 ' + Util.fmtDate(backfill) + '。</p>'
        : '<p class="hint">换完尿布点一下，自动记下现在的时间。</p>';
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
      html += '<div class="card"><h2>今日小结</h2>';
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
      html += '<div class="card"><h2>最近记录</h2>';
      var list = (d.diapers || []).slice().sort(function (a, b) { return new Date(b.time) - new Date(a.time); }).slice(0, 20);
      if (list.length) {
        html += '<ul class="list">';
        list.forEach(function (r) {
          var ti = typeInfo(r.type);
          /* 第 61 次：行改「左时间+类型 / 右备注」双列 */
          html += '<li><span class="row-ico">' + icon(ti.icon) + '</span>'
            + '<span class="li-main"><b>' + Util.fmtRowTime(r.time) + '</b>' + ti.t + '</span>'
            + '<span class="li-sub">' + (r.note ? Util.escapeHtml(r.note) : '') + '</span>'
            + '<button class="btn btn-mini" data-note="' + r.id + '">' + (r.note ? '改备注' : '备注') + '</button>'
            + '<button class="icon-btn" data-del="' + r.id + '" aria-label="删除" title="删除">' + icon('trash') + '</button></li>';
        });
        html += '</ul>';
      } else {
        html += '<div class="empty-state"><p>暂无记录</p><span class="hint">点上方按钮记一次吧。</span></div>';
      }
      html += '</div>';

      view.innerHTML = html;

      Array.prototype.forEach.call(view.querySelectorAll('[data-quick]'), function (b) {
        b.addEventListener('click', function () {
          var rec = { id: Util.uid(), type: b.getAttribute('data-quick'), time: (backfill || today) + Util.nowLocal().slice(10), note: null };
          d.diapers.push(rec);
          if (Storage.save()) {
            /* C2：单手误触高发场景——撤销 = 直接移除刚落库的这条 */
            Util.toast('已记录：' + typeInfo(rec.type).t, 'ok', { label: '撤销', onClick: function () {
              for (var i = d.diapers.length - 1; i >= 0; i--) {
                if (d.diapers[i].id === rec.id) { d.diapers.splice(i, 1); break; }
              }
              Storage.save(); global.App.rerender(); Util.toast('已撤销', 'ok');
            } });
          }
          global.App.rerender();
        });
      });
      /* P2-14：行内补备注（数据本有 note 字段，此前无写入入口） */
      Array.prototype.forEach.call(view.querySelectorAll('[data-note]'), function (b) {
        b.addEventListener('click', function () {
          var it = d.diapers.filter(function (x) { return x.id === b.getAttribute('data-note'); })[0];
          if (!it) return;
          Util.editText({
            title: '补一句备注',
            message: Util.fmtDateTime(it.time) + '（' + typeInfo(it.type).t + '）',
            value: it.note || '', placeholder: '如 便偏稀 / 换了新码', maxlength: 40, okText: '保存备注',
            onConfirm: function (v) {
              it.note = v || null;
              if (Storage.save()) Util.toast(v ? '备注已保存' : '备注已清除', 'ok');
              global.App.rerender();
            }
          });
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
