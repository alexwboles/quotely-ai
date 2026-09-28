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
echo "$T" | grep -q '<title>Quotely AI' && ok "GET / serves index.html" || bad "index not served"
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

echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
