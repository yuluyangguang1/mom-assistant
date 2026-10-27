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
 * 第 289 次：页面重做成「疫苗本」（封面 + 全屏翻页 + 创可贴贴纸），见文件后半段说明。
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
    { name: '手足口（EV71）疫苗', fam: [] },
    { name: 'Hib 疫苗', fam: [] },
    { name: 'RSV 单抗（尼塞韦单抗）', fam: [] }
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

  /* ======================================================================
     第 289 次：疫苗页重做成「疫苗本」（工具页第一个）
     页面 = 摘要 → （首次）疫苗提醒卡 → 疫苗本封面（轻点翻开）→ 工具行（儿保 / 提醒 / 生日）→ 一行出处 → 底部「+ 记一次接种」。
     翻开 = 全屏翻页，一剂一页（免疫规划按程序顺序，之后是不抵扣剂次的自选疫苗）；已接种页盖章 + 贴一枚创可贴，
     待接种页留空章。记录 / 修改 / 删除都在半屏面板里完成。
     数据只加可选字段，结构不动：
       vaccines.done[key] = 'YYYY-MM-DD'（老数据偶有 { date } 对象，只读兼容）
       vaccines.notes[key] = { site, clinic, lot, react, note, + at:'HH:MM', maker, stk }
       vaccines.subs[i]    = { id, name, date, covers, + at, maker, lot, site, clinic, stk }
       vaccines.cover      = 封面贴纸 id（可选，默认 heart）
     本机提醒卡的选择存 localStorage 'yiya-vac-remind'（'cal' | 'no'），同营养品「每位照护者在自己的设备上」。
     ====================================================================== */
  var STK = [['heart', '爱心'], ['star', '星星'], ['flower', '小花'], ['sprout', '嫩芽'], ['moon', '月亮'], ['cloud', '云朵'], ['cherry', '樱桃'], ['lemon', '柠檬']];
  var REM_KEY = 'yiya-vac-remind';
  function esc(s) { return Util.escapeHtml(s == null ? '' : String(s)); }
  function validDay(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }
  function validHM(s) { return typeof s === 'string' && /^\d{2}:\d{2}$/.test(s); }
  function dOf(v) { if (validDay(v)) return v; if (v && typeof v === 'object' && validDay(v.date)) return v.date; return null; }
  function stkOk(id) { for (var i = 0; i < STK.length; i++) if (STK[i][0] === id) return id; return null; }
  function stkName(id) { for (var i = 0; i < STK.length; i++) if (STK[i][0] === id) return STK[i][1]; return ''; }
  /* 没选过贴纸的老记录：按 key+日期 稳定挑一枚（每次打开都一样） */
  function stkFor(seed, chosen) {
    if (stkOk(chosen)) return chosen;
    var h = 0, t = String(seed || '');
    for (var i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
    return STK[h % STK.length][0];
  }
  function stkImg(id, cls) { return '<img class="' + (cls || '') + '" src="assets/sticker/' + id + '.webp" alt="" width="200" height="74" decoding="async">'; }
  function remState() { try { return global.localStorage.getItem(REM_KEY) || ''; } catch (e) { return ''; } }
  function setRem(v) { try { global.localStorage.setItem(REM_KEY, v); } catch (e) {} }
  function reduced() { try { return global.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }
  function vacOf(d) {
    if (!d.vaccines || typeof d.vaccines !== 'object') d.vaccines = { done: {} };
    if (!d.vaccines.done || typeof d.vaccines.done !== 'object') d.vaccines.done = {};
    return d.vaccines;
  }
  function subsOf(d) { var v = d.vaccines; return (v && Array.isArray(v.subs)) ? v.subs.filter(function (x) { return x && typeof x === 'object' && x.id; }) : []; }
  function subById(d, id) { var l = subsOf(d); for (var i = 0; i < l.length; i++) if (String(l[i].id) === String(id)) return l[i]; return null; }
  function viaSub(d, key) { var via = d.vaccines && d.vaccines.via; return (via && typeof via === 'object' && via[key]) ? subById(d, via[key]) : null; }
  function famOf(key) { return String(key).split('-')[0]; }
  /* 参考月龄：0 = 出生时；≤18 月写月龄，更大写岁 */
  function ageLab(at) {
    var m = Math.round(at / 30.44);
    if (m <= 0) return '出生时';
    if (m <= 18) return m + ' 月龄';
    return Math.round(m / 12) + ' 岁';
  }
  function cnDate(iso) { return validDay(iso) ? (+iso.slice(0, 4)) + ' 年 ' + (+iso.slice(5, 7)) + ' 月 ' + (+iso.slice(8, 10)) + ' 日' : ''; }
  function mdDate(iso) { return validDay(iso) ? (+iso.slice(5, 7)) + '月' + (+iso.slice(8, 10)) + '日' : ''; }
  function ago(iso, today) {
    var n = Util.daysBetween(iso, today);
    if (n <= 0) return '今天';
    if (n === 1) return '昨天';
    if (n < 31) return n + ' 天前';
    return agoText(n) + '前';
  }
  function babyName(d) {
    var b = (d.settings && d.settings.baby) || {};
    var n = String(b.nickname || b.name || '').trim();
    return n ? n.slice(0, 12) : '宝宝';
  }

  /* 疫苗本的页：免疫规划每剂一页（程序顺序），之后是不抵扣剂次的自选疫苗（按日期） */
  function pagesOf(d) {
    var b = (d.settings && d.settings.baby) || {};
    var done = (d.vaccines && d.vaccines.done) || {};
    var out = [];
    if (b.birthDate) {
      SCHEDULE.forEach(function (s) {
        var dt = dOf(done[s.key]), n = dt ? noteOf(d, s.key) : null, vs = dt ? viaSub(d, s.key) : null;
        out.push({ kind: 'plan', id: s.key, key: s.key, name: s.name, dose: s.dose, at: s.at, dueISO: Util.addDays(b.birthDate, s.at),
          date: dt, hm: n && validHM(n.at) ? n.at : (vs && validHM(vs.at) ? vs.at : ''), note: n, via: vs,
          stk: dt ? stkFor(s.key + dt, (n && n.stk) || (vs && vs.stk)) : null });
      });
    }
    subsOf(d).filter(function (x) { return !(Array.isArray(x.covers) && x.covers.length) && dOf(x.date); })
      .sort(function (a, c) { return String(a.date).localeCompare(String(c.date)); })
      .forEach(function (x) {
        out.push({ kind: 'sub', id: 'sub:' + x.id, sid: x.id, name: String(x.name || '自选疫苗'), dose: '', date: dOf(x.date), hm: validHM(x.at) ? x.at : '',
          note: x, stk: stkFor(x.id + x.date, x.stk) });
      });
    return out;
  }
  /* 一次接种 = 一条自选记录（不论抵扣几剂）或一剂没被抵扣的免疫规划 */
  function events(d) {
    var done = (d.vaccines && d.vaccines.done) || {}, ev = [];
    SCHEDULE.forEach(function (s) { var dt = dOf(done[s.key]); if (dt && !viaSub(d, s.key)) ev.push({ date: dt, stk: stkFor(s.key + dt, (noteOf(d, s.key) || {}).stk) }); });
    subsOf(d).forEach(function (x) { var dt = dOf(x.date); if (dt) ev.push({ date: dt, stk: stkFor(x.id + dt, x.stk) }); });
    return ev;
  }

  /* ---------- 半屏：记一次接种 / 修改这一页 ---------- */
  var openAt = 0;
  function sheetBase(title, body, cls, ready) {
    var FT = global.FTUI; if (!FT) return null;
    if (Date.now() - openAt < 450) return null; /* 手指连点不开两个 */
    openAt = Date.now();
    return FT.openSheet('vaccine', title, body, function (api) {
      var m = api.box.closest('.modal'); if (m && cls) m.classList.add(cls);
      var closed = false;
      api.onClose = (function (prev) { return function () { closed = true; if (prev) prev.apply(this, arguments); }; })(api.onClose);
      api.isClosed = function () { return closed; };
      ready(api);
    });
  }
  function sitePills(cur) {
    return '<div class="dp-flags vs-sites">' + VSITES.map(function (o) {
      return '<button type="button" class="dp-pill' + (cur === o[0] ? ' active' : '') + '" data-vds="' + o[0] + '" aria-pressed="' + (cur === o[0]) + '">' + o[1] + '</button>';
    }).join('') + '</div>';
  }
  function stkPick(cur, allowRandom) {
    var h = '<div class="vs-stks" role="radiogroup" aria-label="贴纸">';
    if (allowRandom) h += '<button type="button" class="vs-stk' + (!cur ? ' on' : '') + '" data-vstk="" role="radio" aria-checked="' + (!cur) + '"><span>随机</span></button>';
    STK.forEach(function (s) {
      var on = cur === s[0];
      h += '<button type="button" class="vs-stk' + (on ? ' on' : '') + '" data-vstk="' + s[0] + '" role="radio" aria-checked="' + on + '" aria-label="' + s[1] + '">' + stkImg(s[0]) + '</button>';
    });
    return h + '</div>';
  }
  function detailFields(n) {
    n = n || {};
    return '<p class="rs-lbl">接种信息（可选）</p><div class="vs-more">'
      + '<label class="rs-note"><span class="rs-lbl">生产企业</span><input type="text" id="vaMaker" maxlength="30" placeholder="接种本上有" value="' + esc(n.maker || '') + '"></label>'
      + '<label class="rs-note"><span class="rs-lbl">批号</span><input type="text" id="vaLot" maxlength="30" placeholder="接种本上有" value="' + esc(n.lot || '') + '"></label>'
      + '<span class="rs-lbl">接种部位</span>' + sitePills(n.site)
      + '<label class="rs-note"><span class="rs-lbl">接种单位</span><input type="text" id="vaClinic" maxlength="30" placeholder="如 XX 社区卫生服务中心" value="' + esc(n.clinic || '') + '"></label></div>';
  }
  function readDetails(box) {
    var g = function (id) { var e = box.querySelector('#' + id); return e ? String(e.value || '').trim().slice(0, 30) || null : null; };
    var sb = box.querySelector('[data-vds].active');
    return { maker: g('vaMaker'), lot: g('vaLot'), clinic: g('vaClinic'), site: sb ? sb.getAttribute('data-vds') : null };
  }
  function bindPills(box) {
    box.addEventListener('click', function (e) {
      if (Util.hapEcho(e)) return;
      var b = e.target.closest ? e.target.closest('[data-vds],[data-vstk],[data-vdr]') : null;
      if (!b || !box.contains(b)) return;
      if (b.hasAttribute('data-vds')) {
        var on = b.classList.contains('active');
        Array.prototype.forEach.call(box.querySelectorAll('[data-vds]'), function (x) { x.classList.remove('active'); x.setAttribute('aria-pressed', 'false'); });
        if (!on) { b.classList.add('active'); b.setAttribute('aria-pressed', 'true'); }
      } else if (b.hasAttribute('data-vstk')) {
        Array.prototype.forEach.call(box.querySelectorAll('[data-vstk]'), function (x) { var o = x === b; x.classList.toggle('on', o); x.setAttribute('aria-checked', String(o)); });
      } else {
        var v = b.getAttribute('data-vdr'), on2 = !b.classList.contains('active');
        Array.prototype.forEach.call(box.querySelectorAll('[data-vdr]'), function (x) {
          var xv = x.getAttribute('data-vdr');
          if (on2 && ((v === 'none' && xv !== 'none') || (v !== 'none' && xv === 'none'))) { x.classList.remove('active'); x.setAttribute('aria-pressed', 'false'); }
        });
        b.classList.toggle('active', on2); b.setAttribute('aria-pressed', String(on2));
      }
    });
  }
  function pickedStk(box) { var b = box.querySelector('[data-vstk].on'); var v = b ? b.getAttribute('data-vstk') : ''; return stkOk(v) || STK[Math.floor(Math.random() * STK.length)][0]; }
  function nowHM() { var t = new Date(); return ('0' + t.getHours()).slice(-2) + ':' + ('0' + t.getMinutes()).slice(-2); }
  function coversHTML(d, pre) {
    var b = (d.settings && d.settings.baby) || {}, done = (d.vaccines && d.vaccines.done) || {};
    var items = b.birthDate ? plan(b.birthDate).filter(function (it) { return !dOf(done[it.key]); }) : [];
    if (!items.length) return '<p class="ms-ref">没有未接种的免疫规划剂次可抵扣。</p>';
    return items.map(function (it) {
      var on = pre && pre.indexOf(it.key) >= 0;
      return '<label class="chk"><input type="checkbox" value="' + it.key + '"' + (on ? ' checked' : '') + '> ' + it.name + it.dose + ' <small>' + it.dueISO + '</small></label>';
    }).join('');
  }
  function famPreselect(d, preset) {
    var done = (d.vaccines && d.vaccines.done) || {}, out = [];
    (preset.fam || []).forEach(function (f) {
      var keys = FAMILY[f] || [];
      for (var i = 0; i < keys.length; i++) if (!dOf(done[keys[i]])) { out.push(keys[i]); break; }
    });
    return out;
  }

  /* 记一次接种：常见（免疫规划剂次 / 联合与自费）| 自定义 */
  function openAdd(pre, after) {
    var d = Storage.get();
    var b = (d.settings && d.settings.baby) || {};
    var today = Util.todayISO();
    var done = (d.vaccines && d.vaccines.done) || {};
    var pend = b.birthDate ? plan(b.birthDate).filter(function (it) { return !dOf(done[it.key]); }) : [];
    var FT = global.FTUI;
    var newId = Util.uid();
    var pick = pre && /^k:/.test(pre) && pend.some(function (it) { return 'k:' + it.key === pre; }) ? pre : (pend.length ? 'k:' + pend[0].key : '');
    var list = '';
    if (pend.length) {
      list += '<p class="vs-grp">免疫规划</p>';
      pend.forEach(function (it) {
        var on = pick === 'k:' + it.key;
        list += '<button type="button" class="vs-opt' + (on ? ' on' : '') + '" data-vapick="k:' + it.key + '" data-q="' + esc(it.name + it.dose) + '" role="radio" aria-checked="' + on + '"><b>' + it.name + '</b><small>' + it.dose + ' · ' + mdDate(it.dueISO) + '</small></button>';
      });
    }
    list += '<p class="vs-grp">联合 / 自费</p>';
    SUB_PRESETS.forEach(function (p, i) {
      list += '<button type="button" class="vs-opt" data-vapick="p:' + i + '" data-q="' + esc(p.name) + '" role="radio" aria-checked="false"><b>' + esc(p.name) + '</b>' + (p.fam.length ? '<small>可抵扣部分免疫规划剂次</small>' : '') + '</button>';
    });
    var body = FT.whenTiles('va', '接种时间', today, nowHM(), today, b.birthDate || '')
      + '<div class="rs-seg sk-seg sk-n2 vs-mode" role="tablist"><button type="button" class="on" data-vamode="c" role="tab" aria-selected="true">常见</button><button type="button" data-vamode="u" role="tab" aria-selected="false">自定义</button></div>'
      + '<div class="vs-pane" data-vapane="c"><label class="vs-search"><input type="search" id="vaQ" placeholder="搜索疫苗" aria-label="搜索疫苗" enterkeyhint="search"></label>'
      + '<div class="vs-list" role="radiogroup" aria-label="选择疫苗">' + list + '<p class="vs-none" hidden>没有找到，可以在「自定义」里填写</p></div></div>'
      + '<div class="vs-pane" data-vapane="u" hidden><label class="rs-note"><span class="rs-lbl">疫苗名称</span><input type="text" id="vaName" maxlength="30" placeholder="如 Hib 疫苗"></label></div>'
      + '<div class="vs-cov" hidden><p class="rs-lbl">抵扣哪些免疫规划剂次（以门诊告知为准，可不选）</p><div class="vsub-covers" id="vaCovers"></div></div>'
      + detailFields(null)
      + '<p class="rs-lbl">贴纸</p>' + stkPick('', true)
      + '<div class="rs-savebar"><button type="button" class="btn btn-primary rs-save" id="vaSave">保存</button></div>';
    sheetBase('记一次接种', body, 'vac-sheet', function (api) {
      var box = api.box, saving = false, mode = 'c';
      ['vaDate', 'vaTime'].forEach(function (id) { var e = box.querySelector('#' + id); if (e && e._paint) e._paint(); });
      bindPills(box);
      var cov = box.querySelector('.vs-cov'), covBox = box.querySelector('#vaCovers');
      function showCov(pre2) { cov.hidden = false; covBox.innerHTML = coversHTML(Storage.get(), pre2); }
      function setPick(v) {
        pick = v;
        Array.prototype.forEach.call(box.querySelectorAll('[data-vapick]'), function (x) { var o = x.getAttribute('data-vapick') === v; x.classList.toggle('on', o); x.setAttribute('aria-checked', String(o)); });
        if (/^p:/.test(v)) showCov(famPreselect(Storage.get(), SUB_PRESETS[+v.slice(2)] || { fam: [] }));
        else if (mode === 'c') cov.hidden = true;
      }
      if (/^p:\d+$/.test(pre || '')) setPick(pre);
      box.addEventListener('click', function (e) {
        if (api.isClosed() || Util.hapEcho(e)) return;
        var t = e.target.closest ? e.target.closest('button') : null;
        if (!t || !box.contains(t)) return;
        if (t.id === 'vaSave' || t.hasAttribute('data-ok')) { save(); return; }
        var pk = t.getAttribute('data-vapick'); if (pk) { setPick(pk); return; }
        var md = t.getAttribute('data-vamode');
        if (md) {
          mode = md;
          Array.prototype.forEach.call(box.querySelectorAll('[data-vamode]'), function (x) { var o = x === t; x.classList.toggle('on', o); x.setAttribute('aria-selected', String(o)); });
          Array.prototype.forEach.call(box.querySelectorAll('[data-vapane]'), function (x) { x.hidden = x.getAttribute('data-vapane') !== md; });
          if (md === 'u') showCov([]); else setPick(pick);
        }
      });
      var q = box.querySelector('#vaQ');
      q.addEventListener('input', function () {
        var k = q.value.trim().toLowerCase(), any = false;
        Array.prototype.forEach.call(box.querySelectorAll('[data-vapick]'), function (x) {
          var hit = !k || x.getAttribute('data-q').toLowerCase().indexOf(k) >= 0; x.hidden = !hit; if (hit) any = true;
        });
        Array.prototype.forEach.call(box.querySelectorAll('.vs-grp'), function (g) { g.hidden = !!k; });
        box.querySelector('.vs-none').hidden = any;
      });
      function save() {
        if (saving || api.isClosed()) return;
        var dv = (box.querySelector('#vaDate') || {}).value, tv = ((box.querySelector('#vaTime') || {}).value || '').slice(0, 5);
        if (!validDay(dv) || dv > Util.todayISO()) { Util.toast('请选择不晚于今天的日期', 'warn'); return; }
        if (!validHM(tv)) tv = null;
        var det = readDetails(box), stk = pickedStk(box);
        var s = Storage.get(), v = vacOf(s), name = '', covers = [], key = null;
        if (mode === 'u') {
          var ni = box.querySelector('#vaName'); name = String(ni.value || '').trim().slice(0, 30);
          if (!name) { Util.markInvalid(ni, '请填写疫苗名称'); return; }
        } else if (/^k:/.test(pick)) key = pick.slice(2);
        else if (/^p:\d+$/.test(pick) && SUB_PRESETS[+pick.slice(2)]) name = SUB_PRESETS[+pick.slice(2)].name;
        else { Util.toast('请选择疫苗', 'warn'); return; }
        if (!key) covers = Array.prototype.map.call(box.querySelectorAll('#vaCovers input:checked'), function (c) { return c.value; })
          .filter(function (k) { return SCHEDULE.some(function (x) { return x.key === k; }) && !dOf(v.done[k]); });
        saving = true;
        var snap = JSON.stringify(v), label, pageId;
        if (key) {
          if (dOf(v.done[key])) { saving = false; api.close(); return; } /* 幂等：已记过 */
          v.done[key] = dv;
          if (!v.notes || typeof v.notes !== 'object' || Array.isArray(v.notes)) v.notes = {};
          var n0 = v.notes[key] && typeof v.notes[key] === 'object' ? v.notes[key] : {};
          n0.at = tv; n0.stk = stk; n0.maker = det.maker; n0.lot = det.lot; n0.clinic = det.clinic; n0.site = det.site;
          v.notes[key] = n0;
          var it = SCHEDULE.filter(function (x) { return x.key === key; })[0];
          label = it.name + it.dose; pageId = key;
        } else {
          if (!Array.isArray(v.subs)) v.subs = [];
          if (!v.via || typeof v.via !== 'object') v.via = {};
          if (v.subs.some(function (x) { return x && x.id === newId; })) { saving = false; api.close(); return; }
          v.subs.push({ id: newId, name: name, date: dv, covers: covers, at: tv, maker: det.maker, lot: det.lot, clinic: det.clinic, site: det.site, stk: stk });
          covers.forEach(function (k) { v.done[k] = dv; v.via[k] = newId; });
          label = name + (covers.length ? '，抵扣 ' + covers.length + ' 剂' : ''); pageId = covers.length ? covers[0] : 'sub:' + newId;
        }
        if (!Storage.save()) { saving = false; return; }
        api.close();
        global.App.rerender();
        if (after) after(pageId);
        Util.toast('已记录：' + label, 'ok', { label: '撤销', onClick: function () {
          var s2 = Storage.get(); s2.vaccines = JSON.parse(snap); Storage.save(); global.App.rerender(); Book.refresh();
        } });
      }
    });
  }

  /* 修改这一页（免疫规划剂次 / 自选疫苗）；删除在面板里 */
  function openEdit(pid, after) {
    var d = Storage.get(), FT = global.FTUI;
    var isSub = /^sub:/.test(String(pid));
    var sub = isSub ? subById(d, String(pid).slice(4)) : null;
    var key = isSub ? null : String(pid);
    var it = key ? SCHEDULE.filter(function (x) { return x.key === key; })[0] : null;
    var dt = sub ? dOf(sub.date) : (it ? dOf(((d.vaccines || {}).done || {})[key]) : null);
    if ((!sub && !it) || !dt) return;
    var n = sub || noteOf(d, key) || {};
    var vs = key ? viaSub(d, key) : null;
    var today = Util.todayISO(), b = (d.settings && d.settings.baby) || {};
    var rx = Array.isArray(n.react) ? n.react : [];
    var body = (sub ? '<label class="rs-note"><span class="rs-lbl">疫苗名称</span><input type="text" id="vaName" maxlength="30" value="' + esc(sub.name || '') + '"></label>'
        : '<p class="vs-head"><b>' + it.name + '</b><span>' + it.dose + '</span></p>')
      + (vs ? '<p class="ms-ref">这一剂由「' + esc(vs.name) + '」抵扣，日期跟随那条记录。</p>' : FT.whenTiles('va', '接种时间', dt, validHM(n.at) ? n.at : '', today, b.birthDate || ''))
      + detailFields(n)
      + '<span class="rs-lbl">接种后反应（可多选）</span><div class="dp-flags">'
      + VREACT.map(function (o) { var on = rx.indexOf(o[0]) >= 0; return '<button type="button" class="dp-pill' + (on ? ' active' : '') + '" data-vdr="' + o[0] + '" aria-pressed="' + on + '">' + o[1] + '</button>'; }).join('')
      + '</div><label class="rs-note"><span class="rs-lbl">备注</span><input type="text" id="vaNote" maxlength="60" placeholder="如 第二天退烧" value="' + esc(n.note || '') + '"></label>'
      + '<p class="rs-lbl">贴纸</p>' + stkPick(stkFor((sub ? sub.id : key) + dt, n.stk), false)
      + '<p class="ms-ref">接种后出现高热不退、大面积红肿、精神差或其他担心的情况，请联系接种门诊或就医。</p>'
      + '<button type="button" class="btn rs-del" data-vadel>删除这条记录</button>'
      + '<div class="rs-savebar"><button type="button" class="btn btn-primary rs-save" id="vaSave">保存修改</button></div>';
    sheetBase('修改这一页', body, 'vac-sheet', function (api) {
      var box = api.box, saving = false;
      ['vaDate', 'vaTime'].forEach(function (id) { var e = box.querySelector('#' + id); if (e && e._paint) e._paint(); });
      bindPills(box);
      box.addEventListener('click', function (e) {
        if (api.isClosed() || Util.hapEcho(e)) return;
        var t = e.target.closest ? e.target.closest('button') : null;
        if (!t || !box.contains(t)) return;
        if (t.id === 'vaSave' || t.hasAttribute('data-ok')) save();
        else if (t.hasAttribute('data-vadel')) { api.close(); remove(pid); }
      });
      function save() {
        if (saving || api.isClosed()) return;
        var s = Storage.get(), v = vacOf(s), det = readDetails(box);
        var dv = dt, tv = validHM(n.at) ? n.at : null;
        var di = box.querySelector('#vaDate');
        if (di) {
          dv = di.value; tv = ((box.querySelector('#vaTime') || {}).value || '').slice(0, 5) || null;
          if (!validDay(dv) || dv > Util.todayISO()) { Util.toast('请选择不晚于今天的日期', 'warn'); return; }
          if (tv && !validHM(tv)) tv = null;
        }
        var nameV = null;
        if (sub) { var ni = box.querySelector('#vaName'); nameV = String(ni.value || '').trim().slice(0, 30); if (!nameV) { Util.markInvalid(ni, '请填写疫苗名称'); return; } }
        saving = true;
        var stkB = box.querySelector('[data-vstk].on');
        var fields = { at: tv, maker: det.maker, lot: det.lot, clinic: det.clinic, site: det.site,
          react: Array.prototype.map.call(box.querySelectorAll('[data-vdr].active'), function (x) { return x.getAttribute('data-vdr'); }),
          note: String((box.querySelector('#vaNote') || {}).value || '').trim().slice(0, 60) || null,
          stk: stkB ? stkOk(stkB.getAttribute('data-vstk')) : null };
        if (sub) {
          var real = subById(s, sub.id); if (!real) { api.close(); return; }
          Object.keys(fields).forEach(function (k) { real[k] = fields[k]; });
          real.name = nameV;
          if (real.date !== dv) {
            real.date = dv;
            var via = v.via || {};
            Object.keys(via).forEach(function (k) { if (via[k] === real.id) v.done[k] = dv; });
          }
        } else {
          if (!vs) v.done[key] = dv;
          if (!v.notes || typeof v.notes !== 'object' || Array.isArray(v.notes)) v.notes = {};
          var cur = v.notes[key] && typeof v.notes[key] === 'object' ? v.notes[key] : {};
          Object.keys(fields).forEach(function (k) { cur[k] = fields[k]; });
          v.notes[key] = cur;
        }
        if (!Storage.save()) { saving = false; return; }
        api.close(); global.App.rerender(); Book.refresh();
        if (after) after();
        Util.toast('已保存', 'ok');
      }
    });
  }

  /* 删除：免疫规划剂次撤回已种（连同详情 / 抵扣标记）；自选疫苗连同它抵扣的剂次一起撤回。都可撤销 */
  function remove(pid) {
    var s = Storage.get(), v = vacOf(s), snap = JSON.stringify(v), txt;
    if (/^sub:/.test(String(pid))) {
      var sid = String(pid).slice(4), sub = subById(s, sid); if (!sub) return;
      v.subs = v.subs.filter(function (x) { return !(x && String(x.id) === sid); });
      var via = v.via || {}, n = 0;
      Object.keys(via).forEach(function (k) { if (String(via[k]) === sid) { delete via[k]; delete v.done[k]; n++; } });
      txt = '已删除「' + String(sub.name || '').slice(0, 12) + '」' + (n ? '，' + n + ' 剂恢复为待接种' : '');
    } else {
      if (!dOf(v.done[pid])) return;
      delete v.done[pid];
      if (v.via) delete v.via[pid];
      if (v.notes) delete v.notes[pid];
      txt = '已删除这条接种记录';
    }
    Storage.save(); global.App.rerender(); Book.refresh();
    Util.toast(txt, 'ok', { label: '撤销', onClick: function () { var s2 = Storage.get(); s2.vaccines = JSON.parse(snap); Storage.save(); global.App.rerender(); Book.refresh(); } });
  }

  /* ---------- 疫苗本（全屏翻页） ---------- */
  var Book = (function () {
    var el = null, track = null, panes = [], idx = 0, pages = [], rel = null, closing = false;
    var sx = 0, sy = 0, lock = 0, W = 1, off = 0, raf = 0, samples = [], anim = null;
    var FLIP = 'cubic-bezier(.22,.8,.28,1)', BACK = 'cubic-bezier(.3,1.2,.5,1)';
    function pageHTML(p, i, d) {
      if (!p) return '';
      var nm = esc(babyName(d)), h = '<article class="vb-paper' + (p.date ? ' is-done' : ' is-todo') + '">'
        + '<header class="vbp-hd"><span class="vbp-k">' + (p.date ? '已接种' : '待接种') + '</span><b class="vbp-n">' + (i + 1) + '</b></header>'
        + '<h2 class="vbp-name">' + esc(p.name) + '</h2>' + (p.dose ? '<p class="vbp-dose">' + esc(p.dose) + '</p>' : '<p class="vbp-dose">自选疫苗</p>')
        + '<dl class="vbp-dl">';
      if (p.date) h += '<div><dt>接种时间</dt><dd><b>' + cnDate(p.date) + '</b>' + (p.hm ? ' <small>' + esc(p.hm) + '</small>' : '') + '</dd></div>';
      else h += '<div><dt>参考时间</dt><dd><b>' + ageLab(p.at) + '</b> <small>' + mdDate(p.dueISO) + (p.dueISO.slice(0, 4) !== Util.todayISO().slice(0, 4) ? ' · ' + p.dueISO.slice(0, 4) : '') + '</small></dd></div>';
      var pv = p.kind === 'plan' ? PREVENTS[famOf(p.key)] : '';
      if (pv) h += '<div><dt>预防</dt><dd>' + pv + '</dd></div>';
      if (p.via) h += '<div><dt>抵扣</dt><dd>由「' + esc(p.via.name) + '」抵扣</dd></div>';
      if (p.kind === 'sub' && p.note && Array.isArray(p.note.covers) && p.note.covers.length === 0) h += '';
      var n = p.note || {}, ex = [];
      if (p.date) {
        if (n.maker) ex.push(['生产企业', esc(n.maker)]);
        if (n.lot) ex.push(['批号', esc(n.lot)]);
        if (lbl(VSITES, n.site)) ex.push(['部位', lbl(VSITES, n.site)]);
        if (n.clinic) ex.push(['接种单位', esc(n.clinic)]);
      }
      ex.forEach(function (x) { h += '<div class="vbp-ex"><dt>' + x[0] + '</dt><dd>' + x[1] + '</dd></div>'; });
      h += '</dl><div class="vbp-seal">';
      if (p.date) h += '<span class="vb-stamp"><small>已接种</small><b>' + p.date.replace(/-/g, '.') + '</b></span>' + stkImg(p.stk, 'vbp-stk');
      else h += '<span class="vb-stamp is-empty"><small>待接种</small></span><span class="vbp-slot" aria-hidden="true"></span>';
      h += '</div>' + (p.date ? '' : '<p class="vbp-cap">接种后，这里会盖上章</p>')
        + '<footer class="vbp-ft"><span>' + nm + '</span><span>' + (i + 1) + ' / ' + pages.length + '</span></footer></article>';
      return h;
    }
    function fill(pane, i) { var d = Storage.get(); pane.innerHTML = (i >= 0 && i < pages.length) ? pageHTML(pages[i], i, d) : ''; pane._i = i; }
    function place() {
      panes[0].className = 'vb-pg is-prev'; panes[1].className = 'vb-pg is-cur'; panes[2].className = 'vb-pg is-next';
      panes.forEach(function (pn, i) { if (i !== 1) pn.setAttribute('aria-hidden', 'true'); else pn.removeAttribute('aria-hidden'); try { pn.inert = i !== 1; } catch (e) {} });
      var no = el.querySelector('.vb-no'); if (no) no.textContent = (idx + 1) + ' / ' + pages.length;
      var pv = el.querySelector('[data-vbprev]'), nx = el.querySelector('[data-vbnext]');
      if (pv) pv.disabled = idx <= 0; if (nx) nx.disabled = idx >= pages.length - 1;
      var mo = el.querySelector('[data-vbmore]'); if (mo) mo.hidden = !(pages[idx] && pages[idx].date);
      el.setAttribute('data-page', pages[idx] ? pages[idx].id : '');
    }
    function renderAll() { fill(panes[0], idx - 1); fill(panes[1], idx); fill(panes[2], idx + 1); place(); }
    function write() { raf = 0; track.style.transform = 'translate3d(' + off.toFixed(1) + 'px,0,0)'; }
    function finishAnim() { if (!anim) return; var a = anim; anim = null; clearTimeout(a.t); track.removeEventListener('transitionend', a.fn); a.done(); }
    function animate(to, ease, dur, done) {
      finishAnim();
      if (reduced() || dur <= 0) { off = to; track.style.transition = 'none'; done(); return; }
      track.style.transition = 'transform ' + dur + 'ms ' + ease;
      off = to; track.style.transform = 'translate3d(' + to + 'px,0,0)';
      var a = { done: function () { track.style.transition = ''; done(); } };
      a.fn = function (e) { if (e.target === track && anim === a) { anim = null; clearTimeout(a.t); track.removeEventListener('transitionend', a.fn); a.done(); } };
      a.t = setTimeout(function () { if (anim === a) { anim = null; track.removeEventListener('transitionend', a.fn); a.done(); } }, dur + 90);
      track.addEventListener('transitionend', a.fn); anim = a;
    }
    function rest() { track.style.transition = 'none'; track.style.transform = ''; off = 0; el.classList.remove('is-drag'); }
    function commit(dir) {
      idx += dir;
      if (dir > 0) panes = [panes[1], panes[2], panes[0]]; else panes = [panes[2], panes[0], panes[1]];
      var rec = dir > 0 ? panes[2] : panes[0];
      fill(rec, dir > 0 ? idx + 1 : idx - 1);
      place(); rest();
    }
    function flip(dir, v) {
      if (!el) return false;
      if (idx + dir < 0 || idx + dir >= pages.length) { animate(0, BACK, off ? 260 : 0, rest); return false; }
      W = el.querySelector('.vb-stage').clientWidth || 1;
      var to = -dir * W, dist = Math.abs(to - off);
      var dur = v ? Math.max(200, Math.min(340, dist / Math.max(Math.abs(v), 0.6) * 1.6)) : 300;
      animate(to, FLIP, Math.round(dur), function () { commit(dir); });
      return true;
    }
    function go(i) {
      if (!el || i < 0 || i >= pages.length) return;
      finishAnim(); idx = i; renderAll();
    }
    function onStart(e) {
      lock = 0;
      if (!e.touches || e.touches.length !== 1 || modalOpen()) { lock = -1; return; }
      if (anim) finishAnim(); /* 动画中又来手势：先落定，页码不乱 */
      var t = e.touches[0]; sx = t.clientX; sy = t.clientY; samples = [[Date.now(), sx]];
      if (sx < 16) lock = -1; /* iOS 左缘归系统返回 */
    }
    function onMove(e) {
      if (lock < 0 || !e.touches || !e.touches[0]) return;
      var t = e.touches[0], dx = t.clientX - sx, dy = t.clientY - sy;
      if (!lock) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        if (Math.abs(dx) <= Math.abs(dy) * 1.15) { lock = -1; return; }
        lock = 1; W = el.querySelector('.vb-stage').clientWidth || 1; el.classList.add('is-drag');
      }
      if (e.cancelable) e.preventDefault();
      var now = Date.now(); samples.push([now, t.clientX]); if (samples.length > 6) samples.shift();
      if (reduced()) return;
      var x = dx;
      if ((dx > 0 && idx <= 0) || (dx < 0 && idx >= pages.length - 1)) x = (1 - 1 / (Math.abs(dx) * 0.55 / W + 1)) * W * (dx < 0 ? -1 : 1);
      off = x;
      if (!raf) raf = requestAnimationFrame(write);
    }
    function onEnd(e, cancel) {
      if (lock !== 1) { lock = 0; return; }
      lock = 0;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      var t = (e.changedTouches && e.changedTouches[0]) || null;
      var x = t ? t.clientX : (samples.length ? samples[samples.length - 1][1] : sx), dx = x - sx, v = 0;
      if (!cancel && samples.length > 1) { var a = samples[0], b = samples[samples.length - 1]; if (b[0] - a[0] > 0) v = (b[1] - a[1]) / (b[0] - a[0]); }
      if (Date.now() - (samples.length ? samples[samples.length - 1][0] : 0) > 120) v = 0;
      var dir = 0;
      if (Math.abs(dx) >= W / 3) dir = dx < 0 ? 1 : -1;
      else if (Math.abs(v) >= 0.3 && (v < 0) === (dx < 0) && dx !== 0) dir = v < 0 ? 1 : -1;
      if (dir && flip(dir, v)) return;
      animate(0, BACK, reduced() ? 0 : 260, rest);
    }
    function modalOpen() { var mr = document.getElementById('modalRoot'); return !!(mr && mr.children.length); }
    function onKey(e) {
      if (!el || modalOpen()) return;
      if (e.key === 'ArrowLeft') { flip(-1); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { flip(1); e.preventDefault(); }
    }
    function onClick(e) {
      if (Util.hapEcho(e) || closing) return;
      var b = e.target.closest ? e.target.closest('button') : null;
      if (!b || !el.contains(b)) return;
      if (b.hasAttribute('data-vbx')) close();
      else if (b.hasAttribute('data-vbprev')) flip(-1);
      else if (b.hasAttribute('data-vbnext')) flip(1);
      else if (b.hasAttribute('data-vbtoc')) toc();
      else if (b.hasAttribute('data-vbmore')) { var p = pages[idx]; if (p && p.date) openEdit(p.id); }
      else if (b.hasAttribute('data-vbadd')) { var p2 = pages[idx]; openAdd(p2 && p2.kind === 'plan' && !p2.date ? 'k:' + p2.key : null, jumpTo); }
    }
    function jumpTo(pid) { if (!el) return; pages = pagesOf(Storage.get()); for (var i = 0; i < pages.length; i++) if (pages[i].id === pid) { go(i); return; } renderAll(); }
    function toc() {
      var h = '<ol class="vb-toc">';
      pages.forEach(function (p, i) {
        h += '<li><button type="button" class="vbt-row' + (i === idx ? ' on' : '') + (p.date ? ' is-done' : '') + '" data-vbgo="' + i + '"><span class="vbt-n">' + (i + 1) + '</span>'
          + '<span class="vbt-t"><b>' + esc(p.name) + '</b><small>' + (p.dose ? esc(p.dose) + ' · ' : '') + (p.date ? '已接种 ' + mdDate(p.date) : '参考 ' + ageLab(p.at)) + '</small></span>'
          + (p.date ? stkImg(p.stk, 'vbt-stk') : '') + '</button></li>';
      });
      h += '</ol>';
      sheetBase('疫苗本目录', h, 'vac-toc', function (api) {
        var cur = api.box.querySelector('.vbt-row.on'); if (cur && cur.scrollIntoView) try { cur.scrollIntoView({ block: 'center' }); } catch (e) {}
        api.box.addEventListener('click', function (e) {
          if (Util.hapEcho(e) || api.isClosed()) return;
          var b = e.target.closest ? e.target.closest('[data-vbgo]') : null; if (!b) return;
          var i = +b.getAttribute('data-vbgo'); api.close(); go(i);
        });
      });
    }
    function open(at) {
      if (el || closing) return;
      var d = Storage.get(); pages = pagesOf(d);
      if (!pages.length) return;
      idx = 0;
      if (typeof at === 'string') { for (var i = 0; i < pages.length; i++) if (pages[i].id === at) idx = i; }
      else { var best = -1, bd = ''; pages.forEach(function (p, i2) { if (p.date && p.date >= bd) { bd = p.date; best = i2; } }); if (best >= 0) idx = best; }
      var SV = (global.FTUI && FTUI.SV) || {};
      el = document.createElement('div');
      el.className = 'vb-book'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', '疫苗本');
      el.setAttribute('data-accent', 'vaccine');
      el.innerHTML = '<div class="vb-in"><div class="vb-top"><button type="button" class="vb-btn" data-vbx aria-label="合上疫苗本">' + icon('close') + '</button><b>疫苗本</b>'
        + '<button type="button" class="vb-btn" data-vbmore aria-label="修改这一页">' + (SV.more || '…') + '</button></div>'
        + '<div class="vb-stage"><div class="vb-track"><section class="vb-pg"></section><section class="vb-pg"></section><section class="vb-pg"></section></div></div>'
        + '<div class="vb-bar"><button type="button" class="vb-btn" data-vbtoc aria-label="目录"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6.5h10M9 12h10M9 17.5h10" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><circle cx="5" cy="6.5" r="1.3" fill="currentColor"/><circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="5" cy="17.5" r="1.3" fill="currentColor"/></svg></button>'
        + '<div class="vb-nav"><button type="button" class="vb-btn" data-vbprev aria-label="上一页"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>'
        + '<span class="vb-no" aria-live="polite"></span><button type="button" class="vb-btn" data-vbnext aria-label="下一页"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div>'
        + '<button type="button" class="vb-btn" data-vbadd aria-label="记一次接种">' + icon('plus') + '</button></div></div>';
      document.body.appendChild(el);
      track = el.querySelector('.vb-track'); panes = Array.prototype.slice.call(track.children);
      renderAll();
      /* 画面开始变化之前登记 history（第 288 次规则：动画中途不写 history） */
      rel = global.App && App._pushOverlay ? App._pushOverlay(onPop) : null;
      var stage = el.querySelector('.vb-stage');
      stage.addEventListener('touchstart', onStart, { passive: true });
      stage.addEventListener('touchmove', onMove, { passive: false });
      stage.addEventListener('touchend', function (e) { onEnd(e, false); }, { passive: true });
      stage.addEventListener('touchcancel', function (e) { onEnd(e, true); }, { passive: true });
      el.addEventListener('click', onClick);
      document.addEventListener('keydown', onKey);
      document.body.classList.add('vb-open');
      if (!reduced()) { el.classList.add('is-in'); requestAnimationFrame(function () { requestAnimationFrame(function () { if (el) el.classList.remove('is-in'); }); }); }
      if (global.queueStatusColor) global.queueStatusColor();
      try { el.querySelector('[data-vbx]').focus({ preventScroll: true }); } catch (e) {}
    }
    /* 系统返回：盖在上面的面板先关、疫苗本留着（补回那条记录）；否则直接落定关闭，不播动画（和系统快照一致） */
    function onPop() {
      if (global.Sheet && Sheet.isOpen && Sheet.isOpen()) { Sheet.closeTop(); rel = App._pushOverlay(onPop); return; }
      rel = null; teardown();
    }
    function teardown() {
      if (!el) return;
      finishAnim(); if (raf) { cancelAnimationFrame(raf); raf = 0; }
      document.removeEventListener('keydown', onKey);
      if (el.parentNode) el.parentNode.removeChild(el);
      el = null; closing = false; document.body.classList.remove('vb-open');
      if (global.queueStatusColor) global.queueStatusColor();
      var c = document.querySelector('#view .vb-cover'); if (c) try { c.focus({ preventScroll: true }); } catch (e) {}
    }
    function close() {
      if (!el || closing) return;
      closing = true;
      var r = rel; rel = null;
      var done = function () { teardown(); if (r) r(); }; /* 落定后才退 history */
      if (reduced()) { done(); return; }
      el.classList.add('is-out');
      var t = setTimeout(done, 260);
      el.addEventListener('transitionend', function f(e) { if (e.target === el) { el.removeEventListener('transitionend', f); clearTimeout(t); done(); } });
    }
    function refresh() { if (!el) return; var cur = pages[idx] && pages[idx].id; pages = pagesOf(Storage.get()); if (!pages.length) { close(); return; } var j = 0; for (var i = 0; i < pages.length; i++) if (pages[i].id === cur) j = i; idx = Math.min(j, pages.length - 1); renderAll(); }
    return { open: open, close: close, refresh: refresh, isOpen: function () { return !!el; }, go: go, flip: flip, idx: function () { return idx; }, count: function () { return pages.length; } };
  })();

  /* ---------- 其它半屏：封面贴纸 / 疫苗提醒 / 儿保体检 / 宝宝生日 ---------- */
  function openCoverPick() {
    var d = Storage.get(), cur = stkOk(d.vaccines && d.vaccines.cover) || 'heart';
    var h = '<div class="vc-grid" role="radiogroup" aria-label="封面贴纸">';
    STK.forEach(function (s) {
      var on = s[0] === cur;
      h += '<button type="button" class="vc-cell' + (on ? ' on' : '') + '" data-vcov="' + s[0] + '" role="radio" aria-checked="' + on + '">' + stkImg(s[0]) + '<span>' + s[1] + '</span></button>';
    });
    sheetBase('封面贴纸', h + '</div>', 'vac-cover-sheet', function (api) {
      api.box.addEventListener('click', function (e) {
        if (Util.hapEcho(e) || api.isClosed()) return;
        var b = e.target.closest ? e.target.closest('[data-vcov]') : null; if (!b) return;
        var s = Storage.get(); vacOf(s).cover = stkOk(b.getAttribute('data-vcov')) || 'heart';
        if (Storage.save()) { api.close(); global.App.rerender(); }
      });
    });
  }
  function exportIcs() {
    var d = Storage.get(), bdv = ((d.settings && d.settings.baby) || {}).birthDate; if (!bdv) return 0;
    var dn = (d.vaccines && d.vaccines.done) || {}, ck = (d.checkups && d.checkups.done) || {};
    var t0 = Util.todayISO(), byDay = {};
    plan(bdv).forEach(function (it) {
      if (dOf(dn[it.key]) || it.dueISO < t0) return;
      (byDay[it.dueISO] = byDay[it.dueISO] || []).push(it.name + it.dose);
    });
    var evs = Object.keys(byDay).sort().map(function (k) {
      return { uid: 'vac-' + k, date: k, title: '疫苗参考日：' + byDay[k].join('、'), desc: '按国家免疫规划程序推算的参考日期，以接种门诊预约为准。' };
    });
    planCheckups(bdv).forEach(function (it) {
      if (ck[it.key] || it.dueISO < t0) return;
      evs.push({ uid: 'ck-' + it.key, date: it.dueISO, title: '儿保：' + it.name, desc: it.content + '（参考时间，以体检机构安排为准）' });
    });
    if (!evs.length) { Util.toast('没有待接种或待体检的项目', 'ok'); return 0; }
    Util.shareOrDownload('咿呀记_疫苗与儿保.ics', Util.buildICS('宝宝疫苗与儿保', evs), 'text/calendar');
    Util.toast('已生成 ' + evs.length + ' 个日历事件', 'ok');
    return evs.length;
  }
  function remindText(d) {
    return '把待接种和儿保的参考日加进手机日历，前一天 9:00 由日历提醒。'
      + (d.settings && d.settings.remindersEnabled === false ? '' : '打开 App 时，首页也会在参考日前 7 天提示。');
  }
  function openRemind() {
    var d = Storage.get(), st = remState();
    var h = '<p class="vs-txt">' + remindText(d) + '</p>'
      + '<p class="ms-ref">日历事件是一次性导出的：之后记了新的接种、改了生日，需要再导出一次；旧的事件可以在日历里删掉。</p>'
      + '<button type="button" class="btn btn-primary vs-wide" id="vIcs">导出到系统日历</button>'
      + (st === 'cal' ? '' : '<p class="ms-ref">' + (st === 'no' ? '目前没有开启。' : '') + '</p>');
    sheetBase('疫苗提醒', h, 'vac-rem-sheet', function (api) {
      api.box.addEventListener('click', function (e) {
        if (Util.hapEcho(e) || api.isClosed()) return;
        var b = e.target.closest ? e.target.closest('#vIcs') : null; if (!b) return;
        if (exportIcs()) { setRem('cal'); api.close(); global.App.rerender(); }
      });
    });
  }
  function ckBody(d) {
    var baby = (d.settings && d.settings.baby) || {}, today = Util.todayISO();
    var ckDone = (d.checkups && d.checkups.done) || {};
    var h = '<ul class="list vac-list">';
    planCheckups(baby.birthDate).forEach(function (it) {
      var doneDate = ckDone[it.key], left = Util.daysBetween(today, it.dueISO), status, cls;
      if (doneDate) { status = '已体检 ' + esc(doneDate); cls = ' is-done'; }
      else if (left < -30) { status = '已过参考时间较久，下次体检时一并评估'; cls = ' is-over'; }
      else if (left < 0) { status = '已过参考时间 ' + (-left) + ' 天'; cls = ' is-over'; }
      else if (left <= 7) { status = left === 0 ? '参考时间就是今天' : left + ' 天后到期'; cls = ' is-due'; }
      else { status = '参考时间 ' + it.dueISO; cls = ''; }
      h += '<li class="vac-item' + cls + '"><span class="row-ico">' + icon(doneDate ? 'check' : 'heart') + '</span>'
        + '<span class="vac-main"><b>' + it.name + '</b><br><small>' + it.content + ' · ' + status + '</small></span>'
        + (doneDate ? '<button class="btn btn-mini" type="button" data-ckdate="' + it.key + '">改日期</button><button class="icon-btn" type="button" data-unck="' + it.key + '" aria-label="取消已体检" title="取消已体检">' + icon('trash') + '</button>'
          : '<button class="btn btn-mini" type="button" data-ck="' + it.key + '">已体检</button>') + '</li>';
    });
    return h + '</ul><p class="ms-ref">体检时点按国家 0-6 岁儿童健康管理规范生成，仅供参考；以社区卫生服务中心 / 妇幼保健院的实际安排为准，早产宝宝请遵医嘱。</p>';
  }
  function openCheckups() {
    var d = Storage.get(); if (!((d.settings && d.settings.baby) || {}).birthDate) return;
    var lastTap = 0;
    sheetBase('儿保体检', '<div class="vck-wrap">' + ckBody(d) + '</div>', 'vac-ck-sheet', function (api) {
      var wrap = api.box.querySelector('.vck-wrap');
      function redraw() { wrap.innerHTML = ckBody(Storage.get()); global.App.rerender(); }
      function setDate(key, val) {
        var today = Util.todayISO();
        Util.editDate({ title: '实际体检日期', message: '可补记到过去某天；以体检机构记录为准。', value: val || today, max: today, okText: '保存日期',
          onConfirm: function (v) { var s = Storage.get(); s.checkups = s.checkups || { done: {} }; s.checkups.done[key] = v; if (Storage.save()) Util.toast('已更新体检日期：' + v, 'ok'); global.App.rerender(); } });
      }
      api.box.addEventListener('click', function (e) {
        if (Util.hapEcho(e) || api.isClosed()) return;
        var b = e.target.closest ? e.target.closest('[data-ck],[data-unck],[data-ckdate]') : null; if (!b) return;
        if (e.isTrusted && Date.now() - lastTap < 450) return; lastTap = Date.now();
        var s = Storage.get(); s.checkups = s.checkups || { done: {} }; if (!s.checkups.done) s.checkups.done = {};
        var k = b.getAttribute('data-ck');
        if (k) { if (!s.checkups.done[k]) { s.checkups.done[k] = Util.todayISO(); Storage.save(); Util.toast('已记录体检：' + Util.todayISO(), 'ok'); } redraw(); return; }
        k = b.getAttribute('data-unck');
        if (k) { delete s.checkups.done[k]; Storage.save(); redraw(); return; }
        k = b.getAttribute('data-ckdate');
        if (k) { api.close(); setDate(k, s.checkups.done[k]); }
      });
    });
  }
  function bindBirth(root) {
    var bi = root.querySelector('#vBirth'); if (!bi) return;
    Util.bindDateSliders(root);
    bi.addEventListener('change', function (e) {
      var s = Storage.get();
      s.settings.baby = s.settings.baby || { sex: 'boy', birthDate: null, preterm: false, birthGestWeeks: 40 };
      s.settings.baby.birthDate = e.target.value || null;
      s.settings.baby.birthLunar = Util.birthLunarOf ? Util.birthLunarOf('vBirth') : null;
      /* 第 80 次（宝宝档案）：生日改动同步回当前宝宝档案 */
      if (Storage.syncBabyFromSettings) Storage.syncBabyFromSettings();
      Storage.save(); global.App.rerender();
    });
  }
  function openBirth() {
    var d = Storage.get(), baby = d.settings.baby || {};
    var h = Util.birthInput({ id: 'vBirth', title: '出生日期', value: baby.birthDate || '', lunar: baby.birthLunar })
      + '<p class="ms-ref">与「生长」共用同一生日，改一处两边生效；接种排期跟着生日推算。</p>';
    sheetBase('宝宝生日', h, 'vac-birth-sheet', function (api) {
      bindBirth(api.box);
      var bi = api.box.querySelector('#vBirth'); if (bi) bi.addEventListener('change', function () { setTimeout(function () { if (!api.isClosed()) api.close(); }, 0); });
    });
  }
  function backfill() {
    var today = Util.todayISO();
    var its = plan(Storage.get().settings.baby.birthDate);
    var s0 = Storage.get(), v0 = vacOf(s0);
    var keys = its.filter(function (it) { return !dOf(v0.done[it.key]) && Util.daysBetween(today, it.dueISO) < 0; });
    Util.confirm({
      title: '补记 ' + keys.length + ' 剂为已接种？',
      message: '日期按各剂的参考日填写，之后可以翻开疫苗本逐页改成接种证上的日期。',
      okText: '补记', cancelText: '取消',
      onConfirm: function () {
        var s = Storage.get(), v = vacOf(s);
        keys.forEach(function (it) { if (!dOf(v.done[it.key])) v.done[it.key] = it.dueISO; });
        Storage.save(); global.App.rerender();
        Util.toast('已补记 ' + keys.length + ' 剂', 'ok', { label: '撤销', onClick: function () {
          var s2 = Storage.get(); keys.forEach(function (it) { delete s2.vaccines.done[it.key]; });
          Storage.save(); global.App.rerender();
        } });
      }
    });
  }

  var tapAt = 0;
  Modules.vaccine = {
    id: 'vaccine',
    title: '疫苗',
    noHero: true, /* 第 289 次：封面就是这一页的主角，不再叠页头大插画 */
    /* 第 183 次：给页头插画用的接种进度 */
    progress: function (d) {
      var b = (d.settings && d.settings.baby) || {};
      if (!b.birthDate) return null;
      var done = (d.vaccines && d.vaccines.done) || {};
      var items = plan(b.birthDate);
      return { done: items.filter(function (it) { return dOf(done[it.key]); }).length, total: items.length };
    },
    render: function (view) {
      var d = Storage.get();
      var baby = d.settings.baby || {};
      var today = Util.todayISO();
      var html = '';
      if (!baby.birthDate) {
        html += '<div class="sk-empty vac-empty"><img src="assets/hero/vaccine.webp" alt="" width="200" height="200" decoding="sync">'
          + '<p>填写宝宝生日，疫苗本会按免疫程序排好每一页</p></div>'
          + '<div class="card vac-birth">' + Util.birthInput({ id: 'vBirth', title: '出生日期', value: '', lunar: baby.birthLunar })
          + '<p class="ms-ref">与「生长」共用同一生日。</p></div>';
      } else {
        var items = plan(baby.birthDate), done = (d.vaccines && d.vaccines.done) || {};
        var ev = events(d), last = ev.reduce(function (m, x) { return x.date > m ? x.date : m; }, '');
        var next = items.filter(function (it) { return !dOf(done[it.key]); })[0];
        var sum = ev.length ? '疫苗本里有 <b>' + ev.length + ' 次</b>接种记录，上次在<b>' + ago(last, today) + '</b>。'
          : '疫苗本还没有记录，接种后记一笔就会留在这里。';
        if (next) sum += '下一剂参考：<b>' + next.name + '</b><b>' + next.dose + '</b>（' + mdDate(next.dueISO) + '）。';
        else sum += '免疫规划剂次都已记录。';
        html += '<div class="mod-sum"><span class="ms-k">摘要</span><p>' + sum + '</p></div>';
        var pend = items.filter(function (it) { return !dOf(done[it.key]); });
        var future = pend.filter(function (it) { return it.dueISO >= today; });
        if (!remState() && future.length) {
          html += '<div class="card vac-remind"><b class="vr-t">开启疫苗提醒</b><p>' + remindText(d) + '</p>'
            + '<div class="vr-acts"><button type="button" class="btn btn-primary" data-vrem="on">开启</button><button type="button" class="btn" data-vrem="no">暂不</button></div></div>';
        }
        /* 第 146 次：多剂过了参考日还没记录时，最常见的原因是「其实种过了、只是没在本机记」 */
        var pastDue = pend.filter(function (it) { return Util.daysBetween(today, it.dueISO) < 0; });
        if (pastDue.length >= 3) {
          html += '<div class="mod-note vac-bf"><p>有 ' + pastDue.length + ' 剂过了参考日还没记录。已按门诊安排接种的，可以先按参考日一次补记，之后逐页改。</p>'
            + '<button class="btn btn-mini" type="button" id="vBackfill">一键补记</button></div>';
        }
        var cov = stkOk(d.vaccines && d.vaccines.cover) || 'heart';
        html += '<button type="button" class="vb-cover" data-vbopen aria-label="翻开疫苗本，共 ' + (items.length + pagesOf(d).length - items.length) + ' 页">'
          + '<span class="vbc-own">' + esc(babyName(d)) + ' 的</span><b class="vbc-title">疫苗本</b>'
          + stkImg(cov, 'vbc-stk')
          + '<span class="vbc-line">一针一页，慢慢长大</span><span class="vbc-n">已收集 ' + ev.length + ' 枚贴纸</span></button>'
          + '<p class="vb-hint"><span>轻点封面翻开</span><button type="button" class="vb-link" data-vbstk>换封面贴纸</button></p>';
        var ckDone = (d.checkups && d.checkups.done) || {}, cks = planCheckups(baby.birthDate);
        var ckN = cks.filter(function (c) { return ckDone[c.key]; }).length;
        var rs = remState();
        html += '<div class="card vac-tools"><button type="button" class="vt-row" data-vck><span class="vt-ico">' + icon('heart') + '</span><b>儿保体检</b><small>已记 ' + ckN + ' / ' + cks.length + '</small></button>'
          + '<button type="button" class="vt-row" data-vremind><span class="vt-ico">' + icon('bell') + '</span><b>疫苗提醒</b><small>' + (rs === 'cal' ? '已导出到日历' : '未开启') + '</small></button>'
          + '<button type="button" class="vt-row" data-vbirth><span class="vt-ico">' + icon('calendar') + '</span><b>宝宝生日</b><small>' + esc(baby.birthDate) + '</small></button></div>';
        html += '<p class="ms-ref vac-ref">排期按《国家免疫规划疫苗儿童免疫程序及说明（2026 年版）》推算，仅供参考，以接种门诊安排为准。</p>';
        html += '<div class="mod-cta"><button type="button" class="mc-main" data-vnew>' + icon('plus') + '<span>记一次接种</span></button></div>';
      }
      view.innerHTML = '<div class="vac-page" data-accent="vaccine">' + html + '</div>';
      bindBirth(view);
      var page = view.querySelector('.vac-page');
      page.addEventListener('click', function (e) {
        if (Util.hapEcho(e)) return;
        var b = e.target.closest ? e.target.closest('button') : null;
        if (!b || !page.contains(b)) return;
        if (e.isTrusted && Date.now() - tapAt < 450 && !b.hasAttribute('data-vbopen')) return;
        tapAt = Date.now();
        if (b.hasAttribute('data-vbopen')) Book.open();
        else if (b.hasAttribute('data-vnew')) openAdd(null, null);
        else if (b.hasAttribute('data-vbstk')) openCoverPick();
        else if (b.hasAttribute('data-vck')) openCheckups();
        else if (b.hasAttribute('data-vremind')) openRemind();
        else if (b.hasAttribute('data-vbirth')) openBirth();
        else if (b.id === 'vBackfill') backfill();
        else if (b.getAttribute('data-vrem') === 'on') { if (exportIcs()) { setRem('cal'); global.App.rerender(); } }
        else if (b.getAttribute('data-vrem') === 'no') { setRem('no'); global.App.rerender(); }
      });
    },
    /* 日期页 / 测试用的面板入口：rec = { id: 剂次 key | 'sub:'+id } */
    _edit: function (rec) { if (rec && rec.id != null) openEdit(String(rec.id)); },
    _remove: function (id) { remove(String(id)); },
    _add: function (pre) { openAdd(pre || null, null); },
    _recs: function (d) { return pagesOf(d || Storage.get()).filter(function (p) { return p.date; }).map(function (p) { return { id: p.id }; }); },
    _pages: function (d) { return pagesOf(d || Storage.get()); },
    _book: Book,
    _stickers: STK
  };

  /* 提醒引擎共用：由生日生成排期 */
  Modules.vaccine._plan = plan;
  /* 第 70 次：体检排期同样供提醒引擎共用 */
  Modules.vaccine._planCheckups = planCheckups;
  Modules.vaccine._dateOf = dOf;
  Modules.vaccine._schedule = SCHEDULE;
})(window);
