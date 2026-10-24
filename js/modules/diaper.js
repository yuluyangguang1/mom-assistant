/**
 * diaper.js - 换尿布记录（产后「吃睡拉」三大日常之一）
 * 一键快记：尿 / 便 / 混合，点一下即记下当前时间；可补备注。
 * 设计理由：新生儿期换尿布场景单手操作、时间紧迫，不做表单，做「大按钮即记」。
 */
(function (global) {
  'use strict';
  var Storage = global.Storage, Util = global.Util;
  var Modules = global.Modules = global.Modules || {};

  /* 第 138 次（尿布颜色 · P0）：7 档便便色（Cali 的 diaperColor 同口径，档位取儿科常规）。
     黑/红/灰白三档带 warn——不是诊断，是「建议就医」的红线提示（与黄疸/体温同纪律：只记录不判读）。 */
  var COLORS = [
    { v: 'gold',   label: '金黄', hex: '#E8B84B' },
    { v: 'ygreen', label: '黄绿', hex: '#A7C957' },
    { v: 'green',  label: '绿',   hex: '#5B8C3E' },
    { v: 'brown',  label: '棕',   hex: '#8A5A2B' },
    { v: 'black',  label: '黑',   hex: '#2B2B2B', warn: true },
    { v: 'red',    label: '红',   hex: '#C0392B', warn: true },
    { v: 'pale',   label: '灰白', hex: '#D9D4CB', warn: true }
  ];
  /* 第 195 次（Cali consistency / hasMilkCurds / rash / cream 对标）：便便性状 4 档 + 三个开关。
     只记录、不判读；唯一的安全兜底是「今天稀水样 ≥3 次」提示留意补液与就医信号。
     显示一律走这张表查 label，不直接输出存储值（导入的坏值查不到就不显示）。 */
  var CONS = [
    { v: 'watery', label: '稀水样' },
    { v: 'mushy',  label: '糊状' },
    { v: 'formed', label: '成形' },
    { v: 'hard',   label: '硬球' }
  ];
  function consOf(v) { for (var i = 0; i < CONS.length; i++) if (CONS[i].v === v) return CONS[i]; return null; }
  var FLAGS = [
    { k: 'curds', label: '有奶瓣', poopOnly: true },
    { k: 'rash',  label: '红屁屁' },
    { k: 'cream', label: '涂了护臀膏' }
  ];
  function tagsOf(r) {
    var t = [], c = consOf(r.consistency);
    if (c) t.push(c.label);
    FLAGS.forEach(function (f) { if (r[f.k] === true) t.push(f.label); });
    return t;
  }
  function colorOf(v) { for (var i = 0; i < COLORS.length; i++) if (COLORS[i].v === v) return COLORS[i]; return null; }
  /* 刚记完便类记录后，就地追问颜色用的临时态（render 时若命中该条且尚未选色则展开选择卡）。 */
  var pendingColorFor = null;

  var TYPES = [
    { v: 'pee', t: '尿', icon: 'pee' },
    { v: 'poop', t: '便', icon: 'poop' },
    { v: 'both', t: '尿+便', icon: 'diaper' }
  ];

  function typeInfo(v) {
    for (var i = 0; i < TYPES.length; i++) if (TYPES[i].v === v) return TYPES[i];
    return { v: v, t: v, icon: 'diaper' };
  }

  Modules.diaper = {
    id: 'diaper',
    title: '换尿布',
    render: function (view) {
      var d = Storage.get();
      var today = Util.todayISO();
      /* 第 131 次（P1-a）：「今日共换」走照护日口径（dayStart 可配，默认 0 = 公历日）；
         补记的日期戳仍是公历日（backfill || today，记录必须存真实时刻）。 */
      var DS = Util.dayStartHour(d);
      var dayNow = Util.dayKeyOf(new Date(), DS);
      var html = '';

      /* C7 补记：一次性日期覆盖（App.pendingDate，读取即消费） */
      var backfill = (global.App && App.pendingDate) ? App.pendingDate : null;
      if (global.App) global.App.pendingDate = null;

      /* 一键快记：三个大按钮，按下即保存当前时间 */
      html += '<div class="card"><h2>一键记录</h2>';
      html += backfill
        ? '<p class="hint"><b>补记模式</b>：这条会记到 ' + Util.fmtDate(backfill) + '。</p>'
        : '<p class="hint">换完尿布点一下，默认记现在；补记先选时刻再点。</p>';
      html += Util.timePickHTML('dpTime');
      html += '<div class="quick-row">';
      TYPES.forEach(function (t) {
        html += '<button type="button" class="quick-btn" data-quick="' + t.v + '">'
          + '<span class="quick-ico">' + icon(t.icon) + '</span><span>' + t.t + '</span></button>';
      });
      html += '</div></div>';

      /* 第 138 次：便类记录后的就地颜色追问卡；第 195 次扩成「详情卡」：
         便类 = 颜色 + 性状 + 奶瓣/红屁屁/护臀膏；尿 = 只有红屁屁/护臀膏（从行内「详情」进入，记尿不自动弹）。
         每点一项即落库，点「完成」收起；全不填也没关系。 */
      if (pendingColorFor) {
        var pr = (d.diapers || []).filter(function (x) { return x.id === pendingColorFor; })[0];
        if (pr) {
          var isPoop = pr.type === 'poop' || pr.type === 'both';
          html += '<div class="card diaper-color" data-accent="diaper"><h2>' + (isPoop ? '这条便便怎么样？' : '这次换尿布') + '</h2>'
            + '<p class="hint">' + Util.fmtDateTime(pr.time) + '（' + typeInfo(pr.type).t + '）· 点选即保存，没把握可以不填。</p>';
          if (isPoop) {
            html += '<span class="lbl-text">颜色</span><div class="color-chips">';
            COLORS.forEach(function (c) {
              html += '<button type="button" class="color-chip' + (c.warn ? ' warn' : '') + (pr.color === c.v ? ' active' : '') + '" data-col="' + c.v + '" style="--chip:' + c.hex + '" aria-pressed="' + (pr.color === c.v) + '">'
                + '<span class="chip-dot"></span><span>' + c.label + '</span></button>';
            });
            html += '</div><span class="lbl-text">性状</span><div class="dp-cons">';
            CONS.forEach(function (c) {
              html += '<button type="button" class="dp-pill' + (pr.consistency === c.v ? ' active' : '') + '" data-cons="' + c.v + '" aria-pressed="' + (pr.consistency === c.v) + '">' + c.label + '</button>';
            });
            html += '</div>';
          }
          html += '<span class="lbl-text">' + (isPoop ? '其他' : '屁屁情况') + '</span><div class="dp-flags">';
          FLAGS.forEach(function (f) {
            if (f.poopOnly && !isPoop) return;
            html += '<button type="button" class="dp-pill' + (pr[f.k] === true ? ' active' : '') + '" data-flag="' + f.k + '" aria-pressed="' + (pr[f.k] === true) + '">' + f.label + '</button>';
          });
          html += '</div>';
          html += '<button type="button" class="btn btn-primary btn-save" data-colskip="1">完成</button></div>';
        }
      }

      /* 今日小结 */
      var todayList = (d.diapers || []).filter(function (r) { return Util.dayKeyOf(r.time, DS) === dayNow; });
      var peeN = todayList.filter(function (r) { return r.type === 'pee' || r.type === 'both'; }).length;
      var poopN = todayList.filter(function (r) { return r.type === 'poop' || r.type === 'both'; }).length;
      var latest = (d.diapers || []).slice().sort(function (a, b) { return new Date(b.time) - new Date(a.time); })[0];
      html += '<div class="card"><h2>今日小结</h2>';
      if (todayList.length) {
        html += '<div class="stat-row">'
          + '<div class="stat"><span class="stat-num">' + todayList.length + '<i class="stat-unit">次</i></span><span class="stat-lbl">今日共换</span></div>'
          + '<div class="stat"><span class="stat-num">' + peeN + '<i class="stat-unit">次</i></span><span class="stat-lbl">有尿</span></div>'
          + '<div class="stat"><span class="stat-num">' + poopN + '<i class="stat-unit">次</i></span><span class="stat-lbl">有便</span></div>'
          + '</div>';
        if (latest) html += '<p class="hint">上次：' + Util.fmtDateTime(latest.time) + '（' + typeInfo(latest.type).t + '）</p>';
      } else {
        html += '<p class="hint">今天还没有换尿布记录。</p>';
      }
      /* 第 186 次：新生儿第 1–7 天湿尿布参考（中性，一句话） */
      var wr = Util.newbornWetRef(d);
      if (wr) {
        html += '<p class="hint">出生第 ' + wr.day + ' 天，湿尿布常见参考约每天 ' + wr.ref + ' 片' + (wr.day >= 5 ? '以上' : '')
          + '，今天已记 ' + (todayList.length ? peeN : 0) + ' 片。各家医院口径略有不同，有担心问医生或护士。</p>';
      }
      html += '</div>';

      /* 第 138 次：今天有黑/红/灰白等「建议就医」色便便时，页面顶部给一条红线提示。
         不是诊断，是「如增多或伴异常请就医」的安全兜底（与黄疸/体温同一纪律）。 */
      var warnToday = (d.diapers || []).filter(function (r) {
        return Util.dayKeyOf(r.time, DS) === dayNow && colorOf(r.color) && colorOf(r.color).warn;
      });
      if (warnToday.length) {
        var names = []; warnToday.forEach(function (r) { var c = colorOf(r.color); if (c && names.indexOf(c.label) < 0) names.push(c.label); });
        html += '<div class="warn-box"><p>今天有 <b>' + names.join('、') + '色</b>便便记录。'
          + '若出现增多，或伴随哭闹不安、发热、食欲差、精神萎靡，<b>建议尽快联系医生</b>。</p></div>';
      }

      /* 第 195 次：今天稀水样 ≥3 次——只提示留意补液和就医信号，不下「腹泻」结论 */
      var wateryN = (d.diapers || []).filter(function (r) { return Util.dayKeyOf(r.time, DS) === dayNow && r.consistency === 'watery'; }).length;
      if (wateryN >= 3) {
        html += '<div class="warn-box"><p>今天记了 <b>' + wateryN + ' 次稀水样</b>便便。留意宝宝的尿量和精神；'
          + '若尿明显变少、嘴唇发干、精神差、发热或便里带血，<b>建议尽快联系医生</b>。</p></div>';
      }

      /* 最近记录 */
      html += '<div class="card"><h2>最近记录</h2>';
      var list = (d.diapers || []).slice().sort(function (a, b) { return new Date(b.time) - new Date(a.time); }).slice(0, 20);
      if (list.length) {
        html += '<ul class="list">';
        list.forEach(function (r) {
          var ti = typeInfo(r.type);
          /* 第 61 次：行改「左时间+类型 / 右备注」双列 */
          var dot = (r.color && colorOf(r.color)) ? ' <span class="poop-dot" style="--dot:' + colorOf(r.color).hex + '"></span>' : '';
          html += '<li><span class="row-ico">' + icon(ti.icon) + '</span>'
            /* 第 160 次：类型挪到第二行，第一行只放时间，窄屏也不被行内按钮挤成「10-…」 */
            + '<span class="li-main"><b>' + Util.fmtRowTime(r.time) + '</b></span>'
            + '<span class="li-sub">' + Util.escapeHtml(ti.t) + dot + tagsOf(r).map(function (t) { return ' · ' + t; }).join('') + (r.note ? ' · ' + Util.escapeHtml(r.note) : '') + '</span>'
            + '<button class="btn btn-mini" data-colorbtn="' + r.id + '" aria-label="' + (tagsOf(r).length || r.color ? '修改详情' : '记录颜色、性状等详情') + '">详情</button>'
            + '<button class="btn btn-mini" data-note="' + r.id + '" aria-label="' + (r.note ? '修改备注' : '添加备注') + '">备注</button>'
            + '<button class="icon-btn" data-del="' + r.id + '" aria-label="删除" title="删除">' + icon('trash') + '</button></li>';
        });
        html += '</ul>';
      } else {
        html += '<div class="empty-state"><span class="es-ico">' + icon('diaper') + '</span><p>还没有尿布记录</p><span class="hint">点上方按钮记一次吧。</span></div>';
      }
      html += '</div>';

      view.innerHTML = html;

      Array.prototype.forEach.call(view.querySelectorAll('[data-quick]'), function (b) {
        b.addEventListener('click', function () {
          var v = b.getAttribute('data-quick');
          var dpStamp = Util.stampFrom(view, 'dpTime', backfill || today);
          if (!dpStamp) return;
          var rec = { id: Util.uid(), type: v, time: dpStamp, note: null };
          d.diapers.push(rec);
          if (Storage.save()) {
            /* C2：单手误触高发场景——撤销 = 直接移除刚落库的这条 */
            Util.toast('已记录：' + typeInfo(v).t, 'ok', { label: '撤销', onClick: function () {
              for (var i = d.diapers.length - 1; i >= 0; i--) {
                if (d.diapers[i].id === rec.id) { d.diapers.splice(i, 1); break; }
              }
              Storage.save(); global.App.rerender(); Util.toast('已撤销', 'ok');
            } });
          }
          /* 第 138 次：便类记录后就地追问颜色（Cali「三键 + 颜色追问」同构）；尿不需要颜色。 */
          pendingColorFor = (v === 'poop' || v === 'both') ? rec.id : null;
          global.App.rerender();
        });
      });

      /* 第 138 次：颜色追问卡上的色块 / 跳过 */
      Array.prototype.forEach.call(view.querySelectorAll('[data-col]'), function (b) {
        b.addEventListener('click', function () {
          var pr = (d.diapers || []).filter(function (x) { return x.id === pendingColorFor; })[0];
          if (!pr) return;
          pr.color = b.getAttribute('data-col');
          var c = colorOf(pr.color);
          if (Storage.save() && c && c.warn) Util.toast('已记录颜色（如有增多或异常请就医）', 'ok');
          /* 第 195 次：选完颜色不再收起，接着可选性状等；点「完成」才收起 */
          global.App.rerender();
        });
      });
      function curRec() { return (d.diapers || []).filter(function (x) { return x.id === pendingColorFor; })[0]; }
      Array.prototype.forEach.call(view.querySelectorAll('[data-cons]'), function (b) {
        b.addEventListener('click', function () {
          var pr = curRec(); if (!pr) return;
          var v = b.getAttribute('data-cons');
          pr.consistency = pr.consistency === v ? null : v; /* 再点同项取消 */
          Storage.save(); global.App.rerender();
        });
      });
      Array.prototype.forEach.call(view.querySelectorAll('[data-flag]'), function (b) {
        b.addEventListener('click', function () {
          var pr = curRec(); if (!pr) return;
          var k = b.getAttribute('data-flag');
          if (pr[k] === true) delete pr[k]; else pr[k] = true;
          Storage.save(); global.App.rerender();
        });
      });
      var colSkip = view.querySelector('[data-colskip]');
      if (colSkip) colSkip.addEventListener('click', function () {
        var pr = curRec(); pendingColorFor = null;
        if (pr && (pr.color || tagsOf(pr).length)) Util.toast('已保存详情', 'ok');
        global.App.rerender();
      });

      /* 最近记录行的「颜色」按钮：点开即把该条设为待追问，重渲后顶部出现选择卡 */
      Array.prototype.forEach.call(view.querySelectorAll('[data-colorbtn]'), function (b) {
        b.addEventListener('click', function () {
          var rid = b.getAttribute('data-colorbtn');
          var it = (d.diapers || []).filter(function (x) { return x.id === rid; })[0];
          if (!it) return;
          pendingColorFor = rid;
          global.App.rerender();
        });
      });
      /* P2-14：行内补备注（数据本有 note 字段，此前无写入入口） */
      Array.prototype.forEach.call(view.querySelectorAll('[data-note]'), function (b) {
        b.addEventListener('click', function () {
          var it = d.diapers.filter(function (x) { return x.id === b.getAttribute('data-note'); })[0];
          if (!it) return;
          Util.editText({
            title: '补一句备注',
            message: Util.fmtDateTime(it.time) + '（' + typeInfo(it.type).t + '）',
            value: it.note || '', placeholder: '如 便偏稀 / 换了新码', maxlength: 40, okText: '保存备注',
            onConfirm: function (v) {
              it.note = v || null;
              if (Storage.save()) Util.toast(v ? '备注已保存' : '备注已清除', 'ok');
              global.App.rerender();
            }
          });
        });
      });
      Array.prototype.forEach.call(view.querySelectorAll('[data-del]'), function (b) {
        b.addEventListener('click', function () {
          Util.removeWithUndo(d.diapers, b.getAttribute('data-del'), {
            onSave: function () { Storage.save(); },
            onAfter: function () { global.App.rerender(); },
            deletedText: '已删除尿布记录'
          });
        });
      });
    },

    /* ============================================================
       第 137 次（磁贴就地记录 · P0）：首页尿布磁贴内嵌三键。
       契约（home.js 是唯一消费方）：
         _quickHTML(d)     只返回控件 HTML，不做任何绑定
         _quickBind(root,d,done)  绑定点击、落库、Toast，完成后调 done() 让首页重渲染
       两个函数都不读写模块级状态，可重复调用；root 是 [data-quick] 容器本身，
       按钮上的 stopPropagation 防止冒泡到外层「打开模块」按钮。
       数据形状与页面内的 rec 完全一致（{id,type,time,note}），
       统计口径因此天然对齐——不是为了「快捷」另造一套字段。
       ============================================================ */
    _quickHTML: function (d) {
      var html = '';
      TYPES.forEach(function (t) {
        html += '<button type="button" class="qk-btn" data-qk="' + t.v + '" '
          + 'aria-label="记一次' + t.t + '">' + icon(t.icon) + '<span>' + t.t + '</span></button>';
      });
      return html;
    },

    _quickBind: function (root, d, done) {
      Array.prototype.forEach.call(root.querySelectorAll('[data-qk]'), function (b) {
        b.addEventListener('click', function (ev) {
          if (ev && ev.stopPropagation) ev.stopPropagation();
          var v = b.getAttribute('data-qk');
          var rec = { id: Util.uid(), type: v, time: Util.nowLocal(), note: null };
          d.diapers.push(rec);
          if (Storage.save()) {
            Util.toast('已记录：' + typeInfo(v).t, 'ok', {
              label: '撤销',
              onClick: function () {
                for (var i = d.diapers.length - 1; i >= 0; i--) {
                  if (d.diapers[i].id === rec.id) { d.diapers.splice(i, 1); break; }
                }
                Storage.save();
                done();
              }
            });
          }
          done();
        });
      });
    }
  };
})(window);
