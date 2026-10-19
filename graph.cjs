#!/usr/bin/env node
/**
 * graph.cjs — tầng graph IN-PROCESS (v0.4.0): đọc file *.lbug bằng @ladybugdb/core
 * (Node binding chính chủ của engine ladybug, cùng source build với pip ladybug).
 *
 * Không Python, không sidecar, không HTTP — engine chạy trong process Node của plugin.
 * File mở READ-ONLY — không lock phần ghi; cognee build song song vẫn ổn
 * (trừ khi cognee ghi đè chính file đó — tắt plugin khi rebuild là đủ).
 *
 * API:
 *   const g = await openGraph(lbugPath, {debug})   — mở lazy (Database + Connection)
 *   const rows = await g.query(cypher, params?)    — array of arrays
 *   const lines = await g.traverse(terms, opts)    — auto-traversal 1–2 hop → dòng text
 *   await g.close() / closeAll()
 *
 * Schema cognee 1.6.4 (introspect runtime, đừng tin cứng):
 *   node table `Node` (phân loại qua property `type`), edge `REL`,
 *   MATCH (a:Node)-[r]->(b:Node) — KHÔNG ghi [:REL]; property cạnh r.relationship_name.
 *   API Node binding: params → conn.prepare(cypher) + conn.execute(stmt, params); getAll() async.
 */
const { createRequire } = require("node:module")
const os = require("node:os")
const path = require("node:path")
const fs = require("node:fs")

function resolveCore() {
  const candidates = [
    process.env.COGNEE_DEPS_DIR,
    path.join(os.homedir(), ".cache", "opencode", "node_modules"),
    path.join(__dirname, "node_modules"),
    path.join(__dirname, "..", "node_modules"),
  ].filter(Boolean)
  for (const nm of candidates) {
    try {
      return createRequire(path.join(nm, "noop.js"))("@ladybugdb/core")
    } catch { /* candidate kế */ }
  }
  try { return require("@ladybugdb/core") } catch { return null }
}

const caches = new Map() // dbPath -> { db, conn, core, api }

/** Mở (lazy, cache theo path) một file .lbug READ-ONLY. Trả null nếu chưa cài engine. */
async function openGraph(lbugPath, { debug } = {}) {
  if (caches.has(lbugPath)) return caches.get(lbugPath).api
  const core = resolveCore()
  if (!core) {
    if (debug) process.stderr.write("[openmemory-graph] @ladybugdb/core chưa cài — graph tắt. npm i @ladybugdb/core@0.19.0\n")
    return null
  }
  const t0 = Date.now()
  const db = new core.Database(lbugPath, 256 * 1024 * 1024, undefined, true) // bufferPool 256MB, readOnly
  const conn = new core.Connection(db)
  const api = {
    dbPath: lbugPath,
    query: async (cypher, params) => {
      let res
      if (params && Object.keys(params).length) {
        const stmt = await conn.prepare(cypher)
        res = await conn.execute(stmt, params)
      } else {
        res = await conn.query(cypher)
      }
      const list = Array.isArray(res) ? res : [res]
      const out = []
      for (const r of list) {
        for (const row of await r.getAll()) out.push(Object.values(row))
      }
      return out
    },
    /** Auto-traversal: terms (tên entity) → mở rộng 1..2 hop → dòng text "a —rel→ b". */
    traverse: async (terms, { hops = 1, perTerm = 6 } = {}) => {
      const lines = []
      const seen = new Set()
      const esc = (s) => String(s).replace(/'/g, "\\'")
      for (const term of terms.slice(0, 5)) {
        const t = esc(term)
        const cy = hops >= 2
          ? `MATCH (a:Node)-[r1]->(m:Node)-[r2]->(c:Node) WHERE a.name CONTAINS '${t}' RETURN a.name, r1.relationship_name, m.name, r2.relationship_name, c.name LIMIT ${perTerm}`
          : `MATCH (a:Node)-[r]->(b:Node) WHERE a.name CONTAINS '${t}' RETURN a.name, r.relationship_name, b.name LIMIT ${perTerm}`
        try {
          for (const row of await api.query(cy)) {
            const key = row.join("|")
            if (seen.has(key)) continue
            seen.add(key)
            lines.push(hops >= 2
              ? `${row[0]} —${row[1]}→ ${row[2]} —${row[3]}→ ${row[4]}`
              : `${row[0]} —${row[1]}→ ${row[2]}`)
          }
        } catch (e) {
          if (debug) process.stderr.write(`[openmemory-graph] traverse skip "${term}": ${e.message}\n`)
        }
      }
      return lines
    },
    close: async () => {
      const c = caches.get(lbugPath)
      if (c) { try { await c.db.close() } catch {} caches.delete(lbugPath) }
    },
  }
  caches.set(lbugPath, { db, conn, core, api })
  if (debug) process.stderr.write(`[openmemory-graph] opened ${path.basename(lbugPath)} (${Date.now() - t0}ms, read-only)\n`)
  return api
}

/** Đóng mọi connection đang mở (disposer plugin). */
async function closeAll() {
  for (const p of [...caches.keys()]) {
    const c = caches.get(p)
    try { await c.db.close() } catch {}
    caches.delete(p)
  }
}

/** Tìm các *.lbug dưới dbDir (sâu ≤3 tầng). */
function findLbugFiles(dir, depth = 0, out = []) {
  if (depth > 3) return out
  let entries
  try { entries = fs.readdirSync(dir) } catch { return out }
  for (const e of entries) {
    const p = path.join(dir, e)
    let st
    try { st = fs.statSync(p) } catch { continue }
    if (st.isDirectory()) findLbugFiles(p, depth + 1, out)
    else if (e.endsWith(".lbug")) out.push(p)
  }
  return out
}

module.exports = { openGraph, closeAll, findLbugFiles, resolveCore }
