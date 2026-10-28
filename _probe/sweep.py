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
with sync_playwright() as pw:
    b=pw.chromium.launch()
    for w,h in ((320,640),(375,812),(430,932)):
        ctx=b.new_context(viewport={'width':w,'height':h},reduced_motion='reduce'); p=ctx.new_page()
        errs=[]; p.on('pageerror',lambda e:errs.append(str(e)[:160]))
        p.goto(URL); p.wait_for_timeout(400); p.evaluate('t=>Storage.importJSON(t)',S); p.reload(); p.wait_for_timeout(700)
        for pg in PAGES:
            try: p.evaluate("id=>App.showTab(id,{noAnim:true})",pg); p.wait_for_timeout(250)
            except Exception as e: print(w,pg,'showTab fail',str(e)[:100]); continue
            r=p.evaluate(JS)
            if r: print(w,pg,r)
            dw=p.evaluate("document.documentElement.scrollWidth-innerWidth")
            if dw>0: print(w,pg,'DOC H-SCROLL',dw)
        print(w,'errs',errs[:5]); ctx.close()
    b.close()
