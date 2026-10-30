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
        /* 第 100 次：底栏五口集中排列——normal=居中横排（默认）/ left=左下竖排 /
           right=右下竖排。left/right 时首页、日期记录、快记加号、宝宝切换、设置
           五个入口全部收进屏幕同侧一根竖排胶囊。取代第 87 次只镜像快记钮的
           leftHand（旧值 true 迁移为 'left'；该字段当时未入白名单，本就不落盘）。 */
        handMode: 'normal',
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
      whitenoise: { playing: false, type: 'pink', volume: 3, minutes: 20, until: null, linkSleep: false }
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
      if (typeof s.keepAwake === 'boolean') base.settings.keepAwake = s.keepAwake; /* 第 194 次：计时常亮 */
      /* 第 97 次：底栏快捷槽位（字符串或 null；渲染时校验模块存在，随导入导出带走） */
      if (typeof s.dockSlot === 'string' || s.dockSlot === null) base.settings.dockSlot = s.dockSlot;
      /* 第 286 次：日期页快捷条（'auto' 或最多 5 个 [a-z] 模块 id；其余回默认） */
      if (s.calQuick === 'auto') base.settings.calQuick = 'auto';
      else if (Array.isArray(s.calQuick)) base.settings.calQuick = s.calQuick.filter(function (x) { return typeof x === 'string' && /^[a-z]{2,16}$/.test(x); }).slice(0, 5);
      /* 第 100 次：底栏五口排列模式（三值枚举；旧 leftHand=true 迁移为 'left'，随导入导出带走） */
      if (s.handMode === 'left' || s.handMode === 'right' || s.handMode === 'normal') base.settings.handMode = s.handMode;
      else if (s.leftHand === true) base.settings.handMode = 'left';
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

  var Storage = {
    data: null,

    /** 从 localStorage 读取；缺失用默认值；损坏则备份原文后回退默认值 */
    load: function () {
      var raw = null;
      try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
      if (!raw) { this.data = defaultData(); return this.data; }
      try {
        this.data = sanitize(JSON.parse(raw));
        this.migrate();
        this._supDedupe();
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
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
        if (global.Util && Util.haptic) Util.haptic('ok');
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
        id: 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
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
          b = { id: 'b' + Date.now().toString(36), name: '宝宝', photo: null, birthDate: null };
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
      this.save();
    },

    /** 导出为格式化的 JSON 文本 */
    exportJSON: function (opts) {
      /* 第 202 次：opts.excludePrivate —— 给家人 / 医生的副本，去掉妈妈的情绪、经期、记账。
         只清空这三项，结构保持完整，对方导入（默认合并）不会动到他本机这几项。 */
      if (opts && opts.excludePrivate) {
        var c = JSON.parse(JSON.stringify(this.data));
        c.moods = []; c.periods = []; c.finance = { records: [] };
        c._exportNote = 'excludePrivate';
        return JSON.stringify(c, null, 2);
      }
      return JSON.stringify(this.data, null, 2);
    },

    /** 从 JSON 文本导入（逐字段清洗，坏字段回退默认而非搞坏整个应用） */
    /**
     * 第 187 次（P0：增量导入）：把备份文件「合并」进本机，而不是覆盖。
     * 规则：只加本机没有的——有 id 的按 id 去重，没 id 的按整条内容去重；
     *       疫苗/儿保已完成按剂次 key 只补缺；进行中的计时（openSleep 等）一律保留本机的。
     * 宝宝对应：同 id → 同名同生日 → 双方都只有一个宝宝时视为同一个 → 否则作为新档案加入。
     * opts.dryRun=true 时只算「会新增多少」，不改本机（导入预览用）。
     * 返回 { total, parts: [{ name, n }], newBabies }。
     */
    mergeJSON: function (text, opts) {
      opts = opts || {};
      var parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('数据格式错误');
      var keep = this.data;
      var inc;
      try {
        this.data = sanitize(parsed);
        this._noSnapshot = true;
        this.migrate();
        inc = this.data;
      } finally { this._noSnapshot = false; this.data = keep; }
      var cur = opts.dryRun ? sanitize(JSON.parse(JSON.stringify(keep))) : keep;
      var counts = {};
      function bump(k, n) { if (n) counts[k] = (counts[k] || 0) + n; }
      function fp(x) { try { return JSON.stringify(x); } catch (e) { return String(Math.random()); } }
      function mergeArr(dst, src) {
        if (!Array.isArray(src) || !src.length) return 0;
        var ids = {}, fps = {}, n = 0;
        dst.forEach(function (x) { if (x && x.id != null) ids[x.id] = 1; else fps[fp(x)] = 1; });
        src.forEach(function (x) {
          if (!x || typeof x !== 'object') return;
          if (x.id != null) { if (ids[x.id]) return; ids[x.id] = 1; }
          else { var f = fp(x); if (fps[f]) return; fps[f] = 1; }
          dst.push(JSON.parse(JSON.stringify(x))); n++;
        });
        return n;
      }
      function mergeMap(dst, src) {
        var n = 0;
        if (!src || typeof src !== 'object') return 0;
        Object.keys(src).forEach(function (k) { if (dst[k] == null && src[k] != null) { dst[k] = src[k]; n++; } });
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
      /* 宝宝层 */
      var incBabies = (inc.babies || []).slice();
      var incAct = inc.settings && inc.settings.activeBabyId;
      function incDataOf(b) { return (b.id === incAct || !b.rec) ? pickBaby(inc) : b.rec; }
      if (!incBabies.length) incBabies = [{ id: null, name: '', birthDate: null, _top: true }];
      var curBabies = cur.babies || [];
      var curAct = cur.settings && cur.settings.activeBabyId;
      var newBabies = 0;
      /* 第 286 次（数据管理半屏）：opts.target 指定文件里「当前宝宝」那一份记录去哪：
         'current' = 合并进本机当前宝宝（按 id 去重）；'new' = 新建一个宝宝档案放进去。文件里的其他宝宝仍按下面的规则对应。 */
      var tgt = opts.target === 'current' || opts.target === 'new' ? opts.target : null;
      incBabies.forEach(function (ib) {
        var src = ib._top ? pickBaby(inc) : incDataOf(ib);
        if (tgt && (ib._top || ib.id === incAct || incBabies.length === 1)) {
          if (tgt === 'current') { mergeBaby(cur, src); return; }
          var fresh = { id: 'b' + Date.now().toString(36) + 'n' + newBabies, name: ib.name || '宝宝', photo: ib.photo || null,
            birthDate: ib.birthDate || null, rec: JSON.parse(JSON.stringify(src)) };
          curBabies.push(fresh); newBabies++;
          var nNew = 0;
          ARR_BABY.forEach(function (k) { if (Array.isArray(src[k])) nNew += src[k].length; });
          bump('新宝宝档案的记录', nNew);
          return;
        }
        var hit = curBabies.filter(function (b) { return ib.id && b.id === ib.id; })[0]
          || curBabies.filter(function (b) { return ib.name && b.name === ib.name && b.birthDate && b.birthDate === ib.birthDate; })[0]
          || ((incBabies.length === 1 && curBabies.length <= 1) ? (curBabies[0] || { id: curAct, _top: true }) : null);
        if (hit) {
          if (hit._top || hit.id === curAct || !hit.rec) mergeBaby(cur, src);
          else mergeBaby(hit.rec, src);
          if (!hit._top && !hit.birthDate && ib.birthDate) hit.birthDate = ib.birthDate;
        } else {
          var nb = { id: ib.id || ('b' + Date.now().toString(36) + newBabies), name: ib.name || '宝宝', photo: ib.photo || null,
            birthDate: ib.birthDate || null, rec: JSON.parse(JSON.stringify(src)) };
          if (curBabies.filter(function (b) { return b.id === nb.id; }).length) nb.id += 'm';
          curBabies.push(nb); newBabies++;
          var nRec = 0;
          ARR_BABY.forEach(function (k) { if (Array.isArray(src[k])) nRec += src[k].length; });
          bump('新宝宝档案的记录', nRec);
        }
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
        this.save();
      }
      return { total: total, parts: parts, newBabies: newBabies };
    },

    importJSON: function (text) {
      var parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('数据格式错误');
      this.data = sanitize(parsed);
      this.migrate(); /* 第 80 次：旧版本导出文件导入时补跑迁移（播种宝宝档案） */
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
                id: 'b' + Date.now().toString(36),
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
