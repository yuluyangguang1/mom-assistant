/**
 * supplement.js - 补剂计划与打卡（第 132 次 · 对标 Cali 21 工具里的 supplement-tracker）
 *
 * 与「吃药/维D」页的分工（别混）：
 *   · 吃药/维D  meds  —— 短期、有症状才吃的东西（退烧药、抗生素、临时维D），带今日次数与提醒；
 *   · 补剂     本页   —— 长期天天吃的营养补充（维D/AD/铁/钙/DHA/益生菌），
 *                        有「计划」（每天几次）+ 打卡进度，回答的是「今天该吃的吃了吗」。
 *
 * 对标 Cali 的 SupplementRecord / SupplementPlanItem 两层结构：
 *   计划  = { id, name, form, perDay, active, sortOrder }        —— 该吃什么、每天几次
 *   记录  = { id, time, name, planId, dose, note }               —— 今天实际吃了几次
 * 只记录不推荐剂量（U-25）：每种补剂吃多少，按医嘱或说明书，工具不替你定。
 * 数据：d.supplementPlans / d.supplements。
 */
(function (global) {
  'use strict';
  var Storage = global.Storage, Util = global.Util;
  var Modules = global.Modules = global.Modules || {};

  /* 常见补剂预设（名称只是快捷入口，用户可以自定义） */
  var PRESETS = ['维生素D', '维生素AD', '铁剂', '钙剂', 'DHA', '益生菌'];
  /* 剂型：对标 Cali 的 SupplementForm */
  var FORMS = ['滴剂', '胶囊', '片剂', '粉剂', '液体'];

  function activePlans(d) {
    return (d.supplementPlans || []).filter(function (p) { return p && p.active !== false; })
      .slice().sort(function (a, b) {
        var sa = (typeof a.sortOrder === 'number') ? a.sortOrder : 0;
        var sb = (typeof b.sortOrder === 'number') ? b.sortOrder : 0;
        return sa - sb;
      });
  }

  /* 第 196 次：计划可带提醒时刻 remindAt（"HH:MM"，选填）。读取一律过这个校验，导入的坏值当没设。 */
  function remindAtOf(p) {
    var v = p && p.remindAt;
    return (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v)) ? v : null;
  }
  function perOf(p) { return (typeof p.perDay === 'number' && p.perDay > 0) ? p.perDay : 1; }

  /* 今日某计划的打卡次数：优先按 planId 认，旧记录（无 planId）按名称兜底 */
  function takenCount(list, plan) {
    return list.filter(function (r) {
      if (r.planId && plan.id) return r.planId === plan.id;
      return r.name === plan.name;
    }).length;
  }

  Modules.supplement = {
    id: 'supplement',
    title: '补剂',
    _remindAtOf: remindAtOf,
    /* 第 196 次：首页补剂磁贴就地打卡（契约同 diaper._quickHTML/_quickBind）。
       只列今天还没吃满的前 2 个计划；全吃满或没计划返回空串 → 首页回落普通磁贴。 */
    _quickHTML: function (d) {
      var DS = Util.dayStartHour(d), dayNow = Util.dayKeyOf(new Date(), DS);
      var todayList = (d.supplements || []).filter(function (r) { return r && Util.dayKeyOf(r.time, DS) === dayNow; });
      var left = activePlans(d).filter(function (p) { return takenCount(todayList, p) < perOf(p); }).slice(0, 2);
      return left.map(function (p) {
        return '<button type="button" class="qk-btn qk-sup" data-qk-sup="' + Util.escapeHtml(p.id) + '" aria-label="打卡 ' + Util.escapeHtml(p.name) + '">'
          + icon('check') + '<span>' + Util.escapeHtml(p.name) + '</span></button>';
      }).join('');
    },
    _quickBind: function (root, d, done) {
      Array.prototype.forEach.call(root.querySelectorAll('[data-qk-sup]'), function (b) {
        b.addEventListener('click', function (ev) {
          if (ev && ev.stopPropagation) ev.stopPropagation();
          var plan = (d.supplementPlans || []).filter(function (p) { return p.id === b.getAttribute('data-qk-sup'); })[0];
          if (!plan) return;
          var rec = { id: Util.uid(), time: Util.nowLocal(), name: plan.name, planId: plan.id, dose: null, note: null };
          d.supplements.push(rec);
          if (Storage.save()) {
            Util.toast('已打卡 ' + plan.name, 'ok', { label: '撤销', onClick: function () {
              for (var i = d.supplements.length - 1; i >= 0; i--) if (d.supplements[i].id === rec.id) { d.supplements.splice(i, 1); break; }
              Storage.save(); done();
            } });
          }
          done();
        });
      });
    },
    render: function (view) {
      var d = Storage.get();
      var DS = Util.dayStartHour(d);
      var dayNow = Util.dayKeyOf(new Date(), DS);
      var all = d.supplements || [];
      var todayList = all.filter(function (r) { return Util.dayKeyOf(r.time, DS) === dayNow; });
      var plans = activePlans(d);
      var html = '';

      /* 今日打卡：每个启用计划一行，右侧「+1」——这是本页的主场景 */
      html += '<div class="card"><h2>今天该吃的</h2>';
      if (plans.length) {
        html += '<ul class="list sup-plans">';
        plans.forEach(function (p) {
          var per = (typeof p.perDay === 'number' && p.perDay > 0) ? p.perDay : 1;
          var done = takenCount(todayList, p);
          var full = done >= per;
          html += '<li>'
            + '<span class="row-ico">' + icon('supplement') + '</span>'
            + '<span class="li-main"><b>' + Util.escapeHtml(p.name) + '</b></span>'
            + '<span class="li-sub">' + Util.escapeHtml(p.form || '') + '</span>'
            + '<span class="li-num' + (full ? ' sup-done' : '') + '">' + done + '/' + per + '</span>'
            + '<button class="icon-btn sup-plus" data-take="' + p.id + '" aria-label="打卡一次" ' +
            'title="打卡一次">' + icon(full ? 'check' : 'plus') + '</button>'
            + '</li>';
        });
        html += '</ul>';
        var totalNeed = plans.reduce(function (s, p) {
          return s + ((typeof p.perDay === 'number' && p.perDay > 0) ? p.perDay : 1);
        }, 0);
        var totalDone = plans.reduce(function (s, p) {
          var per = (typeof p.perDay === 'number' && p.perDay > 0) ? p.perDay : 1;
          return s + Math.min(per, takenCount(todayList, p));
        }, 0);
        html += '<p class="hint">今天完成 ' + totalDone + '/' + totalNeed +
          (totalDone >= totalNeed ? '，都吃过了。' : '，还有没吃的。') + '</p>';
        html += Util.timePickHTML('spTime');
      } else {
        html += '<div class="empty-state"><span class="es-ico">' + icon('supplement') + '</span><p>还没有补剂计划</p>' +
          '<span class="hint">在下面加一条「每天吃什么」，之后每天点一下就完成打卡。</span></div>';
      }
      html += '</div>';

      /* 计划管理 */
      html += '<div class="card"><h2>补剂计划</h2>';
      if ((d.supplementPlans || []).length) {
        html += '<ul class="list">';
        (d.supplementPlans || []).slice().sort(function (a, b) {
          return ((a.sortOrder || 0) - (b.sortOrder || 0));
        }).forEach(function (p) {
          var off = p.active === false;
          var perN = (typeof p.perDay === 'number' && p.perDay > 0) ? p.perDay : 1;
          /* 计划行只留「名称 + 每日次数/已停用 + 两个图标钮」：
             剂型在「今天该吃的」那一行已经显示，这里再放会让 390px 宽下的
             副文案被挤成「滴剂 · 每日…」——宁可少一项，不要省略号。 */
          html += '<li><span class="row-ico">' + icon('supplement') + '</span>'
            + '<span class="li-main"><b>' + Util.escapeHtml(p.name) + '</b></span>'
            + '<span class="li-sub">' + (off ? '已停用' : ('每日 ' + perN + ' 次' + (remindAtOf(p) ? ' · ' + remindAtOf(p) : ''))) + '</span>'
            + '<button class="icon-btn" data-remind="' + p.id + '" aria-label="设置提醒时间" title="提醒时间">' + icon('bell') + '</button>'
            + '<button class="icon-btn" data-toggle="' + p.id + '" aria-label="' +
            (off ? '启用' : '停用') + '" title="' + (off ? '启用' : '停用') + '">' +
            icon(off ? 'refresh' : 'moon') + '</button>'
            + '<button class="icon-btn" data-delplan="' + p.id + '" aria-label="删除计划" ' +
            'title="删除计划">' + icon('trash') + '</button></li>';
        });
        html += '</ul>';
      }

      /* 加计划 */
      html += '<div class="sup-add">';
      html += '<label>补剂<select id="spName">';
      PRESETS.forEach(function (n) { html += '<option value="' + n + '">' + n + '</option>'; });
      html += '<option value="__custom">自定义…</option></select></label>';
      html += '<label id="spCustomWrap" hidden>自定义名称<input type="text" id="spCustom" ' +
        'maxlength="12" placeholder="如 锌剂"></label>';
      html += '<label>剂型<select id="spForm">';
      FORMS.forEach(function (f) { html += '<option value="' + f + '">' + f + '</option>'; });
      html += '</select></label>';
      html += '<label>每日次数<input type="number" id="spPerDay" min="1" max="6" ' +
        'inputmode="numeric" value="1"></label>';
      html += '<label>提醒时间（选填）<input type="time" id="spRemind"></label>';
      html += '<button class="btn btn-primary btn-save" id="spAdd">加入计划</button>';
      html += '</div>';
      html += '<p class="hint">吃多少、吃多久，按医嘱或说明书；这里只记「有没有吃」，不给剂量建议。</p>';
      html += '</div>';

      /* 最近记录 */
      html += '<div class="card"><h2>最近记录</h2>';
      var list = all.slice().sort(function (a, b) { return new Date(b.time) - new Date(a.time); }).slice(0, 20);
      if (list.length) {
        html += '<ul class="list">';
        list.forEach(function (r) {
          html += '<li><span class="row-ico">' + icon('supplement') + '</span>'
            + '<span class="li-main"><b>' + Util.escapeHtml(r.name || '补剂') + '</b></span>'
            + '<span class="li-sub">' + Util.fmtDateTime(r.time) +
            (r.note ? ' · ' + Util.escapeHtml(r.note) : '') + '</span>'
            + '<span class="li-num">' + (r.dose ? Util.escapeHtml(r.dose) : '') + '</span>'
            + '<button class="icon-btn" data-del="' + r.id + '" aria-label="删除" title="删除">' +
            icon('trash') + '</button></li>';
        });
        html += '</ul>';
      } else {
        html += '<div class="empty-state"><span class="es-ico">' + icon('supplement') + '</span><p>还没有补剂记录</p>' +
          '<span class="hint">加了计划之后，每天点一下「+1」就会出现在这里。</span></div>';
      }
      html += '</div>';

      html += '<p class="hint med-note">短期用药（退烧药、抗生素等）请记在「吃药/维D」页；' +
        '补剂吃多少、要不要补，请遵医嘱。</p>';

      view.innerHTML = html;

      /* 自定义名称的显隐 */
      var nameSel = view.querySelector('#spName');
      var customWrap = view.querySelector('#spCustomWrap');
      nameSel.addEventListener('change', function () {
        customWrap.hidden = (nameSel.value !== '__custom');
      });

      /* 打卡 +1 */
      Array.prototype.forEach.call(view.querySelectorAll('[data-take]'), function (b) {
        b.addEventListener('click', function () {
          var pid = b.getAttribute('data-take');
          var plan = (d.supplementPlans || []).filter(function (p) { return p.id === pid; })[0];
          if (!plan) return;
          var spStamp = Util.stampFrom(view, 'spTime');
          if (!spStamp) return;
          d.supplements.push({
            id: Util.uid(), time: spStamp, name: plan.name,
            planId: plan.id, dose: null, note: null
          });
          if (Storage.save()) Util.toast('已记录 ' + plan.name, 'ok');
          global.App.rerender();
        });
      });

      /* 加计划 */
      view.querySelector('#spAdd').addEventListener('click', function () {
        var nm = nameSel.value;
        if (nm === '__custom') {
          var cEl = view.querySelector('#spCustom');
          nm = (cEl.value || '').trim();
          if (!nm) { Util.markInvalid(cEl, '请填补剂名称'); return; }
        }
        var perEl = view.querySelector('#spPerDay');
        var per = parseInt(perEl.value, 10);
        if (!isFinite(per) || per < 1 || per > 6) {
          Util.markInvalid(perEl, '每日次数填 1–6');
          return;
        }
        /* 同名计划只允许一条：重复添加会让「今天该吃的」出现两行一样的 */
        var dup = (d.supplementPlans || []).some(function (p) { return String(p.name).trim() === nm && p.active !== false; });
        if (dup) { Util.toast('「' + nm + '」已经在计划里了', 'warn'); return; }
        var ra = (view.querySelector('#spRemind').value || '').slice(0, 5);
        var plan = {
          id: Util.uid(), name: nm, form: view.querySelector('#spForm').value || '滴剂',
          perDay: per, active: true, sortOrder: (d.supplementPlans || []).length
        };
        if (remindAtOf({ remindAt: ra })) plan.remindAt = ra;
        d.supplementPlans.push(plan);
        if (Storage.save()) Util.toast('已加入计划：' + nm, 'ok');
        global.App.rerender();
      });

      /* 第 196 次：改提醒时间（清空 = 不定时，回到「近几天在吃才提醒」的老规则） */
      Array.prototype.forEach.call(view.querySelectorAll('[data-remind]'), function (b) {
        b.addEventListener('click', function () {
          var p = (d.supplementPlans || []).filter(function (x) { return x.id === b.getAttribute('data-remind'); })[0];
          if (!p) return;
          Util.editText({
            title: p.name + ' · 提醒时间',
            message: '到点还没吃满，首页提醒里会出现。清空就不定时。',
            value: remindAtOf(p) || '', placeholder: '如 09:00', maxlength: 5, okText: '保存',
            onConfirm: function (v) {
              v = (v || '').trim().replace('：', ':');
              if (/^\d:\d\d$/.test(v)) v = '0' + v;
              if (v && !remindAtOf({ remindAt: v })) { Util.toast('时间格式像 09:00 这样', 'warn'); return; }
              if (v) p.remindAt = v; else delete p.remindAt;
              if (Storage.save()) Util.toast(v ? '每天 ' + v + ' 提醒' : '已取消定时提醒', 'ok');
              global.App.rerender();
            }
          });
        });
      });

      /* 停用 / 启用 */
      Array.prototype.forEach.call(view.querySelectorAll('[data-toggle]'), function (b) {
        b.addEventListener('click', function () {
          var pid = b.getAttribute('data-toggle');
          var tp = (d.supplementPlans || []).filter(function (p) { return p.id === pid; })[0];
          if (!tp) return;
          /* 第 278 次（审计 #40）：重新启用时已有同名的启用中计划 → 不启用，提示（否则「今天该吃的」出现两行、各自计数） */
          if (tp.active === false && (d.supplementPlans || []).some(function (p) { return p !== tp && p.active !== false && String(p.name).trim() === String(tp.name).trim(); })) {
            Util.toast('「' + tp.name + '」已经有一条在用的计划，先停用或删掉那条再启用', 'warn');
            return;
          }
          tp.active = (tp.active === false);
          if (Storage.save()) Util.toast(tp.active ? '已启用：' + tp.name : '已停用：' + tp.name, 'ok');
          global.App.rerender();
        });
      });

      /* 删除计划：历史记录保留（记录里存了 name 快照，删计划不影响已吃过的账） */
      Array.prototype.forEach.call(view.querySelectorAll('[data-delplan]'), function (b) {
        b.addEventListener('click', function () {
          var pid = b.getAttribute('data-delplan');
          Util.removeWithUndo(d.supplementPlans, pid, {
            onSave: function () { Storage.save(); },
            onAfter: function () { global.App.rerender(); },
            deletedText: '已删除补剂计划（历史记录保留）'
          });
        });
      });

      /* 删除记录 */
      Array.prototype.forEach.call(view.querySelectorAll('[data-del]'), function (b) {
        b.addEventListener('click', function () {
          Util.removeWithUndo(d.supplements, b.getAttribute('data-del'), {
            onSave: function () { Storage.save(); },
            onAfter: function () { global.App.rerender(); },
            deletedText: '已删除补剂记录'
          });
        });
      });
    }
  };
})(window);
