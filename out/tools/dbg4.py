import sys,json; sys.path.insert(0,'.')
from h328 import *
with sync_playwright() as pw:
    b,p,errs=open_page(pw,PROTO,'chromium',dpr=1)
    w=p.workers[0]
    w.evaluate("self.__rf=0;const _r=requestAnimationFrame;self.__rq=0;")
    T={t[2]:t for t in p.evaluate("[...document.querySelectorAll('#tabbar .tab.dk-tab')].map(t=>{const r=t.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2,t.dataset.tab]})")}
    x,y,_=T['calendar']
    # simulate start via evaluate instead of mouse to isolate
    p.mouse.move(x,y); p.mouse.down()
    for i in range(6):
        print(i, w.evaluate("JSON.stringify({L:L&&L.phase,raf,frames:frames.length,lastHB:Math.round(lastHB),now:Math.round(nowM()),drawsM,drawsL})")); p.wait_for_timeout(40)
    p.mouse.up()
    for i in range(4):
        print('u',i, w.evaluate("JSON.stringify({L:L&&L.phase,raf,frames:frames.length,drawsM,drawsL})")); p.wait_for_timeout(100)
    print(w.evaluate("Promise.race([new Promise(r=>requestAnimationFrame(t=>r('raf '+t))), new Promise(r=>setTimeout(()=>r('timeout'),1500))])"))
    b.close()
