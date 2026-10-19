#!/usr/bin/env node
/**
 * cognee-recall.cjs — CLI truy xuất bộ nhớ cognee (nhúng, không server)
 *
 * Usage:  node cognee-recall.cjs <memory-name> <query...>
 *
 * Registry: ~/.config/opencode/cognee-memories.json
 * {
 *   "defaults": { "topK": 4, "minScore": 0.3, "maxChars": 3500,
 *                 "tables": ["*"],              // "*" = mọi bảng có vector trong DB
 *                 "excludeTables": [],          // loại bảng gây nhiễu (tùy chọn)
 *                 "model": "Xenova/multilingual-e5-large" },
 *   "memories": {
 *     "<name>": { "dbDir": "<thư mục databases của cognee export>",
 *                 "description": "...", "topK": 5, "minScore": 0.35, ... }
 *   }
 * }
 * (format cũ — mọi key top-level là memory — vẫn đọc được)
 *
 * Env: COGNEE_DEPS_DIR (thư mục node_modules chứa @lancedb/lancedb + @huggingface/transformers),
 *      COGNEE_MODELS_DIR, COGNEE_RECALL_DEBUG=1
 * Output: block ngữ cảnh ra stdout; diagnostics ra stderr.
 */
const path = require("node:path")
const os = require("node:os")
const fs = require("node:fs")
const { createRequire } = require("node:module")

const HOME = os.homedir()
const CFG_DIR = path.join(HOME, ".config", "opencode")
const REGISTRY = path.join(CFG_DIR, "cognee-memories.json")
const DEFAULT_TABLES = ["*"]

// ---------------------------------------------------------------- deps (không hardcode 1 vị trí node_modules duy nhất)
function resolveDeps() {
  const candidates = [
    process.env.COGNEE_DEPS_DIR,
    path.join(HOME, ".cache", "opencode", "node_modules"),
    path.join(__dirname, "node_modules"),
    path.join(__dirname, "..", "node_modules"),
  ].filter(Boolean)
  for (const nm of candidates) {
    try {
      const req = createRequire(path.join(nm, "noop.js"))
      const deps = { lancedb: req("@lancedb/lancedb"), hf: req("@huggingface/transformers") }
      if (process.env.COGNEE_RECALL_DEBUG) process.stderr.write(`[deps: ${nm}]\n`)
      return deps
    } catch { /* thử candidate kế tiếp */ }
  }
  return { lancedb: require("@lancedb/lancedb"), hf: require("@huggingface/transformers") }
}
const { lancedb, hf } = resolveDeps()

// ---------------------------------------------------------------- registry
function loadRegistry() {
  let raw = {}
  try { raw = JSON.parse(fs.readFileSync(REGISTRY, "utf8").replace(/^\uFEFF/, "")) } catch {}
  // format mới: { defaults, memories } — format cũ: mọi key là 1 memory
  if (raw && typeof raw === "object" && raw.memories && typeof raw.memories === "object") {
    return { defaults: raw.defaults || {}, memories: raw.memories }
  }
  const memories = {}
  for (const [k, v] of Object.entries(raw || {})) {
    if (v && typeof v === "object" && v.dbDir) memories[k] = v
  }
  return { defaults: {}, memories }
}

// ---------------------------------------------------------------- helpers
// trả về TẤT CẢ các *.lance.db dưới dbDir (dbDir có thể chứa nhiều dataset/export)
function findLanceDirs(dir, depth = 0, out = []) {
  if (depth > 2) return out
  let entries
  try { entries = fs.readdirSync(dir) } catch { return out }
  for (const e of entries) {
    const p = path.join(dir, e)
    let st; try { st = fs.statSync(p) } catch { continue }
    if (st.isDirectory() && e.endsWith(".lance.db")) out.push(p)
    else if (st.isDirectory()) findLanceDirs(p, depth + 1, out)
  }
  return out
}

// payload JSON của cognee 1.6.4 bị hỏng (quote/newline không escape) — parse thủ công
function extractField(raw, key) {
  const idx = raw.indexOf(`"${key}": "`)
  if (idx === -1) return null
  let out = ""
  for (let i = idx + key.length + 5; i < raw.length; i++) {
    const c = raw[i]
    if (c === "\\") { out += c + (raw[i + 1] ?? ""); i++; continue }
    if (c === '"') break
    out += c
  }
  return out
}
function unescapeText(s) {
  return s.replace(/\r/g, "").replace(/\\\\/g, "\u0000").replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t").replace(/\\"/g, '"').replace(/\u0000/g, "\\").replace(/\n{3,}/g, "\n\n")
}
function parseHit(raw) {
  return {
    doc: extractField(raw, "document_name") ?? extractField(raw, "name") ?? "",
    chunk: (raw.match(/"chunk_index": (\d+)/) || [])[1] ?? "",
    text: unescapeText(extractField(raw, "text") ?? ""),
  }
}

// cognee đổi format payload on-disk giữa các install: chuỗi JSON (lúc build cũ, có thể hỏng escape)
// hoặc struct native (model_dump → object). Plugin phải đọc được CẢ HAI — fail mode sai-lặng-không-báo là bug.
function parseRow(row) {
  const p = row.payload
  if (typeof p === "string") return parseHit(p)
  const o = p || {}
  return {
    doc: String(o.document_name ?? o.name ?? ""),
    chunk: o.chunk_index != null ? String(o.chunk_index) : "",
    text: unescapeText(String(o.text ?? "")),
  }
}

// ---------------------------------------------------------------- main
async function main() {
  const t0 = Date.now()
  const [name, ...queryParts] = process.argv.slice(2)
  const query = queryParts.join(" ").trim()
  if (!name || !query) {
    console.error("Usage: node cognee-recall.cjs <memory-name> <query>")
    console.error(`Registered: ${Object.keys(loadRegistry().memories).join(", ") || "(none)"}`)
    process.exit(2)
  }
  const { defaults, memories } = loadRegistry()
  const cfg = { ...defaults, ...(memories[name] || {}) }
  if (!memories[name]) {
    console.error(`Memory "${name}" chưa đăng ký. Xem ${REGISTRY}`)
    process.exit(2)
  }
  if (!cfg.dbDir) { console.error(`Memory "${name}" thiếu dbDir`); process.exit(2) }

  const lanceDirs = findLanceDirs(cfg.dbDir)
  if (!lanceDirs.length) { console.error(`Không tìm thấy *.lance.db dưới ${cfg.dbDir}`); process.exit(1) }
  // chọn dataset: cfg.dataset (substring tên thư mục) — nếu không chỉ định và có >1 thì dùng cái đầu + cảnh báo
  let lanceDir = lanceDirs[0]
  if (cfg.dataset) {
    const hit = lanceDirs.find((d) => path.basename(d).toLowerCase().includes(String(cfg.dataset).toLowerCase()))
    if (!hit) process.stderr.write(`[openmemory] không có dataset khớp "${cfg.dataset}" — dùng ${path.basename(lanceDir)}\n`)
    else lanceDir = hit
  } else if (lanceDirs.length > 1) {
    process.stderr.write(`[openmemory] dbDir có ${lanceDirs.length} dataset — đang dùng ${path.basename(lanceDir)}; chọn bằng "dataset": "<tên>"\n`)
  }

  const topK = cfg.topK ?? 4
  const minScore = cfg.minScore ?? 0.3
  const maxChars = cfg.maxChars ?? 3500
  const tables = Array.isArray(cfg.tables) && cfg.tables.length ? cfg.tables : DEFAULT_TABLES
  const excludeTables = Array.isArray(cfg.excludeTables) ? cfg.excludeTables : []
  // "*" = tận dụng toàn bộ memory (mọi bảng có vector)
  const wanted = tables.includes("*") ? null : tables
  const model = cfg.model || process.env.COGNEE_E5_MODEL || "Xenova/multilingual-e5-large"
  const modelsDir = process.env.COGNEE_MODELS_DIR || path.join(HOME, ".cache", "cognee-plugin", "models")

  // 1. nhúng query (prefix "query: " khớp fastembed lúc build DB)
  hf.env.cacheDir = modelsDir
  fs.mkdirSync(modelsDir, { recursive: true })
  const embedder = await hf.pipeline("feature-extraction", model, { dtype: cfg.dtype || "q8" })
  const out = await embedder(`query: ${query}`, { pooling: "mean", normalize: true })
  const qv = Array.from(out.data)

  // 2. vector search các bảng cấu hình
  const db = await lancedb.connect(lanceDir)
  const available = await db.tableNames()
  // primaryTables match kiểu substring (tên bảng cognee có thể khác giữa các version/dataset)
  const primaryTables = Array.isArray(cfg.primaryTables) ? cfg.primaryTables : ["chunk", "summary", "sessionqa"]
  const isPrimary = (t) => primaryTables.some((p) => t.toLowerCase().includes(String(p).toLowerCase()))
  const secondaryLimit = cfg.secondaryLimit ?? 50 // bảng non-primary (entity/edge) được pool sâu hơn — cánh cửa 1-hop vào graph
  const seen = new Set()
  const hits = []
  let rowsSeen = 0, parsedOK = 0
  let simMin = Infinity, simMax = -Infinity
  for (const table of (wanted ?? available).filter((t) => available.includes(t) && !excludeTables.includes(t))) {
    const tbl = await db.openTable(table)
    const res = await tbl.search(qv).distanceType("cosine").limit(isPrimary(table) ? topK * 3 : secondaryLimit).execute()
    for await (const batch of res) {
      for (const row of batch.toArray()) {
        rowsSeen++
        const sim = 1 - Number(row._distance)
        if (sim < simMin) simMin = sim
        if (sim > simMax) simMax = sim
        const { text, doc, chunk } = parseRow(row)
        if (text && text.length >= 20) parsedOK++
        if (sim < minScore) continue
        if (!text || text.length < 20) continue
        const key = text.slice(0, 80)
        if (seen.has(key)) continue
        seen.add(key)
        hits.push({ sim, text, doc, chunk, table })
      }
    }
  }
  // fail-loud với lý do ĐÚNG: schema hỏng ≠ query lệch chủ đề
  if (rowsSeen > 0 && !hits.length) {
    if (parsedOK === 0) {
      process.stderr.write(`[openmemory] CẢNH BÁO: ${rowsSeen} dòng được scan nhưng 0 dòng parse được text — schema payload không nhận diện được (string hay struct?). Báo kèm COGNEE_RECALL_DEBUG=1.\n`)
    } else {
      process.stderr.write(`[openmemory] 0 hit — schema OK (${parsedOK}/${rowsSeen} dòng parse được) nhưng sim toàn ngoài ngưỡng: max ${(Math.max(0, simMax) * 100).toFixed(0)}% < minScore ${(minScore * 100).toFixed(0)}%. Hạ minScore hoặc đổi query.\n`)
    }
  }
  hits.sort((a, b) => b.sim - a.sim)

  // 3. xếp hạng hybrid: bảng primary (chunk/summary/QA) trước; secondary (entity/edge) lấp chỗ
  const primaryHits = hits.filter((h) => isPrimary(h.table))
  const secondaryHits = hits.filter((h) => !isPrimary(h.table))
  if (!primaryHits.length && hits.length) {
    process.stderr.write(`[openmemory] cảnh báo: không tìm thấy bảng primary (${primaryTables.join(", ")}) trong [${available.join(", ")}] — xếp hạng theo sim thuần\n`)
  }

  // 3b. lexical pass trên bảng primary — bắt term chính xác mà vector trượt (vd "ISO/IEC 25010")
  //     fuse với vector bằng RRF (k=60). lexScan: 0 = tắt hybrid.
  const lexScan = cfg.lexScan ?? 5000
  let ordered = [...primaryHits, ...secondaryHits]
  if (lexScan > 0) { // chỉ quét tối đa lexScan dòng/bảng — không quét DB lớn
    try {
      const terms = [...new Set((query.toLowerCase().match(/[a-zà-ỹ0-9]{2,}/gi) || []).filter((t) => t.length >= 2))]
      if (terms.length) {
        const docs = []
        for (const table of available.filter((t) => isPrimary(t) && !excludeTables.includes(t))) {
          const tbl = await db.openTable(table)
          const r = await tbl.query().select(["payload"]).limit(lexScan).execute()
          for await (const batch of r) {
            for (const row of batch.toArray()) {
              const { text, doc, chunk } = parseRow(row)
              if (text && text.length >= 20) docs.push({ text, doc, chunk, table })
            }
          }
        }
        const df = new Map()
        for (const d of docs) {
          const low = d.text.toLowerCase()
          for (const t of terms) if (low.includes(t)) df.set(t, (df.get(t) || 0) + 1)
        }
        const scored = []
        for (const d of docs) {
          const low = d.text.toLowerCase()
          let score = 0
          for (const t of terms) {
            const n = (low.match(new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length
            if (n) score += Math.log(1 + docs.length / (1 + (df.get(t) || 0))) * (1 + Math.log(n))
          }
          if (score > 0) scored.push({ ...d, lex: score })
        }
        scored.sort((a, b) => b.lex - a.lex)
        const lexTop = scored.slice(0, 12)
        const K = 60
        const vRank = new Map(primaryHits.map((h, i) => [h.text.slice(0, 80), i]))
        const lRank = new Map(lexTop.map((h, i) => [h.text.slice(0, 80), i]))
        const fused = new Map()
        for (const h of primaryHits) fused.set(h.text.slice(0, 80), { ...h, rrf: 1 / (K + (vRank.get(h.text.slice(0, 80)) ?? K + 99)) + (lRank.has(h.text.slice(0, 80)) ? 1 / (K + lRank.get(h.text.slice(0, 80))) : 0) })
        for (const h of lexTop) {
          const key = h.text.slice(0, 80)
          if (!fused.has(key)) fused.set(key, { ...h, sim: null, rrf: 1 / (K + (lRank.get(key) ?? K + 99)) })
        }
        const primaryFused = [...fused.values()].sort((a, b) => b.rrf - a.rrf)
        let extra = secondaryHits
        // 2-hop proxy: entity/edge hit → tìm chunk/summary nhắc tới thực thể đó (tận dụng docs đã quét)
        if (cfg.hop2 !== false && docs.length && secondaryHits.length) {
          const hopTerms = []
          for (const h of secondaryHits.slice(0, 3)) {
            const m = h.text.toLowerCase().match(/^(.{3,80}?)\s+is\s+(a|an|the)\s/)
            const term = (m ? m[1] : (h.table.toLowerCase().includes("entity") ? h.text : "")).trim()
            if (term.length >= 3) hopTerms.push(term)
          }
          if (hopTerms.length) {
            const hopSeen = new Set([...primaryFused, ...secondaryHits].map((h) => h.text.slice(0, 80)))
            const hopHits = []
            for (const d of docs) {
              const key = d.text.slice(0, 80)
              if (hopSeen.has(key)) continue
              const low = d.text.toLowerCase()
              const term = hopTerms.find((t) => low.includes(t))
              if (term) { hopSeen.add(key); const t = d.text.length > 600 ? d.text.slice(0, 600) + "…" : d.text; hopHits.push({ ...d, text: t, sim: null, hop2: term }) }
            }
            if (hopHits.length) extra = [...hopHits.slice(0, 2), ...secondaryHits]
          }
        }
        ordered = [...primaryFused, ...extra]
      }
    } catch (e) {
      process.stderr.write(`[openmemory] hybrid bỏ qua: ${e.message}\n`)
      ordered = [...primaryHits, ...secondaryHits]
    }
  }

  // 3. cắt theo budget + in block ngữ cảnh
  const picked = []
  let used = 0
  for (const h of ordered) {
    if (picked.length >= topK) break
    const t = h.text.length > 1200 ? h.text.slice(0, 1200) + "…" : h.text
    if (used + t.length > maxChars && picked.length > 0) continue
    used += t.length
    picked.push({ ...h, text: t })
  }
  const ms = Date.now() - t0
  if (process.env.COGNEE_RECALL_DEBUG) process.stderr.write(`[recall ${ms}ms, ${picked.length} hits]\n`)
  if (!picked.length) {
    console.log(`(Không tìm thấy nội dung nào khớp "${query}" trong bộ nhớ ${name})`)
    return
  }
  for (const [i, h] of picked.entries()) {
    const src = (h.doc ? `${h.doc}${h.chunk ? ` · chunk ${h.chunk}` : ""}` : h.table) + (h.hop2 ? ` [2-hop: ${h.hop2}]` : "")
    const simLabel = h.sim == null ? "term" : `match ${(h.sim * 100).toFixed(0)}%`
    console.log(`[${i + 1}] (${simLabel} · ${src})`)
    console.log(h.text)
    console.log("")
  }
}

main().catch((e) => { console.error("cognee-recall lỗi:", e.message); process.exit(1) })
