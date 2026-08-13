/**
 * The brand interview (§13–§19).
 *
 * One question at a time, with a way out of every one of them.
 *
 * What lives where matters here. The **answers** are application data and end
 * up in the database, on a project that belongs to an account. The half-filled
 * form does not: while someone is still typing, the answers sit in
 * `sessionStorage`, exactly as a browser preserves a partly-completed form. The
 * moment there is an account, they are written to the server and that copy is
 * the truth. Nothing on this page is the only copy of anything.
 *
 * The palette preview is derived by `./generated/identity.js` — the compiled
 * brand engine, the same modules the server runs — so the colours shown at the
 * end of the interview are the colours the server saves. It is a preview
 * because it is early, not because it is approximate.
 *
 * The written strategy is not previewed. The name, promise and story come from
 * the model, through the server, and this page shows nothing in their place.
 */

import { derivePalette, deriveTypography } from './generated/identity.js';
import {
  ApiError,
  api,
  currentProjectId,
  mountAccountNav,
  projectUrl,
  rememberProject,
} from './api.js';

const DRAFT_KEY = 'brandora.interview.draft';

const state = {
  questions: [],
  index: 0,
  answers: {},
  inferred: {},
  helpOpen: false,
  user: null,
  projectId: currentProjectId(),
  generating: false,
};

const el = {
  progress: document.querySelector('[data-progress]'),
  question: document.querySelector('[data-question]'),
  result: document.querySelector('[data-result]'),
};

/* --- The in-progress form --------------------------------------------------- */

function saveDraft() {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ answers: state.answers, inferred: state.inferred }));
  } catch (err) {
    // Storage unavailable. The interview still works within this page view.
  }
}

function restoreDraft() {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    state.answers = parsed.answers || {};
    state.inferred = parsed.inferred || {};
  } catch (err) {
    state.answers = {};
  }
}

function clearDraft() {
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch (err) {
    /* nothing to do */
  }
}

/** The wire shape the API expects. */
function answerList() {
  return Object.keys(state.answers)
    .filter((field) => {
      const value = state.answers[field];
      return Array.isArray(value) ? value.length > 0 : String(value ?? '').trim() !== '';
    })
    .map((field) => ({
      field,
      value: state.answers[field],
      inferred: state.inferred[field] === true,
    }));
}

/**
 * Persist to the project, quietly.
 *
 * Called after every answer once there is somewhere to put it. A failure here
 * is not worth interrupting someone mid-interview over — the draft is still in
 * the page, and the save that matters is the one before generation, which is
 * awaited and does surface its errors.
 */
async function syncAnswers() {
  if (!state.projectId) return;
  try {
    await api.saveInterview(state.projectId, answerList());
  } catch (err) {
    /* The draft still holds it; the pre-generation save will report properly. */
  }
}

/* --- Rendering --------------------------------------------------------------- */

function t(key, fallback, vars) {
  const translated = window.brandoraTranslate ? window.brandoraTranslate(key, vars) : null;
  return translated === null || translated === undefined ? fallback : translated;
}

function escapeHtml(value) {
  return String(value === undefined || value === null ? '' : value).replace(/[&<>"']/g, (char) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
}

function renderProgress() {
  el.progress.innerHTML = '';
  state.questions.forEach((question, i) => {
    const seg = document.createElement('div');
    seg.className = 'progress__seg';
    seg.setAttribute('data-done', String(i <= state.index));
    el.progress.appendChild(seg);
  });
  el.progress.setAttribute(
    'aria-label',
    `Question ${state.index + 1} of ${state.questions.length}`,
  );
}

function renderQuestion() {
  const question = state.questions[state.index];
  if (!question) return renderResult();

  renderProgress();

  const answer = state.answers[question.field];
  const parts = [];

  parts.push(`<p class="eyebrow">${state.index + 1} / ${state.questions.length}</p>`);
  parts.push(`<h2>${escapeHtml(question.prompt)}</h2>`);
  parts.push(`<p class="field__why">${escapeHtml(question.because)}</p>`);

  if (state.helpOpen) {
    parts.push('<div class="help-note">');
    parts.push(`<p>${escapeHtml(question.helpPrompt)}</p>`);
    if (question.examples && question.examples.length) {
      parts.push('<ul>');
      question.examples.forEach((example) => parts.push(`<li>${escapeHtml(example)}</li>`));
      parts.push('</ul>');
    }
    parts.push('</div>');
  }

  if (question.kind === 'text') {
    const value = typeof answer === 'string' ? answer : '';
    parts.push('<div class="field">');
    parts.push(`<label for="answer">${escapeHtml(question.prompt)}</label>`);
    parts.push(`<textarea id="answer" data-input>${escapeHtml(value)}</textarea>`);
    parts.push('</div>');
  } else if (question.kind === 'choice') {
    parts.push(`<div class="field" role="group" aria-label="${escapeHtml(question.prompt)}">`);
    question.options.forEach((option) => {
      parts.push(
        `<button type="button" class="option" data-choice="${escapeHtml(option.value)}" aria-pressed="${
          answer === option.value ? 'true' : 'false'
        }"><strong>${escapeHtml(option.label)}</strong><span class="option__hint">${escapeHtml(
          option.hint,
        )}</span></button>`,
      );
    });
    parts.push('</div>');
  } else {
    const selected = Array.isArray(answer) ? answer : [];
    parts.push(`<div class="field chips" role="group" aria-label="${escapeHtml(question.prompt)}">`);
    question.options.forEach((option) => {
      parts.push(
        `<button type="button" class="chip" data-multi="${escapeHtml(option.value)}" aria-pressed="${
          selected.indexOf(option.value) !== -1 ? 'true' : 'false'
        }">${escapeHtml(option.label)}</button>`,
      );
    });
    parts.push('</div>');
  }

  parts.push('<div class="hero__actions" style="margin-top:1rem">');
  if (state.index > 0) {
    parts.push(`<button type="button" class="btn btn--ghost" data-back>${t('builder.back', 'Back')}</button>`);
  }
  parts.push(`<button type="button" class="btn btn--primary" data-next>${t('builder.next', 'Continue')}</button>`);
  parts.push(
    `<button type="button" class="btn btn--quiet" data-help>${t('builder.dontknow', "I don't know — help me")}</button>`,
  );
  parts.push('</div>');

  el.question.innerHTML = parts.join('');
  el.result.hidden = true;
  el.question.hidden = false;

  const input = el.question.querySelector('[data-input]');
  if (input) input.focus();
}

/**
 * Where the interview should open.
 *
 * The first question without an answer — not question one. Someone who filled
 * this in yesterday and came back today should not be walked through seven
 * questions they have already answered to reach the button they came for.
 */
function firstUnanswered() {
  for (let i = 0; i < state.questions.length; i += 1) {
    const question = state.questions[i];
    const answer = state.answers[question.field];
    const empty =
      answer === undefined ||
      (typeof answer === 'string' && answer.trim() === '') ||
      (Array.isArray(answer) && answer.length === 0);
    if (question.required && empty) return i;
  }
  return state.questions.length;
}

/** The brief shape the compiled engine expects. */
function toBrief() {
  const answers = state.answers;
  return {
    business: answers.business || '',
    product: answers.product || '',
    audience: answers.audience || '',
    positioning: answers.positioning || 'accessible-premium',
    personality: Array.isArray(answers.personality) ? answers.personality : [],
    differentiation: answers.differentiation || '',
    style: answers.style || '',
    inferredFields: Object.keys(state.inferred).filter((f) => state.inferred[f]),
    locale: document.documentElement.getAttribute('lang') || 'en',
  };
}

function renderResult() {
  renderProgress();

  const brief = toBrief();
  const palette = derivePalette(brief, { variation: 0 });
  const typography = deriveTypography(brief);

  const swatches = palette
    .map(
      (swatch) =>
        `<li class="swatch"><div class="swatch__chip" style="background:${swatch.hex}"></div>` +
        `<div class="swatch__name">${escapeHtml(swatch.name)}</div>` +
        `<div class="swatch__hex">${swatch.hex}</div></li>`,
    )
    .join('');

  el.result.innerHTML =
    `<p class="eyebrow">${t('builder.step.review', 'Ready')}</p>` +
    '<h2>That is everything we need.</h2>' +
    `<p class="lede">${escapeHtml(brief.product)} &middot; ${escapeHtml(
      String(brief.positioning).replace('-', ' '),
    )}, for ${escapeHtml(brief.audience)}.</p>` +
    '<div class="card" style="margin-top:1.5rem">' +
    '<h3>Your colours, from your answers</h3>' +
    `<ul class="swatches">${swatches}</ul>` +
    `<p class="product__meta">Headings in ${escapeHtml(typography.primary)}. Every palette is checked for contrast before you see it, so your text stays readable on a phone in daylight.</p>` +
    '</div>' +
    '<div class="card" style="margin-top:1rem">' +
    '<h3>What happens next</h3>' +
    '<p>Brandora writes your brand name, promise, mission, tone of voice and story from these answers, then saves the whole identity to your account.</p>' +
    '<p class="product__meta">This takes a few seconds and is generated fresh for your business — nothing here is a template.</p>' +
    '</div>' +
    '<p class="notice" data-error hidden role="alert"></p>' +
    '<div class="hero__actions">' +
    `<button type="button" class="btn btn--primary" data-generate>${t('builder.generate', 'Build my brand')}</button>` +
    `<button type="button" class="btn btn--ghost" data-back-to-questions>${t('builder.back', 'Back')}</button>` +
    '<button type="button" class="btn btn--quiet" data-restart>Start again</button>' +
    '</div>';

  el.question.hidden = true;
  el.result.hidden = false;
  el.result.focus();
}

function setGenerating(on, message) {
  state.generating = on;
  const button = el.result.querySelector('[data-generate]');
  if (button) {
    button.disabled = on;
    button.setAttribute('aria-busy', on ? 'true' : 'false');
    button.textContent = on ? message || 'Building your brand…' : t('builder.generate', 'Build my brand');
  }
}

function reportError(err) {
  const node = el.result.querySelector('[data-error]');
  if (!node) return;
  node.textContent = err instanceof ApiError ? err.message : 'Something went wrong. Please try again.';
  node.hidden = false;
  node.setAttribute('tabindex', '-1');
  node.focus();
}

/* --- Generating -------------------------------------------------------------- */

/**
 * The one place the interview becomes a brand.
 *
 * The order is deliberate: make sure there is an account, make sure there is a
 * project, write the answers and *wait* for that write, then generate. A
 * generation that succeeds against answers the server never received would
 * produce a brand for a different brief than the one on screen.
 */
async function generate() {
  if (state.generating) return;
  setGenerating(true);

  try {
    if (!state.user) {
      // The answers are in the draft, and the draft survives the round trip.
      window.location.href = `signup.html?next=${encodeURIComponent('/create')}`;
      return;
    }

    if (!state.projectId) {
      const working = String(state.answers.business || 'Untitled brand').split(/[.,]/)[0];
      const created = await api.createProject(working.trim().slice(0, 60) || 'Untitled brand');
      state.projectId = created.project.id;
      rememberProject(state.projectId);
    }

    await api.saveInterview(state.projectId, answerList());
    await api.generate(state.projectId, {});

    clearDraft();
    window.location.href = projectUrl('brand.html', state.projectId);
  } catch (err) {
    setGenerating(false);
    if (err instanceof ApiError && err.isUnauthenticated) {
      window.location.href = `login.html?next=${encodeURIComponent('/create')}`;
      return;
    }
    reportError(err);
  }
}

/* --- Interaction ------------------------------------------------------------- */

function advance() {
  const question = state.questions[state.index];
  const answer = state.answers[question.field];

  const empty =
    answer === undefined ||
    (typeof answer === 'string' && answer.trim() === '') ||
    (Array.isArray(answer) && answer.length === 0);

  // A required question with no answer stops here rather than producing a brief
  // the engine would reject three screens later.
  if (question.required && empty) {
    const input = el.question.querySelector('[data-input]');
    if (input) {
      input.setAttribute('aria-invalid', 'true');
      input.focus();
    }
    state.helpOpen = true;
    renderQuestion();
    return;
  }

  state.helpOpen = false;
  state.index += 1;
  saveDraft();
  void syncAnswers();

  if (state.index >= state.questions.length) renderResult();
  else renderQuestion();
}

document.addEventListener('click', (event) => {
  const target = event.target.closest ? event.target : null;
  if (!target) return;
  const question = state.questions[state.index];

  const choice = target.closest('[data-choice]');
  if (choice && question) {
    state.answers[question.field] = choice.getAttribute('data-choice');
    saveDraft();
    renderQuestion();
    return;
  }

  const multi = target.closest('[data-multi]');
  if (multi && question) {
    const value = multi.getAttribute('data-multi');
    const current = Array.isArray(state.answers[question.field]) ? state.answers[question.field] : [];
    const at = current.indexOf(value);
    if (at === -1) current.push(value);
    else current.splice(at, 1);
    state.answers[question.field] = current;
    saveDraft();
    renderQuestion();
    return;
  }

  if (target.closest('[data-help]')) {
    state.helpOpen = !state.helpOpen;
    // Opening the help is the signal that this answer is a guess (§15). The
    // flag rides with the answer so downstream copy can hedge honestly.
    if (state.helpOpen && question) state.inferred[question.field] = true;
    renderQuestion();
    return;
  }

  if (target.closest('[data-back]')) {
    state.index = Math.max(0, state.index - 1);
    state.helpOpen = false;
    renderQuestion();
    return;
  }

  if (target.closest('[data-back-to-questions]')) {
    state.index = state.questions.length - 1;
    renderQuestion();
    return;
  }

  if (target.closest('[data-next]')) {
    const input = el.question.querySelector('[data-input]');
    if (input && question) state.answers[question.field] = input.value;
    advance();
    return;
  }

  if (target.closest('[data-generate]')) {
    void generate();
    return;
  }

  if (target.closest('[data-restart]')) {
    state.answers = {};
    state.inferred = {};
    state.index = 0;
    clearDraft();
    renderQuestion();
  }
});

/* --- Start ------------------------------------------------------------------- */

async function boot() {
  restoreDraft();

  state.user = await mountAccountNav();

  try {
    const payload = await api.get('/api/interview/questions');
    state.questions = payload.questions;
  } catch (err) {
    el.question.innerHTML =
      '<div class="notice">We could not load the interview just now. Please refresh the page.</div>';
    return;
  }

  // A signed-in founder returning to an unfinished project picks up their own
  // answers, from the server — not from whatever this browser happens to hold.
  if (state.user && state.projectId) {
    try {
      const stored = await api.get(`/api/projects/${state.projectId}/interview`);
      const saved = stored.interview && stored.interview.responses && stored.interview.responses.answers;
      if (Array.isArray(saved) && saved.length > 0 && Object.keys(state.answers).length === 0) {
        saved.forEach((entry) => {
          state.answers[entry.field] = entry.value;
          if (entry.inferred) state.inferred[entry.field] = true;
        });
      }
    } catch (err) {
      // Not their project, or none saved. The interview simply starts fresh.
      rememberProject(null);
      state.projectId = null;
    }
  }

  state.index = firstUnanswered();

  if (state.index >= state.questions.length) renderResult();
  else renderQuestion();
}

void boot();
