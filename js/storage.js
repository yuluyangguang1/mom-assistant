/**
 * storage.js - 本地数据持久化层（localStorage）
 * 全量数据存于单一 key，结构为 JSON。无云端、无账号。
 *
 * v2 数据韧性加固（2026-09-20）：
 * 1. 损坏自愈：load() 解析失败时，先把损坏原文备份到 _corrupt_backup key 再回退默认值，
 *    用户可通过导出调试找回，绝不静默丢数据。
 * 2. 保存告警：save() 配额满/异常时返回 false 并弹 toast 提醒（此前静默失败）。
 * 3. 导入清洗：importJSON 逐字段校验类型（数组/对象/形状），非法字段回退默认，
 *    非法记录整条过滤，杜绝「导入一个坏文件把应用搞坏」。
 * 4. 版本迁移脚手架：DATA_VERSION 驱动 migrate()，按版本号逐步升级旧数据。
 * 5. settings.lastExportISO：记录上次导出时间，供「备份提醒」使用。
 * 6. 第 74 次（G1/G2/G3 数据安全三件套）：
 *    G1 损坏自愈告知——corruptNoticeShown 设置键驱动启动 toast（只弹一次），
 *      corruptBackupInfo() 供设置页常驻状态行展示备份存在；
 *    G2 双标签覆盖防护——storage 事件节流告警（60s 一次），不自动同步；
 *    G3 计时字段校验——计时类记录 start 不可解析整条过滤、end 无效置 null，
 *      openSleep/openContraction start 不可解析视为无进行中。
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'momhelper_data_v1';
  var CORRUPT_BACKUP_KEY = 'momhelper_data_v1_corrupt_backup';
  var SNAPSHOT_PREFIX = 'momhelper_snapshot_v';
  var DATA_VERSION = 4;

  /* 容量预警阈值（U-34）：多数浏览器 localStorage 上限约 5MB（UTF-16 计 5M 字符 ≈ 10MB 字节）。
     报告未给具体上限，故此处为设计判断：按 5MB 字符量估算，≥80% 视为「近上限」，
     只作为提醒，不阻断任何操作。 */
  var QUOTA_CHARS = 5 * 1024 * 1024;
  var NEAR_LIMIT_PCT = 80;

  /* 数组型字段（记录列表）。第 66 次：moods（妈妈情绪随记，F 线）
     第 80 次：babies（宝宝档案，多宝宝家庭切换） */
  var ARRAY_KEYS = ['periods', 'feedings', 'sleeps', 'contractions', 'growth', 'diapers', 'meds', 'milestones', 'milestoneObs', 'fetal', 'temps', 'moods', 'babies', 'supplies',
    /* 第 132 次（对标 Cali 21 工具补缺）：洗澡 / 游泳 / 日晒 / 饮水 / 黄疸 / 补剂。
       六者均为纯追加的记录列表，默认空数组即旧行为，DATA_VERSION 不动。 */
    'baths', 'swims', 'suns', 'waters', 'jaundices', 'supplements', 'supplementPlans',
    /* 第 186 次：胎动计数会话 { id, start, end, count } */
    'fetalSessions',
    /* 第 197 次：临产征兆事件 { id, time, type: 'water'|'show', note } —— 破水 / 见红，宫缩页一键记 */
    'laborEvents',
    /* 第 201 次：储奶 { id, amount(ml), time(吸出时间), place: 'fridge'|'freezer', usedAt|null }，妈妈的奶不分宝宝，放全局 */
    'milkStash',
    /* 第 301 次：生病记录 { id, start, end|null, symptoms[], causes[], meds[], visit|null, place|null, cost|null, note|null, photos? }，只做记录 */
    'sicks'];
  /* 对象型字段（嵌套容器） */
  /* 第 136 次（缺陷修复）：feedingTimer 是「亲喂计时进行中」的持久状态，
     feeding.js 注释写着「跨刷新保留」，但它既不在 defaultData 也不在 OBJECT_KEYS，
     sanitize() 只拷白名单键 → 刷新一次就被丢掉，计时凭空消失。
     补进两处（默认 null + 白名单）才真正兑现那句注释。 */
  var OBJECT_KEYS = ['pregnancy', 'prenatal', 'packing', 'finance', 'vaccines', 'checkups', 'metrics', 'feedingTimer', 'bottleTimer', 'pumpTimer',
    /* 第 138 次：照料类会话式记录——洗澡/游泳/日晒共用同一个「进行中」槽位。
       之所以合成一个键而不是三个：宝宝不可能同时在洗澡和晒太阳，一个槽位足够，
       也避免三个键要有三套开始/结束/取消逻辑（care.js 单一来源）。 */
    'openCare'];

  /* 第 146 次（多宝宝数据隔离，DATA_VERSION 3→4）：
     这些键属于「某一个宝宝」，其余（经期/孕期/宫缩/胎动/情绪/记账/待产包/囤货/白噪音/埋点）属于妈妈或全家。
     存储形态：当前宝宝的数据仍放在顶层（所有模块零改动照常读写），
     其他宝宝的数据收在各自档案的 rec 里；switchBaby 时整组换入换出。 */
  var BABY_KEYS = ['feedings', 'sleeps', 'openSleep', 'feedingTimer', 'bottleTimer', 'pumpTimer', 'openCare', 'growth', 'diapers', 'meds',
    'milestones', 'milestoneObs', 'temps', 'baths', 'swims', 'suns', 'waters', 'jaundices',
    'supplements', 'supplementPlans', 'vaccines', 'checkups', 'sicks'];

  /* 第 333 次：我的快记的种类。值 = 支持的方式（t 点一下就记 / s 弹出一步），第一个是默认方式 */
  var QUICK_KINDS = { feed: 'ts', breast: 'st', bottle: 'ts', pump: 'st', pee: 'ts', poop: 'ts', diaper: 's', sleep: 'ts', meds: 'ts', temp: 's', mood: 's', fetal: 't' };
  var QUICK_MAX = 8;
  function quickItem(k, m) { var md = QUICK_KINDS[k]; return { k: k, m: m || (md.charAt(0) === 't' ? 'tap' : 'step') }; }
  /** 默认快记：按喂养方式（feedMode：亲喂 / 瓶喂 / 没选）给第一项，孕期（还没有宝宝）给胎动 + 心情；二胎孕期在宝宝那套前面加胎动 */
  function quickDefaults(feedMode, stage) {
    if (stage === 'pregnancy') return [quickItem('fetal'), quickItem('mood')];
    var first = feedMode === 'breast' ? quickItem('breast', 'step') : feedMode === 'bottle' ? quickItem('bottle', 'tap') : quickItem('feed', 'tap');
    var out = [first, quickItem('pee'), quickItem('poop'), quickItem('sleep'), quickItem('meds')];
    if (stage === 'dual') out.unshift(quickItem('fetal'));
    return out;
  }
  /* 第 333 次：旧快记配置 → quickItems（一次性、可重入：迁完布局里就没有旧 id 了，再跑一遍什么都不改）。
     · 首页的三种快记卡（快捷记录 · 大 / 横条 / 小卡）收成一张「快记」卡：留第一张的位置，小卡记成半宽；
     · 五张「直接记录」卡（记尿布 / 睡眠计时 / 瓶喂 / 亲喂 / 吸奶）收进快记清单（原来是带步进的卡 → 弹出一步），
       它们在首页的位置由快记卡接替（首页上已经有快记卡就只并清单）；
     · removed 里的旧 id 一并清掉。 */
  var QUICK_LEGACY = { 'rec-diaper': ['diaper', 'step'], 'rec-sleep': ['sleep', 'tap'], 'rec-bottle': ['bottle', 'step'], 'rec-breast': ['breast', 'step'], 'rec-pump': ['pump', 'step'] };
  function migrateQuick(st, raw) {
    var hl = st.homeLayout;
    if (!hl || !Array.isArray(hl.items)) return false;
    var isQ = function (id) { return id === 'quick' || id === 'quick-h' || id === 'quick-s'; };
    var legacy = hl.items.some(function (it) { return it.id === 'quick-h' || it.id === 'quick-s' || QUICK_LEGACY[it.id]; })
      || (hl.removed || []).some(function (id) { return id === 'quick-h' || id === 'quick-s' || QUICK_LEGACY[id]; });
    if (!legacy) return false;
    var items = [], add = [], hasQ = false;
    hl.items.forEach(function (it) {
      if (isQ(it.id)) {
        if (!hasQ) { hasQ = true; items.push({ id: 'quick', size: it.id === 'quick-s' ? 's' : it.id === 'quick-h' ? 'l' : it.size }); }
        return;
      }
      if (QUICK_LEGACY[it.id]) {
        add.push(QUICK_LEGACY[it.id]);
        if (!hasQ) { hasQ = true; items.push({ id: 'quick', size: 'l' }); }
        return;
      }
      items.push(it);
    });
    var removed = (hl.removed || []).filter(function (id) { return !(id === 'quick-h' || id === 'quick-s' || QUICK_LEGACY[id] || (hasQ && id === 'quick')); });
    st.homeLayout = (items.length || removed.length) ? { v: 1, items: items, removed: removed } : null;
    if (add.length) {
      var list = Array.isArray(st.quickItems) ? st.quickItems.slice()
        : quickDefaults(raw && (raw.feedMode === 'breast' || raw.feedMode === 'bottle') ? raw.feedMode : null, 'baby');
      add.forEach(function (a) {
        if (list.some(function (x) { return x.k === a[0]; })) return;
        if (list.length < QUICK_MAX) list.push(quickItem(a[0], a[1]));
      });
      st.quickItems = list;
    }
    return true;
  }

  /* 导入兜底：记录里的单个字符串字段最长 500 字（界面输入框上限 40 字），
     防止手改/恶意文件用一条超长备注吃掉存储配额。 */
  var MAX_FIELD_CHARS = 500;
  function capRecordStrings(r) {
    Object.keys(r).forEach(function (k) {
      if (typeof r[k] === 'string' && r[k].length > MAX_FIELD_CHARS) r[k] = r[k].slice(0, MAX_FIELD_CHARS);
      else if (Array.isArray(r[k])) {
        r[k] = r[k].map(function (x) { return (typeof x === 'string' && x.length > MAX_FIELD_CHARS) ? x.slice(0, MAX_FIELD_CHARS) : x; });
      }
    });
    return r;
  }

  /* 第 150 次（安全）：导入记录的 id 统一收口。
     约 39 处模块代码把记录 id 拼进 HTML 属性（data-id="…"、onclick 参数等），
     而导入只限了长度，没限字符集：备份里写 id: '" onmouseover="…' 就能闭合属性注入。
     与其逐处转义（漏一处就破），不如在唯一入口 sanitize 把形状管死：
     - 任何层级里名为 id 或以 Id 结尾（planId / babyId / activeBabyId…）的字符串，
       必须匹配 SAFE_ID_RE；不匹配就**确定性**改写成 'x' + 哈希——同一个坏值永远映射到同一个新值，
       所以 planId ↔ 补充剂计划 id、activeBabyId ↔ babies[].id 这类引用关系不会断。
     - 对象的键名若含 < > " ' ` & \ 这类 HTML 敏感字符，整项丢弃（正常数据的键都是 ASCII 标识符）。
     照片字段（validPhoto 已严格校验）与超长字符串不在此处理。 */
  var SAFE_ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
  var UNSAFE_KEY_RE = /[<>"'`&\\]/;
  function safeId(v) {
    if (typeof v !== 'string') return v;
    if (SAFE_ID_RE.test(v)) return v;
    var h1 = 5381, h2 = 52711;
    for (var i = 0; i < v.length; i++) {
      var c = v.charCodeAt(i);
      h1 = ((h1 << 5) + h1 + c) | 0;
      h2 = ((h2 << 5) + h2 ^ c) | 0;
    }
    return 'x' + (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
  }
  /* 第 151 次（XSS 模糊测试发现）：数值字段在模块里按「数字」直接拼进 HTML（' 分钟'、' ml/g'、' kg'），
     导入的字符串值会原样渲染。在入口统一转成数字：能解析就转，不能就置 null。 */
  var NUM_KEYS = { amount: 1, amountBm: 1, amountFm: 1, minutes: 1, durationMin: 1, durationL: 1, durationR: 1, secL: 1, secR: 1,
    value: 1, kg: 1, weightKg: 1, heightCm: 1, headCm: 1, ml: 1, qty: 1, price: 1, perDay: 1, wakings: 1,
    longestMin: 1, pausedMs: 1, touches: 1, steps: 1, week: 1, birthGestWeeks: 1, count: 1, temp: 1 };
  function toNum(v) {
    if (typeof v !== 'string') return v;
    var t = v.trim(); if (t === '') return null;
    var n = Number(t);
    return isFinite(n) ? n : null;
  }
  function isIdKey(k) { return k === 'id' || /Id$/.test(k); }
  function scrubIds(node, depth) {
    if (!node || typeof node !== 'object' || depth > 8) return node;
    if (Array.isArray(node)) {
      for (var i = 0; i < node.length; i++) node[i] = scrubIds(node[i], depth + 1);
      return node;
    }
    Object.keys(node).forEach(function (k) {
      if (UNSAFE_KEY_RE.test(k)) { delete node[k]; return; }
      var v = node[k];
      if (isIdKey(k) && typeof v === 'string') node[k] = safeId(v);
      else if (NUM_KEYS[k] === 1 && typeof v === 'string') node[k] = toNum(v);
      else if (/Ids$/.test(k) && Array.isArray(v)) node[k] = v.map(function (x) { return typeof x === 'string' ? safeId(x) : x; });
      else if (v && typeof v === 'object') scrubIds(v, depth + 1);
    });
    return node;
  }

  /* 第 127 次（安全）：宝宝照片必须是**严格的 base64 dataURL**。
     原先只查 'data:image/' 前缀 —— 前缀校验挡不住「属性闭合逃逸」：
     payload 形如 `data:image/png" onerror="…` 同样通过前缀检查，再被裸拼进
     innerHTML（app.js:493/510、settings.js:535、home.js:645 四处）即成为可执行注入。
     已用真实浏览器 CDP 实证（顶栏头像启动即渲染，导入恶意备份刷新即执行）。
     这里同时收紧 MIME 白名单与负载字符集，从源头杜绝引号/尖括号进入 photo。 */
  var PHOTO_RE = /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;
  function validPhoto(v) {
    return typeof v === 'string' && v.length <= 300000 && PHOTO_RE.test(v);
  }

  /* 第 212 次：农历生日 {y,m,d,leap} 形状校验 */
  function cleanLunar(v) {
    if (!v || typeof v !== 'object') return null;
    var y = v.y, m = v.m, d = v.d;
    if (typeof y !== 'number' || y < 1900 || y > 2100 || typeof m !== 'number' || m < 1 || m > 12
      || typeof d !== 'number' || d < 1 || d > 30) return null;
    return { y: Math.round(y), m: Math.round(m), d: Math.round(d), leap: v.leap === true };
  }
  var PROFILE_KEYS = ['nickname', 'sex', 'preterm', 'birthGestWeeks', 'birthLunar'];

  function defaultData() {
    return {
      version: DATA_VERSION,
      settings: {
        theme: 'light', privacyAccepted: false, baby: null, realRefraction: true,
        lastExportISO: null, backupSnoozeISO: null, exportNoticeShown: false, capSnoozeISO: null,
        /* 第 120 次（首页布局编辑）：null = 自动策展（阶段筛选 + 收敛，改动前行为）；
           用户在编辑模式改过之后才落 { v:1, items:[{id,size}], removed:[id] }。 */
        homeLayout: null,
        quickItems: null, /* 第 333 次：我的快记（null = 按喂养方式默认） */
        /* 第 212 次：首页天气（联网，默认关）与农历日期（默认开） */
        weather: { on: false, mode: 'auto', city: null },
        lunarDate: true,
        /* U-09：夜间（22:00–06:00）自动进入暗色；用户手动切主题会置为 false */
        themeAuto: true,
        /* 首次引导与身份（O 系列）：只存身份与称呼，不采集姓名/手机号/邮箱 */
        onboardingDone: false, caregiver: null,
        /* U-04：页面内提醒卡开关（默认开启，可完全关闭且不损失任何功能——关掉后所有记录与导出照旧）；
           周回顾属「回报兑现」型提醒，须用户主动开启，默认关闭。 */
        remindersEnabled: true, weeklyReviewEnabled: false, lastReviewISO: null,
        /* 第 45 次：保存触感反馈（默认开启）。只在安卓浏览器有效：
           Safari 全版本（含 iOS）未实现 Vibration API，开启也不会有震动。 */
        hapticEnabled: true,
        /* 第 97 次：底栏右侧自定义快捷槽位（模块 id 或 null=不显示）。
           设置页「底栏快捷入口」里选；渲染时校验模块存在，无效值静默忽略。
           仅「正常排列」下生效（第 100 次起左手/右手模式底栏是固定五口竖排）。 */
        dockSlot: null,
        /* 第 286 次：日期页底部快捷记录条。null = 默认（亲喂/瓶喂/辅食/生长/尿布）；'auto' = 按近 30 天使用次数挑 5 个；
           数组 = 自选（模块 id，最多 5 个；渲染时只认白名单） */
        calQuick: null,
        /* 第 320 次：handMode（第 100 次左右手竖排 → 第 304 次简洁模式）整项移除；旧值在 load 里静默清掉 */
        /* 第 103 次（OP-GAP-03）：全局字号倍率。三档 normal / lg / xl，
           由 App.applyFontScale() 落到 body 类上，CSS 覆盖 --fs-* 五个变量。
           起因是第七版审计的缺口——CSS 变量早已齐备（styles.css:57-61），
           但没有设置项，小宝记评论说「能不能调整页面字体大小……可以和家里长辈一起看」。
           取值只认这三档：非法值一律回落 normal，与 handMode / themeMode 同一套防错语义。
           它只是把既有字号放大，不改任何布局逻辑、不改数据，纯显示偏好。 */
        fontScale: 'normal',
        /* 第 66 次（F 线）：情绪中性提示「不再提示」标记。一次性、可永久关闭，
           关掉不损失任何功能（紧急指引卡常驻页尾）。 */
        moodHintDismissed: false,
        /* 第 74 次（G1）：损坏自愈告知只弹一次的标记。设置页状态行兜底常驻，
           关掉 toast 不等于关掉知情权。 */
        corruptNoticeShown: false,
        /* 第 75 次（E 线）：复潮预警「不再提示」标记 + 异常信号已读标记（key）。
           每条提示一次性，关掉不损失任何功能。 */
        periodRelactDismissed: false, periodE4Seen: null,
        /* 第 80 次（宝宝档案）：多宝宝支持——activeBabyId 指向 babies 中的当前宝宝；
           babiesSeeded 是 v2→v3 一次性迁移标记（从旧 settings.baby 播种第一个档案）。 */
        activeBabyId: null, babiesSeeded: false,
        /* 第 131 次（P1-a · 对标 Cali DailyCareRecapBuilder 的 dayStart）：
           照护日起始小时（0–12），0 = 公历日 00:00 起（默认，改动前行为）。
           只影响「今日/昨夜」的记录计数与归属（首页磁贴、各页今日统计、
           维D/胎动的今日判定）；疫苗剂次、预产期等日历日语义不受影响。
           纯新增键、默认值即旧行为，故 DATA_VERSION 不动、无需迁移。 */
        dayStart: 0
      },
      /* 第 80 次（宝宝档案）：宝宝档案列表 { id, name, photo, birthDate }。
         photo 是本机压缩后的 dataURL（util.pickPhoto 统一压到 288px JPEG）。 */
      babies: [],
      periods: [],
      /* 第 192 次：dateBasis = 'due' | 'lmp' | null —— 用户按哪个日期填的（孕期页记住口径），null = 未选过 */
      pregnancy: { lmp: null, dueDate: null, dateBasis: null, weights: [] },
      prenatal: { checks: [], records: [], visits: [] },
      feedings: [],
      sleeps: [],
      openSleep: null,
      /* 亲喂计时进行中：{ start }，与 openSleep/openContraction 同类 */
      feedingTimer: null,
      /* 第 231 次：瓶喂进行中 { start, src: 'bm'|'fm', amount } */
      bottleTimer: null,
      /* 第 256 次：泵奶进行中 { start, since, L, R, accL, accR, accT, paused, mlL, mlR } */
      pumpTimer: null,
      /* 第 255 次：喂养页底部当前是亲喂还是瓶喂 'breast' | 'bottle' | null */
      feedMode: null,
      /* 第 138 次：照料会话进行中：{ kind: 'bath'|'swim'|'sun', start } */
      openCare: null,
      contractions: [],
      openContraction: null,
      ctSession: null, /* 第 296 次：沉浸式宫缩计时的一组 { id, start } */
      growth: [],
      diapers: [],
      meds: [],
      milestones: [],
      sicks: [], /* 第 301 次：生病记录 */
      /* 第 66 次（F 线）：妈妈情绪随记。{ id, time, level(1-5), note, tags[] }
         —— 第 71 次补默认值（当时只入了 ARRAY_KEYS，defaultData 漏了本键） */
      moods: [],
      /* 第 68 次（B2）：发育观察点自评标记。{ id('KN-O/W-月龄-序'), v(1=是/阳性,0=否), date } */
      milestoneObs: [],
      /* 胎动计数（对标 Cali 宝宝补齐的孕期刚需，2026-09-27）：{ id, time } */
      fetal: [],
      fetalSessions: [],
      laborEvents: [],
      milkStash: [],
      fetalSession: null,
      /* 第 107 次：消耗品与补货提醒。{ id, name, cat, date, price, availDays, qty, unit, history[] }
         起因是参考实现在真实使用中 54 行里出现 21 行重复（同「名称+购买日期」）。
         availDays 语义 = 这一行总共还剩多少天；剩余天数是渲染期派生量，不落库。
         history 每次新购追加一条，最多 10 条。写入前按「名称+购买日期」查重，
         命中改为累加 qty / availDays / history，绝不新增第二行。 */
      supplies: [],
      /* 体温（对标 Cali 补齐，第 38 次）：{ id, time, value, note } */
      temps: [],
      /* 第 132 次（对标 Cali 21 工具补缺）：
         baths  洗澡 { id, time, minutes, note }        —— Cali BathRecord(startedAt/endedAt/duration)
         swims  游泳 { id, time, minutes, note }        —— Cali SwimmingRecord
         suns   日晒 { id, time, minutes, area, note }  —— Cali SunExposureRecord + 部位
         waters 饮水 { id, time, ml, note }             —— Cali WaterRecord
         jaundices 黄疸 { id, time, value, unit, site, note } —— Cali JaundiceRecord(value/unit/zone)
         supplements      补剂打卡 { id, time, name, dose, note }
         supplementPlans  补剂计划 { id, name, form, perDay, active, sortOrder }
         一律「时间 + 数值 + 备注」的最小结构：只记录、不判读、不给达标线（沿用 U-25 口径）。 */
      baths: [],
      swims: [],
      suns: [],
      waters: [],
      jaundices: [],
      supplements: [],
      supplementPlans: [],
      packing: { seeded: false, items: [] },
      finance: { records: [] },
      vaccines: { done: {} },
      /* 第 70 次（B4）：儿保体检标记。done = { 'm6': '2026-05-12', ... }（节点 key → 实际体检日期） */
      checkups: { done: {} },
      /* U-05 记录成本埋点：只在本机记录「点击数 / 耗时」，不联网、不上报（验收用） */
      metrics: { records: [] },
      /* 哄睡白噪音（W 系列）：播放状态与上次设置都留在本机，音频不落地、不下载 */
      whitenoise: { playing: false, type: 'pink', volume: 3, minutes: 20, until: null, linkSleep: false },
      /* 第 332 次：同步墓碑（删除记录的痕迹，原数组里不留）与映射型条目（疫苗剂次等）的元数据 */
      tombs: [],
      mapMeta: {}
    };
  }

  /** 浅校验：数组字段必须是数组且每项是对象；对象字段必须是对象 */
  /* 第 140 次：把 Date 写成项目统一的本地时间戳 yyyy-mm-ddThh:mm:ss。
     只用于「导入归一化」——产出与 Util.nowLocal() 完全同形，
     下游所有 new Date(str) 都按本地时间解析，不会因 Z 丢失而偏移时区。 */
  function localStamp(d) {
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
      + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  function pickBaby(d) {
    var o = {};
    BABY_KEYS.forEach(function (k) { o[k] = d[k]; });
    return o;
  }

  /* 第 281 次（真机 bug 的善后）：第 280 次新向导点一次保存会存出两条一模一样的营养品计划。
     启动时合并：同名、同剂型、同频率（含星期 / 间隔）、同服用时间与用量、创建时刻相差 5 秒内，且没有服用记录（planId）的重复计划，
     只留一条；有记录的一条不动。只看 v2 计划（有 times 的；旧版计划没有这个 bug）。创建时刻取 createdAt，没有就取 id 前 8 位里的时间戳。
     删掉的那条若开着本机提醒（localStorage 独立键），并到留下的那条上。返回删掉的条数。 */
  var SUP_REMIND_KEY = 'yiya-sup-remind';
  function supBorn(p) {
    if (typeof p.createdAt === 'number' && isFinite(p.createdAt)) return p.createdAt;
    var m = /^([0-9a-z]{8})[0-9a-z]+$/.exec(String(p.id || ''));
    var t = m ? parseInt(m[1], 36) : NaN;
    return (t > 1.5e12 && t < 4.2e12) ? t : NaN;
  }
  function supSig(p) {
    if (!p || !p.name || !Array.isArray(p.times) || !p.times.length) return null;
    var times = p.times.filter(function (x) { return x && typeof x.t === 'string'; }).map(function (x) { return x.t + '*' + x.n; }).sort();
    if (!times.length) return null;
    var days = Array.isArray(p.days) ? p.days.slice().sort().join(',') : '';
    return [String(p.name).trim(), p.form || '', p.freq || 'daily', p.freq === 'weekly' ? days : '', p.freq === 'interval' ? String(p.every) : '', times.join('|'), p.active === false ? 0 : 1].join('\u0001');
  }
  function dedupeSupPlans(plans, recs, rmap) {
    if (!Array.isArray(plans) || plans.length < 2) return 0;
    var used = {};
    (Array.isArray(recs) ? recs : []).forEach(function (r) { if (r && r.planId) used[r.planId] = 1; });
    var groups = {}, drop = {};
    plans.forEach(function (p) { var k = supSig(p); if (k && isFinite(supBorn(p))) (groups[k] = groups[k] || []).push(p); });
    Object.keys(groups).forEach(function (k) {
      var g = groups[k].slice().sort(function (a, b) { return supBorn(a) - supBorn(b); });
      /* 按时间连成簇：相邻两条相差 ≤ 5 秒算同一次误存 */
      var cl = [], cur = [];
      g.forEach(function (p) { if (cur.length && supBorn(p) - supBorn(cur[0]) > 5000) { cl.push(cur); cur = []; } cur.push(p); });
      if (cur.length) cl.push(cur);
      cl.forEach(function (c) {
        if (c.length < 2) return;
        var withRec = c.filter(function (p) { return used[p.id]; });
        var keep = withRec.length ? withRec[0] : c[0];
        c.forEach(function (p) {
          if (p === keep || used[p.id]) return;
          drop[p.id] = 1;
          if (rmap && rmap[p.id] === 1 && rmap[keep.id] !== 0) rmap[keep.id] = 1;
          if (rmap) delete rmap[p.id];
        });
      });
    });
    var n = 0;
    for (var i = plans.length - 1; i >= 0; i--) if (plans[i] && drop[plans[i].id]) { plans.splice(i, 1); n++; }
    return n;
  }

  function sanitize(raw) {
    var base = defaultData();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
    /* 关键：保留磁盘上的版本号，交给 migrate() 决定怎么升。
       若这里直接写成 DATA_VERSION，migrate() 会误判「已是最新版」而永不执行，
       迁移脚手架（U-15）就变成了摆设。 */
    if (typeof raw.version === 'number' && raw.version > 0) base.version = raw.version;
    /* settings 浅合并，只保留已知键的合法类型 */
    if (raw.settings && typeof raw.settings === 'object' && !Array.isArray(raw.settings)) {
      var s = raw.settings;
      if (s.theme === 'dark' || s.theme === 'light') base.settings.theme = s.theme;
      if (typeof s.privacyAccepted === 'boolean') base.settings.privacyAccepted = s.privacyAccepted;
      /* 第 127 次（安全）：settings.baby 此前是「原样赋值、零字段校验」——而它的字段
         会落进 HTML 属性（growth.js:84 的 value="…birthGestWeeks…"）与打印报告，
         是照片之外的**第二条注入通道**（导入 crafted 备份即可触发）。
         这里对齐 babies 的做法逐字段清洗；保留原字段集（name/nickname/sex/
         sexUnknown/birthDate/preterm/birthGestWeeks），越界值置空但**不丢弃对象**，
         避免影响既有的「无档案时回落 settings.baby」兼容路径。 */
      if (s.baby && typeof s.baby === 'object' && !Array.isArray(s.baby)) {
        var sb = s.baby;
        if (typeof sb.name === 'string') sb.name = sb.name.slice(0, 24);
        if (typeof sb.nickname === 'string') sb.nickname = sb.nickname.slice(0, 24);
        if (typeof sb.birthDate === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(sb.birthDate)) sb.birthDate = null;
        sb.birthLunar = cleanLunar(sb.birthLunar);
        if (sb.sex !== 'girl' && sb.sex !== 'boy') sb.sex = null;
        sb.sexUnknown = sb.sexUnknown === true;
        sb.preterm = sb.preterm === true;
        sb.birthGestWeeks = (typeof sb.birthGestWeeks === 'number' && sb.birthGestWeeks >= 22 && sb.birthGestWeeks <= 43)
          ? Math.round(sb.birthGestWeeks) : null;
        base.settings.baby = sb;
      }
      if (typeof s.realRefraction === 'boolean') base.settings.realRefraction = s.realRefraction;
      if (s.dockGlass === 'off' || s.dockGlass === 'on' || s.dockGlass === 'auto') base.settings.dockGlass = s.dockGlass; /* 第 275 次 */
      if (typeof s.lunarDate === 'boolean') base.settings.lunarDate = s.lunarDate;
      if (s.weather && typeof s.weather === 'object' && !Array.isArray(s.weather)) {
        var wc = s.weather.city;
        base.settings.weather = {
          on: s.weather.on === true,
          dismissed: s.weather.dismissed === true,
          mode: s.weather.mode === 'city' ? 'city' : 'auto',
          city: (wc && typeof wc === 'object' && typeof wc.lat === 'number' && typeof wc.lon === 'number'
            && Math.abs(wc.lat) <= 90 && Math.abs(wc.lon) <= 180)
            ? { name: String(wc.name || '').slice(0, 24), lat: wc.lat, lon: wc.lon } : null
        };
      }
      if (typeof s.lastExportISO === 'string') base.settings.lastExportISO = s.lastExportISO;
      if (typeof s.backupSnoozeISO === 'string') base.settings.backupSnoozeISO = s.backupSnoozeISO;
      if (typeof s.exportNoticeShown === 'boolean') base.settings.exportNoticeShown = s.exportNoticeShown;
      if (typeof s.capSnoozeISO === 'string') base.settings.capSnoozeISO = s.capSnoozeISO;
      if (typeof s.themeAuto === 'boolean') base.settings.themeAuto = s.themeAuto;
      if (typeof s.onboardingDone === 'boolean') base.settings.onboardingDone = s.onboardingDone;
      /* 身份只允许三种枚举值 + 一个短称呼（12 字以内），不做自由文本画像 */
      if (s.caregiver && typeof s.caregiver === 'object' && !Array.isArray(s.caregiver)) {
        var cg = s.caregiver;
        base.settings.caregiver = {
          role: (cg.role === 'mom' || cg.role === 'dad' || cg.role === 'other') ? cg.role : null,
          name: (typeof cg.name === 'string') ? cg.name.slice(0, 12) : ''
        };
      }
      if (typeof s.remindersEnabled === 'boolean') base.settings.remindersEnabled = s.remindersEnabled;
      if (typeof s.weeklyReviewEnabled === 'boolean') base.settings.weeklyReviewEnabled = s.weeklyReviewEnabled;
      if (typeof s.lastReviewISO === 'string') base.settings.lastReviewISO = s.lastReviewISO;
      /* 第 45 次：保存触感开关（导入导出要能带走，否则换设备后设置丢失） */
      if (typeof s.hapticEnabled === 'boolean') base.settings.hapticEnabled = s.hapticEnabled;
      if (typeof s.nightWindow === 'boolean') base.settings.nightWindow = s.nightWindow; /* 第 330 次：夜里的窗 */
      if (typeof s.keepAwake === 'boolean') base.settings.keepAwake = s.keepAwake; /* 第 194 次：计时常亮 */
      /* 第 97 次：底栏快捷槽位（字符串或 null；渲染时校验模块存在，随导入导出带走） */
      if (typeof s.dockSlot === 'string' || s.dockSlot === null) base.settings.dockSlot = s.dockSlot;
      /* 第 286 次：日期页快捷条（'auto' 或最多 5 个 [a-z] 模块 id；其余回默认） */
      if (s.calQuick === 'auto') base.settings.calQuick = 'auto';
      else if (Array.isArray(s.calQuick)) base.settings.calQuick = s.calQuick.filter(function (x) { return typeof x === 'string' && /^[a-z]{2,16}$/.test(x); }).slice(0, 5);
      /* 第 320 次：handMode / leftHand（左右手 · 简洁模式）不再读——白名单里没有它，导入的旧备份同样静默回到默认排列 */
      /* 第 48 次：磁贴按阶段筛选开关（同样要随导入导出带走） */
      if (typeof s.tilesByStage === 'boolean') base.settings.tilesByStage = s.tilesByStage;
      /* 第 66 次：情绪中性提示关闭标记（随导入导出带走） */
      if (typeof s.moodHintDismissed === 'boolean') base.settings.moodHintDismissed = s.moodHintDismissed;
      /* 第 74 次（G1）：损坏自愈告知标记（同样随导入导出带走） */
      if (typeof s.corruptNoticeShown === 'boolean') base.settings.corruptNoticeShown = s.corruptNoticeShown;
      /* 第 75 次（E 线）：经期提示的两个关闭标记（随导入导出带走） */
      if (typeof s.periodRelactDismissed === 'boolean') base.settings.periodRelactDismissed = s.periodRelactDismissed;
      if (typeof s.periodE4Seen === 'string' || s.periodE4Seen === null) base.settings.periodE4Seen = s.periodE4Seen;
      /* 第 80 次（宝宝档案）：当前宝宝 id + 一次性迁移标记（随导入导出带走） */
      if (typeof s.activeBabyId === 'string' || s.activeBabyId === null) base.settings.activeBabyId = (typeof s.activeBabyId === 'string') ? safeId(s.activeBabyId.slice(0, 64)) : null;
      if (typeof s.babiesSeeded === 'boolean') base.settings.babiesSeeded = s.babiesSeeded;

      /* ───── 第 118 次（对标 Cali）：补齐白名单漏键 ─────────────────────────
         本函数是**手写的逐键白名单**：没写进这里的键，读回来就被整段丢掉。
         而下面五个键的写入方一直存在（app.js 的 setFontScale / setTheme / setStage、
         设置页的 homeConverge、本轮的 hcMode），却从来没进过白名单 ——
         后果不是"报错"，是**静默失效**：设置看起来保存成功（Storage.save 确实写了），
         下次启动 load→sanitize 一过就没了。用户视角是「我明明调过，重开又变回去」。

         值得一提：本函数里 handMode 的注释早就写着「该字段当时未入白名单，本就不落盘」
         —— 说明作者知道这个坑，只是逐个踩。这次一次性补齐，并加了往返断言
         （qa_test.js「设置白名单往返」）防止再漏。

         类型校验口径与各自消费方保持一致：
           themeMode  四值枚举（app.js themeMode() 只认这四个，非法回落 'time'）
           stage      'pregnancy' | 'baby' | null（null 合法 = 未选择，回落客观判定）
           fontScale  'normal' | 'lg' | 'xl'（app.js FONT_SCALES）
           homeConverge / hcMode  布尔（缺省语义由消费方给：首页收敛默认开、高对比默认关） */
      if (s.themeMode === 'time' || s.themeMode === 'system' || s.themeMode === 'light' || s.themeMode === 'dark') {
        base.settings.themeMode = s.themeMode;
      }
      if (s.stage === 'pregnancy' || s.stage === 'baby' || s.stage === null) base.settings.stage = s.stage;
      if (s.fontScale === 'normal' || s.fontScale === 'lg' || s.fontScale === 'xl') base.settings.fontScale = s.fontScale;
      if (typeof s.homeConverge === 'boolean') base.settings.homeConverge = s.homeConverge;
      if (typeof s.hcMode === 'boolean') base.settings.hcMode = s.hcMode;
      /* 第 131 次（P1-a）：dayStart 白名单——0–12 的整数小时（设置页只提供
         0/4/6 三档，这里放宽到整数小时，导入的手改备份也收）；
         非法值不进内存，消费方 Util.dayStartHour 回落 0 = 公历日。 */
      if (typeof s.dayStart === 'number' && s.dayStart >= 0 && s.dayStart <= 12
        && Math.floor(s.dayStart) === s.dayStart) {
        base.settings.dayStart = s.dayStart;
      }
      /* 第 120 次（首页布局编辑）：homeLayout 白名单——不只放行，还要形状校验。
         id 只认小写字母/数字短串（与模块 id 同域），size 只认 s/l，
         条目数设上限（items ≤ 24 / removed ≤ 40），坏数据宁可丢弃不进内存。
         items 与 removed 全空等价于没编辑过 → 回落 null（自动策展）。 */
      /* 第 226 次：换尿布「扣减用品」偏好——on 布尔，ids 最多 8 个安全 id */
      if (s.diaperStock && typeof s.diaperStock === 'object' && !Array.isArray(s.diaperStock)) {
        base.settings.diaperStock = {
          on: s.diaperStock.on !== false,
          ids: (Array.isArray(s.diaperStock.ids) ? s.diaperStock.ids : []).filter(function (x) { return typeof x === 'string'; })
            .slice(0, 8).map(function (x) { return safeId(x.slice(0, 64)); }).filter(Boolean)
        };
      }
      /* 第 294 次：用品清单（id 安全短串、名称 ≤10 字、最多 8 个）与用品提醒开关 */
      if (Array.isArray(s.supLists)) {
        var sl = [];
        s.supLists.slice(0, 8).forEach(function (x) {
          if (x && typeof x.id === 'string' && /^[a-z0-9]{1,16}$/.test(x.id) && typeof x.name === 'string' && x.name.trim()
            && !sl.some(function (y) { return y.id === x.id; })) sl.push({ id: x.id, name: x.name.trim().slice(0, 10) });
        });
        if (sl.length) base.settings.supLists = sl;
      }
      if (typeof s.supRemind === 'boolean') base.settings.supRemind = s.supRemind;
      if (s.homeLayout && typeof s.homeLayout === 'object' && !Array.isArray(s.homeLayout)) {
        var hlItems = [];
        (Array.isArray(s.homeLayout.items) ? s.homeLayout.items : []).slice(0, 48).forEach(function (it) {
          if (it && typeof it.id === 'string' && /^[a-z][a-z0-9-]{1,15}$/.test(it.id)
            && (it.size === 's' || it.size === 'l')
            && !hlItems.some(function (x) { return x.id === it.id; })) {
            hlItems.push({ id: it.id, size: it.size });
          }
        });
        var hlRemoved = [];
        (Array.isArray(s.homeLayout.removed) ? s.homeLayout.removed : []).slice(0, 48).forEach(function (id) {
          if (typeof id === 'string' && /^[a-z][a-z0-9-]{1,15}$/.test(id) && hlRemoved.indexOf(id) < 0) hlRemoved.push(id);
        });
        base.settings.homeLayout = (hlItems.length || hlRemoved.length)
          ? { v: 1, items: hlItems, removed: hlRemoved } : null;
      }
      /* 第 333 次：我的快记（首页快记卡和「＋」面板共用一份）。null = 按喂养方式给默认；
         数组 = 用户排好的清单，每项 { k: 种类, m: 'tap' 点一下就记 | 'step' 弹出一步 }，最多 8 个，种类不重复 */
      if (Array.isArray(s.quickItems)) {
        var qi = [];
        s.quickItems.forEach(function (it) {
          if (qi.length >= QUICK_MAX || !it || typeof it.k !== 'string' || !QUICK_KINDS[it.k]) return;
          if (qi.some(function (x) { return x.k === it.k; })) return;
          var modes = QUICK_KINDS[it.k];
          var m = (it.m === 'tap' || it.m === 'step') && modes.indexOf(it.m === 'tap' ? 't' : 's') >= 0 ? it.m : (modes.charAt(0) === 't' ? 'tap' : 'step');
          qi.push({ k: it.k, m: m });
        });
        base.settings.quickItems = qi;
      }
      migrateQuick(base.settings, raw);
    }
    ARRAY_KEYS.forEach(function (k) {
      if (Array.isArray(raw[k])) {
        base[k] = raw[k].filter(function (r) { return r && typeof r === 'object' && !Array.isArray(r); })
          .map(k === 'babies' ? function (r) { return r; } : capRecordStrings);
      }
    });
    OBJECT_KEYS.forEach(function (k) {
      if (raw[k] && typeof raw[k] === 'object' && !Array.isArray(raw[k])) base[k] = raw[k];
    });
    /* 第 192 次：孕期日期逐字段清洗——OBJECT_KEYS 是整对象浅拷贝，手改/导入的坏日期会让孕周算出 NaN。
       lmp/dueDate 只收 YYYY-MM-DD；dateBasis 只收 'due'|'lmp'；weights 必须是数组。 */
    (function () {
      var rp = (raw.pregnancy && typeof raw.pregnancy === 'object' && !Array.isArray(raw.pregnancy)) ? raw.pregnancy : {};
      var okD = function (v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(new Date(v + 'T00:00:00').getTime()) ? v : null; };
      var np = {};
      Object.keys(rp).forEach(function (k) { np[k] = rp[k]; });
      np.lmp = okD(rp.lmp); np.dueDate = okD(rp.dueDate);
      np.dateBasis = (rp.dateBasis === 'due' || rp.dateBasis === 'lmp') ? rp.dateBasis : null;
      np.weights = Array.isArray(rp.weights) ? rp.weights.filter(function (r) { return r && typeof r === 'object' && !Array.isArray(r); }).map(capRecordStrings) : [];
      base.pregnancy = np;
    })();
    /* metrics 逐字段清洗：只保留合法的埋点样本，坏样本整条丢弃（U-05） */
    if (base.metrics && Array.isArray(base.metrics.records)) {
      base.metrics.records = base.metrics.records.filter(function (r) {
        return r && typeof r === 'object' && typeof r.mod === 'string'
          && typeof r.clicks === 'number' && typeof r.ms === 'number';
      });
    } else {
      base.metrics = { records: [] };
    }
    /* 白噪音状态逐字段清洗：类型/音量/时长都给枚举与区间兜底，坏值回退默认 */
    if (raw.whitenoise && typeof raw.whitenoise === 'object' && !Array.isArray(raw.whitenoise)) {
      var wn = raw.whitenoise, vt = ['white', 'pink', 'brown', 'shush', 'ocean', 'heart', 'fan', 'rain', 'dryer'];
      base.whitenoise = {
        playing: wn.playing === true,
        type: vt.indexOf(wn.type) >= 0 ? wn.type : 'pink',
        volume: (typeof wn.volume === 'number' && wn.volume >= 1 && wn.volume <= 10) ? Math.round(wn.volume) : 3,
        minutes: (typeof wn.minutes === 'number' && wn.minutes >= 0 && wn.minutes <= 120) ? Math.round(wn.minutes) : 20,
        until: (typeof wn.until === 'number' && isFinite(wn.until)) ? wn.until : null,
        linkSleep: wn.linkSleep === true
      };
    }
    /* 第 74 次（G3）：计时字段校验——坏时间不静默入库。
       计时类记录（喂养/睡眠/宫缩）：start「存在但不可解析」→ 整条丢弃；
       start「缺失」→ 容忍保留（历史契约：早期数据与合成导入允许无起点记录，展示层兜底）。
       end 存在时必须可解析且晚于 start，否则置 null（保留记录视为未结束，不让负时长进统计）。
       手动补记入口早有前端校验，这里补的是「导入/历史数据」这另一条入库通道。 */
    ['feedings', 'sleeps', 'contractions'].forEach(function (k) {
      base[k] = base[k].filter(function (r) {
        if (r.start == null) return true;
        return !isNaN(new Date(r.start).getTime());
      });
      base[k].forEach(function (r) {
        if (r.end != null) {
          var tEnd = new Date(r.end).getTime(), tStart = new Date(r.start).getTime();
          if (isNaN(tEnd) || !(tEnd > tStart)) r.end = null;
        }
      });
    });
    /* 进行中状态（openSleep/openContraction）：start 不可解析则视为无进行中，避免计时器读到 NaN */
    if (raw.openSleep && typeof raw.openSleep === 'object'
      && !isNaN(new Date(raw.openSleep.start).getTime())) base.openSleep = raw.openSleep;
    /* 第 186 次：胎动计数会话进行中 */
    base.fetalSession = (raw.fetalSession && typeof raw.fetalSession === 'object'
      && !isNaN(new Date(raw.fetalSession.start).getTime()))
      ? { start: String(raw.fetalSession.start).slice(0, 19) } : null;
    if (raw.openContraction && typeof raw.openContraction === 'object'
      && !isNaN(new Date(raw.openContraction.start).getTime())) base.openContraction = raw.openContraction;
    base.ctSession = (raw.ctSession && typeof raw.ctSession === 'object' && raw.ctSession.id
      && !isNaN(new Date(raw.ctSession.start).getTime()))
      ? { id: String(raw.ctSession.id).slice(0, 40), start: String(raw.ctSession.start).slice(0, 19) } : null;
    /* 第 138 次：openCare 与 openSleep 同口径——kind 必须在白名单内、start 必须可解析。
       kind 是字符串而不是枚举数，落库前一律小写比对，防止导入脏值把标题渲染成乱码。 */
    if (raw.openCare && typeof raw.openCare === 'object'
      && ['bath', 'swim', 'sun'].indexOf(String(raw.openCare.kind)) >= 0
      && !isNaN(new Date(raw.openCare.start).getTime())) {
      /* 第 140 次修复：这里原来写的是 String(start).slice(0, 19)。
         若导入的数据是带 Z 的 UTC ISO（toISOString 的形态），slice 会把 Z 切掉，
         本地解析后整整偏一个时区（实测偏 8 小时，秒表读数变成 8:01:07）。
         正确做法是「按原值解析 → 再按本地格式重写」，既保留瞬时又统一格式。 */
      base.openCare = { kind: String(raw.openCare.kind), start: localStamp(new Date(raw.openCare.start)) };
    } else {
      base.openCare = null;
    }
    /* 第 136 次（缺陷修复）：feedingTimer 同口径——start 不可解析则视为无进行中。
       注意 OBJECT_KEYS 的浅拷贝会把整个对象连坏值一起搬过来，所以这里必须显式重判一次。 */
    if (raw.feedingTimer && typeof raw.feedingTimer === 'object'
      && !isNaN(new Date(raw.feedingTimer.start).getTime())) {
      /* 第 186 次修复：第 140 次加了分侧字段，这里却只留 start——刷新后换边累计全丢 */
      var rft = raw.feedingTimer;
      base.feedingTimer = { start: String(rft.start).slice(0, 19) };
      if (rft.side === 'left' || rft.side === 'right') base.feedingTimer.side = rft.side;
      if (rft.sideStart && !isNaN(new Date(rft.sideStart).getTime())) base.feedingTimer.sideStart = String(rft.sideStart).slice(0, 19);
      ['accL', 'accR'].forEach(function (k) {
        if (typeof rft[k] === 'number' && isFinite(rft[k]) && rft[k] >= 0 && rft[k] < 864e5) base.feedingTimer[k] = rft[k];
      });
      /* 第 231 次：全屏计时支持暂停 */
      if (rft.paused === true) base.feedingTimer.paused = true;
    } else {
      base.feedingTimer = null;
    }
    /* 第 231 次：瓶喂进行中，同口径重判 */
    var rbt = raw.bottleTimer;
    if (rbt && typeof rbt === 'object' && !isNaN(new Date(rbt.start).getTime())) {
      base.bottleTimer = { start: String(rbt.start).slice(0, 19), src: rbt.src === 'fm' ? 'fm' : 'bm' };
      var ba = Number(rbt.amount);
      base.bottleTimer.amount = (isFinite(ba) && ba > 0 && ba <= 400) ? Math.round(ba) : null;
    } else {
      base.bottleTimer = null;
    }
    /* 第 256 次：泵奶进行中，逐字段重判 */
    var rpt = raw.pumpTimer;
    if (rpt && typeof rpt === 'object' && !isNaN(new Date(rpt.start).getTime())) {
      var okT = function (v) { return v && !isNaN(new Date(v).getTime()) ? String(v).slice(0, 19) : null; };
      base.pumpTimer = { start: String(rpt.start).slice(0, 19), since: okT(rpt.since) || String(rpt.start).slice(0, 19), L: rpt.L === true, R: rpt.R === true };
      ['accL', 'accR', 'accT'].forEach(function (k) {
        base.pumpTimer[k] = (typeof rpt[k] === 'number' && isFinite(rpt[k]) && rpt[k] >= 0 && rpt[k] < 864e5) ? rpt[k] : 0;
      });
      ['mlL', 'mlR'].forEach(function (k) {
        var v = Number(rpt[k]); base.pumpTimer[k] = (isFinite(v) && v > 0 && v <= 600) ? Math.round(v) : null;
      });
      if (rpt.paused === true) base.pumpTimer.paused = true;
    } else {
      base.pumpTimer = null;
    }
    base.feedMode = (raw.feedMode === 'breast' || raw.feedMode === 'bottle') ? raw.feedMode : null;
    /* 第 80 次（宝宝档案）逐条清洗：id/name/photo/birthDate 形状合法才保留。
       photo 是 dataURL（pickPhoto 已在本机压到 288px），上限 30 万字符兜底防超配额；
       birthDate 只收 YYYY-MM-DD 形状。 */
    base.babies = (Array.isArray(raw.babies) ? raw.babies : []).filter(function (b) {
      return b && typeof b === 'object' && !Array.isArray(b) && typeof b.id === 'string' && b.id;
    }).map(function (b) {
      return {
        id: safeId(b.id.slice(0, 64)),
        name: (typeof b.name === 'string' && b.name.trim()) ? b.name.trim().slice(0, 12) : '宝宝',
        photo: validPhoto(b.photo) ? b.photo : null,
        birthDate: (typeof b.birthDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.birthDate)) ? b.birthDate : null,
        /* 第 212 次：小名 / 性别 / 早产 / 农历生日跟着档案走（之前只在 settings.baby，切换宝宝会串） */
        nickname: (typeof b.nickname === 'string') ? b.nickname.trim().slice(0, 12) : '',
        sex: (b.sex === 'girl' || b.sex === 'boy') ? b.sex : null,
        preterm: b.preterm === true,
        birthGestWeeks: (typeof b.birthGestWeeks === 'number' && b.birthGestWeeks >= 22 && b.birthGestWeeks <= 43) ? Math.round(b.birthGestWeeks) : null,
        birthLunar: cleanLunar(b.birthLunar),
        hasProfile: b.hasProfile === true,
        /* 第 332 次：同步元数据 + 来源家庭标记（'f:' + 8 位十六进制） */
        updatedAt: (typeof b.updatedAt === 'number' && isFinite(b.updatedAt)) ? b.updatedAt : undefined,
        by: (typeof b.by === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(b.by)) ? b.by : undefined,
        _h: (typeof b._h === 'string' && b._h.length <= 20) ? b._h : undefined,
        origin: (typeof b.origin === 'string' && /^f:[0-9a-f]{8}$/.test(b.origin)) ? b.origin : undefined,
        /* 第 146 次：非当前宝宝的记录包。用同一套 sanitize 清洗（只取 BABY_KEYS），坏数据同样被挡住 */
        rec: (b.rec && typeof b.rec === 'object' && !Array.isArray(b.rec)) ? pickBaby(sanitize(b.rec)) : null
      };
    });
    /* activeBabyId 必须指向真实存在的档案，否则置空（导入/坏数据兜底） */
    if (base.settings.activeBabyId && !base.babies.some(function (b) { return b.id === base.settings.activeBabyId; })) {
      base.settings.activeBabyId = null;
    }
    /* 第 146 次：当前宝宝的数据在顶层，它自己的 rec 若还带着（手改文件）就并不进来——直接丢弃会丢数据，
       所以只在顶层对应键全空时才用 rec 回填，否则以顶层为准。 */
    base.babies.forEach(function (b) {
      if (b.id === base.settings.activeBabyId && b.rec) {
        BABY_KEYS.forEach(function (k) {
          var top = base[k], empty = top == null || (Array.isArray(top) && !top.length);
          if (empty && b.rec[k] != null) base[k] = b.rec[k];
        });
        b.rec = null;
      }
    });
    base.babies.forEach(function (b) { ['updatedAt', 'by', '_h', 'origin'].forEach(function (k) { if (b[k] === undefined) delete b[k]; }); });
    /* 第 332 次：墓碑与映射元数据逐字段清洗（坏条目整条丢弃） */
    base.tombs = (Array.isArray(raw.tombs) ? raw.tombs : []).filter(function (t) {
      return t && typeof t === 'object' && typeof t.k === 'string' && t.k.length <= 200 && /^[^|]{1,64}\|[a-zA-Z.]{1,24}\|[^|]{1,64}$/.test(t.k)
        && typeof t.updatedAt === 'number' && isFinite(t.updatedAt) && typeof t.deletedAt === 'number' && isFinite(t.deletedAt);
    }).slice(-20000).map(function (t) {
      var p = t.k.split('|');
      return { k: t.k, t: p[1], id: p[2], babyId: (p[0] === 'fam' || p[0] === '_') ? null : p[0], deletedAt: t.deletedAt, updatedAt: t.updatedAt,
        by: (typeof t.by === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(t.by)) ? t.by : 'local' };
    });
    base.mapMeta = {};
    if (raw.mapMeta && typeof raw.mapMeta === 'object' && !Array.isArray(raw.mapMeta)) {
      Object.keys(raw.mapMeta).slice(0, 5000).forEach(function (k) {
        var m = raw.mapMeta[k];
        if (k.length <= 200 && !UNSAFE_KEY_RE.test(k) && m && typeof m === 'object' && typeof m.u === 'number' && isFinite(m.u) && typeof m.h === 'string')
          base.mapMeta[k] = { u: m.u, by: (typeof m.by === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(m.by)) ? m.by : 'local', h: m.h.slice(0, 20) };
      });
    }
    /* 第 150 次：id 字符集收口（见 scrubIds 注释），放在最后统一覆盖所有键 */
    BABY_KEYS.concat(ARRAY_KEYS, OBJECT_KEYS).forEach(function (key) { if (key !== 'babies' && base[key]) scrubIds(base[key], 0); });
    return base;
  }

  /* 枚举本机存储键。
     正常情况下走标准的 key(i)/length；若运行环境给的是残缺实现（无 key()/length），
     退化为只统计本应用自己的已知键——「统计」本身不该抛错，也不该静默归零。 */
  function storageKeys() {
    var keys = [];
    try {
      if (typeof localStorage.key === 'function' && typeof localStorage.length === 'number') {
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (k) keys.push(k);
        }
      }
    } catch (e) {}
    if (!keys.length) {
      [STORAGE_KEY, CORRUPT_BACKUP_KEY, SNAPSHOT_PREFIX + '1', SNAPSHOT_PREFIX + '2'].forEach(function (k) {
        try { if (localStorage.getItem(k) != null) keys.push(k); } catch (e) {}
      });
    }
    return keys;
  }

  /* ==================================================================
     第 332 次：家庭共享的数据地基——记录元数据、墓碑、变更追踪
     ------------------------------------------------------------------
     每条会共享的记录都带：id（新记录 crypto.randomUUID）、updatedAt（毫秒）、by（本机 deviceId，未加入家庭时 'local'）、
     babyId（所属宝宝 uuid；用品 / 储奶这类全家的为 null），以及 _h（内容指纹，不含元数据与照片字段，只用来发现「内容变了」）。

     为什么不在 70 多处写记录的地方逐个加 updatedAt：模块直接 push / splice / 原地改数组，逐处改必然漏。
     改为在唯一落盘出口 Storage.save() 里比对：内容指纹变了 → updatedAt=now、by=本机；
     上次存在、这次不见了 → 写墓碑。新增 / 修改 / 删除 / 撤销 / 库存联动（用品账本在 save 前重算）全部自动覆盖。

     墓碑另存在 data.tombs（{ k, t, id, babyId, deletedAt, updatedAt, by }），不留在原数组里：
     原数组只剩活记录，60 多个渲染点不用各自加「过滤已删除」，也就不会有哪处漏过滤把删掉的记录又显示出来。
     墓碑 60 天后、且已发出（不在出站队列）或本机不在任何家里时清理。

     安全约束：
       · 删除整个宝宝档案（removeBaby）不写墓碑——否则一台手机删档案会把全家手机上的记录一起删掉；
       · 整体导入覆盖 / 清空全部数据同理不写墓碑（只是本机重置，不是「删了这些记录」）。

     宝宝 id 一律 uuid：旧的 'b…' 短 id 按 sha256('yiya-baby|' + 旧 id) 确定性地换成 uuid，
     所以同一份旧备份在任何手机上迁出的 uuid 都一样，导入自己的旧备份仍能按 id 对上；同步时匹配宝宝只按 uuid。
     ================================================================== */
  var SYNC_BABY_ARR = ['feedings', 'sleeps', 'growth', 'diapers', 'meds', 'milestones', 'milestoneObs', 'temps', 'baths', 'swims',
    'suns', 'waters', 'jaundices', 'supplements', 'supplementPlans', 'sicks', 'vaccines.subs'];
  var SYNC_BABY_MAP = ['vaccines.done', 'vaccines.via', 'vaccines.notes', 'checkups.done'];
  var SYNC_FAM_ARR = ['supplies', 'milkStash'];
  var META_KEYS = { updatedAt: 1, deletedAt: 1, by: 1, babyId: 1, _h: 1, _o: 1 };
  var MEDIA_KEYS = { photo: 1, photos: 1, img: 1 };
  var BABY_PROFILE = ['name', 'nickname', 'birthDate', 'sex', 'preterm', 'birthGestWeeks', 'birthLunar'];
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  var TOMB_KEEP_MS = 60 * 864e5;
  var META_BACKUP_KEY = 'momhelper_premeta_backup_v332';

  /* 53 位内容指纹（cyrb53），只用来判断「变没变」，不是安全用途 */
  function hash53(str) {
    var h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (var i = 0, ch; i < str.length; i++) {
      ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }
  /* 同步版 SHA-256（只用于旧宝宝 id → 确定性 uuid 的一次性迁移；load() 是同步的，用不了 crypto.subtle） */
  function sha256Hex(msg) {
    var K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
      0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
      0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
      0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var bytes = unescape(encodeURIComponent(msg)), l = bytes.length, words = [], i;
    for (i = 0; i < l; i++) words[i >> 2] |= bytes.charCodeAt(i) << (24 - (i % 4) * 8);
    words[l >> 2] |= 0x80 << (24 - (l % 4) * 8);
    words[(((l + 8) >> 6) << 4) + 15] = l * 8;
    var W = new Array(64);
    for (var j = 0; j < words.length; j += 16) {
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (i = 0; i < 64; i++) {
        if (i < 16) W[i] = words[j + i] | 0;
        else {
          var x = W[i - 15], y = W[i - 2];
          W[i] = (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + W[i - 7]
            + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10)) + W[i - 16] | 0;
        }
        var t1 = h + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) + ((e & f) ^ (~e & g)) + K[i] + W[i] | 0;
        var t2 = (((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) + ((a & b) ^ (a & c) ^ (b & c)) | 0;
        h = g; g = f; f = e; e = d + t1 | 0; d = c; c = b; b = a; a = t1 + t2 | 0;
      }
      H[0] = H[0] + a | 0; H[1] = H[1] + b | 0; H[2] = H[2] + c | 0; H[3] = H[3] + d | 0;
      H[4] = H[4] + e | 0; H[5] = H[5] + f | 0; H[6] = H[6] + g | 0; H[7] = H[7] + h | 0;
    }
    return H.map(function (v) { return ('00000000' + (v >>> 0).toString(16)).slice(-8); }).join('');
  }
  function uuidFrom(seed) {
    var hx = sha256Hex(seed);
    var v = (8 + (parseInt(hx[16], 16) & 3)).toString(16);
    return hx.slice(0, 8) + '-' + hx.slice(8, 12) + '-8' + hx.slice(13, 16) + '-' + v + hx.slice(17, 20) + '-' + hx.slice(20, 32);
  }
  function newUuid() {
    try { if (global.crypto && typeof global.crypto.randomUUID === 'function') return global.crypto.randomUUID(); } catch (e) {}
    var b = new Uint8Array(16);
    try { global.crypto.getRandomValues(b); } catch (e2) { for (var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256); }
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = Array.prototype.map.call(b, function (x) { return (x < 16 ? '0' : '') + x.toString(16); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  function contentHash(r) {
    var ks = Object.keys(r).sort(), o = {};
    for (var i = 0; i < ks.length; i++) { var k = ks[i]; if (!META_KEYS[k] && !MEDIA_KEYS[k]) o[k] = r[k]; }
    return hash53(JSON.stringify(o));
  }
  function babyHash(b) {
    var o = {};
    BABY_PROFILE.forEach(function (k) { o[k] = b[k] === undefined ? null : b[k]; });
    return hash53(JSON.stringify(o));
  }
  function getPath(o, path) {
    var ps = path.split('.'), cur = o;
    for (var i = 0; i < ps.length && cur; i++) cur = cur[ps[i]];
    return cur;
  }
  function ensurePath(o, path, arr) {
    var ps = path.split('.'), cur = o;
    for (var i = 0; i < ps.length - 1; i++) {
      if (!cur[ps[i]] || typeof cur[ps[i]] !== 'object' || Array.isArray(cur[ps[i]])) cur[ps[i]] = {};
      cur = cur[ps[i]];
    }
    var last = ps[ps.length - 1];
    if (arr ? !Array.isArray(cur[last]) : (!cur[last] || typeof cur[last] !== 'object' || Array.isArray(cur[last]))) cur[last] = arr ? [] : {};
    return cur[last];
  }
  /** 某个宝宝的数据容器：当前宝宝在顶层，其他宝宝在 babies[].rec（没有就按需建空的） */
  function babySrc(d, bid, create) {
    if (!d || !bid) return null;
    if (bid === (d.settings && d.settings.activeBabyId)) return d;
    var b = (d.babies || []).filter(function (x) { return x && x.id === bid; })[0];
    if (!b) return null;
    if (!b.rec && create) { var def = defaultData(), r = {}; BABY_KEYS.forEach(function (k) { r[k] = def[k]; }); b.rec = r; }
    return b.rec || null;
  }
  /** 遍历所有会共享的条目：cb(scope, type, id, kind, obj, holder)。kind = 'rec' | 'map' | 'baby' */
  function walkSync(d, cb) {
    var act = d.settings && d.settings.activeBabyId;
    var babies = (d.babies || []).filter(function (b) { return b && typeof b.id === 'string'; });
    var hasAct = babies.some(function (b) { return b.id === act; });
    function walkBaby(scope, src) {
      SYNC_BABY_ARR.forEach(function (t) {
        var arr = getPath(src, t);
        if (!Array.isArray(arr)) return;
        for (var i = 0; i < arr.length; i++) { var r = arr[i]; if (r && typeof r === 'object' && !Array.isArray(r)) cb(scope, t, r.id, 'rec', r, arr); }
      });
      SYNC_BABY_MAP.forEach(function (t) {
        var m = getPath(src, t);
        if (!m || typeof m !== 'object' || Array.isArray(m)) return;
        Object.keys(m).forEach(function (k) { if (m[k] != null) cb(scope, t, k, 'map', m[k], m); });
      });
    }
    babies.forEach(function (b) {
      cb(b.id, 'baby', b.id, 'baby', b, null);
      var src = b.id === act ? d : b.rec;
      if (src) walkBaby(b.id, src);
    });
    /* 还没有任何宝宝档案（或当前宝宝 id 失效）时顶层的记录：scope '_'，只在本机，不同步、不写墓碑 */
    if (!hasAct) walkBaby('_', d);
    SYNC_FAM_ARR.forEach(function (t) {
      var arr = d[t];
      if (!Array.isArray(arr)) return;
      for (var i = 0; i < arr.length; i++) { var r = arr[i]; if (r && typeof r === 'object' && !Array.isArray(r)) cb('fam', t, r.id, 'rec', r, arr); }
    });
  }
  function keyOf(scope, type, id) { return scope + '|' + type + '|' + id; }
  function splitKey(k) {
    var a = k.indexOf('|'), b = k.indexOf('|', a + 1);
    return { scope: k.slice(0, a), type: k.slice(a + 1, b), id: k.slice(b + 1) };
  }
  function lww(au, aby, bu, bby) { /* a 比 b 新？ */
    au = +au || 0; bu = +bu || 0;
    if (au !== bu) return au > bu;
    return String(aby || '') > String(bby || '');
  }

  var Meta = {
    me: 'local',          /* 本机 deviceId（FamSync 加入家庭后设置；不在家里时 'local'） */
    prevKeys: null,       /* 上次落盘时存在的条目 key（内存；墓碑判定用） */
    onChange: null,       /* FamSync 挂钩：function(keys[]) */
    suppressTombs: false, /* 整体导入 / 清空时置 true：这次不写墓碑 */
    lastPrune: 0,

    /** 一次性、可重入的迁移：宝宝 id → uuid；记录补 id / updatedAt / by / babyId / _h。返回是否改动了数据 */
    migrate: function (d, opts) {
      opts = opts || {};
      var changed = false, now = Date.now();
      /* 1) 宝宝 id → uuid（确定性），同步更新 activeBabyId（全项目对宝宝 id 的引用只有这两处，见第 332 次盘点） */
      (d.babies || []).forEach(function (b) {
        if (!b || typeof b.id !== 'string' || UUID_RE.test(b.id)) return;
        var nid = uuidFrom('yiya-baby|' + b.id);
        if (d.settings && d.settings.activeBabyId === b.id) d.settings.activeBabyId = nid;
        b.id = nid; changed = true;
      });
      /* 2) 用品自己的「改过时间」字符串原来也叫 updatedAt（第 294 次），改名 editedAt，腾出 updatedAt 给毫秒时间戳 */
      (d.supplies || []).forEach(function (s) {
        if (s && typeof s.updatedAt === 'string') { if (!s.editedAt) s.editedAt = s.updatedAt; delete s.updatedAt; changed = true; }
      });
      /* 3) 记录元数据 */
      walkSync(d, function (scope, type, id, kind, r, holder) {
        if (kind === 'map') {
          var mm = d.mapMeta = (d.mapMeta && typeof d.mapMeta === 'object' && !Array.isArray(d.mapMeta)) ? d.mapMeta : {};
          var mk = keyOf(scope, type, id);
          if (!mm[mk] && scope !== '_') { mm[mk] = { u: now, by: 'local', h: hash53(JSON.stringify(r)) }; changed = true; }
          return;
        }
        if (kind === 'rec' && (typeof r.id !== 'string' || !r.id)) { r.id = newUuid(); changed = true; }
        if (typeof r.updatedAt !== 'number' || !isFinite(r.updatedAt)) { r.updatedAt = now; changed = true; }
        if (typeof r.by !== 'string' || !r.by) { r.by = 'local'; changed = true; }
        if (kind === 'rec') {
          var bid = (scope === 'fam' || scope === '_') ? null : scope;
          if (r.babyId !== bid) { r.babyId = bid; changed = true; }
          if ('deletedAt' in r) { delete r.deletedAt; changed = true; }
        }
        if (r._h == null) { r._h = kind === 'baby' ? babyHash(r) : contentHash(r); changed = true; }
      });
      if (!Array.isArray(d.tombs)) { d.tombs = []; changed = true; }
      return changed;
    },

    /** 每次落盘前调用：发现改动 → 打时间戳 / 写墓碑 / 通知出站队列 */
    track: function (d) {
      var me = Meta.me || 'local', now = Date.now(), seen = {}, changed = [];
      var tombIdx = {};
      if (!Array.isArray(d.tombs)) d.tombs = [];
      d.tombs.forEach(function (t, i) { if (t && t.k) tombIdx[t.k] = i; });
      var dropTomb = {};
      var mm = d.mapMeta = (d.mapMeta && typeof d.mapMeta === 'object' && !Array.isArray(d.mapMeta)) ? d.mapMeta : {};
      walkSync(d, function (scope, type, id, kind, r) {
        if (kind === 'rec' && (typeof r.id !== 'string' || !r.id)) { r.id = newUuid(); id = r.id; }
        var k = keyOf(scope, type, id);
        if (seen[k]) return;           /* 同一宝宝同类型里重复 id 的坏数据：只认第一条 */
        seen[k] = 1;
        var tomb = tombIdx[k] != null ? d.tombs[tombIdx[k]] : null;
        if (kind === 'map') {
          var h0 = hash53(JSON.stringify(r)), m = mm[k];
          if (scope === '_') return;
          if (!m) { mm[k] = { u: now, by: me, h: h0 }; changed.push(k); }
          else if (m.h !== h0) { m.u = Math.max(now, (+m.u || 0) + 1); m.by = me; m.h = h0; changed.push(k); }
          if (tomb) { if (!lww(m ? m.u : now, m ? m.by : me, tomb.updatedAt, tomb.by)) { mm[k].u = Math.max(now, tomb.updatedAt + 1); mm[k].by = me; changed.push(k); } dropTomb[k] = 1; }
          return;
        }
        var h = kind === 'baby' ? babyHash(r) : contentHash(r);
        if (r._h == null) {
          if (typeof r.updatedAt !== 'number' || !isFinite(r.updatedAt)) { r.updatedAt = now; r.by = me; }
          if (typeof r.by !== 'string' || !r.by) r.by = me;
          r._h = h; changed.push(k);
        } else if (r._h !== h) {
          r.updatedAt = Math.max(now, ((typeof r.updatedAt === 'number' && isFinite(r.updatedAt)) ? r.updatedAt : 0) + 1); r.by = me; r._h = h; changed.push(k);
        } else if (Meta.prevKeys && !Meta.prevKeys[k] && !tomb) {
          changed.push(k);  /* 内容没变但新出现（换宝宝 / 从别处搬过来）：也要发一次 */
        }
        if (kind === 'rec') {
          var bid = (scope === 'fam' || scope === '_') ? null : scope;
          if (r.babyId !== bid) r.babyId = bid;
          if ('deletedAt' in r) delete r.deletedAt;
        }
        if (tomb) {
          /* 撤销删除 / 别人复活：活记录必须比墓碑新，否则同步时会被墓碑压回去 */
          if (!lww(r.updatedAt, r.by, tomb.updatedAt, tomb.by)) { r.updatedAt = Math.max(now, tomb.updatedAt + 1); r.by = me; }
          dropTomb[k] = 1; if (changed[changed.length - 1] !== k) changed.push(k);
        }
      });
      /* 删除 → 墓碑（只对还存在的宝宝 / 全家范围；宝宝档案被删、整体覆盖、清空不写） */
      var babyIds = {};
      (d.babies || []).forEach(function (b) { if (b && b.id) babyIds[b.id] = 1; });
      if (Meta.prevKeys && !Meta.suppressTombs) {
        Object.keys(Meta.prevKeys).forEach(function (k) {
          if (seen[k]) return;
          var p = splitKey(k);
          if (p.scope === '_' || p.type === 'baby') { delete mm[k]; return; }
          if (p.scope !== 'fam' && !babyIds[p.scope]) { delete mm[k]; return; }
          var prevMeta = mm[k];
          var t = { k: k, t: p.type, id: p.id, babyId: p.scope === 'fam' ? null : p.scope, deletedAt: now,
            updatedAt: Math.max(now, prevMeta ? (+prevMeta.u || 0) + 1 : 0), by: me };
          if (tombIdx[k] != null) d.tombs[tombIdx[k]] = t; else { tombIdx[k] = d.tombs.length; d.tombs.push(t); }
          delete mm[k];
          changed.push(k);
        });
      } else if (Meta.suppressTombs) {
        Object.keys(mm).forEach(function (k) { if (!seen[k]) delete mm[k]; });
      }
      if (Object.keys(dropTomb).length) d.tombs = d.tombs.filter(function (t) { return !(t && dropTomb[t.k]); });
      /* 墓碑清理：60 天以上，且本机不在家里或已发出 */
      if (now - Meta.lastPrune > 3600e3) {
        Meta.lastPrune = now;
        var pending = (global.FamSync && FamSync.pendingKeys) ? FamSync.pendingKeys() : {};
        d.tombs = d.tombs.filter(function (t) {
          if (!t || typeof t.k !== 'string') return false;
          if (p0(t.k) !== 'fam' && !babyIds[p0(t.k)]) return false;
          return !(now - (+t.deletedAt || 0) > TOMB_KEEP_MS && !pending[t.k]);
        });
      }
      Meta.prevKeys = seen;
      Meta.suppressTombs = false;
      if (changed.length && typeof Meta.onChange === 'function') { try { Meta.onChange(changed); } catch (e) {} }
      return changed;
    },

    /** 重新建立 prevKeys（load / 导入 / 远端应用之后） */
    reindex: function (d) {
      var seen = {};
      walkSync(d, function (scope, type, id) { seen[keyOf(scope, type, id)] = 1; });
      Meta.prevKeys = seen;
    },

    /** 取某个 key 当前的同步实体（活记录 / 墓碑 / 映射项）；不存在且无墓碑返回 null */
    entity: function (d, k) {
      var p = splitKey(k);
      var t = (d.tombs || []).filter(function (x) { return x && x.k === k; })[0];
      if (t) return { t: p.type, s: p.scope, id: p.id, u: t.updatedAt, by: t.by, d: t.deletedAt };
      if (p.type === 'baby') {
        var b = (d.babies || []).filter(function (x) { return x && x.id === p.id; })[0];
        if (!b) return null;
        var o = {};
        BABY_PROFILE.forEach(function (f) { o[f] = b[f] === undefined ? null : b[f]; });
        return { t: 'baby', s: p.scope, id: p.id, u: b.updatedAt, by: b.by, r: o };
      }
      var src = p.scope === 'fam' ? d : babySrc(d, p.scope, false);
      if (!src) return null;
      if (SYNC_BABY_MAP.indexOf(p.type) >= 0) {
        var m = getPath(src, p.type), mt = (d.mapMeta || {})[k];
        if (!m || m[p.id] == null || !mt) return null;
        return { t: p.type, s: p.scope, id: p.id, u: mt.u, by: mt.by, v: m[p.id] };
      }
      var arr = getPath(src, p.type);
      if (!Array.isArray(arr)) return null;
      var r = arr.filter(function (x) { return x && x.id === p.id; })[0];
      if (!r) return null;
      var c = {};
      Object.keys(r).forEach(function (f) { if (!META_KEYS[f] && !MEDIA_KEYS[f]) c[f] = r[f]; });
      return { t: p.type, s: p.scope, id: p.id, u: r.updatedAt, by: r.by, r: c, o: r._o || null };
    },

    /** 某个范围（宝宝 uuid / 'fam'）下的所有 key（含墓碑） */
    keysOf: function (d, scope) {
      var out = [];
      walkSync(d, function (s, type, id) { if (s === scope) out.push(keyOf(s, type, id)); });
      (d.tombs || []).forEach(function (t) { if (t && p0(t.k) === scope) out.push(t.k); });
      return out;
    },

    /**
     * 应用一条（已通过 schema 校验的）远端实体。返回 'applied' | 'stale' | 'nobaby'。
     * LWW：(updatedAt, by) 大的赢；墓碑同样参与。照片等媒体字段不同步，赢了也保留本机的。
     */
    apply: function (d, e, opts) {
      opts = opts || {};
      var k = keyOf(e.s, e.t, e.id);
      var tombI = -1;
      (d.tombs || []).forEach(function (t, i) { if (t && t.k === k) tombI = i; });
      var tomb = tombI >= 0 ? d.tombs[tombI] : null;
      var mm = d.mapMeta = d.mapMeta || {};
      if (e.t === 'baby') {
        var b = (d.babies || []).filter(function (x) { return x && x.id === e.id; })[0];
        if (e.d) return 'stale';  /* 宝宝档案不接受远端删除：删档案只影响本机 */
        if (!b) {
          b = { id: e.id, name: '宝宝', photo: null, birthDate: null, nickname: '', sex: null, preterm: false, birthGestWeeks: null,
            birthLunar: null, hasProfile: true, rec: null, origin: opts.origin || null };
          BABY_PROFILE.forEach(function (f) { if (e.r[f] !== undefined) b[f] = e.r[f]; });
          b.updatedAt = e.u; b.by = e.by; b._h = babyHash(b);
          if (!d.babies.length && opts.adoptTop) d.settings.activeBabyId = b.id;
          d.babies.push(b);
          return 'applied';
        }
        if (!lww(e.u, e.by, b.updatedAt, b.by)) return 'stale';
        BABY_PROFILE.forEach(function (f) { if (e.r[f] !== undefined) b[f] = e.r[f]; });
        b.updatedAt = e.u; b.by = e.by; b._h = babyHash(b);
        if (b.id === d.settings.activeBabyId && typeof Storage._mirrorActive === 'function') Storage._mirrorActive();
        return 'applied';
      }
      var src = e.s === 'fam' ? d : babySrc(d, e.s, true);
      if (!src) return 'nobaby';
      var isMap = SYNC_BABY_MAP.indexOf(e.t) >= 0;
      /* 本机现状 */
      var curU, curBy, arr = null, idx = -1, m = null;
      if (isMap) {
        m = ensurePath(src, e.t, false);
        if (m[e.id] != null && mm[k]) { curU = mm[k].u; curBy = mm[k].by; }
      } else {
        arr = ensurePath(src, e.t, true);
        for (var i = 0; i < arr.length; i++) if (arr[i] && arr[i].id === e.id) { idx = i; break; }
        if (idx >= 0) { curU = arr[idx].updatedAt; curBy = arr[idx].by; }
      }
      if (curU == null && tomb) { curU = tomb.updatedAt; curBy = tomb.by; }
      if (curU != null && !lww(e.u, e.by, curU, curBy)) return 'stale';
      if (e.d) {
        if (isMap) { delete m[e.id]; delete mm[k]; }
        else if (idx >= 0) arr.splice(idx, 1);
        var nt = { k: k, t: e.t, id: e.id, babyId: e.s === 'fam' ? null : e.s, deletedAt: e.d, updatedAt: e.u, by: e.by };
        if (tomb) d.tombs[tombI] = nt; else d.tombs.push(nt);
      } else {
        if (tomb) d.tombs.splice(tombI, 1);
        if (isMap) {
          m[e.id] = e.v;
          mm[k] = { u: e.u, by: e.by, h: hash53(JSON.stringify(e.v)) };
        } else {
          var nr = {};
          Object.keys(e.r).forEach(function (f) { nr[f] = e.r[f]; });
          if (idx >= 0) Object.keys(arr[idx]).forEach(function (f) { if (MEDIA_KEYS[f]) nr[f] = arr[idx][f]; });
          nr.id = e.id; nr.updatedAt = e.u; nr.by = e.by; nr.babyId = e.s === 'fam' ? null : e.s;
          /* 全家范围（用品 / 储奶）收到的记录打上来源家庭标记：退出后再加入别的家，不会把旧家的这些条目带过去 */
          if (e.s === 'fam' && opts.origin && !(idx >= 0 && !arr[idx]._o && arr[idx].by === Meta.me)) nr._o = opts.origin;
          else if (idx >= 0 && arr[idx]._o) nr._o = arr[idx]._o;
          nr._h = contentHash(nr);
          if (idx >= 0) arr[idx] = nr; else arr.push(nr);
        }
      }
      return 'applied';
    },

    lww: lww, keyOf: keyOf, splitKey: splitKey, contentHash: contentHash, walk: walkSync, newUuid: newUuid, uuidFrom: uuidFrom,
    UUID_RE: UUID_RE, SYNC_BABY_ARR: SYNC_BABY_ARR, SYNC_BABY_MAP: SYNC_BABY_MAP, SYNC_FAM_ARR: SYNC_FAM_ARR,
    META_KEYS: META_KEYS, MEDIA_KEYS: MEDIA_KEYS, BABY_PROFILE: BABY_PROFILE, BACKUP_KEY: META_BACKUP_KEY
  };
  function p0(k) { return k.slice(0, k.indexOf('|')); }

  var Storage = {
    data: null,

    /** 从 localStorage 读取；缺失用默认值；损坏则备份原文后回退默认值 */
    load: function () {
      var raw = null;
      try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
      if (!raw) { this.data = defaultData(); Meta.reindex(this.data); return this.data; }
      try {
        this.data = sanitize(JSON.parse(raw));
        /* 第 320 次：左右手 / 简洁模式已移除。已存的 handMode / leftHand 旧值静默迁移为默认（sanitize 白名单已丢掉），
           这里把清洗后的数据当场写回一次，localStorage 里不再留旧键（不触感、不提示） */
        if (/"(handMode|leftHand)"\s*:/.test(raw)) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data)); this._handMigrated = true; } catch (eM) { /* 配额满：下次正常保存时自然清掉 */ } }
        this.migrate();
        this._supDedupe();
        this._metaMigrate(raw);
      } catch (e) {
        /* 损坏自愈：备份原文，再回退默认值。用户数据不静默丢失。 */
        try { localStorage.setItem(CORRUPT_BACKUP_KEY, raw); } catch (e2) {}
        this.data = defaultData();
        this._corruptRecovered = true;
      }
      return this.data;
    },

    /** 写入 localStorage；配额满/异常时弹 toast 告警并返回 false
     *  第 45 次：保存结果同时给一次触感反馈（成功极短轻震 / 失败双震）。
     *  放在这里是因为它是全应用唯一的落盘出口——73 处调用无需各自改，
     *  也不会漏掉任何一条记录。Util.haptic 内部已守卫「设置里关掉」与
     *  「设备不支持（Safari/iOS）」，这里只负责在结果确定后调用一次。 */
    save: function () {
      this._gen = (this._gen || 0) + 1;   /* 第 319 次：数据代号——一级页 DOM 缓存据此判断要不要重建 */
      /* 第 332 次：唯一落盘出口里做变更追踪（时间戳 / 墓碑 / 出站队列），出错不挡保存 */
      try { if (this.data) Meta.track(this.data); } catch (eT) { if (global.console) console.warn('[meta] track', eT); }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
        if (global.Util && Util.haptic && !this._remoteSaving) Util.haptic('ok');
        return true;
      } catch (e) {
        if (global.Util && Util.haptic) Util.haptic('error');
        if (global.Util && Util.toast) {
          Util.toast('保存失败：本地存储空间不足，请导出备份后清理旧记录。', 'error');
        }
        return false;
      }
    },

    get: function () { return this.data; },
    /* 第 333 次：我的快记——种类表、默认清单、旧配置迁移（QuickRec 与测试共用） */
    QUICK_KINDS: QUICK_KINDS,
    QUICK_MAX: QUICK_MAX,
    quickDefaults: quickDefaults,
    _migrateQuick: migrateQuick,

    /* 第 332 次：记录元数据一次性迁移（可重入）。有改动时先把迁移前的原文备份到独立键（只做一次），再落盘 */
    _metaMigrate: function (rawText) {
      var d = this.data;
      var need = Meta.migrate(d);
      if (need) {
        /* rawText 就是迁移前的原文。只备份第一次；小于 1.5M 字符放 localStorage，再大放 IndexedDB（不和主数据抢 5MB 配额） */
        try {
          if (rawText && localStorage.getItem(META_BACKUP_KEY) == null && !this._metaBackupIdb) {
            if (rawText.length < 1.5e6) localStorage.setItem(META_BACKUP_KEY, rawText);
            else if (global.FamDB) { this._metaBackupIdb = true; FamDB.get('backup:premeta').then(function (v) { if (v == null) FamDB.set('backup:premeta', { at: Date.now(), text: rawText }); }).catch(function () {}); }
          }
        } catch (eB) { /* 配额满：不挡迁移（迁移只加字段、不删数据） */ }
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(d)); } catch (eS) {}
        this._metaMigrated = true;
      }
      Meta.reindex(d);
      return need;
    },
    Meta: Meta,
    /** 第 332 次：给 FamSync 用——在不触发「本机改动」的前提下应用远端实体，然后落盘一次 */
    applyRemote: function (ents, opts) {
      var d = this.data, out = { applied: 0, stale: 0, nobaby: 0, touched: {} }, rk = {};
      ents.forEach(function (e) {
        var r = Meta.apply(d, e, opts);
        out[r] = (out[r] || 0) + 1;
        if (r === 'applied') { out.touched[e.s] = 1; rk[Meta.keyOf(e.s, e.t, e.id)] = 1; }
      });
      if (out.applied) {
        Meta.reindex(d);
        this._remoteSaving = true; this._remoteKeys = rk;
        try { this.save(); } finally { this._remoteSaving = false; this._remoteKeys = null; }
      }
      return out;
    },
    /** 第 332 次：把 by='local' 或本机旧 deviceId 的条目改记为当前 deviceId（加入家庭时；不改内容、不动 updatedAt） */
    retagMine: function (ids, me) {
      var d = this.data, set = {}, n = 0;
      (ids || []).concat(['local']).forEach(function (x) { set[x] = 1; });
      Meta.walk(d, function (scope, type, id, kind, r) {
        if (kind === 'map') { var mt = (d.mapMeta || {})[Meta.keyOf(scope, type, id)]; if (mt && set[mt.by]) { mt.by = me; n++; } return; }
        if (set[r.by]) { r.by = me; n++; }
      });
      (d.tombs || []).forEach(function (t) { if (t && set[t.by]) { t.by = me; n++; } });
      if (n) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(d)); } catch (e) {} }
      return n;
    },

    /* 第 281 次：合并误存成多份的营养品计划（当前宝宝 + 其他宝宝档案里的），有合并就落盘一次 */
    _supDedupe: function () {
      var d = this.data, n = 0, rmap = null;
      try { rmap = JSON.parse(localStorage.getItem(SUP_REMIND_KEY) || '{}'); } catch (e) { rmap = null; }
      if (!rmap || typeof rmap !== 'object' || Array.isArray(rmap)) rmap = {};
      try {
        n += dedupeSupPlans(d.supplementPlans, d.supplements, rmap);
        (d.babies || []).forEach(function (b) { if (b && b.rec) n += dedupeSupPlans(b.rec.supplementPlans, b.rec.supplements, rmap); });
      } catch (e) { return 0; }
      if (n) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(d)); } catch (e) { /* 存不下就下次再合并 */ }
        try { localStorage.setItem(SUP_REMIND_KEY, JSON.stringify(rmap)); } catch (e) {}
      }
      return n;
    },
    _dedupeSupPlans: dedupeSupPlans,

    /* ============================================================
       第 80 次（宝宝档案）：多宝宝支持 API。
       兼容策略：settings.baby（各模块现读的现役宝宝字段）继续作为唯一读取口，
       档案切换时把当前宝宝的名字/生日镜像进 settings.baby——growth/vaccine/
       milestone 等所有模块零改动即跟随切换。记录明细（喂养/生长等）仍是
       单一时间线，不按宝宝区分（本版限制，档案卡 hint 已如实说明）。
       ============================================================ */

    /** 当前宝宝档案（无档案返回 null） */
    activeBaby: function () {
      var d = this.data;
      if (!d || !d.babies || !d.settings) return null;
      for (var i = 0; i < d.babies.length; i++) {
        if (d.babies[i].id === d.settings.activeBabyId) return d.babies[i];
      }
      return null;
    },

    /** 把档案字段镜像进 settings.baby（切换/新增后调用；不落盘，由调用方 save） */
    _mirrorActive: function () {
      var b = this.activeBaby();
      if (!b) return;
      this.data.settings.baby = this.data.settings.baby || {};
      var sb = this.data.settings.baby;
      sb.name = b.name;
      sb.birthDate = b.birthDate;
      /* 第 212 次：小名/性别/早产/农历生日一并换成这个宝宝自己的（档案还没存过资料的老数据保持现状） */
      sb.nickname = b.nickname || '';
      sb.birthLunar = b.birthLunar || null;
      if (b.hasProfile) {
        PROFILE_KEYS.forEach(function (k) { sb[k] = (b[k] === undefined) ? null : b[k]; });
        if (!sb.nickname) sb.nickname = '';
      }
    },

    /** 切换当前宝宝（id 无效则不动作，返回 null） */
    switchBaby: function (id) {
      var d = this.data;
      var hit = (d.babies || []).filter(function (b) { return b.id === id; })[0];
      if (!hit) return null;
      if (this.activeBaby()) this.syncBabyFromSettings();   /* 第 212 次：先把当前宝宝的资料收回档案，避免切换后串名 */
      if (hit.id !== d.settings.activeBabyId) {
        this._stashActive();
        this._loadBaby(hit);
      }
      d.settings.activeBabyId = id;
      this._mirrorActive();
      this.save();
      return hit;
    },

    /* 第 146 次（多宝宝隔离）：把顶层的宝宝数据收进「当前顶层数据的主人」的 rec。
       主人 = activeBaby；若 activeBabyId 失效，则取唯一一个 rec 为空的档案（它的数据就在顶层），
       都找不到时取第一个——宁可归错名下，也不让顶层数据在切换时被覆盖丢失。 */
    _stashActive: function () {
      var d = this.data;
      var owner = this.activeBaby()
        || (d.babies || []).filter(function (b) { return !b.rec; })[0]
        || (d.babies || [])[0];
      if (!owner) return;
      var rec = {};
      BABY_KEYS.forEach(function (k) { rec[k] = d[k]; });
      owner.rec = rec;
    },

    /* 把某个宝宝的 rec 换到顶层（没有 rec = 新宝宝/旧版本留下的空档案 → 用默认空值） */
    _loadBaby: function (b) {
      var d = this.data, def = defaultData(), rec = b.rec || {};
      BABY_KEYS.forEach(function (k) { d[k] = (k in rec) ? rec[k] : def[k]; });
      b.rec = null;
    },

    /* 第 222 次（双胞胎/多宝宝同时记）：往指定宝宝名下追加一条记录。
       当前宝宝写顶层；其他宝宝写进它档案的 rec（没有 rec 就按默认空值建一份）。
       只允许 BABY_KEYS 里的数组键，其余一律拒绝。返回是否写入。 */
    pushFor: function (babyId, key, rec) {
      if (BABY_KEYS.indexOf(key) < 0) return false;
      var d = this.data;
      if (!babyId || babyId === d.settings.activeBabyId) {
        if (!Array.isArray(d[key])) return false;
        d[key].push(rec); return true;
      }
      var b = (d.babies || []).filter(function (x) { return x.id === babyId; })[0];
      if (!b) return false;
      if (!b.rec) { var def = defaultData(), r = {}; BABY_KEYS.forEach(function (k) { r[k] = def[k]; }); b.rec = r; }
      if (!Array.isArray(b.rec[key])) b.rec[key] = [];
      b.rec[key].push(rec); return true;
    },
    /** pushFor 的撤销：按记录 id 从指定宝宝名下删掉 */
    removeFor: function (babyId, key, recId) {
      if (BABY_KEYS.indexOf(key) < 0) return false;
      var d = this.data;
      var arr = (!babyId || babyId === d.settings.activeBabyId) ? d[key]
        : (((d.babies || []).filter(function (x) { return x.id === babyId; })[0] || {}).rec || {})[key];
      if (!Array.isArray(arr)) return false;
      for (var i = arr.length - 1; i >= 0; i--) if (arr[i] && arr[i].id === recId) { arr.splice(i, 1); return true; }
      return false;
    },

    /** 某个宝宝名下的记录条数（设置页删除确认用；当前宝宝读顶层） */
    babyRecordCount: function (id) {
      var d = this.data;
      var b = (d.babies || []).filter(function (x) { return x.id === id; })[0];
      if (!b) return 0;
      var src = (b.id === d.settings.activeBabyId) ? d : (b.rec || {});
      var n = 0;
      BABY_KEYS.forEach(function (k) { if (Array.isArray(src[k])) n += src[k].length; });
      if (src.vaccines && src.vaccines.done) n += Object.keys(src.vaccines.done).length;
      return n;
    },

    /** 新增宝宝档案并切换为当前；opts: { name, birthDate, photo } */
    addBaby: function (opts) {
      opts = opts || {};
      /* 第 103 次审计修复：随机后缀由 1 位（Math.floor(Math.random()*36)，仅 36 种）
         改为 6 位 base36（util.js:13 Util.uid 的同构写法）。
         原写法在同一毫秒内连建两个档案时有 2.821% 概率撞 id（20 万次采样实测
         5643 次碰撞）——撞了之后 _mirrorActive 按 id 取第一条，镜像停在旧宝宝上，
         于是新宝宝的记录全部串到旧宝宝名下，是真实的数据错乱而非显示瑕疵。
         复现脚本：node workspace/repro_babyid.js
         本次只改 id 生成式一行：DATA_VERSION、字段结构、迁移逻辑一律未动，
         旧数据的 id 原样可读，不存在兼容问题。 */
      var b = {
        id: newUuid(),   /* 第 332 次：宝宝 id 一律 uuid（同步只按 uuid 匹配宝宝） */
        name: (typeof opts.name === 'string' && opts.name.trim()) ? opts.name.trim().slice(0, 12) : '宝宝',
        photo: validPhoto(opts.photo) ? opts.photo : null,
        birthDate: (typeof opts.birthDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(opts.birthDate)) ? opts.birthDate : null,
        nickname: (typeof opts.nickname === 'string') ? opts.nickname.trim().slice(0, 12) : '',
        sex: (opts.sex === 'girl' || opts.sex === 'boy') ? opts.sex : null,
        preterm: false, birthGestWeeks: null,
        birthLunar: cleanLunar(opts.birthLunar),
        hasProfile: true
      };
      /* 第 146 次：先把上一个宝宝的数据收好，新宝宝从空白开始。
         还没有任何档案、但顶层已有宝宝信息或记录时，这些数据属于「隐含的第一个宝宝」：
         先给它补建档案（名字/生日取 settings.baby），再加新宝宝——否则旧记录会被算到新宝宝名下。 */
      var dd = this.data;
      if (!dd.babies.length) {
        var hasBabyData = BABY_KEYS.some(function (k) { return Array.isArray(dd[k]) && dd[k].length; })
          || (dd.vaccines && dd.vaccines.done && Object.keys(dd.vaccines.done).length);
        if (dd.settings.baby || hasBabyData) {
          if (!dd.settings.baby) dd.settings.baby = { name: '宝宝', birthDate: null };
          this.syncBabyFromSettings();
        }
      }
      if (this.data.babies.length) {
        this.syncBabyFromSettings();
        this._stashActive();
        this._loadBaby(b);
      }
      this.data.babies.push(b);
      this.data.settings.activeBabyId = b.id;
      this._mirrorActive();
      this.save();
      return b;
    },

    /** 删除档案；删的是当前宝宝时回落到第一个（没有了则清空镜像回 null） */
    removeBaby: function (id) {
      var d = this.data;
      var idx = -1;
      for (var i = 0; i < d.babies.length; i++) { if (d.babies[i].id === id) { idx = i; break; } }
      if (idx < 0) return false;
      var wasActive = d.babies[idx].id === d.settings.activeBabyId;
      d.babies.splice(idx, 1);
      if (wasActive) {
        d.settings.activeBabyId = d.babies.length ? d.babies[0].id : null;
        /* 第 146 次：删的是当前宝宝且还有别的宝宝 → 换入下一个宝宝的数据（被删宝宝的记录随档案删除）。
           删的是最后一个档案 → 顶层记录保留不动（与旧版行为一致，避免误删全部记录）。 */
        if (d.babies.length) { this._loadBaby(d.babies[0]); this._mirrorActive(); }
        else d.settings.baby = null;
      }
      this.save();
      return true;
    },

    /** 重命名档案（改名后镜像同步） */
    renameBaby: function (id, name) {
      var b = (this.data.babies || []).filter(function (x) { return x.id === id; })[0];
      if (!b) return false;
      if (b.id === this.data.settings.activeBabyId) this.syncBabyFromSettings();
      b.name = (typeof name === 'string' && name.trim()) ? name.trim().slice(0, 12) : '宝宝';
      if (b.id === this.data.settings.activeBabyId) this._mirrorActive();
      this.save();
      return true;
    },

    /** 给当前宝宝设置照片（dataURL；空串/null 表示清除，回退默认头像） */
    setActiveBabyPhoto: function (dataURL) {
      var b = this.activeBaby();
      if (!b) return false;
      b.photo = validPhoto(dataURL) ? dataURL : null;
      this.save();
      return true;
    },

    /** 反向镜像：settings.baby 被直接编辑后（引导/疫苗页/生长页改生日），
        把名字/生日同步回当前档案。无档案时自动播种一个（首次引导场景）。 */
    syncBabyFromSettings: function () {
      var d = this.data;
      var sb = d.settings.baby;
      if (!sb || typeof sb !== 'object') return;
      var b = this.activeBaby();
      if (!b) {
        if (!d.babies.length) {
          b = { id: newUuid(), name: '宝宝', photo: null, birthDate: null };
          d.babies.push(b);
          d.settings.activeBabyId = b.id;
        } else {
          d.settings.activeBabyId = d.babies[0].id;
          b = d.babies[0];
        }
      }
      if (typeof sb.name === 'string' && sb.name.trim()) b.name = sb.name.trim().slice(0, 12);
      if (typeof sb.birthDate === 'string' || sb.birthDate === null) b.birthDate = sb.birthDate || null;
      b.nickname = (typeof sb.nickname === 'string') ? sb.nickname.trim().slice(0, 12) : '';
      b.sex = (sb.sex === 'girl' || sb.sex === 'boy') ? sb.sex : null;
      b.preterm = sb.preterm === true;
      b.birthGestWeeks = (typeof sb.birthGestWeeks === 'number') ? sb.birthGestWeeks : null;
      /* 农历生日只在公历生日没被别处改动时保留（生长/疫苗页改了公历生日 → 农历失效） */
      var bl = cleanLunar(sb.birthLunar);
      if (bl && global.Lunar && Lunar.ok && b.birthDate && Lunar.toSolar(bl.y, bl.m, bl.d, bl.leap) !== b.birthDate) bl = null;
      b.birthLunar = bl;
      sb.birthLunar = bl;
      b.hasProfile = true;
    },

    /** 第 212 次：改档案资料（名字/小名/生日/农历/性别）；当前宝宝同步镜像 */
    updateBaby: function (id, f) {
      var b = (this.data.babies || []).filter(function (x) { return x.id === id; })[0];
      if (!b || !f) return false;
      if (b.id === this.data.settings.activeBabyId) this.syncBabyFromSettings();
      if ('name' in f) b.name = (typeof f.name === 'string' && f.name.trim()) ? f.name.trim().slice(0, 12) : '宝宝';
      if ('nickname' in f) b.nickname = (typeof f.nickname === 'string') ? f.nickname.trim().slice(0, 12) : '';
      if ('birthDate' in f) b.birthDate = (typeof f.birthDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f.birthDate)) ? f.birthDate : null;
      if ('birthLunar' in f) b.birthLunar = cleanLunar(f.birthLunar);
      if ('sex' in f) b.sex = (f.sex === 'girl' || f.sex === 'boy') ? f.sex : null;
      b.hasProfile = true;
      if (b.id === this.data.settings.activeBabyId) this._mirrorActive();
      this.save();
      return true;
    },

    /** 第 212 次：宝宝显示名——小名优先，其次名字，都没有才叫「宝宝」 */
    babyLabel: function (b) {
      b = b || this.activeBaby();
      var sb = (this.data && this.data.settings && this.data.settings.baby) || {};
      var isAct = b && this.data && b.id === this.data.settings.activeBabyId;
      var nick = (b && b.nickname) || ((!b || isAct) ? sb.nickname : '') || '';
      if (!b && sb.name && sb.name !== '宝宝' && !nick) return String(sb.name);
      if (nick) return String(nick);
      if (b && b.name && b.name !== '宝宝') return b.name;
      return '宝宝';
    },

    /** 清空全部数据 */
    reset: function () {
      this.data = defaultData();
      Meta.suppressTombs = true;   /* 第 332 次：清空只是本机重置，不能把全家的记录一起删掉 */
      this.save();
    },

    /** 导出为格式化的 JSON 文本 */
    exportJSON: function (opts) {
      /* 第 332 次：导出文件里不放任何家庭信息——家庭密钥 / token / familyId 本来就不在 data 里（在 IndexedDB），
         这里再把记录上的家人设备 ID（by = 'd_…'）统一换成 'fam'（导入后显示「家人记」），不留可关联到家庭的标识 */
      var out = this._exportCopy(opts);
      return JSON.stringify(out, null, 2);
    },
    _exportCopy: function (opts) {
      var c = JSON.parse(JSON.stringify(this.data));
      var fix = function (o) { if (o && typeof o.by === 'string' && /^d_/.test(o.by)) o.by = 'fam'; };
      Meta.walk(c, function (scope, type, id, kind, r) { if (kind !== 'map') fix(r); });
      (c.tombs || []).forEach(fix);
      Object.keys(c.mapMeta || {}).forEach(function (k) { fix(c.mapMeta[k]); });
      if (opts && opts.excludePrivate) { c.moods = []; c.periods = []; c.finance = { records: [] }; c._exportNote = 'excludePrivate'; }
      return c;
    },
    /** 从 JSON 文本导入（逐字段清洗，坏字段回退默认而非搞坏整个应用） */
    /**
     * 第 187 次（P0：增量导入）：把备份文件「合并」进本机，而不是覆盖。
     * 第 333 次：宝宝只按 uuid 对应——
     *   · 同 uuid → 合并进本机这个宝宝：记录按「宝宝 uuid + 类型 + id」去重，两边都有的同一条按 updatedAt 新者胜；
     *   · uuid 不同 → 一律作为新宝宝档案导入，即使同名同生日也绝不按名字合并（预览里提示「这是另一个宝宝档案」）；
     *   · 旧版备份里的旧短 id 先按第 332 次同一规则 sha256('yiya-baby|' + 旧 id) 换成 uuid 再比，所以自己的旧备份照样对得上；
     *   · 第 80 次以前（还没有宝宝档案）的备份没有 id 可比：按文件内容确定性地生成 uuid，重复导入落到同一个档案里，不会越导越多；
     *   · 本机一个宝宝都没有（新手机 / 清空后）：导入的宝宝按原 uuid 加进来，第一个成为当前宝宝。
     * 家庭共享：只动 data（宝宝档案 + 记录），家庭密钥 / token / familyId 本来就不在 data 里；新导入的宝宝不进共享清单
     *   （共享清单在 FamSync 自己的存储里，这里不碰）。
     * 疫苗/儿保已完成按剂次 key 只补缺；进行中的计时（openSleep 等）一律保留本机的。
     * opts.dryRun=true 时只算会新增 / 更新多少，不改本机（导入预览用）。
     * 返回 { total, added, updated, parts: [{ name, n }], newBabies, babies: [{ id, name, mode:'merge'|'new', n }], sameNameOther: [name] }。
     */
    mergeJSON: function (text, opts) {
      opts = opts || {};
      var parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('数据格式错误');
      var preBabies = !Array.isArray(parsed.babies) || !parsed.babies.length;
      var keep = this.data;
      var inc;
      try {
        this.data = sanitize(parsed);
        this._noSnapshot = true;
        this.migrate();
        Meta.migrate(this.data);   /* 第 332 次：文件里的旧宝宝 id 按同一规则换成 uuid，才能和本机迁移过的 id 对上 */
        inc = this.data;
      } finally { this._noSnapshot = false; this.data = keep; }
      /* 第 80 次以前的备份：迁移时现播种的宝宝 id 是随机的，换成按内容确定的 uuid（同一文件导几次都一样） */
      if (preBabies && (inc.babies || []).length === 1) {
        var ob0 = inc.babies[0], oldId = ob0.id;
        ob0.id = uuidFrom('yiya-baby|legacy|' + (ob0.name || '') + '|' + (ob0.birthDate || '') + '|' + ((inc.feedings || [])[0] ? (inc.feedings[0].id || inc.feedings[0].time || '') : ''));
        if (inc.settings && inc.settings.activeBabyId === oldId) inc.settings.activeBabyId = ob0.id;
      }
      var cur = opts.dryRun ? sanitize(JSON.parse(JSON.stringify(keep))) : keep;
      var counts = {}, nAdd = 0, nUpd = 0;
      function bump(k, n) { if (n) counts[k] = (counts[k] || 0) + n; }
      function fp(x) { try { return JSON.stringify(x); } catch (e) { return String(Math.random()); } }
      function newer(a, b) { var au = +a.updatedAt, bu = +b.updatedAt; return isFinite(au) && (!isFinite(bu) || au > bu); }
      function strip(x) { var c = JSON.parse(JSON.stringify(x)); if (c && typeof c.by === 'string' && /^d_/.test(c.by)) c.by = 'fam'; return c; }
      /* 有 id：同 id 两边都有 → updatedAt 新者胜（文件更新就替换，否则不动）；本机没有 → 加；没 id 的老记录按整条内容去重 */
      function mergeArr(dst, src) {
        if (!Array.isArray(src) || !src.length) return 0;
        var ids = {}, fps = {}, n = 0;
        dst.forEach(function (x, i) { if (x && x.id != null) ids[x.id] = i + 1; else fps[fp(x)] = 1; });
        src.forEach(function (x) {
          if (!x || typeof x !== 'object') return;
          if (x.id != null) {
            var at = ids[x.id];
            if (at) {
              var y = dst[at - 1];
              if (y && y !== x && newer(x, y) && contentHash(x) !== contentHash(y)) { dst[at - 1] = strip(x); n++; nUpd++; }
              return;
            }
            ids[x.id] = dst.length + 1;
          } else { var f = fp(x); if (fps[f]) return; fps[f] = 1; }
          dst.push(strip(x)); n++; nAdd++;
        });
        return n;
      }
      function mergeMap(dst, src) {
        var n = 0;
        if (!src || typeof src !== 'object') return 0;
        Object.keys(src).forEach(function (k) { if (dst[k] == null && src[k] != null) { dst[k] = src[k]; n++; nAdd++; } });
        return n;
      }
      var LABEL = { feedings: '喂养', sleeps: '睡眠', diapers: '尿布', growth: '生长', meds: '吃药', milestones: '里程碑',
        milestoneObs: '发育观察', temps: '体温', baths: '洗澡', swims: '游泳', suns: '日晒', waters: '饮水', jaundices: '黄疸',
        supplements: '营养品服用', supplementPlans: '营养品', periods: '经期', contractions: '宫缩', fetal: '胎动',
        fetalSessions: '胎动计数', laborEvents: '破水见红', milkStash: '储奶', moods: '情绪', supplies: '囤货', sicks: '生病' };
      var ARR_BABY = BABY_KEYS.filter(function (k) { return ARRAY_KEYS.indexOf(k) >= 0; });
      function mergeBaby(dst, src) {
        ARR_BABY.forEach(function (k) {
          if (!Array.isArray(dst[k])) dst[k] = [];
          bump(LABEL[k] || k, mergeArr(dst[k], src[k]));
        });
        ['vaccines', 'checkups'].forEach(function (k) {
          var sv = src[k]; if (!sv || typeof sv !== 'object') return;
          if (!dst[k] || typeof dst[k] !== 'object') dst[k] = { done: {} };
          if (!dst[k].done || typeof dst[k].done !== 'object') dst[k].done = {};
          bump(k === 'vaccines' ? '疫苗' : '儿保', mergeMap(dst[k].done, sv.done));
          if (k === 'vaccines') {
            if (Array.isArray(sv.subs)) { if (!Array.isArray(dst.vaccines.subs)) dst.vaccines.subs = []; bump('自费疫苗', mergeArr(dst.vaccines.subs, sv.subs)); }
            if (sv.via && typeof sv.via === 'object') { if (!dst.vaccines.via || typeof dst.vaccines.via !== 'object') dst.vaccines.via = {}; mergeMap(dst.vaccines.via, sv.via); }
            /* 第 199 次：接种详情按剂次合并（本机已有的不覆盖） */
            if (sv.notes && typeof sv.notes === 'object' && !Array.isArray(sv.notes)) { if (!dst.vaccines.notes || typeof dst.vaccines.notes !== 'object') dst.vaccines.notes = {}; mergeMap(dst.vaccines.notes, sv.notes); }
          }
        });
      }
      /* 妈妈 / 全家层 */
      ARRAY_KEYS.forEach(function (k) {
        if (k === 'babies' || BABY_KEYS.indexOf(k) >= 0) return;
        if (!Array.isArray(cur[k])) cur[k] = [];
        bump(LABEL[k] || k, mergeArr(cur[k], inc[k]));
      });
      [['prenatal', 'records', '产检记录'], ['prenatal', 'checks', '产检备注'], ['prenatal', 'visits', '产检'], ['finance', 'records', '记账'],
        ['packing', 'items', '待产包'], ['pregnancy', 'weights', '孕期体重']].forEach(function (t) {
        var so = inc[t[0]]; if (!so || !Array.isArray(so[t[1]])) return;
        if (!cur[t[0]] || typeof cur[t[0]] !== 'object') cur[t[0]] = {};
        if (!Array.isArray(cur[t[0]][t[1]])) cur[t[0]][t[1]] = [];
        bump(t[2], mergeArr(cur[t[0]][t[1]], so[t[1]]));
      });
      if (inc.prenatal && inc.prenatal.plan && typeof inc.prenatal.plan === 'object') {
        if (!cur.prenatal.plan || typeof cur.prenatal.plan !== 'object') cur.prenatal.plan = {};
        bump('产检预约', mergeMap(cur.prenatal.plan, inc.prenatal.plan));
      }
      /* 第 192 次：预产期按「一组」合并——本机两项都空才整组（lmp + dueDate + dateBasis）取导入的；
         旧写法逐项补空，本机只有 LMP、导入只有预产期时会拼出两个互相矛盾的日期。 */
      if (cur.pregnancy && inc.pregnancy && !cur.pregnancy.lmp && !cur.pregnancy.dueDate && (inc.pregnancy.lmp || inc.pregnancy.dueDate)) {
        cur.pregnancy.lmp = inc.pregnancy.lmp || null; cur.pregnancy.dueDate = inc.pregnancy.dueDate || null;
        cur.pregnancy.dateBasis = inc.pregnancy.dateBasis || null;
        bump('预产期', 1);
      }
      /* 宝宝层（第 333 次：只按 uuid） */
      var incBabies = (inc.babies || []).filter(function (b) { return b && typeof b.id === 'string'; });
      var incAct = inc.settings && inc.settings.activeBabyId;
      function incDataOf(b) { return (b.id === incAct || !b.rec) ? pickBaby(inc) : b.rec; }
      if (!cur.settings || typeof cur.settings !== 'object') cur.settings = defaultData().settings;
      var curBabies = Array.isArray(cur.babies) ? cur.babies : (cur.babies = []);
      var curAct = cur.settings.activeBabyId;
      var hasAct = curBabies.some(function (b) { return b && b.id === curAct; });
      var newBabies = 0, babyRes = [], sameName = [];
      function recCount(src) { var n = 0; ARR_BABY.forEach(function (k) { if (Array.isArray(src[k])) n += src[k].length; }); return n; }
      /* 文件里没有宝宝档案、记录却在顶层（删光档案后导出的）：按内容定一个确定性的 uuid，当一个宝宝导入 */
      if (!incBabies.length && recCount(pickBaby(inc))) {
        var t0 = pickBaby(inc), f0 = (t0.feedings || [])[0] || (t0.diapers || [])[0] || (t0.sleeps || [])[0] || {};
        incBabies = [{ id: uuidFrom('yiya-baby|legacy|top|' + (f0.id || f0.time || f0.start || '')), name: '宝宝', birthDate: null }];
      }
      incBabies.forEach(function (ib) {
        var src = incDataOf(ib);
        var hit = curBabies.filter(function (b) { return b && b.id === ib.id; })[0];
        if (hit) {
          var c0 = nAdd + nUpd;
          mergeBaby(hit.id === curAct || !hit.rec ? cur : hit.rec, src);
          if (!hit.birthDate && ib.birthDate) hit.birthDate = ib.birthDate;
          babyRes.push({ id: ib.id, name: hit.name || ib.name || '宝宝', mode: 'merge', n: nAdd + nUpd - c0 });
          return;
        }
        var nm = String(ib.name || '宝宝');
        var twin = curBabies.filter(function (b) { return b && (b.name || '宝宝') === nm; })[0];
        if (twin && sameName.indexOf(nm) < 0) sameName.push(nm);
        var nRec = recCount(src);
        /* 文件里只有空档案（没有记录）且本机已有宝宝：不凭空加一个空的同名档案 */
        if (!nRec && hasAct && twin) { babyRes.push({ id: ib.id, name: nm, mode: 'skip', n: 0 }); return; }
        var nb = { id: ib.id, name: nm.slice(0, 12), photo: ib.photo || null, birthDate: ib.birthDate || null };
        ['nickname', 'sex', 'preterm', 'birthGestWeeks', 'birthLunar'].forEach(function (k) { if (ib[k] != null) nb[k] = ib[k]; });
        if (!hasAct) {
          /* 本机还没有宝宝：这个宝宝直接成为当前宝宝，记录进顶层（新手机恢复备份） */
          curBabies.push(nb); cur.settings.activeBabyId = nb.id; curAct = nb.id; hasAct = true;
          mergeBaby(cur, src);
          if (nb.birthDate && cur.settings.baby && typeof cur.settings.baby === 'object') { cur.settings.baby.birthDate = nb.birthDate; if (!cur.settings.baby.name) cur.settings.baby.name = nb.name; }
        } else {
          nb.rec = {};
          var def = defaultData(); BABY_KEYS.forEach(function (k) { nb.rec[k] = JSON.parse(JSON.stringify(def[k])); });
          ARR_BABY.forEach(function (k) { nb.rec[k] = Array.isArray(src[k]) ? src[k].map(strip) : []; });
          ['vaccines', 'checkups'].forEach(function (k) { if (src[k] && typeof src[k] === 'object') nb.rec[k] = JSON.parse(JSON.stringify(src[k])); });
          curBabies.push(nb);
          nAdd += nRec; bump('新宝宝档案的记录', nRec);
        }
        newBabies++;
        babyRes.push({ id: ib.id, name: nm, mode: 'new', n: nRec });
      });
      cur.babies = curBabies;
      if (cur.settings && cur.settings.baby && !cur.settings.baby.birthDate) {
        var ab = curBabies.filter(function (b) { return b.id === curAct; })[0];
        if (ab && ab.birthDate) cur.settings.baby.birthDate = ab.birthDate;
      }
      var parts = Object.keys(counts).map(function (k) { return { name: k, n: counts[k] }; })
        .sort(function (a, b) { return b.n - a.n; });
      var total = parts.reduce(function (s2, p) { return s2 + p.n; }, 0);
      if (!opts.dryRun) {
        this.data = sanitize(JSON.parse(JSON.stringify(cur)));
        this.data.version = keep.version;
        Meta.migrate(this.data);
        this.save();
      }
      return { total: total, added: nAdd, updated: nUpd, parts: parts, newBabies: newBabies, babies: babyRes, sameNameOther: sameName };
    },

    importJSON: function (text) {
      var parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('数据格式错误');
      this.data = sanitize(parsed);
      this.migrate(); /* 第 80 次：旧版本导出文件导入时补跑迁移（播种宝宝档案） */
      Meta.migrate(this.data); /* 第 332 次：导入时保持文件里的 uuid；旧文件按同一规则迁移 */
      Meta.suppressTombs = true;   /* 整体覆盖：本机原有、文件里没有的条目只是本机不要了，不发删除给家人 */
      this.save();
    },

    /**
     * 版本迁移脚手架：按 version 逐步升级旧数据。
     * 新增结构变更时，在这里追加 if (v < N) { ...; v = N } 即可。
     *
     * U-15：迁移前先把当前数据落一份本地快照，迁移中若抛错则用快照回滚，
     * 不让「升级」变成「丢数据」；快照保留最近 2 个版本，其余清理。
     */
    migrate: function () {
      var v = this.data.version || 1;
      if (v >= DATA_VERSION) { this.data.version = DATA_VERSION; return true; }
      var snapshot = null;
      try {
        snapshot = JSON.stringify(this.data);
        /* 第 187 次：合并导入时迁移的是「文件里的数据」，不写回滚快照（那不是本机数据） */
        if (!this._noSnapshot) localStorage.setItem(SNAPSHOT_PREFIX + v, snapshot);
        this._pruneSnapshots();
      } catch (e) { /* 快照写不进去（配额满）不阻断迁移，仅记录 */ }
      try {
        if (v < 2) { v = 2; }
        /* 第 80 次（宝宝档案）v2→v3：把旧 settings.baby 播种成第一个宝宝档案。
           一次性迁移：babiesSeeded 标记防止「删除全部档案后被重新播回来」；
           旧 settings.baby 原样保留（仍是各模块读取的现役宝宝字段，见 syncBabyFromSettings）。 */
        if (v < 3) {
          if (!this.data.settings.babiesSeeded) {
            var ob = this.data.settings.baby;
            if (ob && typeof ob === 'object' && !Array.isArray(ob)) {
              this.data.babies.push({
                id: newUuid(),
                name: (typeof ob.name === 'string' && ob.name.trim()) ? ob.name.trim().slice(0, 12) : '宝宝',
                photo: null,
                birthDate: (typeof ob.birthDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ob.birthDate)) ? ob.birthDate : null
              });
              this.data.settings.activeBabyId = this.data.babies[0].id;
            }
            this.data.settings.babiesSeeded = true;
          }
          v = 3;
        }
        /* 第 146 次 v3→v4：多宝宝数据隔离。旧版所有记录都在同一条时间线上，
           迁移时全部归给当前宝宝（数据本就在顶层，无需搬动）；其他宝宝从空白开始。
           迁移前已自动落快照（momhelper_snapshot_v3），可回滚。 */
        if (v < 4) {
          var actId = this.data.settings.activeBabyId;
          if (!actId && this.data.babies.length) this.data.settings.activeBabyId = this.data.babies[0].id;
          v = 4;
        }
        this.data.version = v;
        this._migrateFailed = false;
        return true;
      } catch (e) {
        /* 回滚：迁移失败就回到快照状态，宁可停用新结构也不丢数据 */
        this._migrateFailed = true;
        try { if (snapshot) this.data = sanitize(JSON.parse(snapshot)); } catch (e2) {}
        return false;
      }
    },

    /** 只保留最近 2 个迁移快照，避免快照本身吃配额 */
    _pruneSnapshots: function () {
      try {
        var keys = storageKeys().filter(function (k) { return k.indexOf(SNAPSHOT_PREFIX) === 0; });
        keys.sort();
        while (keys.length > 2) { localStorage.removeItem(keys.shift()); }
      } catch (e) {}
    },

    /** 是否存在可回滚的迁移快照（设置页如实展示用） */
    snapshotCount: function () {
      try {
        return storageKeys().filter(function (k) { return k.indexOf(SNAPSHOT_PREFIX) === 0; }).length;
      } catch (e) { return 0; }
    },

    /** 本机占用估算（U-34）：返回 { chars, pct, nearLimit, level }，只提醒不阻断 */
    usage: function () {
      var chars = 0;
      try {
        storageKeys().forEach(function (k) {
          var v = localStorage.getItem(k);
          chars += k.length + (v ? v.length : 0);
        });
      } catch (e) {}
      var pct = Math.min(100, Math.round(chars / QUOTA_CHARS * 100));
      return {
        chars: chars,
        pct: pct,
        nearLimit: pct >= NEAR_LIMIT_PCT,
        level: pct >= 95 ? 'critical' : (pct >= NEAR_LIMIT_PCT ? 'near' : 'ok')
      };
    },

    /** 数据是否「有内容」（任一记录数组非空）——供备份提醒判断 */
    hasData: function () {
      var d = this.data;
      if (!d) return false;
      return ARRAY_KEYS.some(function (k) { return (d[k] || []).length > 0; })
        || (d.packing && d.packing.items && d.packing.items.length > 0)
        || (d.finance && d.finance.records && d.finance.records.length > 0)
        || (d.prenatal && d.prenatal.records && d.prenatal.records.length > 0) || (d.prenatal && Array.isArray(d.prenatal.visits) && d.prenatal.visits.length > 0);
    },

    /** 第 74 次（G1）：损坏备份状态查询——设置页「数据与备份」常驻状态行消费 */
    corruptBackupInfo: function () {
      try {
        var v = localStorage.getItem(CORRUPT_BACKUP_KEY);
        return { exists: v != null, chars: v ? v.length : 0 };
      } catch (e) { return { exists: false, chars: 0 }; }
    },

    /** 各模块记录数统计（设置页用） */
    /* 第 273 次（审计 #16）：所有「记录列表」型的顶层键（ARRAY_KEYS 去掉多宝宝档案 babies），导入覆盖前计数用 */
    RECORD_KEYS: ARRAY_KEYS.filter(function (k) { return k !== 'babies'; }),
    stats: function () {
      var d = this.data || {};
      return [
        { key: 'feeding', name: '喂养', count: (d.feedings || []).length },
        { key: 'diaper', name: '尿布', count: (d.diapers || []).length },
        { key: 'sleep', name: '睡眠', count: (d.sleeps || []).length },
        { key: 'growth', name: '生长', count: (d.growth || []).length },
        { key: 'vaccine', name: '疫苗', count: (d.vaccines && d.vaccines.done ? Object.keys(d.vaccines.done).length : 0) },
        { key: 'checkup', name: '儿保体检', count: (d.checkups && d.checkups.done ? Object.keys(d.checkups.done).length : 0) },
        { key: 'meds', name: '吃药/维D', count: (d.meds || []).length },
        { key: 'milestone', name: '里程碑', count: (d.milestones || []).length },
        { key: 'sick', name: '生病记录', count: (d.sicks || []).length },
        { key: 'period', name: '经期', count: (d.periods || []).length },
        { key: 'contraction', name: '宫缩', count: (d.contractions || []).length },
        { key: 'fetal', name: '胎动', count: (d.fetal || []).length },
        { key: 'temp', name: '体温', count: (d.temps || []).length },
        { key: 'mood', name: '妈妈情绪', count: (d.moods || []).length },
        { key: 'packing', name: '待产包', count: (d.packing && d.packing.items ? d.packing.items.length : 0) },
        { key: 'finance', name: '记账', count: (d.finance && d.finance.records ? d.finance.records.length : 0) },
        { key: 'pregnancy', name: '产检', count: (d.prenatal && d.prenatal.records ? d.prenatal.records.length : 0) + (d.prenatal && Array.isArray(d.prenatal.visits) ? d.prenatal.visits.length : 0) }
      ];
    }
  };

  /* 第 74 次（G2）：双标签覆盖防护。
     localStorage 的 storage 事件只在「其他标签页」写入时触发（本页自己写不触发），
     事件到达时对方已落盘、本页内存里还是旧数据——本页下一次保存就会静默覆盖对方。
     这里不自动同步（自动替换会打断正在填写的表单），只做节流告警：
     60 秒内最多提醒一次，引导「刷新本页或只保留一个标签」。 */
  var CROSS_TAB_THROTTLE = 60000;
  var lastCrossTabWarn = 0;
  try {
    if (typeof global.addEventListener === 'function') {
      global.addEventListener('storage', function (e) {
        if (!e || e.key !== STORAGE_KEY || !Storage.data) return;
        var mine = null;
        try { mine = JSON.stringify(Storage.data); } catch (err) { return; }
        if (e.newValue === mine) return;
        var now = Date.now();
        if (now - lastCrossTabWarn < CROSS_TAB_THROTTLE) return;
        lastCrossTabWarn = now;
        if (global.Util && Util.toast) {
          Util.toast('检测到数据在另一个标签页被修改：请刷新本页，或只保留一个标签，以免相互覆盖。', 'error');
        }
      });
    }
  } catch (e) { /* 老环境不支持该事件则无防护，其余功能不受影响 */ }

  global.Storage = Storage;
})(window);
