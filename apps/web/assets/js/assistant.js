/* Harmony Verify — site assistant.
 *
 * Answers come from assets/js/knowledge.js. This file is the plumbing: matching,
 * rendering, focus handling.
 *
 * Matching is weighted-term scoring rather than a chain of regexes. A regex chain
 * answers the phrasing its author imagined and falls through on everything else,
 * which is what makes most site widgets feel stupid — they know the answer and
 * still say "I didn't understand that". Here every entry is scored against the
 * question: exact phrases count heavily, individual words count a little,
 * stopwords count for nothing, and the best scorer answers. If nothing clears the
 * confidence floor the assistant says so and offers the nearest topics, instead
 * of confidently returning whatever matched first.
 *
 * Two modes, and which one is running is visible rather than implied:
 *
 *   Guided (default). No network request, no transcript stored, no cookie set —
 *   so it works before a cookie decision is made, and still works if the visitor
 *   rejects everything.
 *
 *   Model-backed. When the page carries data-assist-endpoint, questions go to
 *   that endpoint — a server route holding ANTHROPIC_API_KEY. The key stays
 *   server-side: a key a browser can read is a key that is public.
 *
 * Clinical questions are refused in both modes.
 */
(function () {
  "use strict";

  var mount = document.querySelector("[data-assistant]");
  var KB = window.HarmonyKnowledge;
  if (!mount || !KB) return;

  var endpoint = mount.dataset.assistEndpoint || "";
  var panel = null;
  var log = null;
  var history = [];

  /* --- Matching ---------------------------------------------------------- */

  /* Words that appear in almost every question and so distinguish nothing. */
  var STOPWORDS = {
    a: 1, an: 1, the: 1, is: 1, are: 1, was: 1, do: 1, does: 1, did: 1, can: 1,
    could: 1, would: 1, will: 1, i: 1, we: 1, you: 1, my: 1, our: 1, your: 1,
    to: 1, of: 1, for: 1, in: 1, on: 1, at: 1, it: 1, this: 1, that: 1, and: 1,
    or: 1, but: 1, if: 1, so: 1, be: 1, been: 1, have: 1, has: 1, get: 1, got: 1,
    me: 1, us: 1, what: 1, whats: 1, how: 1, when: 1, where: 1, who: 1, why: 1,
    with: 1, about: 1, there: 1, any: 1, some: 1, please: 1, hi: 1, hello: 1
  };

  var normalise = function (text) {
    return " " + text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim() + " ";
  };

  var tokens = function (text) {
    return normalise(text)
      .trim()
      .split(" ")
      .filter(function (word) {
        return word.length > 2 && !STOPWORDS[word];
      });
  };

  /**
   * Crude suffix stripping so "reviews", "reviewing" and "reviewed" all reach
   * "review". Not linguistically principled — it does not need to be. It only
   * has to stop a question failing because someone wrote a verb in a tense the
   * keyword list didn't anticipate.
   */
  function stem(word) {
    return word
      .replace(/(ing|edly|ally|ily)$/, "")
      .replace(/(ies)$/, "y")
      .replace(/(ed|es|ly|s)$/, "");
  }

  var similar = function (a, b) {
    if (a === b) return true;
    var sa = stem(a);
    var sb = stem(b);
    if (sa === sb) return true;
    // Prefix containment catches "internal" ↔ "internally", "price" ↔ "pricing".
    return (sa.length > 3 && sb.indexOf(sa) === 0) || (sb.length > 3 && sa.indexOf(sb) === 0);
  };

  /**
   * Score one term against the question.
   *
   * A phrase matched whole is worth far more than its words matched separately:
   * "start small" in a question is a strong signal, "small" alone is noise. A
   * phrase also matches when the words appear in order with something between
   * them — "who reviews" should still fire on "who actually reviews my output",
   * which is exactly the kind of sentence a keyword list never anticipates.
   */
  function termScore(term, haystack, words) {
    var needle = normalise(term).trim();
    var length = needle.split(" ").length;

    if (haystack.indexOf(needle) !== -1) return 10 + length * 4;

    var parts = needle.split(" ").filter(function (w) {
      return w.length > 2 && !STOPWORDS[w];
    });
    if (parts.length === 0) return 0;

    // In-order match with gaps, for multi-word terms.
    if (parts.length > 1) {
      var cursor = -1;
      var ordered = parts.every(function (part) {
        for (var i = cursor + 1; i < words.length; i++) {
          if (similar(words[i], part)) {
            cursor = i;
            return true;
          }
        }
        return false;
      });
      if (ordered) return 9 + parts.length * 3;
    }

    var hit = parts.filter(function (part) {
      return words.some(function (word) {
        return similar(word, part);
      });
    }).length;

    return hit === 0 ? 0 : (hit / parts.length) * 6;
  }

  /**
   * Score an entry: its single best term, plus a small contribution from the
   * rest.
   *
   * Summing every term would mean an entry with twenty keywords beats a
   * precise entry with six simply by having more chances to catch a stray word
   * — which is how "what happens if the review is wrong" ends up answered by
   * the reviewers entry instead of the refund one.
   */
  function score(entry, question) {
    var haystack = normalise(question);
    var words = tokens(question);

    var scores = entry.terms
      .map(function (term) {
        return termScore(term, haystack, words);
      })
      .sort(function (a, b) {
        return b - a;
      });

    if (scores.length === 0 || scores[0] === 0) return 0;

    var support = scores.slice(1).reduce(function (sum, value) {
      return sum + value;
    }, 0);

    return scores[0] + Math.min(support * 0.22, 6);
  }

  var CONFIDENCE_FLOOR = 6;

  function answer(question) {
    if (KB.clinical.test(question)) return { text: KB.clinicalReply, id: "clinical" };

    var ranked = KB.entries
      .map(function (entry) {
        return { entry: entry, score: score(entry, question) };
      })
      .sort(function (a, b) {
        return b.score - a.score;
      });

    var best = ranked[0];
    if (!best || best.score < CONFIDENCE_FLOOR) {
      return { text: KB.fallback, id: "fallback", suggestions: nearest(ranked) };
    }

    // A near-tie means the question genuinely touches two topics; say both
    // rather than picking one and sounding certain about it.
    var runnerUp = ranked[1];
    var text = best.entry.a;
    if (runnerUp && runnerUp.score > CONFIDENCE_FLOOR && runnerUp.score >= best.score * 0.82) {
      text += "<br><br>" + runnerUp.entry.a;
    }
    return { text: text, id: best.entry.id };
  }

  /** Topics that scored something, offered when nothing scored enough. */
  function nearest(ranked) {
    return ranked
      .filter(function (row) {
        return row.score > 1.5;
      })
      .slice(0, 3)
      .map(function (row) {
        return row.entry.terms[0];
      });
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

  var escapeHtml = function (value) {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  };

  function say(from, html) {
    if (!log) return null;
    var msg = document.createElement("div");
    msg.className = "assist-msg";
    msg.dataset.from = from;
    msg.innerHTML = html;
    log.appendChild(msg);
    log.scrollTop = log.scrollHeight;
    return msg;
  }

  function offer(questions) {
    if (!panel || !questions || questions.length === 0) return;
    var old = panel.querySelector(".assist-suggest");
    if (old) old.remove();

    var row = document.createElement("div");
    row.className = "assist-suggest";
    questions.forEach(function (question) {
      var button = document.createElement("button");
      button.type = "button";
      button.textContent = question;
      button.addEventListener("click", function () {
        ask(question);
      });
      row.appendChild(button);
    });
    panel.insertBefore(row, panel.querySelector(".assist-form"));
  }

  function ask(question) {
    var trimmed = String(question || "").trim();
    if (!trimmed) return;

    say("you", escapeHtml(trimmed));
    history.push({ role: "user", content: trimmed });

    var suggestions = panel.querySelector(".assist-suggest");
    if (suggestions) suggestions.remove();

    var local = answer(trimmed);

    if (!endpoint || local.id === "clinical") {
      window.setTimeout(function () {
        say("bot", local.text);
        history.push({ role: "assistant", content: local.text });
        if (local.suggestions && local.suggestions.length) offer(local.suggestions);
      }, 160);
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
        var reply = typeof data.reply === "string" && data.reply.trim() ? data.reply : local.text;
        history.push({ role: "assistant", content: reply });
        if (pending) pending.innerHTML = reply;
      })
      .catch(function () {
        // Degrade to the guided answer rather than showing an error: the visitor
        // asked a question and is entitled to the answer we already have.
        if (pending) pending.innerHTML = local.text;
        if (local.suggestions && local.suggestions.length) offer(local.suggestions);
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
      '<form class="assist-form">' +
      '<label class="sr-only" for="assist-input">Your question</label>' +
      '<input id="assist-input" type="text" autocomplete="off" placeholder="Ask about pricing, turnaround, security…">' +
      '<button type="submit">Send</button>' +
      "</form>" +
      '<p class="assist-note">This assistant does not give medical advice and does not see your submissions. Nothing you type here is stored.</p>';

    log = wrap.querySelector(".assist-log");

    wrap.querySelector(".assist-close").addEventListener("click", close);

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
      "Hello. I can explain how verification works, what it costs, how fast it is, who reviews your output and how your data is handled. What would be useful?"
    );
    offer(KB.starters);

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

  // Exposed so the browser test suite can assert routing without opening the UI.
  window.HarmonyAssistant = { answer: answer, score: score, open: open, ask: ask };
})();
