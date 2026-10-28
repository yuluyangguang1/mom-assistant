exec(open('_probe/sweep.py').read().split('with sync_playwright')[0])
import sys
tag=sys.argv[1]
with sync_playwright() as pw:
    b=pw.chromium.launch(); p=b.new_page(viewport={'width':393,'height':852},device_scale_factor=2)
    p.goto(URL); p.wait_for_timeout(300); p.evaluate('t=>Storage.importJSON(t)',S); p.reload(); p.wait_for_timeout(700)
    el=p.query_selector('.remind-card')
    if el: el.screenshot(path=f'/tmp/bar_{tag}_remind.png')
    p.evaluate("App.showTab('feeding',{noAnim:true})"); p.wait_for_timeout(300)
    el=p.query_selector('#view .list li'); el and el.screenshot(path=f'/tmp/bar_{tag}_list.png')
    p.evaluate("App.showTab('vaccine',{noAnim:true})"); p.wait_for_timeout(300)
    el=p.query_selector('.vac-backfill'); el and el.screenshot(path=f'/tmp/bar_{tag}_vac.png')
    b.close()
