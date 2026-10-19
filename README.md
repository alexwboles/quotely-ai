# Quotely AI ⚡

**Describe the job in plain English. Get a professional quote in seconds.**

Tradespeople lose jobs because quoting is slow and unprofessional — scribbled numbers on a notepad, or quotes that take two days to send. Quotely AI fixes that: type what the customer needs ("replace 2 kitchen faucets and fix a leaking bathroom pipe"), and it drafts editable line items with realistic pricing, renders a polished quote you can print or save as PDF, and tracks follow-ups plus win/loss so no lead goes cold.

## The problem
- Quotes take hours; customers hire whoever replies first.
- Handwritten / vague quotes look unprofessional and kill trust.
- No follow-up system → quotes sent into the void, jobs lost.

## The solution
1. **Job input** — plain-English description + trade selector + customer details.
2. **AI line-item generator** — keyword-based estimator turns the description into priced line items (qty/price fully editable). Works **offline with zero API keys**; if the owner sets `OPENAI_API_KEY`, it optionally enhances items via OpenAI and falls back gracefully on any failure.
3. **Professional quote** — branded preview (company name, logo, contact), quote numbering, validity date, tax/deposit math, signature line. Print/PDF straight from the browser.
4. **Follow-up & win/loss tracking** — quotes saved to `data/quotes.json`; dashboard flags overdue follow-ups and tracks won/lost revenue.
5. **Job photos** — attach up to 8 site photos per quote (drag-drop or browse; downscaled on-device). Each photo gets free on-device analysis: dimensions, dominant colors, and dark/blurry warnings. Photos print on the quote sheet. With `OPENAI_API_KEY` set, **AI look** describes a photo and suggests line items you can add with one click.

## Pricing idea
- **Free**: unlimited quotes, 1 user.
- **Pro — $24/mo**: custom branding/templates, SMS follow-up reminders, QuickBooks export, multi-user crews.
- **Why it can win**: every independent plumber, electrician, painter, landscaper, and handyman (millions in the US alone) quotes jobs weekly. One saved job a month pays for a year of Pro.

## How to run
Requirements: Node.js 16+ (no other dependencies, no build step).

```bash
npm start
# open http://localhost:3000
```

Optional: set `OPENAI_API_KEY` to enable AI-enhanced line items
(the built-in estimator is always the fallback):
```bash
OPENAI_API_KEY=sk-... npm start
```

Data is stored locally in `data/quotes.json`. Company profile/logo live in the browser's localStorage.

Optional pipeline wiring (trades flywheel — see "Trades pipeline" below):
```bash
SIGNPILOT_URL=http://localhost:3003 npm start   # auto-request SignPilot approvals on won quotes
```

## API
- `POST /api/generate` `{description, trade}` → `{items, source}` (`"local"` or `"openai"`)
- `GET /api/quotes` → list saved quotes
- `POST /api/quotes` → save a quote (auto quote number `Q-YYYY-0001…`)
- `GET /api/quotes/:id` → one quote
- `PUT /api/quotes/:id` → update status/items/photos/follow-up/notes… (marking `won` auto-requests a SignPilot approval when `SIGNPILOT_URL` is set)
- `DELETE /api/quotes/:id` → delete
- `POST /api/analyze-photo` `{dataUrl, trade}` → `{observations, items}` (needs `OPENAI_API_KEY`; 503 `no-key` otherwise)
- `GET /api/health` → `{ok, version, openai, signpilot}`

## Trades pipeline — quotely-ai is the office back-end

Quotely sits in the middle of the trades flywheel: **SiteVisit AI** (field capture) → **Quotely AI** (quoting + billing) → **SignPilot AI** (paper trail). All three stay standalone repos; they talk over localhost HTTP, configured with two env vars:

- `SIGNPILOT_URL` — e.g. `http://localhost:3003`. When set, marking a quote `won` automatically creates a SignPilot **quote-approval** document pre-filled from the quote. When unset, the pipeline degrades gracefully (the UI offers a manual "Request client approval" button that explains what's missing).
- SiteVisit AI points at quotely with its own `QUOTELY_URL`; signpilot-ai points back with `QUOTELY_URL` for its callbacks.

### Price-bank contract (quotely-ai owns it)
- **Format**: `GET /api/price-bank` → `{version, currency, updated, tripFee, trades[], items[]}` where each item is `{trades[], keys[], name, unit, price}` (USD, parts + labor ballparks).
- **Location/URL**: the live copy is served by quotely-ai at `GET /api/price-bank`. SiteVisit AI pulls it when `QUOTELY_URL` is set, else uses its last cached copy (`data/price-bank.cache.json`), else the shipped snapshot (`public/price-bank.fallback.json` — machine-generated from quotely-ai, never hand-edited).
- **Versioning**: semver in the `version` field (`1.0.0`). Major = field renames/removals (consumers must adapt); minor = new items/trades; patch = price tweaks only. Quotely's own generator and SiteVisit's generator both read the same bank, so prices never drift apart.

### Site-visit handoff (a sitevisit draft IS a quotely quote)
- `POST /api/quotes/import` — accepts a SiteVisit quote draft and **upserts** it into the quote ledger on `importedFrom.visitId`: re-sending a visit updates the same quotely quote, never duplicates it. Payload: `{source, visitId, visitNumber, customer, address, trade, description, items[], photos[], taxPct, discountPct, followUpDate, notes, status}` (sitevisit statuses map: draft→draft, sent→sent, approved/scheduled/invoiced/paid→won). The visit id/number are kept on the quote as `importedFrom` for traceability; the site address lands in the quote notes.
- Discounts arriving from SiteVisit are stored as `discountRate` (percent) — quote totals run subtotal → discount → tax → total.

### SignPilot wiring (both ways)
- **quotely → signpilot**: quote marked `won` → `POST {SIGNPILOT_URL}/api/documents` with the `quote-approval` template pre-filled (client, quote number, scope + line items, total, validity). The link (`docId`/`docNumber`) is stored on the quote as `signpilot`. Manual/alternative entry points: `POST /api/quotes/:id/signpilot-request` `{purpose: "approval"|"change-order"|"completion", changeOrderId?}`.
- **signpilot → quotely**: signing or declining a linked document calls `POST /api/quotes/:id/signpilot-callback` `{docId, docNumber, purpose, changeOrderId?, status: "signed"|"declined", …}`. A signed approval flips the quote's approval to signed; a declined approval reopens the quote to `sent` and appends the reason to the notes; change-order/completion documents update their own pipeline records. `POST /api/quotes/:id/sync-signpilot` re-polls the document for cases where the callback couldn't reach quotely.

### Change orders
Won quotes can grow: `POST /api/quotes/:id/change-orders` `{description, items[]|costDelta, notes?}` → `CO-1…` (status `proposed`); `POST …/change-orders/:coId/approve` folds the delta into `revisedTotal` (quote total + approved changes). Any change order can be sent to SignPilot for a countersigned paper trail via `signpilot-request` with `purpose: "change-order"`.

### Milestone / progress billing
`POST /api/quotes/:id/milestones` `{template: "standard"}` applies **Deposit 25% → Rough-in 50% → Final 25%** (amounts computed from the revised total), or pass a custom `{milestones: [{name, pct, dueDate?}]}`. `PATCH …/milestones/:mId` `{status: "pending"|"billed"|"paid"}` walks each milestone to paid. Re-applying the template refreshes amounts after change orders.

### Materials-list export (one click, shaped for materiallist-ai)
`GET /api/quotes/:id/materials-list` runs the quote's description + line items through the materiallist-ai takeoff engine (vendored MIT copy in `public/ml-materials.js` — materiallist-ai itself is never modified) and returns `{format: "materiallist-ai/saved-list@1", entry, csv, importHint}`. The `entry` matches materiallist-ai's saved-list shape exactly, so it drops into its library; `?format=csv` downloads the store-run checklist. Trades with no materials bank (Cleaning, General Handyman) export the quote's line items as material estimates instead — the response says so honestly.

## Tests
```bash
bash test/smoke.sh   # 100 checks: files, syntax, server, endpoints, photos, templates, history, price bank, import, change orders, milestones, materials export, signpilot wiring
bash test/e2e.sh     # 35 checks: generate → save → photos → follow-up → win/loss → restart persistence + full pipeline flow against a stub signpilot-ai
```

## Screenshots
*(Run it locally — `npm start` → http://localhost:3000)*
- **New Quote tab**: job description box, trade dropdown, customer fields, follow-up date → "Generate line items" → editable pricing table → live professional preview.
- **Print**: the quote preview prints cleanly (everything else hidden) — "Save as PDF" from the print dialog.
- **My Quotes tab**: quote cards with status badges (draft/sent/won/lost), totals, overdue follow-up alerts, one-click won/lost.
- **Settings tab**: company name, phone, email, address, logo upload.

## License
MIT — free for everyone, forever.
