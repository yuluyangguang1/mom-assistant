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
  /* 第 236 次：dock 一级页签 = 首页 / 日期记录 / 搜索 / 设置（搜索从首页右上角搬进来，设置从齿轮钮变成正式页签） */
  var TABS = [
    { id: 'home', title: '首页', ico: 'dk-home' },
    { id: 'calendar', title: '日期记录', ico: 'dk-cal' }
  ];
  /* 第 276 次（用户同意）：搜索移出 dock（一级、二级都去掉）。入口改成：首页到顶后继续下拉（pull-search.js）、
     菜单面板顶部搜索框（第 290 次起；原侧拉页）、「全部功能」页搜索框。搜索页路由保留，改算二级页（有返回、侧滑回首页）。 */
  /* 第 245 次：设置改成二级页（有返回、能侧滑回来）；第 290 次起设置入口在菜单面板（宝宝圆钮弹出）里 */
  function isTopTab(id) { return id === 'home' || id === 'calendar'; }

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

  /* 第 262/263 次：状态栏为实色（不再 black-translucent），颜色 = theme-color。
     必须与状态栏下方紧挨着的那一行像素同色，否则就是一条「黑横条」：
       · 首页且天空还在顶上 → 读天空画布在视口第 0 行的平均色（暗色下再叠 .home-sky::after 的暖炭罩 rgba(34,30,26,.40×dim)）
       · 其他情况 → body 底色与渐变层合成出的顶行颜色
     顶部 .edge-strip 用同一个值（--status-color），WebKit 就用它铺状态栏而不是画模糊。 */
  var statusColorCache = '';
  function hex2(n) { n = Math.max(0, Math.min(255, Math.round(n))); return (n < 16 ? '0' : '') + n.toString(16); }
  function parseRgba(str) {
    var m = str && str.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/);
    return m ? [+m[1], +m[2], +m[3], m[4] == null ? 1 : +m[4]] : null;
  }
  var edgeBottomCache = '';
  function bodyEdgeColor(b, bottom) {
    var cs = global.getComputedStyle(b);
    var base = parseRgba(cs.backgroundColor) || [253, 249, 244, 1];
    var out = [base[0], base[1], base[2]];
    var layers = (cs.backgroundImage || '').split(/(?=(?:linear|radial)-gradient\()/).filter(function (x) { return /gradient\(/.test(x); });
    for (var L = layers.length - 1; L >= 0; L--) {
      var all = layers[L].match(/rgba?\([^)]*\)/g);
      var col = all && parseRgba(all[bottom ? all.length - 1 : 0]);
      if (col) out = out.map(function (v, j) { return v * (1 - col[3]) + col[j] * col[3]; });
    }
    return '#' + out.map(hex2).join('');
  }
  /* 第 271 次（真机：泵奶 / 白噪音全屏是深色，记录尿布面板是白的，状态栏却还是页面的浅灰一条）：
     状态栏取「视口第 0 行最上面那一层」的颜色。原来只认首页天空 / 抽屉 / 页面底色，
     盖在页面上的全屏层（白噪音播放页 .wn-player、亲喂 / 泵奶 / 睡眠全屏计时 .ftf、照片大图 .ph-view）
     和面板（.modal-mask：面板顶到最上面时取面板底色，否则取遮罩压暗后的页面色）都没算进去。
     做法：把这些层按 z-index 从上往下合成，碰到不透明的就停；层里的背景图（url）按 cover + background-position
     取视口第 0 行那一行像素的平均色，渐变取首个色标，伪元素也算。 */
  function rgbHex(rgb) { return '#' + [rgb[0], rgb[1], rgb[2]].map(hex2).join(''); }
  function over(dst, col) { var a = col[3] == null ? 1 : col[3]; return [0, 1, 2].map(function (j) { return dst[j] * (1 - a) + col[j] * a; }); }
  var stImgs = {};
  function imgRow(url, r, posY) {
    var im = stImgs[url];
    if (!im) {
      im = stImgs[url] = new Image();
      im.onload = function () { im._ok = true; statusColorCache = ''; syncStatusColor(); };
      im.src = url;
      if (im.complete && im.naturalWidth) im._ok = true;
    }
    if (!(im._ok || (im.complete && im.naturalWidth)) || !r.width || !r.height) return null;
    var key = Math.round(r.width) + 'x' + Math.round(r.height) + '@' + Math.round(r.top) + ':' + posY;
    im._rows = im._rows || {};
    if (im._rows[key]) return im._rows[key];
    try {
      var iw = im.naturalWidth, ih = im.naturalHeight, sc = Math.max(r.width / iw, r.height / ih);
      var offY = (r.height - ih * sc) * posY, offX = (r.width - iw * sc) / 2;
      var y = Math.max(0, Math.min(ih - 1, (-r.top - offY) / sc));
      var x0 = Math.max(0, (Math.max(0, -r.left) - offX) / sc), x1 = Math.min(iw, (Math.min(r.width, (global.innerWidth || r.width) - r.left) - offX) / sc);
      var cv = stImgs._cv || (stImgs._cv = document.createElement('canvas'));
      cv.width = 32; cv.height = 1;
      var g = stImgs._g || (stImgs._g = (function () { try { return cv.getContext('2d', { willReadFrequently: true }); } catch (eW) { return cv.getContext('2d'); } })());
      g.clearRect(0, 0, 32, 1);
      g.drawImage(im, x0, y, Math.max(1, x1 - x0), Math.max(1, Math.min(ih - y, 3 / sc)), 0, 0, 32, 1);
      var px = g.getImageData(0, 0, 32, 1).data, rgb = [0, 0, 0];
      for (var i = 0; i < px.length; i += 4) { rgb[0] += px[i]; rgb[1] += px[i + 1]; rgb[2] += px[i + 2]; }
      return (im._rows[key] = [rgb[0] / 32, rgb[1] / 32, rgb[2] / 32, 1]);
    } catch (e) { return null; }
  }
  /* 一个元素（含 ::before / ::after）在视口第 0 行贡献的颜色，叠在 dst 上 */
  function paintEl(dst, el, r, pseudo) {
    var cs = global.getComputedStyle(el, pseudo || null);
    if (pseudo && (!cs.content || cs.content === 'none')) return dst;
    if (cs.display === 'none' || cs.visibility === 'hidden') return dst;
    var bg = parseRgba(cs.backgroundColor);
    if (bg && bg[3] > 0) dst = over(dst, bg);
    var layers = (cs.backgroundImage || '').split(/,(?![^(]*\))(?=\s*(?:url|linear-gradient|radial-gradient|repeating))/);
    var pos = (cs.backgroundPositionY || '').split(',');
    for (var L = layers.length - 1; L >= 0; L--) {
      var ly = layers[L].trim();
      var mu = ly.match(/^url\(["']?([^"')]+)["']?\)/);
      if (mu) {
        var pY = String(pos[Math.min(L, pos.length - 1)] || '50%').trim();
        var py = /%$/.test(pY) ? parseFloat(pY) / 100 : (pY === 'top' ? 0 : pY === 'bottom' ? 1 : 0.5);
        var row = imgRow(mu[1], r, isNaN(py) ? 0.5 : py);
        if (row) dst = over(dst, row);
      } else if (/^linear-gradient\(/.test(ly)) {
        var all = ly.match(/rgba?\([^)]*\)/g), c0 = all && parseRgba(all[0]);
        if (c0) dst = over(dst, c0);
      }
    }
    return dst;
  }
  function coversTop(r) { var vw = global.innerWidth || 390; return r.top <= 0.5 && r.bottom > 0.5 && r.left <= vw * 0.05 && r.right >= vw * 0.95; }
  function layerTop(root, below) {
    var r = root.getBoundingClientRect();
    var bg = parseRgba(global.getComputedStyle(root).backgroundColor);
    var dst = (bg && bg[3] >= 1) ? [0, 0, 0] : below();
    dst = paintEl(dst, root, r, null);
    dst = paintEl(dst, root, r, '::before');
    Array.prototype.forEach.call(root.children, function (ch) {
      var rc = ch.getBoundingClientRect();
      if (!coversTop(rc)) return;
      dst = paintEl(dst, ch, rc, '::before');
      dst = paintEl(dst, ch, rc, null);
      dst = paintEl(dst, ch, rc, '::after');
    });
    return paintEl(dst, root, r, '::after');
  }
  function overlayStack() {
    var list = Array.prototype.filter.call(document.querySelectorAll('.wn-player.open, .ftf, .modal-mask, .home-sheet, .qd-mask, .ph-view, .vb-book'), function (el) {
      if (el.classList.contains('sheet-ghost') || el.classList.contains('sheet-leaving') || el.hidden) return false;
      if (!el.getClientRects().length) return false;
      var cs = global.getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') return false;
      return coversTop(el.getBoundingClientRect());
    });
    list.sort(function (a, b) {
      var za = parseInt(global.getComputedStyle(a).zIndex, 10) || 0, zb = parseInt(global.getComputedStyle(b).zIndex, 10) || 0;
      if (za !== zb) return za - zb;
      return (a.compareDocumentPosition(b) & 4) ? -1 : 1;
    });
    return list;
  }
  function overlayColor(list, i, base) {
    if (i < 0) return base();
    var el = list[i];
    if (el.classList.contains('modal-mask') || el.classList.contains('home-sheet') || el.classList.contains('qd-mask')) {
      var pan = el.querySelector(':scope > .is-sheet, :scope > .modal, :scope > .sheet, :scope > .home-sheet-panel');
      var pr = pan && pan.getBoundingClientRect();
      if (pr && pr.top <= 0.5 && pr.bottom > 0.5) return layerTop(pan, function () { return overlayColor(list, i - 1, base); });
      var mc = parseRgba(global.getComputedStyle(el).backgroundColor);
      var under = overlayColor(list, i - 1, base);
      return mc ? over(under, mc) : under;
    }
    return layerTop(el, function () { return overlayColor(list, i - 1, base); });
  }
  global.__statusOverlay = function () { var l = overlayStack(); return l.map(function (e) { return e.className; }); };

  /* 天空画布第 y 行拷到常驻 1 行小画布再读（见 syncStatusColor 第 272 次说明） */
  var skyRowCv = null, skyRowCtx = null;
  function skyRow(cv, y) {
    if (!skyRowCv) {
      skyRowCv = document.createElement('canvas');
      try { skyRowCtx = skyRowCv.getContext('2d', { willReadFrequently: true }); } catch (eW) { skyRowCtx = null; }
      if (!skyRowCtx) skyRowCtx = skyRowCv.getContext('2d');
    }
    if (skyRowCv.width !== cv.width) skyRowCv.width = cv.width;
    if (skyRowCv.height !== 1) skyRowCv.height = 1;
    skyRowCtx.clearRect(0, 0, skyRowCv.width, 1);
    skyRowCtx.drawImage(cv, 0, y, cv.width, 1, 0, 0, cv.width, 1);
    global.__skyReads = (global.__skyReads || 0) + 1;
    return skyRowCtx.getImageData(0, 0, skyRowCv.width, 1).data;
  }
  /* .home-sky 的兜底渐变首个色标（画布还透明时露出来的就是它） */
  function skyFallback(sky) {
    var cs = global.getComputedStyle(sky);
    var all = (cs.backgroundImage || '').match(/rgba?\([^)]*\)/g);
    var c0 = all && parseRgba(all[0]);
    if (c0 && c0[3] > 0) return c0;
    return document.body.classList.contains('dark') ? [41, 43, 65, 1] : [167, 189, 236, 1];
  }

  function syncStatusColor() {
    try {
      var b = document.body; if (!b) return;
      var c = '';
      var ovl = overlayStack();
      var sky = b.classList.contains('in-home') && document.querySelector('.home-sky');
      var cv = sky && sky.querySelector('.sky-canvas');
      var r = cv && cv.getBoundingClientRect();
      if (cv && r.height && r.top <= 0 && r.bottom > 80 && cv.width && cv.height) {
        /* 直接读天空画布上「视口第 0 行」那一整行像素取平均（Chromium 对拍：与截图误差 ≤1） */
        var y = Math.max(0, Math.min(cv.height - 1, Math.round(-r.top / r.height * cv.height)));
        /* 第 272 次（审计 #12：首页每 1.5 秒对天空画布 getImageData，Chromium 报 willReadFrequently 警告，老 iPhone 白耗电）：
           不再直接回读正在动画的天空画布（给它加 willReadFrequently 会让整块天空退回 CPU 绘制），
           而是把那一行拷到一张常驻的 1 行小画布（willReadFrequently）上再读；首页进来前 8 秒照旧 1.5 秒一取（天空渐入），
           之后定时器只每 6 秒取一次（滚动 / 切页 / 换主题仍立即取）。 */
        var pxRow = skyRow(cv, y);
        /* 第 272 次（审计 #3：冷启动 1.5–2.6 秒状态栏和天空顶是纯黑）：画布还没画（或刚画、像素透明）时
           getImageData 是全 0，原来均值不看 alpha 就成了 #000。现在按 alpha 把画布像素叠在 .home-sky 自己的
           兜底渐变首色（浅 #A7BDEC / 深 #292B41）上：全透明 = 兜底色，画好后 = 画布色。 */
        var fb = skyFallback(sky);
        var rgb = [0, 0, 0], n = 0;
        for (var i = 0; i < pxRow.length; i += 4) {
          var al = pxRow[i + 3] / 255;
          rgb[0] += pxRow[i] * al + fb[0] * (1 - al); rgb[1] += pxRow[i + 1] * al + fb[1] * (1 - al); rgb[2] += pxRow[i + 2] * al + fb[2] * (1 - al); n++;
        }
        rgb = n ? rgb.map(function (v) { return v / n; }) : fb.slice(0, 3);
        if (b.classList.contains('dark')) {
          var a = 0.40 * (global.__skyDim == null ? 1 : global.__skyDim), k = [34, 30, 26];
          rgb = rgb.map(function (v, j) { return v * (1 - a) + k[j] * a; });
        }
        c = '#' + rgb.map(hex2).join('');
        /* 第 270 次（真机：状态栏是一条平的色带，下面的天空有云纹，接不上）：
           状态栏只能是一种颜色，就让天空顶上那一截从这个颜色起步、再渐渐露出云纹。
           .sky-cap 钉在天空里「滚动为 0 时视口第 0 行」的位置（天空本身向上伸出视口一截）。 */
        var capY = Math.max(0, -(r.top + (global.pageYOffset || 0)));
        if (capY !== sky._capY) { sky._capY = capY; sky.style.setProperty('--sky-cap-y', capY + 'px'); }
        if (c !== sky._capC) { sky._capC = c; sky.style.setProperty('--sky-cap', c); }
      } else {
        /* 其他页：顶上是 body 的底色 + 渐变层（环境光染色 rgba(天空色, .11) 叠在暖底渐变上）。
           按层从下往上合成每层的首个色标 = 视口第 0 行的真实颜色（Chromium 对拍误差 ≤1）。 */
        c = bodyEdgeColor(b, false);
      }
      if (ovl.length) {
        var baseC = c;
        c = rgbHex(overlayColor(ovl, ovl.length - 1, function () { var p = parseRgba(baseC.replace(/^#(..)(..)(..)$/, function (m0, x, y, z) { return 'rgb(' + parseInt(x, 16) + ',' + parseInt(y, 16) + ',' + parseInt(z, 16) + ')'; })); return p ? p.slice(0, 3) : [253, 249, 244]; }));
      }
      /* 底边同理：取各层末尾色标合成，给底部 .edge-strip 用 */
      var cb = bodyEdgeColor(b, true);
      if (cb !== edgeBottomCache) { edgeBottomCache = cb; document.documentElement.style.setProperty('--edge-bottom-color', cb); }
      if (!c || c === statusColorCache) return;
      statusColorCache = c;
      document.documentElement.style.setProperty('--status-color', c);
      if (global.Boot && Boot.setThemeColor) Boot.setThemeColor(c);
      else { var tm = document.querySelector('meta[name="theme-color"]'); if (tm) tm.setAttribute('content', c); }
    } catch (e) { /* 取不到就保持原值 */ }
  }
  global.syncStatusColor = syncStatusColor;
  /* 天空画布是活的（渐入、随时刻换色），首页时每 1.5s 再取一次；写入有缓存，没变不动 DOM */
  var homeSince = 0, skyTick = 0;
  setInterval(function () {
    if (document.hidden || !document.body || !document.body.classList.contains('in-home')) { homeSince = 0; return; }
    var now = Date.now();
    if (!homeSince) homeSince = now;
    /* 第 272 次：进首页前 8 秒每 1.5 秒取一次（天空渐入、画布刚画好），之后每 6 秒一次 */
    if (now - homeSince > 8000 && (++skyTick % 4)) return;
    syncStatusColor();
  }, 1500);
  var statusRaf = 0;
  function queueStatus() {
    if (statusRaf) return;
    statusRaf = requestAnimationFrame(function () { statusRaf = 0; syncStatusColor(); });
  }
  global.queueStatusColor = queueStatus;
  document.addEventListener('scroll', queueStatus, { capture: true, passive: true });
  /* 第 271 次：全屏层 / 面板开合、遮罩淡入结束时重新取色（写入有缓存，没变不动） */
  document.addEventListener('animationend', queueStatus, true);
  document.addEventListener('transitionend', function (e) { if (e.target && e.target.nodeType === 1 && (e.target.parentNode === document.body || /modal|sheet|wn-player|ftf/.test(e.target.className || ''))) queueStatus(); }, true);
  if (typeof MutationObserver !== 'undefined') {
    var stMo = new MutationObserver(queueStatus);
    var stObs = function () {
      if (!document.body) return;
      stMo.observe(document.body, { childList: true, attributes: true, attributeFilter: ['class'] });
      var mr = document.getElementById('modalRoot'); if (mr) stMo.observe(mr, { childList: true });
    };
    if (document.body) stObs(); else document.addEventListener('DOMContentLoaded', stObs);
  }

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

  var _dockNodes = {};
  function buildTabbar() {
    var bar = document.getElementById('tabbar');
    /* 第 135 次（底部胶囊 dock）：宝宝切换 / 设置 / 返回三个顶栏按钮要搬进胶囊。
       必须在 innerHTML='' 之前取到引用——清空后它们在 DOM 里就找不到了
       （节点对象仍由这几个变量持有，重新 append 即「搬移」，id 与既有事件绑定全部保留）。 */
    /* 第 181 次：三个节点首取后缓存——即使某次重建异常把它们清出了文档，下次仍能放回 */
    var avEl = _dockNodes.av || (_dockNodes.av = document.getElementById('avatarBtn'));
    var gearEl = _dockNodes.gear || (_dockNodes.gear = document.getElementById('settingsBtn'));
    var backEl = _dockNodes.back || (_dockNodes.back = document.getElementById('backBtn'));
    bar.innerHTML = '';
    var hand = handMode();
    /* 第 181 次（修：左右手 ⇄ 正常来回切，底栏少按钮）：
       以前左右手模式走一条独立分支，自己造五个按钮，而头像 / 设置 / 返回这三个
       「搬进胶囊的原顶栏节点」在上面 innerHTML='' 时被一并清出 DOM、再没放回去——
       切回正常排列时 getElementById 全部取不到，宝宝切换、设置、返回就丢了。
       同时两种模式的按钮内容也不一样（竖排没有快捷槽位，＋ 的颜色也另一套）。
       现在三种排列共用同一份按钮清单与同一套节点，左右手只是 CSS 把胶囊竖起来。 */
    if (hand !== 'normal') bar.classList.add('is-vertical'); else bar.classList.remove('is-vertical');
    /* 第 135 次：胶囊最左 = 宝宝切换（原顶栏左上角头像）。 */
    /* 第 239 次：正常横排时，宝宝切换单独做一颗玻璃圆钮放在 dock 左边（#dockOrb），
       和首页页签分开，免得点首页时误触切换宝宝；左右手竖排仍留在胶囊里。 */
    var orb = _dockNodes.orb;
    if (!orb || !orb.isConnected) {
      orb = _dockNodes.orb = document.getElementById('dockOrb') || document.createElement('div');
      orb.id = 'dockOrb'; orb.className = 'tabbar lg dock-orb';
      if (bar.parentNode) bar.parentNode.insertBefore(orb, bar.nextSibling);
    }
    if (avEl) { avEl.classList.add('dock-btn'); (hand === 'normal' ? orb : bar).appendChild(avEl); }
    TABS.forEach(function (t) {
      var b = document.createElement('button');
      b.className = 'tab' + (t.id === current ? ' active' : '');
      b.type = 'button';
      /* 第 141 次：底栏统一为「纯图标」——页签不再带文字。
         文字去掉后必须补 aria-label，否则读屏只剩一个无名按钮。 */
      b.innerHTML = icon(t.ico || t.id);
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
    if (slot && Modules[slot] && slot !== current && !isTopTab(slot) && (global.innerWidth || 400) >= 380) {
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
    plus.innerHTML = icon('dk-plus');
    plus.setAttribute('aria-expanded', document.body.classList.contains('qd-open') ? 'true' : 'false');
    plus.setAttribute('aria-controls', 'qdActions');
    plus.addEventListener('click', function (e) {
      if (Util.hapEcho && Util.hapEcho(e)) return; /* 第 286 次：触感层回声不当第二下（否则开了马上又关） */
      var f = document.getElementById('qdFab');
      if (f && f.click) f.click();
    });
    /* 第 236 次：设置已是页签，原齿轮钮留在 DOM 里但不再显示（id 和绑定照旧，老测试/外部调用不受影响） */
    if (gearEl) { gearEl.classList.add('dock-btn'); gearEl.hidden = true; bar.appendChild(gearEl); }
    /* 返回在 ＋ 之前：二级页里 CSS 让「返回靠左、＋ 靠右」，DOM 顺序即视觉顺序 */
    if (backEl) { backEl.classList.add('dock-btn'); bar.appendChild(backEl); }
    bar.appendChild(plus);
    /* 第 236 次：所有计时（含白噪音）统一放到 dock 上方的「正在进行」胶囊 */
    try { if (global.DockLive) DockLive.render(); } catch (e) { /* 胶囊异常不影响底栏 */ }
    syncOrb();
    if (hand === 'normal') {
      try { document.documentElement.style.setProperty('--dock-h', '0px'); } catch (e) {}
      bar.style.left = ''; bar.style.right = ''; bar.style.top = ''; bar.style.bottom = ''; bar.style.transform = '';
      return;
    }
    /* 快记动作列从竖排胶囊上方展开：把胶囊真实高度喂给 CSS（#quickDock 定位用） */
    try {
      var hh = bar.offsetHeight;
      document.documentElement.style.setProperty('--dock-h', (hh > 0 ? hh : 260) + 'px');
    } catch (e) { /* QA 桩无真实布局，跳过 */ }
    /* 第 101 次：布局自检兜底——个别内核（X5/夸克等）fixed 定位异常时竖排胶囊会漂出画面，
       rAF 后实测越界即内联回正。 */
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
    } catch (e) { /* 老内核无 rAF：CSS 已自持 */ }
  }

  /* 第 169 次：顶栏全站 static、无背景（见 styles.css .app-header），不再按滚动切换雾化类。
     保留这个函数只为清掉旧版本可能残留的类名。 */
  function syncHeader() {
    var header = document.querySelector('.app-header');
    if (header) header.classList.remove('is-solid', 'is-scrolled', 'is-deep');
  }

  /* 第 153 次（原生感 · iOS 推入/推出转场）：支持 View Transitions 的环境（iOS 18+ Safari、Chrome 111+）
     用系统级快照做真正的「新页从右推入、旧页向左退 30%」；返回反向；顶层平级页签互切快速淡入。
     只给 #view 起 view-transition-name，顶栏与底部胶囊保持不动。
     不支持 / 减少动态效果 / silent 原地刷新 → 直接走原路径（保留第 96 次的方向性上浮作降级）。 */
  var _vtBusy = false;
  var _swipeBackT = 0; /* 自定义侧滑返回已经自己推出整屏，紧随其后的切页不再叠一次系统转场 */
  function navKind(prevId, id) {
    var top = isTopTab;
    if (!prevId || prevId === id) return '';
    if (top(prevId) && !top(id)) return 'push';
    if (!top(prevId) && top(id)) return 'pop';
    if (top(prevId) && top(id)) return 'fade';
    return 'push';
  }
  var IS_IOS_WEBKIT = (function () {
    /* 第 265 次：真机 v228 仍在跑转场 → 只靠 CSS.supports 判不准，加 UA 判定（iPadOS 伪装 Mac 时看触点数） */
    try {
      var n = global.navigator || {}, ua = n.userAgent || '';
      if (/iP(hone|ad|od)/.test(ua)) return true;
      if (/Macintosh/.test(ua) && n.maxTouchPoints > 1) return true;
      if (n.standalone !== undefined) return true;
      return !!(global.CSS && CSS.supports && CSS.supports('-webkit-touch-callout', 'none'));
    } catch (e) { return false; }
  })();
  /* 第 274 次（审计 #22）：全屏计时层（睡眠 / 亲喂 / 泵奶 .ftf）挂在 body 上，不在 Sheet 的面板栈里。
     返回时先收起最上面那一层（等同点它自己的「⌄ 收起」）、留在原页，切页时一起收掉，绝不让它留下来盖住下一页。
     白噪音播放页（#wnPlayer）不在这里：它露出 dock（第 271 次），dock 的返回就是「离开白噪音页」，
     返回时由 whitenoise.leave() 带着播放页一起走（不残留）。topFullLayer 按 DOM 顺序取最后一个（后开的在上面）。 */
  function topFullLayer() {
    var list = document.querySelectorAll('body > .ftf');
    return list.length ? list[list.length - 1] : null;
  }
  /* 第 278 次（审计 #30 / #41）：Esc 按层由上到下关——照片大图 → 面板 → 其余交给各层自己
     （快记 / 菜单面板、白噪音播放页）。window 捕获阶段先于各面板挂在 document 上的 Esc，一次只关最上面一层。 */
  try {
    global.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' && e.key !== 'Esc') return;
      var pv = document.querySelectorAll('body > .ph-view'), top = null;
      if (pv.length) top = function () { var t = pv[pv.length - 1]; if (t._phClose) t._phClose(); else if (t.parentNode) t.parentNode.removeChild(t); };
      else if (global.Sheet && Sheet.isOpen && Sheet.isOpen()) top = function () { Sheet.closeTop(); };
      /* 第 289 次：疫苗本（全屏翻页层）在面板之下、页面之上 */
      else if (document.querySelector('body > .vb-book') && global.Modules && Modules.vaccine && Modules.vaccine._book) top = function () { Modules.vaccine._book.close(); };
      if (!top) return;
      e.stopImmediatePropagation(); e.preventDefault();
      top();
      if (global.queueStatusColor) global.queueStatusColor();
    }, true);
  } catch (eK) {}
  function collapseFullLayer(el) {
    if (!el) return false;
    var btn = el.querySelector('.ftf-top [data-f="down"], .ftf-top [data-p="down"], .ftf-top [aria-label="收起"]');
    if (btn) { try { btn.click(); } catch (e) {} }
    if (el.parentNode && el.classList.contains('ftf')) { /* 兜底：按钮没把它收掉 */
      el.parentNode.removeChild(el);
      if (!document.querySelector('body > .ftf')) document.body.classList.remove('ftf-open');
    }
    if (global.queueStatusColor) global.queueStatusColor();
    return true;
  }
  function closeAllFullLayers() {
    ['sleep', 'breast', 'pump'].forEach(function (k) { if (Modules[k] && Modules[k]._closeFull) { try { Modules[k]._closeFull(); } catch (e) {} } });
    Array.prototype.forEach.call(document.querySelectorAll('body > .ftf'), function (el) { el.parentNode.removeChild(el); });
    document.body.classList.remove('ftf-open');
    /* 白噪音播放页只活在白噪音页，离开时由它自己的 leave() 收起（第 271 次） */
    if (global.queueStatusColor) global.queueStatusColor();
  }
  function showTab(id, opts) {
    if (!Modules[id]) return;
    var kind = (opts && opts.silent) ? '' : navKind(current, id);
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    /* 第 264 次（真机逐帧：返回首页时新页快照空白 4 帧再整页蹦出来、状态栏颜色比页面先变、底部一条硬边）：
       iOS WebKit 的 View Transition 快照在主屏应用里不可靠，再叠上系统边缘取色就是「卡一下」。
       iOS 上一律不用 View Transition，走 showTabNow 自带的方向性 fadeUp 入场（只动 transform/opacity）。 */
    if (kind && !reduce && !IS_IOS_WEBKIT && !_vtBusy && !(opts && opts.noVT) && (Date.now() - _swipeBackT > 800) && typeof document.startViewTransition === 'function') {
      _vtBusy = true;
      document.documentElement.setAttribute('data-nav', kind);
      var o2 = {}; for (var k in (opts || {})) o2[k] = opts[k]; o2._vt = true;
      try {
        /* 第 244 次：切页闪上 / 闪下的根因——转场快照的是整个 #view，旧页按滚动位置在屏幕外上方，
           新页回到顶部，原来让 group 做几何补间，整页就会从 -滚动量 滑到 0（或反过来）。
           现在 group 不补间，旧快照用 --vt-dy 固定在它原来的屏幕位置，只做左右推拉。 */
        var oy0 = window.pageYOffset || 0;
        var vt = document.startViewTransition(function () {
          showTabNow(id, o2);
          try { document.documentElement.style.setProperty('--vt-dy', ((window.pageYOffset || 0) - oy0) + 'px'); } catch (e) {}
        });
        var done = function () { _vtBusy = false; document.documentElement.removeAttribute('data-nav'); };
        (vt.finished || Promise.resolve()).then(done, done);
      } catch (e) { _vtBusy = false; showTabNow(id, o2); }
      return;
    }
    showTabNow(id, opts);
  }
  function showTabNow(id, opts) {
    /* 第 286 次：真正切页（不是原地重画）时快捷记录面板立即收起，不留在新页上 */
    if (!(opts && opts.silent) && id !== current && global.App && App._qdClose) { try { App._qdClose(true); } catch (eQ) {} }
    if (!Modules[id]) return;
    /* 第 96 次（原生手感·方向性进场）：按导航语义注入水平位移变量，
       fadeUp 消费（见 styles.css）。前进=从内容深处推入（磁贴/齿轮进模块），
       返回=从左收回（模块页回首页），底栏页签互切与平级跳转纯上浮。
       只动 transform+opacity；reduced-motion 下全局禁动画自动降级。 */
    var prevId = current;
    /* 第 182 次：页内二级（设置分组）只在原地重绘（silent）时保留；真正切页就作废，
       那条 history 记录仍在 historyDepth 里，之后返回会按普通规则回首页。 */
    if (!(opts && opts.silent) && subExit) subExit = null;
    /* 第 116 次：进入「有上一层」的模块时登记一条 history，让侧滑返回与
       浏览器/系统返回键生效。判定只看「从顶层进更深一层」——
       首页/日历/设置互切是平级，不登记（否则侧滑会退到另一顶层页，行为怪异）。
       rerender 走 silent 路径且id 不变，这里由opts.silent 挡住，不会重复推栈。

       第 236 次：search 进了 dock，改算顶层（与日期记录、设置同级）；alltools 仍是子页。
       第 118 次：alltools（全部功能）与 search（全局搜索）**刻意不算顶层**。
       它们是从首页推入的子页，必须走「非顶层」这条分支才能同时拿到
       两件事——① 被 pushHistory 登记（侧滑/返回键可退回首页）
       ② 顶栏显示返回按钮。把它们当顶层会让用户进得去出不来。 */
    var isTopLevel = isTopTab(id);
    var wasTopLevel = isTopTab(prevId);
    if (!(opts && opts.silent) && !isTopLevel && wasTopLevel) {
      pushHistory(id);
    }
    /* 第 291 次：首页 ↔ 日期页互切时，前进栈里那条占位的快照还是上一页——切完、静止后重拍一次（不登记新记录） */
    if (!(opts && opts.silent) && isTopLevel && wasTopLevel && prevId !== id && global.App && App._reguard) App._reguard();
    /* 第 271 次：离开某页时给它一个收尾的机会（白噪音播放页挂在 body 上，要跟着收起） */
    if (prevId && prevId !== id && Modules[prevId] && typeof Modules[prevId].leave === 'function') {
      try { Modules[prevId].leave(id); } catch (e) { /* 收尾异常不影响切页 */ }
    }
    /* 第 272 次（审计 #2 / #5）：真正换页时，上一页的面板一起关掉，带「撤销」的提示收起（撤销只对它那一页的记录） */
    if (prevId !== id && !(opts && opts.silent)) {
      if (global.Sheet && Sheet.closeAll) { try { Sheet.closeAll(); } catch (eS) {} }
      closeAllFullLayers(); /* 第 274 次（#22）：全屏计时 / 播放页不跨页残留 */
      if (Util.toastLeave) Util.toastLeave(id);
    }
    current = id;
    buildTabbar();
    var view = document.getElementById('view');
    view.innerHTML = '';
    if (!(opts && opts.silent)) view.classList.remove('sg-in'); /* 第 188 次：设置二级态标记不跨页残留 */
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
      /* 第 183 次：有状态插画的模块，页头换成「大物件 + 标题 + 当前状态」（hero.js） */
      /* 第 284 次：模块自己的页内二级页（生长趋势等）给出自己的标题，不带模块图标 */
      var subT = (subExit && typeof Modules[id].subTitle === 'function') ? Modules[id].subTitle() : null;
      if (subT) {
        head.className = 'mod-head mod-head-sub';
        head.innerHTML = '<h1>' + Util.escapeHtml(subT) + '</h1>';
      } else if (global.Hero && Hero.has(id) && !subExit && !Modules[id].noHero) {
        head.className = 'mod-head has-hero';
        head.innerHTML = Hero.html(id, Modules[id].title);
      } else
      head.innerHTML = '<span class="mod-head-ico">' + icon(ICON_KEY[id] || id) + '</span><h1>' + Util.escapeHtml(Modules[id].title) + '</h1>';
      view.insertBefore(head, view.firstChild);
    }
    /* 返回按钮 + 日期收起态（第 42 次）：模块页显示返回，回到首页则隐藏。
       底栏两个页签（首页/日期记录）之外的任何页，都需要一个就近的返回出口。 */
    var backBtn = document.getElementById('backBtn');
    if (backBtn) backBtn.hidden = isTopTab(id) && !subExit;    /* 用 add/remove 而非 classList.toggle(cls, force)：测试桩的 toggle 不接受 force 参数，
       会退化成「反转」，连续进两次同一页就把类删掉了。 */
    /* 第 135 次（底部胶囊 dock）：二级页收起整条胶囊，只留返回钮。
       判据与 backBtn 完全同源——不另立一套「什么算二级页」的规则，
       否则两处口径迟早分叉（返回钮在、胶囊不收，或反过来）。 */
    var dockBar = document.getElementById('tabbar');
    if (dockBar) {
      var isSub = !isTopTab(id) || !!subExit;
      if (isSub) dockBar.classList.add('is-sub'); else dockBar.classList.remove('is-sub');
    }
    syncOrb(); /* 第 239 次：is-sub 定下来后再量 dock 宽度 */
    syncCta(); /* 第 282 次：底部主按钮固定在屏幕底部，页面底部按它的实际高度留白 */
    if (id !== 'home') document.body.classList.add('in-module');
    else document.body.classList.remove('in-module');
    if (id === 'home') document.body.classList.add('in-home');
    else document.body.classList.remove('in-home');
    syncStatusColor(); requestAnimationFrame(syncStatusColor);
    /* 第 43 次：模块页左上角小日期徽标（首页大日期在天空卡片内，二者互不重复）。
       第 167 次：二级页不再显示日期（styles.css 末尾 .mod-date visibility:hidden），
       文字仍照写——它撑着顶栏这一行的高度，清空会让首页天空整体上移约 20px。 */
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
    if (!(opts && (opts.silent || opts._vt))) {
      var dirX = '0px';
      if (prevId === 'home' && id !== 'home' && id !== 'calendar') dirX = '18px';
      else if (prevId && prevId !== 'home' && prevId !== 'calendar' && id === 'home') dirX = '-18px';
      if (opts && opts.enterX) dirX = opts.enterX; /* 第 291 次：首页左滑去日期页——日期页从右边进来 */
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
    /* 第 276 次（内存审计 L1）：换页 / 原地重绘（删记录后）收一遍照片 objectURL */
    if (global.Photos && Photos.prune) { try { Photos.prune(); } catch (eP) {} }
    if (global.Hero && Hero.onPage) { try { Hero.onPage(id, prevId); } catch (eH) {} }
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
    if (global.syncStatusColor) global.syncStatusColor();
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
    /* 第 221 次（单孩正常流程）：引导里选了「孕期中」，生完填了宝宝生日（≥ 末次月经）——
       这次怀孕已经结束，显式的 pregnancy 不再把首页锁在孕期，自动回到育儿期 */
    if (st === 'pregnancy' && pregEnded(s)) return 'baby';
    if (st === 'pregnancy' || st === 'baby') return st;
    return (pregnancyWeekOf(s) !== null) ? 'pregnancy' : 'baby';
  }
  /* 第 220 次（大宝已出生 + 又怀孕）：
     · 孕期起点 = 末次月经（或预产期 −280 天）；
     · 任何一个宝宝的生日 ≥ 这个起点 → 这次怀孕已经生了，不再算孕期（首胎生完也一样）；
     · 有宝宝生日 < 起点、且孕周在 0–45 → 「二胎孕期」：大宝的育儿工具和孕期工具同时要用。 */
  function pregBase(s) {
    var pg = s.pregnancy || {};
    return pg.lmp || (pg.dueDate ? Util.addDays(pg.dueDate, -280) : null);
  }
  function birthDates(s) {
    var out = [];
    var sb = s.settings && s.settings.baby;
    if (sb && sb.birthDate) out.push(sb.birthDate);
    (s.babies || []).forEach(function (b) { if (b && b.birthDate) out.push(b.birthDate); });
    return out;
  }
  function pregnancyWeekOf(s) {
    var base = pregBase(s);
    if (!base) return null;
    if (birthDates(s).some(function (bd) { return bd >= base; })) return null;
    var wk = Math.floor(Util.daysBetween(base, Util.todayISO()) / 7);
    return (wk >= 0 && wk <= 45) ? wk : null;
  }
  function pregEnded(s) {
    var base = pregBase(s);
    return !!base && birthDates(s).some(function (bd) { return bd >= base && bd <= Util.todayISO(); });
  }
  function isDualStage(s) {
    var base = pregBase(s);
    /* 第 221 次：选了孕期但还没填孕周、同时已有出生的宝宝——两套工具都显示，宁可多不藏 */
    if (!base) return s.settings.stage === 'pregnancy' && birthDates(s).some(function (bd) { return bd <= Util.todayISO(); });
    if (pregnancyWeekOf(s) === null) return false;
    var today = Util.todayISO();
    return birthDates(s).some(function (bd) { return bd < base && bd <= today; });
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
  /* 第 212 次（用户：多个宝宝切换会混乱、要显示小名）：宝宝面板重做。
     「当前宝宝」大卡（头像 + 小名 + 月龄，点开改资料）→「切换到」其余宝宝 → 添加宝宝 / 宝宝设置。
     名字一律走 Storage.babyLabel（小名优先），切换前先把当前宝宝资料收回档案，不再串名。 */
  function babyAge(bd) {
    if (!bd) return '还没填生日';
    var b = new Date(bd + 'T00:00:00'), n = new Date();
    var days = Math.floor((new Date(n.getFullYear(), n.getMonth(), n.getDate()) - b) / 86400000);
    if (days < 0) return '预产期 ' + bd;
    var y = n.getFullYear() - b.getFullYear(), m = n.getMonth() - b.getMonth(), d = n.getDate() - b.getDate();
    if (d < 0) m -= 1;
    if (m < 0) { y -= 1; m += 12; }
    if (y >= 1) return y + ' 岁' + (m ? ' ' + m + ' 个月' : '');
    if (m >= 1) return m + ' 个月';
    return '出生第 ' + (days + 1) + ' 天';
  }
  function openBabySheet() {
    var root = document.getElementById('modalRoot');
    if (!root) return;
    var s = Storage.get();
    var babies = s.babies || [];
    var cur = s.settings.activeBabyId;
    function ava(b) {
      return b.photo ? '<img src="' + Util.escapeHtml(b.photo) + '" alt="">'
        : '<span class="bs-ava-ill">' + (global.illo ? illo('avatar') : '') + '</span>';
    }
    var act = babies.filter(function (b) { return b.id === cur; })[0] || null;
    var others = babies.filter(function (b) { return b.id !== cur; });
    var html = '<div class="modal-mask sheet-mask" data-sheet-mask>'
      + '<div class="sheet baby-sheet" role="dialog" aria-modal="true" aria-label="宝宝资料">'
      + '<h2>宝宝资料</h2>';
    if (act) {
      html += '<p class="bs-label">当前宝宝</p>'
        + '<button type="button" class="bs-cur" data-bs-edit="' + Util.escapeHtml(act.id) + '">'
        + '<span class="bs-ava">' + ava(act) + '</span>'
        + '<span class="bs-txt"><b>' + Util.escapeHtml(Storage.babyLabel(act)) + '</b><i>' + Util.escapeHtml(babyAge(act.birthDate)) + '</i></span>'
        + '<span class="bs-chv" aria-hidden="true">' + icon('chevron-right') + '</span></button>'
        + '<p class="bs-note">首页、回顾和新记录都会用当前宝宝。</p>';
    } else {
      html += '<p class="bs-note">还没有宝宝档案，先添加一个。</p>';
    }
    if (others.length) {
      html += '<p class="bs-label">切换到</p><ul class="bs-list">';
      others.forEach(function (b) {
        html += '<li><button type="button" class="bs-row" data-pick="' + Util.escapeHtml(b.id) + '">'
          + '<span class="bs-ava bs-ava-s">' + ava(b) + '</span>'
          + '<span class="bs-txt"><b>' + Util.escapeHtml(Storage.babyLabel(b)) + '</b><i>' + Util.escapeHtml(babyAge(b.birthDate)) + '</i></span>'
          + '<span class="bs-switch">切换</span></button></li>';
      });
      html += '</ul>';
    }
    html += '<ul class="bs-list bs-actions">'
      + '<li><button type="button" class="bs-row" id="sheetAdd"><span class="bs-act-ico">' + icon('plus') + '</span><span class="bs-txt"><b>添加宝宝</b></span>'
      + '<span class="bs-chv" aria-hidden="true">' + icon('chevron-right') + '</span></button></li>'
      + '<li><button type="button" class="bs-row" id="sheetManage"><span class="bs-act-ico">' + icon('baby') + '</span><span class="bs-txt"><b>宝宝设置</b><i>管理资料、头像和删除</i></span>'
      + '<span class="bs-chv" aria-hidden="true">' + icon('chevron-right') + '</span></button></li>'
      + '</ul></div></div>';
    root.innerHTML = html;
    var close = function () { root.innerHTML = ''; };
    root.querySelector('[data-sheet-mask]').addEventListener('click', function (e) {
      if (e.target === e.currentTarget) close();
    });
    Array.prototype.forEach.call(root.querySelectorAll('[data-pick]'), function (btn) {
      btn.addEventListener('click', function () {
        var b = Storage.switchBaby(btn.getAttribute('data-pick'));
        close();
        if (b) {
          refreshHeaderAvatar();
          App.rerender();
          Util.toast('已切换到「' + Storage.babyLabel(b) + '」', 'ok');
        }
      });
    });
    var ed = root.querySelector('[data-bs-edit]');
    if (ed) ed.addEventListener('click', function () {
      var id = ed.getAttribute('data-bs-edit');
      close();
      if (global.Modules && Modules.settings && Modules.settings._babyForm) Modules.settings._babyForm(id);
    });
    root.querySelector('#sheetAdd').addEventListener('click', function () {
      close();
      if (global.Modules && Modules.settings && Modules.settings._babyForm) Modules.settings._babyForm(null);
    });
    root.querySelector('#sheetManage').addEventListener('click', function () {
      close();
      App.openSettingsGroup('称呼与阶段');
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
          if (act === 'skip') { collectStep(); finish(); return; }
          if (act === 'restore') { restoreFromBackup(); return; } /* 跳过 = 已填的保留、其余留空，功能不受影响 */
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

    /* 第 200 次：欢迎页「从备份恢复」——换手机/清了浏览器的老用户不必先走四步引导再去设置里找导入。
       新设备上没有数据，直接整体导入；确认弹层里把第 4 步的数据说明讲完（只存本机、记得定期导出），
       确认即视为已了解，不再重复弹引导。恢复后保留备份里的称呼/阶段/宝宝信息，不用 draft 覆盖。 */
    function restoreFromBackup() {
      var inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'application/json,.json';
      inp.addEventListener('change', function () {
        if (!inp.files || !inp.files[0]) return;
        var reader = new FileReader();
        reader.onload = function () {
          var text = String(reader.result), obj = null;
          try { obj = JSON.parse(text); } catch (e) { obj = null; }
          if (!obj || typeof obj !== 'object' || Array.isArray(obj)) { Util.toast('这个文件不是咿呀记的备份，请选「设置 → 导出」存下的 .json 文件。', 'error'); return; }
          var n = countRecords(obj);
          Util.confirm({
            title: '从备份恢复',
            message: '文件里有 ' + n + ' 条记录，恢复后就能接着用。提醒一下：记录仍然只存在这台手机上，清理浏览器或换手机会丢，记得定期在「设置 → 导出」备份。',
            okText: '恢复', cancelText: '取消',
            onConfirm: function () {
              try {
                Storage.importJSON(text);
                var d = Storage.get();
                d.settings.privacyAccepted = true;
                d.settings.onboardingDone = true;
                Storage.save();
                obRoot.innerHTML = '';
                document.body.classList.remove('ob-open');
                refreshHeaderAvatar();
                rerender();
                Util.toast('已恢复 ' + n + ' 条记录。', 'ok');
              } catch (e) {
                Util.toast('恢复失败：' + (e && e.message ? e.message : e), 'error');
              }
            }
          });
        };
        reader.readAsText(inp.files[0]);
      });
      inp.click();
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
        if (birth) draft.baby.birthLunar = Util.birthLunarOf ? Util.birthLunarOf('obBirth') : null;
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
      + '<img class="ob-logo" src="assets/boot-icon.webp" alt="" width="112" height="112">'
      + '<h2>咿呀记</h2>'
      + '<p class="ob-lead">喂奶、睡眠、尿布、疫苗，<br>单手几秒记一笔。</p>'
      + '<ul class="ob-points">'
      + '<li>' + (global.icon ? global.icon('clock') : '') + '<span>首页一键快记，夜里也不用找</span></li>'
      + '<li>' + (global.icon ? global.icon('vaccine') : '') + '<span>按生日自动排疫苗与体检</span></li>'
      + '<li>' + (global.icon ? global.icon('heart') : '') + '<span>数据只存在这台手机，不注册</span></li>'
      + '</ul></div>'
      + '<div class="ob-foot ob-foot-2">'
      + '<button type="button" class="btn btn-primary ob-cta" data-ob="next">开始设置</button>'
      + '<button type="button" class="ob-restore" data-ob="restore">换手机了？从备份文件恢复</button></div>';
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
    Util.download('咿呀记数据_' + Util.todayISO() + '.json', text, 'application/json');
    /* 记录上次导出时间，供备份提醒与设置页展示 */
    var s = Storage.get();
    s.settings.lastExportISO = Util.todayISO();
    Storage.save();
  }

  /* 第 202 次：不含妈妈私密记录（情绪 / 经期 / 记账）的导出，给家人或带去看医生用。
     不算作「备份」：不更新 lastExportISO，以免备份提醒误以为私密记录也备份过了。 */
  function exportShare() {
    Util.confirm({
      title: '导出给家人 / 医生',
      message: '这份文件不含妈妈的情绪、经期和记账，其余宝宝与孕期记录照常包含，仍是明文。它不算完整备份——换手机请用「导出全部数据」。',
      okText: '导出', cancelText: '取消',
      onConfirm: function () {
        var text = Storage.exportJSON({ excludePrivate: true });
        Util.download('咿呀记数据_不含私密_' + Util.todayISO() + '.json', text, 'application/json');
      }
    });
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
    /* 第 273 次（审计 #16：只数了 10 个数组，体温 / 饮水 / 胎动 / 补剂 / 储奶等全漏，覆盖确认可能写「现有 0 条」）：
       改为数 Storage.RECORD_KEYS（全部记录数组）+ 老的 metrics，再加嵌套容器里的记录 */
    var arrays = ((global.Storage && Storage.RECORD_KEYS) || []).concat(['metrics']);
    var n = 0;
    arrays.forEach(function (k) { if (Array.isArray(obj && obj[k])) n += obj[k].length; });
    var deep = [['finance', 'records'], ['prenatal', 'records'], ['prenatal', 'checks'], ['packing', 'items'], ['pregnancy', 'weights']];
    deep.forEach(function (p) {
      var sub = obj && obj[p[0]];
      if (sub && Array.isArray(sub[p[1]])) n += sub[p[1]].length;
    });
    if (obj && obj.checkups && obj.checkups.done && typeof obj.checkups.done === 'object') n += Object.keys(obj.checkups.done).length;
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
        /* 第 187 次：默认「合并导入」——先算出会新增哪些，确认后只加本机没有的；
           整体覆盖降为次要入口（换手机恢复备份时用）。 */
        function askOverwrite() {
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
        }
        var preview = null;
        if (incoming && typeof incoming === 'object' && !Array.isArray(incoming)) {
          try { preview = Storage.mergeJSON(text, { dryRun: true }); } catch (e) { preview = null; }
        }
        if (preview) {
          var lines = preview.parts.slice(0, 6).map(function (p) { return p.name + ' ' + p.n; }).join('、')
            + (preview.parts.length > 6 ? ' 等' : '');
          Util.confirm({
            title: preview.total ? '合并导入：新增 ' + preview.total + ' 条' : '没有新记录',
            message: preview.total
              ? '只把文件里本机没有的记录加进来（' + lines + '）' + (preview.newBabies ? '，并新增 ' + preview.newBabies + ' 个宝宝档案' : '') + '。本机现有记录不改、不删。'
              : '文件里的记录本机都已经有了。若想用文件整体替换本机数据，可以选「整体覆盖」。',
            okText: preview.total ? '合并导入' : '知道了',
            cancelText: '取消',
            extra: { text: '整体覆盖…', onClick: askOverwrite },
            onConfirm: function () {
              if (!preview.total) return;
              try {
                var r = Storage.mergeJSON(text);
                Util.toast('已合并 ' + r.total + ' 条记录。', 'ok');
                rerender();
              } catch (e) {
                Util.toast('导入失败：' + (e && e.message ? e.message : e), 'error');
              }
            }
          });
        } else if (incoming && typeof incoming === 'object') {
          askOverwrite();
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
  function traceClick(e) { if (e && e.target && e.target.classList && e.target.classList.contains('hap-sw')) return; if (trace) trace.clicks++; }
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
     ——回顾本身在「日期记录」页右上角的日历里随时可看，不需要提醒也能拿到。 */
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
      onClick: function () {
        showTab('calendar');
        /* 第 285 次：回顾挪进日期页右上角的「跳转到日期」半屏 */
        setTimeout(function () { if (Modules.calendar && Modules.calendar._openJump) Modules.calendar._openJump(); }, 360);
      }
    });
  }

  /* 引导第 1 步：身份（只影响称呼，不做画像） */
  function stepOneBody(draft) {
    return '<div class="ob-main"><h2>谁在用咿呀记？</h2>'
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
        Util.birthInput({ id: 'obBirth', title: '出生日期', value: b.birthDate || '', lunar: b.birthLunar })
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
    _saveRestore: saveRestore, /* 第 274 次：回归测试模拟「SW 更新自动重载」用（写恢复标记，随后 reload） */
    rerender: rerender,
    _syncCta: function () { syncCta(); },
    currentTab: function () { return current; },
    _isTop: function () { return isTopTab(current) && !subExit; }, /* 首页下拉搜索只在一级页 */
    _hpBusy: function () { return hpBusy(); }, /* 第 291 次：首页左滑跟手 / 收尾中（测试用） */
    _openBabySheet: function () { openBabySheet(); },
    /* 第 276 次：进搜索页并聚焦输入框（首页下拉、菜单面板搜索框共用）。必须在点击 / 松手的同一次事件里同步调用，iOS 才弹键盘 */
    openSearch: function () {
      if (current !== 'search') showTab('search', { noVT: true });
      var inp = document.getElementById('searchInput');
      if (inp) { try { inp.focus({ preventScroll: true }); } catch (e) { try { inp.focus(); } catch (e2) {} } }
      return !!inp;
    },
    _babyAge: function (bd) { return babyAge(bd); }, /* 第 187 次：record-edit.js 按当前模块找记录 */
    enterSub: enterSub,
    inSub: inSub,
    exitSub: function () { if (!popHistory()) exitSubNow(); },
    /* 第 212 次：直达设置里的某个分组（首页「开启天气」等入口用） */
    openSettingsGroup: function (title) {
      if (global.Modules && Modules.settings) Modules.settings._want = title;
      showTab('settings');
    },
    refreshHeaderAvatar: refreshHeaderAvatar, /* 第 80 次：设置页改照片/切宝宝后刷新左上角 */
    /* C7（操作便捷性研究）：一次性日期覆盖。日历空日「补记」入口设置它再跳模块，
       模块在 render 时读取并立即清空（消费式），保存即落到该日期。默认 null。 */
    pendingDate: null,
    startOnboarding: showOnboarding, /* 设置页「重新开始首次引导」入口（调用前需先把 privacyAccepted 置回 false） */
    exportAll: exportAll,
    exportShare: exportShare,
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
    isDualStage: isDualStage, /* 第 220 次：大宝已出生 + 又怀孕 */
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
    /* 第 291 次（真机：快速记录点「喂奶」提示的是泵奶）：「喂奶」只按上一次真正喂宝宝的那条（亲喂 / 瓶喂 / 配方奶）——
       泵奶是妈妈吸奶、辅食是吃饭，都存在 feedings 里，之前不分类型取最后一条，最近泵过奶「喂奶」就成了泵奶（还会记成一条泵奶） */
    var FEED = { breast: 1, bottle: 1, formula: 1 };
    var last = (Storage.get().feedings || []).filter(function (r) { return r && FEED[r.type]; })
      .sort(function (a, b) { return new Date(b.start) - new Date(a.start); })[0];
    var t = (last && last.type) || 'breast';
    var side = (last && last.side) || 'left';
    var dur = (last && last.durationMin) || (t === 'breast' ? 15 : null);
    var amt = (last && last.amount) || (t !== 'breast' && t !== 'pump' ? 120 : null);
    var name = { breast: '母乳', bottle: '奶瓶', formula: '奶粉' }[t] || '母乳';
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
    var detail = t === 'breast' ? (dur + ' 分钟 · ' + sideT) : amtDetail;
    return {
      rec: { type: t, side: side, durationMin: dur,
        amount: amt, amountBm: amtBm, amountFm: amtFm },
      label: name + ' ' + detail
    };
  }

  /* 第 290 次：「＋」快捷记录面板和「菜单」面板是同一个面板（#quickDock / #qdActions / #qdMask，同一套开合类与动画），
     只是内容不同（mode = quick | menu）。左侧侧拉页整个删掉，原来打开它的宝宝圆钮改为弹出菜单面板。
     两种内容共用：遮罩点按 / 点外面 / Esc / 系统返回关闭、从面板往下拉关闭（跟手，只写 transform / opacity）、
     打开时页面（顶栏 + #view）inert、焦点移进面板、关上后焦点回到打开它的按钮。
     菜单面板另外登记一条 history（{baoma:'ov'}，在画面开始变化之前推）：系统返回只关面板；自己关掉时等收起落定后才退掉；
     点入口进二级页时由 pushHistory 直接改写复用这条（replaceState，不拍快照），进一级页时切完再退。 */
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
    var list = root.querySelector('#qdActions');

    /* 第 286 次：「＋」开合动画——＋ 弹簧转 45° 成 ×、底色略深；动作项从「＋」那里依次弹出（30ms 错开）；
       关闭时反向：× 转回 ＋，动作项逆序快速收回（约 180ms）后才真正收起。状态只认 root 上的 open / qd-closing 两个类，
       aria-expanded（隐藏的 #qdFab 和 dock 上的 ＋ 两处）跟着同步；切页 / 系统返回时立即收起不留残影。 */
    var closingT = 0, pendingRm = null;
    var mode = 'quick';
    var menuRel = null;   /* 菜单面板那条 history 的 release（App._pushOverlay 返回） */
    var opener = null;    /* 打开面板前的焦点（关上后还回去） */
    var inertEls = [];
    var waitOpen = false; /* 上一次的静默退回还没落地时的打开请求 */
    function syncAria(on) {
      var q = on && mode === 'quick', m = on && mode === 'menu';
      fab.setAttribute('aria-expanded', q ? 'true' : 'false');
      Array.prototype.forEach.call(document.querySelectorAll('[data-qd-toggle]'), function (b) { b.setAttribute('aria-expanded', q ? 'true' : 'false'); });
      Array.prototype.forEach.call(document.querySelectorAll('[data-qm-toggle]'), function (b) { b.setAttribute('aria-expanded', m ? 'true' : 'false'); });
      if (m) { list.setAttribute('role', 'dialog'); list.setAttribute('aria-modal', 'true'); list.setAttribute('aria-label', '菜单'); }
      else { list.removeAttribute('role'); list.removeAttribute('aria-modal'); list.removeAttribute('aria-label'); }
    }
    /* 打开时页面本身不可聚焦 / 不可点（dock 留着：× 和宝宝圆钮要能再点一下收起） */
    function setInert(on) {
      inertEls.forEach(function (el) { try { el.inert = false; } catch (e) {} el.removeAttribute('data-qd-inert'); });
      inertEls = [];
      if (!on) return;
      Array.prototype.forEach.call(document.querySelectorAll('#app > .app-header, #view'), function (el) {
        try { el.inert = true; } catch (e) {} el.setAttribute('data-qd-inert', ''); inertEls.push(el);
      });
    }
    function prefersReduced() { try { return global.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }
    function bodyCls(c, on) { if (document.body && document.body.classList) { if (on) document.body.classList.add(c); else document.body.classList.remove(c); } }
    /* opts.fromPop：系统返回已经退掉了菜单那条记录；opts.nav：点了入口要切页（焦点不还给按钮） */
    function close(now, opts) {
      opts = opts || {};
      var wasOpen = root.classList.contains('open');
      if (closingT) { clearTimeout(closingT); closingT = 0; }
      var prev = pendingRm; pendingRm = null;
      /* 第 135 次：遮罩可见性挂在 body.qd-open 上（它不再是 #quickDock 的子节点） */
      bodyCls('qd-open', false); bodyCls('qm-open', false); bodyCls('qd-drag', false);
      syncAria(false);
      setInert(false);
      dragReset();
      var m = mode;
      var rm = function () {
        closingT = 0; pendingRm = null;
        root.classList.remove('open'); root.classList.remove('qd-closing'); root.classList.remove('qd-dragged'); root.classList.remove('qd-dragging');
        list.style.removeProperty('--qd-dy'); if (mask) mask.style.opacity = '';
        if (m === 'menu') menuSettled(opts);
      };
      if (!wasOpen) { if (prev) prev(); return; }
      if (now === true || prefersReduced()) { instant(); rm(); return; }
      root.classList.add('qd-closing');
      pendingRm = rm;
      closingT = setTimeout(rm, 200);
    }
    /* 立即收起（切页 / 系统返回 / 换内容）：这一下面板和遮罩都不走淡出过渡，下一帧画面里就没有它们（不留半透明遮罩盖在新页上） */
    var nowRaf = 0;
    function instant() {
      bodyCls('qd-now', true);
      if (nowRaf) return;
      var raf = global.requestAnimationFrame || function (f) { return setTimeout(f, 16); };
      nowRaf = raf(function () { raf(function () { nowRaf = 0; bodyCls('qd-now', false); }); });
    }
    /* 菜单面板收起落定：这时才退掉它那条 history（画面已经静止），焦点还给宝宝圆钮 */
    function menuSettled(opts) {
      var r = menuRel; menuRel = null;
      if (r && !opts.fromPop) r();
      var o = opener; opener = null;
      if (!opts.nav && o && o.isConnected) { try { o.focus({ preventScroll: true }); } catch (e) {} }
    }
    /* 收回动画还没走完就要开另一种内容：先把收起落定（菜单那条记录在这里退掉） */
    function flushClosing() { if (pendingRm) { clearTimeout(closingT); closingT = 0; var f = pendingRm; pendingRm = null; f(); } }
    function showOpen(src) {
      root.classList.add('open');
      bodyCls('qd-open', true);
      bodyCls('qm-open', mode === 'menu');
      syncAria(true);
      setInert(true);
      if (!prefersReduced()) aimItems(src);
      if (Util.haptic) Util.haptic('light');
      attachOutside();
    }
    /* 动作项从打开它的按钮那里弹出：开的时候量一次各项到按钮的偏移，写成 CSS 变量（只在打开那一刻读布局，动画只走 transform / opacity） */
    function aimItems(src) {
      src = src || document.querySelector('.tabbar [data-qd-toggle]') || fab;
      var r0 = src && src.getBoundingClientRect ? src.getBoundingClientRect() : null;
      if (!r0 || !r0.width) return;
      var cx = r0.left + r0.width / 2, cy = r0.top + r0.height / 2;
      Array.prototype.forEach.call(root.querySelectorAll('.qd-action'), function (el) {
        var r = el.getBoundingClientRect();
        el.style.setProperty('--qx', Math.round((cx - (r.left + r.width / 2)) * 0.35) + 'px');
        el.style.setProperty('--qy', Math.round(Math.max(16, (cy - (r.top + r.height / 2)) * 0.35)) + 'px');
      });
    }
    global.App._qdClose = function (now, opts) {
      opts = opts || {};
      if (!root.classList.contains('open')) return;
      /* 静默退回落地（popstate 被 ignorePop 吃掉，例如菜单换成 ＋ 时退掉菜单那条记录）不是用户的返回，不关面板 */
      if (opts.ignored) return;
      close(now, opts); detachOutside();
    };

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
         转发的 click 自带开/合判断，这里放行即可。第 290 次：宝宝圆钮（菜单）同理。 */
      if (e.target && e.target.closest && e.target.closest('[data-qd-toggle],[data-qm-toggle]')) return;
      /* 盖在面板上面的层（确认框等）里的点按不算「点外面」 */
      if (e.target && e.target.closest && e.target.closest('#modalRoot, .ph-view')) return;
      close(); detachOutside();
    }
    function onKey(e) {
      if (e.key !== 'Escape' && e.key !== 'Esc') return;
      if (!root.classList.contains('open') || root.classList.contains('qd-closing')) return;
      close(); detachOutside();
    }
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

    /* ———— 往下拉关闭（两种内容共用）————
       面板内容在顶部（或按在把手上）时向下拉：面板跟手下移、遮罩跟着变淡；松手过 1/4 高度或下甩 ≥ 0.5px/ms 就关，否则弹回。
       只写 transform（--qd-dy）和遮罩 opacity；往上拉 / 横向拉不接管（交给面板里的滚动）。 */
    /* 第 292 次：松手不再走固定过渡——速度取最近 100ms（Motion.tracker），弹回 / 收走都用带初速度的弹簧逐帧写 --qd-dy；
       收走时一直推到屏幕外、遮罩按位置变淡，到底才真正收起（立即收起、不再补一段淡出）；弹回途中按住 = 接着拖。 */
    var dr = null, swallowT = 0, qSpr = null, qTr = global.Motion ? Motion.tracker() : null;
    function qStop() { var v = null; if (qSpr) { v = qSpr.stop(); qSpr = null; } return v; }
    function dragReset() { qStop(); dr = null; root.classList.remove('qd-dragging'); root.classList.remove('qd-flinging'); bodyCls('qd-drag', false); }
    function qPaint(off, h) {
      list.style.setProperty('--qd-dy', off.toFixed(1) + 'px');
      if (mask) mask.style.opacity = String(Math.max(0, 1 - Math.max(0, off) / (h || 1)).toFixed(3));
    }
    list.addEventListener('touchstart', function (e) {
      if (qSpr && !root.classList.contains('qd-flinging') && e.touches && e.touches.length === 1) {
        /* 弹回途中被按住：从当前位置接着拖 */
        var cur = qStop() || 0, t0 = e.touches[0];
        dr = { x0: t0.clientX, y0: t0.clientY - cur - 8, ly: t0.clientY, lt: Date.now(), vel: 0, on: true, off: cur, h: list.offsetHeight || 300 };
        if (qTr) qTr.reset(t0.clientY);
        return;
      }
      dr = null;
      if (!root.classList.contains('open') || root.classList.contains('qd-closing') || root.classList.contains('qd-flinging')) return;
      if (!e.touches || e.touches.length !== 1) return;
      var sc = list.querySelector('.qm-scroll');
      var onGrab = !!(e.target && e.target.closest && e.target.closest('.qd-grab'));
      if (!onGrab && sc && sc.scrollTop > 0) return;
      var t = e.touches[0];
      dr = { x0: t.clientX, y0: t.clientY, ly: t.clientY, lt: Date.now(), vel: 0, on: false, off: 0, h: list.offsetHeight || 300 };
    }, { passive: true });
    /* move / end 挂在 document 上（只在按下点在面板里、dr 存在时才处理）：手指拖出面板也照样跟手、松手照样落定 */
    document.addEventListener('touchmove', function (e) {
      if (!dr || !e.touches || !e.touches.length) return;
      var t = e.touches[0], dx = t.clientX - dr.x0, dy = t.clientY - dr.y0;
      if (!dr.on) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        if (dy <= 0 || Math.abs(dx) > Math.abs(dy)) { dr = null; return; }
        dr.on = true; root.classList.add('qd-dragging'); bodyCls('qd-drag', true);
        if (qTr) qTr.reset(t.clientY);
      }
      if (qTr) qTr.add(t.clientY);
      var now = Date.now(), dtm = Math.max(1, now - dr.lt);
      dr.vel = dr.vel * 0.4 + ((t.clientY - dr.ly) / dtm) * 0.6;
      dr.ly = t.clientY; dr.lt = now;
      dr.off = Math.max(0, dy - 8);
      list.style.setProperty('--qd-dy', dr.off.toFixed(1) + 'px');
      if (mask) mask.style.opacity = String(Math.max(0, 1 - dr.off / dr.h).toFixed(3));
      if (e.cancelable) e.preventDefault();
    }, { passive: false });
    function dragEnd(cancelled) {
      if (!dr) return;
      var d = dr; dr = null;
      if (!d.on) return;
      /* 拖过之后手指抬起时的那次 click 不算点了入口 */
      swallowT = Date.now() + 350;
      var vel = cancelled ? 0 : (qTr ? qTr.velocity() : ((Date.now() - d.lt > 120) ? 0 : d.vel));
      var M = global.Motion;
      var go = !cancelled && (M ? M.shouldDismiss(d.off, vel, d.h) : (d.off > d.h * 0.25 || vel >= 0.5));
      if (go) {
        root.classList.add('qd-dragged');
        if (!M || prefersReduced()) { root.classList.remove('qd-dragging'); bodyCls('qd-drag', false); close(); detachOutside(); return; }
        /* 一直推到屏幕外：面板底到视口底的距离 + 自身高度 */
        var rb = list.getBoundingClientRect();
        var far = Math.max(d.h, d.off + (global.innerHeight || 800) - rb.top + 12);
        root.classList.add('qd-flinging');
        var fin = function () { qSpr = null; close(true); detachOutside(); };
        qSpr = M.spring({ from: d.off, to: far + 40, velocity: Math.max(vel, 0.6), response: 0.34, damping: 1,
          onUpdate: function (v) { qPaint(Math.min(v, far), far); if (v >= far && qSpr) { qSpr.stop(); fin(); } },
          onDone: function () { if (qSpr) fin(); } });
        return;
      }
      /* 被打断（touchcancel / 新触摸 / 切后台：后台 rAF 不跑）= 立刻回原位，不靠动画 */
      if (!M || !d.off || cancelled) {
        root.classList.remove('qd-dragging'); bodyCls('qd-drag', false);
        list.style.setProperty('--qd-dy', '0px');
        if (mask) mask.style.opacity = '';
        return;
      }
      /* 弹回：拖动态保持着（不走 CSS 过渡），弹簧逐帧写回 0 */
      qSpr = M.spring({ from: d.off, to: 0, velocity: vel, response: 0.3, damping: 1,
        onUpdate: function (v) { qPaint(v, d.h); },
        onDone: function () { qSpr = null; root.classList.remove('qd-dragging'); bodyCls('qd-drag', false); list.style.setProperty('--qd-dy', '0px'); if (mask) mask.style.opacity = ''; } });
    }
    document.addEventListener('touchend', function () { dragEnd(false); }, { passive: true });
    document.addEventListener('touchcancel', function () { dragEnd(true); }, { passive: true });
    /* 系统手势吞掉了 touchend（又来一次新触摸 / 切后台 / 失焦）：弹回原位，不停在半路 */
    document.addEventListener('touchstart', function () { if (dr && dr.on) dragEnd(true); }, { capture: true, passive: true });
    global.addEventListener('blur', function () { dragEnd(true); });
    global.addEventListener('pagehide', function () { dragEnd(true); });
    document.addEventListener('visibilitychange', function () { if (document.hidden) dragEnd(true); });
    list.addEventListener('click', function (e) { if (Date.now() < swallowT) { e.stopPropagation(); e.preventDefault(); } }, true);

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
      /* 第 226 次：＋号快记尿布也按「扣减用品」偏好扣库存，撤销时退回 */
      var DM = global.Modules && Modules.diaper;
      if (arrName === 'diapers' && DM && typeof DM._autoUse === 'function') msg += DM._autoUse(d2, rec);
      d2[arrName].push(rec);
      if (Storage.save()) Util.toast(msg, 'ok', { label: '撤销', onClick: function () {
        var arr = Storage.get()[arrName];
        var gone = null;
        for (var i = arr.length - 1; i >= 0; i--) if (arr[i].id === rec.id) { gone = arr.splice(i, 1)[0]; break; }
        if (gone && gone.used && DM && typeof DM._applyUse === 'function') DM._applyUse(Storage.get(), DM._validUsed(Storage.get(), gone.used), -1);
        Storage.save(); rerender(); Util.toast('已撤销', 'ok');
      } });
      close(); detachOutside(); rerender();
    }

    fab.addEventListener('click', function (ev) {
      if (Util.hapEcho && Util.hapEcho(ev)) return; /* 第 281 次：触感层的回声 click 不算第二下 */
      /* 第 43 次修正：再点 FAB 应当「收起」，而不是重新展开。
         此前 FAB 的 click 无条件重建动作列并 add('open')，等于永远关不掉。
         第 286 次：收回动画中再点 = 重新展开（不等动画走完） */
      if (mode === 'quick' && root.classList.contains('open') && !root.classList.contains('qd-closing')) { close(); detachOutside(); return; }
      /* 第 290 次：菜单开着时点 ＋ = 换成快捷记录（菜单那条记录先退掉） */
      if (mode === 'menu') { if (root.classList.contains('open') && !root.classList.contains('qd-closing')) { close(true, { nav: true }); detachOutside(); } else flushClosing(); }
      if (closingT) { clearTimeout(closingT); closingT = 0; pendingRm = null; }
      root.classList.remove('qd-closing'); root.classList.remove('qd-dragged');
      list.style.removeProperty('--qd-dy');
      mode = 'quick'; root.classList.remove('qd-menu');
      var d = Storage.get();
      var wk = (function () {
        var pg = d.pregnancy || {};
        var base = pg.lmp || (pg.dueDate ? Util.addDays(pg.dueDate, -280) : null);
        return base ? Math.floor(Util.daysBetween(base, Util.todayISO()) / 7) : null;
      })();
      var fed = fedDefaults();
      /* 第 84 次：补「尿布：拉了」（pee/poop 是尿布两大类，此前快记只有「尿了」）；
         动作加识别图标（读得快）+ 内联 --i 序号（CSS 逐项 stagger 入场用） */
      /* 第 244 次：快记改成玻璃面板 + 两列磁贴（标题 + 一行说明），与新页面同一视觉 */
      var acts = [
        { id: 'qdFeed', ico: 'feeding', acc: 'feeding', t: '喂奶', s: fed.label },
        { id: 'qdDiaper', ico: 'pee', acc: 'diaper', t: '尿了', s: '尿布 · 尿' },
        { id: 'qdPoop', ico: 'poop', acc: 'diaper', t: '拉了', s: '尿布 · 便' },
        { id: 'qdMeds', ico: 'meds', acc: 'meds', t: '维生素 D3', s: '吃药 · 1 次' }
      ];
      if (wk !== null) acts.push({ id: 'qdFetal', ico: 'fetal', acc: 'fetal', t: '胎动 +1', s: '孕 ' + wk + ' 周' });
      list.innerHTML = '<p class="qd-head">快速记录<small>点一下就记好，可再去页面里改</small></p><div class="qd-grid">'
        + acts.map(function (a, i) {
          return '<button type="button" class="qd-action" id="' + a.id + '" data-accent="' + a.acc + '" style="--i:' + i + '">'
            + '<span class="qd-badge">' + (global.icon ? global.icon(a.ico, 'qd-ico') : '') + '</span>'
            + '<span class="qd-txt"><b>' + Util.escapeHtml(a.t) + '</b><small>' + Util.escapeHtml(a.s) + '</small></span></button>';
        }).join('') + '</div>';
      var nAct = acts.length;
      Array.prototype.forEach.call(list.querySelectorAll('.qd-action'), function (el, i) { el.style.setProperty('--j', String(nAct - 1 - i)); });
      showOpen(null);

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
    });

    /* ———— 菜单面板（第 290 次，取代左侧侧拉页；入口一个不少） ———— */
    var MENU_TOP = [
      { go: 'home', ico: 'dk-home', name: '首页' },
      { go: 'calendar', ico: 'calendar', name: '日期记录' },
      { go: 'whitenoise', ico: 'noise', name: '哄睡声音' },
      { go: '__edit', ico: 'edit', name: '编辑首页' },
      { go: 'settings', ico: 'settings', name: '设置' }
    ];
    var SWAP_SVG = '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 9.5l4-4 4 4M8 14.5l4 4 4-4"/></svg>';
    function esc(s) { return Util.escapeHtml(s == null ? '' : String(s)); }
    /* 一格里最长的名字有几个「字宽」（汉字 1，ASCII 0.6）：网格最小列宽按它算，320 宽 + 大字号时自动少一列，名字不折行、不截断 */
    function chW(s) { var n = 0; for (var i = 0; i < s.length; i++) n += s.charCodeAt(i) > 255 ? 1 : 0.6; return n; }
    function menuTile(it, i, cur, mono) {
      return '<button type="button" class="qd-action qm-it' + (mono ? ' qm-mono' : '') + (cur === it.go ? ' on' : '') + '"'
        + (mono ? '' : ' data-accent="' + esc(it.acc || it.go) + '"')
        + ' data-qm-go="' + esc(it.go) + '"' + (cur === it.go ? ' aria-current="page"' : '') + ' style="--i:' + Math.min(i, 12) + '">'
        + '<span class="qd-badge">' + (global.icon ? global.icon(it.ico, 'qd-ico') : '') + '</span>'
        + '<span class="qm-n">' + esc(it.name) + '</span></button>';
    }
    /* 各组同一个列宽（按全部格子里最长的名字），上下几组的格子对齐 */
    function menuGrid(items, cur, mono, start, w) {
      return '<div class="qm-grid" style="--qm-ch:' + w.toFixed(1) + '">' + items.map(function (it, k) { return menuTile(it, start + k, cur, mono); }).join('') + '</div>';
    }
    function renderMenu() {
      var d = Storage.get();
      var b = Storage.activeBaby ? Storage.activeBaby() : null;
      var name = (Storage.babyLabel && b) ? Storage.babyLabel(b) : ((d.settings.baby && (d.settings.baby.nickname || d.settings.baby.name)) || '宝宝');
      var bd = (b && b.birthDate) || (d.settings.baby && d.settings.baby.birthDate) || null;
      var gr = (d.growth || []).slice().sort(function (x, y) { return (String(y.date || '') + (y.at || '')).localeCompare(String(x.date || '') + (x.at || '')); }); /* 第 284 次：同一天按测量时刻 */
      var hh = null, ww = null;
      gr.forEach(function (r) { if (hh == null && r.heightCm != null) hh = r.heightCm; if (ww == null && r.weightKg != null) ww = r.weightKg; });
      var meta = [babyAge(bd), hh != null ? hh + 'cm' : '', ww != null ? ww + 'kg' : ''].filter(Boolean).map(function (x) { return '<span>' + esc(x) + '</span>'; }).join('');
      var ava = (b && b.photo) ? '<img src="' + esc(b.photo) + '" alt="">' : (global.illo ? illo('avatar') : '');
      var cur = current;
      var h = '<div class="qd-grab" aria-hidden="true"><i></i></div><div class="qm-scroll">'
        + '<div class="qm-head">'
        + '<button type="button" class="qm-baby" data-qm="baby" aria-label="' + esc('宝宝资料：' + name) + '"><span class="qm-ava">' + ava + '</span>'
        + '<span class="qm-bt"><b class="qm-name">' + esc(name) + '</b>' + (meta ? '<small class="qm-meta">' + meta + '</small>' : '') + '</span></button>'
        + '<button type="button" class="qm-swap" data-qm="swap" aria-label="切换宝宝">' + SWAP_SVG + '<span>切换</span></button></div>'
        + '<button type="button" class="qm-search" data-qm="search" aria-label="搜索记录、里程碑、用品"><span class="si-ico">' + (global.icon ? icon('search') : '') + '</span><span>搜索全部记录</span></button>';
      var groups = ((global.Modules && Modules.alltools && Modules.alltools._groups) || []).filter(function (g) { return g.key !== 'tools'; });
      if (App.stageOf && App.stageOf(d) === 'pregnancy') groups = groups.slice().sort(function (x, y) { return x.key === 'pregnancy' ? -1 : (y.key === 'pregnancy' ? 1 : 0); });
      var secs = groups.map(function (g) {
        return { t: g.title === '通用' ? '全部功能' : g.title,
          items: g.items.filter(function (it) { return it.id !== 'whitenoise'; }) /* 上面「哄睡声音」已有 */
            .map(function (it) { return { go: it.id, ico: it.id, name: it.name }; }) };
      });
      var w = 2;
      MENU_TOP.concat.apply(MENU_TOP, secs.map(function (x) { return x.items; })).forEach(function (it) { w = Math.max(w, chW(it.name)); });
      var n = 0;
      h += '<nav class="qm-sec" aria-label="常用">' + menuGrid(MENU_TOP, cur, true, n, w) + '</nav>'; n += MENU_TOP.length;
      secs.forEach(function (x) {
        h += '<nav class="qm-sec" aria-label="' + esc(x.t) + '"><h3 class="qm-gh">' + esc(x.t) + '</h3>' + menuGrid(x.items, cur, false, n, w) + '</nav>';
        n += x.items.length;
      });
      h += '</div>';
      list.innerHTML = h;
      list.setAttribute('tabindex', '-1');
    }
    function openMenu() {
      if (mode === 'menu' && root.classList.contains('open') && !root.classList.contains('qd-closing')) return;
      /* 菜单收回动画中再点 = 重新展开（它那条记录还没退，接着用） */
      if (mode === 'menu' && pendingRm && menuRel) {
        clearTimeout(closingT); closingT = 0; pendingRm = null;
        root.classList.remove('qd-closing'); root.classList.remove('qd-dragged'); list.style.removeProperty('--qd-dy');
        if (mask) mask.style.opacity = '';
        showOpen(document.getElementById('avatarBtn'));
        return;
      }
      /* ＋ 开着 / 正在收：立即收起，换成菜单 */
      if (root.classList.contains('open')) { close(true); detachOutside(); }
      /* 上一次关闭的 history.back() 还没落地：等它落地再开（否则新记录压在马上要被退掉的那条上） */
      if (App._histBusy && App._histBusy()) {
        if (!waitOpen) { waitOpen = true; App._histIdle(function () { if (waitOpen) { waitOpen = false; openMenu(); } }); }
        return;
      }
      waitOpen = false;
      var ae = document.activeElement;
      /* 键盘开着（日期记录页的输入框等）先收起 */
      if (ae && ae !== document.body && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) { try { ae.blur(); } catch (e) {} ae = null; }
      opener = (ae && ae !== document.body) ? ae : document.getElementById('avatarBtn');
      mode = 'menu'; root.classList.add('qd-menu');
      root.classList.remove('qd-closing'); root.classList.remove('qd-dragged'); list.style.removeProperty('--qd-dy');
      renderMenu();
      /* 画面开始变化之前登记（WebKit 在 pushState 时给当前画面拍系统返回用的快照，拍到的是没开面板的页面） */
      var rel = App._pushOverlay ? App._pushOverlay(function () { if (menuRel === rel) { close(true, { fromPop: true }); detachOutside(); } }, { later: true }) : null;
      menuRel = rel;
      showOpen(document.getElementById('avatarBtn'));
      setTimeout(function () {
        if (mode === 'menu' && root.classList.contains('open') && !list.contains(document.activeElement)) { try { list.focus({ preventScroll: true }); } catch (e) {} }
      }, 60);
    }
    function closeMenu(now) { waitOpen = false; if (mode === 'menu' && root.classList.contains('open')) { close(now === true); detachOutside(); } }
    /* 选了入口：先关面板（立即，不留遮罩），再在同一个任务里切页——新页在下一帧前已经画好。
       进二级页时 pushHistory 把菜单那条记录改写成这一页（App._navAdopt）；没被改写（首页 / 日期记录 / 原地重画）就切完再退掉。 */
    function menuGo(fn) {
      var rel = menuRel; menuRel = null;
      opener = null;
      close(true, { nav: true }); detachOutside();
      App._navAdopt = rel;
      try { fn(); } catch (e) {}
      if (App._navAdopt === rel) App._navAdopt = null;
      if (rel) rel(); /* 已被改写复用时是空操作 */
    }
    list.addEventListener('click', function (e) {
      if (mode !== 'menu' || !root.classList.contains('open') || root.classList.contains('qd-closing')) return;
      if (Util.hapEcho && Util.hapEcho(e)) return;
      var t = e.target && e.target.closest ? e.target.closest('[data-qm-go],[data-qm]') : null;
      if (!t || !list.contains(t)) return;
      var go = t.getAttribute('data-qm-go'), act = t.getAttribute('data-qm');
      if (act === 'search') { menuGo(function () { if (App.openSearch) App.openSearch(); else showTab('search', { noVT: true }); }); return; } /* 同一次点击里聚焦，iOS 才弹键盘 */
      if (act === 'swap') { menuGo(function () { openBabySheet(); }); return; }
      if (act === 'baby') { menuGo(function () { App.openSettingsGroup('称呼与阶段'); }); return; }
      if (!go) return;
      if (go === '__edit') {
        menuGo(function () {
          if (global.Modules && Modules.home) Modules.home._edit = true;
          if (current === 'home') rerender(); else showTab('home', { noVT: true });
        });
        return;
      }
      if (go === current) { close(); detachOutside(); return; }
      menuGo(function () { showTab(go, { noVT: true }); });
    });
    /* 菜单面板上不叠别的面板：菜单开着时 #modalRoot 弹出了面板（别处代码打开的切换宝宝 / 确认框），菜单立即收起、退掉它那条记录，
       面板自己按原规则开合（菜单里自己的入口都是先关菜单再开面板，不会走到这里） */
    var mr = document.getElementById('modalRoot');
    if (mr && global.MutationObserver) {
      new MutationObserver(function () {
        if (mode !== 'menu' || !root.classList.contains('open')) return;
        var has = Array.prototype.some.call(mr.children, function (m) { return !m.classList.contains('sheet-leaving') && !m.classList.contains('sheet-ghost'); });
        if (has) { close(true, { nav: true }); detachOutside(); }
      }).observe(mr, { childList: true });
    }
    global.App.openMenu = openMenu;
    global.App.closeMenu = closeMenu;
    global.App.menuOpen = function () { return mode === 'menu' && root.classList.contains('open') && !root.classList.contains('qd-closing'); };
    /* 宝宝圆钮：开 / 关菜单（点按委托在按钮上，回声过滤） */
    var av = document.getElementById('avatarBtn');
    if (av && !av._qmBound) {
      av._qmBound = true;
      av.setAttribute('data-qm-toggle', '1');
      av.setAttribute('aria-haspopup', 'dialog');
      av.setAttribute('aria-controls', 'qdActions');
      av.setAttribute('aria-expanded', 'false');
      av.addEventListener('click', function (e) {
        if (Util.hapEcho && Util.hapEcho(e)) return;
        if (global.App.menuOpen()) closeMenu(); else openMenu();
      });
    }
  }

  /* 第 274 次（审计 #25）：SW 接管后的自动重载会落回首页，回前台时像 App 自己跳回首页。
     重载前把「在哪一页 / 设置的哪一组 / 哪个全屏计时开着」写进 sessionStorage（只对这一个标签页、2 分钟内有效），
     启动画好首页后再推进去（保证返回仍有落点、history 层级和手动进入一样）；
     计时本身存在 Storage 里，不受重载影响，只把全屏层按原样重新打开（计时已结束就不开）。
     启动时如果还在静默退回旧会话的 history（第 270 次 rewind），等退完再推，免得两边抢 history。 */
  var RESTORE_KEY = 'yiyaRestore';
  function saveRestore() {
    try {
      var full = null;
      var f = document.querySelector('body > .ftf');
      if (f) full = f.classList.contains('ftf-sleep') ? 'sleep' : f.classList.contains('ftf-pump') ? 'pump' : 'breast';
      var sg = -1;
      if (current === 'settings' && subExit) {
        var gs = document.querySelectorAll('#view .set-group');
        for (var i = 0; i < gs.length; i++) if (gs[i].classList.contains('sg-cur')) sg = i;
      }
      global.sessionStorage.setItem(RESTORE_KEY, JSON.stringify({ tab: current, sg: sg, full: full, t: Date.now() }));
    } catch (e) { /* 隐私模式等：照常落首页 */ }
  }
  var restoreWait = null; /* rewind 进行中时把恢复动作挂在这里 */
  function restoreAfterReload() {
    var r = null;
    try { r = JSON.parse(global.sessionStorage.getItem(RESTORE_KEY) || 'null'); global.sessionStorage.removeItem(RESTORE_KEY); } catch (e) { r = null; }
    if (!r || !r.t || Date.now() - r.t > 120000) return;
    var run = function () {
      restoreWait = null;
      try {
        var d = Storage.get();
        if (!d.settings || !d.settings.privacyAccepted) return;
        if (r.tab && r.tab !== 'home' && Modules[r.tab] && current === 'home') showTab(r.tab, { noVT: true });
        if (r.tab === 'settings' && r.sg >= 0) {
          var g = document.querySelectorAll('#view .set-group')[r.sg], sm = g && g.querySelector('summary');
          if (sm) sm.click();
        }
        if (r.full && Modules[r.full] && Modules[r.full]._openFull) {
          var live = r.full === 'sleep' ? d.openSleep : r.full === 'pump' ? d.pumpTimer : d.feedingTimer;
          if (live) Modules[r.full]._openFull();
        }
      } catch (e2) { /* 恢复失败就停在首页 */ }
    };
    if (global.__yiyaRewinding) restoreWait = run; else run();
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
    bindHomePager(); /* 第 291 次：首页左滑去日期页（只有这一个方向） */

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
    /* 第 181 次：「跟随时间」此前只在启动 / 切页时判一次——傍晚打开、一直开着，
       到 22:00 也不会变暗。每分钟（及回到前台时）比一次时段签名，变了才重套主题。 */
    try {
      var themeSig = function () { return [shouldDark(), isNightNow(), isDeepNightNow()].join(); };
      var lastSig = themeSig();
      var recheck = function () { var g = themeSig(); if (g !== lastSig) { lastSig = g; applyTheme(); } };
      if (global.setInterval) global.setInterval(recheck, 60000);
      document.addEventListener('visibilitychange', function () { if (document.visibilityState !== 'hidden') recheck(); });
    } catch (eT) { /* 无定时器环境：仍按切页时重判 */ }
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
      backBtn.innerHTML = icon('dk-back');
      /* 第 116 次：返回按钮改走 popHistory —— 与侧滑、系统返回键同一条出口。
         旧写法是 showTab('home')，会留下一条悬空 history 记录，
         导致按一次返回后，再按系统返回又「弹回」刚才那个模块。 */
      backBtn.addEventListener('click', function () {
        if (!popHistory()) { if (subExit) exitSubNow(); else showTab('home'); }
      });
    }
    /* 全局左上角宝宝头像（第 80 次重设计）：显示当前宝宝照片（未上传回落插画），
       多宝宝家庭点按即循环切换，单宝宝点按进设置（保持旧出口）。
       右上角新增设置齿轮——旧版右上角是天空大日期（已并入问候卡日期行）。 */
    var av = document.getElementById('avatarBtn');
    if (av) {
      av.setAttribute('aria-label', '菜单：宝宝与全部功能');
      /* 第 82 次（用户反馈：左上角右上角都进设置，冗余）：左上角专司宝宝切换——
         点按打开底部宝宝面板（列表点选切换 + 管理入口），不再直接进设置。
         呈现语义：短打断 → 半高底部面板（sheet），不是整页跳转。 */
      /* 第 245 次：宝宝圆钮打开功能入口；第 290 次起弹出菜单面板（点按绑定在 buildQuickDock 里），切换宝宝在面板顶部的「切换」 */
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
        /* 第 164 次（用户：主屏幕 App 每次更新都要删了重加太麻烦）：
           iOS 主屏 App 切回前台不会重新加载页面，SW 也就不会去查新版本——
           只有彻底划掉后台再开才更新。这里在每次回到前台时主动 reg.update()（至少隔 60 秒），
           发现新版本 → 新 SW 立刻接管 → 自动重载。
           正在输入 / 弹窗或面板打开时不打断，等下次切到后台再重载。 */
        var pendingReload = false;
        var busy = function () {
          var a = document.activeElement;
          /* 第 274 次：只认真在打字的框。iOS 触感用的隐藏开关（#__hapSw，checkbox）点一下就留着焦点，
             原来会被当成「正在输入」，更新一直拖到下次切后台 */
          if (a && (a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || (a.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|reset|range|hidden|color|file)$/i.test(a.type || '')))) return true;
          var m = document.getElementById('modalRoot');
          return !!(m && m.children.length);
        };
        var doReload = function () {
          if (global.__swReloaded) return;
          global.__swReloaded = true;
          try { global.sessionStorage.setItem('swReload', '1'); } catch (eS) { /* */ }
          saveRestore(); /* 第 274 次（审计 #25）：记下当前页，重载后回到这里 */
          if (global.location && global.location.reload) global.location.reload();
        };
        navigator.serviceWorker.addEventListener('controllerchange', function () {
          if (!hadController || global.__swReloaded) return;
          if (busy()) { pendingReload = true; return; }
          doReload();
        });
        /* 第 275 次：注册推迟到 load 之后。首次打开时新 SW 一装上就要预缓存 120 多个文件，
           原来和首页自己的脚本 / 图片抢带宽；热启动时 register 也会去服务器比对 sw.js，没必要挤在首屏。 */
        var regLater = function (fn) {
          var go = function () { setTimeout(fn, 300); };
          if (document.readyState === 'complete') go(); else global.addEventListener('load', go, { once: true });
        };
        regLater(function () { navigator.serviceWorker.register('sw.js').then(function (reg) {
          var lastCheck = Date.now();
          document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'hidden') { if (pendingReload) doReload(); return; }
            if (Date.now() - lastCheck < 60000) return;
            lastCheck = Date.now();
            try { reg.update().catch(function () {}); } catch (eU) { /* 离线等情况忽略 */ }
          });
        }).catch(function () {}); });
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
    restoreAfterReload(); /* 第 274 次（审计 #25）：SW 更新自动重载后回到原来那一页 */
    /* 第 163 次：桌面图标长按快捷菜单（manifest shortcuts）带 ?go=模块id 打开，
       先落首页（保证返回有落点），再推入目标模块；随后把参数从地址栏抹掉，刷新不会再跳一次。
       首次引导未完成时不跳，先走完引导。 */
    try {
      var goId = new URLSearchParams(global.location.search).get('go');
      if (goId) {
        if (global.history && global.history.replaceState) global.history.replaceState(global.history.state, '', global.location.pathname);
        if (goId !== 'home' && Modules[goId] && Storage.get().settings.privacyAccepted) showTab(goId);
      }
    } catch (eGo) { /* 地址参数异常时就停在首页 */ }
    Util.bindLongPressCopy(); /* 第 87 次：列表行长按复制该条记录（全局委托，一次绑定） */
    showOnboarding();
    maybeWeeklyReview();
    if (global.Boot) Boot.done(); /* 第 259 次：首页画好后播启动动画 */
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
  /* 第 244 次：返回时浏览器会先自动恢复旧滚动位置、App 再归零，iOS 上就是一下闪上 / 闪下；滚动全由 App 管。 */
  try { if ('scrollRestoration' in global.history) global.history.scrollRestoration = 'manual'; } catch (e) {}
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
    /* 第 290 次：从菜单面板进二级页时，面板打开时登记的那条 history（App._navAdopt）直接改写成这一页（replaceState 同步完成、不拍快照，
       搜索框点下去才能在同一次点击里弹出键盘；不必先异步 back 再 push）。 */
    /* 第 279 次：还有静默退回没落地时，push 排到它落地之后再做，否则会压在马上要被退掉的那条上。 */
    var adopt = (global.App && App._navAdopt) || null;
    if (adopt) App._navAdopt = null;
    historyDepth++;
    var op = function () {
      if (App._dfCancel) App._dfCancel(); /* 第 291 次：push 本身就清掉了前进栈，还没做的「清前进栈」作废 */
      try {
        if (adopt && App._ovAdopt && App._ovAdopt(adopt)) global.history.replaceState({ baoma: 1, id: id }, '');
        else if (App._guardTake && App._guardTake()) global.history.replaceState({ baoma: 1, id: id }, ''); /* 第 291 次：正站在占位上，直接改写成这一页 */
        else global.history.pushState({ baoma: 1, id: id }, '');
      } catch (e) { /* 极端内核禁pushState：侧滑降级为「只回到首页」 */ }
    };
    if (adopt && !(App._histBusy && App._histBusy())) op();
    else if (global.App && App._histIdle) App._histIdle(op); else op();
  }

  /** 退出当前模块：把 historyDepth 减到 0，并回退一条 history。
      侧滑与顶部返回按钮共用这个出口，保证两条路径行为一致。 */
  /* 第 182 次：页内二级页（目前用于设置分组）。模块自己切换内容，App 负责三件事：
     ① 登记一条 history，让侧滑 / 系统返回 / 底栏返回钮都能退回上一层；
     ② 底栏切成二级态（返回 + ＋）；③ 返回时回调模块的 onExit 收起二级内容。 */
  var subExit = null;
  /* 第 282 次：底部主按钮（#view .mod-cta）是 position: fixed（styles.css 末尾「底部主按钮」一节）。
     这里维护 body.has-cta（页面底部留白）和 --cta-h（按钮实际高度：字号档位、计时条、喂养双行都会变）。
     模块自己局部重画按钮（计时开始 / 结束）也要跟上：#view 子树变动后下一帧再查一次。 */
  var _ctaEl = null, _ctaRO = null, _ctaMO = null, _ctaRaf = 0;
  function syncCta() {
    var view = document.getElementById('view');
    var el = view ? view.querySelector('.mod-cta') : null;
    if (el) document.body.classList.add('has-cta'); else document.body.classList.remove('has-cta');
    if (!_ctaMO && view && global.MutationObserver) {
      _ctaMO = new MutationObserver(function () {
        if (_ctaRaf) return;
        _ctaRaf = requestAnimationFrame(function () { _ctaRaf = 0; syncCta(); });
      });
      _ctaMO.observe(view, { childList: true, subtree: true });
    }
    if (el === _ctaEl) return;
    if (_ctaRO) { try { _ctaRO.disconnect(); } catch (e) {} _ctaRO = null; }
    _ctaEl = el;
    if (!el) return;
    var put = function () {
      var h = el.offsetHeight;
      if (h > 0) document.documentElement.style.setProperty('--cta-h', h + 'px');
    };
    put();
    if (global.ResizeObserver) { _ctaRO = new ResizeObserver(put); _ctaRO.observe(el); }
  }
  /* 侧滑返回时 #view 有 transform，里面 fixed 的按钮会改成相对 #view 定位（跳到整页最底下）。
     拖动前把它换算成相对 #view 的 top，视觉位置不变；清掉跟手样式时还原。 */
  function freezeCta(on) {
    var view = document.getElementById('view');
    var el = view && view.querySelector('.mod-cta');
    if (!el) return;
    if (on) {
      if (el.style.top) return;
      var vr = view.getBoundingClientRect(), r = el.getBoundingClientRect();
      el.style.top = (r.top - vr.top) + 'px'; el.style.bottom = 'auto';
    } else { el.style.top = ''; el.style.bottom = ''; }
  }

  function syncOrb() {
    var orb = document.getElementById('dockOrb'), bar = document.getElementById('tabbar');
    if (!orb || !bar) return;
    var use = handMode() === 'normal' && isTopTab(current) && !subExit;
    orb.hidden = !use;
    if (use) document.body.classList.add('has-orb'); else document.body.classList.remove('has-orb');
    /* 第 244 次：二级页 dock 左缘对齐一级页（见 styles.css sub-anchor） */
    var anchor = !use && handMode() === 'normal';
    if (anchor) document.body.classList.add('sub-anchor'); else document.body.classList.remove('sub-anchor');
    if (use) {
      try {
        document.documentElement.style.setProperty('--dock-w', (bar.offsetWidth || 240) + 'px');
        document.documentElement.style.setProperty('--dock-bh', (bar.offsetHeight || 62) + 'px');
        /* 字体 / 图标晚一帧排好时宽度会变，下一帧再量一次 */
        requestAnimationFrame(function () { if (bar.offsetWidth) document.documentElement.style.setProperty('--dock-w', bar.offsetWidth + 'px'); });
      } catch (e) { /* QA 桩无布局 */ }
    }
  }
  try { global.addEventListener('resize', function () { syncOrb(); }); } catch (e) {}
  function syncSubDock() {
    var top = isTopTab(current);
    var bb = document.getElementById('backBtn');
    if (bb) bb.hidden = top && !subExit;
    var bar = document.getElementById('tabbar');
    if (bar) { if (!top || subExit) bar.classList.add('is-sub'); else bar.classList.remove('is-sub'); }
    syncOrb();
  }
  function enterSub(onExit) {
    var wasIn = !!subExit;
    subExit = onExit || function () {};
    if (!wasIn) pushHistory('__sub');
    syncSubDock();
  }
  function exitSubNow() {
    var f = subExit; subExit = null;
    syncSubDock();
    if (f) { try { f(); } catch (e) { /* 模块回调异常不影响返回 */ } }
  }
  function inSub() { return !!subExit; }

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
    freezeCta(true);
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
    freezeCta(false);
  }

  function onSwipeStart(e) {
    if (historyDepth <= 0) return;                /* 没有上一层，不响应 */
    if (document.querySelector('body > .ph-view')) return; /* 第 278 次：照片大图上的横滑是换张 */
    if (document.querySelector('body > .vb-book')) return; /* 第 289 次：疫苗本上的横滑是翻页，返回走 history */
    if (global.Sheet && Sheet.isOpen && Sheet.isOpen()) return; /* 第 272 次：面板开着时左缘拖动交给面板（下拉关闭），不拖底下的页 */
    if (document.body.classList.contains('qm-open')) return; /* 第 290 次：菜单面板开着时不拖底下的页（返回只关面板） */
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
      _swipeBackT = Date.now();
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
      /* 第 268 次（用户录屏：刚关掉的功能页会被从右边拉出来）：
         返回后，刚离开的那一层还留在 history 的「前进」栈里，iOS 就允许从右缘左滑「前进」，
         拉出那页的系统快照（App 并没有真的进去，松手后又弹回首页）。
         修法：每次返回落地后清掉前进栈——pushState 一个占位（会丢弃所有前进记录），
         再静默 back 回到当前层；前进栈里只剩这个占位，万一被拉到占位上也立刻静默退回。 */
      var ignorePop = 0;
      /* 第 278 次（审计 #30）：盖在页面 / 面板上面的临时层（照片大图、第 290 次起的菜单面板）登记自己的 history。
         系统返回 / popstate 先关最上面这一层；它自己关掉（点一下 / Esc）时调返回的 release，静默退掉这条记录。
         opts.later（菜单面板）：这条记录退掉之后清前进栈推迟到干净画面提交之后（dropForwardLater），不把面板拍进快照。 */
      var ovEntries = [], ovPopped = false, ovPoppedLater = false;
      global.App._pushOverlay = function (closeFn, opts) {
        if (global.__yiyaRewinding || rewind > 0) return null;
        /* 第 291 次：正站在占位上（还没退下来）→ 直接把占位改写成这条临时层记录 */
        try { if (guardTake()) global.history.replaceState({ baoma: 'ov' }, ''); else global.history.pushState({ baoma: 'ov' }, ''); } catch (eO) { return null; }
        dfSeq++; fwdGuard = false; /* 第 291 次：push 已清掉前进栈，排着的「清前进栈」作废 */
        var en = { close: closeFn, later: !!(opts && opts.later) };
        ovEntries.push(en);
        var release = function () {
          var i = ovEntries.indexOf(en); if (i < 0) return;
          ovEntries.splice(i, 1); ovPopped = true; ovPoppedLater = en.later; ignorePop++;
          try { global.history.back(); } catch (eO2) { ignorePop = Math.max(0, ignorePop - 1); ovPopped = false; }
        };
        release._en = en;
        return release;
      };
      global.App._ovDepth = function () { return ovEntries.length; };
      /* 第 290 次：pushHistory 把这条记录改写成新页（replaceState）——它不再是临时层，release 之后是空操作 */
      global.App._ovAdopt = function (rel) {
        var en = rel && rel._en, i = en ? ovEntries.indexOf(en) : -1;
        if (i < 0 || i !== ovEntries.length - 1) return false;
        ovEntries.splice(i, 1);
        return true;
      };
      /* 第 279 次：等静默退回（ignorePop / 启动回卷）全部落地再执行 fn；popstate 迟迟不来时 700ms 兜底放行 */
      var idleQ = [], idleT = 0;
      var flushIdle = function () {
        if (idleT) { clearTimeout(idleT); idleT = 0; }
        var q = idleQ.splice(0); q.forEach(function (f) { try { f(); } catch (eQ) {} });
      };
      /* 还有静默退回没落地（关闭临时层后的 back / 启动回卷） */
      global.App._histBusy = function () { return ignorePop > 0 || rewind > 0; };
      global.App._histIdle = function (fn) {
        if (ignorePop > 0 || rewind > 0 || idleQ.length) {
          idleQ.push(fn);
          if (!idleT) idleT = setTimeout(function () { idleT = 0; flushIdle(); }, 700);
        } else fn();
      };
      /* fwdGuard：前进栈里现在压着一条占位（它的系统快照是做 dropForward 那一刻屏幕上的画面） */
      var fwdGuard = false;
      var dropForward = function () {
        try {
          global.history.pushState({ baoma: 'guard' }, '');
          ignorePop++;
          global.history.back();
          fwdGuard = true;
        } catch (eG) { ignorePop = 0; }
      };
      /* 第 288 次：关掉菜单面板后清前进栈要等「干净画面」提交到屏幕之后再做——pushState 会给当前这条记录拍系统返回快照，
         紧跟着关闭同步做，拍到的是还没提交的上一帧（面板 / 遮罩还在），iOS 系统返回回到这条时会先盖上这张旧图最多 3 秒。
         两帧之后、期间没有别的 history 操作、菜单没有又打开（它的 pushState 已经清掉了前进栈）才做。 */
      var dfSeq = 0;
      var viewAnimating = function () {
        var v = document.getElementById('view');
        if (!v || !document.getAnimations) return false;
        try {
          return document.getAnimations().some(function (a) {
            var t = a.effect && a.effect.target;
            if (a.playState !== 'running' || !t || !(t === v || v.contains(t))) return false;
            var ct = a.effect.getComputedTiming ? a.effect.getComputedTiming() : null;
            return !(ct && ct.iterations === Infinity); /* 呼吸灯之类的循环动画不算 */
          });
        } catch (eA) { return false; }
      };
      var dropForwardLater = function () {
        var my = ++dfSeq, dfT0 = Date.now(), wait = 0;
        var go = function () {
          if (my !== dfSeq) return;
          var qd = document.getElementById('quickDock');
          /* 面板正在收起 / 拖动：等它静止再做（静止时才写 history） */
          if (qd && (qd.classList.contains('qd-closing') || qd.classList.contains('qd-dragging'))) { setTimeout(go, 120); return; }
          /* 第 291 次：首页左滑 / 边缘返回还在跟手或收尾：等静止（最多 1.6 秒） */
          if ((swipeActive || hpBusy()) && Date.now() - dfT0 < 1600) { setTimeout(go, 120); return; }
          dfSeq++;
          if (document.body && document.body.classList.contains('qm-open')) return;
          if (ignorePop > 0 || rewind > 0) return;
          dropForward();
        };
        var raf = global.requestAnimationFrame || function (f) { return setTimeout(f, 16); };
        raf(function () { raf(function () { setTimeout(go, wait); }); });
        setTimeout(go, wait + 160); /* rAF 被节流时的兜底（同一个序号，只做一次） */
      };
      global.App._dfCancel = function () { dfSeq++; fwdGuard = false; };
      global.App._fwdGuard = function () { return fwdGuard; };
      /* 第 291 次（真机：打开过一个页面再回首页，首页右缘左滑会把刚才那页拉回来）：
         根因：返回落地时 dropForward 在 popstate 里同步做「pushState 占位 + 立刻 back」，back 离开占位那一刻 iOS 给占位拍系统快照，
         屏幕上还是刚离开的那一页（首页还没画上屏）——前进栈里唯一那条的快照就是它，右缘左滑「前进」拉出来的就是刚才那页。
         改法：拆成两半。① 落地时（正在处理一次返回，不会有别的跳转在路上）同步 pushState 占位——前进栈立刻清空，此刻站在占位上；
         ② 等画面静止（入场动画、天空渐入、跟手 / 收尾都走完，最多 1.6 秒）再 back 离开占位，占位的快照 = 静止的当前页。
         不把 pushState 推迟：推迟的 pushState 会掐掉这期间用户发起、还在路上的返回（WebKit 实测第二次返回被吞）。
         站在占位上时：用户返回（落到下面那条）= 他在当前页按了返回，照常替他退一层；进新页 / 开临时层直接改写占位，不再多一条。 */
      var onGuard = false, gSeq = 0;
      /* 离开占位那一下 back 不能撞上用户自己发起、还在路上的返回（两次 back 叠在一起 WebKit 会丢一次）：
         手指按着 / 刚松手 350ms 内（系统边缘返回手势在松手时才真正跳转）、或别处刚调过 history.back / go / forward 还没等到 popstate，都先等一等 */
      var touchOn = 0, touchT = 0, touchEndT = 0, extNavT = 0, inNav = false;
      try {
        document.addEventListener('touchstart', function (e) { touchOn = (e.touches && e.touches.length) || 1; touchT = Date.now(); }, { capture: true, passive: true });
        var tEnd = function (e) { touchOn = (e.touches && e.touches.length) || 0; touchEndT = Date.now(); };
        document.addEventListener('touchend', tEnd, { capture: true, passive: true });
        document.addEventListener('touchcancel', tEnd, { capture: true, passive: true });
        ['back', 'go', 'forward'].forEach(function (k) {
          var o = global.history[k];
          if (typeof o !== 'function') return;
          global.history[k] = function () { if (!inNav && !(ignorePop > 0) && !(rewind > 0)) extNavT = Date.now(); return o.apply(global.history, arguments); };
        });
      } catch (eT) { /* 改不了 history 方法的内核：只靠触摸判断 */ }
      var userNavSoon = function () { var n = Date.now(); return (touchOn > 0 && n - touchT < 4000) || n - touchEndT < 350 || (extNavT && n - extNavT < 1000); };
      var guardTake = function () {
        if (!onGuard) return false;
        onGuard = false; gSeq++;
        var s0 = global.history.state;
        return !!(s0 && s0.baoma === 'guard');
      };
      global.App._guardTake = guardTake;
      global.App._onGuard = function () { return onGuard; };
      var leaveGuardLater = function () {
        var my = ++gSeq, t0 = Date.now();
        var go = function () {
          if (my !== gSeq || !onGuard) return;
          var qd = document.getElementById('quickDock');
          var moving = qd && (qd.classList.contains('qd-closing') || qd.classList.contains('qd-dragging'));
          if ((moving || swipeActive || hpBusy() || viewAnimating()) && Date.now() - t0 < 1600) { setTimeout(go, 120); return; }
          if ((ignorePop > 0 || rewind > 0 || userNavSoon()) && Date.now() - t0 < 6000) { setTimeout(go, 120); return; }
          if (ignorePop > 0 || rewind > 0) { if (Date.now() - t0 < 15000) setTimeout(go, 120); return; } /* 静默退回还在路上时绝不叠第二个 back */
          gSeq++;
          var s1 = global.history.state;
          onGuard = false;
          if (!s1 || s1.baoma !== 'guard') return;
          ignorePop++;
          inNav = true;
          try { global.history.back(); fwdGuard = true; } catch (eL) { ignorePop = Math.max(0, ignorePop - 1); }
          inNav = false;
        };
        var raf = global.requestAnimationFrame || function (f) { return setTimeout(f, 16); };
        raf(function () { raf(function () { setTimeout(go, 450); }); });
        setTimeout(go, 610);
      };
      /* 清前进栈（站上占位，静止后退下来）。还有静默退回在路上时排到它落地之后（pushState 会掐掉在路上的跳转） */
      var guardNow = function () {
        var op = function () {
          if (onGuard) { leaveGuardLater(); return; }
          try { global.history.pushState({ baoma: 'guard' }, ''); } catch (eG2) { return; }
          dfSeq++; fwdGuard = false; onGuard = true;
          leaveGuardLater();
        };
        global.App._histIdle(op);
      };
      /* 首页 ↔ 日期页互切：前进栈里那条占位的快照还是上一页，切完重拍（不登记新记录） */
      global.App._reguard = function () { if (fwdGuard && !onGuard) guardNow(); };
      /* 第 270 次（真机截图：抽屉开着时从左缘右滑，露出一张「深色主题 + 抽屉打开」的旧画面，像抽屉错乱）：
         那是 iOS 的系统返回手势，拉出的是 history 里上一条记录的旧快照。正常使用时首页永远落在第一条记录上，
         没有「上一条」可退；但 App 被系统回收后重新打开、或更新后自动重载时，如果当时停在某个功能页
         （history 里的模块记录），重新启动就从这条记录上开始画首页，身后还压着旧会话的记录和它们的快照。
         修法：启动时发现自己站在模块 / 占位记录上，就静默一路退回到 App 的第一条记录，再清掉前进栈。
         万一退回时浏览器要重新载入文档，先写 swReload 让启动动画跳过（第 267 次同一机制）。 */
      var rewind = 0;
      var st0 = global.history.state;
      /* 'drawer'：第 289 次及更早的侧拉页记录，更新后重载时可能还压在 history 里，按占位一样退掉 */
      if (st0 && (st0.baoma === 1 || st0.baoma === 'guard' || st0.baoma === 'drawer' || st0.baoma === 'ov')) {
        rewind = 12;
        global.__yiyaRewinding = true;
        try { global.sessionStorage.setItem('swReload', '1'); } catch (eS) {}
        try { global.history.back(); } catch (eR) { rewind = 0; global.__yiyaRewinding = false; }
      }
      global.addEventListener('popstate', function (ev) {
        if (!ignorePop) extNavT = 0; /* 第 291 次：别处发起的那次跳转已经落地 */
        /* 第 286 次：系统返回 / 侧滑返回时快捷面板不残留。第 290 次：菜单面板只认真正的返回（静默退回落地不关它） */
        if (global.App && App._qdClose) { try { App._qdClose(true, { fromPop: true, ignored: ignorePop > 0 || rewind > 0 }); } catch (eQ2) {} }
        if (rewind > 0) {
          var rs = ev && ev.state;
          if (rs && (rs.baoma === 1 || rs.baoma === 'guard' || rs.baoma === 'drawer' || rs.baoma === 'ov') && --rewind > 0) { try { global.history.back(); return; } catch (eR2) {} }
          rewind = 0;
          try { global.sessionStorage.removeItem('swReload'); } catch (eS2) {}
          dropForward();
          global.__yiyaRewinding = false;
          /* 第 274 次：等 dropForward 的那次静默 back 落地（下面 ignorePop 归零时）再恢复；兜底 800ms */
          if (restoreWait) setTimeout(function () { if (restoreWait) restoreWait(); }, 800);
          return;
        }
        if (ignorePop > 0) {
          ignorePop--;
          /* 临时层退掉自己那条记录后清掉前进栈（否则 iOS 能从右缘把它「前进」拉出来）；菜单面板推迟到干净画面之后 */
          if (!ignorePop && ovPopped && ovPoppedLater) { ovPopped = false; ovPoppedLater = false; flushIdle(); dropForwardLater(); return; }
          if (!ignorePop && ovPopped) { ovPopped = false; flushIdle(); guardNow(); return; }
          if (!ignorePop && restoreWait && !global.__yiyaRewinding) restoreWait();
          if (!ignorePop) flushIdle();
          return;
        }
        /* 第 288 次：排队中的 history 写入被真正的返回抢先了——它们是写给已经退掉的那条记录的，作废 */
        if (idleQ.length) { idleQ.splice(0); if (idleT) { clearTimeout(idleT); idleT = 0; } }
        var st = ev && ev.state;
        /* 第 291 次：站在占位上时用户返回（落到占位下面那条，也就是当前页自己那条）＝他在当前页按了返回 */
        if (onGuard) {
          onGuard = false; gSeq++;
          if (current === 'home' && historyDepth <= 0 && !subExit && !ovEntries.length) { fwdGuard = true; return; } /* 首页没有上一层：什么都不做 */
          if (ovEntries.length || (global.Sheet && Sheet.isOpen && Sheet.isOpen()) || topFullLayer()) {
            /* 上面盖着临时层 / 面板 / 全屏计时：只关它，留在原页，重新站上占位 */
            if (ovEntries.length) { var oe0 = ovEntries.pop(); try { oe0.close(); } catch (eOC0) {} }
            else if (global.Sheet && Sheet.isOpen && Sheet.isOpen()) Sheet.closeTop();
            else collapseFullLayer(topFullLayer());
            guardNow();
            return;
          }
          /* 再替他退一层（history 回到上一页那条），界面按正常返回走 */
          ignorePop++; try { global.history.back(); } catch (eOB0) { ignorePop = Math.max(0, ignorePop - 1); }
          if (subExit) { historyDepth = Math.max(0, historyDepth - 1); exitSubNow(); guardNow(); return; }
          if (current !== 'home') { historyDepth = Math.max(0, historyDepth - 1); showTab('home'); guardNow(); }
          return;
        }
        /* 第 278 次（审计 #30）：照片大图等最上层临时层开着 → 只关它（它登记的那条记录已被这次 back 退掉） */
        if (ovEntries.length) { var oe = ovEntries.pop(); try { oe.close(); } catch (eOC) {} if (oe.later) dropForwardLater(); else guardNow(); return; }
        if (st && st.baoma === 'ov') { ignorePop++; try { global.history.back(); } catch (eOB) { ignorePop = 0; } return; }
        if (st && st.baoma === 'guard') {
          /* 被「前进」到占位上（iOS 右缘左滑 / 桌面前进键）：就站在占位上，静止后再退下来（快照换成那时的画面）。
             在首页时这一下就是「往右边那页去」——和首页页内左滑一样进日期页（首页往日期页只有这一个方向；反方向在首页什么都不发生） */
          var toCal = current === 'home' && historyDepth <= 0 && !subExit && !(global.Sheet && Sheet.isOpen && Sheet.isOpen()) && !topFullLayer();
          fwdGuard = false; onGuard = true;
          if (toCal) showTab('calendar', { noVT: true, enterX: '24px' });
          leaveGuardLater();
          return;
        }
        /* 第 289 次及更早的侧拉页记录被「前进」到：和占位一样静默退回 */
        if (st && st.baoma === 'drawer') { ignorePop++; try { global.history.back(); } catch (eB0) { ignorePop = 0; } return; }
        /* 旧版本留下的前进记录：在首页、没有上一层时还收到模块记录 = 被「前进」了，静默退回 */
        if (st && st.baoma === 1 && current === 'home' && historyDepth <= 0 && !subExit) { ignorePop++; try { global.history.back(); } catch (eB2) { ignorePop = 0; } return; }
        /* 第 272 次（审计 #2）：面板开着时返回 = 先关面板、留在原页。这次 back 已经退掉一条记录，补推回来，层级不变 */
        if ((subExit || current !== 'home') && global.Sheet && Sheet.isOpen && Sheet.isOpen()) {
          Sheet.closeTop();
          try { global.history.pushState({ baoma: 1, id: current }, ''); } catch (eP) {}
          return;
        }
        /* 第 274 次（审计 #22）：全屏计时开着时返回 = 先收起它、留在原页（同面板） */
        var fl = topFullLayer();
        if (fl) {
          collapseFullLayer(fl);
          if (subExit || current !== 'home') { try { global.history.pushState({ baoma: 1, id: current }, ''); } catch (eP2) {} }
          return;
        }
        if (subExit) { historyDepth = Math.max(0, historyDepth - 1); exitSubNow(); guardNow(); return; }
        if (current !== 'home') { historyDepth = Math.max(0, historyDepth - 1); showTab('home'); guardNow(); }
      });
    } catch (e) { /* 忽略 */ }
  }


  /* 第 291 次（真机：「首页右滑是 dock 右侧的日期日历那一页，左滑应该是滑不动的」）：首页横向只有一个方向——
     手指往左滑（按 dock 顺序，日期记录在首页右边）＝跟手把首页推走、日期页从右边进来；往右滑什么都不发生（不跟手、不导航）。
     不碰 history（首页和日期页是平级一级页）；左缘 24px 起手不接（留给 iOS 系统返回）；竖向为主交给滚动 / 下拉搜索；
     面板、菜单、编辑布局、全屏层开着时不接；列表行左滑删除、输入框、滑杆、可横滚的容器里起手不接。
     只写 transform / opacity；减少动态效果时不跟手，过阈值直接切页。 */
  var hp = null, hpAnimT = 0;
  function hpBusy() { return !!hp || !!hpAnimT; }
  function hpReduced() { try { return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; } }
  function hpCanStart(tg) {
    if (current !== 'home' || subExit || historyDepth > 0) return false;
    var b = document.body.classList;
    if (b.contains('qd-open') || b.contains('qm-open') || b.contains('sheet-open') || b.contains('ftf-open') || b.contains('ob-open') || b.contains('ps-pull')) return false;
    if (document.documentElement.classList.contains('wp-lock') || document.documentElement.classList.contains('is-booting')) return false;
    if (global.Sheet && Sheet.isOpen && Sheet.isOpen()) return false;
    var mr = document.getElementById('modalRoot');
    if (mr && mr.children.length) return false;
    var H = Modules.home;
    if (H && (H._edit || H._sheet)) return false;
    if (document.querySelector('body > .ph-view, body > .vb-book, body > .ftf, body > .cal-pop-mask, #homeSheet:not([hidden])')) return false;
    if (!tg || !tg.closest) return true;
    if (tg.closest('input, textarea, select, [contenteditable], #tabbar, #dockOrb, #quickDock, .dock-live, [data-no-swipe], .record-grid.is-editing, li.sw-row')) return false;
    var view = document.getElementById('view');
    for (var n = tg; n && n !== view && n.nodeType === 1; n = n.parentNode) {
      if (n.scrollWidth > n.clientWidth + 2) {
        var ox = global.getComputedStyle(n).overflowX;
        if (ox === 'auto' || ox === 'scroll') return false;
      }
      if (n.querySelector && n.tagName === 'LI' && n.querySelector(':scope [data-del]')) return false; /* 左滑删除的行 */
    }
    return true;
  }
  function hpPaint(x, animate) {
    var view = document.getElementById('view');
    if (!view) return;
    var vw = global.innerWidth || 1;
    view.style.transition = animate ? 'transform .26s cubic-bezier(.32,.72,0,1), opacity .26s linear' : 'none';
    view.style.transform = x ? 'translate3d(' + x.toFixed(1) + 'px,0,0)' : '';
    view.style.opacity = x ? String(Math.max(0.35, 1 + x / vw * 0.9).toFixed(3)) : '';
  }
  function hpClear() {
    var view = document.getElementById('view');
    if (view) { view.style.transition = ''; view.style.transform = ''; view.style.opacity = ''; }
  }
  function bindHomePager() {
    try {
      document.addEventListener('touchstart', function (e) {
        hp = null;
        if (hpAnimT || !e.touches || e.touches.length !== 1) return;
        var t = e.touches[0];
        if (t.clientX <= SWIPE_EDGE) return;               /* 左缘归 iOS 系统返回 */
        if (!hpCanStart(e.target)) return;
        hp = { x0: t.clientX, y0: t.clientY, lock: 0, dx: 0, s: [[Date.now(), t.clientX]] };
      }, { passive: true });
      document.addEventListener('touchmove', function (e) {
        if (!hp || hp.lock < 0) return;
        var t = e.touches && e.touches[0]; if (!t) return;
        var dx = t.clientX - hp.x0, dy = t.clientY - hp.y0;
        if (!hp.lock) {
          if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
          /* 竖向为主、往右（反方向）、或这次 move 已不能取消（页面在惯性滚动）：整段手势都不接 */
          if (Math.abs(dx) <= Math.abs(dy) * 1.15 || dx > 0 || !e.cancelable || document.body.classList.contains('ps-pull')) { hp.lock = -1; return; }
          hp.lock = 1;
        }
        if (e.cancelable) e.preventDefault();
        hp.dx = Math.min(0, dx);
        var now = Date.now();
        hp.s.push([now, t.clientX]);
        while (hp.s.length > 2 && now - hp.s[0][0] > 100) hp.s.shift();
        if (!hpReduced()) hpPaint(hp.dx, false);
      }, { passive: false });
      var end = function (e) {
        var g = hp; hp = null;
        if (!g || g.lock !== 1) return;
        var vw = global.innerWidth || 1, v = 0, now = Date.now();
        if (g.s.length > 1) { var a = g.s[0], z = g.s[g.s.length - 1]; if (now - z[0] < 80 && z[0] > a[0]) v = (z[1] - a[1]) / (z[0] - a[0]); }
        var go = e.type !== 'touchcancel' && current === 'home' && (g.dx <= -vw * 0.25 || (v <= -0.35 && g.dx <= -30));
        var red = hpReduced();
        if (go) {
          if (Util.haptic) Util.haptic('light');
          if (red) { hpClear(); showTab('calendar', { noVT: true }); return; }
          hpPaint(-vw * 0.32, true);
          hpAnimT = setTimeout(function () {
            hpAnimT = 0;
            hpClear();
            if (current === 'home') showTab('calendar', { noVT: true, enterX: '24px' });
          }, 150);
        } else {
          if (red || !g.dx) { hpClear(); return; }
          hpPaint(0, true);
          hpAnimT = setTimeout(function () { hpAnimT = 0; hpClear(); }, 270);
        }
      };
      document.addEventListener('touchend', end, { passive: true });
      document.addEventListener('touchcancel', end, { passive: true });
    } catch (e) { /* 没有 touch 的环境不绑 */ }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
