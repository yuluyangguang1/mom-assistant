import sys, json
sys.path.insert(0, '/workspace/work/mom-assistant/tests')
import regression as R
from playwright.sync_api import sync_playwright
with sync_playwright() as pw:
    b = getattr(pw, sys.argv[1]).launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, has_touch=True)
    p = ctx.new_page()
    p.goto(R.URL); p.wait_for_timeout(600); p.evaluate('t=>Storage.importJSON(t)', R.SEED_V3); p.reload(); p.wait_for_timeout(900)
    ev = p.evaluate
    ev("()=>{const s=Storage.get();" + R.R291_LIVE_SET['wn'] + "Storage.save();App.rerender()}")
    p.wait_for_timeout(1500)
    for t in ('home','diaper','calendar'):
        ev("t=>App.showTab(t,{noVT:true})", t); p.wait_for_timeout(400)
        print(t, json.dumps(ev(R.R291_LIVE_M), ensure_ascii=False))
        print(ev("(()=>{const L=document.getElementById('dockLive');const c=getComputedStyle(L);return [L.className,L.style.cssText,c.bottom,c.transform,document.documentElement.className,document.body.className,JSON.stringify(Storage.get().whitenoise)]})()"))
    ev("App.showTab('whitenoise',{noVT:true})"); p.wait_for_timeout(250)
    ev("Modules.whitenoise._open=true;App.rerender()"); p.wait_for_timeout(450)
    ev("document.getElementById('wpClose').click()"); p.wait_for_timeout(500)
    print('after', json.dumps(ev(R.R291_LIVE_M), ensure_ascii=False))
    print(ev("(()=>{const L=document.getElementById('dockLive');const c=getComputedStyle(L);return [L.className,L.innerHTML.length,document.documentElement.className,document.body.className,JSON.stringify(Storage.get().whitenoise)]})()"))
    b.close()
