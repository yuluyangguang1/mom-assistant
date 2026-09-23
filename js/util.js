/**
 * util.js - 通用工具函数（无依赖、纯原生）
 * 所有函数挂载到 window.Util，供其他模块使用。
 */
(function (global) {
  'use strict';

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  var Util = {
    /** 生成简单唯一 id */
    uid: function () {
      return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    },

    /** 今天的本地日期字符串 yyyy-mm-dd */
    todayISO: function () {
      var d = new Date();
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    },

    /** 当前的本地日期时间字符串 yyyy-mm-ddThh:mm:ss（避免使用 toISOString 的 UTC 偏移） */
    nowLocal: function () {
      var d = new Date();
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
        'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    },

    /** 格式化日期（兼容 yyyy-mm-dd 与 yyyy-mm-ddThh:mm:ss） */
    fmtDate: function (iso) {
      if (!iso) return '';
      var d = new Date(iso);
      if (isNaN(d.getTime())) return String(iso);
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    },

    /** 格式化日期时间 */
    fmtDateTime: function (iso) {
      if (!iso) return '';
      var d = new Date(iso);
      if (isNaN(d.getTime())) return String(iso);
      return this.fmtDate(iso) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    },

    /** 两个日期（或日期时间）相差天数 b - a */
    daysBetween: function (a, b) {
      var da = new Date(a), db = new Date(b);
      return Math.round((db.getTime() - da.getTime()) / 86400000);
    },

    /** 在 iso 日期上加 n 天（n 可为负） */
    addDays: function (iso, n) {
      var d = new Date(iso);
      d.setDate(d.getDate() + n);
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    },

    /** 毫秒时长 -> 人类可读（x小时y分 / y分） */
    fmtDuration: function (ms) {
      if (ms == null || isNaN(ms) || ms < 0) return '0分';
      var totalMin = Math.floor(ms / 60000);
      var h = Math.floor(totalMin / 60);
      var m = totalMin % 60;
      if (h > 0) return h + '小时' + m + '分';
      return m + '分';
    },

    /** HTML 转义，防止 XSS */
    escapeHtml: function (s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    },

    /** 浏览器下载文本/JSON 文件（离线可用，无网络请求） */
    download: function (filename, text, mime) {
      var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    },

    /** 把全部数据按「天」聚合，用于日历打点与当日明细（首页与「日期记录」页共用，单一来源） */
    buildDayIndex: function (d) {
      d = d || {};
      function isoOf(s) { return (s || '').slice(0, 10); }
      var idx = {};
      function add(iso, ic, label, val) {
        if (!iso) return;
        if (!idx[iso]) idx[iso] = [];
        idx[iso].push({ icon: ic, label: label, val: val });
      }
      (d.feedings || []).forEach(function (r) {
        var t = r.type === 'breast' ? '母乳' : (r.type === 'bottle' ? '奶瓶' : (r.type === 'solid' ? '辅食' : '喂养'));
        var v = r.type === 'breast' ? (r.duration ? r.duration + ' 分' : '') : (r.amount ? r.amount + (r.type === 'solid' ? ' g' : ' ml') : '');
        add(isoOf(r.start), 'feeding', t, v);
      });
      (d.sleeps || []).forEach(function (r) {
        if (!r.start) return;
        var v = r.end ? Util.fmtDuration(new Date(r.end) - new Date(r.start) - (r.pausedMs || 0)) : '';
        add(isoOf(r.start), 'sleep', '睡眠', v);
      });
      (d.growth || []).forEach(function (r) { add(r.date, 'growth', '生长', (r.weightKg ? r.weightKg + ' kg ' : '') + (r.heightCm ? r.heightCm + ' cm' : '')); });
      (d.diapers || []).forEach(function (r) {
        var t = r.type === 'pee' ? '尿' : (r.type === 'poop' ? '便' : '尿+便');
        add(isoOf(r.time), 'diaper', '尿布', t);
      });
      if (d.vaccines && d.vaccines.done) {
        Object.keys(d.vaccines.done).forEach(function (k) {
          add(d.vaccines.done[k], 'vaccine', '疫苗接种', '');
        });
      }
      (d.periods || []).forEach(function (r) { if (r.start) add(isoOf(r.start), 'period', '经期', ''); });
      if (d.prenatal && d.prenatal.records) d.prenatal.records.forEach(function (r) { add(r.date, 'pregnancy', '产检', r.item || ''); });
      (d.contractions || []).forEach(function (r) { if (r.start) add(isoOf(r.start), 'contraction', '宫缩', ''); });
      if (d.finance && d.finance.records) d.finance.records.forEach(function (r) { add(r.date, 'finance', '记账', '¥' + (r.amount || 0)); });
      return idx;
    }
  };

  global.Util = Util;

  /* -----------------------------------------------------------
   * 自定义确认弹层：替代原生 confirm，保持暖调设计一致性。
   * opts: { title, message, okText, cancelText, danger, onConfirm }
   */
  Util.confirm = function (opts) {
    opts = opts || {};
    var root = document.getElementById('modalRoot');
    if (!root) { if (typeof opts.onConfirm === 'function') opts.onConfirm(); return; }
    var title = opts.title || '请确认';
    var message = opts.message || '';
    var okText = opts.okText || '确认';
    var cancelText = opts.cancelText || '取消';
    var danger = !!opts.danger;
    var leadIcon = (window.icon && icon('heart')) ? icon('heart') : '';

    root.innerHTML =
      '<div class="modal-mask" data-cfm-mask>' +
        '<div class="modal" role="alertdialog" aria-modal="true" aria-labelledby="cfmTitle" aria-describedby="cfmMsg">' +
          '<h2 id="cfmTitle">' + leadIcon + Util.escapeHtml(title) + '</h2>' +
          '<p id="cfmMsg">' + Util.escapeHtml(message) + '</p>' +
          '<div class="modal-actions">' +
            '<button type="button" class="btn" data-cfm-cancel>' + Util.escapeHtml(cancelText) + '</button>' +
            '<button type="button" class="btn ' + (danger ? 'btn-danger' : 'btn-primary') + '" data-cfm-ok>' + Util.escapeHtml(okText) + '</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    var mask = root.querySelector('[data-cfm-mask]');
    var okBtn = root.querySelector('[data-cfm-ok]');
    var cancelBtn = root.querySelector('[data-cfm-cancel]');

    function close() { root.innerHTML = ''; document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }

    okBtn.addEventListener('click', function () {
      close();
      if (typeof opts.onConfirm === 'function') opts.onConfirm();
    });
    cancelBtn.addEventListener('click', close);
    mask.addEventListener('click', function (e) { if (e.target === mask) close(); });
    document.addEventListener('keydown', onKey);

    /* 焦点管理：危险操作默认聚焦“取消”，避免误触销毁 */
    (danger ? cancelBtn : okBtn).focus();
  };

  /* -----------------------------------------------------------
   * 轻提示 toast：替代原生 alert，自动消失；可带一个操作按钮（如“撤销”）。
   * type: 'ok' | 'error' | 'warn' | 'info'（默认 info）
   * action: { label, onClick } 可选；存在时停留更久且按钮可点
   */
  Util.toast = function (message, type, action) {
    type = type || 'info';
    var root = document.getElementById('toastRoot');
    if (!root) {
      root = document.createElement('div');
      root.id = 'toastRoot';
      document.body.appendChild(root);
    }
    var ic = { ok: 'check', error: 'bell', warn: 'bell', info: 'bell' }[type] || 'bell';
    var el = document.createElement('div');
    el.className = 'toast toast-' + type;
    el.setAttribute('role', 'status');
    el.innerHTML = ((window.icon && icon(ic)) ? icon(ic) : '') + '<span>' + Util.escapeHtml(message) + '</span>';
    if (action && action.label) {
      var act = document.createElement('button');
      act.type = 'button';
      act.className = 'toast-action';
      act.textContent = action.label;
      el.appendChild(act);
      var acted = false;
      act.addEventListener('click', function () {
        if (acted) return; acted = true;
        if (typeof action.onClick === 'function') action.onClick();
        dismiss();
      });
    }
    root.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('show'); });
    var hideTimer = setTimeout(dismiss, action && action.label ? 5200 : 2800);
    function dismiss() {
      clearTimeout(hideTimer);
      el.classList.remove('show');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 280);
    }
  };

  /* -----------------------------------------------------------
   * 行内校验：精准定位错误字段（替代模糊 toast 提示）。
   * inputs: 单个 input/select 或其数组；msg 为空则仅清除错误态。
   * 输入任意值后错误态自动解除。
   */
  Util.markInvalid = function (inputs, msg) {
    if (!inputs) return;
    inputs = (inputs.length != null && typeof inputs !== 'string') ? Array.prototype.slice.call(inputs) : [inputs];
    if (!inputs.length) return;
    inputs.forEach(function (e) { e.classList.remove('is-invalid'); e.removeAttribute('aria-invalid'); });
    var first = inputs[0];
    var lbl = first.closest ? first.closest('label') : first.parentNode;
    if (lbl) { var prev = lbl.querySelector(':scope > .field-error'); if (prev) prev.remove(); }
    if (!msg) return;
    inputs.forEach(function (e) { e.classList.add('is-invalid'); e.setAttribute('aria-invalid', 'true'); });
    var sm = document.createElement('small');
    sm.className = 'field-error';
    sm.textContent = msg;
    first.insertAdjacentElement('afterend', sm);
    try { first.focus(); } catch (e) {}
    inputs.forEach(function (e) {
      e.addEventListener('input', function clr() {
        var anyFilled = inputs.some(function (x) { return (x.value || '').trim() !== ''; });
        if (anyFilled) Util.markInvalid(inputs, null);
      });
    });
  };

  /* -----------------------------------------------------------
   * 删除带撤销：立即删除并提示，停留期内可“撤销”恢复。
   * 比二次确认更顺手，且避免误删造成的数据丢失。
   * opts: { onSave, onAfter, deletedText }
   */
  Util.removeWithUndo = function (arr, id, opts) {
    opts = opts || {};
    var idx = -1;
    for (var i = 0; i < arr.length; i++) { if (arr[i] && arr[i].id === id) { idx = i; break; } }
    if (idx < 0) return;
    var item = arr[idx];
    arr.splice(idx, 1);
    if (typeof opts.onSave === 'function') opts.onSave();
    if (typeof opts.onAfter === 'function') opts.onAfter();
    Util.toast(opts.deletedText || '已删除', 'ok', {
      label: '撤销',
      onClick: function () {
        if (idx > arr.length) idx = arr.length;
        arr.splice(idx, 0, item);
        if (typeof opts.onSave === 'function') opts.onSave();
        if (typeof opts.onAfter === 'function') opts.onAfter();
      }
    });
  };

  /* 安全兜底：icon()/illo() 在未加载 icons.js 时也返回 ''，避免 ReferenceError
   * （QA 沙箱只加载 util.js 不加载 icons.js；浏览器里 icons.js 会覆盖这两个兜底函数）。
   * 使用 if (!global.x) 守卫，无论脚本加载先后都不会覆盖真实实现。 */
  if (!global.icon) {
    global.icon = function () { return ''; };
  }
  if (!global.illo) {
    global.illo = function () { return ''; };
  }
})(window);
