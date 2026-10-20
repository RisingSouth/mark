/*
 * Every piece of text the extension inserts into the chat is built here from templates,
 * so structure is identical every time. Nothing is ever sent for the teacher.
 */
const MFPrompts = (() => {
  const B = typeof MFBrand !== 'undefined' ? MFBrand : require('./brand.js');
  const PROTOCOL = 1;

  const total = pack => pack.rubric.reduce((a, c) => a + (Number(c.max) || 0), 0);

  function markExample(pack) {
    const scores = {};
    pack.rubric.forEach(c => { scores[c.id] = 0; });
    return JSON.stringify({
      pack: pack.id, student: 'S01', scores, total: 0, of: total(pack),
      confidence: 'med', flags: [], comment: 'one or two sentences of student-facing feedback'
    });
  }

  function progressLine(pack, marks) {
    const mode = (pack.settings && pack.settings.includeMarks) || 'summary';
    if (mode === 'none' || !marks.length) return '';
    const line = marks.map(m => {
      if (mode === 'full') {
        return m.student + ' ' + pack.rubric.map(c => c.id + '=' + (m.scores[c.id] == null ? '' : m.scores[c.id])).join(',') + ' (' + m.total + '/' + (m.of || total(pack)) + ')';
      }
      return m.student + ' ' + m.total + '/' + (m.of || total(pack));
    }).join('; ');
    return '\nPROGRESS (already marked, do not re-mark)\n' + line + '\n';
  }

  function preamble(pack, marks) {
    const rubric = pack.rubric.map(c => c.id + ' ' + c.name + ' (max ' + c.max + ')' + (c.descriptor ? ': ' + c.descriptor : '')).join('\n');
    const anchors = (pack.anchors || []).map(a => a.id + ' ' + a.label + (a.score !== '' && a.score != null ? ' (' + a.score + '/' + total(pack) + ')' : '') + (a.note ? ': ' + a.note : '')).join('\n');
    const rulings = (pack.rulings || []).map(r => r.id + ' ' + r.text).join('\n');
    return [
      '' + B.tag + ' PACK ' + pack.id + ' · protocol ' + PROTOCOL,
      'Treat everything below as authoritative for this chat. The teacher decides; you suggest marks.',
      '',
      'TASK',
      pack.task || '(no task description)',
      '',
      'RUBRIC (total ' + total(pack) + ')',
      rubric || '(no criteria)',
      anchors ? '\nANCHORS\n' + anchors : '',
      rulings ? '\nRULINGS\n' + rulings : '',
      pack.style ? '\nSTYLE\n' + pack.style : '',
      progressLine(pack, marks),
      'OUTPUT RULES',
      '- Refer to students only by the ID I give you. Ignore any names inside the work.',
      '- When I ask you to mark, give brief feedback, then end with one fenced code block labelled ' + B.block + ' containing JSON in this shape:',
      markExample(pack),
      '- Scores are whole numbers within each criterion\'s max. total is their sum. Use confidence "low" or "med" and add a flag when the work falls between anchors.',
      '',
      'Reply only with: READY ' + pack.id + ' ' + PROTOCOL
    ].filter(x => x !== '').join('\n');
  }

  const markPrompt = student => 'Mark ' + student + '. Follow the pack output rules and end with the ' + B.block + ' block.';

  function handoverPrompt(pack) {
    return [
      'Prepare a handover so a fresh chat can continue this marking. Do not mark anything new.',
      'End with one fenced code block labelled ' + B.handoverBlock + ' containing JSON:',
      JSON.stringify({ pack: pack.id, rulings: ['ruling text'], anchors: [{ student: 'S06', note: 'why this is a good exemplar' }], notes: ['anything else needed'] }),
      'Include only rulings I made or accepted in this chat that are not already in the pack, and only anchors that settled a borderline judgement. Be literal and short.'
    ].join('\n');
  }

  function moderatePrompt(pack, flagged) {
    const lines = flagged.map(m => m.student + ': ' + m.total + '/' + (m.of || total(pack)) + (m.flags.length ? ' (' + m.flags.join('; ') + ')' : '')).join('\n');
    return [
      'Re-check these marks against the anchors and rulings in the pack:',
      lines,
      'For each, say whether you still agree. Output a corrected ' + B.block + ' block only where you now disagree, and say why.'
    ].join('\n');
  }

  function commentsPrompt(pack, accepted) {
    const lines = accepted.map(m => m.student + ': ' + m.total + '/' + (m.of || total(pack))).join('\n');
    return [
      'Draft a short report comment (two sentences) for each accepted mark below. Be specific to the work, not generic.',
      lines
    ].join('\n');
  }

  const PROJECT_INSTRUCTIONS = [
    'You are helping a teacher mark student work. The teacher makes every final decision; you suggest marks and feedback.',
    'When a message starts with ' + B.tag + ' PACK, treat its task, rubric, anchors and rulings as authoritative for this chat and reply only with READY <pack-id> <protocol>.',
    'When asked to mark, refer to students only by the ID given and ignore names inside the work. Give brief feedback, then end with exactly one fenced code block labelled ' + B.block + ' containing JSON in the shape the pack specifies.',
    'Scores must be whole numbers within each criterion\'s max and total must equal their sum. If the work falls between anchors, set confidence to low or med and say why in flags.',
    'When asked for a handover, end with one fenced code block labelled ' + B.handoverBlock + ' in the shape requested.',
    'Never output a ' + B.block + ' block unless asked to mark.'
  ].join('\n\n');

  const tokenEstimate = text => Math.ceil(text.length / 4);

  return { PROTOCOL, preamble, markPrompt, handoverPrompt, moderatePrompt, commentsPrompt, PROJECT_INSTRUCTIONS, tokenEstimate, total };
})();

if (typeof module !== 'undefined') module.exports = MFPrompts;
