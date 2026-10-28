"""第 275 次：dock 折射性能 / 内存。python perf.py <engine> <on|off>"""
import sys, json, functools, http.server, socketserver, threading
sys.path.insert(0, '/workspace/work/mom-assistant/tests')
from seed_data import seed
from playwright.sync_api import sync_playwright
ROOT = '/workspace/work/mom-assistant'; eng = sys.argv[1]; mode = sys.argv[2]; QL = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] != '-' else None
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Q, directory=ROOT)); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f'http://127.0.0.1:{srv.server_address[1]}/index.html'
SCROLL = """async (dur)=>{
  const st0=DockRefract._stats();const iv=[];let last=0,dir=1;const t0=performance.now();
  await new Promise(res=>{function f(t){if(last)iv.push(t-last);last=t;
    const max=document.documentElement.scrollHeight-innerHeight;let y=scrollY+dir*9;if(y>=max||y<=0)dir=-dir;window.scrollTo(0,y);
    if(t-t0<dur)requestAnimationFrame(f);else res();}requestAnimationFrame(f);});
  const st1=DockRefract._stats();iv.sort((a,b)=>a-b);
  const mean=iv.reduce((a,b)=>a+b,0)/iv.length;
  return {frames:iv.length,fps:Math.round(1000/mean*10)/10,p95:Math.round(iv[Math.floor(iv.length*.95)]*10)/10,
    janky:iv.filter(x=>x>25).length,draws:st1.draws-st0.draws,drawMs:st1.drawMs,rasters:st1.rasters-st0.rasters}
}"""
with sync_playwright() as pw:
    b = getattr(pw, eng).launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=3)
    p = ctx.new_page(); errs = []; p.on('pageerror', lambda e: errs.append(str(e)))
    p.goto(URL); p.wait_for_timeout(800); p.evaluate('t=>Storage.importJSON(t)', json.dumps(dict(seed, version=3), ensure_ascii=False))
    p.evaluate("v=>{Storage.get().settings.dockGlass=v;Storage.save();}", mode if mode in ('on', 'auto') else 'off')
    if eng == 'chromium' and mode in ('on', 'auto'): p.evaluate("localStorage.setItem('lgGlForce','1')")
    p.reload(); p.wait_for_timeout(2500)
    cdp = None
    if eng == 'chromium':
        cdp = ctx.new_cdp_session(p); cdp.send('Emulation.setCPUThrottlingRate', {'rate': 4}); cdp.send('Performance.enable')
    if QL is not None: p.evaluate('q=>DockRefract._q(q)', int(QL))
    out = {'eng': eng, 'q': QL, 'mode': mode, 'cpu': '4x' if cdp else '1x'}
    for tab in ([] if '--memonly' in sys.argv else ['home', 'feeding', 'whitenoise']):
        p.evaluate(f"App.showTab('{tab}')"); p.wait_for_timeout(2500)
        out['scroll_' + tab] = p.evaluate(SCROLL, 3000)
        out['raster_' + tab] = p.evaluate('DockRefract._stats().rasterMs'); out['q_' + tab] = p.evaluate('DockRefract._stats().quality')
    def mem():
        m = {}
        if cdp:
            cdp.send('HeapProfiler.enable'); cdp.send('HeapProfiler.collectGarbage')
            mm = {x['name']: x['value'] for x in cdp.send('Performance.getMetrics')['metrics']}
            m['heapMB'] = round(mm['JSHeapUsedSize'] / 1048576, 2); m['nodes'] = mm['Nodes']; m['listeners'] = mm['JSEventListeners']
        m['domEls'] = p.evaluate("document.getElementsByTagName('*').length")
        m['canvases'] = p.evaluate("document.getElementsByTagName('canvas').length")
        s = p.evaluate('DockRefract._stats()')
        m.update({k: s[k] for k in ('ctxLive', 'ctxCreated', 'texLive', 'texCreated', 'uploadsRealloc', 'uploadsSub', 'rasters', 'page', 'canvas')})
        return m
    if '--mem' not in sys.argv and '--memonly' not in sys.argv:
        print(json.dumps(out, ensure_ascii=False)); b.close(); sys.exit(0)
    tabs = ['home', 'feeding', 'diaper', 'sleep', 'home', 'whitenoise', 'settings', 'calendar', 'growth', 'search']
    for i in range(10): p.evaluate(f"App.showTab('{tabs[i % 10]}')"); p.wait_for_timeout(350)
    p.evaluate("App.showTab('home')"); p.wait_for_timeout(2500); out['mem_after10'] = mem()
    for i in range(50): p.evaluate(f"App.showTab('{tabs[i % 10]}')"); p.wait_for_timeout(350)
    p.evaluate("App.showTab('home')"); p.wait_for_timeout(2500); out['mem_after60'] = mem()
    if mode in ('on', 'auto') and ('--mem' in sys.argv or '--memonly' in sys.argv):
        # 关开关：应释放上下文 / 纹理 / 画布 / rAF
        p.evaluate("Storage.get().settings.dockGlass='off';Storage.save();LiquidDock.refresh()"); p.wait_for_timeout(500)
        out['mem_off'] = mem(); out['off_classes'] = p.evaluate("document.documentElement.className")
        p.evaluate("Storage.get().settings.dockGlass='on';Storage.save();DockRefract.reset();LiquidDock.refresh()"); p.wait_for_timeout(2500)
        out['mem_reon'] = mem()
    out['errs'] = errs[:5]
    print(json.dumps(out, ensure_ascii=False))
    b.close()
