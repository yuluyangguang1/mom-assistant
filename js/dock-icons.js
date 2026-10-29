/**
 * dock-icons.js — 第 315 次：dock 三个页签图标（宝宝 / 首页 / 日历）重做
 *
 * 用户选定：以原 3D 彩色图标（assets/dock/baby-lg.webp · home.webp · cal.webp）为底，按 3D 的外轮廓描线，
 * 整理成一套干净的线条图标（未选中），再在同一套线条上填色得到选中态。两套：
 *   · 同一 viewBox 0 0 24 24、同一组路径（填色版 = 线条版的每条路径原样 + 填充 + 少量只有填色才有的色块，色块都在轮廓里面），
 *     所以透镜边切过图标时，透镜外的线条与透镜里的填色版线条严丝合缝；
 *   · 线宽统一 1.8、圆角端点 / 圆角连接，关键横竖线落在 .1 / .9 半像素网格上（24px 渲染时 1.8px 线居中对齐像素）。
 * 线条版用 currentColor（浅 #6E5547 / 深 #D9C6B5）+ 点缀色 --ic-a；填色版线条颜色与线条版相同（同色描边 → 接缝无色差），只多出填充。
 * GL「透镜图标层」用 DockIcons.img(k, dark)：填色版的预解码位图（启动时就建好，换页 / 按下时同步 drawImage，不再等 webp 解码）。
 */
(function (global) {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  /* 每个图标：parts = [{ d, fill（填色版的填充色；线条版不填）, line（线条版里也画：默认 true）, accent（线条版里用点缀色填充） }]
     以及 lw（线条版细节线宽，默认 1.8）。顺序 = 绘制顺序：先填色块，后描线。 */
  var G = {
    /* 首页：3D 小房子——厚厚一片圆角人字屋顶（两端出檐）、屋顶右后方的烟囱 + 一缕烟、奶油色屋身、左下圆门（门把手）、右边心形小窗 */
    home: [
      { d: 'M15.9 6.6V4.3a.8.8 0 0 1 .8-.8h1.2a.8.8 0 0 1 .8.8v4.4', fill: '#F3E3CF' },                                  /* 烟囱 */
      { d: 'M17.6 1.6c.9-.7 2.2-.4 2.6.5', fill: 'none', sw: 1.5, accent: 'stroke' },                                 /* 一缕烟 */
      { d: 'M4.1 13.7v6.1a3 3 0 0 0 3 3h9.8a3 3 0 0 0 3-3v-6.1L12 8.4Z', fill: '#F6E7D2' },                                   /* 屋身 */
      { d: 'M2.3 14.1C1.1 13.6.9 12.1 1.9 11.3L10.3 4.4a2.6 2.6 0 0 1 3.4 0l8.4 6.9c1 .8.8 2.3-.4 2.8-.6.2-1.2.1-1.7-.3L12 8.4l-8 5.4c-.5.4-1.1.5-1.7.3Z', fill: '#F2806F' }, /* 屋顶 */
      { d: 'M9.1 15.3a3.1 3.1 0 1 1 0 6.2a3.1 3.1 0 1 1 0-6.2Z', fill: '#93D3AE' },                                              /* 圆门 */
      { d: 'M10.6 18.5h.01', fill: 'none', sw: 1.3 },                                                                /* 门把手 */
      { d: 'M16.5 16c.4-.7 1.6-.6 1.6.4 0 .8-1 1.4-1.6 1.8-.6-.4-1.6-1-1.6-1.8 0-1 1.2-1.1 1.6-.4Z', fill: '#F6C64F', accent: 'fill', sw: 0 } /* 心形小窗 */
    ],
    /* 日历：3D 台历——蓝色顶栏、两只吊环、白色页面（左下角卷起，露出后面的奶油色底页）、右下一颗粉心 */
    cal: [
      { d: 'M3.6 9.9V7.4a3.2 3.2 0 0 1 3.2-3.2h10.4a3.2 3.2 0 0 1 3.2 3.2v2.5Z', fill: '#8EA6EE' },                    /* 蓝顶栏 */
      { d: 'M3.6 9.9v6.7c0 .9.4 1.7 1 2.3l1.9 1.9c.6.6 1.4.9 2.2.9h8.5a3.2 3.2 0 0 0 3.2-3.2V9.9', fill: '#FFFFFF' },   /* 白页 */
      { d: 'M3.9 16.9c1.4-.5 3-.1 3.8 1.2.6 1 .6 2.3-.1 3.2', fill: '#EADCC6', sw: 1.5 },                            /* 卷角 */
      { d: 'M8.1 2.4v3.9M15.9 2.4v3.9', fill: 'none', sw: 2.2 },                                /* 吊环 */
      { d: 'M16.4 14.1c.4-.7 1.7-.6 1.7.4 0 .9-1.1 1.5-1.7 1.9-.6-.4-1.7-1-1.7-1.9 0-1 1.3-1.1 1.7-.4Z', fill: '#F47E93', accent: 'fill', sw: 0 } /* 粉心 */
    ],
    /* 宝宝：3D 咿呀头像——圆脸、两只耳朵、蓬松尖尖的刘海（头顶两撮翘起）、眯眼大笑、张嘴（露舌头）、粉脸蛋 */
    baby: [
      { d: 'M3.5 13.6a2.1 2.1 0 1 0 .3 4.1M20.5 13.6a2.1 2.1 0 1 1-.3 4.1', fill: '#F7C9B1' },                        /* 耳朵 */
      { d: 'M12 4.6a8.6 8.6 0 1 0 0 17.2a8.6 8.6 0 1 0 0-17.2Z', fill: '#FBDCC8' },                                  /* 脸 */
      { d: 'M3.5 14c-.9-4.2.8-7.8 3.6-9.7l-.6-1.7 2 .6c.8-.3 1.6-.5 2.4-.6l1.1-1.6 1.1 1.5c1.6 0 3.2.5 4.5 1.4l2-.5-.5 1.9c1.6 1.8 2.3 4.3 1.9 7.8-1.3-.5-2.3-1.5-2.9-2.9-1.5 1.5-3.5 2.2-5.6 2.1.6-.8.8-1.7.6-2.6-1.3 1.7-3.3 2.6-5.5 2.6.6-.8.8-1.7.6-2.6C7.3 11.9 5.6 13.4 3.5 14Z', fill: '#5A3E36' }, /* 头发 */
      { d: 'M7.6 15.6q1.3-1.3 2.6 0M13.8 15.6q1.3-1.3 2.6 0', fill: 'none', sw: 1.7 },                             /* 眯眼 */
      { d: 'M9.6 17.9h4.8c0 2.1-1.1 3.3-2.4 3.3s-2.4-1.2-2.4-3.3Z', fill: '#E4625E', sw: 1.5 },                     /* 嘴 */
      { d: 'M10.5 20.3c.5-.6 2.5-.6 3 0-.4.5-.9.8-1.5.8s-1.1-.3-1.5-.8Z', line: false, f2: '#F7A39B' },                               /* 舌头（只有填色版） */
      { d: 'M6.2 17.8a1.6 1 0 1 0 3.2 0a1.6 1 0 1 0-3.2 0ZM14.6 17.8a1.6 1 0 1 0 3.2 0a1.6 1 0 1 0-3.2 0Z', fill: '#F59C9C', accent: 'fill', sw: 0, op: .75 } /* 脸蛋 */
    ]
  };
  var LW = 1.8;
  var STROKE = { light: '#6E5547', dark: '#D9C6B5' };

  function partSvg(p, mode, sc) {
    /* mode: 'line'（DOM 未选中）/ 'fill'（选中，描边 = sc）；sc 为 null 时描边用 currentColor */
    var sw = p.sw == null ? LW : p.sw, s = sc || 'currentColor', out = '';
    if (mode === 'line') {
      if (p.line === false) return '';
      if (p.accent === 'fill') return '<path d="' + p.d + '" fill="var(--ic-a, currentColor)" stroke="none"' + (p.op ? ' opacity="' + p.op + '"' : '') + '/>';
      if (p.accent === 'stroke') return '<path d="' + p.d + '" fill="none" stroke="var(--ic-a, currentColor)" stroke-width="' + sw + '"/>';
      return '<path d="' + p.d + '" fill="none"' + (sw ? ' stroke-width="' + sw + '"' : ' stroke="none"') + '/>';
    }
    /* 填色版 */
    if (p.line === false) {
      if (p.f2) out += '<path d="' + p.d + '" fill="' + p.f2 + '" stroke="none"/>';
      return out;
    }
    if (p.accent === 'fill') return '<path d="' + p.d + '" fill="' + p.fill + '" stroke="none"' + (p.op ? ' opacity="' + p.op + '"' : '') + '/>';
    if (p.accent === 'stroke') return '<path d="' + p.d + '" fill="none" stroke="#C9B8AA" stroke-width="' + sw + '"/>';
    var f = p.fill && p.fill !== 'none' ? p.fill : 'none';
    out += '<path d="' + p.d + '" fill="' + f + '" stroke="' + (p.stroke2 || s) + '" stroke-width="' + sw + '"/>';
    return out;
  }
  function inner(k, mode, sc) { return (G[k] || []).map(function (p) { return partSvg(p, mode, sc); }).join(''); }
  var HEAD = 'viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  /* DOM：线条版 / 填色版两颗 SVG 叠在一起（同一盒子、同一 viewBox） */
  function lineSvg(k) { return '<svg class="ico dk-l" ' + HEAD + ' fill="none" stroke="currentColor" stroke-width="' + LW + '" data-dk="' + k + '">' + inner(k, 'line') + '</svg>'; }
  function fillSvg(k) { return '<svg class="dk-c dk-f" ' + HEAD + ' stroke="currentColor" stroke-width="' + LW + '" data-dk="' + k + '">' + inner(k, 'fill') + '</svg>'; }
  /* GL 透镜图标层：填色版的独立 SVG（描边写死成该主题的线条色）→ 预解码位图 */
  function fillFile(k, dark, px) {
    var sc = dark ? STROKE.dark : STROKE.light;
    return '<svg xmlns="' + NS + '" width="' + px + '" height="' + px + '" ' + HEAD + ' stroke="' + sc + '" stroke-width="' + LW + '">' + inner(k, 'fill', sc) + '</svg>';
  }
  function lineFile(k, dark, px) {
    var sc = dark ? STROKE.dark : STROKE.light, acc = { home: dark ? '#F2A09A' : '#EF8E86', cal: dark ? '#F2A09A' : '#EF8E86', baby: '#F49AAA' }[k];
    return '<svg xmlns="' + NS + '" width="' + px + '" height="' + px + '" ' + HEAD + ' fill="none" stroke="' + sc + '" stroke-width="' + LW + '" style="color:' + sc + ';--ic-a:' + acc + '">'
      + inner(k, 'line').replace(/var\(--ic-a, currentColor\)/g, acc).replace(/currentColor/g, sc) + '</svg>';
  }
  var cache = {};
  function img(k, dark) {
    var key = k + (dark ? 'd' : 'l');
    var im = cache[key];
    if (!im && global.Image) {
      im = cache[key] = new Image();
      im.decoding = 'sync';
      im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(fillFile(k, dark, 96));
      try { if (im.decode) im.decode().catch(function () {}); } catch (e) { /* 老内核 */ }
    }
    return im;
  }
  /* 启动即预解码两套主题的位图：按下 / 换页时 GL 透镜图标层同步可画 */
  function warm() { ['baby', 'home', 'cal'].forEach(function (k) { img(k, false); img(k, true); }); }
  global.DockIcons = { G: G, LW: LW, STROKE: STROKE, lineSvg: lineSvg, fillSvg: fillSvg, fillFile: fillFile, lineFile: lineFile, img: img, warm: warm, keys: ['baby', 'home', 'cal'] };
  try { if (global.document) setTimeout(warm, 0); } catch (e) { /* */ }
})(typeof window !== 'undefined' ? window : this);
