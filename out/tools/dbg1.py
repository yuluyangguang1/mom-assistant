import sys,json; sys.path.insert(0,'.')
from h328 import *
with sync_playwright() as pw:
    b,p,errs=open_page(pw,PROTO,'chromium',dpr=1)
    T={t[2]:t for t in p.evaluate("[...document.querySelectorAll('#tabbar .tab.dk-tab')].map(t=>{const r=t.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2,t.dataset.tab]})")}
    print(p.evaluate("JSON.stringify(DockRefract._wstate())"))
    x,y,_=T['calendar']; p.mouse.move(x,y); p.mouse.down(); p.wait_for_timeout(30)
    print(p.evaluate("JSON.stringify(LiquidDock._state())"))
    print(p.evaluate("DockRefract.wlOn()"))
    p.wait_for_timeout(50); p.mouse.up(); p.wait_for_timeout(800)
    p.evaluate("DockRefract._wperf()"); p.wait_for_timeout(300); 
    print(json.dumps(p.evaluate("DockRefract._wperf()"))[:1500])
    print(p.evaluate("JSON.stringify(LiquidDock._wl())"), p.evaluate("JSON.stringify(DockRefract._wstate())"))
    print(errs[:5]); b.close()
