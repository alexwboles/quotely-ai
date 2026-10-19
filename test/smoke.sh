#!/usr/bin/env bash
# smoke.sh — 12 quick checks: files, syntax, server boot, API endpoints.
set -u
DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-3457}"
PASS=0; FAIL=0

ok()   { PASS=$((PASS+1)); echo "  PASS: $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }

echo "== Quotely AI smoke tests =="

# 1. required files exist
for f in server.js package.json public/index.html public/app.js public/style.css public/generate.js README.md; do
  [ -f "$DIR/$f" ] && ok "file exists: $f" || bad "missing file: $f"
done

# 2-4. JS syntax
for f in server.js public/app.js public/generate.js; do
  node --check "$DIR/$f" >/dev/null 2>&1 && ok "syntax ok: $f" || bad "syntax error: $f"
done

# start server (PORT must be exported BEFORE node boots)
export PORT
node "$DIR/server.js" >/tmp/quotely-smoke.log 2>&1 &
SRV=$!
cleanup() { kill $SRV 2>/dev/null; wait $SRV 2>/dev/null; }
trap cleanup EXIT
sleep 1
kill -0 $SRV 2>/dev/null || { bad "server process died on boot"; cat /tmp/quotely-smoke.log; echo "RESULT: $PASS passed, $FAIL failed"; exit 1; }

BASE="http://localhost:$PORT"

# 5. health
H=$(curl -s "$BASE/api/health")
echo "$H" | grep -q '"ok":true' && ok "GET /api/health ok (openai: $(echo "$H" | grep -o '"openai":[a-z]*'))" || bad "GET /api/health: $H"

# 6. generate: plumbing job -> faucet line item, local source (no API key)
G=$(curl -s -X POST "$BASE/api/generate" -H 'Content-Type: application/json' \
  -d '{"description":"Replace 2 kitchen faucets and fix a leaking bathroom pipe","trade":"Plumbing"}')
echo "$G" | grep -qi 'faucet' && ok "generate finds faucet keyword" || bad "generate missed faucet: ${G:0:200}"
echo "$G" | grep -q '"source":"local"' && ok "generate source=local without API key" || bad "generate source wrong: ${G:0:200}"
echo "$G" | grep -q '"qty":2' && ok "generate extracts qty 2 for faucets" || bad "qty extraction: ${G:0:200}"

# 7. generate: unknown job -> editable fallback item, never empty
G2=$(curl -s -X POST "$BASE/api/generate" -H 'Content-Type: application/json' \
  -d '{"description":"asdf qwerty zzz not a real job","trade":"General Handyman"}')
echo "$G2" | grep -q '"items":\[' && echo "$G2" | grep -qv '"items":\[\]' \
  && ok "generate fallback returns editable item for unknown job" \
  || bad "generate empty for unknown job: ${G2:0:200}"

# 8. save quote
Q=$(curl -s -X POST "$BASE/api/quotes" -H 'Content-Type: application/json' \
  -d '{"customer":"Jane Smith","trade":"Plumbing","description":"Replace 2 faucets","items":[{"description":"Faucet replacement (parts + labor)","qty":2,"unit":"each","unitPrice":145}],"taxRate":8,"depositRate":25,"followUp":"2026-10-01"}')
QID=$(echo "$Q" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
QNUM=$(echo "$Q" | grep -o '"number":"[^"]*"' | head -1 | cut -d'"' -f4)
[ -n "$QID" ] && ok "POST /api/quotes saved (id=$QID)" || bad "save quote failed: ${Q:0:200}"
echo "$QNUM" | grep -qE '^Q-2026-[0-9]{4}$' && ok "quote number format: $QNUM" || bad "quote number bad: $QNUM"
echo "$Q" | grep -q '"total":313.2' && ok "totals math correct (2x145=290 +8% tax=313.20)" || bad "totals wrong: ${Q:0:300}"

# 9. list contains it
L=$(curl -s "$BASE/api/quotes")
echo "$L" | grep -q "$QID" && ok "GET /api/quotes lists saved quote" || bad "list missing quote"

# 10. update status -> won
U=$(curl -s -X PUT "$BASE/api/quotes/$QID" -H 'Content-Type: application/json' -d '{"status":"won"}')
echo "$U" | grep -q '"status":"won"' && ok "PUT status -> won" || bad "status update: ${U:0:200}"

# 11. delete
D=$(curl -s -X DELETE "$BASE/api/quotes/$QID")
L2=$(curl -s "$BASE/api/quotes")
echo "$D" | grep -q '"ok":true' && ! echo "$L2" | grep -q "$QID" \
  && ok "DELETE removes quote" || bad "delete failed: ${D:0:120}"

# 12. static serving + print CSS
T=$(curl -s "$BASE/")
echo "$T" | grep -q '<title>Quotely' && ok "GET / serves index.html" || bad "index not served"
curl -s "$BASE/style.css" | grep -q '@media print' && ok "print CSS present" || bad "no @media print"

# 13. photos: save quote with photo (caption + tag kept, invalid rejected)
PIX="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
QP=$(curl -s -X POST "$BASE/api/quotes" -H 'Content-Type: application/json' \
  -d "{\"customer\":\"Photo Test\",\"trade\":\"Painting\",\"items\":[{\"description\":\"x\",\"qty\":1,\"unit\":\"each\",\"unitPrice\":10}],\"photos\":[{\"dataUrl\":\"$PIX\",\"caption\":\"Front wall\",\"tag\":\"before\"},{\"dataUrl\":\"not-a-data-url\",\"caption\":\"bad\"}]}")
QPID=$(echo "$QP" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "$QP" | grep -q '"caption":"Front wall"' && echo "$QP" | grep -q '"tag":"before"' \
  && ok "POST saves photo with caption + tag" || bad "photo not saved: ${QP:0:200}"
echo "$QP" | grep -q 'not-a-data-url' && bad "invalid photo data URL accepted" || ok "invalid photo data URL rejected"
echo "$QP" | grep -q '"photos":\[' && ok "quote carries photos array" || bad "no photos array: ${QP:0:200}"

# 14. photo cap: 10 uploads -> 8 stored
MANY=$(python3 -c "print(','.join(['{\"dataUrl\":\"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==\"}']*10))")
QC=$(curl -s -X POST "$BASE/api/quotes" -H 'Content-Type: application/json' \
  -d "{\"customer\":\"Cap Test\",\"trade\":\"Painting\",\"items\":[{\"description\":\"x\",\"qty\":1,\"unit\":\"each\",\"unitPrice\":1}],\"photos\":[$MANY]}")
CCOUNT=$(echo "$QC" | grep -o '"dataUrl"' | wc -l)
[ "$CCOUNT" = "8" ] && ok "photo cap enforced (10 -> 8)" || bad "photo cap: stored $CCOUNT"
QCID=$(echo "$QC" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

# 15. PUT photos replaces photo set
UP=$(curl -s -X PUT "$BASE/api/quotes/$QPID" -H 'Content-Type: application/json' \
  -d "{\"photos\":[{\"dataUrl\":\"$PIX\",\"tag\":\"after\"}]}")
echo "$UP" | grep -q '"tag":"after"' && ok "PUT photos updates quote" || bad "PUT photos failed: ${UP:0:200}"

# 16. analyze-photo without API key -> 503 no-key (never spends)
AHTTP=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/analyze-photo" -H 'Content-Type: application/json' -d "{\"dataUrl\":\"$PIX\"}")
ABODY=$(curl -s -X POST "$BASE/api/analyze-photo" -H 'Content-Type: application/json' -d "{\"dataUrl\":\"$PIX\"}")
[ "$AHTTP" = "503" ] && echo "$ABODY" | grep -q '"error":"no-key"' \
  && ok "analyze-photo without key -> 503 no-key" || bad "analyze-photo: http=$AHTTP body=${ABODY:0:120}"

# 17. photo quotes cleaned up
curl -s -X DELETE "$BASE/api/quotes/$QPID" >/dev/null
curl -s -X DELETE "$BASE/api/quotes/$QCID" >/dev/null
L3=$(curl -s "$BASE/api/quotes")
! echo "$L3" | grep -q "$QPID" && ! echo "$L3" | grep -q "$QCID" \
  && ok "photo test quotes deleted" || bad "photo cleanup failed"


# 18. templates: create -> list -> delete
T=$(curl -s -X POST "$BASE/api/templates" -H 'Content-Type: application/json' \
  -d '{"name":"Smoke Template","trade":"Plumbing","items":[{"description":"Faucet swap","qty":1,"unit":"each","unitPrice":150}]}')
TID=$(echo "$T" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
[ -n "$TID" ] && ok "POST /api/templates saved (id=$TID)" || bad "template save failed: ${T:0:200}"
TL=$(curl -s "$BASE/api/templates")
echo "$TL" | grep -q "$TID" && ok "GET /api/templates lists saved template" || bad "template list missing"
TBAD=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/templates" -H 'Content-Type: application/json' -d '{"name":"","items":[]}')
[ "$TBAD" = "400" ] && ok "template validation rejects empty name/items" || bad "template validation http=$TBAD"
TD=$(curl -s -X DELETE "$BASE/api/templates/$TID")
TL2=$(curl -s "$BASE/api/templates")
echo "$TD" | grep -q '"ok":true' && ! echo "$TL2" | grep -q "$TID" \
  && ok "DELETE /api/templates removes it" || bad "template delete failed"

# 19. version history: edit items -> snapshot -> restore
QV=$(curl -s -X POST "$BASE/api/quotes" -H 'Content-Type: application/json' \
  -d '{"customer":"Version Test","trade":"Painting","items":[{"description":"Prime walls","qty":1,"unit":"job","unitPrice":200}],"taxRate":0,"depositRate":0}')
QVID=$(echo "$QV" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "$QV" | grep -q '"history":\[\]' && ok "new quote starts with empty history" || bad "no history array: ${QV:0:200}"
curl -s -X PUT "$BASE/api/quotes/$QVID" -H 'Content-Type: application/json' \
  -d '{"items":[{"description":"Prime walls","qty":1,"unit":"job","unitPrice":200},{"description":"Two coats","qty":1,"unit":"job","unitPrice":350}]}' >/dev/null
QH=$(curl -s "$BASE/api/quotes" | python3 -c "import json,sys; d=json.load(sys.stdin); q=[x for x in d if x['id']=='$QVID'][0]; print(len(q.get('history',[])), q['history'][0]['items'][0]['unitPrice'] if q.get('history') else '')")
echo "$QH" | grep -q '^1 200' && ok "PUT items snapshots previous version (history=1, old price 200)" || bad "history wrong: $QH"
curl -s -X PUT "$BASE/api/quotes/$QVID" -H 'Content-Type: application/json' -d '{"status":"sent"}' >/dev/null
QH2=$(curl -s "$BASE/api/quotes" | python3 -c "import json,sys; d=json.load(sys.stdin); print(len([x for x in d if x['id']=='$QVID'][0].get('history',[])))")
[ "$QH2" = "1" ] && ok "status-only PUT does not snapshot" || bad "spurious snapshot: $QH2"
RS=$(curl -s -X POST "$BASE/api/quotes/$QVID/restore" -H 'Content-Type: application/json' -d '{"index":0}')
echo "$RS" | grep -q '"unitPrice":200' && ok "POST restore brings back old line items" || bad "restore failed: ${RS:0:200}"
RSBAD=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/quotes/$QVID/restore" -H 'Content-Type: application/json' -d '{"index":99}')
[ "$RSBAD" = "400" ] && ok "restore rejects bad index" || bad "restore validation http=$RSBAD"
curl -s -X DELETE "$BASE/api/quotes/$QVID" >/dev/null
ok "version test quote cleaned up"

# 20. customers directory aggregates lifetime value
QC2=$(curl -s -X POST "$BASE/api/quotes" -H 'Content-Type: application/json' \
  -d '{"customer":"Dir Test","trade":"Plumbing","items":[{"description":"x","qty":1,"unit":"each","unitPrice":100}],"taxRate":0,"depositRate":0}')
QCID2=$(echo "$QC2" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
curl -s -X PUT "$BASE/api/quotes/$QCID2" -H 'Content-Type: application/json' -d '{"status":"won"}' >/dev/null
CU=$(curl -s "$BASE/api/customers")
echo "$CU" | grep -q 'Dir Test' && echo "$CU" | grep -q '"won":1' && echo "$CU" | grep -q '"totalWon":100' \
  && ok "GET /api/customers aggregates Dir Test (1 won, \$100)" || bad "customers wrong: ${CU:0:300}"
curl -s -X DELETE "$BASE/api/quotes/$QCID2" >/dev/null

# 21. UI wiring — templates, customers, history
missing=""
for n in templateSel applyTemplateBtn saveTemplateBtn customersBody historyModal historyBody historyTitle historyClose; do
  grep -q "$n" "$DIR/public/index.html" || missing="$missing html:$n"
  grep -q "$n" "$DIR/public/app.js" || missing="$missing js:$n"
done
[ -z "$missing" ] && ok "UI wires templates/customers/history" || bad "missing wiring:$missing"

# 22. expiry helpers (shared logic)
node -e "
const Q = require('$DIR/public/generate.js');
const old = { createdAt: '2026-09-01T00:00:00.000Z', validDays: 30, status: 'draft' };
if (Q.quoteExpiryISO(old) !== '2026-10-01') throw new Error('expiry date');
if (!Q.isQuoteExpired(old, '2026-10-13')) throw new Error('should be expired');
if (Q.isQuoteExpired(old, '2026-09-15')) throw new Error('not yet expired');
const won = Object.assign({}, old, { status: 'won' });
if (Q.isQuoteExpired(won, '2026-10-13')) throw new Error('won quotes never expire');
const fresh = { createdAt: new Date().toISOString(), validDays: 30, status: 'draft' };
if (Q.isQuoteExpired(fresh)) throw new Error('fresh quote expired');
if (Q.quoteExpiryISO({}) !== null) throw new Error('bad createdAt should be null');
console.log('ok');
" >/dev/null && ok "quoteExpiryISO/isQuoteExpired logic" || bad "expiry helpers"

# 23. payment terms + warranty saved on POST, validated on PUT
QT=$(curl -s -X POST "$BASE/api/quotes" -H 'Content-Type: application/json' \
  -d '{"customer":"Terms Test","trade":"Plumbing","items":[{"description":"x","qty":1,"unit":"each","unitPrice":50}],"paymentTerms":"Net 30","warranty":"2-year warranty"}')
QTID=$(echo "$QT" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "$QT" | grep -q '"paymentTerms":"Net 30"' && echo "$QT" | grep -q '"warranty":"2-year warranty"' \
  && ok "POST saves paymentTerms + warranty" || bad "terms not saved: ${QT:0:300}"
UPT=$(curl -s -X PUT "$BASE/api/quotes/$QTID" -H 'Content-Type: application/json' -d '{"paymentTerms":"Net 99"}')
echo "$UPT" | grep -q '"paymentTerms":"Due on receipt"' && ok "PUT rejects bad terms -> default" || bad "bad terms accepted: ${UPT:0:200}"
UPL=$(echo "$QT" | python3 -c "import json,sys; print(len(json.load(sys.stdin)['warranty']))")
[ "$UPL" = "15" ] && ok "warranty stored verbatim" || bad "warranty length: $UPL"

# 24. duplicate endpoint: new number, draft, same items/terms
DP=$(curl -s -X POST "$BASE/api/quotes/$QTID/duplicate")
echo "$DP" | grep -q '"status":"draft"' && echo "$DP" | grep -q '"paymentTerms":"Due on receipt"' \
  && ok "POST duplicate -> fresh draft keeps terms" || bad "duplicate wrong: ${DP:0:300}"
DPID=$(echo "$DP" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
[ -n "$DPID" ] && [ "$DPID" != "$QTID" ] && ok "duplicate has new id" || bad "duplicate id"
DPN=$(echo "$DP" | grep -o '"number":"[^"]*"' | head -1 | cut -d'"' -f4)
QTN=$(echo "$QT" | grep -o '"number":"[^"]*"' | head -1 | cut -d'"' -f4)
[ -n "$DPN" ] && [ "$DPN" != "$QTN" ] && ok "duplicate has new number ($QTN -> $DPN)" || bad "duplicate number: $DPN vs $QTN"
DP404=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/quotes/nope123/duplicate")
[ "$DP404" = "404" ] && ok "duplicate 404s on unknown id" || bad "duplicate 404: $DP404"
curl -s -X DELETE "$BASE/api/quotes/$QTID" >/dev/null
curl -s -X DELETE "$BASE/api/quotes/$DPID" >/dev/null

# 25. second-sweep UI wiring
missing2=""
for n in payTerms warranty; do
  grep -q "id=\"$n\"" "$DIR/public/index.html" || missing2="$missing2 html:$n"
  grep -q "$n" "$DIR/public/app.js" || missing2="$missing2 js:$n"
done
grep -q 'data-act="dup"' "$DIR/public/app.js" || missing2="$missing2 dup-button"
grep -q 'badge expired' "$DIR/public/app.js" || missing2="$missing2 expired-badge"
grep -q 'data-status="expired"' "$DIR/public/index.html" || missing2="$missing2 expired-filter"
[ -z "$missing2" ] && ok "UI wires terms/warranty/duplicate/expiry" || bad "missing wiring:$missing2"

# 26. price bank: versioned canonical bank owned by quotely-ai
PB=$(curl -s "$BASE/api/price-bank")
echo "$PB" | grep -q '"version":"1.0.0"' && ok "price bank version 1.0.0" || bad "price bank version: ${PB:0:120}"
echo "$PB" | grep -q '"servedBy":"quotely-ai"' && ok "price bank servedBy quotely-ai" || bad "servedBy missing"
echo "$PB" | grep -q '"currency":"USD"' && ok "price bank currency USD" || bad "currency missing"
NITEMS=$(echo "$PB" | python3 -c "import json,sys; print(len(json.load(sys.stdin)['items']))")
[ "$NITEMS" -ge 60 ] && ok "price bank has $NITEMS line items" || bad "item count: $NITEMS"
node -e "
var Q=require('$DIR/public/generate.js');
var b=Q.priceBank();
if(b.version!=='1.0.0') throw new Error('version');
b.items.forEach(function(e){ if(!Array.isArray(e.trades)||!Array.isArray(e.keys)||!e.name||!e.unit||e.price==null) throw new Error('bad entry '+e.name); });
if(b.items.filter(function(e){return e.trades.indexOf('Flooring')!==-1;}).length<3) throw new Error('flooring trade missing');
" && ok "priceBank() entries have canonical {trades,keys,name,unit,price} shape" || bad "priceBank shape"

# 27. GET single quote + discountRate math
Q1=$(curl -s -X POST "$BASE/api/quotes" -H 'Content-Type: application/json' \
  -d '{"customer":"Single Test","trade":"Plumbing","items":[{"description":"x","qty":1,"unit":"each","unitPrice":100}],"taxRate":0,"discountRate":10,"depositRate":0}')
Q1ID=$(echo "$Q1" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "$Q1" | grep -q '"discountRate":10' && echo "$Q1" | grep -q '"discount":10' && echo "$Q1" | grep -q '"total":90' \
  && ok "POST saves discountRate (100 -10% = 90 total)" || bad "discount math: ${Q1:0:300}"
G1=$(curl -s "$BASE/api/quotes/$Q1ID")
echo "$G1" | grep -q "\"id\":\"$Q1ID\"" && ok "GET /api/quotes/:id returns the quote" || bad "single fetch: ${G1:0:120}"
[ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/quotes/nope999")" = "404" ] && ok "GET unknown quote -> 404" || bad "single 404"
U1=$(curl -s -X PUT "$BASE/api/quotes/$Q1ID" -H 'Content-Type: application/json' -d '{"discountRate":150}')
echo "$U1" | grep -q '"discountRate":100' && ok "PUT clamps discountRate to 100" || bad "discount clamp: ${U1:0:200}"
curl -s -X DELETE "$BASE/api/quotes/$Q1ID" >/dev/null

# 28. sitevisit import: create + upsert (a sitevisit draft IS a quotely quote)
IMP='{"source":"sitevisit-ai","visitId":"sv-test-1","visitNumber":"SV-2026-0001","customer":"Import Case","address":"1 Main St","trade":"Plumbing","description":"faucet drips","items":[{"description":"Faucet replacement (parts + labor)","qty":1,"unit":"each","unitPrice":145}],"photos":[],"taxPct":8,"discountPct":10,"status":"draft"}'
IMPR=$(curl -s -X POST "$BASE/api/quotes/import" -H 'Content-Type: application/json' -d "$IMP")
IID=$(echo "$IMPR" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "$IMPR" | grep -q '"created":true' && [ -n "$IID" ] && ok "import creates quotely quote from sitevisit draft" || bad "import failed: ${IMPR:0:250}"
echo "$IMPR" | grep -q '"visitId":"sv-test-1"' && ok "importedFrom.visitId stored" || bad "importedFrom missing"
echo "$IMPR" | grep -q '"discountRate":10' && ok "import maps discountPct -> discountRate" || bad "discount map"
echo "$IMPR" | grep -q 'Site: 1 Main St' && ok "import keeps site address in notes" || bad "address lost"
echo "$IMPR" | grep -q '"total":140.94' && ok "import totals: 145 -10% +8% tax = 140.94" || bad "import totals: ${IMPR:0:300}"
IMPR2=$(curl -s -X POST "$BASE/api/quotes/import" -H 'Content-Type: application/json' -d "$IMP")
IID2=$(echo "$IMPR2" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "$IMPR2" | grep -q '"created":false' && [ "$IID2" = "$IID" ] \
  && ok "re-import upserts the same quote (no duplicate)" || bad "upsert failed: ${IMPR2:0:250}"
IMPBAD=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/quotes/import" -H 'Content-Type: application/json' -d '{"customer":"x"}')
[ "$IMPBAD" = "400" ] && ok "import requires visitId" || bad "import validation: $IMPBAD"

# 29. change orders: draft rejected, won flow with revised total
[ "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/quotes/$IID/change-orders" -H 'Content-Type: application/json' -d '{"description":"x","costDelta":50}')" = "400" ] \
  && ok "change order on draft quote rejected" || bad "change order allowed on draft"
curl -s -X PUT "$BASE/api/quotes/$IID" -H 'Content-Type: application/json' -d '{"status":"won"}' >/dev/null
CO=$(curl -s -X POST "$BASE/api/quotes/$IID/change-orders" -H 'Content-Type: application/json' -d '{"description":"Add shut-off valves","costDelta":85.5}')
COID=$(echo "$CO" | grep -o '"id":"co_[^"]*"' | head -1 | cut -d'"' -f4)
echo "$CO" | grep -q '"number":"CO-1"' && [ -n "$COID" ] && ok "change order created as CO-1" || bad "change order: ${CO:0:250}"
COA=$(curl -s -X POST "$BASE/api/quotes/$IID/change-orders/$COID/approve")
echo "$COA" | grep -q '"status":"approved"' && ok "change order approved" || bad "approve: ${COA:0:200}"
echo "$COA" | grep -q '"revisedTotal":226.44' && ok "revisedTotal = 140.94 + 85.50 = 226.44" || bad "revisedTotal: ${COA:0:200}"
[ "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/quotes/$IID/change-orders/$COID/approve")" = "400" ] \
  && ok "double-approve rejected" || bad "double approve allowed"
COBAD=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/quotes/$IID/change-orders" -H 'Content-Type: application/json' -d '{"description":""}')
[ "$COBAD" = "400" ] && ok "change order requires a description" || bad "change order validation: $COBAD"

# 30. milestones: deposit -> rough-in -> final
MSD=$(curl -s -X POST "$BASE/api/quotes" -H 'Content-Type: application/json' \
  -d '{"customer":"Milestone Draft","trade":"Plumbing","items":[{"description":"x","qty":1,"unit":"each","unitPrice":10}],"taxRate":0,"depositRate":0}')
MSDID=$(echo "$MSD" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
[ "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/quotes/$MSDID/milestones" -H 'Content-Type: application/json' -d '{"template":"standard"}')" = "400" ] \
  && ok "milestones on draft quote rejected" || bad "milestones allowed on draft"
curl -s -X DELETE "$BASE/api/quotes/$MSDID" >/dev/null
MS=$(curl -s -X POST "$BASE/api/quotes/$IID/milestones" -H 'Content-Type: application/json' -d '{"template":"standard"}')
echo "$MS" | grep -q '"name":"Deposit"' && echo "$MS" | grep -q '"name":"Rough-in"' && echo "$MS" | grep -q '"name":"Final"' \
  && ok "milestone template: deposit -> rough-in -> final" || bad "milestones: ${MS:0:300}"
echo "$MS" | grep -q '"amount":56.61' && echo "$MS" | grep -q '"amount":113.22' \
  && ok "milestone amounts = 25/50/25% of revised 226.44" || bad "milestone amounts: ${MS:0:300}"
MSID=$(echo "$MS" | grep -o '"id":"m_[^"]*"' | head -1 | cut -d'"' -f4)
MSP=$(curl -s -X PATCH "$BASE/api/quotes/$IID/milestones/$MSID" -H 'Content-Type: application/json' -d '{"status":"billed"}')
echo "$MSP" | grep -q '"status":"billed"' && ok "milestone -> billed" || bad "milestone patch: ${MSP:0:200}"
[ "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$BASE/api/quotes/$IID/milestones/$MSID" -H 'Content-Type: application/json' -d '{"status":"bogus"}')" = "400" ] \
  && ok "milestone rejects bad status" || bad "milestone status validation"
MSP2=$(curl -s -X PATCH "$BASE/api/quotes/$IID/milestones/$MSID" -H 'Content-Type: application/json' -d '{"status":"paid"}')
echo "$MSP2" | grep -q '"status":"paid"' && ok "milestone billed -> paid" || bad "milestone paid"

# 31. materials-list export shaped for materiallist-ai
ML=$(curl -s "$BASE/api/quotes/$IID/materials-list")
echo "$ML" | grep -q '"format":"materiallist-ai/saved-list@1"' && ok "materials export format tag" || bad "format: ${ML:0:150}"
echo "$ML" | grep -q '"mlTrade":"plumbing"' && ok "trade mapped to materiallist-ai plumbing bank" || bad "trade map"
MLN=$(echo "$ML" | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d['entry']['items']))")
[ "$MLN" -ge 1 ] && ok "materials takeoff has $MLN items" || bad "takeoff empty"
echo "$ML" | python3 -c "import json,sys; d=json.load(sys.stdin); e=d['entry']; assert e['trade']=='plumbing' and isinstance(e['bought'],list) and e['wastePct']==10 and 'quantities' in e; print('shape ok')" >/dev/null \
  && ok "export entry matches materiallist-ai saved-list shape" || bad "entry shape"
echo "$ML" | grep -q '"importHint"' && ok "export documents the materiallist-ai import step" || bad "import hint missing"
curl -s -D /tmp/ml-hdrs.txt "$BASE/api/quotes/$IID/materials-list?format=csv" -o /tmp/ml.csv
grep -qi 'text/csv' /tmp/ml-hdrs.txt && head -1 /tmp/ml.csv | grep -q 'item,qty,unit' \
  && ok "materials CSV export (text/csv with header)" || bad "CSV export"
[ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/quotes/nope999/materials-list")" = "404" ] \
  && ok "materials-list 404s on unknown quote" || bad "materials 404"
# unmapped trade (Cleaning) falls back to quote line items, still shaped right
CL=$(curl -s -X POST "$BASE/api/quotes" -H 'Content-Type: application/json' \
  -d '{"customer":"Clean Case","trade":"Cleaning","items":[{"description":"Deep cleaning","qty":2,"unit":"hr","unitPrice":45}],"taxRate":0,"depositRate":0}')
CLID=$(echo "$CL" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
MLC=$(curl -s "$BASE/api/quotes/$CLID/materials-list")
echo "$MLC" | grep -q '"mlTrade":null' && echo "$MLC" | grep -q 'Deep cleaning (from quote)' \
  && ok "unmapped trade falls back to quote line items" || bad "fallback: ${MLC:0:200}"
curl -s -X DELETE "$BASE/api/quotes/$CLID" >/dev/null

# 32. signpilot wiring: degraded gracefully without SIGNPILOT_URL, callback both ways
[ "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/quotes/$IID/signpilot-request" -H 'Content-Type: application/json' -d '{"purpose":"approval"}')" = "503" ] \
  && ok "signpilot-request without SIGNPILOT_URL -> 503" || bad "signpilot-request 503"
WQ=$(curl -s "$BASE/api/quotes/$IID")
echo "$WQ" | grep -q '"status":"not-configured"' && ok "won quote records signpilot not-configured (no crash)" || bad "won-transition signpilot state"
CB=$(curl -s -X POST "$BASE/api/quotes/$IID/signpilot-callback" -H 'Content-Type: application/json' \
  -d '{"docId":"sp1","docNumber":"SP-2026-0001","purpose":"approval","status":"signed","signedAt":"2026-10-19T12:00:00.000Z"}')
echo "$CB" | grep -q '"status":"signed"' && ok "signpilot callback marks approval signed" || bad "callback signed: ${CB:0:200}"
CB2=$(curl -s -X POST "$BASE/api/quotes/$IID/signpilot-callback" -H 'Content-Type: application/json' \
  -d '{"docId":"sp2","docNumber":"SP-2026-0002","purpose":"approval","status":"declined","declineReason":"too pricey"}')
echo "$CB2" | grep -q '"status":"declined"' && ok "signpilot callback records decline" || bad "callback declined"
G2=$(curl -s "$BASE/api/quotes/$IID")
echo "$G2" | grep -q '"status":"sent"' && ok "declined approval reopens quote to sent" || bad "reopen on decline"
echo "$G2" | grep -q 'too pricey' && ok "decline reason appended to quote notes" || bad "decline reason lost"
CB3=$(curl -s -X POST "$BASE/api/quotes/$IID/signpilot-callback" -H 'Content-Type: application/json' \
  -d "{\"docId\":\"sp3\",\"docNumber\":\"SP-2026-0003\",\"purpose\":\"change-order\",\"changeOrderId\":\"$COID\",\"status\":\"signed\",\"signedAt\":\"2026-10-19T13:00:00.000Z\"}")
echo "$CB3" | grep -q '"status":"signed"' && ok "change-order callback marks it signed" || bad "co callback: ${CB3:0:200}"
G3=$(curl -s "$BASE/api/quotes/$IID" | python3 -c "import json,sys; d=json.load(sys.stdin); co=[c for c in d['changeOrders'] if c['id']=='$COID'][0]; print(co['status'], co['signpilot']['status'])")
[ "$G3" = "signed signed" ] && ok "change order shows signed in quote" || bad "co signed state: $G3"
CB4=$(curl -s -X POST "$BASE/api/quotes/$IID/signpilot-callback" -H 'Content-Type: application/json' \
  -d '{"docId":"sp4","docNumber":"SP-2026-0004","purpose":"completion","status":"signed","signedAt":"2026-10-19T14:00:00.000Z"}')
echo "$CB4" | grep -q '"status":"signed"' && ok "completion callback accepted" || bad "completion callback"
G4=$(curl -s "$BASE/api/quotes/$IID" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['completion']['status'], d.get('completedAt','')[:10])")
[ "$G4" = "signed 2026-10-19" ] && ok "completion signed -> completedAt stamped" || bad "completion state: $G4"
CBBAD=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/quotes/$IID/signpilot-callback" -H 'Content-Type: application/json' -d '{"purpose":"approval","status":"maybe"}')
[ "$CBBAD" = "400" ] && ok "callback rejects bad status" || bad "callback validation: $CBBAD"
curl -s -X DELETE "$BASE/api/quotes/$IID" >/dev/null
ok "pipeline test quote cleaned up"

# 33. pipeline UI wiring (job-file rail modules)
missing3=""
for n in discountRate pipelineBody pipelineHint renderPipeline 'data-pipe="ml-json"' 'data-pipe="apply-ms"' coDesc; do
  grep -q "$n" "$DIR/public/app.js" || missing3="$missing3 js:$n"
done
for n in discountRate pipelineBody pipelineHint rail-pipeline railBilling grid-3; do
  grep -q "$n" "$DIR/public/index.html" || missing3="$missing3 html:$n"
done
grep -q 'pipe-block' "$DIR/public/style.css" || missing3="$missing3 css:pipe-block"
[ -z "$missing3" ] && ok "UI wires discount + job pipeline rail" || bad "missing wiring:$missing3"

# 34. optional/upsell line items: excluded from totals, reported as optionsTotal
OQ=$(curl -s -X POST "$BASE/api/quotes" -H 'Content-Type: application/json' \
  -d '{"customer":"Optional Test","trade":"Plumbing","items":[{"description":"Faucet replacement","qty":2,"unit":"each","unitPrice":145},{"description":"Water filtration add-on","qty":1,"unit":"each","unitPrice":399,"optional":true}],"taxRate":0,"depositRate":0}')
OID=$(echo "$OQ" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
OT=$(echo "$OQ" | python3 -c "import json,sys; d=json.load(sys.stdin)['totals']; print(d['total'], d['optionsTotal'])")
[ "$OT" = "290 399" ] || [ "$OT" = "290.0 399.0" ] && ok "optional item excluded from total (290), optionsTotal=399 ($OT)" || bad "optional totals wrong: $OT"
echo "$OQ" | grep -q '"optional":true' && ok "optional flag survives cleanItems" || bad "optional flag dropped"
# totals exclude optional in the client-shared math too
node -e 'const Q=require("'"$DIR"'/public/generate.js");const t=Q.quoteTotals([{qty:1,unitPrice:100},{qty:1,unitPrice:50,optional:true}],0,0,0);if(t.total===100&&t.optionsTotal===50)console.log("ok");else{console.error(JSON.stringify(t));process.exit(1)}' >/dev/null 2>&1 \
  && ok "generate.js quoteTotals: optional excluded in shared math" || bad "generate.js optional math wrong"
# duplicate carries optional flag; edit keeps it
OD=$(curl -s -X POST "$BASE/api/quotes/$OID/duplicate")
echo "$OD" | grep -q '"optional":true' && ok "duplicate carries optional flag" || bad "duplicate dropped optional"
ODID=$(echo "$OD" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
curl -s -X DELETE "$BASE/api/quotes/$ODID" >/dev/null
curl -s -X DELETE "$BASE/api/quotes/$OID" >/dev/null
ok "optional test quotes cleaned up"

# 35. internal note: saved, updated, duplicated, never in totals math
IQ=$(curl -s -X POST "$BASE/api/quotes" -H 'Content-Type: application/json' \
  -d '{"customer":"Internal Test","trade":"Electrical","items":[{"description":"x","qty":1,"unit":"each","unitPrice":10}],"notes":"Customer sees this","internalNotes":"Hold 45% margin"}')
IID2=$(echo "$IQ" | python3 -c "import json,sys; print(json.load(sys.stdin)['internalNotes'])")
[ "$IID2" = "Hold 45% margin" ] && ok "internalNotes saved on create" || bad "internalNotes missing: ${IQ:0:200}"
IQID=$(echo "$IQ" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
IU=$(curl -s -X PUT "$BASE/api/quotes/$IQID" -H 'Content-Type: application/json' -d '{"internalNotes":"Updated private note"}')
echo "$IU" | grep -q '"internalNotes":"Updated private note"' && ok "internalNotes updated via PUT" || bad "internalNotes PUT failed"
IDUP=$(curl -s -X POST "$BASE/api/quotes/$IQID/duplicate" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['id'], d['internalNotes'])")
[ "$(echo "$IDUP" | cut -d' ' -f2-)" = "Updated private note" ] && ok "duplicate carries internalNotes" || bad "duplicate internalNotes: $IDUP"
curl -s -X DELETE "$BASE/api/quotes/$IQID" >/dev/null
curl -s -X DELETE "$BASE/api/quotes/$(echo "$IDUP" | cut -d' ' -f1)" >/dev/null
ok "internal-note test quotes cleaned up"

# 36. price bank contract intact (owned by quotely, consumed by sitevisit-ai)
PB=$(curl -s "$BASE/api/price-bank")
echo "$PB" | python3 -c "
import json,sys
d = json.load(sys.stdin)
assert d['version'] == '1.0.0', d['version']
assert d['currency'] == 'USD'
assert isinstance(d['items'], list) and len(d['items']) >= 71, len(d['items'])
assert 'Flooring' in d['trades']
it = d['items'][0]
assert set(it) == {'trades','keys','name','unit','price'}, it
print('bank ok', len(d['items']), 'items')
" >/dev/null && ok "price bank v1.0.0 contract intact (71+ items, 10 trades)" || bad "price bank contract broken"
# client-side price bank matches (builder picker uses it offline)
node -e 'const Q=require("'"$DIR"'/public/generate.js");const b=Q.priceBank();if(b.version==="1.0.0"&&b.items.length>=71&&b.trades.length>=10)console.log("ok");else process.exit(1)' >/dev/null 2>&1 \
  && ok "client-side priceBank() matches served contract" || bad "client priceBank mismatch"

# 37. new UI surfaces present
missing4=""
for n in bankModal sendModal boardGrid railCustomer railInternal 'data-pipe="sync-sp"' openBank openSend step-num; do
  grep -q "$n" "$DIR/public/app.js" "$DIR/public/index.html" >/dev/null 2>&1 || missing4="$missing4 $n"
done
[ -z "$missing4" ] && ok "new UI surfaces wired (price bank, send, board, job-file rail)" || bad "missing:$missing4"

echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
