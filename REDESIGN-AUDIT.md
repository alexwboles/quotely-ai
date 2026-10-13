# Quotely AI — Redesign Audit (pilot for portfolio de-vibe-code)

Date: 2026-10-13. References: Jobber (quote detail screenshot), Joist (invoice/estimate list + mobile estimate screenshots).

## Visual gaps (why it reads "vibe coded")

1. **Rounded everything.** `--radius: 14px` cards, 10px buttons/inputs, 999px pill status badges, pill nav dots, rounded modal leftovers. Alex's no-rounded-edges rule is violated throughout. Jobber/Joist use flat, square geometry.
2. **Decorative nav dots instead of icons.** The sidebar uses 7px dots — a template tell. Real tools use real icons.
3. **Fullwidth "＋" glyph** in the New quote button — emoji-adjacent chrome.
4. **"AI" pill badge in the brand lockup** — gimmicky; competitors brand the company, not the tech.
5. **Darkroom "developing tray" photo metaphor.** Film-strip dot borders, rotated polaroid cards, tape strips, sepia "develop" animation, "FRAME 01" placeholders. No real quoting software does this. Joist uses a clean attachment grid. This is the single most vibe-coded element in the app.
6. **Copper/cream "contractor's desk" theme.** Reads crafty, not commercial. Jobber and Joist both use neutral white surfaces + green money accent.
7. **Generic KPI card dashboard.** Four rounded stat cards with no hierarchy or action orientation — the canonical vibe-coded dashboard.
8. **Bare-text empty states** ("No quotes yet.") — not designed; competitors use helpful copy + a next action.
9. **Inconsistent status language.** Status "pills" are 999px rounded (vibe-coded); Vilano CRM already established sharp-edged badges as the house pattern.
10. **Quote sheet preview is good** (document-style, letterhead, signature line) but wrapped in rounded chrome; the document itself is the right metaphor and should be promoted, not framed.

## Functional gaps (vs Jobber / Joist)

1. **No quote detail view.** Jobber's core pattern is list → document detail with an action bar (Edit, Duplicate, Mark sent/won, Print/PDF, History). Quotely only has row action buttons.
2. **No edit flow.** The API supports full PUT updates (items, photos, terms) with version snapshots, but the UI exposes no way to revise a saved quote — a Jobber-basic capability.
3. **Customer directory buried.** A top-10 table on the dashboard; Jobber/Joist give Clients a dedicated nav view with search.
4. **Row-action button pile.** Up to 7 small buttons per row (Mark sent, Won, Lost, Reopen, Duplicate, Delete, History). Competitors use Open → detail actions.
5. **Photo management is whimsy over function.** Tags/captions/AI analysis exist but are presented as darkroom props.
6. **Save is a dead end.** After saving, the builder just sits there. Jobber shows "Quote created" and lands on the detail document.

## Flow gaps

1. No breadcrumb/back pattern on sub-views (Jobber: "Back to: Quotes").
2. No "quote created" confirmation → detail landing.
3. Template apply/save lives in a cramped bar above the items table; competitors treat templates as a first-class picker.

## What the redesign keeps (all features preserved)

AI line-item generation, local estimator fallback, line-item templates (save/apply), payment terms + warranty per quote, expiry detection + badges, quote duplication, version history + restore, job photos (on-device analysis, captions, before/after tags, AI look), follow-up dates + alerts, pipeline view, customer directory data, company settings + logo, print/PDF, tax/deposit/valid-days/notes.

## Design concept (pilot)

"The contractor's office": a field-service quoting desk in the visual language of Jobber and Joist. Crisp white document surfaces on a cool light-gray ground, hairline borders, sharp square corners everywhere, one confident money-green accent (#157a3e) for primary actions and won states, dark slate sidebar with real inline SVG icons. Inter with tight headings and tabular numerals on every dollar figure. IA follows Jobber: sidebar (Dashboard, New Quote, Quotes, Customers, Settings), Joist-style quotes list (search, status tabs, outstanding total, Open/Edit per row), Jobber-style quote detail document (letterhead, line items, totals block, terms, signature, action bar), two-pane builder with live document preview. Photos become clean Joist-style attachments. Status gets flat square badges: Draft gray, Sent blue, Won green, Lost slate, Expired red.
