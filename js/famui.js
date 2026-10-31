/**
 * famui.js —— 第 332 次：家庭共享的界面（设置 → 家庭共享、扫码、首页「叫家人来一下」、记录上的「爸爸记」小字）
 *
 * 渲染纪律：所有来自同步 / 用户输入的文字（称呼、宝宝名、错误信息）一律 Util.escapeHtml 或 textContent，
 * 绝不把未转义内容拼进 innerHTML。二维码离线生成（js/vendor/qrcode.js，MIT），扫码用 js/vendor/jsqr.min.js（Apache-2.0），
 * 两个都按需加载、进 SW 预缓存。iOS 主屏 PWA 与 Safari 存储隔离，所以扫码在 App 内用相机做，不依赖系统相机打开链接。
 */
(function (global) {
  'use strict';
  var Util = global.Util, Storage = global.Storage;
  function esc(s) { return Util.escapeHtml(s == null ? '' : String(s)); }
  function FS() { return global.FamSync; }

  var NAME_CHIPS = ['妈妈', '爸爸', '外婆', '奶奶', '外公', '爷爷'];
  var box = null, mode = null, inviteState = null, parsedJoin = null, devCache = null, devAt = 0, busyAct = false;

  function loadScript(src, globalName) {
    if (global[globalName]) return Promise.resolve(global[globalName]);
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = function () { global[globalName] ? res(global[globalName]) : rej(new Error('load')); };
      s.onerror = function () { rej(new Error('load')); };
      document.head.appendChild(s);
    });
  }

  function ago(ms) {
    if (!ms) return '还没有';
    var s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 60) return '刚刚';
    if (s < 3600) return Math.floor(s / 60) + ' 分钟前';
    if (s < 86400) return Math.floor(s / 3600) + ' 小时前';
    return Math.floor(s / 86400) + ' 天前';
  }

  /** 没有宝宝档案、但顶层有宝宝资料 / 记录：先补建档案，记录才有归属、才能共享 */
  function ensureBaby() {
    var d = Storage.get();
    if ((d.babies || []).length) return;
    var hasRec = Storage.Meta.keysOf(d, '_').length > 0;
    if (!d.settings.baby && !hasRec) return;   /* 什么都没有（刚装上）：不建空档案，等家里传过来 */
    if (!d.settings.baby) d.settings.baby = { name: '宝宝', birthDate: null };
    Storage.syncBabyFromSettings();
    Storage.save();
  }
  function babyName(b) { return (Storage.babyLabel ? Storage.babyLabel(b) : b.name) || '宝宝'; }

  function nameField(id, val) {
    return '<label class="lbl-text" for="' + id + '">我的称呼（家人看到的）</label>'
      + '<input type="text" id="' + id + '" class="fam-name" maxlength="8" value="' + esc(val || '') + '" placeholder="比如：妈妈" autocomplete="off">'
      + '<div class="fam-chips">' + NAME_CHIPS.map(function (n) { return '<button type="button" class="seg-btn" data-fam-chip="' + id + '" data-v="' + esc(n) + '">' + esc(n) + '</button>'; }).join('') + '</div>';
  }
  function babyPicks(prefix, preset) {
    var d = Storage.get(), bs = d.babies || [];
    if (!bs.length) return '<p class="hint">还没有宝宝档案：会用当前的宝宝资料建一个，再共享它。</p>';
    return '<p class="lbl-text">共享哪些宝宝的记录</p><ul class="fam-babies">' + bs.map(function (b) {
      var ok = FS().shareable(b);
      var on = ok && (preset ? !!preset[b.id] : b.id === d.settings.activeBabyId);
      return '<li class="row-switch' + (ok ? '' : ' is-off') + '"><label for="' + prefix + b.id + '">' + esc(babyName(b))
        + (ok ? '' : '<small>来自之前的家，不能带到这个家</small>') + '</label>'
        + '<input type="checkbox" id="' + prefix + b.id + '" data-fam-baby="' + esc(b.id) + '"' + (on ? ' checked' : '') + (ok ? '' : ' disabled') + '></li>';
    }).join('') + '</ul><p class="hint">只同步勾选的宝宝；没勾的宝宝一条都不会离开这台手机。照片不同步。</p>';
  }
  function famPick(on) {
    return '<div class="row-switch"><label for="famShareSup">同时共享用品库存与储奶</label><input type="checkbox" id="famShareSup"' + (on !== false ? ' checked' : '') + '></div>';
  }
  function pickedBabies() {
    return Array.prototype.map.call(box.querySelectorAll('[data-fam-baby]:checked'), function (x) { return x.getAttribute('data-fam-baby'); });
  }

  /* ---------- 渲染 ---------- */
  function render() {
    if (!box || !box.isConnected) return;
    var F = FS();
    if (!F) { box.innerHTML = ''; return; }
    var html = '';
    if (!F.joined()) {
      html += '<div class="card fam-card"><h2>和家人一起记</h2>'
        + '<p class="hint">爸爸、外婆用自己的手机扫一下，就能一起记喂奶、睡眠、尿布；谁记的，列表里会写「爸爸记」。</p>'
        + '<ul class="fam-points"><li>端到端加密：服务器只转存看不懂的密文，家庭密钥只在你们的手机之间传。</li>'
        + '<li>只同步你勾选的宝宝；照片、妈妈的情绪 / 经期 / 记账不同步。</li>'
        + '<li>随时退出，本机的记录都还在。</li></ul>'
        + '<div class="fam-acts"><button type="button" class="btn btn-primary" data-fam="create">建一个家</button>'
        + '<button type="button" class="btn" data-fam="scan">扫码加入</button>'
        + '<button type="button" class="btn" data-fam="code">输入家庭码</button></div></div>';
      if (mode === 'create') {
        html += '<div class="card fam-form" data-fam-form="create"><h2>建一个家</h2>' + nameField('famName', '') + babyPicks('famB_') + famPick(true)
          + '<button type="button" class="btn btn-primary" data-fam="doCreate">建好了</button></div>';
      } else if (mode === 'code') {
        html += '<div class="card fam-form" data-fam-form="code"><h2>输入家庭码</h2>'
          + '<textarea id="famCode" rows="3" maxlength="400" placeholder="粘贴家人发来的家庭码（yiya://join?…）" autocomplete="off" spellcheck="false"></textarea>'
          + '<button type="button" class="btn btn-primary" data-fam="doParse">下一步</button></div>';
      } else if (mode === 'join' && parsedJoin) {
        html += '<div class="card fam-form" data-fam-form="join"><h2>加入' + esc(parsedJoin.inviter || '家人') + '的家</h2>'
          + '<p class="hint">指纹 <b class="fam-fp">' + esc(parsedJoin.fpShow) + '</b>（已和对方手机核对）</p>'
          + nameField('famName', '') + babyPicks('famB_') + famPick(true)
          + '<button type="button" class="btn btn-primary" data-fam="doJoin">加入</button>'
          + '<button type="button" class="btn cfm-ghost-btn" data-fam="cancel">取消</button></div>';
      }
      html += '<details class="card fam-adv"><summary>高级：中转服务器</summary>'
        + '<label class="lbl-text" for="famSrv">服务器地址</label><input type="url" id="famSrv" maxlength="200" value="' + esc(F.server()) + '">'
        + '<div class="row"><button type="button" class="btn" data-fam="srv">保存</button><button type="button" class="btn" data-fam="srvReset">恢复默认</button></div>'
        + '<p class="hint">默认 ' + esc(F.DEFAULT_SERVER) + '。只接受 https 地址；服务器只转存密文，换服务器不影响加密。自建服务器还需要把地址加进 App 的安全策略（CSP）。</p></details>';
      box.innerHTML = html;
      return;
    }
    var info = F.info(), st = F.state(), d = Storage.get();
    var drop = st.dropped || 0;
    html += '<div class="card fam-card fam-on"><h2>家庭共享已开启</h2>'
      + '<p class="fam-me">我是 <b data-fam-myname>' + esc(info.myName || '家人') + '</b> <button type="button" class="btn-mini" data-fam="rename">改称呼</button></p>'
      + '<p class="hint">家庭指纹 <b class="fam-fp">' + esc(info.fp) + '</b>：家里每台手机上显示的都应该一样。</p>'
      + '<ul class="kv fam-status">'
      + '<li><span>上次同步</span><b data-fam-last>' + esc(ago(st.lastSync)) + '</b></li>'
      + '<li><span>待发</span><b data-fam-pending>' + F.pendingCount() + ' 条</b></li>'
      + '<li><span>已丢弃</span><b data-fam-dropped>' + drop + ' 条</b></li></ul>'
      + (drop ? '<p class="hint">丢弃的是解不开、不属于这个家、或不在共享宝宝里的内容——它们不会显示，也不会写进你的记录。</p>' : '')
      + (st.lastErr ? '<p class="hint fam-err">' + esc('最近一次没连上：' + st.lastErr + '，会自动重试') + '</p>' : '')
      + '<button type="button" class="btn" data-fam="sync">立即同步</button></div>';
    /* 邀请 */
    html += '<div class="card fam-invite"><h2>邀请家人</h2>';
    if (inviteState && inviteState.expiresAt > Date.now()) {
      html += '<div class="fam-qr" data-fam-qr aria-label="家庭二维码"></div>'
        + '<p class="hint fam-exp" data-fam-exp>15 分钟内有效，只能用一次</p>'
        + '<p class="hint">让家人在咿呀「设置 → 家庭共享 → 扫码加入」里扫这个码，对一下指纹 <b class="fam-fp">' + esc(info.fp) + '</b>。</p>'
        + '<button type="button" class="btn" data-fam="copy">复制家庭码（发给不在身边的家人）</button>'
        + '<p class="hint">家庭码里带着家庭密钥：只发给家人本人，别发到群里。</p>';
    } else {
      html += '<p class="hint">生成一个一次性的二维码，家人扫了就加入。</p><button type="button" class="btn btn-primary" data-fam="invite">生成二维码</button>';
    }
    html += '</div>';
    /* 成员 */
    html += '<div class="card fam-members"><h2>家里的手机</h2><ul class="fam-mlist" data-fam-mlist>'
      + memberRows() + '</ul></div>';
    /* 共享宝宝 */
    var shared = F.shared();
    html += '<div class="card fam-share"><h2>共享的宝宝</h2>' + babyPicks('famS_', shared) + famPick(st.shareFam);
    var same = (st.sameName || []).map(function (id) { return (d.babies || []).filter(function (b) { return b.id === id; })[0]; }).filter(Boolean);
    if (same.length) html += '<p class="hint fam-warn">' + esc('家里传来的「' + same.map(babyName).join('、') + '」和本机一个同名宝宝不是同一个档案，现在按两个宝宝分开显示（以后可以手动合并）。') + '</p>';
    html += '</div>';
    /* 通知 */
    html += '<div class="card fam-push"><h2>通知</h2><div class="row-switch"><label for="famPush">家人点「叫家人来一下」时通知我</label>'
      + '<input type="checkbox" id="famPush"' + (st.push ? ' checked' : '') + '></div>'
      + '<p class="hint">通知里只有「爸爸 叫你过来一下」这样的称呼和动作，不会出现任何喂养或健康记录。iPhone 需要 iOS 16.4 以上、并从主屏幕图标打开咿呀。'
      + '「家人记了一条」的通知在 设置 → 记录与提醒 → 系统通知 里开关（只写称呼和记录类型，不写量和备注）。</p></div>';
    html += '<div class="card fam-leave"><button type="button" class="btn btn-danger" data-fam="leave">退出家庭</button>'
      + '<p class="hint">退出后这台手机不再同步，家庭密钥会从本机删除；本机已有的记录都保留。</p></div>';
    box.innerHTML = html;
    if (inviteState && inviteState.expiresAt > Date.now()) drawQR();
    refreshMembers(Date.now() - devAt > 3000);
  }

  function memberRows() {
    var F = FS();
    if (!devCache) return '<li class="hint">读取中…</li>';
    return devCache.map(function (m) {
      var nm = m.me ? (F.info().myName || '我') + '（这台）' : (m.name || '家人');
      return '<li class="fam-m"><span class="fam-mn">' + esc(nm) + '</span>'
        + '<small>' + esc(m.me ? '在线' : ('最后在线 ' + ago(m.lastSeen))) + ' · ' + (m.push ? '通知已开' : '通知未开') + '</small>'
        + (m.me ? '' : '<button type="button" class="btn-mini fam-rm" data-fam-rm="' + esc(m.deviceId) + '" data-fam-rmn="' + esc(m.name || '家人') + '">移除</button>') + '</li>';
    }).join('');
  }
  function refreshMembers(force) {
    var F = FS();
    if (!F || !F.joined()) return;
    if (!force && devCache && Date.now() - devAt < 20000) return;
    F.devices().then(function (list) {
      devCache = list; devAt = Date.now();
      var ul = box && box.querySelector('[data-fam-mlist]');
      if (ul) ul.innerHTML = memberRows();
    }).catch(function () {
      var ul = box && box.querySelector('[data-fam-mlist]');
      if (ul && !devCache) ul.innerHTML = '<li class="hint">暂时连不上服务器，稍后再看</li>';
    });
  }

  function drawQR() {
    var el = box.querySelector('[data-fam-qr]');
    if (!el || !inviteState) return;
    loadScript('js/vendor/qrcode.js', 'qrcode').then(function (qrcode) {
      var q = qrcode(0, 'M');
      q.addData(inviteState.code);
      q.make();
      var n = q.getModuleCount(), cell = 6, pad = 4, size = (n + pad * 2) * cell;
      var cv = document.createElement('canvas');
      cv.width = cv.height = size;
      var g = cv.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, size, size);
      g.fillStyle = '#2b2422';
      for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (q.isDark(r, c)) g.fillRect((c + pad) * cell, (r + pad) * cell, cell, cell);
      cv.setAttribute('role', 'img');
      cv.setAttribute('aria-label', '家庭二维码');
      el.innerHTML = '';
      el.appendChild(cv);
    }).catch(function () { el.textContent = '二维码没画出来，可以用下面的「复制家庭码」'; });
    clearInterval(drawQR._t);
    drawQR._t = setInterval(function () {
      var ex = box && box.querySelector('[data-fam-exp]');
      if (!ex || !inviteState) { clearInterval(drawQR._t); return; }
      var left = Math.max(0, inviteState.expiresAt - Date.now());
      if (!left) { inviteState = null; clearInterval(drawQR._t); render(); return; }
      ex.textContent = '还有 ' + Math.ceil(left / 60000) + ' 分钟有效，只能用一次';
    }, 15000);
  }

  /* ---------- 扫码 ---------- */
  var scan = null;
  function closeScan() {
    if (!scan) return;
    clearInterval(scan.t);
    try { scan.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
    if (scan.el && scan.el.parentNode) scan.el.parentNode.removeChild(scan.el);
    document.body.classList.remove('fam-scanning');
    scan = null;
  }
  function openScan() {
    if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) {
      Util.toast('这台手机打不开相机，改用「输入家庭码」', 'warn'); mode = 'code'; render(); return;
    }
    var el = document.createElement('div');
    el.className = 'fam-scan';
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', '扫码加入');
    el.innerHTML = '<video playsinline muted autoplay></video><div class="fam-scan-frame" aria-hidden="true"></div>'
      + '<p class="fam-scan-tip">把家人手机上的二维码放进框里</p>'
      + '<div class="fam-scan-bar"><button type="button" class="btn" data-scan="paste">粘贴家庭码</button><button type="button" class="btn" data-scan="close">关闭</button></div>';
    document.body.appendChild(el);
    document.body.classList.add('fam-scanning');
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-scan]');
      if (!b) return;
      closeScan();
      if (b.getAttribute('data-scan') === 'paste') { mode = 'code'; render(); var t = box && box.querySelector('#famCode'); if (t) t.focus(); }
    });
    Promise.all([navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }), loadScript('js/vendor/jsqr.min.js', 'jsQR')]).then(function (r) {
      var stream = r[0], jsQR = r[1];
      var video = el.querySelector('video');
      scan = { el: el, stream: stream, t: 0 };
      video.srcObject = stream;
      var cv = document.createElement('canvas'), g = cv.getContext('2d', { willReadFrequently: true });
      scan.t = setInterval(function () {
        if (!scan || video.readyState < 2) return;
        var w = video.videoWidth, h = video.videoHeight;
        if (!w || !h) return;
        var k = Math.min(1, 640 / Math.max(w, h));
        cv.width = Math.round(w * k); cv.height = Math.round(h * k);
        g.drawImage(video, 0, 0, cv.width, cv.height);
        var img = g.getImageData(0, 0, cv.width, cv.height);
        var res = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
        if (res && res.data && res.data.indexOf('yiya://join?') >= 0) { closeScan(); gotCode(res.data); }
      }, 250);
    }).catch(function () {
      closeScan();
      Util.toast('没打开相机（可能没给权限）：可以改用「输入家庭码」', 'warn');
      mode = 'code'; render();
    });
  }

  function gotCode(text) {
    FS().parseCode(text).then(function (p) {
      if (p.error) { Util.toast(p.error, 'error'); return; }
      Util.yiyaAsk({ face: 'think', title: '加入' + (p.inviter || '家人') + '的家（指纹 ' + p.fpShow + '）',
        message: '请和对方手机上「家庭共享」里显示的家庭指纹对一下，一样再加入。',
        actions: [{ text: '对得上，继续', kind: 'primary', attr: 'data-fam-ok', onClick: function () { parsedJoin = p; mode = 'join'; render(); } },
          { text: '取消', kind: 'ghost' }] });
    });
  }

  /* ---------- 事件 ---------- */
  function onClick(e) {
    var t = e.target.closest('[data-fam], [data-fam-chip], [data-fam-rm]');
    if (!t || !box.contains(t)) return;
    var F = FS();
    if (t.hasAttribute('data-fam-chip')) {
      var inp = box.querySelector('#' + t.getAttribute('data-fam-chip'));
      if (inp) inp.value = t.getAttribute('data-v');
      Array.prototype.forEach.call(box.querySelectorAll('[data-fam-chip]'), function (x) { x.classList.toggle('active', x === t); });
      return;
    }
    if (t.hasAttribute('data-fam-rm')) {
      var did = t.getAttribute('data-fam-rm'), nm = t.getAttribute('data-fam-rmn') || '家人';
      Util.yiyaAsk({ face: 'sorry', title: '把「' + nm + '」的手机移出家庭？', message: '移出后它不再收到新记录，也不能再发给你们；它本机已有的记录不会被删掉。丢了的手机就这样移除。',
        danger: true, actions: [{ text: '移出', kind: 'danger', attr: 'data-fam-rm-ok', onClick: function () {
          F.removeMember(did).then(function () { Util.toast('已移出', 'ok'); refreshMembers(true); }).catch(function (er) { Util.toast(er.message || '没移出成功', 'error'); });
        } }, { text: '取消', kind: 'ghost' }], focus: 1 });
      return;
    }
    var a = t.getAttribute('data-fam');
    if (busyAct && /^do|invite|leave/.test(a)) return;
    if (a === 'create' || a === 'code') { mode = mode === a ? null : a; render(); var c = box.querySelector('#famCode'); if (c) c.focus(); return; }
    if (a === 'scan') { openScan(); return; }
    if (a === 'cancel') { mode = null; parsedJoin = null; render(); return; }
    if (a === 'doParse') { var v = (box.querySelector('#famCode') || {}).value || ''; gotCode(v); return; }
    if (a === 'doCreate' || a === 'doJoin') {
      var name = ((box.querySelector('#famName') || {}).value || '').trim();
      if (!name) { Util.toast('先填一个称呼，家人才知道是谁记的', 'warn'); return; }
      ensureBaby();
      var ids = pickedBabies();
      if (!(Storage.get().babies || []).length) ids = [];
      else if (!box.querySelectorAll('[data-fam-baby]').length) ids = [Storage.get().settings.activeBabyId];
      var shareFam = !!(box.querySelector('#famShareSup') || {}).checked;
      busyAct = true;
      var p = a === 'doCreate' ? F.create({ name: name, babyIds: ids, shareFam: shareFam }) : F.join(parsedJoin, { name: name, babyIds: ids, shareFam: shareFam });
      p.then(function () {
        busyAct = false; mode = null; parsedJoin = null; devCache = null;
        Storage._gen = (Storage._gen || 0) + 1;
        Util.toast(a === 'doCreate' ? '家建好了，点「生成二维码」邀请家人' : '已加入，正在同步', 'ok');
        render();
      }, function (er) { busyAct = false; Util.toast(er.message || '没成功，稍后再试', 'error'); });
      return;
    }
    if (a === 'invite') {
      busyAct = true;
      F.invite().then(function (r) { busyAct = false; inviteState = r; render(); }, function (er) { busyAct = false; Util.toast(er.message || '没生成成功', 'error'); });
      return;
    }
    if (a === 'copy') {
      if (!inviteState) return;
      var done = function () { Util.toast('已复制，15 分钟内有效', 'ok'); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(inviteState.code).then(done, function () { Util.toast('复制没成功，可以让家人当面扫码', 'warn'); });
      return;
    }
    if (a === 'sync') { F.sync().then(function (ok) { render(); Util.toast(ok ? '已同步' : '这会儿连不上，会自动重试', ok ? 'ok' : 'warn'); }); return; }
    if (a === 'rename') {
      if (Util.editText) {
        Util.editText({ title: '我的称呼', value: F.info().myName || '', maxlength: 8, placeholder: '比如：妈妈', onConfirm: function (v) { if (!String(v || '').trim()) return; F.rename(v).catch(function () {}); render(); } });
      }
      return;
    }
    if (a === 'srv' || a === 'srvReset') {
      var u = a === 'srvReset' ? F.DEFAULT_SERVER : ((box.querySelector('#famSrv') || {}).value || '').trim();
      if (F.setServer(u)) { Util.toast('已保存服务器地址', 'ok'); render(); } else Util.toast('地址不对：只接受 https 地址', 'error');
      return;
    }
    if (a === 'leave') {
      Util.yiyaAsk({ face: 'sorry', title: '退出家庭共享？', message: '这台手机会停止同步，并删除本机保存的家庭密钥；本机已有的记录都保留。以后想回来，需要家人重新给你家庭码。',
        danger: true, actions: [{ text: '退出家庭', kind: 'danger', attr: 'data-fam-leave-ok', onClick: function () {
          F.leave().then(function () { inviteState = null; devCache = null; Storage._gen = (Storage._gen || 0) + 1; Util.toast('已退出家庭，本机记录都还在', 'ok'); render(); });
        } }, { text: '取消', kind: 'ghost' }], focus: 1 });
    }
  }
  function onChange(e) {
    var t = e.target, F = FS();
    if (!box || !box.contains(t) || !F || !F.joined()) return;
    if (t.hasAttribute('data-fam-baby')) {
      if (!F.setShare(t.getAttribute('data-fam-baby'), t.checked)) { t.checked = false; Util.toast('这个宝宝来自之前的家，不能带到这个家', 'warn'); }
      else Util.toast(t.checked ? '开始共享这个宝宝的记录' : '不再共享这个宝宝：之后的新记录只留在本机', 'ok');
      return;
    }
    if (t.id === 'famShareSup') { F.setShareFam(t.checked); return; }
    if (t.id === 'famPush') {
      var p = t.checked ? F.enablePush() : F.disablePush();
      p.then(function () { Util.toast(t.checked ? '通知已打开' : '通知已关', 'ok'); refreshMembers(true); }, function (er) { t.checked = false; Util.toast(er.message || '通知没打开', 'error'); });
    }
  }

  function mount(el) {
    box = el;
    if (!el) return;
    if (!el._famBound) {
      el.addEventListener('click', onClick);
      el.addEventListener('change', onChange);
      el._famBound = true;
    }
    render();
  }

  /* ---------- 首页「叫家人来一下」 ---------- */
  function comeChip() {
    var F = FS();
    if (!F || !F.joined()) return '';
    return '<button type="button" class="fam-come" data-fam-come aria-label="叫家人来一下"><img src="assets/yiya/wave.webp" alt="" aria-hidden="true" decoding="async">叫家人来一下</button>';
  }
  var comeBusy = false;
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest && e.target.closest('[data-fam-come]');
    if (!b || comeBusy) return;
    var F = FS();
    if (!F || !F.joined()) return;
    comeBusy = true;
    F.come().then(function (r) {
      var n = (r && r.sent) || 0;
      if (n) Util.toast('已叫 ' + n + ' 台手机', 'ok', { face: 'send' });
      else Util.toast((r && r.noSub) ? '家人还没开通知，这次没叫到' : '家里还没有别的手机', 'warn');
    }, function (er) { Util.toast(er.message || '没叫到，稍后再试', 'error'); }).then(function () { setTimeout(function () { comeBusy = false; }, 1200); });
  });

  /* ---------- 记录上的「爸爸记」小字（textContent 写入，不走 innerHTML） ---------- */
  var byCache = { gen: -1, map: null };
  function byMap() {
    if (byCache.gen === Storage._gen && byCache.map) return byCache.map;
    var d = Storage.get(), act = d.settings.activeBabyId, map = {};
    Storage.Meta.walk(d, function (scope, type, id, kind, r) {
      if (kind === 'rec' && (scope === act || scope === 'fam' || scope === '_') && r && typeof r.by === 'string') map[id] = r.by;
    });
    byCache = { gen: Storage._gen, map: map };
    return map;
  }
  function labelFor(by) {
    var F = FS();
    if (!by || by === 'local') return '';
    var me = F && F.info() ? F.info().deviceId : null;
    if (by === me) return '';
    if (by === 'fam') return '家人记';
    var n = F ? F.memberName(by) : '';
    return n ? n + '记' : (F && F.joined() ? '家人记' : '');
  }
  function decorate(root) {
    var cards = root.querySelectorAll ? root.querySelectorAll('.tl-card[data-open]') : [];
    if (!cards.length) return;
    var map = byMap();
    Array.prototype.forEach.call(cards, function (c) {
      if (c.querySelector('.fam-by')) return;
      var lab = labelFor(map[c.getAttribute('data-open')]);
      if (!lab) return;
      var host = c.querySelector('.tl-txt') || c;
      var s = document.createElement('small');
      s.className = 'fam-by';
      s.textContent = lab;
      host.appendChild(s);
    });
  }
  function startObserver() {
    if (!global.MutationObserver || !document.body) return;
    var pend = false;
    new MutationObserver(function (muts) {
      if (pend) return;
      for (var i = 0; i < muts.length; i++) if (muts[i].addedNodes && muts[i].addedNodes.length) { pend = true; break; }
      if (pend) requestAnimationFrame(function () { pend = false; try { decorate(document); } catch (e) {} });
    }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startObserver); else startObserver();

  var FamUI = {
    mount: mount,
    refresh: function () { if (box && box.isConnected) render(); },
    comeChip: comeChip,
    _decorate: decorate,
    _gotCode: gotCode
  };
  if (global.FamSync) FamSync.on(function () {
    /* 状态行原地更新，不整卡重画（免得打断正在勾选 / 输入） */
    if (!box || !box.isConnected) return;
    var F = FS(), st = F.state();
    if (!F.joined()) { if (box.querySelector('.fam-on')) render(); return; }
    if (!box.querySelector('.fam-on')) { render(); return; }
    var q = function (s) { return box.querySelector(s); };
    if (q('[data-fam-last]')) q('[data-fam-last]').textContent = ago(st.lastSync);
    if (q('[data-fam-pending]')) q('[data-fam-pending]').textContent = F.pendingCount() + ' 条';
    if (q('[data-fam-dropped]')) q('[data-fam-dropped]').textContent = (st.dropped || 0) + ' 条';
  });
  global.FamUI = FamUI;
})(window);
