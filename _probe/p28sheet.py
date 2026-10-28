from h274 import *
exec(open('p28.py').read().split('with sync_playwright')[0].split('from h274 import *')[1])
with sync_playwright() as pw:
  b=launch(pw); c,p=page(b,dark=True)
  for t in ['bath','swim','sun','water','temp','meds','mood','jaundice','diaper','supplement','solid','pump','breast','bottle','sleep','growth','milestone','period']:
    p.evaluate("id=>App.showTab(id,{noVT:true})",t); p.wait_for_timeout(500)
    ok=p.evaluate("()=>{const b=document.querySelector('#view [data-new], #view .ft-split-add, #view .mc-main');if(b){b.click();return b.className}return null}")
    p.wait_for_timeout(500)
    cc=p.evaluate(CON.replace("document.querySelectorAll('body *')","document.querySelectorAll('#modalRoot *, #view .modal-mask *')"))
    print(t,ok,cc if cc else 'ok',flush=True)
    if t in('bath','sun'): shot(p,'28sheet_'+t)
    p.evaluate("Sheet.closeAll();document.getElementById('modalRoot').innerHTML=''"); p.wait_for_timeout(100)
