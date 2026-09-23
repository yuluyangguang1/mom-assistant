/**
 * storage.js - 本地数据持久化层（localStorage）
 * 全量数据存于单一 key，结构为 JSON。无云端、无账号。
 *
 * v2 数据韧性加固（2026-09-20）：
 * 1. 损坏自愈：load() 解析失败时，先把损坏原文备份到 _corrupt_backup key 再回退默认值，
 *    用户可通过导出调试找回，绝不静默丢数据。
 * 2. 保存告警：save() 配额满/异常时返回 false 并弹 toast 提醒（此前静默失败）。
 * 3. 导入清洗：importJSON 逐字段校验类型（数组/对象/形状），非法字段回退默认，
 *    非法记录整条过滤，杜绝「导入一个坏文件把应用搞坏」。
 * 4. 版本迁移脚手架：DATA_VERSION 驱动 migrate()，按版本号逐步升级旧数据。
 * 5. settings.lastExportISO：记录上次导出时间，供「备份提醒」使用。
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'momhelper_data_v1';
  var CORRUPT_BACKUP_KEY = 'momhelper_data_v1_corrupt_backup';
  var DATA_VERSION = 2;

  /* 数组型字段（记录列表） */
  var ARRAY_KEYS = ['periods', 'feedings', 'sleeps', 'contractions', 'growth', 'diapers', 'meds', 'milestones'];
  /* 对象型字段（嵌套容器） */
  var OBJECT_KEYS = ['pregnancy', 'prenatal', 'packing', 'finance', 'vaccines'];

  function defaultData() {
    return {
      version: DATA_VERSION,
      settings: { theme: 'light', privacyAccepted: false, baby: null, realRefraction: true, lastExportISO: null },
      periods: [],
      pregnancy: { lmp: null, dueDate: null },
      prenatal: { checks: [], records: [] },
      feedings: [],
      sleeps: [],
      openSleep: null,
      contractions: [],
      openContraction: null,
      growth: [],
      diapers: [],
      meds: [],
      milestones: [],
      packing: { seeded: false, items: [] },
      finance: { records: [] },
      vaccines: { done: {} }
    };
  }

  /** 浅校验：数组字段必须是数组且每项是对象；对象字段必须是对象 */
  function sanitize(raw) {
    var base = defaultData();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
    /* settings 浅合并，只保留已知键的合法类型 */
    if (raw.settings && typeof raw.settings === 'object' && !Array.isArray(raw.settings)) {
      var s = raw.settings;
      if (s.theme === 'dark' || s.theme === 'light') base.settings.theme = s.theme;
      if (typeof s.privacyAccepted === 'boolean') base.settings.privacyAccepted = s.privacyAccepted;
      if (s.baby && typeof s.baby === 'object') base.settings.baby = s.baby;
      if (typeof s.realRefraction === 'boolean') base.settings.realRefraction = s.realRefraction;
      if (typeof s.lastExportISO === 'string') base.settings.lastExportISO = s.lastExportISO;
    }
    ARRAY_KEYS.forEach(function (k) {
      if (Array.isArray(raw[k])) {
        base[k] = raw[k].filter(function (r) { return r && typeof r === 'object' && !Array.isArray(r); });
      }
    });
    OBJECT_KEYS.forEach(function (k) {
      if (raw[k] && typeof raw[k] === 'object' && !Array.isArray(raw[k])) base[k] = raw[k];
    });
    if (raw.openSleep && typeof raw.openSleep === 'object') base.openSleep = raw.openSleep;
    if (raw.openContraction && typeof raw.openContraction === 'object') base.openContraction = raw.openContraction;
    return base;
  }

  var Storage = {
    data: null,

    /** 从 localStorage 读取；缺失用默认值；损坏则备份原文后回退默认值 */
    load: function () {
      var raw = null;
      try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
      if (!raw) { this.data = defaultData(); return this.data; }
      try {
        this.data = sanitize(JSON.parse(raw));
        this.migrate();
      } catch (e) {
        /* 损坏自愈：备份原文，再回退默认值。用户数据不静默丢失。 */
        try { localStorage.setItem(CORRUPT_BACKUP_KEY, raw); } catch (e2) {}
        this.data = defaultData();
        this._corruptRecovered = true;
      }
      return this.data;
    },

    /** 写入 localStorage；配额满/异常时弹 toast 告警并返回 false */
    save: function () {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
        return true;
      } catch (e) {
        if (global.Util && Util.toast) {
          Util.toast('保存失败：本地存储空间不足，请导出备份后清理旧记录。', 'error');
        }
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

    /** 从 JSON 文本导入（逐字段清洗，坏字段回退默认而非搞坏整个应用） */
    importJSON: function (text) {
      var parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('数据格式错误');
      this.data = sanitize(parsed);
      this.save();
    },

    /**
     * 版本迁移脚手架：按 version 逐步升级旧数据。
     * 新增结构变更时，在这里追加 if (v < N) { ...; v = N } 即可。
     */
    migrate: function () {
      var v = this.data.version || 1;
      /* v1 → v2：settings 补 lastExportISO（sanitize 已兜底，这里只升版本号） */
      if (v < 2) { v = 2; }
      this.data.version = v;
    },

    /** 数据是否「有内容」（任一记录数组非空）——供备份提醒判断 */
    hasData: function () {
      var d = this.data;
      if (!d) return false;
      return ARRAY_KEYS.some(function (k) { return (d[k] || []).length > 0; })
        || (d.packing && d.packing.items && d.packing.items.length > 0)
        || (d.finance && d.finance.records && d.finance.records.length > 0)
        || (d.prenatal && d.prenatal.records && d.prenatal.records.length > 0);
    },

    /** 各模块记录数统计（设置页用） */
    stats: function () {
      var d = this.data || {};
      return [
        { key: 'feeding', name: '喂养', count: (d.feedings || []).length },
        { key: 'diaper', name: '尿布', count: (d.diapers || []).length },
        { key: 'sleep', name: '睡眠', count: (d.sleeps || []).length },
        { key: 'growth', name: '生长', count: (d.growth || []).length },
        { key: 'vaccine', name: '疫苗', count: (d.vaccines && d.vaccines.done ? Object.keys(d.vaccines.done).length : 0) },
        { key: 'meds', name: '吃药/维D', count: (d.meds || []).length },
        { key: 'milestone', name: '里程碑', count: (d.milestones || []).length },
        { key: 'period', name: '经期', count: (d.periods || []).length },
        { key: 'contraction', name: '宫缩', count: (d.contractions || []).length },
        { key: 'packing', name: '待产包', count: (d.packing && d.packing.items ? d.packing.items.length : 0) },
        { key: 'finance', name: '记账', count: (d.finance && d.finance.records ? d.finance.records.length : 0) },
        { key: 'pregnancy', name: '产检', count: (d.prenatal && d.prenatal.records ? d.prenatal.records.length : 0) }
      ];
    }
  };

  global.Storage = Storage;
})(window);
