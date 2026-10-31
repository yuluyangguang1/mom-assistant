import sys,json
from PIL import Image, ImageDraw
D=sys.argv[1]; OUT=sys.argv[2]; S=int(sys.argv[3]) if len(sys.argv)>3 else 160
N=list(json.load(open(D+'/meta.json')).keys())
bgs=[(250,247,242),(28,26,30),(255,0,255)]
o=Image.new('RGB',(6*S,5*S*len(bgs)),'white')
for bi,bg in enumerate(bgs):
  for i,n in enumerate(N):
    im=Image.open(f'{D}/{n}.png').convert('RGBA').resize((S-4,S-4),Image.LANCZOS)
    t=Image.new('RGBA',(S,S),bg+(255,)); t.alpha_composite(im,(2,2))
    dr=ImageDraw.Draw(t); dr.rectangle([0,0,S-1,S-1],outline=(200,80,80))
    o.paste(t.convert('RGB'),((i%6)*S,(bi*5+i//6)*S))
o.save(OUT,quality=90)
