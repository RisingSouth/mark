/* Side panel. Plain DOM, no framework. Reads and writes IndexedDB directly; talks to the page via the content script. */
(() => {
  const P = MFPrompts;
  const root = document.getElementById('app');

  const state = {
    view: 'home', packs: [], packId: null, marks: [], pending: null,
    tab: null, ready: null, draft: null, sel: null, toast: '', student: '',
    pendingImport: null, importDraft: null, handoverMode: 'handover'
  };

  // ---------- helpers ----------
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  const svg = path => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('width', '15'); s.setAttribute('height', '15'); s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('fill', 'none'); s.setAttribute('stroke', '#fff'); s.setAttribute('stroke-width', '2.4');
    s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', path); s.append(p); return s;
  };

  const uid = () => 'pk_' + Math.random().toString(36).slice(2, 8).padEnd(6, 'x');
  const pack = () => state.packs.find(p => p.id === state.packId) || null;
  const byStudent = (a, b) => a.student.localeCompare(b.student, undefined, { numeric: true });
  const needsReview = m => m.decision !== 'accepted' && (m.confidence === 'low' || (m.flags && m.flags.length));

  function toast(msg) {
    state.toast = msg; render();
    setTimeout(() => { if (state.toast === msg) { state.toast = ''; render(); } }, 4000);
  }

  async function copy(text, msg) {
    try { await navigator.clipboard.writeText(text); toast(msg || 'Copied.'); }
    catch (e) { toast('Could not copy. Select the text and copy it manually.'); }
  }

  async function insertText(text) {
    if (!state.tab) return copy(text, 'Open claude.ai in this window. Copied instead, paste it into the chat.');
    try {
      const res = await chrome.tabs.sendMessage(state.tab.id, { type: 'INSERT_TEXT', text });
      if (res && res.ok) return toast('Inserted into the composer. Press send when ready.');
    } catch (e) { /* content script not present: fall through */ }
    copy(text, 'Could not reach the chat. Copied instead, paste it into the composer.');
  }

  function nextStudent() {
    const nums = state.marks.map(m => /(\d+)$/.exec(m.student)).filter(Boolean).map(m => Number(m[1]));
    const n = (nums.length ? Math.max(...nums) : 0) + 1;
    const prefix = state.marks.length ? state.marks[0].student.replace(/\d+$/, '') : 'S';
    return prefix + String(n).padStart(2, '0');
  }

  // ---------- data ----------
  async function load() {
    state.packs = await MFDB.getAll('packs');
    const saved = await MFDB.getMeta('activePackId');
    state.packId = state.packs.find(p => p.id === saved) ? saved : (state.packs[0] ? state.packs[0].id : null);
    const all = await MFDB.getAll('marks');
    state.marks = all.filter(m => m.packId === state.packId).sort(byStudent);
    state.pending = (await MFDB.getMeta('pendingHandover')) || null;
    state.pendingImport = (await MFDB.getMeta('pendingImport')) || null;
    await refreshTab();
    render();
  }

  async function refreshTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      state.tab = tab && /^https:\/\/claude\.ai\//.test(tab.url || '') ? tab : null;
      state.ready = null;
      if (state.tab) {
        const key = 'ready:' + new URL(state.tab.url).pathname;
        const r = await chrome.storage.session.get(key);
        state.ready = r[key] || null;
      }
    } catch (e) { state.tab = null; state.ready = null; }
  }

  async function savePack(p) {
    p.updatedAt = Date.now();
    await MFDB.put('packs', p);
    await MFDB.setMeta('activePackId', p.id);
  }

  function newPack(name) {
    return {
      id: uid(), name, task: '', style: '', protocol: P.PROTOCOL, version: 1,
      rubric: [{ id: 'C1', name: 'Criterion 1', max: 5, descriptor: '' }],
      anchors: [], rulings: [], settings: { includeMarks: 'summary' }, createdAt: Date.now()
    };
  }

  // ---------- views ----------
  function header() {
    return h('header', null, h('div', { class: 'logo' }, svg('M4 8h10M4 16h6M16 14l2.5 2.5L22 11')), h('div', { class: 'brand' }, MFBrand.name));
  }

  function navbar() {
    const tabs = [['home', 'Home'], ['pack', 'Pack'], ['markbook', 'Markbook']];
    return h('nav', null, tabs.map(([v, label]) => h('button', {
      'aria-current': state.view === v || (v === 'home' && (state.view === 'handover' || state.view === 'import')) ? 'page' : null,
      onclick: () => go(v)
    }, label)));
  }

  function go(v) {
    if (v === 'pack' && pack()) state.draft = JSON.parse(JSON.stringify(pack()));
    state.view = v; render();
  }

  function packSelect() {
    return h('div', { class: 'col' },
      h('div', { class: 'label' }, 'Assessment pack'),
      h('div', { class: 'btns' },
        h('select', {
          'aria-label': 'Active pack',
          onchange: async e => { await MFDB.setMeta('activePackId', e.target.value); await load(); }
        }, state.packs.map(p => h('option', { value: p.id, selected: p.id === state.packId }, p.name))),
        h('button', { class: 'btn small', style: 'flex:none', onclick: () => { state.view = 'newpack'; render(); } }, 'New')
      ));
  }

  function statusCard(p) {
    let cls = '', title, sub;
    if (!state.tab) { title = 'No chat in view'; sub = 'Open claude.ai in this window'; }
    else if (state.ready && state.ready.packId === p.id) { cls = 'ok'; title = 'Chat configured'; sub = 'READY ' + p.id + ' ' + state.ready.protocol; }
    else if (state.ready) { cls = 'warn'; title = 'A different pack is loaded'; sub = state.ready.packId + ' (active: ' + p.id + ')'; }
    else { cls = 'warn'; title = 'Pack not loaded in this chat'; sub = 'Use Load pack, then send'; }
    return h('div', { class: 'status ' + cls }, h('span', { class: 'dot' }), h('div', null, h('b', null, title), h('div', { class: 'mono small muted' }, sub)));
  }

  function homeView() {
    const p = pack();
    if (!p) {
      return [
        h('div', { class: 'card pad col' },
          h('b', null, 'Welcome'),
          h('div', { class: 'muted' }, 'A pack holds the task, rubric, anchors and rulings for one assessment. It travels with you across chats.'),
          h('button', { class: 'btn primary', onclick: startImport }, 'Import rubric from files'),
          h('button', { class: 'btn', onclick: () => { state.view = 'newpack'; render(); } }, 'Build a pack by hand')),
        setupCard()
      ];
    }
    const tokens = P.tokenEstimate(P.preamble(p, state.marks));
    const review = state.marks.filter(needsReview);
    const accepted = state.marks.filter(m => m.decision === 'accepted');
    const recent = state.marks.slice().sort((a, b) => b.capturedAt - a.capturedAt).slice(0, 4);
    const stu = state.student || nextStudent();

    return [
      packSelect(),
      statusCard(p),
      h('div', { class: 'card' },
        h('div', { class: 'row pad', style: 'padding-bottom:6px' }, h('b', null, 'In this pack'), h('span', { class: 'mono small muted' }, '~' + tokens + ' tokens')),
        h('div', { class: 'line-row' }, h('span', null, 'Rubric'), h('span', { class: 'muted' }, p.rubric.length + ' criteria')),
        h('div', { class: 'line-row' }, h('span', null, 'Anchors'), h('span', { class: 'muted' }, String(p.anchors.length))),
        h('div', { class: 'line-row' }, h('span', null, 'Rulings'), h('span', { class: 'muted' }, String(p.rulings.length))),
        h('div', { class: 'line-row' }, h('span', null, 'Marked'), h('span', { class: 'muted' }, state.marks.length + ' captured'))),
      h('div', { class: 'btns' },
        h('button', { class: 'btn primary', onclick: () => insertText(P.preamble(p, state.marks)) }, 'Load pack'),
        h('button', { class: 'btn', onclick: () => { insertText(P.handoverPrompt(p)); state.handoverMode = 'handover'; state.view = 'handover'; render(); } }, 'Hand over')),
      h('div', { class: 'small muted' }, 'Both insert text into the composer. Nothing is sent until you press send.'),
      h('div', { class: 'col' },
        h('div', { class: 'label' }, 'Insert a prompt'),
        h('div', { class: 'btns' },
          h('input', { value: stu, 'aria-label': 'Student ID', class: 'mono', oninput: e => { state.student = e.target.value.trim(); } }),
          h('button', { class: 'btn', style: 'flex:none', onclick: () => insertText(P.markPrompt(state.student || stu)) }, 'Mark')),
        h('button', { class: 'qa', disabled: !review.length, onclick: () => insertText(P.moderatePrompt(p, review)) }, h('span', null, 'Moderate flagged marks'), h('span', { class: 'mono small muted' }, review.length + ' to check')),
        h('button', { class: 'qa', disabled: !accepted.length, onclick: () => insertText(P.commentsPrompt(p, accepted)) }, h('span', null, 'Draft report comments'), h('span', { class: 'mono small muted' }, accepted.length + ' accepted'))),
      recent.length ? h('div', { class: 'col' },
        h('div', { class: 'label' }, 'Recently captured'),
        recent.map(m => h('div', { class: 'row mono small' }, h('span', null, m.student), h('span', null, needsReview(m) ? h('span', { class: 'flag', style: 'margin-right:8px' }, 'flag') : null, m.total + ' / ' + (m.of || P.total(p)))))) : null,
      setupCard()
    ];
  }

  function setupCard() {
    return h('details', { class: 'card pad' },
      h('summary', null, 'Set up your Claude Project (once)'),
      h('div', { class: 'col' },
        h('div', { class: 'small muted' }, 'Paste this into the instructions of the Claude Project you mark in. It keeps replies in a format ' + MFBrand.name + ' can capture.'),
        h('pre', { class: 'copybox' }, P.PROJECT_INSTRUCTIONS),
        h('button', { class: 'btn small', onclick: () => copy(P.PROJECT_INSTRUCTIONS, 'Instructions copied.') }, 'Copy instructions')));
  }

  function newPackView() {
    const input = h('input', { 'aria-label': 'Pack name', placeholder: 'e.g. Y11 Database Task' });
    return [
      importCard(),
      h('div', { class: 'card pad col' },
        h('div', { class: 'label' }, 'Or build by hand'),
        h('label', null, 'Pack name', input),
        h('div', { class: 'btns' },
          h('button', { class: 'btn', onclick: () => { state.view = 'home'; render(); } }, 'Cancel'),
          h('button', {
            class: 'btn primary', onclick: async () => {
              const name = input.value.trim();
              if (!name) return toast('Give the pack a name.');
              const p = newPack(name);
              await savePack(p);
              await load();
              go('pack');
            }
          }, 'Create')))
    ];
  }

  function packView() {
    const p = pack(), d = state.draft;
    if (!p || !d) return [h('div', { class: 'muted' }, 'Create a pack first.')];

    const field = (label, el) => h('label', null, label, el);
    const reRender = () => render();

    return [
      h('div', { class: 'card pad col' },
        field('Name', h('input', { value: d.name, oninput: e => { d.name = e.target.value; } })),
        field('Task description', h('textarea', { value: d.task, oninput: e => { d.task = e.target.value; } })),
        field('Style for comments (optional)', h('textarea', { value: d.style, oninput: e => { d.style = e.target.value; }, placeholder: 'e.g. Australian English, specific, no jargon' }))),

      h('div', { class: 'card' },
        h('div', { class: 'row pad' }, h('span', { class: 'label' }, 'Rubric · total ' + d.rubric.reduce((a, c) => a + (Number(c.max) || 0), 0)),
          h('button', { class: 'link', onclick: () => { d.rubric.push({ id: 'C' + (d.rubric.length + 1), name: '', max: 5, descriptor: '' }); reRender(); } }, 'Add')),
        d.rubric.map((c, i) => h('div', { class: 'pad col', style: 'border-top:1px solid var(--line-soft)' },
          h('div', { class: 'btns' },
            field('ID', h('input', { value: c.id, class: 'mono', oninput: e => { c.id = e.target.value.trim(); } })),
            field('Max', h('input', { type: 'number', min: '1', value: String(c.max), oninput: e => { c.max = Number(e.target.value) || 0; } }))),
          field('Name', h('input', { value: c.name, oninput: e => { c.name = e.target.value; } })),
          field('What a good answer shows', h('textarea', { value: c.descriptor, oninput: e => { c.descriptor = e.target.value; } })),
          d.rubric.length > 1 ? h('button', { class: 'link danger', style: 'align-self:flex-start', onclick: () => { d.rubric.splice(i, 1); reRender(); } }, 'Remove criterion') : null))),

      h('div', { class: 'card' },
        h('div', { class: 'row pad' }, h('span', { class: 'label' }, 'Calibration anchors · ' + d.anchors.length),
          h('div', null,
            h('button', { class: 'link', onclick: startAnchors }, 'Import'),
            h('button', { class: 'link', onclick: () => { d.anchors.push({ id: 'A' + (d.anchors.length + 1), label: '', score: '', note: '' }); reRender(); } }, 'Add'))),
        d.anchors.map((a, i) => h('div', { class: 'pad col', style: 'border-top:1px solid var(--line-soft)' },
          h('div', { class: 'btns' },
            field('Label', h('input', { value: a.label, oninput: e => { a.label = e.target.value; } })),
            field('Total', h('input', { type: 'number', value: String(a.score), oninput: e => { a.score = e.target.value === '' ? '' : Number(e.target.value); } }))),
          field('Why it sits there', h('textarea', { value: a.note, oninput: e => { a.note = e.target.value; } })),
          h('button', { class: 'link danger', style: 'align-self:flex-start', onclick: () => { d.anchors.splice(i, 1); reRender(); } }, 'Remove anchor')))),

      h('div', { class: 'card' },
        h('div', { class: 'row pad' }, h('span', { class: 'label' }, 'Rulings · ' + d.rulings.length),
          h('button', { class: 'link', onclick: () => { d.rulings.push({ id: 'R' + (d.rulings.length + 1), text: '' }); reRender(); } }, 'Add')),
        d.rulings.map((r, i) => h('div', { class: 'pad col', style: 'border-top:1px solid var(--line-soft)' },
          h('textarea', { 'aria-label': 'Ruling ' + r.id, value: r.text, oninput: e => { r.text = e.target.value; } }),
          h('button', { class: 'link danger', style: 'align-self:flex-start', onclick: () => { d.rulings.splice(i, 1); reRender(); } }, 'Remove ' + r.id)))),

      h('div', { class: 'card pad col' },
        field('Marks included when loading a pack', h('select', { onchange: e => { d.settings.includeMarks = e.target.value; } },
          [['summary', 'Totals only'], ['full', 'Every criterion'], ['none', 'None']].map(([v, l]) => h('option', { value: v, selected: d.settings.includeMarks === v }, l))))),

      h('div', { class: 'btns' },
        h('button', { class: 'btn primary', onclick: async () => { await savePack(d); await load(); state.draft = JSON.parse(JSON.stringify(pack())); toast('Pack saved.'); } }, 'Save pack'),
        h('button', { class: 'btn', onclick: () => backup() }, 'Export backup'))
    ];
  }

  function backup() {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), packs: state.packs, marks: state.marks }, null, 2)], { type: 'application/json' });
    download(blob, MFBrand.slug + '-backup.json');
  }

  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function markbookView() {
    const p = pack();
    if (!p) return [h('div', { class: 'muted' }, 'Create a pack first.')];
    if (!state.marks.length) return [h('div', { class: 'card pad muted' }, 'No marks captured yet. Load the pack in a chat, ask for a mark, and the reply is saved here automatically.')];

    const sel = state.marks.find(m => m.student === state.sel);
    const ids = p.rubric.map(c => c.id);

    const table = h('div', { class: 'card', style: 'overflow:auto' },
      h('table', null,
        h('thead', null, h('tr', null, h('th', null, 'ID'), ids.map(id => h('th', null, id)), h('th', null, 'Total'), h('th', null, 'State'))),
        h('tbody', null, state.marks.map(m => h('tr', { class: m.student === state.sel ? 'sel' : '' },
          h('td', null, h('button', { onclick: () => { state.sel = m.student; render(); }, 'aria-label': 'Open ' + m.student }, m.student)),
          ids.map(id => h('td', { class: needsReview(m) && (m.confidence === 'low') ? 'cellflag' : '' }, h('button', { tabindex: '-1', 'aria-hidden': 'true', onclick: () => { state.sel = m.student; render(); } }, m.scores[id] == null ? '' : String(m.scores[id])))),
          h('td', null, h('button', { tabindex: '-1', 'aria-hidden': 'true', onclick: () => { state.sel = m.student; render(); } }, m.total + '/' + (m.of || P.total(p)))),
          h('td', { class: needsReview(m) ? 'cellflag' : '' }, h('button', { tabindex: '-1', 'aria-hidden': 'true', onclick: () => { state.sel = m.student; render(); } }, m.decision === 'accepted' ? (m.overridden ? 'edited' : 'ok') : (needsReview(m) ? 'flag' : '·'))))))));

    return [
      h('div', { class: 'row' },
        h('div', { class: 'small muted' }, state.marks.length + ' marked · ' + state.marks.filter(m => m.decision === 'accepted').length + ' accepted'),
        h('button', { class: 'btn small', onclick: () => download(new Blob([MFCsv.marksToCsv(p, state.marks)], { type: 'text/csv' }), (p.name.replace(/[^\w-]+/g, '_') || 'marks') + '.csv') }, 'Export CSV')),
      table,
      sel ? detail(p, sel) : h('div', { class: 'small muted' }, 'Select a student to review, edit and accept their mark.')
    ];
  }

  function detail(p, m) {
    const inputs = {};
    const comment = h('textarea', { 'aria-label': 'Comment', value: m.comment || '' });
    return h('div', { class: 'card pad col' },
      h('div', { class: 'row' }, h('b', null, m.student), h('span', { class: 'mono' }, m.total + ' / ' + (m.of || P.total(p)))),
      (m.flags && m.flags.length) || m.confidence === 'low' ? h('div', { class: 'notice' }, h('b', null, 'Check this one. '), (m.flags || []).join('; ') || 'Model reported low confidence.') : null,
      h('div', { class: 'label' }, 'Your decision'),
      h('div', { class: 'btns', style: 'flex-wrap:wrap' }, p.rubric.map(c => {
        const inp = h('input', { type: 'number', min: '0', max: String(c.max), value: String(m.scores[c.id] == null ? '' : m.scores[c.id]), 'aria-label': c.id + ' out of ' + c.max, class: 'mono' });
        inputs[c.id] = inp;
        return h('label', { style: 'min-width:64px' }, c.id + ' /' + c.max, inp);
      })),
      h('label', null, 'Comment (editable)', comment),
      m.history && m.history.length ? h('div', { class: 'small muted' }, 'Re-marked ' + m.history.length + ' time(s). Previous total ' + m.history[m.history.length - 1].total + '.') : null,
      h('button', {
        class: 'btn primary', onclick: async () => {
          const scores = {};
          for (const c of p.rubric) {
            const v = Number(inputs[c.id].value);
            if (!Number.isInteger(v) || v < 0 || v > c.max) return toast(c.id + ' must be a whole number from 0 to ' + c.max + '.');
            scores[c.id] = v;
          }
          const rec = Object.assign({}, m, {
            scores, total: Object.values(scores).reduce((a, b) => a + b, 0), comment: comment.value,
            overridden: JSON.stringify(scores) !== JSON.stringify(m.modelScores || m.scores), decision: 'accepted'
          });
          await MFDB.put('marks', rec); await load(); toast(m.student + ' accepted.');
        }
      }, m.decision === 'accepted' ? 'Update and accept' : 'Accept mark'));
  }

  function startImport() {
    insertText(P.importRubricPrompt());
    state.importDraft = null; state.view = 'import'; render();
  }

  function startAnchors() {
    insertText(P.importAnchorsPrompt(pack()));
    state.handoverMode = 'anchors'; state.view = 'handover'; render();
  }

  function importCard() {
    return h('div', { class: 'card pad col' },
      h('b', null, 'Import from your documents'),
      h('div', { class: 'small muted' }, 'Attach your task sheet and rubric (PDF or Word) to the chat. The reply is turned into a pack you review before saving.'),
      h('button', { class: 'btn primary', onclick: startImport }, 'Import rubric from files'));
  }

  function importView() {
    const pend = state.pendingImport;
    const steps = h('div', { class: 'card pad col' },
      h('b', null, 'Import rubric from your documents'),
      h('ol', { style: 'margin:0;padding-left:18px' },
        h('li', null, 'Attach your task sheet and rubric (PDF or Word) to the chat.'),
        h('li', null, 'Send the request that was just inserted into the composer.'),
        h('li', null, 'Review what was extracted below, fix anything, then save.')),
      h('button', { class: 'btn small', onclick: () => insertText(P.importRubricPrompt()) }, 'Insert the request again'));
    if (!pend) return [steps, h('div', { class: 'small muted' }, 'Waiting for the reply. It appears here automatically.')];

    if (!state.importDraft || state.importDraft.at !== pend.at) {
      state.importDraft = { at: pend.at, d: JSON.parse(JSON.stringify(pend.data.pack)), confirmed: false };
    }
    const id = state.importDraft, d = id.d;
    const sum = d.criteria.reduce((a, c) => a + (Number(c.max) || 0), 0);
    const mismatch = d.statedTotal == null
      ? 'The document total was not reported, so this total could not be cross-checked.'
      : (d.statedTotal !== sum ? 'Criteria add up to ' + sum + ' but the document states ' + d.statedTotal + '.' : null);
    const field = (label, el) => h('label', null, label, el);

    return [
      steps,
      h('div', { class: 'card pad col' },
        field('Pack name', h('input', { value: d.name, oninput: e => { d.name = e.target.value; } })),
        field('Task description', h('textarea', { value: d.task, oninput: e => { d.task = e.target.value; } }))),
      h('div', { class: 'card' },
        h('div', { class: 'row pad' }, h('span', { class: 'label' }, 'Criteria · ' + d.criteria.length),
          h('button', { class: 'link', onclick: () => { d.criteria.push({ id: 'C' + (d.criteria.length + 1), name: '', max: 5, descriptor: '' }); render(); } }, 'Add')),
        d.criteria.map((c, i) => h('div', { class: 'pad col', style: 'border-top:1px solid var(--line-soft)' },
          h('div', { class: 'btns' },
            field('ID', h('input', { value: c.id, class: 'mono', oninput: e => { c.id = e.target.value.trim(); } })),
            field('Max', h('input', { type: 'number', min: '1', value: String(c.max), onchange: e => { c.max = Number(e.target.value) || 0; render(); } }))),
          field('Name', h('input', { value: c.name, oninput: e => { c.name = e.target.value; } })),
          field('What a good answer shows', h('textarea', { value: c.descriptor, oninput: e => { c.descriptor = e.target.value; } })),
          d.criteria.length > 1 ? h('button', { class: 'link danger', style: 'align-self:flex-start', onclick: () => { d.criteria.splice(i, 1); render(); } }, 'Remove criterion') : null))),
      h('div', { class: mismatch ? 'notice' : 'status ok' },
        h('b', null, 'Total: ' + sum + (d.statedTotal != null ? ' (document states ' + d.statedTotal + ')' : '')),
        mismatch ? h('div', null, mismatch + ' Check it against your document.') : h('div', { class: 'small' }, 'Matches the total in your document.'),
        mismatch ? h('label', { style: 'flex-direction:row;align-items:flex-start;gap:10px;color:inherit;margin-top:8px' },
          h('input', { type: 'checkbox', checked: id.confirmed, style: 'width:20px;min-height:20px;margin-top:2px', onchange: e => { id.confirmed = e.target.checked; } }),
          'I have checked this against my document') : null),
      h('button', {
        class: 'btn primary', onclick: async () => {
          if (!d.name.trim()) return toast('Give the pack a name.');
          const chk = MFParse.validatePack({ criteria: d.criteria, statedTotal: d.statedTotal });
          if (chk.errors.length) return toast(chk.errors[0]);
          if (mismatch && !id.confirmed) return toast('Tick the box to confirm the total, or fix the marks.');
          const p = newPack(d.name.trim());
          p.task = d.task;
          p.rubric = d.criteria.map(c => ({ id: c.id, name: c.name, max: c.max, descriptor: c.descriptor || '' }));
          await savePack(p);
          await MFDB.setMeta('pendingImport', null);
          state.importDraft = null;
          await load();
          go('pack');
          toast('Pack created. Add anchors next if you have marked examples.');
        }
      }, 'Save as new pack'),
      h('button', { class: 'btn', onclick: async () => { await MFDB.setMeta('pendingImport', null); state.importDraft = null; await load(); } }, 'Discard')
    ];
  }

  function handoverView() {
    const p = pack();
    const pend = state.pending && p && state.pending.packId === p.id ? state.pending : null;
    if (!p) return [h('div', { class: 'muted' }, 'Create a pack first.')];

    const anchorsMode = state.handoverMode === 'anchors';
    const steps = h('div', { class: 'card pad col' },
      h('b', null, anchorsMode ? 'Import anchors from marked scripts' : 'Hand over this chat'),
      h('ol', { style: 'margin:0;padding-left:18px' },
        anchorsMode
          ? [h('li', null, 'Attach two or three scripts you have already marked. Put the student ID and total in each filename.'),
             h('li', null, 'Send the request that was just inserted into the composer.'),
             h('li', null, 'Review the anchors below and save the ones you want.')]
          : [h('li', null, 'Send the handover request that was just inserted into the composer.'),
             h('li', null, 'When Claude replies, review what was captured below.'),
             h('li', null, 'Save the items you want, open a new chat and load the pack.')]),
      h('button', { class: 'btn small', onclick: () => insertText(anchorsMode ? P.importAnchorsPrompt(p) : P.handoverPrompt(p)) }, 'Insert the request again'));

    if (!pend) return [steps, h('div', { class: 'small muted' }, 'Waiting for a handover reply. It appears here automatically.')];

    const d = pend.data;
    const keepR = d.rulings.map(() => true), keepA = d.anchors.map(() => true);
    const checks = (arr, keep, text, tag) => arr.map((x, i) => h('label', { style: 'flex-direction:row;align-items:flex-start;gap:10px;color:var(--ink)' },
      h('input', { type: 'checkbox', checked: true, style: 'width:20px;min-height:20px;margin-top:2px', onchange: e => { keep[i] = e.target.checked; } }),
      h('span', null, h('span', { class: 'label', style: 'display:block' }, tag), text(x))));

    return [
      steps,
      h('div', { class: 'card pad col' },
        h('div', { class: 'label' }, 'New from this chat'),
        checks(d.rulings, keepR, x => x, 'Ruling'),
        checks(d.anchors, keepA, a => (a.student || 'Exemplar') + (a.score !== '' && a.score != null ? ' (' + a.score + ')' : '') + ': ' + a.note, 'Anchor'),
        !d.rulings.length && !d.anchors.length ? h('div', { class: 'muted' }, 'Nothing new was reported.') : null),
      h('div', { class: 'notice' }, 'Summaries are written by the model. Check each ruling reads the way you meant it before saving.'),
      h('button', {
        class: 'btn primary', onclick: async () => {
          const np = JSON.parse(JSON.stringify(p));
          d.rulings.forEach((t, i) => { if (keepR[i]) np.rulings.push({ id: 'R' + (np.rulings.length + 1), text: t }); });
          d.anchors.forEach((a, i) => { if (keepA[i]) np.anchors.push({ id: 'A' + (np.anchors.length + 1), label: a.student || 'Exemplar', score: a.score == null ? '' : a.score, note: a.note }); });
          np.version = (np.version || 1) + 1;
          await savePack(np);
          await MFDB.setMeta('pendingHandover', null);
          await load();
          state.view = 'home'; render();
          if (!anchorsMode) await insertText(P.preamble(pack(), state.marks));
        }
      }, 'Save selected and insert new-chat prompt'),
      h('button', { class: 'btn', onclick: async () => { await MFDB.setMeta('pendingHandover', null); await load(); } }, 'Discard')
    ];
  }

  // ---------- render ----------
  function render() {
    const views = { home: homeView, pack: packView, markbook: markbookView, handover: handoverView, newpack: newPackView, import: importView };
    const body = (views[state.view] || homeView)();
    const p = pack();
    root.replaceChildren(
      header(), navbar(),
      h('main', null, body, state.toast ? h('div', { class: 'toast', role: 'status' }, state.toast) : null),
      h('footer', null, h('span', null, 'On this device only'), h('span', null, p ? p.id + ' v' + (p.version || 1) : ''))
    );
  }

  chrome.runtime.onMessage.addListener(msg => { if (msg && msg.type === 'DB_CHANGED') load(); });
  chrome.tabs.onActivated.addListener(async () => { await refreshTab(); render(); });
  chrome.tabs.onUpdated.addListener(async (_id, info) => { if (info.url || info.status === 'complete') { await refreshTab(); render(); } });

  load();
})();
