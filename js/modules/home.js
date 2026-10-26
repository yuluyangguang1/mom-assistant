/**
 * home.js - 首页（天空背景 + 模块化记录）
 * 顶部：Web 版 swiftui-sky 动态天空（由本地时间/季节驱动，纯程序化、零网络）
 * 左上角宝宝头像在全局 header（点击进设置）。
 * 主体：模块记录单条信息行（第 56 次起；今日概览数字卡已迁日期记录页）。
 * 每日记录日历已独立为底部「日期记录」整页，不在首页内嵌。
 * 第 120 次：布局编辑（对标第五批 Cali 组件画布）——settings.homeLayout
 * 手动策展接管自动策展（阶段筛选+收敛），编辑模式/组件目录/大小两档/长按拖动，
 * 数据层见文件中部「布局数据层」块；纪律：删除≠隐藏能力（目录可加回+全部功能兜底）。
 */
(function (global) {
  'use strict';
  var Storage = global.Storage, Util = global.Util;
  var Modules = global.Modules = global.Modules || {};

  /* 第 131 次（P1-a · 对标 Cali DailyCareRecapBuilder 的 dayStart）：
     照护日口径——「今日从几点开始算」可在设置里配（默认 0 = 公历日）。
     记录计数/归属一律走 careKeyOf / careDayNow；疫苗剂次、预产期、
     备份天数等日历日语义继续用 Util.todayISO()——门诊认公历日。
     dayStart=0 时本组函数与改前的 slice(0,10)/todayISO 逐字节等价。 */
  function careDS() { return Util.dayStartHour(Storage.get()); }
  function careDayNow() { return Util.dayKeyOf(new Date(), careDS()); }
  function careKeyOf(x) { return Util.dayKeyOf(x, careDS()); }

  function countToday(arr, key, now) {
    var t = now ? Util.dayKeyOf(now, careDS()) : careDayNow(); /* 第 115 次：口径与 dayLabel 统一 */
    return (arr || []).filter(function (x) { return careKeyOf(x[key]) === t; }).length;
  }
  /* 第 56 次（单条信息行）：今天最近一次的时刻（HH:MM），给磁贴摘要补充「最近几点」。
     单列横行后有空间多放一段信息，数字与时刻一起构成一眼可读的今日节奏。 */
  function lastToday(arr, key, now) {
    var t = now ? Util.dayKeyOf(now, careDS()) : careDayNow(); /* 第 115 次：口径与 dayLabel 统一 */
    var hits = (arr || []).filter(function (x) { return careKeyOf(x[key]) === t; })
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
       两套「今天」打架，跨天时标签整体错一天。
       第 131 次（P1-a）：两侧同切换到照护日口径（dayStart 可配）——
       记录自身也按 careKeyOf 归属，00:30 记的一笔在 6:00 起始下
       显示「今天」而不是「昨天」。dayStart=0 时与改前逐字节等价。 */
    var today = now ? Util.dayKeyOf(now, careDS()) : careDayNow();
    var diff = Util.daysBetween(careKeyOf(dt), today);
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
  function fmtMoney(n) { return Util.fmtYuan(n); } /* 第 274 次（#26）：全站金额统一 ¥0.30 */

  /* 「昨夜最长连续」= 昨夜（归属到前一夜的那一组）里单段最长连续睡眠的小时数。
     2026-10-12 修正（第 128 次）：原实现取「start 最新的已结束睡眠」——
     今天下午补记一段午睡，就会把写着「昨夜最长连续」的磁贴/统计顶成午睡值，
     标错对象。改为按 sleep.js 的 lastNightRecords 归属口径取昨夜整组，
     再取组内最长一段；两处调用（render 磁贴 + _todayStats）共用本函数。 */
  function lastNightLongestH(d) {
    var sleeps = (d && d.sleeps) || [];
    var longestMin = (global.Modules && Modules.sleep && typeof Modules.sleep._longestMin === 'function')
      ? Modules.sleep._longestMin : function (s) {
          var w = (s.wakings == null) ? 0 : s.wakings;
          return Math.round((new Date(s.end) - new Date(s.start) - (s.pausedMs || 0)) / 60000 / (w + 1));
        };
    var recs;
    if (global.Modules && Modules.sleep && typeof Modules.sleep._lastNightRecords === 'function') {
      recs = Modules.sleep._lastNightRecords(sleeps);
    } else {
      /* sleep.js 未加载时的同口径兜底（nightKeyOf：6 点前入睡归属前一天） */
      var base = Util.addDays(Util.fmtDate(new Date()), -1);
      recs = sleeps.filter(function (s) {
        if (!s || !s.end) return false;
        var st = new Date(s.start);
        if (isNaN(st.getTime())) return false;
        var iso = Util.fmtDate(s.start);
        return (st.getHours() < 6 ? Util.addDays(iso, -1) : iso) === base;
      });
    }
    var best = 0;
    recs.forEach(function (s) { var v = longestMin(s); if (v > best) best = v; });
    return best > 0 ? best / 60 : null;
  }

  function pregnancyWeek(d) {
    var pg = d.pregnancy;
    if (!pg || !(pg.lmp || pg.dueDate)) return null;
    /* 第 220 次：这次怀孕之后已经有宝宝出生 → 孕期结束，不再显示孕周 */
    if (global.App && typeof App.pregnancyWeekOf === 'function' && App.pregnancyWeekOf(d) === null) return null;
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
      /* 第 131 次（P1-a）：照护日「今天」——记录计数专用。
         与上面的 today（公历日）并存：疫苗剂次/预产期/备份天数等
         日历日语义继续用 today，两条线不混用（睡笔记的是「时刻」，
         门诊预约认的是「日期」，本来就不该同一把尺子）。 */
      var dayNow = careDayNow();

      /* 问候语 */
      /* 称呼取自首次引导里选的身份 / 称呼（O 系列）：只影响问候语，不做任何用户画像。
         没选身份时保持中性的「你好」，不硬猜。 */
      var cg = (d.settings && d.settings.caregiver) || null;
      var roleWord = (cg && cg.role === 'mom') ? '妈妈'
        : ((cg && cg.role === 'dad') ? '爸爸' : ((cg && cg.role === 'other') ? '照护者' : ''));
      var who = (cg && cg.name) ? cg.name : roleWord;
      var greetWho = who ? ('你好，' + who) : '你好';
      /* P2 动态问候落地：优先宝宝月龄（产后），其次孕周 + 预产期倒计时；数据都没有才用通用文案。
         只动副标题（greetSub），h1 的身份问候逻辑与既有测试保持不变。
         第 131 次（P0-a）：副标题从独立一行并入 h1 行内（.hg-sub），
         文案同步收敛为事实核心——用户 10-13 实测首屏点名
         「日期/身份/月龄/星座/提示占太多行，这里也是」，
         对标 Cali HomeWidgetBaby（activeBaby + stage 两要素）：
         首屏只放「今天是谁、什么阶段」，情感句与装饰前缀让位。 */
      var greetSub = '好好照顾自己和宝宝';
      var bd = (d.settings.baby && d.settings.baby.birthDate) || null;
      var ageDays = bd ? Util.daysBetween(bd, today) : null;
      var dl = dueLeft(d);
      if (ageDays !== null && ageDays >= 0 && ageDays <= 730) {
        if (ageDays >= 294) greetSub = '宝宝 ' + Math.floor(ageDays / 30.44) + ' 个月大了';
        else if (ageDays >= 1) greetSub = '宝宝出生第 ' + (ageDays + 1) + ' 天'; /* 第 222 次：与问候卡「出生第 N 天」同口径（出生当天 = 第 1 天） */
        else greetSub = '欢迎新生命';
      } else if (dl !== null) {
        if (dl > 0) {
          var wkNow = pregnancyWeek(d);
          greetSub = (wkNow !== null ? '孕 ' + wkNow + ' 周 · ' : '')
            + '距预产期 ' + dl + ' 天';
        }
        else if (dl >= -30) greetSub = '宝宝正在来到你身边';
        else greetSub = '欢迎新生命';
      }

      /* 第 155 次（hero 重设计）：问候按时段，阶段做成大数字。
         greetSub 仍保留（无数字时作说明行），另算 stat = {num, unit, cap}。 */
      /* 第 156 次：问候语交给 js/greetings.js（阶段 × 时段 × 特殊日子，一天内同时段不变）。
         加句子只改 greetings.js 的 LIB，不用动这里。 */
      var gNow = new Date();
      var festRaw = Util.festivalOf ? Util.festivalOf(gNow) : null;
      var festG = null;
      if (festRaw) {
        var fl = festRaw.split(' · ').filter(function (f) {
          if (f === '教师节') return false;
          if (f === '父亲节') return cg && cg.role === 'dad';
          if (f === '母亲节') return !(cg && cg.role === 'dad');
          return true;
        });
        festG = fl[0] || null;
      }
      var monthDay = null;
      if (bd && ageDays !== null && ageDays > 30) {
        var bDt = new Date(bd + 'T00:00:00');
        if (bDt.getDate() === gNow.getDate()) {
          var mCount = (gNow.getFullYear() - bDt.getFullYear()) * 12 + (gNow.getMonth() - bDt.getMonth());
          if (mCount >= 2 && mCount % 12 !== 0) monthDay = mCount;
        }
      }
      var pwG = pregnancyWeek(d);
      if (global.Greetings) {
        greetWho = Greetings.pick({
          now: gNow, who: who, role: roleWord || '',
          ageDays: (ageDays !== null && ageDays >= 0 && ageDays <= 1095) ? ageDays : null,
          pregWeek: (ageDays === null || ageDays < 0) ? pwG : null,
          dueLeft: (ageDays === null || ageDays < 0) ? dl : null,
          fest: festG, monthDay: monthDay
        }).text;
      }
      var stat = null;
      if (ageDays !== null && ageDays >= 1 && ageDays <= 730) {
        var mo = Math.floor(ageDays / 30.44), rem = ageDays - Math.round(mo * 30.44);
        if (rem < 0) rem = 0;
        if (ageDays >= 294) stat = { num: String(mo), unit: '个月', cap: '宝宝' + (rem ? ' · 又 ' + rem + ' 天' : '') };
        else stat = { num: String(ageDays), unit: '天', cap: '宝宝出生' + (mo ? ' · ' + mo + ' 个月' + (rem ? ' ' + rem + ' 天' : '') : '第 ' + ageDays + ' 天') };
      } else if (ageDays === null && dl !== null && dl > 0) {
        var wkS = pregnancyWeek(d);
        stat = wkS !== null ? { num: String(wkS), unit: '周', cap: '孕期 · 距预产期 ' + dl + ' 天' }
          : { num: String(dl), unit: '天', cap: '距预产期' };
      }

      /* 模块记录摘要 */
      /* 第 111 次：lastAnySum 要「现在」来算间隔。本段单独取一次并复用，
         避免同一屏两个磁贴算出跨秒不一致的间隔。
         刻意不与下方的 nowD 合并——nowD 服务于问候卡日期，两处语义不同，
         混用会在跨零点渲染时把日期和间隔算到不同的「现在」。 */
      var sumNow = new Date();
      var feedToday = countToday(Util.babyFeeds(d.feedings), 'start');
      var diaperToday = countToday(d.diapers, 'time');
      var contraToday = countToday(d.contractions, 'start');
      /* 第 128 次：昨夜最长连续改走共享口径（昨夜整组取最长一段），
         不再取「start 最新的已结束睡眠」——午睡会把磁贴顶成错值。 */
      var lastLongestH = lastNightLongestH(d);
      /* 第 278 次（审计 #37）：取最近一条「有体重」的记录；都没有体重时退到最近的身长 / 头围，不再出现「最近 null kg」 */
      var growthByDate = (d.growth || []).filter(function (r) { return r && r.date; }).slice()
        /* 第 284 次：同一天记了几次时按测量时刻（at）排，最近一次在前 */
        .sort(function (a, b) { var x = String(b.date) + (b.at || ''), y = String(a.date) + (a.at || ''); return x < y ? -1 : x > y ? 1 : 0; });
      var weightRecent = growthByDate.filter(function (r) { return r.weightKg != null && r.weightKg !== ''; })[0];
      var growthSum = '暂无';
      if (weightRecent) growthSum = '最近 ' + weightRecent.weightKg + ' kg';
      else {
        var hR = growthByDate.filter(function (r) { return r.heightCm != null && r.heightCm !== ''; })[0];
        var cR = growthByDate.filter(function (r) { return r.headCm != null && r.headCm !== ''; })[0];
        if (hR) growthSum = '最近身长 ' + hR.heightCm + ' cm';
        else if (cR) growthSum = '最近头围 ' + cR.headCm + ' cm';
      }
      var wk = pregnancyWeek(d);
      var pk = (d.packing && d.packing.items) ? d.packing.items : [];
      var pkDone = pk.filter(function (x) { return x.checked; }).length;
      var pkPct = pk.length ? Math.round(pkDone / pk.length * 100) : 0;
      var periods = d.periods || [];
      /* 第 278 次（审计 #36）：按开始日期倒序取最近一次（补记的更早记录排在数组后面也不影响）；进行中同样取最近那条 */
      var perByStart = periods.filter(function (p) { return p && p.start && isoOf(p.start) <= today; }).slice()
        .sort(function (a, b) { return isoOf(b.start) < isoOf(a.start) ? -1 : isoOf(b.start) > isoOf(a.start) ? 1 : 0; });
      var ongoing = perByStart.filter(function (p) { return !p.end || isoOf(p.end) >= today; })[0];
      var periodInfo = '未记录';
      if (ongoing) periodInfo = '经期第 ' + (Util.daysBetween(isoOf(ongoing.start), today) + 1) + ' 天';
      else if (perByStart.length) periodInfo = '上次 ' + Util.daysBetween(isoOf(perByStart[0].start), today) + ' 天前';
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

      /* 第 131 次（P0-b · 对标 Cali VaccineReminderPlan.pendingCount）：
         逾期计数上文磁贴角标。Cali 的 HomeWidgetSnapshot 字段里没有任何
         reminder——逾期只以 pendingCount 这个「计数」存在，喂磁贴角标与
         本机通知。Web 端没有系统通知，磁贴角标就是它的落点：
         即使用户关掉首页提醒卡（U-04），疫苗磁贴仍显示「待补 N 剂」，
         不静默消失（第 109 次口径）。计数与提醒卡同源——都走
         Reminders._pendingCounts，不另写一套统计（否则又会两套口径）。
         儿保体检没有独立磁贴（与疫苗同页同入口），留在待补汇总行里；
         里程碑有自己的磁贴，过期未对照时给它「待对照」角标。 */
      var pendN = (global.Reminders && typeof Reminders._pendingCounts === 'function')
        ? Reminders._pendingCounts(d) : null;
      if (pendN && pendN.vaccine > 0) vaxBadge = '待补 ' + pendN.vaccine + ' 剂';
      var msBadge = (pendN && pendN.milestone) ? '待对照' : '';

      var medsToday = countToday(d.meds, 'time');
      var msRecent = (d.milestones || []).slice()
        .sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); })[0];
      /* 妈妈情绪（第 66 次 · F 线）：今日最近一次档位词；与宝宝记录同权重的「记录你自己」入口 */
      var moodToday = (d.moods || []).filter(function (r) { return careKeyOf(r.time) === dayNow; })
        .sort(function (a, b) { return new Date(b.time) - new Date(a.time); })[0];
      var MOOD_LV = { 1: '很低落', 2: '有点低', 3: '一般', 4: '不错', 5: '很好' };
      var moodSum = moodToday ? ('今天 ' + (MOOD_LV[moodToday.level] || '已记录')) : '暂无今日';
      var moodDad = !!(d.settings && d.settings.caregiver && d.settings.caregiver.role === 'dad');
      /* 胎动（对标 Cali 补齐）：只在有孕周时出现——磁贴与统计都跟阶段走 */
      var fetalToday = countToday(d.fetal, 'time');
      /* 体温（第 38 次补齐）：磁贴显示今日最高 */
      var tempTodayList = (d.temps || []).filter(function (r) { return careKeyOf(r.time) === dayNow; });
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
      var feedRaw = lastAnySum(Util.babyFeeds(d.feedings), 'start', sumNow);
      var diaperRaw = lastAnySum(d.diapers, 'time', sumNow);
      var feedSum = feedRaw || '暂无今日';
      var diaperSum = diaperRaw || '暂无今日';

      /* 第 58 次（走查）：badge 只保留「状态词」（计时中/临近）——单条信息行右侧
         摘要已含全部数字（今日 N 次 / 第 N 周 / 已备 N%），数字角标与文字完全重复，
         属视觉冗余；状态词是摘要表达不了的信息，保留。 */
      var tiles = [
        /* 第 118 次（首页收敛 · 空状态三态）：每个 tile 显式带两个布尔字段，
           不靠比对 sum 文案（文案一改就崩）。
             guide:true  = 引导型。没有数据也要留在原地教用户怎么开始 → 永远渲染。
             empty:true  = 当前无数据。回顾型（"上次 X / 今天 X 次"）无数据只是噪声，
                           收敛开启时被过滤掉；引导型不受 empty 影响。
           计时进行中的 tile（sleep/contraction）empty 恒为 false —— 进行中的状态不能被藏掉。 */
        { id: 'feeding', stages: ['baby'], name: '喂养', accent: 'feeding', sum: feedSum, badge: '', empty: !feedRaw },
        { id: 'diaper', stages: ['baby'], name: '尿布', accent: 'diaper', sum: diaperSum, badge: '', empty: !diaperRaw },
        { id: 'sleep', stages: ['baby'], name: '睡眠', accent: 'sleep', sum: osTile ? ('计时中 · 已 ' + Util.fmtDuration(openElapsedMs(osTile))) : ((lastLongestH != null ? ('昨夜最长连续 ' + lastLongestH.toFixed(1) + ' 小时') : '暂无') + sleepWake), badge: osTile ? '计时中' : '', empty: (!osTile && lastLongestH == null) },
        { id: 'whitenoise', stages: ['baby'], name: '哄睡白噪音', accent: 'sleep', sum: noiseInfo, guide: true, empty: false },
        { id: 'growth', stages: ['baby'], name: '生长', accent: 'growth', sum: growthSum, empty: !growthByDate.length },
        { id: 'vaccine', stages: ['baby'], name: '疫苗', accent: 'vaccine', sum: vaxInfo, badge: vaxBadge, guide: true, empty: false },
        { id: 'meds', stages: ['baby', 'pregnancy'], name: '吃药/维D', accent: 'meds', sum: medsToday ? ('今日 ' + medsToday + ' 次') : '暂无今日', badge: '', guide: true, empty: !medsToday },
        { id: 'milestone', stages: ['baby'], name: '里程碑', accent: 'milestone', sum: msRecent ? msRecent.title : '暂无', badge: msBadge, empty: !msRecent },
        { id: 'period', stages: ['baby'], name: '经期', accent: 'period', sum: periodInfo, empty: (!ongoing && !periods.length) },
        { id: 'mood', stages: ['baby', 'pregnancy'], name: '妈妈情绪', accent: 'mood', sum: moodSum, guide: !moodDad, empty: !moodToday }, /* 第 244 次：爸爸身份不当引导项 */
        { id: 'pregnancy', stages: ['pregnancy'], name: '孕期', accent: 'pregnancy', sum: wk !== null ? (wk >= 40 && dueLeft(d) < 0 ? '已过预产期 ' + (-dueLeft(d)) + ' 天' : '第 ' + wk + ' 周') : '未设置' /* 第 193 次 */, badge: '', guide: true, empty: wk === null },
        { id: 'packing', stages: ['pregnancy'], name: '待产包', accent: 'packing', sum: pk.length ? ('已备 ' + pkPct + '%') : '未开始', badge: '', guide: true, empty: !pk.length },
        { id: 'contraction', stages: ['pregnancy'], name: '宫缩', accent: 'contraction', sum: ocTile ? ('计时中 · 已 ' + Util.fmtSecDur(openElapsedMs(ocTile))) : (contraToday ? ('今日 ' + contraToday + ' 次') : '暂无今日'), badge: ocTile ? '计时中' : '', guide: true, empty: (!ocTile && !contraToday) }
      ];
      if (wk !== null) {
        tiles.push({ id: 'fetal', stages: ['pregnancy'], name: '胎动', accent: 'fetal', sum: fetalToday ? ('今日 ' + fetalToday + ' 次') : '暂无今日', badge: '', empty: !fetalToday });
      }
      tiles.push({ id: 'temp', stages: ['baby', 'pregnancy'], name: '体温', accent: 'temp', sum: tempTodayMax != null ? ('今日最高 ' + tempTodayMax + '°C') : '暂无今日', guide: false, empty: tempTodayMax == null });
      tiles.push({ id: 'finance', stages: ['baby', 'pregnancy'], name: '记账', accent: 'finance', sum: monthSum ? ('本月 ' + fmtMoney(monthSum)) : '本月无', empty: !monthSum });
      /* 第 107 次：消耗品。摘要复用模块自己的低库存判定（渲染期派生，不写库）。 */
      var supSum = (global.Modules && Modules.supplies && typeof Modules.supplies._summary === 'function')
        ? Modules.supplies._summary(d.supplies) : '';
      tiles.push({ id: 'supplies', stages: ['baby'], name: '消耗品', accent: 'supplies', sum: supSum, badge: '', guide: false, empty: !(d.supplies || []).length });

      /* 第 132 次（对标 Cali 21 工具补缺）：洗澡 / 游泳 / 日晒 / 饮水 / 黄疸 / 补剂。
         一律 guide:false + empty:!有数据 —— 沿用第 118 次的首屏收敛纪律：
         没数据就不占位（不把首屏塞满低频模块），入口由「全部功能」页兜底；
         一旦记过就自动出现在磁贴网格里。 */
      var mon132 = Util.todayISO().slice(0, 7);
      function cnt132(arr, scope) {
        return (arr || []).filter(function (r) {
          if (!r || !r.time) return false;
          return scope === 'month'
            ? String(r.time).slice(0, 7) === mon132
            : careKeyOf(r.time) === careDayNow();
        }).length;
      }
      function sum132(arr, key) {
        return (arr || []).reduce(function (s, r) {
          if (!r || !r.time) return s;
          if (careKeyOf(r.time) !== careDayNow()) return s;
          var v = r[key];
          return s + (typeof v === 'number' && isFinite(v) ? v : 0);
        }, 0);
      }
      var bathM = cnt132(d.baths, 'month');
      var swimM = cnt132(d.swims, 'month');
      var sunMin = sum132(d.suns, 'minutes');
      var waterMl = sum132(d.waters, 'ml');
      var jaunLast = (d.jaundices || []).slice()
        .filter(function (r) { return r && typeof r.value === 'number' && isFinite(r.value); })
        .sort(function (a, b) { return new Date(b.time) - new Date(a.time); })[0];
      /* 第 280 次：「今天要吃几次」按服用日程算（每周特定几天 / 隔天的计划，不在今天就不计）；口径与营养品页同一份 */
      var supDue = (Modules.supplement && Modules.supplement._due) ? Modules.supplement._due(d) : [];
      var supNeed = supDue.reduce(function (s, x) { return s + x.need; }, 0);
      var supDone = supDue.reduce(function (s, x) { return s + x.done; }, 0);

      tiles.push({ id: 'jaundice', stages: ['baby'], name: '黄疸', accent: 'jaundice', sum: jaunLast ? (jaunLast.value + ' ' + (jaunLast.unit === 'umol' ? 'µmol/L' : 'mg/dL')) : '暂无', badge: '', guide: false, empty: !jaunLast });
      tiles.push({ id: 'bath', stages: ['baby'], name: '洗澡', accent: 'bath', sum: bathM ? ('本月 ' + bathM + ' 次') : '暂无', badge: '', guide: false, empty: !bathM });
      tiles.push({ id: 'swim', stages: ['baby'], name: '游泳', accent: 'swim', sum: swimM ? ('本月 ' + swimM + ' 次') : '暂无', badge: '', guide: false, empty: !swimM });
      tiles.push({ id: 'sun', stages: ['baby'], name: '日晒', accent: 'sun', sum: sunMin ? ('今日 ' + sunMin + ' 分钟') : '暂无今日', badge: '', guide: false, empty: !sunMin });
      tiles.push({ id: 'water', stages: ['baby'], name: '饮水', accent: 'water', sum: waterMl ? ('今日 ' + waterMl + ' ml') : '暂无今日', badge: '', guide: false, empty: !waterMl });
      tiles.push({ id: 'supplement', stages: ['baby'], name: '营养品', accent: 'supplement', sum: supNeed ? ('今日 ' + supDone + '/' + supNeed) : ((d.supplementPlans || []).some(function (p) { return p && p.active !== false; }) ? '今天没有安排' : '未设计划'), badge: supNeed && supDone < supNeed ? '待打卡' : '', guide: false, empty: !supNeed && !(d.supplementPlans || []).length && !(d.supplements || []).length });
      /* 第 269 次：辅食独立模块。与第 132 次六个模块同纪律：近 7 天没记过就不占首屏 */
      var solidAll = (d.feedings || []).filter(function (r) { return r && r.type === 'solid' && r.start && !isNaN(new Date(r.start).getTime()); });
      var solidToday = solidAll.filter(function (r) { return careKeyOf(r.start) === careDayNow(); }).length;
      var solidWk = solidAll.filter(function (r) { return Date.now() - new Date(r.start).getTime() < 7 * 864e5; }).length;
      tiles.push({ id: 'solid', stages: ['baby'], name: '辅食', accent: 'solid', sum: solidToday ? ('今日 ' + solidToday + ' 次') : (solidWk ? ('近 7 天 ' + solidWk + ' 次') : '暂无'), badge: '', guide: false, empty: !solidWk });

      /* 磁贴按阶段排序（对标报告 P1）：孕早期 tools 前置 / 育儿期喂养尿布前置，
         其余按固定次序殿后——同样的 14/15 个磁贴，第一眼先看到当前阶段最常用的。
         第 43 次：阶段优先取用户在引导/设置里的显式选择（App.stageOf），
         未选时才回落到客观数据（孕周可推 / 宝宝已出生）。 */
      /* 第 120 次：全部磁贴构建完后的名字/分色快照——目录弹层渲染被删组件的行时用
         （画布不画被删磁贴，但目录仍需名字与图标色；本阶段未构建出的模块不进目录） */
      var stageNow211 = (global.App && typeof App.stageOf === 'function') ? App.stageOf(d) : 'baby';
      var TILE_NAME = {}; var TILE_ACCENT = {};
      tiles.forEach(function (t) { TILE_NAME[t.id] = t.name; TILE_ACCENT[t.id] = t.accent; });

      /* 第 121 次：卡组件对象（tile-like，_card 标记）。
         自动模式（无布局无编辑）下这些对象不进渲染——卡片走上面的原位 HTML；
         布局/编辑分支把它们并入 tiles，与磁贴混排。 */
      var cardTiles = [];
      /* 第 211 次：小组件卡（喂奶/尿布/睡眠/哄睡声音）与快捷记录卡 */
      W_IDS.forEach(function (wid) {
        if (wid === 'quick' && stageNow211 === 'pregnancy' && !isDual(d)) return;
        cardTiles.push({ id: wid, _card: true, name: CARDS_META[wid].name, icon: CARDS_META[wid].icon });
      });
      ['quick-h', 'quick-s'].concat(TODAY_IDS).forEach(function (cid) {
        if (stageNow211 === 'pregnancy' && !isDual(d)) return;
        cardTiles.push({ id: cid, _card: true, name: CARDS_META[cid].name, icon: CARDS_META[cid].icon });
      });
      DATA_IDS.forEach(function (cid) {
        if (stageNow211 === 'pregnancy' && !isDual(d)) return;
        if (cid === 'w-age' && !bd) return;
        cardTiles.push({ id: cid, _card: true, name: CARDS_META[cid].name, icon: CARDS_META[cid].icon });
      });
      if (feedNextReady()) cardTiles.push({ id: 'feednext', _card: true, name: CARDS_META['feednext'].name, icon: CARDS_META['feednext'].icon });
      if (growthSparkReady()) cardTiles.push({ id: 'growthspark', _card: true, name: CARDS_META['growthspark'].name, icon: CARDS_META['growthspark'].icon });
      /* 第 122 次：直接记录组件——条件永远成立（随时可记），与 last-* 同纪律：
         不进默认画布基线，目录常驻等用户挑（否则首次编辑物化会塞两张记录卡进首页）。 */
      cardTiles.push({ id: 'rec-diaper', _card: true, name: CARDS_META['rec-diaper'].name, icon: CARDS_META['rec-diaper'].icon });
      cardTiles.push({ id: 'rec-sleep', _card: true, name: CARDS_META['rec-sleep'].name, icon: CARDS_META['rec-sleep'].icon });
      /* 第 123 次：瓶喂/亲喂/吸奶直接记录卡——同 122 次纪律（不进基线、目录常驻）。 */
      ['rec-bottle', 'rec-breast', 'rec-pump'].forEach(function (rid) {
        cardTiles.push({ id: rid, _card: true, name: CARDS_META[rid].name, icon: CARDS_META[rid].icon });
      });
      var nowMs121 = Date.now();
      LAST_DEFS_IDS.forEach(function (cid) {
        var def = LAST_DEFS[cid];
        var last = lastAny(d[def.list] || [], def.key, nowMs121);
        var meta = CARDS_META[cid];
        cardTiles.push({
          id: cid, _card: true, name: meta.name, icon: meta.icon,
          _last: last ? {
            txt: dayLabel(last, sumNow) + ' ' + hmOf(last) + ' · ' + gapText(nowMs121 - last.getTime()),
            when: dayLabel(last, sumNow) + ' ' + hmOf(last),
            gap: gapText(nowMs121 - last.getTime()).replace('距今 ', ''),
            detail: (last && d[def.list]) ? (function () {
              var key = def.key, best = null;
              (d[def.list] || []).forEach(function (r) {
                if (!r || !r[key]) return;
                var t2 = new Date(r[key]).getTime();
                if (!t2 || isNaN(t2) || t2 > nowMs121) return;
                if (!best || t2 > new Date(best[key]).getTime()) best = r;
              });
              return best ? def.detail(best) : '';
            })() : ''
          } : null
        });
      });
      /* 第 122 次：直接记录组件工厂（render 作用域闭包，与 feedNextHTML 同模式）。
         数据 shape 与 diaper.js / sleep.js 落库完全同源（同字段、同 save 流程、
         同撤销 toast（尿布 C2）/时长 toast（睡眠 C1）语义）——只把入口搬进画布，
         不新造数据、不另写一套字段。编辑模式内嵌按钮 disabled（编辑 ≠ 误记录，
         与「编辑模式 data-go 跳过」同一和解方式）。 */
      function recDiaperHTML(extraCls, badges) {
        var dayNow = careDayNow(); /* 第 131 次（P1-a）：与磁贴同口径 */
        var cnt = (d.diapers || []).filter(function (r) { return careKeyOf(r.time) === dayNow; }).length;
        var dis = editing ? ' disabled' : '';
        return '<div class="card canvas-card rc-card' + extraCls + '" data-cid="rec-diaper" data-accent="diaper"><h2 class="rc-h"><span class="rc-ico">' + icon('diaper') + '</span>记尿布</h2>'
          + '<div class="rec-keys">'
          + '<button class="quick-btn" data-reccd="pee" type="button"' + dis + '>' + icon('pee') + '尿</button>'
          + '<button class="quick-btn" data-reccd="poop" type="button"' + dis + '>' + icon('poop') + '便</button>'
          + '<button class="quick-btn" data-reccd="both" type="button"' + dis + '>' + icon('diaper') + '尿+便</button>'
          + '</div>'
          + '<p class="hint">今天已记 ' + cnt + ' 次</p>' + badges + '</div>';
      }
      function recSleepHTML(extraCls, badges) {
        var dis = editing ? ' disabled' : '';
        var os = d.openSleep;
        var html = '<div class="card canvas-card rc-card' + extraCls + '" data-cid="rec-sleep" data-accent="sleep"><h2 class="rc-h"><span class="rc-ico">' + icon('sleep') + '</span>睡眠计时</h2>';
        if (os && os.start) {
          var ms = Date.now() - new Date(os.start).getTime()
            - ((os.pausedMs || 0) + (os.pauseStart ? Date.now() - os.pauseStart : 0));
          html += '<p class="rec-running">' + Util.fmtDuration(Math.max(0, ms)) + '</p>'
            + '<div class="rec-keys"><button class="btn" data-recsl="end" type="button"' + dis + '>结束睡眠</button></div>';
        } else {
          html += '<div class="rec-keys"><button class="btn" data-recsl="start" type="button"' + dis + '>开始睡眠</button></div>'
            + '<p class="hint">在首页直接开始计时，不用先进睡眠页。</p>';
        }
        return html + badges + '</div>';
      }

      /* 第 123 次：瓶喂/亲喂/吸奶直接记录卡（render 作用域闭包）。
         数据 shape 与 feeding.js #fSave 落库逐字同源（十二字段全量写，
         不走快记捷径）；校验文案与 feeding.js 一致；步进状态存
         Modules.home._recState（会话内瞬时）。 */
      function recState(k, dflt) {
        Modules.home._recState = Modules.home._recState || {};
        if (!Modules.home._recState[k]) Modules.home._recState[k] = dflt;
        return Modules.home._recState[k];
      }
      function recBottleHTML(extraCls, badges) {
        var st = recState('bottle', { kind: 'bottle', amount: 60 });
        var dis = editing ? ' disabled' : '';
        return '<div class="card canvas-card rc-card' + extraCls + '" data-cid="rec-bottle" data-accent="feeding"><h2 class="rc-h"><span class="rc-ico">' + icon('feeding') + '</span>瓶喂</h2>'
          + '<div class="rec-seg" role="group" aria-label="奶的种类">'
          + '<button class="rec-seg-btn' + (st.kind === 'bottle' ? ' active' : '') + '" data-recbk="bottle" type="button"' + dis + '>母乳</button>'
          + '<button class="rec-seg-btn' + (st.kind === 'formula' ? ' active' : '') + '" data-recbk="formula" type="button"' + dis + '>配方奶</button>'
          + '</div>'
          + '<div class="rec-stepper">'
          + '<button class="rec-step" data-recstep="bottle:-10" type="button"' + dis + ' aria-label="减少 10 毫升">−10</button>'
          + '<b class="rec-num">' + st.amount + '<i>ml</i></b>'
          + '<button class="rec-step" data-recstep="bottle:10" type="button"' + dis + ' aria-label="增加 10 毫升">+10</button>'
          + '</div>'
          + '<div class="rec-keys"><button class="btn" data-recf="bottle" type="button"' + dis + '>记录瓶喂</button></div>'
          + badges + '</div>';
      }
      function recBreastHTML(extraCls, badges) {
        var st = recState('breast', { L: 0, R: 0 });
        var dis = editing ? ' disabled' : '';
        return '<div class="card canvas-card rc-card' + extraCls + '" data-cid="rec-breast" data-accent="feeding"><h2 class="rc-h"><span class="rc-ico">' + icon('breast') + '</span>亲喂</h2>'
          + '<div class="rec-stepper">'
          + '<button class="rec-step" data-recstep="breast.L:-1" type="button"' + dis + ' aria-label="左侧减少 1 分钟">−1</button>'
          + '<b class="rec-num">左 ' + st.L + '<i>分</i></b>'
          + '<button class="rec-step" data-recstep="breast.L:1" type="button"' + dis + ' aria-label="左侧增加 1 分钟">+1</button>'
          + '</div>'
          + '<div class="rec-stepper">'
          + '<button class="rec-step" data-recstep="breast.R:-1" type="button"' + dis + ' aria-label="右侧减少 1 分钟">−1</button>'
          + '<b class="rec-num">右 ' + st.R + '<i>分</i></b>'
          + '<button class="rec-step" data-recstep="breast.R:1" type="button"' + dis + ' aria-label="右侧增加 1 分钟">+1</button>'
          + '</div>'
          + '<div class="rec-keys"><button class="btn" data-recf="breast" type="button"' + dis + '>记录亲喂</button></div>'
          + badges + '</div>';
      }
      function recPumpHTML(extraCls, badges) {
        var st = recState('pump', { L: 0, R: 0, ml: 0 });
        var dis = editing ? ' disabled' : '';
        return '<div class="card canvas-card rc-card' + extraCls + '" data-cid="rec-pump" data-accent="feeding"><h2 class="rc-h"><span class="rc-ico">' + icon('pump') + '</span>吸奶</h2>'
          + '<div class="rec-stepper">'
          + '<button class="rec-step" data-recstep="pump.L:-1" type="button"' + dis + ' aria-label="左侧减少 1 分钟">−1</button>'
          + '<b class="rec-num">左 ' + st.L + '<i>分</i></b>'
          + '<button class="rec-step" data-recstep="pump.L:1" type="button"' + dis + ' aria-label="左侧增加 1 分钟">+1</button>'
          + '</div>'
          + '<div class="rec-stepper">'
          + '<button class="rec-step" data-recstep="pump.R:-1" type="button"' + dis + ' aria-label="右侧减少 1 分钟">−1</button>'
          + '<b class="rec-num">右 ' + st.R + '<i>分</i></b>'
          + '<button class="rec-step" data-recstep="pump.R:1" type="button"' + dis + ' aria-label="右侧增加 1 分钟">+1</button>'
          + '</div>'
          + '<div class="rec-stepper">'
          + '<button class="rec-step" data-recstep="pump.ml:-10" type="button"' + dis + ' aria-label="奶量减少 10 毫升">−10</button>'
          + '<b class="rec-num">' + st.ml + '<i>ml</i></b>'
          + '<button class="rec-step" data-recstep="pump.ml:10" type="button"' + dis + ' aria-label="奶量增加 10 毫升">+10</button>'
          + '</div>'
          + '<div class="rec-keys"><button class="btn" data-recf="pump" type="button"' + dis + '>记录吸奶</button></div>'
          + badges + '</div>';
      }

      /* 编辑角标（磁贴/卡共用同构 HTML；非编辑模式零节点） */
      var noBadges = false; /* 第 217 次：添加目录里的预览不带编辑角标 */
      function editBadges(t) {
        if (!editing || noBadges) return '';
        return '<span class="tile-del" data-del="' + t.id + '" role="button" tabindex="0" aria-label="删除 ' + t.name + ' 组件"><i class="td-minus" aria-hidden="true"></i></span>'
          + '<span class="tile-size" data-size="' + t.id + '" role="button" tabindex="0" aria-label="切换 ' + t.name + ' 大小，当前' + (t._sz === 's' ? '半宽' : '整排') + '">' + (t._sz === 's' ? '半宽' : '整排') + '</span>';
      }
      /* 第 137 次（磁贴就地记录 · P0）：带内嵌控件的磁贴。

         ⚠ 必须是 <div> 不能是 <button>：button 里不允许再嵌 button（HTML 非法），
         而且外层 button 的点击会吃掉内层控件，用户根本点不到。
         所以拆成两半——左半 .rt-open 才带 data-go（复用全页统一的 [data-go] 绑定，点它进模块页），
         右半 .rt-quick 交给模块自己的 _quickBind 绑定。两半各有明确的触摸区域，
         不存在「点了放大镜却弹出面板」这种张冠李戴。 */
      function quickTileHTML(t, quickHtml) {
        return '<div class="record-tile is-quick" data-accent="' + t.accent + '" data-quick="' + t.id + '">'
          + '<button class="rt-open" data-go="' + t.id + '" type="button" '
          + 'aria-label="打开' + Util.escapeHtml(t.name) + '">'
          + '<span class="rt-ico">' + icon(t.id) + '</span>'
          + '<span class="rt-name">' + Util.escapeHtml(t.name) + '</span>'
          + '<span class="rt-sum">' + Util.escapeHtml(t.sum) + '</span>'
          + (t.badge ? '<span class="rt-badge">' + Util.escapeHtml(t.badge) + '</span>' : '')
          + '<span class="rt-arrow" aria-hidden="true">' + icon('chevron-right') + '</span>'
          + '</button>'
          + '<div class="rt-quick">' + quickHtml + '</div>'
          + '</div>';
      }

      /* 卡组件 → HTML（画布模式专用；自动模式不经过这里）。
         占位卡（_ph：items 里有、本轮条件不满足）必须先于真卡工厂分支——
         工厂在条件不满足时返回空串，会把占位卡整个吞掉。 */
      function cardHTML(t) {
        var cls = ' canvas-card' + (t._sz === 's' ? ' sz-s' : ' sz-l');
        if (t._ph) {
          return '<div class="card' + cls + '" data-cid="' + t.id + '"><h2>' + t.name + '</h2>'
            + '<p class="hint">暂无可显示的内容，满足条件后自动出现。</p>' + editBadges(t) + '</div>';
        }
        if (W_HTML[t.id]) return W_HTML[t.id](cls, editBadges(t));
        if (t.id === 'feednext') return feedNextHTML(cls, editBadges(t));
        if (t.id === 'growthspark') return growthSparkHTML(cls, editBadges(t));
        if (t.id === 'rec-diaper') return recDiaperHTML(cls, editBadges(t));
        if (t.id === 'rec-sleep') return recSleepHTML(cls, editBadges(t));
        if (t.id === 'rec-bottle') return recBottleHTML(cls, editBadges(t));
        if (t.id === 'rec-breast') return recBreastHTML(cls, editBadges(t));
        if (t.id === 'rec-pump') return recPumpHTML(cls, editBadges(t));
        /* 第 218 次：距上次卡改为「大号间隔 + 具体时间 + 明细胶囊」，带主题色 */
        var LACC = { 'last-feeding': 'feeding', 'last-diaper': 'diaper', 'last-sleep': 'sleep', 'last-growth': 'growth', 'last-temp': 'temp' };
        var gapTxt = t._last ? (t._last.gap === '不到 1 分钟' ? '刚刚' : t._last.gap) : '';
        var body = t._last
          ? '<b class="lc-big">' + Util.escapeHtml(gapTxt) + (gapTxt === '刚刚' ? '' : '<small> 前</small>') + '</b>'
            + '<span class="lc-sub">' + Util.escapeHtml(t._last.when) + (t._last.detail ? '<span class="lc-chip">' + Util.escapeHtml(t._last.detail) + '</span>' : '') + '</span>'
          : '<span class="lc-sub lc-empty">还没有记录，记一条就能看到「多久没做了」</span>';
        return '<div class="card canvas-card lc-card' + cls + '" data-cid="' + t.id + '" data-accent="' + (LACC[t.id] || 'feeding') + '" data-go="' + t.id.replace('last-', '') + '"'
          + ' role="button" tabindex="0" aria-label="' + t.name + '">'
          + '<span class="lc-head"><span class="rc-ico">' + icon(t.icon) + '</span>' + t.name
          + '<span class="lc-arrow" aria-hidden="true">' + icon('chevron-right') + '</span></span>' + body
          + editBadges(t) + '</div>';
      }

      var stage = (global.App && typeof App.stageOf === 'function') ? App.stageOf(d)
        : ((wk !== null) ? 'pregnancy' : ((bd && ageDays !== null && ageDays >= 0) ? 'baby' : 'none'));
      /* 第 48 次（磁贴按阶段筛选）：光排序不够——用户反馈「选了身份还是全部都出现」。
         默认只显示当前阶段相关的磁贴（孕期的喂养/尿布/生长等收起，育儿期的宫缩/
         胎动/孕期/待产包收起）。两条豁免：
         ① 计时进行中的磁贴永远保留——进行中的状态不能被藏掉（C4 的本意）；
         ② 设置 · 当前阶段里可关掉筛选（tilesByStage=false），全部显示。
         阶段无法判定（'none'，仅缺 App.stageOf 的理论分支）时不过滤。 */
      /* 第 118 次（首页收敛）：记录本屏是否丢过模块——阶段筛选丢过、或收敛丢过，
         都要在网格下方挂「全部功能」入口，保证一个入口都不丢。 */
      /* 第 120 次（首页布局编辑 · 对标第五批）：手动布局接管判定。
         homeLayout 有效 → 顺序/大小/增删全部由用户布局决定（阶段筛选与收敛退位）；
         编辑模式 → 画布展示全量模块（被删的不画，目录可加回）；
         其余情况走原有自动管线（阶段筛选 + 收敛 + 截取前 8），行为逐行未动。 */
      var editing = !!Modules.home._edit;
      var ORDER = STAGE_ORDER[(stage === 'pregnancy') ? 'pregnancy' : 'baby'];
      var layout = Modules.home._layoutNormalize(d.settings.homeLayout, UNIVERSE());
      var tileDropped = false;
      if (editing) {
        var seenC = {}; var canvasIds = [];
        /* 画布基线（第 121 次）：用户布局优先；没编辑过 = 条件卡在前（对应自动模式
           里卡片在网格上方的视觉现状）+ 阶段序。注意基线只含**自动模式就在渲染的卡**
           （feednext/growthspark）——last-* 不进默认基线：它们是「可添加组件」，
           在目录里等用户挑；否则首次编辑物化会把 5 张距上次卡全塞进首页
           （画布即物化基线，第 120 次的「所见即所得」纪律）。 */
        var builtCardIds = cardTiles.filter(function (c) {
          return c.id === 'feednext' || c.id === 'growthspark';
        }).map(function (c) { return c.id; });
        /* 第 168 次（用户反馈：一点编辑首页，所有隐藏的模块都冒出来）：
           没编辑过时，画布基线 = 自动模式下首页实际显示的磁贴（阶段筛选 + 收敛后），
           其余模块留在「添加组件」目录里等用户加，不再整张铺开。 */
        var baseIds = (layout || defaultLayout(d)).items.map(function (it) { return it.id; });
        baseIds.forEach(function (id) {
          if (!seenC[id] && (!layout || layout.removed.indexOf(id) < 0)) { seenC[id] = 1; canvasIds.push(id); }
        });
        if (layout) UNIVERSE().forEach(function (id) {
          /* 卡组件只跟随 items，不殿后（第 122 次扩展到 rec 系列）：
             last / rec 都是「可添加组件」，目录常驻；条件卡不在本轮构建时
             也不进画布（零惊吓）。 */
          if (LAST_DEFS_IDS.indexOf(id) >= 0) return;
          if (CARDS_META[id]) return;
          if (!seenC[id] && (!layout || layout.removed.indexOf(id) < 0)) { seenC[id] = 1; canvasIds.push(id); }
        });
        var cmap = {};
        tiles.forEach(function (t) { cmap[t.id] = t; });
        cardTiles.forEach(function (c) { cmap[c.id] = c; });
        if (layout) {
          /* items 里有、本轮条件不满足的条件卡 → 画布渲染占位（可删可排序；
             条件满足时自动恢复真卡。last-* 总有对象，不在此列） */
          layout.items.forEach(function (it) {
            if (!cmap[it.id] && CARDS_META[it.id] && LAST_DEFS_IDS.indexOf(it.id) < 0) {
              cmap[it.id] = { id: it.id, _card: true, _ph: true, name: CARDS_META[it.id].name, icon: CARDS_META[it.id].icon };
            }
          });
        }
        tiles = canvasIds.filter(function (id) { return cmap[id]; }).map(function (id) {
          var t = cmap[id];
          var it = layout && layout.items.filter(function (x) { return x.id === id; })[0];
          t._sz = it ? it.size : defSize(id);
          return t;
        });
        if (layout && layout.removed.length) tileDropped = true;
        Modules.home._canvasIds = canvasIds;
      } else {
        /* 第 211 次：没编辑过也走同一条布局管线，用默认卡片组合（defaultLayout） */
        /* 第 125 次：非编辑态清空画布基线，避免退出编辑模式后
           _ensureLayout 误用上一次会话的陈旧 _canvasIds 作物化基线。 */
        Modules.home._canvasIds = null;
        tiles = Modules.home._layoutApply(tiles.concat(cardTiles), layout || defaultLayout(d));
        /* 第 244 次：老布局里没登记的模块会被「新模块殿后」补到末尾——
           ①已有「哄睡声音」卡时，再补一张「哄睡白噪音」磁贴就重复了；
           ②身份是爸爸时，不再自动补「妈妈情绪」（爸爸自己放进布局的照常显示）。 */
        var inItems = function (id) { return !!(layout && layout.items.some(function (x) { return x.id === id; })); };
        var hasNoiseCard = tiles.some(function (t) { return t.id === 'w-noise'; });
        var isDad = !!(cg && cg.role === 'dad');
        tiles = tiles.filter(function (t) {
          if (t.id === 'whitenoise' && hasNoiseCard && !inItems('whitenoise')) return false;
          if (t.id === 'mood' && isDad && !inItems('mood')) return false;
          return true;
        });
      }

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
        /* 第 220 次：二胎孕期时问候卡展示的是大宝，小知识也跟大宝走（孕周看「孕期」磁贴），
           避免「5 个月 5 天」下面接一句「宝宝的主要器官正在成型」 */
        if (wk !== null && !isDual(d)) {
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
         模块页日期仍用 index.html 的 #modDate 小徽标。
         第 131 次（P0-a）：问候卡 5 行收成 3 行——日期 / 身份+阶段（副标题
         并入 h1 行内 .hg-sub，单行省略）/ 小知识（星座属龙前缀保留在知识行，
         不再单独占位）。h1 仍先渲染 dateAt < h1At 的既有次序（测试锚点）。 */
      var nowD = new Date();
      var DOW = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
      /* 第 134 次（用户裁定）：撤掉问候卡左侧的 44px 头像位。
         理由：顶栏左上角已经有同一个头像按钮（.home-avatar，点它进设置/切换宝宝），
         hero 里再放一张是重复入口；而且它把「19」这个大日期往右挤了 56px，
         大数字的视觉重心被压偏。头像能力本身没减——顶栏那个还在。
         随之删除 actBaby / avaSrc 两个变量（此前只服务这一个 <img>）。 */
      /* 日期行：今天是 M月D日 周X · 节日（节日来自农历+公历+母亲/父亲节，纯本地计算） */
      var fest = (Util.festivalOf) ? Util.festivalOf(nowD) : null;
      /* 第 211 次（用户：顶部只显示日期，宝宝信息/提醒/生日压进第一张卡）：
         天空里只留「M月 星期X」+ 大号日期，右侧一个搜索圆钮；问候、阶段数字、知识句移进「今日宝宝」卡。 */
      /* 第 212 次：农历日期（设置可关）+ 真实天气（设置里联网开关，默认关） */
      var lunarNow = (d.settings.lunarDate !== false && global.Lunar && Lunar.ok) ? Lunar.of(nowD) : null;
      var wxCfg = d.settings.weather || { on: false };
      var wxNow = (wxCfg.on && global.Weather) ? Weather.cached() : null;
      var DOW_FULL = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
      html += '<section class="home-sky">'
        + '<canvas id="skyCanvas" class="sky-canvas" aria-hidden="true"></canvas>'
        + '<div class="sky-veil"></div>'
        + '<canvas id="wxCanvas" class="wx-canvas" aria-hidden="true"></canvas>'
        + '<div class="sky-cap" aria-hidden="true"></div>' /* 第 270 次：状态栏下沿接缝 */
        + '<div class="home-greet">'
        + '<div class="hg-top"><p class="hg-date"><span class="hg-m">' + (nowD.getMonth() + 1) + '月</span>' + DOW_FULL[nowD.getDay()]
        + (fest ? '<b class="hg-fest">' + Util.escapeHtml(fest) + '</b>' : '') + wxTextHTML(wxNow) + '</p>'
        + '</div>' /* 第 236 次：搜索搬进 dock */
        + '<div class="hg-row"><div class="hg-day"><b class="hg-num">' + nowD.getDate() + '</b>'
        + (lunarNow ? '<span class="hg-lunar"><i>' + Util.escapeHtml(lunarNow.gz) + '年 · ' + Util.escapeHtml(lunarNow.animal) + '</i><b>' + Util.escapeHtml(lunarNow.text) + '</b></span>' : '')
        + '</div></div>'
        + '</div>'
        + '</section>';

      /* 主体（单列） */
      html += '<div class="home-main">';

      /* ============ 第 211 次：「今日宝宝」卡（首页第一张，固定） ============
         宝宝信息、月龄、星座生肖、生日倒计时、今日提醒都压在这一张里（参考用户给的首页图）。 */
      (function () {
        var ab = (Storage.activeBaby) ? Storage.activeBaby() : null;
        var ava = (ab && ab.photo) ? '<img class="tb-photo" src="' + Util.escapeHtml(ab.photo) + '" alt="">'
          : (global.illo ? illo('avatar') : '');
        var big = '', sub = [], foot = '';
        if (ageDays !== null && ageDays >= 0) {
          var bD0 = new Date(bd + 'T00:00:00');
          var y0 = nowD.getFullYear() - bD0.getFullYear(), m0 = nowD.getMonth() - bD0.getMonth(), dd0 = nowD.getDate() - bD0.getDate();
          if (dd0 < 0) { m0 -= 1; dd0 += new Date(nowD.getFullYear(), nowD.getMonth(), 0).getDate(); }
          if (m0 < 0) { y0 -= 1; m0 += 12; }
          if (ageDays === 0) big = '今天出生';
          else if (y0 >= 1) big = y0 + ' 岁' + (m0 ? ' ' + m0 + ' 个月' : '') + (dd0 && !m0 ? ' ' + dd0 + ' 天' : '');
          else if (m0 >= 1) big = m0 + ' 个月' + (dd0 ? ' ' + dd0 + ' 天' : '');
          else big = ageDays + ' 天'; /* 第 222 次：不满月写「5 天」，与下方「出生第 6 天」不再打架 */
          sub.push(starSign(bD0.getMonth() + 1, bD0.getDate()) + '座 · 属' + zodiacAnimal(bD0.getFullYear(), bD0.getMonth() + 1, bD0.getDate()));
          foot = '出生第 ' + (ageDays + 1) + ' 天';
          /* 生日倒计时：30 天内显示；当天显示「今天生日」 */
          /* 第 212 次：选了农历生日的宝宝按农历过生日 */
          var bl = (d.settings.baby && d.settings.baby.birthLunar) || (ab && ab.birthLunar) || null;
          var t0 = new Date(nowD.getFullYear(), nowD.getMonth(), nowD.getDate());
          var nb, turn, lunarTag = '';
          var lnb = (bl && global.Lunar && Lunar.ok) ? Lunar.nextBirthday(bl, nowD) : null;
          if (lnb) {
            nb = lnb.date; turn = lnb.lunarYear - bl.y; lunarTag = '农历';
            sub.push('农历' + Lunar.monthName(bl.m, bl.leap) + Lunar.dayName(bl.d) + '生');
          } else {
            nb = new Date(nowD.getFullYear(), bD0.getMonth(), bD0.getDate());
            if (nb < t0) nb = new Date(nowD.getFullYear() + 1, bD0.getMonth(), bD0.getDate());
            turn = nb.getFullYear() - bD0.getFullYear();
          }
          var toB = Math.round((nb - t0) / 86400000);
          if (ageDays > 0 && turn >= 1 && toB === 0) foot += ' · 今天' + lunarTag + ' ' + turn + ' 岁生日';
          else if (ageDays > 0 && turn >= 1 && toB <= 30) foot += ' · ' + toB + ' 天后' + lunarTag + ' ' + turn + ' 岁生日';
        } else if (dl !== null) {
          var wk2 = pregnancyWeek(d);
          big = wk2 !== null ? ('孕 ' + wk2 + ' 周') : '孕期中';
          if (dl > 0) sub.push('距预产期 ' + dl + ' 天');
          else sub.push('已过预产期 ' + (-dl) + ' 天');
        } else {
          big = who ? ('你好，' + who) : '你好';
          sub.push('在设置里填上宝宝生日或预产期');
        }
        var babyName = (Storage.babyLabel && (ab || (d.settings.baby && d.settings.baby.nickname))) ? Storage.babyLabel(ab) : '今日宝宝';
        if (babyName === '宝宝') babyName = '今日宝宝';
        var tb = '<section class="today-baby" aria-label="今日宝宝">'
          + '<div class="tb-head"><span class="tb-ico">' + icon('calendar') + '</span><b>' + Util.escapeHtml(babyName) + '</b>'
          + '<button class="tb-today" type="button" data-tb-go="calendar">今天' + icon('chevron-right') + '</button></div>'
          + '<div class="tb-body"><div class="tb-txt">'
          + '<p class="tb-big">' + Util.escapeHtml(big) + '</p>'
          + (sub.length ? '<p class="tb-sub">' + Util.escapeHtml(sub.join(' · ')) + '</p>' : '')
          + (foot ? '<p class="tb-foot">' + Util.escapeHtml(foot) + '</p>' : '')
          + '</div><span class="tb-ava" aria-hidden="true">' + ava + '</span></div>';
        /* 今日提醒：最多两条 + 待补标签，点一行进对应模块 */
        if (global.Reminders && d.settings.remindersEnabled !== false) {
          var rems0 = Reminders.evaluate(d) || [];
          var pend0 = null, fresh0 = [];
          rems0.forEach(function (r) { if (r.pending) pend0 = r; else fresh0.push(r); });
          if (fresh0.length || pend0) {
            tb += '<ul class="tb-rems">';
            fresh0.slice(0, 2).forEach(function (r) {
              tb += '<li class="tb-rem' + ((r.remLevel || 0) >= 2 ? ' is-urgent' : '') + '" data-accent="' + r.accent + '" data-tb-go="' + r.go + '" role="button" tabindex="0">'
                + '<span class="tb-dot" aria-hidden="true"></span><span class="tb-rem-t">' + Util.escapeHtml(r.text) + '</span></li>';
            });
            if (pend0) {
              var pl0 = (pend0.items || []).map(function (x) { return x.label; }).filter(Boolean);
              tb += '<li class="tb-rem tb-pend" data-accent="' + pend0.accent + '" data-tb-go="' + pend0.go + '" role="button" tabindex="0">'
                + '<span class="tb-dot" aria-hidden="true"></span><span class="tb-rem-t">待补：' + Util.escapeHtml(pl0.length ? (pl0[0] + (pl0.length > 1 ? ' 等 ' + pl0.length + ' 项' : '')) : pend0.text) + '</span></li>';
            }
            if (fresh0.length > 2) tb += '<li class="tb-more">还有 ' + (fresh0.length - 2) + ' 条提醒</li>';
            tb += '</ul>';
          }
        }
        if (know) tb += '<p class="tb-know">' + Util.escapeHtml(know.replace(/^宝宝 [^。]*。/, '')) + '</p>';
        tb += '</section>';
        html += tb;
      })();

      /* ============ 第 146 次（P0-3 / P0-4）：首屏「此刻」条 ============
         审查结论：① 睡眠/亲喂/宫缩/洗澡计时启动后回到首页，看不出有东西在跑（计时磁贴在首屏以下）；
         ② 凌晨最常用的三件事（喂奶、换尿布、睡/醒）要滚动或点开「＋」才能记。
         这里在问候卡正下方、搜索之前放一条：先列进行中的计时（每秒走字 + 一键结束/进入），
         再给一行零表单快记（与「＋」dock 同口径写库、同款撤销）。孕期阶段不出快记行。 */
      function hnClock(ms) {
        var t = Math.floor(ms / 1000), h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), sec = t % 60;
        return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (sec < 10 ? '0' : '') + sec;
      }
      Modules.home._hnClock = hnClock;
      var runs = [];
      if (d.openSleep && d.openSleep.start) runs.push({ k: 'sleep', ico: 'sleep', label: '睡眠中', os: d.openSleep, go: 'sleep', end: '醒了' });
      if (d.feedingTimer && d.feedingTimer.start) runs.push({ k: 'feed', ico: 'feeding', label: '亲喂计时中', os: d.feedingTimer, go: 'feeding' });
      if (d.openContraction && d.openContraction.start) runs.push({ k: 'contraction', ico: 'contraction', label: '宫缩计时中', os: d.openContraction, go: 'contraction' });
      if (d.openCare && d.openCare.start) {
        var CK = { bath: ['洗澡中', 'bath'], swim: ['游泳中', 'swim'], sun: ['日晒中', 'sun'] }[d.openCare.kind];
        if (CK) runs.push({ k: 'care', ico: CK[1], label: CK[0], os: d.openCare, go: CK[1] });
      }
      var nowStage = (global.App && typeof App.stageOf === 'function') ? App.stageOf(d) : 'baby';
      var showQuick = nowStage !== 'pregnancy' || isDual(d); /* 第 220 次：二胎孕期照样要给大宝快记 */
      /* 第 236 次：进行中的计时改由 dock 上方的「正在进行」胶囊统一显示（dock-live.js），首页不再重复一条 */
      void runs;
      /* 第 118 次（首页搜索入口）：放在 .home-main 最前面、紧贴问候卡下方——
         理由：① 搜索是跨模块的全局动作，语义上属于「页头」，应在所有卡片之前，
         用户进首页第一眼就能看到；② 它带 data-go="search"，会被下方统一的
         [data-go] 点击绑定接管（这段 HTML 在绑定之前就写进了 innerHTML）；
         ③ 放在 .record-grid 之前，不会挤进「模块记录」网格、也不干扰网格用例。
         icon('search') 由主理人在 icons.js 新增；未定义时 icon() 返回空串，不崩。 */


      /* 第 133 次 Phase 2（对齐 Cali · 上次 X 双列卡）：
         Cali 首页在日期下方是「上次喂奶 | 上次尿布」两列小卡——一个值 + 一句相对时间，
         回答的是「现在要不要再来一次」。我们原来只有磁贴右侧那句
         「最近 08:30 · 今日 2 次」，扫读成本高，且被其他模块挤在后面。
         这里只读不写；两类都没记录时整块不渲染（不摆空壳，延续第 118 次冷启动保护）。 */
      var lf = Util.babyFeeds(d.feedings).filter(function (r) { return r && r.start; })
        .sort(function (a, b) { return new Date(b.start) - new Date(a.start); })[0];
      var ld = (d.diapers || []).filter(function (r) { return r && r.time; })
        .sort(function (a, b) { return new Date(b.time) - new Date(a.time); })[0];
      /* 第 210 次（首页视觉化 · 对标用户给的参考图）：「上次 X」两列小卡升级为一组彩色小组件——
         喂奶 / 尿布 / 睡眠 + 哄睡声音插画卡，2×2 排布；每块：图标胶囊 + 标题 + ›、一个大值、底部相对时间。
         只读不写，点击进对应模块（data-go 走统一绑定）。 */
      var lsl = (d.sleeps || []).filter(function (r) { return r && r.start && r.end; })
        .sort(function (a, b) { return new Date(b.end) - new Date(a.end); })[0];
      var W_HTML = {};
      {
        var nowMs2 = sumNow.getTime();
        /* 卡里只需要「2 小时前」这种短说法：gapText 的「距今 X」前缀在
           「上次喂奶」标题下是重复信息，这里剥掉；不足 1 分钟说「刚刚」。 */
        function gapShort(ms) {
          var g = gapText(ms);
          return (g === '不到 1 分钟') ? '刚刚' : g.replace('距今 ', '') + '前';
        }
        var FT = { breast: '母乳', bottle: '奶瓶', formula: '奶粉', pump: '泵奶', solid: '辅食' };
        var DT = { pee: '尿', poop: '便', both: '尿+便' };
        var feedVal = '—', feedGap = '';
        if (lf) {
          feedVal = FT[lf.type] || '喂养';
          var amt = (lf.type === 'bottle' || lf.type === 'formula' || lf.type === 'pump')
            ? (lf.amountFm || lf.amount) : null;
          if (amt) {
            feedVal += ' · ' + amt + ' ml';
          } else if (lf.type === 'breast') {
            /* 第 210 次：小组件里只放总时长，左右分开写会被截断 */
            var bt = lf.durationMin || ((lf.durationL || 0) + (lf.durationR || 0));
            if (bt) feedVal += ' · ' + bt + ' 分钟';
          }
          feedGap = gapShort(Math.max(0, nowMs2 - new Date(lf.start).getTime()));
        }
        var diaVal = ld ? (DT[ld.type] || '换尿布') : '—';
        var diaGap = ld ? gapShort(Math.max(0, nowMs2 - new Date(ld.time).getTime())) : '';
        var slVal = '—', slGap = '';
        if (lsl) {
          var slMin = Math.max(0, Math.round((new Date(lsl.end) - new Date(lsl.start) - (lsl.pausedMs || 0)) / 60000));
          slVal = slMin >= 60 ? (Math.floor(slMin / 60) + ' 小时' + (slMin % 60 ? ' ' + (slMin % 60) + ' 分' : '')) : (slMin ? slMin + ' 分钟' : '不到 1 分钟'); /* 第 272 次：老数据里的 0 分钟不写「0 分钟」 */
          slGap = '醒来 ' + gapShort(Math.max(0, nowMs2 - new Date(lsl.end).getTime()));
        }
        if (d.openSleep && d.openSleep.start) { slVal = '睡眠中'; slGap = '进行中'; }
        function hw(cid, acc, go, ic, label, val, gap, cls, bd2) {
          return '<button class="hl2 hw canvas-card' + (cls || '') + '" data-cid="' + cid + '" data-accent="' + acc + '" data-go="' + go + '" type="button">'
            + '<span class="hl2-head"><span class="hw-ico">' + icon(ic) + '</span>' + label
            + '<span class="hw-arrow" aria-hidden="true">' + icon('chevron-right') + '</span></span>'
            + '<b class="hl2-val">' + Util.escapeHtml(val) + '</b>'
            + '<span class="hl2-gap">' + Util.escapeHtml(gap || '还没有记录') + '</span>'
            + (bd2 || '') + '</button>';
        }
        var wnS = d.whitenoise || {};
        var WN_N = { pink: '粉红噪音', white: '白噪音', brown: '棕色噪音', shush: '嘘声', ocean: '海浪声', heart: '心跳声', fan: '风扇声', rain: '雨声', dryer: '吹风机' };
        var wnType = WN_N[wnS.type] ? wnS.type : 'pink';
        var wnRem = (Modules.whitenoise && Modules.whitenoise._remainingMin) ? Modules.whitenoise._remainingMin() : null;
        var wnSub = wnS.playing ? ('播放中' + (wnRem != null ? ' · 还剩 ' + wnRem + ' 分钟' : '')) : wnS.paused ? '已暂停' : '轻点挑一个声音';
        W_HTML['w-feed'] = function (cls, bd2) { return hw('w-feed', 'feeding', 'feeding', 'feeding', '上次喂奶', feedVal, feedGap, cls, bd2); };
        W_HTML['w-diaper'] = function (cls, bd2) { return hw('w-diaper', 'diaper', 'diaper', 'diaper', '上次尿布', diaVal, diaGap, cls, bd2); };
        W_HTML['w-sleep'] = function (cls, bd2) { return hw('w-sleep', 'sleep', 'sleep', 'sleep', '上次睡眠', slVal, slGap, cls, bd2); };
        /* 第 244 次：哄睡声音卡去掉深色插画底，和「上次喂奶 / 尿布 / 睡眠」同一款浅色卡（用户：格格不入） */
        W_HTML['w-noise'] = function (cls, bd2) { return '<button class="hl2 hw hw-wn2 canvas-card' + (cls || '') + (wnS.playing ? ' is-on' : '') + '" data-cid="w-noise" data-accent="whitenoise" data-go="whitenoise" type="button">'
          + '<span class="hl2-head"><span class="hw-ico">' + icon('whitenoise') + '</span>哄睡声音'
          + '<span class="hw-arrow" aria-hidden="true">' + icon('chevron-right') + '</span></span>'
          + '<b class="hl2-val">' + WN_N[wnType] + '</b>'
          + '<span class="hl2-gap">' + wnSub + '</span>'
          + (bd2 || '') + '</button>'; };
        /* ── 第 245 次：「今日」小卡（喂奶 / 尿布 / 睡眠 / 体温），同款浅色卡 ── */
        var tFeeds = (d.feedings || []).filter(function (r) { return r && r.start && careKeyOf(r.start) === dayNow; });
                var tMin = tFeeds.reduce(function (s, r) { return s + (r.type === 'breast' ? (Number(r.durationMin) || ((Number(r.durationL) || 0) + (Number(r.durationR) || 0))) : 0); }, 0);
        var tMl = tFeeds.reduce(function (s, r) { return s + (r.type === 'breast' ? 0 : (Number(r.amountFm || r.amount) || 0)); }, 0);
        W_HTML['w-feed-today'] = function (cls, bd2) {
          return hw('w-feed-today', 'feeding', 'feeding', 'feeding', '今日喂奶', tFeeds.length ? (tFeeds.length + ' 次') : '0 次',
            tFeeds.length ? ([tMl ? ('共 ' + tMl + ' ml') : '', tMin ? ('亲喂 ' + tMin + ' 分钟') : ''].filter(Boolean).join(' · ') || '今天') : '今天还没喂', cls, bd2);
        };
        var tDia = (d.diapers || []).filter(function (r) { return r && r.time && careKeyOf(r.time) === dayNow; });
        var tPee = tDia.filter(function (r) { return r.type === 'pee' || r.type === 'both'; }).length;
        var tPoo = tDia.filter(function (r) { return r.type === 'poop' || r.type === 'both'; }).length;
        W_HTML['w-diaper-today'] = function (cls, bd2) {
          return hw('w-diaper-today', 'diaper', 'diaper', 'diaper', '今日尿布', tDia.length + ' 片', '尿 ' + tPee + ' · 便 ' + tPoo, cls, bd2);
        };
        /* 第 274 次（审计 #23）：今日睡眠按照护日切开跨夜的觉、扣暂停（Util.daySleep，与睡眠页摘要同口径） */
        var tSlAgg = Util.daySleep(d.sleeps, dayNow, careDS());
        var tSl = { length: tSlAgg.n };
        var tSlMin = Math.round(tSlAgg.min);
        W_HTML['w-sleep-today'] = function (cls, bd2) {
          var v = tSlMin ? (Math.floor(tSlMin / 60) ? Math.floor(tSlMin / 60) + ' 小时 ' : '') + (tSlMin % 60) + ' 分' : '0 分';
          return hw('w-sleep-today', 'sleep', 'sleep', 'sleep', '今日睡眠', v, tSl.length ? ('醒来 ' + tSl.length + ' 次' + (d.openSleep ? ' · 正在睡' : '')) : (d.openSleep ? '正在睡' : '今天还没睡'), cls, bd2);
        };
        var lTemp = (d.temps || []).filter(function (r) { return r && r.time && r.value != null; })
          .sort(function (a, b) { return new Date(b.time) - new Date(a.time); })[0];
        W_HTML['w-temp'] = function (cls, bd2) {
          return hw('w-temp', 'temp', 'temp', 'temp', '最近体温', lTemp ? (lTemp.value + ' °C') : '—',
            lTemp ? (Util.fmtAgo ? Util.fmtAgo(lTemp.time) : '') : '还没有记录', cls, bd2);
        };
      }
      /* ── 第 217 次：数据卡（今日概览 / 近 7 天奶量 / 近 7 天睡眠 / 成长天数） ── */
      (function () {
        var DAY = 86400000;
        var t0 = new Date(sumNow.getFullYear(), sumNow.getMonth(), sumNow.getDate()).getTime();
        function dayIdx(ms) { return Math.floor((ms - t0) / DAY); } /* 0 = 今天，-1 = 昨天 */
        function feedMl(f) {
          if (f.type !== 'bottle' && f.type !== 'formula') return 0;
          var v = parseFloat(f.amountFm || f.amount); return isNaN(v) ? 0 : v;
        }
        function sleepMin(sl, from, to) { /* 与 [from,to) 重叠的分钟数 */
          var a = new Date(sl.start).getTime(), b = sl.end ? new Date(sl.end).getTime() : Date.now();
          if (isNaN(a) || isNaN(b) || b <= a) return 0;
          var ov = Math.min(b, to) - Math.max(a, from);
          if (ov <= 0) return 0;
          var whole = b - a, pz = sl.pausedMs || 0;
          return Math.max(0, ov * (1 - Math.min(1, pz / whole))) / 60000;
        }
        function hm(min) {
          min = Math.round(min);
          if (min < 60) return min + ' 分钟';
          return Math.floor(min / 60) + ' 小时' + (min % 60 ? ' ' + (min % 60) + ' 分' : '');
        }
        var feeds = (d.feedings || []).filter(function (f) { return f && f.start; });
        var dias = (d.diapers || []).filter(function (x) { return x && x.time; });
        var sls = (d.sleeps || []).filter(function (x) { return x && x.start; });
        if (d.openSleep && d.openSleep.start) sls = sls.concat([{ start: d.openSleep.start, end: null, pausedMs: d.openSleep.pausedMs || 0 }]);
        /* 今日 */
        var tf = feeds.filter(function (f) { return dayIdx(new Date(f.start).getTime()) === 0; });
        var tfMl = tf.reduce(function (s2, f) { return s2 + feedMl(f); }, 0);
        var td = dias.filter(function (x) { return dayIdx(new Date(x.time).getTime()) === 0; });
        var tdPoop = td.filter(function (x) { return x.type === 'poop' || x.type === 'both'; }).length;
        /* 第 274 次（审计 #23）：今日概览的睡眠也走照护日窗口（Util.daySleep，含正在睡的这一觉，格子下写「睡眠中」） */
        var tsMin = Util.daySleep(d.sleeps, careKeyOf(sumNow), careDS(), { live: d.openSleep }).min;
        W_HTML['w-today'] = function (cls, bd2) {
          function cell(acc, go, ic, lbl, big, sub) {
            return '<div class="wt-cell" data-accent="' + acc + '"><span class="wt-lbl">' + icon(ic) + lbl + '</span>'
              + '<b class="wt-big">' + big + '</b><span class="wt-sub">' + sub + '</span></div>';
          }
          return '<div class="card canvas-card wd-card wd-today' + cls + '" data-cid="w-today" data-go="calendar" role="button" tabindex="0" aria-label="今日概览">'
            + '<div class="wd-head"><h2>今日概览</h2><span class="wd-meta">' + (sumNow.getMonth() + 1) + ' 月 ' + sumNow.getDate() + ' 日</span></div>'
            + '<div class="wt-row">'
            + cell('feeding', 'feeding', 'feeding', '喂奶', tf.length + '<small> 次</small>', tfMl ? tfMl + ' ml' : '—')
            + cell('diaper', 'diaper', 'diaper', '尿布', td.length + '<small> 次</small>', tdPoop ? '便 ' + tdPoop + ' 次' : '—')
            + cell('sleep', 'sleep', 'sleep', '睡眠', tsMin >= 60 ? (Math.floor(tsMin / 60) + '<small> 时</small>' + (Math.round(tsMin % 60) ? ' ' + Math.round(tsMin % 60) + '<small> 分</small>' : '')) : Math.round(tsMin) + '<small> 分</small>', d.openSleep && d.openSleep.start ? '睡眠中' : (tsMin ? '已睡' : '—'))
            + '</div>' + (bd2 || '') + '</div>';
        };
        /* 近 7 天柱状 */
        var WD = ['日', '一', '二', '三', '四', '五', '六'];
        function bars(id, acc, go, title, vals, fmtV, unitAvg) {
          var max = Math.max.apply(null, vals.concat([1]));
          var has = vals.filter(function (v) { return v > 0; });
          var avg = has.length ? has.reduce(function (a, b) { return a + b; }, 0) / has.length : 0;
          var h = '<div class="wk-bars">';
          vals.forEach(function (v, i) {
            var dt = new Date(t0 - (6 - i) * DAY);
            h += '<div class="wk-col' + (i === 6 ? ' is-today' : '') + '"><span class="wk-v">' + (v ? fmtV(v) : '') + '</span>'
              + '<span class="wk-bar"><i style="height:' + (v ? Math.max(6, Math.round(v / max * 100)) : 0) + '%"></i></span>'
              + '<span class="wk-d">' + (i === 6 ? '今' : WD[dt.getDay()]) + '</span></div>';
          });
          h += '</div>';
          return function (cls, bd2) {
            return '<div class="card canvas-card wd-card wd-week' + cls + '" data-cid="' + id + '" data-accent="' + acc + '" data-go="' + go + '" role="button" tabindex="0" aria-label="' + title + '">'
              + '<div class="wd-head"><h2>' + title + '</h2><span class="wd-meta">' + (avg ? '日均 ' + unitAvg(avg) : '还没有记录') + '</span></div>'
              + h + (bd2 || '') + '</div>';
          };
        }
        var fv = [], sv = [];
        for (var i = 6; i >= 0; i--) {
          var a = t0 - i * DAY;
          fv.push(feeds.reduce(function (s2, f) { return s2 + (dayIdx(new Date(f.start).getTime()) === -i ? feedMl(f) : 0); }, 0));
          sv.push(sls.reduce(function (s2, x) { return s2 + sleepMin(x, a, a + DAY); }, 0));
        }
        W_HTML['w-week-feed'] = bars('w-week-feed', 'feeding', 'feeding', '近 7 天奶量', fv,
          function (v) { return Math.round(v); }, function (v) { return Math.round(v) + ' ml'; });
        W_HTML['w-week-sleep'] = bars('w-week-sleep', 'sleep', 'sleep', '近 7 天睡眠', sv,
          function (v) { var h = v / 60; return (Math.abs(h - Math.round(h)) < 0.05 ? Math.round(h) : h.toFixed(1)) + 'h'; }, function (v) { return hm(v); });
        /* 成长天数：第 N 天 + 下一个里程碑（满月 / 百天 / 满 N 个月 / 周岁）进度 */
        if (bd) {
          var bdD = new Date(bd + 'T00:00:00');
          var age = Math.floor((t0 - bdD.getTime()) / DAY) + 1;
          var ms = [];
          for (var mo = 1; mo <= 36; mo++) {
            var md = new Date(bdD.getFullYear(), bdD.getMonth() + mo, bdD.getDate());
            ms.push({ t: md.getTime(), name: mo === 1 ? '满月' : (mo % 12 === 0 ? (mo / 12 === 1 ? '周岁' : mo / 12 + ' 周岁') : '满 ' + mo + ' 个月') });
          }
          ms.push({ t: bdD.getTime() + 99 * DAY, name: '百天' });
          ms.sort(function (x, y) { return x.t - y.t; });
          var nx = ms.filter(function (x) { return x.t >= t0; })[0];
          var pv = ms.filter(function (x) { return x.t < t0; }).pop();
          var fromT = pv ? pv.t : bdD.getTime();
          var pct = nx ? Math.max(3, Math.min(100, Math.round((t0 - fromT) / (nx.t - fromT) * 100))) : 100;
          var left = nx ? Math.round((nx.t - t0) / DAY) : 0;
          W_HTML['w-age'] = function (cls, bd2) {
            return '<div class="card canvas-card wd-card wd-age' + cls + '" data-cid="w-age" data-accent="growth" data-go="growth" role="button" tabindex="0" aria-label="成长天数">'
              + '<span class="wa-lbl">' + icon('growth') + '来到世界</span>'
              + '<b class="wa-big">' + age + '<small> 天</small></b>'
              + (nx ? '<span class="wa-next">' + (left === 0 ? '今天' + nx.name + ' 🎉' : '距' + nx.name + '还有 ' + left + ' 天') + '</span>'
                + '<span class="wa-prog"><i style="width:' + pct + '%"></i></span>' : '')
              + (bd2 || '') + '</div>';
          };
        }
      })();
      if (showQuick) {
        W_HTML['quick'] = function (cls, bd2) {
          var h2 = '';
          var fedQ = (global.App && App._fedDefaults) ? App._fedDefaults() : null;
          h2 += '<div class="hn-quick" role="group" aria-label="快速记录">'
            + (fedQ ? '<button type="button" class="hn-q"' + (editing ? ' disabled' : '') + ' data-hnq="feed" data-accent="feeding">' + icon('feeding') + '<span>喂奶</span></button>' : '')
            + '<button type="button" class="hn-q"' + (editing ? ' disabled' : '') + ' data-hnq="pee" data-accent="diaper">' + icon('pee') + '<span>尿了</span></button>'
            + '<button type="button" class="hn-q"' + (editing ? ' disabled' : '') + ' data-hnq="poop" data-accent="diaper">' + icon('poop') + '<span>拉了</span></button>'
            /* 睡眠进行中时「醒了」已在上方计时条里，快记行不再重复 */
            + ((d.openSleep || (Modules.home._qTarget === 'all' && (d.babies || []).length >= 2)) ? '' /* 第 222 次：睡眠计时只对当前宝宝，「都记」时不显示 */
              : '<button type="button" class="hn-q"' + (editing ? ' disabled' : '') + ' data-recsl="start" data-accent="sleep">' + icon('sleep') + '<span>睡了</span></button>')
            + '</div>';
          if (fedQ) h2 += '<p class="hn-hint">喂奶按上次：' + Util.escapeHtml(fedQ.label) + '</p>';
          /* 第 222 次：两个及以上宝宝时可选「记给谁」——当前宝宝 / 全部（双胞胎一次记两份） */
          var kids = (d.babies || []);
          if (kids.length >= 2 && !editing) {
            var tgt = Modules.home._qTarget === 'all' ? 'all' : 'one';
            var curName = (d.settings.baby && (d.settings.baby.nickname || d.settings.baby.name)) || '当前宝宝';
            h2 += '<div class="hn-tgt" role="radiogroup" aria-label="记给谁"><span>记给</span>'
              + '<button type="button" role="radio" aria-checked="' + (tgt === 'one') + '" class="hn-tgt-b' + (tgt === 'one' ? ' on' : '') + '" data-qtgt="one">' + Util.escapeHtml(curName) + '</button>'
              + '<button type="button" role="radio" aria-checked="' + (tgt === 'all') + '" class="hn-tgt-b' + (tgt === 'all' ? ' on' : '') + '" data-qtgt="all">' + (kids.length === 2 ? '两个都记' : kids.length + ' 个都记') + '</button></div>';
          }
          return '<div class="card canvas-card hn-quick-card' + (cls || '') + '" data-cid="quick">' + h2 + (bd2 || '') + '</div>';
        };
        /* 第 245 次：快捷记录的横条 / 小卡两种尺寸——同一套 data-hnq / data-recsl 绑定，记法完全一致 */
        var qBtns = function (short) {
          var fq = (global.App && App._fedDefaults) ? App._fedDefaults() : null;
          var dis = editing ? ' disabled' : '';
          var arr = [];
          if (fq) arr.push('<button type="button" class="hq-b"' + dis + ' data-hnq="feed" data-accent="feeding" aria-label="喂奶：' + Util.escapeHtml(fq.label) + '"><i>' + icon('feeding') + '</i><span>喂奶</span></button>');
          arr.push('<button type="button" class="hq-b"' + dis + ' data-hnq="pee" data-accent="diaper"><i>' + icon('pee') + '</i><span>尿了</span></button>');
          arr.push('<button type="button" class="hq-b"' + dis + ' data-hnq="poop" data-accent="diaper"><i>' + icon('poop') + '</i><span>拉了</span></button>');
          if (!d.openSleep) arr.push('<button type="button" class="hq-b"' + dis + ' data-recsl="start" data-accent="sleep"><i>' + icon('sleep') + '</i><span>睡了</span></button>');
          return arr.join('');
        };
        W_HTML['quick-h'] = function (cls, bd2) {
          return '<div class="card canvas-card hq-card hq-h' + (cls || '') + '" data-cid="quick-h" role="group" aria-label="快速记录">' + qBtns() + (bd2 || '') + '</div>';
        };
        W_HTML['quick-s'] = function (cls, bd2) {
          return '<div class="card canvas-card hq-card hq-s' + (cls || '') + '" data-cid="quick-s" role="group" aria-label="快速记录">'
            + '<span class="hq-title">' + icon('plus') + '快速记录</span><div class="hq-grid">' + qBtns() + '</div>' + (bd2 || '') + '</div>';
        };
      }
      /* 第 91 次：底边过渡带已删除——融合改由画布自身淡出为透明完成
         （sky.js fadeBottomOut），交界处即页面真实背景，日夜零横带。 */

      /* 本地提醒卡：基于「当前时间 × 已有数据」的温和注意（喂养间隔/计时进行中/经期临近/待产包/备份）。
         有提醒才渲染，无提醒不占位。
         U-04：可在设置里完全关闭；关掉后所有记录、导出、回顾功能照旧，无任何损失。
         页面内提醒不是系统推送——无网络、无 Service Worker，本地工具发不出推送，
         所以这里的开关属于「用户的注意力由用户决定」，不做任何诱导。 */
      /* 第 211 次：提醒并入「今日宝宝」卡（见 home-main 开头），这里不再单独成区。 */

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
         过点不催——「按需喂养就好」（U-25）。只在育儿阶段出现。
         第 121 次：抽成 HTML 工厂——自动模式在原位调用（extraCls/badges 缺省，
         输出与改前逐字节一致），布局/编辑模式以卡组件身份在网格循环里调用。 */
      function feedNextHTML(extraCls, badges) {
        if (!(bd && ageDays !== null && ageDays >= 0 && ageDays <= 730)) return '';
        var feedWin = d.feedings.filter(function (r) { return r.start && r.type !== 'pump' && (Date.now() - new Date(r.start).getTime()) < 48 * 3600000; })
          .sort(function (a, b) { return new Date(a.start) - new Date(b.start); });
        if (feedWin.length >= 2) {
          var gapsSum = 0;
          for (var g = 1; g < feedWin.length; g++) gapsSum += (new Date(feedWin[g].start) - new Date(feedWin[g - 1].start));
          var avgGap = gapsSum / (feedWin.length - 1);
          var nextMs = new Date(feedWin[feedWin.length - 1].start).getTime() + avgGap;
          var diffMin = Math.round((nextMs - Date.now()) / 60000);
          var nd = new Date(Math.max(nextMs, Date.now()));
          var hhmm = (nd.getHours() < 10 ? '0' : '') + nd.getHours() + ':' + (nd.getMinutes() < 10 ? '0' : '') + nd.getMinutes();
          /* 第 218 次：大号预计时间 + 倒计时 + 节奏进度条 */
          var lastMs = new Date(feedWin[feedWin.length - 1].start).getTime();
          var pctN = Math.max(4, Math.min(100, Math.round((Date.now() - lastMs) / avgGap * 100)));
          var gapH = Math.floor(avgGap / 3600000), gapM = Math.round((avgGap % 3600000) / 60000);
          var gapStr = (gapH ? gapH + ' 小时' : '') + (gapM ? ' ' + gapM + ' 分' : '');
          var leftStr = diffMin >= 60 ? ('还有约 ' + Math.floor(diffMin / 60) + ' 小时' + (diffMin % 60 ? ' ' + (diffMin % 60) + ' 分' : ''))
            : diffMin >= 0 ? ('还有约 ' + diffMin + ' 分钟') : ('已过预计 ' + (-diffMin) + ' 分钟');
          return '<div class="card feed-next fn-card' + (extraCls || '') + '" data-cid="feednext" data-accent="feeding">'
            + '<span class="lc-head"><span class="rc-ico">' + icon('bottle') + '</span>下次喂奶参考</span>'
            + '<div class="fn-main"><b class="lc-big">' + (diffMin >= 0 ? hhmm : '按需') + '</b>'
            + '<span class="fn-left' + (diffMin < 0 ? ' is-over' : '') + '">' + leftStr + '</span></div>'
            + '<span class="fn-prog"><i style="width:' + pctN + '%"></i></span>'
            + '<span class="lc-sub">最近 ' + feedWin.length + ' 次平均间隔 ' + gapStr.trim() + (diffMin < 0 ? '，按需喂养就好' : '') + ' · 仅供参考</span>'
            + (badges || '') + '</div>';
        }
        return '';
      }
      /* 条件满足判定（供 cardTiles 构建；与工厂同一口径，双遍历成本可忽略） */
      function feedNextReady() {
        if (!(bd && ageDays !== null && ageDays >= 0 && ageDays <= 730)) return false;
        var n = 0;
        Util.babyFeeds(d.feedings).forEach(function (r) {
          if (r.start && (Date.now() - new Date(r.start).getTime()) < 48 * 3600000) n++;
        });
        return n >= 2;
      }
      function growthSparkReady() {
        if (!bd) return false;
        var wN = 0, hN = 0;
        (d.growth || []).forEach(function (r) {
          if (r.date) { if (r.weightKg != null) wN++; if (r.heightCm != null) hN++; }
        });
        return wN >= 2 || hN >= 2;
      }

      /* 生长速览卡（对标报告 P2 sparkline）：有生日 + ≥2 次测量时，给体重/身高的最新值与迷你趋势
         第 121 次：同 feedNextHTML 抽成工厂（自动模式逐字节等价，画布模式带画布类）。 */
      function growthSparkHTML(extraCls, badges) {
        var growthAll = (d.growth || []).filter(function (r) { return r.date; })
          .sort(function (a, b) { return new Date(a.date) - new Date(b.date); });
        var wPts = growthAll.filter(function (r) { return r.weightKg != null; });
        var hPts = growthAll.filter(function (r) { return r.heightCm != null; });
        if (!(bd && (wPts.length >= 2 || hPts.length >= 2))) return '';
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
        /* 第 210 次：两格改成可点的绿色小组件，去掉说明句（点进生长页看曲线） */
        var inner = '<h2>生长速览</h2><div class="gs-row">';
        if (wPts.length >= 2) {
          inner += '<div class="gs-cell" data-accent="growth" data-gs-go="growth" role="button" tabindex="0"><span class="gs-lbl">' + icon('growth') + '体重</span>'
            + '<span class="gs-val">' + wPts[wPts.length - 1].weightKg + ' kg</span>'
            + spark(wPts.map(function (r) { return r.weightKg; })) + '</div>';
        }
        if (hPts.length >= 2) {
          inner += '<div class="gs-cell" data-accent="growth" data-gs-go="growth" role="button" tabindex="0"><span class="gs-lbl">' + icon('growth') + '身长</span>'
            + '<span class="gs-val">' + hPts[hPts.length - 1].heightCm + ' cm</span>'
            + spark(hPts.map(function (r) { return r.heightCm; })) + '</div>';
        }
        inner += '</div>';
        return '<div class="card gs-card' + (extraCls || '') + '" data-cid="growthspark">' + inner + (badges || '') + '</div>';
      }

      /* 模块记录（第 56 次：单条信息行；第 57 次随用户反馈改左右结构）——
         每行：icon + 名称（左）+ 记录信息（右）+ 今日角标 + ›。
         名称与信息同一行左右分布，不再上下两行堆叠。 */
      /* 第 120 次：段头挂「编辑首页」入口（对标 Cali 顶栏 +/✓，收敛为段头文字钮——
         不动顶栏与天空，回归风险最小）。编辑中变为「完成」。 */
      /* 第 211 次（用户：全部功能和模块横条挪到设置里自由选择）：
         去掉「模块记录」段头与「全部功能」入口；首页只剩用户挑的卡片，
         增删在 设置 · 首页卡片，或网格下方「编辑首页」里直接删 / 拖动。 */
      html += '<div class="record-grid is-custom' + (editing ? ' is-editing' : '') + '">';
      var quickTiles = [];   /* 第 137 次：本页要绑定的就地记录磁贴（id 列表） */
      tiles.forEach(function (t) {
        /* 第 121 次：卡组件与磁贴混排（画布模式）；自动模式 tiles 里没有卡对象 */
        if (t._card) { html += cardHTML(t); return; }
        /* 第 137 次（磁贴就地记录 · P0）：模块暴露 _quickHTML 时，磁贴内嵌记录控件，
           点一下即落库、带撤销——不必再进模块页走一遍表单。
           仅自动模式生效：布局编辑/画布模式下磁贴要能被拖动改大小，内嵌控件会抢触摸，
           所以那两种模式仍渲染普通磁贴（功能不丢，只是没有就地记录）。 */
        var qmod = (editing || t._sz === 's') ? null : (global.Modules[t.id] || null);
        if (qmod && typeof qmod._quickHTML === 'function' && typeof qmod._quickBind === 'function') {
          /* 第 196 次：模块可返回空串表示「此刻没有可就地操作的」（如补剂没计划），回落普通磁贴 */
          var qh = qmod._quickHTML(d);
          if (qh) {
            html += quickTileHTML(t, qh);
            quickTiles.push(t.id);
            return;
          }
        }
        html += '<button class="record-tile' + (t._sz === 's' ? ' sz-s' : ' sz-l') + '" data-accent="' + t.accent + '" data-go="' + t.id + '" type="button">'
          + '<span class="rt-ico">' + icon(t.id) + '</span>'
          + '<span class="rt-name">' + t.name + '</span>'
          + '<span class="rt-sum">' + t.sum + '</span>'
          + (t.badge ? '<span class="rt-badge">' + t.badge + '</span>' : '')
          /* 第 58 次：› 文本字符换成项目统一的线性 SVG（chevron-right） */
          + '<span class="rt-arrow" aria-hidden="true">' + icon('chevron-right') + '</span>'
          /* 第 120 次：编辑角标——删除与大小切换（文本钮而非拖拽把手：
             触摸拖拽改大小在 iOS 上是第 116/117 批级别的踩坑区，按钮一等公民更稳）。
             第 121 次：抽为 editBadges()，磁贴与卡组件共用同构 HTML。 */
          + editBadges(t)
          + '</button>';
      });
      html += '</div>';
      if (editing) html += '<p class="home-edit-tip">按住卡片拖动排序，点「－」删除，点大小切换半宽 / 整排</p>';
      html += '<div class="home-edit-row">'
        + (editing ? '<button class="home-edit-btn" id="homeSheetOpen" type="button">' + icon('plus') + '添加卡片</button>' : '')
        + '<button class="home-edit-btn" id="homeEdit" type="button">'
        + (editing ? icon('check') + '完成' : icon('edit') + '编辑首页') + '</button></div>';


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

      /* 第 142 次（用户反馈：备份提醒别放首页）：原来的底部备份状态行整条撤下，
         备份相关的信息与入口统一收敛到「设置 · 数据与备份」——
         首页是「今天要做什么」的地方，备份是「以防万一」的事，不属于首屏。
         提醒卡里的 ruleBackup 也一并从 RULES 移除，否则只是换个位置继续催。 */
      html += '</div>'; /* /.home-main */

      /* 第 120 次：添加组件目录（对标 Cali「添加组件」弹层，采纳减配——
         双尺寸预览页不做，目录行直接加，加完在画布上切大小）。
         可加 = 宇宙里不在画布上的 id（被删组件 + 本阶段没建出的模块）。
         名字取自本轮已构建磁贴（TILE_NAME），构建条件未满足的模块不出现——
         目录如实反映「现在能加什么」。 */
      if (editing && Modules.home._sheet) {
        var inCanvas = {};
        (Modules.home._canvasIds || []).forEach(function (id) { inCanvas[id] = 1; });
        html += '<div class="home-sheet" id="homeSheet" role="dialog" aria-label="添加组件"><div class="home-sheet-panel">'
          + '<div class="hs-head"><b>添加组件</b>'
          + '<button class="home-edit-btn" id="homeSheetClose" type="button">' + icon('check') + '完成</button></div>'
          + '<input class="sheet-search" id="sheetSearch" type="text" placeholder="搜索组件" aria-label="搜索组件">'
          + '<div class="sheet-list">';
        /* 第 217 次（用户：点击添加没反馈、没有卡片预览）：目录改为分组卡片预览——
           每项直接渲染首页上的真实样子（inert，不可交互），右上角「＋ 添加」。 */
        var addedRow = false;
        /* 第 245 次（用户：卡片编辑分类展示）：七个分类 + 顶部分类胶囊，点胶囊只看那一类 */
        var groups = { '快捷记录': [], '上次': [], '今日': [], '趋势': [], '直接记录': [], '距上次': [], '功能入口': [] };
        UNIVERSE().forEach(function (id) {
          if (inCanvas[id]) return;
          var g = '功能入口';
          if (CARDS_META[id]) {
            if (!cmap[id]) return;
            g = Modules.home._cardGroup(id);
          } else if (!TILE_NAME[id] || !cmap[id]) return;
          groups[g].push(id);
        });
        noBadges = true;
        var gNames = Object.keys(groups).filter(function (g) { return groups[g].length; });
        if (gNames.length > 1) {
          html += '<div class="sheet-cats" role="tablist" aria-label="组件分类"><button type="button" class="sc-cat on" data-cat="" role="tab" aria-selected="true">全部</button>'
            + gNames.map(function (g) { return '<button type="button" class="sc-cat" data-cat="' + g + '" role="tab" aria-selected="false">' + g + '<small>' + groups[g].length + '</small></button>'; }).join('')
            + '</div>';
        }
        Object.keys(groups).forEach(function (g) {
          if (!groups[g].length) return;
          html += '<div class="sheet-group" data-group="' + g + '"><h3 class="sheet-gh">' + g + '<small>' + (GROUP_HINT[g] || '') + '</small></h3><div class="sheet-grid">';
          groups[g].forEach(function (id) {
            var t = cmap[id];
            var nm = CARDS_META[id] ? CARDS_META[id].name : TILE_NAME[id];
            var sz = defSize(id);
            var prev;
            t._sz = sz;
            if (t._card) prev = cardHTML(t);
            else prev = '<div class="record-tile ' + (sz === 's' ? 'sz-s' : 'sz-l') + '" data-accent="' + t.accent + '">'
              + '<span class="rt-ico">' + icon(t.id) + '</span><span class="rt-name">' + t.name + '</span>'
              + '<span class="rt-sum">' + t.sum + '</span>'
              + '<span class="rt-arrow" aria-hidden="true">' + icon('chevron-right') + '</span></div>';
            if (!prev) return;
            addedRow = true;
            html += '<div class="sheet-card' + (sz === 's' ? ' is-s' : '') + '" data-add="' + id + '" data-name="' + nm + '" role="button" tabindex="0" aria-label="添加 ' + nm + '">'
              + '<div class="sc-head"><span class="sc-name">' + nm + '</span><span class="sc-add">' + icon('plus') + '添加</span></div>'
              + '<div class="sc-prev" inert aria-hidden="true">' + prev + '</div></div>';
          });
          html += '</div></div>';
        });
        noBadges = false;
        if (!addedRow) html += '<p class="hint" style="padding:14px 4px">全部组件都在首页上了。</p>';
        html += '</div>'
          + '<div class="row"><button class="btn" id="homeLayoutReset" type="button">恢复默认布局</button></div>'
          + '</div></div>';
      }

      view.innerHTML = html;

      /* 第 137 次：就地记录绑定。必须在 view.innerHTML = html 之后——
         控件在 innerHTML 赋值前进不了文档，querySelector 会拿到 null
         （实测踩过：绑定写在赋值前，三个尿布按钮一个都点不动）。
         done() 统一走 App.rerender()——落库后首页刷新，「今日 N 次」与「距上次」立刻跟上。 */
      quickTiles.forEach(function (id) {
        var m = global.Modules[id];
        if (!m || typeof m._quickBind !== 'function') return;
        var box = view.querySelector('[data-quick="' + id + '"]');
        if (box) m._quickBind(box, d, function () { global.App.rerender(); });
      });

      /* 模块记录 / 提醒列表 → 对应模块。
         第 58 次（走查）：提醒 li 有 tabindex=0 + role=button 却只绑了 click——
         键盘 Enter/Space 无效（a11y 缺口）。button 原生支持，li 补键盘触发。
         第 120 次：编辑模式下磁贴导航停用（画布上的点击只服务增删/排序），
         data-go 导航绑定跳过 record-tile；完成编辑后恢复。 */
      Array.prototype.forEach.call(view.querySelectorAll('[data-go]'), function (b) {
        if (editing && b.classList && (b.classList.contains('record-tile') || b.classList.contains('canvas-card'))) return;
        b.addEventListener('click', function () { global.App.showTab(b.getAttribute('data-go')); });
        if (b.tagName === 'LI' || b.tagName === 'DIV') {
          b.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); global.App.showTab(b.getAttribute('data-go')); }
          });
        }
      });

      /* 第 211 次：今日宝宝卡里的「今天 ›」与提醒行 */
      Array.prototype.forEach.call(view.querySelectorAll('[data-tb-go]'), function (c) {
        function go() { global.App.showTab(c.getAttribute('data-tb-go')); }
        c.addEventListener('click', go);
        c.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
      });
      /* 第 210 次：生长小组件点进生长页（不用 data-go，避免被画布当成一个模块组件） */
      Array.prototype.forEach.call(view.querySelectorAll('[data-gs-go]'), function (c) {
        if (editing) return;
        function go() { global.App.showTab('growth'); }
        c.addEventListener('click', go);
        c.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
      });

      /* U-34 容量近上限强提示卡：立即导出 / 延迟 3 天（不自动消失，可再次触发） */
      var capNow = view.querySelector('#capExport');
      /* 第 142 次：quickExport 原先是备份状态行的私有函数，状态行撤走后
         容量提示卡（#capExport）仍要用它——提升为页面级函数，别再删。 */
      function quickExport() { if (global.App && typeof App.exportAll === 'function') App.exportAll(); }
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

      /* ── 第 120 次：编辑模式交互绑定 ── */
      if (!editing && Modules.home._dragTeardown) Modules.home._dragTeardown();
      var editBtn = view.querySelector('#homeEdit');
      if (editBtn) editBtn.addEventListener('click', function () {
        Modules.home._edit = !Modules.home._edit;
        if (!Modules.home._edit) Modules.home._sheet = false;
        global.App.rerender();
      });
      if (editing) {
        var sheetOpen = view.querySelector('#homeSheetOpen');
        if (sheetOpen) sheetOpen.addEventListener('click', function () { Modules.home._sheet = true; global.App.rerender(); });
        var sheetClose = view.querySelector('#homeSheetClose');
        if (sheetClose) sheetClose.addEventListener('click', function () { Modules.home._sheet = false; global.App.rerender(); });
        var layoutReset = view.querySelector('#homeLayoutReset');
        if (layoutReset) layoutReset.addEventListener('click', function () { Modules.home._editReset(); });
        Array.prototype.forEach.call(view.querySelectorAll('[data-del]'), function (b) {
          b.addEventListener('click', function (e) {
            if (e && e.stopPropagation) e.stopPropagation();
            removeCard(b);
          });
        });
        Array.prototype.forEach.call(view.querySelectorAll('[data-size]'), function (b) {
          b.addEventListener('click', function (e) {
            if (e && e.stopPropagation) e.stopPropagation();
            Modules.home._editSize(b.getAttribute('data-size'));
          });
        });
        Array.prototype.forEach.call(view.querySelectorAll('[data-add]'), function (b) {
          function add() {
            if (b.classList.contains('is-adding')) return;
            var id = b.getAttribute('data-add'), nm = b.getAttribute('data-name');
            b.classList.add('is-adding');
            Util.haptic('light');
            /* 先给一下「被加进去」的动效，再落库重绘；重绘后关目录、滚到新卡并高亮 */
            setTimeout(function () {
              Modules.home._justAdded = id;
              Modules.home._sheet = false;
              Modules.home._editAdd(id);
              Util.toast('已添加「' + nm + '」', 'ok');
            }, 220);
          }
          b.addEventListener('click', add);
          b.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); add(); } });
        });
        if (Modules.home._justAdded) {
          var ja = Modules.home._justAdded; Modules.home._justAdded = null;
          /* 第 219 次：先按 data-cid 找卡，再找同 id 的磁贴——避免「喂养」磁贴误中「上次喂奶」卡（其 data-go 也是 feeding） */
          var el = view.querySelector('.record-grid > [data-cid="' + ja + '"]') || view.querySelector('.record-grid > .record-tile[data-go="' + ja + '"], .record-grid > .record-tile[data-quick="' + ja + '"]');
          if (el) {
            el.classList.add('just-added');
            try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e3) { el.scrollIntoView(); }
            setTimeout(function () { el.classList.remove('just-added'); }, 1600);
          }
        }
        Array.prototype.forEach.call(view.querySelectorAll('.sc-cat'), function (c) {
          c.addEventListener('click', function () {
            var cat = c.getAttribute('data-cat');
            Array.prototype.forEach.call(view.querySelectorAll('.sc-cat'), function (x) { var on = x === c; x.classList.toggle('on', on); x.setAttribute('aria-selected', on ? 'true' : 'false'); });
            Array.prototype.forEach.call(view.querySelectorAll('.sheet-group'), function (g) { g.hidden = !!cat && g.getAttribute('data-group') !== cat; });
            var lst = view.querySelector('.sheet-list'); if (lst) lst.scrollTop = 0;
          });
        });
        var sheetSearch = view.querySelector('#sheetSearch');
        if (sheetSearch) sheetSearch.addEventListener('input', function () {
          var q = (sheetSearch.value || '').trim().toLowerCase();
          Array.prototype.forEach.call(view.querySelectorAll('.sheet-card'), function (r) {
            var nm = (r.getAttribute('data-name') || '').toLowerCase();
            r.style.display = (!q || nm.indexOf(q) >= 0) ? '' : 'none';
          });
          Array.prototype.forEach.call(view.querySelectorAll('.sheet-group'), function (g) {
            g.style.display = g.querySelector('.sheet-card:not([style*="none"])') ? '' : 'none';
          });
        });
        bindDrag(view);
      }

      /* 长按拖动排序（编辑模式专用）。设计取舍：
         ① long-press 350ms 起手——普通点按（删/切大小）绝不误触发拖动；
         ② .is-editing .record-tile { touch-action:none } —— 不用 passive 监听
            大战，浏览器层面就不再吞 pointermove 去做滚动（第 116/117 批教训：
            iOS 触摸判定重灾区，能用 CSS 声明解决的绝不 JS 硬扛）；
         ③ 拖动中只重排 DOM（insertBefore），松手才 _editOrder 落库一次重绘，
            不在 pointermove 里走全量 render（那会拆掉正在拖的节点）；
         ④ 移动阈值 10px 内视为点按，超限未长按成功则整个作废。 */
      /* 第 246 次（用户：移动卡片是硬切的，没有拖动感）：拖动重做——
         ① 按住 350ms 卡片「浮起」（放大 + 阴影），之后卡片用 translate 跟着手指走；
         ② 经过别的卡片时插到它前 / 后，其它卡片用 FLIP 平滑让位（不再瞬间跳）；
         ③ 手指靠近屏幕上下边缘时页面自动滚动；
         ④ 松手卡片滑回空位，动画结束才落库重绘。
         位移一律写 CSS 的 translate 属性（独立于 transform / 动画），不和编辑态别的样式打架。 */
      /* 第 250 次：删除卡片带动画——卡片缩小淡出（略微下沉），其余卡片用 FLIP 平滑补位，动画结束才落库重绘。
         重绘后的排布和动画终点一致，所以看不到二次跳动。 */
      function removeCard(b) {
        var id = b.getAttribute('data-del');
        var card = b.closest('.record-tile, .canvas-card');
        var grid = card && card.parentNode;
        var reduce = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (!card || !grid || reduce || !card.animate || card.classList.contains('removing')) { Modules.home._editDel(id); return; }
        card.classList.add('removing');
        var anim = card.animate([
          { scale: '1', opacity: 1, filter: 'blur(0px)' },
          { scale: '0.6', opacity: 0, filter: 'blur(4px)' }
        ], { duration: 220, easing: 'cubic-bezier(.4,0,.9,.6)', fill: 'forwards' });
        anim.onfinish = function () {
          var others = Array.prototype.filter.call(grid.children, function (el) { return el !== card && el.nodeType === 1; });
          var before = others.map(function (el) { return el.getBoundingClientRect(); });
          card.style.display = 'none';
          others.forEach(function (el, k) {
            var a = before[k], c = el.getBoundingClientRect();
            var dx = a.left - c.left, dy = a.top - c.top;
            if (!dx && !dy) return;
            el.animate([{ translate: dx + 'px ' + dy + 'px' }, { translate: '0px 0px' }], { duration: 340, easing: 'cubic-bezier(.32,.72,0,1)' });
          });
          setTimeout(function () { Modules.home._editDel(id); }, 330);
        };
      }

      function bindDrag(view) {
        var grid = view.querySelector('.record-grid.is-editing');
        if (!grid) return;
        var SEL = '.record-tile, .canvas-card';
        function kids() { return Array.prototype.filter.call(grid.children, function (el) { return el.matches && el.matches(SEL); }); }
        var cur = null, timer = null, dragging = false, sx = 0, sy = 0, fx = 0, fy = 0;
        var ox0 = 0, oy0 = 0, py0 = 0, raf = 0, settling = false;
        function place() {
          if (!cur || !dragging) return;
          var dx = (fx - sx) - (cur.offsetLeft - ox0);
          var dy = (fy - sy) + ((global.pageYOffset || 0) - py0) - (cur.offsetTop - oy0);
          cur.style.translate = dx + 'px ' + dy + 'px';
        }
        function flipMove(fn) {
          var others = kids().filter(function (el) { return el !== cur; });
          var before = others.map(function (el) { return el.getBoundingClientRect(); });
          fn();
          others.forEach(function (el, k) {
            var a = before[k], b = el.getBoundingClientRect();
            var dx = a.left - b.left, dy = a.top - b.top;
            if (!dx && !dy) return;
            el.style.transition = 'none';
            el.style.translate = dx + 'px ' + dy + 'px';
            void el.offsetWidth;
            el.style.transition = 'translate .32s cubic-bezier(.32,.72,0,1)';
            el.style.translate = '0px 0px';
          });
        }
        function endDrag(save) {
          if (timer) { clearTimeout(timer); timer = null; }
          if (raf) { cancelAnimationFrame(raf); raf = 0; }
          var el = cur, was = dragging;
          cur = null; dragging = false;
          document.body.classList.remove('home-dragging');
          if (!el) return;
          el.classList.remove('drag-armed');
          if (!was) { el.classList.remove('dragging'); return; }
          settling = true;
          el.style.transition = 'translate .28s cubic-bezier(.32,.72,0,1), scale .28s cubic-bezier(.32,.72,0,1), box-shadow .28s';
          el.style.translate = '0px 0px';
          el.classList.remove('dragging');
          setTimeout(function () {
            settling = false;
            el.style.transition = ''; el.style.translate = '';
            kids().forEach(function (k) { k.style.transition = ''; k.style.translate = ''; });
            if (save) {
              Modules.home._editOrder(kids().map(function (r) { return r.getAttribute('data-cid') || r.getAttribute('data-go'); }));
            }
          }, 290);
        }
        function startDrag() {
          if (!cur) return;
          dragging = true;
          ox0 = cur.offsetLeft; oy0 = cur.offsetTop; py0 = global.pageYOffset || 0;
          cur.classList.remove('drag-armed');
          cur.classList.add('dragging');
          document.body.classList.add('home-dragging');
          Util.haptic();
          loop();
        }
        /* 自动滚动：手指在屏幕上 / 下 90px 内时按距离加速滚 */
        function loop() {
          raf = requestAnimationFrame(function () {
            if (!dragging) return;
            var vh = global.innerHeight || 800, v = 0;
            if (fy < 90) v = -Math.ceil((90 - fy) / 6);
            else if (fy > vh - 130) v = Math.ceil((fy - (vh - 130)) / 6);
            if (v) { global.scrollBy(0, v); hitTest(); place(); }
            loop();
          });
        }
        /* 第 246 次（真机录屏：半宽卡上下拖不动）：不再按「前 / 后半边」判断，改成常见的排序手感——
           手指进入另一张卡的中心区，就把拖动卡移到那张卡的位置（原来在它前面就插到它后面，反之插到它前面）。
           刚让位、还在滑动中的卡 280ms 内不再参与判定，避免它滑走途中又被手指扫到来回跳。 */
        var moving = [], movingT = 0;
        function hitTest() {
          var over = document.elementFromPoint ? document.elementFromPoint(fx, fy) : null;
          while (over && over !== grid && !(over.matches && over.matches(SEL) && over.parentNode === grid)) over = over.parentNode;
          if (!over || over === grid || over === cur) return;
          if (Date.now() - movingT < 280 && moving.indexOf(over) >= 0) return;
          var r2 = over.getBoundingClientRect();
          var nx = (fx - r2.left) / r2.width, ny = (fy - r2.top) / r2.height;
          if (nx < 0.15 || nx > 0.85 || ny < 0.15 || ny > 0.85) return; /* 只在中心区触发，边缘留缓冲 */
          var list = kids(), ci = list.indexOf(cur), oi = list.indexOf(over);
          if (ci < 0 || oi < 0) return;
          var lo = Math.min(ci, oi), hi = Math.max(ci, oi);
          moving = list.slice(lo, hi + 1).filter(function (el) { return el !== cur; });
          movingT = Date.now();
          flipMove(function () { grid.insertBefore(cur, ci < oi ? over.nextSibling : over); });
          place();
        }
        kids().forEach(function (row) {
          row.addEventListener('pointerdown', function (e) {
            if (dragging || cur || settling) return;
            if (e.target && e.target.closest && e.target.closest('[data-del],[data-size]')) return;
            cur = row; sx = fx = e.clientX; sy = fy = e.clientY; dragging = false;
            row.classList.add('drag-armed');
            var pid = e.pointerId;
            timer = setTimeout(function () {
              timer = null;
              if (!cur || cur !== row) return;
              startDrag();
              if (e.pointerType !== 'touch' && row.setPointerCapture && pid !== undefined) {
                try { row.setPointerCapture(pid); } catch (err) {}
              }
            }, 350);
          });
        });
        function onMoveXY(x, y, ev) {
          if (!cur) return;
          if (!dragging) {
            if (Math.abs(x - sx) > 10 || Math.abs(y - sy) > 10) endDrag(false);
            return;
          }
          if (ev && ev.cancelable) ev.preventDefault();
          fx = x; fy = y;
          place();
          hitTest();
        }
        function onTouchMove(e) { var t = e.touches && e.touches[0]; if (t) onMoveXY(t.clientX, t.clientY, e); }
        function onTouchEnd() { if (cur) endDrag(dragging); }
        function onPMove(e) { if (e.pointerType === 'touch') return; onMoveXY(e.clientX, e.clientY, e); }
        function onUp(e) {
          if (!cur) return;
          if (e.pointerType === 'touch') { if (!dragging && e.type === 'pointercancel') endDrag(false); return; }
          endDrag(dragging);
        }
        document.addEventListener('touchmove', onTouchMove, { passive: false });
        document.addEventListener('touchend', onTouchEnd, true);
        document.addEventListener('touchcancel', onTouchEnd, true);
        document.addEventListener('pointermove', onPMove, { passive: false });
        document.addEventListener('pointerup', onUp, true);
        document.addEventListener('pointercancel', onUp, true);
        if (Modules.home._dragTeardown) Modules.home._dragTeardown();
        Modules.home._dragTeardown = function () {
          document.removeEventListener('pointerup', onUp, true);
          document.removeEventListener('pointercancel', onUp, true);
          document.removeEventListener('pointermove', onPMove, { passive: false });
          document.removeEventListener('touchmove', onTouchMove, { passive: false });
          document.removeEventListener('touchend', onTouchEnd, true);
          document.removeEventListener('touchcancel', onTouchEnd, true);
          if (raf) cancelAnimationFrame(raf);
          document.body.classList.remove('home-dragging');
          Modules.home._dragTeardown = null;
        };
      }

      /* 第 122 次：直接记录组件绑定。数据路径与 diaper.js/sleep.js 同源：
         同 rec 字段、同 Storage.save() 判定、同撤销 toast（尿布 C2 单手误触高发）、
         同时长 toast（睡眠 C1 计时类带时长）。 */
      Array.prototype.forEach.call(view.querySelectorAll('[data-reccd]'), function (b) {
        b.addEventListener('click', function () {
          var rec = { id: Util.uid(), type: b.getAttribute('data-reccd'), time: Util.todayISO() + Util.nowLocal().slice(10), note: null };
          d.diapers.push(rec);
          if (Storage.save()) {
            /* 第 125 次：toast 文案与 diaper.js 同源（『已记录：尿/便/尿+便』）。
               原为笼统的『已记录』，与尿布页反馈不一致。 */
            var dTypeTxt = ({ pee: '尿', poop: '便', both: '尿+便' })[rec.type] || rec.type;
            Util.toast('已记录：' + dTypeTxt, 'ok', { label: '撤销', onClick: function () {
              for (var i = d.diapers.length - 1; i >= 0; i--) {
                if (d.diapers[i].id === rec.id) { d.diapers.splice(i, 1); break; }
              }
              Storage.save(); global.App.rerender(); Util.toast('已撤销', 'ok');
            } });
          }
          global.App.rerender();
        });
      });
      /* 第 146 次：首屏「此刻」条与睡眠磁贴共用同一套开始/结束逻辑（querySelectorAll 绑全部） */
      Array.prototype.forEach.call(view.querySelectorAll('[data-recsl="start"]'), function (recSlStart) { recSlStart.addEventListener('click', function () {
        d.openSleep = { id: Util.uid(), start: Util.nowLocal(), pausedMs: 0, pauseStart: null };
        Storage.save(); Util.toast('开始记录睡眠，醒了点「醒了」', 'ok'); global.App.rerender();
      }); });
      Array.prototype.forEach.call(view.querySelectorAll('[data-recsl="end"]'), function (recSlEnd) { recSlEnd.addEventListener('click', function () {
        var os2 = d.openSleep;
        if (!os2 || !os2.start) return;
        /* 第 241 次：与睡眠页同一个出口，全屏里记的醒来次数一并落库 */
        Modules.sleep._end(Date.now());
        global.App.rerender();
      }); });

      /* 第 146 次：首屏快记（与 app.js 快记 dock 同口径：同字段、同撤销） */
      function hnSave(arrName, rec, msg) {
        var dd = Storage.get();
        /* 第 222 次：「两个都记」——每个宝宝名下各写一份（各自独立 id），撤销一起撤 */
        if (Modules.home._qTarget === 'all' && (dd.babies || []).length >= 2) {
          var made = [];
          dd.babies.forEach(function (bb) {
            var r = JSON.parse(JSON.stringify(rec)); r.id = Util.uid();
            if (Storage.pushFor(bb.id, arrName, r)) made.push([bb.id, r.id]);
          });
          if (Storage.save()) Util.toast(msg + ' · ' + made.length + ' 个宝宝', 'ok', { label: '撤销', onClick: function () {
            made.forEach(function (m) { Storage.removeFor(m[0], arrName, m[1]); });
            Storage.save(); global.App.rerender(); Util.toast('已撤销', 'ok');
          } });
          global.App.rerender();
          return;
        }
        dd[arrName].push(rec);
        if (Storage.save()) Util.toast(msg, 'ok', { label: '撤销', onClick: function () {
          var arr = Storage.get()[arrName];
          for (var i = arr.length - 1; i >= 0; i--) if (arr[i].id === rec.id) { arr.splice(i, 1); break; }
          Storage.save(); global.App.rerender(); Util.toast('已撤销', 'ok');
        } });
        global.App.rerender();
      }
      Array.prototype.forEach.call(view.querySelectorAll('[data-qtgt]'), function (b) {
        b.addEventListener('click', function () {
          Modules.home._qTarget = b.getAttribute('data-qtgt') === 'all' ? 'all' : 'one';
          global.App.rerender();
        });
      });
      Array.prototype.forEach.call(view.querySelectorAll('[data-hnq]'), function (b) {
        b.addEventListener('click', function () {
          var k = b.getAttribute('data-hnq');
          if (k === 'feed') {
            var fd = App._fedDefaults(), f0 = fd.rec;
            hnSave('feedings', { id: Util.uid(), type: f0.type, start: Util.nowLocal(),
              durationMin: f0.durationMin, amount: f0.amount, amountBm: f0.amountBm || null, amountFm: f0.amountFm || null,
              side: f0.side, note: null }, '已记录：' + fd.label);
          } else if (k === 'pee' || k === 'poop') {
            hnSave('diapers', { id: Util.uid(), type: k, time: Util.nowLocal(), note: null }, k === 'pee' ? '已记录：尿布 · 尿' : '已记录：尿布 · 便');
          }
        });
      });

      /* 进行中计时每秒走字；页面换掉（元素不在文档里）后自停，重渲染时先清旧的 */
      if (Modules.home._runTick) { clearInterval(Modules.home._runTick); Modules.home._runTick = null; }
      if (view.querySelector('[data-run-start]')) {
        Modules.home._runTick = setInterval(function () {
          var els = document.querySelectorAll('.hn-elapsed[data-run-start]');
          if (!els.length) { clearInterval(Modules.home._runTick); Modules.home._runTick = null; return; }
          Array.prototype.forEach.call(els, function (el) {
            var now = Date.now(), pa = parseInt(el.getAttribute('data-run-paused'), 10) || 0;
            var pat = el.getAttribute('data-run-pause-at');
            if (pat) pa += now - parseInt(pat, 10);
            el.textContent = Modules.home._hnClock(Math.max(0, now - parseInt(el.getAttribute('data-run-start'), 10) - pa));
          });
        }, 1000);
      }

      /* 第 123 次：瓶喂/亲喂/吸奶绑定。rec 十二字段与 feeding.js #fSave 全量同源；
         校验文案逐字一致（warn 不落库）；撤销链同 C2；记录成功后步进状态重置。 */
      Array.prototype.forEach.call(view.querySelectorAll('[data-recstep]'), function (b) {
        b.addEventListener('click', function () {
          var spec = b.getAttribute('data-recstep').split(':');
          var delta = parseInt(spec[1], 10);
          var parts = spec[0].split('.');
          var st = Modules.home._recState;
          if (!st[parts[0]]) return;
          var field = parts[1] || 'amount';
          st[parts[0]][field] = Math.max(0, (st[parts[0]][field] || 0) + delta);
          global.App.rerender();
        });
      });
      Array.prototype.forEach.call(view.querySelectorAll('[data-recbk]'), function (b) {
        b.addEventListener('click', function () {
          var st = Modules.home._recState;
          if (st.bottle) { st.bottle.kind = b.getAttribute('data-recbk'); global.App.rerender(); }
        });
      });
      Array.prototype.forEach.call(view.querySelectorAll('[data-recf]'), function (b) {
        b.addEventListener('click', function () {
          var kind = b.getAttribute('data-recf');
          var st = Modules.home._recState[kind] || {};
          var rec = {
            id: Util.uid(),
            type: kind,
            start: Util.todayISO() + Util.nowLocal().slice(10),
            durationMin: null, durationL: null, durationR: null,
            amount: null, amountBm: null, amountFm: null,
            side: null, note: null, newFood: null, dish: null, ing: null, steps: null
          };
          if (kind === 'bottle') {
            if (!st.amount) { Util.toast('请至少设置母乳或配方奶的量', 'warn'); return; }
            rec.amount = st.amount;
            if (st.kind === 'formula') rec.amountFm = st.amount; else rec.amountBm = st.amount;
          } else {
            if (kind === 'breast' && !st.L && !st.R) { Util.toast('请至少设置左侧或右侧的时长', 'warn'); return; }
            if (kind === 'pump' && !st.L && !st.R && !st.ml) { Util.toast('请至少设置时长或奶量', 'warn'); return; }
            rec.durationL = st.L || null;
            rec.durationR = st.R || null;
            rec.durationMin = (st.L || 0) + (st.R || 0) || null;
            rec.side = (st.L && st.R) ? 'both' : (st.L ? 'left' : (st.R ? 'right' : null));
            if (kind === 'pump') rec.amount = st.ml || null;
          }
          d.feedings.push(rec);
          if (Storage.save()) {
            /* 第 125 次：toast 文案与 feeding.js 同源——带类型名与明细
               （『已记录：瓶喂 母乳 60 ml』『已记录：亲喂 左 15 分』）。 */
            var fTxt = ({ bottle: '瓶喂', breast: '亲喂', pump: '泵奶' })[kind] || kind;
            var fDetail = '';
            if (kind === 'bottle') fDetail = (st.kind === 'formula' ? '配方奶 ' : '母乳 ') + st.amount + ' ml';
            else if (kind === 'breast') {
              var bs = [];
              if (st.L) bs.push('左 ' + st.L + ' 分');
              if (st.R) bs.push('右 ' + st.R + ' 分');
              fDetail = bs.join(' · ');
            } else {
              var ps = [];
              if (st.L) ps.push('左 ' + st.L + ' 分');
              if (st.R) ps.push('右 ' + st.R + ' 分');
              if (st.ml) ps.push(st.ml + ' ml');
              fDetail = ps.join(' · ');
            }
            Util.toast('已记录：' + fTxt + (fDetail ? ' ' + fDetail : ''), 'ok', { label: '撤销', onClick: function () {
              for (var i = d.feedings.length - 1; i >= 0; i--) {
                if (d.feedings[i].id === rec.id) { d.feedings.splice(i, 1); break; }
              }
              Storage.save(); global.App.rerender(); Util.toast('已撤销', 'ok');
            } });
          }
          Modules.home._recState[kind] = null; /* 下次 render 由 recState 重置回默认 */
          global.App.rerender();
        });
      });

      /* 启动天空（离开首页时 canvas 被移除，循环自动停止） */
      var canvas = view.querySelector('#skyCanvas');
      /* 第 214 次：天气直接改天空画法——mount 前先告诉 Sky 当前天气，首帧就是对的 */
      if (global.Sky && global.Sky.setWeather) (function (f) { global.Sky.setWeather(f.k, f); })((wxNow && (d.settings.weather || {}).on && global.Weather) ? Weather.fxOf(wxNow) : { k: '' });
      if (global.Sky && canvas) global.Sky.mount(canvas);
      /* 第 212 次：天气——先用缓存画，后台刷新后原地替换天气块，不整页重绘 */
      (function () {
        var sky = view.querySelector('.home-sky');
        function apply(w) {
          if (!sky) return;
          var k = w ? Weather.codeInfo(w.code).k : '';
          ['wx-clear', 'wx-partly', 'wx-cloudy', 'wx-fog', 'wx-rain', 'wx-snow', 'wx-thunder'].forEach(function (x) { sky.classList.toggle(x, x === 'wx-' + k); });
          var fx = w ? Weather.fxOf(w) : { k: '' };
          if (global.Sky && Sky.setWeather) Sky.setWeather(k, fx);
          Weather.mountFx(view.querySelector('#wxCanvas'), k, fx);
        }
        if (!global.Weather) return;
        var cfg = d.settings.weather || {};
        if (!cfg.on) { apply(null); return; }
        apply(wxNow);
        Weather.load(cfg).then(function (w) {
          if (!view.isConnected || !sky || !sky.isConnected) return;
          var old = sky.querySelector('.hg-wx-txt');
          if (old) { old.textContent = Weather.codeInfo(w.code).t + ' ' + w.temp + '°'; old.hidden = false; }
          apply(w);
        }, function () {});
      })();
    }
  };

  /* ============================================================
     第 120 次（首页布局编辑 · 对标第五批 Cali 组件画布）：布局数据层
     settings.homeLayout = { v:1, items:[{id,size}], removed:[id] }
       size: 'l'=整排卡 / 's'=一排两个；null = 自动策展（阶段筛选 + 收敛）。
     两层关系：自动策展是默认；用户在编辑模式做过任何增删/排序/改大小，
     homeLayout 即接管（用户自己就是策展人），「恢复默认布局」随时退回。
     纪律：删除 ≠ 隐藏能力——被删组件从目录可加回，「全部功能」兜底入口照挂。
     存储只新增 settings.homeLayout 一个键（形状校验见 storage.js），DATA_VERSION 不动。
     ============================================================ */
  /* 阶段 ORDER 抽到模块级：render 的自动排序与编辑画布共用同一份（单一来源）。
     第 128 次（候选 5+1 落产线，2026-10-11 实测后拍板）：两份 ORDER 改「每日必做优先」——
     育儿期 喂养/尿布/睡眠/吃药/情绪 前置到前五位，消耗品/宫缩/孕期/待产包殿后；
     孕期 mood/meds 提前，period 殿后。实测：冷启动 8→8（增吃药/维D、移体温）、
     普通日 8→7（增妈妈情绪、移体温/消耗品）、孕期两态逐格零变化。 */
  var STAGE_ORDER = {
    pregnancy: ['pregnancy', 'fetal', 'contraction', 'packing', 'mood', 'meds', 'feeding', 'diaper', 'sleep', 'whitenoise', 'growth', 'vaccine', 'milestone', 'temp', 'period', 'finance',
      /* 第 132 次：六个新模块一律殿后。它们是低频/阶段性模块（黄疸只在新生儿期、
         日晒游泳是季节性），不该挤掉「每日必做」的位置；等真实使用数据出来再调。 */
      'jaundice', 'bath', 'swim', 'sun', 'water', 'supplement'],
    baby: ['feeding', 'diaper', 'sleep', 'meds', 'mood', 'whitenoise', 'growth', 'vaccine', 'milestone', 'temp', 'period', 'finance', 'supplies', 'contraction', 'pregnancy', 'packing',
      'jaundice', 'bath', 'swim', 'sun', 'water', 'supplement', 'solid'] /* 第 269 次：辅食独立模块殿后，记过才出现 */
  };
  /* 组件宇宙：两阶段 ORDER 的并集（17 个 id，含跨阶段的 fetal/supplies），
     再并上第 121 次的卡组件 id。布局校验以它为准——布局里只允许出现真的存在的组件 id。 */
  function UNIVERSE() {
    return STAGE_ORDER.pregnancy.concat(STAGE_ORDER.baby.filter(function (id) {
      return STAGE_ORDER.pregnancy.indexOf(id) < 0;
    })).concat(CARD_IDS);
  }
  /* ============================================================
     第 121 次（回顾组件化 · 对标第五批 Cali 组件画布第二期）：
     首页固定卡迁入布局画布，成为与磁贴平权的可排序/可删/可调大小的组件。
       feednext     下次喂奶参考（原固定卡，条件：育儿期 + 48h ≥2 次喂养）
       growthspark  生长速览（原固定卡，条件：有生日 + ≥2 次测量）
       last-*       「距上次」组件（可挑工具：Cali 的「选一个工具生成距上次卡」
                    直接展开为多个目录条目——每个 id 自带参数，与扁平布局天然兼容）
     纪律：
     · 自动模式（无布局）下卡片仍走原位渲染，输出与改前逐字节一致——老用户零感知；
     · 布局/编辑模式下卡片进网格与磁贴混排（_layoutApply 对卡不殿后：
       items 里没有的卡不该突然出现在末尾——「殿后」只服务新模块不隐身的目标）；
     · 条件不满足的卡在布局模式下不渲染（条件恢复自动回来），编辑画布上渲染
       占位卡（可删可排序），目录如实只在条件满足时列出——不显示空壳（冷启动保护延续）；
     · last-* 无数据时显示「暂无记录」空态而非消失——它的价值正是引导去记录。
     ============================================================ */
  var W_IDS = ['quick', 'w-feed', 'w-diaper', 'w-sleep', 'w-noise'];
  /* 第 245 次：快捷记录多两种尺寸（横向条 / 小卡），新增四张「今日」小卡 */
  var QUICK_IDS = ['quick', 'quick-h', 'quick-s'];
  var TODAY_IDS = ['w-feed-today', 'w-diaper-today', 'w-sleep-today', 'w-temp'];
  var CARD_IDS = W_IDS.concat(['quick-h', 'quick-s']).concat(TODAY_IDS).concat(['w-today', 'w-week-feed', 'w-week-sleep', 'w-age', 'feednext', 'growthspark', 'last-feeding', 'last-diaper', 'last-sleep', 'last-growth', 'last-temp', 'rec-diaper', 'rec-sleep', 'rec-bottle', 'rec-breast', 'rec-pump']);
  var CARDS_META = {
    'quick': { name: '快捷记录 · 大', icon: 'plus' },
    'quick-h': { name: '快捷记录 · 横条', icon: 'plus' },
    'quick-s': { name: '快捷记录 · 小卡', icon: 'plus' },
    'w-feed-today': { name: '今日喂奶', icon: 'feeding' },
    'w-diaper-today': { name: '今日尿布', icon: 'diaper' },
    'w-sleep-today': { name: '今日睡眠', icon: 'sleep' },
    'w-temp': { name: '最近体温', icon: 'temp' },
    'w-feed': { name: '上次喂奶', icon: 'feeding' },
    'w-diaper': { name: '上次尿布', icon: 'diaper' },
    'w-sleep': { name: '上次睡眠', icon: 'sleep' },
    'w-noise': { name: '哄睡声音', icon: 'whitenoise' },
    'feednext': { name: '下次喂奶参考', icon: 'bottle' },
    'growthspark': { name: '生长速览', icon: 'growth' },
    /* 第 122 次：直接记录组件——画布内即记即走（对标第五批 Cali）。 */
    'rec-diaper': { name: '记尿布', icon: 'diaper' },
    'rec-sleep': { name: '睡眠计时', icon: 'sleep' },
    /* 第 123 次：直接记录第二批——瓶喂/亲喂/吸奶（对标报告 §7.4 第 3 条跟进项）。 */
    'rec-bottle': { name: '瓶喂', icon: 'feeding' },
    'rec-breast': { name: '亲喂', icon: 'breast' },
    'rec-pump': { name: '吸奶', icon: 'pump' },
    'last-feeding': { name: '距上次喂奶', icon: 'feeding' },
    'last-diaper': { name: '距上次尿布', icon: 'diaper' },
    'last-sleep': { name: '距上次睡眠', icon: 'sleep' },
    'last-growth': { name: '距上次测量', icon: 'growth' },
    'last-temp': { name: '距上次体温', icon: 'temp' },
    /* 第 217 次（用户：添加更多的卡片设计）：数据卡 */
    'w-today': { name: '今日概览', icon: 'calendar' },
    'w-week-feed': { name: '近 7 天奶量', icon: 'feeding' },
    'w-week-sleep': { name: '近 7 天睡眠', icon: 'sleep' },
    'w-age': { name: '成长天数', icon: 'growth' }
  };
  var DATA_IDS = ['w-today', 'w-week-feed', 'w-week-sleep', 'w-age'];
  /* 第 245 次：组件分类（编辑目录与设置页共用） */
  var GROUP_HINT = { '快捷记录': '一点就记', '上次': '上一次是什么时候', '今日': '今天的次数和总量', '趋势': '一周、成长', '直接记录': '在首页上直接记', '距上次': '多久没做了', '功能入口': '进对应页面' };
  Modules.home._cardGroup = function (id) {
    if (QUICK_IDS.indexOf(id) >= 0) return '快捷记录';
    if (TODAY_IDS.indexOf(id) >= 0 || id === 'w-today') return '今日';
    if (DATA_IDS.indexOf(id) >= 0 || id === 'growthspark' || id === 'feednext') return '趋势';
    if (/^rec-/.test(id)) return '直接记录';
    if (/^last-/.test(id)) return '距上次';
    if (CARDS_META[id]) return '上次';
    return '功能入口';
  };
  /* 距上次卡的数据源定义：list=数据键，key=时间字段，detail=明细行（取最新一条渲染）。
     时间口径统一走 lastAny + gapText + dayLabel（与磁贴摘要同源，只描述中性事实不催促）。 */
  var LAST_DEFS = {
    'last-feeding': { list: 'feedings', key: 'start', detail: function (r) { return (r && r.amount != null) ? (r.amount + ' ml') : ''; } },
    'last-diaper': { list: 'diapers', key: 'time', detail: function () { return ''; } },
    'last-sleep': { list: 'sleeps', key: 'start', detail: function () { return ''; } },
    'last-growth': { list: 'growth', key: 'date', detail: function (r) { return (r && r.weightKg != null) ? (r.weightKg + ' kg') : ((r && r.heightCm != null) ? (r.heightCm + ' cm') : ''); } },
    'last-temp': { list: 'temps', key: 'time', detail: function (r) { return (r && r.value != null) ? (r.value + '°C') : ''; } }
  };
  var LAST_DEFS_IDS = ['last-feeding', 'last-diaper', 'last-sleep', 'last-growth', 'last-temp'];
  /* 第 211 次：默认卡片组合与默认大小。小组件、模块卡默认半宽；快捷记录与各类记录卡整排。 */
  var DEFAULTS = {
    baby: ['quick', 'w-feed', 'w-diaper', 'w-sleep', 'w-noise', 'growthspark', 'feednext'],
    pregnancy: ['pregnancy', 'fetal', 'contraction', 'packing', 'mood', 'w-noise'],
    /* 第 220 次：大宝已出生 + 又怀孕——孕期两张 + 大宝的每日记录 */
    dual: ['pregnancy', 'fetal', 'quick', 'w-feed', 'w-diaper', 'w-sleep', 'w-noise', 'growthspark', 'feednext']
  };
  function isDual(d) { return !!(global.App && typeof App.isDualStage === 'function' && App.isDualStage(d)); }
  function defSize(id) {
    if (id === 'quick' || id === 'quick-h' || id === 'growthspark' || id === 'feednext' || id === 'w-today' || id === 'w-week-feed' || id === 'w-week-sleep' || /^(rec|last)-/.test(id)) return 'l';
    return 's';
  }
  function defaultLayout(d) {
    var ids = DEFAULTS[isDual(d) ? 'dual' : (editStage(d) === 'pregnancy' ? 'pregnancy' : 'baby')];
    return {
      items: ids.map(function (id) { return { id: id, size: defSize(id) }; }),
      removed: UNIVERSE().filter(function (id) { return ids.indexOf(id) < 0 && !CARDS_META[id]; })
    };
  }
  Modules.home._defaultLayout = defaultLayout;
  Modules.home._defSize = defSize;
  /* 设置 · 首页卡片用的目录：分组 + 是否在首页 */
  Modules.home._catalog = function () {
    var d = Storage.get();
    var hl = Modules.home._layoutNormalize(d.settings.homeLayout, UNIVERSE()) || defaultLayout(d);
    var on = {};
    hl.items.forEach(function (it) { on[it.id] = 1; });
    var names = {};
    ((Modules.alltools && Modules.alltools._modules) || []).forEach(function (m) { names[m.id] = m.name; });
    var ACC = { 'quick': 'feeding', 'quick-h': 'feeding', 'quick-s': 'feeding', 'w-noise': 'whitenoise', 'w-feed': 'feeding', 'w-diaper': 'diaper', 'w-sleep': 'sleep',
      'w-feed-today': 'feeding', 'w-diaper-today': 'diaper', 'w-sleep-today': 'sleep', 'w-temp': 'temp', 'w-today': 'feeding', 'w-week-feed': 'feeding', 'w-week-sleep': 'sleep', 'w-age': 'growth',
      'growthspark': 'growth', 'feednext': 'feeding' };
    var out = [];
    /* 第 245 次：与首页编辑目录同一套分类 */
    var ORDER = ['快捷记录', '上次', '今日', '趋势', '直接记录', '距上次', '功能入口'];
    var all = CARD_IDS.concat(UNIVERSE().filter(function (id) { return !CARDS_META[id]; }));
    ORDER.forEach(function (g) {
      all.forEach(function (id) {
        if (Modules.home._cardGroup(id) !== g) return;
        var m = CARDS_META[id];
        var ic = m ? m.icon : id;
        out.push({ id: id, name: m ? m.name : (names[id] || id), icon: ic, accent: ACC[id] || (m ? (ic === 'breast' || ic === 'pump' || ic === 'bottle' ? 'feeding' : ic) : id), group: g, on: !!on[id] });
      });
    });
    return out;
  };
  /* 第 212 次（用户：不要单独的天气模块，天空背景直接显示天气）：
     天气只体现在天空本身（阴天压暗、雨雪粒子、雾），日期行末尾跟一行小字「多云 18°」，不做卡片 */
  function wxTextHTML(w) {
    if (!w || !global.Weather) return '<span class="hg-wx-txt" hidden></span>';
    return '<span class="hg-wx-txt">' + Util.escapeHtml(Weather.codeInfo(w.code).t + ' ' + w.temp + '°') + '</span>';
  }
  function editStage(d) {
    return (global.App && typeof App.stageOf === 'function' && App.stageOf(d)) || 'baby';
  }
  /* 布局归一化：raw（可能是坏数据/旧数据）→ 严格形状，或 null（= 自动策展）。
     与 storage.js 白名单互补：那层防落库，这层防内存中其它来源的脏对象。 */
  Modules.home._layoutNormalize = function (raw, universe) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray(raw.items)) return null;
    var uni = {};
    (universe || []).forEach(function (id) { uni[id] = 1; });
    var items = []; var seen = {};
    raw.items.forEach(function (it) {
      if (it && uni[it.id] && !seen[it.id]) {
        seen[it.id] = 1;
        items.push({ id: it.id, size: (it.size === 's') ? 's' : 'l' });
      }
    });
    var removed = []; var seenR = {};
    (Array.isArray(raw.removed) ? raw.removed : []).forEach(function (id) {
      if (uni[id] && !seenR[id]) { seenR[id] = 1; removed.push(id); }
    });
    /* 第 125 次：removed 与 items 冲突时以 removed 为准（用户「删除」意图优先），
       从 items 里剔除——否则 _layoutApply 的正常排版循环会先把该 id 输出，
       殿后循环又因它已出 map 而跳过，结果「删掉的组件仍然显示」。 */
    items = items.filter(function (it) { return !seenR[it.id]; });
    return (items.length || removed.length) ? { items: items, removed: removed } : null;
  };
  /* 应用布局：items 顺序优先（带各自 size），宇宙里其余未被删的模块按原顺序殿后
     （新模块自动出现在末尾，不会因为用户存过布局而永远隐身）。
     第 121 次：卡组件（_card）不殿后——items 里没有的卡不该突然出现在末尾，
     「殿后」只服务「新磁贴模块不隐身」这一个目标；last-* 只跟随 items。 */
  Modules.home._layoutApply = function (tilesAll, layout) {
    /* 第 125 次：兜底——本函数是对外暴露的公共函数，外部误用（传裸对象）
       时不该 TypeError。normalize 内部调用时这两个字段已保证是数组。 */
    layout = layout || {};
    var items = Array.isArray(layout.items) ? layout.items : [];
    var removed = Array.isArray(layout.removed) ? layout.removed : [];
    var map = {}; var out = [];
    tilesAll.forEach(function (t) { map[t.id] = t; t._sz = 'l'; });
    items.forEach(function (it) {
      if (it && map[it.id]) { map[it.id]._sz = it.size; out.push(map[it.id]); delete map[it.id]; }
    });
    tilesAll.forEach(function (t) {
      if (map[t.id] && removed.indexOf(t.id) < 0 && !t._card) out.push(t);
    });
    return out;
  };
  /* 纯函数：items 数组内移动一个元素（拖动排序的内核，DOM 无关可测） */
  Modules.home._layoutMove = function (items, from, to) {
    if (from < 0 || from >= items.length || to < 0 || to >= items.length || from === to) return items.slice();
    var arr = items.slice();
    var moved = arr.splice(from, 1)[0];
    arr.splice(to, 0, moved);
    return arr;
  };
  /* 第 123 次：直接记录卡的步进状态（会话内瞬时，不落库——与 _edit 同性质）。
     每张卡独立：bottle {kind,amount} / breast {L,R} / pump {L,R,ml}。
     记录成功后重置回默认（下次进来从默认值开始，不残留上次数字）。 */
  Modules.home._recState = {};

  /* 编辑模式状态（会话内瞬时，不落库；进入编辑由 #homeEdit 按钮切换） */
  Modules.home._edit = false;
  Modules.home._sheet = false;
  /* 最近一次 render 的画布 id 序（编辑模式的物化基线；仅供编辑处理器读取） */
  Modules.home._canvasIds = null;
  /* 物化：把「没编辑过」的用户变成一份完整布局——基线 = 编辑画布当前 id 序
     （画布即用户在编辑模式里看到的样子，物化结果与所见一致，零惊吓），
     全部整排起步。此后增删/排序/改大小都在这份布局上做增量。 */
  Modules.home._ensureLayout = function () {
    var d = Storage.get();
    var hl = Modules.home._layoutNormalize(d.settings.homeLayout, UNIVERSE());
    if (hl) return hl;
    var ids = defaultLayout(d).items.map(function (it) { return it.id; });
    var items = []; var seen = {};
    ids.forEach(function (id) { if (!seen[id]) { seen[id] = 1; items.push({ id: id, size: defSize(id) }); } });
    /* 第 168 次：没上画布的磁贴模块记进 removed——否则 _layoutApply 的「新模块殿后」
       会把它们全部补到首页末尾（用户看到的就是：编辑一次，隐藏的模块全出来了）。 */
    var removed = UNIVERSE().filter(function (id) {
      return !seen[id] && LAST_DEFS_IDS.indexOf(id) < 0 && !CARDS_META[id];
    });
    return { items: items, removed: removed };
  };
  function withLayout(fn) {
    var hl = Modules.home._ensureLayout();
    fn(hl);
    var d = Storage.get();
    d.settings.homeLayout = (hl.items.length || hl.removed.length) ? hl : null;
    Storage.save();
    global.App.rerender();
  }
  /* 编辑处理器：每次变更立即落库（项目 C2「静默保存」惯例），随后重绘。
     处理器直接暴露给 QA——沙箱里 querySelector 是空壳，事件链测不到，
     与 _todayStats 同一先例：测的就是线上这段代码本身。 */
  Modules.home._editDel = function (id) { withLayout(function (hl) {
    hl.items = hl.items.filter(function (it) { return it.id !== id; });
    if (hl.removed.indexOf(id) < 0) hl.removed.push(id);
  }); };
  Modules.home._editAdd = function (id) { withLayout(function (hl) {
    hl.removed = hl.removed.filter(function (x) { return x !== id; });
    if (!hl.items.some(function (it) { return it.id === id; })) hl.items.push({ id: id, size: defSize(id) });
  }); };
  Modules.home._editSize = function (id) { withLayout(function (hl) {
    var it = null;
    hl.items.forEach(function (x) { if (x.id === id) it = x; });
    if (it) it.size = (it.size === 's') ? 'l' : 's';
    else hl.items.push({ id: id, size: 's' });
  }); };
  Modules.home._editOrder = function (ids) { withLayout(function (hl) {
    var pos = {};
    ids.forEach(function (id, i) { if (pos[id] === undefined) pos[id] = i; });
    var inHl = hl.items.filter(function (it) { return pos[it.id] !== undefined; });
    var rest = hl.items.filter(function (it) { return pos[it.id] === undefined; });
    inHl.sort(function (a, b) { return pos[a.id] - pos[b.id]; });
    hl.items = inHl.concat(rest);
  }); };
  Modules.home._editReset = function () {
    var d = Storage.get();
    d.settings.homeLayout = null;
    Modules.home._sheet = false;
    Storage.save();
    global.App.rerender();
  };

  /* 第 56 次（单条信息行）：今日概览数字卡迁往「日期记录」页。
     首页磁贴改成单列横条后，每条本身就直接显示今日摘要（喂养次数/睡眠最长
     连续/孕周进度），概览卡与磁贴完全重复；这里导出同一口径的今日数字速览，
     由 calendar.js 渲染在日历下方——单一来源：复用 pregnancyWeek / _longestMin。
     注意：必须在 Modules.home 对象字面量之后赋值（模块加载即执行）。 */
  Modules.home._todayStats = function (d) {
    var today = Util.todayISO();
    /* 第 131 次（P1-a）：今日计数走照护日口径（与首页磁贴同源），
        孕周/待产包等日历日语义仍用 today。 */
    var dayNow = Util.dayKeyOf(new Date(), Util.dayStartHour(d));
    var bd = (d.settings.baby && d.settings.baby.birthDate) || null;
    var wk = pregnancyWeek(d);
    var pk = (d.packing && d.packing.items) ? d.packing.items : [];
    var pkDone = pk.filter(function (x) { return x.checked; }).length;
    var pkPct = pk.length ? Math.round(pkDone / pk.length * 100) : 0;
    function cnt(arr, key) {
      return (arr || []).filter(function (x) { return Util.dayKeyOf(x[key], Util.dayStartHour(d)) === dayNow; }).length;
    }
    var sleepRecent = (d.sleeps || []).filter(function (s) { return s.end; })
      .sort(function (a, b) { return new Date(b.start) - new Date(a.start); })[0];
    var longestMin = (global.Modules && Modules.sleep && typeof Modules.sleep._longestMin === 'function')
      ? Modules.sleep._longestMin : function (s) {
          var w = (s.wakings == null) ? 0 : s.wakings;
          return Math.round((new Date(s.end) - new Date(s.start) - (s.pausedMs || 0)) / 60000 / (w + 1));
        };
    /* 第 128 次：与首页磁贴同一口径——昨夜整组取最长一段，不取 start 最新那一段 */
    var lastLongestH = lastNightLongestH(d);
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
    if (lastLongestH != null) stats.push({ num: lastLongestH.toFixed(1), lbl: '昨夜最长', unit: '小时' }); /* 第 274 次（审计 #29）：三等分格里「昨夜最长连续」折成两行、末行只剩「续」 */
    stats.push({ num: cnt(Util.babyFeeds(d.feedings), 'start'), lbl: '今日喂养', unit: '次' });
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
