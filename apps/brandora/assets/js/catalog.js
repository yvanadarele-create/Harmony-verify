/**
 * The catalogue (§34, §35, §36).
 *
 * Three rules the server enforces and this page has to *show*:
 *
 *   §35 — a product that cannot be ordered at the stated quantity is demoted,
 *   not deleted. "This exists, from fifty" is useful; a product silently
 *   vanishing teaches nothing.
 *
 *   §36 — "carries your logo" is a claim, and it is only made where the
 *   catalogue has confirmed it. Everything else says so in as many words.
 *
 *   §38 — no delivery date is shown, because none has been quoted by a carrier.
 *
 * Adding to a package writes to the server, against the project. The browser
 * holds nothing but the id of the project being worked on.
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
  showError,
} from './api.js';

const node = {
  quantity: document.querySelector('[data-quantity]'),
  category: document.querySelector('[data-category]'),
  search: document.querySelector('[data-search]'),
  customizable: document.querySelector('[data-customizable]'),
  products: document.querySelector('[data-products]'),
  nearMisses: document.querySelector('[data-near-misses]'),
  nearWrap: document.querySelector('[data-near-wrap]'),
  count: document.querySelector('[data-count]'),
  banner: document.querySelector('[data-brand-banner]'),
  error: document.querySelector('[data-error]'),
};

const state = {
  projectId: currentProjectId(),
  user: null,
  brandName: null,
  recommended: new Map(),
};

/* --- Rendering -------------------------------------------------------------- */

function customizationTag(product) {
  const info = product.customization;
  return el('span', {
    class: `tag ${info.canCarryLogo ? 'tag--ok' : 'tag--unconfirmed'}`,
    text: info.label,
  });
}

function productCard(product, orderable, quantity) {
  const reason = state.recommended.get(product.id);

  const actions = orderable
    ? [
        el('button', {
          class: 'btn btn--primary btn--small',
          type: 'button',
          'data-add': product.id,
          text: 'Add to my package',
        }),
      ]
    : [
        el('p', {
          class: 'product__meta',
          text: `Minimum order ${product.minimumQuantity}. Raise your quantity to add it.`,
        }),
      ];

  return el('article', { class: 'card' }, [
    el('h3', { text: product.name }),
    el('p', { class: 'product__meta', text: `${product.category} · ${product.subcategory}` }),
    el('p', { text: product.description }),
    reason ? el('p', { class: 'product__reason', text: `Recommended: ${reason}` }) : null,
    el('p', { class: 'product__price', text: `${price(product.unitPrice)} per unit` }),
    el('p', { class: 'product__meta' }, [
      customizationTag(product),
      el('span', { text: ` Minimum ${product.minimumQuantity}` }),
    ]),
    // §38 in the interface, not only in the data.
    el('p', { class: 'product__meta', text: 'Delivery estimate available once your order is confirmed.' }),
    ...actions,
  ]);
}

function render(payload, quantity) {
  clear(node.products);
  clear(node.nearMisses);

  payload.products.forEach((product) => {
    node.products.appendChild(productCard(product, true, quantity));
  });

  const near = payload.nearMisses || [];
  near.forEach((product) => {
    node.nearMisses.appendChild(productCard(product, false, quantity));
  });

  node.nearWrap.hidden = near.length === 0;

  node.count.textContent = `${payload.products.length} of ${payload.total} products can be ordered at ${quantity} units.`;

  if (payload.products.length === 0 && near.length === 0) {
    node.products.appendChild(
      el('p', { class: 'notice', text: 'Nothing matches that yet. Try a different category or quantity.' }),
    );
  }
}

/* --- Loading ----------------------------------------------------------------- */

function currentQuantity() {
  const parsed = Number(node.quantity.value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 30;
}

async function load() {
  const quantity = currentQuantity();
  const params = new URLSearchParams();
  params.set('quantity', String(quantity));
  if (node.category.value) params.set('category', node.category.value);
  if (node.search.value.trim()) params.set('q', node.search.value.trim());
  if (node.customizable.checked) params.set('customizable', 'true');

  try {
    render(await api.catalog(params.toString()), quantity);
  } catch (err) {
    showError(node.error, err);
  }
}

/**
 * Rank the catalogue for the brand on screen.
 *
 * The ranking never filters: it annotates. A founder browsing the catalogue is
 * allowed to buy whatever they like, and "Recommended for your brand" is a
 * suggestion with a reason attached, not a gate.
 */
async function loadRecommendations() {
  if (!state.projectId || !state.user) return;
  try {
    const [project, recommendations] = await Promise.all([
      api.project(state.projectId),
      api.recommendations(state.projectId, currentQuantity()),
    ]);

    state.brandName = project.strategy ? project.strategy.name : null;
    recommendations.recommendations.forEach((entry) => {
      state.recommended.set(entry.product.id, entry.reasons[0] || '');
    });

    if (state.brandName) {
      node.banner.textContent = `Browsing for ${state.brandName}. Products we recommend for it are marked.`;
      node.banner.hidden = false;
    }
  } catch (err) {
    // No brand yet, or not this customer's project. The catalogue is still a
    // catalogue; it just does not recommend anything.
  }
}

/* --- Adding ------------------------------------------------------------------ */

async function add(productId, button) {
  hideError(node.error);

  if (!state.user) {
    window.location.href = `login.html?next=${encodeURIComponent('/catalog')}`;
    return;
  }

  if (!state.projectId) {
    // A package belongs to a brand. Rather than inventing an anonymous basket,
    // send them to the one screen that produces a project.
    showError(node.error, new ApiError(400, 'no-project', 'Create your brand first, then add products to it.'));
    return;
  }

  button.disabled = true;
  const original = button.textContent;
  button.textContent = 'Adding…';

  try {
    const result = await api.addItem(state.projectId, {
      productId,
      quantity: currentQuantity(),
    });

    const adjusted = (result.adjustments || []).find((entry) => entry.productId === productId);
    button.textContent = adjusted
      ? `Added ${adjusted.charged} (its minimum)`
      : `Added ${currentQuantity()}`;

    setTimeout(() => {
      button.textContent = original;
      button.disabled = false;
    }, 2500);
  } catch (err) {
    button.textContent = original;
    button.disabled = false;
    showError(node.error, err);
  }
}

/* --- Wiring ------------------------------------------------------------------ */

let debounce = null;
const reload = () => {
  window.clearTimeout(debounce);
  debounce = window.setTimeout(() => void load(), 180);
};

[node.quantity, node.category, node.customizable].forEach((control) =>
  control.addEventListener('change', reload),
);
node.search.addEventListener('input', reload);

document.addEventListener('click', (event) => {
  const button = event.target.closest ? event.target.closest('[data-add]') : null;
  if (button) void add(button.getAttribute('data-add'), button);
});

async function boot() {
  state.user = await mountAccountNav();

  document.querySelectorAll('[data-package-link], .site-nav a[href="package.html"]').forEach((link) => {
    link.setAttribute('href', projectUrl('package.html', state.projectId));
  });

  await loadRecommendations();
  await load();
}

void boot();
