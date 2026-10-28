/**
 * milestone.js - 里程碑（第 299 次重做成 Cali 风格的「成长第一次」）
 *
 * 页面：摘要（已留下 N 个第一次 · 上次 x 天前）→ 发育对照卡（当前检查点 已对照 x/y，点开半屏逐条对照）
 *   → 「第一次」时间轴（标题、那天几个月几天、备注、照片缩略图；点按修改，删除可撤销）→ 底部固定「＋ 记一个第一次」。
 * 记录面板：日期磁贴 → 常见（按大运动 / 精细动作 / 语言 / 社交与生活分组点选，已记过的带勾）| 自定义 → 备注 → 照片（最多 6 张，只存本机）。
 * 发育对照沿用第 68 次的规则（国家卫健委《3 岁以下婴幼儿心理行为发育标志自评表》+《预警征象筛查表》，只对照不诊断，
 *   早产儿用矫正月龄），只是从页面上挪进半屏。数据不变：d.milestones = [{ id, title, date, note, photos }]，d.milestoneObs 同前。
 */
(function (global) {
  'use strict';
  var Storage = global.Storage, Util = global.Util;
  var Modules = global.Modules = global.Modules || {};
  var Knowledge = global.Knowledge || null;

  var GROUPS = [
    { name: '大运动', items: ['会抬头', '第一次翻身', '会独坐', '会爬', '会扶站', '第一次独站', '会走路'] },
    { name: '精细动作', items: ['会抓握玩具', '会两手换着拿', '会用拇指食指捏'] },
    { name: '语言', items: ['第一次笑出声', '会咿呀发声', '第一次叫妈妈', '第一次叫爸爸', '说出第一个词'] },
    { name: '社交与生活', items: ['第一次微笑', '会认人', '会挥手再见', '长第一颗牙', '第一次吃辅食', '第一次剪头发', '第一次出远门'] }
  ];
  var ALL = [];
  GROUPS.forEach(function (g) { ALL = ALL.concat(g.items); });

  function esc(s) { return Util.escapeHtml(s == null ? '' : String(s)); }
  function okDay(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T00:00:00').getTime()); }
  function list(d) { if (!Array.isArray(d.milestones)) d.milestones = []; return d.milestones; }
  function sorted(d) {
    return list(d).filter(function (r) { return r && r.title && okDay(r.date); }).slice()
      .sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
  }
  function baby(d) { return (d.settings && d.settings.baby) || {}; }
  /* 那天几个月几天（按出生日的日历月）；出生前 / 没填生日返回空 */
  function ageAt(d, day) {
    var b = baby(d).birthDate;
    if (!okDay(b) || !okDay(day) || day < b) return '';
    var y1 = +b.slice(0, 4), m1 = +b.slice(5, 7), d1 = +b.slice(8, 10);
    var y2 = +day.slice(0, 4), m2 = +day.slice(5, 7), d2 = +day.slice(8, 10);
    var mo = (y2 - y1) * 12 + (m2 - m1);
    if (d2 < d1) mo--;
    if (mo < 1) { var n = Util.daysBetween(b, day); return n === 0 ? '出生当天' : '出生第 ' + (n + 1) + ' 天'; }
    var anchor = new Date(y1, m1 - 1 + mo, d1), dd = Math.round((new Date(y2, m2 - 1, d2) - anchor) / 864e5);
    var yrs = Math.floor(mo / 12), mm = mo % 12;
    var s = yrs ? yrs + ' 岁' + (mm ? ' ' + mm + ' 个月' : '') : mo + ' 个月';
    return s + (dd > 0 ? ' ' + dd + ' 天' : '');
  }
  function ago(day) {
    var n = Util.daysBetween(day, Util.todayISO());
    return n <= 0 ? '今天' : n === 1 ? '昨天' : n + ' 天前';
  }
  function dayLab(day) {
    var t = Util.todayISO();
    if (day === t) return '今天';
    if (day === Util.addDays(t, -1)) return '昨天';
    var m = +day.slice(5, 7), dd = +day.slice(8, 10);
    return day.slice(0, 4) === t.slice(0, 4) ? m + '月' + dd + '日' : day.slice(0, 4) + '/' + m + '/' + dd;
  }

  /* ---------- 发育对照（规则同第 68 次） ---------- */
  function readMarks(d) {
    var marks = {};
    if (!Knowledge) return marks;
    var valid = {};
    Knowledge.MILESTONES.forEach(function (e) { valid[e.id] = true; });
    (d.milestoneObs || []).forEach(function (r) { if (r && valid[r.id] && (r.v === 0 || r.v === 1)) marks[r.id] = r.v; });
    return marks;
  }
  function ageInfo(d) {
    var b = baby(d), ageDays = okDay(b.birthDate) ? Util.daysBetween(b.birthDate, Util.todayISO()) : null, eff = ageDays, corr = '';
    if (ageDays != null && b.preterm && parseFloat(b.birthGestWeeks) > 0 && parseFloat(b.birthGestWeeks) < 40) {
      var c = Math.round((40 - parseFloat(b.birthGestWeeks)) * 7);
      if (c > 0 && ageDays - c >= 0 && (ageDays - c) / 30.44 <= 24) { eff = ageDays - c; corr = ' · 矫正月龄 ' + (eff / 30.44).toFixed(1) + ' 月'; }
    }
    return { days: ageDays, mo: eff != null ? eff / 30.44 : null, corr: corr };
  }
  function reachedOf(ai) {
    var r = {};
    Knowledge.CHECKPOINTS.forEach(function (m) { r[m] = ai.mo != null && ai.mo >= m; });
    return r;
  }
  function defaultCp(ai) {
    var cps = Knowledge.CHECKPOINTS, r = reachedOf(ai);
    for (var i = cps.length - 1; i >= 0; i--) if (r[cps[i]]) return cps[i];
    return cps[0];
  }
  function selCp(ai) {
    var M = Modules.milestone;
    if (!M._selCp || Knowledge.CHECKPOINTS.indexOf(M._selCp) < 0) M._selCp = defaultCp(ai);
    return M._selCp;
  }
  /* 结论句（只对已到的检查点给官方建议；未到不下结论） */
  function verdict(set, marks, reached) {
    if (!reached) return { t: '这个检查点还没到月龄，先看看就行，到月龄再来对照。', warn: false };
    var no = set.obs.filter(function (e) { return marks[e.id] === 0; }).length;
    var done = set.obs.filter(function (e) { return marks[e.id] === 1 || marks[e.id] === 0; }).length;
    if (no >= 2) return { t: '有 ' + no + ' 项发育标志未出现。按官方建议，应带宝宝到医疗机构进行相关检查。早看早安心，很多情况只是需要一点时间。', warn: true };
    if (no === 1) return { t: '有 1 项发育标志未出现：平时多陪宝宝交流与玩耍，并向医务人员寻求指导，下次儿保时和医生聊聊就好。', warn: true };
    if (done === set.obs.length) return { t: '这个检查点 ' + set.obs.length + ' 项都达到了。', warn: false };
    return { t: '已对照 ' + done + '/' + set.obs.length + ' 项，想到再标，不用一次做完。', warn: false };
  }
  function obsBody(d, cp) {
    var ai = ageInfo(d), reached = reachedOf(ai), set = Knowledge.milestoneAt(cp), marks = readMarks(d), h = '';
    h += '<p class="rs-hint">' + (ai.days == null ? '先在「称呼与阶段」里填宝宝生日，才能按月龄对照。' : '宝宝现在 ' + (ai.days / 30.44).toFixed(1) + ' 月龄' + esc(ai.corr) + '。') + '对照官方自评表，只对照、不评级也不下结论，标记只存在本机。</p>';
    h += '<div class="ml-cps" role="tablist">';
    Knowledge.CHECKPOINTS.forEach(function (m) {
      h += '<button type="button" class="dp-pill' + (m === cp ? ' active' : '') + '" data-cp="' + m + '" role="tab" aria-selected="' + (m === cp) + '">' + m + ' 月龄' + (reached[m] ? '' : ' · 未到') + '</button>';
    });
    h += '</div><p class="rs-lbl">' + cp + ' 月龄自评</p><div class="ml-obs">';
    set.obs.forEach(function (e) {
      var v = marks[e.id];
      h += '<div class="ml-ob"><p><small>' + esc(Knowledge.AREA_TXT[e.area]) + '</small>' + esc(e.text) + '</p><span class="rs-seg ml-yn">'
        + '<button type="button" class="' + (v === 1 ? 'on' : '') + '" data-mid="' + e.id + '" data-v="1" aria-pressed="' + (v === 1) + '">是</button>'
        + '<button type="button" class="' + (v === 0 ? 'on ml-no' : '') + '" data-mid="' + e.id + '" data-v="0" aria-pressed="' + (v === 0) + '">还没</button></span></div>';
    });
    var vd = verdict(set, marks, reached[cp]);
    h += '</div><p class="' + (vd.warn ? 'rs-warn' : 'rs-hint') + ' ml-vd">' + esc(vd.t) + '</p>';
    var hit = set.warn.filter(function (e) { return marks[e.id] === 1; }).length;
    h += '<p class="rs-lbl">预警征象 <span class="rs-lbl-n">反向观察，出现任何一条建议就医</span></p><div class="ml-obs">';
    set.warn.forEach(function (e) {
      var on = marks[e.id] === 1;
      h += '<div class="ml-ob"><p>' + esc(e.text) + '</p><span class="rs-seg ml-yn ml-yn1"><button type="button" class="' + (on ? 'on ml-no' : '') + '" data-mid="' + e.id + '" data-v="1" aria-pressed="' + on + '">' + (on ? '有此表现' : '标记') + '</button></span></div>';
    });
    h += '</div>';
    if (hit) h += '<p class="rs-warn">已标记 ' + hit + ' 条预警征象。按官方指引，建议带宝宝到医院就诊（儿保科或儿童发育行为科），由医生进一步评估。</p>';
    return h;
  }
  function openObs() {
    var FT = global.FTUI;
    if (!FT || !Knowledge || !Knowledge.CHECKPOINTS) return;
    var d0 = Storage.get(), cp = selCp(ageInfo(d0));
    FT.openSheet('milestone', '发育对照', '<div id="mlObs">' + obsBody(d0, cp) + '</div>', function (api) {
      var box = api.box, host = box.querySelector('#mlObs'), ok = box.querySelector('[data-ok]');
      if (ok) ok.setAttribute('aria-label', '完成');
      api.onClose = function () { global.App.rerender(); };
      function paint() { var st = host.parentNode.scrollTop; host.innerHTML = obsBody(Storage.get(), cp); host.parentNode.scrollTop = st; }
      box.addEventListener('click', function (e) {
        if (Util.hapEcho && Util.hapEcho(e)) return;
        var b = e.target.closest ? e.target.closest('button') : null, v;
        if (!b || !box.contains(b)) return;
        if (b.hasAttribute('data-ok')) { api.close(); return; }
        if ((v = b.getAttribute('data-cp'))) { cp = Modules.milestone._selCp = parseInt(v, 10); paint(); return; }
        if ((v = b.getAttribute('data-mid'))) {
          var val = parseInt(b.getAttribute('data-v'), 10), d = Storage.get();
          var rest = (d.milestoneObs || []).filter(function (r) { return r && r.id !== v; });
          var cur = (d.milestoneObs || []).filter(function (r) { return r && r.id === v; })[0];
          var next = (cur && cur.v === val) ? null : { id: v, v: val, date: Util.todayISO() };
          d.milestoneObs = next ? rest.concat([next]) : rest;
          if (Storage.save() && v.indexOf('KN-W-') === 0 && next) Util.toast('已标记。官方建议带宝宝请医生进一步评估，这里只对照、不诊断。', 'warn');
          paint();
        }
      });
    });
  }

  /* ---------- 记一个第一次 ---------- */
  var openAt = 0;
  function openRec(rec, preTitle) {
    var FT = global.FTUI, PH = global.Photos;
    if (!FT || Date.now() - openAt < 450) return;
    openAt = Date.now();
    var d = Storage.get(), editing = !!rec, today = Util.todayISO(), bd = baby(d).birthDate;
    var have = {};
    sorted(d).forEach(function (r) { if (!rec || r.id !== rec.id) have[r.title] = r.date; });
    var t0 = editing ? rec.title : (preTitle || '');
    var st = { mode: t0 && ALL.indexOf(t0) < 0 ? 'u' : 'c', pick: ALL.indexOf(t0) >= 0 ? t0 : '', photos: editing && PH ? PH.clean(rec.photos) : [] };
    var date0 = editing ? rec.date : today;
    var SV = FT.SV || {};
    var grid = '';
    GROUPS.forEach(function (g) {
      grid += '<p class="ml-grp">' + g.name + '</p><div class="rs-pills ml-picks">';
      g.items.forEach(function (it) {
        var on = st.pick === it;
        grid += '<button type="button" class="dp-pill' + (on ? ' active' : '') + (have[it] ? ' ml-had' : '') + '" data-mlpick="' + esc(it) + '" aria-pressed="' + on + '"'
          + (have[it] ? ' title="' + esc('已记过 ' + have[it]) + '"' : '') + '>' + (have[it] ? '<i aria-hidden="true">✓</i>' : '') + esc(it) + '</button>';
      });
      grid += '</div>';
    });
    var body = '<p class="rs-lbl">日期</p><div class="rs-when ft-when ml-when"><label class="rs-tile ft-tile"><span class="ft-ti">' + (SV.cal || '') + '</span><span class="ft-tt"><small>日期</small>'
      + '<b data-show="mlDate"></b><input type="date" class="ft-hid" id="mlDate" value="' + esc(date0) + '" max="' + today + '"' + (okDay(bd) ? ' min="' + bd + '"' : '') + ' aria-label="日期"></span></label>'
      + '<p class="ml-age" id="mlAge"></p></div>'
      + '<div class="rs-seg sk-seg sk-n2 ml-mode" role="tablist"><button type="button" class="' + (st.mode === 'c' ? 'on' : '') + '" data-mlmode="c" role="tab" aria-selected="' + (st.mode === 'c') + '">常见</button>'
      + '<button type="button" class="' + (st.mode === 'u' ? 'on' : '') + '" data-mlmode="u" role="tab" aria-selected="' + (st.mode === 'u') + '">自定义</button></div>'
      + '<div data-mlpane="c"' + (st.mode === 'c' ? '' : ' hidden') + '>' + grid + '</div>'
      + '<div data-mlpane="u"' + (st.mode === 'u' ? '' : ' hidden') + '><label class="rs-note"><span class="rs-lbl">这个第一次</span><input type="text" id="mlTitle" maxlength="20" placeholder="如：第一次游泳" value="' + esc(st.mode === 'u' ? t0 : '') + '"></label></div>'
      + '<label class="rs-note"><span class="rs-lbl">备注</span><input type="text" id="mlNote" maxlength="60" placeholder="当时的情景，可选" value="' + esc(editing ? rec.note || '' : '') + '"></label>'
      + (PH ? '<div id="mlPh"></div>' : '')
      + (editing ? '<button type="button" class="btn rs-del" data-mldel>删除这条记录</button>' : '')
      + '<div class="rs-savebar"><button type="button" class="btn btn-primary rs-save" id="mlSave">' + icon('check') + '<span>' + (editing ? '保存修改' : '保存') + '</span></button></div>';

    FT.openSheet('milestone', editing ? '修改里程碑' : '记一个第一次', body, function (api) {
      var box = api.box, closed = false, busy = false, saving = false;
      api.onClose = function () { closed = true; };
      var di = box.querySelector('#mlDate');
      function paintAge() { var a = ageAt(Storage.get(), di.value); box.querySelector('#mlAge').textContent = a ? '那天宝宝 ' + a : ''; }
      if (di._paint) di._paint();
      paintAge();
      di.addEventListener('change', function () {
        if (!okDay(di.value) || di.value > Util.todayISO()) { Util.toast('请选择不晚于今天的日期', 'warn'); di.value = date0; if (di._paint) di._paint(); }
        paintAge();
      });
      function paintPh() {
        var host = box.querySelector('#mlPh'); if (!host || !PH) return;
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
        h += '<p class="rs-hint">可选。照片压缩后只存在这台手机上，不进备份文件。</p>';
        host.innerHTML = h;
        PH.hydrate(host);
      }
      paintPh();
      box.addEventListener('click', function (e) {
        if (closed || (Util.hapEcho && Util.hapEcho(e))) return;
        var b = e.target.closest ? e.target.closest('button') : null, v;
        if (!b || !box.contains(b)) return;
        if (b.id === 'mlSave' || b.hasAttribute('data-ok')) { save(); return; }
        if (b.hasAttribute('data-mldel')) { closed = true; api.close(); remove(rec.id); return; }
        if ((v = b.getAttribute('data-mlmode'))) {
          st.mode = v;
          Array.prototype.forEach.call(box.querySelectorAll('[data-mlmode]'), function (x) { var o = x === b; x.classList.toggle('on', o); x.setAttribute('aria-selected', String(o)); });
          Array.prototype.forEach.call(box.querySelectorAll('[data-mlpane]'), function (x) { x.hidden = x.getAttribute('data-mlpane') !== v; });
          return;
        }
        if ((v = b.getAttribute('data-mlpick'))) {
          st.pick = st.pick === v ? '' : v;
          Array.prototype.forEach.call(box.querySelectorAll('[data-mlpick]'), function (x) { var o = x.getAttribute('data-mlpick') === st.pick; x.classList.toggle('active', o); x.setAttribute('aria-pressed', String(o)); });
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
        var title = '';
        if (st.mode === 'u') {
          var ti = box.querySelector('#mlTitle'); title = String(ti.value || '').trim().slice(0, 20);
          if (!title) { Util.markInvalid(ti, '写一下是哪个第一次'); return; }
        } else {
          title = st.pick;
          if (!title) {
            var g = box.querySelector('[data-mlpane="c"]');
            if (g) { g.classList.remove('shake'); void g.offsetWidth; g.classList.add('shake'); }
            Util.toast('先选一个，或者切到「自定义」自己写', 'warn'); return;
          }
        }
        var dv = di.value;
        if (!okDay(dv) || dv > Util.todayISO()) { Util.toast('请选择不晚于今天的日期', 'warn'); return; }
        saving = true;
        var dd = Storage.get(), L = list(dd), r;
        if (editing) { r = L.filter(function (x) { return x && x.id === rec.id; })[0]; if (!r) { api.close(); return; } }
        else { r = { id: Util.uid() }; L.push(r); }
        r.title = title; r.date = dv;
        var note = String((box.querySelector('#mlNote') || {}).value || '').trim().slice(0, 60);
        r.note = note || null;
        if (PH && st.photos.length) r.photos = st.photos.slice(); else delete r.photos;
        var id = r.id;
        if (Storage.save()) {
          if (editing) Util.toast('已保存修改', 'ok');
          else Util.toast('已记下：' + title, 'ok', { label: '撤销', onClick: function () {
            var d3 = Storage.get(); d3.milestones = list(d3).filter(function (x) { return !x || x.id !== id; }); Storage.save(); global.App.rerender(); Util.toast('已撤销', 'ok');
          } });
        }
        closed = true; api.close(); global.App.rerender();
      }
    });
  }
  function remove(id) {
    var d = Storage.get();
    Util.removeWithUndo(list(d), id, { onSave: function () { Storage.save(); }, onAfter: function () { global.App.rerender(); }, deletedText: '已删除里程碑' });
  }

  /* ---------- 页面 ---------- */
  function pageHTML(d) {
    var SV = (global.FTUI && global.FTUI.SV) || {}, vs = sorted(d), h = '';
    if (vs.length) h += '<div class="mod-sum"><span class="ms-k">摘要</span><p>已留下 <b>' + vs.length + ' 个</b>第一次。上次：<b>' + esc(ago(vs[0].date)) + '</b></p></div>';
    if (Knowledge && Knowledge.CHECKPOINTS) {
      var ai = ageInfo(d), cp = selCp(ai), set = Knowledge.milestoneAt(cp), marks = readMarks(d), r = reachedOf(ai)[cp];
      var done = set.obs.filter(function (e) { return marks[e.id] === 1 || marks[e.id] === 0; }).length;
      var vd = verdict(set, marks, r), hit = set.warn.filter(function (e) { return marks[e.id] === 1; }).length;
      h += '<button type="button" class="card ml-obsCard" id="mlObsGo"><span class="ml-oc-t"><small class="ms-k">发育对照</small><b>' + cp + ' 月龄' + (r ? '' : ' · 还没到') + '</b>'
        + '<small>' + (ai.days == null ? '填了宝宝生日就能按月龄对照' : '已对照 ' + done + '/' + set.obs.length + ' 项' + (hit ? ' · 标记了 ' + hit + ' 条预警征象' : '')) + '</small></span>'
        + '<span class="ml-oc-go">去对照' + icon('chevron') + '</span></button>';
      if (r && (vd.warn || hit)) h += '<p class="hint med-note">' + esc(hit ? '已标记 ' + hit + ' 条预警征象，建议带宝宝到医院就诊，由医生进一步评估。' : vd.t) + '</p>';
    }
    if (vs.length) {
      h += '<section class="mod-tl ft-tl"><p class="ms-k">第一次</p><ul class="tl ml-tl">';
      vs.forEach(function (r) {
        var a = ageAt(d, r.date), ph = global.Photos ? global.Photos.clean(r.photos) : [];
        h += '<li class="tl-row"><span class="tl-time ft-tlt"><small>' + esc(dayLab(r.date)) + '</small></span><span class="tl-dot" aria-hidden="true"></span>'
          + '<button type="button" class="tl-card" data-mlopen="' + esc(r.id) + '" aria-label="' + esc(dayLab(r.date) + ' ' + r.title + '，点按修改') + '">'
          + '<span class="tl-ico">' + icon('milestone') + '</span><span class="tl-txt"><b>' + esc(r.title) + '</b>' + (a ? '<small>' + esc(a) + '</small>' : '')
          + (r.note ? '<small class="ml-nt">' + esc(r.note) + '</small>' : '')
          + (ph.length ? '<span class="pv-phs">' + ph.slice(0, 3).map(function (id) { return '<img data-phid="' + id + '" alt="">'; }).join('') + (ph.length > 3 ? '<i>+' + (ph.length - 3) + '</i>' : '') + '</span>' : '')
          + '</span><span class="tl-more" aria-hidden="true">' + (SV.more || '') + '</span></button>'
          + '<button type="button" class="tl-del" data-del="' + esc(r.id) + '" aria-label="删除" title="删除">' + icon('trash') + '</button></li>';
      });
      h += '</ul></section>';
    } else {
      h += '<div class="sk-empty ml-empty"><img src="assets/hero/milestone.webp" alt="" width="200" height="200" decoding="sync"><p>宝宝的每个「第一次」都值得留下</p></div>';
    }
    h += '<div class="mod-cta ft-cta"><button type="button" class="mc-main" id="mlAdd">' + (SV.plusc || icon('plus')) + '<span>记一个第一次</span></button></div>';
    return h;
  }

  Modules.milestone = {
    id: 'milestone',
    title: '里程碑',
    render: function (view) {
      view.innerHTML = '<div class="ft-page skel-page ml-page" data-accent="milestone">' + pageHTML(Storage.get()) + '</div>';
      var page = view.firstChild, lock = 0;
      if (global.Photos) global.Photos.hydrate(page);
      page.addEventListener('click', function (e) {
        if (Util.hapEcho && Util.hapEcho(e)) return;
        var b = e.target.closest ? e.target.closest('button') : null, v;
        if (!b || !page.contains(b)) return;
        if (b.id === 'mlAdd') { openRec(null); return; }
        if (b.id === 'mlObsGo') { openObs(); return; }
        if ((v = b.getAttribute('data-mlopen'))) { var r = list(Storage.get()).filter(function (x) { return x && String(x.id) === v; })[0]; if (r) openRec(r); return; }
        if ((v = b.getAttribute('data-del'))) { if (e.isTrusted && Date.now() - lock < 500) return; lock = Date.now(); remove(v); }
      });
    },
    _edit: function (rec) { if (rec) openRec(rec); },
    _remove: remove,
    _add: function (title) { openRec(null, title); },
    _obs: openObs,
    _ageAt: ageAt,
    _presets: ALL
  };
})(window);
