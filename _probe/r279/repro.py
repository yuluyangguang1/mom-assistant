# 第 279 次：侧拉页 + 子面板叠层复现（WebKit iPhone 视口，真 TouchEvent）。不提交。
import sys, json
sys.path.insert(0, '/workspace/work/mom-assistant/tests')
import regression as R
from playwright.sync_api import sync_playwright

T = r"""([x0,y0,x1,y1,end,steps,ms])=>new Promise(res=>{const t=document.elementFromPoint(x0,y0)||document.body;
 const mk=(x,y)=>{try{return new Touch({identifier:1,target:t,clientX:x,clientY:y,pageX:x,pageY:y+scrollY})}catch(_){return {identifier:1,target:t,clientX:x,clientY:y,pageX:x,pageY:y+scrollY,screenX:x,screenY:y}}};
 const fire=(ty,x,y)=>{const tt=(ty==='touchend'||ty==='touchcancel')?[]:[mk(x,y)];let e;try{e=new TouchEvent(ty,{bubbles:true,cancelable:true,touches:tt,targetTouches:tt,changedTouches:[mk(x,y)]})}catch(_){e=new Event(ty,{bubbles:true,cancelable:true});Object.defineProperty(e,'touches',{value:tt});Object.defineProperty(e,'targetTouches',{value:tt});Object.defineProperty(e,'changedTouches',{value:[mk(x,y)]})}t.dispatchEvent(e);return e};
 fire('touchstart',x0,y0);const n=Math.max(1,steps);let i=0;
 const step=()=>{i++;fire('touchmove',x0+(x1-x0)*i/n,y0+(y1-y0)*i/n);if(i<n)setTimeout(step,ms);else{if(end==='cancel')setTimeout(()=>{fire('touchcancel',x1,y1);res(1)},0);else if(end==='none')res(1);else setTimeout(()=>{fire('touchend',x1,y1);res(1)},end===2?150:0)}};
 setTimeout(step,ms)})"""
ST = """(()=>{const r=document.getElementById('sideDrawer'),a=document.getElementById('app'),m=document.getElementById('sdMask');
 const mk=[...document.querySelectorAll('#modalRoot > .modal-mask')].filter(x=>!x.classList.contains('sheet-leaving')).length;
 return {open:Drawer.isOpen(),cls:['sd-open','sd-lock','sd-drag'].filter(c=>document.body.classList.contains(c)).join(','),
  left:r?Math.round(r.getBoundingClientRect().left):null, appX:Math.round(new DOMMatrix(getComputedStyle(a).transform).m41),
  inl:(r?r.style.transform:'')+'|'+a.style.transform, mask:m?getComputedStyle(m).opacity+'/'+getComputedStyle(m).visibility:'', sheets:mk,
  st:JSON.stringify(history.state), tab:App.currentTab(), rad:r?getComputedStyle(r).borderRadius+'/'+getComputedStyle(r).boxShadow:''}})()"""

def run(engine):
    fails = []
    def ok(name, c, d=''):
        print(('PASS ' if c else 'FAIL ') + name + ('' if c else '  ← ' + json.dumps(d, ensure_ascii=False)))
        if not c: fails.append(name)
    with sync_playwright() as pw:
        br = getattr(pw, engine).launch()
        ctx = br.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=(engine=='webkit') and False, device_scale_factor=2)
        p = ctx.new_page(); errs = []
        p.on('pageerror', lambda e: errs.append(str(e)[:200]))
        p.goto(R.URL); p.wait_for_timeout(700); p.evaluate('t=>Storage.importJSON(t)', R.SEED_V3); p.reload(); p.wait_for_timeout(1000)
        ev = p.evaluate; drag = lambda *a: ev(T, list(a)); st = lambda: ev(ST)
        def reset():
            ev("Sheet.closeAll&&Sheet.closeAll()"); ev("Drawer.isOpen()&&Drawer.close()"); p.wait_for_timeout(700)
        # 1 面板开着时在侧拉页上左滑
        ev("Drawer.open()"); p.wait_for_timeout(600)
        ev("document.querySelector('#sideDrawer [data-sd=swap]').click()"); p.wait_for_timeout(500)
        s = st(); ok('切换宝宝面板盖在侧拉页上，登记自己的 history（ov）', s['sheets'] == 1 and s['open'] and '"ov"' in s['st'], s)
        drag(330, 200, 60, 204, False, 8, 16); p.wait_for_timeout(40)
        s = st(); ok('面板开着时在侧拉页上左拉：侧拉页不跟手', s['left'] == 0 and 'sd-drag' not in s['cls'], s)
        ev(T, [60, 204, 60, 204, True, 0, 0]) if False else None
        drag(60, 204, 59, 204, True, 1, 0); p.wait_for_timeout(800)
        s = st(); ok('松手后：侧拉页和面板都还开着（不会只关侧拉页、留下孤立面板）', s['open'] and s['sheets'] == 1 and s['left'] == 0, s)
        # 2 侧拉页关闭时一并关子面板：Esc 两次 / mask / 系统返回 / Drawer.close
        ev("Drawer.close()"); p.wait_for_timeout(900)
        s = st(); ok('侧拉页关闭（Drawer.close）时子面板一起关、history 退干净', (not s['open']) and s['sheets'] == 0 and s['st'] in ('null',) , s)
        reset()
        ev("Drawer.open()"); p.wait_for_timeout(600); ev("document.querySelector('#sideDrawer [data-sd=swap]').click()"); p.wait_for_timeout(500)
        ev("history.back()"); p.wait_for_timeout(700)
        s = st(); ok('系统返回：先关面板、侧拉页留着，history 站在侧拉页那条上', s['open'] and s['sheets'] == 0 and s['st'] == '{"baoma":"drawer"}', s)
        ev("history.back()"); p.wait_for_timeout(900)
        s = st(); ok('再返回：侧拉页关，history 回到首页', (not s['open']) and s['st'] == 'null' and s['cls'] == '', s)
        for sync in (False, True):
            tag = '（同步切页，等同 iOS）' if sync else '（转场切页）'
            if sync: ev("window.__svt=document.startViewTransition;document.startViewTransition=undefined")
            ev("Drawer.open()"); p.wait_for_timeout(600); ev("document.querySelector('#sideDrawer [data-sd=swap]').click()"); p.wait_for_timeout(500)
            ev("document.querySelector('#sheetManage').click()"); p.wait_for_timeout(2500)
            s = st(); ok('面板里「宝宝设置」跳设置页：侧拉页连同面板一起收起' + tag, s['tab'] == 'settings' and not s['open'] and s['sheets'] == 0 and s['cls'] == '' and '"drawer"' not in s['st'] and '"ov"' not in s['st'] and '"guard"' not in s['st'], s)
            ev("history.back()"); p.wait_for_timeout(700); ev("history.back()"); p.wait_for_timeout(900)
            s = st(); ok('接着返回两次：回到首页，history 回到第一条、侧拉页不再出现' + tag, s['tab'] == 'home' and not s['open'] and s['st'] == 'null' and s['cls'] == '', s)
            if sync: ev("delete document.startViewTransition")
            ev("App.currentTab()!=='home'&&App.showTab('home')"); p.wait_for_timeout(600)
        # 3 拖拽中途 touchcancel
        drag(6, 420, 6 + 150, 424, 'cancel', 8, 16); p.wait_for_timeout(900)
        s = st(); ok('拉开途中 touchcancel：落到全开或全关，无内联位移', ('sd-drag' not in s['cls']) and s['inl'] == '|' and (s['left'] in (0,) if s['open'] else s['cls'] == ''), s)
        reset()
        drag(6, 420, 6 + 220, 424, 'none', 8, 16); p.wait_for_timeout(40)
        ok('拉开时（还在拖）就已登记 history：系统快照取的是没推开的首页', '"drawer"' in st()['st'], st())
        p.wait_for_timeout(1500)
        s = st(); ok('拖到一半手指不动也不离开（系统手势吞掉 touchend）：兜底落定', 'sd-drag' not in s['cls'] and s['inl'] == '|', s)
        reset()
        s = st(); ok('全部关闭后首页完全复位（无位移、无压暗、无锁）', s['cls'] == '' and s['appX'] == 0 and s['mask'].startswith('0/') and s['st'] == 'null', s)
        # 4 拖拽过程中无圆角阴影
        drag(6, 420, 6 + 150, 424, 'none', 8, 16); p.wait_for_timeout(40)
        s = st(); ok('拖动中侧拉页无圆角无阴影', s['rad'] == '0px/none', s)
        p.screenshot(path='/workspace/work/mom-assistant/_probe/r279/drag_%s.png' % engine)
        drag(156, 424, 300, 424, True, 4, 16); p.wait_for_timeout(900)
        ok('pageerror 为 0', not errs, errs)
        br.close()
    return fails

if __name__ == '__main__':
    for e in (sys.argv[1:] or ['webkit']):
        print('==', e); f = run(e); print(e, 'FAILS', len(f))
