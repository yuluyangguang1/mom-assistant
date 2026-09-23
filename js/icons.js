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
  var ICONS = {
    home:
      '<path d="M3 11.4 12 4l9 7.4"/>' +
      '<path d="M5 10v9.2a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V10"/>' +
      '<path d="M9.5 20.2v-5.4h5v5.4"/>',
    period: /* 水滴 / 月相 */
      '<path d="M12 3.3c2.6 3.1 4.4 5.4 4.4 8a4.4 4.4 0 0 1-8.8 0c0-2.6 1.8-4.9 4.4-8Z"/>',
    pregnancy: /* 孕育曲线 + 宝宝 */
      '<path d="M5 19c0-6.2 3.1-9.4 7-9.4s7 3.2 7 9.4"/>' +
      '<circle cx="12" cy="6.6" r="1.7"/>',
    feeding: /* 奶瓶 */
      '<path d="M9 3h6"/>' +
      '<path d="M10 3v3l-1 2v9.2a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2V8l-1-2V3"/>' +
      '<path d="M8.4 12h7.2"/>',
    sleep: /* 月亮 */
      '<path d="M20 14.4A8 8 0 0 1 9.6 4 7 7 0 1 0 20 14.4Z"/>',
    contraction: /* 波浪 */
      '<path d="M3 12c2-3 4-3 6 0s4 3 6 0 4-3 6 0"/>' +
      '<path d="M3 17c2-3 4-3 6 0s4 3 6 0 4-3 6 0" opacity=".5"/>',
    growth: /* 上升曲线 + 坐标轴 */
      '<path d="M4 19V5"/>' +
      '<path d="M4 19h16"/>' +
      '<path d="M6.5 15l3.8-3.8 3 3 4.7-6.7"/>' +
      '<path d="M16 7.5h4v4"/>',
    packing: /* 包裹 / 箱子 */
      '<path d="M3 8l9-4 9 4-9 4-9-4Z"/>' +
      '<path d="M3 8v8l9 4 9-4V8"/>' +
      '<path d="M12 12v8"/>',
    diaper: /* 尿布（婴儿尿裤轮廓） */
      '<path d="M4 6h16v5c0 4.4-3.6 8-8 8s-8-3.6-8-8V6Z"/>' +
      '<path d="M4 9.5c1.8 0 3 1.4 3 3.2"/>' +
      '<path d="M20 9.5c-1.8 0-3 1.4-3 3.2"/>' +
      '<path d="M9.5 6v2M14.5 6v2" opacity=".55"/>',
    pee: /* 尿（水滴） */
      '<path d="M12 4.5c2.2 2.7 3.7 4.7 3.7 7a3.7 3.7 0 0 1-7.4 0c0-2.3 1.5-4.3 3.7-7Z"/>' +
      '<path d="M10.6 12.4c0 1 .8 1.7 1.7 1.6" opacity=".6"/>',
    poop: /* 便（柔和螺旋） */
      '<path d="M7 18.5h10a2.5 2.5 0 0 0 0-5H8.5a2.2 2.2 0 0 1 0-4.4h5.6"/>' +
      '<circle cx="15.2" cy="7.4" r="1.7"/>',
    vaccine: /* 疫苗注射器 */
      '<path d="M17.5 3.5 20.5 6.5"/>' +
      '<path d="M14.5 5.5 18.5 9.5"/>' +
      '<path d="M15.8 6.2 8 14l-1.5 4.5L11 17l7.8-7.8-3-3Z"/>' +
      '<path d="M6.5 17.5 3.5 20.5"/>' +
      '<path d="M10.5 11.5l1.5 1.5M13 9l1.5 1.5" opacity=".55"/>',
    meds: /* 胶囊药丸 */
      '<rect x="4" y="9.2" width="16" height="6.6" rx="3.3" transform="rotate(-32 12 12.5)"/>' +
      '<path d="M9.3 8.6l5.4 8.4"/>' +
      '<path d="M14.7 8.2c.9-1.4 2.6-1.8 4-1" opacity=".55"/>',
    milestone: /* 小旗子 */
      '<path d="M6.5 21V4"/>' +
      '<path d="M6.5 5c3.8-2.4 7.6 2.4 11.5 0v8.5c-3.9 2.4-7.7-2.4-11.5 0"/>' +
      '<path d="M4 21h5" opacity=".55"/>',
    finance: /* 硬币堆叠 */
      '<ellipse cx="12" cy="6" rx="6.5" ry="2.6"/>' +
      '<path d="M5.5 6v6c0 1.5 2.9 2.6 6.5 2.6s6.5-1.1 6.5-2.6V6"/>' +
      '<path d="M5.5 12v6c0 1.5 2.9 2.6 6.5 2.6s6.5-1.1 6.5-2.6v-6"/>',
    settings: /* 齿轮 */
      '<circle cx="12" cy="12" r="3"/>' +
      '<path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8"/>',
    breast: /* 母乳（奶滴） */
      '<path d="M12 4c2.4 2.9 4 5 4 7.4a4 4 0 0 1-8 0C8 9 9.6 6.9 12 4Z"/>',
    formula: /* 奶粉罐 */
      '<rect x="7" y="10" width="10" height="10" rx="2"/>' +
      '<path d="M7 13h10"/>' +
      '<path d="M9.5 10V7h5v3"/>',
    solid: /* 辅食（碗 + 勺） */
      '<path d="M5 10h14c0 4-3 7-7 7s-7-3-7-7Z"/>' +
      '<path d="M12 10V4"/>' +
      '<circle cx="12" cy="3.4" r="1.8"/>',
    plus:
      '<path d="M12 5v14M5 12h14"/>',
    check:
      '<path d="M5 12.5l4.5 4.5L19 7"/>',
    trash:
      '<path d="M4 7h16"/>' +
      '<path d="M9 7V5h6v2"/>' +
      '<path d="M6.5 7l1 12.5h9l1-12.5"/>' +
      '<path d="M10 11v6M14 11v6"/>',
    edit:
      '<path d="M4 20h4L19.5 8.5l-4-4L4 16v4Z"/>' +
      '<path d="M14 6.5l4 4"/>',
    'chevron-right':
      '<path d="M9 6l6 6-6 6"/>',
    calendar:
      '<rect x="4" y="5" width="16" height="15" rx="2"/>' +
      '<path d="M4 9.5h16M8.5 3v4M15.5 3v4"/>',
    clock:
      '<circle cx="12" cy="12" r="8"/>' +
      '<path d="M12 7.5V12l3.2 2"/>',
    baby:
      '<circle cx="12" cy="7" r="3.2"/>' +
      '<path d="M6 21c0-4 2.7-7 6-7s6 3 6 7"/>',
    heart:
      '<path d="M12 20.2C5 15.8 3 11.4 4.2 8.3 5.1 6 7.7 5.1 9.6 6.2c1.2.7 2.1 1.9 2.4 3 .3-1.1 1.2-2.3 2.4-3 1.9-1.1 4.5-.2 5.4 2.1C21 11.4 19 15.8 12 20.2Z"/>',
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
    sun:
      '<circle cx="12" cy="12" r="4"/>' +
      '<path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6"/>',
    moon:
      '<path d="M20 14.4A8 8 0 0 1 9.6 4 7 7 0 1 0 20 14.4Z"/>',
    bell:
      '<path d="M6 9.5a6 6 0 0 1 12 0c0 5 1.8 6.2 2 6.5H4s2-1.5 2-6.5Z"/>' +
      '<path d="M10 19.5a2 2 0 0 0 4 0"/>'
  };

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
      'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" ' +
      'stroke-linejoin="round" aria-hidden="true" focusable="false">' + inner + '</svg>';
  }

  function makeIllo(name, extra) {
    var def = ILLOS[name];
    if (!def) return '';
    return '<svg class="illo' + (extra ? ' ' + extra : '') + '" viewBox="' + def.vb + '" ' +
      'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
      'stroke-linejoin="round" aria-hidden="true" focusable="false">' + def.inner + '</svg>';
  }

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
