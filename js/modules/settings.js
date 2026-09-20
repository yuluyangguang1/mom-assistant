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
      html += '<button class="btn btn-primary" id="sExport">导出全部数据（JSON）</button>';
      html += '<p class="hint">换机或交接时，先导出备份，再在新设备导入。</p>';
      html += '<button class="btn" id="sImport">导入全部数据（JSON）</button>';
      html += '<p class="hint">导入会覆盖当前全部数据，请确认。</p>';
      html += '<button class="btn btn-danger" id="sReset">清空全部数据</button></div>';

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
    }
  };
})(window);
