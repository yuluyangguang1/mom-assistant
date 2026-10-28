"""第 275 次启动测量。python measure.py <root> <label> [--runs N] [--engines chromium,webkit]
冷启动：新上下文（只有 localStorage 种子数据，无 SW、无 HTTP 缓存）
热启动：同一上下文第一次打开后等 SW 装好缓存，再新开页面
网络：慢 4G（RTT 562ms、1.44Mbps，DevTools 预设）；CPU：Chromium 4x 降速（WebKit 无此能力，不降速）
standalone 模拟：navigator.standalone = true（会播启动动画层 #boot）
"""
import json, sys, time, statistics, os
sys.path.insert(0, os.path.dirname(__file__)); sys.path.insert(0, '/workspace/work/mom-assistant/tests')
import tserver
from seed_data import seed
from playwright.sync_api import sync_playwright
root = sys.argv[1]; label = sys.argv[2]
RUNS = int(sys.argv[sys.argv.index('--runs') + 1]) if '--runs' in sys.argv else 3
ENG = sys.argv[sys.argv.index('--engines') + 1].split(',') if '--engines' in sys.argv else ['chromium', 'webkit']
NET = sys.argv[sys.argv.index('--net') + 1] if '--net' in sys.argv else 'slow4g'
port = tserver.start(root)
URL = f'http://127.0.0.1:{port}/'
SEED = json.dumps(dict(seed, version=3), ensure_ascii=False)
INIT = r"""
(()=>{
 try{Object.defineProperty(navigator,'standalone',{get:()=>true});}catch(e){}
 const M=window.__m={gaps:[],lt:[],t:{}};
 const now=()=>performance.now();
 try{new PerformanceObserver(l=>{for(const e of l.getEntries()){if(e.name==='first-contentful-paint')M.t.fcp=e.startTime;if(e.name==='first-paint')M.t.fp=e.startTime;}}).observe({type:'paint',buffered:true});}catch(e){}
 try{new PerformanceObserver(l=>{for(const e of l.getEntries())M.lt.push([Math.round(e.startTime),Math.round(e.duration)]);}).observe({type:'longtask',buffered:true});}catch(e){}
 let last=0;function f(t){if(last&&t-last>50)M.gaps.push([Math.round(last),Math.round(t-last)]);if(!M.t.raf1)M.t.raf1=t;last=t;if(t<15000)requestAnimationFrame(f);}requestAnimationFrame(f);
 M.lag=[];let exp=now()+16;(function hb(){const n=now();if(n-exp>50)M.lag.push([Math.round(exp),Math.round(n-exp)]);exp=n+16;if(n<15000)setTimeout(hb,16);})();
 document.addEventListener('DOMContentLoaded',()=>M.t.dcl=now());
 addEventListener('load',()=>M.t.load=now());
 const mo=new MutationObserver(()=>{
   const v=document.getElementById('view');
   if(!M.t.home&&v&&v.querySelector('.home, [data-page="home"], .home-sky, .card'))M.t.home=now();
   if(M.t.home&&!M.t.bootGone&&!document.getElementById('boot'))M.t.bootGone=now();
   if(!M.t.cssOk&&document.body&&getComputedStyle(document.documentElement).backgroundColor!=='rgba(0, 0, 0, 0)')M.t.cssOk=now();
 });
 mo.observe(document,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
})();
"""
def collect(p):
    p.wait_for_function("()=>window.__m&&window.__m.t.bootGone&&performance.now()>window.__m.t.bootGone+1500", timeout=60000)
    m = p.evaluate("""()=>{const M=window.__m;const nav=performance.getEntriesByType('navigation')[0]||{};
      const res=performance.getEntriesByType('resource');
      return {t:M.t,lag:M.lag,gaps:M.gaps,lt:M.lt,ttfb:nav.responseStart,res:res.length,
        sw:!!(navigator.serviceWorker&&navigator.serviceWorker.controller),
        slowRes:res.filter(r=>r.duration>300).map(r=>[r.name.split('/').slice(-1)[0],Math.round(r.startTime),Math.round(r.duration)]).slice(0,12)}}""")
    t = m['t']; home = t.get('home', 0)
    # 可交互：首页出现后，第一个连续 1 秒没有 >50ms 帧间隔的窗口起点
    tti = home
    m['blockAfterHome'] = sum(g for s, g in m['lag'] if s >= home - 1)
    m['blockTotal'] = sum(g for s, g in m['lag'])
    tti = home
    for s, g in sorted(m['lag']):
        if s + g > tti and s < tti + 1000: tti = s + g
    m['tti'] = tti
    return m
STATE = {'cookies': [], 'origins': [{'origin': URL.rstrip('/'), 'localStorage': [{'name': 'momhelper_data_v1', 'value': ''}]}]}
def mkstate(pw):
    b = pw.chromium.launch(); p = b.new_page(); p.goto(URL); p.wait_for_timeout(800); p.evaluate('t=>Storage.importJSON(t)', SEED)
    STATE['origins'][0]['localStorage'] = [x for x in p.context.storage_state()['origins'][0]['localStorage']]
    b.close()
def run(pw, eng):
    out = {'cold': [], 'warm': []}
    b = getattr(pw, eng).launch()
    for i in range(RUNS):
        for mode in ('cold', 'warm'):
            tserver.set_profile(0, 0)
            ctx = b.new_context(storage_state=STATE, viewport={'width': 390, 'height': 844}, device_scale_factor=3, user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', is_mobile=(eng == 'chromium'), has_touch=True)
            if mode == 'warm':
                p0 = ctx.new_page(); p0.goto(URL); p0.wait_for_timeout(800)
                p0.reload(); p0.wait_for_function("()=>navigator.serviceWorker&&navigator.serviceWorker.controller", timeout=30000)
                p0.wait_for_timeout(2500); p0.close()
            ctx.add_init_script(INIT)
            p = ctx.new_page()
            if eng == 'chromium':
                cdp = ctx.new_cdp_session(p)
                cdp.send('Emulation.setCPUThrottlingRate', {'rate': 4})
                if mode == 'cold': cdp.send('Network.enable'); cdp.send('Network.clearBrowserCache'); cdp.send('Network.setCacheDisabled', {'cacheDisabled': True})
            if NET == 'slow4g': tserver.set_profile(562, 1440)
            t0 = time.time()
            p.goto(URL, wait_until='commit', timeout=90000)
            try:
                m = collect(p)
            except Exception as e:
                m = {'err': str(e)[:200]}
            tserver.set_profile(0, 0)
            m['wall'] = round(time.time() - t0, 2)
            out[mode].append(m)
            print(eng, mode, i, json.dumps({k: m.get(k) for k in ('t', 'tti', 'sw', 'res', 'blockAfterHome', 'err')}, ensure_ascii=False)[:600], flush=True)
            ctx.close()
    b.close()
    return out
res = {}
with sync_playwright() as pw:
    mkstate(pw)
    for e in ENG: res[e] = run(pw, e)
os.makedirs('/tmp/startup', exist_ok=True)
json.dump(res, open(f'/tmp/startup/{label}.json', 'w'), ensure_ascii=False, indent=1)
def med(xs): xs = [x for x in xs if x is not None]; return round(statistics.median(xs)) if xs else None
for e, o in res.items():
    for mode, L in o.items():
        ok = [m for m in L if 't' in m]
        row = {k: med([m['t'].get(k) for m in ok]) for k in ('fcp', 'cssOk', 'dcl', 'home', 'load', 'bootGone')}
        row['tti'] = med([m['tti'] for m in ok]); row['长任务ms(首页后)'] = med([m['blockAfterHome'] for m in ok]); row['maxLag'] = med([max([g for s, g in m['lag']] or [0]) for m in ok]); row['主线程阻塞总ms'] = med([m['blockTotal'] for m in ok])
        print(label, e, mode, row)
