/**
 * pregnancy.js - 孕期 / 产检
 * 预产期可由末次月经推算，也可手动改并联动 LMP；按孕周显示进度；
 * 产检日历（关键节点 + 自定义备注）；产检记录（项目 + 数值 + 趋势）。
 */
(function (global) {
  'use strict';
  var Storage = global.Storage, Util = global.Util;
  var Modules = global.Modules = global.Modules || {};

  // 关键产检节点（按孕周，简化版）
  var CHECKS = [
    { week: 6, title: '确认妊娠 / 建卡', desc: '血/尿HCG确认，预约建档' },
    { week: 11, title: 'NT 检查', desc: '11-13+6周 颈后透明层' },
    { week: 15, title: '唐氏筛查', desc: '15-20周 血清筛查（或NIPT）' },
    { week: 20, title: '大排畸（系统超声）', desc: '20-24周 胎儿结构筛查' },
    { week: 24, title: '糖耐量 OGTT', desc: '24-28周 妊娠糖尿病筛查' },
    { week: 28, title: '小排畸 + 感染指标', desc: '28-32周 二次筛查、乙肝等' },
    { week: 32, title: '胎心监护起始', desc: '32周后定期胎监' },
    { week: 36, title: '评估分娩方式', desc: '36周 骨盆、胎位评估' },
    { week: 37, title: '足月待产', desc: '37-40周 每周产检' }
  ];

  function currentWeek() {
    var pg = Storage.get().pregnancy;
    var base = pg.lmp || (pg.dueDate ? Util.addDays(pg.dueDate, -280) : null);
    if (!base) return null;
    var elapsed = Util.daysBetween(base, Util.todayISO());
    if (elapsed < 0) return null;
    return {
      week: Math.floor(elapsed / 7),
      day: elapsed % 7,
      percent: Math.min(100, Math.round(elapsed / 280 * 100)),
      due: pg.dueDate
    };
  }

  Modules.pregnancy = {
    id: 'pregnancy',
    title: '孕期',
    render: function (view) {
      var d = Storage.get();
      var pg = d.pregnancy;
      var html = '';

      html += '<div class="card"><h2>' + icon('pregnancy') + '预产期设置</h2>';
      html += '<label>末次月经 (LMP)<input type="date" id="lmp" value="' + (pg.lmp || '') + '"></label>';
      html += '<label>预产期（可手动改，将联动 LMP）<input type="date" id="due" value="' + (pg.dueDate || '') + '"></label>';
      html += '<button class="btn btn-primary" id="pgSave">保存</button>';
      html += '<p class="hint">预产期 = 末次月经 + 280 天（40周）。修改任一项会自动同步另一项。</p></div>';

      var cw = currentWeek();
      if (cw) {
        html += '<div class="card"><h2>' + icon('pregnancy') + '当前进度</h2><ul class="kv">';
        html += '<li>孕周：<b>第 ' + cw.week + ' 周 + ' + cw.day + ' 天</b></li>';
        html += '<li>预产期：' + (cw.due ? Util.fmtDate(cw.due) : '未设置') + '</li>';
        html += '</ul><div class="progress"><div class="progress-bar" style="width:' + cw.percent + '%"></div></div>';
        html += '<p class="hint">进度 ' + cw.percent + '%</p></div>';
      } else {
        html += '<div class="card"><p class="hint">设置末次月经或预产期后显示孕周进度。</p></div>';
      }

      // 产检日历
      html += '<div class="card"><h2>' + icon('pregnancy') + '产检日历</h2><ul class="list">';
      CHECKS.forEach(function (c) {
        var status = (cw && cw.week >= c.week) ? '（已过/临近）' : '';
        html += '<li>' + icon('calendar') + '<span>孕' + c.week + '周：' + c.title + '<br><small>' + c.desc + '</small></span>' +
          '<span class="tag">' + status + '</span></li>';
      });
      html += '</ul>';
      html += '<label>自定义产检备注（孕周）<input type="number" id="ckWeek" min="0" max="45" placeholder="如 30"></label>';
      html += '<label>内容<input type="text" id="ckNote" placeholder="如 已做B超，宝宝偏大"></label>';
      html += '<button class="btn" id="ckAdd">添加备注</button>';
      if (d.prenatal.checks.length) {
        html += '<ul class="list">';
        d.prenatal.checks.slice().reverse().forEach(function (r) {
          html += '<li><span>孕' + r.week + '周：' + Util.escapeHtml(r.note) + '</span>' +
            '<button class="icon-btn" data-ck="' + r.id + '" aria-label="删除" title="删除">' + icon('trash') + '</button></li>';
        });
        html += '</ul>';
      }
      html += '</div>';

      // 产检记录
      html += '<div class="card"><h2>' + icon('pregnancy') + '产检记录</h2>';
      html += '<label>项目<input type="text" id="rcItem" placeholder="如 宫高 / 体重 / 血压"></label>';
      html += '<label>数值<input type="text" id="rcVal" placeholder="如 28cm / 120/80"></label>';
      html += '<label>日期<input type="date" id="rcDate" value="' + Util.todayISO() + '"></label>';
      html += '<button class="btn btn-primary" id="rcAdd">保存记录</button>';
      if (d.prenatal.records.length) {
        var byItem = {};
        d.prenatal.records.forEach(function (r) { (byItem[r.item] = byItem[r.item] || []).push(r); });
        html += '<ul class="list">';
        Object.keys(byItem).forEach(function (item) {
          var arr = byItem[item].slice().sort(function (a, b) { return new Date(a.date) - new Date(b.date); });
          var vals = arr.map(function (r) { return Util.escapeHtml(r.value); }).join(' → ');
          html += '<li>' + icon('pregnancy') + '<span><b>' + Util.escapeHtml(item) + '</b><br>趋势：' + vals + '</span></li>';
        });
        html += '</ul><button class="btn-mini" id="rcClear">清空记录</button>';
      }
      html += '</div>';

      view.innerHTML = html;

      view.querySelector('#pgSave').addEventListener('click', function () {
        var lmp = view.querySelector('#lmp').value;
        var due = view.querySelector('#due').value;
        if (lmp && due) {
          pg.lmp = lmp; pg.dueDate = Util.addDays(lmp, 280);
        } else if (lmp) {
          pg.lmp = lmp; pg.dueDate = Util.addDays(lmp, 280);
        } else if (due) {
          pg.dueDate = due; pg.lmp = Util.addDays(due, -280);
        } else {
          Util.markInvalid([view.querySelector('#lmp'), view.querySelector('#due')], '请至少填写末次月经或预产期'); return;
        }
        Storage.save();
        global.App.rerender();
      });
      view.querySelector('#ckAdd').addEventListener('click', function () {
        var wkEl = view.querySelector('#ckWeek'), noteEl = view.querySelector('#ckNote');
        var wk = wkEl.value, note = noteEl.value.trim();
        var bad = false;
        if (!wk) { Util.markInvalid(wkEl, '请填写孕周'); bad = true; }
        if (!note) { Util.markInvalid(noteEl, '请填写内容'); bad = true; }
        if (bad) return;
        d.prenatal.checks.push({ id: Util.uid(), week: parseInt(wk, 10), note: note });
        Storage.save();
        global.App.rerender();
      });
      Array.prototype.forEach.call(view.querySelectorAll('[data-ck]'), function (b) {
        b.addEventListener('click', function () {
          var id = b.getAttribute('data-ck');
          Util.removeWithUndo(d.prenatal.checks, id, {
            onSave: function () { Storage.save(); },
            onAfter: function () { global.App.rerender(); },
            deletedText: '已删除产检记录'
          });
        });
      });
      view.querySelector('#rcAdd').addEventListener('click', function () {
        var itemEl = view.querySelector('#rcItem'), valEl = view.querySelector('#rcVal');
        var item = itemEl.value.trim(), val = valEl.value.trim();
        var date = view.querySelector('#rcDate').value;
        var bad = false;
        if (!item) { Util.markInvalid(itemEl, '请填写项目'); bad = true; }
        if (!val) { Util.markInvalid(valEl, '请填写数值'); bad = true; }
        if (bad) return;
        d.prenatal.records.push({ id: Util.uid(), item: item, value: val, date: date });
        Storage.save(); global.App.rerender();
      });
      var rcClear = view.querySelector('#rcClear');
      if (rcClear) rcClear.addEventListener('click', function () {
        Util.confirm({ title: '清空产检记录', message: '确定清空全部产检记录？', okText: '清空', danger: true, onConfirm: function () { d.prenatal.records = []; Storage.save(); global.App.rerender(); } });
      });
    }
  };
})(window);
