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
    p.evaluate("document.querySelector('[data-gnew]').click()"); p.wait_for_timeout(800)
    p.evaluate("document.querySelector('[data-gm=height]').click()"); p.wait_for_timeout(300)
    print(p.evaluate("""(()=>{const r=e=>{const q=document.querySelector(e);if(!q)return null;const b=q.getBoundingClientRect();const c=getComputedStyle(q);return [e,q.className,Math.round(b.top),Math.round(b.height),c.display,c.height,c.maxHeight,c.fontSize,c.borderTopWidth,c.backgroundColor]};return ['.modal','.rs-body','.rs-savebar','#grSave','#grCtl'].map(r)})()"""))
    print(p.evaluate("(()=>{const s=document.querySelector('.rs-savebar');const c=getComputedStyle(s);const b=getComputedStyle(document.querySelector('.rs-body'));return [c.marginTop,c.marginBottom,c.position,b.paddingBottom,b.justifyContent,[...document.querySelector('.rs-body').children].map(e=>e.className+':'+Math.round(e.getBoundingClientRect().top)+'/'+Math.round(e.getBoundingClientRect().height))]})()"))
    print(errs)
    br.close()
