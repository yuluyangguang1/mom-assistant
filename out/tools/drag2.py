"""第 328 次：拖动跟手（页内合成指针流，替代 bench.py 里用 CDP 逐个 mouse.move 的拖动——那个在高负载下每个 move 往返 ~50ms，
实际速度只有 ~100pt/s、分析窗口落在按住阶段，跟手数据无效）。
模型：手指按住「宝宝」250ms → 以 v=0.25pt/ms 匀速向右到「日历」中心；手指真实位置 f(t)=x0+v·(t−tStart)。
页内 setTimeout(…,8) 循环按当时的 f(t) 派发 pointermove（主线程忙时和真机一样排队，忙完后第一条带的是当时的位置）。
跟手滞后 = (f(t) − 透镜中心 x(t)) / v，t 取每个画出来的透镜帧（main：lensFrame 跑完；原型：Worker 画完）。
可选：开始移动后 150ms 主线程同步忙 200ms。python3 drag2.py <engine> <main|proto> <out.json> [reps]"""
import sys, json, os
sys.path.insert(0, '.')
from h328 import *
from p328 import PROBE, wperf, tabs
engine, which, outp = sys.argv[1], sys.argv[2], sys.argv[3]
reps = int(sys.argv[4]) if len(sys.argv) > 4 else 3
root = MAIN if which == 'main' else PROTO
DRAG = r"""window.__drag=(x0,x1,y,v,busyAt,busy)=>new Promise(res=>{
const P=performance,el=document.elementFromPoint(x0,y);const o={moves:[],t0:0,tS:0,bz:null};
const mk=(ty,x)=>new PointerEvent(ty,{clientX:x,clientY:y,pointerId:7,pointerType:'touch',isPrimary:true,bubbles:true,cancelable:true,buttons:ty==='pointerup'?0:1});
o.t0=P.now();el.dispatchEvent(mk('pointerdown',x0));
setTimeout(()=>{o.tS=P.now();const T=(x1-x0)/v;
 if(busy)setTimeout(()=>{const a=P.now();while(P.now()-a<busy);o.bz=[a,P.now()]},busyAt);
 const tick=()=>{const n=P.now(),tt=n-o.tS,x=x0+v*Math.min(tt,T);el.dispatchEvent(mk('pointermove',x));o.moves.push([n,x]);
  if(tt<T+120)setTimeout(tick,8);else{el.dispatchEvent(mk('pointerup',x));o.T=T;res(o)}};tick()},250)})"""
out = {'engine': engine, 'root': which, 'load0': os.getloadavg(), 'drags': []}
with sync_playwright() as pw:
    b, p, errs = open_page(pw, root, engine, dpr=0.5 if engine == 'chromium' else 1, init=PROBE + ';' + DRAG)
    wm = p.evaluate("DockRefract._stats().worker") == 'on'; out['worker'] = p.evaluate("DockRefract._stats().worker")
    for r in range(reps):
        for busy in (0, 200):
            p.evaluate("document.querySelector('#tabbar .dk-tab[data-tab=home]').click()"); p.wait_for_timeout(1500)
            T = tabs(p); x0, y = T['baby'][0], T['baby'][1]; x1 = T['calendar'][0]
            if wm: wperf(p, True)
            p.evaluate("LiquidDock._perf(true); __lg.samples=[]; __lg.samp=true")
            o = p.evaluate(f"__drag({x0},{x1},{y},0.25,150,{busy})")
            p.wait_for_timeout(1200)
            rec = {'busy': busy, 'x0': x0, 'x1': x1, 'v': 0.25, 'o': o, 'samples': p.evaluate("__lg.samples.splice(0)"), 'lensFrames': p.evaluate("LiquidDock._perf().frames")}
            p.evaluate("__lg.samp=false")
            if wm: w = wperf(p, True); rec['wframes'] = w['frames'] if w else None
            out['drags'].append(rec)
    out['errs'] = errs[:10]
    b.close()
out['load1'] = os.getloadavg()
json.dump(out, open(outp, 'w'))
print('ok drag2', which, engine, out['worker'], len(out['drags']), errs[:2])
