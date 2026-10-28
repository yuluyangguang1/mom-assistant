import sys
sys.path.insert(0, '/workspace/work/mom-assistant/tests')
import regression as R
from playwright.sync_api import sync_playwright
name = sys.argv[1] if len(sys.argv) > 1 else 'test_r284'
eng = sys.argv[2] if len(sys.argv) > 2 else 'webkit'
with sync_playwright() as pw:
    b = getattr(pw, eng).launch()
    try: getattr(R, name)(b)
    except Exception as e: R.check('run', False, repr(e)[:600])
    b.close()
f = [r for r in R.results if not r[1]]
for n, ok, d in R.results:
    if not ok: print('FAIL', n, str(d)[:700])
print(len(R.results) - len(f), '/', len(R.results))
