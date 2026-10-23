// Этап 2 ИИ-импорта: чтение книги Excel, текст для ИИ, части, схемы, сборка ответов, сопоставление маркировок кодом.
// Манифест — обезличенный, собирается в памяти (tests/fixtures/manifest.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { manifestXlsx, ROWS, DATE, ROUTE, TOTAL, CLIENTS } from './fixtures/manifest.mjs';
const require = createRequire(import.meta.url);
globalThis.window = globalThis;
require('../js/xlsx-io.js');
const L = require('../js/import-core.js');
const X = globalThis.XlsxIO;

test('readGrid: лист, дата по формату ячейки, объединённые ячейки, сохранённые итоги формул', async () => {
  const book = await X.readGrid(manifestXlsx());
  assert.equal(book.length, 1); const sh = book[0];
  assert.equal(sh.name, 'Manifest');
  assert.equal(sh.rows[2].B, DATE);                 // число с форматом даты → YYYY-MM-DD
  assert.equal(sh.rows[3].B, ROUTE);
  assert.equal(sh.rows[4].B, 'CTN/件数');
  assert.deepEqual(sh.merges, ['A7:A8', 'A12:A14']);
  assert.equal(sh.rows[8].A, undefined); assert.equal(L.cellOf(sh, 8, 'A'), 'BL-903');   // значение объединённой ячейки
  const last = Math.max(...Object.keys(sh.rows).map(Number));
  assert.equal(sh.rows[last].A, 'TOTAL'); assert.equal(sh.rows[last].B, TOTAL.places); assert.equal(sh.rows[last].D, TOTAL.kg);
});

test('текст для ИИ: номера строк и столбцы, объединённая маркировка помечена ↑', async () => {
  const book = await X.readGrid(manifestXlsx());
  const t = L.excelText(book, { all: true }, 'manifest.xlsx');
  assert.match(t, /^<document name="manifest\.xlsx" kind="xlsx">/);
  assert.match(t, /R2 \| A: DATE \| B: 2026-09-20/);
  assert.match(t, /R5 \| A: BL-901 \| B: 12 \| C: 1\.234 \| D: 250\.5/);
  assert.match(t, /R8 \| A: BL-903 ↑ \| B: 5 \| C: 0\.3 \| D: 61/);
  assert.match(t, /Объединённые ячейки: A7:A8, A12:A14/);
  assert.ok(!/R\d+ \|\s*$/m.test(t));
});

test('части: маленький манифест — один вызов, большой — по ~70 строк с контекстом шапки', async () => {
  const small = await X.readGrid(manifestXlsx());
  assert.deepEqual(L.excelParts(small), [{ all: true }]);
  const rows = Array.from({ length: 200 }, (_, i) => ['BL-' + (1000 + i), 1 + (i % 9), +(0.5 + i / 100).toFixed(3), 100 + i]);
  const big = await X.readGrid(manifestXlsx({ rows }));
  const parts = L.excelParts(big);
  assert.equal(parts.length, 3);
  assert.equal(parts[0].from, 1); assert.equal(parts[1].ctx[0], 1); assert.ok(parts[1].ctx.length <= 6);
  const reqs = L.extractRequests({ kind: 'xlsx', book: big }, 'big.xlsx');
  assert.equal(reqs.length, 3); assert.equal(reqs[1].part, '2/3');
  assert.match(reqs[1].content[0].text, /\[контекст — начало листа, строки отсюда не извлекай\]/);
  assert.match(reqs[1].content[0].text, /часть 2 из 3: извлеки строки груза только из R\d+–R\d+/);
  const lines = reqs[1].content[0].text.split('\n').filter(l => /^R\d+ \|/.test(l));
  assert.ok(lines.length <= 76);
});

test('PDF: документ base64 в каждой части, страницы по 5, кеш документа только если частей несколько', () => {
  const one = L.extractRequests({ kind: 'pdf', pages: 3, base64: 'JVBERi0x' }, 'm.pdf');
  assert.equal(one.length, 1); assert.equal(one[0].content[0].type, 'document'); assert.equal(one[0].content[0].source.media_type, 'application/pdf'); assert.equal(one[0].content[0].cache_control, undefined);
  const many = L.extractRequests({ kind: 'pdf', pages: 12, base64: 'JVBERi0x' }, 'm.pdf');
  assert.equal(many.length, 3); assert.deepEqual(many[2].content[0].cache_control, { type: 'ephemeral' });
  assert.match(many[2].content[1].text, /страниц 11–12/);
});

test('схемы строгие: все свойства обязательны, лишние запрещены, без min/max', () => {
  const walk = (s, path) => {
    if (s.anyOf) return s.anyOf.forEach((x, i) => walk(x, path + '|' + i));
    if (s.type === 'object') { assert.equal(s.additionalProperties, false, path); assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort(), path); Object.entries(s.properties).forEach(([k, v]) => walk(v, path + '.' + k)); }
    if (s.type === 'array') walk(s.items, path + '[]');
    ['minimum', 'maximum', 'minLength', 'maxLength', 'multipleOf'].forEach(k => assert.equal(s[k], undefined, path + ' ' + k));
  };
  walk(L.EXTRACT_SCHEMA.input_schema, 'extract'); walk(L.MATCH_SCHEMA.input_schema, 'match');
  assert.match(L.SYSTEM_EXTRACT, /только данные/); assert.match(L.SYSTEM_EXTRACT, /Ничего не придумывай/); assert.match(L.SYSTEM_MATCH, /BL-00/);
});

test('сборка частей: шапка из первой, итог — где найден, строки по порядку', () => {
  const r = L.mergeParts([
    { meta: { date: '2026-09-20', route: 'R', consolidator: 'C', header: { sheet: 'M', row: 4, mark: 'A', places: 'B', cbm: 'C', kg: 'D' }, total: null }, rows: [{ mark: 'A' }, { mark: 'B' }], notes: ['n1'] },
    { meta: { date: null, route: null, consolidator: null, header: null, total: { places: 5, cbm: 1, kg: 2, sheet: 'M', row: 99, page: null } }, rows: [{ mark: 'C' }], notes: [] }
  ]);
  assert.equal(r.meta.date, '2026-09-20'); assert.equal(r.meta.header.row, 4); assert.equal(r.meta.total.row, 99);
  assert.deepEqual(r.rows.map(x => x.mark), ['A', 'B', 'C']); assert.deepEqual(r.notes, ['n1']);
});

test('маркировки → клиенты кодом: код, бренд, латиница-«кириллица», маркировки клиента, BL-00', () => {
  const idx = L.clientIndex(CLIENTS);
  const m = s => L.matchMark(s, idx);
  assert.deepEqual([m('BL-901').client, m('BL-901').by], ['BL-901', 'code']);
  assert.equal(m('bl 0902').client, 'BL-902'); assert.equal(m('BL902').client, 'BL-902');
  assert.deepEqual([m('ALFA').client, m('ALFA').by], ['BL-904', 'brand']);
  assert.equal(m('Alfa ').client, 'BL-904');
  const sv = m('CBETA'); assert.equal(sv.client, 'BL-906'); assert.match(sv.reason, /SVETA/);   // CBETA → СВЕТА → SVETA
  assert.equal(m('СВЕТА').client, 'BL-906');                                                    // кириллицей
  assert.deepEqual([m('OMG').client, m('OMG').by], ['BL-907', 'mark']);                         // маркировка клиента
  assert.equal(m('омега').client, 'BL-907');
  const u = m('BL-00'); assert.equal(u.client, null); assert.equal(u.by, 'unknown-owner');
  assert.equal(m('BL-999'), null); assert.equal(m('NEWBRAND'), null);
  // одинаковый бренд у двух клиентов — неоднозначно, решает человек
  const amb = L.matchMark('ALFA', L.clientIndex([...CLIENTS, { bl: 'BL-990', brand: 'Alfa', name: 'x' }]));
  assert.equal(amb.client, null); assert.equal(amb.by, 'ambiguous'); assert.deepEqual(amb.options.sort(), ['BL-904', 'BL-990']);
});

test('новый клиент: BL из маркировки или вписанный человеком; код внутри маркировки — клиент справочника', () => {
  assert.deepEqual(['bl 03', 'BL03', ' bl-77 ', 'Bl_5', 'kara'].map(L.normBl), ['BL-03', 'BL-03', 'BL-77', 'BL-5', 'KARA']);
  assert.deepEqual(['BL-03 KARA CHICKEN', 'Kara chicken bl03', 'KARA (BL-12)', 'KARA CHICKEN', 'TABLE 3', 'KG 100'].map(L.codeIn), ['BL-03', 'BL-03', 'BL-12', '', '', '']);
  assert.deepEqual(L.newClientOf('BL-03 KARA CHICKEN'), { bl: 'BL-03', brand: 'KARA CHICKEN' });
  assert.deepEqual(L.newClientOf('Kara chicken (bl-03)'), { bl: 'BL-03', brand: 'Kara chicken' });
  assert.deepEqual(L.newClientOf('BLOOD GREY'), { bl: '', brand: 'BLOOD GREY' });
  assert.deepEqual(L.newDecision('BLOOD GREY'), { decided: true, by: 'new', isNew: true, client: '', reason: '' });
  assert.equal(L.newDecision('BL-03 KARA').client, 'BL-03');
  const idx = L.clientIndex(CLIENTS), m = s => L.matchMark(s, idx);
  assert.deepEqual([m('BL-901 NUR').client, m('BL-901 NUR').by], ['BL-901', 'code']);   // код в маркировке — клиент справочника
  assert.equal(m('nova bl 0902').client, 'BL-902');
  assert.equal(m('BL-00 KARA').by, 'unknown-owner');                                      // BL-00 — не новый клиент
  assert.equal(m('BL-03 KARA CHICKEN'), null);                                             // кода нет в справочнике — решит analyze: новый
});

test('запрос сопоставления: только id, название и маркировки клиентов — без адресов и телефонов', () => {
  const r = L.matchRequest(['CBETA', 'NEWBRAND'], [{ bl: 'BL-1', brand: 'B', name: 'N', marks: 'X', tel1: '+998901234567', address: 'Toshkent, secret st.', lat: 41.3 }]);
  const t = r.content[0].text;
  assert.match(t, /BL-1 \| B — N \| маркировки: X/); assert.ok(!/998|Toshkent|41\.3/.test(t));
  assert.match(t, /<marks>\nCBETA\nNEWBRAND\n<\/marks>/);
});
