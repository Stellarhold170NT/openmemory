#!/usr/bin/env node
/**
 * graph-query.cjs — chạy 1 câu Cypher trên file *.lbug qua graph.cjs (dòng lệnh, 1 process).
 *
 * Fallback cho môi trường runtime KHÔNG load được native engine in-process
 * (vd opencode trên Windows: DLL @ladybugdb/core init fail trong runtime, nhưng
 * node thuần load bình thường). Trên Linux/macOS index.ts vẫn ưu tiên in-process.
 *
 * Usage:   node graph-query.cjs <lbugPath> <cypher> [paramsJSON]
 * Stdout:  JSON array of rows (mỗi row = array)
 * Lỗi:     exit 1 + stderr
 */
const path = require("node:path")

function loadGraphLib() {
  const candidates = [
    path.join(__dirname, "graph.cjs"),              // bản cài tại ~/.config/opencode/cognee/
    path.join(__dirname, "openmemory", "graph.cjs"), // chạy từ node_modules cha
  ]
  for (const c of candidates) { try { return require(c) } catch { /* kế */ } }
  throw new Error("graph.cjs not found next to " + __dirname)
}

async function main() {
  const [lbugPath, cypher, paramsJson] = process.argv.slice(2)
  if (!lbugPath || !cypher) {
    console.error("Usage: node graph-query.cjs <lbugPath> <cypher> [paramsJSON]")
    process.exit(1)
  }
  let params = {}
  if (paramsJson) {
    try { params = JSON.parse(paramsJson) }
    catch (e) { console.error("paramsJSON invalid: " + e.message); process.exit(1) }
  }
  const g = await loadGraphLib().openGraph(lbugPath, { debug: !!process.env.COGNEE_RECALL_DEBUG })
  if (!g) { console.error("ERROR: @ladybugdb/core khong load duoc trong runtime nay"); process.exit(1) }
  const rows = await g.query(cypher, params)
  process.stdout.write(JSON.stringify(rows, null, 1))
}

main().then(
  () => process.exit(0),
  (e) => { console.error("graph-query error: " + e.message); process.exit(1) },
)
