/**
 * finance.js - 母婴记账
 * 第 283 次：迁到新骨架（与尿布 / 营养品 / modskel 各页一致）——
 *   页头插画 → 摘要句 → 本月看板（本月 / 全部支出、按分类条形）→ 最近记录时间轴（点按修改、左滑删除）
 *   → 底部固定「+ 记一笔」（第 282 次共用实现）→ 半屏面板（金额 / 分类 / 日期 / 备注，保存吸底）。
 *   页面上不再直接填表。数据形状不变：d.finance.records = [{ id, amount, category, note, date:'yyyy-mm-dd' }]。
 *   口径照第 274 次：统计分写「本月（N 月）」「全部（最早一笔日期 起）」，金额统一 Util.fmtYuan。
 */
(function (global) {
  'use strict';
  var Storage = global.Storage, Util = global.Util;
  var Modules = global.Modules = global.Modules || {};

  /* C5：母婴日常高频是奶粉/纸尿裤，原表缺「纸尿裤」「用品」（研究清单模块 12） */
  var CATS = ['产检', '待产', '奶粉', '纸尿裤', '用品', '药品', '早教', '衣物', '玩具', '其他'];
  var MAX_AMT = 1000000;

  function esc(s) { return Util.escapeHtml(s == null ? '' : String(s)); }
  function amtOf(r) { var v = parseFloat(r && r.amount); return isFinite(v) ? v : 0; }
  function validDay(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }
  function recs(d) {
    if (!d.finance || typeof d.finance !== 'object') d.finance = { records: [] };
    if (!Array.isArray(d.finance.records)) d.finance.records = [];
    return d.finance.records;
  }
  /* 时间轴左列：今天 / 昨天 / 10/24（跨年带年份） */
  function dayLab(iso, today) {
    if (iso === today) return '今天';
    if (iso === Util.addDays(today, -1)) return '昨天';
    var y = iso.slice(0, 4), m = +iso.slice(5, 7), dd = +iso.slice(8, 10);
    return (y === today.slice(0, 4) ? '' : y.slice(2) + '/') + m + '/' + dd;
  }

  /* ---------- 半屏面板：记一笔 / 修改 ---------- */
  var openAt = 0;
  function openSheet(d, rec) {
    var FT = global.FTUI;
    if (!FT) return;
    if (Date.now() - openAt < 450) return; /* 第 281 次同款：手指连点不开两个 */
    openAt = Date.now();
    var editing = !!rec;
    var list = recs(d);
    var last = list[list.length - 1];
    /* C5：分类默认取上一次所选（U-06 同款） */
    var cat = editing ? rec.category : ((last && CATS.indexOf(last.category) >= 0) ? last.category : CATS[0]);
    if (CATS.indexOf(cat) < 0) cat = '其他';
    var today = Util.todayISO();
    var day = editing && validDay(rec.date) ? rec.date : today;
    var newId = editing ? rec.id : Util.uid();
    var body = '<p class="rs-lbl">金额</p>'
      + '<label class="rs-tile sk-num fin-amt"><span class="fin-yuan" aria-hidden="true">¥</span><input type="number" id="fAmt" inputmode="decimal" step="0.01" min="0.01" max="' + MAX_AMT + '" placeholder="0.00"'
      + ' value="' + (editing ? esc(amtOf(rec)) : '') + '" aria-label="金额（元）"><span>元</span></label>'
      + '<p class="rs-lbl">分类</p><div class="rs-seg sk-seg sk-n5 fin-cats" role="radiogroup" aria-label="分类">';
    CATS.forEach(function (c) {
      var on = c === cat;
      body += '<button type="button" class="' + (on ? 'on' : '') + '" data-fcat="' + esc(c) + '" role="radio" aria-checked="' + on + '">' + esc(c) + '</button>';
    });
    body += '</div>'
      + '<p class="rs-lbl">日期</p><div class="rs-when ft-when fin-when">'
      + '<label class="rs-tile ft-tile"><span class="ft-ti">' + ((FT.SV && FT.SV.cal) || '') + '</span><span class="ft-tt"><small>日期</small>'
      + '<b data-show="fDate"></b><input type="date" class="ft-hid" id="fDate" value="' + day + '" max="' + today + '" aria-label="日期"></span></label></div>'
      + '<label class="rs-note"><span class="rs-lbl">备注</span><input type="text" id="fNote" maxlength="40" placeholder="可选，比如「两罐 3 段」" value="' + esc((editing && rec.note) || '') + '"></label>'
      + (editing ? '<button type="button" class="btn rs-del" data-fdel>删除这笔</button>' : '')
      + '<div class="rs-savebar"><button type="button" class="btn btn-primary rs-save" id="fSave">' + (editing ? '保存修改' : '保存') + '</button></div>';

    FT.openSheet('finance', editing ? '修改这笔' : '记一笔', body, function (api) {
      var box = api.box, closed = false, saving = false;
      api.onClose = (function (prev) { return function () { closed = true; if (prev) prev.apply(this, arguments); }; })(api.onClose);
      var di = box.querySelector('#fDate');
      if (di && di._paint) di._paint();
      box.addEventListener('click', function (e) {
        if (closed || (Util.hapEcho && Util.hapEcho(e))) return;
        var b = e.target.closest ? e.target.closest('button') : null;
        if (!b || !box.contains(b)) return;
        if (b.id === 'fSave' || b.hasAttribute('data-ok')) { save(); return; }
        if (b.hasAttribute('data-fdel')) { closed = true; api.close(); remove(d, rec.id); return; }
        var c = b.getAttribute('data-fcat');
        if (c) {
          cat = c;
          Array.prototype.forEach.call(box.querySelectorAll('[data-fcat]'), function (x) {
            var on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', String(on));
          });
        }
      });
      function save() {
        if (saving || closed) return;
        var el = box.querySelector('#fAmt');
        var raw = String(el.value).trim(), n = Number(raw);
        /* 第 273 次（审计 #20：0 元也能存）：金额必须是大于 0 的数 */
        if (!raw || !isFinite(n) || !(n > 0)) { Util.markInvalid(el, '请填写大于 0 的金额'); return; }
        if (n > MAX_AMT) { Util.markInvalid(el, '金额太大了，请检查一下'); return; }
        n = Math.round(n * 100) / 100;
        var dv = (box.querySelector('#fDate') || {}).value;
        if (!validDay(dv)) { Util.toast('日期不完整', 'warn'); return; }
        if (dv > Util.todayISO()) { Util.toast('这一天还没到，请检查一下', 'warn'); return; }
        saving = true;
        var note = (((box.querySelector('#fNote') || {}).value) || '').trim().slice(0, 40) || null;
        var r = null;
        for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === newId) { r = list[i]; break; }
        var isNew = !r;
        if (isNew) { r = { id: newId }; list.push(r); }
        r.amount = n; r.category = cat; r.note = note; r.date = dv;
        if (!Storage.save()) { saving = false; return; }
        closed = true; api.close();
        global.App.rerender();
        if (isNew) Util.toast('已记录：' + Util.fmtYuan(n) + ' · ' + cat, 'ok', { label: '撤销', onClick: function () {
          for (var j = list.length - 1; j >= 0; j--) if (list[j] && list[j].id === newId) { list.splice(j, 1); break; }
          Storage.save(); global.App.rerender();
        } });
        else Util.toast('已保存', 'ok');
      }
    });
  }

  function remove(d, id) {
    Util.removeWithUndo(recs(d), id, {
      onSave: function () { Storage.save(); },
      onAfter: function () { global.App.rerender(); },
      deletedText: '已删除一笔账单'
    });
  }

  Modules.finance = {
    id: 'finance',
    title: '记账',
    render: function (view) {
      var d = Storage.get();
      var FT = global.FTUI;
      var all = recs(d).filter(function (r) { return r && validDay(r.date); })
        .slice().sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
      var today = Util.todayISO(), ym = today.slice(0, 7), mo = +ym.slice(5);
      var html = '';

      if (!all.length) {
        html += '<div class="sk-empty"><img src="assets/hero/finance.webp" alt="" width="220" height="220" decoding="sync">'
          + '<p>点按底部 + 记一笔</p></div>';
      } else {
        /* 第 274 次口径：本月 / 全部分写；分类小计标明是全部记录 */
        var total = 0, mTotal = 0, mN = 0, byCat = {}, mCat = {};
        all.forEach(function (r) {
          var a = amtOf(r); total += a;
          byCat[r.category] = (byCat[r.category] || 0) + a;
          if (r.date.slice(0, 7) === ym) { mTotal += a; mN++; mCat[r.category] = (mCat[r.category] || 0) + a; }
        });
        var first = all[all.length - 1].date;
        var mTop = Object.keys(mCat).sort(function (a, b) { return mCat[b] - mCat[a]; })[0];
        var sum = mN
          ? '本月（' + mo + ' 月）记了 <b>' + mN + ' 笔</b>，共 <b>' + esc(Util.fmtYuan(mTotal)) + '</b>' + (mTop ? '；花得最多的是<b>' + esc(mTop) + '</b>（' + esc(Util.fmtYuan(mCat[mTop])) + '）' : '') + '。'
          : '本月（' + mo + ' 月）还没有记账。最近一笔在 ' + esc(Util.fmtDate(all[0].date)) + '。';
        html += '<div class="mod-sum"><span class="ms-k">摘要</span><p>' + sum + '</p></div>';

        html += '<div class="card dash-card fin-dash"><h2>统计</h2>'
          + '<div class="fin-tot"><p><small>本月（' + mo + ' 月）支出：</small><b>' + Util.fmtYuan(mTotal) + '</b></p>'
          + '<p><small>全部（' + esc(Util.fmtDate(first)) + ' 起）支出：</small><b>' + Util.fmtYuan(total) + '</b></p></div>';
        var keys = Object.keys(byCat).sort(function (a, b) { return byCat[b] - byCat[a]; });
        var mx = keys.length ? byCat[keys[0]] : 0;
        html += '<p class="dash-sub">按分类（全部记录）</p><ul class="fin-bars">';
        keys.forEach(function (k) {
          var w = mx > 0 ? Math.max(2, Math.round(byCat[k] / mx * 100)) : 0;
          html += '<li><span class="fb-k">' + esc(k) + '：</span><span class="fb-bar" aria-hidden="true"><i style="width:' + w + '%"></i></span><span class="fb-v">' + Util.fmtYuan(byCat[k]) + '</span></li>';
        });
        html += '</ul><div class="fin-acts"><button type="button" class="btn-mini" id="fExp">导出本模块 CSV</button>'
          + '<button type="button" class="btn-mini" id="fClear">清空</button></div></div>';

        html += '<section class="mod-tl ft-tl"><p class="ms-k">最近记录</p><ul class="tl">';
        all.slice(0, 50).forEach(function (r) {
          html += '<li class="tl-row"><span class="tl-time ft-tlt fin-day">' + esc(dayLab(r.date, today)) + '</span><span class="tl-dot" aria-hidden="true"></span>'
            + '<button type="button" class="tl-card" data-fopen="' + esc(r.id) + '" aria-label="' + esc(Util.fmtDate(r.date) + ' ' + r.category + ' ' + Util.fmtYuan(amtOf(r))) + '，点按修改">'
            + '<span class="tl-ico">' + icon('finance') + '</span><span class="tl-txt"><b>' + esc(r.category) + '</b>'
            + (r.note ? '<small>' + esc(r.note) + '</small>' : '') + '</span>'
            /* 第 89 次（审计 B4）：坏金额回落 0，不渲染 NaN */
            + '<span class="li-num fin-num">' + Util.fmtYuan(amtOf(r)) + '</span>'
            + '<span class="tl-more" aria-hidden="true">' + ((FT && FT.SV && FT.SV.more) || '') + '</span></button>'
            + '<button type="button" class="tl-del" data-del="' + esc(r.id) + '" aria-label="删除" title="删除">' + icon('trash') + '</button></li>';
        });
        html += '</ul></section>';
      }

      html += '<div class="mod-cta"><button type="button" class="mc-main" data-fnew>' + icon('plus') + '<span>记一笔</span></button></div>';
      view.innerHTML = '<div class="ft-page fin-page" data-accent="finance">' + html + '</div>';

      view.querySelector('[data-fnew]').addEventListener('click', function () { openSheet(d, null); });
      Array.prototype.forEach.call(view.querySelectorAll('[data-fopen]'), function (b) {
        b.addEventListener('click', function () {
          var id = b.getAttribute('data-fopen');
          var it = recs(d).filter(function (x) { return x && x.id === id; })[0];
          if (it) openSheet(d, it);
        });
      });
      Array.prototype.forEach.call(view.querySelectorAll('[data-del]'), function (b) {
        b.addEventListener('click', function () { remove(d, b.getAttribute('data-del')); });
      });
      var fExp = view.querySelector('#fExp');
      if (fExp) fExp.addEventListener('click', function () {
        /* 第 273 次（审计 #18）：按 RFC 4180 转义，带 BOM、CRLF */
        var csv = Util.toCsv(['日期', '分类', '金额', '备注'], all.map(function (r) { return [r.date, r.category, r.amount, r.note || '']; }));
        Util.download('母婴账单_' + Util.todayISO() + '.csv', csv, 'text/csv;charset=utf-8');
      });
      var fClear = view.querySelector('#fClear');
      if (fClear) fClear.addEventListener('click', function () {
        /* U-33：不可逆批量操作走阻断路径——后果说明 + 立即导出口 + 防误触 */
        Util.confirm({
          title: '清空全部账单',
          message: '将删除本机保存的全部记账记录，此操作不可恢复。',
          okText: '仍要清空',
          danger: true,
          extra: { text: '先导出备份', onClick: function () { global.App.exportAll(); } },
          onConfirm: function () { recs(d).length = 0; Storage.save(); global.App.rerender(); }
        });
      });
      if (global.App && App.pendingDate) { var pd = App.pendingDate; App.pendingDate = null; if (validDay(pd)) setTimeout(function () { openSheet(d, null); var di = document.querySelector('#fDate'); if (di) { di.value = pd; if (di._paint) di._paint(); } }, 0); }
    },
    _openSheet: function (rec) { openSheet(Storage.get(), rec || null); }
  };
})(window);
