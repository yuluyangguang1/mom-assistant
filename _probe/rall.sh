#!/bin/bash
# 第 287 次：全量回归按组并发 N 个（2 核机器上 17 组同时跑会把计时类断言挤坏），用法：bash _probe/rall.sh 3
cd /workspace/work/mom-assistant
rm -f /tmp/rr_g*.sum /tmp/rall.done
python3 -c "
import re,ast
s=open('tests/regression.py').read()
g=ast.literal_eval(re.search(r'^GROUPS = (\(.*?\))  #', s, re.S|re.M).group(1))
for i,x in enumerate(g): print('g%02d %s' % (i, ','.join(x)))
" > /tmp/rall.groups
cat /tmp/rall.groups | xargs -P ${1:-3} -L 1 bash _probe/rr.sh
cat /tmp/rr_g*.sum > /tmp/rall.sum
python3 - <<'PY' >> /tmp/rall.sum
import glob,re
p=t=0
for f in glob.glob('/tmp/rr_g*.sum'):
    for l in open(f):
        m=re.match(r'^(\S+) (\d+) / (\d+)',l)
        if m: p+=int(m.group(2)); t+=int(m.group(3))
print('TOTAL %d/%d' % (p,t))
PY
touch /tmp/rall.done
