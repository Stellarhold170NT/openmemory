import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"

const ROOT = path.join(import.meta.dirname, "..")
const DOCTOR = path.join(ROOT, "doctor.cjs")

test("doctor: HOME trong trang — bao cao, khong crash, khong --strict thi exit 0", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "om-doctor-"))
  const out = execFileSync(process.execPath, [DOCTOR], {
    encoding: "utf8",
    timeout: 60000,
    env: { ...process.env, COGNEE_HOME: dir },
  })
  assert.ok(out.includes("openmemory doctor"))
  assert.ok(out.includes("[!!] registry khong doc duoc"), "registry chua ton tai phai bao [!!]")
  assert.ok(out.includes("memories da dang ky: (khong co)"))
})

test("doctor: registry co memory + dbDir sai — bao dung cho", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "om-doctor-"))
  fs.writeFileSync(path.join(dir, "cognee-memories.json"), JSON.stringify({
    defaults: { mode: "deep", depsDir: null },
    memories: { swe: { dbDir: path.join(dir, "khong-ton-tai"), description: "fake" } },
  }))
  const out = execFileSync(process.execPath, [DOCTOR], {
    encoding: "utf8",
    timeout: 60000,
    env: { ...process.env, COGNEE_HOME: dir },
  })
  assert.ok(out.includes("memories da dang ky: swe"))
  assert.ok(out.includes("dbDir khong ton tai"))
  assert.ok(out.includes("recall mode — deep"))
})

test("doctor: --strict exit 1 khi co [!!]", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "om-doctor-"))
  assert.throws(() => {
    execFileSync(process.execPath, [DOCTOR, "--strict"], {
      encoding: "utf8",
      timeout: 60000,
      env: { ...process.env, COGNEE_HOME: dir },
    })
  }, /exit code 1|Command failed/i)
})

test("doctor: registry hop le + BOM duoc bao nhe (info, khong fail)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "om-doctor-"))
  fs.writeFileSync(path.join(dir, "cognee-memories.json"), "\uFEFF" + JSON.stringify({
    defaults: {},
    memories: {},
  }))
  const out = execFileSync(process.execPath, [DOCTOR], {
    encoding: "utf8",
    timeout: 60000,
    env: { ...process.env, COGNEE_HOME: dir },
  })
  assert.ok(out.includes("registry co BOM"))
})
