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

  /* U-26 周 / 月回顾：本地生成、只拿自己的数据自比（U-24），不设达标线、不做红色告警（U-25）。
     统计口径是「你已经记下来的内容」，不是「你该记多少」——漏记不清零、不影响任何累计（U-11）。 */
  function rangeStats(dayIdx, from, to) {
    var days = 0, items = 0;
    var cur = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    var end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
    while (cur <= end) {
      var arr = dayIdx[Util.fmtDate(cur)] || [];
      if (arr.length) { days++; items += arr.length; }
      cur.setDate(cur.getDate() + 1);
    }
    return { days: days, items: items };
  }

  /* U-27 成长时间轴：纯本地生成，按时间倒序把「值得回看的事」串成一条线。
     只聚合用户自己记下的内容，不做预测、不做对比、不给结论。 */
  function timelineItems(d) {
    var out = [];
    (d.milestones || []).forEach(function (r) {
      if (r.date) out.push({ date: r.date, accent: 'milestone', text: r.title || '里程碑', sub: r.note || '' });
    });
    (d.growth || []).forEach(function (r) {
      if (!r.date) return;
      var parts = [];
      if (r.weightKg != null) parts.push(r.weightKg + ' kg');
      if (r.heightCm != null) parts.push(r.heightCm + ' cm');
      if (r.headCm != null) parts.push('头围 ' + r.headCm + ' cm');
      out.push({ date: r.date, accent: 'growth', text: '测了一次生长', sub: parts.join(' ｜ ') });
    });
    /* 接种记录：键名对用户不友好，能解析出中文名就显示名字 */
    var done = (d.vaccines && d.vaccines.done) || {};
    var nameOf = {};
    var baby = (d.settings && d.settings.baby) || null;
    var vac = global.Modules && global.Modules.vaccine;
    if (baby && baby.birthDate && vac && typeof vac._plan === 'function') {
      try {
        vac._plan(baby.birthDate).forEach(function (it) { nameOf[it.key] = it.name + it.dose; });
      } catch (e) {}
    }
    Object.keys(done).forEach(function (k) {
      if (done[k]) out.push({ date: done[k], accent: 'vaccine', text: '接种 ' + (nameOf[k] || k), sub: '' });
    });
    out.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
    return out.slice(0, 30);
  }

  function timelineCard(d) {
    var items = timelineItems(d);
    var html = '<div class="card timeline-card"><h2>成长时间轴</h2>';
    if (items.length) {
      html += '<ul class="timeline">';
      items.forEach(function (it) {
        html += '<li data-accent="' + Util.escapeHtml(it.accent) + '">'
          + '<span class="tl-dot"></span>'
          + '<span class="tl-date">' + Util.fmtDate(it.date) + '</span>'
          + '<span class="tl-text">' + Util.escapeHtml(it.text)
          + (it.sub ? '<i>' + Util.escapeHtml(it.sub) + '</i>' : '') + '</span></li>';
      });
      html += '</ul>';
      html += '<p class="hint">这条线由你自己的记录自动串起来，只按时间排列，不排序「谁家更好」。</p>';
    } else {
      html += '<div class="empty-state"><p>时间轴还是空的</p><span class="hint">记下里程碑、生长或接种之后，这里会自动串成一条线。</span></div>';
    }
    return html + '</div>';
  }

  function reviewCard(dayIdx, now) {
    var dow = now.getDay();                 /* 0=周日 */
    var backToMon = (dow + 6) % 7;          /* 周一起算 */
    var wkStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - backToMon);
    var wkEnd = new Date(wkStart.getFullYear(), wkStart.getMonth(), wkStart.getDate() + 6);
    var pvStart = new Date(wkStart.getFullYear(), wkStart.getMonth(), wkStart.getDate() - 7);
    var pvEnd = new Date(wkStart.getFullYear(), wkStart.getMonth(), wkStart.getDate() - 1);
    var mStart = new Date(now.getFullYear(), now.getMonth(), 1);
    var mEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    var wk = rangeStats(dayIdx, wkStart, wkEnd);
    var pv = rangeStats(dayIdx, pvStart, pvEnd);
    var mo = rangeStats(dayIdx, mStart, mEnd);

    var html = '<div class="card review-card"><h2>回顾</h2>';
    if (wk.items) {
      html += '<p>本周已记录 <b>' + wk.items + '</b> 条，覆盖 <b>' + wk.days + '</b> 天。';
      if (pv.items) {
        var diff = wk.items - pv.items;
        html += '上周同期是 ' + pv.items + ' 条'
          + (diff === 0 ? '，差不多。' : (diff > 0 ? '，比上周多了 ' + diff + ' 条。' : '，比上周少了 ' + (-diff) + ' 条，也完全没关系。'));
      } else {
        html += '这是本周刚开始的积累。';
      }
      html += '</p>';
    } else {
      html += '<p>本周还没有记录。想记就记，漏记不会清零，也不影响任何统计。</p>';
    }
    html += '<p class="hint">本月共 ' + mo.items + ' 条，覆盖 ' + mo.days + ' 天。'
      + '这里只统计你自己记下的内容，没有别人家的数据，也没有达标线。</p>';
    html += '<div class="row"><button class="btn" id="calExport" type="button">' + icon('export') + '导出这段记录</button></div>';
    html += '<p class="hint">导出的是完整数据（可迁移格式），由你自己保管。</p></div>';
    return html;
  }

  Modules.calendar = {
    id: 'calendar',
    title: '日期记录',
    render: function (view) {
      var d = Storage.get();
      var today = Util.todayISO();
      var dayIdx = Util.buildDayIndex(d);
      var now = new Date();
      var calState = { y: now.getFullYear(), m: now.getMonth(), sel: today, expanded: false };

      var html = '';
      html += '<div class="page-head"><h1>日期记录</h1>'
        + '<p>记录每天的小确幸。默认只显示最近七天：左右滑动周历翻看更早的日子，点「展开整月」看完整月历。</p></div>';
      /* 日历本体放第一位：Tab 名就叫「日期记录」，回顾 / 成长时间轴是延伸内容，排在后面，
         免得空状态长卡把日历挤出首屏。 */
      html += '<div class="card cal-page"><div id="calWrap"></div></div>';
      /* 第 56 次：今日概览数字卡（自首页迁入）——首页磁贴改单列信息行后，
         今日数字在每条磁贴上直接可见，概览卡与磁贴重复；搬到日历页与
         「某天的记录」「回顾」构成同页的日/周/月时间维度。口径单一来源
         （复用 Modules.home 的 pregnancyWeek / _longestMin）。 */
      if (global.Modules.home && typeof Modules.home._todayStats === 'function') {
        var ts = Modules.home._todayStats(d);
        /* 第 58 次：h2 补 icon，与页内其它卡（回顾/时间轴）风格统一 */
        html += '<div class="card today-overview"><h2>今日概览</h2>';
        if (ts.stats.length) {
          /* data-n 告诉 CSS 实际卡片数：3→单行三列、4→2×2，避免手机宽度下出现 2+1 孤行 */
          html += '<div class="stat-row" data-n="' + ts.stats.length + '">';
          ts.stats.forEach(function (s) {
            html += '<div class="stat"><span class="stat-num">' + s.num + '<i class="stat-unit">' + s.unit + '</i></span><span class="stat-lbl">' + s.lbl + '</span></div>';
          });
          html += '</div>';
        } else {
          html += '<div class="empty-state"><p>今天还没有记录</p><span class="hint">回首页点任意模块记一笔吧。</span></div>';
        }
        if (ts.sleepRange) {
          html += '<p class="hint">睡眠参照只用你自己的近 7 天区间（' + ts.sleepRange + '），不和别人比。</p>';
        }
        html += '</div>';
      }
      html += reviewCard(dayIdx, now);
      html += timelineCard(d);
      view.innerHTML = html;

      /* U-03/U-26：回顾卡里的导出出口——阶段性总结与「全量带走」并排出现，不留挽留话术。 */
      var calExp = view.querySelector('#calExport');
      if (calExp) calExp.addEventListener('click', function () {
        if (global.App && typeof App.exportAll === 'function') App.exportAll();
      });

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
        /* 周历条（对标 Cali 记录页，报告 P0-A）：「所选日期和前 6 天」——补记导向，
           点哪天看/记哪天。放在 calWrap 内随 paintCalendar 一起重绘，选中态自动联动。 */
        var DOW = ['日', '一', '二', '三', '四', '五', '六'];
        var selD = new Date(calState.sel + 'T00:00:00');
        var wsStart = new Date(selD);
        wsStart.setDate(selD.getDate() - 6);
        out += '<div class="week-strip">';
        for (var w = 0; w < 7; w++) {
          var wd = new Date(wsStart);
          wd.setDate(wsStart.getDate() + w);
          var wIso = Util.fmtDate(wd);
          var wFuture = Util.daysBetween(today, wIso) > 0;
          var wDow = (wIso === today) ? '今' : DOW[wd.getDay()];
          if (wFuture) {
            out += '<span class="ws-cell is-future"><span class="ws-dow">' + wDow + '</span><span class="ws-day">' + wd.getDate() + '</span></span>';
          } else {
            out += '<button type="button" data-ws="' + wIso + '" class="' + (wIso === calState.sel ? 'is-sel' : '') + (wIso === today ? ' is-today' : '') + '">'
              + '<span class="ws-dow">' + wDow + '</span><span class="ws-day">' + wd.getDate() + '</span></button>';
          }
        }
        out += '</div>';

        /* 第 94 次：默认只展示最近七天（周历条），整月网格收进展开态——
           点按钮展开 / 收起；周历条支持左右横滑翻上一周 / 下一周（shiftSel）。 */
        out += '<button type="button" class="cal-toggle" data-cal-toggle aria-expanded="' + (calState.expanded ? 'true' : 'false') + '">'
          + (calState.expanded ? '收起整月' : '展开整月') + '<span class="cal-chev">▾</span></button>';

        if (calState.expanded) {
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
        }

        /* 当日记录明细 */
        var items = dayIdx[calState.sel] || [];
        out += '<div class="day-detail">';
        out += '<h3>' + (calState.sel === today ? '今天' : calState.sel) + ' 的记录</h3>';
        if (items.length) {
          out += '<ul class="day-list">';
          items.forEach(function (it) {
            /* 第 95 次：行首显示记录时刻（HH:MM），纯日期项（里程碑/疫苗等）不占位 */
            out += '<li data-accent="' + Util.escapeHtml(it.icon || '') + '">'
              + (it.time ? '<span class="dl-time">' + Util.escapeHtml(it.time) + '</span>' : '')
              + icon(it.icon) + '<span class="dl-label">' + it.label + '</span><span class="dl-val">' + Util.escapeHtml(it.val || '') + '</span></li>';
          });
          out += '</ul><div class="day-total">共 ' + items.length + ' 条</div>';
        } else {
          out += '<p class="day-empty">这一天还没有记录。</p>';
        }
        /* C7 升级（对标报告 P0-A）：不再是「空日专属」——任何已过去/今天的选中日期都可以就地快记 */
        if (Util.daysBetween(calState.sel, today) >= 0) {
          out += '<div class="chip-row" id="dayBackfill">'
            + '<button type="button" class="btn btn-mini" data-backfill="feeding">' + icon('feeding') + '记喂养</button>'
            + '<button type="button" class="btn btn-mini" data-backfill="diaper">' + icon('diaper') + '记尿布</button>'
            + '<button type="button" class="btn btn-mini" data-backfill="meds">' + icon('meds') + '记吃药</button>'
            + '</div>';
        }
        out += '</div>';

        calWrap.innerHTML = out;

        /* 第 94 次：横滑翻周——左滑看上一周（sel -7），右滑回看（+7，不超过今天）。
           只认横向主导位移（|dx|≥40 且 |dx|≥1.5|dy|），不干扰纵向页面滚动；
           passive 监听不阻塞滚动线程。sel 变了同步年月，展开月历时落在正确月份。 */
        function shiftSel(delta) {
          var s = new Date(calState.sel + 'T00:00:00');
          s.setDate(s.getDate() + delta);
          var iso = Util.fmtDate(s);
          if (Util.daysBetween(today, iso) > 0) iso = today; /* 未来不可选 */
          var d2 = new Date(iso + 'T00:00:00');
          calState.sel = iso;
          calState.y = d2.getFullYear();
          calState.m = d2.getMonth();
          paintCalendar();
        }
        var strip = calWrap.querySelector('.week-strip');
        if (strip && strip.addEventListener) {
          var tsx = 0, tsy = 0, tst = 0;
          strip.addEventListener('touchstart', function (e) {
            if (!e.touches || e.touches.length !== 1) return;
            tsx = e.touches[0].clientX; tsy = e.touches[0].clientY; tst = 1;
          }, { passive: true });
          strip.addEventListener('touchend', function (e) {
            if (!tst) return;
            tst = 0;
            var t = (e.changedTouches && e.changedTouches[0]) || null;
            if (!t) return;
            var dx = t.clientX - tsx, dy = t.clientY - tsy;
            if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
            shiftSel(dx < 0 ? -7 : 7);
          }, { passive: true });
        }

        /* 展开态切换（周历七天 ⇄ 整月网格） */
        var tog = calWrap.querySelector('[data-cal-toggle]');
        if (tog && tog.click) tog.addEventListener('click', function () {
          calState.expanded = !calState.expanded;
          paintCalendar();
        });

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
        /* 周历条：点哪天选中哪天（跨月则同步年月） */
        Array.prototype.forEach.call(calWrap.querySelectorAll('[data-ws]'), function (b) {
          b.addEventListener('click', function () {
            var iso = b.getAttribute('data-ws');
            calState.sel = iso;
            if (iso.slice(0, 7) !== (calState.y + '-' + pad(calState.m + 1))) {
              calState.y = parseInt(iso.slice(0, 4), 10);
              calState.m = parseInt(iso.slice(5, 7), 10) - 1;
            }
            paintCalendar();
          });
        });
        /* C7：补记 = 一次性日期覆盖 + 跳转目标模块（App.pendingDate 由模块 render 消费） */
        Array.prototype.forEach.call(calWrap.querySelectorAll('[data-backfill]'), function (b) {
          b.addEventListener('click', function () {
            if (global.App) {
              global.App.pendingDate = calState.sel;
              global.App.showTab(b.getAttribute('data-backfill'));
            }
          });
        });
      }
      paintCalendar();
    }
  };
})(window);
