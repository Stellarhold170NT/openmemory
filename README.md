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

## Files

| File | Vai trò |
|---|---|
| `index.ts` | Plugin v2 (`{id, setup}`) — tự cài CLI + skill, đăng ký lệnh theo registry |
| `cognee-recall.cjs` | CLI truy xuất (e5 nhúng + LanceDB ANN + format ngữ cảnh) |
| `cognee-memory-add.cjs` | CLI đăng ký memory + sinh slash command |
| `skills/cognee-memory/SKILL.md` | Skill dạy agent tự cài/đăng ký/debug memory |

## Hiệu năng

Recall ấm **~2–3.5s** (model load ~2s + embed ~40ms + search ~40ms).
