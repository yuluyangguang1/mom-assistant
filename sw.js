/* 咿呀记（原宝妈助手）Service Worker — 静态资源离线缓存（PWA 完整化）
   ============================================================
   仅在 http(s) 环境下由 app.js 注册；file:// 双击打开时浏览器不提供
   Service Worker，应用照旧以纯本地方式运行，功能零损失。

   策略：network-first —— 联网时总是取最新资源并顺手更新缓存；离线时回落缓存。
   首次离线前需成功打开过一次页面。
   （第 127 次更正：本注释原写「stale-while-revalidate」，与实现不符——fetch 处理器
     自始就是 fetch 优先 + catch 回落缓存。第三方审查据此误判「index.html 可能长期
     返回旧版」，实际联网时永远取新版，仅离线才用缓存。）

   ★ 改任何被缓存的静态文件后，必须递增 CACHE 版本号，
     否则已安装用户会一直命中旧缓存（activate 时统一清理旧版本）。 */

var CACHE = 'baoma-static-v183';
/* v90（第 129 次）：首屏降噪——对标 Cali 首屏设计（HomeWidgetSnapshot 无 reminder 字段，
   逾期只以 VaccineReminderPlan.pendingCount 计数存在）。疫苗逾期 / 儿保过参考时间 /
   发育观察期过期这三类「今天不可能完成」的陈旧待办，从三条整卡合并为一行「待补」汇总
   （reminders.js evaluate 内合并 + home.js is-pending 紧凑行 + styles.css 降噪样式），
   首页空间还给此刻可做的提醒。 */
/* v89（第 128 次 · 前端优化三件套）：
   ① 「昨夜最长连续」标错对象修复——原取「start 最新的已结束睡眠」，午睡会把
      磁贴/统计顶成错值；改按 sleep.js lastNightRecords 归属口径取昨夜整组最长一段；
   ② A1+A2 触摸目标补齐（U-08 / WCAG 2.2 SC 2.5.5 AAA 44×44）——btn-mini 40→44、
      sp-tpl-btn 38→44、mood-lv 41→44、week-strip 格宽 41.7→44+（gap 4→1px）、
      cal-toggle 30→44、row-switch 行 38→44、search-input 38.4→44、
      home-edit-btn 28→44、ds-opt 行 23→44、pack-item label 25.8→铺满 64px 行；
   ③ 候选 5+1 落产线（10-11 实测拍板）——mood 补 guide、temp/supplies 退出冷启动
      占位、两份 STAGE_ORDER「每日必做优先」；「全部功能」入口上移到磁贴网格之前
      （文档 ≈1154px→502px，首屏内可达）。
   v88（第 127 次修复）：① 安全——宝宝照片 dataURL 白名单由「前缀」收紧为严格 base64
   正则（原先 `data:image/png" onerror="…` 可闭合 src 属性逃逸，而 photo 有 4 处裸拼
   innerHTML，实测顶栏头像启动即执行注入）；② 安全——打印成长报告全字段转义
   （此前 r.date / done[it.key] 等裸拼进 document.write，新窗口同源可访问 opener）；
   ③ 安全——settings.baby 由「零字段校验」改为逐字段清洗（其 birthGestWeeks 会落进
   growth 页的 value 属性，是照片之外的第二条注入通道）；④ index.html 增加 CSP
   （已实测 file:// 双击与 http:// 部署双场景零违规、功能无回归）；⑤ 打印时机由固定
   300ms 改为等新窗口 load；⑥ contraction 补 `|| []` 兜底；⑦ search 的 INDEX 由模块级
   改为 render 内局部变量（名实相符）；⑧ sw 头注释更正为 network-first（与实现一致）
   + cache.add 失败由静默吞错改为 console.warn。
   v87（第 126 次修复）：styles.css 编辑态角标点不动——.record-tile 基线
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
  'assets/icon-192.png',
  'assets/icon-512.png',
  'assets/maskable-512.png',
  'assets/apple-touch-icon.png',
  'assets/favicon-32.png',
  'assets/favicon-16.png',
  'manifest.webmanifest',
  'css/styles.css',
  'js/util.js',
  'js/lunar.js',
  'js/weather.js',
  'js/storage.js',
  'js/icons.js',
  'js/care.js',
  'js/sky.js',
  'js/reminders.js',
  'js/knowledge.js',
  'js/sheet.js',
  'js/swipe-row.js',
  'js/record-edit.js',
  'js/awake.js',
  'js/large-title.js',
  'js/hero.js',
  'assets/hero/feeding.webp',
  'assets/hero/sleep.webp',
  'assets/hero/diaper.webp',
  'assets/hero/growth.webp',
  'assets/hero/vaccine.webp',
  'assets/hero/temp.webp',
  'assets/hero/bath.webp',
  'assets/hero/swim.webp',
  'assets/hero/sun.webp',
  'assets/hero/water.webp',
  'assets/hero/jaundice.webp',
  'assets/hero/meds.webp',
  'assets/hero/supplement.webp',
  'assets/hero/milestone.webp',
  'assets/hero/mood.webp',
  'assets/hero/fetal.webp',
  'assets/hero/contraction.webp',
  'assets/hero/period.webp',
  'assets/hero/finance.webp',
  'assets/hero/supplies.webp',
  'assets/sounds/pink.webp',
  'assets/sounds/white.webp',
  'assets/sounds/brown.webp',
  'assets/sounds/shush.webp',
  'assets/sounds/ocean.webp',
  'assets/sounds/heart.webp',
  'assets/sounds/fan.webp',
  'assets/sounds/rain.webp',
  'assets/sounds/dryer.webp',
  'assets/hero/packing.webp',
  'assets/hero/pregnancy.webp',
  'assets/hero/whitenoise.webp',
  'js/glass.js',
  'js/app.js',
  'js/greetings.js',
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
  /* 第 132 次（对标 Cali 21 工具补缺）：六个新模块必须进预缓存，
     否则离线时 showTab 到这些页会白屏（Q125 哨兵会直接拦下）。 */
  'js/modules/bath.js',
  'js/modules/swim.js',
  'js/modules/sun.js',
  'js/modules/water.js',
  'js/modules/jaundice.js',
  'js/modules/supplement.js',
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
        /* 第 164 次：cache:'reload' 绕过浏览器 HTTP 缓存（GitHub Pages 默认 max-age=600），
           否则推送后 10 分钟内装上的新 SW 可能把旧文件当新版本缓存起来 */
        return cache.add(new Request(url, { cache: 'reload' })).catch(function (err) { console.warn('[SW] 预缓存失败:', url, err); });
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
  /* 第 146 次（P1 · 弱网超时）：原先纯网络优先、无超时——地铁/医院这类「有信号但极慢」的网络下，
     页面会一直白屏等网络，离线缓存形同虚设。现在网络 3 秒没回来就先用缓存顶上，
     网络稍后回来仍会在后台更新缓存（下次打开即新版）；没有缓存时照旧等网络。 */
  var TIMEOUT_MS = 3000;
  /* 第 164 次：网络请求一律带 no-cache 去服务器校验（没变只回 304，很省流量），
     避免浏览器 HTTP 缓存把刚推送的新版本挡住；navigate 请求不能带 init 重建，单独用 URL 构造 */
  var netReq;
  try { netReq = req.mode === 'navigate' ? new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' }) : new Request(req, { cache: 'no-cache' }); }
  catch (eReq) { netReq = req; }
  var network = fetch(netReq).then(function (res) {
    if (res && res.ok) {
      var copy = res.clone();
      caches.open(CACHE).then(function (cache) { cache.put(req, copy); });
    }
    return res;
  });
  e.respondWith(new Promise(function (resolve, reject) {
    var settled = false;
    function done(r) { if (!settled && r) { settled = true; resolve(r); } }
    var timer = setTimeout(function () {
      caches.match(req, { ignoreSearch: true }).then(done);
    }, TIMEOUT_MS);
    network.then(function (res) { clearTimeout(timer); done(res); }).catch(function () {
      clearTimeout(timer);
      caches.match(req, { ignoreSearch: true }).then(function (r) {
        if (r) done(r);
        else if (!settled) { settled = true; reject(new Error('offline and not cached')); }
      });
    });
  }));
  /* 超时后先返回了缓存，网络请求仍在跑；waitUntil 保证 SW 不在它写完缓存前被回收 */
  e.waitUntil(network.catch(function () {}));
});
