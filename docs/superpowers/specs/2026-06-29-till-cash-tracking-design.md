# Till / Cash Tracking System — Design

**Date:** 2026-06-29
**Repo:** wcs-staff-portal
**Status:** Approved for planning (alerts piece dropped per Justin)

## Problem

WCS runs cash drawers at the front desk of 7 gyms. Today there is no system to
verify that the cash in the drawer matches what should be there. Justin wants a
till / cash tracking system that serves three goals at once:

1. **Theft / shrinkage detection** — surface when a drawer comes up short and tie
   it to a person and a day.
2. **Close-out discipline** — make sure every club actually counts the drawer and
   logs it, on time (a compliance layer like the existing Operandio audits).
3. **Reconciliation** — match counted cash to expected cash (from POS sales) and
   to bag drops, so the books balance.

## Key data findings (verified against production)

- **ABC POS transactions already sync** into `inventory_transactions`
  (+ `inventory_transaction_items`), ~21k rows. Sync code:
  `auth/src/services/abcInventory.js` (`fetchPosTransactions`) and
  `auth/src/services/inventorySync.js`.
- **Tender type IS available** but currently dropped by the sync mapper. It lives
  nested at the **line-item** level: `items.item[].payments[]`, each with
  `paymentType`, `paymentAmount`, `paymentTax`, `location`. The full transaction
  is retained in `inventory_transactions.raw` (jsonb), so **history is
  recoverable without re-fetching from ABC**.
- Observed `paymentType` values normalize into buckets:
  - **cash** — `"Cash"`
  - **card** — `"Visa"`, `"Master Card"`, `"American Express"`, and masked forms
    like `"Visa(xxxx6263)"`
  - **check** — `"Check"`
  - **account** — `"Club Account"` (internal ledger, not real money in a drawer)
  - **writeoff** — `"Write Off"`
- **Physical register vs back-office is cleanly separable.** Automated recurring
  billing comes through as `stationName = "ABC Transaction"` with **no
  `employeeId`**. A real person ringing a real drawer has an `employeeId` and a
  different station name. `stationName` is NOT a reliable club identifier or
  register pattern across clubs — but we never need it for club identity because
  the POS endpoint is queried per club. **Physical-register filter:**
  `employee_id IS NOT NULL AND station_name <> 'ABC Transaction'` (to be
  validated against data during build).
- Cash volume is modest (~$16k cash retail sales over the sampled window across
  clubs), which is expected for gyms. Theft detection on small amounts is still
  valuable.

## Operational model (confirmed with Justin)

- **Count capture:** staff count the drawer as **Operandio jobs**, ingested via
  the existing SendGrid inbound-parse pipeline (`POST /operandio/webhook`), the
  same path as audits.
- **Cadence:** daily, **one drawer per club**. An **open** count (AM, the float)
  and a **close** count (PM). One reconciliation per club per day.
- **Standard float:** **$100** (configurable per club). At close, staff
  **bag-drop everything above the float**; the drawer resets to $100 for the next
  morning.
- **Cash movements between open and close:**
  - **Refunds** — auto-detected from POS (`return=true`, cash tender).
  - **Drops / payouts** — preferred mechanism is a dedicated **ABC POS item**
    (e.g. "Cash Drop / Bag Drop") that staff ring; it flows through the existing
    sync auto-attributed and timestamped. Manual entry in the Operandio job is a
    fallback. Justin confirmed he is OK creating the POS item(s) by hand in ABC.

### Reconciliation formula (per club, per business day, Pacific)

```
opening_float   = AM count                              [Operandio]   (flag if != $100 par)
cash_sales      = Σ cash payments, sale=true,  physical register      [POS, auto]
cash_refunds    = Σ cash payments, return=true, physical register     [POS, auto]
cash_drops      = Σ "Cash Drop" item OR Operandio-entered             [POS or manual]
expected_close  = opening_float + cash_sales − cash_refunds − cash_drops
counted_close   = PM count                              [Operandio]
over_short      = counted_close − expected_close
bag_drop        = counted_close − $100 par
```

Computed **on read** from the underlying tables (same pattern as the existing
Shrinkage report), so it stays fresh as POS syncs.

## Architecture / components

### Phase 1 — Tender capture (foundation, keystone)

The sync currently discards `payments`. Fix first; nothing downstream works
without it.

- **Migration:** new table `inventory_transaction_payments`
  `(id, transaction_pk → inventory_transactions, club_number, line_no,
   payment_type, payment_amount, payment_tax, tender_category)`.
  `tender_category` is the normalized bucket (cash/card/check/account/writeoff/
  other) derived from `payment_type` (strip masked-card suffix before matching).
  RLS enabled (service-role only, per repo convention).
- **Sync mapper:** extend `fetchPosTransactions` to carry `payments` per line,
  and `inventorySync.js` to upsert payment rows alongside transaction items.
- **Backfill script** (`auth/scripts/backfill-transaction-payments.js`): reads
  `inventory_transactions.raw` for all existing rows, flattens
  `items.item[].payments[]`, writes payment rows. Idempotent; `--dry-run` first.
- **Bonus:** unlocks a tender-mix breakdown in the existing POS Sales report for
  free (not required for this project, noted as a follow-on).

### Phase 2 — Reconciliation engine

- **`till_settings` table** `(club_number PK, standard_float numeric default 100,
  drop_profit_center text, active boolean)`. Seed all 7 clubs at $100.
- **Physical-register classification** + cash extraction helper (server-side),
  reading `inventory_transaction_payments` joined to transactions/items.
- **Cash Drop POS item:** Justin creates it in ABC by hand. **Verification step:**
  Justin rings one test bag-drop at a register; we inspect the exact JSON payload
  to confirm sign/tender (note a `"Write Off"` non-sale tender already exists in
  data, so ABC supports non-sale tenders). Finalize the classification rule
  (match by item name / profit center; treat its cash amount as a drawer
  reduction, not a sale).
- **Endpoint** `GET /till/reconciliation?location=&from=&to=` (manager+), returns
  the per-club-per-day reconciliation rows using the formula above. Computed on
  read. Pacific day boundaries (reuse existing date helpers).

### Phase 3 — Operandio drawer-count capture

- **Two Operandio jobs** per club per day: "Drawer Open Count" (→ `open`) and
  "Drawer Close Count" (→ `close`). Created in Operandio by Justin.
- **`till_counts` table** `(id, club_number, business_date, count_type
  (open|close), counted_amount numeric, denominations jsonb null, employee_name,
  counted_at, operandio_instance_id, source default 'operandio')`,
  unique `(club_number, business_date, count_type)`. RLS enabled.
- **Parser:** extend the existing classifier in `auth/src/lib/operandioJobs.js`
  to recognize the two drawer-count `templateId`s (stable per job type) and write
  `till_counts`. Reuses the proven submission-HTML task-row parsing. Wired into
  the existing `/operandio/webhook` branch.
- **Denomination breakdown:** schema supports it (jsonb, nullable), but v1 keeps
  the Operandio job simple — a single cash total is sufficient; denominations are
  optional and stored if present.
- **Compliance for free:** "did the club submit its close count, on time?" is
  answered by the same late/overdue derivation already built for audits
  (submitted vs overdue by instanceId).

### Phase 4 — Till report UI (Reporting, manager+)

Follows the existing Reporting pattern (location pills incl. All, date-range
presets, one-block `StatBlock`/`ReportBlock` style). New report key `till`,
registered in `ReportingView.jsx`, gated manager+.

- **Daily table:** date · opening float (red if ≠ par) · cash sales · refunds ·
  drops · expected · counted · **over/short** (green/red pill) · bag drop ·
  count status (✓ / missing / late).
- **By Employee tab:** cumulative over/short per person over the range — the
  theft-detection lens.
- **Compliance tab:** per-club grid of which counts were submitted and on time —
  close-out discipline.
- **Day drill-down:** full reconciliation math for one club-day plus the
  underlying cash transactions.

## Out of scope (v1)

- **Alerts** (SMS/email on shorts or missing counts) — explicitly dropped by
  Justin.
- Per-shift or multi-register reconciliation — model is one drawer per club, daily.
- Check/card drawer handling — only **cash** affects the drawer in this model.
- Linking Operandio submitter names to portal staff records (possible later).

## Build order

Each phase is independently shippable as its own PR off current master (per the
"one PR per concern" + "fast-merge → new PR" conventions). Verify each sha lands
in `origin/master` before assuming it shipped.

1. Tender capture (table + sync mapper + backfill).
2. Reconciliation engine (`till_settings`, classifier, Cash Drop item + test-ring
   verification, `/till/reconciliation`).
3. Operandio drawer-count jobs (`till_counts`, parser extension).
4. Till report UI.

## Open items to resolve during implementation

- Validate `employee_id IS NOT NULL AND station_name <> 'ABC Transaction'` cleanly
  separates physical-register sales from auto-billing across all 7 clubs.
- Confirm the Cash Drop payload shape via Justin's test ring before finalizing the
  drop classification rule.
- Confirm the drawer-count Operandio `templateId`s once the jobs are created.
