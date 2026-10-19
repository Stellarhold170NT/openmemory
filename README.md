# openmemory

Bộ nhớ dài hạn (long-term memory) nhúng cho OpenCode — DB cogney đọc trực tiếp, không server, không python. Mỗi memory = 1 DB vector + 1 slash command riêng.

## Cài đặt

Thêm 1 dòng vào `opencode.json` (global hoặc project):

```json
{ "plugins": ["github:Stellarhold170NT/openmemory"] }
```

OpenCode tự tải và plugin tự cài phần còn lại khi khởi động: CLI recall + skill `cognee-memory` vào `~/.config/opencode/`. Deps cần có trong `~/.cache/opencode/node_modules`: `@lancedb/lancedb`, `@huggingface/transformers` (skill hướng dẫn agent tự cài nếu thiếu). Model e5 (~536MB) tự tải lần đầu recall.

## Dùng

```
/swe <chủ đề>              # lệnh riêng cho từng memory đã đăng ký
/mem <memory> <chủ đề>     # generic, dùng được ngay cả memory mới thêm (không cần restart)
tool cognee_search         # agent tự gọi: { memory, query }
```

## Thêm memory mới

```
node ~/.config/opencode/cognee/cognee-memory-add.cjs <name> <dbDir> [mô tả]
```

hoặc sửa thẳng registry `~/.config/opencode/cognee-memories.json`:

```json
{ "defaults": { "topK": 4, "minScore": 0.3, "maxChars": 3500, "tables": ["*"], "excludeTables": [], "model": "Xenova/multilingual-e5-large" },
  "memories": { "swe": { "dbDir": "E:\\...\\databases", "description": "SWEBOK Guide v4.0" } } }
```

DB phải build bằng embedding model `intfloat/multilingual-e5-large` — sai model là kết quả rác.

## Layout payload

Cognee đổi format payload on-disk giữa các install (chuỗi JSON — có thể hỏng escape — hoặc struct native tùy combo cognee/lancedb/pyarrow lúc build). CLI đọc được **cả hai**; nếu bảng có dòng mà 0 hit parse được → cảnh báo stderr thay vì im lặng trả "không tìm thấy".

## Tận dụng 100% — tool `cognee_graph` (opt-in)

Về lý thuyết plugin đọc cả graph layer (`*.lbug`) nếu máy có đủ đồ — **không cài cũng không sao**, mọi tính năng còn lại nguyên vẹn:

```powershell
pip install ladybug==0.19.0          # engine đọc .lbug (pin theo cognee 1.6.4, ~23MB)
# Windows wheel thiếu C-API shared lib — tải thêm (Linux/macOS wheel có sẵn):
#   tải https://github.com/LadybugDB/ladybug/releases/download/v0.19.0/liblbug-windows-x86_64.zip
#   giải nén lbug_shared.dll vào ~/.cache/lbug-prebuilt/lib/
#   dll phụ thuộc OpenSSL — đặt libssl-3-x64.dll + libcrypto-3-x64.dll cạnh nó
#   (chỉ cần đúng tên file; plugin tự set LBUG_C_API_LIB_PATH khi spawn)
```

Khi đủ điều kiện, plugin setup tự spawn `graph-server.py` (HTTP 127.0.0.1, read-only, không cần cognee) và đăng ký tool `cognee_graph { cypher, params }` — Cypher trên graph thật: node table `Node` (phân loại qua property `type`), cạnh qua `MATCH (a:Node)-[r]->(b:Node)`, property `r.relationship_name`. Multi-hop đầy đủ: `MATCH (a:Node)-[r1]->(m:Node)-[r2]->(c:Node) WHERE ...`.

## Files

| File | Vai trò |
|---|---|
| `index.ts` | Plugin v2 (`{id, setup}`) — tự cài CLI + skill, đăng ký lệnh theo registry |
| `cognee-recall.cjs` | CLI truy xuất (e5 nhúng + LanceDB ANN + hybrid RRF + 2-hop proxy) |
| `graph-server.py` | [opt-in] đọc `*.lbug` read-only (ladybug, không cognee) — bật tool `cognee_graph` |
| `cognee-memory-add.cjs` | CLI đăng ký memory + sinh slash command |
| `skills/cognee-memory/SKILL.md` | Skill dạy agent tự cài/đăng ký/debug memory |

## Hiệu năng

Recall ấm **~2–3.5s** (model load ~2s + embed ~40ms + search ~40ms).
