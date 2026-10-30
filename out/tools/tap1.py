import sys,json; sys.path.insert(0,'.')
from h328 import *
busy=int(sys.argv[1]) if len(sys.argv)>1 else 0
INIT="""document.addEventListener('click',e=>{if(window.__busyMs&&e.target.closest&&e.target.closest('#tabbar .dk-tab')){const t=performance.now();while(performance.now()-t<__busyMs);}},true);"""
with sync_playwright() as pw:
  for root,tag in ((PROTO,'proto'),(MAIN,'main')):
    b,p,errs=open_page(pw,root,'chromium',init=INIT,dpr=float(sys.argv[2]) if len(sys.argv)>2 else 1)
    T={t[2]:t for t in p.evaluate("[...document.querySelectorAll('#tabbar .tab.dk-tab')].map(t=>{const r=t.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2,t.dataset.tab]})")}
    p.evaluate(f"window.__busyMs={busy}")
    p.evaluate("LiquidDock._perf(true); window.DockRefract&&DockRefract._wperf&&DockRefract._wperf(true)")
    x,y,_=T['calendar']; p.mouse.move(x,y); p.mouse.down(); p.wait_for_timeout(80); p.mouse.up(); p.wait_for_timeout(1200)
    print(tag, 'cur', p.evaluate("App.currentTab()"), p.evaluate("DockRefract._stats().worker"))
    if tag=='proto':
        p.evaluate("DockRefract._wperf()"); p.wait_for_timeout(100); w=p.evaluate("DockRefract._wperf()")
        fr=w['frames']; print(' worker frames',len(fr),'errs',w['errs'][:3])
        print(' ', [(f['t']-fr[0]['t'],f['raw'],f['k'],f.get('x'),f.get('s')) for f in fr][:40])
        print(' wl',p.evaluate("LiquidDock._wl()"))
    fm=p.evaluate("LiquidDock._perf().frames"); print(' main frames',len(fm),[(f['t']-fm[0]['t'],f['raw'],f['k']) for f in fm][:40] if fm else '')
    print(errs[:5]); b.close()
