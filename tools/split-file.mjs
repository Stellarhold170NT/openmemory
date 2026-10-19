// Tách 1 file thành các phần < 95MB (giới hạn GitHub: chặn file > 100MB)
// Usage: node split-file.mjs <file> [outDir] [partSizeMB]
import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync, readdirSync, unlinkSync } from "node:fs"
import { join, basename } from "node:path"

const file = process.argv[2]
const outDir = process.argv[3] || process.cwd() + "/parts"
const partSize = Number(process.argv[4] || 90) * 1024 * 1024
if (!file || !existsSync(file)) { console.error("file not found:", file); process.exit(1) }

const name = basename(file)
// chỉ xóa các part CŨ của đúng file này — không đụng file khác trong outDir
if (existsSync(outDir)) for (const f of readdirSync(outDir)) if (f.startsWith(`${name}.part`)) unlinkSync(join(outDir, f))
mkdirSync(outDir, { recursive: true })

const total = statSync(file).size
const nParts = Math.ceil(total / partSize)
const pad = String(nParts).length
let i = 0
let reader = createReadStream(file, { highWaterMark: 4 * 1024 * 1024 })
let writer = null

reader.on("data", (chunk) => {
  if (!writer || writer.bytesWritten + chunk.length > partSize) {
    if (writer) writer.end()
    const part = `${name}.part${String(++i).padStart(pad, "0")}of${String(nParts).padStart(pad, "0")}`
    writer = createWriteStream(join(outDir, part))
  }
  if (!writer.write(chunk)) reader.pause(), writer.once("drain", () => reader.resume())
})
reader.on("end", () => writer && writer.end())
reader.on("error", (e) => { console.error(e); process.exit(1) })
reader.on("close", () => console.log(`split ${name}: ${nParts} parts -> ${outDir}`))
