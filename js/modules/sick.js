/**
 * sick.js - 生病记录（第 301 次新增）
 *
 * 用户口径：只做记录——不提醒、不做任何判断 / 诊断 / 用药建议。记下这次生病的经过，方便日后翻看或拿给医生看。
 * 页面：摘要（共记 N 次 · 今年花费）→ 时间轴（症状、起止日期与天数、原因、用药、就医与花费、备注、照片；点按修改，删除可撤销）
 *   → 底部固定「＋ 记一次生病」。
 * 记录面板：开始日期 + 还没好 / 已好转（好转日期）→ 症状（常见点选，可多选 + 自己写）→ 原因（同上）
 *   → 用药（快选只来自自己以前记过的药名，不预置任何药）→ 就医（没去医院 / 门诊 / 急诊 / 住院 + 医院名）→ 花费 → 备注 → 照片（病历、处方，最多 6 张，只存本机）。
 * 数据：d.sicks = [{ id, start, end|null, symptoms[], causes[], meds[], visit|null, place|null, cost|null, note|null, photos? }]，
 *   属于当前宝宝（storage.js BABY_KEYS）。
 */
(function (global) {
  'use strict';
  var Storage = global.Storage, Util = global.Util;
  var Modules = global.Modules = global.Modules || {};

  /* 常见项只是帮着少打字的说法，选不选、选几个都由家长决定 */
  var SYMPTOMS = ['发烧', '咳嗽', '流鼻涕', '鼻塞', '嗓子哑', '腹泻', '呕吐', '便秘', '起疹子', '湿疹', '眼屎多', '没精神'];
  var CAUSES = ['着凉', '换季', '被传染', '吃坏东西', '打疫苗后', '出牙', '不清楚'];
  var VISITS = [['home', '没去医院'], ['clinic', '门诊'], ['er', '急诊'], ['hospital', '住院']];
  var VISIT_TXT = { home: '没去医院', clinic: '门诊', er: '急诊', hospital: '住院' };
  var MAX_TAGS = 12, MAX_MEDS = 10;

  function esc(s) { return Util.escapeHtml(s == null ? '' : String(s)); }
  function okDay(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T00:00:00').getTime()); }
  function list(d) { if (!Array.isArray(d.sicks)) d.sicks = []; return d.sicks; }
  function strs(a, max, len) {
    var out = [];
    (Array.isArray(a) ? a : []).forEach(function (x) {
      var s = typeof x === 'string' ? x.trim().slice(0, len) : '';
      if (s && out.indexOf(s) < 0 && out.length < max) out.push(s);
    });
    return out;
  }
  function okCost(v) { return typeof v === 'number' && isFinite(v) && v >= 0 && v < 1e6; }
  function sorted(d) {
    return list(d).filter(function (r) { return r && okDay(r.start); }).slice()
      .sort(function (a, b) { return a.start < b.start ? 1 : a.start > b.start ? -1 : 0; });
  }
  function dayLab(day) {
    var t = Util.todayISO();
    if (day === t) return '今天';
    if (day === Util.addDays(t, -1)) return '昨天';
    var m = +day.slice(5, 7), dd = +day.slice(8, 10);
    return day.slice(0, 4) === t.slice(0, 4) ? m + '月' + dd + '日' : day.slice(0, 4) + '/' + m + '/' + dd;
  }
  function titleOf(r) { var s = strs(r.symptoms, MAX_TAGS, 12); return s.length ? s.join('、') : '生病'; }
  /* 起止：「10月20日–10月23日 · 4 天」；没写好转日期就只写从哪天起，不推断 */
  function spanOf(r) {
    if (okDay(r.end) && r.end >= r.start) {
      var n = Util.daysBetween(r.start, r.end) + 1;
      return (r.end === r.start ? dayLab(r.start) : dayLab(r.start) + '–' + dayLab(r.end)) + ' · ' + n + ' 天';
    }
    return dayLab(r.start) + ' 起 · 还没好';
  }
  function money(v) { return '¥' + (Math.round(v * 100) / 100).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1'); }
  function facts(r) {
    var a = [];
    var c = strs(r.causes, MAX_TAGS, 12); if (c.length) a.push('原因：' + c.join('、'));
    var m = strs(r.meds, MAX_MEDS, 30); if (m.length) a.push('用药：' + m.join('、'));
    var v = [];
    if (VISIT_TXT[r.visit]) v.push(VISIT_TXT[r.visit] + (r.place && r.visit !== 'home' ? ' · ' + String(r.place).slice(0, 30) : ''));
    if (okCost(r.cost)) v.push('花费 ' + money(r.cost));
    if (v.length) a.push(v.join(' · '));
    return a;
  }
  /* 用药快选：只取家长自己记过的药名（生病记录 + 吃药页），按最近使用排序，不预置任何药 */
  function medHistory(d, skipId) {
    var seen = {}, out = [];
    sorted(d).forEach(function (r) {
      if (r.id === skipId) return;
      strs(r.meds, MAX_MEDS, 30).forEach(function (m) { if (!seen[m]) { seen[m] = 1; out.push(m); } });
    });
    (d.meds || []).slice().sort(function (a, b) { return new Date(b && b.time) - new Date(a && a.time); }).forEach(function (r) {
      var n = r && typeof r.name === 'string' ? r.name.trim().slice(0, 30) : '';
      if (n && !seen[n]) { seen[n] = 1; out.push(n); }
    });
    return out.slice(0, 8);
  }

  /* ---------- 记一次生病 / 修改 ---------- */
  var openAt = 0;
  function openRec(rec) {
    var FT = global.FTUI, PH = global.Photos;
    if (!FT || Date.now() - openAt < 450) return;
    openAt = Date.now();
    var d = Storage.get(), editing = !!rec, today = Util.todayISO(), SV = FT.SV || {};
    var st = {
      symptoms: editing ? strs(rec.symptoms, MAX_TAGS, 12) : [],
      causes: editing ? strs(rec.causes, MAX_TAGS, 12) : [],
      meds: editing ? strs(rec.meds, MAX_MEDS, 30) : [],
      visit: editing && VISIT_TXT[rec.visit] ? rec.visit : '',
      ended: editing ? okDay(rec.end) : false,
      photos: editing && PH ? PH.clean(rec.photos) : []
    };
    var s0 = editing ? rec.start : today, e0 = editing && okDay(rec.end) ? rec.end : today;
    function pills(kind, presets, chosen) {
      var all = presets.slice();
      chosen.forEach(function (x) { if (all.indexOf(x) < 0) all.push(x); });
      return all.map(function (it) {
        var on = chosen.indexOf(it) >= 0;
        return '<button type="button" class="dp-pill' + (on ? ' active' : '') + '" data-sk="' + kind + '" data-v="' + esc(it) + '" aria-pressed="' + on + '">' + esc(it) + '</button>';
      }).join('');
    }
    function tile(id, lab, val, min) {
      return '<label class="rs-tile ft-tile"><span class="ft-ti">' + (SV.cal || '') + '</span><span class="ft-tt"><small>' + lab + '</small>'
        + '<b data-show="' + id + '"></b><input type="date" class="ft-hid" id="' + id + '" value="' + esc(val) + '" max="' + today + '"' + (min ? ' min="' + esc(min) + '"' : '') + ' aria-label="' + lab + '"></span></label>';
    }
    var body = '<p class="rs-lbl">日期</p><div class="rs-when ft-when sk2-when">' + tile('skStart', '开始', s0)
      + '<div class="sk2-endbox"><div class="rs-seg sk-seg sk-n2 sk2-end" role="tablist">'
      + '<button type="button" class="' + (st.ended ? '' : 'on') + '" data-skend="0" role="tab" aria-selected="' + !st.ended + '">还没好</button>'
      + '<button type="button" class="' + (st.ended ? 'on' : '') + '" data-skend="1" role="tab" aria-selected="' + st.ended + '">已好转</button></div>'
      + '<div data-skendtile' + (st.ended ? '' : ' hidden') + '>' + tile('skEnd', '好转', e0, s0) + '</div></div></div>'
      + '<p class="rs-lbl">症状 <span class="rs-lbl-n">可多选</span></p><div class="rs-pills sk2-picks" data-skbox="symptoms">' + pills('symptoms', SYMPTOMS, st.symptoms) + '</div>'
      + '<div class="sk2-add"><input type="text" id="skSymIn" maxlength="12" placeholder="其他症状，自己写" aria-label="其他症状"><button type="button" class="btn sk2-addb" data-skadd="symptoms">添加</button></div>'
      + '<p class="rs-lbl">原因 <span class="rs-lbl-n">可多选，可不填</span></p><div class="rs-pills sk2-picks" data-skbox="causes">' + pills('causes', CAUSES, st.causes) + '</div>'
      + '<div class="sk2-add"><input type="text" id="skCauseIn" maxlength="12" placeholder="其他原因，自己写" aria-label="其他原因"><button type="button" class="btn sk2-addb" data-skadd="causes">添加</button></div>'
      + '<p class="rs-lbl">用药 <span class="rs-lbl-n">按实际记，可不填</span></p><div id="skMeds"></div>'
      + '<div class="sk2-add"><input type="text" id="skMedIn" maxlength="30" placeholder="药名和用法，如 退烧药 2ml" aria-label="药名"><button type="button" class="btn sk2-addb" data-skadd="meds">添加</button></div>'
      + '<p class="rs-lbl">就医</p><div class="rs-seg sk-seg sk-n4 sk2-visit" role="tablist">'
      + VISITS.map(function (v) { var on = st.visit === v[0]; return '<button type="button" class="' + (on ? 'on' : '') + '" data-skvisit="' + v[0] + '" role="tab" aria-selected="' + on + '">' + v[1] + '</button>'; }).join('')
      + '</div><label class="rs-note" data-skplace' + (st.visit && st.visit !== 'home' ? '' : ' hidden') + '><span class="rs-lbl">医院 / 诊所</span><input type="text" id="skPlace" maxlength="30" placeholder="可选" value="' + esc(editing && rec.place ? rec.place : '') + '"></label>'
      + '<label class="rs-note sk2-cost"><span class="rs-lbl">花费</span><span class="sk2-yuan"><i aria-hidden="true">¥</i><input type="text" inputmode="decimal" id="skCost" maxlength="9" placeholder="可选，挂号、药费等合计" value="' + (editing && okCost(rec.cost) ? esc(String(rec.cost)) : '') + '"></span></label>'
      + '<label class="rs-note"><span class="rs-lbl">备注</span><input type="text" id="skNote" maxlength="80" placeholder="医生怎么说、怎么护理的，可选" value="' + esc(editing ? rec.note || '' : '') + '"></label>'
      + (PH ? '<div id="skPh"></div>' : '')
      + '<p class="rs-hint sk2-foot">这里只做记录，不提醒，也不做任何判断或用药建议。</p>'
      + (editing ? '<button type="button" class="btn rs-del" data-skdel>删除这条记录</button>' : '')
      + '<div class="rs-savebar"><button type="button" class="btn btn-primary rs-save" id="skSave">' + icon('check') + '<span>' + (editing ? '保存修改' : '保存') + '</span></button></div>';

    FT.openSheet('sick', editing ? '修改生病记录' : '记一次生病', body, function (api) {
      var box = api.box, closed = false, busy = false, saving = false;
      api.onClose = function () { closed = true; };
      var si = box.querySelector('#skStart'), ei = box.querySelector('#skEnd');
      [si, ei].forEach(function (x) { if (x && x._paint) x._paint(); });
      si.addEventListener('change', function () {
        if (!okDay(si.value) || si.value > Util.todayISO()) { Util.toast('请选择不晚于今天的日期', 'warn'); si.value = s0; if (si._paint) si._paint(); }
        ei.min = si.value;
        if (ei.value < si.value) { ei.value = si.value; if (ei._paint) ei._paint(); }
      });
      ei.addEventListener('change', function () {
        if (!okDay(ei.value) || ei.value > Util.todayISO() || ei.value < si.value) { Util.toast('好转日期要在开始日期和今天之间', 'warn'); ei.value = si.value > e0 ? si.value : e0; if (ei._paint) ei._paint(); }
      });
      function paintMeds() {
        var host = box.querySelector('#skMeds'), h = '';
        if (st.meds.length) {
          h += '<div class="rs-pills sk2-meds">';
          st.meds.forEach(function (m) {
            h += '<span class="dp-pill active sk2-med"><span>' + esc(m) + '</span><button type="button" data-skmedrm="' + esc(m) + '" aria-label="' + esc('移除 ' + m) + '">' + icon('close') + '</button></span>';
          });
          h += '</div>';
        }
        var hist = medHistory(Storage.get(), editing ? rec.id : null).filter(function (m) { return st.meds.indexOf(m) < 0; });
        if (hist.length && st.meds.length < MAX_MEDS) {
          h += '<p class="sk2-hist">记过的药</p><div class="rs-pills sk2-histp">' + hist.map(function (m) {
            return '<button type="button" class="dp-pill" data-skmed="' + esc(m) + '">' + icon('plus') + esc(m) + '</button>';
          }).join('') + '</div>';
        }
        host.innerHTML = h;
      }
      paintMeds();
      function repaintPills(kind) {
        var host = box.querySelector('[data-skbox="' + kind + '"]');
        if (host) host.innerHTML = pills(kind, kind === 'symptoms' ? SYMPTOMS : CAUSES, st[kind]);
      }
      function addFrom(kind) {
        var inp = box.querySelector(kind === 'symptoms' ? '#skSymIn' : kind === 'causes' ? '#skCauseIn' : '#skMedIn');
        var v = String(inp.value || '').trim().slice(0, kind === 'meds' ? 30 : 12);
        if (!v) { Util.markInvalid(inp, kind === 'meds' ? '写一下药名' : '先写一下'); return; }
        var cap = kind === 'meds' ? MAX_MEDS : MAX_TAGS;
        if (st[kind].indexOf(v) < 0) {
          if (st[kind].length >= cap) { Util.toast('最多 ' + cap + ' 个', 'warn'); return; }
          st[kind].push(v);
        }
        inp.value = '';
        if (kind === 'meds') paintMeds(); else repaintPills(kind);
      }
      Array.prototype.forEach.call(box.querySelectorAll('.sk2-add input'), function (inp) {
        inp.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); var b = inp.parentNode.querySelector('[data-skadd]'); if (b) addFrom(b.getAttribute('data-skadd')); }
        });
      });
      function paintPh() {
        var host = box.querySelector('#skPh'); if (!host || !PH) return;
        var h = '<p class="rs-lbl">照片 <span class="rs-lbl-n">' + st.photos.length + '/' + PH.MAX + '</span></p>';
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
        h += '<p class="rs-hint">可选，比如病历、处方、化验单。照片压缩后只存在这台手机上，不进备份文件。</p>';
        host.innerHTML = h;
        PH.hydrate(host);
      }
      paintPh();
      box.addEventListener('click', function (e) {
        if (closed || (Util.hapEcho && Util.hapEcho(e))) return;
        var b = e.target.closest ? e.target.closest('button') : null, v;
        if (!b || !box.contains(b)) return;
        if (b.id === 'skSave' || b.hasAttribute('data-ok')) { save(); return; }
        if (b.hasAttribute('data-skdel')) { closed = true; api.close(); remove(rec.id); return; }
        if ((v = b.getAttribute('data-skend'))) {
          st.ended = v === '1';
          Array.prototype.forEach.call(box.querySelectorAll('[data-skend]'), function (x) { var o = x === b; x.classList.toggle('on', o); x.setAttribute('aria-selected', String(o)); });
          box.querySelector('[data-skendtile]').hidden = !st.ended;
          return;
        }
        if ((v = b.getAttribute('data-sk'))) {
          var val = b.getAttribute('data-v'), arr = st[v], i = arr.indexOf(val);
          if (i >= 0) arr.splice(i, 1);
          else { if (arr.length >= MAX_TAGS) { Util.toast('最多 ' + MAX_TAGS + ' 个', 'warn'); return; } arr.push(val); }
          var on = arr.indexOf(val) >= 0; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on));
          return;
        }
        if ((v = b.getAttribute('data-skadd'))) { addFrom(v); return; }
        if ((v = b.getAttribute('data-skmed'))) { if (st.meds.indexOf(v) < 0 && st.meds.length < MAX_MEDS) st.meds.push(v); paintMeds(); return; }
        if ((v = b.getAttribute('data-skmedrm'))) { st.meds = st.meds.filter(function (x) { return x !== v; }); paintMeds(); return; }
        if ((v = b.getAttribute('data-skvisit'))) {
          st.visit = st.visit === v ? '' : v;
          Array.prototype.forEach.call(box.querySelectorAll('[data-skvisit]'), function (x) { var o = x.getAttribute('data-skvisit') === st.visit; x.classList.toggle('on', o); x.setAttribute('aria-selected', String(o)); });
          box.querySelector('[data-skplace]').hidden = !st.visit || st.visit === 'home';
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
        /* 输入框里写了但没点「添加」的，保存时一并收下 */
        [['symptoms', '#skSymIn', 12, MAX_TAGS], ['causes', '#skCauseIn', 12, MAX_TAGS], ['meds', '#skMedIn', 30, MAX_MEDS]].forEach(function (x) {
          var inp = box.querySelector(x[1]), t = String(inp.value || '').trim().slice(0, x[2]);
          if (t && st[x[0]].indexOf(t) < 0 && st[x[0]].length < x[3]) st[x[0]].push(t);
        });
        if (!st.symptoms.length) {
          var g = box.querySelector('[data-skbox="symptoms"]');
          if (g) { g.classList.remove('shake'); void g.offsetWidth; g.classList.add('shake'); }
          Util.toast('选一个症状，或者在下面自己写', 'warn'); return;
        }
        var sv = si.value, ev = st.ended ? ei.value : null;
        if (!okDay(sv) || sv > Util.todayISO()) { Util.toast('请选择不晚于今天的开始日期', 'warn'); return; }
        if (ev != null && (!okDay(ev) || ev < sv || ev > Util.todayISO())) { Util.toast('好转日期要在开始日期和今天之间', 'warn'); return; }
        var ci = box.querySelector('#skCost'), craw = String(ci.value || '').trim().replace(/[¥￥,，\s]/g, ''), cost = null;
        if (craw) {
          cost = /^\d{1,6}(\.\d{1,2})?$/.test(craw) ? parseFloat(craw) : NaN;
          if (!okCost(cost)) { Util.markInvalid(ci, '填数字，比如 128 或 56.5'); return; }
        }
        saving = true;
        var dd = Storage.get(), L = list(dd), r;
        if (editing) { r = L.filter(function (x) { return x && x.id === rec.id; })[0]; if (!r) { api.close(); return; } }
        else { r = { id: Util.uid() }; L.push(r); }
        r.start = sv; r.end = ev;
        r.symptoms = st.symptoms.slice(); r.causes = st.causes.slice(); r.meds = st.meds.slice();
        r.visit = st.visit || null;
        var place = String((box.querySelector('#skPlace') || {}).value || '').trim().slice(0, 30);
        r.place = st.visit && st.visit !== 'home' && place ? place : null;
        r.cost = cost;
        var note = String((box.querySelector('#skNote') || {}).value || '').trim().slice(0, 80);
        r.note = note || null;
        if (PH && st.photos.length) r.photos = st.photos.slice(); else delete r.photos;
        var id = r.id, title = titleOf(r);
        if (Storage.save()) {
          if (editing) Util.toast('已保存修改', 'ok');
          else Util.toast('已记下：' + title, 'ok', { label: '撤销', onClick: function () {
            var d3 = Storage.get(); d3.sicks = list(d3).filter(function (x) { return !x || x.id !== id; }); Storage.save(); global.App.rerender(); Util.toast('已撤销', 'ok');
          } });
        }
        closed = true; api.close(); global.App.rerender();
      }
    });
  }
  function remove(id) {
    var d = Storage.get();
    Util.removeWithUndo(list(d), id, { onSave: function () { Storage.save(); }, onAfter: function () { global.App.rerender(); }, deletedText: '已删除生病记录' });
  }

  /* ---------- 页面 ---------- */
  function pageHTML(d) {
    var SV = (global.FTUI && global.FTUI.SV) || {}, vs = sorted(d), h = '';
    if (vs.length) {
      var yr = Util.todayISO().slice(0, 4), spent = 0, hasCost = false;
      vs.forEach(function (r) { if (r.start.slice(0, 4) === yr && okCost(r.cost)) { spent += r.cost; hasCost = true; } });
      h += '<div class="mod-sum"><span class="ms-k">摘要</span><p>共记了 <b>' + vs.length + ' 次</b>。'
        + (hasCost ? '今年花费 <b>' + esc(money(spent)) + '</b>。' : '') + '</p></div>';
      h += '<section class="mod-tl ft-tl"><p class="ms-k">记录</p><ul class="tl sk2-tl">';
      vs.forEach(function (r) {
        var ph = global.Photos ? global.Photos.clean(r.photos) : [], f = facts(r);
        h += '<li class="tl-row"><span class="tl-time ft-tlt"><small>' + esc(dayLab(r.start)) + '</small></span><span class="tl-dot" aria-hidden="true"></span>'
          + '<button type="button" class="tl-card" data-skopen="' + esc(r.id) + '" aria-label="' + esc(dayLab(r.start) + ' ' + titleOf(r) + '，点按修改') + '">'
          + '<span class="tl-ico">' + icon('sick') + '</span><span class="tl-txt"><b>' + esc(titleOf(r)) + '</b><small>' + esc(spanOf(r)) + '</small>'
          + f.map(function (x) { return '<small class="sk2-f">' + esc(x) + '</small>'; }).join('')
          + (r.note ? '<small class="ml-nt">' + esc(String(r.note).slice(0, 80)) + '</small>' : '')
          + (ph.length ? '<span class="pv-phs">' + ph.slice(0, 3).map(function (pid) { return '<img data-phid="' + pid + '" alt="">'; }).join('') + (ph.length > 3 ? '<i>+' + (ph.length - 3) + '</i>' : '') + '</span>' : '')
          + '</span><span class="tl-more" aria-hidden="true">' + (SV.more || '') + '</span></button>'
          + '<button type="button" class="tl-del" data-del="' + esc(r.id) + '" aria-label="删除" title="删除">' + icon('trash') + '</button></li>';
      });
      h += '</ul></section>';
    } else {
      h += '<div class="sk-empty sk2-empty"><p>记下每次生病的经过：症状、原因、用药和花费，日后翻看或给医生看都方便</p></div>';
    }
    h += '<p class="hint sk2-pfoot">只做记录，不提醒，也不做任何判断或用药建议。</p>';
    h += '<div class="mod-cta ft-cta"><button type="button" class="mc-main" id="skAdd">' + (SV.plusc || icon('plus')) + '<span>记一次生病</span></button></div>';
    return h;
  }

  Modules.sick = {
    id: 'sick',
    title: '生病记录',
    render: function (view) {
      view.innerHTML = '<div class="ft-page skel-page sk2-page" data-accent="sick">' + pageHTML(Storage.get()) + '</div>';
      var page = view.firstChild, lock = 0;
      if (global.Photos) global.Photos.hydrate(page);
      page.addEventListener('click', function (e) {
        if (Util.hapEcho && Util.hapEcho(e)) return;
        var b = e.target.closest ? e.target.closest('button') : null, v;
        if (!b || !page.contains(b)) return;
        if (b.id === 'skAdd') { openRec(null); return; }
        if ((v = b.getAttribute('data-skopen'))) { var r = list(Storage.get()).filter(function (x) { return x && String(x.id) === v; })[0]; if (r) openRec(r); return; }
        if ((v = b.getAttribute('data-del'))) { if (e.isTrusted && Date.now() - lock < 500) return; lock = Date.now(); remove(v); }
      });
    },
    _edit: function (rec) { if (rec) openRec(rec); },
    _remove: remove,
    _add: function () { openRec(null); },
    _title: titleOf,
    _span: spanOf,
    _facts: facts,
    _money: money,
    _symptoms: SYMPTOMS,
    _causes: CAUSES
  };
})(window);
