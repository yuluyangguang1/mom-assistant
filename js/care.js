/**
 * care.js - 照料类会话式记录（第 138 次 · 洗澡 / 游泳 / 日晒）
 *
 * 背景：《操作层差距》第二条 P0。这三个模块此前只能「事后填时长」，
 * 等于没有「进行中」的概念——Cali 把它们做成 ActiveSession + LiveSession 实时场景。
 *
 * 为什么单独一个文件而不是三个模块各写一遍：
 *   三个模块的开始/结束/取消逻辑完全相同，写成三份必然漂移。
 *   与 sky.js / reminders.js / knowledge.js 同属「核心层单例」——
 *   在 index.html 里先于 modules 加载，模块 render 时 Care 一定在位。
 *
 * 数据：d.openCare = { kind: 'bath'|'swim'|'sun', start }
 * 一个全局槽位：宝宝不可能同时在洗澡和晒太阳，一个槽位足够，也不会有状态打架。
 */
(function (global) {
  'use strict';

  var KINDS = {
    bath: { title: '洗澡', accent: 'bath' },
    swim: { title: '游泳', accent: 'swim' },
    sun: { title: '日晒', accent: 'sun' }
  };

  var Care = {
    KINDS: KINDS,

    /** 当前进行中的照料会话；无则 null */
    open: function (d) {
      var c = d && d.openCare;
      return (c && c.start && KINDS[c.kind]) ? c : null;
    },

    /** 这个模块自己是否正在进行中 */
    mine: function (d, kind) {
      var c = Care.open(d);
      return (c && c.kind === kind) ? c : null;
    },

    /** 别的照料正在进行中？用于给出「另一项也在计时」的提示，而不是静默替换 */
    other: function (d, kind) {
      var c = Care.open(d);
      return (c && c.kind !== kind) ? c : null;
    },

    /** 开始计时。已有任何会话时返回 false（由调用方决定提示什么） */
    start: function (d, Storage, kind) {
      if (!KINDS[kind]) return false;
      if (Care.open(d)) return false;
      d.openCare = { kind: kind, start: Util.nowLocal() };
      return Storage.save();
    },

    /** 结束计时：写一条 { kind 自己的字段 } 到对应列表，返回刚落的记录（供 Toast 引用）。
        start 不可解析（脏数据）时按取消处理，不落一条 0 分钟的记录。 */
    finish: function (d, Storage, kind) {
      var c = Care.mine(d, kind);
      if (!c) return null;
      var ms = Date.now() - new Date(c.start).getTime();
      d.openCare = null;
      if (!isFinite(ms) || ms < 0) {
        Storage.save();
        return { minutes: null, cancelled: true };
      }
      /* 分钟数向上取整：婴儿洗澡 8 分钟比 7 分钟更有意义，且永远不为 0 */
      var minutes = Math.max(1, Math.round(ms / 60000));
      var rec = { id: Util.uid(), time: c.start, minutes: minutes, note: null };
      if (kind === 'sun') rec.area = 'all';
      d[kind === 'bath' ? 'baths' : (kind === 'swim' ? 'swims' : 'suns')].push(rec);
      Storage.save();
      return { record: rec, minutes: minutes };
    },

    /** 取消计时：不落库 */
    cancel: function (d, Storage) {
      d.openCare = null;
      return Storage.save();
    },

    /** 已计时毫秒数（进行中）或 0 */
    elapsed: function (d, kind) {
      var c = Care.mine(d, kind);
      if (!c) return 0;
      var ms = Date.now() - new Date(c.start).getTime();
      return (isFinite(ms) && ms > 0) ? ms : 0;
    }
  };

  var Util = global.Util;
  global.Care = Care;
})(window);
