/* Harmony Verify — live chat with a person.
 *
 * Deliberately not the assistant. The assistant answers instantly from what the
 * site already says; this reaches a colleague who can look at your account.
 * Conflating the two is how a visitor spends ten minutes explaining a billing
 * problem to a keyword matcher.
 *
 * So they are visually and positionally distinct — gold robot bottom-right,
 * outlined speech bubble bottom-left — and this one tells you honestly whether
 * anyone is actually there.
 *
 * Until a chat provider is connected, "start a chat" opens a composer that hands
 * off to email with the context already filled in. That is a real handover to a
 * real person, which is the promise being made. What it does not do is present a
 * fake agent typing indicator to someone waiting for help.
 *
 * To connect a provider, set data-chat-endpoint on [data-chat] and implement the
 * transport in `connect()` below. The office-hours logic and the escalation
 * entry point do not change.
 */
(function () {
  "use strict";

  var HOURS = { startUtc: 8, endUtc: 18, days: [1, 2, 3, 4, 5] };
  var INBOX = "hello@harmonyverify.org";

  function online() {
    var now = new Date();
    var day = now.getUTCDay();
    var hour = now.getUTCHours();
    return HOURS.days.indexOf(day) !== -1 && hour >= HOURS.startUtc && hour < HOURS.endUtc;
  }

  /** When the next working window opens, in the reader's own timezone. */
  function nextOpening() {
    var probe = new Date();
    for (var i = 0; i < 24 * 8; i++) {
      probe.setUTCHours(probe.getUTCHours() + 1, 0, 0, 0);
      var day = probe.getUTCDay();
      if (HOURS.days.indexOf(day) === -1) continue;
      if (probe.getUTCHours() < HOURS.startUtc || probe.getUTCHours() >= HOURS.endUtc) continue;
      return probe.toLocaleString(undefined, {
        weekday: "long",
        hour: "numeric",
        minute: "2-digit",
      });
    }
    return null;
  }

  var BUBBLE =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>' +
    "</svg>";

  var panel = null;

  var escapeHtml = function (value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  };

  function build(context) {
    var wrap = document.createElement("div");
    wrap.className = "chat-panel";
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-modal", "false");
    wrap.setAttribute("aria-label", "Chat with the Harmony Verify team");

    var live = online();
    var opens = live ? null : nextOpening();

    wrap.innerHTML =
      '<div class="chat-head">' +
      BUBBLE +
      "<div><h2>Chat with the team</h2>" +
      '<p class="chat-status" data-state="' +
      (live ? "online" : "offline") +
      '"><i></i>' +
      (live ? "Someone is here" : "Outside working hours") +
      "</p></div>" +
      '<button class="assist-close" type="button" aria-label="Close chat">&times;</button>' +
      "</div>" +
      '<div class="chat-body">' +
      (live
        ? "<p>A colleague picks these up during the working day. Tell us what you are trying to do and what is in the way — the more concrete, the faster this goes.</p>"
        : "<p>Nobody is at the desk right now. Send it anyway and it will be waiting" +
          (opens ? " — the next working window starts <b>" + escapeHtml(opens) + "</b> your time." : ".") +
          "</p>") +
      '<p class="muted">This reaches a person, not the assistant. Please do not include patient identifiers or passwords.</p>' +
      "</div>" +
      '<form class="assist-form" style="flex-direction:column;align-items:stretch;gap:10px">' +
      '<label class="sr-only" for="chat-email">Your email</label>' +
      '<input id="chat-email" type="email" required placeholder="Your email so we can reply">' +
      '<label class="sr-only" for="chat-message">Your message</label>' +
      '<input id="chat-message" type="text" required placeholder="What do you need?">' +
      '<button class="btn btn--gold btn--sm" type="submit">Send to the team</button>' +
      "</form>" +
      '<p class="assist-note">Prefer email? <a href="mailto:' +
      INBOX +
      '">' +
      INBOX +
      "</a></p>";

    wrap.querySelector(".assist-close").addEventListener("click", close);

    var form = wrap.querySelector("form");
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var email = wrap.querySelector("#chat-email").value.trim();
      var message = wrap.querySelector("#chat-message").value.trim();
      if (!email || !message) return;

      var lines = [message, "", "Reply to: " + email, "Page: " + window.location.href];
      if (context) lines.push("Context: " + context);

      window.location.href =
        "mailto:" +
        INBOX +
        "?subject=" +
        encodeURIComponent("Chat — " + message.slice(0, 60)) +
        "&body=" +
        encodeURIComponent(lines.join("\n"));

      var body = wrap.querySelector(".chat-body");
      body.innerHTML =
        "<p>Opening your email client so the message goes from an address we can reply to.</p>" +
        '<p class="muted">If nothing happened, write to <a href="mailto:' +
        INBOX +
        '">' +
        INBOX +
        "</a> directly.</p>";
      form.remove();
    });

    return wrap;
  }

  function open(context) {
    if (panel) return;
    panel = build(context);
    document.body.appendChild(panel);
    launcher.hidden = true;
    var input = panel.querySelector("#chat-email");
    if (input) input.focus();
    document.addEventListener("keydown", onKey, true);
  }

  function close() {
    if (!panel) return;
    document.removeEventListener("keydown", onKey, true);
    panel.remove();
    panel = null;
    launcher.hidden = false;
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
  launcher.className = "chat-launch";
  launcher.setAttribute("aria-label", "Chat with the Harmony Verify team");
  launcher.innerHTML = BUBBLE + "<span>Chat with a person</span>";
  launcher.addEventListener("click", function () {
    open(null);
  });
  document.body.appendChild(launcher);

  document.querySelectorAll("[data-chat-open]").forEach(function (trigger) {
    trigger.addEventListener("click", function (e) {
      e.preventDefault();
      open(trigger.dataset.chatContext || null);
    });
  });

  // Office hours stated on the page are UTC; show the reader their own.
  document.querySelectorAll("[data-chat-hours]").forEach(function (node) {
    node.textContent = online()
      ? "A colleague is available now"
      : "Monday to Friday, 08:00–18:00 UTC" + (nextOpening() ? " · next open " + nextOpening() : "");
  });

  /* The assistant calls this when it cannot help. Exposed rather than reached
     through a DOM event so the handover is an explicit, greppable contract
     between the two widgets. */
  window.HarmonyChat = { open: open, close: close, online: online };
})();
