exec(open('_probe/sweep.py').read().split('with sync_playwright')[0])
import os; os.makedirs('/tmp/ob',exist_ok=True)
with sync_playwright() as pw:
    b=pw.chromium.launch()
    for theme in ('light','dark'):
        p=b.new_page(viewport={'width':393,'height':852},reduced_motion='reduce',color_scheme=theme)
        p.goto(URL); p.wait_for_timeout(300)
        p.evaluate("()=>{const s=Storage.get();s.settings.privacyAccepted=false;Storage.save()}")
        if theme=='dark': p.evaluate("()=>{const s=Storage.get();s.settings.theme='dark';Storage.save()}")
        p.reload(); p.wait_for_timeout(700)
        steps=["", "button.ob-primary,.ob-next", "[data-role]", "[data-stage]", None, None]
        for k in range(6):
            p.screenshot(path=f'/tmp/ob/{theme}{k}.png')
            info=p.evaluate("""()=>[...document.querySelectorAll('#obRoot button')].filter(b=>b.offsetParent).map(b=>(b.className+':'+b.textContent.trim()).slice(0,30))""")
            if k==0: print(theme,info[:12])
            # pick: first card option, then primary
            p.evaluate("""()=>{const r=document.getElementById('obRoot')||document;const c=r.querySelector('.ob-card:not(.active)');if(c)c.click()}"""); p.wait_for_timeout(150)
            p.evaluate("""()=>{const r=document.getElementById('obRoot')||document;const b=[...r.querySelectorAll('button')].filter(x=>x.offsetParent).find(x=>/ob-cta|ob-primary|btn-primary|primary/.test(x.className));if(b)b.click()}"""); p.wait_for_timeout(450)
        p.close()
    b.close()
