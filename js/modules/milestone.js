/**
 * milestone.js - 成长里程碑日记 + 发育观察点（第 68 次 · B2）
 * 观察点：对照国家卫健委《3 岁以下婴幼儿心理行为发育标志自评表》（GJ-2025 附件 4）
 * 与《儿童心理行为发育问题预警征象筛查表》（YJZX），在 3/6/8/12/18/24/30/36 月龄自查。
 * 定位红线：只对照不诊断、不评分——预警规则照官方原文（1 项未出现→加强互动并咨询
 * 医务人员；2 项及以上→到医疗机构检查；预警征象任何一条阳性→转诊）。
 * 早产儿用矫正月龄（满 24 矫正月龄后按实际月龄，复用 baby.preterm/birthGestWeeks）。
 * 自评标记：d.milestoneObs = [{ id('KN-O/W-月龄-序'), v(1=是/阳性, 0=还没出现), date }]。
 * 第一次微笑、抬头、翻身……的时刻仍用下方「记一个里程碑」日记留下。
 */
(function (global) {
  'use strict';
  var Storage = global.Storage, Util = global.Util;
  var Modules = global.Modules = global.Modules || {};
  var Knowledge = global.Knowledge || null;

  var PRESETS = ['第一次微笑', '会抬头', '第一次翻身', '会独坐', '长第一颗牙',
    '会爬', '会扶站', '第一次叫妈妈', '第一次叫爸爸', '会走路'];

  /* 自评标记读取（读时清洗：id 必须在知识库内、v 只能 0/1） */
  function readMarks(d) {
    var marks = {};
    if (!Knowledge) return marks;
    var valid = {};
    Knowledge.MILESTONES.forEach(function (e) { valid[e.id] = true; });
    (d.milestoneObs || []).forEach(function (r) {
      if (r && valid[r.id] && (r.v === 0 || r.v === 1)) marks[r.id] = r.v;
    });
    return marks;
  }

  Modules.milestone = {
    id: 'milestone',
    title: '里程碑',
    render: function (view) {
      var d = Storage.get();
      var baby = (d.settings && d.settings.baby) || {};
      var html = '';

      /* ---------- 发育观察点（B2）---------- */
      if (Knowledge && Knowledge.CHECKPOINTS) {
        var today = Util.todayISO();
        var ageDays = baby.birthDate ? Util.daysBetween(baby.birthDate, today) : null;
        var effDays = ageDays;
        var corrTxt = '';
        /* 早产儿矫正月龄：满 24 矫正月龄后按实际月龄（儿保惯例） */
        if (ageDays != null && baby.preterm && parseFloat(baby.birthGestWeeks) > 0 && parseFloat(baby.birthGestWeeks) < 40) {
          var corr = Math.round((40 - parseFloat(baby.birthGestWeeks)) * 7);
          if (corr > 0 && ageDays - corr >= 0 && (ageDays - corr) / 30.44 <= 24) {
            effDays = ageDays - corr;
            corrTxt = ' · 矫正月龄 ' + (effDays / 30.44).toFixed(1) + ' 月';
          }
        }
        var ageMo = effDays != null ? effDays / 30.44 : null;
        var reached = {};
        Knowledge.CHECKPOINTS.forEach(function (m) { reached[m] = ageMo != null && ageMo >= m; });

        /* 默认选中：最近一个已到的检查点；都没到（或没填生日）则预览 3 月龄 */
        if (!Modules.milestone._selCp || Knowledge.CHECKPOINTS.indexOf(Modules.milestone._selCp) < 0) {
          Modules.milestone._selCp = null;
          for (var ci = Knowledge.CHECKPOINTS.length - 1; ci >= 0; ci--) {
            if (reached[Knowledge.CHECKPOINTS[ci]]) { Modules.milestone._selCp = Knowledge.CHECKPOINTS[ci]; break; }
          }
          if (Modules.milestone._selCp == null) Modules.milestone._selCp = Knowledge.CHECKPOINTS[0];
        }
        var cp = Modules.milestone._selCp;

        html += '<div class="card"><h2>发育观察点</h2>';
        html += '<p class="hint">对照官方《婴幼儿心理行为发育标志自评表》自查，在 3/6/8/12/18/24/30/36 月龄各看一次。'
          + '这里只做对照、不给评级也不下结论；标记只保存在本机。</p>';
        if (ageDays == null) {
          html += '<p class="hint">先在「称呼与阶段」里填宝宝生日，才能按月龄对照。</p>';
        } else {
          html += '<p class="hint">宝宝现在 <b>' + (ageDays / 30.44).toFixed(1) + ' 月龄</b>' + corrTxt + '。</p>';
        }
        html += '<div class="chip-row" id="obsCps">';
        Knowledge.CHECKPOINTS.forEach(function (m) {
          html += '<button type="button" class="seg-btn' + (m === cp ? ' active' : '') + '" data-cp="' + m + '">'
            + m + ' 月龄' + (reached[m] ? '' : '·未到') + '</button>';
        });
        html += '</div>';

        var set = Knowledge.milestoneAt(cp);
        var marks = readMarks(d);

        /* 自评表条目（正向） */
        html += '<p class="lbl-text">' + cp + ' 月龄自评（达到 = 大多数宝宝在该月龄的水平）</p><div id="obsList">';
        set.obs.forEach(function (e) {
          var v = marks[e.id];
          html += '<div class="obs-row"><span class="obs-area">' + Knowledge.AREA_TXT[e.area] + '</span>'
            + '<span class="obs-txt">' + Util.escapeHtml(e.text) + '</span>'
            + '<span class="obs-btns">'
            + '<button type="button" class="seg-btn' + (v === 1 ? ' active' : '') + '" data-mid="' + e.id + '" data-v="1">是</button>'
            + '<button type="button" class="seg-btn' + (v === 0 ? ' active no-sel' : '') + '" data-mid="' + e.id + '" data-v="0">还没</button>'
            + '</span></div>';
        });
        html += '</div>';

        /* 官方预警规则（只对已到的检查点判读；未到月龄一律不下结论） */
        if (reached[cp]) {
          var noCount = set.obs.filter(function (e) { return marks[e.id] === 0; }).length;
          var doneCount = set.obs.filter(function (e) { return marks[e.id] === 1 || marks[e.id] === 0; }).length;
          if (noCount >= 2) {
            html += '<p class="hint med-note">有 ' + noCount + ' 项发育标志未出现——按官方建议，'
              + '应带宝宝到医疗机构进行相关检查。早看早安心，很多情况只是需要一点时间。</p>';
          } else if (noCount === 1) {
            html += '<p class="hint med-note">有 1 项发育标志未出现：平时多陪宝宝交流与玩耍，'
              + '并向医务人员寻求指导——下次儿保时和医生聊聊就好。</p>';
          } else if (doneCount === set.obs.length) {
            html += '<p class="hint">这个检查点 ' + set.obs.length + ' 项都达到了。</p>';
          } else {
            html += '<p class="hint">已对照 ' + doneCount + '/' + set.obs.length + ' 项，想到再标，不用一次做完。</p>';
          }
        } else {
          html += '<p class="hint">这个检查点还没到月龄——先看看就行，到月龄再来对照。</p>';
        }

        /* 预警征象（反向）：出现任何一条 = 阳性，官方规则为转诊 */
        var warnHit = set.warn.filter(function (e) { return marks[e.id] === 1; }).length;
        html += '<p class="lbl-text">预警征象（反向观察，出现任何一条建议就医）</p><div id="warnList">';
        set.warn.forEach(function (e) {
          html += '<div class="obs-row"><span class="obs-txt">' + Util.escapeHtml(e.text) + '</span>'
            + '<span class="obs-btns"><button type="button" class="seg-btn' + (marks[e.id] === 1 ? ' active no-sel' : '') + '"'
            + ' data-mid="' + e.id + '" data-v="1">' + (marks[e.id] === 1 ? '有此表现' : '标记') + '</button></span></div>';
        });
        html += '</div>';
        if (warnHit > 0) {
          html += '<p class="hint med-note">已标记 ' + warnHit + ' 条预警征象——按官方指引，'
            + '建议带宝宝到医院就诊（儿保科或儿童发育行为科），由医生进一步评估。</p>';
        }
        html += '</div>';
      }

      /* ---------- 里程碑日记（原功能不动）---------- */
      /* 新增：预设 chips（C8：原生 select 唤起系统选择器打断心流）+ 日期 + 备注。
         点选即回填标题并高亮，仍统一走「保存」按钮，避免误触直接落库。 */
      html += '<div class="card"><h2>记一个里程碑</h2>';
      html += '<span class="lbl-text">常见里程碑（点选填入）</span>';
      html += '<div class="chip-row" id="msChips">';
      PRESETS.forEach(function (p) { html += '<button type="button" class="seg-btn" data-ms="' + p + '">' + p + '</button>'; });
      html += '</div>';
      html += '<label>或自定义<input type="text" id="msTitle" placeholder="如：第一次游泳"></label>';
      html += Util.dateSlider({ id: 'msDate', title: '日期', value: Util.todayISO(), min: Util.addDays(Util.todayISO(), -31), max: Util.todayISO() });
      html += '<label>备注（可选）<input type="text" id="msNote" placeholder="当时的情景…"></label>';
      html += '<button class="btn btn-primary btn-save" id="msSave">保存</button></div>';

      /* 时间线 */
      var list = (d.milestones || []).slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
      html += '<div class="card"><h2>时间线</h2>';
      if (list.length) {
        html += '<ul class="list">';
        list.forEach(function (r) {
          var ageTxt = '';
          if (baby.birthDate && r.date) {
            var days = Util.daysBetween(baby.birthDate, r.date);
            if (days >= 0) ageTxt = ' <small>（' + (days < 60 ? days + ' 天' : (days / 30.44).toFixed(1) + ' 月龄') + '）</small>';
          }
          /* 第 76 次（D 线）：行改「左里程碑+月龄 / 右日期+备注」双列 */
          html += '<li><span class="row-ico">' + icon('milestone') + '</span>'
            + '<span class="li-main"><b>' + Util.escapeHtml(r.title) + '</b>' + ageTxt + '</span>'
            + '<span class="li-sub">' + Util.fmtDate(r.date) + (r.note ? ' · ' + Util.escapeHtml(r.note) : '') + '</span>'
            + '<button class="icon-btn" data-del="' + r.id + '" aria-label="删除" title="删除">' + icon('trash') + '</button></li>';
        });
        html += '</ul>';
      } else {
        html += '<div class="empty-state"><span class="es-ico">' + icon('milestone') + '</span><p>还没有记录</p><span class="hint">宝宝的每个「第一次」都值得留下。</span></div>';
      }
      html += '</div>';

      view.innerHTML = html;
      Util.bindDateSliders(view);

      /* 观察点：切换检查点（重渲染整个模块，保持单出口） */
      Array.prototype.forEach.call(view.querySelectorAll('#obsCps [data-cp]'), function (b) {
        b.addEventListener('click', function () {
          Modules.milestone._selCp = parseInt(b.getAttribute('data-cp'), 10);
          global.App.rerender();
        });
      });
      /* 观察点：标记写入（是/还没互斥 upsert；预警标记点按可取消）。
         写入前按 id 重建记录数组，读时清洗保证坏数据不进存储。 */
      Array.prototype.forEach.call(view.querySelectorAll('[data-mid]'), function (b) {
        b.addEventListener('click', function () {
          var id = b.getAttribute('data-mid');
          var v = parseInt(b.getAttribute('data-v'), 10);
          var rest = (d.milestoneObs || []).filter(function (r) { return r && r.id !== id; });
          var cur = (d.milestoneObs || []).filter(function (r) { return r && r.id === id; })[0];
          var next = (cur && cur.v === v) ? null : { id: id, v: v, date: Util.todayISO() };
          d.milestoneObs = next ? rest.concat([next]) : rest;
          if (Storage.save()) {
            if (id.indexOf('KN-W-') === 0 && next) {
              Util.toast('已标记。官方建议带宝宝请医生进一步评估——只对照，不诊断。', 'warn');
            }
          }
          global.App.rerender();
        });
      });

      /* 点选预设 chip：回填自定义框（可微调）并高亮所选 */
      Array.prototype.forEach.call(view.querySelectorAll('#msChips [data-ms]'), function (b) {
        b.addEventListener('click', function () {
          view.querySelector('#msTitle').value = b.getAttribute('data-ms');
          Array.prototype.forEach.call(view.querySelectorAll('#msChips [data-ms]'), function (x) { x.classList.remove('active'); });
          b.classList.add('active');
        });
      });
      view.querySelector('#msSave').addEventListener('click', function () {
        var title = (view.querySelector('#msTitle').value || '').trim();
        var date = view.querySelector('#msDate').value;
        if (!title) { Util.markInvalid(view.querySelector('#msTitle'), '请填写或选择一个里程碑'); return; }
        if (!date) { Util.markInvalid(view.querySelector('#msDate'), '请选择日期'); return; }
        d.milestones.push({
          id: Util.uid(), title: title, date: date,
          note: (view.querySelector('#msNote').value || '').trim() || null
        });
        if (Storage.save()) Util.toast('已记下：' + title, 'ok');
        global.App.rerender();
      });
      Array.prototype.forEach.call(view.querySelectorAll('[data-del]'), function (b) {
        b.addEventListener('click', function () {
          Util.removeWithUndo(d.milestones, b.getAttribute('data-del'), {
            onSave: function () { Storage.save(); },
            onAfter: function () { global.App.rerender(); },
            deletedText: '已删除里程碑'
          });
        });
      });
    }
  };
})(window);
