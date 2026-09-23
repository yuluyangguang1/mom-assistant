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
      var today = Util.todayISO();
      var html = '';

      /* 今日统计 + 母乳换边建议（放最上面，一眼看到） */
      var feedToday = d.feedings.filter(function (r) { return (r.start || '').slice(0, 10) === today; });
      var sorted = d.feedings.slice().sort(function (a, b) { return new Date(b.start) - new Date(a.start); });
      var latest = sorted[0];
      var lastBreast = sorted.filter(function (r) { return r.type === 'breast' && r.side; })[0];
      html += '<div class="card"><h2>' + icon('feeding') + '今日概览</h2>';
      if (feedToday.length || latest) {
        html += '<div class="stat-row">';
        html += '<div class="stat"><span class="stat-num">' + feedToday.length + '<i class="stat-unit">次</i></span><span class="stat-lbl">今日喂养</span></div>';
        var totalAmt = feedToday.reduce(function (s, r) { return s + (r.amount || 0); }, 0);
        if (totalAmt) html += '<div class="stat"><span class="stat-num">' + totalAmt + '<i class="stat-unit">ml/g</i></span><span class="stat-lbl">今日总量</span></div>';
        if (latest) {
          var gap = Math.max(0, Math.floor((Date.now() - new Date(latest.start).getTime()) / 60000));
          var gNum = gap >= 60 ? Math.floor(gap / 60) : gap;
          var gUnit = gap >= 60 ? '小时' : '分';
          html += '<div class="stat"><span class="stat-num">' + gNum + '<i class="stat-unit">' + gUnit + '</i></span><span class="stat-lbl">距上次</span></div>';
        }
        html += '</div>';
        if (lastBreast && lastBreast.side !== 'both') {
          var nextSide = lastBreast.side === 'left' ? '右' : '左';
          html += '<p class="hint">上次喂的是<b>' + (lastBreast.side === 'left' ? '左' : '右') + '侧</b>，这次建议先喂 <b>' + nextSide + '侧</b>，两侧均衡不易堵奶。</p>';
        }
      } else {
        html += '<p class="hint">今天还没有喂养记录。</p>';
      }
      html += '</div>';

      html += '<div class="card"><h2>' + icon('feeding') + '快速记录</h2>';
      html += '<div class="seg" id="fType">';
      TYPES.forEach(function (t, i) {
        html += '<button type="button" class="seg-btn' + (i === 0 ? ' active' : '') + '" data-t="' + t.v + '">' + icon(t.v) + t.t + '</button>';
      });
      html += '</div>';
      /* 母乳左右侧（换边喂养防堵奶，母乳喂养刚需） */
      html += '<div id="lblSide"><span class="lbl-text">本次侧别</span><div class="seg" id="fSide">'
        + '<button type="button" class="seg-btn active" data-side="left">左侧</button>'
        + '<button type="button" class="seg-btn" data-side="right">右侧</button>'
        + '<button type="button" class="seg-btn" data-side="both">双侧</button>'
        + '</div></div>';
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
          var sideTxt = (r.type === 'breast' && r.side)
            ? (r.side === 'left' ? '左侧' : (r.side === 'right' ? '右侧' : '双侧')) : '';
          html += '<li><span class="row-ico">' + icon(r.type) + '</span><span>' + Util.fmtDateTime(r.start) + ' ｜ ' + typeName +
            (sideTxt ? ' ｜ ' + sideTxt : '') + (detail ? ' ｜ ' + detail : '') + (r.note ? ' ｜ ' + Util.escapeHtml(r.note) : '') +
            '</span><button class="icon-btn" data-del="' + r.id + '" aria-label="删除" title="删除">' + icon('trash') + '</button></li>';
        });
        html += '</ul>';
      } else {
        html += '<p class="hint">暂无</p>';
      }
      html += '</div>';

      view.innerHTML = html;

      var type = 'breast';
      var side = 'left';
      function syncType() {
        var isBreast = (type === 'breast');
        view.querySelector('#lblDur').style.display = isBreast ? '' : 'none';
        view.querySelector('#lblAmt').style.display = isBreast ? 'none' : '';
        view.querySelector('#lblSide').style.display = isBreast ? '' : 'none';
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
      Array.prototype.forEach.call(view.querySelectorAll('#fSide .seg-btn'), function (b) {
        b.addEventListener('click', function () {
          side = b.getAttribute('data-side');
          Array.prototype.forEach.call(view.querySelectorAll('#fSide .seg-btn'), function (x) { x.classList.remove('active'); });
          b.classList.add('active');
        });
      });

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
          side: type === 'breast' ? side : null,
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
