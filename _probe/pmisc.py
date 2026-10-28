import sys
from h274 import *
def L(*a): print(*a,flush=True)
DARK=os.environ.get('DARK')=='1'
with sync_playwright() as pw:
  b=launch(pw); c,p=page(b,dark=DARK); G=p.evaluate
  sfx='_dk' if DARK else ''
  G("""()=>{const d=Storage.get();const s=d.sleeps.find(r=>r.start=='2026-10-25T21:30:00');s.start='2026-10-25T22:30:00';s.end='2026-10-26T00:10:00';
   d.finance.records.push({id:'f1',amount:100,category:'奶粉',note:null,date:'2026-09-30'},{id:'f2',amount:0.1,category:'奶粉',note:null,date:'2026-10-26'},{id:'f3',amount:0.2,category:'用品',note:'=1+1',date:'2026-10-26'});Storage.save()}""")
  p.reload(); p.wait_for_timeout(2500); G("document.querySelectorAll('.ob-screen,#boot').forEach(e=>e.remove())")
  G("App.showTab('sleep',{noVT:true})"); p.wait_for_timeout(900)
  L('sleep sum',G("document.querySelector('#view .mod-sum').innerText"), '| dash', G("(document.querySelector('#view .sl-dash .dash-big')||{}).innerText"))
  shot(p,'23_sleep'+sfx)
  G("App.showTab('home',{noVT:true})"); p.wait_for_timeout(900)
  L('home daySleep',G("Math.round(Util.daySleep(Storage.get().sleeps,'2026-10-26',0).min)"))
  G("App.showTab('calendar',{noVT:true})"); p.wait_for_timeout(900)
  L('cal today',G("[...document.querySelectorAll('#view .day-list li')].filter(l=>/睡眠/.test(l.textContent)).map(l=>l.innerText.replace(/\\n+/g,' '))"))
  shot(p,'23_cal26'+sfx)
  G("document.querySelector('[data-ws=\"2026-10-25\"]').click()"); p.wait_for_timeout(500)
  L('cal 25',G("[...document.querySelectorAll('#view .day-list li')].filter(l=>/睡眠/.test(l.textContent)).map(l=>l.innerText.replace(/\\n+/g,' '))"))
  G("[...document.querySelectorAll('.day-list li')].pop().scrollIntoView({block:'center'})"); p.wait_for_timeout(300)
  shot(p,'23_cal25'+sfx)
  G("App.showTab('calendar',{noVT:true})"); p.wait_for_timeout(700)
  L('review',G("document.querySelector('#view .review-card p').innerText"))
  L('overview',G("[...document.querySelectorAll('#view .today-overview .stat')].map(s=>{const n=s.querySelector('.stat-num').getBoundingClientRect(),u=s.querySelector('.stat-unit').getBoundingClientRect(),l=s.querySelector('.stat-lbl');return s.innerText.replace(/\\n/g,'/')+' sameLine='+(Math.abs(n.top-u.top)<n.height)+' lblH='+Math.round(l.getBoundingClientRect().height)})"))
  G("document.querySelector('#view .today-overview').scrollIntoView({block:'start'})"); p.wait_for_timeout(300)
  shot(p,'2429_cal'+sfx)
  G("App.showTab('finance',{noVT:true})"); p.wait_for_timeout(900)
  L('fin',G("document.querySelector('#view').innerText.replace(/\\n+/g,' | ').slice(0,420)"))
  shot(p,'26_fin'+sfx,True)
  G("App.showTab('feeding',{noVT:true})"); p.wait_for_timeout(900)
  L('feed hint',G("[...document.querySelectorAll('#view .hint')].map(e=>e.textContent).filter(t=>/只统计/.test(t))"))
  L('ERRS',[e for e in p.errs if 'willRead' not in e][:5])
