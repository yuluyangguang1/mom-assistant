from h274 import *
with sync_playwright() as pw:
  b=launch(pw)
  for dark in (False,True):
   for fm in ('1','1.33'):
    c,p=page(b,dark=dark); G=p.evaluate
    G(f"document.documentElement.style.setProperty('--fs-mul','{fm}');document.body.style.setProperty('--fs-mul','{fm}')")
    G("App.showTab('calendar',{noVT:true})"); p.wait_for_timeout(800)
    G("document.querySelector('#view .today-overview').scrollIntoView({block:'center'})"); p.wait_for_timeout(300)
    print(dark,fm,G("[...document.querySelectorAll('#view .today-overview .stat')].map(s=>{const n=s.querySelector('.stat-num').getBoundingClientRect(),u=s.querySelector('.stat-unit').getBoundingClientRect(),l=s.querySelector('.stat-lbl');return s.innerText.replace(/\\n/g,'/')+' fs='+getComputedStyle(s.querySelector('.stat-num')).fontSize+' same='+(Math.abs(n.bottom-u.bottom)<8)+' lblClip='+(l.scrollWidth>l.clientWidth)})"))
    r=G("(()=>{const r=document.querySelector('#view .today-overview').getBoundingClientRect();return [r.y,r.height]})()")
    p.screenshot(path=S+f'/29_{"dk" if dark else "lt"}_{fm}_{TAG}{"_wk" if os.environ.get("BR")=="wk" else ""}.png',clip={'x':0,'y':max(0,r[0]),'width':390,'height':min(260,r[1])})
    c.close()
