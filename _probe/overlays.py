import sys
exec(open('_probe/sweep.py').read().split('PAGES=')[0])
out=sys.argv[1]; import os; os.makedirs(out,exist_ok=True)
with sync_playwright() as pw:
    b=pw.chromium.launch()
    for theme in ('light','dark'):
        p=b.new_page(viewport={'width':393,'height':852},reduced_motion='reduce')
        p.goto(URL); p.wait_for_timeout(300); p.evaluate('t=>Storage.importJSON(t)',S); p.reload(); p.wait_for_timeout(600)
        def dk():
            if theme=='dark': p.evaluate("document.body.classList.add('dark')")
        dk(); p.evaluate("App.showTab('settings',{noAnim:true})"); p.wait_for_timeout(200); dk()
        p.evaluate("Util.confirm({title:'测试',message:'确认删除这条记录吗？',danger:true,onConfirm:function(){}})"); p.wait_for_timeout(400)
        p.screenshot(path=f'{out}/{theme}_confirm.png'); p.keyboard.press('Escape'); p.evaluate("document.getElementById('modalRoot').innerHTML=''")
        p.evaluate("document.getElementById('avatarBtn').click()"); p.wait_for_timeout(400); p.screenshot(path=f'{out}/{theme}_sheet.png')
        p.evaluate("document.getElementById('modalRoot').innerHTML=''")
        p.evaluate("App.showTab('mood',{noAnim:true})"); p.wait_for_timeout(200); dk(); p.screenshot(path=f'{out}/{theme}_mood.png',full_page=True)
        p.evaluate("()=>{const d=Storage.load?null:null;}")
        p.evaluate("App.startOnboarding()"); p.wait_for_timeout(500); dk(); p.screenshot(path=f'{out}/{theme}_ob1.png')
        for k in range(3):
            p.evaluate("()=>{const b=[...document.querySelectorAll('button')].find(x=>/下一步|开始|继续|同意/.test(x.textContent)&&x.offsetParent);if(b)b.click()}"); p.wait_for_timeout(400)
            p.screenshot(path=f'{out}/{theme}_ob{k+2}.png')
        p.close()
    b.close()
