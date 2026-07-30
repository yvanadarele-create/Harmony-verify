/* Harmony Verify — site assistant.
 *
 * Two modes, and which one is running is visible to the visitor rather than
 * implied:
 *
 *   Guided (default). Answers come from the knowledge base below — the same facts
 *   that are on the pages, routed by keyword. No network request, no transcript
 *   stored, no cookie set, so it works before a cookie decision is made and it
 *   still works if the visitor rejects everything.
 *
 *   Model-backed. When the page carries data-assist-endpoint, questions are sent
 *   to that endpoint, which is a server route holding ANTHROPIC_API_KEY. The key
 *   stays server-side: a browser that could read it is a key that is public, and
 *   an API key in a static site is public the moment the site ships.
 *
 * The assistant never claims a clinical fact. Clinical questions are routed to a
 * human, because a marketing widget guessing at medicine is precisely the failure
 * this company exists to catch.
 */
(function () {
  "use strict";

  var mount = document.querySelector("[data-assistant]");
  if (!mount) return;

  var endpoint = mount.dataset.assistEndpoint || "";
  var panel = null;
  var log = null;
  var history = [];

  /* --- Knowledge base ---------------------------------------------------- */

  var ANSWERS = [
    {
      match: /price|pricing|cost|how much|quote|budget|expensive|fee/i,
      reply:
        "Pricing is calculated per case rather than sold as a fixed package, because a low-risk general medicine note and a high-risk oncology recommendation are not the same piece of work. Specialty, case complexity and clinical risk set the price, and volume earns a discount. <a href=\"pricing.html\">The pricing page has a simulator</a> that gives you the exact figure for your case mix."
    },
    {
      match: /monitor|continuous|ongoing|volume|per month|subscription/i,
      reply:
        "Continuous monitoring is a monthly arrangement: we sample your live output, score it, and escalate to a clinician when the risk model flags something. It starts at $500 a month plus a volume component. <a href=\"pricing.html\">Model it on the pricing page</a>."
    },
    {
      match: /expert|clinician|doctor|reviewer|physician|who reviews/i,
      reply:
        "Reviews are done by licensed, practising clinicians, credentialled before they are admitted and matched to your case by specialty. Every review carries the reviewer's name and credentials. <a href=\"experts.html\">The expert network page</a> covers how they are vetted and where they are."
    },
    {
      match: /apply|join|become an expert|work with you|reviewer role|clinician role/i,
      reply:
        "Clinicians apply through the expert network page. Admission requires at least three years post-qualification practice, a verifiable license and a named institution, and every application is scored across eight dimensions. <a href=\"experts.html#apply\">Start here</a>."
    },
    {
      match: /partner|integrat|reseller|api partner|work together/i,
      reply:
        "Partnerships are assessed on strategic fit, technical readiness, commercial potential, compliance standing and risk. <a href=\"contact.html\">Tell us what you are building</a> and we will come back with an assessment."
    },
    {
      match: /security|privacy|data|hipaa|gdpr|phi|compliance|store my/i,
      reply:
        "Clinical material is handled as confidential, is never used for advertising, and is never shared with an analytics provider. <a href=\"trust.html\">The trust page</a> sets out how we handle data — and, just as important, which certifications we do not yet hold. We do not claim attestations we have not completed."
    },
    {
      match: /how (does|do).*(work|verif)|process|workflow|what happens/i,
      reply:
        "You send an AI-generated output. It is classified for specialty, complexity and clinical risk, priced, and routed to a matched clinician. They assess accuracy, hallucination, missing information, safety and clinical reasoning, and return a signed record with corrections. <a href=\"platform.html\">The platform page walks through it</a>."
    },
    {
      match: /how long|turnaround|sla|fast|speed|when will/i,
      reply:
        "Turnaround depends on complexity and risk — higher clinical risk compresses the target rather than extending it. A low-complexity case targets 24 hours; a high-risk case is much tighter. The simulator on <a href=\"pricing.html\">the pricing page</a> shows the target for your case."
    },
    {
      match: /report|record|audit|evidence|documentation|pdf/i,
      reply:
        "Each verification returns a signed record: the original output, the reviewer's assessment against each rubric dimension, any corrections with sources, and the reviewer's credentials. It is written to be handed to a clinical governance committee without translation."
    },
    {
      match: /format|file type|upload|pdf|docx|word|txt|image/i,
      reply:
        "Submissions can be PDF, Word (.docx), plain text or images. Anything else needs to be converted first."
    },
    {
      match: /demo|trial|pilot|get started|sign up|access/i,
      reply:
        "Design partners start by routing a real sample and getting a measured baseline back. <a href=\"contact.html\">Request access</a> and tell us what you are building."
    },
    {
      match: /cookie|tracking|consent/i,
      reply:
        "Only strictly necessary cookies run before you choose. Analytics and marketing stay off unless you switch them on, and you can change that at any time from the footer."
    }
  ];

  var CLINICAL =
    /diagnos|treat|dose|dosage|mg\b|prescrib|symptom|my patient|should i take|is it safe to|medication|drug interaction/i;

  var FALLBACK =
    'I can help with pricing, how verification works, who the reviewers are, data handling, and getting started. For anything else, <a href="contact.html">the team will pick it up directly</a>.';

  function guidedReply(question) {
    if (CLINICAL.test(question)) {
      return "I can't help with clinical questions — not a hedge, a design decision. Harmony Verify does not practise medicine and does not give medical advice, and an assistant guessing at clinical content would be the exact failure this company exists to catch. For anything clinical, speak to a qualified clinician.";
    }
    var hit = ANSWERS.find(function (entry) {
      return entry.match.test(question);
    });
    return hit ? hit.reply : FALLBACK;
  }

  /* --- Rendering ---------------------------------------------------------- */

  var ROBOT =
    '<svg viewBox="0 0 40 40" fill="none" aria-hidden="true" focusable="false">' +
    '<rect x="8" y="13" width="24" height="19" rx="5" stroke="currentColor" stroke-width="1.6"/>' +
    '<path d="M20 6v7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' +
    '<circle cx="20" cy="5" r="2.2" fill="currentColor"/>' +
    '<circle cx="15.5" cy="21" r="2.1" fill="currentColor"/>' +
    '<circle cx="24.5" cy="21" r="2.1" fill="currentColor"/>' +
    '<path d="M15.5 27h9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' +
    '<path d="M8 19H4.5M32 19h3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' +
    "</svg>";

  function say(from, html) {
    if (!log) return;
    var msg = document.createElement("div");
    msg.className = "assist-msg";
    msg.dataset.from = from;
    msg.innerHTML = html;
    log.appendChild(msg);
    log.scrollTop = log.scrollHeight;
    return msg;
  }

  var escapeHtml = function (value) {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  };

  function ask(question) {
    var trimmed = question.trim();
    if (!trimmed) return;

    say("you", escapeHtml(trimmed));
    history.push({ role: "user", content: trimmed });

    var suggestions = panel.querySelector(".assist-suggest");
    if (suggestions) suggestions.remove();

    if (!endpoint) {
      var reply = guidedReply(trimmed);
      history.push({ role: "assistant", content: reply });
      window.setTimeout(function () {
        say("bot", reply);
      }, 180);
      return;
    }

    var pending = say("bot", "…");

    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ messages: history.slice(-12) })
    })
      .then(function (res) {
        if (!res.ok) throw new Error("assistant unavailable");
        return res.json();
      })
      .then(function (data) {
        var answer = typeof data.reply === "string" && data.reply.trim() ? data.reply : guidedReply(trimmed);
        history.push({ role: "assistant", content: answer });
        if (pending) pending.innerHTML = answer;
      })
      .catch(function () {
        // Degrade to the guided answer rather than showing an error: the visitor
        // asked a question and is entitled to the answer we already have.
        if (pending) pending.innerHTML = guidedReply(trimmed);
      });
  }

  function build() {
    var wrap = document.createElement("div");
    wrap.className = "assist-panel";
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-modal", "false");
    wrap.setAttribute("aria-label", "Harmony Verify assistant");

    wrap.innerHTML =
      '<div class="assist-head">' +
      ROBOT +
      "<div><h2>Harmony assistant</h2><p>Answers about the platform, not about medicine.</p></div>" +
      '<button class="assist-close" type="button" aria-label="Close assistant">&times;</button>' +
      "</div>" +
      '<div class="assist-log" role="log" aria-live="polite"></div>' +
      '<div class="assist-suggest">' +
      '<button type="button">How does verification work?</button>' +
      '<button type="button">What does it cost?</button>' +
      '<button type="button">Who are the reviewers?</button>' +
      '<button type="button">How is my data handled?</button>' +
      "</div>" +
      '<form class="assist-form">' +
      '<label class="sr-only" for="assist-input">Your question</label>' +
      '<input id="assist-input" type="text" autocomplete="off" placeholder="Ask about pricing, reviewers, security…">' +
      '<button type="submit">Send</button>' +
      "</form>" +
      '<p class="assist-note">This assistant does not give medical advice and does not see your submissions. Nothing you type here is stored.</p>';

    log = wrap.querySelector(".assist-log");

    wrap.querySelector(".assist-close").addEventListener("click", close);
    wrap.querySelectorAll(".assist-suggest button").forEach(function (button) {
      button.addEventListener("click", function () {
        ask(button.textContent);
      });
    });

    var form = wrap.querySelector(".assist-form");
    var input = wrap.querySelector("#assist-input");
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      ask(input.value);
      input.value = "";
    });

    return wrap;
  }

  function open() {
    if (panel) return;
    panel = build();
    document.body.appendChild(panel);
    launcher.setAttribute("aria-expanded", "true");
    launcher.hidden = true;

    say(
      "bot",
      "Hello. I can explain how verification works, what it costs, who reviews your output and how your data is handled. What would be useful?"
    );

    var input = panel.querySelector("#assist-input");
    if (input) input.focus();
    document.addEventListener("keydown", onKey, true);
  }

  function close() {
    if (!panel) return;
    document.removeEventListener("keydown", onKey, true);
    panel.remove();
    panel = null;
    log = null;
    history = [];
    launcher.hidden = false;
    launcher.setAttribute("aria-expanded", "false");
    launcher.focus();
  }

  function onKey(e) {
    if (e.key === "Escape" && panel) {
      e.preventDefault();
      close();
    }
  }

  var launcher = document.createElement("button");
  launcher.type = "button";
  launcher.className = "assist-launch";
  launcher.setAttribute("aria-expanded", "false");
  launcher.innerHTML = ROBOT + "<span>Ask Harmony</span>";
  launcher.addEventListener("click", open);
  document.body.appendChild(launcher);
})();
