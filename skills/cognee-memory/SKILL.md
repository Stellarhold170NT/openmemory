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

- Sửa per-memory trong registry: `topK` (4), `minScore` (0.3 — cosine sim, tăng nếu nhiễu), `maxChars` (3500), `tables` (mặc định `["*"]` — search mọi bảng có vector; đặt danh sách cụ thể để thu hẹp), `excludeTables` (loại bảng gây nhiễu), `primaryTables` (mặc định `["chunk","summary"]` — match substring, được ưu tiên trước), `dataset` (chọn `*.lance.db` khi dbDir có nhiều dataset — substring tên), `lexScan` (5000 — số dòng quét lexical; 0 = tắt hybrid), `hybrid` luôn bật: lexical pass (BM25-lite) fuse với vector bằng RRF k=60 để bắt term chính xác kiểu "ISO/IEC 25010" mà vector trượt.
- Gỡ: `node ~/.config/opencode/cognee/cognee-memory-add.cjs --remove <name>`.
- Liệt kê: đọc `~/.config/opencode/cognee-memories.json`.

## Chẩn đoán lỗi thường gặp

| Triệu chứng | Nguyên nhân | Xử lý |
|---|---|---|
| `Cannot find package '@lancedb/lancedb'` | deps chưa cài / sai vị trí | bước 2; hoặc `COGNEE_DEPS_DIR` |
| Recall chậm lần đầu (~1-2 phút) | đang tải model lần đầu | chờ 1 lần duy nhất, cache lại |
| Match cao nhưng nội dung vô nghĩa | model nhúng không khớp DB | kiểm tra model build DB, sửa `model` trong registry |
| Hits toàn dòng kiểu "X is a technique" | bảng graph edges lọt vào | thêm `"EdgeType_relationship_name"` vào `excludeTables` của memory |
| `Không tìm thấy *.lance.db dưới …` | sai dbDir | trỏ vào thư mục chứa `databases/`, hoặc giải nén tar.gz |
| Lệnh /<name> không mở được trong TUI | config chưa reload | `opencode service restart` hoặc mở phiên mới |
