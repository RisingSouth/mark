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
    if (!(c && c.dataset && c.dataset.markflowChip)) {
      c = document.createElement('div');
      c.dataset.markflowChip = '1';
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
      if (!/READY\s+pk_|"scores"|"rulings"|"anchors"/.test(text)) continue;

      let res;
      try {
        res = await chrome.runtime.sendMessage({ type: 'CAPTURE', text, chatKey: location.pathname });
      } catch (e) { continue; } // extension reloaded; page refresh fixes it
      if (!res) continue;

      if (res.saved && res.saved.length) {
        chip(el, 'ok', 'Saved to markbook · ' + res.saved.map(s => s.student + ' ' + s.total + (s.of ? '/' + s.of : '')).join(', '));
      } else if (res.invalid && res.invalid.length) {
        const i = res.invalid[0];
        chip(el, 'warn', 'Markflow: ' + i.student + ' not saved · ' + i.errors[0]);
      } else if (res.handover) {
        chip(el, 'ok', 'Handover captured · review it in the Markflow panel');
      } else if (res.noPack) {
        chip(el, 'warn', 'Markflow: create a pack in the panel to save marks');
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

  chrome.runtime.onMessage.addListener((msg, _s, send) => {
    if (msg && msg.type === 'INSERT_TEXT') { send({ ok: insert(msg.text) }); }
    return false;
  });

  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, characterData: true });
  schedule();
})();
