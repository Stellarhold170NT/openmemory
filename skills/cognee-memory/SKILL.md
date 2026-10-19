---
name: cognee-memory
description: Set up, register, verify, and troubleshoot embedded cognee memory databases for OpenCode. Use when the user wants to add a new memory DB (from a cognee export folder or tar.gz), create/register its slash command, recall fails or returns bad results, or asks how the embedded memory system works. Handles the full flow: locate DB → check deps/model cache → register via cognee-memory-add.cjs → verify end-to-end.
license: MIT
metadata:
  audience: opencode-agents
  workflow: embedded-cognee-memory
---

# cognee-memory — quản lý bộ nhớ nhúng cho OpenCode

Bộ nhớ = cognee export (LanceDB vectors) đọc **trực tiếp từ đĩa** — không server, không python.
Mỗi "memory" = 1 DB + 1 slash command riêng (`/<name> <chủ đề>`).

## Vị trí file (không hardcode đường dẫn khác)

- CLI recall (đã cài): `~/.config/opencode/cognee/cognee-recall.cjs`
- CLI đăng ký (đã cài): `~/.config/opencode/cognee/cognee-memory-add.cjs`
- Registry: `~/.config/opencode/cognee-memories.json` — format:
  `{ "defaults": { topK, minScore, maxChars, tables, model }, "memories": { "<name>": { dbDir, description } } }`
- Slash commands sinh ra: `~/.config/opencode/commands/<name>.md`
- Model cache: `~/.cache/cognee-plugin/models` (mặc định)

## Quy trình cài 1 memory mới (khi user đưa DB)

1. **Xác định dbDir** — user cung cấp:
   - Thư mục export cognee (chứa `databases/` bên dưới có thư mục `*.lance.db`), HOẶC
   - File `*.tar.gz` export → giải nén trước (`tar -xzf <file> -C <thư_mục>`), rồi dùng thư mục chứa `databases/`.
   - Verify: tìm thư mục `*.lance.db` (dưới nó phải có `DocumentChunk_text.lance`…). Không thấy → báo user, đừng đoán.
2. **Kiểm tra điều kiện tiên quyết**:
   - Node ≥ 20 (`node --version`).
   - Deps: `~/.cache/opencode/node_modules/@lancedb/lancedb` + `.../@huggingface/transformers` tồn tại không. Thiếu → thêm vào `~/.cache/opencode/package.json` rồi chạy `npm install --prefix ~/.cache/opencode` (hoặc để opencode tự bun install khi restart), hoặc set env `COGNEE_DEPS_DIR` trỏ node_modules có sẵn 2 package đó.
   - Model cache `~/.cache/cognee-plugin/models/Xenova/multilingual-e5-large/` — thiếu thì lần recall đầu sẽ tải ~536MB (báo user trước).
3. **Đăng ký**:
   `node ~/.config/opencode/cognee/cognee-memory-add.cjs <name> <dbDir> "<mô tả ngắn>"`
   (`name`: chữ thường/số/-, sẽ thành lệnh `/<name>`; script tự cài lại CLI + sinh command file.)
4. **Verify recall trực tiếp** (trước khi để user dùng):
   `node ~/.config/opencode/cognee/cognee-recall.cjs <name> "<câu hỏi thử>"`
   - Phải ra hits có `match NN%` + nguồn; tổng thời gian (in stderr khi set `COGNEE_RECALL_DEBUG=1`) < 10s.
   - Kết quả vô nghĩa/đưa nội dung lạc đề → gần như chắc chắn **sai model nhúng**: model trong registry (`defaults.model` hoặc per-memory `model`) phải trùng model đã build DB (mặc định hệ này: `Xenova/multilingual-e5-large` = weights của `intfloat/multilingual-e5-large`). Đổi model ≠ đổi embedding có sẵn trong DB là mất chất lượng hoàn toàn.
5. **Verify end-to-end**: chạy `opencode run "/<name> <câu hỏi test>"` (chấp nhận model mặc định của user) — câu trả lời phải trích dẫn nguồn `[n]` từ ngữ cảnh.

## Tinh chỉnh / gỡ

- Sửa per-memory trong registry: `topK` (4), `minScore` (0.3), `maxChars` (3500), `tables` (`["*"]`), `excludeTables` ([]), `primaryTables` (mặc định `["chunk","summary","sessionqa"]` — substring match, được ưu tiên + lexical/RRF), `secondaryLimit` (50 — pool vector cho bảng entity/edge), `dataset` (chọn `*.lance.db` khi nhiều dataset), `lexScan` (5000 — 0 = tắt hybrid), `hop2` (mặc định bật — từ hit entity/edge truy ngược chunk nhắc tới thực thể đó, đánh dấu `[2-hop: <term>]`; `false` = tắt).
- Gỡ: `node ~/.config/opencode/cognee/cognee-memory-add.cjs --remove <name>`.
- Liệt kê: đọc `~/.config/opencode/cognee-memories.json`.

## Tận dụng 100% (opt-in — graph layer)

Máy nào có `python -c "import ladybug"` chạy được + C-API shared lib trong `~/.cache/lbug-prebuilt/lib/` → plugin tự spawn `graph-server.py` (HTTP local, read-only) và tool `cognee_graph { cypher, params }` xuất hiện. Thiếu đồ → im lặng chạy như thường (vector + hybrid + 2-hop).

Setup Windows (Linux/macOS wheel đã kèm shared lib):
1. `pip install ladybug==0.19.0` (pin theo cognee 1.6.4)
2. Tải `liblbug-windows-x86_64.zip` từ release v0.19.0 của `LadybugDB/ladybug` → `lbug_shared.dll` vào `~/.cache/lbug-prebuilt/lib/`
3. Đặt `libssl-3-x64.dll` + `libcrypto-3-x64.dll` cạnh dll đó (mọi nguồn OpenSSL 3.x, chỉ cần đúng tên)

Schema (introspect được qua tool, đừng tin cứng): node table `Node` phân loại qua property `type`; cạnh query `MATCH (a:Node)-[r]->(b:Node)` — **không** ghi `:REL`; property cạnh `r.relationship_name`. Ladybug format đổi giữa versions (cognee có `needs_migration()`) — pin version theo bản build DB.

## Chẩn đoán lỗi thường gặp

| Triệu chứng | Nguyên nhân | Xử lý |
|---|---|---|
| `Cannot find package '@lancedb/lancedb'` | deps chưa cài / sai vị trí | bước 2; hoặc `COGNEE_DEPS_DIR` |
| Recall chậm lần đầu (~1-2 phút) | đang tải model lần đầu | chờ 1 lần duy nhất, cache lại |
| Match cao nhưng nội dung vô nghĩa | model nhúng không khớp DB | kiểm tra model build DB, sửa `model` trong registry |
| Hits toàn dòng kiểu "X is a technique" | bảng graph edges lọt vào | thêm `"EdgeType_relationship_name"` vào `excludeTables` của memory |
| `Không tìm thấy *.lance.db dưới …` | sai dbDir | trỏ vào thư mục chứa `databases/`, hoặc giải nén tar.gz |
| Lệnh /<name> không mở được trong TUI | config chưa reload | `opencode service restart` hoặc mở phiên mới |


## Recall modes (v0.4.0)

Đặt `"mode"` trong registry (defaults hoặc per-memory). Mặc định `hybrid`.

- `semantic` — chỉ vector. Nhanh nhất, hợp câu hỏi diễn đạt khác từ ngữ tài liệu.
- `lexical` — chỉ BM25. Hợp tra thuật ngữ/chuẩn chính xác (ISO, tên hàm).
- `hybrid` — vector + lexical RRF + 2-hop proxy. Cân bằng, mặc định.
- `deep` — hybrid + graph traversal thật (`@ladybugdb/core`): thêm dòng quan hệ `a —rel→ b`.
  Hợp câu multi-hop ("X liên quan gì đến Y"); engine thiếu thì tự về `hybrid`.

Tool `cognee_graph` cho agent tự chạy Cypher multi-hop khi cần (schema xem description của tool).
