/**
 * contraction.js - 宫缩计时
 * 记录每次宫缩开始；用 START-to-START 计算间隔，结合开始/结束计算时长；
 * 显示最近几次趋势；显式免责声明；支持导出时间线（文本/JSON）。
 */
(function (global) {
  'use strict';
  var Storage = global.Storage, Util = global.Util;
  var Modules = global.Modules = global.Modules || {};

  function openC() { return (Storage.get() || {}).openContraction || null; } /* 第 146 次：早于 load 的定时器调用时判空 */

  function cTick() {
    var oc = openC();
    var el = document.getElementById('cTimer');
    if (!oc || !el) return;
    el.textContent = Util.fmtDuration(Date.now() - new Date(oc.start).getTime());
  }

  /* 第 186 次：规则只收整数，导入脏值一律当未设置 */
  function normRule(r) {
    if (!r || typeof r !== 'object') return null;
    var iv = parseInt(r.iv, 10), du = parseInt(r.dur, 10), sp = parseInt(r.span, 10);
    if (!(iv >= 1 && iv <= 30 && du >= 10 && du <= 180 && sp >= 10 && sp <= 240)) return null;
    return { iv: iv, dur: du, span: sp };
  }
  /* 第 197 次：破水 / 见红事件。只记时刻与事实，提示语是通用就医信号，不判断是否临产。
     显示只走这张表，导入的坏 type 查不到就不显示。 */
  var LABOR = {
    water: { label: '破水', tip: '破水后请尽快联系医院或前往就医，路上怎么做按医生交代。记下时间和羊水颜色，到医院告诉医生。' },
    show:  { label: '见红', tip: '少量见红常见于临产前几天。若出血像月经量或更多、颜色鲜红，或伴持续腹痛、胎动明显减少，请立即就医。' }
  };
  function laborList(d) {
    return (d.laborEvents || []).filter(function (e) { return e && LABOR[e.type] && e.time && !isNaN(new Date(e.time).getTime()); })
      .sort(function (a, b) { return new Date(b.time) - new Date(a.time); });
  }
  function agoText(ms) {
    var m = Math.max(0, Math.round(ms / 60000));
    return m < 1 ? '不到 1 分钟' : m < 60 ? m + ' 分钟' : (Math.floor(m / 60) + ' 小时' + (m % 60 ? ' ' + (m % 60) + ' 分' : ''));
  }

  Modules.contraction = {
    id: 'contraction',
    title: '宫缩',
    render: function (view) {
      var d = Storage.get();
      var oc = openC();
      var html = '';

      html += '<div class="warn-box"><p>本工具仅用于自我观察记录，<b>仅供参考，一切以医生判断为准</b>。' +
        '如有出血、破水、剧烈腹痛或任何担心，请及时联系医生/就医。</p></div>';

      html += '<div class="card"><h2>宫缩计时</h2>';
      if (oc) {
        html += '<p class="big">本次时长 <span id="cTimer">--</span></p>';
        html += '<p class="hint">开始：' + Util.fmtDateTime(oc.start) + '</p>';
        /* 第 186 次：强度（自己的感受，轻/中/强），计时中随手点 */
        html += '<span class="lbl-text">这次感觉</span><div class="seg" id="cInt">'
          + [['1', '轻'], ['2', '中'], ['3', '强']].map(function (o) {
            return '<button type="button" class="seg-btn' + (String(oc.intensity) === o[0] ? ' active' : '') + '" data-int="' + o[0] + '">' + o[1] + '</button>';
          }).join('') + '</div>';
        html += '<button class="btn btn-primary" id="cEnd">结束本次</button> ';
        html += '<button class="btn" id="cCancel">取消</button>';
      } else {
        html += '<button class="btn btn-primary btn-save" id="cStart">记录一次宫缩（开始）</button>';
        html += '<p class="hint">每次宫缩到来时点"开始"，结束时点"结束"。间隔按"下一次开始 − 本次开始"(START-to-START)计算。</p>';
      }
      html += '</div>';

      /* 第 197 次：破水 / 见红——一键记录，最近 48 小时内的事件顶在卡里显示「已过多久」 */
      var lev = laborList(d);
      html += '<div class="card labor-ev"><h2>破水 · 见红</h2>';
      var recent = lev.filter(function (e) { return Date.now() - new Date(e.time).getTime() <= 48 * 3600000; });
      recent.slice(0, 2).forEach(function (e) {
        var L = LABOR[e.type];
        html += '<div class="warn-box"><p><b>' + L.label + '</b> ' + Util.fmtDateTime(e.time) + '，已过 ' + agoText(Date.now() - new Date(e.time).getTime()) + '。'
          + L.tip + '</p></div>';
      });
      html += '<p class="hint">发生时点一下记下时间；不是现在发生的，先选时刻再点。</p>';
      html += Util.timePickHTML('leTime');
      html += '<div class="labor-btns">'
        + '<button type="button" class="btn" data-labor="water">记录破水</button>'
        + '<button type="button" class="btn" data-labor="show">记录见红</button></div>';
      if (lev.length) {
        html += '<ul class="list">';
        lev.slice(0, 6).forEach(function (e) {
          html += '<li>' + icon('contraction') + '<span class="li-main"><b>' + LABOR[e.type].label + '</b></span>'
            + '<span class="li-sub">' + Util.fmtDateTime(e.time) + '</span>'
            + '<button class="icon-btn" data-ledel="' + Util.escapeHtml(String(e.id)) + '" aria-label="删除" title="删除">' + icon('trash') + '</button></li>';
        });
        html += '</ul>';
      }
      html += '</div>';

      /* 第 186 次：近一小时统计 + 用户按医嘱填写的提示规则（中性提示，不下结论） */
      var nowMs = Date.now();
      var done = (d.contractions || []).filter(function (c) { return c.start && c.end; })
        .sort(function (a, b) { return new Date(a.start) - new Date(b.start); });
      var hour = done.filter(function (c) { return nowMs - new Date(c.start).getTime() <= 3600000; });
      html += '<div class="card"><h2>近一小时</h2>';
      if (hour.length) {
        var avgDur = hour.reduce(function (s, c) { return s + (new Date(c.end) - new Date(c.start)); }, 0) / hour.length;
        var ivs = [];
        for (var hi = 0; hi < done.length; hi++) {
          if (hi > 0 && nowMs - new Date(done[hi].start).getTime() <= 3600000) ivs.push(new Date(done[hi].start) - new Date(done[hi - 1].start));
        }
        var avgIv = ivs.length ? ivs.reduce(function (s, x) { return s + x; }, 0) / ivs.length : null;
        html += '<div class="stat-row">'
          + '<div class="stat"><span class="stat-num">' + hour.length + '<i class="stat-unit">次</i></span><span class="stat-lbl">次数</span></div>'
          + '<div class="stat"><span class="stat-num">' + Math.round(avgDur / 1000) + '<i class="stat-unit">秒</i></span><span class="stat-lbl">平均时长</span></div>'
          + (avgIv != null ? '<div class="stat"><span class="stat-num">' + (avgIv / 60000).toFixed(1) + '<i class="stat-unit">分</i></span><span class="stat-lbl">平均间隔</span></div>' : '')
          + '</div>';
        var rule = normRule(d.pregnancy && d.pregnancy.contractionRule);
        if (rule && rule.iv && rule.dur && rule.span) {
          /* 规则窗口内：每次间隔 ≤ iv 分、每次时长 ≥ dur 秒、且覆盖 ≥ span 分钟 */
          /* 窗口放宽一个间隔，避免「整点前那一次」刚好被切掉；最近一次结束距现在不能超过一个间隔 */
          var winStart = nowMs - (rule.span + rule.iv) * 60000;
          var inWin = done.filter(function (c) { return new Date(c.start).getTime() >= winStart; });
          var ok = inWin.length >= 2
            && (new Date(inWin[inWin.length - 1].start) - new Date(inWin[0].start)) >= (rule.span - rule.iv) * 60000
            && (nowMs - new Date(inWin[inWin.length - 1].end).getTime()) <= rule.iv * 60000;
          for (var wi = 0; ok && wi < inWin.length; wi++) {
            if ((new Date(inWin[wi].end) - new Date(inWin[wi].start)) < rule.dur * 1000) ok = false;
            if (wi > 0 && (new Date(inWin[wi].start) - new Date(inWin[wi - 1].start)) > rule.iv * 60000) ok = false;
          }
          html += '<p class="hint">' + (ok
            ? '最近 ' + rule.span + ' 分钟的记录已符合你填写的「间隔 ≤' + rule.iv + ' 分、每次 ≥' + rule.dur + ' 秒」。请按医生交代的做。'
            : '最近 ' + rule.span + ' 分钟尚未符合你填写的「间隔 ≤' + rule.iv + ' 分、每次 ≥' + rule.dur + ' 秒」。') + '</p>';
        }
      } else {
        html += '<p class="hint">最近一小时没有已结束的宫缩记录。</p>';
      }
      var cr = normRule(d.pregnancy && d.pregnancy.contractionRule) || {};
      html += '<details class="c-rule"><summary>医生交代的提示规则（可选）</summary>'
        + '<p class="hint">按产检医生告诉你的标准填（例如「5-1-1」），只做中性提示，不替你判断是否临产。</p>'
        + '<div class="row"><label>间隔 ≤（分）<input type="number" id="crIv" min="1" max="30" inputmode="numeric" value="' + (cr.iv || '') + '"></label>'
        + '<label>每次 ≥（秒）<input type="number" id="crDur" min="10" max="180" inputmode="numeric" value="' + (cr.dur || '') + '"></label>'
        + '<label>持续（分）<input type="number" id="crSpan" min="10" max="240" inputmode="numeric" value="' + (cr.span || '') + '"></label></div>'
        + '<div class="row"><button type="button" class="btn-mini" id="crSave">保存规则</button>'
        + (cr.iv ? '<button type="button" class="btn-mini" id="crClear">清除</button>' : '') + '</div></details>';
      html += '</div>';

      html += '<div class="card"><h2>最近几次</h2>';
      var list = (d.contractions || []).slice().sort(function (a, b) { return new Date(a.start) - new Date(b.start); });
      if (list.length) {
        html += '<ul class="list">';
        for (var i = 0; i < list.length; i++) {
          var c = list[i];
          var dur = c.end ? (new Date(c.end).getTime() - new Date(c.start).getTime()) : null;
          var interval = (i > 0) ? (new Date(c.start).getTime() - new Date(list[i - 1].start).getTime()) : null;
          html += '<li>' + icon('contraction') + '<span>#' + (i + 1) + ' ' + Util.fmtDateTime(c.start) +
            (dur != null ? ' ｜ 时长 ' + Util.fmtDuration(dur) : ' ｜ 进行中') +
            (interval != null ? ' ｜ 距上次 ' + Util.fmtDuration(interval) : '') +
            (c.intensity ? ' ｜ ' + ({ 1: '轻', 2: '中', 3: '强' }[c.intensity] || '') : '') +
            '</span><button class="icon-btn" data-del="' + c.id + '" aria-label="删除" title="删除">' + icon('trash') + '</button></li>';
        }
        html += '</ul>';
        html += '<button class="btn" id="cExport">导出时间线（文本）</button> ';
        html += '<button class="btn" id="cExportJson">导出 JSON</button>';
      } else {
        html += '<div class="empty-state"><span class="es-ico">' + icon('contraction') + '</span><p>还没有宫缩记录</p><span class="hint">宫缩开始时点上面的按钮计时。</span></div>';
      }
      html += '</div>';

      /* 第 59 次：医学提示（遵医嘱） */
      html += '<p class="hint med-note">宫缩记录仅供产程参考；宫缩规律加密、破水或见红时，请及时联系医院或医生。</p>';

      view.innerHTML = html;
      cTick();

      var cStart = view.querySelector('#cStart');
      if (cStart) cStart.addEventListener('click', function () {
        d.openContraction = { id: Util.uid(), start: Util.nowLocal() };
        Storage.save(); global.App.rerender();
      });
      Array.prototype.forEach.call(view.querySelectorAll('[data-int]'), function (b) {
        b.addEventListener('click', function () {
          if (!d.openContraction) return;
          d.openContraction.intensity = parseInt(b.getAttribute('data-int'), 10);
          Storage.save(); global.App.rerender();
        });
      });
      var crSave = view.querySelector('#crSave');
      if (crSave) crSave.addEventListener('click', function () {
        var iv = parseInt(view.querySelector('#crIv').value, 10);
        var du = parseInt(view.querySelector('#crDur').value, 10);
        var sp = parseInt(view.querySelector('#crSpan').value, 10);
        if (!(iv >= 1 && iv <= 30 && du >= 10 && du <= 180 && sp >= 10 && sp <= 240)) {
          Util.toast('请填完整：间隔 1–30 分、每次 10–180 秒、持续 10–240 分', 'warn'); return;
        }
        if (!d.pregnancy || typeof d.pregnancy !== 'object') d.pregnancy = {};
        d.pregnancy.contractionRule = { iv: iv, dur: du, span: sp };
        Storage.save(); Util.toast('已保存', 'ok'); global.App.rerender();
      });
      var crClear = view.querySelector('#crClear');
      if (crClear) crClear.addEventListener('click', function () {
        if (d.pregnancy) delete d.pregnancy.contractionRule;
        Storage.save(); global.App.rerender();
      });
      var cEnd = view.querySelector('#cEnd');
      if (cEnd) cEnd.addEventListener('click', function () {
        d.openContraction.end = Util.nowLocal();
        d.contractions.push(d.openContraction);
        var durMs = new Date(d.openContraction.end).getTime() - new Date(d.openContraction.start).getTime();
        d.openContraction = null;
        if (Storage.save()) Util.toast('已记录：本次宫缩 ' + Util.fmtDuration(Math.max(0, durMs)), 'ok'); /* C1 */
        global.App.rerender();
      });
      var cCancel = view.querySelector('#cCancel');
      if (cCancel) cCancel.addEventListener('click', function () {
        d.openContraction = null; Storage.save(); global.App.rerender();
      });
      Array.prototype.forEach.call(view.querySelectorAll('[data-labor]'), function (b) {
        b.addEventListener('click', function () {
          var tp = b.getAttribute('data-labor');
          var st = Util.stampFrom(view, 'leTime');
          if (!st) return;
          if (!Array.isArray(d.laborEvents)) d.laborEvents = [];
          var ev = { id: Util.uid(), time: st, type: tp, note: null };
          d.laborEvents.push(ev);
          if (Storage.save()) Util.toast('已记录' + LABOR[tp].label + ' ' + st.slice(11, 16), 'ok', { label: '撤销', onClick: function () {
            for (var i = d.laborEvents.length - 1; i >= 0; i--) if (d.laborEvents[i].id === ev.id) { d.laborEvents.splice(i, 1); break; }
            Storage.save(); global.App.rerender();
          } });
          global.App.rerender();
        });
      });
      Array.prototype.forEach.call(view.querySelectorAll('[data-ledel]'), function (b) {
        b.addEventListener('click', function () {
          Util.removeWithUndo(d.laborEvents, b.getAttribute('data-ledel'), {
            onSave: function () { Storage.save(); },
            onAfter: function () { global.App.rerender(); },
            deletedText: '已删除'
          });
        });
      });
      var cExp = view.querySelector('#cExport');
      if (cExp) cExp.addEventListener('click', function () { exportTimeline(false); });
      var cExpJ = view.querySelector('#cExportJson');
      if (cExpJ) cExpJ.addEventListener('click', function () { exportTimeline(true); });

      Array.prototype.forEach.call(view.querySelectorAll('[data-del]'), function (b) {
        b.addEventListener('click', function () {
          var id = b.getAttribute('data-del');
          Util.removeWithUndo(d.contractions, id, {
            onSave: function () { if (d.openContraction && d.openContraction.id === id) d.openContraction = null; Storage.save(); },
            onAfter: function () { global.App.rerender(); },
            deletedText: '已删除宫缩记录'
          });
        });
      });

      function exportTimeline(json) {
        var arr = (d.contractions || []).slice().sort(function (a, b) { return new Date(a.start) - new Date(b.start); });
        if (json) {
          Util.download('宫缩时间线_' + Util.todayISO() + '.json', JSON.stringify(arr, null, 2), 'application/json');
        } else {
          var lines = ['咿呀记 宫缩时间线（仅供参考）', '生成时间：' + Util.nowLocal(), ''];
          for (var i = 0; i < arr.length; i++) {
            var cc = arr[i];
            var dur = cc.end ? Util.fmtDuration(new Date(cc.end).getTime() - new Date(cc.start).getTime()) : '未结束';
            var iv = i > 0 ? Util.fmtDuration(new Date(cc.start).getTime() - new Date(arr[i - 1].start).getTime()) : '-';
            lines.push('第' + (i + 1) + '次 开始 ' + Util.fmtDateTime(cc.start) + ' 时长 ' + dur + ' 距上次 ' + iv
              + (cc.intensity ? ' 强度 ' + ({ 1: '轻', 2: '中', 3: '强' }[cc.intensity] || '') : ''));
          }
          /* 第 197 次：破水/见红一并写进时间线，按时刻正序 */
          var le = laborList(d).slice().reverse();
          if (le.length) {
            lines.push('', '破水 / 见红');
            le.forEach(function (e) { lines.push(LABOR[e.type].label + ' ' + Util.fmtDateTime(e.time)); });
          }
          Util.download('宫缩时间线_' + Util.todayISO() + '.txt', lines.join('\n'), 'text/plain;charset=utf-8');
        }
      }
    }
  };

  setInterval(cTick, 1000);
})(window);
