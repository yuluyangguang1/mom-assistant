import sys,json; sys.path.insert(0,'.')
from h328 import *
with sync_playwright() as pw:
    b,p,errs=open_page(pw,MAIN,'chromium')
    print(p.evaluate("new Promise(r=>{const ts=[];const f=t=>{ts.push(performance.now());if(ts.length<30)requestAnimationFrame(f);else r(ts.slice(1).map((t,i)=>Math.round(t-ts[i])))};requestAnimationFrame(f)})"))
    b.close()
