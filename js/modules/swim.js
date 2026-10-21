/**
 * swim.js - 游泳记录（第 132 次 · 对标 Cali 21 工具里的 swimming-tracker）
 *
 * 定位：记「什么时候游的、游了多久」。婴儿游泳的安全边界比成人严格得多，
 * 所以页面顶部放一条安全提示（看护、时长、水温），但不给「几个月能游」的判读——
 * 那属于儿科/护理建议，不是记录工具该下的结论（U-25）。
 * 数据：d.swims = [{ id, time, minutes, note }]。
 */
(function (global) {
  'use strict';
  var Storage = global.Storage, Util = global.Util, Care = global.Care;
  var Modules = global.Modules = global.Modules || {};

  Modules.swim = {
    id: 'swim',
    title: '游泳',
    render: function (view) {
      var d = Storage.get();
      var DS = Util.dayStartHour(d);
      var dayNow = Util.dayKeyOf(new Date(), DS);
      var all = d.swims || [];
      var html = '';

      html += '<div class="warn-box"><p><b>宝宝在水里时，大人必须始终用手护着，一秒都不能离开。</b>' +
        '水温建议 32–34°C、单次不超过 15–20 分钟；皮肤破损、发热或刚打完疫苗时先别游。</p></div>';

      /* 第 138 次（会话式记录）：与 bath.js 同构，逻辑全在 care.js */
      var cs = Care.mine(d, 'swim');
      if (cs) {
        html += '<div class="card care-live" data-accent="swim"><h2>游泳中</h2>'
          + '<div class="fetal-hero"><span class="stat-num" id="careClock">00:00</span>'
          + '<span class="hint">' + Util.fmtDateTime(cs.start) + ' 开始</span></div>'
          + '<div class="row"><button class="btn btn-primary" id="careEnd" type="button">结束并记录</button>'
          + '<button class="btn" id="careCancel" type="button">取消</button></div>'
          + '</div>';
      } else if (Care.other(d, 'swim')) {
        html += '<div class="card"><h2>' + Care.KINDS[Care.open(d).kind].title + '还在计时</h2>'
          + '<p class="hint">先去把「' + Care.KINDS[Care.open(d).kind].title +
          '」结束，这里才能开始新的计时（同时只进行一项）。</p></div>';
      } else {
        html += '<div class="card"><h2>开始游泳</h2>'
          + '<p class="hint">下水点一下开始，上岸点结束，时长自动算好——水里的时候不用惦记记。</p>'
          + '<button class="btn btn-primary" id="careStart" type="button">开始计时</button></div>';
      }

      html += '<div class="card"><h2>补记一次游泳</h2>';
      html += '<label>时长（分钟，可选）<input type="number" id="swMin" min="1" max="120" ' +
        'inputmode="numeric" placeholder="如 15"></label>';
      html += '<label>备注（可选）<input type="text" id="swNote" maxlength="40" ' +
        'placeholder="如 第一次下水 / 有点怕"></label>';
      html += '<button class="btn btn-primary" id="swSave">保存</button></div>';

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
      if (!all.length) html += '<p class="hint">游过就记一次，回看时能对上当时的月龄和反应。</p>';
      html += '</div>';

      html += '<div class="card"><h2>最近记录</h2>';
      var list = all.slice().sort(function (a, b) { return new Date(b.time) - new Date(a.time); }).slice(0, 20);
      if (list.length) {
        html += '<ul class="list">';
        list.forEach(function (r) {
          html += '<li><span class="row-ico">' + icon('swim') + '</span>'
            + '<span class="li-main"><b>' + Util.fmtDateTime(r.time) + '</b></span>'
            + '<span class="li-sub">' + (r.note ? Util.escapeHtml(r.note) : '') + '</span>'
            + '<span class="li-num">' + (r.minutes ? r.minutes + '<i>分</i>' : '<i>—</i>') + '</span>'
            + '<button class="icon-btn" data-del="' + r.id + '" aria-label="删除" title="删除">' +
            icon('trash') + '</button></li>';
        });
        html += '</ul>';
      } else {
        html += '<div class="empty-state"><span class="es-ico">' + icon('swim') + '</span><p>还没有游泳记录</p><span class="hint">游完顺手记一下。</span></div>';
      }
      html += '</div>';

      view.innerHTML = html;

      /* 第 138 次：会话三个按钮 + 秒表自走（切页后自清理，见 bath.js 同款注释） */
      var clock = view.querySelector('#careClock');
      if (clock) {
        var timer = setInterval(function () {
          if (!view.contains(clock)) { clearInterval(timer); return; }
          clock.textContent = Util.fmtClock(Care.elapsed(d, 'swim'));
        }, 1000);
      }
      var careStart = view.querySelector('#careStart');
      if (careStart) careStart.addEventListener('click', function () {
        if (Care.start(d, Storage, 'swim')) { Util.toast('开始计时', 'ok'); global.App.rerender(); }
      });
      var careEnd = view.querySelector('#careEnd');
      if (careEnd) careEnd.addEventListener('click', function () {
        var r = Care.finish(d, Storage, 'swim');
        if (r && r.cancelled) { Util.toast('计时数据异常，已取消', 'warn'); }
        else if (r) { Util.toast('已记录游泳 ' + r.minutes + ' 分钟', 'ok'); }
        global.App.rerender();
      });
      var careCancel = view.querySelector('#careCancel');
      if (careCancel) careCancel.addEventListener('click', function () {
        Care.cancel(d, Storage); Util.toast('已取消计时', 'ok'); global.App.rerender();
      });

      view.querySelector('#swSave').addEventListener('click', function () {
        var minEl = view.querySelector('#swMin');
        var min = parseInt(minEl.value, 10);
        if (minEl.value !== '' && (!isFinite(min) || min <= 0 || min > 120)) {
          Util.markInvalid(minEl, '时长填 1–120 分钟，或留空');
          return;
        }
        var rec = {
          id: Util.uid(), time: Util.nowLocal(),
          minutes: (minEl.value === '' ? null : min),
          note: (view.querySelector('#swNote').value || '').trim() || null
        };
        d.swims.push(rec);
        if (Storage.save()) Util.toast('已记录游泳', 'ok');
        global.App.rerender();
      });

      Array.prototype.forEach.call(view.querySelectorAll('[data-del]'), function (b) {
        b.addEventListener('click', function () {
          Util.removeWithUndo(d.swims, b.getAttribute('data-del'), {
            onSave: function () { Storage.save(); },
            onAfter: function () { global.App.rerender(); },
            deletedText: '已删除游泳记录'
          });
        });
      });
    }
  };
})(window);
