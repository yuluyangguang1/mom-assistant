import sys; sys.path.insert(0,'.')
from h328 import *
eng=sys.argv[1] if len(sys.argv)>1 else 'chromium'
with sync_playwright() as pw:
  for root,tag in ((PROTO,'proto'),(MAIN,'main')):
    b,p,errs=open_page(pw,root,eng)
    st=p.evaluate("DockRefract._stats()")
    print(tag,{k:st.get(k) for k in ('on','ready','worker','wfail','draws','canvas','err','rasters')})
    if tag=='proto': print(p.evaluate("JSON.stringify(DockRefract._wstate())"))
    r=p.evaluate("(()=>{const r=document.getElementById('tabbar').getBoundingClientRect();return [r.left,r.top,r.width,r.height]})()")
    p.screenshot(path=f'/workspace/work/worker328/out/tmp_{tag}_{eng}.png',clip={'x':0,'y':r[1]-40,'width':393,'height':r[3]+60})
    print(errs[:5]); b.close()
