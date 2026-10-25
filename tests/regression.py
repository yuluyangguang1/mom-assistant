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
    check('dock 上方出现「正在进行」胶囊', p.evaluate("(()=>{const e=document.getElementById('dockLive');return !!e&&!e.hidden&&e.getBoundingClientRect().bottom<innerHeight&&/睡眠/.test(e.textContent)})()"))
    check('快记在首屏', p.evaluate("document.querySelector('.hn-quick').getBoundingClientRect().bottom<innerHeight-70"))
    n0 = p.evaluate('Storage.get().diapers.length'); p.click('.hn-q[data-hnq="pee"]'); p.wait_for_timeout(200)
    check('快记「尿了」+1', p.evaluate('Storage.get().diapers.length') - n0 == 1)
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
    check('喂养：刷新后模式仍在', ev("document.querySelector('[data-fstart]').dataset.fstart") == 'breast')
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
    check('dock 二级页：返回在左、搜索居中、＋在右', ev("(()=>{const b=document.getElementById('tabbar');const xs=['#backBtn','.tab[data-tab=search]','.tab-plus'].map(q=>{const e=b.querySelector(q);return e&&e.offsetParent?e.getBoundingClientRect().x:-1});return xs[0]>=0&&xs[0]<xs[1]&&xs[1]<xs[2]})()"))
    ev("App.showTab('home')"); p.wait_for_timeout(400)
    check('宝宝切换是 dock 左侧独立圆钮且不贴着 dock', ev("(()=>{const o=document.getElementById('dockOrb'),b=document.getElementById('tabbar');if(!o||o.hidden||!o.contains(document.getElementById('avatarBtn')))return false;const r=o.getBoundingClientRect(),q=b.getBoundingClientRect();return q.left-r.right>=6&&r.left>=8})()"))
    check('dock 一级页不用 transform 位移（iOS 转场快照会重复算 -50%），左缘紧挨圆钮', ev("(()=>{const b=document.getElementById('tabbar'),o=document.getElementById('dockOrb');const t=getComputedStyle(b).transform;const g=b.getBoundingClientRect().left-o.getBoundingClientRect().right;return (t==='none')&&g>=6&&g<=12})()"))
    check('dock 按下缩放左右对称（不再右缘不动、左缘缩进）', ev("(()=>{const b=document.getElementById('tabbar');const r0=b.getBoundingClientRect();b.style.transition='none';b.classList.add('lg-press');const r1=b.getBoundingClientRect();b.classList.remove('lg-press');b.style.transition='';return Math.abs((r1.left-r0.left)-(r0.right-r1.right))<1.5})()"))
    check('dock 一级页：首页/日期/搜索三个页签（设置在左侧抽屉）', ev("Array.from(document.querySelectorAll('#tabbar .tab[data-tab]')).filter(e=>e.offsetParent).map(e=>e.dataset.tab).slice(0,4).join()") == 'home,calendar,search')
    ev("document.getElementById('avatarBtn').click()"); p.wait_for_timeout(500)
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
    check('液态玻璃 dock：二级页收起时水滴隐藏', ev("!document.querySelector('#tabbar .lg-thumb').classList.contains('on')"))
    ev("App.showTab('bottle')"); p.wait_for_timeout(400)
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


def main():
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        for fn in (test_data, test_flows, test_format, test_home_edit, test_family, test_dash, test_diaper_sheet, test_diaper_stock, test_diaper_photos, test_feeding_sheet, test_css_rules, test_layout_and_toast):
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
