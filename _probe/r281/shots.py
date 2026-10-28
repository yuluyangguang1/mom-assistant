import sys, json
sys.path.insert(0, '/workspace/work/mom-assistant/tests')
import regression as R
from playwright.sync_api import sync_playwright
OUT = '/workspace/work/r281/'
with sync_playwright() as pw:
    br = pw.webkit.launch()
    def page(w, h, dark=False, fs=False, plans=3):
        ctx = br.new_context(viewport={'width': w, 'height': h}, has_touch=True, device_scale_factor=2, color_scheme='dark' if dark else 'light')
        p = ctx.new_page()
        p.goto(R.URL); p.wait_for_timeout(700); p.evaluate('t=>Storage.importJSON(t)', R.SEED_V3); p.reload(); p.wait_for_timeout(1200)
        p.evaluate("""([n,dk,fs])=>{const d=Storage.get();d.settings.theme=dk?'dark':'light';d.settings.stage='pregnancy';const names=[['叶酸','片剂','20:00','片'],['孕妇复合维生素','片剂','08:00','片'],['DHA','胶囊','12:00','粒'],['钙','片剂','21:00','片']];
          d.supplementPlans=names.slice(0,n).map((x,i)=>({id:'p'+i,name:x[0],form:x[1],perDay:1,active:true,v:2,times:[{t:x[2],n:1}],unit:x[3],freq:'daily',start:Util.todayISO(),sortOrder:i,createdAt:Date.now()-i*1e6}));d.supplements=[];Storage.save()}""", [plans, dark, fs])
        p.reload(); p.wait_for_timeout(1000)
        p.evaluate("([dk,fs])=>{document.body.classList.toggle('dark',dk);document.body.classList.toggle('fs-xl',fs)}", [dark, fs])
        p.evaluate("App.showTab('supplement',{noVT:true})"); p.wait_for_timeout(700)
        return ctx, p
    shots = [('light_bottom', 393, 852, False, False, 2), ('light_4plans_bottom', 393, 852, False, False, 4), ('dark_bottom', 393, 852, True, False, 4),
             ('light_320', 320, 640, False, False, 4), ('light_fsxl', 393, 852, False, True, 4), ('dark_320_fsxl', 320, 640, True, True, 4), ('light_empty', 393, 852, False, False, 0)]
    info = {}
    for name, w, h, dk, fs, n in shots:
        ctx, p = page(w, h, dk, fs, n)
        p.evaluate("scrollTo(0,document.scrollingElement.scrollHeight)"); p.wait_for_timeout(500)
        info[name] = p.evaluate("""(()=>{const b=document.querySelector('[data-spadd]').getBoundingClientRect();const c=[...document.querySelectorAll('.sp-card')].pop();const r=c?c.getBoundingClientRect():null;return {dark:document.body.classList.contains('dark'),btnTop:Math.round(b.top),lastBottom:r?Math.round(r.bottom):null,gap:r?Math.round(b.top-r.bottom):null}})()""")
        p.screenshot(path=OUT + name + '.png')
        ctx.close()
    print(json.dumps(info, ensure_ascii=False))
    br.close()
