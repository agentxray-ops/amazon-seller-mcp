/**
 * Local tools: read Amazon settlement reports from the seller's own disk.
 * Nothing here touches the network — the file is read, parsed and totalled
 * on this machine, in integer cents.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { extname, isAbsolute, join, resolve } from "node:path"
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js"
// Plain JS module shared with the browser reader; typed loosely on purpose.
import * as pnlModule from "./settlementPnl.js"
const pnl: any = pnlModule

const MAX_BYTES = 50 * 1024 * 1024
const REPORT_EXTS = new Set([".txt", ".tsv", ".csv", ""])

type Args = Record<string, unknown>

const dateProp = (what: string) => ({
  type: "string",
  pattern: "^\\d{4}-\\d{2}-\\d{2}$",
  description: `${what} (YYYY-MM-DD, inclusive), compared with each line's posted date — the day Amazon moved the money. Omit for the whole report.`,
})

export const localTools: Tool[] = [
  {
    name: "read_settlement_report",
    title: "Profit and loss from an Amazon settlement report",
    description:
      "Reads an Amazon settlement report (the tab-separated flat file from Seller Central → Payments → Reports Repository) from this computer and returns what Amazon actually settled: sales, refunds, promotions, referral and FBA fees, storage, subscription, reimbursements and the net, plus units, orders, average price, FBA fee per unit and referral rate. With a unit cost it also returns profit after product cost. Amounts are exact to the cent. The file never leaves this machine.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the settlement report file (absolute, relative, or starting with ~)." },
        start: dateProp("Start date"),
        end: dateProp("End date"),
        cogs_per_unit: {
          type: "string",
          description: "Optional landed cost per unit in the report's currency, e.g. \"7.40\". Used to compute profit after product cost.",
        },
      },
      required: ["path"],
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "settlement_profit_by_sku",
    title: "Settlement net per SKU",
    description:
      "Groups the lines of an Amazon settlement report by SKU and returns, for each SKU, units, orders, sales, fees by bucket, net and net per unit. Lines Amazon booked without a SKU (storage, subscription, most reimbursements) are kept as their own unattributed group instead of being spread across products, so the SKU nets plus that group equal the report's net exactly. Set include_lines to see the individual lines behind one SKU.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the settlement report file." },
        start: dateProp("Start date"),
        end: dateProp("End date"),
        sku: { type: "string", description: "Optional: return only this SKU." },
        include_lines: { type: "boolean", description: "Include the individual settlement lines per SKU (default false)." },
      },
      required: ["path"],
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "list_settlement_reports",
    title: "Find settlement reports in a folder",
    description:
      "Lists the Amazon settlement reports in a folder on this computer (for example your Downloads folder), with settlement id, period, deposit date, currency and deposit total for each, newest period first. Files that are not settlement reports are skipped.",
    inputSchema: {
      type: "object",
      properties: {
        directory: { type: "string", description: "Folder to look in (absolute, relative, or starting with ~)." },
      },
      required: ["directory"],
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
]

const LOCAL_NAMES = new Set(localTools.map((t) => t.name))
export const isLocalTool = (name: string) => LOCAL_NAMES.has(name)

// ---- helpers --------------------------------------------------------------

class UserError extends Error {}

function expand(p: unknown): string {
  if (typeof p !== "string" || !p.trim()) throw new UserError("path is required")
  let s = p.trim()
  if (s === "~" || s.startsWith("~/")) s = join(homedir(), s.slice(1))
  return isAbsolute(s) ? s : resolve(process.cwd(), s)
}

function optDate(v: unknown, name: string): string | null {
  if (v === undefined || v === null || v === "") return null
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new UserError(`${name} must be YYYY-MM-DD`)
  return v
}

function readReport(path: string): string {
  const st = statSync(path)
  if (!st.isFile()) throw new UserError(`${path} is not a file`)
  if (st.size > MAX_BYTES) throw new UserError(`${path} is ${Math.round(st.size / 1048576)} MB; the limit is 50 MB`)
  return readFileSync(path, "utf8").replace(/^﻿/, "")
}

const money = (cents: number | null | undefined) => (cents === null || cents === undefined ? null : pnl.centsToString(cents))
const pct = (hundredths: number | null) => (hundredths === null ? null : (hundredths / 100).toFixed(2))

function parse(path: string) {
  try {
    return pnl.parseSettlement(readReport(path))
  } catch (err) {
    if (err instanceof pnl.SettlementParseError) {
      throw new UserError(`${path} does not look like an Amazon settlement report (${(err as Error).message}). Download the flat file (.txt) from Seller Central → Payments → Reports Repository.`)
    }
    throw err
  }
}

function ok(summary: string, data: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: `${summary}\n\n${JSON.stringify(data, null, 2)}` }],
    structuredContent: data as Record<string, unknown>,
  }
}

const today = () => new Date().toISOString().slice(0, 10)

// ---- tools ----------------------------------------------------------------

function readSettlement(args: Args): CallToolResult {
  const path = expand(args.path)
  const start = optDate(args.start, "start")
  const end = optDate(args.end, "end")
  let cogs: number | null = null
  if (args.cogs_per_unit !== undefined && args.cogs_per_unit !== null && String(args.cogs_per_unit).trim() !== "") {
    const raw = String(args.cogs_per_unit).trim().replace(",", ".")
    if (!/^\d+(\.\d{1,2})?$/.test(raw)) throw new UserError(`cogs_per_unit must be a positive amount like "7.40", got "${args.cogs_per_unit}"`)
    cogs = pnl.parseCents(raw, "point")
  }
  const { header, items } = parse(path)
  const file = pnl.summarise(header, items, today())
  const a = pnl.analyse(items, { start, end, cogsPerUnitCents: cogs })
  const cur = file.currency
  const data = {
    basis: "Amazon settlement report lines read from the file on this computer; totals in exact cents.",
    file: {
      path,
      settlement_id: header.settlement_id,
      currency: cur,
      period_start: file.period_start,
      period_end: file.period_end,
      deposit_date: header.deposit_date,
      total_deposit: money(file.total_deposit),
      lines_minus_deposit: money(file.header_delta),
      line_count: file.line_count,
    },
    range: { start, end },
    buckets: a.buckets.map((b: any) => ({
      bucket: b.bucket,
      amount: money(b.amount),
      lines: b.line_count,
      breakdown: b.breakdown.map((x: any) => ({ amount_type: x.amount_type, amount_description: x.amount_description, amount: money(x.amount) })),
    })),
    net: money(a.net),
    units: a.units,
    orders: a.orders,
    price_per_unit: money(a.price_per_unit),
    fba_fee_per_unit: money(a.fulfilment_per_unit),
    referral_pct: pct(a.referral_pct),
    cogs_per_unit: money(a.cogs_per_unit),
    cogs_total: money(a.cogs_total),
    profit: money(a.profit),
    lines_in_range: a.lines_total,
    lines_without_date: a.lines_without_date,
    gaps: [
      ...(a.profit === null ? ["No unit cost given, so profit after product cost is not computed; the net is what Amazon settled."] : []),
      "Advertising billed to a card and costs outside Amazon are not in a settlement report.",
      ...(file.header_delta !== 0 ? ["The lines do not add up to the deposit total in the header; check for a truncated file."] : []),
    ],
  }
  const summary = `Settlement ${header.settlement_id || ""} (${file.period_start ?? "?"} → ${file.period_end ?? "?"}), ${cur}: net ${data.net} over ${a.units} units / ${a.orders} orders` +
    (a.profit !== null ? `, profit after product cost ${data.profit}.` : ".")
  return ok(summary, data)
}

function bySku(args: Args): CallToolResult {
  const path = expand(args.path)
  const start = optDate(args.start, "start")
  const end = optDate(args.end, "end")
  const only = typeof args.sku === "string" && args.sku.trim() ? args.sku.trim() : null
  const withLines = args.include_lines === true
  const { header, items } = parse(path)
  const r = pnl.bySku(items, { start, end })
  const fmtBuckets = (b: Record<string, number>) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, money(v)]))
  const fmtLine = (l: any) => ({
    posted_date: l.posted_date, order_id: l.order_id || null, transaction_type: l.transaction_type || null,
    amount_type: l.amount_type, amount_description: l.amount_description, quantity: l.quantity ?? null, amount: money(l.amount),
  })
  let skus = r.skus
  if (only) {
    skus = skus.filter((s: any) => s.sku === only)
    if (!skus.length) throw new UserError(`SKU ${only} has no lines in this report${start || end ? " for that range" : ""}`)
  }
  const data = {
    basis: "Amazon settlement report lines read from the file on this computer, grouped by SKU; totals in exact cents.",
    settlement_id: header.settlement_id,
    currency: header.currency,
    range: { start, end },
    skus: skus.map((s: any) => ({
      sku: s.sku, units: s.units, orders: s.orders, sales: money(s.sales), net: money(s.net),
      net_per_unit: money(s.net_per_unit), buckets: fmtBuckets(s.buckets),
      ...(withLines ? { lines: s.lines.map(fmtLine) } : {}),
    })),
    unattributed: {
      note: "Lines Amazon booked without a SKU (storage, subscription, most reimbursements). Not spread across products.",
      net: money(r.unattributed.net), lines: r.unattributed.line_count, buckets: fmtBuckets(r.unattributed.buckets),
      ...(withLines ? { line_detail: r.unattributed.lines.map(fmtLine) } : {}),
    },
    net: money(r.net),
  }
  const summary = `${skus.length} SKU${skus.length === 1 ? "" : "s"}${only ? "" : `, net ${data.net} ${header.currency || ""} including ${data.unattributed.net} not tied to a SKU`}.`
  return ok(summary, data)
}

function listReports(args: Args): CallToolResult {
  const dir = expand(args.directory)
  if (!statSync(dir).isDirectory()) throw new UserError(`${dir} is not a folder`)
  const found: any[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    let st
    try { st = statSync(full) } catch { continue }
    if (!st.isFile() || st.size > MAX_BYTES || !REPORT_EXTS.has(extname(name).toLowerCase())) continue
    try {
      const head = readFileSync(full, "utf8").slice(0, 4096)
      if (!head.includes("settlement-id")) continue
      const { header, items } = pnl.parseSettlement(readReport(full))
      found.push({
        path: full, settlement_id: header.settlement_id, period_start: header.period_start, period_end: header.period_end,
        deposit_date: header.deposit_date, currency: header.currency, total_deposit: money(header.total_deposit), lines: items.length,
      })
    } catch { /* not a readable settlement report */ }
  }
  found.sort((a, b) => String(b.period_end || "").localeCompare(String(a.period_end || "")))
  return ok(`${found.length} settlement report${found.length === 1 ? "" : "s"} in ${dir}.`, { directory: dir, reports: found })
}

export function callLocalTool(name: string, args: Args = {}): CallToolResult {
  try {
    if (name === "read_settlement_report") return readSettlement(args)
    if (name === "settlement_profit_by_sku") return bySku(args)
    if (name === "list_settlement_reports") return listReports(args)
    throw new UserError(`unknown local tool ${name}`)
  } catch (err) {
    const msg = err instanceof UserError ? err.message
      : (err as NodeJS.ErrnoException)?.code === "ENOENT" ? `File or folder not found: ${(err as NodeJS.ErrnoException).path}`
      : `Could not read the report: ${(err as Error).message}`
    return { content: [{ type: "text", text: msg }], isError: true }
  }
}
