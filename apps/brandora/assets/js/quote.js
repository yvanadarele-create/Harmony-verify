/**
 * The quote, and the one button that turns it into an order.
 *
 * Checkout sends the quote's id and nothing else. There is no amount in the
 * request because there is nowhere to put one: the server reads `quote.total`
 * as stored and charges that. A page that posted a total would be a page an
 * attacker could edit.
 */

import {
  ApiError,
  api,
  clear,
  el,
  hideError,
  mountAccountNav,
  price,
  requireSignIn,
  showError,
} from './api.js';

const node = {
  reference: document.querySelector('[data-quote-reference]'),
  validity: document.querySelector('[data-quote-validity]'),
  lines: document.querySelector('[data-quote-lines] tbody'),
  totals: document.querySelector('[data-quote-totals] tbody'),
  delivery: document.querySelector('[data-delivery-note]'),
  checkout: document.querySelector('[data-checkout]'),
  error: document.querySelector('[data-error]'),
};

const quoteId = new URLSearchParams(window.location.search).get('id');

function render(quote) {
  node.reference.textContent = `Quote ${quote.reference}`;
  document.title = `Quote ${quote.reference} — Brandora`;

  const until = new Date(quote.validUntil);
  node.validity.textContent = `Held until ${until.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })}. Freight and supplier prices move, so a quote does not hold forever.`;

  clear(node.lines);
  quote.lines.forEach((line) => {
    node.lines.appendChild(
      el('tr', {}, [
        el('th', { scope: 'row', text: line.description }),
        el('td', { text: String(line.quantity) }),
        el('td', { text: price(line.total) }),
      ]),
    );
  });

  clear(node.totals);
  [
    ['Products and branding', quote.subtotal],
    ['Delivery', quote.shipping],
    ['Handling and service', quote.fees],
  ].forEach(([label, amount]) => {
    node.totals.appendChild(
      el('tr', {}, [el('th', { scope: 'row', text: label }), el('td', { text: price(amount) })]),
    );
  });
  node.totals.appendChild(
    el('tr', {}, [el('th', { scope: 'row', text: 'Total' }), el('td', { text: price(quote.total) })]),
  );

  // §38: the absence of a date is stated, not filled in with a plausible one.
  node.delivery.textContent =
    quote.deliveryEstimate ||
    'Delivery estimate unavailable until your order is confirmed with the supplier.';

  document.querySelectorAll('[data-package-link]').forEach((link) => {
    link.setAttribute('href', `package.html?project=${encodeURIComponent(quote.projectId)}`);
  });
}

async function load() {
  if (!quoteId) {
    showError(node.error, new ApiError(400, 'no-quote', 'No quote was named in this link.'));
    node.checkout.hidden = true;
    return;
  }
  try {
    render((await api.quote(quoteId)).quote);
  } catch (err) {
    if (err instanceof ApiError && err.isUnauthenticated) return requireSignIn();
    node.checkout.hidden = true;
    showError(node.error, err);
  }
}

node.checkout.addEventListener('click', async () => {
  hideError(node.error);
  node.checkout.disabled = true;
  node.checkout.setAttribute('aria-busy', 'true');
  try {
    const payload = await api.checkout(quoteId);
    window.location.href = `order.html?id=${encodeURIComponent(payload.order.id)}`;
  } catch (err) {
    node.checkout.disabled = false;
    node.checkout.removeAttribute('aria-busy');
    if (err instanceof ApiError && err.isUnauthenticated) return requireSignIn();
    showError(node.error, err);
  }
});

void mountAccountNav().then((user) => {
  if (!user) return requireSignIn();
  return load();
});
