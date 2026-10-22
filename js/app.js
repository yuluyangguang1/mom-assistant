/**
 * app.js - 应用入口
 * 负责：底部 Tab 切换、主题（夜间模式）、首次三步引导、导出/导入、初始化。
 * 必须最后加载（依赖各模块的 Modules 注册）。
 */
(function (global) {
  'use strict';
  var Storage = global.Storage;
  var Util = global.Util;
  var Modules = global.Modules = global.Modules || {};

  // 底部导航栏只保留 2 个主入口；其余功能模块（首页磁贴现为 13 个，含白噪音）统一在「首页-全部功能」网格中一键直达（2026-09-19 精简）
  var TABS = [
    { id: 'home', title: '首页' },
    { id: 'calendar', title: '日期记录' }
  ];

  var current = 'home';

  /* 模块 id → 图标键：多数模块的图标键就等于自身 id，个别不同名。
     第 118 次补 alltools（页面图标记为 grid 四宫格）与 whitenoise（图标键是 noise，
     此前调 icon('whitenoise') 拿不到图、页头留一个空槽）。
     与 modules/alltools.js 里的 ICON_KEY 口径必须一致。 */
  var ICON_KEY = { alltools: 'grid', whitenoise: 'noise' };

  /* 第 116 次（真机实测：iOS 添加到桌面后顶部一条白色渐变 + 顶栏元素挤成一团）：
     独立模式（PWA 添加到桌面）下，env(safe-area-inset-top) 本身已包含 iOS 状态栏高度，
     CSS 若再叠加 10px 基础内边距就是「安全区算两遍」——顶栏被撑高 126px，
     头像/齿轮/日期全被推到状态栏下方（用户说的「挤到一起」），
     且状态栏裸露区没有过渡层，浮出一条白色渐变（用户说的「白色渐变」）。

     这里把独立模式标记写进 --sat-standalone，CSS 据此决定要不要那10px。
     判定三条（任一命中即算独立模式）：
       1. matchMedia('(display-mode: standalone)')  —— 标准 PWA 桌面图标
       2. matchMedia('(display-mode: fullscreen)')   —— iOS Safari 自定义全屏
       3. navigator.standalone                        —— iOS 旧内核（iOS 6~10）
     标签页模式（微信内置浏览器、Safari 首次打开、Chrome 标签页）三条全不命中，
     保持原有 10px 基础内边距 + env() 的行为不变。
     display-mode 还能监听（从浏览器标签「添加到主屏幕」后热切换），
     切回标签页时恢复 10px，无需刷新。 */
  function syncStandalone() {
    try {
      var root = document.documentElement;
      var mqStandalone = global.matchMedia && global.matchMedia('(display-mode: standalone)');
      var mqFullscreen = global.matchMedia && global.matchMedia('(display-mode: fullscreen)');
      var isStandalone = !!global.navigator.standalone ||
        !!(mqStandalone && mqStandalone.matches) || !!(mqFullscreen && mqFullscreen.matches);
      root.style.setProperty('--sat-standalone', isStandalone ? '1' : '0');
      /* 老内核无 addEventListener('change') 时静默跳过：首帧已写对，不影响显示 */
      if (mqStandalone && mqStandalone.addEventListener) {
        mqStandalone.addEventListener('change', syncStandalone);
      } else if (mqStandalone && mqStandalone.addListener) {
        mqStandalone.addListener(syncStandalone); /* Safari 13- */
      }
    } catch (e) { /* 极旧内核：CSS 回落默认值 0，仍是原来的10px + env() 行为 */ }
  }

  /* 第 100 次：底栏五口排列模式。normal=居中横排（默认）/ left=左下竖排 / right=右下竖排。
     存储只存字符串，这里统一收口读取；无效值一律回落 normal。 */
  function handMode() {
    try {
      var dd = Storage.get();
      var s = dd && dd.settings;
      if (s && (s.handMode === 'left' || s.handMode === 'right')) return s.handMode;
    } catch (e) { /* 存储未就绪按正常排列渲染 */ }
    return 'normal';
  }

  function buildTabbar() {
    var bar = document.getElementById('tabbar');
    /* 第 135 次（底部胶囊 dock）：宝宝切换 / 设置 / 返回三个顶栏按钮要搬进胶囊。
       必须在 innerHTML='' 之前取到引用——清空后它们在 DOM 里就找不到了
       （节点对象仍由这几个变量持有，重新 append 即「搬移」，id 与既有事件绑定全部保留）。 */
    var avEl = document.getElementById('avatarBtn');
    var gearEl = document.getElementById('settingsBtn');
    var backEl = document.getElementById('backBtn');
    bar.innerHTML = '';
    var hand = handMode();
    /* 第 100 次：左手/右手模式——五个入口收进一根竖排胶囊（固定屏幕同侧下缘）：
       首页、日期记录、快记「＋」（转发给 #qdFab 复用整套开合/快记逻辑）、
       宝宝切换（复用 openBabySheet 面板）、设置。竖排没有文字空间，页签只留图标。 */
    if (hand !== 'normal') {
      var defs = [
        { id: 'home', title: '首页', kind: 'tab' },
        { id: 'calendar', title: '日期记录', kind: 'tab' },
        { id: '__quick', title: '快速记录', kind: 'quick' },
        { id: '__baby', title: '切换宝宝', kind: 'baby' },
        { id: 'settings', title: '设置', kind: 'tab' }
      ];
      defs.forEach(function (t) {
        var b = document.createElement('button');
        b.className = 'tab' + (t.kind === 'quick' ? ' tab-plus' : '') + (t.kind === 'tab' && t.id === current ? ' active' : '');
        b.type = 'button';
        b.innerHTML = icon(t.id === '__quick' ? 'plus' : (t.id === '__baby' ? 'baby' : t.id))
          + '<span class="tab-label">' + t.title + '</span>';
        if (t.kind === 'tab') {
          b.setAttribute('data-tab', t.id);
          if (t.id === current) b.setAttribute('aria-current', 'page');
          b.addEventListener('click', function () { showTab(t.id); });
        } else if (t.kind === 'quick') {
          b.setAttribute('data-qd-toggle', '1');
          b.setAttribute('aria-label', '快速记录');
          b.addEventListener('click', function () {
            var fab = document.getElementById('qdFab');
            if (fab && fab.click) fab.click(); /* 隐藏的 FAB 仍在 DOM，转发点击即复用全部逻辑 */
          });
        } else {
          b.setAttribute('aria-label', '切换宝宝');
          b.addEventListener('click', function () { openBabySheet(); });
        }
        bar.appendChild(b);
      });
      /* 快记动作列从底栏上方展开：把竖排胶囊高度喂给 CSS（#quickDock 定位用） */
      try {
        var hh = bar.offsetHeight;
        document.documentElement.style.setProperty('--dock-h', (hh > 0 ? hh : 260) + 'px');
      } catch (e) { /* QA 桩无真实布局，跳过 */ }
      /* 第 101 次修复：布局自检兜底——个别真机内核（X5/夸克等）对 fixed + transform
         覆盖链解析异常时，竖排胶囊会整体漂出画面。rAF 后实测 rect，越界即内联
         强制回正（内联样式优先级最高，任何怪癖都压得住）。正常时零副作用。 */
      try {
        requestAnimationFrame(function () {
          var r = bar.getBoundingClientRect();
          var vw = window.innerWidth, vh = window.innerHeight;
          if (!r || !vw) return;
          if (r.left < 0 || r.right > vw + 1 || r.bottom > vh + 1 || r.top < 0) {
            bar.style.left = '12px'; bar.style.right = 'auto';
            bar.style.top = 'auto'; bar.style.transform = 'none';
            var b2 = bar.getBoundingClientRect();
            if (b2.bottom > vh) bar.style.bottom = Math.max(0, vh - b2.height - 4) + 'px';
          }
        });
      } catch (e) { /* 老内核无 rAF 就算了：CSS 已自持 */ }
      return;
    }
    /* 正常排列：居中横排（原逻辑不动） */
    try { document.documentElement.style.setProperty('--dock-h', '0px'); } catch (e) {}
    /* 第 135 次：胶囊最左 = 宝宝切换（原顶栏左上角头像）。 */
    if (avEl) { avEl.classList.add('dock-btn'); bar.appendChild(avEl); }
    TABS.forEach(function (t) {
      var b = document.createElement('button');
      b.className = 'tab' + (t.id === current ? ' active' : '');
      b.type = 'button';
      /* 第 141 次：底栏统一为「纯图标」——页签不再带文字。
         文字去掉后必须补 aria-label，否则读屏只剩一个无名按钮。 */
      b.innerHTML = icon(t.id);
      b.setAttribute('aria-label', t.title);
      b.setAttribute('title', t.title);
      b.setAttribute('data-tab', t.id);
      if (t.id === current) b.setAttribute('aria-current', 'page'); /* 无障碍：标记当前页签 */
      b.addEventListener('click', function () { showTab(t.id); });
      bar.appendChild(b);
    });
    /* 第 97 次：右侧自定义快捷槽位——设置页「底栏快捷入口」选一个常用模块，
       在两页签右侧多一个直达入口（选中页签与「不显示」均不渲染）。
       模块 id 在设置里选、存储里只存字符串，这里二次校验模块真实存在，
       无效值（老数据/导入的未知 id）静默忽略，底栏照常两页签。 */
    var slot = null;
    try {
      var dd = Storage.get();
      slot = (dd && dd.settings) ? dd.settings.dockSlot : null;
    } catch (e) { /* 存储未就绪时不出槽位，两页签照常 */ }
    if (slot && Modules[slot] && slot !== current) {
      var sb = document.createElement('button');
      sb.className = 'tab tab-slot';
      sb.type = 'button';
      /* 第 141 次：同页签，去文字只留图标（aria-label 原本就有） */
      sb.innerHTML = icon(slot);
      sb.setAttribute('title', Modules[slot].title);
      sb.setAttribute('data-tab', slot);
      sb.setAttribute('aria-label', '快捷入口：' + Modules[slot].title);
      sb.addEventListener('click', function () { showTab(slot); });
      bar.appendChild(sb);
    }
    /* 第 135 次（底部胶囊 dock · 续）：「＋」快捷记录 + 设置 + 返回。
       「＋」是一个转发按钮——点它去 click 隐藏的 #qdFab，复用整套开合/动作列逻辑
       （与左手模式的 __quick 转发同源，避免再写一份状态机）。 */
    var plus = document.createElement('button');
    plus.className = 'tab tab-plus dock-plus';
    plus.type = 'button';
    plus.setAttribute('data-qd-toggle', '1');
    plus.setAttribute('aria-label', '快速记录');
    plus.setAttribute('title', '快速记录');
    /* 第 141 次：＋ 去掉「快记」文字，并挪到胶囊最右（原来是 ＋ 后面还跟设置/返回） */
    plus.innerHTML = icon('plus');
    plus.addEventListener('click', function () {
      var f = document.getElementById('qdFab');
      if (f && f.click) f.click();
    });
    if (gearEl) { gearEl.classList.add('dock-btn'); bar.appendChild(gearEl); }
    /* 返回在 ＋ 之前：二级页里 CSS 让「返回靠左、＋ 靠右」，DOM 顺序即视觉顺序 */
    if (backEl) { backEl.classList.add('dock-btn'); bar.appendChild(backEl); }
    bar.appendChild(plus);
  }

  /* 顶栏玻璃化策略：
     - 首页（天空 hero）：默认透明，滚动 >8px 后补实色底（为天空让路）
     - 模块页：始终实色（无天空，透明顶栏会让「页头标题」上方露出 66px 空白带，
       且内容滚动时会从透明顶栏下方穿过造成重叠）
     奶油风下实色顶栏与卡片同源，视觉一体。 */
  function syncHeader() {
    var header = document.querySelector('.app-header');
    if (!header) return;
    /* 第 117 次：区分「首页滚动后」与「模块页」——两者曾共用 is-scrolled，
       但顶栏雾化的前提完全不同：
         首页背后是天空画布，状态栏区必须留透明让天空透出（否则 59px 处硬横线）；
         模块页背后**没有天空**，留透明就是直接露出 body 底色，
         在 iOS 上等于把横线搬到状态栏那一行。
       所以模块页用 is-solid（真雾化、无安全区豁免），首页滚动用 is-scrolled。 */
    if (current !== 'home') {
      header.classList.add('is-solid');
      header.classList.remove('is-scrolled');
      header.classList.remove('is-deep');
      return;
    }
    /* 第 144 次：首页顶栏已改为 position:static（跟着天空滚走），
       is-scrolled / is-deep 两套雾化对首页不再有意义——留着只会在
       某些内核上残留类名造成困惑，这里一并清掉，只保留模块页的 is-solid。 */
    header.classList.remove('is-solid');
    header.classList.remove('is-scrolled');
    header.classList.remove('is-deep');
  }

  function showTab(id, opts) {
    if (!Modules[id]) return;
    /* 第 96 次（原生手感·方向性进场）：按导航语义注入水平位移变量，
       fadeUp 消费（见 styles.css）。前进=从内容深处推入（磁贴/齿轮进模块），
       返回=从左收回（模块页回首页），底栏页签互切与平级跳转纯上浮。
       只动 transform+opacity；reduced-motion 下全局禁动画自动降级。 */
    var prevId = current;
    /* 第 116 次：进入「有上一层」的模块时登记一条 history，让侧滑返回与
       浏览器/系统返回键生效。判定只看「从顶层进更深一层」——
       首页/日历/设置互切是平级，不登记（否则侧滑会退到另一顶层页，行为怪异）。
       rerender 走 silent 路径且id 不变，这里由opts.silent 挡住，不会重复推栈。

       第 118 次：alltools（全部功能）与 search（全局搜索）**刻意不算顶层**。
       它们是从首页推入的子页，必须走「非顶层」这条分支才能同时拿到
       两件事——① 被 pushHistory 登记（侧滑/返回键可退回首页）
       ② 顶栏显示返回按钮。把它们当顶层会让用户进得去出不来。 */
    var isTopLevel = (id === 'home' || id === 'calendar' || id === 'settings');
    var wasTopLevel = (prevId === 'home' || prevId === 'calendar' || prevId === 'settings');
    if (!(opts && opts.silent) && !isTopLevel && wasTopLevel) {
      pushHistory(id);
    }
    current = id;
    buildTabbar();
    var view = document.getElementById('view');
    view.innerHTML = '';
    /* 模块页「分色身份」：给记录类模块页打 data-accent，让列表/图标/标题继承其柔彩色；
       首页（多模块聚合）与日历（自带 per-row 分色）必须清除，避免串色。
       第 118 次：alltools / search 也清除——它们不是"某个模块"，
       页内每个磁贴自带 data-accent（.tool-item），页级再挂一个无对应 [data-accent] 规则的
       值只会让页头的 --tile 走 fallback、颜色与页内磁贴对不上。 */
    if (id === 'home' || id === 'calendar' || id === 'alltools' || id === 'search') view.removeAttribute('data-accent');
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
      head.innerHTML = '<span class="mod-head-ico">' + icon(ICON_KEY[id] || id) + '</span><h1>' + Util.escapeHtml(Modules[id].title) + '</h1>';
      view.insertBefore(head, view.firstChild);
    }
    /* 返回按钮 + 日期收起态（第 42 次）：模块页显示返回，回到首页则隐藏。
       底栏两个页签（首页/日期记录）之外的任何页，都需要一个就近的返回出口。 */
    var backBtn = document.getElementById('backBtn');
    if (backBtn) backBtn.hidden = (id === 'home' || id === 'calendar' || id === 'settings');    /* 用 add/remove 而非 classList.toggle(cls, force)：测试桩的 toggle 不接受 force 参数，
       会退化成「反转」，连续进两次同一页就把类删掉了。 */
    /* 第 135 次（底部胶囊 dock）：二级页收起整条胶囊，只留返回钮。
       判据与 backBtn 完全同源——不另立一套「什么算二级页」的规则，
       否则两处口径迟早分叉（返回钮在、胶囊不收，或反过来）。 */
    var dockBar = document.getElementById('tabbar');
    if (dockBar) {
      var isSub = (id !== 'home' && id !== 'calendar' && id !== 'settings');
      if (isSub) dockBar.classList.add('is-sub'); else dockBar.classList.remove('is-sub');
    }
    if (id !== 'home') document.body.classList.add('in-module');
    else document.body.classList.remove('in-module');
    if (id === 'home') document.body.classList.add('in-home');
    else document.body.classList.remove('in-home');
    /* 第 43 次：模块页左上角小日期徽标（首页大日期在天空卡片内，二者互不重复） */
    var modDate = document.getElementById('modDate');
    if (modDate) {
      var mD = new Date();
      modDate.textContent = (mD.getMonth() + 1) + '月' + mD.getDate() + '日';
    }
    // 进入动画：移除并重排后添加 .view-enter，触发卡片错落淡入（克制，<400ms）。
    // 第 51 次（走查专项）：rerender（保存/撤销/快记后的原地刷新）走 silent 静默路径——
    // 只移除不回加，新插入的 DOM 不再匹配 .view-enter > * / .view-enter .list li /
    // .view-enter .sky-canvas，整页卡片、列表与天空不再重播入场动画。
    // 此前每记一笔全页重新错落淡入一遍（连天空都眨一下），是「假忙碌」感的主源。
    view.classList.remove('view-enter');
    if (!(opts && opts.silent)) {
      var dirX = '0px';
      if (prevId === 'home' && id !== 'home' && id !== 'calendar') dirX = '18px';
      else if (prevId && prevId !== 'home' && prevId !== 'calendar' && id === 'home') dirX = '-18px';
      /* setProperty 是设置 CSS 自定义属性的唯一可靠途径；不支持的环境（测试桩/
         极旧内核）静默跳过——动画退化为纯上浮，不影响功能。 */
      try { view.style.setProperty('--enter-x', dirX); } catch (e) { /* 忽略 */ }
      void view.offsetWidth;
      view.classList.add('view-enter');
    }
    // 进度条宽度过渡（从 0 动画到目标值）
    Array.prototype.forEach.call(view.querySelectorAll('.progress-bar'), function (bar) {
      var target = bar.style.width || '0%';
      bar.style.width = '0%';
      void bar.offsetWidth;
      bar.style.width = target;
    });
    traceStart(id); /* U-05：进入记录类模块即开始计时计点击 */
    /* 第 116 次：滚动归位与恢复合并到同一处。
       rerender 传了 restoreY，就在DOM 写完的同一帧立刻回到原位置——
       不能像旧实现那样「先归零、等调用方下一帧再补」，那时新内容高度已变，
       scrollTo 会撞上新的可滚动上限被静默夹断（真机实测 600 → 362/246）。
       无 restoreY（真正的切页）仍从顶部开始，行为不变。 */
    var restoreY = (opts && typeof opts.restoreY === 'number' && opts.restoreY > 0) ? opts.restoreY : 0;
    window.scrollTo(0, restoreY);
    syncHeader(); /* 切页回到顶部，顶栏同步复位为透明；restoreY 时保持已滚动态 */

    if (global.Glass) global.Glass.wake(); /* 折射层：重绘场景并刷新各玻璃面 */
  }

  /* C3（操作便捷性研究·第 32 次）：rerender 是轻操作后的原地刷新，必须保住滚动位置——
     showTab 末尾会 scrollTo(0,0)，若不恢复，待产包勾选 / 疫苗标记等列表中段操作会跳回页顶。
     真正的 Tab 切换仍从顶部开始（showTab 自身归零，这里只恢复 rerender 场景）。
     第 51 次：rerender 同时走 silent 静默路径——轻操作只更新数据，不重播整页入场动画。

     第 116 次（真机实测：用户反馈「每次从模块退出都会回到最高处」）：
     旧写法是 `showTab(...)` 内部先 scrollTo(0,0)，rerender 再在【下一帧】
     scrollTo(0, y) 补回。实测三档真机 600px 只能回到 362/474/246 —— 不是补不回，
     是补回的时机错了：showTab 里 view.innerHTML='' 已把旧内容清空，
     新内容按数据重新渲染后【总高度变了】，此时 scrollTo(0,600) 会撞上新的可滚动上限，
     浏览器静默夹到实际最大值，于是位置凭空少掉一截（列表越短丢得越多）。

     正确做法：把「要恢复到哪里」传进 showTab，让它在【DOM 写完的同一帧内】
     立刻归位，而不是等调用方下一帧再补。silent 模式才恢复；真正的切页仍从顶部开始。 */
  function rerender() {
    var y = window.pageYOffset || (document.documentElement && document.documentElement.scrollTop) || 0;
    showTab(current, { silent: true, restoreY: y });
  }

  /* U-09：夜间交互要做唤醒成本控制。
     本地时间 22:00–06:00 默认进入暗色（用户可关），并给 body 打 .is-night，
     由 CSS 降低强调色饱和度与动效强度（styles.css）。用户手动切换过主题即视为明确表态，
     之后不再自动改他的选择——尊重显式选择优先于自动规则。 */
  var NIGHT_FROM = 22, NIGHT_TO = 6;
  /* 第 87 次（P1 情境3）：深夜档 23:00–05:00——暗色下再压一档表面亮度（喂夜奶场景） */
  var DEEP_FROM = 23, DEEP_TO = 5;

  function isNightNow() {
    var h = new Date().getHours();
    return h >= NIGHT_FROM || h < NIGHT_TO;
  }

  function isDeepNightNow() {
    var h = new Date().getHours();
    return h >= DEEP_FROM || h < DEEP_TO;
  }

  /* 主题模式（第 41 次）：time=跟随本地时间（22:00–06:00）/ system=跟随系统外观 /
     light / dark=手动固定。旧数据无 themeMode 字段时从 themeAuto+theme 推导，向后兼容。 */
  function themeMode() {
    var s = Storage.get().settings;
    if (s.themeMode) return s.themeMode;
    return (s.themeAuto !== false) ? 'time' : ((s.theme === 'dark') ? 'dark' : 'light');
  }

  function sysPrefersDark() {
    try { return !!(global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches); }
    catch (e) { return false; }
  }

  function shouldDark() {
    var mode = themeMode();
    if (mode === 'dark') return true;
    if (mode === 'light') return false;
    if (mode === 'system') return sysPrefersDark();
    return isNightNow();
  }

  function applyTheme() {
    var s = Storage.get().settings;
    var dark = shouldDark();
    if (dark) document.body.classList.add('dark');
    else document.body.classList.remove('dark');
    /* 夜间标记：供 CSS 压掉动效与饱和度（不是功能开关，只影响观感） */
    if (isNightNow()) document.body.classList.add('is-night');
    else document.body.classList.remove('is-night');
    /* 第 87 次：深夜降档（暗色+23:00–05:00 时 CSS 把表面再压一档）。
       第 100 次起：底栏排列由 leftHand 开关升级为 handMode 三态——
       dock-left / dock-right 把五个入口收进屏幕同侧竖排，normal 不挂类。 */
    document.body.classList.toggle('deep-night', dark && isDeepNightNow());
    /* dock-left/right 用 add/remove 而非 toggle(cls, force)：QA 桩的 toggle 不吃 force
       会退化成「反转」（与 showTab in-module 同款处理），真实语义两者等价且幂等 */
    var hand = handMode();
    if (hand === 'left') document.body.classList.add('dock-left');
    else document.body.classList.remove('dock-left');
    if (hand === 'right') document.body.classList.add('dock-right');
    else document.body.classList.remove('dock-right');
    /* 第 103 次（OP-GAP-03）：字号倍率。与上面三处同款处理——
       add/remove 而非 toggle(force)，因为 QA 桩的 toggle 不吃 force 会退化成反转。 */
    applyFontScale();
    /* 第 118 次（对标 Cali）：高对比模式。同款 add/remove。
       放在 applyTheme 里是因为它要与主题同生命周期——虽然不是"主题"，
       但用户心智里它属于外观，且主题切换（跟随时间自动变暗）时不该丢掉它。 */
    applyHcMode();
    /* 顶栏主题按钮已移除（第 40 次）：入口在「设置 · 外观」，这里不再更新按钮文案 */
    if (global.Glass) global.Glass.setTheme(); /* 折射场景需随主题重绘背景渐变 */
  }

  /* 手动设主题（设置 · 外观）：time=跟随时间；system=跟随系统外观；light/dark=明确固定。
     同步写旧字段（themeAuto/theme），让只读旧字段的代码与测试语义正确。 */
  function setTheme(mode) {
    var s = Storage.get();
    if (['time', 'system', 'light', 'dark'].indexOf(mode) < 0) mode = 'time';
    s.settings.themeMode = mode;
    s.settings.themeAuto = (mode === 'time');
    if (mode === 'dark') s.settings.theme = 'dark';
    if (mode === 'light') s.settings.theme = 'light';
    Storage.save();
    applyTheme();
  }

  /* 第 103 次（OP-GAP-03）建，第 118 次（对标 Cali）修正：全局字号倍率。
     挂 body 类，CSS 侧改 --fs-mul 一个倍率变量，全站 calc(Npx * var(--fs-mul)) 一起缩。

     为什么走 body 类而不直接改 style.fontSize：直接改根元素字号会与 body 自身的
     font-size 声明打架，且不作用于 px 单位的图标与滑杆尺寸。

     ⚠ 一个必须留档的纠正：旧注释在这里写着「styles.css 里 font-size 无一处硬编码 px
     （实测计数 0），所以变量一改全站生效、无漏网」。**这句话是假的**，而且已经假了三轮。
     第 118 次真实计数：显式 font-size 93 处，只有 13 处引用 var(--fs-*)。
     也就是说第 103 次上线后，「字号三档」其实只对继承 body 的文字生效，
     所有写死 12/12.5/13px 的提示、徽标、摘要、日期纹丝不动 ——
     对祖辈用户来说这是一个「点了没反应」的开关。第 118 次已把 93 处全部改成
     calc(Npx * var(--fs-mul))，本注释的陈述才第一次为真。

     三档：normal=原样、lg=1.15、xl=1.33。非法值回落 normal。 */
  var FONT_SCALES = ['normal', 'lg', 'xl'];

  function fontScale() {
    var v = Storage.get().settings.fontScale;
    return (FONT_SCALES.indexOf(v) >= 0) ? v : 'normal';
  }

  function applyFontScale() {
    var v = fontScale();
    if (v === 'lg') document.body.classList.add('fs-lg');
    else document.body.classList.remove('fs-lg');
    if (v === 'xl') document.body.classList.add('fs-xl');
    else document.body.classList.remove('fs-xl');
  }

  /* 设置 · 外观 · 字号。非法值回落 normal 而不是静默存下——
     与 setTheme 同一套语义，避免脏值让页面落到一个没有 CSS 规则的类上。 */
  function setFontScale(v) {
    if (FONT_SCALES.indexOf(v) < 0) v = 'normal';
    Storage.get().settings.fontScale = v;
    Storage.save();
    applyFontScale();
  }

  /* 第 118 次（对标 Cali · opt-in 无障碍）：高对比模式 body.hc。
     为谁做：色觉障碍、老年晶状体黄化（蓝光被吸收后彩度感知衰减）——
     这正是本项目「含祖辈」的目标人群，不是边缘需求。

     为什么做成开关而不是默认开：默认态的模块淡底靠 ΔE76（色相/彩度）分离，
     正常人一眼分开；但这一档用户对彩度不敏感，需要**明度**分离兜底，
     而明度分离会把每张磁贴推成"近白重底 + 重描边"，整体气质从柔和变硬朗，
     不适合强加给所有人。所以默认关。

     为什么挂 <body> 类而不是 <html>：与 applyFontScale / dock-left 同款，
     QA 桩可以直接断言 body.classList，不必碰根元素。

     ⚠ 暗色下这个类**仍会挂上**，但 CSS 里高对比段全部写成 body.hc:not(.dark)，
     所以暗色下它实际不生效 —— 这是刻意的：暗色需要另一套"提高彩度透明度"的取值，
     本轮未算，宁可开关无效也不要把页面弄坏（见 styles.css 该段注释）。 */
  function hcMode() {
    return Storage.get().settings.hcMode === true;
  }

  function applyHcMode() {
    if (hcMode()) document.body.classList.add('hc');
    else document.body.classList.remove('hc');
  }

  function setHcMode(on) {
    Storage.get().settings.hcMode = (on === true);
    Storage.save();
    applyHcMode();
  }

  /* ---------------- 阶段（孕期 / 育儿期）判定 ----------------
     优先级：用户显式选择（settings.stage）> 客观数据（末次月经/预产期推孕周、宝宝已出生）。
     引导里让人先选阶段，只是为了少填几个字段、首页少显示不相关的磁贴，
     不影响任何功能可用性——所以它可以随时为空、为空时全部回落到客观判定。 */
  function stageOf(s) {
    var st = s.settings.stage;
    if (st === 'pregnancy' || st === 'baby') return st;
    return (pregnancyWeekOf(s) !== null) ? 'pregnancy' : 'baby';
  }
  function pregnancyWeekOf(s) {
    var pg = s.pregnancy || {};
    var base = pg.lmp || (pg.dueDate ? Util.addDays(pg.dueDate, -280) : null);
    if (!base) return null;
    var wk = Math.floor(Util.daysBetween(base, Util.todayISO()) / 7);
    return (wk >= 0 && wk <= 45) ? wk : null;
  }

  /* ---------------- 首次引导（O 系列规范） ----------------
     检索结论（出处见《哄睡白噪音与首次引导_功能研究与落地设计》）：
     · NN/g《Mobile-App Onboarding》(2020)：能不做引导就不做——引导本身有交互成本、很少提升任务表现；
       若必须做，只问真正会用到的信息（customization），并务必允许跳过。
     · JMIR《Digital Parenting Interventions for Fathers》系统综述 (2023)：父亲向数字干预参与度普遍很低
       （例如仅 20.9% 会再次打开、平均只浏览 1 个模块），一上来就要资料会直接劝退。
     · Ragni 等《Fathers and Sleep》系统综述 (2020)：父亲参与与孩子睡眠结果相关，但 26 项研究多为西方样本、
       仅 13 项纵向、5 项用体动记录仪，属有限关联证据——身份只用来改称呼与视角，不做任何推断。

     据此三条硬规则：
     1. 只采集「会用到」的字段：身份（改称呼）、宝宝性别/出生日期（疫苗排期与生长曲线要用）、早产（矫正月龄要用）。
        不采集姓名、手机号、邮箱、地址、头像，也没有账号。
     2. 每一步都能跳过；跳过只影响称呼与默认值的个性化，不影响任何功能。
     3. 数据风险与能力边界必须在产生数据之前讲完（R-05 / U-32），且不写任何安全承诺（U-37）。 */
  /* 第 80 次（宝宝档案）：刷新左上角头像——当前宝宝有照片显示照片（圆裁），
     没有则回落默认插画。切换宝宝/上传照片/引导完成后调用。 */
  function refreshHeaderAvatar() {
    var av = document.getElementById('avatarBtn');
    if (!av) return;
    var b = (Storage.activeBaby) ? Storage.activeBaby() : null;
    if (b && b.photo) {
      av.innerHTML = '<img class="ha-photo" src="' + Util.escapeHtml(b.photo) + '" alt="">';
    } else {
      av.innerHTML = (global.illo ? illo('avatar') : '');
    }
  }

  /* 第 82 次（用户反馈：左上角不该进设置）：底部宝宝切换面板。
     点行切换（同步镜像生日/称呼、刷新头像、重绘当前页），底部「管理宝宝档案」
     去设置——添加/改名/照片/删除仍在设置页宝宝档案卡做，面板只管「切换」。 */
  function openBabySheet() {
    var root = document.getElementById('modalRoot');
    if (!root) return;
    var s = Storage.get();
    var babies = s.babies || [];
    var cur = s.settings.activeBabyId;
    var rows = babies.map(function (b) {
      var ava = b.photo
        ? '<img src="' + Util.escapeHtml(b.photo) + '" alt="">'
        : '<span class="sheet-ava">' + Util.escapeHtml((b.name || '宝').charAt(0)) + '</span>';
      return '<li><button type="button" class="sheet-row' + (b.id === cur ? ' active' : '') + '" data-pick="' + b.id + '">'
        + ava
        + '<span class="sheet-name">' + Util.escapeHtml(b.name || '宝宝') + '</span>'
        + (b.id === cur ? '<span class="sheet-check">当前</span>' : '')
        + '</button></li>';
    }).join('');
    if (!babies.length) {
      rows = '<li class="sheet-empty">还没有宝宝档案，先去设置里建一个。</li>';
    }
    root.innerHTML = '<div class="modal-mask sheet-mask" data-sheet-mask>'
      + '<div class="sheet" role="dialog" aria-modal="true" aria-label="切换宝宝">'
      + '<h2>切换宝宝</h2>'
      + '<ul class="sheet-list">' + rows + '</ul>'
      + '<div class="sheet-actions"><button type="button" class="btn" id="sheetManage">管理宝宝档案</button></div>'
      + '</div></div>';
    var close = function () { root.innerHTML = ''; };
    root.querySelector('[data-sheet-mask]').addEventListener('click', function (e) {
      if (e.target === e.currentTarget) close();
    });
    root.querySelector('.sheet-list').addEventListener('click', function (ev) {
      var btn = ev.target.closest ? ev.target.closest('[data-pick]') : null;
      if (!btn) return;
      var b = Storage.switchBaby(btn.getAttribute('data-pick'));
      close();
      if (b) {
        refreshHeaderAvatar();
        App.rerender();
        Util.toast('已切换到「' + b.name + '」', 'ok');
      }
    });
    root.querySelector('#sheetManage').addEventListener('click', function () {
      close();
      showTab('settings');
    });
  }

  function showOnboarding() {
    var s = Storage.get();
    if (s.settings.privacyAccepted) return;
    var root = document.getElementById('modalRoot');
    if (!root) return;

    var draft = {
      role: (s.settings.caregiver && s.settings.caregiver.role) || null,
      name: (s.settings.caregiver && s.settings.caregiver.name) || '',
      stage: s.settings.stage || null,
      baby: s.settings.baby || { sex: 'boy', birthDate: null, preterm: false, birthGestWeeks: 40, nickname: '' }
    };

    function finish() {
      s.settings.caregiver = (draft.role || draft.name)
        ? { role: draft.role, name: (draft.name || '').slice(0, 12) } : null;
      s.settings.baby = draft.baby;
      s.settings.stage = draft.stage;
      s.settings.privacyAccepted = true;
      s.settings.onboardingDone = true;
      /* 第 80 次（宝宝档案）：引导里填的名字/生日同步进当前宝宝档案（无档案自动播种） */
      if (Storage.syncBabyFromSettings) Storage.syncBabyFromSettings();
      Storage.save();
      root.innerHTML = '';
      document.body.classList.remove('ob-open');
      refreshHeaderAvatar();
      rerender();
      Util.toast((draft.role || draft.baby.birthDate)
        ? '已按你的设置准备好，之后随时可以在设置里改。'
        : '先跳过也没关系，之后在设置里补就行。', 'ok');
    }

    /* ============================================================
       第 149 次（引导重设计）：原先是浮在首页上的弹窗（modal-mask + .ob-modal），
       背后首页透出来、按钮挤在卡片底部，第一眼像网页弹框。改为独立全屏欢迎流程：
       0 欢迎 → 1 称呼 → 2 阶段 → 3 宝宝/孕期信息 → 4 数据说明。
       顶部：返回箭头 + 分段进度条 + 跳过；中部：大标题 + 一句说明 + 大卡片选项；
       底部：通栏主按钮（贴安全区）。步间横向推入动画，减少动态效果时关闭。
       保留原有 id / data-ob / data-stage / data-role / data-sex，回归测试与 collectStep 不受影响。
       ============================================================ */
    var step = 0, lastStep = 0;
    var TOTAL = 4; /* 进度条只数 1–4，欢迎页不计 */
    var obRoot = document.getElementById('obRoot');
    if (!obRoot) { obRoot = document.createElement('div'); obRoot.id = 'obRoot'; document.body.appendChild(obRoot); }
    root = obRoot; /* collectStep / 提醒逻辑沿用 root 查询 */
    document.body.classList.add('ob-open');

    function bodyOf(n) {
      if (n === 0) return obWelcome();
      if (n === 1) return stepOneBody(draft);
      if (n === 2) return stepStageBody(draft);
      if (n === 3) return stepTwoBody(draft);
      return stepThreeBody();
    }

    function chrome(n) {
      if (n === 0) return '';
      var bars = '';
      for (var i = 1; i <= TOTAL; i++) bars += '<i class="' + (i <= n ? 'on' : '') + '"></i>';
      return '<div class="ob-top">'
        + '<button type="button" class="ob-icon-btn" data-ob="back" aria-label="上一步">' + (global.icon ? global.icon('back') : '‹') + '</button>'
        + '<div class="ob-progress" role="progressbar" aria-valuemin="1" aria-valuemax="' + TOTAL + '" aria-valuenow="' + n + '" aria-label="第 ' + n + ' 步，共 ' + TOTAL + ' 步">' + bars + '</div>'
        + (n < TOTAL ? '<button type="button" class="ob-skip" data-ob="skip">跳过</button>' : '<span class="ob-skip-ph"></span>')
        + '</div>';
    }

    function renderStep() {
      var dir = step >= lastStep ? 'fwd' : 'back';
      lastStep = step;
      obRoot.innerHTML = '<div class="ob-screen ob-step-' + step + '" role="dialog" aria-modal="true" aria-label="首次设置">'
        + chrome(step)
        + '<div class="ob-body ob-in-' + dir + '">' + bodyOf(step) + '</div></div>';
      Util.bindDateSliders(obRoot);
      var h = obRoot.querySelector('h2'); if (h) { h.setAttribute('tabindex', '-1'); try { h.focus({ preventScroll: true }); } catch (e) {} }

      function pick(sel, attr, apply) {
        Array.prototype.forEach.call(obRoot.querySelectorAll(sel), function (btn) {
          btn.addEventListener('click', function () {
            apply(btn.getAttribute(attr));
            Array.prototype.forEach.call(obRoot.querySelectorAll(sel), function (x) { x.classList.remove('active'); x.setAttribute('aria-pressed', 'false'); });
            btn.classList.add('active'); btn.setAttribute('aria-pressed', 'true');
            var hint = obRoot.querySelector('#obStageHint');
            if (hint && attr === 'data-stage') hint.textContent = draft.stage === 'pregnancy'
              ? '下一步会问小名，预产期之后在「孕期」页填。' : '下一步会问宝宝的出生日期，疫苗排期、生长曲线都要用它。';
          });
        });
      }
      pick('#obRole [data-role]', 'data-role', function (v) { draft.role = v; });
      pick('#obStage [data-stage]', 'data-stage', function (v) { draft.stage = v; });
      pick('#obSex [data-sex]', 'data-sex', function (v) { draft.baby.sex = v || 'boy'; draft.baby.sexUnknown = (v === ''); });

      Array.prototype.forEach.call(obRoot.querySelectorAll('[data-ob]'), function (btn) {
        btn.addEventListener('click', function () {
          var act = btn.getAttribute('data-ob');
          if (act === 'skip') { collectStep(); finish(); return; } /* 跳过 = 已填的保留、其余留空，功能不受影响 */
          if (act === 'next' || act === 'back') {
            collectStep();
            if (act === 'back' && step === 0) return;
            /* 第 146 次（P0-5）：离开宝宝信息页时还没填生日 → 先温和提醒一次，再点一次即可继续 */
            if (act === 'next' && step === 3 && draft.stage !== 'pregnancy' && !draft.baby.birthDate && !draft._birthNudged) {
              draft._birthNudged = true;
              var nudge = obRoot.querySelector('#obBirthNudge');
              if (nudge) { nudge.hidden = false; }
              var bi = obRoot.querySelector('#obBirth');
              if (bi && bi.focus) bi.focus();
              return;
            }
            step += (act === 'next' ? 1 : -1);
            renderStep();
            return;
          }
          if (act === 'done') { collectStep(); finish(); }
        });
      });
    }

    /* 只读当前这一步的输入，避免未渲染的字段被清空 */
    function collectStep() {
      if (step === 1) {
        var nm = root.querySelector('#obName');
        if (nm) draft.name = nm.value.trim();
      } else if (step === 3) {
        var nick = root.querySelector('#obNick');
        var birth = root.querySelector('#obBirth');
        var pre = root.querySelector('#obPreterm');
        if (nick) draft.baby.nickname = nick.value.trim().slice(0, 12);
        if (birth) draft.baby.birthDate = birth.value || null;
        if (pre) draft.baby.preterm = !!pre.checked;
      }
    }
    renderStep();
  }

  /* 引导：大卡片选项（第 149 次）——图标 + 标题 + 一行说明，整卡可点 */
  function obCard(attr, val, cur, ico, title, sub) {
    var on = (cur === val);
    return '<button type="button" class="ob-card' + (on ? ' active' : '') + '" ' + attr + '="' + val + '" aria-pressed="' + on + '">'
      + '<span class="ob-card-ico">' + (global.icon ? global.icon(ico) : '') + '</span>'
      + '<span class="ob-card-txt"><b>' + title + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</span>'
      + '<span class="ob-card-check">' + (global.icon ? global.icon('check') : '') + '</span></button>';
  }
  function obFoot(label, act) {
    return '<div class="ob-foot"><button type="button" class="btn btn-primary ob-cta" data-ob="' + (act || 'next') + '">' + label + '</button></div>';
  }
  function obWelcome() {
    return '<div class="ob-hero">'
      + '<img class="ob-logo" src="assets/icon-192.png" alt="" width="112" height="112">'
      + '<h2>宝妈助手</h2>'
      + '<p class="ob-lead">喂奶、睡眠、尿布、疫苗，<br>单手几秒记一笔。</p>'
      + '<ul class="ob-points">'
      + '<li>' + (global.icon ? global.icon('clock') : '') + '<span>首页一键快记，夜里也不用找</span></li>'
      + '<li>' + (global.icon ? global.icon('vaccine') : '') + '<span>按生日自动排疫苗与体检</span></li>'
      + '<li>' + (global.icon ? global.icon('heart') : '') + '<span>数据只存在这台手机，不注册</span></li>'
      + '</ul></div>'
      + obFoot('开始设置') ;
  }

  /* 引导第 2 步：阶段 */
  function stepStageBody(draft) {
    return '<div class="ob-main"><h2>你现在处于哪个阶段？</h2>'
      + '<p class="ob-sub">只影响接下来问什么、首页先放哪些记录。选错了随时能在设置里改。</p>'
      + '<div class="ob-cards" id="obStage">'
      + obCard('data-stage', 'pregnancy', draft.stage, 'pregnancy', '孕期中', '孕周、产检、胎动、宫缩')
      + obCard('data-stage', 'baby', draft.stage, 'feeding', '宝宝已出生', '喂养、睡眠、尿布、疫苗、生长')
      + '</div>'
      + '<p class="ob-sub ob-sub-sm" id="obStageHint">' + (draft.stage === 'pregnancy'
        ? '下一步会问小名，预产期之后在「孕期」页填。' : (draft.stage === 'baby' ? '下一步会问宝宝的出生日期，疫苗排期、生长曲线都要用它。' : '')) + '</p></div>'
      + obFoot('下一步');
  }

  /* 导出全部数据（可迁移格式 JSON）。
     第一次导出前给一次性明文风险告知（U-41）：导出文件含可识别的母婴健康数据，
     请勿存放在公共或自动同步的目录。之后不再打断。 */
  function doExport() {
    var text = Storage.exportJSON();
    Util.download('宝妈助手数据_' + Util.todayISO() + '.json', text, 'application/json');
    /* 记录上次导出时间，供备份提醒与设置页展示 */
    var s = Storage.get();
    s.settings.lastExportISO = Util.todayISO();
    Storage.save();
  }

  function exportAll() {
    var s = Storage.get();
    if (s.settings.exportNoticeShown) { doExport(); return; }
    Util.confirm({
      title: '导出前提醒',
      message: '导出文件是明文，包含可识别的母婴健康数据。请存到你自己信任的位置，不要放在公共目录或会自动同步到云端的文件夹里。',
      okText: '继续导出',
      cancelText: '暂不导出',
      onConfirm: function () {
        s.settings.exportNoticeShown = true;
        Storage.save();
        doExport();
      }
    });
  }

  /* P2-17：导入前差异预览——先告诉用户「现有多少条 → 将被替换为多少条」，
     配合阻断确认（U-33 同款：后果说明 + 先导出出口），避免误导入清空辛苦记录。 */
  function countRecords(obj) {
    var arrays = ['feedings', 'sleeps', 'diapers', 'meds', 'milestones', 'growth',
      'contractions', 'periods', 'metrics', 'moods'];
    var n = 0;
    arrays.forEach(function (k) { if (Array.isArray(obj && obj[k])) n += obj[k].length; });
    var deep = [['finance', 'records'], ['prenatal', 'records'], ['prenatal', 'checks'], ['packing', 'items']];
    deep.forEach(function (p) {
      var sub = obj && obj[p[0]];
      if (sub && Array.isArray(sub[p[1]])) n += sub[p[1]].length;
    });
    if (obj && obj.vaccines && obj.vaccines.done) n += Object.keys(obj.vaccines.done).length;
    /* 第 146 次：其他宝宝的记录收在 babies[].rec 里，导入差异预览也要算上 */
    if (obj && Array.isArray(obj.babies)) {
      obj.babies.forEach(function (b) { if (b && b.rec && typeof b.rec === 'object') n += countRecords(b.rec); });
    }
    return n;
  }

  function importAll() {
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'application/json,.json';
    inp.addEventListener('change', function () {
      if (!inp.files || !inp.files[0]) return;
      var reader = new FileReader();
      reader.onload = function () {
        var text = String(reader.result);
        function doImport() {
          try {
            Storage.importJSON(text);
            Util.toast('导入成功，已恢复全部数据。', 'ok');
            rerender();
          } catch (e) {
            Util.toast('导入失败：' + (e && e.message ? e.message : e), 'error');
          }
        }
        var incoming = null;
        try { incoming = JSON.parse(text); } catch (e) { /* 让 importJSON 给出解析错误 */ }
        if (incoming && typeof incoming === 'object') {
          var cur = countRecords(Storage.get());
          var inc = countRecords(incoming);
          Util.confirm({
            title: '导入前确认',
            message: '导入会覆盖本机全部数据：现有 ' + cur + ' 条记录，将被替换为文件中的 ' + inc + ' 条，覆盖后无法找回。',
            okText: '仍要导入',
            cancelText: '取消',
            danger: true,
            extra: { text: '先导出现有数据', onClick: function () { exportAll(); } },
            onConfirm: doImport
          });
        } else {
          doImport();
        }
      };
      reader.readAsText(inp.files[0]);
    });
    inp.click();
  }

  /* 不可逆批量操作：后果说明 + 立即导出口 + 防误触（U-12 / U-33 阻断分支）。
     确认框里直接给「先导出备份」按钮，不让用户先备份还得退出弹层。 */
  function resetAll() {
    Util.confirm({
      title: '清空全部数据',
      message: '将删除本机保存的全部记录，此操作不可恢复。',
      okText: '仍要清空',
      cancelText: '取消',
      danger: true,
      extra: { text: '先导出备份', onClick: function () { exportAll(); } },
      onConfirm: function () {
        Storage.reset();
        Util.toast('已清空全部数据。', 'ok');
        rerender();
      }
    });
  }

  /* ---------------- U-05 记录成本埋点（纯本地验收指标） ----------------
     报告把「单次记录 ≤2 次点击、≤1 秒」写成可核查的验收线，而不是体验目标。
     这里只在本机统计：从进入记录模块到数据真正落盘，点了多少次、花了多少毫秒。
     不联网、不上报、不接第三方 SDK；样本只保留最近 50 条，并随导出一起走。 */
  var QUICK_MODULES = { feeding: 1, sleep: 1, diaper: 1, meds: 1, contraction: 1, growth: 1, mood: 1 };
  var trace = null;

  function nowMs() {
    return (global.performance && global.performance.now) ? global.performance.now() : Date.now();
  }
  function dataCount() {
    try { return Storage.stats().reduce(function (s, t) { return s + t.count; }, 0); }
    catch (e) { return 0; }
  }
  function traceStart(id) {
    if (!QUICK_MODULES[id]) { trace = null; return; }
    trace = { id: id, t0: nowMs(), clicks: 0, before: dataCount() };
  }
  function traceClick() { if (trace) trace.clicks++; }
  function traceFinish() {
    if (!trace) return;
    if (dataCount() <= trace.before) return; /* 只是设置类保存，不算一次记录 */
    var ms = Math.round(nowMs() - trace.t0);
    var d = Storage.get();
    if (!d.metrics) d.metrics = { records: [] };
    d.metrics.records.push({
      mod: trace.id, clicks: trace.clicks, ms: ms,
      pass: (trace.clicks <= 2 && ms <= 1000), at: Util.nowLocal()
    });
    if (d.metrics.records.length > 50) d.metrics.records = d.metrics.records.slice(-50);
    /* 必须绑定 this：裸调用 rawSave() 在严格模式下 this=undefined，this.data 抛 TypeError
       被 save() 的 catch 捕获，导致每次快速记录成功后紧跟一条假的「保存失败」错误 toast
       （且埋点数据未即时落盘）。2026-09-24 由 UX-P0 回归测试（G 组）发现并修复。 */
    rawSave.call(Storage);
    trace = null;
  }

  /* 保存成功即视为一次记录完成：用「数据条数是否变多」判定，
     避免把主题切换、宝宝信息等非记录保存也算进来。 */
  var rawSave = Storage.save;
  Storage.save = function () {
    var ok = rawSave.apply(Storage, arguments);
    if (ok) traceFinish();
    return ok;
  };

  /** 验收汇总：达标率 = 点击 ≤2 且耗时 ≤1 秒 的样本占比（U-05） */
  function metricsSummary() {
    var recs = (Storage.get().metrics && Storage.get().metrics.records) || [];
    if (!recs.length) return null;
    var n = recs.length, pass = 0, cSum = 0, mSum = 0;
    recs.forEach(function (r) { if (r.pass) pass++; cSum += r.clicks; mSum += r.ms; });
    return {
      n: n, pass: pass, passRate: Math.round(pass / n * 100),
      avgClicks: Math.round(cSum / n * 10) / 10,
      avgMs: Math.round(mSum / n),
      recent: recs.slice(-5).reverse()
    };
  }

  /* U-04 周回顾提醒：只有用户主动开启后才出现，每周最多 1 次，
     内容必须是「回报兑现」（摘要已生成）而不是催促；关掉不损失任何功能
     ——回顾本身在「日期记录」页随时可看，不需要提醒也能拿到。 */
  function maybeWeeklyReview() {
    var s = Storage.get();
    if (!s.settings.weeklyReviewEnabled) return;
    if (!Storage.hasData()) return;
    var last = s.settings.lastReviewISO;
    if (last && Util.daysBetween(last, Util.todayISO()) < 7) return;
    s.settings.lastReviewISO = Util.todayISO();
    Storage.save();
    Util.toast('本周记录摘要已生成。', 'ok', {
      label: '去看看',
      onClick: function () { showTab('calendar'); }
    });
  }

  /* 引导第 1 步：身份（只影响称呼，不做画像） */
  function stepOneBody(draft) {
    return '<div class="ob-main"><h2>谁在用宝妈助手？</h2>'
      + '<p class="ob-sub">只用来决定怎么称呼你。不建账号，不收集姓名和手机号。</p>'
      + '<div class="ob-cards" id="obRole">'
      + obCard('data-role', 'mom', draft.role, 'heart', '妈妈', '')
      + obCard('data-role', 'dad', draft.role, 'mood', '爸爸', '')
      + obCard('data-role', 'other', draft.role, 'home', '其他照护者', '奶奶、外婆、育儿嫂……')
      + '</div>'
      + '<label class="ob-field">首页怎么叫你？<span class="ob-opt">可留空</span>'
      + '<input type="text" id="obName" maxlength="12" placeholder="比如：豆豆妈" value="' + Util.escapeHtml(draft.name || '') + '"></label></div>'
      + obFoot('下一步');
  }

  /* 引导第 3 步：宝宝 / 孕期信息（全部可留空） */
  function stepTwoBody(draft) {
    var b = draft.baby;
    var preg = (draft.stage === 'pregnancy');
    function sexBtn(v, label, on) {
      return '<button type="button" class="seg-btn' + (on ? ' active' : '') + '" data-sex="' + v + '" aria-pressed="' + on + '">' + label + '</button>';
    }
    return '<div class="ob-main"><h2>' + (preg ? '给宝宝起个小名吧' : '介绍一下宝宝') + '</h2>'
      + '<p class="ob-sub">' + (preg ? '预产期之后在「孕期」页填。现在都可以留空。'
        : '生日用来排疫苗、算月龄、画生长曲线，其余都可以以后再补。') + '</p>'
      + '<div class="ob-group">'
      + '<label class="ob-field">小名<span class="ob-opt">可留空</span><input type="text" id="obNick" maxlength="12" placeholder="比如：小汤圆" value="' + Util.escapeHtml(b.nickname || '') + '"></label>'
      + (preg ? '' :
        Util.birthInput({ id: 'obBirth', title: '出生日期', value: b.birthDate || '' })
        + '<p class="ob-nudge" id="obBirthNudge" role="status" hidden>还没填生日：疫苗排期和生长曲线都要用它。不确定的话，再点一次「下一步」先跳过，之后在「疫苗」或「生长」页补。</p>'
        + '<div class="ob-field"><span>性别</span><div class="seg" id="obSex">'
        + sexBtn('boy', '男宝', b.sex !== 'girl' && !b.sexUnknown)
        + sexBtn('girl', '女宝', b.sex === 'girl' && !b.sexUnknown)
        + sexBtn('', '暂不确定', !!b.sexUnknown) + '</div></div>'
        + '<label class="ob-switch"><span><b>早产儿</b><small>生长曲线会按矫正月龄来算</small></span>'
        + '<input type="checkbox" id="obPreterm" role="switch"' + (b.preterm ? ' checked' : '') + '><i aria-hidden="true"></i></label>')
      + '</div></div>'
      + obFoot('下一步');
  }

  /* 引导第 4 步：数据风险与能力边界（R-05 / U-32 / U-37）——必须在产生数据之前讲完。
     第 149 次：三行图标要点 + 可展开的完整说明，关键信息（只有一份、要自己导出）仍然在首屏。 */
  function stepThreeBody() {
    function row(ico, t, d) {
      return '<li><span class="ob-row-ico">' + (global.icon ? global.icon(ico) : '') + '</span><span><b>' + t + '</b><small>' + d + '</small></span></li>';
    }
    return '<div class="ob-main"><h2>你的记录只存在这台手机上</h2>'
      + '<p class="ob-sub">开始前花 10 秒了解一下，以后不会再弹出。</p>'
      + '<ul class="ob-rows">'
      + row('heart', '纯本地，不上传', '不注册、不联网，没有服务器，也没有广告和第三方 SDK。')
      + row('bell', '只有一份', '清理浏览器、换手机都会丢失。iPhone 上长期不打开，约 7 天后可能被系统清掉。')
      + row('export', '记得定期导出', '在「设置 → 导出」存成文件，放在你信任的地方。文件是明文。')
      + '</ul>'
      + '<details class="ob-more"><summary>完整说明</summary>'
      + '<p>本应用不提供多设备同步、云端备份或家人实时共享。导出、备份和浏览器持久存储都只是「可以申请、可能被拒绝」，不构成安全保证；'
      + '也不做加密：没有账号体系，忘了密码就会多一条永久丢数据的路。健康数据仅供参考，重要的判断请遵医嘱。</p></details></div>'
      + obFoot('我已了解，开始使用', 'done');
  }

  global.App = {
    showTab: showTab,
    rerender: rerender,
    refreshHeaderAvatar: refreshHeaderAvatar, /* 第 80 次：设置页改照片/切宝宝后刷新左上角 */
    /* C7（操作便捷性研究）：一次性日期覆盖。日历空日「补记」入口设置它再跳模块，
       模块在 render 时读取并立即清空（消费式），保存即落到该日期。默认 null。 */
    pendingDate: null,
    startOnboarding: showOnboarding, /* 设置页「重新开始首次引导」入口（调用前需先把 privacyAccepted 置回 false） */
    exportAll: exportAll,
    importAll: importAll,
    resetAll: resetAll,
    applyTheme: applyTheme,
    buildTabbar: buildTabbar, /* 第 97 次：设置页改「底栏快捷入口」后即时重建底栏 */
    setTheme: setTheme, /* 设置 · 外观 的主题切换（auto/light/dark） */
    setFontScale: setFontScale, /* 设置 · 外观 · 字号（normal/lg/xl，第 103 次） */
    fontScale: fontScale, /* 供 QA 断言当前档位 */
    hcMode: hcMode, /* 设置 · 外观 · 高对比模式（第 118 次，opt-in） */
    setHcMode: setHcMode,
    _bindQuickDock: buildQuickDock, /* QA：重置缓存桩后重绑 dock（幂等，同元素不叠加） */
    metricsSummary: metricsSummary,
    _fedDefaults: fedDefaults, /* 第 146 次：首页首屏快记与「＋」dock 共用喂养默认值 */
    _countRecords: countRecords, /* QA：导入差异预览的计数函数（导出前确认共用） */
    stageOf: stageOf, /* 阶段判定（settings.stage 优先，缺省回落到客观数据） */
    pregnancyWeekOf: pregnancyWeekOf,
    setStage: function (st) {
      if (st !== 'pregnancy' && st !== 'baby' && st !== null) return;
      Storage.get().settings.stage = st;
      Storage.save();
    }
  };

  /* ---------------- 全局快捷记录 dock（第 40 次，回应「操作以填写为主」的反馈） ----------------
     展开式 FAB：默认只有一个「＋」，点开才显示动作列——用「多一次刻意点击」换「不放误触面」，
     落地原 P2-18 的顾虑（真机误触）。动作都是零表单一键即记（喂养用上次默认值），带撤销。 */
  var qdBasket = { fab: null }; /* 记住已绑定的 FAB 元素：同一元素不重复绑（测试重置缓存后可重绑） */

  /* 第 103 次（OP-GAP-02）：快记补 amountBm/amountFm。
     起因是第七版审计的缺口——喂养页落库会写 amountBm/amountFm 两根瓶喂滑杆的值
     （feeding.js:346-347），但快记只写合计 amount。后果是「上次记的是母乳 80 + 配方奶 40」
     时，快记会落一条 amount=120 而两根分量为 null 的记录，喂养页明细随即退化成
     「120 ml/g」（feeding.js:177 的 if 不成立），母乳/配方奶的配比就此丢失。

     为什么这是「不新增字段」而是「补齐已有字段」：amountBm/amountFm 早已在
     feeding.js 的记录结构里（line 332 初始化、line 346-347 赋值），storage.js 无字段白名单
     （grep amountBm 在 storage.js 零命中），所以这里只是让快记与喂养页写同一组字段，
     DATA_VERSION 不动、落库结构不动、旧数据零迁移。

     写法上沿用喂养页的同一口径：bottle/formula 才拆两根，母乳/吸奶/辅食不拆；
     amount 仍是两者的和，供统计（feeding.js:51、home.js:105 都只读 amount，口径不变）。 */
  function fedDefaults() {
    var last = (Storage.get().feedings || []).slice()
      .sort(function (a, b) { return new Date(b.start) - new Date(a.start); })[0];
    var t = (last && last.type) || 'breast';
    var side = (last && last.side) || 'left';
    var dur = (last && last.durationMin) || (t === 'breast' ? 15 : null);
    var amt = (last && last.amount) || (t !== 'breast' && t !== 'pump' ? 120 : null);
    var name = { breast: '母乳', bottle: '奶瓶', formula: '奶粉', pump: '吸奶', solid: '辅食'}[t] || '母乳';
    var sideT = side === 'right' ? '右侧' : (side === 'both' ? '双侧' : '左侧');

    /* 瓶喂沿用上次的母乳/配方奶配比；上次只有合计（旧数据或他从别处导入）时，
       按喂养页 line 231 的同一兜底把合计记到母乳侧——两处口径必须一致，
       否则快记与喂养页会互相把对方的值当成「没拆过」。 */
    var amtBm = null, amtFm = null;
    if (t === 'bottle' || t === 'formula') {
      if (last && (last.amountBm != null || last.amountFm != null)) {
        amtBm = (last.amountBm != null) ? last.amountBm : null;
        amtFm = (last.amountFm != null) ? last.amountFm : null;
      } else if (amt) {
        amtBm = amt;
      }
    }

    /* 明细文案同步显示配比：快记按钮上写「母乳 80 · 配方奶 40」，
       用户点之前就知道这条会记成什么——这正是快记「零表单」的前提，
       若只显示合计 120，用户无法预判这次记的是哪种奶。 */
    var amtDetail;
    if (amtBm || amtFm) {
      amtDetail = (amtBm ? '母乳 ' + amtBm : '') + (amtBm && amtFm ? ' · ' : '')
        + (amtFm ? '配方奶 ' + amtFm : '') + ' ml';
    } else {
      amtDetail = amt + ' ml';
    }
    var detail = t === 'breast'
      ? (dur + ' 分钟 · ' + sideT)
      : (t === 'pump' ? ((amt ? amt + 'ml' : '') + (amt && dur ? ' · ' : '') + (dur ? dur + ' 分' : '') + ' · ' + sideT)
        : amtDetail);
    return {
      rec: { type: t, side: (t === 'solid') ? null : side, durationMin: dur,
        amount: amt, amountBm: amtBm, amountFm: amtFm },
      label: name + ' ' + detail
    };
  }

  function buildQuickDock() {
    var root = document.getElementById('quickDock');
    if (!root) return;
    var fab = root.querySelector('#qdFab');
    if (!fab || fab === qdBasket.fab) return; /* 已绑过同一元素：不叠加监听 */
    qdBasket.fab = fab;
    /* 第 43 次：遮罩用真实元素，不再用 ::before 伪元素——伪元素的 target 是宿主元素本身，
       无法与「点 dock 自身」区分，导致点遮罩永远收不起。 */
    /* 第 135 次：遮罩已移到 #app 之外（胶囊的 backdrop-filter 会为 fixed 子元素
       创建包含块，留在里面就盖不住全屏），因此从 document 取。 */
    var mask = document.getElementById('qdMask');

    function close() {
      root.classList.remove('open');
      /* 第 135 次：遮罩可见性挂在 body.qd-open 上（它不再是 #quickDock 的子节点） */
      if (document.body && document.body.classList) document.body.classList.remove('qd-open');
      fab.setAttribute('aria-expanded', 'false');
    }

    /* 第 43 次：外部关闭。遮罩用真实元素 #qdMask——旧版是 ::before 伪元素，
       撑满全屏但事件 target 是宿主 #quickDock 本身，`root.contains(e.target)` 恒为
       true，点遮罩永远收不起。
       遮罩点击只在构建时绑一次（不随开合反复增删），document 监听才需要开合时挂卸。 */
    if (mask && mask.addEventListener) {
      mask.addEventListener('click', function () {
        if (root.classList.contains('open')) { close(); detachOutside(); }
      });
    }
    function onDocDown(e) {
      if (!root.classList.contains('open')) { detachOutside(); return; }
      if (root.contains(e.target)) return;
      /* 第 100 次：竖排 dock 模式下「＋」在底栏里（#qdFab 已隐藏但不在 root 内）。
         点它时不先关——否则 pointerdown 先 close、click 再 open，永远合不上；
         转发的 click 自带开/合判断，这里放行即可。 */
      if (e.target && e.target.closest && e.target.closest('[data-qd-toggle]')) return;
      close(); detachOutside();
    }
    function onKey(e) { if (e.key === 'Escape') { close(); detachOutside(); } }
    function attachOutside() {
      document.addEventListener('pointerdown', onDocDown, true);
      document.addEventListener('keydown', onKey, true);
    }
    function detachOutside() {
      if (document.removeEventListener) {
        document.removeEventListener('pointerdown', onDocDown, true);
        document.removeEventListener('keydown', onKey, true);
      }
    }
    function saveFetal() {
      var d = Storage.get();
      var rec = { id: Util.uid(), time: Util.nowLocal() };
      d.fetal.push(rec);
      if (Storage.save()) Util.toast('已记录一次胎动', 'ok', { label: '撤销', onClick: function () {
        for (var i = d.fetal.length - 1; i >= 0; i--) if (d.fetal[i].id === rec.id) { d.fetal.splice(i, 1); break; }
        Storage.save(); rerender(); Util.toast('已撤销', 'ok');
      } });
      rerender();
    }
    function saveOne(arrName, rec, msg) {
      var d2 = Storage.get();
      d2[arrName].push(rec);
      if (Storage.save()) Util.toast(msg, 'ok', { label: '撤销', onClick: function () {
        var arr = Storage.get()[arrName];
        for (var i = arr.length - 1; i >= 0; i--) if (arr[i].id === rec.id) { arr.splice(i, 1); break; }
        Storage.save(); rerender(); Util.toast('已撤销', 'ok');
      } });
      close(); detachOutside(); rerender();
    }

    fab.addEventListener('click', function () {
      /* 第 43 次修正：再点 FAB 应当「收起」，而不是重新展开。
         此前 FAB 的 click 无条件重建动作列并 add('open')，等于永远关不掉。 */
      if (root.classList.contains('open')) { close(); detachOutside(); return; }
      var d = Storage.get();
      var wk = (function () {
        var pg = d.pregnancy || {};
        var base = pg.lmp || (pg.dueDate ? Util.addDays(pg.dueDate, -280) : null);
        return base ? Math.floor(Util.daysBetween(base, Util.todayISO()) / 7) : null;
      })();
      var fed = fedDefaults();
      /* 第 84 次：补「尿布：拉了」（pee/poop 是尿布两大类，此前快记只有「尿了」）；
         动作加识别图标（读得快）+ 内联 --i 序号（CSS 逐项 stagger 入场用） */
      var acts = [
        { id: 'qdFeed', ico: 'feeding', label: '喂养：' + fed.label },
        { id: 'qdDiaper', ico: 'pee', label: '尿布：尿了' },
        { id: 'qdPoop', ico: 'poop', label: '尿布：拉了' },
        { id: 'qdMeds', ico: 'meds', label: '吃药：维生素 D3' }
      ];
      if (wk !== null) acts.push({ id: 'qdFetal', ico: 'fetal', label: '胎动 +1' });
      var list = root.querySelector('#qdActions');
      list.innerHTML = acts.map(function (a, i) {
        return '<button type="button" class="qd-action" id="' + a.id + '" style="--i:' + i + '">'
          + (global.icon ? global.icon(a.ico, 'qd-ico') : '')
          + '<span>' + Util.escapeHtml(a.label) + '</span></button>';
      }).join('');
      root.classList.add('open');
      if (document.body && document.body.classList) document.body.classList.add('qd-open');
      fab.setAttribute('aria-expanded', 'true');

      var f0 = fed.rec;
      list.querySelector('#qdFeed').addEventListener('click', function () {
        /* 第 103 次（OP-GAP-02）：补 amountBm/amountFm，与喂养页写同一组字段。
           amount 仍是两者的和——统计侧（feeding.js:51、home.js:105）只读它，口径不变。 */
        saveOne('feedings', { id: Util.uid(), type: f0.type, start: Util.nowLocal(),
          durationMin: f0.durationMin, amount: f0.amount,
          amountBm: f0.amountBm || null, amountFm: f0.amountFm || null,
          side: f0.side, note: null }, '已快记：' + fed.label + '（可在喂养页改）');
      });
      list.querySelector('#qdDiaper').addEventListener('click', function () {
        saveOne('diapers', { id: Util.uid(), type: 'pee', time: Util.nowLocal(), note: null }, '已快记：尿布 · 尿');
      });
      list.querySelector('#qdPoop').addEventListener('click', function () {
        saveOne('diapers', { id: Util.uid(), type: 'poop', time: Util.nowLocal(), note: null }, '已快记：尿布 · 便');
      });
      list.querySelector('#qdMeds').addEventListener('click', function () {
        saveOne('meds', { id: Util.uid(), name: '维生素 D3', time: Util.nowLocal(), note: null }, '已快记：维生素 D3');
      });
      var qdF = list.querySelector('#qdFetal');
      if (qdF) qdF.addEventListener('click', function () { close(); detachOutside(); saveFetal(); });

      attachOutside();
    });
  }

  function init() {
    Storage.load();
    /* 第 116 次：独立模式标记必须在【首屏渲染前】写入。
       晚于 buildTabbar()/首屏 showTab() 就会让首帧用错的内边距画一遍顶栏，
       用户看到「先挤后松」的跳变。放在 init 最开头，与 Storage.load() 同级。 */
    syncStandalone();
    /* 第 116 次：绑定边缘侧滑返回。必须早于首次 showTab('home')——
       绑定后 historyDepth 从 0 起，首页不响应侧滑（没有上一层），
       与 iOS「在根页面不触发侧滑」一致。 */
    bindSwipeBack();

    /* 第 74 次（G1）：损坏自愈后的告知——此前 _corruptRecovered 只置位、无消费方。
       toast 只在恢复后的第一次启动弹出（corruptNoticeShown 设置键），
       设置页「数据与备份」的常驻状态行兜底，保证知情权不依赖一次性提示。 */
    if (Storage._corruptRecovered && !Storage.get().settings.corruptNoticeShown) {
      Storage.get().settings.corruptNoticeShown = true;
      Storage.save();
      if (global.Util && Util.toast) {
        Util.toast('检测到本地数据曾损坏，已自动恢复出厂状态；损坏原文已在本机备份，可在「设置 · 数据与备份」查看。', 'error');
      }
    }
    applyTheme();
    buildTabbar();
    /* 顶栏主题按钮已移除（第 40 次），主题入口在「设置 · 外观」；保留空位注释防回填 */

    /* 跟随系统：系统外观变化时（含 Web 深浅色切换），system 模式下实时重算主题 */
    try {
      if (global.matchMedia) {
        var mqDark = global.matchMedia('(prefers-color-scheme: dark)');
        var onSysTheme = function () { if (themeMode() === 'system') applyTheme(); };
        if (mqDark.addEventListener) mqDark.addEventListener('change', onSysTheme);
        else if (mqDark.addListener) mqDark.addListener(onSysTheme);
      }
    } catch (e) { /* 老环境无该 API 则只在启动时取一次 */ }

    /* 全局快捷记录 dock（展开式 FAB，所有页面可用） */
    buildQuickDock();
    /* 模块页返回按钮（第 42 次）：就近的「回首页」出口，不依赖底栏 */
    /* 第 95 次：返回按钮改顶栏内圆形图标（与设置齿轮同语言），fixed 定位漂移根治。
       图标在这里注入；显示/隐藏仍由 showTab 切 hidden。 */
    var backBtn = document.getElementById('backBtn');
    if (backBtn) {
      backBtn.innerHTML = icon('back');
      /* 第 116 次：返回按钮改走 popHistory —— 与侧滑、系统返回键同一条出口。
         旧写法是 showTab('home')，会留下一条悬空 history 记录，
         导致按一次返回后，再按系统返回又「弹回」刚才那个模块。 */
      backBtn.addEventListener('click', function () {
        if (!popHistory()) showTab('home');
      });
    }
    /* 全局左上角宝宝头像（第 80 次重设计）：显示当前宝宝照片（未上传回落插画），
       多宝宝家庭点按即循环切换，单宝宝点按进设置（保持旧出口）。
       右上角新增设置齿轮——旧版右上角是天空大日期（已并入问候卡日期行）。 */
    var av = document.getElementById('avatarBtn');
    if (av) {
      av.setAttribute('aria-label', '切换宝宝');
      /* 第 82 次（用户反馈：左上角右上角都进设置，冗余）：左上角专司宝宝切换——
         点按打开底部宝宝面板（列表点选切换 + 管理入口），不再直接进设置。
         呈现语义：短打断 → 半高底部面板（sheet），不是整页跳转。 */
      av.addEventListener('click', openBabySheet);
      refreshHeaderAvatar();
    }
    /* 右上角设置齿轮（第 80 次）：只在首页显示（模块页右上角是返回按钮，
      见 CSS body.in-module .header-gear）。进设置的唯一顶栏出口就是它。 */
    var gear = document.getElementById('settingsBtn');
    if (gear) {
      gear.innerHTML = icon('settings');
      gear.addEventListener('click', function () { showTab('settings'); });
    }
    /* 顶栏滚动玻璃化（被动监听，不影响滚动性能） */
    window.addEventListener('scroll', syncHeader, { passive: true });
    syncHeader();

    /* PWA 离线缓存：仅在 http(s) 环境注册 Service Worker（「添加到主屏」后可离线秒开）。
       file:// 双击打开时浏览器不提供 SW，静默跳过——纯本地能力不受任何影响。
       三重守卫（navigator / serviceWorker / 协议）保证 QA 沙箱与老环境零报错。 */
    try {
      if (global.navigator && navigator.serviceWorker &&
          global.location && /^https?:$/.test(global.location.protocol)) {
        /* 第 145 次（用户两次反馈「改了没生效」）：
           sw.js 里已有 skipWaiting + clients.claim，新 SW 会立刻接管，
           但**当前这个页面**仍然跑着旧的 CSS/JS —— 用户要刷两次才看得到改动。
           这里补一条：检测到控制权变更（= 新版本已接管）就自动重载一次。
           守卫两处：① 首次安装（此前没有 controller）不重载，避免白刷一次；
                    ② 标记位防止极端情况下反复重载。 */
        var hadController = !!navigator.serviceWorker.controller;
        navigator.serviceWorker.addEventListener('controllerchange', function () {
          if (!hadController || global.__swReloaded) return;
          global.__swReloaded = true;
          if (global.location && global.location.reload) global.location.reload();
        });
        navigator.serviceWorker.register('sw.js').catch(function () {});
      }
    } catch (e) { /* SW 不可用不影响任何功能 */ }

    /* U-05：捕获阶段统计记录页内的点击次数（只在本机计数，不记录点了什么） */
    var viewEl = document.getElementById('view');
    if (viewEl) viewEl.addEventListener('click', traceClick, true);

    /* W 系列：刷新页面后音频必然已经停了，先把可能残留的 playing 标记清掉，
       不让首页磁贴 / 提醒卡显示一个不存在的「播放中」状态。 */
    if (global.Modules && global.Modules.whitenoise && global.Modules.whitenoise.resetStaleState) {
      global.Modules.whitenoise.resetStaleState();
    }
    showTab('home');
    Util.bindLongPressCopy(); /* 第 87 次：列表行长按复制该条记录（全局委托，一次绑定） */
    showOnboarding();
    maybeWeeklyReview();
  }

  /* 备份提醒：**已从首页撤除**（第 145 次）。
     第 59 次在这里放了一个「从未导出过 → 启动弹一次 toast」的提醒，
     第 142 次按用户要求把首页底部的备份状态行与提醒卡条目都挪进了设置页，
     但这条启动 toast 漏了 —— 它浮在底栏上方，正好压住模块磁贴
     （实测截图里盖住了「母乳/记录」那一行），而且与用户「备份提醒别放首页」的要求相悖。
     现在备份提示只出现在「设置 · 数据与备份」：无数据时写「还没有备份过数据，
     强烈建议现在导出一次」，超 14 天时由 Reminders.backupHint 补一句「已 N 天未备份」。
     安全网没有丢，只是不再在首页打扰。 */

  /* ================= 第 116 次：边缘侧滑返回 + history 集成 =================
     真机实测反馈「没有侧滑返回」。根因有二，都不是样式问题：
       ① 导航是纯 showTab() 单页切换，全程没碰过 history ——
          浏览器/系统因此不知道「还有上一层」，iOS 的边缘返回手势
          在 PWA standalone 里默认根本不触发；
       ② 应用内也没有任何手势实现。
     修法：把「进模块」登记成一条 history 记录，并在屏幕左缘加边缘滑动监听：
       - 左缘起手（起点 x < 24px）横向拖动时，实时跟手平移当前内容；
       - 拖过阈值（宽度 22% 或速度 > 0.5px/ms）判定为返回；
       - 松手后带动画归位，并让 #view 的进场动画反向淡出（不是瞬间跳），
         观感与 iOS 原生一致；
       - 右侧不做镜像：左缘返回是系统约定，右侧留给系统手势，避免双端打架。
     约束：
       - 只在「有上一层」（从首页/日历/设置进模块）时才允许侧滑，
         否则侧滑会退到空状态；
       - 模块内滚动时才响应，列表滚到中间时侧滑容易误触——
         这里不做复杂判断，只要求起手 x 落在最左24px 窄带内，
         已经是 iOS 的通行做法（列表内横向滚动不冲突，因为它们不贴左缘起手）；
       - passive:false + preventDefault 才会拦得住页面横向跟随，
         竖直方向不拦截，避免影响正常滚动。 */

  var SWIPE_EDGE = 24;      /* 起手区宽度（px）：仅屏幕最左侧这一条窄带 */
  var SWIPE_RATIO = 0.22;   /* 位移阈值：视口宽的 22% */
  var SWIPE_VEL = 0.5;      /* 速度阈值（px/ms），甩得够快就过 */
  var SWIPE_MAX = 0.88;     /* 最多跟到视口 88%，留一点底不飞出去 */
  var historyDepth = 0;     /* 已登记的模块层级（回到 0 时侧滑不再响应） */
  var swipeActive = false;
  var swipeId = null;
  var swipeStartX = 0, swipeStartY = 0, swipeStartT = 0, swipeLastX = 0, swipeLastT = 0;
  var swipeVel = 0;
  var swipeFired = false;   /* 是否已触发返回（避免一次手势跳两屏） */

  /** 登记一次「进入模块」：把当前页写进 history，再在下一层写一个占位。
      popstate 触发时回到上一层，浏览器的前进/后退也随之可用。 */
  function pushHistory(id) {
    if (!global.history || !global.history.pushState) return;
    try {
      global.history.pushState({ baoma: 1, id: id }, '');
      historyDepth++;
    } catch (e) { /* 极端内核禁pushState：侧滑降级为「只回到首页」 */ }
  }

  /** 退出当前模块：把 historyDepth 减到 0，并回退一条 history。
      侧滑与顶部返回按钮共用这个出口，保证两条路径行为一致。 */
  function popHistory() {
    if (historyDepth <= 0) return false;
    historyDepth--;
    try {
      if (global.history && global.history.go) global.history.go(-1);
      else showTab('home');
    } catch (e) { showTab('home'); }
    return true;
  }

  /** 跟手动画：x 是已拖动的像素，d=是否已判定为返回（决定是否回弹）。 */
  function animateSwipe(x, dismissing) {
    var view = document.getElementById('view');
    if (!view) return;
    try {
      if (dismissing) {
        view.style.transition = 'transform .22s cubic-bezier(.32,.72,0,1), opacity .22s linear';
        view.style.transform = 'translateX(' + x + 'px)';
        view.style.opacity = String(Math.max(0.4, 1 - x / window.innerWidth));
      } else {
        view.style.transition = 'transform .22s cubic-bezier(.32,.72,0,1)';
        view.style.transform = 'translateX(' + x + 'px)';
        view.style.opacity = '1';
      }
    } catch (e) { /* 极旧内核无 style.transform：放弃跟手，功能不受影响 */ }
  }

  function clearSwipeStyles() {
    var view = document.getElementById('view');
    if (!view) return;
    try {
      view.style.transition = '';
      view.style.transform = '';
      view.style.opacity = '';
    } catch (e) { /* 同上 */ }
  }

  function onSwipeStart(e) {
    if (historyDepth <= 0) return;                /* 没有上一层，不响应 */
    if (swipeActive) return;
    var t = e.touches && e.touches[0];
    if (!t) return;
    var vw = window.innerWidth || 1;
    if (t.clientX > SWIPE_EDGE && t.clientX < vw - SWIPE_EDGE) return; /* 只认左右最外侧窄带 */
    swipeActive = true;
    swipeFired = false;
    swipeId = t.identifier != null ? t.identifier : 0;
    swipeStartX = swipeLastX = t.clientX;
    swipeStartY = t.clientY;
    swipeStartT = swipeLastT = Date.now();
    swipeVel = 0;
  }

  function onSwipeMove(e) {
    if (!swipeActive) return;
    var t = null;
    if (e.touches) {
      for (var i = 0; i < e.touches.length; i++) {
        if ((e.touches[i].identifier != null ? e.touches[i].identifier : 0) === swipeId) { t = e.touches[i]; break; }
      }
    }
    if (!t) return;
    var dx = t.clientX - swipeStartX;
    var dy = t.clientY - swipeStartY;
    /* 竖直分量明显更大 → 判定为页面滚动，不拦截（让原生滚动正常跑） */
    if (!swipeFired && Math.abs(dy) > Math.abs(dx) * 1.2 && Math.abs(dy) > 12) { swipeActive = false; return; }
    if (dx <= 0) { swipeActive = false; clearSwipeStyles(); return; } /* 只处理右滑（从左缘往右拖） */

    var now = Date.now();
    var dt = Math.max(1, now - swipeLastT);
    swipeVel = (t.clientX - swipeLastX) / dt;
    swipeLastX = t.clientX; swipeLastT = now;

    var vw = window.innerWidth || 1;
    var x = Math.min(dx, vw * SWIPE_MAX);
    if (e.cancelable) e.preventDefault();
    swipeFired = true;
    animateSwipe(x, false);
  }

  function onSwipeEnd() {
    if (!swipeActive) return;
    swipeActive = false;
    var vw = window.innerWidth || 1;
    var now = Date.now();
    var total = now - swipeStartT;
    var dx = swipeLastX - swipeStartX;
    var passed = dx >= vw * SWIPE_RATIO || (swipeVel >= SWIPE_VEL && dx >= 48);
    if (passed) {
      /* 判定为返回：整屏推出去 → 切回首页 → 清掉跟手样式
         （showTab 会重建 #view 的内容，旧节点上的 transform 自然失效） */
      animateSwipe(vw, true);
      if (global.history && global.history.go) {
        try { global.history.go(-1); } catch (err) { showTab('home'); }
        historyDepth = Math.max(0, historyDepth - 1);
      } else {
        showTab('home');
      }
      setTimeout(clearSwipeStyles, 240);
    } else {
      /* 没过阈值：回弹到原位 */
      animateSwipe(0, false);
      setTimeout(clearSwipeStyles, 240);
    }
    return total;
  }

  function bindSwipeBack() {
    try {
      document.addEventListener('touchstart', onSwipeStart, { passive: true });
      document.addEventListener('touchmove', onSwipeMove, { passive: false });
      document.addEventListener('touchend', onSwipeEnd, { passive: true });
      document.addEventListener('touchcancel', onSwipeEnd, { passive: true });
    } catch (e) { /* 不支持 touch 的环境（如桌面内核）不绑，功能自然缺席 */ }
    /* 浏览器/系统返回（安卓物理返回键、桌面后退按钮、iOS 侧滑在支持时）
       走 popstate 回到首页，与侧滑共用同一条出口。 */
    try {
      global.addEventListener('popstate', function () {
        if (current !== 'home') { historyDepth = Math.max(0, historyDepth - 1); showTab('home'); }
      });
    } catch (e) { /* 忽略 */ }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
