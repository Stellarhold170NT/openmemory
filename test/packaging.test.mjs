import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"

const ROOT = path.join(import.meta.dirname, "..")

/** Regression: description YAML phai duoc quote — dau hai cham khong quote lam vo frontmatter
 *  ("mapping values are not allowed in this context" — bug da tung xay ra o v0.4.3). */
test("SKILL.md frontmatter: description duoc quote + dung ten skill", () => {
  const raw = fs.readFileSync(path.join(ROOT, "skills", "openmemory", "SKILL.md"), "utf8")
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  assert.ok(m, "SKILL.md phai co frontmatter")
  const lines = m[1].split(/\r?\n/)
  const nameLine = lines.find((l) => l.startsWith("name:"))
  const descLine = lines.find((l) => l.startsWith("description:"))
  assert.equal(nameLine, "name: openmemory")
  assert.ok(/^description: ".*"$/.test(descLine), `description phai nam trong ngoac kep — hiencoi: ${descLine}`)
})

/** package.json: file quan trọng phải nằm trong "files" (lỗi từng xảy ra với graph-server.py). */
test("package.json files bao gom du cac module runtime", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"))
  for (const f of ["index.ts", "cognee-recall.cjs", "cognee-memory-add.cjs", "graph.cjs", "graph-query.cjs", "doctor.cjs", "skills", "EXAMPLE.md"]) {
    assert.ok(pkg.files.includes(f), `files thieu ${f}`)
  }
})

/** UI strings (description tool + log) khong duoc co ky tu co dau — nguyen nhan mojibake TUI Windows. */
test("khong con ky tu co dau trong description/log cua index.ts", () => {
  const src = fs.readFileSync(path.join(ROOT, "index.ts"), "utf8")
  const uiLines = src.split(/\r?\n/).filter((l) => /log\(|description: "/.test(l))
  const bad = uiLines.filter((l) => /[đĐáàảãạăâêôơưáấầẩẫậéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/.test(l))
  assert.deepEqual(bad, [], `cac dong UI van con dau: ${bad.join(" | ")}`)
})
