#!/usr/bin/env node
/**
 * AgentXray MCP bridge — a local stdio server for the hosted AgentXray
 * Amazon Seller Central & Amazon Ads MCP server.
 *
 * With AGENTXRAY_TOKEN set, every request is forwarded to the hosted
 * endpoint over Streamable HTTP and the real answer comes back: this is a
 * working bridge, not a placeholder.
 *
 * Without a token it still starts and lists the tool catalog (a snapshot of
 * the hosted tools/list), so directories and inspectors can see what the
 * server offers. Calling a tool then returns setup instructions instead of
 * data.
 *
 * The bridge holds no data and no secrets of its own. The token lives in
 * your MCP client's config and is sent only to the endpoint below.
 */
import { readFileSync } from "node:fs"
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

const VERSION = "1.2.0"
const ENDPOINT = process.env.AGENTXRAY_MCP_URL?.trim() || "https://agentxray.ai/api/mcp"
const TOKEN = process.env.AGENTXRAY_TOKEN?.trim() || ""
const TOKEN_PAGE = "https://agentxray.ai/app/settings?tab=assistant"
const DEMO_PAGE = "https://agentxray.ai/connect"

const SETUP_TEXT = [
  "AgentXray is not connected yet: no AGENTXRAY_TOKEN is set for this bridge.",
  "",
  `1. Create a token in AgentXray → Settings → AI Assistant: ${TOKEN_PAGE}`,
  `   (or try the public read-only demo token on ${DEMO_PAGE} — a synthetic store, no account needed)`,
  "2. Add it to this server's env in your MCP client config:",
  "",
  '   "agentxray": {',
  '     "command": "npx",',
  '     "args": ["-y", "github:agentxray-ops/amazon-seller-mcp"],',
  '     "env": { "AGENTXRAY_TOKEN": "axr_..." }',
  "   }",
  "",
  `Clients that speak remote MCP can skip the bridge and connect to ${ENDPOINT} directly (OAuth sign-in).`,
].join("\n")

type Catalog = { tools: Tool[] }
const catalog: Catalog = JSON.parse(
  readFileSync(new URL("./catalog.json", import.meta.url), "utf8"),
)

const setupTool: Tool = {
  name: "agentxray_setup",
  title: "How to connect AgentXray",
  description:
    "Explains how to connect this bridge to your AgentXray account (token setup). Only listed while no token is configured.",
  inputSchema: { type: "object", properties: {} },
  annotations: { readOnlyHint: true, openWorldHint: false },
}

// ---- upstream (only used when a token is set) -----------------------------

let upstream: Promise<Client> | null = null

function connectUpstream(): Promise<Client> {
  if (!upstream) {
    upstream = (async () => {
      const client = new Client({ name: "agentxray-bridge", version: VERSION })
      const transport = new StreamableHTTPClientTransport(new URL(ENDPOINT), {
        requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
      })
      await client.connect(transport)
      return client
    })().catch((err) => {
      upstream = null // let the next request retry instead of caching the failure
      throw err
    })
  }
  return upstream
}

function explain(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (/\b401\b|unauthori[sz]ed|invalid.*token/i.test(msg)) {
    return `AgentXray rejected the token (it may be revoked or expired). Create a new one at ${TOKEN_PAGE} and update AGENTXRAY_TOKEN.\n\nDetail: ${msg}`
  }
  return `Could not reach AgentXray at ${ENDPOINT}. Check your connection and try again.\n\nDetail: ${msg}`
}

// List/prompt requests have no result shape for an error, so they throw —
// with the same plain-language reason a tool call would give.
async function viaUpstream<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  try {
    return await fn(await connectUpstream())
  } catch (err) {
    throw new Error(explain(err))
  }
}

function errorResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }], isError: true }
}

// ---- local server ---------------------------------------------------------

const server = new Server(
  { name: "agentxray", version: VERSION },
  {
    capabilities: { tools: {}, prompts: {} },
    instructions: TOKEN
      ? "AgentXray reports measured Amazon seller numbers for the connected account. Every result carries a 'basis' saying where a number came from and may carry 'gaps'; repeat them and never fill a gap with an estimate."
      : "AgentXray is not connected yet. Call agentxray_setup for the steps.",
  },
)

server.setRequestHandler(ListToolsRequestSchema, async (request) => {
  if (!TOKEN) return { tools: [setupTool, ...catalog.tools] }
  return viaUpstream((client) => client.listTools(request.params))
})

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name } = request.params
  if (name === setupTool.name) {
    return { content: [{ type: "text", text: SETUP_TEXT }] }
  }
  if (!TOKEN) {
    // A catalog tool without a token: say how to connect, never pretend to answer.
    return errorResult(`"${name}" needs a connected AgentXray account.\n\n${SETUP_TEXT}`)
  }
  try {
    const client = await connectUpstream()
    return (await client.callTool(request.params)) as CallToolResult
  } catch (err) {
    return errorResult(explain(err))
  }
})

server.setRequestHandler(ListPromptsRequestSchema, async (request) => {
  if (!TOKEN) return { prompts: [] }
  return viaUpstream((client) => client.listPrompts(request.params))
})

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  if (!TOKEN) throw new Error(SETUP_TEXT)
  return viaUpstream((client) => client.getPrompt(request.params))
})

await server.connect(new StdioServerTransport())
