/**
 * Sign in and sign up.
 *
 * Both forms do the same three things: post, follow the `next` parameter home,
 * and show the server's sentence when it refuses. No validation logic is
 * duplicated from the server — the browser's `required` and `minlength` are
 * there to catch a mistake before a round trip, not to be the rule.
 */

import { api, mountAccountNav, safeNext, showError, hideError } from './api.js';

const errorNode = document.querySelector('[data-error]');
const nextParam = safeNext(new URLSearchParams(window.location.search).get('next'));

// Carry the return path across the login/signup switch, so someone who bounces
// to "create an account" still lands where they were going.
if (nextParam) {
  document.querySelectorAll('[data-signup-link], [data-login-link]').forEach((link) => {
    link.setAttribute('href', `${link.getAttribute('href')}?next=${encodeURIComponent(nextParam)}`);
  });
}

function goHome() {
  window.location.href = nextParam || 'dashboard.html';
}

function busy(form, isBusy) {
  const button = form.querySelector('[data-submit]');
  if (!button) return;
  button.disabled = isBusy;
  button.setAttribute('aria-busy', isBusy ? 'true' : 'false');
}

function bind(form, submit) {
  if (!form) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    hideError(errorNode);
    busy(form, true);
    try {
      await submit(Object.fromEntries(new FormData(form).entries()));
      goHome();
    } catch (err) {
      showError(errorNode, err);
      // Focus the message rather than the field: the server does not say which
      // field was wrong on a login, and guessing would be worse than useless.
      errorNode.setAttribute('tabindex', '-1');
      errorNode.focus();
    } finally {
      busy(form, false);
    }
  });
}

bind(document.querySelector('[data-login-form]'), (values) =>
  api.login({ email: values.email, password: values.password }),
);

bind(document.querySelector('[data-signup-form]'), (values) =>
  api.signup({
    email: values.email,
    name: values.name,
    password: values.password,
    country: values.country || undefined,
    locale: document.documentElement.getAttribute('lang') || 'en',
  }),
);

// Someone already signed in has no business on a login page. The probe answers
// for signed-out visitors as well, so the *user* is the test — not the absence
// of an error, which would send everyone straight back into a redirect loop.
void mountAccountNav().then((user) => {
  if (user) goHome();
});
