/**
 * datamgr.js - 第 286 次：「数据管理」半屏（对照用户发的 Cali 截图 IMG_4721，样式用咿呀记自己的）
 *
 *   导入数据 → 选咿呀记的 JSON 备份 → 预览会新增 / 更新多少条、每个宝宝去哪（第 333 次：只按宝宝 uuid 对应，不按名字）→ 导入
 *   导出数据 → 完整 JSON 备份（App.exportAll）· 给家人 / 医生（不含私密，App.exportShare）· 表格 CSV（设置页同一份）
 *   导入历史 → 只存在这台设备（localStorage，不进备份）：时间、文件名、条数；不保存原文件
 *
 * Cali 宝宝 / 月芽 / PiyoLog 的导出格式手上没有样本，不猜解析：选了别的文件只提示「暂时只能导入咿呀记的 JSON 备份」。
 * 入口：日期页跳转日期半屏底部、设置 ›「数据与备份」。
 */
(function (global) {
  'use strict';
  var Util = global.Util, Storage = global.Storage;
  var LOG_KEY = 'yiya-import-log';
  var esc = function (s) { return Util.escapeHtml(s == null ? '' : String(s)); };
  var CHEV = '<span class="dm-chev" aria-hidden="true">' + (global.icon ? icon('chevron-right') : '›') + '</span>';
  var CSV_OPTS = [['feedings', '喂养记录'], ['sleeps', '睡眠记录'], ['diapers', '尿布记录'], ['meds', '吃药记录'], ['growth', '生长记录'],
    ['milestones', '里程碑'], ['sicks', '生病记录'], ['vaccines', '疫苗接种'], ['supplements', '营养品服用记录'], ['contractions', '宫缩记录'], ['periods', '经期记录'], ['finance', '记账记录']];

  function readLog() {
    try {
      var a = JSON.parse(global.localStorage.getItem(LOG_KEY) || '[]');
      return Array.isArray(a) ? a.filter(function (x) { return x && typeof x === 'object'; }) : [];
    } catch (e) { return []; }
  }
  function pushLog(en) {
    var a = readLog();
    a.unshift(en);
    try { global.localStorage.setItem(LOG_KEY, JSON.stringify(a.slice(0, 50))); } catch (e) { /* 存不下就算了，不挡导入 */ }
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmtT(ms) { var d = new Date(ms); return isFinite(d.getTime()) ? d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) : ''; }

  /* 是不是咿呀记自己的备份：对象，且带版本号或宝宝档案或记录数组之一 */
  function looksYiya(o) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
    if (typeof o.version === 'number' && o.settings && typeof o.settings === 'object') return true;
    return Array.isArray(o.babies) || Array.isArray(o.feedings) || Array.isArray(o.diapers) || Array.isArray(o.sleeps);
  }

  var api = null, view = 'main', pending = null, busy = false, lastMsg = '';

  function mainHTML() {
    return (lastMsg ? '<p class="dm-msg" role="status">' + esc(lastMsg) + '</p>' : '')
      + '<div class="dm-group">'
      + '<button type="button" class="dm-row" data-dm="import"><span class="dm-ico">' + icon('import') + '</span><b>导入数据</b>' + CHEV + '</button>'
      + '<button type="button" class="dm-row" data-dm="export"><span class="dm-ico">' + icon('export') + '</span><b>导出数据</b>' + CHEV + '</button></div>'
      + '<p class="dm-note">支持咿呀记导出的 JSON 备份。同一个宝宝的记录合并，另一个宝宝档案单独导入。</p>'
      + '<div class="dm-group"><button type="button" class="dm-row" data-dm="log"><span class="dm-ico">' + icon('calendar') + '</span><b>导入历史</b>'
      + '<small class="dm-cnt">' + (readLog().length ? readLog().length + ' 次' : '') + '</small>' + CHEV + '</button></div>'
      + '<p class="dm-note">导入历史只保存在这台设备上，只记时间、文件名和条数，不保存原始文件。</p>';
  }
  function backHTML(t) { return '<button type="button" class="dm-back" data-dm="back">‹ 数据管理</button><p class="dm-sub">' + t + '</p>'; }
  function exportHTML() {
    return backHTML('导出数据')
      + '<div class="dm-group">'
      + '<button type="button" class="dm-row" data-dm="exAll"><span class="dm-txt"><b>完整备份（JSON）</b><small>全部宝宝、全部记录，换手机 / 恢复用</small></span>' + CHEV + '</button>'
      + '<button type="button" class="dm-row" data-dm="exShare"><span class="dm-txt"><b>给家人 / 医生（JSON）</b><small>不含情绪、经期、记账</small></span>' + CHEV + '</button></div>'
      + '<p class="dm-sub">表格（CSV）</p><div class="dm-group dm-csv"><select id="dmCsv" aria-label="选择要导出 CSV 的记录">'
      + CSV_OPTS.map(function (o) { return '<option value="' + o[0] + '">' + o[1] + '</option>'; }).join('')
      + '</select><button type="button" class="btn btn-mini" data-dm="exCsv">导出 CSV</button></div>'
      + '<p class="dm-note">导出的文件是明文，请存到你信任的位置。</p>';
  }
  function logHTML() {
    var a = readLog();
    var h = backHTML('导入历史');
    if (!a.length) return h + '<p class="dm-empty">还没有导入过</p>';
    h += '<ul class="dm-group dm-log">';
    a.forEach(function (x) {
      h += '<li><span class="dm-txt"><b>' + esc(x.name || '未命名文件') + '</b><small>' + esc(fmtT(x.t)) + ' · ' + esc(x.nb ? '新增 ' + (Number(x.nb) || 0) + ' 个宝宝档案' : (x.target === 'new' ? '新建宝宝' : '合并')) + '</small></span>'
        + '<span class="dm-n">' + (Number(x.n) || 0) + ' 条</span></li>';
    });
    return h + '</ul><button type="button" class="dm-clear" data-dm="clearLog">清空导入历史</button>';
  }
  /* 第 333 次：宝宝只按 uuid 对应——不再让用户选「合并到当前宝宝 / 新建宝宝」。
     预览按宝宝列出去向：同一个宝宝（同 uuid）→ 合并；另一个宝宝档案 → 单独导入。
     同名但 uuid 不同：只提示一句「这是另一个宝宝档案，会单独导入」，不提供合并。 */
  function previewHTML() {
    var p = pending, pv = p.pv;
    var h = backHTML('导入预览') + '<p class="dm-file">' + esc(p.name) + '</p>';
    if (!pv) return h + '<p class="dm-msg is-warn">这个文件读不出来，换一个试试。</p>';
    if (!pv.total) h += '<p class="dm-msg">文件里的记录本机都已经有了，没有要新增的。</p>';
    else {
      h += '<p class="dm-big"><b>' + pv.total + '</b> 条' + (pv.updated && pv.added ? '（新增 ' + pv.added + '，更新 ' + pv.updated + '）' : pv.updated ? '更新' : '新记录') + '</p><ul class="dm-parts">'
        + pv.parts.slice(0, 8).map(function (x) { return '<li><span>' + esc(x.name) + '</span><b>' + x.n + '</b></li>'; }).join('') + '</ul>'
        + (pv.parts.length > 8 ? '<p class="dm-note">还有 ' + (pv.parts.length - 8) + ' 类</p>' : '');
    }
    var bs = (pv.babies || []).filter(function (b) { return b.mode !== 'skip'; });
    if (bs.length) {
      h += '<p class="dm-sub">宝宝</p><ul class="dm-group dm-babies">' + bs.map(function (b) {
        return '<li class="dm-bb" data-bb-mode="' + b.mode + '"><span class="dm-txt"><b>' + esc(b.name) + '</b><small>'
          + (b.mode === 'merge' ? '合并到本机同一个宝宝' : '新的宝宝档案') + '</small></span><span class="dm-n">' + (Number(b.n) || 0) + ' 条</span></li>';
      }).join('') + '</ul>';
    }
    if ((pv.sameNameOther || []).length) {
      h += '<p class="dm-msg dm-twin" role="note">「' + esc(pv.sameNameOther.join('」「')) + '」这是另一个宝宝档案，会单独导入。</p>';
    }
    h += '<p class="dm-note">同一条记录只留一份，两边都改过的以较新的为准；本机记录不会被删。</p>';
    if (global.App && App.overwriteFrom) h += '<button type="button" class="dm-clear dm-over" data-dm="overwrite">整体覆盖本机…</button>';
    h += '<div class="rs-savebar"><button type="button" class="btn btn-primary rs-save" data-dm="doImport"' + (pv.total ? '' : ' disabled') + '>' + (pv.total ? '导入 ' + pv.total + ' 条' : '没有可导入的') + '</button></div>';
    return h;
  }
  function paint() {
    if (!api) return;
    var box = api.box.querySelector('.dm-body');
    if (!box) return;
    box.innerHTML = view === 'export' ? exportHTML() : view === 'log' ? logHTML() : view === 'preview' && pending ? previewHTML() : mainHTML();
  }
  function pickFile() {
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json,application/json,text/plain';
    inp.addEventListener('change', function () {
      var f = inp.files && inp.files[0];
      if (!f) return;
      var r = new FileReader();
      r.onload = function () { DataMgr._preview(String(r.result), f.name); };
      r.readAsText(f);
    });
    inp.click();
  }

  var DataMgr = {
    open: function () {
      if (!global.FTUI) return null;
      view = 'main'; pending = null; lastMsg = ''; busy = false;
      api = FTUI.openSheet('', '数据管理', '<div class="dm-body"></div>', null);
      if (!api) return null;
      var ok = api.box.querySelector('[data-ok]');
      if (ok) ok.remove();
      api.box.parentNode.classList.add('dm-sheet');
      var prevClose = api.onClose;
      api.onClose = function () { api = null; if (prevClose) prevClose(); };
      api.box.addEventListener('click', function (e) {
        if (Util.hapEcho && Util.hapEcho(e)) return;
        var t = e.target.closest ? e.target.closest('[data-dm]') : null;
        if (!t || t.disabled) return;
        var k = t.getAttribute('data-dm');
        if (k === 'overwrite' && pending && global.App && App.overwriteFrom) { var tx = pending.text; api.close(); App.overwriteFrom(tx); return; }
        if (k === 'back') { view = 'main'; pending = null; paint(); return; }
        if (k === 'import') { pickFile(); return; }
        if (k === 'export') { view = 'export'; paint(); return; }
        if (k === 'log') { view = 'log'; paint(); return; }
        if (k === 'exAll') { if (global.App && App.exportAll) App.exportAll(); return; }
        if (k === 'exShare') { if (global.App && App.exportShare) App.exportShare(); return; }
        if (k === 'exCsv') { var sel = api.box.querySelector('#dmCsv'); if (sel && global.Modules && Modules.settings && Modules.settings._csv) Modules.settings._csv(sel.value); return; }
        if (k === 'clearLog') { try { global.localStorage.removeItem(LOG_KEY); } catch (eL) {} paint(); return; }
        if (k === 'doImport') DataMgr._commit();
      });
      paint();
      return api;
    },
    /* 读完文件：只认咿呀记的 JSON 备份；两种去向各算一遍预览（不改本机） */
    _preview: function (text, name) {
      name = String(name || '').slice(0, 80);
      var o = null;
      try { o = JSON.parse(text); } catch (e) { o = null; }
      if (!looksYiya(o)) {
        lastMsg = '「' + name + '」不是咿呀记的备份文件。现在只能导入咿呀记导出的 JSON 备份，Cali 宝宝、月芽、PiyoLog 等其他 App 的文件暂不支持。';
        view = 'main'; pending = null; paint();
        return false;
      }
      var pv = null;
      try { pv = Storage.mergeJSON(text, { dryRun: true }); } catch (e) { pv = null; }
      pending = { text: text, name: name, pv: pv };
      lastMsg = ''; view = 'preview'; paint();
      return true;
    },
    _commit: function () {
      if (busy || !pending) return null; /* 第 281 次同款：连点只导一次 */
      busy = true;
      var p = pending, r = null;
      try { r = Storage.mergeJSON(p.text); } catch (e) { Util.toast('导入失败：' + (e && e.message ? e.message : e), 'error'); busy = false; return null; }
      pushLog({ t: Date.now(), name: p.name, n: r.total, nb: r.newBabies });
      pending = null; view = 'main';
      lastMsg = '已导入 ' + r.total + ' 条' + (r.newBabies ? '，新增 ' + r.newBabies + ' 个宝宝档案' : '') + '。';
      Util.toast(lastMsg, 'ok');
      if (global.App) { if (App.refreshHeaderAvatar) App.refreshHeaderAvatar(); App.rerender(); }
      busy = false;
      paint();
      return r;
    },
    _log: readLog,
    _looksYiya: looksYiya,
    _pickFile: pickFile,
    openImport: function () { if (DataMgr.open()) pickFile(); }
  };
  global.DataMgr = DataMgr;
})(window);
