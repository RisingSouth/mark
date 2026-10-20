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

  function importRubricPrompt() {
    const example = JSON.stringify({
      name: 'assessment name', task: 'one or two sentences describing the task', statedTotal: 20,
      criteria: [{ id: 'C1', name: 'criterion name', max: 5, descriptor: 'what a top-band answer shows, plus the main level boundaries' }]
    });
    return [
      "I'm attaching my task sheet and marking rubric. Read them and extract the rubric.",
      'End with one fenced code block labelled ' + B.packBlock + ' containing JSON in this shape:',
      example,
      'Rules:',
      '- One entry per marked criterion, in document order, with ids C1, C2, and so on.',
      '- max is the most marks available for that criterion, as a whole number.',
      '- statedTotal is the total marks the document itself states for the whole task, or null if it states none. Do not work it out yourself.',
      '- Do not invent criteria or marks the document does not contain. If something is unclear, say so in your reply.',
      '',
      'Two layouts to tell apart:',
      '- Marks per criterion, e.g. "Schema design: 0-5 marks" becomes one criterion with max 5.',
      '- Level bands across columns, e.g. a row "Justification" with levels Excellent 9-10, Good 6-8, Basic 3-5, Limited 0-2 is ONE criterion with max 10, and the four levels go inside its descriptor. Levels are never separate criteria.'
    ].join('\n');
  }

  function importAnchorsPrompt(pack) {
    const example = JSON.stringify({ pack: pack.id, rulings: [], anchors: [{ student: 'S06', score: 17, note: 'why it sits at this mark, citing rubric criteria' }], notes: [] });
    return [
      "I'm attaching marked example scripts. Each filename or label gives the student ID and the total mark. Use them as calibration anchors for this pack.",
      'End with one fenced code block labelled ' + B.handoverBlock + ' containing JSON:',
      example,
      'Use only the marks I gave you and do not re-mark them. Keep each note under 40 words.'
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

  return { PROTOCOL, importRubricPrompt, importAnchorsPrompt, preamble, markPrompt, handoverPrompt, moderatePrompt, commentsPrompt, PROJECT_INSTRUCTIONS, tokenEstimate, total };
})();

if (typeof module !== 'undefined') module.exports = MFPrompts;
