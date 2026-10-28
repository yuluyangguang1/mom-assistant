exec(open('_probe/sweep.py').read().split('with sync_playwright')[0])
PAGES=['home','calendar','settings','alltools','feeding','diaper','sleep','meds','mood','whitenoise','growth','vaccine','milestone','temp','period','finance','supplies','jaundice','bath','swim','sun','water','supplement','pregnancy','fetal','contraction','packing']
with sync_playwright() as pw:
    b=pw.chromium.launch(); p=b.new_page(viewport={'width':393,'height':852})
    p.goto(URL); p.wait_for_timeout(300); p.evaluate('t=>Storage.importJSON(t)',S); p.reload(); p.wait_for_timeout(800)
    for pg in PAGES:
        p.evaluate("id=>App.showTab(id,{noAnim:true})",pg); p.wait_for_timeout(300)
        r=p.evaluate("""()=>[...document.querySelectorAll('#view .card')].filter(c=>!c.querySelector('input,button,select,textarea,ul,svg:not(.ico),canvas,.stat,a')).map(c=>c.className+' | '+c.textContent.trim().slice(0,30))""")
        for x in r: print(pg, x)
    b.close()
