import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from sets import CFG
im=np.asarray(Image.open(CFG['sheet']).convert('RGB')).astype(np.float32)
H,W,_=im.shape
# page bg = median of image corners
page=np.median(np.concatenate([im[:20,:20].reshape(-1,3),im[-20:,-20:].reshape(-1,3)]),0)
print('page',page)
d=np.sqrt(((im-page)**2).sum(-1))
m=d>6
m=ndi.binary_opening(m,iterations=2)
lab,n=ndi.label(m)
objs=ndi.find_objects(lab)
tiles=[]
for i,s in enumerate(objs):
    h=s[0].stop-s[0].start; w=s[1].stop-s[1].start
    if h>120 and w>120: tiles.append((s[0].start,s[1].start,s[0].stop,s[1].stop))
print(len(tiles))
tiles.sort(key=lambda t:(round(t[0]/100),t[1]))
for t in tiles: print(t, t[2]-t[0], t[3]-t[1])
import json;json.dump({'page':page.tolist(),'tiles':tiles},open(CFG['tiles'],'w'))
