/* Harmony Verify — language switcher.
 *
 * The site is generated three times over: English at the root, French under
 * /fr/, Spanish under /es/. So switching language is a navigation, not a repaint
 * — the document that arrives is already in the language asked for, with its own
 * <html lang>, <title> and meta description. Nothing here translates anything.
 *
 * This file does three small things:
 *
 *   1. Builds the globe control and its menu, in the nav and so also inside the
 *      mobile panel, since that panel is the same <ul>.
 *   2. Remembers the choice, so a visitor who picked French once and later types
 *      a bare URL still lands in French. That check runs before the body paints,
 *      which is why the tag is in <head> and not deferred with the rest.
 *   3. Nothing else. No detection from Accept-Language, no geolocation. English
 *      is the default until somebody chooses otherwise, deliberately: guessing
 *      wrong on a clinical site is worse than being predictable.
 */
(function () {
  "use strict";

  var KEY = "harmony_language";
  var LANGS = [
    { code: "en", label: "English", dir: "" },
    { code: "fr", label: "Français", dir: "fr" },
    { code: "es", label: "Español", dir: "es" }
  ];

  var UI = {
    en: { open: "Change language", current: "Current language" },
    fr: { open: "Changer de langue", current: "Langue actuelle" },
    es: { open: "Cambiar de idioma", current: "Idioma actual" }
  };

  function stored() {
    try {
      var value = window.localStorage.getItem(KEY);
      return LANGS.some(function (l) { return l.code === value; }) ? value : null;
    } catch (e) {
      return null; // private browsing: fall through to the page's own language
    }
  }

  function remember(code) {
    try {
      window.localStorage.setItem(KEY, code);
    } catch (e) {
      /* the choice still applies to this navigation */
    }
  }

  /** The language this document was generated in. */
  function current() {
    var lang = (document.documentElement.getAttribute("lang") || "en").slice(0, 2);
    return LANGS.some(function (l) { return l.code === lang; }) ? lang : "en";
  }

  /** Path with any language prefix removed: /fr/pricing -> /pricing */
  function bare() {
    var path = window.location.pathname;
    var m = /^\/(fr|es)(\/|$)/.exec(path);
    return m ? path.slice(m[1].length + 1) || "/" : path;
  }

  /** Where this page lives in another language. */
  function urlFor(code) {
    var rest = bare();
    var lang = LANGS.filter(function (l) { return l.code === code; })[0];
    var prefix = lang && lang.dir ? "/" + lang.dir : "";
    var path = prefix + (rest === "/" ? "/" : rest);
    return path + window.location.search + window.location.hash;
  }

  /* --- Honour a remembered choice ---------------------------------------- */

  /* Runs at parse time, before the body exists, so a redirect costs a fraction
     of a second rather than a visible flash of the wrong language. Once per
     navigation: sessionStorage stops a loop if a target is ever missing. */
  (function restore() {
    var want = stored();
    if (!want || want === current()) return;
    try {
      if (window.sessionStorage.getItem("harmony_language_moved") === "1") return;
      window.sessionStorage.setItem("harmony_language_moved", "1");
    } catch (e) {
      return; // no session storage, no guard, so do not risk a loop
    }
    window.location.replace(urlFor(want));
  })();

  /* --- The control -------------------------------------------------------- */

  var GLOBE =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" ' +
    'stroke-linecap="round" aria-hidden="true" focusable="false">' +
    '<circle cx="12" cy="12" r="9"/>' +
    '<path d="M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18"/>' +
    "</svg>";

  function build() {
    var nav = document.getElementById("nav-links");
    if (!nav || nav.querySelector("[data-lang]")) return;

    var now = current();
    var words = UI[now] || UI.en;

    var item = document.createElement("li");
    item.className = "lang";
    item.setAttribute("data-lang", "");

    var button = document.createElement("button");
    button.type = "button";
    button.className = "lang-btn";
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-haspopup", "true");
    button.setAttribute("aria-label", words.open);
    button.innerHTML = GLOBE + '<span class="lang-code">' + now.toUpperCase() + "</span>";

    var menu = document.createElement("ul");
    menu.className = "lang-menu";
    menu.hidden = true;

    LANGS.forEach(function (lang) {
      var li = document.createElement("li");
      var link = document.createElement("a");
      link.href = urlFor(lang.code);
      link.textContent = lang.label;
      link.setAttribute("hreflang", lang.code);
      link.setAttribute("lang", lang.code);
      if (lang.code === now) {
        link.setAttribute("aria-current", "true");
        link.title = words.current;
      }
      link.addEventListener("click", function () {
        remember(lang.code);
        try {
          // This navigation is the choice, so the guard must not block it.
          window.sessionStorage.removeItem("harmony_language_moved");
        } catch (e) {
          /* ignore */
        }
      });
      li.appendChild(link);
      menu.appendChild(li);
    });

    function opened() {
      return button.getAttribute("aria-expanded") === "true";
    }

    function open() {
      menu.hidden = false;
      button.setAttribute("aria-expanded", "true");
      document.addEventListener("click", onOutside, true);
      document.addEventListener("keydown", onKey, true);
    }

    function close(focusBack) {
      menu.hidden = true;
      button.setAttribute("aria-expanded", "false");
      document.removeEventListener("click", onOutside, true);
      document.removeEventListener("keydown", onKey, true);
      if (focusBack) button.focus();
    }

    function onOutside(e) {
      if (!item.contains(e.target)) close(false);
    }

    function onKey(e) {
      if (!opened()) return;
      if (e.key === "Escape") {
        e.preventDefault();
        close(true);
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Tab") return;

      var links = Array.prototype.slice.call(menu.querySelectorAll("a"));
      var at = links.indexOf(document.activeElement);

      if (e.key === "Tab") {
        // Leaving the menu closes it rather than stranding it open behind you.
        if (!e.shiftKey && at === links.length - 1) close(false);
        if (e.shiftKey && at <= 0) close(false);
        return;
      }
      e.preventDefault();
      var next = e.key === "ArrowDown" ? at + 1 : at - 1;
      if (next < 0) next = links.length - 1;
      if (next >= links.length) next = 0;
      links[next].focus();
    }

    button.addEventListener("click", function () {
      if (opened()) close(false);
      else {
        open();
        var first = menu.querySelector('a[aria-current="true"]') || menu.querySelector("a");
        if (first) first.focus();
      }
    });

    item.appendChild(button);
    item.appendChild(menu);

    // Before the call-to-action buttons, after the section links. Found by
    // scanning rather than with :has(), which is younger than some of the
    // browsers a hospital IT department still ships.
    var rows = nav.children;
    var firstBtn = null;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].querySelector(".btn")) {
        firstBtn = rows[i];
        break;
      }
    }
    if (firstBtn) nav.insertBefore(item, firstBtn);
    else nav.appendChild(item);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", build);
  } else {
    build();
  }

  window.HarmonyLanguage = {
    languages: LANGS,
    current: current,
    stored: stored,
    urlFor: urlFor
  };
})();
