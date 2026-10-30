"""第 328 次：实时录屏（CDP Page.startScreencast，每个合成帧一张，带合成时刻），主线程在切页 click 里同步忙 N ms。
python3 rec.py <main|proto> <outdir> [busy] [dpr]
动作：首页 → 点「日历」（忙 busy）→ 1.2s → 点「宝宝」（忙 busy）→ 1.2s → 点「首页」（忙 busy）。输出 outdir/frames/*.jpg + meta.json（帧时刻、按下 / click / 忙碌窗口时刻）"""
import sys, os, json, base64, time
sys.path.insert(0, '.')
from h328 import *
which, outdir = sys.argv[1], sys.argv[2]
busy = int(sys.argv[3]) if len(sys.argv) > 3 else 200
dpr = float(sys.argv[4]) if len(sys.argv) > 4 else 1
root = MAIN if which == 'main' else PROTO
INIT = "document.addEventListener('click',e=>{if(window.__busyMs&&e.target.closest&&e.target.closest('#tabbar .dk-tab')){const t=performance.now();(window.__bz=window.__bz||[]).push([t,0]);while(performance.now()-t<__busyMs);window.__bz[window.__bz.length-1][1]=performance.now();}},true);" \
       "window.addEventListener('pointerdown',e=>{(window.__dn=window.__dn||[]).push(performance.now())},true);"
os.makedirs(outdir + '/frames', exist_ok=True)
for f in os.listdir(outdir + '/frames'): os.remove(outdir + '/frames/' + f)
with sync_playwright() as pw:
    b, p, errs = open_page(pw, root, 'chromium', dpr=dpr, init=INIT)
    p.wait_for_timeout(1500)
    T = {t[2]: t for t in p.evaluate("[...document.querySelectorAll('#tabbar .tab.dk-tab')].map(t=>{const r=t.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2,t.dataset.tab]})")}
    br = p.evaluate("(()=>{const r=document.getElementById('tabbar').getBoundingClientRect();return [r.left,r.top,r.width,r.height]})()")
    cdp = p.context.new_cdp_session(p)
    frames = []
    def onf(ev):
        frames.append((ev['metadata']['timestamp'], ev['data']))
        try: cdp.send('Page.screencastFrameAck', {'sessionId': ev['sessionId']})
        except Exception: pass
    cdp.on('Page.screencastFrame', onf)
    # 页面时钟 ↔ 截屏时间戳（秒，墙钟）对齐
    off = p.evaluate("Date.now()-performance.now()")
    cdp.send('Page.startScreencast', {'format': 'jpeg', 'quality': 85, 'everyNthFrame': 1})
    p.wait_for_timeout(600)
    p.evaluate(f"window.__busyMs={busy}")
    s0=p.evaluate('DockRefract._wseq||0') if which=='proto' else 0
    if which=='proto': p.evaluate('DockRefract._wperf(true)')
    for name in ('calendar', 'baby', 'home'):
        x, y, _ = T[name]; p.mouse.move(x, y); p.mouse.down(); p.wait_for_timeout(80); p.mouse.up(); p.wait_for_timeout(1300)
    cdp.send('Page.stopScreencast')
    wf=None
    if which=='proto':
        s1=p.evaluate('DockRefract._wseq||0'); p.evaluate('DockRefract._wperf(false)')
        for _ in range(40):
            if p.evaluate('DockRefract._wseq||0')>s1+0: break
            p.wait_for_timeout(50)
        wf=p.evaluate('DockRefract._wperf(false)')['frames']
    st=p.evaluate('JSON.stringify(DockRefract._stats())')
    p.wait_for_timeout(300)
    meta = {'which': which, 'busy': busy, 'dpr': dpr, 'bar': br, 'off': off, 'downs': p.evaluate("window.__dn||[]"), 'busyWin': p.evaluate("window.__bz||[]"),
            'worker': p.evaluate("DockRefract._stats().worker"), 'frames': [], 'wframes': wf, 'stats': st, 'wl': p.evaluate('LiquidDock._wl&&LiquidDock._wl()')}
    for i, (ts, data) in enumerate(frames):
        fn = f'{outdir}/frames/f{i:04d}.jpg'
        open(fn, 'wb').write(base64.b64decode(data))
        meta['frames'].append([ts * 1000 - off, fn])   # → 页面 performance.now 时间轴（ms）
    json.dump(meta, open(outdir + '/meta.json', 'w'))
    print(which, 'frames', len(frames), 'worker', meta['worker'], errs[:3])
    b.close()
