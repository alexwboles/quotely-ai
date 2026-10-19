# Quotely AI — Redesign Audit (v2 pass, 2026-10-19)

Previous pass: 2026-10-13 pilot (Jobber/Joist study) shipped "the contractor's office":
dark-slate sidebar, money-green accent, document-first quote detail, customer
directory, edit flow. This pass studies the bigger trades-CRM platforms and
closes the functional gaps that keep Quotely from feeling like shippable
estimating software, with a new distinctive visual identity.

## 1. Who was studied

- **JobNimbus** — Estimate Builder support doc (support.jobnimbus.com "How Do I
  Create a Legacy Estimate?"), sales page (jobnimbus.com/sales), 2026 estimating
  guide. Core patterns: builder with line-item sections, Products & Services
  catalog feeding line items, per-line hover actions (delete / add image), design
  templates + saved estimates, customer note vs internal note, kanban "Boards"
  with estimated totals per column, sales automation (proposal signed → job
  moves to Sold).
- **AccuLynx** — "Ultimate Guide to Roof Estimates" (acculynx.com), IronPros
  feature overview, softwarefinder.com workflow walkthrough, Leap-vs-AccuLynx
  comparison. Core patterns: estimate lives inside a *digital job file*
  (photos, notes, documents, measurements all attached to the job);
  measurement/catalog data auto-populates the estimate; adjust line items,
  labor, profit margin, waste factors; "save, then choose from several delivery
  options" to get the estimate to the customer; customer portal for approvals.
- **JobProgress** (appvizer.com, saasbrowser.com) — template-driven quotes with
  consistent line-item structure across repeat jobs; drag-and-drop estimate
  setup; integrated product catalog for accurate pricing; automated invoicing.
- **Adjacent patterns from research** — JobProof.ca (customer-approved change
  orders, one organized job history); iTrade (quote expiries with
  notifications, customer-selectable optional extras for upselling, margin
  overrides, revise-and-update instantly).

## 2. Layout / IA / visual patterns worth borrowing (concrete)

1. **JobNimbus "Boards"** — pipeline as clickable columns (Draft / Sent / Won /
   Lost) with estimated totals per column instead of a thin stat strip. Maps
   directly onto Quotely's pipeline strip; make it a real board with quote cards.
2. **AccuLynx digital job file** — the quote detail becomes a *job file*:
   the estimate document on the left, a right rail holding status actions,
   customer card, internal notes, milestones summary, and next pipeline steps.
   Everything about the job in one place (this is where SignPilot + change
   orders + milestones currently dangle in a panel below the document).
3. **JobNimbus Products & Services picker** — quotely owns a canonical 71-item
   price bank, but the builder never touches it. Add an "Add from price bank"
   modal: trade filter + search → insert at bank prices.
4. **AccuLynx delivery options** — after save, competitors offer send via
   email/text. Add a Send dialog: pre-composed subject/body (company, quote
   number, total, expiry) → opens the mail app, plus a one-click "Mark sent".
5. **JobNimbus customer note vs internal note** — one `notes` field mixes
   customer-facing copy with private margin/strategy scribbles. Split:
   "Notes for customer" (prints) + "Internal note" (never prints, rail only).
6. **iTrade customer-selectable extras** — optional line items: a per-row
   "Optional" toggle; optional lines excluded from totals, shown in a separate
   "Optional add-ons" block with a "Total with all options" figure. The classic
   upsell pattern, missing from Quotely.

## 3. Functional gaps closed in this pass (2–4)

1. **No send/delivery flow.** Competitors all close the loop with delivery
   options; Quotely could only Print/PDF. → *Send quote* dialog on the detail
   view (mailto composer + mark-sent), closing the JobNimbus/AccuLynx gap.
2. **No optional/upsell line items.** → per-line "Optional" toggle; excluded
   from totals (`optionsTotal`); "Optional add-ons" block on the document;
   server `cleanItems` keeps `optional`; survives import/duplicate/edit/history.
3. **Price bank invisible in the builder.** quotely owns the canonical bank
   (71 items, 10 trades) consumed by sitevisit-ai, but the builder UI never
   used it. → *Add from price bank* modal with trade filter + search.
4. **No internal note.** → `internalNotes` field: editable in the builder,
   shown in the job-file rail on detail, never in the printed document. Server
   PUT allow-list + `buildQuote` extended; contract shape unchanged otherwise.

Not closed (conscious scope): per-line photos (JobNimbus hover pattern —
photos stay at quote level, clean and proven); per-line margin override
(iTrade — deposit/discount cover the basics); customer portal (hosted URL =
ongoing cost; mailto keeps it free).

## 4. The new visual identity — "The Estimate Ledger"

The 2026-10-13 pilot gave Quotely "the contractor's office" (money green,
Jobber/Joist voice). This pass gives it its own trades-estimating identity
distinct from that pilot and from the competitor palettes (JobNimbus dark blue,
AccuLynx blue, Joist/Jobber green):

- **A ledger, not a dashboard app.** Warm paper ground (#f3f1ea), white sheet
  surfaces, hairline ledger rules, mono (`IBM Plex Mono`) for quote numbers and
  reference labels, Inter Tight display headings, tabular numerals on every
  dollar figure.
- **Contractor-amber accent (#b45309)** — the field-mark orange of job-site
  spray paint and survey flags, used for primary actions, the active-nav edge,
  and step kickers. Status colors stay semantic (Won green, Sent blue, Draft
  gray, Lost slate, Expired red). No green-as-brand this time.
- **Sharp square geometry** everywhere (Alex's rule), no purple/blue gradients,
  no emoji chrome; inline SVG icons only.
- **Quote detail = job file.** Document sheet left; "JOB FILE" rail right with
  status actions, customer card, internal note, milestones summary, timeline,
  and the SignPilot/change-order pipeline as rail modules.
- **Dashboard pipeline board** in the JobNimbus boards spirit: columns with
  estimated totals, cards clickable into the job file.
- **Builder as numbered steps** (01 The job · 02 Photos · 03 Customer · 04 Line
  items) in the JobProgress template-driven spirit; live sheet preview stays.

## 5. Preserved — everything from the pipeline consolidation (untouched contracts)

- Price bank ownership: GET /api/price-bank → {version,currency,updated,
  tripFee,trades[],items[]} (v1.0.0, 71 items, 10 trades), `servedBy` field.
- POST /api/quotes/import upsert on importedFrom.visitId.
- SignPilot two-way wiring (won → approval doc; sign/decline callback;
  declined reopens to sent + reason; change-order/completion docs; sync re-poll;
  SIGNPILOT_URL env).
- Change orders (CO-1…; approve → revisedTotal), milestone billing
  (Deposit 25 → Rough-in 50 → Final 25), materials-list export (JSON + CSV for
  materiallist-ai), job-pipeline content on detail.
- QUOTELY_URL / SIGNPILOT_URL env wiring. AI generate (OpenAI optional),
  local estimator fallback, templates, version history + restore, payment terms
  + warranty, expiry, duplication, follow-ups, customer directory, settings.

Additive API changes only: items may carry `optional: true`; quote.totals gains
`optionsTotal` (sum of optional lines); quote gains `internalNotes` string.
All existing fields, IDs, and data flows keep working.
