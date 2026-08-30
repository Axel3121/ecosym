#!/usr/bin/env python3
"""
Axey backend.

Eier ingenting av Hermes. Leser Hermes' SQLite READ-ONLY og serverer JSON.
Når noe krever tenking, spør den `hermes -z` — den tenker aldri selv.
"""

import json
import os
import sqlite3
import subprocess
from http.server import BaseHTTPRequestHandler, HTTPServer

HERMES = os.path.expanduser("~/.hermes")
STATE = f"{HERMES}/state.db"
PORT = 8787


def db():
    c = sqlite3.connect(f"file:{STATE}?mode=ro", uri=True)
    c.row_factory = sqlite3.Row
    return c


def runs():
    """Hermes-kjøringer. Axey knytter dem selv til sine egne agenter."""
    out = []
    with db() as c:
        for r in c.execute(
            "SELECT delegation_id, state, dispatched_at, completed_at, event_json "
            "FROM async_delegations ORDER BY dispatched_at DESC LIMIT 60"
        ):
            ev = json.loads(r["event_json"] or "{}")
            dur = (
                round(r["completed_at"] - r["dispatched_at"])
                if r["completed_at"] and r["dispatched_at"]
                else None
            )
            out.append(
                {
                    "id": r["delegation_id"],
                    "state": r["state"],
                    "goal": ev.get("goal") or (ev.get("goals") or [""])[0],
                    "model": ev.get("model"),
                    "started": r["dispatched_at"],
                    "dur": dur,
                }
            )
    return out


def totals():
    with db() as c:
        t = dict(
            c.execute(
                "SELECT COALESCE(SUM(input_tokens),0) tin, COALESCE(SUM(output_tokens),0) tout, "
                "COALESCE(SUM(api_call_count),0) calls FROM session_model_usage"
            ).fetchone()
        )
        t["messages"] = c.execute("SELECT COUNT(*) FROM messages").fetchone()[0]
        t["sessions"] = c.execute("SELECT COUNT(*) FROM sessions").fetchone()[0]
    return t


def ask(prompt: str) -> str:
    """Lån Hermes' hjerne. Axey tenker ikke selv."""
    p = subprocess.run(
        ["hermes", "-z", prompt],
        capture_output=True,
        text=True,
        timeout=180,
        check=False,
    )
    return p.stdout.strip() or p.stderr.strip()


class H(BaseHTTPRequestHandler):
    def _send(self, obj, code=200):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        if self.path == "/api/state":
            self._send({"runs": runs(), "totals": totals()})
        else:
            self._send({"error": "not found"}, 404)

    def do_POST(self):
        if self.path != "/api/ask":
            return self._send({"error": "not found"}, 404)
        n = int(self.headers.get("Content-Length", 0))
        q = json.loads(self.rfile.read(n) or "{}").get("q", "")
        self._send({"answer": ask(q) if q else ""})

    def log_message(self, format, *args):
        pass


if __name__ == "__main__":
    print(f"axey backend  ->  http://127.0.0.1:{PORT}")
    HTTPServer(("127.0.0.1", PORT), H).serve_forever()
