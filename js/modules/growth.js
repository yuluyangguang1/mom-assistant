/**
 * growth.js - 称重 / 生长曲线
 * 记录体重/身高/头围；按 WHO/CDC 标准中位数近似计算百分位（简化插值）；
 * 支持早产儿矫正月龄（Fenton 近似）；强调"看趋势不看单次"。
 */
(function (global) {
  'use strict';
  var Storage = global.Storage, Util = global.Util;
  var Modules = global.Modules = global.Modules || {};

  // 月龄节点
  var MONTHS = [0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 18, 21, 24, 30, 36, 42, 48, 54, 60];

  // WHO 中位数（50th）近似值：男/女 的 体重(kg)/身长(cm)/头围(cm)
  var WHO = {
    boy: {
      weight: [3.3, 4.5, 5.6, 6.4, 7.0, 7.5, 7.9, 8.6, 9.2, 9.6, 10.3, 10.9, 11.4, 11.9, 12.9, 13.9, 14.9, 15.8, 16.8, 17.8],
      length: [49.9, 54.7, 58.4, 61.4, 63.9, 65.9, 67.6, 70.6, 73.3, 75.7, 79.6, 82.9, 85.9, 88.5, 94.7, 100.2, 105.0, 109.4, 113.6, 117.5],
      head: [34.5, 37.6, 39.6, 41.0, 42.1, 43.0, 43.8, 45.1, 46.0, 46.7, 47.4, 48.0, 48.4, 48.8, 49.5, 50.1, 50.6, 51.0, 51.3, 51.5]
    },
    girl: {
      weight: [3.2, 4.2, 5.1, 5.8, 6.4, 6.9, 7.3, 7.9, 8.5, 8.9, 9.6, 10.2, 10.6, 11.1, 12.1, 13.1, 14.0, 14.9, 15.8, 16.7],
      length: [49.1, 53.7, 57.1, 59.8, 62.1, 64.0, 65.7, 68.5, 71.1, 73.5, 77.1, 80.3, 83.2, 85.7, 91.5, 96.7, 101.3, 105.6, 109.6, 113.4],
      head: [33.9, 36.8, 38.6, 39.9, 41.0, 41.9, 42.6, 43.9, 44.8, 45.5, 46.1, 46.8, 47.2, 47.6, 48.3, 48.9, 49.4, 49.8, 50.1, 50.3]
    }
  };
  // 相对标准差系数（用于由中位数估算离散度）
  var SD = { weight: 0.12, length: 0.035, head: 0.030 };

  function normCdf(z) {
    var t = 1 / (1 + 0.2316419 * Math.abs(z));
    var d = 0.3989423 * Math.exp(-z * z / 2);
    var p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return z > 0 ? 1 - p : p;
  }

  // 线性插值取某月龄的中位数
  function interp(arr, age) {
    if (age <= MONTHS[0]) return arr[0];
    if (age >= MONTHS[MONTHS.length - 1]) return arr[arr.length - 1];
    for (var i = 1; i < MONTHS.length; i++) {
      if (age <= MONTHS[i]) {
        var r = (age - MONTHS[i - 1]) / (MONTHS[i] - MONTHS[i - 1]);
        return arr[i - 1] + (arr[i] - arr[i - 1]) * r;
      }
    }
    return arr[arr.length - 1];
  }

  function percentile(metric, sex, ageMonths, value) {
    var sexK = (sex === 'girl') ? 'girl' : 'boy';
    var med = interp(WHO[sexK][metric], ageMonths);
    if (!med) return null;
    var sd = med * SD[metric];
    var z = (value - med) / sd;
    return Math.round(normCdf(z) * 100);
  }

  function correctedAge(baby, ageMonths) {
    if (baby && baby.preterm && baby.birthGestWeeks) {
      var gapWeeks = 40 - parseInt(baby.birthGestWeeks, 10);
      if (gapWeeks > 0) {
        var corr = ageMonths - gapWeeks * 7 / 30.44;
        return corr > 0 ? corr : 0;
      }
    }
    return ageMonths;
  }

  Modules.growth = {
    id: 'growth',
    title: '生长',
    render: function (view) {
      var d = Storage.get();
      var baby = d.settings.baby || { sex: 'boy', birthDate: null, preterm: false, birthGestWeeks: 40 };
      var html = '';

      html += '<div class="card"><h2>宝宝信息</h2>';
      html += '<div class="seg" id="bSex">';
      html += '<button type="button" class="seg-btn' + (baby.sex !== 'girl' ? ' active' : '') + '" data-s="boy">男</button>';
      html += '<button type="button" class="seg-btn' + (baby.sex === 'girl' ? ' active' : '') + '" data-s="girl">女</button>';
      html += '</div>';
      html += '<label>出生日期<input type="date" id="bBirth" value="' + (baby.birthDate || '') + '"></label>';
      html += '<label class="chk"><input type="checkbox" id="bPreterm"' + (baby.preterm ? ' checked' : '') + '> 早产儿（需矫正月龄）</label>';
      html += '<label id="lblGest">出生孕周（周）<input type="number" id="bGest" min="22" max="39" value="' + (baby.birthGestWeeks || 36) + '"></label>';
      html += '<button class="btn" id="bSave">保存宝宝信息</button>';
      html += '<p class="hint">生长曲线按 WHO/CDC 标准中位数近似计算百分位，仅供趋势参考。</p></div>';

      html += '<div class="card"><h2>' + icon('growth') + '记录一次测量</h2>';
      html += '<label>日期<input type="date" id="gDate" value="' + Util.todayISO() + '"></label>';
      html += '<label>体重 (kg)<input type="number" step="0.01" id="gW" placeholder="如 6.4"></label>';
      html += '<label>身长/身高 (cm)<input type="number" step="0.1" id="gH" placeholder="如 62"></label>';
      html += '<label>头围 (cm)<input type="number" step="0.1" id="gC" placeholder="如 41"></label>';
      html += '<button class="btn btn-primary" id="gSave">保存</button></div>';

      var recs = d.growth.slice().sort(function (a, b) { return new Date(a.date) - new Date(b.date); });
      if (recs.length) {
        html += '<div class="card"><h2>记录与百分位</h2><ul class="list">';
        recs.slice().reverse().forEach(function (r) {
          var age = baby.birthDate ? Util.daysBetween(baby.birthDate, r.date) / 30.44 : (r.ageMonths || 0);
          var cAge = correctedAge(baby, age);
          var pw = r.weightKg != null ? percentile('weight', baby.sex, cAge, r.weightKg) : null;
          var ph = r.heightCm != null ? percentile('length', baby.sex, cAge, r.heightCm) : null;
          var pc = r.headCm != null ? percentile('head', baby.sex, cAge, r.headCm) : null;
          html += '<li>' + icon('growth') + '<span>' + Util.fmtDate(r.date) + ' （' + age.toFixed(1) + '月' +
            (baby.preterm ? '，矫正' + cAge.toFixed(1) + '月' : '') + '）<br>' +
            (r.weightKg != null ? '体重 ' + r.weightKg + 'kg P' + (pw != null ? pw : '-') + ' ｜ ' : '') +
            (r.heightCm != null ? '身长 ' + r.heightCm + 'cm P' + (ph != null ? ph : '-') + ' ｜ ' : '') +
            (r.headCm != null ? '头围 ' + r.headCm + 'cm P' + (pc != null ? pc : '-') : '') +
            '</span><button class="icon-btn" data-del="' + r.id + '" aria-label="删除" title="删除">' + icon('trash') + '</button></li>';
        });
        html += '</ul>';
        /* 曲线支持三指标切换（体重/身长/头围），默认体重 */
        html += '<div class="seg" id="gMetric">'
          + '<button type="button" class="seg-btn active" data-m="weight">体重</button>'
          + '<button type="button" class="seg-btn" data-m="length">身长</button>'
          + '<button type="button" class="seg-btn" data-m="head">头围</button></div>';
        html += '<div id="gChartBox">' + growthChart(recs, baby, 'weight') + '</div>';
        html += '<p class="warn">看趋势、看长期，单次数值不必焦虑。曲线为简化近似，非严格医学评估。</p></div>';
      } else {
        html += '<div class="card"><p class="hint">还没有测量记录。记录后可显示百分位与趋势曲线。</p></div>';
      }

      view.innerHTML = html;

      Array.prototype.forEach.call(view.querySelectorAll('#bSex .seg-btn'), function (b) {
        b.addEventListener('click', function () {
          Array.prototype.forEach.call(view.querySelectorAll('#bSex .seg-btn'), function (x) { x.classList.remove('active'); });
          b.classList.add('active');
        });
      });
      view.querySelector('#bPreterm').addEventListener('change', function () {
        view.querySelector('#lblGest').style.display = this.checked ? '' : 'none';
      });
      view.querySelector('#lblGest').style.display = baby.preterm ? '' : 'none';

      view.querySelector('#bSave').addEventListener('click', function () {
        d.settings.baby = {
          sex: view.querySelector('#bSex .active').getAttribute('data-s'),
          birthDate: view.querySelector('#bBirth').value || null,
          preterm: view.querySelector('#bPreterm').checked,
          birthGestWeeks: parseInt(view.querySelector('#bGest').value, 10) || 36
        };
        Storage.save(); global.App.rerender();
      });
      /* 曲线指标切换：体重/身长/头围（只重绘图表，不整页刷新） */
      Array.prototype.forEach.call(view.querySelectorAll('#gMetric .seg-btn'), function (b) {
        b.addEventListener('click', function () {
          Array.prototype.forEach.call(view.querySelectorAll('#gMetric .seg-btn'), function (x) { x.classList.remove('active'); });
          b.classList.add('active');
          view.querySelector('#gChartBox').innerHTML = growthChart(recs, baby, b.getAttribute('data-m'));
        });
      });

      view.querySelector('#gSave').addEventListener('click', function () {
        var date = view.querySelector('#gDate').value;
        var w = view.querySelector('#gW').value;
        var h = view.querySelector('#gH').value;
        var c = view.querySelector('#gC').value;
        if (!date) { Util.markInvalid(view.querySelector('#gDate'), '请填写日期'); return; }
        if (w === '' && h === '' && c === '') { Util.markInvalid([view.querySelector('#gW'), view.querySelector('#gH'), view.querySelector('#gC')], '请至少填写体重/身长/头围中的一项'); return; }
        d.growth.push({
          id: Util.uid(), date: date,
          weightKg: w !== '' ? parseFloat(w) : null,
          heightCm: h !== '' ? parseFloat(h) : null,
          headCm: c !== '' ? parseFloat(c) : null
        });
        Storage.save(); global.App.rerender();
      });
      Array.prototype.forEach.call(view.querySelectorAll('[data-del]'), function (b) {
        b.addEventListener('click', function () {
          var id = b.getAttribute('data-del');
          Util.removeWithUndo(d.growth, id, {
            onSave: function () { Storage.save(); },
            onAfter: function () { global.App.rerender(); },
            deletedText: '已删除测量记录'
          });
        });
      });
    }
  };

  // 简化 SVG 曲线：宝宝某项指标 vs WHO 中位数曲线（metric: weight/length/head）
  var METRIC_FIELD = { weight: 'weightKg', length: 'heightCm', head: 'headCm' };
  var METRIC_UNIT = { weight: 'kg', length: 'cm', head: 'cm' };
  var METRIC_NAME = { weight: '体重', length: '身长', head: '头围' };
  function growthChart(recs, baby, metric) {
    metric = metric || 'weight';
    if (!baby.birthDate) return '<p class="hint">设置出生日期后可生成曲线。</p>';
    var sexK = (baby.sex === 'girl') ? 'girl' : 'boy';
    var field = METRIC_FIELD[metric];
    var pts = recs.map(function (r) {
      var age = Util.daysBetween(baby.birthDate, r.date) / 30.44;
      return { age: age, w: r[field] };
    }).filter(function (p) { return p.w != null; });
    if (!pts.length) return '<p class="hint">暂无' + METRIC_NAME[metric] + '数据，记录后可生成曲线。</p>';
    var W = 300, H = 160, pad = 28;
    var ages = pts.map(function (p) { return p.age; });
    var maxAge = Math.max.apply(null, ages);
    if (maxAge < 0.5) maxAge = 0.5;
    var maxW = Math.max.apply(null, pts.map(function (p) { return p.w; }).concat([WHO[sexK][metric][0]]));
    function X(age) { return pad + (W - 2 * pad) * (age / maxAge); }
    function Y(w) { return H - pad - (H - 2 * pad) * (w / (maxW * 1.2)); }
    var med = MONTHS.map(function (m) { return { x: X(m), y: Y(interp(WHO[sexK][metric], m)) }; });
    var medPath = med.map(function (p, i) { return (i ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1); }).join(' ');
    var babyPath = pts.map(function (p, i) { return (i ? 'L' : 'M') + X(p.age).toFixed(1) + ' ' + Y(p.w).toFixed(1); }).join(' ');
    var dots = pts.map(function (p) { return '<circle cx="' + X(p.age).toFixed(1) + '" cy="' + Y(p.w).toFixed(1) + '" r="3"></circle>'; }).join('');
    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="160">' +
      '<line x1="' + pad + '" y1="' + (H - pad) + '" x2="' + (W - pad) + '" y2="' + (H - pad) + '" stroke="#999"></line>' +
      '<line x1="' + pad + '" y1="' + pad + '" x2="' + pad + '" y2="' + (H - pad) + '" stroke="#999"></line>' +
      '<path d="' + medPath + '" stroke="#3a9a7a" fill="none" stroke-dasharray="4 3"></path>' +
      '<path d="' + babyPath + '" stroke="#2f6fed" fill="none"></path>' + dots +
      '<text x="' + (W - pad) + '" y="' + (H - 6) + '" font-size="9" text-anchor="end" fill="#666">月龄→</text>' +
      '<text x="4" y="' + (pad + 8) + '" font-size="9" fill="#666">↑' + METRIC_UNIT[metric] + '</text>' +
      '</svg><p class="hint">虚线：WHO ' + METRIC_NAME[metric] + '中位数曲线；实线：宝宝' + METRIC_NAME[metric] + '。</p>';
  }
})(window);
