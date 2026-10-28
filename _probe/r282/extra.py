import sys
sys.path.insert(0, '/workspace/work/mom-assistant/tests')
import regression as R
from playwright.sync_api import sync_playwright
O='/workspace/work/fix282/extra/'
import os; os.makedirs(O, exist_ok=True)
with sync_playwright() as pw:
    br = pw.webkit.launch()
    for dark in (False, True):
        ctx = br.new_context(viewport={'width': 393, 'height': 852}, has_touch=True, device_scale_factor=2)
        p = ctx.new_page(); p.goto(R.URL); p.wait_for_timeout(700); p.evaluate('t=>Storage.importJSON(t)', R.SEED_V3); p.evaluate(R.R282_FILL)
        p.evaluate("dk=>{Storage.get().settings.theme=dk?'dark':'light';Storage.save()}", dark); p.reload(); p.wait_for_timeout(1200)
        tag = 'dark' if dark else 'light'
        p.click('.hn-q[data-recsl="start"]'); p.wait_for_timeout(1300)
        p.evaluate("App.showTab('diaper',{noVT:true})"); p.wait_for_timeout(700)
        for i, y in enumerate((0, 99999)):
            p.evaluate(f"scrollTo(0,{y})"); p.wait_for_timeout(300); p.screenshot(path=f'{O}live_{tag}_{i}.png')
        p.evaluate("(()=>{const d=Storage.get();d.openSleep=null;d.settings.handMode='left';Storage.save()})()"); p.reload(); p.wait_for_timeout(1200)
        p.evaluate("App.showTab('sleep',{noVT:true})"); p.wait_for_timeout(700)
        for i, y in enumerate((0, 99999)):
            p.evaluate(f"scrollTo(0,{y})"); p.wait_for_timeout(300); p.screenshot(path=f'{O}left_{tag}_{i}.png')
        p.evaluate("(()=>{const d=Storage.get();d.settings.handMode='normal';Storage.save()})()"); p.reload(); p.wait_for_timeout(1000)
        p.set_viewport_size({'width': 320, 'height': 640}); p.evaluate("document.body.classList.add('fs-xl')")
        p.evaluate("App.showTab('feeding',{noVT:true})"); p.wait_for_timeout(700)
        for i, y in enumerate((0, 99999)):
            p.evaluate(f"scrollTo(0,{y})"); p.wait_for_timeout(300); p.screenshot(path=f'{O}320xl_{tag}_{i}.png')
        ctx.close()
    br.close()
