import sys; sys.path.insert(0,'/workspace/work/mom-assistant/tests')
import regression as R
from playwright.sync_api import sync_playwright
eng = sys.argv[1] if len(sys.argv)>1 else 'chromium'
with sync_playwright() as pw:
    b = getattr(pw, eng).launch()
    ctx = b.new_context(viewport={'width':390,'height':844}, has_touch=True)
    p = ctx.new_page(); errs=[]
    p.on('pageerror', lambda e: errs.append(str(e)[:200]))
    p.goto(R.URL); p.wait_for_timeout(600); p.evaluate('t=>Storage.importJSON(t)', R.SEED_V3); p.reload(); p.wait_for_timeout(1000)
    ev=p.evaluate; st=lambda: ev(R.SD_ST)
    ev("Drawer.open()"); p.wait_for_timeout(60); print('opening', st())
    p.wait_for_timeout(500); print('open', st())
    ev("Drawer.close()"); p.wait_for_timeout(100); print('closing', st())
    p.wait_for_timeout(600); print('closed', st())
    ev(R.TOUCH2_JS,[6,420,206,424,True,8,16]); p.wait_for_timeout(700); print('drag-open', st())
    ev(R.TOUCH2_JS,[300,400,40,404,True,6,16]); p.wait_for_timeout(700); print('drag-close', st())
    ev("Drawer.open()"); p.wait_for_timeout(500); ev("document.querySelector('#sideDrawer [data-sd-go=growth]').click()"); p.wait_for_timeout(700); print('nav', st())
    ev("history.back()"); p.wait_for_timeout(700); print('back', st())
    print('errs', errs)
    b.close()
