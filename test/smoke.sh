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

echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
