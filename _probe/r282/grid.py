import sys
from PIL import Image, ImageDraw, ImageFont
# grid.py out.png scale rows... each row: label:path1,path2,...
out=sys.argv[1]; sc=float(sys.argv[2]); rows=sys.argv[3:]
font=ImageFont.truetype('/home/sandbox/.fonts/nsc.otf', 22)
R=[]
for r in rows:
    lab, ps = r.split(':',1); ims=[Image.open(p).convert('RGB') for p in ps.split(',')]
    ims=[i.resize((int(i.width*sc), int(i.height*sc))) for i in ims]; R.append((lab, ims))
W=max(sum(i.width+8 for i in ims) for _,ims in R)+8; H=sum(max(i.height for i in ims)+36 for _,ims in R)
g=Image.new('RGB',(W,H),'#888'); d=ImageDraw.Draw(g); y=0
for lab,ims in R:
    d.text((8,y+4),lab,fill='white',font=font); x=8; y+=32
    for i in ims: g.paste(i,(x,y)); x+=i.width+8
    y+=max(i.height for i in ims)+4
g.save(out); print(g.size)
