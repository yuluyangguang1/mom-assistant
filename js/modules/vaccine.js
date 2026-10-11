/**
 * vaccine.js - 疫苗接种计划（国家免疫规划疫苗儿童免疫程序）
 * 内置静态时间表，按宝宝出生日期（settings.baby.birthDate，与「生长」共用）推算应种日期。
 * 纯本地查表。非免疫规划（自费）疫苗不内置，避免信息过载。
 *
 * ⚠ 版本（第 119 次修正，必读）：
 *   本表原按《国家免疫规划疫苗儿童免疫程序及说明（2021 年版）》编写，
 *   但该版本中百白破部分**已被取代**——《关于国家免疫规划百白破疫苗和白破疫苗
 *   免疫程序调整相关工作的通知》国疾控卫免发〔2024〕20号（6 部门联合印发，
 *   2024-12-25，**自 2025 年 1 月 1 日起全国施行**）明确：
 *     将 3/4/5/18 月龄各 1 剂百白破 + 6 周岁 1 剂白破，
 *     调整为 2/4/6/18 月龄 + 6 周岁 各 1 剂百白破（共 5 剂）。
 *   旧表的危害不是"不够新"，而是会让家长**漏掉 2 月龄那剂**——而"加强对小月龄
 *   婴儿的免疫保护"正是这次全国调整的唯一理由。故一律按现行程序。
 *   其余剂次（脊灰 IPV/bOPV、麻腮风、流脑、乙脑、甲肝、卡介苗、乙肝）2025 年调整
 *   未涉及其时点，仍照 2021 年版。
 * 数据：d.vaccines.done = { 'hepb-1': '2026-01-05', ... }（剂次 key → 实际接种日期）
 */
(function (global) {
  'use strict';
  var Storage = global.Storage, Util = global.Util;
  var Modules = global.Modules = global.Modules || {};

  /* 剂次表：出生后第 N 天应种（月龄×30.44 取整，足够排期用）。
     ⚠ 数组顺序 = 渲染顺序（plan() 直接 map，不排序），所以必须按 at 升序手写；
       同名不同剂的项保持「剂次先后」的相对次序。
     第 119 次：百白破改为现行 2/4/6/18 月龄 + 6 周岁（国疾控卫免发〔2024〕20号）；
       原 6 周岁的「白破疫苗」（key 'dt'）该剂次已并入百白破，故删除。
       老数据里残留的 vaccines.done['dt'] 会成为孤儿键——界面不再引用它，
       导出仍会带走，不影响任何渲染路径。 */
  function d(m) { return Math.round(m * 30.44); }
  var SCHEDULE = [
    { key: 'bcg',    name: '卡介苗',        dose: '第 1 剂', at: 0 },
    { key: 'hepb-1', name: '乙肝疫苗',      dose: '第 1 剂', at: 0 },
    { key: 'hepb-2', name: '乙肝疫苗',      dose: '第 2 剂', at: d(1) },
    { key: 'ipv-1',  name: '脊灰灭活疫苗',  dose: '第 1 剂', at: d(2) },
    { key: 'dtap-1', name: '百白破疫苗',    dose: '第 1 剂', at: d(2) },
    { key: 'ipv-2',  name: '脊灰灭活疫苗',  dose: '第 2 剂', at: d(3) },
    { key: 'dtap-2', name: '百白破疫苗',    dose: '第 2 剂', at: d(4) },
    { key: 'bopv-1', name: '脊灰减毒疫苗',  dose: '第 3 剂', at: d(4) },
    { key: 'dtap-3', name: '百白破疫苗',    dose: '第 3 剂', at: d(6) },
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
    { key: 'dtap-5', name: '百白破疫苗',    dose: '第 5 剂', at: d(72) }
  ];

  /** 由生日生成每剂排期（供模块页与提醒引擎共用） */
  function plan(birthDate) {
    if (!birthDate) return [];
    return SCHEDULE.map(function (s) {
      return { key: s.key, name: s.name, dose: s.dose, dueISO: Util.addDays(birthDate, s.at) };
    });
  }

  /* 儿保体检节点（第 70 次，B4）：国家基本公卫 0-6 岁儿童健康管理的体检时点——
     新生儿访视 + 满月 + 3/6/8/12/18/24/30/36 月龄 + 4/5/6 岁各一次。
     第 119 次修正 content 列：《国家基本公共卫生服务规范（第三版）》（国卫基层发
     〔2017〕13号）0-6 岁儿童健康管理——血常规（或血红蛋白）检测只在
     6~8、18、30 月龄各 1 次（学龄前 4-6 岁每年 1 次）；听力筛查在 6、12、24、36
     月龄各 1 次。旧表把"血常规"错写进 12/24/36 月龄（那三个时点的规范项目是
     听力筛查），且 6/8 两行重复计入同一"6~8 月龄"窗口——已按规范改回。
     检查内容为该时点常规项目的简要提示，具体以体检机构安排为准。 */
  var CHECKUPS = [
    { key: 'visit',    name: '新生儿访视',  at: 7,    content: '出院后一周内：黄疸观察、脐部护理、喂养与睡眠指导' },
    { key: 'fullmoon', name: '满月体检',    at: 28,   content: '体重 / 身长 / 头围测量，喂养与发育指导，黄疸复查' },
    { key: 'm3',       name: '3 月龄体检',  at: d(3),  content: '体格测量，喂养与发育指导' },
    { key: 'm6',       name: '6 月龄体检',  at: d(6),  content: '体格测量、血常规（6~8 月龄窗口内 1 次），辅食引入指导' },
    { key: 'm8',       name: '8 月龄体检',  at: d(8),  content: '体格测量、听力筛查，发育筛查' },
    { key: 'm12',      name: '12 月龄体检', at: d(12), content: '体格测量、听力筛查，发育筛查' },
    { key: 'm18',      name: '18 月龄体检', at: d(18), content: '体格测量、血常规，语言与行为观察' },
    { key: 'm24',      name: '24 月龄体检', at: d(24), content: '体格测量、听力筛查，发育筛查' },
    { key: 'm30',      name: '30 月龄体检', at: d(30), content: '体格测量、血常规' },
    { key: 'm36',      name: '36 月龄体检', at: d(36), content: '体格测量、听力筛查、视力筛查' },
    { key: 'y4',       name: '4 岁体检',    at: d(48), content: '体格检查与发育评估、血常规、视力筛查' },
    { key: 'y5',       name: '5 岁体检',    at: d(60), content: '体格检查与发育评估、血常规、视力筛查' },
    { key: 'y6',       name: '6 岁体检',    at: d(72), content: '入学前全面体检、血常规、视力筛查' }
  ];

  /** 由生日生成体检排期（供模块页与提醒引擎共用） */
  function planCheckups(birthDate) {
    if (!birthDate) return [];
    return CHECKUPS.map(function (s) {
      return { key: s.key, name: s.name, dueISO: Util.addDays(birthDate, s.at), content: s.content };
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
      html += '<div class="card"><h2>宝宝生日</h2>';
      html += Util.dateSlider({ id: 'vBirth', title: '出生日期', value: baby.birthDate || '', min: Util.addDays(Util.todayISO(), -1095), max: Util.todayISO(), opt: { label: '未设置（可后补）', invert: false } });
      html += '<p class="hint">与「生长」模块共用同一生日，改一处两边生效。</p></div>';

      if (!baby.birthDate) {
        html += '<div class="card"><p class="hint">填写宝宝出生日期后，自动生成国家免疫规划疫苗接种时间表。</p></div>';
      } else {
        var items = plan(baby.birthDate);
        var doneN = items.filter(function (it) { return done[it.key]; }).length;
        var next = items.filter(function (it) { return !done[it.key]; })
          .sort(function (a, b) { return new Date(a.dueISO) - new Date(b.dueISO); })[0];

        html += '<div class="card"><h2>接种进度</h2>';
        html += '<div class="progress"><div class="progress-bar" style="width:' + Math.round(doneN / items.length * 100) + '%"></div></div>';
        html += '<p class="hint">已完成 ' + doneN + ' / ' + items.length + ' 剂'
          + (next ? '，下一剂：' + next.name + next.dose + '（' + next.dueISO + '）' : '，全部完成！') + '</p></div>';

        html += '<div class="card"><h2>接种时间表</h2><ul class="list vac-list">';
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
              ? '<button class="btn btn-mini" data-vaxdate="' + it.key + '">改日期</button>'
                + '<button class="icon-btn" data-unvax="' + it.key + '" aria-label="取消已种" title="取消已种">' + icon('trash') + '</button>'
              : '<button class="btn btn-mini" data-vax="' + it.key + '">已接种</button>')
            + '</li>';
        });
        html += '</ul><p class="hint">时间表按现行国家免疫规划程序（2025 年起）生成，仅供参考；实际以接种门诊安排为准。</p></div>';

        /* 第 70 次（B4）：儿保体检节点——与接种时间表并排的另一张官方时刻表。
           标记只落本机 checkups.done，随导出走；早产宝宝的体检安排常按矫正月龄，
           因此本表只作参考、以医生安排为准。 */
        var cks = planCheckups(baby.birthDate);
        var ckDone = (d.checkups && d.checkups.done) || {};
        html += '<div class="card"><h2>儿保体检节点</h2><ul class="list vac-list">';
        cks.forEach(function (it) {
          var doneDate = ckDone[it.key];
          var left = Util.daysBetween(today, it.dueISO);
          var status, cls;
          if (doneDate) { status = '已体检 ' + doneDate; cls = ' is-done'; }
          else if (left < -30) { status = '已过参考时间较久，下次体检时一并评估'; cls = ' is-over'; }
          else if (left < 0) { status = '已过参考时间 ' + (-left) + ' 天'; cls = ' is-over'; }
          else if (left <= 7) { status = left === 0 ? '参考时间就是今天' : left + ' 天后到期'; cls = ' is-due'; }
          else { status = '参考时间 ' + it.dueISO; cls = ''; }
          html += '<li class="vac-item' + cls + '">'
            + '<span class="row-ico">' + icon(doneDate ? 'check' : 'heart') + '</span>'
            + '<span class="vac-main"><b>' + it.name + '</b><br><small>' + it.content + ' · ' + status + '</small></span>'
            + (doneDate
              ? '<button class="btn btn-mini" data-ckdate="' + it.key + '">改日期</button>'
                + '<button class="icon-btn" data-unck="' + it.key + '" aria-label="取消已体检" title="取消已体检">' + icon('trash') + '</button>'
              : '<button class="btn btn-mini" data-ck="' + it.key + '">已体检</button>')
            + '</li>';
        });
        html += '</ul><p class="hint">体检时点按国家 0-6 岁儿童健康管理规范生成，仅供参考；'
          + '以社区卫生服务中心 / 妇幼保健院的实际安排为准，早产宝宝的体检与评估请遵医嘱。</p></div>';
      }

      /* 第 59 次：医学提示（遵医嘱） */
      html += '<p class="hint med-note">接种时间以社区卫生服务中心 / 接种门诊的通知为准，本页仅作记录，不构成医疗建议；接种前有疑问请咨询医生。</p>';

      view.innerHTML = html;
      Util.bindDateSliders(view);

      view.querySelector('#vBirth').addEventListener('change', function (e) {
        var s = Storage.get();
        s.settings.baby = s.settings.baby || { sex: 'boy', birthDate: null, preterm: false, birthGestWeeks: 40 };
        s.settings.baby.birthDate = e.target.value || null;
        /* 第 80 次（宝宝档案）：生日改动同步回当前宝宝档案 */
        if (Storage.syncBabyFromSettings) Storage.syncBabyFromSettings();
        Storage.save(); global.App.rerender();
      });
      /* 打开「改日期」弹层的共用流程（C6）：快捷记录写死了今天，补种 / 补记要能改到过去某天 */
      function openDatePicker(key, val) {
        Util.editDate({
          title: '实际接种日期',
          message: '可补记到过去某天；以接种门诊记录为准。',
          value: val || today, max: today, okText: '保存日期',
          onConfirm: function (v) {
            var s = Storage.get();
            s.vaccines = s.vaccines || { done: {} };
            s.vaccines.done[key] = v;
            if (Storage.save()) Util.toast('已更新接种日期：' + v, 'ok');
            global.App.rerender();
          }
        });
      }
      Array.prototype.forEach.call(view.querySelectorAll('[data-vax]'), function (b) {
        b.addEventListener('click', function () {
          var key = b.getAttribute('data-vax');
          var s = Storage.get();
          s.vaccines = s.vaccines || { done: {} };
          s.vaccines.done[key] = today;
          Storage.save();
          /* C6：默认记今天，但立刻给「日期不对？」改期出口，不用删掉重来 */
          Util.toast('已记录接种：' + today, 'ok', {
            label: '日期不对？',
            onClick: function () { openDatePicker(key, null); }
          });
          global.App.rerender();
        });
      });
      Array.prototype.forEach.call(view.querySelectorAll('[data-vaxdate]'), function (b) {
        b.addEventListener('click', function () {
          var key = b.getAttribute('data-vaxdate');
          openDatePicker(key, (Storage.get().vaccines && Storage.get().vaccines.done[key]) || null);
        });
      });
      Array.prototype.forEach.call(view.querySelectorAll('[data-unvax]'), function (b) {
        b.addEventListener('click', function () {
          var s = Storage.get();
          if (s.vaccines && s.vaccines.done) delete s.vaccines.done[b.getAttribute('data-unvax')];
          Storage.save(); global.App.rerender();
        });
      });
      /* 第 70 次：体检标记交互（与疫苗同款三件套：记今天 + 改日期 + 取消） */
      function openCkDate(key, val) {
        Util.editDate({
          title: '实际体检日期',
          message: '可补记到过去某天；以体检机构记录为准。',
          value: val || today, max: today, okText: '保存日期',
          onConfirm: function (v) {
            var s = Storage.get();
            s.checkups = s.checkups || { done: {} };
            s.checkups.done[key] = v;
            if (Storage.save()) Util.toast('已更新体检日期：' + v, 'ok');
            global.App.rerender();
          }
        });
      }
      Array.prototype.forEach.call(view.querySelectorAll('[data-ck]'), function (b) {
        b.addEventListener('click', function () {
          var key = b.getAttribute('data-ck');
          var s = Storage.get();
          s.checkups = s.checkups || { done: {} };
          s.checkups.done[key] = today;
          Storage.save();
          Util.toast('已记录体检：' + today, 'ok', {
            label: '日期不对？',
            onClick: function () { openCkDate(key, null); }
          });
          global.App.rerender();
        });
      });
      Array.prototype.forEach.call(view.querySelectorAll('[data-ckdate]'), function (b) {
        b.addEventListener('click', function () {
          var key = b.getAttribute('data-ckdate');
          openCkDate(key, (Storage.get().checkups && Storage.get().checkups.done[key]) || null);
        });
      });
      Array.prototype.forEach.call(view.querySelectorAll('[data-unck]'), function (b) {
        b.addEventListener('click', function () {
          var s = Storage.get();
          if (s.checkups && s.checkups.done) delete s.checkups.done[b.getAttribute('data-unck')];
          Storage.save(); global.App.rerender();
        });
      });
    }
  };

  /* 提醒引擎共用：由生日生成排期 */
  Modules.vaccine._plan = plan;
  /* 第 70 次：体检排期同样供提醒引擎共用 */
  Modules.vaccine._planCheckups = planCheckups;
})(window);
