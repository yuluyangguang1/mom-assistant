#!/usr/bin/env python3
"""第 284 次：生成 js/growth-std.js（生长参考值，内置、离线可用）。

数据来源（都是官方公开文件，脚本原样读取，不做任何改写）：
  WHO 儿童生长标准 0–5 岁，按月龄的百分位表（含 L / M / S 列）
    https://www.who.int/tools/child-growth-standards/standards
    - length-height-for-age: tab_lhfa_{boys,girls}_p_0_2.xlsx（0–23 月用身长）、tab_lhfa_{boys,girls}_p_2_5.xlsx（24–60 月用身高）
    - weight-for-age:        tab_wfa_{boys,girls}_p_0_5.xlsx
    - head-circumference:    tab_hcfa_{boys,girls}_p_0_5.xlsx
  国家卫生健康委 WS/T 423—2022《7 岁以下儿童生长标准》附录 A
    表 A.1/A.2 年龄别体重、A.3/A.4 年龄别身长/身高、A.11/A.12 0～3 岁年龄别头围（P3 P10 P25 P50 P75 P90 P97）
    https://www.nhc.gov.cn/wjw/c100311/202211/923e7646561d4b88b72da9097d4da4d5/files/1743494775650_75549.pdf
  只取 0–60 月龄（头围中国标准只有 0–36 月）。

用法：python tools/gen_growth_std.py /tmp/who /tmp/wst423.pdf  （先把上面的 xlsx / pdf 下载到本地）
需要 openpyxl 和 pdftotext（poppler-utils）。
"""
import json, re, subprocess, sys
from pathlib import Path
import openpyxl

who_dir = Path(sys.argv[1]); pdf = sys.argv[2]
OUT = Path(__file__).resolve().parent.parent / 'js' / 'growth-std.js'


def rows(name):
    ws = openpyxl.load_workbook(who_dir / name, data_only=True).active
    r = list(ws.iter_rows(values_only=True))
    hdr = r[0]
    return [dict(zip(hdr, x)) for x in r[1:] if x and x[0] is not None]


def lms(rs):
    return [[(lambda L: int(L) if L == int(L) else L)(round(float(x['L']), 4)), round(float(x['M']), 4), round(float(x['S']), 5)] for x in rs]


who = {}
check = {}
for sex, k in (('boy', 'boys'), ('girl', 'girls')):
    l02 = [x for x in rows(f'tab_lhfa_{k}_p_0_2.xlsx') if x['Month'] < 24]
    h25 = rows(f'tab_lhfa_{k}_p_2_5.xlsx')
    w = rows(f'tab_wfa_{k}_p_0_5.xlsx'); hc = rows(f'tab_hcfa_{k}_p_0_5.xlsx')
    hh = l02 + h25
    assert [x['Month'] for x in hh] == list(range(61)) and [x['Month'] for x in w] == list(range(61)) and [x['Month'] for x in hc] == list(range(61))
    who[sex] = {'h': lms(hh), 'w': lms(w), 'hc': lms(hc)}
    check[sex] = {m: [[x['P3'], x['P15'], x['P50'], x['P85'], x['P97']] for x in rs] for m, rs in (('h', hh), ('w', w), ('hc', hc))}

txt = subprocess.run(['pdftotext', '-layout', pdf, '-'], capture_output=True, text=True, check=True).stdout


def age_m(s):
    s = s.replace(' ', '')
    m = re.fullmatch(r'(?:(\d+)岁)?(?:(\d+)月)?', s)
    if not m or not (m.group(1) or m.group(2)):
        return None
    return int(m.group(1) or 0) * 12 + int(m.group(2) or 0)


def table(no):
    """表 A.no（含续表）里每行：年龄 + 7 个数。"""
    out = {}
    cur = None
    for ln in txt.splitlines():
        t = re.search(r'表\s*([A-Z])\.(\d+)', ln)
        if t:
            cur = int(t.group(2)) if t.group(1) == 'A' else None; continue
        if cur != no:
            continue
        m = re.match(r'^\s*([\d\s岁月]+?)\s+((?:\d+\.\d\s+){6}\d+\.\d)\s*$', ln)
        if m:
            a = age_m(m.group(1))
            if a is not None:
                out[a] = [float(v) for v in m.group(2).split()]
    return out


cn = {'pcts': [3, 10, 25, 50, 75, 90, 97]}
ages = None
for sex, (tw, th, thc) in (('boy', (1, 3, 11)), ('girl', (2, 4, 12))):
    W, H, HC = table(tw), table(th), table(thc)
    a60 = [a for a in sorted(W) if a <= 60]
    assert a60 == [a for a in sorted(H) if a <= 60], (sex, sorted(W), sorted(H))
    assert sorted(HC) == [a for a in a60 if a <= 36], (sex, sorted(HC))
    assert a60[:25] == list(range(25)) and a60[-1] == 60, a60
    ages = ages or a60
    assert ages == a60
    for tb in (W, H, HC):
        for a, v in tb.items():
            assert v == sorted(v), (sex, a, v)  # 百分位单调
    cn[sex] = {'w': [W[a] for a in a60], 'h': [H[a] for a in a60], 'hc': [HC[a] for a in a60 if a <= 36]}
cn['ages'] = ages

data = {
    'who': dict(who, src='WHO Child Growth Standards（0–5 岁，按月龄 L/M/S；0–23 月身长、24–60 月身高）'),
    'cn': dict(cn, src='WS/T 423—2022《7 岁以下儿童生长标准》附录 A（体重 / 身长身高 0–60 月，头围 0–36 月）'),
}
js = ('/* 第 284 次：生长参考值（由 tools/gen_growth_std.py 从官方公开表格生成，勿手改）。\n'
      ' * WHO：https://www.who.int/tools/child-growth-standards/standards（按月龄 [L, M, S]，0–60 月）\n'
      ' * 中国：国家卫生健康委 WS/T 423—2022 附录 A（P3 P10 P25 P50 P75 P90 P97，ages = 月龄）\n */\n'
      'window.GrowthStd = ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n')
OUT.write_text(js, encoding='utf-8')
Path('/tmp/who_check.json').write_text(json.dumps(check))
print(OUT, len(js.encode('utf-8')), 'bytes; cn ages', len(ages))
