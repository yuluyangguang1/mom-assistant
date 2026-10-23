"""第 171 次：抓取 28 页 × 浅/深 × 393/1024 下每个元素的全部计算样式，供 CSS 重构前后对比。
用法：python3 tests/computed_snap.py out.json；再用 tests/computed_diff.py a.json b.json 比较。"""
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
JS="""()=>{const o=[];const all=[document.documentElement,...document.querySelectorAll('body, body *')];
for(const e of all){if(e.closest('svg')&&e.tagName!=='svg')continue;const cs=getComputedStyle(e);let s='';for(let i=0;i<cs.length;i++){const k=cs[i];s+=k+':'+cs.getPropertyValue(k)+';'}
o.push([e.tagName+'#'+e.id+'.'+(e.getAttribute('class')||''),s])}return o}"""
out={}
with sync_playwright() as pw:
    b=pw.chromium.launch()
    for theme in ('light','dark'):
      for w in (393,1024):
        p=b.new_page(viewport={'width':w,'height':852},reduced_motion='reduce')
        p.add_init_script("Date.now=()=>1761206400000;")
        p.goto(URL); p.wait_for_timeout(300); p.evaluate('t=>Storage.importJSON(t)',S); p.reload(); p.wait_for_timeout(500)
        if theme=='dark': p.evaluate("document.body.classList.add('dark')")
        extra=[('quickdock',"document.getElementById('qdFab').click()")]
        for pg in PAGES:
            p.evaluate("id=>App.showTab(id,{noAnim:true})",pg); p.wait_for_timeout(120)
            if theme=='dark': p.evaluate("document.body.classList.add('dark')")
            out[f'{theme}-{w}-{pg}']=p.evaluate(JS)
        p.evaluate("App.showTab('home',{noAnim:true})"); p.wait_for_timeout(100)
        p.evaluate("document.getElementById('qdFab').click()"); p.wait_for_timeout(300)
        out[f'{theme}-{w}-dock']=p.evaluate(JS)
        p.close()
    b.close()
json.dump(out,open(sys.argv[1],'w'))
print('pages',len(out),'els',sum(len(v) for v in out.values()))
