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

## API
- `POST /api/generate` `{description, trade}` → `{items, source}` (`"local"` or `"openai"`)
- `GET /api/quotes` → list saved quotes
- `POST /api/quotes` → save a quote (auto quote number `Q-YYYY-0001…`)
- `PUT /api/quotes/:id` → update status/items/photos/follow-up/notes…
- `DELETE /api/quotes/:id` → delete
- `POST /api/analyze-photo` `{dataUrl, trade}` → `{observations, items}` (needs `OPENAI_API_KEY`; 503 `no-key` otherwise)
- `GET /api/health` → `{ok, version, openai}`

## Tests
```bash
bash test/smoke.sh   # 30 checks: files, syntax, server, endpoints, photos
bash test/e2e.sh     # 13 checks: generate → save → photos → follow-up → win/loss → restart persistence
```

## Screenshots
*(Run it locally — `npm start` → http://localhost:3000)*
- **New Quote tab**: job description box, trade dropdown, customer fields, follow-up date → "Generate line items" → editable pricing table → live professional preview.
- **Print**: the quote preview prints cleanly (everything else hidden) — "Save as PDF" from the print dialog.
- **My Quotes tab**: quote cards with status badges (draft/sent/won/lost), totals, overdue follow-up alerts, one-click won/lost.
- **Settings tab**: company name, phone, email, address, logo upload.

## License
MIT — free for everyone, forever.
