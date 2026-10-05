/**
 * knowledge.js - 全局知识底座（第 67 次 · B1，依据《文献结合研究_宝妈助手知识体系建设方案.md》）
 *
 * 定位（升级总纲 B 线红线）：
 * 1. 纯数据底座——只有数据与查询，不渲染、不联网；全部内容内置，file:// 打开照常可用。
 * 2. 引用分层：official（官方标准/指南）> consensus（权威机构共识）> school（学派/流行观点）。
 *    理念冲突时知识句保持中性、不站队；数据类只认官方标准。
 * 3. 只做中性发展事实与就医指路，不做达标线、不做诊断（U-25/U-37 红线延续）。
 *
 * schema：{ id, scope, stage, from, to, pillar, level, source, text }
 *   scope  消费场景：'home' 首页小知识 / 'mind' 妈妈情绪页（F2 支柱）
 *   stage  适用阶段：'pregnancy' 孕期 / 'baby' 育儿 / 'any' 不限
 *   from/to 区间：孕期=孕周（week）、育儿=宝宝日龄（day）、mind=产后天数（null=不限）
 *   pillar WHO 养育照护框架五要素 + mind：health 健康 / nutrition 营养 /
 *          care 回应性照护 / safety 安全 / learning 早期学习 / mind 妈妈情绪
 *   level  引用层级：official / consensus / school
 *   source 来源代号（对照 SOURCES，B6「知识来源」页底稿）
 */
(function (global) {
  'use strict';

  /* 来源代号对照表（升级总纲 · 六；B6 设置页直接复用） */
  var SOURCES = {
    'GJ-2025': '《婴幼儿早期发展服务指南（试行）》国家卫健委 2025.2',
    'YJZX': '《儿童心理行为发育问题预警征象筛查表》（国家基本公卫）',
    'WS/T 423': '《7 岁以下儿童生长标准》WS/T 423-2022',
    'WS/T 479': '《0~6 岁儿童健康管理技术规范》WS/T 479-2015',
    'WS/T 580': '《0 岁~6 岁儿童发育行为评估量表（儿心量表-II）》2017',
    'SY-2023': '《3 岁以下婴幼儿健康养育照护指南（试行）》国家卫健委',
    'WHO-NCF': 'WHO 养育照护框架（Nurturing Care Framework）',
    'WHO-2006': 'WHO 儿童生长标准 2006',
    'AAP': '美国儿科学会（育儿百科第 7 版 / 安全睡眠报告等）',
    'CDC-Early': 'CDC「Learn the Signs. Act Early.」',
    'CNS-2022': '中国营养学会《7~24 月龄婴幼儿喂养指南》2022',
    'WDW': '《神奇的飞跃周》（学派观点）',
    'FH-HP': '上海卫健委产后康复科普（复旦红房子医院审核）',
    'RM-EL': '人民网《当哺乳期遇上月经》（广州市妇儿中心专家受访）',
    'FIGO-2018': 'FIGO 月经异常术语系统 2018（Merck 手册转述）',
    'MAYO-MC': 'Mayo Clinic《Menstrual cycle: What\'s typical, what\'s not》',
    '妇产科学9': '《妇产科学》第 9 版（人民卫生出版社）'
  };
  var LEVEL_TXT = { official: '官方标准/指南', consensus: '权威机构共识', school: '学派/流行观点' };
  var PILLAR_TXT = { health: '健康', nutrition: '营养', care: '回应性照护', safety: '安全', learning: '早期学习', mind: '妈妈情绪' };

  var PILLARS = ['health', 'nutrition', 'care', 'safety', 'learning', 'mind'];
  var LEVELS = ['official', 'consensus', 'school'];

  var DATA = [
    /* ---- 首页小知识 · 孕期（原 home.js 第 210-253 行硬编码迁移，文案一字未改） ---- */
    { id: 'KN-P-1', scope: 'home', stage: 'pregnancy', from: 0, to: 12, pillar: 'health', level: 'official', source: 'SY-2023',
      text: '孕早期小知识：宝宝的主要器官正在成型，叶酸和产检别落下。' },
    { id: 'KN-P-2', scope: 'home', stage: 'pregnancy', from: 13, to: 27, pillar: 'care', level: 'consensus', source: 'AAP',
      text: '孕中期小知识：不少人在这段精力最好，适度散步、左侧卧会更舒服。' },
    { id: 'KN-P-3', scope: 'home', stage: 'pregnancy', from: 28, to: 36, pillar: 'health', level: 'official', source: 'SY-2023',
      text: '孕晚期小知识：宝宝在快速囤积体重，数胎动、留意规律宫缩。' },
    { id: 'KN-P-4', scope: 'home', stage: 'pregnancy', from: 37, to: 42, pillar: 'care', level: 'consensus', source: 'AAP',
      text: '足月小知识：随时可能见面，待产包放在顺手的地方。' },

    /* ---- 首页小知识 · 育儿（同上迁移；区间与原 if 链逐日等价：0-30/31-90/91-180/181-270/271-365/366-540/541-730 天） ---- */
    { id: 'KN-B-1', scope: 'home', stage: 'baby', from: 0, to: 30, pillar: 'health', level: 'official', source: 'SY-2023',
      text: '新生儿大部分时间在睡与吃之间切换，按需喂养就好。' },
    { id: 'KN-B-2', scope: 'home', stage: 'baby', from: 31, to: 90, pillar: 'care', level: 'official', source: 'GJ-2025',
      text: '这个月龄的宝宝开始社交性微笑，多面对面跟他说话。' },
    { id: 'KN-B-3', scope: 'home', stage: 'baby', from: 91, to: 180, pillar: 'health', level: 'official', source: 'GJ-2025',
      text: '开始翻身、伸手抓东西，清醒时趴一趴有助大运动发展。' },
    { id: 'KN-B-4', scope: 'home', stage: 'baby', from: 181, to: 270, pillar: 'nutrition', level: 'official', source: 'CNS-2022',
      text: '辅食可以逐步引入，一次只加一样新食材，坐与爬都在练习中。' },
    { id: 'KN-B-5', scope: 'home', stage: 'baby', from: 271, to: 365, pillar: 'safety', level: 'consensus', source: 'AAP',
      text: '扶站与模仿是这个阶段的日常，家里做好防撞与防误吞。' },
    { id: 'KN-B-6', scope: 'home', stage: 'baby', from: 366, to: 540, pillar: 'learning', level: 'official', source: 'GJ-2025',
      text: '学步期到处探索，多用简单的词和他对话，指着绘本讲。' },
    { id: 'KN-B-7', scope: 'home', stage: 'baby', from: 541, to: 730, pillar: 'learning', level: 'official', source: 'GJ-2025',
      text: '语言爆发期到了，鼓励宝宝自己表达需求，运动和规则意识一起成长。' },

    /* ---- 妈妈情绪页 · mind 支柱（第 67 次 F2 并入；产后天数不限——记录情绪没有「过期」） ---- */
    { id: 'KN-M-1', scope: 'mind', stage: 'any', from: null, to: null, pillar: 'mind', level: 'official', source: 'SY-2023',
      text: '产后头几天情绪起伏、莫名想哭很常见——多数新妈妈都会经历，通常两周内自行缓解。这是身体在重新调整，不是你不够坚强。' },
    { id: 'KN-M-2', scope: 'mind', stage: 'any', from: null, to: null, pillar: 'mind', level: 'consensus', source: 'AAP',
      text: '如果低落持续超过两周、对什么都提不起兴趣，请考虑告诉医生或挂心理门诊——寻求帮助是照顾自己的表现。' },
    { id: 'KN-M-3', scope: 'mind', stage: 'any', from: null, to: null, pillar: 'mind', level: 'consensus', source: 'AAP',
      text: '给妈妈的最好支持，常常是让她睡一个不被打扰的整觉；情绪需要被听见，而不是被讲道理。' },
    { id: 'KN-M-4', scope: 'mind', stage: 'any', from: null, to: null, pillar: 'mind', level: 'consensus', source: 'AAP',
      text: '爸爸同样可能经历产后情绪低落，也会累、也会慌——照顾好彼此，才照顾得好宝宝。' },

    /* ---- 第 69 次（B3）：喂养页参考条目（scope 'feeding'，婴儿 stage 按日龄区间命中） ----
       数字出处：辅食频次 6-9 月 1-2 次 / 9-12 月 2-3 次 / 12-24 月 3 餐+2 加餐、
       每日食物 ≥4 种 → CNS-2022；维 D 400IU（足月每日）/ 新食材适应 2-3 天 → SY-2023。 */
    { id: 'KN-F-1', scope: 'feeding', stage: 'baby', from: 181, to: 270, pillar: 'nutrition', level: 'official', source: 'CNS-2022',
      text: '辅食可以从每天 1 次开始，逐步加到 1–2 次；这个阶段奶仍是主要营养来源。' },
    { id: 'KN-F-2', scope: 'feeding', stage: 'baby', from: 271, to: 365, pillar: 'nutrition', level: 'official', source: 'CNS-2022',
      text: '辅食每天 2–3 次，可以逐步向规律的一日三餐过渡。' },
    { id: 'KN-F-3', scope: 'feeding', stage: 'baby', from: 366, to: 730, pillar: 'nutrition', level: 'official', source: 'CNS-2022',
      text: '每天 3 次正餐加 2 次加餐，食物种类每天不少于 4 种。' },
    { id: 'KN-F-4', scope: 'feeding', stage: 'baby', from: 0, to: 730, pillar: 'health', level: 'official', source: 'SY-2023',
      text: '足月宝宝出生后开始每天补充维生素 D 400 IU；早产或低体重宝宝头三个月是否加量，请遵医嘱。' },
    { id: 'KN-F-5', scope: 'feeding', stage: 'baby', from: 181, to: 730, pillar: 'health', level: 'official', source: 'SY-2023',
      text: '每引入一样新食材，先观察 2–3 天，没有皮疹、呕吐、腹泻等不适再引入下一样。' },

    /* ---- 第 73 次（C2/C3）：睡眠页参考条目（scope 'sleep'，有生日且日龄 0–1095 才呈现） ----
       清醒窗口（KN-S-1~6）：两次睡眠之间能舒适保持清醒的时长参考区间，
       出处为 AAP《育儿百科》等主流共识区间（consensus）。定位是哄睡时机的
       教育性科普，不是宝宝数据的对照标准——与 U-18「作息统计只比你自己」
       的边界做了区分：不与用户任何记录对比、不出「达标/不达标」。
       猛长期（KN-G-1~5）：生后第 3 周/6 周/3 月/6 月/9 月前后常见窗口，
       属流行育儿观点（school），中性呈现，不给「应该睡多久」的评判。 */
    { id: 'KN-S-1', scope: 'sleep', stage: 'baby', from: 0, to: 90, pillar: 'care', level: 'consensus', source: 'AAP',
      text: '0–3 月的宝宝清醒 1–1.5 小时左右就容易累了；新生儿有时撑不到 1 小时，打哈欠、眼神发直就是困意信号。' },
    { id: 'KN-S-2', scope: 'sleep', stage: 'baby', from: 91, to: 180, pillar: 'care', level: 'consensus', source: 'AAP',
      text: '4–6 月的宝宝清醒 1.5–2.5 小时左右需要睡一觉，留意揉眼睛、抓耳朵这些困意信号。' },
    { id: 'KN-S-3', scope: 'sleep', stage: 'baby', from: 181, to: 270, pillar: 'care', level: 'consensus', source: 'AAP',
      text: '7–9 月的宝宝清醒 2.5–3 小时左右睡一觉比较常见，傍晚那一觉可能开始变短。' },
    { id: 'KN-S-4', scope: 'sleep', stage: 'baby', from: 271, to: 365, pillar: 'care', level: 'consensus', source: 'AAP',
      text: '10–12 月的宝宝清醒 3–4 小时左右睡一觉比较常见，有的宝宝开始向早晚两觉过渡。' },
    { id: 'KN-S-5', scope: 'sleep', stage: 'baby', from: 366, to: 540, pillar: 'care', level: 'consensus', source: 'AAP',
      text: '1 岁到 1 岁半的宝宝清醒 4–5 小时左右睡一觉比较常见，午觉时间可能整体后移。' },
    { id: 'KN-S-6', scope: 'sleep', stage: 'baby', from: 541, to: 1095, pillar: 'care', level: 'consensus', source: 'AAP',
      text: '1 岁半以后的宝宝清醒 4–6 小时很常见，有的只睡午觉了，这个阶段个体差异很大。' },
    { id: 'KN-G-1', scope: 'sleep', stage: 'baby', from: 18, to: 24, pillar: 'health', level: 'school', source: 'AAP',
      text: '猛长期窗口（生后第 3 周前后）：有的宝宝吃奶突然变频繁、睡不踏实、更黏人，通常 2–3 天自行过去，按需喂就好。' },
    { id: 'KN-G-2', scope: 'sleep', stage: 'baby', from: 39, to: 45, pillar: 'health', level: 'school', source: 'AAP',
      text: '猛长期窗口（生后第 6 周前后）：吃奶变频繁、夜醒变多都是常见表现，通常 2–3 天自行过去，按需喂就好。' },
    { id: 'KN-G-3', scope: 'sleep', stage: 'baby', from: 87, to: 95, pillar: 'health', level: 'school', source: 'AAP',
      text: '猛长期窗口（满 3 个月前后）：有的宝宝这几天特别能吃、格外黏人，通常 2–3 天自行过去，不用慌。' },
    { id: 'KN-G-4', scope: 'sleep', stage: 'baby', from: 178, to: 186, pillar: 'health', level: 'school', source: 'AAP',
      text: '猛长期窗口（满 6 个月前后）：吃奶变频繁、睡不踏实是常见表现，通常几天自行过去，按需喂就好。' },
    { id: 'KN-G-5', scope: 'sleep', stage: 'baby', from: 269, to: 277, pillar: 'health', level: 'school', source: 'AAP',
      text: '猛长期窗口（满 9 个月前后）：活动量上来了，有的宝宝吃得多、醒得勤，通常几天自行过去。' },

    /* ---- 第 75 次（C4+E 线）：经期页知识条目（scope 'period'，按产后场景挑选而非日龄过滤） ----
       出处：恶露与复潮 FH-HP/RM-EL；月经参数 FIGO-2018/MAYO-MC/妇产科学9。
       红线：只做中性科普与就医指路——不做排卵期/安全期推断、不做受孕概率。 */
    { id: 'KN-PER-1', scope: 'period', stage: 'any', from: null, to: null, pillar: 'health', level: 'consensus', source: 'FH-HP',
      text: '产后恶露参考：先是鲜红（约 1 周），转淡粉（2–3 周），再变白色渐净；顺产约 4–6 周排净，剖宫产约 3 周。' },
    { id: 'KN-PER-2', scope: 'period', stage: 'any', from: null, to: null, pillar: 'health', level: 'consensus', source: 'FH-HP',
      text: '恶露就医信号：超过 3 周淋漓不尽，或将净时突然变回鲜血、量增多——请及时就诊。' },
    { id: 'KN-PER-3', scope: 'period', stage: 'any', from: null, to: null, pillar: 'health', level: 'consensus', source: 'RM-EL',
      text: '产后首次月经可能偏多或偏少，经 2–3 个周期才逐渐规律——这是常见现象，不是身体出了问题。' },
    { id: 'KN-PER-4', scope: 'period', stage: 'any', from: null, to: null, pillar: 'health', level: 'consensus', source: 'RM-EL',
      text: '哺乳期月经不规律（几个月一次、量时多时少）属常见现象；只要符合「头 2–3 天最多、8 天内停」，通常不必担心。' },
    { id: 'KN-PER-5', scope: 'period', stage: 'any', from: null, to: null, pillar: 'health', level: 'consensus', source: 'RM-EL',
      text: '哺乳常识：来月经不等于有排卵，没来月经也不等于不排卵——哺乳期不是安全期，如有性生活请采取避孕措施。' },
    { id: 'KN-PER-6', scope: 'period', stage: 'any', from: null, to: null, pillar: 'nutrition', level: 'consensus', source: 'RM-EL',
      text: '哺乳期经期会加重铁流失，可适当多吃红肉、动物肝脏等富铁食物。' },
    { id: 'KN-PER-7', scope: 'period', stage: 'any', from: null, to: null, pillar: 'health', level: 'official', source: 'FIGO-2018',
      text: '月经参数参考：周期 24–38 天、经期 3–8 天属常见范围；明显超出且连续出现，建议就诊时带上记录。' }
  ];

  /* ---- 第 68 次（B2）：发育观察点数据 ----
     正向 =《3 岁以下婴幼儿心理行为发育标志自评表》（GJ-2025 附件 4，政府网原文），
     反向 =《儿童心理行为发育问题预警征象筛查表》（YJZX，国家基本公卫）。
     检查点 3/6/8/12/18/24/30/36 月龄；area：gm 大运动 / fm 精细动作 / lang 语言 /
     cog 认知 / soc 社会交往（预警条目跨能区，不标 area）。
     官方预警规则（原文）：自评表 1 项未出现 → 加强亲子交流并向医务人员寻求指导；
     2 项及以上 → 带婴幼儿到医疗机构进行相关检查；预警征象任何一条阳性 → 转诊。 */
  var CHECKPOINTS = [3, 6, 8, 12, 18, 24, 30, 36];
  var AREA_TXT = { gm: '大运动', fm: '精细动作', lang: '语言', cog: '认知', soc: '社交' };

  var MILESTONES = [
    /* 自评表 · 3 月龄 */
    { id: 'KN-O-3-1', m: 3, kind: 'obs', area: 'gm', text: '被竖抱时头可以稳稳地立着' },
    { id: 'KN-O-3-2', m: 3, kind: 'obs', area: 'fm', text: '可将放在手里的玩具握一会儿' },
    { id: 'KN-O-3-3', m: 3, kind: 'obs', area: 'lang', text: '和宝宝说话，能发出声音回应' },
    { id: 'KN-O-3-4', m: 3, kind: 'obs', area: 'cog', text: '能用眼睛寻找声源' },
    { id: 'KN-O-3-5', m: 3, kind: 'obs', area: 'soc', text: '对宝宝笑时，能用笑回应' },
    /* 6 月龄 */
    { id: 'KN-O-6-1', m: 6, kind: 'obs', area: 'gm', text: '可自己坐一会儿（允许手撑着地面）' },
    { id: 'KN-O-6-2', m: 6, kind: 'obs', area: 'fm', text: '能将玩具从一只手传递到另一只手' },
    { id: 'KN-O-6-3', m: 6, kind: 'obs', area: 'lang', text: '叫宝宝名字时，可以朝声音的方向转头' },
    { id: 'KN-O-6-4', m: 6, kind: 'obs', area: 'cog', text: '看到物品掉落能去找' },
    { id: 'KN-O-6-5', m: 6, kind: 'obs', area: 'soc', text: '能区分熟人和生人（如妈妈抱时高兴）' },
    /* 8 月龄 */
    { id: 'KN-O-8-1', m: 8, kind: 'obs', area: 'gm', text: '可腹部贴着床面爬行' },
    { id: 'KN-O-8-2', m: 8, kind: 'obs', area: 'fm', text: '两手拿小东西对敲' },
    { id: 'KN-O-8-3', m: 8, kind: 'obs', area: 'lang', text: '发出一连串重复的音节（如「lalala」「mamama」）' },
    { id: 'KN-O-8-4', m: 8, kind: 'obs', area: 'cog', text: '注意到物品上的细节（如衣服上的纽扣）' },
    { id: 'KN-O-8-5', m: 8, kind: 'obs', area: 'soc', text: '对陌生人有害怕等反应' },
    /* 12 月龄 */
    { id: 'KN-O-12-1', m: 12, kind: 'obs', area: 'gm', text: '（不扶东西）可自己站数秒以上' },
    { id: 'KN-O-12-2', m: 12, kind: 'obs', area: 'fm', text: '把小丸放进小瓶' },
    { id: 'KN-O-12-3', m: 12, kind: 'obs', area: 'lang', text: '听懂 1 个以上物品名（如问鞋在哪儿，会看向鞋）' },
    { id: 'KN-O-12-4', m: 12, kind: 'obs', area: 'cog', text: '模仿他人正在做的动作（如拍手）' },
    { id: 'KN-O-12-5', m: 12, kind: 'obs', area: 'soc', text: '对他人表情有反应（如看到妈妈不开心，也不高兴）' },
    /* 18 月龄 */
    { id: 'KN-O-18-1', m: 18, kind: 'obs', area: 'gm', text: '扶着墙或栏杆上楼梯' },
    { id: 'KN-O-18-2', m: 18, kind: 'obs', area: 'fm', text: '用手旋拧（如拧瓶盖、上发条）' },
    { id: 'KN-O-18-3', m: 18, kind: 'obs', area: 'lang', text: '说出 3 个有意义的词' },
    { id: 'KN-O-18-4', m: 18, kind: 'obs', area: 'cog', text: '知道常用物品用途（如杯子喝水、灯会亮）' },
    { id: 'KN-O-18-5', m: 18, kind: 'obs', area: 'soc', text: '与他人玩传球等互动游戏' },
    /* 24 月龄 */
    { id: 'KN-O-24-1', m: 24, kind: 'obs', area: 'gm', text: '双脚同时离地跳起' },
    { id: 'KN-O-24-2', m: 24, kind: 'obs', area: 'fm', text: '一页页地翻书' },
    { id: 'KN-O-24-3', m: 24, kind: 'obs', area: 'lang', text: '说简单的句子（如妈妈抱宝宝）' },
    { id: 'KN-O-24-4', m: 24, kind: 'obs', area: 'cog', text: '玩装扮游戏（如假装给娃娃喂饭）' },
    { id: 'KN-O-24-5', m: 24, kind: 'obs', area: 'soc', text: '主动示意大小便' },
    /* 30 月龄 */
    { id: 'KN-O-30-1', m: 30, kind: 'obs', area: 'gm', text: '双脚向前跳出一段距离' },
    { id: 'KN-O-30-2', m: 30, kind: 'obs', area: 'fm', text: '模仿大人画横线' },
    { id: 'KN-O-30-3', m: 30, kind: 'obs', area: 'lang', text: '回答简单问题（如答出自己的名字）' },
    { id: 'KN-O-30-4', m: 30, kind: 'obs', area: 'cog', text: '模仿他人用积木搭火车、小桥等' },
    { id: 'KN-O-30-5', m: 30, kind: 'obs', area: 'soc', text: '懂得轮流（如排队滑滑梯）' },
    /* 36 月龄 */
    { id: 'KN-O-36-1', m: 36, kind: 'obs', area: 'gm', text: '单脚站 5 秒以上' },
    { id: 'KN-O-36-2', m: 36, kind: 'obs', area: 'fm', text: '用绳穿扣子或串珠' },
    { id: 'KN-O-36-3', m: 36, kind: 'obs', area: 'lang', text: '讲简单故事说出大部分情节' },
    { id: 'KN-O-36-4', m: 36, kind: 'obs', area: 'cog', text: '理解时间（如现在、明天）' },
    { id: 'KN-O-36-5', m: 36, kind: 'obs', area: 'soc', text: '自己穿鞋子或袜子' },

    /* 预警征象（反向）：出现任何一条 = 阳性，官方规则为转诊筛查 */
    { id: 'KN-W-3-1', m: 3, kind: 'warn', text: '对很大声音没有反应' },
    { id: 'KN-W-3-2', m: 3, kind: 'warn', text: '逗引时不发音或不会微笑' },
    { id: 'KN-W-3-3', m: 3, kind: 'warn', text: '不注视人脸，不追视移动的人或物品' },
    { id: 'KN-W-3-4', m: 3, kind: 'warn', text: '俯卧时不会抬头' },
    { id: 'KN-W-6-1', m: 6, kind: 'warn', text: '发音少，不会笑出声' },
    { id: 'KN-W-6-2', m: 6, kind: 'warn', text: '不会伸手抓物' },
    { id: 'KN-W-6-3', m: 6, kind: 'warn', text: '紧握拳松不开' },
    { id: 'KN-W-6-4', m: 6, kind: 'warn', text: '不能扶坐' },
    { id: 'KN-W-8-1', m: 8, kind: 'warn', text: '听到声音无应答' },
    { id: 'KN-W-8-2', m: 8, kind: 'warn', text: '不会区分生人和熟人' },
    { id: 'KN-W-8-3', m: 8, kind: 'warn', text: '双手间不会传递玩具' },
    { id: 'KN-W-8-4', m: 8, kind: 'warn', text: '不会独坐' },
    { id: 'KN-W-12-1', m: 12, kind: 'warn', text: '呼唤名字无反应' },
    { id: 'KN-W-12-2', m: 12, kind: 'warn', text: '不会模仿「再见」或「欢迎」动作' },
    { id: 'KN-W-12-3', m: 12, kind: 'warn', text: '不会用拇食指对捏小物品' },
    { id: 'KN-W-12-4', m: 12, kind: 'warn', text: '不会扶物站立' },
    { id: 'KN-W-18-1', m: 18, kind: 'warn', text: '不会有意识叫「爸爸」或「妈妈」' },
    { id: 'KN-W-18-2', m: 18, kind: 'warn', text: '不会按要求指人或物' },
    { id: 'KN-W-18-3', m: 18, kind: 'warn', text: '与人无目光交流' },
    { id: 'KN-W-18-4', m: 18, kind: 'warn', text: '不会独走' },
    { id: 'KN-W-24-1', m: 24, kind: 'warn', text: '不会说 3 个物品的名称' },
    { id: 'KN-W-24-2', m: 24, kind: 'warn', text: '不会按照吩咐做简单的事情' },
    { id: 'KN-W-24-3', m: 24, kind: 'warn', text: '不会用勺吃饭' },
    { id: 'KN-W-24-4', m: 24, kind: 'warn', text: '不会扶栏上楼梯/台阶' },
    { id: 'KN-W-30-1', m: 30, kind: 'warn', text: '不会说 2-3 个字的短语' },
    { id: 'KN-W-30-2', m: 30, kind: 'warn', text: '兴趣单一、刻板' },
    { id: 'KN-W-30-3', m: 30, kind: 'warn', text: '不会示意大小便' },
    { id: 'KN-W-30-4', m: 30, kind: 'warn', text: '不会跑' },
    { id: 'KN-W-36-1', m: 36, kind: 'warn', text: '不会说自己的名字' },
    { id: 'KN-W-36-2', m: 36, kind: 'warn', text: '不会玩「过家家」等假想游戏' },
    { id: 'KN-W-36-3', m: 36, kind: 'warn', text: '不会模仿画圆' },
    { id: 'KN-W-36-4', m: 36, kind: 'warn', text: '不会双脚跳' }
  ];

  /* 查询：按 scope 取候选，多候选时按「天」轮换（同一天内稳定，跨天有新意）。
     home 返回条目对象（含 stage，供调用方拼个性化前缀），无匹配返回 null。
     任何异常都静默返回 null——知识句是锦上添花，绝不能影响页面渲染。 */
  function pick(scope, opts) {
    try {
      opts = opts || {};
      var day = Math.floor(Date.now() / 86400000);
      var cands = [];
      for (var i = 0; i < DATA.length; i++) {
        var e = DATA[i];
        if (e.scope !== scope) continue;
        if (scope === 'mind') { cands.push(e); continue; }
        if (opts.stage === 'pregnancy' && e.stage === 'pregnancy') {
          if (opts.wk >= e.from && opts.wk <= e.to) cands.push(e);
        } else if (opts.stage === 'baby' && e.stage === 'baby') {
          if (opts.ageDays >= e.from && opts.ageDays <= e.to) cands.push(e);
        }
      }
      if (!cands.length) return null;
      var hit = cands[day % cands.length];
      return { id: hit.id, text: hit.text, source: hit.source, level: hit.level, pillar: hit.pillar, stage: hit.stage };
    } catch (err) { return null; }
  }

  /* B6 底稿接口：全部条目与来源表（设置页「知识来源」直接消费） */
  function all(scope) {
    if (!scope) return DATA.slice();
    return DATA.filter(function (e) { return e.scope === scope; });
  }

  /* B2 观察点查询：按检查点月龄取自评条目与预警条目 */
  function milestoneAt(m) {
    var obs = [], warn = [];
    for (var i = 0; i < MILESTONES.length; i++) {
      var e = MILESTONES[i];
      if (e.m !== m) continue;
      (e.kind === 'obs' ? obs : warn).push(e);
    }
    return { obs: obs, warn: warn };
  }

  global.Knowledge = {
    pick: pick,
    all: all,
    SOURCES: SOURCES,
    LEVEL_TXT: LEVEL_TXT,
    PILLAR_TXT: PILLAR_TXT,
    CHECKPOINTS: CHECKPOINTS,
    AREA_TXT: AREA_TXT,
    MILESTONES: MILESTONES,
    milestoneAt: milestoneAt
  };
})(window);
