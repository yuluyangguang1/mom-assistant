import re,sys,collections
p='css/styles.css'; s=open(p,encoding='utf-8').read()
skip=set(sys.argv[1:])
# tokenize: find rule blocks with spans, tracking comments
blocks=[]  # (ctx tuple, selector, sel_start, open_idx, close_idx)
i=0;n=len(s);stack=[];seg_start=0
while i<n:
    if s.startswith('/*',i):
        j=s.index('*/',i+2)+2; i=j; continue
    c=s[i]
    if c=='{':
        raw=s[seg_start:i]
        # strip comments from selector text
        sel=re.sub(r'/\*.*?\*/','',raw,flags=re.S).strip()
        # selector actual start: after leading whitespace/comments
        m=re.match(r'(\s|/\*.*?\*/)*',raw,flags=re.S); st=seg_start+m.end()
        stack.append((sel,st,i)); seg_start=i+1
    elif c=='}':
        sel,st,op=stack.pop()
        ctx=tuple(x[0] for x in stack)
        if not sel.startswith('@') and all(x.startswith('@media') for x in ctx):
            blocks.append((ctx,sel,st,op,i))
        seg_start=i+1
    elif c==';' and not stack:
        seg_start=i+1
    i+=1
g=collections.defaultdict(list)
for b in blocks: g[(b[0],b[1])].append(b)
dups={k:v for k,v in g.items() if len(v)>1 and k[1] not in skip}
edits=[]  # (start,end,replacement)
for k,v in dups.items():
    last=v[-1]
    moved=''
    for b in v[:-1]:
        # include immediately preceding comment(s)
        pre_start=b[2]
        m=re.search(r'((?:/\*(?:(?!\*/).)*\*/\s*)+)$',s[:b[2]],flags=re.S)
        if m: pre_start=m.start()
        prec=s[pre_start:b[2]].strip()
        body=s[b[3]+1:b[4]].strip()
        moved+=('\n  '+prec if prec else '')+'\n  '+body
        # remove block incl trailing newline
        end=b[4]+1
        if end<n and s[end]=='\n': end+=1
        edits.append((pre_start,end,''))
    edits.append((last[3]+1,last[3]+1,moved+'\n  /* ↑ 第 171 次：同名选择器合并到此处 */'))
for st,en,rep in sorted(edits,key=lambda e:-e[0]):
    s=s[:st]+rep+s[en:]
open(p,'w',encoding='utf-8').write(s)
print('merged groups',len(dups))
