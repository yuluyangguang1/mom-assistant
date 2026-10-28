import functools, http.server, json, socketserver, sys, threading, datetime
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT/'tests'))
from seed_data import seed
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*a): pass
srv=socketserver.ThreadingTCPServer(('127.0.0.1',0),functools.partial(Q,directory=str(ROOT)))
threading.Thread(target=srv.serve_forever,daemon=True).start()
URL=f'http://127.0.0.1:{srv.server_address[1]}/index.html'
S=json.dumps(dict(seed,version=3),ensure_ascii=False)
PAGES=['home','calendar','settings','alltools','search','feeding','diaper','sleep','meds','mood','whitenoise','growth','vaccine','milestone','temp','period','finance','supplies','jaundice','bath','swim','sun','water','supplement','pregnancy','fetal','contraction','packing']
JS=r"""()=>{const W=innerWidth,out=[];
for(const e of document.querySelectorAll('#view *')){const cs=getComputedStyle(e);if(cs.display==='none'||cs.visibility==='hidden')continue;
 const r=e.getBoundingClientRect();if(!r.width||!r.height)continue;
 if(e.closest('.sw-clip,.swipe-act,.home-sky,.sky-canvas,[aria-hidden="true"]'))continue;
 if(r.right>W+1||r.left<-1){out.push(['overflowX',e.tagName+'.'+e.className.toString().slice(0,30),Math.round(r.left),Math.round(r.right),(e.textContent||'').trim().slice(0,20)]);continue}
 if(/^(INPUT|SELECT|TEXTAREA)$/.test(e.tagName)){const p=e.parentElement.closest('.card,.list li,label')||e.parentElement;const pr=p.getBoundingClientRect();if(r.right>pr.right+1)out.push(['inputOut',e.type||e.tagName,Math.round(r.right),Math.round(pr.right)])}
 if(e.children.length===0&&e.textContent.trim()&&cs.overflow!=='visible'&&cs.textOverflow!=='ellipsis'&&e.scrollWidth>e.clientWidth+2)out.push(['clipped',e.tagName+'.'+e.className.toString().slice(0,30),e.textContent.trim().slice(0,20)]);
}
return out.slice(0,12)}"""
from PIL import Image
import io
def lum(c):
    def f(v):
        v/=255; return v/12.92 if v<=.03928 else ((v+.055)/1.055)**2.4
    return .2126*f(c[0])+.7152*f(c[1])+.0722*f(c[2])
def cr(a,b):
    la,lb=sorted((lum(a),lum(b)),reverse=True); return (la+.05)/(lb+.05)
import sys
HOURS=[float(x) for x in (sys.argv[1:] or ['6','7','8','12','16.5','17.5','18.5','19','19.5','19.75','20','20.5','21','21.5'])]
SEL='.home-greet h1,.home-greet .hg-num,.home-greet .hg-date,.home-greet .hg-sub,.home-greet p,.section-title,.hn-hint'
with sync_playwright() as pw:
    b=pw.chromium.launch()
    for H in HOURS:
        ctx=b.new_context(viewport={'width':393,'height':852},reduced_motion='reduce',timezone_id='Asia/Shanghai')
        hh=int(H); mm=int(round((H-hh)*60))
        ctx.add_init_script("(()=>{const _D=Date;const f=new _D(2026,9,23,%d,%d).getTime();const off=f-_D.now();class D extends _D{constructor(...a){if(!a.length)super(_D.now()+off);else super(...a)}static now(){return _D.now()+off}};window.Date=D})()"%(hh,mm))
        p=ctx.new_page(); p.goto(URL); p.wait_for_timeout(300); p.evaluate('t=>Storage.importJSON(t)',S)
        p.evaluate("()=>{var d=Storage.get();d.settings.themeMode='time';Storage.save()}"); p.reload(); p.wait_for_timeout(1500)
        ink=p.evaluate("document.documentElement.getAttribute('data-sky-ink')+' dark='+document.body.classList.contains('dark')")
        els=p.evaluate("""(sel)=>{const o=[];document.querySelectorAll(sel).forEach((e,i)=>{const r=e.getBoundingClientRect();if(r.width<5||r.bottom<0||r.top>852)return;e.setAttribute('data-rc',i);o.push([i,e.textContent.trim().slice(0,10),getComputedStyle(e).color,r.x,r.y,r.width,r.height])});return o}""",SEL)
        res=[]
        for i,t,col,x,y,w,h in els:
            img=Image.open(io.BytesIO(p.screenshot(clip={'x':x,'y':y,'width':w,'height':h}))).convert('RGB')
            p.evaluate(f"document.querySelector('[data-rc=\"{i}\"]').style.color='transparent'")
            bg=Image.open(io.BytesIO(p.screenshot(clip={'x':x,'y':y,'width':w,'height':h}))).convert('RGB')
            p.evaluate(f"document.querySelector('[data-rc=\"{i}\"]').style.color=''")
            px=list(bg.getdata())
            c=[float(v) for v in col[col.index('(')+1:col.index(')')].split(',')]
            avg=tuple(sum(q[k] for q in px)//len(px) for k in range(3))
            a=c[3] if len(c)>3 else 1
            cc=[c[k]*a+avg[k]*(1-a) for k in range(3)]
            res.append(f"{t}:{cr(cc,avg):.1f}")
        print(H,ink,' | '.join(res))
        ctx.close()
    b.close()
