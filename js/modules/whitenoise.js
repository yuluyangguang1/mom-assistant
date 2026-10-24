/**
 * whitenoise.js - 哄睡白噪音（本机实时合成，零音频文件、零网络、零后端）
 *
 * 为什么用合成而不是音频文件：
 * 1. 本地优先：不下载 mp3、不请求 CDN，断网 / 飞行模式 / 双击本地文件都能用；
 *    也正因此这个功能「不需要后端」——声音在设备上算出来，不经过任何服务器。
 * 2. 体积：一段可循环的噪音若用 mp3 至少几百 KB 到数 MB，合成只需几十行。
 *
 * 依据（W 系列规范，证据与出处见《哄睡白噪音与首次引导_功能研究与落地设计》）：
 * - W-01 白/粉/棕三种声音本机合成，不宣称哪种「更好」——现有证据不足以证明某一颜色对婴儿更优，
 *        因此只描述听感差异，由家长按宝宝反应取舍。
 * - W-02 默认最保守：默认音量 3/10、默认 20 分钟定时关闭；「不限时」是显式选项而非默认。
 *        AAP 的表述是「放得越远越好、音量越低越好、限制使用时长」，并曾建议离孩子 7 英尺（约 2.1 米）以上；
 *        Erbele 等（Sleep Medicine, 2024）测得 24 款设备 + 6 个手机 App 最大音量全部超过
 *        NIOSH 8 小时职业暴露限值（85 dBA），并建议上限控制在 60 dB（专家建议/综述推论，非监管标准）。
 * - W-03 只陈述事实与上限，不做疗效承诺，也不承诺「完全安全」。
 * - W-04 把白噪音讲成「睡眠情境线索」而非药物，并给逐步停用路径，不制造依赖也不设戒除期限。
 * - W-05 与睡眠计时联动：一键同时开始哄睡计时，减少一步操作（呼应 U-05 记录成本验收线）。
 * - W-06 不替代安全睡眠：常驻 1 岁以下「仰睡、床内净空、同室不同床」提醒。
 */
(function (global) {
  'use strict';
  var Storage = global.Storage, Util = global.Util;
  var Modules = global.Modules = global.Modules || {};

  var TYPES = [
    { v: 'pink', t: '粉红噪音', desc: '柔和偏低沉，像细雨落在窗外' },
    { v: 'white', t: '白噪音', desc: '沙沙声，遮蔽突发声响更明显' },
    { v: 'brown', t: '棕色噪音', desc: '更低更厚，像远处的风或海浪' },
    /* 第 204 次：扩充四种，仍是本机合成、零音频文件。只描述听感，不宣称哪种更助眠。 */
    { v: 'shush', t: '嘘声', desc: '「嘘——嘘——」一起一伏，像大人在耳边轻轻哄' },
    { v: 'ocean', t: '海浪', desc: '低沉的浪声，约 8 秒一涨一落' },
    { v: 'heart', t: '心跳', desc: '每分钟约 75 下的「咚—咚」，底下垫一层很轻的低噪。手机外放会偏薄，戴耳机或接音箱更像' },
    { v: 'fan', t: '风扇', desc: '稳定的低沉气流声，没有起伏' }
  ];
  /* 循环片段长度：海浪一个涨落周期 8 秒，其余 4 秒（嘘声 2 秒一下、心跳 0.8 秒一下，都能整除） */
  function loopSec(type) { return type === 'ocean' ? 8 : 4; }
  var MINUTES = [10, 20, 30, 0]; /* 0 = 不限时（显式选择，且带提示） */

  /* ---------------- 音频引擎（状态活在页面里，不产生任何网络请求） ---------------- */
  var engine = { ctx: null, src: null, gain: null, playing: false, pending: null, el: null, url: null, mode: null };

  function AudioCtx() { return global.AudioContext || global.webkitAudioContext || null; }
  function audioSupported() { return !!AudioCtx() || elemSupported(); }
  /* 第 116 次：iOS 判定（用于「侧边静音拨片」提示）。
     老 iOS UA 含 iPhone/iPad/iPod；新 iPadOS 报Macintosh，靠 maxTouchPoints 区分。
     不参与任何逻辑分支，只决定要不要显示那段排查提示。 */
  function isIOS() {
    try {
      var ua = (global.navigator && global.navigator.userAgent) || '';
      if (/iPhone|iPad|iPod/i.test(ua)) return true;
      if (/Macintosh/i.test(ua) && global.navigator && global.navigator.maxTouchPoints > 1) return true;
    } catch (e) {}
    return false;
  }


  /** 生成 4 秒可循环噪音缓冲：白 = 均匀随机；粉 / 棕 = 对白噪音做不同频率加权 */
  function noiseBuffer(ctx, type) {
    var len = Math.floor(ctx.sampleRate * loopSec(type));
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    fillNoise(buf.getChannelData(0), type, ctx.sampleRate);
    return buf;
  }
  /* 第 187 次：噪音样本生成抽出来，Web Audio 缓冲与 <audio> 用的 WAV 共用一套算法 */
  /* 把新声音的均方根响度对齐到粉红噪音的水平（约 0.12），切换类型时音量不跳 */
  function normRms(data, target) {
    var sum = 0, i, n = data.length;
    for (i = 0; i < n; i++) sum += data[i] * data[i];
    var rms = Math.sqrt(sum / Math.max(1, n));
    if (rms > 0) { var k = target / rms; for (i = 0; i < n; i++) data[i] *= k; }
    return data;
  }
  function fillNoise(data, type, sr) {
    var len = data.length;
    var i;
    sr = sr || WAV_SR;
    if (type === 'shush' || type === 'ocean' || type === 'fan' || type === 'heart') {
      var TAU = Math.PI * 2, lp = 0, lp2 = 0, br = 0;
      for (i = 0; i < len; i++) {
        var w0 = Math.random() * 2 - 1, tt = i / sr;
        if (type === 'shush') {
          /* 高通后的嘶声 × 2 秒一次的起伏（0.25~1） */
          lp += 0.08 * (w0 - lp);
          var env = 0.25 + 0.75 * Math.pow(Math.sin(Math.PI * tt / 2), 2);
          data[i] = (w0 - lp) * env;
        } else if (type === 'ocean') {
          /* 棕噪音 × 8 秒涨落，浪头处叠一点高频「碎浪」 */
          br = (br + 0.02 * w0) / 1.02;
          var sw = 0.5 - 0.5 * Math.cos(TAU * tt / 8);
          data[i] = br * 6 * (0.2 + 0.8 * sw) + w0 * 0.05 * sw * sw;
        } else if (type === 'fan') {
          /* 两级低通的平稳气流 */
          lp += 0.12 * (w0 - lp); lp2 += 0.12 * (lp - lp2);
          data[i] = lp2;
        } else {
          /* 心跳：0.8 秒一拍，「咚」50 Hz 衰减 0.12 秒，0.3 秒后「哒」幅度 0.6；底噪很轻 */
          /* 手机外放几乎放不出 100 Hz 以下，所以「咚」叠上 180 / 300 Hz 泛音，外放也听得见 */
          var ph = tt % 0.8, th = 0;
          function thump(x, a, k) { return a * Math.exp(-x / k) * (Math.sin(TAU * 60 * x) + 0.7 * Math.sin(TAU * 180 * x) + 0.4 * Math.sin(TAU * 300 * x)); }
          if (ph < 0.15) th = thump(ph, 1, 0.04);
          else if (ph >= 0.3 && ph < 0.45) th = thump(ph - 0.3, 0.6, 0.035);
          br = (br + 0.02 * w0) / 1.02;
          data[i] = th + br * 0.4;
        }
      }
      return normRms(data, type === 'heart' ? 0.1 : 0.12);
    }
    if (type === 'white') {
      for (i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * 0.6;
      return data;
    }
    if (type === 'brown') {
      /* 棕噪音：白噪音做积分（低频更重），加泄漏防直流漂移 */
      var last = 0;
      for (i = 0; i < len; i++) {
        var w = (Math.random() * 2 - 1) * 0.6;
        last = (last + 0.02 * w) / 1.02;
        data[i] = last * 6;
      }
      return data;
    }
    /* 粉红噪音：Paul Kellet 近似法（多级一阶滤波叠加），听感比白噪音柔和 */
    var b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (i = 0; i < len; i++) {
      var white = (Math.random() * 2 - 1) * 0.6;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }
    return data;
  }

  /* 第 187 次（P0：锁屏后继续播放）：
     Web Audio 在 iOS 锁屏/切后台时会被系统挂起；<audio> 元素走媒体播放通道，锁屏可继续。
     做法：本机把噪音写成 WAV（Blob URL，仍然零网络）交给 <audio> 播放。
     · iOS 不允许脚本改 <audio>.volume → 音量直接烘焙进样本；
     · 锁屏后页面脚本可能被冻结，setInterval 定时关不可靠 →
       定时模式把「时长 + 开头 3 秒淡入 + 结尾 8 秒淡出」整段烘焙进文件，播完即停，
       「限制使用时长」由音频本身保证，不依赖脚本是否还在跑；不限时则 4 秒片段 loop。
     · 8 kHz / 16 bit 单声道：20 分钟约 19 MB 内存，30 分钟约 29 MB，用完即释放。 */
  var WAV_SR = 8000;
  function buildWav(type, volume, minutes) {
    var base = fillNoise(new Float32Array(WAV_SR * loopSec(type)), type, WAV_SR);
    var total = minutes > 0 ? minutes * 60 * WAV_SR : base.length;
    var g = gainOf(volume) * 1.6; /* 与 Web Audio 的听感大致对齐（低采样率高频少，略补一点） */
    var buf = new ArrayBuffer(44 + total * 2);
    var v = new DataView(buf);
    function str(o, t) { for (var k = 0; k < t.length; k++) v.setUint8(o + k, t.charCodeAt(k)); }
    str(0, 'RIFF'); v.setUint32(4, 36 + total * 2, true); str(8, 'WAVE');
    str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, WAV_SR, true); v.setUint32(28, WAV_SR * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, total * 2, true);
    var fin = minutes > 0 ? 3 * WAV_SR : 0, fout = minutes > 0 ? 8 * WAV_SR : 0;
    var blen = base.length;
    for (var i = 0, o = 44; i < total; i++, o += 2) {
      var env = 1;
      if (i < fin) env = i / fin;
      else if (fout && i > total - fout) env = (total - i) / fout;
      var x = base[i % blen] * g * env;
      if (x > 1) x = 1; else if (x < -1) x = -1;
      v.setInt16(o, Math.round(x * 32767), true);
    }
    return new Blob([buf], { type: 'audio/wav' });
  }
  function elemSupported() {
    try { return typeof global.Audio === 'function' && typeof Blob === 'function' && !!(global.URL && URL.createObjectURL); }
    catch (e) { return false; }
  }
  function releaseElem() {
    var el = engine.el, url = engine.url;
    engine.el = null; engine.url = null;
    if (el) { try { el.onended = null; el.onplaying = null; el.pause(); el.removeAttribute('src'); el.load(); } catch (e) {} }
    if (url) { try { URL.revokeObjectURL(url); } catch (e) {} }
  }
  function mediaSession(on) {
    var ms = global.navigator && global.navigator.mediaSession;
    if (!ms) return;
    try {
      if (on) {
        if (global.MediaMetadata) ms.metadata = new global.MediaMetadata({ title: '哄睡白噪音', artist: '咿呀记' });
        ['pause', 'stop'].forEach(function (a) {
          try { ms.setActionHandler(a, function () { stop(); if (global.App) global.App.rerender(); }); } catch (e) {}
        });
        ms.playbackState = 'playing';
      } else {
        ms.playbackState = 'none';
      }
    } catch (e) {}
  }
  /** <audio> 路径。返回 true = 已发起播放；false = 本环境不支持，调用方回落 Web Audio */
  function startElem(type, volume, minutes, linkSleep, prefMin) {
    if (!elemSupported()) return false;
    var el, url;
    try {
      /* iOS 17+：声明为播放型会话——不受静音拨片影响，锁屏继续 */
      if (global.navigator && global.navigator.audioSession) global.navigator.audioSession.type = 'playback';
    } catch (e) {}
    try {
      url = URL.createObjectURL(buildWav(type, volume, minutes));
      el = new global.Audio();
      el.src = url;
      el.loop = !(minutes > 0);
      el.setAttribute('playsinline', '');
    } catch (e) { if (url) try { URL.revokeObjectURL(url); } catch (e2) {} return false; }
    engine.el = el; engine.url = url; engine.playing = true; engine.mode = 'elem';
    el.onplaying = function () {
      if (engine.el !== el) return;
      writeState(true, type, volume, prefMin != null ? prefMin : minutes, linkSleep);
      if (minutes > 0) { var w0 = Storage.get().whitenoise; if (w0) { w0.until = Date.now() + minutes * 60000; Storage.save(); } }
      mediaSession(true);
    };
    el.onended = function () {
      if (engine.el !== el) return;
      stop();
      if (global.Util && Util.toast) Util.toast('白噪音已按 ' + minutes + ' 分钟定时关闭。', 'ok');
      if (global.App) global.App.rerender();
    };
    var p;
    try { p = el.play(); } catch (e) { releaseElem(); engine.playing = false; return false; }
    if (p && p['catch']) p['catch'](function () {
      if (engine.el !== el) return;
      releaseElem(); engine.playing = false;
      writeState(false);
      if (global.Util && Util.toast) Util.toast('没能开始播放，请再点一次「开始播放」。', 'warn');
      if (global.App) global.App.rerender();
    });
    return true;
  }


  /* 音量换算：滑块 1–10 → 线性增益。上限刻意压得很低（0.22）：
     「手机贴着小床」时的真实声压取决于设备与距离，应用能做的只是把输出天花板压低，
     其余交给页面上那句「把手机放到宝宝头部位置，听起来应该很轻」。 */
  function gainOf(volume) { return Math.max(0.006, (volume / 10) * 0.22); }

  function fadeTo(value, seconds) {
    if (!engine.gain || !engine.ctx) return;
    var now = engine.ctx.currentTime;
    try {
      engine.gain.gain.cancelScheduledValues(now);
      engine.gain.gain.setValueAtTime(engine.gain.gain.value, now);
      engine.gain.gain.linearRampToValueAtTime(value, now + seconds);
    } catch (e) { engine.gain.gain.value = value; }
  }

  /** 开始播放（必须由用户点击触发——浏览器要求音频需手势才能出声）

      第 116 次（真机实测：手机上哄睡白噪音没有声音）：
      旧实现是 `ctx.resume()` 不等它resolve 就直接往下建节点、src.start(0)，
      桌面内核（state 直接 running）看不出问题，但 iOS Safari /微信 X5 上
      resume() 是异步的，且在「非用户手势栈内」调用会被忽略或被系统挂起——
      结果 ctx 停在 suspended，src 已经 start 了却永远不会推进 currentTime，
      听感就是「按了没声音」，而界面状态却显示在播放（撒谎）。

      修法三件事：
        1. resume() 的 Promise 必须等（用 then 续做），且只在手势栈内首次触发；
        2. 监听 statechange，若 resume 失败/仍suspended，走 resumeGated() 再试一次
           （iOS 允许在后续任意用户手势里解锁）；
        3. 状态落库改为「确认 running 才写 playing=true」，避免界面撒谎；
           失败时返回 false，调用方负责 toast 提示。 */
  function start(type, volume, minutes, linkSleep, prefMin) {
    stopEngine(true);
    if (startElem(type, volume, minutes, linkSleep, prefMin)) return true;
    var AC = AudioCtx();
    if (!AC) return false;
    engine.mode = 'ctx';
    var ctx = engine.ctx || new AC();
    engine.ctx = ctx;

    /* 第 116 次二次修正（真机复测仍无声后）：节点链必须在【手势调用栈内同步建好】，
       不能等 resume() 的 Promise 兑现再建。
       原因：iOS 的规则是「音频图必须在用户手势的那一次调用里构建并启动」，
       resume() 只是把已建好的图解锁。若把 createBufferSource/createGain/
       start() 推迟到 .then 回调里执行，那个回调已不在手势栈内，
       iOS 会判定为「非手势发起的音频」而静默拒绝 —— 状态显示 running，
       实际仍然没声音（本批第一次修复正是踩了这个坑）。

       所以顺序必须是：同步建图 → 同步 start(0) → 再调 resume 解锁。
       gain 保持 0，靠 resume 兑现后的斜坡淡入；解锁前听不到声音，
       但图已就绪，resume 一成功立刻出声。 */
    var src = null, gain = null;
    try {
      src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx, type);
      src.loop = true;
      gain = ctx.createGain();
      gain.gain.value = 0;/* 解锁前先静音，resume 兑现后淡入 */
      src.connect(gain);
      gain.connect(ctx.destination);
      src.start(0);
    } catch (e) { return false; }

    engine.src = src;
    engine.gain = gain;
    engine.playing = true;
    engine.pending = { type: type, volume: volume, minutes: minutes, linkSleep: linkSleep };

    /* 解锁：已在 running 直接淡入；suspended 则等 resume 兑现再淡入。
       两种情况都【不】重建节点，只动增益。 */
    function fadeIn() {
      /* 守卫：用户可能「点开始 → 立刻点停止」，此时 engine.playing 已是false。
         若不查这一下，resume 稍后兑现会把已停的声音又淡入回来，
         表现为「明明按了停止，声音却停不下来」。 */
      if (!engine.playing) return false;
      if (ctx.state === 'running') {
        engine.pending = null;
        fadeTo(gainOf(volume), 3);
        writeState(true, type, volume, minutes, linkSleep);
        if (global.Util && Util.toast) Util.toast('白噪音已开始播放', 'ok');
        return true;
      }
      resumeGated();
      return false;
    }

    if (ctx.state === 'running') { fadeIn(); return true; }

    try {
      var p = ctx.resume();
      if (p && p.then) {
        p.then(function () { fadeIn(); })['catch'](function () { resumeGated(); });
      }
    } catch (e) { /* 同步抛：留给 resumeGated 在后续手势里再试 */ }
    resumeGated();
    return true; /* 已发起（等resume 兑现后 writeState 才会写 playing=true） */
  }

  /** 在后续任意用户手势里再试解锁（iOS 的标准解锁路径）。
      注册一次性监听，resume 成功后：摘监听 + 把待定的播放真正启动（淡入 + 落库）。
      第 116 次：pending 里的参数就是为此存在 —— 图已建好，只差「解锁 + 淡入」。 */
  function resumeGated() {
    var unlock = function () {
      var ctx = engine.ctx;
      if (!ctx) return;
      try { if (ctx.state !== 'running' && ctx.resume) ctx.resume(); } catch (e) {}
      if (ctx.state === 'running') {
        document.removeEventListener('touchstart', unlock, true);
        document.removeEventListener('click', unlock, true);
        /* 同fadeIn 的守卫：已停止就别把 pending 消费掉，更不能淡入 */
        var pd = engine.playing ? engine.pending : null;
        if (pd && engine.gain) {
          engine.pending = null;
          fadeTo(gainOf(pd.volume), 3);
          writeState(true, pd.type, pd.volume, pd.minutes, pd.linkSleep);
        } else {
          engine.pending = null;
        }
      }
    };
    try {
      document.addEventListener('touchstart', unlock, true);
      document.addEventListener('click', unlock, true);
    } catch (e) { /* 无 addEventListener 的老内核：靠上面的同步 resume */ }
  }

  /** 播放状态落库：只有 ctx 真的 running 才记 playing=true（避免界面撒谎） */
  function writeState(playing, type, volume, minutes, linkSleep) {
    var d = Storage.get();
    if (playing) {
      d.whitenoise = {
        playing: true, type: type, volume: volume, minutes: minutes,
        until: minutes > 0 ? (Date.now() + minutes * 60000) : null,
        linkSleep: !!linkSleep
      };
    } else if (d.whitenoise) {
      d.whitenoise.playing = false;
      d.whitenoise.until = null;
    }
    Storage.save();

    /* W-05 联动：一次点击同时开始哄睡计时（若当前没有计时在进行） */
    if (playing && linkSleep && !d.openSleep) {
      d.openSleep = { id: Util.uid(), start: Util.nowLocal(), pausedMs: 0, pauseStart: null };
      Storage.save();
    }
  }

  function stopEngine(immediate) {
    if (!engine.playing) return;
    engine.playing = false;
    if (engine.mode === 'elem') { releaseElem(); mediaSession(false); engine.pending = null; return; }
    /* 第 116 次：清掉待定播放参数。
       否则「点开始 → 立刻点停止 → 此时 resume 才兑现」会让 pending 里的
       参数复活，把已停止的音频又淡入回来（用户听到停不下来的声音）。 */
    engine.pending = null;
    var src = engine.src, gain = engine.gain;
    engine.src = null;
    if (gain && !immediate) {
      fadeTo(0, 2); /* 渐出 2 秒：不制造「突然安静」的对比 */
      setTimeout(function () { try { src.stop(0); } catch (e) {} }, 2200);
    } else {
      try { if (src) src.stop(0); } catch (e) {}
    }
  }

  /** 停止播放并写回本机（保留类型/音量/时长偏好，下次按上次值预填 —— U-06） */
  function stop() {
    stopEngine(false);
    var d = Storage.get();
    if (d.whitenoise) {
      d.whitenoise.playing = false;
      d.whitenoise.until = null;
    }
    Storage.save();
  }

  /** 刷新页面后音频必然已停：清掉「播放中」的残留状态，避免界面撒谎 */
  function resetStaleState() {
    var d = Storage.get();
    if (d.whitenoise && d.whitenoise.playing) {
      d.whitenoise.playing = false;
      d.whitenoise.until = null;
      Storage.save();
    }
  }

  function remainingMin() {
    var wn = (Storage.get() || {}).whitenoise || {};
    if (!wn.playing || !wn.until) return null;
    return Math.max(0, Math.ceil((wn.until - Date.now()) / 60000));
  }

  function typeName(v) {
    for (var i = 0; i < TYPES.length; i++) if (TYPES[i].v === v) return TYPES[i].t;
    return '粉红噪音';
  }

  /* 第 187 次：按剩余分钟重建（改音量用）；不限时则原样 */
  function restartRemaining(cur) {
    var left = cur.until ? Math.max(1, Math.ceil((cur.until - Date.now()) / 60000)) : 0;
    start(cur.type, cur.volume, cur.minutes > 0 ? left : 0, cur.linkSleep, cur.minutes);
  }

  /* 定时器：即使用户已经离开本页，到点也必须停 ——「限制使用时长」不能只存在于界面上 */
  setInterval(function () {
    /* 第 146 次：脚本解析即启动的定时器可能早于 Storage.load() 触发（实测偶发 pageerror），先判空 */
    var wn = (Storage.get() || {}).whitenoise;
    if (!wn || !wn.playing || !wn.until) return;
    if (Date.now() >= wn.until) {
      var mins = wn.minutes;
      stop();
      Util.toast('白噪音已按 ' + mins + ' 分钟定时关闭。', 'ok');
      if (global.App) global.App.rerender();
    }
  }, 1000);

  Modules.whitenoise = {
    id: 'whitenoise',
    title: '哄睡白噪音',
    render: function (view) {
      var d = Storage.get();
      var wn = d.whitenoise;
      var supported = audioSupported();
      var rem = remainingMin();
      var html = '';

      /* 状态 + 主控 */
      html += '<div class="card noise-card"><h2>哄睡声音</h2>';
      if (!supported) {
        html += '<p class="hint">当前环境不支持音频播放（例如部分内嵌浏览器未开启声音权限）。'
          + '用手机 / 电脑的浏览器直接打开本页即可使用；不支持的设备上其余功能不受影响，也不影响你的记录。</p>';
      } else {
        html += '<p class="noise-state">' + (wn.playing
          ? '正在播放：' + typeName(wn.type) + (rem != null ? '，还有约 ' + rem + ' 分钟自动关闭' : '，当前设为不限时')
          : '未播放') + '</p>';
        html += '<p class="hint">声音在本机实时生成：不下载音频文件、不联网、飞行模式也能用。</p>';
        /* 第 116 次（真机实测：手机上按了没声音）：iOS 上最常见的两个非代码原因，
           用户无从判断是哪个，必须主动说出来而不是让用户反复试。
           ① 侧边静音拨片处于静音位时，Web Audio 走的是「遵从静音键」通道，出不来声；
           ② iOS 媒体音量已调到 0 或锁屏打断了音频会话。 */
        if (isIOS()) {
          html += '<p class="hint">iPhone 没声音？先确认两件事：'
            + '① 侧边静音拨片不在静音位（拨片朝上）；'
            + '② 媒体音量没调到 0。锁屏后会继续播放，到时间自动停；也可以在锁屏的播放控件上点暂停。'
            + '外放没声音时，改用耳机或开免提再试。</p>';
        }
        html += '<button class="btn ' + (wn.playing ? '' : 'btn-primary') + '" id="wnToggle" type="button">'
          + (wn.playing ? '停止播放' : '开始播放') + '</button>';
      }
      html += '</div>';

      if (supported) {
        /* 类型：只描述听感、不排名——没有证据证明某种「颜色」对婴儿更好 */
        html += '<div class="card"><h2>声音类型</h2>';
        TYPES.forEach(function (t) {
          html += '<div class="row-switch"><label for="wnT_' + t.v + '">' + t.t + '</label>'
            + '<input type="radio" name="wnType" id="wnT_' + t.v + '" value="' + t.v + '"'
            + (wn.type === t.v ? ' checked' : '') + '></div>';
          html += '<p class="hint">' + t.desc + '。</p>';
        });
        html += '<p class="hint">哪一种都行，看宝宝听到后是不是更放松。都不喜欢就别硬放——'
          + '很多宝宝有稳定的生活声（风扇、空调）就已经够了。</p>';
        html += '</div>';

        /* 音量与时长：默认保守，上限写进说明里 */
        html += '<div class="card"><h2>音量与时长</h2>';
        html += '<label>音量 <span id="wnVolVal">' + wn.volume + '</span> / 10'
          + '<input type="range" id="wnVol" min="1" max="10" step="1" value="' + wn.volume + '"></label>';
        html += '<p class="hint">默认 3 已经是很轻的背景声。判断标准不是数字，而是'
          + '<b>把手机放到宝宝睡觉时头部的位置，听起来应该是很轻、不刺耳的</b>；'
          + '如果房间里大人说话都要提高嗓门，那就是太大了。</p>';
        html += '<div class="seg" id="wnMin">';
        MINUTES.forEach(function (m) {
          html += '<button type="button" class="seg-btn' + (wn.minutes === m ? ' active' : '') + '" data-min="' + m + '">'
            + (m === 0 ? '不限时' : m + ' 分钟') + '</button>';
        });
        html += '</div>';
        html += '<p class="hint">默认 20 分钟自动关闭。「不限时」通常是家里环境噪音大时才需要——'
          + '那就更要把音量压到最低，并且不要把设备放进婴儿床。</p>';
        html += '<div class="row-switch"><label for="wnLink">顺便开始哄睡计时</label>'
          + '<input type="checkbox" id="wnLink"' + (wn.linkSleep ? ' checked' : '') + '></div>';
        html += '<p class="hint">勾选后，点「开始播放」会同时开始睡眠计时；宝宝睡着后到睡眠页点「结束并记录」即可。</p>';
        html += '</div>';
      }

      /* 安全：只讲事实与上下限，不做疗效承诺，也不承诺「完全安全」 */
      html += '<div class="card"><h2>用之前先看这几条</h2><ul class="kv">';
      html += '<li><b>离远一点</b>：不要把手机 / 音箱放进婴儿床，也不要对着宝宝耳朵放。'
        + '美国儿科学会（AAP）的表述是「放得越远越好、音量越低越好、限制使用时长」，并曾建议离孩子 7 英尺（约 2.1 米）以上。</li>';
      html += '<li><b>音量别追高</b>：有研究测过 24 款婴儿睡眠音机与 6 个手机 App，'
        + '在最大音量下全部超过 NIOSH 给成年工人的 8 小时职业暴露限值（85 dBA）；'
        + '该研究作者建议把上限控制在 60 dB（属专家建议，不是监管标准）。</li>';
      html += '<li><b>别整夜播</b>：只当作入睡辅助，睡着后关掉或调低，对大人也更好睡。</li>';
      html += '<li><b>早产，或有听力 / 神经发育情况的宝宝</b>：先问儿科或耳鼻喉科医生，不要照网页自行设定。</li>';
      html += '<li><b>它不替代安全睡眠</b>：1 岁以下每次睡觉都应仰睡、床内保持净空（不用枕头、松软被褥、防撞垫、填充玩具），'
        + '并与大人同室不同床。安全永远排在「睡得久」之前。</li>';
      html += '</ul></div>';

      /* W-04 停用路径：讲成「情境线索」，既不制造焦虑也不承诺脱离 */
      html += '<div class="card"><h2>想少用一点的时候</h2>';
      html += '<p class="hint">白噪音更像一个「该睡觉了」的情境线索（和关灯、换睡衣一样），'
        + '不是药物依赖，也没有「几岁必须戒」的说法。如果发现没有声音就完全睡不着，可以这样慢慢退：</p>';
      html += '<ul class="kv">'
        + '<li>1. 每隔几天把音量调低一点，看宝宝是否照睡。</li>'
        + '<li>2. 缩短播放时间：先只用在入睡前，再配合定时关闭。</li>'
        + '<li>3. 增加别的睡前线索：洗澡、换睡衣、拉窗帘、调暗灯、固定绘本或道晚安。</li>'
        + '<li>4. 先挑环境安静的白天小睡试不播，适应后再动夜间。</li>'
        + '</ul>';
      html += '<p class="hint">如果宝宝长时间极难入睡、睡觉时出现呼吸异常，或你对听力、发育有疑虑，'
        + '请找儿科医生评估，而不是继续把音量调大。</p></div>';

      view.innerHTML = html;

      /* ---- 交互 ---- */
      var toggler = view.querySelector('#wnToggle');
      if (toggler) toggler.addEventListener('click', function () {
        var cur = Storage.get().whitenoise;
        var link = view.querySelector('#wnLink');
        if (cur.playing) {
          stop();
          Util.toast('已停止播放', 'ok');
        } else {
          var ok = start(cur.type, cur.volume, cur.minutes, link ? link.checked : cur.linkSleep);
          if (!ok) { Util.toast('这个环境无法播放声音，请在浏览器中打开本页。', 'error'); return; }
          Util.toast('已开始（' + (cur.minutes > 0 ? cur.minutes + ' 分钟后自动关闭' : '不限时') + '）', 'ok');
        }
        global.App.rerender();
      });

      /* 播放中切换类型：直接换声，不让用户先停再开 */
      Array.prototype.forEach.call(view.querySelectorAll('input[name="wnType"]'), function (r) {
        r.addEventListener('change', function () {
          var cur = Storage.get().whitenoise;
          cur.type = r.value;
          Storage.save();
          if (cur.playing) { if (engine.mode === 'elem') restartRemaining(cur); else start(cur.type, cur.volume, cur.minutes, cur.linkSleep); }
          global.App.rerender();
        });
      });

      var volEl = view.querySelector('#wnVol');
      if (volEl) volEl.addEventListener('input', function () {
        var v = parseInt(volEl.value, 10);
        var label = view.querySelector('#wnVolVal');
        if (label) label.textContent = v;
        var cur = Storage.get().whitenoise;
        cur.volume = v;
        Storage.save();
        if (cur.playing && engine.playing && engine.mode !== 'elem') fadeTo(gainOf(v), 0.3); /* 播放中实时改音量 */
      });
      /* 第 187 次：<audio> 路径音量烘焙在文件里——松手后按剩余时长重建一次 */
      if (volEl) volEl.addEventListener('change', function () {
        var cur = Storage.get().whitenoise;
        if (cur.playing && engine.playing && engine.mode === 'elem') restartRemaining(cur);
      });

      Array.prototype.forEach.call(view.querySelectorAll('#wnMin [data-min]'), function (b) {
        b.addEventListener('click', function () {
          var cur = Storage.get().whitenoise;
          var m = parseInt(b.getAttribute('data-min'), 10);
          cur.minutes = m;
          cur.until = cur.playing ? (m > 0 ? Date.now() + m * 60000 : null) : null;
          Storage.save();
          /* 第 187 次：<audio> 路径时长烘焙在文件里，改时长要重建 */
          if (cur.playing && engine.playing && engine.mode === 'elem') start(cur.type, cur.volume, m, cur.linkSleep);
          /* 选「不限时」时再提醒一次：这是需要额外自律的选项 */
          if (m === 0 && cur.playing) {
            Util.toast('已设为不限时：请把音量压到最低，并且不要放在婴儿床里。', 'warn');
          }
          global.App.rerender();
        });
      });

      var linkEl = view.querySelector('#wnLink');
      if (linkEl) linkEl.addEventListener('change', function () {
        Storage.get().whitenoise.linkSleep = linkEl.checked;
        Storage.save();
      });
    }
  };

  /* 供首页 / 提醒卡复用：不打开页面也能知道还剩多久 */
  Modules.whitenoise._remainingMin = remainingMin;
  Modules.whitenoise._typeName = typeName;
  Modules.whitenoise._audioSupported = audioSupported;
  Modules.whitenoise.resetStaleState = resetStaleState;
  Modules.whitenoise._stop = stop;
  /* 第 116 次：测试入口。让 qa 能真正驱动「resume → 建节点 → start → 写库」
     这条路径并观察 AudioContext 状态，而不是只能对源码做正则断言——
     本批的核心修复（等 resume）恰恰是运行时行为，静态断言验证不了它。
     前缀下划线与既有 _stop / _audioSupported 一致，属内部接口，不进 UI。 */
  Modules.whitenoise._startForTest = start;
  Modules.whitenoise._fill = function (type, sr) { return fillNoise(new Float32Array((sr || WAV_SR) * loopSec(type)), type, sr || WAV_SR); };
  Modules.whitenoise._wav = buildWav;
  Modules.whitenoise._ctxState = function () { return engine.ctx ? engine.ctx.state : null; };
  Modules.whitenoise._engine = engine;

  /* 页面被隐藏 / 关闭时清掉「播放中」标记：音频会随页面结束，状态不该留成谎言 */
  global.addEventListener('pagehide', function () { resetStaleState(); });
})(window);

