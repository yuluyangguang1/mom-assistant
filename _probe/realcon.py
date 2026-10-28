exec(open('_probe/sweep.py').read().split('with sync_playwright')[0])
from PIL import Image
import io
def lum(c):
    def f(v):
        v/=255; return v/12.92 if v<=.03928 else ((v+.055)/1.055)**2.4
    return .2126*f(c[0])+.7152*f(c[1])+.0722*f(c[2])
def cr(a,b):
    la,lb=sorted((lum(a),lum(b)),reverse=True); return (la+.05)/(lb+.05)
with sync_playwright() as pw:
    b=pw.chromium.launch()
    for theme in ('light','dark'):
        p=b.new_page(viewport={'width':393,'height':852},device_scale_factor=1)
        p.goto(URL); p.wait_for_timeout(300); p.evaluate('t=>Storage.importJSON(t)',S)
        p.evaluate("m=>{var d=Storage.get();d.settings.themeMode=m;d.settings.theme=m;Storage.save()}",theme)
        p.reload(); p.wait_for_timeout(1200)
        els=p.evaluate("""()=>{const o=[];document.querySelectorAll('#view p,#view h2,#view span,#view small,#view .hint').forEach((e,i)=>{if(e.closest('.card,.record-tile,.rem-group,button'))return;const t=[...e.childNodes].filter(n=>n.nodeType==3&&n.textContent.trim()).map(n=>n.textContent.trim()).join('');if(!t)return;const r=e.getBoundingClientRect();if(r.width<5||r.bottom<0||r.top>852)return;e.setAttribute('data-rc',i);o.push([i,t.slice(0,20),getComputedStyle(e).color,r.x,r.y,r.width,r.height])});return o}""")
        for i,t,col,x,y,w,h in els:
            img=Image.open(io.BytesIO(p.screenshot(clip={'x':x,'y':y,'width':w,'height':h}))).convert('RGB')
            p.evaluate(f"document.querySelector('[data-rc=\"{i}\"]').style.color='transparent'")
            bg=Image.open(io.BytesIO(p.screenshot(clip={'x':x,'y':y,'width':w,'height':h}))).convert('RGB')
            p.evaluate(f"document.querySelector('[data-rc=\"{i}\"]').style.color=''")
            px=list(bg.getdata()); 
            c=[int(v) for v in col[col.index('(')+1:col.index(')')].split(',')[:3]]
            worst=min(cr(c,q) for q in px[::7])
            avg=tuple(sum(q[k] for q in px)//len(px) for k in range(3))
            print(theme, t, round(cr(c,avg),2), 'worst', round(worst,2))
        p.close()
    b.close()
