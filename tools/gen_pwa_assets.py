"""生成 PWA 启动画面（iOS apple-touch-startup-image）与桌面快捷菜单图标。
用法：python3 tools/gen_pwa_assets.py   （需要 playwright + chromium）
产物：assets/splash/*.png、assets/shortcuts/*.png，并打印 index.html 需要的 <link> 片段。
"""
import base64, json, pathlib
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
LOGO = base64.b64encode((ROOT / 'assets/logo-1024.png').read_bytes()).decode()
FONT = ROOT / '_fonts/NotoSansSC-700.woff'
FONT_CSS = ("@font-face{font-family:S;src:url(data:font/woff;base64,%s)}" % base64.b64encode(FONT.read_bytes()).decode()) if FONT.exists() else ''

# (CSS 宽, CSS 高, 像素比) —— 覆盖 iPhone SE 2 起的竖屏机型
DEVICES = [(375, 667, 2), (414, 896, 2), (375, 812, 3), (414, 896, 3), (390, 844, 3), (428, 926, 3),
           (393, 852, 3), (430, 932, 3), (402, 874, 3), (440, 956, 3), (420, 912, 3)]
THEMES = {'light': ('#FDF9F4', '#5B4A3E', '#9A8B7E'), 'dark': ('#221E1A', '#EDE3D8', '#A89A8C')}

SPLASH = """<html><head><style>%s
html,body{margin:0;height:100%%;background:%s;font-family:S,sans-serif}
.c{position:absolute;left:50%%;top:44%%;transform:translate(-50%%,-50%%);text-align:center}
img{width:112px;height:112px;border-radius:26px;display:block;margin:0 auto;box-shadow:0 10px 30px rgba(0,0,0,.08)}
h1{margin:22px 0 0;font-size:24px;font-weight:700;color:%s;letter-spacing:.12em}
p{margin:8px 0 0;font-size:13px;color:%s;letter-spacing:.2em}
</style></head><body><div class="c"><img src="data:image/png;base64,%s"><h1>咿呀记</h1><p>陪你和宝宝每一天</p></div></body></html>"""

TILE = {'feeding': '#2E8C84', 'diaper': '#A6832B', 'sleep': '#686BAF', 'contraction': '#C0604A'}
SHORTCUTS = [('feeding', '记喂养'), ('diaper', '换尿布'), ('sleep', '记睡眠'), ('contraction', '宫缩计时')]

links = []
with sync_playwright() as pw:
    b = pw.chromium.launch()
    for name, (bg, ink, sub) in THEMES.items():
        for w, h, dpr in DEVICES:
            pg = b.new_page(viewport={'width': w, 'height': h}, device_scale_factor=dpr)
            pg.set_content(SPLASH % (FONT_CSS, bg, ink, sub, LOGO)); pg.wait_for_timeout(150)
            fn = 'assets/splash/%s-%dx%d.png' % (name, w * dpr, h * dpr)
            pg.screenshot(path=str(ROOT / fn)); pg.close()
            links.append('  <link rel="apple-touch-startup-image" media="(device-width: %dpx) and (device-height: %dpx) and (-webkit-device-pixel-ratio: %d) and (orientation: portrait) and (prefers-color-scheme: %s)" href="%s">' % (w, h, dpr, name, fn))
    # 快捷菜单图标：模块主题色（亮色主题值）圆角方块 + 白色线性图标（SVG 取自 js/icons.js，与 App 内一致），透明圆角
    pg = b.new_page(viewport={'width': 400, 'height': 400})
    pg.goto((ROOT / 'index.html').as_uri()); pg.wait_for_timeout(600)
    svgs = {mid: pg.evaluate("id=>icon(id)", mid) for mid, _ in SHORTCUTS}
    pg.close()
    for mid, _ in SHORTCUTS:
        for px in (96, 192):
            pg = b.new_page(viewport={'width': px, 'height': px})
            pg.set_content("<html><body style='margin:0;background:transparent'><div style='width:%dpx;height:%dpx;border-radius:%dpx;background:%s;display:flex;align-items:center;justify-content:center;color:#fff'>%s</div>"
                           "<style>svg{width:%dpx;height:%dpx;stroke:#fff;stroke-width:1.8}</style></body></html>" % (px, px, round(px * .22), TILE[mid], svgs[mid], round(px * .54), round(px * .54)))
            pg.screenshot(path=str(ROOT / ('assets/shortcuts/%s-%d.png' % (mid, px))), omit_background=True); pg.close()
    b.close()
(ROOT / 'tools/_startup_links.html').write_text('\n'.join(links) + '\n')
print(len(links), 'splash links written to tools/_startup_links.html')
