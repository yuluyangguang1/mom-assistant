import sys,re,functools,http.server,socketserver,threading
from h274 import *
import h274
VER={'v':None}
class SV(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*a): pass
    def do_GET(self):
        if self.path.split('?')[0].endswith('/sw.js'):
            body=open(R+'/sw.js',encoding='utf8').read()
            if VER['v']: body=re.sub(r"baoma-static-v\d+","baoma-static-"+VER['v'],body)
            body=body.encode()
            self.send_response(200); self.send_header('Content-Type','application/javascript'); self.send_header('Cache-Control','no-cache'); self.end_headers(); self.wfile.write(body); return
        return super().do_GET()
s2=socketserver.ThreadingTCPServer(('127.0.0.1',0),functools.partial(SV,directory=R)); threading.Thread(target=s2.serve_forever,daemon=True).start()
h274.U=f'http://127.0.0.1:{s2.server_address[1]}/index.html'
def L(*a): print(*a,flush=True)
CASE=sys.argv[1] if len(sys.argv)>1 else 'sleepfull'
with sync_playwright() as pw:
  b=launch(pw); c,p=h274.page(b); G=p.evaluate
  p.wait_for_function("navigator.serviceWorker.controller!==null",timeout=15000)
  if CASE in('sleepfull','sleepdock'):
    G("App.showTab('sleep')"); p.wait_for_timeout(700)
    G("[...document.querySelectorAll('#view button')].find(x=>/开始睡眠/.test(x.textContent)).click()"); p.wait_for_timeout(700)
    if CASE=='sleepdock': G("document.querySelector('.ftf-sleep [data-f=down]').click()"); p.wait_for_timeout(400)
  elif CASE=='settings':
    G("App.showTab('settings')"); p.wait_for_timeout(700)
    G("document.querySelectorAll('#view .set-group summary')[1].click()"); p.wait_for_timeout(400)
  elif CASE=='water':
    G("App.showTab('water')"); p.wait_for_timeout(700)
  L('before', G("({tab:App.currentTab(),ftf:document.querySelectorAll('body>.ftf').length,sub:App.inSub&&App.inSub(),h:document.querySelector('#view h1')&&document.querySelector('#view h1').textContent, hl:history.length})"))
  print('busy?',G("({ae:document.activeElement&&document.activeElement.outerHTML.slice(0,160),mr:document.getElementById('modalRoot').children.length})"))
  G("window.__mark=1")
  VER['v']='v999'
  G("navigator.serviceWorker.getRegistration().then(r=>r.update())")
  p.wait_for_timeout(int(os.environ.get("WAIT","5500")))
  if os.environ.get('HIDE'):
    try: G("(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>'hidden'});document.dispatchEvent(new Event('visibilitychange'))})()")
    except Exception as e: print('hide->nav',str(e)[:60])
    p.wait_for_timeout(2500)
  L('reloaded', G("window.__mark===undefined"), G("caches.keys()"))
  L('after', G("({tab:App.currentTab(),ftf:document.querySelectorAll('body>.ftf').length,sub:App.inSub&&App.inSub(),h:document.querySelector('#view h1')&&document.querySelector('#view h1').textContent,state:JSON.stringify(history.state),hl:history.length,openSleep:!!Storage.get().openSleep})"))
  shot(p,'25_'+CASE)
  G("history.back()"); p.wait_for_timeout(900)
  L('after back', G("({tab:App.currentTab(),ftf:document.querySelectorAll('body>.ftf').length,sub:App.inSub&&App.inSub()})"))
  G("history.back()"); p.wait_for_timeout(900)
  L('after back2', G("({tab:App.currentTab(),ftf:document.querySelectorAll('body>.ftf').length})"))
  L('ERRS',[e for e in p.errs if 'willRead' not in e][:5])
