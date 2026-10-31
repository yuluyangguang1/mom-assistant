"""第 337 次：dock 三颗（首页 / 日历 / 宝宝）——从 SET=337 总表第 3 行切出的透明图形（raw/dk*_g.png）派生两态。
  · 选中态 = 彩色原图（浅）/ darkv 提亮版（深）。
  · 未选中态 = 同一张图派生：去色 → 单色可可，线条（暗像素）保持原 alpha，填充（亮像素）降到 FILL 倍 alpha。
    只改 alpha 的倍数、不挪像素，所以两态的轮廓逐像素一致（线条像素 alpha 完全相等，透镜边切过图标时严丝合缝）。
输出（assets/dock/）：
  <k>-on@2x/@3x/@4x.webp（48 / 72 / 96，@4x 给 GL 液态透镜），<k>-on-d@…（深色），
  <k>-off@2x/@3x.webp（浅 #6E5547）、<k>-off-d@2x/@3x.webp（深 #D9C6B5）——文件版，给没有 dock-icons.js 时的兜底和核对图；
  <k>.webp 120px 彩色（兜底 <img class="dk-c">，SW 一直在预缓存）；
  dock_inline.json：72px 选中浅 / 深 + 未选中白色遮罩的 data URI，由 dock-icons.js 内联（DOM 不等网络 / 解码队列，第 315 次「图标闪」的教训）。"""
import numpy as np, json, os, base64, io, sys
from PIL import Image
from darkv import darkify
D = sys.argv[1] if len(sys.argv) > 1 else '../../assets/dock'
os.makedirs(D, exist_ok=True)
KEYS = {'home': 'dkhome', 'cal': 'dkcal', 'baby': 'dkbaby'}
BIG = 384; FRAC = 0.94; FILL = 0.18
COCOA = {'l': (0x6E, 0x55, 0x47), 'd': (0xD9, 0xC6, 0xB5)}
def norm(g):
    a = np.asarray(g)[..., 3].astype(np.float32) / 255
    ys, xs = np.where(a > 0.08); y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    s = FRAC * BIG / max(x1 - x0, y1 - y0)
    gp = g.crop((x0, y0, x1, y1)).convert('RGBa')
    nw, nh = round((x1 - x0) * s), round((y1 - y0) * s)
    big = gp.resize((nw, nh), Image.LANCZOS)
    cv = Image.new('RGBa', (BIG, BIG), (0, 0, 0, 0)); cv.paste(big, ((BIG - nw) // 2, (BIG - nh) // 2))
    return np.asarray(cv.convert('RGBA')).astype(np.float32)
LINE_T = {'home': 134, 'cal': 120, 'baby': 98}   # 各自描边亮度上沿（实测：首页描边是珊瑚色 L≈105–127，屋顶填充 ≈145；宝宝描边 ≈77–87，头发填充 ≈110）
HEART = 0.62   # 第 337 次收尾：日历未选中态的爱心 / 圆点（粉色填充）单独提到这个 alpha，不然 0.18 几乎看不见
EDGE = 10      # 第 337 次收尾：首页外轮廓带宽（384 画布像素，≈ 72px 图里 1.9px）——屋檐左侧描边是浅珊瑚（L≈135–150），按亮度阈值会掉成填充
def weight(rgba, k):
    rgb = rgba[..., :3]; L = rgb @ np.array([.299, .587, .114])
    # 窄过渡（±8）：描边 = 1，其余（屋顶珊瑚、头发、白页）一律 FILL——填充是一整片均匀的淡可可，不出深浅斑
    w = np.clip((LINE_T[k] + 8 - L) / 16, 0, 1) * (1 - FILL) + FILL
    if k == 'cal':   # 爱心 / 圆点：粉（r - b 大）且在页面内部（不是蓝色描边）
        pink = np.clip((rgb[..., 0] - rgb[..., 2] - 40) / 30, 0, 1)
        w = np.maximum(w, FILL + (HEART - FILL) * pink)
    if k == 'home':  # 剪影外沿 EDGE 像素内一律当描边：左右屋檐粗细一致
        from scipy.ndimage import distance_transform_edt
        d = distance_transform_edt(rgba[..., 3] > 128)
        w = np.maximum(w, np.clip((EDGE + 1.5 - d) / 3, 0, 1))
    return w
# alpha 一律无损（alpha_quality 100）：两态轮廓靠 alpha 对齐；未选中态 / 遮罩是单色，整张无损（lossy 的色度下采样会把透明区的黑渗进边缘）
def enc(im, f, lossless):
    if lossless: im.save(f, 'WEBP', lossless=True, quality=100, method=6, exact=True)
    else: im.save(f, 'WEBP', quality=85, alpha_quality=100, method=6)
def save(arr, path, px, lossless=False):
    im = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), 'RGBA').convert('RGBa').resize((px, px), Image.LANCZOS).convert('RGBA')
    if lossless:   # 单色：去预乘后 RGB 有舍入抖动，直接写回纯色
        a = np.asarray(im).copy(); a[..., :3] = arr[0, 0, :3]; im = Image.fromarray(a, 'RGBA')
    enc(im, path, lossless)
    return im
def b64(arr, px, lossless=False):
    im = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), 'RGBA').convert('RGBa').resize((px, px), Image.LANCZOS).convert('RGBA')
    if lossless:
        a = np.asarray(im).copy(); a[..., :3] = arr[0, 0, :3]; im = Image.fromarray(a, 'RGBA')
    bio = io.BytesIO(); enc(im, bio, lossless)
    return 'data:image/webp;base64,' + base64.b64encode(bio.getvalue()).decode()
inline = {}; tot = 0
for k, raw in KEYS.items():
    on = norm(Image.open(f'raw/{raw}_g.png').convert('RGBA'))
    ond = darkify(on.astype(np.uint8)).astype(np.float32)
    w = weight(on, k)
    offa = on[..., 3] * w
    for sc, px in (('2x', 48), ('3x', 72), ('4x', 96)):
        save(on, f'{D}/{k}-on@{sc}.webp', px); save(ond, f'{D}/{k}-on-d@{sc}.webp', px)
    for t in ('l', 'd'):
        off = np.dstack([np.broadcast_to(np.array(COCOA[t], np.float32), on.shape[:2] + (3,)), offa])
        for sc, px in (('2x', 48), ('3x', 72)):
            save(off, f'{D}/{k}-off{"-d" if t == "d" else ""}@{sc}.webp', px, True)
    save(on, f'{D}/{k}.webp', 120)
    mask = np.dstack([np.full(on.shape[:2] + (3,), 255, np.float32), offa])
    inline[k] = {'on': b64(on, 72), 'onD': b64(ond, 72), 'mask': b64(mask, 72, True)}
    np.save(f'dock_{k}_w.npy', w)
json.dump(inline, open('dock_inline.json', 'w'))
tot = sum(os.path.getsize(os.path.join(D, f)) for f in os.listdir(D) if f.endswith('.webp'))
print('inline bytes', sum(len(v) for d in inline.values() for v in d.values()), 'dock dir bytes', tot)
