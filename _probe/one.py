exec(open('_probe/sweep.py').read().split('with sync_'+'playwright')[0])
import sys
with sync_playwright() as pw:
    b=pw.chromium.launch(); p=b.new_page(viewport={'width':393,'height':852})
    p.goto(URL); p.wait_for_timeout(300); p.evaluate('t=>Storage.importJSON(t)',S); p.reload(); p.wait_for_timeout(500)
    p.evaluate("m=>{var d=Storage.get();d.settings.themeMode=m;d.settings.theme=m;Storage.save()}", sys.argv[1]); p.reload(); p.wait_for_timeout(800)
    p.evaluate("id=>App.showTab(id,{noAnim:true})",sys.argv[2]); p.wait_for_timeout(400)
    print(p.evaluate("s=>[...document.querySelectorAll(s)].slice(0,3).map(e=>{const c=getComputedStyle(e);let a=e,o=[];while(a){const k=getComputedStyle(a);if(k.backgroundColor!=='rgba(0, 0, 0, 0)')o.push(a.className+':'+k.backgroundColor);a=a.parentElement}return e.textContent.slice(0,10)+' | '+c.color+' op'+c.opacity+' | '+o.slice(0,3).join(' > ')})",sys.argv[3]))
    b.close()
