/* ============================================================
   第 212 次：首页真实天气（可选联网）
   · 默认关闭；设置 · 天气 里打开才会联网。只发经纬度去取天气，不带任何记录数据。
   · 数据源：Open-Meteo（天气 / 空气质量 / 城市搜索，免 key）；
     自动定位时用 BigDataCloud 免 key 接口把经纬度换成城市名。
   · 结果缓存在独立的 localStorage 键（yiya-weather），30 分钟内不重复请求，
     不进主数据、不进导出。
   · 首页天空按天气加一层：阴天压暗、雨雪粒子、雾。
   ============================================================ */
(function (global) {
  'use strict';
  var KEY = 'yiya-weather';
  var TTL = 30 * 60 * 1000;
  var pending = null;

  /* WMO 天气码 → 文案 + 图标类型 */
  function codeInfo(c) {
    if (c === 0) return { t: '晴', k: 'clear' };
    if (c === 1) return { t: '晴间多云', k: 'partly' };
    if (c === 2) return { t: '多云', k: 'partly' };
    if (c === 3) return { t: '阴', k: 'cloudy' };
    if (c === 45 || c === 48) return { t: '雾', k: 'fog' };
    if (c >= 51 && c <= 57) return { t: '毛毛雨', k: 'rain' };
    if (c === 61 || c === 80) return { t: '小雨', k: 'rain' };
    if (c === 63 || c === 81) return { t: '中雨', k: 'rain' };
    if (c === 65 || c === 82 || c === 66 || c === 67) return { t: '大雨', k: 'rain' };
    if (c === 71 || c === 85 || c === 77) return { t: '小雪', k: 'snow' };
    if (c === 73) return { t: '中雪', k: 'snow' };
    if (c === 75 || c === 86) return { t: '大雪', k: 'snow' };
    if (c >= 95) return { t: '雷阵雨', k: 'thunder' };
    return { t: '多云', k: 'partly' };
  }
  function aqiText(v) {
    if (v == null) return '';
    if (v <= 50) return '空气优';
    if (v <= 100) return '空气良';
    if (v <= 150) return '轻度污染';
    if (v <= 200) return '中度污染';
    return '重度污染';
  }
  /* 带娃出门的一句提示：按「最该注意的那件事」只给一句 */
  function tipOf(w) {
    var k = codeInfo(w.code).k;
    if (k === 'thunder') return '有雷雨，今天尽量待在室内';
    if (k === 'rain') return '有雨，出门记得带推车防雨罩';
    if (k === 'snow') return '下雪路滑，注意保暖';
    if (w.aqi != null && w.aqi > 150) return '空气较差，少带宝宝出门';
    if (w.uv != null && w.uv >= 8) return '紫外线很强，避开中午出门';
    if (w.max != null && w.max >= 33) return '天热，注意补水防捂热';
    if (w.min != null && w.min <= 5) return '早晚冷，出门多加一层';
    if (w.max != null && w.min != null && w.max - w.min >= 10) return '早晚温差大，带件外套';
    if (w.uv != null && w.uv >= 5) return '紫外线偏强，出门戴帽子';
    if (k === 'clear' || k === 'partly') return '天气不错，适合带宝宝出门晒晒太阳';
    return '';
  }

  function readCache() {
    try { var c = JSON.parse(localStorage.getItem(KEY) || 'null'); return (c && c.data) ? c : null; } catch (e) { return null; }
  }
  function writeCache(c) { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) {} }
  function clearCache() { try { localStorage.removeItem(KEY); } catch (e) {} }

  function getJSON(url) {
    return fetch(url, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' }).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    });
  }
  function round2(x) { return Math.round(x * 100) / 100; }

  function locate(cfg) {
    if (cfg.mode === 'city' && cfg.city && typeof cfg.city.lat === 'number') {
      return Promise.resolve({ lat: cfg.city.lat, lon: cfg.city.lon, name: cfg.city.name });
    }
    return new Promise(function (res, rej) {
      if (!navigator.geolocation) { rej(new Error('nogeo')); return; }
      navigator.geolocation.getCurrentPosition(function (p) {
        res({ lat: round2(p.coords.latitude), lon: round2(p.coords.longitude), name: null });
      }, function (e) { rej(new Error(e && e.code === 1 ? 'denied' : 'geofail')); },
      { timeout: 10000, maximumAge: 30 * 60 * 1000 });
    });
  }
  function cityName(loc, prev) {
    if (loc.name) return Promise.resolve(loc.name);
    if (prev && prev.lat === loc.lat && prev.lon === loc.lon && prev.name) return Promise.resolve(prev.name);
    return getJSON('https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=' + loc.lat + '&longitude=' + loc.lon + '&localityLanguage=zh')
      .then(function (j) { return j.city || j.locality || j.principalSubdivision || ''; })
      .catch(function () { return ''; });
  }

  /* 取天气：cfg = settings.weather；cb(err, w)。缓存新鲜时同步回调缓存。 */
  function load(cfg, force) {
    if (!cfg || !cfg.on) return Promise.reject(new Error('off'));
    var c = readCache();
    var sameSrc = c && c.mode === (cfg.mode || 'auto') && (cfg.mode !== 'city' || (cfg.city && c.lat === cfg.city.lat && c.lon === cfg.city.lon));
    if (!force && c && sameSrc && Date.now() - c.at < TTL) return Promise.resolve(c.data);
    if (pending) return pending;
    pending = locate(cfg).then(function (loc) {
      var q = 'latitude=' + loc.lat + '&longitude=' + loc.lon;
      var wx = getJSON('https://api.open-meteo.com/v1/forecast?' + q
        + '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day,wind_speed_10m'
        + '&daily=weather_code,temperature_2m_max,temperature_2m_min,uv_index_max,precipitation_probability_max&timezone=auto&forecast_days=1');
      var aq = getJSON('https://air-quality-api.open-meteo.com/v1/air-quality?' + q + '&current=us_aqi').catch(function () { return null; });
      return Promise.all([wx, aq, cityName(loc, c)]).then(function (r) {
        var j = r[0], a = r[1], cur = j.current || {}, dy = j.daily || {};
        var data = {
          temp: Math.round(cur.temperature_2m),
          feels: cur.apparent_temperature != null ? Math.round(cur.apparent_temperature) : null,
          hum: cur.relative_humidity_2m != null ? Math.round(cur.relative_humidity_2m) : null,
          code: cur.weather_code,
          day: cur.is_day !== 0,
          max: dy.temperature_2m_max ? Math.round(dy.temperature_2m_max[0]) : null,
          min: dy.temperature_2m_min ? Math.round(dy.temperature_2m_min[0]) : null,
          uv: dy.uv_index_max ? Math.round(dy.uv_index_max[0]) : null,
          rainP: dy.precipitation_probability_max ? dy.precipitation_probability_max[0] : null,
          aqi: (a && a.current && a.current.us_aqi != null) ? Math.round(a.current.us_aqi) : null,
          city: r[2] || '',
          at: Date.now()
        };
        if (typeof data.temp !== 'number' || isNaN(data.temp)) throw new Error('bad');
        writeCache({ at: Date.now(), mode: cfg.mode || 'auto', lat: loc.lat, lon: loc.lon, name: data.city, data: data });
        return data;
      });
    });
    var p = pending;
    p.then(function () { pending = null; }, function () { pending = null; });
    return p;
  }

  /* 城市搜索（手动城市用） */
  function searchCity(name) {
    return getJSON('https://geocoding-api.open-meteo.com/v1/search?count=6&language=zh&name=' + encodeURIComponent(name))
      .then(function (j) {
        return (j.results || []).map(function (r) {
          return {
            name: r.name, lat: round2(r.latitude), lon: round2(r.longitude),
            area: [r.admin1, r.country].filter(Boolean).filter(function (x, i, arr) { return arr.indexOf(x) === i && x !== r.name; }).join(' · ')
          };
        });
      });
  }

  /* ---------- 图标：手绘风渐变 SVG ---------- */
  var SUN = '<circle cx="32" cy="30" r="12" fill="url(#wxSun)"/>';
  var SUN_RAYS = '<g stroke="#FFC24A" stroke-width="3" stroke-linecap="round" opacity=".85">'
    + '<path d="M32 9v5M32 46v5M11 30h5M48 30h5M17 15l3.5 3.5M43.5 41.5L47 45M17 45l3.5-3.5M43.5 18.5L47 15"/></g>';
  var MOON = '<path d="M38 14a16 16 0 1 0 12 26A13 13 0 0 1 38 14z" fill="url(#wxMoon)"/>';
  function cloud(x, y, s, fill) {
    return '<g transform="translate(' + x + ' ' + y + ') scale(' + s + ')"><path d="M14 34h30a10 10 0 0 0 0-20 14 14 0 0 0-26-3A11 11 0 0 0 14 34z" fill="' + fill + '"/></g>';
  }
  var DEFS = '<defs>'
    + '<radialGradient id="wxSun" cx=".4" cy=".35" r=".7"><stop offset="0" stop-color="#FFE48A"/><stop offset="1" stop-color="#FFA928"/></radialGradient>'
    + '<linearGradient id="wxMoon" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFF6D6"/><stop offset="1" stop-color="#F3D27A"/></linearGradient>'
    + '<linearGradient id="wxCloud" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#DCE4F0"/></linearGradient>'
    + '<linearGradient id="wxCloudD" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#C9D2E0"/><stop offset="1" stop-color="#8E9AB0"/></linearGradient>'
    + '</defs>';
  function icon(code, day) {
    var k = codeInfo(code).k, body = '';
    var orb = day ? (SUN_RAYS + SUN) : MOON;
    if (k === 'clear') body = orb;
    else if (k === 'partly') body = '<g transform="translate(-6 -6) scale(.85)">' + orb + '</g>' + cloud(6, 14, 1, 'url(#wxCloud)');
    else if (k === 'cloudy') body = cloud(-2, 4, .8, 'url(#wxCloudD)') + cloud(6, 14, 1, 'url(#wxCloud)');
    else if (k === 'fog') body = cloud(4, 6, 1, 'url(#wxCloud)') + '<g stroke="#B9C3D3" stroke-width="3" stroke-linecap="round"><path d="M12 48h36M18 55h28"/></g>';
    else if (k === 'rain') body = cloud(4, 4, 1, 'url(#wxCloudD)') + '<g stroke="#5AA6F0" stroke-width="3" stroke-linecap="round"><path d="M22 44l-3 8M33 44l-3 8M44 44l-3 8"/></g>';
    else if (k === 'snow') body = cloud(4, 4, 1, 'url(#wxCloud)') + '<g fill="#A9D4FF"><circle cx="21" cy="48" r="2.6"/><circle cx="32" cy="53" r="2.6"/><circle cx="43" cy="48" r="2.6"/></g>';
    else if (k === 'thunder') body = cloud(4, 4, 1, 'url(#wxCloudD)') + '<path d="M33 40l-7 11h6l-3 9 10-13h-6l4-7z" fill="#FFC24A"/>';
    return '<svg class="wx-svg" viewBox="0 0 64 64" aria-hidden="true">' + DEFS + body + '</svg>';
  }

  /* ---------- 天空上的天气层：雨 / 雪粒子（canvas，离开首页自动停） ---------- */
  function mountFx(canvas, kind) {
    if (!canvas || !canvas.getContext) return;
    if (canvas.__wxStop) canvas.__wxStop();
    if (kind !== 'rain' && kind !== 'snow' && kind !== 'thunder') return;
    try { if (global.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return; } catch (e) {}
    var ctx = canvas.getContext('2d');
    var dpr = Math.min(global.devicePixelRatio || 1, 2);
    var W = 0, H = 0, parts = [], raf = 0, alive = true;
    var snow = kind === 'snow';
    function size() {
      W = canvas.clientWidth; H = canvas.clientHeight;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    size();
    var N = snow ? 46 : 70;
    for (var i = 0; i < N; i++) parts.push({ x: Math.random() * W, y: Math.random() * H, v: snow ? (0.4 + Math.random() * 0.7) : (6 + Math.random() * 5), r: snow ? (1.2 + Math.random() * 2.2) : (10 + Math.random() * 10), s: Math.random() * 6.28 });
    function tick() {
      if (!alive) return;
      if (!canvas.isConnected) { alive = false; return; }
      ctx.clearRect(0, 0, W, H);
      if (snow) {
        ctx.fillStyle = 'rgba(255,255,255,.85)';
        parts.forEach(function (p) {
          p.y += p.v; p.s += 0.02; p.x += Math.sin(p.s) * 0.4;
          if (p.y > H + 4) { p.y = -4; p.x = Math.random() * W; }
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill();
        });
      } else {
        ctx.strokeStyle = 'rgba(210,225,245,.45)'; ctx.lineWidth = 1.2; ctx.lineCap = 'round';
        ctx.beginPath();
        parts.forEach(function (p) {
          p.y += p.v; p.x -= p.v * 0.18;
          if (p.y > H + 20) { p.y = -20; p.x = Math.random() * (W + 40); }
          ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.r * 0.18, p.y + p.r);
        });
        ctx.stroke();
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    canvas.__wxStop = function () { alive = false; cancelAnimationFrame(raf); };
  }

  global.Weather = {
    load: load,
    cached: function () { var c = readCache(); return c ? c.data : null; },
    clearCache: clearCache,
    searchCity: searchCity,
    codeInfo: codeInfo,
    aqiText: aqiText,
    tipOf: tipOf,
    icon: icon,
    mountFx: mountFx
  };
})(window);
