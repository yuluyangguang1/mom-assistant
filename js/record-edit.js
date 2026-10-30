/* ============================================================
 * record-edit.js · 第 187 次（Cali 对标 P0：已有记录可编辑）
 *
 * 以前记错只能删掉重记。现在：模块页「最近记录」里点一行（不是点按钮）→
 * 弹出编辑面板，改时间 / 数值 / 备注，保存即生效。
 *
 * 不改各模块的列表markup：凡是 #view 里带 [data-del] 删除按钮的 <li>，
 * 按当前模块查下面的 SCHEMA，用 data-del 的 id 在对应数组里找到这条记录。
 * 找不到（比如补剂页的「计划」行）就不响应，保持原样。
 * 与 swipe-row.js 同一纪律：只接管「行本身」的点击，按钮 / 输入框 / 链接照旧。
 * ============================================================ */
(function (global) {
  'use strict';
  var Util = global.Util, Storage = global.Storage;

  function opt(list) { return list.map(function (x) { return { v: x[0], t: x[1] }; }); }
  var NOTE = { k: 'note', l: '备注', t: 'text', max: 40 };

  /* 字段类型：dt 日期时间 / date 日期 / num 数字 / text 文本 / sel 单选。
     show(rec) 决定字段是否出现；fix(rec) 保存前把派生字段算回来（与新增时同一口径）。 */
  var SCHEMA = {
    feeding: {
      arr: 'feedings', title: '编辑喂养记录',
      fields: [
        { k: 'start', l: '时间', t: 'dt' },
        { k: 'durationL', l: '左侧（分钟）', t: 'num', min: 0, max: 120, step: 1, show: function (r) { return r.type === 'breast' || r.type === 'pump'; } },
        { k: 'durationR', l: '右侧（分钟）', t: 'num', min: 0, max: 120, step: 1, show: function (r) { return r.type === 'breast' || r.type === 'pump'; } },
        { k: 'amountL', l: '左侧奶量（ml）', t: 'num', min: 0, max: 300, step: 5, show: function (r) { return r.type === 'pump'; } },
        { k: 'amountR', l: '右侧奶量（ml）', t: 'num', min: 0, max: 300, step: 5, show: function (r) { return r.type === 'pump'; } },
        { k: 'amount', l: '泵奶总量（ml）', t: 'num', min: 0, max: 600, step: 5, show: function (r) { return r.type === 'pump' && !r.amountL && !r.amountR; } },
        { k: 'amountBm', l: '母乳（ml）', t: 'num', min: 0, max: 400, step: 5, show: function (r) { return r.type === 'bottle' || r.type === 'formula'; } },
        { k: 'amountFm', l: '配方奶（ml）', t: 'num', min: 0, max: 400, step: 5, show: function (r) { return r.type === 'bottle' || r.type === 'formula'; } },
        { k: 'dish', l: '菜名', t: 'text', max: 40, show: function (r) { return r.type === 'solid'; } },
        NOTE
      ],
      fix: function (r, orig) {
        if (r.type === 'breast' || r.type === 'pump') {
          var L = r.durationL || 0, R = r.durationR || 0;
          /* 第 273 次（审计 #15：泵奶只改备注，时长 15 → 30）：左右分钟没动就不重算 durationMin——
             计时记录的 durationMin 是按秒折算的（泵奶还算上了单侧轮流的总时长），用分钟重拼会变 */
          var sameDur = orig && (orig.durationL || 0) === L && (orig.durationR || 0) === R;
          /* 第 231 次：计时得来的秒数（secL/secR）在分钟被改过后作废，以分钟为准 */
          if (r.secL != null && Math.round(r.secL / 60) !== L) delete r.secL;
          if (r.secR != null && Math.round(r.secR / 60) !== R) delete r.secR;
          /* 口径与新建一致：亲喂 = 左 + 右；泵奶是两侧同时泵，= max(左, 右)（pump.js 计时 / 补记都这么存） */
          if (!sameDur) {
            if (r.type === 'pump') r.durationMin = Math.max(L, R) || null;
            else r.durationMin = (L + R) || (r.secL || r.secR ? 1 : null);
          }
          if (r.type === 'breast' && !L && !R && (r.secL || r.secR)) return null;
          if (!sameDur) r.side = (L && R) ? 'both' : (L ? 'left' : (R ? 'right' : null)); /* 第 273 次：没改时长时侧别也不动（泵奶只填奶量的记录侧别来自奶量） */
          if (r.type === 'breast' && !L && !R) return '请至少填一侧时长';
          /* 第 256 次：泵奶分左右奶量时，总量 = 左 + 右 */
          if (r.type === 'pump' && (r.amountL || r.amountR)) r.amount = (r.amountL || 0) + (r.amountR || 0);
        } else if (r.type === 'bottle' || r.type === 'formula') {
          var bm = r.amountBm || 0, fm = r.amountFm || 0;
          /* 老记录只有 amount：两项都没填时保留原 amount */
          if (bm || fm) r.amount = bm + fm;
          if (!r.amount) return '请填写奶量';
          /* 第 195 次：手改了喝下量、和「冲 − 剩」对不上时，丢掉冲/剩信息，免得行里显示矛盾 */
          if (r.leftover > 0 && ((r.preparedBm || 0) + (r.preparedFm || 0) - r.leftover) !== r.amount) {
            delete r.leftover; delete r.preparedBm; delete r.preparedFm;
          }
        }
        return null;
      }
    },
    diaper: {
      arr: 'diapers', title: '编辑尿布记录',
      fields: [
        { k: 'time', l: '时间', t: 'dt' },
        { k: 'type', l: '类型', t: 'sel', opts: opt([['pee', '尿'], ['poop', '便'], ['both', '尿+便']]) },
        NOTE
      ]
    },
    sleep: {
      arr: 'sleeps', title: '编辑睡眠记录',
      fields: [
        { k: 'start', l: '入睡', t: 'dt' },
        { k: 'end', l: '醒来', t: 'dt', show: function (r) { return !!r.end; } },
        { k: 'wakings', l: '中途醒来（次）', t: 'num', min: 0, max: 30, step: 1 },
        NOTE
      ],
      fix: function (r) {
        if (r.end && !(new Date(r.end).getTime() > new Date(r.start).getTime())) return '醒来时间要晚于入睡时间';
        r.longestMin = null; /* 第 241 次：时长或醒来次数改了，最长连续按新值重新折算 */
        return null;
      }
    },
    temp: {
      arr: 'temps', title: '编辑体温记录',
      fields: [
        { k: 'time', l: '时间', t: 'dt' },
        { k: 'value', l: '体温（°C）', t: 'num', min: 34, max: 43, step: 0.1, req: true },
        NOTE
      ]
    },
    meds: {
      arr: 'meds', title: '编辑用药记录',
      fields: [
        { k: 'time', l: '时间', t: 'dt' },
        { k: 'name', l: '名称', t: 'text', max: 30, req: true },
        NOTE
      ]
    },
    water: {
      arr: 'waters', title: '编辑饮水记录',
      fields: [
        { k: 'time', l: '时间', t: 'dt' },
        { k: 'ml', l: '水量（ml）', t: 'num', min: 1, max: 500, step: 5, req: true },
        NOTE
      ]
    },
    jaundice: {
      arr: 'jaundices', title: '编辑黄疸记录',
      fields: [
        { k: 'time', l: '时间', t: 'dt' },
        { k: 'value', l: '数值', t: 'num', min: 0, max: 500, step: 0.1, req: true },
        NOTE
      ]
    },
    supplement: {
      arr: 'supplements', title: '编辑服用记录',
      fields: [{ k: 'time', l: '时间', t: 'dt' }, NOTE]
    },
    growth: {
      arr: 'growth', title: '编辑测量记录',
      fields: [
        { k: 'date', l: '日期', t: 'date' },
        /* 第 278 次（审计 #38）：和生长页录入范围同一套；第 284 次跟着生长页改成 体重 1–40 / 身高 30–160 / 头围 20–70 */
        { k: 'weightKg', l: '体重（kg）', t: 'num', min: 1, max: 40, step: 0.01 },
        { k: 'heightCm', l: '身高（cm）', t: 'num', min: 30, max: 160, step: 0.1 },
        { k: 'headCm', l: '头围（cm）', t: 'num', min: 20, max: 70, step: 0.1 }
      ],
      fix: function (r) {
        if (r.weightKg == null && r.heightCm == null && r.headCm == null) return '至少保留一项测量值';
        return null;
      }
    },
    milestone: {
      arr: 'milestones', title: '编辑里程碑',
      fields: [
        { k: 'title', l: '里程碑', t: 'text', max: 40, req: true },
        { k: 'date', l: '日期', t: 'date' },
        NOTE
      ]
    },
    fetal: {
      arr: 'fetal', title: '编辑胎动记录',
      fields: [{ k: 'time', l: '时间', t: 'dt' }]
    },
    contraction: {
      arr: 'contractions', title: '编辑宫缩记录',
      fields: [
        { k: 'start', l: '开始', t: 'dt' },
        { k: 'end', l: '结束', t: 'dt', show: function (r) { return !!r.end; } },
        { k: 'intensity', l: '强度', t: 'sel', opts: [{ v: '', t: '未选' }, { v: '1', t: '轻' }, { v: '2', t: '中' }, { v: '3', t: '强' }] }
      ],
      fix: function (r) {
        r.intensity = r.intensity ? parseInt(r.intensity, 10) : null;
        if (r.end && !(new Date(r.end).getTime() > new Date(r.start).getTime())) return '结束要晚于开始';
        return null;
      }
    }
  };

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dtValue(s) {
    var t = new Date(s);
    if (!s || isNaN(t.getTime())) return '';
    return t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate()) + 'T' + pad(t.getHours()) + ':' + pad(t.getMinutes());
  }

  function fieldHTML(f, rec) {
    var v = rec[f.k];
    var id = 'reF_' + f.k;
    if (f.t === 'dt') {
      return '<label>' + f.l + '<input type="datetime-local" id="' + id + '" value="' + dtValue(v) + '"></label>';
    }
    if (f.t === 'date') {
      var dv = (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) ? v.slice(0, 10) : '';
      return '<label>' + f.l + '<input type="date" id="' + id + '" max="' + Util.todayISO() + '" value="' + dv + '"></label>';
    }
    if (f.t === 'num') {
      return '<label>' + f.l + '<input type="number" id="' + id + '" inputmode="decimal" min="' + f.min + '" max="' + f.max + '" step="' + f.step + '" value="'
        + (typeof v === 'number' && isFinite(v) ? v : '') + '"></label>';
    }
    if (f.t === 'sel') {
      return '<label>' + f.l + '<select id="' + id + '">' + f.opts.map(function (o) {
        return '<option value="' + o.v + '"' + (String(v == null ? '' : v) === o.v ? ' selected' : '') + '>' + o.t + '</option>';
      }).join('') + '</select></label>';
    }
    return '<label>' + f.l + '<input type="text" id="' + id + '" maxlength="' + (f.max || 40) + '" value="'
      + Util.escapeHtml(v == null ? '' : String(v)) + '"></label>';
  }

  /* 第 326 次（审查 P0-2）：校验 + 写回抽成 commit——老编辑框和新 FTUI 面板走同一段，字段 / 校验 / 写回 / 撤销完全一致。
     raws：{ 字段 k: 输入框原样字符串 }（dt 是 'YYYY-MM-DDTHH:MM'）；bad(k, msg)：标出出错的字段。返回 true = 已保存。 */
  function commit(sc, fields, rec, raws, bad) {
    var next = JSON.parse(JSON.stringify(rec));
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i], raw = String(raws[f.k] == null ? '' : raws[f.k]).trim();
      if (f.t === 'dt') {
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)) { bad(f.k, '请选择时间'); return false; }
        /* 第 273 次（审计 #14：只改强度 / 备注，开始结束被截成 HH:MM:00，同一分钟内起止的宫缩保存不了）：
           输入框只到分钟；用户没动这个时间（和打开时显示的一样）就原样保留原值（含秒），动了才按分钟写 */
        if (raw.slice(0, 16) === dtValue(rec[f.k]) && typeof rec[f.k] === 'string') { next[f.k] = rec[f.k]; continue; }
        var iso = raw.slice(0, 16) + ':00';
        if (new Date(iso).getTime() > Date.now() + 60000) { bad(f.k, '时间不能在未来'); return false; }
        next[f.k] = iso;
      } else if (f.t === 'date') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || raw > Util.todayISO()) { bad(f.k, '请选择不晚于今天的日期'); return false; }
        next[f.k] = raw;
      } else if (f.t === 'num') {
        if (raw === '') {
          if (f.req) { bad(f.k, '请填写' + f.l); return false; }
          next[f.k] = null;
        } else {
          /* 第 278 次（审计 #38）：没动的数值（和原值一样）原样保留、不做范围校验——老数据 / 导入的值超出范围时，也能只改日期等别的字段 */
          if (typeof rec[f.k] === 'number' && isFinite(rec[f.k]) && parseFloat(raw) === rec[f.k]) { next[f.k] = rec[f.k]; continue; }
          var n = parseFloat(raw);
          if (!isFinite(n) || n < f.min || n > f.max) { bad(f.k, '请填 ' + f.min + '–' + f.max); return false; }
          next[f.k] = Math.round(n * 100) / 100;
        }
      } else if (f.t === 'sel') {
        next[f.k] = raw || null;
      } else {
        if (!raw && f.req) { bad(f.k, '请填写' + f.l); return false; }
        next[f.k] = raw || null;
      }
    }
    var err = sc.fix ? sc.fix(next, rec) : null;
    if (err) { Util.toast(err, 'warn'); return false; }
    var before = JSON.parse(JSON.stringify(rec));
    Object.keys(next).forEach(function (k) { rec[k] = next[k]; });
    return { before: before };
  }
  function afterCommit(rec, before) {
    if (Storage.save()) {
      Util.toast('已保存修改', 'ok', { label: '撤销', onClick: function () {
        Object.keys(rec).forEach(function (k) { delete rec[k]; });
        Object.keys(before).forEach(function (k) { rec[k] = before[k]; });
        Storage.save(); if (global.App) global.App.rerender();
      } });
    }
    if (global.App) global.App.rerender();
  }

  /* 第 326 次（审查 P0-2）：睡眠、亲喂 / 瓶喂 / 泵奶的修改改走 FTUI 半屏面板（和新增同一套：× / 居中标题 / 日期 + 时间磁贴 /
     步进器 / 备注 / 「删除这条记录」/ 54 高「保存修改」保存条）。字段仍按 SCHEMA（show 条件不变），校验与写回走同一个 commit。 */
  var FT_EDIT = {
    breast: { accent: 'breast', title: '修改亲喂', del: '已删除喂养记录' },
    pump: { accent: 'pump', title: '修改泵奶', del: '已删除喂养记录' },
    bottle: { accent: 'bottle', title: '修改瓶喂', del: '已删除喂养记录' },
    formula: { accent: 'bottle', title: '修改瓶喂', del: '已删除喂养记录' },
    sleep: { accent: 'sleep', title: '修改睡眠', del: '已删除睡眠记录' }
  };
  function ftKind(modId, rec) {
    if (modId === 'sleep') return 'sleep';
    if ((modId === 'feeding' || modId === 'breast' || modId === 'bottle') && rec && FT_EDIT[rec.type] && rec.type !== 'sleep') return rec.type;
    return null;
  }
  function openFT(kind, sc, fields, rec, arr) {
    var FT = global.FTUI, cfg = FT_EDIT[kind], esc = Util.escapeHtml;
    var today = Util.todayISO(), np = 0, pre = {};
    var body = fields.map(function (f) {
      var v = rec[f.k];
      if (f.t === 'dt') {
        var p = 'reT' + (np++); pre[f.k] = p;
        var dv = dtValue(v) || (today + 'T00:00');
        return FT.whenTiles(p, f.l, dv.slice(0, 10), dv.slice(11, 16), today).replace(/结束日期/g, '日期').replace(/结束时间/g, '时间');
      }
      if (f.t === 'num') {
        var val = (typeof v === 'number' && isFinite(v)) ? v : '';
        var m = /^(.*?)（(.+)）$/.exec(f.l), lab = m ? m[1] : f.l, unit = m ? m[2] : '';
        return '<p class="rs-lbl">' + esc(lab) + '</p><div class="ft-step" data-restep="' + f.k + '">'
          + '<button type="button" class="ft-sb" data-d="-1" aria-label="减少">−</button>'
          + '<span class="ft-sv"><input type="number" inputmode="' + (f.step < 1 ? 'decimal' : 'numeric') + '" id="reF_' + f.k + '" min="' + f.min + '" max="' + f.max + '" step="' + f.step + '" value="' + val + '" placeholder="—" aria-label="' + esc(f.l) + '"><small>' + esc(unit) + '</small></span>'
          + '<button type="button" class="ft-sb" data-d="1" aria-label="增加">+</button></div>';
      }
      return '<label class="rs-lbl ft-note">' + esc(f.l) + '<input type="text" id="reF_' + f.k + '" maxlength="' + (f.max || 40) + '" placeholder="可选" value="' + esc(v == null ? '' : String(v)) + '"></label>';
    }).join('')
      + '<button type="button" class="btn rs-del" data-redel>删除这条记录</button>'
      + '<div class="rs-savebar"><button type="button" class="btn btn-primary ft-save" data-resave>保存修改</button></div>';
    FT.openSheet(cfg.accent, cfg.title, body, function (api) {
      var box = api.box;
      box.closest('.modal').classList.add('re-ft');
      Array.prototype.forEach.call(box.querySelectorAll('[data-restep]'), function (w) {
        var inp = w.querySelector('input'), f = fields.filter(function (x) { return x.k === w.getAttribute('data-restep'); })[0];
        Array.prototype.forEach.call(w.querySelectorAll('[data-d]'), function (b) {
          b.addEventListener('click', function () {
            var cur = parseFloat(inp.value); if (!isFinite(cur)) cur = 0;
            var v = Math.max(f.min, Math.min(f.max, cur + Number(b.getAttribute('data-d')) * f.step));
            inp.value = String(Math.round(v * 100) / 100);
            if (inp.classList.contains('is-invalid')) Util.markInvalid(inp, '');
          });
        });
      });
      function raws() {
        var o = {};
        fields.forEach(function (f) {
          if (f.t === 'dt') {
            var dv = box.querySelector('#' + pre[f.k] + 'Date'), tv = box.querySelector('#' + pre[f.k] + 'Time');
            o[f.k] = (dv && tv && dv.value && tv.value) ? dv.value + 'T' + tv.value.slice(0, 5) : '';
          } else { var el = box.querySelector('#reF_' + f.k); o[f.k] = el ? el.value : ''; }
        });
        return o;
      }
      function bad(k, msg) {
        var el = box.querySelector('#reF_' + k);
        if (el) Util.markInvalid(el, msg); else Util.toast(msg, 'warn');
      }
      box.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('button') : null;
        if (!b || !box.contains(b)) return;
        if (b.hasAttribute('data-resave')) {
          var r = commit(sc, fields, rec, raws(), bad);
          if (!r) return;
          api.close(); afterCommit(rec, r.before);
          return;
        }
        if (b.hasAttribute('data-redel')) {
          api.close();
          Util.removeWithUndo(arr, rec.id, {
            onSave: function () { Storage.save(); },
            onAfter: function () { if (global.App) global.App.rerender(); },
            deletedText: cfg.del
          });
        }
      });
    });
  }

  function open(modId, rec, arr) {
    /* 第 269 次：辅食有自己的记录面板（性状 / 量 / 进食情况 / 类型 / 照片），从哪里点进来都走它 */
    if (rec && rec.type === 'solid' && global.Modules && Modules.solid && Modules.solid._edit) { Modules.solid._edit(rec); return; }
    var sc = SCHEMA[modId];
    var root = document.getElementById('modalRoot');
    if (!root || !sc) return;
    var fields = sc.fields.filter(function (f) { return !f.show || f.show(rec); });
    var kind = ftKind(modId, rec);
    if (kind && global.FTUI && FTUI.openSheet) {
      if (!Array.isArray(arr)) arr = Storage.get()[sc.arr];
      openFT(kind, sc, fields, rec, arr);
      return;
    }
    root.innerHTML = '<div class="modal-mask" data-re-mask><div class="modal rec-edit" role="dialog" aria-modal="true" aria-labelledby="reTitle">'
      + '<h2 id="reTitle">' + Util.escapeHtml(sc.title) + '</h2>'
      + fields.map(function (f) { return fieldHTML(f, rec); }).join('')
      + '<div class="modal-actions"><button type="button" class="btn" data-re-cancel>取消</button>'
      + '<button type="button" class="btn btn-primary" data-re-ok>保存</button></div></div></div>';
    var mask = root.querySelector('[data-re-mask]');
    function close() { root.innerHTML = ''; document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    mask.addEventListener('click', function (e) { if (e.target === mask) close(); });
    root.querySelector('[data-re-cancel]').addEventListener('click', close);
    root.querySelector('[data-re-ok]').addEventListener('click', function () {
      var o = {};
      fields.forEach(function (f) { var el = root.querySelector('#reF_' + f.k); o[f.k] = el ? el.value : ''; });
      var r = commit(sc, fields, rec, o, function (k, msg) { Util.markInvalid(root.querySelector('#reF_' + k), msg); });
      if (!r) return;
      close(); afterCommit(rec, r.before);
    });
    try { var first = root.querySelector('input,select'); if (first && first.type !== 'datetime-local') first.focus(); } catch (e) {}
  }

  function bind() {
    var view = document.getElementById('view');
    if (!view) return;
    view.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      if (t.closest('button, a, input, select, textarea, label, summary, .swipe-act')) return;
      var li = t.closest('li');
      if (!li || !view.contains(li)) return;
      /* 左滑删除打开中 / 拖动中：这次点击是收回，不是编辑 */
      if (li.classList.contains('sw-active') || (li.style && li.style.transform)) return;
      var del = li.querySelector('[data-del]');
      if (!del || del.closest('li') !== li) return;
      var mod = global.App && global.App.currentTab ? global.App.currentTab() : null;
      var sc = SCHEMA[mod];
      if (!sc) return;
      var arr = Storage.get()[sc.arr];
      if (!Array.isArray(arr)) return;
      var id = del.getAttribute('data-del');
      var rec = arr.filter(function (r) { return r && String(r.id) === id; })[0];
      if (!rec) return;
      open(mod, rec, arr);
    });
  }

  /* 可发现性：有可编辑行的列表，在它所在卡片标题下放一句「点一条记录可以修改」（每卡一次） */
  function hint() {
    var view = document.getElementById('view');
    var mod = global.App && global.App.currentTab ? global.App.currentTab() : null;
    if (!view || !SCHEMA[mod]) return;
    Array.prototype.forEach.call(view.querySelectorAll('.card'), function (card) {
      if (card.querySelector('.re-hint')) return;
      var h2 = card.querySelector(':scope > h2');
      if (!h2) return;
      var b0 = card.querySelector('.list li [data-del]');
      if (!b0) return;
      var arr = Storage.get()[SCHEMA[mod].arr], id0 = b0.getAttribute('data-del');
      if (!Array.isArray(arr) || !arr.some(function (r) { return r && String(r.id) === id0; })) return;
      var p = document.createElement('p');
      p.className = 'hint re-hint';
      p.textContent = '点一条记录可以修改';
      h2.insertAdjacentElement('afterend', p);
    });
  }
  function boot() {
    bind();
    var view = document.getElementById('view');
    if (view && global.MutationObserver) new MutationObserver(function () { hint(); }).observe(view, { childList: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  /* 第 231 次：亲喂、瓶喂独立页沿用喂养的编辑表 */
  SCHEMA.breast = SCHEMA.feeding; SCHEMA.bottle = SCHEMA.feeding;
  global.RecordEdit = { schema: SCHEMA, open: open, _ftKind: ftKind };
})(window);
