import sys, os
sys.argv = ['x']; sys.path.insert(0, 'tests')
src = open('tests/regression.py').read().split("\nif __name__")[0]
__file__ = os.path.abspath('tests/regression.py'); exec(compile(src, os.path.abspath('tests/regression.py'), 'exec'))
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw, ImageFont
OUT = '/workspace/work/fix292/'
font = ImageFont.truetype(os.path.expanduser('~/.fonts/nscb.otf'), 22)
def strip(frames, labels, title):
    import io; frames = [Image.open(io.BytesIO(f)) for f in frames]; w, h = frames[0].size; sc = 0.6
    fr = [f.resize((int(w*sc), int(h*sc))) for f in frames]
    W = sum(f.size[0] for f in fr) + 16*(len(fr)+1); H = fr[0].size[1] + 90
    im = Image.new('RGB', (W, H), '#EEE7DE'); d = ImageDraw.Draw(im)
    d.text((16, 10), title, fill='#333', font=font); x = 16
    for f, l in zip(fr, labels):
        im.paste(f, (x, 50)); d.text((x, 50 + f.size[1] + 6), l, fill='#555', font=ImageFont.truetype(os.path.expanduser('~/.fonts/nsc.otf'), 18)); x += f.size[0] + 16
    return im
rows = []
with sync_playwright() as pw:
    b = pw.chromium.launch()
    for dark in (False, True):
        ctx = b.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, device_scale_factor=1)
        p = ctx.new_page(); p.goto(URL); p.wait_for_timeout(600); p.evaluate('t=>Storage.importJSON(t)', SEED_V3); p.reload(); p.wait_for_timeout(1000)
        if dark: p.evaluate("App.setTheme?App.setTheme('dark'):document.body.classList.add('dark')"); p.wait_for_timeout(300)
        p.evaluate("document.body.classList.remove('is-night');App.showTab('diaper',{noVT:true})"); p.wait_for_timeout(400)
        p.evaluate("document.querySelector('[data-new]').click()"); p.wait_for_timeout(700)
        gy = p.evaluate("Math.round(document.querySelector('#modalRoot .sheet-grab').getBoundingClientRect().top)+10")
        fr = [p.screenshot()]; lb = ['打开']
        p.evaluate(TOUCH2_JS, [195, gy, 195, gy + 160, 'none', 8, 16]); p.wait_for_timeout(160); fr.append(p.screenshot()); lb.append('跟手下拉 160px（停住）')
        p.evaluate("(()=>{const t=document.elementFromPoint(195,%d+160)||document.body;const e=new TouchEvent('touchend',{bubbles:true,cancelable:true,touches:[],changedTouches:[]});document.querySelector('#modalRoot .is-sheet').dispatchEvent(e)})()" % gy)
        p.wait_for_timeout(60); fr.append(p.screenshot()); lb.append('松手 60ms：弹簧弹回中')
        p.wait_for_timeout(500); fr.append(p.screenshot()); lb.append('落定')
        p.evaluate(TOUCH2_JS, [195, gy, 195, gy + 70, 1, 6, 10]); p.wait_for_timeout(50); fr.append(p.screenshot()); lb.append('快甩 70px：带速度推出去')
        p.wait_for_timeout(600); fr.append(p.screenshot()); lb.append('关掉')
        rows.append(strip(fr, lb, '第 292 次 · 半屏面板下拉（%s）' % ('深色' if dark else '浅色')))
        # 菜单
        p.evaluate("App.showTab('home',{noVT:true})"); p.wait_for_timeout(400); p.evaluate("App.openMenu()"); p.wait_for_timeout(700)
        my = p.evaluate("Math.round(document.getElementById('qdActions').getBoundingClientRect().top)+12")
        fr = [p.screenshot()]; lb = ['菜单打开']
        p.evaluate(TOUCH2_JS, [195, my, 195, my + 140, 'none', 8, 16]); p.wait_for_timeout(160); fr.append(p.screenshot()); lb.append('跟手下拉（停住）')
        p.evaluate("document.dispatchEvent(new TouchEvent('touchend',{bubbles:true,touches:[],changedTouches:[]}))"); p.wait_for_timeout(60); fr.append(p.screenshot()); lb.append('松手：弹回中')
        p.wait_for_timeout(500)
        p.evaluate(TOUCH2_JS, [195, my, 195, my + 90, 1, 3, 10]); p.wait_for_timeout(60); fr.append(p.screenshot()); lb.append('快甩：推出去')
        p.wait_for_timeout(700); fr.append(p.screenshot()); lb.append('收起')
        rows.append(strip(fr, lb, '菜单面板下拉（%s）' % ('深色' if dark else '浅色')))
        ctx.close()
W = max(r.size[0] for r in rows); H = sum(r.size[1] for r in rows)
im = Image.new('RGB', (W, H), '#EEE7DE'); y = 0
for r in rows: im.paste(r, (0, y)); y += r.size[1]
im.save(OUT + 'r292_drag.png'); im.convert('RGB').save(OUT + 'r292_drag.jpg', quality=82); print(im.size)
