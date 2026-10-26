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

TABS = ['bath', 'bottle', 'breast', 'calendar', 'contraction', 'diaper', 'feeding', 'fetal', 'finance', 'growth', 'home',
        'jaundice', 'meds', 'milestone', 'mood', 'packing', 'period', 'pregnancy', 'search', 'settings',
        'sleep', 'solid', 'sun', 'supplement', 'supplies', 'swim', 'temp', 'vaccine', 'water', 'whitenoise']


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


def _poll(p, expr, timeout_ms, step=150):
    """第 275 次：代替 page.wait_for_function（它轮询时在页面里 eval，会被 CSP 拦下）。"""
    n = 0
    while n < timeout_ms:
        if p.evaluate(expr):
            return True
        p.wait_for_timeout(step); n += step
    return False


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
    check('dock 上方出现「正在进行」胶囊', p.evaluate("(()=>{const e=document.getElementById('dockLive');return !!e&&!e.hidden&&e.getBoundingClientRect().bottom<innerHeight&&/睡眠/.test(e.textContent)})()"))
    check('快记在首屏', p.evaluate("document.querySelector('.hn-quick').getBoundingClientRect().bottom<innerHeight-70"))
    n0 = p.evaluate('Storage.get().diapers.length'); p.click('.hn-q[data-hnq="pee"]'); p.wait_for_timeout(200)
    check('快记「尿了」+1', p.evaluate('Storage.get().diapers.length') - n0 == 1)
    # 第 272 次：不到 1 分钟的睡眠不存（审计 #1），这里把入睡时间挪到 5 分钟前
    p.evaluate("(()=>{const d=Storage.get(),t=new Date(Date.now()-300000),z=n=>String(n).padStart(2,'0');d.openSleep.start=t.getFullYear()+'-'+z(t.getMonth()+1)+'-'+z(t.getDate())+'T'+z(t.getHours())+':'+z(t.getMinutes())+':'+z(t.getSeconds());Storage.save()})()")
    s0 = p.evaluate('Storage.get().sleeps.length'); p.click('#dockLive [data-act="sleep-end"]'); p.wait_for_timeout(200)
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
        HIT_JS = """(()=>{const bar=document.querySelector('.tabbar');if(!bar)return [];const br=bar.getBoundingClientRect();const o=[];
            document.querySelectorAll('#view *').forEach(e=>{if(e.children.length)return;const d=e.closest('details');if(d&&!d.open&&!e.closest('summary'))return;
              const b=e.getBoundingClientRect();if(b.width&&b.height&&b.bottom>br.top+1&&b.top<br.bottom&&getComputedStyle(e).visibility!=='hidden')o.push((e.textContent||e.tagName).trim().slice(0,12))});return o})()"""
        hit = p.evaluate(HIT_JS)
        if hit:  # 第 277 次：八组并行时偶发页面进场 / 高度还在变，补滚一次再量（断言不变）
            p.wait_for_timeout(500); p.evaluate("document.scrollingElement.scrollTop=1e7"); p.wait_for_timeout(250)
            hit = p.evaluate(HIT_JS)
        if hit:
            covered[t] = hit[:3]
    check('360 宽滚到底无内容被底栏遮挡', not covered, covered)
    r = p.evaluate("""(()=>{for(let i=0;i<6;i++)Util.toast('提示'+i);Util.toast('同一句');Util.toast('同一句');
        return [...document.querySelectorAll('#toastRoot .toast:not(.leaving)')].map(e=>e.textContent)})()""")
    # 第 277 次：提示岛同屏只有一颗；同一句合并成「×2」（原来是同屏 ≤2 条、同文案只留一条）
    check('同屏提示最多 2 条且同文案不重复', len(r) <= 1 and r and r[0].startswith('同一句') and '×2' in r[0], r)
    r = p.evaluate("""(()=>{Util.toast('已删除','ok',{label:'撤销',onClick(){}});Util.toast('甲');Util.toast('乙');
        return [...document.querySelectorAll('#toastRoot .toast:not(.leaving)')].map(e=>e.textContent)})()""")
    # 第 277 次：带撤销的提示被普通提示顶掉时垫在下面，普通提示走完（2.8 秒）再回来——撤销入口不丢
    p.wait_for_timeout(3100)
    r2 = p.evaluate("[...document.querySelectorAll('#toastRoot .toast:not(.leaving)')].map(e=>e.textContent)")
    check('带撤销的提示优先保留', r == ['乙'] and any('撤销' in x for x in r2), [r, r2])
    r = p.evaluate("""(()=>{const G=window.Greetings;const bad=[];let n=0;
        const cases=[{ageDays:5},{ageDays:156},{ageDays:500},{pregWeek:8},{pregWeek:20},{pregWeek:33,dueLeft:50},{pregWeek:39,dueLeft:5},{}];
        for(const c of cases)for(let h=0;h<24;h++)for(const who of ['豆豆妈','']){const o=Object.assign({now:new Date(2026,9,23,h),who,role:'妈妈'},c);
          const a=G.pick(o).text,b=G.pick(o).text;n++;if(a!==b||/[{}]/.test(a)||!a||a.length>13||/^，|，$/.test(a))bad.push(h+':'+a)}
        return {n,bad:bad.slice(0,5),ms:G.pick({ageDays:30,who:'x'}).text}})()""")
    check('问候语：阶段×时段全覆盖、同日同时段稳定、无残留占位符', not r['bad'] and '满月' in r['ms'], r)
    check('布局测试无 pageerror', not errs, errs)
    p.close()


def test_family(b):
    """第 220–222 次：二胎孕期、孕期结束判定、多宝宝记录隔离与「两个都记」。"""
    p, errs = fresh(b)
    ev = p.evaluate
    ev("(()=>{const d=Storage.get();d.settings.baby.birthDate='2026-05-20';d.pregnancy.lmp=Util.addDays(Util.todayISO(),-85);d.pregnancy.dueDate=null;d.settings.stage='pregnancy';Storage.save();App.showTab('home')})()")
    p.wait_for_timeout(300)
    check('二胎孕期：识别为 dual', ev("App.isDualStage(Storage.get())"))
    txt = ev("document.getElementById('view').innerText")
    check('二胎孕期：首页同时有孕期与大宝快记', ('孕期' in txt) and ('尿了' in txt), txt[:200])
    a_feeds = ev("Storage.get().feedings.length")
    ev("Storage.addBaby({name:'二宝',birthDate:Util.todayISO()})")
    check('二宝出生：孕期自动结束、回到育儿期', ev("App.pregnancyWeekOf(Storage.get())===null && App.stageOf(Storage.get())==='baby'"))
    check('二宝出生：新宝宝记录从空白开始', ev("Storage.get().feedings.length") == 0)
    ev("App.showTab('home')"); p.wait_for_timeout(200)
    cnt = "Storage.get().babies.map(x=>x.id===Storage.get().settings.activeBabyId?Storage.get().diapers.length:((x.rec||{}).diapers||[]).length).join(',')"
    before = ev(cnt)
    p.click('[data-qtgt="all"]'); p.wait_for_timeout(150); p.click('[data-hnq="pee"]'); p.wait_for_timeout(200)
    after = ev(cnt)
    check('两个都记：每个宝宝各 +1', [int(x) + 1 for x in before.split(',')] == [int(x) for x in after.split(',')], (before, after))
    ev("Storage.switchBaby(Storage.get().babies[0].id)")
    check('切回大宝：喂养记录完好', ev("Storage.get().feedings.length") == a_feeds)
    check('多宝宝流程无报错', not errs, errs)
    p.close()


GEN_RECENT = """(()=>{const d=Storage.get();const p=n=>String(n).padStart(2,'0');
const f=t=>{const x=new Date(t);return x.getFullYear()+'-'+p(x.getMonth()+1)+'-'+p(x.getDate())+'T'+p(x.getHours())+':'+p(x.getMinutes())};
const now=Date.now();d.feedings=[];d.sleeps=[];
for(let h=2;h<170;h+=2.8){const t=now-h*3600e3;const ty=['breast','bottle','formula'][Math.floor(h)%3];d.feedings.push({id:'f'+h,type:ty,start:f(t),amount:ty=='breast'?null:90,durationMin:ty=='breast'?15:null,side:ty=='breast'?'left':null});}
for(let h=1;h<170;h+=4.3){const e=now-h*3600e3,s=e-(1+(h%3))*3600e3;d.sleeps.push({id:'s'+h,start:f(s),end:f(e),pausedMs:0,wakings:0});}
Storage.save();})()"""


def test_dash(b):
    """第 223 次：喂养/睡眠页今日看板——时间轴、近 7 天柱、进行中的觉、照护日 6 点切日。"""
    p, errs = fresh(b)
    ev = p.evaluate
    ev(GEN_RECENT)
    ev("App.showTab('feeding')"); p.wait_for_timeout(250)
    check('喂养看板：有时间轴和 7 根柱', ev("!!document.querySelector('.dash-card .dc-strip') && document.querySelectorAll('.dash-card .dc-bar').length===7"))
    check('喂养看板：今天的点数 = 今日次数', ev("document.querySelectorAll('.dash-card .dc-dot').length") == ev("+document.querySelector('.dash-chips b').textContent"))
    ev("(()=>{const d=Storage.get();d.openSleep={id:'live',start:new Date(Date.now()-50*60e3).toISOString().slice(0,16),pausedMs:0,pauseStart:null};Storage.save();App.showTab('sleep')})()"); p.wait_for_timeout(250)
    check('睡眠看板：进行中的觉画成虚段', ev("!!document.querySelector('.dash-card .dc-span.live')"))
    ev("(()=>{const d=Storage.get();d.openSleep=null;d.settings.dayStart=6;Storage.save();App.showTab('sleep')})()"); p.wait_for_timeout(250)
    check('照护日 6 点：时间轴从 06 起', ev("document.querySelector('.dc-ticks span').textContent") == '06')
    check('看板无报错', not errs, errs)
    p.close()


def test_diaper_sheet(b):
    """第 224 次：尿布页新骨架——底部按钮开半屏、不选类型不保存、选项落库、点时间轴修改、删除可撤销、坏类型不进类名。"""
    p, errs = fresh(b)
    ev = p.evaluate
    ev("App.showTab('diaper')"); p.wait_for_timeout(250)
    n0 = ev("Storage.get().diapers.length")
    p.click('[data-new]'); p.wait_for_timeout(250)
    check('尿布：底部按钮打开半屏记录', ev("!!document.querySelector('#modalRoot .rec-sheet')"))
    p.click('.rs-save'); p.wait_for_timeout(150)
    check('尿布：没选类型不保存', ev("Storage.get().diapers.length") == n0)
    check('尿布：尿尿不显示便便颜色', ev("!document.querySelector('.dp-colors')"))
    p.click('.dp-type[data-t="poop"]'); p.click('[data-amt="lot"]'); p.click('.dp-col[data-col="green"]'); p.click('[data-cons="mushy"]')
    p.fill('#dpsNote', '测试备注'); p.click('.rs-save'); p.wait_for_timeout(1000)
    r = ev("JSON.stringify(Storage.get().diapers.slice(-1)[0])")
    check('尿布：选项与备注落库', ev("Storage.get().diapers.length") == n0 + 1 and all(x in r for x in ['"poop"', '"lot"', '"green"', '"mushy"', '测试备注']), r)
    rid = ev("Storage.get().diapers.slice(-1)[0].id")
    p.click(f'[data-open="{rid}"]'); p.wait_for_timeout(250)
    check('尿布：点时间轴打开修改面板并带出原值', ev("document.querySelector('.dp-type.on').dataset.t==='poop' && document.querySelector('.dp-col.on').dataset.col==='green'"))
    p.click('.dp-type[data-t="pee"]'); p.click('.rs-save'); p.wait_for_timeout(1000)
    r2 = ev("JSON.stringify(Storage.get().diapers.filter(x=>x.id==='" + rid + "')[0])")
    check('尿布：改成尿尿后清掉颜色/性状', '"pee"' in r2 and 'green' not in r2 and 'mushy' not in r2 and ev("Storage.get().diapers.length") == n0 + 1, r2)
    ev("(()=>{const d=Storage.get();d.diapers.push({id:'badty',type:'x y<b>',time:Util.nowLocal(),note:null});Storage.save();App.showTab('diaper')})()"); p.wait_for_timeout(250)
    check('尿布：坏类型不进类名', ev("!document.querySelector('#view [class*=\"<\"]') && !document.getElementById('view').innerHTML.includes('x y')"))
    check('尿布流程无报错', not errs, errs)
    p.close()


def test_diaper_stock(b):
    """第 226 次：换尿布扣减用品——记录扣 1、改记录取消退回、删除退回且撤销再扣、快记按偏好扣、没片数的老用品不参与、导入坏偏好被清洗。"""
    p, errs = fresh(b)
    ev = p.evaluate
    ev("""(()=>{const d=Storage.get();d.supplies=d.supplies||[];
      d.supplies.push({id:'dpS',name:'纸尿裤 S',cat:'纸尿裤',date:Util.todayISO(),price:0,availDays:0,qty:2,unit:'包',pieces:50,history:[]});
      d.supplies.push({id:'wipe1',name:'湿巾',cat:'清洁',date:Util.todayISO(),price:0,availDays:0,qty:1,unit:'包',pieces:80,history:[]});
      d.supplies.push({id:'old1',name:'老纸尿裤',cat:'纸尿裤',date:Util.todayISO(),price:0,availDays:30,qty:1,unit:'包',history:[]});
      delete d.settings.diaperStock;Storage.save();App.showTab('diaper')})()""")
    p.wait_for_timeout(250)
    pcs = lambda i: ev(f"Storage.get().supplies.filter(x=>x.id==='{i}')[0].pieces")
    p.click('[data-new]'); p.wait_for_timeout(250)
    check('扣减：有片数的用品默认开、默认选纸尿裤', ev("document.querySelector('[data-usesw]').getAttribute('aria-checked')==='true' && !!document.querySelector('.rs-stock-item.on[data-use=\"dpS\"]')"))
    check('扣减：没填片数的老用品不出现', ev("!document.querySelector('[data-use=\"old1\"]')"))
    p.click('[data-use="wipe1"]'); p.click('.dp-type[data-t="pee"]'); p.click('.rs-save'); p.wait_for_timeout(1000)
    rid = ev("Storage.get().diapers.slice(-1)[0].id")
    check('扣减：保存后各扣 1', pcs('dpS') == 49 and pcs('wipe1') == 79, (pcs('dpS'), pcs('wipe1')))
    check('扣减：记录上挂 used、偏好记住', ev("JSON.stringify(Storage.get().diapers.slice(-1)[0].used)") == '["dpS","wipe1"]' and ev("Storage.get().settings.diaperStock.ids.length") == 2)
    p.click(f'[data-open="{rid}"]'); p.wait_for_timeout(250)
    p.click('[data-use="wipe1"]'); p.click('.rs-save'); p.wait_for_timeout(1000)
    check('扣减：修改时取消湿巾会退回、纸尿裤不重复扣', pcs('dpS') == 49 and pcs('wipe1') == 80, (pcs('dpS'), pcs('wipe1')))
    ev(f"document.querySelector('[data-del=\"{rid}\"]').click()"); p.wait_for_timeout(300)
    check('扣减：删除记录退回库存', pcs('dpS') == 50)
    ev("(()=>{const bs=[...document.querySelectorAll('.toast button, .toast-action')];bs.length&&bs[bs.length-1].click()})()"); p.wait_for_timeout(300)
    check('扣减：撤销删除再扣回', pcs('dpS') == 49 and ev(f"Storage.get().diapers.some(x=>x.id==='{rid}')"), pcs('dpS'))
    ev("App.showTab('home')"); p.wait_for_timeout(300)
    n0 = ev("Storage.get().diapers.length")
    ev("(()=>{const r={id:Util.uid(),type:'pee',time:Util.nowLocal()};const t=Modules.diaper._autoUse(Storage.get(),r);Storage.get().diapers.push(r);Storage.save();window.__t=t})()")
    check('扣减：快记按偏好扣并给剩余提示', pcs('dpS') == 48 and pcs('wipe1') == 79 and '剩 48' in ev("window.__t"), ev("window.__t"))
    ev("App.showTab('supplies')"); p.wait_for_timeout(300)
    check('扣减：消耗品页显示剩余片数', '48' in ev("document.getElementById('view').innerText") and '片' in ev("document.getElementById('view').innerText"))
    bad = json.dumps(dict(seed, version=3, settings=dict(seed.get('settings', {}), diaperStock={'on': 'x', 'ids': ['<img src=x onerror=1>', 5, 'ok_id']})), ensure_ascii=False)
    ev('t=>Storage.importJSON(t)', bad)
    ids = ev("JSON.stringify(Storage.get().settings.diaperStock.ids)")
    check('扣减：导入坏偏好被清洗', '<' not in ids and '5' not in ids.replace('ok_id', ''), ids)
    check('扣减流程无报错', not errs, errs)
    p.close()


def test_diaper_photos(b):
    """第 227 次：便便照片——选图压缩进 IndexedDB、记录只存 id、时间轴有缩略图、移除照片、改成尿尿清掉照片、坏 id 不进 DOM、备份不带照片。"""
    import io, tempfile, os
    from PIL import Image as _I
    tmp = os.path.join(tempfile.gettempdir(), 'yiya_poop_test.jpg')
    _I.new('RGB', (3000, 2000), (180, 140, 40)).save(tmp, quality=90)
    p, errs = fresh(b)
    ev = p.evaluate
    ev("App.showTab('diaper')"); p.wait_for_timeout(250)
    p.click('[data-new]'); p.wait_for_timeout(250)
    check('照片：尿尿不显示照片区', ev("!document.querySelector('[data-phadd]')"))
    p.click('.dp-type[data-t="poop"]'); p.wait_for_timeout(150)
    with p.expect_file_chooser() as fc:
        p.click('[data-phadd]')
    fc.value.set_files([tmp, tmp])
    p.wait_for_timeout(1500)
    check('照片：选两张后面板出现两张缩略图', ev("document.querySelectorAll('.dp-ph').length") == 2)
    check('照片：缩略图已加载', ev("[...document.querySelectorAll('.dp-ph img')].every(i=>i.src.startsWith('blob:'))"))
    p.click('.dp-ph-rm'); p.wait_for_timeout(200)
    p.click('.rs-save'); p.wait_for_timeout(1100)
    r = ev("Storage.get().diapers.slice(-1)[0]")
    check('照片：记录只存 1 个 ph_ id', isinstance(r.get('photos'), list) and len(r['photos']) == 1 and r['photos'][0].startswith('ph_'), r.get('photos'))
    sz = ev("""(async()=>{const id=Storage.get().diapers.slice(-1)[0].photos[0];
      const db=await new Promise(r=>{const q=indexedDB.open('yiya-photos');q.onsuccess=()=>r(q.result)});
      const v=await new Promise(r=>{const q=db.transaction('p').objectStore('p').get(id);q.onsuccess=()=>r(q.result)});
      const im=await createImageBitmap(v.blob);return [v.blob.size,Math.max(im.width,im.height)]})()""")
    check('照片：压缩到长边 1280 且小于 400KB', sz[1] == 1280 and sz[0] < 400000, sz)
    check('照片：主数据里没有图片内容', 'data:image' not in ev("localStorage.getItem(Object.keys(localStorage).find(k=>localStorage.getItem(k).includes('diapers')))"))
    p.wait_for_timeout(300)
    check('照片：时间轴卡片有缩略图', ev("!!document.querySelector('.tl-ph img[src^=\"blob:\"]')"))
    rid = r['id']
    p.click(f'[data-open="{rid}"]'); p.wait_for_timeout(300)
    check('照片：修改面板带出照片', ev("document.querySelectorAll('.dp-ph').length") == 1)
    p.click('.dp-type[data-t="pee"]'); p.click('.rs-save'); p.wait_for_timeout(1100)
    check('照片：改成尿尿后清掉照片', 'photos' not in ev(f"Storage.get().diapers.filter(x=>x.id==='{rid}')[0]"))
    ev("(()=>{const d=Storage.get();d.diapers.push({id:'phbad',type:'poop',time:Util.nowLocal(),photos:['\"><img src=x onerror=window.__x=1>','ph_ok123']});Storage.save();App.showTab('home');App.showTab('diaper')})()"); p.wait_for_timeout(400)
    check('照片：坏 id 不进 DOM', not ev("window.__x") and 'onerror' not in ev("document.getElementById('view').innerHTML"))
    check('照片流程无报错', not errs, errs)
    p.close()


def test_feeding_sheet(b):
    """第 254 次：喂养页中间不再放入口卡；底部「开始亲喂 | ⊕」，⊕ 先选瓶喂 / 补记亲喂 / 吸奶 / 辅食。"""
    p, errs = fresh(b)
    ev = p.evaluate
    ev("App.showTab('feeding')"); p.wait_for_timeout(300)
    _poll(p, "!!document.querySelector('.mod-cta [data-fadd]')", 2000)  # 第 277 次：八组并行时偶尔晚一拍
    check('喂养：页面中间没有入口卡，底部是切换钮 + 开始 + ⊕', ev("!document.querySelector('.fd-entry') && !!document.querySelector('.mod-cta [data-fmode]') && !!document.querySelector('.mod-cta [data-fstart]') && !!document.querySelector('.mod-cta [data-fadd]')"))
    m0 = ev("document.querySelector('[data-fstart]').dataset.fstart")
    p.click('[data-fmode]'); p.wait_for_timeout(300)
    m1 = ev("document.querySelector('[data-fstart]').dataset.fstart")
    check('喂养：切换钮在亲喂 / 瓶喂间切换并记住', m0 != m1 and ev("Storage.get().feedMode") == m1, (m0, m1))
    if m1 != 'bottle':
        p.click('[data-fmode]'); p.wait_for_timeout(300)
    check('喂养：瓶喂模式主按钮叫开始瓶喂', '开始瓶喂' in ev("document.querySelector('[data-fstart]').textContent"))
    p.click('[data-fadd]'); p.wait_for_timeout(300)
    check('喂养：瓶喂模式 ⊕ 打开瓶喂面板', ev("(document.querySelector('#ftsTitle')||{}).textContent") == '瓶喂')
    p.keyboard.press('Escape'); p.wait_for_timeout(200)
    p.click('[data-fmode]'); p.wait_for_timeout(300)
    p.click('[data-fadd]'); p.wait_for_timeout(300)
    check('喂养：亲喂模式 ⊕ 打开补记亲喂', '亲喂' in ev("(document.querySelector('#ftsTitle')||{}).textContent"))
    p.keyboard.press('Escape'); p.wait_for_timeout(200)
    p.reload(); p.wait_for_timeout(600); ev("App.showTab('feeding')"); p.wait_for_timeout(300)
    check('喂养：刷新后模式仍在', ev("document.querySelector('[data-fstart]').dataset.fstart") == 'breast' and ev("Storage.get().feedMode") == 'breast')
    ev("App.showTab('alltools')"); p.wait_for_timeout(300)
    check('全部功能：不再单列亲喂、瓶喂', not ev("/亲喂|瓶喂/.test(document.querySelector('#view').textContent)"))

    # 亲喂（独立页仍保留，从首页磁贴 / 迷你条进入）
    ev("App.showTab('breast')"); p.wait_for_timeout(400)
    check('亲喂：独立页、粉色强调', ev("App.currentTab()") == 'breast' and ev("!!document.querySelector('.ft-page[data-accent=breast] [data-start]')"))
    p.click('[data-start]'); p.wait_for_timeout(400)
    check('亲喂：开始后进全屏计时', ev("!!document.querySelector('.ftf .ftf-big') && !!Storage.get().feedingTimer"))
    ev("(()=>{const t=Storage.get().feedingTimer;const m=Date.now()-65000;const z=n=>String(n).padStart(2,'0');const d=new Date(m);t.start=d.getFullYear()+'-'+z(d.getMonth()+1)+'-'+z(d.getDate())+'T'+z(d.getHours())+':'+z(d.getMinutes())+':'+z(d.getSeconds());t.sideStart=t.start;Storage.save()})()")
    p.click('.ftf [data-f="swap"]'); p.wait_for_timeout(200)
    st = ev("Storage.get().feedingTimer")
    check('亲喂：换边把上一侧的时间结算进去', (st.get('accL', 0) + st.get('accR', 0)) >= 60000, st)
    p.click('.ftf [data-f="pause"]'); p.wait_for_timeout(200)
    check('亲喂：暂停', ev("Storage.get().feedingTimer.paused === true") and '继续' in ev("document.querySelector('.ftf [data-f=pause]').textContent"))
    p.click('.ftf [data-f="down"]'); p.wait_for_timeout(300)
    check('亲喂：收起后页面显示迷你条', ev("!document.querySelector('.ftf') && !!document.querySelector('.ft-mini [data-mini=open]')"))
    p.click('[data-mini="open"]'); p.wait_for_timeout(300)
    p.click('.ftf [data-f="stop"]'); p.wait_for_timeout(400)
    check('亲喂：停止弹出保存面板', ev("(document.querySelector('#ftsTitle')||{}).textContent") == '保存亲喂')
    n1 = ev("Storage.get().feedings.length")
    p.click('[data-save]'); p.wait_for_timeout(400)
    last = ev("Storage.get().feedings.slice(-1)[0]")
    check('亲喂：保存出一条带秒数的记录', ev("Storage.get().feedings.length") == n1 + 1 and last.get('type') == 'breast' and (last.get('secL', 0) + last.get('secR', 0)) >= 60, last)
    check('亲喂：保存后计时清空、全屏关闭', ev("!Storage.get().feedingTimer && !document.querySelector('.ftf')"))
    check('亲喂：时间轴出现', '亲喂' in ev("document.querySelector('.ft-tl .tl-card').textContent"))
    p.click('[data-manual]'); p.wait_for_timeout(300)
    p.click('[data-step="L"] [data-d="1"]'); p.click('[data-step="L"] [data-d="1"]'); p.wait_for_timeout(100)
    p.click('[data-save]'); p.wait_for_timeout(400)
    check('亲喂：⊕ 补记', ev("Storage.get().feedings.slice(-1)[0].durationL") == 2)

    # 瓶喂
    ev("App.showTab('bottle')"); p.wait_for_timeout(400)
    p.click('[data-new]'); p.wait_for_timeout(300)
    check('瓶喂：面板有奶瓶刻度和建议奶量', ev("!!document.querySelector('.ft-bottle') && document.querySelectorAll('[data-amt]').length") == 4)
    p.click('[data-src="fm"]'); p.click('[data-amt="150"]') if ev("!!document.querySelector('[data-amt=\"150\"]')") else None
    ev("(()=>{const b=document.querySelector('[data-amt=\"150\"]')||document.querySelector('[data-amt]');b.click();document.querySelector('#bAmt').value=150;document.querySelector('#bAmt').dispatchEvent(new Event('input'))})()"); p.wait_for_timeout(100)
    check('瓶喂：大数字可填', ev("document.querySelector('#bAmt').value") == '150')
    check('瓶喂：快捷奶量来自自己常冲的量', ev("JSON.stringify(Modules.bottle._quick([{amount:100,start:'x'},{amount:100},{amount:130}]))") == '[60,90,100,130]')
    bands = ev("[0,1,3,6,9,12,20,40].map(m=>{const d=new Date();d.setMonth(d.getMonth()-m);d.setDate(d.getDate()-1);const z=n=>String(n).padStart(2,'0');const r=Modules.bottle._nhcRef({settings:{baby:{birthDate:d.getFullYear()+'-'+z(d.getMonth()+1)+'-'+z(d.getDate())}}});return r?r.lo+'-'+r.hi:'-'}).join()")
    check('瓶喂：卫健委每日奶量按月龄分档', bands == '600-700,600-700,800-900,800-1000,700-800,600-700,400-600,-', bands)
    tone = ev("['home','feeding','breast','sleep','diaper','poop','fetal','growth','finance','swim','jaundice','supplement'].filter(k=>!/opacity=\".28\"/.test(icon(k))).join()")
    check('图标 v2：业务图标都带柔色块', tone == '', tone)
    ev("App.showTab('alltools')"); p.wait_for_timeout(400)
    cols = ev("getComputedStyle(document.querySelector('.tools-grid')).gridTemplateColumns.split(' ').length")
    check('全部功能：网格 3 列、搜索框有底座样式', cols == 3 and ev("getComputedStyle(document.querySelector('.home-search')).minHeight") == '48px', cols)
    ev("App.showTab('home')"); p.wait_for_timeout(500)
    lg = ev("(()=>{const t=document.querySelector('#tabbar .lg-thumb'),a=document.querySelector('#tabbar .tab.active');return !!(window.LiquidDock&&t&&t.classList.contains('on')&&a&&Math.abs(t.offsetWidth-a.offsetWidth)<1&&getComputedStyle(a).backgroundColor.indexOf('0)')>0)})()")
    check('液态玻璃 dock：选中水滴盖在当前页签上', lg)
    check('液态玻璃 dock：按距离场生成位移贴图', ev("(()=>{const m=LiquidDock.buildMap(120,60,{amount:12,height:18});return !!(m&&m.url.indexOf('data:image/png')===0)})()"))
    ev("App.showTab('diaper')"); p.wait_for_timeout(400)
    # 第 276 次：搜索移出 dock，二级页只剩 返回 + ＋
    check('dock 二级页：返回在左、＋在右，没有搜索', ev("(()=>{const b=document.getElementById('tabbar');const xs=['#backBtn','.tab-plus'].map(q=>{const e=b.querySelector(q);return e&&e.offsetParent?e.getBoundingClientRect().x:-1});return xs[0]>=0&&xs[0]<xs[1]&&![...b.querySelectorAll('.tab[data-tab=search]')].some(e=>e.offsetParent)})()"))
    ev("App.showTab('home')"); p.wait_for_timeout(400)
    check('宝宝切换是 dock 左侧独立圆钮且不贴着 dock', ev("(()=>{const o=document.getElementById('dockOrb'),b=document.getElementById('tabbar');if(!o||o.hidden||!o.contains(document.getElementById('avatarBtn')))return false;const r=o.getBoundingClientRect(),q=b.getBoundingClientRect();return q.left-r.right>=6&&r.left>=8})()"))
    check('dock 一级页不用 transform 位移（iOS 转场快照会重复算 -50%），左缘紧挨圆钮', ev("(()=>{const b=document.getElementById('tabbar'),o=document.getElementById('dockOrb');const t=getComputedStyle(b).transform;const g=b.getBoundingClientRect().left-o.getBoundingClientRect().right;return (t==='none')&&g>=6&&g<=12})()"))
    check('dock 按下缩放左右对称（不再右缘不动、左缘缩进）', ev("(()=>{const b=document.getElementById('tabbar');const r0=b.getBoundingClientRect();b.style.transition='none';b.classList.add('lg-press');const r1=b.getBoundingClientRect();b.classList.remove('lg-press');b.style.transition='';return Math.abs((r1.left-r0.left)-(r0.right-r1.right))<1.5})()"))
    check('dock 一级页：首页/日期两个页签（搜索移出 dock，设置在侧拉页）', ev("Array.from(document.querySelectorAll('#tabbar .tab[data-tab]')).filter(e=>e.offsetParent).map(e=>e.dataset.tab).slice(0,4).join()") == 'home,calendar')
    ev("document.getElementById('avatarBtn').click()"); p.wait_for_timeout(500)
    _poll(p, "document.getElementById('sideDrawer').getBoundingClientRect().left>=-1", 1500)
    check('点宝宝圆钮打开左侧抽屉：头像、宝宝名、设置、全部功能', ev("(()=>{const r=document.getElementById('sideDrawer');if(!r||!document.body.classList.contains('sd-open'))return false;const x=r.getBoundingClientRect();return x.left>=-1&&!!r.querySelector('.sd-ava')&&!!r.querySelector('[data-sd-go=settings]')&&r.querySelectorAll('.sd-color').length>=20})()"))
    ev("document.querySelector('#sideDrawer [data-sd-go=settings]').click()"); p.wait_for_timeout(600)
    check('抽屉进设置：抽屉收起、设置是二级页（有返回）', ev("App.currentTab()=='settings'&&!document.body.classList.contains('sd-open')&&!document.getElementById('backBtn').hidden"))
    ev("App.showTab('home')"); p.wait_for_timeout(400)
    ev("(()=>{Modules.home._edit=true;Modules.home._sheet=true;App.rerender()})()"); p.wait_for_timeout(400)
    cats = ev("Array.from(document.querySelectorAll('.sc-cat')).map(e=>e.dataset.cat)")
    check('添加组件：分类胶囊含快捷记录 / 今日', '快捷记录' in cats and '今日' in cats, cats)
    ev("document.querySelector('.sc-cat[data-cat=今日]').click()"); p.wait_for_timeout(100)
    check('添加组件：点分类只显示该类', ev("Array.from(document.querySelectorAll('.sheet-group')).filter(g=>!g.hidden).map(g=>g.dataset.group).join()") == '今日')
    check('快捷记录横条 / 小卡可添加', ev("!!document.querySelector('[data-add=quick-h]')&&!!document.querySelector('[data-add=quick-s]')"))
    ev("(()=>{Modules.home._edit=false;Modules.home._sheet=false;App.rerender()})()"); p.wait_for_timeout(300)
    ev("App.showTab('diaper')"); p.wait_for_timeout(400)
    _poll(p, "!!document.querySelector('#tabbar .lg-thumb')", 1500)  # 第 276 次：并行吃紧时 dock 重建后水滴晚一拍补回
    check('液态玻璃 dock：二级页收起时水滴隐藏', ev("!document.querySelector('#tabbar .lg-thumb').classList.contains('on')"))
    ev("App.showTab('bottle')"); p.wait_for_timeout(400)
    # 第 272 次：换页会关掉上一页的面板（审计 #2），这里重新打开瓶喂面板再保存
    check('换页后上一页的面板已关掉', ev("!document.querySelector('#modalRoot .modal-mask')"))
    p.click('[data-new]'); p.wait_for_timeout(300)
    p.click('[data-src="fm"]'); ev("(()=>{const i=document.querySelector('#bAmt');i.value=150;i.dispatchEvent(new Event('input'))})()"); p.wait_for_timeout(100)
    n2 = ev("Storage.get().feedings.length")
    p.click('[data-save]'); p.wait_for_timeout(400)
    lb = ev("Storage.get().feedings.slice(-1)[0]")
    check('瓶喂：保存配方奶 150', ev("Storage.get().feedings.length") == n2 + 1 and lb.get('type') == 'formula' and lb.get('amount') == 150, lb)
    p.click('[data-new]'); p.wait_for_timeout(300)
    p.click('[data-go]'); p.wait_for_timeout(400)
    check('瓶喂：开始喂奶后底部显示进行中', ev("!!Storage.get().bottleTimer && !!document.querySelector('[data-bt=end]')"))
    p.click('[data-bt="end"]'); p.wait_for_timeout(400)
    check('瓶喂：结束后记下一条带结束时间的记录', ev("!Storage.get().bottleTimer && !!Storage.get().feedings.slice(-1)[0].end"))
    check('瓶喂：时间轴只列瓶喂', ev("[...document.querySelectorAll('.ft-tl .tl-card b')].every(x=>x.textContent==='奶瓶喂养')"))
    ev("Storage.importJSON(JSON.stringify(Object.assign({},Storage.get(),{bottleTimer:{start:'bad'},feedingTimer:{start:'2026-10-01T10:00:00',paused:'yes',side:'x'}})))")
    check('导入：坏的进行中状态被清洗', ev("Storage.get().bottleTimer===null && Storage.get().feedingTimer.paused===undefined"))
    check('喂养拆分无报错', not errs, errs)
    p.close()


def test_pump(b):
    """第 256 次：泵奶独立模块——全屏计时左右分开、结束时左右分别记奶量。"""
    p, errs = fresh(b)
    ev = p.evaluate
    ev("App.showTab('pump')"); p.wait_for_timeout(300)
    check('泵奶：独立页，底部开始泵奶 + ⊕', ev("App.currentTab()") == 'pump' and ev("!!document.querySelector('.mod-cta [data-pstart]') && !!document.querySelector('.mod-cta [data-padd]')"))
    p.click('[data-pstart]'); p.wait_for_timeout(400)
    check('泵奶：开始后进全屏、默认双侧', ev("!!document.querySelector('.ftf-pump') && Storage.get().pumpTimer.L && Storage.get().pumpTimer.R") and '双侧' in ev("document.querySelector('.ftf-chip').textContent"))
    ev("(()=>{const t=Storage.get().pumpTimer;const z=n=>String(n).padStart(2,'0');const d=new Date(Date.now()-60000);const s=d.getFullYear()+'-'+z(d.getMonth()+1)+'-'+z(d.getDate())+'T'+z(d.getHours())+':'+z(d.getMinutes())+':'+z(d.getSeconds());t.start=s;t.since=s;Storage.save()})()")
    p.click('.ftf [data-p="R"]'); p.wait_for_timeout(200)
    st = ev("Storage.get().pumpTimer")
    check('泵奶：关掉右侧，已泵时间结算到两侧', st['R'] is False and st['accL'] >= 59000 and st['accR'] >= 59000, st)
    check('泵奶：只剩左侧', '左侧泵奶中' in ev("document.querySelector('.ftf-chip').textContent"))
    p.click('.ftf [data-p="L"]'); p.wait_for_timeout(200)
    check('泵奶：两侧都关 = 暂停', '已暂停' in ev("document.querySelector('.ftf-chip').textContent"))
    p.click('.ftf [data-p="pause"]'); p.wait_for_timeout(200)
    check('泵奶：继续时两侧重新打开', ev("Storage.get().pumpTimer.L && Storage.get().pumpTimer.R && !Storage.get().pumpTimer.paused"))
    p.reload(); p.wait_for_timeout(600)
    check('泵奶：刷新后计时还在', ev("!!Storage.get().pumpTimer && Storage.get().pumpTimer.accL >= 59000"))
    ev("App.showTab('pump')"); p.wait_for_timeout(300)
    check('泵奶：页面底部变迷你计时条', ev("!!document.querySelector('.ft-mini [data-pm=open]')"))
    p.click('[data-pm="open"]'); p.wait_for_timeout(300)
    p.click('.ftf [data-p="stop"]'); p.wait_for_timeout(300)
    check('泵奶：结束弹出左右奶量面板', ev("(document.querySelector('#ftsTitle')||{}).textContent") == '结束泵奶')
    ev("(()=>{})()")
    for side, frac in (('L', 0.6), ('R', 0.75)):
        p.click(f'[data-ps="{side}"]'); p.wait_for_timeout(100)
        bb = p.query_selector('[data-pbtl] svg').bounding_box()
        p.mouse.click(bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] * frac); p.wait_for_timeout(100)
    p.click('[data-psave]'); p.wait_for_timeout(400)
    r = ev("Storage.get().feedings.filter(x=>x.type==='pump').slice(-1)[0]")
    check('泵奶：保存左右时间和左右奶量', r and r['amountL'] > 0 and r['amountR'] > 0 and r['amount'] == r['amountL'] + r['amountR'] and r['secL'] >= 59 and r['side'] == 'both' and not ev("Storage.get().pumpTimer"), r)
    check('泵奶：记录出现在泵奶时间轴', ev("!!document.querySelector('.tl-f-pump')"))
    ev("App.showTab('feeding')"); p.wait_for_timeout(300)
    check('喂养：最近记录不再列泵奶', not ev("!!document.querySelector('.tl-f-pump')"))
    ev("App.showTab('alltools')"); p.wait_for_timeout(300)
    check('全部功能：有泵奶入口', ev("/泵奶/.test(document.querySelector('#view').textContent)"))
    ev("Storage.importJSON(JSON.stringify(Object.assign({},Storage.get(),{pumpTimer:{start:'2026-10-01T10:00:00',L:'yes',accL:-5,mlL:9999}})))")
    check('导入：坏的泵奶计时被清洗', ev("(t=>t.L===false && t.accL===0 && t.mlL===null)(Storage.get().pumpTimer)"))
    check('泵奶无报错', not errs, errs)
    p.close()


def test_solid(b):
    """第 269 次：辅食独立模块——参考截图的面板（性状 / 量 / 进食情况 / 名称 / 类型）、本周四格、老记录兼容。"""
    p, errs = fresh(b)
    ev = p.evaluate
    ev("App.showTab('solid')"); p.wait_for_timeout(200)
    _poll(p, "!!document.querySelector('.mod-cta [data-snew]')", 2000)  # 第 277 次：八组并行时偶尔晚一拍
    check('辅食：独立页空状态 + 底部记录辅食', ev("App.currentTab()") == 'solid' and ev("!!document.querySelector('.sk-empty') && !!document.querySelector('.mod-cta [data-snew]')"))
    p.click('[data-snew]'); p.wait_for_timeout(200)
    check('辅食：面板 6 种性状、6 种类型、克/勺/碗', ev("[document.querySelectorAll('.sd-tex').length, document.querySelectorAll('.sd-cat').length, document.querySelectorAll('[data-unit]').length].join()") == '6,6,3')
    p.click('[data-tex="puree"]'); p.click('[data-unit="bowl"]'); p.wait_for_timeout(100)
    check('辅食：碗从 1 起，换算约 230 ml', ev("document.querySelector('#sdQty').value") == '1' and '230' in ev("document.querySelector('[data-conv]').textContent"))
    p.click('[data-unit="spoon"]'); p.click('[data-q="1"]'); p.click('[data-q="1"]'); p.wait_for_timeout(100)
    check('辅食：勺步进 + 换算', ev("document.querySelector('#sdQty').value") == '3' and '15 ml' in ev("document.querySelector('[data-conv]').textContent"))
    p.click('[data-acc="good"]'); p.fill('#sdName', '<b>南瓜泥</b>'); p.click('[data-cat="veg"]'); p.click('[data-cat="grain"]')
    p.click('[data-sdsave]'); p.wait_for_timeout(250)
    r = ev("Storage.get().feedings.filter(x=>x.type==='solid').slice(-1)[0]")
    check('辅食：保存到 d.feedings（type solid + 新字段）', r and r['texture'] == 'puree' and r['unit'] == 'spoon' and r['qty'] == 3 and r['accept'] == 'good' and r['cats'] == ['veg', 'grain'] and r['dish'] == '<b>南瓜泥</b>', r)
    check('辅食：名称转义、出现在时间轴', ev("!!document.querySelector('.tl-f-solid') && !document.querySelector('.tl-f-solid b b') && /南瓜泥/.test(document.querySelector('.tl-f-solid').textContent)"))
    check('辅食：本周四格', ev("[...document.querySelectorAll('.sd-cell b')].map(x=>x.textContent).join('|')") == '3 勺|吃得好 1 次|<b>南瓜泥</b>|泥糊')
    check('辅食：观察期横幅', ev("!!document.querySelector('.sd-watch')"))
    ev("""(()=>{const d=Storage.get();d.feedings.push({id:'oldsolid',type:'solid',start:new Date(Date.now()-3600e3).toISOString().slice(0,19),amount:60,dish:null,newFood:'蛋黄',ing:'荤：肉末20g',note:'老记录'});Storage.save();App.rerender()})()""")
    p.wait_for_timeout(200)
    t = ev("[...document.querySelectorAll('.tl-f-solid')].map(x=>x.textContent).join('/')")
    check('辅食：老记录（克数 / 新食材 / 食材 / 备注）照常显示', '60 克' in t and '蛋黄' in t and '肉末20g' in t and '老记录' in t, t)
    p.click('[data-sopen="oldsolid"]'); p.wait_for_timeout(200)
    check('辅食：老记录打开编辑面板，克数回显', ev("document.querySelector('#ftsTitle').textContent") == '修改辅食' and ev("document.querySelector('#sdQty').value") == '60')
    p.click('[data-acc="refuse"]'); p.click('[data-sdsave]'); p.wait_for_timeout(200)
    o = ev("Storage.get().feedings.find(x=>x.id==='oldsolid')")
    check('辅食：改老记录保留 newFood / ing', o['accept'] == 'refuse' and o['newFood'] == '蛋黄' and o['ing'] == '荤：肉末20g' and o['amount'] == 60 and o['unit'] == 'g', o)
    ev("App.showTab('feeding')"); p.wait_for_timeout(200)
    check('喂养：最近记录不再列辅食', not ev("!!document.querySelector('.tl-f-solid')"))
    ev("RecordEdit.open('feeding', Storage.get().feedings.find(x=>x.id==='oldsolid'), Storage.get().feedings)"); p.wait_for_timeout(200)
    check('编辑入口：辅食记录走辅食面板', ev("!!document.querySelector('.ft-sheet[data-accent=solid] .sd-texs')"))
    ev("document.getElementById('modalRoot').innerHTML=''")
    ev("App.showTab('alltools')"); p.wait_for_timeout(200)
    check('全部功能：有辅食入口', ev("/辅食/.test(document.querySelector('#view').textContent)"))
    check('辅食无报错', not errs, errs)
    p.close()


def test_r270(b):
    """第 270 次：状态栏接缝、插画预热、面板关闭替身、重启后回到第一条 history、抽屉缩放不露底。"""
    p, errs = fresh(b)
    ev = p.evaluate
    p.wait_for_timeout(300)
    cap = ev("(()=>{const s=document.querySelector('.home-sky');const c=s&&s.querySelector('.sky-cap');return c?[s.style.getPropertyValue('--sky-cap'),getComputedStyle(document.documentElement).getPropertyValue('--status-color').trim(),c.getBoundingClientRect().height]:null})()")
    check('首页：天空顶端接缝色与状态栏同色', bool(cap) and cap[0] and cap[0] == cap[1] and cap[2] >= 56, cap)
    p.wait_for_timeout(2600)
    # 第 276 次：预热改为按需（只预热首页能点进去的页头插画，最多 8 张；图组进页才载），不再 58 张全载
    _poll(p, "Hero._warmed() >= 6", 12000)
    wl = ev("Hero._warmList()")
    check('插画预热：首页能点进去的页头插画已载入，图组不常驻', 6 <= len(wl) <= 12 and all('/hero/' in x for x in wl), wl)
    check('插画预热后进页，页头插画同步可画', ev("(()=>{App.showTab('diaper',{noVT:true});const im=document.querySelector('.mod-hero img');return !!im&&im.complete&&im.naturalWidth>0})()"))
    p.click('[data-new]'); p.wait_for_timeout(450)
    ghost = ev("(async()=>{document.querySelector('#modalRoot .rs-x').click();await Promise.resolve();const g=document.querySelector('.sheet-ghost');return g?[!!g.querySelector('[id]'),g.getAttribute('aria-hidden'),getComputedStyle(g).pointerEvents]:null})()")
    check('关面板：留下无 id、不可点的替身往下滑', ghost == [False, 'true', 'none'], ghost)
    p.wait_for_timeout(450)
    check('关面板：替身动画后移除', ev("!document.querySelector('.sheet-ghost')"))
    check('打开面板：遮罩不再整体淡入（面板不半透明）', ev("(()=>{const m=document.createElement('div');m.className='modal-mask as-sheet';document.body.appendChild(m);const a=getComputedStyle(m).animationName;m.remove();return a})()") == 'sheetMaskIn')
    # 第 276 次：侧拉页改整屏推入（不再缩放），原「底色多铺」断言换成整屏 / 无圆角无投影
    check('侧拉页：整屏宽、无圆角无投影', ev("(()=>{Drawer.open();const r=document.querySelector('.side-drawer'),cs=getComputedStyle(r),a=getComputedStyle(document.getElementById('app'));const o=[r.offsetWidth===innerWidth,cs.borderRadius,cs.boxShadow,a.borderTopLeftRadius,a.boxShadow];Drawer.close();return o})()") == [True, '0px', 'none', '0px', 'none'])
    p.wait_for_timeout(500)
    ev("App.showTab('feeding')"); p.wait_for_timeout(250)
    p.reload(); p.wait_for_timeout(900)
    check('停在功能页时重启：回到第一条 history（身后没有旧快照）', ev("[App.currentTab(), history.state]") == ['home', None], ev("[App.currentTab(), history.state]"))
    check('第 270 次无报错', not errs, errs)
    p.close()


FAKE_AUDIO = r"""
window.__FA = [];
window.Audio = function () {
  var a = this; a.loop = false; a.ended = false; a.paused = true; a._n = 0; __FA.push(a);
  a.setAttribute = function () {}; a.removeAttribute = function () {}; a.load = function () {};
  a.play = function () { a._n++; return new Promise(function (res, rej) { a._res = res; a._rej = rej; }); };
  a.pause = function () { if (!a.paused) { a.paused = true; a.onpause && a.onpause(); } else if (a._res) { a._res = null; } };
  a._ok = function () { a.paused = false; var r = a._res; a._res = null; r && r(); a.onplaying && a.onplaying(); };
  a._no = function () { var r = a._rej; a._res = null; r && r(new Error('NotAllowedError')); };
};
"""
def test_r271(b):
    """第 271 次：状态栏跟随全屏层 / 面板、尿布保存吸底、白噪音播放状态单一来源、播放页露出 dock。"""
    p, errs = fresh(b)
    ev = p.evaluate
    ev(FAKE_AUDIO)
    def tc():
        return ev("document.querySelector('meta[name=theme-color]').content")
    def row0(sel=None):
        # 截图第 1 行平均色（Chromium 截图里的视口第 0 行 = 状态栏下面紧挨着的像素）
        import io
        from PIL import Image
        im = Image.open(io.BytesIO(p.screenshot())).convert('RGB')
        px = [im.getpixel((x, 1)) for x in range(im.width // 10, im.width * 9 // 10, 4)]  # 两端让开面板圆角
        return tuple(round(sum(c[i] for c in px) / len(px)) for i in range(3))
    def near(hexc, rgb, tol=3):
        h = hexc.lstrip('#'); c = tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
        return max(abs(c[i] - rgb[i]) for i in range(3)) <= tol
    # —— 白噪音：播放页 ——
    ev("App.showTab('whitenoise',{noVT:true})"); p.wait_for_timeout(300)
    p.click('.wn-art[data-type="white"]'); p.wait_for_timeout(700)
    ev("syncStatusColor()")
    c, r = tc(), row0()
    check('状态栏：白噪音播放页取播放页顶色（不是页面浅色）', near(c, r) and c.lower() != '#fdf9f4', [c, r])
    dock = ev("(()=>{const t=document.getElementById('tabbar');const r=t.getBoundingClientRect();const e=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return [getComputedStyle(t).visibility,!!e&&t.contains(e),[...t.querySelectorAll('#backBtn,.dock-plus')].filter(x=>x.offsetWidth).length]})()")
    check('白噪音播放页：dock（返回 / ＋）露在播放页上面且能点到', dock == ['visible', True, 2], dock)
    gap = ev("(()=>{const t=document.getElementById('tabbar').getBoundingClientRect();const tip=document.querySelector('.wp-tip,.wp-warn').getBoundingClientRect();const ctl=document.querySelector('.wp-ctrl').getBoundingClientRect();return [tip.bottom<=t.top,ctl.bottom<=t.top]})()")
    check('白噪音播放页：控件和提示都在 dock 上方，不被压住', gap == [True, True], gap)
    st = lambda: ev("(()=>{const b=document.getElementById('wpToggle');return [b.getAttribute('data-state'),b.querySelector('rect')?'pause':'play',document.getElementById('wpState').textContent]})()")
    check('播放同步：没在放时 ▶ +「轻点播放」', st()[:2] == ['idle', 'play'], st())
    p.click('#wpToggle'); p.wait_for_timeout(120)
    s1 = st()
    check('播放同步：play() 未兑现时显示「正在开始」，不谎报播放中', s1[0] == 'starting' and '正在开始' in s1[2] and not ev("Storage.get().whitenoise.playing"), s1)
    ev("__FA[__FA.length-1]._ok()"); p.wait_for_timeout(150)
    s2 = st()
    check('播放同步：真正出声（playing 事件）后大按钮立刻变暂停、文字「播放中」', s2[0] == 'playing' and s2[1] == 'pause' and s2[2].startswith('播放中'), s2)
    check('播放同步：锁屏 MediaSession 也是 playing', ev("navigator.mediaSession?navigator.mediaSession.playbackState:'playing'") == 'playing')
    ev("__FA[__FA.length-1].pause()"); p.wait_for_timeout(150)
    s3 = st()
    check('播放同步：系统替我们暂停（锁屏 / 灵动岛）→ 界面变 ▶「已暂停」并保留剩余时间', s3[0] == 'paused' and s3[1] == 'play' and s3[2].startswith('已暂停') and ev("Storage.get().whitenoise.leftMs>0"), s3)
    ev("__FA[__FA.length-1]._ok()"); p.wait_for_timeout(150)
    check('播放同步：系统继续播放 → 界面回到播放中', st()[0] == 'playing', st())
    p.click('#wpToggle'); p.wait_for_timeout(150)
    check('播放同步：点暂停 → ▶ + 已暂停', st()[:2] == ['paused', 'play'], st())
    p.click('#wpToggle'); p.wait_for_timeout(120)
    check('播放同步：继续时 play() 未兑现，先「正在继续」，状态仍是暂停', st()[0] == 'starting' and ev("Storage.get().whitenoise.paused"), st())
    ev("__FA[__FA.length-1]._no()"); p.wait_for_timeout(150)
    check('播放同步：继续被拒 → 回到 ▶ 已暂停', st()[:2] == ['paused', 'play'], st())
    # 首页迷你条（dock 上方胶囊）与播放页同一状态
    p.click('#wpClose'); p.wait_for_timeout(400)
    ev("App.showTab('home',{noVT:true})"); p.wait_for_timeout(300)
    dl = ev("(()=>{const d=document.getElementById('dockLive');const a=d.querySelector('[data-act=wn-pp]');const art=d.querySelector('.dl-art');return [d.hidden,a&&a.getAttribute('aria-label'),d.querySelector('.dl-val').textContent,art?art.style.backgroundImage:'']})()")
    check('首页胶囊：与播放页同为「已暂停」+ 继续键，封面图存在', dl[0] is False and dl[1] == '继续播放' and '已暂停' in dl[2] and 'assets/sounds/white.webp' in dl[3], dl)
    p.click('#dockLive [data-act=wn-pp]'); p.wait_for_timeout(100)
    ev("__FA[__FA.length-1]._ok()"); p.wait_for_timeout(200)
    dl2 = ev("(()=>{const d=document.getElementById('dockLive');const a=d.querySelector('[data-act=wn-pp]');return [a&&a.getAttribute('aria-label'),d.querySelector('.dl-val').textContent]})()")
    check('首页胶囊：点继续、真正出声后胶囊变「暂停」键', dl2[0] == '暂停' and '已暂停' not in dl2[1], dl2)
    ev("Modules.whitenoise._stop()"); p.wait_for_timeout(100)
    # 首次播放被拒
    ev("App.showTab('whitenoise',{noVT:true})"); p.wait_for_timeout(200)
    p.click('.wn-art[data-type="pink"]'); p.wait_for_timeout(500)
    p.click('#wpToggle'); p.wait_for_timeout(100)
    ev("__FA[__FA.length-1]._no()"); p.wait_for_timeout(150)
    check('播放同步：首次播放被拒 → 回到 ▶ 轻点播放', st()[:2] == ['idle', 'play'], st())
    # 离开本页 → 播放页立刻收起
    ev("document.getElementById('backBtn').click()"); p.wait_for_timeout(80)
    # 第 276 次：七组并行（2 核）时 popstate 偶尔晚于 80ms 才到，轮询最多 1.5 秒（断言不变）
    _poll(p, "App.currentTab()==='home'", 1500)
    check('白噪音：dock 返回离开本页，播放页立刻收起', ev("[App.currentTab(), !!document.querySelector('.wn-player.open'), document.documentElement.classList.contains('wp-lock')]") == ['home', False, False])
    # —— 全屏计时（泵奶）——
    p.wait_for_timeout(400)
    ev("App.showTab('pump',{noVT:true})"); p.wait_for_timeout(200)
    ev("Storage.get().pumpTimer={start:new Date().toISOString(),L:true,R:true,segs:[]};Storage.save();Modules.pump._openFull()"); p.wait_for_timeout(500)
    # 第 276 次：并行吃紧时全屏层入场动画还没走完（coversTop 判不到），等它铺满再取色（断言不变）
    _poll(p, "(()=>{const e=document.querySelector('.ftf');if(!e)return false;const r=e.getBoundingClientRect();return r.top<=0.5&&r.left<=1&&getComputedStyle(e).opacity==='1'})()", 2000)
    ev("syncStatusColor()"); c, r = tc(), row0()
    check('状态栏：泵奶全屏计时取全屏层顶色（深色）', near(c, r) and sum(r) < 150, [c, r])
    ev("document.querySelector('.ftf [data-p=dim]').click()"); p.wait_for_timeout(450); ev("syncStatusColor()")
    c, r = tc(), row0()
    check('状态栏：泵奶全屏「关背景图」后仍同色', near(c, r), [c, r])
    ev("Storage.get().pumpTimer=null;Storage.save();Modules.pump._closeFull?Modules.pump._closeFull():document.querySelector('.ftf').remove();document.body.classList.remove('ftf-open')"); p.wait_for_timeout(200)
    # —— 尿布面板 ——
    ev("App.showTab('diaper',{noVT:true})"); p.wait_for_timeout(300)
    # 第 276 次：新版 Playwright 点 sticky 的 .mod-cta 前会把页面滚到它的原位（约 700px），顶行变成记录卡，取色断言失真；改 JS 点击
    ev("document.querySelector('[data-new]').click()"); p.wait_for_timeout(600)
    p.click('.dp-type[data-t="poop"]'); p.wait_for_timeout(500)
    ev("syncStatusColor()"); c, r = tc(), row0()
    check('状态栏：尿布面板打开时取遮罩压暗后的页面色', near(c, r), [c, r])
    sv = ev("(()=>{const s=document.querySelector('.rs-save'),pn=document.querySelector('.rec-sheet');const a=s.getBoundingClientRect(),q=pn.getBoundingClientRect();return [getComputedStyle(s.parentElement).position,pn.scrollHeight>pn.clientHeight+100,Math.round(q.bottom-a.bottom)]})()")
    check('尿布面板：内容很长时「保存」吸在面板底部，不用滚到底', sv[0] == 'sticky' and sv[1] and 0 <= sv[2] <= 40, sv)
    ev("document.querySelector('.rec-sheet').scrollTop=1e5"); p.wait_for_timeout(200)
    end = ev("(()=>{const s=document.querySelector('.rs-save').getBoundingClientRect(),n=document.querySelector('#dpsNote').getBoundingClientRect();return s.top>n.bottom})()")
    check('尿布面板：滚到底时「保存」落在备注之后', end)
    ev("(()=>{const pn=document.querySelector('.rec-sheet');pn.style.maxHeight='none';pn.style.height='100vh';pn.style.animation='none'})()"); p.wait_for_timeout(200)
    ev("syncStatusColor()"); c, r = tc(), row0()
    check('状态栏：面板顶到最上面时取面板底色（白）', near(c, r) and sum(r) > 740, [c, r])
    ev("document.querySelector('#modalRoot .rs-x').click()"); p.wait_for_timeout(700)
    ev("syncStatusColor()")
    check('状态栏：关掉面板后回到页面色', near(tc(), row0()), [tc(), row0()])
    check('第 271 次无报错', not errs, errs)
    p.close()


R272_SEED = r"""(()=>{const d=Storage.get(),z=n=>String(n).padStart(2,'0');const L=t=>{t=new Date(t);return t.getFullYear()+'-'+z(t.getMonth()+1)+'-'+z(t.getDate())+'T'+z(t.getHours())+':'+z(t.getMinutes())+':'+z(t.getSeconds())};
  window.__L=L; d.waters=[{id:'w1',time:L(Date.now()-3600e3),ml:30,note:null},{id:'w2',time:L(Date.now()-7200e3),ml:60,note:null}];
  d.temps=[{id:'t1',time:L(Date.now()-3600e3),value:36.6,site:'ear',note:null}];
  d.feedings.push({id:'fb1',type:'bottle',start:L(Date.now()-3600e3),amount:120,src:'bm'});Storage.save()})()"""


def test_r272(b):
    """第 272 次：审计第一轮 12 条 + 全站记录面板保存吸底。"""
    p, errs = fresh(b)
    ev = p.evaluate
    ev(R272_SEED)
    def go(t):
        ev(f"App.showTab('{t}',{{noVT:true}})"); p.wait_for_timeout(250)
    # —— #1 误触睡了→醒了 ——
    go('home')
    ev("(()=>{const d=Storage.get();d.openSleep={id:'os1',start:__L(Date.now()-20000),pausedMs:0,pauseStart:null};Storage.save();App.rerender()})()"); p.wait_for_timeout(200)
    n0 = ev("Storage.get().sleeps.length")
    p.click('#dockLive [data-act="sleep-end"]'); p.wait_for_timeout(250)
    t1 = ev("[...document.querySelectorAll('#toastRoot .toast:not(.leaving)')].map(t=>t.textContent).join('|')")
    check('#1 睡了不到 1 分钟不存、计时结束', ev("Storage.get().sleeps.length") == n0 and not ev("Storage.get().openSleep"), t1)
    check('#1 不到 1 分钟的提示带撤销', '不到 1 分钟' in t1 and '撤销' in t1, t1)
    ev("document.querySelector('#toastRoot .toast-action').click()"); p.wait_for_timeout(250)
    check('#1 撤销后恢复成还在睡（原入睡时间）', ev("(Storage.get().openSleep||{}).id") == 'os1')
    ev("(()=>{const d=Storage.get();d.openSleep.start=__L(Date.now()-600000);Storage.save()})()")
    p.click('#dockLive [data-act="sleep-end"]'); p.wait_for_timeout(250)
    check('#1 正常结束（10 分钟）照常记录且带撤销', ev("Storage.get().sleeps.length") == n0 + 1 and '撤销' in ev("document.getElementById('toastRoot').textContent"))
    ev("[...document.querySelectorAll('#toastRoot .toast-action')].pop().click()"); p.wait_for_timeout(250)
    check('#1 正常结束后撤销：删掉记录、恢复计时', ev("Storage.get().sleeps.length") == n0 and ev("(Storage.get().openSleep||{}).id") == 'os1')
    ev("(()=>{const d=Storage.get();d.openSleep=null;d.sleeps.push({id:'z0',start:__L(Date.now()-60000),end:__L(Date.now()-50000),pausedMs:0});Storage.save();App.rerender()})()"); p.wait_for_timeout(200)
    hw = ev("(document.querySelector('[data-cid=w-sleep]')||{}).textContent||''")
    check('#1 首页「上次睡眠」不写「0 分钟」', '0 分钟' not in hw.replace('10 分钟', '') and ('不到 1 分钟' in hw or not hw), hw)
    ev("(()=>{const d=Storage.get();d.sleeps=d.sleeps.filter(x=>x.id!=='z0');Storage.save()})()")
    # —— #2 面板开着时返回 ——
    go('diaper'); p.click('[data-new]'); p.wait_for_timeout(500)
    ev("history.back()"); p.wait_for_timeout(500)
    st = ev("[App.currentTab(), !!document.querySelector('#modalRoot .modal-mask:not(.sheet-ghost)'), document.body.classList.contains('sheet-open')]")
    check('#2 面板开着时返回：先关面板、留在原页', st == ['diaper', False, False], st)
    ev("history.back()"); p.wait_for_timeout(500)
    check('#2 再返回一次才回首页', ev("App.currentTab()") == 'home')
    go('water'); p.click('[data-new]'); p.wait_for_timeout(400)
    go('temp')
    check('#2 换页时上一页面板一起关掉', ev("!document.querySelector('#modalRoot .modal-mask:not(.sheet-ghost)') && !document.body.classList.contains('sheet-open')"))
    # —— #3 画布还透明时状态栏不是黑的 ——
    go('home'); p.wait_for_timeout(300)
    c3 = ev("""(()=>{const cv=document.querySelector('.sky-canvas');Sky.stop(cv);cv.getContext('2d').clearRect(0,0,cv.width,cv.height);
      document.documentElement.style.setProperty('--status-color','#010203');syncStatusColor();
      return [document.querySelector('meta[name=theme-color]').content, document.querySelector('.home-sky').style.getPropertyValue('--sky-cap')]})()""")
    check('#3 天空画布还没画时状态栏 / 天空顶取兜底天空色而不是黑', c3[0] == c3[1] and int(c3[0][1:3], 16) > 120 and int(c3[0][5:7], 16) > 180, c3)
    # —— #12 不再直接回读天空画布 ——
    ev("""(()=>{window.__gid=[];const o=CanvasRenderingContext2D.prototype.getImageData;CanvasRenderingContext2D.prototype.getImageData=function(){window.__gid.push(this.canvas.className||'(无类名)');return o.apply(this,arguments)}})()""")
    ev("App.showTab('home',{noVT:true})"); p.wait_for_timeout(1700)
    ev("syncStatusColor();window.__r0=window.__skyReads||0;scrollTo(0,40);"); p.wait_for_timeout(200); ev("scrollTo(0,0)"); p.wait_for_timeout(200)
    gid = ev("window.__gid")
    check('#12 天空画布本身从不 getImageData（拷到 1 行小画布上读）', 'sky-canvas' not in gid and ev("(window.__skyReads||0)") > 0, gid[:6])
    # —— #4 快选清掉校验红字 ——
    for mod, fld in (('water', 'ml'), ('temp', 'value')):
        go(mod); p.click('[data-new]'); p.wait_for_timeout(400)
        p.click('#modalRoot .rs-savebar .rs-save'); p.wait_for_timeout(150)
        bad = ev(f"[document.querySelector('#sk_{fld}').getAttribute('aria-invalid'), !!document.querySelector('#modalRoot .field-error')]")
        ev("document.querySelector('#modalRoot [data-q]').click()"); p.wait_for_timeout(150)
        ok = ev(f"[document.querySelector('#sk_{fld}').value, document.querySelector('#sk_{fld}').getAttribute('aria-invalid'), !!document.querySelector('#modalRoot .field-error'), document.querySelector('#sk_{fld}').classList.contains('is-invalid')]")
        check(f'#4 {mod}：先报错，点快选后红字 / aria-invalid / .is-invalid 都清掉', bad == ['true', True] and ok[0] != '' and ok[1:] == [None, False, False], [bad, ok])
        ev("Sheet.closeAll()"); p.wait_for_timeout(100)
    # —— #5 撤销提示不跨页 ——
    go('water'); ev("document.querySelector('[data-del]').click()"); p.wait_for_timeout(500)
    check('#5 删除后有撤销提示', '撤销' in ev("document.getElementById('toastRoot').textContent"))
    go('temp'); p.wait_for_timeout(200)
    check('#5 换页后别页的「撤销」收起', ev("[...document.querySelectorAll('#toastRoot .toast:not(.leaving)')].filter(t=>t.querySelector('.toast-action')).length") == 0)
    ev("Util.toast('刚弹的','ok',{label:'撤销',onClick:function(){}});App.showTab('water',{noVT:true})"); p.wait_for_timeout(100)
    check('#5 同一次操作里刚弹出的提示（<400ms）不收', '刚弹的' in ev("document.getElementById('toastRoot').textContent"))
    ev("document.querySelectorAll('#toastRoot .toast').forEach(t=>t._toastDismiss&&t._toastDismiss())"); p.wait_for_timeout(250)
    # —— #6 提示在主按钮 / 保存条之上 ——
    go('water'); p.click('[data-new]'); p.wait_for_timeout(400)
    ev("document.querySelectorAll('#modalRoot [data-q]')[1].click()"); p.click('#modalRoot .rs-savebar .rs-save'); p.wait_for_timeout(450)
    ov = ev("(()=>{const t=document.querySelector('#toastRoot .toast:not(.leaving)'),m=document.querySelector('.mod-cta > *');const a=t.getBoundingClientRect(),q=m.getBoundingClientRect();return [Math.round(a.bottom),Math.round(q.top)]})()")
    check('#6 保存后的提示在「+ 记录」主按钮上面', ov[0] <= ov[1], ov)
    p.click('[data-open]'); p.wait_for_timeout(600)
    ov2 = ev("(()=>{const t=document.querySelector('#toastRoot .toast:not(.leaving)'),s=[...document.querySelectorAll('#modalRoot .rs-save')].pop();const a=t.getBoundingClientRect(),q=s.getBoundingClientRect();return [Math.round(a.bottom),Math.round(q.top)]})()")
    check('#6 随后打开编辑面板，提示在「保存修改」上面', ov2[0] <= ov2[1], ov2)
    ev("Sheet.closeAll();document.querySelectorAll('#toastRoot .toast').forEach(t=>t._toastDismiss&&t._toastDismiss())"); p.wait_for_timeout(250)
    # —— #7 睡眠摘要 ——
    ev("(()=>{const d=Storage.get();d.sleeps.push({id:'s272',start:__L(Date.now()-5400e3),end:__L(Date.now()-1800e3),pausedMs:0,wakings:0});Storage.save()})()")
    go('sleep')
    sm = ev("document.querySelector('.mod-sum p').textContent")
    check('#7 睡眠摘要：今天的结束时间写「今天 HH:MM」，不写年月日', '结束于 今天 ' in sm and '年' not in sm, sm)
    check('#7 fmtDayHM：昨天 / 跨年', ev("Util.fmtDayHM(new Date(Date.now()-86400e3)).indexOf('昨天 ')===0 && /^2020年3月1日 08:05$/.test(Util.fmtDayHM(new Date(2020,2,1,8,5)))"))
    # —— #8 全站 ml ——
    bad8 = []
    for t in ('home', 'water', 'feeding', 'bottle', 'breast', 'pump', 'solid'):
        go(t)
        if ev("/\\dmL|\\d mL|>mL</.test(document.getElementById('view').innerHTML) || /mL/.test(document.querySelector('.mod-head')?document.querySelector('.mod-head').textContent:'')"): bad8.append(t)
    go('bottle'); ev("Modules.bottle._new(false)"); p.wait_for_timeout(300)
    if 'mL' in ev("document.getElementById('modalRoot').textContent"): bad8.append('bottle-sheet')
    ev("Sheet.closeAll()")
    check('#8 页面与瓶喂面板都写小写 ml', not bad8, bad8)
    # —— #9 「上次」写法 ——
    fa = ev("[Util.fmtAgo(new Date(Date.now()-59*60000)), Util.fmtAgo(new Date(Date.now()-2*3600e3))]")
    check('#9 fmtAgo：今天之内一律「N 分钟前 / N 小时前」', fa[0] == '59 分钟前' and fa[1] == '2 小时前', fa)
    f7 = ev("new Date().getHours()>=8 ? Util.fmtAgo(new Date(Date.now()-7*3600e3)) : '7 小时前'")
    check('#9 今天 7 小时前也写「7 小时前」（原来跳成「今天 HH:MM」）', f7 == '7 小时前', f7)
    hb = []
    for t in ('breast', 'bottle'):
        go(t); hb.append(ev("document.querySelector('.mod-head').textContent"))
    import re as _re
    check('#9 亲喂与瓶喂页头「上次」同一写法', all(_re.search(r'上次 (刚刚|\d+ 分钟前|\d+ 小时前|昨天 \d\d:\d\d|\d+ 天前|\d+月\d+日)', x) for x in hb), hb)
    # —— #10 尿布面板小标题间距 ——
    go('diaper'); p.click('[data-new]'); p.wait_for_timeout(500)
    gaps = ev("[...document.querySelectorAll('#modalRoot p.rs-lbl')].map(l=>{const pr=l.previousElementSibling;return pr?Math.round(l.getBoundingClientRect().top-pr.getBoundingClientRect().bottom):99})")
    check('#10 尿布面板「类型 / 量 / 屁屁情况」上方都有 ≥12px 间距', gaps and min(gaps) >= 12, gaps)
    ev("Sheet.closeAll()"); p.wait_for_timeout(100)
    # —— #11 键盘：备注框滚到保存条上面 ——
    go('water'); p.click('[data-new]'); p.wait_for_timeout(500)
    p.focus('#skNote'); p.set_viewport_size({'width': 390, 'height': 480}); p.wait_for_timeout(700)
    kb = ev("(()=>{const r=document.querySelector('#skNote').getBoundingClientRect(),s=[...document.querySelectorAll('#modalRoot .rs-save')].pop().getBoundingClientRect();return [Math.round(r.top),Math.round(r.bottom),Math.round(s.top),innerHeight]})()")
    check('#11 视口变矮（键盘）时备注框整块露出、在保存按钮上面', kb[0] >= 0 and kb[1] <= kb[2] - 6, kb)
    p.set_viewport_size({'width': 390, 'height': 844}); ev("Sheet.closeAll()"); p.wait_for_timeout(200)
    # —— 全站记录面板保存吸底 ——
    sheets = {
        '喝水': "App.showTab('water',{noVT:true});document.querySelector('[data-new]').click()",
        '体温（编辑）': "App.showTab('temp',{noVT:true});document.querySelector('[data-open]').click()",
        '洗澡': "App.showTab('bath',{noVT:true});document.querySelector('[data-new]').click()",
        '亲喂补记': "App.showTab('breast',{noVT:true});Modules.breast._manual()",
        '瓶喂': "App.showTab('bottle',{noVT:true});Modules.bottle._new(false)",
        '睡眠补记': "App.showTab('sleep',{noVT:true});document.querySelector('.ft-split-add').click()",
        '泵奶补记': "App.showTab('pump',{noVT:true});document.querySelector('.ft-split-add').click()",
        '喂养表单': "App.showTab('feeding',{noVT:true});(()=>{const m=document.querySelector('[data-fd-mask]');m.hidden=false;Sheet.attach(m)})()",
        '辅食': "App.showTab('solid',{noVT:true});document.querySelector('[data-new], .mc-main').click()",
        '亲喂结束保存': "App.showTab('breast',{noVT:true});Modules.breast._start();setTimeout(()=>document.querySelector('.ftf [data-f=stop]').click(),150)",
        '泵奶结束保存': "App.showTab('pump',{noVT:true});Storage.get().pumpTimer={start:new Date().toISOString(),L:true,R:true,segs:[]};Storage.save();Modules.pump._openFull();setTimeout(()=>document.querySelector('.ftf [data-p=stop]').click(),150)",
        '尿布': "App.showTab('diaper',{noVT:true});document.querySelector('[data-new]').click()",
    }
    bad = []
    for k, js in sheets.items():
        ev(js); p.wait_for_timeout(650)
        r = ev("""(()=>{const m=[...document.querySelectorAll('#modalRoot > .modal-mask:not(.sheet-ghost), #view .modal-mask:not([hidden])')].pop(); if(!m) return 'nosheet';
          const pn=m.querySelector('.is-sheet'); const bar=pn&&pn.querySelector('.rs-savebar'); if(!bar) return 'nobar';
          const sv=bar.querySelector('button.btn-primary, .ft-save, .rs-save'); const a=sv.getBoundingClientRect(), q=pn.getBoundingClientRect();
          const del=pn.querySelector('.rs-del'); const last=bar.parentElement.lastElementChild===bar;
          return [getComputedStyle(bar).position, Math.round(q.bottom-a.bottom), last, del?del.nextElementSibling===bar:null]})()""")
        ok = isinstance(r, list) and r[0] == 'sticky' and 0 <= r[1] <= 40 and r[2] and r[3] in (None, True)
        ev("(()=>{const pn=[...document.querySelectorAll('#modalRoot .is-sheet, #view .modal-mask:not([hidden]) .is-sheet')].pop(); if(pn) pn.scrollTop=1e5})()"); p.wait_for_timeout(120)
        end = ev("(()=>{const pn=[...document.querySelectorAll('#modalRoot .is-sheet, #view .modal-mask:not([hidden]) .is-sheet')].pop();if(!pn)return false;const bar=pn.querySelector('.rs-savebar');const pv=bar.previousElementSibling;return !pv||bar.getBoundingClientRect().top>=pv.getBoundingClientRect().bottom-1})()")
        if not ok or not end: bad.append([k, r, end])
        ev("Sheet.closeAll();document.querySelectorAll('#view .modal-mask').forEach(m=>m.hidden=true);(()=>{const d=Storage.get();d.feedingTimer=null;d.pumpTimer=null;Storage.save();document.querySelectorAll('.ftf').forEach(e=>e.remove());document.body.classList.remove('ftf-open')})()"); p.wait_for_timeout(120)
    check('保存吸底：喝水 / 体温编辑 / 洗澡 / 亲喂补记 / 亲喂结束 / 瓶喂 / 睡眠补记 / 泵奶补记 / 泵奶结束 / 喂养表单 / 辅食 / 尿布都吸在面板底，滚到底落回内容后，删除在保存条前', not bad, bad)
    check('第 272 次无报错', not errs, errs)
    p.close()


R273_SEED = r"""(()=>{const z=n=>String(n).padStart(2,'0');window.__L=t=>{t=new Date(t);return t.getFullYear()+'-'+z(t.getMonth()+1)+'-'+z(t.getDate())+'T'+z(t.getHours())+':'+z(t.getMinutes())+':'+z(t.getSeconds())};
  window.__dl=[];Util.download=function(n,t){window.__dl.push([n,String(t)])};})()"""
R273_TOASTS = "[...document.querySelectorAll('#toastRoot .toast:not(.leaving)')].map(t=>t.textContent).join('|')"
R273_CR = r"""(sel)=>{const lum=a=>{const c=a.slice(0,3).map(x=>{x/=255;return x<=.03928?x/12.92:Math.pow((x+.055)/1.055,2.4)});return .2126*c[0]+.7152*c[1]+.0722*c[2]};
  const b=[...document.querySelectorAll(sel)].pop(); if(!b) return null; const cs=getComputedStyle(b); const f=cs.color.match(/[\d.]+/g).map(Number), g=cs.backgroundColor.match(/[\d.]+/g).map(Number);
  if(g.length>3&&g[3]<1) return ['alpha',cs.backgroundColor]; const A=lum(f),B=lum(g); return Math.round((Math.max(A,B)+.05)/(Math.min(A,B)+.05)*100)/100}"""


def test_r273(b):
    """第 273 次：审计第二轮 13–21 条 + 记录面板保存按钮对比度。"""
    import csv as _csv
    import re as _re
    import io as _io
    p, errs = fresh(b)
    ev = p.evaluate
    ev(R273_SEED)

    def go(t):
        ev(f"App.showTab('{t}',{{noVT:true}})"); p.wait_for_timeout(220)

    def clear():
        ev("document.querySelectorAll('#toastRoot .toast').forEach(t=>t.remove());Sheet.closeAll();document.getElementById('modalRoot').innerHTML=''"); p.wait_for_timeout(60)
    # —— #13 宫缩按秒 ——
    fs = ev("[45000,50000,65000,600000,3660000].map(x=>Util.fmtSecDur(x))")
    check('#13 Util.fmtSecDur：45秒 / 50秒 / 1分05秒 / 10分 / 1小时1分', fs == ['45秒', '50秒', '1分05秒', '10分', '1小时1分'], fs)
    ev("""(()=>{const d=Storage.get();d.settings.stage='pregnancy';const m0=Math.floor((Date.now()-600e3)/60000)*60000;
      d.contractions=[{id:'c1',start:__L(m0+10e3),end:__L(m0+60e3)},{id:'c2',start:__L(m0+295e3),end:__L(m0+345e3)},{id:'c3',start:__L(m0+540e3+7e3),end:__L(m0+540e3+9e3)}];Storage.save()})()""")
    go('contraction')
    rows = ev("[...document.querySelectorAll('#view .list li')].map(l=>l.textContent.trim())")
    check('#13 列表：50 秒写「时长 50秒」、间隔写「距上次 4分45秒」，不再是 0分', len(rows) == 3 and '时长 50秒' in rows[0] and '距上次 4分45秒' in rows[1] and '时长 2秒' in rows[2] and not any('0分' in r for r in rows), rows)
    st = ev("[...document.querySelectorAll('#view .stat .stat-num')].map(s=>s.textContent)")
    check('#13 近一小时：平均时长 / 平均间隔同一「分秒」写法', len(st) == 3 and st[1] == '34秒' and st[2] == '4分29秒', st)
    ev("(()=>{const d=Storage.get();d.openContraction={id:'cx',start:__L(Date.now()-3200)};Storage.save();App.rerender()})()"); p.wait_for_timeout(150)
    check('#13 计时中读数按秒', ev("document.getElementById('cTimer').textContent") in ('3秒', '4秒'), ev("document.getElementById('cTimer').textContent"))
    p.click('#cEnd'); p.wait_for_timeout(200)
    check('#13 结束提示「本次宫缩 3秒」', '本次宫缩 3秒' in ev(R273_TOASTS) or '本次宫缩 4秒' in ev(R273_TOASTS), ev(R273_TOASTS))
    p.click('#cExport'); p.wait_for_timeout(100)
    tl = ev("(__dl.pop()||['',''])[1]")
    check('#13 导出时间线：时长 50秒、距上次 4分45秒', '时长 50秒 距上次 -' in tl and '时长 50秒 距上次 4分45秒' in tl and '0分' not in tl, tl[:300])
    clear()
    # —— #14 编辑保留秒 ——
    ev("RecordEdit.open('contraction',Storage.get().contractions.find(x=>x.id=='c3'))"); p.wait_for_timeout(200)
    p.select_option('#reF_intensity', '2'); p.click('[data-re-ok]'); p.wait_for_timeout(200)
    c3 = ev("Storage.get().contractions.find(x=>x.id=='c3')")
    check('#14 同一分钟内起止的宫缩：只改强度能保存，起止秒数原样', c3.get('intensity') == 2 and c3['start'].endswith(':07') and c3['end'].endswith(':09') and not ev("!!document.querySelector('#modalRoot .rec-edit')"), c3)
    ev("RecordEdit.open('contraction',Storage.get().contractions.find(x=>x.id=='c1'))"); p.wait_for_timeout(200)
    p.select_option('#reF_intensity', '3'); p.click('[data-re-ok]'); p.wait_for_timeout(200)
    c1 = ev("Storage.get().contractions.find(x=>x.id=='c1')")
    check('#14 跨分钟的宫缩：只改强度，开始仍是 :10 秒，时长仍 50 秒', c1['start'].endswith(':10') and c1['end'].endswith(':00') and c1.get('intensity') == 3, c1)
    ev("(()=>{const d=Storage.get();d.settings.stage='baby';d.sleeps.push({id:'ss3',start:'2026-10-10T13:05:17',end:'2026-10-10T14:20:43',pausedMs:0});d.feedings.push({id:'bb3',type:'breast',start:'2026-10-10T09:00:21',end:'2026-10-10T09:12:40',secL:400,secR:339,durationL:7,durationR:6,durationMin:12,side:'both'});Storage.save()})()")
    go('sleep'); clear()
    ev("RecordEdit.open('sleep',Storage.get().sleeps.find(x=>x.id=='ss3'))"); p.wait_for_timeout(200)
    p.fill('#reF_note', '改备注'); p.click('[data-re-ok]'); p.wait_for_timeout(200)
    s3 = ev("Storage.get().sleeps.find(x=>x.id=='ss3')")
    check('#14 睡眠只改备注：入睡 / 醒来的秒原样', s3['start'] == '2026-10-10T13:05:17' and s3['end'] == '2026-10-10T14:20:43' and s3.get('note') == '改备注', s3)
    ev("RecordEdit.open('feeding',Storage.get().feedings.find(x=>x.id=='bb3'))"); p.wait_for_timeout(200)
    p.fill('#reF_note', '改备注'); p.click('[data-re-ok]'); p.wait_for_timeout(200)
    b3 = ev("Storage.get().feedings.find(x=>x.id=='bb3')")
    check('#14 亲喂计时记录只改备注：开始秒数、secL/secR、durationMin 都不变', b3['start'] == '2026-10-10T09:00:21' and b3.get('secL') == 400 and b3.get('durationMin') == 12, b3)
    ev("RecordEdit.open('sleep',Storage.get().sleeps.find(x=>x.id=='ss3'))"); p.wait_for_timeout(200)
    p.fill('#reF_start', '2026-10-10T13:00'); p.click('[data-re-ok]'); p.wait_for_timeout(200)
    s3 = ev("Storage.get().sleeps.find(x=>x.id=='ss3')")
    check('#14 真改了时间才按分钟写（入睡 13:00:00，醒来仍 :43）', s3['start'] == '2026-10-10T13:00:00' and s3['end'] == '2026-10-10T14:20:43', s3)
    clear()
    # —— #15 泵奶编辑口径 ——
    ev("(()=>{const d=Storage.get();d.feedings.push({id:'pm15',type:'pump',start:'2026-10-10T07:00:00',end:'2026-10-10T07:15:00',durationL:15,durationR:15,durationMin:15,amountL:60,amountR:50,amount:110,side:'both'},{id:'pm16',type:'pump',start:'2026-10-10T06:00:00',secL:600,secR:600,durationL:10,durationR:10,durationMin:20,amountL:40,amount:40,side:'both'},{id:'pm17',type:'pump',start:'2026-10-10T05:00:00',amountL:40,amount:40,side:'left'});Storage.save()})()")
    go('pump')
    for rid in ('pm15', 'pm16', 'pm17'):
        ev(f"RecordEdit.open('feeding',Storage.get().feedings.find(x=>x.id=='{rid}'))"); p.wait_for_timeout(150)
        p.fill('#reF_note', '只改备注'); p.click('[data-re-ok]'); p.wait_for_timeout(150)
    pm = ev("['pm15','pm16','pm17'].map(i=>{const r=Storage.get().feedings.find(x=>x.id==i);return [r.durationMin,r.side,r.note]})")
    check('#15 泵奶只改备注：时长不变（15 不变 30；轮流泵 20 不变 10；只记奶量的侧别不丢）', pm == [[15, 'both', '只改备注'], [20, 'both', '只改备注'], [None, 'left', '只改备注']], pm)
    ev("RecordEdit.open('feeding',Storage.get().feedings.find(x=>x.id=='pm15'))"); p.wait_for_timeout(150)
    p.fill('#reF_durationL', '20'); p.click('[data-re-ok]'); p.wait_for_timeout(150)
    ev("RecordEdit.open('feeding',Storage.get().feedings.find(x=>x.id=='bb3'))"); p.wait_for_timeout(150)
    p.fill('#reF_durationL', '9'); p.click('[data-re-ok]'); p.wait_for_timeout(150)
    dm = ev("[Storage.get().feedings.find(x=>x.id=='pm15').durationMin, Storage.get().feedings.find(x=>x.id=='bb3').durationMin]")
    check('#15 改了分钟：泵奶 = max(左, 右)=20，亲喂 = 左 + 右=15', dm == [20, 15], dm)
    clear()
    # —— #16 导入覆盖计数 ——
    cnt = ev("""(()=>{const o={feedings:[],waters:[{id:1},{id:2}],temps:[{id:3}],fetal:[{id:4}],milkStash:[{id:5}],laborEvents:[{id:6}],supplements:[{id:7}],baths:[{id:8}],fetalSessions:[{id:9}]};
      const all=JSON.parse(JSON.stringify(Storage.get()));let n=0;Storage.RECORD_KEYS.forEach(k=>{if(Array.isArray(all[k]))n+=all[k].length});
      return [App._countRecords(o), App._countRecords(all)>=n, ['waters','temps','fetal','fetalSessions','milkStash','laborEvents','supplements','supplementPlans','baths','swims','suns','jaundices','supplies','moods','contractions','periods'].every(k=>Storage.RECORD_KEYS.includes(k)), Storage.RECORD_KEYS.indexOf('babies')]})()""")
    check('#16 覆盖确认计数含饮水 / 体温 / 胎动 / 储奶 / 破水见红 / 补剂 / 洗澡 / 胎动会话（只记这些的人不再显示 0 条）', cnt == [9, True, True, -1], cnt)
    # —— #17 泵奶奶量面板各种关法都保留 ——
    ev("Storage.get().pumpTimer=null;Storage.save()"); go('pump')
    p.click('[data-pstart]'); p.wait_for_timeout(450)
    kept = []
    for how in ('mask', 'closeTop', 'esc', 'x'):
        p.click('.ftf [data-p=mlL]'); p.wait_for_timeout(350)
        bb = p.locator('[data-pbtl] svg').bounding_box()
        p.mouse.move(bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] * 0.8); p.mouse.down()
        p.mouse.move(bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] * 0.6, steps=4); p.mouse.up(); p.wait_for_timeout(100)
        v = int(ev("document.querySelector('[data-pval]').textContent"))
        if how == 'mask': ev("(()=>{const m=document.querySelector('#modalRoot [data-ft-mask]');m.dispatchEvent(new MouseEvent('click',{bubbles:true}))})()")
        elif how == 'closeTop': ev("Sheet.closeTop()")
        elif how == 'esc': p.keyboard.press('Escape')
        else: p.click('#modalRoot [data-x]')
        p.wait_for_timeout(250)
        kept.append([how, v > 0 and ev("Storage.get().pumpTimer.mlL") == v, ev("document.querySelector('.ftf [data-pv=mlL]').textContent") == f'{v} ml'])
        ev("Storage.get().pumpTimer.mlL=null;Storage.save();Modules.pump._openFull()"); p.wait_for_timeout(100)
    check('#17 奶量面板：点遮罩 / 下拉（closeTop）/ Esc / ✕ 关掉都留住已拖的奶量，全屏上同步显示', all(k[1] and k[2] for k in kept), kept)
    # —— #19 泵奶 / 亲喂：不到 1 分钟、撤销 ——
    n0 = ev("Storage.get().feedings.length")
    ev("(()=>{const t=Storage.get().pumpTimer;t.start=t.since=__L(Date.now()-3000);t.accL=t.accR=t.accT=0;t.mlL=t.mlR=null;Storage.save()})()")
    p.click('.ftf [data-p=stop]'); p.wait_for_timeout(350); p.click('[data-psave]'); p.wait_for_timeout(250)
    t = ev(R273_TOASTS)
    check('#19 泵 3 秒没填奶量：不存、结束计时，提示带撤销', ev("Storage.get().feedings.length") == n0 and not ev("Storage.get().pumpTimer") and '不到 1 分钟' in t and '撤销' in t, t)
    ev("[...document.querySelectorAll('#toastRoot .toast-action')].pop().click()"); p.wait_for_timeout(200)
    check('#19 撤销后泵奶计时放回', bool(ev("Storage.get().pumpTimer")))
    clear()
    ev("(()=>{const t=Storage.get().pumpTimer;t.start=t.since=__L(Date.now()-40000);t.accL=t.accR=t.accT=0;t.mlL=30;Storage.save()})()")
    ev("Modules.pump._openFull()"); p.wait_for_timeout(150)
    p.click('.ftf [data-p=stop]'); p.wait_for_timeout(350); p.click('[data-psave]'); p.wait_for_timeout(250)
    t = ev(R273_TOASTS); last = ev("Storage.get().feedings.slice(-1)[0]")
    check('#19 泵 40 秒填了 30 ml：照存（按秒）、提示带撤销', last['type'] == 'pump' and 40 <= (last.get('secL') or 0) <= 45 and last.get('amount') == 30 and '撤销' in t, [t, last])
    go('pump')
    row = ev("(()=>{const b=document.querySelector('[data-open=\"'+Storage.get().feedings.slice(-1)[0].id+'\"]');return b?b.textContent:''})()")
    check('#19 泵奶行：不到 1 分钟写秒，不再「左 1分」', bool(_re.search(r'左 4\d秒', row)) and '1分' not in row, row)
    ev("[...document.querySelectorAll('#toastRoot .toast-action')].pop().click()"); p.wait_for_timeout(200)
    check('#19 泵奶保存后撤销：删记录、计时放回', ev("Storage.get().feedings.length") == n0 and bool(ev("Storage.get().pumpTimer")))
    ev("Storage.get().pumpTimer=null;Storage.save();Modules.pump._closeFull()"); clear(); go('pump')
    p.click('[data-padd]'); p.wait_for_timeout(350); p.fill('#pmLM', '10'); p.click('[data-pmsave]'); p.wait_for_timeout(200)
    t = ev(R273_TOASTS)
    ev("[...document.querySelectorAll('#toastRoot .toast-action')].pop().click()"); p.wait_for_timeout(200)
    check('#19 泵奶补记带撤销，撤销后删掉', '撤销' in t and ev("Storage.get().feedings.length") == n0, t)
    clear(); go('breast')
    ev("Modules.breast._start()"); p.wait_for_timeout(300)
    ev("(()=>{const t=Storage.get().feedingTimer;t.start=t.sideStart=__L(Date.now()-13000);Storage.save()})()")
    p.click('.ftf [data-f=stop]'); p.wait_for_timeout(350); p.click('#modalRoot [data-save]'); p.wait_for_timeout(250)
    t = ev(R273_TOASTS)
    check('#19 亲喂 13 秒：不存成 1 分钟，结束计时，提示带撤销', ev("Storage.get().feedings.length") == n0 and not ev("Storage.get().feedingTimer") and '不到 1 分钟' in t and '撤销' in t, t)
    ev("[...document.querySelectorAll('#toastRoot .toast-action')].pop().click()"); p.wait_for_timeout(200)
    check('#19 撤销后亲喂计时放回', bool(ev("Storage.get().feedingTimer")))
    clear()
    ev("(()=>{const t=Storage.get().feedingTimer;t.start=t.sideStart=__L(Date.now()-300000);Storage.save()})()")
    ev("Modules.breast._openFull ? Modules.breast._openFull() : Modules.breast._start()"); p.wait_for_timeout(250)
    p.click('.ftf [data-f=stop]'); p.wait_for_timeout(350); p.click('#modalRoot [data-save]'); p.wait_for_timeout(250)
    t = ev(R273_TOASTS)
    ok5 = ev("Storage.get().feedings.length") == n0 + 1 and '撤销' in t
    ev("[...document.querySelectorAll('#toastRoot .toast-action')].pop().click()"); p.wait_for_timeout(200)
    check('#19 亲喂 5 分钟正常保存带撤销，撤销删记录、计时放回', ok5 and ev("Storage.get().feedings.length") == n0 and bool(ev("Storage.get().feedingTimer")), t)
    ev("Storage.get().feedingTimer=null;Storage.save();Modules.breast._closeFull()"); clear()
    ev("Modules.breast._manual()"); p.wait_for_timeout(300); p.fill('#mL', '8'); p.click('#modalRoot [data-save]'); p.wait_for_timeout(200)
    t = ev(R273_TOASTS)
    ev("[...document.querySelectorAll('#toastRoot .toast-action')].pop().click()"); p.wait_for_timeout(200)
    check('#19 亲喂补记带撤销，撤销后删掉', '撤销' in t and ev("Storage.get().feedings.length") == n0, t)
    clear()
    # —— #18 / #20 记账 ——
    go('finance')
    nf = ev("Storage.get().finance.records.length")
    for bad_amt in ('0', '-3'):
        p.fill('#fAmt', bad_amt); p.click('#fSave'); p.wait_for_timeout(150)
    check('#20 记账 0 元、负数都存不进去，金额框标红', ev("Storage.get().finance.records.length") == nf and ev("document.querySelector('#fAmt').getAttribute('aria-invalid')") == 'true')
    p.fill('#fAmt', '0.01'); p.click('#fSave'); p.wait_for_timeout(150)
    check('#20 0.01 元可以存', ev("Storage.get().finance.records.length") == nf + 1)
    ev("(()=>{const r=Storage.get().finance.records;r.push({id:'q1',amount:128.5,category:'产检',note:'奶粉,两罐 \"大\"',date:'2026-10-10'},{id:'q2',amount:9,category:'其他',note:'第一行\\n第二行\\r',date:'2026-10-09'});Storage.save()})()")
    go('finance'); ev("__dl=[]"); p.click('#fExp'); p.wait_for_timeout(100)
    csvt = ev("(__dl.pop()||['',''])[1]")
    rows = list(_csv.reader(_io.StringIO(csvt.lstrip('\ufeff'), newline='')))
    nr = [r for r in rows if r]
    check('#18 记账 CSV：带 BOM，逗号 / 引号 / 换行按 RFC 4180 转义，每行 4 列，内容原样', csvt.startswith('\ufeff') and all(len(r) == 4 for r in nr)
          and ['2026-10-10', '产检', '128.5', '奶粉,两罐 "大"'] in nr and ['2026-10-09', '其他', '9', '第一行\n第二行\r'] in nr and '\r\n' in csvt, nr[:4])
    go('settings')
    ev("(()=>{const s=document.querySelector('#sCsvModule');s.value='finance'})()")
    with p.expect_download() as dl:
        ev("document.querySelector('#sCsv').click()")
    raw = open(dl.value.path(), 'rb').read().decode('utf-8')
    rows2 = [r for r in _csv.reader(_io.StringIO(raw.lstrip('\ufeff'), newline='')) if r]
    check('#18 设置页 CSV 同一转义（含回车）', raw.startswith('\ufeff') and all(len(r) == 4 for r in rows2) and any(r[3] == '第一行\n第二行\r' for r in rows2), rows2[:3])
    clear()
    # —— #21 搜索 ——
    ev("(()=>{const d=Storage.get();d.feedings.push({id:'sb21',type:'bottle',start:'2026-10-10T10:50:00',amount:125,amountBm:125,src:'bm'},{id:'sp21',type:'pump',start:'2026-10-10T07:30:00',amountL:60,amountR:65,amount:125,durationL:15,durationR:15,durationMin:15,note:'泵二一'},{id:'ss21',type:'solid',start:'2026-10-10T08:00:00',unit:'spoon',qty:3,dish:'南瓜泥二一'},{id:'sq21',type:'pump',start:'2026-10-10T06:30:00',secL:41,secR:41,durationL:1,durationR:1,durationMin:1,amountL:30,amount:30,note:'短泵二一'});Storage.save()})()")
    go('search')
    res = {}
    for q in ('125', '泵二一', '南瓜泥二一', '短泵二一'):
        p.fill('#searchInput', q); p.wait_for_timeout(350)
        res[q] = ev("[...document.querySelectorAll('#view .sr-sub, #view li small, #view li .li-sub')].map(x=>x.textContent).join(' || ') || document.querySelector('#view').innerText")
    bt = res['125']
    check('#21 搜索瓶喂：奶量只写一次「母乳 125 ml」，没有 ml/g', 'ml/g' not in bt and bt.count('125') >= 1 and '母乳 125 ml · 125' not in bt and '母乳 125 ml' in bt, bt[:200])
    check('#21 搜索泵奶：「共 125 ml」，没有 ml/g', '共 125 ml' in res['泵二一'] and 'ml/g' not in res['泵二一'], res['泵二一'][:200])
    check('#21 搜索辅食：按自己的单位写「3 勺」', '3 勺' in res['南瓜泥二一'] and 'ml/g' not in res['南瓜泥二一'], res['南瓜泥二一'][:200])
    check('#21 搜索 41 秒泵奶：左右写秒，不写「1 分」', '左 41 秒' in res['短泵二一'] and '1 分' not in res['短泵二一'], res['短泵二一'][:200])
    clear()
    # —— 保存按钮对比度（浅 / 深） ——
    panels = {
        '喝水': "App.showTab('water',{noVT:true});document.querySelector('[data-new]').click()",
        '体温编辑': "App.showTab('temp',{noVT:true});document.querySelector('[data-open]').click()",
        '洗澡': "App.showTab('bath',{noVT:true});document.querySelector('[data-new]').click()",
        '日晒': "App.showTab('sun',{noVT:true});document.querySelector('[data-new]').click()",
        '黄疸': "App.showTab('jaundice',{noVT:true});document.querySelector('[data-new]').click()",
        '喂养表单': "App.showTab('feeding',{noVT:true});(()=>{const m=document.querySelector('[data-fd-mask]');m.hidden=false;Sheet.attach(m)})()",
        '尿布': "App.showTab('diaper',{noVT:true});document.querySelector('[data-new]').click()",
        '亲喂补记': "App.showTab('breast',{noVT:true});Modules.breast._manual()",
        '泵奶补记': "App.showTab('pump',{noVT:true});document.querySelector('.ft-split-add').click()",
        '辅食': "App.showTab('solid',{noVT:true});document.querySelector('[data-new], .mc-main').click()",
    }
    lows = []
    for dark in (False, True):
        ev(f"document.body.classList.toggle('dark',{str(dark).lower()})"); p.wait_for_timeout(100)
        for k, js in panels.items():
            ev(js); p.wait_for_timeout(350)
            r = ev(R273_CR, '#modalRoot .rs-savebar button, #view .modal-mask:not([hidden]) .rs-savebar button')
            if not isinstance(r, (int, float)) or r < 4.5: lows.append([('深' if dark else '浅') + k, r])
            ev("Sheet.closeAll();document.getElementById('modalRoot').innerHTML='';document.querySelectorAll('#view .modal-mask').forEach(m=>m.hidden=true)"); p.wait_for_timeout(60)
    ev("document.body.classList.remove('dark')")
    check('记录面板「保存 / 保存修改」文字对比度浅 / 深色都 ≥4.5:1（WCAG AA）', not lows, lows)
    check('第 273 次无报错', not errs, errs)
    p.close()


R274_PUNCT = r"""()=>{const m=document.body.textContent.match(/.{0,18}([。！？；，、：]{2,}|。」。|[，、；]」|——。|…。).{0,4}/g);return m?m.slice(0,3):[]}"""


def test_r274(b):
    """第 274 次：审计第三轮 22–29 条 + CSV 防公式注入。"""
    import csv as _csv
    import io as _io
    p, errs = fresh(b)
    ev = p.evaluate
    ev(R273_SEED)

    def go(t):
        ev(f"App.showTab('{t}',{{noVT:true}})"); p.wait_for_timeout(220)

    def st():
        return ev("({tab:App.currentTab(),ftf:document.querySelectorAll('body>.ftf').length,cls:document.body.classList.contains('ftf-open'),wn:!!document.querySelector('#wnPlayer.open')})")
    # —— #22 全屏计时层 + 返回 ——
    bad = []
    for tab, start, clear in (('sleep', "Modules.sleep._start();Modules.sleep._openFull()", "Storage.get().openSleep=null"),
                              ('breast', "Modules.breast._start()", "Storage.get().feedingTimer=null"),
                              ('pump', "Modules.pump._start()", "Storage.get().pumpTimer=null"),
                              ('feeding', "Modules.breast._start()", "Storage.get().feedingTimer=null")):
        go('home'); go(tab); ev(start); p.wait_for_timeout(250)
        s0 = st()
        ev("history.back()"); p.wait_for_timeout(450)
        s1 = st()
        if not (s0['ftf'] == 1 and s1 == {'tab': tab, 'ftf': 0, 'cls': False, 'wn': False}): bad.append([tab, s0, s1])
        ev(clear + ";Storage.save()"); go('home')
    check('#22 睡眠 / 亲喂 / 泵奶 / 喂养页里的亲喂全屏开着时返回：只收起全屏层、留在原页，不残留', not bad, bad)
    go('sleep'); ev("Modules.sleep._start();Modules.sleep._openFull()"); p.wait_for_timeout(200)
    go('water')
    s2 = st()
    check('#22 全屏计时开着时程序化切页：全屏层一起收掉，不挡下一页', s2 == {'tab': 'water', 'ftf': 0, 'cls': False, 'wn': False}, s2)
    ev("Storage.get().openSleep=null;Storage.save()"); go('home')
    ev("Modules.whitenoise._open=true"); go('whitenoise'); p.wait_for_timeout(300)
    w0 = st(); ev("history.back()"); p.wait_for_timeout(500); w1 = st()
    check('#22 白噪音播放页开着时返回：带着播放页一起离开（dock 返回语义，第 271 次），不残留', w0['wn'] and w1['tab'] == 'home' and not w1['wn'] and not ev("document.documentElement.classList.contains('wp-lock')"), [w0, w1])
    go('home')
    # —— #23 跨午夜睡眠同一口径 ——
    ev("""(()=>{const d=Storage.get();const t0=new Date();t0.setHours(0,0,0,0);const T=t0.getTime();
      d.sleeps=[{id:'x1',start:__L(T-90*60e3),end:__L(T+10*60e3),pausedMs:0,wakings:0},{id:'x2',start:__L(T+60*60e3),end:__L(T+120*60e3),pausedMs:0,wakings:0}];
      d.openSleep=null;Storage.save()})()""")
    late = ev("new Date().getHours()*60+new Date().getMinutes()") < 125
    go('sleep')
    sm = ev("document.querySelector('#view .mod-sum').textContent")
    dash = ev("(document.querySelector('#view .sl-dash .dash-num')||{}).textContent||''")
    check('#23 睡眠页摘要只算跨夜那一觉落在今天的 10 分钟（共 1 小时 10 分），与「今日睡眠」看板一致', late or ('今天已结束的睡眠共 1 小时 10 分' in sm and dash.replace(' ', '') == '1小时10分'), [sm, dash])
    ds = ev("[Math.round(Util.daySleep(Storage.get().sleeps,Util.todayISO(),0).min),Math.round(Util.daySleep(Storage.get().sleeps,Util.addDays(Util.todayISO(),-1),0).min)]")
    check('#23 Util.daySleep：今天 70 分、昨天 90 分（按午夜切开）', late or ds == [70, 90], ds)
    idx = ev("(()=>{const i=Util.buildDayIndex(Storage.get()),t=Util.todayISO(),y=Util.addDays(t,-1);const f=a=>(a||[]).filter(x=>x.icon=='sleep').map(x=>[x.time,x.val,x.note||'',!!x.cont]);return [f(i[t]),f(i[y])]})()")
    check('#23 日历两天都列出：昨天 22:30「1小时30分 · 跨夜…共 1小时40分」、今天 00:00「10分 · 接前一天 22:30 入睡」', 
          ['22:30', '1小时30分', '跨夜 · 次日 00:10 醒，共 1小时40分', False] in idx[1] and ['00:00', '10分', '接前一天 22:30 入睡，共 1小时40分', True] in idx[0], idx)
    go('calendar')
    note = ev("[...document.querySelectorAll('#view .day-list .dl-note')].map(e=>e.textContent)")
    check('#23 日历「今天的记录」里有跨夜那一觉的接续行（说明另起一行小字）', note == ['接前一天 22:30 入睡，共 1小时40分'], note)
    hm = ev("""(()=>{const h=document.createElement('div');Modules.home.render(h);return 1})()""")
    hs = ev("""(()=>{const d=Storage.get();d.settings.homeCards=(d.settings.homeCards||[]);return Math.round(Util.daySleep(d.sleeps,Util.dayKeyOf(new Date(),Util.dayStartHour(d)),Util.dayStartHour(d),{live:d.openSleep}).min)})()""")
    check('#23 首页今日睡眠 / 今日概览与睡眠页同一函数同一口径', late or (hm == 1 and hs == 70), [hm, hs])
    # —— #24 上周同期截到同一时刻 ——
    ev("""(()=>{const d=Storage.get();['feedings','sleeps','diapers','waters','meds','temps','moods','fetal','contractions','growth','milestones'].forEach(k=>{if(Array.isArray(d[k]))d[k]=[]});
      d.vaccines.done={};if(d.finance)d.finance.records=[];if(d.prenatal)d.prenatal.records=[];d.periods=[];
      const n=new Date();const a=new Date(n);a.setDate(n.getDate()-7);a.setHours(0,1,0,0);const b2=new Date(n);b2.setDate(n.getDate()-7);b2.setHours(23,59,0,0);
      const c=new Date(n);c.setDate(n.getDate()-6);c.setHours(12,0,0,0);const t=new Date(n.getTime()-60e3);
      d.diapers=[{id:'r1',time:__L(a),type:'pee'},{id:'r2',time:__L(b2),type:'pee'},{id:'r3',time:__L(c),type:'pee'},{id:'r4',time:__L(t),type:'pee'}];Storage.save()})()""")
    go('home'); go('calendar')
    rv = ev("document.querySelector('#view .review-card p').textContent")
    edge = ev("new Date().getHours()==23&&new Date().getMinutes()>=59") or ev("new Date().getHours()==0&&new Date().getMinutes()<2")
    check('#24 回顾「上周同期」只算上周一到上周同一天、截到现在这个钟点（4 条里只算 1 条），并写明范围', edge or ('上周同期（上周一' in rv and '到这个钟点）是 1 条' in rv and '本周已记录 ' in rv), rv)
    # —— #26 记账金额与口径 ——
    ym = ev("+Util.todayISO().slice(5,7)")
    ev("""(()=>{const d=Storage.get();const t=Util.todayISO();d.finance.records=[{id:'f1',amount:100,category:'奶粉',note:null,date:'2025-09-30'},{id:'f2',amount:0.1,category:'奶粉',note:null,date:t},{id:'f3',amount:0.2,category:'用品',note:'=HYPERLINK("x")',date:t}];Storage.save()})()""")
    go('home'); go('finance')
    hd = ev("(document.querySelector('#view .mod-head')||{}).textContent||''")
    card = ev("[...document.querySelectorAll('#view .card')].find(c=>/统计/.test(c.querySelector('h2')&&c.querySelector('h2').textContent)).textContent")
    nums = ev("[...document.querySelectorAll('#view .li-num')].map(e=>e.textContent)")
    check('#26 页头「本月（N 月）已花 ¥0.30」，两位小数', f'本月（{ym} 月）已花 ¥0.30' in hd, hd)
    check('#26 统计卡分写本月 / 全部（自最早一笔起），分类注明全部记录，统一 ¥ 两位小数', f'本月（{ym} 月）支出：¥0.30' in card and '全部（2025-09-30 起）支出：¥100.30' in card and '按分类（全部记录）' in card and '奶粉：¥100.10' in card and '元' not in card, card)
    check('#26 明细金额 ¥0.10 / ¥0.20 / ¥100.00；Util.fmtYuan 坏值回落 ¥0.00', nums == ['¥0.10', '¥0.20', '¥100.00'] and ev("[Util.fmtYuan(0.3),Util.fmtYuan('x'),Util.fmtYuan(12)]") == ['¥0.30', '¥0.00', '¥12.00'], nums)
    # —— CSV 防公式注入 ——
    cc = ev("""['=1+1','+1','-2','@x','\\tA','正常',-5,0.2,'a-b'].map(v=>Util.csvCell(v))""")
    check('CSV：= + - @ / 制表符开头的文字前加 \'，数字与普通文字原样', cc == ["'=1+1", "'+1", "'-2", "'@x", "'\tA", '正常', '-5', '0.2', 'a-b'], cc)
    ev("__dl=[]"); p.click('#fExp'); p.wait_for_timeout(100)
    rows = list(_csv.reader(_io.StringIO(ev("(__dl.pop()||['',''])[1]").lstrip('\ufeff'), newline='')))
    check('CSV：记账导出里以 = 开头的备注带 \' 前缀，解析回来其余不变', any(r[-1] == "'=HYPERLINK(\"x\")" for r in rows) and any(r[:3] == ['2025-09-30', '奶粉', '100'] for r in rows), rows[:4])
    ev("""(()=>{const d=Storage.get();d.supplies=[{id:'sp1',name:'=cmd|x',cat:'用品',date:Util.todayISO(),price:12,qty:1,unit:'包',availDays:10}];Storage.save()})()""")
    go('home'); go('supplies'); ev("__dl=[]"); p.click('#spExport'); p.wait_for_timeout(100)
    sp = ev("(__dl.pop()||['',''])[1]")
    srows = list(_csv.reader(_io.StringIO(sp.lstrip('\ufeff'), newline='')))
    check('CSV：消耗品导出改走 Util.toCsv（BOM、CRLF、防公式注入）', sp.startswith('\ufeff') and '\r\n' in sp and len(srows) >= 2 and srows[1][0] == "'=cmd|x", srows[:2])
    # —— #27 重复标点 ——
    ev("t=>Storage.importJSON(t)", SEED_V3); p.reload(); p.wait_for_timeout(700); ev(R273_SEED)
    hits = []
    for stage in ('baby', 'pregnancy'):
        if stage == 'pregnancy':
            ev("(()=>{const s=Storage.get();s.settings.stage='pregnancy';s.settings.dueDate=Util.addDays(Util.todayISO(),60);Storage.save()})()")
        for t in TABS + ['pump', 'alltools']:
            try:
                go(t)
            except Exception:
                continue
            h = ev(R274_PUNCT)
            if h: hits.append([stage, t, h])
    check('#27 全站（宝宝 / 孕期两个阶段、全部页面）没有「。。」「，。」这类重复标点', not hits, hits)
    ev("(()=>{const s=Storage.get();s.settings.stage='baby';Storage.save()})()")
    # —— #29 今日概览不折行 ——
    ev("""(()=>{const d=Storage.get();const y=new Date();y.setDate(y.getDate()-1);y.setHours(20,0,0,0);
      d.sleeps.push({id:'n29',start:__L(y),end:__L(y.getTime()+228*60e3),pausedMs:0,wakings:0});d.diapers.push({id:'d29',time:__L(Date.now()-60e3),type:'pee'});Storage.save()})()""")
    bad29 = []
    for scale in ('normal', 'xl'):
        ev(f"(()=>{{const s=Storage.get();s.settings.fontScale='{scale}';Storage.save()}})()"); p.reload(); p.wait_for_timeout(700)
        go('calendar')
        r = ev("""[...document.querySelectorAll('#view .today-overview .stat')].map(s=>{const n=s.querySelector('.stat-num'),u=s.querySelector('.stat-unit'),l=s.querySelector('.stat-lbl');
          const nr=n.getBoundingClientRect(),ur=u.getBoundingClientRect(),sr=s.getBoundingClientRect(),lh=parseFloat(getComputedStyle(l).lineHeight)||parseFloat(getComputedStyle(l).fontSize)*1.6;
          return {t:s.textContent,oneLine:ur.top<nr.bottom&&ur.bottom>nr.top,inside:ur.right<=sr.right+0.5,lbl1:l.getBoundingClientRect().height<lh*1.5}})""")
        if not r or not all(x['oneLine'] and x['inside'] and x['lbl1'] for x in r): bad29.append([scale, r])
        if scale == 'normal':
            lb = ev("[...document.querySelectorAll('#view .today-overview .stat-lbl')].map(e=>e.textContent)")
    ev("(()=>{const s=Storage.get();s.settings.fontScale='normal';Storage.save()})()")
    check('#29 日历今日概览：数字和单位同一行、不出格，标签一行（标准 / 最大字号）', not bad29, bad29)
    check('#29 第一格标签写「昨夜最长」', lb and lb[0] == '昨夜最长', lb)
    # —— #28 深色对比度 ——
    p.reload(); p.wait_for_timeout(700); ev(R273_SEED)
    ev("document.body.classList.add('dark')")
    lows = []
    for t in ('bath', 'swim', 'sun', 'breast', 'sleep', 'pump'):
        go(t)
        r = ev(R273_CR, '#view .ft-split')
        if not isinstance(r, (int, float)) or r < 4.5: lows.append([t, r])
    go('diaper')
    for dark in (True, False):
        ev(f"document.body.classList.toggle('dark',{str(dark).lower()})"); p.wait_for_timeout(60)
        r = ev(R273_CR, '#view .hero-badge')
        if not isinstance(r, (int, float)) or r < 4.5: lows.append(['diaper-badge' + ('深' if dark else '浅'), r])
    acc = ev("""(()=>{document.body.classList.add('dark');const o=[];['feeding','sleep','growth','period','pregnancy','packing','contraction','finance','diaper','vaccine','meds','milestone','fetal','temp','mood','supplies','jaundice','bath','swim','sun','water','supplement','whitenoise','breast','bottle','pump','solid'].forEach(a=>{
      const e=document.createElement('button');e.className='ft-save';e.setAttribute('data-accent',a);e.textContent='保存';document.getElementById('view').appendChild(e);const cs=getComputedStyle(e);o.push([a,cs.color,cs.backgroundColor]);e.remove()});return o})()""")
    def _l(c):
        v = [float(x) / 255 for x in c[c.index('(') + 1:c.index(')')].split(',')[:3]]
        v = [x / 12.92 if x <= .03928 else ((x + .055) / 1.055) ** 2.4 for x in v]
        return .2126 * v[0] + .7152 * v[1] + .0722 * v[2]
    for a, fg, bg in acc:
        A, B = _l(fg), _l(bg); r = (max(A, B) + .05) / (min(A, B) + .05)
        if r < 4.5: lows.append(['ft-save深 ' + a, round(r, 2)])
    ev("document.body.classList.remove('dark')")
    check('#28 深色下洗澡 / 游泳 / 日晒「开始」按钮、尿布角标（浅深）、全部 27 个模块色的 --tile-on 按钮文字对比度 ≥4.5:1', not lows, lows)
    # —— #25 SW 更新自动重载后回到原页 ——
    go('home'); go('sleep'); ev("Modules.sleep._start();Modules.sleep._openFull()"); p.wait_for_timeout(200)
    ev("App._saveRestore();location.reload()"); p.wait_for_timeout(1600)
    r1 = st()
    hs1 = ev("JSON.stringify(history.state)")
    ev("history.back()"); p.wait_for_timeout(450); r2 = st()
    ev("history.back()"); p.wait_for_timeout(450); r3 = st()
    check('#25 自动重载后回到睡眠页、全屏计时照原样打开；返回先收起全屏、再回首页', r1['tab'] == 'sleep' and r1['ftf'] == 1 and '"id":"sleep"' in hs1 and r2['tab'] == 'sleep' and r2['ftf'] == 0 and r3['tab'] == 'home', [r1, hs1, r2, r3])
    ev("Storage.get().openSleep=null;Storage.save()")
    go('settings'); ev("document.querySelectorAll('#view .set-group summary')[1].click()"); p.wait_for_timeout(200)
    h1 = ev("document.querySelector('#view .page-head h1').textContent")
    ev("App._saveRestore();location.reload()"); p.wait_for_timeout(1600)
    r4 = ev("[App.currentTab(),App.inSub(),document.querySelector('#view .page-head h1').textContent]")
    check('#25 设置二级页里重载：回到同一组', r4 == ['settings', True, h1], [r4, h1])
    ev("history.back()"); p.wait_for_timeout(300); ev("history.back()"); p.wait_for_timeout(300)
    go('water'); ev("App._saveRestore();(()=>{const r=JSON.parse(sessionStorage.getItem('yiyaRestore'));r.t-=180000;sessionStorage.setItem('yiyaRestore',JSON.stringify(r))})();location.reload()"); p.wait_for_timeout(1600)
    check('#25 超过 2 分钟的恢复标记作废，照常落首页', ev("App.currentTab()") == 'home' and ev("sessionStorage.getItem('yiyaRestore')") is None)
    check('第 274 次无报错', not errs, errs)
    p.close()



# ---------------- 第 275 次：启动白屏 + iOS dock 真折射 ----------------
class _SlowSW(http.server.SimpleHTTPRequestHandler):
    """第 275 次专用：sw.js 去掉本机绕过（让 127.0.0.1 下 SW 真正接管），并可对指定路径加延迟模拟弱网。"""
    DELAY = {}
    def log_message(self, *a):
        pass

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_GET(self):
        import time as _t
        path = self.path.split('?')[0]
        for k, v in list(_SlowSW.DELAY.items()):
            if k == '*' or path.endswith(k):
                _t.sleep(v)
                break
        if path.endswith('/sw.js'):
            data = (ROOT / 'sw.js').read_bytes().replace(
                rb"if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(self.location.hostname)) return;", b'')
            self.send_response(200)
            self.send_header('Content-Type', 'application/javascript')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        return super().do_GET()


def _slow_server():
    s2 = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(_SlowSW, directory=str(ROOT)))
    s2.daemon_threads = True
    threading.Thread(target=s2.serve_forever, daemon=True).start()
    return s2, f'http://127.0.0.1:{s2.server_address[1]}/'


STANDALONE = "Object.defineProperty(navigator,'standalone',{get:()=>true});" \
    "window.__bt={};new MutationObserver(()=>{const b=document.getElementById('boot');" \
    "if(b){if(b.classList.contains('is-play'))__bt.play=1;if(b.classList.contains('is-out'))__bt.out=1;}" \
    "else if(!__bt.gone&&document.body)__bt.gone=performance.now();}).observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});"


def test_r275_boot(b):
    """第 275 次 A：启动白屏——首帧样式、脚本 defer、SW 缓存优先、启动层兜底与慢启动不加播动画。"""
    import re as _re
    import struct as _st
    html = (ROOT / 'index.html').read_text(encoding='utf-8')
    sw = (ROOT / 'sw.js').read_text(encoding='utf-8-sig')
    man = json.loads((ROOT / 'manifest.webmanifest').read_text(encoding='utf-8'))
    srcs = _re.findall(r'<script src="([^"]+)"([^>]*)></script>', html)
    check('#275 只有 boot.js 同步，其余脚本全部 defer', srcs and srcs[0][0] == 'js/boot.js' and 'defer' not in srcs[0][1]
          and all('defer' in a for n, a in srcs[1:]), [n for n, a in srcs[1:] if 'defer' not in a])
    check('#275 页面里没有内联脚本（CSP 不放开 unsafe-inline）', not _re.search(r'<script(?![^>]*\bsrc=)[^>]*>', html)
          and "script-src 'self';" in html)
    head = html.split('<link rel="stylesheet"')[0]
    check('#275 styles.css 之前内联了启动层关键样式，底色 #221E1A', '<style>' in head and 'html.is-booting' in head and '#221E1A' in head)
    tc = _re.search(r'<meta name="theme-color" content="([^"]+)"', html).group(1)
    check('#275 启动底色 = manifest background_color = 初始 theme-color', man['background_color'].upper() == tc.upper() == '#221E1A', [man['background_color'], tc])
    check('#275 所有脚本都在 SW 预缓存里', all(("'" + n + "'") in sw for n, a in srcs), [n for n, a in srcs if ("'" + n + "'") not in sw])
    check('#275 SW 版本 v244（第 280 次升）', "var CACHE = 'baoma-static-v244';" in sw)
    bi = ROOT / 'assets' / 'boot-icon.webp'
    bootsec = html.split('id="boot"')[1].split('</div></div>')[0]
    check('#275 启动层图标 / 字图内联为 data URI（首帧即有，不等低优先级图片请求），整页 HTML < 60KB',
          bootsec.count('src="data:image/webp;base64,') == 2 and len(html.encode()) < 60000, len(html.encode()))
    check('#275 引导页图标改用 336px webp（<60KB，原 512 png 387KB）且进预缓存', bi.exists() and bi.stat().st_size < 60000
          and "'assets/boot-icon.webp'" in sw and 'src="assets/boot-icon.webp"' in (ROOT / 'js' / 'app.js').read_text(encoding='utf-8'), bi.stat().st_size if bi.exists() else None)
    bad = []
    for media, href in _re.findall(r'<link rel="apple-touch-startup-image" media="([^"]+)" href="([^"]+)">', html):
        w = int(_re.search(r'device-width: (\d+)px', media).group(1)); h = int(_re.search(r'device-height: (\d+)px', media).group(1))
        r = int(_re.search(r'pixel-ratio: (\d+)', media).group(1))
        f = ROOT / href
        if not f.exists():
            bad.append(href); continue
        pw_, ph_ = _st.unpack('>II', f.read_bytes()[16:24])
        if (pw_, ph_) != (w * r, h * r):
            bad.append((href, pw_, ph_))
    check('#275 iOS 启动图：11 个机型尺寸齐全且像素与 media 对得上', not bad and html.count('apple-touch-startup-image') >= 11, bad)

    srv2, base = _slow_server()
    try:
        # SW 缓存优先：装好后服务器每个请求都慢 4 秒，热启动不受影响
        ctx = b.new_context(viewport={'width': 390, 'height': 844})
        p = ctx.new_page(); errs = []
        p.on('pageerror', lambda e: errs.append(str(e)[:160]))
        p.goto(base); p.wait_for_timeout(600)
        p.evaluate('t=>Storage.importJSON(t)', SEED_V3)
        reg_after_load = p.evaluate("(()=>{const n=performance.getEntriesByType('navigation')[0];return n.loadEventEnd})()")
        p.reload()
        _poll(p, '!!navigator.serviceWorker.controller', 15000)
        p.wait_for_timeout(1200)
        _SlowSW.DELAY = {'*': 4.0}
        p2 = ctx.new_page()
        p2.on('pageerror', lambda e: errs.append(str(e)[:160]))
        p2.goto(base, wait_until='domcontentloaded', timeout=30000)
        t = p2.evaluate("(()=>{const n=performance.getEntriesByType('navigation')[0];return [n.domContentLoadedEventEnd, !!document.querySelector('#view .card, #view .home-sky')]})()")
        _SlowSW.DELAY = {}
        # 第 277 次：八组并行（2 核）时实测 2.19 秒偶发超线，门槛放到 3 秒——仍远小于每个请求 4 秒的网络延迟，结论不变
        check('#275 SW 接管后热启动不等网络（服务器每请求慢 4 秒，DOMContentLoaded < 3 秒）', t[0] < 3000, t)
        check('#275 热启动首页照常画出', t[1], t)
        ctx.close()
        # SW 注册在 load 之后
        ctx = b.new_context(viewport={'width': 390, 'height': 844})
        ctx.add_init_script("window.__reg=0;const R=ServiceWorkerContainer.prototype.register;ServiceWorkerContainer.prototype.register=function(){window.__reg=performance.now();return R.apply(this,arguments)};")
        p = ctx.new_page(); p.goto(base); p.wait_for_timeout(1500)
        rv = p.evaluate("[window.__reg, performance.getEntriesByType('navigation')[0].loadEventEnd]")
        check('#275 SW 注册挪到 load 之后（不和首屏抢带宽）', rv[0] > 0 and rv[0] >= rv[1], rv)
        ctx.close()
        # 启动层兜底：脚本迟迟不到时不能 5 秒就拆掉露出空白页
        ctx = b.new_context(viewport={'width': 390, 'height': 844})
        p = ctx.new_page(); p.goto(base); p.evaluate('t=>Storage.importJSON(t)', SEED_V3); p.wait_for_timeout(1500)
        p.evaluate("async()=>{for(const r of await navigator.serviceWorker.getRegistrations())await r.unregister();for(const k of await caches.keys())await caches.delete(k);}")
        p.close()
        ctx.add_init_script(STANDALONE)
        _SlowSW.DELAY = {'js/app.js': 6.5}
        p = ctx.new_page(); p.goto(base, wait_until='commit')
        p.wait_for_timeout(5800)
        still = p.evaluate("[!!document.getElementById('boot'), typeof App === 'undefined']")
        check('#275 脚本没到齐（app.js 慢 6.5 秒）时 5 秒后启动层仍在，不露空白页', still == [True, True], still)
        p.wait_for_timeout(4500)
        bt = p.evaluate("[!!document.getElementById('boot'), window.__bt, !!document.querySelector('#view .card, #view .home-sky')]")
        check('#275 慢启动：首页画好后直接淡出，不再加播 1.7 秒弹跳动画', (not bt[0]) and bt[1].get('out') == 1 and not bt[1].get('play') and bt[2], bt)
        _SlowSW.DELAY = {}
        ctx.close()
        # 快启动：照常播动画
        ctx = b.new_context(viewport={'width': 390, 'height': 844})
        ctx.add_init_script(STANDALONE)
        p = ctx.new_page(); p.goto(base); p.evaluate('t=>Storage.importJSON(t)', SEED_V3)
        p.reload(); p.wait_for_timeout(3500)
        bt = p.evaluate('window.__bt')
        check('#275 快启动（首页 <1.5 秒画好）：仍播启动动画，播完移除', bt.get('play') == 1 and bt.get('gone', 0) > 0 and bt['gone'] < 3700, bt)  # 第 277 次：八组并行（2 核）实测 3438ms 偶发超线，放到 3.7 秒（动画 1.7 秒 + 启动，仍远小于慢启动路径）
        ctx.close()
        check('#275 启动相关无报错', not errs, errs)
    finally:
        _SlowSW.DELAY = {}
        srv2.shutdown()


def _dock_px(p):
    return p.evaluate("(()=>{const r=document.getElementById('tabbar').getBoundingClientRect();return {x:r.left-6,y:r.top-6,width:r.width+12,height:r.height+12}})()")


def _img_diff(a, b2):
    from PIL import Image, ImageChops, ImageStat
    import io as _io
    A = Image.open(_io.BytesIO(a)).convert('RGB'); B = Image.open(_io.BytesIO(b2)).convert('RGB')
    st = ImageStat.Stat(ImageChops.difference(A, B))
    return round(sum(st.mean) / 3, 2)


DBG_CSS = "html.lgdbg #tabbar > :not(canvas){visibility:hidden!important} html.lgdbg #tabbar{background:transparent!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important;box-shadow:none!important;border-color:transparent!important} html.lgdbg #tabbar::before,html.lgdbg #tabbar::after{display:none!important} html.lgtruth #tabbar{visibility:hidden!important} html.lgdbg #dockOrb, html.lgtruth #dockOrb{visibility:hidden!important}"


def test_r275_glass(b):
    """第 275 次 B：dock 真折射（快照 + WebGL）——对齐、复用、释放、降级、设置开关。Chromium 里用 lgGlForce 强制走 iOS 路径。"""
    p, errs = fresh(b)
    ev = p.evaluate
    ev("localStorage.setItem('lgGlForce','1');Storage.get().settings.dockGlass='on';Storage.save()")
    p.reload(); p.wait_for_timeout(1800)
    p.add_style_tag(content=DBG_CSS)
    st = ev('DockRefract._stats()')
    check('#275 折射层：1 个 WebGL 上下文、2 张纹理、着色器编译通过', st['on'] and st['ready'] and st['ctxLive'] == 1 and st['texLive'] == 2 and not st['err'], st)
    order = ev("(()=>{const b=document.getElementById('tabbar');const k=[...b.children].map(e=>e.classList.contains('lg-gl')?'gl':e.classList.contains('lg-thumb')?'thumb':'x');return [k.indexOf('gl'),k.indexOf('thumb'),document.documentElement.classList.contains('lg-gl'),document.documentElement.classList.contains('lg-refract')]})()")
    check('#275 画布是底栏第一个子节点、水滴在它之上；开着时不再叠 SVG 折射', order[0] == 0 and order[1] == 1 and order[2] and not order[3], order)
    check('#275 dock 按钮仍可点（画布不挡命中）', ev("(()=>{const t=document.querySelector('#tabbar .tab-plus');const r=t.getBoundingClientRect();return document.elementFromPoint(r.left+r.width/2,r.top+r.height/2).closest('.tab-plus')===t})()"))

    def fidelity(tab, sy):
        ev(f"App.showTab('{tab}',{{noVT:true}})"); p.wait_for_timeout(1300)
        ev(f"window.scrollTo(0,{sy})"); p.wait_for_timeout(700)
        clip = _dock_px(p)
        ev("document.documentElement.classList.add('lgtruth')"); p.wait_for_timeout(60)
        truth = p.screenshot(clip=clip)
        ev("document.documentElement.classList.remove('lgtruth');document.documentElement.classList.add('lgdbg');DockRefract._debug=true;DockRefract._draw()"); p.wait_for_timeout(80)
        snap = p.screenshot(clip=clip)
        ev("document.documentElement.classList.remove('lgdbg');DockRefract._debug=false;DockRefract._draw()")
        return _img_diff(truth, snap)
    d1 = fidelity('feeding', 260)
    check('#275 快照与页面对齐：喂养页滚到中段，dock 背后快照与真实页面平均色差 < 10', d1 < 10, d1)
    d2 = fidelity('home', 9999)
    check('#275 快照与页面对齐：首页滚到底', d2 < 10, d2)
    # 滚动后（不手动重画）也对齐：滚动事件驱动的那一帧用的是新滚动量
    ev("App.showTab('feeding',{noVT:true})"); p.wait_for_timeout(1300)
    ev("window.scrollTo(0,120)"); p.wait_for_timeout(500)
    ev("document.documentElement.classList.add('lgdbg');DockRefract._debug=true;DockRefract._draw()")
    ev("window.scrollTo(0,300)"); p.wait_for_timeout(250)
    clip = _dock_px(p); snap = p.screenshot(clip=clip)
    ev("document.documentElement.classList.remove('lgdbg');document.documentElement.classList.add('lgtruth')"); p.wait_for_timeout(60)
    truth = p.screenshot(clip=clip)
    ev("document.documentElement.classList.remove('lgtruth');DockRefract._debug=false;DockRefract._draw()")
    d3 = _img_diff(truth, snap)
    check('#275 滚动时折射层跟着滚（滚动事件那一帧已用新位置）', d3 < 10, d3)
    # 左右手竖排
    ev("document.body.classList.add('dock-left')"); p.wait_for_timeout(300)
    ev("LiquidDock.refresh()"); p.wait_for_timeout(900)
    cv = ev("(()=>{const c=document.querySelector('#tabbar canvas.lg-gl'),b=document.getElementById('tabbar').getBoundingClientRect(),r=c.getBoundingClientRect();return [Math.round(r.width-b.width),Math.round(r.height-b.height),b.height>b.width&&DockRefract._stats().ready]})()")
    check('#275 左手竖排：画布跟着竖排胶囊（与边框盒同大，盖住 1px 透明边框）', cv[0] == 0 and cv[1] == 0 and cv[2], cv)
    ev("document.body.classList.remove('dock-left');LiquidDock.refresh()"); p.wait_for_timeout(600)
    # 反复切页：不新建上下文 / 纹理，节点与画布数不涨
    tabs = ['home', 'feeding', 'diaper', 'sleep', 'whitenoise', 'settings', 'calendar', 'growth', 'search', 'home']

    def spin(n):
        for i in range(n):
            ev(f"App.showTab('{tabs[i % len(tabs)]}',{{noVT:true}})"); p.wait_for_timeout(120)
        ev("App.showTab('home',{noVT:true})"); p.wait_for_timeout(1500)
        return ev("(()=>{const s=DockRefract._stats();return {els:document.getElementsByTagName('*').length,cv:document.getElementsByTagName('canvas').length,ctx:s.ctxCreated,live:s.ctxLive,tex:s.texCreated,texLive:s.texLive,re:s.uploadsRealloc,sub:s.uploadsSub,page:s.page}})()")
    a = spin(10); z = spin(50)
    check('#275 切页 50 次：上下文 / 纹理不新建（各 1 / 2），DOM 节点与画布数不涨', z['ctx'] == a['ctx'] == 1 and z['tex'] == a['tex'] == 2 and z['texLive'] == 2
          and z['els'] == a['els'] and z['cv'] == a['cv'], [a, z])
    check('#275 重拍复用同一张纹理（同尺寸走 texSubImage2D，不重新分配）', z['re'] == a['re'] and z['sub'] > a['sub'], [a, z])
    # 上下文丢失 / 恢复
    ev("(()=>{const c=document.querySelector('#tabbar canvas.lg-gl');window.__lc=c.getContext('webgl').getExtension('WEBGL_lose_context');__lc.loseContext()})()"); p.wait_for_timeout(300)
    lost = ev("document.querySelector('#tabbar canvas.lg-gl').classList.contains('on')")
    ev("__lc.restoreContext()"); p.wait_for_timeout(1500)
    rs = ev('DockRefract._stats()')
    check('#275 WebGL 上下文丢失时边缘淡出，恢复后重建并继续画', (not lost) and rs['ready'] and rs['ctxLive'] == 1 and rs['texLive'] == 2, [lost, rs])
    # 高对比：停掉并释放
    ev("document.body.classList.add('hc')"); p.wait_for_timeout(400)
    hc = ev("(()=>{const s=DockRefract._stats();return [s.on,s.ctxLive,s.texLive,!!document.querySelector('canvas.lg-gl'),document.documentElement.classList.contains('lg-gl')]})()")
    check('#275 高对比模式：折射层停掉（上下文 / 纹理 / 画布全部释放）', hc == [False, 0, 0, False, False], hc)
    ev("document.body.classList.remove('hc');LiquidDock.refresh()"); p.wait_for_timeout(1500)
    check('#275 退出高对比后恢复', ev('DockRefract._stats().ready'))
    # 设置开关
    ev("App.showTab('settings',{noVT:true})"); p.wait_for_timeout(500)
    has = ev("!!document.getElementById('sDockGlass')")
    ev("(()=>{const x=document.getElementById('sDockGlass');if(!x)return;if(x.closest('details'))x.closest('details').open=true;x.checked=false;x.dispatchEvent(new Event('change'))})()"); p.wait_for_timeout(400)
    off = ev("(()=>{const s=DockRefract._stats();return [Storage.get().settings.dockGlass,s.on,s.ctxLive,s.texLive,!!document.querySelector('canvas.lg-gl'),document.documentElement.classList.contains('lg-refract')]})()")
    check('#275 设置里关掉「底栏液态玻璃折射」：释放全部资源，Chromium 回到 SVG 折射', has and off == ['off', False, 0, 0, False, False] or (has and off[:5] == ['off', False, 0, 0, False]), off)
    ev("(()=>{const x=document.getElementById('sDockGlass');x.checked=true;x.dispatchEvent(new Event('change'))})()"); p.wait_for_timeout(1800)
    check('#275 再打开：重新建起（自动档）', ev("Storage.get().settings.dockGlass==='auto'&&DockRefract._stats().on"))
    check('#275 存储清洗认 dockGlass，不认乱值', ev("(()=>{const d=JSON.parse(Storage.exportJSON());d.settings.dockGlass='<x>';Storage.importJSON(JSON.stringify(d));return Storage.get().settings.dockGlass===undefined})()"))
    # 真机路径：iPhone UA 下默认就走它（不需要强制）
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')
    q = ctx.new_page(); q.goto(URL); q.wait_for_timeout(600); q.evaluate('t=>Storage.importJSON(t)', SEED_V3); q.reload(); q.wait_for_timeout(1800)
    ios = q.evaluate("[DockRefract._stats().on, document.documentElement.classList.contains('lg-refract')]")
    check('#275 iPhone UA：默认开 WebGL 折射，不开 SVG 折射', ios == [True, False], ios)
    ctx.close()
    check('#275 折射层无报错', not errs, errs)

TOUCH_JS = r"""([x0,y0,x1,y1,end,steps,ms])=>new Promise(res=>{const t=document.elementFromPoint(x0,y0)||document.body;
 const mk=(x,y)=>new Touch({identifier:1,target:t,clientX:x,clientY:y,pageX:x,pageY:y+scrollY});
 const fire=(ty,x,y)=>{const tt=ty==='touchend'?[]:[mk(x,y)];const e=new TouchEvent(ty,{bubbles:true,cancelable:true,touches:tt,targetTouches:tt,changedTouches:[mk(x,y)]});t.dispatchEvent(e);return e};
 if(x0!==null&&steps>=0)fire('touchstart',x0,y0);const n=Math.max(1,steps);let i=0;
 const step=()=>{i++;fire('touchmove',x0+(x1-x0)*i/n,y0+(y1-y0)*i/n);if(i<n)setTimeout(step,ms);else{if(end)setTimeout(()=>{fire('touchend',x1,y1);res(1)},end===2?150:0);else res(1)}};
 setTimeout(step,ms)})"""


def test_r276(b):
    """第 276 次：整屏侧拉页（跟手 / 速度 / history / 状态栏 / 减少动态）、搜索移出 dock + 首页下拉搜索、内存审计四项。"""
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, has_touch=True)
    p = ctx.new_page(); errs = []
    p.on('pageerror', lambda e: errs.append(str(e)[:160]))
    p.goto(URL); p.wait_for_timeout(600); p.evaluate('t=>Storage.importJSON(t)', SEED_V3); p.reload(); p.wait_for_timeout(900)
    ev = p.evaluate
    drag = lambda *a: ev(TOUCH_JS, list(a))
    tc = lambda: ev("document.querySelector('meta[name=theme-color]').content")
    X = "(()=>{const r=document.getElementById('sideDrawer'),a=document.getElementById('app');return [Math.round(r.getBoundingClientRect().left),Math.round(new DOMMatrix(getComputedStyle(a).transform).m41),+(+getComputedStyle(document.getElementById('sdMask')).opacity).toFixed(2)]})()"
    # —— A：跟手拖拽 ——
    drag(6, 420, 6 + 156, 424, False, 8, 16); p.wait_for_timeout(60)
    x = ev(X)
    check('#276 侧拉页跟手：拉到 40% 时侧拉页从左边进来、底下页右移约 11%、压暗 0.4', abs(x[0] - (-390 * 0.6 + 8 * 0)) <= 14 and abs(x[1] - 390 * 0.4 * 0.28) <= 8 and 0.3 <= x[2] <= 0.5, x)
    check('#276 拖到不足一半：状态栏还是底下那页（压暗后）的颜色', tc().lower() not in ('#ffffff', '#121110'), tc())
    drag(None, 0, 162, 424, 2, 0, 0); p.wait_for_timeout(700)  # 停住再松手
    check('#276 停住后在 40% 松手：回弹收起', ev("!Drawer.isOpen()&&!document.body.classList.contains('sd-open')"))
    p.wait_for_timeout(500)
    drag(6, 420, 6 + 90, 424, True, 3, 12); p.wait_for_timeout(700)
    # 第 277 次：八组并行时 setTimeout 步距被拉长、甩动速度不够，最多再甩两次（断言不变）
    for _i in range(2):
        if ev("Drawer.isOpen()"):
            break
        p.wait_for_timeout(300); drag(6, 420, 6 + 90, 424, True, 2, 8); p.wait_for_timeout(700)
    check('#276 快速甩一下（只拉 22%）也能打开（速度阈值）', ev("Drawer.isOpen()"), ev(X))
    x = ev(X)
    check('#276 打开：侧拉页整屏盖住、底下页右移 28%', x[0] == 0 and abs(x[1] - 109) <= 2, x)
    check('#276 打开：状态栏取侧拉页底色（侧拉页进了 overlayStack）', tc().lower() == '#ffffff' and 'side-drawer' in ' '.join(ev("__statusOverlay()")), [tc(), ev("__statusOverlay()")])
    check('#276 打开：登记一条 history、页面 inert', ev("[JSON.stringify(history.state), document.getElementById('app').inert]") == ['{"baoma":"drawer"}', True])
    drag(300, 400, 80, 404, False, 6, 16); p.wait_for_timeout(50)
    xm = ev(X)
    check('#276 在侧拉页上左拉：跟手往左收', -230 <= xm[0] <= -190, xm)
    drag(None, 0, 80, 404, 2, 0, 0); p.wait_for_timeout(800)
    check('#276 左拉过半松手：收起，history 退回、页面可点', ev("[Drawer.isOpen(), history.state===null||history.state.baoma!=='drawer', document.getElementById('app').inert]") == [False, True, False])
    # 返回键 / 系统返回 / Esc
    ev("Drawer.open()"); p.wait_for_timeout(500)
    ev("document.querySelector('#sideDrawer .sd-back').click()"); p.wait_for_timeout(600)
    check('#276 侧拉页左上「返回」关闭', ev("!Drawer.isOpen()&&App.currentTab()=='home'"))
    ev("Drawer.open()"); p.wait_for_timeout(500)
    ev("history.back()"); p.wait_for_timeout(600)
    check('#276 系统返回（popstate）先关侧拉页，留在首页', ev("[Drawer.isOpen(), App.currentTab()]") == [False, 'home'])
    ev("Drawer.open()"); p.wait_for_timeout(400); ev("App._openBabySheet()"); p.wait_for_timeout(400)
    ev("history.back()"); p.wait_for_timeout(600)
    check('#276 侧拉页上盖着切换宝宝面板时返回：先关面板，侧拉页还开着', ev("[Drawer.isOpen(), !!document.querySelector('#modalRoot .modal-mask:not(.sheet-leaving)')]") == [True, False])
    p.keyboard.press('Escape'); p.wait_for_timeout(600)
    check('#276 Esc 关闭侧拉页', ev("!Drawer.isOpen()"))
    hl = ev("history.length")
    for _ in range(3):
        ev("Drawer.open()"); p.wait_for_timeout(450); ev("Drawer.close()"); p.wait_for_timeout(450)
    check('#276 反复开关侧拉页 history 不增长（前进栈清掉）', ev("history.length") <= hl + 1, [hl, ev("history.length")])
    # 搜索框：进搜索页并聚焦
    ev("Drawer.open()"); p.wait_for_timeout(450)
    ev("document.querySelector('#sideDrawer .sd-search').click()"); p.wait_for_timeout(500)
    check('#276 侧拉页搜索框：进搜索页、输入框聚焦、侧拉页那条 history 改写成搜索页', ev("[App.currentTab(), document.activeElement&&document.activeElement.id, Drawer.isOpen(), history.state&&history.state.id]") == ['search', 'searchInput', False, 'search'])
    check('#276 搜索页改为二级页：dock 只有 返回 + ＋', ev("(()=>{const b=document.getElementById('tabbar');return [...b.children].filter(e=>e.offsetParent&&e.offsetWidth).map(e=>e.id||e.className.split(' ')[0])})()") == ['backBtn', 'tab'], ev("(()=>{const b=document.getElementById('tabbar');return [...b.children].filter(e=>e.offsetParent&&e.offsetWidth).map(e=>e.id||e.className)})()"))
    ev("document.getElementById('backBtn').click()"); p.wait_for_timeout(600)
    check('#276 搜索页返回首页', ev("App.currentTab()") == 'home')
    # 深色 + 左手竖排
    ev("(()=>{const s=Storage.get().settings;s.themeMode='dark';s.handMode='left';Storage.save();App.applyTheme();App.buildTabbar()})()"); p.wait_for_timeout(300)
    ev("Drawer.open()"); p.wait_for_timeout(600)
    _poll(p, "document.getElementById('sideDrawer').getBoundingClientRect().left===0", 2000)
    dk = ev("(()=>{const r=document.getElementById('sideDrawer').getBoundingClientRect(),t=document.getElementById('tabbar');const e=document.elementFromPoint(40,700);return [getComputedStyle(document.getElementById('sideDrawer')).backgroundColor, Math.round(r.left), Math.round(r.width), !!e&&!t.contains(e)]})()")
    check('#276 深色 + 左手竖排：侧拉页深底整屏、盖住竖排 dock', dk[0] == 'rgb(18, 17, 16)' and dk[1] == 0 and dk[2] == 390 and dk[3], dk)
    check('#276 深色：状态栏取侧拉页深底', tc().lower() == '#121110', tc())
    ev("Drawer.close()"); p.wait_for_timeout(500)
    ev("(()=>{const s=Storage.get().settings;s.themeMode='light';s.handMode='normal';Storage.save();App.applyTheme();App.buildTabbar()})()"); p.wait_for_timeout(300)
    # 键盘：输入框聚焦时打开侧拉页 → 收起键盘
    ev("(()=>{const i=document.createElement('input');i.id='tmpI';document.getElementById('view').appendChild(i);i.focus()})()")
    ev("Drawer.open()"); p.wait_for_timeout(400)
    check('#276 打开侧拉页时收起键盘（输入框失焦）、焦点进侧拉页', ev("[document.activeElement.id!=='tmpI', document.getElementById('sideDrawer').contains(document.activeElement)]") == [True, True])
    ev("Drawer.close();document.getElementById('tmpI').remove()"); p.wait_for_timeout(500)
    # —— B：dock 与首页下拉 ——
    check('#276 dock 一级页：宝宝 + 首页 / 日期 + ＋，选中水滴在首页', ev("(()=>{const b=document.getElementById('tabbar');const tabs=[...b.querySelectorAll('.tab[data-tab]')].filter(e=>e.offsetParent).map(e=>e.dataset.tab);const th=b.querySelector('.lg-thumb'),a=b.querySelector('.tab.active');return [tabs.join(), !!th&&Math.abs(th.getBoundingClientRect().left-a.getBoundingClientRect().left)<2]})()") == ['home,calendar', True])
    ev("window.scrollTo(0,0)"); p.wait_for_timeout(100)
    drag(200, 300, 200, 360, False, 6, 16); p.wait_for_timeout(50)
    ps = ev("(()=>{const b=document.querySelector('.pull-search');return [+getComputedStyle(b).opacity>0, b.classList.contains('is-armed'), Math.round(new DOMMatrix(getComputedStyle(document.getElementById('view')).transform).m42)]})()")
    check('#276 首页下拉：页面跟手下移、搜索栏浮出，没过阈值不触发', ps[0] and not ps[1] and 15 <= ps[2] < 72, ps)
    drag(None, 0, 200, 360, True, 0, 0); p.wait_for_timeout(700)
    check('#276 首页下拉没过阈值松手：弹回、留在首页', ev("[App.currentTab(), getComputedStyle(document.getElementById('view')).transform, +getComputedStyle(document.querySelector('.pull-search')).opacity]") == ['home', 'none', 0])
    drag(200, 260, 200, 520, False, 10, 16); p.wait_for_timeout(50)
    check('#276 首页下拉过阈值：搜索栏变「松手搜索」', ev("document.querySelector('.pull-search').classList.contains('is-armed')"))
    drag(None, 0, 200, 520, True, 0, 0); p.wait_for_timeout(500)
    check('#276 首页下拉松手：进搜索页并聚焦输入框', ev("[App.currentTab(), document.activeElement&&document.activeElement.id, getComputedStyle(document.getElementById('view')).transform]") == ['search', 'searchInput', 'none'])
    ev("document.getElementById('backBtn').click()"); p.wait_for_timeout(600)
    ev("window.scrollTo(0,400)"); p.wait_for_timeout(150)
    drag(200, 300, 200, 520, True, 8, 16); p.wait_for_timeout(400)
    check('#276 页面不在顶部时下拉不接管（正常滚动）', ev("[App.currentTab(), document.querySelector('.pull-search')?+getComputedStyle(document.querySelector('.pull-search')).opacity:0]") == ['home', 0])
    ev("window.scrollTo(0,0)")
    ev("App.showTab('alltools',{noVT:true})"); p.wait_for_timeout(300)
    ev("document.querySelector('.home-search[data-go=search]').click()"); p.wait_for_timeout(400)
    check('#276 「全部功能」页搜索框仍进搜索页', ev("App.currentTab()") == 'search')
    ev("App.showTab('home',{noVT:true})"); p.wait_for_timeout(300)
    # —— C1：照片 objectURL LRU ——
    ph = ev("""(async()=>{let rv=0;const R=URL.revokeObjectURL;URL.revokeObjectURL=function(u){rv++;return R.call(URL,u)};
      const cv=document.createElement('canvas');cv.width=cv.height=8;const blob=await new Promise(r=>cv.toBlob(r,'image/jpeg'));
      const ids=[];for(let i=0;i<20;i++)ids.push(await Photos.put(blob));
      for(const id of ids)await Photos.url(id);
      const live1=Photos._live(), rv1=rv;
      const im=document.createElement('img');im.src=await Photos.url(ids[0]);document.body.appendChild(im);
      Photos.prune(true);const live2=Photos._live();im.remove();Photos.prune(true);
      URL.revokeObjectURL=R;return [live1, rv1, live2, Photos._live()]})()""")
    check('#276 照片 objectURL：最多留 12 个（LRU），超出的 revoke', ph[0] == 12 and ph[1] == 8, ph)
    check('#276 照片 objectURL：页面上正用着的不收；切后台 / 删记录后收掉其余', ph[2] == 1 and ph[3] == 0, ph)
    # —— C2：插画按需预热 ——
    ev("Hero.warm()"); p.wait_for_timeout(1200)
    w0 = ev("Hero._warmList()")
    check('#276 插画：首页只预热页头插画（≤12 张），没有尿布 / 声音 / 辅食图组', 1 <= len(w0) <= 12 and not any(('/diaper/' in x or '/sounds/' in x or '/solid/' in x) for x in w0), w0)
    ev("App.showTab('diaper',{noVT:true})"); p.wait_for_timeout(300)
    check('#276 插画：进尿布页才载尿布类型图', sum('/diaper/' in x for x in ev("Hero._warmList()")) == 10)
    ev("App.showTab('home',{noVT:true})"); p.wait_for_timeout(300)
    check('#276 插画：离开尿布页放掉尿布图组', sum('/diaper/' in x for x in ev("Hero._warmList()")) == 0)
    ev("document.querySelector('[data-go=whitenoise]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))"); p.wait_for_timeout(300)
    check('#276 插画：手指按到入口就预热那一页（插画 + 声音画卡）', sum('/sounds/' in x for x in ev("Hero._warmList()")) == 9 and 'assets/hero/whitenoise.webp' in ev("Hero._warmList()"))
    check('#276 插画：按下后进页，页头插画同帧可画（已解码）', ev("(()=>{App.showTab('whitenoise',{noVT:true});const im=document.querySelector('.mod-hero img');return !!im&&im.complete&&im.naturalWidth>0&&!im.classList.contains('hero-pending')})()"))
    ev("App.showTab('home',{noVT:true})"); p.wait_for_timeout(200)
    HID = "(v)=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>v});Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>v?'hidden':'visible'});document.dispatchEvent(new Event('visibilitychange'))}"
    ev(HID, True); p.wait_for_timeout(100)
    check('#276 切到后台：插画引用全部放掉、玻璃常驻循环停掉', ev("[Hero._warmed(), Glass._loopOn()]") == [0, False], ev("[Hero._warmed(), Glass._loopOn()]"))
    # 只数 glass.js 排的 rAF（无头 Chromium 里假装隐藏时天空的 rAF 仍会派发，真机隐藏时浏览器本来就不派发）
    raf = ev("(async()=>{let n=0;const R=requestAnimationFrame;window.requestAnimationFrame=function(f){if(/glass\\.js/.test(new Error().stack||''))n++;return R.call(window,f)};await new Promise(r=>setTimeout(r,1000));window.requestAnimationFrame=R;return n})()")
    ev(HID, False); p.wait_for_timeout(900)
    check('#276 回到前台：玻璃循环恢复、插画重新预热', ev("[Glass._loopOn(), Hero._warmed()>0]") == [True, True], ev("[Glass._loopOn(), Hero._warmed()]"))
    # —— C4：首页帧率 ——
    fr = ev("(async()=>{const s0=window.__skyPaints||0;let n=0;const R=requestAnimationFrame;window.requestAnimationFrame=function(f){n++;return R.call(window,f)};await new Promise(r=>setTimeout(r,2000));window.requestAnimationFrame=R;return [((window.__skyPaints||0)-s0)/2,n/2]})()")
    check('#276 首页天空约 30fps 绘制（不再 60fps）', 8 <= fr[0] <= 34, fr)
    check('#276 后台时（hidden）玻璃不再排 rAF（原来每帧一次）', raf == 0, raf)
    # —— C3：白噪音定时只生成循环段 ——
    ev(FAKE_AUDIO)
    ev("App.showTab('whitenoise',{noVT:true})"); p.wait_for_timeout(200)
    ev("(()=>{const s=Storage.get();s.whitenoise=Object.assign(s.whitenoise||{},{minutes:30,type:'pink',volume:3});Storage.save()})()")
    p.click('.wn-art[data-type="pink"]'); p.wait_for_timeout(400)
    if not ev("document.getElementById('wpToggle').getAttribute('data-state')=='starting'"):
        p.click('#wpToggle'); p.wait_for_timeout(120)
    ev("__FA[__FA.length-1]._ok()"); p.wait_for_timeout(150)
    wn = ev("[Storage.get().whitenoise.minutes, Storage.get().whitenoise.until-Date.now(), Modules.whitenoise._eng()]")
    check('#276 白噪音定时 30 分钟：只生成 32 秒循环段（约 0.5 MB，原整段 29 MB）、loop 播放、挂好定时器', 400000 < wn[2]['bytes'] < 600000 and wn[0] == 30 and wn[1] > 29 * 60000 and wn[2]['loop'] is True and wn[2]['stopT'], wn)
    ev("__FA[__FA.length-1].pause()"); p.wait_for_timeout(120)
    check('#276 白噪音：暂停时撤掉定时器、保留剩余时间', ev("[Modules.whitenoise._eng().stopT, Storage.get().whitenoise.leftMs>29*60000]") == [False, True])
    ev("__FA[__FA.length-1]._ok()"); p.wait_for_timeout(150)
    check('#276 白噪音：继续播放按剩余时间重新挂定时器', ev("[Modules.whitenoise._eng().stopT, Storage.get().whitenoise.playing]") == [True, True])
    ev("(()=>{const w=Storage.get().whitenoise;w.until=Date.now()+6000;Storage.save();__FA[__FA.length-1].ontimeupdate()})()"); p.wait_for_timeout(150)
    tl = ev("[Modules.whitenoise._eng(), Storage.get().whitenoise.playing]")
    check('#276 白噪音：到点前由进度事件换成淡出尾巴（不循环），状态仍是播放中', tl[0]['bytes'] < 130000 and tl[0]['tail'] and tl[0]['loop'] is False and tl[1], tl)
    ev("(()=>{const a=__FA[__FA.length-1];a.ended=true;a.onended&&a.onended()})()"); p.wait_for_timeout(200)
    check('#276 白噪音：尾巴播完停止并提示「已按 30 分钟定时关闭」', ev("[Storage.get().whitenoise.playing, [...document.querySelectorAll('.toast')].some(t=>/30 分钟定时关闭/.test(t.textContent))]") == [False, True])
    ev("Modules.whitenoise._stop&&Modules.whitenoise._stop()")
    # —— 减少动态效果 ——
    p.emulate_media(reduced_motion='reduce')
    ev("App.showTab('home',{noVT:true})"); p.wait_for_timeout(200)
    ev("Drawer.open()"); p.wait_for_timeout(300)
    rm = ev("[getComputedStyle(document.getElementById('sideDrawer')).transform, getComputedStyle(document.getElementById('app')).transform, getComputedStyle(document.getElementById('sideDrawer')).opacity]")
    check('#276 减少动态效果：侧拉页直接淡入，不平移', rm == ['none', 'none', '1'], rm)
    ev("Drawer.close()"); p.wait_for_timeout(300)
    check('#276 无报错', not errs, errs)
    ctx.close()


L_JS = "window.__L=ms=>{const t=new Date(ms),z=n=>String(n).padStart(2,'0');return t.getFullYear()+'-'+z(t.getMonth()+1)+'-'+z(t.getDate())+'T'+z(t.getHours())+':'+z(t.getMinutes())+':'+z(t.getSeconds())}"
SLEEP_ON = "(()=>{const d=Storage.get();d.openSleep={id:'os277',start:__L(Date.now()-23*60e3),pausedMs:0,pauseStart:null};Storage.save();DockLive.render()})()"
SLEEP_OFF = "(()=>{const d=Storage.get();d.openSleep=null;Storage.save();DockLive.render()})()"
TOAST_EL = "document.querySelector('#toastRoot .toast:not(.leaving)')"


def test_r277(b):
    """第 277 次：A 液态玻璃深化（胶囊接入同一套折射、出现 / 消失形变 + 融合、按压 / 透镜 / 光线、局部重拍、资源不涨）；
    B 顶部「咿呀岛」提示（位置 / 让开顶部控件 / 品牌头像与类型 / 合并替换 / 撤销保留 / 上滑关闭 / 读屏 / 状态栏 / 降级）。"""
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, has_touch=True)
    p = ctx.new_page(); errs = []
    p.on('pageerror', lambda e: errs.append(str(e)[:160]))
    p.goto(URL); p.wait_for_timeout(600); p.evaluate('t=>Storage.importJSON(t)', SEED_V3)
    p.evaluate("localStorage.setItem('lgGlForce','1');Storage.get().settings.dockGlass='on';Storage.save()")
    p.reload(); p.wait_for_timeout(1800)
    ev = p.evaluate
    ev(L_JS)
    st = lambda: ev('DockRefract._stats()')
    # —— A1 胶囊接进同一套折射 ——
    ev("DockLive._slow(8)")
    # 同一次 evaluate 里出现、等两帧再取（八组并行时两次 evaluate 之间可能隔好几秒）
    m0 = ev("""new Promise(res=>{(%s);requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(()=>{const s=DockRefract._stats(),l=s.surfaces.find(x=>x.id==='live')||{};const e=document.getElementById('dockLive');
      res({morph:DockLive._morphing().morph,shape:l.shape,k:l.k,ext:s.ext,clip:e.style.clipPath||e.style.webkitClipPath||'',dock:document.querySelector('#tabbar canvas.lg-gl').style.top})})))})""" % SLEEP_ON)
    check('#277 胶囊出现：前段 clip-path 形状 + 距离场融合（k>0），dock 画布扩到胶囊（同一块画布画颈部）', m0['morph'] and m0['shape'] and m0['k'] > 1 and m0['ext'] == 1 and 'inset(' in m0['clip'] and m0['dock'].endswith('px') and float(m0['dock'][:-2]) < -8, m0)  # 第三帧时形状还是 dock 顶边上的一滴（约 26 高），画布顶已高出 dock
    _poll(p, "!DockLive._morphing().morph", 6000)
    ev("DockLive._slow(1)"); p.wait_for_timeout(400)
    s1 = st(); live = next((x for x in s1['surfaces'] if x['id'] == 'live'), {})
    geo = ev("(()=>{const c=document.querySelector('#tabbar canvas.lg-gl').getBoundingClientRect(),l=document.getElementById('dockLive').getBoundingClientRect(),e=document.getElementById('dockLive');return [c.left<=l.left+1&&c.right>=l.right-1&&c.top<=l.top+1,e.classList.contains('lg-band'),e.firstElementChild.classList.contains('dl-glass'),!e.querySelector('canvas'),getComputedStyle(e).backdropFilter||getComputedStyle(e).webkitBackdropFilter,getComputedStyle(e.firstElementChild).backdropFilter||getComputedStyle(e.firstElementChild).webkitBackdropFilter]})()")
    check('#277 胶囊接进同一套折射：画在 dock 那块 WebGL 画布里（画布扩到胶囊），共用 1 个上下文、2 张纹理，不另起画布、不拷贝', s1['ctxLive'] == 1 and s1['ctxCreated'] == 1 and s1['texLive'] == 2 and s1['texCreated'] == 2
          and live.get('inDom') and live.get('on') and live.get('canvas') is None and geo[0] and geo[1] and geo[3] and s1['copies'] == 0, [s1['ctxLive'], s1['texLive'], live, geo, s1['copies']])
    check('#277 折射开着时胶囊外圈不再整块模糊（否则把折射边再糊一遍），中间由内圈 .dl-glass 实时模糊', geo[2] and geo[4] in ('none', '') and 'blur' in (geo[5] or ''), geo)
    check('#277 出现动画结束：形状交回元素本身、k=0、clip-path 清掉、内容不透明', not live.get('shape')
          and ev("(()=>{const e=document.getElementById('dockLive');return !e.style.clipPath&&!e.classList.contains('dl-morph')&&getComputedStyle(e.querySelector('.dl-main')).opacity==='1'})()"), [live, s1['ext']])
    check('#277 形变走完不补播 CSS 入场动画 dl-in（不再从透明弹一次，折射边不被关掉）', ev("(()=>{const e=document.getElementById('dockLive');return [e.classList.contains('dl-shown'),getComputedStyle(e).animationName,getComputedStyle(e).opacity]})()") == [True, 'none', '1'])
    px = ev("""(()=>{DockRefract._draw();const c=document.querySelector('#tabbar canvas.lg-gl');const g=c.getContext('webgl');const cr=c.getBoundingClientRect(),l=document.getElementById('dockLive').getBoundingClientRect();
      const sx=c.width/cr.width,sy=c.height/cr.height;const a=(x,y)=>{const b=new Uint8Array(4);g.readPixels(Math.round((x-cr.left)*sx),Math.round(c.height-(y-cr.top)*sy),1,1,g.RGBA,g.UNSIGNED_BYTE,b);return b[3]};
      return [a(l.left+3,l.top+l.height/2),a(l.left+l.width/2,l.top+3),a(l.left+l.width/2,l.top+l.height/2),a(l.left+l.width/2,l.bottom+5)]})()""")
    check('#277 胶囊的折射边真的画了（左缘 / 上缘有像素、正中透明——中间是实时毛玻璃、胶囊与 dock 之间的缝透明）', px[0] > 100 and px[1] > 100 and px[2] < 10 and px[3] < 10, px)
    check('#277 胶囊仍可点（小画布不挡命中）', ev("(()=>{const t=document.querySelector('#dockLive [data-act=sleep-end]');const r=t.getBoundingClientRect();return document.elementFromPoint(r.left+r.width/2,r.top+r.height/2).closest('[data-act]')===t})()"))
    # —— A2 按压：放大 + 折射增强；左右对称 ——
    ev("(()=>{const t=document.querySelector('#tabbar .tab-plus');t.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:5}))})()"); p.wait_for_timeout(200)
    _poll(p, "DockRefract._stats().press.dock>0.6&&Math.abs(parseFloat(getComputedStyle(document.getElementById('tabbar')).scale)-1.02)<0.012", 2000)
    pr = ev("[DockRefract._stats().press.dock, getComputedStyle(document.getElementById('tabbar')).scale]")
    ev("window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:5}))"); p.wait_for_timeout(300)
    _poll(p, "DockRefract._stats().press.dock<0.05", 2000)
    pr2 = ev("DockRefract._stats().press.dock")
    check('#277 按下 dock：玻璃放大（scale 1.02）+ 边缘折射增强（press 缓到 >0.6），松开回到 0', pr[0] > 0.6 and abs(float(pr[1]) - 1.02) < 0.012 and pr2 < 0.05, [pr, pr2])
    ev("(()=>{const t=document.querySelector('#dockLive .dl-main');t.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:6}))})()"); p.wait_for_timeout(200)
    _poll(p, "DockRefract._stats().press.live>0.6", 2000)
    lp = ev("[DockRefract._stats().press.live, document.getElementById('dockLive').classList.contains('lg-press')]")
    ev("window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:6}))"); p.wait_for_timeout(300)
    check('#277 按下胶囊：同样放大 + 折射增强', lp[0] > 0.6 and lp[1] and not ev("document.getElementById('dockLive').classList.contains('lg-press')"), lp)
    # —— A3 水滴透镜 / 光线 ——
    check('#277 水滴指示器是折射透镜（.lg-lens：WebGL 在它下面画放大 + 边缘折射，自身底色调淡）', s1['lens'] and ev("parseFloat(getComputedStyle(document.querySelector('#tabbar .lg-thumb')).backgroundImage.match(/rgba?\\([^)]*,\\s*([\\d.]+)\\)/)[1])<0.4"))
    a0 = ev("document.getElementById('tabbar').style.getPropertyValue('--lg-ang')")
    ev("window.dispatchEvent(new DeviceOrientationEvent('deviceorientation',{alpha:0,beta:85,gamma:30}))"); p.wait_for_timeout(300)
    _poll(p, "Math.abs(DockRefract._stats().light.x+0.7071)>0.1&&document.getElementById('dockLive').style.getPropertyValue('--lg-ang')===document.getElementById('tabbar').style.getPropertyValue('--lg-ang')", 2500)
    lt = ev("[DockRefract._stats().light, document.getElementById('tabbar').style.getPropertyValue('--lg-ang'), document.getElementById('dockLive').style.getPropertyValue('--lg-ang')]")
    check('#277 设备方向数据来了（系统已授权）：高光转向，CSS 描边角度跟着变（dock 与胶囊一起）', lt[0]['src'] == 'tilt' and abs(lt[0]['x'] + 0.7071) > 0.1 and lt[1] != a0 and lt[1] == lt[2], [a0, lt])
    check('#277 不主动申请陀螺仪权限（不调 requestPermission）', 'requestPermission' not in open(ROOT / 'js' / 'dock-refract.js', encoding='utf-8').read().replace('不调 requestPermission', ''))
    p.wait_for_timeout(1700)
    ev("App.showTab('feeding',{noVT:true})"); p.wait_for_timeout(1300)
    ev("(()=>{let i=0;const f=()=>{scrollBy(0,40);if(++i<10)requestAnimationFrame(f)};f()})()"); p.wait_for_timeout(120)
    sl = ev("DockRefract._stats().light")
    p.wait_for_timeout(800)
    _poll(p, "Math.abs(DockRefract._stats().light.x+0.7071)<0.02", 3000)
    sl2 = ev("DockRefract._stats().light")
    check('#277 没有方向数据时高光按滚动方向微移，停下后回到左上 45°', sl['src'] == 'scroll' and abs(sl['x'] + 0.7071) > 0.02 and abs(sl2['x'] + 0.7071) < 0.02, [sl, sl2])
    # —— A4 局部重拍 ——
    ev("window.scrollTo(0,0)"); p.wait_for_timeout(1500)
    _poll(p, "DockRefract._stats().idle", 6000); p.wait_for_timeout(200)
    b0 = st()
    ev("""(()=>{const vh=innerHeight;const els=[...document.querySelectorAll('#view *')].filter(e=>e.children.length===0&&e.textContent.trim()&&(()=>{const r=e.getBoundingClientRect();return r.top>vh-170&&r.bottom<vh-40&&r.height<40})());const e=els[0];window.__near=e;e.textContent=e.textContent+'·';})()""")
    p.wait_for_timeout(900)
    b1 = st()
    check('#277 局部重拍：dock 附近的小改动只重拍一条横带（不整张重拍）', b1['stripes'] == b0['stripes'] + 1 and b1['rasters'] == b0['rasters'] and 0 < b1['stripeRows'] - b0['stripeRows'] < 60, [b0['rasters'], b1['rasters'], b0['stripes'], b1['stripes'], b1['stripeRows'] - b0['stripeRows']])
    ev("window.scrollTo(0,240)"); p.wait_for_timeout(1200)
    _poll(p, "DockRefract._stats().idle", 6000); p.wait_for_timeout(200)
    clip = _dock_px(p)
    p.add_style_tag(content=DBG_CSS)
    ev("document.documentElement.classList.add('lgtruth')"); p.wait_for_timeout(60); truth = p.screenshot(clip=clip)
    ev("document.documentElement.classList.remove('lgtruth');document.documentElement.classList.add('lgdbg');DockRefract._debug=true;DockRefract._draw()"); p.wait_for_timeout(80); snap = p.screenshot(clip=clip)
    ev("document.documentElement.classList.remove('lgdbg');DockRefract._debug=false;DockRefract._draw()")
    check('#277 局部重拍后快照与页面仍对齐（平均色差 < 10）', _img_diff(truth, snap) < 10, _img_diff(truth, snap))
    _poll(p, "DockRefract._stats().idle", 6000)
    c0 = st()
    ev("(()=>{const e=[...document.querySelectorAll('#view *')].find(e=>e.children.length===0&&e.textContent.trim()&&e.getBoundingClientRect().top<120&&e.getBoundingClientRect().bottom>0);e.textContent=e.textContent+'·'})()")
    p.wait_for_timeout(900)
    c1 = st()
    check('#277 离玻璃面远的改动先攒着（不立刻重拍），4 秒内补拍', c1['stripes'] == c0['stripes'] and c1['rasters'] == c0['rasters'] and c1['pending'] >= 1, [c0['stripes'], c1['stripes'], c1['pending']])
    _poll(p, "DockRefract._stats().pending===0", 5000)
    c2 = st()
    check('#277 攒着的改动按时补拍成横带', c2['stripes'] == c1['stripes'] + 1 and c2['rasters'] == c1['rasters'], [c1['stripes'], c2['stripes'], c2['rasters'] - c1['rasters']])
    # —— A5 改尺寸 / 消失 ——
    ev("(()=>{const d=Storage.get();d.openSleep.pauseStart=Date.now();Storage.save();DockLive.render()})()")
    rz = ev("(()=>{const e=document.getElementById('dockLive');return [e.classList.contains('dl-resizing')||!e.style.width, e.querySelector('.dl-lbl').textContent]})()")
    check('#277 胶囊换内容时宽度过渡（FLIP），折射形状跟着逐帧插值', rz[1] == '睡眠 · 暂停' and rz[0], rz)
    p.wait_for_timeout(500)
    ev(SLEEP_OFF)
    gh = ev("(()=>{const g=document.querySelector('.dock-live.dl-ghost');return [document.getElementById('dockLive').hidden,!!g,g&&g.hasAttribute('inert'),g&&g.getAttribute('aria-hidden'),g&&!g.id&&!g.querySelector('[id]')]})()")
    check('#277 胶囊消失：原胶囊立刻 hidden（状态 / 读屏不等动画），替身 inert、aria-hidden、无 id 地缩回 dock', gh == [True, True, True, 'true', True], gh)
    p.wait_for_timeout(700)
    s2 = st()
    check('#277 消失动画结束：替身移除、胶囊玻璃面注销，dock 画布收回到自身大小', not ev("!!document.querySelector('.dl-ghost')") and not any(x['id'] == 'live' for x in s2['surfaces'])
          and ev("(()=>{const c=document.querySelector('#tabbar canvas.lg-gl');return !c.style.top&&!document.querySelector('.lg-band')})()"), s2['surfaces'])
    # —— A6 资源：带着胶囊切页 50 次 ——
    ev(SLEEP_ON); p.wait_for_timeout(900)
    tabs = ['home', 'feeding', 'diaper', 'whitenoise', 'settings', 'calendar', 'growth', 'search', 'temp', 'home']

    def spin(n):
        for i in range(n):
            ev(f"App.showTab('{tabs[i % len(tabs)]}',{{noVT:true}})"); p.wait_for_timeout(90)
        ev("App.showTab('home',{noVT:true})"); p.wait_for_timeout(1500)
        return ev("(()=>{const s=DockRefract._stats();return {els:document.getElementsByTagName('*').length,cv:document.getElementsByTagName('canvas').length,ctx:s.ctxCreated,tex:s.texCreated,texLive:s.texLive,surf:s.surfaces.length,ghost:document.querySelectorAll('.dl-ghost').length}})()")
    za = spin(10); zb = spin(50)
    check('#277 带着胶囊切页 50 次：上下文 / 纹理不新建，DOM 节点、画布、玻璃面数不涨、无残留替身', zb['ctx'] == za['ctx'] == 1 and zb['tex'] == za['tex'] == 2 and zb['els'] == za['els'] and zb['cv'] == za['cv'] and zb['surf'] == za['surf'] == 1 and zb['ghost'] == 0, [za, zb])
    # —— B1 顶部咿呀岛 ——
    ev("Util.toast('已记录：换尿布 · 嘘嘘','ok')"); p.wait_for_timeout(700)
    t1 = ev(f"""(()=>{{const t={TOAST_EL};const r=t.getBoundingClientRect();const im=t.querySelector('.toast-yiya img');return {{top:r.top,bottom:r.bottom,h:r.height,kind:t.dataset.kind,accent:t.dataset.accent,role:t.getAttribute('role'),live:t.getAttribute('aria-live'),atomic:t.getAttribute('aria-atomic'),img:im&&im.getAttribute('src'),loaded:im&&im.naturalWidth>0,badge:!!t.querySelector('.ty-badge svg'),surf:DockRefract._stats().surfaces.map(s=>s.id+':'+s.on)}}}})()""")
    check('#277 提示岛在顶部状态栏下方（不再压住底部操作），单行高 ≤ 52', t1['top'] < 30 and t1['h'] <= 52, t1)
    check('#277 左侧小咿呀头像（assets/yiya.webp 已载入）+ 类型徽章；首页「换尿布」按文案归到尿布类', t1['img'] == 'assets/yiya.webp' and t1['loaded'] and t1['badge'] and t1['kind'] == 'diaper' and t1['accent'] == 'diaper', t1)
    check('#277 读屏：role=status + aria-live=polite + aria-atomic', [t1['role'], t1['live'], t1['atomic']] == ['status', 'polite', 'true'], t1)
    check('#277 提示岛接进同一套折射（toast 玻璃面，在首页上真画了）', 'toast:true' in t1['surf'] and ev("DockRefract._stats().ctxCreated") == 1, t1['surf'])
    tc = ev("document.querySelector('meta[name=theme-color]').content")
    check('#277 提示岛不进状态栏取色（overlayStack 里没有它）', not any('toast' in c for c in ev("__statusOverlay()")), ev("__statusOverlay()"))
    el0 = ev(f"{TOAST_EL}===document.querySelector('#toastRoot .toast')")
    ev("Util.toast('已复制该条记录','ok')"); p.wait_for_timeout(80)
    sw = ev("(()=>{const l=[...document.querySelectorAll('#toastRoot .toast')];return [l.length,l[0].textContent,l[0].classList.contains('swap')]})()")
    check('#277 连续两条：同一颗岛原地替换（不堆叠），内容交叉淡入', el0 and sw[0] == 1 and sw[1] == '已复制该条记录' and sw[2], sw)
    ev("document.querySelector('#toastRoot .toast')._toastDismiss()"); p.wait_for_timeout(400)
    for tab, kind in (('feeding', 'feed'), ('diaper', 'diaper'), ('sleep', 'sleep'), ('temp', 'ok')):
        ev(f"App.showTab('{tab}',{{noVT:true}})"); p.wait_for_timeout(250)
        ev("Util.toast('已保存','ok')"); p.wait_for_timeout(120)
        k = ev(f"[{TOAST_EL}.dataset.kind, getComputedStyle({TOAST_EL}.querySelector('.toast-yiya img')).animationName]")
        check(f'#277 {tab} 页保存：小咿呀换成「{kind}」类配色 / 小动作', k[0] == kind and 'ty-pop' in k[1], k)
        ev("document.querySelector('#toastRoot .toast')._toastDismiss()"); p.wait_for_timeout(300)
    ev("Util.toast('请先选择类型','warn')"); p.wait_for_timeout(150)
    check('#277 警告：不跳、轻摇（ty-shake），徽章换警告色', ev(f"[{TOAST_EL}.dataset.kind, getComputedStyle({TOAST_EL}.querySelector('.toast-yiya img')).animationName]") == ['warn', 'ty-shake'])
    ev("document.querySelector('#toastRoot .toast')._toastDismiss()"); p.wait_for_timeout(300)
    # 撤销可点 + 上滑关闭
    ev("App.showTab('feeding',{noVT:true})"); p.wait_for_timeout(600)
    ev("window.__u=0;Util.toast('已记录亲喂 12 分钟','ok',{label:'撤销',onClick(){window.__u++}})"); p.wait_for_timeout(650)
    hit = ev("(()=>{const a=document.querySelector('#toastRoot .toast-action');const r=a.getBoundingClientRect();return document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)===a})()")
    one = ev(f"{TOAST_EL}.getBoundingClientRect().height")
    check('#277 撤销按钮在最上层可点；「已记录亲喂 12 分钟　撤销」单行', hit and one <= 52, [hit, one])
    p.click('#toastRoot .toast-action'); p.wait_for_timeout(350)
    check('#277 点撤销：回调执行一次、提示岛收起', ev("window.__u") == 1 and not ev(f"!!{TOAST_EL}"))
    ev("Util.toast('已记录：喂奶','ok')"); p.wait_for_timeout(650)
    ev("""(()=>{const t=document.querySelector('#toastRoot .toast');const r=t.getBoundingClientRect();const x=r.left+30,y=r.top+r.height/2;
      const f=(ty,yy)=>t.dispatchEvent(new PointerEvent(ty,{bubbles:true,pointerId:9,clientX:x,clientY:yy,isPrimary:true}));
      f('pointerdown',y);f('pointermove',y-10);f('pointermove',y-30);f('pointerup',y-30)})()""")
    up = ev("(()=>{const t=document.querySelector('#toastRoot .toast');return t?[t.classList.contains('leaving-up'),t.style.translate]:['gone']})()")
    p.wait_for_timeout(400)
    check('#277 上滑关闭：跟手上移、松手收起', up[0] is True and ev("!document.querySelector('#toastRoot .toast')"), up)
    # 让开顶部控件：侧拉页（返回 + 搜索框）、全屏计时（收起 / 删除）、面板顶满（✕ ✓）
    ev("App.showTab('home',{noVT:true})"); p.wait_for_timeout(600)
    ev("Drawer.open()"); p.wait_for_timeout(900)
    ev("Util.toast('已切换到豆豆','ok')"); p.wait_for_timeout(650)
    dv = ev(f"""(()=>{{const t={TOAST_EL}.getBoundingClientRect();const bs=[...document.querySelectorAll('.side-drawer button, .side-drawer input')].map(e=>e.getBoundingClientRect()).filter(r=>r.width&&r.height<=60&&r.top<t.bottom&&r.bottom>t.top&&r.left<t.right&&r.right>t.left);return [Math.round(t.top),bs.length]}})()""")
    check('#277 侧拉页打开：提示岛下移到返回 / 搜索框下面，不压住它们', dv[0] > 50 and dv[1] == 0, dv)
    ev("document.querySelector('#toastRoot .toast')._toastDismiss();Drawer.close()"); p.wait_for_timeout(800)
    ev("App.showTab('sleep',{noVT:true})"); p.wait_for_timeout(500)
    ev("Modules.sleep._openFull&&Modules.sleep._openFull()"); p.wait_for_timeout(800)
    tc0 = ev("document.querySelector('meta[name=theme-color]').content")
    ev("Util.toast('已记录：醒来 1 次','ok')"); p.wait_for_timeout(650)
    fv = ev(f"""(()=>{{const t={TOAST_EL}.getBoundingClientRect();const bs=[...document.querySelectorAll('.ftf button')].map(e=>e.getBoundingClientRect()).filter(r=>r.width&&r.height<=60&&r.top<t.bottom&&r.bottom>t.top&&r.left<t.right&&r.right>t.left);return [bs.length,DockRefract._stats().surfaces.filter(s=>s.id==='toast').map(s=>s.on)]}})()""")
    p.wait_for_timeout(300)
    tc1 = ev("document.querySelector('meta[name=theme-color]').content")
    check('#277 全屏计时层上：提示岛不压住收起 / 删除；状态栏颜色不被它打乱；层上没有快照就不画折射', fv[0] == 0 and tc0 == tc1 and fv[1] in ([False], []), [fv, tc0, tc1])
    ev("document.querySelector('#toastRoot .toast')._toastDismiss();Modules.sleep._closeFull&&Modules.sleep._closeFull()"); p.wait_for_timeout(600)
    ev("App.showTab('diaper',{noVT:true})"); p.wait_for_timeout(500)
    ev("(document.querySelector('.mod-cta [data-new]')||document.querySelector('[data-new]')).click()"); p.wait_for_timeout(700)
    ev("(()=>{const s=document.querySelector('#modalRoot .modal');if(s)s.style.maxHeight='100vh';const b=document.querySelector('#modalRoot .rs-body');if(b)b.style.minHeight='100vh'})()"); p.wait_for_timeout(300)
    ev("Util.toast('请选择尿布类型','warn')"); p.wait_for_timeout(650)
    mv = ev(f"""(()=>{{const t={TOAST_EL}.getBoundingClientRect();const bs=[...document.querySelectorAll('#modalRoot button')].map(e=>e.getBoundingClientRect()).filter(r=>r.width&&r.height<=60&&r.top<t.bottom&&r.bottom>t.top&&r.left<t.right&&r.right>t.left);return bs.length}})()""")
    check('#277 记录面板上：提示岛不压住面板顶栏 ✕ / ✓', mv == 0, mv)
    ev("document.querySelector('#toastRoot .toast')._toastDismiss();Sheet.closeAll()"); p.wait_for_timeout(500)
    # 高对比：玻璃面全部释放
    ev("document.body.classList.add('hc')"); p.wait_for_timeout(400)
    ev("Util.toast('高对比','ok')"); p.wait_for_timeout(300)
    hc = ev("[DockRefract._stats().on, document.querySelectorAll('canvas.lg-gl2, canvas.lg-gl').length, document.getElementById('dockLive').classList.contains('lg-on')]")
    check('#277 高对比：dock / 胶囊 / 提示岛的折射全部停掉（无画布、无 lg-on）', hc == [False, 0, False], hc)
    ev("document.querySelector('#toastRoot .toast')._toastDismiss();document.body.classList.remove('hc');LiquidDock.refresh()"); p.wait_for_timeout(1500)
    check('#277 退出高对比：胶囊重新挂回折射', ev("DockRefract._stats().surfaces.some(s=>s.id==='live'&&s.inDom)"))
    ev(SLEEP_OFF); p.wait_for_timeout(600)
    check('#277 SW：yiya.webp 登记进预缓存且文件存在', "'assets/yiya.webp'" in (ROOT / 'sw.js').read_text(encoding='utf-8') and (ROOT / 'assets' / 'yiya.webp').exists())
    check('#277 无报错', not errs, errs)
    ctx.close()
    # 减少动态效果：胶囊不形变只淡入；提示岛只淡入、小咿呀不动；左手竖排单行
    ctx = b.new_context(viewport={'width': 360, 'height': 780}, reduced_motion='reduce')
    q = ctx.new_page(); errs2 = []
    q.on('pageerror', lambda e: errs2.append(str(e)[:160]))
    q.goto(URL); q.wait_for_timeout(600); q.evaluate('t=>Storage.importJSON(t)', SEED_V3)
    q.evaluate("localStorage.setItem('lgGlForce','1');Storage.get().settings.dockGlass='on';Storage.save()")
    q.reload(); q.wait_for_timeout(1600); q.evaluate(L_JS)
    q.evaluate(SLEEP_ON)
    rm = q.evaluate("[DockLive._morphing().morph, document.getElementById('dockLive').classList.contains('dl-fade')]")
    q.evaluate("Util.toast('已记录：换尿布 · 嘘嘘','ok')"); q.wait_for_timeout(100)
    ra = q.evaluate(f"[getComputedStyle({TOAST_EL}).animationName, getComputedStyle({TOAST_EL}.querySelector('.toast-yiya img')).animationName, getComputedStyle({TOAST_EL}).transform]")
    check('#277 减少动态效果：胶囊不形变只淡入；提示岛只淡入（island-fade）、不缩放、小咿呀不动', rm == [False, True] and ra[0] == 'island-fade' and ra[1] == 'none' and ra[2] == 'none', [rm, ra])
    q.evaluate("document.querySelector('#toastRoot .toast')._toastDismiss()"); q.wait_for_timeout(300)
    q.evaluate("(()=>{const s=Storage.get().settings;s.handMode='left';Storage.save()})()"); q.reload(); q.wait_for_timeout(1500)
    q.evaluate("App.showTab('feeding',{noVT:true})"); q.wait_for_timeout(400)
    q.evaluate("Util.toast('已记录亲喂 12 分钟','ok',{label:'撤销',onClick(){}})"); q.wait_for_timeout(400)
    lh = q.evaluate(f"(()=>{{const r={TOAST_EL}.getBoundingClientRect();return [Math.round(r.height),Math.round(r.left),Math.round(r.right),document.body.classList.contains('dock-left')]}})()")
    check('#277 左手竖排 360 宽：「已记录亲喂 12 分钟　撤销」单行、不出屏（原来收窄后折成两行）', lh[0] <= 52 and lh[1] >= 8 and lh[2] <= 352 and lh[3], lh)
    check('#277 减少动态 / 左手无报错', not errs2, errs2)
    ctx.close()



CSV_CAP = r"""(()=>{window.__csv=[];if(window.__csvHooked)return;window.__csvHooked=1;const o=URL.createObjectURL;URL.createObjectURL=function(b){if(b&&b.text)b.text().then(t=>window.__csv.push(t));return o.call(URL,b)};})()"""
PH3 = r"""async()=>{const ids=[];for(const c of ['#f00','#0f0','#00f']){const cv=document.createElement('canvas');cv.width=300;cv.height=200;const x=cv.getContext('2d');x.fillStyle=c;x.fillRect(0,0,300,200);const bl=await new Promise(r=>cv.toBlob(r,'image/jpeg'));ids.push(await Photos.put(bl))}
  const d=Storage.get();d.feedings.push({id:'sol278',type:'solid',start:Util.nowLocal(),unit:'g',qty:30,amount:30,dish:'米粉',photos:ids});Storage.save();return ids}"""
PH_ST = "(()=>{const v=document.querySelector('body > .ph-view');return {view:document.querySelectorAll('.ph-view').length,sheet:document.querySelectorAll('#modalRoot .modal-mask:not(.sheet-leaving)').length,st:(history.state||{}).baoma,idx:v&&v._phIndex?v._phIndex():-1,cnt:(document.querySelector('.ph-count')||{}).textContent||'',note:(document.querySelector('#sdNote')||{}).value,tab:App.currentTab(),hl:history.length}})()"


def test_r278(b):
    """第 278 次：第四轮审计 #30–#41 + 白噪音到点提示（暂停中改音量后写设定分钟数）。"""
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, has_touch=True)
    p = ctx.new_page(); errs = []
    p.on('pageerror', lambda e: errs.append(str(e)[:160]))
    p.goto(URL); p.wait_for_timeout(600); p.evaluate('t=>Storage.importJSON(t)', SEED_V3)
    p.reload(); p.wait_for_timeout(1200)
    ev = p.evaluate
    go = lambda t: (ev(f"App.showTab('{t}',{{noVT:true}})"), p.wait_for_timeout(450))
    # —— #30 面板里看照片大图：返回 / Esc 先关大图（面板和已填内容还在），左右滑看上下张 ——
    go('solid')
    ids = ev(PH3)
    ev("Modules.solid._edit(Storage.get().feedings.find(r=>r.id==='sol278'))"); p.wait_for_timeout(700)
    ev("(()=>{const n=document.querySelector('#sdNote');n.value='还没保存的备注';n.dispatchEvent(new Event('input',{bubbles:true}))})()")
    ev("document.querySelector('[data-phview]').click()"); p.wait_for_timeout(600)
    a = ev(PH_ST)
    check('#30 点缩略图打开大图：登记一条 history（ov），显示「1 / 3」', a['view'] == 1 and a['st'] == 'ov' and a['cnt'] == '1 / 3' and a['idx'] == 0 and len(ids) == 3, a)
    p.mouse.move(300, 420); p.mouse.down(); p.mouse.move(140, 425, steps=6); p.mouse.up(); p.wait_for_timeout(350)
    a1 = ev(PH_ST)
    p.keyboard.press('ArrowRight'); p.wait_for_timeout(250)
    a2 = ev(PH_ST)
    p.mouse.move(100, 420); p.mouse.down(); p.mouse.move(300, 425, steps=6); p.mouse.up(); p.wait_for_timeout(350)
    a3 = ev(PH_ST)
    check('#30 大图左滑看下一张、→ 再下一张、右滑回上一张（横滑不当成点一下关闭）', a1['idx'] == 1 and a1['cnt'] == '2 / 3' and a2['idx'] == 2 and a3['idx'] == 1 and a3['view'] == 1
          and ev("document.querySelector('.ph-view img').getAttribute('data-phid')") == ids[1], [a1, a2, a3])
    ev("history.back()"); p.wait_for_timeout(900)
    a4 = ev(PH_ST)
    check('#30 系统返回（popstate）：只关大图，面板还开着、没保存的备注还在，留在辅食页', a4['view'] == 0 and a4['sheet'] == 1 and a4['note'] == '还没保存的备注' and a4['tab'] == 'solid', a4)
    ev("document.querySelectorAll('[data-phview]')[2].click()"); p.wait_for_timeout(600)
    check('#30 从第 3 张缩略图打开：从第 3 张开始', ev(PH_ST)['idx'] == 2)
    p.keyboard.press('Escape'); p.wait_for_timeout(500)
    a5 = ev(PH_ST)
    check('#30 Esc：先关大图，面板不关', a5['view'] == 0 and a5['sheet'] == 1 and a5['note'] == '还没保存的备注', a5)
    hl0 = ev("history.length")  # 前面开关过一次：前进栈里留着一条 guard，长度按这一刻比
    ev("document.querySelector('[data-phview]').click()"); p.wait_for_timeout(600)
    p.mouse.click(200, 420); p.wait_for_timeout(900)
    a6 = ev(PH_ST)
    check('#30 点一下关闭大图：退掉它那条记录（history 不涨）、面板还在', a6['view'] == 0 and a6['sheet'] == 1 and a6['hl'] == hl0 and a6['st'] != 'ov', [a6, hl0])
    ev("history.back()"); p.wait_for_timeout(900)
    a7 = ev(PH_ST)
    check('#30 大图关掉后再返回：这次才关面板，仍在辅食页', a7['sheet'] == 0 and a7['tab'] == 'solid', a7)
    ev("Storage.get().feedings=Storage.get().feedings.filter(r=>r.id!=='sol278');Storage.save()")
    # —— #31 生长只量体重：身长 / 头围不复制上次值 ——
    go('growth')
    n0 = ev("Storage.get().growth.length")
    pre = ev("[...document.querySelectorAll('#gMetrics [data-mk] b')].map(b=>b.textContent)")
    ev("document.querySelector('#gSave').click()"); p.wait_for_timeout(300)
    blocked = ev("Storage.get().growth.length") == n0
    ev("document.querySelector('#gMetrics [data-mk=weight]').click()")
    for _ in range(4): ev("document.querySelector('#gRulerPlus').click()")
    chips = ev("[...document.querySelectorAll('#gMetrics [data-mk] b')].map(b=>b.textContent)")
    ev("document.querySelector('#gSave').click()"); p.wait_for_timeout(500)
    g = ev("Storage.get().growth.slice(-1)[0]")
    check('#31 生长：预填的上次值标「上次」，一项都没调时不让保存', all(x.startswith('上次') for x in pre if x != '--') and blocked and chips[0].endswith('kg') and chips[1].startswith('上次'), [pre, chips, blocked])
    check('#31 生长：只调了体重就保存 → 新记录只有体重，身长 / 头围为空（不再复制上次的值）', g['weightKg'] is not None and g['heightCm'] is None and g['headCm'] is None and ev("Storage.get().growth.length") == n0 + 1, g)
    ev("__x=0") if False else None
    ev(CSV_CAP); go('settings')
    ev("(()=>{const s=document.querySelector('#sCsvModule');s.value='growth';document.querySelector('#sCsv').click()})()"); p.wait_for_timeout(400)
    gl = ev("(window.__csv.slice(-1)[0]||'').split(/\\r?\\n/).filter(l=>l.startsWith(Storage.get().growth.slice(-1)[0].date)).pop()")
    check('#31 生长 CSV：这一行身长 / 头围两列为空', gl is not None and gl.endswith(',,'), gl)
    # —— #32 经期：连点保存只存一条；已有未结束 / 区间重叠时拦下；重复老数据不影响预测 ——
    ev("Storage.get().periods=[];Storage.save()"); go('period')
    ev("document.querySelector('#pSave').click();document.querySelector('#pSave').click()"); p.wait_for_timeout(500)
    ev("document.querySelector('#pSave').click()"); p.wait_for_timeout(500)
    pr = ev("Storage.get().periods.map(x=>[x.start,x.end])")
    check('#32 经期：连点保存 / 再点一次，只存下一条进行中的经期，并提示先结束它', len(pr) == 1 and pr[0][1] is None and '还没结束' in ev("(document.querySelector('.field-error')||{}).textContent||''"), pr)
    ev("(()=>{const d=Storage.get(),t=Util.todayISO();d.periods=[{id:'q1',start:Util.addDays(t,-20),end:Util.addDays(t,-15),symptoms:[]}];Storage.save();App.rerender()})()"); p.wait_for_timeout(400)
    ev("(()=>{const i=document.querySelector('#pStart');i.value=Util.addDays(Util.todayISO(),-17);const e=document.querySelector('#pEnd');e.value=Util.addDays(Util.todayISO(),-12);document.querySelector('#pSave').click()})()"); p.wait_for_timeout(400)
    ov = ev("[Storage.get().periods.length, (document.querySelector('.field-error')||{}).textContent||'']")
    ev("(()=>{const i=document.querySelector('#pStart');i.value=Util.addDays(Util.todayISO(),-50);const e=document.querySelector('#pEnd');e.value=Util.addDays(Util.todayISO(),-46);document.querySelector('#pSave').click()})()"); p.wait_for_timeout(400)
    check('#32 经期：和已有记录区间重叠时拦下并说明；不重叠的补记照常保存', ov[0] == 1 and '重叠' in ov[1] and ev("Storage.get().periods.length") == 2, ov)
    pw = ev("Modules.period._predictWindow([{start:'2026-06-01'},{start:'2026-06-29'},{start:'2026-07-27'},{start:'2026-08-24'},{start:'2026-08-24'}])")
    check('#32 经期预测：老数据里同一天的重复记录只算一次，预测照常给出', pw.get('ok') is True, pw)
    # —— #33 喂养 CSV：勺 / 碗的量与单位、菜名 ——
    ev("(()=>{const d=Storage.get();d.feedings.push({id:'c1',type:'solid',start:'2026-10-20T18:12:00',unit:'spoon',qty:3,amount:null,dish:'南瓜泥😀'},{id:'c2',type:'solid',start:'2026-10-20T19:00:00',unit:'bowl',qty:1.5,amount:null,dish:'米粥'});Storage.save()})()")
    go('settings')
    ev("(()=>{window.__csv=[];const s=document.querySelector('#sCsvModule');s.value='feedings';document.querySelector('#sCsv').click()})()"); p.wait_for_timeout(400)
    fc = ev("window.__csv.slice(-1)[0]||''")
    import csv as _csv, io as _io
    rows = list(_csv.reader(_io.StringIO(fc.lstrip('\ufeff'), newline='')))
    sp = [r for r in rows if r and r[0] == '2026-10-20T18:12:00']; bw = [r for r in rows if r and r[0] == '2026-10-20T19:00:00']
    check('#33 喂养 CSV：表头分「量 / 单位 / 名称」，按勺 / 碗记的辅食写出 3 勺 / 1.5 碗和菜名', rows[0][4:7] == ['量', '单位', '名称'] and sp and sp[0][4:7] == ['3', '勺', '南瓜泥😀'] and bw and bw[0][4:7] == ['1.5', '碗', '米粥'], [rows[0], sp, bw])
    ev("Storage.get().feedings=Storage.get().feedings.filter(r=>r.id!=='c1'&&r.id!=='c2');Storage.save()")
    # —— #34 交接班：停用补剂不列、按次数写 1/2、辅食写量 ——
    ev("(()=>{const d=Storage.get();d.supplementPlans=[{id:'a',name:'铁剂',form:'滴剂',perDay:1,active:false,sortOrder:0},{id:'b',name:'维生素D',form:'滴剂',perDay:2,active:true,sortOrder:1},{id:'c',name:'DHA',form:'滴剂',perDay:1,active:true,sortOrder:2}];d.supplements=[{id:'x',time:Util.nowLocal(),name:'维生素D',planId:'b'}];d.feedings.push({id:'sz',type:'solid',start:Util.nowLocal(),unit:'spoon',qty:3,dish:'米粉'});Storage.save()})()")
    ho = ev("Modules.settings._handoff(Storage.get())")
    sl = [l for l in ho.split('\n') if l.startswith('已吃') or l.startswith('还没打卡')]
    fl = [l for l in ho.split('\n') if l.startswith('上次') and '辅食' in l]
    check('#34 交接班：停用的铁剂不列；维生素D 写「1/2」；没吃的 DHA 列为未打卡', sl and '铁剂' not in ho and '维生素D 1/2' in sl[0] and '未打卡 DHA' in sl[0], sl)
    check('#34 交接班：辅食写名称和量（3 勺）', fl and '米粉' in fl[0] and '3 勺' in fl[0], fl)
    ev("Storage.get().feedings=Storage.get().feedings.filter(r=>r.id!=='sz');Storage.save()")
    # —— #36 / #37 首页磁贴 ——
    ev("(()=>{const d=Storage.get(),t=Util.todayISO();d.periods=[{id:'p1',start:Util.addDays(t,-6),end:Util.addDays(t,-2),symptoms:[]},{id:'p2',start:Util.addDays(t,-62),end:Util.addDays(t,-57),symptoms:[]}];d.growth=[{id:'g1',date:Util.addDays(t,-6),weightKg:null,heightCm:62,headCm:null}];Storage.save()})()")
    go('home'); ev("Modules.home._edit=true;Modules.home._sheet=true;App.rerender()"); p.wait_for_timeout(700)
    hs = ev("document.querySelector('#homeSheet').innerText.replace(/\\s+/g,' ')")
    check('#36 首页经期磁贴：按开始日期取最近一次（上次 6 天前，不是补记的 62 天前）', '上次 6 天前' in hs and '上次 62 天前' not in hs, hs[:300])
    check('#37 首页生长磁贴：最近一条没有体重时写身长，不出现「null kg」', '最近身长 62 cm' in hs and 'null' not in hs, hs[:300])
    # —— #35 编辑布局 / 添加组件面板开着时不触发下拉搜索（CDP 真触摸） ——
    cdp = ctx.new_cdp_session(p)
    def pull(y0, y1):
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': 200, 'y': y0}]})
        for i in range(1, 13):
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': 200, 'y': y0 + (y1 - y0) * i / 12}]}); p.wait_for_timeout(16)
        s = ev("[PullSearch._state().mode, document.querySelector('#view').style.transform||'']")
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []}); p.wait_for_timeout(600)
        return s + [ev("App.currentTab()")]
    ev("scrollTo(0,0)")
    c1 = pull(500, 800)
    ev("Modules.home._sheet=false;App.rerender()"); p.wait_for_timeout(500); ev("scrollTo(0,0)")
    c2 = pull(200, 550)
    check('#35 首页「添加组件」面板 / 编辑布局时下拉：不接管、页面不被拽下、不进搜索页', c1[0] is None and 'translate' not in c1[1] and c1[2] == 'home' and c2[0] is None and c2[2] == 'home', [c1, c2])
    ev("Modules.home._edit=false;App.rerender()"); p.wait_for_timeout(500); ev("scrollTo(0,0)")
    c3 = pull(250, 600)
    check('#35 对照：正常首页顶部下拉仍进搜索页', c3[2] == 'search', c3)
    go('home')
    # —— #38 生长编辑范围与滑杆一致、没动的字段不校验 ——
    ev("(()=>{const d=Storage.get();d.growth.push({id:'gE',date:Util.addDays(Util.todayISO(),-1),weightKg:7.2,heightCm:25,headCm:62.5});Storage.save()})()")
    go('growth')
    ev("document.querySelector('[data-del=gE]').closest('li').querySelector('.li-main').click()"); p.wait_for_timeout(500)
    ev("(()=>{const e=document.querySelector('#reF_date');e.value=Util.addDays(Util.todayISO(),-2);e.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('[data-re-ok]').click()})()"); p.wait_for_timeout(500)
    ge = ev("Storage.get().growth.find(r=>r.id==='gE')")
    check('#38 生长编辑：头围 62.5 / 身长 25 的记录只改日期也能保存（范围同录入滑杆 20–70 / 20–160）', ge['date'] == ev("Util.addDays(Util.todayISO(),-2)") and ge['headCm'] == 62.5 and ge['heightCm'] == 25, ge)
    ev("document.querySelector('[data-del=gE]').closest('li').querySelector('.li-main').click()"); p.wait_for_timeout(500)
    ev("(()=>{const e=document.querySelector('#reF_headCm');e.value='75';document.querySelector('[data-re-ok]').click()})()"); p.wait_for_timeout(300)
    check('#38 生长编辑：改成超出范围的值仍拦下（请填 20–70）', '20–70' in ev("(document.querySelector('#modalRoot .field-error')||{}).textContent||''") and ev("Storage.get().growth.find(r=>r.id==='gE').headCm") == 62.5)
    ev("Sheet.closeAll()"); p.wait_for_timeout(300)
    # —— #39 辅食日期不早于出生、量 ≤0 标红 ——
    go('solid')
    ns0 = ev("Storage.get().feedings.filter(r=>r.type==='solid').length")
    ev("Modules.solid._open()"); p.wait_for_timeout(600)
    mn = ev("document.querySelector('#sdDate').min")
    ev("(()=>{const e=document.querySelector('#sdDate');e.value='2025-03-01';e.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('[data-sdsave]').click()})()"); p.wait_for_timeout(400)
    pb = ev("[Storage.get().feedings.filter(r=>r.type==='solid').length, !!document.querySelector('#modalRoot .modal-mask')]")
    check('#39 辅食：日期框最早到出生日；选到出生前保存被拦下、面板不关', mn == '2026-05-20' and pb == [ns0, True], [mn, pb])
    ev("(()=>{const e=document.querySelector('#sdDate');e.value=Util.todayISO();e.dispatchEvent(new Event('change',{bubbles:true}));const q=document.querySelector('#sdQty');q.value='-20';q.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-sdsave]').click()})()"); p.wait_for_timeout(400)
    ng = ev("[Storage.get().feedings.filter(r=>r.type==='solid').length, document.querySelector('#sdQty').classList.contains('is-invalid'), [...document.querySelectorAll('#toastRoot .toast')].some(t=>/大于 0/.test(t.textContent))]")
    check('#39 辅食：量填负数不存、数字框标红并提示', ng == [ns0, True, True], ng)
    ev("Sheet.closeAll()"); p.wait_for_timeout(300)
    # —— #40 补剂：重新启用时已有同名启用中计划 → 不启用 ——
    ev("(()=>{const d=Storage.get();d.supplementPlans=[{id:'a',name:'维生素D',form:'滴剂',perDay:1,active:false,sortOrder:0},{id:'b',name:'维生素D',form:'滴剂',perDay:1,active:true,sortOrder:1}];Storage.save()})()")
    go('supplement')
    ev("document.querySelector('[data-manage]').click()"); p.wait_for_timeout(500)  # 第 280 次：停用 / 启用挪进「管理」面板
    ev("document.querySelector('[data-toggle=a]').click()"); p.wait_for_timeout(400)
    sp2 = ev("Storage.get().supplementPlans.map(x=>[x.id,x.active])")
    check('#40 补剂：已有同名启用中计划时不能再启用旧的那条，提示先停用 / 删掉', sp2 == [['a', False], ['b', True]] and ev("[...document.querySelectorAll('#toastRoot .toast')].some(t=>/已经有一条在用/.test(t.textContent))"), sp2)
    ev("document.querySelector('[data-toggle=b]').click()"); p.wait_for_timeout(300); ev("document.querySelector('[data-toggle=a]').click()"); p.wait_for_timeout(300)
    check('#40 补剂：停用新的那条后，旧的可以正常启用', ev("Storage.get().supplementPlans.map(x=>[x.id,x.active])") == [['a', True], ['b', False]])
    ev("Sheet.closeAll()"); p.wait_for_timeout(300)
    # —— #41 Esc 由上到下：侧拉页上盖着切换宝宝面板 ——
    go('feeding')
    ev("Drawer.open()"); p.wait_for_timeout(500); ev("App._openBabySheet()"); p.wait_for_timeout(500)
    p.keyboard.press('Escape'); p.wait_for_timeout(500)
    e1 = ev("[Drawer.isOpen(), Sheet.isOpen()]")
    p.keyboard.press('Escape'); p.wait_for_timeout(600)
    e2 = ev("[Drawer.isOpen(), Sheet.isOpen()]")
    check('#41 Esc：先关切换宝宝面板（侧拉页还开着），再按关侧拉页', e1 == [True, False] and e2 == [False, False], [e1, e2])
    # —— 白噪音：暂停中改音量后到点，提示写设定的分钟数 ——
    go('home')
    ev(FAKE_AUDIO)
    go('whitenoise')
    ev("(()=>{const s=Storage.get();s.whitenoise=Object.assign(s.whitenoise||{},{minutes:30,type:'pink',volume:3,playing:false,paused:false});Storage.save()})()")
    p.click('.wn-art[data-type="pink"]'); p.wait_for_timeout(400)
    if not ev("document.getElementById('wpToggle').getAttribute('data-state')=='starting'"):
        p.click('#wpToggle'); p.wait_for_timeout(120)
    ev("__FA[__FA.length-1]._ok()"); p.wait_for_timeout(150)
    ev("__FA[__FA.length-1].pause()"); p.wait_for_timeout(150)
    ev("(()=>{const w=Storage.get().whitenoise;w.leftMs=4*60000;Storage.save();const v=document.querySelector('#wpVol');v.value='5';v.dispatchEvent(new Event('input',{bubbles:true}));v.dispatchEvent(new Event('change',{bubbles:true}))})()"); p.wait_for_timeout(150)
    p.click('#wpToggle'); p.wait_for_timeout(200)
    ev("__FA[__FA.length-1]._ok()"); p.wait_for_timeout(150)
    wv = ev("[Storage.get().whitenoise.minutes, Math.round((Storage.get().whitenoise.until-Date.now())/60000)]")
    ev("(()=>{const a=__FA[__FA.length-1];a.ended=true;a.onended&&a.onended()})()"); p.wait_for_timeout(200)
    tt = ev("[...document.querySelectorAll('.toast')].map(t=>t.textContent).join('|')")
    check('#278 白噪音：暂停中改音量后继续（按剩余 4 分钟重建），到点提示仍写「已按 30 分钟定时关闭」', wv[0] == 30 and wv[1] == 4 and '30 分钟定时关闭' in tt and '4 分钟定时关闭' not in tt, [wv, tt[-120:]])
    ev("Modules.whitenoise._stop&&Modules.whitenoise._stop()")
    check('第 278 次无报错', not errs, errs)
    ctx.close()

# 第 279 次：TOUCH_JS 的扩展版——end 可取 'cancel'（touchcancel）/ 'none'（不松手）；WebKit 没有 Touch 构造器时退回普通 Event
TOUCH2_JS = r"""([x0,y0,x1,y1,end,steps,ms])=>new Promise(res=>{const t=document.elementFromPoint(x0,y0)||document.body;
 const mk=(x,y)=>{try{return new Touch({identifier:1,target:t,clientX:x,clientY:y,pageX:x,pageY:y+scrollY})}catch(_){return {identifier:1,target:t,clientX:x,clientY:y,pageX:x,pageY:y+scrollY}}};
 const fire=(ty,x,y)=>{const tt=(ty==='touchend'||ty==='touchcancel')?[]:[mk(x,y)];let e;try{e=new TouchEvent(ty,{bubbles:true,cancelable:true,touches:tt,targetTouches:tt,changedTouches:[mk(x,y)]})}catch(_){e=new Event(ty,{bubbles:true,cancelable:true});Object.defineProperty(e,'touches',{value:tt});Object.defineProperty(e,'changedTouches',{value:[mk(x,y)]})}t.dispatchEvent(e);return e};
 if(!window.__t2nostart)fire('touchstart',x0,y0);window.__t2nostart=false;const n=Math.max(1,steps);let i=0;
 const step=()=>{i++;fire('touchmove',x0+(x1-x0)*i/n,y0+(y1-y0)*i/n);if(i<n)setTimeout(step,ms);else{if(end==='cancel')setTimeout(()=>{fire('touchcancel',x1,y1);res(1)},0);else if(end==='none')res(1);else setTimeout(()=>{fire('touchend',x1,y1);res(1)},end===2?150:0)}};
 setTimeout(step,ms)})"""
SD_ST = """(()=>{const r=document.getElementById('sideDrawer'),a=document.getElementById('app'),m=document.getElementById('sdMask');
 const mk=[...document.querySelectorAll('#modalRoot > .modal-mask')].filter(x=>!x.classList.contains('sheet-leaving')).length;
 return {open:Drawer.isOpen(),cls:['sd-open','sd-lock','sd-drag'].filter(c=>document.body.classList.contains(c)).join(','),
  left:r?Math.round(r.getBoundingClientRect().left):null,appX:Math.round(new DOMMatrix(getComputedStyle(a).transform).m41),
  inl:(r?r.style.transform:'')+'|'+a.style.transform,mask:m?(+getComputedStyle(m).opacity).toFixed(2)+'/'+getComputedStyle(m).visibility:'',sheets:mk,
  st:JSON.stringify(history.state),tab:App.currentTab(),rad:r?getComputedStyle(r).borderRadius+'/'+getComputedStyle(r).boxShadow:'',
  inert:a.inert,ph:document.querySelectorAll('body > .ph-view').length}})()"""


def test_r279(b):
    """第 279 次（真机录屏）：侧拉页 + 盖在上面的「宝宝资料」面板——拖拽不接管、一起关、history 不残留、拖拽必定落定、
    系统返回快照取未推开的首页；其他叠层组合（搜索 / 设置页面板 / 照片大图 / 咿呀岛）。"""
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, has_touch=True)
    p = ctx.new_page(); errs = []
    p.on('pageerror', lambda e: errs.append(str(e)[:160]))
    p.goto(URL); p.wait_for_timeout(600); p.evaluate('t=>Storage.importJSON(t)', SEED_V3); p.reload(); p.wait_for_timeout(1000)
    ev = p.evaluate
    drag = lambda *a: ev(TOUCH2_JS, list(a))
    st = lambda: ev(SD_ST)
    clean = lambda s: s['cls'] == '' and s['appX'] == 0 and s['inl'] == '|' and s['mask'].startswith('0.00/') and not s['inert'] and s['sheets'] == 0

    def swap():
        ev("Drawer.open()"); p.wait_for_timeout(550)
        ev("document.querySelector('#sideDrawer [data-sd=swap]').click()"); p.wait_for_timeout(450)
    # —— A：面板盖在侧拉页上 ——
    swap()
    s = st()
    check('#279 侧拉页上的切换宝宝面板登记自己的 history（ov），不再靠「关面板再补推侧拉页记录」', s['open'] and s['sheets'] == 1 and s['st'] == '{"baoma":"ov"}', s)
    drag(330, 200, 60, 204, False, 8, 16); p.wait_for_timeout(40)
    s = st()
    check('#279 面板开着时在侧拉页上左拉：侧拉页不跟手（不进入拖拽态）', s['left'] == 0 and 'sd-drag' not in s['cls'], s)
    drag(60, 204, 59, 204, True, 1, 0); p.wait_for_timeout(700)
    s = st()
    check('#279 松手后侧拉页、面板都还开着——不会只关侧拉页、留下孤立面板', s['open'] and s['sheets'] == 1 and s['left'] == 0 and s['appX'] == 109, s)
    ev("Drawer.close()"); p.wait_for_timeout(900)
    s = st()
    check('#279 侧拉页关闭时盖在上面的面板一起关，history 一次退回第一条（go(-2)）', not s['open'] and clean(s) and s['st'] == 'null', s)
    swap()
    p.keyboard.press('Escape'); p.wait_for_timeout(500)
    s = st()
    check('#279 Esc 第一次只关面板（history 退到侧拉页那条）', s['open'] and s['sheets'] == 0 and s['st'] == '{"baoma":"drawer"}', s)
    p.keyboard.press('Escape'); p.wait_for_timeout(800)
    s = st()
    check('#279 Esc 第二次关侧拉页，首页复位', not s['open'] and clean(s) and s['st'] == 'null', s)
    swap()
    ev("document.querySelector('#modalRoot .modal-mask').click()"); p.wait_for_timeout(600)
    s = st()
    check('#279 点面板外的遮罩只关面板，侧拉页留着、history 站在侧拉页那条', s['open'] and s['sheets'] == 0 and s['st'] == '{"baoma":"drawer"}', s)
    ev("Drawer.close()"); p.wait_for_timeout(800)
    swap()
    ev("history.back()"); p.wait_for_timeout(700)
    s1 = st()
    ev("history.back()"); p.wait_for_timeout(900)
    s2 = st()
    check('#279 系统返回两次：先关面板（侧拉页留着），再关侧拉页、首页复位', s1['open'] and s1['sheets'] == 0 and s1['st'] == '{"baoma":"drawer"}' and not s2['open'] and clean(s2) and s2['st'] == 'null', [s1, s2])
    swap()
    ev("document.querySelector('#modalRoot #sheetAdd').click()"); p.wait_for_timeout(600)
    s = st()
    check('#279 面板里换成宝宝资料表单：还算同一层（一条 ov），侧拉页仍开着', s['open'] and s['sheets'] == 1 and s['st'] == '{"baoma":"ov"}', s)
    ev("Drawer.close()"); p.wait_for_timeout(900)
    check('#279 关侧拉页：表单一起关、history 退干净', clean(st()) and st()['st'] == 'null', st())
    # 面板里「宝宝设置」切到设置页：侧拉页连同面板收起（同步切页 = iOS 上 showTab 不走 View Transition）
    for sync in (False, True):
        tag = '（iOS 同步切页）' if sync else '（转场切页）'
        if sync:
            ev("document.startViewTransition=undefined")
        swap()
        ev("document.querySelector('#sheetManage').click()"); p.wait_for_timeout(1500)
        s = st()
        check('#279 面板里「宝宝设置」进设置页：侧拉页、面板一起收起，history 不留侧拉页 / 面板记录' + tag,
              s['tab'] == 'settings' and not s['open'] and clean(s) and all(k not in s['st'] for k in ('"drawer"', '"ov"', '"guard"')), s)
        ev("history.back()"); p.wait_for_timeout(700); ev("history.back()"); p.wait_for_timeout(900)
        s = st()
        check('#279 接着返回两次回到首页、history 回到第一条' + tag, s['tab'] == 'home' and not s['open'] and s['st'] == 'null' and clean(s), s)
        if sync:
            ev("delete document.startViewTransition")
        if ev("App.currentTab()") != 'home':
            ev("App.showTab('home',{noVT:true})"); p.wait_for_timeout(500)
    # —— B：拖拽必定落定 ——
    drag(6, 420, 6 + 150, 424, 'cancel', 8, 16); p.wait_for_timeout(900)
    s = st()
    check('#279 拉开途中 touchcancel：按位置落到全关（38%），无内联位移、history 退干净', not s['open'] and clean(s) and s['st'] == 'null', s)
    drag(6, 420, 6 + 260, 424, 'cancel', 8, 16); p.wait_for_timeout(900)
    s = st()
    check('#279 拉过半时 touchcancel：落到全开', s['open'] and s['left'] == 0 and 'sd-drag' not in s['cls'] and s['inl'] == '|' and s['st'] == '{"baoma":"drawer"}', s)
    ev("Drawer.close()"); p.wait_for_timeout(800)
    drag(6, 420, 6 + 200, 424, 'none', 8, 16); p.wait_for_timeout(30)
    s = st()
    check('#279 拉开一判定就先登记 history（WebKit 在 pushState 时拍系统返回快照，拍到的是没推开的首页）', s['st'] == '{"baoma":"drawer"}' and 'sd-drag' in s['cls'], s)
    p.wait_for_timeout(1500)
    s = st()
    check('#279 手指停在半路、touchend 被系统手势吞掉：1.2 秒后兜底落定（不停在半开）', 'sd-drag' not in s['cls'] and s['inl'] == '|' and (s['open'] and abs(s['left']) <= 2 or clean(s)), s)
    ev("Drawer.isOpen()&&Drawer.close()"); p.wait_for_timeout(800)
    drag(6, 420, 6 + 120, 424, 'none', 8, 16); p.wait_for_timeout(30)
    drag(200, 300, 201, 300, True, 1, 0); p.wait_for_timeout(900)
    s = st()
    check('#279 上一次拖拽没收到 touchend 就来了新的触摸：先按位置落定（29% → 全关），不留 sd-drag / 内联位移（真机「停在半开」）', clean(s) and not s['open'] and s['st'] == 'null', s)
    drag(6, 420, 6 + 200, 424, 'none', 8, 16); p.wait_for_timeout(30)
    ev("history.back()"); p.wait_for_timeout(900)
    s = st()
    check('#279 拖拽中途来了系统返回（popstate）：拖拽立即落定并按返回关掉侧拉页', 'sd-drag' not in s['cls'] and not s['open'] and clean(s) and s['st'] == 'null', s)
    ev("Drawer.isOpen()&&Drawer.close()"); p.wait_for_timeout(900)
    s = st()
    check('#279 全部关闭后首页完全复位（无位移、无压暗、无锁、页面可点、history 回到第一条）', clean(s) and s['st'] == 'null', s)
    drag(6, 420, 6 + 150, 424, 'none', 8, 16); p.wait_for_timeout(40)
    s = st()
    check('#279 拖动中侧拉页、底下页都无圆角无投影', s['rad'] == '0px/none' and ev("(()=>{const a=getComputedStyle(document.getElementById('app'));return a.borderTopLeftRadius+'/'+a.boxShadow+'/'+a.clipPath})()") == '0px/none/none', s)
    drag(156, 424, 120, 424, True, 2, 16); p.wait_for_timeout(900)
    # 侧拉页开着时左拉关闭：history 退干净
    ev("Drawer.open()"); p.wait_for_timeout(550)
    drag(300, 400, 40, 404, True, 6, 16); p.wait_for_timeout(900)
    s = st()
    check('#279 侧拉页上左拉关闭：首页复位、history 回到第一条', not s['open'] and clean(s) and s['st'] == 'null', s)
    # —— C：其他叠层组合 ——
    ev("Drawer.open()"); p.wait_for_timeout(550)
    ev("document.querySelector('#sideDrawer .sd-search').click()"); p.wait_for_timeout(700)
    s = st()
    check('#279 侧拉页 → 搜索：侧拉页收起、底页复位，history 只剩搜索页一条', s['tab'] == 'search' and not s['open'] and clean(s) and s['st'] == '{"baoma":1,"id":"search"}', s)
    ev("history.back()"); p.wait_for_timeout(800)
    s = st()
    check('#279 搜索页返回：回首页、侧拉页不再冒出来', s['tab'] == 'home' and not s['open'] and s['st'] == 'null' and clean(s), s)
    ev("Drawer.open()"); p.wait_for_timeout(550)
    ev("document.querySelector('#sideDrawer [data-sd-go=growth]').click()"); p.wait_for_timeout(700)
    ev("Modules.growth&&document.querySelector('#view [data-add], #view .fab, #view .btn-primary')&&document.querySelector('#view [data-add], #view .fab, #view .btn-primary').click()"); p.wait_for_timeout(600)
    s1 = st()
    ev("history.back()"); p.wait_for_timeout(700)
    s2 = st()
    check('#279 侧拉页 → 功能页 → 页内面板：返回先关面板、留在功能页，侧拉页不出现', s1['tab'] == 'growth' and not s1['open'] and (s1['sheets'] == 0 or (s2['sheets'] == 0 and s2['tab'] == 'growth')) and not s2['open'] and s2['cls'] == '', [s1, s2])
    if ev("App.currentTab()") != 'home':
        ev("history.back()"); p.wait_for_timeout(800)
    # 咿呀岛：侧拉页开着 / 拖动中提示出现在屏幕顶部居中，不跟着底页右移
    ev("Drawer.open()"); p.wait_for_timeout(550)
    ev("Util.toast('测试提示','ok')"); p.wait_for_timeout(500)
    tr = ev("(()=>{const t=document.querySelector('#toastRoot .toast, #toastRoot > *');if(!t)return null;const r=t.getBoundingClientRect();return [Math.round(r.left+r.width/2),Math.round(r.top),getComputedStyle(document.getElementById('toastRoot')).zIndex]})()")
    check('#279 侧拉页开着时的提示岛：屏幕顶部居中（不随底页右移）、盖在侧拉页上', tr is not None and abs(tr[0] - 195) <= 3 and tr[1] < 140, tr)
    ev("Drawer.close()"); p.wait_for_timeout(800)
    check('#279 pageerror 为 0', not errs, errs)
    ctx.close()


def test_r280(b):
    """第 280 次：营养品重做——常用预设填充、6 步前进后退保留值、保存后日程 / 清单、记录服用与撤销、库存扣减、
    旧数据兼容（无 times 的计划、无 slot 的记录、remindAt）、首页磁贴 / 提醒 / 交接班 / CSV / 日期记录口径、XSS。"""
    ctx = b.new_context(viewport={'width': 390, 'height': 844})
    p = ctx.new_page(); errs = []
    p.on('pageerror', lambda e: errs.append(str(e)[:160]))
    p.goto(URL); p.wait_for_timeout(600); p.evaluate('t=>Storage.importJSON(t)', SEED_V3); p.reload(); p.wait_for_timeout(1000)
    ev = p.evaluate

    def go(t):
        ev(f"App.showTab('{t}',{{noVT:true}})"); p.wait_for_timeout(260)

    def clk(sel):
        ev(f"document.querySelector({json.dumps(sel)}).click()"); p.wait_for_timeout(160)

    def preset(k):
        ev(f"(()=>{{const s=document.querySelector('#spwPreset');s.value='{k}';s.dispatchEvent(new Event('change',{{bubbles:true}}))}})()"); p.wait_for_timeout(160)
    W = "(()=>{const w=document.querySelector('[data-spw]');if(!w)return null;const on=w.querySelector('.spw-form.on');const of=w.querySelector('.spw-of');const nm=w.querySelector('#spwName');" \
        "return {step:of?of.textContent:'',name:nm?nm.value:null,form:on?on.getAttribute('data-form'):null,dose:[...w.querySelectorAll('.spw-dose')].map(x=>x.textContent)," \
        "spec:(w.querySelector('#spwSpec')||{}).value,big:(w.querySelector('.spw-big')||{}).textContent,next:(w.querySelector('[data-next]')||{}).textContent," \
        "dim:!!w.querySelector('[data-next].is-dim'),prog:document.querySelectorAll('.spw-prog i.on').length,groups:[...w.querySelectorAll('optgroup')].map(g=>g.label)}})()"
    ev("(()=>{const d=Storage.get();d.supplementPlans=[];d.supplements=[];d.supplies=[];d.settings.stage='baby';Storage.save();localStorage.removeItem('yiya-sup-remind')})()")
    go('supplement')
    e0 = ev("[document.querySelector('.sp-none')&&document.querySelector('.sp-none').textContent, document.querySelector('.sp-empty p')&&document.querySelector('.sp-empty p').textContent, document.querySelectorAll('.sp-day').length, (document.querySelector('.sp-day.on small')||{}).textContent, document.querySelector('.mod-hero h1').textContent]")
    check('#280 空状态：「这一天没有安排服用日程。」+ 清单空插画文案、一周 7 天日期条今天高亮、标题「营养品」',
          e0 == ['这一天没有安排服用日程。', '添加营养品，安排适合自己的服用日程。', 7, '今', '营养品'], e0)
    # —— 预设 ——
    clk('[data-spadd]'); p.wait_for_timeout(300)
    w1 = ev(W)
    check('#280 向导第 1 步：6 段进度点亮 1 段、默认剂型胶囊、没名字时「下一步」变淡；预设分组宝宝在前', w1 and w1['step'] == '第 1 步，共 6 步' and w1['prog'] == 1 and w1['form'] == '胶囊' and w1['dim'] and w1['groups'] == ['宝宝', '妈妈'], w1)
    preset('b-ad'); w2 = ev(W)
    check('#280 预设「维生素AD」：自动填名称、剂型滴剂、下一步可点', w2['name'] == '维生素AD' and w2['form'] == '滴剂' and not w2['dim'], w2)
    preset('m-fa'); w3 = ev(W)
    check('#280 预设「叶酸」（妈妈组）：名称叶酸、剂型片剂', w3['name'] == '叶酸' and w3['form'] == '片剂', w3)
    preset('b-ad'); clk('[data-next]'); w4 = ev(W)
    check('#280 第 2 步：规格默认「未注明规格」（预设不强塞规格）', w4['step'] == '第 2 步，共 6 步' and w4['big'] == '未注明规格', w4)
    clk('[data-specsw]')
    sug = ev("[...document.querySelectorAll('[data-specq]')].map(b=>b.getAttribute('data-specq'))")
    check('#280 打开规格开关：输入框为空，常见规格只作为可选建议列出', ev("document.querySelector('#spwSpec').value") == '' and len(sug) == 2 and 'A 1500 IU + D 500 IU' in sug, sug)
    clk('[data-specq]')
    clk('[data-next]'); w5 = ev(W)
    check('#280 第 3 步：预设默认单位（维生素AD 按「粒」）', w5['dose'] == ['1 粒'], w5)
    clk('[data-addt]'); clk('[data-tn="1"][data-d="1"]')
    w6 = ev(W)
    check('#280 添加时间 + 用量步进：两个时间、第二个 2 粒', w6['dose'] == ['1 粒', '2 粒'] and ev("[...document.querySelectorAll('[data-t]')].map(x=>x.value)") == ['08:00', '12:00'], w6)
    clk('[data-next]'); clk('[data-meal="after"]'); clk('[data-next]')
    w7 = ev(W)
    # 一路后退到第 1 步再前进：值都还在
    for _ in range(4):
        clk('[data-prev]')
    w8 = ev(W)
    clk('[data-next]'); w9 = ev(W); clk('[data-next]'); w10 = ev(W); clk('[data-next]'); w11 = ev(W)
    check('#280 前进到第 5 步再一路后退到第 1 步、再前进：名称 / 剂型 / 规格 / 两个时间和用量 / 服用方式都保留',
          w7['step'] == '第 5 步，共 6 步' and w8['step'] == '第 1 步，共 6 步' and w8['name'] == '维生素AD' and w8['form'] == '滴剂'
          and w9['spec'] == 'A 1500 IU + D 500 IU' and w10['dose'] == ['1 粒', '2 粒'] and w11['step'] == '第 4 步，共 6 步'
          and ev("!!document.querySelector('[data-meal=\"after\"].active')"), [w8, w9, w10, w11])
    clk('[data-next]')
    # 库存：当场添加用品并关联
    clk('[data-pick]')
    pk = ev("[document.querySelector('#ftsTitle').textContent, (document.querySelector('.spw-empty')||{}).textContent, !document.querySelector('.rs-head [data-addsup]').hidden]")
    check('#280 选择用品：标题「选择用品」、右上「添加用品」、没有用品时「先添加一件营养品用品，再关联到记录。」', pk == ['选择用品', '先添加一件营养品用品，再关联到记录。', True], pk)
    clk('.rs-head [data-addsup]')
    ev("(()=>{const n=document.querySelector('#spwSupN');n.value='30';})()")
    clk('[data-supsave]')
    clk('[data-remsw]')
    st5 = ev("[document.querySelector('.spw-link b').textContent, (document.querySelector('.spw-link small')||{}).textContent, Storage.get().supplies.length, Storage.get().supplies[0].pieces, Storage.get().supplies[0].cat]")
    check('#280 添加用品并关联：用品进「用品」模块（维D/药品，剩 30 粒），第 5 步显示已关联', st5 == ['维生素AD', '剩 30 粒', 1, 30, '维D/药品'], st5)
    clk('[data-next]')
    kv = ev("[...document.querySelectorAll('.spw-kv')].map(x=>x.textContent)")
    check('#280 第 6 步确认：名称 / 剂型 / 规格 / 频率 / 每个时间与用量 / 服用方式 / 本机提醒 / 库存都列出，按钮「保存营养品」',
          '名称维生素AD' in kv and '剂型滴剂' in kv and '规格A 1500 IU + D 500 IU' in kv and '服用频率每天 · 2 次' in kv and '08:001 粒' in kv and '12:002 粒' in kv
          and '服用方式餐后' in kv and '本机提醒开启' in kv and any(x.startswith('库存维生素AD · 每次扣 1 粒') for x in kv) and ev(W)['next'] == '保存营养品', kv)
    clk('[data-next]'); p.wait_for_timeout(300)
    pl = ev("(()=>{const p=Storage.get().supplementPlans[0];return {n:p.name,f:p.form,per:p.perDay,v:p.v,t:p.times,u:p.unit,sp:p.spec,fr:p.freq,st:p.start,m:p.meal,stock:p.stock&&p.stock.n,rem:Modules.supplement._remindOn(p),ra:'remindAt' in p}})()")
    check('#280 保存：计划带 v2 字段（times / unit / spec / freq / start / meal / stock），perDay = 时间数，本机提醒存在本机',
          pl['n'] == '维生素AD' and pl['f'] == '滴剂' and pl['per'] == 2 and pl['v'] == 2 and pl['t'] == [{'t': '08:00', 'n': 1}, {'t': '12:00', 'n': 2}]
          and pl['u'] == '粒' and pl['sp'] == 'A 1500 IU + D 500 IU' and pl['fr'] == 'daily' and pl['m'] == 'after' and pl['stock'] == 1 and pl['rem'] and not pl['ra'], pl)
    cards = ev("[...document.querySelectorAll('.sp-dose')].map(c=>c.querySelector('.sp-t').textContent+'|'+c.querySelector('.sp-n').textContent+'|'+c.querySelector('small').textContent)")
    items = ev("[...document.querySelectorAll('.sp-item')].map(c=>c.textContent)")
    check('#280 保存后首页：服用日程两张卡（时间 / 名称 / 用量 · 服用方式），营养品清单「每天 · 2 次」', cards == ['08:00|维生素AD|1 粒 · 餐后', '12:00|维生素AD|2 粒 · 餐后'] and items == ['维生素AD每天 · 2 次'], [cards, items])
    # —— 记录服用 / 撤销 ——
    clk('.sp-dose[data-slot="0"]'); p.wait_for_timeout(300)
    r1 = ev("(()=>{const r=Storage.get().supplements[0];return {n:Storage.get().supplements.length,slot:r.slot,dose:r.dose,plan:r.planId===Storage.get().supplementPlans[0].id,stock:r.stock&&r.stock.n,pcs:Storage.get().supplies[0].pieces,done:document.querySelectorAll('.sp-dose.is-done').length,due:Modules.supplement._due(Storage.get()).map(x=>[x.need,x.done])}})()")
    check('#280 点日程卡记录服用：写 slot / dose / planId，库存 30→29，卡片打勾，今日 1/2', r1['n'] == 1 and r1['slot'] == '08:00' and r1['dose'] == '1 粒' and r1['plan'] and r1['stock'] == 1 and r1['pcs'] == 29 and r1['done'] == 1 and r1['due'] == [[2, 1]], r1)
    ho = ev("Modules.settings._handoff(Storage.get())")
    check('#280 交接班：营养品写「维生素AD 1/2」', '◆ 营养品（今天）' in ho and '维生素AD 1/2' in ho, ho[-200:])
    idx = ev("(Util.buildDayIndex(Storage.get())[Util.todayISO()]||[]).filter(x=>x.label==='营养品').map(x=>x.val)")
    check('#280 日期记录 / 回顾：服用记录进当天明细（营养品 维生素AD 1 粒）', idx == ['维生素AD 1 粒'], idx)
    clk('.sp-dose[data-slot="0"]'); p.wait_for_timeout(400)
    r2 = ev("[Storage.get().supplements.length, Storage.get().supplies[0].pieces, document.querySelectorAll('.sp-dose.is-done').length]")
    check('#280 再点一次撤销：记录删掉、库存退回 30、卡片取消打勾', r2 == [0, 30, 0], r2)
    ev("[...document.querySelectorAll('#toastRoot .toast button')].filter(b=>/撤销/.test(b.textContent)).forEach(b=>b.click())"); p.wait_for_timeout(400)
    check('#280 撤销的撤销：记录回来、库存再扣到 29', ev("[Storage.get().supplements.length, Storage.get().supplies[0].pieces]") == [1, 29])
    # 未来的日期不能记
    ev("document.querySelectorAll('.sp-day')[2].click()"); p.wait_for_timeout(300)
    clk('.sp-dose[data-slot="0"]')
    check('#280 选到后天：日程照常显示，点卡片不记录（还没到这一天）', ev("[document.querySelectorAll('.sp-dose').length, Storage.get().supplements.length]") == [2, 1])
    clk('[data-today]')
    # 提醒：v2 计划本机提醒开着、过了 08:00 没记满 → 首页提醒；关掉就不提醒
    rem = ev("(()=>{const d=Storage.get();d.supplements=[];Storage.save();const t=new Date();t.setHours(12,30,0,0);const a=Reminders.evaluate(d,t.getTime()).filter(x=>x.go==='supplement').length;Modules.supplement._setRemind(d.supplementPlans[0].id,false);const b=Reminders.evaluate(d,t.getTime()).filter(x=>x.go==='supplement').length;Modules.supplement._setRemind(d.supplementPlans[0].id,true);const t2=new Date();t2.setHours(7,0,0,0);const c=Reminders.evaluate(d,t2.getTime()).filter(x=>x.go==='supplement').length;return [a,b,c]})()")
    check('#280 首页提醒：本机提醒开着、到点没记 → 提醒；本机提醒关 → 不提醒；还没到 08:00 → 不提醒', rem == [1, 0, 0], rem)
    # 每周特定几天：不在今天就不出日程、不计入首页磁贴
    ev("(()=>{const d=Storage.get(),p=d.supplementPlans[0],w=new Date().getDay()||7;p.freq='weekly';p.days=[w===1?2:1];Storage.save()})()"); go('supplement')
    wk = ev("[document.querySelectorAll('.sp-dose').length, Modules.supplement._due(Storage.get()).length, (document.querySelector('.sp-item small')||{}).textContent]")
    check('#280 每周特定几天：今天不是那天 → 今天没有日程、不计入要吃的；清单写「每周X」', wk[0] == 0 and wk[1] == 0 and wk[2].startswith('每周'), wk)
    ev("(()=>{const d=Storage.get(),p=d.supplementPlans[0];p.freq='daily';delete p.days;Storage.save()})()")
    # 编辑：向导预填，保存不换 id
    go('supplement'); clk('.sp-item'); p.wait_for_timeout(300)
    rs = ev("[document.querySelector('#ftsTitle').textContent, document.querySelector('.spr-name').textContent, document.querySelector('.spr-sub').textContent, document.querySelector('[data-remsw2]').getAttribute('aria-checked')]")
    check('#280 清单卡点开「提醒设置」：名称、每天 · 2 次、本机提醒开关', rs[0] == '提醒设置' and rs[1] == '维生素AD' and rs[2].startswith('每天 · 2 次') and rs[3] == 'true', rs)
    clk('[data-remsw2]'); clk('.spr-sheet [data-ok]'); p.wait_for_timeout(300)
    check('#280 提醒设置 ✓：关掉本机提醒并保存', ev("Modules.supplement._remindOn(Storage.get().supplementPlans[0])") is False)
    clk('.sp-item'); clk('[data-edit]'); p.wait_for_timeout(300)
    we = ev(W)
    check('#280 编辑营养品：向导预填名称 / 剂型，标题「编辑营养品」', we['name'] == '维生素AD' and we['form'] == '滴剂' and ev("document.querySelector('#ftsTitle').textContent") == '编辑营养品', we)
    ev("(()=>{const n=document.querySelector('#spwName');n.value='维生素AD（伊）';n.dispatchEvent(new Event('input',{bubbles:true}))})()")
    for _ in range(5):
        clk('[data-next]')
    clk('[data-next]'); p.wait_for_timeout(300)
    ed = ev("[Storage.get().supplementPlans.length, Storage.get().supplementPlans[0].name, Storage.get().supplementPlans[0].times.length]")
    check('#280 编辑保存：同一条计划改名，不新增', ed == [1, '维生素AD（伊）', 2], ed)
    # 重名：新增同名被拦
    clk('[data-spadd]'); ev("(()=>{const n=document.querySelector('#spwName');n.value='维生素AD（伊）';n.dispatchEvent(new Event('input',{bubbles:true}))})()")
    clk('[data-next]')
    check('#280 新增同名营养品：第 1 步拦下并标红', ev("[document.querySelector('.spw-of').textContent, !!document.querySelector('#spwName.is-invalid')]") == ['第 1 步，共 6 步', True])
    ev("Sheet.closeAll()"); p.wait_for_timeout(300)
    # —— 旧数据兼容 ——
    ev("""(()=>{const d=Storage.get();const t=Util.todayISO();d.supplementPlans=[{id:'L1',name:'维生素D',form:'滴剂',perDay:2,active:true,sortOrder:0,remindAt:'09:00'},{id:'L2',name:'锌剂',form:'怪剂型',perDay:1,active:false,sortOrder:1}];
      d.supplements=[{id:'o1',time:t+'T09:10:00',name:'维生素D',dose:null,note:null}];Storage.save();localStorage.removeItem('yiya-sup-remind')})()""")
    go('supplement')
    lg = ev("[[...document.querySelectorAll('.sp-dose')].map(c=>c.querySelector('.sp-t').textContent+(c.classList.contains('is-done')?'✓':'')), [...document.querySelectorAll('.sp-item')].map(c=>c.textContent), Modules.supplement._due(Storage.get()).map(x=>[x.need,x.done]), Modules.supplement._remindOn(Storage.get().supplementPlans[0])]")
    check('#280 旧计划（只有 perDay / remindAt）：按 09:00 起排两次、没 planId 没 slot 的旧记录填进第一格；停用的不出现；旧 remindAt 视为本机提醒开',
          lg == [['09:00✓', '13:00'], ['维生素D每天 · 2 次'], [[2, 1]], True], lg)
    check('#280 旧计划：交接班「维生素D 1/2」', '维生素D 1/2' in ev("Modules.settings._handoff(Storage.get())"))
    clk('.sp-item'); clk('[data-edit]'); p.wait_for_timeout(300)
    lw = ev(W)
    for _ in range(6):
        clk('[data-next]')
    p.wait_for_timeout(300)
    lp = ev("(()=>{const p=Storage.get().supplementPlans.filter(x=>x.id==='L1')[0];return [p.v,p.times.map(x=>x.t),'remindAt' in p,Modules.supplement._remindOn(p),Storage.get().supplements[0].name]})()")
    check('#280 旧计划在向导里保存一次：升成 v2（保留 id、时间 09:00/13:00、记录不丢），remindAt 换成本机提醒（开）',
          lw['form'] == '滴剂' and lp == [2, ['09:00', '13:00'], False, True, '维生素D'], [lw, lp])
    # CSV / 搜索
    go('settings')
    ev("(()=>{window.__csvB=null;const o=URL.createObjectURL;URL.createObjectURL=function(b){window.__csvB=b;return o.call(URL,b)};const s=document.querySelector('#sCsvModule');s.value='supplements';document.querySelector('#sCsv').click()})()"); p.wait_for_timeout(300)
    csv = ev("window.__csvB?window.__csvB.text():null")
    check('#280 设置 · 导出 CSV「营养品服用记录」：表头 时间 / 名称 / 用量 / 服用时间 / 备注，旧记录也导出', bool(csv) and '时间,名称,用量,服用时间,备注' in csv and '维生素D' in csv, (csv or '')[:200])
    # —— XSS ——
    X = '"><img src=x onerror="window.__pwn280=1"><i data-pwn280></i>'
    ev("x=>{const d=Storage.get();const t=Util.todayISO();d.supplementPlans=[{id:'x1',name:x,form:x,perDay:1,active:true,v:2,times:[{t:'08:00',n:1}],unit:x,spec:x,freq:x,days:[x],meal:x,note:x,stock:{id:x,n:x},start:x,end:x}];d.supplements=[{id:'x2',time:t+'T08:01:00',name:x,dose:x,slot:x,planId:'x1',note:x,stock:{id:x,n:1}}];d.supplies=[{id:'s1',name:x,cat:x,pieces:3,pcsU:x,unit:x,date:t}];Storage.save()}", X)
    go('supplement')
    clk('.sp-item'); clk('[data-edit]'); p.wait_for_timeout(200)
    for _ in range(4):
        clk('[data-next]')
    clk('[data-pick]'); clk('[data-x]')
    clk('[data-next]'); p.wait_for_timeout(200)
    ev("Sheet.closeAll()"); p.wait_for_timeout(300)
    clk('[data-manage]'); p.wait_for_timeout(200); ev("Sheet.closeAll()"); p.wait_for_timeout(200)
    go('home'); go('calendar'); go('search')
    ev("(()=>{const i=document.querySelector('input[type=search], #searchInput');if(i){i.value='img';i.dispatchEvent(new Event('input',{bubbles:true}))}})()"); p.wait_for_timeout(400)
    xs = ev("[document.querySelectorAll('[data-pwn280]').length, !!window.__pwn280, Modules.supplement._norm(Storage.get().supplementPlans[0]).form, Modules.supplies._pcsUnit(Storage.get().supplies[0])]")
    check('#280 XSS：名称 / 剂型 / 单位 / 规格 / 用量 / 用品名等全是载荷，页面 / 向导 / 选择用品 / 管理 / 首页 / 日历 / 搜索都不注入；坏剂型当「其他」、坏计数单位回落', xs == [0, False, '其他', '个'], xs)
    check('#280 pageerror 为 0', not errs, errs)
    ctx.close()

ALL_TESTS = ('test_data', 'test_flows', 'test_format', 'test_home_edit', 'test_family', 'test_dash', 'test_diaper_sheet',
             'test_diaper_stock', 'test_diaper_photos', 'test_feeding_sheet', 'test_pump', 'test_solid', 'test_css_rules',
             'test_layout_and_toast', 'test_r270', 'test_r271', 'test_r272', 'test_r273', 'test_r274', 'test_r275_boot', 'test_r275_glass', 'test_r276', 'test_r277', 'test_r278', 'test_r279', 'test_r280')
# 第 270 次：整套跑到 ~110 秒，逼近 115 秒上限。拆成两组（按实测耗时配平，各约 55 秒）并行跑两个子进程，
# 每组各起一个 Chromium、一个本地服务；输出顺序、断言内容不变。`--serial` 仍可单进程顺序跑。
# 第 272 次：再拆一组（第 272 次断言 + 从前两组挪过来的两项），三个子进程并行
# 第 273 次：第 273 次断言单独一组，四个子进程并行
# 第 274 次：第 274 次断言单独一组，五个子进程并行
# 第 275 次：启动 / dock 折射断言单独一组，六个子进程并行
GROUPS = (('test_feeding_sheet', 'test_layout_and_toast', 'test_data', 'test_diaper_photos', 'test_family'),
          ('test_css_rules', 'test_diaper_stock', 'test_solid', 'test_diaper_sheet',
           'test_dash', 'test_home_edit', 'test_format'),
          ('test_r270', 'test_r271', 'test_r272'),
          ('test_r273',),
          ('test_r274',),
          ('test_r275_boot', 'test_r275_glass'),
          ('test_r276', 'test_flows', 'test_pump'),
          ('test_r277',),
          ('test_r278',),
          ('test_r279',),
          ('test_r280',))  # 第 278 次：第四轮审计 #30–#41 一组。第 277 次：咿呀岛 / 玻璃深化一组。第 276 次：新断言一组，并从第二组挪来两项配平（`--times` 打印各项耗时）
assert sorted(sum(GROUPS, ())) == sorted(ALL_TESTS)


def run_tests(names):
    out = {}
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        import time as _t
        for name in names:
            start = len(results)
            t0 = _t.time()
            try:
                globals()[name](b)
            except Exception as e:  # 一组崩了不影响其他组
                check(name + ' 运行', False, repr(e)[:200])
            out[name] = results[start:]
            print(f'@@TIME {name} {_t.time() - t0:.1f}s', file=sys.stderr)
        b.close()
    return out


def report(rows):
    fails = [r for r in rows if not r[1]]
    for name, ok, detail in rows:
        print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else f'  ← {detail}'))
    print(f'\n{len(rows) - len(fails)}/{len(rows)} 通过')
    sys.exit(1 if fails else 0)


def main():
    if '--only' in sys.argv:
        names = sys.argv[sys.argv.index('--only') + 1].split(',')
        out = run_tests(names)
        print('@@RESULTS ' + json.dumps({k: [[n, bool(ok), str(d)] for n, ok, d in v] for k, v in out.items()}, ensure_ascii=False))
        return
    if '--serial' in sys.argv:
        out = run_tests(ALL_TESTS)
        report([r for name in ALL_TESTS for r in out[name]])
        return
    import subprocess
    procs = [subprocess.Popen([sys.executable, __file__, '--only', ','.join(g)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
             for g in GROUPS]
    merged = {}
    for g, pr in zip(GROUPS, procs):
        so, se = pr.communicate()
        if '--times' in sys.argv:
            print(' '.join(ln[7:] for ln in (se or '').splitlines() if ln.startswith('@@TIME ')))
        line = next((ln for ln in so.splitlines() if ln.startswith('@@RESULTS ')), None)
        if line is None:
            for name in g:
                merged[name] = [(name + ' 运行', False, (se or so)[-300:])]
            continue
        for k, v in json.loads(line[len('@@RESULTS '):]).items():
            merged[k] = [tuple(x) for x in v]
    report([r for name in ALL_TESTS for r in merged.get(name, [(name + ' 运行', False, '子进程没有返回结果')])])


if __name__ == '__main__':
    main()
