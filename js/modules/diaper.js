/**
 * diaper.js - 换尿布记录（产后「吃睡拉」三大日常之一）
 * 一键快记：尿 / 便 / 混合，点一下即记下当前时间；可补备注。
 * 设计理由：新生儿期换尿布场景单手操作、时间紧迫，不做表单，做「大按钮即记」。
 */
(function (global) {
  'use strict';
  var Storage = global.Storage, Util = global.Util;
  var Modules = global.Modules = global.Modules || {};

  /* 第 138 次（尿布颜色 · P0）：7 档便便色（Cali 的 diaperColor 同口径，档位取儿科常规）。
     黑/红/灰白三档带 warn——不是诊断，是「建议就医」的红线提示（与黄疸/体温同纪律：只记录不判读）。 */
  var COLORS = [
    { v: 'gold',   label: '金黄', hex: '#E8B84B' },
    { v: 'ygreen', label: '黄绿', hex: '#A7C957' },
    { v: 'green',  label: '绿',   hex: '#5B8C3E' },
    { v: 'brown',  label: '棕',   hex: '#8A5A2B' },
    { v: 'black',  label: '黑',   hex: '#2B2B2B', warn: true },
    { v: 'red',    label: '红',   hex: '#C0392B', warn: true },
    { v: 'pale',   label: '灰白', hex: '#D9D4CB', warn: true }
  ];
  /* 第 195 次（Cali consistency / hasMilkCurds / rash / cream 对标）：便便性状 4 档 + 三个开关。
     只记录、不判读；唯一的安全兜底是「今天稀水样 ≥3 次」提示留意补液与就医信号。
     显示一律走这张表查 label，不直接输出存储值（导入的坏值查不到就不显示）。 */
  var CONS = [
    { v: 'watery', label: '稀水样' },
    { v: 'mushy',  label: '糊状' },
    { v: 'formed', label: '成形' },
    { v: 'hard',   label: '硬球' }
  ];
  function consOf(v) { for (var i = 0; i < CONS.length; i++) if (CONS[i].v === v) return CONS[i]; return null; }
  var FLAGS = [
    { k: 'curds', label: '有奶瓣', poopOnly: true },
    { k: 'rash',  label: '红屁屁' },
    { k: 'cream', label: '涂了护臀膏' }
  ];
  function tagsOf(r) {
    var t = [], c = consOf(r.consistency);
    if (c) t.push(c.label);
    FLAGS.forEach(function (f) { if (r[f.k] === true) t.push(f.label); });
    return t;
  }
  function colorOf(v) { for (var i = 0; i < COLORS.length; i++) if (COLORS[i].v === v) return COLORS[i]; return null; }

  var TYPES = [
    { v: 'pee', t: '尿', icon: 'pee' },
    { v: 'poop', t: '便', icon: 'poop' },
    { v: 'both', t: '尿+便', icon: 'diaper' }
  ];

  function typeInfo(v) {
    for (var i = 0; i < TYPES.length; i++) if (TYPES[i].v === v) return TYPES[i];
    return { v: v, t: v, icon: 'diaper' };
  }

  /* ============================================================
     第 224 次（模块页新骨架 · 尿布样板，对标 Cali 的工具页）：
       插画 + 名称 → 加粗摘要句 → 今日看板（24h 时间轴 + 近 7 天）→ 竖向时间轴 → 底部主色大按钮。
     记录与修改都走同一个半屏面板（sheet.js 自动把 role=dialog 变成底部面板）：
       日期/时间两块大方块、三张尿布插画选类型、量 少/正常/多、便便颜色（便便小图按色上色）、
       性状、奶瓣/红屁屁/护臀膏、备注；保存后面板里闪一下「已记录」再收起，并留撤销。
     数据形状不变（{id,type,time,note,color,consistency,curds,rash,cream}），只新增可选 amount。
     页头插画沿用 hero.js（第 183 次），类型卡复用同一张尿布图，加水滴/便便小标；不使用竞品素材。
     ============================================================ */
  var AMOUNTS = [
    { v: 'little', label: '少' },
    { v: 'normal', label: '正常' },
    { v: 'lot',    label: '多' }
  ];
  function amtOf(v) { for (var i = 0; i < AMOUNTS.length; i++) if (AMOUNTS[i].v === v) return AMOUNTS[i]; return null; }
  var TYPE_LONG = { pee: '尿尿', poop: '便便', both: '尿+便' };
  /* 第 228 次：类型卡、颜色、时间轴一律用「摊开的真实尿布 + 对应污渍」成品图（assets/diaper/），不再用表情式小标。
     图由本项目自己生成（一张平铺尿布 + 程序合成污渍，颜色与 COLORS 一一对应），不使用竞品素材。 */
  var DIMG = 'assets/diaper/';
  function stainSrc(t, color) {
    if (t === 'pee') return DIMG + 'pee.webp';
    if (t === 'both') return DIMG + 'both.webp';
    if (t === 'poop') return DIMG + 'poop_' + (colorOf(color) ? color : 'gold') + '.webp';
    return DIMG + 'clean.webp';
  }
  function diaperImg(src, cls) {
    return '<img class="' + cls + '" src="' + src + '" alt="" width="360" height="360" decoding="sync">';
  }
  function typeArt(t, color) {
    return '<span class="dpt-art">' + diaperImg(stainSrc(t, color), 'dpt-img') + '</span>';
  }
  /* 第 337 次：时间轴 30px 那一处不再用 3D 照片（同一列表里跟别的模块扁平图混排）——尿 = 尿了、便 = 拉了、尿+便 = 尿布（v4 扁平）；
     便便颜色仍在记录面板的 3D 类型卡和详情里看 */
  function miniIco(r) { return icon(r.type === 'pee' ? 'pee' : r.type === 'poop' ? 'poop' : 'diaper'); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function agoText(iso) {
    var t = new Date(iso).getTime();
    if (isNaN(t)) return '';
    var m = Math.floor((Date.now() - t) / 60000);
    if (m < 1) return '刚刚';
    if (m < 60) return m + ' 分钟前';
    if (m < 24 * 60) { var h = Math.floor(m / 60), mm = m % 60; return h + ' 小时' + (mm ? ' ' + mm + ' 分' : '') + '前'; }
    return Util.fmtRowTime(iso);
  }
  function subOf(r) {
    var p = [], c = colorOf(r.color), a = amtOf(r.amount);
    if (a) p.push('量' + a.label);
    if (c) p.push(c.label);
    tagsOf(r).forEach(function (t) { p.push(t); });
    if (r.note) p.push(Util.escapeHtml(r.note));
    return p.join(' · ');
  }

  /* 半屏记录面板：rec 为空 = 新建；dateIso 为补记日期 */
  /* ---------- 第 226 次：扣减用品（对标 Cali「扣减用品」开关） ----------
     记录上新增可选 used: [supplyId]，表示这次换尿布用掉的用品（各 1 件）。
     偏好 settings.diaperStock = { on, ids } 记住上次的开关和选择，首页快记也照它扣。
     改记录 → 先退旧的再扣新的；删记录/撤销 → 原样退回，库存永远和记录对得上。 */
  var Sup = function () { return (Modules.supplies && typeof Modules.supplies._consume === 'function') ? Modules.supplies : null; };
  function countable(d) { var S = Sup(); return S ? S._countable(d) : []; }
  function validUsed(d, ids) {
    var ok = countable(d).map(function (x) { return x.id; }), out = [];
    (Array.isArray(ids) ? ids : []).forEach(function (id) { if (typeof id === 'string' && ok.indexOf(id) >= 0 && out.indexOf(id) < 0) out.push(id); });
    return out;
  }
  function stockPref(d) {
    var p = (d.settings && d.settings.diaperStock) || null;
    var list = countable(d);
    var on = p ? p.on !== false : list.length > 0;
    var ids = validUsed(d, p && p.ids);
    if (on && !ids.length && !p) { var dp = list.filter(function (x) { return x.cat === '纸尿裤'; })[0]; if (dp) ids = [dp.id]; }
    return { on: on && list.length > 0, ids: ids };
  }
  function applyUse(d, ids, delta) { var S = Sup(); return S ? S._consume(d, ids, delta) : []; }
  /** 扣减后的一句提示：只报最紧的那一件，≤10 件时提醒补货 */
  function stockNote(touched) {
    var S = Sup(); if (!S || !touched.length) return '';
    var m = touched.slice().sort(function (a, b) { return a.pieces - b.pieces; })[0];
    return ' · ' + m.name + ' 剩 ' + m.pieces + S._pcsUnit(m) + (m.pieces <= 10 ? '，该补货了' : '');
  }
  /** 快记（首页三键、＋号）共用：按偏好给新记录挂 used 并扣库存，返回提示尾巴 */
  function autoUse(d, rec) {
    var p = stockPref(d);
    if (!p.on || !p.ids.length) return '';
    rec.used = p.ids.slice();
    return stockNote(applyUse(d, rec.used, 1));
  }
  /** 删除一条尿布记录（带撤销），库存同步退回/再扣 */
  function removeRec(d, id) {
    var it = (d.diapers || []).filter(function (x) { return x && x.id === id; })[0];
    if (!it) return;
    var used = validUsed(d, it.used);
    applyUse(d, used, -1);
    Util.removeWithUndo(d.diapers, id, {
      onSave: function () { Storage.save(); }, onAfter: function () { global.App.rerender(); },
      onUndo: function () { applyUse(d, used, 1); },
      deletedText: used.length ? '已删除尿布记录，用品已退回' : '已删除尿布记录'
    });
  }

  var gcDone = false;
  function openSheet(d, rec, dateIso) {
    var root = document.getElementById('modalRoot');
    if (!root) return;
    var editing = !!rec;
    var now = Util.nowLocal();
    var st = editing ? {
      type: TYPE_LONG[rec.type] ? rec.type : null /* 坏类型：面板里要求重选 */, amount: rec.amount || null, color: rec.color || null, consistency: rec.consistency || null,
      curds: rec.curds === true, rash: rec.rash === true, cream: rec.cream === true
    } : { type: null, amount: null, color: null, consistency: null, curds: false, rash: false, cream: false };
    var pref0 = stockPref(d);
    st.used = editing ? validUsed(d, rec.used) : pref0.ids.slice();
    st.useOn = editing ? st.used.length > 0 : pref0.on;
    var oldUsed = editing ? validUsed(d, rec.used) : [];
    /* 第 227 次：便便照片（只存 id，图在 IndexedDB） */
    var PH = global.Photos || null;
    st.photos = (editing && PH) ? PH.clean(rec.photos) : [];
    var busy = false;
    var t0 = editing ? String(rec.time) : (dateIso ? dateIso + now.slice(10) : now);
    var date0 = t0.slice(0, 10), hm0 = t0.slice(11, 16);
    var today = now.slice(0, 10);

    function poopy() { return st.type === 'poop' || st.type === 'both'; }
    function body() {
      var c = colorOf(st.color);
      var h = '<div class="rs-head"><button type="button" class="rs-x" data-x aria-label="关闭">' + icon('close') + '</button>'
        + '<h2 id="dpsTitle">' + (editing ? '修改尿布记录' : '记录尿布') + '</h2></div>'; /* 第 325 次：保存只留底部保存条，顶栏不放 ✓ */
      /* 第 242 次：日期 / 时间磁贴与亲喂、瓶喂、睡眠面板统一（「今天」「14:46」，不露系统输入框样式） */
      h += global.FTUI ? global.FTUI.whenTiles('dps', '', date0, hm0, today).replace('<p class="rs-lbl"></p>', '')
        : '<div class="rs-when">'
        + '<label class="rs-tile"><span>日期</span><input type="date" id="dpsDate" value="' + date0 + '" max="' + today + '"></label>'
        + '<label class="rs-tile"><span>时间</span><input type="time" id="dpsTime" value="' + hm0 + '"></label></div>';
      h += '<p class="rs-lbl">类型</p><div class="dp-types" role="radiogroup" aria-label="类型">';
      TYPES.forEach(function (t) {
        var on = st.type === t.v;
        h += '<button type="button" class="dp-type' + (on ? ' on' : '') + '" data-t="' + t.v + '" role="radio" aria-checked="' + on + '">'
          + typeArt(t.v, st.color) + '<span class="dpt-name">' + TYPE_LONG[t.v] + '</span>'
          + '<i class="dpt-check" aria-hidden="true">' + icon('check') + '</i></button>';
      });
      h += '</div>';
      h += '<p class="rs-lbl">量</p><div class="rs-seg" role="radiogroup" aria-label="量">';
      AMOUNTS.forEach(function (a) {
        h += '<button type="button" class="' + (st.amount === a.v ? 'on' : '') + '" data-amt="' + a.v + '" role="radio" aria-checked="' + (st.amount === a.v) + '">' + a.label + '</button>';
      });
      h += '</div>';
      if (poopy()) {
        h += '<p class="rs-lbl">便便颜色' + (c ? ' · <b>' + c.label + '</b>' : '') + '</p><div class="dp-colors">';
        COLORS.forEach(function (cc) {
          var on = st.color === cc.v;
          h += '<button type="button" class="dp-col' + (on ? ' on' : '') + (cc.warn ? ' warn' : '') + '" data-col="' + cc.v + '" aria-pressed="' + on + '" aria-label="' + cc.label + '">'
            + diaperImg(DIMG + 'poop_' + cc.v + '.webp', 'dpc-img') + '<span>' + cc.label + '</span></button>';
        });
        h += '</div>';
        if (c && c.warn) h += '<p class="rs-warn">这个颜色建议留意：如果再次出现，或宝宝精神、吃奶不好，尽快联系医生。</p>';
        h += '<p class="rs-lbl">性状</p><div class="rs-pills">';
        CONS.forEach(function (cs) {
          h += '<button type="button" class="dp-pill' + (st.consistency === cs.v ? ' active' : '') + '" data-cons="' + cs.v + '" aria-pressed="' + (st.consistency === cs.v) + '">' + cs.label + '</button>';
        });
        h += '</div>';
      }
      if (poopy() && PH) {
        h += '<p class="rs-lbl">照片 <span class="rs-lbl-n">' + st.photos.length + '/' + PH.MAX + '</span></p>';
        if (st.photos.length) {
          h += '<div class="dp-phs">';
          st.photos.forEach(function (id) {
            h += '<span class="dp-ph"><button type="button" class="dp-ph-img" data-phview="' + id + '" aria-label="查看照片"><img data-phid="' + id + '" alt=""></button>'
              + '<button type="button" class="dp-ph-rm" data-phrm="' + id + '" aria-label="移除这张照片">' + icon('close') + '</button></span>';
          });
          h += '</div>';
        }
        if (st.photos.length < PH.MAX) {
          h += '<div class="dp-ph-btns"><button type="button" class="btn dp-ph-add" data-phadd>' + icon('image') + '<span>添加照片</span></button>'
            + '<button type="button" class="btn dp-ph-add" data-phcam>' + icon('camera') + '<span>拍摄照片</span></button></div>';
        }
        h += '<p class="rs-hint">可选。照片压缩后只存在这台手机上，不进备份文件。</p>';
      }
      h += '<p class="rs-lbl">屁屁情况</p><div class="rs-pills">';
      FLAGS.forEach(function (f) {
        if (f.poopOnly && !poopy()) return;
        h += '<button type="button" class="dp-pill' + (st[f.k] ? ' active' : '') + '" data-flag="' + f.k + '" aria-pressed="' + !!st[f.k] + '">' + f.label + '</button>';
      });
      h += '</div>';
      var cl = countable(d), S = Sup();
      h += '<div class="rs-stock"><div class="rs-sw-row"><span class="rs-sw-ico" aria-hidden="true">' + icon('supplies') + '</span><span class="rs-sw-t">扣减用品</span>'
        + '<button type="button" class="rs-switch" role="switch" data-usesw aria-checked="' + !!st.useOn + '" aria-label="扣减用品"><i></i></button></div>';
      if (st.useOn) {
        if (!cl.length) {
          h += '<p class="rs-stock-empty">还没有可扣减的用品。去用品里添加纸尿裤并填上剩余片数，这里就能选。</p>'
            + '<button type="button" class="btn rs-stock-go" data-gosup>去添加</button>';
        } else {
          h += '<div class="rs-stock-list">';
          cl.forEach(function (it) {
            var on = st.used.indexOf(it.id) >= 0;
            var left = it.pieces - (on && oldUsed.indexOf(it.id) < 0 ? 1 : 0) + (!on && oldUsed.indexOf(it.id) >= 0 ? 1 : 0);
            h += '<button type="button" class="rs-stock-item' + (on ? ' on' : '') + (left <= 10 ? ' low' : '') + '" data-use="' + Util.escapeHtml(it.id) + '" aria-pressed="' + on + '">'
              + '<b>' + Util.escapeHtml(it.name) + '</b><span>' + (on ? '用 1' + S._pcsUnit(it) + ' · ' : '') + '剩 ' + Math.max(0, left) + S._pcsUnit(it) + '</span></button>';
          });
          h += '</div>';
        }
      }
      h += '</div>';
      h += '<label class="rs-note"><span class="rs-lbl">备注</span><input type="text" id="dpsNote" maxlength="40" placeholder="可选，如 换了新码" value="' + Util.escapeHtml((editing && rec.note) || noteDraft || '') + '"></label>';
      /* 第 271 次：保存吸在面板底部（.rs-savebar）；删除放在它前面，跟着内容走（同辅食面板） */
      if (editing) h += '<button type="button" class="btn rs-del" data-delrec>删除这条记录</button>';
      h += '<div class="rs-savebar"><button type="button" class="btn btn-primary rs-save" data-ok>' + (editing ? '保存修改' : '保存') + '</button></div>';
      return h;
    }
    var noteDraft = '';
    root.innerHTML = '<div class="modal-mask" data-dps-mask><div class="modal rec-sheet" role="dialog" aria-modal="true" aria-labelledby="dpsTitle" data-accent="diaper"><div class="rs-body"></div></div></div>';
    var mask = root.querySelector('[data-dps-mask]');
    var box = root.querySelector('.rs-body');
    function close() { root.innerHTML = ''; document.removeEventListener('keydown', onKey); if (global.Sheet) Sheet.sync(); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    function paint() {
      var ni = box.querySelector('#dpsNote'); if (ni) noteDraft = ni.value;
      var di = box.querySelector('#dpsDate'), ti = box.querySelector('#dpsTime');
      if (di) date0 = di.value || date0; if (ti) hm0 = ti.value || hm0;
      box.innerHTML = body();
      if (global.FTUI) global.FTUI.bindWhen(box);
      if (PH) PH.hydrate(box);
    }
    paint();
    box.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button') : null;
      if (!b || !box.contains(b)) return;
      if (b.hasAttribute('data-x')) { close(); return; }
      if (b.hasAttribute('data-ok')) { save(); return; }
      if (b.hasAttribute('data-delrec')) {
        close();
        removeRec(d, rec.id);
        return;
      }
      if (b.hasAttribute('data-usesw')) { st.useOn = !st.useOn; if (st.useOn && !st.used.length) { var c0 = countable(d)[0]; if (c0) st.used = [c0.id]; } paint(); return; }
      if (b.hasAttribute('data-gosup')) { close(); global.App.showTab('supplies'); return; }
      var v;
      if ((v = b.getAttribute('data-t'))) { st.type = v; if (!poopy()) { st.color = null; st.consistency = null; st.curds = false; } paint(); return; }
      if ((v = b.getAttribute('data-amt'))) { st.amount = st.amount === v ? null : v; paint(); return; }
      if ((v = b.getAttribute('data-col'))) { st.color = st.color === v ? null : v; paint(); return; }
      if ((v = b.getAttribute('data-cons'))) { st.consistency = st.consistency === v ? null : v; paint(); return; }
      if ((v = b.getAttribute('data-flag'))) { st[v] = !st[v]; paint(); return; }
      if ((v = b.getAttribute('data-phview'))) { if (PH) PH.view(v, st.photos); return; }
      if ((v = b.getAttribute('data-phrm'))) { st.photos = st.photos.filter(function (x) { return x !== v; }); paint(); if (global.Photos && Photos.release) Photos.release(v); return; }
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
            .then(function () { busy = false; if (box.isConnected) paint(); });
        });
        return;
      }
      if ((v = b.getAttribute('data-use'))) { var ix = st.used.indexOf(v); if (ix >= 0) st.used.splice(ix, 1); else st.used.push(v); paint(); return; }
    });
    mask.addEventListener('click', function (e) { if (e.target === mask) close(); });
    document.addEventListener('keydown', onKey);

    function save() {
      if (busy) { Util.toast('照片还在保存，稍等一下', 'warn'); return; }
      if (!st.type) {
        var tg = box.querySelector('.dp-types');
        if (tg) { tg.classList.remove('shake'); void tg.offsetWidth; tg.classList.add('shake'); }
        Util.toast('先选一下类型：尿尿、便便还是都有', 'warn');
        return;
      }
      var dv = (box.querySelector('#dpsDate') || {}).value || date0;
      var tv = (box.querySelector('#dpsTime') || {}).value || hm0;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dv) || !/^\d{2}:\d{2}/.test(tv)) { Util.toast('日期或时间不完整', 'warn'); return; }
      var stamp = dv + 'T' + tv.slice(0, 5) + ':' + (editing && String(rec.time).slice(0, 16) === dv + 'T' + tv.slice(0, 5) ? String(rec.time).slice(17, 19) || '00' : (dv + 'T' + tv.slice(0, 5) === now.slice(0, 16) ? now.slice(17, 19) : '00'));
      if (new Date(stamp).getTime() > Date.now() + 60000) { Util.toast('这个时间还没到，请检查一下', 'warn'); return; }
      var note = ((box.querySelector('#dpsNote') || {}).value || '').trim().slice(0, 40) || null;
      var r = editing ? rec : { id: Util.uid() };
      r.type = st.type; r.time = stamp; r.note = note;
      ['amount', 'color', 'consistency'].forEach(function (k) { if (st[k]) r[k] = st[k]; else delete r[k]; });
      FLAGS.forEach(function (f) { if (st[f.k] && !(f.poopOnly && !poopy())) r[f.k] = true; else delete r[f.k]; });
      /* 库存：先退回这条原来扣的，再按现在的选择扣 */
      var newUsed = st.useOn ? validUsed(d, st.used) : [];
      applyUse(d, oldUsed, -1);
      var touched = applyUse(d, newUsed, 1);
      if (newUsed.length) r.used = newUsed; else delete r.used;
      if (poopy() && st.photos.length) r.photos = st.photos.slice(); else delete r.photos;
      if (!editing) {
        d.settings = d.settings || {};
        d.settings.diaperStock = { on: !!st.useOn, ids: newUsed.length ? newUsed : validUsed(d, st.used) };
        d.diapers.push(r);
      }
      var tail = stockNote(touched);
      if (!Storage.save()) return;
      /* 「已记录」：面板内闪一下插画 + 勾，再收起 */
      box.innerHTML = '<div class="rs-done" role="status">' + typeArt(r.type, r.color)
        + '<span class="rs-done-ok">' + icon('check') + '</span><p>' + (editing ? '已保存' : '已记录') + '</p></div>';
      setTimeout(function () {
        close();
        global.App.rerender();
        if (!editing) Util.toast('已记录：' + TYPE_LONG[r.type] + tail, 'ok', { label: '撤销', onClick: function () {
          /* 只在记录还在时撤销并退库存；用记录当下的 used（中途可能被改过） */
          var gone = null;
          for (var i = d.diapers.length - 1; i >= 0; i--) if (d.diapers[i].id === r.id) { gone = d.diapers.splice(i, 1)[0]; break; }
          if (gone) applyUse(d, validUsed(d, gone.used), -1);
          Storage.save(); global.App.rerender(); Util.toast('已撤销', 'ok');
        } });
      }, 650);
    }
  }

  Modules.diaper = {
    id: 'diaper',
    title: '换尿布',
    render: function (view) {
      var d = Storage.get();
      var DS = Util.dayStartHour(d);
      var dayNow = Util.dayKeyOf(new Date(), DS);
      /* C7 补记：一次性日期覆盖（App.pendingDate，读取即消费）→ 直接打开记录面板 */
      var backfill = (global.App && App.pendingDate) ? App.pendingDate : null;
      if (global.App) global.App.pendingDate = null;

      /* 类型只认三档白名单（导入的坏值按「尿+便」显示，不把原值拼进类名/文案） */
      var all = (d.diapers || []).filter(function (r) { return r && !isNaN(new Date(r.time).getTime()); }).map(function (r) {
        return TYPE_LONG[r.type] ? r : Object.assign({}, r, { type: 'both' });
      }).sort(function (a, b) { return new Date(b.time) - new Date(a.time); });
      var todayList = all.filter(function (r) { return Util.dayKeyOf(r.time, DS) === dayNow; });
      var peeN = todayList.filter(function (r) { return r.type === 'pee' || r.type === 'both'; }).length;
      var poopN = todayList.filter(function (r) { return r.type === 'poop' || r.type === 'both'; }).length;
      var latest = all[0];
      var html = '';

      /* 2. 摘要句（数字加粗） */
      var sum;
      if (todayList.length) {
        sum = '今天换了 <b>' + todayList.length + ' 次</b>尿布，有尿 <b>' + peeN + '</b> 次、有便 <b>' + poopN + '</b> 次。';
      } else {
        sum = '今天还没有<b>尿布</b>记录。';
      }
      if (latest) sum += '最近一次是<b>' + TYPE_LONG[latest.type] + '</b>，<b>' + Util.escapeHtml(agoText(latest.time)) + '</b>。';
      html += '<div class="mod-sum"><span class="ms-k">摘要</span><p>' + sum + '</p>';
      var wr = Util.newbornWetRef(d);
      if (wr) {
        html += '<p class="ms-ref">出生第 ' + wr.day + ' 天，湿尿布常见参考约每天 <b>' + wr.ref + ' 片' + (wr.day >= 5 ? '以上' : '') + '</b>，今天已记 ' + peeN + ' 片。有担心问医生或护士。</p>';
      }
      html += '</div>';

      /* 安全兜底提示（与旧版同口径） */
      var warnToday = todayList.filter(function (r) { return colorOf(r.color) && colorOf(r.color).warn; });
      if (warnToday.length) {
        var names = []; warnToday.forEach(function (r) { var c = colorOf(r.color); if (names.indexOf(c.label) < 0) names.push(c.label); });
        html += '<div class="warn-box"><p>今天有 <b>' + names.join('、') + '色</b>便便记录。'
          + '若出现增多，或伴随哭闹不安、发热、食欲差、精神萎靡，<b>建议尽快联系医生</b>。</p></div>';
      }
      var wateryN = todayList.filter(function (r) { return r.consistency === 'watery'; }).length;
      if (wateryN >= 3) {
        html += '<div class="warn-box"><p>今天记了 <b>' + wateryN + ' 次稀水样</b>便便。留意宝宝的尿量和精神；'
          + '若尿明显变少、嘴唇发干、精神差、发热或便里带血，<b>建议尽快联系医生</b>。</p></div>';
      }

      /* 3. 今日看板：24h 时间轴 + 近 7 天（时间轴点类名供 CSS 死类名检查识别：'dt-pee' 'dt-poop' 'dt-both'） */
      if (all.length && global.DayChart) {
        html += '<div class="card dash-card"><h2>今天</h2>';
        html += DayChart.strip({ win: DayChart.windowOf(dayNow, DS), ds: DS, now: Date.now(), label: '今天换尿布的时间',
          marks: todayList.map(function (r) { return { t: new Date(r.time).getTime(), cls: 'dt-' + r.type, title: Util.fmtRowTime(r.time) + ' ' + TYPE_LONG[r.type] }; }) });
        html += '<div class="dash-chips dp-legend"><span><i class="lg lg-pee"></i>尿 <b>' + peeN + '</b></span><span><i class="lg lg-poop"></i>便 <b>' + poopN + '</b></span></div>';
        var d7 = DayChart.lastDays(dayNow, 7).map(function (k) {
          var n = all.filter(function (r) { return Util.dayKeyOf(r.time, DS) === k; }).length;
          return { key: k, v: n, txt: String(n) };
        });
        if (d7.filter(function (x) { return x.v; }).length >= 2) html += '<p class="dash-sub">近 7 天换尿布次数</p>' + DayChart.bars(d7, dayNow, '近 7 天换尿布次数');
        html += '</div>';
      }

      /* 4. 时间轴（行类名供 CSS 死类名检查识别：'tl-pee' 'tl-poop' 'tl-both'） */
      if (all.length) {
        html += '<section class="mod-tl"><p class="ms-k">最近记录</p>';
        var lastKey = null;
        html += '<ul class="tl">';
        all.slice(0, 30).forEach(function (r) {
          var k = Util.dayKeyOf(r.time, DS);
          void k; void lastKey; /* 第 242 次：不再插日期分组行，日期写在时间上方（与亲喂 / 瓶喂 / 睡眠同款） */
          var dt = new Date(r.time);
          var hm = isNaN(dt.getTime()) ? '' : pad2(dt.getHours()) + ':' + pad2(dt.getMinutes());
          var sub = subOf(r);
          var phs = global.Photos ? Photos.clean(r.photos) : [];
          html += '<li class="tl-row tl-' + r.type + '"><span class="tl-time ft-tlt"><small>' + (isNaN(dt.getTime()) ? '' : (dt.getMonth() + 1) + '/' + dt.getDate()) + '</small>' + hm + '</span><span class="tl-dot" aria-hidden="true"></span>'
            + '<button type="button" class="tl-card" data-open="' + r.id + '" aria-label="' + hm + ' ' + TYPE_LONG[r.type] + '，点按修改">'
            + '<span class="tl-ico">' + miniIco(r) + '</span><span class="tl-txt"><b>' + (TYPE_LONG[r.type] || '尿布') + '</b>'
            + (sub ? '<small>' + sub + '</small>' : '') + '</span>'
            + (phs.length ? '<span class="tl-ph"><img data-phid="' + phs[0] + '" alt="">' + (phs.length > 1 ? '<i>' + phs.length + '</i>' : '') + '</span>' : '')
            + '<span class="tl-more" aria-hidden="true">' + (global.FTUI ? global.FTUI.SV.more : icon('chevron-right')) + '</span></button>'
            + '<button type="button" class="tl-del" data-del="' + r.id + '" aria-label="删除" title="删除">' + icon('trash') + '</button></li>';
        });
        html += '</ul></section>';
      } else {
        html += '<div class="mod-empty"><p>点按下方「记录尿布」，选类型就能记下。<br>颜色、性状这些想记再记。</p></div>';
      }

      /* 5. 底部主按钮 */
      html += '<div class="mod-cta"><button type="button" class="mc-main" data-new>' + icon('plus') + '<span>记录尿布</span></button></div>';

      view.innerHTML = html;
      if (global.Photos) {
        Photos.hydrate(view);
        /* 孤儿照片清理：每次打开 App 只做一次（延后 3 秒），避免刚删除、还能撤销的记录的照片被清掉 */
        if (!gcDone) {
          gcDone = true;
          setTimeout(function () {
            if (Photos.gcAll) { Photos.gcAll(); return; } /* 第 269 次：连辅食照片一起算引用 */
            var keep = [], dd = Storage.get();
            var add = function (arr) { (arr || []).forEach(function (r) { if (r) Photos.clean(r.photos).forEach(function (id) { keep.push(id); }); }); };
            add(dd.diapers);
            (dd.babies || []).forEach(function (bb) { if (bb && bb.rec) add(bb.rec.diapers); });
            Photos.gc(keep);
          }, 3000);
        }
      }

      var nb = view.querySelector('[data-new]');
      if (nb) nb.addEventListener('click', function () { openSheet(d, null, null); });
      Array.prototype.forEach.call(view.querySelectorAll('[data-open]'), function (b) {
        b.addEventListener('click', function () {
          var it = (d.diapers || []).filter(function (x) { return x.id === b.getAttribute('data-open'); })[0];
          if (it) openSheet(d, it, null);
        });
      });
      Array.prototype.forEach.call(view.querySelectorAll('[data-del]'), function (b) {
        b.addEventListener('click', function () {
          removeRec(d, b.getAttribute('data-del'));
        });
      });
      if (backfill) setTimeout(function () { openSheet(d, null, backfill); }, 0);
    },

    /* ============================================================
       第 137 次（磁贴就地记录 · P0）：首页尿布磁贴内嵌三键。
       契约（home.js 是唯一消费方）：
         _quickHTML(d)     只返回控件 HTML，不做任何绑定
         _quickBind(root,d,done)  绑定点击、落库、Toast，完成后调 done() 让首页重渲染
       两个函数都不读写模块级状态，可重复调用；root 是 [data-quick] 容器本身，
       按钮上的 stopPropagation 防止冒泡到外层「打开模块」按钮。
       数据形状与页面内的 rec 完全一致（{id,type,time,note}），
       统计口径因此天然对齐——不是为了「快捷」另造一套字段。
       ============================================================ */
    /* 第 286 次：日期页快捷条 / 时间轴直接开尿布面板（记到所选日期）、编辑、删除（库存同步退回） */
    _open: function (dateIso) { openSheet(Storage.get(), null, dateIso || null); },
    _edit: function (rec) { openSheet(Storage.get(), rec, null); },
    _remove: function (id) { removeRec(Storage.get(), id); },
    _autoUse: autoUse,
    _applyUse: applyUse,
    _validUsed: validUsed,
    _stockPref: stockPref,
    _quickHTML: function (d) {
      var html = '';
      TYPES.forEach(function (t) {
        html += '<button type="button" class="qk-btn" data-qk="' + t.v + '" '
          + 'aria-label="记一次' + t.t + '">' + icon(t.icon) + '<span>' + t.t + '</span></button>';
      });
      return html;
    },

    _quickBind: function (root, d, done) {
      Array.prototype.forEach.call(root.querySelectorAll('[data-qk]'), function (b) {
        b.addEventListener('click', function (ev) {
          if (ev && ev.stopPropagation) ev.stopPropagation();
          var v = b.getAttribute('data-qk');
          var rec = { id: Util.uid(), type: v, time: Util.nowLocal(), note: null };
          var tail = autoUse(d, rec);
          d.diapers.push(rec);
          if (Storage.save()) {
            Util.toast('已记录：' + typeInfo(v).t + tail, 'ok', {
              label: '撤销',
              onClick: function () {
                var gone = null;
                for (var i = d.diapers.length - 1; i >= 0; i--) {
                  if (d.diapers[i].id === rec.id) { gone = d.diapers.splice(i, 1)[0]; break; }
                }
                if (gone) applyUse(d, validUsed(d, gone.used), -1);
                Storage.save();
                done();
              }
            });
          }
          done();
        });
      });
    }
  };
})(window);
