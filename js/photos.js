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
      if (urls[id]) return Promise.resolve(urls[id]);
      return tx('readonly', function (s) { return s.get(id); }).then(function (v) {
        if (!v || !v.blob) return null;
        urls[id] = URL.createObjectURL(v.blob);
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
            if (urls[cur.key]) { URL.revokeObjectURL(urls[cur.key]); delete urls[cur.key]; }
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
      add(dd.diapers); add(dd.feedings);
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
    /** 全屏看图：点任意处关闭 */
    view: function (id) {
      Photos.url(id).then(function (u) {
        if (!u) { Util.toast('这张照片不在这台设备上', 'warn'); return; }
        var el = document.createElement('div');
        el.className = 'ph-view'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', '照片');
        var img = document.createElement('img'); img.src = u; img.alt = '记录照片';
        el.appendChild(img);
        el.addEventListener('click', function () { if (el.parentNode) el.parentNode.removeChild(el); });
        document.body.appendChild(el);
      });
    }
  };
  global.Photos = Photos;
})(window);
