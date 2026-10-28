exec(open('_probe/sweep.py').read().split('with sync_playwright')[0])
import collections,io
from PIL import Image
def _l(c):
    c=[v/255 for v in c]; c=[v/12.92 if v<=.03928 else ((v+.055)/1.055)**2.4 for v in c]; return .2126*c[0]+.7152*c[1]+.0722*c[2]
def cr2(a,b):
    x,y=_l(a),_l(b); return (max(x,y)+.05)/(min(x,y)+.05)
PAGES=['home','feeding','diaper','sleep','meds','mood','growth','milestone','temp','period','finance','supplies','jaundice','bath','swim','sun','water','supplement','pregnancy','contraction','settings','vaccine','calendar','alltools']
JS=r"""()=>{
function p(c){const m=c.match(/[\d.]+/g);if(!m)return null;return m.map(Number)}
function L(r,g,b){[r,g,b]=[r,g,b].map(v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)});return .2126*r+.7152*g+.0722*b}
function bgOf(el){let layers=[];while(el){const c=getComputedStyle(el);const b=p(c.backgroundColor);if(b&&(b[3]===undefined||b[3]>0)){layers.push(b);if(b[3]===undefined||b[3]>=1)break}
 if(c.backgroundImage&&c.backgroundImage!=='none'&&/gradient/.test(c.backgroundImage)){const m=c.backgroundImage.match(/rgba?\([^)]*\)/);if(m){const g=p(m[0]);layers.push(g);if(g[3]===undefined||g[3]>=1)break}}
 el=el.parentElement}
 let base=[0,0,0];if(!layers.length)return null;let i=layers.length-1;base=layers[i].slice(0,3);if(layers[i][3]!==undefined&&layers[i][3]<1)base=[20,20,20];
 for(i=layers.length-2;i>=0;i--){const a=layers[i][3]===undefined?1:layers[i][3];base=base.map((v,k)=>v*(1-a)+layers[i][k]*a)}return base}
const out=[];const w=document.createTreeWalker(document.querySelector('#view'),NodeFilter.SHOW_TEXT);let n;
while(n=w.nextNode()){const t=n.textContent.trim();if(!t)continue;const el=n.parentElement;if(!el.offsetParent&&getComputedStyle(el).position!=='fixed')continue;
 const c=getComputedStyle(el);if(c.visibility==='hidden'||+c.opacity===0)continue;const fg=p(c.color);let bg=bgOf(el);if(!bg)continue;
 let a=fg[3]===undefined?1:fg[3];let op=1,e=el;while(e){op*=+getComputedStyle(e).opacity;e=e.parentElement}a*=op;
 const f=fg.slice(0,3).map((v,k)=>v*a+bg[k]*(1-a));const l1=L(...f),l2=L(...bg);const cr=(Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05);
 const fs=parseFloat(c.fontSize),bold=+c.fontWeight>=600;const need=(fs>=24||(fs>=18.66&&bold))?3:4.5;
 if(cr<need){el.setAttribute('data-lowc',out.length);out.push([cr.toFixed(2),need,el.className||el.tagName,t.slice(0,18)])}}
return out}"""
with sync_playwright() as pw:
    b=pw.chromium.launch(); p=b.new_page(viewport={'width':393,'height':852})
    p.goto(URL); p.wait_for_timeout(300); p.evaluate('t=>Storage.importJSON(t)',S); p.reload(); p.wait_for_timeout(500)
    p.evaluate("m=>{var d=Storage.get();d.settings.themeMode=m;d.settings.theme=m;Storage.save()}", __import__('os').environ.get('TH','dark')); p.reload(); p.wait_for_timeout(800)
    agg=collections.defaultdict(list)
    for pg in PAGES:
        try: p.evaluate("id=>App.showTab(id,{noAnim:true})",pg)
        except Exception as e: print('skip',pg); continue
        p.wait_for_timeout(350)
        res=p.evaluate(JS)
        for i,(cr,need,cls,t) in enumerate(res):
            loc=p.locator(f'[data-lowc="{i}"]').first
            try:
                loc.scroll_into_view_if_needed(timeout=1000); png=loc.screenshot(timeout=1500,animations='disabled')
            except Exception: agg[(cls,need)].append((float(cr),pg,t+' ?')); continue
            im=Image.open(io.BytesIO(png)).convert('RGB'); px=list(im.getdata())
            bg=collections.Counter(px).most_common(1)[0][0]
            fg=max(px,key=lambda q:sum((q[k]-bg[k])**2 for k in range(3)))
            agg[(cls,need)].append((round(cr2(fg,bg),2),pg,t))
    for (cls,need),v in sorted(agg.items(),key=lambda x:min(y[0] for y in x[1])):
        v.sort()
        if v[0][0]<need: print(f"{v[0][0]:.2f}<{need} x{len(v)} {cls} | {v[0][1]} 「{v[0][2]}」 pages:{','.join(sorted(set(x[1] for x in v)))[:60]}")
    b.close()
