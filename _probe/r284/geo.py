import sys
sys.path.insert(0, '/workspace/work/mom-assistant/tests')
import regression as R
from playwright.sync_api import sync_playwright
with sync_playwright() as pw:
    br = pw.webkit.launch()
    ctx = br.new_context(viewport={'width': 393, 'height': 852}, has_touch=True, device_scale_factor=2)
    p = ctx.new_page(); errs=[]; p.on('pageerror', lambda e: errs.append(str(e)[:300]))
    p.goto(R.URL); p.wait_for_timeout(700); p.evaluate('t=>Storage.importJSON(t)', R.SEED_V3); p.reload(); p.wait_for_timeout(1200)
    p.evaluate("App.showTab('growth',{noVT:true})"); p.wait_for_timeout(900)
    print(p.evaluate("""(()=>{const r=e=>{const q=document.querySelector(e);if(!q)return null;const b=q.getBoundingClientRect();return [e,Math.round(b.left),Math.round(b.top),Math.round(b.width),Math.round(b.height),getComputedStyle(q).position]};return ['#view','.mod-head','.gr-page','.app-header','.gr-gear','#backBtn','.mod-head .hero-art, .mod-head img'].map(r)})()"""))
    print(errs)
    br.close()
