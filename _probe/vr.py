"""视觉回归：所有页面 × 浅/深色，全页截图，输出到 argv[1] 目录。"""
import functools, http.server, json, socketserver, sys, threading, datetime
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT/'tests'))
from seed_data import seed
OUT=Path(sys.argv[1]); OUT.mkdir(parents=True, exist_ok=True)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*a): pass
srv=socketserver.ThreadingTCPServer(('127.0.0.1',0),functools.partial(Q,directory=str(ROOT)))
threading.Thread(target=srv.serve_forever,daemon=True).start()
URL=f'http://127.0.0.1:{srv.server_address[1]}/index.html'
S=json.dumps(dict(seed,version=3),ensure_ascii=False)
PAGES=['home','calendar','settings','alltools','feeding','diaper','sleep','meds','mood','whitenoise','growth','vaccine','milestone','temp','period','finance','supplies','jaundice','bath','swim','sun','water','supplement','pregnancy','fetal','contraction','packing']
with sync_playwright() as pw:
    b=pw.chromium.launch()
    for theme in ('light','dark'):
        ctx=b.new_context(viewport={'width':393,'height':852},device_scale_factor=1,reduced_motion='reduce')
        p=ctx.new_page(); errs=[]; p.on('pageerror',lambda e:errs.append(str(e)[:200]))
        p.clock.install(time=datetime.datetime(2026,10,23,14,0,0))
        p.goto(URL); p.wait_for_timeout(500); p.evaluate('t=>Storage.importJSON(t)',S)
        p.evaluate("m=>{var d=Storage.get();d.settings.themeMode=m;d.settings.theme=m;Storage.save()}", theme)
        p.reload(); p.wait_for_timeout(900)
        for pg in PAGES:
            p.evaluate("id=>App.showTab(id,{noAnim:true})", pg); p.wait_for_timeout(500)
            p.evaluate("()=>{document.querySelectorAll('canvas').forEach(c=>c.style.visibility='hidden');scrollTo(0,0)}"); p.wait_for_timeout(100)
            p.screenshot(path=str(OUT/f'{theme}_{pg}.png'), full_page=True, animations='disabled', caret='hide')
        print(theme, 'errs', errs)
        ctx.close()
    b.close()
