# AgentXray — Amazon Seller Central & Amazon Ads MCP server

Connect your Amazon seller account to **Claude**, **ChatGPT** or any MCP client, and ask about your store in plain language. Answers come from your own Amazon data — profit is measured from the settlement reports Amazon actually posted, not from a fee calculator.

**Endpoint:** `https://agentxray.ai/api/mcp` (Streamable HTTP, OAuth 2.0 with dynamic client registration)
**Registry:** [`ai.agentxray/mcp`](https://registry.modelcontextprotocol.io/v0/servers?search=agentxray) in the official MCP Registry
**Every tool:** https://agentxray.ai/docs/mcp

> This repository holds documentation only. The server is hosted; there is nothing to install or run.

## What you can ask

- "What did I actually make in the last 30 days, after every Amazon fee?"
- "Which of my products loses money on ads?"
- "Which search terms are wasting my ad budget?"
- "Is my account healthy, and is anything about to stop selling?"
- "Did Amazon receive everything I sent?"
- "How many returns did I get, and why?"

Every answer states its **basis** (where the number came from) and its **gaps** (what it cannot see yet — Amazon settles fees 7–13 days after an order, and recent days are marked as such rather than shown as zero).

## What it reads

| Area | Examples |
|---|---|
| Profit | per account and per SKU, from settlement line items; payouts and why they moved |
| Advertising | Sponsored Products campaigns, ad groups, targets, search terms and placements, priced against your own break-even |
| Stock | stock history, inventory age, reorder timing, Buy Box |
| Account | Amazon's account health rating, inbound FBA shipments and units received short, listing issues, returns with reasons |
| Your changes | what you changed through AgentXray, and whether it earned money 14 days later |

## What it can change

Nothing on its own. If you grant drafting, the assistant can **propose** a change — a bid, a budget, a campaign state, a price, listing copy or an image. The proposal waits in AgentXray until a person approves it in the browser; the token your assistant holds cannot approve. After approval the change is followed for 14 days and can be undone.

## Connect

**Claude (claude.ai, Desktop, mobile):** Settings → Connectors → Add custom connector → `https://agentxray.ai/api/mcp`, then sign in on the AgentXray consent screen. Step by step: https://agentxray.ai/connect/claude

**ChatGPT:** Settings → Apps (Developer mode) → add `https://agentxray.ai/api/mcp`. Step by step: https://agentxray.ai/connect/chatgpt

**Claude Code and other clients:**

```bash
claude mcp add --transport http agentxray https://agentxray.ai/api/mcp
```

Clients that do not run the OAuth flow can use a token created in AgentXray → Settings → AI Assistant, sent as `Authorization: Bearer <token>`.

## Try it without an account

A public demo token reads a sample store (no Amazon account, no sign-up): https://agentxray.ai/connect

## Requirements and pricing

An AgentXray account with Amazon Seller Central connected (Amazon Ads optional). Plans start at $29/month after a 14-day trial — https://agentxray.ai/pricing

## Security

Your own Amazon authorisation, revocable in Seller Central at any time; no role that exposes buyer personal data; every seller's data isolated at the database level; nothing written to Amazon without a person's approval. Details: https://agentxray.ai/security · Privacy: https://agentxray.ai/privacy

## Support

info@avantaglobalgroup.com — AgentXray is operated by Avanta Global EOOD (Sofia, Bulgaria).

---

Amazon, Amazon Ads, Seller Central and related marks are trademarks of Amazon.com, Inc. or its affiliates. AgentXray is an independent application listed on the Selling Partner Appstore and is not affiliated with or endorsed by Amazon. Claude is a trademark of Anthropic; ChatGPT is a trademark of OpenAI.
