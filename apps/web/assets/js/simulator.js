/* Harmony Verify — pricing simulator.
 *
 * Reads `window.HarmonyPrices`, which is generated from the pricing engine at
 * build time (packages/pricing-engine/scripts/emit-web-prices.ts). The figures on
 * this page are therefore the figures the platform charges — the calculator and
 * the invoice cannot drift, because they come from the same source.
 *
 * What the table deliberately does not contain: what an expert is paid, and the
 * revenue split. Those are internal, so they are not in this file, not in the
 * generated table, and not reachable from the browser.
 */
(function () {
  "use strict";

  if (!window.HarmonyPrices) return;
  var PRICES = window.HarmonyPrices;

  /* --- Plan cards -------------------------------------------------------- */

  /**
   * The "From $10" and "From $500" headline figures are read out of the same
   * generated table the simulator uses, rather than typed into the HTML.
   *
   * A tier card claiming a floor the engine does not actually charge is the most
   * embarrassing kind of pricing bug — it is the first number a customer reads
   * and the last one anybody thinks to check. Deriving it means the card cannot
   * disagree with the calculator sitting directly underneath it.
   */
  var tiers = document.querySelector("[data-tiers]");
  if (tiers) {
    var cheapest = Object.keys(PRICES.perReview).reduce(function (min, key) {
      var price = PRICES.perReview[key].price;
      return price < min ? price : min;
    }, Infinity);

    var whole = function (cents) {
      return "$" + Math.round(cents / 100).toLocaleString("en-US");
    };

    // Named for the element, not the plan: `monitoring` is a function further
    // down this same scope, and a `var` of that name silently replaces it.
    var reviewEl = tiers.querySelector('[data-tier-price="review"]');
    if (reviewEl && Number.isFinite(cheapest)) reviewEl.textContent = "From " + whole(cheapest);

    var monitoringEl = tiers.querySelector('[data-tier-price="monitoring"]');
    if (monitoringEl) monitoringEl.textContent = "From " + whole(PRICES.monitoring.baseCents);
  }

  /* --- Simulator --------------------------------------------------------- */

  var root = document.querySelector("[data-sim]");
  if (!root) return;

  var money = function (cents) {
    return (
      "$" +
      (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    );
  };

  var moneyRound = function (cents) {
    return "$" + Math.round(cents / 100).toLocaleString("en-US");
  };

  var value = function (name) {
    var field = root.querySelector('[name="' + name + '"]:checked') || root.querySelector('[name="' + name + '"]');
    return field ? field.value : "";
  };

  var number = function (name, fallback) {
    var field = root.querySelector('[name="' + name + '"]');
    var parsed = field ? parseInt(field.value, 10) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };

  var text = function (selector, content) {
    var node = root.querySelector(selector);
    if (node) node.textContent = content;
  };

  var lines = function (rows) {
    var list = root.querySelector("[data-sim-lines]");
    if (!list) return;
    list.innerHTML = "";
    rows.forEach(function (row) {
      var li = document.createElement("li");
      var label = document.createElement("span");
      label.textContent = row[0];
      var val = document.createElement("b");
      val.textContent = row[1];
      li.appendChild(label);
      li.appendChild(val);
      list.appendChild(li);
    });
  };

  /* --- Per-review ------------------------------------------------------- */

  var LABELS = {
    "general-medicine": "General medicine",
    cardiology: "Cardiology",
    oncology: "Oncology",
    neurology: "Neurology",
    radiology: "Radiology",
    other: "Other specialty",
    low: "Low",
    medium: "Medium",
    high: "High",
    single: "Single review",
    double: "Double review (two independent experts)"
  };

  function perReview() {
    var specialty = value("specialty");
    var complexity = value("complexity");
    var risk = value("risk");
    var mode = value("mode");
    var count = Math.min(10000, number("count", 1));

    var entry = PRICES.perReview[specialty + "|" + complexity + "|" + risk + "|" + mode];
    if (!entry) return;

    var total = count > 1 ? Math.round(entry.price * count * PRICES.batchDiscount) : entry.price;
    var saved = count > 1 ? entry.price * count - total : 0;

    text("[data-sim-price]", money(total));
    text("[data-sim-price-label]", count > 1 ? "Total for " + count + " reviews" : "Price per review");
    text(
      "[data-sim-sub]",
      "A " +
        LABELS[complexity].toLowerCase() +
        "-complexity " +
        LABELS[specialty].toLowerCase() +
        " case at " +
        LABELS[risk].toLowerCase() +
        " clinical risk, returned within " +
        entry.sla +
        " hours."
    );

    var rows = [
      ["Specialty", LABELS[specialty]],
      ["Case complexity", LABELS[complexity]],
      ["Clinical risk", LABELS[risk]],
      ["Review mode", LABELS[mode]],
      ["Turnaround target", entry.sla + " hours"],
      ["Price per review", money(entry.price)]
    ];
    if (count > 1) {
      rows.push(["Quantity", String(count)]);
      rows.push([
        "Volume discount (" + Math.round((1 - PRICES.batchDiscount) * 100) + "%)",
        "−" + money(saved)
      ]);
    }
    rows.push(["Total", money(total)]);
    lines(rows);
  }

  /* --- Continuous monitoring -------------------------------------------- */

  var MON_LABELS = {
    detection: "Detection only",
    audit: "Audit-grade evidence",
    chatbot: "Assistant / chatbot",
    agent: "Autonomous agent",
    batch: "Batch",
    realtime: "Real time"
  };

  function monitoring() {
    var m = PRICES.monitoring;
    var perDay = Math.min(5000000, number("requests", 1000));
    var risk = value("mrisk");
    var compliance = value("compliance");
    var model = value("model");
    var latency = value("latency");

    var monthlyRequests = perDay * 30;
    var multiplier = m.risk[risk] * m.compliance[compliance] * m.model[model] * m.latency[latency];
    var volume = Math.round(monthlyRequests * m.perRequestCents * multiplier);
    var total = m.baseCents + volume;

    text("[data-sim-price]", moneyRound(total));
    text("[data-sim-price-label]", "Estimated monthly");
    text(
      "[data-sim-sub]",
      monthlyRequests.toLocaleString("en-US") +
        " monitored outputs a month, sampled continuously and escalated to a clinician when the risk model flags them."
    );

    lines([
      ["Platform fee", moneyRound(m.baseCents) + " / month"],
      ["Monitored outputs", monthlyRequests.toLocaleString("en-US")],
      ["Risk profile", LABELS[risk] + " (×" + m.risk[risk] + ")"],
      ["Evidence level", MON_LABELS[compliance] + " (×" + m.compliance[compliance] + ")"],
      ["System type", MON_LABELS[model] + " (×" + m.model[model] + ")"],
      ["Latency", MON_LABELS[latency] + " (×" + m.latency[latency] + ")"],
      ["Volume component", moneyRound(volume)],
      ["Estimated monthly", moneyRound(total)]
    ]);
  }

  /* --- Tabs -------------------------------------------------------------- */

  var mode = "review";

  function render() {
    if (mode === "review") perReview();
    else monitoring();
  }

  function setMode(next) {
    mode = next;
    root.querySelectorAll("[data-sim-tab]").forEach(function (tab) {
      var selected = tab.dataset.simTab === next;
      tab.setAttribute("aria-selected", String(selected));
    });
    root.querySelectorAll("[data-sim-pane]").forEach(function (pane) {
      pane.hidden = pane.dataset.simPane !== next;
    });
    render();
  }

  root.querySelectorAll("[data-sim-tab]").forEach(function (tab) {
    tab.addEventListener("click", function () {
      setMode(tab.dataset.simTab);
    });
  });

  root.addEventListener("input", render);
  root.addEventListener("change", render);

  setMode("review");
})();
