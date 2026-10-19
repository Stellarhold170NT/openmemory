// Build DB graph tổng hợp trong process con (process exit chắc chắn nhả file lock
// trên Windows — giống thực tế: cognee build xong thoát, openmemory đọc sau).
const path = require("node:path")
const graphLib = require(path.join(__dirname, "..", "graph.cjs"))

async function main() {
  const dbPath = process.argv[2]
  const core = graphLib.resolveCore()
  if (!core) throw new Error("resolveCore khong tim duoc @ladybugdb/core")
  const db = new core.Database(dbPath, 128 * 1024 * 1024)
  await db.init()
  const conn = new core.Connection(db)
  await conn.query("CREATE NODE TABLE Node(name STRING, type STRING, PRIMARY KEY(name))")
  await conn.query("CREATE REL TABLE REL(FROM Node TO Node, relationship_name STRING)")
  for (const [name, type] of [["requirements elicitation", "Entity"], ["software requirements", "Entity"], ["knowledgearea", "EntityType"]]) {
    await conn.query(`CREATE (:Node {name: '${name}', type: '${type}'})`)
  }
  await conn.query("MATCH (a:Node {name:'requirements elicitation'}), (b:Node {name:'software requirements'}) CREATE (a)-[:REL {relationship_name:'part_of'}]->(b)")
  await conn.query("MATCH (a:Node {name:'software requirements'}), (b:Node {name:'knowledgearea'}) CREATE (a)-[:REL {relationship_name:'is_a'}]->(b)")
  await conn.close()
  await db.close()
}
main().then(() => process.exit(0)).catch((e) => { console.error("build-tiny-lbug error:", e.message); process.exit(1) })
