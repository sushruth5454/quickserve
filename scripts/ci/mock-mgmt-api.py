#!/usr/bin/env python3
"""Local stand-in for the Supabase Management API `database/query` endpoint, for E2E against the
runner's local Supabase. Runs SQL through psql on LOCAL_DB_URL. Listens on 127.0.0.1 only."""
import json
import os
import subprocess
from http.server import BaseHTTPRequestHandler, HTTPServer

DB_URL = os.environ["LOCAL_DB_URL"]


class Handler(BaseHTTPRequestHandler):
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
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass


HTTPServer(("127.0.0.1", int(os.environ.get("MGMT_PORT", "54399"))), Handler).serve_forever()
