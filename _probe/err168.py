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
with sync_playwright() as pw:
    b=pw.chromium.launch(); p=b.new_page(viewport={'width':393,'height':852})
    errs=[]; p.on('pageerror',lambda e:errs.append(str(e)[:300])); p.on('console',lambda m: m.type=='error' and errs.append(m.text[:300]))
    p.goto(URL); p.wait_for_timeout(600); p.evaluate('t=>Storage.importJSON(t)',S); p.reload(); p.wait_for_timeout(900)
    print(errs, p.evaluate("document.querySelectorAll('.record-tile,.hn-q').length"))
    ids=lambda: p.evaluate("[...document.querySelectorAll('.record-grid [data-go], .record-grid .card, .record-grid [data-id]')].map(e=>e.dataset.go||e.dataset.id||e.className).join(',')")
    print('auto', ids())
    p.evaluate("Modules.home._edit=true;App.rerender()"); p.wait_for_timeout(400); print('edit', ids())
    p.evaluate("Modules.home._editSize('feeding')"); p.wait_for_timeout(300)
    p.evaluate("Modules.home._edit=false;App.rerender()"); p.wait_for_timeout(400); print('after', ids()); print(p.evaluate("JSON.stringify(Storage.get().settings.homeLayout)"))
    print(errs)
    b.close()
