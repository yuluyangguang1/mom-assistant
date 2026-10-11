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
  var DATA_VERSION = 3;

  /* 容量预警阈值（U-34）：多数浏览器 localStorage 上限约 5MB（UTF-16 计 5M 字符 ≈ 10MB 字节）。
     报告未给具体上限，故此处为设计判断：按 5MB 字符量估算，≥80% 视为「近上限」，
     只作为提醒，不阻断任何操作。 */
  var QUOTA_CHARS = 5 * 1024 * 1024;
  var NEAR_LIMIT_PCT = 80;

  /* 数组型字段（记录列表）。第 66 次：moods（妈妈情绪随记，F 线）
     第 80 次：babies（宝宝档案，多宝宝家庭切换） */
  var ARRAY_KEYS = ['periods', 'feedings', 'sleeps', 'contractions', 'growth', 'diapers', 'meds', 'milestones', 'milestoneObs', 'fetal', 'temps', 'moods', 'babies', 'supplies'];
  /* 对象型字段（嵌套容器） */
  var OBJECT_KEYS = ['pregnancy', 'prenatal', 'packing', 'finance', 'vaccines', 'checkups', 'metrics'];

  function defaultData() {
    return {
      version: DATA_VERSION,
      settings: {
        theme: 'light', privacyAccepted: false, baby: null, realRefraction: true,
        lastExportISO: null, backupSnoozeISO: null, exportNoticeShown: false, capSnoozeISO: null,
        /* 第 120 次（首页布局编辑）：null = 自动策展（阶段筛选 + 收敛，改动前行为）；
           用户在编辑模式改过之后才落 { v:1, items:[{id,size}], removed:[id] }。 */
        homeLayout: null,
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
        activeBabyId: null, babiesSeeded: false
      },
      /* 第 80 次（宝宝档案）：宝宝档案列表 { id, name, photo, birthDate }。
         photo 是本机压缩后的 dataURL（util.pickPhoto 统一压到 288px JPEG）。 */
      babies: [],
      periods: [],
      pregnancy: { lmp: null, dueDate: null, weights: [] },
      prenatal: { checks: [], records: [] },
      feedings: [],
      sleeps: [],
      openSleep: null,
      contractions: [],
      openContraction: null,
      growth: [],
      diapers: [],
      meds: [],
      milestones: [],
      /* 第 66 次（F 线）：妈妈情绪随记。{ id, time, level(1-5), note, tags[] }
         —— 第 71 次补默认值（当时只入了 ARRAY_KEYS，defaultData 漏了本键） */
      moods: [],
      /* 第 68 次（B2）：发育观察点自评标记。{ id('KN-O/W-月龄-序'), v(1=是/阳性,0=否), date } */
      milestoneObs: [],
      /* 胎动计数（对标 Cali 宝宝补齐的孕期刚需，2026-09-27）：{ id, time } */
      fetal: [],
      /* 第 107 次：消耗品与补货提醒。{ id, name, cat, date, price, availDays, qty, unit, history[] }
         起因是参考实现在真实使用中 54 行里出现 21 行重复（同「名称+购买日期」）。
         availDays 语义 = 这一行总共还剩多少天；剩余天数是渲染期派生量，不落库。
         history 每次新购追加一条，最多 10 条。写入前按「名称+购买日期」查重，
         命中改为累加 qty / availDays / history，绝不新增第二行。 */
      supplies: [],
      /* 体温（对标 Cali 补齐，第 38 次）：{ id, time, value, note } */
      temps: [],
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
      if (s.baby && typeof s.baby === 'object') base.settings.baby = s.baby;
      if (typeof s.realRefraction === 'boolean') base.settings.realRefraction = s.realRefraction;
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
      /* 第 97 次：底栏快捷槽位（字符串或 null；渲染时校验模块存在，随导入导出带走） */
      if (typeof s.dockSlot === 'string' || s.dockSlot === null) base.settings.dockSlot = s.dockSlot;
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
      if (typeof s.activeBabyId === 'string' || s.activeBabyId === null) base.settings.activeBabyId = s.activeBabyId;
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
      /* 第 120 次（首页布局编辑）：homeLayout 白名单——不只放行，还要形状校验。
         id 只认小写字母/数字短串（与模块 id 同域），size 只认 s/l，
         条目数设上限（items ≤ 24 / removed ≤ 40），坏数据宁可丢弃不进内存。
         items 与 removed 全空等价于没编辑过 → 回落 null（自动策展）。 */
      if (s.homeLayout && typeof s.homeLayout === 'object' && !Array.isArray(s.homeLayout)) {
        var hlItems = [];
        (Array.isArray(s.homeLayout.items) ? s.homeLayout.items : []).slice(0, 24).forEach(function (it) {
          if (it && typeof it.id === 'string' && /^[a-z][a-z0-9-]{1,15}$/.test(it.id)
            && (it.size === 's' || it.size === 'l')
            && !hlItems.some(function (x) { return x.id === it.id; })) {
            hlItems.push({ id: it.id, size: it.size });
          }
        });
        var hlRemoved = [];
        (Array.isArray(s.homeLayout.removed) ? s.homeLayout.removed : []).slice(0, 40).forEach(function (id) {
          if (typeof id === 'string' && /^[a-z][a-z0-9-]{1,15}$/.test(id) && hlRemoved.indexOf(id) < 0) hlRemoved.push(id);
        });
        base.settings.homeLayout = (hlItems.length || hlRemoved.length)
          ? { v: 1, items: hlItems, removed: hlRemoved } : null;
      }
    }
    ARRAY_KEYS.forEach(function (k) {
      if (Array.isArray(raw[k])) {
        base[k] = raw[k].filter(function (r) { return r && typeof r === 'object' && !Array.isArray(r); });
      }
    });
    OBJECT_KEYS.forEach(function (k) {
      if (raw[k] && typeof raw[k] === 'object' && !Array.isArray(raw[k])) base[k] = raw[k];
    });
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
      var wn = raw.whitenoise, vt = ['white', 'pink', 'brown'];
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
    if (raw.openContraction && typeof raw.openContraction === 'object'
      && !isNaN(new Date(raw.openContraction.start).getTime())) base.openContraction = raw.openContraction;
    /* 第 80 次（宝宝档案）逐条清洗：id/name/photo/birthDate 形状合法才保留。
       photo 是 dataURL（pickPhoto 已在本机压到 288px），上限 30 万字符兜底防超配额；
       birthDate 只收 YYYY-MM-DD 形状。 */
    base.babies = (Array.isArray(raw.babies) ? raw.babies : []).filter(function (b) {
      return b && typeof b === 'object' && !Array.isArray(b) && typeof b.id === 'string' && b.id;
    }).map(function (b) {
      return {
        id: b.id.slice(0, 24),
        name: (typeof b.name === 'string' && b.name.trim()) ? b.name.trim().slice(0, 12) : '宝宝',
        photo: (typeof b.photo === 'string' && b.photo.indexOf('data:image/') === 0 && b.photo.length <= 300000) ? b.photo : null,
        birthDate: (typeof b.birthDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.birthDate)) ? b.birthDate : null
      };
    });
    /* activeBabyId 必须指向真实存在的档案，否则置空（导入/坏数据兜底） */
    if (base.settings.activeBabyId && !base.babies.some(function (b) { return b.id === base.settings.activeBabyId; })) {
      base.settings.activeBabyId = null;
    }
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
      this.data.settings.baby.name = b.name;
      this.data.settings.baby.birthDate = b.birthDate;
    },

    /** 切换当前宝宝（id 无效则不动作，返回 null） */
    switchBaby: function (id) {
      var d = this.data;
      var hit = (d.babies || []).filter(function (b) { return b.id === id; })[0];
      if (!hit) return null;
      d.settings.activeBabyId = id;
      this._mirrorActive();
      this.save();
      return hit;
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
        photo: (typeof opts.photo === 'string' && opts.photo.indexOf('data:image/') === 0) ? opts.photo : null,
        birthDate: (typeof opts.birthDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(opts.birthDate)) ? opts.birthDate : null
      };
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
        if (d.babies.length) this._mirrorActive();
        else d.settings.baby = null;
      }
      this.save();
      return true;
    },

    /** 重命名档案（改名后镜像同步） */
    renameBaby: function (id, name) {
      var b = (this.data.babies || []).filter(function (x) { return x.id === id; })[0];
      if (!b) return false;
      b.name = (typeof name === 'string' && name.trim()) ? name.trim().slice(0, 12) : '宝宝';
      if (b.id === this.data.settings.activeBabyId) this._mirrorActive();
      this.save();
      return true;
    },

    /** 给当前宝宝设置照片（dataURL；空串/null 表示清除，回退默认头像） */
    setActiveBabyPhoto: function (dataURL) {
      var b = this.activeBaby();
      if (!b) return false;
      b.photo = (typeof dataURL === 'string' && dataURL.indexOf('data:image/') === 0 && dataURL.length <= 300000) ? dataURL : null;
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
    },

    /** 清空全部数据 */
    reset: function () {
      this.data = defaultData();
      this.save();
    },

    /** 导出为格式化的 JSON 文本 */
    exportJSON: function () {
      return JSON.stringify(this.data, null, 2);
    },

    /** 从 JSON 文本导入（逐字段清洗，坏字段回退默认而非搞坏整个应用） */
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
        localStorage.setItem(SNAPSHOT_PREFIX + v, snapshot);
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
        || (d.prenatal && d.prenatal.records && d.prenatal.records.length > 0);
    },

    /** 第 74 次（G1）：损坏备份状态查询——设置页「数据与备份」常驻状态行消费 */
    corruptBackupInfo: function () {
      try {
        var v = localStorage.getItem(CORRUPT_BACKUP_KEY);
        return { exists: v != null, chars: v ? v.length : 0 };
      } catch (e) { return { exists: false, chars: 0 }; }
    },

    /** 各模块记录数统计（设置页用） */
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
        { key: 'period', name: '经期', count: (d.periods || []).length },
        { key: 'contraction', name: '宫缩', count: (d.contractions || []).length },
        { key: 'fetal', name: '胎动', count: (d.fetal || []).length },
        { key: 'temp', name: '体温', count: (d.temps || []).length },
        { key: 'mood', name: '妈妈情绪', count: (d.moods || []).length },
        { key: 'packing', name: '待产包', count: (d.packing && d.packing.items ? d.packing.items.length : 0) },
        { key: 'finance', name: '记账', count: (d.finance && d.finance.records ? d.finance.records.length : 0) },
        { key: 'pregnancy', name: '产检', count: (d.prenatal && d.prenatal.records ? d.prenatal.records.length : 0) }
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
