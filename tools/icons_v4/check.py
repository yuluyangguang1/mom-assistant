import json,sys,os
from PIL import Image, ImageDraw, ImageFont
D=sys.argv[1]; OUT=sys.argv[2]
N=list(json.load(open('meta.json')).keys())
font=ImageFont.truetype(os.path.expanduser('~/.fonts/NotoSansSC-500.otf'),18)
cell=176; cols=10
def panel(bg,sub='',suffix='@3x'):
    rows=(len(N)+cols-1)//cols
    p=Image.new('RGB',(cols*cell,rows*(cell+26)),bg)
    d=ImageDraw.Draw(p)
    for i,n in enumerate(N):
        im=Image.open(f'{D}/{sub}{n}{suffix}.webp').convert('RGBA')
        x=(i%cols)*cell+16; y=(i//cols)*(cell+26)+8
        # guide box showing canvas edges
        d.rectangle([x-1,y-1,x+144,y+144],outline=(200,80,80) if bg[0]>128 else (120,120,160))
        p.paste(im,(x,y),im)
        d.text((x,y+148),n,fill=(90,90,90) if bg[0]>128 else (200,200,200),font=font)
    return p
ps=[panel((250,247,242)),panel((28,26,30)),panel((250,247,242),'tile/'),panel((28,26,30),'tile/')]
W=ps[0].width; H=sum(p.height for p in ps)+4*40
o=Image.new('RGB',(W,H),(255,255,255)); d=ImageDraw.Draw(o); y=0
for t,p in zip(['透明图形 @3x · 浅底','透明图形 @3x · 深底','带底块 @3x · 浅底','带底块 @3x · 深底'],ps):
    d.text((10,y+8),t,fill=(0,0,0),font=font); y+=40; o.paste(p,(0,y)); y+=p.height
o.save(OUT,quality=88)
print(o.size)
