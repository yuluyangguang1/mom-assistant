exec(open('_probe/sweep.py').read().split('with sync_playwright')[0])
from PIL import Image
with sync_playwright() as pw:
    b=pw.chromium.launch(); p=b.new_page(viewport={'width':393,'height':852})
    p.goto(URL); p.wait_for_timeout(300)
    p.evaluate("()=>{localStorage.clear()}"); p.reload(); p.wait_for_timeout(800)
    p.evaluate("()=>{var d=Storage.get();d.settings.onboarded=true;d.onboarded=true;Storage.save();document.querySelectorAll('.ob-root,.onboarding,#obRoot').forEach(e=>e.remove())}")
    ims=[]
    for pg in ['contraction','finance','period','supplies']:
        p.evaluate("id=>App.showTab(id,{noAnim:true})",pg); p.wait_for_timeout(400)
        y=p.evaluate("()=>{const e=document.querySelector('.empty-state:last-of-type');const all=document.querySelectorAll('.empty-state');const t=all[all.length-1];t.scrollIntoView({block:'center'});const r=t.closest('.card').getBoundingClientRect();return [r.y,r.height]}")
        p.wait_for_timeout(200); y=p.evaluate("()=>{const all=document.querySelectorAll('.empty-state');const r=all[all.length-1].closest('.card').getBoundingClientRect();return [r.y,r.height]}")
        p.screenshot(path=f'/tmp/es_{pg}.png',clip={'x':0,'y':max(0,y[0]-10),'width':393,'height':y[1]+20}); ims.append(Image.open(f'/tmp/es_{pg}.png'))
    H=sum(i.height for i in ims); o=Image.new('RGB',(393,H),'white'); yy=0
    for i in ims: o.paste(i,(0,yy)); yy+=i.height
    o.save('/tmp/es_all.png')
    b.close()
