// Starts the built server over stdio and drives it like an MCP client.
// Offline mode needs nothing. Set AGENTXRAY_TEST_TOKEN to also check the
// optional live tools against the hosted server (the public demo token on
// https://agentxray.ai/connect works).
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const FIX = path.join(ROOT, "test/fixtures/settlement")

async function connect(env = {}) {
  const client = new Client({ name: "test", version: "1" })
  await client.connect(new StdioClientTransport({
    command: "node", args: [path.join(ROOT, "dist/index.js")],
    env: { PATH: process.env.PATH, HOME: process.env.HOME ?? "", ...env }, stderr: "ignore",
  }))
  return client
}
const text = (r) => r.content[0].text

test("offline: lists the settlement tools and the optional live setup tool only", async () => {
  const c = await connect()
  const names = (await c.listTools()).tools.map((t) => t.name).sort()
  assert.deepEqual(names, ["agentxray_live_setup", "list_settlement_reports", "read_settlement_report", "settlement_profit_by_sku"])
  await c.close()
})

test("offline: reads a settlement report to the cent", async () => {
  const c = await connect()
  const r = await c.callTool({ name: "read_settlement_report", arguments: { path: path.join(FIX, "simple_point.tsv") } })
  assert.equal(r.isError, undefined)
  assert.equal(r.structuredContent.net, "39.46")
  assert.equal(r.structuredContent.units, 2)
  assert.equal(r.structuredContent.fba_fee_per_unit, "10.85")
  assert.equal(r.structuredContent.profit, null)
  const withCost = await c.callTool({ name: "read_settlement_report", arguments: { path: path.join(FIX, "simple_point.tsv"), cogs_per_unit: "7.40" } })
  assert.equal(withCost.structuredContent.profit, "24.66")
  const half = await c.callTool({ name: "read_settlement_report", arguments: { path: path.join(FIX, "simple_point.tsv"), start: "2026-07-01", end: "2026-07-15" } })
  assert.equal(half.structuredContent.net, "19.73")
  await c.close()
})

test("offline: per-SKU view adds up to the report net", async () => {
  const c = await connect()
  const r = await c.callTool({ name: "settlement_profit_by_sku", arguments: { path: path.join(FIX, "refund.tsv"), include_lines: true } })
  assert.equal(r.isError, undefined)
  const d = r.structuredContent
  const cents = (s) => Math.round(Number(s) * 100)
  assert.equal(d.skus.reduce((a, s) => a + cents(s.net), 0) + cents(d.unattributed.net), cents(d.net))
  assert.ok(d.skus[0].lines.length > 0)
  await c.close()
})

test("offline: finds settlement reports in a folder and skips other files", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "axr-"))
  writeFileSync(path.join(dir, "notes.txt"), "not a report")
  writeFileSync(path.join(dir, "s.txt"), (await import("node:fs")).readFileSync(path.join(FIX, "simple_point.tsv")))
  const c = await connect()
  const r = await c.callTool({ name: "list_settlement_reports", arguments: { directory: dir } })
  assert.equal(r.structuredContent.reports.length, 1)
  assert.equal(r.structuredContent.reports[0].total_deposit, "39.46")
  await c.close()
})

test("offline: clear errors for a missing file, a non-report and a bad cost", async () => {
  const c = await connect()
  const missing = await c.callTool({ name: "read_settlement_report", arguments: { path: "/no/such/file.txt" } })
  assert.equal(missing.isError, true)
  assert.match(text(missing), /not found/)
  const dir = mkdtempSync(path.join(tmpdir(), "axr-"))
  writeFileSync(path.join(dir, "x.txt"), "hello\nworld\n")
  const notReport = await c.callTool({ name: "read_settlement_report", arguments: { path: path.join(dir, "x.txt") } })
  assert.equal(notReport.isError, true)
  assert.match(text(notReport), /does not look like an Amazon settlement report/)
  const badCost = await c.callTool({ name: "read_settlement_report", arguments: { path: path.join(FIX, "simple_point.tsv"), cogs_per_unit: "abc" } })
  assert.equal(badCost.isError, true)
  const live = await c.callTool({ name: "get_orders", arguments: {} })
  assert.equal(live.isError, true)
  assert.match(text(live), /AGENTXRAY_TOKEN/)
  await c.close()
})

test("a rejected token leaves the settlement tools working", async () => {
  const c = await connect({ AGENTXRAY_TOKEN: "axr_invalid", AGENTXRAY_MCP_URL: process.env.AGENTXRAY_TEST_URL || "https://agentxray.ai/api/mcp" })
  const names = (await c.listTools()).tools.map((t) => t.name)
  assert.ok(names.includes("read_settlement_report"))
  const r = await c.callTool({ name: "read_settlement_report", arguments: { path: path.join(FIX, "simple_point.tsv") } })
  assert.equal(r.structuredContent.net, "39.46")
  await c.close()
})

test("live tools with a real token", { skip: !process.env.AGENTXRAY_TEST_TOKEN }, async () => {
  const c = await connect({ AGENTXRAY_TOKEN: process.env.AGENTXRAY_TEST_TOKEN })
  const names = (await c.listTools()).tools.map((t) => t.name)
  assert.ok(names.includes("read_settlement_report"))
  assert.ok(names.includes("what_can_you_do"))
  assert.ok(!names.includes("agentxray_live_setup"))
  const r = await c.callTool({ name: "what_can_you_do", arguments: {} })
  assert.ok(!r.isError && text(r).length > 50)
  await c.close()
})
