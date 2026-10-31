/**
 * notify.js —— 第 335 次：系统通知级提醒（App 关着 / 在后台也能按时收到）
 *
 * 一、提醒从哪来（Notify.plan(d, now) 纯函数，按本机数据算出「接下来几点要提醒什么」）：
 *   feed   喂奶提醒：每个宝宝最近一次喂养（不含吸奶）+ 3 小时（和首页提醒卡同一口径）；正在亲喂 / 瓶喂计时时不排
 *   sup    补剂与吃药：营养品计划里本机打开了提醒的服用时间；按每天 / 每周几 / 每 N 天重复，计划结束日截止；今天这一顿记过了就从明天排
 *   vac    疫苗与儿保：没接种的剂次 / 没做的儿保，到参考日期当天 9:00（每个宝宝各取最近 3 剂 / 2 次）
 *   pre    产检预约：约了日期且没勾「做了」的，前一晚 20:00 + 当天 8:00
 *   timer  计时进行中：亲喂 / 瓶喂 / 吸奶 1 小时、洗澡 / 游泳 / 日晒 1.5 小时、宫缩 30 分钟、数胎动 2 小时、睡眠 12 小时还没结束
 *   supply 用品补货：用品页设了提醒时间的（要先在用品页打开「用品提醒」）
 *   fam    家人记了一条：不在这里排，由家庭共享发送方即时推送（famsync.js）
 * 二、送达路径：
 *   ① 中转可用：每台手机注册一个「提醒设备」（和家庭无关，单机用户也能用），整批上传「到点时间（UTC 毫秒）+ 重复规则 + 密文」，
 *      到点由中转发 Web Push → SW 用本机密钥解密 → showNotification；
 *   ② App 在前台：每 45 秒给中转发心跳，中转到点不推，由这里的本地定时器弹顶部咿呀岛（SW 万一收到推送也改走咿呀岛）；
 *   ③ 中转不可用 / 离线 / 旧版中转：标记待同步（联网、回到前台、指数退避时重试）；App 打开时把这段时间里服务器没覆盖到的提醒补弹一次。
 * 三、隐私：密文用本机「提醒密钥」加密（FamRemind，见 famcrypto.js），密钥只在 IndexedDB；服务器只知道几点、多久重复一次、密文多长（已补齐到 192 的倍数）。
 * 四、偏好只存本机（localStorage 'yiya_notify'，镜像一份到 IndexedDB 给 SW 读），不进备份、不同步给家人。
 */
(function (global) {
  'use strict';
  var LS_PREFS = 'yiya_notify', LS_STATE = 'yiya_notify_state';
  var H = 3600e3, D = 864e5, MAX = 60, TIMEOUT_MS = 15000, BEAT_MS = 45000;
  var KINDS = [
    ['feed', '喂奶提醒', '距上次喂奶 3 小时'],
    ['sup', '补剂与吃药', '营养品计划里打开了提醒的服用时间'],
    ['vac', '疫苗与儿保', '参考日期当天上午 9 点'],
    ['pre', '产检预约', '前一晚 8 点、当天早上 8 点'],
    ['timer', '计时进行中', '计时开着忘了结束时提醒一次'],
    ['supply', '用品补货', '用品页设了提醒时间的'],
    ['fam', '家人记了一条', '加入家庭共享后生效']
  ];
  var KIND_IDS = KINDS.map(function (k) { return k[0]; });
  var RID_RE = /^[A-Za-z0-9_-]{1,32}$/;

  function now() { return Date.now(); }
  function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  function dayKey(t) { var x = new Date(t); return x.getFullYear() + '-' + p2(x.getMonth() + 1) + '-' + p2(x.getDate()); }
  function addDays(k, n) { var x = new Date(k + 'T12:00:00'); x.setDate(x.getDate() + n); return dayKey(x.getTime()); }
  function localAt(k, hm) { var t = new Date(k + 'T' + hm + ':00').getTime(); return isNaN(t) ? NaN : t; }
  function ms(s) { var t = s ? new Date(s).getTime() : NaN; return isNaN(t) ? null : t; }
  /** 短哈希（FNV-1a 32 位 → 36 进制），只用来拼稳定的提醒 ID */
  function h(s, n) {
    var x = 0x811c9dc5;
    s = String(s || '');
    for (var i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; }
    return ('000000000' + x.toString(36)).slice(-(n || 6));
  }
  function clip(s, n) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n); }

  /* ================= 一、提醒来源（纯函数） ================= */
  function babiesOf(d) {
    var act = d.settings && d.settings.activeBabyId, list = Array.isArray(d.babies) ? d.babies : [];
    var sb = (d.settings && d.settings.baby) || {};
    if (!list.length) return [{ id: null, name: clip(sb.nickname || sb.name || '宝宝', 8), birth: sb.birthDate || null, rec: d }];
    return list.filter(Boolean).map(function (b) {
      var me = b.id === act;
      return { id: b.id || null, name: clip(b.nickname || b.name || '宝宝', 8), birth: b.birthDate || (me ? sb.birthDate : null) || null, rec: me ? d : (b.rec || {}) };
    });
  }

  function planFeed(d, t, out, multi) {
    babiesOf(d).forEach(function (b) {
      var r = b.rec;
      if (r.feedingTimer || r.bottleTimer) return;            /* 正在喂 */
      var last = null;
      (r.feedings || []).forEach(function (f) {
        if (!f || f.type === 'pump') return;
        var s = ms(f.start);
        if (s != null && s <= t + 60e3 && (last == null || s > last)) last = s;
      });
      if (last == null || t - last > 24 * H) return;          /* 一天没记了：不在用，不打扰 */
      var at = last + 3 * H;
      if (at <= t) return;
      out.push({ id: 'feed-' + h(b.id || 'solo', 6), k: 'feed', at: at, go: 'feeding', bid: b.id,
        title: '喂奶提醒', body: (multi ? b.name + '：' : '') + '距上次喂奶已经 3 小时，宝宝可能该吃了。' });
    });
  }

  function planSup(d, t, out, multi) {
    var S = global.Modules && global.Modules.supplement, U = global.Util;
    if (!S || !S._norm || !S._remindOn || !S._onDay || !U || !U.dayKeyOf) return;
    var DS = U.dayStartHour ? U.dayStartHour(d) : 0;
    var today = U.dayKeyOf(new Date(t), DS);
    babiesOf(d).forEach(function (b) {
      var r = b.rec;
      (r.supplementPlans || []).forEach(function (p) {
        if (!p || !p.id || !p.name || p.active === false || !S._remindOn(p)) return;
        var v;
        try { v = S._norm(p); } catch (e) { return; }
        if (!v || !v.times || !v.times.length) return;
        var recsToday = (r.supplements || []).filter(function (x) { return x && U.dayKeyOf(x.time, DS) === today; });
        var slots = S._slots ? S._slots(p, recsToday) : [];
        var until = v.end ? localAt(addDays(v.end, 1), '00:00') - 60e3 : null;
        function occ(k, hm) { return localAt((DS > 0 && Number(hm.slice(0, 2)) < DS) ? addDays(k, 1) : k, hm); }
        function okDay(k) { return S._onDay(p, k, v); }
        v.times.forEach(function (x, j) {
          var hm = x.t, dose = (x.n ? String(Math.round(x.n * 10) / 10) + ' ' + (v.unit || '') : '').trim();
          var base = { k: 'sup', go: 'supplement', bid: b.id, title: clip(p.name, 24),
            body: (multi ? b.name + '：' : '') + hm + ' 的' + clip(p.name, 16) + (dose ? '（' + dose + '）' : '') + '，记得吃哦。' };
          function first(stepOk) {
            for (var i = 0; i <= 400; i++) {
              var k = addDays(today, i);
              if (v.end && k > v.end) return null;
              if (!stepOk(k) || !okDay(k)) continue;
              var at = occ(k, hm);
              if (i === 0 && (slots[j] || at <= t)) continue;
              if (at > t) return at;
            }
            return null;
          }
          var pid = h((b.id || 'solo') + '|' + p.id, 6) + '-' + hm.replace(':', '');
          if (v.freq === 'weekly') {
            v.days.forEach(function (wd) {
              var at = first(function (k) { var w = new Date(k + 'T12:00:00').getDay(); return (w === 0 ? 7 : w) === wd; });
              if (at != null) out.push(Object.assign({ id: 'sup-' + pid + '-' + wd, at: at, every: 7 * D, until: until }, base));
            });
            return;
          }
          var at = first(function () { return true; });
          if (at == null) return;
          out.push(Object.assign({ id: 'sup-' + pid, at: at, every: (v.freq === 'interval' ? v.every : 1) * D, until: until }, base));
        });
      });
    });
  }

  function planVac(d, t, out, multi) {
    var V = global.Modules && global.Modules.vaccine;
    if (!V || !V._plan) return;
    var today = dayKey(t);
    babiesOf(d).forEach(function (b) {
      if (!b.birth) return;
      var r = b.rec, done = (r.vaccines && r.vaccines.done) || {}, cdone = (r.checkups && r.checkups.done) || {};
      var bh = h(b.id || 'solo', 4), pre = multi ? b.name + '：' : '';
      V._plan(b.birth).filter(function (it) { return !done[it.key] && it.dueISO >= today; })
        .sort(function (a, z) { return a.dueISO < z.dueISO ? -1 : 1; }).slice(0, 3).forEach(function (it) {
          var at = localAt(it.dueISO, '09:00');
          if (at > t) out.push({ id: 'vac-' + bh + '-' + String(it.key).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 20), k: 'vac', at: at, go: 'vaccine', bid: b.id,
            title: '疫苗提醒', body: pre + '今天可以接种' + clip(it.name, 16) + clip(it.dose || '', 8) + '（以接种门诊的安排为准）。' });
        });
      if (V._planCheckups) {
        V._planCheckups(b.birth).filter(function (it) { return !cdone[it.key] && it.dueISO >= today; })
          .sort(function (a, z) { return a.dueISO < z.dueISO ? -1 : 1; }).slice(0, 2).forEach(function (it) {
            var at = localAt(it.dueISO, '09:00');
            if (at > t) out.push({ id: 'chk-' + bh + '-' + String(it.key).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 20), k: 'vac', at: at, go: 'vaccine', bid: b.id,
              title: '儿保提醒', body: pre + '儿保体检：' + clip(it.name, 16) + ' 参考时间就是今天，记得预约。' });
          });
      }
    });
  }

  function planPre(d, t, out) {
    var pl = d.prenatal && d.prenatal.plan, pg = global.Modules && global.Modules.pregnancy;
    if (!isObj(pl) || !pg || !pg._checks) return;
    pg._checks.forEach(function (c) {
      var s = pl['w' + c.week];
      if (!s || s.done || typeof s.appt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s.appt)) return;
      var eve = localAt(addDays(s.appt, -1), '20:00'), day = localAt(s.appt, '08:00');
      var ti = clip(c.title, 20);
      if (eve > t) out.push({ id: 'pre-w' + c.week + '-e', k: 'pre', at: eve, go: 'pregnancy', title: '产检提醒', body: '明天约了产检：' + ti + '，记得带产检本和医保卡。' });
      if (day > t) out.push({ id: 'pre-w' + c.week, k: 'pre', at: day, go: 'pregnancy', title: '产检提醒', body: '今天约了产检：' + ti + '，记得带产检本和医保卡。' });
    });
  }

  var TIMERS = [
    ['feedingTimer', 60, 'breast', '亲喂计时已经 1 小时了，喂完记得点结束。'],
    ['bottleTimer', 60, 'bottle', '瓶喂计时已经 1 小时了，喂完记得点结束。'],
    ['pumpTimer', 60, 'pump', '吸奶计时已经 1 小时了，吸完记得点结束。'],
    ['openSleep', 720, 'sleep', '睡眠计时已经 12 小时了，宝宝醒了的话记得点结束。'],
    ['openCare', 90, null, '计时已经 1.5 小时了，结束了记得点一下。']
  ];
  var CARE = { bath: '洗澡', swim: '游泳', sun: '日晒' };
  function planTimer(d, t, out, multi) {
    babiesOf(d).forEach(function (b) {
      var r = b.rec;
      TIMERS.forEach(function (x) {
        var o = r[x[0]], s = o && ms(o.start);
        if (s == null) return;
        var go = x[2], body = x[3];
        if (x[0] === 'openCare') { if (!CARE[o.kind]) return; go = o.kind; body = CARE[o.kind] + body; }
        var at = s + x[1] * 60e3;
        if (at > t) out.push({ id: 'tmr-' + x[0].slice(0, 6) + '-' + h(b.id || 'solo', 4), k: 'timer', at: at, go: go, bid: b.id, title: '计时还开着', body: (multi ? b.name + '：' : '') + body });
      });
    });
    var fs = d.fetalSession && ms(d.fetalSession.start);
    if (fs != null && fs + 2 * H > t) out.push({ id: 'tmr-fetal', k: 'timer', at: fs + 2 * H, go: 'fetal', title: '计时还开着', body: '数胎动已经 2 小时了，数完记得点结束。' });
    var oc = d.openContraction && ms(d.openContraction.start);
    if (oc != null && oc + 30 * 60e3 > t) out.push({ id: 'tmr-contra', k: 'timer', at: oc + 30 * 60e3, go: 'contraction', title: '计时还开着', body: '这次宫缩计时已经 30 分钟了，结束了记得点一下。' });
  }

  function planSupply(d, t, out) {
    if (!d.settings || d.settings.supRemind !== true) return;
    (d.supplies || []).forEach(function (s) {
      if (!s || !s.name || s.archived || !s.remind || !s.remind.on || typeof s.remind.at !== 'string') return;
      var at = ms(s.remind.at.slice(0, 16));
      if (at != null && at > t) out.push({ id: 'sply-' + h(s.id || s.name, 8), k: 'supply', at: at, go: 'supplies', title: '用品提醒', body: '到时间补' + clip(s.name, 16) + '了。' });
    });
  }

  /** 全部提醒来源 → [{ id, k, at, every?, until?, title, body, go, bid? }]，按时间排序，最多 60 条 */
  function plan(d, t) {
    t = t || now();
    var out = [];
    if (!d || !d.settings) return out;
    var multi = babiesOf(d).length > 1;
    [planFeed, planSup, planVac, planPre, planTimer, planSupply].forEach(function (f) {
      try { f(d, t, out, multi); } catch (e) { if (global.console) console.warn('[notify] plan', e); }
    });
    var seen = {};
    out = out.filter(function (x) {
      if (!x || !RID_RE.test(x.id) || !(x.at > t) || seen[x.id]) return false;
      seen[x.id] = 1;
      if (x.until != null && (!(x.until >= x.at))) x.until = null;
      if (!x.bid) delete x.bid;
      if (!x.every) { delete x.every; delete x.until; }
      return true;
    });
    out.sort(function (a, z) { return a.at - z.at; });
    return out.slice(0, MAX);
  }
  /** 一条（可能重复的）提醒在 (from, to] 里的所有到点时刻 */
  function occurrences(x, from, to) {
    var r = [];
    if (!x || !(x.at > 0)) return r;
    if (!x.every) { if (x.at > from && x.at <= to) r.push(x.at); return r; }
    var a = x.at;
    if (a <= from) a = x.at + (Math.floor((from - x.at) / x.every) + 1) * x.every;
    for (; a <= to && r.length < 50; a += x.every) { if (x.until != null && a > x.until) break; r.push(a); }
    return r;
  }
  function nextOcc(x, t) {
    if (!x.every) return x.at > t ? x.at : null;
    var a = x.at > t ? x.at : x.at + (Math.floor((t - x.at) / x.every) + 1) * x.every;
    return (x.until != null && a > x.until) ? null : a;
  }

  /* ================= 二、偏好与状态（只在本机） ================= */
  function defPrefs() { var k = {}; KIND_IDS.forEach(function (id) { k[id] = true; }); return { v: 1, on: false, k: k, hide: false }; }
  var prefs = defPrefs(), st = null;
  function loadPrefs() {
    var p = null;
    try { p = JSON.parse(localStorage.getItem(LS_PREFS) || 'null'); } catch (e) { p = null; }
    prefs = defPrefs();
    if (isObj(p)) {
      prefs.on = p.on === true; prefs.hide = p.hide === true;
      if (isObj(p.k)) KIND_IDS.forEach(function (id) { if (typeof p.k[id] === 'boolean') prefs.k[id] = p.k[id]; });
    }
    return prefs;
  }
  function savePrefs() {
    try { localStorage.setItem(LS_PREFS, JSON.stringify(prefs)); } catch (e) {}
    if (global.FamDB) FamDB.set('nprefs', { on: prefs.on, hide: prefs.hide, k: prefs.k }).catch(function () {});
  }
  function blank() { return { v: 1, plan: [], srv: {}, pushOk: false, fired: {}, lastSeen: 0, dirty: 0, sig: '', ep: '', mode: 'off', err: null, lastSync: 0, stored: 0 }; }
  function loadState() {
    var s = null;
    try { s = JSON.parse(localStorage.getItem(LS_STATE) || 'null'); } catch (e) { s = null; }
    st = isObj(s) && s.v === 1 ? s : blank();
    var b = blank();
    Object.keys(b).forEach(function (k) { if (st[k] === undefined || typeof st[k] !== typeof b[k]) st[k] = b[k]; });
    if (!Array.isArray(st.plan)) st.plan = [];
    return st;
  }
  function saveState() { try { localStorage.setItem(LS_STATE, JSON.stringify(st)); } catch (e) {} emit(); }
  var listeners = [];
  function emit() { listeners.forEach(function (f) { try { f(); } catch (e) {} }); }

  function desired(t) {
    var d = global.Storage && Storage.get && Storage.get();
    if (!d) return [];
    return plan(d, t || now()).filter(function (x) { return prefs.k[x.k] !== false; });
  }
  function sigOf(list) {
    return h(JSON.stringify(list.map(function (x) { return [x.id, x.at, x.every || 0, x.until || 0, x.title, x.body, x.go, x.bid || '']; })), 9) + ':' + list.length;
  }

  /* ================= 三、平台能力与权限 ================= */
  function isIOS() {
    var ua = (global.navigator && navigator.userAgent) || '';
    return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1);
  }
  function standalone() {
    try { return !!(navigator.standalone || (global.matchMedia && matchMedia('(display-mode: standalone)').matches)); } catch (e) { return false; }
  }
  function supported() { return !!(global.navigator && navigator.serviceWorker && global.PushManager && global.Notification && global.isSecureContext !== false); }
  function permission() { try { return global.Notification ? Notification.permission : 'unsupported'; } catch (e) { return 'unsupported'; } }
  /** 不能开时给一句话说明（不硬弹权限框）；能开返回 '' */
  function blocker() {
    if (isIOS() && !standalone()) return 'iPhone 上要先在 Safari 里点「分享」→「添加到主屏幕」，再从主屏幕的咿呀记图标打开，才能打开系统通知。';
    if (!supported()) return isIOS() ? '这台 iPhone 的系统太旧：系统通知需要 iOS 16.4 或更新的版本。' : '这个浏览器不支持系统通知，提醒会在打开 App 时显示。';
    if (permission() === 'denied') return '通知权限被关掉了：到手机的「设置 → 通知 → 咿呀记」里打开，再回来打开这个开关。';
    return '';
  }

  /* ================= 四、和中转同步 ================= */
  var rcred = null, busy = false, again = false, retryT = 0, fails = 0, debT = 0, localT = 0, beatT = 0, seenT = 0;
  function server() {
    var F = global.FamSync;
    if (F && F.joined && F.joined() && F.info && F.info()) return F.info().server;
    return (F && F.server) ? F.server() : 'https://api.yiya.help';
  }
  function api(method, path, body, opt) {
    opt = opt || {};
    var base = opt.server || (rcred && rcred.server) || server();
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var to = setTimeout(function () { if (ctl) ctl.abort(); }, TIMEOUT_MS);
    var headers = { 'Accept': 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (rcred && !opt.noAuth) headers['Authorization'] = 'Bearer ' + rcred.deviceId + ':' + rcred.token;
    return fetch(base + '/v1' + path, { method: method, headers: headers, body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctl ? ctl.signal : undefined, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', keepalive: !!opt.keepalive })
      .then(function (res) {
        clearTimeout(to);
        if (res.status === 204) return {};
        return res.json().catch(function () { return {}; }).then(function (j) {
          if (!res.ok) { var e = new Error((j && j.message) || (j && j.error) || ('HTTP ' + res.status)); e.status = res.status; e.code = j && j.error; throw e; }
          return j;
        });
      }, function (err) { clearTimeout(to); var e = new Error(err && err.name === 'AbortError' ? '网络超时' : '网络不通'); e.net = true; throw e; });
  }
  function ensureCred() {
    var srv = server();
    if (rcred && rcred.server === srv) return Promise.resolve(rcred);
    return api('POST', '/rdev', {}, { server: srv, noAuth: true }).then(function (j) {
      if (!/^r_[A-Za-z0-9_-]{16}$/.test(j.deviceId || '') || typeof j.token !== 'string') throw new Error('服务器返回不对');
      var c = { v: 1, server: srv, deviceId: j.deviceId, token: j.token, k: FamCrypto.b64u(FamCrypto.genKey()), at: now() };
      return FamDB.set('rcred', c).then(function () { rcred = c; st.ep = ''; st.srv = {}; return c; });
    });
  }
  function getSub() {
    if (!supported() || permission() !== 'granted') return Promise.resolve(null);
    return navigator.serviceWorker.ready.then(function (reg) {
      return reg.pushManager.getSubscription().then(function (old) {
        if (old) return old;
        return api('GET', '/push/key', undefined, { noAuth: true }).then(function (k) {
          var pk = FamCrypto.unb64u(k && k.publicKey);
          if (!pk || pk.length !== 65) throw new Error('服务器推送公钥不对');
          return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: pk });
        });
      });
    });
  }
  function ensurePush() {
    return getSub().then(function (sub) {
      if (!sub) { st.pushOk = false; return null; }
      var js = sub.toJSON ? sub.toJSON() : sub, ep = h(js.endpoint || '', 9);
      var p = (st.ep === ep && st.pushOk) ? Promise.resolve() : api('PUT', '/rdev/me/push', { subscription: js }).then(function () { st.ep = ep; st.pushOk = true; });
      return p.then(function () {
        if (global.FamSync && FamSync.refreshPush) FamSync.refreshPush(js);
        return sub;
      });
    });
  }
  function sync(force) {
    if (busy) { again = true; return Promise.resolve(false); }
    if (!global.FamCrypto || !global.FamRemind || !global.FamDB) return Promise.resolve(false);
    if (!prefs.on && !(rcred && st.stored)) { st.mode = 'off'; st.dirty = 0; saveState(); return Promise.resolve(true); }
    if (global.navigator && navigator.onLine === false) { st.dirty = 1; st.mode = 'local'; st.err = '离线'; saveState(); return Promise.resolve(false); }
    busy = true;
    var list = prefs.on ? desired() : [], sig = sigOf(list);
    var p = credP.then(ensureCred).then(function () { return prefs.on ? ensurePush() : null; }).then(function () {
      return Promise.all(list.map(function (x) { return FamRemind.seal(rcred, x); }));
    }).then(function (cts) {
      var body = list.map(function (x, i) {
        var o = { id: x.id, at: x.at, ct: cts[i] };
        if (x.every) { o.every = x.every; if (x.until != null) o.until = x.until; }
        return o;
      });
      return api('PUT', '/rdev/me/reminders', { reminders: body });
    }).then(function (j) {
      var skip = {};
      (j && Array.isArray(j.skipped) ? j.skipped : []).forEach(function (x) { if (x && x.id) skip[x.id] = 1; });
      st.srv = {};
      list.forEach(function (x) { if (!skip[x.id]) st.srv[x.id] = { at: x.at, every: x.every || 0, until: x.until || 0 }; });
      st.stored = (j && j.stored) || 0; st.sig = sig; st.dirty = 0; st.err = null; st.lastSync = now();
      st.mode = prefs.on ? (st.pushOk ? 'push' : 'local') : 'off';
      fails = 0; clearTimeout(retryT);
      saveState();
      return true;
    }).catch(function (e) {
      if (e && e.status === 401) { rcred = null; FamDB.del('rcred').catch(function () {}); }
      st.dirty = 1; st.mode = prefs.on ? 'local' : 'off';
      st.err = (e && e.status === 404) ? '中转版本太旧，还不支持预约提醒' : ((e && e.message) || '同步失败');
      fails++;
      clearTimeout(retryT);
      retryT = setTimeout(function () { sync(); }, Math.min(600000, 15000 * Math.pow(2, fails - 1)));
      saveState();
      return false;
    }).then(function (r) {
      busy = false;
      if (again) { again = false; setTimeout(function () { sync(); }, 50); }
      return r;
    });
    return p;
  }
  var credP = Promise.resolve();

  /* ================= 五、本机：前台咿呀岛、后台本地通知、打开时补发 ================= */
  function visible() { return !global.document || document.visibilityState === 'visible'; }
  function covered(id, at) {
    var s = st.srv[id];
    if (!s || !st.pushOk) return false;
    return occurrences({ at: s.at, every: s.every, until: s.until || null }, at - 1, at).length > 0;
  }
  function island(title, body, go, bid) {
    if (!global.Util || !Util.toast) return;
    var msg = (global.FamRemind ? FamRemind.clean(body, 80) : String(body || '')) || (global.FamRemind ? FamRemind.clean(title, 24) : '');
    var act = (go && global.App) ? { label: '去看看', face: 'look', onClick: function () { openGo(go, bid); } } : { face: 'look' };
    Util.toast(msg, 'info', act);
  }
  function localNotify(x) {
    if (permission() !== 'granted' || !supported()) return;
    navigator.serviceWorker.ready.then(function (reg) {
      var hide = prefs.hide;
      return reg.showNotification(hide ? '咿呀记' : FamRemind.clean(x.title, 24), { body: hide ? '咿呀记有一条提醒' : FamRemind.clean(x.body, 80),
        tag: 'yiya-rem-' + x.id, icon: 'assets/icon-192.png', badge: 'assets/icon-192.png', data: { go: x.go || 'home', bid: x.bid || null } });
    }).catch(function () {});
  }
  /** 处理 (from, t] 里到点的提醒：前台弹咿呀岛；后台（桌面 / 安卓页面还活着）而服务器没覆盖的，用本地通知 */
  function fireDue(from, t, catchUp) {
    var hit = [];
    st.plan.forEach(function (x) {
      occurrences(x, from, t).forEach(function (a) {
        if (st.fired[x.id] === a) return;
        if (catchUp && covered(x.id, a)) return;   /* 打开时补发：服务器那段时间已经推过的不再补 */
        st.fired[x.id] = a;
        hit.push(x);
      });
    });
    if (!hit.length) return 0;
    var ids = Object.keys(st.fired);
    if (ids.length > 200) ids.slice(0, ids.length - 200).forEach(function (k) { delete st.fired[k]; });
    if (visible()) {
      if (hit.length === 1) island(hit[0].title, hit[0].body, hit[0].go, hit[0].bid);
      else island('', (catchUp ? '刚才有 ' : '有 ') + hit.length + ' 条提醒：' + hit.slice(0, 2).map(function (x) { return x.title; }).join('、') + (hit.length > 2 ? ' 等' : ''), hit[0].go, hit[0].bid);
    } else if (!catchUp) {
      hit.forEach(function (x) { if (!covered(x.id, x.at)) localNotify(x); });
    }
    saveState();
    return hit.length;
  }
  function armLocal() {
    clearTimeout(localT);
    if (!prefs.on) return;
    var t = now(), nx = null;
    st.plan.forEach(function (x) { var a = nextOcc(x, t); if (a != null && (nx == null || a < nx)) nx = a; });
    if (nx == null) return;
    localT = setTimeout(function () {
      var t2 = now();
      fireDue(t2 - Math.max(5000, t2 - t), t2, false);
      st.lastSeen = t2; saveState();
      refresh(true);
    }, Math.max(50, Math.min(2147483000, nx - t + 30)));
  }
  /** 重新算计划；有变化就标记待同步并同步 */
  function refresh(immediate) {
    clearTimeout(debT);
    var run = function () {
      if (!prefs.on && !st.stored && !st.plan.length) return;      /* 没开、服务器上也没有：什么都不做（不写本机状态） */
      var list = prefs.on ? desired() : [];
      /* 后台时不替换本机计划：回到前台先按旧计划补发错过的，再换新的 */
      if (visible() || !st.plan.length || !prefs.on) st.plan = list;
      var sig = sigOf(list);
      if (prefs.on && sig !== st.sig) st.dirty = 1;
      if (!prefs.on && st.stored) st.dirty = 1;
      saveState();
      armLocal();
      if (st.dirty) sync();
    };
    if (immediate) run(); else debT = setTimeout(run, 1200);
  }
  function catchUp() {
    if (!prefs.on) return 0;
    var t = now(), from = Math.max(st.lastSeen || t, t - 12 * H);
    var n = fireDue(from, t, true);
    st.lastSeen = t; saveState();
    return n;
  }
  function beat(vis) {
    if (!prefs.on || !rcred || st.mode === 'off') return;
    api('POST', '/rdev/me/presence', { visible: !!vis }, { keepalive: !vis }).catch(function () {});
  }
  function onVis() {
    if (visible()) {
      catchUp();
      refresh(true);
      beat(true);
      clearInterval(beatT); beatT = setInterval(function () { if (visible()) beat(true); }, BEAT_MS);
      clearInterval(seenT); seenT = setInterval(function () { if (visible()) { st.lastSeen = now(); saveState(); } }, 30000);
    } else {
      clearInterval(beatT); clearInterval(seenT);
      st.lastSeen = now(); saveState();
      beat(false);
    }
  }

  /* 点通知 / SW 转来的消息 → 打开对应页面 */
  function openGo(go, bid) {
    if (!global.App || typeof go !== 'string' || !/^[a-z]{2,16}$/.test(go)) return;
    try {
      var d = Storage.get();
      if (bid && d.settings.activeBabyId !== bid && (d.babies || []).some(function (b) { return b && b.id === bid; })) Storage.switchBaby(bid);
      if (go === 'home' || !(global.Modules && Modules[go])) { App.showTab('home'); return; }
      App.showTab(go);
    } catch (e) {}
  }

  /* ================= 六、设置页「系统通知」 ================= */
  var box = null;
  function esc(s) { return global.Util && Util.escapeHtml ? Util.escapeHtml(String(s)) : String(s).replace(/[&<>"']/g, ''); }
  function statusText() {
    var b = blocker();
    if (b && !(prefs.on && permission() === 'granted')) return b;
    if (!prefs.on) return '打开后，App 关着或在后台时也能按时收到提醒。提醒内容端到端加密，服务器只知道「几点要提醒」。App 开着时改在顶部咿呀岛提醒。';
    if (permission() !== 'granted') return '还没有通知权限：点一下上面的开关重新授权。';
    if (st.mode === 'push' && !st.dirty) return '已在中转预约 ' + st.stored + ' 条提醒，App 关着也会按时通知。改了记录会自动更新。';
    if (st.err === '离线' || (global.navigator && navigator.onLine === false)) return '现在离线：联网后自动同步；在那之前，App 打开时会补上错过的提醒。';
    if (st.err) return '中转暂时连不上（' + st.err + '），会自动重试；在那之前，App 打开时会补上错过的提醒。';
    return '正在同步提醒…';
  }
  function render() {
    if (!box || !box.isConnected) return;
    var famOn = !!(global.FamSync && FamSync.joined && FamSync.joined());
    var html = '<div class="st-row row-switch"><label for="nfOn">系统通知<small>' + (prefs.on ? '已打开' : '总开关') + '</small></label>'
      + '<input type="checkbox" id="nfOn"' + (prefs.on ? ' checked' : '') + '></div>';
    if (prefs.on) {
      KINDS.forEach(function (k) {
        var sub = k[2];
        if (k[0] === 'fam') sub = famOn ? '家人在他的手机上记了一条，弹通知告诉你' : '加入家庭共享后生效';
        html += '<div class="st-row row-switch" data-nf-kind="' + k[0] + '"><label for="nf-' + k[0] + '">' + esc(k[1]) + '<small>' + esc(sub) + '</small></label>'
          + '<input type="checkbox" id="nf-' + k[0] + '" data-nf="' + k[0] + '"' + (prefs.k[k[0]] !== false ? ' checked' : '') + '></div>';
      });
      html += '<div class="st-row row-switch"><label for="nfHide">锁屏不显示详情<small>通知只写「咿呀记有一条提醒」</small></label>'
        + '<input type="checkbox" id="nfHide"' + (prefs.hide ? ' checked' : '') + '></div>';
    }
    html += '<p class="st-note" id="nfStatus" role="status">' + esc(statusText()) + '</p>';
    box.innerHTML = html;
  }
  function setOn(on) {
    prefs.on = !!on; savePrefs();
    if (global.FamSync && FamSync.setNotifyRec) FamSync.setNotifyRec(prefs.on && prefs.k.fam !== false);
    if (prefs.on) { st.lastSeen = now(); onVis(); }
    refresh(true);
    render();
  }
  function onChange(e) {
    var t = e.target;
    if (!box || !box.contains(t)) return;
    if (t.id === 'nfOn') {
      if (!t.checked) { setOn(false); if (global.Util) Util.toast('系统通知已关', 'ok'); return; }
      var b = blocker();
      if (b) { t.checked = false; var n = box.querySelector('#nfStatus'); if (n) n.textContent = b; return; }
      /* 权限只在用户这一下点按里申请（iOS 要求在手势里同步调用 requestPermission） */
      var pr;
      try { pr = permission() === 'granted' ? Promise.resolve('granted') : Notification.requestPermission(); } catch (er) { pr = Promise.resolve('denied'); }
      Promise.resolve(pr).then(function (r) {
        if (r !== 'granted') {
          t.checked = false;
          var n2 = box.querySelector('#nfStatus');
          if (n2) n2.textContent = '没有拿到通知权限：可以到手机的「设置 → 通知 → 咿呀记」里打开。';
          return;
        }
        setOn(true);
        if (global.Util) Util.toast('系统通知已打开', 'ok');
      });
      return;
    }
    if (t.hasAttribute('data-nf')) {
      var k = t.getAttribute('data-nf');
      prefs.k[k] = t.checked; savePrefs();
      if (k === 'fam' && global.FamSync && FamSync.setNotifyRec) FamSync.setNotifyRec(prefs.on && t.checked);
      refresh(true);
      return;
    }
    if (t.id === 'nfHide') { prefs.hide = t.checked; savePrefs(); refresh(true); }
  }
  function mount(el) {
    box = el;
    if (!el) return;
    if (!el._nfBound) { el.addEventListener('change', onChange); el._nfBound = true; }
    render();
  }

  /* ================= 七、启动 ================= */
  /* 点通知冷启动：SW openWindow('./?go=feeding&bid=<宝宝 uuid>')。?go= 由 app.js 处理（它会把参数从地址栏抹掉），这里先记下 bid 好切宝宝 */
  var bootGo = null, bootBid = null;
  try {
    var q0 = new URLSearchParams(global.location.search);
    bootGo = q0.get('go'); bootBid = q0.get('bid');
    if (!/^[a-z]{2,16}$/.test(bootGo || '')) bootGo = null;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(bootBid || '')) bootBid = null;
  } catch (e0) {}
  var started = false;
  function init() {
    if (started) return;
    started = true;
    loadPrefs(); loadState();
    var hadPrefs = false;
    try { hadPrefs = localStorage.getItem(LS_PREFS) != null; } catch (e) {}
    if (hadPrefs && global.FamDB) FamDB.set('nprefs', { on: prefs.on, hide: prefs.hide, k: prefs.k }).catch(function () {});
    credP = (global.FamDB ? FamDB.get('rcred') : Promise.resolve(null)).then(function (c) {
      if (isObj(c) && c.v === 1 && /^r_[A-Za-z0-9_-]{16}$/.test(c.deviceId || '') && typeof c.k === 'string') rcred = c;
    }).catch(function () {});
    /* 所有落盘都走 Storage.save：包一层，改 / 删记录后（含家人同步进来的）重算计划 */
    if (global.Storage && !Storage._nfWrapped) {
      var orig = Storage.save;
      Storage.save = function () { var r = orig.apply(this, arguments); try { refresh(false); } catch (e) {} return r; };
      Storage._nfWrapped = true;
    }
    if (global.document) document.addEventListener('visibilitychange', onVis);
    global.addEventListener('online', function () { if (st.dirty) sync(); render(); });
    global.addEventListener('offline', function () { render(); });
    if (global.navigator && navigator.serviceWorker) {
      navigator.serviceWorker.addEventListener('message', function (e) {
        var m = e.data;
        if (!isObj(m)) return;
        if (m.type === 'yiya-go') openGo(m.go, m.bid);
        else if (m.type === 'yiya-notify') island(m.title, m.body, m.go, m.bid);
      });
    }
    listeners.push(function () { var n = box && box.querySelector('#nfStatus'); if (n) n.textContent = statusText(); });
    /* 加入家庭后：系统通知里「家人记了一条」开着 → 告诉家人我想收 */
    if (global.FamSync && FamSync.on) FamSync.on(function () {
      try {
        var fs = FamSync.state && FamSync.state();
        var want = prefs.on && prefs.k.fam !== false;
        if (FamSync.joined() && fs && fs.nrec !== want) FamSync.setNotifyRec(want);
      } catch (e) {}
    });
    if (bootBid) {
      try { if (Storage.get().settings.activeBabyId !== bootBid && Storage.get().settings.privacyAccepted) openGo(bootGo || 'home', bootBid); } catch (e1) {}
    }
    credP.then(function () {
      if (prefs.on) { onVis(); } else if (st.stored) refresh(true);
    });
    setInterval(function () { if (visible() && prefs.on) refresh(true); }, 10 * 60e3);   /* 计划随时间变（日期跨天等），前台时 10 分钟重算一次 */
  }

  /** 家庭共享 / 退出时问一句：本机还需要推送订阅吗（需要就别 unsubscribe） */
  function wantsPush() { return prefs.on === true; }

  global.Notify = {
    KINDS: KINDS, plan: plan, occurrences: occurrences,
    init: init, mount: mount, render: render, sync: function () { return sync(true); }, refresh: refresh, catchUp: catchUp,
    prefs: function () { return prefs; }, state: function () { return st; }, setOn: setOn, wantsPush: wantsPush,
    blocker: blocker, supported: supported, open: openGo, island: island,
    on: function (f) { listeners.push(f); },
    _cred: function () { return rcred; }, _desired: desired, _fireDue: fireDue, _beat: beat, _visible: visible
  };
  if (global.document) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 0); });
    else setTimeout(init, 0);
  }
})(window);
