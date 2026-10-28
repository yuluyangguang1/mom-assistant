import sys
sys.path.insert(0, '/workspace/work/mom-assistant/tests')
import regression as R
from playwright.sync_api import sync_playwright
O='/workspace/work/fix283/'
import os; os.makedirs(O, exist_ok=True)
with sync_playwright() as pw:
    br = pw.webkit.launch()
    for dark in (False, True):
        tag='dark' if dark else 'light'
        ctx = br.new_context(viewport={'width': 393, 'height': 852}, has_touch=True, device_scale_factor=2)
        p = ctx.new_page(); errs=[]; p.on('pageerror', lambda e: errs.append(str(e)[:200]))
        p.goto(R.URL); p.wait_for_timeout(700); p.evaluate('t=>Storage.importJSON(t)', R.SEED_V3)
        p.evaluate("dk=>{const d=Storage.get();d.settings.theme=dk?'dark':'light';d.finance={records:[]};Storage.save()}", dark); p.reload(); p.wait_for_timeout(1200)
        p.evaluate("App.showTab('finance',{noVT:true})"); p.wait_for_timeout(700); p.screenshot(path=O+f'fin_{tag}_empty.png')
        p.evaluate("""(()=>{const d=Storage.get();const t=Util.todayISO();const C=['奶粉','纸尿裤','用品','产检','药品','衣物','玩具'];for(let i=0;i<16;i++)d.finance.records.push({id:'r'+i,amount:[128,89.9,35,260,18.5,59,99][i%7]+i,category:C[i%7],note:i%3?null:'两罐 3 段',date:Util.addDays(t,-i*3)});Storage.save()})()""")
        p.evaluate("App.showTab('home',{noVT:true})"); p.evaluate("App.showTab('finance',{noVT:true})"); p.wait_for_timeout(700); p.screenshot(path=O+f'fin_{tag}_0.png')
        p.evaluate("scrollTo(0,99999)"); p.wait_for_timeout(300); p.screenshot(path=O+f'fin_{tag}_1.png')
        p.evaluate("document.querySelector('[data-fnew]').click()"); p.wait_for_timeout(700); p.screenshot(path=O+f'fin_{tag}_sheet.png')
        p.evaluate("Sheet.closeAll()"); p.wait_for_timeout(300)
        p.evaluate("document.querySelector('[data-fopen]').click()"); p.wait_for_timeout(700); p.screenshot(path=O+f'fin_{tag}_edit.png')
        print(tag, errs)
        ctx.close()
    br.close()
