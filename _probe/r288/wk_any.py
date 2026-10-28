import sys
sys.path.insert(0, '/workspace/work/mom-assistant/tests')
import regression as R
from playwright.sync_api import sync_playwright
with sync_playwright() as pw:
    b = pw.webkit.launch()
    for n in sys.argv[1].split(','):
        try: getattr(R, n)(b)
        except Exception as e: R.check(n + ' run', False, repr(e)[:300])
    b.close()
f = [r for r in R.results if not r[1]]
for n, ok, d in R.results:
    if not ok: print('FAIL', n, str(d)[:300])
print(len(R.results) - len(f), '/', len(R.results))
