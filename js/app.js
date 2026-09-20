/**
 * app.js - 应用入口
 * 负责：底部 Tab 切换、主题（夜间模式）、首次隐私告知、导出/导入、初始化。
 * 必须最后加载（依赖各模块的 Modules 注册）。
 */
(function (global) {
  'use strict';
  var Storage = global.Storage;
  var Util = global.Util;
  var Modules = global.Modules = global.Modules || {};

  // 底部导航栏只保留 2 个主入口；其余 8 个功能统一在「首页-全部功能」网格中一键直达（2026-09-19 精简）
  var TABS = [
    { id: 'home', title: '首页' },
    { id: 'calendar', title: '日期记录' }
  ];

  var current = 'home';

  function buildTabbar() {
    var bar = document.getElementById('tabbar');
    bar.innerHTML = '';
    TABS.forEach(function (t) {
      var b = document.createElement('button');
      b.className = 'tab' + (t.id === current ? ' active' : '');
      b.type = 'button';
      b.innerHTML = icon(t.id) + '<span>' + t.title + '</span>';
      b.setAttribute('data-tab', t.id);
      b.addEventListener('click', function () { showTab(t.id); });
      bar.appendChild(b);
    });
  }

  /* 顶栏玻璃化策略：
     - 首页（天空 hero）：默认透明，滚动 >8px 后补实色底（为天空让路）
     - 模块页：始终实色（无天空，透明顶栏会让「页头标题」上方露出 66px 空白带，
       且内容滚动时会从透明顶栏下方穿过造成重叠）
     奶油风下实色顶栏与卡片同源，视觉一体。 */
  function syncHeader() {
    var header = document.querySelector('.app-header');
    if (!header) return;
    if (current !== 'home') { header.classList.add('is-scrolled'); return; }
    var y = window.pageYOffset || (document.documentElement && document.documentElement.scrollTop) || 0;
    if (y > 8) header.classList.add('is-scrolled');
    else header.classList.remove('is-scrolled');
  }

  function showTab(id) {
    if (!Modules[id]) return;
    current = id;
    buildTabbar();
    var view = document.getElementById('view');
    view.innerHTML = '';
    /* 模块页「分色身份」：给记录类模块页打 data-accent，让列表/图标/标题继承其柔彩色；
       首页（多模块聚合）与日历（自带 per-row 分色）必须清除，避免串色。 */
    if (id === 'home' || id === 'calendar') view.removeAttribute('data-accent');
    else view.setAttribute('data-accent', id);
    try {
      Modules[id].render(view);
    } catch (e) {
      view.innerHTML = '<div class="card"><p>加载出错：' + Util.escapeHtml(e && e.message ? e.message : e) + '</p></div>';
    }
    /* 模块页身份页头：记录类模块页（非首页/日历/设置）自动补一行「图标 + 标题」，
       让进入模块第一眼就有身份感，消除「顶部无标题」的空白。设置页已有 .page-head，不重复。 */
    if (id !== 'home' && id !== 'calendar' && id !== 'settings' && Modules[id] && Modules[id].title) {
      var head = document.createElement('div');
      head.className = 'mod-head';
      head.setAttribute('data-accent', id);
      head.innerHTML = '<span class="mod-head-ico">' + icon(id) + '</span><h1>' + Util.escapeHtml(Modules[id].title) + '</h1>';
      view.insertBefore(head, view.firstChild);
    }
    // 进入动画：移除并重排后添加 .view-enter，触发卡片错落淡入（克制，<400ms）
    view.classList.remove('view-enter');
    void view.offsetWidth;
    view.classList.add('view-enter');
    // 进度条宽度过渡（从 0 动画到目标值）
    Array.prototype.forEach.call(view.querySelectorAll('.progress-bar'), function (bar) {
      var target = bar.style.width || '0%';
      bar.style.width = '0%';
      void bar.offsetWidth;
      bar.style.width = target;
    });
    window.scrollTo(0, 0);
    syncHeader(); /* 切页回到顶部，顶栏同步复位为透明 */
    if (global.Glass) global.Glass.wake(); /* 折射层：重绘场景并刷新各玻璃面 */
  }

  function rerender() { showTab(current); }

  function applyTheme() {
    var theme = Storage.get().settings.theme || 'light';
    if (theme === 'dark') document.body.classList.add('dark');
    else document.body.classList.remove('dark');
    var btn = document.getElementById('themeToggle');
    if (btn) btn.textContent = theme === 'dark' ? '日间模式' : '夜间模式';
    if (global.Glass) global.Glass.setTheme(); /* 折射场景需随主题重绘背景渐变 */
  }

  function toggleTheme() {
    var s = Storage.get();
    s.settings.theme = (s.settings.theme === 'dark') ? 'light' : 'dark';
    Storage.save();
    applyTheme();
  }

  // 首次启动隐私告知
  function showPrivacy() {
    var s = Storage.get();
    if (s.settings.privacyAccepted) return;
    var root = document.getElementById('modalRoot');
    root.innerHTML =
      '<div class="modal-mask"><div class="modal">' +
      '<h2>隐私说明</h2>' +
      '<p>宝妈助手是一个纯本地工具。你记录的所有数据（经期、孕期、喂养、睡眠、宫缩、生长、待产包、记账等）仅保存在你本机的浏览器中。</p>' +
      '<p>本应用：不注册账号、不联网、不上传任何数据、不接入第三方 SDK、不做广告、不做分析。</p>' +
      '<p>换设备或清理浏览器数据会导致记录丢失，请使用「设置-导出数据」定期备份。</p>' +
      '<button id="privacyOk" class="btn btn-primary" type="button">我已知晓，开始使用</button>' +
      '</div></div>';
    document.getElementById('privacyOk').addEventListener('click', function () {
      s.settings.privacyAccepted = true;
      Storage.save();
      root.innerHTML = '';
    });
  }

  function exportAll() {
    var text = Storage.exportJSON();
    Util.download('宝妈助手数据_' + Util.todayISO() + '.json', text, 'application/json');
  }

  function importAll() {
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'application/json,.json';
    inp.addEventListener('change', function () {
      if (!inp.files || !inp.files[0]) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          Storage.importJSON(String(reader.result));
          Util.toast('导入成功，已恢复全部数据。', 'ok');
          rerender();
        } catch (e) {
          Util.toast('导入失败：' + (e && e.message ? e.message : e), 'error');
        }
      };
      reader.readAsText(inp.files[0]);
    });
    inp.click();
  }

  function resetAll() {
    Util.confirm({
      title: '清空全部数据',
      message: '确定清空全部数据？此操作不可恢复。',
      okText: '清空',
      danger: true,
      onConfirm: function () {
        Storage.reset();
        Util.toast('已清空全部数据。', 'ok');
        rerender();
      }
    });
  }

  global.App = {
    showTab: showTab,
    rerender: rerender,
    exportAll: exportAll,
    importAll: importAll,
    resetAll: resetAll,
    applyTheme: applyTheme
  };

  function init() {
    Storage.load();
    applyTheme();
    buildTabbar();
    document.getElementById('themeToggle').addEventListener('click', toggleTheme);
    /* 全局左上角宝宝头像：注入插画并点击进入设置 */
    var av = document.getElementById('avatarBtn');
    if (av) {
      av.innerHTML = (global.illo ? illo('avatar') : '');
      av.addEventListener('click', function () { showTab('settings'); });
    }
    /* 顶栏滚动玻璃化（被动监听，不影响滚动性能） */
    window.addEventListener('scroll', syncHeader, { passive: true });
    syncHeader();

    showTab('home');
    showPrivacy();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
