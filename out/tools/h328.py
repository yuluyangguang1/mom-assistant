"""第 328 次：公用（两套根目录：main = /workspace/work/mom-assistant，proto = /workspace/work/worker328）"""
import sys,json
sys.path.insert(0,'/workspace/work/r319/tools')
from h import url, S
from playwright.sync_api import sync_playwright
MAIN='/workspace/work/mom-assistant'; PROTO='/workspace/work/worker328'
def open_page(pw, root, engine='chromium', dark=False, dpr=3, worker=True, init=None, vw=393, vh=852):
    b=getattr(pw,engine).launch()
    ctx=b.new_context(viewport={'width':vw,'height':vh},device_scale_factor=dpr,service_workers='block',color_scheme='dark' if dark else 'light')
    ctx.add_init_script("try{Object.defineProperty(navigator,'standalone',{value:true,configurable:true})}catch(e){}")
    if init: ctx.add_init_script(init)
    p=ctx.new_page(); errs=[]; p.on('pageerror',lambda e:errs.append(str(e)[:300])); p.on('console',lambda m: errs.append('console:'+m.text[:200]) if m.type=='error' else None)
    p.goto(url(root)); p.wait_for_timeout(600); p.evaluate('t=>Storage.importJSON(t)',S)
    p.evaluate("localStorage.setItem('lgGlForce','1');localStorage.setItem('lgWorker','%s');Storage.get().settings.dockGlass='on';Storage.get().settings.theme='%s';Storage.get().settings.themeMode='%s';Storage.save()"%('1' if worker else '0','dark' if dark else 'light','dark' if dark else 'light'))
    p.reload(); p.wait_for_timeout(2000)
    for _ in range(40):
        if p.evaluate("!document.getElementById('boot')&&window.DockRefract&&DockRefract._stats().ready&&DockRefract._stats().draws>0"): break
        p.wait_for_timeout(250)
    p.wait_for_timeout(1500)
    return b,p,errs
