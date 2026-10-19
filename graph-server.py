#!/usr/bin/env python3
"""
openmemory graph-server — đọc file *.lbug (ladybug engine) READ-ONLY, phục vụ HTTP local.

Usage:  python graph-server.py <path-to.lbug>
Stdout: dòng đầu tiên "PORT <n>" — plugin đọc để biết cổng.
API:    POST /query  {"cypher": "...", "params": {...}}  ->  {"rows": [[...]], "columns": [...]}
        POST /schema -> {"tables": [...]}                (SHOW_TABLES)

Chỉ phụ thuộc package `ladybug` (pin ==0.19.0 theo cognee 1.6.4) — KHÔNG import cognee.
File mở READ-ONLY: không ghi, không lock phần ghi, cognee vẫn dùng được song song.
"""
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer


def _ensure_capi_lib():
    """Ladybug wheel trên Windows không kèm C-API shared lib — tự resolve trước khi import."""
    if os.getenv("LBUG_C_API_LIB_PATH"):
        return
    home = os.path.expanduser("~")
    names = {"win32": ["lbug_shared.dll", "lbug.dll"], "darwin": ["liblbug.dylib"], "linux": ["liblbug.so", "liblbug.so.0"]}
    for name in names.get(sys.platform, ["liblbug.so"]):
        p = os.path.join(home, ".cache", "lbug-prebuilt", "lib", name)
        if os.path.exists(p):
            os.environ["LBUG_C_API_LIB_PATH"] = p
            return


_ensure_capi_lib()
import ladybug  # noqa: E402

LBUG_PATH = sys.argv[1] if len(sys.argv) > 1 else ""
LOG = lambda m: sys.stderr.write(f"[openmemory-graph] {m}\n")  # noqa: E731

# Schema cognee 1.6.4 / ladybug 0.19 (introspect lúc chạy, không hardcode tin tuyệt đối):
#   node table "Node" — phân loại qua property `type` (Entity/TextSummary/DocumentChunk/...)
#   edge traversal: MATCH (a:Node)-[r]->(b:Node)  — KHÔNG ghi :REL trong pattern (binder không nhận)
#   property cạnh: r.relationship_name ("is_a", "part_of", ...)


def open_connection():
    # read_only nếu engine hỗ trợ — né DB-lock khi cognee đang build song song
    for kwargs in ({"read_only": True}, {}):
        try:
            db = ladybug.Database(LBUG_PATH, buffer_pool_size=256 * 1024 * 1024, **kwargs)
            db.init_database()  # bắt buộc kể cả với DB có sẵn (API ladybug 0.19)
            return ladybug.Connection(db), (kwargs.get("read_only") is True)
        except TypeError as e:
            LOG(f"Database kwargs {list(kwargs)} không hỗ trợ: {e}")
        except Exception as e:
            if kwargs == {}:
                raise
            LOG(f"read_only lỗi ({e}) — thử mở thường")
    raise RuntimeError("không mở được database")


conn, readonly = open_connection()
LOG(f"opened {LBUG_PATH} (read_only={readonly})")

# cognee load JSON extension trước khi query — làm tương tự, nhưng không bắt buộc phải thành công
try:
    conn.execute("LOAD EXTENSION 'json';")
    LOG("json extension loaded")
except Exception as e:
    LOG(f"json extension skip: {e}")


def rows_of(result):
    cols = list(result.get_column_names()) if hasattr(result, "get_column_names") else []
    rows = []
    while result.has_next():
        row = result.get_next()
        rows.append([_plain(v) for v in row])
    return {"columns": cols, "rows": rows}


def _plain(v):
    # Value của ladybug/Kuzu: ép về kiểu JSON-an toàn
    if hasattr(v, "to_dict"):
        try:
            return v.to_dict()
        except Exception:
            pass
    if isinstance(v, (int, float, str, bool)) or v is None:
        return v
    return str(v)


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        try:
            n = int(self.headers.get("Content-Length") or 0)
            req = json.loads(self.rfile.read(n).decode("utf-8") or "{}")
            if self.path == "/schema":
                res = conn.execute("CALL show_tables() RETURN *")
                return self._send(200, rows_of(res))
            if self.path != "/query":
                return self._send(404, {"error": f"unknown path {self.path}"})
            cypher = (req.get("cypher") or "").strip()
            if not cypher:
                return self._send(400, {"error": "missing cypher"})
            params = req.get("params") or {}
            res = conn.execute(cypher, parameters=params) if params else conn.execute(cypher)
            return self._send(200, rows_of(res))
        except Exception as e:
            return self._send(500, {"error": f"{type(e).__name__}: {e}"})

    def log_message(self, fmt, *args):
        LOG(f"{self.address_string()} {fmt % args}")


if not os.path.exists(LBUG_PATH):
    print("PORT 0")
    print(json.dumps({"error": f"file not found: {LBUG_PATH}"}))
    sys.exit(1)

srv = HTTPServer(("127.0.0.1", 0), Handler)
print(f"PORT {srv.server_port}", flush=True)
try:
    srv.serve_forever()
except KeyboardInterrupt:
    pass
