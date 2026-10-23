#!/usr/bin/env python3
"""宝妈助手 · 回归测试（第 148 次起入库）

用法：
    pip install playwright && python -m playwright install chromium
    python tests/regression.py            # 全部跑一遍，失败时退出码为 1

覆盖第 146–148 次修过的问题：多宝宝隔离与迁移、导入导出往返、导入清洗、XSS 转义、
引导页生日提醒、首页计时与快记、疫苗一键补记、统一格式化层、360 宽列表不重叠、提示堆叠上限、
27 个页面零 pageerror。新修一个 bug，就在这里补一条断言。
"""
import functools
import http.server
import json
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from seed_data import seed  # noqa: E402

TABS = ['bath', 'calendar', 'contraction', 'diaper', 'feeding', 'fetal', 'finance', 'growth', 'home',
        'jaundice', 'meds', 'milestone', 'mood', 'packing', 'period', 'pregnancy', 'search', 'settings',
        'sleep', 'sun', 'supplement', 'supplies', 'swim', 'temp', 'vaccine', 'water', 'whitenoise']


class _Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(_Quiet, directory=str(ROOT)))
PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f'http://127.0.0.1:{PORT}/index.html'
SEED_V3 = json.dumps(dict(seed, version=3), ensure_ascii=False)

results = []


def check(name, cond, detail=''):
    results.append((name, bool(cond), detail))


def fresh(browser, w=390, h=844, seeded=True):
    p = browser.new_page(viewport={'width': w, 'height': h})
    errs = []
    p.on('pageerror', lambda e: errs.append(str(e)[:160]))
    p.goto(URL)
    p.wait_for_timeout(700)
    if seeded:
        p.evaluate('t=>Storage.importJSON(t)', SEED_V3)
        p.reload()
        p.wait_for_timeout(700)
    return p, errs


def test_data(b):
    p, errs = fresh(b)
    g = lambda: p.evaluate("""(()=>{const d=Storage.get();return {v:d.version,f:d.feedings.length,g:d.growth.length,
        vd:Object.keys(d.vaccines.done).length,mood:d.moods.length,act:d.settings.activeBabyId}})()""")
    A = g()
    check('迁移到数据版本 4', A['v'] == 4, A)
    p.evaluate("Storage.get().vaccines.done['hepb1']='2026-05-21';Storage.save()")
    idB = p.evaluate("Storage.addBaby({name:'二宝',birthDate:'2026-10-01'}).id")
    idA = p.evaluate('Storage.get().babies[0].id')
    B = g()
    check('新宝宝记录为空', B['f'] == 0 and B['g'] == 0 and B['vd'] == 0, B)
    check('妈妈的数据两个宝宝共用', B['mood'] == A['mood'])
    p.evaluate("Storage.get().feedings.push({id:'bf1',start:'2026-10-22T08:00:00',type:'bottle',amount:60});Storage.save()")
    p.reload(); p.wait_for_timeout(600)
    check('刷新后保持当前宝宝与记录', g()['f'] == 1 and g()['act'] == idB)
    p.evaluate(f"Storage.switchBaby('{idA}')")
    check('切回大宝记录完整', g()['f'] == A['f'] and g()['vd'] == A['vd'] + 1)
    e1 = p.evaluate('Storage.exportJSON()')
    p.evaluate('t=>Storage.importJSON(t)', e1)
    check('导入导出往返一致', json.loads(e1) == json.loads(p.evaluate('Storage.exportJSON()')))
    for bid in (idA, idB):
        p.evaluate(f"Storage.switchBaby('{bid}')")
        for t in TABS:
            p.evaluate(f"App.showTab('{t}')"); p.wait_for_timeout(40)
    p.evaluate(f"Storage.switchBaby('{idB}');Storage.removeBaby('{idB}')")
    check('删除当前宝宝后载入另一个', g()['f'] == A['f'] and g()['act'] == idA)
    # 安全
    p.evaluate('t=>Storage.importJSON(t)', SEED_V3)
    p.evaluate("Storage.get().meds.push({id:'m1',name:'退烧药 <b id=pwnB>5ml',time:Util.nowLocal(),note:null});Storage.save();App.showTab('meds')")
    p.wait_for_timeout(300)
    check('药名 HTML 被转义', p.evaluate("!document.querySelector('#pwnB')"))
    n = p.evaluate("t=>{Storage.importJSON(t);return Storage.get().feedings[0].note.length}",
                   json.dumps({'feedings': [{'id': 'h', 'start': '2026-10-01T01:00', 'note': '啊' * 200000}]}))
    check('导入字段截到 500 字', n == 500, n)
    r = p.evaluate("""()=>{Storage.importJSON(JSON.stringify({version:4,babies:[{id:'x1',name:'a'},{id:'x2',name:'b',
        rec:{feedings:'bad',sleeps:[{id:'s',start:'zz'}],periods:[{id:'p'}]}}],settings:{activeBabyId:'x1'}}));
        Storage.switchBaby('x2');const d=Storage.get();return {f:d.feedings.length,s:d.sleeps.length,leak:d.periods.length}}""")
    check('嵌套 rec 被清洗', r == {'f': 0, 's': 0, 'leak': 0}, r)
    # 第 150 次：恶意 id 不得逃逸 HTML 属性
    bad = '" onmouseover="window.__pwn=1" x="'
    badb = "'><img src=x onerror=window.__pwn=1>"
    now = p.evaluate("Util.nowLocal()")
    payload = {'version': 4,
               'settings': {'privacyAccepted': True, 'activeBabyId': badb},
               'babies': [{'id': badb, 'name': 'A'}, {'id': 'okB', 'name': 'B'}],
               'feedings': [{'id': bad, 'start': now, 'type': 'formula', 'amount': 90}],
               'sleeps': [{'id': bad, 'start': now, 'end': now}],
               'diapers': [{'id': bad, 'time': now, 'type': 'pee'}],
               'meds': [{'id': bad, 'name': 'x', 'time': now}],
               'temps': [{'id': bad, 'time': now, 'value': 37}],
               'supplementPlans': [{'id': bad, 'name': 'AD', 'active': True}],
               'supplements': [{'id': 'ok-1', 'planId': bad, 'time': now}],
               'vaccines': {'<img src=x onerror=window.__pwn=1>': {'date': '2026-01-01'}}}
    r = p.evaluate("t=>{Storage.importJSON(t);const d=Storage.get();return {f:d.feedings[0].id,plan:d.supplementPlans[0].id,"
                   "ref:d.supplements[0].planId,okId:d.supplements[0].id,bid:d.babies[0].id,act:d.settings.activeBabyId,"
                   "vk:Object.keys(d.vaccines||{}).length}}", json.dumps(payload))
    import re as _re
    check('非法 id 被改写为安全字符', all(_re.fullmatch(r'[A-Za-z0-9_.:-]{1,64}', r[k]) for k in ('f', 'plan', 'bid', 'act')), r)
    check('改写后引用关系不断', r['ref'] == r['plan'] and r['act'] == r['bid'], r)
    check('合法 id 原样保留', r['okId'] == 'ok-1', r)
    check('含 HTML 字符的键名被丢弃', r['vk'] == 0, r)
    for t in TABS:
        p.evaluate(f"App.showTab('{t}')"); p.wait_for_timeout(60)
        p.evaluate("document.querySelectorAll('[onmouseover]').forEach(e=>e.dispatchEvent(new MouseEvent('mouseover')))")
    check('恶意 id 在各页都不执行', p.evaluate("!window.__pwn && !document.querySelector('[onmouseover],img[src=\"x\"]')"))
    check('数据测试无 pageerror', not errs, errs)
    p.close()


def test_flows(b):
    p, errs = fresh(b, seeded=False)
    nudged = False
    for _ in range(6):
        if p.locator('[data-stage="baby"]').count():
            p.click('[data-stage="baby"]')
        if p.locator('#obBirth').count():
            check('引导生日用原生日期框', p.get_attribute('#obBirth', 'type') == 'date')
            p.click('[data-ob="next"]'); p.wait_for_timeout(200)
            nudged = p.is_visible('#obBirthNudge')
            p.fill('#obBirth', '2026-05-20')
        btn = p.locator('[data-ob="next"],[data-ob="done"]').first
        if not btn.count():
            break
        btn.click(); p.wait_for_timeout(250)
    check('未填生日先提醒一次', nudged)
    check('引导保存了生日', p.evaluate("(Storage.get().settings.baby||{}).birthDate") == '2026-05-20')

    p.evaluate('t=>Storage.importJSON(t)', SEED_V3); p.reload(); p.wait_for_timeout(800)
    p.click('.hn-q[data-recsl="start"]'); p.wait_for_timeout(1300)
    check('首页首屏可见计时条', p.evaluate("document.querySelector('.hn-run').getBoundingClientRect().bottom<innerHeight"))
    check('快记在首屏', p.evaluate("document.querySelector('.hn-quick').getBoundingClientRect().bottom<innerHeight-70"))
    n0 = p.evaluate('Storage.get().diapers.length'); p.click('.hn-q[data-hnq="pee"]'); p.wait_for_timeout(200)
    check('快记「尿了」+1', p.evaluate('Storage.get().diapers.length') - n0 == 1)
    s0 = p.evaluate('Storage.get().sleeps.length'); p.click('.hn-end'); p.wait_for_timeout(200)
    check('首页结束睡眠', p.evaluate('Storage.get().sleeps.length') - s0 == 1 and not p.evaluate('Storage.get().openSleep'))
    p.evaluate("App.showTab('vaccine')"); p.wait_for_timeout(400)
    v0 = p.evaluate('Object.keys(Storage.get().vaccines.done).length')
    if p.locator('#vBackfill').count():
        p.click('#vBackfill'); p.wait_for_timeout(200); p.click('[data-cfm-ok]'); p.wait_for_timeout(300)
    check('疫苗一键补记', p.evaluate('Object.keys(Storage.get().vaccines.done).length') > v0)
    check('流程测试无 pageerror', not errs, errs)
    p.close()


def test_format(b):
    p, errs = fresh(b, seeded=False)
    r = p.evaluate("""(()=>{const H=3600000,n=Date.now();return {
        d:Util.fmtDuration(260*H+5*60000), g:Util.fmtGap(260*H), a:Util.fmtAgo(new Date(n-20*60000)),
        old:Util.fmtAgo(new Date(n-10*24*H)), r:Util.fmtRange('2026-10-11T13:00:00','2026-10-11T14:20:00')}})()""")
    check('时长满 24 小时写成天', r['d'] == '10天20小时', r['d'])
    check('距上次写成天', r['g'] == {'num': '10', 'unit': '天'}, r['g'])
    check('相对时间：分钟前', r['a'] == '20 分钟前', r['a'])
    check('相对时间：N 天前', r['old'] == '10 天前', r['old'])
    check('同日时段紧凑写法', r['r'] == '10-11 13:00–14:20', r['r'])
    p.close()


def test_home_edit(b):
    """第 168 次：进入编辑首页不能把隐藏模块全铺出来；编辑后被收起的模块也不能补回首页。"""
    p, errs = fresh(b, 393, 852)
    ids = lambda: p.evaluate("[...document.querySelectorAll('.record-grid [data-go]')].map(e=>e.dataset.go).join(',')")
    auto = ids()
    p.evaluate("Modules.home._edit=true;App.rerender()"); p.wait_for_timeout(300)
    edit = ids()
    check('编辑画布 = 首页当前显示的模块', edit == auto, (auto, edit))
    p.evaluate("Modules.home._editSize('feeding');Modules.home._edit=false;App.rerender()"); p.wait_for_timeout(300)
    check('编辑一次后首页模块不增加', ids() == auto, ids())
    check('编辑首页无报错', not errs, errs)
    p.close()


def test_css_rules(b):
    """第 169 次（样式整理）：几条设计规范的静态守卫，见「设计规范.md」。"""
    import re, glob
    css = open(ROOT / 'css' / 'styles.css', encoding='utf-8').read()
    nc = re.sub(r'/\*.*?\*/', '', css, flags=re.S)
    # 1. 圆角只用变量（50%、0、≤3px 的细节圆角除外）
    raw = [v for v in re.findall(r'border-radius:\s*([^;}]+)', nc)
           if not re.fullmatch(r'(var\([^)]*\)\s*)+|50%|0|inherit|[0-3](\.\d+)?px', v.strip())
           and 'var(' not in v]
    check('圆角统一走 --radius-* 变量', not raw, raw[:5])
    # 2. 顶栏不得再 sticky/fixed（iOS 会给它加系统模糊、切页残留横带，第 168 次）
    hdr = [m for m in re.findall(r'([^{}]*\.app-header[^{}]*)\{([^{}]*)\}', nc)
           if re.search(r'position:\s*(sticky|fixed)', m[1])]
    check('顶栏不 sticky / fixed', not hdr, [h[0].strip()[:60] for h in hdr])
    # 3. 没有死样式：CSS 里出现的类名都要在 JS/HTML 里找得到（动态拼接的前缀除外）
    code = ''.join(open(f, encoding='utf-8').read() for f in glob.glob(str(ROOT / 'js' / '**' / '*.js'), recursive=True) + [str(ROOT / 'index.html')])
    DYN = ('lv', 'theme-card--', 'toast-', 'ob-in-')
    cls = set(re.findall(r'\.([a-zA-Z_][\w-]*)', re.sub(r'url\([^)]*\)|\d\.\d+', '', nc)))
    dead = sorted(c for c in cls if not c.startswith(DYN)
                  and not re.search(r'(?<![\w-])' + re.escape(c) + r'(?![\w-])', code))
    check('CSS 无死类名', not dead, dead[:8])
    # 4. 第 171 次：同一作用域（顶层或同一 @media）内同名选择器只写一处。
    #    .view / .home-sky 的后段覆盖与中间的 @media 有先后依赖，合并会改变结果，留作白名单。
    import collections
    seen = collections.Counter(); stack = []; buf = ''
    for t in re.findall(r'[{}]|[^{}]+', nc):
        if t == '{': stack.append(buf.strip()); buf = ''
        elif t == '}':
            sel = stack.pop() if stack else ''
            if not sel.startswith('@') and all(x.startswith('@media') for x in stack):
                seen[('|'.join(stack), sel)] += 1
            buf = ''
        else: buf = t
    dup = [k[1] for k, v in seen.items() if v > 1 and k[1] not in ('.view', '.home-sky')]
    check('CSS 无重复选择器', not dup, dup[:6])
    # 5. 第 172 次：左侧强调条不再用 inset 阴影（会顺着圆角弯成月牙），统一走 ::before 直条（--bar-c）
    bent = re.findall(r'box-shadow:[^;]*inset\s+[2-6]px\s+0\s+0', nc)
    check('左边条不用 inset 阴影', not bent, bent[:3])


def test_layout_and_toast(b):
    p, errs = fresh(b, 360, 740)
    bad = {}
    for t in TABS:
        p.evaluate(f"App.showTab('{t}')"); p.wait_for_timeout(120)
        n = p.evaluate("""(()=>{let n=0;document.querySelectorAll('#view .list li').forEach(li=>{
            const k=[...li.children].filter(e=>e.getBoundingClientRect().width>0);
            for(let i=0;i<k.length;i++)for(let j=i+1;j<k.length;j++){const a=k[i].getBoundingClientRect(),b=k[j].getBoundingClientRect();
              if(a.left<b.right-1&&b.left<a.right-1&&a.top<b.bottom-1&&b.top<a.bottom-1)n++}});return n})()""")
        if n:
            bad[t] = n
    check('360 宽列表行内无重叠', not bad, bad)
    # 第 152 次：滚到底后，页面最后的内容不能被底栏挡住（设置页展开全部分组；收起的 <details> 内容不计）
    covered = {}
    for t in TABS:
        p.evaluate(f"App.showTab('{t}')"); p.wait_for_timeout(120)
        p.evaluate("document.querySelectorAll('#view details').forEach(d=>d.open=true)")
        p.evaluate("document.scrollingElement.scrollTop=1e7"); p.wait_for_timeout(150)
        hit = p.evaluate("""(()=>{const bar=document.querySelector('.tabbar');if(!bar)return [];const br=bar.getBoundingClientRect();const o=[];
            document.querySelectorAll('#view *').forEach(e=>{if(e.children.length)return;const d=e.closest('details');if(d&&!d.open&&!e.closest('summary'))return;
              const b=e.getBoundingClientRect();if(b.width&&b.height&&b.bottom>br.top+1&&b.top<br.bottom&&getComputedStyle(e).visibility!=='hidden')o.push((e.textContent||e.tagName).trim().slice(0,12))});return o})()""")
        if hit:
            covered[t] = hit[:3]
    check('360 宽滚到底无内容被底栏遮挡', not covered, covered)
    r = p.evaluate("""(()=>{for(let i=0;i<6;i++)Util.toast('提示'+i);Util.toast('同一句');Util.toast('同一句');
        return [...document.querySelectorAll('#toastRoot .toast:not(.leaving)')].map(e=>e.textContent)})()""")
    check('同屏提示最多 2 条且同文案不重复', len(r) <= 2 and r.count('同一句') == 1, r)
    r = p.evaluate("""(()=>{Util.toast('已删除','ok',{label:'撤销',onClick(){}});Util.toast('甲');Util.toast('乙');
        return [...document.querySelectorAll('#toastRoot .toast:not(.leaving)')].map(e=>e.textContent)})()""")
    check('带撤销的提示优先保留', any('撤销' in x for x in r), r)
    r = p.evaluate("""(()=>{const G=window.Greetings;const bad=[];let n=0;
        const cases=[{ageDays:5},{ageDays:156},{ageDays:500},{pregWeek:8},{pregWeek:20},{pregWeek:33,dueLeft:50},{pregWeek:39,dueLeft:5},{}];
        for(const c of cases)for(let h=0;h<24;h++)for(const who of ['豆豆妈','']){const o=Object.assign({now:new Date(2026,9,23,h),who,role:'妈妈'},c);
          const a=G.pick(o).text,b=G.pick(o).text;n++;if(a!==b||/[{}]/.test(a)||!a||a.length>13||/^，|，$/.test(a))bad.push(h+':'+a)}
        return {n,bad:bad.slice(0,5),ms:G.pick({ageDays:30,who:'x'}).text}})()""")
    check('问候语：阶段×时段全覆盖、同日同时段稳定、无残留占位符', not r['bad'] and '满月' in r['ms'], r)
    check('布局测试无 pageerror', not errs, errs)
    p.close()


def main():
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        for fn in (test_data, test_flows, test_format, test_home_edit, test_css_rules, test_layout_and_toast):
            try:
                fn(b)
            except Exception as e:  # 一组崩了不影响其他组
                check(fn.__name__ + ' 运行', False, repr(e)[:200])
        b.close()
    fails = [r for r in results if not r[1]]
    for name, ok, detail in results:
        print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else f'  ← {detail}'))
    print(f'\n{len(results) - len(fails)}/{len(results)} 通过')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
