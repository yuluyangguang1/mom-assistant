exec(open('_probe/sweep.py').read().split('with sync_playwright')[0])
import time
with sync_playwright() as pw:
    b=pw.chromium.launch()
    ctx=b.new_context(viewport={'width':393,'height':852},reduced_motion='reduce'); p=ctx.new_page()
    errs=[]; cur=['']
    p.on('pageerror',lambda e:errs.append((cur[0],str(e)[:200])))
    p.on('dialog',lambda d:d.accept())
    p.goto(URL); p.wait_for_timeout(400); p.evaluate('t=>Storage.importJSON(t)',S); p.reload(); p.wait_for_timeout(700)
    t0=time.time(); total=0
    for pg in PAGES:
        if time.time()-t0>100: print('time budget hit at',pg); break
        p.evaluate("id=>App.showTab(id,{noAnim:true})",pg); p.wait_for_timeout(150)
        n=p.evaluate("document.querySelectorAll('#view button, #view [data-go], #view .chip, #view input[type=checkbox]').length")
        for i in range(min(n,40)):
            try:
                p.evaluate("id=>{if(App.current&&App.current()!==id)App.showTab(id,{noAnim:true})}",pg)
            except: pass
            lab=p.evaluate("""i=>{const e=document.querySelectorAll('#view button, #view [data-go], #view .chip, #view input[type=checkbox]')[i];if(!e)return null;
              const t=(e.textContent||e.getAttribute('aria-label')||e.id||'').trim().slice(0,16);
              if(/导出|清空|删除全部|重置|恢复出厂|导入/.test(t))return 'SKIP';
              try{e.click()}catch(x){return 'clickerr '+x}return t}""",i)
            cur[0]=f'{pg}#{i}:{lab}'; total+=1
            p.wait_for_timeout(60)
            p.keyboard.press('Escape')
            p.evaluate("()=>{document.querySelectorAll('.modal-mask,.sheet-mask,[role=dialog]').forEach(m=>{const c=m.querySelector('[data-close],.modal-close,.btn-close');if(c)c.click()})}")
            p.evaluate("id=>App.showTab(id,{noAnim:true})",pg); p.wait_for_timeout(40)
    print('clicked',total,'errors',len(errs))
    for e in errs[:20]: print(e)
    b.close()
