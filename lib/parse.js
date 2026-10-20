/*
 * Mark parser. Pure functions, no DOM, no chrome.* APIs.
 * Loaded as a classic script in the extension and via require() in Node tests.
 *
 * Principle: deterministic checks over model self-report. A block is only saved if it
 * passes every check below; otherwise the teacher is told why.
 */
const MFParse = (() => {
  const ID_RE = /^[A-Za-z0-9_-]{1,24}$/;

  // Find top-level {...} spans in free text, respecting JSON strings.
  function balancedObjects(text) {
    const out = [];
    let depth = 0, start = -1, inStr = false, esc = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') { if (depth > 0) inStr = true; continue; }
      if (c === '{') { if (depth === 0) start = i; depth++; }
      else if (c === '}' && depth > 0) {
        depth--;
        if (depth === 0) out.push(text.slice(start, i + 1));
      }
    }
    return out;
  }

  function tryParse(s) { try { return JSON.parse(s); } catch (e) { return null; } }

  function rubricTotal(rubric) {
    return (rubric || []).reduce((a, c) => a + (Number(c.max) || 0), 0);
  }

  function validateMark(o, rubric) {
    const errors = [];
    let sum = 0;
    if (typeof o.student !== 'string' || !ID_RE.test(o.student)) {
      errors.push('student must be a short ID (no names or spaces)');
    }
    const scores = o.scores;
    if (!scores || typeof scores !== 'object' || Array.isArray(scores)) {
      errors.push('scores missing');
    } else {
      const keys = Object.keys(scores);
      if (!keys.length) errors.push('scores empty');
      for (const k of keys) {
        const v = scores[k];
        if (!Number.isInteger(v)) { errors.push(k + ': must be a whole number'); continue; }
        sum += v;
        if (v < 0) errors.push(k + ': negative');
        if (rubric && rubric.length) {
          const c = rubric.find(r => r.id === k);
          if (!c) errors.push(k + ': not in rubric');
          else if (v > c.max) errors.push(k + ': ' + v + ' exceeds max ' + c.max);
        }
      }
      if (rubric && rubric.length) {
        for (const c of rubric) if (!(c.id in scores)) errors.push(c.id + ': missing');
      }
    }
    if (o.total !== undefined && Number.isFinite(o.total) && o.total !== sum) {
      errors.push('total ' + o.total + ' does not equal sum ' + sum);
    }
    return { errors, sum };
  }

  const clip = (s, n) => String(s == null ? '' : s).slice(0, n);

  function normalizeMark(o, sum, rubric) {
    const conf = ['low', 'med', 'high'].includes(o.confidence) ? o.confidence : 'med';
    return {
      student: o.student,
      scores: Object.assign({}, o.scores),
      total: sum,
      of: rubricTotal(rubric) || (Number.isFinite(o.of) ? o.of : null),
      confidence: conf,
      flags: Array.isArray(o.flags) ? o.flags.slice(0, 10).map(f => clip(f, 200)) : [],
      comment: clip(o.comment, 2000)
    };
  }

  function normalizeHandover(o) {
    const strs = (a, n, len) => (Array.isArray(a) ? a : []).filter(x => typeof x === 'string').slice(0, n).map(x => clip(x, len));
    const anchors = (Array.isArray(o.anchors) ? o.anchors : [])
      .filter(a => a && typeof a === 'object')
      .slice(0, 10)
      .map(a => ({ student: clip(a.student, 24), note: clip(a.note, 300), score: Number.isInteger(a.score) ? a.score : '' }));
    return { pack: clip(o.pack, 40), rulings: strs(o.rulings, 20, 300), anchors, notes: strs(o.notes, 10, 300) };
  }

  function normalizePack(o) {
    return {
      name: clip(o.name, 80),
      task: clip(o.task, 1000),
      statedTotal: Number.isInteger(o.statedTotal) ? o.statedTotal : null,
      criteria: o.criteria.map(c => ({ id: c.id, name: clip(c.name, 80), max: c.max, descriptor: clip(c.descriptor, 600) }))
    };
  }

  // Structural problems block saving. A total that disagrees with the document is a warning the teacher must confirm.
  function validatePack(o) {
    const errors = [], warnings = [];
    const cr = Array.isArray(o.criteria) ? o.criteria : null;
    if (!cr || !cr.length) errors.push('no criteria found');
    else if (cr.length > 20) errors.push('more than 20 criteria');
    else {
      const seen = new Set();
      cr.forEach((c, i) => {
        const w = 'criterion ' + (i + 1);
        if (!c || typeof c !== 'object') { errors.push(w + ': not an object'); return; }
        if (typeof c.id !== 'string' || !/^[A-Za-z0-9_-]{1,12}$/.test(c.id)) errors.push(w + ': bad id');
        else if (seen.has(c.id)) errors.push(w + ': duplicate id ' + c.id);
        else seen.add(c.id);
        if (typeof c.name !== 'string' || !c.name.trim()) errors.push(w + ': name missing');
        if (!Number.isInteger(c.max) || c.max < 1 || c.max > 100) errors.push(w + ': max must be a whole number from 1 to 100');
      });
    }
    if (!errors.length) {
      const sum = rubricTotal(cr);
      if (o.statedTotal == null) warnings.push('The document total was not reported, so the sum of ' + sum + ' could not be cross-checked.');
      else if (o.statedTotal !== sum) warnings.push('Criteria add up to ' + sum + ' but the document states ' + o.statedTotal + '.');
    }
    return { errors, warnings };
  }

  // text: the plain text of one assistant message. rubric: the active pack's rubric (optional).
  function extract(text, rubric) {
    const result = { marks: [], handovers: [], imports: [], invalid: [], ready: [] };
    for (const raw of balancedObjects(text || '')) {
      const o = tryParse(raw);
      if (!o || typeof o !== 'object' || Array.isArray(o)) continue;
      if (o.scores !== undefined || o.student !== undefined) {
        const { errors, sum } = validateMark(o, rubric);
        if (errors.length) result.invalid.push({ student: typeof o.student === 'string' ? clip(o.student, 24) : '?', errors });
        else result.marks.push(normalizeMark(o, sum, rubric));
      } else if (Array.isArray(o.criteria)) {
        const { errors } = validatePack(o);
        if (errors.length) result.invalid.push({ student: 'rubric', errors });
        else result.imports.push({ pack: normalizePack(o) });
      } else if (Array.isArray(o.rulings) || Array.isArray(o.anchors)) {
        result.handovers.push(normalizeHandover(o));
      }
    }
    const re = /READY\s+(pk_[a-z0-9]+)\s+(\d+)/gi;
    let m;
    while ((m = re.exec(text || ''))) result.ready.push({ packId: m[1].toLowerCase(), protocol: Number(m[2]) });
    return result;
  }

  return { extract, validateMark, validatePack, normalizePack, balancedObjects, rubricTotal };
})();

if (typeof module !== 'undefined') module.exports = MFParse;
