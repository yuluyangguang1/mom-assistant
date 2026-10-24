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
 * 第 146 次：时点已与《国家免疫规划疫苗儿童免疫程序及说明（2026 年版）》逐条核对一致
 *   （百白破 2/4/6/18 月龄 + 6 岁；脊灰、麻腮风、乙脑、流脑、甲肝、卡介苗、乙肝时点不变），
 *   页面出处与提示文案同步改为 2026 年版。
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
  /* 第 146 次：「过了多久」的人话版本（≥1 年说年+月，否则说月） */
  function agoText(days) {
    var m = Math.floor(days / 30.44);
    if (m < 12) return Math.max(1, m) + ' 个月';
    var y = Math.floor(m / 12), r = m % 12;
    return y + ' 年' + (r ? ' ' + r + ' 个月' : '');
  }
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

  /* 第 187 次（P0）：自费 / 联合疫苗抵扣免疫规划剂次。
     抵扣关系因疫苗、月龄与门诊安排而异，工具不替用户判断——预设只是「按疫苗家族
     预选下一剂未种的」，用户可增减勾选，以接种门诊告知为准。
     数据：d.vaccines.subs = [{ id, name, date, covers: [剂次 key] }]，
           被抵扣的剂次同时写 done[key] = date（提醒/首页/日历零改动即认作已种），
           d.vaccines.via[key] = subId（删除这条自费记录时只撤回它抵扣的那几剂）。 */
  var FAMILY = {
    dtap: ['dtap-1', 'dtap-2', 'dtap-3', 'dtap-4', 'dtap-5'],
    polio: ['ipv-1', 'ipv-2', 'bopv-1', 'bopv-2'],
    mena: ['mena-1', 'mena-2'],
    menc: ['menc-1', 'menc-2'],
    hepa: ['hepa-1'],
    je: ['je-1', 'je-2']
  };
  var SUB_PRESETS = [
    { name: '五联疫苗（百白破-脊灰-Hib）', fam: ['dtap', 'polio'] },
    { name: '四联疫苗（百白破-Hib）', fam: ['dtap'] },
    { name: 'AC 群流脑结合疫苗', fam: ['mena'] },
    { name: 'ACYW135 群流脑结合疫苗', fam: ['mena'] },
    { name: '甲肝灭活疫苗', fam: ['hepa'] },
    { name: '乙脑灭活疫苗', fam: ['je'] },
    { name: '13 价肺炎球菌疫苗', fam: [] },
    { name: '轮状病毒疫苗', fam: [] },
    { name: '水痘疫苗', fam: [] },
    { name: '流感疫苗', fam: [] },
    { name: '手足口（EV71）疫苗', fam: [] }
  ];

  /* 第 199 次：每剂接种详情（部位 / 单位 / 批号 / 接种后反应 / 备注），对标 Cali 的接种记录字段。
     数据：d.vaccines.notes[剂次 key] = { site, clinic, lot, react: [..], note }。
     「预防」一行只写该疫苗针对的疾病名（公开事实），不写禁忌、反应处理等需医生判断的内容。
     枚举一律查表显示，自由文本一律转义。 */
  var PREVENTS = {
    bcg: '结核病', hepb: '乙型肝炎', ipv: '脊髓灰质炎', bopv: '脊髓灰质炎', dtap: '百日咳、白喉、破伤风',
    mena: '流行性脑脊髓膜炎', menc: '流行性脑脊髓膜炎', mmr: '麻疹、流行性腮腺炎、风疹', je: '流行性乙型脑炎', hepa: '甲型肝炎'
  };
  var VSITES = [['lua', '左上臂'], ['rua', '右上臂'], ['lth', '左大腿'], ['rth', '右大腿'], ['oral', '口服']];
  var VREACT = [['none', '无明显反应'], ['fever', '发热'], ['swell', '红肿'], ['lump', '硬结'], ['fuss', '哭闹'], ['other', '其他']];
  function lbl(tbl, v) { for (var i = 0; i < tbl.length; i++) if (tbl[i][0] === v) return tbl[i][1]; return ''; }
  function noteOf(d, key) {
    var n = d.vaccines && d.vaccines.notes && d.vaccines.notes[key];
    return (n && typeof n === 'object' && !Array.isArray(n)) ? n : null;
  }
  var openDetail = null;  /* 当前展开详情的剂次 key（模块级临时态） */

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
    /* 第 183 次：给页头插画用的接种进度（与下方进度条同一口径） */
    progress: function (d) {
      var b = (d.settings && d.settings.baby) || {};
      if (!b.birthDate) return null;
      var done = (d.vaccines && d.vaccines.done) || {};
      var items = plan(b.birthDate);
      return { done: items.filter(function (it) { return done[it.key]; }).length, total: items.length };
    },
    title: '疫苗',
    render: function (view) {
      var d = Storage.get();
      var baby = d.settings.baby || {};
      var done = (d.vaccines && d.vaccines.done) || {};
      var today = Util.todayISO();
      var html = '';
      var vSubs = (d.vaccines && Array.isArray(d.vaccines.subs)) ? d.vaccines.subs.filter(function (x) { return x && typeof x === 'object' && x.id; }) : [];
      var vVia = (d.vaccines && d.vaccines.via && typeof d.vaccines.via === 'object') ? d.vaccines.via : {};
      function viaOf(key) {
        var sid = vVia[key]; if (!sid) return null;
        for (var i = 0; i < vSubs.length; i++) if (vSubs[i].id === sid) return vSubs[i];
        return null;
      }

      /* 宝宝生日（与生长模块共用 settings.baby.birthDate） */
      html += '<div class="card"><h2>宝宝生日</h2>';
      html += Util.birthInput({ id: 'vBirth', title: '出生日期', value: baby.birthDate || '', lunar: baby.birthLunar });
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
          + (next ? '，下一剂：' + next.name + next.dose + '（' + next.dueISO + '）' : '，全部完成！') + '</p>'
          /* 第 186 次：未种剂次 + 未做儿保 → 系统日历（.ics，前一天 9 点提醒） */
          + '<div class="row"><button class="btn btn-mini" type="button" id="vIcs">导出到系统日历</button></div></div>';

        /* 第 146 次：多剂「过了应种日还没记录」时，最常见的原因是「其实种过了、只是没在本机记」。
           给一键补记出口（按应种日记、可逐条改），并说清楚没种的该怎么办。 */
        var pastDue = items.filter(function (it) { return !done[it.key] && Util.daysBetween(today, it.dueISO) < 0; });
        if (pastDue.length >= 3) {
          html += '<div class="card vac-backfill"><h2>有 ' + pastDue.length + ' 剂过了应种日还没记录</h2>'
            + '<p class="hint">如果宝宝已按门诊安排接种，可以一次补记，日期先按应种日填，之后可逐条改。还没种的，带上接种证联系接种门诊补种即可。</p>'
            + '<div class="row"><button class="btn" type="button" id="vBackfill">都已接种，一键补记</button></div></div>';
        }

        html += '<div class="card"><h2>接种时间表</h2><ul class="list vac-list">';
        items.forEach(function (it) {
          var doneDate = done[it.key];
          var left = Util.daysBetween(today, it.dueISO);
          var status, cls;
          var viaSub = viaOf(it.key);
          if (doneDate && viaSub) { status = '已由「' + Util.escapeHtml(viaSub.name) + '」抵扣 ' + doneDate; cls = ' is-done'; }
          else if (doneDate) { status = '已种 ' + doneDate; cls = ' is-done'; }
          /* 第 146 次：逾期分档。原先超过 30 天一律「逾期较久」+ 加粗警示色，
             生日一填、历史剂次没补记时整屏飘红，制造焦虑且看不出轻重。
             现在：30 天内 = 提醒尽快补种（警示色）；更久 = 平和地说明「过了多久」+ 补种出口（次要色）。 */
          else if (left < -30) { status = '已过应种日约 ' + agoText(-left) + ' · 未种请预约补种'; cls = ' is-late'; }
          else if (left < 0) { status = '已过应种日 ' + (-left) + ' 天，请尽快补种'; cls = ' is-over'; }
          else if (left <= 7) { status = left === 0 ? '今天应种' : left + ' 天后应种'; cls = ' is-due'; }
          else { status = it.dueISO; cls = ''; }
          var vn = doneDate ? noteOf(d, it.key) : null;
          if (vn) {
            var bits = [lbl(VSITES, vn.site)].concat((Array.isArray(vn.react) ? vn.react : []).map(function (r) { return lbl(VREACT, r); })).filter(Boolean);
            if (bits.length) status += ' · ' + bits.join('、');
          }
          html += '<li class="vac-item' + cls + '">'
            + '<span class="row-ico">' + icon(doneDate ? 'check' : 'vaccine') + '</span>'
            + '<span class="vac-main"><b>' + it.name + '</b> <i>' + it.dose + '</i><br><small>' + status + '</small></span>'
            + (doneDate
              ? '<button class="btn btn-mini" data-vacdet="' + it.key + '" aria-expanded="' + (openDetail === it.key) + '">详情</button>'
                + '<button class="icon-btn" data-unvax="' + it.key + '" aria-label="取消已种" title="取消已种">' + icon('trash') + '</button>'
              : '<button class="btn btn-mini" data-vax="' + it.key + '">已接种</button>')
            + '</li>';
          if (doneDate && openDetail === it.key) {
            var n0 = vn || {}, rx = Array.isArray(n0.react) ? n0.react : [];
            var fam = it.key.split('-')[0];
            html += '<li class="vac-detail">'
              + (PREVENTS[fam] ? '<p class="hint">预防：' + PREVENTS[fam] + '</p>' : '')
              + '<div class="row vd-date"><span>接种日期 <b>' + Util.escapeHtml(doneDate) + '</b></span><button type="button" class="btn btn-mini" data-vaxdate="' + it.key + '">改日期</button></div>'
              + '<span class="lbl-text">接种部位</span><div class="dp-flags" id="vdSite">'
              + VSITES.map(function (o) { return '<button type="button" class="dp-pill' + (n0.site === o[0] ? ' active' : '') + '" data-vds="' + o[0] + '" aria-pressed="' + (n0.site === o[0]) + '">' + o[1] + '</button>'; }).join('')
              + '</div><span class="lbl-text">接种后反应（可多选）</span><div class="dp-flags" id="vdReact">'
              + VREACT.map(function (o) { var on = rx.indexOf(o[0]) >= 0; return '<button type="button" class="dp-pill' + (on ? ' active' : '') + '" data-vdr="' + o[0] + '" aria-pressed="' + on + '">' + o[1] + '</button>'; }).join('')
              + '</div>'
              + '<label>接种单位<input type="text" id="vdClinic" maxlength="30" placeholder="如 XX 社区卫生服务中心" value="' + Util.escapeHtml(n0.clinic || '') + '"></label>'
              + '<label>疫苗批号<input type="text" id="vdLot" maxlength="30" placeholder="接种本上有" value="' + Util.escapeHtml(n0.lot || '') + '"></label>'
              + '<label>备注<input type="text" id="vdNote" maxlength="60" placeholder="如 第二天退烧" value="' + Util.escapeHtml(n0.note || '') + '"></label>'
              + '<button type="button" class="btn btn-primary btn-save" id="vdSave" data-key="' + it.key + '">保存详情</button>'
              + '<p class="hint">接种后出现高热不退、大面积红肿、精神差或其他担心的情况，请联系接种门诊或就医。</p>'
              + '</li>';
          }
        });
        html += '</ul><p class="hint">时间表按《国家免疫规划疫苗儿童免疫程序及说明（2026 年版）》生成，仅供参考；同一天到期的国家免疫规划疫苗可以按程序同时接种，实际以接种门诊安排为准。</p></div>';

        /* 第 187 次：自费 / 联合疫苗卡 */
        html += '<div class="card"><h2>自费 / 联合疫苗</h2>';
        if (vSubs.length) {
          html += '<ul class="list">';
          vSubs.slice().sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); }).forEach(function (x) {
            var cv = (Array.isArray(x.covers) ? x.covers : []).map(function (k) {
              var it = items.filter(function (y) { return y.key === k; })[0];
              return it ? it.name + it.dose : '';
            }).filter(Boolean);
            html += '<li><span class="row-ico">' + icon('vaccine') + '</span>'
              + '<span class="vac-main"><b>' + Util.escapeHtml(x.name || '') + '</b><br><small>'
              + Util.escapeHtml(String(x.date || '')) + (cv.length ? ' · 抵扣 ' + Util.escapeHtml(cv.join('、')) : ' · 不抵扣免疫规划剂次') + '</small></span>'
              + '<button class="icon-btn" data-subdel="' + Util.escapeHtml(x.id) + '" aria-label="删除" title="删除">' + icon('trash') + '</button></li>';
          });
          html += '</ul>';
        }
        html += '<details class="vsub-add"' + (vSubs.length ? '' : ' open') + '><summary>记一剂自费 / 联合疫苗</summary>'
          + '<label>疫苗<select id="vsName"><option value="">请选择</option>'
          + SUB_PRESETS.map(function (p, i) { return '<option value="' + i + '">' + p.name + '</option>'; }).join('')
          + '<option value="custom">其他（自己填）</option></select></label>'
          + '<label id="vsCustomWrap" style="display:none">名称<input type="text" id="vsCustom" maxlength="30" placeholder="如 Hib 疫苗"></label>'
          + '<label>接种日期<input type="date" id="vsDate" max="' + today + '" value="' + today + '"></label>'
          + '<span class="lbl-text">抵扣哪些免疫规划剂次（以门诊告知为准，可不选）</span>'
          + '<div class="vsub-covers" id="vsCovers">'
          + items.filter(function (it) { return !done[it.key]; }).map(function (it) {
            return '<label class="chk"><input type="checkbox" value="' + it.key + '"> ' + it.name + it.dose + ' <small>' + it.dueISO + '</small></label>';
          }).join('')
          + '</div>'
          + '<button class="btn btn-primary btn-save" type="button" id="vsSave">保存</button></details>';
        html += '<p class="hint">联合疫苗能替代哪几剂，取决于疫苗种类、月龄和门诊安排；预选只是按疫苗家族勾上下一剂未种的，请按接种门诊的说法调整。</p></div>';

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
      var vIcs = view.querySelector('#vIcs');
      if (vIcs) vIcs.addEventListener('click', function () {
        var bdv = (d.settings.baby || {}).birthDate; if (!bdv) return;
        var dn = (d.vaccines && d.vaccines.done) || {}, ck = (d.checkups && d.checkups.done) || {};
        var t0 = Util.todayISO(), byDay = {};
        plan(bdv).forEach(function (it) {
          if (dn[it.key] || it.dueISO < t0) return;
          (byDay[it.dueISO] = byDay[it.dueISO] || []).push(it.name + it.dose);
        });
        var evs = Object.keys(byDay).sort().map(function (k) {
          return { uid: 'vac-' + k, date: k, title: '疫苗参考日：' + byDay[k].join('、'), desc: '按国家免疫规划程序推算的参考日期，以接种门诊预约为准。' };
        });
        planCheckups(bdv).forEach(function (it) {
          if (ck[it.key] || it.dueISO < t0) return;
          evs.push({ uid: 'ck-' + it.key, date: it.dueISO, title: '儿保：' + it.name, desc: it.content + '（参考时间，以体检机构安排为准）' });
        });
        if (!evs.length) { Util.toast('没有待接种或待体检的项目', 'ok'); return; }
        Util.shareOrDownload('咿呀记_疫苗与儿保.ics', Util.buildICS('宝宝疫苗与儿保', evs), 'text/calendar');
        Util.toast('已生成 ' + evs.length + ' 个日历事件', 'ok');
      });
      Util.bindDateSliders(view);
      var vsName = view.querySelector('#vsName');
      if (vsName) vsName.addEventListener('change', function () {
        var v = vsName.value;
        view.querySelector('#vsCustomWrap').style.display = (v === 'custom') ? '' : 'none';
        var preset = SUB_PRESETS[parseInt(v, 10)];
        var boxes = view.querySelectorAll('#vsCovers input[type="checkbox"]');
        Array.prototype.forEach.call(boxes, function (cb) { cb.checked = false; });
        if (!preset) return;
        /* 每个家族预选「最早一剂未种的」 */
        preset.fam.forEach(function (f) {
          var keys = FAMILY[f] || [];
          for (var i = 0; i < keys.length; i++) {
            var cb = view.querySelector('#vsCovers input[value="' + keys[i] + '"]');
            if (cb) { cb.checked = true; break; }
          }
        });
      });
      var vsSave = view.querySelector('#vsSave');
      if (vsSave) vsSave.addEventListener('click', function () {
        var v = vsName.value, name = '';
        if (v === 'custom') name = (view.querySelector('#vsCustom').value || '').trim();
        else if (SUB_PRESETS[parseInt(v, 10)]) name = SUB_PRESETS[parseInt(v, 10)].name;
        if (!name) { Util.markInvalid(v === 'custom' ? view.querySelector('#vsCustom') : vsName, '请选择或填写疫苗'); return; }
        var dt = view.querySelector('#vsDate').value;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dt) || dt > today) { Util.markInvalid(view.querySelector('#vsDate'), '请选择不晚于今天的日期'); return; }
        var covers = Array.prototype.map.call(view.querySelectorAll('#vsCovers input:checked'), function (cb) { return cb.value; });
        var s = Storage.get();
        s.vaccines = s.vaccines || { done: {} };
        if (!Array.isArray(s.vaccines.subs)) s.vaccines.subs = [];
        if (!s.vaccines.via || typeof s.vaccines.via !== 'object') s.vaccines.via = {};
        var sub = { id: Util.uid(), name: name, date: dt, covers: covers };
        s.vaccines.subs.push(sub);
        covers.forEach(function (k) { s.vaccines.done[k] = dt; s.vaccines.via[k] = sub.id; });
        if (Storage.save()) Util.toast('已记录 ' + name + (covers.length ? '，抵扣 ' + covers.length + ' 剂' : ''), 'ok');
        global.App.rerender();
      });
      Array.prototype.forEach.call(view.querySelectorAll('[data-subdel]'), function (b) {
        b.addEventListener('click', function () {
          var sid = b.getAttribute('data-subdel');
          var s = Storage.get();
          var list = (s.vaccines && s.vaccines.subs) || [];
          var sub = list.filter(function (x) { return x.id === sid; })[0];
          if (!sub) return;
          Util.confirm({
            title: '删除这条自费疫苗记录？',
            message: (sub.covers && sub.covers.length) ? '它抵扣的 ' + sub.covers.length + ' 剂会恢复为未种。' : '',
            okText: '删除', danger: true,
            onConfirm: function () {
              s.vaccines.subs = list.filter(function (x) { return x.id !== sid; });
              var via = s.vaccines.via || {};
              Object.keys(via).forEach(function (k) {
                if (via[k] === sid) { delete via[k]; if (s.vaccines.done) delete s.vaccines.done[k]; }
              });
              Storage.save(); global.App.rerender();
            }
          });
        });
      });

      view.querySelector('#vBirth').addEventListener('change', function (e) {
        var s = Storage.get();
        s.settings.baby = s.settings.baby || { sex: 'boy', birthDate: null, preterm: false, birthGestWeeks: 40 };
        s.settings.baby.birthDate = e.target.value || null;
        s.settings.baby.birthLunar = Util.birthLunarOf ? Util.birthLunarOf('vBirth') : null;
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
      var bf = view.querySelector('#vBackfill');
      if (bf) bf.addEventListener('click', function () {
        var its = plan(Storage.get().settings.baby.birthDate);
        var s0 = Storage.get(); s0.vaccines = s0.vaccines || { done: {} };
        var keys = its.filter(function (it) { return !s0.vaccines.done[it.key] && Util.daysBetween(today, it.dueISO) < 0; });
        Util.confirm({
          title: '补记 ' + keys.length + ' 剂为已接种？',
          message: '日期按各剂的应种日填写，之后可以点「改日期」逐条改成接种证上的日期。',
          okText: '补记', cancelText: '取消',
          onConfirm: function () {
            var s = Storage.get();
            keys.forEach(function (it) { s.vaccines.done[it.key] = it.dueISO; });
            Storage.save(); global.App.rerender();
            Util.toast('已补记 ' + keys.length + ' 剂', 'ok', { label: '撤销', onClick: function () {
              var s2 = Storage.get();
              keys.forEach(function (it) { delete s2.vaccines.done[it.key]; });
              Storage.save(); global.App.rerender();
            } });
          }
        });
      });
      /* 第 199 次：接种详情展开 / 部位单选 / 反应多选 / 保存 */
      Array.prototype.forEach.call(view.querySelectorAll('[data-vacdet]'), function (b) {
        b.addEventListener('click', function () {
          var k = b.getAttribute('data-vacdet');
          openDetail = (openDetail === k) ? null : k;
          global.App.rerender();
        });
      });
      Array.prototype.forEach.call(view.querySelectorAll('[data-vds]'), function (b) {
        b.addEventListener('click', function () {
          var on = b.classList.contains('active');
          Array.prototype.forEach.call(view.querySelectorAll('[data-vds]'), function (x) { x.classList.remove('active'); x.setAttribute('aria-pressed', 'false'); });
          if (!on) { b.classList.add('active'); b.setAttribute('aria-pressed', 'true'); }
        });
      });
      Array.prototype.forEach.call(view.querySelectorAll('[data-vdr]'), function (b) {
        b.addEventListener('click', function () {
          var v = b.getAttribute('data-vdr'), on = !b.classList.contains('active');
          /* 「无明显反应」与其他项互斥 */
          Array.prototype.forEach.call(view.querySelectorAll('[data-vdr]'), function (x) {
            var xv = x.getAttribute('data-vdr');
            if (on && ((v === 'none' && xv !== 'none') || (v !== 'none' && xv === 'none'))) { x.classList.remove('active'); x.setAttribute('aria-pressed', 'false'); }
          });
          b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on));
        });
      });
      var vdSave = view.querySelector('#vdSave');
      if (vdSave) vdSave.addEventListener('click', function () {
        var k = vdSave.getAttribute('data-key');
        var s = Storage.get();
        s.vaccines = s.vaccines || { done: {} };
        if (!s.vaccines.notes || typeof s.vaccines.notes !== 'object' || Array.isArray(s.vaccines.notes)) s.vaccines.notes = {};
        var siteB = view.querySelector('[data-vds].active');
        var n = {
          site: siteB ? siteB.getAttribute('data-vds') : null,
          react: Array.prototype.map.call(view.querySelectorAll('[data-vdr].active'), function (x) { return x.getAttribute('data-vdr'); }),
          clinic: view.querySelector('#vdClinic').value.trim().slice(0, 30) || null,
          lot: view.querySelector('#vdLot').value.trim().slice(0, 30) || null,
          note: view.querySelector('#vdNote').value.trim().slice(0, 60) || null
        };
        if (!n.site && !n.react.length && !n.clinic && !n.lot && !n.note) delete s.vaccines.notes[k];
        else s.vaccines.notes[k] = n;
        openDetail = null;
        if (Storage.save()) Util.toast('已保存接种详情', 'ok');
        global.App.rerender();
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
          var uk = b.getAttribute('data-unvax');
          if (s.vaccines && s.vaccines.done) delete s.vaccines.done[uk];
          if (s.vaccines && s.vaccines.via) delete s.vaccines.via[uk];
          if (s.vaccines && s.vaccines.notes) delete s.vaccines.notes[uk];
          if (openDetail === uk) openDetail = null;
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
