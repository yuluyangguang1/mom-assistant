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
  /* 第 293 次（多宝宝 / 孕期分类）：按「这条记录属于谁」分组，与存储口径一致——
     · baby：存在当前宝宝名下（storage.js BABY_KEYS），切换宝宝就换一套；
     · pregnancy：这次怀孕（孕周、胎动、宫缩、待产包），全家一份；
     · mom：妈妈自己的身体和情绪；home：全家共用的账和用品。
     之前「通用」一组把宝宝和妈妈的混在一起，两个宝宝时分不清哪些跟着切换。 */
  var GROUPS = [
    {
      key: 'baby', title: '宝宝', items: [
        { id: 'feeding', name: '喂养' },
        { id: 'pump', name: '泵奶' }, /* 第 256 次：泵奶独立入口（记录跟着当前宝宝，和喂养同一份） */
        { id: 'solid', name: '辅食' }, /* 第 269 次：辅食独立入口 */
        /* 第 254 次：亲喂、瓶喂只从喂养页底部进入，不在全部功能里单列 */
        { id: 'diaper', name: '尿布' },
        { id: 'sleep', name: '睡眠' },
        { id: 'whitenoise', name: '哄睡白噪音' },
        { id: 'growth', name: '生长' },
        { id: 'vaccine', name: '疫苗' },
        { id: 'meds', name: '吃药/维D' },
        { id: 'milestone', name: '里程碑' },
        { id: 'temp', name: '体温' },
        /* 第 132 次（对标 Cali 21 工具补缺）：新模块在「全部功能」里必须有入口 */
        { id: 'jaundice', name: '黄疸' },
        { id: 'bath', name: '洗澡' },
        { id: 'swim', name: '游泳' },
        { id: 'sun', name: '日晒' },
        { id: 'water', name: '饮水' },
        { id: 'supplement', name: '营养品' }
      ]
    },
    {
      key: 'pregnancy', title: '孕期', items: [
        { id: 'pregnancy', name: '孕期' },
        { id: 'fetal', name: '胎动' },
        { id: 'contraction', name: '宫缩' },
        { id: 'packing', name: '待产包' },
        { id: 'momweight', name: '宝妈体重' }
      ]
    },
    {
      key: 'mom', title: '妈妈', items: [
        { id: 'mood', name: '妈妈情绪' },
        { id: 'period', name: '经期' }
      ]
    },
    {
      key: 'home', title: '全家', items: [
        { id: 'finance', name: '记账' },
        { id: 'supplies', name: '用品' }
      ]
    },
    {
      key: 'tools', title: '工具', items: [
        { id: 'calendar', name: '日期记录' },
        { id: 'settings', name: '设置' }
      ]
    }
  ];

  /* 第 293 次：分组标题与顺序（菜单面板、全部功能页共用一份）。
     · 宝宝组标题带当前宝宝的名字；两个及以上宝宝时注明「切换宝宝后换一套」；
     · 孕期组：正在孕期（含大宝已出生又怀孕）时排第一、标题带孕周；不在孕期时排在妈妈前面、只叫「孕期」。 */
  function groupsFor(d) {
    var App = global.App, S = global.Storage;
    var stage = (d && App && typeof App.stageOf === 'function') ? App.stageOf(d) : null;
    var wk = (d && App && typeof App.pregnancyWeekOf === 'function') ? App.pregnancyWeekOf(d) : null;
    var kids = (d && d.babies) ? d.babies.length : 0;
    var nm = '';
    try { nm = (S && S.babyLabel) ? S.babyLabel() : ''; } catch (e) { nm = ''; }
    var out = GROUPS.map(function (g) {
      var t = g.title, sub = '';
      if (g.key === 'baby') {
        t = (nm && nm !== '宝宝') ? nm + '的记录' : '宝宝的记录';
        if (kids >= 2) sub = '跟着当前宝宝';
      } else if (g.key === 'pregnancy' && wk !== null) {
        t = '孕期 · 第 ' + wk + ' 周';
      }
      return { key: g.key, title: t, sub: sub, items: g.items };
    });
    /* 妈妈（2 项）和全家（2 项）各占一个标题 + 一整行，菜单面板会被顶到屏幕最上面；显示时并成一组「妈妈和全家」，一行放下 */
    var mi = -1, hi = -1;
    out.forEach(function (g, i) { if (g.key === 'mom') mi = i; if (g.key === 'home') hi = i; });
    if (mi >= 0 && hi >= 0) {
      out[mi] = { key: 'mom', title: '妈妈和全家', sub: kids >= 2 ? '全家一份' : '', items: out[mi].items.concat(out[hi].items) };
      out.splice(hi, 1);
    }
    if (stage === 'pregnancy' || wk !== null) {
      var order = ['pregnancy', 'baby', 'mom', 'tools'];
      out.sort(function (a, b) { return order.indexOf(a.key) - order.indexOf(b.key); });
    }
    return out;
  }

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

      var groups = groupsFor(d);

      var html = '';
      /* 顶部搜索入口：与首页 .home-search 完全同一套类名与结构，点击跳到搜索页。 */
      html += '<button class="home-search" data-go="search" type="button">'
        + '<span class="si-ico">' + iconOf('search') + '</span>'
        + '<span>搜索记录、里程碑、用品…</span>'
        + '</button>';

      groups.forEach(function (g) {
        html += '<h2 class="section-title">' + esc(g.title) + (g.sub ? '<small class="st-sub">' + esc(g.sub) + '</small>' : '') + '</h2><div class="tools-grid">';
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
    _modules: ALL_ITEMS,
    _groups: GROUPS, /* 第 245 次：左侧抽屉按同一份分组列功能 */
    _groupsFor: groupsFor /* 第 293 次：带当前宝宝名 / 孕周的标题与阶段排序 */
  };
})(window);
