---
name: openmemory
description: "Set up, register, verify, and troubleshoot embedded openmemory (cognee memory) databases for OpenCode. Use when the user wants to add a new memory DB (from a cognee export folder or tar.gz), create or register its slash command, fix recall failures or bad results, tune recall modes, or asks how the embedded memory system works. Handles the full flow from locating the DB to verifying end-to-end."
license: MIT
metadata:
  audience: opencode-agents
  workflow: embedded-openmemory
---

# openmemory — quản lý bộ nhớ nhúng cho OpenCode

Bộ nhớ = cognee export (LanceDB vectors + graph `*.lbug`) đọc **trực tiếp từ đĩa** — không server, không python. Mỗi "memory" = 1 DB + 1 slash command riêng (`/<name> <chủ đề>`).

## Vị trí file (không hardcode đường dẫn khác)

- CLI recall (đã cài): `~/.config/opencode/cognee/cognee-recall.cjs`
- CLI đăng ký (đã cài): `~/.config/opencode/cognee/cognee-memory-add.cjs`
- Registry: `~/.config/opencode/cognee-memories.json` — format `{ "defaults": { topK, minScore, maxChars, tables, mode, model, depsDir, ... }, "memories": { "<name>": { dbDir, description } } }`
- Slash commands sinh ra: `~/.config/opencode/commands/<name>.md`
- Model cache: `~/.cache/cognee-plugin/models` (mặc định)
- Deps: plugin tự cài qua opencode khi load (`package.json` dependencies) — `defaults.depsDir` trong registry chỉ tới node_modules của bản plugin. KHÔNG cần `npm i` thủ công.

## Quy trình cài 1 memory mới (khi user đưa DB)

1. **Xác định dbDir** — user cung cấp:
   - Thư mục export cognee (dưới nó có thư mục con `*.lance.db`), HOẶC
   - File `*.tar.gz` export → giải nén trước (`tar -xzf <file> -C <thư_mục>`), rồi dùng thư mục chứa `databases/`.
   - Verify: tìm thư mục `*.lance.db` (dưới nó phải có `DocumentChunk_text.lance…`). Không thấy → báo user, đừng đoán.

2. **Kiểm tra điều kiện tiên quyết:**
   - Node ≥ 20 (`node --version`).
   - Deps tự resolve theo thứ tự: env `COGNEE_DEPS_DIR` → `defaults.depsDir` trong registry (plugin ghi lúc setup) → `~/.cache/opencode/node_modules` → cạnh script. Thấy `[deps: ...]` trong stderr khi `COGNEE_RECALL_DEBUG=1` là đúng.
   - Model cache `~/.cache/cognee-plugin/models/Xenova/multilingual-e5-large/` — thiếu thì lần recall đầu sẽ tải ~536MB (báo user trước).

3. **Đăng ký:** `node ~/.config/opencode/cognee/cognee-memory-add.cjs <name> <dbDir> "<mô tả ngắn>"` (name: chữ thường/số/-, sẽ thành lệnh `/<name>`; script tự cài lại CLI + sinh command file.)

4. **Verify recall trực tiếp** (trước khi để user dùng): `node ~/.config/opencode/cognee/cognee-recall.cjs <name> "<câu hỏi thử>"` — phải ra hits có match NN% + nguồn; tổng thời gian (stderr khi `COGNEE_RECALL_DEBUG=1`) trên máy thường ~3s.
   - Kết quả vô nghĩa/nội dung lạc đề → gần như chắc chắn sai model nhúng: model trong registry phải trùng model đã build DB (mặc định `Xenova/multilingual-e5-large` = weights của `intfloat/multilingual-e5-large`). Đổi model ≠ đổi embedding có sẵn trong DB là mất chất lượng hoàn toàn.

5. **Verify end-to-end:** chạy `opencode run "/<name> <câu hỏi test>"` — câu trả lời phải trích nguồn [n] từ ngữ cảnh.

## Tinh chỉnh / gỡ

Sửa per-memory (hoặc `defaults`) trong registry:

| Key | Mặc định | Ý nghĩa |
|---|---|---|
| `topK` | 4 | số hits trả về |
| `minScore` | 0.3 | ngưỡng match |
| `maxChars` | 3500 | trần ký tự ngữ cảnh |
| `tables` | `["*"]` | bảng LanceDB tham gia search |
| `excludeTables` | `[]` | loại bảng (vd graph edges gây nhiễu) |
| `primaryTables` | chunk/summary/sessionqa | substring match — được ưu tiên + lexical/RRF |
| `secondaryLimit` | 50 | pool vector cho bảng entity/edge |
| `dataset` | — | chọn `*.lance.db` khi nhiều dataset trong dbDir |
| `lexScan` | 5000 | 0 = tắt hybrid lexical pass |
| `hop2` | true | 2-hop proxy từ entity/edge → chunk; `false` = tắt |
| `mode` | hybrid | `semantic` / `lexical` / `hybrid` / `deep` (xem dưới) |

Gỡ: `node ~/.config/opencode/cognee/cognee-memory-add.cjs --remove <name>`. Liệt kê: đọc registry.

## Recall modes

Đặt `"mode"` trong registry (defaults hoặc per-memory). Mặc định **hybrid**.

- `semantic` — chỉ vector. Nhanh, hợp câu hỏi diễn đạt khác từ ngữ tài liệu.
- `lexical` — chỉ BM25-lite. Hợp tra thuật ngữ/chuẩn chính xác (ISO, tên hàm).
- `hybrid` — vector + lexical RRF + 2-hop proxy. Cân bằng.
- `deep` — hybrid + **graph traversal thật** qua `@ladybugdb/core` (in-process, read-only): thêm dòng quan hệ `a —rel→ b` đánh dấu `[graph N-hop]`, thay thế 2-hop proxy. Hợp câu multi-hop ("X liên quan gì đến Y"); engine thiếu thì tự về hybrid. Chỉ tốn thêm ~1% thời gian so với hybrid.

Tool `cognee_graph` cho agent chạy Cypher multi-hop trực tiếp. Schema: node table `Node` (phân loại qua property `type`), cạnh query `MATCH (a:Node)-[r]->(b:Node)` — KHÔNG ghi `:REL`; property cạnh `r.relationship_name`. Tool đăng ký khi engine load được trong runtime; nếu không, recall `deep` vẫn dùng graph qua process `node` con.

## Chẩn đoán lỗi thường gặp

| Triệu chứng | Nguyên nhân | Xử lý |
|---|---|---|
| `Cannot find package '@lancedb/lancedb'` | bản plugin < v0.4.2, hoặc depsDir sai | cập nhật plugin; kiểm tra `defaults.depsDir` trong registry trỏ tới node_modules có đủ deps |
| Recall chậm lần đầu (~1 phút) | đang tải model lần đầu | chờ 1 lần duy nhất, cache lại |
| Match cao nhưng nội dung vô nghĩa | model nhúng không khớp DB | kiểm tra model build DB, sửa `model` trong registry |
| Hits toàn dòng kiểu "X is a technique" | bảng graph edges lọt vào | thêm `EdgeType_relationship_name` vào `excludeTables` của memory |
| Không tìm thấy `*.lance.db` dưới … | sai dbDir | trỏ vào thư mục chứa `databases/`, hoặc giải nén tar.gz |
| Lệnh `/` không mở được trong TUI | config chưa reload | `opencode service restart` hoặc mở phiên mới |
| Recall 10-30s trên máy chậm | disk mạng / CPU yếu, lexical scan đọc payload từ đĩa | mode `semantic`, hoặc giảm `lexScan`, hoặc đặt DB + model cache lên đĩa local |
