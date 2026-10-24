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
        { k: 'amount', l: '吸奶量（ml）', t: 'num', min: 0, max: 600, step: 5, show: function (r) { return r.type === 'pump'; } },
        { k: 'amountBm', l: '母乳（ml）', t: 'num', min: 0, max: 400, step: 5, show: function (r) { return r.type === 'bottle' || r.type === 'formula'; } },
        { k: 'amountFm', l: '配方奶（ml）', t: 'num', min: 0, max: 400, step: 5, show: function (r) { return r.type === 'bottle' || r.type === 'formula'; } },
        { k: 'dish', l: '菜名', t: 'text', max: 40, show: function (r) { return r.type === 'solid'; } },
        NOTE
      ],
      fix: function (r) {
        if (r.type === 'breast' || r.type === 'pump') {
          var L = r.durationL || 0, R = r.durationR || 0;
          r.durationMin = (L + R) || null;
          r.side = (L && R) ? 'both' : (L ? 'left' : (R ? 'right' : null));
          if (r.type === 'breast' && !L && !R) return '请至少填一侧时长';
        } else if (r.type === 'bottle' || r.type === 'formula') {
          var bm = r.amountBm || 0, fm = r.amountFm || 0;
          /* 老记录只有 amount：两项都没填时保留原 amount */
          if (bm || fm) r.amount = bm + fm;
          if (!r.amount) return '请填写奶量';
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
        NOTE
      ],
      fix: function (r) {
        if (r.end && !(new Date(r.end).getTime() > new Date(r.start).getTime())) return '醒来时间要晚于入睡时间';
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
      arr: 'supplements', title: '编辑补剂打卡',
      fields: [{ k: 'time', l: '时间', t: 'dt' }, NOTE]
    },
    growth: {
      arr: 'growth', title: '编辑测量记录',
      fields: [
        { k: 'date', l: '日期', t: 'date' },
        { k: 'weightKg', l: '体重（kg）', t: 'num', min: 0.5, max: 40, step: 0.01 },
        { k: 'heightCm', l: '身长（cm）', t: 'num', min: 30, max: 130, step: 0.1 },
        { k: 'headCm', l: '头围（cm）', t: 'num', min: 20, max: 60, step: 0.1 }
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

  function open(modId, rec, arr) {
    var sc = SCHEMA[modId];
    var root = document.getElementById('modalRoot');
    if (!root || !sc) return;
    var fields = sc.fields.filter(function (f) { return !f.show || f.show(rec); });
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
      var next = JSON.parse(JSON.stringify(rec));
      for (var i = 0; i < fields.length; i++) {
        var f = fields[i], el = root.querySelector('#reF_' + f.k), raw = el ? String(el.value).trim() : '';
        if (f.t === 'dt') {
          if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)) { Util.markInvalid(el, '请选择时间'); return; }
          var iso = raw.slice(0, 16) + ':00';
          if (new Date(iso).getTime() > Date.now() + 60000) { Util.markInvalid(el, '时间不能在未来'); return; }
          next[f.k] = iso;
        } else if (f.t === 'date') {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || raw > Util.todayISO()) { Util.markInvalid(el, '请选择不晚于今天的日期'); return; }
          next[f.k] = raw;
        } else if (f.t === 'num') {
          if (raw === '') {
            if (f.req) { Util.markInvalid(el, '请填写' + f.l); return; }
            next[f.k] = null;
          } else {
            var n = parseFloat(raw);
            if (!isFinite(n) || n < f.min || n > f.max) { Util.markInvalid(el, '请填 ' + f.min + '–' + f.max); return; }
            next[f.k] = Math.round(n * 100) / 100;
          }
        } else if (f.t === 'sel') {
          next[f.k] = raw || null;
        } else {
          if (!raw && f.req) { Util.markInvalid(el, '请填写' + f.l); return; }
          next[f.k] = raw || null;
        }
      }
      var err = sc.fix ? sc.fix(next) : null;
      if (err) { Util.toast(err, 'warn'); return; }
      var before = JSON.parse(JSON.stringify(rec));
      Object.keys(next).forEach(function (k) { rec[k] = next[k]; });
      close();
      if (Storage.save()) {
        Util.toast('已保存修改', 'ok', { label: '撤销', onClick: function () {
          Object.keys(rec).forEach(function (k) { delete rec[k]; });
          Object.keys(before).forEach(function (k) { rec[k] = before[k]; });
          Storage.save(); if (global.App) global.App.rerender();
        } });
      }
      if (global.App) global.App.rerender();
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

  global.RecordEdit = { schema: SCHEMA, open: open };
})(window);
