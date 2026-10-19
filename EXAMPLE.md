# Hướng dẫn cài đặt openmemory trong 10 phút

openmemory là bộ nhớ dài hạn hoạt động ngay trong OpenCode của bạn. Khi bạn đặt câu hỏi, openmemory sẽ tra cứu trong cơ sở dữ liệu cục bộ của chính bạn, không cần server, không dùng cloud và không gửi dữ liệu đi bất cứ đâu.

## Điều kiện cần chuẩn bị

Máy của bạn cần có:

- **Node.js 22+** (kiểm tra bằng `node --version`)
- **OpenCode** — nếu chưa cài, chạy lệnh sau:

```bash
npm i -g @opencode/cli@latest
```

- Khoảng **2GB dung lượng đĩa trống** (DB mẫu ~850MB sau khi giải nén + model embedding ~550MB tải một lần duy nhất).

> 💡 Nếu `npm i -g` báo lỗi quyền (EACCES), bạn có thể dùng `sudo` hoặc cài qua nvm để tránh lỗi này.

## Bước 1: Bật plugin

Mở tệp `~/.config/opencode/opencode.json` (trên Windows: `C:\Users\<bạn>\.config\opencode\opencode.json`) và thêm vào một dòng:

```json
{ "plugins": ["github:Stellarhold170NT/openmemory"] }
```

Xong. Ở lần chạy kế tiếp, OpenCode tự tải plugin và tự cài **mọi thứ còn lại**: CLI tra cứu + skill `cognee-memory` vào `~/.config/opencode/`, cùng toàn bộ thư viện tra cứu (`@lancedb/lancedb`, `@huggingface/transformers`, graph engine `@ladybugdb/core` đều được khai báo sẵn trong plugin). Không cần chạy bất kỳ lệnh `npm` nào.

## Bước 2: Chuẩn bị một bộ nhớ để sử dụng

Sau khi cài plugin, bạn cần có dữ liệu để openmemory ghi nhớ — giống như một ổ cứng mới cần được định dạng trước khi dùng. Bạn có hai lựa chọn:

**Cách nhanh nhất: tải sẵn cơ sở dữ liệu mẫu.** Repo `openmemory-db-swe` cung cấp bộ nhớ SWEBOK (kiến thức ngành phần mềm) đã được dựng sẵn, dung lượng khoảng 500MB, chia thành 6 phần:

```bash
git clone https://github.com/Stellarhold170NT/openmemory-db-swe
cd openmemory-db-swe
node join-file.mjs swe-sample-db.tar.gz swe-sample-db.tar.gz.part1of6   # ghép 6 phần → 1 file ~486MB
tar -xzf swe-sample-db.tar.gz                                           # ra thư mục databases/
```

*(Tùy chọn: kiểm tra tính toàn vẹn file sau khi ghép bằng `sha256sum -c SHA256SUMS.txt` — phải báo OK.)*

**Cách riêng của bạn: tự dựng cơ sở dữ liệu từ tài liệu của mình.** Bất kỳ thư mục tài liệu nào (sách, wiki công ty, tài liệu dự án...) đều có thể được dựng thành bộ nhớ. Sau khi cài plugin, tham khảo skill `cognee-memory` có sẵn trong OpenCode để biết thêm chi tiết.

## Bước 3: Chỉ cho openmemory biết nơi lưu trữ bộ nhớ

Chạy lệnh sau (thay `<đường-dẫn-thư-mục-databases>` bằng đường dẫn đến thư mục `databases` vừa giải nén):

```bash
# macOS / Linux
node ~/.config/opencode/cognee/cognee-memory-add.cjs swe <đường-dẫn-thư-mục-databases> "SWEBOK v4"
```

```powershell
# Windows (PowerShell)
node "$env:USERPROFILE\.config\opencode\cognee\cognee-memory-add.cjs" swe <đường-dẫn-thư-mục-databases> "SWEBOK v4"
```

> Lệnh trên cần file `cognee-memory-add.cjs` đã tồn tại — nếu chưa, chỉ cần chạy OpenCode một lần bất kỳ trước đó, plugin tự cài nó khi khởi động.

Lệnh này tạo ra:

- Entry `swe` trong registry `~/.config/opencode/cognee-memories.json`
- Slash command `/swe` (từ `~/.config/opencode/commands/swe.md`)

Nếu `/swe` chưa hiện trong phiên đang mở, hãy **mở phiên mới** (hoặc chạy `opencode service restart`). Sau đó thử đặt câu hỏi trực tiếp:

```
/swe requirements elicitation là gì?
```

Câu trả lời sẽ kèm theo các trích dẫn nguồn [1] [2], mỗi nguồn tương ứng với đúng đoạn nội dung trong cơ sở dữ liệu của bạn.

> Có vấn đề? Chạy `/om-doctor` trong OpenCode — lệnh chẩn đoán tự động kiểm tra registry, DB, deps, model cache và graph engine, chỉ ra chính xác cái gì chưa ổn và cách sửa.

## Nếu bạn muốn tìm hiểu sâu hơn

Theo mặc định, openmemory tra cứu bằng phương pháp kết hợp ngữ nghĩa và từ khóa (**hybrid**). Nếu muốn, bạn có thể bật thêm chế độ **deep** để hệ thống lần theo mối quan hệ giữa các khái niệm (multi-hop) — kiểu câu hỏi "kỹ năng X thuộc kiến thức khu vực nào, khu vực đó nằm trong giai đoạn nào" mà tìm từ khóa thuần không ra:

```json
"defaults": { "mode": "deep" }
```

(trong `~/.config/opencode/cognee-memories.json` — có thể đặt cho tất cả hoặc từng memory riêng). Graph engine đi kèm plugin sẵn rồi; nếu vì lý do gì máy không chạy được, hệ thống tự động quay về hybrid, không báo lỗi.

Về tốc độ: **lần hỏi đầu tiên** mất khoảng **1 phút** để tải model embedding về máy (~550MB, chỉ một lần duy nhất). Từ câu hỏi thứ hai, trên máy thường (SSD, CPU hiện đại) phản hồi trong **khoảng 3 giây** (cả vòng dưới 5 giây), mọi thứ chạy cục bộ. Máy có đĩa mạng/CPU yếu có thể lâu hơn — khi đó dùng mode `semantic` sẽ nhanh hơn rõ rệt.

## Những điều openmemory cam kết không làm

- **Không gửi dữ liệu của bạn đi bất cứ đâu**: cơ sở dữ liệu nằm trong máy và việc tra cứu cũng diễn ra ngay trong máy.
- **Không yêu cầu API key, không cần chạy server và không cần Docker.**
- Nếu máy của bạn có cấu hình thấp, openmemory vẫn có thể hoạt động: model mặc định dùng bản lượng tử hóa q8, và khi thiếu engine graph, hệ thống tự động giảm xuống chế độ hybrid — giữ lại những phần cốt lõi.
