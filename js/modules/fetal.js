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
      /* 第 186 次：计数会话——「开始一次计数」后每次 +1 归入本次，结束时记下用时与次数。
         不设达标线、不自动结束：数多久、数到几次，按产检医生教的方法（U-25）。 */
      var sess = d.fetalSession;
      if (sess) {
        var sessCnt = (d.fetal || []).filter(function (r) { return r.time >= sess.start; }).length;
        html += '<div class="backfill-note feed-live"><p class="hint"><b>本次计数中</b> · 从 ' + Util.fmtDateTime(sess.start).slice(-5)
          + ' 开始，已 <b id="fsElapsed">' + Util.fmtClock(Date.now() - new Date(sess.start).getTime()) + '</b>，本次 <b>' + sessCnt + '</b> 次</p>'
          + '<div class="row"><button type="button" class="btn-mini" id="fsEnd">结束本次</button>'
          + '<button type="button" class="btn-mini" id="fsCancel">取消</button></div></div>';
      }
      html += '<button type="button" class="btn btn-primary fetal-add" id="ftAdd">' + icon('fetal') + '动了一下，记一次</button>';
      if (!sess) html += '<div class="row"><button type="button" class="btn-mini" id="fsStart">开始一次计数（记用时）</button></div>';
      html += '<p class="hint">一般建议孕 28 周后每天固定时间数胎动；怎么数、数多久，以产检医生教你的方法为准。这里只帮你记，不评好坏。</p>';
      html += '</div>';

      /* 第 186 次：最近几次计数会话 */
      var sessions = (d.fetalSessions || []).slice().sort(function (a, b) { return new Date(b.start) - new Date(a.start); }).slice(0, 10);
      if (sessions.length) {
        html += '<div class="card"><h2>最近几次计数</h2><ul class="list">';
        sessions.forEach(function (r) {
          var ms = new Date(r.end) - new Date(r.start);
          html += '<li><span class="row-ico">' + icon('fetal') + '</span>'
            + '<span class="li-main"><b>' + Util.escapeHtml(Util.fmtDateTime(r.start)) + '</b></span>'
            + '<span class="li-sub">用时 ' + Util.escapeHtml(Util.fmtDuration(ms)) + '</span>'
            + '<span class="li-num">' + (r.count | 0) + ' 次</span>'
            + '<button class="icon-btn" data-sdel="' + Util.escapeHtml(r.id) + '" aria-label="删除" title="删除">' + icon('trash') + '</button></li>';
        });
        html += '</ul></div>';
      }

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
        html += '<div class="empty-state"><span class="es-ico">' + icon('fetal') + '</span><p>还没有胎动记录</p><span class="hint">宝宝动的时候点上面按钮记一次。</span></div>';
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
      var fsStart = view.querySelector('#fsStart');
      if (fsStart) fsStart.addEventListener('click', function () {
        d.fetalSession = { start: Util.nowLocal() };
        Storage.save(); global.App.rerender();
      });
      var fsEnd = view.querySelector('#fsEnd');
      if (fsEnd) fsEnd.addEventListener('click', function () {
        var s0 = d.fetalSession; if (!s0) return;
        var cnt = (d.fetal || []).filter(function (r) { return r.time >= s0.start; }).length;
        if (!d.fetalSessions) d.fetalSessions = [];
        var end = Util.nowLocal();
        d.fetalSessions.push({ id: Util.uid(), start: s0.start, end: end, count: cnt });
        d.fetalSession = null;
        Storage.save();
        Util.toast('本次 ' + cnt + ' 次，用时 ' + Util.fmtDuration(new Date(end) - new Date(s0.start)), 'ok');
        global.App.rerender();
      });
      var fsCancel = view.querySelector('#fsCancel');
      if (fsCancel) fsCancel.addEventListener('click', function () {
        d.fetalSession = null; Storage.save(); Util.toast('已取消本次计数（胎动记录保留）', 'ok'); global.App.rerender();
      });
      var fsEl = view.querySelector('#fsElapsed');
      if (fsEl && d.fetalSession) {
        var fsTick = setInterval(function () {
          if (!view.contains(fsEl) || !d.fetalSession) { clearInterval(fsTick); return; }
          fsEl.textContent = Util.fmtClock(Date.now() - new Date(d.fetalSession.start).getTime());
        }, 1000);
      }
      Array.prototype.forEach.call(view.querySelectorAll('[data-sdel]'), function (b) {
        b.addEventListener('click', function () {
          Util.removeWithUndo(d.fetalSessions, b.getAttribute('data-sdel'), {
            onSave: function () { Storage.save(); },
            onAfter: function () { global.App.rerender(); },
            deletedText: '已删除这次计数'
          });
        });
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
