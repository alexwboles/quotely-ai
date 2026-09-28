/* Quotely AI - frontend app (no build step, no deps) */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var money = function (n) { return "$" + (Number(n) || 0).toFixed(2); };
  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };

  var state = {
    items: [],
    photos: [],
    quotes: [],
    settings: loadSettings()
  };

  /* ---------- settings (localStorage) ---------- */
  function loadSettings() {
    try { return JSON.parse(localStorage.getItem("quotely_settings") || "{}"); }
    catch (e) { return {}; }
  }
  function saveSettings() {
    localStorage.setItem("quotely_settings", JSON.stringify(state.settings));
  }

  /* ---------- tabs ---------- */
  var tabs = document.querySelectorAll(".tab");
  tabs.forEach(function (t) {
    t.addEventListener("click", function () {
      tabs.forEach(function (x) { x.classList.remove("active"); });
      t.classList.add("active");
      ["new", "quotes", "settings"].forEach(function (k) {
        $("tab-" + k).classList.toggle("hidden", k !== t.dataset.tab);
      });
      var shown = $("tab-" + t.dataset.tab);
      shown.classList.remove("view-enter");
      void shown.offsetWidth;
      shown.classList.add("view-enter");
      if (t.dataset.tab === "quotes") loadQuotes();
    });
  });

  /* ---------- trade selector ---------- */
  var tradeSel = $("trade");
  Quotely.TRADES.forEach(function (t) {
    var o = document.createElement("option");
    o.value = t; o.textContent = t;
    tradeSel.appendChild(o);
  });

  /* ---------- job photos ---------- */
  var dz = $("dropzone"), photoInput = $("photoInput");

  function processImageFile(file) {
    return new Promise(function (resolve, reject) {
      if (!/^image\//.test(file.type)) return reject(new Error("not an image"));
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        try {
          var max = 1280;
          var scale = Math.min(1, max / Math.max(img.width, img.height));
          var w = Math.max(1, Math.round(img.width * scale));
          var h = Math.max(1, Math.round(img.height * scale));
          var c = document.createElement("canvas");
          c.width = w; c.height = h;
          c.getContext("2d").drawImage(img, 0, 0, w, h);
          URL.revokeObjectURL(url);
          resolve({ dataUrl: c.toDataURL("image/jpeg", 0.82), width: img.width, height: img.height });
        } catch (e) { URL.revokeObjectURL(url); reject(e); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("bad image")); };
      img.src = url;
    });
  }

  /* Local, on-device analysis: dimensions, dominant colors, brightness, sharpness. */
  function analyzeLocal(dataUrl) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        try {
          var S = 48;
          var c = document.createElement("canvas");
          c.width = S; c.height = S;
          var ctx = c.getContext("2d");
          ctx.drawImage(img, 0, 0, S, S);
          var d = ctx.getImageData(0, 0, S, S).data;
          var buckets = {}, lumSum = 0, n = S * S, gray = [];
          for (var i = 0; i < d.length; i += 4) {
            var r = d[i], g = d[i + 1], b = d[i + 2];
            var lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            lumSum += lum; gray.push(lum);
            var key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
            buckets[key] = (buckets[key] || 0) + 1;
          }
          var palette = Object.keys(buckets).sort(function (a, b) { return buckets[b] - buckets[a]; })
            .slice(0, 5).map(function (k) {
              k = Number(k);
              var rr = ((k >> 6) & 7) * 36 + 18, gg = ((k >> 3) & 7) * 36 + 18, bb = (k & 7) * 36 + 18;
              return "#" + [rr, gg, bb].map(function (v) { return v.toString(16).padStart(2, "0"); }).join("");
            });
          var vals = [], mean = 0, y, x;
          for (y = 1; y < S - 1; y++) for (x = 1; x < S - 1; x++) {
            var v = gray[y * S + x] * 4 - gray[(y - 1) * S + x] - gray[(y + 1) * S + x] - gray[y * S + x - 1] - gray[y * S + x + 1];
            vals.push(v); mean += v;
          }
          mean /= vals.length;
          var variance = vals.reduce(function (a, v) { return a + (v - mean) * (v - mean); }, 0) / vals.length;
          var brightness = lumSum / n;
          var flags = [];
          if (brightness < 55) flags.push("dark");
          if (variance < 30) flags.push("blurry");
          resolve({ width: img.width, height: img.height, palette: palette, flags: flags });
        } catch (e) { resolve(null); }
      };
      img.onerror = function () { resolve(null); };
      img.src = dataUrl;
    });
  }

  function addPhotoFiles(files) {
    Array.prototype.slice.call(files || []).forEach(function (f) {
      if (state.photos.length >= 8) return;
      processImageFile(f).then(function (p) {
        if (state.photos.length >= 8) return;
        var photo = { dataUrl: p.dataUrl, caption: "", tag: "", addedAt: Date.now(), analysis: null, ai: null, _freshAt: Date.now() };
        state.photos.push(photo);
        renderPhotoGrid(); renderPreview();
        analyzeLocal(p.dataUrl).then(function (a) {
          photo.analysis = a;
          renderPhotoGrid();
        });
      }).catch(function () { /* skip unreadable files */ });
    });
  }

  dz.addEventListener("click", function () { photoInput.click(); });
  dz.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") photoInput.click(); });
  photoInput.addEventListener("change", function () { addPhotoFiles(photoInput.files); photoInput.value = ""; });
  ["dragover", "dragenter"].forEach(function (ev) {
    dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add("drag"); });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove("drag"); });
  });
  dz.addEventListener("drop", function (e) {
    addPhotoFiles(e.dataTransfer.files);
    dz.classList.remove("dropped");
    void dz.offsetWidth;
    dz.classList.add("dropped");
    setTimeout(function () { dz.classList.remove("dropped"); }, 600);
  });

  function fmtTime(ts) {
    if (!ts) return "";
    var d = new Date(Number(ts));
    var date = d.toLocaleString("en-US", { month: "short" }) + " " + d.getDate();
    var time = d.toLocaleString("en-US", { hour: "numeric", minute: "2-digit" });
    return (date + " · " + time).toUpperCase();
  }

  function renderPhotoGrid() {
    var grid = $("photoGrid");
    $("photoCount").textContent = state.photos.length ? "(" + state.photos.length + "/8)" : "";
    grid.innerHTML = "";
    if (!state.photos.length) {
      grid.innerHTML =
        '<div class="frame-empty" data-browse><span>+</span><em>FRAME 01</em></div>' +
        '<div class="frame-empty" data-browse><span>+</span><em>FRAME 02</em></div>' +
        '<div class="frame-empty" data-browse><span>+</span><em>FRAME 03</em></div>';
      grid.querySelectorAll("[data-browse]").forEach(function (el) {
        el.addEventListener("click", function () { photoInput.click(); });
      });
      return;
    }
    state.photos.forEach(function (p, i) {
      var card = document.createElement("div");
      card.className = "photo-card" + (p.tag ? " tag-" + p.tag : "");
      if (Date.now() - (p._freshAt || 0) < 2200) card.classList.add("developing");
      var a = p.analysis;
      var flags = a && a.flags.length
        ? '<span class="flag warn">' + a.flags.join(" · ") + " — retake?</span>"
        : (a ? '<span class="flag ok">looks good</span>' : '<span class="flag">analyzing…</span>');
      var swatches = a ? a.palette.map(function (hex) {
        return '<span class="swatch" style="background:' + hex + '" title="' + hex + '"></span>';
      }).join("") : "";
      var dims = a ? a.width + "×" + a.height : "";
      var aiBlock = "";
      if (p.aiLoading) aiBlock = '<div class="ai-panel">Asking the AI to look at this photo…</div>';
      else if (p.ai) {
        aiBlock = '<div class="ai-panel"><strong>AI sees:</strong> ' + esc(p.ai.observations) +
          (p.ai.items && p.ai.items.length
            ? '<div class="ai-items">' + p.ai.items.map(function (it, k) {
                return "<div>" + esc(it.description) + " — " + money(it.unitPrice) + "</div>";
              }).join("") + '</div><button class="small primary" data-aiadd="' + i + '">Add to line items</button>'
            : "") + "</div>";
      } else if (p.aiError) {
        aiBlock = '<div class="ai-panel warn">' + esc(p.aiError) + "</div>";
      }
      card.innerHTML =
        '<div class="frame-head"><span class="frame-no">' + String(i + 1).padStart(2, "0") + '</span>' +
        '<span class="frame-time">' + esc(fmtTime(p.addedAt)) + "</span></div>" +
        '<div class="frame"><img src="' + p.dataUrl + '" alt="job photo"></div>' +
        '<input class="cap" data-cap="' + i + '" placeholder="Caption…" value="' + esc(p.caption) + '">' +
        '<div class="photo-meta">' +
          '<div class="tagrow">' +
            '<button class="tag' + (p.tag === "" ? " on" : "") + '" data-tag="' + i + '|">—</button>' +
            '<button class="tag' + (p.tag === "before" ? " on" : "") + '" data-tag="' + i + '|before">Before</button>' +
            '<button class="tag' + (p.tag === "after" ? " on" : "") + '" data-tag="' + i + '|after">After</button>' +
          "</div>" +
          '<button class="small ghost" data-aiphoto="' + i + '">AI look</button>' +
          '<button class="small danger-ghost" data-delphoto="' + i + '">✕</button>' +
        "</div>" +
        '<div class="photo-analysis">' + flags + '<span class="dims">' + dims + "</span>" +
        (swatches ? '<span class="swatches">' + swatches + "</span>" : "") + "</div>" +
        aiBlock;
      grid.appendChild(card);
    });
    grid.querySelectorAll("[data-cap]").forEach(function (inp) {
      inp.addEventListener("input", function () {
        state.photos[Number(inp.dataset.cap)].caption = inp.value;
        renderPreview();
      });
    });
    grid.querySelectorAll("[data-tag]").forEach(function (b) {
      b.addEventListener("click", function () {
        var parts = b.dataset.tag.split("|");
        state.photos[Number(parts[0])].tag = parts[1];
        renderPhotoGrid(); renderPreview();
      });
    });
    grid.querySelectorAll("[data-delphoto]").forEach(function (b) {
      b.addEventListener("click", function () {
        state.photos.splice(Number(b.dataset.delphoto), 1);
        renderPhotoGrid(); renderPreview();
      });
    });
    grid.querySelectorAll("[data-aiphoto]").forEach(function (b) {
      b.addEventListener("click", function () { aiAnalyzePhoto(Number(b.dataset.aiphoto)); });
    });
    grid.querySelectorAll("[data-aiadd]").forEach(function (b) {
      b.addEventListener("click", function () {
        var p = state.photos[Number(b.dataset.aiadd)];
        (p.ai.items || []).forEach(function (it) {
          state.items.push({ description: it.description, qty: it.qty || 1, unit: it.unit || "each", unitPrice: it.unitPrice || 0 });
        });
        renderItems(); renderPreview();
        document.getElementById("itemsTable").scrollIntoView({ behavior: "smooth", block: "center" });
      });
    });
  }

  async function aiAnalyzePhoto(i) {
    var p = state.photos[i];
    if (!p || p.aiLoading) return;
    p.aiLoading = true; p.aiError = null; p.ai = null;
    renderPhotoGrid();
    var card = $("photoGrid").children[i];
    if (card) card.classList.add("scanning");
    try {
      var r = await fetch("/api/analyze-photo", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl: p.dataUrl, trade: tradeSel.value })
      });
      var data = await r.json();
      if (r.status === 503 && data.error === "no-key") {
        p.aiError = "AI photo analysis needs your OpenAI key (set OPENAI_API_KEY on the server). The on-device analysis above is always free.";
      } else if (!r.ok) {
        p.aiError = "AI analysis failed — try again.";
      } else {
        p.ai = data;
      }
    } catch (e) {
      p.aiError = "Couldn't reach the server.";
    }
    p.aiLoading = false;
    renderPhotoGrid();
  }

  /* ---------- line items table ---------- */
  function renderItems() {
    var body = $("itemsBody");
    body.innerHTML = "";
    state.items.forEach(function (it, i) {
      var tr = document.createElement("tr");
      tr.innerHTML =
        '<td><input data-i="' + i + '" data-f="description" value="' + esc(it.description) + '"></td>' +
        '<td><input data-i="' + i + '" data-f="qty" type="number" min="0" step="any" value="' + it.qty + '"></td>' +
        '<td><input data-i="' + i + '" data-f="unit" value="' + esc(it.unit) + '"></td>' +
        '<td><input data-i="' + i + '" data-f="unitPrice" type="number" min="0" step="any" value="' + it.unitPrice + '"></td>' +
        '<td class="row-total">' + money(Quotely.lineTotal(it)) + '</td>' +
        '<td><button class="small danger-ghost" data-del="' + i + '">✕</button></td>';
      body.appendChild(tr);
    });
    body.querySelectorAll("input").forEach(function (inp) {
      inp.addEventListener("input", function () {
        var i = Number(inp.dataset.i), f = inp.dataset.f;
        state.items[i][f] = (f === "qty" || f === "unitPrice") ? Number(inp.value) : inp.value;
        renderPreview();
        // refresh row total cell
        inp.closest("tr").querySelector(".row-total").textContent = money(Quotely.lineTotal(state.items[i]));
      });
    });
    body.querySelectorAll("[data-del]").forEach(function (b) {
      b.addEventListener("click", function () {
        state.items.splice(Number(b.dataset.del), 1);
        renderItems(); renderPreview();
      });
    });
  }

  $("addLineBtn").addEventListener("click", function () {
    state.items.push({ description: "", qty: 1, unit: "each", unitPrice: 0 });
    renderItems(); renderPreview();
  });

  /* ---------- generate ---------- */
  $("generateBtn").addEventListener("click", async function () {
    var desc = $("description").value.trim();
    var trade = tradeSel.value;
    var msg = $("genSource");
    if (!desc) { msg.textContent = "Describe the job first — a sentence or two is enough."; return; }
    msg.textContent = "Generating…";
    var items = null, source = "local";
    try {
      var r = await fetch("/api/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: desc, trade: trade })
      });
      if (r.ok) {
        var data = await r.json();
        items = data.items; source = data.source;
      }
    } catch (e) { /* offline/static hosting -> local fallback below */ }
    if (!items) {
      items = Quotely.generateLineItems(desc, trade);
      source = "local";
    }
    state.items = items;
    renderItems(); renderPreview();
    msg.textContent = items.length + " line item" + (items.length === 1 ? "" : "s") +
      " drafted (" + (source === "openai" ? "AI enhanced" : "built-in estimator") +
      "). Adjust quantities and prices, then preview below.";
  });

  /* ---------- totals + preview ---------- */
  function currentTotals() {
    return Quotely.quoteTotals(state.items, $("taxRate").value, $("depositRate").value);
  }

  function renderPreview() {
    var t = currentTotals();
    var s = state.settings;
    var validDays = Number($("validDays").value) || 30;
    var validUntil = new Date(Date.now() + validDays * 864e5).toLocaleDateString();
    var rows = state.items.map(function (it) {
      return "<tr><td>" + esc(it.description) + "</td>" +
        '<td class="num">' + it.qty + " " + esc(it.unit) + "</td>" +
        '<td class="num">' + money(it.unitPrice) + "</td>" +
        '<td class="num">' + money(Quotely.lineTotal(it)) + "</td></tr>";
    }).join("");
    $("preview").innerHTML =
      '<div class="q-head"><div>' +
        (s.logo ? '<img class="q-logo" src="' + s.logo + '" alt="logo"><br>' : "") +
        '<div class="q-co">' + esc(s.companyName || "Your Company") + "</div>" +
        '<div class="q-co-sub">' + esc([s.companyPhone, s.companyEmail, s.companyAddress].filter(Boolean).join(" · ")) + "</div>" +
      "</div>" +
      '<div class="q-meta"><div class="qnum">QUOTE</div>' +
        "<div>#" + esc(nextLocalNumber()) + "</div>" +
        "<div>Date: " + new Date().toLocaleDateString() + "</div>" +
        "<div>Valid until: " + validUntil + "</div></div></div>" +
      '<div class="q-parties"><div><h4>Prepared for</h4>' +
        "<strong>" + esc($("customer").value || "Customer") + "</strong><br>" +
        esc($("phone").value) + ( $("phone").value && $("email").value ? "<br>" : "") + esc($("email").value) +
      "</div><div><h4>Job</h4>" + esc(tradeSel.value) + "<br>" +
        esc($("description").value).slice(0, 300) + "</div></div>" +
      '<table class="q-items"><thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Unit price</th><th class="num">Amount</th></tr></thead>' +
      "<tbody>" + (rows || '<tr><td colspan="4">No line items yet — generate or add some above.</td></tr>') + "</tbody></table>" +
      '<table class="q-totals"><tr><td>Subtotal</td><td class="num" id="totSub">' + money(t.subtotal) + "</td></tr>" +
      "<tr><td>Tax (" + esc($("taxRate").value || "0") + "%)</td>" + '<td class="num" id="totTax">' + money(t.tax) + "</td></tr>" +
      '<tr class="grand"><td>Total</td><td class="num" id="totTotal">' + money(t.total) + "</td></tr>" +
      "<tr><td>Deposit due (" + esc($("depositRate").value || "0") + "%)</td>" + '<td class="num" id="totDep">' + money(t.deposit) + "</td></tr>" +
      '<tr><td>Balance on completion</td><td class="num" id="totBal">' + money(t.balance) + "</td></tr></table>" +
      ($("notes").value ? '<div class="q-notes"><strong>Notes:</strong> ' + esc($("notes").value) + "</div>" : "") +
      (state.photos.length
        ? '<div class="q-photos"><h4>Job photos</h4><div class="q-photos-grid">' +
          state.photos.map(function (p) {
            return "<figure><img src=\"" + p.dataUrl + "\" alt=\"job photo\">" +
              ((p.caption || p.tag || p.addedAt)
                ? "<figcaption>" + (p.tag ? '<span class="ptag">' + esc(p.tag) + "</span> " : "") + esc(p.caption) +
                  (p.addedAt ? '<span class="ftime">' + esc(fmtTime(p.addedAt)) + "</span>" : "") + "</figcaption>"
                : "") + "</figure>";
          }).join("") + "</div></div>"
        : "") +
      '<div class="q-sign"><div>Accepted by (customer signature)</div><div>Date</div></div>';
    tweenMoney("totSub", t.subtotal);
    tweenMoney("totTax", t.tax);
    tweenMoney("totTotal", t.total);
    tweenMoney("totDep", t.deposit);
    tweenMoney("totBal", t.balance);
  }

  /* animated totals: numbers tick up/down instead of jumping */
  var lastMoney = {};
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function tweenMoney(id, to) {
    var el = document.getElementById(id);
    if (!el) return;
    var from = (id in lastMoney) ? lastMoney[id] : to;
    lastMoney[id] = to;
    if (reduceMotion || from === to) { el.textContent = money(to); return; }
    var t0 = performance.now(), dur = 450;
    function frame(t) {
      var k = Math.min(1, (t - t0) / dur);
      var e = 1 - Math.pow(1 - k, 3);
      if (!document.body.contains(el)) return;
      el.textContent = money(from + (to - from) * e);
      if (k < 1) requestAnimationFrame(frame);
      else el.textContent = money(to);
    }
    requestAnimationFrame(frame);
  }

  function nextLocalNumber() {
    var year = new Date().getFullYear();
    var n = 1;
    state.quotes.forEach(function (q) {
      var m = /^Q-(\d{4})-(\d+)$/.exec(q.number || "");
      if (m && Number(m[1]) === year) n = Math.max(n, Number(m[2]) + 1);
    });
    return "Q-" + year + "-" + String(n).padStart(4, "0");
  }

  ["taxRate", "depositRate", "notes", "customer", "phone", "email", "description", "validDays"]
    .forEach(function (id) { $(id).addEventListener("input", renderPreview); });
  tradeSel.addEventListener("change", renderPreview);

  /* ---------- save ---------- */
  $("saveBtn").addEventListener("click", async function () {
    var msg = $("saveMsg");
    if (!state.items.length) { msg.textContent = "Add at least one line item first."; return; }
    var payload = {
      company: state.settings.companyName || "",
      customer: $("customer").value, phone: $("phone").value, email: $("email").value,
      trade: tradeSel.value, description: $("description").value,
      items: state.items, photos: state.photos.map(function (p) { return { dataUrl: p.dataUrl, caption: p.caption, tag: p.tag, addedAt: p.addedAt }; }),
      taxRate: $("taxRate").value, depositRate: $("depositRate").value,
      followUp: $("followUp").value, notes: $("notes").value, validDays: $("validDays").value
    };
    try {
      var r = await fetch("/api/quotes", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!r.ok) throw new Error("save failed");
      var q = await r.json();
      msg.textContent = "Saved as " + q.number + " ✓";
      var saveBtn = $("saveBtn");
      saveBtn.classList.remove("saved-pop");
      void saveBtn.offsetWidth;
      saveBtn.classList.add("saved-pop");
      await loadQuotes();
      renderPreview();
    } catch (e) {
      msg.textContent = "Couldn't reach the server — is it running? (npm start)";
    }
  });

  $("printBtn").addEventListener("click", function () { window.print(); });

  $("clearBtn").addEventListener("click", function () {
    if (!confirm("Clear this quote form?")) return;
    state.items = [];
    state.photos = [];
    renderPhotoGrid();
    ["description", "customer", "phone", "email", "followUp", "notes"].forEach(function (id) { $(id).value = ""; });
    $("taxRate").value = 0; $("depositRate").value = 25; $("validDays").value = 30;
    $("genSource").textContent = ""; $("saveMsg").textContent = "";
    renderItems(); renderPreview();
  });

  /* ---------- quotes list ---------- */
  async function loadQuotes() {
    try {
      var r = await fetch("/api/quotes");
      state.quotes = r.ok ? await r.json() : [];
    } catch (e) { state.quotes = []; }
    renderQuotesList();
  }

  function followUpClass(dateStr) {
    if (!dateStr) return "";
    var today = new Date().toISOString().slice(0, 10);
    if (dateStr <= today) return "due";
    var soon = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
    if (dateStr <= soon) return "soon";
    return "";
  }

  function renderQuotesList() {
    var filter = $("statusFilter").value;
    var q = $("searchBox").value.toLowerCase();
    var list = state.quotes.filter(function (x) {
      if (filter && x.status !== filter) return false;
      if (q && (x.customer + " " + x.number).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    $("quoteCount").textContent = state.quotes.length || "";

    var today = new Date().toISOString().slice(0, 10);
    var due = state.quotes.filter(function (x) {
      return x.followUp && x.followUp <= today && (x.status === "draft" || x.status === "sent");
    });
    $("followUpAlert").innerHTML = due.length
      ? '<div class="alert">🔔 ' + due.length + " quote" + (due.length > 1 ? "s" : "") +
        " need follow-up: " + due.map(function (x) { return esc(x.number + " (" + (x.customer || "no name") + ")"); }).join(", ") + "</div>"
      : "";

    $("quotesList").innerHTML = list.length ? "" : '<div class="hg-empty"><div class="hg-empty-title">No quotes yet</div><p>Describe your first job and generate a professional quote in seconds.</p><button class="primary" style="width:auto;margin-top:0" onclick="document.querySelector(\'.tab[data-tab=new]\').click()">Create your first quote</button></div>';
    list.forEach(function (x) {
      var div = document.createElement("div");
      div.className = "quote-card";
      var fu = x.followUp
        ? '<div class="followup ' + followUpClass(x.followUp) + '">📅 follow up: ' + esc(x.followUp) + "</div>"
        : "";
      div.innerHTML =
        '<div><div class="num">' + esc(x.number) + '</div><div class="cust">' + esc(x.customer || "—") + "</div>" +
        '<div class="meta">' + esc(x.trade) + " · " + new Date(x.createdAt).toLocaleDateString() +
        (x.photos && x.photos.length ? " · " + x.photos.length + " photo" + (x.photos.length > 1 ? "s" : "") : "") +
        "</div>" + fu + "</div>" +
        '<div><span class="status ' + x.status + '">' + x.status + '</span> <span class="total">' + money(x.totals.total) + "</span></div>" +
        '<div class="qbtns">' +
          (x.status !== "won" ? '<button class="small ghost" data-act="won">Won ✓</button>' : "") +
          (x.status !== "lost" ? '<button class="small ghost" data-act="lost">Lost</button>' : "") +
          (x.status === "won" || x.status === "lost" ? '<button class="small ghost" data-act="sent">Reopen</button>' : "") +
          (x.status === "draft" ? '<button class="small ghost" data-act="sent">Mark sent</button>' : "") +
          '<button class="small danger-ghost" data-act="del">Delete</button>' +
        "</div>";
      div.querySelectorAll("[data-act]").forEach(function (b) {
        b.addEventListener("click", function () { quoteAction(x.id, b.dataset.act); });
      });
      $("quotesList").appendChild(div);
    });
  }

  async function quoteAction(id, act) {
    if (act === "del" && !confirm("Delete this quote?")) return;
    try {
      if (act === "del") {
        await fetch("/api/quotes/" + id, { method: "DELETE" });
      } else {
        await fetch("/api/quotes/" + id, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: act })
        });
      }
      await loadQuotes(); renderPreview();
    } catch (e) { alert("Couldn't reach the server."); }
  }

  $("statusFilter").addEventListener("change", renderQuotesList);
  $("searchBox").addEventListener("input", renderQuotesList);

  /* ---------- settings ---------- */
  function fillSettings() {
    var s = state.settings;
    $("companyName").value = s.companyName || "";
    $("companyPhone").value = s.companyPhone || "";
    $("companyEmail").value = s.companyEmail || "";
    $("companyAddress").value = s.companyAddress || "";
    $("logoPreview").innerHTML = s.logo ? '<img src="' + s.logo + '" alt="logo">' : "";
  }
  $("companyLogo").addEventListener("change", function (e) {
    var f = e.target.files[0];
    if (!f) return;
    var rd = new FileReader();
    rd.onload = function () {
      state.settings.logo = rd.result;
      $("logoPreview").innerHTML = '<img src="' + rd.result + '" alt="logo">';
    };
    rd.readAsDataURL(f);
  });
  $("saveSettingsBtn").addEventListener("click", function () {
    state.settings.companyName = $("companyName").value;
    state.settings.companyPhone = $("companyPhone").value;
    state.settings.companyEmail = $("companyEmail").value;
    state.settings.companyAddress = $("companyAddress").value;
    saveSettings();
    $("settingsMsg").textContent = "Saved ✓ — your company info now appears on quotes.";
    renderPreview();
  });

  /* ---------- boot ---------- */
  fillSettings();
  renderItems();
  renderPhotoGrid();
  /* scroll reveal for the 01/02/03 steps */
  var steps = document.querySelectorAll(".step");
  if (reduceMotion || !("IntersectionObserver" in window)) {
    steps.forEach(function (s) { s.classList.add("revealed"); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("revealed"); io.unobserve(e.target); }
      });
    }, { threshold: 0.08 });
    steps.forEach(function (s) { io.observe(s); });
  }
  loadQuotes().then(renderPreview);
  renderPreview();
})();
