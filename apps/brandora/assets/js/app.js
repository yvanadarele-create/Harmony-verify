/**
 * The Brandora shell: theme, language, the opening animation and scroll reveals.
 *
 * Loaded on every page. Kept to one file and one request because §72 and §63
 * point at the same reality — this product is used on a phone, often on a slow
 * connection, and every extra round trip is a second of blank screen for someone
 * deciding whether to trust it.
 *
 * Nothing here is required for the page to work. The HTML is complete and
 * readable with JavaScript switched off; this adds preference, motion and
 * translation on top.
 */

(function () {
  'use strict';

  document.documentElement.classList.remove('no-js');

  /* --- Theme (§6, §7) ---------------------------------------------------- */

  var THEME_KEY = 'brandora.theme';

  /**
   * Dark is not Brandora's default — it is Brandora's *primary experience* (§6).
   * The polished black surface with one purple highlight is the brand, in the
   * same way the logo is, so a first visit shows it whatever the operating
   * system happens to prefer.
   *
   * A person's own choice is a different matter and always wins. Once someone
   * has picked light, they get light on every page and every visit (§7) — the
   * brand gets the first impression, the user gets every one after that.
   */
  function preferredTheme() {
    try {
      var stored = localStorage.getItem(THEME_KEY);
      if (stored === 'dark' || stored === 'light') return stored;
    } catch (err) {
      // Private browsing, or storage disabled. The brand default still applies.
    }
    return 'dark';
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'light' ? '#FBFAFC' : '#050507');

    var toggles = document.querySelectorAll('[data-theme-toggle]');
    for (var i = 0; i < toggles.length; i += 1) {
      toggles[i].setAttribute('aria-pressed', theme === 'light' ? 'true' : 'false');
      var label = toggles[i].querySelector('[data-theme-label]');
      if (label) label.textContent = theme === 'light' ? 'Light' : 'Dark';
    }
  }

  function setTheme(theme) {
    applyTheme(theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (err) {
      // The preference simply does not persist. The page still works.
    }
  }

  applyTheme(preferredTheme());

  document.addEventListener('click', function (event) {
    var toggle = event.target.closest ? event.target.closest('[data-theme-toggle]') : null;
    if (!toggle) return;
    setTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light');
  });

  /* --- Language (§23) ----------------------------------------------------- */

  var LOCALE_KEY = 'brandora.locale';
  var SUPPORTED = ['en', 'fr', 'es'];

  function preferredLocale() {
    try {
      var stored = localStorage.getItem(LOCALE_KEY);
      if (SUPPORTED.indexOf(stored) !== -1) return stored;
    } catch (err) {
      // Ignored, as above.
    }
    var languages = navigator.languages || [navigator.language || 'en'];
    for (var i = 0; i < languages.length; i += 1) {
      var base = String(languages[i]).toLowerCase().split('-')[0];
      if (SUPPORTED.indexOf(base) !== -1) return base;
    }
    return 'en';
  }

  var catalogue = {};

  function translate(key, vars) {
    var template = catalogue[key];
    if (!template) return null;
    if (!vars) return template;
    return template.replace(/\{(\w+)\}/g, function (whole, name) {
      return Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole;
    });
  }

  /**
   * Apply the catalogue to the page.
   *
   * `data-i18n` swaps text; `data-i18n-attr` swaps an attribute, which is what
   * placeholders, titles and aria-labels need. A key with no translation leaves
   * the markup alone rather than blanking it — the English in the HTML is a
   * working fallback, not filler.
   */
  function applyLocale(locale) {
    document.documentElement.setAttribute('lang', locale);

    var nodes = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i += 1) {
      var value = translate(nodes[i].getAttribute('data-i18n'));
      if (value !== null) nodes[i].textContent = value;
    }

    var attrNodes = document.querySelectorAll('[data-i18n-attr]');
    for (var j = 0; j < attrNodes.length; j += 1) {
      var pairs = attrNodes[j].getAttribute('data-i18n-attr').split(',');
      for (var k = 0; k < pairs.length; k += 1) {
        var parts = pairs[k].split(':');
        var translated = translate(parts[1]);
        if (translated !== null) attrNodes[j].setAttribute(parts[0].trim(), translated);
      }
    }

    var switches = document.querySelectorAll('[data-locale-switch]');
    for (var m = 0; m < switches.length; m += 1) switches[m].value = locale;

    document.dispatchEvent(new CustomEvent('brandora:locale', { detail: { locale: locale, t: translate } }));
  }

  function loadLocale(locale) {
    return fetch('locales/' + locale + '.json')
      .then(function (response) {
        if (!response.ok) throw new Error('locale ' + locale + ' unavailable');
        return response.json();
      })
      .then(function (data) {
        catalogue = data;
        applyLocale(locale);
      })
      .catch(function () {
        // The page keeps its authored English. A failed translation fetch must
        // never leave someone looking at an empty interface.
        applyLocale(locale);
      });
  }

  loadLocale(preferredLocale());

  document.addEventListener('change', function (event) {
    if (!event.target.hasAttribute || !event.target.hasAttribute('data-locale-switch')) return;
    var locale = event.target.value;
    try {
      localStorage.setItem(LOCALE_KEY, locale);
    } catch (err) {
      // Not persisted; still applied for this visit.
    }
    loadLocale(locale);
  });

  window.brandoraTranslate = translate;

  /* --- The opening animation (§9) ---------------------------------------- */

  var intro = document.querySelector('[data-intro]');
  if (intro) {
    var seen = false;
    try {
      seen = sessionStorage.getItem('brandora.intro') === 'seen';
    } catch (err) {
      seen = false;
    }

    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (seen || reduced) {
      intro.hidden = true;
    } else {
      // Once per session, not once per page. A cinematic open is a welcome; the
      // fourth time in five minutes it is an obstacle.
      window.setTimeout(function () {
        intro.style.transition = 'opacity 0.6s ease';
        intro.style.opacity = '0';
        window.setTimeout(function () {
          intro.hidden = true;
        }, 600);
      }, 3600);
      try {
        sessionStorage.setItem('brandora.intro', 'seen');
      } catch (err) {
        // Then it plays again next navigation. Not worth failing over.
      }
    }
  }

  /* --- Reveal on scroll --------------------------------------------------- */

  var revealables = document.querySelectorAll('[data-reveal]');
  if (revealables.length && 'IntersectionObserver' in window) {
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: '0px 0px -8% 0px' },
    );
    for (var n = 0; n < revealables.length; n += 1) observer.observe(revealables[n]);
  } else {
    for (var p = 0; p < revealables.length; p += 1) revealables[p].classList.add('is-visible');
  }

  /* --- Current page in the navigation ------------------------------------- */

  var here = window.location.pathname.replace(/\/index\.html$/, '/').replace(/\.html$/, '');
  var links = document.querySelectorAll('.site-nav a');
  for (var q = 0; q < links.length; q += 1) {
    var target = links[q].getAttribute('href').replace(/\.html$/, '').replace(/^\.\//, '');
    if (target && here.indexOf(target) !== -1 && target !== '') {
      links[q].setAttribute('aria-current', 'page');
    }
  }
})();
