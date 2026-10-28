import sys
sys.path.insert(0, '/workspace/work/mom-assistant/tests')
import regression as R
from playwright.sync_api import sync_playwright
with sync_playwright() as pw:
    br = pw.webkit.launch()
    ctx = br.new_context(viewport={'width': 393, 'height': 852}, has_touch=True, device_scale_factor=2)
    p = ctx.new_page(); errs=[]; p.on('pageerror', lambda e: errs.append(str(e)[:300]))
    p.goto(R.URL); p.wait_for_timeout(700); p.evaluate('t=>Storage.importJSON(t)', R.SEED_V3); p.reload(); p.wait_for_timeout(1200)
    ev=p.evaluate
    ev("App.showTab('growth',{noVT:true})"); p.wait_for_timeout(900)
    ev("Modules.growth._enter('trend')"); p.wait_for_timeout(800)
    q="(()=>{const m=document.querySelector('.gr-menu');if(!m)return 'none';const r=m.getBoundingClientRect();return [Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height),getComputedStyle(m).opacity,document.querySelectorAll('.gr-menu-mask').length]})()"
    ev("document.querySelector('[data-gf=range]').click()"); p.wait_for_timeout(400); print('range', ev(q))
    ev("document.querySelector('.gr-menu-mask').click()"); p.wait_for_timeout(200); print('closed', ev(q))
    ev("document.querySelector('[data-gf=std]').click()"); p.wait_for_timeout(400); print('std', ev(q))
    p.screenshot(path='/tmp/menu.png')
    print(errs)
    br.close()
