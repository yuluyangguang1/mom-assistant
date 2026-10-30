# 用法：python3 reg_noworker.py tests/regression.py --only test_xxx
# 给每个浏览器上下文注入 window.__lgNoWorker=1，强制原型走主线程退回实现（验证退回路径与 890721d 等价）
import sys, runpy
from playwright.sync_api._generated import Browser
INIT = "window.__lgNoWorker=1;"
_nc, _np = Browser.new_context, Browser.new_page
def nc(self, *a, **k):
    c = _nc(self, *a, **k); c.add_init_script(INIT); return c
def np_(self, *a, **k):
    p = _np(self, *a, **k); p.context.add_init_script(INIT); return p
Browser.new_context, Browser.new_page = nc, np_
script = sys.argv[1]; sys.argv = sys.argv[1:]
runpy.run_path(script, run_name='__main__')
