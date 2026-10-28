from h274 import *
with sync_playwright() as pw:
  b=launch(pw); c,p=page(b); G=p.evaluate
  G("App.showTab('feeding',{noVT:true})"); p.wait_for_timeout(900)
  G("[...document.querySelectorAll('#view .hint')].find(e=>/只统计/.test(e.textContent)).scrollIntoView({block:'center'})"); p.wait_for_timeout(300)
  p.screenshot(path=S+f'/27_{TAG}.png',clip={'x':0,'y':300,'width':390,'height':240})
