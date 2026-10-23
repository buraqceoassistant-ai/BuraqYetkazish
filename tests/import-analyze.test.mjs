// Разбор документа (analyze): части → ответы ИИ → черновик; повтор с делением при обрезанном ответе; сопоставление.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { manifestXlsx, ROWS, CLIENTS } from './fixtures/manifest.mjs';
import { fakeAi } from './fake-ai.mjs';
const require = createRequire(import.meta.url);
globalThis.window = globalThis;
require('../js/xlsx-io.js');
const L = require('../js/import-core.js');
const X = globalThis.XlsxIO;
const opts = (extra) => ({ fileName: 'manifest.xlsx', clients: CLIENTS, draftId: 'd1', today: '2026-09-25', wait: async () => {}, ...extra });

test('манифест целиком: шапка, итог, строки, маркировки кодом — без вызова сопоставления', async () => {
  const book = await X.readGrid(manifestXlsx()), log = [];
  const d = await L.analyze(opts({ doc: { kind: 'xlsx', book }, ai: fakeAi({ log }) }));
  assert.equal(log.length, 1);                          // все маркировки узнаны кодом — ИИ для сопоставления не нужен
  assert.equal(log[0].meta.step, 'разбор'); assert.equal(log[0].meta.draft, 'd1'); assert.equal(log[0].meta.part, '1/1');
  assert.equal(d.meta.date, '2026-09-20'); assert.equal(d.journalDate, '2026-09-20'); assert.match(d.meta.route, /HORGOS/); assert.equal(d.meta.header.row, 4); assert.equal(d.meta.total.row, 15);
  assert.equal(d.rows.length, ROWS.length); assert.deepEqual(d.rows.map(r => r.src.row), [5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  assert.equal(d.rows[3].mark, 'BL-903'); assert.deepEqual(d.rows[3].ai, { mark: 'BL-903', places: 5, cbm: 0.3, kg: 61 });
  const M = d.marks;
  assert.deepEqual(Object.keys(M).sort(), ['ALFA', 'BL00', 'BL901', 'BL902', 'BL903', 'BL905', 'CBETA']);
  assert.deepEqual([M.CBETA.client, M.CBETA.by, M.CBETA.decided], ['BL-906', 'brand', true]);
  assert.deepEqual([M.BL00.client, M.BL00.by, M.BL00.decided], [null, 'unknown-owner', true]);
  assert.equal(d.usage.in, 1000); assert.equal(d.calls.length, 1); assert.equal(d.model, 'claude-sonnet-5');
});

test('неизвестная маркировка — предложение ИИ (не решение), выдуманный клиент отбрасывается', async () => {
  const rows = [...ROWS, ['NEWBRAND', 4, 0.8, 120], ['GHOST', 2, 0.2, 30]], log = [];
  const book = await X.readGrid(manifestXlsx({ rows }));
  const d = await L.analyze(opts({ doc: { kind: 'xlsx', book }, ai: fakeAi({ log, matches: { NEWBRAND: 'BL-907', GHOST: 'BL-777' } }) }));
  assert.equal(log.length, 2); assert.equal(log[1].schema.name, 'match_marks'); assert.equal(log[1].meta.step, 'сопоставление');
  assert.match(log[1].content[0].text, /<marks>\nNEWBRAND\nGHOST\n<\/marks>/);
  assert.deepEqual([d.marks.NEWBRAND.decided, d.marks.NEWBRAND.client, d.marks.NEWBRAND.suggest.client], [false, null, 'BL-907']);
  assert.equal(d.marks.GHOST.suggest, null);             // BL-777 нет в справочнике
  assert.deepEqual([d.marks.GHOST.decided, d.marks.GHOST.isNew, d.marks.GHOST.client, d.marks.GHOST.by], [true, true, '', 'new']);   // не узнал никто — новый клиент, BL впишут
  assert.match(d.summary, /\{marks\}/);
});

test('без ИИ: незнакомая маркировка — новый клиент; BL из маркировки, если он там есть', async () => {
  const rows = [...ROWS, ['BL-03 KARA CHICKEN', 4, 0.8, 120], ['BLOOD GREY', 2, 0.2, 30]];
  const book = await X.readGrid(manifestXlsx({ rows }));
  const d = await L.analyze(opts({ doc: { kind: 'xlsx', book }, ai: fakeAi({}) }));
  const K = d.marks[L.key('BL-03 KARA CHICKEN')], B = d.marks[L.key('BLOOD GREY')];
  assert.deepEqual([K.decided, K.isNew, K.client], [true, true, 'BL-03']);
  assert.deepEqual([B.decided, B.isNew, B.client], [true, true, '']);
  assert.equal(d.marks.ALFA.isNew, undefined);           // узнанные кодом — как раньше
});

test('ответ не поместился — часть делится пополам и разбирается заново; порядок строк сохраняется', async () => {
  const rows = Array.from({ length: 200 }, (_, i) => ['BL-' + (1000 + i), 1 + (i % 9), +(0.5 + i / 100).toFixed(3), 100 + i]);
  const book = await X.readGrid(manifestXlsx({ rows })), log = [], seen = new Set();
  const ai = fakeAi({ log, hooks: { before: req => { const m = req.content[0].text.match(/только из R(\d+)–R(\d+)/); if (m && +m[2] - +m[1] > 40 && !seen.has(m[0])) { seen.add(m[0]); return { error: 'Ответ ИИ не поместился', code: 'truncated', ms: 900 }; } } } });
  const prog = [];
  const d = await L.analyze(opts({ doc: { kind: 'xlsx', book }, ai, onProgress: p => prog.push(p) }));
  assert.equal(d.rows.length, 200); assert.deepEqual(d.rows.map(r => r.mark), rows.map(r => r[0]));
  const ext = d.calls.filter(c => c.part !== 'клиенты');
  assert.equal(ext.filter(c => !c.ok).length, 3); assert.equal(ext.filter(c => c.ok).length, 6);
  assert.ok(d.calls.some(c => /^\d\.\d\/3$/.test(c.part)));   // половинки частей: «1.0/3», «1.1/3»
  assert.equal(prog[prog.length - 1].done, 6); assert.equal(d.meta.total.places, rows.reduce((a, r) => a + r[1], 0));
});

test('перегрузка API — один повтор той же части; ошибка ключа или секрета — сразу ошибка с текстом', async () => {
  const book = await X.readGrid(manifestXlsx()); let n = 0;
  const d = await L.analyze(opts({ doc: { kind: 'xlsx', book }, ai: fakeAi({ hooks: { before: () => (++n === 1 ? { error: 'перегружен', code: 'http529' } : null) } }) }));
  assert.equal(d.rows.length, ROWS.length); assert.equal(n, 2);
  await assert.rejects(L.analyze(opts({ doc: { kind: 'xlsx', book }, ai: async () => ({ error: 'ИИ-импорт доступен только руководителю', code: 'editor' }) })), e => e.code === 'editor' && /руководителю/.test(e.message));
});

test('PDF по частям (12 страниц → 3 вызова), строки по страницам', async () => {
  const log = [];
  const d = await L.analyze(opts({ fileName: 'm.pdf', doc: { kind: 'pdf', pages: 12, base64: 'JVBERi0x' }, ai: fakeAi({ log }) }));
  assert.equal(log.filter(r => r.schema.name === 'manifest_rows').length, 3);
  assert.equal(d.rows.length, 12); assert.deepEqual(d.rows.map(r => r.src.page), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.equal(d.meta.route, 'PDF ROUTE');
});
