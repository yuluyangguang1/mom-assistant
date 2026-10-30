"""第 328 次：busy.png——切页时主线程同步忙 200ms，透镜中心进度随时间（每个点 = 画出的一帧）。python3 plot.py <main.json> <proto.json> <out.png> [busy]"""
import sys, json
import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import font_manager as fm
import os
fm.fontManager.addfont(os.path.expanduser('~/.fonts/wqy-microhei.ttc'))
plt.rcParams['font.family'] = 'WenQuanYi Micro Hei'
sys.path.insert(0, os.path.dirname(__file__))
from analyze import vis_frames
mj, pj, outp = sys.argv[1:4]; BUSY = int(sys.argv[4]) if len(sys.argv) > 4 else 200
INK = '#1d1d1f'; BG = '#e8e8ea'
def pick(D, wm):
    best = None
    for r in D['taps']:
        if r['busy'] != BUSY or not r.get('clicks'): continue
        d, fr = vis_frames(r, wm)
        if not fr: continue
        x0, xT = r['x0'], r['xT']
        pts = [(t - d, (x - x0) / (xT - x0) * 100) for t, x, k in fr if x is not None]
        ck = r['clicks'][0]['h'] - d
        if best is None or len(pts) > 3: best = (pts, ck, r); break
    return best
M = json.load(open(mj)); P = json.load(open(pj))
pm, ckm, rm = pick(M, False); pp, ckp, rp = pick(P, True)
ref = P['ref']['frames']; x0 = ref[0]['x']; tx = ref[0]['tx']
rpts = [(i * 1000 / 60, (f['x'] - x0) / (tx - x0) * 100) for i, f in enumerate(ref) if f]
fig, ax = plt.subplots(figsize=(8.4, 4.4), dpi=200)
fig.patch.set_facecolor(BG); ax.set_facecolor(BG)
ax.axvspan(ckp, ckp + BUSY, color=INK, alpha=0.07, lw=0)
ax.text(ckp + BUSY / 2, 6, f'主线程长任务 {BUSY}ms\n（切页 click 里同步跑）', ha='center', va='bottom', fontsize=10, color=(0.11, 0.11, 0.12, 0.6))
ax.plot([t for t, _ in rpts], [v for _, v in rpts], ls='--', lw=1.2, color=(0.11, 0.11, 0.12, 0.3))
ax.text(rpts[-1][0] + 6, rpts[-1][1] - 4, '60Hz 参考', fontsize=10, color=(0.11, 0.11, 0.12, 0.45))
ax.plot([t for t, _ in pm], [v for _, v in pm], '-o', lw=1.5, ms=4, color=(0.11, 0.11, 0.12, 0.5), drawstyle='steps-post')
ax.plot([t for t, _ in pp], [v for _, v in pp], '-o', lw=1.5, ms=4, color=INK, drawstyle='steps-post')
ax.text(pm[-1][0] + 8, pm[-1][1] - 10, 'main（主线程渲染）', fontsize=11, color=(0.11, 0.11, 0.12, 0.6))
ax.text(pp[-1][0] + 8, pp[-1][1] + 3, '原型（Worker 渲染）', fontsize=11, color=INK)
ax.set_xlim(-10, max(pm[-1][0], pp[-1][0]) + 150); ax.set_ylim(-5, 112)
ax.set_xlabel('按下后时间（ms）', fontsize=11, color=(0.11, 0.11, 0.12, 0.5)); ax.set_ylabel('透镜中心进度（%）', fontsize=11, color=(0.11, 0.11, 0.12, 0.5))
for s in ('top', 'right'): ax.spines[s].set_visible(False)
for s in ('left', 'bottom'): ax.spines[s].set_color((0.11, 0.11, 0.12, 0.2))
ax.tick_params(length=0, colors=(0.11, 0.11, 0.12, 0.5), labelsize=10)
ax.yaxis.grid(True, color=(0.11, 0.11, 0.12, 0.07)); ax.set_axisbelow(True)
fig.suptitle('切页时主线程忙 200ms：Worker 透镜照常走完，主线程透镜停住再跳', x=0.02, ha='left', fontsize=14, color=INK, y=0.98)
ax.set_title('每个点 = 实际画出的一帧（阶梯 = 屏幕上停留）；Chromium 无头 · 软件 GL · 0.5 倍 DPR', loc='left', fontsize=10, color=(0.11, 0.11, 0.12, 0.5))
fig.tight_layout(rect=(0, 0, 1, 0.93))
fig.savefig(outp, facecolor=BG)
print('main', [(round(t), round(v)) for t, v in pm]); print('proto', [(round(t), round(v)) for t, v in pp])
