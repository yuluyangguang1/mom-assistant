/**
 * famsync.js —— 第 332 次：家庭共享的同步引擎（端到端加密中转）
 *
 * 服务器（默认 https://api.yiya.help/v1）只看得到：随机 familyId / deviceId、令牌哈希、空的设备名、密文、推送订阅。
 * 家庭密钥、token 只在 IndexedDB（FamDB 'cred'）；同步游标 / 出站队列 / 成员称呼等非机密状态在 localStorage 'yiya_fam_state'，
 * 二者都不在 Storage.data 里，所以不会进导出文件；退出 / 被移除时整份删除，本地记录保留。
 *
 * 防串家庭（收到每条消息依次过五关，任何一关不过 → 丢弃并计数，绝不显示内容）：
 *   1. 外层形状：seq / from / kind / ct 类型与格式、kind 在白名单；from 是自己 → 跳过；
 *   2. AES-GCM 解密，AAD = yiya/v1|<本机 familyId>|<服务器给的 from>|<服务器给的 kind>——错家庭的密钥、篡改密文、篡改 AAD 都过不了；
 *   3. 明文里再核对 v=1、familyId == 本机家庭、from == 服务器给的 from、kind 一致、sentAt 合理；
 *   4. 每条实体 schema 严格校验（类型白名单、字段名、字段类型、字符串长度、数值范围、时间可解析、id 字符集）；
 *   5. 防串宝宝：实体的 babyId 必须同时在消息声明的 babyIds 里、且在「本家共享宝宝清单」里；用品 / 储奶只在本机打开了「共享用品与储奶」时收。
 * 合并：记录级 LWW，比较 (updatedAt, by)，墓碑同样参与，绝不整体覆盖（见 storage.js Meta.apply）。
 */
(function (global) {
  'use strict';
  var Storage = global.Storage, Util = global.Util;
  var FC = global.FamCrypto, DB = global.FamDB;
  var Meta = Storage && Storage.Meta;

  var DEFAULT_SERVER = 'https://api.yiya.help';
  var LS_STATE = 'yiya_fam_state', LS_SELF = 'yiya_fam_selfids', LS_SERVER = 'yiya_fam_server';
  var FAMILY_RE = /^f_[A-Za-z0-9_-]{22}$/, DEVICE_RE = /^d_[A-Za-z0-9_-]{16}$/, INVITE_RE = /^[A-Za-z0-9_-]{22}$/;
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  var SAFE_ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
  var KINDS = { rec: 1, snap: 1, hello: 1, meta: 1 };
  var CHUNK_CHARS = 140000;          /* 明文 ≤140K → base64url 密文约 187K 字符（≤200KB，服务器上限 350K） */
  var TIMEOUT_MS = 15000;            /* 跨境链路延迟高，超时放宽到 15 秒 */
  var POLL_MS = 25000;               /* 前台时每 25 秒拉一次 */
  var NAME_MAX = 8;

  /* ---------- 小工具 ---------- */
  function now() { return Date.now(); }
  function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }
  function cleanName(s) { return FC.cleanName(s).slice(0, NAME_MAX); }
  function originOf(fid) { return 'f:' + Meta.uuidFrom('yiya-origin|' + fid).replace(/-/g, '').slice(0, 8); }
  function fmtFp(fp) { return fp ? (fp.slice(0, 16).match(/.{4}/g) || []).join('-') : ''; }   /* 64 位，四组 */
  function serverOk(u) {
    if (typeof u !== 'string' || u.length > 200) return false;
    var x; try { x = new URL(u); } catch (e) { return false; }
    if (x.username || x.password || x.search || x.hash) return false;
    if (x.protocol === 'https:') return true;
    return x.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(x.hostname);   /* 只给本机测试用 */
  }
  function normServer(u) { return String(u || '').replace(/\/+$/, '').replace(/\/v1$/, ''); }

  /* ---------- 状态 ---------- */
  var cred = null;     /* { v, server, familyId, deviceId, token, k, fp, myName, joinedAt } —— 只在内存 + IndexedDB */
  var keys = null;     /* { msg, push, fp } */
  var st = null;
  var busy = false, timer = 0, debounce = 0, fails = 0, nextAt = 0, started = false, readyP = null;
  var listeners = [];

  function blankState() {
    return { v: 1, cursor: 0, outbox: {}, gen: 0, dropped: 0, why: {}, lastSync: 0, lastErr: null, famBabies: {},
      shareFam: true, members: {}, sameName: [], snapsSent: {}, push: false, helloAt: 0 };
  }
  function loadState() {
    var s = null;
    try { s = JSON.parse(localStorage.getItem(LS_STATE) || 'null'); } catch (e) { s = null; }
    st = isObj(s) && s.v === 1 ? s : blankState();
    var b = blankState();
    Object.keys(b).forEach(function (k) { if (st[k] === undefined || typeof st[k] !== typeof b[k]) st[k] = b[k]; });
    return st;
  }
  function saveState() { try { localStorage.setItem(LS_STATE, JSON.stringify(st)); } catch (e) {} emit(); }
  function emit() { listeners.forEach(function (f) { try { f(); } catch (e) {} }); }
  function drop(why, n) { st.dropped += (n || 1); st.why[why] = (st.why[why] || 0) + (n || 1); }

  function server() {
    if (cred) return cred.server;
    var s = null; try { s = localStorage.getItem(LS_SERVER); } catch (e) {}
    return serverOk(s) ? s : DEFAULT_SERVER;
  }

  /* ---------- 网络 ---------- */
  function api(method, path, body, opt) {
    opt = opt || {};
    var base = opt.server || (cred && cred.server) || server();
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var to = setTimeout(function () { if (ctl) ctl.abort(); }, TIMEOUT_MS);
    var headers = { 'Accept': 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (cred && !opt.noAuth) headers['Authorization'] = 'Bearer ' + cred.deviceId + ':' + cred.token;
    return fetch(base + '/v1' + path, { method: method, headers: headers, body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctl ? ctl.signal : undefined, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' })
      .then(function (res) {
        clearTimeout(to);
        if (res.status === 401 && cred && !opt.noAuth) { kicked(); var e1 = new Error('unauthorized'); e1.status = 401; throw e1; }
        if (res.status === 204) return {};
        return res.json().catch(function () { return {}; }).then(function (j) {
          if (!res.ok) { var e = new Error((j && j.message) || (j && j.error) || ('HTTP ' + res.status)); e.status = res.status; e.code = j && j.error; throw e; }
          return j;
        });
      }, function (err) { clearTimeout(to); var e = new Error(err && err.name === 'AbortError' ? '网络超时' : '网络不通'); e.net = true; throw e; });
  }

  /* ---------- 共享宝宝清单 ---------- */
  function sharedSet() {
    var o = {};
    Object.keys(st.famBabies).forEach(function (id) { if (st.famBabies[id] && st.famBabies[id].s === 1) o[id] = 1; });
    return o;
  }
  function localBaby(id) { return (Storage.get().babies || []).filter(function (b) { return b && b.id === id; })[0] || null; }
  /** 这个宝宝能不能在当前家里共享：来自别的家（退出后留下的）不行 */
  function shareable(b) { return !!(b && (!b.origin || (cred && b.origin === originOf(cred.familyId)))); }
  function setShare(id, on, silent) {
    if (!UUID_RE.test(id)) return false;
    var b = localBaby(id);
    if (on && !shareable(b)) return false;
    var cur = st.famBabies[id];
    st.famBabies[id] = { s: on ? 1 : 0, u: Math.max(now(), cur ? cur.u + 1 : 0), by: cred ? cred.deviceId : 'local' };
    if (on) enqueue(Meta.keysOf(Storage.get(), id));
    saveState();
    if (cred && !silent) { sendMeta().catch(function () {}); kick(); }
    return true;
  }
  function babyList() {
    return Object.keys(st.famBabies).map(function (id) { return { id: id, s: st.famBabies[id].s, u: st.famBabies[id].u }; });
  }
  function mergeBabyList(list) {
    if (!Array.isArray(list)) return 0;
    var n = 0;
    list.slice(0, 50).forEach(function (x) {
      if (!isObj(x) || !UUID_RE.test(x.id) || (x.s !== 0 && x.s !== 1) || typeof x.u !== 'number' || !isFinite(x.u) || x.u > now() + 30 * 864e5) return;
      var cur = st.famBabies[x.id];
      if (!cur || x.u > cur.u) { st.famBabies[x.id] = { s: x.s, u: x.u, by: 'r' }; n++; }
    });
    return n;
  }

  /* ---------- 出站队列 ---------- */
  function enqueue(ks) {
    if (!cred || !ks || !ks.length) return;
    var sh = sharedSet(), n = 0;
    ks.forEach(function (k) {
      var sc = k.slice(0, k.indexOf('|'));
      if (sc === '_') return;
      if (sc === 'fam' ? !st.shareFam : !sh[sc]) return;
      st.gen++; st.outbox[k] = st.gen; n++;
    });
    if (n) saveState();
  }
  function onLocalChange(ks) {
    if (!cred) return;
    /* 远端刚应用进来的条目不回发；同一次落盘里被它连带改动的（如用品账本）照常发 */
    var rk = Storage._remoteKeys;
    if (rk) ks = ks.filter(function (k) { return !rk[k]; });
    enqueue(ks);
    if (Object.keys(st.outbox).length) { clearTimeout(debounce); debounce = setTimeout(function () { tick(); }, 1500); }
  }

  /** 生成一批可发送的实体（只含共享宝宝、只含本家来源），并剥掉媒体 / 本机字段 */
  function entitiesFor(ks) {
    var d = Storage.get(), sh = sharedSet(), myOrigin = originOf(cred.familyId), out = [], dead = [];
    ks.forEach(function (k) {
      var e = Meta.entity(d, k);
      if (!e) { dead.push(k); return; }
      if (e.s === 'fam') {
        if (!st.shareFam || (e.o && e.o !== myOrigin)) { dead.push(k); return; }
      } else {
        var b = localBaby(e.s);
        if (!sh[e.s] || !b || !shareable(b)) { dead.push(k); return; }
      }
      delete e.o;
      if (!e.by || e.by === 'local') e.by = cred.deviceId;
      out.push(e);
    });
    /* 宝宝档案在前：收方先建宝宝再放记录 */
    out.sort(function (a, b) { return (a.t === 'baby' ? 0 : 1) - (b.t === 'baby' ? 0 : 1); });
    return { ents: out, dead: dead };
  }
  function chunk(ents) {
    var parts = [], cur = [], size = 0;
    ents.forEach(function (e) {
      var n = JSON.stringify(e).length + 1;
      if (cur.length && size + n > CHUNK_CHARS) { parts.push(cur); cur = []; size = 0; }
      cur.push(e); size += n;
    });
    if (cur.length) parts.push(cur);
    return parts;
  }
  function envelope(kind, body, babyIds) {
    return { v: 1, familyId: cred.familyId, from: cred.deviceId, kind: kind, babyIds: babyIds || [], sentAt: now(), body: body };
  }
  function post(kind, body, babyIds, to) {
    var env = envelope(kind, body, babyIds);
    return FC.encrypt(keys.msg, FC.aad(cred.familyId, cred.deviceId, kind), env).then(function (ct) {
      var req = { ct: ct, kind: kind };
      if (to) req.to = to;
      return api('POST', '/families/' + cred.familyId + '/messages', req);
    });
  }
  function babyIdsOf(ents) {
    var o = {};
    ents.forEach(function (e) { if (e.s !== 'fam') o[e.s] = 1; });
    return Object.keys(o);
  }
  function sendEnts(kind, ents, to) {
    var parts = chunk(ents), p = Promise.resolve();
    parts.forEach(function (part, i) {
      p = p.then(function () { return post(kind, { ents: part, part: i + 1, of: parts.length }, babyIdsOf(part), to); });
    });
    return p.then(function () { return parts.length; });
  }

  function flush() {
    var ks = Object.keys(st.outbox);
    if (!ks.length) return Promise.resolve(0);
    var snapGen = {};
    ks.forEach(function (k) { snapGen[k] = st.outbox[k]; });
    var r = entitiesFor(ks);
    r.dead.forEach(function (k) { if (st.outbox[k] === snapGen[k]) delete st.outbox[k]; });
    if (!r.ents.length) { saveState(); return Promise.resolve(0); }
    return sendEnts('rec', r.ents).then(function () {
      ks.forEach(function (k) { if (st.outbox[k] === snapGen[k]) delete st.outbox[k]; });
      saveState();
      return r.ents.length;
    });
  }

  function sendMeta(to) {
    if (!cred) return Promise.resolve();
    return post('meta', { name: cred.myName || '', babies: babyList() }, Object.keys(sharedSet()), to);
  }

  /** 给新加入的设备发分片快照（只含共享宝宝 + 打开时的用品储奶），带 to 只给它 */
  function sendSnapshot(to) {
    var d = Storage.get(), ks = [];
    Object.keys(sharedSet()).forEach(function (id) { if (localBaby(id)) ks = ks.concat(Meta.keysOf(d, id)); });
    if (st.shareFam) ks = ks.concat(Meta.keysOf(d, 'fam'));
    var r = entitiesFor(ks);
    return sendMeta([to]).then(function () { return r.ents.length ? sendEnts('snap', r.ents, [to]) : 0; });
  }

  /* ---------- 收 ---------- */
  var TYPE_OK = {};
  Meta.SYNC_BABY_ARR.concat(Meta.SYNC_BABY_MAP, Meta.SYNC_FAM_ARR, ['baby']).forEach(function (t) { TYPE_OK[t] = 1; });
  var FAM_TYPES = {}; Meta.SYNC_FAM_ARR.forEach(function (t) { FAM_TYPES[t] = 1; });
  var MAP_TYPES = {}; Meta.SYNC_BABY_MAP.forEach(function (t) { MAP_TYPES[t] = 1; });
  /* 每类记录必须有的时间字段（可解析） */
  var TIME_FIELD = { feedings: 'start', sleeps: 'start', diapers: 'time', meds: 'time', temps: 'time', baths: 'time', swims: 'time', suns: 'time',
    waters: 'time', jaundices: 'time', supplements: 'time', sicks: 'start', milkStash: 'time', growth: 'date', milestones: 'date' };
  var KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,31}$/;
  var NUM_FIELDS = { amount: 1, amountBm: 1, amountFm: 1, minutes: 1, durationMin: 1, durationL: 1, durationR: 1, secL: 1, secR: 1, value: 1, kg: 1,
    weightKg: 1, heightCm: 1, headCm: 1, ml: 1, qty: 1, price: 1, perDay: 1, wakings: 1, longestMin: 1, pausedMs: 1, pieces: 1, count: 1, temp: 1, cost: 1 };

  /** 通用值校验：深度 ≤3、数组 ≤60、对象键 ≤40、字符串 ≤500、数值有限且 |n|≤1e13 */
  function valOk(v, depth) {
    if (v === null || typeof v === 'boolean') return true;
    if (typeof v === 'number') return isFinite(v) && Math.abs(v) <= 1e13;
    if (typeof v === 'string') return v.length <= 500;
    if (depth >= 3) return false;
    if (Array.isArray(v)) return v.length <= 60 && v.every(function (x) { return valOk(x, depth + 1); });
    if (isObj(v)) {
      var ks = Object.keys(v);
      return ks.length <= 40 && ks.every(function (k) { return KEY_RE.test(k) && valOk(v[k], depth + 1); });
    }
    return false;
  }
  function timeOk(s) { return typeof s === 'string' && s.length <= 25 && /^\d{4}-\d{2}-\d{2}/.test(s) && !isNaN(new Date(s.length === 10 ? s + 'T00:00:00' : s).getTime()); }

  function cleanRecord(t, r) {
    if (!isObj(r)) return null;
    var ks = Object.keys(r);
    if (ks.length > 60) return null;
    var o = {};
    for (var i = 0; i < ks.length; i++) {
      var k = ks[i], v = r[k];
      if (!KEY_RE.test(k)) return null;
      if (Meta.META_KEYS[k] || Meta.MEDIA_KEYS[k]) continue;        /* 元数据以实体外层为准；照片不同步 */
      if (!valOk(v, 1)) return null;
      if (NUM_FIELDS[k] && v !== null && typeof v !== 'number') return null;
      if ((/Id$/.test(k) || k === 'id') && v !== null && (typeof v !== 'string' || !SAFE_ID_RE.test(v))) return null;
      o[k] = v;
    }
    var tf = TIME_FIELD[t];
    if (tf && !timeOk(o[tf])) return null;
    ['start', 'end', 'time', 'date'].forEach(function (f) { if (o[f] != null && o[f] !== '' && !timeOk(o[f])) o.__bad = 1; });
    if (o.__bad) return null;
    return o;
  }
  function cleanBaby(r) {
    if (!isObj(r)) return null;
    var o = {
      name: (typeof r.name === 'string' && r.name.trim()) ? r.name.trim().slice(0, 12) : '宝宝',
      nickname: typeof r.nickname === 'string' ? r.nickname.trim().slice(0, 12) : '',
      birthDate: (typeof r.birthDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.birthDate)) ? r.birthDate : null,
      sex: (r.sex === 'girl' || r.sex === 'boy') ? r.sex : null,
      preterm: r.preterm === true,
      birthGestWeeks: (typeof r.birthGestWeeks === 'number' && r.birthGestWeeks >= 22 && r.birthGestWeeks <= 43) ? Math.round(r.birthGestWeeks) : null,
      birthLunar: null
    };
    var L = r.birthLunar;
    if (isObj(L) && typeof L.y === 'number' && L.y >= 1900 && L.y <= 2100 && typeof L.m === 'number' && L.m >= 1 && L.m <= 12 && typeof L.d === 'number' && L.d >= 1 && L.d <= 30)
      o.birthLunar = { y: Math.round(L.y), m: Math.round(L.m), d: Math.round(L.d), leap: L.leap === true };
    return o;
  }
  function cleanMapVal(t, v) {
    if (t === 'vaccines.done' || t === 'checkups.done') return (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) ? v : undefined;
    if (t === 'vaccines.via') return (typeof v === 'string' && v.length <= 40) ? v : undefined;
    if (t === 'vaccines.notes') return (isObj(v) && valOk(v, 1)) ? v : undefined;
    return undefined;
  }
  /** 一条实体的完整校验；返回清洗后的实体或 null（附原因） */
  function checkEnt(e, env, why) {
    if (!isObj(e) || typeof e.t !== 'string' || !TYPE_OK[e.t]) { why.v = 'type'; return null; }
    if (typeof e.s !== 'string' || typeof e.id !== 'string' || !SAFE_ID_RE.test(e.id)) { why.v = 'shape'; return null; }
    if (typeof e.u !== 'number' || !isFinite(e.u) || e.u < 1e12 || e.u > now() + 30 * 864e5) { why.v = 'time'; return null; }
    if (typeof e.by !== 'string' || !/^(d_[A-Za-z0-9_-]{16}|local|fam)$/.test(e.by)) { why.v = 'shape'; return null; }
    if (e.d != null && (typeof e.d !== 'number' || !isFinite(e.d))) { why.v = 'shape'; return null; }
    var fam = FAM_TYPES[e.t] === 1;
    if (fam) {
      if (e.s !== 'fam') { why.v = 'scope'; return null; }
      if (!st.shareFam) { why.v = 'famoff'; return null; }
    } else {
      if (!UUID_RE.test(e.s)) { why.v = 'scope'; return null; }
      /* 防串宝宝：必须在消息声明里、且在本家共享清单里 */
      if (env.babyIds.indexOf(e.s) < 0 || !sharedSet()[e.s]) { why.v = 'baby'; return null; }
      if (e.t === 'baby' && e.id !== e.s) { why.v = 'shape'; return null; }
    }
    var out = { t: e.t, s: e.s, id: e.id, u: e.u, by: e.by === 'local' ? env.from : e.by };
    if (e.d != null) { out.d = e.d; return out; }
    if (e.t === 'baby') { out.r = cleanBaby(e.r); if (!out.r) { why.v = 'schema'; return null; } return out; }
    if (MAP_TYPES[e.t]) {
      if (!/^[A-Za-z0-9_.:-]{1,64}$/.test(e.id)) { why.v = 'schema'; return null; }
      out.v = cleanMapVal(e.t, e.v);
      if (out.v === undefined) { why.v = 'schema'; return null; }
      return out;
    }
    out.r = cleanRecord(e.t, e.r);
    if (!out.r || (out.r.id != null && out.r.id !== e.id)) { why.v = 'schema'; return null; }
    out.r.id = e.id;
    return out;
  }

  function handle(m) {
    /* 第 1 关：外层形状 */
    if (!isObj(m) || !Number.isSafeInteger(m.seq) || typeof m.from !== 'string' || !DEVICE_RE.test(m.from)
      || typeof m.kind !== 'string' || !KINDS[m.kind] || typeof m.ct !== 'string') { drop('shape'); return Promise.resolve(); }
    if (m.from === cred.deviceId) return Promise.resolve();
    /* 第 2 关：解密（AAD 用本机 familyId + 服务器给的 from / kind） */
    return FC.decrypt(keys.msg, FC.aad(cred.familyId, m.from, m.kind), m.ct).then(function (env) {
      /* 第 3 关：明文核对 */
      if (env.v !== 1 || env.familyId !== cred.familyId || env.from !== m.from || env.kind !== m.kind
        || typeof env.sentAt !== 'number' || !isFinite(env.sentAt) || env.sentAt > now() + 30 * 864e5
        || !Array.isArray(env.babyIds) || env.babyIds.length > 50 || !env.babyIds.every(function (x) { return typeof x === 'string' && UUID_RE.test(x); })
        || !isObj(env.body)) { drop('meta'); return; }
      return route(m, env);
    }, function () { drop('decrypt'); });
  }

  function memberName(id, name) {
    var n = cleanName(name);
    if (!DEVICE_RE.test(id)) return;
    st.members[id] = { name: n, u: now() };
    syncNamesToSW();
  }

  function route(m, env) {
    var b = env.body;
    if (m.kind === 'hello' || m.kind === 'meta') {
      if (typeof b.name === 'string') memberName(m.from, b.name);
      mergeBabyList(b.babies);
      saveState();
      if (m.kind === 'hello') return sendSnapshot(m.from).then(function () { st.snapsSent[m.from] = now(); saveState(); }).catch(function () {});
      return;
    }
    /* rec / snap */
    if (!Array.isArray(b.ents) || b.ents.length > 5000) { drop('schema'); return; }
    var ok = [], why = {};
    b.ents.forEach(function (e) {
      why.v = null;
      var c = checkEnt(e, env, why);
      if (c) ok.push(c); else if (why.v !== 'famoff') drop(why.v || 'schema');
    });
    if (!ok.length) return;
    ok.sort(function (a, z) { return (a.t === 'baby' ? 0 : 1) - (z.t === 'baby' ? 0 : 1); });
    applyEnts(ok);
  }

  function applyEnts(ents) {
    var d = Storage.get();
    var before = {};
    (d.babies || []).forEach(function (b) { before[b.id] = b; });
    var origin = originOf(cred.familyId);
    /* 记录所属宝宝本机还没有（档案实体没到）：先建一个占位宝宝，记录不丢 */
    ents.forEach(function (e) {
      if (e.s !== 'fam' && e.t !== 'baby' && !before[e.s] && !ents.some(function (x) { return x.t === 'baby' && x.id === e.s; })) {
        ents.unshift({ t: 'baby', s: e.s, id: e.s, u: 1e12, by: e.by, r: { name: '宝宝', nickname: '', birthDate: null, sex: null, preterm: false, birthGestWeeks: null, birthLunar: null } });
        before[e.s] = { _pending: true };
      }
    });
    var res = Storage.applyRemote(ents, { origin: origin, adoptTop: false });
    /* 新来的宝宝：本机已有同名但不同 uuid 的 → 不合并，提示用户 */
    var d2 = Storage.get(), added = [];
    (d2.babies || []).forEach(function (b) { if (!before[b.id] || before[b.id]._pending) added.push(b); });
    added.forEach(function (nb) {
      var same = (d2.babies || []).filter(function (x) { return x.id !== nb.id && x.name === nb.name && nb.name !== '宝宝'; });
      if (same.length && st.sameName.indexOf(nb.id) < 0) {
        st.sameName.push(nb.id);
        if (Util && Util.toast) Util.toast('家里传来一个也叫「' + nb.name + '」的宝宝，和本机的不是同一个档案，先分开显示', 'warn');
      }
    });
    /* 本机本来一个宝宝都没有、顶层也没有任何宝宝记录（比如爸爸刚装上）：把收到的第一个宝宝设为当前宝宝。
       顶层有记录时绝不这样做——否则会把本机那些记录算到别人的宝宝名下。 */
    if (!d2.settings.activeBabyId && (d2.babies || []).length && !Meta.keysOf(d2, '_').length) {
      var hb = d2.babies[0];
      Storage._loadBaby(hb);
      d2.settings.activeBabyId = hb.id;
      Storage._mirrorActive();
      Storage._remoteSaving = true;
      try { Storage.save(); } finally { Storage._remoteSaving = false; }
      Meta.reindex(d2);
    }
    if (res.applied) { st.lastApplied = now(); refreshUI(); }
    return res;
  }

  function refreshUI() {
    try {
      if (!global.App || !App.currentTab) return;
      if (document.querySelector('.modal-mask, [role="dialog"]:not([hidden])')) { st._dirtyUI = 1; return; }
      if (App.currentTab() === 'settings') { if (global.FamUI) FamUI.refresh(); return; }
      App.rerender();
    } catch (e) {}
  }

  function pull() {
    var maxSeq = st.cursor;
    function page() {
      return api('GET', '/families/' + cred.familyId + '/messages?after=' + maxSeq + '&limit=100').then(function (j) {
        var msgs = Array.isArray(j.messages) ? j.messages : [];
        var p = Promise.resolve();
        msgs.forEach(function (m) {
          p = p.then(function () { return handle(m); }).then(function () { if (m && Number.isSafeInteger(m.seq) && m.seq > maxSeq) maxSeq = m.seq; });
        });
        return p.then(function () { return (j.more && msgs.length) ? page() : null; });
      });
    }
    return page().then(function () {
      if (maxSeq > st.cursor) {
        return api('POST', '/families/' + cred.familyId + '/ack', { upTo: maxSeq }).then(function () { st.cursor = maxSeq; saveState(); });
      }
    });
  }

  /** 一轮：先发再收。失败指数退避（5s → 最多 5 分钟） */
  function tick(force) {
    if (!cred || !keys) return Promise.resolve(false);
    if (busy) return Promise.resolve(false);
    if (!force && now() < nextAt) return Promise.resolve(false);
    busy = true;
    var helloP = (!st.helloAt) ? post('hello', { name: cred.myName || '', babies: babyList() }, Object.keys(sharedSet())).then(function () { st.helloAt = now(); saveState(); }) : Promise.resolve();
    return helloP.then(flush).then(pull).then(function () {
      fails = 0; nextAt = 0; st.lastSync = now(); st.lastErr = null; saveState();
      return true;
    }).catch(function (e) {
      if (e && e.status === 401) return false;
      fails++; nextAt = now() + Math.min(300000, 5000 * Math.pow(2, fails - 1));
      if (st) { st.lastErr = (e && e.message) || '同步失败'; saveState(); }
      return false;
    }).then(function (r) { busy = false; return r; });
  }

  function loop() {
    clearInterval(timer);
    timer = setInterval(function () { if (document.visibilityState === 'visible') tick(); }, POLL_MS);
  }

  /* ---------- 推送名册给 SW（只有 deviceId → 称呼，用来在推送解密失败时也能显示是谁） ---------- */
  function syncNamesToSW() {
    var o = {};
    Object.keys(st.members).forEach(function (id) { if (st.members[id] && st.members[id].name) o[id] = st.members[id].name; });
    DB.set('names', o).catch(function () {});
  }

  /* ---------- 建家 / 加入 / 退出 ---------- */
  function installCred(c) {
    var raw = FC.unb64u(c.k);
    return FC.deriveKeys(raw).then(function (k) {
      if (c.fp && c.fp !== k.fp) throw new Error('fingerprint');
      c.fp = k.fp;
      return DB.set('cred', c).then(function () {
        cred = c; keys = k;
        Meta.me = c.deviceId;
        var self = [];
        try { self = JSON.parse(localStorage.getItem(LS_SELF) || '[]'); } catch (e) { self = []; }
        if (!Array.isArray(self)) self = [];
        Storage.retagMine(self, c.deviceId);
        if (self.indexOf(c.deviceId) < 0) self.push(c.deviceId);
        try { localStorage.setItem(LS_SELF, JSON.stringify(self.slice(-8))); } catch (e2) {}
      });
    });
  }

  function create(opt) {
    opt = opt || {};
    if (cred) return Promise.reject(new Error('这台手机已经在一个家里了，先退出才能建新家'));
    var srv = normServer(opt.server || server());
    if (!serverOk(srv)) return Promise.reject(new Error('服务器地址不对'));
    var name = cleanName(opt.name) || '家人';
    return api('POST', '/families', { name: '' }, { server: srv, noAuth: true }).then(function (j) {
      if (!FAMILY_RE.test(j.familyId) || !DEVICE_RE.test(j.deviceId) || typeof j.token !== 'string') throw new Error('服务器返回不对');
      var c = { v: 1, server: srv, familyId: j.familyId, deviceId: j.deviceId, token: j.token, k: FC.b64u(FC.genKey()), myName: name, joinedAt: now(), owner: true };
      st = blankState();
      st.shareFam = opt.shareFam !== false;
      st.helloAt = now();         /* 建家的人不用打招呼：家里还没别人 */
      return installCred(c).then(function () {
        (opt.babyIds || []).forEach(function (id) { setShare(id, true, true); });
        st.members[c.deviceId] = { name: name, u: now() };
        st.outbox = {};           /* 还没有别人，不用发；有人加入时按 hello 发快照 */
        saveState(); syncNamesToSW(); loop();
        return c;
      });
    });
  }

  function invite() {
    if (!cred) return Promise.reject(new Error('还没加入家庭'));
    return api('POST', '/families/' + cred.familyId + '/invites', {}).then(function (j) {
      if (!INVITE_RE.test(j.invite)) throw new Error('服务器返回不对');
      var code = 'yiya://join?u=' + encodeURIComponent(cred.server) + '&f=' + cred.familyId + '&i=' + j.invite + '&k=' + cred.k
        + '&fp=' + keys.fp.slice(0, 16) + (cred.myName ? '&n=' + encodeURIComponent(cred.myName) : '');
      return { code: code, expiresAt: j.expiresAt, fp: fmtFp(keys.fp) };
    });
  }

  /** 解析家庭码 / 二维码内容；校验服务器地址、各字段格式、指纹与密钥匹配 */
  function parseCode(text) {
    var s = String(text || '').trim();
    var m = /yiya:\/\/join\?[A-Za-z0-9%_.~=&:\/-]+/.exec(s);
    if (!m) return Promise.resolve({ error: '这不是咿呀的家庭码' });
    var q = {};
    m[0].slice('yiya://join?'.length).split('&').forEach(function (kv) {
      var i = kv.indexOf('='); if (i < 0) return;
      try { q[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1)); } catch (e) {}
    });
    var srv = normServer(q.u);
    if (!serverOk(srv)) return Promise.resolve({ error: '家庭码里的服务器地址不安全（必须是 https）' });
    if (!FAMILY_RE.test(q.f || '') || !INVITE_RE.test(q.i || '')) return Promise.resolve({ error: '家庭码不完整，请重新扫一次' });
    var raw = FC.unb64u(q.k || '');
    if (!raw || raw.length !== 32) return Promise.resolve({ error: '家庭码不完整，请重新扫一次' });
    if (!/^[0-9a-f]{16}$/.test(q.fp || '')) return Promise.resolve({ error: '家庭码缺少指纹，请让家人重新生成' });
    return FC.deriveKeys(raw).then(function (k) {
      if (k.fp.slice(0, 16) !== q.fp) return { error: '指纹对不上：家庭码可能被改过或没复制全' };
      return { server: srv, familyId: q.f, invite: q.i, k: q.k, fp: k.fp, fpShow: fmtFp(k.fp), inviter: cleanName(q.n || '') };
    });
  }

  function join(parsed, opt) {
    opt = opt || {};
    if (cred) return Promise.reject(new Error('这台手机已经在一个家里了，先退出才能加入别的家'));
    if (!parsed || parsed.error) return Promise.reject(new Error((parsed && parsed.error) || '家庭码不对'));
    var name = cleanName(opt.name) || '家人';
    return api('POST', '/join', { familyId: parsed.familyId, invite: parsed.invite, name: '' }, { server: parsed.server, noAuth: true }).then(function (j) {
      if (j.familyId !== parsed.familyId || !DEVICE_RE.test(j.deviceId) || typeof j.token !== 'string') throw new Error('服务器返回不对');
      var c = { v: 1, server: parsed.server, familyId: parsed.familyId, deviceId: j.deviceId, token: j.token, k: parsed.k, fp: parsed.fp, myName: name, joinedAt: now() };
      st = blankState();
      st.shareFam = opt.shareFam !== false;
      return installCred(c).then(function () {
        st.members[c.deviceId] = { name: name, u: now() };
        (opt.babyIds || []).forEach(function (id) { setShare(id, true, true); });
        saveState(); syncNamesToSW(); loop();
        return tick(true).then(function () { return c; });
      });
    }, function (e) {
      if (e.status === 403) throw new Error('家庭码已用过或过期了（15 分钟内有效、只能用一次），请让家人重新生成');
      if (e.status === 409) throw new Error('这个家的设备已满');
      throw e;
    });
  }

  /** 退出 / 被移除：删除家庭密钥和 token、停同步，本地记录保留 */
  function wipe() {
    clearInterval(timer); clearTimeout(debounce);
    var hadPush = st && st.push;
    cred = null; keys = null; Meta.me = 'local';
    try { localStorage.removeItem(LS_STATE); } catch (e) {}
    st = blankState();
    void hadPush;
    {
      try {
        if (navigator.serviceWorker && navigator.serviceWorker.getRegistration) {
          navigator.serviceWorker.getRegistration().then(function (reg) {
            if (reg && reg.pushManager) reg.pushManager.getSubscription().then(function (s) { if (s) s.unsubscribe(); }).catch(function () {});
          }).catch(function () {});
        }
      } catch (e2) {}
    }
    var p = Promise.all([DB.del('cred'), DB.del('names')]).catch(function () {});
    emit();
    return p;
  }
  function leave() {
    if (!cred) return Promise.resolve();
    var fid = cred.familyId;
    return api('DELETE', '/families/' + fid + '/devices/me').catch(function () { /* 断网也照样在本机退出；服务器那边 180 天无活动自动清 */ })
      .then(wipe);
  }
  var kickedShown = false;
  function kicked() {
    if (!cred) return;
    wipe().then(function () {
      if (kickedShown) return;
      kickedShown = true;
      if (Util && Util.yiyaAsk) Util.yiyaAsk({ face: 'sorry', title: '这台手机已不在家里了',
        message: '可能被家人移出了家庭共享，或者这个家已经解散。本机的记录都还在，只是不再同步；想再加入，让家人重新给你家庭码。',
        actions: [{ text: '知道了', kind: 'primary', onClick: function () { kickedShown = false; } }] });
      if (global.FamUI) FamUI.refresh();
    });
  }

  function devices() {
    if (!cred) return Promise.resolve([]);
    return api('GET', '/families/' + cred.familyId + '/devices').then(function (j) {
      return (Array.isArray(j.devices) ? j.devices : []).filter(function (x) { return x && DEVICE_RE.test(x.deviceId); }).map(function (x) {
        var mm = st.members[x.deviceId];
        return { deviceId: x.deviceId, me: x.deviceId === cred.deviceId, name: x.deviceId === cred.deviceId ? cred.myName : (mm && mm.name) || '',
          lastSeen: +x.lastSeen || 0, push: !!x.push };
      });
    });
  }
  function removeMember(did) {
    if (!cred || !DEVICE_RE.test(did) || did === cred.deviceId) return Promise.reject(new Error('不能移除'));
    return api('DELETE', '/families/' + cred.familyId + '/devices/' + did).then(function () { delete st.members[did]; saveState(); syncNamesToSW(); });
  }
  function rename(name) {
    if (!cred) return Promise.resolve();
    cred.myName = cleanName(name) || '家人';
    st.members[cred.deviceId] = { name: cred.myName, u: now() };
    saveState();
    return DB.set('cred', cred).then(function () { return sendMeta(); });
  }
  function setShareFam(on) {
    st.shareFam = !!on;
    if (on) enqueue(Meta.keysOf(Storage.get(), 'fam'));
    saveState(); kick();
  }

  /* ---------- 推送（iOS 16.4+ 主屏 PWA / 安卓 Chrome） ---------- */
  function urlB64(s) { return FC.unb64u(s); }
  function pushSupported() { return !!(global.navigator && navigator.serviceWorker && global.PushManager && global.Notification); }
  function enablePush() {
    if (!cred) return Promise.reject(new Error('还没加入家庭'));
    if (!pushSupported()) return Promise.reject(new Error('这个浏览器不支持通知：iPhone 需要 iOS 16.4 以上，并且从主屏幕图标打开'));
    return Promise.resolve(Notification.permission === 'granted' ? 'granted' : Notification.requestPermission()).then(function (perm) {
      if (perm !== 'granted') throw new Error('没有拿到通知权限：可以到系统设置里给「咿呀」打开通知');
      return Promise.all([navigator.serviceWorker.ready, api('GET', '/push/key', undefined, { noAuth: true })]);
    }).then(function (r) {
      var reg = r[0], pk = urlB64(r[1] && r[1].publicKey);
      if (!pk || pk.length !== 65) throw new Error('服务器推送公钥不对');
      return reg.pushManager.getSubscription().then(function (old) { return old || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: pk }); });
    }).then(function (sub) {
      return api('PUT', '/families/' + cred.familyId + '/devices/me/push', { subscription: sub.toJSON ? sub.toJSON() : sub });
    }).then(function () { st.push = true; saveState(); return true; });
  }
  function disablePush() {
    if (!cred) return Promise.resolve();
    return api('DELETE', '/families/' + cred.familyId + '/devices/me/push').catch(function () {}).then(function () {
      st.push = false; saveState();
      if (pushSupported()) return navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (s) { if (s) return s.unsubscribe(); }).catch(function () {});
    });
  }
  /** 「你来一下」：推送里只有加密的「称呼 + 动作」，没有任何记录内容 */
  function come() {
    if (!cred) return Promise.reject(new Error('还没加入家庭'));
    var body = { v: 1, a: 'come', n: cred.myName || '', at: now() };
    return FC.encrypt(keys.push, FC.pushAad(cred.familyId, cred.deviceId, 'come'), body).then(function (ct) {
      return api('POST', '/families/' + cred.familyId + '/notify', { kind: 'come', ct: ct });
    });
  }

  /* ---------- 启动 ---------- */
  function init() {
    if (readyP) return readyP;
    loadState();
    Meta.onChange = onLocalChange;
    readyP = DB.get('cred').then(function (c) {
      if (!isObj(c) || c.v !== 1 || !FAMILY_RE.test(c.familyId || '') || !DEVICE_RE.test(c.deviceId || '')) return null;
      return FC.deriveKeys(FC.unb64u(c.k)).then(function (k) {
        cred = c; keys = k; Meta.me = c.deviceId;
        loop();
        document.addEventListener('visibilitychange', function () {
          if (document.visibilityState === 'visible') { tick(true); if (st._dirtyUI) { st._dirtyUI = 0; refreshUI(); } }
        });
        setTimeout(function () { tick(true); }, 600);
        emit();
        return c;
      });
    }).catch(function () { return null; });
    return readyP;
  }
  function kick() { clearTimeout(debounce); debounce = setTimeout(function () { tick(true); }, 300); }

  loadState();
  global.FamSync = {
    DEFAULT_SERVER: DEFAULT_SERVER,
    init: init, create: create, invite: invite, parseCode: parseCode, join: join, leave: leave, wipe: wipe,
    devices: devices, removeMember: removeMember, rename: rename, setShare: setShare, setShareFam: setShareFam,
    enablePush: enablePush, disablePush: disablePush, come: come, pushSupported: pushSupported,
    sync: function () { return tick(true); },
    joined: function () { return !!cred; },
    info: function () {
      return cred ? { server: cred.server, deviceId: cred.deviceId, myName: cred.myName, fp: keys ? fmtFp(keys.fp) : '', owner: !!cred.owner } : null;
    },
    state: function () { return st; },
    shared: sharedSet,
    shareable: shareable,
    memberName: function (id) { var m = st && st.members[id]; return (m && m.name) || ''; },
    pendingKeys: function () { return st ? st.outbox : {}; },
    pendingCount: function () { return st ? Object.keys(st.outbox).length : 0; },
    server: server,
    setServer: function (u) {
      u = normServer(u);
      if (cred) return false;
      if (!serverOk(u)) return false;
      try { if (u === DEFAULT_SERVER) localStorage.removeItem(LS_SERVER); else localStorage.setItem(LS_SERVER, u); } catch (e) {}
      emit();
      return true;
    },
    serverOk: serverOk,
    on: function (f) { listeners.push(f); },
    /* 回归测试用：直接走「收」的完整校验路径 */
    _handle: function (m) { return handle(m); },
    _origin: originOf
  };
})(window);
