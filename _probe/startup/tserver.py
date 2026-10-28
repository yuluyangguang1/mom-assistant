"""节流静态服务器（第 275 次启动测量用，不提交）。
- 慢 4G：每请求 RTT 延迟 + 全局带宽令牌桶；gzip 文本（模拟 GitHub Pages）
- 对 sw.js 做内存补丁：去掉 localhost 绕过，使 127.0.0.1 下 SW 正常缓存
用法：start(root, rtt_ms, kbps) -> port ; set_profile(rtt, kbps)
"""
import functools, gzip, http.server, socketserver, threading, time, os, io
PROFILE = {'rtt': 0.0, 'bps': 0}
_lock = threading.Lock()
_next_free = [0.0]
def set_profile(rtt_ms, kbps):
    PROFILE['rtt'] = rtt_ms / 1000.0
    PROFILE['bps'] = kbps * 1000 / 8 if kbps else 0
STATS = {'reqs': 0, 'bytes': 0}
class H(http.server.SimpleHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Cache-Control', 'max-age=600')
        super().end_headers()
    def do_GET(self):
        path = self.translate_path(self.path.split('?')[0])
        if os.path.isdir(path): path = os.path.join(path, 'index.html')
        if not os.path.exists(path):
            self.send_error(404); return
        data = open(path, 'rb').read()
        if path.endswith('sw.js'):
            data = data.replace(rb"if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(self.location.hostname)) return;", b"/*patched*/")
        ctype = self.guess_type(path)
        # 条件请求：简单按 mtime 的 ETag
        etag = '"%x-%x"' % (int(os.path.getmtime(path)), len(data))
        if PROFILE['rtt']: time.sleep(PROFILE['rtt'])
        if self.headers.get('If-None-Match') == etag:
            self.send_response(304); self.send_header('ETag', etag); self.send_header('Content-Length', '0'); self.end_headers(); return
        enc = None
        if ctype.startswith(('text/', 'application/javascript', 'application/json', 'image/svg', 'application/manifest')) or path.endswith(('.js', '.css', '.webmanifest', '.html', '.svg')):
            if 'gzip' in (self.headers.get('Accept-Encoding') or ''):
                data = gzip.compress(data, 6); enc = 'gzip'
        if PROFILE['bps']:
            with _lock:
                start = max(time.time(), _next_free[0]); _next_free[0] = start + len(data) / PROFILE['bps']
                wait = _next_free[0] - time.time()
            if wait > 0: time.sleep(wait)
        STATS['reqs'] += 1; STATS['bytes'] += len(data)
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('ETag', etag)
        if enc: self.send_header('Content-Encoding', enc)
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)
class S(socketserver.ThreadingTCPServer):
    daemon_threads = True; allow_reuse_address = True
def start(root):
    s = S(('127.0.0.1', 0), functools.partial(H, directory=root))
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s.server_address[1]
