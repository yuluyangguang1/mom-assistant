import subprocess, sys, re, os
src = open('tests/regression.py').read()
g = src[src.index('GROUPS = (('):src.index('assert sorted(sum(GROUPS')]
G = eval(g.split('=', 1)[1])
N = int(sys.argv[1]) if len(sys.argv) > 1 else 5
tot = ok = 0; fails = []
for i in range(0, len(G), N):
    ps = [subprocess.Popen([sys.executable, 'tests/regression.py', '--only', ','.join(x)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True) for x in G[i:i+N]]
    for p in ps:
        out = p.communicate()[0]
        import json
        for l in out.splitlines():
            if l.startswith('@@RESULTS '):
                for t, rs in json.loads(l[10:]).items():
                    for r in rs:
                        tot += 1
                        if r[1]: ok += 1
                        else: fails.append(t + ' ' + r[0][:120] + ' <- ' + str(r[2])[:200])
print('\n'.join(fails)); print('%d/%d' % (ok, tot))
