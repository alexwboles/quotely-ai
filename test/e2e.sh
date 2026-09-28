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

# ---- Flow 7: delete cleans up ----
curl -s -X DELETE "$BASE/api/quotes/$ID1" >/dev/null
curl -s -X DELETE "$BASE/api/quotes/$ID2" >/dev/null
R7=$(curl -s "$BASE/api/quotes" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))")
[ "$R7" = "0" ] && ok "flow7: both quotes deleted, list empty" || bad "flow7: $R7 quotes remain"

echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
