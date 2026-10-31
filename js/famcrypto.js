/**
 * famcrypto.js —— 第 332 次：家庭共享的加密与本机密钥仓库（页面与 Service Worker 共用，不依赖 DOM）
 *
 * 一、家庭密钥：32 字节随机数，只存本机 IndexedDB（yiya-family / kv / 'cred'），只经二维码 / 家庭码从手机传到手机，
 *    永远不发给服务器、不进导出文件、不进 localStorage。SW 也从同一个 IndexedDB 读它来解密推送。
 * 二、子密钥：HKDF-SHA256(家庭密钥, salt='yiya/v1/hkdf')，info 分别为
 *      'yiya/v1/msg'  → AES-256-GCM 消息密钥（不可导出）
 *      'yiya/v1/push' → AES-256-GCM 推送密钥（不可导出）
 *      'yiya/v1/fp'   → 256 位指纹（十六进制；二维码里放前 16 位，界面显示「a1b2-c3d4-e5f6-0718」（64 位）给两台手机对一眼）
 *    三把互相独立：知道指纹推不出密钥，推送密钥泄露也解不开记录。
 * 三、密文格式：base64url( 0x01 版本字节 ‖ 随机 96 位 IV ‖ AES-GCM 密文+128 位标签 )
 *    消息 AAD = 'yiya/v1|<familyId>|<发送设备 ID>|<kind>'；推送 AAD = 'yiya/v1/push|<familyId>|<发送设备 ID>|<kind>'。
 *    AAD 里的 familyId / from / kind 都取「服务器告诉我的」那一份：服务器或中间人换了任何一项，GCM 校验直接失败。
 * 四、FamPush.text()：推送解密后生成通知文字的唯一出口（SW 与回归测试共用）。只认白名单动作，
 *    文字只有「称呼 + 动作」（如「爸爸 叫你过来一下」「爸爸 记了一次瓶喂」），绝不带量、备注等记录内容；任何一步不对就回通用文案。
 * 五、第 335 次：本机提醒密钥（FamRemind）。和家庭无关、每台手机各一把：32 字节随机数，只存 IndexedDB（yiya-family / kv / 'rcred'），
 *    永远不发服务器。HKDF(salt='yiya/v1/hkdf', info='yiya/v1/remind') → AES-256-GCM；AAD = 'yiya/v1/remind|<提醒设备 ID>|<提醒 ID>'。
 *    服务器只存「到点时间 + 这份密文 + 推送订阅」，到点原样推给 SW，SW 用同一把密钥解开再 showNotification；解不开 → 「咿呀记有一条提醒」。
 *    FamRemind.text() 是提醒通知文字的唯一出口：类型白名单、纯文本清洗（去控制字符 / 双向覆盖符、限长）、「锁屏不显示详情」时只给通用文案。
 */
(function (G) {
  'use strict';
  var te = new TextEncoder(), td = new TextDecoder();
  var subtle = G.crypto && G.crypto.subtle;

  /* ---------- base64url ---------- */
  function b64u(bytes) {
    var u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), s = '';
    for (var i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function unb64u(s) {
    if (typeof s !== 'string' || !/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) return null;
    var p = s.replace(/-/g, '+').replace(/_/g, '/');
    while (p.length % 4) p += '=';
    try {
      var bin = atob(p), out = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    } catch (e) { return null; }
  }
  function hex(buf) {
    var u8 = new Uint8Array(buf), s = '';
    for (var i = 0; i < u8.length; i++) s += (u8[i] < 16 ? '0' : '') + u8[i].toString(16);
    return s;
  }

  var SALT = te.encode('yiya/v1/hkdf');
  var keyCache = { raw: null, p: null };

  function genKey() {
    var k = new Uint8Array(32);
    G.crypto.getRandomValues(k);
    return k;
  }

  /** 从 32 字节家庭密钥派生 { msg, push, fp }（同一把密钥只派生一次） */
  function deriveKeys(raw) {
    if (!(raw instanceof Uint8Array) || raw.length !== 32) return Promise.reject(new Error('bad_key'));
    var tag = b64u(raw);
    if (keyCache.raw === tag && keyCache.p) return keyCache.p;
    var p = subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey', 'deriveBits']).then(function (base) {
      function sub(info) {
        return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: SALT, info: te.encode(info) }, base,
          { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      }
      return Promise.all([
        sub('yiya/v1/msg'), sub('yiya/v1/push'),
        subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: SALT, info: te.encode('yiya/v1/fp') }, base, 256)
      ]).then(function (r) { return { msg: r[0], push: r[1], fp: hex(r[2]) }; });
    });
    keyCache = { raw: tag, p: p };
    p.catch(function () { if (keyCache.p === p) keyCache = { raw: null, p: null }; });
    return p;
  }

  function aad(familyId, from, kind) { return 'yiya/v1|' + familyId + '|' + from + '|' + kind; }
  function pushAad(familyId, from, kind) { return 'yiya/v1/push|' + familyId + '|' + from + '|' + kind; }

  function encrypt(key, aadStr, obj) {
    var iv = new Uint8Array(12);
    G.crypto.getRandomValues(iv);
    return subtle.encrypt({ name: 'AES-GCM', iv: iv, additionalData: te.encode(aadStr), tagLength: 128 }, key,
      te.encode(JSON.stringify(obj))).then(function (ct) {
      var c = new Uint8Array(ct), out = new Uint8Array(13 + c.length);
      out[0] = 1; out.set(iv, 1); out.set(c, 13);
      return b64u(out);
    });
  }

  /** 解密失败（错密钥 / 篡改 / AAD 不符 / 格式不对）一律 reject，调用方丢弃并计数 */
  function decrypt(key, aadStr, ct, maxChars) {
    return Promise.resolve().then(function () {
      if (typeof ct !== 'string' || ct.length > (maxChars || 360000)) throw new Error('bad_ct');
      var u8 = unb64u(ct);
      if (!u8 || u8.length < 13 + 16 || u8[0] !== 1) throw new Error('bad_ct');
      return subtle.decrypt({ name: 'AES-GCM', iv: u8.subarray(1, 13), additionalData: te.encode(aadStr), tagLength: 128 }, key, u8.subarray(13));
    }).then(function (pt) {
      var o = JSON.parse(td.decode(pt));
      if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('bad_pt');
      return o;
    });
  }

  /* ---------- 本机密钥仓库（IndexedDB；页面与 SW 同源共用） ---------- */
  var DBN = 'yiya-family', ST = 'kv';
  function db() {
    return new Promise(function (res, rej) {
      if (!G.indexedDB) { rej(new Error('no_idb')); return; }
      var r = G.indexedDB.open(DBN, 1);
      r.onupgradeneeded = function () { if (!r.result.objectStoreNames.contains(ST)) r.result.createObjectStore(ST); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error || new Error('idb')); };
    });
  }
  function op(mode, fn) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var t = d.transaction(ST, mode), s = t.objectStore(ST), out;
        var rq = fn(s);
        if (rq) rq.onsuccess = function () { out = rq.result; };
        t.oncomplete = function () { d.close(); res(out); };
        t.onerror = t.onabort = function () { d.close(); rej(t.error || new Error('idb_tx')); };
      });
    });
  }
  var FamDB = {
    get: function (k) { return op('readonly', function (s) { return s.get(k); }); },
    set: function (k, v) { return op('readwrite', function (s) { return s.put(v, k); }); },
    del: function (k) { return op('readwrite', function (s) { return s.delete(k); }); },
    clear: function () { return op('readwrite', function (s) { return s.clear(); }); }
  };

  /* ---------- 推送通知文字（SW 唯一出口） ---------- */
  var PUSH_ACTS = { come: '叫你过来一下', rec: '记了一条记录' };
  /* 第 335 次：家人记录的类型白名单（只有类型，没有量 / 备注）→ [文案, 点开去的页] */
  var REC_LABELS = { feed: ['一次喂奶', 'feeding'], breast: ['一次亲喂', 'breast'], bottle: ['一次瓶喂', 'bottle'], solid: ['一次辅食', 'solid'],
    sleep: ['一次睡眠', 'sleep'], diaper: ['一次换尿布', 'diaper'], meds: ['一次用药', 'meds'], temp: ['一次体温', 'temp'],
    sup: ['一次营养品', 'supplement'], bath: ['一次洗澡', 'bath'], growth: ['一次生长', 'growth'], other: ['一条记录', 'home'] };
  var GENERIC = { title: '咿呀', body: '家里有新消息' };
  function cleanName(s) {
    if (typeof s !== 'string') return '';
    return s.replace(/[\u0000-\u001f\u007f-\u009f<>&"'`\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 8);
  }
  /** data = 服务器转来的推送负载 {t, f, from, ct, at}；cred = 本机 IndexedDB 里的家庭凭据；names = {deviceId: 称呼}；
   *  prefs = 本机通知偏好（第 335 次：hide = 锁屏不显示详情） */
  function pushText(data, cred, names, prefs) {
    return Promise.resolve().then(function () {
      if (!data || typeof data !== 'object' || !cred || typeof cred !== 'object') throw new Error('no');
      if (typeof data.f !== 'string' || data.f !== cred.familyId) throw new Error('family');
      if (typeof data.from !== 'string' || !/^d_[A-Za-z0-9_-]{16}$/.test(data.from) || data.from === cred.deviceId) throw new Error('from');
      if (typeof data.t !== 'string' || !PUSH_ACTS.hasOwnProperty(data.t)) throw new Error('kind');
      var raw = unb64u(cred.k);
      if (!raw || raw.length !== 32) throw new Error('key');
      return deriveKeys(raw).then(function (keys) {
        return decrypt(keys.push, pushAad(data.f, data.from, data.t), data.ct, 2048);
      }).then(function (p) {
        if (p.v !== 1 || p.a !== data.t || typeof p.at !== 'number') throw new Error('payload');
        if (Math.abs(Date.now() - p.at) > 864e5) throw new Error('stale');
        var nm = cleanName(p.n) || cleanName(names && names[data.from]) || '家人';
        if (data.t === 'rec') {
          var lb = (typeof p.k === 'string' && REC_LABELS.hasOwnProperty(p.k)) ? REC_LABELS[p.k] : REC_LABELS.other;
          var c = (typeof p.c === 'number' && p.c >= 1 && p.c <= 999) ? Math.floor(p.c) : 1;
          if (prefs && prefs.hide) return { title: '咿呀', body: '家里有新记录', ok: true, go: 'home', tag: 'yiya-fam-rec' };
          return { title: '咿呀', body: nm + ' 记了' + (c > 1 ? ' ' + c + ' 条记录' : lb[0]), ok: true, go: c > 1 ? 'home' : lb[1], tag: 'yiya-fam-rec' };
        }
        return { title: '咿呀', body: nm + ' ' + PUSH_ACTS[data.t], ok: true, go: 'home', tag: 'yiya-come' };
      });
    }).catch(function () { return { title: GENERIC.title, body: GENERIC.body, ok: false, go: 'home', tag: 'yiya-family' }; });
  }

  /* ---------- 第 335 次：本机提醒（与家庭无关） ---------- */
  var rkCache = { raw: null, p: null };
  function remindKey(raw) {
    if (!(raw instanceof Uint8Array) || raw.length !== 32) return Promise.reject(new Error('bad_key'));
    var tag = b64u(raw);
    if (rkCache.raw === tag && rkCache.p) return rkCache.p;
    var p = subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey']).then(function (base) {
      return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: SALT, info: te.encode('yiya/v1/remind') }, base,
        { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    });
    rkCache = { raw: tag, p: p };
    p.catch(function () { if (rkCache.p === p) rkCache = { raw: null, p: null }; });
    return p;
  }
  function remindAad(rdevId, rid) { return 'yiya/v1/remind|' + rdevId + '|' + rid; }
  var REM_KINDS = { feed: '喂奶提醒', sup: '补剂与吃药', vac: '疫苗提醒', chk: '儿保提醒', pre: '产检提醒', timer: '计时提醒', supply: '用品提醒' };
  var REM_GENERIC = { title: '咿呀记', body: '咿呀记有一条提醒' };
  var RID_RE = /^[A-Za-z0-9_-]{1,32}$/, RDEV_RE = /^r_[A-Za-z0-9_-]{16}$/, GO_RE = /^[a-z]{2,16}$/, UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  /** 通知文字一律当纯文本：去控制字符、零宽 / 双向覆盖符，压空白，限长。系统通知本来就不解析 HTML，App 内咿呀岛再 escape 一次 */
  function cleanText(s, max) {
    if (typeof s !== 'string') return '';
    return s.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '').replace(/\s+/g, ' ').trim().slice(0, max || 60);
  }
  /** 把一条提醒加密成服务器要的不透明密文（明文按 192 字节补齐，服务器从长度看不出写了什么） */
  function remindSeal(rcred, item) {
    var raw = unb64u(rcred && rcred.k);
    if (!raw || raw.length !== 32 || !RDEV_RE.test(rcred.deviceId || '') || !RID_RE.test(item.id || '')) return Promise.reject(new Error('bad'));
    var o = { v: 1, id: item.id, k: item.k, ti: cleanText(item.title, 24), b: cleanText(item.body, 80), go: GO_RE.test(item.go || '') ? item.go : 'home' };
    if (item.bid && UUID_RE.test(item.bid)) o.bid = item.bid;
    o.p = '';
    var len = te.encode(JSON.stringify(o)).length;   /* 按 UTF-8 字节补齐：中文 3 字节，按字符数补齐会漏长度 */
    o.p = new Array((192 - (len % 192)) % 192 + 1).join(' ');
    return remindKey(raw).then(function (key) { return encrypt(key, remindAad(rcred.deviceId, item.id), o); });
  }
  /** data = 服务器推来的 {t:'rem', r, id, ct, at}；rcred = 本机提醒凭据；prefs = 本机通知偏好 */
  function remindText(data, rcred, prefs) {
    var gen = { title: REM_GENERIC.title, body: REM_GENERIC.body, ok: false, go: 'home', tag: 'yiya-rem' };
    return Promise.resolve().then(function () {
      if (!data || typeof data !== 'object' || data.t !== 'rem' || !rcred || typeof rcred !== 'object') throw new Error('no');
      if (typeof data.r !== 'string' || data.r !== rcred.deviceId || typeof data.id !== 'string' || !RID_RE.test(data.id)) throw new Error('who');
      gen.tag = 'yiya-rem-' + data.id;
      var raw = unb64u(rcred.k);
      if (!raw || raw.length !== 32) throw new Error('key');
      return remindKey(raw).then(function (key) { return decrypt(key, remindAad(data.r, data.id), data.ct, 2048); }).then(function (p) {
        if (p.v !== 1 || p.id !== data.id || typeof p.k !== 'string' || !REM_KINDS.hasOwnProperty(p.k)) throw new Error('payload');
        var go = GO_RE.test(p.go || '') ? p.go : 'home';
        var bid = (typeof p.bid === 'string' && UUID_RE.test(p.bid)) ? p.bid : null;
        if (prefs && prefs.hide) return { title: REM_GENERIC.title, body: REM_GENERIC.body, ok: true, go: go, bid: bid, tag: gen.tag, k: p.k };
        var ti = cleanText(p.ti, 24) || REM_KINDS[p.k], b = cleanText(p.b, 80) || REM_GENERIC.body;
        return { title: ti, body: b, ok: true, go: go, bid: bid, tag: gen.tag, k: p.k };
      });
    }).catch(function () { return gen; });
  }

  G.FamCrypto = {
    b64u: b64u, unb64u: unb64u, genKey: genKey, deriveKeys: deriveKeys,
    aad: aad, pushAad: pushAad, encrypt: encrypt, decrypt: decrypt, cleanName: cleanName
  };
  G.FamDB = FamDB;
  G.FamPush = { text: pushText, ACTS: PUSH_ACTS, GENERIC: GENERIC, REC_LABELS: REC_LABELS };
  G.FamRemind = { key: remindKey, aad: remindAad, seal: remindSeal, text: remindText, clean: cleanText, KINDS: REM_KINDS, GENERIC: REM_GENERIC };
})(typeof self !== 'undefined' ? self : this);
