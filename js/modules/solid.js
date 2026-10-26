/* ============================================================
 * solid.js · 第 269 次：辅食独立模块（照用户给的 7 张参考截图）
 *
 * 页面（仿 pump.js 的独立模块结构）：
 *   空状态：页头插画 + 中间大插画 +「点按底部 + 开始记录」，底部「+ 记录辅食」。
 *   有记录：周切换「10/20-10/26 本周」→「辅食状态 本周 N 次」四格（进食量 / 进食情况 /
 *           接受较好 / 常见性状）→ 摘要句 → 洞察 → 观察期横幅 → 最近辅食记录 → 底部「+ 记录辅食」。
 * 记录面板（半屏 sheet，✕ / 辅食 / ✓，底部「✓ 保存」）：
 *   喂养时间（日期 / 时间磁贴）→ 辅食性状（2 列插画卡，6 种）→ 进食量（克 / 勺 / 碗；
 *   勺、碗带 − + 步进和换算提示）→ 进食情况（吃得好 / 一般 / 不太接受）→ 名称（可选）→
 *   辅食类型（可选，3 列插画卡，可多选）→ 备注（可选）→ 备注照片 0/6（复用 photos.js）。
 *
 * 数据：仍落 d.feedings，type = 'solid'（与喂养页第 69 / 108 次的老辅食记录同一数组）：
 *   { id, type:'solid', start, texture, unit:'g'|'spoon'|'bowl', qty, amount(克，只在 unit=g 时有),
 *     accept:'good'|'ok'|'refuse', dish(名称), cats:[], note, photos:[] }
 *   老记录（只有 amount 克数 / dish / newFood / ing / steps / note）照常显示；修改时这些老字段原样保留。
 *   名称继续写 dish：喂养页的观察期卡（solidIntro）与搜索都认它。
 *   第 108 次的「同日同菜名合并」不用在这里：现在一条就是一顿（有时间、有量、有照片），
 *   中午、晚上各吃一次南瓜泥是两顿，合并会丢数据。
 * ============================================================ */
(function (global) {
  'use strict';
  var Modules = global.Modules = global.Modules || {};
  var FT = function () { return global.FTUI; };
  var esc = function (s) { return Util.escapeHtml(String(s == null ? '' : s)); };
  var IMG = 'assets/solid/';
  var weekOff = 0;      /* 周切换：0 = 本周（含今天在内的近 7 天），1 = 上周…… */
  var gcDone = false;

  var TEX = [
    { v: 'liquid', t: '液体' }, { v: 'puree', t: '泥糊' }, { v: 'minced', t: '碎末' },
    { v: 'granule', t: '颗粒' }, { v: 'chunk', t: '块状' }, { v: 'finger', t: '手指食物' }
  ];
  var CATS = [
    { v: 'grain', t: '谷物' }, { v: 'meat', t: '肉类' }, { v: 'fish', t: '水产' },
    { v: 'veg', t: '蔬菜' }, { v: 'fruit', t: '水果' }, { v: 'other', t: '其他' }
  ];
  var ACC = [{ v: 'good', t: '吃得好' }, { v: 'ok', t: '一般' }, { v: 'refuse', t: '不太接受' }];
  /* 换算只做提示（参考图口径：1 勺约 5ml，1 碗约 230ml） */
  var UNITS = {
    g: { t: '克', ml: 0, max: 500, step: 1 },
    spoon: { t: '勺', ml: 5, max: 40, step: 1 },
    bowl: { t: '碗', ml: 230, max: 5, step: 0.5 }
  };
  var UNIT_ORDER = ['g', 'spoon', 'bowl'];

  function find(list, v) { for (var i = 0; i < list.length; i++) if (list[i].v === v) return list[i]; return null; }
  function ms(s) { var t = new Date(s).getTime(); return isFinite(t) ? t : NaN; }
  function numOf(v) { var n = Number(v); return isFinite(n) && n > 0 ? n : 0; }
  function fmtQ(n) { return String(Math.round(n * 10) / 10); }
  function cleanCats(a) {
    var out = [];
    (Array.isArray(a) ? a : []).forEach(function (v) { if (find(CATS, v) && out.indexOf(v) < 0) out.push(v); });
    return out;
  }
  /* 一条辅食的量：新记录 unit + qty；老记录只有 amount（克） */
  function qtyOf(r) {
    var u = UNITS[r.unit] ? r.unit : null, q = numOf(r.qty);
    if (u && q) return { u: u, q: q };
    var a = numOf(r.amount);
    return a ? { u: 'g', q: a } : null;
  }
  function amtText(r) {
    var x = qtyOf(r); if (!x) return '';
    var U = UNITS[x.u];
    return fmtQ(x.q) + ' ' + U.t + (U.ml ? '（约 ' + Math.round(x.q * U.ml) + ' ml）' : '');
  }
  function solids(d) {
    return (d.feedings || []).filter(function (r) { return r && r.type === 'solid' && isFinite(ms(r.start)); })
      .sort(function (a, b) { return ms(b.start) - ms(a.start); });
  }
  function nameOf(r) {
    var F = Modules.feeding && Modules.feeding._solidName;
    if (r.dish && String(r.dish).trim()) return String(r.dish).trim();
    return F ? F(r) : '';
  }
  function agoText(t) {
    var m = Math.floor((Date.now() - ms(t)) / 60000);
    if (!isFinite(m)) return '';
    if (m < 1) return '刚刚';
    if (m < 60) return m + ' 分钟前';
    if (m < 24 * 60) { var h = Math.floor(m / 60), mm = m % 60; return h + ' 小时' + (mm ? ' ' + mm + ' 分' : '') + '前'; }
    return Util.fmtAgo ? Util.fmtAgo(t) : Util.fmtRowTime(t);
  }
  function subOf(r) {
    var p = [], a = amtText(r), tx = find(TEX, r.texture), ac = find(ACC, r.accept);
    if (r.newFood && String(r.newFood).trim()) p.push('新食材 ' + String(r.newFood).trim());
    if (a) p.push(a);
    if (tx) p.push(tx.t);
    if (ac) p.push(ac.t);
    var cs = cleanCats(r.cats).map(function (v) { return find(CATS, v).t; });
    if (cs.length) p.push(cs.join('、'));
    var segs = (Modules.feeding && Modules.feeding._parseIng) ? Modules.feeding._parseIng(r.ing) : [];
    if (segs.length) p.push(segs.map(function (s) { return s.text; }).filter(Boolean).join('、'));
    if (r.note) p.push(String(r.note));
    return p.join(' · ');
  }
  /* 最常见的一项：返回 { v, n }，并列时取表里靠前的 */
  function topOf(list, key, table) {
    var cnt = {};
    list.forEach(function (r) { var v = r[key]; if (find(table, v)) cnt[v] = (cnt[v] || 0) + 1; });
    var best = null;
    table.forEach(function (t) { if (cnt[t.v] && (!best || cnt[t.v] > best.n)) best = { v: t.v, n: cnt[t.v] }; });
    return best;
  }

  /* ---------- 记录面板 ---------- */
  function texCard(t, on) {
    return '<button type="button" class="sd-tex' + (on ? ' on' : '') + '" data-tex="' + t.v + '" role="radio" aria-checked="' + on + '">'
      + '<img src="' + IMG + 't_' + t.v + '.webp" alt="" width="360" height="360" decoding="sync">'
      + '<span class="sd-tn">' + t.t + '</span><i class="sd-ck" aria-hidden="true">' + icon('check') + '</i></button>';
  }
  function catCard(c, on) {
    return '<button type="button" class="sd-cat' + (on ? ' on' : '') + '" data-cat="' + c.v + '" aria-pressed="' + on + '">'
      + '<img src="' + IMG + 'c_' + c.v + '.webp" alt="" width="300" height="300" decoding="sync">'
      + '<span>' + c.t + '</span><i class="sd-ck" aria-hidden="true">' + icon('check') + '</i></button>';
  }
  function openSheet(rec, dateIso) {
    var F = FT(); if (!F) return;
    var d = Storage.get(), editing = !!rec, now = Date.now();
    var last = solids(d)[0];
    var q0 = editing ? qtyOf(rec) : null;
    var st = {
      texture: editing ? (find(TEX, rec.texture) ? rec.texture : null) : (last && find(TEX, last.texture) ? last.texture : null),
      unit: q0 ? q0.u : (last && UNITS[last.unit] ? last.unit : 'g'),
      qty: q0 ? q0.q : (last && UNITS[last.unit] && numOf(last.qty) ? numOf(last.qty) : null),
      accept: editing ? (find(ACC, rec.accept) ? rec.accept : null) : 'ok',
      cats: editing ? cleanCats(rec.cats) : [],
      photos: (editing && global.Photos) ? Photos.clean(rec.photos) : []
    };
    if (!editing && st.unit === 'g' && !(last && last.unit === 'g')) st.qty = null;
    var busy = false;
    var t0 = editing ? ms(rec.start) : (dateIso ? ms(dateIso + 'T' + F.hm(now) + ':00') : now);
    if (!isFinite(t0)) t0 = now;
    var PH = global.Photos || null;

    var body = F.whenTiles('sd', '喂养时间', F.isoDay(t0), F.hm(t0), F.isoDay(now))
      + '<p class="rs-lbl">辅食性状</p><div class="sd-texs" role="radiogroup" aria-label="辅食性状">'
      + TEX.map(function (t) { return texCard(t, st.texture === t.v); }).join('') + '</div>'
      + '<p class="rs-lbl">进食量</p><div class="rs-seg sd-seg" role="radiogroup" aria-label="单位">'
      + UNIT_ORDER.map(function (u) { return '<button type="button" data-unit="' + u + '" role="radio">' + UNITS[u].t + '</button>'; }).join('') + '</div>'
      + '<div class="sd-amt" data-amtbox><label class="sd-qv"><input type="number" inputmode="decimal" min="0" id="sdQty" aria-label="进食量" placeholder="0">'
      + '<small data-unitt></small></label>'
      + '<span class="sd-step" data-step><button type="button" data-q="-1" aria-label="减少">−</button><i aria-hidden="true"></i><button type="button" data-q="1" aria-label="增加">+</button></span></div>'
      + '<p class="sd-conv" data-conv></p>'
      + '<p class="rs-lbl">进食情况</p><div class="rs-seg sd-seg" role="radiogroup" aria-label="进食情况">'
      + ACC.map(function (a) { return '<button type="button" data-acc="' + a.v + '" role="radio">' + a.t + '</button>'; }).join('') + '</div>'
      + '<label class="rs-lbl sd-lbl" for="sdName">名称（可选）</label>'
      + '<input type="text" class="sd-in" id="sdName" maxlength="24" placeholder="例如 南瓜泥" value="' + esc(editing ? (rec.dish || '') : '') + '">'
      + '<p class="rs-lbl">辅食类型（可选）</p><div class="sd-cats">'
      + CATS.map(function (c) { return catCard(c, st.cats.indexOf(c.v) >= 0); }).join('') + '</div>'
      + '<label class="rs-lbl sd-lbl" for="sdNote">备注（可选）</label>'
      + '<textarea class="sd-in sd-ta" id="sdNote" maxlength="200" rows="3" placeholder="可选">' + esc(editing ? (rec.note || '') : '') + '</textarea>'
      + (PH ? '<div data-phbox></div>' : '')
      + (editing ? '<button type="button" class="btn rs-del" data-sdel>删除这条记录</button>' : '')
      + '<div class="rs-savebar sd-savebar"><button type="button" class="btn ft-save sd-save" data-sdsave>' + icon('check') + '保存</button></div>';

    F.openSheet('solid', editing ? '修改辅食' : '辅食', body, function (api) {
      var box = api.box, qIn = box.querySelector('#sdQty');
      if (st.qty) qIn.value = fmtQ(st.qty);
      function readQ() { var n = parseFloat(qIn.value); return isFinite(n) && n > 0 ? n : 0; }
      function paintAmt() {
        var U = UNITS[st.unit], q = readQ();
        Array.prototype.forEach.call(box.querySelectorAll('[data-unit]'), function (b) {
          var on = b.getAttribute('data-unit') === st.unit; b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false');
        });
        var ab = box.querySelector('[data-amtbox]');
        ab.classList.toggle('is-g', st.unit === 'g');
        box.querySelector('[data-unitt]').textContent = U.t;
        qIn.max = U.max; qIn.step = U.step;
        qIn.setAttribute('inputmode', st.unit === 'bowl' ? 'decimal' : 'numeric');
        var cv = box.querySelector('[data-conv]');
        cv.textContent = U.ml ? '约 ' + Math.round((q || 1) * U.ml) + ' ml' : '';
        cv.hidden = !U.ml;
        var minus = box.querySelector('[data-q="-1"]'); if (minus) minus.disabled = q <= U.step;
      }
      function paintSeg(attr, val) {
        Array.prototype.forEach.call(box.querySelectorAll('[' + attr + ']'), function (b) {
          var on = b.getAttribute(attr) === val; b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false');
        });
      }
      function paintPhotos() {
        var pb = box.querySelector('[data-phbox]'); if (!pb || !PH) return;
        var h = '<p class="rs-lbl sd-phl"><span>备注照片</span><span class="rs-lbl-n">' + st.photos.length + '/' + PH.MAX + '</span></p>';
        if (st.photos.length) {
          h += '<div class="dp-phs">' + st.photos.map(function (id) {
            return '<span class="dp-ph"><button type="button" class="dp-ph-img" data-phview="' + id + '" aria-label="查看照片"><img data-phid="' + id + '" alt=""></button>'
              + '<button type="button" class="dp-ph-rm" data-phrm="' + id + '" aria-label="移除这张照片">' + icon('close') + '</button></span>';
          }).join('') + '</div>';
        }
        if (st.photos.length < PH.MAX) {
          h += '<div class="dp-ph-btns"><button type="button" class="btn dp-ph-add sd-ph-add" data-phadd>' + icon('image') + '<span>添加照片</span></button>'
            + '<button type="button" class="btn dp-ph-add sd-ph-add" data-phcam>' + icon('camera') + '<span>拍摄照片</span></button></div>';
        }
        h += '<p class="rs-hint">可选。照片会压缩后随这条记录保存。</p>';
        pb.innerHTML = h;
        PH.hydrate(pb);
      }
      paintAmt(); paintSeg('data-acc', st.accept); paintPhotos();
      qIn.addEventListener('input', paintAmt);

      box.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('button') : null;
        if (!b || !box.contains(b)) return;
        var v;
        if ((v = b.getAttribute('data-tex'))) {
          st.texture = st.texture === v ? null : v;
          Array.prototype.forEach.call(box.querySelectorAll('[data-tex]'), function (x) {
            var on = x.getAttribute('data-tex') === st.texture; x.classList.toggle('on', on); x.setAttribute('aria-checked', on ? 'true' : 'false');
          });
          return;
        }
        if ((v = b.getAttribute('data-unit'))) {
          if (v === st.unit) return;
          st.unit = v;
          var U = UNITS[v], q = readQ();
          /* 换单位时数值不硬换算（克和勺碗本来就不成比例）：勺 / 碗从 1 起，克清空让人重填 */
          void q; qIn.value = v === 'g' ? '' : '1';
          paintAmt(); return;
        }
        if ((v = b.getAttribute('data-q'))) {
          var UU = UNITS[st.unit], cur = readQ() || 0;
          var nx = Math.round((cur + Number(v) * UU.step) * 10) / 10;
          qIn.value = fmtQ(Math.max(UU.step, Math.min(UU.max, nx)));
          paintAmt(); return;
        }
        if ((v = b.getAttribute('data-acc'))) { st.accept = v; paintSeg('data-acc', v); return; }
        if ((v = b.getAttribute('data-cat'))) {
          var i = st.cats.indexOf(v); if (i >= 0) st.cats.splice(i, 1); else st.cats.push(v);
          var on = st.cats.indexOf(v) >= 0; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
          return;
        }
        if ((v = b.getAttribute('data-phview'))) { if (PH) PH.view(v); return; }
        if ((v = b.getAttribute('data-phrm'))) { st.photos = st.photos.filter(function (x) { return x !== v; }); paintPhotos(); if (global.Photos && Photos.release) Photos.release(v); return; }
        if (PH && (b.hasAttribute('data-phadd') || b.hasAttribute('data-phcam'))) {
          if (busy) return;
          PH.pick(b.hasAttribute('data-phcam'), function (files) {
            var room = PH.MAX - st.photos.length;
            if (files.length > room) Util.toast('最多 ' + PH.MAX + ' 张，只加了前 ' + room + ' 张', 'warn');
            busy = true;
            var chain = Promise.resolve();
            files.slice(0, room).forEach(function (f) {
              chain = chain.then(function () { return PH.compress(f); }).then(function (blob) { return PH.put(blob); })
                .then(function (id) { if (st.photos.length < PH.MAX) st.photos.push(id); });
            });
            chain.catch(function () { Util.toast('这张照片存不下来，换一张试试', 'warn'); })
              .then(function () { busy = false; if (box.isConnected) paintPhotos(); });
          });
          return;
        }
        if (b.hasAttribute('data-sdel')) { api.close(); removeRec(rec.id); return; }
        if (b.hasAttribute('data-sdsave')) { save(); return; }
      });
      box.parentNode.parentNode.querySelector('[data-ok]').addEventListener('click', save);

      function save() {
        if (busy) { Util.toast('照片还在保存，稍等一下', 'warn'); return; }
        var t = F.readWhen(box, 'sd');
        if (!isFinite(t)) { Util.toast('日期或时间不完整', 'warn'); return; }
        if (t > Date.now() + 60000) { Util.toast('这个时间还没到，请检查一下', 'warn'); return; }
        var U = UNITS[st.unit], q = readQ();
        if (q > U.max) { Util.toast('进食量最多 ' + U.max + ' ' + U.t, 'warn'); return; }
        q = q ? Math.round(q * 10) / 10 : 0;
        var dd = Storage.get();
        var r = editing ? rec : { id: Util.uid(), type: 'solid' };
        /* 时间没改时保留原来的秒，免得同一分钟内的顺序被打乱 */
        r.start = (editing && F.hm(ms(rec.start)) === F.hm(t) && F.isoDay(ms(rec.start)) === F.isoDay(t)) ? rec.start : F.loc(t);
        if (st.texture) r.texture = st.texture; else delete r.texture;
        if (q) { r.unit = st.unit; r.qty = q; r.amount = st.unit === 'g' ? q : null; }
        else { delete r.unit; delete r.qty; r.amount = null; }
        if (st.accept) r.accept = st.accept; else delete r.accept;
        var nm = (box.querySelector('#sdName').value || '').trim().slice(0, 24);
        r.dish = nm || null;
        if (st.cats.length) r.cats = st.cats.slice(); else delete r.cats;
        r.note = (box.querySelector('#sdNote').value || '').trim().slice(0, 200) || null;
        if (st.photos.length) r.photos = st.photos.slice(); else delete r.photos;
        if (!editing) { r.side = null; r.durationMin = null; dd.feedings.push(r); }
        if (!Storage.save()) return;
        api.close();
        if (global.App) App.rerender();
        if (editing) Util.toast('已保存修改', 'ok');
        else Util.toast('已记录辅食' + (q ? ' ' + fmtQ(q) + ' ' + U.t : ''), 'ok', { label: '撤销', onClick: function () {
          var arr = Storage.get().feedings;
          for (var i = arr.length - 1; i >= 0; i--) if (arr[i].id === r.id) { arr.splice(i, 1); break; }
          Storage.save(); if (global.App) App.rerender(); Util.toast('已撤销', 'ok');
        } });
      }
    });
  }
  function removeRec(id) {
    var d = Storage.get();
    Util.removeWithUndo(d.feedings, id, {
      onSave: function () { Storage.save(); }, onAfter: function () { if (global.App) App.rerender(); },
      deletedText: '已删除辅食记录'
    });
  }

  /* ---------- 页面 ---------- */
  var CHEV = {
    l: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    r: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };
  function md(k) { return Number(k.slice(5, 7)) + '/' + Number(k.slice(8, 10)); }
  function weekCard(list, DS, dayNow) {
    var end = Util.addDays(dayNow, -7 * weekOff), startK = Util.addDays(end, -6);
    var dk = function (r) { return Util.dayKeyOf(r.start, DS); };
    var wk = list.filter(function (r) { var k = dk(r); return k >= startK && k <= end; });
    var wName = weekOff === 0 ? '本周' : (weekOff === 1 ? '上周' : weekOff + ' 周前');
    var h = '<div class="sd-week" role="group" aria-label="切换周">'
      + '<button type="button" class="sd-wb" data-wk="1" aria-label="上一周"' + (weekOff >= 104 ? ' disabled' : '') + '>' + CHEV.l + '</button>'
      + '<p><b>' + md(startK) + '-' + md(end) + '</b><small>' + wName + '</small></p>'
      + '<button type="button" class="sd-wb" data-wk="-1" aria-label="下一周"' + (weekOff === 0 ? ' disabled' : '') + '>' + CHEV.r + '</button></div>';
    /* 四格 */
    var units = {};
    wk.forEach(function (r) { var x = qtyOf(r); if (x) units[x.u] = (units[x.u] || 0) + x.q; });
    var amt = UNIT_ORDER.filter(function (u) { return units[u]; }).map(function (u) { return fmtQ(units[u]) + ' ' + UNITS[u].t; }).join(' + ');
    var ac = topOf(wk, 'accept', ACC), tx = topOf(wk, 'texture', TEX);
    var goodNames = [];
    wk.forEach(function (r) { if (r.accept === 'good') { var n = nameOf(r); if (n && goodNames.indexOf(n) < 0) goodNames.push(n); } });
    var goodN = wk.filter(function (r) { return r.accept === 'good'; }).length;
    var good = goodNames.length ? goodNames.slice(0, 2).join('、') + (goodNames.length > 2 ? ' 等' : '') : (goodN ? goodN + ' 次' : '');
    var cell = function (k, v, hi) {
      return '<div class="sd-cell"><span>' + k + '</span><b class="' + (v ? (hi ? 'is-hi' : '') : 'is-none') + '">' + (v ? esc(v) : '暂无') + '</b></div>';
    };
    h += '<div class="card sd-stat"><div class="sd-sh"><h2>辅食状态<small>' + wName + '</small></h2><span class="sd-n">' + wk.length + ' 次</span></div>'
      + '<div class="sd-cells">' + cell('进食量', amt, true) + cell('进食情况', ac ? find(ACC, ac.v).t + ' ' + ac.n + ' 次' : '')
      + cell('接受较好', good) + cell('常见性状', tx ? find(TEX, tx.v).t : '') + '</div></div>';
    return h;
  }
  /* 第 69 / 110 次的观察期：最近一条有「引入项」的辅食，0–3 天内提示别急着加第二种新食材 */
  function watchBanner(d, list) {
    var intro = Modules.feeding && Modules.feeding._solidIntro;
    if (!intro) return '';
    var lastNew = list.filter(function (r) { return intro(r); })[0];
    if (!lastNew) return '';
    var n = Util.daysBetween(String(lastNew.start).slice(0, 10), Util.todayISO());
    if (!(n >= 0 && n <= 3)) return '';
    return '<div class="sd-watch" data-accent="solid"><span class="sd-wn">' + (n + 1) + '/4</span><p><b>「' + esc(intro(lastNew)) + '」引入第 ' + (n + 1) + ' 天</b>'
      + '——观察期内建议不再引入第二种新食材，留意皮疹、呕吐、腹泻；都正常即可继续引入。</p></div>';
  }
  function insight(list, DS, dayNow) {
    var d7 = global.DayChart ? DayChart.lastDays(dayNow, 7) : [];
    var wk = list.filter(function (r) { return d7.indexOf(Util.dayKeyOf(r.start, DS)) >= 0; });
    var h = '<h2>近 7 天辅食</h2>';
    if (global.DayChart) {
      h += DayChart.bars(d7.map(function (k) {
        var v = list.filter(function (r) { return Util.dayKeyOf(r.start, DS) === k; }).length;
        return { key: k, v: v, txt: v ? String(v) : '' };
      }), dayNow, '近 7 天辅食次数');
    }
    var cnt = function (key, table, arr) {
      var c = {};
      wk.forEach(function (r) { (arr ? cleanCats(r[key]) : [r[key]]).forEach(function (v) { if (find(table, v)) c[v] = (c[v] || 0) + 1; }); });
      return table.filter(function (t) { return c[t.v]; }).map(function (t) { return t.t + ' ' + c[t.v]; }).join(' · ');
    };
    h += '<p class="hint">近 7 天记了 <b>' + wk.length + '</b> 次辅食。</p>';
    var ct = cnt('cats', CATS, true), tt = cnt('texture', TEX), at = cnt('accept', ACC);
    if (ct) h += '<p class="hint">类型：' + esc(ct) + '</p>';
    if (tt) h += '<p class="hint">性状：' + esc(tt) + '</p>';
    if (at) h += '<p class="hint">进食情况：' + esc(at) + '</p>';
    var names = [];
    wk.forEach(function (r) { var n = nameOf(r); if (n && names.indexOf(n) < 0) names.push(n); });
    if (names.length) h += '<p class="hint">吃过：' + esc(names.slice(0, 8).join('、')) + (names.length > 8 ? ' 等' : '') + '</p>';
    h += '<p class="hint">只统计你自己记的数；新食材一次加一种，观察 2–3 天再加下一种。</p>';
    return h;
  }

  Modules.solid = {
    title: '辅食',
    _open: function (dateIso) { openSheet(null, dateIso || null); },
    _edit: function (rec) { openSheet(rec, null); },
    _amtText: amtText, /* 第 273 次：搜索结果按辅食自己的单位写量 */
    _amtText: amtText,
    _subOf: subOf,
    TEX: TEX, CATS: CATS,
    render: function (view) {
      var d = Storage.get(), F = FT();
      var DS = Util.dayStartHour(d), dayNow = Util.dayKeyOf(new Date(), DS);
      var backfill = (global.App && App.pendingDate) ? App.pendingDate : null;
      if (global.App) App.pendingDate = null;
      var list = solids(d);
      var html = '';
      if (!list.length) {
        weekOff = 0;
        html += '<div class="sk-empty sd-empty"><img src="assets/hero/solid.webp" alt="" width="220" height="220" decoding="sync"><p>点按底部 + 开始记录</p></div>';
      } else {
        html += weekCard(list, DS, dayNow);
        var todayL = list.filter(function (r) { return Util.dayKeyOf(r.start, DS) === dayNow; });
        var sum = todayL.length ? '今天记录了 <b>' + todayL.length + '</b> 次<b>辅食</b>。' : '今天还没有<b>辅食</b>记录。';
        sum += ' <span class="sd-last">上次：<b>' + esc(agoText(list[0].start)) + '</b></span>';
        html += '<div class="mod-sum ft-sum"><span class="ms-k">摘要</span><p>' + sum + '</p></div>';
        html += F.insightChips([{ ico: icon('solid'), t: '辅食', html: insight(list, DS, dayNow) }]);
        html += watchBanner(d, list);
        /* 时间轴：名称有就当标题，没有就「辅食」；有照片带缩略图 */
        html += '<section class="mod-tl ft-tl"><p class="ms-k">最近辅食记录</p><ul class="tl">';
        list.slice(0, 30).forEach(function (r) {
          var t = ms(r.start), nm = r.dish && String(r.dish).trim() ? String(r.dish).trim() : '辅食', sub = subOf(r);
          var phs = global.Photos ? Photos.clean(r.photos) : [];
          html += '<li class="tl-row tl-f-solid"><span class="tl-time ft-tlt"><small>' + md(F.isoDay(t)) + '</small>' + F.hm(t) + '</span><span class="tl-dot" aria-hidden="true"></span>'
            + '<button type="button" class="tl-card" data-sopen="' + esc(r.id) + '" aria-label="' + F.hm(t) + ' ' + esc(nm) + '，点按修改">'
            + '<span class="tl-ico">' + icon('solid') + '</span><span class="tl-txt"><b>' + esc(nm) + '</b>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span>'
            + (phs.length ? '<span class="tl-ph"><img data-phid="' + phs[0] + '" alt="">' + (phs.length > 1 ? '<i>' + phs.length + '</i>' : '') + '</span>' : '')
            + '<span class="tl-more" aria-hidden="true">' + F.SV.more + '</span></button>'
            + '<button type="button" class="tl-del" data-del="' + esc(r.id) + '" aria-label="删除" title="删除">' + icon('trash') + '</button></li>';
        });
        html += '</ul></section>';
      }
      html += '<div class="mod-cta"><button type="button" class="mc-main" data-snew>' + icon('plus') + '<span>记录辅食</span></button></div>';
      view.innerHTML = '<div class="ft-page sd-page" data-accent="solid">' + html + '</div>';
      F.bindChips(view);
      if (global.Photos) {
        Photos.hydrate(view);
        if (!gcDone && Photos.gcAll) { gcDone = true; setTimeout(function () { Photos.gcAll(); }, 3000); }
      }
      var nb = view.querySelector('[data-snew]'); if (nb) nb.addEventListener('click', function () { openSheet(null, null); });
      Array.prototype.forEach.call(view.querySelectorAll('[data-wk]'), function (b) {
        b.addEventListener('click', function () { weekOff = Math.max(0, Math.min(104, weekOff + Number(b.getAttribute('data-wk')))); if (global.App) App.rerender(); });
      });
      Array.prototype.forEach.call(view.querySelectorAll('[data-sopen]'), function (b) {
        b.addEventListener('click', function () {
          var it = (Storage.get().feedings || []).filter(function (x) { return x && x.id === b.getAttribute('data-sopen'); })[0];
          if (it) openSheet(it, null);
        });
      });
      Array.prototype.forEach.call(view.querySelectorAll('[data-del]'), function (b) {
        b.addEventListener('click', function () { removeRec(b.getAttribute('data-del')); });
      });
      if (backfill) setTimeout(function () { openSheet(null, backfill); }, 0);
    }
  };
})(window);
