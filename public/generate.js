/*
 * Quotely AI - local line-item generator.
 * Works with ZERO API keys: parses a plain-English job description and turns
 * matched keywords into editable line items with realistic US prices.
 * Shared between the Node server and the browser (UMD-style, no deps).
 */
(function (root) {
  "use strict";

  var TRADES = [
    "Plumbing", "Electrical", "Painting", "Landscaping",
    "Roofing", "HVAC", "Carpentry", "Cleaning", "General Handyman"
  ];

  var TRIP_FEE = 65;

  // name, unit, unitPrice (USD, 2026 ballpark, includes parts + labor)
  var ITEM_DB = [
    // ---- Plumbing ----
    { trades: ["Plumbing"], keys: ["faucet", "tap", "spigot"], name: "Faucet replacement (parts + labor)", unit: "each", price: 145 },
    { trades: ["Plumbing"], keys: ["toilet"], name: "Toilet repair / replacement", unit: "each", price: 220 },
    { trades: ["Plumbing"], keys: ["water heater", "hot water heater"], name: "Water heater replacement", unit: "each", price: 1250 },
    { trades: ["Plumbing"], keys: ["leak", "leaking", "drip", "burst pipe", "pipe repair"], name: "Leak / pipe repair", unit: "each", price: 175 },
    { trades: ["Plumbing"], keys: ["drain", "clog", "clogged", "sewer line"], name: "Drain cleaning", unit: "each", price: 165 },
    { trades: ["Plumbing"], keys: ["shower", "bathtub", "tub"], name: "Shower / tub fixture work", unit: "each", price: 195 },
    { trades: ["Plumbing"], keys: ["garbage disposal", "disposal", "kitchen sink"], name: "Sink / disposal install", unit: "each", price: 185 },
    { trades: ["Plumbing"], keys: ["sump pump"], name: "Sump pump replacement", unit: "each", price: 450 },
    // ---- Electrical ----
    { trades: ["Electrical"], keys: ["outlet", "socket", "receptacle", "gfci"], name: "Outlet installation", unit: "each", price: 95 },
    { trades: ["Electrical"], keys: ["light fixture", "chandelier", "recessed light", "can light", "pendant"], name: "Light fixture installation", unit: "each", price: 120 },
    { trades: ["Electrical"], keys: ["ceiling fan"], name: "Ceiling fan installation", unit: "each", price: 175 },
    { trades: ["Electrical"], keys: ["breaker", "electrical panel", "panel upgrade", "fuse box"], name: "Breaker / panel work", unit: "each", price: 350 },
    { trades: ["Electrical"], keys: ["light switch", "dimmer", "switch"], name: "Switch / dimmer replacement", unit: "each", price: 75 },
    { trades: ["Electrical"], keys: ["wiring", "rewire"], name: "Wiring / rewiring", unit: "hr", price: 95 },
    // ---- Painting ----
    { trades: ["Painting"], keys: ["exterior paint"], name: "Exterior painting", unit: "sq ft", price: 2.75 },
    { trades: ["Painting"], keys: ["paint", "repaint", "painting"], name: "Interior painting", unit: "room", price: 395 },
    { trades: ["Painting"], keys: ["drywall", "patch", "spackle"], name: "Drywall repair", unit: "each", price: 185 },
    { trades: ["Painting"], keys: ["cabinet paint", "cabinet refinishing", "refinish cabinets"], name: "Cabinet refinishing", unit: "each", price: 150 },
    // ---- Landscaping ----
    { trades: ["Landscaping"], keys: ["mow", "lawn", "grass"], name: "Lawn mowing", unit: "visit", price: 55 },
    { trades: ["Landscaping"], keys: ["mulch"], name: "Mulch installation", unit: "cu yd", price: 95 },
    { trades: ["Landscaping"], keys: ["tree", "trim", "prune", "branch", "stump"], name: "Tree trimming / removal", unit: "each", price: 225 },
    { trades: ["Landscaping"], keys: ["bush", "shrub", "hedge"], name: "Shrub / hedge trimming", unit: "each", price: 85 },
    { trades: ["Landscaping"], keys: ["sod", "turf"], name: "Sod installation", unit: "sq ft", price: 2.25 },
    { trades: ["Landscaping"], keys: ["garden", "flower bed", "planting"], name: "Garden bed planting", unit: "each", price: 150 },
    { trades: ["Landscaping"], keys: ["sprinkler", "irrigation"], name: "Sprinkler / irrigation work", unit: "each", price: 195 },
    // ---- Roofing ----
    { trades: ["Roofing"], keys: ["roof", "shingle", "roofing"], name: "Roof repair", unit: "sq", price: 450 },
    { trades: ["Roofing"], keys: ["gutter"], name: "Gutter installation / repair", unit: "ft", price: 9 },
    // ---- HVAC ----
    { trades: ["HVAC"], keys: ["thermostat"], name: "Thermostat installation", unit: "each", price: 175 },
    { trades: ["HVAC"], keys: ["ac", "air conditioner", "air conditioning", "furnace", "heat pump", "hvac"], name: "HVAC service / repair", unit: "each", price: 295 },
    { trades: ["HVAC"], keys: ["duct"], name: "Ductwork repair", unit: "each", price: 350 },
    // ---- Carpentry ----
    { trades: ["Carpentry"], keys: ["deck"], name: "Deck build / repair", unit: "sq ft", price: 28 },
    { trades: ["Carpentry"], keys: ["fence"], name: "Fence installation / repair", unit: "ft", price: 32 },
    { trades: ["Carpentry"], keys: ["door"], name: "Door installation", unit: "each", price: 275 },
    { trades: ["Carpentry"], keys: ["cabinet"], name: "Cabinet installation", unit: "each", price: 225 },
    { trades: ["Carpentry"], keys: ["floor", "flooring", "hardwood", "laminate", "tile"], name: "Flooring installation", unit: "sq ft", price: 8.5 },
    { trades: ["Carpentry"], keys: ["baseboard", "trim work", "crown molding"], name: "Trim / molding work", unit: "ft", price: 6.5 },
    // ---- Cleaning ----
    { trades: ["Cleaning"], keys: ["carpet"], name: "Carpet cleaning", unit: "room", price: 85 },
    { trades: ["Cleaning"], keys: ["window"], name: "Window cleaning", unit: "each", price: 12 },
    { trades: ["Cleaning"], keys: ["clean", "cleaning", "deep clean"], name: "Deep cleaning", unit: "hr", price: 45 }
  ];

  var NUMBER_WORDS = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
    seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12
  };

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function normalizeNumbers(text) {
    // turn "two faucets" into "2 faucets" so qty extraction works
    return text.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/gi,
      function (m) { return String(NUMBER_WORDS[m.toLowerCase()]); });
  }

  // Find a quantity for `key` inside a sentence.
  // Prefers a number right before the keyword ("replace 3 faucets"),
  // then a lone number in the sentence, then 1.
  function extractQty(sentence, key) {
    var norm = normalizeNumbers(sentence);
    var keyRe = escapeRegExp(key);
    var before = new RegExp("(\\d[\\d,]*)\\s+(?:\\w+\\s+){0,2}?" + keyRe + "s?\\b", "i");
    var m = norm.match(before);
    if (m) return Math.max(1, parseInt(m[1].replace(/,/g, ""), 10));
    var nums = norm.match(/\b\d[\d,]*\b/g);
    if (nums && nums.length === 1) return Math.max(1, parseInt(nums[0].replace(/,/g, ""), 10));
    return 1;
  }

  function generateLineItems(description, trade) {
    description = (description || "").trim();
    var items = [];
    if (!description) return items;

    var text = normalizeNumbers(description.toLowerCase());
    var sentences = text.split(/[.\n;!?]+/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (!sentences.length) sentences = [text];

    var used = {};
    ITEM_DB.forEach(function (entry) {
      for (var k = 0; k < entry.keys.length; k++) {
        var key = entry.keys[k];
        var re = new RegExp("\\b" + escapeRegExp(key) + "s?\\b", "i");
        var sentIdx = -1;
        for (var s = 0; s < sentences.length; s++) {
          if (re.test(sentences[s])) { sentIdx = s; break; }
        }
        if (sentIdx === -1) continue;
        if (used[entry.name]) break;
        used[entry.name] = true;
        var qty = extractQty(sentences[sentIdx], key);
        items.push({
          description: entry.name,
          qty: qty,
          unit: entry.unit,
          unitPrice: entry.price
        });
        break; // one line item per DB entry
      }
    });

    // Trip / service-call fee when a real trade is selected
    if (trade && trade !== "General Handyman" && TRADES.indexOf(trade) !== -1 && items.length) {
      items.unshift({ description: "Service call / trip fee", qty: 1, unit: "each", unitPrice: TRIP_FEE });
    }

    // Never return empty: editable fallback so the tradesperson can fill it in
    if (!items.length) {
      items.push({
        description: "Labor and materials (edit to match job)",
        qty: 1, unit: "job", unitPrice: 0
      });
    }
    return items;
  }

  function lineTotal(item) {
    var q = Number(item.qty) || 0;
    var p = Number(item.unitPrice) || 0;
    return Math.round(q * p * 100) / 100;
  }

  function quoteTotals(items, taxRate, depositRate) {
    var subtotal = items.reduce(function (a, i) { return a + lineTotal(i); }, 0);
    subtotal = Math.round(subtotal * 100) / 100;
    var tax = Math.round(subtotal * (Number(taxRate) || 0) / 100 * 100) / 100;
    var total = Math.round((subtotal + tax) * 100) / 100;
    var deposit = Math.round(total * (Number(depositRate) || 0) / 100 * 100) / 100;
    return { subtotal: subtotal, tax: tax, total: total, deposit: deposit, balance: Math.round((total - deposit) * 100) / 100 };
  }

  var Quotely = {
    TRADES: TRADES,
    TRIP_FEE: TRIP_FEE,
    generateLineItems: generateLineItems,
    lineTotal: lineTotal,
    quoteTotals: quoteTotals
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = Quotely;
  } else {
    root.Quotely = Quotely;
  }
})(typeof self !== "undefined" ? self : (typeof globalThis !== "undefined" ? globalThis : this));
