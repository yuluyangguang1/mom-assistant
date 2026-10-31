/**
 * prenatal.js - 产检（第 298 次，对标 Cali「产检」）
 *
 * 页面：下一次产检提示（按孕周对照常规产检阶段）→ 摘要 → 产检记录时间轴（第 N 次 · 孕周 · 检查项 · 超声 / 估重 · 照片）
 *   → 早先的文字产检记录（旧 d.prenatal.records，只读 + 删除）→ 底部固定「＋ 产检记录」。
 * 记录面板：产检日期 → 孕周（按预产期自动算）→「第 N 次 · 孕 a–b 周 · 阶段名」+ 这次做了的检查项（点选）+ 一句提示
 *   → 超声测量 BPD / HC / AC / FL（mm，可选）→ 医生报告估重（g，可选）+ 估重参考 P10 / P50 / P90
 *   → 备注 → 产检报告图片（最多 6 张，只存本机）。
 * 估重参考：INTERGROWTH-21st 胎儿估重国际标准（Stirnemann 2017，22–40 周，按满周取值）；只列参考值，不判断偏大偏小。
 * 阶段与检查项按《孕前和孕期保健指南（2018）》常规产检时间整理，写明「以医院安排为准」。
 * 数据：d.prenatal.visits = [{ id, date, tags:[], bpd, hc, ac, fl, efw, note, photos:[] }]，孕周 / 第几次都按日期现算，不落库。
 */
(function (global) {
  'use strict';
  var Storage = global.Storage, Util = global.Util;
  var Modules = global.Modules = global.Modules || {};

  /* INTERGROWTH-21st EFW（g）：周 → [P10, P50, P90] */
  var EFW = {
    22: [481, 525, 578], 23: [538, 592, 658], 24: [602, 669, 751], 25: [674, 756, 858], 26: [757, 856, 980],
    27: [849, 969, 1119], 28: [951, 1097, 1276], 29: [1065, 1239, 1452], 30: [1190, 1396, 1647], 31: [1326, 1568, 1860],
    32: [1473, 1755, 2089], 33: [1630, 1954, 2332], 34: [1795, 2162, 2583], 35: [1967, 2378, 2838], 36: [2144, 2594, 3089],
    37: [2321, 2806, 3326], 38: [2495, 3006, 3541], 39: [2663, 3186, 3722], 40: [2818, 3338, 3858]
  };
  /* 常规产检阶段（按孕周，满周）：from–to 含两端 */
  var STAGES = [
    { from: 0, to: 13, range: '孕 6–13⁺⁶ 周', name: '建档与早期筛查', tags: ['建档', '血常规', '尿常规', '早孕超声', 'NT'], tip: 'NT 在 11–13⁺⁶ 周做，建档要带的证件和项目以医院通知为准。' },
    { from: 14, to: 19, range: '孕 14–19⁺⁶ 周', name: '唐筛 / 无创', tags: ['唐筛', '无创 DNA', '血常规', '尿常规'], tip: '唐筛一般在 15–20 周，无创 DNA 一般在 12–22⁺⁶ 周，选哪项听医生建议。' },
    { from: 20, to: 24, range: '孕 20–24 周', name: '大排畸', tags: ['大排畸', '尿常规', '血压'], tip: '系统超声（大排畸）一般在 20–24 周，很多医院要提前预约。' },
    { from: 25, to: 28, range: '孕 25–28 周', name: '糖耐量', tags: ['OGTT', '血常规', '尿常规'], tip: '做 OGTT 前一般要空腹 8 小时以上，具体要求以医院通知为准。' },
    { from: 29, to: 32, range: '孕 29–32 周', name: '生长评估', tags: ['超声', '血常规', '尿常规'], tip: '这段一般会复查超声看宝宝生长和胎位，以医生安排为准。' },
    { from: 33, to: 36, range: '孕 33–36 周', name: '分娩前评估', tags: ['尿常规', '胎监', 'GBS'], tip: '部分医院从 34–36 周开始胎监或 GBS 筛查，以医生安排为准。' },
    { from: 37, to: 45, range: '孕 37 周起', name: '每周产检', tags: ['胎监', '超声', '尿常规'], tip: '足月后一般每周一次产检；胎动明显减少、见红破水请及时就医。' }
  ];
  var COMMON = ['血压', '体重', '宫高腹围', '胎心'];
  var US = [
    { k: 'bpd', label: '双顶径 BPD', unit: 'mm', min: 10, max: 120 },
    { k: 'hc', label: '头围 HC', unit: 'mm', min: 50, max: 400 },
    { k: 'ac', label: '腹围 AC', unit: 'mm', min: 40, max: 450 },
    { k: 'fl', label: '股骨长 FL', unit: 'mm', min: 5, max: 90 }
  ];
  var EFW_LIM = { min: 100, max: 6000 };

  function esc(s) { return Util.escapeHtml(s == null ? '' : String(s)); }
  function num(v) { var n = Number(v); return v != null && v !== '' && isFinite(n) ? n : null; }
  function okDay(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T00:00:00').getTime()); }
  function g3(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function pn(d) { if (!d.prenatal || typeof d.prenatal !== 'object') d.prenatal = { checks: [], records: [] }; return d.prenatal; }
  function list(d) { var p = pn(d); if (!Array.isArray(p.visits)) p.visits = []; return p.visits; }
  function visits(d) {
    return list(d).filter(function (r) { return r && okDay(r.date); }).slice()
      .sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
  }
  function base(d) {
    var p = d.pregnancy || {};
    return p.lmp || (p.dueDate ? Util.addDays(p.dueDate, -280) : null);
  }
  /* 某天的孕周 {w, d}；没填预产期 / 不在孕期范围内为 null */
  function gaAt(d, day) {
    var b = base(d);
    if (!b || !okDay(day)) return null;
    var el = Util.daysBetween(b, day);
    if (el < 0 || el > 45 * 7) return null;
    return { w: Math.floor(el / 7), d: el % 7 };
  }
  function gaText(ga) { return ga ? ga.w + ' 周' + (ga.d ? ' ' + ga.d + ' 天' : '') : ''; }
  function stageOf(w) { for (var i = 0; i < STAGES.length; i++) if (w >= STAGES[i].from && w <= STAGES[i].to) return STAGES[i]; return null; }
  /* 第几次：同一天及以前的记录数（不含自己）+ 1 */
  function nthAt(d, day, selfId) {
    return list(d).filter(function (r) { return r && okDay(r.date) && r.id !== selfId && r.date <= day; }).length + 1;
  }
  function efwRef(ga) { return ga && EFW[ga.w] ? EFW[ga.w] : null; }
  function dayLab(day) {
    var t = Util.todayISO();
    if (day === t) return '今天';
    if (day === Util.addDays(t, -1)) return '昨天';
    var m = +day.slice(5, 7), dd = +day.slice(8, 10);
    return day.slice(0, 4) === t.slice(0, 4) ? m + '月' + dd + '日' : day.slice(0, 4) + '/' + m + '/' + dd;
  }
  function usLine(r) {
    var a = [];
    US.forEach(function (f) { if (num(r[f.k]) != null) a.push(f.label.split(' ')[1] + ' ' + num(r[f.k])); });
    return a.join(' · ');
  }

  /* ---------- 记录面板 ---------- */
  var openAt = 0;
  function openRec(d, rec) {
    var FT = global.FTUI, PH = global.Photos;
    if (!FT) return;
    if (Date.now() - openAt < 450) return;
    openAt = Date.now();
    var editing = !!rec, today = Util.todayISO();
    var st = {
      date: editing ? rec.date : today,
      tags: editing && Array.isArray(rec.tags) ? rec.tags.slice() : [],
      photos: editing && PH ? PH.clean(rec.photos) : []
    };
    /* 第 334 次审查：日期改成全站面板同一种日期磁贴（ft-tile，原来是唯一一个裸露的原生日期框） */
    var body = '<p class="rs-lbl">日期与孕周</p>'
      + '<div class="rs-when ft-when ml-when"><label class="rs-tile ft-tile"><span class="ft-ti">' + ((FT.SV && FT.SV.cal) || '') + '</span><span class="ft-tt"><small>产检日期</small>'
      + '<b data-show="pvDate"></b><input type="date" class="ft-hid" id="pvDate" max="' + today + '" value="' + esc(st.date) + '" aria-label="产检日期"></span></label></div>'
      + '<div class="pv-ga" id="pvGa"></div>'
      + '<div class="pv-stage" id="pvStage"></div>'
      + '<p class="rs-lbl">超声测量 <span class="rs-lbl-n">可选</span></p>';
    US.forEach(function (f) {
      body += '<label class="pv-in"><span><b>' + esc(f.label) + '</b><small>可选</small></span><span class="mw-inbox"><input type="text" inputmode="decimal" autocomplete="off" data-pvn="' + f.k + '" placeholder="—" value="' + esc(editing && num(rec[f.k]) != null ? num(rec[f.k]) : '') + '" aria-label="' + esc(f.label + '（' + f.unit + '）') + '"><i>' + f.unit + '</i></span></label>';
    });
    body += '<label class="pv-in"><span><b>医生报告估重</b><small>可选</small></span><span class="mw-inbox"><input type="text" inputmode="numeric" autocomplete="off" data-pvn="efw" placeholder="—" value="' + esc(editing && num(rec.efw) != null ? num(rec.efw) : '') + '" aria-label="医生报告估重（g）"><i>g</i></span></label>'
      + '<p class="pv-ref" id="pvRef"></p>'
      + '<p class="rs-lbl">备注</p><textarea id="pvNote" class="pv-note" rows="3" maxlength="200" placeholder="医生建议、下次复查事项，可选">' + esc(editing ? rec.note || '' : '') + '</textarea>'
      + (PH ? '<div id="pvPh"></div>' : '')
      + (editing ? '<button type="button" class="btn rs-del" data-pvdel>删除这条记录</button>' : '')
      + '<div class="rs-savebar"><button type="button" class="btn btn-primary rs-save" id="pvSave">' + '<span>' + (editing ? '保存修改' : '保存') + '</span></button></div>';

    FT.openSheet('prenatal', editing ? '修改产检记录' : '新增产检记录', body, function (api) {
      var box = api.box, closed = false, busy = false, saving = false;
      api.onClose = (function (prev) { return function () { closed = true; if (prev) prev.apply(this, arguments); }; })(api.onClose);
      var dateI = box.querySelector('#pvDate');
      if (FT.bindWhen) { FT.bindWhen(box); if (dateI._paint) dateI._paint(); }
      function paintTop() {
        var dd = Storage.get(), ga = gaAt(dd, st.date), stg = ga ? stageOf(ga.w) : null, n = nthAt(dd, st.date, editing ? rec.id : null);
        box.querySelector('#pvGa').innerHTML = '<p><small>孕周</small><b>' + (ga ? esc(gaText(ga)) : '—') + '</b></p><span>' + (ga ? '按预产期自动计算' : '填了预产期就能自动算') + '</span>';
        var tags = (stg ? stg.tags : []).concat(COMMON).concat(st.tags);
        var seen = {}, h = '<p class="pv-sh">第 ' + n + ' 次' + (stg ? ' · ' + esc(stg.range) + ' · ' + esc(stg.name) : '') + '</p><div class="rs-pills pv-tags" role="group" aria-label="这次做了的检查">';
        tags.forEach(function (t) {
          if (seen[t]) return; seen[t] = 1;
          var on = st.tags.indexOf(t) >= 0;
          h += '<button type="button" class="dp-pill' + (on ? ' active' : '') + '" data-pvtag="' + esc(t) + '" aria-pressed="' + on + '">' + esc(t) + '</button>';
        });
        h += '</div>' + (stg ? '<p class="rs-hint">' + esc(stg.tip) + '</p>' : '');
        box.querySelector('#pvStage').innerHTML = h;
        var ref = efwRef(ga), el = box.querySelector('#pvRef');
        el.textContent = ref ? '估重参考（孕 ' + ga.w + ' 周）：P10 ' + g3(ref[0]) + 'g · P50 ' + g3(ref[1]) + 'g · P90 ' + g3(ref[2]) + 'g（INTERGROWTH-21st）' : (ga && ga.w < 22 ? '估重参考从孕 22 周开始有。' : '');
        el.hidden = !el.textContent;
      }
      function paintPh() {
        var host = box.querySelector('#pvPh'); if (!host || !PH) return;
        var h = '<p class="rs-lbl">产检报告图片 <span class="rs-lbl-n">' + st.photos.length + '/' + PH.MAX + '</span></p>';
        if (st.photos.length) {
          h += '<div class="dp-phs">';
          st.photos.forEach(function (id) {
            h += '<span class="dp-ph"><button type="button" class="dp-ph-img" data-phview="' + id + '" aria-label="查看照片"><img data-phid="' + id + '" alt=""></button>'
              + '<button type="button" class="dp-ph-rm" data-phrm="' + id + '" aria-label="移除这张照片">' + icon('close') + '</button></span>';
          });
          h += '</div>';
        }
        if (st.photos.length < PH.MAX) h += '<div class="dp-ph-btns"><button type="button" class="btn dp-ph-add" data-phadd>' + icon('image') + '<span>添加照片</span></button>'
          + '<button type="button" class="btn dp-ph-add" data-phcam>' + icon('camera') + '<span>拍摄照片</span></button></div>';
        h += '<p class="rs-hint">可选。照片压缩后只存在这台手机上，不进备份文件。</p>';
        host.innerHTML = h;
        PH.hydrate(host);
      }
      paintTop(); paintPh();
      dateI.addEventListener('change', function () {
        if (okDay(dateI.value) && dateI.value <= Util.todayISO()) st.date = dateI.value;
        else { Util.toast(dateI.value > Util.todayISO() ? '这一天还没到，请检查一下' : '日期不完整', 'warn'); dateI.value = st.date; if (dateI._paint) dateI._paint(); }
        paintTop();
      });
      box.addEventListener('input', function (e) {
        var k = e.target && e.target.getAttribute && e.target.getAttribute('data-pvn');
        if (k) Util.markInvalid(e.target, null);
      });
      box.addEventListener('click', function (e) {
        if (closed || (Util.hapEcho && Util.hapEcho(e))) return;
        var b = e.target.closest ? e.target.closest('button') : null, v;
        if (!b || !box.contains(b)) return;
        if (b.id === 'pvSave' || b.hasAttribute('data-ok')) { save(); return; }
        if (b.hasAttribute('data-pvdel')) { closed = true; api.close(); remove(rec.id); return; }
        if ((v = b.getAttribute('data-pvtag'))) {
          var i = st.tags.indexOf(v); if (i >= 0) st.tags.splice(i, 1); else st.tags.push(v);
          b.classList.toggle('active', i < 0); b.setAttribute('aria-pressed', String(i < 0));
          return;
        }
        if ((v = b.getAttribute('data-phview'))) { if (PH) PH.view(v, st.photos); return; }
        if ((v = b.getAttribute('data-phrm'))) { st.photos = st.photos.filter(function (x) { return x !== v; }); paintPh(); if (PH.release) PH.release(v); return; }
        if (PH && (b.hasAttribute('data-phadd') || b.hasAttribute('data-phcam'))) {
          if (busy) return;
          PH.pick(b.hasAttribute('data-phcam'), function (files) {
            var room = PH.MAX - st.photos.length;
            if (files.length > room) Util.toast('最多 ' + PH.MAX + ' 张，只加了前 ' + room + ' 张', 'warn');
            busy = true;
            var chain = Promise.resolve();
            files.slice(0, room).forEach(function (f) {
              chain = chain.then(function () { return PH.compress(f); }).then(function (blob) { return PH.put(blob); })
                .then(function (id) { if (st.photos.length < PH.MAX) st.photos.push(id); });
            });
            chain.catch(function () { Util.toast('这张照片存不下来，换一张试试', 'warn'); })
              .then(function () { busy = false; if (box.isConnected) paintPh(); });
          });
        }
      });
      function save() {
        if (saving || closed) return;
        if (busy) { Util.toast('照片还在保存，稍等一下', 'warn'); return; }
        var vals = {}, bad = null;
        US.concat([{ k: 'efw', label: '估重', unit: 'g', min: EFW_LIM.min, max: EFW_LIM.max }]).forEach(function (f) {
          var inp = box.querySelector('[data-pvn="' + f.k + '"]'), t = String(inp.value).trim().replace(/[,，]/g, f.k === 'efw' ? '' : '.');
          if (t === '') { vals[f.k] = null; return; }
          var n = Number(t);
          if (!isFinite(n) || n < f.min || n > f.max) { Util.markInvalid(inp, f.label.split(' ')[0] + '填 ' + f.min + '–' + f.max + ' ' + f.unit); if (!bad) bad = inp; return; }
          vals[f.k] = f.k === 'efw' ? Math.round(n) : Math.round(n * 10) / 10;
        });
        if (bad) { try { bad.focus(); } catch (e) {} return; }
        if (!okDay(st.date) || st.date > Util.todayISO()) { Util.toast('日期不完整', 'warn'); return; }
        saving = true;
        var dd = Storage.get(), L = list(dd), r;
        if (editing) { r = L.filter(function (x) { return x && x.id === rec.id; })[0]; if (!r) { api.close(); return; } }
        else { r = { id: Util.uid() }; L.push(r); }
        r.date = st.date;
        if (st.tags.length) r.tags = st.tags.slice(0, 20).map(function (t) { return String(t).slice(0, 12); }); else delete r.tags;
        Object.keys(vals).forEach(function (k) { if (vals[k] != null) r[k] = vals[k]; else delete r[k]; });
        var note = String((box.querySelector('#pvNote') || {}).value || '').trim().slice(0, 200);
        if (note) r.note = note; else delete r.note;
        if (PH && st.photos.length) r.photos = st.photos.slice(); else delete r.photos;
        var id = r.id, n = nthAt(dd, r.date, id);
        if (Storage.save()) {
          if (editing) Util.toast('已保存修改', 'ok');
          else Util.toast('已记录第 ' + n + ' 次产检', 'ok', { label: '撤销', onClick: function () {
            var d3 = Storage.get(); pn(d3).visits = list(d3).filter(function (x) { return !x || x.id !== id; }); Storage.save(); global.App.rerender(); Util.toast('已撤销', 'ok');
          } });
        }
        closed = true; api.close(); global.App.rerender();
      }
    });
  }
  function remove(id) {
    var d = Storage.get();
    Util.removeWithUndo(list(d), id, { onSave: function () { Storage.save(); }, onAfter: function () { global.App.rerender(); }, deletedText: '已删除产检记录' });
  }

  /* ---------- 页面 ---------- */
  function pageHTML(d) {
    var SV = (global.FTUI && global.FTUI.SV) || {};
    var vs = visits(d), today = Util.todayISO(), ga = gaAt(d, today), stg = ga ? stageOf(ga.w) : null, h = '';
    if (stg) {
      h += '<div class="card pv-now"><p class="ms-k">这个阶段</p><p class="pv-now-t"><b>' + esc(stg.range) + ' · ' + esc(stg.name) + '</b><small>今天孕 ' + esc(gaText(ga)) + '</small></p>'
        + '<div class="pv-now-tags">' + stg.tags.map(function (t) { return '<span>' + esc(t) + '</span>'; }).join('') + '</div><p class="ms-ref">' + esc(stg.tip) + '</p></div>';
    }
    if (vs.length) {
      var last = vs[0], lga = gaAt(d, last.date);
      h += '<div class="mod-sum"><span class="ms-k">摘要</span><p>已记录 <b>' + vs.length + ' 次</b>产检，最近一次在 <b>' + esc(dayLab(last.date)) + '</b>' + (lga ? '（孕 ' + esc(gaText(lga)) + '）' : '') + '。</p></div>';
      h += '<section class="mod-tl ft-tl"><p class="ms-k">产检记录</p><ul class="tl pv-tl">';
      var asc = vs.slice().reverse(), nth = {};
      asc.forEach(function (r, i) { nth[r.id] = i + 1; });
      vs.forEach(function (r) {
        var g = gaAt(d, r.date), us = usLine(r), ph = global.Photos ? global.Photos.clean(r.photos) : [];
        var sub = [g ? '孕 ' + gaText(g) : '', (r.tags || []).slice(0, 4).join(' ')].filter(Boolean).join(' · ');
        var t = '第 ' + nth[r.id] + ' 次产检';
        h += '<li class="tl-row"><span class="tl-time ft-tlt"><small>' + esc(dayLab(r.date)) + '</small></span><span class="tl-dot" aria-hidden="true"></span>'
          + '<button type="button" class="tl-card" data-pvopen="' + esc(r.id) + '" aria-label="' + esc(dayLab(r.date) + ' ' + t + '，点按修改') + '">'
          + '<span class="tl-ico">' + icon('prenatal') + '</span><span class="tl-txt"><b>' + esc(t) + '</b>' + (sub ? '<small>' + esc(sub) + '</small>' : '')
          + (us || num(r.efw) != null ? '<small class="pv-us">' + esc([us, num(r.efw) != null ? '估重 ' + g3(num(r.efw)) + 'g' : ''].filter(Boolean).join(' · ')) + '</small>' : '')
          + (r.note ? '<small class="pv-nt">' + esc(r.note) + '</small>' : '')
          + (ph.length ? '<span class="pv-phs">' + ph.slice(0, 3).map(function (id) { return '<img data-phid="' + id + '" alt="">'; }).join('') + (ph.length > 3 ? '<i>+' + (ph.length - 3) + '</i>' : '') + '</span>' : '')
          + '</span><span class="tl-more" aria-hidden="true">' + (SV.more || '') + '</span></button>'
          + '<button type="button" class="tl-del" data-del="' + esc(r.id) + '" aria-label="删除" title="删除">' + icon('trash') + '</button></li>';
      });
      h += '</ul></section>';
    } else {
      h += '<div class="sk-empty pv-empty"><img src="assets/hero/prenatal.webp" alt="" width="200" height="200" decoding="sync"><p>点按底部「产检记录」，记下第一次产检</p></div>';
    }
    var old = (pn(d).records || []).filter(function (r) { return r && r.item; });
    if (old.length) {
      h += '<div class="card pv-old"><p class="ms-k">早先的文字记录</p><ul class="list">';
      old.slice().sort(function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')); }).forEach(function (r) {
        h += '<li><span><b>' + esc(r.item) + '</b> ' + esc(r.value || '') + (okDay(r.date) ? '<br><small>' + esc(Util.fmtDate(r.date)) + '</small>' : '') + '</span>'
          + '<button type="button" class="icon-btn" data-pvold="' + esc(r.id) + '" aria-label="删除" title="删除">' + icon('trash') + '</button></li>';
      });
      h += '</ul></div>';
    }
    h += '<p class="hint med-note">产检时间和项目各医院不同，以医生安排为准；估重参考只是对照数值，不用于判断。</p>';
    h += '<div class="mod-cta ft-cta"><button type="button" class="mc-main" id="pvAdd">' + (SV.plusc || icon('plus')) + '<span>产检记录</span></button></div>';
    return h;
  }

  Modules.prenatal = {
    id: 'prenatal',
    title: '产检',
    render: function (view) {
      var d = Storage.get();
      view.innerHTML = '<div class="ft-page skel-page pv-page" data-accent="prenatal">' + pageHTML(d) + '</div>';
      var page = view.firstChild, lock = 0;
      if (global.Photos) global.Photos.hydrate(page);
      page.addEventListener('click', function (e) {
        if (Util.hapEcho && Util.hapEcho(e)) return;
        var b = e.target.closest ? e.target.closest('button') : null, v;
        if (!b || !page.contains(b)) return;
        var dd = Storage.get();
        if (b.id === 'pvAdd') { openRec(dd, null); return; }
        if ((v = b.getAttribute('data-pvopen'))) { var r = list(dd).filter(function (x) { return x && String(x.id) === v; })[0]; if (r) openRec(dd, r); return; }
        if ((v = b.getAttribute('data-del'))) { if (e.isTrusted && Date.now() - lock < 500) return; lock = Date.now(); remove(v); return; }
        if ((v = b.getAttribute('data-pvold'))) {
          Util.removeWithUndo(pn(dd).records, v, { onSave: function () { Storage.save(); }, onAfter: function () { global.App.rerender(); }, deletedText: '已删除产检记录' });
        }
      });
    },
    _edit: function (rec) { if (rec) openRec(Storage.get(), rec); },
    _remove: remove,
    _gaAt: gaAt,
    _stageOf: stageOf,
    _efw: EFW,
    _nth: nthAt
  };
})(window);
