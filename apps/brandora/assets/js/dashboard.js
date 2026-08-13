/**
 * The customer dashboard.
 *
 * One call, one picture: brands, quotes and orders, all from the server, all
 * scoped to the session. There is nothing here a browser could have remembered
 * — sign in on a different phone and this is identical.
 */

import {
  ApiError,
  api,
  clear,
  el,
  mountAccountNav,
  price,
  projectUrl,
  rememberProject,
  requireSignIn,
  showError,
} from './api.js';

const node = {
  lede: document.querySelector('[data-dashboard-lede]'),
  projects: document.querySelector('[data-projects]'),
  quotes: document.querySelector('[data-quotes] tbody'),
  orders: document.querySelector('[data-orders] tbody'),
  error: document.querySelector('[data-error]'),
};

/** Where "Resume" goes. The server decided; this only draws it. */
const NEXT_STEP = {
  interview: { label: 'Finish the interview', page: 'create.html' },
  generate: { label: 'Build your brand', page: 'create.html' },
  products: { label: 'Choose your products', page: 'catalog.html' },
  quote: { label: 'Review your package', page: 'package.html' },
};

const STATUS_WORDS = {
  draft: 'Started',
  interviewing: 'Interview answered',
  generated: 'Brand ready',
  active: 'In progress',
  archived: 'Archived',
};

function projectCard(project) {
  const step = NEXT_STEP[project.nextStep] || NEXT_STEP.products;
  const palette = project.palette || [];

  return el('article', { class: 'card' }, [
    el(
      'ul',
      { class: 'swatches swatches--tight' },
      palette.slice(0, 5).map((swatch) =>
        el('li', { class: 'swatch swatch--mini' }, [
          el('div', { class: 'swatch__chip', style: `background:${swatch.hex}`, 'aria-hidden': 'true' }),
        ]),
      ),
    ),
    el('h3', { style: 'margin-bottom:0.25rem', text: project.name }),
    el('p', { class: 'product__meta', text: project.slogan || STATUS_WORDS[project.status] || project.status }),
    el('p', { class: 'product__meta', text: `${project.packageItems} product${project.packageItems === 1 ? '' : 's'} in the package` }),
    el('div', { class: 'hero__actions' }, [
      el('a', {
        class: 'btn btn--primary btn--small',
        href: projectUrl(step.page, project.id),
        text: step.label,
        onclick: () => rememberProject(project.id),
      }),
      project.status === 'generated' || project.status === 'active'
        ? el('a', {
            class: 'btn btn--ghost btn--small',
            href: projectUrl('brand.html', project.id),
            text: 'Brand book',
          })
        : null,
    ]),
  ]);
}

function render(payload) {
  node.lede.textContent = `${payload.counts.projects} brand${
    payload.counts.projects === 1 ? '' : 's'
  }, ${payload.counts.quotes} quote${payload.counts.quotes === 1 ? '' : 's'}, ${payload.counts.orders} order${
    payload.counts.orders === 1 ? '' : 's'
  }.`;

  clear(node.projects);
  if (payload.projects.length === 0) {
    node.projects.appendChild(
      el('div', { class: 'card card--flat' }, [
        el('h3', { text: 'No brands yet' }),
        el('p', { text: 'The interview takes a few minutes and you can change everything afterwards.' }),
        el('a', { class: 'btn btn--primary btn--small', href: 'create.html', text: 'Create my brand' }),
      ]),
    );
  } else {
    payload.projects.forEach((project) => node.projects.appendChild(projectCard(project)));
  }

  clear(node.quotes);
  payload.quotes.forEach((quote) => {
    node.quotes.appendChild(
      el('tr', {}, [
        el('th', { scope: 'row' }, [
          el('a', { href: `quote.html?id=${encodeURIComponent(quote.id)}`, text: quote.reference }),
        ]),
        el('td', { text: quote.status }),
        el('td', { text: price(quote.total) }),
      ]),
    );
  });
  if (payload.quotes.length === 0) {
    node.quotes.appendChild(
      el('tr', {}, [el('td', { colspan: '3', class: 'product__meta', text: 'No quotes yet.' })]),
    );
  }

  clear(node.orders);
  payload.orders.forEach((order) => {
    node.orders.appendChild(
      el('tr', {}, [
        el('th', { scope: 'row' }, [
          el('a', { href: `order.html?id=${encodeURIComponent(order.id)}`, text: order.reference }),
        ]),
        el('td', { text: order.paymentStatus }),
        el('td', { text: order.fulfillmentStatus }),
        el('td', { text: price(order.total) }),
      ]),
    );
  });
  if (payload.orders.length === 0) {
    node.orders.appendChild(
      el('tr', {}, [el('td', { colspan: '4', class: 'product__meta', text: 'No orders yet.' })]),
    );
  }
}

async function load() {
  try {
    render(await api.dashboard());
  } catch (err) {
    if (err instanceof ApiError && err.isUnauthenticated) return requireSignIn();
    showError(node.error, err);
  }
}

void mountAccountNav().then((user) => {
  if (!user) return requireSignIn();
  return load();
});
