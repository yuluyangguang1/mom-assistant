from h274 import *
with sync_playwright() as pw:
  b=launch(pw); c,p=page(b)
  print(p.evaluate("(()=>{const i=Util.buildDayIndex(Storage.get());return Object.keys(i).sort().slice(-12).map(k=>k+':'+i[k].length)})()"))
