import numpy as np, json, os, sys
from darkv import darkify
from PIL import Image, ImageDraw
OUT=sys.argv[1] if len(sys.argv)>1 else 'out_v4'
os.makedirs(OUT+'/tile',exist_ok=True)
from sets import CFG
meta=json.load(open(CFG['meta']))
NAMES=[n for n in meta.keys() if n not in CFG.get('skip_build',())]
BIG=576
def superellipse(size,n=5.0,ss=4):
    S=size*ss; y,x=np.mgrid[0:S,0:S]; c=(S-1)/2; r=S/2
    v=(np.abs((x-c)/r)**n+np.abs((y-c)/r)**n)
    m=(v<=1).astype(np.float32)
    im=Image.fromarray((m*255).astype(np.uint8)).resize((size,size),Image.LANCZOS)
    return im
def norm_graphic(name,frac=1.0):
    g=Image.open(f'raw/{name}_g.png'); a=np.asarray(g)[...,3].astype(np.float32)/255
    ys,xs=np.where(a>0.08); y0,y1,x0,x1=ys.min(),ys.max()+1,xs.min(),xs.max()+1
    w,h=x1-x0,y1-y0
    size=np.sqrt(max(w,h)*np.sqrt(w*h))
    s=min(0.80*BIG/size, 0.90*BIG/max(w,h))*frac
    tot=a.sum(); cy=(a*np.arange(a.shape[0])[:,None]).sum()/tot; cx=(a*np.arange(a.shape[1])[None,:]).sum()/tot
    bcx=(x0+x1)/2; bcy=(y0+y1)/2
    ccx=0.75*bcx+0.25*cx; ccy=0.75*bcy+0.25*cy
    gp=g.convert('RGBa')
    nw,nh=round(g.width*s),round(g.height*s)
    big=gp.resize((nw,nh),Image.LANCZOS)
    canvas=Image.new('RGBa',(BIG,BIG),(0,0,0,0))
    canvas.paste(big,(round(BIG/2-ccx*s),round(BIG/2-ccy*s)))
    return canvas  # premultiplied
def save(imP,path,px):
    im=imP.resize((px,px),Image.LANCZOS).convert('RGBA')
    im.save(path,'WEBP',quality=72,alpha_quality=80,method=6)
stats={}
for n in NAMES:
    g=norm_graphic(n)
    for sc,px in (('2x',96),('3x',144)):
        save(g,f'{OUT}/{n}@{sc}.webp',px)
    gd=Image.fromarray(darkify(np.asarray(g.convert('RGBA')))).convert('RGBa')
    for sc,px in (('2x',96),('3x',144)):
        save(gd,f'{OUT}/{n}-d@{sc}.webp',px)
    # tile version: squircle in tile colour + graphic at 72%
    tb=tuple(int(round(v)) for v in meta[n]['tb'])
    tile=Image.new('RGBA',(BIG,BIG),tb+(255,)); tile.putalpha(superellipse(BIG))
    gt=norm_graphic(n,0.74).convert('RGBA')
    tile.alpha_composite(gt)
    tP=tile.convert('RGBa')
    for sc,px in (('2x',96),('3x',144)):
        save(tP,f'{OUT}/tile/{n}@{sc}.webp',px)
    # keep big png for preview
    g.convert('RGBA').save(f'big_{n}.png')
tot=sum(os.path.getsize(os.path.join(dp,f)) for dp,_,fs in os.walk(OUT) for f in fs)
print('files',sum(len(fs) for _,_,fs in os.walk(OUT)),'bytes',tot)
