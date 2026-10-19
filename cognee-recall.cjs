#!/usr/bin/env node
/**
 * cognee-recall.cjs — CLI truy xuất bộ nhớ cognee (nhúng, không server)
 *
 * Usage:  node cognee-recall.cjs <memory-name> <query...>
 *
 * Registry: ~/.config/opencode/cognee-memories.json
 * {
 *   "defaults": { "topK": 4, "minScore": 0.3, "maxChars": 3500,
 *                 "tables": ["DocumentChunk_text", "TextSummary_text"],
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
const DEFAULT_TABLES = ["DocumentChunk_text", "TextSummary_text"]

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
function findLanceDir(dir, depth = 0) {
  if (depth > 2) return null
  let entries
  try { entries = fs.readdirSync(dir) } catch { return null }
  const hit = entries.find((e) => e.endsWith(".lance.db") && fs.statSync(path.join(dir, e)).isDirectory())
  if (hit) return path.join(dir, hit)
  for (const e of entries) {
    const p = path.join(dir, e)
    let st; try { st = fs.statSync(p) } catch { continue }
    if (st.isDirectory()) {
      const found = findLanceDir(p, depth + 1)
      if (found) return found
    }
  }
  return null
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

  const lanceDir = findLanceDir(cfg.dbDir)
  if (!lanceDir) { console.error(`Không tìm thấy *.lance.db dưới ${cfg.dbDir}`); process.exit(1) }

  const topK = cfg.topK ?? 4
  const minScore = cfg.minScore ?? 0.3
  const maxChars = cfg.maxChars ?? 3500
  const tables = Array.isArray(cfg.tables) && cfg.tables.length ? cfg.tables : DEFAULT_TABLES
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
  const seen = new Set()
  const hits = []
  for (const table of tables.filter((t) => available.includes(t))) {
    const tbl = await db.openTable(table)
    const res = await tbl.search(qv).distanceType("cosine").limit(topK * 3).execute()
    for await (const batch of res) {
      for (const row of batch.toArray()) {
        const sim = 1 - Number(row._distance)
        if (sim < minScore) continue
        const { text, doc, chunk } = parseHit(String(row.payload))
        if (!text || text.length < 20) continue
        const key = text.slice(0, 80)
        if (seen.has(key)) continue
        seen.add(key)
        hits.push({ sim, text, doc, chunk, table })
      }
    }
  }
  hits.sort((a, b) => b.sim - a.sim)

  // 3. cắt theo budget + in block ngữ cảnh
  const picked = []
  let used = 0
  for (const h of hits) {
    if (picked.length >= topK) break
    const t = h.text.length > 1200 ? h.text.slice(0, 1200) + "…" : h.text
    if (used + t.length > maxChars && picked.length > 0) break
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
    const src = h.doc ? `${h.doc}${h.chunk ? ` · chunk ${h.chunk}` : ""}` : h.table
    console.log(`[${i + 1}] (match ${(h.sim * 100).toFixed(0)}% · ${src})`)
    console.log(h.text)
    console.log("")
  }
}

main().catch((e) => { console.error("cognee-recall lỗi:", e.message); process.exit(1) })
