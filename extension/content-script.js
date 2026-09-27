// Arjun extension autofill — runs two ways:
//  1. Manual: injected on demand via popup "Fill this page" click (any page).
//  2. Auto: declared in manifest.json content_scripts, matching known ATS domains only.
// Scrapes visible form fields (never search boxes or passwords), asks the backend to map them
// to profile values by meaning, fills what it's confident about, then shows the user exactly
// what happened: filled fields outlined green, fields to check outlined amber, and a summary
// card listing every field with Undo.

(function () {
  const CONFIDENCE_THRESHOLD = 0.6;
  // A real application form has several fields; one or two inputs is a search bar or a filter.
  const MIN_FORM_FIELDS = 2;

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

  // For a radio/checkbox group the field's label is the question ("Will you require
  // sponsorship?"), not the first option's own label ("Yes").
  function groupLabel(el) {
    const set = el.closest('fieldset');
    const legend = set?.querySelector('legend')?.innerText.trim();
    if (legend) return legend;
    const group = el.closest('[role="radiogroup"], [role="group"]');
    if (group) {
      const by = group.getAttribute('aria-labelledby');
      const text = (by && by.split(' ').map(id => document.getElementById(id)?.innerText.trim()).filter(Boolean).join(' '))
        || group.getAttribute('aria-label');
      if (text) return text.trim();
    }
    // Nearest block above the options whose text isn't just one option.
    const optionTexts = new Set((el.name ? Array.from(document.querySelectorAll(`input[name="${CSS.escape(el.name)}"]`)) : [el]).map(g => labelFor(g)));
    for (let n = el.parentElement, i = 0; n && i < 5; n = n.parentElement, i++) {
      const first = n.innerText?.trim().split('\n')[0];
      if (first && !optionTexts.has(first) && first.length < 160) return first;
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

  // Site search and filter boxes (LinkedIn's "Describe the job you want", job board keyword
  // searches) are not part of an application and must never be filled.
  const SEARCH_WORDS = /\bsearch\b|describe the job|keywords?\b|job title, skill|filter by/i;
  function isSearchField(el) {
    if (el.type === 'search' || el.getAttribute('role') === 'searchbox') return true;
    if (el.closest('[role="search"], header, nav')) return true;
    const hints = [el.placeholder, el.getAttribute('aria-label'), el.name, el.id, el.getAttribute('data-testid')].filter(Boolean).join(' ');
    return SEARCH_WORDS.test(hints) || /typeahead/i.test(el.getAttribute('data-testid') || '');
  }

  function scrapeFields() {
    // Password fields are never scraped, sent to the backend, or filled: users type their own.
    const elements = Array.from(document.querySelectorAll('input, select, textarea'))
      .filter(isFillable)
      .filter(el => el.type !== 'password')
      .filter(el => !isSearchField(el));
    const fields = [];
    const seen = new Set(); // dedupe radio/checkbox groups by name

    elements.forEach((el, i) => {
      if ((el.type === 'radio' || el.type === 'checkbox') && el.name) {
        if (seen.has(el.name)) return;
        seen.add(el.name);
      }
      const fieldId = `f${i}`;
      el.dataset.arjunFieldId = fieldId;
      const isChoice = el.type === 'radio' || el.type === 'checkbox';
      fields.push({
        field_id: fieldId,
        label: (isChoice && el.name && groupLabel(el)) || labelFor(el),
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

  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const pad = (n) => String(n).padStart(2, '0');

  // Profile dates come as "01/2015", "Jan 2015", "2015-01", "01/15/2015", etc. Native
  // <input type="month|date"> only accepts "yyyy-MM" / "yyyy-MM-dd" and silently blanks
  // anything else, so convert, or return null (field left for the user) when we can't.
  function normalizeDate(type, raw) {
    const v = String(raw).trim();
    let m;
    let y, mo, d;
    if ((m = v.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/))) [, y, mo, d] = m;
    else if ((m = v.match(/^(\d{4})\/(\d{1,2})$/))) [, y, mo] = m;
    else if ((m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) [, mo, d, y] = m; // US MM/DD/YYYY
    else if ((m = v.match(/^(\d{1,2})[/-](\d{4})$/))) [, mo, y] = m;
    else if ((m = v.match(/^([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4})$/)) && MONTHS[m[1].toLowerCase()]) {
      mo = MONTHS[m[1].toLowerCase()]; y = m[2];
    } else return null; // "Present", "2015" alone, free text
    if (+mo < 1 || +mo > 12 || (d && (+d < 1 || +d > 31))) return null;
    if (type === 'month') return `${y}-${pad(mo)}`;
    if (type === 'date') return d ? `${y}-${pad(mo)}-${pad(d)}` : null; // don't invent a day
    return v;
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
    if (el.type === 'month' || el.type === 'date') {
      const value = normalizeDate(el.type, mapping.value);
      if (!value) return false;
      setNativeValue(el, value);
      return el.value === value; // the browser blanks values it rejects
    }
    setNativeValue(el, mapping.value);
    return true;
  }

  function showToast(text) {
    const toast = document.createElement('div');
    toast.textContent = text;
    Object.assign(toast.style, {
      position: 'fixed', bottom: '20px', right: '20px', zIndex: 2147483647,
      background: '#1c1917', color: '#fff', padding: '10px 16px', borderRadius: '8px',
      fontFamily: 'system-ui, sans-serif', fontSize: '13px', boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      borderLeft: '3px solid #f59e0b', maxWidth: '320px', lineHeight: '1.4',
    });
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 6000);
  }

  // ── What the user sees after a fill ─────────────────────────────────────
  const GREEN = '#16a34a', AMBER = '#f59e0b';
  const highlighted = new Map(); // element → original inline outline styles

  function highlight(el, color) {
    const target = (el.type === 'radio' || el.type === 'checkbox') ? (el.closest('fieldset, [role="radiogroup"], [role="group"]') || el.parentElement || el) : el;
    if (!highlighted.has(target)) highlighted.set(target, { outline: target.style.outline, outlineOffset: target.style.outlineOffset });
    target.style.outline = `2px solid ${color}`;
    target.style.outlineOffset = '2px';
  }
  function clearHighlights() {
    for (const [el, o] of highlighted) { el.style.outline = o.outline; el.style.outlineOffset = o.outlineOffset; }
    highlighted.clear();
  }

  // Remember what was there so Undo can put it back.
  function snapshot(el) {
    if (el.type === 'radio' || el.type === 'checkbox') {
      const group = el.name ? Array.from(document.querySelectorAll(`input[name="${CSS.escape(el.name)}"]`)) : [el];
      return { group: group.map(g => [g, g.checked]) };
    }
    return { value: el.value };
  }
  function restore(el, snap) {
    if (snap.group) {
      for (const [g, checked] of snap.group) { if (g.checked !== checked) { g.checked = checked; g.dispatchEvent(new Event('change', { bubbles: true })); } }
    } else if (el.tagName === 'SELECT') {
      el.value = snap.value; el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      setNativeValue(el, snap.value);
    }
  }

  // The value as the user sees it: option text for dropdowns and choices.
  function shownValue(el, mapping) {
    if (el.tagName === 'SELECT') {
      const opt = Array.from(el.options).find(o => o.value === mapping.value || o.textContent.trim() === mapping.value);
      return opt ? opt.textContent.trim() : String(mapping.value);
    }
    return String(mapping.value);
  }

  const fieldName = (f) => f.label || f.placeholder || f.name || 'Unlabeled field';

  function showSummary(fields, results) {
    document.getElementById('arjun-fill-summary')?.remove();
    const host = document.createElement('div');
    host.id = 'arjun-fill-summary';
    Object.assign(host.style, { position: 'fixed', bottom: '16px', right: '16px', zIndex: 2147483647 });
    const root = host.attachShadow({ mode: 'open' });
    document.body.appendChild(host);

    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    let collapsed = false;
    const render = () => {
      const filled = results.filter(r => r.state === 'filled');
      const check = results.filter(r => r.state === 'check');
      const empty = fields.filter(f => !results.some(r => r.field.field_id === f.field_id));
      if (collapsed) {
        root.innerHTML = `
          <style>.pill { background: #1c1917; color: #fff; border: none; border-left: 3px solid #f59e0b; border-radius: 999px; padding: 8px 14px; font: 600 12.5px system-ui, sans-serif; cursor: pointer; box-shadow: 0 6px 18px rgba(0,0,0,.25); } .pill:focus-visible { outline: 2px solid #f59e0b; outline-offset: 2px; }</style>
          <button class="pill" data-act="expand">Arjun: ${filled.length} filled${check.length ? ` · ${check.length} to check` : ''} · Show</button>`;
        return;
      }
      root.innerHTML = `
        <style>
          .card { width: 340px; max-height: 70vh; display: flex; flex-direction: column; background: #fff; color: #1c1917; border: 1px solid #e7e5e4; border-radius: 12px; box-shadow: 0 12px 32px rgba(0,0,0,.18); font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; overflow: hidden; }
          .head { padding: 12px 14px 10px; border-bottom: 1px solid #f5f5f4; display: grid; gap: 4px; }
          .title { display: flex; justify-content: space-between; align-items: center; font-weight: 700; font-size: 14px; }
          .x { background: none; border: none; font-size: 18px; line-height: 1; cursor: pointer; color: #78716c; padding: 0 2px; }
          .legend { color: #78716c; font-size: 12px; display: flex; gap: 12px; flex-wrap: wrap; }
          .dot { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 4px; vertical-align: middle; }
          .body { overflow-y: auto; padding: 4px 14px 8px; }
          h4 { margin: 10px 0 4px; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: #78716c; }
          .row { display: grid; grid-template-columns: 1fr auto; gap: 2px 8px; padding: 6px 8px; margin: 0 -8px; border-radius: 6px; cursor: pointer; }
          .row:hover { background: #fafaf9; }
          .label { font-weight: 600; grid-column: 1; }
          .val { color: #44403c; grid-column: 1; word-break: break-word; }
          .why { color: #92400e; font-size: 12px; grid-column: 1; }
          .use { grid-column: 2; grid-row: 1 / span 3; align-self: center; background: #f59e0b; color: #fff; border: none; border-radius: 6px; padding: 5px 10px; font-weight: 600; cursor: pointer; }
          .empty { color: #78716c; font-size: 12px; }
          .foot { border-top: 1px solid #f5f5f4; padding: 10px 14px; display: flex; justify-content: space-between; align-items: center; gap: 8px; }
          .note { color: #78716c; font-size: 11.5px; }
          .undo { background: #fff; color: #1c1917; border: 1px solid #d6d3d1; border-radius: 6px; padding: 6px 10px; font-weight: 600; cursor: pointer; }
          button:focus-visible, .row:focus-visible { outline: 2px solid #f59e0b; outline-offset: 2px; }
        </style>
        <div class="card" role="dialog" aria-label="Arjun fill summary">
          <div class="head">
            <div class="title"><span>Arjun filled ${filled.length} of ${fields.length} field${fields.length === 1 ? '' : 's'}</span><span><button class="x" data-act="collapse" aria-label="Minimize" title="Minimize">–</button><button class="x" data-act="close" aria-label="Close" title="Close">×</button></span></div>
            <div class="legend"><span><span class="dot" style="background:${GREEN}"></span>Filled from your profile</span>${check.length ? `<span><span class="dot" style="background:${AMBER}"></span>Check these</span>` : ''}</div>
          </div>
          <div class="body">
            ${check.length ? `<h4>Check these (${check.length})</h4>${check.map(r => `
              <div class="row" tabindex="0" data-id="${esc(r.field.field_id)}">
                <span class="label">${esc(fieldName(r.field))}</span>
                ${r.value ? `<span class="val">Arjun's guess: ${esc(r.value)}</span>` : ''}
                <span class="why">${esc(r.reason)}</span>
                ${r.canUse ? `<button class="use" data-act="use" data-id="${esc(r.field.field_id)}">Use</button>` : ''}
              </div>`).join('')}` : ''}
            ${filled.length ? `<h4>Filled (${filled.length})</h4>${filled.map(r => `
              <div class="row" tabindex="0" data-id="${esc(r.field.field_id)}">
                <span class="label">${esc(fieldName(r.field))}</span>
                <span class="val">${esc(r.value)}</span>
              </div>`).join('')}` : ''}
            ${empty.length ? `<h4>Left empty (${empty.length})</h4><div class="empty">Nothing in your profile for: ${esc(empty.map(fieldName).join(' · '))}</div>` : ''}
          </div>
          <div class="foot"><span class="note">Review everything before you submit.</span>${filled.length ? '<button class="undo" data-act="undo">Undo all</button>' : ''}</div>
        </div>`;
    };
    render();

    const elFor = (id) => document.querySelector(`[data-arjun-field-id="${CSS.escape(id)}"]`);
    root.addEventListener('click', (ev) => {
      const t = ev.target.closest('[data-act], .row');
      if (!t) return;
      const act = t.dataset.act;
      if (act === 'collapse') { collapsed = true; render(); return; }
      if (act === 'expand') { collapsed = false; render(); return; }
      if (act === 'close') { clearHighlights(); host.remove(); return; }
      if (act === 'undo') {
        for (const r of results.filter(x => x.state === 'filled')) restore(r.el, r.snap);
        clearHighlights(); host.remove();
        showToast('Arjun: undid every field it filled.');
        return;
      }
      if (act === 'use') {
        ev.stopPropagation();
        const r = results.find(x => x.field.field_id === t.dataset.id);
        if (r && fillField(r.el, r.mapping)) { r.state = 'filled'; highlight(r.el, GREEN); render(); }
        else if (r) { r.reason = "Couldn't fill this automatically. Please fill it yourself."; r.canUse = false; render(); }
        return;
      }
      const el = elFor(t.dataset.id);
      if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.focus({ preventScroll: true }); }
    });
  }

  async function run() {
    const fields = scrapeFields();

    if (fields.length < MIN_FORM_FIELDS) {
      // Runs in every frame (allFrames — see popup.js). Frames with a form tell the top frame;
      // the top frame reports "no form" only if no frame found one.
      if (window !== window.top) return;
      let found = false;
      const onMsg = (e) => { if (e.data?.arjun === 'form-found') found = true; };
      window.addEventListener('message', onMsg);
      setTimeout(() => {
        window.removeEventListener('message', onMsg);
        if (!found) showToast('Arjun: no application form on this page, so nothing was filled. Open the job\'s application form and try again.');
      }, 2500);
      return;
    }
    if (window !== window.top) window.top.postMessage({ arjun: 'form-found' }, '*');

    chrome.runtime.sendMessage({ type: 'MAP_FIELDS', fields, url: location.href }, (res) => {
      if (!res?.ok) {
        showToast(res?.error === 'not_logged_in'
          ? 'Arjun: sign in at vinayakbist.com/projects/arjun first.'
          : `Arjun: couldn't map fields (${res?.error || 'unknown error'}).`);
        return;
      }

      const results = [];
      for (const mapping of res.mappings) {
        const el = document.querySelector(`[data-arjun-field-id="${mapping.field_id}"]`);
        const field = fields.find(f => f.field_id === mapping.field_id);
        if (!el || !field) continue;
        const value = shownValue(el, mapping);
        if (mapping.confidence < CONFIDENCE_THRESHOLD) {
          results.push({ field, el, mapping, value, state: 'check', reason: 'Arjun wasn\'t sure this is right, so it left the field empty.', canUse: true });
          highlight(el, AMBER);
          continue;
        }
        const snap = snapshot(el);
        if (fillField(el, mapping)) {
          results.push({ field, el, mapping, value, snap, state: 'filled' });
          highlight(el, GREEN);
        } else {
          results.push({ field, el, mapping, value, state: 'check', reason: 'Didn\'t match any option in this field. Please pick one yourself.', canUse: false });
          highlight(el, AMBER);
        }
      }
      // "Use" on an unsure field needs its original value for Undo too.
      for (const r of results) if (!r.snap) r.snap = snapshot(r.el);
      showSummary(fields, results);
    });
  }

  run();
})();
