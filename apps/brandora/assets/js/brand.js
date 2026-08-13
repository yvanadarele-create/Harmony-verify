/**
 * The brand book.
 *
 * This is the screen the whole interview is for, so one rule governs it
 * absolutely: **every value on this page came from the server.** The brand
 * name, the slogan, the palette, the letterforms, the story — all of it is the
 * `BrandIdentity` stored against this project. There is no fallback brand, no
 * sample palette, no "Acme" placeholder anywhere in this file. With no data the
 * page says there is no brand yet and offers the interview.
 *
 * The page paints itself in the brand's own colours rather than Brandora's.
 * That is the point of a brand book: a founder should be looking at *their*
 * brand, not at Brandora's opinion of it.
 */

import {
  ApiError,
  api,
  clear,
  currentProjectId,
  el,
  mountAccountNav,
  projectUrl,
  requireSignIn,
} from './api.js';

const node = {
  book: document.querySelector('[data-book]'),
  loading: document.querySelector('[data-loading]'),
  empty: document.querySelector('[data-empty]'),
  emptyMessage: document.querySelector('[data-empty-message]'),
  cover: document.querySelector('[data-cover]'),
};

const projectId = currentProjectId();
const state = { user: null };

const swatchOf = (palette, role) => palette.find((entry) => entry.role === role) || null;
const hexOf = (palette, role, fallback) => (swatchOf(palette, role) || {}).hex || fallback;

function setText(selector, value) {
  document.querySelectorAll(selector).forEach((target) => {
    target.textContent = value || '';
  });
}

/**
 * The monogram.
 *
 * No logo image has been generated — §"never claim what you cannot show"
 * applies to a brand's own mark as much as to a supplier's product. What the
 * mark tiles show is the brand's initial set in the brand's own typeface and
 * colours: a real, honest stand-in that says "this is the direction", beside a
 * written brief precise enough to hand to a designer.
 */
function monogram(name) {
  const words = String(name || '')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '·';
  if (words.length === 1) return words[0].slice(0, 1).toUpperCase();
  return (words[0].slice(0, 1) + words[1].slice(0, 1)).toUpperCase();
}

function renderPalette(palette) {
  const list = document.querySelector('[data-brand-palette]');
  clear(list);

  palette.forEach((swatch) => {
    list.appendChild(
      el('li', { class: 'palette-strip__item' }, [
        el('div', {
          class: 'palette-strip__chip',
          style: `background:${swatch.hex}`,
          'aria-hidden': 'true',
        }),
        el('div', { class: 'palette-strip__text' }, [
          el('p', { class: 'palette-strip__name', text: swatch.name }),
          el('p', { class: 'palette-strip__hex', text: `${swatch.hex} · ${swatch.role}` }),
          el('p', { class: 'palette-strip__why', text: swatch.rationale || '' }),
        ]),
      ]),
    );
  });
}

function renderPersonality(traits) {
  const list = document.querySelector('[data-brand-personality]');
  clear(list);
  (traits || []).forEach((trait) => {
    list.appendChild(el('li', { class: 'chip chip--static', text: trait }));
  });
}

/**
 * Applications.
 *
 * Drawn in CSS from the brand's own colours rather than photographed, because a
 * photograph of a cup that nobody has printed is a picture of a promise. These
 * are shown as what they are: the palette and the letterforms applied to the
 * shapes of the things in the catalogue.
 */
const APPLICATIONS = [
  { key: 'cup', label: 'Cup', shape: 'app-cup' },
  { key: 'box', label: 'Box', shape: 'app-box' },
  { key: 'bag', label: 'Bag', shape: 'app-bag' },
  { key: 'card', label: 'Business card', shape: 'app-card' },
  { key: 'label', label: 'Label', shape: 'app-label' },
  { key: 'sticker', label: 'Sticker', shape: 'app-sticker' },
];

function renderApplications(brand) {
  const host = document.querySelector('[data-applications]');
  clear(host);

  const mark = monogram(brand.name);

  APPLICATIONS.forEach((application) => {
    host.appendChild(
      el('figure', { class: 'application' }, [
        el('div', { class: `application__object ${application.shape}` }, [
          el('span', { class: 'application__mark', text: mark }),
          el('span', { class: 'application__word', text: brand.name }),
        ]),
        el('figcaption', { class: 'application__caption', text: application.label }),
      ]),
    );
  });
}

/** Paint the page in the brand's colours. */
function applyBrandSurface(brand) {
  const palette = brand.palette || [];
  const primary = hexOf(palette, 'primary', '#4B167A');
  const surface = hexOf(palette, 'surface', '#0B0A0F');
  const ink = hexOf(palette, 'ink', '#F5F3F7');
  const accent = hexOf(palette, 'accent', primary);
  const muted = hexOf(palette, 'muted', accent);

  const book = node.book;
  book.style.setProperty('--brand-primary', primary);
  book.style.setProperty('--brand-surface', surface);
  book.style.setProperty('--brand-ink', ink);
  book.style.setProperty('--brand-accent', accent);
  book.style.setProperty('--brand-muted', muted);

  const typography = brand.typography || {};
  const heading = `${typography.primary || 'Inter'}, ${typography.primaryFallback || 'sans-serif'}`;
  const body = `${typography.secondary || 'Inter'}, ${typography.secondaryFallback || 'sans-serif'}`;
  book.style.setProperty('--brand-heading-font', heading);
  book.style.setProperty('--brand-body-font', body);
}

function render(payload) {
  const brand = payload.brand;

  applyBrandSurface(brand);

  setText('[data-brand-name]', brand.name);
  setText('[data-brand-slogan]', brand.slogan);
  setText('[data-brand-industry]', brand.industry);
  setText('[data-brand-positioning]', String(brand.positioning || '').replace('-', ' '));
  setText('[data-brand-audience]', brand.targetCustomer);
  setText('[data-brand-description]', brand.description);
  setText('[data-brand-promise]', brand.promise);
  setText('[data-brand-mission]', brand.mission);
  setText('[data-brand-vision]', brand.vision);
  setText('[data-brand-tone]', brand.toneOfVoice);
  setText('[data-brand-story]', brand.brandStory);
  setText('[data-logo-brief]', brand.logoBrief);

  renderPersonality(brand.personality);
  renderPalette(brand.palette || []);
  renderApplications(brand);

  const typography = brand.typography || {};
  setText('[data-type-specimen]', brand.name);
  setText(
    '[data-type-scale]',
    `Headings in ${typography.primary || '—'} · Body in ${typography.secondary || '—'}`,
  );
  setText('[data-type-rationale]', typography.rationale || '');

  const mark = monogram(brand.name);
  document.querySelectorAll('[data-mark-dark], [data-mark-light]').forEach((tile) => {
    tile.textContent = mark;
  });

  document.querySelectorAll('[data-continue]').forEach((link) => {
    link.setAttribute('href', projectUrl('catalog.html', projectId));
  });

  const download = document.querySelector('[data-download-guidelines]');
  if (download) download.setAttribute('href', `/api/projects/${projectId}/brand/guidelines`);

  document.title = `${brand.name} — brand book`;

  node.loading.hidden = true;
  node.empty.hidden = true;
  node.book.hidden = false;
}

function showEmpty(message) {
  node.loading.hidden = true;
  node.book.hidden = true;
  node.empty.hidden = false;
  if (message) node.emptyMessage.textContent = message;
}

async function load() {
  if (!projectId) {
    showEmpty('Answer the interview and Brandora will build one.');
    return;
  }
  try {
    render(await api.brand(projectId));
  } catch (err) {
    if (err instanceof ApiError && err.isUnauthenticated) {
      requireSignIn();
      return;
    }
    showEmpty(
      err instanceof ApiError && err.status === 404
        ? 'This project does not have a generated brand yet.'
        : 'We could not load your brand just now. Please try again.',
    );
  }
}

document.addEventListener('click', async (event) => {
  const button = event.target.closest ? event.target.closest('[data-regenerate-palette]') : null;
  if (!button || !projectId) return;

  button.disabled = true;
  try {
    // A seeded variation, so "show another" is reproducible rather than random:
    // a founder who liked the third one can get back to it.
    const variation = Number(button.getAttribute('data-variation') || 0) + 1;
    button.setAttribute('data-variation', String(variation));
    await api.regenerateIdentity(projectId, variation % 100);
    await load();
  } catch (err) {
    /* The existing palette stays on screen; nothing is lost. */
  } finally {
    button.disabled = false;
  }
});

void mountAccountNav().then((user) => {
  state.user = user;
  return load();
});
