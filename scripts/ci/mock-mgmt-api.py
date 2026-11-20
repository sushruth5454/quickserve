#!/usr/bin/env python3
"""Local stand-in for the Supabase Management API `database/query` endpoint, for E2E against the
runner's local Supabase. Runs SQL through psql on LOCAL_DB_URL. Listens on 127.0.0.1 only."""
import json
import os
import subprocess
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer

DB_URL = os.environ["LOCAL_DB_URL"]
AUTH_CONFIG = {
    "sms_test_otp": "919999999999=123456",
    "sms_test_otp_valid_until": "2099-12-31T23:59:59Z",
}


class Handler(BaseHTTPRequestHandler):
    def send_json(self, payload, status):
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path.endswith("/config/auth"):
            self.send_json(AUTH_CONFIG, 200)
            return
        self.send_error(404)

    def do_PATCH(self):
        if not self.path.endswith("/config/auth"):
            self.send_error(404)
            return
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        validity = body.get("sms_test_otp_valid_until")
        if not isinstance(body.get("sms_test_otp"), str) or not isinstance(validity, str):
            self.send_json({"message": "sms_test_otp and sms_test_otp_valid_until are required"}, 400)
            return
        try:
            expiry = datetime.fromisoformat(validity.replace("Z", "+00:00"))
        except ValueError:
            self.send_json({"message": "sms_test_otp_valid_until must be an ISO timestamp"}, 400)
            return
        if expiry.tzinfo is None or expiry <= datetime.now(timezone.utc):
            self.send_json({"message": "sms_test_otp_valid_until must be in the future"}, 400)
            return
        AUTH_CONFIG.update(body)
        self.send_json({"message": "Auth test OTP settings updated"}, 200)

    def do_POST(self):
        if not self.path.endswith("/database/query"):
            self.send_error(404)
            return
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        sql = f"select coalesce(json_agg(t), '[]'::json) from ({body.get('query', '')}) t"
        # Statements that are not row-returning queries run as-is and return an empty result.
        if not body.get("query", "").lstrip().lower().startswith(("select", "with")):
            sql = body.get("query", "")
        proc = subprocess.run(
            ["psql", DB_URL, "-v", "ON_ERROR_STOP=1", "-qtA", "-c", sql],
            capture_output=True, text=True,
        )
        if proc.returncode:
            payload, status = {"error": proc.stderr.strip()}, 400
        else:
            out = proc.stdout.strip()
            payload, status = (json.loads(out) if out.startswith("[") else []), 201
        self.send_json(payload, status)

    def log_message(self, *args):
        pass


HTTPServer(("127.0.0.1", int(os.environ.get("MGMT_PORT", "54399"))), Handler).serve_forever()
