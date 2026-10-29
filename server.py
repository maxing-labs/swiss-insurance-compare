#!/usr/bin/env python3
"""
Swiss Insurance Compare - Local Dev Server & Vercel-Compatible Backend
"""

import json
import logging
import urllib.parse
from http import HTTPStatus
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from api.index import EmptyResultError, NotFoundError, handle_api_request


class PriminfoHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(Path(__file__).parent / "static"), **kwargs)

    def send_json(self, data: dict, status: int = 200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path.startswith("/api/"):
            qs = urllib.parse.parse_qs(parsed.query)
            try:
                data = handle_api_request(parsed.path, qs)
                return self.send_json(data)
            except Exception as e:
                status = 404 if isinstance(e, NotFoundError) else 502 if isinstance(e, EmptyResultError) else 500
                log = logging.exception if status == 500 else logging.warning
                log("GET %s -> %d: %s", self.path, status, e)
                return self.send_json({"error": HTTPStatus(status).phrase}, status=status)
        return super().do_GET()


if __name__ == "__main__":
    port = 8765
    print(f"Starting Swiss Insurance Compare server at http://127.0.0.1:{port}")
    server = HTTPServer(("127.0.0.1", port), PriminfoHandler)
    server.serve_forever()
