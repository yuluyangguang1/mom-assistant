import sys,json,hashlib
exec(open('_probe/sweep.py').read().split('PAGES=')[0])
PAGES=['home','calendar','settings','alltools','search','feeding','diaper','sleep','meds','mood','whitenoise','growth','vaccine','milestone','temp','period','finance','supplies','jaundice','bath','swim','sun','water','supplement','pregnancy','fetal','contraction','packing']
JS="""()=>{const o=[];const all=[document.documentElement,...document.querySelectorAll('body, body *')];
for(const e of all){if(e.closest('svg')&&e.tagName!=='svg')continue;const cs=getComputedStyle(e);let s='';for(let i=0;i<cs.length;i++){const k=cs[i];s+=k+':'+cs.getPropertyValue(k)+';'}
o.push([e.tagName+'#'+e.id+'.'+(e.getAttribute('class')||''),s])}return o}"""
out={}
with sync_playwright() as pw:
    b=pw.chromium.launch()
    for theme in ('light','dark'):
      for w in (393,1024):
        p=b.new_page(viewport={'width':w,'height':852},reduced_motion='reduce')
        p.add_init_script("Date.now=()=>1761206400000;")
        p.goto(URL); p.wait_for_timeout(300); p.evaluate('t=>Storage.importJSON(t)',S); p.reload(); p.wait_for_timeout(500)
        if theme=='dark': p.evaluate("document.body.classList.add('dark')")
        extra=[('quickdock',"document.getElementById('qdFab').click()")]
        for pg in PAGES:
            p.evaluate("id=>App.showTab(id,{noAnim:true})",pg); p.wait_for_timeout(120)
            if theme=='dark': p.evaluate("document.body.classList.add('dark')")
            out[f'{theme}-{w}-{pg}']=p.evaluate(JS)
        p.evaluate("App.showTab('home',{noAnim:true})"); p.wait_for_timeout(100)
        p.evaluate("document.getElementById('qdFab').click()"); p.wait_for_timeout(300)
        out[f'{theme}-{w}-dock']=p.evaluate(JS)
        p.close()
    b.close()
json.dump(out,open(sys.argv[1],'w'))
print('pages',len(out),'els',sum(len(v) for v in out.values()))
