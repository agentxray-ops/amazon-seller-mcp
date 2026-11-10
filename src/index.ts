#!/usr/bin/env node
/**
 * AgentXray Amazon seller MCP server (stdio).
 *
 * Runs on your computer. Out of the box it reads Amazon settlement reports
 * from your own disk and computes what Amazon actually settled — sales, every
 * fee, refunds, the net, profit per SKU — in exact cents, with no account and
 * no network access (see ./local.ts).
 *
 * Optionally, with AGENTXRAY_TOKEN set, it also adds the live tools of the
 * hosted AgentXray server (orders, ads, stock, account health, …) by
 * forwarding those calls to https://agentxray.ai/api/mcp. Without a token no
 * request leaves this machine.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js"
import { callLocalTool, isLocalTool, localTools } from "./local.js"

const VERSION = "2.0.0"
const ENDPOINT = process.env.AGENTXRAY_MCP_URL?.trim() || "https://agentxray.ai/api/mcp"
const TOKEN = process.env.AGENTXRAY_TOKEN?.trim() || ""
const TOKEN_PAGE = "https://agentxray.ai/app/settings?tab=assistant"

const LIVE_TEXT = [
  "The settlement tools work offline, from report files on this computer.",
  "",
  "For live data (orders, Sponsored Products ads, stock, inbound shipments, account health, returns) this server can also",
  "connect to your AgentXray account. That is optional and off until you set a token:",
  "",
  `1. Create a token in AgentXray → Settings → AI Assistant: ${TOKEN_PAGE}`,
  '2. Add it to this server\'s env in your MCP client config: "env": { "AGENTXRAY_TOKEN": "axr_..." }',
  "",
  `The live tools are then forwarded to ${ENDPOINT}. Without a token nothing is sent anywhere.`,
].join("\n")

const liveSetupTool: Tool = {
  name: "agentxray_live_setup",
  title: "Connect live Amazon data (optional)",
  description:
    "Explains how to add live Amazon data (orders, ads, stock, account health) to this server by connecting an AgentXray account. Listed only while no AGENTXRAY_TOKEN is set; the settlement tools do not need it.",
  inputSchema: { type: "object", properties: {} },
  annotations: { readOnlyHint: true, openWorldHint: false },
}

// ---- optional upstream ----------------------------------------------------

let upstream: Promise<Client> | null = null

function connectUpstream(): Promise<Client> {
  if (!upstream) {
    upstream = (async () => {
      const client = new Client({ name: "agentxray-local", version: VERSION })
      const transport = new StreamableHTTPClientTransport(new URL(ENDPOINT), {
        requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
      })
      await client.connect(transport)
      return client
    })().catch((err) => {
      upstream = null // retry on the next request instead of caching the failure
      throw err
    })
  }
  return upstream
}

function explain(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (/\b401\b|unauthori[sz]ed|invalid.*token/i.test(msg)) {
    return `AgentXray rejected the token (it may be revoked or expired). Create a new one at ${TOKEN_PAGE} and update AGENTXRAY_TOKEN. The settlement tools keep working without it.\n\nDetail: ${msg}`
  }
  return `Could not reach AgentXray at ${ENDPOINT}. The settlement tools keep working offline.\n\nDetail: ${msg}`
}

async function liveTools(): Promise<Tool[]> {
  if (!TOKEN) return [liveSetupTool]
  try {
    const client = await connectUpstream()
    const tools: Tool[] = []
    let cursor: string | undefined
    do {
      const page = await client.listTools(cursor ? { cursor } : {})
      tools.push(...page.tools.filter((t) => !isLocalTool(t.name)))
      cursor = page.nextCursor
    } while (cursor)
    return tools
  } catch (err) {
    // A bad token or no network must not take the local tools down with it.
    process.stderr.write(`[agentxray] live tools unavailable: ${explain(err)}\n`)
    return []
  }
}

// ---- server ---------------------------------------------------------------

const server = new Server(
  { name: "agentxray", version: VERSION },
  {
    capabilities: { tools: {}, prompts: {} },
    instructions:
      "Settlement tools read Amazon settlement reports from this computer and return exact amounts with a 'basis' and 'gaps'; repeat the gaps and never fill one with an estimate." +
      (TOKEN ? " Live AgentXray tools are also available for the connected Amazon account." : ""),
  },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [...localTools, ...(await liveTools())],
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params
  if (isLocalTool(name)) return callLocalTool(name, args ?? {})
  if (name === liveSetupTool.name) return { content: [{ type: "text", text: LIVE_TEXT }] }
  if (!TOKEN) {
    return { content: [{ type: "text", text: `"${name}" is a live AgentXray tool.\n\n${LIVE_TEXT}` }], isError: true }
  }
  try {
    const client = await connectUpstream()
    return (await client.callTool(request.params)) as CallToolResult
  } catch (err) {
    return { content: [{ type: "text", text: explain(err) }], isError: true }
  }
})

server.setRequestHandler(ListPromptsRequestSchema, async (request) => {
  if (!TOKEN) return { prompts: [] }
  try {
    return await (await connectUpstream()).listPrompts(request.params)
  } catch {
    return { prompts: [] }
  }
})

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  if (!TOKEN) throw new Error(LIVE_TEXT)
  try {
    return await (await connectUpstream()).getPrompt(request.params)
  } catch (err) {
    throw new Error(explain(err))
  }
})

await server.connect(new StdioServerTransport())
