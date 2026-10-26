/**
 * modskel.js - 第 251 次：简单记录类模块的「新骨架」共用渲染器
 *
 * 尿布 / 喂养 / 睡眠是逐个手工迁到新骨架的（摘要句 → 今日看板 → 时间轴 → 底部主色大按钮 + 半屏面板）。
 * 剩下的记录类模块字段都很简单（时间 + 时长 / 数值 + 一两个选项 + 备注），
 * 逐个手写必然漂移，所以抽成一份：模块只给配置，页面结构、面板、时间轴、删除撤销都在这里。
 *
 * 用法：ModSkel.render(view, cfg)
 *   cfg.id / accent / noun（「洗澡」）/ listKey（d 上的数组名）/ icon
 *   cfg.care        true = 走 care.js 的会话计时（开始 → 迷你计时条 → 结束）
 *   cfg.fields      [{ k, t:'num', label, unit, min, max, quick:[..] } | { k, t:'text', label, max, quick:['..'] } | { k, t:'seg', label, opts:[{v,label}], def }]
 *   cfg.summary(ctx)  返回摘要句 HTML（数字由模块自己 escape；ctx 见下）
 *   cfg.ref         摘要下的一行安全提示（静态可信 HTML）
 *   cfg.title(r) / cfg.sub(r)  时间轴卡片的主 / 副文字（纯文本，这里统一 escape）
 *   cfg.bars        'count' | 'minutes'：近 7 天柱状图按次数还是分钟数
 *   cfg.empty       （第 253 次起不再显示，空状态统一为插画 + 一句话；保留字段兼容）
 *   cfg.onSaved(rec, editing)  可选：保存后的钩子
 *   cfg.dash(ctx)   可选：替换默认今日看板（返回 '' 不显示）；cfg.extra(ctx) 看板后追加的卡片
 *   cfg.validate(vals)  可选：跨字段校验，返回错误文案或 null；cfg.sheetHint 面板底部小字
 *   cfg.always(ctx) 可选：无论空不空都显示在底部的卡片（如情绪页紧急指引）；cfg.bind(view, ctx) 自定义事件
 *   cfg.rowCls(r)   可选：时间轴行附加类名（如体温高值 'tl-warn'）；cfg.foot 页面底部医学提示
 * 记录形状不变：{ id, time, <fields...>, note }，time 为本地 yyyy-mm-ddThh:mm:ss。
 */
(function (global) {
  'use strict';
  var Storage = global.Storage, Util = global.Util;

  function esc(s) { return Util.escapeHtml(s == null ? '' : String(s)); }
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  function tms(s) { var t = new Date(s).getTime(); return isFinite(t) ? t : NaN; }
  function locStr(ms) {
    var d = new Date(ms);
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + 'T' + p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds());
  }
  function hm(ms) { var d = new Date(ms); return p2(d.getHours()) + ':' + p2(d.getMinutes()); }
  function clock(ms) {
    var s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
    return (h ? h + ':' + p2(m) : p2(m)) + ':' + p2(s % 60);
  }
  function optLabel(f, v) {
    for (var i = 0; i < (f.opts || []).length; i++) if (f.opts[i].v === v) return f.opts[i].label;
    return '';
  }

  /* ---------- 半屏记录面板（新增 / 修改共用） ---------- */
  function openSheet(cfg, d, rec, dateIso) {
    var FT = global.FTUI;
    if (!FT) return;
    var editing = !!rec;
    var now = Util.nowLocal();
    var t0 = editing ? String(rec.time) : (dateIso ? dateIso + now.slice(10) : now);
    var st = {};
    cfg.fields.forEach(function (f) {
      st[f.k] = editing ? (rec[f.k] != null ? rec[f.k] : null) : (f.def != null ? f.def : null);
      if (f.t === 'multi') st[f.k] = Array.isArray(st[f.k]) ? st[f.k].slice() : [];
    });
    var body = FT.whenTiles('sk', '时间', t0.slice(0, 10), t0.slice(11, 16), now.slice(0, 10));
    cfg.fields.forEach(function (f) {
      if (f.t === 'num') {
        body += '<p class="rs-lbl">' + esc(f.label) + (f.optional === false ? '' : ' <span class="rs-lbl-n">可选</span>') + '</p>'
          + '<label class="rs-tile sk-num"><input type="number" id="sk_' + f.k + '" inputmode="' + (f.step ? 'decimal' : 'numeric') + '"'
          + ' min="' + f.min + '" max="' + f.max + '"' + (f.step ? ' step="' + f.step + '"' : '')
          + ' placeholder="' + esc(f.ph || '') + '" value="' + (st[f.k] != null ? esc(st[f.k]) : '') + '" aria-label="' + esc(f.label) + '">'
          + '<span>' + esc(f.unit || '') + '</span></label>';
        if (f.quick && f.quick.length) {
          body += '<div class="rs-pills sk-quick">';
          f.quick.forEach(function (q) {
            var qs = f.step ? Number(q).toFixed(1) : String(q);
            body += '<button type="button" class="dp-pill' + (st[f.k] != null && Number(st[f.k]) === Number(q) ? ' active' : '') + '" data-q="' + f.k + '" data-v="' + qs + '">' + esc(qs) + ' ' + esc(f.unit || '') + '</button>';
          });
          body += '</div>';
        }
      } else if (f.t === 'text') {
        /* 第 253 次：文字字段（药名、项目名…）+ 常用快选 */
        body += '<p class="rs-lbl">' + esc(f.label) + (f.optional === false ? '' : ' <span class="rs-lbl-n">可选</span>') + '</p>'
          + '<label class="rs-tile sk-num sk-text"><input type="text" id="sk_' + f.k + '" maxlength="' + (f.max || 30) + '"'
          + ' placeholder="' + esc(f.ph || '') + '" value="' + (st[f.k] != null ? esc(st[f.k]) : '') + '" aria-label="' + esc(f.label) + '"></label>';
        if (f.quick && f.quick.length) {
          body += '<div class="rs-pills sk-quick">';
          f.quick.forEach(function (q) {
            body += '<button type="button" class="dp-pill' + (st[f.k] === q ? ' active' : '') + '" data-q="' + f.k + '" data-v="' + esc(q) + '">' + esc(q) + '</button>';
          });
          body += '</div>';
        }
      } else if (f.t === 'multi') {
        /* 第 253 次：可多选标签（如情绪的「和什么有关」），存为数组 */
        body += '<p class="rs-lbl">' + esc(f.label) + ' <span class="rs-lbl-n">可多选</span></p><div class="rs-pills sk-multi" role="group" aria-label="' + esc(f.label) + '">';
        f.opts.forEach(function (o) {
          var on = st[f.k].indexOf(o.v) >= 0;
          body += '<button type="button" class="dp-pill' + (on ? ' active' : '') + '" data-multi="' + f.k + '" data-v="' + esc(o.v) + '" aria-pressed="' + on + '">' + esc(o.label) + '</button>';
        });
        body += '</div>';
      } else if (f.t === 'seg') {
        /* 选项数决定列数（类名供 CSS 死类名检查识别：'sk-n2' 'sk-n4' 'sk-n5'；3 列是 .rs-seg 默认） */
        body += '<p class="rs-lbl">' + esc(f.label) + '</p><div class="rs-seg sk-seg sk-n' + Math.min(5, f.opts.length) + '" role="radiogroup" aria-label="' + esc(f.label) + '">';
        f.opts.forEach(function (o) {
          var on = st[f.k] != null && String(st[f.k]) === String(o.v);
          body += '<button type="button" class="' + (on ? 'on' : '') + '" data-seg="' + f.k + '" data-v="' + esc(o.v) + '" role="radio" aria-checked="' + on + '">' + esc(o.label) + '</button>';
        });
        body += '</div>';
      }
    });
    if (cfg.sheetHint) body += '<p class="rs-hint sk-hint">' + esc(cfg.sheetHint) + '</p>';
    body += '<label class="rs-note"><span class="rs-lbl">备注</span><input type="text" id="skNote" maxlength="40" placeholder="' + esc(cfg.notePh || '可选') + '" value="' + esc((editing && rec.note) || '') + '"></label>'
      /* 第 272 次：保存吸在面板底部（.rs-savebar，全站记录面板同一写法）；编辑时删除放在保存条前面，跟着内容走 */
      + (editing ? '<button type="button" class="btn rs-del" data-delrec>删除这条记录</button>' : '')
      + '<div class="rs-savebar"><button type="button" class="btn btn-primary rs-save" data-ok>' + (editing ? '保存修改' : '保存') + '</button></div>';

    FT.openSheet(cfg.accent, (editing ? '修改' : '记录') + cfg.noun, body, function (api) {
      var box = api.box;
      box.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('button') : null;
        if (!b || !box.contains(b)) return;
        if (b.hasAttribute('data-ok')) { save(); return; }
        if (b.hasAttribute('data-delrec')) { api.close(); remove(cfg, d, rec.id); return; }
        var k;
        if ((k = b.getAttribute('data-q'))) {
          var inp = box.querySelector('#sk_' + k);
          /* 第 272 次（审计 #4）：快选赋值后派发 input，校验红字 / aria-invalid 跟着清掉 */
          if (inp) { inp.value = b.getAttribute('data-v'); try { inp.dispatchEvent(new Event('input', { bubbles: true })); } catch (eEv) { Util.markInvalid(inp, null); } }
          Array.prototype.forEach.call(box.querySelectorAll('[data-q="' + k + '"]'), function (x) { x.classList.toggle('active', x === b); });
          return;
        }
        if ((k = b.getAttribute('data-multi'))) {
          var mv = b.getAttribute('data-v'), at = st[k].indexOf(mv);
          if (at >= 0) st[k].splice(at, 1); else st[k].push(mv);
          b.classList.toggle('active', at < 0); b.setAttribute('aria-pressed', String(at < 0));
          return;
        }
        if ((k = b.getAttribute('data-seg'))) {
          st[k] = b.getAttribute('data-v');
          Array.prototype.forEach.call(box.querySelectorAll('[data-seg="' + k + '"]'), function (x) {
            var on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', String(on));
          });
        }
      });
      Array.prototype.forEach.call(box.querySelectorAll('.sk-num input'), function (inp) {
        inp.addEventListener('input', function () {
          var k = inp.id.slice(3);
          Array.prototype.forEach.call(box.querySelectorAll('[data-q="' + k + '"]'), function (x) { var v = x.getAttribute('data-v');
            x.classList.toggle('active', inp.value !== '' && (inp.type === 'text' ? v === inp.value.trim() : Number(v) === Number(inp.value))); });
        });
      });

      function save() {
        var when = FT.readWhen(box, 'sk');
        if (!isFinite(when)) { Util.toast('日期或时间不完整', 'warn'); return; }
        if (when > Date.now() + 60000) { Util.toast('这个时间还没到，请检查一下', 'warn'); return; }
        var vals = {};
        for (var i = 0; i < cfg.fields.length; i++) {
          var f = cfg.fields[i];
          if (f.t === 'num') {
            var el = box.querySelector('#sk_' + f.k);
            var raw = el ? String(el.value).trim() : '';
            if (raw === '') {
              if (f.optional === false) { if (el) Util.markInvalid(el, '先填一下' + f.label); return; }
              vals[f.k] = null; continue;
            }
            var n = f.step ? parseFloat(raw) : parseInt(raw, 10);
            if (f.step && isFinite(n)) n = Math.round(n * 10) / 10;
            if (!isFinite(n) || n < f.min || n > f.max) { Util.markInvalid(el, f.label + '填 ' + f.min + '–' + f.max + ' ' + (f.unit || '')); return; }
            vals[f.k] = n;
          } else if (f.t === 'text') {
            var te = box.querySelector('#sk_' + f.k);
            var tv = te ? String(te.value).trim().slice(0, f.max || 30) : '';
            if (!tv && f.optional === false) { if (te) Util.markInvalid(te, '先填一下' + f.label); return; }
            vals[f.k] = tv || null;
          } else if (f.t === 'multi') {
            vals[f.k] = st[f.k].slice();
          } else if (f.t === 'seg') {
            var sv = st[f.k] != null ? st[f.k] : f.def;
            if (sv == null && f.optional === false) { Util.toast('先选一下' + f.label, 'warn'); return; }
            var hit = null;
            f.opts.forEach(function (o) { if (sv != null && String(o.v) === String(sv)) hit = o.v; });
            vals[f.k] = hit;
          } else {
            vals[f.k] = st[f.k] != null ? st[f.k] : (f.def != null ? f.def : null);
          }
        }
        var bad = cfg.validate ? cfg.validate(vals) : null;
        if (bad) { Util.toast(bad, 'warn'); return; }
        var list = d[cfg.listKey] = d[cfg.listKey] || [];
        var r = editing ? rec : { id: Util.uid() };
        /* 改记录时，分钟不变就保留原来的秒，免得同一分钟内的先后顺序被打乱 */
        var stamp = locStr(when);
        r.time = (editing && String(rec.time).slice(0, 16) === stamp.slice(0, 16)) ? rec.time : (stamp.slice(0, 16) === now.slice(0, 16) ? now : stamp);
        Object.keys(vals).forEach(function (k) { r[k] = vals[k]; });
        r.note = (((box.querySelector('#skNote') || {}).value) || '').trim().slice(0, 40) || null;
        if (!editing) list.push(r);
        if (!Storage.save()) return;
        api.close();
        if (cfg.onSaved) cfg.onSaved(r, editing);
        global.App.rerender();
        if (!editing) Util.toast('已记录' + cfg.noun, 'ok', { label: '撤销', onClick: function () {
          for (var j = list.length - 1; j >= 0; j--) if (list[j].id === r.id) { list.splice(j, 1); break; }
          Storage.save(); global.App.rerender();
        } });
        else Util.toast('已保存', 'ok');
      }
    });
  }

  function remove(cfg, d, id) {
    Util.removeWithUndo(d[cfg.listKey], id, {
      onSave: function () { Storage.save(); },
      onAfter: function () { global.App.rerender(); },
      deletedText: '已删除' + cfg.noun + '记录'
    });
  }

  var ModSkel = {
    openSheet: openSheet,
    render: function (view, cfg) {
      var d = Storage.get();
      var Care = global.Care, FT = global.FTUI, DC = global.DayChart;
      var DS = Util.dayStartHour(d);
      var dayNow = Util.dayKeyOf(new Date(), DS);
      var backfill = (global.App && App.pendingDate) ? App.pendingDate : null;
      if (global.App) global.App.pendingDate = null;

      var all = (d[cfg.listKey] || []).filter(function (r) { return r && isFinite(tms(r.time)); })
        .slice().sort(function (a, b) { return tms(b.time) - tms(a.time); });
      var today = all.filter(function (r) { return Util.dayKeyOf(r.time, DS) === dayNow; });
      var minOf = function (r) { return (typeof r.minutes === 'number' && isFinite(r.minutes)) ? r.minutes : 0; };
      var ctx = {
        d: d, all: all, today: today, last: all[0] || null,
        todayMin: today.reduce(function (s, r) { return s + minOf(r); }, 0),
        ago: function (t) { return Util.fmtAgo ? Util.fmtAgo(t) : Util.fmtRowTime(t); }
      };
      var live = cfg.care && Care ? Care.mine(d, cfg.id) : null;
      var other = cfg.care && Care ? Care.other(d, cfg.id) : null;
      var html = '';

      /* 0. 空状态（第 253 次，对标 Cali）：页面上不填表，只放大插画 + 一句「点按底部 + 开始记录」，
         记录一律走底部按钮 → 半屏面板 / 计时页 */
      var isEmpty = !all.length && !live;
      if (isEmpty) {
        html += '<div class="sk-empty"><img src="assets/hero/' + esc(cfg.id) + '.webp" alt="" width="220" height="220" decoding="sync">'
          + '<p>' + (cfg.care ? '点按底部开始，或用 ⊕ 补记' : '点按底部 + 开始记录') + '</p>'
          + (cfg.foot && cfg.ref ? '<p class="sk-empty-ref">' + cfg.ref + '</p>' : '') + '</div>';
      }

      /* 1. 摘要句 + 安全提示 */
      if (!isEmpty) html += '<div class="mod-sum"><span class="ms-k">摘要</span><p>' + cfg.summary(ctx) + '</p>'
        + (cfg.ref ? '<p class="ms-ref">' + cfg.ref + '</p>' : '') + '</div>';

      /* 2. 今日看板 */
      if (isEmpty) { /* 空状态不出看板 */ }
      else if (cfg.dash) html += cfg.dash(ctx);
      else if (all.length && DC) {
        html += '<div class="card dash-card"><h2>今天</h2>';
        html += DC.strip({ win: DC.windowOf(dayNow, DS), ds: DS, now: Date.now(), label: '今天' + cfg.noun + '的时间',
          marks: today.map(function (r) { return { t: tms(r.time), cls: '', title: hm(tms(r.time)) + ' ' + cfg.noun }; }) });
        var bk = (cfg.bars && cfg.bars !== 'count') ? cfg.bars : null;
        var numOf = function (r) { return (typeof r[bk] === 'number' && isFinite(r[bk])) ? r[bk] : 0; };
        var d7 = DC.lastDays(dayNow, 7).map(function (k) {
          var rs = all.filter(function (r) { return Util.dayKeyOf(r.time, DS) === k; });
          var v = bk ? rs.reduce(function (s, r) { return s + numOf(r); }, 0) : rs.length;
          return { key: k, v: v, txt: String(v) };
        });
        if (d7.filter(function (x) { return x.v; }).length >= 2) {
          var bl = '近 7 天' + cfg.noun + (bk ? (cfg.barLabel || '分钟数') : '次数');
          html += '<p class="dash-sub">' + esc(bl) + '</p>' + DC.bars(d7, dayNow, bl);
        }
        html += '</div>';
      }
      if (cfg.extra && !isEmpty) html += cfg.extra(ctx);

      /* 3. 时间轴 */
      if (all.length) {
        var todayIso = Util.todayISO();
        html += '<section class="mod-tl ft-tl"><p class="ms-k">最近记录</p><ul class="tl">';
        all.slice(0, 30).forEach(function (r) {
          var t = tms(r.time), sub = cfg.sub ? cfg.sub(r) : (r.note || '');
          var lab = FT ? FT.dayLabel(t, todayIso) : ((new Date(t).getMonth() + 1) + '/' + new Date(t).getDate());
          html += '<li class="tl-row' + (cfg.rowCls && cfg.rowCls(r) ? ' ' + cfg.rowCls(r) : '') + '"><span class="tl-time ft-tlt"><small>' + esc(lab) + '</small>' + hm(t) + '</span><span class="tl-dot" aria-hidden="true"></span>'
            + '<button type="button" class="tl-card" data-open="' + esc(r.id) + '" aria-label="' + hm(t) + ' ' + esc(cfg.noun) + '，点按修改">'
            + '<span class="tl-ico">' + icon(cfg.icon) + '</span><span class="tl-txt"><b>' + esc(cfg.title(r)) + '</b>'
            + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span>'
            + '<span class="tl-more" aria-hidden="true">' + ((FT && FT.SV.more) || '') + '</span></button>'
            + '<button type="button" class="tl-del" data-del="' + esc(r.id) + '" aria-label="删除" title="删除">' + icon('trash') + '</button></li>';
        });
        html += '</ul></section>';
      }

      /* 4. 底部：计时中 → 迷你计时条；会话类 → 「开始 | ⊕」；其他 → 单个大按钮 */
      var SV = (FT && FT.SV) || {};
      if (live) {
        html += '<div class="mod-cta ft-cta"><div class="ft-mini" data-accent="' + cfg.accent + '">'
          + '<span class="ft-mini-open">' + icon(cfg.icon) + '<b data-sk-clock>' + clock(Care.elapsed(d, cfg.id)) + '</b></span>'
          + '<span class="ft-mini-side">' + esc(cfg.noun) + '中</span>'
          + '<button type="button" class="ft-mini-b" data-sk="cancel" aria-label="取消计时">' + icon('close') + '</button>'
          + '<button type="button" class="ft-mini-end" data-sk="end">结束</button></div></div>';
      } else if (cfg.care) {
        html += '<div class="mod-cta ft-cta"><div class="ft-split" data-accent="' + cfg.accent + '">'
          + '<button type="button" class="ft-split-main" data-sk="start">' + (SV.play || '') + '<span>开始' + esc(cfg.noun) + '</span></button>'
          + '<button type="button" class="ft-split-add" data-new aria-label="补记一次' + esc(cfg.noun) + '">' + (SV.plusc || icon('plus')) + '</button></div></div>';
      } else {
        html += '<div class="mod-cta"><button type="button" class="mc-main" data-new>' + icon('plus') + '<span>记录' + esc(cfg.noun) + '</span></button></div>';
      }

      if (cfg.always) html += cfg.always(ctx);
      if (cfg.foot && !isEmpty) html += '<p class="hint med-note">' + cfg.foot + '</p>';
      view.innerHTML = '<div class="ft-page skel-page" data-accent="' + cfg.accent + '">' + html + '</div>';

      /* 绑定 */
      var ck = view.querySelector('[data-sk-clock]');
      if (ck) {
        var timer = setInterval(function () {
          if (!view.contains(ck)) { clearInterval(timer); return; }
          ck.textContent = clock(Care.elapsed(d, cfg.id));
        }, 1000);
      }
      Array.prototype.forEach.call(view.querySelectorAll('[data-sk]'), function (b) {
        b.addEventListener('click', function () {
          var a = b.getAttribute('data-sk');
          if (a === 'start') {
            if (other) { Util.toast(Care.KINDS[other.kind].title + '还在计时，先去把它结束', 'warn'); return; }
            if (Care.start(d, Storage, cfg.id)) { Util.haptic && Util.haptic(); global.App.rerender(); }
          } else if (a === 'end') {
            var r = Care.finish(d, Storage, cfg.id);
            if (r && r.cancelled) Util.toast('计时数据异常，已取消', 'warn');
            else if (r) Util.toast('已记录' + cfg.noun + ' ' + r.minutes + ' 分钟', 'ok');
            global.App.rerender();
          } else if (a === 'cancel') {
            Care.cancel(d, Storage); Util.toast('已取消计时', 'ok'); global.App.rerender();
          }
        });
      });
      Array.prototype.forEach.call(view.querySelectorAll('[data-new]'), function (b) {
        b.addEventListener('click', function () { openSheet(cfg, d, null, null); });
      });
      Array.prototype.forEach.call(view.querySelectorAll('[data-open]'), function (b) {
        b.addEventListener('click', function () {
          var id = b.getAttribute('data-open');
          var it = (d[cfg.listKey] || []).filter(function (x) { return x.id === id; })[0];
          if (it) openSheet(cfg, d, it, null);
        });
      });
      Array.prototype.forEach.call(view.querySelectorAll('[data-del]'), function (b) {
        b.addEventListener('click', function () { remove(cfg, d, b.getAttribute('data-del')); });
      });
      if (cfg.bind) cfg.bind(view, ctx);
      if (backfill) setTimeout(function () { openSheet(cfg, d, null, backfill); }, 0);
    },
    _optLabel: optLabel
  };

  global.ModSkel = ModSkel;
})(window);
