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
  function makeIcon(name, inner, extra) {
    if (!inner) return '';
    return '<svg class="ico' + (extra ? ' ' + extra : '') + '" viewBox="0 0 24 24" ' +
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
