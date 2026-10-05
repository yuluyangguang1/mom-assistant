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

  Modules.mood = {
    id: 'mood',
    title: '妈妈情绪',
    render: function (view) {
      var d = Storage.get();
      var today = Util.todayISO();
      var moods = allMoods(d);
      var html = '';

      /* F3 中性提示：仅当用户主动记录 ≥5 条、最近 5 条都在低两档、且未永久关闭。
         文案只做两件事：去污名 + 给出口；不评分、不提「抑郁」二字、不催。 */
      var low5 = moods.length >= 5 && moods.slice(0, 5).every(function (r) { return r.level <= 2; });
      if (low5 && d.settings.moodHintDismissed !== true) {
        html += '<div class="card mood-hint-banner" id="moodHintBanner">'
          + '<h2>最近的情绪，值得被看见</h2>'
          + '<p class="hint">最近几次记录情绪都比较低。这不意味着你不称职——孕产期的情绪困扰'
          + '很常见，也完全可以改善，就像身体需要休息一样，情绪也需要支持。</p>'
          + '<p class="hint">可以下次产检或儿保时告诉医生；也可以直接挂心理/睡眠门诊，'
          + '或拨打 <b>12356</b>（全国心理援助热线）先聊聊。</p>'
          + '<div class="row"><button class="btn" id="moodHintOk" type="button">知道了，不再提示</button></div></div>';
      }

      /* 记一笔：5 档 chip + 可选处境 + 可选一句话（刻意不叫「测评/量表」） */
      var sel = { level: null, tags: [] };
      html += '<div class="card"><h2>记一笔情绪</h2>'
        + '<p class="hint">这里不是心理测评，不做评分也不做诊断——只是帮你留下情绪的轨迹，'
        + '回看趋势，就诊时也可以拿出来给医生看。</p>'
        + '<span class="lbl-text">现在的感受</span><div class="mood-lv" id="moodLv">';
      [5, 4, 3, 2, 1].forEach(function (lv) {
        html += '<button type="button" data-lv="' + lv + '">' + LV_TXT[lv] + '</button>';
      });
      html += '</div>';
      html += '<span class="lbl-text">和什么有关（可多选，可不选）</span><div class="mood-tags" id="moodTags">';
      TAGS.forEach(function (t) {
        html += '<button type="button" data-tag="' + t.key + '">' + t.text + '</button>';
      });
      html += '</div>';
      html += '<label>想多说一句（可选）<input type="text" id="moodNote" maxlength="40" placeholder="比如：昨晚只睡了四个小时"></label>';
      html += '<button class="btn btn-primary" id="moodSave">保存</button></div>';

      /* 近 14 天趋势：每天一枚圆点（取当天最近一次），颜色 = 情绪档。
         刻意不做折线图——趋势要温和地呈现，不放大波动制造「病情感」。 */
      html += '<div class="card"><h2>最近 14 天</h2><div class="mtl" id="moodTl">';
      var byDay = {};
      moods.forEach(function (r) { var k = r.time.slice(0, 10); if (!byDay[k]) byDay[k] = r; });
      for (var i = 13; i >= 0; i--) {
        var dt = new Date(); dt.setDate(dt.getDate() - i);
        var iso = dt.getFullYear() + '-' + ('0' + (dt.getMonth() + 1)).slice(-2) + '-' + ('0' + dt.getDate()).slice(-2);
        var rec = byDay[iso];
        html += '<span class="mtl-d"><span class="mtl-dot' + (rec ? ' lv' + rec.level : '') + '"'
          + (rec ? ' title="' + iso + ' · ' + LV_TXT[rec.level] + '"' : ' title="' + iso + ' · 未记录"')
          + '></span><span class="mtl-num' + (iso === today ? ' now' : '') + '">' + dt.getDate() + '</span></span>';
      }
      html += '</div><p class="hint">看趋势不看单次；空白的天只是没记，不代表出了问题。</p></div>';

      /* F2（第 67 次）：mind 支柱知识句——来自 knowledge.js，按天轮换。
         只做去污名与就医指路的中性科普，不做量表、不给建议性判断。 */
      var mindKnow = (global.Knowledge && global.Knowledge.pick) ? global.Knowledge.pick('mind') : null;
      if (mindKnow) {
        html += '<p class="hint mind-know">' + Util.escapeHtml(mindKnow.text) + '</p>';
      }

      /* 最近记录（双列行：左=档位+处境，右=时间） */
      html += '<div class="card"><h2>最近记录</h2>';
      var list = moods.slice(0, 20);
      if (list.length) {
        html += '<ul class="list">';
        list.forEach(function (r) {
          var tagTxt = r.tags.map(function (t) { return TAG_TXT[t]; }).join(' · ');
          html += '<li data-accent="mood"><span class="row-ico">' + icon('mood') + '</span>'
            + '<span class="li-main"><b>' + LV_TXT[r.level] + '</b>' + (tagTxt ? '<i>' + Util.escapeHtml(tagTxt) + '</i>' : '')
            + (r.note ? '<i>' + Util.escapeHtml(r.note) + '</i>' : '') + '</span>'
            + '<span class="li-sub">' + Util.fmtRowTime(r.time) + '</span>'
            + '<button class="icon-btn" data-del="' + r.id + '" aria-label="删除" title="删除">' + icon('trash') + '</button></li>';
        });
        html += '</ul>';
      } else {
        html += '<div class="empty-state"><p>还没有情绪记录</p><span class="hint">想记的时候记一笔就好，不记也没关系。</span></div>';
      }
      html += '</div>';

      /* 紧急指引卡（F3 唯一紧急分支）：常驻、不记录任何内容、不用勾选触发。
         12356 = 国家卫健委 2024 年 12 月设立的全国统一心理援助热线（2025-05-01 起全国开通）。 */
      html += '<div class="card mood-urgent"><h2>紧急情况</h2>'
        + '<p class="hint">如果此刻出现<b>伤害自己或宝宝的念头</b>，这不是你的错，也不要独自硬撑：</p>'
        + '<ul class="kv">'
        + '<li>告诉身边能帮你的人，请 TA 陪着你和宝宝；</li>'
        + '<li>拨打 <b>12356</b> 全国心理援助热线（匿名、免费）；</li>'
        + '<li>有紧急危险时，直接前往医院急诊或拨打 120。</li>'
        + '</ul></div>';

      /* 中性收尾（就医线）：与全站医学模块同语言，只指路不判读 */
      html += '<p class="hint med-note">情绪低落持续超过两周、或觉得难以照顾自己和宝宝，'
        + '值得和医生聊聊——孕产期的情绪问题常见，也是可以治疗的。</p>';

      view.innerHTML = html;

      /* 档位选择 */
      Array.prototype.forEach.call(view.querySelectorAll('#moodLv [data-lv]'), function (b) {
        b.addEventListener('click', function () {
          sel.level = parseInt(b.getAttribute('data-lv'), 10);
          Array.prototype.forEach.call(view.querySelectorAll('#moodLv [data-lv]'), function (x) { x.classList.remove('active'); });
          b.classList.add('active');
        });
      });
      /* 处境多选 */
      Array.prototype.forEach.call(view.querySelectorAll('#moodTags [data-tag]'), function (b) {
        b.addEventListener('click', function () {
          var k = b.getAttribute('data-tag');
          var at = sel.tags.indexOf(k);
          if (at >= 0) { sel.tags.splice(at, 1); b.classList.remove('active'); }
          else { sel.tags.push(k); b.classList.add('active'); }
        });
      });
      /* 保存 */
      view.querySelector('#moodSave').addEventListener('click', function () {
        if (sel.level == null) { Util.toast('先选一个现在的感受', 'warn'); return; }
        var rec = cleanRec({
          id: Util.uid(), time: Util.nowLocal(), level: sel.level,
          note: (view.querySelector('#moodNote').value || '').trim() || null,
          tags: sel.tags.slice()
        });
        if (!d.moods) d.moods = [];
        d.moods.push(rec);
        if (Storage.save()) Util.toast('已记录：' + LV_TXT[rec.level], 'ok');
        global.App.rerender();
      });
      /* 删除（带撤销，与体温/喂养同范式） */
      Array.prototype.forEach.call(view.querySelectorAll('[data-del]'), function (b) {
        b.addEventListener('click', function () {
          Util.removeWithUndo(d.moods, b.getAttribute('data-del'), {
            onSave: function () { Storage.save(); },
            onAfter: function () { global.App.rerender(); },
            deletedText: '已删除情绪记录'
          });
        });
      });
      /* 中性提示关闭（一次性、可永久关闭；关掉不损失任何功能） */
      var hintOk = view.querySelector('#moodHintOk');
      if (hintOk) hintOk.addEventListener('click', function () {
        d.settings.moodHintDismissed = true;
        Storage.save();
        Util.toast('好的。这条提示以后不会再自动出现，紧急指引卡会一直留在页尾。', 'ok');
        global.App.rerender();
      });
    }
  };
})(window);
