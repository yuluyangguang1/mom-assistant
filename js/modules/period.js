/**
 * period.js - 经期记录（第 75 次 · C4+E 线重构：产后感知 + 参考窗口；第 287 次迁到新骨架）
 *
 * 红线（《经期健康研究》，与升级总纲一致）：
 * - 不做排卵期/安全期/受孕概率推断。
 * - 预测只做「参考窗口」：仅当近 3 个周期都在 24–38 天（FIGO/妇产科学9 常见范围）
 *   且波动 ≤9 天才显示，按近 3 周期中位数 ± 波动推算，永不给精确日期承诺。
 * - 产后场景感知（E1）：恶露观察期（0–6 周）→ 哺乳期等待 → 复潮预警（满 1 年）→ 首潮解读；
 *   异常信号（E4）一律中性转诊语言、一次性可关闭。
 * - 记录增强（E2）：flow（少/中/多）、pain（无/轻/中/重）可选字段，schema 只增不改。
 *
 * 第 287 次：新骨架——页头插画 → 摘要 → （阶段 / 异常提示横幅，最多各一条）→「周期」看板
 *   → 历史时间轴（点按修改、左滑删除）→ 底部固定「+ 记录经期」（进行中时「今天结束 | ⊕ 补记」）。
 *   记录 / 修改在半屏面板（开始 / 结束日期、经量、痛经、症状），页面上不填表。
 *   数据形状不变：d.periods = [{ id, start:'yyyy-mm-dd', end:'yyyy-mm-dd'|null, symptoms:[], flow, pain }]。
 *   经期是妈妈的记录（不在 BABY_KEYS），切换宝宝不影响。
 */
(function (global) {
  'use strict';
  var Storage = global.Storage, Util = global.Util, Knowledge = global.Knowledge;
  var Modules = global.Modules = global.Modules || {};

  var SYMPTOMS = ['腹痛', '头痛', '情绪波动', '胸胀', '腰酸', '其他'];
  var FLOWS = ['少', '中', '多'];
  var PAINS = ['无', '轻', '中', '重'];

  function esc(s) { return Util.escapeHtml(s == null ? '' : String(s)); }
  function day(x) { return String(x || '').slice(0, 10); }
  function validDay(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !isNaN(new Date(s + 'T12:00:00').getTime()); }
  function md(iso) { return iso ? (+iso.slice(5, 7)) + '月' + (+iso.slice(8, 10)) + '日' : ''; }
  function list(d) { if (!Array.isArray(d.periods)) d.periods = []; return d.periods; }

  /* 按 id 取 scope 'period' 的知识条目（异常静默 null，绝不影响渲染） */
  function perText(id) {
    try {
      var hit = Knowledge.all('period').filter(function (e) { return e.id === id; })[0];
      return hit ? hit.text : null;
    } catch (e) { return null; }
  }

  /* ---- E3 参考窗口。纯函数，_ 前缀导出供 qa。
     返回 {ok:true, med, from, to, pad} 或 {ok:false, reason}：'few' / 'out-of-range' / 'volatile'。 */
  function _predictWindow(periods) {
    var ps = (periods || []).filter(function (x) { return x && x.start; })
      .slice().sort(function (a, b) { return new Date(a.start) - new Date(b.start); });
    /* 第 278 次（审计 #32）：老数据里同一天开始的重复记录只算一次 */
    ps = ps.filter(function (x, i) { return i === 0 || String(x.start).slice(0, 10) !== String(ps[i - 1].start).slice(0, 10); });
    var gaps = [];
    for (var i = 1; i < ps.length; i++) gaps.push(Util.daysBetween(ps[i - 1].start, ps[i].start));
    if (gaps.length < 3) return { ok: false, reason: 'few' };
    var recent = gaps.slice(-3);
    var min = Math.min.apply(null, recent), max = Math.max.apply(null, recent);
    if (min < 24 || max > 38) return { ok: false, reason: 'out-of-range' };
    if (max - min > 9) return { ok: false, reason: 'volatile' };
    var med = recent.slice().sort(function (a, b) { return a - b; })[1];
    var last = ps[ps.length - 1].start;
    var pad = Math.max(1, Math.ceil((max - min) / 2));
    return { ok: true, med: med, pad: pad, from: Util.addDays(last, med - pad), to: Util.addDays(last, med + pad) };
  }

  /* ---- E4 异常信号中性提示。纯函数，_ 前缀导出供 qa。 */
  function _abnormalNotice(d, today) {
    var done = (d.periods || []).filter(function (x) { return x && x.start && x.end; })
      .slice().sort(function (a, b) { return new Date(b.start) - new Date(a.start); });
    if (done.length) {
      var len = Util.daysBetween(done[0].start, done[0].end) + 1;
      if (len > 8) {
        return { key: 'long', text: '你的记录显示最近一次经期持续了 ' + len + ' 天（超过 8 天）。建议下次就诊时带上这份记录与医生聊聊。' };
      }
    }
    var bd = d.settings.baby && d.settings.baby.birthDate;
    if (bd) {
      var dsb = Util.daysBetween(bd, today);
      if (dsb >= 0 && dsb <= 365) return null; /* 产后首年放宽 */
    }
    var ps = (d.periods || []).filter(function (x) { return x && x.start; })
      .slice().sort(function (a, b) { return new Date(a.start) - new Date(b.start); });
    if (ps.length >= 3) {
      var g = [];
      for (var i = 1; i < ps.length; i++) g.push(Util.daysBetween(ps[i - 1].start, ps[i].start));
      if (g.length >= 2) {
        var a = g[g.length - 2], b = g[g.length - 1];
        if (a < 21 && b < 21) return { key: 'freq', text: '你的记录显示最近两个周期间隔都短于 21 天。建议下次就诊时带上这份记录与医生聊聊。' };
        if (a > 38 && b > 38) return { key: 'sparse', text: '你的记录显示最近两个周期间隔都超过 38 天（非哺乳期）。建议下次就诊时带上这份记录与医生聊聊。' };
      }
    }
    return null;
  }

  /* 进行中的经期：没有结束日期、开始不晚于今天（取最近一条） */
  function ongoingOf(d, today) {
    return list(d).filter(function (x) { return x && validDay(day(x.start)) && !x.end && day(x.start) <= today; })
      .sort(function (a, b) { return day(b.start) < day(a.start) ? -1 : 1; })[0] || null;
  }
  function lenOf(r) { return (r && r.end && validDay(day(r.end))) ? Util.daysBetween(day(r.start), day(r.end)) + 1 : null; }
  function detailOf(r) {
    var parts = [];
    if (r.flow && FLOWS.indexOf(r.flow) >= 0) parts.push('经量' + r.flow);
    if (r.pain && r.pain !== '无' && PAINS.indexOf(r.pain) >= 0) parts.push('痛经' + r.pain);
    if (Array.isArray(r.symptoms) && r.symptoms.length) parts.push(r.symptoms.map(String).join('、'));
    return parts.join(' · ');
  }

  /* 阶段说明：最多一条（孕期 > 恶露观察期 > 满 1 年复潮确认 > 哺乳期等待 > 复潮后 90 天） */
  function stageNote(d, today) {
    var bd = (d.settings.baby && d.settings.baby.birthDate) || null;
    var dsb = bd ? Util.daysBetween(bd, today) : null;
    var post = bd ? list(d).filter(function (x) { return x && x.start && Util.daysBetween(bd, x.start) >= 0; }) : [];
    var wk = (global.App && typeof App.pregnancyWeekOf === 'function') ? App.pregnancyWeekOf(d) : null;
    var t = function (id) { return perText(id) || ''; };
    if (wk !== null) return { title: '孕 ' + wk + ' 周', text: '孕期一般不会来月经。如果出现阴道出血，请及时联系产检医生。' };
    if (dsb !== null && dsb >= 0 && dsb <= 42) return { title: '产后第 ' + (dsb + 1) + ' 天', text: [t('KN-PER-1'), t('KN-PER-2')].filter(Boolean).join('') };
    if (dsb !== null && dsb > 365 && !post.length && !d.settings.periodRelactDismissed) {
      return { title: '复潮确认', text: '产后满 1 年还没有来月经（如仍在哺乳）：多数情况下仍在正常范围边缘，建议就诊确认激素与子宫恢复情况。', dismiss: 'relact' };
    }
    if (dsb !== null && dsb > 42 && dsb <= 365 && !post.length) return { title: '哺乳期与月经', text: [t('KN-PER-4'), t('KN-PER-5')].filter(Boolean).join('') };
    if (dsb !== null && post.length) {
      var first = post.slice().sort(function (a, b) { return new Date(a.start) - new Date(b.start); })[0];
      if (Util.daysBetween(first.start, today) <= 90 && t('KN-PER-3')) return { title: '复潮了', text: t('KN-PER-3') };
    }
    return null;
  }

  /* 和已有记录的冲突（编辑时排除自己）：返回 { el:'start'|'end', msg } 或 null */
  function conflict(d, nS, nE0, selfId, today) {
    var nE = nE0 || today;
    if (nE < nS) nE = nS;
    var others = list(d).filter(function (x) { return x && x.start && x.id !== selfId; });
    var open = others.filter(function (x) { return !x.end && day(x.start) <= nS; })
      .sort(function (a, b) { return day(b.start) < day(a.start) ? -1 : 1; })[0];
    if (open) return { el: 'start', msg: md(day(open.start)) + ' 开始的经期还没结束，请先结束它' };
    var clash = others.filter(function (x) {
      var s0 = day(x.start), e0 = day(x.end) || today;
      if (e0 < s0) e0 = s0;
      return nS <= e0 && s0 <= nE;
    })[0];
    if (clash) return { el: nE0 ? 'end' : 'start', msg: '和 ' + md(day(clash.start)) + (clash.end ? '–' + md(day(clash.end)) : ' 开始（未结束）') + ' 那次经期重叠' };
    return null;
  }

  /* ---------- 半屏面板：记录 / 修改 ---------- */
  var openAt = 0;
  function openSheet(d, rec) {
    var FT = global.FTUI;
    if (!FT) return;
    if (Date.now() - openAt < 450) return; /* 第 281 次同款：手指连点不开两个 */
    openAt = Date.now();
    var editing = !!rec, today = Util.todayISO();
    var newId = editing ? rec.id : Util.uid();
    var st = {
      flow: editing && FLOWS.indexOf(rec.flow) >= 0 ? rec.flow : null,
      pain: editing && PAINS.indexOf(rec.pain) >= 0 ? rec.pain : null,
      sym: editing && Array.isArray(rec.symptoms) ? rec.symptoms.slice() : []
    };
    var s0 = editing && validDay(day(rec.start)) ? day(rec.start) : today;
    var e0 = editing && rec.end && validDay(day(rec.end)) ? day(rec.end) : '';
    var CAL = (FT.SV && FT.SV.cal) || '';
    var body = '<p class="rs-lbl">日期</p><div class="rs-when ft-when pd-when">'
      + '<label class="rs-tile ft-tile"><span class="ft-ti">' + CAL + '</span><span class="ft-tt"><small>开始</small>'
      + '<b data-show="pdS"></b><input type="date" class="ft-hid" id="pdS" value="' + s0 + '" max="' + today + '" aria-label="开始日期"></span></label>'
      + '<label class="rs-tile ft-tile"><span class="ft-ti">' + CAL + '</span><span class="ft-tt"><small>结束</small>'
      + '<b data-pd-end></b><input type="date" class="ft-hid" id="pdE" value="' + e0 + '" max="' + today + '" aria-label="结束日期"></span></label></div>'
      + '<div class="rs-pills pd-endq"><button type="button" class="dp-pill" data-pdq="open" aria-pressed="false">还没结束</button>'
      + '<button type="button" class="dp-pill" data-pdq="today" aria-pressed="false">今天结束</button></div>'
      + '<p class="rs-lbl">经量 <span class="rs-lbl-n">可选</span></p>' + seg('flow', FLOWS, st.flow, 'sk-seg')
      + '<p class="rs-lbl">痛经 <span class="rs-lbl-n">可选</span></p>' + seg('pain', PAINS, st.pain, 'sk-seg sk-n4')
      + '<p class="rs-lbl">症状 <span class="rs-lbl-n">可多选</span></p><div class="rs-pills sk-multi" role="group" aria-label="症状">';
    SYMPTOMS.forEach(function (s) {
      var on = st.sym.indexOf(s) >= 0;
      body += '<button type="button" class="dp-pill' + (on ? ' active' : '') + '" data-pdsym="' + esc(s) + '" aria-pressed="' + on + '">' + esc(s) + '</button>';
    });
    body += '</div>'
      + (editing ? '<button type="button" class="btn rs-del" data-pddel>删除这条记录</button>' : '')
      + '<div class="rs-savebar"><button type="button" class="btn btn-primary rs-save" id="pdSave">' + (editing ? '保存修改' : '保存') + '</button></div>';

    FT.openSheet('period', editing ? '修改经期' : '记录经期', body, function (api) {
      var box = api.box, closed = false, saving = false;
      api.onClose = (function (prev) { return function () { closed = true; if (prev) prev.apply(this, arguments); }; })(api.onClose);
      var si = box.querySelector('#pdS'), ei = box.querySelector('#pdE'), eb = box.querySelector('[data-pd-end]');
      if (si && si._paint) si._paint();
      function paintEnd() {
        eb.textContent = ei.value ? (ei.value === today ? '今天' : md(ei.value)) : '未结束';
        Array.prototype.forEach.call(box.querySelectorAll('[data-pdq]'), function (b) {
          var on = b.getAttribute('data-pdq') === 'open' ? !ei.value : ei.value === today;
          b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on));
        });
        if (si.value) ei.min = si.value;
      }
      ei.addEventListener('input', paintEnd); ei.addEventListener('change', paintEnd);
      si.addEventListener('change', paintEnd);
      paintEnd();
      box.addEventListener('click', function (e) {
        if (closed || (Util.hapEcho && Util.hapEcho(e))) return;
        var b = e.target.closest ? e.target.closest('button') : null;
        if (!b || !box.contains(b)) return;
        if (b.id === 'pdSave' || b.hasAttribute('data-ok')) { save(); return; }
        if (b.hasAttribute('data-pddel')) { closed = true; api.close(); remove(d, rec.id); return; }
        var k;
        if ((k = b.getAttribute('data-pdq'))) {
          ei.value = k === 'today' ? today : '';
          paintEnd(); return;
        }
        if ((k = b.getAttribute('data-pdseg'))) {
          var v = b.getAttribute('data-v');
          st[k] = st[k] === v ? null : v; /* 再点一次取消 */
          Array.prototype.forEach.call(box.querySelectorAll('[data-pdseg="' + k + '"]'), function (x) {
            var on = x.getAttribute('data-v') === st[k]; x.classList.toggle('on', on); x.setAttribute('aria-checked', String(on));
          });
          return;
        }
        if ((k = b.getAttribute('data-pdsym'))) {
          var at = st.sym.indexOf(k);
          if (at >= 0) st.sym.splice(at, 1); else st.sym.push(k);
          b.classList.toggle('active', at < 0); b.setAttribute('aria-pressed', String(at < 0));
        }
      });
      /* 日期框是透明铺满的隐藏输入，不能 focus（iOS 会弹选择器）：错误写在日期行下面一行 + 提示条 */
      function err(msg) {
        var el = box.querySelector('.pd-err');
        if (!msg) { if (el) el.remove(); return; }
        if (!el) { el = document.createElement('small'); el.className = 'field-error pd-err'; el.setAttribute('role', 'alert'); box.querySelector('.pd-endq').insertAdjacentElement('afterend', el); }
        el.textContent = msg;
        Util.toast(msg, 'warn');
      }
      function save() {
        if (saving || closed) return;
        var t = Util.todayISO();
        var s = si.value, en = ei.value || '';
        if (!validDay(s)) { err('请填写开始日期'); return; }
        if (s > t) { err('开始日期还没到，请检查一下'); return; }
        if (en && !validDay(en)) { err('结束日期不完整'); return; }
        if (en && en > t) { err('结束日期还没到，请检查一下'); return; }
        if (en && en < s) { err('结束日期不能早于开始日期'); return; }
        var c = conflict(d, s, en, newId, t);
        if (c) { err(c.msg); return; }
        err(null);
        saving = true;
        var arr = list(d), r = null;
        for (var i = 0; i < arr.length; i++) if (arr[i] && arr[i].id === newId) { r = arr[i]; break; }
        var isNew = !r;
        if (isNew) { r = { id: newId }; arr.push(r); }
        r.start = s; r.end = en || null; r.symptoms = SYMPTOMS.filter(function (x) { return st.sym.indexOf(x) >= 0; });
        r.flow = st.flow; r.pain = st.pain;
        if (!Storage.save()) { saving = false; return; }
        closed = true; api.close();
        global.App.rerender();
        if (isNew) Util.toast('已记录经期：' + md(s), 'ok', { label: '撤销', onClick: function () {
          for (var j = arr.length - 1; j >= 0; j--) if (arr[j] && arr[j].id === newId) { arr.splice(j, 1); break; }
          Storage.save(); global.App.rerender();
        } });
        else Util.toast('已保存', 'ok');
      }
    });
  }
  function seg(key, opts, cur, cls) {
    var h = '<div class="rs-seg ' + cls + '" role="radiogroup" aria-label="' + (key === 'flow' ? '经量' : '痛经') + '">';
    opts.forEach(function (o) {
      var on = cur === o;
      h += '<button type="button" class="' + (on ? 'on' : '') + '" data-pdseg="' + key + '" data-v="' + o + '" role="radio" aria-checked="' + on + '">' + o + '</button>';
    });
    return h + '</div>';
  }

  function remove(d, id) {
    Util.removeWithUndo(list(d), id, {
      onSave: function () { Storage.save(); },
      onAfter: function () { global.App.rerender(); },
      deletedText: '已删除经期记录'
    });
  }

  /* 今天结束：只对还没结束的那条生效，连点 / 回声只写一次 */
  function endToday(d) {
    var today = Util.todayISO(), og = ongoingOf(d, today);
    if (!og || og.end) return;
    og.end = today;
    var n = Util.daysBetween(day(og.start), today) + 1;
    if (Storage.save()) Util.toast('已记录经期结束，共 ' + n + ' 天', 'ok', { label: '撤销', onClick: function () {
      og.end = null; Storage.save(); global.App.rerender();
    } });
    global.App.rerender();
  }

  Modules.period = {
    id: 'period',
    title: '经期',
    render: function (view) {
      var d = Storage.get();
      var FT = global.FTUI;
      var today = Util.todayISO();
      var all = list(d).filter(function (r) { return r && validDay(day(r.start)); })
        .slice().sort(function (a, b) { return day(a.start) < day(b.start) ? 1 : day(a.start) > day(b.start) ? -1 : 0; });
      var og = ongoingOf(d, today);
      var pw = _predictWindow(all);
      var html = '';

      if (!all.length) {
        html += '<div class="sk-empty"><img src="assets/hero/period.webp" alt="" width="220" height="220" decoding="sync">'
          + '<p>点按底部 + 开始记录</p></div>';
      } else {
        /* 1. 摘要 */
        var last = all[0], s;
        if (og) s = '经期第 <b>' + (Util.daysBetween(day(og.start), today) + 1) + ' 天</b>，<b>' + esc(md(day(og.start))) + '</b>开始。';
        else s = '上次 <b>' + esc(md(day(last.start))) + '</b> 开始' + (lenOf(last) ? '，持续 <b>' + lenOf(last) + ' 天</b>' : '') + '。';
        if (pw.ok) s += '下次参考 <b>' + esc(md(pw.from)) + '–' + esc(md(pw.to)) + '</b>。';
        html += '<div class="mod-sum"><span class="ms-k">摘要</span><p>' + s + '</p>'
          + '<p class="ms-ref">仅供参考，请勿据此避孕或判断健康；异常出血或不适请咨询医生。</p></div>';
      }

      /* 2. 提示横幅：阶段说明（最多一条）+ 异常信号（一次性） */
      var sn = stageNote(d, today);
      if (sn && sn.text) html += '<div class="mod-note" data-accent="period"><p><b>' + esc(sn.title) + '</b>' + esc(sn.text) + '</p>'
        + (sn.dismiss ? '<button type="button" class="btn-mini" data-pd="relact">知道了</button>' : '') + '</div>';
      var e4 = _abnormalNotice(d, today);
      if (e4 && d.settings.periodE4Seen !== e4.key) html += '<div class="mod-note" data-accent="period"><p>' + esc(e4.text) + '</p>'
        + '<button type="button" class="btn-mini" data-pd="e4">知道了</button></div>';

      if (all.length) {
        /* 3. 周期看板：周期（近 3 次中位）· 经期（平均）· 已记次数；参考窗口一行 */
        var asc = all.slice().reverse().filter(function (x, i, a) { return i === 0 || day(x.start) !== day(a[i - 1].start); });
        var gaps = [];
        for (var i = 1; i < asc.length; i++) gaps.push(Util.daysBetween(day(asc[i - 1].start), day(asc[i].start)));
        var rg = gaps.slice(-3).sort(function (a, b) { return a - b; });
        var cyc = rg.length ? rg[Math.floor((rg.length - 1) / 2)] : null;
        var lens = all.map(lenOf).filter(function (x) { return x != null && x > 0; });
        var avgLen = lens.length ? Math.round(lens.reduce(function (a, b) { return a + b; }, 0) / lens.length * 10) / 10 : null;
        html += '<div class="card dash-card pd-dash"><h2>周期</h2><div class="mod-stats">'
          + '<p><small>周期中位</small><b>' + (cyc != null ? cyc + '<i>天</i>' : '—') + '</b></p>'
          + '<p><small>经期平均</small><b>' + (avgLen != null ? avgLen + '<i>天</i>' : '—') + '</b></p></div>'
          + '<p class="dash-sub pd-pred">' + (pw.ok
            ? '参考窗口按近 3 个周期推算'
            : (pw.reason === 'few' ? '记满 3 个周期后显示参考窗口' : pw.reason === 'out-of-range' ? '近 3 个周期不在 24–38 天，暂不推算参考窗口' : '近 3 个周期相差超过 9 天，暂不推算参考窗口'))
          + '</p><div class="fin-acts"><button type="button" class="btn-mini" data-pd="clear">清空</button></div></div>';

        /* 4. 历史时间轴 */
        html += '<section class="mod-tl ft-tl"><p class="ms-k">历史记录</p><ul class="tl">';
        all.slice(0, 60).forEach(function (r) {
          var sd = day(r.start), ln = lenOf(r), det = detailOf(r), isOg = og && r.id === og.id;
          var title = (sd.slice(0, 4) !== today.slice(0, 4) ? sd.slice(0, 4) + '年' : '') + md(sd) + (r.end && validDay(day(r.end)) && day(r.end) !== sd ? '–' + md(day(r.end)) : '');
          html += '<li class="tl-row' + (isOg ? ' tl-live' : '') + '"><span class="tl-time ft-tlt">' + (+sd.slice(5, 7)) + '/' + (+sd.slice(8, 10)) + '</span><span class="tl-dot" aria-hidden="true"></span>'
            + '<button type="button" class="tl-card" data-pdopen="' + esc(r.id) + '" aria-label="' + esc(title + (ln ? ' ' + ln + ' 天' : '') + '，点按修改') + '">'
            + '<span class="tl-ico">' + icon('period') + '</span><span class="tl-txt"><b>' + esc(title) + '</b>'
            + (det ? '<small>' + esc(det) + '</small>' : '') + '</span>'
            + '<span class="li-num">' + (isOg ? '进行中' : (ln ? ln + ' 天' : '')) + '</span>'
            + '<span class="tl-more" aria-hidden="true">' + ((FT && FT.SV && FT.SV.more) || '') + '</span></button>'
            + '<button type="button" class="tl-del" data-del="' + esc(r.id) + '" aria-label="删除" title="删除">' + icon('trash') + '</button></li>';
        });
        html += '</ul></section>';
      }

      /* 5. 底部：进行中 → 「今天结束 | ⊕ 补记」；否则「+ 记录经期」 */
      var SV = (FT && FT.SV) || {};
      if (og) html += '<div class="mod-cta ft-cta"><div class="ft-split" data-accent="period">'
        + '<button type="button" class="ft-split-main" data-pd="end">' + icon('check') + '<span>今天结束</span></button>'
        + '<button type="button" class="ft-split-add" data-pd="new" aria-label="补记一次经期">' + (SV.plusc || icon('plus')) + '</button></div></div>';
      else html += '<div class="mod-cta"><button type="button" class="mc-main" data-pd="new">' + icon('plus') + '<span>记录经期</span></button></div>';

      view.innerHTML = '<div class="ft-page skel-page pd-page" data-accent="period">' + html + '</div>';

      var page = view.firstChild, lock = 0;
      page.addEventListener('click', function (e) {
        if (Util.hapEcho && Util.hapEcho(e)) return;
        var b = e.target.closest ? e.target.closest('button') : null;
        if (!b || !page.contains(b)) return;
        var a = b.getAttribute('data-pd'), id;
        if (a === 'new') { openSheet(d, null); return; }
        if ((id = b.getAttribute('data-pdopen'))) {
          var it = list(d).filter(function (x) { return x && x.id === id; })[0];
          if (it) openSheet(d, it);
          return;
        }
        if ((id = b.getAttribute('data-del'))) {
          if (e.isTrusted && Date.now() - lock < 500) return;
          lock = Date.now(); remove(d, id); return;
        }
        if (a === 'end') { endToday(d); return; }
        if (a === 'relact') { d.settings.periodRelactDismissed = true; Storage.save(); global.App.rerender(); return; }
        if (a === 'e4') { if (e4) d.settings.periodE4Seen = e4.key; Storage.save(); global.App.rerender(); return; }
        if (a === 'clear') {
          /* U-33：不可逆批量操作走阻断路径——后果说明 + 立即导出口 + 防误触 */
          Util.confirm({
            title: '清空全部经期记录',
            message: '将删除本机保存的全部经期记录，此操作不可恢复。',
            okText: '仍要清空',
            danger: true,
            extra: { text: '先导出备份', onClick: function () { global.App.exportAll(); } },
            onConfirm: function () { d.periods = []; Storage.save(); global.App.rerender(); }
          });
        }
      });
    },
    /* 日期页 / 其它入口：修改、删除走这里的面板与撤销 */
    _open: function (rec) { openSheet(Storage.get(), rec || null); },
    _remove: function (id) { remove(Storage.get(), id); },
    _endToday: function () { endToday(Storage.get()); },
    /* 纯函数导出（qa 用） */
    _predictWindow: _predictWindow,
    _abnormalNotice: _abnormalNotice
  };
})(window);
