#!/bin/bash
# 第 287 次：跑指定几组回归到 /tmp/rr_<tag>.txt（后台），用法：bash _probe/rr.sh tag test_a,test_b
cd /workspace/work/mom-assistant
. /tmp/wk/env.sh
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy
python tests/regression.py --only "$2" > /tmp/rr_$1.txt 2>&1
python3 - "$1" <<'EOF' > /tmp/rr_$1.sum
import json, sys
s = open('/tmp/rr_%s.txt' % sys.argv[1]).read()
l = [x for x in s.splitlines() if x.startswith('@@RESULTS')]
if not l:
    print('NO RESULTS'); print(s[-1500:]); sys.exit()
r = json.loads(l[0][10:])
for k, v in r.items():
    print(k, sum(1 for x in v if x[1]), '/', len(v))
    for x in v:
        if not x[1]: print('  FAIL', x[0], x[2][:600])
EOF
echo DONE >> /tmp/rr_$1.sum
