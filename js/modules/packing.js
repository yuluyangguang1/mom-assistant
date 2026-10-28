/**
 * packing.js - 待产包清单
 * 第 295 次（对标 Cali 待产包）：按「妈妈包 / 宝宝包 / 证件包」分组勾选；顶部进度卡（x / N、百分比、进度条）+ 一句摘要；
 * 每项右侧「…」编辑 / 删除；底部「添加物品」半屏（名称 + 分组）。默认清单 15 项。
 * 老数据（入院 / 产房 / 月子房 等场景分组）按名称归到三组，同组同名合并（任一勾过算已备），不丢东西。
 * 记录形状：d.packing = { seeded, v295, items: [{ id, cat, name, checked, hint?, updatedAt? }] }
 */
(function (global) {
  'use strict';
  var Storage = global.Storage, Util = global.Util;
  var Modules = global.Modules = global.Modules || {};

  var GROUPS = ['妈妈包', '宝宝包', '证件包'];
  var PRESET = {
    '妈妈包': ['产褥垫', '哺乳内衣', '出院衣服', '拖鞋', '洗漱用品', '一次性内裤'],
    '宝宝包': ['纸尿裤', '包被', '连体衣', '湿巾', '护臀膏', '奶瓶'],
    '证件包': ['身份证', '医保卡或电子医保', '产检病历本']
  };
  var NAME_MAX = 20;
  var filter = 'all';

  function esc(s) { return Util.escapeHtml(s == null ? '' : String(s)); }
  function stamp() { return Util.nowLocal(); }

  /* 老分组 → 三组：证件类 → 证件包；宝宝用的 → 宝宝包；其余 → 妈妈包 */
  var RE_DOC = /身份证|医保|病历|证件|户口|结婚证|准生|生育服务|母子健康手册|银行卡|产检本|建档/;
  var RE_BABY = /宝宝|婴儿|新生儿|纸尿裤|尿不湿|湿巾|包被|抱被|连体衣|和尚服|护臀|奶瓶|奶粉|奶嘴|口水巾|胎帽|袜/;
  function groupOf(it) {
    if (GROUPS.indexOf(it.cat) >= 0) return it.cat;
    var n = String(it.name || '');
    if (RE_DOC.test(n)) return '证件包';
    if (RE_BABY.test(n)) return '宝宝包';
    return '妈妈包';
  }
  function migrate(d) {
    var pk = d.packing;
    if (!pk || typeof pk !== 'object') pk = d.packing = { seeded: false, items: [] };
    if (!Array.isArray(pk.items)) pk.items = [];
    var changed = false;
    if (!pk.seeded) {
      GROUPS.forEach(function (g) { PRESET[g].forEach(function (n) { pk.items.push({ id: Util.uid(), cat: g, name: n, checked: false }); }); });
      pk.seeded = true; pk.v295 = 1; changed = true;
    } else if (!pk.v295) {
      var out = [], seen = {};
      pk.items.forEach(function (it) {
        if (!it || typeof it !== 'object' || !String(it.name || '').trim()) return;
        var g = groupOf(it), key = g + '|' + String(it.name).trim();
        if (seen[key]) { if (it.checked) seen[key].checked = true; return; }
        it.cat = g; seen[key] = it; out.push(it);
      });
      pk.items = out; pk.v295 = 1; changed = true;
    }
    return changed;
  }
  function counts(items) {
    var n = items.length, c = items.filter(function (x) { return x && x.checked; }).length;
    return { n: n, c: c, pct: n ? Math.round(c / n * 100) : 0 };
  }

  var CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 12.5l3.6 3.6 7.4-8" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  function moreSV() { return (global.FTUI && FTUI.SV && FTUI.SV.more) || '…'; }

  function pageHTML(d) {
    var items = d.packing.items, k = counts(items);
    var h = '<section class="pk-prog"><div class="pk-ph"><b class="pk-frac">' + k.c + ' / ' + k.n + '</b><span class="pk-pct">' + k.pct + '%</span>'
      + '<label class="su-ib pk-fb" title="筛选">' + '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M7 12h10M10 17h4" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>'
      + (filter !== 'all' ? '<i class="su-dot"></i>' : '') + '<select id="pkFilter" aria-label="筛选">'
      + [['all', '显示全部'], ['todo', '只看未准备'], ['done', '只看已准备']].map(function (o) { return '<option value="' + o[0] + '"' + (filter === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('')
      + (k.c ? '<option value="reset">全部取消勾选</option>' : '') + '</select></label></div>'
      + '<div class="pk-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + k.pct + '" aria-label="已准备 ' + k.pct + '%"><i style="width:' + k.pct + '%"></i></div>'
      + '<p class="pk-note">不同医院要求会不同，按你的住院清单保留。</p></section>';
    if (!k.n) h += '<p class="pk-sum">清单是空的，添加住院要带的物品。</p>';
    else if (k.c === k.n) h += '<p class="pk-sum">清单上的物品都已准备好。</p>';
    else h += '<p class="pk-sum"><b>待产包</b>已准备好 <b>' + k.c + '</b> 项物品，还有 <b>' + (k.n - k.c) + '</b> 项未完成准备。</p>';
    var any = false;
    GROUPS.forEach(function (g) {
      var list = items.filter(function (x) { return x.cat === g && (filter === 'all' || (filter === 'done' ? x.checked : !x.checked)); });
      if (!list.length) return;
      any = true;
      var all = items.filter(function (x) { return x.cat === g; }), gk = counts(all);
      h += '<section class="pk-grp"><p class="pk-gh"><span>' + g + '</span><small>' + gk.c + ' / ' + gk.n + '</small></p><ul class="pk-list">';
      list.forEach(function (it) {
        h += '<li class="pk-row' + (it.checked ? ' is-done' : '') + '"><button type="button" class="pk-chk" data-pkchk="' + esc(it.id) + '" role="checkbox" aria-checked="' + !!it.checked + '" aria-label="' + esc(it.name) + (it.checked ? '，已准备' : '，未准备') + '">'
          + '<span class="pk-ring">' + CHECK + '</span><span class="pk-nm">' + esc(it.name) + '</span>' + (it.hint ? '<span class="pk-tag">' + esc(it.hint) + '</span>' : '') + '</button>'
          + '<label class="pk-more" title="更多">' + moreSV() + '<select data-pkmenu="' + esc(it.id) + '" aria-label="' + esc(it.name) + ' 更多操作"><option value="" selected disabled>' + esc(it.name) + '</option><option value="edit">编辑物品</option><option value="del">删除</option></select></label></li>';
      });
      h += '</ul></section>';
    });
    if (k.n && !any) h += '<p class="pk-none">' + (filter === 'done' ? '还没有准备好的物品。' : '都准备好了。') + '</p>';
    h += '<div class="mod-cta"><button type="button" class="mc-main" data-pkadd>' + icon('plus') + '<span>添加物品</span></button></div>';
    return h;
  }

  function openItem(it) {
    var F = global.FTUI; if (!F) return;
    var st = { name: it ? it.name : '', cat: it ? it.cat : GROUPS[0] };
    F.openSheet('packing', it ? '编辑物品' : '添加物品', '<div class="pk-ed" id="pkEd"></div>', function (api) {
      api.box.closest('.modal').classList.add('pk-sheet');
      var wrap = api.box.querySelector('#pkEd');
      function paint() {
        wrap.innerHTML = '<input type="text" class="pk-in" id="pkName" maxlength="' + NAME_MAX + '" placeholder="物品名称" value="' + esc(st.name) + '" aria-label="物品名称">'
          + '<div class="rs-seg pk-seg" role="radiogroup" aria-label="分组">' + GROUPS.map(function (g) { return '<button type="button" role="radio" data-pkg="' + g + '" class="' + (st.cat === g ? 'on' : '') + '" aria-checked="' + (st.cat === g) + '">' + g + '</button>'; }).join('') + '</div>'
          + (it ? '<button type="button" class="btn rs-del" data-pkdel>删除这件物品</button>' : '')
          + '<div class="rs-savebar"><button type="button" class="btn btn-primary rs-save" data-pksave>' + icon('check') + '<span>保存</span></button></div>';
      }
      paint();
      var ni = function () { return wrap.querySelector('#pkName'); };
      if (!it) setTimeout(function () { var x = ni(); if (x) x.focus(); }, 60);
      wrap.addEventListener('input', function (e) { if (e.target.id === 'pkName') st.name = e.target.value; });
      var busy = false;
      function save() {
        if (busy) return;
        var name = String(st.name || '').trim().slice(0, NAME_MAX);
        if (!name) { Util.markInvalid(ni(), '填一下物品名称'); return; }
        var d = Storage.get(), items = d.packing.items;
        var clash = items.filter(function (x) { return x !== it && x.cat === st.cat && String(x.name).trim() === name; })[0];
        if (clash) { Util.markInvalid(ni(), st.cat + '里已经有「' + name + '」'); return; }
        busy = true;
        if (it) { it.name = name; it.cat = st.cat; it.updatedAt = stamp(); }
        else items.push({ id: Util.uid(), cat: st.cat, name: name, checked: false, updatedAt: stamp() });
        if (!Storage.save()) { busy = false; return; }
        api.close();
        Util.toast(it ? '已保存' : '已添加到' + st.cat + '：' + name, 'ok');
        global.App.rerender();
      }
      wrap.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('button') : null; if (!b) return;
        if (b.hasAttribute('data-pkg')) { st.name = ni().value; st.cat = b.getAttribute('data-pkg'); paint(); return; }
        if (b.hasAttribute('data-pksave')) { st.name = ni().value; save(); return; }
        if (b.hasAttribute('data-pkdel')) { api.close(); remove(it.id); }
      });
      wrap.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.id === 'pkName') { e.preventDefault(); st.name = ni().value; save(); } });
      var ok = api.box.querySelector('[data-ok]'); if (ok) ok.addEventListener('click', function () { st.name = ni().value; save(); });
    });
  }
  function remove(id) {
    var d = Storage.get(), it = d.packing.items.filter(function (x) { return x.id === id; })[0];
    if (!it) return;
    Util.removeWithUndo(d.packing.items, id, { onSave: function () { Storage.save(); }, onAfter: function () { global.App.rerender(); }, deletedText: '已删除「' + it.name + '」' });
  }
  function canOpen() { return !document.querySelector('#modalRoot > .modal-mask:not(.sheet-leaving)'); }

  Modules.packing = {
    id: 'packing',
    title: '待产包',
    GROUPS: GROUPS,
    PRESET: PRESET,
    _migrate: migrate,
    _groupOf: groupOf,
    _open: function (id) { var it = id ? Storage.get().packing.items.filter(function (x) { return x.id === id; })[0] : null; openItem(it || null); },
    render: function (view) {
      var d = Storage.get();
      if (migrate(d)) Storage.save();
      view.innerHTML = '<div class="ft-page pk-page" data-accent="packing">' + pageHTML(d) + '</div>';
      view.querySelector('#pkFilter').addEventListener('change', function () {
        var v = this.value;
        if (v === 'reset') {
          var was = d.packing.items.filter(function (x) { return x.checked; }).map(function (x) { return x.id; });
          d.packing.items.forEach(function (x) { x.checked = false; });
          Storage.save(); global.App.rerender();
          Util.toast('已全部取消勾选', 'ok', { label: '撤销', onClick: function () { d.packing.items.forEach(function (x) { if (was.indexOf(x.id) >= 0) x.checked = true; }); Storage.save(); global.App.rerender(); } });
          return;
        }
        filter = v; global.App.rerender();
      });
      Array.prototype.forEach.call(view.querySelectorAll('[data-pkchk]'), function (b) {
        b.addEventListener('click', function () {
          var it = d.packing.items.filter(function (x) { return x.id === b.getAttribute('data-pkchk'); })[0];
          if (!it) return;
          it.checked = !it.checked; it.updatedAt = stamp();
          if (Util.haptic) Util.haptic(it.checked ? 'ok' : 'light');
          Storage.save(); global.App.rerender();
          var k = counts(d.packing.items);
          if (it.checked && k.n && k.c === k.n) Util.toast('待产包都准备好了', 'ok');
        });
      });
      Array.prototype.forEach.call(view.querySelectorAll('[data-pkmenu]'), function (s) {
        s.addEventListener('change', function () {
          var v = s.value, id = s.getAttribute('data-pkmenu'); s.selectedIndex = 0;
          if (v === 'edit') { if (canOpen()) Modules.packing._open(id); }
          else if (v === 'del') remove(id);
        });
      });
      view.querySelector('[data-pkadd]').addEventListener('click', function () { if (canOpen()) openItem(null); });
    }
  };
})(window);
