/* Harmony Verify — "Book a demo", backed by Calendly.
 *
 * There is exactly one scheduling system on this site and it is Calendly's. No
 * slots are stored here, no availability is mirrored here, and nothing on this
 * page can tell you when someone is free — the embed asks Calendly at the moment
 * it opens, so what a visitor sees is live.
 *
 * Two deliberate choices:
 *
 * 1. Calendly's own popup (Calendly.initPopupWidget) is not used. It injects its
 *    own overlay, whose focus handling and close affordance we cannot style or
 *    correct. The inline embed is mounted inside our own dialog instead, so the
 *    close button, the focus trap, the scroll lock and the escape key behave the
 *    same as every other modal on this site.
 *
 * 2. Calendly's script is not in the page markup. It is fetched on the first
 *    click and never again — a third party that a visitor has not asked for does
 *    not get to run, set cookies, or cost them a request on page load. That is
 *    the same rule consent.js enforces for tags; this one enforces it by never
 *    being a tag in the first place. The dialog says so in a line of text, so
 *    the handoff to a third party is disclosed rather than silent.
 *
 * Configuration: SCHEDULING_URL below is the only place the link lives. While it
 * is empty every "Book a demo" control quietly falls back to its href — the
 * contact page — so the site is never shipped with a button that opens a broken
 * scheduler. Set it and the same buttons open the modal, with no other change.
 */
(function () {
  "use strict";

  /* The founder's Calendly event: "30 Minute Meeting", hosted on Zoom.
     One value, used by every control on the site — see the fallback note above. */
  var SCHEDULING_URL = "https://calendly.com/yvanadarele/30min";

  var WIDGET_JS = "https://assets.calendly.com/assets/external/widget.js";
  var WIDGET_CSS = "https://assets.calendly.com/assets/external/widget.css";

  /* Calendly reads these from the query string and paints the scheduler to
     match, which is the difference between an embed and an iframe that looks
     borrowed. Hex without the "#", exactly as their embed API expects. */
  var THEME = {
    background_color: "101B36",
    text_color: "E9EDF5",
    primary_color: "D4AF37",
    hide_gdpr_banner: "1",
    hide_landing_page_details: "1"
  };

  function schedulingUrl() {
    if (!SCHEDULING_URL) return "";
    var url = SCHEDULING_URL.trim();
    var join = url.indexOf("?") === -1 ? "?" : "&";
    var query = Object.keys(THEME)
      .filter(function (key) {
        // Never overwrite a parameter already present in the configured link.
        return url.indexOf(key + "=") === -1;
      })
      .map(function (key) {
        return key + "=" + encodeURIComponent(THEME[key]);
      })
      .join("&");
    return query ? url + join + query : url;
  }

  var configured = Boolean(SCHEDULING_URL);

  /* --- Loading Calendly once -------------------------------------------- */

  var loading = null;

  function loadWidget() {
    // Memoised: every later click reuses this promise, so the script and the
    // stylesheet are requested exactly once per page view however many times
    // the modal is opened and closed.
    if (loading) return loading;

    loading = new Promise(function (resolve, reject) {
      if (window.Calendly) {
        resolve(window.Calendly);
        return;
      }

      if (!document.querySelector('link[href="' + WIDGET_CSS + '"]')) {
        var css = document.createElement("link");
        css.rel = "stylesheet";
        css.href = WIDGET_CSS;
        document.head.appendChild(css);
      }

      var script = document.createElement("script");
      script.src = WIDGET_JS;
      script.async = true;
      script.addEventListener("load", function () {
        if (window.Calendly) resolve(window.Calendly);
        else reject(new Error("Calendly loaded without exposing its widget API"));
      });
      script.addEventListener("error", function () {
        // Let the next click try again rather than caching the failure.
        loading = null;
        reject(new Error("Calendly could not be reached"));
      });
      document.head.appendChild(script);
    });

    return loading;
  }

  /* --- The dialog -------------------------------------------------------- */

  var modal = null;
  var lastFocus = null;

  function build() {
    var wrap = document.createElement("div");
    wrap.className = "cal-overlay";
    wrap.setAttribute("data-calendly-modal", "");

    wrap.innerHTML =
      '<div class="cal-modal" role="dialog" aria-modal="true" aria-labelledby="cal-title">' +
      '<div class="cal-head">' +
      '<div><h2 class="cal-title" id="cal-title">Book a demo</h2>' +
      '<p class="cal-sub">Pick a time that suits you. Scheduling is handled by Calendly, ' +
      "which loads in the panel below and sets its own cookies.</p></div>" +
      '<button class="cal-close" type="button" aria-label="Close the booking panel">&times;</button>' +
      "</div>" +
      '<div class="cal-body"><div class="cal-mount" data-cal-mount></div>' +
      '<p class="cal-state" data-cal-state>Loading live availability…</p></div>' +
      "</div>";

    wrap.querySelector(".cal-close").addEventListener("click", close);
    wrap.addEventListener("click", function (e) {
      if (e.target === wrap) close();
    });

    return wrap;
  }

  function fail(message) {
    if (!modal) return;
    var state = modal.querySelector("[data-cal-state]");
    if (!state) return;
    state.hidden = false;
    state.innerHTML =
      escapeHtml(message) +
      ' <a href="' +
      escapeHtml(SCHEDULING_URL || "contact.html") +
      '"' +
      (SCHEDULING_URL ? ' target="_blank" rel="noopener"' : "") +
      ">" +
      (SCHEDULING_URL ? "Open the scheduler in a new tab" : "Use the contact form instead") +
      "</a>.";
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function open() {
    if (modal || !configured) return;

    lastFocus = document.activeElement;
    modal = build();
    document.body.appendChild(modal);
    document.body.dataset.calOpen = "true";
    document.addEventListener("keydown", onKey, true);

    var close_ = modal.querySelector(".cal-close");
    if (close_) close_.focus();

    loadWidget()
      .then(function (Calendly) {
        if (!modal) return; // closed again before the script arrived
        var mount = modal.querySelector("[data-cal-mount]");
        var state = modal.querySelector("[data-cal-state]");
        Calendly.initInlineWidget({
          url: schedulingUrl(),
          parentElement: mount,
          prefill: {},
          utm: {}
        });
        if (state) state.hidden = true;
      })
      .catch(function () {
        fail("Calendly did not load.");
      });
  }

  function close() {
    if (!modal) return;
    document.removeEventListener("keydown", onKey, true);
    modal.remove();
    modal = null;
    delete document.body.dataset.calOpen;
    if (lastFocus && typeof lastFocus.focus === "function") lastFocus.focus();
  }

  function onKey(e) {
    if (!modal) return;

    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== "Tab") return;

    /* Focus stays in the dialog. Note that the scheduler itself is a
       cross-origin iframe: once focus moves inside it the browser owns tab
       order, and it returns to us at the edges — which is why the close button
       is the first focusable thing rather than the last. */
    var focusables = Array.prototype.slice
      .call(modal.querySelectorAll('button, a[href], iframe, [tabindex]:not([tabindex="-1"])'))
      .filter(function (node) {
        return node.offsetParent !== null;
      });
    if (!focusables.length) return;

    var first = focusables[0];
    var last = focusables[focusables.length - 1];

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  /* --- Wiring ------------------------------------------------------------ */

  /* Delegated, so a control added to any page — or injected later by another
     script — works without registering itself here. */
  function onClick(e) {
    var trigger = e.target.closest ? e.target.closest("[data-book-demo]") : null;
    if (!trigger) return;
    if (!configured) return; // fall through to the href
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button > 0) return; // let "open in new tab" work

    e.preventDefault();
    open();
  }

  window.HarmonyDemo = {
    open: open,
    close: close,
    /** False while no Calendly link is configured; the buttons then use their href. */
    configured: function () {
      return configured;
    }
  };

  function boot() {
    document.addEventListener("click", onClick);
    // Tell CSS whether the buttons are live, so nothing has to guess in markup.
    document.documentElement.dataset.demoBooking = configured ? "calendly" : "fallback";
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
