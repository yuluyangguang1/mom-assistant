exec(open('_probe/sweep.py').read().split('with sync_playwright')[0])
import sys
tag=sys.argv[1]
FAKE="""()=>{Storage.get().settings.remindersEnabled=true;Reminders.evaluate=()=>[
{pending:true,accent:'vaccine',go:'vaccine',remLevel:2,items:[{label:'疫苗 17 剂'},{label:'儿保体检 7 次'},{label:'发育评估'}],text:'待补：疫苗 17 剂 · 儿保体检 7 次 · 发育评估'},
{accent:'feeding',go:'feeding',remLevel:2,text:'距上次喂奶已 3 小时 20 分钟'},
{accent:'supplement',go:'supplement',remLevel:1,text:'今天还没喂维生素 D'}];App.showTab('home',{noAnim:true})}"""
with sync_playwright() as pw:
    b=pw.chromium.launch()
    for theme in ('light',):
        p=b.new_page(viewport={'width':320,'height':852},device_scale_factor=2)
        p.goto(URL); p.wait_for_timeout(300); p.evaluate('t=>Storage.importJSON(t)',S); p.reload(); p.wait_for_timeout(700)
        p.evaluate(FAKE); p.wait_for_timeout(300)
        if theme=='dark': p.evaluate("document.body.classList.add('dark')"); p.wait_for_timeout(200)
        y=p.evaluate("()=>{const e=document.querySelector('.remind-card,.rem-head');return e.getBoundingClientRect().top+scrollY-40}")
        p.evaluate(f"scrollTo(0,{y})"); p.wait_for_timeout(200)
        p.screenshot(path=f'/tmp/rem320.png',clip={'x':0,'y':0,'width':320,'height':300})
        p.close()
    b.close()
