import sys,json; sys.path.insert(0,'.')
from h328 import *
with sync_playwright() as pw:
    b,p,errs=open_page(pw,PROTO,'chromium',dpr=1)
    p.on('worker', lambda w: print('worker', w.url))
    T={t[2]:t for t in p.evaluate("[...document.querySelectorAll('#tabbar .tab.dk-tab')].map(t=>{const r=t.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2,t.dataset.tab]})")}
    for w in p.workers: print('W',w.url)
    w=p.workers[0]
    print('wk eval', w.evaluate("JSON.stringify({L:!!L,raf,frames:frames.length,haveDock,mainProg})"))
    x,y,_=T['calendar']; p.mouse.move(x,y); p.mouse.down(); p.wait_for_timeout(30)
    try: print('wk eval', w.evaluate("JSON.stringify({L:L&&L.phase,raf,frames:frames.length,errs})",timeout=3000))
    except Exception as e: print('wk eval failed',str(e)[:200])
    p.wait_for_timeout(50); p.mouse.up(); p.wait_for_timeout(800)
    try: print('wk eval', w.evaluate("JSON.stringify({L:L&&L.phase,raf,frames:frames.length,errs})"))
    except Exception as e: print('wk eval failed',str(e)[:200])
    print(errs[:5]); b.close()
