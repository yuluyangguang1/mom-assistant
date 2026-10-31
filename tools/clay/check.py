"""核对图 + 边缘自动量：python3 check.py <输出 jpg>
3D 物件 34 张（第 338 次补 4 张：奶瓶 / 吸奶器 / 学饮杯 / 体温计）（浅 / 深 / 品红底，各 160px）；每张量：半透明边缘像素里偏绿（g 比 r、b 都高 18 以上）和偏白（比邻近实心像素亮 40 以上）的个数。"""
import sys, os, glob
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as ndi
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'assets', 'supplies')
fs = sorted(glob.glob(D + '/*.webp')); S = 160
R = (len(fs) + 9) // 10  # 第 338 次：行数随张数走（原来写死 3 行，34 张会叠到下一种底色）
font = ImageFont.truetype(os.path.expanduser('~/.fonts/NotoSansSC-500.otf'), 14)
bgs = [(250, 247, 242), (28, 26, 30), (255, 0, 255)]
o = Image.new('RGB', (10 * S, R * len(bgs) * (S + 20)), 'white'); d = ImageDraw.Draw(o)
rep = []
for i, f in enumerate(fs):
    im = Image.open(f).convert('RGBA'); a = np.asarray(im).astype(int)
    al = a[..., 3]; edge = (al > 25) & (al < 230)
    core = ndi.binary_erosion(al > 240, iterations=2)
    _, ind = ndi.distance_transform_edt(~core, return_indices=True)
    near = a[ind[0], ind[1], :3]
    Lc = a[..., :3] @ [.299, .587, .114]; Ln = near @ [.299, .587, .114]
    green = edge & (a[..., 1] > a[..., 0] + 18) & (a[..., 1] > a[..., 2] + 18)
    white = edge & (Lc > Ln + 40)
    rep.append((os.path.basename(f)[:-5], int(green.sum()), int(white.sum()), int(edge.sum())))
    for bi, bg in enumerate(bgs):
        t = Image.new('RGBA', (S, S), bg + (255,)); t.alpha_composite(im.resize((S - 8, S - 8), Image.LANCZOS), (4, 4))
        x = (i % 10) * S; y = (bi * R + i // 10) * (S + 20)
        o.paste(t.convert('RGB'), (x, y)); d.text((x + 4, y + S + 2), os.path.basename(f)[:-5], fill=(90, 90, 90), font=font)
o.save(sys.argv[1], quality=88)
for r in rep: print(*r)
