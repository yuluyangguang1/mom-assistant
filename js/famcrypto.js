/**
 * famcrypto.js —— 第 332 次：家庭共享的加密与本机密钥仓库（页面与 Service Worker 共用，不依赖 DOM）
 *
 * 一、家庭密钥：32 字节随机数，只存本机 IndexedDB（yiya-family / kv / 'cred'），只经二维码 / 家庭码从手机传到手机，
 *    永远不发给服务器、不进导出文件、不进 localStorage。SW 也从同一个 IndexedDB 读它来解密推送。
 * 二、子密钥：HKDF-SHA256(家庭密钥, salt='yiya/v1/hkdf')，info 分别为
 *      'yiya/v1/msg'  → AES-256-GCM 消息密钥（不可导出）
 *      'yiya/v1/push' → AES-256-GCM 推送密钥（不可导出）
 *      'yiya/v1/fp'   → 256 位指纹（十六进制；二维码里放前 8 位，界面显示「a1b2-c3d4」给两台手机对一眼）
 *    三把互相独立：知道指纹推不出密钥，推送密钥泄露也解不开记录。
 * 三、密文格式：base64url( 0x01 版本字节 ‖ 随机 96 位 IV ‖ AES-GCM 密文+128 位标签 )
 *    消息 AAD = 'yiya/v1|<familyId>|<发送设备 ID>|<kind>'；推送 AAD = 'yiya/v1/push|<familyId>|<发送设备 ID>|<kind>'。
 *    AAD 里的 familyId / from / kind 都取「服务器告诉我的」那一份：服务器或中间人换了任何一项，GCM 校验直接失败。
 * 四、FamPush.text()：推送解密后生成通知文字的唯一出口（SW 与回归测试共用）。只认白名单动作，
 *    文字只有「称呼 + 动作」（如「爸爸 叫你过来一下」），绝不带任何记录 / 健康数据；任何一步不对就回通用文案。
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
  var PUSH_ACTS = { come: '叫你过来一下' };
  var GENERIC = { title: '咿呀', body: '家里有新消息' };
  function cleanName(s) {
    if (typeof s !== 'string') return '';
    return s.replace(/[\u0000-\u001f\u007f-\u009f<>&"'`\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 8);
  }
  /** data = 服务器转来的推送负载 {t, f, from, ct, at}；cred = 本机 IndexedDB 里的家庭凭据；names = {deviceId: 称呼} */
  function pushText(data, cred, names) {
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
        return { title: '咿呀', body: nm + ' ' + PUSH_ACTS[data.t], ok: true };
      });
    }).catch(function () { return { title: GENERIC.title, body: GENERIC.body, ok: false }; });
  }

  G.FamCrypto = {
    b64u: b64u, unb64u: unb64u, genKey: genKey, deriveKeys: deriveKeys,
    aad: aad, pushAad: pushAad, encrypt: encrypt, decrypt: decrypt, cleanName: cleanName
  };
  G.FamDB = FamDB;
  G.FamPush = { text: pushText, ACTS: PUSH_ACTS, GENERIC: GENERIC };
})(typeof self !== 'undefined' ? self : this);
