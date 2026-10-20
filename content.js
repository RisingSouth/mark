/*
 * Content script. Reads completed assistant messages and inserts text into the composer.
 * It never presses send, never calls the host's internal endpoints, and holds no data.
 */
(() => {
  const S = MF_SELECTORS;
  const seen = new WeakMap();
  let timer = null;

  const schedule = () => { clearTimeout(timer); timer = setTimeout(scan, 1500); };

  function chip(el, kind, text) {
    let c = el.nextElementSibling;
    if (!(c && c.dataset && c.dataset.markChip)) {
      c = document.createElement('div');
      c.dataset.markChip = '1';
      el.insertAdjacentElement('afterend', c);
    }
    const ok = kind === 'ok';
    c.textContent = text;
    c.setAttribute('style', [
      'display:inline-block', 'margin:8px 0', 'padding:6px 12px', 'border-radius:999px',
      'font:600 13px system-ui,sans-serif',
      ok ? 'background:#E6F3EE;color:#0B5A4E;border:1px solid #B9DCCF' : 'background:#FFF1D1;color:#5E4300;border:1px solid #EBD7A4'
    ].join(';'));
  }

  async function scan() {
    if (S.streaming && document.querySelector(S.streaming)) { schedule(); return; }
    for (const el of document.querySelectorAll(S.assistantMessage)) {
      const text = el.innerText || '';
      if (seen.get(el) === text) continue;
      seen.set(el, text);
      if (!/READY\s+pk_|"scores"|"rulings"|"anchors"|"criteria"/.test(text)) continue;

      let res;
      try {
        res = await chrome.runtime.sendMessage({ type: 'CAPTURE', text, chatKey: location.pathname });
      } catch (e) { continue; } // extension reloaded; page refresh fixes it
      if (!res) continue;

      if (res.saved && res.saved.length) {
        chip(el, 'ok', 'Saved to markbook · ' + res.saved.map(s => s.student + ' ' + s.total + (s.of ? '/' + s.of : '')).join(', '));
      } else if (res.invalid && res.invalid.length) {
        const i = res.invalid[0];
        chip(el, 'warn', MFBrand.name + ': ' + i.student + ' not saved · ' + i.errors[0]);
      } else if (res.packImport) {
        chip(el, 'ok', 'Rubric captured \u00b7 review it in the ' + MFBrand.name + ' panel');
      } else if (res.handover) {
        chip(el, 'ok', 'Handover captured · review it in the ' + MFBrand.name + ' panel');
      } else if (res.noPack) {
        chip(el, 'warn', MFBrand.name + ': create a pack in the panel to save marks');
      }
    }
  }

  function insert(text) {
    const el = document.querySelector(S.composer);
    if (!el) return false;
    el.focus();
    const sel = window.getSelection();
    sel.selectAllChildren(el);
    sel.collapseToEnd();
    return document.execCommand('insertText', false, text);
  }

  function toFile(f) {
    const bin = atob(f.b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return new File([u], f.name, { type: f.type });
  }

  // Best effort: set the page's own file input, else paste the files into the composer. Returns the method used, or null.
  // We cannot confirm the page accepted them, so the panel asks the teacher to check before sending.
  function attach(files) {
    const dt = new DataTransfer();
    files.forEach(f => dt.items.add(f));
    const input = document.querySelector(S.fileInput);
    if (input) {
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return 'input';
    }
    const el = document.querySelector(S.composer);
    if (el) {
      el.focus();
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      return 'paste';
    }
    return null;
  }

  chrome.runtime.onMessage.addListener((msg, _s, send) => {
    if (!msg) return false;
    if (msg.type === 'INSERT_TEXT') { send({ ok: insert(msg.text) }); return false; }
    if (msg.type === 'INSERT_FILES') {
      let method = null;
      try { method = attach((msg.files || []).map(toFile)); } catch (e) { method = null; }
      setTimeout(() => send({ ok: insert(msg.text), attached: method }), 500); // let the page register the files first
      return true;
    }
    return false;
  });

  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, characterData: true });
  schedule();
})();
