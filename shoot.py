import json, http.server, socketserver, threading, functools, sys
from pathlib import Path
from playwright.sync_api import sync_playwright
root = Path(__file__).parent
out = Path('/workspace/work/mom/review'); out.mkdir(parents=True, exist_ok=True)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *x): pass
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Q, directory=str(root))); port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()

def T(d, hm): return f'2026-10-{d:02d}T{hm}'
feed = []; sleeps = []; diapers = []
import random; random.seed(3)
for d in range(5, 12):
    for hm in ['01:10', '04:30', '07:40', '10:50', '14:05', '17:20', '20:30']:
        if d == 11 and hm > '15:00': continue
        typ = random.choice(['breast', 'breast', 'bottle'])
        r = {'id': f'f{d}{hm}', 'type': typ, 'start': T(d, hm), 'durationMin': None, 'durationL': None, 'durationR': None, 'amount': None, 'amountBm': None, 'amountFm': None, 'side': None, 'note': None, 'newFood': None, 'dish': None, 'ing': None, 'steps': None}
        if typ == 'breast': r['durationL'] = random.choice([8, 10, 12]); r['durationR'] = random.choice([7, 9, 11]); r['durationMin'] = r['durationL'] + r['durationR']
        else: r['amount'] = random.choice([120, 140, 150]); r['amountBm'] = r['amount']
        feed.append(r)
    for a, b in [('21:30', '23:50'), ('00:20', '04:10'), ('04:50', '07:20'), ('09:30', '10:40'), ('13:00', '14:20'), ('16:30', '17:10')]:
        if d == 11 and a > '15:00': continue
        sleeps.append({'id': f's{d}{a}', 'start': T(d, a) + ':00', 'end': T(d, b) + ':00', 'pausedMs': 0, 'note': None, 'wakings': 0, 'longestMin': None})
    for hm in ['02:00', '06:30', '09:10', '12:40', '16:00', '19:30']:
        if d == 11 and hm > '15:00': continue
        diapers.append({'id': f'd{d}{hm}', 'type': random.choice(['wet', 'wet', 'dirty', 'both']), 'time': T(d, hm), 'note': None})
growth = [{'id': 'g1', 'date': '2026-05-20', 'weightKg': 3.3, 'heightCm': 50, 'headCm': 34}, {'id': 'g2', 'date': '2026-06-20', 'weightKg': 4.4, 'heightCm': 54.5, 'headCm': 37},
          {'id': 'g3', 'date': '2026-07-20', 'weightKg': 5.5, 'heightCm': 58, 'headCm': 39}, {'id': 'g4', 'date': '2026-08-20', 'weightKg': 6.3, 'heightCm': 61, 'headCm': 40.5}, {'id': 'g5', 'date': '2026-09-20', 'weightKg': 6.9, 'heightCm': 63.5, 'headCm': 41.5}]
temps = [{'id': 't1', 'time': T(10, '20:10'), 'value': 36.8, 'note': None}, {'id': 't2', 'time': T(11, '08:00'), 'value': 36.6, 'note': None}]
moods = [{'id': 'm1', 'time': T(11, '09:00'), 'level': 4, 'note': None, 'tags': []}]
seed = {'settings': {'privacyAccepted': True, 'onboardingDone': True, 'stage': 'baby', 'theme': 'light', 'themeAuto': False, 'caregiver': {'role': 'mom', 'name': '豆豆妈'},
                     'baby': {'sex': 'girl', 'birthDate': '2026-05-20', 'preterm': False, 'birthGestWeeks': 40, 'nickname': '豆豆'}, 'remindersEnabled': False},
        'feedings': feed, 'sleeps': sleeps, 'diapers': diapers, 'growth': growth, 'temps': temps, 'moods': moods}
DARK = len(sys.argv) > 1 and sys.argv[1] == 'dark'
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, locale='zh-CN', timezone_id='Asia/Shanghai', is_mobile=True, has_touch=True)
    ctx.add_init_script(f"""(()=>{{ if(!localStorage.getItem('seeded')){{ const base = {json.dumps(seed, ensure_ascii=False)};
      localStorage.setItem('momhelper_data_v1', JSON.stringify(Object.assign({{version:3}}, base))); localStorage.setItem('seeded','1'); }}
      const _D = Date; const fixed = new _D('2026-10-11T15:20:00+08:00').getTime(); const off = fixed - _D.now();
      class D extends _D {{ constructor(...a){{ if(a.length===0) super(_D.now()+off); else super(...a); }} static now(){{ return _D.now()+off; }} }} window.Date = D; }})();""")
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(f'http://127.0.0.1:{port}/index.html')
    css = "".join(f"@font-face{{font-family:'NSC';src:url('_fonts/NotoSansSC-{w}.woff');font-weight:{r};}}" for w, r in [(500, '100 550'), (700, '551 750'), (900, '751 1000')])
    pg.add_style_tag(content=css + "*{font-family:'NSC',sans-serif !important}")
    pg.evaluate("document.fonts.load('16px NSC')"); pg.wait_for_timeout(3000)
    def shot(name, tab=None, wait=1200, scroll=0):
        if tab: pg.evaluate(f"App.showTab('{tab}')"); 
        pg.wait_for_timeout(wait)
        if scroll: pg.evaluate(f"window.scrollTo(0,{scroll}); document.querySelectorAll('*').forEach(e=>{{if(e.scrollHeight>e.clientHeight+50 && getComputedStyle(e).overflowY!='visible') e.scrollTop={scroll};}})"); pg.wait_for_timeout(500)
        pg.screenshot(path=str(out / f'{name}.png'))
    if DARK: pg.evaluate("App.setTheme('dark')"); pg.wait_for_timeout(800)
    sfx = '_dark' if DARK else ''
    for tab in ['home', 'feeding', 'sleep', 'diaper', 'growth', 'whitenoise', 'vaccine', 'milestone', 'mood', 'finance', 'alltools', 'settings', 'calendar', 'temp', 'supplies']:
        try: shot(tab + sfx, tab)
        except Exception as e: print('fail', tab, e)
    try: shot('home_scroll' + sfx, 'home', scroll=700)
    except Exception as e: print(e)
    pg.evaluate("App.setStage('pregnancy')")
    for tab in ['pregnancy', 'fetal', 'contraction', 'packing']:
        try: shot(tab + sfx, tab)
        except Exception as e: print('fail', tab, e)
    print('errs', errs[:5])
    b.close()
srv.shutdown()
