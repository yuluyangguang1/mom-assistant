/**
 * settings.js - 设置（全局必备）
 * 导出/导入全部数据、清空数据、关于说明。
 */
(function (global) {
  'use strict';
  var Storage = global.Storage, Util = global.Util;
  var Modules = global.Modules = global.Modules || {};
  var Knowledge = global.Knowledge;

  /* ---- 第 71 次（C1）：就诊摘要构建器（纯函数，QA 直接消费） ----
     只做拼装呈现，不做任何解读与判断（红线：不诊断、不评分）；
     全部数据在本机拼装，无网络请求。摘要节次与「打印成长报告」互补。 */
  /* ---- 第 203 次：交接班摘要（纯函数）——白天换奶奶 / 晚上换爸爸带时，一段文字说清
     「上次吃 / 睡 / 换尿布是什么时候、近 12 小时多少、用过什么药」。只陈述记录，不做判断。 ---- */
  function buildHandoff(d) {
    var now = Date.now(), L = [];
    function t(x) { var dt = new Date(x); return isNaN(dt.getTime()) ? null : dt; }
    function hm(x) { return String(x || '').slice(11, 16); }
    function dur(ms) {
      var m = Math.max(0, Math.round(ms / 60000)), h = Math.floor(m / 60); m = m % 60;
      return h ? h + ' 小时' + (m ? ' ' + m + ' 分' : '') : m + ' 分钟';
    }
    function ago(x) { var dt = t(x); return dt ? dur(now - dt.getTime()) + '前' : ''; }
    function within(arr, key, hrs) {
      return (arr || []).filter(function (r) { var dt = r && t(r[key]); return dt && dt.getTime() <= now + 60000 && now - dt.getTime() <= hrs * 3600000; })
        .sort(function (a, b) { return t(b[key]) - t(a[key]); });
    }
    function ok(v) { return typeof v === 'number' && isFinite(v) && v > 0; }
    var baby = (d.settings && d.settings.baby) || {};
    L.push('【交接班】' + (baby.nickname ? String(baby.nickname).slice(0, 12) + ' · ' : '') + Util.nowLocal().slice(5, 16).replace('T', ' '));
    L.push('');
    /* 吃：不算吸奶 */
    var feeds = within(Util.babyFeeds ? Util.babyFeeds(d.feedings) : d.feedings, 'start', 12);
    var FT = { breast: '亲喂', bottle: '奶瓶', formula: '奶粉', solid: '辅食' };
    L.push('◆ 吃');
    if (feeds.length) {
      var f = feeds[0], det = [];
      if (f.type === 'breast') {
        if (ok(f.durationL)) det.push('左 ' + f.durationL + ' 分');
        if (ok(f.durationR)) det.push('右 ' + f.durationR + ' 分');
        if (!det.length && ok(f.durationMin)) det.push(f.durationMin + ' 分');
      } else if (f.type === 'solid') {
        /* 第 278 次（审计 #34）：辅食的量按它自己的单位（勺 / 碗 / 克），和辅食页 / 搜索同一个 _amtText；带上名称 */
        if (f.dish && String(f.dish).trim()) det.push(String(f.dish).trim().slice(0, 16));
        var sa = Modules.solid && Modules.solid._amtText ? Modules.solid._amtText(f) : (ok(f.amount) ? f.amount + ' 克' : '');
        if (sa) det.push(sa);
      } else if (ok(f.amount)) det.push(f.amount + ' ml');
      L.push('上次 ' + hm(f.start) + ' ' + (FT[f.type] || '') + (det.length ? ' ' + det.join(' ') : '') + '（' + ago(f.start) + '）');
      var ml = feeds.reduce(function (a, r) { return a + ((r.type === 'bottle' || r.type === 'formula') && ok(r.amount) ? r.amount : 0); }, 0);
      L.push('近 12 小时 ' + feeds.length + ' 次' + (ml ? '，瓶喂共 ' + ml + ' ml' : ''));
    } else L.push('近 12 小时没有记录');
    L.push('');
    /* 睡 */
    L.push('◆ 睡');
    var os = d.openSleep && t(d.openSleep.start);
    if (os) {
      var pz = (typeof d.openSleep.pausedMs === 'number' && d.openSleep.pausedMs > 0 ? d.openSleep.pausedMs : 0)
        + (d.openSleep.pauseStart && t(d.openSleep.pauseStart) ? now - t(d.openSleep.pauseStart).getTime() : 0);
      L.push('正在睡：' + hm(d.openSleep.start) + ' 睡着，已 ' + dur(now - os.getTime() - pz));
    }
    var sl = within(d.sleeps, 'end', 12).filter(function (r) { return t(r.start) && t(r.end) > t(r.start); });
    if (sl.length) {
      var s0 = sl[0];
      if (!os) L.push('上次 ' + hm(s0.end) + ' 醒（' + ago(s0.end) + '），那一觉 ' + dur(t(s0.end) - t(s0.start)));
      var tot = sl.reduce(function (a, r) { return a + (t(r.end) - t(r.start)); }, 0);
      L.push('近 12 小时睡了 ' + sl.length + ' 段，共 ' + dur(tot));
    } else if (!os) L.push('近 12 小时没有记录');
    L.push('');
    /* 尿布 */
    L.push('◆ 尿布');
    var dp = within(d.diapers, 'time', 12);
    var DT = { pee: '尿', poop: '便', both: '尿+便' };
    if (dp.length) {
      L.push('上次 ' + hm(dp[0].time) + ' ' + (DT[dp[0].type] || '') + '（' + ago(dp[0].time) + '）');
      var pee = dp.filter(function (r) { return r.type === 'pee' || r.type === 'both'; }).length;
      var poo = dp.filter(function (r) { return r.type === 'poop' || r.type === 'both'; }).length;
      L.push('近 12 小时 尿 ' + pee + ' 次，便 ' + poo + ' 次');
    } else L.push('近 12 小时没有记录');
    /* 用药 / 体温：近 24 小时有才出 */
    var md = within(d.meds, 'time', 24).filter(function (r) { return r.name; });
    if (md.length) {
      L.push(''); L.push('◆ 用药（近 24 小时）');
      md.forEach(function (r) { L.push(hm(r.time) + ' ' + String(r.name).slice(0, 20) + (r.dose ? ' ' + String(r.dose).slice(0, 20) : '')); });
    }
    var tp = within(d.temps, 'time', 24).filter(function (r) { return typeof r.value === 'number' && isFinite(r.value); });
    if (tp.length) {
      L.push(''); L.push('◆ 体温（近 24 小时）');
      L.push('最近 ' + tp[0].value + '°C（' + hm(tp[0].time) + '）' + (tp.length > 1 ? '，共量 ' + tp.length + ' 次' : ''));
    }
    /* 补剂：今天已打卡。第 278 次（审计 #34）：只列启用中的计划（active !== false；原来判断不存在的 p.paused，停用的也列成「未打卡」）；
       每天多次的按实际次数写「维生素D 1/2」（原来吃过一次就算「已吃」）；「今天」按照护日起点（dayKeyOf），和补剂页同一口径 */
    var DS = Util.dayStartHour ? Util.dayStartHour(d) : 0, dayNow = Util.dayKeyOf(new Date(), DS);
    var sup = (d.supplements || []).filter(function (r) { return r && r.name && Util.dayKeyOf(r.time, DS) === dayNow; });
    var plans = (d.supplementPlans || []).filter(function (p) { return p && p.name && p.active !== false; });
    if (sup.length || plans.length) {
      var usedR = [], doneL = [], todo = [];
      /* 第 280 次：今天不在服用日程里的计划（每周特定几天 / 隔天 / 还没开始 / 已结束）不列为未打卡；次数按今天的服用时间数 */
      var SUPM = global.Modules && Modules.supplement;
      plans.forEach(function (p) {
        if (SUPM && SUPM._onDay && !SUPM._onDay(p, dayNow)) return;
        var per = (SUPM && SUPM._norm) ? SUPM._norm(p).times.length : ((typeof p.perDay === 'number' && p.perDay > 0) ? p.perDay : 1);
        var hit = sup.filter(function (r) { return (r.planId && p.id) ? r.planId === p.id : r.name === p.name; });
        hit.forEach(function (r) { usedR.push(r); });
        var nm = String(p.name).slice(0, 12);
        if (!hit.length) todo.push(nm + (per > 1 ? ' 0/' + per : ''));
        else doneL.push(nm + (per > 1 ? ' ' + Math.min(hit.length, 99) + '/' + per : ''));
      });
      /* 计划外（或已停用计划）今天打过卡的：照实列出 */
      var extra = {};
      sup.forEach(function (r) { if (usedR.indexOf(r) < 0) { var k = String(r.name).slice(0, 12); extra[k] = (extra[k] || 0) + 1; } });
      Object.keys(extra).forEach(function (k) { doneL.push(k + (extra[k] > 1 ? ' ×' + extra[k] : '')); });
      L.push(''); L.push('◆ 营养品（今天）');
      L.push((doneL.length ? '已吃 ' + doneL.join('、') : '还没打卡') + (todo.length ? '；未打卡 ' + todo.join('、') : ''));
    }
    /* 储奶 */
    var st = (d.milkStash || []).filter(function (x) { return x && !x.usedAt && ok(x.amount) && (x.place === 'fridge' || x.place === 'freezer'); });
    if (st.length) {
      var fr = 0, fz = 0; st.forEach(function (x) { if (x.place === 'fridge') fr += x.amount; else fz += x.amount; });
      L.push(''); L.push('◆ 储奶  冷藏 ' + fr + ' ml，冷冻 ' + fz + ' ml');
    }
    return L.join('\n');
  }

  function buildVisitSummary(d) {
    var L = [];
    var baby = (d.settings && d.settings.baby) || {};
    L.push('【就诊摘要】咿呀记 · 生成于 ' + Util.nowLocal().slice(0, 16).replace('T', ' '));
    L.push('（由本机记录自动拼装，供问诊参考，不构成诊断；具体请遵医嘱。）');
    L.push('');
    L.push('◆ 宝宝信息');
    L.push('性别：' + (baby.sex === 'girl' ? '女' : (baby.sex === 'boy' ? '男' : '未设置'))
      + ' ｜ 出生日期：' + (baby.birthDate || '未设置')
      + (baby.preterm ? ' ｜ 早产（孕 ' + (baby.birthGestWeeks || '?') + ' 周，评估请用矫正月龄）' : ''));
    L.push('');
    /* 生长：最近 3 次 */
    var gr = (d.growth || []).slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
    L.push('◆ 生长记录（最近 3 次，共 ' + gr.length + ' 次）');
    if (gr.length) {
      gr.slice(0, 3).forEach(function (r) {
        L.push(r.date + '  体重 ' + (r.weightKg || '—') + 'kg  身长 ' + (r.heightCm || '—') + 'cm  头围 ' + (r.headCm || '—') + 'cm');
      });
    } else L.push('暂无记录');
    L.push('');
    /* 疫苗 */
    L.push('◆ 疫苗接种');
    if (baby.birthDate && Modules.vaccine && typeof Modules.vaccine._plan === 'function') {
      var plan = Modules.vaccine._plan(baby.birthDate);
      var vdone = (d.vaccines && d.vaccines.done) || {};
      var doneList = plan.filter(function (it) { return vdone[it.key]; });
      L.push('已完成 ' + doneList.length + '/' + plan.length + ' 剂');
      if (doneList.length) {
        L.push('最近接种：' + doneList.slice(-3).map(function (it) {
          return it.name + it.dose + '（' + vdone[it.key] + '）';
        }).join(' ／ '));
      }
    } else L.push('暂无排期信息（未设置生日）');
    L.push('');
    /* 儿保体检 */
    L.push('◆ 儿保体检');
    if (baby.birthDate && Modules.vaccine && typeof Modules.vaccine._planCheckups === 'function') {
      var ck = Modules.vaccine._planCheckups(baby.birthDate);
      var ckDoneMap = (d.checkups && d.checkups.done) || {};
      var ckDone = ck.filter(function (it) { return ckDoneMap[it.key]; });
      L.push('已完成 ' + ckDone.length + '/' + ck.length + ' 次'
        + (ckDone.length ? ('，最近一次：' + ckDone[ckDone.length - 1].name + '（' + ckDoneMap[ckDone[ckDone.length - 1].key] + '）') : ''));
    } else L.push('暂无');
    L.push('');
    /* 发育观察点：预警阳性按官方口径转诊提示；自评未出现给官方规则 */
    var obs = d.milestoneObs || [];
    var warnHit = [], obsNo = 0;
    if (Knowledge) {
      var obsTxt = {};
      Knowledge.MILESTONES.forEach(function (e) { obsTxt[e.id] = e.text; });
      obs.forEach(function (r) {
        if (!r || !obsTxt[r.id]) return;
        if (r.v === 1 && r.id.indexOf('KN-W-') === 0) warnHit.push(obsTxt[r.id]);
        else if (r.v === 0) obsNo++;
      });
    }
    L.push('◆ 发育观察点（家长自记）');
    L.push(warnHit.length
      ? ('预警征象阳性 ' + warnHit.length + ' 条：' + warnHit.join('；') + '（建议儿保科或儿童发育行为科就诊）')
      : '预警征象未见阳性标记');
    L.push('自评「还没出现」共 ' + obsNo + ' 项（1 项未出现建议咨询医生，2 项及以上建议到医疗机构检查——官方口径）');
    L.push('');
    /* 里程碑：最近 3 个 */
    var ms = (d.milestones || []).slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
    L.push('◆ 里程碑（最近 3 个，共 ' + ms.length + ' 个）');
    if (ms.length) ms.slice(0, 3).forEach(function (r) { L.push(r.date + '  ' + r.title); });
    else L.push('暂无记录');
    L.push('');
    /* 第 301 次：生病记录（最近 5 次，家长自记，只列事实） */
    var sk = (d.sicks || []).filter(function (r) { return r && typeof r.start === 'string'; }).slice().sort(function (a, b) { return b.start.localeCompare(a.start); });
    L.push('◆ 生病记录（最近 5 次，共 ' + sk.length + ' 次，家长自记）');
    if (sk.length) sk.slice(0, 5).forEach(function (r) {
      var jj = function (a) { return Array.isArray(a) ? a.filter(function (x) { return typeof x === 'string'; }).join('、') : ''; };
      L.push(r.start + (r.end ? ' 至 ' + r.end : ' 起') + '  ' + (jj(r.symptoms) || '生病') + (jj(r.meds) ? '；用药：' + jj(r.meds) : ''));
    });
    else L.push('暂无记录');
    L.push('');
    /* 近 7 天日常 */
    var cut7 = new Date(); cut7.setDate(cut7.getDate() - 7);
    function n7(arr, key) {
      return (arr || []).filter(function (r) { return r && r[key] && new Date(r[key]) >= cut7; }).length;
    }
    L.push('◆ 近 7 天日常');
    L.push('喂养 ' + n7(d.feedings, 'start') + ' 次 ｜ 睡眠 ' + n7(d.sleeps, 'start') + ' 段 ｜ 换尿布 ' + n7(d.diapers, 'time') + ' 次');
    L.push('');
    /* 第 198 次：体温 / 用药 / 黄疸 / 尿布异常——有记录才出节，医生问诊最常问的就是这几样。
       只罗列事实（最高、最近、次数），不写「发热」「偏高」之类的判读。枚举值一律查表，查不到不输出。 */
    function hm(t) { return String(t || '').slice(5, 16).replace('T', ' '); }
    function okNum(v) { return typeof v === 'number' && isFinite(v); }
    var T_SITE = { axillary: '腋下', ear: '耳温', forehead: '额温', rectal: '肛温' };
    var tp7 = (d.temps || []).filter(function (r) { return r && okNum(r.value) && r.time && new Date(r.time) >= cut7; })
      .sort(function (a, b) { return new Date(a.time) - new Date(b.time); });
    if (tp7.length) {
      var tMax = tp7.reduce(function (m, r) { return r.value > m.value ? r : m; }, tp7[0]);
      var tLast = tp7[tp7.length - 1];
      L.push('◆ 体温（近 7 天 ' + tp7.length + ' 次）');
      L.push('最高 ' + tMax.value + '°C（' + hm(tMax.time) + (T_SITE[tMax.site] ? ' ' + T_SITE[tMax.site] : '') + '）'
        + ' ｜ 最近 ' + tLast.value + '°C（' + hm(tLast.time) + (T_SITE[tLast.site] ? ' ' + T_SITE[tLast.site] : '') + '）');
      L.push('');
    }
    var md7 = (d.meds || []).filter(function (r) { return r && r.name && r.time && new Date(r.time) >= cut7; });
    if (md7.length) {
      var byName = {};
      md7.forEach(function (r) {
        var k = String(r.name).slice(0, 20);
        var b = byName[k] = byName[k] || { n: 0, last: r.time };
        b.n++; if (new Date(r.time) > new Date(b.last)) b.last = r.time;
      });
      L.push('◆ 用药（近 7 天，家长记录）');
      Object.keys(byName).forEach(function (k) { L.push(k + ' ' + byName[k].n + ' 次，最近 ' + hm(byName[k].last)); });
      L.push('');
    }
    var J_UNIT = { mgdl: 'mg/dL', umol: 'µmol/L' }, J_SITE = { forehead: '额头', cheek: '脸颊', chest: '胸口' };
    var ja = (d.jaundices || []).filter(function (r) { return r && okNum(r.value) && r.time && J_UNIT[r.unit] && !isNaN(new Date(r.time).getTime()); })
      .sort(function (a, b) { return new Date(b.time) - new Date(a.time); });
    if (ja.length) {
      L.push('◆ 经皮黄疸（最近 ' + Math.min(5, ja.length) + ' 次，共 ' + ja.length + ' 次）');
      ja.slice(0, 5).forEach(function (r) {
        L.push(hm(r.time) + '  ' + r.value + ' ' + J_UNIT[r.unit] + (J_SITE[r.site] ? '（' + J_SITE[r.site] + '）' : ''));
      });
      L.push('');
    }
    var D_COL = { black: '黑', red: '红', pale: '灰白' };
    var dp7 = (d.diapers || []).filter(function (r) { return r && r.time && new Date(r.time) >= cut7; });
    var wat7 = dp7.filter(function (r) { return r.consistency === 'watery'; }).length;
    var colHit = {}; dp7.forEach(function (r) { if (D_COL[r.color]) colHit[D_COL[r.color]] = (colHit[D_COL[r.color]] || 0) + 1; });
    var rash7 = dp7.filter(function (r) { return r.rash === true; }).length;
    if (wat7 || Object.keys(colHit).length || rash7) {
      L.push('◆ 大便与尿布（近 7 天，家长记录）');
      var dl = [];
      if (wat7) dl.push('稀水样 ' + wat7 + ' 次');
      Object.keys(colHit).forEach(function (c) { dl.push(c + '色便 ' + colHit[c] + ' 次'); });
      if (rash7) dl.push('红屁屁 ' + rash7 + ' 次');
      L.push(dl.join(' ｜ '));
      L.push('');
    }
    /* 妈妈情绪（近 14 天） */
    var cut14 = new Date(); cut14.setDate(cut14.getDate() - 14);
    var mood14 = (d.moods || []).filter(function (r) { return r && r.time && new Date(r.time) >= cut14; });
    var moodLow = mood14.filter(function (r) { return r.level && r.level <= 2; }).length;
    L.push('◆ 妈妈情绪（近 14 天自记 ' + mood14.length + ' 次' + (mood14.length ? ('，其中偏低 ' + moodLow + ' 次') : '') + '）');
    L.push('（情绪为本人自述，仅供问诊参考。）');
    L.push('');
    /* 经期（有记录才出） */
    var per = (d.periods || []).slice().sort(function (a, b) { return (b.start || '').localeCompare(a.start || ''); })[0];
    if (per && per.start) {
      L.push('◆ 经期（妈妈健康）');
      L.push('最近一次开始：' + per.start + (per.end ? ('，' + per.end + ' 结束') : '，进行中') + '（产后/哺乳期不规律属常见现象）');
      L.push('');
    }
    L.push('—— 以上数据来自本机记录，未经任何云端或第三方。');
    return L.join('\n');
  }

  /* ---- 第 83 次（C2）：数据分享照片卡片——把本机记录画成一张可保存/可分享的图片。
     纯本地、零依赖：不引 html2canvas，直接用原生 canvas 绘制（与 Util.pickPhoto 同一范式）。
     分两层：buildShareCardData 是纯函数（只拼文本与统计，QA 可直测）；renderShareCard
     才碰 canvas/document（仅浏览器内调用）。全部数据在本机绘制，照片与记录不出这台设备。 */
  function buildShareCardData(d) {
    d = d || {};
    var today = Util.todayISO();
    var now = new Date();
    var WD = ['日', '一', '二', '三', '四', '五', '六'];
    var weekday = '星期' + WD[now.getDay()];
    var festival = (typeof Util.festivalOf === 'function') ? Util.festivalOf(now) : null;
    var baby = (global.Storage && typeof Storage.activeBaby === 'function') ? Storage.activeBaby() : null;
    var babyName = (baby && baby.name) ? baby.name : '';
    var birthDate = (baby && baby.birthDate) || (d.settings && d.settings.baby && d.settings.baby.birthDate) || null;
    var photoDataURL = (baby && baby.photo) || null;
    var preterm = !!(d.settings && d.settings.baby && d.settings.baby.preterm);
    var ageText = '—';
    if (birthDate) {
      var days = Util.daysBetween(birthDate, today);
      if (days < 0) ageText = '还没出生';
      else if (days === 0) ageText = '出生第 1 天';
      else {
        var months = Math.floor(days / 30.44);
        if (months >= 12) {
          var yrs = Math.floor(months / 12);
          var rm = months % 12;
          ageText = yrs + ' 岁' + (rm ? (' ' + rm + ' 个月') : '');
        } else if (months > 0) {
          var remDays = Math.round(days - months * 30.44);
          ageText = months + ' 个月' + (remDays > 0 ? (' ' + remDays + ' 天') : '');
        } else {
          ageText = days + ' 天';
        }
      }
    }
    function cnt(arr, key) {
      return (arr || []).filter(function (r) {
        return r && r[key] && String(r[key]).indexOf(today) === 0;
      }).length;
    }
    return {
      dateText: (now.getMonth() + 1) + '月' + now.getDate() + '日',
      weekday: weekday,
      festival: festival,
      babyName: babyName,
      hasBaby: !!baby,
      ageText: ageText,
      preterm: preterm,
      hasPhoto: !!photoDataURL,
      photoDataURL: photoDataURL,
      feeding: cnt(d.feedings, 'start'),
      diaper: cnt(d.diapers, 'time'),
      sleep: cnt(d.sleeps, 'start')
    };
  }

  /* 浏览器内才调用：原生 canvas 画一张 1080×1440（3:4）分享卡片，
     绘完回调 { ok, dataURL, blob, data }。照片异步加载，故回调可能在异步后触发。 */
  function renderShareCard(d, cb) {
    cb = cb || function () {};
    try {
      if (!global.document || !document.createElement) { cb({ ok: false, error: 'no-document' }); return; }
      var data = buildShareCardData(d);
      var W = 1080, H = 1440;
      var cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      var ctx = cv.getContext('2d');
      if (!ctx) { cb({ ok: false, error: 'no-context', data: data }); return; }

      var FONT = 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';

      function rr(x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
      }

      /* 背景：奶油 → 柔青渐变 */
      var g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#FFF7EF');
      g.addColorStop(1, '#E7F2EE');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      /* 顶栏：品牌（左） + 日期（右） */
      ctx.fillStyle = '#3E9B92';
      ctx.beginPath(); ctx.arc(74, 84, 17, 0, Math.PI * 2); ctx.fill();
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#2F2A26';
      ctx.font = '600 36px ' + FONT;
      ctx.textAlign = 'left';
      ctx.fillText('咿呀记', 106, 84);
      ctx.fillStyle = '#7A726B';
      ctx.font = '500 34px ' + FONT;
      ctx.textAlign = 'right';
      ctx.fillText(data.dateText, W - 74, 84);
      ctx.textAlign = 'left';

      var cx = W / 2, cy = 430, R = 195;

      function drawPhotoCircle(img) {
        ctx.save();
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.closePath();
        ctx.fillStyle = '#FFFFFF';
        ctx.shadowColor = 'rgba(62,155,146,0.20)';
        ctx.shadowBlur = 44;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.clip();
        if (img) {
          var side = Math.min(img.width, img.height);
          var sx = (img.width - side) / 2, sy = (img.height - side) / 2;
          ctx.drawImage(img, sx, sy, side, side, cx - R, cy - R, R * 2, R * 2);
        } else {
          ctx.fillStyle = '#F1EBE3';
          ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
          ctx.fillStyle = '#3E9B92';
          ctx.font = '700 150px ' + FONT;
          ctx.textAlign = 'center';
          ctx.fillText((data.babyName || '宝').charAt(0), cx, cy + 12);
          ctx.textAlign = 'left';
        }
        ctx.restore();
      }

      function drawRest() {
        /* 宝宝名 + 月龄 */
        ctx.textAlign = 'center';
        ctx.fillStyle = '#2F2A26';
        ctx.font = '700 62px ' + FONT;
        ctx.fillText(data.babyName || '宝宝', cx, cy + R + 74);
        ctx.fillStyle = '#7A726B';
        ctx.font = '500 38px ' + FONT;
        ctx.fillText('宝宝 · ' + data.ageText + (data.preterm ? ' · 早产' : ''), cx, cy + R + 130);
        ctx.textAlign = 'left';

        /* 今日三统计丸 */
        var pills = [
          { label: '今日喂养', value: data.feeding + ' 次' },
          { label: '今日尿布', value: data.diaper + ' 次' },
          { label: '今日睡眠', value: data.sleep + ' 段' }
        ];
        var pillW = 282, pillH = 172, gap = 28;
        var startX = (W - (pillW * 3 + gap * 2)) / 2;
        var py = cy + R + 196;
        pills.forEach(function (p, i) {
          var px = startX + i * (pillW + gap);
          ctx.fillStyle = '#FFFFFF';
          rr(px, py, pillW, pillH, 36); ctx.fill();
          ctx.fillStyle = '#3E9B92';
          ctx.font = '700 62px ' + FONT;
          ctx.textAlign = 'center';
          ctx.fillText(p.value, px + pillW / 2, py + 80);
          ctx.fillStyle = '#8A827B';
          ctx.font = '500 30px ' + FONT;
          ctx.fillText(p.label, px + pillW / 2, py + 132);
        });
        ctx.textAlign = 'left';

        /* 大日期 + 节日 */
        var dy = py + pillH + 132;
        ctx.textAlign = 'center';
        ctx.fillStyle = '#2F2A26';
        ctx.font = '700 74px ' + FONT;
        ctx.fillText(data.dateText + ' ' + data.weekday, cx, dy);
        if (data.festival) {
          ctx.fillStyle = '#E8917F';
          ctx.font = '600 46px ' + FONT;
          ctx.fillText('· ' + data.festival + ' ·', cx, dy + 84);
        }
        ctx.textAlign = 'left';

        /* 页脚品牌落款 */
        ctx.fillStyle = '#A89F97';
        ctx.font = '500 30px ' + FONT;
        ctx.textAlign = 'center';
        ctx.fillText('本地记录 · 数据不出本机', cx, H - 86);
        ctx.textAlign = 'left';

        var dataURL = cv.toDataURL('image/png');
        if (cv.toBlob) {
          cv.toBlob(function (blob) {
            cb({ ok: true, dataURL: dataURL, blob: blob, data: data });
          }, 'image/png');
        } else {
          cb({ ok: true, dataURL: dataURL, blob: null, data: data });
        }
      }

      if (data.hasPhoto && data.photoDataURL) {
        var img = new Image();
        img.onload = function () { drawPhotoCircle(img); drawRest(); };
        img.onerror = function () { drawPhotoCircle(null); drawRest(); };
        img.src = data.photoDataURL;
      } else {
        drawPhotoCircle(null);
        drawRest();
      }
    } catch (e) {
      cb({ ok: false, error: String(e && e.message ? e.message : e) });
    }
  }

  /* 浏览器内：把图片下载到本机（相册/下载目录）。优先用 blob，不可用时回落 dataURL。 */
  function savePngBlob(blob, dataURL, name) {
    var url = blob ? URL.createObjectURL(blob) : dataURL;
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    if (blob) setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) {} }, 1000);
  }

  /* 浏览器内：优先系统分享（图片文件），无能力则回落保存。 */
  function sharePngBlob(blob, dataURL, name) {
    try {
      var file = (blob) ? new File([blob], name, { type: 'image/png' }) : null;
      if (global.navigator && file && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: '宝宝的今天', text: '今天的小记录' }).catch(function () {
          savePngBlob(blob, dataURL, name);
        });
      } else if (global.navigator && typeof navigator.share === 'function') {
        navigator.share({ title: '宝宝的今天', text: '今天的小记录' }).catch(function () {
          savePngBlob(blob, dataURL, name);
        });
      } else {
        savePngBlob(blob, dataURL, name);
        if (Util.toast) Util.toast('当前环境不支持直接分享，已为你保存为图片', 'info');
      }
    } catch (e) {
      savePngBlob(blob, dataURL, name);
    }
  }

  /* 浏览器内：分享卡片预览弹层（图片 + 分享/保存）。 */
  function openShareCardPreview(root, res) {
    var name = '咿呀记分享卡片_' + Util.todayISO() + '.png';
    root.innerHTML =
      '<div class="modal-mask" data-sc-mask>' +
        '<div class="modal share-card-modal" role="dialog" aria-modal="true" aria-label="分享卡片预览">' +
          '<h2>分享卡片</h2>' +
          '<div class="share-card-preview"><img src="' + res.dataURL + '" alt="分享卡片预览"></div>' +
          '<p class="hint">这是一张由本机生成的图片：可直接分享给家人，或存到相册。照片与记录不会上传任何服务器。</p>' +
          '<div class="modal-actions">' +
            '<button type="button" class="btn" data-sc-save>保存图片</button>' +
            '<button type="button" class="btn btn-primary" data-sc-share>分享</button>' +
          '</div>' +
          '<button type="button" class="btn btn-mini" data-sc-close style="width:100%;margin-top:8px">关闭</button>' +
        '</div></div>';
    var mask = root.querySelector('[data-sc-mask]');
    if (mask) mask.addEventListener('click', function (e) { if (e.target === mask) root.innerHTML = ''; });
    var closeBtn = root.querySelector('[data-sc-close]');
    if (closeBtn) closeBtn.addEventListener('click', function () { root.innerHTML = ''; });
    var saveBtn = root.querySelector('[data-sc-save]');
    if (saveBtn) saveBtn.addEventListener('click', function () {
      savePngBlob(res.blob, res.dataURL, name);
      if (Util.toast) Util.toast('已保存为图片，可到相册/下载查看', 'ok');
    });
    var shareBtn = root.querySelector('[data-sc-share]');
    if (shareBtn) shareBtn.addEventListener('click', function () {
      sharePngBlob(res.blob, res.dataURL, name);
    });
  }

  var _sgCur = null, _sgY = 0; /* 第 182 次：当前打开的设置分组（跨 silent 重绘保持） */
  /* ============================================================
     第 212 次：宝宝资料表单（添加 / 编辑共用）
     名字、小名、性别、生日（公历 / 农历）。小名设了之后首页、切换面板都显示小名。
     ============================================================ */
  function openBabyForm(id) {
    var root = document.getElementById('modalRoot');
    if (!root) return;
    var st = Storage.get();
    var isAct = id && id === st.settings.activeBabyId;
    var b = id ? ((st.babies || []).filter(function (x) { return x.id === id; })[0] || null) : null;
    if (id && !b) return;
    var sb = isAct ? (st.settings.baby || {}) : {};
    var cur = {
      name: b && b.name !== '宝宝' ? b.name : '',
      nickname: (b && b.nickname) || sb.nickname || '',
      sex: (b && b.sex) || sb.sex || null,
      birthDate: (b && b.birthDate) || null,
      birthLunar: (b && b.birthLunar) || sb.birthLunar || null,
      photo: null
    };
    function sexBtn(v, t) { return '<button type="button" class="seg-btn' + (cur.sex === v ? ' active' : '') + '" data-bf-sex="' + v + '">' + t + '</button>'; }
    root.innerHTML = '<div class="modal-mask" data-nb-mask><div class="modal baby-form" role="dialog" aria-modal="true" aria-labelledby="nbTitle">'
      + '<h2 id="nbTitle">' + (b ? '宝宝资料' : '添加宝宝') + '</h2>'
      + '<label>小名<input type="text" id="nbNick" maxlength="12" placeholder="比如：小汤圆（首页显示这个）" value="' + Util.escapeHtml(cur.nickname) + '"></label>'
      + '<label>大名（可留空）<input type="text" id="nbName" maxlength="12" placeholder="比如：林一一" value="' + Util.escapeHtml(cur.name) + '"></label>'
      + '<span class="lbl-text">性别</span><div class="seg" id="nbSex">' + sexBtn('boy', '男宝') + sexBtn('girl', '女宝') + sexBtn('', '不设置') + '</div>'
      + Util.birthInput({ id: 'nbBirth', title: '生日（可先不填）', value: cur.birthDate || '', lunar: cur.birthLunar })
      + (b ? '' : '<button type="button" class="btn" id="nbPhoto" style="width:100%;margin-right:0">选一张照片（可跳过）</button>'
        + '<p class="hint">照片在本机压缩到 288px 后保存，不会离开这台设备。</p>')
      + '<div class="modal-actions"><button type="button" class="btn" data-nb-cancel>取消</button>'
      + '<button type="button" class="btn btn-primary" data-nb-ok>' + (b ? '保存' : '添加') + '</button></div>'
      + '</div></div>';
    var mask = root.querySelector('[data-nb-mask]');
    function close() { root.innerHTML = ''; }
    Array.prototype.forEach.call(root.querySelectorAll('[data-bf-sex]'), function (x) {
      x.addEventListener('click', function () {
        cur.sex = x.getAttribute('data-bf-sex') || null;
        Array.prototype.forEach.call(root.querySelectorAll('[data-bf-sex]'), function (y) { y.classList.toggle('active', y === x); });
      });
    });
    var nbPhoto = root.querySelector('#nbPhoto');
    if (nbPhoto) nbPhoto.addEventListener('click', function () {
      Util.pickPhoto(function (dataURL) { if (!dataURL) return; cur.photo = dataURL; nbPhoto.textContent = '已选好照片 ✓'; });
    });
    root.querySelector('[data-nb-cancel]').addEventListener('click', close);
    mask.addEventListener('click', function (e) { if (e.target === mask) close(); });
    root.querySelector('[data-nb-ok]').addEventListener('click', function () {
      var f = {
        name: root.querySelector('#nbName').value.trim(),
        nickname: root.querySelector('#nbNick').value.trim(),
        sex: cur.sex,
        birthDate: root.querySelector('#nbBirth').value || null,
        birthLunar: Util.birthLunarOf('nbBirth')
      };
      if (!f.name && f.nickname) f.name = f.nickname;
      close();
      if (b) {
        Storage.updateBaby(b.id, f);
      } else {
        f.photo = cur.photo;
        Storage.addBaby(f);
      }
      if (global.App.refreshHeaderAvatar) global.App.refreshHeaderAvatar();
      global.App.rerender();
      Util.toast(b ? '已保存' : '已添加并切换到「' + (f.nickname || f.name || '宝宝') + '」', 'ok');
    });
    try { root.querySelector('#nbNick').focus(); } catch (e) {}
  }

      /* ---- CSV 导出（Excel/WPS 可读，带 BOM） ---- */
      /* 第 273 次：转义（含回车）、BOM、CRLF 统一走 Util.toCsv，和记账页同一份 */
      function toCsv(header, rows) { return Util.toCsv(header, rows); }
      var FEED_T = { breast: '母乳', bottle: '奶瓶', formula: '配方奶', pump: '泵奶', solid: '辅食' };
      var SIDE_T = { left: '左', right: '右', both: '双侧' };
      var DIAPER_T = { pee: '尿', poop: '便', both: '尿+便' };
      var CSV_BUILDERS = {
        feedings: function (d) {
          /* 第 278 次（审计 #33）：量与单位分两列——辅食按勺 / 碗记的量存在 unit + qty 里（amount 为空），原来这一列空着；
             辅食名称（dish）单独一列 */
          var SU = { g: '克', spoon: '勺', bowl: '碗' };
          var posN = function (v) { var n = Number(v); return isFinite(n) && n > 0 ? n : null; };
          return toCsv(['开始时间', '类型', '侧别', '时长(分)', '量', '单位', '名称', '备注'],
            (d.feedings || []).map(function (r) {
              var q = '', u = '';
              if (r.type === 'solid') {
                if (SU[r.unit] && posN(r.qty)) { q = posN(r.qty); u = SU[r.unit]; }
                else if (posN(r.amount)) { q = posN(r.amount); u = '克'; }
              } else if (posN(r.amount)) { q = posN(r.amount); u = 'ml'; }
              return [r.start, FEED_T[r.type] || r.type, SIDE_T[r.side] || '', r.durationMin || '', q, u, r.type === 'solid' && r.dish ? String(r.dish).trim() : '', r.note]; /* 第 273 次：原来读不存在的 r.duration，时长一列全空 */
            }));
        },
        sleeps: function (d) {
          return toCsv(['开始', '结束', '时长'], (d.sleeps || []).map(function (r) {
            return [r.start, r.end || '', r.end ? Util.fmtDuration(new Date(r.end) - new Date(r.start) - (r.pausedMs || 0)) : ''];
          }));
        },
        diapers: function (d) {
          return toCsv(['时间', '类型', '备注'], (d.diapers || []).map(function (r) {
            return [r.time, DIAPER_T[r.type] || r.type, r.note];
          }));
        },
        meds: function (d) {
          return toCsv(['时间', '名称', '备注'], (d.meds || []).map(function (r) { return [r.time, r.name, r.note]; }));
        },
        growth: function (d) {
          return toCsv(['日期', '体重(kg)', '身长(cm)', '头围(cm)'], (d.growth || []).map(function (r) {
            return [r.date, r.weightKg, r.heightCm, r.headCm];
          }));
        },
        sicks: function (d) {
          var VT = { home: '没去医院', clinic: '门诊', er: '急诊', hospital: '住院' };
          var j = function (a) { return Array.isArray(a) ? a.filter(function (x) { return typeof x === 'string'; }).join('、') : ''; };
          return toCsv(['开始日期', '好转日期', '症状', '原因', '用药', '就医', '医院', '花费(元)', '备注'], (d.sicks || []).filter(function (r) { return r && r.start; }).map(function (r) {
            return [r.start, r.end || '', j(r.symptoms), j(r.causes), j(r.meds), VT[r.visit] || '', r.place || '', typeof r.cost === 'number' ? r.cost : '', r.note || ''];
          }));
        },
        milestones: function (d) {
          return toCsv(['日期', '里程碑', '备注'], (d.milestones || []).map(function (r) { return [r.date, r.title, r.note]; }));
        },
        vaccines: function (d) {
          var rows = [];
          var plan = (global.Modules && Modules.vaccine && typeof Modules.vaccine._plan === 'function'
            && d.settings.baby && d.settings.baby.birthDate) ? Modules.vaccine._plan(d.settings.baby.birthDate) : [];
          var done = (d.vaccines && d.vaccines.done) || {};
          plan.forEach(function (it) { rows.push([it.name + it.dose, it.dueISO, done[it.key] || '未接种']); });
          return toCsv(['疫苗剂次', '应种日期', '接种日期'], rows);
        },
        contractions: function (d) {
          return toCsv(['开始', '结束'], (d.contractions || []).map(function (r) { return [r.start, r.end || '']; }));
        },
        periods: function (d) {
          return toCsv(['开始', '结束'], (d.periods || []).map(function (r) { return [r.start, r.end || '']; }));
        },
        /* 第 280 次：营养品服用记录（时间、名称、用量、对应的服用时间、备注） */
        supplements: function (d) {
          return toCsv(['时间', '名称', '用量', '服用时间', '备注'], (d.supplements || []).filter(function (r) { return r && r.time; })
            .slice().sort(function (a, b) { return String(a.time) < String(b.time) ? -1 : 1; })
            .map(function (r) { return [r.time, r.name || '', r.dose || '', typeof r.slot === 'string' ? r.slot : '', r.note]; }));
        },
        finance: function (d) {
          var recs = (d.finance && d.finance.records) || [];
          return toCsv(['日期', '类目', '金额', '备注'], recs.map(function (r) { return [r.date, r.category, r.amount, r.note]; }));
        }
      };
      /* 第 286 次：CSV 导出搬到模块作用域，设置页和「数据管理」半屏共用一份 */
      function csvExport(key) {
        if (!CSV_BUILDERS[key]) return false;
        var csv = CSV_BUILDERS[key](Storage.get());
        var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = '咿呀记_' + key + '_' + Util.todayISO() + '.csv';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
        Util.toast('CSV 已导出', 'ok');
        return true;
      }

  Modules.settings = {
    _csv: function (key) { return csvExport(key); },
    _babyForm: function (id) { openBabyForm(id); },
    id: 'settings',
    title: '设置',
    render: function (view) {
      var s = Storage.get();
      var html = '';
      html += '<div class="page-head"><h1>设置</h1></div>';
      /* ============================================================
         第 333 次：设置页重做（用户 2026-10-28：删减 / 强化 / 更多自定义；做减法，点选预设少手输）。
         一级 = 几组 iOS 原生式分组列表（图标 · 名称 · 一行现状 · ›），点一行横推进三级页（沿用第 182 次的 <details> + App.enterSub）；
         「在哪看到就在哪改，设置页只是第二个入口」：首页卡片和首页编辑改同一份 homeLayout，我的快记和首页快记卡 / 「＋」面板改同一份 quickItems。
         分组：① 宝宝与我 · 家庭共享　② 我的快记 · 首页卡片　③ 外观 · 天气与农历 · 记录与提醒（+ 保存时轻震 开关）
               ④ 导入与导出 · 给家人和医生 · 数据与隐私　⑤ 知识来源　页脚：关于与免责声明。
         删掉的（别处有入口或已无作用）：全部功能入口（菜单面板里有）、数据管理按钮（导入导出直接在这一页）、给当前宝宝换照片（宝宝行里有）、
         字号样张、天空时刻预览（走查用）、记录成本自测（验收用）、升级前快照说明、告别卡（三个按钮都是重复入口）、过时的「不提供家人共享」能力边界、
         各处说明性长段落（每处只留一句）。两个玻璃折射开关合成一个。
         ============================================================ */
      function sgOpen(iconKey, title, desc, acc) {
        return '<details class="set-group"' + (acc ? ' data-accent="' + acc + '"' : '') + '><summary>'
          + '<span class="sg-ico">' + icon(iconKey) + '</span>'
          + '<span class="sg-txt"><b>' + title + '</b><i>' + Util.escapeHtml(desc) + '</i></span>'
          + '<span class="sg-chv" aria-hidden="true">' + icon('chevron-right') + '</span>'
          + '</summary>';
      }
      function sec(cap) { return '<div class="sg-sec">' + (cap ? '<p class="sg-cap">' + cap + '</p>' : ''); }
      function sw(id, label, on, sub) {
        return '<div class="st-row row-switch"><label for="' + id + '">' + label + (sub ? '<small>' + sub + '</small>' : '') + '</label>'
          + '<input type="checkbox" id="' + id + '"' + (on ? ' checked' : '') + '></div>';
      }
      function card(cap, inner, foot) {
        return (cap ? '<p class="st-cap">' + cap + '</p>' : '') + '<div class="card st-card">' + inner + '</div>' + (foot ? '<p class="st-foot">' + foot + '</p>' : '');
      }
      var babies = s.babies || [];
      var actId = s.settings.activeBabyId;
      var actB = babies.filter(function (b) { return b.id === actId; })[0];
      var effStage = (global.App && typeof App.stageOf === 'function') ? App.stageOf(s) : ((((s.pregnancy || {}).lmp) ? 'pregnancy' : 'baby'));
      var famOn = !!(global.FamSync && FamSync.joined && FamSync.joined());
      var famN = famOn && FamSync.state && FamSync.state() ? Object.keys(FamSync.state().members || {}).length : 0;
      var qn = global.QuickRec ? QuickRec.rawItems(s).length : 0;
      var hcat = (global.Modules && Modules.home && Modules.home._catalog) ? Modules.home._catalog() : [];
      var hOn = hcat.filter(function (c) { return c.on; }).length;
      var MODES = [['time', '跟随时间'], ['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']];
      var curMode = (s.settings.themeMode) || ((s.settings.themeAuto !== false) ? 'time' : (s.settings.theme === 'dark' ? 'dark' : 'light'));
      var FSCALES = [['normal', '标准'], ['lg', '大'], ['xl', '特大']];
      var curFs = (global.App && global.App.fontScale) ? global.App.fontScale() : (s.settings.fontScale || 'normal');
      if (FSCALES.map(function (m) { return m[0]; }).indexOf(curFs) < 0) curFs = 'normal';
      var modeName = (MODES.filter(function (m) { return m[0] === curMode; })[0] || MODES[0])[1];
      var fsName = (FSCALES.filter(function (m) { return m[0] === curFs; })[0] || FSCALES[0])[1];
      var wxc = s.settings.weather || { on: false, mode: 'auto', city: null };
      var curDs = String(Util.dayStartHour(s));
      var last = s.settings.lastExportISO;

      /* ── ① 宝宝与我 · 家庭共享 ── */
      html += sec('');
      html += sgOpen('baby', '宝宝与我', actB ? (Storage.babyLabel(actB) + (babies.length > 1 ? ' · ' + babies.length + ' 个宝宝' : '') + ' · ' + (effStage === 'pregnancy' ? '孕期' : '育儿')) : '还没有宝宝档案', 'growth');
      var bl = '';
      if (babies.length) {
        bl += '<ul class="list baby-list st-list" id="sBabyList">';
        babies.forEach(function (b) {
          var isAct = b.id === actId;
          var ava = b.photo ? ('<img class="baby-ava" src="' + Util.escapeHtml(b.photo) + '" alt="">')
            : '<span class="baby-ava baby-ava-fallback">' + icon('pregnancy') + '</span>';
          var sub = b.birthDate ? ('生日 ' + b.birthDate + (b.birthLunar && global.Lunar ? '（农历' + Lunar.monthName(b.birthLunar.m, b.birthLunar.leap) + Lunar.dayName(b.birthLunar.d) + '）' : '')) : '未设置生日';
          var lbl = Storage.babyLabel ? Storage.babyLabel(b) : b.name;
          if (lbl !== b.name && b.name && b.name !== '宝宝') sub = b.name + ' · ' + sub;
          bl += '<li data-baby-id="' + Util.escapeHtml(b.id) + '" role="button" tabindex="0"' + (isAct ? ' data-baby-active="1"' : '') + '>'
            + ava + '<span class="li-main"><b>' + Util.escapeHtml(lbl) + (isAct ? '<span class="baby-badge">当前</span>' : '') + '</b>'
            + '<i class="baby-sub">' + Util.escapeHtml(sub) + '</i></span>'
            + '<span class="baby-ops">'
            + '<button type="button" class="btn-mini" data-baby-rename="' + Util.escapeHtml(b.id) + '">资料</button>'
            + '<button type="button" class="btn-mini" data-baby-photo="' + Util.escapeHtml(b.id) + '">照片</button>'
            + '<button type="button" class="btn-mini" data-baby-del="' + Util.escapeHtml(b.id) + '">删除</button>'
            + '</span></li>';
        });
        bl += '</ul>';
      }
      bl += '<button class="st-act" id="sBabyAdd" type="button">' + icon('plus') + '添加宝宝</button>';
      html += card('宝宝', bl, '点宝宝那一行就切换。记录按宝宝分开存；经期、孕期、心情、记账是妈妈自己的。');
      var cgRole = (s.settings.caregiver && s.settings.caregiver.role) || '';
      var CARE_ROLES = [['', '不设置'], ['mom', '妈妈'], ['dad', '爸爸'], ['other', '其他照护者']];
      html += card('我', '<label class="st-field">首页怎么称呼我<input type="text" id="sCareName" maxlength="12" placeholder="比如：妈妈、豆豆妈、奶奶" value="'
        + Util.escapeHtml((s.settings.caregiver && s.settings.caregiver.name) || '') + '"></label>'
        + '<div class="seg seg-lg" id="sCareRole" role="group" aria-label="我是">' + CARE_ROLES.map(function (p) {
          return '<button type="button" class="seg-btn' + (cgRole === p[0] ? ' active' : '') + '" data-role="' + p[0] + '">' + p[1] + '</button>';
        }).join('') + '</div>'
        + '<span class="lbl-text">现在处于</span><div class="seg seg-wrap2" id="sStageSeg">'
        + '<button type="button" class="seg-btn' + (effStage === 'pregnancy' ? ' active' : '') + '" data-stage-set="pregnancy">孕期中</button>'
        + '<button type="button" class="seg-btn' + (effStage === 'baby' ? ' active' : '') + '" data-stage-set="baby">宝宝已出生</button></div>',
        '阶段平时由预产期 / 宝宝生日自动判断，这里可以改。');
      html += '<button class="st-link" id="sReOnboard" type="button">重新走一遍首次引导</button>';
      html += '</details>';
      /* 第 332 次：家庭共享（js/famui.js 渲染进 #famBox），功能不变，挪到宝宝下面 */
      html += sgOpen('family', '家庭共享', famOn ? '已开启' + (famN ? ' · ' + famN + ' 台设备' : '') : '和家人一起记', 'mood');
      html += '<div id="famBox" class="fam-box"></div>';
      html += '</details>';
      html += '</div>';

      /* ── ② 我的快记 · 首页卡片 ── */
      html += sec('首页');
      html += sgOpen('plus', '我的快记', qn ? qn + ' 个' : '还没有快记', 'feeding');
      html += '<div class="qe-box" id="sQuickBox"></div>';
      html += '</details>';
      html += sgOpen('grid', '首页卡片', hOn + ' 张', 'diaper');
      ['快捷记录', '上次', '今日', '趋势', '距上次', '功能入口'].forEach(function (gname) {
        var rows = hcat.filter(function (c) { return c.group === gname; });
        if (!rows.length) return;
        html += '<p class="st-cap">' + gname + '</p><div class="card st-card hc-card"><ul class="hc-list">';
        rows.forEach(function (c) {
          html += '<li class="hc-row row-switch" data-accent="' + c.accent + '"><span class="hc-ico">' + icon(c.icon) + '</span>'
            + '<label class="hc-name" for="hc_' + c.id + '">' + Util.escapeHtml(c.name) + '</label>'
            + '<input type="checkbox" id="hc_' + c.id + '" data-hc="' + c.id + '"' + (c.on ? ' checked' : '') + '></li>';
        });
        html += '</ul></div>';
      });
      html += '<p class="st-foot">打开就加到首页末尾；排序和大小在首页「编辑首页」里调。</p>';
      html += '<button class="st-link" id="sHomeReset" type="button">恢复默认首页</button>';
      html += '</details>';
      html += '</div>';

      /* ── ③ 外观 · 天气与农历 · 记录与提醒 · 轻震 ── */
      html += sec('使用');
      html += sgOpen('image', '外观', modeName + ' · 字号' + fsName, 'sun');
      html += card('主题', '<div class="theme-cards" id="sThemeSeg">' + MODES.map(function (m) {
        var act = (curMode === m[0]);
        return '<button type="button" class="theme-card theme-card--' + m[0] + (act ? ' active' : '') + '" data-theme-mode="' + m[0] + '" aria-pressed="' + (act ? 'true' : 'false') + '">'
          + '<span class="tc-view"><i class="tc-chip"></i><i class="tc-chip"></i><i class="tc-chip"></i><i class="tc-bar"></i><i class="tc-line"></i></span>'
          + '<span class="tc-name">' + m[1] + '</span></button>';
      }).join('') + '</div>', '「跟随时间」：22 点到 6 点自动深色。');
      html += card('字号', '<div class="seg font-seg" id="sFontSeg">' + FSCALES.map(function (m) {
        return '<button type="button" class="seg-btn' + (curFs === m[0] ? ' active' : '') + '" data-font-scale="' + m[0] + '">' + m[1] + '</button>';
      }).join('') + '</div>', '');
      var hcOn = (global.App && typeof global.App.hcMode === 'function') ? global.App.hcMode() : false;
      var glassOn = s.settings.realRefraction !== false && s.settings.dockGlass !== 'off';
      html += card('', sw('sHcMode', '高对比', hcOn, '卡片描边更明显，浅色底更亮')
        + sw('sDockGlass', '液态玻璃折射', glassOn, '手机卡顿或费电时可以关掉'), '');
      var SLOT_OPTS = [['', '不显示'], ['feeding', '喂养'], ['diaper', '尿布'], ['sleep', '睡眠'], ['contraction', '宫缩'], ['fetal', '胎动'], ['temp', '体温'], ['mood', '妈妈情绪']];
      var curSlot = (s.settings.dockSlot != null) ? String(s.settings.dockSlot) : '';
      html += card('底栏快捷入口', '<div class="seg seg-wrap2" id="sDockSlotSeg">' + SLOT_OPTS.map(function (m) {
        return '<button type="button" class="seg-btn' + (curSlot === m[0] ? ' active' : '') + '" data-dock-slot="' + m[0] + '">' + m[1] + '</button>';
      }).join('') + '</div>', '在底栏页签右边多一个直达入口。');
      html += '</details>';

      html += sgOpen('sun', '天气与农历', (wxc.on ? '天气开' : '天气关') + ' · ' + (s.settings.lunarDate !== false ? '农历开' : '农历关'), 'temp');
      var wxIn = sw('sWxOn', '首页显示真实天气', wxc.on, '唯一会联网的功能；只发大致位置');
      if (wxc.on) {
        wxIn += '<div class="st-pad"><div class="seg" id="sWxMode">'
          + '<button type="button" class="seg-btn' + (wxc.mode !== 'city' ? ' active' : '') + '" data-wx-mode="auto">自动定位</button>'
          + '<button type="button" class="seg-btn' + (wxc.mode === 'city' ? ' active' : '') + '" data-wx-mode="city">选择城市</button></div>';
        if (wxc.mode === 'city') {
          wxIn += '<p class="st-note">当前城市：' + (wxc.city ? Util.escapeHtml(wxc.city.name) : '还没选') + '</p>'
            + '<div class="wx-search"><input type="search" id="sWxCity" maxlength="24" placeholder="输入城市名，比如：深圳" aria-label="城市名">'
            + '<button type="button" class="btn" id="sWxFind">搜索</button></div><ul class="wx-results" id="sWxRes"></ul>';
        }
        wxIn += '<button type="button" class="st-link" id="sWxRefresh">立即刷新天气</button></div>';
      }
      html += card('', wxIn, '');
      html += card('', sw('sLunar', '首页日期显示农历', s.settings.lunarDate !== false, ''), '');
      html += '</details>';

      html += sgOpen('bell', '记录与提醒', '一天从 ' + curDs + ':00 算', 'sleep');
      var DAY_STARTS = [['0', '0:00'], ['4', '4:00'], ['6', '6:00']];
      html += card('一天从几点开始算', '<div class="seg seg-wrap2" id="sDayStartSeg">' + DAY_STARTS.map(function (m) {
        return '<button type="button" class="seg-btn' + (curDs === m[0] ? ' active' : '') + '" data-day-start="' + m[0] + '">' + m[1] + '</button>';
      }).join('') + '</div>', '选 6:00，凌晨喂奶和夜里那一觉都算前一天。疫苗、预产期不受影响。');
      html += card('计时', sw('sAwake', '计时时屏幕常亮', s.settings.keepAwake !== false, ('wakeLock' in navigator) ? '亲喂、宫缩、胎动计时中不锁屏' : '当前浏览器不支持（iPhone 需 iOS 16.4 以上）')
        + sw('sNightWin', '夜里的窗', s.settings.nightWindow !== false, '夜里全屏计时的背景换成此刻的月亮和星星'), '');
      html += card('提醒', sw('sRemind', '首页提醒卡', s.settings.remindersEnabled !== false, '')
        + sw('sReview', '每周回顾提醒', !!s.settings.weeklyReviewEnabled, '每周最多一次，不催、不打卡'), '');
      /* 第 335 次：系统通知（js/notify.js 渲染进 #sNotifyBox：总开关 + 按类型开关 + 锁屏不显示详情 + 状态一句话） */
      html += card('系统通知', '<div id="sNotifyBox" class="nf-box"></div>', '');
      html += '</details>';
      html += '<div class="st-row row-switch sg-inline" data-accent="mood"><span class="sg-ico" aria-hidden="true">' + icon('heart') + '</span>'
        + '<label for="sHaptic">保存时轻震一下<small>仅安卓手机有效</small></label>'
        + '<input type="checkbox" id="sHaptic"' + (s.settings.hapticEnabled !== false ? ' checked' : '') + '></div>';
      html += '</div>';

      /* ── ④ 导入与导出 · 给家人和医生 · 数据与隐私 ── */
      html += sec('数据');
      html += sgOpen('export', '导入与导出', last ? '上次备份 ' + String(last).slice(0, 10) : '还没有备份过', 'finance');
      var bh = (global.Reminders && typeof Reminders.backupHint === 'function') ? Reminders.backupHint(s, Date.now()) : null;
      html += card('备份', '<button class="st-act" id="sExport" type="button">' + icon('export') + '导出完整备份（JSON）<small>换手机、恢复用</small></button>'
        + '<button class="st-act" id="sImport" type="button">' + icon('import') + '导入备份<small>先看会加多少条，再决定</small></button>'
        + '<button class="st-act" id="sImpLog" type="button">' + icon('calendar') + '导入历史</button>',
        (bh && bh.text ? Util.escapeHtml(bh.text) + ' ' : (last ? '' : '还没有备份过，建议现在导出一次。')) + '导出的文件是明文，存在你信任的地方。');
      html += card('表格（CSV）', '<div class="dm-csv st-csv"><select id="sCsvModule" aria-label="选择要导出 CSV 的记录">'
        + '<option value="feedings">喂养记录</option><option value="sleeps">睡眠记录</option>'
        + '<option value="diapers">尿布记录</option><option value="meds">吃药/维D记录</option>'
        + '<option value="growth">生长记录</option><option value="milestones">里程碑</option><option value="sicks">生病记录</option>'
        + '<option value="vaccines">疫苗接种</option><option value="contractions">宫缩记录</option>'
        + '<option value="periods">经期记录</option><option value="finance">记账记录</option>'
        + '<option value="supplements">营养品服用记录</option>'
        + '</select><button class="btn btn-mini" id="sCsv" type="button">导出</button></div>', 'Excel / WPS 可以直接打开。');
      html += '</details>';
      html += sgOpen('share', '给家人和医生', '交接班、就诊摘要、报告', 'vaccine');
      html += card('', '<button class="st-act" id="sHandoff" type="button">' + icon('share') + '交接班摘要<small>上次吃 / 睡 / 换尿布，发给接手的家人</small></button>'
        + '<button class="st-act" id="sVisit" type="button">' + icon('meds') + '就诊摘要<small>生长、疫苗、发育、近期日常，一段文字</small></button>'
        + '<button class="st-act" id="sPrint" type="button">' + icon('growth') + '打印成长报告<small>一页汇总，可另存 PDF</small></button>'
        + '<button class="st-act" id="sShareCard" type="button">' + icon('image') + '今天的分享卡片<small>照片 + 今日小结，一张图</small></button>'
        + '<button class="st-act" id="sExportShare" type="button">' + icon('export') + '导出给家人 / 医生（JSON）<small>不含情绪、经期、记账</small></button>',
        '都在这台手机上生成，不经过网络。');
      html += '</details>';
      html += sgOpen('settings', '数据与隐私', '记录只存在这台手机', 'supplies');
      var stats = Storage.stats();
      var usage = (typeof Storage.usage === 'function') ? Storage.usage() : null;
      var cbInfo = Storage.corruptBackupInfo ? Storage.corruptBackupInfo() : null;
      html += card('记录', '<ul class="kv kv-stats">' + stats.slice().sort(function (a2, b2) { return (b2.count > 0) - (a2.count > 0); }).map(function (t) {
        return '<li data-accent="' + t.key + '"' + (t.count ? '' : ' class="is-zero"') + '><b>' + t.count + '</b><span>' + t.name + '</span></li>';
      }).join('') + '</ul>', usage ? '本机存储约用了 ' + usage.pct + '%' + (usage.nearLimit ? '，快满了：先导出备份，再删不需要的旧记录。' : '。') : '');
      html += card('存储', '<p class="st-note" id="sPersistInfo">浏览器持久存储：检测中…</p><button class="st-link" id="sPersist" type="button">申请浏览器持久存储</button>'
        + (cbInfo && cbInfo.exists ? '<p class="st-note backfill-note">检测到一份历史损坏数据的原文备份（约 ' + Math.max(1, Math.round(cbInfo.chars / 1024)) + ' KB），只存本机，需要时可人工找回旧记录。</p>' : ''),
        'iPhone 长期不打开可能清掉网页数据；可靠的兜底只有导出备份。');
      html += '<button class="st-danger" id="sReset" type="button">清空全部数据</button>';
      html += '</details>';
      html += '</div>';

      /* ── ⑤ 知识来源 ── */
      html += sec('');
      html += sgOpen('search', '知识来源', '内容出处', 'milestone');
      var usedSrc = {};
      Knowledge.all().forEach(function (e) { usedSrc[e.source] = (usedSrc[e.source] || 0) + 1; });
      Knowledge.MILESTONES.forEach(function (e) { var code = (e.kind === 'obs') ? 'GJ-2025' : 'YJZX'; usedSrc[code] = (usedSrc[code] || 0) + 1; });
      html += card('', '<ul class="kv st-src">' + Object.keys(Knowledge.SOURCES).map(function (code) {
        return '<li><b>' + Util.escapeHtml(code) + '</b> ' + Util.escapeHtml(Knowledge.SOURCES[code]) + ' <i>（' + (usedSrc[code] || 0) + ' 条）</i></li>';
      }).join('') + '</ul>', '可信度：官方标准 &gt; 权威机构共识 &gt; 学派 / 流行观点；数据类只用官方标准。');
      html += '</details>';
      html += '</div>';

      /* 页脚：关于（Cali 的「关于 / 免责声明」放法，咿呀记自己的话） */
      var swOn = false;
      try { swOn = !!(global.navigator && navigator.serviceWorker && navigator.serviceWorker.controller); } catch (e) {}
      html += '<footer class="st-about"><span class="st-logo" aria-hidden="true">' + icon('baby') + '</span><b>咿呀记</b>'
        + '<small>版本 1.0 · ' + (swOn ? '可离线使用' : '在线运行') + '</small>'
        + '<p>记录只存在这台手机（家庭共享时端到端加密）。只做记录，不做诊断；健康问题请遵医嘱。</p></footer>';

      view.innerHTML = html;
      /* 第 182 次（用户：设置在一个页面里展开有点乱）：分组从「原地折叠展开」改为真正的二级页。
         一级页只剩分组目录；点一行 → 整页只显示这一组，大标题换成组名，底栏切成「返回 + ＋」，
         侧滑 / 系统返回 / 返回钮都回到目录（history 与转场由 App.enterSub 统一管理）。
         各组内容仍一次性渲染在 DOM 里，下面的事件绑定一行不用改；
         组内改设置触发 rerender（silent）时，按 _sgCur 原地回到同一组，不会被踢回目录。 */
      if (global.FamUI) FamUI.mount(view.querySelector('#famBox'));
      if (global.Notify) Notify.mount(view.querySelector('#sNotifyBox'));
      if (global.QuickRec) QuickRec.mountEditor(view.querySelector('#sQuickBox'), function () {
        /* 一级目录那一行的「N 个」跟着变（不整页重画，免得打断拖动） */
        var g = view.querySelector('#sQuickBox');
        var sm = g && g.closest('details') && g.closest('details').querySelector('.sg-txt i');
        var n = QuickRec.rawItems().length;
        if (sm) sm.textContent = n ? n + ' 个' : '还没有快记';
      });
      var sgHead = view.querySelector('.page-head h1');
      var sgGroups = view.querySelectorAll('.set-group');
      function sgShow(idx, push) {
        var g = sgGroups[idx];
        if (!g) return;
        _sgCur = idx;
        if (push) _sgY = window.pageYOffset || 0;
        g.open = true;
        g.classList.add('sg-cur');
        view.classList.add('sg-in');
        var b = g.querySelector('.sg-txt b');
        if (sgHead && b) sgHead.textContent = b.textContent;
        if (push) {
          try { window.scrollTo(0, 0); } catch (e) {}
          if (global.App && App.enterSub) App.enterSub(sgHide);
        }
      }
      function sgHide() {
        _sgCur = null;
        var cur = view.querySelector('.set-group.sg-cur');
        if (cur) { cur.classList.remove('sg-cur'); cur.open = false; }
        view.classList.remove('sg-in');
        if (sgHead) sgHead.textContent = '设置';
        var y = _sgY; _sgY = 0;
        try { window.scrollTo(0, y); } catch (e) {}
      }
      Array.prototype.forEach.call(sgGroups, function (g, i) {
        var sm = g.querySelector('summary');
        if (sm) sm.addEventListener('click', function (e) {
          e.preventDefault();
          if (view.classList.contains('sg-in')) return;
          sgShow(i, true);
        });
      });
      if (_sgCur != null && global.App && App.inSub && App.inSub()) {
        sgShow(_sgCur, false);
        App.enterSub(sgHide); /* 已在二级态：只换成新 DOM 的回调，不再多推一条 history */
      } else {
        _sgCur = null;
        /* 第 188 次：#view 节点跨渲染复用，二级态留下的 sg-in 会让目录页整页空白
           （复现：在某个分组里，经搜索/深链/代码路径 showTab('settings') 非 silent 重进）。 */
        view.classList.remove('sg-in');
      }
      function wxSet(patch) {
        var st = Storage.get();
        st.settings.weather = Object.assign({ on: false, mode: 'auto', city: null }, st.settings.weather || {}, patch);
        Storage.save();
        if (global.Weather) Weather.clearCache();
        global.App.rerender();
      }
      var wxOn = view.querySelector('#sWxOn');
      if (wxOn) wxOn.addEventListener('change', function () {
        wxSet({ on: wxOn.checked, dismissed: !wxOn.checked });
        Util.toast(wxOn.checked ? '已打开天气，回首页就能看到' : '已关闭天气，不再联网', 'ok');
      });
      Array.prototype.forEach.call(view.querySelectorAll('[data-wx-mode]'), function (b) {
        b.addEventListener('click', function () { wxSet({ mode: b.getAttribute('data-wx-mode') }); });
      });
      var wxFind = view.querySelector('#sWxFind'), wxCity = view.querySelector('#sWxCity'), wxRes = view.querySelector('#sWxRes');
      function wxSearch() {
        var q = (wxCity.value || '').trim();
        if (!q || !global.Weather) return;
        wxRes.innerHTML = '<li class="hint">搜索中…</li>';
        Weather.searchCity(q).then(function (list) {
          if (!list.length) { wxRes.innerHTML = '<li class="hint">没找到，换个写法试试</li>'; return; }
          wxRes.innerHTML = list.map(function (c, i) {
            return '<li><button type="button" class="wx-res" data-wx-pick="' + i + '"><b>' + Util.escapeHtml(c.name) + '</b><i>' + Util.escapeHtml(c.area) + '</i></button></li>';
          }).join('');
          Array.prototype.forEach.call(wxRes.querySelectorAll('[data-wx-pick]'), function (b) {
            b.addEventListener('click', function () {
              var c = list[parseInt(b.getAttribute('data-wx-pick'), 10)];
              wxSet({ mode: 'city', city: { name: c.name, lat: c.lat, lon: c.lon } });
              Util.toast('天气城市：' + c.name, 'ok');
            });
          });
        }, function () { wxRes.innerHTML = '<li class="hint">网络不通，稍后再试</li>'; });
      }
      if (wxFind) wxFind.addEventListener('click', wxSearch);
      if (wxCity) wxCity.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); wxSearch(); } });
      var wxRf = view.querySelector('#sWxRefresh');
      if (wxRf) wxRf.addEventListener('click', function () {
        if (!global.Weather) return;
        wxRf.disabled = true; wxRf.textContent = '刷新中…';
        Weather.load(Storage.get().settings.weather, true).then(function (w) {
          wxRf.disabled = false; wxRf.textContent = '立即刷新天气';
          Util.toast((w.city ? w.city + ' ' : '') + Weather.codeInfo(w.code).t + ' ' + w.temp + '°', 'ok');
        }, function (err) {
          wxRf.disabled = false; wxRf.textContent = '立即刷新天气';
          Util.toast(err && err.message === 'denied' ? '没有定位权限，可以改成「选择城市」' : '天气暂时取不到，检查一下网络', 'warn');
        });
      });
      var sLunar = view.querySelector('#sLunar');
      if (sLunar) sLunar.addEventListener('change', function () {
        var st = Storage.get(); st.settings.lunarDate = sLunar.checked; Storage.save();
        Util.toast(sLunar.checked ? '首页显示农历' : '首页不再显示农历', 'ok');
      });
      /* 从首页「开启天气」等入口直达某个分组 */
      if (Modules.settings._want) {
        var want = Modules.settings._want; Modules.settings._want = null;
        /* 第 333 次：分组改了名，旧名字（首页、菜单面板里的入口在用）照样能直达 */
        want = { '称呼与阶段': '宝宝与我', '天气': '天气与农历', '提醒': '记录与提醒', '数据与备份': '导入与导出', '外观': '外观' }[want] || want;
        Array.prototype.forEach.call(sgGroups, function (g, i) {
          var b = g.querySelector('.sg-txt b');
          if (b && b.textContent === want) sgShow(i, true);
        });
      }
      Array.prototype.forEach.call(view.querySelectorAll('[data-hc]'), function (cb) {
        cb.addEventListener('change', function () {
          var id = cb.getAttribute('data-hc');
          if (cb.checked) Modules.home._editAdd(id); else Modules.home._editDel(id);
          Util.toast(cb.checked ? '已加到首页' : '已从首页移除', 'ok');
        });
      });
      var sHR = view.querySelector('#sHomeReset');
      if (sHR) sHR.addEventListener('click', function () { Modules.home._editReset(); Util.toast('首页已恢复默认卡片', 'ok'); });
      view.querySelector('#sExport').addEventListener('click', function () { global.App.exportAll(); });
      var exShare = view.querySelector('#sExportShare');
      if (exShare) exShare.addEventListener('click', function () { global.App.exportShare(); });
      /* 第 333 次：导入走「数据管理」的预览（宝宝只按 uuid 对应、同名不同档案会提示），整体覆盖在预览里 */
      view.querySelector('#sImport').addEventListener('click', function () { if (global.DataMgr && DataMgr.openImport) DataMgr.openImport(); else global.App.importAll(); });
      var impLog = view.querySelector('#sImpLog');
      if (impLog) impLog.addEventListener('click', function () { if (global.DataMgr) DataMgr.open('log'); });
      view.querySelector('#sReset').addEventListener('click', function () { global.App.resetAll(); });
      view.querySelector('#sHandoff').addEventListener('click', function () {
        var text = buildHandoff(Storage.get());
        function copyOnly() {
          function done(okk) { Util.toast(okk ? '交接班摘要已复制，粘贴到微信即可' : '复制失败，请重试', okk ? 'ok' : 'error'); }
          try {
            if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') { navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); }); return; }
          } catch (e) { /* fallthrough */ }
          done(false);
        }
        if (typeof navigator.share === 'function') navigator.share({ title: '交接班', text: text }).catch(function (e) { if (!e || e.name !== 'AbortError') copyOnly(); });
        else copyOnly();
      });
      /* ---- 第 71 次（C1）：就诊摘要——优先系统分享，无能力则复制 + 下载 txt ---- */
      view.querySelector('#sVisit').addEventListener('click', function () {
        var text = buildVisitSummary(Storage.get());
        function fallback() {
          var copied = false;
          try {
            if (global.navigator && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
              navigator.clipboard.writeText(text).then(function () {}, function () {});
              copied = true;
            }
          } catch (e) { /* 剪贴板不可用不影响下载 */ }
          try {
            var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
            var a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = '就诊摘要_' + Util.todayISO() + '.txt';
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
            Util.toast(copied ? '摘要已复制并下载为 txt' : '摘要已下载为 txt，可直接带给医生', 'ok');
          } catch (e) { Util.toast('生成失败，请重试', 'error'); }
        }
        if (global.navigator && typeof navigator.share === 'function') {
          navigator.share({ title: '就诊摘要', text: text }).catch(fallback);
        } else fallback();
      });
      /* 第 83 次（C2）：分享卡片入口——生成图片 → 预览弹层（分享/保存 PNG） */
      view.querySelector('#sShareCard').addEventListener('click', function () {
        var root = document.getElementById('modalRoot');
        if (!root) return;
        if (Util.toast) Util.toast('正在生成卡片…', 'info');
        renderShareCard(Storage.get(), function (res) {
          if (!res || !res.ok || !res.dataURL) {
            if (Util.toast) Util.toast('生成失败，请重试', 'error');
            return;
          }
          openShareCardPreview(root, res);
        });
      });
      /* ---- 浏览器持久存储：如实展示「已授予 / 未授予 / 浏览器不支持」 ---- */
      var persistInfo = view.querySelector('#sPersistInfo');
      var persistBtn = view.querySelector('#sPersist');
      function setPersistInfo(text) { if (persistInfo) persistInfo.textContent = '浏览器持久存储：' + text; }
      if (!global.navigator || !navigator.storage || typeof navigator.storage.persisted !== 'function') {
        setPersistInfo('当前浏览器不支持申请（不影响导出备份）');
        if (persistBtn) persistBtn.disabled = true;
      } else {
        navigator.storage.persisted().then(function (ok) {
          setPersistInfo(ok ? '已授予' : '未授予');
          if (persistBtn) persistBtn.disabled = !!ok;
        }).catch(function () { setPersistInfo('状态未知，可尝试申请'); });
        if (persistBtn) persistBtn.addEventListener('click', function () {
          if (!navigator.storage.persist) { setPersistInfo('当前浏览器不支持申请（不影响导出备份）'); return; }
          persistBtn.disabled = true;
          persistBtn.textContent = '申请中…';
          navigator.storage.persist().then(function (ok) {
            setPersistInfo(ok ? '已授予' : '浏览器未授予；请继续定期导出');
            if (!ok) { persistBtn.disabled = false; persistBtn.textContent = '申请浏览器持久存储'; }
          }).catch(function () {
            setPersistInfo('申请失败或不可用；请继续定期导出');
            persistBtn.disabled = false;
            persistBtn.textContent = '申请浏览器持久存储';
          });
        });
      }

      /* U-04 提醒开关：写入设置即刻生效，不做二次确认（关提醒不是破坏性操作） */
      var remSwitch = view.querySelector('#sRemind');
      if (remSwitch) remSwitch.addEventListener('change', function () {
        var st = Storage.get();
        st.settings.remindersEnabled = remSwitch.checked;
        Storage.save();
        Util.toast(remSwitch.checked ? '已开启首页提醒卡' : '已关闭首页提醒卡（功能不受影响）', 'ok');
      });
      var revSwitch = view.querySelector('#sReview');
      if (revSwitch) revSwitch.addEventListener('change', function () {
        var st = Storage.get();
        st.settings.weeklyReviewEnabled = revSwitch.checked;
        if (revSwitch.checked) st.settings.lastReviewISO = Util.todayISO(); /* 从今天起算，不搞「补发」 */
        Storage.save();
        Util.toast(revSwitch.checked ? '已开启每周回顾提醒（每周最多一次）' : '已关闭每周回顾提醒', 'ok');
      });

      /* O 系列：称呼 / 身份即时保存（只影响问候语，不是破坏性操作，不做二次确认） */
      /* 第 80 次（宝宝档案）：切换 / 添加 / 改名 / 照片 / 删除。全走 Storage 宝宝 API，
         落盘后刷新左上角头像并重绘设置页；首页在下次回到时自然拿到新档案。 */
      var babyList = view.querySelector('#sBabyList');
      if (babyList) babyList.addEventListener('click', function (ev) {
        var t = ev.target;
        var renameId = t.getAttribute ? t.getAttribute('data-baby-rename') : null;
        var photoId = t.getAttribute ? t.getAttribute('data-baby-photo') : null;
        var delId = t.getAttribute ? t.getAttribute('data-baby-del') : null;
        if (renameId) {
          openBabyForm(renameId);
          return;
        }
        if (photoId) {
          Util.pickPhoto(function (dataURL) {
            if (!dataURL) return;
            if (photoId === Storage.get().settings.activeBabyId) {
              Storage.setActiveBabyPhoto(dataURL);
            } else {
              /* 非当前宝宝：临时切过去存照片再切回来（switchBaby 会镜像字段，
                 来回各切一次后镜像恢复原样，无净副作用） */
              var prev = Storage.get().settings.activeBabyId;
              Storage.switchBaby(photoId);
              Storage.setActiveBabyPhoto(dataURL);
              Storage.switchBaby(prev);
            }
            if (global.App.refreshHeaderAvatar) global.App.refreshHeaderAvatar();
            global.App.rerender();
            Util.toast('照片已保存（只在本机）', 'ok');
          });
          return;
        }
        if (delId) {
          var target = Storage.get().babies.filter(function (x) { return x.id === delId; })[0];
          Util.confirm({
            title: '删除「' + ((target && target.name) || '宝宝') + '」的档案？',
            /* 第 146 次：记录已按宝宝分开，删档案会连带删掉这个宝宝名下的记录——如实告知并给导出口。
               唯一的档案被删时记录保留（storage.removeBaby 同口径）。 */
            message: (Storage.get().babies.length > 1 && Storage.babyRecordCount(delId) > 0)
              ? '会同时删除这个宝宝名下的 ' + Storage.babyRecordCount(delId) + ' 条记录（喂养、睡眠、生长、疫苗等），删除后无法找回。'
              : '只删除档案本身，已有记录会保留。',
            okText: '删除',
            danger: true,
            extra: { text: '先导出备份', onClick: function () { global.App.exportAll(); } },
            onConfirm: function () {
              Storage.removeBaby(delId);
              if (global.App.refreshHeaderAvatar) global.App.refreshHeaderAvatar();
              global.App.rerender();
              Util.toast('已删除档案', 'ok');
            }
          });
          return;
        }
        /* 点行体 = 切换当前宝宝 */
        var li = t.closest ? t.closest('li[data-baby-id]') : null;
        if (li) {
          var b = Storage.switchBaby(li.getAttribute('data-baby-id'));
          if (b) {
            if (global.App.refreshHeaderAvatar) global.App.refreshHeaderAvatar();
            global.App.rerender();
            Util.toast('已切换到「' + Storage.babyLabel(b) + '」', 'ok');
          }
        }
      });
      /* 添加宝宝：自建表单弹层（confirm 的 message 不接受 HTML，走 modal 基座） */
      var babyAdd = view.querySelector('#sBabyAdd');
      if (babyAdd) babyAdd.addEventListener('click', function () { openBabyForm(null); });
      var careName = view.querySelector('#sCareName');
      if (careName) careName.addEventListener('change', function () {
        var st = Storage.get();
        var c = st.settings.caregiver || { role: null, name: '' };
        c.name = careName.value.trim().slice(0, 12);
        st.settings.caregiver = (c.role || c.name) ? c : null;
        Storage.save();
        Util.toast('称呼已更新（回首页即可看到）', 'ok');
      });
      Array.prototype.forEach.call(view.querySelectorAll('#sCareRole [data-role]'), function (btn) {
        btn.addEventListener('click', function () {
          var st = Storage.get();
          var c = st.settings.caregiver || { role: null, name: '' };
          c.role = btn.getAttribute('data-role') || null;
          st.settings.caregiver = (c.role || c.name) ? c : null;
          Storage.save();
          Array.prototype.forEach.call(view.querySelectorAll('#sCareRole [data-role]'), function (x) { x.classList.remove('active'); });
          btn.classList.add('active');
          Util.toast('身份已更新', 'ok');
        });
      });
      var reOb = view.querySelector('#sReOnboard');
      if (reOb) reOb.addEventListener('click', function () {
        var st = Storage.get();
        st.settings.privacyAccepted = false; /* showOnboarding 以它为闸门 */
        st.settings.onboardingDone = false;
        Storage.save();
        if (global.App && global.App.startOnboarding) global.App.startOnboarding();
      });

      Array.prototype.forEach.call(view.querySelectorAll('#sThemeSeg [data-theme-mode]'), function (b) {
        b.addEventListener('click', function () {
          global.App.setTheme(b.getAttribute('data-theme-mode'));
          Util.toast('主题已切换：' + b.textContent, 'ok');
          global.App.rerender();
        });
      });

      /* 第 103 次（OP-GAP-03）：字号切换。刻意不 rerender 全页——
         setFontScale 已直接改 body 类，字号是纯视觉变化，重渲染反而会让用户
         在设置页看到整页闪一下。只更新 seg 的 active 态与提示 toast。 */
      Array.prototype.forEach.call(view.querySelectorAll('#sFontSeg [data-font-scale]'), function (b) {
        b.addEventListener('click', function () {
          var v = b.getAttribute('data-font-scale');
          global.App.setFontScale(v);
          /* 第 118 次：字号样张引用的 --fs-display / --fs-body 随 body 类变化，
             CSS 变量一改即刷新；沿用上面这套「回调里即时更新」的既有做法，
             再显式触发一次重排，保证样张与 seg 同步（不整页重渲染，避免闪屏）。 */
          var fsSample = view.querySelector('.fs-sample');
          if (fsSample) { void fsSample.offsetHeight; }
          Array.prototype.forEach.call(view.querySelectorAll('#sFontSeg .seg-btn'), function (x) {
            x.classList.remove('active');
          });
          b.classList.add('active');
          Util.toast('字号：' + b.textContent, 'ok');
        });
      });

      /* 阶段切换（第 43 次）：即时生效，首页磁贴排序随之改变 */
      Array.prototype.forEach.call(view.querySelectorAll('#sStageSeg [data-stage-set]'), function (b) {
        b.addEventListener('click', function () {
          var st = b.getAttribute('data-stage-set');
          global.App.setStage(st);
          Util.toast('已切换到' + (st === 'pregnancy' ? '孕期' : '育儿期'), 'ok');
          global.App.rerender();
        });
      });

      /* 第 118 次：高对比开关——沿用 sRefract / sHaptic 同一套「取元素 + change」绑定，
         只调用 App.setHcMode（内部已负责写 Storage.save() 与切 body.hc 类）。 */
      var hc = view.querySelector('#sHcMode');
      if (hc) hc.addEventListener('change', function () {
        if (global.App && typeof global.App.setHcMode === 'function') global.App.setHcMode(hc.checked);
        Util.toast(hc.checked ? '已开启高对比模式' : '已关闭高对比模式', 'ok');
      });

      /* 第 131 次（P1-a）：日起始时刻——落盘后重渲染，首页磁贴与各页「今日」
         统计随即按新口径归属（与 sHomeConverge 同范式：改完立刻看得见）。 */
      var dsSeg = view.querySelector('#sDayStartSeg');
      if (dsSeg) dsSeg.addEventListener('click', function (e) {
        var t = e.target;
        while (t && t !== dsSeg && !(t.getAttribute && t.getAttribute('data-day-start') != null)) t = t.parentNode;
        if (!t || t === dsSeg) return;
        var v = parseInt(t.getAttribute('data-day-start'), 10);
        if (isNaN(v)) return;
        var st = Storage.get();
        st.settings.dayStart = v;
        Storage.save();
        Array.prototype.forEach.call(dsSeg.querySelectorAll('.seg-btn'), function (x) { x.classList.remove('active'); });
        t.classList.add('active');
        Util.toast(v === 0 ? '已按公历日计算今日' : '今日从 ' + v + ':00 开始算——凌晨的记录归前一天', 'ok');
        global.App.rerender();
      });

      /* 第 333 次：「真实玻璃折射」和「底栏液态玻璃折射」合成一个开关（同一类性能取舍，用户不需要分开调） */
      var dgl = view.querySelector('#sDockGlass');
      if (dgl) dgl.addEventListener('change', function () {
        var st = Storage.get();
        st.settings.dockGlass = dgl.checked ? 'auto' : 'off';
        st.settings.realRefraction = dgl.checked;
        Storage.save();
        if (global.Glass) global.Glass.setEnabled(dgl.checked);
        if (global.DockRefract) global.DockRefract.reset();
        if (global.LiquidDock && global.LiquidDock.refresh) global.LiquidDock.refresh();
      });

      var nwk = view.querySelector('#sNightWin');
      if (nwk) nwk.addEventListener('change', function () {
        var st = Storage.get();
        st.settings.nightWindow = nwk.checked;
        Storage.save();
        Util.toast(nwk.checked ? '已开启：夜里的窗' : '已关闭夜里的窗', 'ok');
      });

      var awk = view.querySelector('#sAwake');
      if (awk) awk.addEventListener('change', function () {
        var st = Storage.get();
        st.settings.keepAwake = awk.checked;
        Storage.save();
        Util.toast(awk.checked ? '已开启：计时时屏幕常亮' : '已关闭计时常亮', 'ok');
      });

      /* 第 45 次：保存触感开关。注意这里不要再手动震一次——上面的 Storage.save()
         在开关打开后已经震过了（震一次就够，连震两下反而像出故障）。 */
      var hap = view.querySelector('#sHaptic');
      if (hap) hap.addEventListener('change', function () {
        var st = Storage.get();
        st.settings.hapticEnabled = hap.checked;
        Storage.save();
        Util.toast(hap.checked ? '已开启保存震动（安卓手机才有实际效果）' : '已关闭保存震动', 'ok');
      });

      /* 第 97 次：底栏快捷入口选择——落盘后即时重建底栏（槽位显隐随选随生效） */
      var slotSeg = view.querySelector('#sDockSlotSeg');
      if (slotSeg) slotSeg.addEventListener('click', function (e) {
        var t = e.target;
        while (t && t !== slotSeg && !(t.getAttribute && t.getAttribute('data-dock-slot') != null)) t = t.parentNode;
        if (!t || t === slotSeg) return;
        var v = t.getAttribute('data-dock-slot');
        var st = Storage.get();
        st.settings.dockSlot = (v === '') ? null : v;
        Storage.save();
        Array.prototype.forEach.call(slotSeg.querySelectorAll('.seg-btn'), function (x) { x.classList.remove('active'); });
        t.classList.add('active');
        if (global.App && typeof App.buildTabbar === 'function') App.buildTabbar();
        Util.toast(v === '' ? '已收起底栏快捷入口' : '底栏快捷入口已设为「' + (Modules[v] ? Modules[v].title : v) + '」', 'ok');
      });

      view.querySelector('#sCsv').addEventListener('click', function () {
        var key = view.querySelector('#sCsvModule').value;
        csvExport(key);
      });

      /* ---- 打印成长报告：新窗口生成一页式汇总并唤起打印 ---- */
      view.querySelector('#sPrint').addEventListener('click', function () {
        var d = Storage.get();
        var baby = (d.settings && d.settings.baby) || {};
        var w = global.open('', '_blank');
        if (!w) { Util.toast('浏览器拦截了弹窗，请允许后重试', 'error'); return; }
        /* 第 127 次（安全）：本页 HTML 走 w.document.write 拼装，凡来自记录/导入的字段
           必须先转义——sanitize 只校验记录「是对象」，不校验字段值，导入 crafted 备份
           即可把 <img onerror> 之类带进这一页（新窗口与主文档同源，可访问 opener）。 */
        var esc = Util.escapeHtml;
        var body = '<h1>宝宝成长报告</h1><p class="sub">咿呀记 · 生成于 ' + Util.nowLocal().slice(0, 16).replace('T', ' ') + '</p>';
        body += '<h2>宝宝信息</h2><p>性别：' + esc(baby.sex === 'girl' ? '女' : (baby.sex === 'boy' ? '男' : '未设置'))
          + ' ｜ 出生日期：' + esc(baby.birthDate || '未设置')
          + (baby.preterm ? ' ｜ 早产（孕 ' + esc(baby.birthGestWeeks || '?') + ' 周）' : '') + '</p>';
        var gr = (d.growth || []).slice().sort(function (a, b) { return (a.date || '').localeCompare(b.date || ''); });
        body += '<h2>生长记录（' + gr.length + ' 次）</h2>';
        if (gr.length) {
          body += '<table><tr><th>日期</th><th>体重 kg</th><th>身长 cm</th><th>头围 cm</th></tr>';
          gr.forEach(function (r) {
            body += '<tr><td>' + esc(r.date) + '</td><td>' + esc(r.weightKg || '') + '</td><td>' + esc(r.heightCm || '') + '</td><td>' + esc(r.headCm || '') + '</td></tr>';
          });
          body += '</table>';
        } else body += '<p>暂无记录</p>';
        if (global.Modules && Modules.vaccine && typeof Modules.vaccine._plan === 'function' && baby.birthDate) {
          var plan = Modules.vaccine._plan(baby.birthDate);
          var done = (d.vaccines && d.vaccines.done) || {};
          var doneN = plan.filter(function (it) { return done[it.key]; }).length;
          body += '<h2>疫苗接种（' + doneN + '/' + plan.length + ' 剂）</h2><table><tr><th>剂次</th><th>应种</th><th>接种日期</th></tr>';
          plan.forEach(function (it) {
            body += '<tr><td>' + esc(it.name) + esc(it.dose) + '</td><td>' + esc(it.dueISO) + '</td><td>' + esc(done[it.key] || '未接种') + '</td></tr>';
          });
          body += '</table>';
        }
        var cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30);
        var feeds = (d.feedings || []).filter(function (r) { return r.start && new Date(r.start) >= cutoff; });
        var dias = (d.diapers || []).filter(function (r) { return r.time && new Date(r.time) >= cutoff; });
        body += '<h2>近 30 天日常</h2><p>喂养 ' + feeds.length + ' 次 ｜ 换尿布 ' + dias.length + ' 次</p>';
        /* 第 66 次（F 线 F4）：就诊摘要带情绪节——4 个官方筛查时点之外的连续自记数据 */
        var cut14 = new Date(); cut14.setDate(cut14.getDate() - 14);
        var MOOD_W = { 1: '很低落', 2: '有点低', 3: '一般', 4: '不错', 5: '很好' };
        var mood14 = (d.moods || []).filter(function (r) { return r.time && new Date(r.time) >= cut14; });
        body += '<h2>近 14 天情绪（妈妈自记，' + mood14.length + ' 次）</h2>';
        if (mood14.length) {
          var dist = [5, 4, 3, 2, 1].map(function (lv) {
            var n = mood14.filter(function (r) { return r.level === lv; }).length;
            return n ? (MOOD_W[lv] + ' ' + n + ' 次') : '';
          }).filter(Boolean).join(' ｜ ');
          body += '<p>' + dist + '</p>';
        } else body += '<p>暂无记录</p>';
        body += '<p class="sub">情绪记录为本人自述，仅供问诊参考，不构成筛查或诊断。</p>';
        body += '<p class="foot">本报告数据来自本地记录，仅供参考，具体请遵医嘱。</p>';
        w.document.write('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>成长报告</title>'
          + '<style>body{font-family:system-ui,"Microsoft YaHei",sans-serif;max-width:640px;margin:24px auto;padding:0 16px;color:#333}'
          + 'h1{font-size:22px}h2{font-size:15px;border-left:3px solid #4FA8A0;padding-left:8px;margin-top:20px}'
          + 'table{border-collapse:collapse;width:100%;font-size:13px}td,th{border:1px solid #ccc;padding:4px 8px;text-align:left}'
          + '.sub,.foot{color:#888;font-size:12px}@media print{body{margin:0}}</style></head><body>' + body + '</body></html>');
        w.document.close();
        w.focus();
        /* 第 127 次：原先固定 300ms 唤起打印，数据量大 / 弱机上可能页面还没渲染完
           就弹打印框。改为等新窗口 load；若 readyState 已是 complete 则立即打，
           另留 800ms 兜底（极端情况下 load 不触发也不至于永远打不出来）。 */
        (function firePrint() {
          var fired = false;
          var go = function () {
            if (fired) return;
            fired = true;
            try { w.focus(); w.print(); } catch (e) {}
          };
          if (w.document.readyState === 'complete') { go(); return; }
          w.addEventListener('load', go);
          setTimeout(go, 800);
        })();
      });
    }
  };
  /* 第 71 次（C1）：摘要构建器供 QA 运行时直测（纯函数，无 DOM 依赖） */
  Modules.settings._visitSummary = buildVisitSummary;
  Modules.settings._handoff = buildHandoff;
  /* 第 83 次（C2）：分享卡片数据构建器供 QA 运行时直测（纯函数，无 DOM 依赖） */
  Modules.settings._shareCardData = buildShareCardData;
})(window);
