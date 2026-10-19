/* Test stub: fake signpilot-ai for quotely-ai pipeline tests. NOT shipped. */
"use strict";
const http = require("http");
const port = Number(process.argv[2] || 3499);
const docs = {};
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  let body = "";
  req.on("data", c => { body += c; });
  req.on("end", () => {
    res.setHeader("Content-Type", "application/json");
    const send = (code, obj) => { res.writeHead(code); res.end(JSON.stringify(obj)); };
    if (req.method === "POST" && u.pathname === "/api/documents") {
      let j = {};
      try { j = JSON.parse(body || "{}"); } catch (e) { return send(400, { error: "bad json" }); }
      const id = "stub_" + Math.random().toString(36).slice(2, 8);
      const d = {
        id, number: "SP-2026-" + String(Object.keys(docs).length + 1).padStart(4, "0"),
        template: j.template, title: j.title, fields: j.fields || {},
        status: "draft", createdAt: new Date().toISOString(), sentAt: null, signedAt: null
      };
      docs[id] = d;
      return send(201, { ok: true, document: d });
    }
    if (req.method === "GET" && u.pathname === "/stub/docs") {
      return send(200, { docs: Object.values(docs) });
    }
    if (req.method === "POST" && u.pathname === "/stub/set-status") {
      let j = {};
      try { j = JSON.parse(body || "{}"); } catch (e) { return send(400, { error: "bad json" }); }
      if (docs[j.id]) {
        docs[j.id].status = j.status;
        if (j.status === "signed") docs[j.id].signedAt = new Date().toISOString();
        if (j.status === "sent") docs[j.id].sentAt = new Date().toISOString();
      }
      return send(200, { ok: true });
    }
    const m = /^\/api\/documents\/([^/]+)$/.exec(u.pathname);
    if (req.method === "GET" && m) {
      const d = docs[m[1]];
      if (!d) return send(404, { error: "not found" });
      return send(200, { document: d });
    }
    return send(404, {});
  });
});
server.listen(port, () => console.log("stub signpilot-ai on " + port));
