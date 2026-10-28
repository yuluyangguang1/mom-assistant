exec(open('_probe/sweep.py').read().split('with sync_playwright')[0])
PAGES=['feeding','diaper','sleep','meds','mood','growth','milestone','temp','period','finance','supplies','jaundice','bath','swim','sun','water','supplement','pregnancy','contraction']
with sync_playwright() as pw:
    b=pw.chromium.launch(); p=b.new_page(viewport={'width':393,'height':852})
    p.goto(URL); p.wait_for_timeout(300); p.evaluate('t=>Storage.importJSON(t)',S); p.reload(); p.wait_for_timeout(800)
    for pg in PAGES:
        p.evaluate("id=>App.showTab(id,{noAnim:true})",pg); p.wait_for_timeout(300)
        r=p.evaluate("""()=>[...document.querySelectorAll('#view .btn-save')].map(b=>{const sib=[...b.parentElement.children].filter(x=>x!==b&&x.tagName==='BUTTON'&&x.offsetParent).map(x=>x.textContent.trim());const r=b.getBoundingClientRect();return b.id+':'+b.textContent.trim()+' w'+Math.round(r.width)+' h'+Math.round(r.height)+(sib.length?' SIBS '+sib.join('/'):'')})""")
        prim=p.evaluate("""()=>[...document.querySelectorAll('#view .btn-primary:not(.btn-save)')].filter(b=>b.offsetParent).map(b=>b.id+':'+b.textContent.trim())""")
        print(pg, r, '| other primary', prim)
    b.close()
