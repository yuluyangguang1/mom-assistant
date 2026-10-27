/**
 * calendar.js - 日期记录（底部 Tab 入口）
 * 第 285 次「做减法」重做：一屏只看一天。
 *   页头「10 月 27 日 周二」+ 日历按钮（跳转日期半屏）→ 周条（周一到周日，有记录的日子一个小圆点）
 *   →「一天的形状」（0–24 点细时间带：睡眠画色段、其余记录画小点；最多 3 个数字）
 *   → 当天时间轴（时间 · 图标 · 名称 · 数值）→ 补记小条 →「查看前一天」。
 * 在周条 / 内容区左右滑切换日期。回顾（周 / 月统计）挪进跳转日期半屏，成长时间轴去掉（生长 / 里程碑 / 疫苗各有自己的页）。
 * 与首页共用 Util.buildDayIndex，确保数据聚合单一来源。
 */
(function (global) {
  'use strict';
  var Storage = global.Storage, Util = global.Util;
  var Modules = global.Modules = global.Modules || {};
  var esc = function (s) { return Util.escapeHtml(s == null ? '' : String(s)); };
  var DOW = ['日', '一', '二', '三', '四', '五', '六'];
  /* 喂养子类型 → 模块色（buildDayIndex 的 icon 仍是 feeding） */
  var KIND_ACC = { breast: 'breast', bottle: 'bottle', formula: 'bottle', pump: 'pump', solid: 'solid' };
  var KIND_ICO = { breast: 'breast', bottle: 'feeding', formula: 'formula', pump: 'pump', solid: 'solid' };

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function isoOf(s) { return String(s || '').slice(0, 10); }
  function dObj(iso) { var p = iso.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function titleOf(iso) { var d = dObj(iso); return (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日 周' + DOW[d.getDay()]; }
  function minOf(hm) { var m = /^(\d{2}):(\d{2})/.exec(hm || ''); return m ? (+m[1]) * 60 + (+m[2]) : -1; }
  function reduced() {
    try { return global.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  }
  function accOf(it) { return (it.kind && KIND_ACC[it.kind]) || it.icon || ''; }
  function icoOf(it) { return (it.kind && KIND_ICO[it.kind]) || it.icon; }

  /* U-26 回顾：本地生成、只拿自己的数据自比（U-24），不设达标线、不做红色告警（U-25）。
     第 285 次起放在跳转日期半屏里（月历下面），页面本身只看一天。 */
  function rangeStats(dayIdx, from, to, cutHM) {
    var days = 0, items = 0;
    var cur = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    var end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
    var endIso = Util.fmtDate(end);
    while (cur <= end) {
      var iso = Util.fmtDate(cur);
      var arr = (dayIdx[iso] || []).filter(function (it) { return !it.cont && !(cutHM && iso === endIso && it.time && it.time > cutHM); });
      if (arr.length) { days++; items += arr.length; }
      cur.setDate(cur.getDate() + 1);
    }
    return { days: days, items: items };
  }
  function reviewHTML(dayIdx, now) {
    var dow = now.getDay(), backToMon = (dow + 6) % 7;
    var wkStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - backToMon);
    var wkEnd = new Date(wkStart.getFullYear(), wkStart.getMonth(), wkStart.getDate() + 6);
    var pvStart = new Date(wkStart.getFullYear(), wkStart.getMonth(), wkStart.getDate() - 7);
    /* 第 274 次（审计 #24）：上周同期 = 上周一 → 上周的同一个星期几，最后一天截到现在这个钟点 */
    var pvEnd = new Date(pvStart.getFullYear(), pvStart.getMonth(), pvStart.getDate() + backToMon);
    var cutHM = pad(now.getHours()) + ':' + pad(now.getMinutes());
    var pvLbl = backToMon === 0 ? '上周一' : '上周一到周' + DOW[dow];
    var mo = rangeStats(dayIdx, new Date(now.getFullYear(), now.getMonth(), 1), new Date(now.getFullYear(), now.getMonth() + 1, 0));
    var wk = rangeStats(dayIdx, wkStart, wkEnd), pv = rangeStats(dayIdx, pvStart, pvEnd, cutHM);
    var h = '<div class="cal-review review-card"><span class="rs-lbl">回顾</span><p>';
    if (wk.items) {
      h += '本周已记录 <b>' + wk.items + '</b> 条，覆盖 <b>' + wk.days + '</b> 天。';
      if (pv.items) h += '上周同期（' + pvLbl + '，到这个钟点）是 ' + pv.items + ' 条。';
      else h += '上周同期（' + pvLbl + '）没有记录，先不比较。';
    } else {
      h += '本周还没有记录。';
    }
    h += '本月共 ' + mo.items + ' 条，覆盖 ' + mo.days + ' 天。</p>'
      + '<button class="btn" id="calExport" type="button">' + icon('export') + '导出全部记录</button></div>';
    return h;
  }

  /* ---------- 一天的形状：睡眠色段 + 记录小点 + 最多 3 个数字 ---------- */
  function sleepSegs(d, iso, isToday) {
    var from = dObj(iso).getTime(), to = from + 864e5, nowMs = Date.now();
    var list = (d.sleeps || []).filter(function (x) { return x && x.start && x.end; });
    if (isToday && d.openSleep && d.openSleep.start) list = list.concat([{ start: d.openSleep.start, end: null, live: true }]);
    var out = [];
    list.forEach(function (x) {
      var a = new Date(x.start).getTime(), b = x.end ? new Date(x.end).getTime() : nowMs;
      if (!isFinite(a) || !isFinite(b) || b <= a) return;
      var s = Math.max(a, from), e = Math.min(b, to);
      if (e <= s) return;
      var sd = new Date(s);
      out.push({ l: (s - from) / 864e5 * 100, w: (e - s) / 864e5 * 100, hm: pad(sd.getHours()) + ':' + pad(sd.getMinutes()), live: !!x.live });
    });
    return out;
  }
  function dayNums(d, iso, isToday) {
    var on = function (s) { return isoOf(s) === iso; };
    var fs = (d.feedings || []).filter(function (r) { return r && on(r.start); });
    var milk = 0, nFeed = 0, nSolid = 0, pumpMl = 0, nPump = 0;
    fs.forEach(function (r) {
      var amt = Number(r.amount) || 0;
      if (r.type === 'bottle' || r.type === 'formula') { nFeed++; milk += amt > 0 ? amt : 0; }
      else if (r.type === 'breast') nFeed++;
      else if (r.type === 'solid') nSolid++;
      else if (r.type === 'pump') { nPump++; pumpMl += amt > 0 ? amt : 0; }
    });
    var sl = Util.daySleep(d.sleeps, iso, 0, { live: isToday ? d.openSleep : null }).min;
    var cnt = function (arr, key) { return (arr || []).filter(function (r) { return r && on(r[key]); }); };
    var nDia = cnt(d.diapers, 'time').length;
    var water = cnt(d.waters, 'time').reduce(function (a, r) { return a + (Number(r.ml) || 0); }, 0);
    var out = [];
    if (milk > 0) out.push({ k: 'milk', lbl: '奶量', v: Math.round(milk) + ' ml' });
    else if (nFeed) out.push({ k: 'feed', lbl: '喂奶', v: nFeed + ' 次' });
    if (sl >= 1) out.push({ k: 'sleep', lbl: '睡眠', v: Util.fmtDuration(sl * 60000) });
    if (nDia) out.push({ k: 'diaper', lbl: '尿布', v: nDia + ' 次' });
    if (nSolid) out.push({ k: 'solid', lbl: '辅食', v: nSolid + ' 次' });
    if (nPump) out.push({ k: 'pump', lbl: '泵奶', v: pumpMl > 0 ? Math.round(pumpMl) + ' ml' : nPump + ' 次' });
    if (water > 0) out.push({ k: 'water', lbl: '饮水', v: Math.round(water) + ' ml' });
    [['meds', 'time', '吃药'], ['supplements', 'time', '营养品'], ['fetal', 'time', '胎动'], ['contractions', 'start', '宫缩']].forEach(function (c) {
      var n = cnt(d[c[0]], c[1]).length;
      if (n) out.push({ k: c[0], lbl: c[2], v: n + ' 次' });
    });
    return out.slice(0, 3);
  }
  /* 数字大、单位小：「9小时20分」「320 ml」 */
  function numHTML(v) {
    return String(v).split(/(\d+(?:\.\d+)?)/).map(function (s) {
      if (!s) return '';
      return /^\d/.test(s) ? '<b>' + s + '</b>' : '<i>' + esc(s.trim()) + '</i>';
    }).join('');
  }
  function shapeHTML(d, iso, rows, isToday) {
    var segs = sleepSegs(d, iso, isToday);
    var h = '<div class="card day-shape" role="group" aria-label="一天的形状">'
      + '<div class="dsh-band"><span class="dsh-track"></span>';
    segs.forEach(function (s) {
      var ti = -1;
      rows.forEach(function (r, i) { if (ti < 0 && r.icon === 'sleep' && r.time === s.hm) ti = i; });
      h += '<button type="button" class="dsh-seg' + (s.live ? ' is-live' : '') + '" data-accent="sleep" style="left:' + s.l.toFixed(3) + '%;width:' + Math.max(s.w, 0.6).toFixed(3) + '%"'
        + (ti >= 0 ? ' data-ti="' + ti + '"' : '') + ' aria-label="' + esc(s.hm + ' 睡眠') + '"></button>';
    });
    rows.forEach(function (r, i) {
      if (r.icon === 'sleep') return;
      var m = minOf(r.time);
      if (m < 0) return;
      h += '<button type="button" class="dsh-dot" data-ti="' + i + '" data-accent="' + esc(accOf(r)) + '" style="left:' + (m / 1440 * 100).toFixed(3) + '%"'
        + ' aria-label="' + esc(r.time + ' ' + r.label + (r.val ? ' ' + r.val : '')) + '"></button>';
    });
    if (isToday) {
      var n = new Date(), nm = n.getHours() * 60 + n.getMinutes();
      h += '<span class="dsh-now" style="left:' + (nm / 1440 * 100).toFixed(3) + '%" aria-hidden="true"><i>现在</i></span>';
    }
    h += '</div><div class="dsh-axis" aria-hidden="true"><span>0</span><span>6</span><span>12</span><span>18</span><span>24</span></div>';
    var nums = dayNums(d, iso, isToday);
    if (nums.length) {
      h += '<div class="dsh-nums" data-n="' + nums.length + '">';
      nums.forEach(function (x) { h += '<div class="dsh-num" data-k="' + x.k + '"><span class="dsh-v">' + numHTML(x.v) + '</span><span class="dsh-l">' + x.lbl + '</span></div>'; });
      h += '</div>';
    }
    return h + '</div>';
  }

  /* 同义第二行不显示：「游泳 / 游泳记录」「服药 / 服药」这类 */
  function valOf(it) {
    var v = String(it.val || '').trim(), l = String(it.label || '').trim();
    if (!v || v === l || v === l + '记录' || v === '记录') return '';
    return v;
  }
  function gapText(min) {
    var h = Math.floor(min / 60), m = min % 60;
    return (h ? h + ' 小时' : '') + (m ? (h ? ' ' : '') + m + ' 分' : '');
  }
  /* 间隔 = 这一条开始 − 上一段结束（睡眠按醒来算），≥ 3 小时才写，字更轻 */
  function timelineHTML(rows, segs) {
    var h = '<ul class="day-list day-tl">', prev = -1;
    rows.forEach(function (it, i) {
      var m = minOf(it.time);
      if (prev >= 0 && m >= 0 && m - prev >= 180) h += '<li class="dt-gap" aria-hidden="true">' + gapText(m - prev) + '</li>';
      if (m >= 0) {
        var endM = m;
        if (it.icon === 'sleep') (segs || []).forEach(function (s) { if (s.hm === it.time) endM = Math.max(endM, Math.round((s.l + s.w) / 100 * 1440)); });
        prev = Math.max(prev, endM);
      }
      var v = valOf(it);
      h += '<li id="dtl' + i + '" data-ti="' + i + '" data-accent="' + esc(accOf(it)) + '">'
        + '<span class="dl-time">' + esc(it.time || '') + '</span>'
        + '<span class="dt-ico">' + icon(icoOf(it)) + '</span>'
        + '<span class="dt-main"><span class="dl-label">' + esc(it.label) + '</span>'
        + (it.note ? '<small class="dl-note">' + esc(it.note) + '</small>' : '') + '</span>'
        + (v ? '<span class="dt-val">' + esc(v) + '</span>' : '')
        + '</li>';
    });
    return h + '</ul>';
  }

  var state = { sel: null };

  Modules.calendar = {
    id: 'calendar',
    title: '日期记录',
    _state: state,
    /* 离开日期页回到今天；去补记（记喂养 / 尿布 / 吃药）再回来时停在原来那天 */
    leave: function () { if (!state.keep) state.sel = null; state.keep = false; },
    _shape: function (iso) { var d = Storage.get(); return { nums: dayNums(d, iso, iso === Util.todayISO()), segs: sleepSegs(d, iso, iso === Util.todayISO()) }; },
    render: function (view) {
      var today = Util.todayISO();
      if (!state.sel || Util.daysBetween(today, state.sel) > 0) state.sel = today;

      view.innerHTML = '<div class="cal-day-page">'
        + '<div class="page-head cal-head-row"><h1 id="calTitle" aria-live="polite"></h1>'
        + '<button type="button" class="cal-jump" data-cal-jump aria-label="跳转到日期">' + icon('calendar') + '</button></div>'
        + '<div class="week-strip" id="calStrip" data-no-drawer></div>'
        + '<div class="cal-day" id="calDay" data-no-drawer></div>'
        + '</div>';
      var strip = view.querySelector('#calStrip'), box = view.querySelector('#calDay'), title = view.querySelector('#calTitle');

      function paintStrip(dayIdx) {
        var sel = dObj(state.sel), mon = new Date(sel.getFullYear(), sel.getMonth(), sel.getDate() - (sel.getDay() + 6) % 7);
        var h = '';
        for (var w = 0; w < 7; w++) {
          var wd = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + w), iso = Util.fmtDate(wd);
          var lbl = iso === today ? '今' : DOW[wd.getDay()];
          var has = (dayIdx[iso] || []).length ? '<i class="ws-dot" aria-hidden="true"></i>' : '';
          if (Util.daysBetween(today, iso) > 0) {
            h += '<span class="ws-cell is-future"><span class="ws-dow">' + lbl + '</span><span class="ws-day">' + wd.getDate() + '</span></span>';
          } else {
            h += '<button type="button" data-ws="' + iso + '" class="' + (iso === state.sel ? 'is-sel' : '') + (iso === today ? ' is-today' : '') + '"'
              + (iso === state.sel ? ' aria-current="date"' : '') + ' aria-label="' + titleOf(iso) + '">'
              + '<span class="ws-dow">' + lbl + '</span><span class="ws-day">' + wd.getDate() + '</span>' + has + '</button>';
          }
        }
        strip.innerHTML = h;
      }

      function paintDay() {
        var d = Storage.get(), dayIdx = Util.buildDayIndex(d), iso = state.sel, isToday = iso === today;
        title.textContent = titleOf(iso);
        paintStrip(dayIdx);
        var rows = dayIdx[iso] || [];
        var h = '';
        if (rows.length) {
          h += shapeHTML(d, iso, rows, isToday);
          h += timelineHTML(rows, sleepSegs(d, iso, isToday));
        } else {
          h += '<p class="day-empty">' + (isToday ? '今天还没有记录' : '这一天没有记录') + '</p>';
        }
        h += '<div class="chip-row cal-quick" id="dayBackfill">'
          + '<button type="button" class="btn btn-mini" data-backfill="feeding">' + icon('feeding') + '记喂养</button>'
          + '<button type="button" class="btn btn-mini" data-backfill="diaper">' + icon('diaper') + '记尿布</button>'
          + '<button type="button" class="btn btn-mini" data-backfill="meds">' + icon('meds') + '记吃药</button></div>';
        h += '<button type="button" class="cal-prev" data-cal-prev>查看前一天</button>';
        box.innerHTML = h;
      }

      /* 换一天：内容从滑来的那一侧轻轻进来（减少动态效果时直接换） */
      function go(iso, dir) {
        if (!iso || Util.daysBetween(today, iso) > 0 || iso === state.sel) { settle(); return; }
        state.sel = iso;
        paintDay();
        box.style.transition = 'none';
        if (dir && !reduced()) {
          box.style.transform = 'translateX(' + (dir > 0 ? 28 : -28) + 'px)';
          box.style.opacity = '0';
          void box.offsetWidth;
          box.style.transition = 'transform .32s var(--ease), opacity .26s var(--ease)';
        }
        box.style.transform = '';
        box.style.opacity = '';
      }
      function settle() {
        box.style.transition = reduced() ? 'none' : 'transform .25s var(--ease), opacity .25s var(--ease)';
        box.style.transform = ''; box.style.opacity = '';
      }
      Modules.calendar._go = function (iso) { go(iso, Util.daysBetween(state.sel, iso) < 0 ? 1 : -1); };

      /* 左右滑：内容区 = 前一天 / 后一天；周条 = 上一周 / 下一周。只认横向为主的位移，不挡竖向滚动 */
      function swipe(el, step) {
        var sx = 0, sy = 0, on = 0, dec = 0;
        el.addEventListener('touchstart', function (e) {
          if (!e.touches || e.touches.length !== 1) { on = 0; return; }
          sx = e.touches[0].clientX; sy = e.touches[0].clientY; on = 1; dec = 0;
        }, { passive: true });
        el.addEventListener('touchmove', function (e) {
          if (!on || !e.touches || !e.touches[0]) return;
          var dx = e.touches[0].clientX - sx, dy = e.touches[0].clientY - sy;
          if (!dec) {
            if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
            dec = Math.abs(dx) > Math.abs(dy) * 1.3 ? 1 : -1;
          }
          if (dec !== 1 || step !== 1 || reduced()) return;
          var atEnd = dx < 0 && state.sel === today;
          var k = atEnd ? 0.12 : 0.4;
          box.style.transition = 'none';
          box.style.transform = 'translateX(' + (dx * k).toFixed(1) + 'px)';
          box.style.opacity = String(Math.max(0.35, 1 - Math.abs(dx) / 520));
        }, { passive: true });
        function end(e) {
          if (!on) return;
          on = 0;
          var t = e.changedTouches && e.changedTouches[0];
          if (dec !== 1 || !t || e.type === 'touchcancel') { settle(); return; }
          var dx = t.clientX - sx;
          if (Math.abs(dx) < 50) { settle(); return; }
          var n = Util.addDays(state.sel, dx < 0 ? step : -step);
          if (Util.daysBetween(today, n) > 0) n = today;
          go(n, dx < 0 ? 1 : -1);
        }
        el.addEventListener('touchend', end, { passive: true });
        el.addEventListener('touchcancel', end, { passive: true });
      }
      swipe(box, 1);
      swipe(strip, 7);

      strip.addEventListener('click', function (e) {
        var b = e.target.closest && e.target.closest('[data-ws]');
        if (b) { var iso = b.getAttribute('data-ws'); go(iso, Util.daysBetween(state.sel, iso) < 0 ? -1 : 1); }
      });
      box.addEventListener('click', function (e) {
        var t = e.target.closest ? e.target : null;
        if (!t) return;
        var tap = t.closest('.day-shape [data-ti]');
        if (tap) {
          var row = box.querySelector('#dtl' + tap.getAttribute('data-ti'));
          if (row) {
            row.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' });
            row.classList.remove('is-flash'); void row.offsetWidth; row.classList.add('is-flash');
            setTimeout(function () { row.classList.remove('is-flash'); }, 1300);
          }
          return;
        }
        if (t.closest('[data-cal-prev]')) { go(Util.addDays(state.sel, -1), -1); global.scrollTo(0, 0); return; }
        var bf = t.closest('[data-backfill]');
        if (bf && global.App) { state.keep = true; App.pendingDate = state.sel; App.showTab(bf.getAttribute('data-backfill')); }
      });
      view.querySelector('[data-cal-jump]').addEventListener('click', function () { Modules.calendar._openJump(); });

      paintDay();
    },

    /* 跳转日期半屏：月历（周一起）+ 回顾。点哪天就关掉并跳到那天 */
    _openJump: function () {
      if (!global.FTUI) return;
      var today = Util.todayISO(), sel = state.sel || today, s0 = dObj(sel);
      var ym = { y: s0.getFullYear(), m: s0.getMonth() };
      var d = Storage.get(), dayIdx = Util.buildDayIndex(d);
      var api = FTUI.openSheet('', '跳转到日期', '<div class="cal-jump-body"><div id="calMonth"></div>' + reviewHTML(dayIdx, new Date()) + '</div>', null);
      if (!api) return;
      var ok = api.box.querySelector('[data-ok]');
      if (ok) ok.remove();
      api.box.parentNode.classList.add('cal-sheet');
      var mBox = api.box.querySelector('#calMonth');
      function paintMonth() {
        var y = ym.y, m = ym.m, first = new Date(y, m, 1), lead = (first.getDay() + 6) % 7, n = new Date(y, m + 1, 0).getDate();
        var h = '<div class="cal-head"><button type="button" data-cm="-1" aria-label="上个月">‹</button>'
          + '<span class="cal-title">' + y + ' 年 ' + (m + 1) + ' 月</span>'
          + '<button type="button" data-cm="1" aria-label="下个月"' + (y * 12 + m >= dObj(today).getFullYear() * 12 + dObj(today).getMonth() ? ' disabled' : '') + '>›</button></div>'
          + '<div class="cal-week"><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span></div><div class="cal-grid">';
        for (var i = 0; i < lead; i++) h += '<span class="cal-cell is-empty"></span>';
        for (var day = 1; day <= n; day++) {
          var iso = y + '-' + pad(m + 1) + '-' + pad(day), cls = 'cal-cell';
          if (iso === today) cls += ' is-today';
          if (iso === sel) cls += ' is-sel';
          var dot = (dayIdx[iso] || []).length ? '<span class="cal-dots"><i class="cal-dot"></i></span>' : '';
          if (Util.daysBetween(today, iso) > 0) h += '<span class="' + cls + ' is-future">' + day + '</span>';
          else h += '<button type="button" class="' + cls + '" data-day="' + iso + '"' + (iso === sel ? ' aria-current="date"' : '') + '>' + day + dot + '</button>';
        }
        h += '</div>';
        if (sel !== today) h += '<button type="button" class="cal-today" data-day="' + today + '">回到今天</button>';
        mBox.innerHTML = h;
      }
      mBox.addEventListener('click', function (e) {
        var b = e.target.closest && e.target.closest('button');
        if (!b || b.disabled) return;
        if (b.hasAttribute('data-cm')) {
          ym.m += +b.getAttribute('data-cm');
          if (ym.m < 0) { ym.m = 11; ym.y--; } else if (ym.m > 11) { ym.m = 0; ym.y++; }
          paintMonth(); return;
        }
        var iso = b.getAttribute('data-day');
        if (iso) { api.close(); if (Modules.calendar._go) Modules.calendar._go(iso); }
      });
      var ex = api.box.querySelector('#calExport');
      if (ex) ex.addEventListener('click', function () { if (global.App && typeof App.exportAll === 'function') App.exportAll(); });
      paintMonth();
      return api;
    }
  };
})(window);
