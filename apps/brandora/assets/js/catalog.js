/**
 * The catalogue (§25, §35, §36).
 *
 * Two rules from the spec are visible on this page rather than buried.
 *
 * §35: when you tell Brandora how many you need, anything that cannot be ordered
 * at that quantity leaves the main list and appears under a heading that says
 * why. It is not hidden — a founder who sees "available from 50" learns
 * something useful about their own order.
 *
 * §36: a product only shows "customisation available" when that has actually
 * been confirmed. Everything else says "not confirmed", which is honest and
 * costs one word.
 */

(function () {
  'use strict';

  var PACKAGE_KEY = 'brandora.package';

  var state = { products: [], quantity: 30, category: '', customizableOnly: false, search: '' };

  var el = {
    list: document.querySelector('[data-products]'),
    near: document.querySelector('[data-near-misses]'),
    nearWrap: document.querySelector('[data-near-wrap]'),
    quantity: document.querySelector('[data-quantity]'),
    category: document.querySelector('[data-category]'),
    customizable: document.querySelector('[data-customizable]'),
    search: document.querySelector('[data-search]'),
    count: document.querySelector('[data-count]'),
  };

  function money(amount) {
    // FCFA has no minor unit, so the figure is the amount. `Intl` is told not to
    // add decimals rather than being left to guess from the locale.
    var locale = { en: 'en-GB', fr: 'fr-FR', es: 'es-ES' }[document.documentElement.lang] || 'en-GB';
    return new Intl.NumberFormat(locale, { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount) + ' FCFA';
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function t(key, fallback, vars) {
    var translated = window.brandoraTranslate ? window.brandoraTranslate(key, vars) : null;
    return translated == null ? fallback : translated;
  }

  /** Mirrors `satisfiesQuantity` in @brandora/catalog. */
  function satisfiesQuantity(product, quantity) {
    return product.minimumQuantity <= quantity && product.availableQuantity >= quantity;
  }

  /** Mirrors `isCustomizable` — `unknown` is never treated as yes (§36). */
  function isCustomizable(product) {
    return product.customization.confidence === 'verified' || product.customization.confidence === 'reported';
  }

  function normalise(value) {
    return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  function matchesSearch(product, term) {
    var needle = normalise(term);
    return [product.name, product.description, product.subcategory, product.material || ''].some(function (field) {
      return normalise(field).indexOf(needle) !== -1;
    });
  }

  function card(product, orderable) {
    var custom = product.customization;
    var tag =
      custom.confidence === 'verified'
        ? '<span class="tag tag--ok">' + t('catalog.customizable', 'Customisation available') + '</span>'
        : custom.confidence === 'reported'
          ? '<span class="tag tag--ok">Customisation reported</span>'
          : '<span class="tag tag--unconfirmed">' + t('catalog.customization.unknown', 'Customisation not confirmed') + '</span>';

    var action = orderable
      ? '<button type="button" class="btn btn--primary btn--small" data-add="' + escapeHtml(product.id) + '">' +
        t('catalog.add', 'Add to Brand Package') +
        '</button>'
      : '<span class="product__meta">' + t('catalog.moq', 'From {min} units', { min: product.minimumQuantity }) + '</span>';

    return (
      '<article class="card">' +
      '<h3 style="font-size:1.05rem">' + escapeHtml(product.name) + '</h3>' +
      '<p class="product__meta">' + escapeHtml(product.subcategory) + (product.material ? ' &middot; ' + escapeHtml(product.material) : '') + '</p>' +
      '<p style="font-size:0.92rem;color:var(--ink-muted)">' + escapeHtml(product.description) + '</p>' +
      '<p>' + tag + '</p>' +
      '<p class="product__price">' + money(product.indicativeUnitPrice.amount) + ' <span class="product__meta">/ unit</span></p>' +
      '<p class="product__meta">' + t('catalog.moq', 'From {min} units', { min: product.minimumQuantity }) + '</p>' +
      action +
      '</article>'
    );
  }

  function render() {
    var quantity = state.quantity;

    var eligible = state.products.filter(function (product) {
      if (product.status !== 'active') return false;
      if (state.category && product.category !== state.category) return false;
      if (state.customizableOnly && !isCustomizable(product)) return false;
      if (state.search && !matchesSearch(product, state.search)) return false;
      return true;
    });

    var matches = [];
    var nearMisses = [];
    eligible.forEach(function (product) {
      if (!quantity || satisfiesQuantity(product, quantity)) matches.push(product);
      else nearMisses.push(product);
    });

    el.list.innerHTML = matches.length
      ? matches
          .map(function (product) {
            return card(product, true);
          })
          .join('')
      : '<p class="notice">' + t('catalog.empty', 'Nothing here yet.') + '</p>';

    if (nearMisses.length) {
      el.nearWrap.hidden = false;
      el.near.innerHTML = nearMisses
        .map(function (product) {
          return card(product, false);
        })
        .join('');
    } else {
      el.nearWrap.hidden = true;
      el.near.innerHTML = '';
    }

    el.count.textContent = matches.length + (matches.length === 1 ? ' product' : ' products');
  }

  /* --- Adding to the package --------------------------------------------- */

  function readPackage() {
    try {
      var raw = localStorage.getItem(PACKAGE_KEY);
      return raw ? JSON.parse(raw) : { items: [] };
    } catch (err) {
      return { items: [] };
    }
  }

  function addToPackage(productId) {
    var product = state.products.find(function (candidate) {
      return candidate.id === productId;
    });
    if (!product) return;

    // The same clamp the package builder applies server-side: a quantity below
    // the product's minimum becomes the minimum rather than an error.
    var quantity = Math.max(state.quantity || product.minimumQuantity, product.minimumQuantity);

    var pkg = readPackage();
    var existing = pkg.items.find(function (item) {
      return item.productId === productId;
    });

    if (existing) existing.quantity += quantity;
    else pkg.items.push({ productId: productId, name: product.name, quantity: quantity });

    try {
      localStorage.setItem(PACKAGE_KEY, JSON.stringify(pkg));
    } catch (err) {
      return;
    }

    var button = document.querySelector('[data-add="' + productId + '"]');
    if (button) {
      var original = button.textContent;
      button.textContent = 'Added ✓';
      button.disabled = true;
      window.setTimeout(function () {
        button.textContent = original;
        button.disabled = false;
      }, 1400);
    }
  }

  /* --- Wiring ------------------------------------------------------------- */

  document.addEventListener('click', function (event) {
    var add = event.target.closest ? event.target.closest('[data-add]') : null;
    if (add) addToPackage(add.getAttribute('data-add'));
  });

  document.addEventListener('input', function (event) {
    if (event.target === el.quantity) {
      var parsed = parseInt(event.target.value, 10);
      state.quantity = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
      render();
    }
    if (event.target === el.search) {
      state.search = event.target.value.trim();
      render();
    }
  });

  document.addEventListener('change', function (event) {
    if (event.target === el.category) {
      state.category = event.target.value;
      render();
    }
    if (event.target === el.customizable) {
      state.customizableOnly = event.target.checked;
      render();
    }
  });

  document.addEventListener('brandora:locale', function () {
    if (state.products.length) render();
  });

  fetch('data/catalog.json')
    .then(function (response) {
      return response.json();
    })
    .then(function (data) {
      state.products = data.products;
      render();
    })
    .catch(function () {
      el.list.innerHTML =
        '<p class="notice">We could not load the catalogue just now. Please refresh the page.</p>';
    });
})();
