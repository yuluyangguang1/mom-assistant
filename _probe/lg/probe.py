import sys, json, os, functools, http.server, socketserver, threading
sys.path.insert(0, '/workspace/work/mom-assistant/tests')
from seed_data import seed
from playwright.sync_api import sync_playwright
ROOT = sys.argv[1] if len(sys.argv) > 1 else '/workspace/work/mom-assistant'
eng = sys.argv[2] if len(sys.argv) > 2 else 'webkit'
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Q, directory=ROOT)); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f'http://127.0.0.1:{srv.server_address[1]}/index.html'
SEED = json.dumps(dict(seed, version=3), ensure_ascii=False)
with sync_playwright() as pw:
    b = getattr(pw, eng).launch()
    p = b.new_page(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
    errs = []; p.on('pageerror', lambda e: errs.append(str(e))); p.on('console', lambda m: errs.append('console:' + m.text) if m.type == 'error' else None)
    p.goto(URL); p.wait_for_timeout(800)
    p.evaluate('t=>Storage.importJSON(t)', SEED)
    if eng == 'chromium': p.evaluate("localStorage.setItem('lgGlForce','1')")
    p.reload(); p.wait_for_timeout(2500)
    print(json.dumps(p.evaluate('DockRefract._stats()')))
    p.evaluate('window.scrollTo(0,400)'); p.wait_for_timeout(500)
    r = p.evaluate("(()=>{const r=document.getElementById('tabbar').getBoundingClientRect();return [r.left,r.top,r.width,r.height]})()")
    os.makedirs('/tmp/lg', exist_ok=True)
    p.screenshot(path=f'/tmp/lg/dock_{eng}.png', clip={'x': r[0]-20, 'y': r[1]-30, 'width': r[2]+40, 'height': r[3]+50})
    p.screenshot(path=f'/tmp/lg/full_{eng}.png')
    print(json.dumps(p.evaluate('DockRefract._stats()')), errs[:5])
    b.close()
