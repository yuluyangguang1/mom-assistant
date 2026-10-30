"""第 328 次：busy.mp4 合成——左 main（890721d，主线程渲染）/ 右 原型（Worker 渲染），按各自第一次按下对齐；先实速，再 1/4 慢放。
python3 compose.py <vid_dir> <out.mp4>"""
import sys, os, json, glob, subprocess, shutil
from PIL import Image, ImageDraw, ImageFont
vd, outp = sys.argv[1], sys.argv[2]
FONT = os.path.expanduser('~/.fonts/wqy-microhei.ttc')
F = ImageFont.truetype(FONT, 26); FS = ImageFont.truetype(FONT, 20); FB = ImageFont.truetype(FONT, 22)
sides = []
for name, lab in (('main', 'main 890721d · 主线程渲染'), ('proto', '原型 · Worker 渲染')):
    M = json.load(open(f'{vd}/{name}/meta.json'))
    d0 = M['downs'][0]
    fr = [(t - d0, os.path.join(vd, name, 'frames', os.path.basename(f))) for t, f in M['frames']]
    bz = [(a - d0, b - d0) for a, b in M['busyWin']]
    dn = [t - d0 for t in M['downs']]
    sides.append({'lab': lab, 'fr': fr, 'bz': bz, 'dn': dn, 'bar': M['bar'], 'dpr': M['dpr'], 'busy': M['busy'], 'worker': M['worker']})
im0 = Image.open(sides[0]['fr'][0][1]); W0, H0 = im0.size
dpr = W0 / 393.0
bx, by, bw, bh = sides[0]['bar']
crop = (0, int((by - 70) * dpr), W0, int(min(852, by + bh + 14) * dpr))
CW, CH = crop[2] - crop[0], crop[3] - crop[1]
SC = 1.0 if CW >= 700 else 700.0 / CW
cw, ch = int(CW * SC), int(CH * SC)
G = 24; TOP = 96; BOT = 64
OW, OH = 2 * cw + G, ch + TOP + BOT
OW += OW % 2; OH += OH % 2
tmp = vd + '/comp'; shutil.rmtree(tmp, ignore_errors=True); os.makedirs(tmp)
cache = {}
def frame_at(s, t):
    best = None
    for ts, f in s['fr']:
        if ts <= t: best = f
        else: break
    best = best or s['fr'][0][1]
    if best not in cache:
        if len(cache) > 400: cache.clear()
        cache[best] = Image.open(best).convert('RGB').crop(crop).resize((cw, ch), Image.LANCZOS)
    return cache[best]
# 三次点击：每次 −200 ~ +1300ms（各自以每次按下对齐），实速 60fps；之后同一段 1/4 慢放
segs = []
for i in range(3):
    segs.append(i)
idx = 0
def seg_times(i, step):
    t0 = -200; t1 = 1100
    t = t0
    out = []
    while t <= t1:
        out.append(t); t += step
    return out
for slow in (False, True):
    for i in range(3):
        for t in seg_times(i, 1000 / 60 / (4 if slow else 1)):
            # 第 i 次点击：时间轴平移到第 i 次按下
            tt = []
            for s in sides:
                tt.append(s['dn'][i] if i < len(s['dn']) else 0)
            # 两边各自按自己的第 i 次按下对齐
            c = Image.new('RGB', (1, 1))
            for k, s in enumerate(sides):
                s['_shift'] = tt[k]
            # render 用各自的平移
            for s in sides:
                s['_t'] = t + s['_shift']
            cimg = Image.new('RGB', (OW, OH), (24, 24, 26)); D = ImageDraw.Draw(cimg)
            for k, s in enumerate(sides):
                x0 = k * (cw + G); ts = s['_t']
                cimg.paste(frame_at(s, ts), (x0, TOP))
                D.text((x0 + 12, 10), s['lab'], fill=(255, 255, 255), font=F)
                busy = any(a <= ts <= b for a, b in s['bz'])
                down = any(0 <= ts - d <= 80 for d in s['dn'])
                col = (235, 70, 60) if busy else (70, 70, 74)
                D.rounded_rectangle((x0 + 12, 52, x0 + 330, 86), 8, fill=col)
                D.text((x0 + 24, 56), ('主线程忙：切页时同步 %dms' % s['busy']) if busy else '主线程空闲', fill=(255, 255, 255), font=FS)
                if down: D.ellipse((x0 + cw - 50, 56, x0 + cw - 24, 82), fill=(80, 170, 255))
            D.text((12, OH - 50), ('1/4 慢放' if slow else '实速') + '   第 %d 次点击   t = %+5.0f ms（以按下为 0）' % (i + 1, t), fill=(220, 220, 220), font=FB)
            D.text((OW - 470, OH - 46), '蓝点 = 按下 80ms   红条 = 主线程长任务', fill=(170, 170, 170), font=FS)
            cimg.save(f'{tmp}/f{idx:05d}.png'); idx += 1
print('frames', idx, (OW, OH))
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', '60', '-i', f'{tmp}/f%05d.png', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-preset', 'veryfast', outp], check=True)
print('wrote', outp)
