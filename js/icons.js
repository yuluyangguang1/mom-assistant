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
    pregnancy: /* 第 188 次：孕妈侧身剪影（旧「弧线 + 圆点」小尺寸下读不出是孕期） */
      '<circle cx="10.4" cy="4.4" r="1.9"/>' +
      '<path d="M9.2 21v-4.4c-1.1-1.3-1.5-3.1-1-4.9l.7-2.4c.3-1 1.2-1.7 2.3-1.7h.3c1.1 0 2 .7 2.3 1.7l.3 1c2.5.9 4 2.9 4 5.1 0 2.1-1.5 3.8-3.6 4.1"/>' +
      '<path d="M12.6 18.4V21"/>',
    feeding: /* 奶瓶 */
      '<path d="M9 3h6"/>' +
      '<path d="M10 3v3l-1 2v9.2a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2V8l-1-2V3"/>' +
      '<path d="M8.4 12h7.2"/>',
    sleep: /* 月亮 */
      '<path d="M20 14.4A8 8 0 0 1 9.6 4 7 7 0 1 0 20 14.4Z"/>',
    noise: /* 哄睡声波：高低不一的音柱 + 一道柔和底波 */
      '<path d="M3.5 12h1.4M7.3 8.4v7.2M11.1 5.6v12.8M14.9 8.4v7.2M18.7 10.4v3.2"/>' +
      '<path d="M3.5 18.6c2.7-1.5 5.4 1.5 8.1 0s5.4 1.5 8.1 0" opacity=".5"/>',
    contraction: /* 波浪 */
      '<path d="M3 12c2-3 4-3 6 0s4 3 6 0 4-3 6 0"/>' +
      '<path d="M3 17c2-3 4-3 6 0s4 3 6 0 4-3 6 0" opacity=".5"/>',
    fetal: /* 胎动（小脚点 + 涟漪） */
      '<circle cx="9" cy="13.5" r="2.4"/>' +
      '<path d="M14.5 8.5a7 7 0 0 1 0 10"/>' +
      '<path d="M17.5 6a10.5 10.5 0 0 1 0 15" opacity=".55"/>',
    temp: /* 体温（体温计） */
      '<path d="M13.5 4.5a2.5 2.5 0 0 1 5 0v8.2a4.5 4.5 0 1 1-5 0Z"/>' +
      '<circle cx="16" cy="17" r="1.6"/>' +
      '<path d="M16 15V7.5"/>',
    growth: /* 上升曲线 + 坐标轴 */
      '<path d="M4 19V5"/>' +
      '<path d="M4 19h16"/>' +
      '<path d="M6.5 15l3.8-3.8 3 3 4.7-6.7"/>' +
      '<path d="M16 7.5h4v4"/>',
    packing: /* 第 188 次：待产包 = 带提手的住院包 + 十字（旧版与「消耗品」同为纸箱，两者分不开） */
      '<rect x="3.5" y="8" width="17" height="12" rx="2.6"/>' +
      '<path d="M9 8V5.9A1.9 1.9 0 0 1 10.9 4h2.2A1.9 1.9 0 0 1 15 5.9V8"/>' +
      '<path d="M12 11.6v4.8M9.6 14h4.8"/>',
    supplies: /* 第 107 次：消耗品（补给箱 + 倒计时进度暗示） */
      '<path d="M3.5 8.2 12 4.4l8.5 3.8v7.6L12 19.6l-8.5-3.8V8.2Z"/>' +
      '<path d="M3.5 8.2 12 12l8.5-3.8"/>' +
      '<path d="M12 12v7.6"/>' +
      '<path d="M8.2 6.1 16.8 9.9" opacity=".5"/>',
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
    finance: /* 第 188 次：钱包（旧「硬币堆叠」线稿小尺寸下像数据库圆柱） */
      '<path d="M4 7.6h14.4A1.6 1.6 0 0 1 20 9.2v9.2a1.6 1.6 0 0 1-1.6 1.6H5.6A1.6 1.6 0 0 1 4 18.4V7.6Z"/>' +
      '<path d="M4 7.6 14.6 4.3a1.1 1.1 0 0 1 1.4 1V7.6"/>' +
      '<path d="M20 11.4h-3.3a1.8 1.8 0 0 0 0 3.6H20"/>',
    settings: /* 齿轮（第 82 次：旧辐条画法细看像太阳，改标准 cog 齿轮轮廓） */
      '<circle cx="12" cy="12" r="3.2"/>' +
      '<path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.09a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.09a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1Z"/>',
    breast: /* 母乳（奶滴） */
      '<path d="M12 4c2.4 2.9 4 5 4 7.4a4 4 0 0 1-8 0C8 9 9.6 6.9 12 4Z"/>',
    formula: /* 奶粉罐 */
      '<rect x="7" y="10" width="10" height="10" rx="2"/>' +
      '<path d="M7 13h10"/>' +
      '<path d="M9.5 10V7h5v3"/>',
    pump: /* 吸奶器（喇叭罩 + 瓶） */
      '<path d="M8.5 4h7l-1.7 7h-3.6L8.5 4Z"/>' +
      '<rect x="8.5" y="13" width="7" height="7.5" rx="1.8"/>' +
      '<path d="M8.5 16.2h7"/>',
    solid: /* 辅食（碗 + 勺） */
      '<path d="M5 10h14c0 4-3 7-7 7s-7-3-7-7Z"/>' +
      '<path d="M12 10V4"/>' +
      '<circle cx="12" cy="3.4" r="1.8"/>',
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
    /* 第 132 次：洗澡 / 游泳 / 饮水 / 黄疸 / 补剂 五个新模块的图标。
       日晒沿用上面的 sun（语义完全对应），不另造一个。 */
    bath: /* 浴盆 + 水面 + 泡泡 */
      '<path d="M3.4 12.2h17.2v3.2a5 5 0 0 1-5 5H8.4a5 5 0 0 1-5-5v-3.2Z"/>' +
      '<path d="M3.4 12.2c1.4-.9 2.4-.9 3.8 0s2.4.9 3.8 0 2.4-.9 3.8 0 2.4.9 3.8 0"/>' +
      '<circle cx="7.4" cy="6.1" r="1.1"/>' +
      '<circle cx="11.6" cy="4.4" r=".9"/>' +
      '<circle cx="15.4" cy="6.6" r="1.2"/>',
    swim: /* 泳者 + 两道浪 */
      '<circle cx="15.2" cy="7.6" r="1.9"/>' +
      '<path d="M13.2 12.4c-2.2-1.1-4.2-.3-5.4 1.6"/>' +
      '<path d="M2.6 16.6c1.5-1.2 2.5-1.2 4 0s2.5 1.2 4 0 2.5-1.2 4 0 2.5 1.2 4 0"/>' +
      '<path d="M2.6 20c1.5-1.2 2.5-1.2 4 0s2.5 1.2 4 0 2.5-1.2 4 0 2.5 1.2 4 0"/>',
    water: /* 水杯 + 水面 */
      '<path d="M6.8 4.2h10.4l-1.2 14.9a2.1 2.1 0 0 1-2.1 1.9h-3.8a2.1 2.1 0 0 1-2.1-1.9L6.8 4.2Z"/>' +
      '<path d="M7.5 10.6h9"/>',
    jaundice: /* 比色卡（三格）+ 顶部刻度 */
      '<rect x="3.6" y="6.2" width="4.8" height="13.4" rx="1.2"/>' +
      '<rect x="9.6" y="6.2" width="4.8" height="13.4" rx="1.2"/>' +
      '<rect x="15.6" y="6.2" width="4.8" height="13.4" rx="1.2"/>' +
      '<path d="M3.6 3.4h4.8M9.6 3.4h4.8M15.6 3.4h4.8"/>',
    supplement: /* 第 188 次：补剂瓶（旧版斜胶囊与「吃药」几乎同形，同屏并列时分不开） */
      '<rect x="7" y="3.4" width="10" height="3.6" rx="1.1"/>' +
      '<path d="M7.8 7h8.4v12a1.6 1.6 0 0 1-1.6 1.6H9.4A1.6 1.6 0 0 1 7.8 19V7Z"/>' +
      '<path d="M7.8 11h8.4M7.8 16.2h8.4" opacity=".55"/>',
    alert: /* 第 189 次：危险确认框标题用（此前一律用心形，「清空全部数据」配心形语义相反） */
      '<path d="M10.3 4.6 2.9 17.4a2 2 0 0 0 1.7 3h14.8a2 2 0 0 0 1.7-3L13.7 4.6a2 2 0 0 0-3.4 0Z"/>' +
      '<path d="M12 9.6v4.2"/>' +
      '<path d="M12 17.1h.01"/>',
    bell:
      '<path d="M6 9.5a6 6 0 0 1 12 0c0 5 1.8 6.2 2 6.5H4s2-1.5 2-6.5Z"/>' +
      '<path d="M10 19.5a2 2 0 0 0 4 0"/>',
    mood: /* 妈妈情绪（第 66 次）：对话框内含小心形 */
      '<path d="M4 6.8A2.8 2.8 0 0 1 6.8 4h10.4A2.8 2.8 0 0 1 20 6.8v6.9a2.8 2.8 0 0 1-2.8 2.8H10l-4.4 3.9v-3.9h-.8A2.8 2.8 0 0 1 4 13.7Z"/>' +
      '<path d="M12 12.9c-1.9-1.1-2.9-2.2-2.9-3.4 0-.9.7-1.7 1.6-1.7.5 0 1 .3 1.3.8.3-.5.8-.8 1.3-.8.9 0 1.6.8 1.6 1.7 0 1.2-1 2.3-2.9 3.4Z"/>',
    share: /* 分享（节点 + 双出线，呼应系统分享） */
      '<circle cx="6" cy="12" r="2.4"/>' +
      '<circle cx="17.5" cy="6.2" r="2.4"/>' +
      '<circle cx="17.5" cy="17.8" r="2.4"/>' +
      '<path d="M8.2 11l7.1-3.7M8.2 13l7.1 3.7"/>'
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
