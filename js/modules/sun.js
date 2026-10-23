/**
 * sun.js - 日晒记录（第 132 次 · 对标 Cali 21 工具里的 sun-exposure）
 *
 * 定位：晒黄疸 / 补维D 的场景下，家长需要记「晒了多久、晒的哪儿」。
 * 明确不做的一件事：**不把日晒当成退黄手段去推荐**——新生儿黄疸的处理必须由医生判断，
 * 蓝光治疗与「晒太阳」不是一回事。页面只记录 + 一条防晒提示（U-25 口径的延续）。
 * 数据：d.suns = [{ id, time, minutes, area, note }]，area ∈ face/limbs/all/hip。
 */
(function (global) {
  'use strict';
  var Storage = global.Storage, Util = global.Util, Care = global.Care;
  var Modules = global.Modules = global.Modules || {};

  /* 部位选项：与 Cali SunExposureRecord 的「上方/下方光照」不同——我们不做光疗设备，
     改成家长真正会记的「晒了哪儿」。 */
  var AREAS = [
    { v: 'face', label: '面部' },
    { v: 'limbs', label: '四肢' },
    { v: 'all', label: '全身' },
    { v: 'hip', label: '臀部' }
  ];

  function areaLabel(v) {
    for (var i = 0; i < AREAS.length; i++) if (AREAS[i].v === v) return AREAS[i].label;
    return '';
  }

  Modules.sun = {
    id: 'sun',
    title: '日晒',
    render: function (view) {
      var d = Storage.get();
      var DS = Util.dayStartHour(d);
      var dayNow = Util.dayKeyOf(new Date(), DS);
      var all = d.suns || [];
      var html = '';

      html += '<div class="warn-box"><p>避开 10:00–16:00 的强紫外线，<b>6 月龄以下避免阳光直射</b>；' +
        '隔着玻璃晒基本没有效果。日晒不能替代医生的退黄判断，黄疸请按医嘱复查。</p></div>';

      /* 第 138 次（会话式记录）：与 bath.js 同构，逻辑全在 care.js */
      var cs = Care.mine(d, 'sun');
      if (cs) {
        html += '<div class="card care-live" data-accent="sun"><h2>日晒中</h2>'
          + '<div class="fetal-hero"><span class="stat-num" id="careClock">00:00</span>'
          + '<span class="hint">' + Util.fmtDateTime(cs.start) + ' 开始</span></div>'
          + '<div class="row"><button class="btn btn-primary" id="careEnd" type="button">结束并记录</button>'
          + '<button class="btn" id="careCancel" type="button">取消</button></div>'
          + '</div>';
      } else if (Care.other(d, 'sun')) {
        html += '<div class="card"><h2>' + Care.KINDS[Care.open(d).kind].title + '还在计时</h2>'
          + '<p class="hint">先去把「' + Care.KINDS[Care.open(d).kind].title +
          '」结束，这里才能开始新的计时（同时只进行一项）。</p></div>';
      } else {
        html += '<div class="card"><h2>开始日晒</h2>'
          + '<p class="hint">到户外点一下开始，回屋点结束，时长自动算好。</p>'
          + '<button class="btn btn-primary btn-save" id="careStart" type="button">开始计时</button></div>';
      }

      html += '<div class="card"><h2>补记一次日晒</h2>';
      html += '<label>时长（分钟，可选）<input type="number" id="suMin" min="1" max="120" ' +
        'inputmode="numeric" placeholder="如 15"></label>';
      html += '<label>部位<select id="suArea">';
      AREAS.forEach(function (a) { html += '<option value="' + a.v + '">' + a.label + '</option>'; });
      html += '</select></label>';
      html += '<label>备注（可选）<input type="text" id="suNote" maxlength="40" ' +
        'placeholder="如 上午十点前 / 阴天"></label>';
      html += '<button class="btn btn-save" id="suSave">保存</button></div>';

      var todayCount = all.filter(function (r) { return Util.dayKeyOf(r.time, DS) === dayNow; }).length;
      var todayMin = all.filter(function (r) { return Util.dayKeyOf(r.time, DS) === dayNow; })
        .reduce(function (s, r) { return s + (typeof r.minutes === 'number' && isFinite(r.minutes) ? r.minutes : 0); }, 0);
      var last = all.slice().sort(function (a, b) { return new Date(b.time) - new Date(a.time); })[0];

      html += '<div class="card"><h2>今日小结</h2><ul class="kv">';
      html += '<li>今天：<b>' + todayCount + ' 次</b>' + (todayMin ? '，合计 ' + todayMin + ' 分钟' : '') + '</li>';
      if (last) html += '<li>上次：' + Util.fmtDateTime(last.time) +
        (areaLabel(last.area) ? '（' + areaLabel(last.area) + '）' : '') + '</li>';
      html += '</ul>';
      if (!all.length) html += '<p class="hint">晒过就记一次，回看能看出作息与皮肤状态的关系。</p>';
      html += '</div>';

      html += '<div class="card"><h2>最近记录</h2>';
      var list = all.slice().sort(function (a, b) { return new Date(b.time) - new Date(a.time); }).slice(0, 20);
      if (list.length) {
        html += '<ul class="list">';
        list.forEach(function (r) {
          html += '<li><span class="row-ico">' + icon('sun') + '</span>'
            + '<span class="li-main"><b>' + Util.fmtDateTime(r.time) + '</b></span>'
            + '<span class="li-sub">' + (areaLabel(r.area) ? areaLabel(r.area) + ' ' : '') +
            (r.note ? Util.escapeHtml(r.note) : '') + '</span>'
            + '<span class="li-num">' + (r.minutes ? r.minutes + '<i>分</i>' : '<i>—</i>') + '</span>'
            + '<button class="icon-btn" data-del="' + r.id + '" aria-label="删除" title="删除">' +
            icon('trash') + '</button></li>';
        });
        html += '</ul>';
      } else {
        html += '<div class="empty-state"><span class="es-ico">' + icon('sun') + '</span><p>还没有日晒记录</p><span class="hint">晒完顺手记一下。</span></div>';
      }
      html += '</div>';

      view.innerHTML = html;

      /* 第 138 次：会话三个按钮 + 秒表自走（切页后自清理，见 bath.js 同款注释） */
      var clock = view.querySelector('#careClock');
      if (clock) {
        var timer = setInterval(function () {
          if (!view.contains(clock)) { clearInterval(timer); return; }
          clock.textContent = Util.fmtClock(Care.elapsed(d, 'sun'));
        }, 1000);
      }
      var careStart = view.querySelector('#careStart');
      if (careStart) careStart.addEventListener('click', function () {
        if (Care.start(d, Storage, 'sun')) { Util.toast('开始计时', 'ok'); global.App.rerender(); }
      });
      var careEnd = view.querySelector('#careEnd');
      if (careEnd) careEnd.addEventListener('click', function () {
        var r = Care.finish(d, Storage, 'sun');
        if (r && r.cancelled) { Util.toast('计时数据异常，已取消', 'warn'); }
        else if (r) { Util.toast('已记录日晒 ' + r.minutes + ' 分钟', 'ok'); }
        global.App.rerender();
      });
      var careCancel = view.querySelector('#careCancel');
      if (careCancel) careCancel.addEventListener('click', function () {
        Care.cancel(d, Storage); Util.toast('已取消计时', 'ok'); global.App.rerender();
      });

      view.querySelector('#suSave').addEventListener('click', function () {
        var minEl = view.querySelector('#suMin');
        var min = parseInt(minEl.value, 10);
        if (minEl.value !== '' && (!isFinite(min) || min <= 0 || min > 120)) {
          Util.markInvalid(minEl, '时长填 1–120 分钟，或留空');
          return;
        }
        var rec = {
          id: Util.uid(), time: Util.nowLocal(),
          minutes: (minEl.value === '' ? null : min),
          area: view.querySelector('#suArea').value || 'all',
          note: (view.querySelector('#suNote').value || '').trim() || null
        };
        d.suns.push(rec);
        if (Storage.save()) Util.toast('已记录日晒', 'ok');
        global.App.rerender();
      });

      Array.prototype.forEach.call(view.querySelectorAll('[data-del]'), function (b) {
        b.addEventListener('click', function () {
          Util.removeWithUndo(d.suns, b.getAttribute('data-del'), {
            onSave: function () { Storage.save(); },
            onAfter: function () { global.App.rerender(); },
            deletedText: '已删除日晒记录'
          });
        });
      });
    }
  };
})(window);
