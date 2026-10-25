/**
 * supplies.js - 消耗品与补货提醒（第 107 次）
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
  function pcsUnit(s) { return s && s.cat === '纸尿裤' ? '片' : (s && s.cat === '清洁' ? '抽' : '个'); }
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

  /* ---------- 渲染 ---------- */


  Modules.supplies = {
    id: 'supplies',
    title: '消耗品',

    /* 供首页磁贴/提醒复用：低库存摘要，纯读取 */
    _summary: function (list) {
      var lows = lowSupplies(list);
      if (lows.length) return '需补货 ' + lows.length + ' 件';
      if (!list || !list.length) return '未记录';
      return '充足';
    },

    _left: supplyLeft,
    _hasPieces: hasPieces,
    _pcsUnit: pcsUnit,
    _consume: consume,
    _dailyUse: dailyUse,
    /* 可扣减的用品：填了片数的那些，纸尿裤排最前 */
    _countable: function (d) {
      return ((d && d.supplies) || []).filter(hasPieces).sort(function (a, b) {
        return (a.cat === '纸尿裤' ? 0 : 1) - (b.cat === '纸尿裤' ? 0 : 1);
      });
    },
    _state: supplyState,
    _lows: lowSupplies,
    _findDuplicate: findDuplicate,
    /* 第 107 次：导出 upsert 与 pushHistory 供 QA 直接驱动真实写入路径。
       查重是这个模块唯一的不变量守卫，只测 findDuplicate 等于没测——
       真正决定「会不会多出一行」的是 upsert 里那个 if (dup) 分支。 */
    _upsert: upsertSupply,
    _pushHistory: pushHistory,
    /* 第 112 次：导出联动三件套供 QA 直接断言。
       monthSpend 显式收 todayISO，让「本月」口径可被测试固定住，
       不用依赖跑测试那一刻的真实月份。 */
    _toFinanceCat: toFinanceCat,
    _pushFinanceRecord: pushFinanceRecord,
    _monthSpend: monthSpend,
    _CAT_TO_FINANCE: CAT_TO_FINANCE,
    _CATS: CATS,
    /* 第 112 次：新购弹层的联动也得能被 QA 驱动。
       openBuySheet 走 sheet() 弹层，测试无法通过点击清单里的「＋购」进到这里，
       所以把已有函数直接导出——不改逻辑，只暴露入口。
       没有它的话，「新购时能不能记上账」这条路径会完全没有测试覆盖：
       变异体把这里的 pushFinanceRecord 删掉，纳入的所有套件都抓不到。 */
    _openBuySheet: openBuySheet,

    render: function (view) {
      var d = Storage.get();
      if (!Array.isArray(d.supplies)) d.supplies = [];
      var list = d.supplies;
      var lows = lowSupplies(list);
      var html = '';

      /* 顶部补货提醒：只在真有需要时出现，不常驻占位 */
      if (lows.length) {
        html += '<div class="warn-box"><b>该补货了</b>：'
          + lows.map(function (s) {
              return Util.escapeHtml(s.name) + (hasPieces(s) ? '（剩 ' + s.pieces + pcsUnit(s) + '）' : '（剩 ' + supplyLeft(s) + ' 天）');
            }).join('、')
          + '</div>';
      }

      /* 新增表单 */
      html += '<div class="card"><h2>记一件消耗品</h2>';

      /* 第 116 次：常用模板。放在名称输入框【之前】——
         先点模板省掉打字，点不到模板再用下面的手输，顺序不能反。
         模板只填名称/单位/可用天数/数量，不碰价格（价格每次都不同，猜不得）。 */
      html += '<div class="sp-tpl" id="spTplBox">'
        + '<div class="sp-tpl-hint">选一个省打字（价格还是自己填）</div><div class="sp-tpl-row" id="spTplRow">';
      (TEMPLATES[CATS[0]] || []).forEach(function (t, i) {
        html += '<button class="sp-tpl-btn" type="button" data-tpl="' + i + '">' + Util.escapeHtml(t.n) + '</button>';
      });
      html += '</div></div>';

      html += '<label>名称<input type="text" id="spName" placeholder="如：纸尿裤 L码"></label>';
      html += '<label>类别<select id="spCat">';
      CATS.forEach(function (c) {
        html += '<option value="' + c + '">' + c + '</option>';
      });
      html += '</select></label>';

      html += '<div class="row2">';
      html += '<label>购买日期<input type="date" id="spDate" value="' + Util.todayISO() + '"></label>';
      html += '<label>价格（元）<input type="number" id="spPrice" step="0.01" min="0" inputmode="decimal"></label>';
      html += '</div>';
      html += '<div class="row2">';
      html += '<label>能用多少天<input type="number" id="spAvail" step="1" min="0" inputmode="numeric" placeholder="如 30"></label>';
      html += '<label>数量<input type="number" id="spQty" step="1" min="0" inputmode="numeric" value="1"></label>';
      html += '</div>';
      html += '<label>一共几片 / 几抽<span class="hint-inline">（可选，填了就能随换尿布自动扣减）</span><input type="number" id="spPieces" step="1" min="0" inputmode="numeric" placeholder="如 2 包 × 60 片 = 120"></label>';
      html += '<label>单位<select id="spUnit">';
      UNITS.forEach(function (u) { html += '<option value="' + u + '">' + u + '</option>'; });
      html += '</select></label>';
      /* 第 112 次：勾上则本次购买同时在记账里记一笔。
         默认不勾——记账是「钱花了」的决定，消耗品是「东西没了」的事实，
         两者不该默认绑在一起，勾选权交给用户。 */
      html += '<label class="chk"><input type="checkbox" id="spAlsoCost">'
        + '同时在记账里记这一笔<span class="hint-inline" id="spAlsoCostHint"></span></label>';
      html += '<p class="hint">同名同一天再记会并入原来那条，不会多出一行。</p>';
      html += '<button class="btn btn-primary btn-save" id="spSave">保存</button></div>';

      /* 清单 */
      html += '<div class="card"><h2>清单</h2>';
      if (!list.length) {
        html += '<div class="empty-state"><span class="es-ico">' + icon('supplies') + '</span><p>清单还是空的</p><span class="hint">填上「能用多少天」，这里会算出还剩几天。</span></div>';
      } else {
        var sorted = list.slice().sort(function (a, b) { return supplyLeft(a) - supplyLeft(b); });
        html += '<ul class="list">';
        sorted.forEach(function (s) {
          var left = supplyLeft(s);
          var st = supplyState(left);
          var qty = parseInt(s.qty, 10) || 1;
          var unit = s.unit || '件';
          /* 第 112 次：本月该品类在记账里花了多少（渲染期派生，不落库）。
             与用户自己的账单比，不与他人比。 */
          var ms = monthSpend(d.finance && d.finance.records, s.cat);
          /* 第 226 次：原来的行把 9 个子元素塞进一条横向 flex，名称被挤成 0 宽、按钮溢出屏外。
             改成专用的三段式网格：图标 | 名称+购买信息 | 剩余数；进度条整行；状态 + 操作一行。 */
          var numHtml = hasPieces(s)
            ? s.pieces + '<i>' + pcsUnit(s) + '</i>'
            : left + '<i>天</i>';
          var rate = hasPieces(s) ? dailyUse(s.id, d) : 0;
          html += '<li class="sup-row">'
            + '<span class="sup-ico">' + icon('supplies') + '</span>'
            + '<span class="sup-main"><b>' + Util.escapeHtml(s.name) + '</b>'
            + '<small>' + Util.escapeHtml(s.cat || '') + ' · ' + Util.fmtDate(s.date) + ' 买 · ' + qty + Util.escapeHtml(unit)
            + (s.price > 0 ? ' · ' + s.price.toFixed(2) + ' 元' : '') + '</small></span>'
            + '<span class="sup-num ' + st.cls + '">' + numHtml + '</span>'
            + '<div class="sup-bar"><i style="width:' + leftPercent(s) + '%"></i></div>'
            + '<span class="sup-state"><b class="' + st.cls + '">' + st.text + '</b>'
            + (hasPieces(s) ? (rate > 0 ? ' · 每天约 ' + (Math.round(rate * 10) / 10) + pcsUnit(s) + '，够用 ' + left + ' 天' : ' · 换尿布时自动扣减') : '')
            + (ms > 0 ? ' · 本月该品类 ' + ms.toFixed(2) + ' 元' : '')
            + '</span>'
            + '<span class="sup-acts">'
            + '<button class="icon-btn" data-spbuy="' + s.id + '" title="记录新购">＋购</button>'
            + '<button class="icon-btn" data-spedit="' + s.id + '" title="修改">改</button>'
            + '<button class="icon-btn" data-spdel="' + s.id + '" title="删除">✕</button>'
            + '</span></li>';
        });
        html += '</ul>';
      }
      html += '<button class="btn" id="spExport">导出本模块 CSV</button></div>';

      /* 价格历史：只在有 2 条以上（说明复购过）才有意义 */
      var multi = list.filter(function (s) { return Array.isArray(s.history) && s.history.length > 1; });
      if (multi.length) {
        html += '<div class="card"><h2>复购记录</h2><ul class="kv">';
        multi.forEach(function (s) {
          var prices = s.history.map(function (h) { return h.price; }).filter(function (x) { return x > 0; });
          var min = prices.length ? Math.min.apply(null, prices) : 0;
          var max = prices.length ? Math.max.apply(null, prices) : 0;
          html += '<li>' + Util.escapeHtml(s.name)
            + '：买了 ' + s.history.length + ' 次'
            + (prices.length ? '，' + min.toFixed(2) + '–' + max.toFixed(2) + ' 元' : '')
            + '</li>';
        });
        html += '</ul><p class="hint">和你自己历次买的价格比，不跟别人比。</p></div>';
      }

      view.innerHTML = html;

      /* 第 112 次：勾选框旁实时显示「会记到记账的哪个类别」。
         类别映射里有 4 类不是同名（清洁/辅食/维D药品/出行），不提前告诉用户，
         他会以为账记错了。 */
      var catSel = view.querySelector('#spCat');
      var costHint = view.querySelector('#spAlsoCostHint');
      if (catSel && costHint) {
        var refreshHint = function () {
          var fc = toFinanceCat(catSel.value);
          costHint.textContent = fc === catSel.value ? '' : '（记到「' + fc + '」）';
        };
        catSel.addEventListener('change', refreshHint);
        refreshHint();
      }

      /* 第 116 次：模板交互。
         - 切类别 → 重绘模板行（不同品类的常用物不一样）
         - 点模板 → 填名称/单位/可用天数/数量，并聚焦到价格框（下一步只剩填价格）
         刻意不填价格：价格每家每次都不同，猜错比不填更糟。
         填完给一次 toast，让用户确知「已填好，接下来只剩价格」。 */
      var tplRow = view.querySelector('#spTplRow');
      var tplBox = view.querySelector('#spTplBox');

      function paintTemplates() {
        if (!tplRow || !catSel) return;
        var items = TEMPLATES[catSel.value] || [];
        if (!items.length) {
          /* 「其他」类无模板：整块隐藏，不留一块空白占位 */
          if (tplBox) tplBox.style.display = 'none';
          return;
        }
        if (tplBox) tplBox.style.display = '';
        tplRow.innerHTML = items.map(function (t, i) {
          return '<button class="sp-tpl-btn" type="button" data-tpl="' + i + '">' + Util.escapeHtml(t.n) + '</button>';
        }).join('');
      }

      if (tplRow && catSel) {
        /* 换类别时重绘：整体换掉行内节点，事件用委托挂在行上，不逐个重绑 */
        catSel.addEventListener('change', paintTemplates);
        tplRow.addEventListener('click', function (ev) {
          var btn = ev.target.closest ? ev.target.closest('[data-tpl]') : null;
          if (!btn) return;
          var items = TEMPLATES[catSel.value] || [];
          var t = items[parseInt(btn.getAttribute('data-tpl'), 10)];
          if (!t) return;
          var nameEl = view.querySelector('#spName');
          var unitEl = view.querySelector('#spUnit');
          var availEl = view.querySelector('#spAvail');
          var qtyEl = view.querySelector('#spQty');
          if (nameEl) nameEl.value = t.n;
          /* 单位下拉未必含模板单位（如「本」不在 UNITS 里）：不静默丢，
             找不到就补一个 option 选中，保证「填了就是那个单位」 */
          if (unitEl) {
            var found = false;
            for (var i = 0; i < unitEl.options.length; i++) {
              if (unitEl.options[i].value === t.u) { found = true; break; }
            }
            if (!found) {
              var op = document.createElement('option');
              op.value = t.u; op.textContent = t.u;
              unitEl.appendChild(op);
            }
            unitEl.value = t.u;
          }
          /* 可用天数 0 = 耐用品（安全座椅/体温计），不占天数，模板里已按0 给 */
          if (availEl) availEl.value = t.d > 0 ? t.d : '';
          if (qtyEl) qtyEl.value = t.q || 1;
          var priceEl = view.querySelector('#spPrice');
          if (priceEl) { priceEl.focus(); }
          if (global.Util && Util.toast) {
            Util.toast('已填好「' + t.n + '」，填个价格就能存', 'ok');
          }
        });
        paintTemplates();
      }

      /* ---------- 事件 ---------- */
      var saveBtn = view.querySelector('#spSave');
      if (saveBtn) {
        saveBtn.addEventListener('click', function () {
          var nameEl = view.querySelector('#spName');
          var res = upsertSupply(list, {
            name: nameEl.value,
            cat: view.querySelector('#spCat').value,
            date: view.querySelector('#spDate').value || Util.todayISO(),
            price: view.querySelector('#spPrice').value,
            availDays: view.querySelector('#spAvail').value,
            qty: view.querySelector('#spQty').value,
            unit: view.querySelector('#spUnit').value,
            pieces: (view.querySelector('#spPieces') || {}).value
          });
          if (res.error) { Util.markInvalid(nameEl, res.error); return; }
          /* 第 112 次：联动写账。放在 Storage.save() 之前，
             两边写的是同一个 d 对象，一次落盘即可，不多调一次 save。 */
          var catVal = view.querySelector('#spCat').value;
          var priceVal = view.querySelector('#spPrice').value;
          var dateVal = view.querySelector('#spDate').value || Util.todayISO();
          var alsoEl = view.querySelector('#spAlsoCost');
          var booked = pushFinanceRecord(d, {
            alsoCost: !!(alsoEl && alsoEl.checked),
            amount: priceVal,
            cat: catVal,
            date: dateVal,
            note: '消耗品 · ' + res.item.name
          });
          Storage.save();
          Util.toast(booked
            ? '已记下，并记了一笔账'
            : (res.merged ? '已并入原有那条' : '已记下'));
          global.App.rerender();
        });
      }

      Array.prototype.forEach.call(view.querySelectorAll('[data-spbuy]'), function (b) {
        b.addEventListener('click', function () {
          var id = b.getAttribute('data-spbuy');
          openBuySheet(id, list, view);
        });
      });

      Array.prototype.forEach.call(view.querySelectorAll('[data-spedit]'), function (b) {
        b.addEventListener('click', function () {
          var id = b.getAttribute('data-spedit');
          openEditSheet(id, list, view);
        });
      });

      Array.prototype.forEach.call(view.querySelectorAll('[data-spdel]'), function (b) {
        b.addEventListener('click', function () {
          var id = b.getAttribute('data-spdel');
          var item = list.filter(function (x) { return x.id === id; })[0];
          if (!item) return;
          Util.removeWithUndo(list, id, {
            onSave: function () { Storage.save(); },
            onAfter: function () { global.App.rerender(); },
            deletedText: '已删除 ' + item.name
          });
        });
      });

      var expBtn = view.querySelector('#spExport');
      if (expBtn) {
        expBtn.addEventListener('click', function () {
          var lines = ['名称,类别,购买日期,单价,数量,单位,可用天数,剩余天数,剩余片数'];
          list.forEach(function (s) {
            lines.push([
              '"' + String(s.name || '').replace(/"/g, '""') + '"',
              s.cat || '', s.date || '',
              s.price || 0, parseInt(s.qty, 10) || 1, s.unit || '',
              s.availDays || 0, supplyLeft(s), hasPieces(s) ? s.pieces : ''
            ].join(','));
          });
          Util.download('消耗品_' + Util.todayISO() + '.csv', lines.join('\n'), 'text/csv');
          Util.toast('已导出');
        });
      }
    }
  };

  /* ---------- 两个编辑弹层 ---------- */

  function sheet(title, inner, onMount) {
    var root = document.getElementById('modalRoot');
    if (!root) return null;
    root.innerHTML =
      '<div class="modal-mask" data-sup-mask>' +
      '<div class="modal" role="dialog" aria-modal="true" aria-label="' + Util.escapeHtml(title) + '">' +
      '<h3>' + Util.escapeHtml(title) + '</h3>' + inner +
      '<div class="modal-actions"><button class="btn" data-sup-cancel>取消</button></div>' +
      '</div></div>';
    root.querySelector('[data-sup-cancel]').addEventListener('click', closeSheet);
    root.querySelector('[data-sup-mask]').addEventListener('click', function (ev) {
      if (ev.target === this) closeSheet();
    });
    if (typeof onMount === 'function') onMount(root);
    return root;
  }

  function closeSheet() {
    var root = document.getElementById('modalRoot');
    if (root) root.innerHTML = '';
  }

  /** 修改：走 upsert 时把自身排除，否则会跟自己「同名同日期」判定为重复。 */
  function openEditSheet(id, list, view) {
    var s = list.filter(function (x) { return x.id === id; })[0];
    if (!s) return;
    sheet('修改 ' + s.name,
      '<label>名称<input type="text" id="edName" value="' + Util.escapeHtml(s.name) + '"></label>' +
      '<label>类别<select id="edCat">' + CATS.map(function (c) {
        return '<option value="' + c + '"' + (c === s.cat ? ' selected' : '') + '>' + c + '</option>';
      }).join('') + '</select></label>' +
      '<div class="row2">' +
      '<label>购买日期<input type="date" id="edDate" value="' + Util.escapeHtml(s.date || '') + '"></label>' +
      '<label>能用多少天<input type="number" id="edAvail" value="' + (parseInt(s.availDays, 10) || 0) + '" min="0" step="1"></label>' +
      '</div>' +
      '<label>还剩几' + pcsUnit(s) + '（可选，换尿布自动扣减）<input type="number" id="edPieces" value="' + (hasPieces(s) ? s.pieces : '') + '" min="0" step="1" inputmode="numeric" placeholder="不填 = 不参与扣减"></label>' +
      '<button class="btn btn-primary" style="width:100%" id="edSave">保存</button>',
      function (root) {
        root.querySelector('#edSave').addEventListener('click', function () {
          var name = root.querySelector('#edName').value;
          var date = root.querySelector('#edDate').value || s.date;
          /* 排除自身后再查重：改名或改日期时若撞上别的行，仍然要拦住 */
          var others = list.filter(function (x) { return x.id !== id; });
          var clash = findDuplicate(others, name, date);
          if (clash) {
            Util.markInvalid(root.querySelector('#edName'), '已有一条同名同日期的记录');
            return;
          }
          s.name = String(name).trim();
          s.cat = root.querySelector('#edCat').value;
          s.date = date;
          s.availDays = parseInt(root.querySelector('#edAvail').value, 10) || 0;
          var ep = parsePieces(root.querySelector('#edPieces').value);
          if (ep === null) delete s.pieces; else s.pieces = ep;
          Storage.save();
          closeSheet();
          global.App.rerender();
        });
      });
  }

  /** 新购：库存累加 + 可用天数按「原剩余 + 新批次」累加。 */
  function openBuySheet(id, list, view) {
    var s = list.filter(function (x) { return x.id === id; })[0];
    if (!s) return;
    var left = supplyLeft(s);
    var qty = parseInt(s.qty, 10) || 1;
    sheet('新购 · ' + s.name,
      '<p class="hint">当前 ' + qty + (s.unit || '件') + '，还剩 ' + left + ' 天。' +
      '记录后库存累加，总剩余 = 现在的 ' + left + ' 天 + 新买这批能用的天数。</p>' +
      '<div class="row2">' +
      '<label>新购日期<input type="date" id="byDate" value="' + Util.todayISO() + '"></label>' +
      '<label>新购价格（元）<input type="number" id="byPrice" value="' + (s.price || '') + '" step="0.01" min="0" inputmode="decimal"></label>' +
      '</div>' +
      '<div class="row2">' +
      '<label>这次买几' + (s.unit || '件') + '<input type="number" id="byQty" value="1" min="0" step="1" inputmode="numeric"></label>' +
      '<label>这批能用多少天<input type="number" id="byAvail" value="' + (s.availDays || '') + '" min="0" step="1" inputmode="numeric"></label>' +
      '</div>' +
      '<label>这次一共几' + pcsUnit(s) + '（可选）<input type="number" id="byPieces" min="0" step="1" inputmode="numeric" placeholder="' + (hasPieces(s) ? '现有 ' + s.pieces + pcsUnit(s) + '，会加上去' : '填了就能随换尿布扣减') + '"></label>' +
      /* 第 112 次：新购同样可以联动写账。默认不勾，理由同主表单。 */
      '<label class="chk"><input type="checkbox" id="byAlsoCost">同时在记账里记这一笔</label>' +
      '<button class="btn btn-primary" style="width:100%" id="bySave">记录新购</button>',
      function (root) {
        root.querySelector('#bySave').addEventListener('click', function () {
          var addQty = parseInt(root.querySelector('#byQty').value, 10);
          if (isNaN(addQty) || addQty < 0) addQty = 1;
          var addAvail = parseInt(root.querySelector('#byAvail').value, 10);
          if (isNaN(addAvail) || addAvail < 0) addAvail = 0;
          var price = parseFloat(root.querySelector('#byPrice').value);
          if (isNaN(price) || price < 0) price = 0;
          var date = root.querySelector('#byDate').value || Util.todayISO();

          var alsoEl = root.querySelector('#byAlsoCost');
          var booked = pushFinanceRecord(Storage.get(), {
            alsoCost: !!(alsoEl && alsoEl.checked),
            amount: price,
            cat: s.cat,
            date: date,
            note: '消耗品 · ' + s.name
          });

          s.qty = (parseInt(s.qty, 10) || 1) + addQty;
          s.availDays = left + addAvail;
          s.date = date;
          s.price = price;
          s.history = pushHistory(s.history, { date: date, price: price, qty: addQty, unit: s.unit || '' });
          var bp = parsePieces(root.querySelector('#byPieces').value);
          if (bp !== null) s.pieces = Math.min(PIECES_MAX, (hasPieces(s) ? s.pieces : 0) + bp);
          Storage.save();
          closeSheet();
          Util.toast('已记录新购');
          global.App.rerender();
        });
      });
  }
})(window);
