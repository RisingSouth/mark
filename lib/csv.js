/* CSV export. Cells starting with = + - @ are prefixed so spreadsheets never run model-written text as a formula. */
const MFCsv = (() => {
  function cell(v) {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function marksToCsv(pack, marks) {
    const ids = pack.rubric.map(c => c.id);
    const header = ['Student'].concat(ids, ['Total', 'Of', 'Status', 'Edited', 'Flags', 'Comment']);
    const rows = marks.map(m => [m.student]
      .concat(ids.map(id => (m.scores[id] == null ? '' : m.scores[id])))
      .concat([m.total, m.of == null ? '' : m.of, m.decision, m.overridden ? 'yes' : 'no', (m.flags || []).join('; '), m.comment || '']));
    return [header].concat(rows).map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
  }

  return { marksToCsv, cell };
})();

if (typeof module !== 'undefined') module.exports = MFCsv;
