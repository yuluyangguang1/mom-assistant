/**
 * photos.js - 记录照片本机仓库（第 227 次，对标 Cali 便便记录「添加照片 / 拍摄照片」）
 *
 * 为什么不放进 Storage：主数据在 localStorage（约 5MB 上限，且每次保存还有快照副本），
 * 一张压缩后的照片就要 100KB 上下，放进去几十张就会把整个 App 的保存挤爆。
 * 所以照片单独进 IndexedDB（yiya-photos / p），记录上只存照片 id（ph_ + 字母数字）。
 *
 * 约束：
 *  - 全程本机：FileReader/createImageBitmap + canvas，无任何网络。
 *  - 长边压到 1280px、JPEG 0.72，一张通常 80–200KB。
 *  - 照片不进 JSON 备份（备份文件要能被分享/导入，塞照片会变成几十 MB）。
 *  - 没被任何记录引用、且超过 10 分钟的照片由 gc() 清掉（覆盖「加了照片又取消」「删了记录」两种孤儿）。
 */
(function (global) {
  'use strict';
  var DB = 'yiya-photos', ST = 'p', ID_RE = /^ph_[a-z0-9]{4,32}$/;
  var dbp = null, urls = {};
  /* 第 276 次（内存审计 L1：objectURL 只增不减，每看过一张不同的照片就常驻一个 Blob 到冷启动）：
     urls 改成最多 LRU 张的 LRU（order 记先后，最近用过的在末尾）。超出时从最久没用的开始 revoke，
     但页面上还有 <img> 正用着的不动（revoke 了它就没法重画）；离开页面 / 删记录 / 切到后台时再收一遍。 */
  var LRU = 12, order = [];
  function touch(id) { var i = order.indexOf(id); if (i >= 0) order.splice(i, 1); order.push(id); }
  function inDom(u) {
    try {
      var ims = document.images;
      for (var i = 0; i < ims.length; i++) if (ims[i].isConnected && (ims[i].getAttribute('src') === u || ims[i].currentSrc === u)) return true;
    } catch (e) {}
    return false;
  }
  function pinned(id) {
    if (inDom(urls[id])) return true;
    try { return !!document.querySelector('img[data-phid="' + id + '"]'); } catch (e) { return false; } /* id 只含 ph_ + 字母数字 */
  }
  function drop(id) {
    var u = urls[id]; if (!u) return;
    try { URL.revokeObjectURL(u); } catch (e) {}
    delete urls[id];
    var i = order.indexOf(id); if (i >= 0) order.splice(i, 1);
  }
  /* 收到 max 张以内；keep(id) 为真的（还被记录引用）也只在超额时才收 */
  function trim(max, keepFn) {
    var n = order.length;
    for (var i = 0; i < order.length && n > max;) {
      var id = order[i];
      if (pinned(id) || (keepFn && keepFn(id))) { i++; continue; }
      drop(id); n--;
    }
  }
  function referenced() {
    var set = {}, dd = (global.Storage && Storage.get && Storage.get()) || {};
    var add = function (arr) { (arr || []).forEach(function (r) { if (r && r.photos) Photos.clean(r.photos).forEach(function (id) { set[id] = 1; }); }); };
    add(dd.diapers); add(dd.feedings); add(dd.supplies); add(dd.prenatal && dd.prenatal.visits); /* 第 298 次：产检报告图片 */
    (dd.supplies || []).forEach(function (s) { if (s && Photos.validId(s.img)) set[s.img] = 1; }); /* 第 294 次：用品的物件照片 */
    (dd.babies || []).forEach(function (bb) { if (bb && bb.rec) { add(bb.rec.diapers); add(bb.rec.feedings); } });
    return set;
  }

  function open() {
    if (dbp) return dbp;
    dbp = new Promise(function (res, rej) {
      if (!global.indexedDB) { rej(new Error('no-idb')); return; }
      var r = indexedDB.open(DB, 1);
      r.onupgradeneeded = function () { r.result.createObjectStore(ST); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { dbp = null; rej(r.error); };
    });
    return dbp;
  }
  function tx(mode, fn) {
    return open().then(function (db) {
      return new Promise(function (res, rej) {
        var t = db.transaction(ST, mode), out;
        var q = fn(t.objectStore(ST));
        if (q) q.onsuccess = function () { out = q.result; };
        t.oncomplete = function () { res(out); };
        t.onerror = t.onabort = function () { rej(t.error); };
      });
    });
  }

  function loadImage(file) {
    if (global.createImageBitmap) {
      return createImageBitmap(file).catch(function () { return viaImg(file); });
    }
    return viaImg(file);
  }
  function viaImg(file) {
    return new Promise(function (res, rej) {
      var u = URL.createObjectURL(file), img = new Image();
      img.onload = function () { URL.revokeObjectURL(u); res(img); };
      img.onerror = function () { URL.revokeObjectURL(u); rej(new Error('bad-image')); };
      img.src = u;
    });
  }

  var Photos = {
    MAX: 6,
    validId: function (id) { return typeof id === 'string' && ID_RE.test(id); },
    clean: function (ids) {
      var out = [];
      (Array.isArray(ids) ? ids : []).forEach(function (id) { if (Photos.validId(id) && out.indexOf(id) < 0 && out.length < Photos.MAX) out.push(id); });
      return out;
    },
    /** 压缩成 JPEG Blob：长边 ≤ max */
    compress: function (file, max, q) {
      max = max || 1280; q = q || 0.72;
      return loadImage(file).then(function (img) {
        var w = img.width, h = img.height, k = Math.min(1, max / Math.max(w, h));
        var cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(w * k)); cv.height = Math.max(1, Math.round(h * k));
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        if (img.close) img.close();
        return new Promise(function (res, rej) {
          if (cv.toBlob) cv.toBlob(function (b) { b ? res(b) : rej(new Error('encode')); }, 'image/jpeg', q);
          else rej(new Error('encode'));
        });
      });
    },
    put: function (blob) {
      var id = 'ph_' + Util.uid().replace(/[^a-z0-9]/g, '');
      return tx('readwrite', function (s) { return s.put({ blob: blob, t: Date.now() }, id); }).then(function () { return id; });
    },
    url: function (id) {
      if (!Photos.validId(id)) return Promise.resolve(null);
      if (urls[id]) { touch(id); return Promise.resolve(urls[id]); }
      return tx('readonly', function (s) { return s.get(id); }).then(function (v) {
        if (!v || !v.blob) return null;
        if (!urls[id]) urls[id] = URL.createObjectURL(v.blob);
        touch(id);
        trim(LRU);
        return urls[id];
      }).catch(function () { return null; });
    },
    /** 把容器里所有 img[data-phid] 填上图（异步） */
    hydrate: function (root) {
      if (!root || !root.querySelectorAll) return;
      Array.prototype.forEach.call(root.querySelectorAll('img[data-phid]'), function (im) {
        Photos.url(im.getAttribute('data-phid')).then(function (u) {
          if (u) im.src = u; else if (im.parentNode) im.parentNode.classList.add('ph-missing');
        });
      });
    },
    /** 第 276 次：收一遍 objectURL —— 页面上没在用、也没有记录再引用的（删了记录 / 面板里移除了）立刻 revoke，
        其余按 LRU 收到上限以内。all=true（切到后台）：页面上没在用的全部 revoke，回来再按需重建。 */
    prune: function (all) {
      if (!order.length) return;
      var ref = referenced();
      order.slice().forEach(function (id) { if (!ref[id] && !pinned(id)) drop(id); });
      trim(all ? 0 : LRU);
    },
    release: function (id) { if (urls[id] && !pinned(id)) drop(id); },
    _live: function () { return order.length; },
    /** 删掉没被引用、且超过 graceMs 的照片 */
    gc: function (keep, graceMs) {
      graceMs = graceMs == null ? 10 * 60000 : graceMs;
      var now = Date.now();
      return tx('readwrite', function (s) {
        var c = s.openCursor();
        c.onsuccess = function () {
          var cur = c.result; if (!cur) return;
          var v = cur.value || {};
          if (keep.indexOf(cur.key) < 0 && !(now - (v.t || 0) < graceMs)) {
            if (urls[cur.key]) drop(cur.key);
            cur.delete();
          }
          cur.continue();
        };
        return null;
      }).catch(function () {});
    },
    /** 第 269 次：尿布、辅食（d.feedings）都能带照片，统一按所有宝宝的这两类记录收集引用再清孤儿；
        每次打开 App 只跑一次 */
    gcAll: function () {
      if (Photos._gcRan || !global.Storage) return Promise.resolve();
      Photos._gcRan = true;
      var keep = [], dd = Storage.get() || {};
      var add = function (arr) { (arr || []).forEach(function (r) { if (r) Photos.clean(r.photos).forEach(function (id) { keep.push(id); }); }); };
      add(dd.diapers); add(dd.feedings); add(dd.supplies); add(dd.prenatal && dd.prenatal.visits); /* 第 298 次 */
      (dd.supplies || []).forEach(function (s) { if (s && Photos.validId(s.img)) keep.push(s.img); }); /* 第 294 次：用品物件照片 + 备注照片 */
      (dd.babies || []).forEach(function (bb) { if (bb && bb.rec) { add(bb.rec.diapers); add(bb.rec.feedings); } });
      return Photos.gc(keep);
    },
    /** 选图或拍照：capture=true 直接开相机；回调收到 File 数组 */
    pick: function (capture, cb) {
      var input = document.createElement('input');
      input.type = 'file'; input.accept = 'image/*';
      if (capture) input.setAttribute('capture', 'environment'); else input.multiple = true;
      input.style.display = 'none';
      document.body.appendChild(input);
      input.addEventListener('change', function () {
        var fs = Array.prototype.slice.call(input.files || []).filter(function (f) { return /^image\//.test(f.type) || !f.type; });
        if (input.parentNode) input.parentNode.removeChild(input);
        if (fs.length) cb(fs);
      });
      input.click();
    },
    /** 全屏看图：点一下关闭；左右滑（或 ← →）看同一条记录的上下张。
        第 278 次（审计 #30）：登记 history（App._pushOverlay），系统返回 / Esc 先关大图、留在底下面板里 */
    view: function (id, list) {
      var ids = (Array.isArray(list) && list.indexOf(id) >= 0) ? list.slice() : [id];
      var idx = ids.indexOf(id);
      var prev = document.querySelector('body > .ph-view');
      if (prev && prev._phClose) prev._phClose();
      Photos.url(id).then(function (u) {
        if (!u) { Util.toast('这张照片不在这台设备上', 'warn'); return; }
        var el = document.createElement('div');
        el.className = 'ph-view'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', '照片');
        var img = document.createElement('img'); img.src = u; img.alt = '记录照片'; img.setAttribute('data-phid', id); img.draggable = false;
        el.appendChild(img);
        var cnt = null;
        if (ids.length > 1) { cnt = document.createElement('div'); cnt.className = 'ph-count'; cnt.setAttribute('aria-live', 'polite'); el.appendChild(cnt); }
        var closed = false, release = null;
        function paintCount() { if (cnt) cnt.textContent = (idx + 1) + ' / ' + ids.length; }
        function close(fromPop) {
          if (closed) return; closed = true;
          if (el.parentNode) el.parentNode.removeChild(el);
          document.removeEventListener('keydown', onKey, true);
          if (!fromPop && release) release();
          if (global.queueStatusColor) global.queueStatusColor();
        }
        el._phClose = function (fromPop) { close(!!fromPop); }; /* 第 279 次：fromPop = 它那条 history 已被系统返回退掉 */
        el._phIndex = function () { return idx; };
        function show(i) {
          if (i < 0 || i >= ids.length) { img.style.transform = ''; return false; }
          idx = i; paintCount();
          Photos.url(ids[i]).then(function (u2) {
            if (closed) return;
            if (!u2) { Util.toast('这张照片不在这台设备上', 'warn'); return; }
            img.src = u2; img.setAttribute('data-phid', ids[i]);
          });
          return true;
        }
        function onKey(e) {
          if (e.key === 'ArrowLeft') { e.preventDefault(); show(idx - 1); }
          else if (e.key === 'ArrowRight') { e.preventDefault(); show(idx + 1); }
        }
        document.addEventListener('keydown', onKey, true);
        /* 手势：横向过 50px 换张（到头回弹），没怎么动算点一下 = 关闭 */
        var sx = 0, sy = 0, pid = null, moved = false;
        el.addEventListener('pointerdown', function (e) { pid = e.pointerId; sx = e.clientX; sy = e.clientY; moved = false; img.style.transition = 'none'; });
        el.addEventListener('pointermove', function (e) {
          if (pid !== e.pointerId) return;
          var dx = e.clientX - sx, dy = e.clientY - sy;
          if (Math.abs(dx) > 8 || Math.abs(dy) > 8) moved = true;
          if (ids.length > 1 && Math.abs(dx) > Math.abs(dy)) img.style.transform = 'translateX(' + dx + 'px)';
        });
        function up(e) {
          if (pid !== e.pointerId) return; pid = null;
          var dx = e.clientX - sx, dy = e.clientY - sy;
          img.style.transition = ''; img.style.transform = '';
          if (ids.length > 1 && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) show(idx + (dx < 0 ? 1 : -1));
        }
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', function (e) { if (pid === e.pointerId) { pid = null; img.style.transition = ''; img.style.transform = ''; } });
        el.addEventListener('click', function () { if (moved) { moved = false; return; } close(false); });
        paintCount();
        document.body.appendChild(el);
        release = global.App && App._pushOverlay ? App._pushOverlay(function () { close(true); }) : null;
        if (global.queueStatusColor) global.queueStatusColor();
      });
    }
  };
  global.Photos = Photos;
  /* 切到后台：页面上没在用的照片地址全部放掉（回前台看到时按需重建，IndexedDB 里的照片不动） */
  try { document.addEventListener('visibilitychange', function () { if (document.hidden) Photos.prune(true); }); } catch (e) {}
})(window);
