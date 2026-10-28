import re
from h274 import *
PAT=re.compile(r'[。！？；，、：]{2,}|。」。|[，、；]」|——。|…。')
with sync_playwright() as pw:
  b=launch(pw)
  for seeded in (True,False):
    c,p=page(b,seeded=seeded)
    ids=p.evaluate("Object.keys(Modules)")
    for st in ('baby','pregnancy'):
      if st=='pregnancy':
        p.evaluate("()=>{const s=Storage.get();s.settings.stage='pregnancy';s.settings.dueDate='2026-12-20';Storage.save()}"); p.reload(); p.wait_for_timeout(2000)
        p.evaluate("document.querySelectorAll('.ob-screen,#boot').forEach(e=>e.remove())")
      for i in ids:
        try: p.evaluate("id=>App.showTab(id,{noVT:true})",i); p.wait_for_timeout(250)
        except Exception as e: print(i,'ERR'); continue
        txt=p.evaluate("document.body.textContent")
        hits=set(m.group(0) for m in PAT.finditer(txt))
        if hits:
          ctx=[txt[max(0,m.start()-25):m.end()+5].replace('\n',' ') for m in PAT.finditer(txt)][:4]
          print('seeded' if seeded else 'empty',st,i,hits,ctx,flush=True)
    c.close()
  print('done')
