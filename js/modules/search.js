/**
 * search.js - 全局记录搜索（本地纯工具的结构性优势）
 *
 * 对标竞品 Cali 宝宝后的取舍：Cali 只有「搜索组件 / 搜索用品」两个窄入口，
 * 没有跨模块的全局搜索。我们是本地纯静态应用，索引与检索全在本机内存里做，
 * 零网络、零依赖、零成本，于是把「全量记录全文搜索」做成一个独立模块。
 *
 * 契约（样式类名由 styles.css 提供，不可改）：
 *   .search-bar / .sb-ico / .search-input / .sb-clear
 *   .search-hint / .search-count / .search-results / .search-empty
 *   .card.sr-group / .list.sr-list / .sr-row / .row-ico / .sr-body / .sr-title / .sr-sub
 *
 * 设计要点：
 *   1. 纯子串匹配（中文不分词，不引第三方分词库）：把每条记录归一化成一个小写
 *      文本串（字段用 \n 拼接），查询 trim + toLowerCase 后做 indexOf。
 *   2. 多关键词 = AND：按空格拆词，全部命中才算命中。
 *   3. 数字容忍：数字以字符串原样拼进文本，打「120」能命中奶量 120ml。
 *   4. 索引在 render 时构建一次并缓存在闭包变量里；输入时只过滤，不重建文本。
 *   5. 输入用 input 事件 + 150ms 防抖；刷新只改 .search-results/.search-count/
 *      .search-empty 的内部 HTML，不重绘整个 view（否则输入框会失焦）。
 *   6. 所有落到 HTML 的文本先经 Util.escapeHtml；高亮用 <mark> 只包在已转义的
 *      文本片段上（见 highlight()）。图标是受控 SVG，无需转义。
 *   7. 全部数据读取都有存在性守卫，任何一类拿不到就跳过，绝不抛错。
 */
(function (global) {
  'use strict';

  var Storage = global.Storage, Util = global.Util;
  var Modules = global.Modules = global.Modules || {};

  var MAX_ROWS = 200;      /* 总渲染上限 */
  var DEBOUNCE_MS = 150;   /* 输入防抖 */

  var HINT_TEXT = '输入关键词，搜索全部记录 —— 喂养量、身高体重、药名、记账、体检、里程碑、用品名都能搜。数据只在本机，不上传。';

  /* 各类数据的展示元信息（分组标题、跳转模块、行图标）。
     go 必须是真实存在的 Modules id，showTab 才有反应；
     iconKey 一般等于模块 id，icon() 找不到会返回空串，不会崩。 */
  var GROUPS = [
    { key: 'feeding',     title: '喂养',     go: 'feeding',     icon: 'feeding' },
    { key: 'diaper',      title: '换尿布',   go: 'diaper',      icon: 'diaper' },
    { key: 'sleep',       title: '睡眠',     go: 'sleep',       icon: 'sleep' },
    { key: 'contraction', title: '宫缩',     go: 'contraction', icon: 'contraction' },
    { key: 'growth',      title: '生长',     go: 'growth',      icon: 'growth' },
    { key: 'meds',        title: '吃药/维D', go: 'meds',        icon: 'meds' },
    { key: 'milestone',   title: '里程碑',   go: 'milestone',   icon: 'milestone' },
    { key: 'obs',         title: '发育自评', go: 'milestone',   icon: 'milestone' },
    { key: 'period',      title: '经期',     go: 'period',      icon: 'period' },
    { key: 'mood',        title: '妈妈情绪', go: 'mood',        icon: 'mood' },
    { key: 'fetal',       title: '胎动',     go: 'fetal',       icon: 'fetal' },
    { key: 'temp',        title: '体温',     go: 'temp',        icon: 'temp' },
    /* 第 132 次：新增六个模块的检索分组 */
    { key: 'jaundice',    title: '黄疸',     go: 'jaundice',    icon: 'jaundice' },
    { key: 'bath',        title: '洗澡',     go: 'bath',        icon: 'bath' },
    { key: 'swim',        title: '游泳',     go: 'swim',        icon: 'swim' },
    { key: 'sun',         title: '日晒',     go: 'sun',         icon: 'sun' },
    { key: 'water',       title: '饮水',     go: 'water',       icon: 'water' },
    { key: 'supplement',  title: '补剂',     go: 'supplement',  icon: 'supplement' },
    { key: 'supplies',    title: '消耗品',   go: 'supplies',    icon: 'supplies' },
    { key: 'finance',     title: '记账',     go: 'finance',     icon: 'finance' },
    { key: 'pregnancy',   title: '孕期',     go: 'pregnancy',   icon: 'pregnancy' },
    { key: 'packing',     title: '待产包',   go: 'packing',     icon: 'packing' },
    { key: 'vaccine',     title: '疫苗',     go: 'vaccine',     icon: 'vaccine' },
    { key: 'checkups',    title: '儿保体检', go: 'vaccine',     icon: 'check' },
    { key: 'babies',      title: '宝宝档案', go: 'settings',    icon: 'baby' }
  ];

  var FEED_TYPE = { breast: '母乳', bottle: '奶瓶', formula: '奶粉', pump: '泵奶', solid: '辅食' };
  var DIAPER_TYPE = {
    pee: { t: '尿', x: '小便 尿' },
    poop: { t: '便', x: '大便 便' },
    both: { t: '尿+便', x: '大便 小便 混合 尿 便' }
  };
  var MOOD_LV = { 1: '很低落', 2: '有点低', 3: '一般', 4: '不错', 5: '很好' };
  var MOOD_TAG = { sleep: '睡眠不足', feed: '喂养困难', body: '身体不适', family: '家庭矛盾', work: '事务压力' };

  /* 索引结构 [{ key, title, go, icon, rows: [row] }]，row = { title, sub, text, sortKey }。
     第 127 次：原先挂模块级并注释成「缓存」，但 render 每次都会重建（rerender 也触发），
     缓存名不副实；且模块级变量易被误读为「跨渲染复用」——那会读到过期数据。
     改为 render 内局部变量：作用域即生命周期，名实相符。 */

  /* ---------------- 通用小工具（ES5） ---------------- */

  function arr(x) { return Array.isArray(x) ? x : []; }
  function txt(v) { return v == null ? '' : String(v); }
  function ic(name) { return (global.icon ? global.icon(name) : ''); }

  /** 时间戳（不可解析 → 0），用于同组内「新的在前」排序 */
  function ts(v) {
    if (v == null || v === '') return 0;
    var t = new Date(v).getTime();
    return isNaN(t) ? 0 : t;
  }

  /** 时间展示：含时间用 fmtDateTime，纯日期用 fmtDate。全部走 try 兜底 */
  function fmt(v) {
    if (v == null || v === '') return '';
    try {
      var s = String(v);
      if (s.indexOf('T') >= 0 || s.length > 10) return Util.fmtDateTime(v);
      return Util.fmtDate(v);
    } catch (e) {
      return String(v);
    }
  }

  /** 把若干字段拼成一条可检索的小写文本（空字段丢弃，用 \n 连接） */
  function makeText(parts) {
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (p == null) continue;
      var s = String(p).trim();
      if (s) out.push(s);
    }
    return out.join('\n').toLowerCase();
  }

  /* ---------------- 各类数据 → 索引行 ---------------- */

  /* 每组一个 builder，返回 rows 数组。全部字段访问都做守卫，坏记录跳过。 */

  function buildFeeding(d) {
    var rows = [];
    var list = arr(d.feedings);
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (!r || typeof r !== 'object') continue;
      var tn = FEED_TYPE[r.type] || txt(r.type);
      /* 第 273 次（审计 #21：瓶喂「母乳 120 ml · 120 ml/g」写两遍、单位混写）：奶量只写一次，单位按类型——
         奶（瓶喂 / 配方奶 / 泵奶 / 亲喂）写 ml，辅食按它自己的单位（克 / 勺 / 碗） */
      var pos = function (v) { var n = Number(v); return isFinite(n) && n > 0 ? n : 0; };
      var amtBm = pos(r.amountBm) ? ('母乳 ' + pos(r.amountBm) + ' ml') : '';
      var amtFm = pos(r.amountFm) ? ('配方奶 ' + pos(r.amountFm) + ' ml') : '';
      var amt = '';
      if (r.type === 'solid') {
        var sq = global.Modules && Modules.solid && Modules.solid._amtText ? Modules.solid._amtText(r) : (pos(r.amount) ? pos(r.amount) + ' 克' : '');
        amt = sq || '';
      } else if (!amtBm && !amtFm && pos(r.amount)) {
        amt = (r.type === 'pump' && (pos(r.amountL) || pos(r.amountR)) ? '共 ' : '') + pos(r.amount) + ' ml';
      }
      /* 时长：计时得来的有秒（secL / secR），不到 1 分钟写秒；泵奶两侧同时，总时长 = 较长一侧 */
      var secOf = function (sec, min) { return sec != null && isFinite(Number(sec)) ? Number(sec) : (min != null && isFinite(Number(min)) ? Number(min) * 60 : null); };
      var sideTxt = function (sec) { return sec < 60 ? Math.round(sec) + ' 秒' : Math.round(sec / 60) + ' 分'; };
      var sL = secOf(r.secL, r.durationL), sR = secOf(r.secR, r.durationR);
      var dur = '';
      if (r.durationMin != null && Number(r.durationMin) > 0 && !(r.secL != null || r.secR != null)) dur = r.durationMin + ' 分';
      else if (sL != null || sR != null) {
        var tot = r.type === 'pump' ? Math.max(sL || 0, sR || 0) : (sL || 0) + (sR || 0);
        if (r.type === 'pump' && r.durationMin != null && Number(r.durationMin) * 60 >= tot + 60) tot = Number(r.durationMin) * 60; /* 单侧轮流泵时总时长比任一侧长 */
        if (tot > 0) dur = sideTxt(tot);
      }
      var durSide = '';
      if (r.durationL != null || r.durationR != null || r.secL != null || r.secR != null) {
        var dp = [];
        if (sL) dp.push('左 ' + sideTxt(sL));
        if (sR) dp.push('右 ' + sideTxt(sR));
        durSide = dp.join(' · ');
      } else if (r.side) {
        durSide = (r.side === 'left' ? '左侧' : (r.side === 'right' ? '右侧' : '双侧'));
      }
      var isSolid = r.type === 'solid';
      var dish = isSolid ? txt(r.dish || r.newFood) : '';
      var subs = [amtBm, amtFm, amt, dur, durSide, dish, txt(r.ing), txt(r.note)].filter(Boolean);
      var head = tn + (isSolid && dish ? ' · ' + dish : '');
      rows.push({
        title: head || '喂养',
        sub: [fmt(r.start), subs.join(' · ')].filter(Boolean).join(' · '),
        text: makeText([tn, r.start, r.amount, r.amountBm, r.amountFm, r.durationMin,
          r.durationL, r.durationR, r.side, r.note, r.dish, r.ing, r.steps, r.newFood,
          '喂养', '喂奶', '母乳', '瓶喂', '亲喂', '辅食']),
        sortKey: ts(r.start)
      });
    }
    return rows;
  }

  function buildDiaper(d) {
    var rows = [];
    var list = arr(d.diapers);
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (!r || typeof r !== 'object') continue;
      var di = DIAPER_TYPE[r.type] || { t: txt(r.type), x: txt(r.type) };
      rows.push({
        title: di.t || '尿布',
        sub: [fmt(r.time), txt(r.note)].filter(Boolean).join(' · '),
        text: makeText([di.t, di.x, r.time, r.note, '尿布', '换尿布']),
        sortKey: ts(r.time)
      });
    }
    return rows;
  }

  function buildSleep(d) {
    var rows = [];
    var list = arr(d.sleeps);
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (!r || typeof r !== 'object') continue;
      var durMs = null, durTxt = '';
      if (r.start && r.end) {
        var a = ts(r.start), b = ts(r.end);
        if (b > a) { durMs = b - a; try { durTxt = Util.fmtDuration(durMs); } catch (e) { durTxt = ''; } }
      }
      var durMin = durMs != null ? Math.round(durMs / 60000) : null;
      var wak = (r.wakings != null) ? ('夜醒 ' + r.wakings + ' 次') : '';
      rows.push({
        title: durTxt ? ('睡眠 ' + durTxt) : '睡眠',
        sub: [fmt(r.start) + (r.end ? ' ~ ' + fmt(r.end) : ''), wak, txt(r.note)].filter(Boolean).join(' · '),
        text: makeText([r.start, r.end, durMin, r.wakings, r.note, '睡眠', '睡觉']),
        sortKey: ts(r.start)
      });
    }
    return rows;
  }

  function buildContraction(d) {
    var rows = [];
    var list = arr(d.contractions);
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (!r || typeof r !== 'object') continue;
      var durTxt = '';
      if (r.start && r.end) {
        var a = ts(r.start), b = ts(r.end);
        if (b > a) { try { durTxt = Util.fmtSecDur(b - a); } catch (e) { durTxt = ''; } }
      }
      rows.push({
        title: '宫缩',
        sub: [fmt(r.start), durTxt].filter(Boolean).join(' · '),
        text: makeText([r.start, r.end, durTxt, '宫缩']),
        sortKey: ts(r.start)
      });
    }
    return rows;
  }

  function buildGrowth(d) {
    var rows = [];
    var list = arr(d.growth);
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (!r || typeof r !== 'object') continue;
      var parts = [];
      if (r.weightKg != null) parts.push('体重 ' + r.weightKg + ' kg');
      if (r.heightCm != null) parts.push('身高 ' + r.heightCm + ' cm');
      if (r.headCm != null) parts.push('头围 ' + r.headCm + ' cm');
      rows.push({
        title: parts.length ? parts.join(' · ') : '生长测量',
        sub: fmt(r.date),
        text: makeText([r.date, r.weightKg, r.heightCm, r.headCm,
          '生长', '体重', '身高', '身长', '头围']),
        sortKey: ts(r.date)
      });
    }
    return rows;
  }

  function buildMeds(d) {
    var rows = [];
    var list = arr(d.meds);
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (!r || typeof r !== 'object') continue;
      rows.push({
        title: txt(r.name) || '吃药',
        sub: [fmt(r.time), txt(r.note)].filter(Boolean).join(' · '),
        text: makeText([r.name, r.time, r.note, '吃药', '维D', '维生素']),
        sortKey: ts(r.time)
      });
    }
    return rows;
  }

  function buildMilestone(d) {
    var rows = [];
    var list = arr(d.milestones);
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (!r || typeof r !== 'object') continue;
      rows.push({
        title: txt(r.title) || '里程碑',
        sub: [fmt(r.date), txt(r.note)].filter(Boolean).join(' · '),
        text: makeText([r.title, r.date, r.note, '里程碑']),
        sortKey: ts(r.date)
      });
    }
    return rows;
  }

  function buildPeriod(d) {
    var rows = [];
    var list = arr(d.periods);
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (!r || typeof r !== 'object') continue;
      var syms = arr(r.symptoms).join('、');
      var head = fmt(r.start) + (r.end ? ' ~ ' + fmt(r.end) : '');
      rows.push({
        title: head || '经期',
        sub: [r.flow, r.pain, syms].filter(Boolean).join(' · '),
        text: makeText([r.start, r.end, r.flow, r.pain, syms, '经期', '月经', '姨妈']),
        sortKey: ts(r.start)
      });
    }
    return rows;
  }

  function buildMood(d) {
    var rows = [];
    var list = arr(d.moods);
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (!r || typeof r !== 'object') continue;
      var lv = MOOD_LV[r.level] || '';
      var tags = arr(r.tags).map(function (t) { return MOOD_TAG[t] || t; }).join('、');
      rows.push({
        title: lv || '情绪',
        sub: [tags, txt(r.note), fmt(r.time)].filter(Boolean).join(' · '),
        text: makeText([lv, r.level, tags, r.note, r.time, '情绪', '心情']),
        sortKey: ts(r.time)
      });
    }
    return rows;
  }

  function buildFetal(d) {
    var rows = [];
    var list = arr(d.fetal);
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (!r || typeof r !== 'object') continue;
      rows.push({
        title: '胎动 +1',
        sub: fmt(r.time),
        text: makeText([r.time, '胎动']),
        sortKey: ts(r.time)
      });
    }
    return rows;
  }

  function buildTemp(d) {
    var rows = [];
    var list = arr(d.temps);
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (!r || typeof r !== 'object') continue;
      rows.push({
        title: (r.value != null) ? (r.value + ' °C') : '体温',
        sub: [fmt(r.time), txt(r.note)].filter(Boolean).join(' · '),
        text: makeText([r.value, r.time, r.note, '体温', '发烧']),
        sortKey: ts(r.time)
      });
    }
    return rows;
  }

  /* 第 132 次（补 6 个模块）：洗澡 / 游泳 / 日晒 / 饮水 / 黄疸 / 补剂。
     与各自模块的展示字段保持同源，保证「界面上看到的都搜得到」。 */
  function buildBath(d) {
    var rows = [];
    var list = arr(d.baths);
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (!r || typeof r !== 'object') continue;
      rows.push({
        title: r.minutes ? ('洗澡 ' + r.minutes + ' 分钟') : '洗澡',
        sub: [fmt(r.time), txt(r.note)].filter(Boolean).join(' · '),
        text: makeText([r.minutes, r.time, r.note, '洗澡', '浴']),
        sortKey: ts(r.time)
      });
    }
    return rows;
  }

  function buildSwim(d) {
    var rows = [];
    var list = arr(d.swims);
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (!r || typeof r !== 'object') continue;
      rows.push({
        title: r.minutes ? ('游泳 ' + r.minutes + ' 分钟') : '游泳',
        sub: [fmt(r.time), txt(r.note)].filter(Boolean).join(' · '),
        text: makeText([r.minutes, r.time, r.note, '游泳']),
        sortKey: ts(r.time)
      });
    }
    return rows;
  }

  function buildSun(d) {
    var rows = [];
    var list = arr(d.suns);
    var AREA = { face: '面部', limbs: '四肢', all: '全身', hip: '臀部' };
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (!r || typeof r !== 'object') continue;
      var area = AREA[r.area] || '';
      rows.push({
        title: '日晒' + (r.minutes ? ' ' + r.minutes + ' 分钟' : ''),
        sub: [fmt(r.time), area, txt(r.note)].filter(Boolean).join(' · '),
        text: makeText([r.minutes, r.time, r.note, area, '日晒', '晒太阳']),
        sortKey: ts(r.time)
      });
    }
    return rows;
  }

  function buildWater(d) {
    var rows = [];
    var list = arr(d.waters);
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (!r || typeof r !== 'object') continue;
      rows.push({
        title: (r.ml != null) ? (r.ml + ' ml') : '饮水',
        sub: [fmt(r.time), txt(r.note)].filter(Boolean).join(' · '),
        text: makeText([r.ml, r.time, r.note, '饮水', '喝水']),
        sortKey: ts(r.time)
      });
    }
    return rows;
  }

  function buildJaundice(d) {
    var rows = [];
    var list = arr(d.jaundices);
    var SITE = { forehead: '额头', cheek: '脸颊', chest: '胸口' };
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (!r || typeof r !== 'object') continue;
      var u = (r.unit === 'umol') ? ' µmol/L' : ' mg/dL';
      rows.push({
        title: (r.value != null) ? ('黄疸 ' + r.value + u) : '黄疸',
        sub: [fmt(r.time), SITE[r.site] || '', txt(r.note)].filter(Boolean).join(' · '),
        text: makeText([r.value, r.time, r.note, SITE[r.site], '黄疸', '测黄']),
        sortKey: ts(r.time)
      });
    }
    return rows;
  }

  function buildSupplement(d) {
    var rows = [];
    var list = arr(d.supplements);
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (!r || typeof r !== 'object') continue;
      rows.push({
        title: txt(r.name) || '补剂',
        sub: [fmt(r.time), txt(r.dose), txt(r.note)].filter(Boolean).join(' · '),
        text: makeText([r.name, r.dose, r.time, r.note, '补剂', '营养品']),
        sortKey: ts(r.time)
      });
    }
    return rows;
  }

  function buildSupplies(d) {
    var rows = [];
    var list = arr(d.supplies);
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (!r || typeof r !== 'object') continue;
      var qty = '';
      if (r.qty != null) qty = r.qty + (r.unit ? r.unit : '');
      rows.push({
        title: txt(r.name) || '用品',
        sub: [txt(r.cat), qty, r.price != null ? ('¥' + r.price) : '', fmt(r.date)].filter(Boolean).join(' · '),
        text: makeText([r.name, r.cat, r.date, r.price, r.qty, r.unit, '消耗品', '补货', '用品']),
        sortKey: ts(r.date)
      });
    }
    return rows;
  }

  function buildPregnancy(d) {
    var rows = [];
    var pg = (d.pregnancy && typeof d.pregnancy === 'object') ? d.pregnancy : {};
    if (pg.lmp) {
      rows.push({
        title: '末次月经',
        sub: fmt(pg.lmp),
        text: makeText([pg.lmp, '末次月经', '孕期', '怀孕']),
        sortKey: ts(pg.lmp)
      });
    }
    if (pg.dueDate) {
      rows.push({
        title: '预产期',
        sub: fmt(pg.dueDate),
        text: makeText([pg.dueDate, '预产期', '孕期', '怀孕']),
        sortKey: ts(pg.dueDate)
      });
    }
    var pn = (d.prenatal && typeof d.prenatal === 'object') ? d.prenatal : {};
    var checks = arr(pn.checks);
    for (var i = 0; i < checks.length; i++) {
      var c = checks[i];
      if (!c || typeof c !== 'object') continue;
      rows.push({
        title: (c.week != null) ? ('产检 第 ' + c.week + ' 周') : '产检',
        sub: txt(c.note),
        text: makeText([c.week, c.note, '产检', '孕期']),
        sortKey: 0
      });
    }
    var recs = arr(pn.records);
    for (var j = 0; j < recs.length; j++) {
      var pr = recs[j];
      if (!pr || typeof pr !== 'object') continue;
      rows.push({
        title: txt(pr.item) || '产检记录',
        sub: [txt(pr.value), fmt(pr.date)].filter(Boolean).join(' · '),
        text: makeText([pr.item, pr.value, pr.date, '产检', '孕期']),
        sortKey: ts(pr.date)
      });
    }
    return rows;
  }

  function buildPacking(d) {
    var rows = [];
    var items = (d.packing && typeof d.packing === 'object') ? arr(d.packing.items) : [];
    for (var i = 0; i < items.length; i++) {
      var r = items[i];
      if (!r || typeof r !== 'object') continue;
      var st = r.checked ? '已备' : '未备';
      rows.push({
        title: txt(r.name) || '物品',
        sub: [txt(r.cat), st].filter(Boolean).join(' · '),
        text: makeText([r.name, r.cat, st, '待产包']),
        sortKey: 0
      });
    }
    return rows;
  }

  function buildVaccine(d) {
    var rows = [];
    var vac = global.Modules && Modules.vaccine;
    if (!vac || typeof vac._plan !== 'function') return rows;
    var baby = (d.settings && d.settings.baby) ? d.settings.baby : null;
    var birth = baby && baby.birthDate;
    if (!birth) return rows;
    var plan;
    try { plan = vac._plan(birth); } catch (e) { return rows; }
    var done = (d.vaccines && d.vaccines.done) ? d.vaccines.done : {};
    var list = arr(plan);
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      if (!it || typeof it !== 'object') continue;
      var doneDate = done[it.key];
      rows.push({
        title: (txt(it.name) + (it.dose ? ' ' + it.dose : '')) || '疫苗',
        sub: ['应种 ' + fmt(it.dueISO), doneDate ? ('已种 ' + fmt(doneDate)) : ''].filter(Boolean).join(' · '),
        text: makeText([it.name, it.dose, it.dueISO, doneDate ? '已种' : '未种', '疫苗']),
        sortKey: ts(it.dueISO)
      });
    }
    return rows;
  }

  function buildBabies(d) {
    var rows = [];
    var list = arr(d.babies);
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (!b || typeof b !== 'object') continue;
      rows.push({
        title: txt(b.name) || '宝宝',
        sub: b.birthDate ? ('生日 ' + fmt(b.birthDate)) : '',
        text: makeText([b.name, b.birthDate, '宝宝档案', '宝宝']),
        sortKey: ts(b.birthDate)
      });
    }
    return rows;
  }

  /* ── 第 119 次：补齐原清单漏掉的 3 类数据 ─────────────────────────────
     脚本 _frames/deep/lead_search_coverage.js 对照 storage.js 的
     ARRAY_KEYS(14)+OBJECT_KEYS(7) 逐键比对，发现 finance（记账）、
     checkups（儿保体检标记）、milestoneObs（发育自评标记）三类用户数据
     从未进过索引——用户记了账在这里一条也搜不到，且不报错（静默缺失）。
     三者都有真实记录字段，理应可搜；metrics（埋点）/whitenoise（播放器
     状态）不是用户记录，维持排除。 */

  function buildFinance(d) {
    var rows = [];
    var recs = (d.finance && d.finance.records) ? d.finance.records : [];
    var list = arr(recs);
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (!r || typeof r !== 'object') continue;
      var amt = (r.amount != null && isFinite(r.amount)) ? (Number(r.amount).toFixed(2) + ' 元') : '';
      rows.push({
        title: txt(r.category) || '记账',
        sub: [fmt(r.date), amt, txt(r.note)].filter(Boolean).join(' · '),
        text: makeText([r.category, r.note, '记账', '支出', '花费', '元']),
        sortKey: ts(r.date)
      });
    }
    return rows;
  }

  function buildCheckups(d) {
    var rows = [];
    var vac = global.Modules && Modules.vaccine;
    if (!vac || typeof vac._planCheckups !== 'function') return rows;
    var baby = (d.settings && d.settings.baby) ? d.settings.baby : null;
    var birth = baby && baby.birthDate;
    if (!birth) return rows;
    var plan;
    try { plan = vac._planCheckups(birth); } catch (e) { return rows; }
    var done = (d.checkups && d.checkups.done) ? d.checkups.done : {};
    var list = arr(plan);
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      if (!it || typeof it !== 'object') continue;
      var doneDate = done[it.key];
      rows.push({
        title: txt(it.name) || '儿保体检',
        sub: ['应检 ' + fmt(it.dueISO), doneDate ? ('已检 ' + fmt(doneDate)) : ''].filter(Boolean).join(' · '),
        text: makeText([it.name, it.content, doneDate ? '已检' : '未检', '体检', '儿保']),
        sortKey: ts(it.dueISO)
      });
    }
    return rows;
  }

  function buildObs(d) {
    var rows = [];
    var K = global.Knowledge;
    if (!K || !K.MILESTONES || !K.MILESTONES.length) return rows;
    var byId = {};
    K.MILESTONES.forEach(function (e) { if (e && e.id) byId[e.id] = e; });
    var list = arr(d.milestoneObs);
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (!r || typeof r !== 'object' || !r.id) continue;
      var e = byId[r.id];
      if (!e) continue;   /* 只收知识库内的合法标记，与 milestone.js readMarks 同口径 */
      rows.push({
        title: txt(e.text) || r.id,
        sub: [fmt(r.date), r.v === 1 ? '已出现' : '还没出现'].filter(Boolean).join(' · '),
        text: makeText([e.text, r.v === 1 ? '已出现' : '还没出现', '自评', '发育观察', '里程碑']),
        sortKey: ts(r.date)
      });
    }
    return rows;
  }

  var BUILDERS = {
    feeding: buildFeeding, diaper: buildDiaper, sleep: buildSleep,
    contraction: buildContraction, growth: buildGrowth, meds: buildMeds,
    milestone: buildMilestone, obs: buildObs, period: buildPeriod, mood: buildMood,
    fetal: buildFetal, temp: buildTemp, supplies: buildSupplies,
    /* 第 132 次 */
    jaundice: buildJaundice, bath: buildBath, swim: buildSwim,
    sun: buildSun, water: buildWater, supplement: buildSupplement,
    finance: buildFinance,
    pregnancy: buildPregnancy, packing: buildPacking, vaccine: buildVaccine,
    checkups: buildCheckups, babies: buildBabies
  };

  /** render 时调用一次：把全部记录读取成内存索引（结果存 render 的局部 INDEX） */
  function buildIndex(d) {
    var groups = [];
    for (var i = 0; i < GROUPS.length; i++) {
      var g = GROUPS[i];
      var rows;
      try {
        rows = BUILDERS[g.key](d);
      } catch (e) {
        rows = [];   /* 某一类数据异常不影响其它类，静默跳过 */
      }
      if (rows && rows.length) {
        /* 第 119 次：把「展示面」拼回检索面。此前 text 只含各 builder 手选的
           原始字段——formatted 日期（fmt）从未进过 text，用户照着界面上看到的
           「2026年10月10日」来搜会完全命不中（不是高亮缺失，是漏检）。
           把 title+sub 并入 text 后，凡界面上能看到的都搜得到；
           仍保留 builder 手选的隐藏字段（如 feeding 的 steps）可搜——命中时
           行内可能无可高亮片段，属搜索引擎常规行为（匹配落在元数据上）。 */
        rows.forEach(function (r) {
          r.text = (r.text ? r.text + '\n' : '') + makeText([r.title, r.sub]);
        });
        groups.push({ key: g.key, title: g.title, go: g.go, icon: g.icon, rows: rows });
      }
    }
    return groups;
  }

  /* ---------------- 检索与渲染 ---------------- */

  /** 一条记录是否命中全部关键词（AND） */
  function hitAll(row, words) {
    var t = row.text;
    for (var i = 0; i < words.length; i++) {
      if (t.indexOf(words[i]) < 0) return false;
    }
    return true;
  }

  /**
   * 高亮：只在「已转义」的文本片段上包 <mark>。
   * 做法是在原始串上定位命中区间，再逐段转义输出——命中区间对应的原文片段
   * 单独 escapeHtml 后才放进 <mark>，绝不拼接未转义文本，杜绝 XSS。
   */
  function highlight(raw, words) {
    var s = txt(raw);
    if (!s) return '';
    if (!words || !words.length) return Util.escapeHtml(s);
    var low = s.toLowerCase();
    /* 少数 Unicode 大小写转换会改变长度，此时放弃高亮但保证转义 */
    if (low.length !== s.length) return Util.escapeHtml(s);
    var hit = [];
    for (var w = 0; w < words.length; w++) {
      var kw = words[w];
      if (!kw) continue;
      var from = 0, idx;
      while ((idx = low.indexOf(kw, from)) >= 0) {
        for (var k = idx; k < idx + kw.length; k++) hit[k] = true;
        from = idx + kw.length;
      }
    }
    if (!hit.length) return Util.escapeHtml(s);
    var out = '', i = 0, n = s.length;
    while (i < n) {
      var flag = !!hit[i], j = i;
      while (j < n && !!hit[j] === flag) j++;
      var seg = Util.escapeHtml(s.slice(i, j));
      out += flag ? ('<mark class="sr-hl">' + seg + '</mark>') : seg;
      i = j;
    }
    return out;
  }

  function groupHtml(group, words) {
    var h = '<div class="card sr-group"><h2>' + Util.escapeHtml(group.title) + '</h2>'
      + '<ul class="list sr-list">';
    for (var i = 0; i < group.shown.length; i++) {
      var row = group.shown[i];
      h += '<li class="sr-row" data-go="' + Util.escapeHtml(group.go) + '" role="button" tabindex="0">'
        + '<span class="row-ico">' + ic(group.icon) + '</span>'
        + '<span class="sr-body">'
        + '<b class="sr-title">' + highlight(row.title, words) + '</b>'
        + (row.sub ? '<small class="sr-sub">' + highlight(row.sub, words) + '</small>' : '')
        + '</span></li>';
    }
    h += '</ul></div>';
    return h;
  }

  Modules.search = {
    id: 'search',
    title: '搜索',
    render: function (view) {
      var d = Storage.get();

      /* 每次进入本页（含 rerender）重建索引，保证反映最新数据；
         同一次渲染期间输入只过滤、不复建（paint 闭包捕获本局部变量）。 */
      var INDEX = buildIndex(d);

      var html = ''
        + '<div class="search-bar">'
        + '<span class="sb-ico">' + ic('search') + '</span>'
        + '<input id="searchInput" class="search-input" type="search" aria-label="搜索记录、里程碑、用品" '
        + 'placeholder="搜索记录、里程碑、用品…" autocomplete="off">'
        + '<button class="sb-clear" type="button" aria-label="清空" hidden>×</button>'
        + '</div>'
        + '<p class="search-hint">' + Util.escapeHtml(HINT_TEXT) + '</p>'
        + '<p class="search-count" hidden></p>'
        + '<div class="search-results"></div>'
        + '<div class="search-empty" hidden>没找到相关记录</div>';

      view.innerHTML = html;

      var input = view.querySelector('#searchInput');
      var clearBtn = view.querySelector('.sb-clear');
      var hintEl = view.querySelector('.search-hint');
      var countEl = view.querySelector('.search-count');
      var resultsEl = view.querySelector('.search-results');
      var emptyEl = view.querySelector('.search-empty');

      /* 只更新结果区/计数/空态的内部 HTML，绝不重绘 view（保住输入焦点） */
      function paint() {
        var q = txt(input.value).trim().toLowerCase();
        var words = q ? q.split(/\s+/).filter(function (x) { return x; }) : [];

        clearBtn.hidden = !input.value;

        if (!words.length) {
          hintEl.hidden = false;
          countEl.hidden = true;
          countEl.innerHTML = '';
          emptyEl.hidden = true;
          resultsEl.innerHTML = '';
          return;
        }
        hintEl.hidden = true;

        var matched = [];   /* 每组：{ ..., count, rows } */
        for (var i = 0; i < INDEX.length; i++) {
          var g = INDEX[i];
          var rows = [];
          for (var j = 0; j < g.rows.length; j++) {
            if (hitAll(g.rows[j], words)) rows.push(g.rows[j]);
          }
          if (rows.length) {
            rows.sort(function (a, b) { return b.sortKey - a.sortKey; }); /* 新的在前 */
            matched.push({ title: g.title, go: g.go, icon: g.icon, count: rows.length, rows: rows });
          }
        }

        var total = 0;
        for (var m = 0; m < matched.length; m++) total += matched[m].count;

        if (!total) {
          countEl.hidden = true;
          countEl.innerHTML = '';
          emptyEl.hidden = false;
          resultsEl.innerHTML = '';
          return;
        }

        /* 模块之间按命中条数多的在前 */
        matched.sort(function (a, b) { return b.count - a.count; });

        /* 总上限 MAX_ROWS：按组顺序逐条填充，组内超过则截断 */
        var left = MAX_ROWS;
        for (var n = 0; n < matched.length; n++) {
          var take = Math.min(left, matched[n].rows.length);
          matched[n].shown = matched[n].rows.slice(0, take);
          left -= take;
          if (left <= 0) { matched = matched.slice(0, n + 1); break; }
        }

        countEl.hidden = false;
        countEl.innerHTML = total > MAX_ROWS
          ? '共 ' + total + ' 条，只显示前 ' + MAX_ROWS + ' 条，请再输入几个字缩小范围'
          : '共 ' + total + ' 条';
        emptyEl.hidden = true;

        var out = '';
        for (var p = 0; p < matched.length; p++) out += groupHtml(matched[p], words);
        resultsEl.innerHTML = out;
      }

      /* 150ms 防抖：输入时只刷新结果区 */
      var timer = null;
      function schedule() {
        if (timer) clearTimeout(timer);
        timer = setTimeout(function () { timer = null; paint(); }, DEBOUNCE_MS);
      }

      input.addEventListener('input', schedule);
      if (typeof input.addEventListener === 'function') {
        input.addEventListener('search', schedule); /* type=search 的原生清空按钮 */
      }

      clearBtn.addEventListener('click', function () {
        input.value = '';
        clearBtn.hidden = true;
        if (timer) { clearTimeout(timer); timer = null; }
        paint();
        try { input.focus(); } catch (e) {}
      });

      /* 结果行点击 / 键盘 Enter·Space → 跳转对应模块（沿用项目既有 a11y 惯例） */
      resultsEl.addEventListener('click', function (e) {
        var t = e.target;
        while (t && t !== resultsEl) {
          if (t.getAttribute && t.getAttribute('data-go')) {
            global.App.showTab(t.getAttribute('data-go'));
            return;
          }
          t = t.parentNode;
        }
      });
      resultsEl.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        var t = e.target;
        if (t && t.getAttribute && t.getAttribute('data-go')) {
          e.preventDefault();
          global.App.showTab(t.getAttribute('data-go'));
        }
      });

      /* 首次进入：hint 态 */
      paint();
    }
  };
})(window);
