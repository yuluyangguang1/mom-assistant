import functools, http.server, json, socketserver, sys, threading
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
OUT=Path('/workspace/work/icon-drafts')
with sync_playwright() as pw:
    b=pw.chromium.launch()
    p=b.new_page(viewport={'width':393,'height':852},device_scale_factor=2)
    p.goto(URL); p.wait_for_timeout(600); p.evaluate('t=>Storage.importJSON(t)',S); p.reload(); p.wait_for_timeout(800)
    p.add_style_tag(content=':root{--sat:59px !important;--sat-standalone:1 !important}')
    p.evaluate("document.documentElement.style.setProperty('--sat-standalone','1')")
    p.wait_for_timeout(500)
    p.screenshot(path=str(OUT/'p_home.png'))
    info=p.evaluate("""(()=>{const h=document.querySelector('.app-header').getBoundingClientRect();const s=document.querySelector('.home-sky').getBoundingClientRect();const v=document.getElementById('view');return {hdr:[h.top,h.bottom],sky:[s.top,s.bottom],viewPad:getComputedStyle(v).paddingTop,scrollY:scrollY}})()""")
    print(info)
    p.evaluate("App.showTab('feeding')"); p.wait_for_timeout(800)
    p.screenshot(path=str(OUT/'p_feed.png'))
    print(p.evaluate("(()=>{const d=document.getElementById('modDate');return [d.textContent,getComputedStyle(d).display]})()"))
    for how in ["App.showTab('home')","history.back()"]:
        p.evaluate("App.showTab('alltools')"); p.wait_for_timeout(900)
        p.mouse.wheel(0,400); p.wait_for_timeout(400)
        p.evaluate(how); p.wait_for_timeout(1200)
        print(how, p.evaluate("(()=>{const h=document.querySelector('.app-header');return [h.className,getComputedStyle(h).backgroundImage.slice(0,80),h.getAttribute('style'),scrollY,document.body.className]})()"))
        p.screenshot(path=str(OUT/('p_back_%d.png'%len(how))))
    b.close()
