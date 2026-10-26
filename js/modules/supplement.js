/**
 * supplement.js - 营养品（补剂）· 第 280 次照用户 10 张参考截图重做
 *
 * 与「吃药/维D」页的分工（别混）：
 *   · 吃药/维D  meds  —— 短期、有症状才吃的东西（退烧药、抗生素、临时维D）；
 *   · 营养品    本页  —— 长期按日程吃的营养补充（维D/AD/铁/钙/DHA/益生菌、妈妈的叶酸/复合维生素…）。
 *
 * 页面：日期胶囊「2026年10月26日」+「今天」→ 一周日期条 →「服用日程」（选中那天每个时间一张卡，点一下记录服用、
 *       再点撤销）→「营养品清单」+「管理」→ 空状态大插画 → 底部「+ 添加营养品」。
 * 添加 / 编辑：全屏 6 步向导（✕ 标题 6 段进度条；每步大图标卡 + 步骤名 + 营养品名 +「第 n 步，共 6 步」；底部 下一步 / 上一步）
 *   1 选择营养品：名称、常用预设（按宝宝 / 妈妈分组，选中填名称、剂型、默认单位；规格只给可选建议）、剂型 7 种
 *   2 填写规格：开关「添加包装上的规格」，关 =「未注明规格」
 *   3 安排服用日程：频率（每天 / 每周特定几天 / 每隔几天）、每个服用时间 + 每次用量（单位随剂型）、添加时间、开始日期、结束日期开关
 *   4 服用日与方式（参考图缺这一步）：按频率细化——每周选星期几、隔几天一次；服用方式（不限 / 空腹 / 随餐 / 餐后 / 睡前，选填）
 *   5 提醒与库存：本机提醒开关（存在本机，不随备份走）、关联用品（接「用品」模块，可当场添加）、每次扣减数量
 *   6 确认营养品：逐项列出 + 备注 +「保存营养品」
 * 清单卡点开 = 提醒设置（✕ 标题 ✓；名称、频率、本机提醒开关），下面是 编辑 / 停用 / 删除。
 *
 * 数据（仍是 d.supplementPlans / d.supplements，旧字段一个不删）：
 *   计划 { id, name, form, perDay(= times.length，旧读者照用), active, sortOrder,
 *          v:2, preset, spec, freq:'daily'|'weekly'|'interval', days:[1..7], every, times:[{t:'08:00', n:1}],
 *          unit, start, end, meal, stock:{ id, n }|null, note }
 *   记录 { id, time, name, planId, dose:'1 包', qty, unit, slot:'08:00', stock:{ id, n }?, note }
 *   旧计划（只有 name/form/perDay/remindAt）照常显示：时间按 remindAt 或 08:00 起每 4 小时排开，按旧规则提醒；
 *   在向导里保存一次就升成 v2。旧记录（没有 slot）按时间先后填进当天的空位。
 * 只记录不推荐剂量（U-25）：吃多少、吃多久，按医嘱或说明书。
 */
(function (global) {
  'use strict';
  var Storage = global.Storage, Util = global.Util;
  var Modules = global.Modules = global.Modules || {};
  var esc = function (s) { return Util.escapeHtml(s == null ? '' : String(s)); };
  var p2 = function (n) { return (n < 10 ? '0' : '') + n; };

  /* ---------- 剂型 ---------- */
  var FORMS = [
    { k: '胶囊', u: '粒', per: '每粒' }, { k: '片剂', u: '片', per: '每片' }, { k: '软糖', u: '颗', per: '每颗' },
    { k: '滴剂', u: '滴', per: '每滴' }, { k: '粉剂', u: '包', per: '每包' }, { k: '液体', u: 'ml', per: '每 ml' },
    { k: '其他', u: '次', per: '每份' }
  ];
  var UNITS = ['粒', '片', '颗', '滴', '包', 'ml', '次'];
  function formOf(k) { for (var i = 0; i < FORMS.length; i++) if (FORMS[i].k === k) return FORMS[i]; return FORMS[6]; }
  function formKey(k) { return formOf(k).k; }

  /* ---------- 常用预设（第 280 次）：只填名称 / 剂型 / 默认单位；规格只是可选建议（包装上常见的写法），不给剂量 ---------- */
  var PRESETS = [
    { g: 'baby', k: 'b-d3', n: '维生素D3', f: '滴剂', sp: ['400 IU'] },
    { g: 'baby', k: 'b-ad', n: '维生素AD', f: '滴剂', u: '粒', sp: ['A 1500 IU + D 500 IU', 'A 2000 IU + D 700 IU'] },
    { g: 'baby', k: 'b-dha', n: 'DHA', f: '滴剂', sp: ['100 mg'] },
    { g: 'baby', k: 'b-pro', n: '益生菌', f: '粉剂' },
    { g: 'baby', k: 'b-fe', n: '铁剂', f: '滴剂' },
    { g: 'baby', k: 'b-ca', n: '钙', f: '液体' },
    { g: 'baby', k: 'b-zn', n: '锌', f: '液体' },
    { g: 'baby', k: 'b-lf', n: '乳铁蛋白', f: '粉剂' },
    { g: 'mom', k: 'm-fa', n: '叶酸', f: '片剂', sp: ['0.4 mg'] },
    { g: 'mom', k: 'm-mv', n: '孕妇复合维生素', f: '片剂' },
    { g: 'mom', k: 'm-dha', n: 'DHA', f: '胶囊', sp: ['200 mg'] },
    { g: 'mom', k: 'm-ca', n: '钙', f: '片剂', sp: ['600 mg'] },
    { g: 'mom', k: 'm-fe', n: '铁', f: '片剂' },
    { g: 'mom', k: 'm-d', n: '维生素D', f: '胶囊', sp: ['400 IU'] }
  ];
  function presetOf(k) { for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].k === k) return PRESETS[i]; return null; }
  var GROUP_T = { baby: '宝宝', mom: '妈妈' };

  var FREQ = [{ v: 'daily', t: '每天' }, { v: 'weekly', t: '每周特定几天' }, { v: 'interval', t: '每隔几天' }];
  var WD = ['一', '二', '三', '四', '五', '六', '日'];
  var MEAL = [{ v: '', t: '不限' }, { v: 'empty', t: '空腹' }, { v: 'with', t: '随餐' }, { v: 'after', t: '餐后' }, { v: 'bed', t: '睡前' }];
  function mealT(v) { for (var i = 1; i < MEAL.length; i++) if (MEAL[i].v === v) return MEAL[i].t; return ''; }

  /* ---------- 剂型插画（自绘 SVG：柔和色块 + 高光，深浅色都能看） ---------- */
  var ART = {
    '胶囊': '<ellipse cx="60" cy="98" rx="30" ry="5" fill="#000" opacity=".12"/><g transform="rotate(-35 60 60)">'
      + '<path d="M40 44h20v32H40a16 16 0 0 1 0-32Z" fill="#EEE7DB" stroke="#5A4A3A" stroke-opacity=".22" stroke-width="1.5"/><path d="M60 44h20a16 16 0 0 1 0 32H60Z" fill="#C8642F"/>'
      + '<path d="M60 44v32" stroke="#000" stroke-opacity=".12" stroke-width="1.5"/>'
      + '<rect x="32" y="49" width="56" height="5" rx="2.5" fill="#fff" opacity=".55"/><path d="M40 72h40" stroke="#000" stroke-opacity=".08" stroke-width="4" stroke-linecap="round"/></g>',
    '片剂': '<ellipse cx="60" cy="90" rx="34" ry="6" fill="#000" opacity=".12"/><ellipse cx="60" cy="66" rx="34" ry="21" fill="#D6CDBF" stroke="#5A4A3A" stroke-opacity=".22" stroke-width="1.5"/>'
      + '<ellipse cx="60" cy="59" rx="34" ry="21" fill="#F2EDE4" stroke="#5A4A3A" stroke-opacity=".22" stroke-width="1.5"/><path d="M33 58c9-3 45-3 54 0" fill="none" stroke="#CFC5B5" stroke-width="2.2" stroke-linecap="round"/>'
      + '<ellipse cx="48" cy="51" rx="14" ry="5" fill="#fff" opacity=".7"/>',
    '软糖': '<ellipse cx="60" cy="102" rx="26" ry="5" fill="#000" opacity=".12"/><g fill="#F0A048">'
      + '<circle cx="45" cy="30" r="8"/><circle cx="75" cy="30" r="8"/><circle cx="60" cy="42" r="18"/><ellipse cx="60" cy="76" rx="21" ry="23"/>'
      + '<circle cx="39" cy="66" r="8"/><circle cx="81" cy="66" r="8"/><circle cx="45" cy="95" r="8.5"/><circle cx="75" cy="95" r="8.5"/></g>'
      + '<circle cx="53" cy="40" r="2" fill="#7A3B10" opacity=".55"/><circle cx="67" cy="40" r="2" fill="#7A3B10" opacity=".55"/>'
      + '<ellipse cx="52" cy="33" rx="7" ry="3.5" fill="#fff" opacity=".45"/><ellipse cx="51" cy="68" rx="6" ry="10" fill="#fff" opacity=".3"/>',
    '滴剂': '<ellipse cx="60" cy="104" rx="26" ry="5" fill="#000" opacity=".12"/>'
      + '<rect x="52" y="12" width="16" height="26" rx="8" fill="#EFEAE0" stroke="#5A4A3A" stroke-opacity=".22" stroke-width="1.5"/><rect x="47" y="34" width="26" height="15" rx="4" fill="#9FB39A"/>'
      + '<path d="M50 49h20v4c8 2 12 7 12 14v29a8 8 0 0 1-8 8H46a8 8 0 0 1-8-8V67c0-7 4-12 12-14Z" fill="#9A4E1E"/>'
      + '<rect x="44" y="64" width="6" height="32" rx="3" fill="#fff" opacity=".28"/><rect x="55" y="16" width="4" height="16" rx="2" fill="#fff" opacity=".7"/>'
      + '<path d="M47 40h26" stroke="#fff" stroke-opacity=".35" stroke-width="2"/>',
    '粉剂': '<ellipse cx="60" cy="104" rx="28" ry="5" fill="#000" opacity=".12"/><g transform="rotate(-10 60 60)">'
      + '<rect x="34" y="16" width="52" height="82" rx="4" fill="#EAE3D6" stroke="#5A4A3A" stroke-opacity=".22" stroke-width="1.5"/><rect x="34" y="16" width="52" height="9" rx="2" fill="#D6CDBE"/>'
      + '<path d="M34 25h52" stroke="#000" stroke-opacity=".08" stroke-dasharray="3 3" stroke-width="2"/>'
      + '<rect x="42" y="48" width="36" height="18" rx="2" fill="#C8642F"/><rect x="38" y="28" width="5" height="64" rx="2.5" fill="#fff" opacity=".55"/></g>',
    '液体': '<ellipse cx="60" cy="104" rx="26" ry="5" fill="#000" opacity=".12"/>'
      + '<path d="M36 34h48l-4 64a6 6 0 0 1-6 6H46a6 6 0 0 1-6-6Z" fill="#E9E4DA" opacity=".55"/>'
      + '<path d="M38.4 62h43.2l-2.2 36a6 6 0 0 1-6 6H46.6a6 6 0 0 1-6-6Z" fill="#C8642F" opacity=".82"/>'
      + '<path d="M36 34h48l-4 64a6 6 0 0 1-6 6H46a6 6 0 0 1-6-6Z" fill="none" stroke="#B8AE9F" stroke-width="2"/>'
      + '<path d="M66 46h10M68 58h8M66 70h10M68 82h8" stroke="#8C8273" stroke-width="2" stroke-linecap="round" opacity=".7"/>'
      + '<rect x="42" y="40" width="5" height="54" rx="2.5" fill="#fff" opacity=".5"/>',
    '其他': '<ellipse cx="60" cy="104" rx="26" ry="5" fill="#000" opacity=".12"/><g transform="rotate(8 60 60)">'
      + '<rect x="38" y="18" width="44" height="80" rx="4" fill="#D9D3C8" stroke="#5A4A3A" stroke-opacity=".22" stroke-width="1.5"/><rect x="38" y="18" width="44" height="12" rx="3" fill="#E9E4DB"/>'
      + '<rect x="42" y="34" width="5" height="58" rx="2.5" fill="#fff" opacity=".5"/></g>'
  };
  function art(form, cls) {
    return '<svg class="sp-art' + (cls ? ' ' + cls : '') + '" viewBox="0 0 120 120" aria-hidden="true" focusable="false">' + (ART[formKey(form)] || ART['其他']) + '</svg>';
  }

  /* ---------- 规范化（读取一律过这里，导入的坏值当没设） ---------- */
  var TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
  var DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  function remindAtOf(p) { var v = p && p.remindAt; return (typeof v === 'string' && TIME_RE.test(v)) ? v : null; }
  function perOf(p) { return (p && typeof p.perDay === 'number' && p.perDay > 0) ? Math.min(6, Math.floor(p.perDay)) : 1; }
  function numOk(n, lo, hi) { n = Number(n); return isFinite(n) && n >= lo && n <= hi ? n : null; }
  function fmtN(n) { return String(Math.round(n * 10) / 10); }
  function isV2(p) { return !!(p && Array.isArray(p.times) && p.times.some(function (x) { return x && TIME_RE.test(x.t); })); }
  function addHM(t, h) { var m = Math.min(23 * 60, Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) + h * 60); return p2(Math.floor(m / 60)) + ':' + p2(m % 60); }
  /** 计划的完整视图（不写回）。旧计划按 remindAt / 08:00 起每 4 小时排时间。 */
  function norm(p) {
    var f = formOf(p && p.form);
    var unit = (p && UNITS.indexOf(p.unit) >= 0) ? p.unit : f.u;
    var times = [];
    if (isV2(p)) {
      p.times.forEach(function (x) {
        if (!x || !TIME_RE.test(x.t) || times.some(function (y) { return y.t === x.t; })) return;
        times.push({ t: x.t, n: numOk(x.n, 0.5, 99) || 1 });
      });
      times = times.slice(0, 6);
    } else {
      var t0 = remindAtOf(p) || '08:00';
      for (var i = 0; i < perOf(p); i++) { var tt = addHM(t0, i * 4); if (!times.some(function (y) { return y.t === tt; })) times.push({ t: tt, n: 1 }); }
    }
    times.sort(function (a, b) { return a.t < b.t ? -1 : (a.t > b.t ? 1 : 0); });
    var freq = (p && (p.freq === 'weekly' || p.freq === 'interval')) ? p.freq : 'daily';
    var days = (p && Array.isArray(p.days) ? p.days : []).filter(function (x) { return x >= 1 && x <= 7 && Math.floor(x) === x; });
    days = days.filter(function (x, i) { return days.indexOf(x) === i; }).sort();
    if (freq === 'weekly' && !days.length) freq = 'daily';
    var stock = (p && p.stock && typeof p.stock === 'object' && typeof p.stock.id === 'string') ? { id: p.stock.id, n: Math.floor(numOk(p.stock.n, 1, 99) || 1) } : null;
    return {
      legacy: !isV2(p), form: f.k, unit: unit, times: times, freq: freq, days: days,
      every: Math.floor(numOk(p && p.every, 2, 30) || 2),
      start: (p && DAY_RE.test(p.start || '')) ? p.start : null,
      end: (p && DAY_RE.test(p.end || '')) ? p.end : null,
      spec: (p && typeof p.spec === 'string' && p.spec.trim()) ? p.spec.trim().slice(0, 24) : '',
      meal: (p && mealT(p.meal)) ? p.meal : '',
      stock: stock,
      note: (p && typeof p.note === 'string') ? p.note.slice(0, 200) : ''
    };
  }
  function dose(n, unit) { return fmtN(n) + ' ' + unit; }
  function freqText(p, v) {
    v = v || norm(p);
    if (v.freq === 'weekly') return '每周' + v.days.map(function (x) { return WD[x - 1]; }).join('、');
    if (v.freq === 'interval') return '每 ' + v.every + ' 天';
    return '每天';
  }
  function sortPlans(list) {
    return list.slice().sort(function (a, b) {
      return ((typeof a.sortOrder === 'number' ? a.sortOrder : 0) - (typeof b.sortOrder === 'number' ? b.sortOrder : 0));
    });
  }
  function activePlans(d) { return sortPlans((d.supplementPlans || []).filter(function (p) { return p && p.active !== false && p.name; })); }
  function wday(k) { var x = new Date(k + 'T12:00:00').getDay(); return x === 0 ? 7 : x; }
  /** 某照护日（yyyy-mm-dd）这个计划要不要吃 */
  function onDay(p, k, v) {
    if (!p || p.active === false) return false;
    v = v || norm(p);
    if (v.start && k < v.start) return false;
    if (v.end && k > v.end) return false;
    if (v.freq === 'weekly') return v.days.indexOf(wday(k)) >= 0;
    if (v.freq === 'interval') return v.start ? (Util.daysBetween(v.start, k) % v.every === 0) : true;
    return true;
  }
  function recsOn(d, k) {
    var DS = Util.dayStartHour(d);
    return (d.supplements || []).filter(function (r) { return r && Util.dayKeyOf(r.time, DS) === k; });
  }
  function mine(list, p) {
    return list.filter(function (r) { return (r.planId && p.id) ? r.planId === p.id : r.name === p.name; })
      .sort(function (a, b) { return String(a.time) < String(b.time) ? -1 : 1; });
  }
  /** 每个服用时间对应的那条记录（没吃 = null）：先认 slot，没 slot 的旧记录按先后填空位 */
  function slotsOf(v, list) {
    var out = v.times.map(function () { return null; }), rest = [];
    list.forEach(function (r) {
      var i = -1;
      if (typeof r.slot === 'string') v.times.forEach(function (x, j) { if (x.t === r.slot && !out[j] && i < 0) i = j; });
      if (i >= 0) out[i] = r; else rest.push(r);
    });
    rest.forEach(function (r) { for (var j = 0; j < out.length; j++) if (!out[j]) { out[j] = r; return; } });
    return out;
  }
  /** 某天要吃的：[{ p, v, need, done }]（首页磁贴 / 提醒 / 交接班 / 磁贴打卡共用） */
  function due(d, k) {
    var DS = Util.dayStartHour(d);
    k = k || Util.dayKeyOf(new Date(), DS);
    var list = recsOn(d, k);
    return activePlans(d).map(function (p) {
      var v = norm(p);
      if (!onDay(p, k, v)) return null;
      return { p: p, v: v, need: v.times.length, done: Math.min(v.times.length, mine(list, p).length) };
    }).filter(Boolean);
  }

  /* ---------- 本机提醒（每位照护者在自己的设备上开）：存在独立的 localStorage 键，不进备份 ---------- */
  var RKEY = 'yiya-sup-remind';
  function rmap() { try { var o = JSON.parse(localStorage.getItem(RKEY) || '{}'); return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {}; } catch (e) { return {}; } }
  function remindOn(p) {
    if (!p || !p.id) return false;
    var m = rmap();
    if (Object.prototype.hasOwnProperty.call(m, p.id)) return m[p.id] === 1;
    return !!remindAtOf(p); /* 旧计划：在本机设过提醒时刻 = 开 */
  }
  function setRemind(id, on) {
    var m = rmap(); m[id] = on ? 1 : 0;
    try { localStorage.setItem(RKEY, JSON.stringify(m)); } catch (e) { /* 存不下就当没开 */ }
  }

  /* ---------- 库存（接「用品」模块的 pieces） ---------- */
  function supplyOf(d, id) { return (d.supplies || []).filter(function (s) { return s && s.id === id; })[0] || null; }
  function countable(s) { return !!s && typeof s.pieces === 'number' && isFinite(s.pieces) && s.pieces >= 0; }
  function pcsU(s) { var S = Modules.supplies; return S && S._pcsUnit ? S._pcsUnit(s) : '个'; }
  function stockMove(d, st, sign) {
    if (!st || typeof st.id !== 'string') return;
    var s = supplyOf(d, st.id), n = Math.floor(numOk(st.n, 1, 99) || 0);
    if (!countable(s) || !n) return;
    s.pieces = Math.max(0, Math.min(99999, s.pieces - sign * n));
  }

  /* ---------- 记录服用 / 撤销 ---------- */
  function take(d, p, k, slotIdx, quiet, after) {
    var v = norm(p);
    var DS = Util.dayStartHour(d), today = Util.dayKeyOf(new Date(), DS);
    if (k > today) { Util.toast('还没到这一天，到时候再记', 'warn'); return null; }
    var sl = v.times[slotIdx] || v.times[0];
    var time = k === today ? Util.nowLocal() : (k + 'T' + sl.t + ':00');
    if (k !== today && DS && Number(sl.t.slice(0, 2)) < DS) time = Util.addDays(k, 1) + 'T' + sl.t + ':00';
    var rec = { id: Util.uid(), time: time, name: p.name, planId: p.id, dose: dose(sl.n, v.unit), qty: sl.n, unit: v.unit, slot: sl.t, note: null };
    var s = v.stock ? supplyOf(d, v.stock.id) : null;
    if (countable(s)) { rec.stock = { id: s.id, n: v.stock.n }; stockMove(d, rec.stock, 1); }
    d.supplements = d.supplements || [];
    d.supplements.push(rec);
    if (!Storage.save()) return null;
    if (Util.haptic) Util.haptic();
    if (!quiet) {
      var left = countable(s) ? '，' + s.name + ' 剩 ' + s.pieces + ' ' + pcsU(s) : '';
      Util.toast('已记录 ' + p.name + ' ' + rec.dose + left, 'ok', { label: '撤销', onClick: function () {
        var arr = Storage.get().supplements || [];
        for (var i = arr.length - 1; i >= 0; i--) if (arr[i].id === rec.id) { stockMove(Storage.get(), arr[i].stock, -1); arr.splice(i, 1); break; }
        Storage.save(); if (after) after(); else if (global.App) App.rerender();
      } });
    }
    return rec;
  }
  function untake(d, rec, after) {
    stockMove(d, rec.stock, -1);
    Util.removeWithUndo(d.supplements, rec.id, {
      onSave: function () { Storage.save(); },
      onUndo: function (it) { stockMove(d, it.stock, 1); },
      onAfter: function () { if (after) after(); else if (global.App) App.rerender(); },
      deletedText: '已撤销 ' + (rec.name || '营养品') + ' 的服用记录'
    });
  }

  /* ---------- 页面状态 ---------- */
  var selDay = null; /* 选中的日期（null = 今天） */
  function md(k) { return Number(k.slice(0, 4)) + '年' + Number(k.slice(5, 7)) + '月' + Number(k.slice(8, 10)) + '日'; }

  /* ============================================================
   * 6 步向导
   * ============================================================ */
  var STEPS = ['选择营养品', '填写规格', '安排服用日程', '服用日与方式', '提醒与库存', '确认营养品'];
  var CHEV_UD = '<svg class="spw-ud" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 9.5 12 5.5l4 4M8 14.5l4 4 4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var CHEV_R = '<svg class="spw-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var PLUS_C = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 8v8M8 12h8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  function sw(attr, on, label) {
    return '<button type="button" class="rs-switch" role="switch" ' + attr + ' aria-checked="' + !!on + '" aria-label="' + esc(label) + '"><i></i></button>';
  }
  function stepper(attr, label, minus) {
    return '<span class="sd-step spw-step"><button type="button" ' + attr + '="-1" aria-label="减少' + esc(label) + '"' + (minus ? '' : ' disabled') + '>−</button><i aria-hidden="true"></i>'
      + '<button type="button" ' + attr + '="1" aria-label="增加' + esc(label) + '">+</button></span>';
  }

  function openWizard(plan) {
    var F = global.FTUI; if (!F) return;
    var d = Storage.get(), editing = !!plan;
    var today = Util.dayKeyOf(new Date(), Util.dayStartHour(d));
    var v0 = editing ? norm(plan) : null;
    var st = editing ? {
      name: String(plan.name || '').slice(0, 16), preset: presetOf(plan.preset) ? plan.preset : '', form: v0.form, unit: v0.unit,
      specOn: !!v0.spec, spec: v0.spec, freq: v0.freq, days: v0.days.length ? v0.days.slice() : [wday(today)], every: v0.every,
      times: v0.times.map(function (x) { return { t: x.t, n: x.n }; }), start: v0.start || today, endOn: !!v0.end, end: v0.end || '',
      meal: v0.meal, remind: remindOn(plan), stockId: v0.stock ? v0.stock.id : '', stockN: v0.stock ? v0.stock.n : (v0.times[0] ? Math.max(1, Math.round(v0.times[0].n)) : 1),
      note: v0.note
    } : {
      name: '', preset: '', form: '胶囊', unit: '', specOn: false, spec: '', freq: 'daily', days: [wday(today)], every: 2,
      times: [{ t: '08:00', n: 1 }], start: today, endOn: false, end: '', meal: '', remind: false, stockId: '', stockN: 1, note: ''
    };
    var step = 0, view = 'step', q = '';
    var stage = (d.settings && d.settings.stage) === 'pregnancy' ? 'mom' : 'baby';

    F.openSheet('supplement', editing ? '编辑营养品' : '添加营养品', '<div class="spw-wrap" data-spw></div>', function (api) {
      var box = api.box, wrap = box.querySelector('[data-spw]');
      var panel = box.closest('.modal');
      if (panel) panel.classList.add('spw');
      var headH2 = box.querySelector('#ftsTitle');
      var okB = box.querySelector('.rs-head [data-ok]');
      /* 顶栏右边：向导里不用 ✓；「选择用品」子页放「添加用品」（参考图位置） */
      var hb = document.createElement('button');
      hb.type = 'button'; hb.className = 'spw-addsup'; hb.setAttribute('data-addsup', ''); hb.textContent = '添加用品';
      if (okB) okB.parentNode.replaceChild(hb, okB);
      /* 顶栏：✕ 标题 6 段进度（右边的 ✓ 在向导里不用） */
      var prog = document.createElement('div');
      prog.className = 'spw-prog'; prog.setAttribute('aria-hidden', 'true');
      prog.innerHTML = STEPS.map(function () { return '<i></i>'; }).join('');
      box.querySelector('.rs-head').appendChild(prog);

      function unitNow() { return st.unit || formOf(st.form).u; }
      function paint() {
        var h = '';
        if (view === 'pick') { h = pickHTML(); }
        else if (view === 'addsup') { h = addSupHTML(); }
        else h = stepHTML();
        wrap.innerHTML = h;
        box.classList.toggle('spw-sub', view !== 'step');
        if (headH2) headH2.textContent = view === 'pick' ? '选择用品' : (view === 'addsup' ? '添加用品' : (editing ? '编辑营养品' : '添加营养品'));
        hb.hidden = view !== 'pick';
        Array.prototype.forEach.call(prog.children, function (x, i) { x.classList.toggle('on', i <= step); });
        prog.hidden = view !== 'step';
        bindWhen();
        if (panel && panel.scrollTo) { try { panel.scrollTop = 0; } catch (e) { /* 旧内核 */ } }
      }
      function heroHTML() {
        return '<div class="spw-hero"><span class="spw-card">' + art(st.form || '胶囊') + '</span>'
          + '<h3>' + STEPS[step] + '</h3>' + (step > 0 && st.name ? '<p class="spw-nm">' + esc(st.name) + '</p>' : '')
          + '<p class="spw-of">第 ' + (step + 1) + ' 步，共 6 步</p></div>';
      }
      function stepHTML() {
        var h = heroHTML(), u = unitNow();
        if (step === 0) {
          h += '<label class="rs-lbl spw-lbl" for="spwName">名称</label>'
            + '<input type="text" class="sd-in" id="spwName" maxlength="16" placeholder="自定义名称" autocomplete="off" value="' + esc(st.name) + '">'
            + '<label class="rs-lbl spw-lbl" for="spwPreset">常用预设</label>'
            + '<label class="spw-sel"><select id="spwPreset" aria-label="常用预设"><option value="">常用预设</option>';
          (stage === 'mom' ? ['mom', 'baby'] : ['baby', 'mom']).forEach(function (g) {
            h += '<optgroup label="' + GROUP_T[g] + '">';
            PRESETS.forEach(function (x) { if (x.g === g) h += '<option value="' + x.k + '"' + (st.preset === x.k ? ' selected' : '') + '>' + esc(x.n) + ' · ' + x.f + '</option>'; });
            h += '</optgroup>';
          });
          h += '</select>' + CHEV_UD + '</label>'
            + '<p class="rs-lbl spw-lbl">剂型</p><div class="spw-forms" role="radiogroup" aria-label="剂型">'
            + FORMS.map(function (f) {
              var on = st.form === f.k;
              return '<button type="button" class="spw-form' + (on ? ' on' : '') + '" data-form="' + f.k + '" role="radio" aria-checked="' + on + '">'
                + art(f.k) + '<span>' + f.k + (on ? '<b class="spw-tick" aria-hidden="true">' + icon('check') + '</b>' : '') + '</span></button>';
            }).join('') + '</div>';
        } else if (step === 1) {
          var pr = presetOf(st.preset);
          h += '<div class="spw-row"><span>添加包装上的规格</span>' + sw('data-specsw', st.specOn, '添加包装上的规格') + '</div>'
            + '<p class="spw-hint">填写' + formOf(st.form).per.replace('每 ', '每') + '的含量，用于辨认营养品。规格不会改变每次用量。</p>';
          if (!st.specOn) h += '<p class="spw-big">未注明规格</p>';
          else {
            h += '<label class="rs-lbl spw-lbl" for="spwSpec">' + formOf(st.form).per + '含量</label>'
              + '<input type="text" class="sd-in" id="spwSpec" maxlength="24" placeholder="照包装写，例如 400 IU" autocomplete="off" value="' + esc(st.spec) + '">';
            if (pr && pr.sp && pr.sp.length) {
              h += '<p class="spw-hint">包装上常见的写法（只是参考，以你手上的为准）：</p><div class="rs-pills">'
                + pr.sp.map(function (s) { return '<button type="button" class="dp-pill' + (st.spec === s ? ' active' : '') + '" data-specq="' + esc(s) + '">' + esc(s) + '</button>'; }).join('') + '</div>';
            }
          }
        } else if (step === 2) {
          h += '<label class="spw-freq">' + '<select id="spwFreq" aria-label="服用频率">'
            + FREQ.map(function (f) { return '<option value="' + f.v + '"' + (st.freq === f.v ? ' selected' : '') + '>' + f.t + '</option>'; }).join('')
            + '</select><span aria-hidden="true">' + FREQ.filter(function (f) { return f.v === st.freq; })[0].t + '</span>' + CHEV_UD + '</label>'
            + '<p class="rs-lbl spw-lbl">时间与每次用量</p>';
          st.times.forEach(function (x, i) {
            h += '<div class="spw-slot"><div class="spw-row"><span>服用时间</span><span class="spw-r">'
              + (st.times.length > 1 ? '<button type="button" class="spw-rm" data-rmt="' + i + '" aria-label="删掉这个时间">' + icon('close') + '</button>' : '')
              + '<label class="spw-pill spw-date"><b>' + x.t + '</b><input type="time" data-t="' + i + '" value="' + x.t + '" aria-label="第 ' + (i + 1) + ' 个服用时间"></label></span></div>'
              + '<div class="spw-row"><span class="spw-dose">' + esc(dose(x.n, u)) + '</span>' + stepper('data-tn' + '="' + i + '" data-d', '用量', x.n > (u === 'ml' ? 0.5 : 1)) + '</div></div>';
          });
          if (st.times.length < 6) h += '<button type="button" class="spw-addt" data-addt>' + PLUS_C + '<span>添加时间</span></button>';
          h += '<div class="spw-row spw-sep"><span>开始日期</span><label class="spw-pill spw-date"><b>' + esc(md(st.start)) + '</b>'
            + '<input type="date" id="spwStart" value="' + st.start + '" aria-label="开始日期"></label></div>'
            + '<div class="spw-row spw-line"><span>设置结束日期</span>' + sw('data-endsw', st.endOn, '设置结束日期') + '</div>';
          if (st.endOn) h += '<div class="spw-row"><span>结束日期</span><label class="spw-pill spw-date"><b>' + esc(st.end ? md(st.end) : '选择日期') + '</b>'
            + '<input type="date" id="spwEnd" value="' + esc(st.end) + '" min="' + st.start + '" aria-label="结束日期"></label></div>';
        } else if (step === 3) {
          h += '<p class="rs-lbl spw-lbl">服用日</p>';
          if (st.freq === 'weekly') {
            h += '<div class="spw-wds" role="group" aria-label="每周哪几天">' + WD.map(function (w, i) {
              var on = st.days.indexOf(i + 1) >= 0;
              return '<button type="button" class="spw-wd' + (on ? ' on' : '') + '" data-wd="' + (i + 1) + '" aria-pressed="' + on + '">' + w + '</button>';
            }).join('') + '</div><p class="spw-hint">每周' + (st.days.length ? st.days.map(function (x) { return WD[x - 1]; }).join('、') : '（还没选）') + '服用。</p>';
          } else if (st.freq === 'interval') {
            h += '<div class="spw-row"><span class="spw-dose">每 ' + st.every + ' 天一次</span>' + stepper('data-ev', '间隔天数', st.every > 2) + '</div>'
              + '<p class="spw-hint">从开始日期（' + esc(md(st.start)) + '）算起。</p>';
          } else {
            h += '<div class="spw-row"><span>每天服用</span><b class="spw-v">' + st.times.length + ' 次</b></div>'
              + '<p class="spw-hint">要隔天吃或只在某几天吃，回上一步把频率改成「每周特定几天」或「每隔几天」。</p>';
          }
          h += '<p class="rs-lbl spw-lbl">服用方式 <span class="rs-lbl-n">可选</span></p><div class="rs-pills spw-meal" role="radiogroup" aria-label="服用方式">'
            + MEAL.map(function (m) { var on = st.meal === m.v; return '<button type="button" class="dp-pill' + (on ? ' active' : '') + '" data-meal="' + m.v + '" role="radio" aria-checked="' + on + '">' + m.t + '</button>'; }).join('')
            + '</div><p class="spw-hint">照说明书或医嘱选；会显示在服用日程卡上，提醒自己怎么吃。</p>';
        } else if (step === 4) {
          var s = st.stockId ? supplyOf(d, st.stockId) : null;
          h += '<p class="rs-lbl spw-lbl">本机提醒</p><div class="spw-row"><span>本机提醒</span>' + sw('data-remsw', st.remind, '本机提醒') + '</div>'
            + '<p class="spw-hint">每位照护者在自己的设备上开启提醒。到了服用时间还没记，会出现在本机首页的提醒里。</p>'
            + '<p class="rs-lbl spw-lbl">库存</p>'
            + '<button type="button" class="spw-link" data-pick><span class="spw-box" aria-hidden="true">' + icon('supplies') + '</span>'
            + '<span class="spw-lt"><b>' + (s ? esc(s.name) : '关联用品') + '</b>' + (s ? '<small>' + (countable(s) ? '剩 ' + s.pieces + ' ' + esc(pcsU(s)) : '没记剩余数量，不会扣减') + '</small>' : '') + '</span>' + CHEV_R + '</button>'
            + '<p class="spw-hint">关联库存，记录服用后按下面的数量扣减。</p>'
            + '<div class="spw-row spw-sep"><span class="spw-dose">默认用量：' + st.stockN + ' ' + esc(s && countable(s) ? pcsU(s) : u) + '</span>' + stepper('data-sn', '默认用量', st.stockN > 1) + '</div>'
            + '<p class="spw-hint">每记一次服用，从关联用品里扣这个数量；请确认用品的计数单位与用量一致。</p>';
        } else {
          var s2 = st.stockId ? supplyOf(d, st.stockId) : null;
          var kv = function (k, val) { return '<div class="spw-kv"><span>' + k + '</span><b>' + val + '</b></div>'; };
          h += '<div class="spw-sum">' + kv('名称', esc(st.name)) + kv('剂型', esc(st.form)) + kv('规格', st.specOn && st.spec.trim() ? esc(st.spec.trim()) : '未注明规格') + '</div>'
            + '<div class="spw-sum">' + kv('服用频率', esc(freqText(null, { freq: st.freq, days: st.days, every: st.every })) + ' · ' + st.times.length + ' 次')
            + st.times.map(function (x) { return kv(x.t, esc(dose(x.n, u))); }).join('') + (st.meal ? kv('服用方式', mealT(st.meal)) : '') + '</div>'
            + '<div class="spw-sum">' + kv('开始日期', esc(md(st.start))) + kv('结束日期', st.endOn && st.end ? esc(md(st.end)) : '不设结束日期') + '</div>'
            + '<div class="spw-sum">' + kv('本机提醒', st.remind ? '开启' : '关闭')
            + kv('库存', s2 ? esc(s2.name) + ' · 每次扣 ' + st.stockN + ' ' + esc(countable(s2) ? pcsU(s2) : u) : '不自动扣减') + '</div>'
            + '<textarea class="sd-in sd-ta spw-note" id="spwNote" maxlength="200" rows="3" placeholder="备注（选填）" aria-label="备注">' + esc(st.note) + '</textarea>';
        }
        h += '<div class="rs-savebar spw-bar"><button type="button" class="btn ft-save spw-next' + (step === 0 && !(st.name.trim() && st.form) ? ' is-dim' : '') + '" data-next>' + (step === 5 ? (editing ? '保存修改' : '保存营养品') : '下一步') + '</button>'
          + (step > 0 ? '<button type="button" class="btn spw-prev" data-prev>上一步</button>' : '') + '</div>';
        return h;
      }
      /* —— 选择用品（盖在第 5 步上的子页）—— */
      function supList() {
        var all = (d.supplies || []).filter(function (s) { return s && s.name; });
        var kw = q.trim().toLowerCase();
        if (kw) all = all.filter(function (s) { return String(s.name).toLowerCase().indexOf(kw) >= 0; });
        return all.sort(function (a, b) { return (a.cat === '维D/药品' ? 0 : 1) - (b.cat === '维D/药品' ? 0 : 1); });
      }
      function pickHTML() {
        var list = supList();
        var h = '';
        if (!list.length) h += '<p class="spw-empty">' + (q.trim() ? '没有找到「' + esc(q.trim()) + '」。' : '先添加一件营养品用品，再关联到记录。') + '</p>';
        else {
          h += '<ul class="spw-sups">';
          if (st.stockId) h += '<li><button type="button" class="spw-sup" data-unlink><span class="spw-lt"><b>不关联用品</b><small>记录服用时不扣库存</small></span></button></li>';
          list.forEach(function (s) {
            var on = s.id === st.stockId;
            h += '<li><button type="button" class="spw-sup' + (on ? ' on' : '') + '" data-sup="' + esc(s.id) + '" aria-pressed="' + on + '">'
              + '<span class="spw-lt"><b>' + esc(s.name) + '</b><small>' + esc(s.cat || '') + (countable(s) ? ' · 剩 ' + s.pieces + ' ' + esc(pcsU(s)) : ' · 没记剩余数量') + '</small></span>'
              + (on ? '<span class="spw-tick" aria-hidden="true">' + icon('check') + '</span>' : '') + '</button></li>';
          });
          h += '</ul>';
        }
        h += '<label class="spw-search">' + icon('search') + '<input type="search" id="spwQ" placeholder="搜索用品" aria-label="搜索用品" autocomplete="off" value="' + esc(q) + '"></label>';
        return h;
      }
      function addSupHTML() {
        var u = unitNow();
        return '<label class="rs-lbl spw-lbl" for="spwSupName">用品名称</label>'
          + '<input type="text" class="sd-in" id="spwSupName" maxlength="20" autocomplete="off" value="' + esc(st.name) + '" placeholder="例如 维生素D3 滴剂">'
          + '<label class="rs-lbl spw-lbl" for="spwSupN">现在还剩多少（' + esc(u) + '）</label>'
          + '<input type="number" class="sd-in" id="spwSupN" inputmode="numeric" min="0" max="99999" placeholder="例如 30">'
          + '<p class="spw-hint">会加到「用品」里（分类：维D/药品），以后在用品页也能改。</p>'
          + '<div class="rs-savebar spw-bar"><button type="button" class="btn ft-save spw-next" data-supsave>添加并关联</button></div>';
      }
      function bindWhen() {
        var nm = wrap.querySelector('#spwName');
        if (nm) nm.addEventListener('input', function () {
          st.name = nm.value.slice(0, 16);
          var nb = wrap.querySelector('[data-next]'); if (nb) nb.classList.toggle('is-dim', !(st.name.trim() && st.form));
        });
        var ps = wrap.querySelector('#spwPreset');
        if (ps) ps.addEventListener('change', function () {
          var x = presetOf(ps.value); st.preset = x ? x.k : '';
          if (x) {
            st.name = x.n; st.form = x.f; st.unit = x.u || '';
            if (st.spec && x.sp && x.sp.indexOf(st.spec) < 0) { st.spec = ''; st.specOn = false; }
            var dup = dupName(x.n);
            paint();
            if (dup) Util.toast('清单里已经有「' + x.n + '」了，可以改个名字区分', 'warn');
          }
        });
        var sp = wrap.querySelector('#spwSpec');
        if (sp) sp.addEventListener('input', function () {
          st.spec = sp.value.slice(0, 24);
          Array.prototype.forEach.call(wrap.querySelectorAll('[data-specq]'), function (b) { b.classList.toggle('active', b.getAttribute('data-specq') === st.spec.trim()); });
        });
        var fq = wrap.querySelector('#spwFreq');
        if (fq) fq.addEventListener('change', function () { st.freq = fq.value; if (st.freq === 'weekly' && !st.days.length) st.days = [wday(st.start)]; paint(); });
        Array.prototype.forEach.call(wrap.querySelectorAll('[data-t]'), function (inp) {
          inp.addEventListener('change', function () {
            var i = Number(inp.getAttribute('data-t')), v = (inp.value || '').slice(0, 5);
            if (!TIME_RE.test(v)) { inp.value = st.times[i].t; return; }
            if (st.times.some(function (x, j) { return j !== i && x.t === v; })) { Util.toast(v + ' 已经有了', 'warn'); inp.value = st.times[i].t; return; }
            st.times[i].t = v;
            var lb = inp.parentNode.querySelector('b'); if (lb) lb.textContent = v;
          });
        });
        var sd = wrap.querySelector('#spwStart');
        if (sd) sd.addEventListener('change', function () { if (DAY_RE.test(sd.value)) { st.start = sd.value; if (st.end && st.end < st.start) st.end = ''; } paint(); });
        var ed = wrap.querySelector('#spwEnd');
        if (ed) ed.addEventListener('change', function () { st.end = DAY_RE.test(ed.value) && ed.value >= st.start ? ed.value : ''; paint(); });
        var nt = wrap.querySelector('#spwNote');
        if (nt) nt.addEventListener('input', function () { st.note = nt.value.slice(0, 200); });
        var qi = wrap.querySelector('#spwQ');
        if (qi) qi.addEventListener('input', function () {
          q = qi.value.slice(0, 20);
          var pos = qi.selectionStart; paint();
          var n2 = wrap.querySelector('#spwQ'); if (n2) { n2.focus(); try { n2.setSelectionRange(pos, pos); } catch (e) { /* type=search 不支持时忽略 */ } }
        });
      }
      function dupName(nm) {
        nm = String(nm || '').trim();
        return (d.supplementPlans || []).some(function (p) { return p && p !== plan && p.active !== false && String(p.name).trim() === nm; });
      }
      function check() {
        if (step === 0) {
          st.name = (st.name || '').trim().slice(0, 16);
          if (!st.name) { var ni = wrap.querySelector('#spwName'); Util.markInvalid(ni, '填一下名称，或从常用预设里选'); return false; }
          if (dupName(st.name)) { Util.markInvalid(wrap.querySelector('#spwName'), '「' + st.name + '」已经在清单里了，换个名字区分'); return false; }
          if (!st.form) { Util.toast('选一下剂型', 'warn'); var g = wrap.querySelector('.spw-forms'); if (g) { g.classList.remove('shake'); void g.offsetWidth; g.classList.add('shake'); } return false; }
        }
        if (step === 2 && st.endOn && !st.end) { Util.toast('选一下结束日期，或关掉「设置结束日期」', 'warn'); return false; }
        if (step === 3 && st.freq === 'weekly' && !st.days.length) { Util.toast('至少选一天', 'warn'); return false; }
        return true;
      }
      function save() {
        var dd = Storage.get();
        var times = st.times.slice().sort(function (a, b) { return a.t < b.t ? -1 : 1; }).map(function (x) { return { t: x.t, n: x.n }; });
        var p = editing ? plan : { id: Util.uid(), active: true, sortOrder: (dd.supplementPlans || []).length };
        p.name = st.name; p.form = st.form; p.perDay = times.length; p.v = 2;
        if (st.preset) p.preset = st.preset; else delete p.preset;
        p.spec = st.specOn && st.spec.trim() ? st.spec.trim().slice(0, 24) : null;
        p.freq = st.freq;
        if (st.freq === 'weekly') p.days = st.days.slice().sort(); else delete p.days;
        if (st.freq === 'interval') p.every = st.every; else delete p.every;
        p.times = times; p.unit = unitNow(); p.start = st.start; p.end = st.endOn && st.end ? st.end : null;
        if (st.meal) p.meal = st.meal; else delete p.meal;
        p.stock = st.stockId && supplyOf(dd, st.stockId) ? { id: st.stockId, n: st.stockN } : null;
        p.note = (st.note || '').trim().slice(0, 200) || null;
        delete p.remindAt; /* 提醒改由「本机提醒」管 */
        if (!editing) { dd.supplementPlans = dd.supplementPlans || []; dd.supplementPlans.push(p); }
        if (!Storage.save()) return;
        setRemind(p.id, st.remind);
        api.close();
        if (!editing) selDay = null;
        if (global.App) App.rerender();
        Util.toast(editing ? '已保存修改' : '已添加营养品：' + p.name, 'ok');
      }

      box.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('button') : null;
        if (!b || !box.contains(b) || b.disabled) return;
        var v;
        if (b.hasAttribute('data-x') && view !== 'step') { e.stopImmediatePropagation(); view = view === 'addsup' ? 'pick' : 'step'; paint(); return; }
        if (b.hasAttribute('data-next')) { if (!check()) return; if (step === 5) { save(); return; } step++; paint(); return; }
        if (b.hasAttribute('data-prev')) { if (step > 0) { step--; paint(); } return; }
        if ((v = b.getAttribute('data-form'))) {
          if (st.form !== v) { st.form = v; var pr = presetOf(st.preset); st.unit = (pr && pr.f === v && pr.u) ? pr.u : ''; }
          var nm0 = wrap.querySelector('#spwName'); if (nm0) st.name = nm0.value.slice(0, 16);
          paint(); return;
        }
        if (b.hasAttribute('data-specsw')) { st.specOn = !st.specOn; paint(); var si = wrap.querySelector('#spwSpec'); if (si && st.specOn) try { si.focus(); } catch (e2) {} return; }
        if ((v = b.getAttribute('data-specq')) != null && v !== '') { st.spec = v; paint(); return; }
        if (b.hasAttribute('data-endsw')) { st.endOn = !st.endOn; if (!st.endOn) st.end = ''; paint(); return; }
        if (b.hasAttribute('data-remsw')) { st.remind = !st.remind; b.setAttribute('aria-checked', String(st.remind)); return; }
        if ((v = b.getAttribute('data-tn')) != null) {
          var x = st.times[Number(v)], stp = unitNow() === 'ml' ? 0.5 : 1;
          if (x) { x.n = Math.max(stp, Math.min(99, Math.round((x.n + Number(b.getAttribute('data-d')) * stp) * 10) / 10)); paint(); }
          return;
        }
        if ((v = b.getAttribute('data-rmt')) != null) { st.times.splice(Number(v), 1); paint(); return; }
        if (b.hasAttribute('data-addt')) {
          var last = st.times[st.times.length - 1], t = last ? addHM(last.t, 4) : '08:00';
          while (st.times.some(function (y) { return y.t === t; }) && t < '23:59') t = addHM(t, 1);
          if (st.times.some(function (y) { return y.t === t; })) { Util.toast('时间排满了，改一下已有的时间', 'warn'); return; }
          st.times.push({ t: t, n: last ? last.n : 1 }); paint(); return;
        }
        if ((v = b.getAttribute('data-wd'))) { var n = Number(v), at = st.days.indexOf(n); if (at >= 0) st.days.splice(at, 1); else st.days.push(n); st.days.sort(); paint(); return; }
        if ((v = b.getAttribute('data-ev'))) { st.every = Math.max(2, Math.min(30, st.every + Number(v))); paint(); return; }
        if ((v = b.getAttribute('data-meal')) != null) { st.meal = v; paint(); return; }
        if ((v = b.getAttribute('data-sn'))) { st.stockN = Math.max(1, Math.min(99, st.stockN + Number(v))); paint(); return; }
        if (b.hasAttribute('data-pick')) { view = 'pick'; q = ''; paint(); return; }
        if (b.hasAttribute('data-addsup')) { view = 'addsup'; paint(); var sn = wrap.querySelector('#spwSupN'); if (sn) try { sn.focus(); } catch (e3) {} return; }
        if (b.hasAttribute('data-supsave')) { addSup(); return; }
        if (b.hasAttribute('data-unlink')) { st.stockId = ''; view = 'step'; paint(); return; }
        if ((v = b.getAttribute('data-sup'))) {
          st.stockId = v; view = 'step';
          var s = supplyOf(d, v);
          paint();
          if (s && !countable(s)) Util.toast('这件用品没记剩余数量，扣减不会生效；可以在用品页补上', 'warn');
          return;
        }
      }, true);
      function addSup() {
        var ni = wrap.querySelector('#spwSupName'), qi = wrap.querySelector('#spwSupN');
        var nm = (ni.value || '').trim().slice(0, 20);
        if (!nm) { Util.markInvalid(ni, '填一下用品名称'); return; }
        var n = parseInt(qi.value, 10);
        if (!isFinite(n) || n < 0 || n > 99999) { Util.markInvalid(qi, '填 0–99999 的整数'); return; }
        var S = Modules.supplies, dd = Storage.get();
        dd.supplies = dd.supplies || [];
        var u = unitNow();
        var pk = u === 'ml' || u === '滴' ? '瓶' : (u === '包' ? '袋' : '盒');
        var res = S && S._upsert ? S._upsert(dd.supplies, { name: nm, cat: '维D/药品', unit: pk, qty: 1, pieces: n, date: Util.todayISO() }) : null;
        if (!res || res.error) { Util.toast((res && res.error) || '用品模块没加载，稍后再试', 'warn'); return; }
        res.item.pcsU = u;
        if (!Storage.save()) return;
        st.stockId = res.item.id; view = 'step'; q = '';
        paint();
        Util.toast(res.merged ? '已并入用品「' + nm + '」' : '已添加用品「' + nm + '」', 'ok');
      }
      /* ✕ 在子页里是返回第 5 步（上面捕获阶段已拦住）；Esc / 系统返回仍关掉整个向导 */
      paint();
    });
  }

  /* ============================================================
   * 提醒设置（清单卡点开）
   * ============================================================ */
  function openPlan(p) {
    var F = global.FTUI; if (!F) return;
    var d = Storage.get(), v = norm(p), on = remindOn(p);
    var body = '<div class="spr"><p class="spr-name">' + esc(p.name) + '</p><p class="spr-sub">' + esc(freqText(p, v)) + ' · ' + v.times.length + ' 次'
      + (v.times.length ? '（' + v.times.map(function (x) { return x.t; }).join('、') + '）' : '') + '</p>'
      + '<div class="spw-row"><span>本机提醒</span>' + sw('data-remsw2', on, '本机提醒') + '</div>'
      + '<p class="spw-hint">每位照护者在自己的设备上开启提醒。</p>'
      + (v.legacy ? '<p class="spw-hint">这是旧版的计划，点「编辑营养品」按新的方式排一下服用时间就好。</p>' : '')
      + '<div class="spr-acts"><button type="button" class="btn spr-b" data-edit>编辑营养品</button>'
      + '<button type="button" class="btn spr-b" data-toggle="' + esc(p.id) + '">' + (p.active === false ? '启用' : '停用') + '</button>'
      + '<button type="button" class="btn spr-b spr-del" data-delplan="' + esc(p.id) + '">删除</button></div></div>';
    F.openSheet('supplement', '提醒设置', body, function (api) {
      var box = api.box;
      box.closest('.modal').classList.add('spr-sheet');
      box.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('button') : null;
        if (!b || !box.contains(b)) return;
        if (b.hasAttribute('data-remsw2')) { on = !on; b.setAttribute('aria-checked', String(on)); return; }
        if (b.hasAttribute('data-ok')) {
          setRemind(p.id, on); api.close(); if (global.App) App.rerender();
          Util.toast(on ? '已开启本机提醒：' + p.name : '已关闭本机提醒：' + p.name, 'ok'); return;
        }
        if (b.hasAttribute('data-edit')) { api.close(); setTimeout(function () { openWizard(p); }, 0); return; }
        if (b.hasAttribute('data-toggle')) { api.close(); toggle(d, p); return; }
        if (b.hasAttribute('data-delplan')) { api.close(); delPlan(d, p.id); }
      });
    });
  }
  function toggle(d, tp, after) {
    /* 第 278 次（审计 #40）：重新启用时已有同名的启用中计划 → 不启用，提示 */
    if (tp.active === false && (d.supplementPlans || []).some(function (p) { return p !== tp && p.active !== false && String(p.name).trim() === String(tp.name).trim(); })) {
      Util.toast('「' + tp.name + '」已经有一条在用的计划，先停用或删掉那条再启用', 'warn');
      return;
    }
    tp.active = (tp.active === false);
    if (Storage.save()) Util.toast(tp.active ? '已启用：' + tp.name : '已停用：' + tp.name, 'ok');
    if (after) after(); else if (global.App) App.rerender();
  }
  function delPlan(d, id, after) {
    /* 历史记录保留（记录里存了 name 快照） */
    Util.removeWithUndo(d.supplementPlans, id, {
      onSave: function () { Storage.save(); },
      onAfter: function () { if (after) after(); else if (global.App) App.rerender(); },
      deletedText: '已删除营养品（服用记录保留）'
    });
  }

  /* ============================================================
   * 管理：全部营养品（含已停用）+ 最近服用记录
   * ============================================================ */
  function openManage() {
    var F = global.FTUI; if (!F) return;
    F.openSheet('supplement', '管理营养品', '<div data-mg></div>', function (api) {
      var box = api.box, mg = box.querySelector('[data-mg]');
      box.closest('.modal').classList.add('spm-sheet');
      function paint() {
        var d = Storage.get(), plans = sortPlans((d.supplementPlans || []).filter(function (p) { return p && p.name; }));
        var h = '<p class="rs-lbl spw-lbl">营养品</p>';
        if (!plans.length) h += '<p class="spw-empty">还没有营养品。</p>';
        else {
          h += '<ul class="spm-list">';
          plans.forEach(function (p) {
            var off = p.active === false, v = norm(p);
            h += '<li><span class="spm-ico">' + art(v.form) + '</span><span class="spw-lt"><b>' + esc(p.name) + '</b><small>' + (off ? '已停用' : esc(freqText(p, v)) + ' · ' + v.times.length + ' 次') + '</small></span>'
              + '<button type="button" class="spm-b" data-toggle="' + esc(p.id) + '">' + (off ? '启用' : '停用') + '</button>'
              + '<button type="button" class="spm-b spm-del" data-delplan="' + esc(p.id) + '" aria-label="删除 ' + esc(p.name) + '">' + icon('trash') + '</button></li>';
          });
          h += '</ul>';
        }
        var recs = (d.supplements || []).filter(function (r) { return r && isFinite(new Date(r.time).getTime()); })
          .sort(function (a, b) { return new Date(b.time) - new Date(a.time); }).slice(0, 30);
        h += '<p class="rs-lbl spw-lbl">最近服用记录</p>';
        if (!recs.length) h += '<p class="spw-empty">还没有服用记录。</p>';
        else {
          h += '<ul class="spm-list">';
          recs.forEach(function (r) {
            h += '<li><span class="spw-lt"><b>' + esc(r.name || '营养品') + (r.dose ? ' · ' + esc(r.dose) : '') + '</b><small>' + esc(Util.fmtDateTime ? Util.fmtDateTime(r.time) : r.time)
              + (r.note ? ' · ' + esc(r.note) : '') + '</small></span>'
              + '<button type="button" class="spm-b spm-del" data-delrec="' + esc(r.id) + '" aria-label="删除这条服用记录">' + icon('trash') + '</button></li>';
          });
          h += '</ul>';
        }
        h += '<p class="spw-hint">删掉营养品不会删它的服用记录。吃多少、吃多久，请按医嘱或说明书。</p>';
        mg.innerHTML = h;
      }
      box.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('button') : null;
        if (!b || !box.contains(b)) return;
        var d = Storage.get(), v, again = function () { if (box.isConnected) paint(); if (global.App) App.rerender(); };
        if (b.hasAttribute('data-ok')) { api.close(); return; }
        if ((v = b.getAttribute('data-toggle'))) { var tp = (d.supplementPlans || []).filter(function (p) { return p.id === v; })[0]; if (tp) toggle(d, tp, again); return; }
        if ((v = b.getAttribute('data-delplan'))) { delPlan(d, v, again); return; }
        if ((v = b.getAttribute('data-delrec'))) {
          var r = (d.supplements || []).filter(function (x) { return x.id === v; })[0];
          if (r) untake(d, r, again);
        }
      });
      paint();
    });
  }

  /* ============================================================
   * 页面
   * ============================================================ */
  Modules.supplement = {
    id: 'supplement',
    title: '营养品',
    _remindAtOf: remindAtOf,
    _remindOn: remindOn,
    _setRemind: setRemind,
    _norm: norm,
    _due: due,
    _onDay: onDay,
    _slots: function (p, list) { return slotsOf(norm(p), mine(list, p)); },
    _open: function () { openWizard(null); },
    _edit: function (p) { openWizard(p); },
    _manage: openManage,
    PRESETS: PRESETS, FORMS: FORMS,
    /* 第 196 次：首页磁贴就地打卡（契约同 diaper._quickHTML/_quickBind）。只列今天还没吃满的前 2 个；都吃满或没有返回空串 */
    _quickHTML: function (d) {
      return due(d).filter(function (x) { return x.done < x.need; }).slice(0, 2).map(function (x) {
        return '<button type="button" class="qk-btn qk-sup" data-qk-sup="' + esc(x.p.id) + '" aria-label="打卡 ' + esc(x.p.name) + '">'
          + icon('check') + '<span>' + esc(x.p.name) + '</span></button>';
      }).join('');
    },
    _quickBind: function (root, d, done) {
      Array.prototype.forEach.call(root.querySelectorAll('[data-qk-sup]'), function (b) {
        b.addEventListener('click', function (ev) {
          if (ev && ev.stopPropagation) ev.stopPropagation();
          var plan = (d.supplementPlans || []).filter(function (p) { return p.id === b.getAttribute('data-qk-sup'); })[0];
          if (!plan) return;
          var k = Util.dayKeyOf(new Date(), Util.dayStartHour(d));
          var sl = slotsOf(norm(plan), mine(recsOn(d, k), plan)), idx = sl.indexOf(null);
          if (take(d, plan, k, idx < 0 ? 0 : idx, false, done)) done();
        });
      });
    },
    render: function (view) {
      var d = Storage.get();
      var DS = Util.dayStartHour(d);
      var today = Util.dayKeyOf(new Date(), DS);
      if (global.App && App.pendingDate) { if (DAY_RE.test(App.pendingDate)) selDay = App.pendingDate; App.pendingDate = null; }
      var k = selDay && DAY_RE.test(selDay) ? selDay : today;
      var plans = activePlans(d);
      var html = '';

      /* 日期胶囊 + 今天 */
      html += '<div class="sp-datebar"><label class="sp-datepill"><b>' + esc(md(k)) + '</b><input type="date" id="spDay" value="' + k + '" aria-label="选择日期"></label>'
        + '<button type="button" class="sp-today" data-today>今天</button></div>';
      /* 一周日期条：从今天起 7 天；选到这之外的日期时从选中那天起 */
      var w0 = (k >= today && Util.daysBetween(today, k) < 7) ? today : k;
      html += '<div class="sp-week" role="group" aria-label="选择日期">';
      for (var i = 0; i < 7; i++) {
        var dk = Util.addDays(w0, i), on = dk === k, isT = dk === today;
        html += '<button type="button" class="sp-day' + (on ? ' on' : '') + (isT ? ' is-today' : '') + '" data-day="' + dk + '" aria-pressed="' + on + '" aria-label="' + esc(md(dk)) + (isT ? '，今天' : '') + '">'
          + '<small>' + (isT ? '今' : '周' + WD[wday(dk) - 1]) + '</small><b>' + Number(dk.slice(8, 10)) + '</b></button>';
      }
      html += '</div>';

      /* 服用日程 */
      var list = recsOn(d, k), items = [];
      plans.forEach(function (p) {
        var v = norm(p);
        if (!onDay(p, k, v)) return;
        var sl = slotsOf(v, mine(list, p));
        v.times.forEach(function (x, j) { items.push({ p: p, v: v, x: x, j: j, r: sl[j] }); });
      });
      items.sort(function (a, b) { return a.x.t < b.x.t ? -1 : (a.x.t > b.x.t ? 1 : 0); });
      html += '<section class="sp-sec"><p class="sp-h">服用日程</p>';
      if (!items.length) html += '<p class="sp-none">这一天没有安排服用日程。</p>';
      else {
        html += '<div class="sp-cards">';
        items.forEach(function (it) {
          var r = it.r, taken = !!r;
          var sub = dose(it.x.n, it.v.unit) + (it.v.meal ? ' · ' + mealT(it.v.meal) : '') + (taken ? ' · 已服用 ' + String(r.time).slice(11, 16) : '');
          html += '<button type="button" class="sp-card sp-dose' + (taken ? ' is-done' : '') + '" data-take="' + esc(it.p.id) + '" data-slot="' + it.j + '" aria-pressed="' + taken + '"'
            + ' aria-label="' + it.x.t + ' ' + esc(it.p.name) + ' ' + esc(dose(it.x.n, it.v.unit)) + (taken ? '，已服用，点按撤销' : '，点按记录服用') + '">'
            + '<span class="sp-ico">' + art(it.v.form) + '</span>'
            + '<span class="sp-txt"><b class="sp-t">' + it.x.t + '</b><b class="sp-n">' + esc(it.p.name) + '</b><small>' + esc(sub) + '</small></span>'
            + '<span class="sp-ck" aria-hidden="true">' + icon('check') + '</span></button>';
        });
        html += '</div>';
      }
      html += '</section>';

      /* 营养品清单 */
      html += '<section class="sp-sec"><div class="sp-hrow"><p class="sp-h">营养品清单</p><button type="button" class="sp-manage' + ((d.supplementPlans || []).length || (d.supplements || []).length ? '' : ' is-off') + '" data-manage>管理</button></div>';
      if (!plans.length) {
        html += '<div class="sk-empty sp-empty"><img src="assets/hero/supplement.webp" alt="" width="220" height="220" decoding="sync"><p>添加营养品，安排适合自己的服用日程。</p></div>';
      } else {
        html += '<div class="sp-cards">';
        plans.forEach(function (p) {
          var v = norm(p), ended = v.end && v.end < today;
          html += '<button type="button" class="sp-card sp-item" data-plan="' + esc(p.id) + '">'
            + '<span class="sp-ico">' + art(v.form) + '</span>'
            + '<span class="sp-txt"><b class="sp-n">' + esc(p.name) + '</b><small>' + esc(ended ? '已于 ' + md(v.end) + ' 结束' : freqText(p, v) + ' · ' + v.times.length + ' 次') + '</small></span>'
            + '<span class="sp-go" aria-hidden="true">' + CHEV_R + '</span></button>';
        });
        html += '</div>';
      }
      html += '</section>';
      html += '<div class="mod-cta"><button type="button" class="mc-main" data-spadd>' + icon('plus') + '<span>添加营养品</span></button></div>';
      if (plans.length) html += '<p class="hint sp-foot">吃多少、吃多久，按医嘱或说明书；这里只记「吃了没有」，不给剂量建议。短期用药请记在「吃药/维D」页。</p>';
      view.innerHTML = '<div class="ft-page sp-page" data-accent="supplement">' + html + '</div>';

      /* 绑定 */
      var dayIn = view.querySelector('#spDay');
      dayIn.addEventListener('change', function () { if (DAY_RE.test(dayIn.value)) { selDay = dayIn.value === today ? null : dayIn.value; App.rerender(); } });
      view.querySelector('[data-today]').addEventListener('click', function () { selDay = null; App.rerender(); });
      Array.prototype.forEach.call(view.querySelectorAll('[data-day]'), function (b) {
        b.addEventListener('click', function () { var x = b.getAttribute('data-day'); selDay = x === today ? null : x; App.rerender(); });
      });
      Array.prototype.forEach.call(view.querySelectorAll('[data-take]'), function (b) {
        b.addEventListener('click', function () {
          var p = (d.supplementPlans || []).filter(function (x) { return x.id === b.getAttribute('data-take'); })[0];
          if (!p) return;
          var j = Number(b.getAttribute('data-slot')) || 0;
          var r = slotsOf(norm(p), mine(recsOn(d, k), p))[j];
          if (r) untake(d, r); else if (take(d, p, k, j)) App.rerender();
        });
      });
      Array.prototype.forEach.call(view.querySelectorAll('[data-plan]'), function (b) {
        b.addEventListener('click', function () {
          var p = (d.supplementPlans || []).filter(function (x) { return x.id === b.getAttribute('data-plan'); })[0];
          if (p) openPlan(p);
        });
      });
      view.querySelector('[data-manage]').addEventListener('click', openManage);
      view.querySelector('[data-spadd]').addEventListener('click', function () { openWizard(null); });
    }
  };
})(window);
