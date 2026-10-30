"""第 328 次：bench.py / drag2.py 共用（主线程每帧耗时探针 PROBE、Worker 帧记录 wperf、页签坐标 tabs）"""
PROBE = r"""(()=>{const P=performance;const F=window.__ft={on:false,cur:0,depth:0,frames:[],last:0};
const W=fn=>function(...a){if(!F.on||F.depth>0){F.depth++;try{return fn.apply(this,a)}finally{F.depth--}}const t=P.now();F.depth++;try{return fn.apply(this,a)}finally{F.depth--;F.cur+=P.now()-t}};
const raf=window.requestAnimationFrame.bind(window);window.requestAnimationFrame=cb=>{const w=W(cb);if(cb&&cb.name==='lensFrame'){return raf(function(t){const r=w(t);try{const G=window.__lg;const s=G&&G.samp&&window.LiquidDock&&LiquidDock._state().lens;if(s)G.samples.push({t:Math.round(P.now()*10)/10,x:s.x,s:s.s,ph:s.phase,tx:s.tx})}catch(e){}return r})}return raf(w)};
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

