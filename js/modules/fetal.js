/**
 * fetal.js - 胎动计数（对标 Cali 宝宝补齐的孕期刚需，2026-09-27）
 * 孕 28 周后的每日功课：一键「+1」大按钮即记当前时间，带撤销；
 * 今日合计 + 最近记录列表；计数方法因医嘱而异，页面只做记录不给「达标线」（U-25）。
 * 数据：d.fetal = [{ id, time }]（time 为 yyyy-mm-ddThh:mm:ss 本地时间）。
 */
(function (global) {
  'use strict';
  var Storage = global.Storage, Util = global.Util;
  var Modules = global.Modules = global.Modules || {};

  Modules.fetal = {
    id: 'fetal',
    title: '胎动',
    render: function (view) {
      var d = Storage.get();
      var today = Util.todayISO();
      /* 第 131 次（P1-a）：「今天数胎动」走照护日口径（dayStart 可配，默认 0 = 公历日）。 */
      var DS = Util.dayStartHour(d);
      var dayNow = Util.dayKeyOf(new Date(), DS);
      var html = '';

      var todayList = (d.fetal || []).filter(function (r) { return Util.dayKeyOf(r.time, DS) === dayNow; });
      var last = (d.fetal || []).slice().sort(function (a, b) { return new Date(b.time) - new Date(a.time); })[0];

      /* 一键计数卡：大数字主角 + 大按钮（产痛外的另一个「单手场景」） */
      html += '<div class="card"><h2>今天数胎动</h2>';
      html += '<div class="fetal-hero"><span class="stat-num">' + todayList.length + '<i class="stat-unit">次</i></span>';
      if (last) {
        /* 第 146 次：走统一格式化层（原来几天前会显示成「4000 分钟前」） */
        html += '<span class="hint">上次：' + Util.fmtDateTime(last.time) + '（' + Util.fmtAgo(last.time) + '）</span>';
      } else {
        html += '<span class="hint">今天还没有记录。</span>';
      }
      html += '</div>';
      html += '<button type="button" class="btn btn-primary fetal-add" id="ftAdd">' + icon('fetal') + '动了一下，记一次</button>';
      html += '<p class="hint">一般建议孕 28 周后每天固定时间数胎动；怎么数、数多久，以产检医生教你的方法为准。这里只帮你记，不评好坏。</p>';
      html += '</div>';

      /* 最近记录 */
      html += '<div class="card"><h2>最近记录</h2>';
      var list = (d.fetal || []).slice().sort(function (a, b) { return new Date(b.time) - new Date(a.time); }).slice(0, 30);
      if (list.length) {
        html += '<ul class="list">';
        list.forEach(function (r) {
          html += '<li><span class="row-ico">' + icon('fetal') + '</span><span>' + Util.fmtDateTime(r.time) + '</span>'
            + '<button class="icon-btn" data-del="' + r.id + '" aria-label="删除" title="删除">' + icon('trash') + '</button></li>';
        });
        html += '</ul>';
      } else {
        html += '<div class="empty-state"><span class="es-ico">' + icon('fetal') + '</span><p>暂无记录</p><span class="hint">宝宝动的时候点上面按钮记一次。</span></div>';
      }
      html += '</div>';

      /* 第 59 次：医学提示（遵医嘱） */
      html += '<p class="hint med-note">胎动计数方法以产检医生指导为准；胎动明显减少请立即就医。</p>';

      view.innerHTML = html;

      /* 一键 +1：落库即给撤销（C2 同款，防手滑多记） */
      view.querySelector('#ftAdd').addEventListener('click', function () {
        var rec = { id: Util.uid(), time: Util.nowLocal() };
        d.fetal.push(rec);
        if (Storage.save()) {
          Util.toast('已记录一次胎动（今天第 ' + d.fetal.filter(function (r) { return Util.dayKeyOf(r.time, DS) === dayNow; }).length + ' 次）', 'ok', {
            label: '撤销', onClick: function () {
              for (var i = d.fetal.length - 1; i >= 0; i--) {
                if (d.fetal[i].id === rec.id) { d.fetal.splice(i, 1); break; }
              }
              Storage.save(); global.App.rerender(); Util.toast('已撤销', 'ok');
            }
          });
        }
        global.App.rerender();
      });
      Array.prototype.forEach.call(view.querySelectorAll('[data-del]'), function (b) {
        b.addEventListener('click', function () {
          Util.removeWithUndo(d.fetal, b.getAttribute('data-del'), {
            onSave: function () { Storage.save(); },
            onAfter: function () { global.App.rerender(); },
            deletedText: '已删除胎动记录'
          });
        });
      });
    }
  };
})(window);
