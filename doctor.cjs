#!/usr/bin/env node
/**
 * openmemory doctor — kiểm tra sức khỏe cài đặt. Chỉ ĐỌC, không sửa/cài gì.
 *
 * Usage:  node doctor.cjs [--strict]        (--strict: exit 1 nếu có mục [!!])
 *         env COGNEE_HOME=<dir>  → dùng dir thay ~/.config/opencode (cho test/CI)
 * Dùng qua slash command /om-doctor (plugin đăng ký sẵn) hoặc chạy trực tiếp.
 */
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { createRequire } = require("node:module")

const HOME = os.homedir()
const CFG_DIR = process.env.COGNEE_HOME || path.join(HOME, ".config", "opencode")
const REGISTRY = path.join(CFG_DIR, "cognee-memories.json")
const MODEL_DIR = path.join(HOME, ".cache", "cognee-plugin", "models", "Xenova", "multilingual-e5-large")
const MODES = ["semantic", "lexical", "hybrid", "deep"]

const out = []
let hardFail = false
const line = (ok, label, detail) => { out.push(`${ok ? "[ok]" : "[!!]"} ${label}${detail ? " — " + detail : ""}`); if (!ok) hardFail = true }
const info = (label, detail) => out.push(`[..] ${label}${detail ? " — " + detail : ""}`)

// 1) registry
let reg = null
try {
  const raw = fs.readFileSync(REGISTRY, "utf8")
  if (raw.charCodeAt(0) === 0xfeff) info("registry co BOM (recall tu strip, khong nghiem trong)")
  reg = JSON.parse(raw.replace(/^\uFEFF/, ""))
  line(true, "registry doc duoc", REGISTRY)
} catch (e) {
  line(false, "registry khong doc duoc", `${REGISTRY} (${e.message.split("\n")[0]})`)
}

// 2) memories + DB trên đĩa
const memories = (reg && reg.memories) || {}
const names = Object.keys(memories)
line(names.length > 0, `memories da dang ky: ${names.join(", ") || "(khong co)"}`, names.length ? "" : "dang ky bang cognee-memory-add.cjs")

function scanExt(dir, ext, depth = 0, found = []) {
  if (depth > 3) return found
  let entries
  try { entries = fs.readdirSync(dir) } catch { return found }
  for (const e of entries) {
    const p = path.join(dir, e)
    let st
    try { st = fs.statSync(p) } catch { continue }
    if (st.isDirectory()) scanExt(p, ext, depth + 1, found)
    else if (e.endsWith(ext)) found.push(p)
  }
  return found
}

for (const name of names) {
  const dbDir = memories[name] && memories[name].dbDir
  if (!dbDir) { line(false, `${name}: thieu dbDir trong registry`); continue }
  if (!fs.existsSync(dbDir)) { line(false, `${name}: dbDir khong ton tai`, dbDir); continue }
  const lances = scanExt(dbDir, ".lance.db")
  line(lances.length > 0, `${name}: ${lances.length} dataset LanceDB`, dbDir)
  const lbugs = scanExt(dbDir, ".lbug")
  info(`${name}: graph *.lbug`, lbugs.length ? path.basename(lbugs[0]) : "(khong co — mode deep/graph tu suy thoai ve hybrid)")
}

// 3) deps — resolve đúng thứ tự recall CLI dùng
const regDepsDir = (reg && reg.defaults && reg.defaults.depsDir) || null
const candidates = [
  process.env.COGNEE_DEPS_DIR,
  regDepsDir,
  path.join(HOME, ".cache", "opencode", "node_modules"),
  path.join(__dirname, "node_modules"),
  path.join(__dirname, "..", "node_modules"),
].filter(Boolean)
let depsHit = null
for (const nm of candidates) {
  try {
    const req = createRequire(path.join(nm, "noop.js"))
    req("@lancedb/lancedb"); req("@huggingface/transformers")
    depsHit = nm
    break
  } catch { /* candidate kế */ }
}
line(!!depsHit, "deps @lancedb + @huggingface resolve duoc", depsHit || `KHONG tim thay — thu tu thu: ${candidates.join(" ; ") || "(khong co candidate)"}`)

// 4) graph engine (thiếu cũng không chết — có fallback process con)
if (depsHit) {
  try {
    createRequire(path.join(depsHit, "noop.js"))("@ladybugdb/core")
    info("graph engine @ladybugdb/core", `load duoc (${depsHit})`)
  } catch (e) {
    info("graph engine @ladybugdb/core", `khong load duoc trong runtime nay (${e.message.split("\n")[0].slice(0, 80)}) — tool openmemory_graph van chay qua process node con`)
  }
}

// 5) model cache
line(fs.existsSync(MODEL_DIR), "model cache e5", MODEL_DIR + (fs.existsSync(MODEL_DIR) ? "" : " (lan recall dau se tai ~536MB)"))

// 6) mode config
const mode = reg && reg.defaults && reg.defaults.mode
info("recall mode", MODES.includes(mode) ? `${mode}` : "hybrid (mac dinh)")

console.log(`openmemory doctor — ${new Date().toISOString()}`)
console.log(out.join("\n"))
if (process.argv.includes("--strict") && hardFail) process.exit(1)
