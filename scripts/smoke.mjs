// Starts the built bridge over stdio and checks both modes.
// Without a token: catalog is listed, a data tool returns setup text.
// With AGENTXRAY_TOKEN: the list and one call come from the hosted server.
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"

async function run(env) {
  const client = new Client({ name: "smoke", version: "1" })
  await client.connect(new StdioClientTransport({ command: "node", args: ["dist/index.js"], env: { PATH: process.env.PATH, ...env } }))
  const { tools } = await client.listTools()
  const res = await client.callTool({ name: "what_can_you_do", arguments: {} })
  await client.close()
  return { count: tools.length, isError: !!res.isError, text: res.content?.[0]?.text ?? "" }
}

const offline = await run({})
if (offline.count < 10 || !offline.isError || !offline.text.includes("AGENTXRAY_TOKEN")) {
  throw new Error(`no-token mode failed: ${JSON.stringify(offline).slice(0, 300)}`)
}
console.log(`no token: ${offline.count} tools listed, data tool returns setup text`)

if (process.env.AGENTXRAY_TOKEN) {
  const live = await run({ AGENTXRAY_TOKEN: process.env.AGENTXRAY_TOKEN })
  if (live.isError || live.text.length < 50) throw new Error(`proxy mode failed: ${JSON.stringify(live).slice(0, 300)}`)
  console.log(`token: ${live.count} tools from the hosted server, what_can_you_do answered (${live.text.length} chars)`)
}
