# 用 WebKit 跑 test_r279（不提交）
import sys; sys.path.insert(0, '/workspace/work/mom-assistant/tests')
import regression as R
from playwright.sync_api import sync_playwright
with sync_playwright() as pw:
    b = pw.webkit.launch(); R.test_r279(b); b.close()
for n, ok, d in R.results: print(('PASS ' if ok else 'FAIL ') + n + ('' if ok else '  ← ' + str(d)))
print(sum(1 for r in R.results if r[1]), '/', len(R.results))
