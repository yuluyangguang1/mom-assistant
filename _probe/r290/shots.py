import sys, json, threading, http.server, functools, socketserver, os
sys.path.insert(0, '/workspace/work/mom-assistant/tests')
from seed_data import seed
from playwright.sync_api import sync_playwright
SEED=json.dumps(dict(seed,version=3),ensure_ascii=False)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*a): pass
srv=socketserver.ThreadingTCPServer(('127.0.0.1',0),functools.partial(Q,directory='/workspace/work/mom-assistant')); port=srv.server_address[1]
threading.Thread(target=srv.serve_forever,daemon=True).start()
URL=f'http://127.0.0.1:{port}/index.html'
T2=open('/workspace/work/mom-assistant/tests/regression.py').read().split('TOUCH2_JS = r"""')[1].split('"""')[0]
out=[]
def shot(b, name, w, h, dark, fs='normal', hand='normal', dragpx=0):
    ctx=b.new_context(viewport={'width':w,'height':h}, device_scale_factor=2, has_touch=True)
    p=ctx.new_page(); errs=[]
    p.on('pageerror', lambda e: errs.append(str(e)))
    p.goto(URL); p.wait_for_timeout(600); p.evaluate('t=>Storage.importJSON(t)', SEED); p.reload(); p.wait_for_timeout(1200)
    p.evaluate("([d,f,h])=>{const s=Storage.get().settings;s.themeMode=d?'dark':'light';s.handMode=h;Storage.save();App.applyTheme();App.setFontScale(f);App.buildTabbar()}", [dark, fs, hand]); p.wait_for_timeout(500)
    p.evaluate("document.getElementById('avatarBtn').click()"); p.wait_for_timeout(900)
    if dragpx:
        g=p.evaluate("(()=>{const e=document.querySelector('#qdActions .qd-grab').getBoundingClientRect();return [Math.round(e.left+e.width/2),Math.round(e.top+e.height/2)]})()")
        p.evaluate(T2,[g[0],g[1],g[0],g[1]+dragpx,'none',8,16]); p.wait_for_timeout(200)
    f=f'/tmp/r290s_{name}.png'; p.screenshot(path=f); out.append((name,f)); print(name, errs)
    ctx.close()
with sync_playwright() as pw:
    b=pw.chromium.launch()
    shot(b,'390 浅色',390,844,False)
    shot(b,'390 深色',390,844,True)
    shot(b,'320 · 1.33 浅色',320,640,False,'xl')
    shot(b,'320 · 1.33 深色',320,640,True,'xl')
    shot(b,'下拉关闭中',390,844,False,dragpx=150)
    shot(b,'左手竖排 深色',390,844,True,hand='left')
    b.close()
from PIL import Image, ImageDraw, ImageFont
ims=[(n,Image.open(f)) for n,f in out]
H=max(i.height for _,i in ims); pad=24; top=70
W=sum(i.width for _,i in ims)+pad*(len(ims)+1)
can=Image.new('RGB',(W,H+top+pad),(246,242,236))
d=ImageDraw.Draw(can)
try: font=ImageFont.truetype(os.path.expanduser('~/.fonts/nscb.otf'),34)
except Exception: font=ImageFont.load_default()
x=pad
for n,i in ims:
    d.text((x,18),n,fill=(60,50,40),font=font); can.paste(i,(x,top)); x+=i.width+pad
can.thumbnail((3000,3000)); can.save('/workspace/work/fix290/r290_collage.png'); print(can.size)
