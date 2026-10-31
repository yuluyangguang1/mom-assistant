/* 咿呀记（原宝妈助手）Service Worker — 静态资源离线缓存（PWA 完整化）
   ============================================================
   仅在 http(s) 环境下由 app.js 注册；file:// 双击打开时浏览器不提供
   Service Worker，应用照旧以纯本地方式运行，功能零损失。

   策略：network-first —— 联网时总是取最新资源并顺手更新缓存；离线时回落缓存。
   例外（第 270 次）：assets/ 下的图片缓存优先（见 fetch 处理器），换图必须升 CACHE 版本号。
   首次离线前需成功打开过一次页面。
   （第 127 次更正：本注释原写「stale-while-revalidate」，与实现不符——fetch 处理器
     自始就是 fetch 优先 + catch 回落缓存。第三方审查据此误判「index.html 可能长期
     返回旧版」，实际联网时永远取新版，仅离线才用缓存。）

   ★ 改任何被缓存的静态文件后，必须递增 CACHE 版本号，
     否则已安装用户会一直命中旧缓存（activate 时统一清理旧版本）。 */

var CACHE = 'baoma-static-v298';
/* v298（第 337 次 · 三套新图）：① 扁平补图 23 个 + 重画 4 个（宝宝 / 亲喂 / 宫缩 / 黄疸）进 assets/icons/v4/（ICONS_V4 名单 30 → 53）；
   ② dock 三颗换扁平（assets/dock/<k>-on[-d]@2x/3x/4x，dock-icons.js 内联 72px 位图）；③ 3D 黏土物件 30 张（assets/supplies/，用品清单 / 营养品剂型）；
   ④ 小咿呀表情换新一套透明 3D 头像（assets/yiya/ 27 张 + cheer 加油、yiya.webp、dock/baby-lg.webp）。styles.css 图标 v4 段改成变量写法、白名单扩容。 */
/* v297（第 336 次 · 图标 v4）：用户 GPT 生成的 30 个彩色线面图标接入（assets/icons/v4/，icons.js 加 i4 标记，styles.css 按容器白名单换图）；
   新增 120 张透明 webp 预缓存（30 × 浅 / 深 × 2x / 3x，见 ASSETS 末尾），quickrec.js 瓶喂快记换奶瓶图标、settings.js 家庭共享换「全家」图标。 */
/* v296（第 335 次 · 系统通知级提醒）：新增 js/notify.js（提醒来源盘点 + 预约同步 + 前台咿呀岛 + 打开时补发 + 设置「系统通知」）；
   famcrypto.js 加本机提醒密钥 FamRemind 与家人记录推送文案；famsync.js 发「家人记了一条」推送；settings.js / famui.js / index.html 小改。
   SW：push 按类型分流（rem 本机提醒 / come、rec 家庭），App 在前台时转给页面弹咿呀岛（WebKit 仍须 showNotification，弹出后立即收起）；
   notificationclick 聚焦已有窗口并跳到对应页（没有窗口就 openWindow('./?go=…')）；pushsubscriptionchange 重新订阅并上报。 */
/* v295（第 334 次 · UI 统一批）：二级 dock 对齐一级原生尺寸（dock-fuse.js 读 --dk-h / --dk-m）、提示全部回到顶部咿呀岛（util.js 删 dock 卡片）、
   按压态 token 化（touchfx.js）、三级页横推 / 展开收起 / 模块切换 / 数字变化过渡（app.js）、审查修正（styles.css / alltools / calendar / growth / prenatal / quickrec）。 */
/* v294（第 333 次 · 设置页重做 + 我的快记）：新增 js/quickrec.js（首页快记卡与「＋」面板共用的快记清单、记法、编辑）；
   settings.js / home.js / app.js / storage.js / datamgr.js / styles.css 有改动。 */
/* v293（第 332 次 · 家庭共享）：famcrypto.js（页面与 SW 共用的加密 + IndexedDB 密钥仓库）、famsync.js、famui.js、
   js/vendor/qrcode.js（MIT）、js/vendor/jsqr.min.js（Apache-2.0）进预缓存；SW 新增 push / notificationclick：
   推送用家庭密钥派生的推送子密钥解密，通知文字只有「称呼 + 动作」，任何一步不对就显示通用「咿呀：家里有新消息」。 */
try { importScripts('js/famcrypto.js'); } catch (eImp) { /* 加载失败：推送退回通用文案，离线缓存照常 */ }
var REVALIDATED = {}; /* 第 270 次：图片缓存优先，后台校验过的 URL */
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
  'assets/boot-icon.webp', /* 第 275 次：启动层图标 336px（原来直接用 387KB 的 512 图） */
  'assets/yiya.webp', /* 第 277 次：顶部提示岛的小咿呀头像（120px） */
  /* 第 302 次：咿呀表情库 27 张（128px webp，共约 97KB） */
  'assets/yiya/happy.webp',
  'assets/dock/baby.webp', /* 第 304 次：新 dock 彩色页签图标 + 宝宝页头像 */
  'assets/dock/home.webp',
  'assets/dock/cal.webp',
  'assets/dock/baby-lg.webp',
  'assets/yiya/drink.webp',
  'assets/yiya/sleep.webp',
  'assets/yiya/cheeky.webp',
  'assets/yiya/puzzled.webp',
  'assets/yiya/sorry.webp',
  'assets/yiya/wow.webp',
  'assets/yiya/proud.webp',
  'assets/yiya/wave.webp',
  'assets/yiya/send.webp',
  'assets/yiya/phone.webp',
  'assets/yiya/heart.webp',
  'assets/yiya/flag.webp',
  'assets/yiya/hug.webp',
  'assets/yiya/whisper.webp',
  'assets/yiya/thumb.webp',
  'assets/yiya/clap.webp',
  'assets/yiya/shy.webp',
  'assets/yiya/yawn.webp',
  'assets/yiya/bday.webp',
  'assets/yiya/spoon.webp',
  'assets/yiya/bath.webp',
  'assets/yiya/blanket.webp',
  'assets/yiya/look.webp',
  'assets/yiya/wait.webp',
  'assets/yiya/oops.webp',
  'assets/yiya/think.webp',
  'assets/boot-text.png',
  'assets/maskable-512.png',
  'assets/apple-touch-icon.png',
  'assets/favicon-32.png',
  'assets/favicon-16.png',
  'manifest.webmanifest',
  'css/styles.css',
  'js/boot.js',
  'js/util.js',
  'js/daychart.js',
  'js/lunar.js',
  'js/weather.js',
  'js/storage.js',
  'js/photos.js',
  'js/icons.js',
  'js/care.js',
  'js/modskel.js',
  'js/sky.js',
  'js/reminders.js',
  'js/knowledge.js',
  'js/motion.js', /* 第 292 次：跟手动画共用物理 */
  'js/sheet.js',
  'js/swipe-row.js',
  'js/record-edit.js',
  'js/datamgr.js',
  'js/awake.js',
  'js/nightwin.js',
  'js/large-title.js',
  'js/hero.js',
  'assets/hero/feeding.webp',
  'assets/hero/breast.webp',
  'assets/hero/bottle.webp',
  'assets/feed/night.webp',
  'assets/feed/pump-night.webp',
  'assets/hero/pump.webp',
  'assets/hero/solid.webp', /* 第 269 次：辅食独立模块 */
  'assets/solid/t_liquid.webp',
  'assets/solid/t_puree.webp',
  'assets/solid/t_minced.webp',
  'assets/solid/t_granule.webp',
  'assets/solid/t_chunk.webp',
  'assets/solid/t_finger.webp',
  'assets/solid/c_grain.webp',
  'assets/solid/c_meat.webp',
  'assets/solid/c_fish.webp',
  'assets/solid/c_veg.webp',
  'assets/solid/c_fruit.webp',
  'assets/solid/c_other.webp',
  'assets/sleep/nursery.webp',
  'assets/imm/contraction.webp', /* 第 296 次：沉浸式宫缩计时背景 */
  'assets/imm/fetal.webp', /* 第 296 次：沉浸式数胎动背景 */
  'assets/hero/sleep.webp',
  'assets/hero/diaper.webp',
  'assets/diaper/clean.webp',
  'assets/diaper/pee.webp',
  'assets/diaper/both.webp',
  'assets/diaper/poop_gold.webp',
  'assets/diaper/poop_ygreen.webp',
  'assets/diaper/poop_green.webp',
  'assets/diaper/poop_brown.webp',
  'assets/diaper/poop_black.webp',
  'assets/diaper/poop_red.webp',
  'assets/diaper/poop_pale.webp',
  'assets/hero/growth.webp',
  'assets/hero/vaccine.webp',
  'assets/sticker/heart.webp', /* 第 289 次：疫苗本创可贴贴纸 */
  'assets/sticker/star.webp',
  'assets/sticker/flower.webp',
  'assets/sticker/sprout.webp',
  'assets/sticker/moon.webp',
  'assets/sticker/cloud.webp',
  'assets/sticker/cherry.webp',
  'assets/sticker/lemon.webp',
  'assets/hero/temp.webp',
  'assets/hero/bath.webp',
  'assets/hero/swim.webp',
  'assets/hero/sun.webp',
  'assets/hero/water.webp',
  'assets/hero/jaundice.webp',
  'assets/hero/meds.webp',
  'assets/hero/supplement.webp',
  'assets/hero/milestone.webp',
  'assets/hero/sick.webp',
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
  'assets/hero/momweight.webp', /* 第 297 次 */
  'assets/hero/prenatal.webp', /* 第 298 次 */
  'assets/hero/pregnancy.webp',
  'assets/hero/whitenoise.webp',
  'js/glass.js',
  'js/glass-optics.js', /* 第 312 次：液态玻璃共用光学模块 */
  'js/dock-refract.js', /* 第 275 次：iOS dock 真折射 */
  'js/dock-icons.js', /* 第 315 次：dock 线条 / 填色两套同路径图标 */
  'js/liquid-dock.js',
  'js/dock-live.js',
  'js/dock-fuse.js', /* 第 320 次：二级页底部融合玻璃（返回 / ＋ 圆钮 + 记录条） */
  'js/app.js',
  'js/greetings.js',
  'js/modules/home.js',
  'js/modules/calendar.js',
  'js/modules/settings.js',
  'js/famcrypto.js', /* 第 332 次：家庭共享 */
  'js/famsync.js',
  'js/famui.js',
  'js/notify.js', /* 第 335 次：系统通知级提醒 */
  'js/quickrec.js',
  'js/vendor/qrcode.js',
  'js/vendor/jsqr.min.js',
  'js/modules/feeding.js',
  'js/modules/feedtypes.js',
  'js/modules/pump.js',
  'js/modules/solid.js',
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
  'js/growth-std.js',
  'js/modules/growth.js',
  'js/modules/momweight.js', /* 第 297 次 */
  'js/modules/prenatal.js', /* 第 298 次 */
  'js/modules/vaccine.js',
  'js/modules/milestone.js',
  'js/modules/sick.js',
  'js/modules/packing.js',
  'js/modules/finance.js',
  'js/modules/period.js',
  'js/modules/pregnancy.js',
  'js/modules/supplies.js',
  'js/modules/mood.js',
  'js/modules/alltools.js',
  'js/pull-search.js',
  'js/touchfx.js',
  'js/modules/search.js'
];
/* 第 336 次：图标 v4 —— 30 个 × 浅 / 深（-d 提亮版）× 2x（96px）/ 3x（144px）= 120 张透明 webp，约 375KB。
   页面用 CSS -webkit-image-set 按屏幕倍率挑一张，两种倍率都预缓存，离线、换机型都不缺图。
   带底块整颗版（assets/icons/v4/tile/）页面不引用，不预缓存。名单与 js/icons.js 的 V4 表、styles.css「图标 v4」段一致。 */
var ICONS_V4 = ['baby', 'breast', 'bottle', 'pump', 'solid', 'diaper', 'sleep', 'growth', 'vaccine', 'meds', 'temp', 'sick',
  'jaundice', 'bath', 'swim', 'sun', 'water', 'fetal', 'prenatal', 'packing', 'mom', 'mood', 'period', 'contraction',
  'home', 'calendar', 'noise', 'search', 'settings', 'family',
  /* 第 337 次：扁平补图 23 个 */
  'pee', 'poop', 'milestone', 'supplement', 'pregnancy', 'momweight', 'finance', 'supplies', 'edit', 'alltools', 'cards', 'quick',
  'appearance', 'weather', 'reminder', 'haptic', 'transfer', 'tofamily', 'privacy', 'sources', 'checkup', 'birthday', 'routine'];
ICONS_V4.forEach(function (n) {
  ['', '-d'].forEach(function (v) { ['2x', '3x'].forEach(function (r) { ASSETS.push('assets/icons/v4/' + n + v + '@' + r + '.webp'); }); });
});
/* 第 337 次：dock 选中态 96px（GL 透镜图标层；DOM 用 dock-icons.js 内联的 72px，不走网络）+ 兜底 2x / 3x；
   3D 黏土物件 30 张（用品清单 / 用品选择器 / 营养品剂型，360px）；咿呀「加油」新表情 */
['home', 'cal', 'baby'].forEach(function (k) {
  ['', '-d'].forEach(function (v) { ['2x', '3x', '4x'].forEach(function (r) { ASSETS.push('assets/dock/' + k + '-on' + v + '@' + r + '.webp'); }); });
});
var SUPPLIES_3D = ['capsule', 'tablet', 'gummy', 'drops', 'powder', 'liquid', 'formula', 'pacifier', 'brush', 'milkbag', 'nursingpad', 'bib', 'spoon',
  'puree', 'biscuit', 'wipes', 'cottontowel', 'changingpad', 'diapercream', 'tissue', 'swab', 'babywash', 'lotion', 'towel', 'swaddle', 'detergent',
  'nailclipper', 'toothpaste', 'sunscreen', 'repellent'];
SUPPLIES_3D.forEach(function (n) { ASSETS.push('assets/supplies/' + n + '.webp'); });
ASSETS.push('assets/yiya/cheer.webp');

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
  /* 第 270 次（真机录屏：每次进喂养 / 尿布 / 白噪音，页头插画、面板里的尿布图、声音画卡都要晚 0.3–0.6 秒才出来，
     而且第二次、第三次进同一页照样晚）：network-first 让每张图都先跑一趟服务器校验（304 也要一个往返），
     图片得等网络回来才交给页面。assets/ 下的图片已全部预缓存、换图时 CACHE 版本号一定会跟着升，
     所以图片改为缓存优先：命中缓存立即返回，同时在后台照旧取一次新的写回缓存；没命中才走下面的网络优先。 */
  if (/\/assets\/.+\.(?:webp|png|jpe?g|svg)$/i.test(new URL(req.url).pathname)) {
    var key = req.url.split('?')[0];
    var refresh = function () {
      REVALIDATED[key] = 1; /* 每张图在这个 SW 生命周期里只后台校验一次，不在每次重绘都打网络 */
      return fetch(new Request(req, { cache: 'no-cache' })).then(function (res) {
        if (res && res.ok) { var cp = res.clone(); caches.open(CACHE).then(function (cache) { cache.put(req, cp); }); }
        return res;
      });
    };
    e.respondWith(caches.match(req, { ignoreSearch: true }).then(function (hit) {
      if (!hit) return refresh();
      if (!REVALIDATED[key]) e.waitUntil(refresh().catch(function () {}));
      return hit;
    }));
    return;
  }
  /* 第 275 次（真机：主屏幕 App 启动长时间白屏）：页面本身与 js / css / manifest 也改为缓存优先。
     原来每次启动都要把 index.html、styles.css 和 58 个脚本逐个去服务器校验（304 也要一个往返），
     弱网下每个请求最多等 3 秒超时才回落缓存——实测慢 4G 热启动首页要 4 秒、超过 5 秒兜底后
     启动层被拿掉，露出没画完的空白页。这些文件全部在 ASSETS 里预缓存，且改任何一个都必须升 CACHE，
     新版本由 SW 自身更新（每次打开 / 回到前台的 reg.update）→ 新 SW 预缓存全部最新文件 → 接管后 app.js 自动重载，
     所以命中缓存直接返回是安全的；没命中（新增文件、ASSETS 漏登记）才走下面的网络优先。 */
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(function (hit) {
    return hit || netFirst(e, req);
  }));
});

function netFirst(e, req) {
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
  var p = new Promise(function (resolve, reject) {
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
  });
  /* 超时后先返回了缓存，网络请求仍在跑；waitUntil 保证 SW 不在它写完缓存前被回收 */
  e.waitUntil(network.catch(function () {}));
  return p;
}


/* ============ 第 332 次：家庭共享推送 / 第 335 次：系统通知级提醒 ============
   负载两类：
     本机提醒（中转到点推送）：{ t:'rem', r: 提醒设备 ID, id: 提醒 ID, ct, at }  → FamRemind.text()（本机提醒密钥解密）
     家庭（家人叫你 / 家人记了一条）：{ t:'come'|'rec', f, from, ct, at }        → FamPush.text()（家庭推送子密钥解密）
   文字只由这两个出口生成（白名单 + 纯文本清洗），解不开 → 通用文案（「咿呀记有一条提醒」/「咿呀：家里有新消息」）。
   App 在前台（有可见窗口）：把文字转给页面弹顶部咿呀岛，不留系统通知。WebKit（iPhone / Mac Safari）规定每个 push 都必须 showNotification，
   否则三次就吊销订阅，所以在 WebKit 上照样弹出、随即收起；Chromium 有可见窗口时允许不弹。 */
var SW_WEBKIT = (function () { try { var ua = self.navigator.userAgent || ''; return /AppleWebKit/.test(ua) && !/Chrome|Chromium|CriOS|Edg|Android/.test(ua); } catch (e) { return true; } })();
var GO_OK = /^[a-z]{2,16}$/, BID_OK = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function swText(data) {
  var DB = self.FamDB;
  if (data && data.t === 'rem') {
    var GR = { title: '咿呀记', body: '咿呀记有一条提醒', ok: false, go: 'home', tag: 'yiya-rem' };
    if (!self.FamRemind || !DB) return Promise.resolve(GR);
    return Promise.all([DB.get('rcred'), DB.get('nprefs')]).then(function (r) { return self.FamRemind.text(data, r[0], r[1]); }).catch(function () { return GR; });
  }
  var GF = { title: '咿呀', body: '家里有新消息', ok: false, go: 'home', tag: 'yiya-family' };
  if (!self.FamPush || !DB) return Promise.resolve(GF);
  return Promise.all([DB.get('cred'), DB.get('names'), DB.get('nprefs')]).then(function (r) { return self.FamPush.text(data, r[0], r[1], r[2]); }).catch(function () { return GF; });
}
function swDeliver(m) {
  var go = GO_OK.test(m.go || '') ? m.go : 'home', bid = BID_OK.test(m.bid || '') ? m.bid : null;
  var opts = { body: m.body, icon: 'assets/icon-192.png', badge: 'assets/icon-192.png', tag: m.tag || 'yiya', renotify: true, data: { go: go, bid: bid } };
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    var vis = list.filter(function (c) { return c.visibilityState === 'visible'; });
    if (!vis.length) return self.registration.showNotification(m.title, opts);
    vis.forEach(function (c) { try { c.postMessage({ type: 'yiya-notify', title: m.title, body: m.body, go: go, bid: bid }); } catch (e) {} });
    if (!SW_WEBKIT) return null;
    return self.registration.showNotification(m.title, opts).then(function () {
      return self.registration.getNotifications({ tag: opts.tag });
    }).then(function (ns) { (ns || []).forEach(function (n) { n.close(); }); });
  });
}
self.addEventListener('push', function (e) {
  var data = null;
  try { data = e.data ? e.data.json() : null; } catch (eJ) { data = null; }
  e.waitUntil(swText(data).then(swDeliver).catch(function () {
    return self.registration.showNotification('咿呀记', { body: '咿呀记有一条提醒', icon: 'assets/icon-192.png', tag: 'yiya', data: { go: 'home' } });
  }));
});
/* 点通知：已有窗口 → 聚焦并让页面跳到对应页；没有窗口 → openWindow('./?go=…')（app.js 启动时读 ?go=，notify.js 读 &bid= 切宝宝） */
function swClick(d) {
  d = d || {};
  var go = GO_OK.test(d.go || '') ? d.go : 'home', bid = BID_OK.test(d.bid || '') ? d.bid : null;
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if ('focus' in c) {
        try { c.postMessage({ type: 'yiya-go', go: go, bid: bid }); } catch (e2) {}
        return c.focus().catch(function () { return c; });
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow('./?go=' + go + (bid ? '&bid=' + bid : ''));
  });
}
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  e.waitUntil(swClick(e.notification.data));
});
/* 推送服务换了订阅（少见；iOS 基本不发）：用原来的服务器公钥重新订阅，并用本机提醒凭据上报给中转。
   家庭那边的订阅等 App 下次打开时由 Notify / FamSync 按用户的开关重新上报（SW 读不到「家人叫你」开关在不在开着）。 */
self.addEventListener('pushsubscriptionchange', function (e) {
  var DB = self.FamDB;
  if (!DB) return;
  var opt = (e.oldSubscription && e.oldSubscription.options) || null;
  e.waitUntil((e.newSubscription ? Promise.resolve(e.newSubscription)
    : (opt && opt.applicationServerKey ? self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: opt.applicationServerKey }) : Promise.resolve(null)))
    .then(function (sub) {
      if (!sub) return;
      var js = JSON.stringify({ subscription: sub.toJSON() });
      return DB.get('rcred').then(function (rc) {
        if (!rc || !rc.server || !/^r_[A-Za-z0-9_-]{16}$/.test(rc.deviceId || '')) return;
        return fetch(rc.server + '/v1/rdev/me/push', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + rc.deviceId + ':' + rc.token }, body: js }).catch(function () {});
      });
    }).catch(function () {}));
});
