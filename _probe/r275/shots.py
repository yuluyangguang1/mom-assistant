"""第 275 次 dock 前后对比截图（WebKit = iOS 路径，iPhone UA，390×844 @2x）。python shots.py <root> <label>"""
import sys, json, functools, http.server, socketserver, threading, os
sys.path.insert(0, '/workspace/work/mom-assistant/tests')
from seed_data import seed
from playwright.sync_api import sync_playwright
ROOT, LABEL = sys.argv[1], sys.argv[2]; ENG = sys.argv[3] if len(sys.argv) > 3 else 'webkit'
OUT = '/workspace/work/mom-assistant/_probe/r275/shots'; os.makedirs(OUT, exist_ok=True)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Q, directory=ROOT)); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f'http://127.0.0.1:{srv.server_address[1]}/index.html'
UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
PAGES = [('home', 340), ('feeding', 330), ('whitenoise', 0)]
with sync_playwright() as pw:
    b = getattr(pw, ENG).launch()
    for theme in ('light', 'dark'):
        for hand in ('normal', 'left', 'right'):
            ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, user_agent=UA)
            p = ctx.new_page(); p.goto(URL); p.wait_for_timeout(600)
            p.evaluate('t=>Storage.importJSON(t)', json.dumps(dict(seed, version=3), ensure_ascii=False))
            p.evaluate("([t,h])=>{const s=Storage.get().settings;s.theme=t;s.themeAuto=false;s.handMode=h;s.dockGlass='on';Storage.save()}", [theme, hand])
            p.reload(); p.wait_for_timeout(2200)
            for tab, sy in PAGES:
                p.evaluate(f"App.showTab('{tab}',{{noVT:true}})"); p.wait_for_timeout(1500)
                if tab == 'whitenoise':
                    p.evaluate("(()=>{const c=document.querySelector('.wn-art');if(c)c.click();})()"); p.wait_for_timeout(1200)
                p.evaluate(f'window.scrollTo(0,{sy})'); p.wait_for_timeout(2600)
                r = p.evaluate("(()=>{const r=document.getElementById('tabbar').getBoundingClientRect();return [r.left,r.top,r.width,r.height]})()")
                name = f'{ENG}_{LABEL}_{theme}_{hand}_{tab}'
                if hand == 'normal':
                    clip = {'x': 0, 'y': max(0, r[1] - 120), 'width': 390, 'height': 844 - max(0, r[1] - 120)}
                else:
                    clip = {'x': max(0, r[0] - 16), 'y': max(0, r[1] - 16), 'width': min(390, r[2] + 120), 'height': r[3] + 32}
                p.screenshot(path=f'{OUT}/{name}.png', clip=clip)
            st = p.evaluate("window.DockRefract?JSON.stringify(DockRefract._stats()):'n/a'")
            print(LABEL, theme, hand, st[:160], flush=True)
            ctx.close()
    b.close()
