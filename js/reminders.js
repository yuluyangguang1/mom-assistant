/**
 * reminders.js - 本地提醒引擎（纯本地、零网络、无系统推送）
 *
 * 定位：基于「当前时间 × 已有数据」在首页顶部生成提醒卡，点击直达对应模块。
 * 不能用系统推送（无网络、无 Service Worker、file:// 环境），故做成页面内提醒。
 *
 * 规则设计原则：
 * 1. 每条规则返回 { accent, icon, text, go } 或 null（不触发）。
 * 2. 纯函数 evaluate(d, now)，不读 DOM，可单测。
 * 3. 提醒是「温和的注意」，不是告警——文案不制造焦虑。
 */
(function (global) {
  'use strict';

  function isoOf(s) { return (s || '').slice(0, 10); }
  function hoursSince(iso, now) {
    if (!iso) return null;
    var t = new Date(iso).getTime();
    if (isNaN(t)) return null;
    return Math.max(0, (now - t) / 3600000);
  }
  /* 第 125 次：日期工具改为复用 Util 的同名函数。
     原此处各持一份私有实现，与 util.js 是两套口径——util.js 修了
     「纯日期串 vs 日期时间串混用差一天」后，不一起改就会出现两套日期语义
     （本文件此前对 `daysBetween(isoOf(x), new Date(now))` 同样错一天）。
     统一到 Util 单一真源；Util 未加载时（理论上不会，index.html 里 util.js
     在前）回落到原实现，保证不抛错。 */
  function daysBetween(a, b) {
    if (window.Util && Util.daysBetween) return Util.daysBetween(a, b);
    return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
  }
  function addDays(iso, n) {
    if (window.Util && Util.addDays) return Util.addDays(iso, n);
    var d = new Date(iso);
    d.setDate(d.getDate() + n);
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }

  /* ---------- 各规则（返回提醒对象或 null） ---------- */

  /* 喂养间隔：距上次喂养 > 3 小时 */
  function ruleFeeding(d, now) {
    var latest = (d.feedings || []).slice()
      .sort(function (a, b) { return new Date(b.start) - new Date(a.start); })[0];
    if (!latest) return null;
    var h = hoursSince(latest.start, now);
    if (h === null || h < 3) return null;
    return {
      accent: 'feeding', go: 'feeding',
      text: '距上次喂养已过 ' + Math.floor(h) + ' 小时，宝宝可能该吃了。'
    };
  }

  /* 睡眠计时进行中 */
  function ruleSleep(d) {
    if (!d.openSleep) return null;
    return {
      accent: 'sleep', go: 'sleep',
      text: '睡眠计时进行中，宝宝醒来后记得点「结束并记录」。'
    };
  }

  /* 宫缩记录进行中 */
  function ruleContraction(d) {
    if (!d.openContraction) return null;
    return {
      accent: 'contraction', go: 'contraction',
      text: '宫缩记录进行中，注意间隔与强度变化。'
    };
  }

  /* 经期临近：按已有记录的平均周期预测下次，≤2 天提醒 */
  function rulePeriod(d, now) {
    /* 第 89 次（审计 A1）：产后守卫——宝宝出生后首年内不预测经期，
       与经期页 E3「产后首年放宽」同一口径：哺乳期复潮时间差异极大，
       「经期比预估晚了 N 天」在这段时间里是纯焦虑源（见审计报告 A1） */
    var bdPp = d.settings && d.settings.baby && d.settings.baby.birthDate;
    if (bdPp) {
      var dpp = daysBetween(isoOf(bdPp), new Date(now));
      if (dpp >= 0 && dpp <= 365) return null;
    }
    var ps = (d.periods || []).filter(function (p) { return p.start; })
      .sort(function (a, b) { return new Date(a.start) - new Date(b.start); });
    if (ps.length < 2) return null;
    /* 平均周期（最近最多 4 个间隔） */
    var gaps = [];
    for (var i = 1; i < ps.length; i++) {
      gaps.push(daysBetween(isoOf(ps[i - 1].start), isoOf(ps[i].start)));
    }
    gaps = gaps.slice(-4);
    var avg = gaps.reduce(function (s, x) { return s + x; }, 0) / gaps.length;
    if (avg < 15 || avg > 60) return null; /* 异常周期不预测，避免误导 */
    var lastStart = isoOf(ps[ps.length - 1].start);
    var nextIn = Math.round(avg - daysBetween(lastStart, new Date(now)));
    if (nextIn > 2 || nextIn < -7) return null; /* 已过 7 天以上也不再提醒 */
    return {
      accent: 'period', go: 'period',
      text: nextIn >= 0
        ? ('按近 ' + gaps.length + ' 个周期估算，经期可能 ' + (nextIn === 0 ? '就在今天' : nextIn + ' 天后') + ' 到来。')
        : '经期比预估晚了 ' + (-nextIn) + ' 天，留意身体变化。'
    };
  }

  /* 待产包告急：预产期 ≤30 天且完成度 <100% */
  function rulePacking(d, now) {
    var pg = d.pregnancy;
    if (!pg || !(pg.lmp || pg.dueDate)) return null;
    var Util = global.Util;
    var due = pg.dueDate || (Util && pg.lmp ? Util.addDays(pg.lmp, 280) : null);
    if (!due) return null;
    var left = daysBetween(new Date(now), isoOf(due));
    if (left < 0 || left > 30) return null;
    var items = (d.packing && d.packing.items) || [];
    /* 越临近预产期越紧急（第 109 次）：≤7 天算最高档，≤30 天次之。
       同样是「没打包」，还有 3 天和还有 28 天不该给同样的权重。 */
    var packLv = left <= 7 ? 2 : 1;
    if (!items.length) return {
      accent: 'packing', go: 'packing', remLevel: packLv,
      text: '预产期还有 ' + left + ' 天，待产包还没开始准备。'
    };
    var done = items.filter(function (x) { return x.checked; }).length;
    var pct = Math.round(done / items.length * 100);
    if (pct >= 100) return null;
    return {
      accent: 'packing', go: 'packing', remLevel: packLv,
      text: '预产期还有 ' + left + ' 天，待产包已完成 ' + pct + '%，抓紧收尾。'
    };
  }

  /* 备份提醒：已有数据且 >14 天未导出（第 59 次降噪：7→14 天，备份提醒收敛为
     提醒卡这一处——随「首页提醒卡」开关整体可关，状态细节由首页底部状态行承接） */
  function ruleBackup(d, now) {
    var has = (d.feedings || []).length || (d.sleeps || []).length || (d.growth || []).length
      || (d.periods || []).length || (d.contractions || []).length
      || (d.packing && d.packing.items && d.packing.items.length)
      || (d.finance && d.finance.records && d.finance.records.length);
    if (!has) return null;
    var last = d.settings && d.settings.lastExportISO;
    var days = last ? daysBetween(last, new Date(now)) : 999;
    if (days <= 14) return null;
    return {
      accent: 'finance', go: 'settings',
      text: last ? ('已 ' + days + ' 天未备份数据。') : '还没有备份过数据，建议导出一次防丢。'
    };
  }

  /* 疫苗到期：有宝宝生日 + 未种剂次≤7 天到期，或已逾期。
     第 109 次修正：原先只统计「逾期 ≤30 天」（left >= -30），
     导致逾期更久的剂次彻底从提醒里消失——而首页磁贴（home.js:123）
     与疫苗页（vaccine.js:108）都按三档口径显示「逾期较久」。
     同一件事两套口径：磁贴写着逾期 262 天，提醒卡却一声不吭。
     现在改为不限 30 天，逾期一律计入，并按「最久一剂」的实际天数给文案。 */
  function ruleVaccine(d, now) {
    var vac = global.Modules && global.Modules.vaccine;
    if (!vac || typeof vac._plan !== 'function') return null;
    var birth = d.settings && d.settings.baby && d.settings.baby.birthDate;
    if (!birth) return null;
    var done = (d.vaccines && d.vaccines.done) || {};
    var todayISO = new Date(now);
    todayISO = todayISO.getFullYear() + '-' + ('0' + (todayISO.getMonth() + 1)).slice(-2) + '-' + ('0' + todayISO.getDate()).slice(-2);
    var dueSoon = null, overdueN = 0, overdueWorst = 0;
    vac._plan(birth).forEach(function (it) {
      if (done[it.key]) return;
      var left = daysBetween(todayISO, it.dueISO);
      if (left >= 0 && left <= 7 && !dueSoon) dueSoon = it;
      /* 逾期一律计入（含逾期较久），并记住最久的一剂用于文案 */
      if (left < 0) { overdueN++; if (-left > overdueWorst) overdueWorst = -left; }
    });
    if (dueSoon) return {
      accent: 'vaccine', go: 'vaccine', remLevel: 1,
      /* 第 131 次（P0-b）：即便走「即将应种」分支，也带上逾期计数——
         磁贴角标「待补 N 剂」要的是 backlog 全量，与提醒卡展示哪条无关。 */
      pendingCount: overdueN,
      text: dueSoon.name + dueSoon.dose + (daysBetween(todayISO, dueSoon.dueISO) === 0 ? ' 今天应种。' : ' ' + daysBetween(todayISO, dueSoon.dueISO) + ' 天后应种。')
    };
    if (overdueN) return {
      accent: 'vaccine', go: 'vaccine', remLevel: 2,
      /* 第 129 次：标记 stale（陈旧待办）+ pendingLabel（单行汇总用的短标签）。
         对标 Cali——逾期在 Cali 只以 VaccineReminderPlan.pendingCount 这个计数存在，
         服务磁贴角标与本机通知，HomeWidgetSnapshot 里根本没有 reminder 字段。
         Web 端没有系统推送，不能彻底消失（否则用户找不到入口），但不再以
         整段文案占首屏：合并成一行「待补」汇总，详情进疫苗页看。
         第 131 次（P0-b）：pendingCount 同时喂首页疫苗磁贴角标
         （home.js 读 Reminders._pendingCounts，与本规则同源取数）。 */
      stale: true, pendingCount: overdueN, pendingLabel: '疫苗 ' + overdueN + ' 剂',
      /* 逾期超过 30 天时补出实际天数：家长需要知道拖了多久，
         但仍只陈述事实并把决定权交回（建议咨询门诊），不催、不吓。 */
      text: '有 ' + overdueN + ' 剂疫苗已逾期'
        + (overdueWorst > 30 ? '（最久一剂已过 ' + overdueWorst + ' 天）' : '')
        + '，建议尽快咨询接种门诊补种。'
    };
    return null;
  }

  /* 儿保体检到期（第 70 次，B4）：官方 0-6 岁健康管理节点，≤7 天到期或逾期 ≤30 天温和提示。
     只提示「可以预约 / 已过参考时间」，不催促不吓人；早产宝宝以医生安排为准，故文案用「参考时间」。 */
  function ruleCheckup(d, now) {
    var vac = global.Modules && global.Modules.vaccine;
    if (!vac || typeof vac._planCheckups !== 'function') return null;
    var birth = d.settings && d.settings.baby && d.settings.baby.birthDate;
    if (!birth) return null;
    var done = (d.checkups && d.checkups.done) || {};
    var nowD = new Date(now);
    var todayISO = nowD.getFullYear() + '-' + ('0' + (nowD.getMonth() + 1)).slice(-2) + '-' + ('0' + nowD.getDate()).slice(-2);
    var dueSoon = null, overdueN = 0, overdueWorst = 0;
    vac._planCheckups(birth).forEach(function (it) {
      if (done[it.key]) return;
      var left = daysBetween(todayISO, it.dueISO);
      if (left >= 0 && left <= 7 && (!dueSoon || left < daysBetween(todayISO, dueSoon.dueISO))) dueSoon = it;
      /* 与 ruleVaccine 同一口径（第 109 次）：逾期一律计入，不再卡 30 天上限，
         否则拖了很久的儿保节点会从提醒里静默消失。 */
      if (left < 0) { overdueN++; if (-left > overdueWorst) overdueWorst = -left; }
    });
    if (dueSoon) {
      var dl = daysBetween(todayISO, dueSoon.dueISO);
      return {
        accent: 'vaccine', go: 'vaccine', remLevel: 1,
        pendingCount: overdueN, /* 第 131 次（P0-b）：同 ruleVaccine——backlog 全量 */
        text: '儿保体检：' + dueSoon.name + (dl === 0 ? ' 参考时间就是今天，记得预约。' : ' ' + dl + ' 天后到期，可以预约了。')
      };
    }
    if (overdueN) {
      return {
        accent: 'vaccine', go: 'vaccine', remLevel: 2,
        /* 第 129 次：同 ruleVaccine——过期儿保节点是「预约一次门诊」的事，
           不是今天能打勾的待办，与疫苗逾期合并为同一行待补汇总。
           第 131 次（P0-b）：pendingCount 供首页磁贴角标同源取数。 */
        stale: true, pendingCount: overdueN, pendingLabel: '儿保体检 ' + overdueN + ' 次',
        text: '有 ' + overdueN + ' 次儿保体检已过参考时间'
          + (overdueWorst > 30 ? '（最久一次已过 ' + overdueWorst + ' 天）' : '')
          + '，建议尽快带宝宝体检。'
      };
    }
    return null;
  }

  /* 维 D 习惯：近 3 天有服药记录（说明在规律喂）但今天还没有 → 温和提醒
     第 131 次（P1-a）：「今天」改照护日口径（dayStart 可配，默认 0 = 公历日）——
     6:00 起始时，凌晨喂的维 D 仍算「今天喂过」，不会一大早弹「还没喂」。
     Util 未加载时（理论上不会，index.html 里 util.js 在前）回落本地日历日，
     与改前逐字节等价。 */
  function ruleMeds(d, now) {
    var meds = d.meds || [];
    if (!meds.length) return null;
    var DS = (window.Util && Util.dayStartHour) ? Util.dayStartHour(d) : 0;
    var nd = new Date(now);
    var dayNow = (window.Util && Util.dayKeyOf) ? Util.dayKeyOf(nd, DS)
      : nd.getFullYear() + '-' + ('0' + (nd.getMonth() + 1)).slice(-2) + '-' + ('0' + nd.getDate()).slice(-2);
    function sameDay(iso) {
      if (window.Util && Util.dayKeyOf) return Util.dayKeyOf(iso, DS) === dayNow;
      return (iso || '').slice(0, 10) === dayNow;
    }
    var hasToday = meds.some(function (r) { return sameDay(r.time); });
    if (hasToday) return null;
    var cutoff = new Date(now); cutoff.setDate(cutoff.getDate() - 3);
    var recent = meds.some(function (r) { return r.time && new Date(r.time) >= cutoff; });
    if (!recent) return null;
    return {
      accent: 'meds', go: 'meds', remLevel: 1,
      text: '今天的维生素 D 还没有喂，别忘了哦。'
    };
  }

  /* 尿布间隔：有记录习惯时，距上次含尿 >8 小时 / 含便 >48 小时 → 温和提示留意 */
  function ruleDiaperGap(d, now) {
    var ds = d.diapers || [];
    if (ds.length < 3) return null; /* 记录太少说明没在用，不打扰 */
    var lastPee = null, lastPoop = null;
    ds.forEach(function (r) {
      var t = r.time ? new Date(r.time).getTime() : 0;
      if (!t) return;
      if ((r.type === 'pee' || r.type === 'both') && (!lastPee || t > lastPee)) lastPee = t;
      if ((r.type === 'poop' || r.type === 'both') && (!lastPoop || t > lastPoop)) lastPoop = t;
    });
    var H = 3600000;
    if (lastPee && (now - lastPee) > 8 * H && (now - lastPee) < 48 * H) {
      return { accent: 'diaper', go: 'diaper', text: '已 ' + Math.floor((now - lastPee) / H) + ' 小时没记到尿了，留意一下宝宝尿量。' };
    }
    if (lastPoop && (now - lastPoop) > 48 * H && (now - lastPoop) < 7 * 24 * H) {
      return { accent: 'diaper', go: 'diaper', text: '已 ' + Math.floor((now - lastPoop) / (24 * H)) + ' 天没记到便便，可留意宝宝状态，必要时咨询医生。' };
    }
    return null;
  }

  /* 哄睡白噪音正在播放（W-02）：提醒里就带「还剩多久 / 不限时」，
     让「限制使用时长」这件事实实在界面上活着，而不是只写在说明里。 */
  function ruleWhiteNoise(d) {
    var wn = d.whitenoise;
    if (!wn || !wn.playing) return null;
    var mod = global.Modules && global.Modules.whitenoise;
    var rem = (mod && mod._remainingMin) ? mod._remainingMin() : null;
    return {
      accent: 'sleep', go: 'whitenoise',
      text: rem != null
        ? ('白噪音正在播放，还有约 ' + rem + ' 分钟自动关闭。')
        : '白噪音正在播放（当前不限时）——睡着后建议手动停掉，并把音量调低。'
    };
  }

  /* 发育里程碑观察期顺延提醒（第 109 次）：到月龄的检查点若还完全没对照过，
     在首页温和提一句「可以对照看看」，纯读取不落库。

     为什么需要它：探针实测（.research/probe109b.js 场景 D），
     ruleVaccine / ruleCheckup / rulePacking 都只管「到期未种/未检/未打包」，
     **里程碑观察期此前没有任何提醒规则**——家长不主动打开里程碑页，
     就永远不知道该到月龄对照了。

     刻意不做的事（与本项目既有口径一致）：
     - 不给「达标线」，不判达标/不达标（U-25：医学参考值不下结论）。
     - 不催、不吓：只说「可以对照看看」，并明确「想到再标，不用一次做完」。
     - 不提示未满月龄的检查点（早了没意义）。
     - 已在里程碑页给过医学预警的（未出现 ≥2 项）不在这里重复，
       首页只做「还没对照过」这一个最小提示。 */
  function ruleMilestone(d, now) {
    var birth = d.settings && d.settings.baby && d.settings.baby.birthDate;
    if (!birth) return null;
    var K = global.Knowledge;
    if (!K || !K.MILESTONES || !K.MILESTONES.length) return null;
    var today = new Date(now);
    var todayISO = today.getFullYear() + '-' + ('0' + (today.getMonth() + 1)).slice(-2) + '-' + ('0' + today.getDate()).slice(-2);
    var ageDays = daysBetween(birth, todayISO);
    if (ageDays < 0) return null; /* 生日填错/未来日期，不打扰 */
    var ageM = Math.floor(ageDays / 30.4375);
    /* 已对照过的（含「否」）一律视为已处理，不再提醒 */
    var marked = {};
    (d.milestoneObs || []).forEach(function (r) { if (r && r.id) marked[r.id] = 1; });
    /* 只找最近一个「到月龄且完全没对照过」的检查点，够用且不刷屏 */
    var months = {};
    K.MILESTONES.forEach(function (e) { if (e && e.kind === 'obs' && e.m) months[e.m] = true; });
    var ms = Object.keys(months).map(Number).sort(function (a, b) { return a - b; });
    for (var i = 0; i < ms.length; i++) {
      var m = ms[i];
      if (m > ageM) break;/* 未到月龄的检查点跳过 */
      var set = K.MILESTONES.filter(function (e) { return e.kind === 'obs' && e.m === m; });
      var untouched = set.filter(function (e) { return !marked[e.id]; });
      if (!untouched.length) continue;
      /* 只提示「一个都没对照过」；对照了一部分的留给里程碑页的医学预警处理，
         首页不重复——否则首页会变成第二份体检报告。 */
      if (untouched.length !== set.length) continue;
      var over = ageM - m;
      return {
        accent: 'milestone', go: 'milestone',
        /* 过期越久越该看一眼，但仍是「可以对照」而非「该担心」——
           发育进程有个体差异，医学判断交给儿保医生，这里只负责别忘了。 */
        remLevel: over >= 2 ? 2 : 1,
        /* 第 129 次：过期 ≥2 个月的对照项并入待补汇总行（stale）。
           过期 <2 个月仍是完整卡片——那是「最近该做」的事。
           第 131 次（P0-b）：过期时带 pendingCount:1，首页里程碑磁贴
           据此显示「待对照」角标（与疫苗磁贴同一套 pendingCount 机制）。 */
        stale: over >= 2 ? true : false,
        pendingCount: over >= 2 ? 1 : 0,
        pendingLabel: '发育对照 ' + m + ' 月龄',
        text: (over > 0 ? m + ' 月龄的发育观察期已过 ' + over + ' 个月，' : m + ' 月龄到了，')
          + '还没有对照过。想到再标就行，不用一次做完。'
      };
    }
    return null;
  }

  /* 胎动（孕 28 周起每天数）：有孕周且今天一条都没记时温和提醒一次；
     数胎动方法因医嘱而异，文案不给「达标线」（U-25），只提示留意。
     第 131 次（P1-a）：「今天」改照护日口径（同 ruleMeds）。 */
  function ruleFetal(d, now) {
    var pg = d.pregnancy || {};
    var base = pg.lmp || pg.dueDate;
    if (base === pg.dueDate && base) base = addDays(base, -280); /* 预产期反推末次月经 */
    if (!base) return null;
    var days = daysBetween(base, new Date(now));
    if (days < 28 * 7) return null; /* 一般孕 28 周起才数，早了不打扰 */
    var DS = (window.Util && Util.dayStartHour) ? Util.dayStartHour(d) : 0;
    var nowD = new Date(now);
    var t = (window.Util && Util.dayKeyOf) ? Util.dayKeyOf(nowD, DS)
      : nowD.getFullYear() + '-' + ('0' + (nowD.getMonth() + 1)).slice(-2) + '-' + ('0' + nowD.getDate()).slice(-2);
    var todayN = (d.fetal || []).filter(function (r) {
      return (window.Util && Util.dayKeyOf) ? Util.dayKeyOf(r.time, DS) === t : isoOf(r.time) === t;
    }).length;
    if (todayN > 0) return null;
    return {
      accent: 'fetal', go: 'fetal',
      text: '今天还没记胎动。孕晚期可以每天固定时间数一数，方法以产检医生教你的为准。'
    };
  }

  var RULES = [ruleSleep, ruleContraction, ruleWhiteNoise, ruleFeeding, ruleVaccine, ruleCheckup, ruleMeds, ruleDiaperGap, rulePacking, rulePeriod, ruleFetal, ruleMilestone, ruleBackup];

  /* 第 109 次：提醒的收敛与排序。
     此前 evaluate 按 RULES 数组固定顺序输出、不排序、也不设上限——
     探针 F 实测确认。但现在规则增加到 13 条，叠加场景（如宝宝半岁+
     疫苗逾期+儿保过期+待产包未完成）会让首页提醒卡堆到 5、6 条，
     提醒一旦堆叠就等于没有提醒（「什么都紧急」= 什么都不紧急）。

     排序口径：已逾期/已过期的排最前（level 2），即将到期次之（level 1），
     其余（备份、经期等非倒计时类）排最后（level 0）。
     level 由规则自己声明 remLevel，默认 0。 */
  var MAX_REMINDERS = 3;

  var Reminders = {
    /** 评估全部规则，返回触发的提醒数组（now 默认当前时间，可注入便于测试）
     *  第 109 次：按紧急度排序并截断到 MAX_REMINDERS 条。 */
    evaluate: function (d, now) {
      now = now || Date.now();
      d = d || {};
      var out = [];
      RULES.forEach(function (r) {
        try { var hit = r(d, now); if (hit) out.push(hit); } catch (e) {}
      });
      /* 稳定排序：level 降序；同 level 保持 RULES 声明顺序（Array#sort 在
         V8 上是稳定排序，ES2019 起为规范要求，不依赖实现细节也成立）。 */
      out = out.map(function (x, i) { return { x: x, i: i }; })
        .sort(function (a, b) {
          var d = (b.x.remLevel || 0) - (a.x.remLevel || 0);
          return d !== 0 ? d : a.i - b.i;
        })
        .map(function (o) { return o.x; });

      /* ------------------------------------------------------------------
         第 129 次：陈旧待办合并为单行「待补」汇总（对标 Cali 首屏设计）。

         问题（2026-10-13 用户实测首屏）：疫苗 17 剂逾期（最久 712 天）、
         儿保 7 次过参考时间（705 天）、发育观察期已过 20 个月——三条
         level 2 提醒把首页提醒卡占满。它们共同点是**今天不可能完成**
         （补种 17 剂要跑门诊、对照发育不是一次点完的），于是会永久
         挂在首页，把「此刻可做」的提醒（维D没喂、尿布间隔、今天应种）
         全部挤出屏幕——「什么都紧急」= 什么都不紧急。

         Cali 的做法（Mac 侧逆向实证）：HomeWidgetSnapshot 的字段是
         activeBaby/accessState/stage/appearance/activeSession/directRecordSessions/
         recents/today/careSummary/pregnancy/postpartum/tools——**没有 reminder**。
         逾期信息只以 VaccineReminderPlan.pendingCount 这个「计数」存在，
         服务磁贴角标与本机通知（VaccineReminderPlanner.plans(...) → 提醒日期）。

         Web 端没有系统推送，不能照搬「彻底移出」——那会让用户找不到入口
         （第 109 次特意加了「不静默消失」的口径）。折中：stale 项合并成
         **一行**待补汇总，数字与入口都在，正文空间还给此刻提醒。
         总数仍受 MAX_REMINDERS 约束（汇总行也占一格）。 */
      var stale = out.filter(function (x) { return x.stale; });
      var budget = MAX_REMINDERS - (stale.length ? 1 : 0);
      var fresh = out.filter(function (x) { return !x.stale; }).slice(0, budget);
      if (stale.length) {
        fresh.unshift({
          accent: stale[0].accent, go: stale[0].go,
          remLevel: 2, stale: true, pending: true,
          items: stale.map(function (x) { return { label: x.pendingLabel, go: x.go }; }),
          /* 「待补」而非「逾期 N 天」：只陈述事实，不催不吓（沿用 U-25 口径） */
          text: '待补：' + stale.map(function (x) { return x.pendingLabel; }).join(' · ')
        });
      }
      return fresh;
    },
    /* 导出给 QA 驱动：规则内部细节不外露，只暴露常量与规则条数 */
    _MAX: MAX_REMINDERS,
    _ruleCount: function () { return RULES.length; },
    /* 第 131 次（P0-b · 对标 Cali VaccineReminderPlan.pendingCount）：
       陈旧待办计数——首页磁贴角标的数据源（疫苗「待补 N 剂」/
       里程碑「待对照」）。与提醒卡同源：直接跑同三条规则读
       pendingCount，不另写一套统计（两套口径是这个项目反复踩的坑）。
       儿保体检没有独立磁贴，其计数只进待补汇总行，这里也返回
       （home.js 暂不消费，留给后续磁贴/统计复用）。 */
    _pendingCounts: function (d, now) {
      now = now || Date.now();
      d = d || {};
      var out = { vaccine: 0, checkup: 0, milestone: 0 };
      function grab(rule, key) {
        try {
          var hit = rule(d, now);
          if (hit && hit.pendingCount) out[key] = hit.pendingCount;
        } catch (e) {}
      }
      grab(ruleVaccine, 'vaccine');
      grab(ruleCheckup, 'checkup');
      grab(ruleMilestone, 'milestone');
      return out;
    },
    _rules: RULES
  };

  global.Reminders = Reminders;
})(window);
