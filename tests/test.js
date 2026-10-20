// Run with: node tests/test.js   (no dependencies)
const assert = require('assert');
const MFBrand = require('../lib/brand.js');
const MFParse = require('../lib/parse.js');
const MFCsv = require('../lib/csv.js');
const MFPrompts = require('../lib/prompts.js');

const rubric = [
  { id: 'C1', name: 'Schema', max: 5 }, { id: 'C2', name: 'Queries', max: 5 },
  { id: 'C3', name: 'Justification', max: 5 }, { id: 'C4', name: 'Docs', max: 5 }
];
const pack = { id: 'pk_abc123', name: 'Y11 DB', task: 'Design a library DB.', style: '', rubric, anchors: [{ id: 'A1', label: 'Strong', score: 18, note: 'keys justified' }], rulings: [{ id: 'R1', text: 'Surrogate keys are fine.' }], settings: { includeMarks: 'summary' } };
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

t('captures a valid mark from prose plus a fenced block', () => {
  const msg = 'S08 uses a normalised schema.\n```' + MFBrand.block + '\n{ "pack":"pk_abc123","student":"S08","scores":{"C1":4,"C2":3,"C3":4,"C4":3},"total":14,"confidence":"med","flags":["C3 between A2 and A3"],"comment":"Good joins." }\n```\nLet me know.';
  const r = MFParse.extract(msg, rubric);
  assert.strictEqual(r.marks.length, 1);
  assert.strictEqual(r.marks[0].total, 14);
  assert.strictEqual(r.marks[0].of, 20);
  assert.deepStrictEqual(r.marks[0].flags, ['C3 between A2 and A3']);
  assert.strictEqual(r.invalid.length, 0);
});

t('rejects a total that does not equal the sum', () => {
  const r = MFParse.extract('{"student":"S01","scores":{"C1":4,"C2":3,"C3":4,"C4":3},"total":15}', rubric);
  assert.strictEqual(r.marks.length, 0);
  assert.ok(/does not equal sum 14/.test(r.invalid[0].errors.join()));
});

t('rejects scores above the criterion max, missing criteria and non-integers', () => {
  let r = MFParse.extract('{"student":"S01","scores":{"C1":6,"C2":3,"C3":4,"C4":3}}', rubric);
  assert.ok(r.invalid[0].errors.some(e => /exceeds max 5/.test(e)));
  r = MFParse.extract('{"student":"S01","scores":{"C1":4,"C2":3,"C3":4}}', rubric);
  assert.ok(r.invalid[0].errors.some(e => /C4: missing/.test(e)));
  r = MFParse.extract('{"student":"S01","scores":{"C1":4.5,"C2":3,"C3":4,"C4":3}}', rubric);
  assert.ok(r.invalid[0].errors.some(e => /whole number/.test(e)));
});

t('rejects a student name instead of an ID', () => {
  const r = MFParse.extract('{"student":"Jamie Lee","scores":{"C1":1,"C2":1,"C3":1,"C4":1}}', rubric);
  assert.strictEqual(r.marks.length, 0);
  assert.ok(/short ID/.test(r.invalid[0].errors[0]));
});

t('ignores braces inside JSON strings', () => {
  const r = MFParse.extract('{"student":"S02","scores":{"C1":1,"C2":1,"C3":1,"C4":1},"comment":"uses { and } in text"}', rubric);
  assert.strictEqual(r.marks.length, 1);
});

t('detects the READY handshake', () => {
  const r = MFParse.extract('READY pk_abc123 1', rubric);
  assert.deepStrictEqual(r.ready, [{ packId: 'pk_abc123', protocol: 1 }]);
});

t('parses a handover block', () => {
  const r = MFParse.extract('```' + MFBrand.handoverBlock + '\n{"pack":"pk_abc123","rulings":["Accept composite keys if justified."],"anchors":[{"student":"S06","note":"strong C2"}],"notes":[]}\n```', rubric);
  assert.strictEqual(r.handovers.length, 1);
  assert.strictEqual(r.handovers[0].rulings.length, 1);
  assert.strictEqual(r.handovers[0].anchors[0].student, 'S06');
});

t('ordinary text produces nothing', () => {
  const r = MFParse.extract('Here is a normal reply with no blocks.', rubric);
  assert.deepStrictEqual([r.marks.length, r.invalid.length, r.handovers.length, r.ready.length], [0, 0, 0, 0]);
});

t('csv escapes quotes and neutralises formulas', () => {
  const csv = MFCsv.marksToCsv(pack, [{ student: 'S01', scores: { C1: 4, C2: 3, C3: 4, C4: 3 }, total: 14, of: 20, decision: 'accepted', overridden: false, flags: [], comment: '=HYPERLINK("x") and "quoted", text' }]);
  const lines = csv.trim().split('\r\n');
  assert.strictEqual(lines[0], 'Student,C1,C2,C3,C4,Total,Of,Status,Edited,Flags,Comment');
  assert.ok(lines[1].includes("\"'=HYPERLINK(\"\"x\"\") and \"\"quoted\"\", text\""));
});

t('preamble is deterministic and carries the handshake', () => {
  const marks = [{ student: 'S01', scores: { C1: 5, C2: 4, C3: 4, C4: 5 }, total: 18, of: 20 }];
  const a = MFPrompts.preamble(pack, marks), b = MFPrompts.preamble(pack, marks);
  assert.strictEqual(a, b);
  assert.ok(a.startsWith(MFBrand.tag + ' PACK pk_abc123'));
  assert.ok(a.includes('S01 18/20'));
  assert.ok(a.trim().endsWith('Reply only with: READY pk_abc123 ' + MFPrompts.PROTOCOL));
});

t('the format example inside the preamble round-trips through the parser', () => {
  const a = MFPrompts.preamble(pack, []);
  const example = a.split('\n').find(l => l.startsWith('{"pack"'));
  const r = MFParse.extract(example, rubric);
  assert.strictEqual(r.invalid.length, 0);
  assert.strictEqual(r.marks.length, 1);
});

t('captures a rubric import and cross-checks the stated total', () => {
  const ok = MFParse.extract('```mark-pack\n{"name":"DB Task","task":"Design a DB","statedTotal":20,"criteria":[{"id":"C1","name":"Schema","max":10,"descriptor":"a"},{"id":"C2","name":"Queries","max":10,"descriptor":"b"}]}\n```', null);
  assert.strictEqual(ok.imports.length, 1);
  assert.strictEqual(ok.imports[0].pack.criteria.length, 2);
  assert.deepStrictEqual(MFParse.validatePack(ok.imports[0].pack).warnings, []);
  const bad = MFParse.validatePack({ statedTotal: 25, criteria: [{ id: 'C1', name: 'A', max: 10 }, { id: 'C2', name: 'B', max: 10 }] });
  assert.ok(/add up to 20 but the document states 25/.test(bad.warnings[0]));
  const none = MFParse.validatePack({ statedTotal: null, criteria: [{ id: 'C1', name: 'A', max: 5 }] });
  assert.ok(/could not be cross-checked/.test(none.warnings[0]));
});

t('rejects a rubric with duplicate ids, empty names or bad maxes', () => {
  const r = MFParse.extract('{"criteria":[{"id":"C1","name":"A","max":5},{"id":"C1","name":"","max":0}]}', null);
  assert.strictEqual(r.imports.length, 0);
  const e = r.invalid[0].errors.join('|');
  assert.ok(/duplicate id C1/.test(e) && /name missing/.test(e) && /max must be/.test(e));
});

t('import prompts embed the block labels and their examples parse', () => {
  const rp = MFPrompts.importRubricPrompt();
  assert.ok(rp.includes('labelled ' + MFBrand.packBlock));
  const r = MFParse.extract(rp.split('\n').find(l => l.startsWith('{"name"')), null);
  assert.strictEqual(r.imports.length, 1);
  const ap = MFPrompts.importAnchorsPrompt(pack);
  const h = MFParse.extract(ap.split('\n').find(l => l.startsWith('{"pack"')), rubric);
  assert.strictEqual(h.handovers[0].anchors[0].score, 17);
});

console.log('\n' + n + ' tests passed');
