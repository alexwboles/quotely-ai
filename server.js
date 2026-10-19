/*
 * Quotely AI - tiny zero-dependency Node server.
 * Serves the single-page app and a small JSON API for quote generation
 * and quote storage (data/quotes.json).
 *
 * Quote generation works with NO API key via the local heuristic engine.
 * If OPENAI_API_KEY is set, /api/generate will try OpenAI first and fall
 * back to the local engine on any failure. The key is never required.
 *
 * Trades pipeline (see README "Trades pipeline"):
 *   - Owns the canonical line-item / price bank: GET /api/price-bank
 *     (sitevisit-ai consumes it).
 *   - Accepts site-visit quote drafts: POST /api/quotes/import
 *     (a sitevisit draft IS a quotely quote — upserted by visit id).
 *   - Wires signpilot-ai both ways: quote won -> approval request
 *     (SIGNPILOT_URL); signpilot signed/declined -> POST
 *     /api/quotes/:id/signpilot-callback updates the quote.
 *   - Change orders, milestone billing, and a one-click materials-list
 *     export shaped for materiallist-ai (read-only contract).
 */
"use strict";

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const Quotely = require("./public/generate.js");
require("./public/ml-materials.js"); // vendored materiallist-ai engine (MIT)
const ML = globalThis.ML;

const PORT = Number(process.env.PORT) || 3000;
const ROOT = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "quotes.json");
const TEMPLATES_FILE = path.join(DATA_DIR, "templates.json");

const SIGNPILOT_URL = (process.env.SIGNPILOT_URL || "").replace(/\/+$/, "");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

/* ---------- storage ---------- */
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]", "utf8");
}

function readQuotes() {
  ensureDataDir();
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

function writeQuotes(quotes) {
  ensureDataDir();
  const tmp = DATA_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(quotes, null, 2), "utf8");
  fs.renameSync(tmp, DATA_FILE);
}

function newId(prefix) {
  return (prefix || "q_") + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* ---------- server-to-server JSON (pipeline calls) ---------- */
function postJSON(urlStr, payload, timeoutMs) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(urlStr); } catch (e) { return resolve({ ok: false, error: "bad url" }); }
    const lib = u.protocol === "https:" ? https : http;
    const body = JSON.stringify(payload || {});
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === "https:" ? 443 : 80),
      path: u.pathname + (u.search || ""),
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      timeout: timeoutMs || 5000
    }, (res) => {
      let raw = "";
      res.on("data", c => { raw += c; });
      res.on("end", () => {
        try { resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: JSON.parse(raw) }); }
        catch (e) { resolve({ ok: false, status: res.statusCode, error: "bad json" }); }
      });
    });
    req.on("error", (e) => resolve({ ok: false, error: e.message }));
    req.on("timeout", () => { req.destroy(); resolve({ ok: false, error: "timeout" }); });
    req.write(body);
    req.end();
  });
}

function getJSON(urlStr, timeoutMs) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(urlStr); } catch (e) { return resolve({ ok: false, error: "bad url" }); }
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === "https:" ? 443 : 80),
      path: u.pathname + (u.search || ""),
      method: "GET",
      timeout: timeoutMs || 5000
    }, (res) => {
      let raw = "";
      res.on("data", c => { raw += c; });
      res.on("end", () => {
        try { resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: JSON.parse(raw) }); }
        catch (e) { resolve({ ok: false, status: res.statusCode, error: "bad json" }); }
      });
    });
    req.on("error", (e) => resolve({ ok: false, error: e.message }));
    req.on("timeout", () => { req.destroy(); resolve({ ok: false, error: "timeout" }); });
    req.end();
  });
}

/* ---------- line-item templates ("frequent jobs") ---------- */
function readTemplates() {
  ensureDataDir();
  try {
    const raw = fs.readFileSync(TEMPLATES_FILE, "utf8");
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

function writeTemplates(templates) {
  ensureDataDir();
  const tmp = TEMPLATES_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(templates, null, 2), "utf8");
  fs.renameSync(tmp, TEMPLATES_FILE);
}

function cleanTemplate(body) {
  const name = String(body.name || "").trim().slice(0, 80);
  if (!name) throw new Error("template needs a name");
  const items = cleanItems(body.items);
  if (!items.length) throw new Error("template needs at least one line item");
  return {
    id: newId("t_"),
    name,
    trade: String(body.trade || "General Handyman").slice(0, 60),
    items,
    createdAt: new Date().toISOString()
  };
}

/* ---------- customer directory (aggregated from quotes) ---------- */
function customerDirectory(quotes) {
  const map = {};
  for (const q of quotes) {
    const name = String(q.customer || "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (!map[key]) {
      map[key] = {
        name, phone: q.phone || "", email: q.email || "",
        quotes: 0, won: 0, lost: 0,
        totalQuoted: 0, totalWon: 0, lastQuoteAt: ""
      };
    }
    const c = map[key];
    c.quotes++;
    const total = Number((q.totals && q.totals.total) || 0);
    c.totalQuoted = Math.round((c.totalQuoted + total) * 100) / 100;
    if (q.status === "won") { c.won++; c.totalWon = Math.round((c.totalWon + total) * 100) / 100; }
    if (q.status === "lost") c.lost++;
    if (!c.phone && q.phone) c.phone = q.phone;
    if (!c.email && q.email) c.email = q.email;
    if (String(q.createdAt || "") > c.lastQuoteAt) c.lastQuoteAt = q.createdAt || "";
  }
  return Object.keys(map).map(k => map[k])
    .sort((a, b) => b.totalQuoted - a.totalQuoted);
}

/* Snapshot the old items/totals before an edit, so the owner can restore. */
function snapshotVersion(q) {
  q.history = Array.isArray(q.history) ? q.history : [];
  q.history.unshift({
    at: new Date().toISOString(),
    items: q.items,
    totals: q.totals
  });
  if (q.history.length > 20) q.history.length = 20;
}

function nextQuoteNumber(quotes) {
  const year = new Date().getFullYear();
  const prefix = "Q-" + year + "-";
  let max = 0;
  for (const q of quotes) {
    const m = /^Q-(\d{4})-(\d+)$/.exec(q.number || "");
    if (m && Number(m[1]) === year) max = Math.max(max, Number(m[2]));
  }
  return prefix + String(max + 1).padStart(4, "0");
}

/* ---------- second sweep: payment terms, expiry, duplicate ---------- */
const PAYMENT_TERMS = ["Due on receipt", "Net 15", "Net 30", "Net 60"];
function cleanTerms(v) {
  const s = String(v || "");
  return PAYMENT_TERMS.indexOf(s) !== -1 ? s : PAYMENT_TERMS[0];
}
/* Validity deadline = createdAt + validDays (shared with the browser via generate.js). */
function quoteExpiryISO(q) { return Quotely.quoteExpiryISO(q); }
function isQuoteExpired(q, todayISO) { return Quotely.isQuoteExpired(q, todayISO); }

function cleanItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .filter(i => i && (i.description || Number(i.unitPrice) || Number(i.qty)))
    .map(i => ({
      description: String(i.description || "").slice(0, 200),
      qty: Math.max(0, Number(i.qty) || 0),
      unit: String(i.unit || "each").slice(0, 20),
      unitPrice: Math.max(0, Math.round((Number(i.unitPrice) || 0) * 100) / 100),
      optional: Boolean(i.optional) // upsell line item: excluded from totals, shown separately
    }));
}

function cleanImportedFrom(v) {
  if (!v || typeof v !== "object") return null;
  const visitId = String(v.visitId || "").trim();
  if (!visitId) return null;
  return {
    service: String(v.service || "sitevisit-ai").slice(0, 40),
    visitId: visitId.slice(0, 60),
    visitNumber: String(v.visitNumber || "").slice(0, 40),
    importedAt: String(v.importedAt || new Date().toISOString()).slice(0, 30)
  };
}

/* Photos are embedded in the quote as downscaled data URLs (no extra files
 * to orphan on delete). Client downscales to <=1280px JPEG before upload. */
var PHOTO_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
function cleanPhotos(photos) {
  if (!Array.isArray(photos)) return [];
  return photos.slice(0, 8).map(function (p) {
    if (!p || typeof p.dataUrl !== "string") return null;
    var du = p.dataUrl.slice(0, 1500000);
    if (!PHOTO_RE.test(du)) return null;
    var tag = String(p.tag || "");
    return {
      dataUrl: du,
      caption: String(p.caption || "").slice(0, 120),
      tag: tag === "before" || tag === "after" ? tag : "",
      addedAt: Math.max(0, Number(p.addedAt) || 0)
    };
  }).filter(Boolean);
}

/* ---------- change orders ---------- */
function cleanChangeOrder(body) {
  const description = String(body.description || "").trim().slice(0, 500);
  if (!description) throw new Error("change order needs a description");
  let items = cleanItems(body.items);
  let delta = Number(body.costDelta);
  if (items.length) {
    delta = items.reduce((a, i) => a + i.qty * i.unitPrice, 0);
  } else if (!isFinite(delta)) {
    throw new Error("change order needs items or a costDelta");
  }
  delta = Math.round(delta * 100) / 100;
  return {
    id: newId("co_"),
    number: "", // assigned by caller (CO-1, CO-2, …)
    description,
    items,
    notes: String(body.notes || "").slice(0, 500),
    costDelta: delta,
    status: "proposed", // proposed -> approved (-> signed via signpilot)
    createdAt: new Date().toISOString(),
    approvedAt: null,
    newTotal: null,
    signpilot: null
  };
}

/* Revised project total = quote total + approved/signed change-order deltas. */
function recomputeRevised(q) {
  const base = Number((q.totals && q.totals.total) || 0);
  const delta = (Array.isArray(q.changeOrders) ? q.changeOrders : [])
    .filter(co => co.status === "approved" || co.status === "signed")
    .reduce((a, co) => a + (Number(co.costDelta) || 0), 0);
  q.revisedTotal = Math.round((base + delta) * 100) / 100;
  return q.revisedTotal;
}

/* ---------- milestone / progress billing ---------- */
const MILESTONE_TEMPLATE = [
  { name: "Deposit", pct: 25 },
  { name: "Rough-in", pct: 50 },
  { name: "Final", pct: 25 }
];
const MILESTONE_STATUSES = ["pending", "billed", "paid"];

function cleanMilestones(body, revisedTotal) {
  let defs = MILESTONE_TEMPLATE;
  if (Array.isArray(body.milestones) && body.milestones.length) {
    defs = body.milestones;
  } else if (body.template && body.template !== "standard") {
    throw new Error("unknown milestone template: " + body.template);
  }
  return defs.map(d => {
    const name = String(d.name || "").trim().slice(0, 60) || "Milestone";
    const pct = Math.min(100, Math.max(0, Number(d.pct) || 0));
    return {
      id: newId("m_"),
      name,
      pct,
      amount: Math.round(revisedTotal * pct / 100 * 100) / 100,
      status: "pending",
      dueDate: String(d.dueDate || "").slice(0, 10),
      createdAt: new Date().toISOString()
    };
  });
}

/* ---------- signpilot wiring ---------- */
function lineSummary(q) {
  return (q.items || [])
    .map(i => `${i.qty}× ${i.description} — $${(i.qty * i.unitPrice).toFixed(2)}`)
    .join("\n");
}

function signpilotPayload(q, purpose, co) {
  const common = {
    quotelyQuoteId: q.id,
    quotelyQuoteNumber: q.number,
    quotelyPurpose: purpose
  };
  if (purpose === "approval") {
    return {
      template: "quote-approval",
      title: `${q.customer || "Customer"} — quote approval ${q.number}`,
      fields: Object.assign({
        clientName: q.customer || "",
        quoteNumber: q.number,
        workDescription: (q.description ? q.description + "\n\n" : "") + lineSummary(q),
        total: q.revisedTotal != null ? q.revisedTotal : (q.totals && q.totals.total) || 0,
        validDays: q.validDays || 30,
        notes: q.notes || ""
      }, common)
    };
  }
  if (purpose === "change-order" && co) {
    return {
      template: "change-order",
      title: `${q.customer || "Customer"} — change order ${co.number} (${q.number})`,
      fields: Object.assign({
        clientName: q.customer || "",
        projectRef: q.number,
        changeDescription: co.description + (co.items.length ? "\n" + lineSummary({ items: co.items }) : ""),
        costDelta: co.costDelta,
        newTotal: Math.round(((q.revisedTotal != null ? q.revisedTotal : 0) + co.costDelta) * 100) / 100,
        notes: co.notes || "",
        quotelyChangeOrderId: co.id
      }, common)
    };
  }
  if (purpose === "completion") {
    return {
      template: "completion",
      title: `${q.customer || "Customer"} — completion sign-off ${q.number}`,
      fields: Object.assign({
        clientName: q.customer || "",
        projectRef: q.number,
        workSummary: (q.description ? q.description + "\n\n" : "") + lineSummary(q),
        completionDate: new Date().toISOString().slice(0, 10),
        warrantyNote: q.warranty || ""
      }, common)
    };
  }
  return null;
}

/* Create the signpilot document for a pipeline step. Never throws. */
async function createSignpilotDoc(q, purpose, co) {
  if (!SIGNPILOT_URL) return { ok: false, error: "signpilot-not-configured", message: "Set SIGNPILOT_URL to enable signpilot-ai wiring." };
  const payload = signpilotPayload(q, purpose, co);
  if (!payload) return { ok: false, error: "bad-purpose" };
  const r = await postJSON(SIGNPILOT_URL + "/api/documents", payload, 6000);
  if (!r.ok || !r.body || !r.body.document) {
    return { ok: false, error: "signpilot-unreachable", message: (r.body && (r.body.error || (r.body.errors || []).join("; "))) || r.error || ("http " + r.status) };
  }
  return { ok: true, doc: r.body.document };
}

/* ---------- materials-list export (shaped for materiallist-ai) ---------- */
const ML_TRADE_MAP = {
  "Plumbing": "plumbing",
  "Electrical": "electrical",
  "HVAC": "hvac",
  "Carpentry": "carpentry",
  "Painting": "drywall",
  "Roofing": "roofing",
  "Landscaping": "landscaping",
  "Flooring": "flooring"
  // Cleaning / General Handyman have no materiallist-ai bank — the export
  // falls back to the quote's own line items (documented in the README).
};

function buildMaterialsList(q) {
  const mlTrade = ML_TRADE_MAP[q.trade] || null;
  const jobText = [q.description || ""]
    .concat((q.items || []).map(i => `${i.description} x${i.qty}`))
    .join("\n");
  const wastePct = 10;
  let baseItems, quantities = null, note;
  if (mlTrade && ML) {
    const gen = ML.generateList({ jobText, trade: mlTrade });
    baseItems = gen.items;
    quantities = gen.quantities;
    note = `Takeoff generated from the ${mlTrade} materials bank (materiallist-ai, vendored).`;
  } else {
    baseItems = (q.items || []).map(i => ({
      name: i.description + " (from quote)",
      qty: i.qty, unit: i.unit, unitPrice: i.unitPrice,
      note: "Quote line item — refine quantities in MaterialList AI"
    }));
    note = `No materiallist-ai bank for trade "${q.trade}" — quote line items exported as material estimates.`;
  }
  const items = ML ? ML.applyWaste(baseItems, wastePct) : baseItems;
  const bought = items.map(() => false);
  const entry = {
    id: "ml_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    name: `${q.number} — materials`,
    savedAt: new Date().toISOString(),
    trade: mlTrade || String(q.trade || "").toLowerCase(),
    quotelyTrade: q.trade || "",
    jobText,
    wastePct,
    baseItems,
    items,
    bought,
    custom: [],
    actuals: [],
    quantities,
    source: "quotely-ai",
    quoteNumber: q.number
  };
  const csv = ML ? ML.listToCSV(items, bought) : "";
  return {
    format: "materiallist-ai/saved-list@1",
    note,
    mlTrade,
    wastePct,
    entry,
    csv,
    importHint: "In MaterialList AI (same browser), open DevTools console and run: " +
      "var l=JSON.parse(localStorage.getItem('mlai.lists')||'[]');" +
      "l.unshift(<this entry>);localStorage.setItem('mlai.lists',JSON.stringify(l.slice(0,50)));" +
      "then reload — the list appears in its library."
  };
}

/* ---------- optional OpenAI enhancement ---------- */
function generateWithOpenAI(description, trade) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return Promise.resolve(null);
  const payload = JSON.stringify({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: "You are a quote assistant for tradespeople. Given a job description and trade, respond with ONLY a JSON array of line items: [{\"description\": string, \"qty\": number, \"unit\": string, \"unitPrice\": number}]. Use realistic 2026 US prices in USD. Keep it to 3-8 items."
      },
      { role: "user", content: "Trade: " + trade + "\nJob: " + description }
    ],
    temperature: 0.3,
    max_tokens: 800
  });
  return new Promise((resolve) => {
    const req = https.request({
      hostname: "api.openai.com",
      path: "/v1/chat/completions",
      method: "POST",
      headers: {
        "Authorization": "Bearer " + key,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload)
      },
      timeout: 20000
    }, (res) => {
      let body = "";
      res.on("data", c => { body += c; });
      res.on("end", () => {
        try {
          const data = JSON.parse(body);
          const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
          const arr = JSON.parse(text.trim().replace(/^```json|```$/g, "").trim());
          if (Array.isArray(arr) && arr.length) return resolve(cleanItems(arr));
        } catch (e) { /* fall through to local */ }
        resolve(null);
      });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
    req.write(payload);
    req.end();
  });
}

/* ---------- http helpers ---------- */
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function readBody(req, maxBytes) {
  maxBytes = maxBytes || 1e6;
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", c => {
      body += c;
      if (body.length > maxBytes) { req.destroy(); reject(new Error("body too large")); }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); } catch (e) { reject(new Error("invalid json")); }
    });
    req.on("error", reject);
  });
}

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";
  const safe = path.normalize(urlPath).replace(/^(\.\.[\/\\])+/, "");
  const file = path.join(ROOT, safe);
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end("forbidden"); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end("not found"); return; }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

/* Build a fresh quote object from a POST /api/quotes or /api/quotes/import body. */
function buildQuote(body, quotes, importedFrom) {
  const items = cleanItems(body.items);
  const taxRate = Number(body.taxRate) || 0;
  const depositRate = Number(body.depositRate) || 0;
  const discountRate = Math.min(100, Math.max(0, Number(body.discountRate) || 0));
  const totals = Quotely.quoteTotals(items, taxRate, depositRate, discountRate);
  const now = new Date().toISOString();
  const quote = {
    id: newId("q_"),
    number: nextQuoteNumber(quotes),
    status: "draft",
    createdAt: now,
    updatedAt: now,
    company: String(body.company || "").slice(0, 120),
    customer: String(body.customer || "").slice(0, 120),
    phone: String(body.phone || "").slice(0, 60),
    email: String(body.email || "").slice(0, 120),
    trade: String(body.trade || "General Handyman").slice(0, 60),
    description: String(body.description || "").slice(0, 2000),
    items,
    photos: cleanPhotos(body.photos),
    taxRate,
    depositRate,
    discountRate,
    totals,
    changeOrders: [],
    revisedTotal: totals.total,
    milestones: [],
    signpilot: null,
    completion: null,
    importedFrom: importedFrom || null,
    followUp: String(body.followUp || "").slice(0, 10),
    notes: String(body.notes || "").slice(0, 2000),
    internalNotes: String(body.internalNotes || "").slice(0, 2000), // private: never printed on the document
    validDays: Number(body.validDays) || 30,
    paymentTerms: cleanTerms(body.paymentTerms),
    warranty: String(body.warranty || "").slice(0, 500),
    history: []
  };
  return quote;
}

/* ---------- router ---------- */
async function handleApi(req, res) {
  const url = new URL(req.url, "http://localhost");
  const p = url.pathname;

  if (req.method === "GET" && p === "/api/health") {
    return sendJson(res, 200, { ok: true, version: "0.3.0", openai: Boolean(process.env.OPENAI_API_KEY), signpilot: Boolean(SIGNPILOT_URL) });
  }

  /* Canonical line-item / price bank (single source of truth for the
   * trades pipeline; sitevisit-ai consumes this endpoint). */
  if (req.method === "GET" && p === "/api/price-bank") {
    const bank = Quotely.priceBank();
    bank.servedBy = "quotely-ai";
    return sendJson(res, 200, bank);
  }

  /* Optional AI photo analysis (user's own key; never required). */
  if (req.method === "POST" && p === "/api/analyze-photo") {
    if (!process.env.OPENAI_API_KEY) {
      return sendJson(res, 503, { error: "no-key", message: "Set OPENAI_API_KEY to enable AI photo analysis." });
    }
    const body = await readBody(req, 20e6);
    const dataUrl = String(body.dataUrl || "");
    if (!PHOTO_RE.test(dataUrl.slice(0, 1500000))) return sendJson(res, 400, { error: "invalid image" });
    const payload = JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are a quoting assistant for tradespeople. Look at the job-site photo and reply with ONLY JSON: {\"observations\": string (2-3 sentences on the visible work needed), \"items\": [{\"description\": string, \"qty\": number, \"unit\": string, \"unitPrice\": number}]} with 2-5 realistic 2026 US-price line items."
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Trade: " + String(body.trade || "General Handyman") + ". What work does this photo show, and what should the quote include?" },
            { type: "image_url", image_url: { url: dataUrl.slice(0, 1500000), detail: "low" } }
          ]
        }
      ],
      temperature: 0.3,
      max_tokens: 800
    });
    const result = await new Promise((resolve) => {
      const rq = https.request({
        hostname: "api.openai.com",
        path: "/v1/chat/completions",
        method: "POST",
        headers: {
          "Authorization": "Bearer " + process.env.OPENAI_API_KEY,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload)
        },
        timeout: 30000
      }, (rp) => {
        let rb = "";
        rp.on("data", c => { rb += c; });
        rp.on("end", () => {
          try {
            const data = JSON.parse(rb);
            const text = data.choices[0].message.content.trim().replace(/^```json|```$/g, "").trim();
            const parsed = JSON.parse(text);
            resolve({ observations: String(parsed.observations || ""), items: cleanItems(parsed.items) });
          } catch (e) { resolve(null); }
        });
      });
      rq.on("error", () => resolve(null));
      rq.on("timeout", () => { rq.destroy(); resolve(null); });
      rq.write(payload);
      rq.end();
    });
    if (!result) return sendJson(res, 502, { error: "ai-failed", message: "AI analysis failed; try again." });
    return sendJson(res, 200, result);
  }

  if (req.method === "POST" && p === "/api/generate") {
    const body = await readBody(req);
    const description = String(body.description || "");
    const trade = String(body.trade || "General Handyman");
    const aiItems = await generateWithOpenAI(description, trade);
    if (aiItems) return sendJson(res, 200, { items: aiItems, source: "openai" });
    return sendJson(res, 200, { items: cleanItems(Quotely.generateLineItems(description, trade)), source: "local" });
  }

  if (req.method === "GET" && p === "/api/quotes") {
    return sendJson(res, 200, readQuotes());
  }

  /* Import a site-visit quote draft: a sitevisit draft IS a quotely quote.
   * Upserts on importedFrom.visitId so re-sending a visit updates the
   * same quote instead of duplicating it. */
  if (req.method === "POST" && p === "/api/quotes/import") {
    const body = await readBody(req, 20e6);
    const importedFrom = cleanImportedFrom({
      service: body.source || "sitevisit-ai",
      visitId: body.visitId,
      visitNumber: body.visitNumber
    });
    if (!importedFrom) return sendJson(res, 400, { error: "visitId required" });
    const status = String(body.status || "draft");
    if (!["draft", "sent", "won", "lost"].includes(status)) {
      return sendJson(res, 400, { error: "bad status" });
    }
    const quotes = readQuotes();
    const existing = quotes.find(q => q.importedFrom && q.importedFrom.visitId === importedFrom.visitId);
    const mapped = {
      customer: body.customer, phone: body.phone, email: body.email,
      trade: body.trade, description: body.description,
      items: body.items, photos: (body.photos || []).map(ph => ({ dataUrl: ph.dataUrl, caption: ph.name || ph.caption || "" })),
      taxRate: body.taxPct, discountRate: body.discountPct, depositRate: 0,
      followUp: body.followUpDate,
      notes: (body.address ? "Site: " + String(body.address).slice(0, 200) + "\n" : "") + String(body.notes || "")
    };
    if (existing) {
      const items = cleanItems(mapped.items);
      existing.customer = String(mapped.customer || existing.customer || "").slice(0, 120);
      existing.trade = String(mapped.trade || existing.trade || "General Handyman").slice(0, 60);
      existing.description = String(mapped.description || "").slice(0, 2000);
      if (JSON.stringify(items) !== JSON.stringify(existing.items)) {
        snapshotVersion(existing);
        existing.items = items;
      }
      existing.photos = cleanPhotos(mapped.photos);
      existing.taxRate = Number(mapped.taxRate) || 0;
      existing.discountRate = Math.min(100, Math.max(0, Number(mapped.discountRate) || 0));
      existing.totals = Quotely.quoteTotals(existing.items, existing.taxRate, existing.depositRate, existing.discountRate);
      recomputeRevised(existing);
      existing.notes = String(mapped.notes || "").slice(0, 2000);
      if (mapped.followUp) existing.followUp = String(mapped.followUp).slice(0, 10);
      existing.importedFrom.importedAt = new Date().toISOString();
      existing.updatedAt = new Date().toISOString();
      writeQuotes(quotes);
      return sendJson(res, 200, { quote: existing, created: false });
    }
    const quote = buildQuote(mapped, quotes, importedFrom);
    quote.status = status;
    quotes.unshift(quote);
    writeQuotes(quotes);
    return sendJson(res, 201, { quote, created: true });
  }

  /* Line-item templates: save the line items you reuse, apply in one click. */
  if (req.method === "GET" && p === "/api/templates") {
    return sendJson(res, 200, readTemplates());
  }

  if (req.method === "POST" && p === "/api/templates") {
    const body = await readBody(req);
    try {
      const templates = readTemplates();
      const t = cleanTemplate(body);
      templates.unshift(t);
      writeTemplates(templates);
      return sendJson(res, 201, t);
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  const tplMatch = /^\/api\/templates\/([A-Za-z0-9_.-]+)$/.exec(p);
  if (tplMatch && req.method === "DELETE") {
    const templates = readTemplates();
    const idx = templates.findIndex(t => t.id === tplMatch[1]);
    if (idx === -1) return sendJson(res, 404, { error: "template not found" });
    templates.splice(idx, 1);
    writeTemplates(templates);
    return sendJson(res, 200, { ok: true });
  }

  /* Customer directory: lifetime value aggregated from saved quotes. */
  if (req.method === "GET" && p === "/api/customers") {
    return sendJson(res, 200, customerDirectory(readQuotes()));
  }

  /* Restore a quote's line items from a version-history snapshot. */
  const restoreMatch = /^\/api\/quotes\/([A-Za-z0-9_.-]+)\/restore$/.exec(p);
  if (restoreMatch && req.method === "POST") {
    const quotes = readQuotes();
    const q = quotes.find(x => x.id === restoreMatch[1]);
    if (!q) return sendJson(res, 404, { error: "quote not found" });
    const body = await readBody(req);
    const idx = Number(body.index);
    const hist = Array.isArray(q.history) ? q.history : [];
    if (!Number.isInteger(idx) || idx < 0 || idx >= hist.length) {
      return sendJson(res, 400, { error: "unknown version" });
    }
    const snap = hist[idx]; // capture before snapshotVersion mutates the array
    snapshotVersion(q); // the current items become restorable too
    q.items = cleanItems(snap.items);
    q.totals = Quotely.quoteTotals(q.items, q.taxRate, q.depositRate, q.discountRate);
    recomputeRevised(q);
    q.updatedAt = new Date().toISOString();
    writeQuotes(quotes);
    return sendJson(res, 200, q);
  }

  /* Duplicate a quote into a fresh draft (new number, reset dates/status). */
  const dupMatch = /^\/api\/quotes\/([A-Za-z0-9_.-]+)\/duplicate$/.exec(p);
  if (dupMatch && req.method === "POST") {
    const quotes = readQuotes();
    const src = quotes.find(x => x.id === dupMatch[1]);
    if (!src) return sendJson(res, 404, { error: "quote not found" });
    const items = cleanItems(src.items);
    const now = new Date().toISOString();
    const copy = {
      id: newId("q_"),
      number: nextQuoteNumber(quotes),
      status: "draft",
      createdAt: now,
      updatedAt: now,
      company: src.company || "", customer: src.customer || "",
      phone: src.phone || "", email: src.email || "",
      trade: src.trade || "General Handyman",
      description: src.description || "",
      items,
      photos: cleanPhotos(src.photos),
      taxRate: Number(src.taxRate) || 0,
      depositRate: Number(src.depositRate) || 0,
      discountRate: Number(src.discountRate) || 0,
      totals: Quotely.quoteTotals(items, Number(src.taxRate) || 0, Number(src.depositRate) || 0, Number(src.discountRate) || 0),
      changeOrders: [],
      revisedTotal: 0,
      milestones: [],
      signpilot: null,
      completion: null,
      importedFrom: null,
      followUp: "",
      notes: src.notes || "",
      internalNotes: src.internalNotes || "",
      validDays: Number(src.validDays) || 30,
      paymentTerms: cleanTerms(src.paymentTerms),
      warranty: String(src.warranty || "").slice(0, 500),
      history: []
    };
    copy.revisedTotal = copy.totals.total;
    quotes.unshift(copy);
    writeQuotes(quotes);
    return sendJson(res, 201, copy);
  }

  /* ---------- change orders (won quotes only) ---------- */
  const coMatch = /^\/api\/quotes\/([A-Za-z0-9_.-]+)\/change-orders$/.exec(p);
  if (coMatch && req.method === "POST") {
    const quotes = readQuotes();
    const q = quotes.find(x => x.id === coMatch[1]);
    if (!q) return sendJson(res, 404, { error: "quote not found" });
    if (q.status !== "won") return sendJson(res, 400, { error: "change orders require a won quote" });
    const body = await readBody(req);
    try {
      const co = cleanChangeOrder(body);
      q.changeOrders = Array.isArray(q.changeOrders) ? q.changeOrders : [];
      co.number = "CO-" + (q.changeOrders.length + 1);
      q.changeOrders.push(co);
      recomputeRevised(q);
      q.updatedAt = new Date().toISOString();
      writeQuotes(quotes);
      return sendJson(res, 201, co);
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  const coApproveMatch = /^\/api\/quotes\/([A-Za-z0-9_.-]+)\/change-orders\/([A-Za-z0-9_.-]+)\/approve$/.exec(p);
  if (coApproveMatch && req.method === "POST") {
    const quotes = readQuotes();
    const q = quotes.find(x => x.id === coApproveMatch[1]);
    if (!q) return sendJson(res, 404, { error: "quote not found" });
    const co = (q.changeOrders || []).find(c => c.id === coApproveMatch[2]);
    if (!co) return sendJson(res, 404, { error: "change order not found" });
    if (co.status !== "proposed") return sendJson(res, 400, { error: "change order is already " + co.status });
    co.status = "approved";
    co.approvedAt = new Date().toISOString();
    co.newTotal = Math.round((recomputeRevised(q) + 0) * 100) / 100;
    q.updatedAt = new Date().toISOString();
    writeQuotes(quotes);
    return sendJson(res, 200, { changeOrder: co, revisedTotal: q.revisedTotal });
  }

  /* ---------- milestone / progress billing ---------- */
  const msMatch = /^\/api\/quotes\/([A-Za-z0-9_.-]+)\/milestones$/.exec(p);
  if (msMatch && req.method === "POST") {
    const quotes = readQuotes();
    const q = quotes.find(x => x.id === msMatch[1]);
    if (!q) return sendJson(res, 404, { error: "quote not found" });
    if (q.status !== "won") return sendJson(res, 400, { error: "milestones require a won quote" });
    const body = await readBody(req);
    try {
      recomputeRevised(q);
      q.milestones = cleanMilestones(body, q.revisedTotal);
      q.updatedAt = new Date().toISOString();
      writeQuotes(quotes);
      return sendJson(res, 201, { milestones: q.milestones, revisedTotal: q.revisedTotal });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  const msPatchMatch = /^\/api\/quotes\/([A-Za-z0-9_.-]+)\/milestones\/([A-Za-z0-9_.-]+)$/.exec(p);
  if (msPatchMatch && req.method === "PATCH") {
    const quotes = readQuotes();
    const q = quotes.find(x => x.id === msPatchMatch[1]);
    if (!q) return sendJson(res, 404, { error: "quote not found" });
    const m = (q.milestones || []).find(x => x.id === msPatchMatch[2]);
    if (!m) return sendJson(res, 404, { error: "milestone not found" });
    const body = await readBody(req);
    const st = String(body.status || "");
    if (!MILESTONE_STATUSES.includes(st)) {
      return sendJson(res, 400, { error: "status must be one of: " + MILESTONE_STATUSES.join(", ") });
    }
    m.status = st;
    m.updatedAt = new Date().toISOString();
    q.updatedAt = new Date().toISOString();
    writeQuotes(quotes);
    return sendJson(res, 200, { milestone: m });
  }

  /* ---------- signpilot pipeline ---------- */
  const spReqMatch = /^\/api\/quotes\/([A-Za-z0-9_.-]+)\/signpilot-request$/.exec(p);
  if (spReqMatch && req.method === "POST") {
    const quotes = readQuotes();
    const q = quotes.find(x => x.id === spReqMatch[1]);
    if (!q) return sendJson(res, 404, { error: "quote not found" });
    const body = await readBody(req);
    const purpose = String(body.purpose || "approval");
    if (!["approval", "change-order", "completion"].includes(purpose)) {
      return sendJson(res, 400, { error: "purpose must be approval, change-order, or completion" });
    }
    if (!SIGNPILOT_URL) return sendJson(res, 503, { error: "signpilot-not-configured", message: "Set SIGNPILOT_URL to enable signpilot-ai wiring." });
    let co = null;
    if (purpose === "change-order") {
      co = (q.changeOrders || []).find(c => c.id === String(body.changeOrderId || ""));
      if (!co) return sendJson(res, 404, { error: "change order not found" });
      if (co.signpilot && co.signpilot.docId && co.signpilot.status !== "declined") {
        return sendJson(res, 409, { error: "change order already has a signpilot document" });
      }
    } else if (purpose === "approval") {
      if (q.signpilot && q.signpilot.docId && q.signpilot.status !== "declined") {
        return sendJson(res, 409, { error: "approval already requested for this quote" });
      }
    } else if (purpose === "completion") {
      if (q.status !== "won") return sendJson(res, 400, { error: "completion sign-off requires a won quote" });
      if (q.completion && q.completion.docId && q.completion.status !== "declined") {
        return sendJson(res, 409, { error: "completion sign-off already requested" });
      }
    }
    const r = await createSignpilotDoc(q, purpose, co);
    if (!r.ok) return sendJson(res, 502, { error: r.error, message: r.message });
    const ref = { docId: r.doc.id, docNumber: r.doc.number, status: "pending", requestedAt: new Date().toISOString(), signedAt: null };
    if (purpose === "approval") q.signpilot = ref;
    else if (purpose === "change-order") { co.signpilot = ref; }
    else q.completion = ref;
    q.updatedAt = new Date().toISOString();
    writeQuotes(quotes);
    return sendJson(res, 201, { ok: true, purpose, document: { id: r.doc.id, number: r.doc.number } });
  }

  /* signpilot -> quotely callback: a linked document was signed or declined.
   * Called by signpilot-ai (QUOTELY_URL) — no auth, local-only by design. */
  const spCbMatch = /^\/api\/quotes\/([A-Za-z0-9_.-]+)\/signpilot-callback$/.exec(p);
  if (spCbMatch && req.method === "POST") {
    const quotes = readQuotes();
    const q = quotes.find(x => x.id === spCbMatch[1]);
    if (!q) return sendJson(res, 404, { error: "quote not found" });
    const body = await readBody(req);
    const purpose = String(body.purpose || "approval");
    const st = String(body.status || "");
    if (!["signed", "declined"].includes(st)) return sendJson(res, 400, { error: "status must be signed or declined" });
    const at = String(body.signedAt || body.declinedAt || new Date().toISOString());
    if (purpose === "change-order" && body.changeOrderId) {
      const co = (q.changeOrders || []).find(c => c.id === String(body.changeOrderId));
      if (!co) return sendJson(res, 404, { error: "change order not found" });
      co.signpilot = co.signpilot || {};
      co.signpilot.status = st;
      co.signpilot.docId = String(body.docId || co.signpilot.docId || "");
      co.signpilot.docNumber = String(body.docNumber || co.signpilot.docNumber || "");
      if (st === "signed") { co.signpilot.signedAt = at; co.status = "signed"; }
    } else if (purpose === "completion") {
      q.completion = q.completion || {};
      q.completion.status = st;
      q.completion.docId = String(body.docId || q.completion.docId || "");
      q.completion.docNumber = String(body.docNumber || q.completion.docNumber || "");
      if (st === "signed") { q.completion.signedAt = at; q.completedAt = at; }
    } else {
      q.signpilot = q.signpilot || {};
      q.signpilot.status = st;
      q.signpilot.docId = String(body.docId || q.signpilot.docId || "");
      q.signpilot.docNumber = String(body.docNumber || q.signpilot.docNumber || "");
      if (st === "signed") {
        q.signpilot.signedAt = at;
      } else {
        // Client declined the approval: reopen the quote so it isn't
        // stuck "won" on a rejected deal.
        q.status = "sent";
        q.notes = (q.notes ? q.notes + "\n" : "") +
          "Client declined the quote approval" + (body.declineReason ? ": " + String(body.declineReason).slice(0, 200) : ".") +
          " (" + at.slice(0, 10) + ")";
      }
    }
    q.updatedAt = new Date().toISOString();
    writeQuotes(quotes);
    return sendJson(res, 200, { ok: true, quote: q.id, purpose, status: st });
  }

  /* Poll the linked signpilot document and refresh the quote's copy of its
   * status (covers the case where the callback couldn't reach quotely). */
  const spSyncMatch = /^\/api\/quotes\/([A-Za-z0-9_.-]+)\/sync-signpilot$/.exec(p);
  if (spSyncMatch && req.method === "POST") {
    const quotes = readQuotes();
    const q = quotes.find(x => x.id === spSyncMatch[1]);
    if (!q) return sendJson(res, 404, { error: "quote not found" });
    if (!SIGNPILOT_URL) return sendJson(res, 503, { error: "signpilot-not-configured" });
    const docId = q.signpilot && q.signpilot.docId;
    if (!docId) return sendJson(res, 400, { error: "no linked signpilot document" });
    const r = await getJSON(SIGNPILOT_URL + "/api/documents/" + encodeURIComponent(docId), 5000);
    if (!r.ok || !r.body || !r.body.document) {
      return sendJson(res, 502, { error: "signpilot-unreachable", message: r.error || ("http " + r.status) });
    }
    const doc = r.body.document;
    const map = { signed: "signed", declined: "declined", sent: "pending", draft: "pending" };
    q.signpilot.status = map[doc.status] || q.signpilot.status;
    if (doc.status === "signed" && doc.signedAt) q.signpilot.signedAt = doc.signedAt;
    q.updatedAt = new Date().toISOString();
    writeQuotes(quotes);
    return sendJson(res, 200, { ok: true, signpilot: q.signpilot, docStatus: doc.status });
  }

  /* One-click materials-list export shaped for materiallist-ai
   * (read-only contract — materiallist-ai itself is never modified). */
  const mlMatch = /^\/api\/quotes\/([A-Za-z0-9_.-]+)\/materials-list$/.exec(p);
  if (mlMatch && req.method === "GET") {
    const quotes = readQuotes();
    const q = quotes.find(x => x.id === mlMatch[1]);
    if (!q) return sendJson(res, 404, { error: "quote not found" });
    if (url.searchParams.get("format") === "csv") {
      const built = buildMaterialsList(q);
      res.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${q.number}-materials.csv"`
      });
      return res.end("﻿" + built.csv);
    }
    return sendJson(res, 200, buildMaterialsList(q));
  }

  if (req.method === "POST" && p === "/api/quotes") {
    const body = await readBody(req, 20e6);
    const quotes = readQuotes();
    const quote = buildQuote(body, quotes, cleanImportedFrom(body.importedFrom));
    quotes.unshift(quote);
    writeQuotes(quotes);
    return sendJson(res, 201, quote);
  }

  const idMatch = /^\/api\/quotes\/([A-Za-z0-9_.-]+)$/.exec(p);
  if (idMatch) {
    const id = idMatch[1];
    const quotes = readQuotes();
    const idx = quotes.findIndex(q => q.id === id);
    if (idx === -1) return sendJson(res, 404, { error: "quote not found" });

    if (req.method === "GET") {
      return sendJson(res, 200, quotes[idx]);
    }

    if (req.method === "PUT") {
      const body = await readBody(req, 20e6);
      const q = quotes[idx];
      const prevStatus = q.status;
      const allowed = ["status", "followUp", "notes", "internalNotes", "customer", "phone", "email", "company", "trade", "description", "taxRate", "depositRate", "discountRate", "validDays", "items", "photos", "paymentTerms", "warranty", "importedFrom"];
      for (const k of allowed) {
        if (body[k] === undefined) continue;
        if (k === "paymentTerms") {
          q.paymentTerms = cleanTerms(body.paymentTerms);
        } else if (k === "internalNotes") {
          q.internalNotes = String(body.internalNotes || "").slice(0, 2000);
        } else if (k === "warranty") {
          q.warranty = String(body.warranty || "").slice(0, 500);
        } else if (k === "importedFrom") {
          const im = cleanImportedFrom(body.importedFrom);
          if (im) q.importedFrom = im;
        } else if (k === "items") {
          const next = cleanItems(body.items);
          if (JSON.stringify(next) !== JSON.stringify(q.items)) {
            snapshotVersion(q); // keep the old line items restorable
            q.items = next;
            q.totals = Quotely.quoteTotals(q.items, q.taxRate, q.depositRate, q.discountRate);
            recomputeRevised(q);
          }
        } else if (k === "photos") {
          q.photos = cleanPhotos(body.photos);
        } else if (k === "taxRate" || k === "depositRate" || k === "discountRate") {
          q[k] = k === "discountRate"
            ? Math.min(100, Math.max(0, Number(body[k]) || 0))
            : Number(body[k]) || 0;
          q.totals = Quotely.quoteTotals(q.items, q.taxRate, q.depositRate, q.discountRate);
          recomputeRevised(q);
        } else if (k === "status") {
          const s = String(body.status);
          if (["draft", "sent", "won", "lost"].includes(s)) q.status = s;
        } else {
          q[k] = String(body[k]).slice(0, 2000);
        }
      }
      q.updatedAt = new Date().toISOString();

      /* Quote won -> ask signpilot-ai for a client approval (best effort;
       * the quote stays won even if signpilot is unreachable). */
      if (prevStatus !== "won" && q.status === "won") {
        if (SIGNPILOT_URL && !(q.signpilot && q.signpilot.docId)) {
          const r = await createSignpilotDoc(q, "approval", null);
          q.signpilot = r.ok
            ? { docId: r.doc.id, docNumber: r.doc.number, status: "pending", requestedAt: new Date().toISOString(), signedAt: null }
            : { docId: null, docNumber: null, status: "pending", requestedAt: new Date().toISOString(), signedAt: null, error: r.error, message: r.message };
        } else if (!SIGNPILOT_URL) {
          q.signpilot = q.signpilot || { status: "not-configured", note: "Set SIGNPILOT_URL to auto-request client approvals." };
        }
      }

      writeQuotes(quotes);
      return sendJson(res, 200, q);
    }

    if (req.method === "DELETE") {
      quotes.splice(idx, 1);
      writeQuotes(quotes);
      return sendJson(res, 200, { ok: true });
    }
  }

  return sendJson(res, 404, { error: "not found" });
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) {
    handleApi(req, res).catch(err => {
      if (!res.headersSent) sendJson(res, err.message === "invalid json" ? 400 : 500, { error: err.message });
    });
  } else {
    serveStatic(req, res);
  }
});

server.listen(PORT, () => {
  console.log("Quotely AI listening on http://localhost:" + PORT);
});

module.exports = server;
