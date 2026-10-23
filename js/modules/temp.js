/**
 * temp.js - 体温记录（对标 Cali 宝宝补齐，2026-09-27 第 38 次）
 * 发热期的按需记录：温度 + 时间 + 备注；今日小结给「最新 / 今日最高」，
 * ≥38.5°C 的数值用警示色显示并提示就医边界——不做发热判读、不给用药建议（U-25/U-37）。
 *
 * 第 139 次（P1-4 · 对标 Cali TemperatureObservationEpisode + 部位字段）：
 *   ① 测量部位 site（腋下/耳温/额温/肛温）——不同部位参考值不同，记录它才有回溯意义；
 *      这里只记录部位、提示「部位不同参考值不同」，不解释任何个体的数值含义。
 *   ② 病程（观察期）：把零散测温聚成「本次观察」，按距今 >36h 的分界线切段，
 *      每次记录标记「第 N 天」，今日小结提示「本次观察已第 N 天」。
 *      命名刻意用「观察」而不是「发热」——是不是发热由医生判断，这里只记录事实。
 * 数据：d.temps = [{ id, time, value, note, site }]
 */
(function (global) {
  'use strict';
  var Storage = global.Storage, Util = global.Util;
  var Modules = global.Modules = global.Modules || {};

  var HIGH = 38.5; /* 展示用提示阈值：只变色+提示就医，不做任何判读 */

  /* 第 139 次：测量部位。默认腋下（婴幼儿最常用）。 */
  var SITES = [
    { v: 'axillary',  label: '腋下', hint: '最常用' },
    { v: 'ear',       label: '耳温', hint: '' },
    { v: 'forehead',  label: '额温', hint: '' },
    { v: 'rectal',    label: '肛温', hint: '' }
  ];
  function siteOf(v) {
    for (var i = 0; i < SITES.length; i++) if (SITES[i].v === v) return SITES[i];
    return null;
  }

  /* 第 139 次：病程（观察期）划分。
     规则只有一条：相邻两条记录间隔 >36h → 视为新一轮观察。
     36h 的依据：发热观察通常按天进行（早中晚数次），隔一整天以上再出现，
     基本是另一轮不适，归到同一段里反而误导。
     返回给每条记录的挂件：{ day: N, days: 总天数, active: 是否最近一段, isLast: 段内最后一条 }。
     故意不做「退温算结束」这种判定——那是医疗判断，不是记录软件该有的逻辑。 */
  function episodeMap(list) {
    var asc = list.slice().sort(function (a, b) { return new Date(a.time) - new Date(b.time); });
    var gapMs = 36 * 3600 * 1000;
    var segs = [];       /* 每段 = { start, count, end } */
    var cur = null;
    var prevT = null;
    asc.forEach(function (r) {
      var t = new Date(r.time).getTime();
      if (!isFinite(t)) { prevT = null; return; }   /* 坏时间戳的记录不参与分段 */
      if (!cur || (prevT != null && t - prevT > gapMs)) {
        cur = { start: t, count: 0, end: t };
        segs.push(cur);
      }
      cur.count++; cur.end = t;
      prevT = t;
    });
    /* 找活跃段（含最近一条有效记录的段） */
    var activeIdx = -1;
    var maxT = -Infinity;
    segs.forEach(function (sg, i) { if (sg.end > maxT) { maxT = sg.end; activeIdx = i; } });
    var idxByRecord = {};
    asc.forEach(function (r) {
      var t = new Date(r.time).getTime();
      if (!isFinite(t)) return;
      var seg = null;
      for (var i = 0; i < segs.length; i++) {
        if (t >= segs[i].start - 1 && t <= segs[i].end + 1) { seg = segs[i]; break; }
      }
      if (!seg) return;
      /* 第 N 天按公历日差算：同一天所有记录都是第 1 天 */
      var d0 = new Date(seg.start); d0.setHours(0, 0, 0, 0);
      var dd = new Date(t); dd.setHours(0, 0, 0, 0);
      var day = Math.round((dd.getTime() - d0.getTime()) / 86400000) + 1;
      var spans = Math.round((new Date(seg.end).setHours(0,0,0,0) - d0.getTime()) / 86400000) + 1;
      idxByRecord[r.id] = { day: day, days: spans, active: (segs.indexOf(seg) === activeIdx), count: seg.count };
    });
    return idxByRecord;
  }

  Modules.temp = {
    id: 'temp',
    title: '体温',
    render: function (view) {
      var d = Storage.get();
      var today = Util.todayISO();
      /* 第 131 次（P1-a）：「今日小结」走照护日口径（dayStart 可配，默认 0 = 公历日）——
         凌晨量的体温算前一天，和喂养/睡眠同一把尺子。 */
      var DS = Util.dayStartHour(d);
      var dayNow = Util.dayKeyOf(new Date(), DS);
      var html = '';

      html += '<div class="warn-box"><p>这里只帮你记录体温变化，<b>不能替代医疗判断</b>。' +
        '持续发热、高热不退或伴有其他症状，请及时就医。</p></div>';

      /* 记一笔：大数字 + 尺滑杆（第 41 次录入范式，替换小输入框） */
      var tState = { value: null };
      html += '<div class="card"><h2>记一次体温</h2>';
      html += '<span class="lbl-text">温度</span>';
      html += Util.rulerHTML('tRuler', { unit: '°C', label: '体温', min: 35, max: 42.5, step: 0.1, dec: 1, anchor: 36.5 });
      html += '<label>测量部位<select id="tSite">';
      SITES.forEach(function (st) {
        html += '<option value="' + st.v + '"' + (st.v === 'axillary' ? ' selected' : '') + '>'
          + st.label + (st.hint ? '（' + st.hint + '）' : '') + '</option>';
      });
      html += '</select></label>';
      html += '<label>备注（可选）<input type="text" id="tNote" maxlength="40" placeholder="如 午睡后 / 精神还行"></label>';
      html += Util.timePickHTML('tTime');
      html += '<button class="btn btn-primary btn-save" id="tSave">保存</button>';
      html += '<p class="hint">不同部位的参考值不同，记下部位，回看时才知道这几次是不是同一把尺子量出来的。</p></div>';

      /* 今日小结 */
      var todayList = (d.temps || []).filter(function (r) { return Util.dayKeyOf(r.time, DS) === dayNow; });
      /* 第 139 次：全程病程划分一次，多处复用（今日小结 + 最近记录行） */
      var epMap = episodeMap(d.temps || []);   /* id -> { day, days, active, count } */
      /* 第 89 次（审计 B4）：值缺失/非法的记录不上数值位（导入坏文件不渲染 undefined°C） */
      function okV(v) { return typeof v === 'number' && isFinite(v); }
      var vList = todayList.filter(function (r) { return okV(r.value); });
      html += '<div class="card"><h2>今日小结</h2>';
      if (vList.length) {
        var latest = vList.slice().sort(function (a, b) { return new Date(b.time) - new Date(a.time); })[0];
        var maxR = vList.slice().sort(function (a, b) { return b.value - a.value; })[0];
        html += '<ul class="kv">';
        html += '<li>最新一次：<b>' + latest.value + '°C</b>（' + Util.fmtDateTime(latest.time) + '）</li>';
        if (vList.length > 1) html += '<li>今日最高：<b>' + maxR.value + '°C</b></li>';
        html += '</ul>';
        if (maxR.value >= HIGH) {
          html += '<p class="hint">今天有 ≥' + HIGH + '°C 的记录。发热处理请遵医嘱，必要时及时就医。</p>';
        }
        /* 第 139 次：本次观察的进度（跨天才有信息量；当天第一次就结束的观察不显示） */
        var activeEp = null;
        todayList.forEach(function (r) {
          if (epMap[r.id] && epMap[r.id].active) activeEp = epMap[r.id];
        });
        if (activeEp && activeEp.days > 1) {
          html += '<p class="hint">这是<b>本次观察</b>的第 <b>' + activeEp.day + '</b> 天'
            + '（共 ' + activeEp.count + ' 次测温）。记录不判读，趋势交给医生。</p>';
        }
      } else if (todayList.length) {
        /* 今天有记录但数值全部无效（坏数据）：照常出现「有记录」位，只是不显示数值 */
        html += '<p class="hint">今天已有记录，但暂无有效数值。</p>';
      } else {
        html += '<p class="hint">今天还没有记录。平时不用天天测，发热期按需记录即可。</p>';
      }
      html += '</div>';

      /* 最近记录 */
      html += '<div class="card"><h2>最近记录</h2>';
      var list = (d.temps || []).slice().sort(function (a, b) { return new Date(b.time) - new Date(a.time); }).slice(0, 20);
      if (list.length) {
        html += '<ul class="list">';
        list.forEach(function (r) {
          var highCls = okV(r.value) && r.value >= HIGH ? ' temp-high' : '';
          var tvHtml = okV(r.value) ? (r.value + '<i>°C</i>') : '<i>—</i>'; /* 第 89 次（审计 B4）：坏值不渲染 undefined°C */
          /* 第 76 次（D 线）：行改「左时间 / 中备注 / 右温度值」双列，温度是这行的主数据 */
          var ep = epMap[r.id];
          var epBadge = (ep && ep.days > 1) ? '<span class="ep-day">第 ' + ep.day + ' 天</span>' : '';
          var st = siteOf(r.site);
          var siteTxt = st ? st.label : '';
          var sub = (epBadge ? epBadge : '') + (siteTxt ? '<span class="li-site">' + siteTxt + '</span>' : '')
            + (r.note ? Util.escapeHtml(r.note) : '');
          html += '<li><span class="row-ico">' + icon('temp') + '</span>'
            + '<span class="li-main"><b>' + Util.fmtDateTime(r.time) + '</b></span>'
            + '<span class="li-sub">' + sub + '</span>'
            + '<span class="li-num' + highCls + '">' + tvHtml + '</span>'
            + '<button class="icon-btn" data-del="' + r.id + '" aria-label="删除" title="删除">' + icon('trash') + '</button></li>';
        });
        html += '</ul>';
      } else {
        html += '<div class="empty-state"><span class="es-ico">' + icon('temp') + '</span><p>还没有体温记录</p><span class="hint">发热时记几次，就能看到变化。</span></div>';
      }
      html += '</div>';

      /* 第 59 次：医学提示（遵医嘱） */
      html += '<p class="hint med-note">体温记录仅供参考；发热或持续异常请及时就医，用药请遵医嘱。</p>';

      view.innerHTML = html;

      /* 尺滑杆：35–42.5°C，未拖动前不落库 */
      function paintTRuler() {
        Util.rulerPaint('tRuler', { min: 35, max: 42.5, step: 0.1, value: tState.value, anchor: 36.5, dec: 1, unit: '°C', label: '体温' });
      }
      var tRange = view.querySelector('#tRulerRange');
      if (tRange) tRange.addEventListener('input', function () {
        tState.value = Math.round(parseFloat(tRange.value) * 10) / 10;
        paintTRuler();
      });
      var tMinus = view.querySelector('#tRulerMinus');
      if (tMinus) tMinus.addEventListener('click', function () {
        tState.value = Math.round(((tState.value != null ? tState.value : 36.5) - 0.1) * 10) / 10;
        paintTRuler();
      });
      var tPlus = view.querySelector('#tRulerPlus');
      if (tPlus) tPlus.addEventListener('click', function () {
        tState.value = Math.round(((tState.value != null ? tState.value : 36.5) + 0.1) * 10) / 10;
        paintTRuler();
      });
      paintTRuler();

      view.querySelector('#tSave').addEventListener('click', function () {
        if (tState.value == null) { Util.toast('请先拖动滑杆（或点 ＋/−）设置体温', 'warn'); return; }
        var tStamp = Util.stampFrom(view, 'tTime');
        if (!tStamp) return;
        var rec = {
          id: Util.uid(), time: tStamp, value: tState.value,
          site: (view.querySelector('#tSite').value || 'axillary'),
          note: (view.querySelector('#tNote').value || '').trim() || null
        };
        d.temps.push(rec);
        if (Storage.save()) {
          var st = siteOf(rec.site);
          Util.toast('已记录体温 ' + rec.value + '°C' + (st ? '（' + st.label + '）' : ''), 'ok');
        }
        global.App.rerender();
      });
      Array.prototype.forEach.call(view.querySelectorAll('[data-del]'), function (b) {
        b.addEventListener('click', function () {
          Util.removeWithUndo(d.temps, b.getAttribute('data-del'), {
            onSave: function () { Storage.save(); },
            onAfter: function () { global.App.rerender(); },
            deletedText: '已删除体温记录'
          });
        });
      });
    }
  };
})(window);
