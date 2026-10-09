"""Local stand-in for S3 static hosting and API Gateway.

Runs two servers:
  - port 8080 serves the static site from SITE_DIR (html/ in the repo).
  - port 3000 turns every HTTP request into an API Gateway HTTP API event
    (payload format 2.0), invokes the Lambda through the Runtime Interface
    Emulator at LAMBDA_URL, and turns the Lambda's answer back into HTTP.

The site and the API are on different ports, so -- just like S3 vs. API
Gateway in production -- the browser treats them as different origins and
CORS applies. This server answers CORS the way the deployed API should.

Standard library only, so the container needs nothing installed.
"""
import base64
import json
import os
import threading
import time
import urllib.error
import urllib.request
import uuid
from functools import partial
from http.server import SimpleHTTPRequestHandler, BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, parse_qsl

SITE_DIR = os.environ.get("SITE_DIR", "/site")
SITE_PORT = int(os.environ.get("SITE_PORT", "8080"))
API_PORT = int(os.environ.get("API_PORT", "3000"))
LAMBDA_URL = os.environ.get(
    "LAMBDA_URL", "http://lambda:8080/2015-03-31/functions/function/invocations"
)
ALLOWED_ORIGINS = os.environ.get(
    "ALLOWED_ORIGINS", "http://localhost:8080,http://127.0.0.1:8080"
).split(",")


class SiteHandler(SimpleHTTPRequestHandler):
    """Static files, never cached, so a browser refresh always shows edits."""

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


class ApiHandler(BaseHTTPRequestHandler):
    """Forwards every request to the Lambda as a payload 2.0 event."""

    protocol_version = "HTTP/1.1"

    def do_OPTIONS(self):
        # CORS preflight: answered here, the way API Gateway's CORS config would.
        self.send_response(204)
        self._send_cors_headers()
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH")
        self.send_header(
            "Access-Control-Allow-Headers",
            self.headers.get("Access-Control-Request-Headers", "Content-Type"),
        )
        self.send_header("Access-Control-Max-Age", "600")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        self._proxy()

    do_POST = do_PUT = do_DELETE = do_PATCH = do_HEAD = do_GET

    def _send_cors_headers(self):
        origin = self.headers.get("Origin")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Credentials", "true")
            self.send_header("Vary", "Origin")

    def _build_event(self) -> dict:
        url = urlsplit(self.path)

        # Payload 2.0 lower-cases header names and joins repeated headers with ",".
        headers: dict[str, str] = {}
        for name, value in self.headers.items():
            name = name.lower()
            headers[name] = f"{headers[name]},{value}" if name in headers else value

        cookies = [c.strip() for c in headers.get("cookie", "").split(";") if c.strip()]

        length = int(self.headers.get("Content-Length") or 0)
        raw_body = self.rfile.read(length) if length else b""

        now = time.time()
        event = {
            "version": "2.0",
            "routeKey": "$default",
            "rawPath": url.path,
            "rawQueryString": url.query,
            "headers": headers,
            "requestContext": {
                "accountId": "local",
                "apiId": "local",
                "domainName": headers.get("host", "localhost"),
                "domainPrefix": "localhost",
                "http": {
                    "method": self.command,
                    "path": url.path,
                    "protocol": self.request_version,
                    "sourceIp": self.client_address[0],
                    "userAgent": headers.get("user-agent", ""),
                },
                "requestId": str(uuid.uuid4()),
                "routeKey": "$default",
                "stage": "$default",
                "time": time.strftime("%d/%b/%Y:%H:%M:%S +0000", time.gmtime(now)),
                "timeEpoch": int(now * 1000),
            },
            "isBase64Encoded": False,
        }
        if cookies:
            event["cookies"] = cookies
        if url.query:
            event["queryStringParameters"] = dict(parse_qsl(url.query, keep_blank_values=True))
        if raw_body:
            try:
                event["body"] = raw_body.decode("utf-8")
            except UnicodeDecodeError:
                event["body"] = base64.b64encode(raw_body).decode("ascii")
                event["isBase64Encoded"] = True
        return event

    def _invoke_lambda(self, event: dict) -> tuple[int, dict, list[str], bytes]:
        """Invoke the Lambda; return (status, headers, set_cookies, body)."""
        request = urllib.request.Request(
            LAMBDA_URL,
            data=json.dumps(event).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=330) as response:
                result = json.loads(response.read() or b"null")
        except (urllib.error.URLError, ConnectionError, TimeoutError) as exc:
            print(f"gateway: could not reach the Lambda at {LAMBDA_URL}: {exc}")
            return 502, {"Content-Type": "application/json"}, [], b'{"message":"Bad Gateway"}'

        # An unhandled exception in the Lambda comes back as an error object;
        # API Gateway turns that into a bare 500.
        if isinstance(result, dict) and "errorMessage" in result and "statusCode" not in result:
            print(f"gateway: Lambda raised {result.get('errorType')}: {result.get('errorMessage')}")
            return 500, {"Content-Type": "application/json"}, [], b'{"message":"Internal Server Error"}'

        # Payload 2.0 lets a Lambda return a plain value instead of a response
        # object; API Gateway then sends it as a 200 JSON body.
        if not (isinstance(result, dict) and "statusCode" in result):
            return 200, {"Content-Type": "application/json"}, [], json.dumps(result).encode()

        body = result.get("body") or ""
        body_bytes = base64.b64decode(body) if result.get("isBase64Encoded") else body.encode()
        return (
            int(result["statusCode"]),
            {k: str(v) for k, v in (result.get("headers") or {}).items()},
            list(result.get("cookies") or []),
            body_bytes,
        )

    def _proxy(self):
        status, headers, set_cookies, body = self._invoke_lambda(self._build_event())
        self.send_response(status)
        for name, value in headers.items():
            if name.lower() not in ("content-length", "connection", "transfer-encoding"):
                self.send_header(name, value)
        for cookie in set_cookies:
            self.send_header("Set-Cookie", cookie)
        self._send_cors_headers()
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)


def main():
    site = ThreadingHTTPServer(("0.0.0.0", SITE_PORT), partial(SiteHandler, directory=SITE_DIR))
    api = ThreadingHTTPServer(("0.0.0.0", API_PORT), ApiHandler)
    print(f"gateway: site on http://localhost:{SITE_PORT}  (serving {SITE_DIR})")
    print(f"gateway: API  on http://localhost:{API_PORT}  (forwarding to {LAMBDA_URL})")
    threading.Thread(target=site.serve_forever, daemon=True).start()
    api.serve_forever()


if __name__ == "__main__":
    main()
