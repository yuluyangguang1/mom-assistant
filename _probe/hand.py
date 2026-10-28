exec(open('_probe/sweep.py').read().split('with sync_playwright')[0])
with sync_playwright() as pw:
    b=pw.chromium.launch(); p=b.new_page(viewport={'width':393,'height':852})
    errs=[]; p.on('pageerror',lambda e:errs.append(str(e)))
    p.goto(URL); p.wait_for_timeout(300); p.evaluate('t=>Storage.importJSON(t)',S); p.reload(); p.wait_for_timeout(800)
    p.evaluate("App.showTab('settings')"); p.wait_for_timeout(500)
    Q="()=>[...document.querySelectorAll('#tabbar > *')].filter(e=>getComputedStyle(e).display!='none').map(e=>e.id||e.getAttribute('aria-label')).join(',')+' | '+getComputedStyle(document.querySelector('#tabbar')).flexDirection"
    print('start',p.evaluate(Q))
    for m in ['left','normal','left','normal','right','right','normal','left','right','normal']:
        p.evaluate(f"document.querySelector('[data-hand-mode={m}]').click()"); p.wait_for_timeout(150); print(m,p.evaluate(Q))
    p.evaluate("App.showTab('home')"); p.wait_for_timeout(500); print('home',p.evaluate(Q))
    p.evaluate("App.showTab('settings')"); p.wait_for_timeout(500)
    p.evaluate("document.querySelector('[data-hand-mode=left]').click()"); p.wait_for_timeout(200)
    p.evaluate("App.showTab('feeding')"); p.wait_for_timeout(500); print('left feeding',p.evaluate(Q)); p.screenshot(path='/tmp/lf.png')
    p.evaluate("App.showTab('home')"); p.wait_for_timeout(700); p.screenshot(path='/tmp/lh.png')
    print('errs',errs)
