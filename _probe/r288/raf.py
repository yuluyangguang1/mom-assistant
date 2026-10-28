import sys; sys.path.insert(0,'/workspace/work/mom-assistant/tests')
import regression as R
from playwright.sync_api import sync_playwright
with sync_playwright() as pw:
    b = pw.webkit.launch()
    ctx = b.new_context(viewport={'width':390,'height':844}, has_touch=True)
    p = ctx.new_page()
    p.goto(R.URL); p.wait_for_timeout(1500)
    p.evaluate("()=>{window.__n=0;const f=()=>{__n++;requestAnimationFrame(f)};requestAnimationFrame(f)}")
    p.wait_for_timeout(1000); print('raf/s idle', p.evaluate('__n'))
    p.evaluate("()=>{window.__n=0}"); 
    for i in range(10): p.evaluate("1"); p.wait_for_timeout(100)
    print('raf/s with evals', p.evaluate('__n'))
    p.evaluate("()=>{window.__n=0;Drawer.open()}"); p.wait_for_timeout(1000); print('during drawer', p.evaluate('__n'), p.evaluate('Drawer.state()'))
    b.close()
