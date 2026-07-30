/* Harmony Verify — cookie and storage consent.
 *
 * Loaded before anything that could set a cookie, and deliberately dependency-free
 * so it cannot itself be blocked by a consent decision.
 *
 * The rule it enforces: nothing but strictly necessary storage happens until the
 * visitor has chosen. Scripts that need consent are not written as <script src>;
 * they are written as
 *
 *     <script type="text/plain" data-consent="analytics" data-src="…"></script>
 *
 * and this file promotes them to real scripts only once their category is granted.
 * A tag that is never promoted never runs, so there is no window in which a
 * tracker fires and is cleaned up afterwards.
 *
 * The banner offers Accept, Reject and Preferences with equal weight. Reject is a
 * button of the same size and prominence as Accept — a rejection that takes three
 * clicks and a scroll is not a free choice, and treating it as compliance is how
 * organisations end up with consent records that do not stand up.
 */
(function () {
  "use strict";

  var STORE_KEY = "hv.consent.v1";
  var VERSION = 1;

  /* Categories. `essential` has no toggle: session and load balancing cookies are
   * required for the site to function and are not consentable under GDPR/ePrivacy.
   * Everything else defaults to denied. */
  var CATEGORIES = [
    {
      id: "essential",
      name: "Strictly necessary",
      required: true,
      description:
        "Keeps you signed in, balances load across our servers, and remembers this cookie choice. The site cannot work without these, so they cannot be switched off."
    },
    {
      id: "analytics",
      name: "Analytics",
      required: false,
      description:
        "Aggregated, de-identified measurement of which pages are read and where visitors leave. Never linked to a clinical submission and never sold."
    },
    {
      id: "marketing",
      name: "Marketing",
      required: false,
      description:
        "Measures whether a campaign led to a demo request. Off unless you turn it on."
    }
  ];

  var listeners = [];
  var state = read();

  /* --- Storage ---------------------------------------------------------- */

  function read() {
    try {
      var raw = window.localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== VERSION) return null;
      return parsed;
    } catch (e) {
      // Private browsing can throw on localStorage. Treat it as "no decision":
      // the visitor is asked again, which is the conservative outcome.
      return null;
    }
  }

  function write(grants) {
    var record = {
      version: VERSION,
      at: new Date().toISOString(),
      grants: grants
    };
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(record));
    } catch (e) {
      /* Nothing to do: the choice still applies to this page view. */
    }
    state = record;
    apply();
    listeners.forEach(function (fn) {
      try {
        fn(grants);
      } catch (e) {
        /* one bad listener must not break the rest */
      }
    });
  }

  function grants() {
    if (state && state.grants) return state.grants;
    var denied = { essential: true };
    CATEGORIES.forEach(function (c) {
      if (!c.required) denied[c.id] = false;
    });
    return denied;
  }

  var decided = function () {
    return Boolean(state);
  };

  /* --- Enforcement ------------------------------------------------------ */

  /** Promote every gated tag whose category is now granted. */
  function apply() {
    var g = grants();

    document.querySelectorAll('script[type="text/plain"][data-consent]').forEach(function (tag) {
      if (tag.dataset.consentLoaded === "true") return;
      if (!g[tag.dataset.consent]) return;

      var script = document.createElement("script");
      for (var i = 0; i < tag.attributes.length; i++) {
        var attr = tag.attributes[i];
        if (attr.name === "type" || attr.name === "data-src" || attr.name === "data-consent") continue;
        script.setAttribute(attr.name, attr.value);
      }
      if (tag.dataset.src) script.src = tag.dataset.src;
      else script.textContent = tag.textContent;

      tag.dataset.consentLoaded = "true";
      document.head.appendChild(script);
    });

    // Withdrawal has to actually remove what was set, or "reject" is decorative.
    CATEGORIES.forEach(function (c) {
      if (!c.required && !g[c.id]) clearCategoryCookies(c.id);
    });

    document.documentElement.dataset.consent = decided() ? "set" : "pending";
  }

  /* Cookie name prefixes we know belong to a category. Deleting by prefix rather
   * than deleting everything avoids destroying a session on withdrawal. */
  var COOKIE_PREFIXES = {
    analytics: ["_ga", "_gid", "_gat", "_hj", "_pk", "plausible", "ajs_"],
    marketing: ["_fbp", "_fbc", "fr", "_gcl", "li_", "muc_", "personalization_id"]
  };

  function clearCategoryCookies(category) {
    var prefixes = COOKIE_PREFIXES[category] || [];
    if (!document.cookie) return;

    var host = window.location.hostname;
    var domains = [host, "." + host];
    var parts = host.split(".");
    if (parts.length > 2) domains.push("." + parts.slice(-2).join("."));

    document.cookie.split(";").forEach(function (pair) {
      var name = pair.split("=")[0].trim();
      var owned = prefixes.some(function (prefix) {
        return name.indexOf(prefix) === 0;
      });
      if (!owned) return;

      domains.forEach(function (domain) {
        document.cookie =
          name + "=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=" + domain;
      });
      document.cookie = name + "=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
    });
  }

  /* --- UI --------------------------------------------------------------- */

  var banner = null;
  var dialog = null;
  var lastFocus = null;

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) {
      if (key === "class") node.className = attrs[key];
      else if (key === "text") node.textContent = attrs[key];
      else if (key === "html") node.innerHTML = attrs[key];
      else node.setAttribute(key, attrs[key]);
    });
    (children || []).forEach(function (child) {
      node.appendChild(child);
    });
    return node;
  }

  function buildBanner() {
    var accept = el("button", { class: "btn btn--gold btn--sm", type: "button", text: "Accept all" });
    var reject = el("button", { class: "btn btn--ghost btn--sm", type: "button", text: "Reject all" });
    var manage = el("button", { class: "btn btn--ghost btn--sm", type: "button", text: "Preferences" });

    accept.addEventListener("click", function () {
      acceptAll();
    });
    reject.addEventListener("click", function () {
      rejectAll();
    });
    manage.addEventListener("click", function () {
      openPreferences();
    });

    return el(
      "div",
      {
        class: "consent",
        role: "region",
        "aria-label": "Cookie choices",
        "data-consent-banner": ""
      },
      [
        el("div", { class: "consent-inner" }, [
          el("div", { class: "consent-copy" }, [
            el("h2", { class: "consent-title", text: "Cookies on this site" }),
            el("p", {
              text:
                "We use strictly necessary cookies to keep the site working. Analytics and marketing cookies are off until you turn them on, and you can change your mind at any time."
            })
          ]),
          el("div", { class: "consent-actions" }, [accept, reject, manage])
        ])
      ]
    );
  }

  function buildDialog() {
    var g = grants();
    var rows = CATEGORIES.map(function (c) {
      var input = el("input", { type: "checkbox", id: "consent-" + c.id });
      input.checked = c.required ? true : Boolean(g[c.id]);
      input.disabled = Boolean(c.required);

      return el("div", { class: "consent-row" }, [
        el("div", { class: "consent-row-head" }, [
          el("label", { class: "consent-row-name", for: "consent-" + c.id, text: c.name }),
          el("span", { class: "consent-switch" }, [input, el("span", { class: "consent-track" })])
        ]),
        el("p", { class: "consent-row-desc", text: c.description }),
        c.required ? el("p", { class: "consent-row-note", text: "Always active" }) : el("span", {})
      ]);
    });

    var save = el("button", { class: "btn btn--gold btn--sm", type: "button", text: "Save choices" });
    var allow = el("button", { class: "btn btn--ghost btn--sm", type: "button", text: "Accept all" });
    var none = el("button", { class: "btn btn--ghost btn--sm", type: "button", text: "Reject all" });
    var close = el("button", {
      class: "consent-close",
      type: "button",
      "aria-label": "Close cookie preferences",
      html: "&times;"
    });

    save.addEventListener("click", function () {
      var chosen = { essential: true };
      CATEGORIES.forEach(function (c) {
        if (c.required) return;
        var input = document.getElementById("consent-" + c.id);
        chosen[c.id] = Boolean(input && input.checked);
      });
      write(chosen);
      closePreferences();
      dismissBanner();
    });
    allow.addEventListener("click", function () {
      acceptAll();
      closePreferences();
    });
    none.addEventListener("click", function () {
      rejectAll();
      closePreferences();
    });
    close.addEventListener("click", closePreferences);

    var panel = el(
      "div",
      {
        class: "consent-panel",
        role: "dialog",
        "aria-modal": "true",
        "aria-labelledby": "consent-dialog-title"
      },
      [
        close,
        el("h2", { class: "consent-dialog-title", id: "consent-dialog-title", text: "Cookie preferences" }),
        el("p", {
          class: "consent-dialog-intro",
          text:
            "Choose what this site may store. Clinical material you submit is never used for advertising and is never shared with an analytics provider."
        }),
        el("div", { class: "consent-rows" }, rows),
        el("div", { class: "consent-dialog-actions" }, [save, allow, none]),
        el("p", { class: "consent-dialog-foot" }, [
          (function () {
            var link = el("a", { href: "privacy.html", text: "Read the privacy notice" });
            return link;
          })()
        ])
      ]
    );

    var overlay = el("div", { class: "consent-overlay", "data-consent-dialog": "" }, [panel]);
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) closePreferences();
    });
    return overlay;
  }

  function showBanner() {
    if (banner || decided()) return;
    banner = buildBanner();
    document.body.appendChild(banner);
    // Give the layout a frame so the entrance transition runs.
    window.requestAnimationFrame(function () {
      banner.dataset.in = "true";
    });
  }

  function dismissBanner() {
    if (!banner) return;
    banner.remove();
    banner = null;
  }

  function openPreferences() {
    if (dialog) return;
    lastFocus = document.activeElement;
    dialog = buildDialog();
    document.body.appendChild(dialog);
    document.body.dataset.consentOpen = "true";

    var focusables = dialog.querySelectorAll("button, input:not([disabled]), a[href]");
    if (focusables.length) focusables[0].focus();

    document.addEventListener("keydown", onDialogKey, true);
  }

  function closePreferences() {
    if (!dialog) return;
    document.removeEventListener("keydown", onDialogKey, true);
    dialog.remove();
    dialog = null;
    delete document.body.dataset.consentOpen;
    if (lastFocus && typeof lastFocus.focus === "function") lastFocus.focus();
  }

  function onDialogKey(e) {
    if (!dialog) return;
    if (e.key === "Escape") {
      e.preventDefault();
      closePreferences();
      return;
    }
    if (e.key !== "Tab") return;

    // Trap focus: a modal you can tab out of is a modal that hides the page
    // behind it from sighted users but not from a screen reader.
    var focusables = Array.prototype.slice
      .call(dialog.querySelectorAll("button, input:not([disabled]), a[href]"))
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

  function acceptAll() {
    var all = { essential: true };
    CATEGORIES.forEach(function (c) {
      all[c.id] = true;
    });
    write(all);
    dismissBanner();
  }

  function rejectAll() {
    var none = { essential: true };
    CATEGORIES.forEach(function (c) {
      if (!c.required) none[c.id] = false;
    });
    write(none);
    dismissBanner();
  }

  /* --- Public interface -------------------------------------------------- */

  window.HarmonyConsent = {
    categories: CATEGORIES,
    /** Current grants, e.g. { essential: true, analytics: false, marketing: false }. */
    grants: grants,
    /** True once the visitor has actively chosen. */
    decided: decided,
    /** True when this category may store anything. */
    allows: function (category) {
      return Boolean(grants()[category]);
    },
    /** Reopen the preferences dialog — wired to the footer link. */
    open: openPreferences,
    acceptAll: acceptAll,
    rejectAll: rejectAll,
    /** Called whenever the decision changes, and once immediately if already set. */
    on: function (fn) {
      listeners.push(fn);
      if (decided()) fn(grants());
    },
    /** Test and support hook: forget the decision and ask again. */
    reset: function () {
      try {
        window.localStorage.removeItem(STORE_KEY);
      } catch (e) {
        /* ignore */
      }
      state = null;
      apply();
      showBanner();
    }
  };

  /* --- Boot -------------------------------------------------------------- */

  function boot() {
    apply();
    if (!decided()) showBanner();

    document.querySelectorAll("[data-consent-open]").forEach(function (trigger) {
      trigger.addEventListener("click", function (e) {
        e.preventDefault();
        openPreferences();
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
