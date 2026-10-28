"""第 282 次：各模块页底部主按钮滚动前 / 中 / 后的位置（WebKit iPhone 视口）。不提交。
用法：python _probe/r282/cta.py [out_dir] [--dark] [--shots]"""
import sys, json, os
sys.path.insert(0, '/workspace/work/mom-assistant/tests')
import regression as R
from playwright.sync_api import sync_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith('--') else '/workspace/work/fix282/cta'
os.makedirs(OUT, exist_ok=True)
DARK = '--dark' in sys.argv
SHOTS = '--shots' in sys.argv
PAGES = ['diaper', 'feeding', 'breast', 'bottle', 'pump', 'solid', 'sleep', 'supplement', 'bath', 'swim', 'sun',
         'water', 'temp', 'jaundice', 'meds', 'mood']
FILL = """()=>{const d=Storage.get();const now=Date.now();const P=n=>String(n).padStart(2,'0');
 const loc=ms=>{const x=new Date(ms);return x.getFullYear()+'-'+P(x.getMonth()+1)+'-'+P(x.getDate())+'T'+P(x.getHours())+':'+P(x.getMinutes())+':00'};
 const L=(k,f)=>{d[k]=d[k]||[];for(let i=0;i<18;i++)d[k].push(Object.assign({id:k+i,time:loc(now-(i+1)*3.1*3600e3),note:null},f(i)))};
 L('baths',i=>({minutes:10}));L('swims',i=>({minutes:20}));L('suns',i=>({minutes:15}));L('waters',i=>({ml:30}));
 L('temps',i=>({value:36.6}));L('jaundices',i=>({value:8}));L('meds',i=>({name:'维生素D'}));L('moods',i=>({level:3,tags:[]}));
 for(let i=0;i<14;i++){d.feedings.push({id:'pp'+i,type:'pump',start:loc(now-(i+1)*4e6),end:loc(now-(i+1)*4e6+9e5),durationMin:15,durationL:8,durationR:7,amount:120,amountL:60,amountR:60});
   d.feedings.push({id:'so'+i,type:'solid',start:loc(now-(i+1)*5e6),dish:'米粉',unit:'spoon',qty:3,note:null});}
 const nm=['叶酸','维生素D3','DHA','钙','铁','锌','益生菌'];d.supplementPlans=nm.map((x,i)=>({id:'sp'+i,name:x,form:'滴剂',perDay:1,active:true,v:2,times:[{t:P(7+i)+':00',n:1}],unit:'滴',freq:'daily',start:'2026-10-01',sortOrder:i,createdAt:now-i*1e6}));
 for(let i=0;i<10;i++)d.diapers.push({id:'dx'+i,type:'pee',time:loc(now-(i+1)*2e6),note:null});
 Storage.save()}"""
MEAS = """()=>{const c=document.querySelector('#view .mod-cta');if(!c)return null;const kid=c.firstElementChild||c;const r=kid.getBoundingClientRect();
 let last=0;for(const el of document.querySelectorAll('#view .ft-page > *:not(.mod-cta), #view > *:not(.mod-cta):not(.ft-page), #view .tl-row')){if(c.contains(el))continue;const q=el.getBoundingClientRect();if(q.height>0)last=Math.max(last,q.bottom)}
 const tb=document.getElementById('tabbar').getBoundingClientRect();
 return {top:Math.round(r.top*10)/10,bottom:Math.round(r.bottom*10)/10,pos:getComputedStyle(c).position,lastBottom:Math.round(last),dockTop:Math.round(tb.top),sy:Math.round(scrollY),max:document.scrollingElement.scrollHeight-innerHeight}}"""

with sync_playwright() as pw:
    br = pw.webkit.launch()
    ctx = br.new_context(viewport={'width': 393, 'height': 852}, has_touch=True, device_scale_factor=2, color_scheme='dark' if DARK else 'light')
    p = ctx.new_page()
    errs = []
    p.on('pageerror', lambda e: errs.append(str(e)[:200]))
    p.goto(R.URL); p.wait_for_timeout(700); p.evaluate('t=>Storage.importJSON(t)', R.SEED_V3)
    p.evaluate(FILL)
    p.evaluate("dk=>{Storage.get().settings.theme=dk?'dark':'light';Storage.save()}", DARK)
    p.reload(); p.wait_for_timeout(1500)
    res = {}
    for t in PAGES:
        p.evaluate(f"App.showTab('{t}',{{noVT:true}})"); p.wait_for_timeout(700)
        m = []
        mx = p.evaluate("document.scrollingElement.scrollHeight-innerHeight")
        for i, y in enumerate((0, mx // 2, mx)):
            p.evaluate(f"scrollTo(0,{y})"); p.wait_for_timeout(250)
            m.append(p.evaluate(MEAS))
            if SHOTS:
                p.screenshot(path=f'{OUT}/{t}_{i}.png')
        res[t] = m
        tops = [x and x['top'] for x in m]
        ok = m[0] is not None and len(set(tops)) == 1 and m[2]['lastBottom'] <= m[2]['top']
        print(('OK  ' if ok else 'BAD ') + t, json.dumps(m, ensure_ascii=False))
    print('errs', errs)
    br.close()
