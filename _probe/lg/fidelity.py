import sys, json, os, functools, http.server, socketserver, threading
sys.path.insert(0, '/workspace/work/mom-assistant/tests')
from seed_data import seed
from playwright.sync_api import sync_playwright
ROOT = '/workspace/work/mom-assistant'; eng = sys.argv[1] if len(sys.argv) > 1 else 'webkit'
pages = sys.argv[2].split(',') if len(sys.argv) > 2 else ['home:300', 'feeding:200', 'whitenoise:0']
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Q, directory=ROOT)); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f'http://127.0.0.1:{srv.server_address[1]}/index.html'
SEED = json.dumps(dict(seed, version=3), ensure_ascii=False)
HIDE = "document.documentElement.classList.add('lgdbg');"
STY = "html.lgdbg #tabbar > :not(canvas){visibility:hidden!important} html.lgdbg #tabbar{background:transparent!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important;box-shadow:none!important} html.lgdbg #tabbar::before,html.lgdbg #tabbar::after{display:none!important} html.lgtruth #tabbar{visibility:hidden!important}"
os.makedirs('/tmp/lg', exist_ok=True)
with sync_playwright() as pw:
    b = getattr(pw, eng).launch()
    p = b.new_page(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
    p.goto(URL); p.wait_for_timeout(800); p.evaluate('t=>Storage.importJSON(t)', SEED)
    if eng == 'chromium': p.evaluate("localStorage.setItem('lgGlForce','1')")
    p.evaluate("Storage.get().settings.dockGlass='on';Storage.save()")
    p.reload(); p.wait_for_timeout(2000); p.add_style_tag(content=STY)
    for spec in pages:
        tab, sy = spec.split(':')
        p.evaluate(f"App.showTab ? App.showTab('{tab}') : null"); p.wait_for_timeout(1200)
        if tab == 'whitenoise':
            p.evaluate("(()=>{const b=document.querySelector('.wn-card, [data-sound]');if(b)b.click();})()"); p.wait_for_timeout(1500)
        p.evaluate(f'window.scrollTo(0,{sy})'); p.wait_for_timeout(1500)
        st = p.evaluate('DockRefract._stats()')
        r = p.evaluate("(()=>{const r=document.getElementById('tabbar').getBoundingClientRect();return [r.left,r.top,r.width,r.height]})()")
        clip = {'x': r[0] - 10, 'y': r[1] - 10, 'width': r[2] + 20, 'height': r[3] + 20}
        p.screenshot(path=f'/tmp/lg/fid_{eng}_{tab}_normal.png', clip=clip)
        p.evaluate('DockRefract._draw()'); p.wait_for_timeout(150)
        p.screenshot(path=f'/tmp/lg/fid_{eng}_{tab}_normal2.png', clip=clip)
        print(p.evaluate("[scrollY, innerHeight, document.documentElement.scrollHeight, JSON.stringify(DockRefract._meta && DockRefract._meta())]"))
        p.evaluate("document.documentElement.classList.add('lgtruth')"); p.wait_for_timeout(100)
        p.screenshot(path=f'/tmp/lg/fid_{eng}_{tab}_truth.png', clip=clip)
        p.evaluate("document.documentElement.classList.remove('lgtruth');document.documentElement.classList.add('lgdbg');DockRefract._debug=true;DockRefract._draw()"); p.wait_for_timeout(150)
        p.screenshot(path=f'/tmp/lg/fid_{eng}_{tab}_raster.png', clip=clip)
        p.evaluate("document.documentElement.classList.remove('lgdbg');DockRefract._debug=false;DockRefract._draw()")
        print(tab, st['nodes'], st['rasterMs'], st['rasters'], st['page'])
    b.close()
