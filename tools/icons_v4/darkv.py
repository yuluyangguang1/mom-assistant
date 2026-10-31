import numpy as np
def srgb2lin(c): c=c/255.0; return np.where(c<=0.04045,c/12.92,((c+0.055)/1.055)**2.4)
def lin2srgb(c): c=np.clip(c,0,1); return np.where(c<=0.0031308,c*12.92,1.055*c**(1/2.4)-0.055)*255
def to_oklab(rgb):
    l=srgb2lin(rgb)
    M1=np.array([[0.4122214708,0.5363325363,0.0514459929],[0.2119034982,0.6806995451,0.1073969566],[0.0883024619,0.2817188376,0.6299787005]])
    lms=np.cbrt(l@M1.T)
    M2=np.array([[0.2104542553,0.7936177850,-0.0040720468],[1.9779984951,-2.4285922050,0.4505937099],[0.0259040371,0.7827717662,-0.8086757660]])
    return lms@M2.T
def from_oklab(lab):
    M2i=np.array([[1,0.3963377774,0.2158037573],[1,-0.1055613458,-0.0638541728],[1,-0.0894841775,-1.2914855480]])
    lms=(lab@M2i.T)**3
    M1i=np.array([[4.0767416621,-3.3077115913,0.2309699292],[-1.2684380046,2.6097574011,-0.3413193965],[-0.0041960771,-0.7034186147,1.7076127010]])
    return lin2srgb(lms@M1i.T)
def darkify(rgba, Lmin=0.70, k=0.85):
    a=rgba[...,3:4].astype(np.float32); rgb=rgba[...,:3].astype(np.float32)
    lab=to_oklab(rgb)
    L=lab[...,0]
    # lift dark colours toward Lmin with a soft knee; light fills untouched
    Ln=np.where(L<Lmin, Lmin-(Lmin-L)*(1-k), L)
    sc=np.ones_like(L)
    lab2=lab.copy(); lab2[...,0]=Ln
    # keep chroma a touch lower when lifted so it doesn't go neon
    lift=np.clip((Ln-L)/0.4,0,1); lab2[...,1:]*= (1-0.15*lift)[...,None]
    out=np.concatenate([np.clip(from_oklab(lab2),0,255),a],-1)
    return out.astype(np.uint8)
