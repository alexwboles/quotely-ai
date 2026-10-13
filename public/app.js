/* Quotely — frontend app (no build step, no deps) */
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
    templates: [],
    customers: [],
    quoteFilter: "",
    custFilter: "",
    editingId: null,
    detailId: null,
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

  /* ---------- toast ---------- */
  function showToast(msg) {
    var host = $("toastHost");
    var t = document.createElement("div");
    t.className = "toast";
    t.innerHTML = '<span class="tick">&#10003;</span><span>' + esc(msg) + "</span>";
    host.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 3600);
  }

  /* ---------- sidebar nav ---------- */
  var VIEWS = ["dashboard", "new", "quotes", "detail", "customers", "settings"];
  var navItems = document.querySelectorAll(".nav-item");
  function showView(name) {
    navItems.forEach(function (x) { x.classList.toggle("active", x.dataset.view === name || (name === "detail" && x.dataset.view === "quotes")); });
    VIEWS.forEach(function (k) {
      var el = $("view-" + k);
      if (el) el.classList.toggle("hidden", k !== name);
    });
    var shown = $("view-" + name);
    if (shown) {
      shown.classList.remove("view-enter");
      void shown.offsetWidth;
      shown.classList.add("view-enter");
    }
    if (name === "quotes" || name === "dashboard") loadQuotes();
    if (name === "customers") renderCustomersView();
    window.scrollTo({ top: 0 });
  }
  navItems.forEach(function (t) {
    t.addEventListener("click", function () {
      if (t.dataset.view === "new") startNew();
      else showView(t.dataset.view);
    });
  });
  document.querySelectorAll("[data-goto-new]").forEach(function (b) {
    b.addEventListener("click", startNew);
  });
  document.querySelectorAll("[data-goto-quotes]").forEach(function (b) {
    b.addEventListener("click", function () { showView("quotes"); });
  });
  document.querySelectorAll("[data-goto-customers]").forEach(function (b) {
    b.addEventListener("click", function () { showView("customers"); });
  });

  /* ---------- new vs edit mode ---------- */
  function startNew() {
    state.editingId = null;
    state.items = [];
    state.photos = [];
    ["description", "customer", "phone", "email", "followUp", "notes", "warranty"].forEach(function (id) { $(id).value = ""; });
    $("taxRate").value = 0; $("depositRate").value = 25; $("validDays").value = 30;
    $("payTerms").value = "Due on receipt";
    $("genSource").textContent = ""; $("saveMsg").textContent = "";
    $("newTitle").textContent = "New quote";
    $("saveBtn").textContent = "Save quote";
    renderItems(); renderPhotoGrid(); renderPreview();
    showView("new");
  }

  function startEdit(id) {
    var q = state.quotes.filter(function (x) { return x.id === id; })[0];
    if (!q) return;
    state.editingId = id;
    state.items = (q.items || []).map(function (i) {
      return { description: i.description, qty: i.qty, unit: i.unit, unitPrice: i.unitPrice };
    });
    state.photos = (q.photos || []).map(function (p) {
      return { dataUrl: p.dataUrl, caption: p.caption || "", tag: p.tag || "", addedAt: p.addedAt || Date.now(), analysis: null, ai: null };
    });
    $("trade").value = q.trade || "General Handyman";
    $("description").value = q.description || "";
    $("customer").value = q.customer || "";
    $("phone").value = q.phone || "";
    $("email").value = q.email || "";
    $("followUp").value = q.followUp || "";
    $("validDays").value = q.validDays || 30;
    $("taxRate").value = q.taxRate || 0;
    $("depositRate").value = q.depositRate != null ? q.depositRate : 25;
    $("payTerms").value = q.paymentTerms || "Due on receipt";
    $("warranty").value = q.warranty || "";
    $("notes").value = q.notes || "";
    $("genSource").textContent = ""; $("saveMsg").textContent = "";
    $("newTitle").textContent = "Edit quote " + (q.number || "");
    $("saveBtn").textContent = "Save changes";
    renderItems(); renderPhotoGrid(); renderPreview();
    // re-run on-device analysis for loaded photos
    state.photos.forEach(function (p) {
      if (!p.analysis) analyzeLocal(p.dataUrl).then(function (a) { p.analysis = a; renderPhotoGrid(); });
    });
    showView("new");
  }

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
        var photo = { dataUrl: p.dataUrl, caption: "", tag: "", addedAt: Date.now(), analysis: null, ai: null };
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
  dz.addEventListener("drop", function (e) { addPhotoFiles(e.dataTransfer.files); });

  function fmtTime(ts) {
    if (!ts) return "";
    var d = new Date(Number(ts));
    var date = d.toLocaleString("en-US", { month: "short" }) + " " + d.getDate();
    var time = d.toLocaleString("en-US", { hour: "numeric", minute: "2-digit" });
    return (date + " · " + time).toUpperCase();
  }

  function renderPhotoGrid() {
    var grid = $("photoGrid");
    $("photoCount").textContent = state.photos.length ? state.photos.length + " / 8" : "";
    grid.innerHTML = "";
    if (!state.photos.length) {
      grid.innerHTML = '<div class="photo-empty">No photos yet — add site photos to document the job. They print on the quote.</div>';
      return;
    }
    state.photos.forEach(function (p, i) {
      var card = document.createElement("div");
      card.className = "photo-card";
      var a = p.analysis;
      var flags = a && a.flags.length
        ? '<span class="flag warn">' + esc(a.flags.join(" · ")) + " — retake?</span>"
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
            ? '<div class="ai-items">' + p.ai.items.map(function (it) {
                return "<div>" + esc(it.description) + " — " + money(it.unitPrice) + "</div>";
              }).join("") + '</div><button class="btn btn-sm" data-aiadd="' + i + '">Add to line items</button>'
            : "") + "</div>";
      } else if (p.aiError) {
        aiBlock = '<div class="ai-panel warn">' + esc(p.aiError) + "</div>";
      }
      card.innerHTML =
        '<img src="' + p.dataUrl + '" alt="job photo">' +
        '<input class="cap" data-cap="' + i + '" placeholder="Add a caption…" value="' + esc(p.caption) + '" aria-label="Photo caption">' +
        '<div class="photo-meta">' +
          '<button class="tag' + (p.tag === "" ? " on" : "") + '" data-tag="' + i + '|">—</button>' +
          '<button class="tag' + (p.tag === "before" ? " on" : "") + '" data-tag="' + i + '|before">Before</button>' +
          '<button class="tag' + (p.tag === "after" ? " on" : "") + '" data-tag="' + i + '|after">After</button>' +
          '<button class="iconbtn" data-aiphoto="' + i + '">AI look</button>' +
          '<button class="iconbtn danger" data-delphoto="' + i + '" aria-label="Remove photo">Remove</button>' +
        "</div>" +
        '<div class="photo-analysis"><span>' + esc(fmtTime(p.addedAt)) + "</span>" + flags + "<span>" + dims + "</span>" +
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
        '<td><input data-i="' + i + '" data-f="description" value="' + esc(it.description) + '" placeholder="Describe the work…" aria-label="Line item description"></td>' +
        '<td><input data-i="' + i + '" data-f="qty" type="number" min="0" step="any" value="' + it.qty + '" aria-label="Quantity"></td>' +
        '<td><input data-i="' + i + '" data-f="unit" value="' + esc(it.unit) + '" aria-label="Unit"></td>' +
        '<td><input data-i="' + i + '" data-f="unitPrice" type="number" min="0" step="any" value="' + it.unitPrice + '" aria-label="Unit price"></td>' +
        '<td class="num row-total"><strong>' + money(Quotely.lineTotal(it)) + "</strong></td>" +
        '<td><button class="btn-danger btn-sm" data-del="' + i + '" aria-label="Remove line">✕</button></td>';
      body.appendChild(tr);
    });
    body.querySelectorAll("input").forEach(function (inp) {
      inp.addEventListener("input", function () {
        var i = Number(inp.dataset.i), f = inp.dataset.f;
        state.items[i][f] = (f === "qty" || f === "unitPrice") ? Number(inp.value) : inp.value;
        renderPreview();
        inp.closest("tr").querySelector(".row-total").innerHTML = "<strong>" + money(Quotely.lineTotal(state.items[i])) + "</strong>";
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
      "). Adjust quantities and prices — the preview updates live.";
  });

  /* ---------- the quote document (shared by preview + detail) ---------- */
  function validUntilOf(q) {
    var base = q.createdAt ? new Date(q.createdAt).getTime() : Date.now();
    return new Date(base + (Number(q.validDays) || 30) * 864e5).toLocaleDateString();
  }

  function sheetHTML(q) {
    var s = state.settings;
    var rows = (q.items || []).map(function (it) {
      return "<tr><td><div class=\"item-name\">" + esc(it.description) + "</div></td>" +
        '<td class="num">' + it.qty + " " + esc(it.unit) + "</td>" +
        '<td class="num">' + money(it.unitPrice) + "</td>" +
        '<td class="num"><strong>' + money(Quotely.lineTotal(it)) + "</strong></td></tr>";
    }).join("");
    var t = q.totals || Quotely.quoteTotals(q.items || [], q.taxRate, q.depositRate);
    var coLine = [s.companyPhone, s.companyEmail, s.companyAddress].filter(Boolean).join(" · ");
    var custLine = [q.phone, q.email].filter(Boolean).join(" · ");
    return '<div class="doc-head"><div>' +
        (s.logo ? '<img class="doc-logo" src="' + s.logo + '" alt="company logo">' : "") +
        '<div class="doc-co">' + esc(s.companyName || "Your Company") + "</div>" +
        (coLine ? '<div class="doc-co-sub">' + esc(coLine) + "</div>" : "") +
      "</div>" +
      '<div class="doc-meta"><div class="doc-kicker">QUOTE</div>' +
        "<div><strong>" + esc(q.number || "") + "</strong></div>" +
        "<div>Date: " + new Date(q.createdAt || Date.now()).toLocaleDateString() + "</div>" +
        "<div>Valid until: " + validUntilOf(q) + "</div></div></div>" +
      '<div class="doc-parties"><div><h4>Prepared for</h4>' +
        '<div class="who">' + esc(q.customer || "Customer") + "</div>" +
        (custLine ? '<div class="sub">' + esc(custLine) + "</div>" : "") +
      "</div><div><h4>Job</h4>" +
        '<div class="who">' + esc(q.trade || "") + "</div>" +
        (q.description ? '<div class="sub">' + esc(String(q.description).slice(0, 300)) + "</div>" : "") +
      "</div></div>" +
      '<table class="doc-items"><thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Unit price</th><th class="num">Amount</th></tr></thead>' +
      "<tbody>" + (rows || '<tr><td colspan="4" style="color:var(--muted)">No line items yet — generate or add some.</td></tr>') + "</tbody></table>" +
      '<table class="doc-totals"><tr><td>Subtotal</td><td class="num" id="totSub">' + money(t.subtotal) + "</td></tr>" +
      "<tr><td>Tax (" + esc(q.taxRate || "0") + "%)</td>" + '<td class="num" id="totTax">' + money(t.tax) + "</td></tr>" +
      '<tr class="grand"><td>Total</td><td class="num" id="totTotal">' + money(t.total) + "</td></tr>" +
      "<tr><td>Deposit due (" + esc(q.depositRate || "0") + "%)</td>" + '<td class="num" id="totDep">' + money(t.deposit) + "</td></tr>" +
      '<tr><td>Balance on completion</td><td class="num" id="totBal">' + money(t.balance) + "</td></tr></table>" +
      '<div class="doc-terms"><strong>Payment terms:</strong> ' + esc(q.paymentTerms || "Due on receipt") +
      (q.warranty ? ' &nbsp;·&nbsp; <strong>Warranty:</strong> ' + esc(q.warranty) : "") + "</div>" +
      (q.notes ? '<div class="doc-notes"><strong>Notes:</strong> ' + esc(q.notes) + "</div>" : "") +
      ((q.photos || []).length
        ? '<div class="doc-photos"><h4>Job photos</h4><div class="doc-photos-grid">' +
          q.photos.map(function (p) {
            return "<figure><img src=\"" + p.dataUrl + "\" alt=\"job photo\">" +
              ((p.caption || p.tag || p.addedAt)
                ? "<figcaption>" + (p.tag ? esc(p.tag.toUpperCase()) + " · " : "") + esc(p.caption || "") +
                  (p.addedAt ? " · " + esc(fmtTime(p.addedAt)) : "") + "</figcaption>"
                : "") + "</figure>";
          }).join("") + "</div></div>"
        : "") +
      '<div class="doc-sign"><div>Accepted by (customer signature)</div><div>Date</div></div>';
  }

  /* ---------- builder preview ---------- */
  function currentTotals() {
    return Quotely.quoteTotals(state.items, $("taxRate").value, $("depositRate").value);
  }

  function renderPreview() {
    var editing = state.editingId
      ? state.quotes.filter(function (x) { return x.id === state.editingId; })[0]
      : null;
    var q = {
      number: editing ? editing.number : nextLocalNumber(),
      createdAt: editing ? editing.createdAt : new Date().toISOString(),
      customer: $("customer").value, phone: $("phone").value, email: $("email").value,
      trade: tradeSel.value, description: $("description").value,
      items: state.items,
      photos: state.photos.map(function (p) { return { dataUrl: p.dataUrl, caption: p.caption, tag: p.tag, addedAt: p.addedAt }; }),
      taxRate: $("taxRate").value, depositRate: $("depositRate").value,
      totals: currentTotals(),
      followUp: $("followUp").value, notes: $("notes").value, validDays: $("validDays").value,
      paymentTerms: $("payTerms").value, warranty: $("warranty").value
    };
    $("preview").innerHTML = sheetHTML(q);
    var t = q.totals;
    tweenMoney("totSub", t.subtotal);
    tweenMoney("totTax", t.tax);
    tweenMoney("totTotal", t.total);
    tweenMoney("totDep", t.deposit);
    tweenMoney("totBal", t.balance);
  }

  /* animated totals: numbers tick instead of jumping */
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

  ["taxRate", "depositRate", "notes", "customer", "phone", "email", "description", "validDays", "payTerms", "warranty"]
    .forEach(function (id) { $(id).addEventListener("input", renderPreview); });
  tradeSel.addEventListener("change", renderPreview);

  /* ---------- save (POST new / PUT edit) ---------- */
  $("saveBtn").addEventListener("click", async function () {
    var msg = $("saveMsg");
    if (!state.items.length) { msg.textContent = "Add at least one line item first."; return; }
    var payload = {
      company: state.settings.companyName || "",
      customer: $("customer").value, phone: $("phone").value, email: $("email").value,
      trade: tradeSel.value, description: $("description").value,
      items: state.items, photos: state.photos.map(function (p) { return { dataUrl: p.dataUrl, caption: p.caption, tag: p.tag, addedAt: p.addedAt }; }),
      taxRate: $("taxRate").value, depositRate: $("depositRate").value,
      followUp: $("followUp").value, notes: $("notes").value, validDays: $("validDays").value,
      paymentTerms: $("payTerms").value, warranty: $("warranty").value
    };
    try {
      var r, q;
      if (state.editingId) {
        r = await fetch("/api/quotes/" + state.editingId, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (!r.ok) throw new Error("save failed");
        q = await r.json();
        showToast("Quote " + q.number + " updated");
      } else {
        r = await fetch("/api/quotes", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (!r.ok) throw new Error("save failed");
        q = await r.json();
        showToast("Quote " + q.number + " created");
      }
      await loadQuotes();
      openDetail(q.id);
    } catch (e) {
      msg.textContent = "Couldn't reach the server — is it running? (npm start)";
    }
  });

  $("printBtn").addEventListener("click", function () { window.print(); });

  $("clearBtn").addEventListener("click", function () {
    if (!confirm("Clear this quote form?")) return;
    startNew();
  });

  /* ---------- dashboard ---------- */
  function totalsOf(x) { return (x.totals && Number(x.totals.total)) || 0; }

  function badgeHTML(status, expired) {
    return '<span class="badge ' + status + '">' + status + "</span>" +
      (expired ? ' <span class="badge expired">expired</span>' : "");
  }

  function renderDashboard() {
    var qs = state.quotes;
    var today = new Date().toISOString().slice(0, 10);
    $("dashDate").textContent = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) +
      "  ·  " + qs.length + " quote" + (qs.length === 1 ? "" : "s") + " on the books";

    var pipe = qs.filter(function (x) { return x.status === "draft" || x.status === "sent"; });
    var pipeVal = pipe.reduce(function (a, x) { return a + totalsOf(x); }, 0);
    $("kpiPipeline").textContent = money(pipeVal);
    $("kpiPipelineSub").textContent = pipe.length + " open quote" + (pipe.length === 1 ? "" : "s") + " awaiting decision";

    var won = qs.filter(function (x) { return x.status === "won"; }).length;
    var lost = qs.filter(function (x) { return x.status === "lost"; }).length;
    var decided = won + lost;
    $("kpiWinRate").textContent = decided ? Math.round((won / decided) * 100) + "%" : "—";
    $("kpiWinSub").textContent = decided ? won + " won · " + lost + " lost" : "no decided quotes yet";

    $("kpiAvg").textContent = qs.length ? money(qs.reduce(function (a, x) { return a + totalsOf(x); }, 0) / qs.length) : "$0.00";
    $("kpiAvgSub").textContent = qs.length ? "across " + qs.length + " quotes" : "no quotes yet";

    var due = qs.filter(function (x) { return x.followUp && x.followUp <= today && (x.status === "draft" || x.status === "sent"); });
    $("kpiFollow").textContent = due.length;
    $("kpiFollowSub").textContent = due.length ? "reach out today" : "all caught up";
    $("kpiFollow").classList.toggle("good", false);

    var order = ["draft", "sent", "won", "lost"];
    var labels = { draft: "Draft", sent: "Sent", won: "Won", lost: "Lost" };
    $("pipeGrid").innerHTML = "";
    order.forEach(function (s) {
      var grp = qs.filter(function (x) { return x.status === s; });
      var val = grp.reduce(function (a, x) { return a + totalsOf(x); }, 0);
      var cell = document.createElement("button");
      cell.className = "pipe-cell";
      cell.setAttribute("aria-label", labels[s] + " quotes: " + grp.length);
      cell.innerHTML = '<div class="pipe-status">' + labels[s] + '</div><div class="pipe-num">' + grp.length + '</div><div class="pipe-val">' + money(val) + "</div>";
      cell.addEventListener("click", function () { setQuoteFilter(s); });
      $("pipeGrid").appendChild(cell);
    });

    var recent = qs.slice().sort(function (a, b) { return String(b.createdAt || "").localeCompare(String(a.createdAt || "")); }).slice(0, 5);
    var rb = $("recentBody");
    if (!recent.length) {
      rb.innerHTML = '<tr><td colspan="4"><div class="empty-state"><strong>No quotes yet</strong><p>Describe a job and Quotely drafts the line items.</p><button class="btn btn-sm" data-goto-new2>New quote</button></div></td></tr>';
      var nb = rb.querySelector("[data-goto-new2]");
      if (nb) nb.addEventListener("click", startNew);
    } else {
      rb.innerHTML = "";
      recent.forEach(function (x) {
        var tr = document.createElement("tr");
        tr.innerHTML = '<td><a class="qlink" data-open="' + x.id + '" href="#">' + esc(x.number) + "</a></td>" +
          '<td class="t-cust">' + esc(x.customer || "—") + "</td>" +
          '<td class="num t-num">' + money(totalsOf(x)) + "</td>" +
          "<td>" + badgeHTML(x.status, Quotely.isQuoteExpired(x)) + "</td>";
        rb.appendChild(tr);
      });
      rb.querySelectorAll("[data-open]").forEach(function (a) {
        a.addEventListener("click", function (e) { e.preventDefault(); openDetail(a.dataset.open); });
      });
    }

    var fus = qs.filter(function (x) { return x.followUp && (x.status === "draft" || x.status === "sent"); })
      .sort(function (a, b) { return String(a.followUp || "").localeCompare(String(b.followUp || "")); }).slice(0, 6);
    var fl = $("followList");
    fl.innerHTML = "";
    if (!fus.length) {
      fl.innerHTML = '<div class="fu-empty">Nothing due — every quote has its follow-up handled.</div>';
    } else {
      fus.forEach(function (x) {
        var cls = followUpClass(x.followUp);
        var d = document.createElement("div");
        d.className = "fu-item";
        d.innerHTML = '<div><div class="fu-who">' + esc(x.customer || "No name") + '</div><div class="fu-what">' + esc(x.number) + "</div></div>" +
          '<div class="' + (cls === "due" ? "fu-due" : cls === "soon" ? "fu-soon" : "fu-none") + '">' + esc(x.followUp) + "</div>";
        fl.appendChild(d);
      });
    }
    renderTopCustomers();
  }

  function setQuoteFilter(s) {
    state.quoteFilter = s || "";
    document.querySelectorAll("#statusPills .tab").forEach(function (p) {
      p.classList.toggle("active", p.dataset.status === (s || ""));
    });
    renderQuotesList();
    showView("quotes");
  }

  /* ---------- quotes list ---------- */
  async function loadQuotes() {
    try {
      var r = await fetch("/api/quotes");
      state.quotes = r.ok ? await r.json() : [];
    } catch (e) { state.quotes = []; }
    renderQuotesList();
    renderDashboard();
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
    var q = $("searchBox").value.toLowerCase();
    var filter = state.quoteFilter;
    var list = state.quotes.filter(function (x) {
      if (filter === "expired") { if (!Quotely.isQuoteExpired(x)) return false; }
      else if (filter && x.status !== filter) return false;
      if (q && (String(x.customer || "") + " " + String(x.number || "")).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    $("quoteCount").textContent = state.quotes.length || "";
    var names = ["draft", "sent", "won", "lost"];
    var expiredCount = state.quotes.filter(Quotely.isQuoteExpired).length;
    $("quotesSub").textContent = state.quotes.length
      ? state.quotes.length + " total  ·  " + names.map(function (s) {
          return state.quotes.filter(function (x) { return x.status === s; }).length + " " + s;
        }).join("  ·  ") + (expiredCount ? "  ·  " + expiredCount + " expired" : "")
      : "No quotes yet — create your first one.";

    var outstanding = state.quotes
      .filter(function (x) { return x.status === "draft" || x.status === "sent"; })
      .reduce(function (a, x) { return a + totalsOf(x); }, 0);
    $("listCount").textContent = list.length + " quote" + (list.length === 1 ? "" : "s") + " shown";
    $("listOutstanding").textContent = money(outstanding);

    var today = new Date().toISOString().slice(0, 10);
    var due = state.quotes.filter(function (x) {
      return x.followUp && x.followUp <= today && (x.status === "draft" || x.status === "sent");
    });
    $("followUpAlert").innerHTML = due.length
      ? '<div class="alert"><strong>' + due.length + " quote" + (due.length > 1 ? "s" : "") +
        "</strong> need" + (due.length > 1 ? "" : "s") + " follow-up: " +
        due.map(function (x) { return esc(x.number + " (" + (x.customer || "no name") + ")"); }).join(", ") + "</div>"
      : "";

    var tb = $("quotesList");
    tb.innerHTML = "";
    if (!list.length) {
      tb.innerHTML = '<tr><td colspan="7"><div class="empty-state"><strong>No quotes match</strong><p>Try a different search or status filter.</p></div></td></tr>';
      return;
    }
    list.forEach(function (x) {
      var tr = document.createElement("tr");
      var fuCls = followUpClass(x.followUp);
      var fu = x.followUp
        ? '<span class="' + (fuCls === "due" ? "fu-due" : fuCls === "soon" ? "fu-soon" : "fu-none") + '">' + esc(x.followUp) + "</span>"
        : '<span class="fu-none">—</span>';
      var acts = '<button class="btn-ghost btn-sm" data-act="open">Open</button>';
      if (x.status === "draft") acts += '<button class="btn-ghost btn-sm" data-act="sent">Mark sent</button>';
      if (x.status !== "won") acts += '<button class="btn-ghost btn-sm" data-act="won">Won</button>';
      if (x.status !== "lost") acts += '<button class="btn-ghost btn-sm" data-act="lost">Lost</button>';
      if (x.status === "won" || x.status === "lost") acts += '<button class="btn-ghost btn-sm" data-act="sent">Reopen</button>';
      acts += '<button class="btn-ghost btn-sm" data-act="dup">Duplicate</button>' +
        '<button class="btn-ghost btn-sm" data-act="history">History</button>' +
        '<button class="btn-danger btn-sm" data-act="del">Delete</button>';
      tr.innerHTML =
        '<td><a class="qlink" data-act="open" href="#">' + esc(x.number) + "</a></td>" +
        '<td class="t-cust">' + esc(x.customer || "—") + "</td>" +
        '<td class="t-sub">' + esc(x.trade || "—") + "</td>" +
        '<td class="num t-num">' + money(totalsOf(x)) + "</td>" +
        "<td>" + badgeHTML(x.status, Quotely.isQuoteExpired(x)) + "</td>" +
        "<td>" + fu + "</td>" +
        '<td><div class="row-actions">' + acts + "</div></td>";
      tr.querySelectorAll("[data-act]").forEach(function (b) {
        b.addEventListener("click", function (e) {
          e.preventDefault();
          var act = b.dataset.act;
          if (act === "open") openDetail(x.id);
          else quoteAction(x.id, act);
        });
      });
      tb.appendChild(tr);
    });
  }

  async function quoteAction(id, act) {
    if (act === "del" && !confirm("Delete this quote? This can't be undone.")) return;
    if (act === "history") { openHistory(id); return; }
    try {
      if (act === "del") {
        await fetch("/api/quotes/" + id, { method: "DELETE" });
      } else if (act === "dup") {
        var dr = await fetch("/api/quotes/" + id + "/duplicate", { method: "POST" });
        if (!dr.ok) throw new Error("duplicate failed");
        var dq = await dr.json();
        showToast("Duplicated as " + dq.number);
      } else {
        await fetch("/api/quotes/" + id, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: act })
        });
      }
      await loadQuotes();
      if (act === "del" && state.detailId === id) { state.detailId = null; showView("quotes"); }
      else if (state.detailId) openDetail(state.detailId);
      renderPreview();
    } catch (e) { alert("Couldn't reach the server."); }
  }

  /* ---------- quote detail (Jobber-style) ---------- */
  function openDetail(id) {
    var q = state.quotes.filter(function (x) { return x.id === id; })[0];
    if (!q) { showView("quotes"); return; }
    state.detailId = id;
    var expired = Quotely.isQuoteExpired(q);
    $("detailCust").textContent = q.customer || "Unnamed customer";
    $("detailSub").textContent = q.number + "  ·  " + (q.trade || "") +
      "  ·  Created " + new Date(q.createdAt || Date.now()).toLocaleDateString() +
      "  ·  Valid until " + validUntilOf(q) +
      (q.followUp ? "  ·  Follow up " + q.followUp : "");
    $("detailBadges").innerHTML = badgeHTML(q.status, expired);
    $("detailTotal").textContent = money(totalsOf(q));
    $("detailDoc").innerHTML = sheetHTML(q);
    renderDetailActions(q);
    showView("detail");
  }

  function renderDetailActions(q) {
    var host = $("detailActions");
    var h = '<button class="btn-ghost btn-sm" data-dact="edit">Edit</button>';
    if (q.status === "draft") {
      h += '<button class="btn btn-sm" data-dact="sent">Mark sent</button>';
      h += '<button class="btn-ghost btn-sm" data-dact="won">Won</button>';
      h += '<button class="btn-ghost btn-sm" data-dact="lost">Lost</button>';
    } else if (q.status === "sent") {
      h += '<button class="btn btn-sm" data-dact="won">Mark won</button>';
      h += '<button class="btn-ghost btn-sm" data-dact="lost">Mark lost</button>';
    } else {
      h += '<button class="btn-ghost btn-sm" data-dact="sent">Reopen</button>';
    }
    h += '<button class="btn-ghost btn-sm" data-dact="dup">Duplicate</button>';
    h += '<button class="btn-ghost btn-sm" data-dact="print">Print / PDF</button>';
    h += '<button class="btn-ghost btn-sm" data-dact="history">History</button>';
    h += '<button class="btn-danger btn-sm" data-dact="del">Delete</button>';
    host.innerHTML = h;
    host.querySelectorAll("[data-dact]").forEach(function (b) {
      b.addEventListener("click", function () {
        var act = b.dataset.dact;
        if (act === "edit") startEdit(q.id);
        else if (act === "print") window.print();
        else quoteAction(q.id, act);
      });
    });
  }

  /* ---------- quote version history ---------- */
  function openHistory(id) {
    var q = state.quotes.filter(function (x) { return x.id === id; })[0];
    if (!q) return;
    var hist = Array.isArray(q.history) ? q.history : [];
    $("historyTitle").textContent = "Version history — " + (q.number || "");
    $("historyBody").innerHTML = hist.length
      ? hist.map(function (v, i) {
          var n = (v.items || []).length;
          var total = v.totals && v.totals.total != null ? money(v.totals.total) : "—";
          return '<div class="hist-row"><div><strong>' + new Date(v.at).toLocaleString() + "</strong>" +
            '<div class="hint">' + n + " line item" + (n === 1 ? "" : "s") + " · total " + total + "</div></div>" +
            '<button class="btn-ghost btn-sm" data-restore="' + i + '">Restore this version</button></div>';
        }).join("")
      : '<p class="hint">No earlier versions — edits to the line items are snapshotted here automatically.</p>';
    $("historyModal").classList.remove("hidden");
    $("historyBody").querySelectorAll("[data-restore]").forEach(function (b) {
      b.addEventListener("click", async function () {
        if (!confirm("Restore this version's line items? The current items will be kept as a version too.")) return;
        try {
          var r = await fetch("/api/quotes/" + id + "/restore", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ index: Number(b.dataset.restore) })
          });
          if (!r.ok) throw new Error("restore failed");
          $("historyModal").classList.add("hidden");
          await loadQuotes();
          if (state.detailId) openDetail(state.detailId);
          showToast("Version restored");
        } catch (e) { alert("Couldn't reach the server."); }
      });
    });
  }
  $("historyClose").addEventListener("click", function () { $("historyModal").classList.add("hidden"); });
  $("historyModal").addEventListener("click", function (e) {
    if (e.target === $("historyModal")) $("historyModal").classList.add("hidden");
  });

  /* ---------- line-item templates ---------- */
  async function loadTemplates() {
    try {
      var r = await fetch("/api/templates");
      state.templates = r.ok ? await r.json() : [];
    } catch (e) { state.templates = []; }
    renderTemplateSel();
  }
  function renderTemplateSel() {
    var sel = $("templateSel");
    var ts = state.templates || [];
    sel.innerHTML = '<option value="">Apply a saved template…</option>' + ts.map(function (t) {
      return '<option value="' + t.id + '">' + esc(t.name) + " (" + t.items.length + " items · " + esc(t.trade) + ")</option>";
    }).join("");
  }
  $("applyTemplateBtn").addEventListener("click", function () {
    var id = $("templateSel").value;
    if (!id) return;
    var t = (state.templates || []).filter(function (x) { return x.id === id; })[0];
    if (!t) return;
    if (state.items.length && !confirm("Replace the current line items with this template?")) return;
    state.items = t.items.map(function (i) {
      return { description: i.description, qty: i.qty, unit: i.unit, unitPrice: i.unitPrice };
    });
    renderItems(); renderPreview();
    showToast("Template applied");
  });
  $("saveTemplateBtn").addEventListener("click", async function () {
    if (!state.items.length) { alert("Add line items first, then save them as a template."); return; }
    var name = prompt("Template name — e.g. Faucet replacement (standard):");
    if (!name || !name.trim()) return;
    try {
      var r = await fetch("/api/templates", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), trade: tradeSel.value, items: state.items })
      });
      if (!r.ok) { var err = await r.json().catch(function () { return {}; }); throw new Error(err.error || "save failed"); }
      await loadTemplates();
      showToast("Template saved");
    } catch (e) { alert("Couldn't save template: " + e.message); }
  });

  /* ---------- customers ---------- */
  async function loadCustomers() {
    try {
      var r = await fetch("/api/customers");
      state.customers = r.ok ? await r.json() : [];
    } catch (e) { state.customers = []; }
  }

  function customerRowHTML(c) {
    return '<td class="t-cust">' + esc(c.name) + "</td>" +
      "<td>" + esc(c.phone || c.email || "—") + "</td>" +
      '<td class="num">' + c.quotes + '</td><td class="num">' + c.won + "</td>" +
      '<td class="num">' + money(c.totalQuoted) + '</td><td class="num">' + money(c.totalWon) + "</td>" +
      "<td>" + esc((c.lastQuoteAt || "").slice(0, 10)) + "</td>";
  }

  async function renderTopCustomers() {
    await loadCustomers();
    var body = $("customersBody");
    if (!state.customers.length) {
      body.innerHTML = '<tr><td colspan="7"><div class="empty-state"><strong>No customers yet</strong><p>Save a quote with a customer name and they will appear here.</p></div></td></tr>';
      return;
    }
    body.innerHTML = "";
    state.customers.slice(0, 10).forEach(function (c) {
      var tr = document.createElement("tr");
      tr.innerHTML = customerRowHTML(c);
      body.appendChild(tr);
    });
  }

  function renderCustomersView() {
    var q = state.custFilter.toLowerCase();
    var list = state.customers.filter(function (c) {
      if (!q) return true;
      return (c.name + " " + (c.phone || "") + " " + (c.email || "")).toLowerCase().indexOf(q) !== -1;
    });
    $("custSub").textContent = state.customers.length
      ? state.customers.length + " customers · lifetime value from saved quotes."
      : "Lifetime value from saved quotes.";
    var body = $("customersViewBody");
    body.innerHTML = "";
    if (!list.length) {
      body.innerHTML = '<tr><td colspan="7"><div class="empty-state"><strong>No customers found</strong><p>Try a different search.</p></div></td></tr>';
      return;
    }
    list.forEach(function (c) {
      var tr = document.createElement("tr");
      tr.className = "rowlink";
      tr.title = "View this customer's quotes";
      tr.innerHTML = customerRowHTML(c);
      tr.addEventListener("click", function () {
        state.quoteFilter = "";
        document.querySelectorAll("#statusPills .tab").forEach(function (x) { x.classList.toggle("active", x.dataset.status === ""); });
        $("searchBox").value = c.name;
        renderQuotesList();
        showView("quotes");
      });
      body.appendChild(tr);
    });
  }
  $("custSearch").addEventListener("input", function () {
    state.custFilter = $("custSearch").value;
    renderCustomersView();
  });

  document.querySelectorAll("#statusPills .tab").forEach(function (p) {
    p.addEventListener("click", function () {
      document.querySelectorAll("#statusPills .tab").forEach(function (x) { x.classList.remove("active"); });
      p.classList.add("active");
      state.quoteFilter = p.dataset.status;
      renderQuotesList();
    });
  });
  $("searchBox").addEventListener("input", renderQuotesList);

  /* ---------- settings ---------- */
  function fillSettings() {
    var s = state.settings;
    $("companyName").value = s.companyName || "";
    $("companyPhone").value = s.companyPhone || "";
    $("companyEmail").value = s.companyEmail || "";
    $("companyAddress").value = s.companyAddress || "";
    $("logoPreview").innerHTML = s.logo ? '<img src="' + s.logo + '" alt="company logo">' : "";
  }
  $("companyLogo").addEventListener("change", function (e) {
    var f = e.target.files[0];
    if (!f) return;
    var rd = new FileReader();
    rd.onload = function () {
      state.settings.logo = rd.result;
      $("logoPreview").innerHTML = '<img src="' + rd.result + '" alt="company logo">';
    };
    rd.readAsDataURL(f);
  });
  $("saveSettingsBtn").addEventListener("click", function () {
    state.settings.companyName = $("companyName").value;
    state.settings.companyPhone = $("companyPhone").value;
    state.settings.companyEmail = $("companyEmail").value;
    state.settings.companyAddress = $("companyAddress").value;
    saveSettings();
    $("settingsMsg").textContent = "Saved — your company info now appears on quotes.";
    renderPreview();
  });

  /* ---------- boot ---------- */
  fillSettings();
  renderItems();
  renderPhotoGrid();
  loadTemplates();
  loadQuotes().then(function () { renderDashboard(); renderPreview(); });
  renderPreview();
})();
