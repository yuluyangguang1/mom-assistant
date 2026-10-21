/**
 * bath.js - 洗澡记录（第 132 次 · 对标 Cali 21 工具里的 bath-tracker）
 *
 * 定位：低频但需要留痕的护理动作——记「什么时候洗的、洗了多久、有没有异常」。
 * 只记录不判读（沿用 U-25 口径）：不评价频率、不给「应该多久洗一次」的结论。
 * 数据：d.baths = [{ id, time, minutes, note }]，time 为本地 yyyy-mm-ddThh:mm:ss。
 */
(function (global) {
  'use strict';
  var Storage = global.Storage, Util = global.Util, Care = global.Care;
  var Modules = global.Modules = global.Modules || {};

  Modules.bath = {
    id: 'bath',
    title: '洗澡',
    render: function (view) {
      var d = Storage.get();
      /* 第 131 次起的照护日口径：凌晨洗的澡算前一天，与喂养/睡眠同一把尺子 */
      var DS = Util.dayStartHour(d);
      var dayNow = Util.dayKeyOf(new Date(), DS);
      var all = d.baths || [];
      var html = '';

      html += '<div class="warn-box"><p>水温建议 37–38°C、水深不超过 5 厘米，' +
        '<b>全程不要离开宝宝</b>。这里只做记录，不替代护理与就医建议。</p></div>';

      /* 第 138 次（会话式记录）：开始 → 计时 → 结束。
         代码形状与 sleep.js 的「计时中」卡一致，逻辑全在 care.js（三个模块共用一份）。 */
      var cs = Care.mine(d, 'bath');
      if (cs) {
        html += '<div class="card care-live" data-accent="bath"><h2>洗澡中</h2>'
          + '<div class="fetal-hero"><span class="stat-num" id="careClock">00:00</span>'
          + '<span class="hint">' + Util.fmtDateTime(cs.start) + ' 开始</span></div>'
          + '<div class="row"><button class="btn btn-primary" id="careEnd" type="button">结束并记录</button>'
          + '<button class="btn" id="careCancel" type="button">取消</button></div>'
          + '</div>';
      } else if (Care.other(d, 'bath')) {
        html += '<div class="card"><h2>' + Care.KINDS[Care.open(d).kind].title + '还在计时</h2>'
          + '<p class="hint">先去把「' + Care.KINDS[Care.open(d).kind].title +
          '」结束，这里才能开始新的计时（同时只进行一项）。</p></div>';
      } else {
        html += '<div class="card"><h2>开始洗澡</h2>'
          + '<p class="hint">下水前点一下开始，洗完点结束，时长自动算好——不用事后回想。</p>'
          + '<button class="btn btn-primary" id="careStart" type="button">开始计时</button></div>';
      }

      /* 记一次 */
      html += '<div class="card"><h2>补记一次洗澡</h2>';
      html += '<label>时长（分钟，可选）<input type="number" id="baMin" min="1" max="180" ' +
        'inputmode="numeric" placeholder="如 10"></label>';
      html += '<label>备注（可选）<input type="text" id="baNote" maxlength="40" ' +
        'placeholder="如 用了新浴盆 / 洗头哭了"></label>';
      html += '<button class="btn btn-primary" id="baSave">保存</button></div>';

      /* 统计 */
      var monthKey = Util.todayISO().slice(0, 7);
      var monthCount = all.filter(function (r) { return String(r.time).slice(0, 7) === monthKey; }).length;
      var todayCount = all.filter(function (r) { return Util.dayKeyOf(r.time, DS) === dayNow; }).length;
      var last = all.slice().sort(function (a, b) { return new Date(b.time) - new Date(a.time); })[0];

      html += '<div class="card"><h2>小结</h2><ul class="kv">';
      html += '<li>今天：<b>' + todayCount + ' 次</b></li>';
      html += '<li>本月：<b>' + monthCount + ' 次</b></li>';
      if (last) html += '<li>上次：' + Util.fmtDateTime(last.time) +
        (last.minutes ? '（' + last.minutes + ' 分钟）' : '') + '</li>';
      html += '</ul>';
      if (!all.length) html += '<p class="hint">洗过就记一次，以后回看能对上湿疹、红屁股这类问题的时点。</p>';
      html += '</div>';

      /* 最近记录 */
      html += '<div class="card"><h2>最近记录</h2>';
      var list = all.slice().sort(function (a, b) { return new Date(b.time) - new Date(a.time); }).slice(0, 20);
      if (list.length) {
        html += '<ul class="list">';
        list.forEach(function (r) {
          html += '<li><span class="row-ico">' + icon('bath') + '</span>'
            + '<span class="li-main"><b>' + Util.fmtDateTime(r.time) + '</b></span>'
            + '<span class="li-sub">' + (r.note ? Util.escapeHtml(r.note) : '') + '</span>'
            + '<span class="li-num">' + (r.minutes ? r.minutes + '<i>分</i>' : '<i>—</i>') + '</span>'
            + '<button class="icon-btn" data-del="' + r.id + '" aria-label="删除" title="删除">' +
            icon('trash') + '</button></li>';
        });
        html += '</ul>';
      } else {
        html += '<div class="empty-state"><span class="es-ico">' + icon('bath') + '</span><p>还没有洗澡记录</p><span class="hint">洗完顺手记一下就好。</span></div>';
      }
      html += '</div>';

      view.innerHTML = html;

      /* 第 138 次：会话三个按钮 + 秒表自走 */
      var clock = view.querySelector('#careClock');
      if (clock) {
        var timer = setInterval(function () {
          if (!view.contains(clock)) { clearInterval(timer); return; }   /* 已切页：自清理 */
          clock.textContent = Util.fmtClock(Care.elapsed(d, 'bath'));
        }, 1000);
      }
      var careStart = view.querySelector('#careStart');
      if (careStart) careStart.addEventListener('click', function () {
        if (Care.start(d, Storage, 'bath')) { Util.toast('开始计时', 'ok'); global.App.rerender(); }
      });
      var careEnd = view.querySelector('#careEnd');
      if (careEnd) careEnd.addEventListener('click', function () {
        var r = Care.finish(d, Storage, 'bath');
        if (r && r.cancelled) { Util.toast('计时数据异常，已取消', 'warn'); }
        else if (r) { Util.toast('已记录洗澡 ' + r.minutes + ' 分钟', 'ok'); }
        global.App.rerender();
      });
      var careCancel = view.querySelector('#careCancel');
      if (careCancel) careCancel.addEventListener('click', function () {
        Care.cancel(d, Storage); Util.toast('已取消计时', 'ok'); global.App.rerender();
      });

      view.querySelector('#baSave').addEventListener('click', function () {
        var minEl = view.querySelector('#baMin');
        var min = parseInt(minEl.value, 10);
        if (minEl.value !== '' && (!isFinite(min) || min <= 0 || min > 180)) {
          Util.markInvalid(minEl, '时长填 1–180 分钟，或留空');
          return;
        }
        var rec = {
          id: Util.uid(), time: Util.nowLocal(),
          minutes: (minEl.value === '' ? null : min),
          note: (view.querySelector('#baNote').value || '').trim() || null
        };
        d.baths.push(rec);
        if (Storage.save()) Util.toast('已记录洗澡', 'ok');
        global.App.rerender();
      });

      Array.prototype.forEach.call(view.querySelectorAll('[data-del]'), function (b) {
        b.addEventListener('click', function () {
          Util.removeWithUndo(d.baths, b.getAttribute('data-del'), {
            onSave: function () { Storage.save(); },
            onAfter: function () { global.App.rerender(); },
            deletedText: '已删除洗澡记录'
          });
        });
      });
    }
  };
})(window);
