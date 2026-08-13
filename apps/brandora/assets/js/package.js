/**
 * The brand package.
 *
 * Every figure on this page was calculated by the server. This file does not
 * add, multiply or divide a single amount — it prints strings the server
 * formatted, because the browser has no idea that FCFA is zero-decimal and a
 * front end that divides by 100 turns 15 000 FCFA into 150.
 *
 * Quantities are sent; prices are received. That is the whole contract.
 */

import {
  ApiError,
  api,
  clear,
  currentProjectId,
  el,
  hideError,
  mountAccountNav,
  price,
  projectUrl,
  requireSignIn,
  showError,
} from './api.js';

const node = {
  identity: document.querySelector('[data-identity]'),
  lines: document.querySelector('[data-lines]'),
  empty: document.querySelector('[data-empty]'),
  totals: document.querySelector('[data-totals]'),
  error: document.querySelector('[data-error]'),
  quote: document.querySelector('[data-request-quote]'),
  recommended: document.querySelector('[data-recommended]'),
  recommendedWrap: document.querySelector('[data-recommended-wrap]'),
};

const state = { projectId: currentProjectId(), user: null };

/* --- The brand this package belongs to -------------------------------------- */

function renderIdentity(project) {
  clear(node.identity);
  if (!project || !project.strategy) return;

  const palette = (project.identity && project.identity.palette) || [];

  node.identity.appendChild(
    el('div', { class: 'card card--flat' }, [
      el('p', { class: 'eyebrow', text: 'For' }),
      el('h2', { style: 'margin-bottom:0.25rem', text: project.strategy.name }),
      el('p', { class: 'product__meta', text: project.strategy.slogan || '' }),
      el(
        'ul',
        { class: 'swatches', style: 'margin-top:1rem' },
        palette.map((swatch) =>
          el('li', { class: 'swatch' }, [
            el('div', { class: 'swatch__chip', style: `background:${swatch.hex}`, 'aria-hidden': 'true' }),
            el('div', { class: 'swatch__name', text: swatch.name }),
          ]),
        ),
      ),
      el('p', {}, [
        el('a', { href: projectUrl('brand.html', state.projectId), text: 'Open the brand book →' }),
      ]),
    ]),
  );
}

/* --- Lines and totals -------------------------------------------------------- */

function lineCard(item, adjustments) {
  const adjusted = adjustments.find((entry) => entry.productId === item.productId);

  return el('article', { class: 'card' }, [
    el('h3', { style: 'font-size:1.05rem', text: item.name }),
    item.customizationMethod
      ? el('p', { class: 'product__meta', text: `With your logo · ${item.customizationMethod}` })
      : null,
    el('p', { class: 'product__price', text: price(item.lineTotal) }),
    el('p', { class: 'product__meta', text: `${price(item.unitPrice)} per unit` }),
    adjusted
      ? el('p', {
          class: 'notice notice--accent',
          // Saying so beats charging for 25 when someone typed 10.
          text: `You asked for ${adjusted.requested}; this product starts at ${adjusted.charged}, so that is what is priced.`,
        })
      : null,
    el('div', { class: 'line-controls' }, [
      el('label', { class: 'visually-hidden', for: `qty-${item.id}`, text: 'Quantity' }),
      el('input', {
        class: 'input input--compact',
        id: `qty-${item.id}`,
        type: 'number',
        min: '1',
        step: '1',
        value: String(item.quantity),
        inputmode: 'numeric',
        'data-quantity-for': item.id,
      }),
      el('button', {
        class: 'btn btn--quiet btn--small',
        type: 'button',
        'data-remove': item.id,
        text: 'Remove',
      }),
    ]),
  ]);
}

const TOTAL_ROWS = [
  ['products', 'Products'],
  ['customization', 'Your logo applied'],
  ['shipping', 'Delivery'],
  ['logistics', 'Handling'],
  ['service', 'Brandora service'],
];

function renderTotals(payload) {
  clear(node.totals);

  if (!payload.totals) {
    node.totals.appendChild(el('p', { class: 'product__meta', text: 'Add a product to see your total.' }));
    return;
  }

  const table = el('table', { class: 'totals' }, [
    el('caption', { class: 'visually-hidden', text: 'Package totals' }),
  ]);
  const body = el('tbody', {});

  TOTAL_ROWS.forEach(([key, label]) => {
    body.appendChild(
      el('tr', {}, [el('th', { scope: 'row', text: label }), el('td', { text: price(payload.totals[key]) })]),
    );
  });

  body.appendChild(
    el('tr', {}, [
      el('th', { scope: 'row', text: `Total · ${payload.totals.unitCount} units` }),
      el('td', { text: price(payload.totals.total) }),
    ]),
  );

  table.appendChild(body);
  node.totals.appendChild(table);

  // §39: a customer sees what they pay, never what Brandora paid.
  node.totals.appendChild(
    el('p', {
      class: 'product__meta',
      text: 'Delivery is Brandora’s own charge, not a carrier quote. A carrier estimate is confirmed after your order.',
    }),
  );
}

function render(payload) {
  clear(node.lines);
  const items = payload.items || [];
  const adjustments = payload.adjustments || [];

  items.forEach((item) => node.lines.appendChild(lineCard(item, adjustments)));

  node.empty.hidden = items.length > 0;
  node.quote.hidden = items.length === 0;
  renderTotals(payload);
}

/* --- Recommendations --------------------------------------------------------- */

async function renderRecommendations() {
  if (!state.projectId || !state.user) return;
  try {
    const payload = await api.recommendations(state.projectId, 30);
    clear(node.recommended);

    payload.recommendations.slice(0, 6).forEach((entry) => {
      node.recommended.appendChild(
        el('article', { class: 'card' }, [
          el('h3', { style: 'font-size:1.02rem', text: entry.product.name }),
          el('p', { class: 'product__reason', text: entry.reasons[0] || '' }),
          el('p', { class: 'product__price', text: `${price(entry.product.unitPrice)} per unit` }),
          el('a', {
            class: 'btn btn--ghost btn--small',
            href: projectUrl('catalog.html', state.projectId),
            text: 'See in the catalogue',
          }),
        ]),
      );
    });

    node.recommendedWrap.hidden = payload.recommendations.length === 0;
  } catch (err) {
    /* No brand yet. The package still works. */
  }
}

/* --- Loading and actions ------------------------------------------------------ */

async function load() {
  if (!state.projectId) {
    node.empty.hidden = false;
    node.quote.hidden = true;
    return;
  }
  try {
    const [project, pkg] = await Promise.all([
      api.project(state.projectId),
      api.package(state.projectId),
    ]);
    renderIdentity(project);
    render(pkg);
  } catch (err) {
    if (err instanceof ApiError && err.isUnauthenticated) return requireSignIn();
    showError(node.error, err);
  }
}

async function setQuantity(itemId, quantity) {
  hideError(node.error);
  try {
    render(await api.setItemQuantity(state.projectId, itemId, quantity));
  } catch (err) {
    showError(node.error, err);
    void load();
  }
}

async function remove(itemId) {
  hideError(node.error);
  try {
    render(await api.removeItem(state.projectId, itemId));
  } catch (err) {
    showError(node.error, err);
  }
}

async function requestQuote() {
  hideError(node.error);
  node.quote.disabled = true;
  node.quote.setAttribute('aria-busy', 'true');
  try {
    const payload = await api.createQuote(state.projectId);
    window.location.href = `quote.html?id=${encodeURIComponent(payload.quote.id)}`;
  } catch (err) {
    node.quote.disabled = false;
    node.quote.removeAttribute('aria-busy');
    if (err instanceof ApiError && err.isUnauthenticated) return requireSignIn();
    showError(node.error, err);
  }
}

document.addEventListener('click', (event) => {
  const removeButton = event.target.closest ? event.target.closest('[data-remove]') : null;
  if (removeButton) return void remove(removeButton.getAttribute('data-remove'));

  if (event.target.closest && event.target.closest('[data-request-quote]')) void requestQuote();
});

document.addEventListener('change', (event) => {
  const input = event.target.closest ? event.target.closest('[data-quantity-for]') : null;
  if (!input) return;
  const quantity = Number(input.value);
  if (!Number.isFinite(quantity) || quantity < 1) {
    void load();
    return;
  }
  void setQuantity(input.getAttribute('data-quantity-for'), Math.floor(quantity));
});

async function boot() {
  state.user = await mountAccountNav();
  document.querySelectorAll('[data-catalog-link]').forEach((link) => {
    link.setAttribute('href', projectUrl('catalog.html', state.projectId));
  });
  await load();
  await renderRecommendations();
}

void boot();
