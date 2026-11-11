# AgentXray — Amazon settlement report MCP server

A local MCP server that reads your **Amazon settlement reports** and tells your AI assistant what Amazon actually paid you: sales, refunds, promotions, referral and FBA fees, storage, subscription, reimbursements, the net, and profit per SKU — **exact to the cent**, computed on your computer.

- **Runs locally, works offline.** The report is read from your disk and never uploaded. No account, no API keys, no Seller Central login.
- **Money is integer cents.** No floating-point drift; the lines reconcile to the deposit in the report header, and the server tells you when they don't.
- **Same parser as AgentXray's [settlement reader](https://agentxray.ai/tools/settlement-profit-reader)**, checked to the cent against reference results for point and comma decimals, refunds, promotions and messy transaction types (`test/fixtures/settlement`).

Works with Claude Desktop, Claude Code, Cursor, VS Code, and any MCP client that runs local (stdio) servers.

## Tools

| Tool | What it does |
|---|---|
| `read_settlement_report` | Profit and loss for one report: every bucket with its Amazon line types, net, units, orders, average price, FBA fee per unit, referral rate. Give a unit cost (`cogs_per_unit`) and it returns profit after product cost. Optional `start`/`end` date range by posted date. |
| `settlement_profit_by_sku` | The same report grouped by SKU: units, orders, sales, fees, net and net per unit. Lines without a SKU (storage, subscription, most reimbursements) stay in their own group, so the SKUs plus that group equal the net exactly. `include_lines` shows the lines behind a SKU so you can check the arithmetic. |
| `list_settlement_reports` | Finds the settlement reports in a folder (e.g. Downloads) with settlement id, period, deposit date and total, newest first. |

Every answer carries a `basis` (where the numbers came from) and `gaps` (what a settlement report cannot show — e.g. ads billed to a card, costs outside Amazon).

## Install

Requires Node.js 20+.

```json
{
  "mcpServers": {
    "agentxray": {
      "command": "npx",
      "args": ["-y", "github:agentxray-ops/amazon-seller-mcp"]
    }
  }
}
```

Claude Code: `claude mcp add agentxray -- npx -y github:agentxray-ops/amazon-seller-mcp`

Docker: `docker build -t agentxray-mcp .` then mount the folder with your reports: `docker run -i --rm -v ~/Downloads:/reports:ro agentxray-mcp` and ask about files under `/reports`.

From source: `git clone`, `npm install` (builds), `node dist/index.js`.

## Getting a settlement report

Seller Central → **Payments** → **Reports Repository** → report type *Transaction* / *Settlement* → download the **flat file (.txt)** for a settlement period. Then ask, for example:

- "Read ~/Downloads/12345678901.txt — what did Amazon actually pay me, and where did the money go?"
- "My landed cost is 7.40 per unit. What was my profit in that settlement?"
- "Which SKU lost money in that period? Show me the lines for SKU-123."
- "List the settlement reports in my Downloads folder."

## Optional: live data from your Amazon account

Settlement reports arrive every two weeks. If you also want live numbers — orders, Sponsored Products ads and search terms, stock and inbound shipments, account health, returns — this server can add the tools of the hosted [AgentXray](https://agentxray.ai/amazon-mcp) service. That part needs an AgentXray account and is **off unless you set a token**:

```json
"env": { "AGENTXRAY_TOKEN": "axr_..." }
```

Create the token in AgentXray → Settings → AI Assistant. Those calls go to `https://agentxray.ai/api/mcp`; the settlement tools stay local either way. Clients that speak remote MCP can also connect to that endpoint directly (OAuth): setup pages for Claude, ChatGPT, Claude Code and Grok are at https://agentxray.ai/connect. To try the live tools without an account, the public read-only demo token on that page reads a synthetic store.

Without a token, the server makes no network requests.

## Development

```bash
npm install        # installs and builds
npm test           # parser parity + MCP server tests
AGENTXRAY_TEST_TOKEN=axr_... npm test   # also checks the optional live tools
```

## License and contact

MIT. Built by AgentXray (Avanta Global EOOD, Sofia, Bulgaria) — info@avantaglobalgroup.com · [Security](https://agentxray.ai/security) · [Privacy](https://agentxray.ai/privacy)

---

Amazon and Seller Central are trademarks of Amazon.com, Inc. or its affiliates. This project is independent and not affiliated with or endorsed by Amazon. Claude is a trademark of Anthropic; ChatGPT is a trademark of OpenAI.
