# openmemory

Bộ nhớ dài hạn (long-term memory) nhúng cho OpenCode — DB cogney đọc trực tiếp, không server, không python. Mỗi memory = 1 DB vector + 1 slash command riêng.

## Cài đặt

Thêm 1 dòng vào `opencode.json` (global hoặc project):

```json
{ "plugins": ["github:Stellarhold170NT/openmemory"] }
```

OpenCode tự tải plugin về và plugin tự cài CLI recall + skill `cognee-memory` vào `~/.config/opencode/` khi khởi động. Hai deps cần cài thủ công vào `~/.cache/opencode/node_modules` (thiếu thì câu `/swe` đầu tiên sẽ báo `Cannot find module '@lancedb/lancedb'`):

```bash
npm i @lancedb/lancedb @huggingface/transformers @ladybugdb/core@0.19.0 --prefix ~/.cache/opencode
```

Model e5 (~536MB) tự tải lần đầu recall. Tốc độ trên máy thường (SSD, CPU hiện đại): warm recall ~3s, cả vòng < 5s. Máy disk mạng/CPU yếu có thể 10–30s — giảm bằng mode `semantic` hoặc hạ `lexScan`.

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

## Tận dụng 100% — graph in-process (v0.4.0)

Engine graph giờ là **package npm chính chủ** `@ladybugdb/core@0.19.0` — native binding của chính engine ladybug build DB (cùng source release, format khớp tuyệt đối, đã verify mở DB thật: 11,277 nodes / 48,382 edges đúng tuyệt đối).

Cài plugin qua npm → `optionalDependencies` tự kéo đúng binary platform (linux-x64/win32-x64/darwin-x64/darwin-arm64/linux-arm64). **Không cần Python, không cần tải DLL, không sidecar, không HTTP.**

- Tool `cognee_graph { memory?, cypher, params? }` xuất hiện khi engine có trong node_modules; thiếu → im lặng chạy vector/hybrid như thường.
- `cognee-recall.cjs` có 4 **recall mode** (`"mode"` trong registry, default `hybrid`):

| mode | ngữ nghĩa | phụ thuộc |
|---|---|---|
| `semantic` | vector thuần (ANN cosine, mọi bảng) | không |
| `lexical` | BM25-lite thuần trên bảng primary | không |
| `hybrid` | vector + lexical RRF k=60 + 2-hop text-proxy | không |
| `deep` | hybrid + **graph traversal thật** 1–2 hop (dòng `a —rel→ b`) | `@ladybugdb/core` |

- Thiếu engine → `deep` tự rơi về `hybrid` (không lỗi). DB mở READ-ONLY — tắt plugin khi rebuild DB để tránh tranh chấp ghi.
- Pin version: DB build bằng cognee 1.6.4 (ladybug 0.19.0) → dùng `@ladybugdb/core@0.19.0`. Cognee nâng ladybug → đổi pin theo.
- Schema (introspect được qua tool, đừng tin cứng): node table `Node` (property `type`), cạnh `MATCH (a:Node)-[r]->(b:Node)` — **không** ghi `:REL`; property cạnh `r.relationship_name`.

## Files

| File | Vai trò |
|---|---|
| `index.ts` | Plugin v2 (`{id, setup}`) — tự cài CLI + skill, đăng ký lệnh theo registry |
| `cognee-recall.cjs` | CLI truy xuất (e5 nhúng + LanceDB ANN + hybrid RRF + 2-hop proxy) |
| `graph.cjs` | tầng graph in-process (`@ladybugdb/core`, read-only) — tool `cognee_graph` + mode `deep` |
| `cognee-memory-add.cjs` | CLI đăng ký memory + sinh slash command |
| `skills/cognee-memory/SKILL.md` | Skill dạy agent tự cài/đăng ký/debug memory |

## Hiệu năng

Recall ấm **~2–3.5s** (model load ~2s + embed ~40ms + search ~40ms).
