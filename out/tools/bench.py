"""第 328 次：main（890721d）与原型（proto-worker-lens）同机对比。
python3 bench.py <engine> <root:main|proto> <out.json> [dpr]
每种主线程忙碌（0 / 80 / 200ms，切页 click 时同步跑）各点 6 次页签；另测：拖动跟手、按下前主线程忙（触摸事件延迟）、60Hz 参考节奏（手动时钟）。
帧数据：main = LiquidDock._perf()（每次 lensFrame）+ 探针 rAF 采样透镜位置；原型 = Worker 自己的帧记录（DockRefract._wperf）。
主线程每帧耗时用 r319 的测法（包住 rAF / 定时器 / 事件 / 观察器回调，按 rAF 帧分桶）。"""
import sys, json, time
sys.path.insert(0, '.')
from h328 import *
engine, which, outp = sys.argv[1], sys.argv[2], sys.argv[3]
dpr = float(sys.argv[4]) if len(sys.argv) > 4 else 1
root = MAIN if which == 'main' else PROTO
PROBE = r"""(()=>{const P=performance;const F=window.__ft={on:false,cur:0,depth:0,frames:[],last:0};
const W=fn=>function(...a){if(!F.on||F.depth>0){F.depth++;try{return fn.apply(this,a)}finally{F.depth--}}const t=P.now();F.depth++;try{return fn.apply(this,a)}finally{F.depth--;F.cur+=P.now()-t}};
const raf=window.requestAnimationFrame.bind(window);window.requestAnimationFrame=cb=>{const w=W(cb);if(cb&&cb.name==='lensFrame'){return raf(function(t){const r=w(t);try{const G=window.__lg;const s=G&&G.samp&&window.LiquidDock&&LiquidDock._state().lens;if(s)G.samples.push({t:Math.round(P.now()*10)/10,x:s.x,s:s.s,ph:s.phase})}catch(e){}return r})}return raf(w)};
const st=window.setTimeout.bind(window);window.setTimeout=(cb,ms,...a)=>typeof cb==='function'?st(W(cb),ms,...a):st(cb,ms,...a);
if(window.requestIdleCallback){const ric=window.requestIdleCallback.bind(window);window.requestIdleCallback=(cb,o)=>ric(W(cb),o)}
const map=new WeakMap();const ael=EventTarget.prototype.addEventListener,rel=EventTarget.prototype.removeEventListener;
EventTarget.prototype.addEventListener=function(t,fn,o){if(typeof fn!=='function')return ael.call(this,t,fn,o);let w=map.get(fn);if(!w){w=W(fn);map.set(fn,w)}return ael.call(this,t,w,o)};
EventTarget.prototype.removeEventListener=function(t,fn,o){return rel.call(this,t,(typeof fn==='function'&&map.get(fn))||fn,o)};
for(const K of ['MutationObserver','ResizeObserver']){const O=window[K];if(!O)continue;window[K]=class extends O{constructor(cb){super(W(cb))}}}
F.start=()=>{F.frames=[];F.cur=0;F.on=true;F.last=P.now();const tick=t=>{if(!F.on)return;const n=P.now();F.frames.push({t:Math.round(n*10)/10,dt:Math.round((n-F.last)*10)/10,busy:Math.round(F.cur*100)/100});F.cur=0;F.last=n;raf(tick)};raf(tick)};
F.stop=()=>{F.on=false;return F.frames};
const G=window.__lg={downs:[],moves:[],samples:[],clicks:[],samp:false};
ael.call(window,'pointerdown',e=>{G.downs.push({h:P.now(),ts:e.timeStamp,tr:e.isTrusted})},true);
ael.call(window,'pointermove',e=>{if(G.samp)G.moves.push({h:P.now(),ts:e.timeStamp,x:e.clientX})},true);
ael.call(document,'click',e=>{if(e.target&&e.target.closest&&e.target.closest('#tabbar .dk-tab')){const t=P.now();G.clicks.push({h:t,ms:window.__busyMs||0});if(window.__busyMs){while(P.now()-t<window.__busyMs);}}},true);
})()"""

def wperf(p, clear=False):
    s0 = p.evaluate("DockRefract._wseq||0")
    p.evaluate("DockRefract._wperf(%s)" % ('true' if clear else 'false'))
    for _ in range(60):
        if p.evaluate("(DockRefract._wseq||0)") > s0: break
        p.wait_for_timeout(50)
    return p.evaluate("DockRefract._wperf(false)")

def tabs(p):
    return {t[2]: t for t in p.evaluate("[...document.querySelectorAll('#tabbar .tab.dk-tab')].map(t=>{const r=t.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2,t.dataset.tab]})")}

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
    # ---------- 拖动跟手：按住「首页」0.3s 后匀速向右拖 300pt/s（每 16ms 一个 move），可选在拖动中途主线程忙 200ms ----------
    for busy in (0, 200):
        p.wait_for_timeout(1500)
        T = tabs(p)
        hx, hy, _ = T['home']; bx, by, _ = T['baby']
        if wmode: wperf(p, True)
        p.evaluate("LiquidDock._perf(true); __lg.samples=[];__lg.moves=[];__lg.downs=[];__lg.samp=true")
        p.mouse.move(bx, by); p.mouse.down(); p.wait_for_timeout(250)
        if busy: p.evaluate(f"setTimeout(()=>{{const t=performance.now();while(performance.now()-t<{busy});}},350)")
        t0 = time.time(); xs = []
        for i in range(60):
            xx = bx + 300 * (i * 0.016)
            p.mouse.move(xx, by); xs.append((time.time() - t0, xx))
            dt = (i + 1) * 0.016 - (time.time() - t0)
            if dt > 0: time.sleep(dt)
        p.wait_for_timeout(150); p.mouse.up(); p.wait_for_timeout(1200)
        rec = {'busy': busy, 'moves': p.evaluate("__lg.moves.splice(0)"), 'samples': p.evaluate("__lg.samples.splice(0)"), 'downs': p.evaluate("__lg.downs.splice(0)"), 'lensFrames': p.evaluate("LiquidDock._perf().frames")}
        p.evaluate("__lg.samp=false")
        if wmode: w = wperf(p, True); rec['wframes'] = w['frames'] if w else None
        out['drags'].append(rec)
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
