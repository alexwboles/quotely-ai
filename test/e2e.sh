#!/usr/bin/env bash
# e2e.sh — 7 end-to-end flows against a live server on a scratch port.
set -u
DIR="$(cd "$(dirname "$0")/.." && pwd)"
export PORT=3458
BASE="http://localhost:$PORT"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  PASS: $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }

echo "== Quotely AI end-to-end tests =="

# keep any real data safe
BACKUP=""
if [ -f "$DIR/data/quotes.json" ]; then
  BACKUP=/tmp/quotely-data-backup.json
  cp "$DIR/data/quotes.json" "$BACKUP"
fi
rm -f "$DIR/data/quotes.json"

start_srv() {
  node "$DIR/server.js" >/tmp/quotely-e2e.log 2>&1 &
  SRV=$!
  sleep 1
  kill -0 $SRV 2>/dev/null || { bad "server failed to boot"; cat /tmp/quotely-e2e.log; return 1; }
}
stop_srv() { kill $SRV 2>/dev/null; wait $SRV 2>/dev/null; }
trap 'stop_srv 2>/dev/null; [ -n "$BACKUP" ] && cp "$BACKUP" "$DIR/data/quotes.json"; rm -f "$DIR/data/quotes.json.tmp" 2>/dev/null' EXIT

start_srv || { echo "RESULT: $PASS passed, $FAIL failed"; exit 1; }

# ---- Flow 1: generate -> save -> sent -> won (full lifecycle) ----
G=$(curl -s -X POST "$BASE/api/generate" -H 'Content-Type: application/json' \
  -d '{"description":"Paint 3 bedrooms and fix drywall in hallway","trade":"Painting"}')
ITEMS=$(echo "$G" | python3 -c "import json,sys; print(json.dumps(json.load(sys.stdin)['items']))")
N=$(echo "$ITEMS" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))")
[ "$N" -ge 2 ] && ok "flow1: painting job -> $N line items (painting + drywall)" || bad "flow1: only $N items: ${G:0:200}"
Q1=$(curl -s -X POST "$BASE/api/quotes" -H 'Content-Type: application/json' \
  -d "{\"customer\":\"Bob Jones\",\"phone\":\"555-0100\",\"trade\":\"Painting\",\"description\":\"Paint 3 bedrooms\",\"items\":$ITEMS,\"taxRate\":0,\"depositRate\":50,\"followUp\":\"2026-09-30\",\"notes\":\"2 coats\"}")
ID1=$(echo "$Q1" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
NUM1=$(echo "$Q1" | python3 -c "import json,sys; print(json.load(sys.stdin)['number'])")
TOT1=$(echo "$Q1" | python3 -c "import json,sys; print(json.load(sys.stdin)['totals']['total'])")
[ -n "$ID1" ] && ok "flow1: saved quote $NUM1 total \$$TOT1" || bad "flow1: save failed: ${Q1:0:200}"
curl -s -X PUT "$BASE/api/quotes/$ID1" -H 'Content-Type: application/json' -d '{"status":"sent"}' >/dev/null
curl -s -X PUT "$BASE/api/quotes/$ID1" -H 'Content-Type: application/json' -d '{"status":"won"}' >/dev/null
S=$(curl -s "$BASE/api/quotes" | python3 -c "import json,sys; d=json.load(sys.stdin); print([x['status'] for x in d if x['id']=='$ID1'][0])")
[ "$S" = "won" ] && ok "flow1: draft -> sent -> won lifecycle" || bad "flow1: status is $S"

# ---- Flow 2: unknown job -> fallback item -> number increments ----
G2=$(curl -s -X POST "$BASE/api/generate" -H 'Content-Type: application/json' \
  -d '{"description":"organize my garage shelves and label the boxes","trade":"General Handyman"}')
SRC2=$(echo "$G2" | python3 -c "import json,sys; print(json.load(sys.stdin)['source'])")
[ "$SRC2" = "local" ] && ok "flow2: no API key -> local engine (source=$SRC2)" || bad "flow2: source=$SRC2"
Q2=$(curl -s -X POST "$BASE/api/quotes" -H 'Content-Type: application/json' \
  -d '{"customer":"Amy Wu","trade":"General Handyman","description":"organize garage","items":[{"description":"Garage organization labor","qty":4,"unit":"hr","unitPrice":45}],"taxRate":0,"depositRate":0}')
ID2=$(echo "$Q2" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
NUM2=$(echo "$Q2" | python3 -c "import json,sys; print(json.load(sys.stdin)['number'])")
[ "$NUM2" != "$NUM1" ] && ok "flow2: quote number incremented ($NUM1 -> $NUM2)" || bad "flow2: numbers not unique: $NUM1 $NUM2"

# ---- Flow 3: editing items recomputes totals ----
U3=$(curl -s -X PUT "$BASE/api/quotes/$ID2" -H 'Content-Type: application/json' \
  -d '{"items":[{"description":"Garage organization labor","qty":6,"unit":"hr","unitPrice":45}]}')
TOT3=$(echo "$U3" | python3 -c "import json,sys; print(json.load(sys.stdin)['totals']['total'])")
[ "$TOT3" = "270" ] || [ "$TOT3" = "270.0" ] && ok "flow3: qty 4->6 recomputes total to \$$TOT3" || bad "flow3: total=$TOT3 (want 270)"

# ---- Flow 4: follow-up date persists ----
F4=$(curl -s "$BASE/api/quotes" | python3 -c "import json,sys; d=json.load(sys.stdin); print([x['followUp'] for x in d if x['id']=='$ID1'][0])")
[ "$F4" = "2026-09-30" ] && ok "flow4: follow-up date persisted ($F4)" || bad "flow4: followUp=$F4"

# ---- Flow 5: robustness — empty generate, bad status ignored ----
G5=$(curl -s -X POST "$BASE/api/generate" -H 'Content-Type: application/json' -d '{}')
echo "$G5" | grep -q '"items":' && ok "flow5: empty generate body -> 200 with items key" || bad "flow5: $G5"
U5=$(curl -s -X PUT "$BASE/api/quotes/$ID1" -H 'Content-Type: application/json' -d '{"status":"bogus"}')
S5=$(echo "$U5" | python3 -c "import json,sys; print(json.load(sys.stdin)['status'])")
[ "$S5" = "won" ] && ok "flow5: invalid status ignored (still won)" || bad "flow5: status=$S5"
N404=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/quotes/nope123")
[ "$N404" = "404" ] && ok "flow5: unknown quote id -> 404" || bad "flow5: http=$N404"

# ---- Flow 6: data survives server restart ----
stop_srv
start_srv
R6=$(curl -s "$BASE/api/quotes" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))")
[ "$R6" = "2" ] && ok "flow6: 2 quotes survive restart (data/quotes.json)" || bad "flow6: found $R6 quotes after restart"

# ---- Flow 8: photos persist across restart ----
PIX8="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
P8=$(curl -s -X POST "$BASE/api/quotes" -H 'Content-Type: application/json' \
  -d "{\"customer\":\"Photo Persist\",\"trade\":\"Roofing\",\"items\":[{\"description\":\"x\",\"qty\":1,\"unit\":\"each\",\"unitPrice\":5}],\"photos\":[{\"dataUrl\":\"$PIX8\",\"caption\":\"Roof\",\"tag\":\"before\"}]}")
ID8=$(echo "$P8" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
stop_srv
start_srv
C8=$(curl -s "$BASE/api/quotes" | python3 -c "import json,sys; d=json.load(sys.stdin); q=[x for x in d if x['id']=='$ID8'][0]; print(len(q['photos']), q['photos'][0]['caption'])")
[ "$C8" = "1 Roof" ] && ok "flow8: photo persists across restart with caption" || bad "flow8: $C8"
curl -s -X DELETE "$BASE/api/quotes/$ID8" >/dev/null

# ---- Flow 9: templates — save, apply, delete ----
T9=$(curl -s -X POST "$BASE/api/templates" -H 'Content-Type: application/json' \
  -d '{"name":"E2E Faucet Job","trade":"Plumbing","items":[{"description":"Faucet swap","qty":2,"unit":"each","unitPrice":145}]}')
TID9=$(echo "$T9" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
[ -n "$TID9" ] && ok "flow9: template saved ($TID9)" || bad "flow9: template save failed"
TN9=$(curl -s "$BASE/api/templates" | python3 -c "import json,sys; d=json.load(sys.stdin); t=[x for x in d if x['id']=='$TID9'][0]; print(t['name'], len(t['items']), t['items'][0]['unitPrice'])")
[ "$TN9" = "E2E Faucet Job 1 145" ] && ok "flow9: template round-trips with items" || bad "flow9: $TN9"
curl -s -X DELETE "$BASE/api/templates/$TID9" >/dev/null
TD9=$(curl -s "$BASE/api/templates" | python3 -c "import json,sys; print(len([x for x in json.load(sys.stdin) if x['id']=='$TID9']))")
[ "$TD9" = "0" ] && ok "flow9: template deleted" || bad "flow9: template remains"

# ---- Flow 10: version history snapshots edits and restores ----
Q10=$(curl -s -X POST "$BASE/api/quotes" -H 'Content-Type: application/json' \
  -d '{"customer":"Hist Test","trade":"Electrical","items":[{"description":"Outlet swap","qty":4,"unit":"each","unitPrice":65}],"taxRate":0,"depositRate":0}')
ID10=$(echo "$Q10" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
curl -s -X PUT "$BASE/api/quotes/$ID10" -H 'Content-Type: application/json' \
  -d '{"items":[{"description":"Outlet swap","qty":4,"unit":"each","unitPrice":75}]}' >/dev/null
H10=$(curl -s "$BASE/api/quotes" | python3 -c "import json,sys; d=json.load(sys.stdin); q=[x for x in d if x['id']=='$ID10'][0]; print(len(q['history']), q['history'][0]['items'][0]['unitPrice'], q['totals']['total'])")
[ "$H10" = "1 65 300" ] || [ "$H10" = "1 65 300.0" ] && ok "flow10: edit snapshots old price 65, new total 300" || bad "flow10: $H10"
R10=$(curl -s -X POST "$BASE/api/quotes/$ID10/restore" -H 'Content-Type: application/json' -d '{"index":0}')
RT10=$(echo "$R10" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['totals']['total'], len(d['history']))")
[ "$RT10" = "260 2" ] || [ "$RT10" = "260.0 2" ] && ok "flow10: restore reverts to 260 and keeps current as version" || bad "flow10: restore=$RT10"
curl -s -X DELETE "$BASE/api/quotes/$ID10" >/dev/null

# ---- Flow 11: customers directory aggregates lifetime value ----
C11=$(curl -s "$BASE/api/customers" | python3 -c "
import json,sys
d = json.load(sys.stdin)
b = [x for x in d if x['name']=='Bob Jones']
a = [x for x in d if x['name']=='Amy Wu']
print(len(d), b[0]['quotes'] if b else 0, b[0]['won'] if b else 0, a[0]['quotes'] if a else 0)
")
[ "$C11" = "2 1 1 1" ] && ok "flow11: customers directory (Bob: 1 quote won, Amy: 1 quote)" || bad "flow11: $C11"

# ---- Flow 12: terms + duplicate lifecycle ----
Q12=$(curl -s -X POST "$BASE/api/quotes" -H 'Content-Type: application/json' \
  -d '{"customer":"E2E Terms","trade":"Electrical","description":"Rewire garage","items":[{"description":"Rewire","qty":1,"unit":"job","unitPrice":800}],"taxRate":0,"depositRate":25,"paymentTerms":"Net 15","warranty":"Lifetime on labor"}')
ID12=$(echo "$Q12" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
NUM12=$(echo "$Q12" | python3 -c "import json,sys; print(json.load(sys.stdin)['number'])")
echo "$Q12" | grep -q '"paymentTerms":"Net 15"' && ok "flow12: terms saved on create" || bad "flow12: terms missing"
D12=$(curl -s -X POST "$BASE/api/quotes/$ID12/duplicate")
DID12=$(echo "$D12" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
DNUM12=$(echo "$D12" | python3 -c "import json,sys; print(json.load(sys.stdin)['number'])")
DWAR12=$(echo "$D12" | python3 -c "import json,sys; print(json.load(sys.stdin)['warranty'])")
echo "$D12" | grep -q '"status":"draft"' && [ "$DID12" != "$ID12" ] && [ "$DNUM12" != "$NUM12" ] \
  && [ "$DWAR12" = "Lifetime on labor" ] && ok "flow12: duplicate fresh draft, new number, terms carried over" \
  || bad "flow12: duplicate wrong: ${D12:0:300}"
# expiry: backdate createdAt in storage to force expiry, then confirm logic flags it
python3 -c "
import json
p = '$DIR/data/quotes.json'
d = json.load(open(p))
for q in d:
    if q['id'] == '$ID12':
        q['createdAt'] = '2026-01-01T00:00:00.000Z'
        q['status'] = 'sent'
json.dump(d, open(p, 'w'))
"
curl -s "$BASE/api/quotes" > /tmp/quotely-q12.json
cat > /tmp/quotely-expiry-check.js <<JSEOF
const Q = require("$DIR/public/generate.js");
const q = JSON.parse(process.argv[2]);
console.log(Q.quoteExpiryISO(q) + " " + Q.isQuoteExpired(q));
JSEOF
EX12=$(python3 -c "
import json, subprocess
d = json.load(open('/tmp/quotely-q12.json'))
q = [x for x in d if x['id'] == '$ID12'][0]
gen = subprocess.run(['node', '/tmp/quotely-expiry-check.js', json.dumps(q)], capture_output=True, text=True)
print(gen.stdout.strip())
")
[ "$EX12" = "2026-01-31 true" ] && ok "flow12: backdated sent quote flags expired" || bad "flow12: expiry=$EX12"
curl -s -X DELETE "$BASE/api/quotes/$ID12" >/dev/null
curl -s -X DELETE "$BASE/api/quotes/$DID12" >/dev/null

# ---- Flow 7: delete cleans up ----
curl -s -X DELETE "$BASE/api/quotes/$ID1" >/dev/null
curl -s -X DELETE "$BASE/api/quotes/$ID2" >/dev/null
R7=$(curl -s "$BASE/api/quotes" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))")
[ "$R7" = "0" ] && ok "flow7: both quotes deleted, list empty" || bad "flow7: $R7 quotes remain"

echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
