// Arjun Autofill — runs two ways:
//  1. Manual: injected on demand via popup "Fill this page" click (any page).
//  2. Auto: declared in manifest.json content_scripts, matching known ATS domains only.
//     Gated by the "autoMode" toggle in the popup (chrome.storage.local, default on).
// Scrapes visible form fields, asks the backend to map them to profile values by meaning,
// then fills whatever it's confident about.

(function () {
  const CONFIDENCE_THRESHOLD = 0.6;
  const MIN_AUTO_FIELDS = 3; // avoid firing auto-fill on ATS listing/search pages with just a search box
  const AUTO_POLL_MS = 800;
  const AUTO_MAX_WAIT_MS = 45000; // ATS SPAs (Workday, Greenhouse) render the real form well after document_idle

  function labelFor(el) {
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l) return l.innerText.trim();
    }
    const wrappingLabel = el.closest('label');
    if (wrappingLabel) return wrappingLabel.innerText.trim();
    // aria-labelledby
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const parts = labelledBy.split(' ').map(id => document.getElementById(id)?.innerText.trim()).filter(Boolean);
      if (parts.length) return parts.join(' ');
    }
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
    // Fallback: nearest preceding text node within a common ancestor
    const container = el.closest('div, fieldset, li, tr');
    if (container) {
      const text = container.innerText?.trim().split('\n')[0];
      if (text && text.length < 120) return text;
    }
    return '';
  }

  function optionsFor(el) {
    if (el.tagName === 'SELECT') {
      return Array.from(el.options).map(o => ({ value: o.value, text: o.textContent.trim() }));
    }
    if (el.type === 'radio' || el.type === 'checkbox') {
      const group = el.name
        ? Array.from(document.querySelectorAll(`input[name="${CSS.escape(el.name)}"]`))
        : [el];
      return group.map(g => ({ value: g.value, text: labelFor(g) }));
    }
    return undefined;
  }

  function isFillable(el) {
    if (el.disabled || el.readOnly) return false;
    if (el.type === 'hidden' || el.type === 'submit' || el.type === 'button' || el.type === 'file') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function scrapeFields() {
    // Password fields are never scraped or sent to the backend — see fillPasswordFields().
    const elements = Array.from(document.querySelectorAll('input, select, textarea'))
      .filter(isFillable)
      .filter(el => el.type !== 'password');
    const fields = [];
    const seen = new Set(); // dedupe radio/checkbox groups by name

    elements.forEach((el, i) => {
      if ((el.type === 'radio' || el.type === 'checkbox') && el.name) {
        if (seen.has(el.name)) return;
        seen.add(el.name);
      }
      const fieldId = `f${i}`;
      el.dataset.arjunFieldId = fieldId;
      fields.push({
        field_id: fieldId,
        label: labelFor(el),
        placeholder: el.placeholder || '',
        name: el.name || '',
        id: el.id || '',
        type: el.type || el.tagName.toLowerCase(),
        options: optionsFor(el),
      });
    });

    return fields;
  }

  function setNativeValue(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    el.dispatchEvent(new Event('focus', { bubbles: true }));
    if (setter) setter.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    // Many form frameworks (Formik/React Hook Form/Phenom's own validators) only
    // re-validate a field once it's "touched" — that happens on blur, not on value change.
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  function fillField(el, mapping) {
    if (el.tagName === 'SELECT') {
      const opt = Array.from(el.options).find(o => o.value === mapping.value || o.textContent.trim() === mapping.value);
      if (!opt) return false;
      el.value = opt.value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    if (el.type === 'radio' || el.type === 'checkbox') {
      const group = el.name ? Array.from(document.querySelectorAll(`input[name="${CSS.escape(el.name)}"]`)) : [el];
      const target = group.find(g => g.value === mapping.value || labelFor(g) === mapping.value);
      if (!target) return false;
      target.checked = true;
      target.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    setNativeValue(el, mapping.value);
    return true;
  }

  // Fills every password field on the page from a value saved locally in the popup —
  // entirely client-side. This never goes through MAP_FIELDS/the backend/an LLM, so the
  // password is never logged in Langfuse or sent to any model, and one saved value works
  // across every ATS's account-creation form without ever being transmitted off-device.
  async function fillPasswordFields() {
    const { autofillPassword } = await chrome.storage.local.get(['autofillPassword']);
    if (!autofillPassword) return 0;
    const pwFields = Array.from(document.querySelectorAll('input[type="password"]')).filter(isFillable);
    for (const el of pwFields) setNativeValue(el, autofillPassword);
    return pwFields.length;
  }

  function showToast(text) {
    const toast = document.createElement('div');
    toast.textContent = text;
    Object.assign(toast.style, {
      position: 'fixed', bottom: '20px', right: '20px', zIndex: 2147483647,
      background: '#1c1917', color: '#fff', padding: '10px 16px', borderRadius: '8px',
      fontFamily: 'system-ui, sans-serif', fontSize: '13px', boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      borderLeft: '3px solid #f59e0b',
    });
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
  }

  async function run() {
    const pwFilled = await fillPasswordFields();
    const fields = scrapeFields();

    if (!fields.length) {
      // Runs in every frame on the page now (allFrames — see popup.js), including
      // ad/tracking iframes that legitimately have no fields. Only the top frame
      // reports "nothing found" so one genuinely-empty page still gets a signal,
      // without every subframe spamming its own toast.
      if (window === window.top) {
        showToast(pwFilled
          ? `Arjun: filled ${pwFilled} password field${pwFilled === 1 ? '' : 's'}.`
          : 'Arjun: no fillable fields found on this page.');
      }
      return;
    }

    chrome.runtime.sendMessage({ type: 'MAP_FIELDS', fields, url: location.href }, (res) => {
      if (!res?.ok) {
        const pwNote = pwFilled ? ` (filled ${pwFilled} password field${pwFilled === 1 ? '' : 's'} locally)` : '';
        showToast((res?.error === 'not_logged_in'
          ? 'Arjun: sign in at vinayakbist.com/projects/arjun first.'
          : `Arjun: couldn't map fields (${res?.error || 'unknown error'}).`) + pwNote);
        return;
      }

      let filled = pwFilled, skipped = 0;
      for (const mapping of res.mappings) {
        const el = document.querySelector(`[data-arjun-field-id="${mapping.field_id}"]`);
        if (!el) continue;
        if (mapping.confidence < CONFIDENCE_THRESHOLD) { skipped++; continue; }
        if (fillField(el, mapping)) filled++; else skipped++;
      }
      showToast(`Arjun: filled ${filled} field${filled === 1 ? '' : 's'}${skipped ? `, ${skipped} need review` : ''}.`);
    });
  }

  run();
})();
