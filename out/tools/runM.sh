#!/bin/bash
# 第 328 次测量（接手后重跑）：等 reg_nw 跑完 → main / 原型交替测（同机同负载）→ Worker 模式回归里失败的几项复跑
while ! grep -q ALLDONE /workspace/work/worker328/out/reg_nw/summary.txt 2>/dev/null; do sleep 5; done
source /workspace/work/glass314/env.sh
cd /workspace/work/worker328/out/tools; D=../data
for k in 1 2; do
  python3 bench.py chromium main $D/f${k}_chromium_main.json 0.5 > $D/f${k}_chromium_main.log 2>&1
  python3 bench.py chromium proto $D/f${k}_chromium_proto.json 0.5 > $D/f${k}_chromium_proto.log 2>&1
done
python3 drag2.py chromium main $D/g_chromium_main.json 3 > $D/g_chromium_main.log 2>&1
python3 drag2.py chromium proto $D/g_chromium_proto.json 3 > $D/g_chromium_proto.log 2>&1
python3 drag2.py webkit main $D/g_webkit_main.json 3 > $D/g_webkit_main.log 2>&1
python3 drag2.py webkit proto $D/g_webkit_proto.json 3 > $D/g_webkit_proto.log 2>&1
python3 bench.py webkit main $D/f1_webkit_main.json 1 > $D/f1_webkit_main.log 2>&1
python3 bench.py webkit proto $D/f1_webkit_proto.json 1 > $D/f1_webkit_proto.log 2>&1
echo done > $D/F.done
export ROOTDIR=/workspace/work/worker328 TMO=420
bash /workspace/work/r319_run.sh /workspace/work/worker328/out/reg_rerun test_r318 test_r325 > /workspace/work/worker328/out/reg_rerun.txt 2>&1
bash /workspace/work/r319_run.sh /workspace/work/worker328/out/reg_rerun test_r320 test_r322 >> /workspace/work/worker328/out/reg_rerun.txt 2>&1
echo ALLDONE >> /workspace/work/worker328/out/reg_rerun.txt
