/**
 * supplies.js - 用品（第 107 次起；第 294 次重做为「货架 + 剩余数量 + 联动扣减」，见下方第 294 次说明）
 *
 * 起因：资料库「健康宝宝早教喂养台」的用品补货表实测 54 行里有 21 行重复
 * （唯一「名称+购买日期」组合仅 33 个，纸尿裤 L码 2026-08-30 有 5 条完全相同的行）。
 * 根因是它的 openSup 新增分支无条件 push，不做任何查重。
 * 本模块把这个教训直接写成硬约束：**写入前必须按「名称 + 购买日期」查重**，
 * 命中时改为累加库存与价格历史，绝不新增第二行。
 *
 * 落库：d.supplies = [{ id, name, cat, date, price, availDays, qty, unit, history: [] }]
 *   - date       首次购买日期（yyyy-mm-dd，本机时区，不用 toISOString）
 *   - availDays  语义 = 「这一行总共还剩多少天」，不是「这批能用几天」
 *   - history    每次新购追加一条，最多保留 10 条（防无限增长）
 *
 * 剩余天数全程为渲染期派生量，不落库：
 *   left = max(0, availDays - daysBetween(date, today))
 * 档位：<=3 该补货 / <=7 快用完 / 其余 充足
 *
 * 与硬约束的关系：
 *   - 只新增 d.supplies 键，不改任何已有字段结构
 *   - 「可用天数」是用户自己填的，不是人群参考值，不进 knowledge.js
 *   - 所有统计只与本机这条记录自身的购买日期比较，不与其他宝宝比较
 */
(function (global) {
  'use strict';
  var Storage = global.Storage, Util = global.Util;
  var Modules = global.Modules = global.Modules || {};

  /* 类别沿用记账模块的母婴口径（第 107 次）：把「用品」拆细到可单件追踪的粒度。
     纸尿裤/奶粉/清洁是消耗大头，也是最容易忘补货的三类，放最前。 */
  var CATS = ['纸尿裤', '奶粉', '清洁', '辅食', '维D/药品', '衣物', '玩具', '出行', '其他'];
  var UNITS = ['包', '罐', '瓶', '盒', '袋', '件', '个', '支'];

  /* 第 116 次（真机实测：消耗品要逐字手输太麻烦，没有模板可选）：
     按品类给一组常用物品，点一下即填「名称 + 单位 + 大致可用天数 + 数量」。
     依据与约束：
     - 只填【品类专属的默认】，不填价格。价格是每家每次的真实决策，猜不得；
       留着让用户自己敲，比给个错数字再改更省事。
     - 可用天数是「这一件大概能用多久」的经验值，填错也能直接在输入框改，
       它的作用是让新增表单在多数情况下【一次都不用动数字】。
     - 每类不超过 6 项，全部是母婴场景里真的高频复购的东西；
       刻意不给「其他」类配模板——那一类本来就没有可猜的默认值。
     - 模板是纯前端常量，不落库、不计入数据版本。 */
  var TEMPLATES = {
    '纸尿裤': [
      { n: '纸尿裤 NB', u: '包', d: 30, q: 1 },
      { n: '纸尿裤 S', u: '包', d: 30, q: 1 },
      { n: '纸尿裤 M', u: '包', d: 30, q: 1 },
      { n: '纸尿裤 L', u: '包', d: 30, q: 1 },
      { n: '拉拉裤 M', u: '包', d: 25, q: 1 },
      { n: '拉拉裤 L', u: '包', d: 25, q: 1 }
    ],
    '奶粉': [
      { n: '1段奶粉', u: '罐', d: 30, q: 1 },
      { n: '2段奶粉', u: '罐', d: 30, q: 1 },
      { n: '3段奶粉', u: '罐', d: 30, q: 1 }
    ],
    '清洁': [
      { n: '湿巾', u: '包', d: 30, q: 1 },
      { n: '云柔巾', u: '包', d: 60, q: 1 },
      { n: '婴儿洗衣液', u: '瓶', d: 45, q: 1 },
      { n: '护臀膏', u: '支', d: 90, q: 1 },
      { n: '爽身粉', u: '瓶', d: 60, q: 1 },
      { n: '消毒湿巾', u: '包', d: 30, q: 1 }
    ],
    '辅食': [
      { n: '高铁米粉', u: '盒', d: 45, q: 1 },
      { n: '果泥', u: '袋', d: 20, q: 1 },
      { n: '宝宝面条', u: '袋', d: 40, q: 1 }
    ],
    '维D/药品': [
      { n: '维生素D滴剂', u: '支', d: 30, q: 1 },
      { n: '钙剂', u: '支', d: 30, q: 1 },
      { n: '体温计', u: '个', d: 0, q: 1 }
    ],
    '衣物': [
      { n: '和尚服', u: '件', d: 60, q: 3 },
      { n: '连体衣', u: '件', d: 60, q: 3 },
      { n: '口水巾', u: '个', d: 90, q: 5 }
    ],
    '玩具': [
      { n: '牙胶', u: '个', d: 120, q: 1 },
      { n: '布书', u: '本', d: 0, q: 1 }
    ],
    '出行': [
      { n: '安全座椅', u: '个', d: 0, q: 1 },
      { n: '婴儿背带', u: '个', d: 0, q: 1 },
      { n: '便携餐椅', u: '个', d: 0, q: 1 }
    ],
    '其他': []
  };

  /* 档位阈值：剩余天数 <=3 提醒补货，<=7 提示快用完。硬编码但语义明确。 */
  var LOW_DAYS = 3;
  var MID_DAYS = 7;

  /* 价格历史上限：只留最近 10 条，避免同一条用品长期累积把存储撑大。 */
  var HISTORY_MAX = 10;

  /* ---------- 纯派生工具（不写库） ---------- */

  /* ---------- 第 226 次：按件计数 + 换尿布扣减（对标 Cali「扣减用品」） ----------
     可选字段 pieces = 还剩多少片/抽/个（非负整数）。填了它，这行就「可扣减」：
     记一次尿布时勾选的用品各减 1；改记录/删记录/撤销会原样退回。
     没填 pieces 的老数据完全照旧按天数算，不做任何迁移。
     剩余天数在有 pieces 时改用「近 7 天实际用量」估算，比手填天数准。 */
  var PIECES_MAX = 99999;
  function hasPieces(s) { return !!s && typeof s.pieces === 'number' && isFinite(s.pieces) && s.pieces >= 0; }
  /* 第 280 次：营养品页当场添加的用品带 pcsU（粒 / 片 / 颗 / 滴 / 包 / ml / 次，白名单），剩余数量按它写 */
  var PCS_U = ['粒', '片', '颗', '滴', '包', 'ml', '次', '个', '袋', '瓶', '罐', '盒', '支', '条', '抽', 'g'];
  function pcsUnit(s) {
    if (s && PCS_U.indexOf(s.pcsU) >= 0) return s.pcsU;
    return s && s.cat === '纸尿裤' ? '片' : (s && s.cat === '清洁' ? '抽' : '个');
  }
  function parsePieces(v) {
    var n = parseInt(v, 10);
    return (isNaN(n) || n < 0) ? null : Math.min(PIECES_MAX, n);
  }
  /** 近 7 天每天用掉几件：数尿布记录里 used 含这件的条数（只看当前宝宝的记录）。 */
  function dailyUse(id, d) {
    d = d || (Storage && Storage.get && Storage.get());
    var now = Date.now(), since = now - 7 * 864e5, n = 0, first = now;
    ((d && d.diapers) || []).forEach(function (r) {
      if (!r || !Array.isArray(r.used) || r.used.indexOf(id) < 0) return;
      var t = new Date(r.time).getTime();
      if (t >= since && t <= now + 60000) { n++; if (t < first) first = t; }
    });
    /* 第 280 次：营养品服用记录里扣过这件的（stock.n 件）也算用量 */
    ((d && d.supplements) || []).forEach(function (r) {
      if (!r || !r.stock || r.stock.id !== id) return;
      var t = new Date(r.time).getTime(), k = Number(r.stock.n);
      if (t >= since && t <= now + 60000 && k > 0 && k < 100) { n += Math.floor(k); if (t < first) first = t; }
    });
    /* 分母 = 窗口内第一次扣减到现在的天数（至少 1 天、最多 7 天）：刚开始用时不会被 ÷7 稀释成「够用 300 天」 */
    return n ? n / Math.max(1, Math.min(7, (now - first) / 864e5)) : 0;
  }
  /** 给一组 id 加减库存：delta=+1 扣一件，-1 退一件。返回真正动到的用品。 */
  function consume(d, ids, delta) {
    var touched = [];
    if (!d || !Array.isArray(d.supplies) || !Array.isArray(ids)) return touched;
    ids.forEach(function (id) {
      var it = d.supplies.filter(function (x) { return x && x.id === id; })[0];
      if (!hasPieces(it)) return;
      it.pieces = Math.max(0, Math.min(PIECES_MAX, it.pieces - delta));
      touched.push(it);
    });
    return touched;
  }

  /** 剩余天数：availDays 是「这行总共还剩多少天」，减去已过天数。
      第 226 次：有 pieces 且近 7 天有用量时，改为 片数 ÷ 日均用量。 */
  function supplyLeft(s) {
    if (!s) return 0;
    if (hasPieces(s)) {
      if (s.pieces === 0) return 0;
      var rate = dailyUse(s.id);
      if (rate > 0) return Math.floor(s.pieces / rate);
      /* 还没有用量数据：手填过天数就按天数；没填就按片数粗分档（≤10 该补货，≤30 快用完） */
      if (!(parseInt(s.availDays, 10) > 0)) return s.pieces <= 10 ? LOW_DAYS : (s.pieces <= 30 ? MID_DAYS : MID_DAYS + 23);
    }
    var total = parseInt(s.availDays, 10);
    if (isNaN(total) || total < 0) return 0;
    var used = Util.daysBetween(s.date, Util.todayISO());
    if (used < 0) used = 0; /* 日期填错到未来：按刚开始用算，不出现负数 */
    return Math.max(0, total - used);
  }

  /** 剩余天数 → 档位文案与配色 class。 */
  function supplyState(left) {
    if (left <= LOW_DAYS) return { text: '该补货', cls: 'sup-low' };
    if (left <= MID_DAYS) return { text: '快用完', cls: 'sup-mid' };
    return { text: '充足', cls: 'sup-ok' };
  }

  /** 需要补货的清单：剩余 <=3 天。渲染期汇总成顶部提醒条。 */
  function lowSupplies(list) {
    return (list || []).filter(function (s) { return supplyLeft(s) <= LOW_DAYS; });
  }

  /** 进度条百分比：剩余 / 总可用天数，钳到 5%–100% 让空条也看得见。 */
  function leftPercent(s) {
    /* 按件计数的行：以「够用 30 天」为满格 */
    if (hasPieces(s)) return Math.min(100, Math.max(5, Math.round(supplyLeft(s) / 30 * 100)));
    var total = parseInt(s.availDays, 10) || 0;
    if (total <= 0) return 5;
    var pct = Math.round(supplyLeft(s) / total * 100);
    return Math.min(100, Math.max(5, pct));
  }

  /* ---------- 查重：写库前唯一的入口守卫 ---------- */

  /**
   * 按「名称 + 购买日期」找已有行。
   * 名称去首尾空白后比较；日期必须是同一天。
   * 这一个函数决定了本模块不会像参考实现那样产生重复行。
   */
  function findDuplicate(list, name, date) {
    var target = String(name == null ? '' : name).trim();
    if (!target) return null;
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (!s) continue;
      if (String(s.name == null ? '' : s.name).trim() === target && s.date === date) return s;
    }
    return null;
  }

  /**
   * 新增或累加一件消耗品。查重命中时**不新增行**：
   *   - 库存 qty 累加
   *   - 可用天数按「新购一批」累加（沿用参考实现的 availDays 语义）
   *   - 价格历史追加一条
   * 返回 { item, merged }，merged=true 表示这次是并入已有行。
   */
  function upsertSupply(list, input) {
    var name = String(input.name == null ? '' : input.name).trim();
    if (!name) return { error: '请填写用品名称' };
    var date = input.date || Util.todayISO();
    var qty = parseInt(input.qty, 10);
    if (isNaN(qty) || qty < 0) qty = 1;
    var avail = parseInt(input.availDays, 10);
    if (isNaN(avail) || avail < 0) avail = 0;
    var price = parseFloat(input.price);
    if (isNaN(price) || price < 0) price = 0;
    var pcs = parsePieces(input.pieces);

    var dup = findDuplicate(list, name, date);
    if (dup) {
      /* 查重命中：并入已有行，绝不 push 第二条。
         可用天数按「这行总共还剩」累加——先取当前剩余，再加新批次。 */
      var left = supplyLeft(dup);
      dup.qty = (parseInt(dup.qty, 10) || 1) + qty;
      if (avail > 0) dup.availDays = left + avail;
      dup.date = date;
      if (price > 0) dup.price = price;
      if (input.unit) dup.unit = input.unit;
      if (input.cat) dup.cat = input.cat;
      if (pcs !== null) dup.pieces = Math.min(PIECES_MAX, (hasPieces(dup) ? dup.pieces : 0) + pcs);
      dup.history = pushHistory(dup.history, { date: date, price: price, qty: qty, unit: dup.unit || '' });
      return { item: dup, merged: true };
    }

    var item = {
      id: Util.uid(),
      name: name,
      cat: input.cat || CATS[0],
      date: date,
      price: price,
      availDays: avail,
      qty: qty,
      unit: input.unit || '件',
      history: pushHistory([], { date: date, price: price, qty: qty, unit: input.unit || '件' })
    };
    if (pcs !== null) item.pieces = pcs;
    list.push(item);
    return { item: item, merged: false };
  }

  /** 追加一条购买历史，unshift 新的在前，最多 10 条。 */
  function pushHistory(history, entry) {
    var h = Array.isArray(history) ? history.slice() : [];
    h.unshift(entry);
    if (h.length > HISTORY_MAX) h = h.slice(0, HISTORY_MAX);
    return h;
  }

  /* ---------- 第 112 次：记账↔消耗品联动 ---------- */

  /* 类别映射：消耗品的 9 类对应到记账的 10 类。
     探针实测（probe112a.js）：5 类可同名直连（纸尿裤/奶粉/衣物/玩具/其他），
     4 类需映射：
       清洁     → 用品   （湿巾、纸巾等清洁类都归「用品」）
       辅食     → 用品   （记账 CATS 没有「食品」桶，用「用品」最保守）
       维D/药品 → 药品   （同名语义）
       出行     → 用品   （推车、安全座椅等归「用品」）
     映射表必须覆盖 CATS 全部 9 项：漏一个就会掉进 fallback，
     而 fallback 落到「其他」会让统计失真——测试对此有硬断言。 */
  var CAT_TO_FINANCE = {
    '纸尿裤': '纸尿裤',
    '奶粉': '奶粉',
    '清洁': '用品',
    '辅食': '用品',
    '维D/药品': '药品',
    '衣物': '衣物',
    '玩具': '玩具',
    '出行': '用品',
    '其他': '其他'
  };

  /** 消耗品类别 → 记账类别。未知类别兜底「其他」，绝不返回 undefined。 */
  function toFinanceCat(cat) {
    return CAT_TO_FINANCE[cat] || '其他';
  }

  /**
   * 往记账推一条记录。**只 push，不改 finance 的存储结构**——
   * finance.records 的形状由 finance.js 定义（{id, amount, category, note, date}），
   * 这里严格按同一形状写，storage.js 的 OBJECT_KEYS 通道会自动覆盖它。
   *
   * 返回 true 表示真的写了；false 表示不写（没勾选 / 金额为 0 / 容器缺失）。
   * 「价格为 0 不写账」是刻意的：0 元不是一笔支出，记进去会污染统计分母。
   */
  function pushFinanceRecord(d, opts) {
    if (!opts || !opts.alsoCost) return false;
    var amount = parseFloat(opts.amount);
    if (isNaN(amount) || amount <= 0) return false;
    if (!d.finance || !Array.isArray(d.finance.records)) return false;
    d.finance.records.push({
      id: Util.uid(),
      amount: amount,
      category: toFinanceCat(opts.cat),
      note: opts.note || null,
      date: opts.date || Util.todayISO()
    });
    return true;
  }

  /**
   * 本月该类别支出合计，渲染期派生，不落库。
   * 口径 = **本自然月**（探针 probe112c.js 实测）：date 前 7 位等于本月前缀。
   * 不用滚动 30 天——那会把上月 15 日的花算进「本月」，用户对不上账。
   * 坏数据安全：date 为 undefined/空串/非法串时 slice 后不匹配，自动排除；
   * 金额用 parseFloat || 0 兜底，不产出 NaN。
   *
   * **只映射查询侧，不映射记录侧。** r.category 存的是记账类别（由 finance.js 写入），
   * 已经是映射后的值；再过一次 toFinanceCat 会把「用品」当成消耗品类别去查表，
   * 查不到就兜成「其他」，导致清洁/辅食/出行三类永远匹配不上——只映射一次。
   */
  function monthSpend(records, cat, todayISO) {
    var prefix = (todayISO || Util.todayISO()).slice(0, 7);
    var target = toFinanceCat(cat);
    return (records || []).reduce(function (sum, r) {
      if (!r) return sum;
      if (r.category !== target) return sum;
      if ((r.date || '').slice(0, 7) !== prefix) return sum;
      return sum + (parseFloat(r.amount) || 0);
    }, 0);
  }

  /* ============================================================
     第 294 次：用品重做与联动（对标 Cali「用品」：货架 + 物件 + 剩余数量）
     ------------------------------------------------------------
     一、口径从「还能用几天」换成「还剩多少」——pieces 就是当前剩余（单位 pcsU），
        联动扣减、低库存、待补货都按它算；availDays / qty / history 等老字段原样保留不删。
     二、老数据迁移（migrate，幂等，v294 标记）：没填 pieces 的老用品按 qty 件起步；
        cnt = 换尿布时能不能被选来扣减（迁移时只给纸尿裤 / 清洁类和用户在尿布面板里选过的）。
     三、联动（记录 → 库存）统一走「账本」：item.auto = { on, src, since, per, applied:{记录id: 扣了多少} }。
        每次 Storage.save() 之前按当前记录重算一遍「应扣」，与 applied 求差再动库存——
        新增 / 修改 / 删除 / 撤销 / 换宝宝都自动对上，不用在每个写记录的地方各接一次。
          fx    配方奶：瓶喂 / 奶粉记录里的配方奶毫升 ÷ 每勺水量 × 每勺克数
          stash 储奶袋：每存一袋奶扣 1
          meds  维生素 / 药：同名吃药记录每次扣 per
        只算「开启之后」且最近 45 天内的记录；更早的记录从账本里冻结（删了也不再退回），账本不会无限长。
        换尿布仍走第 226 次的 record.used（尿布面板里逐条勾选），不进这个账本。
     四、物件图：每件用品带 kind（物件）或自拍照片 img（Photos 仓库 id）。
        统一的立体物件图留到全项目图标统一时一次生成，现在先显示线性图标（ART 表里填上文件名即可替换）。
     ============================================================ */

  var KINDS = [
    { g: 'feed', k: 'formula', n: '配方奶粉', u: '罐', cat: '奶粉', ico: 'formula' },
    { g: 'feed', k: 'bottle', n: '奶瓶', u: '个', cat: '其他', ico: 'feeding' },
    { g: 'feed', k: 'pacifier', n: '安抚奶嘴', u: '个', cat: '其他', ico: 'baby' },
    { g: 'feed', k: 'brush', n: '奶瓶刷', u: '个', cat: '清洁', ico: 'feeding' },
    { g: 'feed', k: 'bag', n: '储奶袋', u: '个', cat: '其他', ico: 'pump' },
    { g: 'feed', k: 'pump', n: '泵奶器', u: '个', cat: '其他', ico: 'pump' },
    { g: 'feed', k: 'pad', n: '防溢乳垫', u: '片', cat: '其他', ico: 'breast' },
    { g: 'feed', k: 'bib', n: '围兜', u: '个', cat: '衣物', ico: 'solid' },
    { g: 'feed', k: 'bowl', n: '辅食碗', u: '个', cat: '辅食', ico: 'solid' },
    { g: 'feed', k: 'spoon', n: '辅食勺', u: '个', cat: '辅食', ico: 'solid' },
    { g: 'feed', k: 'cup', n: '学饮杯', u: '个', cat: '辅食', ico: 'water' },
    { g: 'feed', k: 'puree', n: '果泥', u: '袋', cat: '辅食', ico: 'solid' },
    { g: 'feed', k: 'biscuit', n: '磨牙饼干', u: '盒', cat: '辅食', ico: 'solid' },
    { g: 'care', k: 'diaper', n: '纸尿裤', u: '片', cat: '纸尿裤', ico: 'diaper', cnt: true },
    { g: 'care', k: 'wipes', n: '婴儿湿巾', u: '包', cat: '清洁', ico: 'supplies', cnt: true },
    { g: 'care', k: 'cotton', n: '棉柔巾', u: '包', cat: '清洁', ico: 'supplies', cnt: true },
    { g: 'care', k: 'underpad', n: '一次性隔尿垫', u: '片', cat: '纸尿裤', ico: 'diaper', cnt: true },
    { g: 'care', k: 'cream', n: '护臀膏', u: '支', cat: '清洁', ico: 'supplies' },
    { g: 'care', k: 'tissue', n: '婴儿纸巾', u: '包', cat: '清洁', ico: 'supplies' },
    { g: 'care', k: 'swab', n: '棉签', u: '盒', cat: '清洁', ico: 'supplies' },
    { g: 'care', k: 'wash', n: '洗发沐浴露', u: '瓶', cat: '清洁', ico: 'bath' },
    { g: 'care', k: 'lotion', n: '润肤乳', u: '瓶', cat: '清洁', ico: 'bath' },
    { g: 'care', k: 'towel', n: '浴巾', u: '条', cat: '衣物', ico: 'bath' },
    { g: 'care', k: 'swaddle', n: '包巾', u: '条', cat: '衣物', ico: 'baby' },
    { g: 'care', k: 'detergent', n: '婴儿洗衣液', u: '瓶', cat: '清洁', ico: 'supplies' },
    { g: 'care', k: 'thermo', n: '体温计', u: '个', cat: '维D/药品', ico: 'temp' },
    { g: 'care', k: 'clipper', n: '指甲剪', u: '个', cat: '其他', ico: 'baby' },
    { g: 'care', k: 'saline', n: '生理盐水', u: '支', cat: '维D/药品', ico: 'meds' },
    { g: 'care', k: 'toothpaste', n: '婴儿牙膏', u: '支', cat: '清洁', ico: 'supplies' },
    { g: 'care', k: 'sunscreen', n: '防晒霜', u: '支', cat: '清洁', ico: 'sun' },
    { g: 'care', k: 'repellent', n: '驱蚊液', u: '瓶', cat: '清洁', ico: 'supplies' },
    { g: 'nutri', k: 'd3', n: '维生素 D3 滴剂', u: '粒', cat: '维D/药品', ico: 'supplement', meds: 'D3' },
    { g: 'nutri', k: 'ad', n: '维生素 AD', u: '粒', cat: '维D/药品', ico: 'supplement', meds: 'AD' },
    { g: 'nutri', k: 'vd', n: '维生素 D', u: '粒', cat: '维D/药品', ico: 'supplement', meds: '维生素D' },
    { g: 'nutri', k: 'probiotic', n: '益生菌', u: '包', cat: '维D/药品', ico: 'supplement' },
    { g: 'nutri', k: 'calcium', n: '钙补充剂', u: 'ml', cat: '维D/药品', ico: 'supplement' },
    { g: 'nutri', k: 'iron', n: '铁补充剂', u: 'ml', cat: '维D/药品', ico: 'supplement' }
  ];
  var KGROUPS = [{ g: 'feed', n: '喂养' }, { g: 'care', n: '日常护理' }, { g: 'nutri', n: '营养补充' }];
  /* 立体物件图：统一生成后在这里登记 kind → 文件名（assets/supplies/<文件>），没登记的显示线性图标 */
  /* 第 337 次：3D 黏土物件 30 张接入（assets/supplies/，tools/clay/export.py 出 360px webp）。同屏不再重复（原来 5 个辅食碗、8 个用品袋）。
     纸尿裤 / 辅食碗借现成 3D（尿布类型卡的干净尿布、辅食分类卡的空碗）；奶瓶、泵奶器、学饮杯、体温计没有 3D，用 v4 扁平图（.su-ico 在 v4 白名单里）。
     维生素 D3 / AD / D、生理盐水共用「滴剂」，钙 / 铁共用「液体」，益生菌用「粉剂」——同一剂型同一张图。 */
  var ART = {
    formula: 'formula.webp', pacifier: 'pacifier.webp', brush: 'brush.webp', bag: 'milkbag.webp', pad: 'nursingpad.webp', bib: 'bib.webp',
    bowl: '../solid/c_other.webp', spoon: 'spoon.webp', puree: 'puree.webp', biscuit: 'biscuit.webp',
    diaper: '../diaper/clean.webp', wipes: 'wipes.webp', cotton: 'cottontowel.webp', underpad: 'changingpad.webp', cream: 'diapercream.webp',
    tissue: 'tissue.webp', swab: 'swab.webp', wash: 'babywash.webp', lotion: 'lotion.webp', towel: 'towel.webp', swaddle: 'swaddle.webp',
    detergent: 'detergent.webp', clipper: 'nailclipper.webp', saline: 'drops.webp', toothpaste: 'toothpaste.webp', sunscreen: 'sunscreen.webp',
    repellent: 'repellent.webp', d3: 'drops.webp', ad: 'drops.webp', vd: 'drops.webp', probiotic: 'powder.webp', calcium: 'liquid.webp', iron: 'liquid.webp'
  };
  var UNITS2 = ['片', '个', '包', '袋', '瓶', '罐', '盒', '支', '条', '抽', '粒', '颗', '滴', 'g', 'ml', '次'];
  var LIST_MAX = 8, NOTE_MAX = 200, LINK_MAX = 300, SRC_MAX = 30, NAME_MAX = 20;
  var WINDOW_DAYS = 45;
  var ui = { tab: 'main', filter: 'all', q: '' };

  function esc(s) { return Util.escapeHtml(s == null ? '' : String(s)); }
  function kindOf(k) { for (var i = 0; i < KINDS.length; i++) if (KINDS[i].k === k) return KINDS[i]; return null; }
  function num(v) { var n = Number(v); return isFinite(n) ? n : NaN; }
  function r1(n) { return Math.round(n * 10) / 10; }
  function fmtN(n) {
    if (!isFinite(n)) return '—';
    try { return Number(r1(n)).toLocaleString('zh-CN', { maximumFractionDigits: 1 }); } catch (e) { return String(r1(n)); }
  }
  function amountText(s) { return hasPieces(s) ? fmtN(s.pieces) + ' ' + pcsUnit(s) : '—'; }
  function chW(v) { return Math.max(1.6, String(v == null ? '' : v).length + 0.6) + 'ch'; }
  function isUrl(v) { return typeof v === 'string' && /^https?:\/\/[^\s<>"']+$/i.test(v); }
  function locNow() { return Util.nowLocal(); }
  function dtOk(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v); }

  /* ---------- 清单（settings.supLists） ---------- */
  function lists(d) {
    var L = (d && d.settings && Array.isArray(d.settings.supLists)) ? d.settings.supLists.filter(function (x) { return x && x.id && x.name; }) : [];
    if (!L.some(function (x) { return x.id === 'main'; })) L.unshift({ id: 'main', name: '用品' });
    return L;
  }
  function listOf(d, s) {
    var L = lists(d), id = s && s.list;
    return L.some(function (x) { return x.id === id; }) ? id : L[0].id;
  }

  /* ---------- 迁移（幂等） ---------- */
  function migrate(d) {
    if (!d || !Array.isArray(d.supplies)) return 0;
    var pref = (d.settings && d.settings.diaperStock && Array.isArray(d.settings.diaperStock.ids)) ? d.settings.diaperStock.ids : [];
    var n = 0;
    d.supplies.forEach(function (s) {
      if (!s || s.v294) return;
      var had = hasPieces(s);
      if (!had) {
        var q = parseInt(s.qty, 10);
        s.pieces = (isNaN(q) || q < 0) ? 1 : Math.min(PIECES_MAX, q);
        if (PCS_U.indexOf(s.pcsU) < 0) s.pcsU = UNITS2.indexOf(s.unit) >= 0 ? s.unit : '个';
      } else if (PCS_U.indexOf(s.pcsU) < 0) {
        s.pcsU = pcsUnit(s);
      }
      if (!s.kind) s.kind = s.cat === '纸尿裤' ? 'diaper' : (s.cat === '奶粉' ? 'formula' : '');
      s.cnt = had && (s.cat === '纸尿裤' || s.cat === '清洁' || pref.indexOf(s.id) >= 0);
      if (!s.list) s.list = 'main';
      s.v294 = 1;
      if (!s.editedAt) s.editedAt = locNow(); /* 第 332 次：原 updatedAt 字符串改名 editedAt，updatedAt 留给同步的毫秒时间戳 */
      n++;
    });
    return n;
  }

  /* ---------- 低库存 / 提醒 ---------- */
  function lowOn(s) { return !!(s && s.low && s.low.on && isFinite(num(s.low.th))); }
  function isLow(s) {
    if (!s || s.archived) return false;
    if (s.v294) return lowOn(s) && hasPieces(s) && s.pieces <= num(s.low.th);
    return supplyLeft(s) <= LOW_DAYS; /* 还没迁移的老数据按老口径 */
  }
  function remindOn(s) { return !!(s && s.remind && s.remind.on && dtOk(s.remind.at)); }
  function remindDue(s, nowStr) { return !s.archived && remindOn(s) && String(s.remind.at).slice(0, 16) <= String(nowStr || locNow()).slice(0, 16); }
  function needRestock(s, nowStr) { return !!s && !s.archived && (isLow(s) || remindDue(s, nowStr)); }

  /* ---------- 联动账本 ---------- */
  function fxOk(s) {
    var f = s && s.fx;
    return !!(f && num(f.scoopMl) > 0 && num(f.scoopG) > 0);
  }
  function allRecs(d, key) {
    var out = [];
    (d[key] || []).forEach(function (r) { if (r) out.push(r); });
    var act = d.settings && d.settings.activeBabyId;
    (d.babies || []).forEach(function (b) {
      if (!b || b.id === act || !b.rec || !Array.isArray(b.rec[key])) return;
      b.rec[key].forEach(function (r) { if (r) out.push(r); });
    });
    return out;
  }
  function formulaMl(r) {
    if (!r || (r.type !== 'bottle' && r.type !== 'formula')) return 0;
    var v = r.amountFm != null ? num(r.amountFm) : (r.type === 'formula' ? num(r.amount) : 0);
    return v > 0 && v < 2000 ? v : 0;
  }
  function normName(x) { return String(x == null ? '' : x).replace(/\s+/g, '').toUpperCase(); }
  function medsHit(s, r) {
    var a = normName(r && r.name);
    if (!a) return false;
    var k = kindOf(s.kind), b = normName(s.name);
    if (b && (a === b || a.indexOf(b) >= 0)) return true;
    return !!(k && k.meds && a.indexOf(normName(k.meds)) >= 0);
  }
  /** 这件用品此刻「应扣」的账：{ 记录id: 数量 }，以及窗口外（冻结）的记录 id */
  function desired(d, s) {
    var a = s.auto, out = {}, frozen = {};
    if (!a || !a.on || !dtOk(a.since)) return { want: out, frozen: frozen };
    var since = String(a.since).slice(0, 19);
    var win = Date.now() - WINDOW_DAYS * 864e5;
    var take = function (id, t, q) {
      if (!id || !(q > 0)) return;
      var tt = new Date(t).getTime();
      if (!isFinite(tt)) return;
      if (String(t).slice(0, 19) < since) return;
      if (tt < win) { frozen[id] = 1; return; }
      out[id] = r1(q);
    };
    if (a.src === 'fx' && fxOk(s)) {
      allRecs(d, 'feedings').forEach(function (r) {
        var ml = formulaMl(r);
        if (ml) take(r.id, r.start, ml / num(s.fx.scoopMl) * num(s.fx.scoopG));
      });
    } else if (a.src === 'stash') {
      (d.milkStash || []).forEach(function (r) { if (r) take(r.id, r.time, 1); });
    } else if (a.src === 'meds') {
      var per = num(a.per) > 0 ? num(a.per) : 1;
      allRecs(d, 'meds').forEach(function (r) { if (medsHit(s, r)) take(r.id, r.time, per); });
    }
    return { want: out, frozen: frozen };
  }
  /** 按记录重算所有开着联动的用品，返回 [{ item, delta }]（delta>0 = 扣了） */
  function syncAuto(d) {
    var moved = [];
    if (!d || !Array.isArray(d.supplies)) return moved;
    d.supplies.forEach(function (s) {
      if (!s || !s.auto || !s.auto.on || s.archived || !hasPieces(s)) return;
      var r = desired(d, s), want = r.want, ap = (s.auto.applied && typeof s.auto.applied === 'object' && !Array.isArray(s.auto.applied)) ? s.auto.applied : {};
      var delta = 0, next = {};
      Object.keys(ap).forEach(function (id) {
        if (r.frozen[id]) return; /* 窗口外：冻结，不退回 */
        var had = num(ap[id]) || 0, now = want[id] || 0;
        delta += now - had;
        if (now) next[id] = now;
      });
      Object.keys(want).forEach(function (id) {
        if (ap[id] == null) { delta += want[id]; next[id] = want[id]; }
      });
      s.auto.applied = next;
      delta = r1(delta);
      if (delta) {
        s.pieces = Math.max(0, Math.min(PIECES_MAX, r1(s.pieces - delta)));
        moved.push({ item: s, delta: delta });
      }
    });
    return moved;
  }
  /** 打开联动：从此刻起算，已有记录不追扣 */
  function armAuto(s, src, per) {
    var prev = s.auto && s.auto.on && s.auto.src === src ? s.auto : null;
    s.auto = { on: true, src: src, since: prev ? prev.since : locNow(), per: per > 0 ? per : 1, applied: prev && prev.applied ? prev.applied : {} };
  }
  function autoSrcFor(s) {
    var k = kindOf(s && s.kind);
    if (s && (s.kind === 'formula' || s.pcsU === 'g')) return 'fx';
    if (s && s.kind === 'bag') return 'stash';
    if (k && k.g === 'nutri') return 'meds';
    return null;
  }

  /* 所有写库都从 Storage.save 走：保存前先迁移老数据、再对一遍联动账本 */
  (function hookSave() {
    if (!Storage || Storage._supHooked) return;
    var orig = Storage.save;
    Storage.save = function () {
      try { var dd = this.data; if (dd && Array.isArray(dd.supplies) && dd.supplies.length) { migrate(dd); var mv = syncAuto(dd); if (mv.length) Modules.supplies._lastMoved = mv; } } catch (e) { /* 联动出错不挡保存 */ }
      return orig.apply(this, arguments);
    };
    Storage._supHooked = true;
  })();

  /* ---------- 物件图 ---------- */
  function artHTML(s, cls) {
    var k = kindOf(s && s.kind);
    if (s && Global_Photos() && Photos.validId(s.img)) {
      return '<span class="su-art ' + (cls || '') + ' su-photo"><img data-phid="' + esc(s.img) + '" alt=""></span>';
    }
    if (k && ART[k.k]) return '<span class="su-art ' + (cls || '') + '"><img src="assets/supplies/' + esc(ART[k.k]) + '" alt="" decoding="async"></span>';
    return '<span class="su-art ' + (cls || '') + ' su-ico" data-g="' + esc(k ? k.g : 'other') + '">' + icon(k ? k.ico : 'supplies') + '</span>';
  }
  function Global_Photos() { return global.Photos && typeof Photos.validId === 'function'; }

  /* ---------- 页面 ---------- */
  function visible(d, nowStr) {
    var all = (d.supplies || []).filter(function (s) { return s && s.name; });
    var q = normName(ui.q);
    var arr;
    if (ui.tab === 'low') arr = all.filter(function (s) { return needRestock(s, nowStr); });
    else arr = all.filter(function (s) { return listOf(d, s) === ui.tab; });
    if (ui.filter === 'arch') arr = arr.filter(function (s) { return s.archived; });
    else {
      arr = arr.filter(function (s) { return !s.archived; });
      if (ui.filter === 'low') arr = arr.filter(isLow);
      else if (ui.filter === 'remind') arr = arr.filter(remindOn);
    }
    if (q) arr = arr.filter(function (s) { return normName(s.name).indexOf(q) >= 0; });
    return arr;
  }
  var FILTERS = [['all', '库存'], ['low', '低库存'], ['remind', '有提醒'], ['arch', '已归档']];

  function pageHTML(d) {
    var L = lists(d);
    if (ui.tab !== 'low' && !L.some(function (x) { return x.id === ui.tab; })) ui.tab = L[0].id;
    var nowStr = locNow();
    var nLow = (d.supplies || []).filter(function (s) { return needRestock(s, nowStr); }).length;
    var arr = visible(d, nowStr);
    var h = '<div class="su-top"><label class="su-search">' + icon('search') + '<input type="search" id="suQ" placeholder="搜索用品" value="' + esc(ui.q) + '" maxlength="20" enterkeyhint="search" aria-label="搜索用品"></label>'
      + '<label class="su-ib" title="筛选"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M7 12h10M10 17h4" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>'
      + (ui.filter !== 'all' ? '<i class="su-dot"></i>' : '') + '<select id="suFilter" aria-label="筛选">'
      + FILTERS.map(function (f) { return '<option value="' + f[0] + '"' + (ui.filter === f[0] ? ' selected' : '') + '>' + f[1] + '</option>'; }).join('') + '</select></label>'
      + '<label class="su-ib" title="更多">' + FTUI_more() + '<select id="suMenu" aria-label="更多"><option value="" selected disabled>更多</option><option value="lists">用品设置</option><option value="remind">提醒设置</option></select></label></div>';
    h += '<div class="su-tabs" role="tablist">';
    L.forEach(function (x) {
      var on = ui.tab === x.id;
      h += '<button type="button" role="tab" class="ft-chip su-tab' + (on ? ' is-on' : '') + '" aria-selected="' + on + '" data-sutab="' + esc(x.id) + '">' + esc(x.name) + '</button>';
    });
    h += '<button type="button" role="tab" class="ft-chip su-tab' + (ui.tab === 'low' ? ' is-on' : '') + '" aria-selected="' + (ui.tab === 'low') + '" data-sutab="low">待补货' + (nLow ? '<b class="su-badge">' + nLow + '</b>' : '') + '</button></div>';
    if (ui.filter !== 'all') h += '<p class="su-fnote">只看：' + FILTERS.filter(function (f) { return f[0] === ui.filter; })[0][1] + ' <button type="button" class="su-fclr" data-fclr>显示全部</button></p>';

    if (!arr.length) {
      var t, s2, canAdd = ui.tab !== 'low' && ui.filter !== 'arch';
      if (ui.q) { t = '没有找到「' + esc(ui.q) + '」'; s2 = '换个名字试试。'; canAdd = false; }
      else if (ui.tab === 'low') { t = '没有要补货的'; s2 = '打开低库存提醒或设置提醒的用品，快用完或到点时会出现在这里。'; }
      else if (ui.filter === 'arch') { t = '没有归档的用品'; s2 = '用完不再买的用品可以归档，记录还在。'; }
      else if (ui.filter === 'low') { t = '没有低库存'; s2 = '低于提醒阈值的用品会出现在这里。'; }
      else if (ui.filter === 'remind') { t = '没有设置提醒的用品'; s2 = '在用品的更多属性里可以设置提醒。'; }
      else { t = '添加用品'; s2 = '把常买的用品、数量和提醒放在同一个清单里。'; }
      h += '<div class="su-shelf su-empty"><div class="su-row">' + (canAdd ? '<button type="button" class="su-addc" data-suadd aria-label="添加用品">' + icon('plus') + '</button>' : '<span class="su-addc is-off" aria-hidden="true">' + icon(ui.q ? 'search' : 'check') + '</span>') + '</div>'
        + '<p class="su-et">' + t + '</p><p class="su-es">' + s2 + '</p></div>';
    } else {
      h += '<div class="su-shelf">';
      for (var i = 0; i < arr.length; i += 3) {
        h += '<div class="su-row">';
        arr.slice(i, i + 3).forEach(function (s) {
          var low = isLow(s), due = remindDue(s, nowStr);
          h += '<button type="button" class="su-item' + (low ? ' is-low' : '') + (s.archived ? ' is-arch' : '') + '" data-suopen="' + esc(s.id) + '" aria-label="' + esc(s.name) + '，剩 ' + esc(amountText(s)) + (low ? '，快用完了' : '') + (due ? '，提醒到了' : '') + '">'
            + artHTML(s) + '<b class="su-n">' + esc(s.name) + '</b><small class="su-a">' + esc(amountText(s)) + (low ? ' · 快用完' : (due ? ' · 该补了' : '')) + '</small></button>';
        });
        h += '</div>';
      }
      h += '</div>';
    }
    if ((d.supplies || []).length) h += '<div class="su-foot"><button type="button" class="su-exp" id="spExport">导出 CSV</button></div>';
    h += '<div class="mod-cta"><button type="button" class="mc-main" data-suadd>' + icon('plus') + '<span>添加用品</span></button></div>';
    return h;
  }
  function FTUI_more() { return (global.FTUI && FTUI.SV && FTUI.SV.more) || '…'; }

  /* ---------- 选物件 ---------- */
  var pickTab = 'feed';
  function openPicker(onPick, onCancel) {
    var picked = false;
    var F = global.FTUI; if (!F) return;
    F.openSheet('supplies', '选择物件', '<div class="su-pk" id="suPk"></div>', function (api) {
      api.box.closest('.modal').classList.add('su-sheet');
      var ok = api.box.querySelector('[data-ok]'); if (ok) { ok.hidden = true; ok.style.visibility = 'hidden'; }
      api.onClose = function () { if (!picked && onCancel) setTimeout(onCancel, 60); };
      var wrap = api.box.querySelector('#suPk');
      function paint() {
        var h = '<div class="su-pk-src"><button type="button" class="btn su-pk-b" data-pkcam>' + icon('camera') + '<span>拍摄物品</span></button>'
          + '<button type="button" class="btn su-pk-b" data-pkalb>' + icon('image') + '<span>从相册选择</span></button></div>'
          + '<p class="rs-hint su-pk-hint">照片只在这台手机上处理和保存，不上传。</p><div class="ft-chips su-pk-tabs">';
        KGROUPS.forEach(function (g) { h += '<button type="button" class="ft-chip' + (pickTab === g.g ? ' is-on' : '') + '" data-pkg="' + g.g + '" aria-pressed="' + (pickTab === g.g) + '">' + g.n + '</button>'; });
        h += '</div><div class="su-pk-grid">';
        KINDS.filter(function (k) { return k.g === pickTab; }).forEach(function (k) {
          h += '<button type="button" class="su-pk-it" data-pk="' + k.k + '">' + artHTML({ kind: k.k }) + '<span>' + esc(k.n) + '</span></button>';
        });
        wrap.innerHTML = h + '</div>';
      }
      paint();
      wrap.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('button') : null;
        if (!b) return;
        if (b.hasAttribute('data-pkg')) { pickTab = b.getAttribute('data-pkg'); paint(); return; }
        if (b.hasAttribute('data-pk')) { var k = b.getAttribute('data-pk'); picked = true; api.close(); onPick({ kind: k }); return; }
        if (b.hasAttribute('data-pkcam') || b.hasAttribute('data-pkalb')) {
          if (!Global_Photos()) { Util.toast('这台设备暂时不能存照片', 'warn'); return; }
          Photos.pick(b.hasAttribute('data-pkcam'), function (fs) {
            Photos.compress(fs[0], 720, 0.8).then(Photos.put).then(function (id) { picked = true; api.close(); onPick({ kind: '', img: id }); })
              .catch(function () { Util.toast('照片没存上，再试一次', 'warn'); });
          });
        }
      });
    });
  }

  /* ---------- 用品面板（新建 / 修改） ---------- */
  function stepFor(u) { return (u === 'g' || u === 'ml') ? 10 : 1; }
  function openEditor(id, preset, keep) {
    var F = global.FTUI; if (!F) return;
    var d = Storage.get();
    if (!Array.isArray(d.supplies)) d.supplies = [];
    migrate(d);
    var s = id ? d.supplies.filter(function (x) { return x && x.id === id; })[0] : null;
    if (id && !s) return;
    var k0 = kindOf(s ? s.kind : preset && preset.kind);
    var src0 = s ? s : { kind: k0 ? k0.k : '', pcsU: k0 ? k0.u : '个' };
    var st = keep || {
      kind: s ? (s.kind || '') : (k0 ? k0.k : ''),
      img: s ? (s.img || null) : (preset && preset.img) || null,
      name: s ? s.name : (k0 ? k0.n : ''),
      pieces: s ? (hasPieces(s) ? s.pieces : 0) : 1,
      unit: s ? pcsUnit(s) : (k0 ? k0.u : '个'),
      list: s ? listOf(d, s) : (ui.tab !== 'low' ? ui.tab : 'main'),
      lowOn: s ? lowOn(s) : false,
      lowTh: s && s.low && isFinite(num(s.low.th)) ? num(s.low.th) : (k0 && k0.k === 'diaper' ? 20 : 1),
      fxOn: !!(s && s.auto && s.auto.on && s.auto.src === 'fx'),
      canG: s && s.fx && num(s.fx.canG) > 0 ? num(s.fx.canG) : 800,
      scoopMl: s && s.fx && num(s.fx.scoopMl) > 0 ? num(s.fx.scoopMl) : 30,
      scoopG: s && s.fx && num(s.fx.scoopG) > 0 ? num(s.fx.scoopG) : 4.4,
      autoOn: s ? !!(s.auto && s.auto.on && s.auto.src !== 'fx') : !!(k0 && (k0.k === 'bag' || k0.g === 'nutri')),
      per: s && s.auto && num(s.auto.per) > 0 ? num(s.auto.per) : 1,
      cnt: s ? (s.v294 ? !!s.cnt : hasPieces(s)) : !!(k0 && k0.cnt),
      src: s ? (s.src || '') : '',
      buyOn: s ? !!s.bought : false,
      date: (s && /^\d{4}-\d{2}-\d{2}$/.test(s.date || '')) ? s.date : Util.todayISO(),
      remOn: s ? remindOn(s) : false,
      remAt: s && s.remind && dtOk(s.remind.at) ? String(s.remind.at).slice(0, 16) : Util.addDays(Util.todayISO(), 7) + 'T09:00',
      link: s ? (s.link || '') : '',
      note: s ? (s.note || '') : '',
      photos: s && Global_Photos() ? Photos.clean(s.photos) : [],
      more: !s
    };
    var kind0 = st.kind;
    void src0;
    F.openSheet('supplies', s ? '' : '新用品', '<div class="su-ed" id="suEd"></div>', function (api) {
      var modal = api.box.closest('.modal'); modal.classList.add('su-sheet', 'su-edsheet');
      var wrap = api.box.querySelector('#suEd');
      var src = autoSrcFor({ kind: st.kind, pcsU: st.unit });
      function sw(attr, on, label) { return '<button type="button" class="rs-switch" role="switch" ' + attr + ' aria-checked="' + !!on + '" aria-label="' + esc(label) + '"><i></i></button>'; }
      function row(label, right, cls) { return '<div class="spw-row su-prow' + (cls ? ' ' + cls : '') + '"><span>' + label + '</span>' + right + '</div>'; }
      function numIn(attr, v, unit, label, step) {
        return '<span class="su-nin"><input type="number" inputmode="decimal" ' + attr + ' value="' + esc(v) + '" min="0" max="99999" step="' + (step || 'any') + '" aria-label="' + esc(label) + '">' + (unit ? '<i>' + esc(unit) + '</i>' : '') + '</span>';
      }
      function paint() {
        src = autoSrcFor({ kind: st.kind, pcsU: st.unit });
        var h = '<div class="su-ed-hero"><button type="button" class="su-ed-art" data-chart aria-label="更换物件">' + artHTML({ kind: st.kind, img: st.img }, 'su-art-lg') + '<i class="su-pen">' + (FTUI_SV('pen')) + '</i></button>'
          + (s ? '<label class="su-more" title="更多操作">' + FTUI_more() + '<select data-edmenu aria-label="更多操作"><option value="" selected disabled>更多操作</option><option value="restock">记一次补货</option>'
            + '<option value="arch">' + (s.archived ? '取消归档' : '归档') + '</option><option value="del">删除用品</option></select></label>' : '') + '</div>';
        h += '<input type="text" class="su-ed-name" id="suName" maxlength="' + NAME_MAX + '" placeholder="用品名称" value="' + esc(st.name) + '" aria-label="用品名称">';
        h += '<div class="su-ed-num"><div><label class="su-big"><input type="number" inputmode="decimal" id="suPcs" style="width:' + chW(r1(st.pieces)) + '" value="' + esc(r1(st.pieces)) + '" min="0" max="99999" step="any" aria-label="当前剩余"><i>' + esc(st.unit) + '</i></label><small>当前剩余</small></div>'
          + '<span class="sd-step su-step"><button type="button" data-pstep="-1" aria-label="减少"' + (st.pieces > 0 ? '' : ' disabled') + '>−</button><i aria-hidden="true"></i><button type="button" data-pstep="1" aria-label="增加">+</button></span></div>';
        h += '<button type="button" class="su-moret" data-more aria-expanded="' + st.more + '"><span>更多属性</span>' + FTUI_SV('down') + '</button>';
        if (st.more) {
          var L = lists(Storage.get());
          h += '<div class="su-grp">'
            + row('所在清单', '<label class="su-selv"><b>' + esc((L.filter(function (x) { return x.id === st.list; })[0] || L[0]).name) + '</b>' + FTUI_SV('down') + '<select id="suList" aria-label="所在清单">' + L.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === st.list ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') + '</select></label>')
            + row('单位', '<label class="su-selv"><b>' + esc(st.unit) + '</b>' + FTUI_SV('down') + '<select id="suUnit" aria-label="单位"' + (st.fxOn ? ' disabled' : '') + '>' + UNITS2.map(function (u) { return '<option' + (u === st.unit ? ' selected' : '') + '>' + u + '</option>'; }).join('') + '</select></label>', 'spw-line')
            + row('低库存提醒', sw('data-lowsw', st.lowOn, '低库存提醒'), 'spw-line');
          if (st.lowOn) h += row('提醒阈值', numIn('id="suTh"', st.lowTh, st.unit, '提醒阈值'), 'spw-line');
          h += '</div>';
          /* 联动 */
          if (src === 'fx') {
            h += '<div class="su-grp">' + row('按奶粉配比扣减', sw('data-fxsw', st.fxOn, '按奶粉配比扣减'));
            if (st.fxOn) {
              h += row('每罐净含量', numIn('id="suCan"', st.canG, 'g', '每罐净含量'), 'spw-line')
                + row('每勺对应水量', numIn('id="suSml"', st.scoopMl, 'ml', '每勺对应水量'), 'spw-line')
                + row('每勺奶粉', numIn('id="suSg"', st.scoopG, 'g', '每勺奶粉'), 'spw-line')
                + '<p class="spw-hint su-ghint">按包装上的克数与毫升数填写。记一次配方奶，按冲调量扣减克数；已开封的奶粉，请把上面的剩余改为实际克数。</p>';
            } else {
              h += '<p class="spw-hint su-ghint">打开后，记瓶喂 / 配方奶时按冲调的毫升数自动扣减克数。</p>';
            }
            h += '</div>';
          } else if (src === 'stash' || src === 'meds') {
            h += '<div class="su-grp">' + row(src === 'stash' ? '存奶时扣减' : '吃药时扣减', sw('data-autosw', st.autoOn, '记录时扣减'));
            if (st.autoOn && src === 'meds') h += row('每次扣减', numIn('id="suPer"', st.per, st.unit, '每次扣减'), 'spw-line');
            h += '<p class="spw-hint su-ghint">' + (src === 'stash' ? '储奶页每存一袋奶，自动扣 1 个。' : '吃药页记一次「' + esc(st.name || '同名药') + '」，自动扣减。') + '</p></div>';
          }
          if (st.cnt || (kindOf(st.kind) && kindOf(st.kind).cnt)) {
            h += '<div class="su-grp">' + row('换尿布时可扣减', sw('data-cntsw', st.cnt, '换尿布时可扣减')) + '<p class="spw-hint su-ghint">记尿布时可以勾选这件用品，每次扣 1。</p></div>';
          }
          h += '<div class="su-grp">'
            + row('购买来源', '<input type="text" class="su-tin" id="suSrc" maxlength="' + SRC_MAX + '" placeholder="选填" value="' + esc(st.src) + '" aria-label="购买来源">')
            + row('购买日期', sw('data-buysw', st.buyOn, '购买日期'), 'spw-line');
          if (st.buyOn) h += row('日期', '<label class="spw-pill spw-date"><b>' + esc(Util.fmtDate ? Util.fmtDate(st.date) : st.date) + '</b><input type="date" class="ft-hid" id="suDate" value="' + esc(st.date) + '" max="' + Util.todayISO() + '" aria-label="购买日期"></label>', 'spw-line');
          h += row('设置提醒', sw('data-remsw', st.remOn, '设置提醒'), 'spw-line');
          if (st.remOn) h += row('提醒时间', '<input type="datetime-local" class="su-tin su-dt" id="suRem" value="' + esc(st.remAt) + '" aria-label="提醒时间">', 'spw-line');
          h += row('链接', '<input type="url" class="su-tin" id="suLink" maxlength="' + LINK_MAX + '" placeholder="https://" value="' + esc(st.link) + '" aria-label="链接">', 'spw-line');
          if (isUrl(st.link)) h += '<p class="su-linkp"><a href="' + esc(st.link) + '" target="_blank" rel="noopener noreferrer">打开链接</a></p>';
          h += '</div>';
          h += '<div class="su-grp"><textarea class="su-note" id="suNote" maxlength="' + NOTE_MAX + '" rows="2" placeholder="备注" aria-label="备注">' + esc(st.note) + '</textarea>';
          if (Global_Photos()) {
            h += '<div class="spw-row su-prow"><span>备注照片</span><span class="su-phn">' + st.photos.length + '/' + Photos.MAX + '</span></div>';
            if (st.photos.length) h += '<div class="su-phs">' + st.photos.map(function (pid) { return '<span class="dp-ph"><button type="button" class="dp-ph-img" data-phview="' + esc(pid) + '" aria-label="查看照片"><img data-phid="' + esc(pid) + '" alt=""></button><button type="button" class="dp-ph-rm" data-phrm="' + esc(pid) + '" aria-label="移除照片">' + icon('close') + '</button></span>'; }).join('') + '</div>';
            if (st.photos.length < Photos.MAX) h += '<div class="dp-ph-btns"><button type="button" class="btn dp-ph-add" data-phadd>' + icon('image') + '<span>添加照片</span></button><button type="button" class="btn dp-ph-add" data-phcam>' + icon('camera') + '<span>拍摄照片</span></button></div>';
            h += '<p class="spw-hint su-ghint">包装、购买凭证等照片，和物件图分开保存，只在这台手机上。</p>';
          }
          h += '</div>';
        }
        h += '<div class="rs-savebar"><button type="button" class="btn btn-primary rs-save" data-done>' + '<span>完成</span></button></div>';
        wrap.innerHTML = h;
        if (Global_Photos()) Photos.hydrate(wrap);
      }
      function readInputs() {
        var g = function (sel) { return wrap.querySelector(sel); };
        if (g('#suName')) st.name = g('#suName').value;
        if (g('#suPcs')) {
          var p = num(g('#suPcs').value);
          if (isFinite(p) && p >= 0 && p !== st.pieces) { st.pieces = Math.min(PIECES_MAX, p); st.autoG = false; }
          g('#suPcs').style.width = chW(g('#suPcs').value);
        }
        if (g('#suTh')) { var t = num(g('#suTh').value); if (isFinite(t) && t >= 0) st.lowTh = t; }
        if (g('#suCan')) {
          var c = num(g('#suCan').value);
          if (c > 0 && c !== st.canG) {
            st.canG = c;
            /* 刚从「罐」换成克、还没手改过剩余：参考值 = 罐数 × 每罐净含量，跟着改 */
            if (st.autoG && st.cans > 0) { st.pieces = r1(st.cans * c); var pi = g('#suPcs'); if (pi) { pi.value = st.pieces; pi.style.width = chW(st.pieces); } }
          }
        }
        if (g('#suSml')) { var m = num(g('#suSml').value); if (m > 0) st.scoopMl = m; }
        if (g('#suSg')) { var sg = num(g('#suSg').value); if (sg > 0) st.scoopG = sg; }
        if (g('#suPer')) { var pr = num(g('#suPer').value); if (pr > 0) st.per = pr; }
        if (g('#suSrc')) st.src = g('#suSrc').value;
        if (g('#suDate') && /^\d{4}-\d{2}-\d{2}$/.test(g('#suDate').value)) st.date = g('#suDate').value;
        if (g('#suRem') && dtOk(g('#suRem').value)) st.remAt = g('#suRem').value.slice(0, 16);
        if (g('#suLink')) st.link = g('#suLink').value.trim();
        if (g('#suNote')) st.note = g('#suNote').value;
      }
      paint();
      wrap.addEventListener('change', function (e) {
        var t = e.target;
        if (t.id === 'suList') { st.list = t.value; readInputs(); paint(); }
        else if (t.id === 'suUnit') { st.unit = t.value; readInputs(); paint(); }
        else if (t.id === 'suDate' || t.id === 'suLink') { readInputs(); paint(); }
      });
      wrap.addEventListener('input', function (e) { if (e.target && e.target.tagName !== 'SELECT') readInputs(); });
      wrap.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('button') : null;
        if (!b) return;
        readInputs();
        if (b.hasAttribute('data-pstep')) {
          var stp = stepFor(st.unit) * Number(b.getAttribute('data-pstep'));
          st.pieces = Math.max(0, Math.min(PIECES_MAX, r1(st.pieces + stp))); paint(); return;
        }
        if (b.hasAttribute('data-more')) { st.more = !st.more; paint(); return; }
        if (b.hasAttribute('data-lowsw')) { st.lowOn = !st.lowOn; paint(); return; }
        if (b.hasAttribute('data-fxsw')) {
          st.fxOn = !st.fxOn;
          /* 打开配比：按罐记的换算成克（罐数 × 每罐净含量），单位改成 g */
          if (st.fxOn && st.unit !== 'g') {
            if (st.unit === '罐') { st.cans = st.pieces; st.autoG = true; st.pieces = r1(st.pieces * st.canG); }
            st.unit = 'g'; if (st.lowOn && st.lowTh < 50) st.lowTh = 200;
          }
          paint(); return;
        }
        if (b.hasAttribute('data-autosw')) { st.autoOn = !st.autoOn; paint(); return; }
        if (b.hasAttribute('data-cntsw')) { st.cnt = !st.cnt; paint(); return; }
        if (b.hasAttribute('data-buysw')) { st.buyOn = !st.buyOn; paint(); return; }
        if (b.hasAttribute('data-remsw')) { st.remOn = !st.remOn; paint(); return; }
        if (b.hasAttribute('data-chart')) {
          openPicker(function (r) {
            /* 选完物件回到同一个面板：重开一次，状态带回去 */
            var kk = kindOf(r.kind), prevK = kindOf(st.kind || kind0);
            if (kk && (!st.name || (prevK && st.name === prevK.n))) st.name = kk.n;
            if (kk && !s) { st.unit = kk.u; st.cnt = !!kk.cnt; st.autoOn = kk.k === 'bag' || kk.g === 'nutri'; }
            st.kind = r.kind; st.img = r.img || null;
            reopen(st);
          }, function () { reopen(st); });
          return;
        }
        if (b.hasAttribute('data-phview')) { Photos.view(b.getAttribute('data-phview'), st.photos); return; }
        if (b.hasAttribute('data-phrm')) { var v = b.getAttribute('data-phrm'); st.photos = st.photos.filter(function (x) { return x !== v; }); paint(); return; }
        if (b.hasAttribute('data-phadd') || b.hasAttribute('data-phcam')) {
          Photos.pick(b.hasAttribute('data-phcam'), function (fs) {
            var room = Photos.MAX - st.photos.length;
            Promise.all(fs.slice(0, room).map(function (f) { return Photos.compress(f).then(Photos.put); })).then(function (ids) {
              st.photos = Photos.clean(st.photos.concat(ids)); paint();
            }).catch(function () { Util.toast('照片没存上，再试一次', 'warn'); });
          });
          return;
        }
        if (b.hasAttribute('data-done')) { save(); }
      });
      var okb = api.box.querySelector('[data-ok]');
      if (okb) okb.addEventListener('click', function () { readInputs(); save(); });
      wrap.addEventListener('change', function (e) {
        var menu = e.target;
        if (!menu.hasAttribute || !menu.hasAttribute('data-edmenu')) return;
        var v = menu.value; menu.selectedIndex = 0;
        if (v === 'restock') { api.close(); openBuySheet(s.id); }
        else if (v === 'arch') { s.archived = !s.archived; s.editedAt = locNow(); Storage.save(); api.close(); Util.toast(s.archived ? '已归档「' + s.name + '」' : '已取消归档', 'ok'); global.App.rerender(); }
        else if (v === 'del') {
          api.close();
          var list = Storage.get().supplies;
          Util.removeWithUndo(list, s.id, { onSave: function () { Storage.save(); }, onAfter: function () { global.App.rerender(); }, deletedText: '已删除「' + s.name + '」' });
        }
      });
      function reopen(keep) {
        api.close();
        setTimeout(function () { openEditor(id, null, keep); }, 60);
      }
      var busy = false;
      function save() {
        if (busy) return;
        var name = String(st.name || '').trim().slice(0, NAME_MAX) || ((kindOf(st.kind) || {}).n || '');
        if (!name) { var ni = wrap.querySelector('#suName'); if (ni && Util.markInvalid) Util.markInvalid(ni, '填一下用品名称'); return; }
        if (st.link && !isUrl(st.link)) { var li = wrap.querySelector('#suLink'); if (li && Util.markInvalid) Util.markInvalid(li, '链接要以 http:// 或 https:// 开头'); else Util.toast('链接要以 http:// 或 https:// 开头', 'warn'); return; }
        busy = true;
        var dd = Storage.get();
        var it = s;
        if (!it) {
          var kk = kindOf(st.kind);
          it = { id: Util.uid(), v294: 1, name: name, cat: kk ? kk.cat : '其他', date: st.date, price: 0, availDays: 0, qty: 1, unit: kk ? kk.u : st.unit, history: [] };
          dd.supplies.push(it);
        }
        applyState(it, st, name);
        if (!Storage.save()) { busy = false; return; }
        api.close();
        Util.toast(s ? '已保存' : '已添加「' + name + '」', 'ok');
        global.App.rerender();
      }
    });
  }
  function FTUI_SV(n) { return (global.FTUI && FTUI.SV && FTUI.SV[n]) || ''; }
  function applyState(it, st, name) {
    var oldList = it.list;
    it.v294 = 1;
    it.name = name;
    it.kind = st.kind || '';
    if (st.img && Global_Photos() && Photos.validId(st.img)) it.img = st.img; else delete it.img;
    it.pieces = Math.max(0, Math.min(PIECES_MAX, r1(st.pieces)));
    it.pcsU = st.unit;
    var L = lists(Storage.get());
    it.list = L.some(function (x) { return x.id === st.list; }) ? st.list : (oldList || 'main');
    it.low = { on: !!st.lowOn, th: Math.max(0, r1(st.lowTh)) };
    it.cnt = !!st.cnt;
    var src = autoSrcFor({ kind: it.kind, pcsU: it.pcsU });
    if (src === 'fx') {
      it.fx = { canG: r1(st.canG), scoopMl: r1(st.scoopMl), scoopG: Math.round(st.scoopG * 100) / 100 };
      if (st.fxOn) armAuto(it, 'fx', 1); else if (it.auto && it.auto.src === 'fx') delete it.auto;
    } else if ((src === 'stash' || src === 'meds') && st.autoOn) {
      armAuto(it, src, src === 'meds' ? r1(st.per) : 1);
      it.auto.per = src === 'meds' ? r1(st.per) : 1;
    } else if (it.auto) delete it.auto;
    it.src = String(st.src || '').trim().slice(0, SRC_MAX);
    if (!it.src) delete it.src;
    it.bought = !!st.buyOn;
    if (st.buyOn && /^\d{4}-\d{2}-\d{2}$/.test(st.date)) it.date = st.date;
    if (!it.date) it.date = Util.todayISO();
    it.remind = st.remOn && dtOk(st.remAt) ? { on: true, at: st.remAt.slice(0, 16) } : { on: false, at: dtOk(st.remAt) ? st.remAt.slice(0, 16) : null };
    if (st.link && isUrl(st.link)) it.link = st.link.slice(0, LINK_MAX); else delete it.link;
    it.note = String(st.note || '').trim().slice(0, NOTE_MAX);
    if (!it.note) delete it.note;
    it.photos = Global_Photos() ? Photos.clean(st.photos) : [];
    if (!it.photos.length) delete it.photos;
    it.editedAt = locNow();
    return it;
  }

  /* ---------- 补货 ---------- */
  function openBuySheet(id) {
    var F = global.FTUI; if (!F) return;
    var d = Storage.get(), s = (d.supplies || []).filter(function (x) { return x && x.id === id; })[0];
    if (!s) return;
    migrate(d);
    var kk = kindOf(s.kind);
    var st = { n: s.pcsU === 'g' && s.fx && num(s.fx.canG) > 0 ? num(s.fx.canG) : (s.pcsU === 'g' || s.pcsU === 'ml' ? 100 : 1), price: '', cost: false };
    void kk;
    F.openSheet('supplies', '本次补货', '<div class="su-ed" id="suBuy"></div>', function (api) {
      api.box.closest('.modal').classList.add('su-sheet');
      var wrap = api.box.querySelector('#suBuy');
      function paint() {
        wrap.innerHTML = '<div class="su-ed-hero">' + artHTML(s, 'su-art-md') + '<p class="su-buy-n">' + esc(s.name) + '</p><p class="su-buy-s">现在剩 ' + esc(amountText(s)) + '</p></div>'
          + '<div class="su-ed-num"><div><label class="su-big"><input type="number" inputmode="decimal" id="byN" style="width:' + chW(st.n) + '" value="' + esc(st.n) + '" min="0" max="99999" step="any" aria-label="补货数量"><i>' + esc(pcsUnit(s)) + '</i></label><small>这次补了</small></div>'
          + '<span class="sd-step su-step"><button type="button" data-bstep="-1" aria-label="减少"' + (st.n > 0 ? '' : ' disabled') + '>−</button><i aria-hidden="true"></i><button type="button" data-bstep="1" aria-label="增加">+</button></span></div>'
          + '<div class="su-grp"><div class="spw-row su-prow"><span>花了多少</span><span class="su-nin"><input type="number" inputmode="decimal" id="byPrice" min="0" step="0.01" placeholder="选填" value="' + esc(st.price) + '" aria-label="价格"><i>元</i></span></div>'
          + '<label class="spw-row su-prow spw-line chk"><span>同时在记账里记这一笔</span><input type="checkbox" id="byAlsoCost"' + (st.cost ? ' checked' : '') + '></label></div>'
          + '<div class="rs-savebar"><button type="button" class="btn btn-primary rs-save" id="bySave">' + '<span>记录补货</span></button></div>';
      }
      function rd() {
        var bn = wrap.querySelector('#byN'), n = num(bn.value); if (isFinite(n) && n >= 0) st.n = Math.min(PIECES_MAX, n);
        bn.style.width = chW(bn.value);
        st.price = wrap.querySelector('#byPrice').value; st.cost = wrap.querySelector('#byAlsoCost').checked;
      }
      paint();
      wrap.addEventListener('input', rd);
      wrap.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('button') : null; if (!b) return;
        rd();
        if (b.hasAttribute('data-bstep')) { st.n = Math.max(0, r1(st.n + stepFor(pcsUnit(s)) * Number(b.getAttribute('data-bstep')))); paint(); return; }
        if (b.id === 'bySave') save();
      });
      var okb = api.box.querySelector('[data-ok]'); if (okb) okb.addEventListener('click', function () { rd(); save(); });
      var done = false;
      function save() {
        if (done) return;
        if (!(st.n > 0)) { Util.markInvalid && Util.markInvalid(wrap.querySelector('#byN'), '填一下补了多少'); return; }
        done = true;
        var dd = Storage.get(), price = parseFloat(st.price);
        if (isNaN(price) || price < 0) price = 0;
        var booked = pushFinanceRecord(dd, { alsoCost: st.cost, amount: price, cat: s.cat, date: Util.todayISO(), note: '用品 · ' + s.name });
        s.pieces = Math.min(PIECES_MAX, r1((hasPieces(s) ? s.pieces : 0) + st.n));
        if (price > 0) s.price = price;
        s.history = pushHistory(s.history, { date: Util.todayISO(), price: price, qty: st.n, unit: pcsUnit(s) });
        if (s.remind && s.remind.on && remindDue(s)) s.remind.on = false; /* 到点的提醒补完货就算办完 */
        s.editedAt = locNow();
        if (!Storage.save()) { done = false; return; }
        api.close();
        Util.toast(booked ? '已补货，并记了一笔账' : '已补货，现在剩 ' + amountText(s), 'ok');
        global.App.rerender();
      }
    });
  }

  /* ---------- 用品设置（清单）/ 提醒设置 ---------- */
  function openLists() {
    var F = global.FTUI; if (!F) return;
    var d = Storage.get();
    var rows = lists(d).map(function (x) { return { id: x.id, name: x.name }; });
    F.openSheet('supplies', '用品设置', '<div class="su-ed" id="suLs"></div>', function (api) {
      api.box.closest('.modal').classList.add('su-sheet');
      var wrap = api.box.querySelector('#suLs');
      function count(id) { return (d.supplies || []).filter(function (s) { return s && listOf(d, s) === id; }).length; }
      function paint() {
        var h = '<p class="rs-lbl">现有清单 <span class="rs-lbl-n">' + rows.length + ' 个</span></p><div class="su-grp">';
        rows.forEach(function (r, i) {
          var c = count(r.id);
          h += '<div class="spw-row su-prow' + (i ? ' spw-line' : '') + '"><input type="text" class="su-tin su-lsn" data-lsn="' + i + '" maxlength="10" value="' + esc(r.name) + '" aria-label="清单名称"><span class="su-lsc">' + c + ' 件</span>'
            + (rows.length > 1 && !c ? '<button type="button" class="spw-rm" data-lsrm="' + i + '" aria-label="删除清单">' + icon('trash') + '</button>' : '') + '</div>';
        });
        h += '</div><p class="spw-hint">至少保留一个清单；清单里还有用品时不能删。</p>';
        if (rows.length < LIST_MAX) h += '<button type="button" class="btn su-lsadd" data-lsadd>' + icon('plus') + '<span>新建清单</span></button>';
        h += '<div class="rs-savebar"><button type="button" class="btn btn-primary rs-save" data-lsok>' + '<span>完成</span></button></div>';
        wrap.innerHTML = h;
      }
      paint();
      wrap.addEventListener('input', function (e) { var i = e.target.getAttribute && e.target.getAttribute('data-lsn'); if (i != null) rows[+i].name = e.target.value; });
      function save() {
        var out = rows.map(function (r) { return { id: r.id, name: String(r.name || '').trim().slice(0, 10) }; }).filter(function (r) { return r.name; });
        if (!out.length) out = [{ id: 'main', name: '用品' }];
        d.settings.supLists = out;
        Storage.save(); api.close(); global.App.rerender();
      }
      wrap.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('button') : null; if (!b) return;
        if (b.hasAttribute('data-lsadd')) { rows.push({ id: 'l' + Util.uid().replace(/[^a-z0-9]/gi, '').slice(-8).toLowerCase(), name: '清单 ' + (rows.length + 1) }); paint(); return; }
        if (b.hasAttribute('data-lsrm')) { rows.splice(+b.getAttribute('data-lsrm'), 1); paint(); return; }
        if (b.hasAttribute('data-lsok')) save();
      });
      var okb = api.box.querySelector('[data-ok]'); if (okb) okb.addEventListener('click', save);
    });
  }
  function openRemind() {
    var F = global.FTUI; if (!F) return;
    var d = Storage.get(), on = !!d.settings.supRemind;
    F.openSheet('supplies', '用品提醒', '<div class="su-ed" id="suRm"></div>', function (api) {
      api.box.closest('.modal').classList.add('su-sheet');
      var wrap = api.box.querySelector('#suRm');
      function paint() {
        wrap.innerHTML = '<div class="su-grp"><div class="spw-row su-prow"><span class="su-rmt"><b>用品提醒</b><small>到点或低库存时，在首页提醒卡里提醒</small></span>'
          + '<button type="button" class="rs-switch" role="switch" data-rmsw aria-checked="' + on + '" aria-label="用品提醒"><i></i></button></div></div>'
          + '<p class="spw-hint">提醒只在这台手机上，打开应用时出现，不会发送到服务器。</p>'
          + '<div class="rs-savebar"><button type="button" class="btn btn-primary rs-save" data-rmok>' + '<span>完成</span></button></div>';
      }
      paint();
      function save() { d.settings.supRemind = on; Storage.save(); api.close(); global.App.rerender(); }
      wrap.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('button') : null; if (!b) return;
        if (b.hasAttribute('data-rmsw')) { on = !on; paint(); return; }
        if (b.hasAttribute('data-rmok')) save();
      });
      var okb = api.box.querySelector('[data-ok]'); if (okb) okb.addEventListener('click', save);
    });
  }

  function exportCsv(list) {
    var csv = Util.toCsv(['名称', '清单', '剩余', '单位', '低库存阈值', '类别', '购买日期', '购买来源', '单价', '归档', '备注'], list.map(function (s) {
      return [String(s.name || ''), (lists(Storage.get()).filter(function (x) { return x.id === listOf(Storage.get(), s); })[0] || {}).name || '',
        hasPieces(s) ? r1(s.pieces) : '', pcsUnit(s), lowOn(s) ? s.low.th : '', s.cat || '', s.date || '', s.src || '', s.price || 0, s.archived ? '是' : '', s.note || ''];
    }));
    Util.download('用品_' + Util.todayISO() + '.csv', csv, 'text/csv;charset=utf-8');
    Util.toast('已导出');
  }

  function canOpen() { return !document.querySelector('#modalRoot > .modal-mask:not(.sheet-leaving)'); }

  Modules.supplies = {
    id: 'supplies',
    title: '用品',

    _summary: function (list) {
      var lows = (list || []).filter(function (s) { return needRestock(s); });
      if (lows.length) return '待补货 ' + lows.length + ' 件';
      var n = (list || []).filter(function (s) { return s && !s.archived; }).length;
      if (!n) return '未记录';
      return '共 ' + n + ' 件';
    },
    _left: supplyLeft,
    _hasPieces: hasPieces,
    _pcsUnit: pcsUnit,
    _consume: consume,
    _dailyUse: dailyUse,
    /* 换尿布时可扣减的用品：没归档、有剩余数量；迁移过的看 cnt（纸尿裤 / 湿巾这类），纸尿裤排最前 */
    _countable: function (d) {
      return ((d && d.supplies) || []).filter(function (s) { return hasPieces(s) && !s.archived && (s.v294 ? !!s.cnt : true); }).sort(function (a, b) {
        return (a.cat === '纸尿裤' ? 0 : 1) - (b.cat === '纸尿裤' ? 0 : 1);
      });
    },
    _state: supplyState,
    _lows: function (list) { return (list || []).filter(function (s) { return needRestock(s); }); },
    _isLow: isLow,
    _needRestock: needRestock,
    _remindDue: remindDue,
    _findDuplicate: findDuplicate,
    _upsert: upsertSupply,
    _pushHistory: pushHistory,
    _toFinanceCat: toFinanceCat,
    _pushFinanceRecord: pushFinanceRecord,
    _monthSpend: monthSpend,
    _CAT_TO_FINANCE: CAT_TO_FINANCE,
    _CATS: CATS,
    _KINDS: KINDS,
    _migrate: migrate,
    _sync: syncAuto,
    _desired: desired,
    _lists: lists,
    _amount: amountText,
    _openBuySheet: openBuySheet,
    _openEditor: function (id, preset) { openEditor(id, preset); },
    _openPicker: openPicker,
    _ui: ui,

    render: function (view) {
      var d = Storage.get();
      if (!Array.isArray(d.supplies)) d.supplies = [];
      if (migrate(d)) Storage.save();
      view.innerHTML = '<div class="ft-page su-page" data-accent="supplies">' + pageHTML(d) + '</div>';
      if (Global_Photos()) Photos.hydrate(view);
      var q = view.querySelector('#suQ');
      q.addEventListener('input', function () {
        ui.q = q.value.trim().slice(0, 20);
        var pos = q.selectionStart;
        global.App.rerender();
        var q2 = document.getElementById('suQ');
        if (q2) { q2.focus(); try { q2.setSelectionRange(pos, pos); } catch (e) {} }
      });
      view.querySelector('#suFilter').addEventListener('change', function () { ui.filter = this.value; global.App.rerender(); });
      var mn = view.querySelector('#suMenu');
      mn.addEventListener('change', function () {
        var v = mn.value; mn.selectedIndex = 0;
        if (!canOpen()) return;
        if (v === 'lists') openLists(); else if (v === 'remind') openRemind();
      });
      var fc = view.querySelector('[data-fclr]');
      if (fc) fc.addEventListener('click', function () { ui.filter = 'all'; global.App.rerender(); });
      Array.prototype.forEach.call(view.querySelectorAll('[data-sutab]'), function (b) {
        b.addEventListener('click', function () { ui.tab = b.getAttribute('data-sutab'); global.App.rerender(); });
      });
      Array.prototype.forEach.call(view.querySelectorAll('[data-suadd]'), function (b) {
        b.addEventListener('click', function () { if (canOpen()) openPicker(function (r) { openEditor(null, r); }); });
      });
      Array.prototype.forEach.call(view.querySelectorAll('[data-suopen]'), function (b) {
        b.addEventListener('click', function () { if (canOpen()) openEditor(b.getAttribute('data-suopen')); });
      });
      var ex = view.querySelector('#spExport');
      if (ex) ex.addEventListener('click', function () { exportCsv(d.supplies); });
    }
  };
})(window);
