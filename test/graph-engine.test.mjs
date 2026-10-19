import { test } from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"

const require = createRequire(import.meta.url)
const ROOT = path.join(import.meta.dirname, "..")
const graphLib = require(path.join(ROOT, "graph.cjs"))
const BUILDER = path.join(import.meta.dirname, "..", "fixtures", "build-tiny-lbug.cjs")

function buildTinyLbug(dbPath) {
  execFileSync(process.execPath, [BUILDER, dbPath], {
    timeout: 60000,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "inherit"],
  })
}

test("graph engine: openGraph read-only + query + traverse", async () => {
  const core = graphLib.resolveCore()
  assert.ok(core, "resolveCore phai tim duoc @ladybugdb/core (set COGNEE_DEPS_DIR neu chay local)")
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "om-graph-"))
  const dbPath = path.join(dir, "tiny.lbug")
  buildTinyLbug(dbPath)

  const api = await graphLib.openGraph(dbPath, { debug: true })
  assert.ok(api, "openGraph tra ve api")

  const rows = await api.query("MATCH (a:Node)-[r]->(b:Node) WHERE a.name = $t RETURN a.name, r.relationship_name, b.name", { t: "requirements elicitation" })
  assert.equal(rows.length, 1)
  assert.equal(rows[0][0], "requirements elicitation")
  assert.equal(rows[0][1], "part_of")
  assert.equal(rows[0][2], "software requirements")

  const lines = await api.traverse(["software requirements"], {})
  assert.ok(lines.some((l) => l.includes("—is_a→")), "traverse phai co dong quan he")
  await graphLib.closeAll()
})

test("graph-query.cjs CLI (duong fallback cua tool openmemory_graph)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "om-gq-"))
  const dbPath = path.join(dir, "tiny.lbug")
  buildTinyLbug(dbPath)
  const cli = path.join(ROOT, "graph-query.cjs")
  const out = execFileSync(process.execPath, [cli, dbPath, "MATCH (a:Node) RETURN a.name ORDER BY a.name", "{}"], { encoding: "utf8", timeout: 60000 })
  const rows = JSON.parse(out)
  assert.deepEqual(rows.map((r) => r[0]), ["knowledgearea", "requirements elicitation", "software requirements"])
})
