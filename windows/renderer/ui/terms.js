// terms.js — before the Studio starts, the user accepts the software terms
// (Windows and Android alike). Nothing runs until they do: no simulation, no
// data loading beyond what the page itself needs. "Decline" quits the app.
//
// The accepted version and time are kept on the device only (local storage)
// and sent nowhere. A new TERMS_VERSION (terms-text.js) asks again.

import { h } from './dom.js';
import { t, getLanguage } from '../i18n.js';
import { TERMS_VERSION, TERMS_EFFECTIVE, TERMS_SECTIONS, TERMS_URL, TERMS_OF_USE_URL, PRIVACY_URL } from './terms-text.js';

const KEY = 'neurocause.termsAccepted';

export function acceptedTermsVersion() {
  try { return JSON.parse(localStorage.getItem(KEY) ?? 'null')?.version ?? null; } catch { return null; }
}

// Resolves once the current terms are accepted (at once if they already
// were); `quit` ends the app when the user declines.
export function ensureTermsAccepted({ openExternal, quit }) {
  if (acceptedTermsVersion() === TERMS_VERSION) return Promise.resolve(false);
  return new Promise((resolve) => {
    const link = (url, label) => h('a', { href: url, rel: 'noopener', onclick: (e) => { e.preventDefault(); openExternal?.(url); } }, label);
    const agree = h('input', { type: 'checkbox', id: 'termsAgree' });
    const accept = h('button', { class: 'btn primary', type: 'button', id: 'termsAccept', disabled: true }, t('Accept and continue'));
    const decline = h('button', { class: 'btn', type: 'button', id: 'termsDecline' }, t('Decline and quit'));
    const full = h('div', { class: 'terms-full', tabindex: '0', role: 'document', 'aria-label': t('Software terms') },
      h('p', { class: 'terms-effective' }, `NeuroCause software terms · effective ${TERMS_EFFECTIVE}`),
      ...TERMS_SECTIONS.map(([head, ...paras]) => [head ? h('h3', {}, head) : null, ...paras.map((p) => h('p', {}, p))]));
    const dialog = h('dialog', { id: 'terms', class: 'terms', 'aria-labelledby': 'termsTitle' },
      h('h2', { id: 'termsTitle' }, t('Before you start')),
      h('p', {}, t('NeuroCause is an experimental simulation for research and teaching. To use it, please read and accept the software terms. Their key points:')),
      h('ul', { class: 'terms-points' },
        h('li', {}, t('Provided free of charge and as is, without any warranty.')),
        h('li', {}, t('Liability is excluded to the maximum extent permitted by law.')),
        h('li', {}, t('Non-commercial use only: the code and the FlyWire brain data carry non-commercial licences.')),
        h('li', {}, t('Simulated output is a model, not an observation of a living animal, and no professional advice.')),
        h('li', {}, t('Swiss law applies; the exclusive place of jurisdiction is Zurich.'))),
      getLanguage() === 'en' ? null : h('p', { class: 'note' }, t('The terms are written in English; the English text is authoritative.')),
      full,
      h('p', { class: 'terms-links' }, link(TERMS_URL, t('Software terms')), ' · ', link(TERMS_OF_USE_URL, t('Terms of use')), ' · ', link(PRIVACY_URL, t('Privacy notice'))),
      // Consent and buttons stay in view while the text scrolls (phones).
      h('div', { class: 'terms-foot' },
        h('label', { class: 'terms-agree' }, agree,
          h('span', {}, t('I have read the software terms and the privacy notice and accept the software terms. I am of legal age, or I use NeuroCause with the consent of my legal guardian.'))),
        h('div', { class: 'terms-actions' }, decline, accept)));
    agree.addEventListener('change', () => { accept.disabled = !agree.checked; });
    // The terms cannot be dismissed with Escape: only Accept or Decline.
    dialog.addEventListener('cancel', (e) => e.preventDefault());
    accept.addEventListener('click', () => {
      if (!agree.checked) return;
      try { localStorage.setItem(KEY, JSON.stringify({ version: TERMS_VERSION, acceptedAt: new Date().toISOString() })); } catch { /* asked again next time */ }
      dialog.close();
      dialog.remove();
      resolve(true);
    });
    decline.addEventListener('click', () => { quit?.(); });
    document.body.append(dialog);
    dialog.showModal();
    full.scrollTop = 0;
  });
}
