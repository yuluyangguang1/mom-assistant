/**
 * mood.js - 妈妈情绪随记（第 66 次 · F 线，依据《孕产心理健康研究_妈妈的情绪.md》）
 *
 * 定位红线（F 线研究明确）：
 * 1. 不是心理测评——不复刻 EPDS / PHQ-9 / GAD-7（填答失真 + 误判焦虑已实证，
 *    量表筛查是产检系统的职责）；不做评分、不做分级、不下任何结论。
 * 2. 只做低摩擦的情绪记录 + 趋势呈现 + 中性科普——「不带评判的出口」，
 *    正是官方筛查体系缺的那一块（两次产检之间的盲区）。
 * 3. 「该和医生聊聊」提示只在用户主动记录后才可能触发，一次性、可永久关闭；
 *    「伤害念头」不作为可勾选标签、不进任何记录与算法——入口常驻为紧急指引卡。
 * 第 253 次：迁到新骨架 modskel.js——页面只看记录与趋势，记一笔走底部按钮 → 半屏面板；紧急指引卡照旧常驻。
 * 数据：d.moods = [{ id, time, level(1-5), note, tags[] }]（schema 只增不改）。
 */
(function (global) {
  'use strict';
  var Storage = global.Storage, Util = global.Util;
  var Modules = global.Modules = global.Modules || {};

  /* 5 档情绪：1=很低落 … 5=很好。低两档（1/2）是中性提示的唯一触发输入 */
  var LV_TXT = { 1: '很低落', 2: '有点低', 3: '一般', 4: '不错', 5: '很好' };
  /* 触发因素（可选、可多选）：只描述处境，不做归因推断 */
  var TAGS = [
    { key: 'sleep', text: '睡眠不足' },
    { key: 'feed', text: '喂养困难' },
    { key: 'body', text: '身体不适' },
    { key: 'family', text: '家庭矛盾' },
    { key: 'work', text: '事务压力' }
  ];
  var TAG_TXT = {};
  TAGS.forEach(function (t) { TAG_TXT[t.key] = t.text; });

  /* 记录级清洗：level 限 1-5、tags 只留已知键、note 截断——坏数据不进渲染与统计 */
  function cleanRec(r) {
    if (!r || typeof r !== 'object') return null;
    var lv = parseInt(r.level, 10);
    if (!(lv >= 1 && lv <= 5)) return null;
    return {
      id: (typeof r.id === 'string') ? r.id : Util.uid(),
      time: (typeof r.time === 'string') ? r.time : Util.nowLocal(),
      level: lv,
      note: (typeof r.note === 'string') ? r.note.slice(0, 40) : null,
      tags: Array.isArray(r.tags) ? r.tags.filter(function (t) { return TAG_TXT[t]; }) : []
    };
  }
  function allMoods(d) {
    return (d.moods || []).map(cleanRec).filter(Boolean)
      .sort(function (a, b) { return new Date(b.time) - new Date(a.time); });
  }

  function okLv(r) { var lv = parseInt(r && r.level, 10); return lv >= 1 && lv <= 5 ? lv : 0; }

  Modules.mood = {
    id: 'mood',
    title: '妈妈情绪',
    render: function (view) {
      var d = Storage.get();
      var today = Util.todayISO();
      var moods = allMoods(d);
      var low5 = moods.length >= 5 && moods.slice(0, 5).every(function (r) { return r.level <= 2; });

      global.ModSkel.render(view, {
        id: 'mood', accent: 'mood', noun: '情绪', listKey: 'moods', icon: 'mood', bars: null,
        ref: '这里不是心理测评，不评分也不诊断，只帮你留下情绪的轨迹，就诊时也可以拿给医生看。',
        summary: function (c) {
          var t = c.today.filter(okLv);
          if (t.length) return '今天记了 <b>' + t.length + ' 次</b>，最近一次是<b>' + LV_TXT[okLv(t[0])] + '</b>。';
          var l = c.all.filter(okLv)[0];
          if (l) return '今天还没记。上次是<b>' + Util.escapeHtml(c.ago(l.time)) + '</b>，<b>' + LV_TXT[okLv(l)] + '</b>。想记的时候再记，不记也没关系。';
          return '想记的时候记一笔就好，不记也没关系。';
        },
        dash: function () {
          var h = '';
          if (low5 && d.settings.moodHintDismissed !== true) {
            h += '<div class="card mood-hint-banner" id="moodHintBanner">'
              + '<h2>最近的情绪，值得被看见</h2>'
              + '<p class="hint">最近几次记录情绪都比较低。这不意味着你不称职——孕产期的情绪困扰'
              + '很常见，也完全可以改善，就像身体需要休息一样，情绪也需要支持。</p>'
              + '<p class="hint">可以下次产检或儿保时告诉医生；也可以直接挂心理/睡眠门诊，'
              + '或拨打 <b>12356</b>（全国心理援助热线）先聊聊。</p>'
              + '<div class="row"><button class="btn" id="moodHintOk" type="button">知道了，不再提示</button></div></div>';
          }
          /* 近 14 天：每天一枚圆点（取当天最近一次），刻意不做折线图，不放大波动 */
          h += '<div class="card dash-card"><h2>最近 14 天</h2><div class="mtl" id="moodTl">';
          var byDay = {};
          moods.forEach(function (r) { var k = r.time.slice(0, 10); if (!byDay[k]) byDay[k] = r; });
          for (var i = 13; i >= 0; i--) {
            var dt = new Date(); dt.setDate(dt.getDate() - i);
            var iso = dt.getFullYear() + '-' + ('0' + (dt.getMonth() + 1)).slice(-2) + '-' + ('0' + dt.getDate()).slice(-2);
            var rec = byDay[iso];
            h += '<span class="mtl-d"><span class="mtl-dot' + (rec ? ' lv' + rec.level : '') + '"'
              + (rec ? ' title="' + iso + ' · ' + LV_TXT[rec.level] + '"' : ' title="' + iso + ' · 未记录"')
              + '></span><span class="mtl-num' + (iso === today ? ' now' : '') + '">' + dt.getDate() + '</span></span>';
          }
          h += '</div><p class="hint">看趋势不看单次；空白的天只是没记，不代表出了问题。</p></div>';
          var mk = (global.Knowledge && global.Knowledge.pick) ? global.Knowledge.pick('mind') : null;
          if (mk) h += '<p class="hint mind-know">' + Util.escapeHtml(mk.text) + '</p>';
          return h;
        },
        fields: [
          { k: 'level', t: 'seg', label: '现在的感受', optional: false, opts: [5, 4, 3, 2, 1].map(function (lv) { return { v: lv, label: LV_TXT[lv] }; }) },
          { k: 'tags', t: 'multi', label: '和什么有关', opts: TAGS.map(function (t) { return { v: t.key, label: t.text }; }) }
        ],
        sheetHint: '不选也可以。这里不做评分，也不做任何判断。',
        notePh: '比如：昨晚只睡了四个小时',
        title: function (r) { return LV_TXT[okLv(r)] || '情绪'; },
        sub: function (r) {
          var tg = Array.isArray(r.tags) ? r.tags.map(function (t) { return TAG_TXT[t]; }).filter(Boolean) : [];
          return tg.concat(r.note ? [r.note] : []).join(' · ');
        },
        /* 紧急指引卡（F3 唯一紧急分支）：常驻、不记录任何内容、不用勾选触发。
           12356 = 国家卫健委 2024 年 12 月设立的全国统一心理援助热线（2025-05-01 起全国开通）。 */
        always: function () {
          return '<div class="card mood-urgent"><h2>紧急情况</h2>'
            + '<p class="hint">如果此刻出现<b>伤害自己或宝宝的念头</b>，这不是你的错，也不要独自硬撑：</p>'
            + '<ul class="kv">'
            + '<li>告诉身边能帮你的人，请 TA 陪着你和宝宝；</li>'
            + '<li>拨打 <b>12356</b> 全国心理援助热线（匿名、免费）；</li>'
            + '<li>有紧急危险时，直接前往医院急诊或拨打 120。</li>'
            + '</ul></div>';
        },
        foot: '情绪低落持续超过两周、或觉得难以照顾自己和宝宝，值得和医生聊聊——孕产期的情绪问题常见，也是可以治疗的。',
        bind: function (v) {
          var ok = v.querySelector('#moodHintOk');
          if (ok) ok.addEventListener('click', function () {
            d.settings.moodHintDismissed = true;
            Storage.save();
            Util.toast('好的。这条提示以后不会再自动出现，紧急指引卡会一直留在页尾。', 'ok');
            global.App.rerender();
          });
        }
      });
    }
  };
})(window);
