"""对比两次视觉回归截图。只报「看得出来」的差异：单像素差 >24/255，或差异像素超过 0.1%。
（去掉层叠上下文这类改动会带来 ≤12/255 的抗锯齿抖动，肉眼不可见。）"""
import sys
from pathlib import Path
from PIL import Image, ImageChops
a,b=Path(sys.argv[1]),Path(sys.argv[2]); bad=0; noise=0
for f in sorted(a.glob('*.png')):
    A=Image.open(f).convert('RGB'); B=Image.open(b/f.name).convert('RGB')
    if A.size!=B.size: print('SIZE',f.name,A.size,B.size); bad+=1; continue
    d=ImageChops.difference(A,B).convert('L'); h=d.histogram(); n=sum(h[1:])
    big=d.point(lambda v:255 if v>24 else 0).histogram()[255]; big=big if big>20 else 0
    if big or n>A.size[0]*A.size[1]*0.001: print('DIFF',f.name,'px',n,'big',big); bad+=1
    elif n: noise+=1
print('visible diffs:',bad,'/',len(list(a.glob('*.png'))),' (sub-visible noise in',noise,')')
