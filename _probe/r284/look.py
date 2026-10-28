import sys
sys.path.insert(0, '/workspace/work/mom-assistant/tests')
import regression as R
from playwright.sync_api import sync_playwright
O='/workspace/work/fix284/'
tabs=sys.argv[1].split(',')
dark=len(sys.argv)>2 and sys.argv[2]=='dark'
with sync_playwright() as pw:
    br = pw.webkit.launch()
    ctx = br.new_context(viewport={'width': 393, 'height': 852}, has_touch=True, device_scale_factor=2)
    p = ctx.new_page(); errs=[]; p.on('pageerror', lambda e: errs.append(str(e)[:200]))
    p.goto(R.URL); p.wait_for_timeout(700); p.evaluate('t=>Storage.importJSON(t)', R.SEED_V3)
    p.evaluate("dk=>{const d=Storage.get();d.settings.theme=dk?'dark':'light';Storage.save()}", dark); p.reload(); p.wait_for_timeout(1200)
    for t in tabs:
        p.evaluate(f"App.showTab('{t}',{{noVT:true}})"); p.wait_for_timeout(900); p.screenshot(path=O+f'look_{t}_{"d" if dark else "l"}.png')
    print(errs)
    br.close()
