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
    # 第 274 次：五组并行时 CPU 吃紧，2.6 秒内偶尔只载入 44–48 张；改为最多再等 6 秒（断言内容不变：都要载入）
    try:
        p.wait_for_function("Hero._warmed() >= 50", timeout=6000)
    except Exception:
        pass
    check('插画预热：页头 / 尿布 / 声音 / 辅食图都已载入', ev("Hero._warmed()") >= 50, ev("Hero._warmed()"))
    check('插画预热后进页，页头插画同步可画', ev("(()=>{App.showTab('diaper',{noVT:true});const im=document.querySelector('.mod-hero img');return !!im&&im.complete&&im.naturalWidth>0})()"))
    p.click('[data-new]'); p.wait_for_timeout(450)
    ghost = ev("(async()=>{document.querySelector('#modalRoot .rs-x').click();await Promise.resolve();const g=document.querySelector('.sheet-ghost');return g?[!!g.querySelector('[id]'),g.getAttribute('aria-hidden'),getComputedStyle(g).pointerEvents]:null})()")
    check('关面板：留下无 id、不可点的替身往下滑', ghost == [False, 'true', 'none'], ghost)
    p.wait_for_timeout(450)
    check('关面板：替身动画后移除', ev("!document.querySelector('.sheet-ghost')"))
    check('打开面板：遮罩不再整体淡入（面板不半透明）', ev("(()=>{const m=document.createElement('div');m.className='modal-mask as-sheet';document.body.appendChild(m);const a=getComputedStyle(m).animationName;m.remove();return a})()") == 'sheetMaskIn')
    check('抽屉：底色向上下多铺，缩放时不露页面底', ev("(()=>{Drawer.open();const cs=getComputedStyle(document.querySelector('.side-drawer'),'::before');const r=[cs.content,cs.top];Drawer.close();return r})()")[0] == '""')
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
    check('白噪音：dock 返回离开本页，播放页立刻收起', ev("[App.currentTab(), !!document.querySelector('.wn-player.open'), document.documentElement.classList.contains('wp-lock')]") == ['home', False, False])
    # —— 全屏计时（泵奶）——
    p.wait_for_timeout(400)
    ev("App.showTab('pump',{noVT:true})"); p.wait_for_timeout(200)
    ev("Storage.get().pumpTimer={start:new Date().toISOString(),L:true,R:true,segs:[]};Storage.save();Modules.pump._openFull()"); p.wait_for_timeout(500)
    ev("syncStatusColor()"); c, r = tc(), row0()
    check('状态栏：泵奶全屏计时取全屏层顶色（深色）', near(c, r) and sum(r) < 150, [c, r])
    ev("document.querySelector('.ftf [data-p=dim]').click()"); p.wait_for_timeout(450); ev("syncStatusColor()")
    c, r = tc(), row0()
    check('状态栏：泵奶全屏「关背景图」后仍同色', near(c, r), [c, r])
    ev("Storage.get().pumpTimer=null;Storage.save();Modules.pump._closeFull?Modules.pump._closeFull():document.querySelector('.ftf').remove();document.body.classList.remove('ftf-open')"); p.wait_for_timeout(200)
    # —— 尿布面板 ——
    ev("App.showTab('diaper',{noVT:true})"); p.wait_for_timeout(300)
    p.click('[data-new]'); p.wait_for_timeout(600)
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


ALL_TESTS = ('test_data', 'test_flows', 'test_format', 'test_home_edit', 'test_family', 'test_dash', 'test_diaper_sheet',
             'test_diaper_stock', 'test_diaper_photos', 'test_feeding_sheet', 'test_pump', 'test_solid', 'test_css_rules',
             'test_layout_and_toast', 'test_r270', 'test_r271', 'test_r272', 'test_r273', 'test_r274')
# 第 270 次：整套跑到 ~110 秒，逼近 115 秒上限。拆成两组（按实测耗时配平，各约 55 秒）并行跑两个子进程，
# 每组各起一个 Chromium、一个本地服务；输出顺序、断言内容不变。`--serial` 仍可单进程顺序跑。
# 第 272 次：再拆一组（第 272 次断言 + 从前两组挪过来的两项），三个子进程并行
# 第 273 次：第 273 次断言单独一组，四个子进程并行
# 第 274 次：第 274 次断言单独一组，五个子进程并行
GROUPS = (('test_feeding_sheet', 'test_layout_and_toast', 'test_data', 'test_diaper_photos', 'test_family'),
          ('test_css_rules', 'test_flows', 'test_pump', 'test_diaper_stock', 'test_solid', 'test_diaper_sheet',
           'test_dash', 'test_home_edit', 'test_format'),
          ('test_r270', 'test_r271', 'test_r272'),
          ('test_r273',),
          ('test_r274',))
assert sorted(sum(GROUPS, ())) == sorted(ALL_TESTS)


def run_tests(names):
    out = {}
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        for name in names:
            start = len(results)
            try:
                globals()[name](b)
            except Exception as e:  # 一组崩了不影响其他组
                check(name + ' 运行', False, repr(e)[:200])
            out[name] = results[start:]
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
