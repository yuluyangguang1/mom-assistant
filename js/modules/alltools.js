/**
 * alltools.js - 「全部功能」整页（第 118 次 · 对标 Cali 的家当裁决）
 *
 * 背景：首页首屏收敛到 6–8 个高频磁贴后，其余模块需要一个「一个入口都不丢」的兜底页。
 *   · 首页在丢过模块（阶段筛选 / 收敛截取）时，会在磁贴网格下方挂一个 .alltools-entry，
 *     带 data-go="alltools" 跳到本页。
 *   · 本页不做任何阶段过滤——「全部功能」就该是全部；只按当前阶段给分组顺序提建议
 *     （孕期把「孕期」组提到前面），不隐藏任何入口。
 *
 * 结构：顶部一个搜索入口（复用首页 .home-search 类名）→ 按阶段分组的 section-title + tools-grid。
 * 契约（CSS 由主理人按这些类名写，类名不可改）：
 *   .home-search / .si-ico / .section-title / .tools-grid / .tool-item / .ti-ico / .ti-name
 *
 * 只读不写：本页不落任何库，纯粹是导航聚合。所有 icon() / App / Storage 调用都有存在性守卫，
 * 缺依赖（如 QA 沙箱）时不抛错。
 */
(function (global) {
  'use strict';

  var Modules = global.Modules = global.Modules || {};

  /* 图标名映射：多数模块直接用自身 id 作图标键，个别不同名（whitenoise 的图标键是 noise）。 */
  var ICON_KEY = { whitenoise: 'noise' };

  /* 强调色映射：与首页磁贴的 accent 口径保持一致（哄睡白噪音在首页用的是 sleep 色）。
     其余模块 accent 直接用自身 id。 */
  var ACCENT = { whitenoise: 'sleep' };

  /* 模块名逐字照抄首页 home.js 磁贴的 name 字段——两处必须一致，否则用户会觉得是两套东西。 */
  var GROUPS = [
    {
      key: 'common', title: '通用', items: [
        { id: 'feeding', name: '喂养' },
        { id: 'diaper', name: '尿布' },
        { id: 'sleep', name: '睡眠' },
        { id: 'whitenoise', name: '哄睡白噪音' },
        { id: 'growth', name: '生长' },
        { id: 'vaccine', name: '疫苗' },
        { id: 'meds', name: '吃药/维D' },
        { id: 'milestone', name: '里程碑' },
        { id: 'temp', name: '体温' },
        /* 第 132 次（对标 Cali 21 工具补缺）：六个新模块在「全部功能」里必须有入口——
           首页磁贴走「有数据才出现」的收敛策略，新模块的发现路径就靠这一页。 */
        { id: 'jaundice', name: '黄疸' },
        { id: 'bath', name: '洗澡' },
        { id: 'swim', name: '游泳' },
        { id: 'sun', name: '日晒' },
        { id: 'water', name: '饮水' },
        { id: 'supplement', name: '补剂' },
        { id: 'mood', name: '妈妈情绪' },
        { id: 'finance', name: '记账' },
        { id: 'supplies', name: '消耗品' },
        { id: 'period', name: '经期' }
      ]
    },
    {
      key: 'pregnancy', title: '孕期', items: [
        { id: 'pregnancy', name: '孕期' },
        { id: 'fetal', name: '胎动' },
        { id: 'contraction', name: '宫缩' },
        { id: 'packing', name: '待产包' }
      ]
    },
    {
      key: 'tools', title: '工具', items: [
        { id: 'calendar', name: '日期记录' },
        { id: 'settings', name: '设置' }
      ]
    }
  ];

  /* 展平后的完整清单：供首页读取「全部功能」的总项数（home.js 的 N 项），
     也让本页与首页共用同一份来源，不各写一份会漂移的常量。 */
  var ALL_ITEMS = [];
  GROUPS.forEach(function (g) {
    g.items.forEach(function (it) { ALL_ITEMS.push(it); });
  });

  function iconOf(id) {
    if (!global.icon) return '';
    return global.icon(ICON_KEY[id] || id) || '';
  }

  function esc(s) {
    return (global.Util && typeof global.Util.escapeHtml === 'function') ? global.Util.escapeHtml(s) : String(s);
  }

  function accentOf(id) { return ACCENT[id] || id; }

  Modules.alltools = {
    id: 'alltools',
    title: '全部功能',
    render: function (view) {
      /* 阶段只用来给分组排序提建议，不做过滤——「全部功能」就是全部。
         依赖缺失（无 Storage/App）时 stage 为 null，走默认顺序「通用 → 孕期 → 工具」。 */
      var d = (global.Storage && typeof global.Storage.get === 'function') ? global.Storage.get() : null;
      var stage = (d && global.App && typeof global.App.stageOf === 'function') ? global.App.stageOf(d) : null;

      var groups = GROUPS.slice();
      if (stage === 'pregnancy') {
        /* 孕期把「孕期」组提到最前（对标首页的阶段前置磁贴思路），育儿期维持默认顺序。 */
        var order = ['pregnancy', 'common', 'tools'];
        groups.sort(function (a, b) { return order.indexOf(a.key) - order.indexOf(b.key); });
      }

      var html = '';
      /* 顶部搜索入口：与首页 .home-search 完全同一套类名与结构，点击跳到搜索页。 */
      html += '<button class="home-search" data-go="search" type="button">'
        + '<span class="si-ico">' + iconOf('search') + '</span>'
        + '<span>搜索记录、里程碑、用品…</span>'
        + '</button>';

      groups.forEach(function (g) {
        html += '<h2 class="section-title">' + esc(g.title) + '</h2><div class="tools-grid">';
        g.items.forEach(function (it) {
          html += '<button class="tool-item" data-accent="' + esc(accentOf(it.id)) + '" data-go="' + esc(it.id) + '" type="button">'
            + '<span class="ti-ico">' + iconOf(it.id) + '</span>'
            + '<span class="ti-name">' + esc(it.name) + '</span>'
            + '</button>';
        });
        html += '</div>';
      });

      view.innerHTML = html;

      /* 绑定点击：渲染完之后才绑，保证 [data-go] 已全部在 innerHTML 里（含顶部搜索入口）。
         参照 home.js 的既有写法，用 Array.prototype.forEach.call 兼容类数组。 */
      Array.prototype.forEach.call(view.querySelectorAll('[data-go]'), function (b) {
        b.addEventListener('click', function () {
          if (global.App && typeof global.App.showTab === 'function') {
            global.App.showTab(b.getAttribute('data-go'));
          }
        });
      });
    },
    /* 目录清单：首页读它拿「N 项」的总数；无效依赖时也不会崩。 */
    _modules: ALL_ITEMS
  };
})(window);
