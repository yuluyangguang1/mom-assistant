/**
 * sleep.js - 哄睡 / 睡眠计时 + 四字段记录
 * 开始 / 暂停 / 继续 / 结束；记录时长；基础作息列表。
 *
 * 依市场研究报告 Ch6 规范条款改造：
 * - U-16 四字段：入睡时间、醒来时间、夜醒次数（0/1/2/3+ 单点选择）、最长连续睡眠。
 *   最长连续由「时长 ÷ (夜醒次数+1)」折算并标注「约」，是自报数据的合理估计，不显示睡眠效率（U-19）。
 * - U-24 参照只用用户自身近 7 天区间，不给任何外部人群参照值（U-18）。
 * - U-11 漏记不清零：手动补记入口常在，48 小时为设计判断，实际不设惩罚性时限。
 * - 第 73 次（C2/C3）：睡眠参考卡（清醒窗口/猛长期，Knowledge 底座）——
 *   教育性科普，不与用户数据对照，统计口径不变。
 */
(function (global) {
  'use strict';
  var Storage = global.Storage, Util = global.Util;
  var Modules = global.Modules = global.Modules || {};

  function openSleep() { return (Storage.get() || {}).openSleep || null; } /* 第 146 次：早于 load 的定时器调用时判空 */

  /* ---- 睡眠四字段的取值与折算（首页复用 _longestOf）---- */
  function durMs(s) { return new Date(s.end).getTime() - new Date(s.start).getTime() - (s.pausedMs || 0); }
  function longestMin(s) {
    if (s.longestMin != null) return s.longestMin;
    var w = (s.wakings == null) ? 0 : s.wakings;
    return Math.max(0, Math.round(durMs(s) / 60000 / (w + 1)));
  }
  function fmtH(h) { return (Math.round(h * 10) / 10).toFixed(1); }
  function wakText(s) { return s.wakings == null ? '未填' : (s.wakings >= 3 ? '3 次以上' : s.wakings + ' 次'); }
  function wakSeg(id, attr) {
    return '<div class="seg" id="' + id + '">' + ['0', '1', '2', '3'].map(function (k) {
      return '<button type="button" class="seg-btn' + (k === '0' ? ' active' : '') + '" ' + attr + '="' + k + '">'
        + (k === '3' ? '3 次以上' : k + ' 次') + '</button>';
    }).join('') + '</div>';
  }
  function dtLocalValue(d) {
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function tick() {
    var os = openSleep();
    var el = document.getElementById('sleepTimer');
    if (!os || !el) return;
    var now = Date.now();
    var paused = (os.pausedMs || 0) + (os.pauseStart ? now - os.pauseStart : 0);
    el.textContent = Util.fmtDuration(now - new Date(os.start).getTime() - paused);
  }

  Modules.sleep = {
    id: 'sleep',
    title: '睡眠',
    render: function (view) {
      var d = Storage.get();
      var os = openSleep();
      var html = '';

      html += '<div class="card"><h2>睡眠计时</h2>';
      if (os) {
        html += '<p class="big">已睡 <span id="sleepTimer">--</span></p>';
        html += '<p class="hint">开始：' + Util.fmtDateTime(os.start) + (os.pauseStart ? '（已暂停）' : '') + '</p>';
        if (os.pauseStart) {
          html += '<button class="btn btn-primary" id="sResume">继续</button> ';
        } else {
          html += '<button class="btn" id="sPause">暂停</button> ';
        }
        html += '<button class="btn btn-primary" id="sEnd">结束并记录</button>';
        /* 第 194 次：结束时间回填（对标 Cali 补记 endedAt；照搬亲喂 data-ftend 写法）。
           首页「可能忘了结束（点进去可改结束时间）」此前在本页其实没有对应控件。 */
        var osMs = Date.now() - new Date(os.start).getTime();
        if (osMs > 6 * 3600000) {
          html += '<p class="hint sl-stale">已经计时 ' + Math.floor(osMs / 3600000) + ' 小时了，是不是忘了按结束？可以按实际醒来时间回填。</p>';
        }
        html += '<div class="sl-back"><span class="hint">忘了按结束？按实际醒来时间：</span>'
          + '<button type="button" class="btn-mini" data-slend="10">10 分钟前</button>'
          + '<button type="button" class="btn-mini" data-slend="20">20 分钟前</button>'
          + '<button type="button" class="btn-mini" data-slend="30">30 分钟前</button></div>';
        html += '<div class="sl-endat"><label>或选醒来时间<input type="datetime-local" id="sEndAt" value="' + dtLocalValue(new Date()) + '"'
          + ' min="' + dtLocalValue(new Date(new Date(os.start).getTime() + 60000)) + '" max="' + dtLocalValue(new Date()) + '"></label>'
          + '<button type="button" class="btn" id="sEndAtGo">按这个时间结束</button></div>';
      } else {
        html += '<button class="btn btn-primary btn-save" id="sStart">开始睡眠计时</button>';
        /* 第 194 次：哄睡着才想起来点开始——入睡时间往前拨 */
        html += '<div class="sl-back"><span class="hint">已经睡着一会儿了？从这时开始算：</span>'
          + '<button type="button" class="btn-mini" data-slstart="10">10 分钟前</button>'
          + '<button type="button" class="btn-mini" data-slstart="20">20 分钟前</button>'
          + '<button type="button" class="btn-mini" data-slstart="30">30 分钟前</button></div>';
      }
      html += '</div>';

      /* 第 73 次（C2/C3）：睡眠参考卡——清醒窗口 + 猛长期窗口（Knowledge 底座，本页只做呈现，
         模式同 feeding 喂养参考）。与 U-18 的边界：这是哄睡时机的教育性科普，
         不与用户任何记录数据做对照、不出「达标/不达标」；作息统计依旧只比你自己。 */
      var sBd = (d.settings.baby && d.settings.baby.birthDate) || null;
      if (sBd && global.Knowledge) {
        var sAge = Util.daysBetween(sBd, Util.todayISO());
        if (sAge >= 0 && sAge <= 1095) {
          var slRef = Knowledge.all('sleep').filter(function (e) { return sAge >= e.from && sAge <= e.to; });
          if (slRef.length) {
            html += '<div class="card info-card"><h2>睡眠参考</h2>';
            slRef.forEach(function (e) {
              html += '<p class="hint">' + Util.escapeHtml(e.text) + '</p>';
            });
            html += '<p class="hint">以上是哄睡时机的参考，不是你家宝宝要达到的标准——他的节奏说了算。</p>';
            html += '</div>';
          }
        }
      }

      /* 夜醒单点选择（U-16 字段三/四）：刚结束的那一觉若还没填，点一下即可 */
      var pending = d.sleeps.filter(function (s) { return s.end && s.wakings == null; })
        .sort(function (a, b) { return new Date(b.start) - new Date(a.start); })[0];
      if (pending) {
        html += '<div class="card"><h2>刚才这觉，夜醒了几次？</h2>';
        html += '<p class="hint">' + Util.fmtDateTime(pending.start) + ' → ' + Util.fmtDateTime(pending.end)
          + '（' + Util.fmtDuration(durMs(pending)) + '）</p>';
        html += wakSeg('sWak', 'data-wak');
        html += '<p class="hint">选完自动折算「最长连续约 X 小时」。只是你自己的记录，不需要和别的宝宝比较。</p></div>';
      }

      html += '<div class="card"><h2>作息记录</h2>';

      /* 第 106 次 · GAP-01 跨夜归属 + CN-03 清醒间隔
         两块都只读既有记录、不写库、只与用户自身历史比（U-24 / U-25），
         不出「该不该睡这么久」这类判定（U-19：也不做睡眠效率与分期）。 */
      var ln = Modules.sleep._lastNightTotal(d.sleeps);
      if (ln.segs > 0) {
        html += '<p class="hint"><b>昨晚共睡了约 ' + fmtH(ln.minutes / 60) + ' 小时</b>（' + ln.segs + ' 段）'
          + '。凌晨入睡的那几段也算进昨晚，所以这里和「今天几点睡的」不一定对得上。</p>';
      }

      var wgs = Modules.sleep._wakeGapSummary(d.sleeps, 7);
      if (wgs) {
        html += '<p class="hint">近 ' + wgs.days + ' 天，你的清醒间隔（醒到下次入睡）在 '
          + fmtH(wgs.min / 60) + '–' + fmtH(wgs.max / 60) + ' 小时之间，中间那档约 '
          + fmtH(wgs.median / 60) + ' 小时——和你自己比就好。</p>';
      }

      var list = d.sleeps.filter(function (s) { return s.end; })
        .slice().sort(function (a, b) { return new Date(b.start) - new Date(a.start); }).slice(0, 20);
      if (list.length) {
        /* 自身历史参照（U-24）：只用近 7 天自己的区间，无任何外部人群参照值（U-18） */
        var cut = new Date(); cut.setDate(cut.getDate() - 7);
        var vals = list.filter(function (s) { return new Date(s.end) >= cut; })
          .map(function (s) { return longestMin(s); }).filter(function (v) { return v > 0; });
        if (vals.length >= 2) {
          html += '<p class="hint">近 7 天你的最长连续睡眠在 ' + fmtH(Math.min.apply(null, vals) / 60)
            + '–' + fmtH(Math.max.apply(null, vals) / 60) + ' 小时之间——和你自己比就好。</p>';
        }
        html += '<ul class="list">';
        list.forEach(function (s) {
          /* 第 76 次（D 线）：行改「左入睡→醒来 / 右时长·夜醒·连续」双列 */
          html += '<li><span class="li-main"><b>' + Util.fmtRange(s.start, s.end) + '</b></span>' /* 第 146 次：「2026-10-11 13:00 → 2026-10-11 14:20」在窄屏被截断，改紧凑时段 */
            + '<span class="li-sub li-sub-wrap">时长 ' + Util.fmtDuration(durMs(s))
            + ' · 夜醒 ' + wakText(s)
            + ' · 最长连续 约 ' + fmtH(longestMin(s) / 60) + ' 小时'
            + (s.note ? ' · ' + Util.escapeHtml(s.note) : '') + '</span>'
            + '<button class="icon-btn" data-del="' + s.id + '" aria-label="删除" title="删除">' + icon('trash') + '</button></li>';
        });
        html += '</ul>';
      } else {
        html += '<div class="empty-state"><span class="es-ico">' + icon('sleep') + '</span><p>还没有睡眠记录</p><span class="hint">记第一觉后，这里会有作息与夜醒统计。</span></div>';
      }
      html += '</div>';

      /* 手动补记（U-11）：漏记不清零、不惩罚，随时补回 */
      var endDef = new Date();
      var startDef = new Date(endDef.getTime() - 3 * 3600000);
      html += '<div class="card"><h2>手动补记</h2>';
      html += '<div class="row"><label>入睡<input type="datetime-local" id="sManStart" value="' + dtLocalValue(startDef) + '"></label>'
        + '<label>醒来<input type="datetime-local" id="sManEnd" value="' + dtLocalValue(endDef) + '"></label></div>';
      html += '<p class="hint">夜醒次数：</p>' + wakSeg('sManWak', 'data-mwak');
      html += '<button class="btn btn-save" id="sManSave" type="button">保存这条</button>';
      html += '<p class="hint">忘了记也没关系，漏记不会清零、不会影响任何统计，回来补上就行。</p></div>';

      view.innerHTML = html;
      tick();

      function startAt(agoMin) {
        var st = agoMin ? dtLocalValue(new Date(Date.now() - agoMin * 60000)) + ':00' : Util.nowLocal();
        d.openSleep = { id: Util.uid(), start: st, pausedMs: 0, pauseStart: null };
        if (Storage.save() && agoMin) Util.toast('已从 ' + agoMin + ' 分钟前开始计时', 'ok');
        global.App.rerender();
      }
      var sStart = view.querySelector('#sStart');
      if (sStart) sStart.addEventListener('click', function () { startAt(0); });
      Array.prototype.forEach.call(view.querySelectorAll('[data-slstart]'), function (b) {
        b.addEventListener('click', function () { startAt(parseInt(b.getAttribute('data-slstart'), 10) || 0); });
      });
      var sPause = view.querySelector('#sPause');
      if (sPause) sPause.addEventListener('click', function () {
        d.openSleep.pauseStart = Date.now();
        Storage.save(); global.App.rerender();
      });
      var sResume = view.querySelector('#sResume');
      if (sResume) sResume.addEventListener('click', function () {
        if (d.openSleep.pauseStart) {
          d.openSleep.pausedMs = (d.openSleep.pausedMs || 0) + (Date.now() - d.openSleep.pauseStart);
          d.openSleep.pauseStart = null;
          Storage.save(); global.App.rerender();
        }
      });
      /* 第 194 次：结束统一走 endAt(毫秒时间戳)；回填时间不能早于入睡、不能晚于现在。
         暂停中结束：只把「暂停开始 → 结束」这段计入暂停（结束早于暂停开始则不计）。 */
      function endAt(endMs) {
        var os2 = d.openSleep; if (!os2) return;
        var startMs = new Date(os2.start).getTime(), nowMs = Date.now();
        if (!(endMs > startMs)) { Util.toast('醒来时间要晚于入睡时间（' + Util.fmtDateTime(os2.start) + '）', 'warn'); return; }
        if (endMs > nowMs) endMs = nowMs;
        var paused = (os2.pausedMs || 0) + (os2.pauseStart ? Math.max(0, endMs - os2.pauseStart) : 0);
        var totalMs = endMs - startMs - paused;
        d.sleeps.push({ id: os2.id, start: os2.start, end: dtLocalValue(new Date(endMs)) + ':' + ('0' + new Date(endMs).getSeconds()).slice(-2), pausedMs: paused, note: null, wakings: null, longestMin: null });
        d.openSleep = null;
        if (Storage.save()) Util.toast('已记录：睡眠 ' + Util.fmtDuration(Math.max(0, totalMs)), 'ok'); /* C1：计时类带时长 */
        global.App.rerender();
      }
      var sEnd = view.querySelector('#sEnd');
      if (sEnd) sEnd.addEventListener('click', function () { endAt(Date.now()); });
      Array.prototype.forEach.call(view.querySelectorAll('[data-slend]'), function (b) {
        b.addEventListener('click', function () { endAt(Date.now() - (parseInt(b.getAttribute('data-slend'), 10) || 0) * 60000); });
      });
      var sEndAtGo = view.querySelector('#sEndAtGo');
      if (sEndAtGo) sEndAtGo.addEventListener('click', function () {
        var el = view.querySelector('#sEndAt'), v = el && el.value;
        if (!v) { Util.markInvalid(el, '请选醒来时间'); return; }
        var ms = new Date(v + ':00').getTime();
        if (!(ms > new Date(d.openSleep.start).getTime())) { Util.markInvalid(el, '醒来时间要晚于入睡时间'); return; }
        endAt(ms);
      });
      /* 夜醒单点选择：写入 wakings 并折算 longestMin（U-16 四字段） */
      Array.prototype.forEach.call(view.querySelectorAll('#sWak [data-wak]'), function (b) {
        b.addEventListener('click', function () {
          if (!pending) return;
          var wk = parseInt(b.getAttribute('data-wak'), 10);
          pending.wakings = wk;
          pending.longestMin = Math.max(0, Math.round(durMs(pending) / 60000 / (wk + 1)));
          Storage.save();
          global.App.rerender();
        });
      });

      /* 手动补记：入睡/醒来/夜醒三要素，保存即写入四字段 */
      var mWak = 0;
      Array.prototype.forEach.call(view.querySelectorAll('#sManWak [data-mwak]'), function (b) {
        b.addEventListener('click', function () {
          mWak = parseInt(b.getAttribute('data-mwak'), 10);
          Array.prototype.forEach.call(view.querySelectorAll('#sManWak [data-mwak]'), function (x) { x.classList.remove('active'); });
          b.classList.add('active');
        });
      });
      var manSave = view.querySelector('#sManSave');
      if (manSave) manSave.addEventListener('click', function () {
        var st = view.querySelector('#sManStart').value;
        var en = view.querySelector('#sManEnd').value;
        if (!st || !en) { Util.markInvalid(view.querySelectorAll('#sManStart,#sManEnd'), '请填写入睡和醒来时间'); return; }
        var rec = { id: Util.uid(), start: st + ':00', end: en + ':00', pausedMs: 0, note: null, wakings: mWak, longestMin: null };
        if (!(new Date(rec.end).getTime() > new Date(rec.start).getTime())) {
          Util.markInvalid(view.querySelectorAll('#sManStart,#sManEnd'), '醒来时间要晚于入睡时间');
          return;
        }
        rec.longestMin = Math.max(0, Math.round(durMs(rec) / 60000 / (mWak + 1)));
        d.sleeps.push(rec);
        Storage.save();
        Util.toast('已补记这一觉', 'ok');
        global.App.rerender();
      });
      Array.prototype.forEach.call(view.querySelectorAll('[data-del]'), function (b) {
        b.addEventListener('click', function () {
          var id = b.getAttribute('data-del');
          Util.removeWithUndo(d.sleeps, id, {
            onSave: function () { Storage.save(); },
            onAfter: function () { global.App.rerender(); },
            deletedText: '已删除睡眠记录'
          });
        });
      });
    }
  };

  /* 暴露给首页：最近一觉的最长连续分钟数（U-17 首页主指标用） */
  Modules.sleep._longestMin = longestMin;

  /* ============================================================
     第 106 次 · GAP-01 睡眠跨夜归属 + CN-03 清醒间隔统计
     ------------------------------------------------------------
     两者都是【纯读取计算】：不改 storage.js、不改 DATA_VERSION、
     不新增任何落库字段、不迁移旧数据。全部从既有 sleeps[] 派生。

     GAP-01 的问题不是「数据缺失」而是【口径错位】：
     durMs() 已正确算出扣除暂停后的真实时长（sleep.js:21-26），
     但「这一觉算哪一天」用的是日历日语义 —— 01:30 入睡的觉被算成
     「1 月 2 日」那天，于是「昨晚睡了多久」这个问题在凌晨问时拿到的是
     一个空值/错值。家长真正的直觉是：凌晨 1 点睡的那觉，属于**前一夜**。

     口径（对齐 BabyTrack 官方「Sleep that starts before 6am counts
     toward the night before」）：入睡时刻早于 06:00 的睡眠，归到**前一日**。
     06:00 是刻意选的折中点——比它更早（如 03:00）几乎必然是夜觉，
     而 06:00–07:00 已是晨觉边界；这个阈值只影响【归属到哪天】，
     绝不影响【时长本身】。

     U-19 边界：不因为归属变了就出「睡眠效率」「深睡比例」等结论，
     只做「哪一夜的睡眠合计」这一个中性统计。
     U-24 / U-25：参照只与用户自身历史比，不出「该不该睡这么久」。
     ============================================================ */

  /* 跨夜归属：返回该条睡眠应当归属的「夜」的日期键（yyyy-mm-dd）。
     规则：入睡本地时刻早于 06:00 → 归前一日，否则归当日。
     纯函数，不依赖当前时间，便于单测覆盖。 */
  function nightKeyOf(s) {
    if (!s || !s.start) return null;
    var st = new Date(s.start);
    if (isNaN(st.getTime())) return null;
    var iso = Util.fmtDate(s.start);
    /* getHours() 是本地小时，正是家长直觉里的「几点睡的」 */
    return st.getHours() < 6 ? Util.addDays(iso, -1) : iso;
  }

  /* 「昨夜」= 归属到前一夜的那一组。
     基准恒为「昨天」这一夜，与当前时刻无关 —— 因为 nightKeyOf 已把
     凌晨 1 点入睡的觉归到前一日：
       · 下午 14:00 查 → 昨晚 22:00→今晨 6:00 的那几段（nightKey = 昨天）✓
       · 凌晨 03:00 查 → 同一批（还没结束的不会被算进来，因为 sleeps[] 只存已结束的）✓
       · 深夜 23:00 查 → 仍是昨天那批（不是刚开始的今批）✓
     所以这里不需要按时刻分情况。06:00 阈值只作用在 nightKeyOf（决定单条睡眠归属哪天），
     不用在这里再判一次 —— 那是两件事，混在一起写就会出现两套日期口径。 */
  function lastNightRecords(sleeps, refDate) {
    var now = refDate ? new Date(refDate) : new Date();
    var base = Util.addDays(Util.fmtDate(now), -1);
    return (sleeps || []).filter(function (s) {
      return s && s.end && nightKeyOf(s) === base;
    }).sort(function (a, b) { return new Date(a.start) - new Date(b.start); });
  }

  /* 昨夜的合计睡眠分钟数与段数（不含任何「该睡多久」的参照） */
  function lastNightTotal(sleeps, refDate) {
    var recs = lastNightRecords(sleeps, refDate);
    var ms = 0;
    recs.forEach(function (s) { ms += durMs(s); });
    return { minutes: Math.max(0, Math.round(ms / 60000)), segs: recs.length, records: recs };
  }

  /* ============================================================
     CN-03 清醒间隔统计
     ------------------------------------------------------------
     数据基础已有（WAKE_WINDOWS，sleep.js:230-240），但那只是【按月龄给
     一个哄睡时机参考】，完全没有统计用户自己实际清醒了多久。

     清醒间隔 = 相邻两觉之间的醒来时刻到下一觉入睡时刻。
     注意口径细节：
       · 只统计【已结束】且相邻的两觉，中断的计时（openSleep）不参与；
       · 同一夜内的间隔归到同一个「夜」，跨夜的间隔单独归到后一夜
         （用 nightKeyOf 保证与 GAP-01 同一套归属，不出现两套日期口径）；
       · 间隔为负（补记时录入错乱）或为 0 不计入，避免污染统计。
     只出统计数字与用户自身区间，不与人群参照对比（U-25）。
     ============================================================ */
  function wakeGaps(sleeps, opts) {
    opts = opts || {};
    /* 第 125 次：原 `opts.days || 7` 会把调用方显式传入的 0 吞成 7。
       下方 `if (days > 0 ...)` 分支说明「传 0 = 不限天数」是本接口本意，
       与 `|| 7` 直接冲突（0 被改写后就永远不会走那条分支）。
       改用显式 null 判断，只在「未传」时套默认 7。 */
    var days = (opts.days == null) ? 7 : opts.days;
    var done = (sleeps || []).filter(function (s) { return s && s.start && s.end; })
      .sort(function (a, b) { return new Date(a.start) - new Date(b.start); });
    var out = [];
    for (var i = 1; i < done.length; i++) {
      var prev = done[i - 1], cur = done[i];
      /* 清醒起点 = 上一觉醒来；清醒终点 = 下一觉入睡 */
      var gapMin = Math.round((new Date(cur.start) - new Date(prev.end)) / 60000);
      if (!(gapMin > 0)) continue;             /* 负数=补记错乱，0=连续，不计 */
      /* 归属夜：用「醒来那一刻」所属的夜，也就是上一觉的夜 */
      var nk = nightKeyOf(prev);
      if (!nk) continue;
      out.push({ minutes: gapMin, night: nk, fromEnd: prev.end, toStart: cur.start });
    }
    if (days > 0 && out.length) {
      var cut = Util.addDays(Util.todayISO(), -(days - 1));
      out = out.filter(function (g) { return g.night >= cut; });
    }
    return out;
  }

  /* 清醒间隔的自身历史区间（U-24：只用近 N 天自己的数据） */
  function wakeGapSummary(sleeps, days) {
    /* 第 125 次：同上，`days || 7` 吞 0；显式判断只在未传时兜底。 */
    var ds = (days == null) ? 7 : days;
    var gs = wakeGaps(sleeps, { days: ds });
    if (!gs.length) return null;
    var vs = gs.map(function (g) { return g.minutes; }).sort(function (a, b) { return a - b; });
    return {
      count: vs.length,
      min: vs[0],
      max: vs[vs.length - 1],
      median: vs[Math.floor((vs.length - 1) / 2)],
      days: ds
    };
  }

  /* 对外暴露（供单测与后续页面复用；均为纯函数，不写库） */
  Modules.sleep._nightKeyOf = nightKeyOf;
  Modules.sleep._lastNightRecords = lastNightRecords;
  Modules.sleep._lastNightTotal = lastNightTotal;
  Modules.sleep._wakeGaps = wakeGaps;
  Modules.sleep._wakeGapSummary = wakeGapSummary;

  /* 第 85 次（C2 磁贴副文案）：清醒窗口数值表——与 knowledge.js KN-S-1~6 同区间
     同源（AAP 共识的多源近似值），这里只出紧凑数字串给首页磁贴一行带过；
     完整措辞与困意信号仍由 sleep 页「睡眠参考」卡呈现。展示时一律带
     「参考」二字（home.js 拼接），不做达标判断、不与用户数据对照（U-25）。 */
  var WAKE_WINDOWS = [
    [0, 90, '1–1.5 小时'], [91, 180, '1.5–2.5 小时'], [181, 270, '2.5–3 小时'],
    [271, 365, '3–4 小时'], [366, 540, '4–5 小时'], [541, 1095, '4–6 小时']
  ];
  Modules.sleep._wakeWindow = function (ageDays) {
    if (ageDays == null || ageDays < 0) return null;
    for (var w = 0; w < WAKE_WINDOWS.length; w++) {
      if (ageDays >= WAKE_WINDOWS[w][0] && ageDays <= WAKE_WINDOWS[w][1]) return WAKE_WINDOWS[w][2];
    }
    return null; /* 满 3 岁后个体差异太大，不再给参考 */
  };

  setInterval(tick, 1000);
})(window);
