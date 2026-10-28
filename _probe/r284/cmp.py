from PIL import Image, ImageDraw, ImageFont
F='/workspace/work/fix284/flow/'; R='/workspace/uploads/IMG_%d.jpeg'
font = ImageFont.truetype('/home/sandbox/.fonts/nsc.otf', 20)
pairs = [(4697,'01_empty'),(4699,'02_sheet_weight'),(4700,'04_sheet_height'),(4701,'05_sheet_head'),(4702,'06_main_one'),(4703,'10_trend_height'),(4705,'12_trend_std_menu'),
         (4706,'14_trend_weight'),(4707,'15_trend_head'),(4704,'11_trend_range_menu'),(4708,'21_settings'),(4709,'23_sheet_nohead'),(4710,'22_main_nohead'),(4711,'22_main_nohead')]
W, H = 300, 650
def tile(img, label):
    im = img.convert('RGB').resize((W, H)); c = Image.new('RGB', (W, H + 30), 'white'); c.paste(im, (0, 30))
    ImageDraw.Draw(c).text((6, 3), label, fill='black', font=font); return c
def sheet(out, items, cols):
    rows = (len(items) + cols - 1) // cols
    c = Image.new('RGB', (cols * (W + 8), rows * (H + 38)), (230, 230, 230))
    for i, t in enumerate(items): c.paste(t, ((i % cols) * (W + 8), (i // cols) * (H + 38)))
    c.save(out, quality=80); print(out, c.size)
half = len(pairs) // 2
for part, ps in ((1, pairs[:half]), (2, pairs[half:])):
    items = []
    for ref, ours in ps:
        items += [tile(Image.open(R % ref), '参考 %d' % ref), tile(Image.open(F + 'd_' + ours + '.png'), '咿呀记 深色'), tile(Image.open(F + 'l_' + ours + '.png'), '咿呀记 浅色')]
    sheet('/workspace/work/fix284/cmp_%d.jpg' % part, items, 6)
import glob
for tag, nm in (('l', '浅色'), ('d', '深色')):
    fs = sorted(glob.glob(F + tag + '_*.png'))
    sheet('/workspace/work/fix284/flow_%s.jpg' % ('light' if tag == 'l' else 'dark'), [tile(Image.open(f), f.split('/')[-1][2:-4]) for f in fs], 9)
