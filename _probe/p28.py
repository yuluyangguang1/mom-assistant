from h274 import *
import sys
BRW=sys.argv[1] if len(sys.argv)>1 else 'w'
CON=r"""()=>{
 const P=s=>{const m=s.match(/rgba?\(([^)]+)\)/);if(!m)return null;const a=m[1].split(/[ ,\/]+/).filter(Boolean).map(Number);return [a[0],a[1],a[2],a.length>3?a[3]:1]};
 const L=c=>{const f=v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)};return .2126*f(c[0])+.7152*f(c[1])+.0722*f(c[2])};
 const bgOf=e=>{let stack=[];let x=e;while(x&&x.nodeType==1){const cs=getComputedStyle(x);if(cs.backgroundImage&&cs.backgroundImage!='none'&&!/gradient/.test(cs.backgroundImage)) return null; const c=P(cs.backgroundColor);if(c&&c[3]>0){stack.push(c);if(c[3]>=.95)break}x=x.parentElement}
   let r=[255,255,255]; if(!x) r=document.body.classList.contains('dark')?[0,0,0]:[255,255,255];
   for(let i=stack.length-1;i>=0;i--){const c=stack[i];r=[0,1,2].map(j=>c[j]*c[3]+r[j]*(1-c[3]))} return r};
 const out=[];
 document.querySelectorAll('body *').forEach(e=>{
  if(![...e.childNodes].some(n=>n.nodeType==3&&n.textContent.trim()))return;
  const r=e.getBoundingClientRect(); if(!r.width||r.bottom<0||r.top>innerHeight)return;
  const cs=getComputedStyle(e); if(cs.visibility=='hidden'||+cs.opacity<.3)return;
  if(e.closest('[hidden],.home-sky,.side-drawer,#boot,.ob-screen'))return;
  const fg=P(cs.color); if(!fg)return; const bg=bgOf(e); if(!bg)return;
  const f=[0,1,2].map(j=>fg[j]*fg[3]+bg[j]*(1-fg[3]));
  const a=L(f),b=L(bg); const cr=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
  const big=parseFloat(cs.fontSize)>=18||(parseFloat(cs.fontSize)>=14&&+cs.fontWeight>=700);
  if(cr<(big?3:4.5)) out.push(cr.toFixed(2)+' '+e.tagName+'.'+(e.className+'').slice(0,40)+' "'+e.textContent.trim().slice(0,24)+'" fg'+f.map(Math.round)+' bg'+bg.map(Math.round));
 });
 return out.slice(0,40);}"""
with sync_playwright() as pw:
  b=launch(pw); c,p=page(b,dark=True)
  ids=p.evaluate("Object.keys(Modules)")
  print('ids',ids,flush=True)
  for st in ('baby','pregnancy'):
    if st=='pregnancy':
      p.evaluate("()=>{const s=Storage.get();s.settings.stage='pregnancy';s.settings.dueDate='2026-12-20';Storage.save()}"); p.reload(); p.wait_for_timeout(2500)
      p.evaluate("document.querySelectorAll('.ob-screen,#boot').forEach(e=>e.remove())")
    for i in ids:
      try: p.evaluate("id=>App.showTab(id)",i); p.wait_for_timeout(700)
      except Exception as e: print(i,'ERR',str(e)[:80]); continue
      f=shot(p,f'dk_{st}_{i}') if i in ('bath','swim','sun','diaper') else None
      cc=p.evaluate(CON); ch=check(p)
      if cc or ch: print('==',st,i,cc,ch,flush=True)
  print('ERRS',[e for e in p.errs if 'willRead' not in e])
  b.close()
