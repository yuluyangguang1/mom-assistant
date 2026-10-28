# 第 288 次：修前 / 修后逐帧截图 + 拼图（不提交）。用法：python3 _probe/r288/shots.py
import sys, json, functools, http.server, socketserver, threading, time
sys.path.insert(0, '/workspace/work/mom-assistant/tests')
import regression as R
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw, ImageFont

OUT = '/workspace/work/fix288'
FONT = ImageFont.truetype('/home/sandbox/.fonts/nsc.otf', 22) if __import__('os').path.exists('/home/sandbox/.fonts/nsc.otf') else ImageFont.load_default()
FONTB = ImageFont.truetype('/home/sandbox/.fonts/nscb.otf', 30) if __import__('os').path.exists('/home/sandbox/.fonts/nscb.otf') else FONT


class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass


old = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Q, directory='/tmp/old288'))
threading.Thread(target=old.serve_forever, daemon=True).start()
OLD_URL = f'http://127.0.0.1:{old.server_address[1]}/index.html'


def page(b, url, dark):
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, has_touch=True)
    p = ctx.new_page()
    p.goto(url); p.wait_for_timeout(600); p.evaluate('t=>Storage.importJSON(t)', R.SEED_V3); p.reload(); p.wait_for_timeout(1200)
    if dark:
        p.evaluate("App.setTheme&&App.setTheme('dark')"); p.wait_for_timeout(500)
    return ctx, p


def label(im, txt, sub=''):
    W = Image.new('RGB', (im.width, im.height + 64), 'white')
    W.paste(im, (0, 64)); d = ImageDraw.Draw(W)
    d.text((10, 6), txt, fill='black', font=FONT)
    if sub: d.text((10, 34), sub, fill=(90, 90, 90), font=FONT)
    return W


def row(ims, gap=10, bg='white'):
    h = max(i.height for i in ims); w = sum(i.width for i in ims) + gap * (len(ims) - 1)
    W = Image.new('RGB', (w, h), bg); x = 0
    for i in ims: W.paste(i, (x, 0)); x += i.width + gap
    return W


def col(ims, gap=16, title=None):
    w = max(i.width for i in ims); h = sum(i.height for i in ims) + gap * (len(ims) - 1) + (60 if title else 0)
    W = Image.new('RGB', (w, h), 'white'); y = 0
    if title:
        ImageDraw.Draw(W).text((10, 10), title, fill='black', font=FONTB); y = 60
    for i in ims: W.paste(i, (0, y)); y += i.height + gap
    return W


def shot(p, clip=None):
    p.screenshot(path='/tmp/_s.png', clip=clip)
    return Image.open('/tmp/_s.png').convert('RGB')


def drawer_seq(b, url, dark, new):
    ctx, p = page(b, url, dark)
    ev = p.evaluate
    if new:
        ev("Drawer._slow(14)")
    else:
        cdp = ctx.new_cdp_session(p); cdp.send('Animation.enable'); cdp.send('Animation.setPlaybackRate', {'playbackRate': 0.07})
    ev("Drawer.open()"); p.wait_for_timeout(6500 if new else 7000)
    frames = [label(shot(p).resize((390, 844)), '全开', '')]
    ev("Drawer.close()")
    t0 = time.time()
    for k in range(7):
        p.wait_for_timeout(650)
        info = ev("(()=>{const a=getComputedStyle(document.getElementById('app')).transform;const m=document.getElementById('sdMask');return [window.Drawer&&Drawer.state?Drawer.state():(Drawer.isOpen()?'open':'—'),Math.round(new DOMMatrix(a).m41),(+getComputedStyle(m).opacity).toFixed(2)]})()")
        frames.append(label(shot(p).resize((390, 844)), '收起 +%.1fs' % (time.time() - t0), '%s 页面x=%dpx 遮罩%s' % tuple(info)))
    p.wait_for_timeout(2500)
    info = ev("(()=>{const a=getComputedStyle(document.getElementById('app')).transform;const m=document.getElementById('sdMask');return [Math.round(new DOMMatrix(a).m41),(+getComputedStyle(m).opacity).toFixed(2),getComputedStyle(m).pointerEvents]})()")
    frames.append(label(shot(p).resize((390, 844)), '落定', '页面x=%dpx 遮罩%s/%s' % tuple(info)))
    ctx.close()
    return row(frames)


def drag_seq(b, url, dark, new):
    ctx, p = page(b, url, dark)
    ev = p.evaluate
    frames = []
    for frac in (0.85, 0.6, 0.35, 0.15):
        dx = int(390 * frac) + 8
        ev(R.TOUCH2_JS, [6, 420, 6 + dx, 424, 'none', 8, 16]); p.wait_for_timeout(60)
        info = ev("(()=>{const a=getComputedStyle(document.getElementById('app')).transform;const r=document.getElementById('sideDrawer').getBoundingClientRect();return [Math.round(r.left),Math.round(new DOMMatrix(a).m41)]})()")
        frames.append(label(shot(p).resize((390, 844)), '拉开 %d%%' % round(frac * 100), '侧拉页 x=%dpx · 底下页面 x=%dpx' % tuple(info)))
        ev("window.__t2nostart=true"); ev(R.TOUCH2_JS, [6 + dx, 424, 6 + dx, 424, 'cancel', 1, 0]); p.wait_for_timeout(900)
        ev("Drawer.isOpen()&&Drawer.close()"); p.wait_for_timeout(1200)
    ctx.close()
    return row(frames)


def close_real(b, url, dark):
    """真实速度收起：关闭后尽快连拍，记录每张的时刻、底下页面位移、遮罩"""
    ctx, p = page(b, url, dark)
    ev = p.evaluate
    ev("Drawer.open()"); p.wait_for_timeout(1500)
    INFO = "(()=>{const a=getComputedStyle(document.getElementById('app')).transform;const m=document.getElementById('sdMask');const r=document.getElementById('sideDrawer').getBoundingClientRect();return [Math.round(r.left),Math.round(new DOMMatrix(a).m41),(+getComputedStyle(m).opacity).toFixed(2)]})()"
    frames = [label(shot(p).resize((390, 844)), '全开', '侧拉页x=%d 页面x=%d 遮罩%s' % tuple(ev(INFO)))]
    ev("window.__c0=performance.now();Drawer.close()")
    while True:
        t, info = ev("[performance.now()-window.__c0," + INFO + "]")
        frames.append(label(shot(p).resize((390, 844)), '收起 +%dms' % t, '侧拉页x=%d 页面x=%d 遮罩%s' % tuple(info)))
        if t > 900 or len(frames) >= 8: break
        p.wait_for_timeout(40)
    p.wait_for_timeout(1500)
    frames.append(label(shot(p).resize((390, 844)), '1.5 秒后', '侧拉页x=%d 页面x=%d 遮罩%s' % tuple(ev(INFO))))
    ctx.close()
    return row(frames)


def toast_seq(b, url, dark):
    ctx, p = page(b, url, dark)
    ev = p.evaluate
    cdp = ctx.new_cdp_session(p); cdp.send('Animation.enable'); cdp.send('Animation.setPlaybackRate', {'playbackRate': 0.35})
    ev("App.showTab('fetal')"); p.wait_for_timeout(900)
    ims = []
    for k in range(10):
        ev("document.querySelector('#ftAdd').click()"); p.wait_for_timeout(110 + (k % 3) * 70)
        ims.append(shot(p, {'x': 0, 'y': 0, 'width': 390, 'height': 130}))
    ctx.close()
    # 两列五行
    rows = [row(ims[i:i + 5], 6) for i in (0, 5)]
    return col(rows, 6)


def device_frames():
    from subprocess import run
    F1 = '/workspace/uploads/ScreenRecording_10-27-2026 14-06-37_1.mp4'
    F2 = '/workspace/uploads/ScreenRecording_10-27-2026 15-13-42_1.mp4'
    ims = []
    for t, lab in ((1.05, '1.05s 侧拉页全开'), (1.15, '1.15s 关闭：一帧变成右移+灰遮罩'), (2.5, '2.50s 仍静止（像素不变）'), (3.9, '3.90s'), (3.97, '3.97s 两层叠影淡出'), (4.10, '4.10s 恢复正常')):
        run(['ffmpeg', '-v', 'error', '-y', '-ss', str(t), '-i', F1, '-frames:v', '1', '-update', '1', '/tmp/_d.png'])
        ims.append(label(Image.open('/tmp/_d.png').convert('RGB').resize((390, 845)), lab))
    d1 = row(ims)
    ims = []
    for t in (2.5, 3.5, 4.5, 6.5, 9.6, 10.2, 13.0, 16.5):
        run(['ffmpeg', '-v', 'error', '-y', '-ss', str(t), '-i', F2, '-frames:v', '1', '-update', '1', '/tmp/_d.png'])
        im = Image.open('/tmp/_d.png').convert('RGB').resize((390, 845)).crop((0, 0, 390, 150))
        ims.append(im)
    d2 = col([row(ims[:4], 6), row(ims[4:], 6)], 6)
    return d1, d2


with sync_playwright() as pw:
    b = pw.chromium.launch()
    d1, d2 = device_frames()
    d1.save(OUT + '/drawer_device_before.png'); d2.save(OUT + '/toast_device_before.png')
    for dark in (False, True):
        tag = 'dark' if dark else 'light'
        ob = drag_seq(b, OLD_URL, dark, False); ob.save(f'{OUT}/drawer_drag_old_{tag}.png')
        nd = drag_seq(b, R.URL, dark, True); nd.save(f'{OUT}/drawer_drag_new_{tag}.png')
        nb = drawer_seq(b, R.URL, dark, True); nb.save(f'{OUT}/drawer_new_{tag}.png')
        close_real(b, OLD_URL, dark).save(f'{OUT}/close_old_{tag}.png')
        close_real(b, R.URL, dark).save(f'{OUT}/close_new_{tag}.png')
        ot = toast_seq(b, OLD_URL, dark); ot.save(f'{OUT}/toast_old_{tag}.png')
        nt = toast_seq(b, R.URL, dark); nt.save(f'{OUT}/toast_new_{tag}.png')
    b.close()

# 拼图
L = lambda n: Image.open(f'{OUT}/{n}.png')
def sc(im, w):
    return im.resize((w, int(im.height * w / im.width)))
W = 2200
parts = [
    ('Bug 1 修前 · 真机录屏 14-06-37（关闭后 2.8 秒的「右移 + 灰遮罩」是一张静止截图，最后两层叠影淡出 = iOS 系统返回快照被移除）', sc(L('drawer_device_before'), W)),
    ('Bug 1 关闭过程 · 修前（旧实现，真实速度连拍）· 浅色', sc(L('close_old_light'), W)),
    ('Bug 1 关闭过程 · 修后（新实现，真实速度连拍）· 浅色：底下页面 x 恒为 0，结束即遮罩 0', sc(L('close_new_light'), W)),
    ('Bug 1 关闭过程 · 修前 · 深色', sc(L('close_old_dark'), W)),
    ('Bug 1 关闭过程 · 修后 · 深色', sc(L('close_new_dark'), W)),
    ('Bug 1 结构对比 · 拖到 85 / 60 / 35 / 15%：左 = 旧实现（推整页，底下页面跟着右移、要同步六样东西）· 右 = 新实现（覆盖式，底下页面始终不动）· 浅色', sc(row([L('drawer_drag_old_light'), L('drawer_drag_new_light')], 30), W)),
    ('Bug 1 结构对比 · 深色（左旧右新）', sc(row([L('drawer_drag_old_dark'), L('drawer_drag_new_dark')], 30), W)),
    ('Bug 1 修后 · 新实现收起动画逐帧（Drawer._slow(14) 放慢 14 倍）· 浅色：页面 x 恒为 0，落定帧遮罩 0 / pointer-events none', sc(L('drawer_new_light'), W)),
    ('Bug 1 修后 · 收起动画逐帧 · 深色', sc(L('drawer_new_dark'), W)),
    ('Bug 2 修前 · 真机录屏 15-13-42（连点 +1，胶囊塌成竖条、一字一行）', sc(L('toast_device_before'), W)),
    ('Bug 2 修前 · 旧实现连点 10 次（CSS 动画放慢到 0.35 倍，第 2 张即塌成竖条）· 浅色', sc(L('toast_old_light'), W)),
    ('Bug 2 修后 · 新实现连点 10 次（同条件）· 浅色：单行、数字原地跳动、宽度不塌', sc(L('toast_new_light'), W)),
    ('Bug 2 修前 · 深色', sc(L('toast_old_dark'), W)),
    ('Bug 2 修后 · 深色', sc(L('toast_new_dark'), W)),
]
blocks = []
for t, im in parts:
    hdr = Image.new('RGB', (W, 56), (245, 240, 234)); ImageDraw.Draw(hdr).text((12, 12), t, fill='black', font=FONT)
    blocks.append(col([hdr, im], 4))
col(blocks, 28, '第 288 次 · 侧拉页重写 + 咿呀岛连点 · 修前修后').save(OUT + '/拼图_288.png')
print('ok')
