/**
 * feeding.js - 喂养记录
 * 母乳/奶瓶/奶粉/辅食；一键快速记录（时长/奶量）；支持夜间深色模式（全局）。
 *
 * 第 110 次：辅食观察期的「引入项」口径跟随第 108 次结构化字段修正，
 *           详见下方 solidIntro 的注释。
 */
(function (global) {
  'use strict';
  var Storage = global.Storage, Util = global.Util;
  var Modules = global.Modules = global.Modules || {};

  var TYPES = [
    { v: 'breast', t: '母乳' },
    { v: 'bottle', t: '奶瓶' },
    { v: 'formula', t: '奶粉' },
    { v: 'pump', t: '吸奶' },
    { v: 'solid', t: '辅食' }
  ];

  /* ============================================================
     第 108 次 · 辅食结构化（不新建模块，仍落d.feedings）
     ============================================================
     起因：喂养模块第 69 次已有辅食（type='solid'），但食材只能塞进 note 自由文本，
     回头看不清「这顿到底放了什么」。

     参照资料库「辅食日记」的设计，但只抄它对的部分：
       ing   存纯 text「荤：猪里脊肉末50g｜素：番茄1个｜主食：宝宝面条50g」
             —— 一个 ｜ 分一段，段首「荤/素/主食：」是类型标签。
       steps 存一整句话，展示时按句号/换行拆成步骤，不做结构化存储。

     为什么这样存：省结构、可读、以后想算「荤素比例」不用迁移老数据。
     为什么不做「多吃了几次」的多行记录：那是参考实现 19 行只有 1 道菜的根因。

     查重不变量（同日期 + 同菜名 = 同一顿）：
       参考实现的 openFoodRec 无条件 push，同一天点 5 次就是 5 行。
       本模块在 push 前按「日期 + 菜名」查重，命中时改为更新那一行，
       与消耗品模块（第 107 次）用同一个守卫思路。 */

  var ING_KINDS = ['荤', '素', '主食'];

  /* 食材类型 → CSS 类名。用 ASCII 而不是直接拼中文类名：
     非 ASCII 类名虽能跑，但转义与工具链兼容上是隐患。 */
  var ING_CLS = { '荤': 'ing-meat', '素': 'ing-veg', '主食': 'ing-staple' };

  function ingCls(kind) {
    return ING_CLS[kind] || 'ing-x';
  }

  /**
   * 解析食材分段。纯读取，不改入参。
   * 输入 '荤：肉末50g｜素：番茄1个' → [{kind:'荤',text:'肉末50g'},{kind:'素',text:'番茄1个'}]
   * 没有「xx：」前缀的段归为 {kind:'其他'}，不丢内容。
   */
  function parseIngredients(raw) {
    var s = String(raw == null ? '' : raw);
    if (!s.trim()) return [];
    return s.split('｜').map(function (part) {
      var t = part.trim();
      if (!t) return null;
      var m = t.match(/^(荤|素|主食)\s*[:：]\s*(.*)$/);
      if (m) return { kind: m[1], text: m[2] || '' };
      /* 顶格没有类型前缀的：整体当「其他」，一个字符都不丢 */
      return { kind: '其他', text: t.replace(/^[:：]\s*/, '') };
    }).filter(Boolean);
  }

  /** 把用户输入的食材整理成规范分段文本（去空白、丢弃空段）。 */
  function normalizeIngredients(raw) {
    return parseIngredients(raw).map(function (p) {
      return p.kind === '其他' ? p.text : (p.kind + '：' + p.text);
    }).filter(function (t) { return t && t.replace(/^(荤|素|主食)：/, '').trim(); }).join('｜');
  }

  /** 做法：一句话存，展示时拆步骤。按句号或换行断，滤掉空段。 */
  function splitSteps(raw) {
    return String(raw == null ? '' : raw).split(/[。\n]/)
      .map(function (x) { return x.trim(); })
      .filter(Boolean);
  }

  /**
   * 辅食查重：同一天 + 同一道菜名 = 同一顿，命中就不新增行。
   * name 取菜名（辅食的「菜名」= 标题，没有就退回 newFood，再退回 note 首段）。
   * excludeId 用于修改场景排除自身。
   */
  function findSolidDuplicate(list, date, name, excludeId) {
    var target = String(name == null ? '' : name).trim();
    if (!target) return null;
    if (!Array.isArray(list)) return null;
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (!r || r.type !== 'solid') continue;
      if (excludeId && r.id === excludeId) continue;
      if ((r.start || '').slice(0, 10) !== date) continue;
      if (String(r.dish || '').trim() === target) return r;
    }
    return null;
  }

  /** 辅食的显示名：dish 优先，其次 newFood，最后 note 的第一段。 */
  function solidName(r) {
    if (!r) return '';
    if (r.dish && String(r.dish).trim()) return String(r.dish).trim();
    if (r.newFood && String(r.newFood).trim()) return String(r.newFood).trim();
    var n = String(r.note || '').trim();
    if (!n) return '';
    /* 老数据（只有 note 一大坨）：取第一个句号前的那句当菜名 */
    var head = n.split(/[。\n]/)[0].trim();
    return head.length > 24 ? head.slice(0, 24) + '…' : head;
  }

  /**
   * 第 110 次：这条辅食记录「引入了什么」的显示文本，供观察期卡使用。
   *
   * 为什么需要单独一个函数（第 108 次遗留的那条）：
   *   第 69 次做观察期提示时，辅食只有 newFood 一个字段能标识「新引入」。
   *   第 108 次加了 dish / ing / steps 并把 dish 立为主字段，
   *   于是绝大多数记录（只填菜名、或菜名+食材）newFood 都是空的——
   *   观察期卡仍只筛 r.newFood，等于这项功能被新字段架空了：
   *   探针实测「dish」「dish+ing」两种最典型用法都不触发提示。
   *
   * 口径（按可信度排序）：
   *   1. newFood——用户明确标了「新食材」，最可信，原样显示。
   *   2. dish——第 108 次的主字段。菜名本身就是「这顿吃了什么」，
   *      足以让家长知道自己在观察哪一样。
   *   3. ing——只有食材没菜名时，取各分段摘要（最多两段，多了截断），
   *      仍读得出「引入了什么」。
   *   4. note 首段——纯老数据兜底，与 solidName 同一口径。
   *
   * 只读不改，不落库，不判达标：观察期只是「提醒别急着加新食材」，
   * 医学判断仍交给医生。
   */
  function solidIntro(r) {
    if (!r) return '';
    if (r.newFood && String(r.newFood).trim()) return String(r.newFood).trim();
    if (r.dish && String(r.dish).trim()) return String(r.dish).trim();
    var segs = parseIngredients(r.ing);
    if (segs.length) {
      var txt = segs.map(function (p) { return p.text; })
        .filter(function (t) { return t && t.trim(); })
        .slice(0, 2)
        .join('、');
      if (txt) return txt.length > 24 ? txt.slice(0, 24) + '…' : txt;
    }
    return solidName(r);
  }

  /* ============================================================
     第 131 次（P1-b · 对标 Cali FeedingInsightSeries / WeeklyFeedingSummary /
     BottleMilkSource）：近 7 日瓶喂洞察。
     ------------------------------------------------------------
     抄 Cali 的三件事，不抄的也写明：
       · weeklyTotal / dailyAverage——周总量与日均（Caliber 的
         FeedingInsightSeries 同名字段），只对**有量的记录**算：
         瓶喂/奶粉有 ml，亲喂没有量，吸奶不是宝宝摄入——都不硬凑数；
       · hasMixedBottleSources——混合奶源提示（这周同时用了母乳瓶喂
         与配方奶时提醒标注，回头才分得清）；
       · 不抄 ProjectedBreastMilkInsightSeries（预测型 UI）：那需要
         吸奶量反推摄入模型，我们没有也不该编（U-25 不下结论）。
     口径：滚动 7×24 小时窗口（与「下次喂奶参考」的 48h 窗口同风格）；
     日均按「有瓶喂记录的天数」摊，不按 7 天摊——只记了 3 天时
     除以 7 会凭空说成「喝得少」。参照只来自用户自己的记录（U-24）。
     ============================================================ */
  function insight7d(d, now) {
    now = now || Date.now();
    var cut = now - 7 * 86400000;
    var win = (d.feedings || []).filter(function (r) {
      return r.start && new Date(r.start).getTime() >= cut;
    });
    var bottle = win.filter(function (r) { return r.type === 'bottle' || r.type === 'formula'; });
    var breastN = win.filter(function (r) { return r.type === 'breast'; }).length;
    /* 卡是「瓶喂洞察」：瓶喂 <2 次不出卡——纯亲喂家庭摆一排 0 ml
       统计数是噪声不是洞察（亲喂没有量，第 131 次起明说不进统计）。 */
    if (bottle.length < 2) return null;
    var total = 0, bmMl = 0, fmMl = 0, days = {};
    bottle.forEach(function (r) {
      /* 新数据：amountBm/amountFm 分源；旧数据只有 amount——无法分源时
         整体计母乳（第 43 次之前的记录瓶喂只有母乳一种，这个回落不失真）。 */
      var bm = r.amountBm || 0, fm = r.amountFm || 0;
      if (!bm && !fm && r.amount) bm = r.amount;
      bmMl += bm; fmMl += fm; total += bm + fm;
      days[Util.fmtDate(r.start)] = 1;
    });
    var dayN = Object.keys(days).length;
    return {
      total: total,
      avg: dayN ? Math.round(total / dayN) : 0,
      days: dayN,
      count: bottle.length,
      breastN: breastN,
      mixed: bmMl > 0 && fmMl > 0
    };
  }

  /* 第 201 次：储奶（吸出来存冰箱 / 冰柜的奶）。
     时长参照 CDC《Breast Milk Storage and Preparation》（2026-08）：新鲜吸出的奶冷藏最多 4 天；
     冷冻约 6 个月内最好，最长 12 个月。只按记录的吸出时间算「已存几天」并对照这几个时长，
     不判断能不能喝——冰箱温度、解冻情况本工具不知道。先吸的先用，列表按吸出时间从早到晚。 */
  var STASH_PLACE = { fridge: '冷藏', freezer: '冷冻' };
  function stashValid(x) {
    return x && typeof x === 'object' && x.id && STASH_PLACE[x.place] && typeof x.amount === 'number' && isFinite(x.amount) && x.amount > 0
      && !isNaN(new Date(x.time).getTime());
  }
  function stashAge(x) {
    var ms = Date.now() - new Date(x.time).getTime();
    var days = Math.floor(ms / 86400000);
    var tag = '';
    if (x.place === 'fridge' && ms > 4 * 86400000) tag = '已超过冷藏 4 天';
    else if (x.place === 'freezer' && days > 365) tag = '已超过冷冻 12 个月';
    else if (x.place === 'freezer' && days > 182) tag = '已超过冷冻 6 个月';
    return { text: days < 1 ? '不到 1 天' : '已存 ' + days + ' 天', tag: tag };
  }
  function stashCard(d, sortedFeeds) {
    var all = Array.isArray(d.milkStash) ? d.milkStash.filter(stashValid) : [];
    var lastPump = sortedFeeds.filter(function (r) { return r.type === 'pump' && typeof r.amount === 'number' && r.amount > 0; })[0];
    if (!all.length && !lastPump) return '';
    var inStock = all.filter(function (x) { return !x.usedAt; }).sort(function (a, b) { return new Date(a.time) - new Date(b.time); });
    var h = '<div class="card stash-card" id="stashCard"><h2>储奶</h2>';
    var sum = { fridge: [0, 0], freezer: [0, 0] };
    inStock.forEach(function (x) { sum[x.place][0]++; sum[x.place][1] += x.amount; });
    h += '<div class="stat-row">'
      + '<div class="stat"><span class="stat-num">' + sum.fridge[1] + '<i class="stat-unit">ml</i></span><span class="hint">冷藏 ' + sum.fridge[0] + ' 份</span></div>'
      + '<div class="stat"><span class="stat-num">' + sum.freezer[1] + '<i class="stat-unit">ml</i></span><span class="hint">冷冻 ' + sum.freezer[0] + ' 份</span></div></div>';
    var stashedIds = {};
    all.forEach(function (x) { if (x.fromId) stashedIds[x.fromId] = 1; });
    if (lastPump && !stashedIds[lastPump.id]) {
      h += '<div class="row stash-quick"><button type="button" class="btn" data-stash-from="' + Util.escapeHtml(String(lastPump.id)) + '" data-place="fridge">把最近一次吸奶 ' + lastPump.amount + ' ml 存冷藏</button>'
        + '<button type="button" class="btn" data-stash-from="' + Util.escapeHtml(String(lastPump.id)) + '" data-place="freezer">存冷冻</button></div>';
    }
    h += '<details class="stash-add"><summary>手动存一份</summary>'
      + '<label>奶量（ml）<input type="number" id="stAmt" min="1" max="1000" step="5" inputmode="numeric" placeholder="如 120"></label>'
      + '<div class="seg" id="stPlace"><button type="button" class="seg-btn active" data-stp="fridge" aria-pressed="true">冷藏</button><button type="button" class="seg-btn" data-stp="freezer" aria-pressed="false">冷冻</button></div>'
      + Util.timePickHTML('stTime')
      + '<button type="button" class="btn btn-primary btn-save" id="stSave">存入</button></details>';
    if (inStock.length) {
      h += '<ul class="list stash-list">';
      inStock.forEach(function (x, i) {
        var ag = stashAge(x);
        h += '<li><span class="st-main"><b>' + x.amount + ' ml</b> <span class="stash-tag' + (x.place === 'freezer' ? ' stash-freezer' : '') + '">' + STASH_PLACE[x.place] + '</span>'
          + (i === 0 ? ' <span class="stash-tag stash-first">先用这份</span>' : '') + '</span>'
          + '<span class="st-sub">' + Util.fmtDateTime(x.time) + ' 吸 · ' + ag.text + (ag.tag ? ' · <b class="stash-old">' + ag.tag + '</b>' : '') + '</span>'
          + '<span class="stash-acts">'
          + (x.place === 'fridge' ? '<button type="button" class="btn btn-mini" data-stash-freeze="' + x.id + '">转冷冻</button>' : '')
          + '<button type="button" class="btn btn-mini" data-stash-use="' + x.id + '">用掉</button>'
          + '<button type="button" class="icon-btn" data-stash-del="' + x.id + '" aria-label="删除" title="删除">' + icon('trash') + '</button></span></li>';
      });
      h += '</ul>';
    } else {
      h += '<p class="hint">现在没有存着的奶。</p>';
    }
    h += '<p class="hint">参照 CDC：新鲜吸出的奶冷藏最多 4 天；冷冻约 6 个月内最好，最长 12 个月。解冻后的奶冷藏 24 小时内用完，不要再冻。转冷冻后仍按吸出时间算。</p></div>';
    return h;
  }
  function bindStash(view) {
    function list() { var s = Storage.get(); if (!Array.isArray(s.milkStash)) s.milkStash = []; return s.milkStash; }
    function find(id) { return list().filter(function (x) { return x.id === id; })[0]; }
    Array.prototype.forEach.call(view.querySelectorAll('[data-stash-from]'), function (b) {
      b.addEventListener('click', function () {
        var fid = b.getAttribute('data-stash-from');
        var src = (Storage.get().feedings || []).filter(function (r) { return String(r.id) === fid; })[0];
        if (!src || !(src.amount > 0)) return;
        var place = b.getAttribute('data-place') === 'freezer' ? 'freezer' : 'fridge';
        var rec = { id: Util.uid(), amount: src.amount, time: src.start, place: place, usedAt: null, fromId: src.id };
        list().push(rec);
        if (Storage.save()) Util.toast('已存入' + STASH_PLACE[place] + ' ' + src.amount + ' ml', 'ok', { label: '撤销', onClick: function () {
          var l = list(); for (var i = l.length - 1; i >= 0; i--) if (l[i].id === rec.id) { l.splice(i, 1); break; }
          Storage.save(); global.App.rerender();
        } });
        global.App.rerender();
      });
    });
    Array.prototype.forEach.call(view.querySelectorAll('[data-stp]'), function (b) {
      b.addEventListener('click', function () {
        Array.prototype.forEach.call(view.querySelectorAll('[data-stp]'), function (x) { x.classList.remove('active'); x.setAttribute('aria-pressed', 'false'); });
        b.classList.add('active'); b.setAttribute('aria-pressed', 'true');
      });
    });
    var sv = view.querySelector('#stSave');
    if (sv) sv.addEventListener('click', function () {
      var amt = Math.round(parseFloat(view.querySelector('#stAmt').value));
      if (!(amt > 0 && amt <= 1000)) { Util.toast('请填 1–1000 之间的奶量', 'warn'); return; }
      var pb = view.querySelector('[data-stp].active');
      var place = pb && pb.getAttribute('data-stp') === 'freezer' ? 'freezer' : 'fridge';
      var when = Util.stampFrom(view, 'stTime');
      if (!when) return;
      list().push({ id: Util.uid(), amount: amt, time: when, place: place, usedAt: null });
      if (Storage.save()) Util.toast('已存入' + STASH_PLACE[place] + ' ' + amt + ' ml', 'ok');
      global.App.rerender();
    });
    Array.prototype.forEach.call(view.querySelectorAll('[data-stash-use]'), function (b) {
      b.addEventListener('click', function () {
        var x = find(b.getAttribute('data-stash-use')); if (!x) return;
        x.usedAt = Util.nowLocal();
        if (Storage.save()) Util.toast('已标记用掉 ' + x.amount + ' ml', 'ok', { label: '撤销', onClick: function () {
          x.usedAt = null; Storage.save(); global.App.rerender();
        } });
        global.App.rerender();
      });
    });
    Array.prototype.forEach.call(view.querySelectorAll('[data-stash-freeze]'), function (b) {
      b.addEventListener('click', function () {
        var x = find(b.getAttribute('data-stash-freeze')); if (!x) return;
        x.place = 'freezer';
        if (Storage.save()) Util.toast('已转冷冻', 'ok', { label: '撤销', onClick: function () { x.place = 'fridge'; Storage.save(); global.App.rerender(); } });
        global.App.rerender();
      });
    });
    Array.prototype.forEach.call(view.querySelectorAll('[data-stash-del]'), function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-stash-del');
        var l = list(), idx = -1;
        for (var i = 0; i < l.length; i++) if (l[i].id === id) idx = i;
        if (idx < 0) return;
        var gone = l.splice(idx, 1)[0];
        if (Storage.save()) Util.toast('已删除', 'ok', { label: '撤销', onClick: function () { list().push(gone); Storage.save(); global.App.rerender(); } });
        global.App.rerender();
      });
    });
  }

  Modules.feeding = {
    id: 'feeding',
    title: '喂养',
    /* 第 108 次：导出辅食结构化的纯函数供 QA 驱动。
       导出的是解析层（渲染期派生），不是落库层——落库守卫由下面的
       findSolidDuplicate + 保存分支保证，测试要打到保存分支才算数。 */
    _parseIng: parseIngredients,
    _normIng: normalizeIngredients,
    _splitSteps: splitSteps,
    _findSolidDup: findSolidDuplicate,
    _solidName: solidName,
    /* 第 110 次：导出「引入项」提取函数，观察期卡与 QA 共用同一口径 */
    _solidIntro: solidIntro,
    /* 第 131 次（P1-b）：导出近 7 日瓶喂洞察纯函数供 QA 驱动
       （与 _parseIng 同一先例：测的就是线上这段代码本身） */
    _insight7d: insight7d,
    render: function (view) {
      var d = Storage.get();
      var today = Util.todayISO();
      /* 第 131 次（P1-a）：「今日概览」走照护日口径（dayStart 可配，默认 0 = 公历日），
         与首页喂养磁贴同源；下方保存时的真实时间戳仍用 today（记录必须存真实时刻）。 */
      var DS = Util.dayStartHour(d);
      var dayNow = Util.dayKeyOf(new Date(), DS);
      var html = '';

      /* C7 补记：从日历空日跳转过来时带一次性日期覆盖（App.pendingDate，读取即消费）。
         记录时间 = 补记日期 + 当前时刻，只保证「落到那一天」。 */
      var backfill = (global.App && App.pendingDate) ? App.pendingDate : null;
      if (global.App) global.App.pendingDate = null;
      if (backfill) {
        html += '<div class="card backfill-note"><p class="hint"><b>补记模式</b>：这条会记到 '
          + Util.fmtDate(backfill) + '。</p></div>';
      }

      /* 今日统计 + 母乳换边建议（放最上面，一眼看到） */
      var feedToday = Util.babyFeeds(d.feedings).filter(function (r) { return Util.dayKeyOf(r.start, DS) === dayNow; });
      var sorted = d.feedings.slice().sort(function (a, b) { return new Date(b.start) - new Date(a.start); });
      var latest = sorted[0];
      var latestFed = Util.babyFeeds(sorted)[0]; /* 第 185 次：距上次不算吸奶 */
      var lastBreast = sorted.filter(function (r) { return r.type === 'breast' && r.side; })[0];
      /* U-06：表单默认值取「上一次记录值」，把重复输入的成本降到最低（报告：重复自报负担是第一大退出原因）。
         类型取上次类型；侧别默认换边（与上方换边建议一致）；时长/奶量取上次同类型的值。 */
      /* 第 231 次：亲喂、瓶喂拆成独立页（Modules.breast / Modules.bottle），本页面板只记吸奶和辅食 */
      var lastPS = sorted.filter(function (r) { return r.type === 'pump' || r.type === 'solid'; })[0];
      var defType = (lastPS && lastPS.type) || 'pump';
      var defSide = (lastBreast && lastBreast.side === 'left') ? 'right'
        : ((lastBreast && lastBreast.side === 'right') ? 'left' : 'left');
      var lastDurRec = sorted.filter(function (r) { return r.type === 'breast' && r.durationMin; })[0];
      var lastAmtRec = sorted.filter(function (r) { return r.type !== 'breast' && r.amount; })[0];
      /* 第 223 次：「今日概览」改成首页同款看板——大号「距上次」+ 今日次数/奶量 + 24 小时时间轴 + 近 7 天次数柱。
         口径不变：次数不算吸奶，奶量只算奶瓶/奶粉，按照护日（dayStart）切日。 */
      var tName = function (t) { return (TYPES.filter(function (x) { return x.v === t; })[0] || {}).t || ''; };
      /* 第 230 次：喂养页按尿布页新骨架重排——摘要句 → 计时卡 → 今天看板 → 参考卡 → 储奶 → 时间轴 → 底部主按钮；
         记录表单收进半屏面板（.fd-mask，仍在 #view 里，原有绑定一行不改）。 */
      var fedToday = feedToday;
      var sumTxt;
      if (fedToday.length) {
        var amtT = fedToday.reduce(function (s2, r) { return s2 + ((r.type === 'bottle' || r.type === 'formula') ? (r.amount || 0) : 0); }, 0);
        sumTxt = '今天喂了 <b>' + fedToday.length + ' 次</b>' + (amtT ? '，瓶喂共 <b>' + amtT + ' ml</b>' : '') + '。';
      } else {
        sumTxt = '今天还没有<b>喂奶</b>记录。';
      }
      if (latestFed) {
        var gs = Util.fmtGap(Date.now() - new Date(latestFed.start).getTime());
        sumTxt += '距上次<b>' + Util.escapeHtml(tName(latestFed.type)) + '</b>已过 <b>' + Util.escapeHtml(String(gs.num) + gs.unit) + '</b>。';
      }
      html += '<div class="mod-sum"><span class="ms-k">摘要</span><p>' + sumTxt + '</p></div>';
      var ftimer = d.feedingTimer || null;
      var timerHtml = '';
      if (ftimer) {
        /* 第 140 次（P1-6）：计时从「一个总时长」升级为「分侧累计 + 随时换边」。
           旧数据只有 { start }，这里一律补成新形状再读（sideStart 缺省 = start）。 */
        var ftSide = (ftimer.side === 'right') ? 'right' : 'left';
        var ftSideStart = ftimer.sideStart || ftimer.start;
        var accL = typeof ftimer.accL === 'number' ? ftimer.accL : 0;
        var accR = typeof ftimer.accR === 'number' ? ftimer.accR : 0;
        var curMs = Math.max(0, Date.now() - new Date(ftSideStart).getTime());
        var ftMs = Math.max(0, Date.now() - new Date(ftimer.start).getTime());
        var ftCrossDay = Util.dayKeyOf(ftimer.start, DS) !== dayNow; /* 第 131 次（P1-a）：跨的是照护日 */
        var lMs = accL + (ftSide === 'left' ? curMs : 0);
        var rMs = accR + (ftSide === 'right' ? curMs : 0);
        timerHtml += '<div class="card backfill-note feed-live"><p class="hint"><b>计时中</b> · 从 ' + Util.fmtDateTime(ftimer.start)
          + ' 开始，已 <span id="ftTotal">' + Util.fmtClock(ftMs) + '</span>' + (ftCrossDay ? '（不是这一次喂的？可取消）' : '') + '</p>'
          + '<div class="feed-split"><span class="fs-item' + (ftSide === 'left' ? ' is-cur' : '') + '">'
          + '左 <b id="ftL">' + Util.fmtClock(lMs) + '</b></span>'
          + '<span class="fs-item' + (ftSide === 'right' ? ' is-cur' : '') + '">'
          + '右 <b id="ftR">' + Util.fmtClock(rMs) + '</b></span>'
          + '<span class="fs-now">正在喂 <b>' + (ftSide === 'left' ? '左' : '右') + '侧</b></span></div>'
          + '<div class="row"><button type="button" class="btn" id="ftSwitch">换到' + (ftSide === 'left' ? '右' : '左') + '侧</button>'
          + '<button type="button" class="btn btn-primary" id="ftEnd">结束</button></div>'
          /* 第 140 次：结束时间回填——忘了按结束时的补救，不用手改时长 */
          + '<div class="ft-back"><span class="hint">忘了按结束？按实际结束时间回填：</span>'
          + '<button type="button" class="btn-mini" data-ftend="0">现在</button>'
          + '<button type="button" class="btn-mini" data-ftend="5">5 分钟前</button>'
          + '<button type="button" class="btn-mini" data-ftend="10">10 分钟前</button>'
          + '<button type="button" class="btn-mini" data-ftend="15">15 分钟前</button></div>'
          + '<button type="button" class="btn-mini" id="ftCancel">取消计时</button></div>';
      }
      /* 第 254 次：页面中间的亲喂 / 瓶喂入口卡撤掉——开始记录的按钮只放在 dock 栏上方 */
      html += '<div class="card dash-card" data-accent="feeding"><h2>今天</h2>';
      if (feedToday.length || latest) {
        var totalAmt = feedToday.reduce(function (s, r) { return s + ((r.type === 'bottle' || r.type === 'formula') ? (r.amount || 0) : 0); }, 0);
        if (latestFed) {
          var gg = Util.fmtGap(Date.now() - new Date(latestFed.start).getTime());
          var lastTxt = tName(latestFed.type) + (latestFed.amount && latestFed.type !== 'breast' ? ' ' + latestFed.amount + 'ml' : '')
            + (latestFed.type === 'breast' && latestFed.durationMin ? ' ' + latestFed.durationMin + ' 分钟' : '');
          html += '<div class="dash-big"><span class="dash-num">' + Util.escapeHtml(String(gg.num)) + '<i>' + Util.escapeHtml(gg.unit) + '</i></span>'
            + '<span class="dash-lbl">距上次喂奶' + (lastTxt ? ' · ' + Util.escapeHtml(lastTxt) : '') + '</span></div>';
        }
        html += '<div class="dash-chips"><span><b>' + feedToday.length + '</b> 次</span>'
          + (totalAmt ? '<span><b>' + totalAmt + '</b> ml</span>' : '')
          + (function () {
            var br = feedToday.filter(function (r) { return r.type === 'breast'; }).length;
            return br && br !== feedToday.length ? '<span>亲喂 <b>' + br + '</b> 次</span>' : '';
          })() + '</div>';
        if (global.DayChart) {
          var fWin = DayChart.windowOf(dayNow, DS);
          html += DayChart.strip({ win: fWin, ds: DS, now: Date.now(), label: '今天的喂奶时间',
            marks: feedToday.map(function (r) { return { t: new Date(r.start).getTime(), cls: ({ bottle: 'ft-bottle', formula: 'ft-formula', solid: 'ft-solid' })[r.type] || '', title: Util.fmtRowTime(r.start) + ' ' + tName(r.type) }; }) });
          var f7 = DayChart.lastDays(dayNow, 7).map(function (k) {
            var n = Util.babyFeeds(d.feedings).filter(function (r) { return Util.dayKeyOf(r.start, DS) === k; }).length;
            return { key: k, v: n, txt: String(n) };
          });
          if (f7.filter(function (x) { return x.v; }).length >= 2) html += '<p class="dash-sub">近 7 天喂奶次数</p>' + DayChart.bars(f7, dayNow, '近 7 天喂奶次数');
        }
        if (lastBreast && lastBreast.side !== 'both') {
          var nextSide = lastBreast.side === 'left' ? '右' : '左';
          html += '<p class="hint">上次喂的是<b>' + (lastBreast.side === 'left' ? '左' : '右') + '侧</b>，这次建议先喂 <b>' + nextSide + '侧</b>，两侧均衡不易堵奶。</p>';
        }
      } else {
        html += '<p class="hint">今天还没有喂养记录。</p>';
      }
      html += '</div>';

      /* 第 131 次（P1-b）：近 7 日瓶喂洞察卡（对标 Cali FeedingInsightSeries）。
         位置刻意放在「今日概览」之后、「快速记录」之前：先看趋势再记录，
         与 Cali 首页 insights 卡同秩序。数据不够（<2 次瓶喂且 <2 次亲喂）
         时整卡不渲染——不摆空壳（第 118 次冷启动保护的同一条纪律）。 */
      var ins = insight7d(d);
      if (ins) {
        html += '<div class="card"><h2>近 7 日瓶喂</h2><div class="stat-row">';
        html += '<div class="stat"><span class="stat-num">' + ins.total + '<i class="stat-unit">ml</i></span><span class="stat-lbl">周总量</span></div>';
        html += '<div class="stat"><span class="stat-num">' + ins.avg + '<i class="stat-unit">ml</i></span><span class="stat-lbl">日均（' + ins.days + ' 天有记）</span></div>';
        html += '<div class="stat"><span class="stat-num">' + ins.count + '<i class="stat-unit">次</i></span><span class="stat-lbl">瓶喂次数</span></div>';
        html += '</div>';
        if (ins.mixed) {
          html += '<p class="hint">这一周瓶喂同时用了<b>母乳和配方奶</b>——记录时记得标注，回头才分得清各喝了多少。</p>';
        }
        var hints = [];
        if (ins.breastN) hints.push('另记了亲喂 ' + ins.breastN + ' 次（亲喂没有量，不进上面的统计）');
        hints.push('只统计你自己记的数，不设目标值——和你自己比就好。');
        html += '<p class="hint">' + hints.join('；') + '。</p></div>';
      }

      /* 第 69 次（B3）：喂养参考 + 辅食观察期。知识句全部来自 Knowledge 底座
         （scope 'feeding'，官方数字：辅食频次 CNS-2022 / 维D·观察期 SY-2023），
         本页只做呈现：有生日且日龄 0–730 才显示；观察期是动态状态行。
         第 110 次修正：「最近一条新食材记录」这个说法已过时——
         起算点现在是「最近一条有引入项的辅食」（newFood / dish / ing 均可，
         见 solidIntro），否则第 108 次新增的 dish、ing 记录不会进观察期。
         KN-F-5 静态条目不在本页重复显示（观察期卡承担）。 */
      var fBd = (d.settings.baby && d.settings.baby.birthDate) || null;
      if (fBd && global.Knowledge) {
        var fAge = Util.daysBetween(fBd, today);
        if (fAge >= 0 && fAge <= 730) {
          /* 第 110 次：口径从「只看 r.newFood」改为「任何一条有引入项的辅食」。
             第 108 次把 dish 立为主字段后，只填菜名/菜名+食材的记录 newFood 全是空，
             旧筛选会让观察期卡对最典型的用法完全失灵（探针实测不显示）。
             排序与窗口口径不变：取最近一条，仍是 0–3 天窗口。 */
          var lastNew = d.feedings.filter(function (r) { return r.type === 'solid' && solidIntro(r); })
            .sort(function (a, b) { return (b.start || '').localeCompare(a.start || ''); })[0];
          if (lastNew) {
            var nfDays = Util.daysBetween((lastNew.start || '').slice(0, 10), today);
            if (nfDays >= 0 && nfDays <= 3) {
              /* 第 72 次：SVG 进度环（Kinetics Progress Ring 落地）——窗口第 1..4 天
                 用环形进度可视化，替代纯文字；静态渲染无动画，reduced-motion 无关。
                 文案保持原样（qa 第 69 次块锚定「引入第」）。 */
              var nfPct = (nfDays + 1) / 4;
              var nfC = 2 * Math.PI * 20;
              html += '<div class="card"><h2>辅食观察期</h2><div class="nf-ring-row">'
                + '<svg class="nf-ring" viewBox="0 0 48 48" width="44" height="44" aria-hidden="true">'
                + '<circle cx="24" cy="24" r="20" fill="none" stroke="var(--border)" stroke-width="4"/>'
                + '<circle cx="24" cy="24" r="20" fill="none" stroke="var(--tile, var(--primary))" stroke-width="4" stroke-linecap="round" stroke-dasharray="' + nfC.toFixed(1) + '" stroke-dashoffset="' + (nfC * (1 - nfPct)).toFixed(1) + '" transform="rotate(-90 24 24)"/>'
                + '<text x="24" y="28.5" text-anchor="middle" style="font-size:calc(12px * var(--fs-mul, 1))" font-weight="600" fill="currentColor">' + (nfDays + 1) + '/4</text>'
                + '</svg>'
                + '<p class="hint"><b>「' + Util.escapeHtml(solidIntro(lastNew)) + '」引入第 ' + (nfDays + 1) + ' 天</b>——观察期内建议不再引入第二种新食材，留意皮疹、呕吐、腹泻；都正常即可继续引入。</p></div></div>';
            }
          }
          var refItems = Knowledge.all('feeding').filter(function (e) {
            return fAge >= e.from && fAge <= e.to && e.id !== 'KN-F-5';
          });
          if (refItems.length) {
            html += '<div class="card info-card"><h2>喂养参考</h2>';
            refItems.forEach(function (e) {
              html += '<p class="hint">' + Util.escapeHtml(e.text) + '</p>';
            });
            html += '</div>';
          }
        }
      }

      var fh = '';
      /* P1-8 母乳计时：计时卡在页面上（见上方 timerHtml），表单在半屏面板里。 */
      fh += '<div class="seg seg-wrap3" id="fType">';
      TYPES.filter(function (t) { return t.v === 'pump' || t.v === 'solid'; }).forEach(function (t) {
        fh += '<button type="button" class="seg-btn' + (t.v === defType ? ' active' : '') + '" data-t="' + t.v + '">' + icon(t.v) + t.t + '</button>';
      });
      fh += '</div>';
      /* 第 43 次：亲喂改为左右两根独立滑杆，瓶喂改为母乳/配方奶两根独立滑杆。
         原来是一个「侧别三选 + 一个时长框」/「一个奶量框」，换边要在两个控件间来回切。
         拆成两根后：一根管一侧（或一种奶），互不干扰，0 = 不吃那一侧。 */
      var pendDur = Modules.feeding._pendingDur;
      Modules.feeding._pendingDur = null;
      /* 亲喂：左 / 右 两根 */
      fh += '<div id="wrapRulerL"><span class="lbl-text">左侧（分钟）</span>'
        + Util.rulerHTML('fRulerL', { unit: '分', label: '左侧时长' }) + '</div>';
      fh += '<div id="wrapRulerR"><span class="lbl-text">右侧（分钟）</span>'
        + Util.rulerHTML('fRulerR', { unit: '分', label: '右侧时长' }) + '</div>';
      /* 瓶喂：母乳 / 配方奶 两根 */
      fh += '<div id="wrapRulerBm"><span class="lbl-text">母乳（ml）</span>'
        + Util.rulerHTML('fRulerBm', { unit: 'ml', label: '母乳量' }) + '</div>';
      fh += '<div id="wrapRulerFm"><span class="lbl-text">配方奶（ml）</span>'
        + Util.rulerHTML('fRulerFm', { unit: 'ml', label: '配方奶量' }) + '</div>';
      fh += '<div id="wrapRulerLeft"><span class="lbl-text">剩下没喝完（ml，选填）</span>'
        + Util.rulerHTML('fRulerLeft', { unit: 'ml', label: '剩余量' })
        + '<p class="hint" id="fLeftHint">上面填冲了多少，这里填剩多少，记下的是实际喝下的量。</p></div>';
      /* 吸奶：单根奶量 + 复用上面的左右时长 */
      fh += '<div id="wrapRulerPump"><span class="lbl-text">吸奶量（ml/g）</span>'
        + Util.rulerHTML('fRulerPump', { unit: 'ml', label: '吸奶量' }) + '</div>';
      if (!ftimer) {
        fh += '<div id="ftStartWrap"><button type="button" class="btn-mini" id="ftStart">开始计时（结束自动填入时长）</button></div>';
      }
        /* 第 185 次：记录时刻（计时结束回填时自动填成开始时刻） */
        var pendStart = (pendDur && pendDur.start) ? String(pendDur.start) : '';
        fh += Util.timePickHTML('fTime', pendStart ? pendStart.slice(11, 16) : '');
        fh += '<label>备注<input type="text" id="fNote" placeholder="可选"></label>';
        /* 第 69 次（B3）：辅食可选「新食材」——记录后 2–3 天观察期由上方动态卡提示 */
        fh += '<div id="wrapNewFood" style="display:none"><label>新食材<input type="text" id="fNewFood" placeholder="可选，如 南瓜——将进入 2–3 天观察期"></label></div>';
        /* 第 108 次：辅食结构化。菜名用于「同一天同一道菜只记一行」的查重；
           食材按「荤｜素｜主食」分段存纯 text，做法存一整句话、展示时拆步骤。
           两块都只在切到辅食时显示，不占其他喂养类型的表单空间。 */
        fh += '<div id="wrapSolid" style="display:none">'
          + '<label>菜名<input type="text" id="fDish" placeholder="如：番茄肉酱面"></label>'
          + '<label>食材（荤｜素｜主食）<input type="text" id="fIng" placeholder="如：荤：肉末50g｜素：番茄1个｜主食：面条50g"></label>'
          + '<p class="hint">用「｜」分段、段首写「荤：」「素：」「主食：」，回头一眼看清放了什么。</p>'
          + '<label>做法（一句话即可）<input type="text" id="fSteps" placeholder="如：番茄炒出沙，下肉末炒散，焖 8 分钟成酱"></label>'
          + '<p class="hint">写一句话就行，保存后会自动按句号拆成步骤。</p>'
          + '</div>';
        fh += '<p class="hint" id="solidHint" style="display:none">辅食的种类与克数不成线性，暂不提供滑杆——请在备注里写明（如「南瓜泥 60g」）。</p>';
      fh += '<button class="btn btn-primary btn-save rs-save" id="fSave">保存</button>';

      html += stashCard(d, sorted);

      var list = d.feedings.filter(function (r) { return r && !isNaN(new Date(r.start).getTime()); })
        .sort(function (a, b) { return new Date(b.start) - new Date(a.start); }).slice(0, 30);
      var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
      if (list.length) {
        html += '<section class="mod-tl"><p class="ms-k">最近记录</p><ul class="tl">';
        var lastKey = null;
        list.forEach(function (r) {
          var dk = Util.dayKeyOf(r.start, DS);
          void dk; void lastKey; /* 第 242 次：日期写在时间上方，不再插分组行 */
          var typeName = (TYPES.filter(function (t) { return t.v === r.type; })[0] || {}).t || r.type;
          var detail = (r.type === 'breast')
            ? (r.durationMin ? r.durationMin + ' 分' : '')
            : (r.type === 'pump')
              ? ((r.amount ? r.amount + ' ml/g' : '') + (r.amount && r.durationMin ? ' · ' : '') + (r.durationMin ? r.durationMin + ' 分' : ''))
              : (r.amount ? r.amount + ' ml/g' : '');
          /* 第 43 次：左右分开的滑杆落库为 durationL/durationR，旧的 durationMin 仍兼容显示 */
          var sideTxt = '';
          if (r.type === 'breast' || r.type === 'pump') {
            if (r.durationL != null || r.durationR != null) {
              var parts = [];
              if (r.durationL) parts.push('左 ' + r.durationL + ' 分');
              if (r.durationR) parts.push('右 ' + r.durationR + ' 分');
              sideTxt = parts.join(' · ');
            } else if (r.side) {
              sideTxt = (r.side === 'left' ? '左侧' : (r.side === 'right' ? '右侧' : '双侧'));
            }
          }
          /* 瓶喂区分母乳/配方奶 */
          if (r.type === 'bottle' || r.type === 'formula') {
            if (r.amountBm != null || r.amountFm != null) {
              var bp = [];
              if (r.amountBm) bp.push('母乳 ' + r.amountBm + ' ml');
              if (r.amountFm) bp.push('配方奶 ' + r.amountFm + ' ml');
              /* 第 195 次：有剩余时补一句「冲 120 剩 30」（数值强转，导入坏值不输出） */
              var lo = Number(r.leftover);
              if (lo > 0 && isFinite(lo)) bp.push('冲 ' + ((Number(r.preparedBm) || 0) + (Number(r.preparedFm) || 0)) + ' 剩 ' + lo);
              detail = bp.join(' · ');
            }
          }
            /* 第 69 次（B3）：辅食行显示新食材标记 */
            if (r.type === 'solid' && r.newFood) {
              detail = '新食材 ' + Util.escapeHtml(r.newFood) + (detail ? ' · ' + detail : '');
            }
            /* 第 108 次：辅食行显示菜名 + 食材分段标签 + 做法步数。
               食材分段在展示层解析（落库是纯 text），一段一个标签。
               老数据没有 dish/ing/steps 时自动退回第 69 次的显示口径，不出现空白标签。 */
            var solidBadges = '';
            if (r.type === 'solid') {
              var nm = solidName(r);
              if (nm && r.dish) detail = Util.escapeHtml(nm) + (detail ? ' · ' + detail : '');
              var segs = parseIngredients(r.ing);
              if (segs.length) {
                solidBadges = '<span class="ing-tags">' + segs.map(function (p) {
                  return '<i class="ing-tag ' + ingCls(p.kind) + '">' + p.kind + ' ' + Util.escapeHtml(p.text) + '</i>';
                }).join('') + '</span>';
              }
              /* 做法步数与食材标签各自独立：只填做法不填食材时（很常见——照着菜谱做一遍）
                 步数仍要显示。早期版本把这段嵌在 if (segs.length) 里，导致
                 「有做法、没食材」的辅食行看不到步数，探针 J 场景实测复现。 */
              var stN = splitSteps(r.steps).length;
              if (stN) solidBadges += '<span class="li-sub">做法 ' + stN + ' 步</span>';
            }
            /* 第 61 次：行改「左时间+类型 / 右详情」双列（替代 ｜ 串行）；li-sub 恒输出作右推锚点 */
            var sub = [sideTxt, detail, r.note ? Util.escapeHtml(r.note) : null].filter(Boolean).join(' · ');
            var dt = new Date(r.start), hm = p2(dt.getHours()) + ':' + p2(dt.getMinutes());
            /* 行类名供 CSS 死类名检查识别：'tl-f-breast' 'tl-f-bottle' 'tl-f-formula' 'tl-f-pump' 'tl-f-solid' 'tl-f-other' */
            var tcls = TYPES.some(function (t) { return t.v === r.type; }) ? r.type : 'other';
            html += '<li class="tl-row tl-f-' + tcls + '"><span class="tl-time ft-tlt"><small>' + (dt.getMonth() + 1) + '/' + dt.getDate() + '</small>' + hm + '</span><span class="tl-dot" aria-hidden="true"></span>'
              + '<button type="button" class="tl-card" data-open="' + r.id + '" aria-label="' + hm + ' ' + Util.escapeHtml(typeName) + '，点按修改">'
              + '<span class="tl-ico">' + icon(TYPES.some(function (t) { return t.v === r.type; }) ? r.type : 'feeding') + '</span>'
              + '<span class="tl-txt"><b>' + Util.escapeHtml(typeName) + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + solidBadges + '</span>'
              + '<span class="tl-more" aria-hidden="true">' + (global.FTUI ? global.FTUI.SV.more : icon('chevron-right')) + '</span></button>'
              + '<button type="button" class="tl-del" data-del="' + r.id + '" aria-label="删除" title="删除">' + icon('trash') + '</button></li>';
        });
        html += '</ul></section>';
      } else {
        html += '<div class="fd-none"><p>左下角切换亲喂 / 瓶喂，喂完才想起来就点 ⊕ 补记。</p></div>';
      }

      /* 底部主按钮 + 半屏记录面板（面板默认隐藏，保存/开始计时后 App.rerender 自然收起） */
      /* 第 254 次：底部唯一入口。亲喂计时中 → 迷你计时条；瓶喂计时中 → 迷你条；否则「开始亲喂 | ⊕」 */
      var SVf = (global.FTUI && global.FTUI.SV) || {};
      var MB = Modules.breast, ftS = (ftimer && MB && MB._state) ? MB._state(ftimer, Date.now()) : null;
      if (ftS) {
        html += '<div class="mod-cta ft-cta"><div class="ft-mini" data-accent="breast">'
          + '<button type="button" class="ft-mini-open" data-fmini="open" aria-label="打开计时">' + (SVf.nurse || '')
          + '<b data-fmini-cur>' + Util.fmtClock(ftS.T).replace(/^0(\d:)/, '$1') + '</b></button>'
          + '<span class="ft-mini-side">' + (ftS.paused ? '暂停' : (ftS.side === 'left' ? '左' : '右')) + '</span>'
          + '<button type="button" class="ft-mini-b" data-fmini="swap" aria-label="换边">' + (SVf.swap || '') + '</button>'
          + '<button type="button" class="ft-mini-b" data-fmini="pause" aria-label="' + (ftS.paused ? '继续' : '暂停') + '">' + (ftS.paused ? SVf.play : SVf.pause) + '</button></div></div>';
      } else if (d.bottleTimer) {
        html += '<div class="mod-cta ft-cta"><div class="ft-mini" data-accent="bottle">'
          + '<button type="button" class="ft-mini-open" data-goto="bottle" aria-label="打开瓶喂">' + icon('bottle') + '<b>瓶喂中</b></button>'
          + '<span class="ft-mini-side">点开结束</span></div></div>';
      } else {
        /* 第 255 次：左侧切换钮在亲喂 / 瓶喂之间切换；主按钮和 ⊕ 补记跟着切换走。
           模式记在 d.feedMode，没有时跟最近一条亲喂 / 瓶喂记录走。 */
        var fm = d.feedMode;
        if (fm !== 'breast' && fm !== 'bottle') {
          var lbb = sorted.filter(function (r) { return r.type === 'breast' || r.type === 'bottle' || r.type === 'formula'; })[0];
          fm = (lbb && lbb.type !== 'breast') ? 'bottle' : 'breast';
        }
        var isB = fm === 'breast';
        html += '<div class="mod-cta ft-cta fd-cta"><button type="button" class="fd-mode" data-accent="' + (isB ? 'bottle' : 'breast') + '" data-fmode aria-label="切换到' + (isB ? '瓶喂' : '亲喂') + '">'
          + '<img src="assets/hero/' + (isB ? 'bottle' : 'breast') + '.webp" alt="" width="30" height="30"><small>⇄ ' + (isB ? '瓶喂' : '亲喂') + '</small></button>'
          + '<div class="ft-split" data-accent="' + fm + '">'
          + '<button type="button" class="ft-split-main" data-fstart="' + fm + '">' + (SVf.play || '') + '<span>' + (isB ? '开始亲喂' : '开始瓶喂') + '</span></button>'
          + '<button type="button" class="ft-split-add" data-fadd="' + fm + '" aria-label="补记一次' + (isB ? '亲喂' : '瓶喂') + '">' + (SVf.plusc || icon('plus')) + '</button></div></div>';
      }
      html += '<div class="modal-mask fd-mask" data-fd-mask hidden><div class="modal rec-sheet" role="dialog" aria-modal="true" aria-labelledby="fdsTitle" data-accent="feeding"><div class="rs-body">'
        + '<div class="rs-head"><button type="button" class="rs-x" data-fdx aria-label="关闭">' + icon('close') + '</button>'
        + '<h2 id="fdsTitle">吸奶 / 辅食</h2>'
        + '<button type="button" class="rs-ok" data-fdok aria-label="保存">' + icon('check') + '</button></div>'
        + fh + '</div></div></div>';

      view.innerHTML = html;
      bindStash(view);
      (function () {
        var mask = view.querySelector('[data-fd-mask]');
        if (!mask) return;
        function openF() { mask.hidden = false; document.addEventListener('keydown', onKey); if (global.Sheet && Sheet.attach) Sheet.attach(mask); }
        function closeF() { mask.hidden = true; document.removeEventListener('keydown', onKey); if (global.Sheet && Sheet.reset) Sheet.reset(mask); }
        function onKey(e) { if (e.key === 'Escape') closeF(); }
        Modules.feeding._closeSheet = closeF;
        Array.prototype.forEach.call(view.querySelectorAll('[data-goto]'), function (b) {
          b.addEventListener('click', function () { global.App.showTab(b.getAttribute('data-goto')); });
        });
        var fs = view.querySelector('[data-fstart]');
        if (fs) fs.addEventListener('click', function () {
          if (fs.getAttribute('data-fstart') === 'bottle') { if (Modules.bottle && Modules.bottle._new) Modules.bottle._new(true); }
          else if (Modules.breast && Modules.breast._start) Modules.breast._start();
        });
        var fmb = view.querySelector('[data-fmode]');
        if (fmb) fmb.addEventListener('click', function () {
          var dd = Storage.get();
          dd.feedMode = (view.querySelector('[data-fstart]').getAttribute('data-fstart') === 'breast') ? 'bottle' : 'breast';
          Storage.save(); if (Util.haptic) Util.haptic('tick'); global.App.rerender();
        });
        Array.prototype.forEach.call(view.querySelectorAll('[data-fmini]'), function (b) {
          b.addEventListener('click', function () {
            var k = b.getAttribute('data-fmini');
            if (k === 'open') Modules.breast._openFull(); else { Modules.breast._act(k); global.App.rerender(); }
          });
        });
        var fa = view.querySelector('[data-fadd]');
        if (fa) fa.addEventListener('click', function () {
          if (fa.getAttribute('data-fadd') === 'bottle') Modules.bottle._new(false); else Modules.breast._manual();
        });
        if (ftS) {
          var fTick = setInterval(function () {
            var el = view.querySelector('[data-fmini-cur]'), x = Storage.get().feedingTimer;
            if (!el || !x) { clearInterval(fTick); return; }
            el.textContent = Util.fmtClock(Modules.breast._state(x, Date.now()).T).replace(/^0(\d:)/, '$1');
          }, 1000);
        }
        mask.addEventListener('click', function (e) { if (e.target === mask) closeF(); });
        mask.querySelector('[data-fdx]').addEventListener('click', closeF);
        mask.querySelector('[data-fdok]').addEventListener('click', function () { var sv = view.querySelector('#fSave'); if (sv) sv.click(); });
        Array.prototype.forEach.call(view.querySelectorAll('[data-open]'), function (b) {
          b.addEventListener('click', function () {
            var it = d.feedings.filter(function (x) { return x.id === b.getAttribute('data-open'); })[0];
            if (it && global.RecordEdit) RecordEdit.open('feeding', it, d.feedings);
          });
        });
        /* 补记、或计时刚结束回填了时长：直接把面板打开让人确认 */
        if (backfill || pendDur != null) setTimeout(openF, 0);
      })();

      var type = defType;   /* U-06：跟随上次记录的类型 */

      /* 第 43 次：五根滑杆的量程。0 = 「这一次不吃这一侧 / 不喝这一种」，
         所以 min 统一为 0，单侧喂养不会被迫填一个假的非零值。 */
      var RM = {
        L: { min: 0, max: 60, step: 1, dec: 0, anchor: 15 },
        R: { min: 0, max: 60, step: 1, dec: 0, anchor: 15 },
        Bm: { min: 0, max: 300, step: 5, dec: 0, anchor: 120 },
        Fm: { min: 0, max: 300, step: 5, dec: 0, anchor: 120 },
        Pump: { min: 0, max: 400, step: 5, dec: 0, anchor: 100 },
        /* 第 195 次：瓶喂「剩下没喝完」——冲了多少填上面两根，剩多少填这根，实际喝下自动算 */
        Left: { min: 0, max: 300, step: 5, dec: 0, anchor: 0 }
      };
      /* U-06 预填：各滑杆填上次的值（无记录则 null = 未设置，大数字半透明） */
      var rv = { L: null, R: null, Bm: null, Fm: null, Pump: null, Left: null };
      if (lastDurRec) {
        if (lastDurRec.durationL != null) rv.L = lastDurRec.durationL;
        if (lastDurRec.durationR != null) rv.R = lastDurRec.durationR;
        if (rv.L == null && rv.R == null && lastDurRec.durationMin) {
          /* 旧数据只有 durationMin + side：按侧别拆到对应的那一根 */
          if (lastDurRec.side === 'right') rv.R = lastDurRec.durationMin;
          else if (lastDurRec.side === 'both') { rv.L = lastDurRec.durationMin; rv.R = lastDurRec.durationMin; }
          else rv.L = lastDurRec.durationMin;
        }
      }
      /* 第 140 次：_pendingDur 由「数字」升级为 { L, R }；旧形态仍兼容 */
      if (pendDur != null) {
        if (typeof pendDur === 'object') {
          rv.L = pendDur.L || 0;
          rv.R = pendDur.R || 0;
        } else {
          rv.L = pendDur;
        }
      }
      if (lastAmtRec) {
        if (lastAmtRec.amountBm != null) rv.Bm = lastAmtRec.amountBm;
        if (lastAmtRec.amountFm != null) rv.Fm = lastAmtRec.amountFm;
        /* 第 195 次：上次有剩余时，预填「冲的量」而不是「喝下的量」——下次冲奶照旧量冲 */
        if (lastAmtRec.leftover > 0) {
          if (lastAmtRec.preparedBm != null) rv.Bm = lastAmtRec.preparedBm;
          if (lastAmtRec.preparedFm != null) rv.Fm = lastAmtRec.preparedFm;
        }
        if (rv.Bm == null && rv.Fm == null && lastAmtRec.amount) rv.Bm = lastAmtRec.amount;
      }
      var lastPump = sorted.filter(function (r) { return r.type === 'pump' && r.amount; })[0];
      if (lastPump) rv.Pump = lastPump.amount;

      function paintR(key, prefix) {
        Util.rulerPaint(prefix, {
          min: RM[key].min, max: RM[key].max, step: RM[key].step, value: rv[key],
          anchor: RM[key].anchor, dec: RM[key].dec,
          unit: (key === 'L' || key === 'R') ? '分' : 'ml', label: key
        });
      }
      var PREFIX = { L: 'fRulerL', R: 'fRulerR', Bm: 'fRulerBm', Fm: 'fRulerFm', Pump: 'fRulerPump', Left: 'fRulerLeft' };
      Object.keys(PREFIX).forEach(function (k) { paintR(k, PREFIX[k]); });

      function bindRuler(key, prefix) {
        var box = view.querySelector('#' + prefix);
        if (!box) return;
        var range = box.querySelector('#' + prefix + 'Range');
        if (range) range.addEventListener('input', function () {
          rv[key] = Math.round(parseFloat(range.value) / RM[key].step) * RM[key].step;
          paintR(key, prefix);
        });
        var minus = box.querySelector('#' + prefix + 'Minus');
        if (minus) minus.addEventListener('click', function () {
          rv[key] = Math.max(RM[key].min, (rv[key] != null ? rv[key] : RM[key].anchor) - RM[key].step);
          paintR(key, prefix);
        });
        var plus = box.querySelector('#' + prefix + 'Plus');
        if (plus) plus.addEventListener('click', function () {
          rv[key] = Math.min(RM[key].max, (rv[key] != null ? rv[key] : RM[key].anchor) + RM[key].step);
          paintR(key, prefix);
        });
      }
      Object.keys(PREFIX).forEach(function (k) { bindRuler(k, PREFIX[k]); });

      function showBox(id, on) {
        var el = view.querySelector('#' + id);
        if (el) el.style.display = on ? '' : 'none';
      }
      function syncType() {
        var isBreast = (type === 'breast');
        var isPump = (type === 'pump');
        var isBottle = (type === 'bottle' || type === 'formula');
        var isSolid = (type === 'solid');
        /* 亲喂：左 + 右 两根；吸奶：左 + 右 + 奶量；瓶喂：母乳 + 配方奶 两根；
           辅食：暂不支持滑杆（种类与克数不成线性），保持隐藏并提示用备注 */
        showBox('wrapRulerL', isBreast || isPump);
        showBox('wrapRulerR', isBreast || isPump);
        showBox('wrapRulerBm', isBottle);
        showBox('wrapRulerFm', isBottle);
        showBox('wrapRulerLeft', isBottle);
        showBox('wrapRulerPump', isPump);
        var sw = view.querySelector('#ftStartWrap');
        if (sw) sw.style.display = isBreast ? '' : 'none';
        var solid = view.querySelector('#solidHint');
        if (solid) solid.style.display = isSolid ? '' : 'none';
        /* 第 69 次（B3）：辅食时显示「新食材」输入 */
        showBox('wrapNewFood', isSolid);
        /* 第 108 次：辅食时显示结构化三字段（菜名 / 食材分段 / 做法） */
        showBox('wrapSolid', isSolid);
      }
      Array.prototype.forEach.call(view.querySelectorAll('#fType .seg-btn'), function (b) {
        b.addEventListener('click', function () {
          type = b.getAttribute('data-t');
          Array.prototype.forEach.call(view.querySelectorAll('#fType .seg-btn'), function (x) { x.classList.remove('active'); });
          b.classList.add('active');
          syncType();
        });
      });
      syncType();
      /* P1-8 母乳计时：开始 / 结束回填 / 取消（状态跨刷新持久在 d.feedingTimer） */
      var ftStartBtn = view.querySelector('#ftStart');
      if (ftStartBtn) ftStartBtn.addEventListener('click', function () {
        /* 第 140 次：从「上次喂的那一侧」的对面开始（与上方换边建议同一条规则），
           分侧累计从 0 起算。 */
        var firstSide = (lastBreast && lastBreast.side === 'left') ? 'right'
          : ((lastBreast && lastBreast.side === 'right') ? 'left' : 'left');
        d.feedingTimer = {
          start: Util.nowLocal(), side: firstSide, sideStart: Util.nowLocal(), accL: 0, accR: 0
        };
        Storage.save(); global.App.rerender();
      });
      /* 第 140 次：换边——把当前侧已用时间结算进 acc，再从另一侧重新计时 */
      var ftSwitchBtn = view.querySelector('#ftSwitch');
      if (ftSwitchBtn) ftSwitchBtn.addEventListener('click', function () {
        var t = d.feedingTimer; if (!t) return;
        var now = Date.now();
        var cur = (t.side === 'right') ? 'right' : 'left';
        var ss = new Date(t.sideStart || t.start).getTime();
        var add = Math.max(0, now - ss);
        if (cur === 'left') t.accL = (typeof t.accL === 'number' ? t.accL : 0) + add;
        else t.accR = (typeof t.accR === 'number' ? t.accR : 0) + add;
        t.side = (cur === 'left') ? 'right' : 'left';
        t.sideStart = Util.nowLocal();
        Storage.save(); global.App.rerender();
      });
      /* 第 140 次：结束（支持回填结束时间）。offsetMin = 从「现在」往前推多少分钟。 */
      function endFeed(offsetMin) {
        var t = d.feedingTimer; if (!t) return;
        var endMs = Date.now() - Math.max(0, offsetMin || 0) * 60000;
        var startMs = new Date(t.start).getTime();
        /* 回填把结束时间推到开始之前 → 按「至少 1 分钟」兜底，不产生负数时长 */
        if (!isFinite(endMs) || endMs <= startMs) endMs = startMs + 60000;
        var cur = (t.side === 'right') ? 'right' : 'left';
        var ss = new Date(t.sideStart || t.start).getTime();
        var add = Math.max(0, endMs - ss);
        var L = (typeof t.accL === 'number' ? t.accL : 0) + (cur === 'left' ? add : 0);
        var R = (typeof t.accR === 'number' ? t.accR : 0) + (cur === 'right' ? add : 0);
        /* 旧形状（只有 start）没有分侧数据：全部算到当前侧，行为与第 132 次一致 */
        var mL = Math.round(L / 60000);
        var mR = Math.round(R / 60000);
        d.feedingTimer = null;
        Storage.save();
        /* 第 185 次：把计时开始时刻一并带回表单——此前保存时用的是点保存那一刻，
           「距上次」和下次喂奶预测都会往后偏一整顿奶的时长 */
        Modules.feeding._pendingDur = { L: mL, R: mR, start: t.start };
        var txt = '左 ' + mL + ' 分' + (mR ? ' · 右 ' + mR + ' 分' : '');
        Util.toast('已填入 ' + txt + '，确认后点保存', 'ok');
        global.App.rerender();
      }
      var ftEndBtn = view.querySelector('#ftEnd');
      if (ftEndBtn) ftEndBtn.addEventListener('click', function () { endFeed(0); });
      Array.prototype.forEach.call(view.querySelectorAll('[data-ftend]'), function (b) {
        b.addEventListener('click', function () { endFeed(parseInt(b.getAttribute('data-ftend'), 10) || 0); });
      });
      var ftCancelBtn = view.querySelector('#ftCancel');
      if (ftCancelBtn) ftCancelBtn.addEventListener('click', function () {
        d.feedingTimer = null;
        Storage.save(); Util.toast('已取消计时', 'ok'); global.App.rerender();
      });
      /* 第 140 次：分侧秒表自走。切页/结束后元素被摘除，立即 clearInterval。 */
      var ftTotalEl = view.querySelector('#ftTotal');
      if (ftTotalEl && typeof view.contains === 'function') {
        var ftTick = setInterval(function () {
          if (!view.contains(ftTotalEl)) { clearInterval(ftTick); return; }
          var t = d.feedingTimer;
          if (!t) { clearInterval(ftTick); return; }
          var nowMs = Date.now();
          var cur = (t.side === 'right') ? 'right' : 'left';
          var add = Math.max(0, nowMs - new Date(t.sideStart || t.start).getTime());
          var L2 = (typeof t.accL === 'number' ? t.accL : 0) + (cur === 'left' ? add : 0);
          var R2 = (typeof t.accR === 'number' ? t.accR : 0) + (cur === 'right' ? add : 0);
          var elL = view.querySelector('#ftL');
          var elR = view.querySelector('#ftR');
          if (elL) elL.textContent = Util.fmtClock(L2);
          if (elR) elR.textContent = Util.fmtClock(R2);
          ftTotalEl.textContent = Util.fmtClock(Math.max(0, nowMs - new Date(t.start).getTime()));
        }, 1000);
      }
      /* 第 43 次：侧别三选已由「左/右两根滑杆」取代，这里不再需要监听。 */

      view.querySelector('#fSave').addEventListener('click', function () {
        var note = view.querySelector('#fNote').value.trim();
        var fDay = backfill || today;
        if (typeof pendStart === 'string' && pendStart && !backfill) fDay = pendStart.slice(0, 10);
        var fStamp = Util.stampFrom(view, 'fTime', fDay);
        if (!fStamp) return;
        var isBreast = (type === 'breast');
        var isPump = (type === 'pump');
        var isBottle = (type === 'bottle' || type === 'formula');
        var rec = {
          id: Util.uid(),
          type: type,
          start: fStamp,
          durationMin: null, durationL: null, durationR: null,
          amount: null, amountBm: null, amountFm: null,
          side: null,
          note: note || null,
          newFood: null,
          /* 第 108 次：辅食结构化三字段。全部可空，只在 type==='solid' 时写入。
             老数据没有这三个键是正常的，读取侧一律按空处理，不做迁移。 */
          dish: null,
          ing: null,
          steps: null
        };
        /* 第 108 次：查重命中标记。命中时 rec 会被改指向已有行，且不 push 新行。 */
        var mergedSolid = false;
        if (isBreast || isPump) {
          rec.durationL = rv.L || null;
          rec.durationR = rv.R || null;
          rec.durationMin = (rv.L || 0) + (rv.R || 0) || null; /* 兼容旧字段与统计口径 */
          rec.side = (rv.L && rv.R) ? 'both' : (rv.L ? 'left' : (rv.R ? 'right' : null));
          if (isPump) { rec.amount = rv.Pump || null; }
          if (isBreast && !rv.L && !rv.R) { Util.toast('请至少设置左侧或右侧的时长', 'warn'); return; }
          if (isPump && !rv.L && !rv.R && !rv.Pump) { Util.toast('请至少设置时长或奶量', 'warn'); return; }
        } else if (isBottle) {
          rec.amountBm = rv.Bm || null;
          rec.amountFm = rv.Fm || null;
          rec.amount = (rv.Bm || 0) + (rv.Fm || 0) || null; /* 兼容旧字段与统计口径 */
          if (!rv.Bm && !rv.Fm) { Util.toast('请至少设置母乳或配方奶的量', 'warn'); return; }
          /* 第 195 次：有剩余时 amount/amountBm/amountFm 记「实际喝下」（统计、预测口径不变），
             按母乳/配方奶比例分摊剩余；冲的量另存 preparedBm/preparedFm，剩余存 leftover。 */
          var leftMl = rv.Left || 0, prep = rec.amount;
          if (leftMl > 0) {
            if (leftMl >= prep) { Util.toast('剩下的不能比冲的还多（冲了 ' + prep + ' ml）', 'warn'); return; }
            var drank = prep - leftMl;
            rec.preparedBm = rec.amountBm; rec.preparedFm = rec.amountFm; rec.leftover = leftMl;
            var bmD = rec.amountBm ? Math.round(rec.amountBm * drank / prep) : 0;
            rec.amountBm = bmD || null;
            rec.amountFm = rec.amountFm ? (drank - bmD) || null : null;
            rec.amount = drank;
          }
        } else {
          /* 辅食：种类与克数不成线性，滑杆暂不适用；用备注记。
             第 69 次（B3）：新食材可选字段——落库后由「辅食观察期」卡提示 2–3 天窗口 */
          /* 第 108 次：辅食三字段（菜名/食材分段/做法）。
             必填口径从「note 必填」放宽为「菜名、食材、做法、备注至少有一项」——
             有了结构化的菜名和食材，就不该再逼用户重复写一遍备注。
             三个字段各自都可选：只填菜名也能存，只填做法也能存，缺的留空即可。
             （早期版本的校验漏掉了 steps，用户只记做法时会被静默拦下，
               H108 组「只填做法也能存」实测复现。）
             第 110 次补上第五项 newFood，见下方说明。 */
          rec.dish = view.querySelector('#fDish').value.trim() || null;
          rec.ing = normalizeIngredients(view.querySelector('#fIng').value) || null;
          rec.steps = view.querySelector('#fSteps').value.trim() || null;
          /* 第 110 次：newFood 必须在必填校验**之前**读，且纳入校验。
             第 108 次把校验放宽成「菜名/食材/做法/备注四选一」时，
             漏掉了 newFood —— 而 newFood 是第 69 次「新食材」功能的唯一入口。
             结果：用户只想标个新食材（其他四项都空）会被静默拦下，
             这项功能在第 108 次之后已经无法单独使用（H110 组实测复现）。 */
          rec.newFood = view.querySelector('#fNewFood').value.trim() || null;
          if (!rec.dish && !rec.ing && !rec.steps && !rec.newFood && !note) {
            Util.markInvalid(view.querySelector('#fDish'), '请至少填菜名、食材、做法、新食材或备注其中一项');
            return;
          }

          /* 查重守卫：同一天 + 同一道菜 = 同一顿，命中就更新那一行而不是新增。
             参考实现的 openFoodRec 无条件 push，同一天点 5 次「记录今日辅食」
             就产生 5 行几乎相同的数据——这正是它「19 行只有 1 道菜」的根因。 */
          var dupKey = rec.dish || rec.newFood;
          if (dupKey) {
            var dupDate = (rec.start || '').slice(0, 10);
            var dup = findSolidDuplicate(d.feedings, dupDate, dupKey, null);
            if (dup) {
              /* 并入已有行：保留原 id（否则撤销会删错行），只刷新内容字段 */
              if (rec.ing) dup.ing = rec.ing;
              if (rec.steps) dup.steps = rec.steps;
              if (note) dup.note = note;
              if (rec.newFood) dup.newFood = rec.newFood;
              rec = dup;
              mergedSolid = true;
            }
          }
        }
        if (!mergedSolid) d.feedings.push(rec);
        /* U-13：保存结果必须可见，禁止静默成功（竞品差评里「点了保存却没存上」是高频抱怨） */
        var typeName = (TYPES.filter(function (t) { return t.v === type; })[0] || {}).t || '';
        var detail;
        if (isBreast || isPump) {
          var sp = [];
          if (rv.L) sp.push('左 ' + rv.L + ' 分');
          if (rv.R) sp.push('右 ' + rv.R + ' 分');
          if (isPump && rv.Pump) sp.push(rv.Pump + ' ml');
          detail = sp.join(' · ');
        } else if (isBottle) {
          var bp = [];
          if (rv.Bm) bp.push('母乳 ' + rv.Bm + ' ml');
          if (rv.Fm) bp.push('配方奶 ' + rv.Fm + ' ml');
          detail = bp.join(' · ');
          } else {
            detail = (rec.dish ? rec.dish : '') + (rec.ing ? ' · ' + rec.ing : '')
              + (rec.newFood ? ' · 新食材 ' + rec.newFood : '')
              + (rec.steps ? ' · ' + splitSteps(rec.steps).length + ' 步' : '')
              + (note ? ' · ' + note : '');
          }
          if (Storage.save()) {
            /* C2：高频表单保存也给撤销，防"手滑连记两条" */
            /* 第 108 次：查重命中时明说「已并入」，不能让用户以为多了一条 */
            Util.toast((mergedSolid ? '已并入今天那顿：' : '已记录：') + typeName + ' ' + detail, 'ok', { label: '撤销', onClick: function () {
              for (var i = d.feedings.length - 1; i >= 0; i--) {
                if (d.feedings[i].id === rec.id) { d.feedings.splice(i, 1); break; }
              }
              Storage.save(); global.App.rerender(); Util.toast('已撤销', 'ok');
            } });
          }
        global.App.rerender();
      });
      Array.prototype.forEach.call(view.querySelectorAll('[data-del]'), function (b) {
        b.addEventListener('click', function () {
          var id = b.getAttribute('data-del');
          Util.removeWithUndo(d.feedings, id, {
            onSave: function () { Storage.save(); },
            onAfter: function () { global.App.rerender(); },
            deletedText: '已删除喂养记录'
          });
        });
      });
    },

    /* ============================================================
       第 137 次（磁贴就地记录 · P0）：首页喂养磁贴内嵌「奶源切换 + 奶量步进 + 记录」。
       对标 Cali 的瓶喂组件（−60mL/+ 步进，组件内即记即走）。
       为什么只做瓶喂：亲喂要计时、辅食要填菜名 MilkSource，都不适合「点一下就走」，
       那两个类型仍走模块页（Cali 也是把它们放在宽度更大的组件里）。
       契约与 diaper._quickHTML/_quickBind 完全一致——同一套东西，两处模块共用。
       奶量 30–360、步进 60：来源于 rv.Fm 的既有滑杆区间，不自造量纲。
       ============================================================ */
    _quickHTML: function (d) {
      return '<div class="qk-seg" role="group" aria-label="奶源">'
        + '<button type="button" class="qk-btn qk-src is-on" data-src="bm">母乳</button>'
        + '<button type="button" class="qk-btn qk-src" data-src="fm">配方</button>'
        + '</div>'
        + '<div class="qk-amt">'
        + '<button type="button" class="qk-btn qk-step" data-step="-60" aria-label="减 60 毫升">−</button>'
        + '<b class="qk-num" data-qk-num>120<i>ml</i></b>'
        + '<button type="button" class="qk-btn qk-step" data-step="60" aria-label="加 60 毫升">＋</button>'
        + '</div>'
        + '<button type="button" class="qk-btn qk-save">记录</button>';
    },

    _quickBind: function (root, d, done) {
      var src = 'bm', amt = 120;

      function paint() {
        var n = root.querySelector('[data-qk-num]');
        if (n) n.innerHTML = amt + '<i>ml</i>';
        var on = root.querySelector('.qk-src.is-on');
        if (on) on.classList.remove('is-on');
        var b = root.querySelector('[data-src="' + src + '"]');
        if (b) b.classList.add('is-on');
      }

      Array.prototype.forEach.call(root.querySelectorAll('.qk-src'), function (b) {
        b.addEventListener('click', function (ev) {
          if (ev && ev.stopPropagation) ev.stopPropagation();
          src = b.getAttribute('data-src');
          paint();
        });
      });
      Array.prototype.forEach.call(root.querySelectorAll('.qk-step'), function (b) {
        b.addEventListener('click', function (ev) {
          if (ev && ev.stopPropagation) ev.stopPropagation();
          var step = parseInt(b.getAttribute('data-step'), 10);
          amt = Math.max(30, Math.min(360, amt + (isFinite(step) ? step : 0)));
          paint();
        });
      });
      var save = root.querySelector('.qk-save');
      if (save) save.addEventListener('click', function (ev) {
        if (ev && ev.stopPropagation) ev.stopPropagation();
        /* 记录形状逐字段照抄页面内 rec（第 606–609 行的口径）：
           amountBm/amountFm 分源，amount 是兼容旧字段的合计量。 */
        var rec = {
          id: Util.uid(), type: 'bottle', start: Util.nowLocal(),
          durationMin: null, durationL: null, durationR: null,
          amount: amt, amountBm: (src === 'bm') ? amt : null, amountFm: (src === 'fm') ? amt : null,
          side: null, note: null, newFood: null, dish: null, ing: null, steps: null
        };
        d.feedings.push(rec);
        if (Storage.save()) {
          Util.toast('已记录瓶喂 ' + amt + ' ml', 'ok', {
            label: '撤销',
            onClick: function () {
              for (var i = d.feedings.length - 1; i >= 0; i--) {
                if (d.feedings[i].id === rec.id) { d.feedings.splice(i, 1); break; }
              }
              Storage.save();
              done();
            }
          });
        }
        done();
      });
    }
  };
})(window);
