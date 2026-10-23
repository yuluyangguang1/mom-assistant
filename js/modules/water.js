/**
 * water.js - 饮水记录（第 132 次 · 对标 Cali 21 工具里的 water-tracker）
 *
 * 定位：辅食期之后才开始有意义的记录。**不做「每日应喝多少毫升」的达标线**——
 * 需水量按体重、天气、活动量和辅食含水量变化，个体差异极大，给死数字只会误导（U-25）。
 * 页面只做「今天喝了多少」的累计与留痕。
 * 数据：d.waters = [{ id, time, ml, note }]。
 */
(function (global) {
  'use strict';
  var Storage = global.Storage, Util = global.Util;
  var Modules = global.Modules = global.Modules || {};

  var QUICK = [30, 50, 100, 150]; /* 常见杯子/学饮杯容量档位 */

  Modules.water = {
    id: 'water',
    title: '饮水',
    render: function (view) {
      var d = Storage.get();
      var DS = Util.dayStartHour(d);
      var dayNow = Util.dayKeyOf(new Date(), DS);
      var all = d.waters || [];
      var html = '';

      html += '<div class="warn-box"><p><b>6 月龄内纯母乳或配方奶喂养的宝宝，通常不需要额外喂水</b>；' +
        '开始添加辅食后再逐步引入。天气热、出汗多时怎么补，请问儿保医生。</p></div>';

      var todayList = all.filter(function (r) { return Util.dayKeyOf(r.time, DS) === dayNow; });
      var todayMl = todayList.reduce(function (s, r) {
        return s + (typeof r.ml === 'number' && isFinite(r.ml) ? r.ml : 0);
      }, 0);

      /* 今日累计：大数字主角 */
      html += '<div class="card"><h2>今天喝了</h2>';
      html += '<div class="fetal-hero"><span class="stat-num">' + todayMl + '<i class="stat-unit">ml</i></span>' +
        '<span class="hint">共 ' + todayList.length + ' 次</span></div>';
      html += '<div class="water-quick">';
      QUICK.forEach(function (ml) {
        html += '<button type="button" class="btn btn-mini" data-ml="' + ml + '">+' + ml + '</button>';
      });
      html += '</div>';
      html += '<label>自定义（ml）<input type="number" id="waMl" min="1" max="500" inputmode="numeric" ' +
        'placeholder="如 80"></label>';
      html += '<label>备注（可选）<input type="text" id="waNote" maxlength="40" ' +
        'placeholder="如 用学饮杯 / 喝了半杯"></label>';
      html += '<button class="btn btn-primary btn-save" id="waSave">记一次</button>';
      html += '<p class="hint">只统计喝进去的水，冲奶粉用的水不算在内。</p></div>';

      /* 最近记录 */
      html += '<div class="card"><h2>最近记录</h2>';
      var list = all.slice().sort(function (a, b) { return new Date(b.time) - new Date(a.time); }).slice(0, 20);
      if (list.length) {
        html += '<ul class="list">';
        list.forEach(function (r) {
          html += '<li><span class="row-ico">' + icon('water') + '</span>'
            + '<span class="li-main"><b>' + Util.fmtDateTime(r.time) + '</b></span>'
            + '<span class="li-sub">' + (r.note ? Util.escapeHtml(r.note) : '') + '</span>'
            + '<span class="li-num">' + (typeof r.ml === 'number' && isFinite(r.ml) ? r.ml + '<i>ml</i>' : '<i>—</i>') + '</span>'
            + '<button class="icon-btn" data-del="' + r.id + '" aria-label="删除" title="删除">' +
            icon('trash') + '</button></li>';
        });
        html += '</ul>';
      } else {
        html += '<div class="empty-state"><span class="es-ico">' + icon('water') + '</span><p>还没有饮水记录</p><span class="hint">宝宝喝水后点上面的快捷按钮即可。</span></div>';
      }
      html += '</div>';

      view.innerHTML = html;

      function add(ml) {
        var rec = {
          id: Util.uid(), time: Util.nowLocal(), ml: ml,
          note: (view.querySelector('#waNote').value || '').trim() || null
        };
        d.waters.push(rec);
        if (Storage.save()) Util.toast('已记 ' + ml + ' ml', 'ok');
        global.App.rerender();
      }

      Array.prototype.forEach.call(view.querySelectorAll('[data-ml]'), function (b) {
        b.addEventListener('click', function () { add(parseInt(b.getAttribute('data-ml'), 10)); });
      });

      view.querySelector('#waSave').addEventListener('click', function () {
        var el = view.querySelector('#waMl');
        var ml = parseInt(el.value, 10);
        if (!isFinite(ml) || ml <= 0 || ml > 500) {
          Util.markInvalid(el, '请填 1–500 之间的毫升数');
          return;
        }
        add(ml);
      });

      Array.prototype.forEach.call(view.querySelectorAll('[data-del]'), function (b) {
        b.addEventListener('click', function () {
          Util.removeWithUndo(d.waters, b.getAttribute('data-del'), {
            onSave: function () { Storage.save(); },
            onAfter: function () { global.App.rerender(); },
            deletedText: '已删除饮水记录'
          });
        });
      });
    }
  };
})(window);
