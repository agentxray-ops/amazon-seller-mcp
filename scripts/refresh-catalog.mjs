// Refresh src/catalog.json from the hosted server's live tools/list.
// Needs a token: AGENTXRAY_TOKEN=axr_... npm run catalog
import { writeFileSync } from "node:fs"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"

const endpoint = process.env.AGENTXRAY_MCP_URL || "https://agentxray.ai/api/mcp"
const token = process.env.AGENTXRAY_TOKEN
if (!token) throw new Error("Set AGENTXRAY_TOKEN")
const client = new Client({ name: "agentxray-catalog", version: "1" })
await client.connect(new StreamableHTTPClientTransport(new URL(endpoint), {
  requestInit: { headers: { Authorization: `Bearer ${token}` } },
}))
const tools = []
let cursor
do {
  const page = await client.listTools(cursor ? { cursor } : {})
  tools.push(...page.tools)
  cursor = page.nextCursor
} while (cursor)
writeFileSync("src/catalog.json", JSON.stringify({
  note: "Snapshot of the hosted server's tools/list, served only when no AGENTXRAY_TOKEN is set. Refresh: npm run catalog.",
  endpoint,
  tools,
}, null, 1) + "\n")
console.log(`${tools.length} tools written`)
await client.close()
