"""把 dock.py 生成的 dock_inline.json 写进 js/dock-icons.js 的 BMP 块（var BMP = {...};）"""
import json, re, os
H = os.path.dirname(os.path.abspath(__file__))
inl = json.load(open(os.path.join(H, 'dock_inline.json')))
p = os.path.join(H, '..', '..', 'js', 'dock-icons.js')
s = open(p, encoding='utf-8').read()
body = '{\n' + ',\n'.join('    %s: { on: %s, onD: %s, mask: %s }' % (k, json.dumps(v['on']), json.dumps(v['onD']), json.dumps(v['mask'])) for k, v in inl.items()) + '\n  };'
s2, n = re.subn(r"var BMP = \{.*?\n\s*\};", lambda m: 'var BMP = ' + body, s, flags=re.S)
assert n == 1, n
open(p, 'w', encoding='utf-8').write(s2)
print('ok', len(s2))
