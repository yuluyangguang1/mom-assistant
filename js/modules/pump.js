/* ============================================================
 * pump.js · 第 256 次：泵奶独立模块
 *
 * 用户定的规则：
 *   - 泵奶（原「吸奶」）从喂养里拆出来，单独一个功能入口。
 *   - 开始记录的按钮只放在 dock 栏上方：「开始泵奶 | ⊕ 补记」。
 *   - 开始后进全屏计时页：左右两侧各自开关（两侧都开 = 双侧泵奶），
 *     分别累计左侧时间、右侧时间；左右奶量分别填。
 *   - 结束时弹「结束泵奶」面板，在奶瓶上拖动分别定左侧、右侧奶量。
 *
 * 数据：仍存进 d.feedings，type = 'pump'（老的吸奶记录原样兼容）：
 *   { id, type:'pump', start, end, secL, secR, durationL, durationR, durationMin,
 *     amountL, amountR, amount(=左+右，老记录只有它), side, note }
 * 计时中：d.pumpTimer = { start, L, R, accL, accR, accT, since, paused, mlL, mlR }
 *   L / R：这一侧是否在泵；since：当前这一段从何时开始计；acc*：已结算的毫秒。
 * ============================================================ */
(function (global) {
  'use strict';
  var Modules = global.Modules = global.Modules || {};
  var FT = function () { return global.FTUI; };
  var esc = function (s) { return Util.escapeHtml(String(s == null ? '' : s)); };
  var PMAX = 300;
  var fullEl = null, fullTick = null, pageTick = null;

  function ms(s) { var t = new Date(s).getTime(); return isFinite(t) ? t : NaN; }
  function clock(v) { return Util.fmtClock(Math.max(0, v || 0)).replace(/^0(\d:)/, '$1'); }
  function fmtSec(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    if (sec < 60) return sec + '秒';
    var m = Math.floor(sec / 60), s = sec % 60;
    if (m < 60) return m + '分' + (s ? s + '秒' : '钟');
    return Math.floor(m / 60) + '小时' + (m % 60 ? m % 60 + '分' : '');
  }
  function num(v) { var n = Number(v); return isFinite(n) && n > 0 ? Math.round(n) : 0; }
  /* 一条泵奶记录的左右奶量（老记录只有总量，归到「未分侧」） */
  function amts(r) {
    var L = num(r.amountL), R = num(r.amountR), T = num(r.amount);
    if (!L && !R) return { L: 0, R: 0, T: T, legacy: T > 0 };
    return { L: L, R: R, T: L + R };
  }
  function secs(r) {
    var L = r.secL != null ? num(r.secL) : num(r.durationL) * 60;
    var R = r.secR != null ? num(r.secR) : num(r.durationR) * 60;
    return { L: L, R: R };
  }
  function pumps(d) {
    return (d.feedings || []).filter(function (r) { return r && r.type === 'pump' && isFinite(ms(r.start)); })
      .sort(function (a, b) { return ms(b.start) - ms(a.start); });
  }

  /* ---------- 计时状态 ---------- */
  function running(t) { return !t.paused && (t.L || t.R); }
  function state(t, now) {
    var cur = running(t) ? Math.max(0, now - ms(t.since || t.start)) : 0;
    if (!isFinite(cur)) cur = 0;
    return {
      T: (t.accT || 0) + cur,
      L: (t.accL || 0) + (t.L ? cur : 0),
      R: (t.accR || 0) + (t.R ? cur : 0),
      run: !!running(t)
    };
  }
  function settle(t, now) {
    var s = state(t, now);
    t.accT = s.T; t.accL = s.L; t.accR = s.R; t.since = FT().loc(now);
  }
  function chipText(t) {
    if (!running(t)) return '已暂停';
    if (t.L && t.R) return '双侧泵奶中';
    return (t.L ? '左侧' : '右侧') + '泵奶中';
  }
  function start() {
    var d = Storage.get(), now = Date.now();
    if (!d.pumpTimer) d.pumpTimer = { start: FT().loc(now), since: FT().loc(now), L: true, R: true, accL: 0, accR: 0, accT: 0, mlL: null, mlR: null };
    Storage.save();
    if (Util.haptic) Util.haptic('ok');
    if (global.App) App.rerender();
    openFull();
  }
  function act(k) {
    var d = Storage.get(), t = d.pumpTimer; if (!t) return;
    var now = Date.now();
    settle(t, now);
    if (k === 'L' || k === 'R') {
      t[k] = !t[k];
      if (t[k]) t.paused = false; /* 打开一侧 = 接着泵 */
    } else if (k === 'pause') {
      if (t.paused || !(t.L || t.R)) { t.paused = false; if (!t.L && !t.R) { t.L = true; t.R = true; } }
      else t.paused = true;
    }
    if (!t.paused) delete t.paused;
    Storage.save();
    if (Util.haptic) Util.haptic('tick');
    if (fullEl) paintFull();
    if (global.App && App.currentTab && App.currentTab() === 'pump') App.rerender();
  }

  /* ---------- 全屏计时 ---------- */
  function closeFull() {
    if (fullTick) { clearInterval(fullTick); fullTick = null; }
    if (fullEl && fullEl.parentNode) fullEl.parentNode.removeChild(fullEl);
    fullEl = null;
    document.body.classList.remove('ftf-open');
  }
  function openFull() {
    var t = Storage.get().pumpTimer;
    if (!t) { closeFull(); return; }
    if (!fullEl) {
      fullEl = document.createElement('div');
      fullEl.className = 'ftf ftf-pump';
      fullEl.setAttribute('data-accent', 'pump');
      fullEl.setAttribute('role', 'dialog');
      fullEl.setAttribute('aria-label', '泵奶计时');
      document.body.appendChild(fullEl);
      document.body.classList.add('ftf-open');
      fullEl.addEventListener('click', onFullClick);
    }
    paintFull();
    if (!fullTick) fullTick = setInterval(tick, 500);
  }
  function mlTxt(v) { return v ? v + ' ml' : '-- ml'; }
  function paintFull() {
    var t = Storage.get().pumpTimer;
    if (!t || !fullEl) { closeFull(); return; }
    var SV = FT().SV, s = state(t, Date.now()), hm = FT().hm;
    var pi = icon('pump');
    fullEl.innerHTML = '<div class="ftf-bg" aria-hidden="true"></div>'
      + '<div class="ftf-top"><button type="button" class="ftf-ib" data-p="down" aria-label="收起">' + SV.down + '</button>'
      + '<span class="ftf-tr"><button type="button" class="ftf-ib ftf-del" data-p="cancel" aria-label="放弃这次泵奶">' + icon('trash') + '</button>'
      + '<button type="button" class="ftf-ib" data-p="dim" aria-label="关掉背景图" aria-pressed="' + (fullEl.classList.contains('is-dim') ? 'true' : 'false') + '">' + SV.bright + '</button></span></div>'
      + '<div class="ftf-main">'
      + '<p class="ftf-chip">' + pi + '<span>' + chipText(t) + '</span><i class="' + (s.run ? '' : 'is-off') + '"></i></p>'
      + '<div class="ftf-row"><button type="button" class="ftf-side' + (t.L ? ' is-on' : '') + '" data-p="L" aria-pressed="' + (t.L ? 'true' : 'false') + '" aria-label="左侧">' + pi + '<small>左</small></button>'
      + '<span class="ftf-big" data-pv="T">' + clock(s.T) + '</span>'
      + '<button type="button" class="ftf-side' + (t.R ? ' is-on' : '') + '" data-p="R" aria-pressed="' + (t.R ? 'true' : 'false') + '" aria-label="右侧">' + pi + '<small>右</small></button></div>'
      + '<div class="ftf-stats">'
      + '<label class="ftf-st ftf-start"><i>' + SV.clock + '</i><b>' + hm(ms(t.start)) + ' <em>' + SV.pen + '</em></b><span>开始</span>'
      + '<input type="time" data-p="start" value="' + hm(ms(t.start)) + '" aria-label="修改开始时刻"></label>'
      + '<button type="button" class="ftf-st pf-st" data-p="mlL" aria-label="左侧奶量"><i>' + pi + '</i><b data-pv="L">' + clock(s.L) + '</b><span>左侧 · <em data-pv="mlL">' + mlTxt(t.mlL) + '</em></span></button>'
      + '<button type="button" class="ftf-st pf-st" data-p="mlR" aria-label="右侧奶量"><i>' + pi + '</i><b data-pv="R">' + clock(s.R) + '</b><span>右侧 · <em data-pv="mlR">' + mlTxt(t.mlR) + '</em></span></button>'
      + '</div>'
      + '<div class="ftf-ctl pf-ctl"><button type="button" class="ftf-main-btn" data-p="pause">' + (s.run ? '暂停' : '继续') + '</button>'
      + '<button type="button" class="ftf-rb" data-p="stop" aria-label="结束并记奶量">' + SV.stop + '</button></div>'
      + '</div>';
    var si = fullEl.querySelector('input[data-p="start"]');
    if (si) si.addEventListener('change', function () {
      var dd = Storage.get(), tt = dd.pumpTimer; if (!tt || !/^\d{2}:\d{2}/.test(si.value)) return;
      var now = Date.now(), cand = ms(FT().isoDay(now) + 'T' + si.value.slice(0, 5) + ':00');
      if (cand > now) cand -= 864e5;
      settle(tt, now);
      var shift = ms(tt.start) - cand; /* 往前改 = 多泵了 shift 毫秒，加到正在泵的那几侧 */
      tt.start = FT().loc(cand);
      var add = function (k, v) { tt[k] = Math.max(0, (tt[k] || 0) + v); };
      add('accT', shift);
      if (tt.L || !tt.R) add('accL', shift);
      if (tt.R) add('accR', shift);
      Storage.save(); paintFull();
    });
  }
  function tick() {
    var t = Storage.get().pumpTimer;
    if (!t) { closeFull(); return; }
    var s = state(t, Date.now());
    if (fullEl) {
      ['T', 'L', 'R'].forEach(function (k) { var el = fullEl.querySelector('[data-pv="' + k + '"]'); if (el) el.textContent = clock(s[k]); });
    }
    var mini = document.querySelector('[data-pmini-cur]');
    if (mini) mini.textContent = clock(s.T);
  }
  function onFullClick(e) {
    var b = e.target.closest ? e.target.closest('[data-p]') : null;
    if (!b || b.tagName === 'INPUT') return;
    var k = b.getAttribute('data-p');
    if (k === 'down') { closeFull(); if (global.App) App.rerender(); return; }
    if (k === 'dim') { fullEl.classList.toggle('is-dim'); b.setAttribute('aria-pressed', fullEl.classList.contains('is-dim') ? 'true' : 'false'); return; }
    if (k === 'cancel') {
      Util.confirm({ title: '放弃这次泵奶？', message: '这次泵奶不会被记录。', okText: '放弃', danger: true, onConfirm: function () {
        var d = Storage.get(); d.pumpTimer = null; Storage.save(); closeFull(); Util.toast('已放弃这次泵奶', 'ok'); if (global.App) App.rerender();
      } });
      return;
    }
    if (k === 'mlL' || k === 'mlR') { openAmount(k === 'mlL' ? 'L' : 'R', false); return; }
    if (k === 'stop') { openAmount(null, true); return; }
    act(k);
  }

  /* ---------- 奶瓶刻度（拖动定奶量） ---------- */
  function bottle(v) {
    var B = Modules.bottle && Modules.bottle._bottleSVG;
    return B ? B(v) : '';
  }
  function bindBottle(box, sel, get, set) {
    var btl = box.querySelector(sel); if (!btl) return;
    btl.setAttribute('data-nodrag', '');
    function fromY(cy) {
      var svg = btl.querySelector('svg'); if (!svg) return;
      var r = svg.getBoundingClientRect(); if (!r.height) return;
      var y = (cy - r.top) / r.height * 250;
      var v = (228 - y) / (228 - 100) * PMAX;
      set(Math.max(0, Math.min(PMAX, Math.round(v / 5) * 5)));
    }
    var dragging = false;
    btl.addEventListener('pointerdown', function (e) { dragging = true; try { btl.setPointerCapture(e.pointerId); } catch (x) { /* */ } fromY(e.clientY); e.preventDefault(); });
    btl.addEventListener('pointermove', function (e) { if (dragging) { fromY(e.clientY); e.preventDefault(); } });
    ['pointerup', 'pointercancel'].forEach(function (ev) { btl.addEventListener(ev, function () { dragging = false; }); });
    void get;
  }

  /* 奶量面板：side = 'L' / 'R' 只改一侧（计时中随时填）；finish = true 是「结束泵奶」，左右两侧都在这里定 */
  function openAmount(side, finish) {
    var d = Storage.get(), t = d.pumpTimer; if (!t) return;
    var cur = side || (t.R && !t.L ? 'R' : 'L');
    var v = { L: num(t.mlL), R: num(t.mlR) };
    var body = '<div class="ft-seg pa-seg" role="tablist" aria-label="哪一侧">'
      + '<button type="button" role="tab" data-ps="L">左侧</button><button type="button" role="tab" data-ps="R">右侧</button></div>'
      + '<div class="pa-btl" data-pbtl></div>'
      + '<p class="pa-val"><b data-pval>0</b><small>ml</small></p>'
      + '<p class="hint pa-sum" data-psum></p>'
      + '<div class="rs-savebar"><button type="button" class="btn btn-primary ft-save" data-psave>' + icon('check') + (finish ? '保存这次泵奶' : '好了') + '</button></div>';
    FT().openSheet('pump', finish ? '结束泵奶' : '奶量', body, function (api) {
      var box = api.box;
      function paint() {
        Array.prototype.forEach.call(box.querySelectorAll('[data-ps]'), function (b) {
          var on = b.getAttribute('data-ps') === cur; b.classList.toggle('is-on', on); b.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        box.querySelector('[data-pbtl]').innerHTML = bottle(v[cur]);
        box.querySelector('[data-pval]').textContent = v[cur];
        var s = state(Storage.get().pumpTimer || t, Date.now());
        box.querySelector('[data-psum]').textContent = '左 ' + v.L + ' ml（' + fmtSec(s.L / 1000) + '）· 右 ' + v.R + ' ml（' + fmtSec(s.R / 1000) + '）· 共 ' + (v.L + v.R) + ' ml';
      }
      Array.prototype.forEach.call(box.querySelectorAll('[data-ps]'), function (b) {
        b.addEventListener('click', function () { cur = b.getAttribute('data-ps'); paint(); });
      });
      bindBottle(box, '[data-pbtl]', function () { return v[cur]; }, function (nv) { if (nv !== v[cur]) { v[cur] = nv; paint(); } });
      paint();
      function keep() {
        var dd = Storage.get(), tt = dd.pumpTimer; if (!tt) return null;
        tt.mlL = v.L || null; tt.mlR = v.R || null; Storage.save(); return tt;
      }
      function done() {
        var tt = keep(); if (!tt) { api.close(); return; }
        if (!finish) { api.close(); if (fullEl) paintFull(); return; }
        var now = Date.now(); settle(tt, now);
        var sL = Math.round((tt.accL || 0) / 1000), sR = Math.round((tt.accR || 0) / 1000);
        if (sL + sR < 1 && !(v.L + v.R)) { Util.toast('这次计时还不到 1 秒', 'warn'); return; }
        var dd = Storage.get();
        dd.feedings.push({
          id: Util.uid(), type: 'pump', start: tt.start, end: FT().loc(now),
          secL: sL, secR: sR, durationL: Math.round(sL / 60), durationR: Math.round(sR / 60),
          durationMin: Math.max(1, Math.round(Math.max(sL, sR, Math.round((tt.accT || 0) / 1000)) / 60)),
          amountL: v.L || null, amountR: v.R || null, amount: (v.L + v.R) || null,
          side: (sL && sR) ? 'both' : (sL ? 'left' : (sR ? 'right' : null)), note: null
        });
        dd.pumpTimer = null;
        if (Storage.save()) Util.toast('已记录泵奶' + ((v.L + v.R) ? ' ' + (v.L + v.R) + ' ml' : ''), 'ok');
        api.close(); closeFull(); if (global.App) App.rerender();
      }
      box.querySelector('[data-psave]').addEventListener('click', done);
      box.parentNode.parentNode.querySelector('[data-ok]').addEventListener('click', done);
      /* 不保存直接关面板：计时中填的奶量也留着 */
      var x = box.querySelector('[data-x]'); if (x) x.addEventListener('click', function () { keep(); if (fullEl) paintFull(); });
    });
  }

  /* ---------- 补记（忘了计时，事后补一条） ---------- */
  function stepper(k, label, unit, max, step) {
    return '<div class="pm-row"><span class="pm-l">' + label + '</span><div class="ft-step" data-pstep="' + k + '">'
      + '<button type="button" class="btn-mini" data-pd="-' + step + '" aria-label="减少">−</button>'
      + '<span class="ft-sv"><input type="number" inputmode="numeric" min="0" max="' + max + '" value="0" id="pm' + k + '" aria-label="' + label + '"><small>' + unit + '</small></span>'
      + '<button type="button" class="btn-mini" data-pd="' + step + '" aria-label="增加">+</button></div></div>';
  }
  function openManual() {
    var F = FT(), now = Date.now();
    var last = pumps(Storage.get())[0];
    var body = F.whenTiles('s', '开始时间', F.isoDay(now), F.hm(now), F.isoDay(now))
      + '<p class="rs-lbl">左侧</p>' + stepper('LM', '时长', '分钟', 120, 1) + stepper('LA', '奶量', 'ml', PMAX, 5)
      + '<p class="rs-lbl">右侧</p>' + stepper('RM', '时长', '分钟', 120, 1) + stepper('RA', '奶量', 'ml', PMAX, 5)
      + '<label class="rs-lbl ft-note">备注<input type="text" id="pmNote" maxlength="40" placeholder="可选"></label>'
      + '<div class="rs-savebar"><button type="button" class="btn btn-primary ft-save" data-pmsave>' + icon('check') + '保存</button></div>';
    F.openSheet('pump', '补记泵奶', body, function (api) {
      var box = api.box;
      if (last) {
        var s0 = secs(last), a0 = amts(last);
        box.querySelector('#pmLM').value = Math.round(s0.L / 60); box.querySelector('#pmRM').value = Math.round(s0.R / 60);
        box.querySelector('#pmLA').value = a0.L; box.querySelector('#pmRA').value = a0.R;
      }
      Array.prototype.forEach.call(box.querySelectorAll('[data-pd]'), function (b) {
        b.addEventListener('click', function () {
          var inp = b.parentNode.querySelector('input'), mx = Number(inp.max) || 999;
          inp.value = Math.max(0, Math.min(mx, (parseInt(inp.value, 10) || 0) + Number(b.getAttribute('data-pd'))));
        });
      });
      function rd(id, mx) { var n = parseInt(box.querySelector('#' + id).value, 10); return isFinite(n) ? Math.max(0, Math.min(mx, n)) : 0; }
      function save() {
        var st = F.readWhen(box, 's');
        if (!isFinite(st)) { Util.toast('请选好开始时间', 'warn'); return; }
        if (st > Date.now() + 60000) { Util.toast('开始时间不能晚于现在', 'warn'); return; }
        var LM = rd('pmLM', 120), RM = rd('pmRM', 120), LA = rd('pmLA', PMAX), RA = rd('pmRA', PMAX);
        if (!LM && !RM && !LA && !RA) { Util.toast('请至少填一侧的时长或奶量', 'warn'); return; }
        var note = (box.querySelector('#pmNote').value || '').trim().slice(0, 40);
        var dd = Storage.get();
        dd.feedings.push({
          id: Util.uid(), type: 'pump', start: F.loc(st), end: (LM || RM) ? F.loc(st + Math.max(LM, RM) * 60000) : null,
          durationL: LM || null, durationR: RM || null, durationMin: Math.max(LM, RM) || null,
          amountL: LA || null, amountR: RA || null, amount: (LA + RA) || null,
          side: ((LM || LA) && (RM || RA)) ? 'both' : ((LM || LA) ? 'left' : 'right'), note: note || null
        });
        if (Storage.save()) Util.toast('已补记泵奶', 'ok');
        api.close(); if (global.App) App.rerender();
      }
      box.querySelector('[data-pmsave]').addEventListener('click', save);
      box.parentNode.parentNode.querySelector('[data-ok]').addEventListener('click', save);
    });
  }

  /* ---------- 页面 ---------- */
  function subOf(r) {
    var a = amts(r), s = secs(r), parts = [];
    if (a.T) parts.push(a.legacy ? a.T + ' ml' : '共 ' + a.T + ' ml');
    var side = function (lbl, sec, ml) {
      if (!sec && !ml) return null;
      return lbl + ' ' + [sec ? Math.max(1, Math.round(sec / 60)) + '分' : null, ml ? ml + ' ml' : null].filter(Boolean).join(' ');
    };
    var l = side('左', s.L, a.L), rr = side('右', s.R, a.R);
    if (l) parts.push(l); if (rr) parts.push(rr);
    if (r.note) parts.push(r.note);
    return { title: '泵奶', sub: parts.join(' · ') };
  }

  Modules.pump = {
    title: '泵奶',
    _start: start,
    _openFull: openFull,
    _closeFull: closeFull,
    _act: act,
    _state: state,
    _manual: openManual,
    _amts: amts,
    render: function (view) {
      var d = Storage.get(), F = FT();
      var DS = Util.dayStartHour(d), dayNow = Util.dayKeyOf(new Date(), DS);
      var list = pumps(d);
      var dk = function (r) { return Util.dayKeyOf(r.start, DS); };
      var todayL = list.filter(function (r) { return dk(r) === dayNow; });
      var tA = { L: 0, R: 0, T: 0 };
      todayL.forEach(function (r) { var a = amts(r); tA.L += a.L; tA.R += a.R; tA.T += a.T; });
      var html = '';
      var sum = todayL.length
        ? '今天泵了 <b>' + todayL.length + '</b> 次，共 <b>' + tA.T + ' ml</b>' + ((tA.L || tA.R) ? '（左 ' + tA.L + ' · 右 ' + tA.R + '）' : '') + '。'
        : '今天还没有<b>泵奶</b>记录。';
      if (list[0]) sum += '上次：<b>' + esc(Util.fmtAgo(list[0].start).replace(/\s/g, '')) + '</b>';
      html += '<div class="mod-sum ft-sum"><span class="ms-k">摘要</span><p>' + sum + '</p></div>';

      if (list.length) {
        var d7 = global.DayChart ? DayChart.lastDays(dayNow, 7) : [];
        var wk = list.filter(function (r) { return d7.indexOf(dk(r)) >= 0; });
        var wL = 0, wR = 0, wT = 0, sL = 0, sR = 0;
        wk.forEach(function (r) { var a = amts(r), s = secs(r); wL += a.L; wR += a.R; wT += a.T; sL += s.L; sR += s.R; });
        var amtHtml = '<h2>近 7 天泵奶量</h2>';
        if (global.DayChart) {
          amtHtml += DayChart.bars(d7.map(function (k) {
            var v = list.filter(function (r) { return dk(r) === k; }).reduce(function (s2, r) { return s2 + amts(r).T; }, 0);
            return { key: k, v: v, txt: v ? String(v) : '' };
          }), dayNow, '近 7 天泵奶量');
        }
        amtHtml += '<p class="hint">近 7 天泵了 <b>' + wk.length + '</b> 次，共 <b>' + wT + ' ml</b>。</p>';
        var lrHtml = '<h2>左右对比</h2><p class="hint">近 7 天左侧 <b>' + wL + ' ml</b>、' + fmtSec(sL) + '；右侧 <b>' + wR + ' ml</b>、' + fmtSec(sR) + '。</p>'
          + '<p class="hint">两侧量差一些很常见，只统计你自己记的数。</p>';
        html += F.insightChips([{ ico: icon('pump'), t: '近 7 天', html: amtHtml }, { ico: icon('pump'), t: '左右对比', html: lrHtml }]);
        html += F.timeline(list, DS, '最近泵奶记录', subOf, function () { return icon('pump'); }, 'tl-f-pump');
      } else {
        html += '<div class="sk-empty"><img src="assets/hero/pump.webp" alt="" width="150" height="150"><p>点「开始泵奶」计时，左右两侧可以分开开关；<br>忘了计时就点 ⊕ 补记。</p></div>';
      }

      var t = d.pumpTimer;
      if (t) {
        var s = state(t, Date.now());
        html += '<div class="mod-cta ft-cta"><div class="ft-mini" data-accent="pump">'
          + '<button type="button" class="ft-mini-open" data-pm="open" aria-label="打开计时">' + icon('pump') + '<b data-pmini-cur>' + clock(s.T) + '</b></button>'
          + '<span class="ft-mini-side">' + esc(chipText(t)) + '</span>'
          + '<button type="button" class="ft-mini-b" data-pm="pause" aria-label="' + (s.run ? '暂停' : '继续') + '">' + (s.run ? F.SV.pause : F.SV.play) + '</button></div></div>';
      } else {
        html += '<div class="mod-cta ft-cta"><div class="ft-split" data-accent="pump">'
          + '<button type="button" class="ft-split-main" data-pstart>' + F.SV.play + '<span>开始泵奶</span></button>'
          + '<button type="button" class="ft-split-add" data-padd aria-label="补记一次泵奶">' + F.SV.plusc + '</button></div></div>';
      }
      view.innerHTML = '<div class="ft-page" data-accent="pump">' + html + '</div>';
      F.bindChips(view);
      if (F.bindTimeline) F.bindTimeline(view, d);
      var sb = view.querySelector('[data-pstart]'); if (sb) sb.addEventListener('click', start);
      var ab = view.querySelector('[data-padd]'); if (ab) ab.addEventListener('click', openManual);
      Array.prototype.forEach.call(view.querySelectorAll('[data-pm]'), function (b) {
        b.addEventListener('click', function () { if (b.getAttribute('data-pm') === 'open') openFull(); else act('pause'); });
      });
      if (pageTick) { clearInterval(pageTick); pageTick = null; }
      if (t && !fullTick) pageTick = setInterval(function () { if (!document.querySelector('[data-pmini-cur]') || !Storage.get().pumpTimer) { clearInterval(pageTick); pageTick = null; return; } tick(); }, 1000);
      if (t && fullEl) paintFull();
    }
  };
})(window);
