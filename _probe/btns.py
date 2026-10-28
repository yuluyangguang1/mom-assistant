exec(open('_probe/sweep.py').read().split('with sync_playwright')[0])
import collections
PAGES=['home','feeding','diaper','sleep','meds','mood','growth','milestone','temp','period','finance','supplies','jaundice','bath','swim','sun','water','supplement','pregnancy','contraction','settings']
agg=collections.defaultdict(lambda:[0,set(),set()])
with sync_playwright() as pw:
    b=pw.chromium.launch(); p=b.new_page(viewport={'width':393,'height':852})
    p.goto(URL); p.wait_for_timeout(300); p.evaluate('t=>Storage.importJSON(t)',S); p.reload(); p.wait_for_timeout(800)
    for pg in PAGES:
        p.evaluate("id=>App.showTab(id,{noAnim:true})",pg); p.wait_for_timeout(300)
        r=p.evaluate("""()=>[...document.querySelectorAll('#view button, #view .chip, #view [role=button]')].filter(b=>b.offsetParent).map(b=>{const c=getComputedStyle(b);const r=b.getBoundingClientRect();return [b.className.split(' ').filter(x=>x&&!/^(on|active|sel|is-)/.test(x)).sort().join('.')||b.tagName, Math.round(r.height)+'h r'+c.borderTopLeftRadius+' f'+c.fontSize+' b'+c.borderTopWidth+' bg'+(c.backgroundColor.length<20?c.backgroundColor:'img')]})""")
        for k,v in r:
            a=agg[k]; a[0]+=1; a[1].add(v); a[2].add(pg)
    b.close()
for k,(n,v,pgs) in sorted(agg.items(),key=lambda x:-x[1][0]):
    print(n,k,'|',' ; '.join(sorted(v))[:220],'|',','.join(sorted(pgs))[:80])
