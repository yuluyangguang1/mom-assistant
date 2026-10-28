exec(open('_probe/sweep.py').read().split('with sync_playwright')[0])
with sync_playwright() as pw:
    b=pw.chromium.launch(); p=b.new_page(viewport={'width':393,'height':852})
    p.goto(URL); p.wait_for_timeout(400); p.evaluate('t=>Storage.importJSON(t)',S); p.reload(); p.wait_for_timeout(700)
    p.evaluate("App.showTab('growth',{noAnim:true})"); p.wait_for_timeout(400)
    print(p.evaluate("""[...document.querySelectorAll('#view svg path')].filter(e=>e.getBoundingClientRect().right>innerWidth).map(e=>{const s=e.closest('svg');return [s.getAttribute('class'),getComputedStyle(s).overflow,Math.round(s.getBoundingClientRect().right),e.getAttribute('class')]}).slice(0,3)"""))
    b.close()
