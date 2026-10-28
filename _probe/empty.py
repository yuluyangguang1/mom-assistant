exec(open('_probe/sweep.py').read().split('with sync_playwright')[0])
CON=r"""()=>{function rgb(s){const m=s.match(/[\d.]+/g);return m?m.map(Number):null}
function lum(c){const a=c.slice(0,3).map(v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)});return .2126*a[0]+.7152*a[1]+.0722*a[2]}
function bg(e){let c=[255,255,255,0];const stack=[];for(let x=e;x;x=x.parentElement){const cs=getComputedStyle(x);const b=rgb(cs.backgroundColor);if(b&&(b[3]===undefined||b[3]>0))stack.push(b.length===3?[...b,1]:b);if(cs.backgroundImage!=='none'&&x!==document.body&&x!==document.documentElement)return null;if(b&&(b[3]===undefined||b[3]>=1))break}
let r=getComputedStyle(document.body).backgroundColor;let base=rgb(r);base=base.slice(0,3);for(let i=stack.length-1;i>=0;i--){const s=stack[i];const a=s[3]??1;base=base.map((v,k)=>v*(1-a)+s[k]*a)}return base}
const out=[];for(const e of document.querySelectorAll('#view *, .tabbar *')){if(!e.childNodes.length)continue;let t='';for(const n of e.childNodes)if(n.nodeType===3)t+=n.textContent;t=t.trim();if(!t)continue;
const cs=getComputedStyle(e);if(cs.visibility==='hidden'||cs.display==='none'||+cs.opacity<.9||!e.offsetParent)continue;if(e.closest('.home-sky,[disabled],.is-disabled'))continue;
const fc=rgb(cs.color);const b=bg(e);if(!b)continue;const a=fc[3]??1;const f=fc.slice(0,3).map((v,k)=>v*a+b[k]*(1-a));
const L1=lum(f),L2=lum(b);const cr=(Math.max(L1,L2)+.05)/(Math.min(L1,L2)+.05);const big=parseFloat(cs.fontSize)>=18.5||(parseFloat(cs.fontSize)>=14&&+cs.fontWeight>=700);
if(cr<(big?3:3.6))out.push([Math.round(cr*100)/100,t.slice(0,14),e.className.toString().slice(0,24)])}
return out}"""
with sync_playwright() as pw:
    b=pw.chromium.launch()
    for mode in ('empty','seeded'):
      for theme in ('light','dark'):
        p=b.new_page(viewport={'width':393,'height':852},reduced_motion='reduce')
        errs=[]; p.on('pageerror',lambda e:errs.append(str(e)[:150]))
        p.goto(URL); p.wait_for_timeout(300)
        if mode=='seeded': p.evaluate('t=>Storage.importJSON(t)',S)
        else: p.evaluate("()=>{const d=Storage.load();d.privacyAccepted=true;d.onboarded=true;Storage.save&&Storage.save(d)}")
        p.reload(); p.wait_for_timeout(500)
        agg={}
        for pg in PAGES:
            p.evaluate("id=>App.showTab(id,{noAnim:true})",pg); p.wait_for_timeout(150)
            if theme=='dark': p.evaluate("document.body.classList.add('dark')"); p.wait_for_timeout(30)
            if mode=='seeded':
                for c in p.evaluate(CON): agg.setdefault((c[1],c[2]),(c[0],pg))
            else:
                r=p.evaluate(JS)
                if r: print('EMPTY layout',pg,r)
        print(mode,theme,'errs',errs[:4])
        for k,v in sorted(agg.items(),key=lambda x:x[1][0])[:25]: print('  ',v,k)
        p.close()
    b.close()
