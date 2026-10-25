/* ============================================================
   第 212 次：农历（公历 ⇄ 农历）
   不内置历表：直接用浏览器自带的 ICU 中国农历（Intl 'zh-CN-u-ca-chinese'），
   iOS Safari / Android Chrome 都支持；不支持的老环境 Lunar.ok=false，界面自动不显示农历。
   ============================================================ */
(function (global) {
  'use strict';
  /* 第 217 次（真机：农历变成英文）：不再读 ICU 的中文月名/干支（部分 iOS 环境会退回英文），
     只取「数字」——月(闰月带 bis 等非数字后缀)、日、关联公历年；中文名称与干支全部本地查表生成。 */
  var fmt = null;
  function parts(dt) {
    var o = {};
    fmt.formatToParts(dt).forEach(function (x) { o[x.type] = x.value; });
    return o;
  }
  try {
    fmt = new Intl.DateTimeFormat('en-u-ca-chinese', { year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'UTC' });
    var t0 = parts(new Date(Date.UTC(2026, 1, 17)));
    if (parseInt(t0.month, 10) !== 1 || parseInt(t0.day, 10) !== 1) fmt = null;
  } catch (e) { fmt = null; }
  var STEMS = '甲乙丙丁戊己庚辛壬癸', BRANCHES = '子丑寅卯辰巳午未申酉戌亥';
  function ganzhi(y) { var i = ((y - 4) % 60 + 60) % 60; return STEMS.charAt(i % 10) + BRANCHES.charAt(i % 12); }

  var MONTH_NAMES = ['', '正月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '冬月', '腊月'];
  var DAY_A = ['初', '十', '廿', '三'];
  var DAY_B = ['日', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  var ANIMALS = { '子': '鼠', '丑': '牛', '寅': '虎', '卯': '兔', '辰': '龙', '巳': '蛇', '午': '马', '未': '羊', '申': '猴', '酉': '鸡', '戌': '狗', '亥': '猪' };

  function dayName(d) {
    if (d === 10) return '初十';
    if (d === 20) return '二十';
    if (d === 30) return '三十';
    return DAY_A[Math.floor(d / 10)] + DAY_B[d % 10];
  }
  function monthName(m, leap) { return (leap ? '闰' : '') + MONTH_NAMES[m]; }

  /* 公历 Date（按本地年月日）→ 农历 */
  function of(date) {
    if (!fmt || !date) return null;
    var o = parts(new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())));
    var m = parseInt(o.month, 10), d = parseInt(o.day, 10);
    if (!(m >= 1 && m <= 12) || !(d >= 1 && d <= 30)) return null;
    var leap = /\D/.test(String(o.month).trim());
    var y = parseInt(o.relatedYear, 10);
    if (!(y > 1000)) y = date.getFullYear() - ((m >= 10 && date.getMonth() <= 2) ? 1 : 0);
    var gz = ganzhi(y);
    return {
      y: y, m: m, d: d, leap: leap, gz: gz,
      animal: ANIMALS[gz.charAt(1)] || '',
      monthName: monthName(m, leap), dayName: dayName(d),
      text: monthName(m, leap) + dayName(d)
    };
  }
  function iso(dt) {
    var m = dt.getUTCMonth() + 1, d = dt.getUTCDate();
    return dt.getUTCFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d;
  }
  /* 农历某年的全部月份（含闰月）与每月天数、初一的公历日期。按年缓存。 */
  var yearCache = {};
  function yearOf(y) {
    if (!fmt) return [];
    if (yearCache[y]) return yearCache[y];
    var months = [], cur = null;
    var t = Date.UTC(y, 0, 15), end = Date.UTC(y + 1, 2, 1);
    for (; t < end; t += 86400000) {
      var dt = new Date(t);
      var l = of(new Date(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
      if (!l || l.y !== y) { if (cur && l && l.y > y) break; continue; }
      if (l.d === 1) { cur = { m: l.m, leap: l.leap, days: 1, start: iso(dt) }; months.push(cur); }
      else if (cur && cur.m === l.m && cur.leap === l.leap) cur.days = l.d;
    }
    yearCache[y] = months;
    return months;
  }
  /* 农历 → 公历 'YYYY-MM-DD'；该月没有这一天（小月三十）时取当月最后一天 */
  function toSolar(y, m, d, leap) {
    var ms = yearOf(y);
    var hit = ms.filter(function (x) { return x.m === m && !!x.leap === !!leap; })[0];
    if (!hit && leap) hit = ms.filter(function (x) { return x.m === m && !x.leap; })[0];
    if (!hit) return null;
    var dd = Math.min(d, hit.days);
    var st = new Date(hit.start + 'T00:00:00Z');
    return iso(new Date(st.getTime() + (dd - 1) * 86400000));
  }
  /* 下一个农历生日（含今天）：闰月生日按平月过 */
  function nextBirthday(lb, today) {
    if (!lb) return null;
    var t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    var ly = of(t0);
    if (!ly) return null;
    for (var y = ly.y - 1; y <= ly.y + 1; y++) {
      var s = toSolar(y, lb.m, lb.d, false);
      if (!s) continue;
      var dt = new Date(s + 'T00:00:00');
      if (dt >= t0) return { date: dt, iso: s, lunarYear: y };
    }
    return null;
  }

  global.Lunar = {
    ok: !!fmt,
    of: of,
    yearOf: yearOf,
    toSolar: toSolar,
    nextBirthday: nextBirthday,
    dayName: dayName,
    monthName: monthName
  };
})(window);
