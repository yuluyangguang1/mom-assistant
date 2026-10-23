/**
 * jaundice.js - 黄疸记录（第 132 次 · 对标 Cali 21 工具里的 jaundice-tracker）
 *
 * 定位：新生儿黄疸是「必须交给医生判断」的典型场景，这个页面只做两件事——
 *   1. 把每次测的数值留下来，方便复诊时给医生看趋势；
 *   2. 把「哪些情况要立刻就医」写清楚。
 * **不做的事**：不给阈值判读、不区分生理性/病理性、不建议晒太阳退黄。
 * 经皮测黄仪的读数受部位、肤色、日龄影响，任何「你这数值危险/安全」的结论都不该由本工具下。
 * 数据：d.jaundices = [{ id, time, value, unit, site, note }]，unit ∈ mgdl/umol。
 */
(function (global) {
  'use strict';
  var Storage = global.Storage, Util = global.Util;
  var Modules = global.Modules = global.Modules || {};

  var UNITS = [
    { v: 'mgdl', label: 'mg/dL', max: 30, step: '0.1' },
    { v: 'umol', label: 'µmol/L', max: 500, step: '1' }
  ];
  var SITES = [
    { v: 'forehead', label: '额头' },
    { v: 'cheek', label: '脸颊' },
    { v: 'chest', label: '胸口' }
  ];

  function unitLabel(v) {
    for (var i = 0; i < UNITS.length; i++) if (UNITS[i].v === v) return UNITS[i].label;
    return 'mg/dL';
  }
  function siteLabel(v) {
    for (var i = 0; i < SITES.length; i++) if (SITES[i].v === v) return SITES[i].label;
    return '';
  }

  Modules.jaundice = {
    id: 'jaundice',
    title: '黄疸',
    render: function (view) {
      var d = Storage.get();
      var all = d.jaundices || [];
      var html = '';

      html += '<div class="warn-box"><p><b>黄疸要由医生评估，这个页面只帮你留记录。</b>' +
        '出现下列任一情况请立即就医：出生 24 小时内就出现黄疸、黄到手心脚心、' +
        '精神差或吃奶明显变少、哭声尖、大便发白、体温异常。</p></div>';

      html += '<div class="card"><h2>记一次测量</h2>';
      html += '<label>数值<input type="number" id="jaVal" min="0" max="500" step="0.1" ' +
        'inputmode="decimal" placeholder="如 12.5"></label>';
      html += '<label>单位<select id="jaUnit">';
      UNITS.forEach(function (u) { html += '<option value="' + u.v + '">' + u.label + '</option>'; });
      html += '</select></label>';
      html += '<label>测量部位<select id="jaSite">';
      SITES.forEach(function (s) { html += '<option value="' + s.v + '">' + s.label + '</option>'; });
      html += '</select></label>';
      html += '<label>备注（可选）<input type="text" id="jaNote" maxlength="40" ' +
        'placeholder="如 社区医院测的 / 出生第 5 天"></label>';
      html += '<button class="btn btn-primary btn-save" id="jaSave">保存</button>';
      html += '<p class="hint">1 mg/dL ≈ 17.1 µmol/L。不同医院报告单位不同，按报告上的单位填即可，' +
        '本工具不做换算后的判读。</p></div>';

      /* 最近值 + 较上次变化（只描述数值方向，不解释含义） */
      var sorted = all.slice().sort(function (a, b) { return new Date(b.time) - new Date(a.time); });
      var last = sorted[0];
      var prev = sorted[1];

      html += '<div class="card"><h2>最近一次</h2>';
      if (last && typeof last.value === 'number' && isFinite(last.value)) {
        html += '<div class="fetal-hero"><span class="stat-num">' + last.value +
          '<i class="stat-unit">' + unitLabel(last.unit) + '</i></span>';
        var sub = Util.fmtDateTime(last.time) + (siteLabel(last.site) ? ' · ' + siteLabel(last.site) : '');
        if (prev && typeof prev.value === 'number' && isFinite(prev.value) && prev.unit === last.unit) {
          var diff = Math.round((last.value - prev.value) * 10) / 10;
          sub += ' · 较上次 ' + (diff > 0 ? '+' : '') + diff;
        }
        html += '<span class="hint">' + sub + '</span></div>';
        html += '<p class="hint">数值高低本身不能说明问题——要不要处理，请拿这份记录问医生。</p>';
      } else {
        html += '<p class="hint">还没有测量记录。复诊时把每次的数值给医生看，比只记「黄不黄」有用得多。</p>';
      }
      html += '</div>';

      html += '<div class="card"><h2>最近记录</h2>';
      var list = sorted.slice(0, 20);
      if (list.length) {
        html += '<ul class="list">';
        list.forEach(function (r) {
          html += '<li><span class="row-ico">' + icon('jaundice') + '</span>'
            + '<span class="li-main"><b>' + Util.fmtDateTime(r.time) + '</b></span>'
            + '<span class="li-sub">' + (siteLabel(r.site) ? siteLabel(r.site) + ' ' : '') +
            (r.note ? Util.escapeHtml(r.note) : '') + '</span>'
            + '<span class="li-num">' + (typeof r.value === 'number' && isFinite(r.value)
              ? r.value + '<i>' + unitLabel(r.unit) + '</i>' : '<i>—</i>') + '</span>'
            + '<button class="icon-btn" data-del="' + r.id + '" aria-label="删除" title="删除">' +
            icon('trash') + '</button></li>';
        });
        html += '</ul>';
      } else {
        html += '<div class="empty-state"><span class="es-ico">' + icon('jaundice') + '</span><p>还没有黄疸记录</p><span class="hint">测一次就记一次。</span></div>';
      }
      html += '</div>';

      html += '<p class="hint med-note">黄疸记录仅供参考；是否需光疗、何时复查，一律以医生判断为准。</p>';

      view.innerHTML = html;

      view.querySelector('#jaSave').addEventListener('click', function () {
        var el = view.querySelector('#jaVal');
        var v = parseFloat(el.value);
        var unit = view.querySelector('#jaUnit').value || 'mgdl';
        var max = (unit === 'umol') ? 500 : 30;
        if (!isFinite(v) || v < 0 || v > max) {
          Util.markInvalid(el, '请填 0–' + max + ' 之间的数值（单位 ' + unitLabel(unit) + '）');
          return;
        }
        var rec = {
          id: Util.uid(), time: Util.nowLocal(),
          value: Math.round(v * 10) / 10, unit: unit,
          site: view.querySelector('#jaSite').value || 'forehead',
          note: (view.querySelector('#jaNote').value || '').trim() || null
        };
        d.jaundices.push(rec);
        if (Storage.save()) Util.toast('已记录 ' + rec.value + ' ' + unitLabel(rec.unit), 'ok');
        global.App.rerender();
      });

      Array.prototype.forEach.call(view.querySelectorAll('[data-del]'), function (b) {
        b.addEventListener('click', function () {
          Util.removeWithUndo(d.jaundices, b.getAttribute('data-del'), {
            onSave: function () { Storage.save(); },
            onAfter: function () { global.App.rerender(); },
            deletedText: '已删除黄疸记录'
          });
        });
      });
    }
  };
})(window);
