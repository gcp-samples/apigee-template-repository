#!/usr/bin/env python3
"""
Lightweight Static Web Server and CORS Proxy for Apigee OIDC Tester Client.
Zero external dependencies (uses standard library http.server).

Usage:
    python3 tests/clients/server.py [port]
    Default port: 8080
"""

import sys
import os
import urllib.request
import urllib.error
import urllib.parse
from http.server import HTTPServer, SimpleHTTPRequestHandler

DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class OIDCTesterHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        # Enable CORS for local testing
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        if self.path.startswith('/api-proxy'):
            self.handle_proxy('GET')
        else:
            super().do_GET()

    def do_POST(self):
        if self.path.startswith('/api-proxy'):
            self.handle_proxy('POST')
        else:
            self.send_error(404, "Not Found")

    def do_PUT(self):
        if self.path.startswith('/api-proxy'):
            self.handle_proxy('PUT')
        else:
            self.send_error(404, "Not Found")

    def do_DELETE(self):
        if self.path.startswith('/api-proxy'):
            self.handle_proxy('DELETE')
        else:
            self.send_error(404, "Not Found")

    def handle_proxy(self, method):
        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)
        target_url = qs.get('url', [None])[0]

        if not target_url:
            self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"error": "Missing target url parameter in ?url=..."}')
            return

        body = None
        content_length = self.headers.get('Content-Length')
        if content_length:
            body = self.rfile.read(int(content_length))

        headers = {}
        for header, val in self.headers.items():
            if header.lower() not in ['host', 'origin', 'referer', 'content-length']:
                headers[header] = val

        req = urllib.request.Request(target_url, data=body, headers=headers, method=method)

        try:
            with urllib.request.urlopen(req) as response:
                self.send_response(response.status)
                for h, v in response.headers.items():
                    if h.lower() not in ['transfer-encoding', 'content-encoding', 'access-control-allow-origin']:
                        self.send_header(h, v)
                self.end_headers()
                self.wfile.write(response.read())
        except urllib.error.HTTPError as e:
            self.send_response(e.code)
            for h, v in e.headers.items():
                if h.lower() not in ['transfer-encoding', 'content-encoding', 'access-control-allow-origin']:
                    self.send_header(h, v)
            self.end_headers()
            self.wfile.write(e.read())
        except Exception as err:
            self.send_response(502)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(f'{{"error": "Proxy error: {str(err)}"}}'.encode('utf-8'))

def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    server_address = ('', port)
    httpd = HTTPServer(server_address, OIDCTesterHandler)
    print(f"============================================================")
    print(f"  Apigee OIDC & API Tester Client running at:")
    print(f"  http://localhost:{port}")
    print(f"============================================================")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server.")

if __name__ == '__main__':
    main()
