/**
 * milestone.js - 成长里程碑日记
 * 第一次微笑、抬头、翻身、长牙……这些时刻值得记下来。
 * 预设常见里程碑一键选择日期，也可自定义；按时间倒序的时间线展示，
 * 填了宝宝生日时自动显示当时的月龄/天数。
 */
(function (global) {
  'use strict';
  var Storage = global.Storage, Util = global.Util;
  var Modules = global.Modules = global.Modules || {};

  var PRESETS = ['第一次微笑', '会抬头', '第一次翻身', '会独坐', '长第一颗牙',
    '会爬', '会扶站', '第一次叫妈妈', '第一次叫爸爸', '会走路'];

  Modules.milestone = {
    id: 'milestone',
    title: '里程碑',
    render: function (view) {
      var d = Storage.get();
      var baby = (d.settings && d.settings.baby) || {};
      var html = '';

      /* 新增：预设下拉 + 日期 + 备注 */
      html += '<div class="card"><h2>' + icon('milestone') + '记一个里程碑</h2>';
      html += '<label>里程碑<select id="msPreset"><option value="">— 选择常见里程碑 —</option>';
      PRESETS.forEach(function (p) { html += '<option value="' + p + '">' + p + '</option>'; });
      html += '</select></label>';
      html += '<label>或自定义<input type="text" id="msTitle" placeholder="如：第一次游泳"></label>';
      html += '<label>日期<input type="date" id="msDate" value="' + Util.todayISO() + '"></label>';
      html += '<label>备注（可选）<input type="text" id="msNote" placeholder="当时的情景…"></label>';
      html += '<button class="btn btn-primary" id="msSave">保存</button></div>';

      /* 时间线 */
      var list = (d.milestones || []).slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
      html += '<div class="card"><h2>' + icon('milestone') + '时间线</h2>';
      if (list.length) {
        html += '<ul class="list">';
        list.forEach(function (r) {
          var ageTxt = '';
          if (baby.birthDate && r.date) {
            var days = Util.daysBetween(baby.birthDate, r.date);
            if (days >= 0) ageTxt = ' <small>（' + (days < 60 ? days + ' 天' : (days / 30.44).toFixed(1) + ' 月龄') + '）</small>';
          }
          html += '<li><span class="row-ico">' + icon('milestone') + '</span><span><b>' + Util.escapeHtml(r.title) + '</b>' + ageTxt
            + '<br><small>' + Util.fmtDate(r.date) + (r.note ? ' ｜ ' + Util.escapeHtml(r.note) : '') + '</small></span>'
            + '<button class="icon-btn" data-del="' + r.id + '" aria-label="删除" title="删除">' + icon('trash') + '</button></li>';
        });
        html += '</ul>';
      } else {
        html += '<p class="hint">还没有记录。宝宝的每个「第一次」都值得留下。</p>';
      }
      html += '</div>';

      view.innerHTML = html;

      /* 选了预设时自动填入自定义框，方便微调 */
      view.querySelector('#msPreset').addEventListener('change', function () {
        if (this.value) view.querySelector('#msTitle').value = this.value;
      });
      view.querySelector('#msSave').addEventListener('click', function () {
        var title = (view.querySelector('#msTitle').value || '').trim();
        var date = view.querySelector('#msDate').value;
        if (!title) { Util.markInvalid(view.querySelector('#msTitle'), '请填写或选择一个里程碑'); return; }
        if (!date) { Util.markInvalid(view.querySelector('#msDate'), '请选择日期'); return; }
        d.milestones.push({
          id: Util.uid(), title: title, date: date,
          note: (view.querySelector('#msNote').value || '').trim() || null
        });
        if (Storage.save()) Util.toast('已记下：' + title, 'ok');
        global.App.rerender();
      });
      Array.prototype.forEach.call(view.querySelectorAll('[data-del]'), function (b) {
        b.addEventListener('click', function () {
          Util.removeWithUndo(d.milestones, b.getAttribute('data-del'), {
            onSave: function () { Storage.save(); },
            onAfter: function () { global.App.rerender(); },
            deletedText: '已删除里程碑'
          });
        });
      });
    }
  };
})(window);
