'use strict';
/**
 * lib/page-dump.js
 *
 * dumpFrame runs inside a page (page.evaluate) and records the visible form
 * controls, buttons, opt-out-ish links, CAPTCHA presence and some page text.
 * Read-only: it never clicks, types or submits. Shared by the broker form
 * survey and the catalog survey.
 */
function dumpFrame() {
  const vis = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const label = el => {
    let t = '';
    if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) t = l.innerText; }
    if (!t && el.closest('label')) t = el.closest('label').innerText;
    return (t || '').trim().slice(0, 60);
  };
  const forms = [...document.forms];
  // Nearest heading above the control's form, to tell two forms on one page apart.
  const heading = el => {
    const root = el.closest('form') || el;
    const hs = [...document.querySelectorAll('h1,h2,h3,h4,legend')].filter(h => h.compareDocumentPosition(root) & Node.DOCUMENT_POSITION_FOLLOWING);
    return hs.length ? hs[hs.length - 1].innerText.trim().slice(0, 60) : '';
  };
  const controls = [...document.querySelectorAll('input,select,textarea')].filter(el => el.type !== 'hidden' && vis(el)).map(el => ({
    tag: el.tagName.toLowerCase(), type: el.type, name: el.name, id: el.id,
    placeholder: el.placeholder || '', aria: el.getAttribute('aria-label') || '', label: label(el),
    form: forms.indexOf(el.form), heading: heading(el),
    options: el.tagName === 'SELECT' ? [...el.options].slice(0, 8).map(o => `${o.value}=${o.text.trim().slice(0, 20)}`) : undefined,
  }));
  const buttons = [...document.querySelectorAll('button,input[type=submit]')].filter(vis)
    .map(b => ({ text: (b.innerText || b.value || '').trim().slice(0, 40), id: b.id, inForm: !!b.closest('form') })).slice(0, 25);
  const links = [...document.querySelectorAll('a')].filter(vis)
    .map(a => ({ text: (a.innerText || '').trim().slice(0, 50), href: a.getAttribute('href') || '' }))
    .filter(a => /opt|remov|suppress|delete|privacy|continue|start|begin|record/i.test(a.text + ' ' + a.href)).slice(0, 25);
  const captcha = !!document.querySelector('iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="turnstile"],.g-recaptcha,.h-captcha,.cf-turnstile');
  const text = document.body ? document.body.innerText.slice(0, 2000) : '';
  return { controls, buttons, links, captcha, text };
}

module.exports = { dumpFrame };
