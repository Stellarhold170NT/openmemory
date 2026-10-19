# openmemory — cognee embedded memory cho OpenCode

Plugin bộ nhớ dài hạn (long-term memory) cho OpenCode — DB cognee **nhúng trực tiếp**, không server, không python, không HTTP.

## Cài đặt

Không cần cơ chế `plugins` trong opencode.json (nó chỉ tải npm-plugin, không mang được skill + slash command). "Cài đặt" = đặt 3 thứ đúng vị trí convention của OpenCode:

```powershell
# 1. clone
git clone https://github.com/Stellarhold170NT/openmemory.git
cd openmemory

# 2. copy CLI + skill vào config global
New-Item -ItemType Directory -Force "$env:USERPROFILE\.config\opencode\cognee" | Out-Null
Copy-Item cognee-recall.cjs, cognee-memory-add.cjs "$env:USERPROFILE\.config\opencode\cognee\"
New-Item -ItemType Directory -Force "$env:USERPROFILE\.config\opencode\skills\cognee-memory" | Out-Null
Copy-Item skills/cognee-memory/SKILL.md "$env:USERPROFILE\.config\opencode\skills\cognee-memory\"

# 3. deps (dùng chung node_modules của opencode cache)
#    thêm "@lancedb/lancedb": "0.40.0" và "@huggingface/transformers": "4.3.1"
#    vào ~/.cache/opencode/package.json rồi:
npm install --prefix "$env:USERPROFILE\.cache\opencode"
```

**Cách B (đề xuất)** — chỉ cần bước 2 (copy), sau đó nói với agent trong OpenCode: *"cài plugin openmemory + đăng ký memory SWEBOK từ <đường dẫn DB>"* — skill `cognee-memory` hướng dẫn agent toàn bộ còn lại (deps, model, đăng ký, verify).

Model e5 (~536MB) tự tải lần đầu khi recall (cache tại `~/.cache/cognee-plugin/models`) — hoặc copy sẵn từ máy cũ.

## Dùng

```
/swe <chủ đề>     # sau khi đăng ký: node cognee-memory-add.cjs swe <dbDir> [mô tả]
```

## Thành phần

```
├── cognee-recall.cjs              CLI truy xuất (e5 nhúng query + LanceDB ANN + format ngữ cảnh)
├── cognee-memory-add.cjs          CLI đăng ký memory + tự sinh slash command (tự cài bản copy)
├── cognee-memory.ts               [dự phòng] bản hook-style v1 API — opencode v2.0.28 chưa hỗ trợ
├── skills/cognee-memory/SKILL.md  Skill dạy agent tự cài/đăng ký/debug memory
└── README.md
```

## Trừu tượng hoá — không hardcode gì

| Thành phần | Nằm ở đâu |
|---|---|
| Đường dẫn DB | registry `~/.config/opencode/cognee-memories.json` → `memories.<name>.dbDir` |
| Model nhúng | `defaults.model` / per-memory `model` / env `COGNEE_E5_MODEL` |
| Vị trí node_modules (deps) | env `COGNEE_DEPS_DIR` → `~/.cache/opencode/node_modules` → cạnh script |
| Vị trí model cache | env `COGNEE_MODELS_DIR` → default `~/.cache/cognee-plugin/models` |
| Bảng Lance search | `defaults.tables` / per-memory `tables` |
| topK / minScore / maxChars | `defaults` + per-memory override |
| Số lượng memory | không giới hạn — mỗi memory 1 slash command riêng |

## Hiệu năng (đo thật)

Recall ấm **~2–3.5s** (model load ~2s + embed ~40ms + search ~40ms). Model download lần đầu ~536MB, 1 lần duy nhất.

## Giới hạn đã biết

- **Auto-inject mỗi message chưa làm được trên opencode v2.0.28** — API plugin mới (`{id, setup}`) đã bỏ hook `chat.message`/`system.transform` (xác minh từ binary + source). Giải pháp hiện tại: slash command chủ động. `cognee-memory.ts` giữ lại để port khi opencode trả lại hook message-time.
- Payload JSON của cognee 1.6.4 bị hỏng nhẹ (quote/newline không escape) — CLI parse tha thứ bằng regex.
- DB phải build bằng đúng embedding model `intfloat/multilingual-e5-large` — sai model là kết quả rác (skill đã ghi chú để agent bắt lỗi).
