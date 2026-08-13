/**
 * The order.
 *
 * Payment status is never decided here. The page asks the server to verify with
 * the provider, and the server compares what the provider reports against what
 * it recorded when the charge was created. A browser saying "I paid" changes
 * nothing — which is the point.
 */

import {
  ApiError,
  api,
  clear,
  el,
  mountAccountNav,
  price,
  requireSignIn,
  showError,
} from './api.js';

const node = {
  reference: document.querySelector('[data-order-reference]'),
  summary: document.querySelector('[data-order-summary]'),
  lines: document.querySelector('[data-order-lines] tbody'),
  events: document.querySelector('[data-order-events]'),
  instruction: document.querySelector('[data-payment-instruction]'),
  payLink: document.querySelector('[data-pay-link]'),
  refresh: document.querySelector('[data-refresh]'),
  error: document.querySelector('[data-error]'),
};

const params = new URLSearchParams(window.location.search);
const orderId = params.get('id');
const orderRef = params.get('ref');

const PAYMENT_WORDS = {
  unpaid: 'Not yet paid',
  pending: 'Awaiting payment',
  paid: 'Paid',
  failed: 'Payment failed',
  refunded: 'Refunded',
};

const FULFILMENT_WORDS = {
  pending: 'Waiting to be confirmed',
  confirmed: 'Confirmed',
  sourcing: 'Sourcing your products',
  processing: 'In production',
  shipped: 'On its way',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

function define(term, value) {
  return [el('dt', { text: term }), el('dd', { text: value })];
}

function render(payload) {
  const order = payload.order;

  node.reference.textContent = `Order ${order.reference}`;
  document.title = `Order ${order.reference} — Brandora`;

  clear(node.summary);
  [
    ...define('Placed', new Date(order.createdAt).toLocaleDateString(undefined, {
      day: 'numeric', month: 'long', year: 'numeric',
    })),
    ...define('Total', price(order.total)),
    ...define('Payment', PAYMENT_WORDS[order.paymentStatus] || order.paymentStatus),
    ...define('Status', FULFILMENT_WORDS[order.fulfillmentStatus] || order.fulfillmentStatus),
    ...define(
      'Tracking',
      // §38 once more: an order with no tracking number says so.
      order.trackingNumber ? `${order.trackingNumber} (${order.carrier || 'carrier'})` : 'Not shipped yet',
    ),
  ].forEach((child) => node.summary.appendChild(child));

  clear(node.lines);
  const quote = payload.quote;
  if (quote) {
    quote.lines.forEach((line) => {
      node.lines.appendChild(
        el('tr', {}, [
          el('th', { scope: 'row', text: line.description }),
          el('td', { text: String(line.quantity) }),
          el('td', { text: price(line.total) }),
        ]),
      );
    });
  }

  clear(node.events);
  (payload.events || []).forEach((event) => {
    node.events.appendChild(
      el('li', { class: 'timeline__item' }, [
        el('span', { class: 'timeline__when', text: new Date(event.at).toLocaleString() }),
        el('span', { class: 'timeline__what', text: event.detail ? `${event.kind} — ${event.detail}` : event.kind }),
      ]),
    );
  });

  const settled = order.paymentStatus === 'paid';
  node.refresh.hidden = settled;

  const attempt = (payload.payments || [])[0];
  if (!settled && attempt) {
    node.instruction.textContent =
      attempt.status === 'initialised'
        ? 'Your order is placed. Complete the payment to start production.'
        : 'Our team will contact you to arrange payment and confirm it before production starts.';
    node.instruction.hidden = false;
  } else {
    node.instruction.hidden = true;
  }
}

async function resolveId() {
  if (orderId) return orderId;
  if (!orderRef) return null;
  // A payment provider sends the customer back with our reference, not our id.
  const list = await api.get('/api/orders');
  const found = list.orders.find((order) => order.reference === orderRef);
  return found ? found.id : null;
}

async function load(verifyFirst) {
  try {
    const id = await resolveId();
    if (!id) {
      showError(node.error, new ApiError(404, 'not-found', 'We could not find that order.'));
      return;
    }
    if (verifyFirst) {
      try {
        await api.verifyPayment(id);
      } catch (err) {
        // A refused verification — a mismatched amount, most importantly — must
        // not hide the order. Show the order, and the message with it.
        showError(node.error, err);
      }
    }
    render(await api.order(id));
  } catch (err) {
    if (err instanceof ApiError && err.isUnauthenticated) return requireSignIn();
    showError(node.error, err);
  }
}

node.refresh.addEventListener('click', () => {
  node.refresh.disabled = true;
  void load(true).finally(() => {
    node.refresh.disabled = false;
  });
});

void mountAccountNav().then((user) => {
  if (!user) return requireSignIn();
  // Arriving with `?ref=` means the customer has just come back from the
  // payment provider, so verify immediately rather than making them press a
  // button they did not know they had to press.
  return load(Boolean(orderRef));
});
