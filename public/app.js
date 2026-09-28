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
      '<table class="q-totals"><tr><td>Subtotal</td><td class="num">' + money(t.subtotal) + "</td></tr>" +
      "<tr><td>Tax (" + esc($("taxRate").value || "0") + "%)</td>" + '<td class="num">' + money(t.tax) + "</td></tr>" +
      '<tr class="grand"><td>Total</td><td class="num">' + money(t.total) + "</td></tr>" +
      "<tr><td>Deposit due (" + esc($("depositRate").value || "0") + "%)</td>" + '<td class="num">' + money(t.deposit) + "</td></tr>" +
      '<tr><td>Balance on completion</td><td class="num">' + money(t.balance) + "</td></tr></table>" +
      ($("notes").value ? '<div class="q-notes"><strong>Notes:</strong> ' + esc($("notes").value) + "</div>" : "") +
      '<div class="q-sign"><div>Accepted by (customer signature)</div><div>Date</div></div>';
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
      items: state.items, taxRate: $("taxRate").value, depositRate: $("depositRate").value,
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
        '<div class="meta">' + esc(x.trade) + " · " + new Date(x.createdAt).toLocaleDateString() + "</div>" + fu + "</div>" +
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
  loadQuotes().then(renderPreview);
  renderPreview();
})();
