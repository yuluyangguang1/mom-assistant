/**
 * calendar.js - 日期记录（底部 Tab 入口）
 * 月历标记有记录的日期，点选某天查看当日各模块明细；可翻月、回今天。
 * 与首页共用 Util.buildDayIndex，确保数据聚合单一来源。
 */
(function (global) {
  'use strict';
  var Storage = global.Storage, Util = global.Util;
  var Modules = global.Modules = global.Modules || {};

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  Modules.calendar = {
    id: 'calendar',
    title: '日期记录',
    render: function (view) {
      var d = Storage.get();
      var today = Util.todayISO();
      var dayIdx = Util.buildDayIndex(d);
      var now = new Date();
      var calState = { y: now.getFullYear(), m: now.getMonth(), sel: today };

      var html = '';
      html += '<div class="page-head"><h1>' + icon('calendar') + '日期记录</h1>'
        + '<p>记录每天的小确幸。有数据的日子会被点亮，点一下看当天详情。</p></div>';
      html += '<div class="card cal-page"><div id="calWrap"></div></div>';

      view.innerHTML = html;

      var calWrap = view.querySelector('#calWrap');

      function paintCalendar() {
        var y = calState.y, m = calState.m;
        var first = new Date(y, m, 1);
        var startW = first.getDay();
        var daysInMonth = new Date(y, m + 1, 0).getDate();
        var cells = [];
        for (var i = 0; i < startW; i++) cells.push(null);
        for (var day = 1; day <= daysInMonth; day++) cells.push(day);

        var out = '';
        out += '<div class="cal-head"><span class="cal-title">' + y + ' 年 ' + (m + 1) + ' 月</span><span class="cal-nav">'
          + '<button type="button" data-cal="prev" aria-label="上个月">‹</button>'
          + '<button type="button" data-cal="today" aria-label="回到今天">今</button>'
          + '<button type="button" data-cal="next" aria-label="下个月">›</button>'
          + '</span></div>';
        out += '<div class="cal-week"><span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span></div>';
        out += '<div class="cal-grid">';
        cells.forEach(function (c) {
          if (c === null) { out += '<span class="cal-cell is-empty"></span>'; return; }
          var iso = y + '-' + pad(m + 1) + '-' + pad(c);
          var cls = 'cal-cell';
          if (iso === today) cls += ' is-today';
          if (iso === calState.sel) cls += ' is-sel';
          var dayItems = dayIdx[iso] || [];
          /* 当天涉及的模块去重后渲染分色小圆点（最多 3 个，颜色由 data-accent 驱动） */
          var dots = '';
          if (dayItems.length) {
            var mods = [];
            dayItems.forEach(function (it) { if (it.icon && mods.indexOf(it.icon) < 0) mods.push(it.icon); });
            dots = '<span class="cal-dots">';
            mods.slice(0, 3).forEach(function (mm) { dots += '<i class="cal-dot" data-accent="' + mm + '"></i>'; });
            dots += '</span>';
          }
          out += '<button type="button" class="' + cls + '" data-day="' + iso + '">' + c + dots + '</button>';
        });
        out += '</div>';

        /* 当日记录明细 */
        var items = dayIdx[calState.sel] || [];
        out += '<div class="day-detail">';
        out += '<h3>' + (calState.sel === today ? '今天' : calState.sel) + ' 的记录</h3>';
        if (items.length) {
          out += '<ul class="day-list">';
          items.forEach(function (it) {
            out += '<li data-accent="' + Util.escapeHtml(it.icon || '') + '">' + icon(it.icon) + '<span class="dl-label">' + it.label + '</span><span class="dl-val">' + Util.escapeHtml(it.val || '') + '</span></li>';
          });
          out += '</ul><div class="day-total">共 ' + items.length + ' 条</div>';
        } else {
          out += '<p class="day-empty">这一天还没有记录，去记录一下吧。</p>';
        }
        out += '</div>';

        calWrap.innerHTML = out;

        Array.prototype.forEach.call(calWrap.querySelectorAll('[data-cal]'), function (b) {
          b.addEventListener('click', function () {
            var a = b.getAttribute('data-cal');
            if (a === 'prev') { calState.m--; if (calState.m < 0) { calState.m = 11; calState.y--; } }
            else if (a === 'next') { calState.m++; if (calState.m > 11) { calState.m = 0; calState.y++; } }
            else if (a === 'today') { calState.y = now.getFullYear(); calState.m = now.getMonth(); calState.sel = today; }
            paintCalendar();
          });
        });
        Array.prototype.forEach.call(calWrap.querySelectorAll('[data-day]'), function (b) {
          b.addEventListener('click', function () { calState.sel = b.getAttribute('data-day'); paintCalendar(); });
        });
      }
      paintCalendar();
    }
  };
})(window);
