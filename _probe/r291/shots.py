import sys, os
sys.path.insert(0, '/workspace/work/mom-assistant/tests')
import regression as R
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw, ImageFont
OUT = '/workspace/work/fix291'
T2 = R.TOUCH2_JS
BOTTLE = """const z=n=>String(n).padStart(2,'0'),x=new Date(Date.now()-40*60e3),y=new Date(Date.now()-5*60e3),fd=d=>d.getFullYear()+'-'+z(d.getMonth()+1)+'-'+z(d.getDate())+'T'+z(d.getHours())+':'+z(d.getMinutes());
s.feedings.push({id:'bt291s',type:'bottle',start:fd(x),amount:150,amountBm:110,amountFm:40,side:'left',note:null});
s.feedings.push({id:'pp291s',type:'pump',start:fd(y),amount:90,amountL:45,amountR:45,side:null,note:null});"""
errs_all = []
def shot(b, name, w, h, dark, fs=None, setup='', act=None):
    ctx = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2, has_touch=True)
    p = ctx.new_page(); errs = []
    p.on('pageerror', lambda e: errs.append(str(e)[:200]))
    p.goto(R.URL); p.wait_for_timeout(600); p.evaluate('t=>Storage.importJSON(t)', R.SEED_V3); p.reload(); p.wait_for_timeout(1100)
    p.evaluate("([d,f])=>{const s=Storage.get();s.settings.themeMode=d?'dark':'light';" + setup + "Storage.save();App.applyTheme();if(f)App.setFontScale(f);App.rerender()}", [dark, fs]); p.wait_for_timeout(900)
    if act: act(p)
    f = f'/tmp/r291s_{name}_{"d" if dark else "l"}.png'; p.screenshot(path=f)
    if errs: errs_all.append((name, errs))
    ctx.close(); return f
def mid_swipe(p):
    p.evaluate("App.showTab('home',{noVT:true})"); p.wait_for_timeout(1500)
    p.evaluate(T2, [340, 420, 200, 420, 'none', 8, 16]); p.wait_for_timeout(120)
def cal(p):
    p.evaluate("App.showTab('calendar',{noVT:true})"); p.wait_for_timeout(1200); p.evaluate("scrollTo(0,document.body.scrollHeight)"); p.wait_for_timeout(500)
def plus(p):
    p.evaluate("document.querySelector('.tabbar [data-qd-toggle]').click()"); p.wait_for_timeout(900)
def tab(t):
    def a(p):
        p.evaluate("t=>App.showTab(t,{noVT:true})", t); p.wait_for_timeout(1500)
    return a
WN = R.R291_LIVE_SET['wn']; BOTH = R.R291_LIVE_SET['both']
sets = [
  ('home_swipe', '首页左滑进日期页（中途）', dict(w=390, h=844, act=mid_swipe)),
  ('calendar', '日期页（无底部快捷条）', dict(w=390, h=844, setup=BOTTLE+"for(const m of [20,90,150,200]){const q=new Date(Date.now()-m*60e3);s.diapers.push({id:'dp'+m,type:m%40?'wet':'both',time:fd(q),note:null})}", act=cal)),
  ('plus_feed', '＋面板「喂奶」一行', dict(w=390, h=844, setup=BOTTLE, act=plus)),
  ('plus_feed320', '＋面板 320+1.33', dict(w=320, h=640, fs='xl', setup=BOTTLE, act=plus)),
  ('live_wn', '胶囊·白噪音页', dict(w=390, h=844, setup=WN, act=tab('whitenoise'))),
  ('live_sleep', '胶囊·睡眠页', dict(w=390, h=844, setup=BOTH, act=tab('sleep'))),
  ('live_320', '胶囊 320+1.33', dict(w=320, h=640, fs='xl', setup=BOTH, act=tab('diaper'))),
]
which = sys.argv[1].split(',')
with sync_playwright() as pw:
    b = pw.chromium.launch()
    for key, label, kw in sets:
        if key not in which: continue
        for dark in (False, True):
            shot(b, key, dark=dark, **kw)
    b.close()
print('ERRS', errs_all)
