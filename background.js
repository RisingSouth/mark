/* Service worker: owns captures. The content script only reads the page; this writes to IndexedDB. */
importScripts('lib/brand.js', 'lib/parse.js', 'lib/db.js');

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

function broadcast() {
  chrome.runtime.sendMessage({ type: 'DB_CHANGED' }).catch(() => {});
}

async function handleCapture(msg) {
  const packs = await MFDB.getAll('packs');
  const out = { saved: [], invalid: [], handover: false, ready: false, noPack: false };
  if (!packs.length) { out.noPack = true; return out; }

  const activeId = await MFDB.getMeta('activePackId');
  const hinted = [...(msg.text || '').matchAll(/"pack"\s*:\s*"(pk_[a-z0-9]+)"/gi)].map(m => m[1].toLowerCase());
  const pack = packs.find(p => hinted.includes(p.id)) || packs.find(p => p.id === activeId) || packs[0];

  const r = MFParse.extract(msg.text, pack.rubric);

  for (const m of r.marks) {
    const res = await MFDB.saveMark(pack.id, m);
    out.saved.push({ student: m.student, total: m.total, of: m.of, status: res.status });
  }
  out.invalid = r.invalid;

  if (r.handovers.length) {
    await MFDB.setMeta('pendingHandover', { packId: pack.id, at: Date.now(), data: r.handovers[0] });
    out.handover = true;
  }

  if (r.ready.length && msg.chatKey) {
    const last = r.ready[r.ready.length - 1];
    await chrome.storage.session.set({ ['ready:' + msg.chatKey]: { packId: last.packId, protocol: last.protocol, at: Date.now() } });
    out.ready = true;
  }

  if (out.saved.length || out.handover || out.ready || out.invalid.length) broadcast();
  return out;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'CAPTURE') {
    handleCapture(msg).then(sendResponse).catch(e => sendResponse({ saved: [], invalid: [{ student: '?', errors: [String(e)] }], handover: false }));
    return true;
  }
  return false;
});
