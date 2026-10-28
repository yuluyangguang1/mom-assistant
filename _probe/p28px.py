# 像素实测：把文字设透明拍底色，取底色中位数和文字色算对比度
import io,sys
from PIL import Image
from h274 import *
def lum(c):
    f=lambda v:(v/255)/12.92 if v/255<=.03928 else (((v/255)+.055)/1.055)**2.4
    return .2126*f(c[0])+.7152*f(c[1])+.0722*f(c[2])
def cr(a,b):
    x,y=sorted((lum(a),lum(b)),reverse=True); return (x+.05)/(y+.05)
CASES=[('home','.hl2-head'),('pregnancy','.btn-primary'),('finance','.btn-primary'),('settings','.btn-primary'),('fetal','.btn-primary'),('contraction','.btn-primary'),
       ('diaper','.hero-badge'),('bath','.ft-split span'),('swim','.ft-split span'),('sun','.ft-split span'),('breast','.ft-split span'),('sleep','.ft-split span')]
if len(sys.argv)>1: CASES=[c for c in CASES if c[0] in sys.argv[1].split(',')]
with sync_playwright() as pw:
  b=launch(pw); c,p=page(b,dark=True)
  for tab,sel in CASES:
    p.evaluate("id=>App.showTab(id,{noVT:true})",tab); p.wait_for_timeout(900)
    n=p.evaluate("s=>{const o=[];document.querySelectorAll(s).forEach((e,i)=>{const r=e.getBoundingClientRect();if(r.width<4||r.bottom<0||r.top>innerHeight)return;e.setAttribute('data-px',i);o.push([i,e.textContent.trim().slice(0,14),getComputedStyle(e).color,r.x,r.y,r.width,r.height,parseFloat(getComputedStyle(e).fontSize),getComputedStyle(e).fontWeight])});return o.slice(0,6)}",sel)
    for i,t,col,x,y,w,h,fs,fw in n:
        clip={'x':x,'y':y,'width':w,'height':h}
        p.evaluate(f"document.querySelector('[data-px=\"{i}\"]').style.setProperty('color','transparent','important')")
        bg=Image.open(io.BytesIO(p.screenshot(clip=clip))).convert('RGB')
        p.evaluate(f"document.querySelector('[data-px=\"{i}\"]').style.color=''")
        px=sorted(bg.getdata(),key=lum); med=px[len(px)//2]
        fc=[int(float(v)) for v in col[col.index('(')+1:col.index(')')].replace(',',' ').split()[:3]]
        big=fs>=24 or (fs>=18.66 and int(fw)>=700)
        r=cr(fc,med); print(tab,sel,repr(t),'cr',round(r,2),'need',3 if big else 4.5,'OK' if r>=(3 if big else 4.5) else 'LOW', 'fg',fc,'bg',med,flush=True)
