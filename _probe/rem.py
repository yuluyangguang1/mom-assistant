exec(open('_probe/sweep.py').read().split('with sync_playwright')[0])
import sys
with sync_playwright() as pw:
    b=pw.chromium.launch(); p=b.new_page(viewport={'width':393,'height':852},device_scale_factor=2)
    p.goto(URL); p.wait_for_timeout(300); p.evaluate('t=>Storage.importJSON(t)',S); p.reload(); p.wait_for_timeout(700)
    p.evaluate("""()=>{Storage.get().settings.remindersEnabled=true;Reminders.evaluate=()=>[{accent:'feeding',go:'feeding',text:'距上次喂奶已 3 小时 20 分钟'},{pending:true,accent:'vaccine',go:'vaccine',text:'待补：疫苗 17 剂 · 儿保体检 7 次 · 发育评估'}];App.showTab('home',{noAnim:true})}""")
    p.wait_for_timeout(400)
    p.query_selector('.remind-card').screenshot(path=sys.argv[1])
    b.close()
