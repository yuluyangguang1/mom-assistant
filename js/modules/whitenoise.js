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
    { v: 'fan', t: '风扇', desc: '稳定的低沉气流声，没有起伏' },
    /* 第 206 次：再加两种，凑成 3×3 的声音库；同样本机合成 */
    { v: 'rain', t: '雨声', desc: '绵密的雨幕里零星落下雨滴，没有雷声' },
    { v: 'dryer', t: '吹风机', desc: '偏亮的稳定风声，带一点电机的嗡嗡声，不少宝宝听了会安静下来' }
  ];
  /* 循环片段长度：海浪一个涨落周期 8 秒，其余 4 秒（嘘声 2 秒一下、心跳 0.8 秒一下，都能整除） */
  var TAGS = { pink: '细雨', white: '沙沙', brown: '远风', shush: '轻哄', ocean: '涨落', heart: '75 拍', fan: '气流', rain: '雨夜', dryer: '暖风' };
  var SHORT = { pink: '粉红噪音', white: '白噪音', brown: '棕噪音' };
  TYPES.forEach(function (t) { t.tag = TAGS[t.v] || ''; t.short = SHORT[t.v] || t.t; });
  function typeInfo(v) { for (var i = 0; i < TYPES.length; i++) if (TYPES[i].v === v) return TYPES[i]; return null; }
  /* 第 205 次：线性图标（24 网格、1.6 描边、currentColor），只用于本页 */
  function svg(p) { return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + p + '</svg>'; }
  var ICON = {
    pink: svg('<path d="M7 14a4 4 0 0 1-.5-8 5 5 0 0 1 9.6-1A4 4 0 0 1 17 14H7z"/><path d="M8 17l-1 3M12 17l-1 3M16 17l-1 3"/>'),
    white: svg('<path d="M3 12h1M6 9v6M9 6v12M12 8v8M15 5v14M18 9v6M21 12h0"/>'),
    brown: svg('<path d="M3 9h11a3 3 0 1 0-3-3"/><path d="M3 14h15a3 3 0 1 1-3 3"/><path d="M3 19h6"/>'),
    shush: svg('<path d="M5 12h4"/><path d="M12 8c1.5 1 2.3 2.4 2.3 4s-.8 3-2.3 4"/><path d="M15.5 5.5c2.3 1.6 3.5 3.8 3.5 6.5s-1.2 4.9-3.5 6.5"/>'),
    ocean: svg('<path d="M2 15c2 0 2.5-2 5-2s3 2 5 2 2.5-2 5-2 3 2 5 2"/><path d="M2 19c2 0 2.5-2 5-2s3 2 5 2 2.5-2 5-2 3 2 5 2"/><path d="M6 10c1-3 3.5-5 7-5 1.5 0 3 .5 4 1.5-2 0-3.5 1.2-3.5 3.5"/>'),
    heart: svg('<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/><path d="M7 12h2.5l1.2-2 1.8 4 1.2-2H17"/>'),
    fan: svg('<circle cx="12" cy="12" r="1.6"/><path d="M12 10.4c0-3.4 1-6.4 3.4-6.4 2 0 2.4 3-1 5.2"/><path d="M13.6 12c3.4 0 6.4 1 6.4 3.4 0 2-3 2.4-5.2-1"/><path d="M12 13.6c0 3.4-1 6.4-3.4 6.4-2 0-2.4-3 1-5.2"/><path d="M10.4 12C7 12 4 11 4 8.6c0-2 3-2.4 5.2 1"/>'),
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" fill="currentColor"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1.4" fill="currentColor"/><rect x="13.5" y="5" width="4" height="14" rx="1.4" fill="currentColor"/></svg>',
    stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="6.5" width="11" height="11" rx="2.5" fill="currentColor"/></svg>',
    volLo: svg('<path d="M4 10v4h3l4 3.5v-11L7 10H4z"/><path d="M15 10a3 3 0 0 1 0 4"/>'),
    volHi: svg('<path d="M4 10v4h3l4 3.5v-11L7 10H4z"/><path d="M15 9.5a3.5 3.5 0 0 1 0 5"/><path d="M17.5 7a7 7 0 0 1 0 10"/>'),
    moon: svg('<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>'),
    dist: svg('<path d="M3 12h18"/><path d="M6 9l-3 3 3 3M18 9l3 3-3 3"/>'),
    lock: svg('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>')
  };
  function loopSec(type) { return type === 'ocean' ? 8 : 4; }
  var MINUTES = [10, 20, 30, 0]; /* 0 = 不限时（显式选择，且带提示） */

  /* ---------------- 音频引擎（状态活在页面里，不产生任何网络请求） ---------------- */
  var engine = { ctx: null, src: null, gain: null, playing: false, pending: null, el: null, url: null, mode: null, starting: false };

  /* 第 271 次（真机：文字已是「播放中」、灵动岛也在放，大按钮还是 ▶；首页迷你条又是另一个样子）：
     播放状态只认一个来源——<audio> 元素真实的 playing / pause / ended 事件（Web Audio 回落路径认 resume 兑现）。
     play() 在 iOS 上是异步 Promise，可能晚到、也可能被拒，所以点下去只记「正在开始」（engine.starting），
     真出声了才落库 playing=true。每次状态真的变了都走 notify()：全屏页大按钮 / 状态文字、白噪音页画卡、
     首页卡片、dock 上方「正在进行」胶囊、锁屏 MediaSession 一起按同一份状态重画。 */
  var notifyQ = 0;
  function notify() {
    if (notifyQ) return;
    notifyQ = 1;
    var run = function () {
      notifyQ = 0;
      try {
        var wn = (Storage.get() || {}).whitenoise || {};
        var ms = global.navigator && global.navigator.mediaSession;
        if (ms) ms.playbackState = wn.playing ? 'playing' : (wn.paused ? 'paused' : 'none');
      } catch (e) {}
      try {
        var App = global.App; if (!App) return;
        var cur = App.currentTab ? App.currentTab() : '';
        if (cur === 'whitenoise' || cur === 'home') App.rerender();
        else if (App.buildTabbar) App.buildTabbar();
      } catch (e) {}
    };
    /* 同一个事件循环里的多次变化（例如 pause() 落库 + 元素 pause 事件）合并成一次重画 */
    if (typeof Promise === 'function') Promise.resolve().then(run); else setTimeout(run, 0);
  }

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
    if (type === 'shush' || type === 'ocean' || type === 'fan' || type === 'heart' || type === 'rain' || type === 'dryer') {
      var TAU = Math.PI * 2, lp = 0, lp2 = 0, br = 0, de = 0, dk = Math.exp(-1 / (0.004 * sr));
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
        } else if (type === 'rain') {
          /* 雨幕（低通噪声）+ 随机雨滴：每秒约 60 滴，每滴是 4 毫秒衰减的高频脆响 */
          lp += 0.25 * (w0 - lp); lp2 += 0.02 * (w0 - lp2);
          if (Math.random() < 60 / sr) de = 0.3 + 0.7 * Math.random();
          de *= dk;
          data[i] = lp * 0.9 + (w0 - lp2) * de * 0.8;
        } else if (type === 'dryer') {
          /* 吹风机：偏亮的气流（轻高通）+ 200/400 Hz 电机嗡声；整数赫兹在 4 秒片段里首尾相接 */
          lp += 0.05 * (w0 - lp); lp2 += 0.35 * (w0 - lp2);
          data[i] = (lp2 - lp) * 1.1 + 0.06 * Math.sin(TAU * 200 * tt) + 0.03 * Math.sin(TAU * 400 * tt);
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
  /* 第 276 次（内存审计：定时 30 分钟整段烘焙 WAV 约 29 MB，生成时 ArrayBuffer + Blob 两份并存峰值约 58 MB）：
     定时模式也改成「32 秒无缝循环段 loop 播放」（由 4 / 8 秒基础片段整数次重复拼成，首尾相接无缝），约 0.5 MB；
     到「结束前 8 秒」由定时器把 src 换成一段 8 秒淡出尾巴（loop 关掉），尾巴播完 = ended → 停止并提示，和原来一样。
     开头 3 秒淡入不再烘焙（loop 段里有淡入会每 32 秒重复一次），和不限时一致直接出声。
     定时器有三重：setTimeout 精确到点、元素 timeupdate（媒体播放时系统照常派发）、原有每秒一次的兜底检查；
     暂停清掉、继续按剩余时间重新挂。锁屏 / MediaSession / 第 271 次的播放状态同步（只认元素真实事件）不变。 */
  var WAV_SR = 8000, SEG_SEC = 32, TAIL_SEC = 8;
  function buildWav(type, volume, minutes, tailSec) {
    var base = fillNoise(new Float32Array(WAV_SR * loopSec(type)), type, WAV_SR);
    /* minutes>0：循环段（SEG_SEC 秒）；tailSec>0：淡出尾巴；都没有：基础片段原样（不限时） */
    var total = tailSec > 0 ? Math.max(1, Math.round(tailSec * WAV_SR)) : (minutes > 0 ? Math.round(SEG_SEC / loopSec(type)) * base.length : base.length);
    var g = gainOf(volume) * 1.6; /* 与 Web Audio 的听感大致对齐（低采样率高频少，略补一点） */
    var buf = new ArrayBuffer(44 + total * 2);
    var v = new DataView(buf);
    function str(o, t) { for (var k = 0; k < t.length; k++) v.setUint8(o + k, t.charCodeAt(k)); }
    str(0, 'RIFF'); v.setUint32(4, 36 + total * 2, true); str(8, 'WAVE');
    str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, WAV_SR, true); v.setUint32(28, WAV_SR * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, total * 2, true);
    var fin = 0, fout = tailSec > 0 ? total : 0;
    var blen = base.length;
    for (var i = 0, o = 44; i < total; i++, o += 2) {
      var env = 1;
      if (i < fin) env = i / fin;
      else if (fout && i > total - fout) env = (total - i) / fout;
      var x = base[i % blen] * g * env;
      if (x > 1) x = 1; else if (x < -1) x = -1;
      v.setInt16(o, Math.round(x * 32767), true);
    }
    engine.wavBytes = buf.byteLength; /* 第 276 次：回归测试看生成了多大 */
    return new Blob([buf], { type: 'audio/wav' });
  }
  function elemSupported() {
    try { return typeof global.Audio === 'function' && typeof Blob === 'function' && !!(global.URL && URL.createObjectURL); }
    catch (e) { return false; }
  }
  /* 第 276 次：定时停止。按 wn.until 挂「结束前 TAIL_SEC 秒换尾巴」；暂停 / 停止时撤掉 */
  function clearStopTimer() { if (engine.stopT) { clearTimeout(engine.stopT); engine.stopT = 0; } }
  function armStop() {
    clearStopTimer();
    if (engine.mode !== 'elem' || !engine.el || engine.tail) return;
    var wn = (Storage.get() || {}).whitenoise;
    if (!wn || !wn.playing || !wn.until) return;
    var ms = wn.until - Date.now() - TAIL_SEC * 1000;
    engine.stopT = setTimeout(function () { engine.stopT = 0; startTail(); }, Math.max(0, ms));
  }
  /* 换成淡出尾巴：同一个 <audio>（已被用户手势解锁过），换 src 后接着 play()。换 src 期间元素会发 pause / emptied，
     engine.tail 标记让 onpause 不把它当成用户暂停。 */
  function startTail() {
    var el = engine.el;
    if (!el || engine.tail || engine.mode !== 'elem') return;
    var wn = (Storage.get() || {}).whitenoise;
    if (!wn || !wn.playing || !wn.until || el.paused) return;
    var left = (wn.until - Date.now()) / 1000;
    if (left > TAIL_SEC + 1) { armStop(); return; } /* 定时器提前醒了（被调过时间），重新挂 */
    var url;
    try { url = URL.createObjectURL(buildWav(wn.type, wn.volume, 0, Math.max(0.5, Math.min(TAIL_SEC, left)))); } catch (e) { return; }
    var old = engine.url;
    engine.tail = true; engine.url = url;
    try {
      el.loop = false;
      el.src = url;
      var p = el.play();
      if (p && p['catch']) p['catch'](function () { if (engine.el === el) { stop(); notify(); } });
    } catch (e) { stop(); notify(); }
    if (old) { try { URL.revokeObjectURL(old); } catch (e2) {} }
  }
  function releaseElem() {
    var el = engine.el, url = engine.url;
    clearStopTimer(); engine.tail = false;
    engine.el = null; engine.url = null;
    if (el) { try { el.onended = null; el.onplaying = null; el.onpause = null; el.pause(); el.removeAttribute('src'); el.load(); } catch (e) {} }
    engine.starting = false;
    if (url) { try { URL.revokeObjectURL(url); } catch (e) {} }
  }
  function mediaSession(on) {
    var ms = global.navigator && global.navigator.mediaSession;
    if (!ms) return;
    try {
      if (on) {
        if (global.MediaMetadata) ms.metadata = new global.MediaMetadata({ title: '哄睡白噪音', artist: '咿呀记' });
        /* 第 209 次：锁屏「暂停」只暂停，「播放」继续，「停止」才停 */
        try { ms.setActionHandler('pause', function () { pause(); notify(); }); } catch (e) {}
        try { ms.setActionHandler('play', function () { resume(); notify(); }); } catch (e) {}
        try { ms.setActionHandler('stop', function () { stop(); notify(); }); } catch (e) {}
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
      engine.tail = false;
      el = new global.Audio();
      el.src = url;
      el.loop = true; /* 第 276 次：定时模式也是循环段，到点由 armStop / startTail 收尾 */
      el.setAttribute('playsinline', '');
    } catch (e) { if (url) try { URL.revokeObjectURL(url); } catch (e2) {} return false; }
    engine.el = el; engine.url = url; engine.playing = true; engine.mode = 'elem'; engine.starting = true;
    el.onplaying = function () {
      if (engine.el !== el) return;
      engine.starting = false;
      /* 第 209 次：只在首次出声时落库——暂停后继续 / 缓冲恢复也会触发 playing，不能把剩余时间重置成满格 */
      if (el._started) {
        /* 第 271 次：继续播放（本页按钮、锁屏、灵动岛、耳机线控）以真正出声为准，这时才把「已暂停」翻成「播放中」 */
        var wr = Storage.get().whitenoise;
        if (wr && wr.paused) markResumed(wr);
        engine.paused = false;
        if (!engine.tail) armStop();
        notify();
        return;
      }
      el._started = true;
      writeState(true, type, volume, prefMin != null ? prefMin : minutes, linkSleep);
      if (minutes > 0) { var w0 = Storage.get().whitenoise; if (w0) { w0.until = Date.now() + minutes * 60000; Storage.save(); } }
      armStop();
      mediaSession(true);
      notify();
    };
    /* 第 271 次：系统替我们暂停（锁屏 / 灵动岛 / 来电 / 拔耳机 / 别的 App 抢了音频）也要反映到界面上：
       不是我们自己调的 pause()，就在这里按「暂停」落库（保留剩余时间），界面一起变成 ▶。 */
    el.onpause = function () {
      if (engine.el !== el || el.ended) return;
      if (engine.tail && !el.paused) return;
      if (engine.tail && el.src && engine.url && el.src !== engine.url) return; /* 换尾巴 src 时的那次 pause */
      clearStopTimer();
      engine.starting = false;
      var wp = Storage.get().whitenoise;
      if (wp && wp.playing) markPaused(wp);
      notify();
    };
    /* 第 276 次：播放中元素自己派发的进度事件也检查一次到点（锁屏时定时器可能被推迟） */
    el.ontimeupdate = function () {
      if (engine.el !== el || engine.tail || el.paused) return;
      var wt = Storage.get().whitenoise;
      if (wt && wt.playing && wt.until && wt.until - Date.now() <= TAIL_SEC * 1000) startTail();
    };
    el.onended = function () {
      if (engine.el !== el) return;
      stop();
      /* 第 278 次（审计顺查）：暂停时改过音量 / 定时会按剩余分钟重建元素，提示要写用户设定的分钟数（prefMin），不是剩下的 */
      if (global.Util && Util.toast) Util.toast('白噪音已按 ' + (prefMin != null ? prefMin : minutes) + ' 分钟定时关闭。', 'ok');
      if (global.App) global.App.rerender();
    };
    var p;
    try { p = el.play(); } catch (e) { releaseElem(); engine.playing = false; return false; }
    if (p && p['catch']) p['catch'](function () {
      if (engine.el !== el) return;
      releaseElem(); engine.playing = false; engine.starting = false;
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
    engine.pending = { type: type, volume: volume, minutes: minutes, linkSleep: linkSleep, prefMin: prefMin };

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
        writeCtxState(type, volume, minutes, linkSleep, prefMin);
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
          writeCtxState(pd.type, pd.volume, pd.minutes, pd.linkSleep, pd.prefMin);
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
  /* 第 278 次（审计顺查）：按剩余分钟重建时（暂停中改音量），minutes 记用户设定的分钟数（prefMin），until 按剩余分钟算——
     和元素播放那条路（startElem）一致，到点提示 / 进度环都按设定分钟数 */
  function writeCtxState(type, volume, minutes, linkSleep, prefMin) {
    writeState(true, type, volume, prefMin != null ? prefMin : minutes, linkSleep);
    if (prefMin != null && minutes > 0) { var w0 = Storage.get().whitenoise; if (w0) { w0.until = Date.now() + minutes * 60000; Storage.save(); } }
  }
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

    /* 第 209 次：真正出声是异步确认的，确认后补刷底栏，让「正在播放」入口立刻出现 */
    notify();

    /* W-05 联动：一次点击同时开始哄睡计时（若当前没有计时在进行） */
    if (playing && linkSleep && !d.openSleep) {
      d.openSleep = { id: Util.uid(), start: Util.nowLocal(), pausedMs: 0, pauseStart: null };
      Storage.save();
    }
  }

  function stopEngine(immediate) {
    if (!engine.playing) return;
    engine.playing = false; engine.paused = false; engine.dirty = false; engine.starting = false;
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
    stopEngine(!!engine.paused);
    var d = Storage.get();
    if (d.whitenoise) {
      d.whitenoise.playing = false;
      d.whitenoise.until = null;
      d.whitenoise.paused = false;
      d.whitenoise.leftMs = null;
    }
    Storage.save();
    notify();
  }

  /** 刷新页面后音频必然已停：清掉「播放中」的残留状态，避免界面撒谎 */
  function resetStaleState() {
    var d = Storage.get();
    if (d.whitenoise && (d.whitenoise.playing || d.whitenoise.paused)) {
      d.whitenoise.playing = false;
      d.whitenoise.until = null;
      d.whitenoise.paused = false;
      d.whitenoise.leftMs = null;
      Storage.save();
    }
  }

  function remainingMin() {
    var wn = (Storage.get() || {}).whitenoise || {};
    if (wn.paused) return wn.leftMs != null ? Math.max(1, Math.ceil(wn.leftMs / 60000)) : null;
    if (!wn.playing || !wn.until) return null;
    return Math.max(0, Math.ceil((wn.until - Date.now()) / 60000));
  }

  /* 第 209 次：暂停 ≠ 停止。
     暂停：声音停下但保留进度与剩余时间（<audio> 走 el.pause()，Web Audio 走 ctx.suspend()），
           锁屏控件还在，定时倒计时冻结；
     继续：原地接着放，剩余时间从暂停那一刻接上。暂停期间改了音量 / 定时（engine.dirty），
           或引擎已经没了（例如被系统回收），就按剩余分钟重新生成一段再放。 */
  function markPaused(wn) {
    wn.leftMs = wn.until ? Math.max(1000, wn.until - Date.now()) : null;
    wn.playing = false; wn.paused = true; wn.until = null;
    Storage.save();
    engine.paused = true;
    try { var ms = global.navigator && global.navigator.mediaSession; if (ms) ms.playbackState = 'paused'; } catch (e) {}
  }
  function pause() {
    var wn = (Storage.get() || {}).whitenoise;
    /* 第 271 次：还在「正在开始」（play() 没兑现）时点暂停 = 取消这次播放 */
    if (engine.starting && engine.playing && !(wn && wn.paused)) { stop(); return true; }
    if (!wn || !wn.playing) return false;
    markPaused(wn);
    engine.starting = false;
    clearStopTimer();
    try {
      if (engine.mode === 'elem' && engine.el) engine.el.pause();
      else if (engine.ctx && engine.ctx.suspend) engine.ctx.suspend();
    } catch (e) {}
    notify();
    return true;
  }
  function markResumed(wn) {
    wn.playing = true; wn.paused = false;
    wn.until = wn.leftMs != null ? Date.now() + wn.leftMs : null;
    wn.leftMs = null;
    engine.paused = false;
    Storage.save();
    try { var ms = global.navigator && global.navigator.mediaSession; if (ms) ms.playbackState = 'playing'; } catch (e) {}
  }
  function resume() {
    var wn = (Storage.get() || {}).whitenoise;
    if (!wn || !wn.paused) return false;
    var left = wn.leftMs != null ? Math.max(1, Math.ceil(wn.leftMs / 60000)) : 0;
    if (engine.playing && engine.paused && !engine.dirty) {
      if (engine.mode === 'elem' && engine.el) {
        /* 第 271 次：不再「先当成在放」——等元素的 playing 事件再翻状态（见 startElem 的 onplaying）。
           被拒就保持暂停并提示，界面始终和真实声音一致。 */
        var el = engine.el, p;
        engine.starting = true;
        try { p = el.play(); } catch (e) { p = null; engine.starting = false; }
        if (p && p['catch']) p['catch'](function () {
          if (engine.el !== el) return;
          engine.starting = false;
          if (global.Util && Util.toast) Util.toast('没能继续播放，请再点一次播放键。', 'warn');
          notify();
        });
        notify();
        return true;
      }
      if (engine.mode === 'ctx' && engine.ctx) {
        var c0 = engine.ctx, rp;
        engine.starting = true;
        try { rp = c0.resume(); } catch (e) { rp = null; }
        var done = function () { engine.starting = false; if (c0.state === 'running') { var w2 = Storage.get().whitenoise; if (w2 && w2.paused) markResumed(w2); } notify(); };
        if (rp && rp.then) rp.then(done, done); else done();
        return true;
      }
    }
    var mins = wn.minutes;
    stopEngine(true);
    var ok = start(wn.type, wn.volume, left, wn.linkSleep, mins);
    if (!ok) Util.toast('这个环境无法播放声音，请在浏览器中打开本页。', 'error');
    return ok;
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

  /* ============================================================
     第 206 次（按用户给的参考图重做）：插画式声音库 + 全屏沉浸播放页。
     · 页面：每种声音一幅暖光插画，拱形画卡 3 列；播放中底部出现迷你播放条。
     · 点画卡 = 选中并开始播放（默认音量 3、20 分钟定时不变），同时打开全屏播放页。
     · 播放页挂在 body 上（避免 #view 的变换让 fixed 失效），随页面重绘同步、离开本页即移除。
     · 安全三件事 + 依据折叠保留在声音库下面，内容与此前一致。
     ============================================================ */
  var ART = function (v) { return 'assets/sounds/' + v + '.webp'; };
  var NAMES = { pink: '粉红噪音', white: '白噪音', brown: '棕色噪音', shush: '嘘声', ocean: '海浪声', heart: '心跳声', fan: '风扇声', rain: '雨声', dryer: '吹风机' };
  function nameOf(v) { return NAMES[v] || typeName(v); }
  function minLabel(m) { return m > 0 ? m + ' 分钟' : '不限时'; }

  /* 第 271 次：界面上的播放状态只从这里取（四态：idle / starting / playing / paused） */
  function uiState(wn) {
    if (engine.starting && engine.playing) return 'starting';
    if (wn.playing) return 'playing';
    if (wn.paused) return 'paused';
    return 'idle';
  }
  function playerState(wn) {
    if (uiState(wn) === 'starting') return wn.paused ? '正在继续播放…' : '正在开始播放…';
    if (wn.paused) { var rp = remainingMin(); return rp != null ? '已暂停 · 还剩约 ' + rp + ' 分钟' : '已暂停 · 不限时'; }
    if (!wn.playing) return '轻点播放 · ' + (wn.minutes > 0 ? wn.minutes + ' 分钟后自动关闭' : '不限时');
    var r = remainingMin();
    return r != null ? '播放中 · 还剩约 ' + r + ' 分钟' : '播放中 · 不限时';
  }
  function progressPct(wn) {
    if (wn.paused) return (wn.leftMs != null && wn.minutes > 0) ? Math.max(0, Math.min(100, 100 - wn.leftMs / (wn.minutes * 600))) : 100;
    if (!wn.playing || !wn.until || !(wn.minutes > 0)) return wn.playing ? 100 : 0;
    return Math.max(0, Math.min(100, 100 - (wn.until - Date.now()) / (wn.minutes * 600)));
  }

  function playerHTML(wn) {
    var info = typeInfo(wn.type) || TYPES[0];
    var d = Storage.get();
    var sleeping = !!d.openSleep;
    return '<div class="wp-bg" style="background-image:url(' + ART(info.v) + ')"></div><div class="wp-shade"></div>'
      + '<button type="button" class="wp-round wp-close" id="wpClose" aria-label="收起">' + svg('<path d="M6 9l6 6 6-6"/>') + '</button>'
      + '<div class="wp-body">'
      + '<button type="button" class="wp-pill" id="wpSleep">' + ICON.moon + (sleeping ? '睡眠计时中<span class="wp-dot"></span>' : '同时开始睡眠计时') + '</button>'
      + '<p class="wp-kicker">' + info.tag + ' · 本机生成</p>'
      + '<h2 class="wp-title">' + nameOf(info.v) + '</h2>'
      + '<p class="wp-desc">' + info.desc + '</p>'
      + '<div class="wp-track"><i id="wpBar" style="width:' + progressPct(wn).toFixed(1) + '%"></i></div>'
      + '<p class="wp-state" id="wpState">' + playerState(wn) + '</p>'
      + '<div class="wp-vol">' + ICON.volLo + '<input type="range" id="wpVol" min="1" max="10" step="1" value="' + wn.volume + '" aria-label="音量" style="--p:' + ((wn.volume - 1) / 9 * 100).toFixed(1) + '%">' + ICON.volHi + '</div>'
      + '<div class="wp-ctrl">'
      + '<button type="button" class="wp-round wp-side" id="wpTimer" aria-label="定时：' + minLabel(wn.minutes) + '">'
      + svg('<circle cx="12" cy="13" r="7.5"/><path d="M12 9v4l2.5 2"/><path d="M9.5 3h5"/>') + '<span>' + (wn.minutes > 0 ? wn.minutes + '分' : '不限') + '</span></button>'
      + toggleHTML(wn)
      + '<button type="button" class="wp-round wp-side" id="wpStop" aria-label="停止"' + (uiState(wn) === 'idle' ? ' disabled' : '') + '>' + ICON.stop + '<span>停止</span></button>'
      + '</div>'
      + (wn.minutes === 0 ? '<p class="wp-warn">不限时：请把音量压到最低，设备不要放进婴儿床。</p>' : '<p class="wp-tip">放在宝宝头部的位置听，应该很轻、不刺耳</p>')
      + '</div>';
  }

  function toggleHTML(wn) {
    var u = uiState(wn), on = u === 'playing' || u === 'starting';
    return '<button type="button" class="wp-play' + (u === 'starting' ? ' is-starting' : '') + '" id="wpToggle" data-state="' + u + '"'
      + ' aria-label="' + (u === 'starting' ? '正在开始，点按取消' : u === 'playing' ? '暂停' : u === 'paused' ? '继续播放' : '开始播放') + '"'
      + (u === 'starting' ? ' aria-busy="true"' : '') + '>' + (on ? ICON.pause : ICON.play) + '</button>';
  }

  function closePlayer() {
    Modules.whitenoise._open = false;
    var el = document.getElementById('wnPlayer');
    if (!el) return;
    el.classList.remove('open');
    document.documentElement.classList.remove('wp-lock');
    if (global.queueStatusColor) global.queueStatusColor();
    setTimeout(function () { if (el.parentNode && !Modules.whitenoise._open) el.parentNode.removeChild(el); }, 320);
  }

  function syncPlayer() {
    var el = document.getElementById('wnPlayer');
    if (!Modules.whitenoise._open) { if (el) closePlayer(); return; }
    var fresh = !el;
    if (fresh) {
      el = document.createElement('div');
      el.id = 'wnPlayer'; el.className = 'wn-player';
      el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', '声音播放');
      document.body.appendChild(el);
    }
    var wn = Storage.get().whitenoise;
    el.innerHTML = playerHTML(wn);
    var u = uiState(wn);
    el.classList.toggle('is-playing', u === 'playing');
    el.classList.toggle('is-paused', u === 'paused');
    el.classList.toggle('is-starting', u === 'starting');
    el.setAttribute('data-state', u);
    document.documentElement.classList.add('wp-lock');
    if (fresh) { void el.offsetWidth; el.classList.add('open'); }
    else el.classList.add('open');
    if (global.queueStatusColor) global.queueStatusColor();
    bindPlayer(el);
  }

  /* 第 209 次：播放键 = 播放 / 暂停 / 继续；停止另有按钮 */
  function playPause() {
    var cur = Storage.get().whitenoise;
    /* 第 271 次：「正在开始 / 正在继续」时再点 = 取消 */
    if (engine.starting && engine.playing) {
      if (cur.paused) { engine.starting = false; try { if (engine.el) engine.el.pause(); } catch (e) {} notify(); return true; }
      stop(); return true;
    }
    if (cur.playing) return pause();
    if (cur.paused) return resume();
    var ok = start(cur.type, cur.volume, cur.minutes, cur.linkSleep);
    if (!ok) Util.toast('这个环境无法播放声音，请在浏览器中打开本页。', 'error');
    return ok;
  }
  /* 点画卡只是「选这首」：没在放就只选中、等播放键；正在放就无缝换成这首；暂停中换首则停掉旧的 */
  function selectType(type) {
    var cur = Storage.get().whitenoise;
    if (cur.type === type) return true;
    if (cur.paused) stop();
    cur = Storage.get().whitenoise;
    cur.type = type; Storage.save();
    if (!cur.playing) return true;
    if (engine.mode === 'elem') { restartRemaining(cur); return true; }
    var ok = start(type, cur.volume, cur.minutes, cur.linkSleep);
    if (!ok) Util.toast('这个环境无法播放声音，请在浏览器中打开本页。', 'error');
    return ok;
  }

  function bindPlayer(el) {
    function on(id, fn) { var b = el.querySelector('#' + id); if (b) b.addEventListener('click', fn); }
    on('wpClose', function () { closePlayer(); global.App.rerender(); });
    on('wpToggle', function () { playPause(); global.App.rerender(); });
    on('wpStop', function () { var w = Storage.get().whitenoise; if (w.playing || w.paused) { stop(); Util.toast('白噪音已停止', 'ok'); } global.App.rerender(); });
    on('wpTimer', function () {
      var cur = Storage.get().whitenoise;
      var m = MINUTES[(MINUTES.indexOf(cur.minutes) + 1) % MINUTES.length];
      cur.minutes = m;
      cur.until = cur.playing ? (m > 0 ? Date.now() + m * 60000 : null) : null;
      if (cur.paused) { cur.leftMs = m > 0 ? m * 60000 : null; engine.dirty = true; }
      Storage.save();
      if (cur.playing && engine.playing && engine.mode === 'elem') start(cur.type, cur.volume, m, cur.linkSleep);
      Util.toast(m > 0 ? '定时 ' + m + ' 分钟后关闭' : '已设为不限时：请把音量压到最低', m > 0 ? 'ok' : 'warn');
      global.App.rerender();
    });
    on('wpSleep', function () {
      var d = Storage.get();
      if (d.openSleep) { closePlayer(); global.App.showTab('sleep'); return; }
      d.whitenoise.linkSleep = true;
      if (d.whitenoise.playing) d.openSleep = { id: Util.uid(), start: Util.nowLocal(), pausedMs: 0, pauseStart: null };
      Storage.save();
      Util.toast(d.whitenoise.playing ? '已开始睡眠计时' : '开始播放时会同时开始睡眠计时', 'ok');
      global.App.rerender();
    });
    var vol = el.querySelector('#wpVol');
    if (vol) {
      vol.addEventListener('input', function () {
        var v = parseInt(vol.value, 10);
        vol.style.setProperty('--p', ((v - 1) / 9 * 100).toFixed(1) + '%');
        var cur = Storage.get().whitenoise; cur.volume = v; Storage.save();
        if (cur.paused) engine.dirty = true;
        if (cur.playing && engine.playing && engine.mode !== 'elem') fadeTo(gainOf(v), 0.3);
      });
      vol.addEventListener('change', function () {
        var cur = Storage.get().whitenoise;
        if (cur.playing && engine.playing && engine.mode === 'elem') restartRemaining(cur);
      });
    }
    el.onkeydown = function (e) { if (e.key === 'Escape') { closePlayer(); global.App.rerender(); } };
  }

  Modules.whitenoise = {
    id: 'whitenoise',
    title: '哄睡白噪音',
    /* 第 271 次：离开本页（dock 返回 / 搜索 / 侧滑）时立刻收起播放页，不等每秒的 tick */
    leave: function () { if (Modules.whitenoise._open || document.getElementById('wnPlayer')) closePlayer(); },
    render: function (view) {
      var d = Storage.get();
      var wn = d.whitenoise;
      var supported = audioSupported();
      var html = '';

      if (!supported) {
        html += '<div class="card"><h2>哄睡声音</h2><p class="hint">当前环境不支持音频播放（例如部分内嵌浏览器未开启声音权限）。'
          + '用手机 / 电脑的浏览器直接打开本页即可使用；不支持的设备上其余功能不受影响，也不影响你的记录。</p></div>';
      }

      /* 声音库：拱形画卡 */
      html += '<section class="wn-lib" aria-label="声音">'
        + '<div class="wn-lib-head"><h2>安抚声音</h2><span>' + ICON.lock + '本机生成 · 不联网</span></div>'
        + '<div class="wn-arts">';
      TYPES.forEach(function (t) {
        var isOn = wn.type === t.v, isPlay = isOn && wn.playing;
        html += '<button type="button" class="wn-art' + (isOn ? ' on' : '') + (isPlay ? ' playing' : '') + '" data-type="' + t.v + '" aria-pressed="' + isOn + '">'
          + '<span class="wn-art-img" style="background-image:url(' + ART(t.v) + ')">'
          + (isPlay ? '<span class="wn-eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span>' : '')
          + '</span>'
          + '<span class="wn-art-name">' + nameOf(t.v) + '</span>'
          + '<span class="wn-art-tag">' + t.tag + '</span></button>';
      });
      html += '</div></section>';

      /* 安全三件事：一眼看到的版本；依据与细节收进折叠（内容与改版前一致） */
      html += '<div class="card wn-card"><div class="wn-head"><h2>用之前记住三件事</h2></div>'
        + '<div class="wn-rules">'
        + '<div class="wn-rule">' + ICON.dist + '<b>离远一点</b><span>不进婴儿床<br>不对着耳朵</span></div>'
        + '<div class="wn-rule">' + ICON.volLo + '<b>音量要轻</b><span>大人说话<br>不用提高嗓门</span></div>'
        + '<div class="wn-rule">' + ICON.moon + '<b>睡着就关</b><span>只当入睡辅助<br>别整夜播</span></div>'
        + '</div>'
        + '<p class="wn-safe">1 岁以下每次睡觉都要仰睡、床内净空、同室不同床。白噪音不替代安全睡眠。</p>'
        + '<details class="wn-more"><summary>为什么这样建议</summary><ul class="kv">'
        + '<li><b>离远一点</b>：美国儿科学会（AAP）的表述是「放得越远越好、音量越低越好、限制使用时长」，并曾建议离孩子 7 英尺（约 2.1 米）以上。</li>'
        + '<li><b>音量别追高</b>：有研究测过 24 款婴儿睡眠音机与 6 个手机 App，在最大音量下全部超过 NIOSH 给成年工人的 8 小时职业暴露限值（85 dBA）；'
        + '该研究作者建议把上限控制在 60 dB（属专家建议，不是监管标准）。</li>'
        + '<li><b>早产，或有听力 / 神经发育情况的宝宝</b>：先问儿科或耳鼻喉科医生，不要照网页自行设定。</li>'
        + '<li><b>不替代安全睡眠</b>：床内不用枕头、松软被褥、防撞垫、填充玩具。安全永远排在「睡得久」之前。</li>'
        + '<li><b>「不限时」</b>：通常是家里环境噪音大时才需要，那就更要把音量压到最低。</li>'
        + '<li><b>哪种声音都行</b>：没有证据说明某一种对婴儿更好，看宝宝是否更放松；都不喜欢就别硬放，稳定的生活声（风扇、空调）往往就够了。</li>'
        + '</ul></details>'
        + '<details class="wn-more"><summary>想少用一点的时候</summary>'
        + '<p class="hint">白噪音更像一个「该睡觉了」的情境线索（和关灯、换睡衣一样），不是药物依赖，也没有「几岁必须戒」的说法。可以这样慢慢退：</p>'
        + '<ul class="kv"><li>1. 每隔几天把音量调低一点，看宝宝是否照睡。</li>'
        + '<li>2. 缩短播放时间：先只用在入睡前，再配合定时关闭。</li>'
        + '<li>3. 增加别的睡前线索：洗澡、换睡衣、拉窗帘、调暗灯、固定绘本或道晚安。</li>'
        + '<li>4. 先挑环境安静的白天小睡试不播，适应后再动夜间。</li></ul>'
        + '<p class="hint">如果宝宝长时间极难入睡、睡觉时出现呼吸异常，或你对听力、发育有疑虑，请找儿科医生评估，而不是继续把音量调大。</p></details>';
      if (supported && isIOS()) {
        html += '<details class="wn-more"><summary>iPhone 没声音？</summary><p class="hint">'
          + '① 侧边静音拨片不在静音位（拨片朝上）；② 媒体音量没调到 0。锁屏后会继续播放，到时间自动停；也可以在锁屏的播放控件上点暂停。'
          + '外放没声音时，改用耳机或开免提再试。</p></details>';
      }
      html += '</div>';

      view.innerHTML = html;

      /* ---- 交互 ---- */
      Array.prototype.forEach.call(view.querySelectorAll('.wn-art'), function (b) {
        b.addEventListener('click', function () {
          var t = b.getAttribute('data-type');
          selectType(t);
          Modules.whitenoise._open = true;
          global.App.rerender();
        });
      });
      syncPlayer();

      /* 每秒刷新剩余时间；离开本页时收起播放页并自停 */
      if (Modules.whitenoise._tick) clearInterval(Modules.whitenoise._tick);
      var anchor = view.querySelector('.wn-lib');
      Modules.whitenoise._tick = setInterval(function () {
        if (!anchor || !document.body.contains(anchor)) {
          clearInterval(Modules.whitenoise._tick);
          if (Modules.whitenoise._open) closePlayer();
          return;
        }
        var w = Storage.get().whitenoise;
        var bar = document.getElementById('wpBar'); if (bar) bar.style.width = progressPct(w).toFixed(1) + '%';
        var st = document.getElementById('wpState'); if (st) st.textContent = playerState(w);
        /* 第 271 次兜底：万一漏了某个事件，大按钮和状态对不上就整页按真实状态重画一次 */
        var tg = document.getElementById('wpToggle');
        if (tg && tg.getAttribute('data-state') !== uiState(w)) global.App.rerender();
      }, 1000);
    }
  };

  /* 第 208 次：底栏「正在播放」——播放中才出现；点它进白噪音页并展开播放页，点暂停直接停 */
  function dockMin(wn) { var r = remainingMin(); return r != null ? r + ' 分钟' : '不限时'; }
  Modules.whitenoise._dockNode = function () {
    var wn = (Storage.get() || {}).whitenoise;
    if (!wn || !(wn.playing || wn.paused)) return null;
    var el = document.createElement('div');
    el.className = 'dock-now' + (wn.paused ? ' is-paused' : ''); el.id = 'dockNow';
    var C = 2 * Math.PI * 17;
    var frac = wn.paused ? (wn.leftMs != null && wn.minutes > 0 ? Math.max(0, Math.min(1, wn.leftMs / (wn.minutes * 60000))) : 1) : (wn.until && wn.minutes > 0) ? Math.max(0, Math.min(1, (wn.until - Date.now()) / (wn.minutes * 60000))) : 1;
    el.innerHTML = '<button type="button" class="dn-open" aria-label="正在播放：' + nameOf(wn.type) + '，' + dockMin(wn) + '。打开播放页">'
      + '<span class="dn-art" style="background-image:url(' + ART(wn.type) + ')">'
      + '<svg class="dn-ring" viewBox="0 0 38 38" aria-hidden="true"><circle cx="19" cy="19" r="17"></circle>'
      + '<circle class="dn-fg" cx="19" cy="19" r="17" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + (C * (1 - frac)).toFixed(1) + '"></circle></svg>'
      + '<span class="dn-eq" aria-hidden="true"><i></i><i></i><i></i></span></span>'
      + '<span class="dn-txt"><b>' + nameOf(wn.type) + '</b><span class="dn-t">' + (wn.paused ? '已暂停 · ' : '') + dockMin(wn) + '</span></span></button>'
      + '<button type="button" class="dn-pp" aria-label="' + (wn.paused ? '继续播放' : '暂停') + '">' + (wn.paused ? ICON.play : ICON.pause) + '</button>'
      + '<button type="button" class="dn-stop" aria-label="停止">' + svg('<path d="M7 7l10 10M17 7L7 17"/>') + '</button>';
    el.querySelector('.dn-open').addEventListener('click', function () {
      Modules.whitenoise._open = true;
      if (global.App.currentTab() === 'whitenoise') global.App.rerender(); else global.App.showTab('whitenoise');
    });
    el.querySelector('.dn-pp').addEventListener('click', function () { playPause(); global.App.rerender(); });
    el.querySelector('.dn-stop').addEventListener('click', function () {
      stop(); Util.toast('白噪音已停止', 'ok'); global.App.rerender();
    });
    return el;
  };
  setInterval(function () {
    var el = document.getElementById('dockNow');
    if (!el) return;
    var wn = (Storage.get() || {}).whitenoise;
    if (!wn || !wn.playing) return; /* 暂停中不走表 */
    var t = el.querySelector('.dn-t'); if (t) t.textContent = dockMin(wn);
    var fg = el.querySelector('.dn-fg');
    if (fg && wn.until && wn.minutes > 0) {
      var C = parseFloat(fg.getAttribute('stroke-dasharray'));
      fg.setAttribute('stroke-dashoffset', (C * (1 - Math.max(0, Math.min(1, (wn.until - Date.now()) / (wn.minutes * 60000))))).toFixed(1));
    }
  }, 5000);

  /* 供首页 / 提醒卡复用：不打开页面也能知道还剩多久 */
  Modules.whitenoise._remainingMin = remainingMin;
  Modules.whitenoise._art = ART;
  Modules.whitenoise._uiState = function () { return uiState((Storage.get() || {}).whitenoise || {}); };
  Modules.whitenoise._closePlayer = closePlayer;
  Modules.whitenoise._notify = notify;
  Modules.whitenoise._typeName = typeName;
  Modules.whitenoise._audioSupported = audioSupported;
  Modules.whitenoise.resetStaleState = resetStaleState;
  Modules.whitenoise._stop = stop;
  Modules.whitenoise._pause = pause;
  Modules.whitenoise._resume = resume;
  /* 第 116 次：测试入口。让 qa 能真正驱动「resume → 建节点 → start → 写库」
     这条路径并观察 AudioContext 状态，而不是只能对源码做正则断言——
     本批的核心修复（等 resume）恰恰是运行时行为，静态断言验证不了它。
     前缀下划线与既有 _stop / _audioSupported 一致，属内部接口，不进 UI。 */
  Modules.whitenoise._startForTest = start;
  /* 第 276 次：回归测试看引擎状态（定时器 / 尾巴 / 循环段）；_tail 直接触发换尾巴 */
  Modules.whitenoise._eng = function () { return { mode: engine.mode, tail: !!engine.tail, stopT: !!engine.stopT, loop: engine.el ? engine.el.loop : null, bytes: engine.wavBytes || 0 }; };
  Modules.whitenoise._tail = function () { startTail(); };
  Modules.whitenoise._fill = function (type, sr) { return fillNoise(new Float32Array((sr || WAV_SR) * loopSec(type)), type, sr || WAV_SR); };
  Modules.whitenoise._wav = buildWav;
  Modules.whitenoise._ctxState = function () { return engine.ctx ? engine.ctx.state : null; };
  Modules.whitenoise._engine = engine;

  /* 页面被隐藏 / 关闭时清掉「播放中」标记：音频会随页面结束，状态不该留成谎言 */
  global.addEventListener('pagehide', function () { resetStaleState(); });
})(window);

