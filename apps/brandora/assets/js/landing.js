/**
 * The landing page's only script beyond the shell: reflect the signed-in state.
 *
 * A returning founder should not be invited to "Create My Brand" as though they
 * had none. The copy changes; the page does not otherwise become a different
 * page, because the landing page still has to sell to the person standing
 * behind them.
 */

import { api, mountAccountNav } from './api.js';

async function boot() {
  const user = await mountAccountNav();
  if (!user) return;

  try {
    const { projects } = await api.projects();
    if (projects.length === 0) return;

    const latest = projects[0];
    document.querySelectorAll('[data-i18n="hero.cta.primary"]').forEach((cta) => {
      if (cta.tagName !== 'A') return;
      cta.removeAttribute('data-i18n');
      cta.textContent = `Continue ${latest.brandName || latest.name}`;
      cta.setAttribute('href', `dashboard.html`);
    });
  } catch (err) {
    // The landing page is the last thing that should break over this.
  }
}

void boot();
