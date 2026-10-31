"""第 337 次：cut.py 出的 512px 透明头像 → 页面用的 webp。
assets/yiya/<表情>.webp 128px（27 张替换 + cheer「加油」新增）；首页头像 avatar → assets/dock/baby-lg.webp 240px（首页宝宝卡 / 宝宝页 / 菜单的默认头像）；
dock 头像 dockavatar（只有头、没衣服，小尺寸更清楚）→ assets/yiya.webp 120px（顶部咿呀岛默认头像）。"""
import sys, os
from PIL import Image
SRC = sys.argv[1]; ROOT = sys.argv[2]
FACES = ['happy', 'wave', 'clap', 'thumb', 'proud', 'wow', 'shy', 'cheeky', 'heart', 'hug', 'look', 'think', 'puzzled', 'wait', 'whisper', 'phone',
         'send', 'flag', 'bday', 'oops', 'sorry', 'cheer', 'drink', 'spoon', 'bath', 'blanket', 'yawn', 'sleep']
def out(name, dst, px):
    im = Image.open(os.path.join(SRC, name + '.png')).convert('RGBA').convert('RGBa').resize((px, px), Image.LANCZOS).convert('RGBA')
    im.save(dst, 'WEBP', quality=80, alpha_quality=90, method=6)
    return os.path.getsize(dst)
tot = 0
for f in FACES: tot += out(f, os.path.join(ROOT, 'assets', 'yiya', f + '.webp'), 128)
tot += out('avatar', os.path.join(ROOT, 'assets', 'dock', 'baby-lg.webp'), 240)
tot += out('dockavatar', os.path.join(ROOT, 'assets', 'yiya.webp'), 120)
print('bytes', tot)
