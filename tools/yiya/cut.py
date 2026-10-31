"""第 337 次：小咿呀 3D 表情 30 格（6×5，平色底 #FBF6F0、每格下方中文名）→ 透明头像。
用法：python3 cut.py <总表.png> <输出目录>
步骤：① 按行列空隙切格（行列不完全等距，按实测边界）；② 每格从下往上找到文字行（最下面一段、高 < 32px 的灰色笔画）整段去掉；
③ 底色模型：格子边框泛洪（容差 9，相对局部底色）得到「确定是底」的像素，按高斯加权补出整格底色（底色有轻微渐变 / 噪点）；
④ 前景 = 泛洪没到的区域（浅色衣领、皮肤贴着底色也不会被吃掉——它们和底色差 > 9 就挡住泛洪）；
⑤ 抗锯齿 alpha：边缘带里按「像素 − 底色」在「前景色 − 底色」上的投影算（和 icons_v4/cut.py 同法），并去底色污染；前景和底色太接近（衣领）时退回软化遮罩；
⑥ 统一头部：头发（暗色最大连通块）的宽度缩放到画布 0.86、头发中心对齐画布中线、头发顶部落在 0.04 处（和旧版一样脸占满圆形头像框）；超出画布的手 / 道具被裁掉（和旧版一样是头像裁切）。"""
import sys, os, json
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
SRC = sys.argv[1]; OUT = sys.argv[2]
os.makedirs(OUT, exist_ok=True)
NAMES = ['avatar', 'dockavatar', 'happy', 'wave', 'clap', 'thumb',
         'proud', 'wow', 'shy', 'cheeky', 'heart', 'hug',
         'look', 'think', 'puzzled', 'wait', 'whisper', 'phone',
         'send', 'flag', 'bday', 'oops', 'sorry', 'cheer',
         'drink', 'spoon', 'bath', 'blanket', 'yawn', 'sleep']
im = np.asarray(Image.open(SRC).convert('RGB')).astype(np.float32)
H, W, _ = im.shape
XB = [0, 224, 435, 628, 848, 1043, W]
YB = [0, 263, 505, 737, 986, H]
CANVAS = 512
WHITE_PROPS = {'bath'}
PROPS = {'bday', 'think', 'bath', 'sleep', 'wait'}   # 第 337 次收尾：道具出画的几张单独取景（见下）
PAD = 6   # 白泡泡本身比底色亮：这格只剥头发附近的白边
meta = {}
def gw(a, s): return ndi.gaussian_filter(a, s)
for idx, name in enumerate(NAMES):
    r, c = divmod(idx, 6)
    C = im[YB[r]:YB[r + 1], XB[c]:XB[c + 1]].copy(); h, w, _ = C.shape
    border = np.concatenate([C[0], C[-1], C[:, 0], C[:, -1]])
    b0 = np.median(border, 0)
    d0 = np.sqrt(((C - b0) ** 2).sum(-1))
    fg0 = d0 > 9
    # —— 去文字：最下面一段有前景的行，若高 < 32 且是灰笔画，整段抹成底 ——
    rows = fg0.sum(1) > 0
    ys = np.where(rows)[0]
    yb = ys.max(); y = yb
    while y > 0 and rows[y]: y -= 1
    ytext = y + 1
    txt = fg0[ytext:yb + 1]
    sat = C[ytext:yb + 1].max(-1) - C[ytext:yb + 1].min(-1)
    if yb - ytext < 32 and (sat[txt] < 40).mean() > 0.8:
        C[ytext - 2:] = b0; cut_text = [int(ytext), int(yb)]
    else:
        cut_text = None
    # —— 底色模型 + 泛洪 ——
    d0 = np.sqrt(((C - b0) ** 2).sum(-1))
    cand = d0 < 9
    seed = np.zeros_like(cand); seed[0, :] = seed[-1, :] = seed[:, 0] = seed[:, -1] = True
    lab, n = ndi.label(cand); ids = np.unique(lab[seed & cand]); ids = ids[ids > 0]
    bgk = np.isin(lab, ids)
    known = bgk & ~ndi.binary_dilation(~bgk, iterations=2)
    wt = gw(known.astype(np.float32), 10)
    B = np.stack([gw(C[..., i] * known, 10) for i in range(3)], -1) / np.maximum(wt, 1e-4)[..., None]
    B[wt < 0.01] = b0
    dist = np.sqrt(((C - B) ** 2).sum(-1))
    cand2 = gw(dist, 0.7) < 6.5
    lab, n = ndi.label(cand2); ids = np.unique(lab[seed & cand2]); ids = ids[ids > 0]
    fg = ~np.isin(lab, ids)
    # 小噪点
    lab, n = ndi.label(fg)
    if n:
        ii = np.arange(1, n + 1); sz = ndi.sum(fg, lab, ii); md = ndi.maximum(dist, lab, ii)
        fg = np.isin(lab, ii[(sz >= 25) & (md > 14)])
    # 填洞：发丝之间被围住的一小块底色（四周是头发色）仍算底，其余洞（牙齿、眼白、衣领里）填上
    holes = ndi.binary_fill_holes(fg) & ~fg
    rgbi = C.astype(np.float32); Lh = rgbi @ np.array([.299, .587, .114])
    hairpx = (Lh < 150) & (rgbi[..., 0] - rgbi[..., 1] < 45) & (rgbi[..., 0] - rgbi[..., 2] < 65)
    lab, n = ndi.label(holes)
    for k in range(1, n + 1):
        hk = lab == k
        ring = ndi.binary_dilation(hk, iterations=2) & ~hk
        if hairpx[ring].mean() < 0.55: fg |= hk
    # 发梢白边：生成图在头发外缘有一圈比底色还白的描边 / 高光碎点，泛洪挡不住（比底色亮 > 9）。
    # 剥「贴着底、比局部底色亮、低饱和」的边缘像素，最多 4 圈（衣领 / 奶油色毯子比底色暗，不受影响）；洗澡那格泡泡是白的，只剥头发附近。
    Lc = C @ np.array([.299, .587, .114]); Lb = B @ np.array([.299, .587, .114])
    satc = C.max(-1) - C.min(-1)
    hairish = ndi.binary_dilation((Lc < 160) & fg, iterations=5)
    whit = (Lc > Lb + 1.5) & (satc < 22) & (hairish if name in WHITE_PROPS else True)
    st4 = ndi.generate_binary_structure(2, 1)
    for _ in range(4):
        edge = fg & ndi.binary_dilation(~fg, st4)
        kill = edge & whit
        if not kill.any(): break
        fg &= ~kill
    # 发丝缝里的底色 / 白描边：离外面 ≤ 6px、挨着头发、颜色接近底色或比底色亮的像素，不管连不连通都算底
    outer = ndi.binary_dilation(~fg, iterations=6)
    nearhair = ndi.binary_dilation(hairpx & fg, iterations=3)
    fg &= ~(outer & nearhair & ((dist < 10) | ((Lc > Lb + 1.5) & (satc < 22))))
    lab, n = ndi.label(fg)
    if n:
        ii = np.arange(1, n + 1); sz = ndi.sum(fg, lab, ii)
        fg = np.isin(lab, ii[sz >= 25])
    # —— 抗锯齿 alpha ——
    core = ndi.binary_erosion(fg, iterations=2)
    _, ind = ndi.distance_transform_edt(~core, return_indices=True)
    F = C[ind[0], ind[1]]
    band = ndi.binary_dilation(fg, iterations=2) & ~core
    FB = F - B; den = (FB ** 2).sum(-1)
    a = np.clip(((C - B) * FB).sum(-1) / np.maximum(den, 1), 0, 1)
    soft = np.clip(gw(fg.astype(np.float32), 0.9) * 1.1 - 0.05, 0, 1)
    a = np.where(den < 300, soft, a)
    alpha = np.where(core, 1.0, np.where(band, a, 0.0))
    alpha[alpha < 0.04] = 0
    col = np.where(alpha[..., None] > 0.02, (C - (1 - alpha[..., None]) * B) / np.maximum(alpha[..., None], 0.02), C)
    col = np.where(band[..., None] & (alpha[..., None] < 0.5), F * 0.6 + np.clip(col, 0, 255) * 0.4, col)
    col = np.clip(col, 0, 255)
    rgba = np.dstack([col, alpha * 255]).astype(np.uint8)
    # —— 头部定位：头发 = 暗色最大连通块 ——
    L = C @ np.array([.299, .587, .114])
    hair = (L < 95) & fg
    hair = ndi.binary_opening(hair, iterations=1)
    lab, n = ndi.label(hair); sz = ndi.sum(hair, lab, range(1, n + 1)); hair = lab == (np.argmax(sz) + 1)
    hy, hx = np.where(hair)
    hx0, hx1 = np.percentile(hx, 1), np.percentile(hx, 99); hy0 = np.percentile(hy, 0.5)
    hw = hx1 - hx0
    s = 0.86 * CANVAS / hw
    ox, oy = CANVAS / 2 - (hx0 + hx1) / 2 * s, 0.04 * CANVAS - hy0 * s
    if name in PROPS:
        # 第 337 次收尾：道具（生日帽 / 灯泡 / 泡泡 / 月亮 / 等待圈）在头发上方或斜上角，按头部统一取景会出画；
        # 页面上表情是圆形头像（.toast-yiya / .cfm-yiya 都 border-radius: 50%），所以要让「上半张画布里的前景」落进内切圆（半径 C/2 − PAD）。
        # 搜最大的缩放 f（≥ 0.78 → 头发宽 ≥ 0.67 画布），配水平偏移 ≤ 0.06 画布、发顶下移到 ≤ 0.24 画布。
        fy, fx = np.where(alpha > 0.25)
        hc = (hx0 + hx1) / 2; R = CANVAS / 2 - PAD; best = None
        for f in np.arange(1.0, 0.775, -0.01):
            ss = s * f
            for ty in np.arange(0.04 * CANVAS, 0.245 * CANVAS, 0.01 * CANVAS):
                yy = ty + (fy - hy0) * ss; up = yy < 0.5 * CANVAS
                if yy.min() < PAD: continue
                for dx in sorted(np.arange(-0.06, 0.0601, 0.01) * CANVAS, key=abs):
                    xx = CANVAS / 2 + dx + (fx[up] - hc) * ss
                    if (((xx - CANVAS / 2) ** 2 + (yy[up] - CANVAS / 2) ** 2) <= R * R).all():
                        best = (f, ss, CANVAS / 2 + dx - hc * ss, ty - hy0 * ss); break
                if best: break
            if best: break
        if best: f, s, ox, oy = best
        else: f = None
    big = Image.fromarray(rgba).convert('RGBa').resize((round(w * s), round(h * s)), Image.LANCZOS)
    cv = Image.new('RGBa', (CANVAS, CANVAS), (0, 0, 0, 0))
    cv.paste(big, (round(ox), round(oy)))
    cv.convert('RGBA').save(os.path.join(OUT, name + '.png'))
    meta[name] = dict(cell=[XB[c], YB[r], XB[c + 1], YB[r + 1]], text=cut_text, hair_w=float(hw), scale=float(s), prop_fit=(None if name not in PROPS or f is None else round(float(f), 2)))
json.dump(meta, open(os.path.join(OUT, 'meta.json'), 'w'), indent=0, ensure_ascii=False)
print('ok', len(meta))
