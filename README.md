# 宝妈助手 (Mom Assistant)

孕期 / 育儿一站式记录 Web App。纯静态、零依赖、可离线运行（双击 `index.html` 即可）。

## 功能
- 喂养、睡眠、成长曲线、经期、孕期、待产包、宫缩、家庭财务等模块
- 「玻璃暖房」设计语言：液态玻璃卡片 + 全平台真折射（Chrome/Edge/Firefox/Safari）
- 本地存储，数据留在设备，不上传
- 皮肤 / 夜间模式 / 真实玻璃折射开关

## 运行
- 直接打开 `index.html`，或
- 访问线上版：https://yuluyangguang1.github.io/mom-assistant/

## 技术
纯 HTML / CSS / 原生 JS，无构建步骤。

---
yu.ai 出品

## 回归测试

```bash
pip install playwright && python -m playwright install chromium
python tests/regression.py   # 失败时退出码为 1
```

覆盖多宝宝隔离、导入导出、XSS 转义、首页计时/快记、疫苗补记、格式化层、窄屏列表、提示堆叠等。修一个 bug 就补一条断言。

### XSS 模糊测试

```bash
python3 tests/xss_fuzz.py   # 给所有文字和数值字段注入 HTML 载荷后逐页渲染，输出“总计 0 处”算通过
```


## 首页问候语怎么加

问候语都在 `js/greetings.js` 的 `LIB` 里，按「阶段 → 时段 → 句子数组」组织：

- 阶段：`preg1` 孕早期、`preg2` 孕中期、`preg3` 孕晚期、`due` 预产期前后 14 天、`newborn` 出生 0–28 天、`infant` 29–365 天、`toddler` 1 岁以上、`any` 通用句
- 时段：`late` 23–5 点、`dawn` 5–8 点、`morning` 8–11 点、`noon` 11–13 点、`afternoon` 13–18 点、`evening` 18–23 点
- 句子里写 `{who}` 会换成称呼，`{role}` 会换成「妈妈」或「爸爸」；没有称呼时「，{who}」会自动去掉
- 建议每句 12 个字以内（含称呼）
- 特殊日子写在 `special()` 里，命中后优先显示：出生当天、满月、百天、每月满月日、周岁、预产期当天、满 40 周、节日
- 同一天同一时段固定显示同一句，切页不会变
- 改完运行 `python3 tests/regression.py`，里面有一条断言会检查所有阶段和时段都有句子，并且没有残留的占位符
