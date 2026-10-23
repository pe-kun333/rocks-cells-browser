# デモ用のサーバー：このフォルダを http://127.0.0.1:8766/ で配り、POST /upload?name=… を out\ に保存する（自分のパソコンの中だけ）
import http.server
import os
import urllib.parse

root = os.path.dirname(os.path.abspath(__file__))
out = os.path.join(root, 'out')
os.makedirs(out, exist_ok=True)


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=root, **k)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_POST(self):
        u = urllib.parse.urlparse(self.path)
        if u.path != '/upload':
            self.send_error(404)
            return
        name = os.path.basename(urllib.parse.parse_qs(u.query).get('name', ['out.bin'])[0])
        size = int(self.headers.get('Content-Length', '0'))
        with open(os.path.join(out, name), 'wb') as f:
            left = size
            while left > 0:
                chunk = self.rfile.read(min(left, 1 << 20))
                if not chunk:
                    break
                f.write(chunk)
                left -= len(chunk)
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'ok')

    def log_message(self, *a):
        pass


class Server(http.server.ThreadingHTTPServer):
    # Windows では、ふつうは別のサーバーと同じ番号を共有できてしまう（古いサーバーに頼みが届く）。共有しない
    allow_reuse_address = False


Server(('127.0.0.1', 8766), Handler).serve_forever()
