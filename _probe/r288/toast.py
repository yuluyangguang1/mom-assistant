import sys, json; sys.path.insert(0,'/workspace/work/mom-assistant/tests')
import regression as R
from playwright.sync_api import sync_playwright
eng = sys.argv[1] if len(sys.argv)>1 else 'chromium'
SAMPLER = r"""()=>{window.__ts=[];let on=true;window.__tsStop=()=>{on=false};const f=()=>{const t=document.querySelector('#toastRoot .toast');if(t){const m=t.querySelector('.toast-msg');const lh=parseFloat(getComputedStyle(m).lineHeight)||19;
 const vis=t.hasAttribute('data-vis-w')?+t.getAttribute('data-vis-w'):t.offsetWidth;
 __ts.push({w:t.offsetWidth,vis:Math.round(vis),h:t.offsetHeight,mh:m.offsetHeight,lines:Math.round(m.scrollHeight/lh),txt:m.textContent.slice(-8),show:t.className.includes('show'),cp:t.style.clipPath||''})}if(on)requestAnimationFrame(f)};requestAnimationFrame(f)}"""
with sync_playwright() as pw:
    b = getattr(pw, eng).launch()
    ctx = b.new_context(viewport={'width':390,'height':844}, has_touch=True)
    p = ctx.new_page(); errs=[]
    p.on('pageerror', lambda e: errs.append(str(e)[:200]))
    p.goto(R.URL); p.wait_for_timeout(600); p.evaluate('t=>Storage.importJSON(t)', R.SEED_V3); p.reload(); p.wait_for_timeout(1000)
    ev=p.evaluate
    ev("App.showTab('fetal')"); p.wait_for_timeout(600)
    ev(SAMPLER)
    for gap in [120,180,250,90,300,150,200,130,260,170]:
        ev("document.querySelector('#ftAdd').click()"); p.wait_for_timeout(gap)
    p.wait_for_timeout(500); ev("__tsStop()")
    ts = ev("__ts")
    print('samples', len(ts), 'min vis', min(x['vis'] for x in ts), 'min w', min(x['w'] for x in ts), 'max lines', max(x['lines'] for x in ts), 'max h', max(x['h'] for x in ts))
    print(ts[:3], ts[-2:])
    print('n toasts in root', ev("document.querySelectorAll('#toastRoot .toast').length"), ev("document.querySelector('#toastRoot .toast .toast-msg').textContent"))
    print('errs', errs)
    b.close()
