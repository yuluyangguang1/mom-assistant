import re,collections
s=open('/tmp/styles.bak.css',encoding='utf-8').read()
exec(open('_probe/merge.py').read().split('g=collections')[0].split("p='css/styles.css'")[1].split('\n',1)[1].replace("skip=set(sys.argv[1:])",""))
g=collections.defaultdict(list)
for b in blocks: g[(b[0],b[1])].append(b)
def props(b):
    body=re.sub(r'/\*.*?\*/','',s[b[3]+1:b[4]],flags=re.S)
    return {d.split(':',1)[0].strip() for d in body.split(';') if ':' in d}
def base(p): return p.split('-')[0] if p not in('max-width','min-height','max-height','min-width') else p
for k,v in g.items():
    if len(v)<2 or k[1] in('.view','.home-sky'):continue
    early=set().union(*[props(b) for b in v[:-1]])
    keys=set(re.findall(r'[.#][\w-]+',k[1])) or {k[1]}
    for b in blocks:
        if v[0][4]<b[2]<v[-1][2] and (b[0],b[1])!=k:
            if set(re.findall(r'[.#][\w-]+',b[1]))&keys or b[1] in('body','html') and k[1] in('body','body.dark'):
                common={x for x in props(b) if any(base(x)==base(y) for y in early)}
                if common: print(k[1][:40],'|',b[0],b[1][:60],'|',sorted(common)[:5])
