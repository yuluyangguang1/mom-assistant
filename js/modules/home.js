/**
 * home.js - 首页（天空背景 + 模块化记录）
 * 顶部：Web 版 swiftui-sky 动态天空（由本地时间/季节驱动，纯程序化、零网络）
 * 左上角宝宝头像在全局 header（点击进设置）。
 * 主体：模块记录单条信息行（第 56 次起；今日概览数字卡已迁日期记录页）。
 * 每日记录日历已独立为底部「日期记录」整页，不在首页内嵌。
 */
(function (global) {
  'use strict';
  var Storage = global.Storage, Util = global.Util;
  var Modules = global.Modules = global.Modules || {};

  function countToday(arr, key, now) {
    var t = now ? Util.fmtDate(now) : Util.todayISO(); /* 第 115 次：口径与 dayLabel 统一 */
    return (arr || []).filter(function (x) { return (x[key] || '').slice(0, 10) === t; }).length;
  }
  /* 第 56 次（单条信息行）：今天最近一次的时刻（HH:MM），给磁贴摘要补充「最近几点」。
     单列横行后有空间多放一段信息，数字与时刻一起构成一眼可读的今日节奏。 */
  function lastToday(arr, key, now) {
    var t = now ? Util.fmtDate(now) : Util.todayISO(); /* 第 115 次：口径与 dayLabel 统一 */
    var hits = (arr || []).filter(function (x) { return (x[key] || '').slice(0, 10) === t; })
      .sort(function (a, b) { return new Date(b[key]) - new Date(a[key]); });
    if (!hits.length) return null;
    var dt = new Date(hits[0][key]);
    return (dt.getHours() < 10 ? '0' : '') + dt.getHours() + ':' + (dt.getMinutes() < 10 ? '0' : '') + dt.getMinutes();
  }

  /* 第 111 次（Q0 回访）：不限「今天」的最近一次时刻，返回 Date 对象。
     为什么需要它：lastToday() 只筛今天，跨天回访时它返回 null，
     于是第 1 批 P0「距上次多久」在跨天场景下整个消失——探针实测（probe111a.js 场景 1），
     用户隔一天再来，喂养/尿布磁贴显示的是「暂无今日」，而不是
     「你昨天记了 3 次，已经 20 小时了」。而跨天恰恰是回访失败的主场景
     （弃用因「忘记用」，7 天 58.1% 常用 → 30 天仅 22.5%）。
     纯渲染期派生，只读不落库；返回 null 表示「从来没有过记录」。
     nowMs 用于跳过未来时间：脏数据或时钟回拨时，不该在首页显示成「距今 -N」。 */
  function lastAny(arr, key, nowMs) {
    var best = 0;
    (arr || []).forEach(function (x) {
      if (!x || !x[key]) return;
      var t = new Date(x[key]).getTime();
      if (!t || isNaN(t) || t > nowMs) return;
      if (t > best) best = t;
    });
    return best ? new Date(best) : null;
  }

  /* 间隔人话：分钟 / 小时 / 天三档，只描述「距今多久」这一中性事实。
     刻意不写「该喂了」「该记了」——那是提醒的职责（见 reminders.js），
     首页这里只负责把用户自己上一笔记录摆回来，靠连续感而不是责任感驱动回访。 */
  function gapText(ms) {
    var H = 3600000, M = 60000;
    /* 非有限值与负数一律兜到「不到 1 分钟」：调用方已过滤未来时间戳，
       这里只是不让 NaN 之类脏值漏进 UI 变成「距今 NaN 天」。 */
    if (typeof ms !== 'number' || !isFinite(ms) || ms < 0) return '不到 1 分钟';
    if (ms < M) return '不到 1 分钟';
    if (ms < H) return '距今 ' + Math.max(1, Math.floor(ms / M)) + ' 分钟';
    if (ms < 24 * H) return '距今 ' + Math.floor(ms / H) + ' 小时';
    return '距今 ' + Math.floor(ms / (24 * H)) + ' 天';
  }

  function hmOf(dt) {
    return (dt.getHours() < 10 ? '0' : '') + dt.getHours()
      + ':' + (dt.getMinutes() < 10 ? '0' : '') + dt.getMinutes();
  }

  /* 日期口语标签：今天 / 昨天 / 前天 / M月D日。
     跨大年或很久以前落到 M月D日，不写年份——磁贴宽度有限，且用户只关心「多久没记」。 */
  function dayLabel(dt, now) {
    /* 第 115 次：now 可选。缺省仍取真实当天（生产行为不变），
       但显式传入时与 lastAnySum 的 now 保持同一口径——
       此前这里硬取 Util.todayISO()，而 lastAnySum 传了自己的 now，
       两套「今天」打架，跨天时标签整体错一天。 */
    var today = now ? Util.fmtDate(now) : Util.todayISO();
    var diff = Util.daysBetween(Util.fmtDate(dt), today);
    if (diff === 0) return '今天';
    if (diff === 1) return '昨天';
    if (diff === 2) return '前天';
    return (dt.getMonth() + 1) + '月' + dt.getDate() + '日';
  }

  /* 第 111 次：喂养 / 尿布磁贴的摘要三态。
       今天记过  → 维持现状「最近 HH:MM · 今日 N 次」（第 1 批 P0 口径，不回归）
       今天没记、过去记过 → 新增「最近一次 昨天 15:40 · 距今 20 小时」
       从没记过  → 返回 null，调用方退回「暂无今日」（不打扰）
     返回 null 而不是塞一句空话，是为了让「从没记过」和「有历史但今天没记」在文案上真正分得开。 */
  function lastAnySum(arr, key, now) {
    var nowMs = now.getTime();
    /* 第 115 次：三个调用点一并传 now，态一/态二/标签用同一套「今天」。 */
    var lt = lastToday(arr, key, now);
    if (lt) return '最近 ' + lt + ' · 今日 ' + countToday(arr, key, now) + ' 次';
    var any = lastAny(arr, key, nowMs);
    if (!any) return null;
    return '最近一次 ' + dayLabel(any, now) + ' ' + hmOf(any) + ' · ' + gapText(nowMs - any.getTime());
  }

  function isoOf(s) { return (s || '').slice(0, 10); }
  function fmtMoney(n) { return '¥' + (Math.round(n * 100) / 100); }

  function pregnancyWeek(d) {
    var pg = d.pregnancy;
    if (!pg || !(pg.lmp || pg.dueDate)) return null;
    var base = pg.lmp || Util.addDays(pg.dueDate, -280);
    return Math.max(0, Math.floor(Util.daysBetween(base, Util.todayISO()) / 7));
  }
  function dueLeft(d) {
    var pg = d.pregnancy;
    if (!pg || !(pg.lmp || pg.dueDate)) return null;
    var due = pg.dueDate ? pg.dueDate : Util.addDays(pg.lmp, 280);
    return Util.daysBetween(Util.todayISO(), due);
  }

  Modules.home = {
    id: 'home',
    title: '首页',
    render: function (view) {
      var d = Storage.get();
      var today = Util.todayISO();

      /* 问候语 */
      /* 称呼取自首次引导里选的身份 / 称呼（O 系列）：只影响问候语，不做任何用户画像。
         没选身份时保持中性的「你好」，不硬猜。 */
      var cg = (d.settings && d.settings.caregiver) || null;
      var roleWord = (cg && cg.role === 'mom') ? '妈妈'
        : ((cg && cg.role === 'dad') ? '爸爸' : ((cg && cg.role === 'other') ? '照护者' : ''));
      var who = (cg && cg.name) ? cg.name : roleWord;
      var greetWho = who ? ('你好，' + who) : '你好';
      /* P2 动态问候落地：优先宝宝月龄（产后），其次孕周 + 预产期倒计时；数据都没有才用通用文案。
         只动副标题（greetSub），h1 的身份问候逻辑与既有测试保持不变。 */
      var greetSub = '今天也要好好照顾自己和宝宝。';
      var bd = (d.settings.baby && d.settings.baby.birthDate) || null;
      var ageDays = bd ? Util.daysBetween(bd, today) : null;
      var dl = dueLeft(d);
      if (ageDays !== null && ageDays >= 0 && ageDays <= 730) {
        if (ageDays >= 294) greetSub = '宝宝 ' + Math.floor(ageDays / 30.44) + ' 个月大了，继续好好记录。';
        else if (ageDays >= 1) greetSub = '宝宝出生第 ' + ageDays + ' 天，辛苦啦。';
        else greetSub = '欢迎新生命，享受这段时光。';
      } else if (dl !== null) {
        if (dl > 0) {
          var wkNow = pregnancyWeek(d);
          greetSub = (wkNow !== null ? '孕 ' + wkNow + ' 周 · ' : '')
            + '距离预产期还有 ' + dl + ' 天，记得好好休息。';
        }
        else if (dl >= -30) greetSub = '宝宝正在来到你身边，加油。';
        else greetSub = '欢迎新生命，享受这段时光。';
      }

      /* 模块记录摘要 */
      /* 第 111 次：lastAnySum 要「现在」来算间隔。本段单独取一次并复用，
         避免同一屏两个磁贴算出跨秒不一致的间隔。
         刻意不与下方的 nowD 合并——nowD 服务于问候卡日期，两处语义不同，
         混用会在跨零点渲染时把日期和间隔算到不同的「现在」。 */
      var sumNow = new Date();
      var feedToday = countToday(d.feedings, 'start');
      var diaperToday = countToday(d.diapers, 'time');
      var contraToday = countToday(d.contractions, 'start');
      var sleepRecent = (d.sleeps || []).filter(function (s) { return s.end; })
        .sort(function (a, b) { return new Date(b.start) - new Date(a.start); })[0];
      /* U-17：首页主指标用「昨夜最长连续」而非总时长；U-24：参照只用近 7 天自己的区间 */
      var longestMin = (global.Modules && Modules.sleep && typeof Modules.sleep._longestMin === 'function')
        ? Modules.sleep._longestMin : function (s) {
            var w = (s.wakings == null) ? 0 : s.wakings;
            return Math.round((new Date(s.end) - new Date(s.start) - (s.pausedMs || 0)) / 60000 / (w + 1));
          };
      var lastLongestH = sleepRecent ? (longestMin(sleepRecent) / 60) : null;
      var weightRecent = (d.growth || []).slice()
        .sort(function (a, b) { return new Date(b.date) - new Date(a.date); })[0];
      var wk = pregnancyWeek(d);
      var pk = (d.packing && d.packing.items) ? d.packing.items : [];
      var pkDone = pk.filter(function (x) { return x.checked; }).length;
      var pkPct = pk.length ? Math.round(pkDone / pk.length * 100) : 0;
      var periods = d.periods || [];
      var ongoing = periods.filter(function (p) { return p.start && (!p.end || p.end >= today); })[0];
      var periodInfo = '未记录';
      if (ongoing) periodInfo = '经期第 ' + (Util.daysBetween(isoOf(ongoing.start), today) + 1) + ' 天';
      else if (periods.length) periodInfo = '上次 ' + Util.daysBetween(isoOf(periods[periods.length - 1].start), today) + ' 天前';
      var ym = today.slice(0, 7);
      var monthSum = ((d.finance && d.finance.records) || [])
        .filter(function (r) { return (r.date || '').slice(0, 7) === ym; })
        .reduce(function (s, r) { return s + (parseFloat(r.amount) || 0); }, 0);

      /* 疫苗进度（有生日才显示摘要） */
      var vaxInfo = '未设置生日';
      var vaxBadge = '';
      if (global.Modules && Modules.vaccine && typeof Modules.vaccine._plan === 'function'
          && d.settings.baby && d.settings.baby.birthDate) {
        var vItems = Modules.vaccine._plan(d.settings.baby.birthDate);
        var vDone = (d.vaccines && d.vaccines.done) || {};
        var vDoneN = vItems.filter(function (it) { return vDone[it.key]; }).length;
        var vNext = vItems.filter(function (it) { return !vDone[it.key]; })
          .sort(function (a, b) { return new Date(a.dueISO) - new Date(b.dueISO); })[0];
        vaxInfo = vDoneN + '/' + vItems.length + ' 剂';
        /* 第 89 次（审计 A2）：负数是逾期而非临近——与疫苗页三档同口径
           （left<-30 逾期较久 / <0 已逾期 / ≤7 临近），修掉 daysBetween<=7 把
           逾期剂次标成「临近」的 bug */
        if (vNext) {
          var vLeft = Util.daysBetween(today, vNext.dueISO);
          vaxBadge = vLeft < -30 ? '逾期较久' : (vLeft < 0 ? '已逾期' : (vLeft <= 7 ? '临近' : ''));
        }
        else { vaxInfo = '全部完成'; }
      }

      var medsToday = countToday(d.meds, 'time');
      var msRecent = (d.milestones || []).slice()
        .sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); })[0];
      /* 妈妈情绪（第 66 次 · F 线）：今日最近一次档位词；与宝宝记录同权重的「记录你自己」入口 */
      var moodToday = (d.moods || []).filter(function (r) { return (r.time || '').slice(0, 10) === today; })
        .sort(function (a, b) { return new Date(b.time) - new Date(a.time); })[0];
      var MOOD_LV = { 1: '很低落', 2: '有点低', 3: '一般', 4: '不错', 5: '很好' };
      var moodSum = moodToday ? ('今天 ' + (MOOD_LV[moodToday.level] || '已记录')) : '暂无今日';
      /* 胎动（对标 Cali 补齐）：只在有孕周时出现——磁贴与统计都跟阶段走 */
      var fetalToday = countToday(d.fetal, 'time');
      /* 体温（第 38 次补齐）：磁贴显示今日最高 */
      var tempTodayList = (d.temps || []).filter(function (r) { return (r.time || '').slice(0, 10) === today; });
      var tempTodayMax = tempTodayList.length
        ? Math.max.apply(null, tempTodayList.map(function (r) { return r.value; }))
        : null;

      /* 哄睡白噪音磁贴文案（W-02）：播放中就把剩余时长摆在首页，省得进页面才想起来关 */
      var noiseInfo = '未播放';
      if (d.whitenoise && d.whitenoise.playing) {
        var nrem = (global.Modules && Modules.whitenoise && Modules.whitenoise._remainingMin)
          ? Modules.whitenoise._remainingMin() : null;
        noiseInfo = nrem != null ? ('播放中 · 还剩 ' + nrem + ' 分') : '播放中 · 不限时';
      }

      /* C4：睡眠 / 宫缩计时进行中也要在首页可见（照抄白噪音磁贴范式）。
         已耗时按「now − start − 已暂停时长」现场计算，口径与模块页计时器一致。 */
      function openElapsedMs(os) {
        if (!os) return 0;
        var paused = (os.pausedMs || 0) + (os.pauseStart ? Date.now() - os.pauseStart : 0);
        return Math.max(0, Date.now() - new Date(os.start).getTime() - paused);
      }
      var osTile = d.openSleep || null;
      var ocTile = d.openContraction || null;

      /* 第 85 次（C2 磁贴副文案）：睡眠磁贴补清醒窗参考——哄睡时机的中性科普，
         数值来自 Modules.sleep._wakeWindow（与睡眠页 KN-S 同源），一律带「参考」。
         只在育儿阶段 + 已知生日 + 未在计时 + 3 岁内出现；rt-sum 过长会省略号兜底。 */
      var sleepWake = '';
      if (!osTile && global.Modules && Modules.sleep && typeof Modules.sleep._wakeWindow === 'function') {
        var hwBd = (d.settings.baby && d.settings.baby.birthDate) || null;
        var hwAge = hwBd ? Util.daysBetween(hwBd, today) : null;
        var hwTxt = (hwAge != null && hwAge >= 0) ? Modules.sleep._wakeWindow(hwAge) : null;
        if (hwTxt) sleepWake = ' · 清醒窗参考 ' + hwTxt;
      }

      /* 第 56 次：单条信息行的摘要增强——次数之外补「最近几点」，今日节奏一眼可读。
         第 111 次：本段的 feedLast / diaperLast 已并入下方 lastAnySum()，
         局部变量随之删除（lastToday 本身仍被 lastAnySum 内部复用，未删）。 */
      /* 第 101 次（P0 落地，总纲「唯一 P0」）：主副文案调换——「距上次多久」提到主位，
         今日次数降为副位。
         依据：BabyTrack 官方「Today at a glance（免费）— puts the next thing you're likely
         to need at the top」，而「Charts and insights」在 Plus 付费墙内；BabyLog 官方
         「every tile shows how long since and the last value」。竞品把「距上次多久」放免费
         首页、把图表放付费墙——此前的注意力分配正好颠倒。
         写法上先问「今天最近一次」（有时间才有信息），没有时间才退回次数口径；「暂无今日」原样保留。
         收敛改动：本行同时闭合第四版 P0 与第七版 B4（新增记录时的「多久前同类记录」提示，
         能力本已存在，只是被排在次数之后）。

         第 111 次（Q0 回访）：本段换成 lastAnySum()，把「距上次多久」从「仅今日」
         扩到「最近一次」。原写法在跨天时 lastToday 返回 null，磁贴一律退化成
         「暂无今日」，第 1 批那个 P0 成果在跨天回访（回访失败的主场景）下整个消失。
         今天记过时 lastAnySum 内部走原有分支，字面输出与改前完全一致——不回归。 */
      var feedSum = lastAnySum(d.feedings, 'start', sumNow) || '暂无今日';
      var diaperSum = lastAnySum(d.diapers, 'time', sumNow) || '暂无今日';

      /* 第 58 次（走查）：badge 只保留「状态词」（计时中/临近）——单条信息行右侧
         摘要已含全部数字（今日 N 次 / 第 N 周 / 已备 N%），数字角标与文字完全重复，
         属视觉冗余；状态词是摘要表达不了的信息，保留。 */
      var tiles = [
        { id: 'feeding', stages: ['baby'], name: '喂养', accent: 'feeding', sum: feedSum, badge: '' },
        { id: 'diaper', stages: ['baby'], name: '尿布', accent: 'diaper', sum: diaperSum, badge: '' },
        { id: 'sleep', stages: ['baby'], name: '睡眠', accent: 'sleep', sum: osTile ? ('计时中 · 已 ' + Util.fmtDuration(openElapsedMs(osTile))) : ((lastLongestH != null ? ('昨夜最长连续 ' + lastLongestH.toFixed(1) + ' 小时') : '暂无') + sleepWake), badge: osTile ? '计时中' : '' },
        { id: 'whitenoise', stages: ['baby'], name: '哄睡白噪音', accent: 'sleep', sum: noiseInfo },
        { id: 'growth', stages: ['baby'], name: '生长', accent: 'growth', sum: weightRecent ? ('最近 ' + weightRecent.weightKg + ' kg') : '暂无' },
        { id: 'vaccine', stages: ['baby'], name: '疫苗', accent: 'vaccine', sum: vaxInfo, badge: vaxBadge },
        { id: 'meds', stages: ['baby', 'pregnancy'], name: '吃药/维D', accent: 'meds', sum: medsToday ? ('今日 ' + medsToday + ' 次') : '暂无今日', badge: '' },
        { id: 'milestone', stages: ['baby'], name: '里程碑', accent: 'milestone', sum: msRecent ? msRecent.title : '暂无' },
        { id: 'period', stages: ['baby'], name: '经期', accent: 'period', sum: periodInfo },
        { id: 'mood', stages: ['baby', 'pregnancy'], name: '妈妈情绪', accent: 'mood', sum: moodSum },
        { id: 'pregnancy', stages: ['pregnancy'], name: '孕期', accent: 'pregnancy', sum: wk !== null ? ('第 ' + wk + ' 周') : '未设置', badge: '' },
        { id: 'packing', stages: ['pregnancy'], name: '待产包', accent: 'packing', sum: pk.length ? ('已备 ' + pkPct + '%') : '未开始', badge: '' },
        { id: 'contraction', stages: ['pregnancy'], name: '宫缩', accent: 'contraction', sum: ocTile ? ('计时中 · 已 ' + Util.fmtDuration(openElapsedMs(ocTile))) : (contraToday ? ('今日 ' + contraToday + ' 次') : '暂无今日'), badge: ocTile ? '计时中' : '' }
      ];
      if (wk !== null) {
        tiles.push({ id: 'fetal', stages: ['pregnancy'], name: '胎动', accent: 'fetal', sum: fetalToday ? ('今日 ' + fetalToday + ' 次') : '暂无今日', badge: '' });
      }
      tiles.push({ id: 'temp', stages: ['baby', 'pregnancy'], name: '体温', accent: 'temp', sum: tempTodayMax != null ? ('今日最高 ' + tempTodayMax + '°C') : '暂无今日' });
      tiles.push({ id: 'finance', stages: ['baby', 'pregnancy'], name: '记账', accent: 'finance', sum: monthSum ? ('本月 ' + fmtMoney(monthSum)) : '本月无' });
      /* 第 107 次：消耗品。摘要复用模块自己的低库存判定（渲染期派生，不写库）。 */
      var supSum = (global.Modules && Modules.supplies && typeof Modules.supplies._summary === 'function')
        ? Modules.supplies._summary(d.supplies) : '';
      tiles.push({ id: 'supplies', stages: ['baby'], name: '消耗品', accent: 'supplies', sum: supSum, badge: '' });

      /* 磁贴按阶段排序（对标报告 P1）：孕早期 tools 前置 / 育儿期喂养尿布前置，
         其余按固定次序殿后——同样的 14/15 个磁贴，第一眼先看到当前阶段最常用的。
         第 43 次：阶段优先取用户在引导/设置里的显式选择（App.stageOf），
         未选时才回落到客观数据（孕周可推 / 宝宝已出生）。 */
      var stage = (global.App && typeof App.stageOf === 'function') ? App.stageOf(d)
        : ((wk !== null) ? 'pregnancy' : ((bd && ageDays !== null && ageDays >= 0) ? 'baby' : 'none'));
      /* 第 48 次（磁贴按阶段筛选）：光排序不够——用户反馈「选了身份还是全部都出现」。
         默认只显示当前阶段相关的磁贴（孕期的喂养/尿布/生长等收起，育儿期的宫缩/
         胎动/孕期/待产包收起）。两条豁免：
         ① 计时进行中的磁贴永远保留——进行中的状态不能被藏掉（C4 的本意）；
         ② 设置 · 当前阶段里可关掉筛选（tilesByStage=false），全部显示。
         阶段无法判定（'none'，仅缺 App.stageOf 的理论分支）时不过滤。 */
      if (d.settings.tilesByStage !== false && (stage === 'pregnancy' || stage === 'baby')) {
        tiles = tiles.filter(function (t) {
          if (t.stages.indexOf(stage) >= 0) return true;
          return (t.id === 'contraction' && ocTile) || (t.id === 'sleep' && osTile);
        });
      }
      var ORDER = (stage === 'pregnancy')
        ? ['pregnancy', 'fetal', 'contraction', 'packing', 'mood', 'period', 'feeding', 'diaper', 'sleep', 'whitenoise', 'growth', 'vaccine', 'meds', 'milestone', 'temp', 'finance']
        : ['feeding', 'diaper', 'sleep', 'whitenoise', 'mood', 'temp', 'growth', 'vaccine', 'meds', 'milestone', 'period', 'contraction', 'pregnancy', 'packing', 'finance', 'supplies'];
      tiles.sort(function (a, b) { return ORDER.indexOf(a.id) - ORDER.indexOf(b.id); });

      var html = '';
      /* 知识文案（对标 Cali「小知识」，对标报告 A2）：孕期按孕周分段、宝宝按月龄分段。
         只做中性的发展事实，不做医疗建议、不给达标线（U-25/U-37）。 */
      function starSign(m, d) {
        /* 每月 X 日（含）之后进入下一星座；摩羯跨年两端 */
        var edges = [20, 19, 21, 20, 21, 22, 23, 23, 23, 24, 23, 22];
        var names = ['摩羯', '水瓶', '双鱼', '白羊', '金牛', '双子', '巨蟹', '狮子', '处女', '天秤', '天蝎', '射手', '摩羯'];
        return names[(d < edges[m - 1]) ? (m - 1) : m];
      }
      /* 生肖按公历生日对照农历新年分界（2020 鼠年基准）；表外年份退化为按年估算 */
      var CNY = { 2019: 1, 2020: 1, 2021: 1, 2022: 1, 2023: 1, 2024: 1, 2025: 1, 2026: 1, 2027: 1, 2028: 1, 2029: 1, 2030: 1, 2031: 1, 2032: 1, 2033: 1, 2034: 1, 2035: 1 };
      CNY[2019] = '2019-02-05'; CNY[2020] = '2020-01-25'; CNY[2021] = '2021-02-12'; CNY[2022] = '2022-02-01';
      CNY[2023] = '2023-01-22'; CNY[2024] = '2024-02-10'; CNY[2025] = '2025-01-29'; CNY[2026] = '2026-02-17';
      CNY[2027] = '2027-02-06'; CNY[2028] = '2028-01-26'; CNY[2029] = '2029-02-13'; CNY[2030] = '2030-02-03';
      CNY[2031] = '2031-01-23'; CNY[2032] = '2032-02-11'; CNY[2033] = '2033-01-31'; CNY[2034] = '2034-02-19';
      CNY[2035] = '2035-02-08';
      function zodiacAnimal(y, m, d) {
        var iso = y + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d;
        var year = (CNY[y] && iso < CNY[y]) ? y - 1 : y;
        var Z = ['鼠', '牛', '虎', '兔', '龙', '蛇', '马', '羊', '猴', '鸡', '狗', '猪'];
        return Z[((year - 2020) % 12 + 12) % 12];
      }
      /* 第 67 次（B1）：知识句数据驱动——文案迁入 knowledge.js（带来源/层级/五要素），
         这里只按阶段查询并拼个性化前缀；区间与原 if 链逐日等价，文案一字未改。
         Knowledge 查询异常时返回 null，问候卡自动省略知识行，绝不影响渲染。 */
      function knowledgeLine() {
        var hit = null;
        if (wk !== null) {
          hit = Knowledge.pick('home', { stage: 'pregnancy', wk: wk });
        } else if (ageDays !== null && ageDays >= 0 && ageDays <= 730) {
          hit = Knowledge.pick('home', { stage: 'baby', ageDays: ageDays });
        }
        if (!hit) return null;
        if (hit.stage !== 'baby' || !bd) return hit.text;
        var bD = new Date(bd + 'T00:00:00');
        return '宝宝 ' + starSign(bD.getMonth() + 1, bD.getDate()) + '座 · 属' + zodiacAnimal(bD.getFullYear(), bD.getMonth() + 1, bD.getDate()) + '。' + hit.text;
      }
      var know = knowledgeLine();

      /* 顶部天空背景 + 问候（第 43 次）：日期并入问候卡首行（第 80 次重设计，
         用户点名「日期放在你好前，今天是几号什么节」），天空整幅让给天色与弧线。
         模块页日期仍用 index.html 的 #modDate 小徽标。 */
      var nowD = new Date();
      var DOW = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
      /* 第 80 次：问候卡头像位从品牌 LOGO 换成当前宝宝的照片——
         设置 · 宝宝档案里上传/切换，未上传时回落品牌 LOGO（PWA/favicon 同源图）。 */
      var actBaby = (Storage.activeBaby) ? Storage.activeBaby() : null;
      var avaSrc = (actBaby && actBaby.photo) ? actBaby.photo : 'assets/icon-192.png';
      /* 日期行：今天是 M月D日 周X · 节日（节日来自农历+公历+母亲/父亲节，纯本地计算） */
      var fest = (Util.festivalOf) ? Util.festivalOf(nowD) : null;
      html += '<section class="home-sky">'
        + '<canvas id="skyCanvas" class="sky-canvas" aria-hidden="true"></canvas>'
        /* 第 85 次：移除日轮弧线与太阳/月亮圆点——用户反馈「挡住了」内容。
           天空保留云/星/色板/环境光，问候卡直接叠在天空上不再被日轮穿插。 */
        + '<div class="sky-veil"></div>'
        + '<div class="home-greet">'
        + '<img class="home-logo" src="' + avaSrc + '" alt="" width="44" height="44">'
        + '<div class="hg-body">'
        + '<p class="hg-date">今天是' + (nowD.getMonth() + 1) + '月' + nowD.getDate() + '日 ' + DOW[nowD.getDay()]
        + (fest ? ' · <b class="hg-fest">' + Util.escapeHtml(fest) + '</b>' : '') + '</p>'
        + '<h1>' + Util.escapeHtml(greetWho) + '</h1><p>' + Util.escapeHtml(greetSub) + '</p>'
        + (know ? '<p class="know-hint">' + Util.escapeHtml(know) + '</p>' : '')
        + '</div></div>'
        + '</section>';

      /* 主体（单列） */
      html += '<div class="home-main">';
      /* 第 91 次：底边过渡带已删除——融合改由画布自身淡出为透明完成
         （sky.js fadeBottomOut），交界处即页面真实背景，日夜零横带。 */

      /* 本地提醒卡：基于「当前时间 × 已有数据」的温和注意（喂养间隔/计时进行中/经期临近/待产包/备份）。
         有提醒才渲染，无提醒不占位。
         U-04：可在设置里完全关闭；关掉后所有记录、导出、回顾功能照旧，无任何损失。
         页面内提醒不是系统推送——无网络、无 Service Worker，本地工具发不出推送，
         所以这里的开关属于「用户的注意力由用户决定」，不做任何诱导。 */
      if (global.Reminders && d.settings.remindersEnabled !== false) {
        var rems = Reminders.evaluate(d);
        if (rems.length) {
          html += '<div class="card remind-card"><h2>提醒</h2><ul class="list remind-list">';
          rems.forEach(function (r) {
            html += '<li data-accent="' + r.accent + '" data-go="' + r.go + '" role="button" tabindex="0">'
              + '<span class="row-ico">' + icon(r.accent === 'finance' ? 'export' : r.accent) + '</span>'
              + '<span>' + r.text + '</span></li>';
          });
          html += '</ul></div>';
        }
      }

      /* 「宝宝已出生？」生命周期过渡卡（对标 Cali，报告 A5）：
         预产期已过且未设宝宝生日时出现，一次点击完成「孕期 → 育儿」的叙事切换。 */
      if (dl !== null && dl < 0 && !bd) {
        html += '<div class="card review-card"><h2>宝宝已出生？</h2>'
          + '<p class="hint">预产期已过 ' + (-dl) + ' 天。如果宝宝已经来到你身边，设置生日即可切换到育儿工具——'
          + '孕期与这段等待的记录都会保留。</p>'
          + '<div class="row"><button class="btn btn-primary" id="bornGo" type="button">去设置生日</button></div></div>';
      }

      /* 第 56 次：今日概览数字卡已迁往「日期记录」页（Modules.home._todayStats）——
         磁贴改单列横条后每条直接显示今日摘要，数字卡与磁贴重复，不再在此渲染。 */

      /* 下次喂奶参考（对标 Cali 首页预测卡）：最近 48h ≥2 次喂养时，按自己的平均间隔正面预测；
         过点不催——「按需喂养就好」（U-25）。只在育儿阶段出现。 */
      if (bd && ageDays !== null && ageDays >= 0 && ageDays <= 730) {
        var feedWin = d.feedings.filter(function (r) { return r.start && (Date.now() - new Date(r.start).getTime()) < 48 * 3600000; })
          .sort(function (a, b) { return new Date(a.start) - new Date(b.start); });
        if (feedWin.length >= 2) {
          var gapsSum = 0;
          for (var g = 1; g < feedWin.length; g++) gapsSum += (new Date(feedWin[g].start) - new Date(feedWin[g - 1].start));
          var avgGap = gapsSum / (feedWin.length - 1);
          var nextMs = new Date(feedWin[feedWin.length - 1].start).getTime() + avgGap;
          var diffMin = Math.round((nextMs - Date.now()) / 60000);
          var nd = new Date(Math.max(nextMs, Date.now()));
          var hhmm = (nd.getHours() < 10 ? '0' : '') + nd.getHours() + ':' + (nd.getMinutes() < 10 ? '0' : '') + nd.getMinutes();
          html += '<div class="card feed-next"><span class="row-ico">' + icon('bottle') + '</span><div>'
            + '<b>下次喂奶参考</b><br>'
            + (diffMin >= 0
              ? '按最近 ' + feedWin.length + ' 次的节奏，大约 ' + hhmm + ' 前后。'
              : '比预计晚了 ' + (-diffMin) + ' 分钟——按需喂养就好，不用看表。')
            + '<i class="hint">间隔按你自己的记录估算，仅供参考。</i></div></div>';
        }
      }

      /* 生长速览卡（对标报告 P2 sparkline）：有生日 + ≥2 次测量时，给体重/身高的最新值与迷你趋势 */
      var growthAll = (d.growth || []).filter(function (r) { return r.date; })
        .sort(function (a, b) { return new Date(a.date) - new Date(b.date); });
      var wPts = growthAll.filter(function (r) { return r.weightKg != null; });
      var hPts = growthAll.filter(function (r) { return r.heightCm != null; });
      if (bd && (wPts.length >= 2 || hPts.length >= 2)) {
        function spark(vals) {
          var W = 120, H = 30, pad = 3;
          var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
          if (max === min) max = min + 1;
          var pts = vals.map(function (v, i) {
            var x = pad + (W - 2 * pad) * (i / (vals.length - 1));
            var y = H - pad - (H - 2 * pad) * ((v - min) / (max - min));
            return x.toFixed(1) + ',' + y.toFixed(1);
          }).join(' ');
          var last = pts.split(' ').pop().split(',');
          return '<svg class="spark" viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true">'
            + '<polyline points="' + pts + '"/><circle cx="' + last[0] + '" cy="' + last[1] + '" r="2.5"/></svg>';
        }
        html += '<div class="card"><h2>生长速览</h2><div class="gs-row">';
        if (wPts.length >= 2) {
          html += '<div class="gs-cell"><span class="gs-lbl">体重（最近 ' + wPts.length + ' 次）</span>'
            + '<span class="gs-val">' + wPts[wPts.length - 1].weightKg + ' kg</span>'
            + spark(wPts.map(function (r) { return r.weightKg; })) + '</div>';
        }
        if (hPts.length >= 2) {
          html += '<div class="gs-cell"><span class="gs-lbl">身长（最近 ' + hPts.length + ' 次）</span>'
            + '<span class="gs-val">' + hPts[hPts.length - 1].heightCm + ' cm</span>'
            + spark(hPts.map(function (r) { return r.heightCm; })) + '</div>';
        }
        html += '</div><p class="hint">看趋势不看单次；点「生长」磁贴可看百分位曲线。</p></div>';
      }

      /* 模块记录（第 56 次：单条信息行；第 57 次随用户反馈改左右结构）——
         每行：icon + 名称（左）+ 记录信息（右）+ 今日角标 + ›。
         名称与信息同一行左右分布，不再上下两行堆叠。 */
      html += '<h2 class="section-title">模块记录</h2><div class="record-grid">';
      tiles.forEach(function (t) {
        html += '<button class="record-tile" data-accent="' + t.accent + '" data-go="' + t.id + '" type="button">'
          + '<span class="rt-ico">' + icon(t.id) + '</span>'
          + '<span class="rt-name">' + t.name + '</span>'
          + '<span class="rt-sum">' + t.sum + '</span>'
          + (t.badge ? '<span class="rt-badge">' + t.badge + '</span>' : '')
          /* 第 58 次：› 文本字符换成项目统一的线性 SVG（chevron-right） */
          + '<span class="rt-arrow" aria-hidden="true">' + icon('chevron-right') + '</span>'
          + '</button>';
      });
      html += '</div>';

      /* U-34 容量近上限：强提示常驻（不自动消失、可延迟关闭、不阻断当前操作、带立即导出出口）。
         阈值是设计判断（报告未给具体上限），文案只陈述事实与代价，不做任何安全承诺（U-37）。 */
      var usage = (global.Storage && typeof Storage.usage === 'function') ? Storage.usage() : null;
      var capSnoozeActive = d.settings.capSnoozeISO && Util.daysBetween(d.settings.capSnoozeISO, today) < 3;
      if (usage && usage.nearLimit && !capSnoozeActive) {
        html += '<div class="card notice-banner" id="capBanner">'
          + '<h2>本机存储快满了</h2>'
          + '<p class="hint">浏览器给每个站点的本地存储有上限，目前已用约 ' + usage.pct + '%。'
          + '一旦写满，新的记录会保存失败——而且和清缓存一样，满了也不会有任何找回机会。</p>'
          + '<p class="hint">建议：先导出备份，再去「设置」删掉不需要的旧记录腾出空间。</p>'
          + '<div class="row"><button class="btn btn-primary" id="capExport" type="button">立即导出</button>'
          + '<button class="btn" id="capLater" type="button">3 天后再说</button></div></div>';
      }

      /* 第 59 次（降噪）：U-42「从未备份强提示卡」撤下——它与启动 toast、提醒卡、
         备份状态行四处同时轰炸，用户反馈「提醒框太多」。备份提醒收敛为一处：
         提醒卡条目（reminders.js ruleBackup，可随「首页提醒卡」开关整体关掉）；
         首页底部保留中性的备份状态行（是状态不是催促，点击可顺手导出）。 */

      /* U-30 首页底部中性备份状态行：不是按钮、不是 CTA、整行可点触发快捷导出（默认可迁移 JSON） */
      var lastExport = d.settings.lastExportISO;
      var daysSince = lastExport ? Util.daysBetween(lastExport, today) : null;
      var backupTxt = lastExport
        ? (daysSince === 0 ? '今天已导出备份' : '上次备份：' + daysSince + ' 天前') + '（点击可再导出）'
        : '从未备份（点击可导出一份）';
      html += '<div class="backup-line" id="backupLine" role="button" tabindex="0">' + icon('export')
        + '<span>所有数据仅存本机浏览器，不联网、不共享。' + backupTxt + '</span></div>';
      html += '</div>'; /* /.home-main */

      view.innerHTML = html;

      /* 模块记录 / 提醒列表 → 对应模块。
         第 58 次（走查）：提醒 li 有 tabindex=0 + role=button 却只绑了 click——
         键盘 Enter/Space 无效（a11y 缺口）。button 原生支持，li 补键盘触发。 */
      Array.prototype.forEach.call(view.querySelectorAll('[data-go]'), function (b) {
        b.addEventListener('click', function () { global.App.showTab(b.getAttribute('data-go')); });
        if (b.tagName === 'LI') {
          b.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); global.App.showTab(b.getAttribute('data-go')); }
          });
        }
      });

      /* 首页底部备份状态行 → 快捷导出（可迁移格式 JSON） */
      var bkLine = view.querySelector('#backupLine');
      function quickExport() { if (global.App && typeof App.exportAll === 'function') App.exportAll(); }
      if (bkLine) {
        bkLine.addEventListener('click', quickExport);
        bkLine.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); quickExport(); } });
      }
      /* U-34 容量近上限强提示卡：立即导出 / 延迟 3 天（不自动消失，可再次触发） */
      var capNow = view.querySelector('#capExport');
      if (capNow) capNow.addEventListener('click', quickExport);
      var capBannerEl = view.querySelector('#capLater');
      if (capBannerEl) capBannerEl.addEventListener('click', function () {
        d.settings.capSnoozeISO = Util.todayISO();
        Storage.save();
        global.App.rerender();
      });

      /* 「宝宝已出生？」→ 展开生长页的宝宝信息表单（生日与疫苗/生长共用） */
      var bornGo = view.querySelector('#bornGo');
      if (bornGo) bornGo.addEventListener('click', function () {
        if (global.Modules && Modules.growth) Modules.growth._bExpand = true;
        global.App.showTab('growth');
      });

      /* 启动天空（离开首页时 canvas 被移除，循环自动停止） */
      var canvas = view.querySelector('#skyCanvas');
      if (global.Sky && canvas) global.Sky.mount(canvas);
    }
  };

  /* 第 56 次（单条信息行）：今日概览数字卡迁往「日期记录」页。
     首页磁贴改成单列横条后，每条本身就直接显示今日摘要（喂养次数/睡眠最长
     连续/孕周进度），概览卡与磁贴完全重复；这里导出同一口径的今日数字速览，
     由 calendar.js 渲染在日历下方——单一来源：复用 pregnancyWeek / _longestMin。
     注意：必须在 Modules.home 对象字面量之后赋值（模块加载即执行）。 */
  Modules.home._todayStats = function (d) {
    var today = Util.todayISO();
    var bd = (d.settings.baby && d.settings.baby.birthDate) || null;
    var wk = pregnancyWeek(d);
    var pk = (d.packing && d.packing.items) ? d.packing.items : [];
    var pkDone = pk.filter(function (x) { return x.checked; }).length;
    var pkPct = pk.length ? Math.round(pkDone / pk.length * 100) : 0;
    function cnt(arr, key) {
      return (arr || []).filter(function (x) { return (x[key] || '').slice(0, 10) === today; }).length;
    }
    var sleepRecent = (d.sleeps || []).filter(function (s) { return s.end; })
      .sort(function (a, b) { return new Date(b.start) - new Date(a.start); })[0];
    var longestMin = (global.Modules && Modules.sleep && typeof Modules.sleep._longestMin === 'function')
      ? Modules.sleep._longestMin : function (s) {
          var w = (s.wakings == null) ? 0 : s.wakings;
          return Math.round((new Date(s.end) - new Date(s.start) - (s.pausedMs || 0)) / 60000 / (w + 1));
        };
    var lastLongestH = sleepRecent ? (longestMin(sleepRecent) / 60) : null;
    var sleepRange = (function () {
      if (!sleepRecent) return null;
      var cut = new Date(); cut.setDate(cut.getDate() - 7);
      var vs = (d.sleeps || []).filter(function (s) { return s.end && new Date(s.end) >= cut; })
        .map(longestMin).filter(function (v) { return v > 0; });
      if (vs.length < 2) return null;
      function f(v) { return (Math.round(v / 6) / 10).toFixed(1); }
      return f(Math.min.apply(null, vs)) + '–' + f(Math.max.apply(null, vs)) + ' 小时';
    })();
    var stats = [];
    if (lastLongestH != null) stats.push({ num: lastLongestH.toFixed(1), lbl: '昨夜最长连续', unit: '小时' });
    stats.push({ num: cnt(d.feedings, 'start'), lbl: '今日喂养', unit: '次' });
    stats.push({ num: cnt(d.diapers, 'time'), lbl: '今日尿布', unit: '次' });
    /* 第 89 次（审计 B1）：宫缩统计只出现在孕期——与宫缩磁贴（stages:['pregnancy']）
       同口径，育儿期不再出现「今日宫缩 0 次」的阶段错位 */
    var stNow = (global.App && typeof App.stageOf === 'function') ? App.stageOf(d) : (!bd ? 'pregnancy' : 'baby');
    if (stNow === 'pregnancy') stats.push({ num: cnt(d.contractions, 'start'), lbl: '今日宫缩', unit: '次' });
    if (wk !== null) stats.push({ num: cnt(d.fetal, 'time'), lbl: '今日胎动', unit: '次' });
    if (wk !== null) stats.push({ num: wk, lbl: '当前孕周', unit: '周' });
    if (pk.length) stats.push({ num: pkPct, lbl: '待产包', unit: '%' });
    return { stats: stats, sleepRange: sleepRange };
  };

  /* 第 111 次：导出 Q0 回访相关派生函数供 QA 直接断言。
     与 render() 内部走的是同一份实现，不另开测试专用分支——
     否则测的就不是线上真正跑的那段代码。 */
  Modules.home._lastAny = lastAny;
  Modules.home._lastAnySum = lastAnySum;
  Modules.home._gapText = gapText;
  Modules.home._dayLabel = dayLabel;
  Modules.home._hmOf = hmOf;
})(window);
