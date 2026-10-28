import sys, json, functools, http.server, socketserver, threading, re, os, datetime
sys.path.insert(0,'/workspace/work/mom-assistant/tests')
from seed_data import seed
from playwright.sync_api import sync_playwright
R=os.environ.get('ROOT','/workspace/work/mom-assistant')
S='/workspace/work/mom-assistant/_probe/s274'
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*a): pass
srv=socketserver.ThreadingTCPServer(('127.0.0.1',0),functools.partial(Q,directory=R)); threading.Thread(target=srv.serve_forever,daemon=True).start()
PORT=srv.server_address[1]
U=f'http://127.0.0.1:{PORT}/index.html'
IOS='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
# shift seed dates +15 days so the last day is today (2026-10-26)
def shift(o):
    if isinstance(o,dict): return {k:shift(v) for k,v in o.items()}
    if isinstance(o,list): return [shift(v) for v in o]
    if isinstance(o,str):
        m=re.match(r'^2026-10-(\d\d)(.*)$',o)
        if m: return '2026-10-%02d%s'%(int(m.group(1))+15,m.group(2))
    return o
SEEDD=shift(seed)
NOW='2026-10-26T11:30'
for k in ('feedings','sleeps','diapers','temps','moods'):
    SEEDD[k]=[r for r in SEEDD[k] if (r.get('start') or r.get('time') or '')<NOW and (r.get('end') or '')<NOW]
SEED=json.dumps(dict(SEEDD,version=3),ensure_ascii=False)
LOG=[]
def page(b,dark=False,seeded=True,w=390,h=844,ios=True,touch=True):
    kw=dict(viewport={'width':w,'height':h},device_scale_factor=3,timezone_id='Asia/Shanghai',has_touch=touch,locale='zh-CN')
    if touch: kw['is_mobile']=True
    if ios: kw['user_agent']=IOS
    ctx=b.new_context(**kw)
    p=ctx.new_page(); p.errs=[]
    p.on('pageerror',lambda e:p.errs.append('PAGEERROR '+str(e)[:300]))
    p.on('console',lambda m:p.errs.append('CONSOLE.'+m.type+' '+m.text[:300]) if m.type in('error','warning') else None)
    p.goto(U); p.wait_for_timeout(600)
    if seeded: p.evaluate('t=>Storage.importJSON(t)',SEED)
    p.evaluate("()=>{const s=Storage.get();s.onboarded=true;s.settings.privacyAccepted=true;s.settings.onboardingDone=true;s.settings.stage=s.settings.stage||'baby';if(!s.settings.baby||!s.settings.baby.birthDate){s.settings.baby=Object.assign({},s.settings.baby||{},{birthDate:'2026-05-20',nickname:'豆豆',sex:'girl'})};s.settings.themeMode=%s;s.settings.theme=%s;Storage.save()}"%(("'dark'","'dark'") if dark else ("'light'","'light'")))
    p.reload(); p.wait_for_timeout(2600)
    p.evaluate("document.querySelectorAll('.ob-screen,#boot').forEach(e=>e.remove());document.body.classList.remove('ob-open');document.documentElement.classList.remove('is-booting')")
    return ctx,p
CHECK_JS=r"""()=>{
 const out=[]; const W=innerWidth,H=innerHeight;
 const se=document.scrollingElement; if(se.scrollWidth>W+1) out.push('HOVERFLOW doc scrollWidth='+se.scrollWidth);
 const vis=e=>{const r=e.getBoundingClientRect();const cs=getComputedStyle(e);return r.width>0&&r.height>0&&cs.visibility!='hidden'&&cs.display!='none'&&+cs.opacity>0.05};
 document.querySelectorAll('body *').forEach(e=>{
   if(!vis(e)) return; if(e.closest('.side-drawer,[hidden],[aria-hidden="true"],svg,canvas')) return;
   const r=e.getBoundingClientRect();
   if(e.children.length==0 && e.textContent.trim() && (r.right>W+1 || r.left<-1) && r.top<se.scrollHeight){
     const cs=getComputedStyle(e); let p=e.parentElement,clip=false; while(p){const pc=getComputedStyle(p); if(pc.overflowX!='visible'){clip=true;break} p=p.parentElement}
     if(!clip) out.push('OFFSCREEN_TEXT '+e.tagName+'.'+e.className+' "'+e.textContent.trim().slice(0,30)+'" L'+Math.round(r.left)+' R'+Math.round(r.right));
   }
   if(e.children.length==0 && e.textContent.trim()){
     const cs=getComputedStyle(e);
     if((cs.overflow=='hidden'||cs.overflowX=='hidden') && e.scrollWidth>e.clientWidth+2 && cs.textOverflow!='ellipsis') out.push('CLIPPED '+e.tagName+'.'+e.className+' "'+e.textContent.trim().slice(0,30)+'" '+e.scrollWidth+'>'+e.clientWidth);
   }
 });
 document.querySelectorAll('img').forEach(i=>{ if(vis(i)&&i.complete&&i.naturalWidth==0) out.push('BROKEN_IMG '+i.getAttribute('src')); });
 return out;}"""
def check(p): 
    try: return p.evaluate(CHECK_JS)
    except Exception as e: return ['CHECKFAIL '+str(e)[:100]]
def shot(p,name,full=False):
    f=f'{S}/{name}.png'; p.screenshot(path=f,full_page=full); return f
TAG=os.environ.get('TAG','after')
def launch(pw):
    return pw.webkit.launch() if os.environ.get('BR')=='wk' else pw.chromium.launch()
def shot(p,name,full=False):
    f=f'{S}/{name}_{TAG}{"_wk" if os.environ.get("BR")=="wk" else ""}.png'; p.screenshot(path=f,full_page=full); return f
