/**
 * calendar.js - 日期记录（底部 Tab 入口）
 * 第 285 次「做减法」重做：一屏只看一天。
 *   页头「10 月 27 日 周二」+ 日历按钮（跳转日期半屏）→ 周条（周一到周日，有记录的日子一个小圆点）
 *   →「一天的形状」（0–24 点细时间带：睡眠画色段、其余记录画小点；最多 3 个数字）
 *   → 当天时间轴（时间 · 图标 · 名称 · 数值）→ 补记小条 →「查看前一天」。
 * 在周条 / 内容区左右滑切换日期。回顾（周 / 月统计）挪进跳转日期半屏，成长时间轴去掉（生长 / 里程碑 / 疫苗各有自己的页）。
 * 第 286 次：① 三联分页（前一天 / 当天 / 后一天预先画好，1:1 跟手 + 方向锁定 + 按距离 / 速度翻页 + 回弹 + 未来橡皮筋），周条同理；
 *   ② 洗澡 / 游泳 / 日晒 / 黄疸 / 情绪 / 破水见红进日期页，时间轴点按修改、「…」菜单修改 / 删除（走各模块已有逻辑），记账不进；
 *   ③ （第 291 次按用户要求去掉）底部常用快捷记录条——记录入口走「＋」；
 *   ④ 页头右侧宝宝头像（带切换角标）→ 从右上角弹出的宝宝切换菜单，复用 Storage.switchBaby；
 *   ⑤ 跳转日期半屏加「· 有记录」图例和「数据管理」入口（js/datamgr.js）。
 * 与首页共用 Util.buildDayIndex，确保数据聚合单一来源。
 */
(function (global) {
  'use strict';
  var Storage = global.Storage, Util = global.Util;
  var Modules = global.Modules = global.Modules || {};
  var esc = function (s) { return Util.escapeHtml(s == null ? '' : String(s)); };
  var DOW = ['日', '一', '二', '三', '四', '五', '六'];
  /* 喂养子类型 → 模块色（buildDayIndex 的 icon 仍是 feeding） */
  var KIND_ACC = { breast: 'breast', bottle: 'bottle', formula: 'bottle', pump: 'pump', solid: 'solid' };
  var KIND_ICO = { breast: 'breast', bottle: 'feeding', formula: 'formula', pump: 'pump', solid: 'solid' };

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function isoOf(s) { return String(s || '').slice(0, 10); }
  function dObj(iso) { var p = iso.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function titleOf(iso) { var d = dObj(iso); return (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日 周' + DOW[d.getDay()]; }
  function minOf(hm) { var m = /^(\d{2}):(\d{2})/.exec(hm || ''); return m ? (+m[1]) * 60 + (+m[2]) : -1; }
  function reduced() {
    try { return global.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  }
  function accOf(it) { return (it.kind && KIND_ACC[it.kind]) || it.icon || ''; }
  function icoOf(it) { return (it.kind && KIND_ICO[it.kind]) || it.icon; }

  /* U-26 回顾：本地生成、只拿自己的数据自比（U-24），不设达标线、不做红色告警（U-25）。
     第 285 次起放在跳转日期半屏里（月历下面），页面本身只看一天。 */
  function rangeStats(dayIdx, from, to, cutHM) {
    var days = 0, items = 0;
    var cur = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    var end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
    var endIso = Util.fmtDate(end);
    while (cur <= end) {
      var iso = Util.fmtDate(cur);
      var arr = (dayIdx[iso] || []).filter(function (it) { return !it.cont && !(cutHM && iso === endIso && it.time && it.time > cutHM); });
      if (arr.length) { days++; items += arr.length; }
      cur.setDate(cur.getDate() + 1);
    }
    return { days: days, items: items };
  }
  function reviewHTML(dayIdx, now) {
    var dow = now.getDay(), backToMon = (dow + 6) % 7;
    var wkStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - backToMon);
    var wkEnd = new Date(wkStart.getFullYear(), wkStart.getMonth(), wkStart.getDate() + 6);
    var pvStart = new Date(wkStart.getFullYear(), wkStart.getMonth(), wkStart.getDate() - 7);
    /* 第 274 次（审计 #24）：上周同期 = 上周一 → 上周的同一个星期几，最后一天截到现在这个钟点 */
    var pvEnd = new Date(pvStart.getFullYear(), pvStart.getMonth(), pvStart.getDate() + backToMon);
    var cutHM = pad(now.getHours()) + ':' + pad(now.getMinutes());
    var pvLbl = backToMon === 0 ? '上周一' : '上周一到周' + DOW[dow];
    var mo = rangeStats(dayIdx, new Date(now.getFullYear(), now.getMonth(), 1), new Date(now.getFullYear(), now.getMonth() + 1, 0));
    var wk = rangeStats(dayIdx, wkStart, wkEnd), pv = rangeStats(dayIdx, pvStart, pvEnd, cutHM);
    var h = '<div class="cal-review review-card"><span class="rs-lbl">回顾</span><p>';
    if (wk.items) {
      h += '本周已记录 <b>' + wk.items + '</b> 条，覆盖 <b>' + wk.days + '</b> 天。';
      if (pv.items) h += '上周同期（' + pvLbl + '，到这个钟点）是 ' + pv.items + ' 条。';
      else h += '上周同期（' + pvLbl + '）没有记录，先不比较。';
    } else {
      h += '本周还没有记录。';
    }
    h += '本月共 ' + mo.items + ' 条，覆盖 ' + mo.days + ' 天。</p>'
      + '<button class="btn" id="calExport" type="button">' + icon('export') + '导出全部记录</button></div>';
    return h;
  }

  /* ---------- 一天的形状：睡眠色段 + 记录小点 + 最多 3 个数字 ---------- */
  function sleepSegs(d, iso, isToday) {
    var from = dObj(iso).getTime(), to = from + 864e5, nowMs = Date.now();
    var list = (d.sleeps || []).filter(function (x) { return x && x.start && x.end; });
    if (isToday && d.openSleep && d.openSleep.start) list = list.concat([{ start: d.openSleep.start, end: null, live: true }]);
    var out = [];
    list.forEach(function (x) {
      var a = new Date(x.start).getTime(), b = x.end ? new Date(x.end).getTime() : nowMs;
      if (!isFinite(a) || !isFinite(b) || b <= a) return;
      var s = Math.max(a, from), e = Math.min(b, to);
      if (e <= s) return;
      var sd = new Date(s);
      out.push({ l: (s - from) / 864e5 * 100, w: (e - s) / 864e5 * 100, hm: pad(sd.getHours()) + ':' + pad(sd.getMinutes()), live: !!x.live });
    });
    return out;
  }
  function dayNums(d, iso, isToday) {
    var on = function (s) { return isoOf(s) === iso; };
    var fs = (d.feedings || []).filter(function (r) { return r && on(r.start); });
    var milk = 0, nFeed = 0, nSolid = 0, pumpMl = 0, nPump = 0;
    fs.forEach(function (r) {
      var amt = Number(r.amount) || 0;
      if (r.type === 'bottle' || r.type === 'formula') { nFeed++; milk += amt > 0 ? amt : 0; }
      else if (r.type === 'breast') nFeed++;
      else if (r.type === 'solid') nSolid++;
      else if (r.type === 'pump') { nPump++; pumpMl += amt > 0 ? amt : 0; }
    });
    var sl = Util.daySleep(d.sleeps, iso, 0, { live: isToday ? d.openSleep : null }).min;
    var cnt = function (arr, key) { return (arr || []).filter(function (r) { return r && on(r[key]); }); };
    var nDia = cnt(d.diapers, 'time').length;
    var water = cnt(d.waters, 'time').reduce(function (a, r) { return a + (Number(r.ml) || 0); }, 0);
    var out = [];
    if (milk > 0) out.push({ k: 'milk', lbl: '奶量', v: Math.round(milk) + ' ml' });
    else if (nFeed) out.push({ k: 'feed', lbl: '喂奶', v: nFeed + ' 次' });
    if (sl >= 1) out.push({ k: 'sleep', lbl: '睡眠', v: Util.fmtDuration(sl * 60000) });
    if (nDia) out.push({ k: 'diaper', lbl: '尿布', v: nDia + ' 次' });
    if (nSolid) out.push({ k: 'solid', lbl: '辅食', v: nSolid + ' 次' });
    if (nPump) out.push({ k: 'pump', lbl: '泵奶', v: pumpMl > 0 ? Math.round(pumpMl) + ' ml' : nPump + ' 次' });
    if (water > 0) out.push({ k: 'water', lbl: '饮水', v: Math.round(water) + ' ml' });
    [['meds', 'time', '吃药'], ['supplements', 'time', '营养品'], ['fetal', 'time', '胎动'], ['contractions', 'start', '宫缩']].forEach(function (c) {
      var n = cnt(d[c[0]], c[1]).length;
      if (n) out.push({ k: c[0], lbl: c[2], v: n + ' 次' });
    });
    return out.slice(0, 3);
  }
  /* 数字大、单位小：「9小时20分」「320 ml」 */
  function numHTML(v) {
    return String(v).split(/(\d+(?:\.\d+)?)/).map(function (s) {
      if (!s) return '';
      return /^\d/.test(s) ? '<b>' + s + '</b>' : '<i>' + esc(s.trim()) + '</i>';
    }).join('');
  }
  function shapeHTML(d, iso, rows, isToday) {
    var segs = sleepSegs(d, iso, isToday);
    var h = '<div class="card day-shape" role="group" aria-label="一天的形状">'
      + '<div class="dsh-band"><span class="dsh-track"></span>';
    segs.forEach(function (s) {
      var ti = -1;
      rows.forEach(function (r, i) { if (ti < 0 && r.icon === 'sleep' && r.time === s.hm) ti = i; });
      h += '<button type="button" class="dsh-seg' + (s.live ? ' is-live' : '') + '" data-accent="sleep" style="left:' + s.l.toFixed(3) + '%;width:' + Math.max(s.w, 0.6).toFixed(3) + '%"'
        + (ti >= 0 ? ' data-ti="' + ti + '"' : '') + ' aria-label="' + esc(s.hm + ' 睡眠') + '"></button>';
    });
    rows.forEach(function (r, i) {
      if (r.icon === 'sleep') return;
      var m = minOf(r.time);
      if (m < 0) return;
      h += '<button type="button" class="dsh-dot" data-ti="' + i + '" data-accent="' + esc(accOf(r)) + '" style="left:' + (m / 1440 * 100).toFixed(3) + '%"'
        + ' aria-label="' + esc(r.time + ' ' + r.label + (r.val ? ' ' + r.val : '')) + '"></button>';
    });
    if (isToday) {
      var n = new Date(), nm = n.getHours() * 60 + n.getMinutes();
      h += '<span class="dsh-now" style="left:' + (nm / 1440 * 100).toFixed(3) + '%" aria-hidden="true"><i>现在</i></span>';
    }
    h += '</div><div class="dsh-axis" aria-hidden="true"><span>0</span><span>6</span><span>12</span><span>18</span><span>24</span></div>';
    var nums = dayNums(d, iso, isToday);
    if (nums.length) {
      h += '<div class="dsh-nums" data-n="' + nums.length + '">';
      nums.forEach(function (x) { h += '<div class="dsh-num" data-k="' + x.k + '"><span class="dsh-v">' + numHTML(x.v) + '</span><span class="dsh-l">' + x.lbl + '</span></div>'; });
      h += '</div>';
    }
    return h + '</div>';
  }

  /* ---------- 第 286 次：日期页数据（记账不进日期页） ---------- */
  function dayIndex(d) {
    var idx = Util.buildDayIndex(d), out = {};
    Object.keys(idx).forEach(function (k) {
      var arr = idx[k].filter(function (it) { return it.icon !== 'finance'; });
      if (arr.length) out[k] = arr;
    });
    return out;
  }

  /* ---------- 第 286 次：时间轴条目 → 各模块已有的编辑 / 删除逻辑 ---------- */
  var SKEL = { baths: 'bath', swims: 'swim', suns: 'sun', jaundices: 'jaundice', moods: 'mood', temps: 'temp', meds: 'meds', waters: 'water' };
  var EDIT_SC = { sleeps: 'sleep', supplements: 'supplement', milestones: 'milestone' };
  /* 第 287 次：经期 / 宫缩 / 破水见红 / 胎动迁到新骨架，修改 / 删除走各模块自己的面板（不再跳页、不再用通用编辑框） */
  var MOD_PANEL = {
    periods: { mod: 'period', edit: '_open', del: '_remove' },
    contractions: { mod: 'contraction', edit: '_edit', del: '_remove' },
    laborEvents: { mod: 'contraction', edit: '_editLabor', del: '_removeLabor' },
    fetal: { mod: 'fetal', edit: '_edit', del: '_remove' },
    prenatalVisits: { mod: 'prenatal', edit: '_edit', del: '_remove' },
    milestones: { mod: 'milestone', edit: '_edit', del: '_remove' },
    sicks: { mod: 'sick', edit: '_edit', del: '_remove' }, /* 第 301 次 */
    /* 第 289 次：疫苗走疫苗本的修改面板（id = 剂次 key 或 'sub:'+自选记录 id）；没有 id 的老键仍去疫苗页 */
    vaccines: { mod: 'vaccine', edit: '_edit', del: '_remove' }
  };
  function modPanel(src, kind) {
    var c = MOD_PANEL[src], M = c && global.Modules && Modules[c.mod];
    return (M && typeof M[c[kind]] === 'function') ? M[c[kind]].bind(M) : null;
  }
  var GO_MOD = { prenatal: 'pregnancy', vaccines: 'vaccine' };
  function arrOf(d, src) {
    if (src === 'prenatal') return (d.prenatal && d.prenatal.records) || [];
    if (src === 'prenatalVisits') return (d.prenatal && Array.isArray(d.prenatal.visits)) ? d.prenatal.visits : [];
    if (src === 'vaccines') return (global.Modules && Modules.vaccine && Modules.vaccine._recs) ? Modules.vaccine._recs(d) : [];
    return Array.isArray(d[src]) ? d[src] : [];
  }
  function recOf(it) {
    if (!it || !it.src || it.id == null) return null;
    return arrOf(Storage.get(), it.src).filter(function (r) { return r && String(r.id) === it.id; })[0] || null;
  }
  /* 能就地修改 / 删除的条目才有「…」；疫苗、经期、产检、破水见红点一下去各自的页 */
  function editable(it) { return !!(it && it.src && it.id != null && (!GO_MOD[it.src] || MOD_PANEL[it.src])); }

  /* 同义第二行不显示：「游泳 / 游泳记录」「服药 / 服药」这类 */
  function valOf(it) {
    var v = String(it.val || '').trim(), l = String(it.label || '').trim();
    if (!v || v === l || v === l + '记录' || v === '记录') return '';
    return v;
  }
  function gapText(min) {
    var h = Math.floor(min / 60), m = min % 60;
    return (h ? h + ' 小时' : '') + (m ? (h ? ' ' : '') + m + ' 分' : '');
  }
  var MORE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18" cy="12" r="1.6"/></svg>';
  /* 间隔 = 这一条开始 − 上一段结束（睡眠按醒来算），≥ 3 小时才写，字更轻。
     第 286 次：行 = 时间 · 图标 · 名称 · 数值（+ 可修改的条目末尾一个「…」）；id 只给当前那一天（三联面板里另两天不带 id） */
  function timelineHTML(rows, segs) {
    var h = '<ul class="day-list day-tl">', prev = -1;
    rows.forEach(function (it, i) {
      var m = minOf(it.time);
      if (prev >= 0 && m >= 0 && m - prev >= 180) h += '<li class="dt-gap" aria-hidden="true">' + gapText(m - prev) + '</li>';
      if (m >= 0) {
        var endM = m;
        if (it.icon === 'sleep') (segs || []).forEach(function (s) { if (s.hm === it.time) endM = Math.max(endM, Math.round((s.l + s.w) / 100 * 1440)); });
        prev = Math.max(prev, endM);
      }
      var v = valOf(it), ed = editable(it);
      h += '<li data-ti="' + i + '" data-accent="' + esc(accOf(it)) + '"' + (ed ? ' class="dt-ed"' : (it.src && GO_MOD[it.src] ? ' class="dt-go"' : '')) + '>'
        + '<span class="dl-time">' + esc(it.time || '') + '</span>'
        + '<span class="dt-ico">' + icon(icoOf(it)) + '</span>'
        + '<span class="dt-main"><span class="dl-label">' + esc(it.label) + '</span>'
        + (it.note ? '<small class="dl-note">' + esc(it.note) + '</small>' : '') + '</span>'
        + (v ? '<span class="dt-val">' + esc(v) + '</span>' : '')
        + (ed ? '<button type="button" class="dt-more" data-more="' + i + '" aria-haspopup="menu" aria-label="' + esc((it.time ? it.time + ' ' : '') + it.label + '：修改或删除') + '">' + MORE_SVG + '</button>' : '')
        + '</li>';
    });
    return h + '</ul>';
  }

  /* ---------- 第 286 次：时间轴 … 菜单 / 点按修改 ---------- */
  /* 第 281 次同款防重复：上面已经盖着面板 / 菜单时不再开；手指（isTrusted）450ms 内的第二下不算 */
  var eLock = 0;
  function busyUI(e) {
    var mr = document.getElementById('modalRoot');
    if ((mr && mr.children.length) || document.querySelector('body > .cal-pop-mask')) return true;
    if (e && e.isTrusted && Date.now() - eLock < 450) return true;
    eLock = Date.now();
    return false;
  }
  function editRec(it) {
    var M = global.Modules || {};
    if (it.src && GO_MOD[it.src] && !editable(it)) { state.keep = true; if (global.App) App.showTab(GO_MOD[it.src]); return; }
    var rec = recOf(it);
    if (!rec) return;
    var d = Storage.get();
    if (it.src === 'feedings') {
      if (rec.type === 'solid' && M.solid && M.solid._edit) M.solid._edit(rec);
      else if (global.RecordEdit) RecordEdit.open('feeding', rec, d.feedings);
    } else if (it.src === 'diapers' && M.diaper && M.diaper._edit) M.diaper._edit(rec);
    else if (it.src === 'growth' && M.growth && M.growth._open) M.growth._open(rec);
    else if (modPanel(it.src, 'edit')) modPanel(it.src, 'edit')(rec);
    else if (SKEL[it.src] && global.ModSkel) {
      var cfg = ModSkel.cfgOf(SKEL[it.src]);
      if (cfg) ModSkel.openSheet(cfg, d, rec, null);
    } else if (EDIT_SC[it.src] && global.RecordEdit) RecordEdit.open(EDIT_SC[it.src], rec, arrOf(d, it.src));
  }
  function deleteRec(it) {
    var M = global.Modules || {}, rec = recOf(it);
    if (!rec) return;
    var d = Storage.get();
    if (it.src === 'diapers' && M.diaper && M.diaper._remove) { M.diaper._remove(rec.id); return; }
    if (it.src === 'supplements' && M.supplement && M.supplement._untake) { M.supplement._untake(rec); return; }
    if (it.src === 'feedings' && rec.type === 'solid' && M.solid && M.solid._remove) { M.solid._remove(rec.id); return; }
    if (it.src === 'growth' && M.growth && M.growth._remove) { M.growth._remove(rec.id); return; }
    if (modPanel(it.src, 'del')) { modPanel(it.src, 'del')(rec.id); return; }
    if (SKEL[it.src] && global.ModSkel) { var cfg = ModSkel.cfgOf(SKEL[it.src]); if (cfg) { ModSkel.remove(cfg, rec.id); return; } }
    Util.removeWithUndo(arrOf(d, it.src), rec.id, {
      onSave: function () { Storage.save(); }, onAfter: function () { if (global.App) App.rerender(); },
      deletedText: '已删除' + (it.label || '') + '记录'
    });
  }
  function closePop() {
    Array.prototype.forEach.call(document.querySelectorAll('body > .cal-pop-mask'), function (m) {
      if (m._close) m._close(true); else if (m.parentNode) m.parentNode.removeChild(m);
    });
  }
  /* 从按钮那里弹出的小菜单（… 菜单、宝宝切换共用）：点外面 / Esc / 系统返回 / 滚动都关；减少动态效果时只淡入 */
  function popMenu(anchor, html, cls, onPick) {
    closePop();
    var r = anchor.getBoundingClientRect(), vw = global.innerWidth || 390, vh = global.innerHeight || 800;
    var mask = document.createElement('div');
    mask.className = 'cal-pop-mask';
    var below = r.bottom + 8 + 220 < vh || r.top < vh / 2;
    mask.innerHTML = '<div class="cal-pop ' + cls + '" role="menu" style="right:' + Math.max(8, Math.round(vw - r.right)) + 'px;'
      + (below ? 'top:' + Math.round(r.bottom + 6) + 'px' : 'bottom:' + Math.round(vh - r.top + 6) + 'px;transform-origin:100% 100%') + '">' + html + '</div>';
    document.body.appendChild(mask);
    anchor.setAttribute('aria-expanded', 'true');
    var pop = mask.firstChild, done = false;
    function close(now) {
      if (done) return; done = true;
      anchor.setAttribute('aria-expanded', 'false');
      document.removeEventListener('keydown', onKey, true);
      global.removeEventListener('popstate', onPop, true);
      global.removeEventListener('scroll', onScroll, true);
      if (now || reduced()) { if (mask.parentNode) mask.parentNode.removeChild(mask); return; }
      mask.classList.add('is-out');
      setTimeout(function () { if (mask.parentNode) mask.parentNode.removeChild(mask); }, 160);
    }
    mask._close = close;
    function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); try { anchor.focus({ preventScroll: true }); } catch (eF) {} } }
    function onPop() { close(true); }
    function onScroll(e) { if (!pop.contains(e.target)) close(); }
    document.addEventListener('keydown', onKey, true);
    global.addEventListener('popstate', onPop, true);
    global.addEventListener('scroll', onScroll, true);
    mask.addEventListener('click', function (e) {
      if (Util.hapEcho && Util.hapEcho(e)) return;
      if (e.target === mask) { close(); return; }
      var b = e.target.closest && e.target.closest('[data-pick]');
      if (!b || !pop.contains(b)) return;
      close(true);
      onPick(b.getAttribute('data-pick'));
    });
    requestAnimationFrame(function () { mask.classList.add('is-in'); });
    try { var f = pop.querySelector('[data-pick]'); if (f) f.focus({ preventScroll: true }); } catch (eF2) {}
    return { mask: mask, close: close };
  }

  /* ---------- 第 286 次：页头宝宝头像 → 宝宝切换（复用 Storage.switchBaby，全站当前宝宝一致） ---------- */
  var SWAP_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 9.5l4-4 4 4M8 14.5l4 4 4-4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var CHECK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  function avaHTML(b) {
    return (b && b.photo) ? '<img src="' + esc(b.photo) + '" alt="">' : (global.illo ? illo('avatar') : '');
  }
  function babyBtnHTML() {
    var b = Storage.activeBaby ? Storage.activeBaby() : null;
    var name = b && Storage.babyLabel ? Storage.babyLabel(b) : '宝宝';
    return '<button type="button" class="cal-hbtn cal-baby" data-cal-baby aria-haspopup="menu" aria-expanded="false" aria-label="' + esc('切换宝宝（当前：' + name + '）') + '">'
      + '<span class="cb-ava">' + avaHTML(b) + '</span><i class="cb-badge" aria-hidden="true">' + SWAP_SVG + '</i></button>';
  }
  function openBabyMenu(btn) {
    /* 还没有宝宝档案（老数据只有 settings.baby）：先按现有资料播种一份，菜单里至少有当前这一个 */
    if (Storage.activeBaby && !Storage.activeBaby() && Storage.syncBabyFromSettings) { try { Storage.syncBabyFromSettings(); Storage.save(); } catch (eS) {} }
    var d = Storage.get(), cur = d.settings.activeBabyId, babies = d.babies || [];
    var age = function (b) { return global.App && App._babyAge ? App._babyAge(b.birthDate) : ''; };
    var h = '<p class="cp-h">切换宝宝</p>';
    babies.forEach(function (b) {
      var on = b.id === cur;
      h += '<button type="button" class="cp-row cp-baby' + (on ? ' is-cur' : '') + '" role="menuitemradio" aria-checked="' + on + '" data-pick="b:' + esc(b.id) + '">'
        + '<span class="cp-ava">' + avaHTML(b) + '</span><span class="cp-txt"><b>' + esc(Storage.babyLabel(b)) + '</b><small>' + esc(age(b)) + '</small></span>'
        + '<span class="cp-chk" aria-hidden="true">' + (on ? CHECK_SVG : '') + '</span></button>';
    });
    h += '<div class="cp-sep" role="separator"></div>'
      + '<button type="button" class="cp-row cp-act" role="menuitem" data-pick="edit"><span class="cp-aico">' + icon('edit') + '</span><span class="cp-txt"><b>编辑资料</b></span></button>'
      + '<button type="button" class="cp-row cp-act" role="menuitem" data-pick="add"><span class="cp-aico">' + icon('plus') + '</span><span class="cp-txt"><b>添加宝宝</b></span></button>';
    popMenu(btn, h, 'cal-bmenu', function (k) {
      var S = global.Modules && Modules.settings;
      if (k === 'edit') { if (S && S._babyForm) S._babyForm(Storage.get().settings.activeBabyId || null); return; }
      if (k === 'add') { if (S && S._babyForm) S._babyForm(null); return; }
      var id = k.slice(2);
      if (id === Storage.get().settings.activeBabyId) return;
      var nb = Storage.switchBaby(id);
      if (!nb) return;
      if (global.App && App.refreshHeaderAvatar) App.refreshHeaderAvatar();
      state.swapFx = Date.now() + 500;
      if (global.App) App.rerender();
      Util.toast('已切换到「' + Storage.babyLabel(nb) + '」', 'ok');
    });
  }

  /* ---------- 第 286 次：三联分页（内容区 ±1 天、周条 ±1 周），原生分页手感 ----------
     · 前一 / 当前 / 后一 三块预先画好，拖动只改 track 的 translate3d（rAF 里写，touchmove 不读布局、不重画）；
     · 先判方向（前 8px 位移比较 |dx| / |dy|）：竖向整段交给原生滚动；横向锁定后才 preventDefault；容器 touch-action: pan-y；
     · 松手按距离（≥ 1/3 宽）或速度（甩动 ≥ 0.3px/ms 且同向）翻页，否则回弹；不能去的方向（未来）橡皮筋阻尼；
     · 动画结束后把三块轮换位置（不重画当前块），只静默重画移出去的那一块；动画中再来手势先把这次直接落定再接着拖；
     · 减少动态效果：不跟手、不滑动，松手直接换。 */
  var FLIP_EASE = 'cubic-bezier(.22,.8,.28,1)', BACK_EASE = 'cubic-bezier(.3,1.22,.5,1)';
  function rubber(x, w) { var c = 0.55; return (1 - 1 / (Math.abs(x) * c / w + 1)) * w * (x < 0 ? -1 : 1); }
  function makePager(root, track, o) {
    var panes = Array.prototype.slice.call(track.children, 0, 3); /* [prev, cur, next] */
    var P = { panes: panes, busy: false, dragging: false, stats: { frames: 0, moves: 0 } };
    var sx = 0, sy = 0, lock = 0, W = 0, dx = 0, off = 0, raf = 0, samples = [], vOff = 0, docTop = 0, anim = null, swallow = 0, startT = 0;
    function place() {
      panes[0].className = o.paneCls + ' is-prev'; panes[1].className = o.paneCls + ' is-cur'; panes[2].className = o.paneCls + ' is-next';
      panes.forEach(function (pn, i) {
        var side = i !== 1;
        if (side) pn.setAttribute('aria-hidden', 'true'); else pn.removeAttribute('aria-hidden');
        try { pn.inert = side; } catch (e) {}
        pn.style.transform = '';
      });
      if (o.mark) o.mark(panes[1], panes);
    }
    function write() {
      raf = 0;
      track.style.transform = 'translate3d(' + off.toFixed(1) + 'px,0,0)';
      P.stats.frames++;
      if (P.onFrame) P.onFrame(off, dx);
    }
    function finishAnim() {
      if (!anim) return;
      var a = anim; anim = null;
      clearTimeout(a.t); track.removeEventListener('transitionend', a.fn);
      a.done();
    }
    function animate(to, ease, dur, done) {
      finishAnim();
      P.busy = true;
      if (reduced() || dur <= 0) { off = to; done(); return; }
      track.style.transition = 'transform ' + dur + 'ms ' + ease;
      off = to;
      track.style.transform = 'translate3d(' + to + 'px,0,0)';
      var a = { done: function () { track.style.transition = ''; done(); } };
      a.fn = function (e) { if (e.target === track && e.propertyName === 'transform' && anim === a) { anim = null; clearTimeout(a.t); track.removeEventListener('transitionend', a.fn); a.done(); } };
      a.t = setTimeout(function () { if (anim === a) { anim = null; track.removeEventListener('transitionend', a.fn); a.done(); } }, dur + 90);
      track.addEventListener('transitionend', a.fn);
      anim = a;
    }
    function rest() {
      track.style.transition = 'none'; track.style.transform = ''; off = 0; dx = 0;
      root.classList.remove('is-drag'); root.style.minHeight = '';
      panes[0].style.transform = ''; panes[2].style.transform = '';
      P.busy = false; P.dragging = false;
    }
    /* dir：+1 = 后一页（左滑），-1 = 前一页（右滑） */
    function commit(dir) {
      if (dir > 0) panes = [panes[1], panes[2], panes[0]];
      else panes = [panes[2], panes[0], panes[1]];
      P.panes = panes;
      var recycled = dir > 0 ? panes[2] : panes[0];
      recycled.innerHTML = ''; recycled._iso = null;
      place();
      rest();
      if (vOff > 0) { try { global.scrollTo({ top: docTop, behavior: 'instant' }); } catch (e) { global.scrollTo(0, docTop); } }
      vOff = 0;
      o.commit(dir, panes);
      /* 移出去的那块下一帧再静默重画（下一次拖动开始前没画好就当场补上） */
      setTimeout(function () { if (!recycled._iso && recycled.parentNode) o.fill(recycled, dir > 0 ? 1 : -1); }, 0);
    }
    P.flip = function (dir, v) {
      if (!o.can(dir)) { animate(0, BACK_EASE, 0, rest); return false; }
      ensureSides();
      if (!W) W = root.clientWidth || 1;
      var to = -dir * W, dist = Math.abs(to - off);
      var dur = v ? Math.max(200, Math.min(340, dist / Math.max(Math.abs(v), 0.6) * 1.6)) : 300;
      animate(to, FLIP_EASE, Math.round(dur), function () { commit(dir); });
      return true;
    };
    P.finish = finishAnim;
    P.place = place;
    function ensureSides() {
      if (!panes[0]._iso && o.wantSide(-1)) o.fill(panes[0], -1);
      if (!panes[2]._iso && o.wantSide(1)) o.fill(panes[2], 1);
    }
    P.ensureSides = ensureSides;
    function blocked() {
      var b = document.body.classList;
      if (b.contains('qd-open') || b.contains('sheet-open')) return true;
      var mr = document.getElementById('modalRoot');
      return !!(mr && mr.children.length) || !!document.querySelector('body > .cal-pop-mask');
    }
    root.addEventListener('touchstart', function (e) {
      lock = 0;
      /* 第 300 次（用户：日历页的滑动还是有问题，取消）：不再接横滑，换天走周条点选、左右箭头、「查看前一天」和跳转日期 */
      if (o.touch === false || !e.touches || e.touches.length !== 1 || blocked()) { lock = -1; return; }
      if (anim) finishAnim(); /* 切换中又来手势：这次先直接落定，日期不乱 */
      var t = e.touches[0];
      sx = t.clientX; sy = t.clientY; startT = Date.now(); samples = [[startT, sx]];
      if (sx < 16) lock = -1; /* iOS Safari 左缘归系统返回，不接 */
    }, { passive: true });
    root.addEventListener('touchmove', function (e) {
      if (lock < 0 || !e.touches || !e.touches[0]) return;
      var t = e.touches[0], ddx = t.clientX - sx, ddy = t.clientY - sy;
      if (!lock) {
        if (Math.abs(ddx) < 8 && Math.abs(ddy) < 8) return;
        if (Math.abs(ddx) <= Math.abs(ddy) * 1.15) { lock = -1; return; } /* 竖向：交给原生滚动 */
        lock = 1;
        /* 锁定时读一次布局：宽度、两侧块的竖向位置（滚下去时让两侧那天从它的顶部露出来） */
        W = root.clientWidth || 1;
        var rt = root.getBoundingClientRect();
        vOff = o.vfollow ? Math.max(0, -rt.top + (o.topPad || 0)) : 0;
        docTop = rt.top + (global.pageYOffset || 0) - (o.topPad || 0);
        ensureSides();
        if (vOff > 0) { panes[0].style.transform = 'translate3d(0,' + vOff + 'px,0)'; panes[2].style.transform = 'translate3d(0,' + vOff + 'px,0)'; }
        /* 当天这块比旁边那天短（例如空的一天）：拖动期间把容器临时撑到能露出旁边那天的一屏，免得它被裁掉一截 */
        if (o.vfollow) {
          var need = vOff + Math.min(global.innerHeight || 800, Math.max(panes[0].offsetHeight, panes[2].offsetHeight));
          if (need > rt.height) root.style.minHeight = Math.round(need) + 'px';
        }
        root.classList.add('is-drag');
        track.style.transition = 'none';
        P.dragging = true;
      }
      if (e.cancelable) e.preventDefault();
      dx = ddx;
      var now = Date.now();
      samples.push([now, t.clientX]);
      while (samples.length > 2 && now - samples[0][0] > 100) samples.shift();
      P.stats.moves++;
      if (reduced()) return;
      var dir = dx < 0 ? 1 : -1;
      off = o.can(dir) ? dx : rubber(dx, W);
      if (!raf) raf = requestAnimationFrame(write);
    }, { passive: false });
    function end(e) {
      if (lock !== 1) { lock = 0; return; }
      lock = 0;
      if (raf) { cancelAnimationFrame(raf); raf = 0; write(); }
      swallow = Date.now() + 400;
      var now = Date.now(), v = 0;
      if (samples.length > 1) {
        var a = samples[0], b = samples[samples.length - 1];
        if (now - b[0] < 80 && b[0] > a[0]) v = (b[1] - a[1]) / (b[0] - a[0]);
      }
      P.lastV = v;
      var dir = dx < 0 ? 1 : -1;
      var go = e.type !== 'touchcancel' && Math.abs(dx) > 10 && (Math.abs(dx) >= W / 3 || (Math.abs(v) >= 0.3 && (v < 0) === (dx < 0)));
      if (go && o.can(dir)) P.flip(dir, v);
      else animate(0, BACK_EASE, Math.abs(off) < 2 ? 0 : 300, rest);
    }
    root.addEventListener('touchend', end, { passive: true });
    root.addEventListener('touchcancel', end, { passive: true });
    /* 横滑过的这一下不当点击（时间带小点、时间轴行） */
    root.addEventListener('click', function (e) { if (Date.now() < swallow) { e.stopPropagation(); e.preventDefault(); } }, true);
    place();
    return P;
  }

  var state = { sel: null };

  Modules.calendar = {
    id: 'calendar',
    title: '日期记录',
    _state: state,
    /* 离开日期页回到今天；去补记 / 去模块页改记录再回来时停在原来那天 */
    leave: function () { if (!state.keep) state.sel = null; state.keep = false; closePop(); },
    _shape: function (iso) { var d = Storage.get(); return { nums: dayNums(d, iso, iso === Util.todayISO()), segs: sleepSegs(d, iso, iso === Util.todayISO()) }; },
    render: function (view) {
      var today = Util.todayISO();
      if (!state.sel || Util.daysBetween(today, state.sel) > 0) state.sel = today;
      closePop();
      var d = Storage.get(), idx = dayIndex(d);
      var swapFx = !!(state.swapFx && Date.now() < state.swapFx); /* 切宝宝后 0.5 秒内的重画都带轻转场 */

      view.innerHTML = '<div class="cal-day-page' + (swapFx ? ' cal-swap' : '') + '">'
        + '<div class="page-head cal-head-row"><h1 id="calTitle" aria-live="polite"></h1>'
        + '<div class="cal-acts">' + babyBtnHTML()
        + '<button type="button" class="cal-hbtn cal-jump" data-cal-jump aria-label="跳转到日期">' + icon('calendar') + '</button></div></div>'
        + '<div class="ws-row"><button type="button" class="ws-nav" data-wsnav="-1" aria-label="上一周">' + icon('chevron') + '</button>'
        + '<div class="ws-pager"><div class="ws-track"><div></div><div></div><div></div></div></div>'
        + '<button type="button" class="ws-nav ws-nav-r" data-wsnav="1" aria-label="下一周">' + icon('chevron') + '</button></div>'
        + '<div class="cal-pager"><div class="cal-track"><div></div><div></div><div></div></div></div>'
        + '</div>';
      var title = view.querySelector('#calTitle');
      var wsRoot = view.querySelector('.ws-pager'), wsTrack = view.querySelector('.ws-track');
      var dRoot = view.querySelector('.cal-pager'), dTrack = view.querySelector('.cal-track');

      function monOf(iso) { var s = dObj(iso); return Util.fmtDate(new Date(s.getFullYear(), s.getMonth(), s.getDate() - (s.getDay() + 6) % 7)); }
      function weekHTML(mon) {
        var m0 = dObj(mon), h = '';
        for (var w = 0; w < 7; w++) {
          var wd = new Date(m0.getFullYear(), m0.getMonth(), m0.getDate() + w), iso = Util.fmtDate(wd);
          var lbl = iso === today ? '今' : DOW[wd.getDay()];
          var has = (idx[iso] || []).length ? '<i class="ws-dot" aria-hidden="true"></i>' : '';
          if (Util.daysBetween(today, iso) > 0) {
            h += '<span class="ws-cell is-future"><span class="ws-dow">' + lbl + '</span><span class="ws-day">' + wd.getDate() + '</span></span>';
          } else {
            h += '<button type="button" data-ws="' + iso + '" class="' + (iso === state.sel ? 'is-sel' : '') + (iso === today ? ' is-today' : '') + '"'
              + (iso === state.sel ? ' aria-current="date"' : '') + ' aria-label="' + titleOf(iso) + '">'
              + '<span class="ws-dow">' + lbl + '</span><span class="ws-day">' + wd.getDate() + '</span>' + has + '</button>';
          }
        }
        return h;
      }
      function fillWeek(pane, k) {
        var mon = Util.addDays(monOf(state.sel), 7 * k);
        pane._iso = mon;
        pane.innerHTML = weekHTML(mon);
      }
      function dayHTML(iso) {
        var rows = idx[iso] || [], isT = iso === today, h = '';
        if (rows.length) {
          h += shapeHTML(d, iso, rows, isT);
          h += timelineHTML(rows, sleepSegs(d, iso, isT));
        } else {
          h += '<p class="day-empty">' + (isT ? '今天还没有记录' : '这一天没有记录') + '</p>';
        }
        h += '<button type="button" class="cal-prev" data-cal-prev>查看前一天</button>';
        return h;
      }
      function fillDay(pane, k) {
        var iso = Util.addDays(state.sel, k);
        if (Util.daysBetween(today, iso) > 0) { pane.innerHTML = ''; pane._iso = 'future'; pane._rows = []; return; }
        pane._iso = iso; pane._rows = idx[iso] || [];
        pane.innerHTML = dayHTML(iso);
      }
      function markDay(cur, all) {
        all.forEach(function (pn) {
          if (pn.id === 'calDay') pn.removeAttribute('id');
          Array.prototype.forEach.call(pn.querySelectorAll('li[id]'), function (li) { li.removeAttribute('id'); });
        });
        cur.id = 'calDay';
        Array.prototype.forEach.call(cur.querySelectorAll('li[data-ti]'), function (li) { li.id = 'dtl' + li.getAttribute('data-ti'); });
      }
      function markWeek(cur, all) {
        all.forEach(function (pn) { if (pn.id === 'calStrip') pn.removeAttribute('id'); });
        cur.id = 'calStrip';
      }

      var wsP = makePager(wsRoot, wsTrack, {
        paneCls: 'week-strip ws-pane', mark: markWeek, touch: false,
        can: function (dir) { return dir < 0 || Util.daysBetween(today, Util.addDays(monOf(state.sel), 7)) <= 0; },
        wantSide: function (k) { return true; },
        fill: function (pane, k) { fillWeek(pane, k); },
        commit: function (dir) {
          var n = Util.addDays(state.sel, 7 * dir);
          if (Util.daysBetween(today, n) > 0) n = today;
          state.sel = n;
          /* 周条自己已经轮换好；当天块整组重画（跨了 7 天），淡入一下 */
          paintWeekSel();
          rebuildDays(true);
          paintTitle();
        }
      });
      var dP = makePager(dRoot, dTrack, {
        paneCls: 'cal-day cal-pane', mark: markDay, vfollow: true, topPad: 0, touch: false,
        can: function (dir) { return dir < 0 || Util.daysBetween(today, Util.addDays(state.sel, 1)) <= 0; },
        wantSide: function (k) { return true; },
        fill: function (pane, k) { fillDay(pane, k); },
        commit: function (dir) {
          var oldMon = monOf(state.sel);
          state.sel = Util.addDays(state.sel, dir);
          paintTitle();
          if (monOf(state.sel) !== oldMon) rebuildWeeks(); else paintWeekSel();
        }
      });
      Modules.calendar._pager = dP; Modules.calendar._wpager = wsP;

      function paintTitle() { title.textContent = titleOf(state.sel); if (typeof paintNav === 'function') paintNav(); }
      function paintWeekSel() {
        var cur = wsP.panes[1];
        if (cur._iso !== monOf(state.sel)) { rebuildWeeks(); return; }
        Array.prototype.forEach.call(cur.querySelectorAll('[data-ws]'), function (b) {
          var on = b.getAttribute('data-ws') === state.sel;
          b.classList.toggle('is-sel', on);
          if (on) b.setAttribute('aria-current', 'date'); else b.removeAttribute('aria-current');
        });
      }
      function rebuildWeeks() {
        wsP.finish();
        fillWeek(wsP.panes[1], 0); fillWeek(wsP.panes[0], -1); fillWeek(wsP.panes[2], 1);
        wsP.place();
      }
      function rebuildDays(fade) {
        dP.finish();
        fillDay(dP.panes[1], 0); fillDay(dP.panes[0], -1); fillDay(dP.panes[2], 1);
        dP.place();
        if (fade && !reduced()) {
          var c = dP.panes[1];
          c.classList.remove('dp-in'); void c.offsetWidth; c.classList.add('dp-in');
        }
      }

      /* 换到任意一天：相邻的一天走同一套翻页动画，其余整组重画 + 淡入 */
      function go(iso) {
        if (!iso || Util.daysBetween(today, iso) > 0 || iso === state.sel) return;
        var diff = Util.daysBetween(state.sel, iso);
        if ((diff === 1 || diff === -1) && !reduced()) { dP.finish(); dP.flip(diff); return; }
        state.sel = iso;
        paintTitle(); rebuildWeeks(); rebuildDays(true);
      }
      Modules.calendar._go = go;

      /* 第 300 次：周条两侧的箭头（取消横滑后换周的入口）；下一周超过今天就禁用 */
      function paintNav() {
        var nb = view.querySelector('[data-wsnav="1"]');
        if (nb) nb.disabled = Util.daysBetween(today, Util.addDays(monOf(state.sel), 7)) > 0;
      }
      Array.prototype.forEach.call(view.querySelectorAll('[data-wsnav]'), function (b) {
        b.addEventListener('click', function () {
          if (b.disabled) return;
          var dir = +b.getAttribute('data-wsnav');
          if (reduced()) { var n = Util.addDays(state.sel, 7 * dir); if (Util.daysBetween(today, n) > 0) n = today; go(n); return; }
          wsP.finish(); wsP.flip(dir);
        });
      });
      wsRoot.addEventListener('click', function (e) {
        var b = e.target.closest && e.target.closest('[data-ws]');
        if (b && wsP.panes[1].contains(b)) go(b.getAttribute('data-ws'));
      });
      dRoot.addEventListener('click', function (e) {
        if (Util.hapEcho && Util.hapEcho(e)) return;
        var t = e.target && e.target.closest ? e.target : null;
        var cur = dP.panes[1];
        if (!t || !cur.contains(t)) return;
        var tap = t.closest('.day-shape [data-ti]');
        if (tap) {
          var row = cur.querySelector('li[data-ti="' + tap.getAttribute('data-ti') + '"]');
          if (row) {
            row.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' });
            row.classList.remove('is-flash'); void row.offsetWidth; row.classList.add('is-flash');
            setTimeout(function () { row.classList.remove('is-flash'); }, 1300);
          }
          return;
        }
        if (t.closest('[data-cal-prev]')) { go(Util.addDays(state.sel, -1)); try { global.scrollTo({ top: 0, behavior: 'instant' }); } catch (eS) { global.scrollTo(0, 0); } return; }
        var more = t.closest('[data-more]');
        var rows = cur._rows || [];
        if (more) {
          var it0 = rows[+more.getAttribute('data-more')];
          if (!it0) return;
          popMenu(more, '<button type="button" class="cp-row cp-act" role="menuitem" data-pick="edit"><span class="cp-aico">' + icon('edit') + '</span><span class="cp-txt"><b>修改</b></span></button>'
            + '<button type="button" class="cp-row cp-act cp-del" role="menuitem" data-pick="del"><span class="cp-aico">' + icon('trash') + '</span><span class="cp-txt"><b>删除</b></span></button>', 'cal-rmenu', function (k) {
            if (k === 'edit') editRec(it0); else if (k === 'del') deleteRec(it0);
          });
          return;
        }
        var li = t.closest('li[data-ti]');
        if (li) { var it = rows[+li.getAttribute('data-ti')]; if (it && (editable(it) || (it.src && GO_MOD[it.src])) && !busyUI(e)) editRec(it); }
      });
      view.querySelector('[data-cal-jump]').addEventListener('click', function () { Modules.calendar._openJump(); });
      view.querySelector('[data-cal-baby]').addEventListener('click', function (e) {
        if (Util.hapEcho && Util.hapEcho(e)) return;
        if (document.querySelector('body > .cal-pop-mask .cal-bmenu')) { closePop(); return; }
        openBabyMenu(e.currentTarget);
      });

      paintTitle();
      rebuildWeeks();
      rebuildDays(false);
    },

    /* 跳转日期半屏：月历（周一起，有记录的日子下面一个小圆点，底部「· 有记录」图例）+ 回顾 + 数据管理入口 */
    _openJump: function () {
      if (!global.FTUI) return;
      var today = Util.todayISO(), sel = state.sel || today, s0 = dObj(sel);
      var ym = { y: s0.getFullYear(), m: s0.getMonth() };
      var d = Storage.get(), idx = dayIndex(d);
      var api = FTUI.openSheet('', '跳转到日期', '<div class="cal-jump-body"><div id="calMonth"></div>' + reviewHTML(idx, new Date())
        + '<button type="button" class="cal-dm-row" data-dm>' + icon('export') + '<span>数据管理</span><small>导入 · 导出 · 导入历史</small>' + icon('chevron-right') + '</button></div>', null);
      if (!api) return;
      var ok = api.box.querySelector('[data-ok]');
      if (ok) ok.remove();
      api.box.parentNode.classList.add('cal-sheet');
      var mBox = api.box.querySelector('#calMonth');
      function paintMonth() {
        var y = ym.y, m = ym.m, first = new Date(y, m, 1), lead = (first.getDay() + 6) % 7, n = new Date(y, m + 1, 0).getDate();
        var h = '<div class="cal-head"><button type="button" data-cm="-1" aria-label="上个月">‹</button>'
          + '<span class="cal-title">' + y + ' 年 ' + (m + 1) + ' 月</span>'
          + '<button type="button" data-cm="1" aria-label="下个月"' + (y * 12 + m >= dObj(today).getFullYear() * 12 + dObj(today).getMonth() ? ' disabled' : '') + '>›</button></div>'
          + '<div class="cal-week"><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span></div><div class="cal-grid">';
        for (var i = 0; i < lead; i++) h += '<span class="cal-cell is-empty"></span>';
        for (var day = 1; day <= n; day++) {
          var iso = y + '-' + pad(m + 1) + '-' + pad(day), cls = 'cal-cell';
          if (iso === today) cls += ' is-today';
          if (iso === sel) cls += ' is-sel';
          var dot = (idx[iso] || []).length ? '<span class="cal-dots"><i class="cal-dot"></i></span>' : '';
          if (Util.daysBetween(today, iso) > 0) h += '<span class="' + cls + ' is-future">' + day + '</span>';
          else h += '<button type="button" class="' + cls + '" data-day="' + iso + '"' + (iso === sel ? ' aria-current="date"' : '') + (iso === today ? ' aria-label="' + day + ' 日，今天"' : '') + '>' + day + dot + '</button>';
        }
        h += '</div><p class="cal-legend"><i class="cal-dot" aria-hidden="true"></i>有记录</p>';
        if (sel !== today) h += '<button type="button" class="cal-today" data-day="' + today + '">回到今天</button>';
        mBox.innerHTML = h;
      }
      mBox.addEventListener('click', function (e) {
        var b = e.target.closest && e.target.closest('button');
        if (!b || b.disabled) return;
        if (b.hasAttribute('data-cm')) {
          ym.m += +b.getAttribute('data-cm');
          if (ym.m < 0) { ym.m = 11; ym.y--; } else if (ym.m > 11) { ym.m = 0; ym.y++; }
          paintMonth(); return;
        }
        var iso = b.getAttribute('data-day');
        if (iso) { api.close(); if (Modules.calendar._go) Modules.calendar._go(iso); }
      });
      var ex = api.box.querySelector('#calExport');
      if (ex) ex.addEventListener('click', function () { if (global.App && typeof App.exportAll === 'function') App.exportAll(); });
      var dm = api.box.querySelector('[data-dm]');
      if (dm) dm.addEventListener('click', function () { api.close(); if (global.DataMgr) setTimeout(function () { DataMgr.open(); }, 0); });
      paintMonth();
      return api;
    }
  };
})(window);
