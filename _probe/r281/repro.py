# 第 281 次：营养品「保存一个出来 x2」复现（WebKit iPhone 视口，真 tap）。不提交。
import sys, json
sys.path.insert(0, '/workspace/work/mom-assistant/tests')
import regression as R
from playwright.sync_api import sync_playwright
fails = []
def ok(n, c, d=''):
    print(('PASS ' if c else 'FAIL ') + n + ('' if c else '  ← ' + json.dumps(d, ensure_ascii=False)))
    if not c: fails.append(n)
with sync_playwright() as pw:
    br = pw.webkit.launch()
    ctx = br.new_context(viewport={'width': 393, 'height': 852}, has_touch=True, device_scale_factor=2, color_scheme='light')
    p = ctx.new_page(); errs = []
    p.on('pageerror', lambda e: errs.append(str(e)[:200]))
    p.goto(R.URL); p.wait_for_timeout(700); p.evaluate('t=>Storage.importJSON(t)', R.SEED_V3); p.reload(); p.wait_for_timeout(1200)
    ev = p.evaluate
    def clear():
        ev("(()=>{const d=Storage.get();d.supplementPlans=[];d.supplements=[];d.settings.stage='pregnancy';Storage.save();localStorage.removeItem('yiya-sup-remind')})()")
        ev("App.showTab('supplement',{noVT:true})"); p.wait_for_timeout(400)
    def tap(sel, wait=220):
        loc = p.locator(sel).first
        loc.scroll_into_view_if_needed(); loc.tap(); p.wait_for_timeout(wait)
    def n(): return ev("(Storage.get().supplementPlans||[]).length")
    def wizard(preset=True, name='叶酸', dbl=False):
        tap('[data-spadd]', 500)
        if preset:
            p.locator('#spwPreset').select_option('m-fa'); p.wait_for_timeout(200)
        else:
            p.locator('#spwName').fill(name); p.wait_for_timeout(100); tap('[data-form="片剂"]')
        for _ in range(5): tap('[data-next]')
        p.wait_for_timeout(250)
        if dbl:
            ev("(()=>{const b=document.querySelector('[data-next]');const r=b.getBoundingClientRect();window.__xy=[r.x+r.width/2,r.y+r.height/2]})()")
            xy = ev("window.__xy")
            p.touchscreen.tap(*xy); p.touchscreen.tap(*xy); p.wait_for_timeout(600)
        else:
            tap('[data-next]', 600)
    clear(); wizard(); ok('预设路径首次打开保存一次 = 1 条', n() == 1, n())
    clear(); tap('[data-spadd]', 500); tap('.rs-head [data-x]', 500); wizard(); ok('关掉再开保存一次 = 1 条', n() == 1, n())
    clear()
    for _ in range(3): tap('[data-spadd]', 500); tap('.rs-head [data-x]', 500)
    wizard(); ok('开关 3 次后保存一次 = 1 条', n() == 1, n())
    clear(); wizard(dbl=True); ok('快速双击保存 = 1 条', n() == 1, n())
    clear(); ev("Sheet.closeAll()"); p.wait_for_timeout(400); wizard(preset=False, name='鱼油'); ok('自定义路径保存一次 = 1 条', n() == 1, n())
    # 同名
    wizard(preset=False, name='鱼油'); ok('同名再加：拦下不新增', n() == 1, [n(), ev("(document.querySelector('.spw-of')||{}).textContent")])
    ev("Sheet.closeAll()"); p.wait_for_timeout(400)
    ok('无 pageerror', not errs, errs)
    br.close()
print('FAILS', len(fails))
