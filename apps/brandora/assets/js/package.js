/**
 * The Brand Package Builder and the quote preview (§42, §43).
 *
 * The figure on this page is labelled an *estimate*, and that word is doing real
 * work. Shipping depends on a freight query against a destination, and the
 * Brandora service line depends on a sourcing run — neither has happened yet.
 * Showing a confident total here and a different one on the quote is the fastest
 * way to lose a customer's trust, so the page shows what it knows and names what
 * it does not.
 */

(function () {
  'use strict';

  var PACKAGE_KEY = 'brandora.package';
  var IDENTITY_KEY = 'brandora.identity';

  var state = { products: [], items: [], identity: null };

  var el = {
    lines: document.querySelector('[data-lines]'),
    totals: document.querySelector('[data-totals]'),
    empty: document.querySelector('[data-empty]'),
    identity: document.querySelector('[data-identity]'),
    starters: document.querySelector('[data-starters]'),
  };

  function money(amount) {
    var locale = { en: 'en-GB', fr: 'fr-FR', es: 'es-ES' }[document.documentElement.lang] || 'en-GB';
    return new Intl.NumberFormat(locale, { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount) + ' FCFA';
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function t(key, fallback) {
    var translated = window.brandoraTranslate ? window.brandoraTranslate(key) : null;
    return translated == null ? fallback : translated;
  }

  function read() {
    try {
      var raw = localStorage.getItem(PACKAGE_KEY);
      state.items = raw ? JSON.parse(raw).items || [] : [];
    } catch (err) {
      state.items = [];
    }
    try {
      var identity = localStorage.getItem(IDENTITY_KEY);
      state.identity = identity ? JSON.parse(identity) : null;
    } catch (err) {
      state.identity = null;
    }
  }

  function write() {
    try {
      localStorage.setItem(PACKAGE_KEY, JSON.stringify({ items: state.items }));
    } catch (err) {
      // Nothing to do — the page still reflects the change for this visit.
    }
  }

  function productFor(item) {
    return state.products.find(function (product) {
      return product.id === item.productId;
    });
  }

  /**
   * Products plus customisation, the same two components the server-side
   * `packageTotals` returns. Shipping and service are deliberately absent: they
   * are not knowable until a destination and a sourcing run exist.
   */
  function totals() {
    var products = 0;
    var customization = 0;
    var units = 0;

    state.items.forEach(function (item) {
      var product = productFor(item);
      if (!product) return;
      products += product.indicativeUnitPrice.amount * item.quantity;
      units += item.quantity;
      var custom = product.customization;
      if (custom && custom.unitCost && custom.confidence === 'verified') {
        customization += custom.unitCost.amount * item.quantity + (custom.setupCost ? custom.setupCost.amount : 0);
      }
    });

    return { products: products, customization: customization, units: units, estimate: products + customization };
  }

  function renderIdentity() {
    if (!state.identity) {
      el.identity.innerHTML =
        '<p class="notice">You have not built a brand yet. <a href="create.html">Start with your idea</a> and Brandora will apply your colours here.</p>';
      return;
    }

    var swatches = state.identity.palette
      .map(function (swatch) {
        return '<li class="swatch"><div class="swatch__chip" style="background:' + swatch.hex + '"></div><div class="swatch__name">' + escapeHtml(swatch.name) + '</div></li>';
      })
      .join('');

    el.identity.innerHTML =
      '<div class="card"><h2 style="font-size:1.1rem">' + escapeHtml(state.identity.name) + '</h2>' +
      '<ul class="swatches">' + swatches + '</ul>' +
      '<p class="product__meta">Every product below will carry these colours in the visualizer and on the quote.</p></div>';
  }

  function renderStarters(starters) {
    if (!starters || !starters.length) return;
    el.starters.innerHTML = starters
      .map(function (starter) {
        return (
          '<article class="card card--flat">' +
          '<h3 style="font-size:1rem">' + escapeHtml(starter.label) + '</h3>' +
          '<p style="font-size:0.9rem;color:var(--ink-muted)">' + escapeHtml(starter.rationale) + '</p>' +
          '<button type="button" class="btn btn--ghost btn--small" data-starter="' + escapeHtml(starter.key) + '">Add this package</button>' +
          '</article>'
        );
      })
      .join('');
  }

  function render() {
    if (!state.items.length) {
      el.empty.hidden = false;
      el.lines.innerHTML = '';
      el.totals.innerHTML = '';
      renderIdentity();
      return;
    }
    el.empty.hidden = true;

    el.lines.innerHTML = state.items
      .map(function (item) {
        var product = productFor(item);
        if (!product) return '';
        var lineTotal = product.indicativeUnitPrice.amount * item.quantity;
        return (
          '<div class="card card--flat" style="display:grid;gap:0.5rem">' +
          '<div style="display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap">' +
          '<strong>' + escapeHtml(product.name) + '</strong>' +
          '<span class="product__price">' + money(lineTotal) + '</span>' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap">' +
          '<label class="product__meta" for="qty-' + escapeHtml(item.productId) + '">' + t('package.quantity', 'Quantity') + '</label>' +
          '<input type="number" id="qty-' + escapeHtml(item.productId) + '" value="' + item.quantity +
          '" min="' + product.minimumQuantity + '" step="1" inputmode="numeric" style="width:7rem" data-qty="' + escapeHtml(item.productId) + '">' +
          '<span class="product__meta">min ' + product.minimumQuantity + '</span>' +
          '<button type="button" class="btn btn--quiet btn--small" data-remove="' + escapeHtml(item.productId) + '">' +
          t('package.remove', 'Remove') + '</button>' +
          '</div></div>'
        );
      })
      .join('');

    var sums = totals();
    el.totals.innerHTML =
      '<table class="totals"><tbody>' +
      '<tr><th scope="row">' + t('quote.products', 'Product costs') + '</th><td>' + money(sums.products) + '</td></tr>' +
      (sums.customization
        ? '<tr><th scope="row">' + t('quote.customization', 'Customisation') + '</th><td>' + money(sums.customization) + '</td></tr>'
        : '') +
      '<tr><th scope="row">' + t('quote.shipping', 'Shipping') + '</th><td class="product__meta">Calculated at quote</td></tr>' +
      '<tr><th scope="row">' + t('quote.service', 'Brandora service') + '</th><td class="product__meta">Calculated at quote</td></tr>' +
      '<tr><th scope="row">' + t('package.total', 'Estimated total') + '</th><td>' + money(sums.estimate) + '</td></tr>' +
      '</tbody></table>' +
      '<p class="product__meta">' + sums.units + ' units across ' + state.items.length +
      (state.items.length === 1 ? ' product' : ' products') + '.</p>' +
      '<p class="notice">Shipping and the Brandora service line are added when we run sourcing against your delivery address. ' +
      'We do not estimate a delivery date until a carrier gives us one.</p>';

    renderIdentity();
  }

  /* --- Interaction --------------------------------------------------------- */

  document.addEventListener('click', function (event) {
    var remove = event.target.closest ? event.target.closest('[data-remove]') : null;
    if (remove) {
      var id = remove.getAttribute('data-remove');
      state.items = state.items.filter(function (item) {
        return item.productId !== id;
      });
      write();
      render();
      return;
    }

    var starter = event.target.closest ? event.target.closest('[data-starter]') : null;
    if (starter) addStarter(starter.getAttribute('data-starter'));
  });

  document.addEventListener('change', function (event) {
    var field = event.target.hasAttribute && event.target.hasAttribute('data-qty') ? event.target : null;
    if (!field) return;

    var id = field.getAttribute('data-qty');
    var item = state.items.find(function (candidate) {
      return candidate.productId === id;
    });
    var product = item ? productFor(item) : null;
    if (!item || !product) return;

    var requested = parseInt(field.value, 10);
    // The same clamp as the engine: below the minimum becomes the minimum.
    item.quantity = Number.isFinite(requested) && requested > 0
      ? Math.max(requested, product.minimumQuantity)
      : product.minimumQuantity;

    write();
    render();
  });

  var starterData = [];

  function addStarter(key) {
    var starter = starterData.find(function (candidate) {
      return candidate.key === key;
    });
    if (!starter) return;

    starter.items.forEach(function (line) {
      var existing = state.items.find(function (item) {
        return item.productId === line.productId;
      });
      if (existing) existing.quantity += line.quantity;
      else state.items.push({ productId: line.productId, quantity: line.quantity });
    });

    write();
    render();
  }

  document.addEventListener('brandora:locale', function () {
    if (state.products.length) render();
  });

  read();

  fetch('data/catalog.json')
    .then(function (response) {
      return response.json();
    })
    .then(function (data) {
      state.products = data.products;
      starterData = data.starterPackages || [];
      renderStarters(starterData);
      render();
    })
    .catch(function () {
      el.lines.innerHTML = '<p class="notice">We could not load your package just now. Please refresh the page.</p>';
    });
})();
