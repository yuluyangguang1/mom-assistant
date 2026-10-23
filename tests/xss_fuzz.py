#!/usr/bin/env python3
"""XSS 模糊测试（第 151 次）：把种子数据里每个非 id、非日期的字符串都拼上 HTML 注入载荷，
导入后逐页渲染、点开每页第一条记录（编辑弹窗）、跑一次搜索，统计页面里出现的注入节点。
用法：python3 tests/xss_fuzz.py   （0 处 = 通过）"""
import json, re, sys
sys.path.insert(0, __import__('os').path.dirname(__file__))
import regression as R  # 复用本地服务器、TABS、seed
from playwright.sync_api import sync_playwright

P = '"\'><i data-pwn></i><img src=x onerror="window.__pwn=1">'
DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?$')

def fuzz(v, k=''):
    if isinstance(v, dict):
        return {kk: fuzz(vv, kk) for kk, vv in v.items()}
    if isinstance(v, list):
        return [fuzz(x, k) for x in v]
    if isinstance(v, str) and not (k == 'id' or k.endswith('Id') or k == 'photo' or DATE_RE.match(v)):
        return v + P
    return v

def main():
    data = fuzz(dict(R.seed, version=3))
    # 种子只覆盖 7 个模块：给其余数组模块各造一条「所有常见文字字段都是载荷」的记录
    TXT = ['note', 'name', 'type', 'text', 'dish', 'ing', 'unit', 'dose', 'cat', 'category', 'side', 'level', 'title',
           'color', 'kind', 'label', 'flow', 'area', 'site', 'content', 'symptoms', 'tags', 'pain', 'size', 'key', 'sub']
    today = '2026-10-11'
    def rec(i):
        r = {k: P for k in TXT}
        r.update(id='z%d' % i, time=today + 'T09:00', start=today + 'T08:00', end=today + 'T08:30', date=today,
                 dueISO=today, amount=P, value=P, qty=P, price=P, minutes=P, planId='z0', tags=[P], symptoms=[P])
        return r
    for i, k in enumerate(['meds', 'milestones', 'milestoneObs', 'baths', 'swims', 'suns', 'waters', 'jaundices',
                           'supplements', 'supplementPlans', 'supplies', 'periods', 'contractions', 'fetal', 'moods',
                           'temps', 'growth', 'diapers', 'feedings', 'sleeps']):
        data[k] = list(data.get(k) or []) + [rec(i)]
    data['supplementPlans'][-1]['id'] = 'z0'
    data['pregnancy'] = {'lmp': '2026-03-01', 'dueDate': '2026-12-06', 'weights': [dict(rec(90), kg=P)]}
    data['prenatal'] = {'checks': [rec(91)], 'records': [rec(92)]}
    data['finance'] = {'records': [dict(rec(93), amount=P)]}
    data['packing'] = {'seeded': True, 'items': [dict(rec(94), checked=False, hint=P)]}
    data['vaccines'] = {'done': {'hepb-1': {'date': today, 'note': P, 'site': P}}}
    data['checkups'] = {'done': {'m1': {'date': today, 'note': P}}}
    # 日期字段也注入一份（另一条记录），验证格式化函数不会原样吐出非法日期
    for k in ('feedings', 'diapers', 'sleeps', 'meds', 'temps', 'growth', 'finance'):
        bad = dict(rec(200), time=P, start=P, end=P, date=P)
        (data[k]['records'] if k == 'finance' else data[k]).append(bad)
    data['settings']['caregiver'] = {'role': P, 'name': P}
    data['settings']['baby'] = {'nickname': P, 'name': P, 'sex': P, 'birthDate': '2026-05-20'}
    data.setdefault('settings', {})['privacyAccepted'] = True
    hits = {}
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        p = b.new_page(viewport={'width': 390, 'height': 844})
        errs = []
        p.on('pageerror', lambda e: errs.append(str(e)[:120]))
        p.goto(R.URL); p.wait_for_timeout(600)
        p.evaluate('t=>Storage.importJSON(t)', json.dumps(data, ensure_ascii=False))
        p.reload(); p.wait_for_timeout(700)
        count = "document.querySelectorAll('[data-pwn]').length + (window.__pwn?1000:0)"
        def note(where):
            n = p.evaluate(count)
            if n:
                hits[where] = n
                p.evaluate("document.querySelectorAll('[data-pwn]').forEach(e=>e.remove());window.__pwn=0")
        note('启动')
        for t in R.TABS:
            p.evaluate(f"App.showTab('{t}')"); p.wait_for_timeout(120); note(t)
            n = min(p.locator('#view .list li').count(), 6)  # 每页点前 6 条，覆盖编辑弹窗
            for i in range(n):
                li = p.locator('#view .list li').nth(i)
                try:
                    li.click(timeout=600); p.wait_for_timeout(120); note(t + ' 点开记录')
                except Exception:
                    pass
                p.evaluate("var m=document.getElementById('modalRoot');if(m)m.innerHTML=''")
                if p.evaluate("!document.querySelector('#view .list')"):
                    p.evaluate(f"App.showTab('{t}')"); p.wait_for_timeout(80)
        p.evaluate("App.showTab('search')"); p.wait_for_timeout(100)
        s = p.locator('input[type=search], #searchInput').first
        if s.count():
            s.fill('i'); p.wait_for_timeout(300); note('搜索结果')
        b.close()
    for k, v in hits.items():
        print('HIT', k, v)
    print('pageerror', errs[:5])
    print('总计', sum(hits.values()), '处')
    return 1 if hits else 0

if __name__ == '__main__':
    sys.exit(main())
