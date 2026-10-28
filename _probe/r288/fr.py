import sys; sys.path.insert(0,'/workspace/work/mom-assistant/tests')
import regression as R
from playwright.sync_api import sync_playwright
with sync_playwright() as pw:
    b = pw.webkit.launch()
    ctx = b.new_context(viewport={'width':390,'height':844}, has_touch=True)
    p = ctx.new_page(); errs=[]
    p.on('pageerror', lambda e: errs.append(str(e)[:200])); p.on('console', lambda m: errs.append(m.text[:200]))
    p.goto(R.URL); p.wait_for_timeout(600); p.evaluate('t=>Storage.importJSON(t)', R.SEED_V3); p.reload(); p.wait_for_timeout(1000)
    p.evaluate(R.HLOG_JS)
    p.evaluate(R.FRAMES_JS.replace("if(on)requestAnimationFrame(f)};","if(on)requestAnimationFrame(f)};window.__fcount=0;"))
    p.wait_for_timeout(300); print('pre', p.evaluate('__fr.length'))
    p.evaluate("Drawer.open()"); p.wait_for_timeout(800); print('after open', p.evaluate('__fr.length'), p.evaluate('__fr.slice(-2)'))
    print(errs)
    b.close()
