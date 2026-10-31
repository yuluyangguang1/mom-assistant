/**
 * icons.js - 内联 SVG 图标 / 主题化插画（零依赖、零网络）
 *
 * 暴露全局：
 *   window.MomIcons  —— { name: '<svg ...>...</svg>' }（已渲染好的线性图标字符串）
 *   window.MomIllos  —— { name: { vb, inner } }（插画定义）
 *   window.icon(name, extraClass?)  —— 返回线性图标 SVG 字符串；找不到返回 ''
 *   window.illo(name, extraClass?)  —— 返回主题化插画 SVG 字符串；找不到返回 ''
 *
 * 设计约定：
 *   - 线性图标：fill="none" stroke="currentColor"，stroke-width="1.6"，
 *     stroke-linecap/linejoin="round"，viewBox 0 0 24 24，默认 22×22（由 CSS .ico 控制）。
 *   - 插画：用 currentColor 描边；柔和填充用 style="fill:var(--primary-weak)" 等 CSS 变量，
 *     暗色模式自动适配；不写死任何十六进制颜色。
 *   - 全部内联，无任何 CDN / 外部图片 / 网络字体 / emoji。
 *
 * 注意：各 module 在调用前会做存在性守卫，因此在 icons.js 未加载（如离线/测试）时
 *       icon()/illo() 也不会导致报错（返回 ''）。
 */
(function (global) {
  'use strict';

  /* ---------------------------------------------------------------- 线性图标 */
  /* 第 234 次：咿呀自绘图标 v2 —— 线 + 柔色块（duotone），圆头圆角；色块用 currentColor 低透明度，深浅主题自动跟随 */
  function T(d) { return '<path d="' + d + '" fill="currentColor" stroke="none" opacity=".28"/>'; }
  function TC(cx, cy, r) { return '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="currentColor" stroke="none" opacity=".28"/>'; }
  function DOT(cx, cy, r) { return '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="currentColor" stroke="none"/>'; }
  var V2 = {
    home: T('M6 10.2 12 5.4l6 4.8V19a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1Z') +
      '<path d="M3.5 11 11 4.8a1.6 1.6 0 0 1 2 0l7.5 6.2"/>' +
      '<path d="M5.8 9.6V19a1.4 1.4 0 0 0 1.4 1.4h9.6a1.4 1.4 0 0 0 1.4-1.4V9.6"/>' +
      '<path d="M12 17.6s-2.5-1.4-2.5-3.1a1.25 1.25 0 0 1 2.5-.4 1.25 1.25 0 0 1 2.5.4c0 1.7-2.5 3.1-2.5 3.1Z"/>',
    period: TC(12, 12, 8.6) +
      '<path d="M12 6.2c2.3 2.7 3.8 4.6 3.8 6.7a3.8 3.8 0 0 1-7.6 0c0-2.1 1.5-4 3.8-6.7Z"/>' +
      '<path d="M10.4 13.4a1.7 1.7 0 0 0 1.2 1.5"/>',
    pee: T('M10 4.5c2.3 2.8 3.9 4.9 3.9 7.2a3.9 3.9 0 0 1-7.8 0c0-2.3 1.6-4.4 3.9-7.2Z') +
      '<path d="M10 4.5c2.3 2.8 3.9 4.9 3.9 7.2a3.9 3.9 0 0 1-7.8 0c0-2.3 1.6-4.4 3.9-7.2Z"/>' +
      '<path d="M17 13c1.3 1.5 2.1 2.6 2.1 3.8a2.1 2.1 0 0 1-4.2 0c0-1.2.8-2.3 2.1-3.8Z"/>',
    pregnancy: TC(14.4, 14.6, 3.6) +
      '<circle cx="10.4" cy="4.4" r="1.9"/>' +
      '<path d="M9.2 21v-4.4c-1.1-1.3-1.5-3.1-1-4.9l.7-2.4c.3-1 1.2-1.7 2.3-1.7h.3c1.1 0 2 .7 2.3 1.7l.3 1c2.5.9 4 2.9 4 5.1 0 2.1-1.5 3.8-3.6 4.1"/>' +
      '<path d="M12.6 18.4V21"/>',
    feeding: T('M9 13.4h6v5.2a2.4 2.4 0 0 1-2.4 2.4h-1.2A2.4 2.4 0 0 1 9 18.6Z') +
      '<path d="M10.6 5.6c0-1.4.6-2.6 1.4-2.6s1.4 1.2 1.4 2.6"/>' +
      '<rect x="8" y="5.6" width="8" height="2.6" rx=".9"/>' +
      '<path d="M9 8.2v10.4a2.4 2.4 0 0 0 2.4 2.4h1.2a2.4 2.4 0 0 0 2.4-2.4V8.2"/>' +
      '<path d="M9 11.2h1.8M9 14.4h1.8"/>',
    breast: TC(16.4, 10.6, 2.1) +
      '<circle cx="9" cy="5" r="2.4"/>' +
      '<path d="M5 21v-6.5C5 10.9 6.9 9 9.5 9c1.6 0 2.8.7 3.6 1.9"/>' +
      '<path d="M7.5 14.5c1.5 1.6 4.6 2.3 7.5 1.3 2-.7 3.4-2.1 3.8-3.6"/>' +
      '<circle cx="16.4" cy="10.6" r="2.1"/>',
    sleep: T('M19.5 14.6A7.6 7.6 0 0 1 9.4 4.5a7.6 7.6 0 1 0 10.1 10.1Z') +
      '<path d="M19.5 14.6A7.6 7.6 0 0 1 9.4 4.5a7.6 7.6 0 1 0 10.1 10.1Z"/>' +
      '<path d="M16.8 3.6v3M15.3 5.1h3"/>' + DOT(20, 9, .8),
    moon: T('M19.5 14.6A7.6 7.6 0 0 1 9.4 4.5a7.6 7.6 0 1 0 10.1 10.1Z') +
      '<path d="M19.5 14.6A7.6 7.6 0 0 1 9.4 4.5a7.6 7.6 0 1 0 10.1 10.1Z"/>',
    noise: TC(7, 17.6, 2.2) + TC(16.2, 15.4, 2.2) +
      '<circle cx="7" cy="17.6" r="2.2"/><circle cx="16.2" cy="15.4" r="2.2"/>' +
      '<path d="M9.2 17.6V6.4l9.2-2.2v11.2"/>' +
      '<path d="M9.2 9.6l9.2-2.2"/>',
    contraction: TC(12, 13.6, 7.4) +
      '<circle cx="12" cy="13.6" r="7.4"/>' +
      '<path d="M10.2 3.4h3.6M12 3.4v2.8"/>' +
      '<path d="M7.3 13.8c1.1-1.9 2.3-1.9 3.4 0s2.3 1.9 3.4 0 2.1-1.8 2.8-.7"/>',
    fetal: T('M12.4 9.4c2.2 0 3.6 1.9 3.6 4.8 0 2.6-.7 4.2-.7 5.1 0 1.1-.9 1.9-2.6 1.9-1.9 0-3.7-1.1-3.7-3.2 0-1.4.9-2.1.9-3.5 0-1.2-.9-1.8-.9-3 0-1.3 1.4-2.1 3.4-2.1Z') +
      '<path d="M12.4 9.4c2.2 0 3.6 1.9 3.6 4.8 0 2.6-.7 4.2-.7 5.1 0 1.1-.9 1.9-2.6 1.9-1.9 0-3.7-1.1-3.7-3.2 0-1.4.9-2.1.9-3.5 0-1.2-.9-1.8-.9-3 0-1.3 1.4-2.1 3.4-2.1Z"/>' +
      DOT(9.9, 6.7, 1.5) + DOT(12.6, 5.4, 1.15) + DOT(14.8, 5.9, 1) + DOT(16.5, 7.2, .85) + DOT(17.5, 8.9, .7),
    temp: TC(12, 17.2, 2.6) +
      '<path d="M10 5a2 2 0 0 1 4 0v9.3a4 4 0 1 1-4 0Z"/>' +
      '<path d="M12 15.2V9"/>' +
      '<path d="M16.4 6.5h1.8M16.4 9.5h1.8"/>',
    growth: T('M12 13.6C12 10.1 9.6 8 6 8c0 3.5 2.4 5.6 6 5.6Z') + T('M12 11.1c0-3.4 2.4-5.6 6-5.6 0 3.4-2.4 5.6-6 5.6Z') +
      '<path d="M12 20.4v-9.2"/>' +
      '<path d="M12 13.6C12 10.1 9.6 8 6 8c0 3.5 2.4 5.6 6 5.6Z"/>' +
      '<path d="M12 11.1c0-3.4 2.4-5.6 6-5.6 0 3.4-2.4 5.6-6 5.6Z"/>' +
      '<path d="M7 20.4h10"/>',
    prenatal: T('M6.5 3.5h9.5a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6.5a1.5 1.5 0 0 1-1.5-1.5V5a1.5 1.5 0 0 1 1.5-1.5Z') + /* 第 298 次：产检本 */
      '<path d="M6.5 3.5h9.5a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6.5a1.5 1.5 0 0 1-1.5-1.5V5a1.5 1.5 0 0 1 1.5-1.5Z"/>' +
      '<path d="M8.5 3.5v17"/>' +
      '<path d="M13.2 13.6s-2.6-1.5-2.6-3.2a1.3 1.3 0 0 1 2.6-.4 1.3 1.3 0 0 1 2.6.4c0 1.7-2.6 3.2-2.6 3.2Z"/>',
    momweight: T('M7.5 4.5h9a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3h-9a3 3 0 0 1-3-3v-9a3 3 0 0 1 3-3Z') + /* 第 297 次：体重秤 */
      '<rect x="4.5" y="4.5" width="15" height="15" rx="3"/>' +
      '<path d="M9 9.2a4.2 4.2 0 0 1 6 0"/>' +
      '<path d="M12 9.6l1.2-1.6"/>',
    packing: T('M7 7h10a3 3 0 0 1 3 3v6.5a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V10a3 3 0 0 1 3-3Z') +
      '<path d="M9 7V5.6A1.6 1.6 0 0 1 10.6 4h2.8A1.6 1.6 0 0 1 15 5.6V7"/>' +
      '<rect x="4" y="7" width="16" height="12.5" rx="3"/>' +
      '<path d="M12 10.6v5.4M9.3 13.3h5.4"/>',
    supplies: T('M7 7.5h10a3.5 3.5 0 0 1 3.5 3.5v4.5A3.5 3.5 0 0 1 17 19H7a3.5 3.5 0 0 1-3.5-3.5V11A3.5 3.5 0 0 1 7 7.5Z') +
      '<rect x="3.5" y="7.5" width="17" height="11.5" rx="3.5"/>' +
      '<path d="M9.2 11h5.6a1.5 1.5 0 0 1 0 3H9.2a1.5 1.5 0 0 1 0-3Z"/>' +
      T('M9.2 11h5.6a1.5 1.5 0 0 1 0 3H9.2a1.5 1.5 0 0 1 0-3Z') + '<path d="M7 4.5h10" opacity=".55"/>',
    diaper: T('M3.5 7h17v2.3c0 5-3.8 9.2-8.5 9.2S3.5 14.3 3.5 9.3Z') +
      '<path d="M3.5 7h17v2.3c0 5-3.8 9.2-8.5 9.2S3.5 14.3 3.5 9.3Z"/>' +
      '<path d="M3.7 10h3M17.3 10h3"/>' +
      '<path d="M12 14.6s-1.9-1.1-1.9-2.4a.95.95 0 0 1 1.9-.3.95.95 0 0 1 1.9.3c0 1.3-1.9 2.4-1.9 2.4Z"/>',
    poop: T('M7.2 19.5h9.6a2.5 2.5 0 0 0 .7-4.9 2.4 2.4 0 0 0-1.6-3.6 2.5 2.5 0 0 0-2.2-3.7c0-1.3-.6-2.4-1.8-2.8.2 1-.4 1.8-1.4 2.3A2.6 2.6 0 0 0 8.1 11a2.4 2.4 0 0 0-1.6 3.6 2.5 2.5 0 0 0 .7 4.9Z') +
      '<path d="M7.2 19.5h9.6a2.5 2.5 0 0 0 .7-4.9 2.4 2.4 0 0 0-1.6-3.6 2.5 2.5 0 0 0-2.2-3.7c0-1.3-.6-2.4-1.8-2.8.2 1-.4 1.8-1.4 2.3A2.6 2.6 0 0 0 8.1 11a2.4 2.4 0 0 0-1.6 3.6 2.5 2.5 0 0 0 .7 4.9Z"/>' +
      DOT(10.3, 15.2, .8) + DOT(13.7, 15.2, .8),
    vaccine: '<g transform="rotate(45 12 12)">' + T('M10 7h4v8.5h-4Z') +
      '<rect x="10" y="5" width="4" height="10.5" rx="1"/>' +
      '<path d="M12 5V2.4M10.2 2.4h3.6M12 15.5v5.4M10 8.4h1.6M10 11h1.6"/></g>',
    meds: '<g transform="rotate(-45 12 12)">' + T('M8 12h8v4.5a4 4 0 0 1-8 0Z') +
      '<rect x="8" y="3.5" width="8" height="17" rx="4"/>' +
      '<path d="M8 12h8"/></g>',
    /* 第 301 次：生病记录——小本子 + 加号 */
    sick: T('M6.5 4h10a1.5 1.5 0 0 1 1.5 1.5v13a1.5 1.5 0 0 1-1.5 1.5h-10Z') +
      '<path d="M6.5 4h10a1.5 1.5 0 0 1 1.5 1.5v13a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 18.5v-13A1.5 1.5 0 0 1 6.5 4Z"/>' +
      '<path d="M12 9v5M9.5 11.5h5M8 4v16"/>',
    milestone: T('M6 4.5h10.5l-2.2 3.5 2.2 3.5H6Z') +
      '<path d="M6 21V4"/>' +
      '<path d="M6 4.5h10.5l-2.2 3.5 2.2 3.5H6"/>' +
      '<path d="M16.8 15v4.4M14.6 17.2H19"/>',
    finance: T('M5 12.5c0-3.3 3.1-5.5 7-5.5 1.5 0 2.9.3 4 .9l2.3-1.4v2.9c.8.8 1.3 1.8 1.5 2.8h1.2v3h-1.6c-.5 1.1-1.3 2-2.4 2.6v2.2h-2.5v-1.4a10 10 0 0 1-3 0v1.4H9v-2.2c-2.4-1.2-4-3-4-5.3Z') +
      '<path d="M5 12.5c0-3.3 3.1-5.5 7-5.5 1.5 0 2.9.3 4 .9l2.3-1.4v2.9c.8.8 1.3 1.8 1.5 2.8h1.2v3h-1.6c-.5 1.1-1.3 2-2.4 2.6v2.2h-2.5v-1.4a10 10 0 0 1-3 0v1.4H9v-2.2c-2.4-1.2-4-3-4-5.3Z"/>' +
      '<path d="M10.4 9.4h3M5 12.2c-1 0-1.7-.6-1.7-1.5"/>' + DOT(15.8, 11.2, .8),
    formula: T('M6.5 11h11v5h-11Z') +
      '<rect x="7.5" y="3.8" width="9" height="3.2" rx="1.2"/>' +
      '<rect x="6.5" y="7" width="11" height="13" rx="2.2"/>' +
      '<path d="M6.5 11h11M6.5 16h11"/>',
    pump: T('M7 15h6v3.8a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2Z') + T('M5.5 4.5h9L12 9H8Z') +
      '<path d="M5.5 4.5h9L12 9H8Z"/>' +
      '<path d="M8.6 9v2.2h2.8V9"/>' +
      '<path d="M8 11.2h4a1 1 0 0 1 1 1v6.6a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-6.6a1 1 0 0 1 1-1Z"/>' +
      '<path d="M14 7c2.6 0 4.3 1.6 4.3 4.2v3"/>',
    solid: T('M4 11.5h16a8 8 0 0 1-16 0Z') +
      '<path d="M4 11.5h16a8 8 0 0 1-16 0Z"/>' +
      '<path d="M9.5 20.6h5"/>' +
      '<path d="M14.6 9.4l3.6-4.4"/>' +
      '<ellipse cx="19" cy="4" rx="1.2" ry="1.8" transform="rotate(40 19 4)"/>' +
      '<path d="M8.6 8.6c-.7-.9.7-1.7 0-2.7M11.6 8.6c-.7-.9.7-1.7 0-2.7"/>',
    baby: TC(12, 13, 7) +
      '<circle cx="12" cy="13" r="7"/>' +
      '<path d="M12 6c-.2-1.5.8-2.5 2-2.1"/>' +
      DOT(9.5, 12.5, .9) + DOT(14.5, 12.5, .9) +
      '<path d="M10.2 15.6c1 .9 2.6.9 3.6 0"/>',
    heart: T('M12 19.5s-7-4.3-7-9.2A3.9 3.9 0 0 1 12 8a3.9 3.9 0 0 1 7 2.3c0 4.9-7 9.2-7 9.2Z') +
      '<path d="M12 19.5s-7-4.3-7-9.2A3.9 3.9 0 0 1 12 8a3.9 3.9 0 0 1 7 2.3c0 4.9-7 9.2-7 9.2Z"/>',
    sun: TC(12, 12, 4) + '<circle cx="12" cy="12" r="4"/>' +
      '<path d="M12 3v1.8M12 19.2V21M3 12h1.8M19.2 12H21M5.6 5.6l1.3 1.3M17.1 17.1l1.3 1.3M5.6 18.4l1.3-1.3M17.1 6.9l1.3-1.3"/>',
    bath: T('M3.5 12h17v1.5a5.5 5.5 0 0 1-5.5 5.5H9a5.5 5.5 0 0 1-5.5-5.5Z') +
      '<path d="M3.5 12h17v1.5a5.5 5.5 0 0 1-5.5 5.5H9a5.5 5.5 0 0 1-5.5-5.5Z"/>' +
      '<path d="M7.4 19l-1 1.6M16.6 19l1 1.6"/>' +
      '<circle cx="9" cy="8.4" r="1.6"/><circle cx="12.9" cy="6.4" r="1.1"/><circle cx="15.8" cy="8.9" r="1.3"/>',
    swim: '<path d="M12 4.2a7.8 7.8 0 1 1 0 15.6 7.8 7.8 0 0 1 0-15.6Zm0 4.4a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8Z" fill="currentColor" fill-rule="evenodd" stroke="none" opacity=".28"/>' +
      '<circle cx="12" cy="12" r="7.8"/><circle cx="12" cy="12" r="3.4"/>' +
      '<path d="M12 4.2v4.4M12 15.4v4.4M4.2 12h4.4M15.4 12h4.4"/>',
    water: T('M7.3 11c1.6-.8 3.1-.8 4.7 0s3.1.8 4.7 0l-.7 7.6a2 2 0 0 1-2 1.9H10a2 2 0 0 1-2-1.9Z') +
      '<path d="M6.5 5h11l-1.3 13.6a2 2 0 0 1-2 1.9H9.8a2 2 0 0 1-2-1.9Z"/>',
    jaundice: TC(12, 12, 5) + '<circle cx="12" cy="12" r="5"/>' +
      DOT(10.2, 11.4, .7) + DOT(13.8, 11.4, .7) + '<path d="M10.5 13.8c.9.7 2.1.7 3 0"/>' +
      '<path d="M12 2.6v2M12 19.4v2M2.6 12h2M19.4 12h2M5.4 5.4l1.4 1.4M17.2 17.2l1.4 1.4M5.4 18.6l1.4-1.4M17.2 6.8l1.4-1.4"/>',
    supplement: T('M10 7V5a2 2 0 0 1 4 0v2Z') +
      '<path d="M10 7V5a2 2 0 0 1 4 0v2"/>' +
      '<path d="M8.4 7h7.2"/>' +
      '<path d="M10.3 7v7.6L12 16.6l1.7-2V7"/>' +
      '<path d="M12 18.6c.9 1 1.3 1.7 1.3 2.3a1.3 1.3 0 0 1-2.6 0c0-.6.4-1.3 1.3-2.3Z"/>',
    mood: TC(12, 12, 8) + '<circle cx="12" cy="12" r="8"/>' +
      '<path d="M8.6 10.6c.6-.8 1.7-.8 2.3 0M13.1 10.6c.6-.8 1.7-.8 2.3 0"/>' +
      '<path d="M8.8 14.2c1.7 1.9 4.7 1.9 6.4 0"/>',
    calendar: T('M6.5 5h11A2.5 2.5 0 0 1 20 7.5V10H4V7.5A2.5 2.5 0 0 1 6.5 5Z') +
      '<rect x="4" y="5" width="16" height="15" rx="2.5"/>' +
      '<path d="M8 3v4M16 3v4M4 10h16"/>' + DOT(8.5, 14, .9) + DOT(12, 14, .9) + DOT(15.5, 14, .9),
    clock: TC(12, 12, 8.5) + '<circle cx="12" cy="12" r="8.5"/>' +
      '<path d="M12 7.5V12l3 2"/>',
    bell: T('M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5Z') +
      '<path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5"/>' +
      '<path d="M4.5 16.5h15"/>' +
      '<path d="M10 19.5a2.2 2.2 0 0 0 4 0"/>' +
      '<path d="M12 3.5v2"/>',
    alert: T('M10.3 4.6a2 2 0 0 1 3.4 0l7 12.1a2 2 0 0 1-1.7 3H5a2 2 0 0 1-1.7-3Z') +
      '<path d="M10.3 4.6a2 2 0 0 1 3.4 0l7 12.1a2 2 0 0 1-1.7 3H5a2 2 0 0 1-1.7-3Z"/>' +
      '<path d="M12 9.5v4"/>' + DOT(12, 16.6, 1)
  };
  V2.bottle = V2.feeding;

  var ICONS = {
    settings: /* 齿轮（第 82 次：旧辐条画法细看像太阳，改标准 cog 齿轮轮廓） */
      '<circle cx="12" cy="12" r="3.2"/>' +
      '<path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.09a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.09a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1Z"/>',
    plus:
      '<path d="M12 5v14M5 12h14"/>',
    check:
      '<path d="M5 12.5l4.5 4.5L19 7"/>',
    camera:
      '<path d="M4 8.5h3.2L9 6h6l1.8 2.5H20v10.5H4z"/>' +
      '<circle cx="12" cy="13.3" r="3.3"/>',
    image:
      '<rect x="3.5" y="5" width="17" height="14" rx="2"/>' +
      '<circle cx="9" cy="10" r="1.6"/>' +
      '<path d="M4 17l5-4.5 4 3.5 2.5-2 4.5 3.8"/>',
    trash:
      '<path d="M4 7h16"/>' +
      '<path d="M9 7V5h6v2"/>' +
      '<path d="M6.5 7l1 12.5h9l1-12.5"/>' +
      '<path d="M10 11v6M14 11v6"/>',
    edit:
      '<path d="M4 20h4L19.5 8.5l-4-4L4 16v4Z"/>' +
      '<path d="M14 6.5l4 4"/>',
    close: /* 第 224 次：半屏面板左上角关闭 */
      '<path d="M6 6l12 12M18 6 6 18"/>',
    'chevron-right':
      '<path d="M9 6l6 6-6 6"/>',
    /* 第 118 次（对标 Cali · 首页收敛）：两个新图标键。
       search —— 首页/「全部功能」页顶部的搜索入口 + 搜索页的输入行；
       grid   —— 首页底部的「全部功能」入口（四宫格 = 家当总览，比 list 更贴语义）。 */
    search:
      '<circle cx="11" cy="11" r="6.2"/>' +
      '<path d="M15.7 15.7 20 20"/>',
    grid:
      '<rect x="4" y="4" width="7" height="7" rx="2"/>' +
      '<rect x="13" y="4" width="7" height="7" rx="2"/>' +
      '<rect x="4" y="13" width="7" height="7" rx="2"/>' +
      '<rect x="13" y="13" width="7" height="7" rx="2"/>',
    back: /* 返回箭头（第 95 次：顶栏返回按钮改圆形图标，与设置齿轮同语言） */
      '<path d="M15 6l-6 6 6 6"/>',
    export:
      '<path d="M12 15V4"/>' +
      '<path d="M8 8l4-4 4 4"/>' +
      '<path d="M5 15.5v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"/>',
    import:
      '<path d="M12 4v11"/>' +
      '<path d="M8 11l4 4 4-4"/>' +
      '<path d="M5 15.5v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"/>',
    refresh:
      '<path d="M20 11a8 8 0 0 0-14-4.5L4 8"/>' +
      '<path d="M4 4v4h4"/>' +
      '<path d="M4 13a8 8 0 0 0 14 4.5L20 16"/>' +
      '<path d="M20 20v-4h-4"/>',
    share: /* 分享（节点 + 双出线，呼应系统分享） */
      '<circle cx="6" cy="12" r="2.4"/>' +
      '<circle cx="17.5" cy="6.2" r="2.4"/>' +
      '<circle cx="17.5" cy="17.8" r="2.4"/>' +
      '<path d="M8.2 11l7.1-3.7M8.2 13l7.1 3.7"/>'
  };
  for (var vk in V2) if (V2.hasOwnProperty(vk)) ICONS[vk] = V2[vk];

  /* 第 305 次：咿呀图标 v3 —— 两色线面（参考用户给的侧栏图）。
     主线 = currentColor（模块色），浅色块同色 28%；另加一种「点缀色」(.ia 描边 / .iaf 填充)，
     颜色由 CSS 按 data-i 给 --ic-a（脸蛋粉、太阳黄、泡泡蓝…），没给时退回主色，所以任何地方用都不会出错。
     画面更「宝宝」：睡眠是闭眼的宝宝、亲喂是抱着宝宝的妈妈、洗澡是澡盆里的宝宝、生长是量身高。 */
  function A(d) { return '<path class="ia" d="' + d + '"/>'; }
  function AF(d) { return '<path class="iaf" d="' + d + '" stroke="none"/>'; }
  function AC(cx, cy, r) { return '<circle class="iaf" cx="' + cx + '" cy="' + cy + '" r="' + r + '" stroke="none"/>'; }
  function HEART(x, y, k) { /* 小爱心，中心约 (x, y)，k=大小 */
    k = k || 1;
    return 'M' + x + ' ' + (y + 2.2 * k) + 's-' + (2.3 * k) + '-' + (1.35 * k) + '-' + (2.3 * k) + '-' + (2.9 * k) + 'a' + (1.15 * k) + ' ' + (1.15 * k) + ' 0 0 1 ' + (2.3 * k) + '-' + (.4 * k) + 'a' + (1.15 * k) + ' ' + (1.15 * k) + ' 0 0 1 ' + (2.3 * k) + ' ' + (.4 * k) + 'c0 ' + (1.55 * k) + '-' + (2.3 * k) + ' ' + (2.9 * k) + '-' + (2.3 * k) + ' ' + (2.9 * k) + 'Z';
  }
  var V3 = {
    feeding: /* 奶瓶 */
      T('M7.2 14.2h9.6v3.9a2.9 2.9 0 0 1-2.9 2.9H10.1a2.9 2.9 0 0 1-2.9-2.9Z') +
      A('M10.4 6.1c0-1.6.7-2.8 1.6-2.8s1.6 1.2 1.6 2.8') +
      '<rect x="7.8" y="6.1" width="8.4" height="2.7" rx="1.1"/>' +
      '<path d="M8.6 8.8c-.9 1-1.4 2.3-1.4 3.7v5.6a2.9 2.9 0 0 0 2.9 2.9h3.8a2.9 2.9 0 0 0 2.9-2.9v-5.6c0-1.4-.5-2.7-1.4-3.7"/>' +
      '<path d="M14.6 12h2.2M15.2 14.6h1.6"/>',
    breast: /* 亲喂：妈妈抱着宝宝 */
      '<circle cx="8.4" cy="5.3" r="2.3"/>' +
      '<path d="M4.4 21v-5.4c0-3.6 2-5.9 4.8-5.9 1.3 0 2.4.4 3.2 1.2"/>' +
      AC(15.4, 12.4, 3.1) + '<circle cx="15.4" cy="12.4" r="3.1"/>' +
      A('M14.3 9.5c.4-.7 1.5-.9 2.2-.2') +
      '<path d="M6.6 16c2.4 2.6 7.6 3 11.2.3"/>' + DOT(14.6, 12.6, .5),
    pump: /* 吸奶器：喇叭罩 + 储奶瓶 + 软管 */
      T('M4.6 4.6h8.6l-2.8 4.6H7.4Z') + '<path d="M4.6 4.6h8.6l-2.8 4.6H7.4Z"/>' +
      '<path d="M8.9 9.2v2.4"/>' +
      T('M7 15.6h3.8v3a1.9 1.9 0 0 1-3.8 0Z') + '<path d="M6.9 11.6h4v7.1a2 2 0 0 1-4 0Z"/>' +
      A('M13.2 6.9c3.1 0 5.2 1.7 5.2 4.6v2.7') +
      '<rect x="15.9" y="14.2" width="5" height="6.6" rx="1.6"/>' + DOT(18.4, 17.4, .8),
    solid: /* 辅食：冒热气的小碗 + 豌豆 */
      T('M4 11.8h16a8 8 0 0 1-16 0Z') +
      '<path d="M3.4 11.8h17.2"/><path d="M4.2 11.8a7.8 7.8 0 0 0 15.6 0"/><path d="M9.4 20.2h5.2"/>' +
      AC(9.4, 9.9, 1.3) + AC(12.4, 9.4, 1.3) + AC(15.3, 10, 1.1) +
      A('M9.2 3.6c-.9 1 .9 1.8 0 3M13.2 3.2c-.9 1 .9 1.8 0 3'),
    diaper: /* 尿布：两侧魔术贴 + 小爱心 */
      T('M3.8 7h16.4v2.2c0 5.2-3.7 9.3-8.2 9.3S3.8 14.4 3.8 9.2Z') +
      '<path d="M3.8 7h16.4v2.2c0 5.2-3.7 9.3-8.2 9.3S3.8 14.4 3.8 9.2Z"/>' +
      A('M3.9 10.2h3.2M16.9 10.2h3.2') + AF(HEART(12, 11.4, .95)),
    sleep: /* 睡眠：闭着眼睛的宝宝 + zZ */
      TC(10.8, 13.4, 6.8) + '<circle cx="10.8" cy="13.4" r="6.8"/>' +
      '<path d="M9.4 6.7c.3-1.6 2.1-2.3 3.2-1.3"/>' +
      '<path d="M7.4 13.4q1.1 1 2.2 0M12 13.4q1.1 1 2.2 0"/>' + '<path d="M10.1 16.6q.7.5 1.4 0"/>' +
      AC(7, 15.4, 1) + AC(14.6, 15.4, 1) +
      A('M16.8 3.4h3.4l-3.4 3.6h3.4'),
    noise: /* 哄睡声音：音符 + 小月亮 */
      TC(6.9, 17.8, 2.2) + TC(15.1, 15.2, 2.2) +
      '<circle cx="6.9" cy="17.8" r="2.2"/><circle cx="15.1" cy="15.2" r="2.2"/>' +
      '<path d="M9.1 17.8V6.8l8.2-2.2v10.6"/><path d="M9.1 9.8l8.2-2.2"/>' +
      AF('M21.2 21.2a3 3 0 0 1-3.6-3.9 3.1 3.1 0 1 0 3.6 3.9Z'),
    growth: /* 生长：宝宝量身高 */
      T('M13.6 3.2h5.2a1 1 0 0 1 1 1v16.6a1 1 0 0 1-1 1h-5.2Z') +
      '<rect x="13.6" y="3.2" width="6.2" height="18.6" rx="1.2"/>' +
      '<path d="M13.6 7h2M13.6 10.5h3M13.6 14h2M13.6 17.5h3"/>' +
      AC(7.4, 8.3, 2.3) + '<circle cx="7.4" cy="8.3" r="2.3"/>' +
      '<path d="M7.4 11.4v5M4.8 13.2l2.6-1.4 2.6 1.4M5.8 21l1.6-4.6L9 21"/>' +
      A('M10.6 5.6h2.2'),
    vaccine: /* 疫苗：针筒 + 小闪光 */
      '<g transform="rotate(45 11 11)">' + T('M8.9 10.5h4.2v4.9a1 1 0 0 1-1 1H9.9a1 1 0 0 1-1-1Z') +
      '<rect x="8.9" y="5.6" width="4.2" height="10.8" rx="1.1"/>' +
      '<path d="M11 1.8v3.8M8.6 1.8h4.8M11 16.4v4.8M8.9 8.4h1.5M8.9 11.2h1.5"/></g>' +
      A('M18.6 14.4v4M16.6 16.4h4'),
    temp: /* 体温计：红色水银泡 */
      '<path d="M9.8 14.6V5.4a2.2 2.2 0 0 1 4.4 0v9.2a3.8 3.8 0 1 1-4.4 0Z"/>' +
      AC(12, 17.7, 2) + A('M12 15.6V8.8') +
      '<path d="M16.8 6.4h2.2M16.8 9.4h1.6M16.8 12.4h2.2"/>',
    meds: /* 吃药：胶囊 */
      '<g transform="rotate(-45 12 12)">' + AF('M8.2 12h7.6v3.9a3.8 3.8 0 0 1-7.6 0Z') +
      '<rect x="8.2" y="4.2" width="7.6" height="15.6" rx="3.8"/><path d="M8.2 12h7.6"/>' +
      '<path d="M10.4 7.4v2"/></g>',
    milestone: /* 里程碑：小旗 + 星星 */
      T('M6 4.5h10.5l-2.2 3.5 2.2 3.5H6Z') +
      '<path d="M6 21V3.6"/><path d="M6 4.5h10.5l-2.2 3.5 2.2 3.5H6"/>' +
      AF('M17.2 13.6l.9 1.9 2 .3-1.5 1.4.4 2-1.8-1-1.8 1 .4-2-1.5-1.4 2-.3Z'),
    mood: /* 情绪：红脸蛋笑脸 */
      TC(12, 12, 8.2) + '<circle cx="12" cy="12" r="8.2"/>' +
      DOT(9.3, 10.4, .9) + DOT(14.7, 10.4, .9) +
      '<path d="M9.2 13.8a3.4 3.4 0 0 0 5.6 0"/>' + AC(7.6, 13.4, 1.2) + AC(16.4, 13.4, 1.2),
    period: /* 经期：水滴 + 小花 */
      AF('M10.6 5c2.8 3.2 4.6 5.5 4.6 8a4.6 4.6 0 0 1-9.2 0c0-2.5 1.8-4.8 4.6-8Z') +
      '<path d="M10.6 5c2.8 3.2 4.6 5.5 4.6 8a4.6 4.6 0 0 1-9.2 0c0-2.5 1.8-4.8 4.6-8Z"/>' +
      '<path d="M8.6 13.6a2 2 0 0 0 1.5 1.7"/>' +
      '<circle cx="18.2" cy="6.2" r="1.1"/><path d="M18.2 3.4v1.4M18.2 7.6V9M15.4 6.2h1.4M19.6 6.2H21"/>',
    finance: /* 记账：小猪存钱罐 + 金币 */
      T('M5 13c0-3.3 3.1-5.5 7-5.5 1.5 0 2.9.3 4 .9l2.3-1.4v2.9c.8.8 1.3 1.8 1.5 2.8h1.2v3h-1.6c-.5 1.1-1.3 2-2.4 2.6v2.2h-2.5v-1.4a10 10 0 0 1-3 0v1.4H9v-2.2c-2.4-1.2-4-3-4-5.3Z') +
      '<path d="M5 13c0-3.3 3.1-5.5 7-5.5 1.5 0 2.9.3 4 .9l2.3-1.4v2.9c.8.8 1.3 1.8 1.5 2.8h1.2v3h-1.6c-.5 1.1-1.3 2-2.4 2.6v2.2h-2.5v-1.4a10 10 0 0 1-3 0v1.4H9v-2.2c-2.4-1.2-4-3-4-5.3Z"/>' +
      DOT(16, 11.6, .8) + AC(11.4, 4.2, 2.1) + '<path class="ia" d="M11.4 3.3v1.8"/>',
    supplies: /* 用品：购物袋 + 爱心 */
      T('M5 8.6h14l-1 10.9a1.7 1.7 0 0 1-1.7 1.5H7.7A1.7 1.7 0 0 1 6 19.5Z') +
      '<path d="M5 8.6h14l-1 10.9a1.7 1.7 0 0 1-1.7 1.5H7.7A1.7 1.7 0 0 1 6 19.5Z"/>' +
      '<path d="M9 8.6V7.2a3 3 0 0 1 6 0v1.4"/>' + AF(HEART(12, 12.6, 1)),
    contraction: /* 宫缩：秒表 + 波浪 */
      TC(12, 13.6, 7.2) + '<circle cx="12" cy="13.6" r="7.2"/>' +
      '<path d="M10 3.4h4M12 3.4v3M18 6.6l1.4-1.4"/>' +
      A('M7.4 13.8c1.1-1.8 2.2-1.8 3.1 0s2 1.8 3.1 0 2-1.8 3 0'),
    pregnancy: /* 孕期：孕妈侧影 + 肚子上的爱心 */
      TC(14.4, 14.6, 3.6) +
      '<circle cx="10.4" cy="4.4" r="1.9"/>' +
      '<path d="M9.2 21v-4.4c-1.1-1.3-1.5-3.1-1-4.9l.7-2.4c.3-1 1.2-1.7 2.3-1.7h.3c1.1 0 2 .7 2.3 1.7l.3 1c2.5.9 4 2.9 4 5.1 0 2.1-1.5 3.8-3.6 4.1"/>' +
      '<path d="M12.6 18.4V21"/>' + AF(HEART(14.6, 13.2, .7)),
    fetal: /* 胎动：小脚印 */
      T('M10.6 9.4c2.2 0 3.6 1.9 3.6 4.8 0 2.6-.7 4.2-.7 5.1 0 1.1-.9 1.9-2.6 1.9-1.9 0-3.7-1.1-3.7-3.2 0-1.4.9-2.1.9-3.5 0-1.2-.9-1.8-.9-3 0-1.3 1.4-2.1 3.4-2.1Z') +
      '<path d="M10.6 9.4c2.2 0 3.6 1.9 3.6 4.8 0 2.6-.7 4.2-.7 5.1 0 1.1-.9 1.9-2.6 1.9-1.9 0-3.7-1.1-3.7-3.2 0-1.4.9-2.1.9-3.5 0-1.2-.9-1.8-.9-3 0-1.3 1.4-2.1 3.4-2.1Z"/>' +
      AC(8.4, 6, 1.3) + AC(11.2, 4.8, 1.2) + AC(13.8, 5.6, 1.05) + AC(15.8, 7.4, .95) + AC(16.9, 9.9, .85),
    packing: /* 待产包：行李箱 + 十字 */
      T('M6.6 7.6h10.8a2.6 2.6 0 0 1 2.6 2.6v7.6a2.6 2.6 0 0 1-2.6 2.6H6.6A2.6 2.6 0 0 1 4 17.8v-7.6a2.6 2.6 0 0 1 2.6-2.6Z') +
      '<rect x="4" y="7.6" width="16" height="12.8" rx="2.6"/>' +
      '<path d="M9 7.6V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v1.6"/>' +
      A('M12 11.2v5.6M9.2 14h5.6'),
    prenatal: /* 产检：夹板 + 心跳线 */
      T('M7 4.6h10a1.5 1.5 0 0 1 1.5 1.5v13.4A1.5 1.5 0 0 1 17 21H7a1.5 1.5 0 0 1-1.5-1.5V6.1A1.5 1.5 0 0 1 7 4.6Z') +
      '<rect x="5.5" y="4.6" width="13" height="16.4" rx="1.6"/>' +
      '<rect x="9.2" y="3" width="5.6" height="3.2" rx="1"/>' +
      A('M7.8 13.4h2.1l1.2-2.6 1.8 5 1.3-2.4h2'),
    momweight: /* 宝妈体重：体重秤 + 指针 */
      T('M7.5 4.5h9a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3h-9a3 3 0 0 1-3-3v-9a3 3 0 0 1 3-3Z') +
      '<rect x="4.5" y="4.5" width="15" height="15" rx="3.2"/>' +
      '<path d="M8.2 10.4a3.8 3.8 0 0 1 7.6 0Z"/>' + A('M12 10.4l1.6-2') +
      AF(HEART(12, 14, .75)),
    jaundice: /* 黄疸：小宝宝 + 光点 */
      AC(12, 13, 6.2) + '<circle cx="12" cy="13" r="6.2"/>' +
      '<path d="M10.8 6.9c.3-1.4 1.9-2 2.9-1.1"/>' +
      DOT(9.9, 12.8, .75) + DOT(14.1, 12.8, .75) + '<path d="M10.6 15.3q1.4 1 2.8 0"/>' +
      '<path d="M3.4 9.6l1.3.6M20.6 9.6l-1.3.6M3.6 16.8l1.3-.4M20.4 16.8l-1.3-.4"/>',
    bath: /* 洗澡：澡盆里的宝宝 + 泡泡 */
      T('M3.5 12.4h17v1.3a5.3 5.3 0 0 1-5.3 5.3H8.8a5.3 5.3 0 0 1-5.3-5.3Z') +
      '<path d="M2.8 12.4h18.4"/><path d="M3.5 12.4v1.3a5.3 5.3 0 0 0 5.3 5.3h6.4a5.3 5.3 0 0 0 5.3-5.3v-1.3"/>' +
      '<path d="M7.2 19l-.9 2M16.8 19l.9 2"/>' +
      '<path d="M6.2 12.4a2.6 2.6 0 0 1 5.2 0"/>' + DOT(7.9, 11, .45) + DOT(9.7, 11, .45) +
      AC(14.6, 9.4, 1.5) + AC(17.6, 7, 1.1) + AC(17.4, 10.6, .8) + AC(14.4, 5.6, .7),
    swim: /* 游泳：游泳圈 + 水波 */
      '<circle cx="12" cy="10.8" r="6.6"/><circle cx="12" cy="10.8" r="2.6"/>' +
      '<path d="M12 10.8m-4.6 0a4.6 4.6 0 1 0 9.2 0a4.6 4.6 0 1 0-9.2 0" stroke="none" fill="currentColor" opacity=".18"/>' +
      A('M7.2 6.2l2 2M16.8 6.2l-2 2M7.2 15.4l2-2M16.8 15.4l-2-2') +
      '<path d="M3 20.4c1.5-1 3-1 4.5 0s3 1 4.5 0 3-1 4.5 0 3 1 4.5 0"/>',
    sun: /* 晒太阳：笑眯眯的太阳 */
      AC(12, 12, 4.4) + '<circle cx="12" cy="12" r="4.4"/>' +
      '<path d="M10.2 11.4q.6-.6 1.1 0M12.7 11.4q.6-.6 1.1 0M10.6 13.4q1.4 1 2.8 0"/>' +
      A('M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6'),
    water: /* 喝水：带吸嘴的学饮杯 */
      AF('M8.1 13.4h7.8l-.6 5.9a1.7 1.7 0 0 1-1.7 1.5h-3.2a1.7 1.7 0 0 1-1.7-1.5Z') +
      '<path d="M7.4 9.4h9.2l-1.1 10a1.8 1.8 0 0 1-1.8 1.6h-3.4a1.8 1.8 0 0 1-1.8-1.6Z"/>' +
      '<rect x="6.8" y="7.6" width="10.4" height="2" rx="1"/>' +
      '<path d="M10.6 7.6V5.4l2.8-2"/>' +
      '<path d="M7.7 12.2H6.3a1.3 1.3 0 0 0 0 2.6h1.6M16.3 12.2h1.4a1.3 1.3 0 0 1 0 2.6h-1.6"/>',
    supplement: /* 营养品：药瓶 + 十字 */
      AF('M8.4 3.8h7.2a.9.9 0 0 1 .9.9v2.9H7.5V4.7a.9.9 0 0 1 .9-.9Z') +
      '<rect x="7.5" y="3.8" width="9" height="3.8" rx="1"/>' +
      T('M8.6 11h6.8v6H8.6Z') +
      '<path d="M8.4 7.6h7.2a2 2 0 0 1 2 2v9.4a2 2 0 0 1-2 2H8.4a2 2 0 0 1-2-2V9.6a2 2 0 0 1 2-2Z"/>' +
      A('M12 11.8v4.4M9.8 14h4.4'),
    formula: /* 奶粉罐 + 量勺 */
      T('M6.2 11h11.6v6.4H6.2Z') +
      '<rect x="6.2" y="7.4" width="11.6" height="13.4" rx="2.2"/>' +
      '<rect x="5.4" y="4.4" width="13.2" height="3" rx="1.2"/>' +
      AF(HEART(12, 12.6, .85)) + A('M19.6 4.2l-2.2 2.2')
  };
  for (var v3k in V3) if (V3.hasOwnProperty(v3k)) ICONS[v3k] = V3[v3k];
  /* 第 236 次：dock 专用图标——线更粗、轮廓更圆；色块带 .dk-f，平时很淡，选中时加深（像 iOS 的空心→实心） */
  function F(d) { return '<path class="dk-f" d="' + d + '" fill="currentColor" stroke="none"/>'; }
  /* 第 237 次：按「看起来一样大」校正——房子三角顶显小放大，日历方块/齿轮齿显大缩小，放大镜圆形略放；
     缩放围绕画布中心，线宽由 CSS 的 non-scaling-stroke 保持一致 */
  function S(k, dx, dy, inner) { return '<g transform="translate(' + (12 + (dx || 0)) + ' ' + (12 + (dy || 0)) + ') scale(' + k + ') translate(-12 -12)">' + inner + '</g>'; }
  var DK = {
    'dk-home': S(1.03, 0, -0.4, F('M6.2 9.6 12 5.1l5.8 4.5v9a1.6 1.6 0 0 1-1.6 1.6H7.8a1.6 1.6 0 0 1-1.6-1.6Z') +
      '<path d="M4 10.6 11 5a1.6 1.6 0 0 1 2 0l7 5.6"/>' +
      '<path d="M6.2 9.4v9.2a1.6 1.6 0 0 0 1.6 1.6h8.4a1.6 1.6 0 0 0 1.6-1.6V9.4"/>' +
      '<path d="M10 20.2v-3.4a2 2 0 0 1 4 0v3.4"/>'),
    'dk-cal': S(1, 0, 0.1, F('M7 5.5h10a3 3 0 0 1 3 3V10H4V8.5a3 3 0 0 1 3-3Z') +
      '<rect x="4" y="5.5" width="16" height="14.7" rx="3"/>' +
      '<path d="M8.5 3.6v3.6M15.5 3.6v3.6M4 10h16"/>' +
      '<circle cx="8.5" cy="14" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="14" r="1" fill="currentColor" stroke="none"/>' +
      '<circle cx="15.6" cy="16.6" r="1.7"/>'),
    'dk-search': S(1.01, 0, -0.15, F('M10.8 4.5a6.3 6.3 0 1 1 0 12.6 6.3 6.3 0 0 1 0-12.6Z') +
      '<circle cx="10.8" cy="10.8" r="6.3"/>' +
      '<path d="M15.6 15.6 19.8 19.8"/>' +
      '<path d="M8 9.6a3.1 3.1 0 0 1 2.4-2.1"/>'),
    'dk-gear': S(0.98, 0, 0, F('M12 3.6l1.6 1.9 2.4-.6.8 2.4 2.4.8-.6 2.4 1.9 1.5-1.9 1.6.6 2.4-2.4.8-.8 2.4-2.4-.6L12 20.4l-1.6-1.9-2.4.6-.8-2.4-2.4-.8.6-2.4L3.6 12l1.8-1.5-.6-2.4 2.4-.8.8-2.4 2.4.6Z') +
      '<path d="M12 3.6l1.6 1.9 2.4-.6.8 2.4 2.4.8-.6 2.4 1.9 1.5-1.9 1.6.6 2.4-2.4.8-.8 2.4-2.4-.6L12 20.4l-1.6-1.9-2.4.6-.8-2.4-2.4-.8.6-2.4L3.6 12l1.8-1.5-.6-2.4 2.4-.8.8-2.4 2.4.6Z"/>' +
      '<circle cx="12" cy="12" r="3"/>'),
    'dk-back': '<path d="M14.6 5.6 8.2 12l6.4 6.4"/>',
    'dk-plus': '<path d="M12 5.6v12.8M5.6 12h12.8"/>',
    play: '<path d="M8.2 5.9v12.2a.9.9 0 0 0 1.4.75l9.3-6.1a.9.9 0 0 0 0-1.5L9.6 5.15a.9.9 0 0 0-1.4.75Z" fill="currentColor" stroke="none"/>',
    pause: '<rect x="6.8" y="5.5" width="3.6" height="13" rx="1.4" fill="currentColor" stroke="none"/><rect x="13.6" y="5.5" width="3.6" height="13" rx="1.4" fill="currentColor" stroke="none"/>',
    chevron: '<path d="M9.5 6l6 6-6 6"/>'
  };
  for (var dk in DK) if (DK.hasOwnProperty(dk)) ICONS[dk] = DK[dk];


  /* bottle 与 feeding 共用同一枚奶瓶图标，消除重复定义（feeding.js 仍按类型取 bottle 图标） */
  ICONS.bottle = ICONS.feeding;

  /* ------------------------------------------------------ 主题化插画（轻量） */
  var ILLOS = {
    home: { /* 怀抱 / 萌芽（hero 大图） */
      vb: '0 0 200 150',
      inner:
        '<circle cx="150" cy="42" r="18" style="fill:var(--primary-weak)" stroke="none"/>' +
        '<path d="M100 116V70"/>' +
        '<path d="M100 84C88 82 78 72 76 58c12 1 22 9 24 22" style="fill:var(--primary-weak)"/>' +
        '<path d="M100 76C112 74 122 64 124 50c-12 1-22 9-24 22" style="fill:var(--primary-weak)"/>' +
        '<circle cx="100" cy="64" r="3" style="fill:var(--primary)" stroke="none"/>' +
        '<path d="M52 118c8-9 22-15 48-15s40 6 48 15"/>'
    },
    period: { /* 月相 / 水滴 */
      vb: '0 0 120 120',
      inner:
        '<path d="M82 34a30 30 0 1 0 0 52 24 24 0 0 1 0-52Z" style="fill:var(--primary-weak)"/>' +
        '<path d="M44 66c7 9 13 15 13 23a13 13 0 0 1-26 0c0-8 6-13 13-23Z" style="fill:var(--primary-weak)"/>'
    },
    pregnancy: { /* 孕育曲线 */
      vb: '0 0 120 120',
      inner:
        '<path d="M30 96c0-30 16-46 36-46s36 16 36 46"/>' +
        '<circle cx="66" cy="40" r="11" style="fill:var(--primary-weak)"/>' +
        '<path d="M34 96c0-26 14-39 32-39" opacity=".45"/>'
    },
    feeding: { /* 奶瓶 */
      vb: '0 0 120 120',
      inner:
        '<path d="M50 24v8l-3 7v41a11 11 0 0 0 11 11h4a11 11 0 0 0 11-11V39l-3-7V24" style="fill:var(--primary-weak)"/>' +
        '<path d="M50 24v8l-3 7v41a11 11 0 0 0 11 11h4a11 11 0 0 0 11-11V39l-3-7V24"/>' +
        '<path d="M46 24h28" stroke-width="2.6"/>' +
        '<path d="M40 62h40" opacity=".7"/>' +
        '<path d="M40 76h40" opacity=".4"/>'
    },
    sleep: { /* 月亮 + 星 */
      vb: '0 0 120 120',
      inner:
        '<path d="M80 32a30 30 0 1 0 0 56 24 24 0 0 1 0-56Z" style="fill:var(--primary-weak)"/>' +
        '<path d="M40 44l2.4 6 6 2.4-6 2.4-2.4 6-2.4-6-6-2.4 6-2.4Z" style="fill:var(--primary)" stroke="none"/>' +
        '<path d="M46 72l1.6 4 4 1.6-4 1.6-1.6 4-1.6-4-4-1.6 4-1.6Z" style="fill:var(--primary)" stroke="none"/>'
    },
    contraction: { /* 波浪 */
      vb: '0 0 120 120',
      inner:
        '<path d="M16 48c8-12 16-12 24 0s16 12 24 0 16-12 24 0 16 12 24 0"/>' +
        '<path d="M16 70c8-12 16-12 24 0s16 12 24 0 16-12 24 0 16 12 24 0" opacity=".55"/>' +
        '<path d="M16 92c8-12 16-12 24 0s16 12 24 0 16-12 24 0 16 12 24 0" opacity=".3"/>'
    },
    growth: { /* 上升曲线 + 坐标轴 */
      vb: '0 0 120 120',
      inner:
        '<path d="M24 22V96H100"/>' +
        '<path d="M30 80l16-14 14 11 22-34" style="stroke:var(--primary)" stroke-width="2.4"/>' +
        '<path d="M76 43h15v15" style="stroke:var(--primary)" stroke-width="2.4"/>' +
        '<circle cx="30" cy="80" r="3" style="fill:var(--primary)" stroke="none"/>' +
        '<circle cx="46" cy="66" r="3" style="fill:var(--primary)" stroke="none"/>' +
        '<circle cx="60" cy="77" r="3" style="fill:var(--primary)" stroke="none"/>' +
        '<circle cx="82" cy="43" r="3" style="fill:var(--primary)" stroke="none"/>'
    },
    packing: { /* 包裹 / 箱子 */
      vb: '0 0 120 120',
      inner:
        '<path d="M24 44l36-16 36 16-36 16-36-16Z" style="fill:var(--primary-weak)"/>' +
        '<path d="M24 44v44l36 16 36-16V44"/>' +
        '<path d="M60 60v44"/>' +
        '<path d="M48 52l12 6 12-6" opacity=".5"/>'
    },
    finance: { /* 硬币堆叠 */
      vb: '0 0 120 120',
      inner:
        '<ellipse cx="60" cy="34" rx="32" ry="12" style="fill:var(--primary-weak)"/>' +
        '<path d="M28 34v20c0 7 14 12 32 12s32-5 32-12V34"/>' +
        '<path d="M28 54v20c0 7 14 12 32 12s32-5 32-12V54"/>' +
        '<path d="M28 74v14c0 7 14 12 32 12s32-5 32-12V74"/>'
    },
    hero: { /* 首页 hero：怀抱 + 萌芽（大图） */
      vb: '0 0 200 150',
      inner:
        '<circle cx="156" cy="40" r="22" style="fill:var(--primary-weak)" stroke="none"/>' +
        '<path d="M156 22v36" opacity=".5"/>' +
        '<path d="M98 120V72"/>' +
        '<path d="M98 86C84 84 73 73 71 57c12 1 23 10 26 25" style="fill:var(--primary-weak)"/>' +
        '<path d="M98 78C112 76 123 65 125 49c-12 1-23 10-26 25" style="fill:var(--primary-weak)"/>' +
        '<circle cx="98" cy="64" r="3.4" style="fill:var(--primary)" stroke="none"/>' +
        '<path d="M44 122c8-10 23-16 54-16s46 6 54 16"/>' +
        '<path d="M150 96c0-6 4-10 10-10s10 4 10 10-4 10-10 10-10-4-10-10Z" style="fill:var(--primary-weak)" stroke="none" opacity=".8"/>'
    },
    empty: { /* 列表空状态：柔和的空盆 + 萌芽（轻量占位） */
      vb: '0 0 120 120',
      inner:
        '<path d="M34 66h52l-6 34a6 6 0 0 1-6 5H46a6 6 0 0 1-6-5Z" style="fill:var(--primary-weak)"/>' +
        '<path d="M34 66h52"/>' +
        '<path d="M60 66V44"/>' +
        '<path d="M60 54C52 52 46 46 45 38c8 .6 14 6 15 14" style="fill:var(--primary-weak)"/>' +
        '<path d="M60 50C68 48 74 42 75 34c-8 .6-14 6-15 14" style="fill:var(--primary-weak)"/>' +
        '<circle cx="60" cy="36" r="2.4" style="fill:var(--primary)" stroke="none"/>'
    },
    /* 宝宝头像（首页全局按钮 + 设置入口，圆形底内的可爱宝宝脸） */
    avatar: {
      vb: '0 0 48 48',
      inner:
        '<circle cx="24" cy="25" r="16" style="fill:var(--primary-weak)"/>' +
        '<path d="M24 9c-3 0-5 2-5 4 0 1 1 2 2.2 2 0-1 1-2 2.8-2s2.8 1 2.8 2c1.2 0 2.2-1 2.2-2 0-2-2-4-5-4Z" style="fill:var(--primary)" stroke="none"/>' +
        '<circle cx="18" cy="24" r="1.9" style="fill:var(--primary)" stroke="none"/>' +
        '<circle cx="30" cy="24" r="1.9" style="fill:var(--primary)" stroke="none"/>' +
        '<circle cx="15.5" cy="28.5" r="2.3" style="fill:var(--primary)" stroke="none" opacity=".22"/>' +
        '<circle cx="32.5" cy="28.5" r="2.3" style="fill:var(--primary)" stroke="none" opacity=".22"/>' +
        '<path d="M20 30c1.6 1.7 6.4 1.7 8 0" style="stroke:var(--primary)" stroke-width="1.8" fill="none" stroke-linecap="round"/>'
    }
  };

  /* ------------------------------------------------------------- 构造辅助 */
  /* 第 336 次：图标 v4 —— 用户用 GPT 生成的统一彩色线面套系（assets/icons/v4/，tools/icons_v4/ 切图）。
     做法：图标键在 V4 表里 → svg 多带 class="i4" + data-i4="文件名"，里面照旧放 v3 线稿当兜底；
     要不要换成彩色图由 CSS 按容器决定（styles.css「图标 v4」段的白名单：功能格子、设置 32 块、模块页头、
     时间轴行、首页卡片头、搜索结果……），按钮里的行内小图标、搜索框放大镜、顶栏齿轮不换，仍是线稿。
     彩色图是 CSS 背景（-webkit-image-set 2x / 3x，深色模式换 -d 提亮版），不进 DOM、不占解码线程；
     图片加载失败（离线且没缓存 / 不支持 webp）→ 下面的探针给 <html> 加 i4-off，全站退回线稿。
     dock 图标（dock-icons.js）不在这里，不受影响。 */
  var V4 = {
    baby: 'baby', breast: 'breast', bottle: 'bottle', feeding: 'bottle', pump: 'pump', solid: 'solid', diaper: 'diaper',
    sleep: 'sleep', growth: 'growth', vaccine: 'vaccine', meds: 'meds', temp: 'temp', sick: 'sick',
    jaundice: 'jaundice', bath: 'bath', swim: 'swim', sun: 'sun', water: 'water', fetal: 'fetal',
    prenatal: 'prenatal', packing: 'packing', mom: 'mom', mood: 'mood', period: 'period', contraction: 'contraction',
    noise: 'noise', whitenoise: 'noise', home: 'home', calendar: 'calendar', search: 'search', settings: 'settings', family: 'family',
    /* 第 337 次：扁平补图 23 个（同一套 v4 squircle 总表，tools/icons_v4 SET=337 切图）。
       pee / poop / 六个缺图模块 / edit 直接用原键；其余是新键（线稿兜底见下方 ICONS 别名），由调用点按语义改用：
       alltools 全部功能页头、cards 首页卡片、quick 我的快记、appearance 外观、weather 天气与农历、reminder 记录与提醒 / 疫苗提醒、
       haptic 保存时轻震、transfer 导入与导出、tofamily 给家人和医生、privacy 数据与隐私、sources 知识来源 / 睡眠参考、
       checkup 儿保体检、birthday 宝宝生日、routine 作息规律。 */
    pee: 'pee', poop: 'poop', milestone: 'milestone', supplement: 'supplement', pregnancy: 'pregnancy', momweight: 'momweight',
    finance: 'finance', supplies: 'supplies', edit: 'edit', alltools: 'alltools', cards: 'cards', quick: 'quick', appearance: 'appearance',
    weather: 'weather', reminder: 'reminder', haptic: 'haptic', transfer: 'transfer', tofamily: 'tofamily', privacy: 'privacy',
    sources: 'sources', checkup: 'checkup', birthday: 'birthday', routine: 'routine'
  };
  global.ICON_V4 = V4;
  (function probeV4() {
    if (typeof Image === 'undefined' || !global.document) return;
    var im = new Image();
    im.onerror = function () { document.documentElement.classList.add('i4-off'); };
    im.src = 'assets/icons/v4/baby@2x.webp';
  })();

  function makeIcon(name, inner, extra) {
    if (!inner) return '';
    var f4 = V4.hasOwnProperty(name) ? V4[name] : '';
    return '<svg class="ico' + (f4 ? ' i4' : '') + (extra ? ' ' + extra : '') + '" data-i="' + name + '"' + (f4 ? ' data-i4="' + f4 + '"' : '') + ' viewBox="0 0 24 24" ' +
      'fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" ' +
      'stroke-linejoin="round" aria-hidden="true" focusable="false">' + inner + '</svg>';
  }

  function makeIllo(name, extra) {
    var def = ILLOS[name];
    if (!def) return '';
    return '<svg class="illo' + (extra ? ' ' + extra : '') + '" viewBox="' + def.vb + '" ' +
      'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
      'stroke-linejoin="round" aria-hidden="true" focusable="false">' + def.inner + '</svg>';
  }

  /* 首页磁贴按 tab id 取图标（icon(t.id)），哄睡页的 tab id 是 whitenoise——与 noise 共用同一图标 */
  ICONS.whitenoise = ICONS.noise;
  /* 第 336 次：家庭共享（设置）有了 v4 图；线稿兜底沿用房子 */
  if (!ICONS.family) ICONS.family = ICONS.home;
  if (!ICONS.mom) ICONS.mom = ICONS.mood;
  /* 第 337 次：新键的线稿兜底（i4-off / 不在白名单的容器里显示）= 原来那颗线稿 */
  var ALIAS337 = { alltools: 'grid', cards: 'grid', quick: 'plus', appearance: 'image', weather: 'sun', reminder: 'bell', haptic: 'heart',
    transfer: 'export', tofamily: 'share', privacy: 'settings', sources: 'search', checkup: 'heart', birthday: 'calendar', routine: 'clock' };
  for (var ak in ALIAS337) { if (ALIAS337.hasOwnProperty(ak) && !ICONS[ak]) ICONS[ak] = ICONS[ALIAS337[ak]]; }

  /* 预渲染图标字符串表（备用） */
  var MomIcons = {};
  for (var k in ICONS) {
    if (ICONS.hasOwnProperty(k)) MomIcons[k] = makeIcon(k, ICONS[k]);
  }

  global.MomIcons = MomIcons;
  global.MomIllos = ILLOS;

  global.icon = function (name, extra) {
    return makeIcon(name, ICONS[name], extra);
  };

  global.illo = function (name, extra) {
    return makeIllo(name, extra);
  };
})(window);
