import sys, json
sys.path.insert(0, '/workspace/work/mom-assistant/tests')
import regression as R
from playwright.sync_api import sync_playwright
with sync_playwright() as pw:
    br = pw.webkit.launch()
    ctx = br.new_context(viewport={'width': 393, 'height': 852}, has_touch=True, device_scale_factor=2)
    p = ctx.new_page(); p.goto(R.URL); p.wait_for_timeout(700); p.evaluate('t=>Storage.importJSON(t)', R.SEED_V3); p.evaluate(R.R282_FILL); p.reload(); p.wait_for_timeout(1200)
    for t in R.TABS:
        p.evaluate(f"App.showTab('{t}',{{noVT:true}})"); p.wait_for_timeout(350)
        p.evaluate("scrollTo(0,document.scrollingElement.scrollHeight)"); p.wait_for_timeout(150)
        m = p.evaluate("""(()=>{let last=0,who='';const c=document.querySelector('#view .mod-cta');for(const el of document.querySelectorAll('#view *')){if(c&&c.contains(el))continue;const s=getComputedStyle(el);if(s.position==='fixed'||s.visibility==='hidden')continue;const q=el.getBoundingClientRect();if(q.height>0&&q.width>0&&q.bottom>last){last=q.bottom;who=el.className}}
          const tb=document.getElementById('tabbar').getBoundingClientRect();const lim=c?c.firstElementChild.getBoundingClientRect().top:tb.top;return [Math.round(last),Math.round(lim),String(who).slice(0,40)]})()""")
        print(('OK ' if m[0] <= m[1] - 8 else 'BAD') , t, m)
    br.close()
