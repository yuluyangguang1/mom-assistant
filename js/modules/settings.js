/**
 * settings.js - 设置（全局必备）
 * 导出/导入全部数据、清空数据、关于说明。
 */
(function (global) {
  'use strict';
  var Storage = global.Storage, Util = global.Util;
  var Modules = global.Modules = global.Modules || {};

  Modules.settings = {
    id: 'settings',
    title: '设置',
    render: function (view) {
      var s = Storage.get();
      var html = '';
      html += '<div class="page-head"><h1>设置</h1></div>';
      html += '<div class="card"><h2>' + icon('export') + '数据</h2>';
      /* 上次备份时间：纯本地应用的生命线提示 */
      var last = s.settings.lastExportISO;
      var backupInfo = last ? ('上次备份：' + last) : '还没有备份过数据';
      html += '<p class="hint">' + Util.escapeHtml(backupInfo) + (last ? '' : '，强烈建议现在导出一次。') + '</p>';
      html += '<button class="btn btn-primary" id="sExport">导出全部数据（JSON）</button>';
      html += '<p class="hint">换机或交接时，先导出备份，再在新设备导入。</p>';
      html += '<button class="btn" id="sImport">导入全部数据（JSON）</button>';
      html += '<p class="hint">导入会覆盖当前全部数据，请确认。</p>';
      html += '<button class="btn btn-danger" id="sReset">清空全部数据</button></div>';

      /* CSV 导出（Excel 可读，带 BOM）+ 打印报告（儿保体检给医生看） */
      html += '<div class="card"><h2>' + icon('export') + '导出与打印</h2>';
      html += '<div class="row"><select id="sCsvModule" style="flex:1">'
        + '<option value="feedings">喂养记录</option><option value="sleeps">睡眠记录</option>'
        + '<option value="diapers">尿布记录</option><option value="meds">吃药/维D记录</option>'
        + '<option value="growth">生长记录</option><option value="milestones">里程碑</option>'
        + '<option value="vaccines">疫苗接种</option><option value="contractions">宫缩记录</option>'
        + '<option value="periods">经期记录</option><option value="finance">记账记录</option>'
        + '</select><button class="btn" id="sCsv">导出 CSV</button></div>';
      html += '<p class="hint">CSV 可用 Excel / WPS 直接打开，适合整理归档。</p>';
      html += '<button class="btn" id="sPrint">打印成长报告</button>';
      html += '<p class="hint">生成一页式汇总（宝宝信息、生长、疫苗、近期喂养/尿布统计），可直接打印或另存 PDF 带给医生。</p></div>';


      /* 数据统计：各模块记录数一目了然，导出前确认数据完整 */
      var stats = Storage.stats();
      html += '<div class="card"><h2>' + icon('settings') + '数据统计</h2><ul class="kv">';
      stats.forEach(function (t) {
        html += '<li data-accent="' + t.key + '"><b>' + t.count + '</b> 条 ' + t.name + '</li>';
      });
      html += '</ul></div>';

      html += '<div class="card"><h2>' + icon('settings') + '外观</h2>';
      html += '<div class="row-switch"><label for="sRefract">真实玻璃折射</label>' +
        '<input type="checkbox" id="sRefract"' + (s.settings.realRefraction !== false ? ' checked' : '') + '></div>';
      html += '<p class="hint">开启后，玻璃卡片会折射背后的背景（更逼真的液态玻璃）。低端设备若出现卡顿可关闭。</p></div>';

      html += '<div class="card"><h2>' + icon('settings') + '关于</h2>';
      html += '<p>宝妈助手 · 本地优先纯工具原型</p>';
      html += '<p class="hint">无账号、无云、无广告、无社区、无推送。所有数据仅存本机浏览器。</p>';
      html += '<p class="hint">健康数据仅供参考，重要判断请遵医嘱。</p></div>';

      view.innerHTML = html;
      view.querySelector('#sExport').addEventListener('click', function () { global.App.exportAll(); });
      view.querySelector('#sImport').addEventListener('click', function () { global.App.importAll(); });
      view.querySelector('#sReset').addEventListener('click', function () { global.App.resetAll(); });
      var refr = view.querySelector('#sRefract');
      if (refr) refr.addEventListener('change', function () {
        var st = Storage.get();
        st.settings.realRefraction = refr.checked;
        Storage.save();
        if (global.Glass) global.Glass.setEnabled(refr.checked);
      });

      /* ---- CSV 导出（Excel/WPS 可读，带 BOM） ---- */
      function csvCell(v) {
        if (v == null) return '';
        v = String(v);
        return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
      }
      function toCsv(header, rows) {
        var lines = [header.map(csvCell).join(',')];
        rows.forEach(function (r) { lines.push(r.map(csvCell).join(',')); });
        return '﻿' + lines.join('\r\n');
      }
      var FEED_T = { breast: '母乳', bottle: '奶瓶', solid: '辅食' };
      var SIDE_T = { left: '左', right: '右', both: '双侧' };
      var DIAPER_T = { pee: '尿', poop: '便', both: '尿+便' };
      var CSV_BUILDERS = {
        feedings: function (d) {
          return toCsv(['开始时间', '类型', '侧别', '时长(分)', '量(ml/g)', '备注'],
            (d.feedings || []).map(function (r) {
              return [r.start, FEED_T[r.type] || r.type, SIDE_T[r.side] || '', r.duration || '', r.amount || '', r.note];
            }));
        },
        sleeps: function (d) {
          return toCsv(['开始', '结束', '时长'], (d.sleeps || []).map(function (r) {
            return [r.start, r.end || '', r.end ? Util.fmtDuration(new Date(r.end) - new Date(r.start) - (r.pausedMs || 0)) : ''];
          }));
        },
        diapers: function (d) {
          return toCsv(['时间', '类型', '备注'], (d.diapers || []).map(function (r) {
            return [r.time, DIAPER_T[r.type] || r.type, r.note];
          }));
        },
        meds: function (d) {
          return toCsv(['时间', '名称', '备注'], (d.meds || []).map(function (r) { return [r.time, r.name, r.note]; }));
        },
        growth: function (d) {
          return toCsv(['日期', '体重(kg)', '身长(cm)', '头围(cm)'], (d.growth || []).map(function (r) {
            return [r.date, r.weightKg, r.heightCm, r.headCm];
          }));
        },
        milestones: function (d) {
          return toCsv(['日期', '里程碑', '备注'], (d.milestones || []).map(function (r) { return [r.date, r.title, r.note]; }));
        },
        vaccines: function (d) {
          var rows = [];
          var plan = (global.Modules && Modules.vaccine && typeof Modules.vaccine._plan === 'function'
            && d.settings.baby && d.settings.baby.birthDate) ? Modules.vaccine._plan(d.settings.baby.birthDate) : [];
          var done = (d.vaccines && d.vaccines.done) || {};
          plan.forEach(function (it) { rows.push([it.name + it.dose, it.dueISO, done[it.key] || '未接种']); });
          return toCsv(['疫苗剂次', '应种日期', '接种日期'], rows);
        },
        contractions: function (d) {
          return toCsv(['开始', '结束'], (d.contractions || []).map(function (r) { return [r.start, r.end || '']; }));
        },
        periods: function (d) {
          return toCsv(['开始', '结束'], (d.periods || []).map(function (r) { return [r.start, r.end || '']; }));
        },
        finance: function (d) {
          var recs = (d.finance && d.finance.records) || [];
          return toCsv(['日期', '类目', '金额', '备注'], recs.map(function (r) { return [r.date, r.category, r.amount, r.note]; }));
        }
      };
      view.querySelector('#sCsv').addEventListener('click', function () {
        var key = view.querySelector('#sCsvModule').value;
        var csv = CSV_BUILDERS[key](Storage.get());
        var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = '宝妈助手_' + key + '_' + Util.todayISO() + '.csv';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
        Util.toast('CSV 已导出', 'ok');
      });

      /* ---- 打印成长报告：新窗口生成一页式汇总并唤起打印 ---- */
      view.querySelector('#sPrint').addEventListener('click', function () {
        var d = Storage.get();
        var baby = (d.settings && d.settings.baby) || {};
        var w = global.open('', '_blank');
        if (!w) { Util.toast('浏览器拦截了弹窗，请允许后重试', 'error'); return; }
        var body = '<h1>宝宝成长报告</h1><p class="sub">宝妈助手 · 生成于 ' + Util.nowLocal().slice(0, 16).replace('T', ' ') + '</p>';
        body += '<h2>宝宝信息</h2><p>性别：' + (baby.sex === 'girl' ? '女' : (baby.sex === 'boy' ? '男' : '未设置'))
          + ' ｜ 出生日期：' + (baby.birthDate || '未设置')
          + (baby.preterm ? ' ｜ 早产（孕 ' + (baby.birthGestWeeks || '?') + ' 周）' : '') + '</p>';
        var gr = (d.growth || []).slice().sort(function (a, b) { return (a.date || '').localeCompare(b.date || ''); });
        body += '<h2>生长记录（' + gr.length + ' 次）</h2>';
        if (gr.length) {
          body += '<table><tr><th>日期</th><th>体重 kg</th><th>身长 cm</th><th>头围 cm</th></tr>';
          gr.forEach(function (r) {
            body += '<tr><td>' + r.date + '</td><td>' + (r.weightKg || '') + '</td><td>' + (r.heightCm || '') + '</td><td>' + (r.headCm || '') + '</td></tr>';
          });
          body += '</table>';
        } else body += '<p>暂无记录</p>';
        if (global.Modules && Modules.vaccine && typeof Modules.vaccine._plan === 'function' && baby.birthDate) {
          var plan = Modules.vaccine._plan(baby.birthDate);
          var done = (d.vaccines && d.vaccines.done) || {};
          var doneN = plan.filter(function (it) { return done[it.key]; }).length;
          body += '<h2>疫苗接种（' + doneN + '/' + plan.length + ' 剂）</h2><table><tr><th>剂次</th><th>应种</th><th>接种日期</th></tr>';
          plan.forEach(function (it) {
            body += '<tr><td>' + it.name + it.dose + '</td><td>' + it.dueISO + '</td><td>' + (done[it.key] || '未接种') + '</td></tr>';
          });
          body += '</table>';
        }
        var cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30);
        var feeds = (d.feedings || []).filter(function (r) { return r.start && new Date(r.start) >= cutoff; });
        var dias = (d.diapers || []).filter(function (r) { return r.time && new Date(r.time) >= cutoff; });
        body += '<h2>近 30 天日常</h2><p>喂养 ' + feeds.length + ' 次 ｜ 换尿布 ' + dias.length + ' 次</p>';
        body += '<p class="foot">本报告数据来自本地记录，仅供参考，具体请遵医嘱。</p>';
        w.document.write('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>成长报告</title>'
          + '<style>body{font-family:system-ui,"Microsoft YaHei",sans-serif;max-width:640px;margin:24px auto;padding:0 16px;color:#333}'
          + 'h1{font-size:22px}h2{font-size:15px;border-left:3px solid #4FA8A0;padding-left:8px;margin-top:20px}'
          + 'table{border-collapse:collapse;width:100%;font-size:13px}td,th{border:1px solid #ccc;padding:4px 8px;text-align:left}'
          + '.sub,.foot{color:#888;font-size:12px}@media print{body{margin:0}}</style></head><body>' + body + '</body></html>');
        w.document.close();
        w.focus();
        setTimeout(function () { w.print(); }, 300);
      });
    }
  };
})(window);
