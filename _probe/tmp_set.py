from h274 import *
with sync_playwright() as pw:
  b=launch(pw); c,p=page(b,dark=True)
  for t in ('settings','finance'):
    p.evaluate("id=>App.showTab(id,{noVT:true})",t); p.wait_for_timeout(900)
    print(p.evaluate("[...document.querySelectorAll('.btn-primary')].map(e=>{const r=e.getBoundingClientRect();const cs=getComputedStyle(e);return [e.textContent.trim().slice(0,8),Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height),cs.backgroundColor,cs.backgroundImage.slice(0,80),cs.opacity, e.closest('details')&&e.closest('details').open]})"))
    shot(p,'tmp_'+t)
