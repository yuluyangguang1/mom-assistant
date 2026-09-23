/**
 * vaccine.js - 疫苗接种计划（国家免疫规划疫苗儿童免疫程序）
 * 内置静态时间表，按宝宝出生日期（settings.baby.birthDate，与「生长」共用）推算应种日期。
 * 纯本地查表。非免疫规划（自费）疫苗不内置，避免信息过载。
 * 数据：d.vaccines.done = { 'hepb-1': '2026-01-05', ... }（剂次 key → 实际接种日期）
 */
(function (global) {
  'use strict';
  var Storage = global.Storage, Util = global.Util;
  var Modules = global.Modules = global.Modules || {};

  /* 剂次表：出生后第 N 天应种（月龄×30.44 取整，足够排期用） */
  function d(m) { return Math.round(m * 30.44); }
  var SCHEDULE = [
    { key: 'bcg',    name: '卡介苗',        dose: '第 1 剂', at: 0 },
    { key: 'hepb-1', name: '乙肝疫苗',      dose: '第 1 剂', at: 0 },
    { key: 'hepb-2', name: '乙肝疫苗',      dose: '第 2 剂', at: d(1) },
    { key: 'ipv-1',  name: '脊灰灭活疫苗',  dose: '第 1 剂', at: d(2) },
    { key: 'ipv-2',  name: '脊灰灭活疫苗',  dose: '第 2 剂', at: d(3) },
    { key: 'dtap-1', name: '百白破疫苗',    dose: '第 1 剂', at: d(3) },
    { key: 'dtap-2', name: '百白破疫苗',    dose: '第 2 剂', at: d(4) },
    { key: 'bopv-1', name: '脊灰减毒疫苗',  dose: '第 3 剂', at: d(4) },
    { key: 'dtap-3', name: '百白破疫苗',    dose: '第 3 剂', at: d(5) },
    { key: 'hepb-3', name: '乙肝疫苗',      dose: '第 3 剂', at: d(6) },
    { key: 'mena-1', name: 'A群流脑疫苗',   dose: '第 1 剂', at: d(6) },
    { key: 'mmr-1',  name: '麻腮风疫苗',    dose: '第 1 剂', at: d(8) },
    { key: 'je-1',   name: '乙脑减毒疫苗',  dose: '第 1 剂', at: d(8) },
    { key: 'mena-2', name: 'A群流脑疫苗',   dose: '第 2 剂', at: d(9) },
    { key: 'dtap-4', name: '百白破疫苗',    dose: '第 4 剂', at: d(18) },
    { key: 'mmr-2',  name: '麻腮风疫苗',    dose: '第 2 剂', at: d(18) },
    { key: 'hepa-1', name: '甲肝减毒疫苗',  dose: '第 1 剂', at: d(18) },
    { key: 'je-2',   name: '乙脑减毒疫苗',  dose: '第 2 剂', at: d(24) },
    { key: 'menc-1', name: 'A+C群流脑疫苗', dose: '第 1 剂', at: d(36) },
    { key: 'bopv-2', name: '脊灰减毒疫苗',  dose: '第 4 剂', at: d(48) },
    { key: 'menc-2', name: 'A+C群流脑疫苗', dose: '第 2 剂', at: d(72) },
    { key: 'dt',     name: '白破疫苗',      dose: '第 1 剂', at: d(72) }
  ];

  /** 由生日生成每剂排期（供模块页与提醒引擎共用） */
  function plan(birthDate) {
    if (!birthDate) return [];
    return SCHEDULE.map(function (s) {
      return { key: s.key, name: s.name, dose: s.dose, dueISO: Util.addDays(birthDate, s.at) };
    });
  }

  Modules.vaccine = {
    id: 'vaccine',
    title: '疫苗',
    render: function (view) {
      var d = Storage.get();
      var baby = d.settings.baby || {};
      var done = (d.vaccines && d.vaccines.done) || {};
      var today = Util.todayISO();
      var html = '';

      /* 宝宝生日（与生长模块共用 settings.baby.birthDate） */
      html += '<div class="card"><h2>' + icon('vaccine') + '宝宝生日</h2>';
      html += '<label>出生日期<input type="date" id="vBirth" value="' + (baby.birthDate || '') + '"></label>';
      html += '<p class="hint">与「生长」模块共用同一生日，改一处两边生效。</p></div>';

      if (!baby.birthDate) {
        html += '<div class="card"><p class="hint">填写宝宝出生日期后，自动生成国家免疫规划疫苗接种时间表。</p></div>';
      } else {
        var items = plan(baby.birthDate);
        var doneN = items.filter(function (it) { return done[it.key]; }).length;
        var next = items.filter(function (it) { return !done[it.key]; })
          .sort(function (a, b) { return new Date(a.dueISO) - new Date(b.dueISO); })[0];

        html += '<div class="card"><h2>' + icon('vaccine') + '接种进度</h2>';
        html += '<div class="progress"><div class="progress-bar" style="width:' + Math.round(doneN / items.length * 100) + '%"></div></div>';
        html += '<p class="hint">已完成 ' + doneN + ' / ' + items.length + ' 剂'
          + (next ? '，下一剂：' + next.name + next.dose + '（' + next.dueISO + '）' : '，全部完成！') + '</p></div>';

        html += '<div class="card"><h2>' + icon('vaccine') + '接种时间表</h2><ul class="list vac-list">';
        items.forEach(function (it) {
          var doneDate = done[it.key];
          var left = Util.daysBetween(today, it.dueISO);
          var status, cls;
          if (doneDate) { status = '已种 ' + doneDate; cls = ' is-done'; }
          else if (left < -30) { status = '逾期较久，咨询医生补种'; cls = ' is-over'; }
          else if (left < 0) { status = '已逾期 ' + (-left) + ' 天'; cls = ' is-over'; }
          else if (left <= 7) { status = left === 0 ? '今天应种' : left + ' 天后应种'; cls = ' is-due'; }
          else { status = it.dueISO; cls = ''; }
          html += '<li class="vac-item' + cls + '">'
            + '<span class="row-ico">' + icon(doneDate ? 'check' : 'vaccine') + '</span>'
            + '<span class="vac-main"><b>' + it.name + '</b> <i>' + it.dose + '</i><br><small>' + status + '</small></span>'
            + (doneDate
              ? '<button class="icon-btn" data-unvax="' + it.key + '" aria-label="取消已种" title="取消已种">' + icon('trash') + '</button>'
              : '<button class="btn btn-mini" data-vax="' + it.key + '">已接种</button>')
            + '</li>';
        });
        html += '</ul><p class="hint">时间表按国家免疫规划程序生成，仅供参考；实际以接种门诊安排为准。</p></div>';
      }

      view.innerHTML = html;

      view.querySelector('#vBirth').addEventListener('change', function (e) {
        var s = Storage.get();
        s.settings.baby = s.settings.baby || { sex: 'boy', birthDate: null, preterm: false, birthGestWeeks: 40 };
        s.settings.baby.birthDate = e.target.value || null;
        Storage.save(); global.App.rerender();
      });
      Array.prototype.forEach.call(view.querySelectorAll('[data-vax]'), function (b) {
        b.addEventListener('click', function () {
          var s = Storage.get();
          s.vaccines = s.vaccines || { done: {} };
          s.vaccines.done[b.getAttribute('data-vax')] = today;
          Storage.save();
          Util.toast('已记录接种：' + today, 'ok');
          global.App.rerender();
        });
      });
      Array.prototype.forEach.call(view.querySelectorAll('[data-unvax]'), function (b) {
        b.addEventListener('click', function () {
          var s = Storage.get();
          if (s.vaccines && s.vaccines.done) delete s.vaccines.done[b.getAttribute('data-unvax')];
          Storage.save(); global.App.rerender();
        });
      });
    }
  };

  /* 提醒引擎共用：由生日生成排期 */
  Modules.vaccine._plan = plan;
})(window);
