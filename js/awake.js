/* 第 194 次：计时时保持屏幕常亮（Screen Wake Lock）。
 * 只在「需要盯着屏幕」的计时里开：宫缩计时、胎动计数会话、亲喂计时。
 * 睡眠计时、洗澡/游泳/日晒刻意不开——宝宝睡一整夜，屏幕亮一整夜既费电又晃眼。
 * 触发：每次 Storage.save 之后、页面回到前台时重新对一次（系统切后台会自动释放锁）。
 * 设置：settings.keepAwake（默认开，false = 关）。不支持的浏览器静默跳过（iOS 16.4+ / 主屏 PWA 18.4+ 才稳）。 */
(function (global) {
  'use strict';
  var lock = null, want = false, busy = false;

  function need() {
    try {
      var d = global.Storage && Storage.get();
      if (!d || (d.settings && d.settings.keepAwake === false)) return false;
      return !!(d.openContraction || d.fetalSession || d.feedingTimer);
    } catch (e) { return false; }
  }

  function sync() {
    want = need();
    if (!('wakeLock' in navigator)) return;
    if (want && !lock && !busy && document.visibilityState === 'visible') {
      busy = true;
      navigator.wakeLock.request('screen').then(function (l) {
        busy = false; lock = l;
        l.addEventListener('release', function () { if (lock === l) lock = null; });
        if (!need()) { l.release().catch(function () {}); }
      }).catch(function () { busy = false; });
    } else if (!want && lock) {
      var l2 = lock; lock = null;
      l2.release().catch(function () {});
    }
  }

  function hook() {
    if (!global.Storage || Storage._awakeHooked) return;
    var orig = Storage.save;
    Storage.save = function () {
      var r = orig.apply(this, arguments);
      try { setTimeout(sync, 0); } catch (e) {}
      return r;
    };
    Storage._awakeHooked = true;
  }

  hook();
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') sync(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sync); else setTimeout(sync, 0);

  global.Awake = { sync: sync, active: function () { return !!lock; }, supported: function () { return 'wakeLock' in navigator; } };
})(window);
