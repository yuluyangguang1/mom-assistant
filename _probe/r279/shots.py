import sys; sys.path.insert(0, '/workspace/work/mom-assistant/tests')
import regression as R
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw, ImageFont
OUT = '/workspace/work/r279/'
T = R.TOUCH2_JS
SD = R.SD_ST
labels = ['拉开 30%', '拉开 65%', '全开', '全开+宝宝资料面板', '面板开着时左拉（不接管）', '左拉关闭中 50%', '关闭后复位']
rows = []
with sync_playwright() as pw:
    b = pw.webkit.launch()
    for theme in ('light', 'dark'):
        ctx = b.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, device_scale_factor=1)
        p = ctx.new_page(); p.goto(R.URL); p.wait_for_timeout(700)
        p.evaluate('t=>Storage.importJSON(t)', R.SEED_V3); p.reload(); p.wait_for_timeout(900)
        p.evaluate(f"App.setTheme('{theme}')"); p.wait_for_timeout(600)
        ev = p.evaluate; drag = lambda *a: ev(T, list(a)); fr = []
        def snap(n):
            path = OUT + f'{theme}_{n}.png'; p.screenshot(path=path); fr.append(path); print(theme, n, ev(SD))
        drag(6, 420, 6 + 117 + 8, 424, 'none', 6, 16); p.wait_for_timeout(60); snap(1)
        ev('window.__t2nostart=true'); drag(131, 424, 6 + 253 + 8, 424, 'none', 6, 16); p.wait_for_timeout(60); snap(2)
        ev('window.__t2nostart=true'); drag(267, 424, 268, 424, True, 1, 0); p.wait_for_timeout(700); snap(3)
        ev("document.querySelector('#sideDrawer [data-sd=swap]').click()"); p.wait_for_timeout(600); snap(4)
        drag(330, 200, 60, 204, 'none', 8, 16); p.wait_for_timeout(60); snap(5)
        ev('window.__t2nostart=true'); drag(60, 204, 59, 204, True, 1, 0); p.wait_for_timeout(300)
        ev("document.querySelector('#modalRoot .modal-mask').click()"); p.wait_for_timeout(600)
        drag(330, 400, 330 - 195, 404, 'none', 8, 16); p.wait_for_timeout(60); snap(6)
        ev('window.__t2nostart=true'); drag(135, 404, 40, 404, True, 3, 16); p.wait_for_timeout(900); snap(7)
        rows.append(fr); ctx.close()
    b.close()
f = ImageFont.truetype('/home/sandbox/.fonts/nsc.otf', 22)
W, H, s = 390, 844, 0.5
sheet = Image.new('RGB', (int(W*s)*7 + 8*6, (int(H*s)+34)*2), 'white'); d = ImageDraw.Draw(sheet)
for r, fr in enumerate(rows):
    for i, pth in enumerate(fr):
        im = Image.open(pth).resize((int(W*s), int(H*s)))
        x = i*(int(W*s)+8); y = r*(int(H*s)+34)
        d.text((x+2, y+4), labels[i], fill='black', font=ImageFont.truetype('/home/sandbox/.fonts/nsc.otf', 15))
        sheet.paste(im, (x, y+30))
sheet.save(OUT + 'drag279.png'); print(OUT + 'drag279.png')
