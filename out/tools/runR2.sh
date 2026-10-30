#!/bin/bash
# runM 跑完后：强制退回模式复跑 test_r319（首轮在别的任务 WebKit 压测时出现 0.7~1.7s 长任务）
while ! grep -q ALLDONE /workspace/work/worker328/out/reg_rerun.txt 2>/dev/null; do sleep 5; done
source /workspace/work/glass314/env.sh
cd /workspace/work/worker328; o=/workspace/work/worker328/out/reg_nw2; mkdir -p $o
timeout 420 python3 out/tools/reg_noworker.py tests/regression.py --only test_r319 > $o/test_r319.out 2> $o/test_r319.err
grep -o '"test_r319": \[.*' $o/test_r319.out | python3 -c "import sys,json;d=json.loads('{'+sys.stdin.read().split('\n')[0]);v=d['test_r319'];print('test_r319', sum(1 for x in v if x[1]),'/',len(v));[print('   FAIL',x[0][:120],'|',str(x[2])[:200]) for x in v if not x[1]]" > $o/summary.txt 2>&1
echo ALLDONE >> $o/summary.txt
