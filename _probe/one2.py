exec(open('_probe/sweep.py').read().split('with sync_'+'playwright')[0])
import sys,io
from PIL import Image
def _l(c):
    c=[v/255 for v in c]; c=[v/12.92 if v<=.03928 else ((v+.055)/1.055)**2.4 for v in c]; return .2126*c[0]+.7152*c[1]+.0722*c[2]
with sync_playwright() as pw:
    b=pw.chromium.launch(); p=b.new_page(viewport={'width':393,'height':852},device_scale_factor=2)
    p.goto(URL); p.wait_for_timeout(300); p.evaluate('t=>Storage.importJSON(t)',S); p.reload(); p.wait_for_timeout(500)
    p.evaluate("m=>{var d=Storage.get();d.settings.themeMode=m;d.settings.theme=m;Storage.save()}", sys.argv[1]); p.reload(); p.wait_for_timeout(800)
    p.evaluate("id=>App.showTab(id,{noAnim:true})",sys.argv[2]); p.wait_for_timeout(400)
    for i in range(int(sys.argv[4]) if len(sys.argv)>4 else 1):
        e=p.locator(sys.argv[3]).nth(i); e.evaluate("e=>e.scrollIntoView({block:'center'})"); p.wait_for_timeout(300)
        im=Image.open(io.BytesIO(e.screenshot())).convert('RGB'); px=list(im.getdata())
        import collections; bg=collections.Counter(px).most_common(1)[0][0]; fg=max(px,key=lambda q:sum((q[k]-bg[k])**2 for k in range(3)))
        x,y=_l(fg),_l(bg); print(sys.argv[3],i,e.text_content()[:10],fg,bg,round((max(x,y)+.05)/(min(x,y)+.05),2))
    b.close()
