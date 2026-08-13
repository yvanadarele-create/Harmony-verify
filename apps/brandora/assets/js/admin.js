/**
 * The admin dashboard.
 *
 * Every route this page calls is behind `requireAdmin` on the server. Hiding
 * the link for a customer is a courtesy, not a control: a customer who types
 * the URL gets this page and then six 403s, which is exactly right.
 *
 * The integrations panel shows masks. There is no request this page could make
 * that would return a credential, because the server has no route that returns
 * one.
 */

import { ApiError, api, clear, el, mountAccountNav, price, requireSignIn, showError } from './api.js';

const node = {
  counts: document.querySelector('[data-admin-counts]'),
  integrations: document.querySelector('[data-admin-integrations]'),
  orders: document.querySelector('[data-admin-orders] tbody'),
  quotes: document.querySelector('[data-admin-quotes] tbody'),
  customers: document.querySelector('[data-admin-customers] tbody'),
  error: document.querySelector('[data-error]'),
};

const FULFILMENT_STEPS = [
  'confirmed',
  'sourcing',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
];

function countCard(label, value) {
  return el('div', { class: 'card card--flat' }, [
    el('p', { class: 'stat__value', text: String(value) }),
    el('p', { class: 'product__meta', text: label }),
  ]);
}

function renderOverview(payload) {
  clear(node.counts);
  [
    ['Customers', payload.counts.customers],
    ['Brands', payload.counts.projects],
    ['Orders', payload.counts.orders],
    ['Awaiting fulfilment', payload.counts.awaitingFulfilment],
  ].forEach(([label, value]) => node.counts.appendChild(countCard(label, value)));

  node.counts.appendChild(
    el('div', { class: 'card card--flat' }, [
      el('p', { class: 'stat__value', text: price(payload.revenue) }),
      el('p', { class: 'product__meta', text: 'Paid revenue' }),
    ]),
  );

  clear(node.integrations);
  payload.integrations.forEach((integration) => {
    node.integrations.appendChild(
      el('div', { class: 'card' }, [
        el('h3', { style: 'font-size:1.05rem', text: integration.name }),
        el('p', {
          class: `tag ${integration.connected ? 'tag--ok' : 'tag--unconfirmed'}`,
          text: integration.connected ? 'Connected' : 'Not configured',
        }),
        el(
          'dl',
          { class: 'book-defs book-defs--tight' },
          integration.fields.flatMap((field) => [
            el('dt', { text: field.label }),
            el('dd', { class: 'masked', text: field.masked }),
          ]),
        ),
        el('p', {
          class: 'product__meta',
          text: 'Set in the deployment environment. Brandora can show that a key is installed; it can never show the key.',
        }),
      ]),
    );
  });
}

function renderOrders(orders) {
  clear(node.orders);
  orders.forEach((order) => {
    const select = el(
      'select',
      { class: 'control', 'data-fulfilment-for': order.id, 'aria-label': `Fulfilment for ${order.reference}` },
      [el('option', { value: '', text: 'Move to…' })].concat(
        FULFILMENT_STEPS.map((step) => el('option', { value: step, text: step })),
      ),
    );

    node.orders.appendChild(
      el('tr', {}, [
        el('th', { scope: 'row', text: order.reference }),
        el('td', { text: order.ownerEmail || '—' }),
        el('td', {}, [
          el('span', { text: order.paymentStatus }),
          order.paymentStatus !== 'paid'
            ? el('button', {
                class: 'btn btn--quiet btn--small',
                type: 'button',
                'data-mark-paid': order.id,
                // §45: money only moves on a human decision, recorded with an id.
                text: 'Mark received',
              })
            : null,
        ]),
        el('td', { text: order.fulfillmentStatus }),
        el('td', { text: price(order.total) }),
        el('td', {}, [select]),
      ]),
    );
  });
}

function renderQuotes(quotes) {
  clear(node.quotes);
  quotes.forEach((quote) => {
    node.quotes.appendChild(
      el('tr', {}, [
        el('th', { scope: 'row', text: quote.reference }),
        el('td', { text: quote.ownerEmail || '—' }),
        el('td', { text: price(quote.total) }),
        el('td', { text: price(quote.margin) }),
        el('td', { text: quote.status }),
      ]),
    );
  });
}

function renderCustomers(customers) {
  clear(node.customers);
  customers.forEach((customer) => {
    node.customers.appendChild(
      el('tr', {}, [
        el('th', { scope: 'row', text: customer.name }),
        el('td', { text: customer.email }),
        el('td', { text: String(customer.projects) }),
        el('td', { text: String(customer.orders) }),
      ]),
    );
  });
}

async function load() {
  try {
    const [overview, orders, quotes, customers] = await Promise.all([
      api.get('/api/admin/overview'),
      api.get('/api/admin/orders'),
      api.get('/api/admin/quotes'),
      api.get('/api/admin/customers'),
    ]);
    renderOverview(overview);
    renderOrders(orders.orders);
    renderQuotes(quotes.quotes);
    renderCustomers(customers.customers);
  } catch (err) {
    if (err instanceof ApiError && err.isUnauthenticated) return requireSignIn();
    showError(node.error, err);
  }
}

document.addEventListener('click', async (event) => {
  const button = event.target.closest ? event.target.closest('[data-mark-paid]') : null;
  if (!button) return;
  button.disabled = true;
  try {
    await api.patch(`/api/admin/orders/${button.getAttribute('data-mark-paid')}`, {
      paymentStatus: 'paid',
    });
    await load();
  } catch (err) {
    button.disabled = false;
    showError(node.error, err);
  }
});

document.addEventListener('change', async (event) => {
  const select = event.target.closest ? event.target.closest('[data-fulfilment-for]') : null;
  if (!select || !select.value) return;
  try {
    await api.patch(`/api/admin/orders/${select.getAttribute('data-fulfilment-for')}`, {
      fulfillmentStatus: select.value,
    });
    await load();
  } catch (err) {
    showError(node.error, err);
  }
});

void mountAccountNav().then((user) => {
  if (!user) return requireSignIn();
  return load();
});
