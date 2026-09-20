/**
 * storage.js - 本地数据持久化层（localStorage）
 * 全量数据存于单一 key，结构为 JSON。无云端、无账号。
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'momhelper_data_v1';

  function defaultData() {
    return {
      version: 1,
      settings: { theme: 'light', privacyAccepted: false, baby: null },
      periods: [],
      pregnancy: { lmp: null, dueDate: null },
      prenatal: { checks: [], records: [] },
      feedings: [],
      sleeps: [],
      openSleep: null,
      contractions: [],
      openContraction: null,
      growth: [],
      packing: { seeded: false, items: [] },
      finance: { records: [] }
    };
  }

  var Storage = {
    data: null,

    /** 从 localStorage 读取；缺失或损坏则用默认值 */
    load: function () {
      try {
        var raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          this.data = JSON.parse(raw);
          this.migrate();
        } else {
          this.data = defaultData();
        }
      } catch (e) {
        this.data = defaultData();
      }
      return this.data;
    },

    /** 写入 localStorage */
    save: function () {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
        return true;
      } catch (e) {
        return false;
      }
    },

    get: function () { return this.data; },

    /** 清空全部数据 */
    reset: function () {
      this.data = defaultData();
      this.save();
    },

    /** 导出为格式化的 JSON 文本 */
    exportJSON: function () {
      return JSON.stringify(this.data, null, 2);
    },

    /** 从 JSON 文本导入（与默认值合并，避免缺字段） */
    importJSON: function (text) {
      var parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object') throw new Error('数据格式错误');
      var base = defaultData();
      for (var k in parsed) {
        if (parsed.hasOwnProperty(k)) base[k] = parsed[k];
      }
      this.data = base;
      this.save();
    },

    /** 补全缺失字段（兼容旧数据） */
    migrate: function () {
      var base = defaultData();
      for (var k in base) {
        if (!(k in this.data)) this.data[k] = base[k];
      }
    }
  };

  global.Storage = Storage;
})(window);
