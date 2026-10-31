"""第 337 次：3D 黏土物件 30 张 → assets/supplies/<key>.webp
输入：用户生成并归一化好的透明 960px 方图（物体占 84%、已去绿边），默认 /workspace/work/clay337/out/*.png。
输出：360px（与 assets/diaper、assets/solid 的 3D 卡片同尺寸），webp q82 / alpha q90，method 6；预乘缩放避免半透明边发灰。
另出 out/clay_check.jpg（浅 / 深底、逐颗放大的核对图）由 check_clay.py 生成。"""
import sys, os, glob
from PIL import Image
SRC = sys.argv[1] if len(sys.argv) > 1 else '/workspace/work/clay337/out'
DST = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), '..', '..', 'assets', 'supplies')
PX = 360
os.makedirs(DST, exist_ok=True)
tot = 0
for f in sorted(glob.glob(os.path.join(SRC, '*.png'))):
    k = os.path.basename(f)[:-4]
    im = Image.open(f).convert('RGBA').convert('RGBa').resize((PX, PX), Image.LANCZOS).convert('RGBA')
    o = os.path.join(DST, k + '.webp')
    im.save(o, 'WEBP', quality=82, alpha_quality=90, method=6)
    tot += os.path.getsize(o)
print('files', len(glob.glob(os.path.join(SRC, '*.png'))), 'bytes', tot)
