"""第 328 次：main（890721d）与原型（proto-worker-lens）同机对比。
python3 bench.py <engine> <root:main|proto> <out.json> [dpr]
每种主线程忙碌（0 / 80 / 200ms，切页 click 时同步跑）各点 6 次页签；另测：按下前主线程忙（触摸事件延迟）、60Hz 参考节奏（手动时钟）。
帧数据：main = LiquidDock._perf()（每次 lensFrame）+ 探针 rAF 采样透镜位置；原型 = Worker 自己的帧记录（DockRefract._wperf）。
主线程每帧耗时用 r319 的测法（包住 rAF / 定时器 / 事件 / 观察器回调，按 rAF 帧分桶）。"""
import sys, json, time
sys.path.insert(0, '.')
from h328 import *
engine, which, outp = sys.argv[1], sys.argv[2], sys.argv[3]
dpr = float(sys.argv[4]) if len(sys.argv) > 4 else 1
root = MAIN if which == 'main' else PROTO
from p328 import PROBE, wperf, tabs

import os
out = {'load0': os.getloadavg(), 'engine': engine, 'root': which, 'dpr': dpr, 'taps': [], 'drags': [], 'predown': [], 'ref': None}
with sync_playwright() as pw:
    b, p, errs = open_page(pw, root, engine, dpr=dpr, init=PROBE)
    st = p.evaluate("DockRefract._stats()")
    out['worker'] = st.get('worker'); out['wfail'] = st.get('wfail')
    out['renderer'] = p.evaluate("(()=>{try{const c=document.createElement('canvas').getContext('webgl');const e=c.getExtension('WEBGL_debug_renderer_info');return e?c.getParameter(e.UNMASKED_RENDERER_WEBGL):c.getParameter(c.RENDERER)}catch(e){return String(e)}})()")
    wmode = out['worker'] == 'on'
    T = tabs(p)
    seq = ['calendar', 'home', 'baby', 'home', 'calendar', 'baby', 'home']
    cur = p.evaluate("App.currentTab()")
    # ---------- 60Hz 参考节奏（手动时钟：每帧 16.67ms，按下 5 帧 ≈ 83ms 松手） ----------
    p.wait_for_timeout(1500)
    T = tabs(p)
    a0 = p.evaluate("App.currentTab()"); tgt = 'calendar' if a0 != 'calendar' else 'home'
    p.evaluate("LiquidDock._manualMode(true)")
    x, y, _ = T[tgt]; p.mouse.move(x, y); p.mouse.down()
    ref = [p.evaluate("LiquidDock._state().lens")]
    for i in range(5): ref.append(p.evaluate("LiquidDock._step(1000/60)"))
    p.mouse.up()
    for i in range(40):
        s = p.evaluate("LiquidDock._step(1000/60)"); ref.append(s)
        if not s: break
    p.evaluate("LiquidDock._manualMode(false)")
    out['ref'] = {'from': a0, 'to': tgt, 'frames': [{'x': r['x'], 's': r['s'], 'ph': r['phase'], 'tx': r['tx']} if r else None for r in ref]}
    p.wait_for_timeout(2500)
    # ---------- 点页签：主线程忙 0 / 80 / 200ms ----------
    for busy in (0, 80, 200):
        p.evaluate(f"window.__busyMs={busy}")
        for k, name in enumerate(seq[:6]):
            T = tabs(p)
            cur = p.evaluate("App.currentTab()")
            if name == cur: name = 'home' if cur != 'home' else 'calendar'
            p.wait_for_timeout(1800)
            if wmode: wperf(p, True)
            p.evaluate("LiquidDock._perf(true); LiquidDock._wl&&LiquidDock._wl(true); __lg.samples=[];__lg.downs=[];__lg.clicks=[];__lg.samp=true;__ft.start()")
            p.wait_for_timeout(60)
            x, y, _ = T[name]
            x0 = p.evaluate("(()=>{const a=document.querySelector('#tabbar .tab.dk-tab.active');const r=a.getBoundingClientRect();return r.left+r.width/2})()")
            p.mouse.move(x, y); p.mouse.down(); p.wait_for_timeout(80); p.mouse.up(); p.wait_for_timeout(1300)
            rec = {'busy': busy, 'from': cur, 'to': name, 'x0': x0, 'xT': x,
                   'frames': p.evaluate("__ft.stop()"), 'samples': p.evaluate("__lg.samples.splice(0)"), 'downs': p.evaluate("__lg.downs.splice(0)"), 'clicks': p.evaluate("__lg.clicks.splice(0)"),
                   'lensFrames': p.evaluate("LiquidDock._perf().frames"), 'cur': p.evaluate("App.currentTab()")}
            p.evaluate("__lg.samp=false")
            if wmode:
                w = wperf(p, True); rec['wframes'] = w['frames'] if w else None; rec['wl'] = p.evaluate("LiquidDock._wl(true)")
            out['taps'].append(rec)
    p.evaluate("window.__busyMs=0")
    # 拖动跟手改由 drag2.py 测（页内合成指针流；原来逐个 CDP mouse.move 在高负载下每个往返 ~50ms，速度不对、数据无效）
    # ---------- 按下前主线程已在忙：先排一个 200ms 长任务，50ms 后按下 ----------
    for i in range(3):
        p.wait_for_timeout(1500)
        T = tabs(p); cur = p.evaluate("App.currentTab()"); name = 'calendar' if cur != 'calendar' else 'home'
        x, y, _ = T[name]
        if wmode: wperf(p, True)
        p.evaluate("LiquidDock._perf(true); __lg.downs=[]; __lg.samples=[]; __lg.samp=true; window.__blkAt=performance.now(); setTimeout(()=>{window.__blk0=performance.now();const t=performance.now();while(performance.now()-t<200);window.__blk1=performance.now();},0)")
        time.sleep(0.05)
        p.mouse.move(x, y); p.mouse.down(); time.sleep(0.08); p.mouse.up(); p.wait_for_timeout(1300)
        rec = {'downs': p.evaluate("__lg.downs.splice(0)"), 'blk': p.evaluate("[window.__blk0,window.__blk1,window.__blkAt]"), 'samples': p.evaluate("__lg.samples.splice(0)"), 'lensFrames': p.evaluate("LiquidDock._perf().frames")}
        p.evaluate("__lg.samp=false")
        if wmode: w = wperf(p, True); rec['wframes'] = w['frames'] if w else None
        out['predown'].append(rec)
    out['errs'] = errs[:20]
    out['stats'] = p.evaluate("DockRefract._stats()")
    b.close()
out['load1'] = os.getloadavg()
json.dump(out, open(outp, 'w'))
print('ok', which, engine, out['worker'], out['renderer'], len(out['taps']), errs[:3])
