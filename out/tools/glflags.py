import sys,json; sys.path.insert(0,'.')
from h328 import *
args=[a for a in sys.argv[1:] if a]
with sync_playwright() as pw:
    orig=pw.chromium.launch
    pw.chromium.launch=lambda **k: orig(args=args,**k)
    b,p,errs=open_page(pw,MAIN,'chromium',dpr=1)
    print(p.evaluate("(()=>{const c=document.createElement('canvas').getContext('webgl');const e=c.getExtension('WEBGL_debug_renderer_info');return e?c.getParameter(e.UNMASKED_RENDERER_WEBGL):'?'})()"))
    T={t[2]:t for t in p.evaluate("[...document.querySelectorAll('#tabbar .tab.dk-tab')].map(t=>{const r=t.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2,t.dataset.tab]})")}
    p.evaluate("LiquidDock._perf(true)")
    x,y,_=T['calendar']; p.mouse.move(x,y); p.mouse.down(); p.wait_for_timeout(80); p.mouse.up(); p.wait_for_timeout(1200)
    fm=p.evaluate("LiquidDock._perf().frames"); print(len(fm),[(f['raw'],f['work']) for f in fm])
    print(errs[:3]); b.close()
