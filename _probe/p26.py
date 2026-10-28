from h274 import *
with sync_playwright() as pw:
  b=launch(pw); c,p=page(b); G=p.evaluate
  G("()=>{const d=Storage.get();d.finance.records.push({id:'f1',amount:100,category:'奶粉',note:null,date:'2026-09-30'},{id:'f2',amount:0.1,category:'奶粉',note:null,date:'2026-10-26'},{id:'f3',amount:0.2,category:'用品',note:null,date:'2026-10-26'});Storage.save()}")
  G("App.showTab('finance',{noVT:true})"); p.wait_for_timeout(900)
  shot(p,'26_head')
  G("[...document.querySelectorAll('#view h2')].find(h=>h.textContent=='统计').scrollIntoView({block:'start'})"); p.wait_for_timeout(300)
  shot(p,'26_stats')
