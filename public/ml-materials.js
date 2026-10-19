/* Vendored from materiallist-ai/js/materials.js (MIT, alexwboles/materiallist-ai).
 * READ-ONLY COPY — do not edit here; edit the materiallist-ai repo instead and re-vendor.
 * Used by quotely-ai's one-click materials-list export (GET /api/quotes/:id/materials-list).
 * materiallist-ai itself is never modified by quotely-ai (contract reference only).
 */
/* materiallist-ai materials engine
 * TRADES: 9 trade banks (keyword -> materials)
 * parseQuantities(text): extract sq ft / linear ft / room counts
 * generateList({jobText, trade}): keyword-matched takeoff with scaled quantities
 * applyWaste(items, pct): 0 / 10 / 15 % waste factors
 * estimateCost(items): line totals + grand total
 * Pure logic, no DOM. Loadable in browser and Node.
 */
(function (g) {
  'use strict';
  var ML = g.ML = g.ML || {};

  // Material entry: { name, unit, unitPrice, qty, per, perQty, match, staple, note }
  // per: 'job' (flat), 'sqft' (qty = perQty * parsed sqft), 'room' (perQty * rooms),
  //      'ft' (perQty * parsed linear ft). Falls back to `qty` when no quantity parsed.
  var TRADES = {
    electrical: {
      label: 'Electrical',
      materials: [
        { name: '12/2 NM-B cable', unit: 'ft', unitPrice: 0.85, qty: 50, per: 'ft', perQty: 8, staple: true,
          match: ['wire', 'wiring', 'cable', 'rewire', 'circuit', 'run'],
          note: 'Home runs + device loops' },
        { name: 'Duplex receptacle 15A', unit: 'each', unitPrice: 4.49, qty: 6, per: 'room', perQty: 4,
          match: ['outlet', 'receptacle', 'plug'],
          note: 'Tamper-resistant, spec grade' },
        { name: 'Single-pole light switch', unit: 'each', unitPrice: 3.79, qty: 3, per: 'room', perQty: 2,
          match: ['switch', 'dimmer'],
          note: '' },
        { name: '4 in octagon junction box', unit: 'each', unitPrice: 3.29, qty: 4, per: 'room', perQty: 2,
          match: ['box', 'junction'],
          note: 'With cover + clamps' },
        { name: '6 in LED recessed light', unit: 'each', unitPrice: 24.99, qty: 6, per: 'room', perQty: 6,
          match: ['recessed', 'can light', 'downlight', 'pot light'],
          note: 'IC-rated, selectable color temp' },
        { name: '20A AFCI breaker', unit: 'each', unitPrice: 48.99, qty: 2, per: 'job', perQty: 0,
          match: ['breaker', 'panel', 'subpanel'],
          note: 'Match panel brand' },
        { name: 'Wire nuts (100-pack)', unit: 'pack', unitPrice: 9.99, qty: 1, per: 'job', perQty: 0, staple: true,
          match: ['wire nut', 'connector'],
          note: 'Assorted sizes' },
        { name: 'Electrical tape', unit: 'each', unitPrice: 3.49, qty: 2, per: 'job', perQty: 0,
          match: ['tape'],
          note: '' }
      ]
    },
    plumbing: {
      label: 'Plumbing',
      materials: [
        { name: '1/2 in PEX tubing', unit: 'ft', unitPrice: 0.62, qty: 40, per: 'ft', perQty: 6, staple: true,
          match: ['pex', 'water line', 'supply line', 'repipe', 'pipe'],
          note: 'Red/blue pair for hot/cold' },
        { name: 'PEX crimp fittings kit', unit: 'each', unitPrice: 29.99, qty: 1, per: 'job', perQty: 0,
          match: ['fitting', 'pex'],
          note: 'Elbows, tees, couplings' },
        { name: 'PEX crimp rings (50-pack)', unit: 'pack', unitPrice: 14.99, qty: 1, per: 'job', perQty: 0,
          match: ['crimp', 'ring'],
          note: '' },
        { name: 'Shut-off valve 1/2 in', unit: 'each', unitPrice: 8.49, qty: 2, per: 'room', perQty: 2,
          match: ['valve', 'shut-off', 'shutoff'],
          note: 'Quarter-turn ball type' },
        { name: 'P-trap assembly 1-1/2 in', unit: 'each', unitPrice: 7.99, qty: 1, per: 'room', perQty: 1,
          match: ['trap', 'drain', 'sink'],
          note: 'With tailpiece washer' },
        { name: 'Toilet wax ring + bolts', unit: 'each', unitPrice: 6.29, qty: 1, per: 'room', perQty: 1,
          match: ['toilet', 'wax ring', 'commode'],
          note: 'Extra-thick ring' },
        { name: 'Pipe thread sealant tape', unit: 'each', unitPrice: 2.99, qty: 2, per: 'job', perQty: 0, staple: true,
          match: ['teflon', 'thread tape'],
          note: '' },
        { name: 'PVC primer + cement set', unit: 'each', unitPrice: 12.99, qty: 1, per: 'job', perQty: 0,
          match: ['pvc', 'drain pipe'],
          note: 'For DWV connections' }
      ]
    },
    hvac: {
      label: 'HVAC',
      materials: [
        { name: 'Flexible duct 8 in x 25 ft', unit: 'each', unitPrice: 42.99, qty: 2, per: 'room', perQty: 1, staple: true,
          match: ['duct', 'ductwork', 'flex'],
          note: 'R-6 insulated' },
        { name: 'Sheet metal screws (#8 x 1/2 in, box)', unit: 'box', unitPrice: 8.99, qty: 1, per: 'job', perQty: 0,
          match: ['screw', 'sheet metal'],
          note: 'Hex-head, zip-in' },
        { name: 'Foil duct tape', unit: 'each', unitPrice: 11.99, qty: 2, per: 'job', perQty: 0, staple: true,
          match: ['foil tape', 'duct tape', 'seal'],
          note: 'UL 181 rated' },
        { name: 'Duct mastic (1 gal)', unit: 'gallon', unitPrice: 24.99, qty: 1, per: 'job', perQty: 0,
          match: ['mastic', 'sealant'],
          note: 'Brush-on air seal' },
        { name: 'Supply register 4x10 in', unit: 'each', unitPrice: 9.49, qty: 2, per: 'room', perQty: 2,
          match: ['register', 'vent', 'grille'],
          note: 'White, adjustable damper' },
        { name: 'Return air filter grille', unit: 'each', unitPrice: 34.99, qty: 1, per: 'job', perQty: 0,
          match: ['return', 'filter grille'],
          note: 'Match filter size' },
        { name: 'Condensate drain line 3/4 in PVC (10 ft)', unit: 'each', unitPrice: 6.49, qty: 1, per: 'job', perQty: 0,
          match: ['condensate', 'drain line', 'ac drain'],
          note: 'With trap + cleanout' },
        { name: 'Line set insulation 3/4 in x 6 ft', unit: 'each', unitPrice: 7.99, qty: 2, per: 'job', perQty: 0,
          match: ['line set', 'refrigerant', 'insulation'],
          note: 'UV-resistant' }
      ]
    },
    carpentry: {
      label: 'Carpentry / Framing',
      materials: [
        { name: '2x4 x 8 ft stud (SPF)', unit: 'each', unitPrice: 4.29, qty: 20, per: 'ft', perQty: 1.4, staple: true,
          match: ['stud', 'framing', 'frame', 'wall'],
          note: '16 in on-center layout' },
        { name: '2x6 x 8 ft lumber', unit: 'each', unitPrice: 8.79, qty: 6, per: 'ft', perQty: 0.4,
          match: ['2x6', 'header', 'beam'],
          note: 'Headers + load points' },
        { name: '3/4 in plywood subfloor (4x8)', unit: 'sheet', unitPrice: 34.99, qty: 3, per: 'sqft', perQty: 0.03125,
          match: ['plywood', 'subfloor', 'sheathing'],
          note: 'T&G, glue + screw' },
        { name: 'Base cabinet 24 in', unit: 'each', unitPrice: 189.99, qty: 2, per: 'room', perQty: 2,
          match: ['cabinet', 'kitchen', 'vanity'],
          note: 'Unfinished stock size' },
        { name: 'Wall cabinet 30 in', unit: 'each', unitPrice: 129.99, qty: 2, per: 'room', perQty: 2,
          match: ['cabinet', 'kitchen', 'upper'],
          note: 'Unfinished stock size' },
        { name: 'Butcher block countertop 8 ft', unit: 'each', unitPrice: 249.99, qty: 1, per: 'room', perQty: 1,
          match: ['countertop', 'counter', 'kitchen'],
          note: 'Seal before install' },
        { name: '16d framing nails (5 lb box)', unit: 'box', unitPrice: 12.99, qty: 1, per: 'job', perQty: 0, staple: true,
          match: ['nail', 'framing nail'],
          note: 'Hot-dip galvanized' },
        { name: 'Construction adhesive (28 oz tube)', unit: 'tube', unitPrice: 7.49, qty: 3, per: 'job', perQty: 0,
          match: ['adhesive', 'liquid nails', 'glue'],
          note: '' }
      ]
    },
    drywall: {
      label: 'Drywall / Painting',
      materials: [
        { name: '1/2 in drywall sheet (4x8)', unit: 'sheet', unitPrice: 14.99, qty: 6, per: 'sqft', perQty: 0.03125, staple: true,
          match: ['drywall', 'sheetrock', 'gypsum', 'wall'],
          note: '32 sq ft coverage per sheet' },
        { name: 'Joint compound (4.5 gal)', unit: 'each', unitPrice: 21.99, qty: 1, per: 'job', perQty: 0,
          match: ['mud', 'joint compound', 'spackle'],
          note: 'All-purpose, 3-coat system' },
        { name: 'Paper drywall tape (250 ft)', unit: 'roll', unitPrice: 6.99, qty: 1, per: 'job', perQty: 0,
          match: ['tape', 'joint tape'],
          note: '' },
        { name: 'Coarse drywall screws 1-1/4 in (5 lb)', unit: 'box', unitPrice: 16.99, qty: 1, per: 'job', perQty: 0, staple: true,
          match: ['drywall screw', 'screw'],
          note: '' },
        { name: 'Interior latex paint (1 gal)', unit: 'gallon', unitPrice: 42.99, qty: 2, per: 'sqft', perQty: 0.0029,
          match: ['paint', 'painting', 'primer'],
          note: '~350 sq ft per gallon' },
        { name: 'PVA drywall primer (1 gal)', unit: 'gallon', unitPrice: 24.99, qty: 1, per: 'job', perQty: 0,
          match: ['primer'],
          note: 'Seals new mud' },
        { name: '9 in roller covers (3-pack)', unit: 'pack', unitPrice: 11.99, qty: 1, per: 'job', perQty: 0,
          match: ['roller', 'brush'],
          note: '3/8 in nap' },
        { name: "Painter's tape 1.5 in", unit: 'each', unitPrice: 8.49, qty: 2, per: 'job', perQty: 0,
          match: ['masking', "painter's tape"],
          note: '' }
      ]
    },
    roofing: {
      label: 'Roofing',
      materials: [
        { name: 'Architectural shingles (bundle)', unit: 'bundle', unitPrice: 36.99, qty: 6, per: 'sqft', perQty: 0.0104, staple: true,
          match: ['shingle', 'roof', 'reroof'],
          note: '3 bundles = 1 square' },
        { name: 'Synthetic underlayment (10 sq roll)', unit: 'roll', unitPrice: 89.99, qty: 1, per: 'sqft', perQty: 0.001,
          match: ['underlayment', 'felt', 'tar paper'],
          note: '10-square coverage' },
        { name: 'Ice & water shield (2 sq roll)', unit: 'roll', unitPrice: 74.99, qty: 1, per: 'job', perQty: 0,
          match: ['ice', 'water shield', 'valley'],
          note: 'Eaves + valleys' },
        { name: 'Roofing nails 1-1/4 in (coil)', unit: 'box', unitPrice: 24.99, qty: 1, per: 'job', perQty: 0, staple: true,
          match: ['roofing nail', 'nail'],
          note: 'Galvanized coil nails' },
        { name: 'Drip edge 10 ft (white)', unit: 'each', unitPrice: 9.99, qty: 4, per: 'ft', perQty: 0.1,
          match: ['drip edge', 'flashing'],
          note: 'Eaves + rakes' },
        { name: 'Ridge cap shingles (bundle)', unit: 'bundle', unitPrice: 42.99, qty: 1, per: 'job', perQty: 0,
          match: ['ridge', 'cap'],
          note: 'Match shingle color' },
        { name: 'Roof vent / turtle vent', unit: 'each', unitPrice: 18.99, qty: 2, per: 'job', perQty: 0,
          match: ['vent', 'ventilation'],
          note: '1 per 300 sq ft attic' },
        { name: 'Roofing cement (1 gal)', unit: 'gallon', unitPrice: 14.99, qty: 1, per: 'job', perQty: 0,
          match: ['cement', 'tar', 'sealant'],
          note: 'Flashing touch-ups' }
      ]
    },
    flooring: {
      label: 'Flooring',
      materials: [
        { name: 'Luxury vinyl plank (per sq ft)', unit: 'sq ft', unitPrice: 3.29, qty: 100, per: 'sqft', perQty: 1, staple: true,
          match: ['vinyl', 'lvp', 'plank', 'laminate', 'floor'],
          note: '20 mil wear layer' },
        { name: 'Underlayment roll (100 sq ft)', unit: 'roll', unitPrice: 34.99, qty: 1, per: 'sqft', perQty: 0.01,
          match: ['underlayment', 'pad', 'underlay'],
          note: 'Moisture barrier type' },
        { name: 'Quarter-round molding 8 ft', unit: 'each', unitPrice: 7.19, qty: 4, per: 'ft', perQty: 0.125,
          match: ['quarter round', 'molding', 'trim', 'baseboard'],
          note: 'Match floor tone' },
        { name: 'Transition strip (T-mold)', unit: 'each', unitPrice: 16.99, qty: 2, per: 'room', perQty: 1,
          match: ['transition', 'threshold', 't-mold'],
          note: 'Per doorway' },
        { name: 'Flooring spacers (bag of 100)', unit: 'bag', unitPrice: 5.99, qty: 1, per: 'job', perQty: 0, staple: true,
          match: ['spacer'],
          note: '1/4 in expansion gap' },
        { name: 'Tapping block + pull bar kit', unit: 'each', unitPrice: 14.99, qty: 1, per: 'job', perQty: 0,
          match: ['tapping', 'install kit'],
          note: 'Reusable' },
        { name: 'Moisture meter (pin type)', unit: 'each', unitPrice: 29.99, qty: 1, per: 'job', perQty: 0,
          match: ['moisture', 'meter'],
          note: 'Check slab before install' },
        { name: 'Self-leveling underlayment (50 lb)', unit: 'bag', unitPrice: 32.99, qty: 2, per: 'sqft', perQty: 0.02,
          match: ['level', 'leveling', 'underlayment'],
          note: 'For dips over 3/16 in' }
      ]
    },
    masonry: {
      label: 'Masonry / Concrete',
      materials: [
        { name: 'Concrete mix 80 lb bag', unit: 'bag', unitPrice: 6.49, qty: 10, per: 'sqft', perQty: 0.15, staple: true,
          match: ['concrete', 'cement', 'pad', 'slab', 'footing'],
          note: '~0.6 cu ft per bag' },
        { name: 'Mortar mix 60 lb bag', unit: 'bag', unitPrice: 8.99, qty: 4, per: 'job', perQty: 0,
          match: ['mortar', 'brick', 'block'],
          note: 'Type N general purpose' },
        { name: 'Standard concrete block 8x8x16', unit: 'each', unitPrice: 2.49, qty: 40, per: 'sqft', perQty: 1.125,
          match: ['block', 'cinder', 'cmu'],
          note: '~1.125 blocks per sq ft of wall' },
        { name: '#4 rebar 10 ft', unit: 'each', unitPrice: 7.99, qty: 6, per: 'job', perQty: 0,
          match: ['rebar', 'reinforce'],
          note: 'Tie with 16 ga wire' },
        { name: 'Rebar tie wire (3.5 lb roll)', unit: 'roll', unitPrice: 9.99, qty: 1, per: 'job', perQty: 0,
          match: ['tie wire'],
          note: '' },
        { name: 'Gravel base 0.5 cu ft bag', unit: 'bag', unitPrice: 5.49, qty: 8, per: 'sqft', perQty: 0.08, staple: true,
          match: ['gravel', 'base', 'paver'],
          note: '4 in compacted base' },
        { name: 'Concrete sealer (1 gal)', unit: 'gallon', unitPrice: 29.99, qty: 1, per: 'job', perQty: 0,
          match: ['sealer', 'seal'],
          note: 'Apply after 28-day cure' },
        { name: 'Masonry trowel + jointer set', unit: 'each', unitPrice: 24.99, qty: 1, per: 'job', perQty: 0,
          match: ['trowel', 'tool'],
          note: 'Reusable' }
      ]
    },
    landscaping: {
      label: 'Landscaping',
      materials: [
        { name: 'Topsoil 1 cu ft bag', unit: 'bag', unitPrice: 4.29, qty: 20, per: 'sqft', perQty: 0.12, staple: true,
          match: ['topsoil', 'soil', 'dirt', 'grade'],
          note: 'Screened, weed-free' },
        { name: 'Hardwood mulch 2 cu ft bag', unit: 'bag', unitPrice: 4.99, qty: 15, per: 'sqft', perQty: 0.075,
          match: ['mulch', 'bed', 'bark'],
          note: '3 in depth coverage' },
        { name: 'Landscape fabric 3x50 ft', unit: 'roll', unitPrice: 24.99, qty: 1, per: 'sqft', perQty: 0.0067,
          match: ['fabric', 'weed barrier'],
          note: 'Under mulch beds' },
        { name: 'Steel landscape edging 8 ft', unit: 'each', unitPrice: 12.99, qty: 6, per: 'ft', perQty: 0.125,
          match: ['edging', 'border'],
          note: 'With stakes' },
        { name: 'Sod roll (10 sq ft)', unit: 'each', unitPrice: 8.99, qty: 10, per: 'sqft', perQty: 0.1,
          match: ['sod', 'grass', 'lawn', 'turf'],
          note: 'Lay within 24 hrs of delivery' },
        { name: 'Grass seed 10 lb bag', unit: 'bag', unitPrice: 32.99, qty: 1, per: 'sqft', perQty: 0.002,
          match: ['seed', 'overseed'],
          note: 'Match sun exposure' },
        { name: 'Starter fertilizer 5 lb', unit: 'bag', unitPrice: 14.99, qty: 1, per: 'job', perQty: 0, staple: true,
          match: ['fertilizer', 'feed'],
          note: 'For new seed/sod' },
        { name: 'Drainage gravel 0.5 cu ft bag', unit: 'bag', unitPrice: 5.49, qty: 6, per: 'job', perQty: 0,
          match: ['drainage', 'french drain', 'drain'],
          note: 'Washed stone' }
      ]
    }
  };

  function tradeKeys() { return Object.keys(TRADES); }

  // Extract numbers + units: "200 sq ft", "12 ft", "3 bedrooms".
  function parseQuantities(text) {
    var t = String(text || '');
    var out = { sqft: 0, linearFt: 0, rooms: 0, matches: [] };
    var m;
    var reSqft = /(\d+(?:\.\d+)?)\s*(?:sq\.?\s*ft\.?|sqft|square\s*feet)\b/gi;
    while ((m = reSqft.exec(t)) !== null) {
      out.sqft += parseFloat(m[1]);
      out.matches.push(m[0].trim());
    }
    var t2 = t.replace(/(\d+(?:\.\d+)?)\s*(?:sq\.?\s*ft\.?|sqft|square\s*feet)\b/gi, ' ');
    var reFt = /(\d+(?:\.\d+)?)\s*(?:linear\s*(?:feet|ft\.?)|lin\.?\s*(?:feet|ft\.?)|feet|ft\.?)\b|(\d+(?:\.\d+)?)\s*'/g;
    var reFtI = new RegExp(reFt.source, 'gi');
    while ((m = reFtI.exec(t2)) !== null) {
      var v = parseFloat(m[1] || m[2]);
      if (!isNaN(v)) { out.linearFt += v; out.matches.push(m[0].trim()); }
    }
    var reRooms = /(\d+)\s*(?:bedrooms?|bath(?:room)?s?|rooms?)\b/gi;
    while ((m = reRooms.exec(t)) !== null) {
      out.rooms += parseInt(m[1], 10);
      out.matches.push(m[0].trim());
    }
    return out;
  }

  function scaledQty(m, q) {
    if (m.per === 'sqft' && q.sqft > 0 && m.perQty) return round2(m.perQty * q.sqft);
    if (m.per === 'room' && q.rooms > 0 && m.perQty) return round2(m.perQty * q.rooms);
    if (m.per === 'ft' && q.linearFt > 0 && m.perQty) return round2(m.perQty * q.linearFt);
    return m.qty;
  }

  function round2(n) { return Math.round(n * 100) / 100; }

  // Generate a materials takeoff from plain-English job text.
  function generateList(opts) {
    opts = opts || {};
    var jobText = String(opts.jobText || '');
    var trade = TRADES[opts.trade] ? opts.trade : 'carpentry';
    var bank = TRADES[trade].materials;
    var q = parseQuantities(jobText);
    var text = jobText.toLowerCase();
    var hits = [];
    bank.forEach(function (m) {
      var matched = m.match.some(function (kw) { return text.indexOf(kw.toLowerCase()) !== -1; });
      if (matched) hits.push(m);
    });
    var picked = hits.length ? hits : bank.filter(function (m) { return m.staple; });
    var seen = {};
    var items = [];
    picked.forEach(function (m) {
      var key = m.name + '|' + m.unit;
      if (seen[key]) return;
      seen[key] = true;
      items.push({
        name: m.name,
        qty: scaledQty(m, q),
        unit: m.unit,
        unitPrice: m.unitPrice,
        note: m.note || ''
      });
    });
    return { trade: trade, tradeLabel: TRADES[trade].label, quantities: q, items: items };
  }

  var COUNTABLE_UNITS = ['each', 'box', 'boxes', 'bag', 'bags', 'roll', 'rolls',
    'sheet', 'sheets', 'gallon', 'gallons', 'tube', 'tubes', 'pack', 'packs',
    'bundle', 'bundles', 'case', 'cases'];

  function isCountable(unit) {
    return COUNTABLE_UNITS.indexOf(String(unit || '').toLowerCase()) !== -1;
  }

  // Apply a waste factor (0, 10, 15). Countable units round up; bulk rounds to 1 decimal.
  function applyWaste(items, pct) {
    pct = (pct === 10 || pct === 15) ? pct : 0;
    var factor = 1 + pct / 100;
    return (items || []).map(function (it) {
      var raw = it.qty * factor;
      var qty = isCountable(it.unit)
        ? Math.ceil(raw - 1e-9)
        : Math.round(raw * 10) / 10;
      return {
        name: it.name, qty: qty, unit: it.unit,
        unitPrice: it.unitPrice, note: it.note || '', wastePct: pct
      };
    });
  }

  // qty x unitPrice line totals + grand total.
  function estimateCost(items) {
    var lines = (items || []).map(function (it) {
      var lineTotal = Math.round(it.qty * it.unitPrice * 100) / 100;
      return {
        name: it.name, qty: it.qty, unit: it.unit,
        unitPrice: it.unitPrice, lineTotal: lineTotal, note: it.note || ''
      };
    });
    var total = Math.round(lines.reduce(function (s, l) { return s + l.lineTotal; }, 0) * 100) / 100;
    return { lines: lines, total: total };
  }

  function fmtMoney(n) {
    return '$' + Number(n).toFixed(2);
  }

  // Adjust one item's quantity by delta (pure; qty clamped >= 0, rounded to 2).
  function adjustItemQty(items, index, delta) {
    var arr = (items || []).slice();
    if (index < 0 || index >= arr.length) return arr;
    var it = arr[index];
    var qty = Math.round((Number(it.qty) + Number(delta)) * 100) / 100;
    arr[index] = {
      name: it.name, qty: Math.max(0, qty), unit: it.unit,
      unitPrice: it.unitPrice, note: it.note || '', wastePct: it.wastePct || 0
    };
    return arr;
  }

  // Append a hand-added item. Throws on missing name / non-positive qty.
  function addCustomItem(items, spec) {
    spec = spec || {};
    var name = String(spec.name || '').trim();
    if (!name) throw new Error('addCustomItem: name is required');
    var qty = Math.round(Number(spec.qty) * 100) / 100;
    if (!isFinite(qty) || qty <= 0) throw new Error('addCustomItem: qty must be > 0');
    var price = Math.round(Number(spec.unitPrice || 0) * 100) / 100;
    if (!isFinite(price) || price < 0) throw new Error('addCustomItem: unitPrice must be >= 0');
    var arr = (items || []).slice();
    arr.push({
      name: name, qty: qty, unit: String(spec.unit || 'each'),
      unitPrice: price, note: String(spec.note || ''), wastePct: 0, custom: true
    });
    return arr;
  }

  // Split the estimate into bought vs remaining. bought[i] parallels items[i].
  function remainingCost(items, bought) {
    var cost = estimateCost(items);
    var remaining = 0, boughtTotal = 0;
    cost.lines.forEach(function (line, i) {
      if (bought && bought[i]) boughtTotal += line.lineTotal;
      else remaining += line.lineTotal;
    });
    return {
      total: cost.total,
      remaining: Math.round(remaining * 100) / 100,
      boughtTotal: Math.round(boughtTotal * 100) / 100
    };
  }

  // CSV of the current list (one row per item, with bought flag).
  function listToCSV(items, bought) {
    function cell(v) {
      var s = String(v == null ? '' : v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    var cost = estimateCost(items);
    var rows = [['item', 'qty', 'unit', 'unit_price', 'line_total', 'bought', 'note']];
    cost.lines.forEach(function (line, i) {
      rows.push([
        line.name, line.qty, line.unit,
        line.unitPrice.toFixed(2), line.lineTotal.toFixed(2),
        bought && bought[i] ? 'yes' : 'no', line.note || ''
      ]);
    });
    return rows.map(function (r) { return r.map(cell).join(','); }).join('\n');
  }

  // Duplicate a saved-list entry: fresh id, " (copy)" name, same items/progress.
  function cloneListEntry(entry, newId) {
    if (!entry || typeof entry !== 'object') throw new Error('cloneListEntry: entry is required');
    var copy = JSON.parse(JSON.stringify(entry));
    copy.id = newId || ('l' + Date.now());
    copy.name = (entry.name || 'Untitled list') + ' (copy)';
    copy.savedAt = new Date().toISOString();
    return copy;
  }

  // Cost-per-unit: total divided by the parsed job quantities.
  // Handy for quoting ("this roof costs $4.20 per sq ft in materials").
  function costPerUnit(items, quantities) {
    var total = estimateCost(items).total;
    var q = quantities || {};
    var breakdown = [];
    if (q.sqft > 0) breakdown.push({ unit: 'sq ft', per: round2(total / q.sqft) });
    if (q.linearFt > 0) breakdown.push({ unit: 'linear ft', per: round2(total / q.linearFt) });
    if (q.rooms > 0) breakdown.push({ unit: 'room', per: round2(total / q.rooms) });
    return { total: total, breakdown: breakdown };
  }

  // Actual store prices vs the estimate. actuals: array parallel to items,
  // each entry a number (actual unit price paid) or null/undefined to skip.
  // Variance is computed only over lines with a recorded actual.
  function applyActuals(items, actuals) {
    var lines = [], estTotal = 0, actTotal = 0, estRecorded = 0, recorded = 0;
    (items || []).forEach(function (it, i) {
      var est = Math.round(it.qty * it.unitPrice * 100) / 100;
      var raw = actuals ? actuals[i] : null;
      var ap = (raw != null && raw !== '' && isFinite(Number(raw))) ? Number(raw) : null;
      var act = ap == null ? null : Math.round(it.qty * ap * 100) / 100;
      estTotal = round2(estTotal + est);
      if (act != null) { recorded++; actTotal = round2(actTotal + act); estRecorded = round2(estRecorded + est); }
      lines.push({
        name: it.name, qty: it.qty, unit: it.unit,
        estUnitPrice: it.unitPrice, estLine: est,
        actUnitPrice: ap, actLine: act,
        variance: act == null ? null : round2(act - est)
      });
    });
    return {
      lines: lines, recorded: recorded, of: (items || []).length,
      estTotal: estTotal, actTotal: actTotal,
      variance: recorded ? round2(actTotal - estRecorded) : null
    };
  }

  // Staples in this trade's bank that are missing from the list —
  // the "forgotten $8 part" check this app exists to prevent.
  function forgottenStaples(trade, items) {
    var bank = TRADES[trade] ? TRADES[trade].materials : [];
    var have = {};
    (items || []).forEach(function (it) { have[String(it.name).toLowerCase()] = true; });
    return bank
      .filter(function (m) { return m.staple && !have[m.name.toLowerCase()]; })
      .map(function (m) { return { name: m.name, unit: m.unit, unitPrice: m.unitPrice, note: m.note || '' }; });
  }

  // Estimate totals with an optional discount (%) and sales tax (%).
  // Discount comes off the subtotal first; tax applies to the discounted amount.
  function applyTotals(items, taxPct, discountPct) {
    var subtotal = estimateCost(items).total;
    var disc = Math.min(100, Math.max(0, Number(discountPct) || 0));
    var tax = Math.max(0, Number(taxPct) || 0);
    var discountAmt = round2(subtotal * disc / 100);
    var taxable = round2(subtotal - discountAmt);
    var taxAmt = round2(taxable * tax / 100);
    return {
      subtotal: subtotal,
      discountPct: disc,
      discountAmt: discountAmt,
      taxPct: tax,
      taxAmt: taxAmt,
      grandTotal: round2(taxable + taxAmt)
    };
  }

  // Price book: remember actual store prices per material name so future
  // lists use YOUR prices instead of the built-in estimates.
  // rememberPrices(book, items, actuals) -> { book, added }
  function rememberPrices(book, items, actuals) {
    var b = {};
    Object.keys(book || {}).forEach(function (k) { b[k] = book[k]; });
    var added = 0;
    (items || []).forEach(function (it, i) {
      var raw = actuals ? actuals[i] : null;
      var ap = (raw != null && raw !== '' && isFinite(Number(raw))) ? Number(raw) : null;
      if (ap != null && ap >= 0) {
        var key = String(it.name).toLowerCase();
        if (b[key] !== ap) { b[key] = ap; added++; }
      }
    });
    return { book: b, added: added };
  }

  // Override unit prices from the price book. Tagged lines get bookPrice=true.
  function applyPriceBook(items, book) {
    if (!book) return (items || []).slice();
    return (items || []).map(function (it) {
      var p = book[String(it.name).toLowerCase()];
      if (p == null || !isFinite(Number(p)) || Number(p) < 0) return it;
      var copy = {};
      Object.keys(it).forEach(function (k) { copy[k] = it[k]; });
      copy.unitPrice = Number(p);
      copy.bookPrice = true;
      return copy;
    });
  }

  // Customer-facing quote document data: line items + tax/discount totals,
  // quote number, dates, business/customer, terms. Ready to render + print.
  function buildQuote(items, meta) {
    meta = meta || {};
    var totals = applyTotals(items, meta.taxPct, meta.discountPct);
    var stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return {
      quoteNo: String(meta.quoteNo || ('Q-' + stamp + '-001')).trim() || ('Q-' + stamp + '-001'),
      date: String(meta.date || new Date().toISOString().slice(0, 10)),
      business: String(meta.business || 'Your Business').trim() || 'Your Business',
      customer: String(meta.customer || '').trim(),
      job: String(meta.job || '').trim(),
      lines: estimateCost(items).lines,
      totals: totals,
      terms: String(meta.terms || 'Quote valid 30 days. Materials pricing subject to availability.')
    };
  }

  ML.TRADES = TRADES;
  ML.tradeKeys = tradeKeys;
  ML.parseQuantities = parseQuantities;
  ML.generateList = generateList;
  ML.applyWaste = applyWaste;
  ML.estimateCost = estimateCost;
  ML.fmtMoney = fmtMoney;
  ML.adjustItemQty = adjustItemQty;
  ML.addCustomItem = addCustomItem;
  ML.remainingCost = remainingCost;
  ML.listToCSV = listToCSV;
  ML.cloneListEntry = cloneListEntry;
  ML.costPerUnit = costPerUnit;
  ML.applyActuals = applyActuals;
  ML.forgottenStaples = forgottenStaples;
  ML.applyTotals = applyTotals;
  ML.rememberPrices = rememberPrices;
  ML.applyPriceBook = applyPriceBook;
  ML.buildQuote = buildQuote;
})(typeof globalThis !== 'undefined' ? globalThis : this);
