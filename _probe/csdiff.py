import json,sys,collections
a=json.load(open(sys.argv[1]));b=json.load(open(sys.argv[2]))
n=0;props=collections.Counter()
for k in a:
    if k not in b or len(a[k])!=len(b[k]): print('STRUCT',k); n+=1; continue
    for (ta,sa),(tb,sb) in zip(a[k],b[k]):
        if sa!=sb:
            hit=False
            da=dict(x.split(':',1) for x in sa.split(';') if ':' in x); db=dict(x.split(':',1) for x in sb.split(';') if ':' in x)
            for p in set(da)|set(db):
                if da.get(p)!=db.get(p) and not p.startswith('--sky'): props[(ta[:50],p,da.get(p,'')[:40],db.get(p,'')[:40])]+=1; hit=True
            n+=hit
print('diff elements',n)
for k,v in props.most_common(30): print(v,k)
