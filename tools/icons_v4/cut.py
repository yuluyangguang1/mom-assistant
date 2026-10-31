import numpy as np, json, os
from PIL import Image
from scipy import ndimage as ndi
SRC=np.asarray(Image.open('../sheet_v4.png').convert('RGB')).astype(np.float32)
J=json.load(open('tiles.json')); PAGE=np.array(J['page'],np.float32)
NAMES=['baby','breast','bottle','pump','solid','diaper','sleep','growth','vaccine','meds','temp','sick',
'jaundice','bath','swim','sun','water','fetal','prenatal','packing','mom','mood','period','contraction',
'home','calendar','noise','search','settings','family']
os.makedirs('raw',exist_ok=True)
def gblur(a,s): return ndi.gaussian_filter(a,s)
def inpaint(img,known,s=6):
    w=gblur(known.astype(np.float32),s)
    out=np.stack([gblur(img[...,i]*known,s) for i in range(3)],-1)/np.maximum(w,1e-4)[...,None]
    # iterate larger sigma where weight tiny
    for s2 in (12,24,48):
        w2=gblur(known.astype(np.float32),s2)
        o2=np.stack([gblur(img[...,i]*known,s2) for i in range(3)],-1)/np.maximum(w2,1e-6)[...,None]
        bad=w<0.02; out[bad]=o2[bad]; w=np.where(bad,w2,w)
    return out
meta={}
TH={'breast':6.5,'prenatal':7,'mom':7,'mood':7}
P=10
for idx,(y0,x0,y1,x1) in enumerate(J['tiles']):
    name=NAMES[idx]
    C=SRC[y0-P:y1+P,x0-P:x1+P].copy(); h,w,_=C.shape
    dpage=np.sqrt(((C-PAGE)**2).sum(-1))
    tile=ndi.binary_fill_holes(ndi.binary_closing(dpage>6,iterations=3))
    tile=ndi.binary_opening(tile,iterations=3)
    lab,n=ndi.label(tile); sz=ndi.sum(tile,lab,range(1,n+1)); tile=lab==(np.argmax(sz)+1)
    inner=ndi.binary_erosion(tile,iterations=10)
    ring=inner & ~ndi.binary_erosion(inner,iterations=8)
    tb=np.median(C[ring],0)
    # rough bg: pixels close to page (outside tile) or close to tile bg (inside)
    dtb=np.sqrt(((C-tb)**2).sum(-1))
    cand=np.where(tile,dtb<14,dpage<10)
    # flood from crop border + ring
    seed=np.zeros_like(cand); seed[0,:]=seed[-1,:]=seed[:,0]=seed[:,-1]=True; seed|=ring&cand
    lab,n=ndi.label(cand); ids=np.unique(lab[seed&cand]); ids=ids[ids>0]
    bgk=np.isin(lab,ids)
    B=inpaint(C,bgk&~ndi.binary_dilation(~bgk,iterations=1))
    dist=np.sqrt(((C-B)**2).sum(-1))
    # second flood with local bg, low tol
    ds=ndi.gaussian_filter(dist,0.8)
    outside=~ndi.binary_erosion(tile,iterations=6)
    def flood(T):
        c2=(ds<T)|outside
        lab,n=ndi.label(c2); ids=np.unique(lab[seed&c2]); ids=ids[ids>0]
        return ~np.isin(lab,ids)
    fg=flood(12)
    st=ndi.generate_binary_structure(2,1)
    Lb=B@np.array([.299,.587,.114]); Lc=C@np.array([.299,.587,.114])
    WB=255-B; den=np.maximum((WB**2).sum(-1),1)
    t=((C-B)*WB).sum(-1)/den
    res=np.sqrt((((C-B)-t[...,None]*WB)**2).sum(-1))
    whitish=((Lc>Lb+9)|((t>0.18)&(res<14)))
    def peel(fg):
        for it in range(7):
            edge=fg & ndi.binary_dilation(~fg,st)
            halo=edge & whitish
            if not halo.any(): break
            fg=fg&~halo
        return fg
    fg=peel(fg)
    # whitish parts open to the background (sticker rim / glints) go too; enclosed whites (eye, tub) stay
    passable=(~fg)|whitish
    lab,n=ndi.label(passable); ids=np.unique(lab[seed&passable]); ids=ids[ids>0]
    near=ndi.distance_transform_edt(fg)<=4.5
    fg=fg&~(np.isin(lab,ids)&whitish&near)
    weakset=None
    if name in TH:
        weak=flood(TH[name])&~fg
        disk=np.hypot(*np.mgrid[-3:4,-3:4])<=3.2
        weak=ndi.binary_opening(weak,disk)
        lab,n=ndi.label(weak)
        if n:
            idx=np.arange(1,n+1); sz=ndi.sum(weak,lab,idx); weak=np.isin(lab,idx[sz>=150])
        fg=ndi.binary_fill_holes(fg|weak)
        weakset=weak
    # remove specks / low-contrast arcs
    lab,n=ndi.label(fg)
    if n:
        idx=np.arange(1,n+1)
        sz=ndi.sum(fg,lab,idx); md=ndi.mean(dist,lab,idx)
        wf=ndi.mean(whitish.astype(np.float32),lab,idx)
        keep=idx[(sz>=6)&((md>=16)|(sz>=400))&~((wf>0.5)&(sz<600))]
        fg=np.isin(lab,keep)
    core=ndi.binary_erosion(fg,iterations=2)
    _,ind=ndi.distance_transform_edt(~core,return_indices=True)
    F=C[ind[0],ind[1]]
    band=ndi.binary_dilation(fg,iterations=2)&~core
    FB=F-B; den=(FB**2).sum(-1)
    a=np.clip(((C-B)*FB).sum(-1)/np.maximum(den,1),0,1)
    soft=np.clip(ndi.gaussian_filter(fg.astype(np.float32),0.8)*1.15-0.075,0,1)
    a=np.where(den<200, soft, a)   # fg too close to bg: fall back to mask
    alpha=np.where(core,1.0,np.where(band,a,0.0))
    # kill faint bg noise
    alpha[alpha<0.06]=0
    col=np.where(alpha[...,None]>0.02,(C-(1-alpha[...,None])*B)/np.maximum(alpha[...,None],0.02),C)
    col=np.where(band[...,None]&(alpha[...,None]<0.6),F*0.5+np.clip(col,0,255)*0.5,col)  # soften decontam on faint edge
    col=np.clip(col,0,255)
    rgba=np.dstack([col,alpha*255]).astype(np.uint8)
    Image.fromarray(rgba).save(f'raw/{name}_g.png')
    # tile alpha (soft): from page distance relative to tile color
    den2=((tb-PAGE)**2).sum()
    ta=np.clip(((C-PAGE)*(tb-PAGE)).sum(-1)/den2,0,1)
    ta=np.where(ndi.binary_erosion(tile,iterations=3),1,np.where(ndi.binary_dilation(tile,iterations=3),ta,0))
    Image.fromarray((ta*255).astype(np.uint8)).save(f'raw/{name}_t.png')
    ys,xs=np.where(alpha>0.3); ty,tx=np.where(tile)
    meta[name]=dict(tb=tb.tolist(),gbox=[int(ys.min()),int(xs.min()),int(ys.max()),int(xs.max())],tbox=[int(ty.min()),int(tx.min()),int(ty.max()),int(tx.max())],
        touch=bool((alpha[ty.min()+1:ty.max(),tx.min()+1:tx.max()]>0).sum()==0))
json.dump(meta,open('meta.json','w'),indent=0)
print('ok')
