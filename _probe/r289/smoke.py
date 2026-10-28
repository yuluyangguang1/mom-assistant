import sys, json, os
sys.path.insert(0, 'tests')
os.environ.setdefault('X', '1')
import http.server, socketserver, threading, functools, pathlib
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path('.').resolve()
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Q, directory=str(ROOT)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = 'http://127.0.0.1:%d/index.html' % srv.server_address[1]
from seed_data import seed
SEED = json.dumps(dict(seed, version=3), ensure_ascii=False)
out = sys.argv[1] if len(sys.argv) > 1 else '/tmp/s289'
os.makedirs(out, exist_ok=True)
W = int(os.environ.get('W', 390)); FS = os.environ.get('FS')
with sync_playwright() as pw:
    b = pw.chromium.launch()
    for dark in (False, True):
        ctx = b.new_context(viewport={'width': W, 'height': 844}, has_touch=True, device_scale_factor=2)
        p = ctx.new_page(); errs = []
        p.on('pageerror', lambda e: errs.append(str(e)[:300]))
        p.on('console', lambda m: m.type == 'error' and errs.append('console:' + m.text[:200]))
        p.goto(URL); p.wait_for_timeout(600); p.evaluate('t=>Storage.importJSON(t)', SEED); p.reload(); p.wait_for_timeout(900)
        p.evaluate("(()=>{const s=Storage.get();s.settings.baby=s.settings.baby||{};s.settings.baby.birthDate=Util.addDays(Util.todayISO(),-80);s.settings.baby.name='小满';s.vaccines={done:{'bcg':Util.addDays(Util.todayISO(),-80),'hepb-1':Util.addDays(Util.todayISO(),-80)},notes:{'hepb-1':{at:'09:30',lot:'2026A01',maker:'某生物',site:'rua',clinic:'社区卫生服务中心'}}};Storage.save()})()")
        if FS: p.evaluate("v=>{const s=Storage.get();s.settings.fontScale=v;Storage.save()}", FS)
        p.evaluate("document.body.classList.toggle('dark',%s)" % ('true' if dark else 'false'))
        p.evaluate("App.showTab('vaccine',{noVT:true})"); p.wait_for_timeout(900)
        t = 'd' if dark else 'l'
        p.screenshot(path=f'{out}/page_{t}.png', full_page=True)
        p.evaluate("localStorage.setItem('yiya-vac-remind','cal');App.rerender()"); p.wait_for_timeout(400)
        p.screenshot(path=f'{out}/pagev_{t}.png')
        p.click('[data-vbopen]'); p.wait_for_timeout(700)
        p.screenshot(path=f'{out}/book_{t}.png')
        p.click('[data-vbnext]'); p.wait_for_timeout(500)
        p.screenshot(path=f'{out}/book2_{t}.png')
        p.click('[data-vbadd]'); p.wait_for_timeout(700)
        p.screenshot(path=f'{out}/add_{t}.png')
        print(t, errs, p.evaluate("[Modules.vaccine._book.idx(),Modules.vaccine._book.count(),history.length,JSON.stringify(history.state)]"))
        ctx.close()
    b.close()
