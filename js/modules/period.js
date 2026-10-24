/**
 * period.js - 经期记录（第 75 次 · C4+E 线重构：产后感知 + 参考窗口）
 *
 * 红线（《经期健康研究》，与升级总纲一致）：
 * - 不做排卵期/安全期/受孕概率推断（旧版显示「排卵日/易孕期」，会诱导避孕误用——本轮移除）。
 * - 预测只做「参考窗口」：仅当近 3 个周期都在 24–38 天（FIGO/妇产科学9 常见范围）
 *   且波动 ≤9 天才显示，按近 3 周期中位数 ± 波动推算，永不给精确日期承诺。
 * - 产后场景感知（E1）：恶露观察期（0–6 周）→ 哺乳期等待（知识句）→ 复潮预警（满 1 年）
 *   → 首潮解读；异常信号（E4）一律中性转诊语言、一次性可关闭。
 * - 记录增强（E2）：flow（少/中/多）、pain（无/轻/中/重）可选字段，schema 只增不改。
 */
(function (global) {
  'use strict';
  var Storage = global.Storage, Util = global.Util, Knowledge = global.Knowledge;
  var Modules = global.Modules = global.Modules || {};

  var SYMPTOMS = ['腹痛', '头痛', '情绪波动', '胸胀', '腰酸', '其他'];
  var FLOWS = ['少', '中', '多'];
  var PAINS = ['无', '轻', '中', '重'];

  /* 按 id 取 scope 'period' 的知识条目（异常静默 null，绝不影响渲染） */
  function perText(id) {
    try {
      var hit = Knowledge.all('period').filter(function (e) { return e.id === id; })[0];
      return hit ? hit.text : null;
    } catch (e) { return null; }
  }

  /* ---- E3 参考窗口（原 C4 · 产后感知版）。纯函数，_ 前缀导出供 qa。
     返回 {ok:true, med, from, to, pad} 或 {ok:false, reason}：
     reason: 'few' 记录不足（<3 个周期间隔） / 'out-of-range' 近 3 周期不在 24–38 / 'volatile' 波动 >9 天。
     永不推断排卵/易孕（红线）。 */
  function _predictWindow(periods) {
    var ps = (periods || []).filter(function (x) { return x.start; })
      .slice().sort(function (a, b) { return new Date(a.start) - new Date(b.start); });
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

  /* ---- E4 异常信号中性提示。纯函数，_ 前缀导出供 qa。
     硬信号（任何阶段）：最近一次经期 >8 天（FIGO 经期时长就医线）。
     周期频率规则（<21 连续 2 次 / >38 连续 2 次）只在非产后首年启用——
     哺乳期不规律属常见现象，首年只保留硬信号，避免误报制造焦虑。 */
  function _abnormalNotice(d, today) {
    var done = (d.periods || []).filter(function (x) { return x.start && x.end; })
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
    var ps = (d.periods || []).filter(function (x) { return x.start; })
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

  /* seg 单选组（复用 sleep 夜醒的 .seg/.seg-btn 视觉语言，默认无选中） */
  function segHtml(id, options, attr) {
    return '<div class="seg" id="' + id + '">' + options.map(function (o) {
      return '<button type="button" class="seg-btn" ' + attr + '="' + o + '">' + o + '</button>';
    }).join('') + '</div>';
  }

  Modules.period = {
    id: 'period',
    title: '经期',
    render: function (view) {
      var d = Storage.get();
      var today = Util.todayISO();
      var html = '';

      /* 产后状态：分娩日 = 宝宝生日（本应用最可靠的分娩数据源） */
      var bd = (d.settings.baby && d.settings.baby.birthDate) || null;
      var dsb = bd ? Util.daysBetween(bd, today) : null;
      var postRecords = bd ? d.periods.filter(function (x) { return x.start && Util.daysBetween(bd, x.start) >= 0; }) : [];

      /* E1-恶露观察期（产后 0–6 周）：颜色进程 + 两条就医信号（KN-PER-2，med-note） */
      if (dsb !== null && dsb >= 0 && dsb <= 42) {
        html += '<div class="card"><h2>产后恶露参考 · 第 ' + (dsb + 1) + ' 天</h2>';
        var loMain = perText('KN-PER-1'), loWarn = perText('KN-PER-2');
        if (loMain) html += '<p class="hint">' + Util.escapeHtml(loMain) + '</p>';
        if (loWarn) html += '<p class="hint med-note">' + Util.escapeHtml(loWarn) + '</p>';
        html += '<p class="hint">「大姨妈」和恶露是两回事：月经从起到净一般不超过 8 天，第 1–2 天最多、之后迅速减少。</p></div>';
      }

      /* E1-哺乳期等待期（产后 43 天–1 年、未复潮）：解读 + 避孕常识 + 补铁（知识陈述，不做工具） */
      if (dsb !== null && dsb > 42 && dsb <= 365 && !postRecords.length) {
        html += '<div class="card info-card"><h2>哺乳期与月经</h2>';
        [ 'KN-PER-4', 'KN-PER-5', 'KN-PER-6' ].forEach(function (id) {
          var t = perText(id);
          if (t) html += '<p class="hint">' + Util.escapeHtml(t) + '</p>';
        });
        html += '<p class="hint">复潮早晚没有好坏之分：不哺乳的妈妈多在产后 6–10 周复潮，哺乳中的妈妈差异很大。</p></div>';
      }

      /* E1-复潮预警（产后满 1 年未复潮）：中性就医建议，一次性可关闭 */
      if (dsb !== null && dsb > 365 && !postRecords.length && !d.settings.periodRelactDismissed) {
        html += '<div class="card"><h2>复潮确认</h2>';
        html += '<p class="hint med-note">产后满 1 年还没有来月经（如仍在哺乳）：多数情况下仍在正常范围边缘，建议就诊确认激素与子宫恢复情况。</p>';
        html += '<button class="btn" id="pdRelact" type="button">知道了，不再提示</button></div>';
      }

      /* E1-首潮解读（复潮后 90 天内）：KN-PER-3 */
      if (dsb !== null && postRecords.length) {
        var firstPost = postRecords.slice().sort(function (a, b) { return new Date(a.start) - new Date(b.start); })[0];
        if (Util.daysBetween(firstPost.start, today) <= 90) {
          var t3 = perText('KN-PER-3');
          if (t3) html += '<div class="card"><h2>复潮了</h2><p class="hint">' + Util.escapeHtml(t3) + '</p></div>';
        }
      }

      /* P1（模块 13 断点）：进行中的经期给一键结束 */
      var ongoing = d.periods.filter(function (x) {
        return x.start && !x.end && Util.daysBetween(x.start, today) >= 0;
      }).sort(function (a, b) { return new Date(b.start) - new Date(a.start); })[0];
      if (ongoing) {
        var dayN = Util.daysBetween(ongoing.start, today) + 1;
        html += '<div class="card review-card"><h2>经期进行中 · 第 ' + dayN + ' 天</h2>';
        html += '<p class="hint">从 ' + Util.fmtDate(ongoing.start) + ' 开始的这条经期还没有结束日期。</p>';
        html += '<div class="row"><button class="btn btn-primary" id="pdToday" type="button">今天结束</button>'
          + '<button class="btn" id="pdPick" type="button">选日期结束</button></div></div>';
      }

      html += '<div class="card"><h2>记录一次经期</h2>';
      html += Util.dateSlider({ id: 'pStart', title: '开始日期', value: Util.todayISO(), min: Util.addDays(Util.todayISO(), -31), max: Util.todayISO() });
      html += Util.dateSlider({ id: 'pEnd', title: '结束日期', value: '', min: Util.addDays(Util.todayISO(), -31), max: Util.todayISO(), opt: { label: '已结束（选日期）', invert: true } });
      /* E2：经量/痛经轻量 chips（可选，不选不存；老数据无字段照常） */
      html += '<p class="hint">经量（可选）：</p>' + segHtml('pFlow', FLOWS, 'data-flow');
      html += '<p class="hint">痛经（可选）：</p>' + segHtml('pPain', PAINS, 'data-pain');
      html += '<span class="lbl-text">症状（可多选）</span><div class="chk-group chk-pills">';
      SYMPTOMS.forEach(function (s) {
        html += '<label class="chk"><input type="checkbox" class="pSym" value="' + s + '"> ' + s + '</label>';
      });
      html += '</div>';
      html += '<button class="btn btn-primary btn-save" id="pSave">保存</button> ';
      html += '<button class="btn" id="pClear">清空记录</button></div>';

      /* E3：参考窗口（仅近 3 周期 24–38 天且波动 ≤9 天才显示日期窗口） */
      var pw = _predictWindow(d.periods);
      if (pw.ok) {
        html += '<div class="card"><h2>下次经期参考窗口</h2><ul class="kv">';
        html += '<li>近 3 个周期：中位 <b>' + pw.med + '</b> 天</li>';
        html += '<li>下次经期参考窗口：<b>' + Util.fmtDate(pw.from) + ' 至 ' + Util.fmtDate(pw.to) + '</b></li>';
        html += '</ul><p class="hint">窗口按你自己的历史推算，仅供参考；个体差异大，请勿据此避孕或判断健康。</p></div>';
      } else if (!d.periods.length) {
        html += '<div class="card"><p class="hint">还没有记录。记下第一次经期开始日期即可开始积累。</p></div>';
      } else {
        html += '<div class="card"><h2>下次经期参考</h2><p class="hint">'
          + (pw.reason === 'few'
            ? '记录满 3 个周期后，这里会给出基于你自己历史的参考窗口；数据不足时不做预测。'
            : (pw.reason === 'out-of-range'
              ? '你的周期间隔不在 24–38 天的常见范围内，暂不显示日期预测——这不代表有问题，就诊时带上这份记录更有效。'
              : '你的周期波动较大（近 3 个周期相差超过 9 天），暂不显示日期预测——波动本身是值得观察的信息。'))
          + '</p><p class="hint">' + Util.escapeHtml(perText('KN-PER-4') || '') + '</p></div>';
      }

      /* E4：异常信号中性提示（一次性，可关闭不再重复） */
      var e4 = _abnormalNotice(d, today);
      if (e4 && d.settings.periodE4Seen !== e4.key) {
        html += '<div class="card"><p class="hint med-note">' + Util.escapeHtml(e4.text) + '</p>';
        html += '<button class="btn" id="pdE4Ok" type="button">知道了</button></div>';
      }

      html += '<div class="card"><h2>历史记录</h2>';
      if (d.periods.length) {
        html += '<ul class="list">';
        d.periods.slice().sort(function (a, b) { return new Date(b.start) - new Date(a.start); })
          .forEach(function (r) {
            /* 第 76 次（D 线）：行改「左日期区间 / 右经量·痛经·症状」双列 */
            var det = '';
            if (r.flow) det += '经量' + Util.escapeHtml(r.flow);
            if (r.pain && r.pain !== '无') det += (det ? ' · ' : '') + '痛经' + Util.escapeHtml(r.pain);
            if (r.symptoms && r.symptoms.length) det += (det ? ' · ' : '') + Util.escapeHtml(r.symptoms.join('、'));
            html += '<li><span class="row-ico">' + icon('period') + '</span>'
              + '<span class="li-main"><b>' + Util.fmtDate(r.start) + '</b>' + (r.end ? ' ~ ' + Util.fmtDate(r.end) : '') + '</span>'
              + '<span class="li-sub">' + det + '</span>'
              + '<button class="icon-btn" data-del="' + r.id + '" aria-label="删除" title="删除">' + icon('trash') + '</button></li>';
          });
        html += '</ul>';
      } else {
        html += '<div class="empty-state"><span class="es-ico">' + icon('period') + '</span><p>还没有经期记录</p><span class="hint">来了记一下开始日期就好。</span></div>';
      }
      html += '</div>';

      /* 第 59 次：医学提示（遵医嘱） */
      html += '<p class="hint med-note">经期记录是统计参考；异常出血、周期明显紊乱或不适请咨询医生。</p>';

      view.innerHTML = html;
      Util.bindDateSliders(view);

      /* 复潮预警关闭（一次性） */
      var pdRelact = view.querySelector('#pdRelact');
      if (pdRelact) pdRelact.addEventListener('click', function () {
        d.settings.periodRelactDismissed = true;
        Storage.save(); global.App.rerender();
      });
      /* E4 关闭（按 key 一次性） */
      var pdE4Ok = view.querySelector('#pdE4Ok');
      if (pdE4Ok) pdE4Ok.addEventListener('click', function () {
        d.settings.periodE4Seen = e4.key;
        Storage.save(); global.App.rerender();
      });

      /* 进行中横幅：今天结束 / 选日期结束（P1，模块 13） */
      var pdToday = view.querySelector('#pdToday');
      if (pdToday) pdToday.addEventListener('click', function () {
        ongoing.end = today;
        if (Storage.save()) Util.toast('已记录经期结束：' + Util.fmtDate(today) + '，共 ' + dayN + ' 天', 'ok');
        global.App.rerender();
      });
      var pdPick = view.querySelector('#pdPick');
      if (pdPick) pdPick.addEventListener('click', function () {
        Util.editDate({
          title: '补结束日期',
          message: '结束日期不能早于开始日 ' + Util.fmtDate(ongoing.start) + '。',
          value: today, min: ongoing.start, max: today, okText: '结束',
          onConfirm: function (v) {
            ongoing.end = v;
            if (Storage.save()) Util.toast('已记录经期结束：' + Util.fmtDate(v), 'ok');
            global.App.rerender();
          }
        });
      });

      /* E2 chips 单选（点按即选，再点同项取消） */
      var flowSel = null, painSel = null;
      Array.prototype.forEach.call(view.querySelectorAll('#pFlow [data-flow]'), function (b) {
        b.addEventListener('click', function () {
          var v = b.getAttribute('data-flow');
          flowSel = (flowSel === v) ? null : v;
          Array.prototype.forEach.call(view.querySelectorAll('#pFlow .seg-btn'), function (x) { x.classList.remove('active'); });
          if (flowSel) b.classList.add('active');
        });
      });
      Array.prototype.forEach.call(view.querySelectorAll('#pPain [data-pain]'), function (b) {
        b.addEventListener('click', function () {
          var v = b.getAttribute('data-pain');
          painSel = (painSel === v) ? null : v;
          Array.prototype.forEach.call(view.querySelectorAll('#pPain .seg-btn'), function (x) { x.classList.remove('active'); });
          if (painSel) b.classList.add('active');
        });
      });

      view.querySelector('#pSave').addEventListener('click', function () {
        var start = view.querySelector('#pStart').value;
        if (!start) { Util.markInvalid(view.querySelector('#pStart'), '请填写开始日期'); return; }
        var end = view.querySelector('#pEnd').value;
        if (end && Util.daysBetween(start, end) < 0) { Util.markInvalid(view.querySelector('#pEnd'), '结束日期不能早于开始日期'); return; }
        var syms = Array.prototype.map.call(view.querySelectorAll('.pSym:checked'), function (c) { return c.value; });
        d.periods.push({ id: Util.uid(), start: start, end: end || null, symptoms: syms, flow: flowSel, pain: painSel });
        if (Storage.save()) Util.toast('已记录经期：' + Util.fmtDate(start), 'ok'); /* C1 */
        global.App.rerender();
      });
      view.querySelector('#pClear').addEventListener('click', function () {
        /* U-33：不可逆批量操作走阻断路径——后果说明 + 立即导出口 + 防误触 */
        Util.confirm({
          title: '清空全部经期记录',
          message: '将删除本机保存的全部经期记录，此操作不可恢复。',
          okText: '仍要清空',
          danger: true,
          extra: { text: '先导出备份', onClick: function () { global.App.exportAll(); } },
          onConfirm: function () { d.periods = []; Storage.save(); global.App.rerender(); }
        });
      });
      Array.prototype.forEach.call(view.querySelectorAll('[data-del]'), function (b) {
        b.addEventListener('click', function () {
          var id = b.getAttribute('data-del');
          Util.removeWithUndo(d.periods, id, {
            onSave: function () { Storage.save(); },
            onAfter: function () { global.App.rerender(); },
            deletedText: '已删除经期记录'
          });
        });
      });
    },
    /* 纯函数导出（qa 用） */
    _predictWindow: _predictWindow,
    _abnormalNotice: _abnormalNotice
  };
})(window);
