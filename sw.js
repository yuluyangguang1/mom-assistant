/* 宝妈助手 Service Worker — 静态资源离线缓存（PWA 完整化）
   ============================================================
   仅在 http(s) 环境下由 app.js 注册；file:// 双击打开时浏览器不提供
   Service Worker，应用照旧以纯本地方式运行，功能零损失。

   策略：stale-while-revalidate —— 有缓存先秒回，后台异步更新；
   首次离线前需成功打开过一次页面。

   ★ 改任何被缓存的静态文件后，必须递增 CACHE 版本号，
     否则已安装用户会一直命中旧缓存（activate 时统一清理旧版本）。 */

var CACHE = 'baoma-static-v87';
/* v87（第 126 次修复）：styles.css 编辑态角标点不动——.record-tile 基线
   overflow:hidden 把 top:-9px/right:-9px 的删除角标裁到只剩可见 18×18
   （实测可见面积 47.9%），elementFromPoint 证实「角标中心点落空、仅内缩区命中」，
   用户凭直觉点中心必然点不动。修法：编辑态放开裁剪（overflow:visible）+
   角标 ::before 扩命中区到 44×44（Apple HIG 下限）；浏览态维持 hidden 不变。
   真机 CDP 触摸实测：删除/切大小/拖动排序三项全部生效，314 QA + 398 对比度零回归。
   v86（第 125 次修复）：① util.js/reminders.js 日期函数——纯日期串与日期时间串
   混用差一天（中国时区即复现），统一到本地日历日口径；② sw 预缓存补齐
   alltools.js / search.js（第 118 次加入 index.html 时漏登记）；③ home.js
   编辑态拖拽 pointerup 只绑 grid 导致指针移出网格松手时拖动卡死；
   ④ homeLayout 的 removed 与 items 冲突时已删组件仍显示。
   v85（第 124 次修复）：home.js 编辑模式拖拽捕获时序——pointerdown 即捕获导致
   click 被改判到磁贴行，删除/大小角标点不动；改为拖动成立（350ms）时才捕获。
   v84（第 123 次）：home.js 直接记录第二批（瓶喂/亲喂/吸奶步进卡）、styles.css
   步进器样式。凡触碰过的缓存文件随版本重新下发。 */

var ASSETS = [
  './',
  'index.html',
  'assets/logo-1024.png',
  'assets/icon-192.png',
  'assets/icon-512.png',
  'assets/maskable-512.png',
  'assets/apple-touch-icon.png',
  'assets/favicon-32.png',
  'assets/favicon-16.png',
  'manifest.webmanifest',
  'css/styles.css',
  'js/util.js',
  'js/storage.js',
  'js/icons.js',
  'js/sky.js',
  'js/reminders.js',
  'js/knowledge.js',
  'js/glass.js',
  'js/app.js',
  'js/modules/home.js',
  'js/modules/calendar.js',
  'js/modules/settings.js',
  'js/modules/feeding.js',
  'js/modules/diaper.js',
  'js/modules/meds.js',
  'js/modules/sleep.js',
  'js/modules/whitenoise.js',
  'js/modules/contraction.js',
  'js/modules/fetal.js',
  'js/modules/temp.js',
  'js/modules/growth.js',
  'js/modules/vaccine.js',
  'js/modules/milestone.js',
  'js/modules/packing.js',
  'js/modules/finance.js',
  'js/modules/period.js',
  'js/modules/pregnancy.js',
  'js/modules/supplies.js',
  'js/modules/mood.js',
  'js/modules/alltools.js',
  'js/modules/search.js'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (cache) {
      /* 逐个缓存：单个资源失败不阻断安装（如开发者临时改名的文件） */
      return Promise.all(ASSETS.map(function (url) {
        return cache.add(url).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  /* 只处理同源 GET；API/跨端/非 GET 一律直连 */
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;
  /* 开发预览（localhost / 127.0.0.1）完全绕过缓存：否则改完源码刷新仍是旧版本，
     会把开发中的 bug 误判成「代码没生效」。离线缓存只服务于真实部署域名。 */
  if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(self.location.hostname)) return;
  e.respondWith(
    fetch(req).then(function (res) {
      /* 网络优先：拿到新资源就顺手更新缓存；离线时回落缓存（保证可离线） */
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE).then(function (cache) { cache.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req, { ignoreSearch: true });
    })
  );
});
