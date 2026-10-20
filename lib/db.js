/* IndexedDB wrapper. All data lives on this device. Shared by the service worker and the side panel. */
const MFDB = (() => {
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const r = indexedDB.open('markflow', 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore('packs', { keyPath: 'id' });
        d.createObjectStore('marks', { keyPath: 'key' });
        d.createObjectStore('meta', { keyPath: 'k' });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    return dbp;
  }

  async function tx(store, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      let out;
      const req = fn(t.objectStore(store));
      if (req) req.onsuccess = () => { out = req.result; };
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  const getAll = store => tx(store, 'readonly', s => s.getAll());
  const get = (store, key) => tx(store, 'readonly', s => s.get(key));
  const put = (store, val) => tx(store, 'readwrite', s => s.put(val));
  const del = (store, key) => tx(store, 'readwrite', s => s.delete(key));
  const setMeta = (k, v) => put('meta', { k, v });
  const getMeta = async k => { const r = await get('meta', k); return r ? r.v : undefined; };

  // Save a captured mark. Re-capturing identical model output is a no-op, so teacher edits survive.
  async function saveMark(packId, m) {
    const key = packId + ':' + m.student;
    const ex = await get('marks', key);
    if (ex) {
      const sameScores = JSON.stringify(ex.modelScores || ex.scores) === JSON.stringify(m.scores);
      if (sameScores && (ex.modelComment || '') === (m.comment || '')) return { status: 'unchanged', mark: ex };
    }
    const history = ex
      ? (ex.history || []).concat([{ at: ex.capturedAt, scores: ex.scores, total: ex.total, decision: ex.decision }]).slice(-10)
      : [];
    const rec = Object.assign({}, m, {
      key, packId, decision: 'pending', overridden: false,
      modelScores: Object.assign({}, m.scores), modelComment: m.comment || '',
      capturedAt: Date.now(), history
    });
    await put('marks', rec);
    return { status: ex ? 'updated' : 'new', mark: rec };
  }

  return { getAll, get, put, del, setMeta, getMeta, saveMark };
})();
