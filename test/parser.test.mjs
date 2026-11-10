// The parser must agree, to the cent, with the reference results in
// test/fixtures/settlement/expected.json — every fixture, every date range,
// with and without a unit cost. The fixtures are synthetic.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { analyse, bySku, centsToString, parseCents, parseSettlement, summarise } from "../dist/settlementPnl.js"

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/settlement")
const expected = JSON.parse(readFileSync(path.join(FIX, "expected.json"), "utf8"))
const COGS = parseCents(expected.cogs_per_unit, "point")
const money = (c) => (c === null ? null : centsToString(c))
const load = (name) => parseSettlement(readFileSync(path.join(FIX, `${name}.tsv`), "utf8"))

for (const name of Object.keys(expected.cases)) {
  test(`${name}: file summary matches the reference`, () => {
    const { header, items } = load(name)
    const s = summarise(header, items, "2026-08-23")
    const want = expected.cases[name].file
    assert.equal(s.currency, want.currency)
    assert.equal(s.data_start, want.data_start)
    assert.equal(s.data_end, want.data_end)
    assert.equal(s.line_count, want.line_count)
    assert.equal(s.age_days, want.age_days)
    assert.equal(money(s.total_deposit), want.total_deposit)
    assert.equal(money(s.header_delta), want.header_delta)
  })

  test(`${name}: every range, with and without cost, matches the reference`, () => {
    const { items } = load(name)
    for (const [label, spec] of Object.entries(expected.cases[name].ranges)) {
      for (const [key, cogs] of [["without_cogs", null], ["with_cogs", COGS]]) {
        const got = analyse(items, { start: spec.start, end: spec.end, cogsPerUnitCents: cogs })
        const want = spec[key]
        const at = `${name}/${label}/${key}`
        assert.equal(money(got.net), want.net, `${at} net`)
        assert.equal(got.units, want.units, `${at} units`)
        assert.equal(got.orders, want.orders, `${at} orders`)
        assert.equal(money(got.price_per_unit), want.price_per_unit, `${at} price`)
        assert.equal(money(got.fulfilment_per_unit), want.fulfilment_per_unit, `${at} fba`)
        assert.equal(money(got.referral_pct), want.referral_pct, `${at} referral`)
        assert.equal(money(got.profit), want.profit, `${at} profit`)
        assert.deepEqual(Object.fromEntries(got.buckets.map((b) => [b.bucket, money(b.amount)])), want.buckets, `${at} buckets`)
      }
    }
  })

  test(`${name}: SKU nets plus unattributed equal the report net`, () => {
    const { items } = load(name)
    assert.equal(bySku(items).net, analyse(items).net)
  })
}

test("money is integer cents, never a float", () => {
  assert.equal(parseCents("0.10", "point") + parseCents("0.20", "point"), 30)
  assert.equal(parseCents("1.234,56", "comma"), 123456)
})
