import sys, json
sys.path.insert(0, '/workspace/work/mom-assistant/tests')
import regression as R
from playwright.sync_api import sync_playwright
with sync_playwright() as pw:
    br = pw.webkit.launch()
    ctx = br.new_context(viewport={'width': 393, 'height': 852}, has_touch=True, device_scale_factor=2)
    p = ctx.new_page()
    p.on('console', lambda m: print('CONSOLE', m.text[:600]))
    p.goto(R.URL); p.wait_for_timeout(700); p.evaluate('t=>Storage.importJSON(t)', R.SEED_V3); p.reload(); p.wait_for_timeout(1200)
    ev = p.evaluate
    ev("(()=>{const d=Storage.get();d.supplementPlans=[];d.supplements=[];Storage.save()})()")
    ev("App.showTab('supplement',{noVT:true})"); p.wait_for_timeout(400)
    ev("""(()=>{['click','touchend','pointerup'].forEach(t=>document.addEventListener(t,e=>{const b=e.target.closest&&e.target.closest('button');console.log('EV',t,b?(b.textContent||'').trim().slice(0,8):e.target.tagName,e.isTrusted)},true));
      const os=Storage.save;Storage.save=function(){const d=Storage.get();console.log('SAVE plans='+(d.supplementPlans||[]).length+' '+new Error().stack.split('\\n').slice(1,6).join(' | '));return os.apply(this,arguments)}})()""")
    def tap(sel, wait=250):
        loc = p.locator(sel).first; loc.scroll_into_view_if_needed(); loc.tap(); p.wait_for_timeout(wait)
    tap('[data-spadd]', 500)
    p.locator('#spwPreset').select_option('m-fa'); p.wait_for_timeout(200)
    for i in range(5):
        tap('[data-next]'); print('STEP', ev("(document.querySelector('.spw-of')||{}).textContent"), ev("Storage.get().supplementPlans.length"))
    print('--- save tap')
    tap('[data-next]', 800)
    print('PLANS', ev("Storage.get().supplementPlans.map(p=>p.id+' '+p.name)"))
    br.close()
