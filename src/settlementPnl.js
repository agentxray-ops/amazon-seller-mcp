// Settlement parsing and P&L, computed locally: the report never leaves the
// seller's machine. This is the same parser AgentXray ships in its browser
// settlement reader (https://agentxray.ai/tools/settlement-profit-reader),
// checked against a reference implementation through the fixtures in
// test/fixtures/settlement (expected.json).
//
// ── Money is never a float ────────────────────────────────────────────────
// JavaScript has no Decimal. 0.1 + 0.2 is 0.30000000000000004, and a
// settlement has to reconcile to a bank deposit to the cent. So every amount
// is parsed straight into an INTEGER NUMBER OF CENTS and every sum is integer
// addition. Nothing here ever holds a fractional currency value.
//
// Cents stay inside Number safely: 2^53 cents is ~90 trillion currency units.
//
// ── Rounding matches Python ───────────────────────────────────────────────
// `Decimal.quantize` rounds half to EVEN by default, and JS `Math.round`
// rounds half up. On a per-unit average that difference shows up in the last
// cent, which is exactly the kind of divergence the shared fixtures exist to
// catch, so `roundHalfEven` is used wherever the reference quantizes.

export class SettlementParseError extends Error {}

const CONVENTION_POINT = 'point'
const CONVENTION_COMMA = 'comma'

// A number ending in a decimal point followed by 1-2 digits, versus the same
// with a comma. "1,234" is ambiguous and matches neither on purpose.
const POINT_DECIMAL_RE = /\.\d{1,2}$/
const COMMA_DECIMAL_RE = /,\d{1,2}$/

const HEADER_ALIASES = {
  'settlement-id': 'settlement_id',
  'settlement-start-date': 'settlement_start_date',
  'settlement-end-date': 'settlement_end_date',
  'deposit-date': 'deposit_date',
  'total-amount': 'total_amount',
  currency: 'currency',
  'transaction-type': 'transaction_type',
  'order-id': 'order_id',
  'amount-type': 'amount_type',
  'amount-description': 'amount_description',
  amount: 'amount',
  'posted-date': 'posted_date',
  'posted-date-time': 'posted_date',
  sku: 'sku',
  'quantity-purchased': 'quantity',
  'marketplace-name': 'marketplace_name',
}

export const SALES = 'sales'
export const REFUNDS = 'refunds'
export const PROMOTIONS = 'promotions'
export const REFERRAL = 'referral_fees'
export const FULFILMENT = 'fulfilment_fees'
export const OTHER_SELLING_FEES = 'other_selling_fees'
export const STORAGE = 'storage_fees'
export const SUBSCRIPTION = 'subscription'
export const REIMBURSEMENTS = 'reimbursements'
export const OTHER = 'other'

export const BUCKET_ORDER = [
  SALES, REFUNDS, PROMOTIONS, REFERRAL, FULFILMENT,
  OTHER_SELLING_FEES, STORAGE, SUBSCRIPTION, REIMBURSEMENTS, OTHER,
]

const EXACT = new Map([
  ['ItemPrice\u0000Principal', SALES],
  ['ItemPrice\u0000Shipping', SALES],
  ['ItemPrice\u0000GiftWrap', SALES],
  ['ItemPrice\u0000Tax', SALES],
  ['ItemPrice\u0000ShippingTax', SALES],
  ['ItemPrice\u0000GiftWrapTax', SALES],
  ['ItemFees\u0000Commission', REFERRAL],
  ['ItemFees\u0000RefundCommission', REFERRAL],
  ['ItemFees\u0000FBAPerUnitFulfillmentFee', FULFILMENT],
  ['ItemFees\u0000FBAPerOrderFulfillmentFee', FULFILMENT],
  ['ItemFees\u0000FBAWeightBasedFee', FULFILMENT],
  ['ItemFees\u0000ShippingChargeback', FULFILMENT],
  ['ItemFees\u0000GiftwrapChargeback', OTHER_SELLING_FEES],
])

const ANY_DESCRIPTION = new Map([['ItemWithheldTax', OTHER]])

const BY_TYPE = new Map([
  ['Promotion', PROMOTIONS],
  ['FBA Inventory Reimbursement', REIMBURSEMENTS],
  ['FBA Inventory Storage Fee', STORAGE],
])

const REFUND_TRANSACTIONS = new Set(['refund', 'chargeback refund', 'guarantee claim'])

/** Round half to EVEN, matching Python's `Decimal.quantize` default. */
export function roundHalfEven(value) {
  const floor = Math.floor(value)
  const diff = value - floor
  if (diff > 0.5) return floor + 1
  if (diff < 0.5) return floor
  return floor % 2 === 0 ? floor : floor + 1
}

/** Decide the decimal convention once per FILE, from evidence across it. */
export function detectConvention(values) {
  let point = false
  let comma = false
  for (const raw of values) {
    const t = (raw || '').trim()
    if (!t) continue
    if (POINT_DECIMAL_RE.test(t)) point = true
    if (COMMA_DECIMAL_RE.test(t)) comma = true
  }
  if (point && comma) {
    throw new SettlementParseError(
      "settlement mixes decimal conventions: found both '.dd' and ',dd' "
      + 'endings in the same file — refusing to guess which is the decimal point',
    )
  }
  return comma ? CONVENTION_COMMA : CONVENTION_POINT
}

/** Parse a localised money string straight into integer cents. */
export function parseCents(raw, convention) {
  let s = (raw || '').trim()
  if (!s) return 0
  if (convention === CONVENTION_COMMA) {
    s = s.replace(/\./g, '').replace(',', '.')
  } else {
    s = s.replace(/,/g, '')
  }
  const negative = s.startsWith('-')
  if (negative || s.startsWith('+')) s = s.slice(1)
  const [whole, frac = ''] = s.split('.')
  if (!/^\d*$/.test(whole) || !/^\d*$/.test(frac)) {
    throw new SettlementParseError(`unreadable amount: ${raw}`)
  }
  const cents = Number(whole || '0') * 100 + Number(frac.padEnd(2, '0').slice(0, 2) || '0')
  return negative ? -cents : cents
}

/** Cents back to the string form the Python reference emits. */
export function centsToString(cents) {
  if (cents === null || cents === undefined) return null
  const negative = cents < 0
  const abs = Math.abs(cents)
  const whole = Math.floor(abs / 100)
  const frac = String(abs % 100).padStart(2, '0')
  return `${negative ? '-' : ''}${whole}.${frac}`
}

/** `YYYY-MM-DD` from the formats the settlement flat file uses. */
export function parseDate(raw) {
  const s = (raw || '').trim()
  if (!s) return null
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})/)
  if (m) return `${m[3]}-${m[2]}-${m[1]}`
  return null
}

export function classify(item) {
  const aType = (item.amount_type || '').trim()
  const aDesc = (item.amount_description || '').trim()
  const txn = (item.transaction_type || '').trim().toLowerCase()

  if (REFUND_TRANSACTIONS.has(txn) && aType === 'ItemPrice') return REFUNDS

  const exact = EXACT.get(`${aType}\u0000${aDesc}`)
  if (exact) return exact
  if (ANY_DESCRIPTION.has(aType)) return ANY_DESCRIPTION.get(aType)

  const byType = BY_TYPE.get(aType)
  if (byType) return byType

  const lowered = aDesc.toLowerCase()
  if (lowered.includes('subscription')) return SUBSCRIPTION
  if (lowered.includes('storage')) return STORAGE
  if (aType === 'ItemFees') return OTHER_SELLING_FEES
  return OTHER
}

/**
 * Parse a settlement flat file into a header and line items.
 *
 * Malformed rows are skipped rather than fatal, matching the reference: a
 * settlement is worth reading even when Amazon writes one odd line into it.
 */
export function parseSettlement(text) {
  const lines = String(text).split(/\r?\n/).filter((l) => l.trim() !== '')
  if (lines.length < 2) throw new SettlementParseError('settlement has no rows')

  const columns = lines[0].split('\t').map((c) => HEADER_ALIASES[c.trim()] || c.trim())
  if (!columns.includes('amount')) {
    throw new SettlementParseError('settlement has no recognisable header row')
  }

  const rows = lines.slice(1).map((line) => {
    const cells = line.split('\t')
    const row = {}
    columns.forEach((name, i) => { row[name] = (cells[i] ?? '').trim() })
    return row
  })

  const convention = detectConvention(rows.map((r) => r.amount).concat(
    rows.map((r) => r.total_amount),
  ))

  let header = null
  const items = []
  for (const row of rows) {
    const isHeaderRow = !!row.settlement_start_date && !row.amount_type
    if (isHeaderRow && !header) {
      header = {
        settlement_id: row.settlement_id || '',
        period_start: parseDate(row.settlement_start_date),
        period_end: parseDate(row.settlement_end_date),
        deposit_date: parseDate(row.deposit_date),
        total_deposit: parseCents(row.total_amount, convention),
        currency: row.currency || '',
        marketplace_name: row.marketplace_name || '',
      }
      continue
    }
    if (!row.amount_type && !row.amount_description) continue
    items.push({
      transaction_type: row.transaction_type || '',
      posted_date: parseDate(row.posted_date),
      order_id: row.order_id || null,
      sku: row.sku || null,
      quantity: row.quantity ? Number(row.quantity) : null,
      amount_type: row.amount_type || '',
      amount_description: row.amount_description || '',
      amount: parseCents(row.amount, convention),
      currency: row.currency || '',
    })
  }
  if (!header) throw new SettlementParseError('settlement has no header row')
  return { header, items }
}

export function summarise(header, items, asOf) {
  const dates = items.map((i) => i.posted_date).filter(Boolean).sort()
  const dataEnd = dates.length ? dates[dates.length - 1] : null
  const lineSum = items.reduce((acc, i) => acc + i.amount, 0)

  let ageDays = null
  if (dataEnd && asOf) {
    ageDays = Math.round((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${dataEnd}T00:00:00Z`)) / 86400000)
  }

  const currencies = new Set(
    [header.currency, ...items.map((i) => i.currency)].filter(Boolean),
  )
  return {
    currency: currencies.size === 1 ? [...currencies][0] : (currencies.size ? 'MIXED' : ''),
    marketplaces: header.marketplace_name ? [header.marketplace_name] : [],
    period_start: header.period_start,
    period_end: header.period_end,
    data_start: dates.length ? dates[0] : null,
    data_end: dataEnd,
    line_count: items.length,
    age_days: ageDays,
    total_deposit: header.total_deposit,
    header_delta: lineSum - header.total_deposit,
  }
}

function inRange(item, start, end) {
  if (!start && !end) return true
  if (!item.posted_date) return false
  if (start && item.posted_date < start) return false
  if (end && item.posted_date > end) return false
  return true
}

/**
 * Total a settlement's lines into buckets over an inclusive date range.
 *
 * `start` / `end` are `YYYY-MM-DD` strings compared against each line's POSTED
 * date — the day Amazon moved the money, not the purchase date. All amounts in
 * and out are integer cents.
 */
export function analyse(items, { start = null, end = null, cogsPerUnitCents = null } = {}) {
  const selected = items.filter((i) => inRange(i, start, end))

  const grouped = new Map()
  for (const item of selected) {
    const bucket = classify(item)
    if (!grouped.has(bucket)) grouped.set(bucket, [])
    grouped.get(bucket).push(item)
  }

  const buckets = []
  for (const name of BUCKET_ORDER) {
    const rows = grouped.get(name)
    if (!rows) continue
    grouped.delete(name)
    const detail = new Map()
    for (const row of rows) {
      const key = `${(row.amount_type || '').trim()}\u0000${(row.amount_description || '').trim()}`
      detail.set(key, (detail.get(key) || 0) + row.amount)
    }
    buckets.push({
      bucket: name,
      amount: rows.reduce((a, r) => a + r.amount, 0),
      line_count: rows.length,
      breakdown: [...detail.entries()]
        .map(([key, amount]) => {
          const [amount_type, amount_description] = key.split('\u0000')
          return { amount_type, amount_description, amount }
        })
        .sort((a, b) => a.amount - b.amount),
    })
  }
  // Anything classify() produced outside BUCKET_ORDER still has to appear, or
  // the buckets stop summing to the net.
  for (const [name, rows] of grouped) {
    buckets.push({
      bucket: name,
      amount: rows.reduce((a, r) => a + r.amount, 0),
      line_count: rows.length,
      breakdown: [],
    })
  }

  const net = buckets.reduce((a, b) => a + b.amount, 0)

  const principal = selected.filter(
    (i) => (i.amount_type || '').trim() === 'ItemPrice'
      && (i.amount_description || '').trim() === 'Principal'
      && i.amount > 0,
  )
  const units = principal.reduce((a, i) => a + (i.quantity || 0), 0)
  const orders = new Set(principal.map((i) => i.order_id).filter(Boolean)).size
  const grossSales = principal.reduce((a, i) => a + i.amount, 0)

  const sumWhere = (type, desc) => selected
    .filter((i) => (i.amount_type || '').trim() === type
      && (i.amount_description || '').trim() === desc)
    .reduce((a, i) => a + i.amount, 0)

  const fulfilment = sumWhere('ItemFees', 'FBAPerUnitFulfillmentFee')
  const commission = sumWhere('ItemFees', 'Commission')

  const pricePerUnit = units ? roundHalfEven(grossSales / units) : null
  const fulfilmentPerUnit = units ? roundHalfEven(-fulfilment / units) : null
  // Percent is carried in hundredths, the same shape as cents, so the two
  // implementations round the same quantity the same way.
  const referralPct = grossSales > 0
    ? roundHalfEven((-commission / grossSales) * 100 * 100)
    : null

  const cogsTotal = (cogsPerUnitCents !== null && units)
    ? cogsPerUnitCents * units
    : null
  const profit = cogsTotal !== null ? net - cogsTotal : null

  return {
    range_start: start,
    range_end: end,
    buckets,
    net,
    units,
    orders,
    price_per_unit: pricePerUnit,
    fulfilment_per_unit: fulfilmentPerUnit,
    referral_pct: referralPct,
    cogs_per_unit: cogsPerUnitCents,
    cogs_total: cogsTotal,
    profit,
    lines_total: selected.length,
    lines_without_date: selected.filter((i) => !i.posted_date).length,
  }
}

/**
 * SETTLEMENT-SKU-1 (2026-10-17) — the same lines, grouped by SKU.
 *
 * Asked for by a seller who audits settlements by hand: before she trusts a
 * number she checks ONE SKU over ONE closed period and follows the arithmetic.
 * So every SKU carries its own lines, not just its totals — a total that only
 * the tool can see the inside of is not something she can check.
 *
 * Lines Amazon booked without a SKU (storage, subscription, most
 * reimbursements, adjustments) belong to no single product. They are kept as
 * their own group rather than spread across SKUs by a guess, and the SKU nets
 * plus that group equal `analyse(...).net` exactly — pinned by a test.
 *
 * JS-only: the Python reference has no per-SKU view, so this is checked
 * against `analyse` on the shared fixtures rather than against expected.json.
 */
export function bySku(items, { start = null, end = null } = {}) {
  const selected = items.filter((i) => inRange(i, start, end))
  const groups = new Map()
  const loose = []
  for (const item of selected) {
    const sku = (item.sku || '').trim()
    if (!sku) { loose.push(item); continue }
    if (!groups.has(sku)) groups.set(sku, [])
    groups.get(sku).push(item)
  }

  const totals = (rows) => {
    const buckets = {}
    for (const r of rows) {
      const b = classify(r)
      buckets[b] = (buckets[b] || 0) + r.amount
    }
    return { buckets, net: rows.reduce((a, r) => a + r.amount, 0) }
  }

  const skus = [...groups.entries()].map(([sku, rows]) => {
    const principal = rows.filter(
      (i) => (i.amount_type || '').trim() === 'ItemPrice'
        && (i.amount_description || '').trim() === 'Principal'
        && i.amount > 0,
    )
    const units = principal.reduce((a, i) => a + (i.quantity || 0), 0)
    const { buckets, net } = totals(rows)
    const lines = [...rows].sort((a, b) => String(a.posted_date || '').localeCompare(String(b.posted_date || ''))
      || String(a.order_id || '').localeCompare(String(b.order_id || '')))
    return {
      sku,
      units,
      orders: new Set(principal.map((i) => i.order_id).filter(Boolean)).size,
      sales: buckets[SALES] || 0,
      buckets,
      net,
      net_per_unit: units ? roundHalfEven(net / units) : null,
      lines,
    }
  }).sort((a, b) => b.sales - a.sales || a.sku.localeCompare(b.sku))

  const unattributed = { ...totals(loose), line_count: loose.length, lines: loose }
  return {
    skus,
    unattributed,
    net: skus.reduce((a, s) => a + s.net, 0) + unattributed.net,
  }
}
