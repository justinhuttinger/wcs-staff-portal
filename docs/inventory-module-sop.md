# Inventory Module — Standard Operating Procedure (SOP)

**For:** New West Coast Strength staff (Leads, Managers, Directors, Admins)
**Covers:** The Inventory tool in the WCS Staff Portal — both the **desktop** (web/kiosk) version and the **mobile** (phone) version.
**Last updated:** June 2026

---

## Part 1 — What the Inventory Module Is

The Inventory module tracks the **retail products we sell at the front desk** — drinks, snacks, supplements, merchandise, and tanning products — across all 7 WCS clubs (Salem, Keizer, Eugene, Springfield, Clackamas, Milwaukie, Medford).

It answers four everyday questions:

1. **What do we have on hand right now?** (the **Inventory** tab)
2. **What do we need to reorder?** (the **To Order** tab)
3. **What did we just receive, and who restocked it?** (the **Restock** tab)
4. **Are we making money on every item, and is our data clean?** (the **Audit** tab — admin only)

### Where the numbers come from

The portal is **not** the cash register. Our point-of-sale system is **ABC** (ABC Fitness / DataTrak). The portal mirrors ABC and adds the pieces ABC doesn't track well:

| Data | Owner | How it gets into the portal |
|------|-------|------------------------------|
| Product catalog (names, categories, **sale price**, UPC) | **ABC** | Synced automatically from ABC every night (~3:30 AM PST) |
| **Sales** (units sold, returns) | **ABC POS** | Synced automatically every 30 minutes; each sale lowers on-hand |
| **On-hand quantity** | **Portal** | Set by staff: counts, restocks, and received invoices |
| **Cost** (what we pay the vendor) | **Portal** | Set by receiving invoices, or typed in by an admin |
| **Margin / profit** | Calculated | Price (from ABC) − Cost (from portal) |

> **Key idea:** ABC tells the portal the **price** and the **sales**. Staff tell the portal the **count** and the **cost**. The portal does the **margin math**.

When you add or count stock in the portal, it also **pushes that change back to ABC** automatically so the two systems stay in agreement. You don't have to do anything for that to happen — it's automatic and runs in the background.

### The golden rule: we only ADD stock here

**Removals are never done in the portal.** Sales, write-offs, spoilage, and theft all flow out of ABC. In the portal you can only:

- **Add stock** (a restock / received shipment), or
- **Set an exact count** (a physical recount).

If you ever need to take something *out*, that happens in ABC POS, not here. The portal enforces this — it will reject a negative restock amount.

---

## Part 2 — Who Can Use It (Access & Roles)

The Inventory tile appears for **Leads and above**. What you can see depends on your role:

| Role | Inventory & To Order | Restock & invoices | Margin / cost figures | Audit tab | Edit cost |
|------|:---:|:---:|:---:|:---:|:---:|
| Front Desk / Trainer / Team Member | — | — | — | — | — |
| **Lead** | ✅ | ✅ | — (no margin) | — | — |
| **Manager / Director** | ✅ | ✅ | ✅ | — | — |
| **Admin** | ✅ | ✅ | ✅ | ✅ | ✅ |

- **Leads** can scan, count, restock, and snap invoices — but they do **not** see profit margins.
- **Managers/Directors** additionally see cost and margin.
- **Admins** get the full picture: the **Audit** tab, the ability to **edit an item's cost**, and **bulk cost import/export**.

Your club access also matters: you can only restock into the club(s) on your staff profile. **Admins** can work across **all clubs**.

---

## Part 3 — The Desktop Version

Open the portal on the kiosk or in a browser and tap the **Inventory** tile. You'll land on a screen with four tabs across the top (the fourth, **Audit**, only shows for admins).

At the top of every tab there's a **Club** dropdown. Leave it on **All Clubs** to see everything, or pick one club to narrow down. Admins see all 7 clubs; everyone else sees the clubs they're assigned to.

### Tab 1 — Inventory (the master list)

This is the catalog of every sellable item with its **on-hand count**.

- **Search** by name or UPC.
- **Filter by category** using the colored chips (Drinks, Snacks, Supplements, etc.).
- **All Clubs view** consolidates the same product (matched by UPC) into **one row** and sums on-hand across clubs. Pick a single club to see each club's items separately.
- **Sort** by On Hand by clicking the column header (click cycles high→low, low→high, off).

**Oversold flag:** If an item's on-hand is **negative**, it shows a red **"Oversold"** badge. This means ABC rang up more sales than the portal thought we had in stock — a sign of a missed receiving, a bad count, or shrinkage. A red **"X oversold — show"** button appears at the top to filter to just those items. **Oversold items should be recounted.**

**Actions per row (single-club view only):**
- **Adjust** — opens the stock adjustment box (see below).
- **History** — shows every movement for that item (sales, returns, restocks, counts) with who did it and when.

#### The Adjust box (desktop)

Two modes:
- **Add stock** — type a positive amount to *add* to on-hand (e.g. you got a delivery of 12).
- **Set exact count** — type the *actual* counted number; the portal figures out the difference.

You can add an optional note. Remember: removals aren't done here.

### Tab 2 — To Order (the reorder list)

A ready-made shopping list. An item lands here when its on-hand drops **below the reorder point for its category**:

| Category | Reorder when on-hand is below |
|----------|:---:|
| Drinks | 12 |
| Snacks | 12 |
| Supplements | 4 |
| Merchandise, Tanning | *not auto-tracked* |

Items at **0 or oversold** only appear if they actually **sold in the last 30 days** — so discontinued/dead stock doesn't clutter the list forever. The list is sorted **most urgent first** (lowest/negative on-hand at the top). Columns show On Hand, units **Sold (30d)**, and the **Reorder Below** threshold.

### Tab 3 — Restock (the activity feed + invoices)

A single date-ordered feed of everything that added stock: **invoice uploads** and **manual adjustments**, newest first, with **who** did each one.

The headline action here is **"+ New / Snap Invoice."** This is how you turn a paper/PDF vendor invoice into stock:

**Receiving an invoice on desktop:**
1. Click **+ New / Snap Invoice**.
2. Pick the **Vendor** (SportLife, Coke, or Other) and the **Location**.
3. Attach the invoice — a PDF or photos of **every page**.
4. Click **Create Invoice**. The portal **reads the invoice automatically** (OCR) and pulls out the vendor, line items, quantities, and costs.
5. You land on the **invoice detail** screen, where each line tries to **auto-match** to a catalog item. A colored badge shows the match confidence (green = strong, amber = unsure, gray = weak).
6. **Fix any unmatched lines:**
   - Type or **scan a UPC** with a hardware barcode scanner (it types the digits + Enter), **or**
   - Use the **search box** to find the catalog item by name/UPC.
7. You can **add a page**, **Re-read** the invoice, remove pages, or add a line manually if the OCR missed one.
8. When the linked lines look right, click **Receive into Stock**. This:
   - **adds the quantities** to on-hand,
   - **updates each item's cost** (used for margin), and
   - **pushes the new stock levels to ABC**.
9. A confirmation tells you how many lines were received and how many were skipped (unlinked lines are skipped — they stay as a record but don't move stock).

> **Pack sizes are handled for you.** If an invoice is priced by the case (e.g. a 12-pack at $18.52), the portal normalizes it down to a **per-unit** cost and count before it hits stock. You don't have to do that math.

> **It learns.** Once you link a vendor line to a catalog item, the portal **remembers** that vendor's SKU/description for next time, so future invoices from that vendor match automatically.

### Tab 4 — Audit (admins only)

A health-check on the whole catalog. Each item is scanned for problems, shown as clickable filter chips:

| Flag | Meaning | What to do |
|------|---------|------------|
| **Losing Money** | Cost ≥ sale price | Fix the price in ABC or the cost here |
| **Sold Below Price** | Actually selling under 90% of catalog price | Investigate heavy discounting at the till |
| **Oversold** | On-hand is negative | Recount; check for missed receiving / shrinkage |
| **Low Margin** | Margin under threshold (default 15%) | Review pricing or cost |
| **No Cost Data** | Sells/holds stock but no cost on file | Receive an invoice or set the cost |
| **No Price** | No catalog price from ABC | Fix in ABC |
| **No UPC** | Can't be scanned on mobile | Add a UPC |
| **No Category** | No ABC category | Add one in ABC — it fixes on the next 3 AM sync |

From here, admins can:
- **Edit Cost** on any item (price stays read-only — it comes from ABC). On the All-Clubs view, editing a consolidated item applies the cost/UPC to **every club** that carries it.
- **Export CSV** of the filtered list (e.g. all "No Cost Data" items).
- **Import Costs** — re-upload that CSV with a `new_cost` column filled in to set many costs at once.

Admins also see a **"Sync from ABC"** button (top right) to pull the latest catalog/sales on demand instead of waiting for the scheduled sync, plus a "POS synced ..." timestamp.

---

## Part 4 — The Mobile Version

The mobile version is built for **walking the floor with a phone** — scanning barcodes and snapping invoice photos. Open the portal on your phone (or the installed app) and tap **Inventory**.

At the top is a **club selector**. Then you choose **what you're here to do** — this is the "front door" and it's the biggest difference from desktop:

### The two modes

**🔄 Restock — "Received a shipment"**
Use this when product arrives. In this mode you can:
- **Snap Invoice** — photograph a vendor invoice and receive it (same flow as desktop, optimized for the camera).
- **Scan UPC** or **Search** for an item, then **Add stock**.
- Admins also get **Edit Cost** here.

**🔢 Count Inventory — "Counting all items"**
Use this when doing a physical count. Same scan/search, but the action button becomes **Set count** instead of Add stock — you type the *actual* number on the shelf and the portal reconciles the difference.

> The mode you pick just changes whether a found item gets **"Add stock"** (Restock) or **"Set count"** (Count). Pick the one that matches what you're actually doing.

### Finding an item on mobile

Three ways, from fastest to fallback:
1. **Scan UPC** — opens the camera. Point at the barcode; a red line shows the scan zone. The scanner is deliberately picky (it confirms the same code twice and rejects bad reads) so you don't get misreads. Hold steady.
2. **Type a UPC** — if the barcode won't scan, key it in manually.
3. **Search by name** — type at least 2 letters of the product name.

Each result shows as a card with the on-hand count (red if oversold), price, and — for managers+ — cost and margin. Tap the action button to **Add stock** / **Set count**, view **History**, or (admins, in Restock) **Edit Cost**.

### The adjust sheet (mobile)

A slide-up sheet. If you came in through a mode, it already knows whether you're adding or counting. Type the amount, add an optional note, and confirm. A clear **"Stock updated"** screen confirms it worked and shows the new on-hand.

### Snapping an invoice on mobile

1. In **Restock** mode, tap **Snap Invoice**.
2. Choose the vendor and (optionally) the order/invoice number.
3. Tap **Take photo / add page** — snap **each page** of the invoice. Thumbnails appear; you can remove a bad shot.
4. Tap **Read invoice**. The portal reads it and opens the **review sheet**.
5. For each line, the portal shows the parsed item and a match badge. Tap **Match item** / **Change match** to:
   - **Scan barcode** (camera) to link by UPC,
   - **Search by name or UPC**, or
   - **No match (new item)** to set a line aside (it'll be skipped on receive).
6. You can **Edit** a line's quantity or unit cost, **Add page**, or **Re-read**.
7. Tap **Receive into stock**. A **"Received"** screen confirms how many lines went in.

---

## Part 5 — Glossary & Key Concepts

- **On hand** — how many units the portal thinks are on the shelf right now.
- **Oversold** — on-hand is **negative**. ABC sold more than we had recorded. Recount it.
- **Catalog item** — a product mirrored from ABC. Has a name, category, price, and (ideally) a UPC.
- **UPC** — the barcode number. Items without a UPC **can't be scanned on mobile** — that's why "No UPC" is an audit flag.
- **Cost** — what we pay the vendor per unit. Comes from received invoices or an admin entry. ABC doesn't track this.
- **Price** — what the member pays. Comes from ABC; **read-only** in the portal.
- **Margin** — `(Price − Cost) / Price`. Shown to managers+.
- **Receive** — the act of turning a reviewed invoice into actual stock (adds quantity, sets cost, syncs ABC).
- **Match / link** — connecting an invoice line to the right catalog item so receiving updates the correct product.
- **Movement** — any change to stock: a sale, return, restock, count, or received line. The **History** view is a list of movements.
- **ABC push** — when you change stock here, the portal automatically updates ABC too. Automatic and best-effort; it retries if it fails.

---

## Part 6 — Common Tasks (Quick Reference)

| I need to… | Where | How |
|------------|-------|-----|
| See how many of something we have | Desktop Inventory tab / Mobile search or scan | Search or scan |
| Know what to reorder | Desktop **To Order** tab | Read the list (urgent at top) |
| Receive a delivery (with invoice) | **Restock** mode → Snap/New Invoice | Photo → review → Receive |
| Add stock without an invoice | Scan/search item → **Add stock** | Type the amount added |
| Do a physical count | Mobile **Count Inventory** mode | Scan each item → **Set count** |
| Fix a wrong count | Scan/search → **Set exact count** | Type the real number |
| See who restocked something | **Restock** feed or item **History** | Look at the Person column |
| Find money-losing items (admin) | **Audit** tab | Click the "Losing Money" chip |
| Set/fix an item's cost (admin) | **Audit** → **Edit Cost**, or invoice receive | Type the cost |
| Recount oversold items | Inventory tab → "oversold" filter | Recount each |

---

## Part 7 — Do's & Don'ts

**Do**
- Snap **every page** of an invoice before receiving.
- **Double-check match badges** that are amber/gray before receiving — a wrong match adds stock to the wrong product.
- **Recount oversold items** promptly.
- Use **Count mode** for physical counts and **Restock mode** for deliveries.

**Don't**
- Don't try to *remove* stock here — sales and write-offs go through **ABC**.
- Don't receive an invoice with unmatched lines and assume they went in — **unlinked lines are skipped**.
- Don't edit price here — it's read-only and owned by ABC. Fix prices and categories **in ABC**; they sync at 3 AM.
- Don't worry about case-vs-unit math — the portal normalizes pack sizes for you.

---

## Part 8 — Troubleshooting / FAQ

**The barcode won't scan.** Hold steady; the scanner confirms a code twice on purpose. Still nothing? **Type the UPC** or **search by name**.

**The item isn't in the catalog.** It may have no UPC, no category, or be new in ABC. New ABC items appear after the next nightly sync (or an admin can hit **Sync from ABC**). On an invoice, mark the line **No match (new item)** to skip it for now.

**The invoice read poorly.** Add clearer photos / all pages and tap **Re-read**. You can also add or edit lines manually.

**On-hand looks wrong / shows Oversold.** Do a physical count and **Set exact count**. Oversold usually means a delivery wasn't received in the portal, or shrinkage.

**I received an invoice but a line didn't add.** It was probably **unmatched** — only linked lines move stock. Re-open the invoice, match the line, and receive again.

**Margin/cost is blank.** No cost on file yet. Receive an invoice for it, or (admin) set the cost in the Audit tab.

**I don't see the Audit tab / Edit Cost.** Those are **admin-only**.

---
---

# Part 9 — Prompt for Claude Design (to generate a polished SOP document)

> **How to use this:** Copy everything in the block below and paste it into Claude (Design/Artifact mode). It will turn the SOP above into a branded, visual training document. Paste the full SOP copy (Parts 1–8 above) along with the prompt when asked, or attach this file.

---

```
You are a senior instructional designer and visual document designer. Create a
polished, branded **Standard Operating Procedure (SOP)** training document for new
West Coast Strength (WCS) gym staff learning the "Inventory" module of our internal
Staff Portal. I will provide the full written copy (Parts 1–8 of an existing SOP) —
use it as the authoritative source of truth for all facts, numbers, role
permissions, and steps. Do not invent features or change any numbers (reorder
points, role access, sync times, etc.).

GOAL
Produce a clean, modern, easy-to-skim training document a brand-new Lead or Manager
could read in 15 minutes and immediately use. It should work both on screen and
printed. Optimize for clarity and confidence, not density.

BRAND & STYLE
- Brand colors: Navy #1a1a2e, Red #C8102E (WCS Red), White #ffffff. Use navy for
  headers, red as the accent/CTA color, white/light-gray backgrounds.
- Tone: friendly, direct, confidence-building — written for busy front-desk staff,
  not engineers. Short sentences. Active voice.
- Clean sans-serif typography, generous whitespace, strong visual hierarchy,
  rounded cards, subtle borders. Think "modern SaaS onboarding guide."
- Include a simple WCS-style header/cover with the title "Inventory Module — Staff
  SOP," a subtitle, and a "for new staff" badge.

STRUCTURE (mirror the source copy, but make it visual)
1. Cover page + a one-screen "Inventory in 60 seconds" summary box.
2. A "How data flows" DIAGRAM (most important visual): show the relationship
   ABC POS  <->  Staff Portal, with arrows labeled:
     - ABC -> Portal: "Catalog, Price, Sales" (nightly + every 30 min)
     - Portal -> ABC: "Stock changes pushed back"
     - Staff -> Portal: "Counts, Restocks, Costs"
   Make crystal clear: ABC owns PRICE + SALES; staff own COUNT + COST; portal does
   the MARGIN math. Highlight the golden rule: "We only ADD stock in the portal —
   removals happen in ABC."
3. A roles/permissions matrix as a clean table (Lead / Manager / Director / Admin).
4. Desktop walkthrough: the 4 tabs (Inventory, To Order, Restock, Audit) — each as
   its own card with a short "what it's for," "key actions," and a callout for the
   gotcha. Include a labeled MOCKUP/wireframe of the desktop tab bar.
5. Mobile walkthrough: emphasize the two-mode "front door" (Restock vs Count) with
   a decision graphic ("Did product arrive? -> Restock. Counting the shelf? ->
   Count."). Show a phone-shaped mockup of the mode chooser and an item card.
6. A FLOWCHART for "Receiving an invoice" (snap pages -> auto-read/OCR -> review &
   match lines -> fix unmatched (scan UPC / search / no-match) -> Receive into
   stock -> stock + cost updated + pushed to ABC). This is the highest-value
   workflow — make it a prominent step diagram with numbered steps.
7. A reorder-points reference card (Drinks <12, Snacks <12, Supplements <4;
   Merchandise/Tanning not tracked).
8. An Audit-flags reference: a table/legend of each flag (Losing Money, Sold Below
   Price, Oversold, Low Margin, No Cost Data, No Price, No UPC, No Category) with a
   color dot (red = urgent, amber = warning, gray = info) and the fix.
9. A glossary card and a "Common Tasks" quick-reference table.
10. A Do's & Don'ts section as two contrasting columns (green checks / red X's),
    leading with the golden rule about not removing stock here.
11. A short troubleshooting/FAQ section styled as an accordion or Q&A cards.

VISUAL ELEMENTS I SPECIFICALLY WANT
- The "How data flows" diagram (2 systems + the staff, labeled arrows).
- The "Receiving an invoice" flowchart (numbered steps).
- The mobile "Restock vs Count" decision graphic.
- Icons for each tab/concept (box, shopping cart, truck/restock, magnifying glass,
  barcode, camera).
- Use realistic but FAKE example data in any mockups (e.g. "Celsius Arctic Berry —
  On hand: 8," "SportLife Invoice #4471 — 6 lines"). Do not use real costs.
- Status badges styled like the app: green "Received," amber "Not linked," red
  "Oversold."

DELIVERABLE
- A single, cohesive, print-friendly document (multi-section) — an artifact I can
  view, share, and export to PDF. If your format supports it, make it a clean
  HTML/print layout with the WCS colors; otherwise a richly formatted document.
- Keep all facts faithful to the source copy. Where the source says "admin only"
  or gives a number, preserve it exactly.
- End with a one-page printable "Inventory Cheat Sheet" summarizing scan→action,
  reorder points, the golden rule, and who-can-do-what.

Ask me for the source SOP copy if I haven't pasted it, then produce the document.
```

---

*End of SOP. Pair this file with the Claude Design prompt above to generate the
final polished, illustrated training document.*
