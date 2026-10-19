/*
 * Quotely AI - local line-item generator.
 * Works with ZERO API keys: parses a plain-English job description and turns
 * matched keywords into editable line items with realistic US prices.
 * Shared between the Node server and the browser (UMD-style, no deps).
 *
 * This file is also the CANONICAL line-item / price bank for the trades
 * pipeline (quotely-ai owns it; sitevisit-ai consumes it via
 * GET /api/price-bank). See "Price-bank contract" in the README.
 */
(function (root) {
  "use strict";

  var TRADES = [
    "Plumbing", "Electrical", "Painting", "Landscaping",
    "Roofing", "HVAC", "Carpentry", "Flooring", "Cleaning",
    "General Handyman"
  ];

  var TRIP_FEE = 65;

  /* Canonical price bank. Semantic versioning:
   *   major — field renames/removals (consumers must adapt),
   *   minor — new items or trades added,
   *   patch — price tweaks only.
   * Consumers: fetch GET /api/price-bank (quotely-ai) for the live copy;
   * fall back to the last cached / shipped snapshot when offline. */
  var PRICE_BANK_VERSION = "1.0.0";
  var PRICE_BANK_CURRENCY = "USD";

  // Canonical entry: { trades[], keys[], name, unit, price }.
  // name, unit, unitPrice (USD, 2026 ballpark, includes parts + labor).
  // An entry may list several trades — sitevisit-ai slices the bank
  // per trade, quotely-ai matches keywords across all trades.
  var ITEM_DB = [
    // ---- Plumbing ----
    { trades: ["Plumbing"], keys: ["faucet", "tap", "spigot"], name: "Faucet replacement (parts + labor)", unit: "each", price: 145 },
    { trades: ["Plumbing"], keys: ["toilet", "wax ring"], name: "Toilet repair / replacement", unit: "each", price: 220 },
    { trades: ["Plumbing"], keys: ["water heater", "hot water heater", "hot water tank"], name: "Water heater replacement", unit: "each", price: 1250 },
    { trades: ["Plumbing"], keys: ["leak", "leaking", "drip", "burst pipe", "pipe repair"], name: "Leak / pipe repair", unit: "each", price: 175 },
    { trades: ["Plumbing"], keys: ["drain", "clog", "clogged", "sewer line"], name: "Drain cleaning", unit: "each", price: 165 },
    { trades: ["Plumbing"], keys: ["shower", "bathtub", "tub"], name: "Shower / tub fixture work", unit: "each", price: 195 },
    { trades: ["Plumbing"], keys: ["garbage disposal", "disposal", "kitchen sink"], name: "Sink / disposal install", unit: "each", price: 185 },
    { trades: ["Plumbing"], keys: ["sump pump"], name: "Sump pump replacement", unit: "each", price: 450 },
    { trades: ["Plumbing"], keys: ["repipe", "re-pipe", "pipe replacement"], name: "Repipe / section replacement", unit: "each", price: 180 },
    // ---- Electrical ----
    { trades: ["Electrical"], keys: ["outlet", "socket", "receptacle", "gfci"], name: "Outlet installation", unit: "each", price: 95 },
    { trades: ["Electrical"], keys: ["light fixture", "chandelier", "recessed light", "can light", "pendant"], name: "Light fixture installation", unit: "each", price: 120 },
    { trades: ["Electrical"], keys: ["ceiling fan"], name: "Ceiling fan installation", unit: "each", price: 175 },
    { trades: ["Electrical"], keys: ["breaker", "electrical panel", "panel upgrade", "panel", "fuse box"], name: "Breaker / panel work", unit: "each", price: 350 },
    { trades: ["Electrical"], keys: ["light switch", "dimmer", "switch"], name: "Switch / dimmer replacement", unit: "each", price: 75 },
    { trades: ["Electrical"], keys: ["wiring", "rewire"], name: "Wiring / rewiring", unit: "hr", price: 95 },
    { trades: ["Electrical"], keys: ["ev charger", "car charger", "evse"], name: "EV charger circuit install", unit: "each", price: 650 },
    { trades: ["Electrical"], keys: ["smoke detector", "co detector", "smoke alarm"], name: "Smoke/CO detector install", unit: "each", price: 75 },
    { trades: ["Electrical"], keys: ["troubleshoot", "troubleshooting", "no power", "diagnose"], name: "Electrical troubleshooting (first hour)", unit: "hr", price: 110 },
    // ---- Painting ----
    { trades: ["Painting"], keys: ["exterior paint"], name: "Exterior painting", unit: "sq ft", price: 2.75 },
    { trades: ["Painting"], keys: ["paint", "repaint", "painting"], name: "Interior painting", unit: "room", price: 395 },
    { trades: ["Painting", "General Handyman"], keys: ["drywall", "patch", "spackle"], name: "Drywall repair", unit: "each", price: 185 },
    { trades: ["Painting"], keys: ["cabinet paint", "cabinet refinishing", "refinish cabinets"], name: "Cabinet refinishing", unit: "each", price: 150 },
    { trades: ["Painting"], keys: ["ceiling", "popcorn ceiling"], name: "Ceiling repaint / texture repair", unit: "each", price: 220 },
    { trades: ["Painting"], keys: ["stain", "restain", "deck stain", "fence stain"], name: "Deck / fence stain", unit: "sq ft", price: 2.0 },
    // ---- Landscaping ----
    { trades: ["Landscaping"], keys: ["mow", "lawn", "grass"], name: "Lawn mowing", unit: "visit", price: 55 },
    { trades: ["Landscaping"], keys: ["mulch"], name: "Mulch installation", unit: "cu yd", price: 95 },
    { trades: ["Landscaping"], keys: ["tree", "trim", "prune", "branch", "stump"], name: "Tree trimming / removal", unit: "each", price: 225 },
    { trades: ["Landscaping"], keys: ["bush", "shrub", "hedge"], name: "Shrub / hedge trimming", unit: "each", price: 85 },
    { trades: ["Landscaping"], keys: ["sod", "turf"], name: "Sod installation", unit: "sq ft", price: 2.25 },
    { trades: ["Landscaping"], keys: ["garden", "flower bed", "planting"], name: "Garden bed planting", unit: "each", price: 150 },
    { trades: ["Landscaping"], keys: ["sprinkler", "irrigation"], name: "Sprinkler / irrigation work", unit: "each", price: 195 },
    { trades: ["Landscaping"], keys: ["paver", "patio", "walkway"], name: "Paver patio / walkway", unit: "sq ft", price: 16 },
    { trades: ["Landscaping"], keys: ["cleanup", "yard cleanup", "debris removal"], name: "Seasonal yard cleanup", unit: "each", price: 280 },
    // ---- Roofing ----
    { trades: ["Roofing"], keys: ["roof", "roofing"], name: "Roof repair", unit: "sq", price: 450 },
    { trades: ["Roofing"], keys: ["shingle", "re-roof", "reroof", "new roof"], name: "Asphalt shingle re-roof", unit: "sq", price: 425 },
    { trades: ["Roofing"], keys: ["roof leak", "leak repair", "roof patch"], name: "Roof leak repair", unit: "each", price: 350 },
    { trades: ["Roofing"], keys: ["gutter", "gutters"], name: "Gutter installation / repair", unit: "ft", price: 9 },
    { trades: ["Roofing"], keys: ["flashing", "chimney"], name: "Flashing / chimney repair", unit: "each", price: 275 },
    { trades: ["Roofing"], keys: ["skylight"], name: "Skylight replacement", unit: "each", price: 850 },
    { trades: ["Roofing"], keys: ["roof vent", "ridge vent", "attic vent"], name: "Roof vent installation", unit: "each", price: 180 },
    { trades: ["Roofing"], keys: ["roof inspection"], name: "Roof inspection + report", unit: "each", price: 149 },
    // ---- HVAC ----
    { trades: ["HVAC"], keys: ["thermostat", "nest", "ecobee"], name: "Thermostat installation", unit: "each", price: 175 },
    { trades: ["HVAC"], keys: ["ac", "air conditioner", "air conditioning", "heat pump", "hvac"], name: "HVAC service / repair", unit: "each", price: 295 },
    { trades: ["HVAC"], keys: ["duct", "ductwork"], name: "Ductwork repair", unit: "each", price: 350 },
    { trades: ["HVAC"], keys: ["furnace"], name: "Furnace replacement (80% AFUE)", unit: "each", price: 3200 },
    { trades: ["HVAC"], keys: ["tune-up", "tuneup", "maintenance"], name: "Seasonal HVAC tune-up", unit: "each", price: 129 },
    { trades: ["HVAC"], keys: ["filter", "filters"], name: "Filter replacement + system check", unit: "each", price: 65 },
    { trades: ["HVAC"], keys: ["mini split", "mini-split", "ductless"], name: "Ductless mini-split install (per head)", unit: "each", price: 2100 },
    // ---- Carpentry ----
    { trades: ["Carpentry"], keys: ["deck"], name: "Deck build / repair", unit: "sq ft", price: 28 },
    { trades: ["Carpentry"], keys: ["fence"], name: "Fence installation / repair", unit: "ft", price: 32 },
    { trades: ["Carpentry"], keys: ["door"], name: "Door installation", unit: "each", price: 275 },
    { trades: ["Carpentry"], keys: ["cabinet"], name: "Cabinet installation", unit: "each", price: 225 },
    { trades: ["Carpentry", "Flooring"], keys: ["baseboard", "trim work", "crown molding", "casing", "transition"], name: "Trim / molding work", unit: "ft", price: 6.5 },
    { trades: ["Carpentry"], keys: ["shelf", "shelving", "closet"], name: "Custom shelving / closet build", unit: "each", price: 480 },
    { trades: ["Carpentry"], keys: ["rot", "siding"], name: "Rot repair / siding section", unit: "each", price: 310 },
    { trades: ["Carpentry"], keys: ["stairs", "stair", "railing"], name: "Stair / railing repair", unit: "each", price: 390 },
    // ---- Flooring ----
    { trades: ["Flooring"], keys: ["hardwood", "oak"], name: "Hardwood install / refinish", unit: "sq ft", price: 9.5 },
    { trades: ["Flooring"], keys: ["laminate", "vinyl", "lvp"], name: "LVP / laminate install", unit: "sq ft", price: 6.5 },
    { trades: ["Flooring"], keys: ["tile", "tiles"], name: "Tile install", unit: "sq ft", price: 11 },
    { trades: ["Flooring"], keys: ["carpet install", "install carpet", "new carpet", "carpet replacement"], name: "Carpet install", unit: "sq yd", price: 38 },
    { trades: ["Flooring"], keys: ["grout", "re-grout", "regrout"], name: "Grout repair / re-grout", unit: "sq ft", price: 4 },
    { trades: ["Flooring"], keys: ["subfloor", "squeak"], name: "Subfloor repair", unit: "each", price: 220 },
    // ---- Cleaning ----
    { trades: ["Cleaning"], keys: ["carpet cleaning", "rug cleaning"], name: "Carpet cleaning", unit: "room", price: 85 },
    { trades: ["Cleaning"], keys: ["window"], name: "Window cleaning", unit: "each", price: 12 },
    { trades: ["Cleaning"], keys: ["clean", "cleaning", "deep clean"], name: "Deep cleaning", unit: "hr", price: 45 },
    // ---- General Handyman ----
    { trades: ["General Handyman"], keys: ["caulk", "caulking", "sealant"], name: "Caulk / seal refresh", unit: "each", price: 65 },
    { trades: ["General Handyman"], keys: ["gutter cleaning", "clean gutters"], name: "Gutter cleaning", unit: "each", price: 150 },
    { trades: ["General Handyman"], keys: ["furniture", "assemble", "assembly"], name: "Furniture assembly", unit: "each", price: 80 },
    { trades: ["General Handyman"], keys: ["tv mount", "tv mounting", "mount tv"], name: "TV / heavy item mounting", unit: "each", price: 95 },
    { trades: ["General Handyman"], keys: ["pressure wash", "pressure washing", "power wash"], name: "Pressure washing", unit: "sq ft", price: 0.35 },
    { trades: ["General Handyman"], keys: ["odd job", "misc", "various", "handyman"], name: "Half-day handyman block", unit: "half-day", price: 280 }
  ];

  /* Canonical price-bank document (the contract sitevisit-ai consumes).
   * Shape: { version, currency, updated, tripFee, trades[], items[] } where
   * each item is { trades[], keys[], name, unit, price }. */
  function priceBank() {
    return {
      version: PRICE_BANK_VERSION,
      currency: PRICE_BANK_CURRENCY,
      updated: "2026-10-19",
      tripFee: TRIP_FEE,
      trades: TRADES.slice(),
      items: ITEM_DB.map(function (e) {
        return {
          trades: e.trades.slice(),
          keys: e.keys.slice(),
          name: e.name,
          unit: e.unit,
          price: e.price
        };
      })
    };
  }

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

  /* Quote totals: optional/upsell line items are excluded from the base
   * math and reported separately as optionsTotal (customer can add them).
   * subtotal -> discount -> tax -> total -> deposit. discountRate is a
   * percent (0-100, clamped); 0 preserves the old math. */
  function quoteTotals(items, taxRate, depositRate, discountRate) {
    var options = items.filter(function (i) { return i && i.optional; });
    var base = items.filter(function (i) { return !(i && i.optional); });
    var subtotal = base.reduce(function (a, i) { return a + lineTotal(i); }, 0);
    subtotal = Math.round(subtotal * 100) / 100;
    var d = Math.min(100, Math.max(0, Number(discountRate) || 0));
    var discount = Math.round(subtotal * d / 100 * 100) / 100;
    var taxable = Math.round((subtotal - discount) * 100) / 100;
    var tax = Math.round(taxable * (Number(taxRate) || 0) / 100 * 100) / 100;
    var total = Math.round((taxable + tax) * 100) / 100;
    var deposit = Math.round(total * (Number(depositRate) || 0) / 100 * 100) / 100;
    var optionsTotal = Math.round(options.reduce(function (a, i) { return a + lineTotal(i); }, 0) * 100) / 100;
    return { subtotal: subtotal, discountRate: d, discount: discount, tax: tax, total: total, deposit: deposit, balance: Math.round((total - deposit) * 100) / 100, optionsTotal: optionsTotal };
  }

  /* Second sweep: quote expiry — validity deadline = createdAt + validDays.
   * Only open quotes (draft/sent) can expire; won/lost are closed. */
  function quoteExpiryISO(q) {
    var created = Date.parse((q && q.createdAt) || "");
    if (isNaN(created)) return null;
    var days = Number(q.validDays) || 30;
    return new Date(created + days * 864e5).toISOString().slice(0, 10);
  }
  function isQuoteExpired(q, todayISO) {
    var exp = quoteExpiryISO(q);
    if (!exp) return false;
    var today = todayISO || new Date().toISOString().slice(0, 10);
    var st = q && q.status;
    return exp < today && (st === "draft" || st === "sent");
  }

  var Quotely = {
    TRADES: TRADES,
    TRIP_FEE: TRIP_FEE,
    PRICE_BANK_VERSION: PRICE_BANK_VERSION,
    priceBank: priceBank,
    generateLineItems: generateLineItems,
    lineTotal: lineTotal,
    quoteTotals: quoteTotals,
    quoteExpiryISO: quoteExpiryISO,
    isQuoteExpired: isQuoteExpired
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = Quotely;
  } else {
    root.Quotely = Quotely;
  }
})(typeof self !== "undefined" ? self : (typeof globalThis !== "undefined" ? globalThis : this));
