#!/bin/bash
# 回归对照：A = 890721d 基线（worker328_main），C = 原型强制退回主线程（__lgNoWorker）
source /workspace/work/glass314/env.sh
summ() { python3 - "$1" <<'PY'
import sys,json
s=open(sys.argv[1]).read()
l=[x for x in s.splitlines() if x.startswith('@@RESULTS ')]
if not l: print(sys.argv[1].split('/')[-1],'NO RESULT'); sys.exit()
d=json.loads(l[0][10:])
for k,v in d.items():
  f=[x for x in v if not x[1]]
  print(k, f'{len(v)-len(f)}/{len(v)}')
  for x in f: print('   FAIL',x[0][:150],'|',x[2][:300])
PY
}
PAIRS="test_css_rules,test_r275_boot test_r309,test_r312 test_r313,test_r314 test_r315,test_r316 test_r317,test_r318 test_r319,test_r320 test_r321,test_r322 test_r323,test_r324 test_r325,test_r326 test_r327"
run() { root=$1 out=$2 mode=$3; mkdir -p $out; : > $out/summary.txt; cd $root
  for pair in $PAIRS; do
    for t in ${pair//,/ }; do
      ( if [ "$mode" = nw ]; then timeout 420 python3 /workspace/work/worker328/out/tools/reg_noworker.py tests/regression.py --only $t > $out/$t.out 2> $out/$t.err
        else timeout 420 python3 tests/regression.py --only $t > $out/$t.out 2> $out/$t.err; fi
        summ $out/$t.out >> $out/summary.txt ) &
    done; wait
  done; echo ALLDONE >> $out/summary.txt; }
run /workspace/work/worker328_main /workspace/work/worker328/out/reg_base base
run /workspace/work/worker328 /workspace/work/worker328/out/reg_nw nw
