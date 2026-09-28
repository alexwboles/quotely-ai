/*
 * Quotely AI - tiny zero-dependency Node server.
 * Serves the single-page app and a small JSON API for quote generation
 * and quote storage (data/quotes.json).
 *
 * Quote generation works with NO API key via the local heuristic engine.
 * If OPENAI_API_KEY is set, /api/generate will try OpenAI first and fall
 * back to the local engine on any failure. The key is never required.
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const https = require("https");

const Quotely = require("./public/generate.js");

const PORT = Number(process.env.PORT) || 3000;
const ROOT = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "quotes.json");

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

function nextQuoteNumber(quotes) {
  const year = new Date().getFullYear();
  let max = 0;
  for (const q of quotes) {
    const m = /^Q-(\d{4})-(\d+)$/.exec(q.number || "");
    if (m && Number(m[1]) === year) max = Math.max(max, Number(m[2]));
  }
  return "Q-" + year + "-" + String(max + 1).padStart(4, "0");
}

function cleanItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .filter(i => i && (i.description || Number(i.unitPrice) || Number(i.qty)))
    .map(i => ({
      description: String(i.description || "").slice(0, 200),
      qty: Math.max(0, Number(i.qty) || 0),
      unit: String(i.unit || "each").slice(0, 20),
      unitPrice: Math.max(0, Math.round((Number(i.unitPrice) || 0) * 100) / 100)
    }));
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
      tag: tag === "before" || tag === "after" ? tag : ""
    };
  }).filter(Boolean);
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

/* ---------- router ---------- */
async function handleApi(req, res) {
  const url = new URL(req.url, "http://localhost");
  const p = url.pathname;

  if (req.method === "GET" && p === "/api/health") {
    return sendJson(res, 200, { ok: true, version: "0.2.0", openai: Boolean(process.env.OPENAI_API_KEY) });
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

  if (req.method === "POST" && p === "/api/quotes") {
    const body = await readBody(req, 20e6);
    const quotes = readQuotes();
    const items = cleanItems(body.items);
    const totals = Quotely.quoteTotals(items, body.taxRate, body.depositRate);
    const now = new Date().toISOString();
    const quote = {
      id: "q_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
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
      taxRate: Number(body.taxRate) || 0,
      depositRate: Number(body.depositRate) || 0,
      totals,
      followUp: String(body.followUp || "").slice(0, 10),
      notes: String(body.notes || "").slice(0, 2000),
      validDays: Number(body.validDays) || 30
    };
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

    if (req.method === "PUT") {
      const body = await readBody(req, 20e6);
      const q = quotes[idx];
      const allowed = ["status", "followUp", "notes", "customer", "phone", "email", "company", "trade", "description", "taxRate", "depositRate", "validDays", "items", "photos"];
      for (const k of allowed) {
        if (body[k] === undefined) continue;
        if (k === "items") {
          q.items = cleanItems(body.items);
          q.totals = Quotely.quoteTotals(q.items, q.taxRate, q.depositRate);
        } else if (k === "photos") {
          q.photos = cleanPhotos(body.photos);
        } else if (k === "taxRate" || k === "depositRate") {
          q[k] = Number(body[k]) || 0;
          q.totals = Quotely.quoteTotals(q.items, q.taxRate, q.depositRate);
        } else if (k === "status") {
          const s = String(body.status);
          if (["draft", "sent", "won", "lost"].includes(s)) q.status = s;
        } else {
          q[k] = String(body[k]).slice(0, 2000);
        }
      }
      q.updatedAt = new Date().toISOString();
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
