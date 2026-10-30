"""第 328 次：bench.py 结果汇总 → markdown 表 + json。python3 analyze.py out.md data/b_*.json"""
import sys, json, statistics as stt
outmd = sys.argv[1]; files = sys.argv[2:]

def med(a): return round(stt.median(a), 1) if a else None
def mx(a): return round(max(a), 1) if a else None

def vis_frames(rec, wm):
    """透镜「画出来」的帧时刻（主线程时间轴）+ 每帧中心 x"""
    d = rec['downs'][0]['h'] if rec.get('downs') else None
    if wm and rec.get('wframes'):
        fr = [(f['t'], f.get('x'), f['k']) for f in rec['wframes']]
    else:
        lf = rec.get('lensFrames') or []
        # 主线程：每次 lensFrame 跑完当场读的透镜中心（探针包住 rAF）；最后一帧（end）透镜已收，补 end 记录
        sm = rec.get('samples', [])
        fr = [(s_['t'], s_['x'], s_['ph']) for s_ in sm]
        ends = [f for f in lf if f['k'] == 'end']
        if ends: fr.append((ends[-1]['t'] + 0.5, fr[-1][1] if fr else None, 'end'))
    if d is not None:
        fr = [(t, x, k) for (t, x, k) in fr if t >= d - 1]
    return d, fr

def tap_metrics(rec, wm, ref):
    d, fr = vis_frames(rec, wm)
    if d is None or not fr: return None
    ts = [d] + [f[0] for f in fr]
    iv = [b - a for a, b in zip(ts, ts[1:])]
    end = next((f[0] for f in fr if f[2] == 'end'), fr[-1][0])
    x0 = rec['x0']; xT = rec['xT']
    def prog(tau):
        cand = [f for f in fr if f[0] <= d + tau and f[1] is not None]
        if not cand: return 0.0
        return round((cand[-1][1] - x0) / (xT - x0) * 100, 1) if xT != x0 else None
    ck = rec['clicks'][0]['h'] if rec.get('clicks') else None
    busy = rec['busy']
    inwin = sum(1 for f in fr if ck is not None and ck < f[0] < ck + busy) if busy else None
    # 主线程每帧耗时（透镜动画期间）
    mf = [f for f in rec.get('frames', []) if d - 1 <= f['t'] <= end + 1]
    return {'busy': busy, 'maxIv': mx(iv), 'n33': sum(1 for v in iv if v > 33.4), 'n50': sum(1 for v in iv if v > 50), 'n100': sum(1 for v in iv if v > 100),
            'frames': len(fr), 'p67': prog(67), 'p133': prog(133), 'p200': prog(200), 'end': round(end - d, 1), 'inBusy': inwin,
            'mainBusyMed': med([f['busy'] for f in mf]), 'mainBusyMax': mx([f['busy'] for f in mf if not (ck and ck - 2 <= f['t'] - f['dt'] <= ck + busy + 30)]) if mf else None,
            'firstFrame': round(fr[0][0] - rec['downs'][0]['ts'], 1) if rec.get('downs') else None,
            'wwork': med([f['work'] for f in rec.get('wframes') or []]) if wm else None,
            'held': (rec.get('wl') or {}).get('held'), 'shrinkLag': (rec.get('wl') or {}).get('shrinkLag'), 'mirrorGap': round((rec.get('wl') or {}).get('maxGap') or 0, 1) if wm else None,
            'ok': rec['cur'] == rec['to']}

def ref_metrics(ref):
    fr = ref['frames']; x0 = fr[0]['x'] if fr[0] else None
    xs = [f['x'] for f in fr if f]; tx = fr[0]['tx']
    # 参考：按下那一刻透镜从当前胶囊中心起步（x0），终点 tx
    p = lambda k: round((fr[k]['x'] - x0) / (tx - x0) * 100, 1) if k < len(fr) and fr[k] else None
    endk = next((i for i, f in enumerate(fr) if f is None), len(fr))
    return {'p4': p(4), 'p8': p(8), 'p12': p(12), 'endFrames': endk, 'endMs': round(endk * 1000 / 60, 1)}

def drag_metrics(rec, wm):
    mv = rec.get('moves') or []
    if len(mv) < 10: return None
    if wm and rec.get('wframes'): fr = [(f['t'], f.get('x')) for f in rec['wframes'] if f.get('x') is not None]
    else: fr = [(s['t'], s['x']) for s in rec.get('samples', [])]
    t_first, t_last = mv[0]['h'], mv[-1]['h']
    lags = []
    for (t, x) in fr:
        if not (t_first + 100 < t < min(t_last, t_first + 420)): continue   # 只取指针还在首尾页签之间（300pt/s × 0.42s ≈ 宝宝→日历），过了端点是橡皮筋，透镜本就不跟
        # 指针在 x 处的时刻（主线程收到 move 的时刻，线性插值）
        for a, b in zip(mv, mv[1:]):
            if a['x'] <= x <= b['x'] and b['x'] > a['x']:
                tp = a['ts'] + (b['ts'] - a['ts']) * (x - a['x']) / (b['x'] - a['x'])   # 事件时间戳（手指真的在那里的时刻）
                lags.append(t - tp); break
    q = [m['h'] - m['ts'] for m in mv]
    lg = sorted(lags)
    p90 = round(lg[int(len(lg) * 0.9)], 1) if lg else None
    return {'busy': rec['busy'], 'lagMed': med(lags), 'lagMax': mx(lags), 'lagP90': p90, 'n': len(lags), 'inputDelayMed': med(q), 'inputDelayMax': mx(q)}

def predown_metrics(rec, wm):
    if not rec.get('downs'): return None
    dn = rec['downs'][0]
    _, fr = vis_frames(rec, wm)
    intended = (rec['blk'][2] if len(rec.get('blk') or []) > 2 and rec['blk'][2] else rec['blk'][0]) + 50
    return {'eventDelay': round(dn['h'] - intended, 1), 'blkEndToHandler': round(dn['h'] - rec['blk'][1], 1) if rec.get('blk') and rec['blk'][1] else None,
            'firstLensFrame': round(fr[0][0] - dn['ts'], 1) if fr else None}

rows = []
allres = {}
# 同一「引擎·版本」的多份数据合并（main / 原型交替跑的几轮放一起算）
merged = {}
for f in files:
    D = json.load(open(f)); key = f"{D['engine']}·{D['root']}"
    if key not in merged: merged[key] = D; D['nfiles'] = 1; D['loads'] = [D.get('load0'), D.get('load1')]
    else:
        M = merged[key]; M['nfiles'] += 1; M['loads'] += [D.get('load0'), D.get('load1')]
        for k in ('taps', 'drags', 'predown'): M[k] = M.get(k, []) + D.get(k, [])
for key, D in merged.items():
    wm = D.get('worker') == 'on'
    R = {'nfiles': D['nfiles'], 'loads': D['loads'], 'worker': D.get('worker'), 'wfail': D.get('wfail'), 'renderer': D.get('renderer'), 'ref': ref_metrics(D['ref']) if D.get('ref') else None}
    taps = [tap_metrics(r, wm, R['ref']) for r in D['taps']]
    taps = [t for t in taps if t]
    R['taps'] = taps
    by = {}
    for t in taps: by.setdefault(t['busy'], []).append(t)
    R['bybusy'] = {}
    for bz, L in sorted(by.items()):
        R['bybusy'][bz] = {'n': len(L), 'maxIv': mx([t['maxIv'] for t in L]), 'maxIvMed': med([t['maxIv'] for t in L]), 'n33': round(stt.mean([t['n33'] for t in L]), 1), 'n50': round(stt.mean([t['n50'] for t in L]), 1),
                           'n100': round(stt.mean([t['n100'] for t in L]), 1), 'frames': med([t['frames'] for t in L]),
                           'p67': med([t['p67'] for t in L]), 'p133': med([t['p133'] for t in L]), 'p200': med([t['p200'] for t in L]), 'end': med([t['end'] for t in L]),
                           'inBusy': med([t['inBusy'] for t in L]) if bz else None, 'mainBusyMed': med([t['mainBusyMed'] for t in L if t['mainBusyMed'] is not None]),
                           'firstFrame': med([t['firstFrame'] for t in L if t['firstFrame'] is not None]), 'wwork': med([t['wwork'] for t in L if t['wwork'] is not None]),
                           'held': sum((t['held'] or 0) for t in L) if wm else None, 'shrinkLag': med([x for t in L for x in (t['shrinkLag'] or [])]) if wm else None,
                           'mirrorGap': mx([t['mirrorGap'] for t in L if t['mirrorGap'] is not None]) if wm else None, 'ok': all(t['ok'] for t in L)}
    R['drags'] = [drag_metrics(r, wm) for r in D.get('drags', [])]
    R['predown'] = [predown_metrics(r, wm) for r in D.get('predown', [])]
    allres[key] = R
json.dump(allres, open(outmd.replace('.md', '.json'), 'w'), ensure_ascii=False, indent=1)
L = []
for k, R in allres.items():
    L.append(f"### {k}（Worker：{R['worker']}{' / ' + R['wfail'] if R.get('wfail') else ''}；{R['nfiles']} 轮；1 分钟负载 {[round(x[0],1) for x in R['loads'] if x]}）\n")
    if R['ref']: L.append(f"60Hz 参考（手动时钟）：+4 帧 {R['ref']['p4']}%、+8 帧 {R['ref']['p8']}%、+12 帧 {R['ref']['p12']}%，{R['ref']['endFrames']} 帧收完（{R['ref']['endMs']}ms）\n")
    L.append('| 切页时主线程忙 | 次数 | 最大帧间隔 ms（中位/最大） | >33ms 帧 | >50ms | >100ms | 忙碌窗口内画出的透镜帧 | +67/+133/+200ms 进度 % | 收完 ms | 主线程每帧耗时中位 ms | Worker 每帧耗时中位 ms | 首帧 ms | 切页成功 |')
    L.append('|---|---|---|---|---|---|---|---|---|---|---|---|---|')
    for bz, s in R['bybusy'].items():
        L.append(f"| {bz} | {s['n']} | {s['maxIvMed']} / {s['maxIv']} | {s['n33']} | {s['n50']} | {s['n100']} | {s['inBusy'] if s['inBusy'] is not None else '—'} | {s['p67']} / {s['p133']} / {s['p200']} | {s['end']} | {s['mainBusyMed']} | {s['wwork'] if s['wwork'] is not None else '—'} | {s['firstFrame']} | {'✓' if s['ok'] else '✗'} |")
    L.append('')
    if any(R['drags']): L.append('拖动：' + '；'.join(f"忙 {d['busy']}ms：跟手滞后中位 {d['lagMed']}ms / P90 {d['lagP90']}ms，输入事件排队中位 {d['inputDelayMed']} / 最大 {d['inputDelayMax']}ms" for d in R['drags'] if d))
    L.append('按下前主线程已忙 200ms：' + '；'.join(f"按下处理比预定时刻晚 {p['eventDelay']}ms（长任务结束后 {p['blkEndToHandler']}ms）" for p in R['predown'] if p))
    L.append('')
open(outmd, 'w').write('\n'.join(L))
print('\n'.join(L))
