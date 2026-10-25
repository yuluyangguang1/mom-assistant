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

    /** 第 185 次：「宝宝吃了一顿」的口径——排除吸奶（妈妈的记录）。
        预测、距上次、今日次数都走这里。 */
    babyFeeds: function (arr) {
      return (arr || []).filter(function (r) { return r && r.type !== 'pump'; });
    },

    /** 第 185 次：记录时刻选择。留空 = 现在；选了就按选的时刻落库（夜里量的第二天补记不再错时）。 */
    timePickHTML: function (id, value) {
      return '<label class="time-pick">时刻<input type="time" id="' + id + '" value="' + (value || '') + '">'
        + '<span class="hint">不填就是现在</span></label>';
    },
    /** 读时刻：dateIso 为 yyyy-mm-dd（缺省今天）。选了未来时刻返回 null 并提示。 */
    stampFrom: function (root, id, dateIso) {
      var now = Util.nowLocal();
      var day = dateIso || now.slice(0, 10);
      var el = root && root.querySelector ? root.querySelector('#' + id) : null;
      var v = el && el.value ? String(el.value).slice(0, 5) : '';
      if (!/^\d{2}:\d{2}$/.test(v)) return day + now.slice(10);
      var iso = day + 'T' + v + ':00';
      if (new Date(iso).getTime() > Date.now() + 60000) {
        Util.toast('这个时刻还没到，请检查一下', 'warn');
        if (Util.markInvalid) Util.markInvalid(el, '时刻在未来');
        return null;
      }
      return iso;
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

    /* 第 146 次：时段的紧凑写法——起点用 fmtRowTime；同一天的终点只写 HH:MM，跨天再写日期 */
    fmtRange: function (a, b) {
      if (!b) return this.fmtRowTime(a) + ' 起';
      var da = new Date(a), db = new Date(b);
      if (isNaN(da.getTime()) || isNaN(db.getTime())) return this.fmtRowTime(a) + ' – ' + this.fmtRowTime(b);
      var same = da.toDateString() === db.toDateString();
      return this.fmtRowTime(a) + '–' + (same ? pad(db.getHours()) + ':' + pad(db.getMinutes()) : this.fmtRowTime(b));
    },

    /* 列表行的紧凑时间：今年省略年份（MM-DD HH:MM），往年带全 */
    fmtRowTime: function (iso) {
      if (!iso) return '';
      var d = new Date(iso);
      if (isNaN(d.getTime())) return String(iso);
      var hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
      if (d.getFullYear() === new Date().getFullYear()) return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + hm;
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + hm;
    },

    /** 两个日期（或日期时间）相差天数 b - a
        第 125 次修复：旧实现直接 `new Date(a)` / `new Date(b)` 相减——
        当一端是纯日期串 'YYYY-MM-DD'（按 UTC 午夜解析）而另一端带时分
        （按本地解析）时，中国时区（UTC+8）下同一天会算成 1 天：
          daysBetween('2026-10-11', '2026-10-11T23:00:00') === 1  ← 应为 0
        影响面极广（提醒「还有 N 天」/ 备份天数 / 经期天数 / 疫苗剩余）；
        且对 UTC 负偏移时区，纯日期串还会整体差一天。
        修法：先把两端都归一化到【本地日历日的零点】，再做天数差——
        语义回到「日历日之差」，与调用方的直觉（同一个日历日 = 0 天）一致。
        纯日期串按本地零点解析（不再走 UTC），负偏移时区问题同时消除。 */
    _dayStart: function (x) {
      if (x == null || x === '') return null;
      var s = String(x);
      /* 纯日期 'YYYY-MM-DD'：按本地零点构造，避开 UTC 解析 */
      var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.slice(0, 10));
      if (m && s.length <= 10) return new Date(+m[1], +m[2] - 1, +m[3]).getTime();
      var d = (x instanceof Date) ? x : new Date(x);
      if (isNaN(d.getTime())) return null;
      return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    },
    daysBetween: function (a, b) {
      var da = this._dayStart(a), db = this._dayStart(b);
      if (da === null || db === null) return 0; /* 坏数据不抛错，差值为 0 */
      return Math.round((db - da) / 86400000);
    },

    /** 在 iso 日期上加 n 天（n 可为负）
        第 125 次修复：改为本地零点构造 + 本地取值，不用 new Date('YYYY-MM-DD')
        （那是 UTC 午夜，UTC 负偏移时区下会差一天）。 */
    addDays: function (iso, n) {
      var base = this._dayStart(iso);
      if (base === null) return '';
      var d = new Date(base);
      d.setDate(d.getDate() + n);
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    },

    /* ============================================================
       第 131 次（P1-a · 对标 Cali DailyCareRecapBuilder 的 dayStart）：
       「日起始时刻」——照护日不必从公历 00:00 起算。
       ------------------------------------------------------------
       问题（用户 10-13 实测首屏时暴露的「距上次两套语义」）：
       睡眠口径是「凌晨入睡算前一晚」（nightKeyOf，6 点阈值，GAP-01），
       而喂养/尿布/吃药一律按公历日算「今日」——凌晨 00:30 记的一笔
       喂养算「今天」，同一时刻的一觉却算「昨夜」。对 23 点睡、
       早上 6 点前爬起来喂奶的家长，「今日次数」在半夜里是反直觉的。
       Cali 的对策：DailyCareRecapBuilder 接收可配的 dayStart，
       全部「今日/昨夜」统计按它归属。

       落地口径：
       · settings.dayStart = 照护日起始小时（0–12），缺省 0 = 公历日，
         与既有行为逐字节一致（老用户与全部测试零感知）；
       · dayKeyOf 只回答「这条记录算哪天」：纯日期串（生长/里程碑
         按日记的）本身就是日键，原样返回，绝不被挪前一天；
       · 只改【记录计数/归属】（首页磁贴、各页「今日」统计、
         ruleMeds/ruleFetal 的今日判定）；疫苗剂次、预产期、备份
         天数等日历日语义不动——门诊与预约认的是公历日。
       · 睡眠的 nightKeyOf 保持 6 点固定阈值：「夜」是领域概念，
         不随照护日设置漂移（dayStart=6 时两者自然重合）。
       ============================================================ */
    /** 照护日起始小时（0 = 公历日 00:00 起）。非法值回落 0。 */
    dayStartHour: function (d) {
      var v = d && d.settings && d.settings.dayStart;
      return (typeof v === 'number' && v >= 0 && v <= 12 && Math.floor(v) === v) ? v : 0;
    },
    /** 时间戳所属「照护日」键（yyyy-mm-dd）。
        x 可为 'yyyy-mm-dd'（原样返回）、'yyyy-mm-ddThh:mm:ss' 或 Date。
        本地时刻早于 dayStart → 归前一天（dayStart=0 时永不触发，
        与 todayISO() 逐字节一致）。 */
    dayKeyOf: function (x, dayStart) {
      var ds = (typeof dayStart === 'number' && dayStart > 0 && dayStart <= 12) ? dayStart : 0;
      if (x == null || x === '') return '';
      if (!(x instanceof Date)) {
        var s = String(x);
        /* 纯日期串 = 日键，原样返回；但必须严格形如 yyyy-mm-dd。
           恰好 10 字符的脏串（如 'not-a-date'）不能原样变成日键——
           那会让记录永远匹配不上「今日」，统计静默少一笔。
           非严格串落到下方 Date 解析，解析不了返回 ''。 */
        if (s.length <= 10 && /^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
      }
      var dt = (x instanceof Date) ? x : new Date(x);
      if (isNaN(dt.getTime())) return '';
      var iso = dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate());
      return (ds > 0 && dt.getHours() < ds) ? this.addDays(iso, -1) : iso;
    },

    /** 毫秒时长 -> 人类可读（x小时y分 / y分） */
    fmtDuration: function (ms) {
      if (ms == null || isNaN(ms) || ms < 0) return '0分';
      var totalMin = Math.floor(ms / 60000);
      var h = Math.floor(totalMin / 60);
      var m = totalMin % 60;
      /* 第 146 次（格式化层）：满 24 小时改说「天+小时」，不再出现「260小时5分」 */
      if (h >= 24) return Math.floor(h / 24) + '天' + (h % 24 ? (h % 24) + '小时' : '');
      if (h > 0) return h + '小时' + (m ? m + '分' : '');
      return m + '分';
    },

    /* ============ 第 146 次（P1 · 统一格式化层）============
       审计发现同一个「距上次」在各页各算各的：喂养页「260 小时」、胎动页「4000 分钟前」、
       首页「距今 11 天」。统一收口到这两个函数，档位一致：
       <1 分 刚刚 · <1 时 N 分钟 · <24 时 N 小时(N 分) · <30 天 N 天 · 更久 M月D日（跨年带年）。 */
    /** 时间间隔拆成「数字 + 单位」，给大数字统计位用 → { num, unit } */
    fmtGap: function (ms) {
      if (typeof ms !== 'number' || !isFinite(ms) || ms < 60000) return { num: '刚刚', unit: '' };
      var min = Math.floor(ms / 60000);
      if (min < 60) return { num: String(min), unit: '分钟' };
      var h = Math.floor(min / 60);
      if (h < 24) return { num: String(h), unit: '小时' };
      return { num: String(Math.floor(h / 24)), unit: '天' };
    },
    /** 相对时间短句：「刚刚 / 25 分钟前 / 3 小时前 / 昨天 21:40 / 5 天前 / 9月3日」 */
    fmtAgo: function (when) {
      var t = (when instanceof Date) ? when.getTime() : new Date(when).getTime();
      if (!isFinite(t)) return '';
      var now = Date.now(), ms = Math.max(0, now - t);
      if (ms < 60000) return '刚刚';
      if (ms < 3600000) return Math.floor(ms / 60000) + ' 分钟前';
      var d = new Date(t), n = new Date(now);
      var p2 = function (x) { return (x < 10 ? '0' : '') + x; };
      if (ms < 6 * 3600000) return Math.floor(ms / 3600000) + ' 小时前';
      var dayDiff = Math.round((new Date(n.getFullYear(), n.getMonth(), n.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
      if (dayDiff === 0) return '今天 ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
      if (dayDiff === 1) return '昨天 ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
      if (dayDiff < 30) return dayDiff + ' 天前';
      return (d.getFullYear() !== n.getFullYear() ? d.getFullYear() + '年' : '') + (d.getMonth() + 1) + '月' + d.getDate() + '日';
    },

    /** 第 139 次：秒表读数 mm:ss（≥1 小时为 h:mm:ss）。
        只用于「进行中」的实时显示——分钟精度的 fmtDuration 在计时卡上
        会出现「喂了 3 分钟，读数一直 0分」的假死感（实测踩过）。
        落库时长仍走 fmtDuration（分钟口径），两者不混用。 */
    fmtClock: function (ms) {
      if (ms == null || isNaN(ms) || ms < 0) ms = 0;
      var totalSec = Math.floor(ms / 1000);
      var s = totalSec % 60;
      var m = Math.floor(totalSec / 60) % 60;
      var h = Math.floor(totalSec / 3600);
      var pad = function (n) { return (n < 10 ? '0' : '') + n; };
      return h > 0 ? (h + ':' + pad(m) + ':' + pad(s)) : (pad(m) + ':' + pad(s));
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

    /** 把全部数据按「天」聚合，用于日历打点与当日明细（首页与「日期记录」页共用，单一来源）。
        第 95 次：条目带 time（HH:MM，纯日期项为空串），同一天内按时间升序——
        日历明细要显示「几点记的」。 */
    buildDayIndex: function (d) {
      d = d || {};
      function isoOf(s) { return (s || '').slice(0, 10); }
      function hmOf(s) { var m = String(s || '').match(/T(\d{2}:\d{2})/); return m ? m[1] : ''; }
      var idx = {};
      function add(iso, ic, label, val, time) {
        if (!iso) return;
        if (!idx[iso]) idx[iso] = [];
        idx[iso].push({ icon: ic, label: label, val: val, time: time || '' });
      }
      (d.feedings || []).forEach(function (r) {
        var t = r.type === 'breast' ? '母乳' : (r.type === 'bottle' ? '奶瓶' : (r.type === 'formula' ? '奶粉' : (r.type === 'pump' ? '吸奶' : '辅食')));
        var bm = r.durationMin || r.duration;
        var v = r.type === 'breast' ? (bm ? bm + ' 分' : '') : ((r.amount ? r.amount + (r.type === 'solid' ? ' g' : ' ml') : '') + (r.type === 'pump' && r.durationMin ? ' · ' + r.durationMin + ' 分' : ''));
        add(isoOf(r.start), 'feeding', t, v, hmOf(r.start));
      });
      (d.sleeps || []).forEach(function (r) {
        if (!r.start) return;
        var v = r.end ? Util.fmtDuration(new Date(r.end) - new Date(r.start) - (r.pausedMs || 0)) : '';
        add(isoOf(r.start), 'sleep', '睡眠', v, hmOf(r.start));
      });
      (d.growth || []).forEach(function (r) { add(r.date, 'growth', '生长', (r.weightKg ? r.weightKg + ' kg ' : '') + (r.heightCm ? r.heightCm + ' cm' : '')); });
      (d.diapers || []).forEach(function (r) {
        var t = r.type === 'pee' ? '尿' : (r.type === 'poop' ? '便' : '尿+便');
        add(isoOf(r.time), 'diaper', '尿布', t, hmOf(r.time));
      });
      if (d.vaccines && d.vaccines.done) {
        Object.keys(d.vaccines.done).forEach(function (k) {
          add(d.vaccines.done[k], 'vaccine', '疫苗接种', '');
        });
      }
      /* 第 185 次：饮水此前不进日期记录 */
      (d.waters || []).forEach(function (r) { add(isoOf(r.time), 'water', '饮水', r.ml ? r.ml + ' ml' : '', hmOf(r.time)); });
      (d.meds || []).forEach(function (r) { add(isoOf(r.time), 'meds', '服药', r.name || '', hmOf(r.time)); });
      (d.milestones || []).forEach(function (r) { add(r.date, 'milestone', '里程碑', r.title || ''); });
      (d.periods || []).forEach(function (r) { if (r.start) add(isoOf(r.start), 'period', '经期', ''); });
      if (d.prenatal && d.prenatal.records) d.prenatal.records.forEach(function (r) { add(r.date, 'pregnancy', '产检', r.item || ''); });
      (d.contractions || []).forEach(function (r) { if (r.start) add(isoOf(r.start), 'contraction', '宫缩', '', hmOf(r.start)); });
      (d.fetal || []).forEach(function (r) { add(isoOf(r.time), 'fetal', '胎动', '', hmOf(r.time)); });
      (d.temps || []).forEach(function (r) { add(isoOf(r.time), 'temp', '体温', r.value != null ? r.value + '°C' : '', hmOf(r.time)); });
      if (d.finance && d.finance.records) d.finance.records.forEach(function (r) { add(r.date, 'finance', '记账', '¥' + (r.amount || 0)); });
      /* 同一天内按时间升序排（无时刻的排后面），明细即是一天的时间线 */
      Object.keys(idx).forEach(function (k) {
        idx[k].sort(function (a, b) { return (a.time || '99').localeCompare(b.time || '99'); });
      });
      return idx;
    }
  };

  global.Util = Util;

  /* -----------------------------------------------------------
   * 自定义确认弹层：替代原生 confirm，保持暖调设计一致性。
   * opts: { title, message, okText, cancelText, danger, onConfirm,
   *         extra: { text, onClick } } —— 可选第三按钮（如「先导出备份」），
   *         点击后不关闭弹层，给不可逆操作留一个出口。
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
    var leadIcon = window.icon ? (icon(danger ? 'alert' : 'heart') || '') : '';

    root.innerHTML =
      '<div class="modal-mask" data-cfm-mask>' +
        '<div class="modal" role="alertdialog" aria-modal="true" aria-labelledby="cfmTitle" aria-describedby="cfmMsg">' +
          '<h2 id="cfmTitle">' + leadIcon + Util.escapeHtml(title) + '</h2>' +
          '<p id="cfmMsg">' + Util.escapeHtml(message) + '</p>' +
          '<div class="modal-actions' + (opts.extra && opts.extra.text ? ' has-extra' : '') + (danger ? ' is-danger' : '') + '">' +
            (opts.extra && opts.extra.text
              ? '<button type="button" class="btn" data-cfm-extra>' + Util.escapeHtml(opts.extra.text) + '</button>' : '') +
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
    var extraBtn = root.querySelector('[data-cfm-extra]');
    if (extraBtn) extraBtn.addEventListener('click', function () {
      /* 出口按钮：执行动作但保留弹层（如先导出备份再决定是否清空） */
      if (opts.extra && typeof opts.extra.onClick === 'function') opts.extra.onClick();
    });
    mask.addEventListener('click', function (e) { if (e.target === mask) close(); });
    document.addEventListener('keydown', onKey);

    /* 焦点管理：危险操作默认聚焦“取消”，避免误触销毁 */
    /* 第 189 次：focusVisible:false——触屏打开时不画粗焦点环（键盘用户 Tab 后仍正常显示） */
    try { (danger ? cancelBtn : okBtn).focus({ focusVisible: false }); } catch (e) { (danger ? cancelBtn : okBtn).focus(); }
  };

  /* -----------------------------------------------------------
   * 第 62 次：滑块选日期（手机免键盘）。
   * 跨度 ≤ 40 天自动用单滑杆（记录类日期，近 31 天）；更宽跨度用
   * 「月份 + 日」双滑杆（出生日期 / 末次月经 / 预产期这类跨月日期）。
   * 真正的值放在保留原 id 的隐藏 input 上——所有保存逻辑与回归
   * 测试的取值代码零改动，滑杆只负责把值「拨」进去。
   * cfg: { id, title, value, min, max, opt: { label, invert } }
   *   opt（可选）「未设置 / 已结束」勾选：invert=false 时勾上=值为空（未设置）；
   *   invert=true 时勾上=才有值（pEnd：勾「已结束」才启用滑杆）。
   * 用法：render 里 html += Util.dateSlider(cfg)；innerHTML 后 Util.bindDateSliders(view)。
   */
  Util._dsCfg = {};
  var DS_WEEK = ['日', '一', '二', '三', '四', '五', '六'];
  function dsPad(n) { return (n < 10 ? '0' : '') + n; }
  function dsLabel(iso) {
    if (!iso) return '未选择';
    var d = new Date(iso + 'T00:00:00');
    if (isNaN(d.getTime())) return iso;
    var t = new Date(); t.setHours(0, 0, 0, 0);
    var diff = Math.round((t - d) / 86400000);
    var rel = diff === 0 ? '今天' : diff === 1 ? '昨天' : diff === 2 ? '前天' : diff > 0 ? diff + ' 天前' : (-diff) + ' 天后';
    return rel + ' · ' + (d.getMonth() + 1) + '月' + d.getDate() + '日 周' + DS_WEEK[d.getDay()];
  }
  function dsMonthKeys(minIso, maxIso) {
    var out = [], cur = minIso.slice(0, 7), guard = 0;
    while (guard++ < 400) {
      out.push(cur);
      if (cur === maxIso.slice(0, 7)) break;
      var y = +cur.slice(0, 4), m = +cur.slice(5, 7) + 1;
      if (m > 12) { m = 1; y++; }
      cur = y + '-' + dsPad(m);
    }
    return out;
  }
  /* 第 146 次（P0-5）：宝宝生日专用的原生日期选择器。
     审查结论：生日用「日期滑杆 + 未设置勾选」时，默认勾着「未设置」、滑杆标签不明确，
     用户很容易一路下一步跳过，之后月龄/疫苗/生长全是空的。
     生日是一个确定的日子，原生 <input type="date"> 在 iOS/安卓都弹系统滚轮，最不容易误操作；
     id 与 .value 语义（YYYY-MM-DD 或空串）与原 dateSlider 完全一致，调用方读取代码不用改。 */
  Util.birthInput = function (cfg) {
    var max = cfg.max || Util.todayISO();
    var min = cfg.min || Util.addDays(max, -1095);
    /* 第 212 次：生日支持农历选择。<input type=date> 仍是唯一取值口（各页保存逻辑不用改），
       农历模式下三个下拉框换算成公历写回这个输入框，并在 data-lunar 上记下所选农历。 */
    var L = global.Lunar && Lunar.ok;
    var lun = (L && cfg.lunar && typeof cfg.lunar === 'object') ? cfg.lunar : null;
    var html = '<div class="birth-field' + (lun ? ' is-lunar' : '') + '" data-bf="' + cfg.id + '" data-min="' + min + '" data-max="' + max + '">'
      + '<div class="bf-head"><label for="' + cfg.id + '">' + Util.escapeHtml(cfg.title || '宝宝生日') + '</label>'
      + (L ? '<div class="seg bf-cal" role="group" aria-label="历法">'
        + '<button type="button" class="seg-btn' + (lun ? '' : ' active') + '" data-bf-cal="solar">公历</button>'
        + '<button type="button" class="seg-btn' + (lun ? ' active' : '') + '" data-bf-cal="lunar">农历</button></div>' : '')
      + '</div>'
      + '<input type="date" id="' + cfg.id + '" min="' + min + '" max="' + max + '" value="' + Util.escapeHtml(cfg.value || '') + '"'
      + (lun ? ' data-lunar="' + Util.escapeHtml(JSON.stringify(lun)) + '"' : '') + '>';
    if (L) html += '<div class="bf-lunar">' + lunarSelects(min, max, lun) + '</div>';
    html += (cfg.hint ? '<span class="hint">' + Util.escapeHtml(cfg.hint) + '</span>' : '') + '</div>';
    return html;
  };
  function lunarSelects(min, max, lun) {
    var y0 = parseInt(min.slice(0, 4), 10) - 1, y1 = parseInt(max.slice(0, 4), 10);
    var cur = lun || Lunar.of(new Date());
    var y = Math.min(Math.max(cur.y, y0), y1);
    var months = Lunar.yearOf(y);
    var mi = 0;
    months.forEach(function (m, i) { if (m.m === cur.m && !!m.leap === !!cur.leap) mi = i; });
    var days = months[mi] ? months[mi].days : 30;
    var h = '<select data-bl="y" data-prev="' + y + '" aria-label="农历年">';
    for (var yy = y1; yy >= y0; yy--) {
      var gz = Lunar.of(new Date(yy, 5, 1));
      h += '<option value="' + yy + '"' + (yy === y ? ' selected' : '') + '>' + yy + (gz ? ' ' + gz.gz : '') + '年</option>';
    }
    h += '</select><select data-bl="m" aria-label="农历月">';
    months.forEach(function (m, i) {
      h += '<option value="' + i + '"' + (i === mi ? ' selected' : '') + '>' + Lunar.monthName(m.m, m.leap) + '</option>';
    });
    h += '</select><select data-bl="d" aria-label="农历日">';
    for (var dd = 1; dd <= days; dd++) h += '<option value="' + dd + '"' + (dd === Math.min(cur.d, days) ? ' selected' : '') + '>' + Lunar.dayName(dd) + '</option>';
    h += '</select>';
    return h;
  }
  /* 读农历模式下选中的农历生日（公历模式或值对不上时返回 null） */
  Util.birthLunarOf = function (id) {
    var inp = document.getElementById(id);
    if (!inp || !inp.closest) return null;
    var box = inp.closest('.birth-field');
    if (!box || !box.classList.contains('is-lunar')) return null;
    try {
      var l = JSON.parse(inp.getAttribute('data-lunar') || 'null');
      if (l && global.Lunar && Lunar.toSolar(l.y, l.m, l.d, l.leap) === inp.value) return l;
    } catch (e) {}
    return null;
  };
  function bfApply(box) {
    var inp = box.querySelector('input[type="date"]');
    var sy = box.querySelector('[data-bl="y"]'), sm = box.querySelector('[data-bl="m"]'), sd = box.querySelector('[data-bl="d"]');
    if (!inp || !sy || !sm || !sd) return;
    var y = parseInt(sy.value, 10);
    var months = Lunar.yearOf(y);
    var mo = months[parseInt(sm.value, 10)] || months[0];
    if (!mo) return;
    var d = Math.min(parseInt(sd.value, 10) || 1, mo.days);
    var solar = Lunar.toSolar(y, mo.m, d, mo.leap);
    var mn = box.getAttribute('data-min'), mx = box.getAttribute('data-max');
    if (!solar) return;
    if ((mx && solar > mx) || (mn && solar < mn)) {
      Util.toast(solar > mx ? '这个日子还没到' : '超出可选范围（最早 ' + mn + '）', 'warn');
      /* 退回上一次有效的选择，免得下拉框和实际日期对不上 */
      var prevL = null;
      try { prevL = JSON.parse(inp.getAttribute('data-lunar') || 'null'); } catch (e) {}
      if (!prevL && inp.value) prevL = Lunar.of(new Date(inp.value + 'T00:00:00'));
      var bl = box.querySelector('.bf-lunar');
      bl.innerHTML = lunarSelects(mn, mx, prevL);
      if (inp.value) { var hp = document.createElement('p'); hp.className = 'bf-solar'; hp.textContent = '对应公历 ' + inp.value; bl.appendChild(hp); }
      return;
    }
    inp.value = solar;
    inp.setAttribute('data-lunar', JSON.stringify({ y: y, m: mo.m, d: d, leap: !!mo.leap }));
    var hint = box.querySelector('.bf-solar');
    if (!hint) { hint = document.createElement('p'); hint.className = 'bf-solar'; box.querySelector('.bf-lunar').appendChild(hint); }
    hint.textContent = '对应公历 ' + solar;
    ['input', 'change'].forEach(function (t) {
      var ev; try { ev = new Event(t, { bubbles: true }); } catch (e) { ev = document.createEvent('Event'); ev.initEvent(t, true, true); }
      ev._bfSynth = true;
      inp.dispatchEvent(ev);
    });
  }
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('[data-bf-cal]') : null;
      if (!b) return;
      var box = b.closest('.birth-field');
      if (!box) return;
      var lunar = b.getAttribute('data-bf-cal') === 'lunar';
      box.classList.toggle('is-lunar', lunar);
      Array.prototype.forEach.call(box.querySelectorAll('[data-bf-cal]'), function (x) { x.classList.toggle('active', x === b); });
      var inp = box.querySelector('input[type="date"]');
      if (lunar) {
        /* 已有公历生日 → 下拉框定位到对应农历 */
        if (inp && inp.value) {
          var l = Lunar.of(new Date(inp.value + 'T00:00:00'));
          if (l) box.querySelector('.bf-lunar').innerHTML = lunarSelects(box.getAttribute('data-min'), box.getAttribute('data-max'), l);
          inp.setAttribute('data-lunar', JSON.stringify({ y: l.y, m: l.m, d: l.d, leap: l.leap }));
          var hint = document.createElement('p'); hint.className = 'bf-solar'; hint.textContent = '对应公历 ' + inp.value;
          box.querySelector('.bf-lunar').appendChild(hint);
        } else bfApply(box);
      } else if (inp) {
        inp.removeAttribute('data-lunar');
      }
    });
    document.addEventListener('change', function (e) {
      var t = e.target;
      if (!t || !t.getAttribute) return;
      var k = t.getAttribute('data-bl');
      var box = t.closest ? t.closest('.birth-field') : null;
      if (!box) return;
      if (k === 'y' || k === 'm') {
        /* 换年 / 换月：重建月份（闰月因年而异）与天数 */
        var y = parseInt(box.querySelector('[data-bl="y"]').value, 10);
        var months = Lunar.yearOf(y);
        var sm = box.querySelector('[data-bl="m"]');
        var prev = (k === 'y') ? Lunar.yearOf(parseInt(t.getAttribute('data-prev') || y, 10)) : months;
        var old = prev[parseInt(sm.value, 10)] || {};
        var mi = 0;
        months.forEach(function (m, i) { if (m.m === old.m && !!m.leap === !!old.leap) mi = i; else if (m.m === old.m && !old.leap && mi === 0) mi = i; });
        if (k === 'y') {
          sm.innerHTML = months.map(function (m, i) { return '<option value="' + i + '"' + (i === mi ? ' selected' : '') + '>' + Lunar.monthName(m.m, m.leap) + '</option>'; }).join('');
          t.setAttribute('data-prev', String(y));
        }
        var mo = months[parseInt(sm.value, 10)] || months[0];
        var sd = box.querySelector('[data-bl="d"]');
        var dv = Math.min(parseInt(sd.value, 10) || 1, mo.days);
        var h = '';
        for (var dd = 1; dd <= mo.days; dd++) h += '<option value="' + dd + '"' + (dd === dv ? ' selected' : '') + '>' + Lunar.dayName(dd) + '</option>';
        sd.innerHTML = h;
      }
      if (k) { bfApply(box); return; }
      /* 农历模式下直接改了公历框：退回公历模式 */
      if (t.type === 'date' && !e._bfSynth && box.classList.contains('is-lunar')) {
        box.classList.remove('is-lunar');
        t.removeAttribute('data-lunar');
        Array.prototype.forEach.call(box.querySelectorAll('[data-bf-cal]'), function (x) { x.classList.toggle('active', x.getAttribute('data-bf-cal') === 'solar'); });
      }
    });
  }

  /* 第 186 次：生成 .ics（全天事件，前一天 9:00 提醒）。
     events: [{ uid, date: 'YYYY-MM-DD', title, desc }]。只在本机生成，不上传。 */
  Util.buildICS = function (calName, events) {
    function esc(t) { return String(t || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
    function ymd(iso) { return String(iso).replace(/-/g, ''); }
    var now = new Date();
    var stamp = now.getUTCFullYear() + pad(now.getUTCMonth() + 1) + pad(now.getUTCDate()) + 'T'
      + pad(now.getUTCHours()) + pad(now.getUTCMinutes()) + pad(now.getUTCSeconds()) + 'Z';
    var L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Yiya//CN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:' + esc(calName)];
    (events || []).forEach(function (e) {
      if (!e || !/^\d{4}-\d{2}-\d{2}$/.test(e.date || '')) return;
      L.push('BEGIN:VEVENT', 'UID:' + esc(e.uid) + '@yiya.local', 'DTSTAMP:' + stamp,
        'DTSTART;VALUE=DATE:' + ymd(e.date), 'DTEND;VALUE=DATE:' + ymd(Util.addDays(e.date, 1)),
        'SUMMARY:' + esc(e.title));
      if (e.desc) L.push('DESCRIPTION:' + esc(e.desc));
      L.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + esc(e.title), 'TRIGGER:-PT15H', 'END:VALARM', 'END:VEVENT');
    });
    L.push('END:VCALENDAR');
    return L.join('\r\n') + '\r\n';
  };
  /* 优先系统分享（iOS 可直接「添加到日历」），不支持再下载 */
  Util.shareOrDownload = function (filename, text, mime) {
    try {
      if (typeof File === 'function' && navigator.canShare) {
        var f = new File([text], filename, { type: mime });
        if (navigator.canShare({ files: [f] })) {
          navigator.share({ files: [f], title: filename }).catch(function () {});
          return;
        }
      }
    } catch (e) { /* 落到下载 */ }
    Util.download(filename, text, mime);
  };

  /* 第 186 次：新生儿第 1–7 天每日湿尿布常见参考（母乳喂养宣教常用口径：
     第 1 天 ≥1、第 2 天 ≥2 …… 第 5 天起 ≥6）。只作参考，不是诊断阈值。
     返回 { day, ref } 或 null（不在第 1–7 天 / 无生日）。 */
  Util.newbornWetRef = function (d, now) {
    var bd = d && d.settings && d.settings.baby && d.settings.baby.birthDate;
    if (!bd || !/^\d{4}-\d{2}-\d{2}$/.test(bd)) return null;
    var n = now ? new Date(now) : new Date();
    var t = n.getFullYear() + '-' + pad(n.getMonth() + 1) + '-' + pad(n.getDate());
    var day = Util.daysBetween(bd, t) + 1;
    if (!(day >= 1 && day <= 7)) return null;
    return { day: day, ref: day >= 5 ? 6 : day };
  };

  /* 第 185 次：记录类日期的最早可选日——有生日用生日，否则 3 年前 */
  Util.recordFloor = function (d) {
    var max = Util.todayISO();
    var bd = d && d.settings && d.settings.baby && d.settings.baby.birthDate;
    if (bd && /^\d{4}-\d{2}-\d{2}$/.test(bd) && Util.daysBetween(bd, max) > 31) return bd;
    return Util.addDays(max, -1095);
  };

  Util.dateSlider = function (cfg) {
    cfg = cfg || {};
    var today = Util.todayISO();
    var max = cfg.max || today;
    var min = cfg.min || Util.addDays(max, -180);
    if (Util.daysBetween(min, max) < 0) min = max;
    var span = Util.daysBetween(min, max);
    var val = (cfg.value && Util.daysBetween(min, cfg.value) >= 0 && Util.daysBetween(cfg.value, max) >= 0) ? cfg.value : '';
    /* 第 76 次（D 线）：存完整 cfg 供「更早」入口重渲用（title/value 也带上） */
    Util._dsCfg[cfg.id] = { id: cfg.id, title: cfg.title, value: val, min: min, max: max, span: span, opt: cfg.opt || null, earlier: cfg.earlier, floor: cfg.floor || null };
    /* 「更早」入口（D 线）：短滑块（span≤40，min 一般是 31 天前）够不着更早的补记。
       自动带一个「更早…」按钮，点击把可选范围向前扩 90 天、最早到 365 天前；
       span>40 的长滑块（生日/LMP）本就可选任意旧日期，不带。cfg.earlier===false 可显式关闭。 */
    var earlier = cfg.earlier !== false && span <= 40 && Util.daysBetween(cfg.floor || Util.addDays(max, -365), min) > 0;
    var h = '<div class="date-slider" data-ds-for="' + cfg.id + '">';
    h += '<div class="ds-head"><span class="ds-title">' + Util.escapeHtml(cfg.title || '日期') + '</span>'
      + '<span class="ds-label">' + dsLabel(val) + '</span></div>';
    if (cfg.opt) {
      var optOn = cfg.opt.invert ? !!val : !val;
      h += '<label class="chk ds-opt"><input type="checkbox" class="ds-opt-chk"' + (optOn ? ' checked' : '') + '> ' + Util.escapeHtml(cfg.opt.label) + '</label>';
    }
    if (span <= 40) {
      /* 单滑杆：左端=最早，右端=最新（今天） */
      var pos = val ? Util.daysBetween(min, val) : span;
      h += '<input type="range" class="ds-range ds-single" min="0" max="' + span + '" step="1" value="' + pos + '">';
    } else {
      var mk = dsMonthKeys(min, max);
      var mi = val ? mk.indexOf(val.slice(0, 7)) : mk.length - 1;
      if (mi < 0) mi = mk.length - 1;
      h += '<div class="ds-dual">'
        + '<input type="range" class="ds-range ds-m" min="0" max="' + (mk.length - 1) + '" step="1" value="' + mi + '" aria-label="月份">'
        + '<span class="ds-m-label"></span>'
        + '<input type="range" class="ds-range ds-d" min="1" max="31" step="1" value="' + (val ? +val.slice(8, 10) : 1) + '" aria-label="日">'
        + '</div>';
    }
    h += '<input type="hidden" id="' + cfg.id + '" class="ds-val" value="' + (val || '') + '">';
    if (earlier) h += '<button type="button" class="btn btn-mini ds-earlier">更早…</button>';
    h += '</div>';
    return h;
  };
  Util.bindDateSliders = function (root) {
    if (!root || !root.querySelectorAll) return;
    Array.prototype.forEach.call(root.querySelectorAll('[data-ds-for]'), function (box) {
      if (box.getAttribute('data-ds-bound')) return;
      box.setAttribute('data-ds-bound', '1');
      var cfg = Util._dsCfg[box.getAttribute('data-ds-for')];
      if (!cfg) return;
      var hid = box.querySelector('.ds-val');
      var lbl = box.querySelector('.ds-label');
      var chk = box.querySelector('.ds-opt-chk');
      var ranges = box.querySelectorAll('.ds-range');
      var mk = (ranges.length > 1) ? dsMonthKeys(cfg.min, cfg.max) : null;
      function clampIso(iso) {
        if (!iso) return '';
        if (Util.daysBetween(cfg.min, iso) < 0) return cfg.min;
        if (Util.daysBetween(iso, cfg.max) < 0) return cfg.max;
        return iso;
      }
      function enabled() { return chk ? ((cfg.opt && cfg.opt.invert) ? chk.checked : !chk.checked) : true; }
      function refreshLock() {
        var on = enabled();
        if (chk) box.setAttribute('data-off', on ? '0' : '1');
        Array.prototype.forEach.call(ranges, function (r) { try { r.disabled = !on; } catch (e) {} });
      }
      function positionFromVal() {
        var v = hid.value;
        if (!v) return;
        if (ranges.length === 1) {
          try { ranges[0].value = String(Util.daysBetween(cfg.min, v)); } catch (e) {}
        } else {
          var mi = mk.indexOf(v.slice(0, 7));
          try {
            if (mi >= 0) ranges[0].value = String(mi);
            ranges[1].value = String(+v.slice(8, 10));
          } catch (e) {}
        }
      }
      function paintMonth() {
        if (ranges.length < 2) return hid.value;
        var mKey = mk[+ranges[0].value];
        var y = +mKey.slice(0, 4), m = +mKey.slice(5, 7);
        var last = new Date(y, m, 0).getDate();
        var dMin = (mKey === cfg.min.slice(0, 7)) ? +cfg.min.slice(8, 10) : 1;
        var dMax = (mKey === cfg.max.slice(0, 7)) ? +cfg.max.slice(8, 10) : last;
        try {
          ranges[1].min = String(dMin);
          ranges[1].max = String(dMax);
          var dv = Math.min(Math.max(+ranges[1].value || dMin, dMin), dMax);
          ranges[1].value = String(dv);
        } catch (e) {}
        var mLab = box.querySelector('.ds-m-label');
        if (mLab) mLab.textContent = y + ' 年 ' + m + ' 月';
        return mKey + '-' + dsPad(dv);
      }
      function syncFromRanges() {
        if (!enabled()) return;
        var iso = (ranges.length === 1) ? Util.addDays(cfg.min, +ranges[0].value) : paintMonth();
        hid.value = iso;
        lbl.textContent = dsLabel(iso);
        try { hid.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
        try { hid.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
      }
      Array.prototype.forEach.call(ranges, function (r) { r.addEventListener('input', syncFromRanges); });
      if (chk) chk.addEventListener('change', function () {
        refreshLock();
        if (enabled()) {
          if (!hid.value) { hid.value = clampIso(Util.todayISO()); positionFromVal(); }
          lbl.textContent = dsLabel(hid.value);
        } else {
          hid.value = '';
          lbl.textContent = dsLabel('');
        }
      });
      positionFromVal();
      if (ranges.length > 1) paintMonth();
      lbl.textContent = dsLabel(hid.value);
      refreshLock();
      /* 第 76 次（D 线）：「更早…」——把可选范围向前扩 90 天（最早 365 天前），
         重渲整个滑块并保留当前已选值；到底后按钮置灰。 */
      var btnE = box.querySelector('.ds-earlier');
      if (btnE) btnE.addEventListener('click', function () {
        var c = Util._dsCfg[box.getAttribute('data-ds-for')];
        if (!c) return;
        /* 第 185 次：cfg.floor（如宝宝生日）——「更早」一步直接扩到 floor，
           出生体重、42 天体检这类早期数据才录得进去 */
        var floor = c.floor || Util.addDays(c.max, -365);
        var newMin = c.floor ? c.floor : Util.addDays(c.min, -90);
        if (Util.daysBetween(floor, newMin) < 0) newMin = floor;
        if (Util.daysBetween(newMin, c.min) >= 0) { btnE.disabled = true; btnE.textContent = '已到最早'; return; }
        var curVal = hid.value;
        var tmp = document.createElement('div');
        tmp.innerHTML = Util.dateSlider({ id: c.id, title: c.title, value: curVal, min: newMin, max: c.max, opt: c.opt, earlier: true, floor: c.floor });
        var fresh = tmp.firstElementChild;
        box.parentNode.replaceChild(fresh, box);
        Util.bindDateSliders(fresh.parentNode);
      });
    });
  };

  /* -----------------------------------------------------------
   * 日期修改弹层：给「快捷记录写死今天」的场景一个改期出口（C6 / 补记结束日期等）。
   * opts: { title, message, value, min, max, okText, cancelText, onConfirm(dateStr) }
   * 复用 modalRoot + .modal 基座；确认时把 yyyy-mm-dd 传回 onConfirm，留空则不通过。
   * 第 62 次：输入控件改为滑块选日期（edInput 隐藏 input 保留原 id）。
   */
  Util.editDate = function (opts) {
    opts = opts || {};
    var root = document.getElementById('modalRoot');
    if (!root) return;
    var title = opts.title || '选择日期';
    var message = opts.message || '';
    var okText = opts.okText || '确定';
    var cancelText = opts.cancelText || '取消';

    root.innerHTML =
      '<div class="modal-mask" data-ed-mask>' +
        '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="edTitle">' +
          '<h2 id="edTitle">' + Util.escapeHtml(title) + '</h2>' +
          (message ? '<p>' + Util.escapeHtml(message) + '</p>' : '') +
          Util.dateSlider({ id: 'edInput', title: '日期', value: opts.value || '', min: opts.min || null, max: opts.max || null }) +
          '<div class="modal-actions">' +
            '<button type="button" class="btn" data-ed-cancel>' + Util.escapeHtml(cancelText) + '</button>' +
            '<button type="button" class="btn btn-primary" data-ed-ok>' + Util.escapeHtml(okText) + '</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    Util.bindDateSliders(root);

    var mask = root.querySelector('[data-ed-mask]');
    var input = root.querySelector('#edInput');
    var okBtn = root.querySelector('[data-ed-ok]');
    var cancelBtn = root.querySelector('[data-ed-cancel]');

    function close() { root.innerHTML = ''; document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }

    okBtn.addEventListener('click', function () {
      var v = (input.value || '').trim();
      if (!v) { Util.markInvalid(input, '请选择日期'); return; }
      close();
      if (typeof opts.onConfirm === 'function') opts.onConfirm(v);
    });
    cancelBtn.addEventListener('click', close);
    mask.addEventListener('click', function (e) { if (e.target === mask) close(); });
    document.addEventListener('keydown', onKey);
    try {
      var r0 = root.querySelector('.ds-range');
      if (r0) r0.focus();
    } catch (e) {}
  };

  /* -----------------------------------------------------------
   * 单行文本编辑弹层：给「数据里有字段、界面无入口」的补写场景用（如尿布备注）。
   * opts: { title, message, value, placeholder, maxlength, okText, cancelText, onConfirm(text) }
   * 确认时空值也回调（onConfirm('')），由调用方决定「清空字段」语义。
   */
  Util.editText = function (opts) {
    opts = opts || {};
    var root = document.getElementById('modalRoot');
    if (!root) return;
    var title = opts.title || '编辑';
    var message = opts.message || '';
    var okText = opts.okText || '保存';

    root.innerHTML =
      '<div class="modal-mask" data-et-mask>' +
        '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="etTitle">' +
          '<h2 id="etTitle">' + Util.escapeHtml(title) + '</h2>' +
          (message ? '<p>' + Util.escapeHtml(message) + '</p>' : '') +
          '<label>内容<input type="text" id="etInput"' +
            (opts.value ? ' value="' + Util.escapeHtml(opts.value) + '"' : '') +
            (opts.placeholder ? ' placeholder="' + Util.escapeHtml(opts.placeholder) + '"' : '') +
            (opts.maxlength ? ' maxlength="' + parseInt(opts.maxlength, 10) + '"' : '') +
          '></label>' +
          '<div class="modal-actions">' +
            '<button type="button" class="btn" data-et-cancel>取消</button>' +
            '<button type="button" class="btn btn-primary" data-et-ok>' + Util.escapeHtml(okText) + '</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    var mask = root.querySelector('[data-et-mask]');
    var input = root.querySelector('#etInput');
    var okBtn = root.querySelector('[data-et-ok]');
    var cancelBtn = root.querySelector('[data-et-cancel]');

    function close() { root.innerHTML = ''; document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }

    okBtn.addEventListener('click', function () {
      var v = (input.value || '').trim();
      close();
      if (typeof opts.onConfirm === 'function') opts.onConfirm(v);
    });
    cancelBtn.addEventListener('click', close);
    mask.addEventListener('click', function (e) { if (e.target === mask) close(); });
    document.addEventListener('keydown', onKey);
    try { input.focus(); } catch (e) {}
  };

  /* -----------------------------------------------------------
   * 大数字 + 尺滑杆（第 41 次，对标 Cali 录入范式）：
   * 数值录入不再用小输入框，而是「巨大数字 + 刻度滑杆 + ＋/− 微调」。
   * Util.rulerHTML(id, spec) 生成结构（spec: { unit, label }）；
   * Util.rulerPaint(id, spec) 把取值写入控件（spec: { min, max, step, value, anchor, dec, unit, label }，
   *   value 为 null 时滑杆停在 anchor、大数字半透明显示 anchor 值，由模块自行决定何时算「已设置」）。
   * input/± 的状态更新由各模块绑定（它们持有自己的业务状态）。
   *
   * 第 102 次（OP-GAP-01）：大数字加「点一下直接输数字」。
   * 起因是第七版审计发现的缺口——奶量滑杆 step=5，想记 90ml 要点 ＋ 十八次。
   * 「不是懒，就是每次最想记的时候，刚好是最没法记的时候」。
   * 做法：在大数字上叠一层透明 <input type="number">，聚焦时才显形。
   * 提交时按 step 对齐 + clamp 回量程，写进 range 再派发原生 input 事件——
   * 各模块已绑的 range 'input' 监听自动接管，**模块侧零改动、落库逻辑零改动**。
   */
  Util.rulerHTML = function (id, spec) {
    var lbl = Util.escapeHtml(spec.label || spec.unit);
    return '<div class="ruler" id="' + id + '">'
      + '<div class="ruler-num">'
      + '<b id="' + id + 'Num">--</b>'
      /* 直输层：绝对定位盖住大数字。默认透明（不抢滑杆的点击），聚焦时显形。 */
      + '<input type="number" class="ruler-num-in" id="' + id + 'NumIn"'
      + ' inputmode="decimal" autocomplete="off" aria-label="' + lbl + '，可直接输入数值">'
      + '<i id="' + id + 'Unit">' + Util.escapeHtml(spec.unit) + '</i></div>'
      + '<div class="ruler-track"><div class="ruler-ticks" aria-hidden="true"></div>'
      + '<input type="range" id="' + id + 'Range" class="ruler-range" aria-label="' + lbl + '滑杆"></div>'
      + '<div class="ruler-btns">'
      + '<button type="button" class="btn-mini" id="' + id + 'Minus" aria-label="减小">−</button>'
      + '<button type="button" class="btn-mini" id="' + id + 'Plus" aria-label="增大">＋</button>'
      + '</div></div>';
  };

  /* 直输层提交：按 step 对齐 → clamp 量程 → 写 range → 派发 input 事件。
     模块侧已绑 range.addEventListener('input', …)，此处派发即可让状态与重绘全部生效，
     四个共用滑杆的模块（feeding/growth/pregnancy/temp）都不需要改一行代码。
     提交无效（空串/NaN）时回滚显示，不污染业务状态。 */
  Util.rulerCommitNum = function (id) {
    var root = document.getElementById(id);
    if (!root) return false;
    var range = root.querySelector('.ruler-range');
    var inp = root.querySelector('.ruler-num-in');
    var num = root.querySelector('.ruler-num b');
    if (!range || !inp) return false;
    var raw = String(inp.value).trim();
    var v = parseFloat(raw);
    /* 空串或非数字：视为放弃直输，把显示拨回滑杆当前值 */
    if (raw === '' || !isFinite(v)) {
      inp.value = range.value;
      return false;
    }
    var min = parseFloat(range.min), max = parseFloat(range.max), step = parseFloat(range.step);
    if (isFinite(step) && step > 0) v = Math.round(v / step) * step; /* 对齐步进 */
    if (isFinite(min) && v < min) v = min;
    if (isFinite(max) && v > max) v = max;
    /* 浮点误差兜底：0.1 步进 ×3 会得到 0.30000000000000004 */
    var dec = (String(step).indexOf('.') >= 0) ? String(step).split('.')[1].length : 0;
    if (dec > 0) v = Number(v.toFixed(dec));
    inp.value = String(v);
    range.value = String(v);
    if (num) num.textContent = v.toFixed(dec);
    /* 让模块侧已绑的监听按「用户拖了滑杆」的同一条路径接管。
       构造器取法要稳：全局 Event 在部分环境（老 WebView、jsdom 沙箱）不存在，
       退化到 range.ownerDocument.defaultView.Event，再不行用通用 createEvent。 */
    var view = range.ownerDocument && range.ownerDocument.defaultView;
    var Ev = (view && view.Event) || (typeof Event !== 'undefined' ? Event : null);
    var ev;
    if (Ev) { ev = new Ev('input', { bubbles: true }); }
    else if (range.ownerDocument && range.ownerDocument.createEvent) {
      ev = range.ownerDocument.createEvent('HTMLEvents');
      ev.initEvent('input', true, false);
    }
    if (ev) range.dispatchEvent(ev);
    return true;
  };

  Util.rulerPaint = function (id, spec) {
    var root = document.getElementById(id);
    if (!root) return null;
    /* 直输层事件（第 102 次，惰性绑定一次）：
       paint 首次被调用时元素已在文档流里（各模块都是先 innerHTML 再 paint），
       此时绑定 focus/blur/keydown 不会漏。放在 paint 里而非 rulerHTML，
       是因为 rulerHTML 只产出字符串、元素尚未挂载。
       - 聚焦：给容器加 editing 类 → CSS 让直输框显形、盖住大数字
       - 失焦 / 回车 / Esc：提交或回滚，随后收态 */
    if (!root._numBound && root.querySelector('.ruler-num-in')) {
      root._numBound = true;
      var nin = root.querySelector('.ruler-num-in');
      var numBox = root.querySelector('.ruler-num');
      var editing = false;
      var enterEditing = function () { editing = true; if (numBox) numBox.classList.add('editing'); };
      var endEditing = function () {
        if (!editing) return;
        editing = false;
        Util.rulerCommitNum(id);
        if (numBox) numBox.classList.remove('editing');
      };
      nin.addEventListener('focus', enterEditing);
      nin.addEventListener('blur', endEditing);
      nin.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); nin.blur(); }
        else if (e.key === 'Escape') {
          e.preventDefault();
          /* 取消：把显示拨回滑杆当前值，不改业务状态 */
          var rg = root.querySelector('.ruler-range');
          if (rg) nin.value = rg.value;
          editing = false;
          if (numBox) numBox.classList.remove('editing');
          nin.blur();
        }
      });
    }
    var range = root.querySelector('.ruler-range');
    var num = root.querySelector('.ruler-num b');
    var unit = root.querySelector('.ruler-num i');
    var ticks = root.querySelector('.ruler-ticks');
    if (!range || !num) return null;
    range.min = spec.min; range.max = spec.max; range.step = spec.step;
    range.value = (spec.value != null) ? spec.value : spec.anchor;
    var shown = (spec.value != null) ? spec.value : spec.anchor;
    var newText = Number(shown).toFixed(spec.dec);
    /* 数字变化的即时反馈（第 44 次，Kinetics digit-bump 模式）：轻微放大回弹，
       让「值真的变了」可感知。拖动时 input 每帧触发，用 120ms 节流避免动画
       不断重启造成抖动；reduced-motion 下全局 animation:none 自动降级。 */
    if (num.textContent !== newText) {
      var now = Date.now();
      if (!num._lastBump || (now - num._lastBump) > 120) {
        num._lastBump = now;
        num.classList.remove('bump');
        void num.offsetWidth; /* 强制重排以重启动画（测试桩无 offsetWidth，void 无害） */
        num.classList.add('bump');
      }
      num.textContent = newText;
    }
    if (spec.value != null) num.classList.remove('dim'); else num.classList.add('dim');
    /* 直输层与显示值保持一致（用户正在输入时不强抢，避免打断）——
       模块拖滑杆/点 ＋ 后，直输框里也应是同一个数，下次点开才能续改。 */
    var nin = root.querySelector('.ruler-num-in');
    if (nin && document.activeElement !== nin) nin.value = newText;
    if (nin) { if (spec.min != null) nin.min = spec.min; if (spec.max != null) nin.max = spec.max; if (spec.step != null) nin.step = spec.step; }
    /* 单位必须每次重写：生长页三项共用一根滑杆，切项时单位从 kg 变 cm（第 42 次修） */
    if (unit && spec.unit) unit.textContent = spec.unit;
    /* 真实刻度：按 min/max/step 画刻度线，5 档做主刻度并标数值，
       避免 CSS 等距条纹在不同量程下误导（体重 0.5–40 与身长 20–160 不能长得一样）。
       第 44 次：刻度只依赖量程不依赖当前值——量程没变就跳过重建。
       拖动时 input 每帧调进来，省掉每帧的 innerHTML 解析与 DOM 重绘（真实卡顿源）。 */
    if (ticks) {
      var tk = spec.min + '|' + spec.max + '|' + spec.step + '|' + spec.dec;
      if (ticks._tk !== tk) { ticks._tk = tk; Util.rulerTicks(ticks, spec); }
      /* 第 188 次：指针压在刻度数字上时（如 36.9 被拇指盖住半截），把那枚数字淡出，
         不出现「被遮一半的数字」。只切 5 个节点的 class，拖动每帧也无负担。 */
      var cp = (parseFloat(range.value) - spec.min) / (spec.max - spec.min) * 100;
      var rts = ticks.children;
      for (var ri = 0; ri < rts.length; ri++) {
        var lp = parseFloat(rts[ri].style.left);
        var near = Math.abs(lp - cp) < 7;
        if (rts[ri]._near !== near) { rts[ri]._near = near; rts[ri].classList.toggle('is-covered', near); }
      }
    }
    return parseFloat(range.value);
  };

  /* 刻度渲染：在 .ruler-ticks 里画出与量程/步进匹配的主刻度与数字。
     主刻度取「约 5 条」的位置（不一定是整数步，便于整数量程铺满）。 */
  Util.rulerTicks = function (box, spec) {
    if (!box) return;
    var min = Number(spec.min), max = Number(spec.max);
    if (!(max > min)) { box.innerHTML = ''; return; }
    var N = 5; /* 主刻度条数（含两端） */
    var html = '';
    for (var i = 0; i < N; i++) {
      var t = i / (N - 1);
      var v = min + (max - min) * t;
      /* 吸附到 spec.step 的整数倍，标签才不会出现 6.999999 */
      if (spec.step) v = Math.round(v / spec.step) * spec.step;
      if (v < min) v = min;
      if (v > max) v = max;
      var pct = (v - min) / (max - min) * 100;
      html += '<i class="rt" style="left:' + pct.toFixed(2) + '%"><s></s>'
        + '<em>' + Number(v).toFixed(spec.dec) + '</em></i>';
    }
    box.innerHTML = html;
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
    /* 第 148 次（P2 · 提示堆叠）：连点快记/批量操作时 toast 会一条条往上摞，
       最多摞到 5、6 条盖住半屏。规则：① 同文案只留最新一条；② 同屏最多 2 条，
       超出时优先挤掉最旧的「无操作」提示，带「撤销」的尽量保留（撤销是唯一补救入口）。 */
    var live = Array.prototype.filter.call(root.children, function (n) { return !n.classList.contains('leaving'); });
    live.forEach(function (n) { if (n._toastMsg === message && n._toastDismiss) n._toastDismiss(); });
    live = live.filter(function (n) { return !n.classList.contains('leaving'); });
    while (live.length >= 2) {
      var victim = live.filter(function (n) { return !n._toastHasAction; })[0] || live[0];
      if (victim._toastDismiss) victim._toastDismiss(); else if (victim.parentNode) victim.parentNode.removeChild(victim);
      live.splice(live.indexOf(victim), 1);
    }
    el._toastMsg = message;
    el._toastHasAction = !!(action && action.label);
    el._toastDismiss = dismiss;
    root.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('show'); });
    var hideTimer = setTimeout(dismiss, action && action.label ? 5200 : 2800);
    function dismiss() {
      clearTimeout(hideTimer);
      el.classList.add('leaving');
      el.classList.remove('show');
      /* 第 81 次（Appllama 动效纪律）：退场 140ms（:not(.show) 快速淡出），
         移除延时同步 280→160ms，杜绝出场动画还没走完就被摘除。 */
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 160);
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
    sm.setAttribute('role', 'alert'); /* 无障碍：错误出现时被屏幕阅读器播报 */
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
   * 第 85 次：行离场动画。row 收高+淡出+轻左移（.16s，快于 listIn 入场 .3s），
   * 播完再回调 done。任何不满足动画条件的情况（无元素/沙箱假元素/
   * prefers-reduced-motion）都立即同步回调，行为与无动画版完全一致。
   */
  Util.exitRow = function (row, done) {
    var can = false;
    try {
      can = !!(row && row.classList && typeof row.classList.add === 'function'
        && typeof row.offsetHeight === 'number' && row.offsetHeight > 0
        && row.style && typeof row.style === 'object'
        && !(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches));
    } catch (eRow) { can = false; }
    if (!can) { if (typeof done === 'function') done(); return; }
    try {
      row.style.animation = 'none'; /* 摘掉 listIn 的 both 填充——不摘会压住 opacity/transform 过渡 */
      row.style.height = row.offsetHeight + 'px';
      void row.offsetHeight; /* 强制回流，锁住起始高度，height 才有过渡起点 */
      row.classList.add('row-out');
      row.style.height = '0px';
    } catch (eAnim) { if (typeof done === 'function') done(); return; }
    var fired = false;
    function fin() { if (fired) return; fired = true; if (row.removeEventListener) row.removeEventListener('transitionend', fin); if (typeof done === 'function') done(); }
    if (typeof row.addEventListener === 'function') row.addEventListener('transitionend', fin);
    setTimeout(fin, 220); /* 兜底：transitionend 不触发（如标签页切走）也要走 */
  };

  /* -----------------------------------------------------------
   * 删除带撤销：立即删除并提示，停留期内可“撤销”恢复。
   * 比二次确认更顺手，且避免误删造成的数据丢失。
   * opts: { onSave, onAfter, deletedText }
   * 第 85 次：数据落库、撤销 toast **立即**生效（不延迟、无时序风险）；
   * 只有「整页重渲染」推后约 0.2s——先让被删的行播一段离场动画。
   * 找不到对应行（沙箱/该行不在 DOM）时行为与旧版完全一致。
   */
  Util.removeWithUndo = function (arr, id, opts) {
    opts = opts || {};
    var idx = -1;
    for (var i = 0; i < arr.length; i++) { if (arr[i] && arr[i].id === id) { idx = i; break; } }
    if (idx < 0) return;
    var item = arr[idx];
    arr.splice(idx, 1);
    if (typeof opts.onSave === 'function') opts.onSave();
    var rowEl = null;
    try {
      if (typeof document !== 'undefined' && document.querySelector) {
        var delBtn = document.querySelector('[data-del="' + id + '"]');
        rowEl = (delBtn && typeof delBtn.closest === 'function') ? delBtn.closest('li') : null;
      }
    } catch (eDom) { rowEl = null; }
    Util.exitRow(rowEl, function () {
      if (typeof opts.onAfter === 'function') opts.onAfter();
    });
    Util.toast(opts.deletedText || '已删除', 'ok', {
      label: '撤销',
      onClick: function () {
        if (idx > arr.length) idx = arr.length;
        arr.splice(idx, 0, item);
        if (typeof opts.onUndo === 'function') opts.onUndo(item);
        if (typeof opts.onSave === 'function') opts.onSave();
        if (typeof opts.onAfter === 'function') opts.onAfter();
      }
    });
  };

  /* -----------------------------------------------------------
   * 触感反馈（第 45 次）：保存成功/失败给一次轻震，让「记上了」可以被手感确认。
   *
   * 能力边界（如实说明，不假装支持）：Vibration API 只在安卓浏览器（Chrome /
   * Edge / 三星浏览器等）实现；**Safari 全版本包括 iOS 都没有实现**，而 iPhone
   * 上所有浏览器内核都是 WebKit，因此 iPhone 开启本项也不会有任何震动。
   * 这里守卫后静默跳过，不影响保存本身。
   *
   * kind: 'ok'（默认，10ms 极短轻震）| 'error'（双震，提示「没存上」）
   * 尊重 settings.hapticEnabled（默认开启，可在「设置 · 外观」关掉）；
   * 关掉只少一层反馈，不损失任何功能（与 U-04 同款原则）。
   */
  /* -----------------------------------------------------------
   * 第 87 次（UX 研究 P1 · 原则 7 熟手快路径）：列表行长按 550ms
   * 复制该条记录文本——发给医生/家人的最低成本出口。全局委托一次绑定：
   * - 按下点在按钮/输入/链接上不触发（删除键不受影响）；
   * - 移动超 10px 或滚出视为滚动，取消本次长按；
   * - 长按期间拦掉 contextmenu（移动端长按弹菜单），松开不拦；
   * - 复制优先 navigator.clipboard，回落 execCommand；失败只 toast。
   * 纯文案复制，不动任何数据。
   */
  Util.bindLongPressCopy = function () {
    if (Util._lpcBound || typeof document === 'undefined' || !document.body) return;
    Util._lpcBound = true;
    var HOLD = 550, MOVE = 10;
    var timer = null, li = null, sx = 0, sy = 0, pending = false;

    function cancel() { if (timer) { clearTimeout(timer); timer = null; } li = null; pending = false; }
    function rowText(node) {
      var clone = node.cloneNode(true);
      Array.prototype.forEach.call(clone.querySelectorAll('button,input,select,textarea'), function (n) { n.remove(); });
      return String(clone.textContent || '').replace(/\s+/g, ' ').trim();
    }
    function copy(text) {
      if (!text) return;
      function finish(ok) {
        Util.toast(ok ? '已复制该条记录' : '复制失败，请重试', ok ? 'ok' : 'error');
        if (ok) Util.haptic('ok');
      }
      function fallback() {
        try {
          var ta = document.createElement('textarea');
          ta.value = text;
          ta.setAttribute('readonly', '');
          ta.style.cssText = 'position:fixed;left:-9999px;top:0;';
          document.body.appendChild(ta);
          ta.select();
          var ok = document.execCommand('copy');
          document.body.removeChild(ta);
          finish(!!ok);
        } catch (e) { finish(false); }
      }
      if (global.navigator && global.navigator.clipboard && typeof global.navigator.clipboard.writeText === 'function') {
        global.navigator.clipboard.writeText(text).then(function () { finish(true); }, fallback);
      } else fallback();
    }

    document.body.addEventListener('pointerdown', function (e) {
      if (e.button != null && e.button !== 0) return;
      var t = e.target;
      if (!t || !t.closest) return;
      var row = t.closest('.list li');
      if (!row || t.closest('button,input,select,textarea,label,a')) return;
      li = row; sx = e.clientX; sy = e.clientY; pending = true;
      timer = setTimeout(function () {
        timer = null;
        var target = li;
        cancel();
        copy(rowText(target));
      }, HOLD);
    });
    document.body.addEventListener('pointermove', function (e) {
      if (!pending) return;
      if (Math.abs(e.clientX - sx) > MOVE || Math.abs(e.clientY - sy) > MOVE) cancel();
    });
    document.body.addEventListener('pointerup', cancel);
    document.body.addEventListener('pointercancel', cancel);
    /* 触屏滚动兜底（部分环境 pointermove 不密集）与页面滚动即取消 */
    document.body.addEventListener('touchmove', function () { cancel(); }, { passive: true });
    window.addEventListener('scroll', cancel, { passive: true, capture: true });
    /* 长按挂起时拦系统右键/长按菜单；平时不拦，桌面右键不受影响 */
    document.body.addEventListener('contextmenu', function (e) {
      if (!pending) return;
      e.preventDefault();
      cancel();
    });
  };

  Util.haptic = function (kind) {
    try {
      var nav = global.navigator;
      if (!nav || typeof nav.vibrate !== 'function') return false;
      if (global.Storage && global.Storage.get) {
        var d = global.Storage.get();
        if (d && d.settings && d.settings.hapticEnabled === false) return false;
      }
      return nav.vibrate(kind === 'error' ? [22, 56, 22] : 10);
    } catch (e) {
      return false; /* 任何异常都不能波及保存流程本身 */
    }
  };

  /* -----------------------------------------------------------
   * 第 115 次：朗读（TTS）。浏览器原生 speechSynthesis，纯本地、零依赖、零落库。
   *
   * 三条来自实战的硬约束，改动前先读完：
   *   1) 必须**在用户手势的同一个调用栈里同步**调 speechSynthesis.speak()。
   *      包 setTimeout / Promise 会被 iOS Safari 与部分安卓浏览器静默拒绝——
   *      不报错、不发声、onerror 也不触发，表现为「点了没反应」。
   *      所以本函数全程同步，绝不把 speak 包进任何异步回调。
   *   2) Chrome 桌面端朗读长于约 15 秒会自动 pause（引擎的已知上限）。
   *      需自建保活循环（pause+resume），且该循环在结束/失败/被打断时必须清掉。
   *   3) 不支持时**静默失败**——不抛异常、不弹 toast，返回 false 交调用方决定。
   *      喂奶抱娃时手机常被静音，硬报错只会打扰人。
   *
   * 用法：
   *   Util.speak('南瓜泥，第六天引入，观察三天无异常再加新食材。')
   *   Util.speak(text, { rate: 0.8, pitch: 1.1, onend: fn, onfail: fn })
   *   Util.stopSpeak()
   *
   * opts:
   *   rate   语速，默认 0.92（比默认稍慢，辅食/医学名词听得清）
   *   pitch  音调，默认 1.05
   *   lang   默认 'zh-CN'；传 'en-US' 等可读英文（用于 ABC / 单词本）
   *   onend   全文读完回调
   *   onfail  不支持或朗读失败时的回调（可选，不传就什么都不做）
   *
   * 返回 true = 已发起朗读；false = 不支持 / 无内容 / 参数不合法。
   */
  Util.speakSupported = function () {
    try {
      return !!(global.speechSynthesis && typeof global.speechSynthesis.speak === 'function'
        && typeof global.SpeechSynthesisUtterance === 'function');
    } catch (e) { return false; }
  };

  /* 朗读期间的状态。放在闭包外而非每次调用内建，是为了让 stopSpeak()
   * 能拿到正在跑的保活定时器——否则打断后旧定时器会继续对着新语音做
   * pause/resume，把下一段掐成断续发声（这是做之前最容易踩的一个坑）。 */
  var spkKeep = null;   /* 保活定时器 id */
  var spkSeq = 0;       /* 每次发起 +1；回调只认自己这一轮，避免旧回调误伤新语音 */

  function spkClearKeep() {
    if (spkKeep !== null) { global.clearInterval(spkKeep); spkKeep = null; }
  }

  /* 选音色：优先匹配语言的本地语音，其次同语言（可能需联网），
   * 都没有就不指定 voice——由浏览器用默认音色，比硬塞一个错的语言强。 */
  function spkPickVoice(lang) {
    var vs;
    try { vs = global.speechSynthesis.getVoices() || []; } catch (e) { return null; }
    if (!vs.length) return null; /* 首次调用 getVoices() 常返回空数组，等 voiceschanged 后自然会重试 */
    var want = String(lang || '').toLowerCase();
    var i, v, vl;
    for (i = 0; i < vs.length; i++) {
      vl = String(vs[i].lang || '').toLowerCase();
      if (vl === want && vs[i].localService) return vs[i];
    }
    for (i = 0; i < vs.length; i++) {
      vl = String(vs[i].lang || '').toLowerCase();
      if (vl === want) return vs[i];
    }
    /* 只要语言前缀一致（如 zh-CN 找不到就找 zh）——中文单语音设备很常见 */
    var short = want.split('-')[0];
    for (i = 0; i < vs.length; i++) {
      vl = String(vs[i].lang || '').toLowerCase();
      if (vl.split('-')[0] === short) return vs[i];
    }
    return null;
  }

  Util.stopSpeak = function () {
    spkSeq++;                       /* 让在途回调全部失效 */
    spkClearKeep();
    try {
      if (global.speechSynthesis && typeof global.speechSynthesis.cancel === 'function') {
        global.speechSynthesis.cancel();
      }
    } catch (e) { /* 打断失败不影响后续 */ }
  };

  Util.speak = function (text, opts) {
    opts = opts || {};
    /* 不支持就静默失败：返回 false，调用方自行决定要不要提示。
     * 不抛异常是因为喂奶抱娃时手机常在静音，弹窗报错只会打扰人。 */
    if (!Util.speakSupported()) {
      if (typeof opts.onfail === 'function') { try { opts.onfail(); } catch (e) {} }
      return false;
    }
    var body = String(text == null ? '' : text).replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
    if (!body) {
      if (typeof opts.onfail === 'function') { try { opts.onfail(); } catch (e) {} }
      return false;
    }
    var lang = opts.lang || 'zh-CN';
    var seq = ++spkSeq;             /* 本轮代号 */
    var ss = global.speechSynthesis;

    /* 打断上一段：不清掉旧保活定时器的话，它会继续对着新语音 pause/resume */
    spkClearKeep();
    try { ss.cancel(); } catch (e) {}

    /* 长文本整体塞进一个 utterance 会在 15 秒处被引擎掐断，
     * 切成 ≤120 字的段落依次读，才有机会真正读完。 */
    var MAX = 120;
    var segs = [];
    if (body.length <= MAX) {
      segs.push(body);
    } else {
      var rest = body;
      while (rest.length > MAX) {
        /* 第 115 次：把「切点位置」与「该不该切」拆成两件事。
         *
         * 原写法（三级回退共享一道 MAX * 0.5 门槛）有两个问题：
         *   门槛把「靠前的标点」直接作废 → 句号稀疏的长文本会硬切到 MAX 处，
         *     切在词中间，朗读时被听成断句错误；
         *   换一道门槛（如 MAX/4）同样有「靠前就作废」的老问题。
         *
         * 正确做法是两阶段：
         *   1) 先找 MAX 范围内**最靠后**的标点 —— 首选，段长与断句双赢；
         *   2) 一个都没有时，退而用**任意位置**的首个标点 ——
         *      此时段长短一点，但「切在标点上」仍明显优于「切在词中间」；
         *   3) 连一个标点都没有，才按 MAX 硬切（无标点长串，只有这一种选择）。 */
        var PUNCT = ['。', '！', '？', '；', '，', '、'];
        var MIN = Math.floor(MAX / 4);
        var cut = -1;
        var i2, p;
        /* 第 1 阶段：MAX 范围内最靠后的标点。
           但「靠前到不足 1/4 段长」的标点不算数——否则会切出
           「这是第一句话。」这种 7 字碎段，一段段念反而更碎。 */
        for (i2 = 0; i2 < PUNCT.length; i2++) {
          p = rest.lastIndexOf(PUNCT[i2], MAX);
          if (p >= MIN && p > cut) cut = p;
        }
        if (cut < 0) cut = rest.lastIndexOf(' ', MAX); /* 再退到空格（英文） */
        if (cut < 0) {
          /* 第 2 阶段：MAX 内没有标点，退而求其次用首个标点，
             保证永远不切在词中间。但只接受「不短于 MAX/4」的切点——
             否则会切出「这是第一句话。」这种 7 字碎段，
             一段一段念反而更碎，宁可硬切在词中间（无标点长串只能如此）。 */
          for (i2 = 0; i2 < PUNCT.length; i2++) {
            p = rest.indexOf(PUNCT[i2]);
            if (p >= MIN && p > cut) cut = p;
          }
        }
        if (cut < 1) cut = MAX; /* 第 3 阶段：无可用标点，只能硬切 */
        segs.push(rest.slice(0, cut + 1));
        rest = rest.slice(cut + 1);
      }
      /* 末段过短就并入上一段：127 字切两次必然剩个 6 字尾巴，
       * 单独朗读一段 6 字体验很差。
       *
       * 关键约束：合并后仍不得超过 MAX。
       * 首版误用 MAX*1.6 作为上限，结果 165 字文本被合并成整整一段——
       * 而 165 字整段朗读正是 Chrome 15 秒掐断的场景，
       * 等于把「切段」这个功能在最需要它的中等长度文本上悄悄关掉了。
       * 真正要解决的只是「尾巴太短」，所以上限必须回到 MAX，
       * 并额外要求末段本身短于 MIN（否则没必要合并）。 */
      if (rest) {
        var lastSeg = segs[segs.length - 1];
        var MIN2 = Math.floor(MAX / 4);
        if (lastSeg && rest.length < MIN2 && (lastSeg.length + rest.length) <= MAX) {
          segs[segs.length - 1] = lastSeg + rest;
        } else {
          segs.push(rest);
        }
      }
    }

    var done = false;
    var idx = 0;
    var u = null;

    function finish() {
      if (done || seq !== spkSeq) return;
      done = true;
      spkClearKeep();
      if (typeof opts.onend === 'function') { try { opts.onend(); } catch (e) {} }
    }
    function failed() {
      if (done || seq !== spkSeq) return;
      done = true;
      spkClearKeep();
      if (typeof opts.onfail === 'function') { try { opts.onfail(); } catch (e) {} }
    }

    function step() {
      if (done || seq !== spkSeq) return;
      if (idx >= segs.length) { finish(); return; }
      var seg = segs[idx++];
      try {
        u = new global.SpeechSynthesisUtterance(seg);
        u.lang = lang;
        u.rate = typeof opts.rate === 'number' ? opts.rate : 0.92;
        u.pitch = typeof opts.pitch === 'number' ? opts.pitch : 1.05;
        var v = spkPickVoice(lang);
        if (v) u.voice = v;
        u.onend = function () {
          if (done || seq !== spkSeq) return;
          step();
        };
        u.onerror = function () { failed(); };
        /* 关键：这里同步调用，不包 setTimeout（约束 1） */
        ss.speak(u);
      } catch (e) { failed(); return; }
    }

    step();

    /* 保活：Chrome 长文本 15 秒自动 pause，pause+resume 能续上（约束 2）。
     * 只在确实还在读时补；!ss.speaking && !ss.pending 说明已结束或被引擎丢弃，
     * 直接停掉定时器，不要空转。 */
    try {
      spkKeep = global.setInterval(function () {
        if (seq !== spkSeq) { spkClearKeep(); return; }
        var stillOn = false;
        try { stillOn = !!(ss.speaking || ss.pending); } catch (e) { stillOn = false; }
        if (!stillOn) {
          /* 既不在读也不排队：要么读完（onend 已跑），要么引擎静默失败。
           * 后者要靠下面的 600ms 兜底之外再兜一层——这里只在
           * onend/onerror 都没触发时才算失败，避免误报。 */
          if (!done) failed();
          spkClearKeep();
          return;
        }
        try { ss.pause(); ss.resume(); } catch (e) {}
      }, 3000);
    } catch (e) { /* 没有 setInterval 也不影响短文本朗读 */ }

    /* 静默失败兜底：发起后 600ms 仍未发声且不排队，判为失败。
     * 覆盖「语音不可用但既不报错也不发声」的环境（约束 3）。 */
    try {
      global.setTimeout(function () {
        if (done || seq !== spkSeq) return;
        var on = false;
        try { on = !!(ss.speaking || ss.pending); } catch (e) { on = false; }
        if (!on) failed();
      }, 600);
    } catch (e) {}

    return true;
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

  /* -----------------------------------------------------------
   * 第 80 次（宝宝档案/首页日期重设计）：农历与节日。
   * 纯本地零依赖：经典 1900–2049 压缩月表 + 天数偏移换算，误差与通行
   * 农历实现一致（春节/中秋等已用 2019–2035 春节表交叉验证，见 qa）。
   * 只服务「今天是什么日子」的问候展示，不参与任何记录计算。
   * ----------------------------------------------------------- */
  var LUNAR_INFO = [
    0x04bd8,0x04ae0,0x0a570,0x054d5,0x0d260,0x0d950,0x16554,0x056a0,0x09ad0,0x055d2,
    0x04ae0,0x0a5b6,0x0a4d0,0x0d250,0x1d255,0x0b540,0x0d6a0,0x0ada2,0x095b0,0x14977,
    0x04970,0x0a4b0,0x0b4b5,0x06a50,0x06d40,0x1ab54,0x02b60,0x09570,0x052f2,0x04970,
    0x06566,0x0d4a0,0x0ea50,0x06e95,0x05ad0,0x02b60,0x186e3,0x092e0,0x1c8d7,0x0c950,
    0x0d4a0,0x1d8a6,0x0b550,0x056a0,0x1a5b4,0x025d0,0x092d0,0x0d2b2,0x0a950,0x0b557,
    0x06ca0,0x0b550,0x15355,0x04da0,0x0a5b0,0x14573,0x052b0,0x0a9a8,0x0e950,0x06aa0,
    0x0aea6,0x0ab50,0x04b60,0x0aae4,0x0a570,0x05260,0x0f263,0x0d950,0x05b57,0x056a0,
    0x096d0,0x04dd5,0x04ad0,0x0a4d0,0x0d4d4,0x0d250,0x0d558,0x0b540,0x0b5a0,0x195a6,
    0x095b0,0x049b0,0x0a974,0x0a4b0,0x0b27a,0x06a50,0x06d40,0x0af46,0x0ab60,0x09570,
    0x04af5,0x04970,0x064b0,0x074a3,0x0ea50,0x06b58,0x05ac0,0x0ab60,0x096d5,0x092e0,
    0x0c960,0x0d954,0x0d4a0,0x0da50,0x07552,0x056a0,0x0abb7,0x025d0,0x092d0,0x0cab5,
    0x0a950,0x0b4a0,0x0baa4,0x0ad50,0x055d9,0x04ba0,0x0a5b0,0x15176,0x052b0,0x0a930,
    0x07954,0x06aa0,0x0ad50,0x05b52,0x04b60,0x0a6e6,0x0a4e0,0x0d260,0x0ea65,0x0d530,
    0x05aa0,0x076a3,0x096d0,0x04afb,0x04ad0,0x0a4d0,0x1d0b6,0x0d250,0x0d520,0x0dd45,
    0x0b5a0,0x056d0,0x055b2,0x049b0,0x0a577,0x0a4b0,0x0aa50,0x1b255,0x06d20,0x0ada0
  ];
  function lLeapMonth(y) { return LUNAR_INFO[y - 1900] & 0xf; }
  function lMonthDays(y, m) { return (LUNAR_INFO[y - 1900] & (0x10000 >> m)) ? 30 : 29; }
  function lLeapDays(y) {
    if (!lLeapMonth(y)) return 0;
    return (LUNAR_INFO[y - 1900] & 0x10000) ? 30 : 29;
  }
  function lYearDays(y) {
    var sum = 348;
    for (var i = 0x8000; i > 0x8; i >>= 1) sum += (LUNAR_INFO[y - 1900] & i) ? 1 : 0;
    return sum + lLeapDays(y);
  }
  /** 公历 Date → 农历 { y, m, d, leap }；表外年份（>2050）返回 null */
  Util.lunarOf = function (date) {
    try {
      var offset = Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
        - Date.UTC(1900, 0, 31)) / 86400000);
      if (offset < 0) return null;
      var i, temp = 0;
      /* 年定位（通行算法）：offset 恰好扣尽时落在下一年正月初一，i 已自增到位 */
      for (i = 1900; i <= 2049 && offset > 0; i++) { temp = lYearDays(i); offset -= temp; }
      if (offset < 0) { offset += temp; i--; }
      var year = i;
      if (year > 2050 || offset < 0) return null;
      var leap = lLeapMonth(year);
      var isLeap = false, month = 1, day = 1;
      for (i = 1; i <= 12 && offset > 0; i++) {
        if (leap > 0 && i === leap + 1 && !isLeap) { --i; isLeap = true; temp = lLeapDays(year); }
        else temp = lMonthDays(year, i);
        if (isLeap && i === leap + 1) isLeap = false;
        offset -= temp;
      }
      if (offset < 0) { offset += temp; --i; }
      month = i; day = offset + 1;
      return { y: year, m: month, d: day, leap: isLeap && month === leap };
    } catch (e) { return null; }
  };
  /** 今天的节日名（可多个，' · ' 连接）；没有则返回 null。农历 + 公历 + 母亲节/父亲节 */
  Util.festivalOf = function (date) {
    var names = [];
    /* 农历节日 */
    var lu = Util.lunarOf(date);
    if (lu && !lu.leap) {
      var LM = { '1,1': '春节', '1,15': '元宵节', '5,5': '端午节', '7,7': '七夕', '8,15': '中秋节', '9,9': '重阳节', '12,8': '腊八节' };
      var k = lu.m + ',' + lu.d;
      if (LM[k]) names.push(LM[k]);
      /* 除夕：腊月最后一天（30，或腊月只有 29 天时的廿九） */
      if (lu.m === 12 && (lu.d === 30 || (lu.d === 29 && lMonthDays(lu.y, 12) === 29))) names.push('除夕');
    }
    /* 公历固定节日 */
    var SOLAR = { '1,1': '元旦', '3,8': '妇女节', '5,1': '劳动节', '6,1': '儿童节', '9,10': '教师节', '10,1': '国庆节' };
    var ks = date.getMonth() + 1 + ',' + date.getDate();
    if (SOLAR[ks]) names.push(SOLAR[ks]);
    /* 母亲节 = 5 月第 2 个周日；父亲节 = 6 月第 3 个周日 */
    function nthWeekend(y, m, weekday, n) {
      var first = new Date(y, m - 1, 1);
      var off = (weekday - first.getDay() + 7) % 7;
      return 1 + off + (n - 1) * 7;
    }
    if (date.getMonth() === 4 && date.getDate() === nthWeekend(date.getFullYear(), 5, 0, 2)) names.push('母亲节');
    if (date.getMonth() === 5 && date.getDate() === nthWeekend(date.getFullYear(), 6, 0, 3)) names.push('父亲节');
    return names.length ? names.join(' · ') : null;
  };

  /* -----------------------------------------------------------
   * 第 80 次（宝宝档案）：从本机选一张照片并压缩成正方形 dataURL。
   * cover 裁剪到 size×size、JPEG 0.82——288px 成品通常 20~40KB，
   * localStorage 装得下（存储层另有 30 万字符硬上限兜底）。
   * 全程本机：FileReader + canvas，无任何网络。取消选择时静默不回调。
   * ----------------------------------------------------------- */
  Util.pickPhoto = function (cb, size) {
    size = size || 288;
    if (typeof cb !== 'function') return;
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    document.body.appendChild(input);
    var done = false;
    input.addEventListener('change', function () {
      var f = input.files && input.files[0];
      cleanup();
      if (!f) return;
      if (!/^image\//.test(f.type)) { Util.toast ? Util.toast('请选择图片文件', 'warn') : null; return; }
      if (f.size > 15 * 1024 * 1024) { Util.toast ? Util.toast('图片太大（超过 15MB），换一张小的试试', 'warn') : null; return; }
      var fr = new FileReader();
      fr.onload = function () {
        var img = new Image();
        img.onload = function () {
          try {
            var cv = document.createElement('canvas');
            cv.width = size; cv.height = size;
            var ctx = cv.getContext('2d');
            if (!ctx) { cb(null); return; }
            /* cover 裁剪：短边贴满，居中取方 */
            var side = Math.min(img.width, img.height);
            var sx = (img.width - side) / 2, sy = (img.height - side) / 2;
            ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
            cb(cv.toDataURL('image/jpeg', 0.82));
          } catch (e) { cb(null); }
        };
        img.onerror = function () { if (Util.toast) Util.toast('这张图片读不出来，换一张试试', 'warn'); cb(null); };
        img.src = fr.result;
      };
      fr.onerror = function () { if (Util.toast) Util.toast('图片读取失败', 'warn'); cb(null); };
      fr.readAsDataURL(f);
    });
    function cleanup() { if (input.parentNode) input.parentNode.removeChild(input); }
    /* 文件选择取消/窗外点击时 input 不触发 change——失焦后自清理 */
    input.addEventListener('cancel', function () { done = true; cleanup(); });
    try { input.click(); } catch (e) { cleanup(); }
  };

})(window);
