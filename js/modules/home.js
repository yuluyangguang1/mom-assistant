/**
 * home.js - 首页（天空背景 + 模块化记录）
 * 顶部：Web 版 swiftui-sky 动态天空（由本地时间/季节驱动，纯程序化、零网络）
 * 左上角宝宝头像在全局 header（点击进设置）。
 * 主体：今日概览 + 模块记录磁贴（点击进模块）。
 * 每日记录日历已独立为底部「日期记录」整页，不在首页内嵌。
 */
(function (global) {
  'use strict';
  var Storage = global.Storage, Util = global.Util;
  var Modules = global.Modules = global.Modules || {};

  function countToday(arr, key) {
    var t = Util.todayISO();
    return (arr || []).filter(function (x) { return (x[key] || '').slice(0, 10) === t; }).length;
  }
  function isoOf(s) { return (s || '').slice(0, 10); }
  function fmtMoney(n) { return '¥' + (Math.round(n * 100) / 100); }

  function pregnancyWeek(d) {
    var pg = d.pregnancy;
    if (!pg || !(pg.lmp || pg.dueDate)) return null;
    var base = pg.lmp || Util.addDays(pg.dueDate, -280);
    return Math.max(0, Math.floor(Util.daysBetween(base, Util.todayISO()) / 7));
  }
  function dueLeft(d) {
    var pg = d.pregnancy;
    if (!pg || !(pg.lmp || pg.dueDate)) return null;
    var due = pg.dueDate ? pg.dueDate : Util.addDays(pg.lmp, 280);
    return Util.daysBetween(Util.todayISO(), due);
  }

  Modules.home = {
    id: 'home',
    title: '首页',
    render: function (view) {
      var d = Storage.get();
      var today = Util.todayISO();

      /* 问候语 */
      var greetSub = '今天也要好好照顾自己和宝宝。';
      var dl = dueLeft(d);
      if (dl !== null) {
        if (dl > 0) greetSub = '距离预产期还有 ' + dl + ' 天，记得好好休息。';
        else if (dl >= -30) greetSub = '宝宝正在来到你身边，加油。';
        else greetSub = '欢迎新生命，享受这段时光。';
      }

      /* 模块记录摘要 */
      var feedToday = countToday(d.feedings, 'start');
      var diaperToday = countToday(d.diapers, 'time');
      var contraToday = countToday(d.contractions, 'start');
      var sleepRecent = (d.sleeps || []).filter(function (s) { return s.end; })
        .sort(function (a, b) { return new Date(b.start) - new Date(a.start); })[0];
      var weightRecent = (d.growth || []).slice()
        .sort(function (a, b) { return new Date(b.date) - new Date(a.date); })[0];
      var wk = pregnancyWeek(d);
      var pk = (d.packing && d.packing.items) ? d.packing.items : [];
      var pkDone = pk.filter(function (x) { return x.checked; }).length;
      var pkPct = pk.length ? Math.round(pkDone / pk.length * 100) : 0;
      var periods = d.periods || [];
      var ongoing = periods.filter(function (p) { return p.start && (!p.end || p.end >= today); })[0];
      var periodInfo = '未记录';
      if (ongoing) periodInfo = '经期第 ' + (Util.daysBetween(isoOf(ongoing.start), today) + 1) + ' 天';
      else if (periods.length) periodInfo = '上次 ' + Util.daysBetween(isoOf(periods[periods.length - 1].start), today) + ' 天前';
      var ym = today.slice(0, 7);
      var monthSum = ((d.finance && d.finance.records) || [])
        .filter(function (r) { return (r.date || '').slice(0, 7) === ym; })
        .reduce(function (s, r) { return s + (parseFloat(r.amount) || 0); }, 0);

      /* 疫苗进度（有生日才显示摘要） */
      var vaxInfo = '未设置生日';
      var vaxBadge = '';
      if (global.Modules && Modules.vaccine && typeof Modules.vaccine._plan === 'function'
          && d.settings.baby && d.settings.baby.birthDate) {
        var vItems = Modules.vaccine._plan(d.settings.baby.birthDate);
        var vDone = (d.vaccines && d.vaccines.done) || {};
        var vDoneN = vItems.filter(function (it) { return vDone[it.key]; }).length;
        var vNext = vItems.filter(function (it) { return !vDone[it.key]; })
          .sort(function (a, b) { return new Date(a.dueISO) - new Date(b.dueISO); })[0];
        vaxInfo = vDoneN + '/' + vItems.length + ' 剂';
        if (vNext) vaxBadge = Util.daysBetween(today, vNext.dueISO) <= 7 ? '临近' : '';
        else { vaxInfo = '全部完成'; }
      }

      var tiles = [
        { id: 'feeding', name: '喂养', accent: 'feeding', sum: feedToday ? ('今日 ' + feedToday + ' 次') : '暂无今日', badge: feedToday ? String(feedToday) : '' },
        { id: 'diaper', name: '尿布', accent: 'diaper', sum: diaperToday ? ('今日 ' + diaperToday + ' 次') : '暂无今日', badge: diaperToday ? String(diaperToday) : '' },
        { id: 'sleep', name: '睡眠', accent: 'sleep', sum: sleepRecent ? ('最近 ' + Util.fmtDuration(new Date(sleepRecent.end) - new Date(sleepRecent.start) - (sleepRecent.pausedMs || 0))) : '暂无' },
        { id: 'growth', name: '生长', accent: 'growth', sum: weightRecent ? ('最近 ' + weightRecent.weightKg + ' kg') : '暂无' },
        { id: 'vaccine', name: '疫苗', accent: 'vaccine', sum: vaxInfo, badge: vaxBadge },
        { id: 'period', name: '经期', accent: 'period', sum: periodInfo },
        { id: 'pregnancy', name: '孕期', accent: 'pregnancy', sum: wk !== null ? ('第 ' + wk + ' 周') : '未设置', badge: wk !== null ? String(wk) : '' },
        { id: 'packing', name: '待产包', accent: 'packing', sum: pk.length ? ('已备 ' + pkPct + '%') : '未开始', badge: pk.length ? (pkPct + '%') : '' },
        { id: 'contraction', name: '宫缩', accent: 'contraction', sum: contraToday ? ('今日 ' + contraToday + ' 次') : '暂无今日', badge: contraToday ? String(contraToday) : '' },
        { id: 'finance', name: '记账', accent: 'finance', sum: monthSum ? ('本月 ' + fmtMoney(monthSum)) : '本月无' }
      ];

      var html = '';
      /* 顶部天空背景 + 问候 */
      html += '<section class="home-sky">'
        + '<canvas id="skyCanvas" class="sky-canvas" aria-hidden="true"></canvas>'
        + '<div class="sky-veil"></div>'
        + '<div class="home-greet"><h1>你好，妈妈</h1><p>' + Util.escapeHtml(greetSub) + '</p></div>'
        + '</section>';

      /* 主体（单列，模块磁贴占满宽度） */
      html += '<div class="home-main">';

      /* 本地提醒卡：基于「当前时间 × 已有数据」的温和注意（喂养间隔/计时进行中/经期临近/待产包/备份）。
         有提醒才渲染，无提醒不占位。 */
      if (global.Reminders) {
        var rems = Reminders.evaluate(d);
        if (rems.length) {
          html += '<div class="card remind-card"><h2>' + icon('bell') + '提醒</h2><ul class="list remind-list">';
          rems.forEach(function (r) {
            html += '<li data-accent="' + r.accent + '" data-go="' + r.go + '" role="button" tabindex="0">'
              + '<span class="row-ico">' + icon(r.accent === 'finance' ? 'export' : r.accent) + '</span>'
              + '<span>' + r.text + '</span></li>';
          });
          html += '</ul></div>';
        }
      }

      /* 今日概览：迷你统计卡（关键数字做主角） */
      var stats = [];
      stats.push({ num: feedToday, lbl: '今日喂养', unit: '次' });
      stats.push({ num: diaperToday, lbl: '今日尿布', unit: '次' });
      stats.push({ num: contraToday, lbl: '今日宫缩', unit: '次' });
      if (wk !== null) stats.push({ num: wk, lbl: '当前孕周', unit: '周' });
      if (pk.length) stats.push({ num: pkPct, lbl: '待产包', unit: '%' });
      html += '<div class="card"><h2>今日概览</h2>';
      if (stats.length) {
        html += '<div class="stat-row">';
        stats.forEach(function (s) {
          html += '<div class="stat"><span class="stat-num">' + s.num + '<i class="stat-unit">' + s.unit + '</i></span><span class="stat-lbl">' + s.lbl + '</span></div>';
        });
        html += '</div>';
      } else {
        html += '<p class="hint">今天还没有记录，点下方模块记一笔吧。</p>';
      }
      html += '</div>';

      /* 模块记录磁贴（按功能分色 + 今日角标） */
      html += '<h2 class="section-title">模块记录</h2><div class="record-grid">';
      tiles.forEach(function (t) {
        html += '<button class="record-tile" data-accent="' + t.accent + '" data-go="' + t.id + '" type="button">'
          + '<span class="rt-ico">' + icon(t.id) + '</span>'
          + (t.badge ? '<span class="rt-badge">' + t.badge + '</span>' : '')
          + '<span class="rt-name">' + t.name + '</span>'
          + '<span class="rt-sum">' + t.sum + '</span>'
          + '</button>';
      });
      html += '</div>';

      html += '<div class="card hint"><p>所有数据仅存本机浏览器，不联网、不共享。换机请用「设置-导出数据」备份。</p></div>';
      html += '</div>'; /* /.home-main */

      view.innerHTML = html;

      /* 模块记录 → 对应模块 */
      Array.prototype.forEach.call(view.querySelectorAll('[data-go]'), function (b) {
        b.addEventListener('click', function () { global.App.showTab(b.getAttribute('data-go')); });
      });

      /* 启动天空（离开首页时 canvas 被移除，循环自动停止） */
      var canvas = view.querySelector('#skyCanvas');
      if (global.Sky && canvas) global.Sky.mount(canvas);
    }
  };
})(window);
