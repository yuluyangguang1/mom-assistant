import sys, glob
from PIL import Image, ImageDraw, ImageFont
# usage: grid.py out.jpg cols scale file...
out, cols, sc = sys.argv[1], int(sys.argv[2]), float(sys.argv[3]); fs = sys.argv[4:]
ims = [Image.open(f).convert('RGB') for f in fs]
w = int(ims[0].width * sc); h = int(ims[0].height * sc)
rows = (len(ims) + cols - 1) // cols
c = Image.new('RGB', (cols * w, rows * (h + 22)), 'white'); dr = ImageDraw.Draw(c)
try: font = ImageFont.truetype('/home/sandbox/.fonts/nsc.otf', 16)
except Exception: font = None
for i, (im, f) in enumerate(zip(ims, fs)):
    x, y = (i % cols) * w, (i // cols) * (h + 22)
    c.paste(im.resize((w, h)), (x, y + 22)); dr.text((x + 4, y + 2), f.split('/')[-1], fill='black', font=font)
c.save(out, quality=82)
