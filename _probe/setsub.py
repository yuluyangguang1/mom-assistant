exec(open('_probe/sweep.py').read().split('with sync_playwright')[0])
with sync_playwright() as pw:
    b=pw.chromium.launch(); ctx=b.new_context(viewport={'width':393,'height':852},has_touch=True,is_mobile=True,device_scale_factor=1); p=ctx.new_page()
    errs=[]; p.on('pageerror',lambda e:errs.append(str(e)))
    p.goto(URL); p.wait_for_timeout(300); p.evaluate('t=>Storage.importJSON(t)',S); p.reload(); p.wait_for_timeout(800)
    p.evaluate("App.showTab('settings')"); p.wait_for_timeout(600); p.screenshot(path='/tmp/s0.png')
    D="()=>({h:document.querySelector('.page-head h1').textContent,vis:[...document.querySelectorAll('.set-group')].filter(e=>getComputedStyle(e).display!='none').length,back:!document.getElementById('backBtn').hidden,sub:document.getElementById('tabbar').className})"
    print('list',p.evaluate(D))
    p.click('.set-group:nth-of-type(6) summary'); p.wait_for_timeout(600); print('open',p.evaluate(D)); p.screenshot(path='/tmp/s1.png')
    # change a setting that rerenders: theme
    p.evaluate("document.querySelector('[data-theme-mode=dark]').click()"); p.wait_for_timeout(600); print('after rerender',p.evaluate(D))
    p.evaluate("document.querySelector('[data-theme-mode=light]').click()"); p.wait_for_timeout(400)
    p.click('#backBtn'); p.wait_for_timeout(600); print('back',p.evaluate(D))
    p.click('.set-group:nth-of-type(1) summary'); p.wait_for_timeout(400); print('open1',p.evaluate(D)); p.screenshot(path='/tmp/s2.png')
    p.go_back(); p.wait_for_timeout(600); print('sysback',p.evaluate(D), p.evaluate("App.current ? App.current() : ''"))
    p.click('.set-group:nth-of-type(2) summary'); p.wait_for_timeout(300)
    p.evaluate("App.showTab('feeding')"); p.wait_for_timeout(500); p.click('#backBtn'); p.wait_for_timeout(700)
    print('module back ->', p.evaluate("document.querySelector('.page-head h1, .mod-head h1, .home-greet h1')?.textContent"))
    print('errs',errs)
