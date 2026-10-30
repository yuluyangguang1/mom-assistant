/**
 * quickrec.js - 第 333 次：我的快记（首页快记卡和「＋」面板共用一份清单、一套记法）
 *
 * 数据：settings.quickItems = null（按喂养方式给默认，见 Storage.quickDefaults）| [{ k, m }]，最多 8 个。
 *   k 种类：feed 喂奶（按上次）/ breast 亲喂 / bottle 瓶喂 / pump 吸奶 / pee 尿了 / poop 拉了 / diaper 换尿布 /
 *          sleep 睡了·醒了 / meds 吃药 / temp 体温 / mood 心情 / fetal 胎动 +1
 *   m 方式：tap 点一下就记（按上次 / 默认值直接记）| step 弹出一步（半屏里点一个预设就记好，不用手输）
 * 记完：dock 上方的提示带「撤销」；首页那一格打一个勾（约 1.5 秒）。两个及以上宝宝时「记给谁」与原来一致（含「都记」）。
 * 编辑：设置 › 我的快记；首页快记卡 / 「＋」面板里长按任意一格也能打开同一个编辑面板。拖动排序、增删、切换方式，改完即存。
 * 取代：首页「快捷记录 · 大 / 横条 / 小卡」三张卡、五张「直接记录」卡（rec-*）和「＋」面板里写死的四项（旧配置由 storage.js migrateQuick 迁移）。
 */
(function (global) {
  'use strict';
  var Util = global.Util, Storage = global.Storage;
  var esc = function (s) { return Util.escapeHtml(s == null ? '' : String(s)); };
  var ic = function (n, c) { return global.icon ? global.icon(n, c) : ''; };

  var KIND = {
    feed: { t: '喂奶', ico: 'feeding', acc: 'feeding', arr: 'feedings', step: '选类型和量' },
    breast: { t: '亲喂', ico: 'breast', acc: 'feeding', arr: 'feedings', step: '选哪侧、多久' },
    bottle: { t: '瓶喂', ico: 'formula', acc: 'feeding', arr: 'feedings', step: '选奶量' },
    pump: { t: '吸奶', ico: 'pump', acc: 'feeding', arr: 'feedings', step: '选奶量' },
    pee: { t: '尿了', ico: 'pee', acc: 'diaper', arr: 'diapers', step: '选时间' },
    poop: { t: '拉了', ico: 'poop', acc: 'diaper', arr: 'diapers', step: '选时间' },
    diaper: { t: '换尿布', ico: 'diaper', acc: 'diaper', arr: 'diapers', step: '尿 · 便 · 都有' },
    sleep: { t: '睡了', ico: 'sleep', acc: 'sleep', arr: null, step: '选入睡时间' },
    meds: { t: '吃药', ico: 'meds', acc: 'meds', arr: 'meds', step: '选药名' },
    temp: { t: '体温', ico: 'temp', acc: 'temp', arr: 'temps', step: '选读数' },
    mood: { t: '心情', ico: 'mood', acc: 'mood', arr: 'moods', step: '选心情' },
    fetal: { t: '胎动 +1', ico: 'fetal', acc: 'fetal', arr: 'fetal', step: '' }
  };
  var ORDER = ['feed', 'breast', 'bottle', 'pump', 'pee', 'poop', 'diaper', 'sleep', 'meds', 'temp', 'mood', 'fetal'];
  /* 「＋」面板里沿用原来的元素 id（老测试、老习惯都认它们） */
  var QD_ID = { feed: 'qdFeed', pee: 'qdDiaper', poop: 'qdPoop', meds: 'qdMeds', fetal: 'qdFetal' };
  var BABY_ARR = { feedings: 1, diapers: 1, meds: 1, temps: 1 };
  var MED_PRESETS = ['维生素 D3', '维生素 AD', '益生菌', '铁剂'];
  var MOOD_TXT = { 5: '很好', 4: '不错', 3: '一般', 2: '有点低', 1: '很低落' };
  var DIA_TXT = { pee: '尿', poop: '便', both: '尿+便' };
  var GRIP = '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 8h14M5 12h14M5 16h14"/></svg>';
  var MORE = '<svg class="ico" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="6" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="18" cy="12" r="1.8"/></svg>';

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function loc(ms) { var d = new Date(ms); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); }
  function App() { return global.App || {}; }
  function rerender() { var A = App(); if (A.rerender) A.rerender(); }
  function stage(d) {
    var A = App();
    if (A.isDualStage && A.isDualStage(d)) return 'dual';
    return (A.stageOf && A.stageOf(d)) || 'baby';
  }
  function pregWeek(d) { var A = App(); return A.pregnancyWeekOf ? A.pregnancyWeekOf(d) : null; }
  function lastOf(arr, key, pred) {
    var best = null;
    (arr || []).forEach(function (r) { if (r && r[key] && (!pred || pred(r)) && (!best || String(r[key]) > String(best[key]))) best = r; });
    return best;
  }

  /* ---------- 清单 ---------- */
  function rawItems(d) {
    d = d || Storage.get();
    var q = d.settings && d.settings.quickItems;
    if (Array.isArray(q)) return q.filter(function (x) { return x && KIND[x.k]; }).slice(0, Storage.QUICK_MAX);
    return Storage.quickDefaults(d.feedMode, stage(d));
  }
  /** 此刻能用的快记（胎动只在孕期出现） */
  function items(d) {
    d = d || Storage.get();
    var wk = pregWeek(d);
    return rawItems(d).filter(function (x) { return x.k !== 'fetal' || wk !== null; });
  }
  function setItems(list) {
    var d = Storage.get();
    d.settings.quickItems = list.map(function (x) { return { k: x.k, m: x.m }; }).slice(0, Storage.QUICK_MAX);
    Storage.save();
    var A = App();
    if (A._dropTopCache) A._dropTopCache('home');
  }
  function modesOf(k) { return (Storage.QUICK_KINDS[k] || 't').split('').map(function (c) { return c === 't' ? 'tap' : 'step'; }); }

  /* ---------- 每一项此刻记成什么（标题 / 说明） ---------- */
  function breastNext(d) {
    var lb = lastOf(d.feedings, 'start', function (r) { return r.type === 'breast'; });
    var side = lb && lb.side === 'left' ? 'right' : 'left';
    var dur = (lb && (lb.durationMin || ((lb.durationL || 0) + (lb.durationR || 0)))) || 15;
    return { side: side, dur: Math.max(1, Math.min(90, dur)) };
  }
  function bottleNext(d) {
    var lb = lastOf(d.feedings, 'start', function (r) { return r.type === 'bottle' || r.type === 'formula'; });
    var t = lb ? lb.type : 'formula';
    var amt = (lb && Number(lb.amount)) || 90;
    return { type: t, amount: amt };
  }
  function pumpNext(d) {
    var lp = lastOf(d.feedings, 'start', function (r) { return r.type === 'pump'; });
    return { amount: (lp && Number(lp.amount)) || null, dur: (lp && lp.durationMin) || null };
  }
  function medNames(d) {
    var seen = {}, out = [];
    (d.meds || []).slice().sort(function (a, b) { return String(b.time).localeCompare(String(a.time)); }).forEach(function (r) {
      var n = r && typeof r.name === 'string' ? r.name.trim().slice(0, 20) : '';
      if (n && !seen[n] && out.length < 4) { seen[n] = 1; out.push(n); }
    });
    MED_PRESETS.forEach(function (n) { if (!seen[n] && out.length < 6) { seen[n] = 1; out.push(n); } });
    return out;
  }
  function info(it, d) {
    var K = KIND[it.k], step = it.m === 'step', o = { t: K.t, s: step ? K.step : '' };
    if (it.k === 'feed') { var fd = App()._fedDefaults ? App()._fedDefaults() : null; if (!step && fd) o.s = fd.label; }
    else if (it.k === 'breast' && !step) { var bn = breastNext(d); o.s = (bn.side === 'left' ? '左侧 ' : '右侧 ') + bn.dur + ' 分钟'; }
    else if (it.k === 'bottle' && !step) { var bt = bottleNext(d); o.s = (bt.type === 'formula' ? '配方奶 ' : '母乳 ') + bt.amount + ' ml'; }
    else if (it.k === 'pump' && !step) { var pn = pumpNext(d); o.s = pn.amount ? pn.amount + ' ml' : '记一次'; }
    else if (it.k === 'pee' && !step) o.s = '尿布 · 尿';
    else if (it.k === 'poop' && !step) o.s = '尿布 · 便';
    else if (it.k === 'sleep') {
      if (d.openSleep && d.openSleep.start) { o.t = '醒了'; o.s = step ? '选醒来时间' : '结束睡眠计时'; }
      else if (!step) o.s = '开始睡眠计时';
    } else if (it.k === 'meds') { o.t = medNames(d)[0] || '维生素 D3'; if (!step) o.s = '吃药 · 1 次'; else o.t = '吃药'; }
    else if (it.k === 'fetal') { var wk = pregWeek(d); o.s = wk !== null ? '孕 ' + wk + ' 周' : ''; }
    return o;
  }

  /* ---------- 记 ---------- */
  var flash = { k: null, t: 0 };
  function markDone(k) { flash = { k: k, t: Date.now() }; }
  function target(d) { return App()._recTarget ? App()._recTarget(d) : 'one'; }
  /** 写一条（或「都记」时每个宝宝各一条），提示带撤销 */
  function commit(arr, rec, msg, k) {
    var d = Storage.get();
    var DM = global.Modules && Modules.diaper;
    var undo;
    if (BABY_ARR[arr] && target(d) === 'all' && (d.babies || []).length >= 2) {
      var made = [];
      d.babies.forEach(function (bb) {
        var r = JSON.parse(JSON.stringify(rec)); r.id = Util.uid();
        if (arr === 'diapers' && DM && DM._autoUse) DM._autoUse(d, r);
        if (Storage.pushFor(bb.id, arr, r)) made.push([bb.id, r.id, r]);
      });
      msg += ' · ' + made.length + ' 个宝宝都记了';
      undo = function () {
        made.forEach(function (m) {
          if (m[2].used && DM && DM._applyUse) DM._applyUse(Storage.get(), DM._validUsed(Storage.get(), m[2].used), -1);
          Storage.removeFor(m[0], arr, m[1]);
        });
      };
    } else {
      if (arr === 'diapers' && DM && DM._autoUse) msg += DM._autoUse(d, rec);
      if (BABY_ARR[arr] && (d.babies || []).length >= 2) msg += ' · 记给' + Storage.babyLabel();
      if (!Array.isArray(d[arr])) d[arr] = [];
      d[arr].push(rec);
      undo = function () {
        var a = Storage.get()[arr] || [], gone = null;
        for (var i = a.length - 1; i >= 0; i--) if (a[i] && a[i].id === rec.id) { gone = a.splice(i, 1)[0]; break; }
        if (gone && gone.used && DM && DM._applyUse) DM._applyUse(Storage.get(), DM._validUsed(Storage.get(), gone.used), -1);
      };
    }
    markDone(k);
    if (Storage.save()) Util.toast(msg, 'ok', { label: '撤销', onClick: function () { undo(); Storage.save(); flash = { k: null, t: 0 }; rerender(); Util.toast('已撤销', 'ok'); } });
    rerender();
    return true;
  }
  function feedRec(type, at, o) {
    return { id: Util.uid(), type: type, start: loc(at), durationMin: o.dur || null, durationL: o.L || null, durationR: o.R || null,
      amount: o.amount || null, amountBm: o.bm || null, amountFm: o.fm || null, side: o.side || null, note: null };
  }
  var REC = {
    feed: function (at, o) {
      var fd = App()._fedDefaults(), f0 = fd.rec;
      if (!o) return commit('feedings', { id: Util.uid(), type: f0.type, start: loc(at), durationMin: f0.durationMin, amount: f0.amount,
        amountBm: f0.amountBm || null, amountFm: f0.amountFm || null, side: f0.side, note: null }, '已记录：' + fd.label, 'feed');
      if (o.type === 'breast') return REC.breast(at, o, 'feed');
      return REC.bottle(at, o, 'feed');
    },
    breast: function (at, o, k) {
      o = o || breastNext(Storage.get());
      var L = o.side === 'left' ? o.dur : o.side === 'both' ? Math.ceil(o.dur / 2) : null;
      var R = o.side === 'right' ? o.dur : o.side === 'both' ? Math.floor(o.dur / 2) : null;
      return commit('feedings', feedRec('breast', at, { dur: o.dur, L: L, R: R, side: o.side }),
        '已记录：亲喂 ' + ({ left: '左侧', right: '右侧', both: '双侧' }[o.side]) + ' ' + o.dur + ' 分钟', k || 'breast');
    },
    bottle: function (at, o, k) {
      o = o || bottleNext(Storage.get());
      var fm = o.type === 'formula';
      return commit('feedings', feedRec(o.type, at, { amount: o.amount, bm: fm ? null : o.amount, fm: fm ? o.amount : null }),
        '已记录：瓶喂 ' + (fm ? '配方奶 ' : '母乳 ') + o.amount + ' ml', k || 'bottle');
    },
    pump: function (at, o) {
      o = o || pumpNext(Storage.get());
      return commit('feedings', feedRec('pump', at, { amount: o.amount, dur: o.dur }), '已记录：吸奶' + (o.amount ? ' ' + o.amount + ' ml' : ''), 'pump');
    },
    pee: function (at) { return commit('diapers', { id: Util.uid(), type: 'pee', time: loc(at), note: null }, '已记录：尿布 · 尿', 'pee'); },
    poop: function (at) { return commit('diapers', { id: Util.uid(), type: 'poop', time: loc(at), note: null }, '已记录：尿布 · 便', 'poop'); },
    diaper: function (at, o) {
      var t = (o && o.type) || 'pee';
      return commit('diapers', { id: Util.uid(), type: t, time: loc(at), note: null }, '已记录：尿布 · ' + DIA_TXT[t], 'diaper');
    },
    meds: function (at, o) {
      var n = (o && o.name) || medNames(Storage.get())[0] || '维生素 D3';
      return commit('meds', { id: Util.uid(), name: n, time: loc(at), note: null }, '已记录：' + n, 'meds');
    },
    temp: function (at, o) {
      var d = Storage.get(), lt = lastOf(d.temps, 'time');
      var v = Math.round(o.value * 10) / 10;
      return commit('temps', { id: Util.uid(), time: loc(at), value: v, note: null, site: (lt && lt.site) || 'axillary' }, '已记录：体温 ' + v + ' °C', 'temp');
    },
    mood: function (at, o) {
      return commit('moods', { id: Util.uid(), time: loc(at), level: o.level, note: null, tags: [] }, '已记录：心情 · ' + MOOD_TXT[o.level], 'mood');
    },
    fetal: function (at) { return commit('fetal', { id: Util.uid(), time: loc(at) }, '已记录一次胎动', 'fetal'); },
    sleep: function (at) {
      var S = global.Modules && Modules.sleep, d = Storage.get();
      if (!S) return false;
      markDone('sleep');
      if (d.openSleep && d.openSleep.start) { S._end(at); rerender(); return true; }
      if (S._start(at)) {
        Util.toast('开始记录睡眠，醒了再点「醒了」', 'ok', { label: '撤销', onClick: function () {
          var dd = Storage.get(); dd.openSleep = null; Storage.save(); flash = { k: null, t: 0 }; rerender(); Util.toast('已撤销', 'ok');
        } });
      }
      rerender();
      return true;
    }
  };

  /* ---------- 弹出一步（半屏：点一个预设就记好） ---------- */
  var AGO = [[0, '刚刚'], [5, '5 分钟前'], [15, '15 分钟前'], [30, '30 分钟前'], [60, '1 小时前']];
  function chips(attr, list, cur, cls) {
    return '<div class="qs-chips' + (cls ? ' ' + cls : '') + '">' + list.map(function (x) {
      var on = cur != null && String(cur) === String(x[0]);
      return '<button type="button" class="qs-chip' + (on ? ' on' : '') + '" ' + attr + '="' + esc(x[0]) + '"' + (cur != null ? ' aria-pressed="' + on + '"' : '') + '>' + esc(x[1]) + '</button>';
    }).join('') + '</div>';
  }
  function openStep(k, opts) {
    opts = opts || {};
    var FT = global.FTUI;
    if (!FT || !KIND[k]) return null;
    var d = Storage.get(), K = KIND[k];
    var st = { ago: 0 };
    var title = k === 'sleep' && d.openSleep && d.openSleep.start ? '醒了' : (k === 'meds' ? '吃药' : K.t);
    var timeOnly = k === 'pee' || k === 'poop' || k === 'sleep';
    if (k === 'feed') { var fd = App()._fedDefaults ? App()._fedDefaults().rec : { type: 'breast' }; st.type = fd.type; st.side = breastNext(d).side; }
    if (k === 'breast') st.side = breastNext(d).side;
    if (k === 'bottle') st.type = bottleNext(d).type;
    if (k === 'temp') { var lt = lastOf(d.temps, 'time'); st.value = (lt && Number(lt.value)) || 36.8; }
    function body() {
      var h = '<div class="qs-body" data-qs="' + k + '">';
      var agoLbl = k === 'sleep' ? (d.openSleep && d.openSleep.start ? '什么时候醒的' : '什么时候睡着的') : '时间';
      h += '<p class="rs-lbl">' + agoLbl + '</p>' + chips('data-ago', AGO, timeOnly ? null : st.ago, timeOnly ? 'qs-go' : '');
      if (k === 'feed') h += '<p class="rs-lbl">类型</p>' + chips('data-ftype', [['breast', '亲喂'], ['bottle', '母乳瓶喂'], ['formula', '配方奶']], st.type);
      if (k === 'breast' || (k === 'feed' && st.type === 'breast')) {
        h += '<p class="rs-lbl">哪侧</p>' + chips('data-side', [['left', '左侧'], ['right', '右侧'], ['both', '双侧']], st.side);
        h += '<p class="rs-lbl">喂了多久</p>' + chips('data-dur', [[5, '5 分'], [10, '10 分'], [15, '15 分'], [20, '20 分'], [30, '30 分'], [40, '40 分']], null, 'qs-go');
      } else if (k === 'bottle' || k === 'feed') {
        if (k === 'bottle') h += '<p class="rs-lbl">奶</p>' + chips('data-ftype', [['bottle', '母乳'], ['formula', '配方奶']], st.type);
        h += '<p class="rs-lbl">奶量</p>' + chips('data-ml', [[60, '60 ml'], [90, '90 ml'], [120, '120 ml'], [150, '150 ml'], [180, '180 ml'], [210, '210 ml']], null, 'qs-go');
      } else if (k === 'pump') {
        h += '<p class="rs-lbl">吸了多少</p>' + chips('data-ml', [[30, '30 ml'], [60, '60 ml'], [90, '90 ml'], [120, '120 ml'], [150, '150 ml'], [180, '180 ml']], null, 'qs-go');
      } else if (k === 'diaper') {
        h += '<p class="rs-lbl">是什么</p>' + chips('data-dtype', [['pee', '尿'], ['poop', '便'], ['both', '尿+便']], null, 'qs-go qs-big');
      } else if (k === 'meds') {
        h += '<p class="rs-lbl">药名</p>' + chips('data-med', medNames(d).map(function (n) { return [n, n]; }), null, 'qs-go');
      } else if (k === 'mood') {
        h += '<p class="rs-lbl">现在的心情</p><div class="qs-chips qs-go qs-mood">' + [5, 4, 3, 2, 1].map(function (lv) {
          return '<button type="button" class="qs-chip" data-mood="' + lv + '">' + MOOD_TXT[lv] + '</button>';
        }).join('') + '</div>';
      } else if (k === 'temp') {
        h += '<p class="rs-lbl">读数</p><div class="qs-temp"><button type="button" class="qs-step" data-tstep="-1" aria-label="减 0.1 度">−</button>'
          + '<b class="qs-tval" aria-live="polite">' + st.value.toFixed(1) + '<i> °C</i></b><button type="button" class="qs-step" data-tstep="1" aria-label="加 0.1 度">+</button></div>'
          + chips('data-tv', [[36.5, '36.5'], [37, '37.0'], [37.5, '37.5'], [38, '38.0'], [38.5, '38.5'], [39, '39.0']], st.value);
        h += '<div class="rs-savebar"><button type="button" class="btn btn-primary rs-save" data-tsave>记录 ' + st.value.toFixed(1) + ' °C</button></div>';
      }
      return h + '</div>';
    }
    var api = FT.openSheet(K.acc, title, body(), function (a) {
      var box = a.box;
      function repaint() { var b = box.querySelector('.qs-body'); if (b) b.outerHTML = body(); }
      function at() { return Date.now() - st.ago * 60000; }
      function done(fn) { a.close(); fn(); if (opts.after) opts.after(); }
      box.addEventListener('click', function (e) {
        if (Util.hapEcho && Util.hapEcho(e)) return;
        var b = e.target.closest ? e.target.closest('button') : null;
        if (!b || !box.contains(b)) return;
        var v;
        if ((v = b.getAttribute('data-ago')) != null) {
          st.ago = +v;
          if (timeOnly) { done(function () { REC[k](at()); }); return; }
          repaint(); return;
        }
        if ((v = b.getAttribute('data-ftype')) != null) { st.type = v; repaint(); return; }
        if ((v = b.getAttribute('data-side')) != null) { st.side = v; repaint(); return; }
        if ((v = b.getAttribute('data-dur')) != null) { var o1 = { side: st.side, dur: +v }; done(function () { REC.breast(at(), o1, k); }); return; }
        if ((v = b.getAttribute('data-ml')) != null) {
          var ml = +v;
          if (k === 'pump') { done(function () { REC.pump(at(), { amount: ml }); }); return; }
          var o2 = { type: st.type === 'formula' ? 'formula' : 'bottle', amount: ml };
          done(function () { REC.bottle(at(), o2, k); }); return;
        }
        if ((v = b.getAttribute('data-dtype')) != null) { done(function () { REC.diaper(at(), { type: v }); }); return; }
        if ((v = b.getAttribute('data-med')) != null) { done(function () { REC.meds(at(), { name: v }); }); return; }
        if ((v = b.getAttribute('data-mood')) != null) { var lv = +v; done(function () { REC.mood(at(), { level: lv }); }); return; }
        if ((v = b.getAttribute('data-tstep')) != null) { st.value = Math.max(34, Math.min(42, Math.round((st.value + (+v) * 0.1) * 10) / 10)); repaint(); return; }
        if ((v = b.getAttribute('data-tv')) != null) { st.value = +v; repaint(); return; }
        if (b.hasAttribute('data-tsave')) { var tv = st.value; done(function () { REC.temp(at(), { value: tv }); }); }
      });
    });
    return api;
  }

  /** 点一格：点一下就记 → 直接记；弹出一步 → 开半屏 */
  function trigger(k, opts) {
    opts = opts || {};
    var d = Storage.get();
    var it = rawItems(d).filter(function (x) { return x.k === k; })[0] || { k: k, m: modesOf(k)[0] };
    if (!REC[k]) return false;
    if (opts.before) opts.before();
    if (it.m === 'step') return !!openStep(k, opts);
    REC[k](Date.now());
    if (opts.after) opts.after();
    return true;
  }

  /* ---------- 长按进编辑 ---------- */
  function longPress(el, fn) {
    var t = 0, sx = 0, sy = 0, fired = false;
    function clear() { if (t) { clearTimeout(t); t = 0; } }
    el.addEventListener('pointerdown', function (e) {
      if (e.button) return;
      fired = false; sx = e.clientX; sy = e.clientY; clear();
      t = setTimeout(function () { t = 0; fired = true; if (navigator.vibrate) { try { navigator.vibrate(8); } catch (e2) {} } fn(); }, 520);
    });
    el.addEventListener('pointermove', function (e) { if (t && (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10)) clear(); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (n) { el.addEventListener(n, clear); });
    el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    el.addEventListener('click', function (e) { if (fired) { fired = false; e.stopImmediatePropagation(); e.preventDefault(); } }, true);
  }

  /* ---------- 首页快记卡 ---------- */
  function cardHTML(d, o) {
    o = o || {};
    var list = items(d);
    var half = o.size === 's';
    var shown = half ? list.slice(0, 4) : list;
    var dis = o.editing ? ' disabled' : '';
    var h = '<div class="card canvas-card qk-card hn-quick-card' + (half ? ' qk-half' : '') + (o.cls || '') + '" data-cid="quick">';
    if (!shown.length) {
      h += '<button type="button" class="qk-empty" data-qk-edit' + dis + '>' + ic('plus') + '<span>添加快记</span></button>';
    } else {
      h += '<div class="qk-grid hn-quick qk-n' + shown.length + '" role="group" aria-label="快记，长按可以编辑">';
      var now = Date.now();
      shown.forEach(function (it) {
        var inf = info(it, d), on = flash.k === it.k && now - flash.t < 1600;
        h += '<button type="button" class="qk hn-q' + (on ? ' is-done' : '') + (it.m === 'step' ? ' is-step' : '') + '"' + dis
          + ' data-qk="' + it.k + '" data-accent="' + KIND[it.k].acc + '" aria-label="' + esc(inf.t + (inf.s ? '：' + inf.s : '')) + (it.m === 'step' ? '（弹出一步）' : '') + '">'
          + '<span class="qk-ico">' + ic(KIND[it.k].ico) + (on ? '<i class="qk-ok">' + ic('check') + '</i>' : '') + '</span>'
          + '<span class="qk-t">' + esc(inf.t) + '</span>'
          + (it.m === 'step' ? '<i class="qk-more" aria-hidden="true">' + MORE + '</i>' : '')
          + '</button>';
      });
      h += '</div>';
    }
    if (!o.editing && App()._tgtChips) h += App()._tgtChips(d, 'hn-tgt');
    return h + (o.badges || '') + '</div>';
  }
  function bindCard(root) {
    if (!root) return;
    var card = root.querySelector('.qk-card');
    if (!card) return;
    Array.prototype.forEach.call(card.querySelectorAll('[data-qk]'), function (b) {
      longPress(b, function () { openEditor(); });
      b.addEventListener('click', function (e) {
        if (Util.hapEcho && Util.hapEcho(e)) return;
        trigger(b.getAttribute('data-qk'));
      });
    });
    var ed = card.querySelector('[data-qk-edit]');
    if (ed) ed.addEventListener('click', function () { openEditor(); });
  }

  /* ---------- 「＋」面板 ---------- */
  function panelHTML(d) {
    var list = items(d);
    var h = '<div class="qd-grid">';
    list.forEach(function (it, i) {
      var inf = info(it, d);
      h += '<button type="button" class="qd-action' + (it.m === 'step' ? ' is-step' : '') + '" id="' + (QD_ID[it.k] || 'qd_' + it.k) + '" data-qk="' + it.k + '" data-accent="' + KIND[it.k].acc + '" style="--i:' + i + '">'
        + '<span class="qd-badge">' + ic(KIND[it.k].ico, 'qd-ico') + '</span>'
        + '<span class="qd-txt"><b>' + esc(inf.t) + '</b><small>' + esc(inf.s || ' ') + '</small></span>'
        + (it.m === 'step' ? '<i class="qk-more" aria-hidden="true">' + MORE + '</i>' : '') + '</button>';
    });
    h += '<button type="button" class="qd-action qd-edit" data-qk-edit style="--i:' + list.length + '"><span class="qd-badge">' + ic(list.length ? 'edit' : 'plus', 'qd-ico') + '</span>'
      + '<span class="qd-txt"><b>' + (list.length ? '编辑快记' : '添加快记') + '</b><small>排序、增删、方式</small></span></button>';
    return h + '</div>';
  }
  function bindPanel(list, close) {
    Array.prototype.forEach.call(list.querySelectorAll('[data-qk]'), function (b) {
      longPress(b, function () { close(); setTimeout(openEditor, 0); });
      b.addEventListener('click', function () { trigger(b.getAttribute('data-qk'), { before: close }); });
    });
    var ed = list.querySelector('[data-qk-edit]');
    if (ed) ed.addEventListener('click', function () { close(); setTimeout(openEditor, 0); });
  }

  /* ---------- 编辑（设置页里内嵌 / 长按打开的半屏，同一份） ---------- */
  function editorHTML() {
    var d = Storage.get(), list = rawItems(d), max = Storage.QUICK_MAX, full = list.length >= max;
    var h = '<ul class="qe-list" role="list" aria-label="我的快记，拖动右侧把手排序">';
    list.forEach(function (it, i) {
      var K = KIND[it.k], ms = modesOf(it.k);
      var name = it.k === 'meds' ? '吃药' : it.k === 'sleep' ? '睡了 / 醒了' : K.t;
      h += '<li class="qe-row" data-i="' + i + '" data-k="' + it.k + '" data-accent="' + K.acc + '">'
        + '<button type="button" class="qe-del" data-qe-del="' + i + '" aria-label="移除 ' + esc(name) + '"><i aria-hidden="true"></i></button>'
        + '<span class="qe-ico">' + ic(K.ico) + '</span>'
        + '<span class="qe-main"><b>' + esc(name) + '</b>'
        + (ms.length > 1
          ? '<span class="qe-mode" role="radiogroup" aria-label="' + esc(name) + '的方式">'
            + '<button type="button" role="radio" aria-checked="' + (it.m === 'tap') + '" class="' + (it.m === 'tap' ? 'on' : '') + '" data-qe-mode="' + i + ':tap">点一下就记</button>'
            + '<button type="button" role="radio" aria-checked="' + (it.m === 'step') + '" class="' + (it.m === 'step' ? 'on' : '') + '" data-qe-mode="' + i + ':step">弹出一步</button></span>'
          : '<small class="qe-only">' + (ms[0] === 'tap' ? '点一下就记' : '弹出一步') + '</small>')
        + '</span>'
        + '<button type="button" class="qe-grip" data-qe-grip="' + i + '" aria-label="拖动排序：' + esc(name) + '（也可以用上下方向键）">' + GRIP + '</button></li>';
    });
    h += '</ul>';
    if (!list.length) h += '<p class="qe-empty">还没有快记，从下面挑几个。</p>';
    var rest = ORDER.filter(function (k) { return !list.some(function (x) { return x.k === k; }); });
    if (rest.length) {
      h += '<p class="qe-sub">' + (full ? '最多 ' + max + ' 个，先移除一个再添加' : '添加') + '</p><div class="qe-add">';
      rest.forEach(function (k) {
        var K = KIND[k], name = k === 'meds' ? '吃药' : k === 'sleep' ? '睡了 / 醒了' : K.t;
        h += '<button type="button" class="qe-addb" data-qe-add="' + k + '" data-accent="' + K.acc + '"' + (full ? ' disabled' : '') + '>' + ic(K.ico) + '<span>' + esc(name) + '</span></button>';
      });
      h += '</div>';
    }
    h += '<p class="qe-note">首页快记卡和「＋」面板共用这一份。</p>';
    h += '<button type="button" class="qe-reset" data-qe-reset>恢复默认</button>';
    return h;
  }
  function mountEditor(el, onChange) {
    if (!el) return;
    function paint() { el.innerHTML = editorHTML(); }
    function changed(list, msg) { setItems(list); paint(); if (msg) Util.toast(msg, 'ok'); if (onChange) onChange(); }
    paint();
    el.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button') : null;
      if (!b || !el.contains(b) || b.disabled) return;
      var list = rawItems().slice(), v;
      if ((v = b.getAttribute('data-qe-del')) != null) { var gone = list.splice(+v, 1)[0]; changed(list, gone ? '已移除' : ''); return; }
      if ((v = b.getAttribute('data-qe-mode')) != null) {
        var p = v.split(':'), it = list[+p[0]];
        if (it && it.m !== p[1]) { list[+p[0]] = { k: it.k, m: p[1] }; changed(list); }
        return;
      }
      if ((v = b.getAttribute('data-qe-add')) != null) {
        if (list.length >= Storage.QUICK_MAX || list.some(function (x) { return x.k === v; })) return;
        list.push({ k: v, m: modesOf(v)[0] }); changed(list, '已添加'); return;
      }
      if (b.hasAttribute('data-qe-reset')) {
        var d = Storage.get(); d.settings.quickItems = null; Storage.save();
        if (App()._dropTopCache) App()._dropTopCache('home');
        paint(); Util.toast('已恢复默认快记', 'ok'); if (onChange) onChange();
      }
    });
    /* 键盘：把手上按上下方向键挪一格 */
    el.addEventListener('keydown', function (e) {
      var g = e.target.closest ? e.target.closest('[data-qe-grip]') : null;
      if (!g || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      e.preventDefault();
      var i = +g.getAttribute('data-qe-grip'), j = i + (e.key === 'ArrowUp' ? -1 : 1), list = rawItems().slice();
      if (j < 0 || j >= list.length) return;
      list.splice(j, 0, list.splice(i, 1)[0]);
      changed(list);
      var ng = el.querySelector('[data-qe-grip="' + j + '"]'); if (ng) ng.focus();
    });
    /* 拖动排序：按住把手上下拖，经过别的行时让位，松手落位 */
    el.addEventListener('pointerdown', function (e) {
      var g = e.target.closest ? e.target.closest('[data-qe-grip]') : null;
      if (!g || e.button) return;
      e.preventDefault();
      var row = g.closest('.qe-row'), ul = row.parentNode, rows = Array.prototype.slice.call(ul.children);
      var from = rows.indexOf(row), to = from;
      var rects = rows.map(function (r) { return r.getBoundingClientRect(); });
      var hgt = rects[from].height + (rows[1] ? (rects[1].top - rects[0].bottom) : 0);
      var y0 = e.clientY;
      try { g.setPointerCapture(e.pointerId); } catch (e1) {}
      row.classList.add('qe-drag'); ul.classList.add('qe-dragging');
      function move(ev) {
        var dy = ev.clientY - y0;
        var lo = rects[0].top - rects[from].top, hi = rects[rects.length - 1].top - rects[from].top;
        dy = Math.max(lo - 8, Math.min(hi + 8, dy));
        row.style.transform = 'translateY(' + dy + 'px)';
        var mid = rects[from].top + rects[from].height / 2 + dy;
        to = from;
        rects.forEach(function (r, i) {
          if (i < from && mid < r.top + r.height / 2) to = Math.min(to, i);
          if (i > from && mid > r.top + r.height / 2) to = Math.max(to, i);
        });
        rows.forEach(function (r, i) {
          if (i === from) return;
          var sh = (from < to && i > from && i <= to) ? -hgt : (from > to && i >= to && i < from) ? hgt : 0;
          r.style.transform = sh ? 'translateY(' + sh + 'px)' : '';
        });
      }
      function up() {
        g.removeEventListener('pointermove', move); g.removeEventListener('pointerup', up); g.removeEventListener('pointercancel', up);
        rows.forEach(function (r) { r.style.transform = ''; });
        row.classList.remove('qe-drag'); ul.classList.remove('qe-dragging');
        if (to !== from) {
          var list = rawItems().slice();
          list.splice(to, 0, list.splice(from, 1)[0]);
          changed(list);
        }
      }
      g.addEventListener('pointermove', move); g.addEventListener('pointerup', up); g.addEventListener('pointercancel', up);
    });
  }
  function openEditor() {
    var FT = global.FTUI;
    if (!FT) return null;
    return FT.openSheet('feeding', '我的快记', '<div class="qe-box qe-sheet"></div>', function (a) {
      mountEditor(a.box.querySelector('.qe-box'));
      var ok = a.box.querySelector('[data-ok]');
      if (ok) { ok.setAttribute('aria-label', '完成'); ok.addEventListener('click', a.close); }
      var prev = a.onClose;
      a.onClose = function () { if (prev) prev(); rerender(); };
    }, { keepOk: true });
  }

  global.QuickRec = {
    KIND: KIND, ORDER: ORDER,
    items: items, rawItems: rawItems, setItems: setItems, modesOf: modesOf, info: info,
    trigger: trigger, run: function (k, at, o) { return REC[k] ? REC[k](at || Date.now(), o) : false; },
    openStep: openStep, openEditor: openEditor, mountEditor: mountEditor,
    cardHTML: cardHTML, bindCard: bindCard, panelHTML: panelHTML, bindPanel: bindPanel,
    _flash: function () { return flash; }
  };
})(window);
