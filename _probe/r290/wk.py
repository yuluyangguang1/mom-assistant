import sys
sys.path.insert(0, '/workspace/work/mom-assistant/tests')
import regression as R
from playwright.sync_api import sync_playwright
names = sys.argv[1].split(',')
with sync_playwright() as pw:
    b = pw.webkit.launch()
    for n in names:
        s0 = len(R.results)
        try: getattr(R, n)(b)
        except Exception as e: R.check(n + ' run', False, repr(e)[:300])
        rs = R.results[s0:]
        print(n, sum(1 for r in rs if r[1]), '/', len(rs))
        for nm, ok, d in rs:
            if not ok: print('  FAIL', nm, str(d)[:400])
    b.close()
