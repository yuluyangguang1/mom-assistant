import sys; sys.path.insert(0,'/workspace/work/mom-assistant/tests')
import regression as R
from playwright.sync_api import sync_playwright
with sync_playwright() as pw:
    b = pw.webkit.launch()
    ctx = b.new_context(viewport={'width':390,'height':844}, has_touch=True)
    p = ctx.new_page(); errs=[]
    p.on('pageerror', lambda e: errs.append(str(e)[:300])); p.on('console', lambda m: errs.append('C:'+m.text[:300]))
    p.goto(R.URL); p.wait_for_timeout(600); p.evaluate('t=>Storage.importJSON(t)', R.SEED_V3); p.reload(); p.wait_for_timeout(1000)
    ev=p.evaluate
    ev(R.HLOG_JS)
    ev("Drawer.open()"); p.wait_for_timeout(550)
    ev("document.querySelector('#sideDrawer [data-sd=swap]').click()"); p.wait_for_timeout(450)
    ev("""(()=>{const o=App.showTab;window.__calls=[];const st=App.showTab;})()""")
    ev("window.__vt=typeof document.startViewTransition")
    ev("document.querySelector('#sheetManage').click()")
    for t in (50,200,600,1500):
        p.wait_for_timeout(t)
        print(t, ev("[App.currentTab(),Drawer.state(),JSON.stringify(history.state),__vt]"))
    print(ev("__hlog.slice(-8)"))
    print(errs)
    b.close()
