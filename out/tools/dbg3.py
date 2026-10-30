import sys,json; sys.path.insert(0,'.')
from h328 import *
with sync_playwright() as pw:
    b,p,errs=open_page(pw,PROTO,'chromium',dpr=1)
    w=p.workers[0]
    print(w.evaluate("Promise.race([new Promise(r=>requestAnimationFrame(t=>r('raf '+t))), new Promise(r=>setTimeout(()=>r('timeout'),1500))])"))
    print(w.evaluate("Promise.race([new Promise(r=>{drawLens(null);requestAnimationFrame(t=>r('raf2 '+t))}), new Promise(r=>setTimeout(()=>r('timeout2'),1500))])"))
    print(w.evaluate("Promise.race([new Promise(r=>{let n=0;const f=()=>{drawLens(null);if(++n<5)requestAnimationFrame(f);else r('raf3 ok')};requestAnimationFrame(f)}), new Promise(r=>setTimeout(()=>r('timeout3'),2500))])"))
    b.close()
