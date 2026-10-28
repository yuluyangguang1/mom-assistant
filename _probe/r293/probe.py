import sys, os, io
sys.argv = ['x']; sys.path.insert(0, 'tests')
src = open('tests/regression.py').read().split("\nif __name__")[0]
__file__ = os.path.abspath('tests/regression.py'); exec(compile(src, __file__, 'exec'))
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw, ImageFont
OUT = '/workspace/work/fix293/'; os.makedirs(OUT, exist_ok=True)
F = ImageFont.truetype(os.path.expanduser('~/.fonts/nsc.otf'), 18)
SC = {
 'A': "(()=>{Storage.addBaby({name:'二宝',nickname:'糖糖',birthDate:'2026-10-01',sex:'boy'});App.rerender()})()",
 'B': "(()=>{const s=Storage.get();s.pregnancy.lmp=Util.addDays(Util.todayISO(),-140);s.settings.stage=null;Storage.save();App.rerender()})()",
}
def shot(p): return Image.open(io.BytesIO(p.screenshot()))
with sync_playwright() as pw:
    b = pw.chromium.launch()
    for k, js in SC.items():
        ctx = b.new_context(viewport={'width': int(os.environ.get('W','390')), 'height': 844}, has_touch=True)
        p = ctx.new_page(); p.goto(URL); p.wait_for_timeout(600); p.evaluate('t=>Storage.importJSON(t)', SEED_V3); p.reload(); p.wait_for_timeout(1000)
        ev = p.evaluate; ev("document.body.classList.remove('is-night')")
        if os.environ.get('DARK'): ev("document.body.classList.add('dark')")
        ev(js); p.wait_for_timeout(600)
        fr = []
        ev("App.showTab('home',{noVT:true});scrollTo(0,0)"); p.wait_for_timeout(700); fr.append((shot(p), '首页'))
        ev("scrollTo(0,700)"); p.wait_for_timeout(400); fr.append((shot(p), '首页下'))
        ev("scrollTo(0,0);App.openMenu()"); p.wait_for_timeout(700); fr.append((shot(p), '菜单'))
        ev("App.closeMenu(true)"); p.wait_for_timeout(500)
        ev("document.querySelector('.tabbar [data-qd-toggle]').click()"); p.wait_for_timeout(700); fr.append((shot(p), '＋'))
        ev("App._qdClose&&App._qdClose(true)"); p.wait_for_timeout(400)
        ev("App._openBabySheet()"); p.wait_for_timeout(700); fr.append((shot(p), '切换面板'))
        ev("Sheet.closeAll()"); p.wait_for_timeout(400)
        ev("App.showTab('calendar',{noVT:true})"); p.wait_for_timeout(800); fr.append((shot(p), '日期页'))
        ev("App.showTab('settings',{noVT:true})"); p.wait_for_timeout(800); fr.append((shot(p), '设置'))
        print(k, ev("JSON.stringify({stage:App.stageOf(Storage.get()),babies:Storage.get().babies.map(b=>b.name),act:Storage.get().settings.activeBabyId})"))
        sc = .55; w, h = int(390*sc), int(844*sc)
        im = Image.new('RGB', (len(fr)*(w+10)+10, h+40), '#EEE'); d = ImageDraw.Draw(im)
        for i, (f, l) in enumerate(fr):
            im.paste(f.resize((w, h)), (10+i*(w+10), 30)); d.text((10+i*(w+10), 4), l, fill='#333', font=F)
        im.save(OUT + 'probe_%s%s.png' % (k, os.environ.get('TAG','')))
        ctx.close()
