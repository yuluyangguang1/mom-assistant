"""第 328 次：drag2.py 结果 → 跟手表。python3 drag2_an.py out.md data/g_*.json"""
import sys, json, statistics as st
outmd = sys.argv[1]; files = sys.argv[2:]
def q(a, p): a = sorted(a); return round(a[min(len(a) - 1, int(len(a) * p))], 1) if a else None
def med(a): return round(st.median(a), 1) if a else None
res = {}
for f in files:
    D = json.load(open(f)); wm = D.get('worker') == 'on'; key = f"{D['engine']}·{D['root']}"
    R = res.setdefault(key, {'worker': D.get('worker'), 'by': {}})
    for r in D['drags']:
        o = r['o']; v = r['v']; tS = o['tS']; T = o['T']; x0 = r['x0']
        fr = [(w['t'], w['x']) for w in (r.get('wframes') or []) if w.get('x') is not None] if wm else [(s['t'], s['x']) for s in r['samples']]
        fr = [(t, x) for t, x in fr if tS + 60 <= t <= tS + T]          # 手指在两页签之间匀速移动的那段（去掉起步 60ms）
        lag = [((x0 + v * (t - tS)) - x) / v for t, x in fr]
        ts = [tS + 60] + [t for t, _ in fr] + [tS + T]
        gaps = [b - a for a, b in zip(ts, ts[1:])]
        bz = o.get('bz'); inb = None; lagB = None
        if bz:
            inb = sum(1 for t, _ in fr if bz[0] < t < bz[1])
            lb = [l for (t, _), l in zip(fr, lag) if bz[0] <= t <= bz[1] + 50]
            lagB = max(lb) if lb else None
        mvq = [b[0] - a[0] for a, b in zip(o['moves'], o['moves'][1:])]
        R['by'].setdefault(r['busy'], []).append({'med': med(lag), 'p90': q(lag, .9), 'max': round(max(lag), 1) if lag else None, 'gap': round(max(gaps), 1), 'n': len(fr), 'inb': inb, 'lagB': round(lagB, 1) if lagB is not None else None, 'mvGap': round(max(mvq), 1) if mvq else None})
L = ['| 引擎·版本 | 拖动中主线程忙 | 次数 | 跟手滞后 中位 ms | P90 ms | 最大 ms | 透镜最大帧间隔 ms | 忙碌窗口内透镜帧 | 指针事件最大间隔 ms |', '|---|---|---|---|---|---|---|---|---|']
for k, R in res.items():
    for bz, A in sorted(R['by'].items()):
        L.append(f"| {k} | {bz} | {len(A)} | {med([a['med'] for a in A if a['med'] is not None])} | {med([a['p90'] for a in A if a['p90'] is not None])} | {max([a['max'] for a in A if a['max'] is not None], default=None)} | {med([a['gap'] for a in A])} | {med([a['inb'] for a in A]) if bz else '—'} | {med([a['mvGap'] for a in A])} |")
open(outmd, 'w').write('\n'.join(L) + '\n'); json.dump(res, open(outmd.replace('.md', '.json'), 'w'), ensure_ascii=False, indent=1)
print('\n'.join(L))
