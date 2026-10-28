#!/bin/bash
# usage: batch.sh idx...   （第 282 次：按组并行跑回归，每次 2–3 组）
cd /workspace/work/mom-assistant; . /tmp/wk/env.sh
for i in "$@"; do
  g=$(python3 -c "import ast,re;s=open('tests/regression.py',encoding='utf-8').read();m=s[s.index('GROUPS = ('):];m=m[:m.index('\nassert')];m=re.sub(r'#.*','',m);G=ast.literal_eval(m.split('=',1)[1].strip());print(','.join(G[$i]))")
  (python tests/regression.py --only "$g" 2>/tmp/err_$i.txt | grep "^@@RESULTS" > /tmp/res_$i.txt) &
done
wait
for i in "$@"; do python3 -c "
import json
t=open('/tmp/res_$i.txt').read()
if not t: print('group $i: NO RESULT', open('/tmp/err_$i.txt').read()[-500:]); raise SystemExit
d=json.loads(t[10:])
n=f=0
for k,v in d.items():
  for nm,ok,det in v:
    n+=1
    if not ok: f+=1; print('FAIL',nm,det[:400])
print('group $i:',n-f,'/',n)"; done
