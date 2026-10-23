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
