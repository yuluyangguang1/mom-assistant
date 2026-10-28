import sys, json, threading, http.server, functools, os
sys.path.insert(0, '/workspace/work/mom-assistant/tests')
os.chdir('/workspace/work/mom-assistant')
from playwright.sync_api import sync_playwright
from seed_data import seed
SEED=json.dumps(dict(seed,version=3),ensure_ascii=False)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8791), functools.partial(Q, directory='/workspace/work/mom-assistant'))
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL='http://127.0.0.1:8791/index.html'
W=int(sys.argv[1]) if len(sys.argv)>1 else 390
FS=sys.argv[2] if len(sys.argv)>2 else 'normal'
with sync_playwright() as pw:
    b=pw.chromium.launch()
    for dark in (False, True):
        ctx=b.new_context(viewport={'width':W,'height':844 if W>330 else 640}, device_scale_factor=2, has_touch=True, color_scheme='dark' if dark else 'light')
        p=ctx.new_page(); errs=[]
        p.on('pageerror', lambda e: errs.append(str(e)[:200]))
        p.on('console', lambda m: errs.append('C:'+m.text[:200]) if m.type=='error' else None)
        p.goto(URL); p.wait_for_timeout(700)
        p.evaluate('t=>Storage.importJSON(t)', SEED)
        if dark: p.evaluate("(()=>{const s=Storage.get().settings;s.themeMode='dark';Storage.save()})()")
        p.reload(); p.wait_for_timeout(1200)
        p.evaluate(f"()=>{{App.setFontScale && App.setFontScale('{FS}')}}")
        p.wait_for_timeout(300)
        p.evaluate("document.getElementById('avatarBtn').click()"); p.wait_for_timeout(700)
        info=p.evaluate("""(()=>{const l=document.getElementById('qdActions');const r=l.getBoundingClientRect();
          const bad=[...l.querySelectorAll('.qm-n')].filter(e=>e.scrollWidth>e.clientWidth+1||e.getClientRects().length>1||e.getBoundingClientRect().height>30).map(e=>e.textContent);
          return {open:App.menuOpen(), r:[r.left,r.top,r.width,r.height], hs:JSON.stringify(history.state), bad, n:l.querySelectorAll('[data-qm-go]').length, cols:getComputedStyle(l.querySelector('.qm-grid')).gridTemplateColumns}})()""")
        print(dark, info, errs)
        p.screenshot(path=f'/tmp/r290_{W}_{FS}_{"d" if dark else "l"}.png')
        ctx.close()
    b.close()
