/**
 * sleep.js - 哄睡 / 睡眠计时
 * 开始 / 暂停 / 继续 / 结束；记录时长；基础作息列表。
 */
(function (global) {
  'use strict';
  var Storage = global.Storage, Util = global.Util;
  var Modules = global.Modules = global.Modules || {};

  function openSleep() { return Storage.get().openSleep || null; }

  function tick() {
    var os = openSleep();
    var el = document.getElementById('sleepTimer');
    if (!os || !el) return;
    var now = Date.now();
    var paused = (os.pausedMs || 0) + (os.pauseStart ? now - os.pauseStart : 0);
    el.textContent = Util.fmtDuration(now - new Date(os.start).getTime() - paused);
  }

  Modules.sleep = {
    id: 'sleep',
    title: '睡眠',
    render: function (view) {
      var d = Storage.get();
      var os = openSleep();
      var html = '';

      html += '<div class="card"><h2>' + icon('sleep') + '睡眠计时</h2>';
      if (os) {
        html += '<p class="big">已睡 <span id="sleepTimer">--</span></p>';
        html += '<p class="hint">开始：' + Util.fmtDateTime(os.start) + (os.pauseStart ? '（已暂停）' : '') + '</p>';
        if (os.pauseStart) {
          html += '<button class="btn btn-primary" id="sResume">继续</button> ';
        } else {
          html += '<button class="btn" id="sPause">暂停</button> ';
        }
        html += '<button class="btn btn-primary" id="sEnd">结束并记录</button>';
      } else {
        html += '<button class="btn btn-primary" id="sStart">开始睡眠计时</button>';
        html += '<p class="hint">点开始后记录本次睡眠，可暂停/继续。</p>';
      }
      html += '</div>';

      html += '<div class="card"><h2>作息记录</h2>';
      var list = d.sleeps.filter(function (s) { return s.end; })
        .slice().sort(function (a, b) { return new Date(b.start) - new Date(a.start); }).slice(0, 20);
      if (list.length) {
        html += '<ul class="list">';
        list.forEach(function (s) {
          var dur = new Date(s.end).getTime() - new Date(s.start).getTime() - (s.pausedMs || 0);
          html += '<li><span>' + Util.fmtDateTime(s.start) + '<br>时长 ' + Util.fmtDuration(dur) +
            (s.note ? ' ｜ ' + Util.escapeHtml(s.note) : '') + '</span>' +
            '<button class="icon-btn" data-del="' + s.id + '" aria-label="删除" title="删除">' + icon('trash') + '</button></li>';
        });
        html += '</ul>';
      } else {
        html += '<div class="empty-illo">' + illo('empty') + '</div><p class="hint">暂无</p>';
      }
      html += '</div>';

      view.innerHTML = html;
      tick();

      var sStart = view.querySelector('#sStart');
      if (sStart) sStart.addEventListener('click', function () {
        d.openSleep = { id: Util.uid(), start: Util.nowLocal(), pausedMs: 0, pauseStart: null };
        Storage.save(); global.App.rerender();
      });
      var sPause = view.querySelector('#sPause');
      if (sPause) sPause.addEventListener('click', function () {
        d.openSleep.pauseStart = Date.now();
        Storage.save(); global.App.rerender();
      });
      var sResume = view.querySelector('#sResume');
      if (sResume) sResume.addEventListener('click', function () {
        if (d.openSleep.pauseStart) {
          d.openSleep.pausedMs = (d.openSleep.pausedMs || 0) + (Date.now() - d.openSleep.pauseStart);
          d.openSleep.pauseStart = null;
          Storage.save(); global.App.rerender();
        }
      });
      var sEnd = view.querySelector('#sEnd');
      if (sEnd) sEnd.addEventListener('click', function () {
        var os2 = d.openSleep;
        var end = Date.now();
        var paused = (os2.pausedMs || 0) + (os2.pauseStart ? end - os2.pauseStart : 0);
        d.sleeps.push({ id: os2.id, start: os2.start, end: Util.nowLocal(), pausedMs: paused, note: null });
        d.openSleep = null;
        Storage.save(); global.App.rerender();
      });
      Array.prototype.forEach.call(view.querySelectorAll('[data-del]'), function (b) {
        b.addEventListener('click', function () {
          var id = b.getAttribute('data-del');
          Util.removeWithUndo(d.sleeps, id, {
            onSave: function () { Storage.save(); },
            onAfter: function () { global.App.rerender(); },
            deletedText: '已删除睡眠记录'
          });
        });
      });
    }
  };

  setInterval(tick, 1000);
})(window);
