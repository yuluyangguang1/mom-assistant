/* ============================================================
 * greetings.js · 第 156 次：首页问候语库（阶段 × 时段 × 特殊日子）
 *
 * 怎么加问候语：
 *   1. 找到对应的「阶段」和「时段」，往数组里加一句即可，不用改别的代码。
 *   2. 句子里写 {who} 会替换成称呼（豆豆妈 / 妈妈 / 爸爸）；没有称呼时，
 *      「，{who}」「{who}，」会自动去掉，所以句子要能单独读通。
 *   3. 建议 12 个字以内（含称呼），h1 单行，长了会被省略号截断。
 *   4. 同一时段内一天只换一次（按日期 + 时段取种子），切页 / 保存不会跳来跳去。
 *
 * 阶段（stage）：
 *   preg1 孕早期（≤13 周）  preg2 孕中期（14–27 周）  preg3 孕晚期（28 周起）
 *   due   预产期前后 14 天内
 *   newborn 新生儿（出生 1–28 天）  infant 婴儿（29–365 天）  toddler 1 岁以上
 *   any   任何阶段都可以用的通用句
 * 时段（slot）：
 *   late 23:00–5:00   dawn 5–8   morning 8–11   noon 11–13   afternoon 13–18   evening 18–23
 * 特殊日子（优先级最高，命中就直接用）：见 special()。
 * ============================================================ */
(function (global) {
  'use strict';

  var LIB = {
    any: {
      late: ['夜深了，{who}', '夜里辛苦了，{who}', '还醒着呀，{who}', '慢慢来，{who}'],
      dawn: ['早安，{who}', '天快亮了，{who}', '新的一天，{who}'],
      morning: ['早上好，{who}', '早安，{who}', '上午好，{who}'],
      noon: ['中午好，{who}', '记得吃午饭，{who}', '歇一会儿吧，{who}'],
      afternoon: ['下午好，{who}', '喝口水吧，{who}', '下午也要好好的，{who}'],
      evening: ['晚上好，{who}', '今天辛苦了，{who}', '晚上好，慢慢来']
    },
    preg1: {
      late: ['早点睡，{who}', '困了就睡吧，{who}'],
      dawn: ['恶心的话慢慢起，{who}', '早安，小豆芽在长大'],
      morning: ['早上好，准妈妈', '少量多餐哦，{who}', '叶酸吃了吗，{who}'],
      noon: ['吃不下就少吃点，{who}', '中午眯一会儿，{who}'],
      afternoon: ['累了就歇着，{who}', '下午好，准妈妈'],
      evening: ['今天也辛苦了，{who}', '早点休息，准妈妈']
    },
    preg2: {
      late: ['侧着睡更舒服，{who}', '睡不着就听听白噪音'],
      dawn: ['早安，宝宝在动吗', '早安，{who}'],
      morning: ['早上好，准妈妈', '出门走走吧，{who}', '今天也元气满满'],
      noon: ['补点铁和钙，{who}', '中午好，准妈妈'],
      afternoon: ['宝宝可能在踢你呢', '下午好，{who}', '散散步吧，{who}'],
      evening: ['和宝宝说说话吧', '晚上好，准妈妈', '泡泡脚放松一下']
    },
    preg3: {
      late: ['翻身慢一点，{who}', '夜里起来小心，{who}', '左侧躺会舒服些'],
      dawn: ['早安，就快见面了', '早安，{who}'],
      morning: ['今天数胎动了吗', '早上好，准妈妈', '待产包备齐了吗'],
      noon: ['中午好，{who}', '吃饭时数数胎动'],
      afternoon: ['累了就坐下歇歇', '下午好，准妈妈', '宝宝快准备好了'],
      evening: ['睡前数一次胎动', '晚上好，{who}', '就快见到宝宝了']
    },
    due: {
      late: ['随时准备着，{who}', '有动静别慌，{who}'],
      dawn: ['会是今天吗，{who}', '早安，倒计时开始了'],
      morning: ['早上好，就快见面了', '待产包在门口吗'],
      noon: ['吃饱一点，{who}', '中午好，{who}'],
      afternoon: ['放轻松，{who}', '宝宝在路上了'],
      evening: ['晚上好，{who}', '今晚好好休息，{who}']
    },
    newborn: {
      late: ['夜奶辛苦了，{who}', '凌晨的你最了不起', '宝宝睡了你也睡', '抱抱你，{who}'],
      dawn: ['又熬过一夜，{who}', '早安，新手{role}', '天亮了，补个觉吧'],
      morning: ['早上好，新手{role}', '今天也一起加油', '能睡就补一觉，{who}'],
      noon: ['自己也要吃饱，{who}', '宝宝睡了快休息'],
      afternoon: ['下午好，{who}', '晒晒太阳吧，{who}', '喝杯温水，{who}'],
      evening: ['今天辛苦了，{who}', '晚上好，新手{role}', '有人帮忙就交给他']
    },
    infant: {
      late: ['夜里辛苦了，{who}', '宝宝又醒了吗', '抱抱你，{who}'],
      dawn: ['早安，小家伙醒了吗', '早安，{who}'],
      morning: ['早上好，{who}', '趴一会儿练练抬头', '出门晒晒太阳吧'],
      noon: ['中午好，{who}', '宝宝午睡你也歇歇'],
      afternoon: ['下午好，{who}', '陪宝宝玩一会儿吧', '记得喝水，{who}'],
      evening: ['晚上好，{who}', '洗个澡准备睡觉', '今天也很棒，{who}']
    },
    toddler: {
      late: ['夜深了，{who}', '早点睡，{who}'],
      dawn: ['早安，小跟班醒了吗', '早安，{who}'],
      morning: ['早上好，{who}', '今天去哪儿玩', '出去跑跑吧'],
      noon: ['中午好，{who}', '午睡时间到啦'],
      afternoon: ['下午好，{who}', '读本绘本吧', '一起搭积木吧'],
      evening: ['晚上好，{who}', '讲个睡前故事吧', '今天也辛苦了，{who}']
    }
  };

  function slotOf(h) {
    if (h >= 23 || h < 5) return 'late';
    if (h < 8) return 'dawn';
    if (h < 11) return 'morning';
    if (h < 13) return 'noon';
    if (h < 18) return 'afternoon';
    return 'evening';
  }

  function stageKey(o) {
    if (o.ageDays != null && o.ageDays >= 0) {
      if (o.ageDays <= 28) return 'newborn';
      if (o.ageDays <= 365) return 'infant';
      return 'toddler';
    }
    if (o.dueLeft != null && o.dueLeft <= 14 && o.dueLeft >= -14) return 'due';
    if (o.pregWeek != null) return o.pregWeek <= 13 ? 'preg1' : (o.pregWeek <= 27 ? 'preg2' : 'preg3');
    return null;
  }

  /* 特殊日子：命中就直接用，不进随机池 */
  function special(o) {
    var a = o.ageDays;
    if (a != null) {
      if (a === 0) return '欢迎新生命，{who}';
      if (a === 30) return '宝宝满月啦，{who}';
      if (a === 100) return '宝宝百天快乐';
      if (a === 365) return '宝宝一周岁啦';
      if (a === 730) return '宝宝两周岁啦';
      if (o.monthDay && a > 30 && a < 730) return '宝宝满 ' + o.monthDay + ' 个月啦';
    }
    if (o.dueLeft === 0) return '今天是预产期，{who}';
    if (o.pregWeek === 40 && o.dueLeft > 0) return '满 40 周了，{who}';
    if (o.fest) return o.fest + '快乐，{who}';
    if (o.momsDay) return '母亲节快乐，{who}';
    return null;
  }

  function hash(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  function fill(t, who, role) {
    t = t.replace(/\{role\}/g, role || '爸妈');
    if (who) return t.replace(/\{who\}/g, who);
    return t.replace(/，\{who\}/g, '').replace(/\{who\}，/g, '').replace(/\{who\}/g, '');
  }

  /* opts: { now: Date, who, role('妈妈'|'爸爸'), ageDays, pregWeek, dueLeft, fest, monthDay }
     返回 { text, slot, stage } */
  function pick(opts) {
    var o = opts || {};
    var now = o.now || new Date();
    var slot = slotOf(now.getHours());
    var stage = stageKey(o);
    var sp = special(o);
    if (sp) return { text: fill(sp, o.who, o.role), slot: slot, stage: stage, special: true };
    var pool = [];
    if (stage && LIB[stage] && LIB[stage][slot]) pool = pool.concat(LIB[stage][slot], LIB[stage][slot]); /* 阶段句权重 ×2 */
    pool = pool.concat(LIB.any[slot]);
    var day = now.getFullYear() + '-' + (now.getMonth() + 1) + '-' + now.getDate();
    var t = pool[hash(day + '|' + slot + '|' + (stage || '')) % pool.length];
    return { text: fill(t, o.who, o.role), slot: slot, stage: stage };
  }

  global.Greetings = { pick: pick, LIB: LIB, slotOf: slotOf, stageKey: stageKey, _fill: fill };
})(typeof window !== 'undefined' ? window : this);
