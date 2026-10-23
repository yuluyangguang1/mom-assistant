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

      html += '<div class="card"><h2>预产期设置</h2>';
      html += Util.dateSlider({ id: 'lmp', title: '末次月经 (LMP)', value: pg.lmp || '', min: Util.addDays(Util.todayISO(), -320), max: Util.todayISO(), opt: { label: '未设置', invert: false } });
      html += Util.dateSlider({ id: 'due', title: '预产期（可手动改，将联动 LMP）', value: pg.dueDate || '', min: Util.addDays(Util.todayISO(), -60), max: Util.addDays(Util.todayISO(), 130), opt: { label: '未设置', invert: false } });
      html += '<button class="btn btn-primary btn-save" id="pgSave">保存</button>';
      html += '<p class="hint">预产期 = 末次月经 + 280 天（40周）。修改任一项会自动同步另一项。</p></div>';

      var cw = currentWeek();
      if (cw) {
        html += '<div class="card"><h2>当前进度</h2><ul class="kv">';
        html += '<li>孕周：<b>第 ' + cw.week + ' 周 + ' + cw.day + ' 天</b></li>';
        html += '<li>预产期：' + (cw.due ? Util.fmtDate(cw.due) : '未设置') + '</li>';
        html += '</ul><div class="progress"><div class="progress-bar" style="width:' + cw.percent + '%"></div></div>';
        html += '<p class="hint">进度 ' + cw.percent + '%</p></div>';
      } else {
        html += '<div class="card"><p class="hint">设置末次月经或预产期后显示孕周进度。</p></div>';
      }

      // 产检日历（P2-13：下一个未到节点给「下一个」高亮 tag，回答「现在该做什么」）
      var nextCheck = cw ? CHECKS.filter(function (c) { return c.week > cw.week; })[0] : null;
      html += '<div class="card"><h2>产检日历</h2><ul class="list">';
      CHECKS.forEach(function (c) {
        var status;
        if (cw && cw.week >= c.week) status = '<span class="tag">已过</span>';
        else if (c === nextCheck) status = '<span class="tag tag-accent">下一个</span>';
        else status = '<span class="tag">未到</span>';
        html += '<li>' + icon('calendar') + '<span>孕' + c.week + '周：' + c.title + '<br><small>' + c.desc + '</small></span>' +
          status + '</li>';
      });
      html += '</ul>';
      html += '<label>自定义产检备注（孕周）<input type="number" id="ckWeek" min="0" max="45" placeholder="如 30" value="' + (cw ? cw.week : '') + '"></label>';
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

      // 宝妈孕期体重（对标报告 A4，第 38 次）：只记录与自比，不给增重达标线（U-25）
      var mw = d.pregnancy.weights || [];
      html += '<div class="card"><h2>宝妈体重</h2>';
      html += '<div class="row">' + Util.dateSlider({ id: 'mwDate', title: '日期', value: Util.todayISO(), min: Util.addDays(Util.todayISO(), -31), max: Util.todayISO() }) + '</div>';
      /* 体重改尺滑杆录入（第 42 次）：孕期每周只增 0.3–0.5kg，0.1 步进的滑杆比数字键盘好按得多 */
      html += Util.rulerHTML('mwRuler', { unit: 'kg', label: '体重' });
      html += '<button class="btn btn-primary btn-save" id="mwAdd">保存体重</button>';
      if (mw.length) {
        var mwSorted = mw.slice().sort(function (a, b) { return new Date(a.date) - new Date(b.date); });
        var mwGain = (mwSorted[mwSorted.length - 1].kg - mwSorted[0].kg).toFixed(1);
        html += '<p class="hint">从 ' + Util.fmtDate(mwSorted[0].date) + ' 到现在变化 ' + (mwGain > 0 ? '+' : '') + mwGain + ' kg。'
          + '孕期增重因人而异，具体范围请参考产检医生意见。</p>';
        html += '<ul class="list">';
        mw.slice().sort(function (a, b) { return new Date(b.date) - new Date(a.date); }).forEach(function (r) {
          html += '<li>' + icon('pregnancy') + '<span>' + Util.fmtDate(r.date)
            + (r.week != null ? '（孕 ' + r.week + ' 周）' : '') + ' ｜ <b>' + r.kg + ' kg</b></span>'
            + '<button class="icon-btn" data-mw="' + r.id + '" aria-label="删除" title="删除">' + icon('trash') + '</button></li>';
        });
        html += '</ul>';
      } else {
        html += '<p class="hint">孕期体重记几次，就能看到自己的变化曲线。增重范围因人而异，以产检医生意见为准。</p>';
      }
      html += '</div>';

      // 产检记录
      html += '<div class="card"><h2>产检记录</h2>';      html += '<label>项目<input type="text" id="rcItem" placeholder="如 宫高 / 体重 / 血压"></label>';
      html += '<label>数值<input type="text" id="rcVal" placeholder="如 28cm / 120/80"></label>';
      html += Util.dateSlider({ id: 'rcDate', title: '日期', value: Util.todayISO(), min: Util.addDays(Util.todayISO(), -31), max: Util.todayISO() });
      html += '<button class="btn btn-primary btn-save" id="rcAdd">保存记录</button>';
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

      /* 第 59 次：医学提示（遵医嘱） */
      html += '<p class="hint med-note">孕周与预产期为估算值；产检安排与一切医学判断请遵医嘱。</p>';

      view.innerHTML = html;
      Util.bindDateSliders(view);

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
        if (Storage.save()) Util.toast('已添加产检备注：孕 ' + wk + ' 周', 'ok'); /* C1 */
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
      /* 宝妈孕期体重：保存 / 删除（P2 A4；第 42 次改尺滑杆录入） */
      var MW = { min: 30, max: 150, step: 0.1, dec: 1, anchor: 62.5 };
      var mwVal = null; /* null = 还没设置过（滑杆停在 anchor 但不算已填） */
      /* U-06：预填最近一次记录 */
      if (mw.length) {
        var lastW = mw.slice().sort(function (a, b) { return new Date(b.date) - new Date(a.date); })[0];
        if (lastW && lastW.kg != null) mwVal = lastW.kg;
      }
      function paintMW() {
        Util.rulerPaint('mwRuler', {
          min: MW.min, max: MW.max, step: MW.step, value: mwVal, anchor: MW.anchor, dec: MW.dec, unit: MW.unit || 'kg', label: '体重'
        });
      }
      paintMW();
      var mwRange = view.querySelector('#mwRulerRange');
      if (mwRange) mwRange.addEventListener('input', function () {
        mwVal = Math.round(parseFloat(mwRange.value) * 10) / 10;
        paintMW();
      });
      var mwMinus = view.querySelector('#mwRulerMinus');
      if (mwMinus) mwMinus.addEventListener('click', function () {
        mwVal = Math.round(((mwVal != null ? mwVal : MW.anchor) - MW.step) * 10) / 10;
        paintMW();
      });
      var mwPlus = view.querySelector('#mwRulerPlus');
      if (mwPlus) mwPlus.addEventListener('click', function () {
        mwVal = Math.round(((mwVal != null ? mwVal : MW.anchor) + MW.step) * 10) / 10;
        paintMW();
      });

      view.querySelector('#mwAdd').addEventListener('click', function () {
        var dateEl = view.querySelector('#mwDate');
        var kg = mwVal;
        var bad = false;
        if (kg == null || isNaN(kg) || kg < MW.min || kg > MW.max) { Util.toast('请用滑杆设置 30–150 之间的体重', 'warn'); bad = true; }
        if (!dateEl.value) { Util.markInvalid(dateEl, '请选择日期'); bad = true; }
        if (bad) return;
        /* 孕周按「记录日期」推算，补记过去的体重不带今天的孕周 */
        var base = pg.lmp || (pg.dueDate ? Util.addDays(pg.dueDate, -280) : null);
        var wkAt = base ? Math.max(0, Math.floor(Util.daysBetween(base, dateEl.value) / 7)) : null;
        d.pregnancy.weights = d.pregnancy.weights || [];
        d.pregnancy.weights.push({ id: Util.uid(), date: dateEl.value, kg: Math.round(kg * 10) / 10, week: wkAt });
        if (Storage.save()) Util.toast('已记录体重：' + Math.round(kg * 10) / 10 + ' kg' + (wkAt != null ? '（孕 ' + wkAt + ' 周）' : ''), 'ok');
        global.App.rerender();
      });
      Array.prototype.forEach.call(view.querySelectorAll('[data-mw]'), function (b) {
        b.addEventListener('click', function () {
          Util.removeWithUndo(d.pregnancy.weights, b.getAttribute('data-mw'), {
            onSave: function () { Storage.save(); },
            onAfter: function () { global.App.rerender(); },
            deletedText: '已删除体重记录'
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
        if (Storage.save()) Util.toast('已记录：' + item, 'ok'); /* C1 */
        global.App.rerender();
      });
      var rcClear = view.querySelector('#rcClear');
      if (rcClear) rcClear.addEventListener('click', function () {
        /* U-33：不可逆批量操作走阻断路径——后果说明 + 立即导出口 + 防误触 */
        Util.confirm({
          title: '清空全部产检记录',
          message: '将删除本机保存的全部产检记录，此操作不可恢复。',
          okText: '仍要清空',
          danger: true,
          extra: { text: '先导出备份', onClick: function () { global.App.exportAll(); } },
          onConfirm: function () { d.prenatal.records = []; Storage.save(); global.App.rerender(); }
        });
      });
    }
  };
})(window);
