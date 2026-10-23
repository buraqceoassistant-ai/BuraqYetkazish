// Проверки черновика кодом (js/import-checks.js) на обезличенном манифесте: ячейки, пропуски, TOTAL, клиенты,
// плотность, мелкие, неизвестные и BL-00, дубликаты, PDF, партия для журнала, счётчик правок.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { manifestXlsx, ROWS, TOTAL, CLIENTS } from './fixtures/manifest.mjs';
import { fakeAi } from './fake-ai.mjs';
const require = createRequire(import.meta.url);
globalThis.window = globalThis;
require('../js/xlsx-io.js');
const L = require('../js/import-core.js');
const C = require('../js/import-checks.js');
const X = globalThis.XlsxIO;
const S = { freeOutM3: 1, densityMin: 40, densityMax: 800 };
const clone = o => JSON.parse(JSON.stringify(o));

async function draftOf(opts = {}, aiOpts = {}) {
  const book = await X.readGrid(manifestXlsx(opts));
  const d = await L.analyze({ doc: { kind: 'xlsx', book }, fileName: 'm.xlsx', clients: CLIENTS, draftId: 'd1', today: '2026-09-25', ai: fakeAi(aiOpts), wait: async () => {} });
  return { book, draft: { id: 'd1', file: { kind: 'xlsx', name: 'm.xlsx' }, ...d } };
}
const codes = list => list.map(x => x.code);

test('правильный разбор: блокирующих нет; мелкие, неизвестные и BL-00 — списками', async () => {
  const { book, draft } = await draftOf();
  const r = C.check(draft, { book, settings: S });
  assert.deepEqual(r.blocking, []); assert.equal(r.ok, true);
  assert.equal(r.header.by, 'ai+code'); assert.equal(r.header.row, 4);
  assert.deepEqual(r.doc, { ...TOTAL, src: { sheet: 'Manifest', row: 15 } }); assert.deepEqual(r.sum, TOTAL); assert.deepEqual(r.diff, {});
  assert.deepEqual(r.lists.small.items.map(x => x.mark), ['BL-903', 'BL-00']); assert.equal(r.lists.small.cbm, 0.966);
  assert.deepEqual(r.lists.unknown.items.map(x => x.mark), ['BL-00']);
  const g = Object.fromEntries(r.groups.map(x => [x.mark, x]));
  assert.deepEqual([g['BL-905'].rowIds.length, g['BL-905'].places, g['BL-905'].cbm, g['BL-905'].kg], [3, 82, 13.05, 3231]);   // объединены три строки
  assert.equal(codes(r.warnings).length, 0);
});

test('ИИ ошибся в числе: 1,243 вместо 1,234 итог не выдаёт (в пределах допуска), а сверка с ячейкой ловит; правка вручную снимает', async () => {
  const { book, draft } = await draftOf({}, { hooks: { before: null } });
  const d = clone(draft); d.rows[0].cbm = 1.243; d.rows[0].ai.cbm = 1.243;                 // «ИИ прочитал» 1.243 вместо 1.234
  let r = C.check(d, { book, settings: S });
  assert.deepEqual(codes(r.blocking), ['cell']);
  assert.match(r.blocking.find(b => b.code === 'cell').text, /R5 — м³: в документе 1,234, в строке 1,243/);
  d.rows[1].kg = 1420; d.rows[1].ai.kg = 1420;                                               // а крупная ошибка — и в итоге
  assert.deepEqual(codes(C.check(d, { book, settings: S }).blocking).sort(), ['cell', 'cell', 'total']);
  d.rows[1].kg = 1320;
  assert.equal(r.flags[d.rows[0].id][0].level, 'block');
  d.rows[0].cbm = 1.234;                                                                      // человек исправил на значение документа
  r = C.check(d, { book, settings: S });
  assert.deepEqual(r.blocking, []); assert.equal(r.flags[d.rows[0].id], undefined);
  d.rows[0].cbm = 1.24;                                                                       // осознанно не как в документе — предупреждение, не блок
  r = C.check(d, { book, settings: S });
  assert.deepEqual(r.blocking, []); assert.equal(r.flags[d.rows[0].id][0].level, 'warn'); assert.match(r.flags[d.rows[0].id][0].text, /Исправлено вами/);
});

test('ИИ пропустил строку — «не попала в черновик» и итог не сходится', async () => {
  const { book, draft } = await draftOf();
  const d = clone(draft); d.rows = d.rows.filter(x => x.src.row !== 10);                   // CBETA
  const r = C.check(d, { book, settings: S });
  assert.deepEqual(codes(r.blocking).sort(), ['missed', 'total']);
  assert.match(r.blocking.find(b => b.code === 'missed').text, /R10 \(CBETA\)/);
  assert.deepEqual(r.diff, { places: -20, cbm: -2.75, kg: -510 });
});

test('маркировка не как в ячейке, две строки на одну строку документа, строка-шапка, нет ссылки', async () => {
  const { book, draft } = await draftOf();
  const d = clone(draft);
  d.rows[1].mark = 'BL-912'; d.rows[1].ai.mark = 'BL-912';
  d.rows[2].src.row = 5;
  d.rows[3].src.row = 3;
  d.rows[4].src = { sheet: null, row: null, page: null, text: '' };
  const r = C.check(d, { book, settings: S });
  const t = r.blocking.map(b => b.code);
  assert.ok(t.includes('cell') && t.includes('dup-src') && t.includes('src-header') && t.includes('no-src'), t.join(','));
  assert.match(r.blocking.find(b => b.code === 'cell').text, /маркировка в документе «BL-902», в строке «BL-912»/);
});

test('ошибка в итоге самого документа — блокирует, пока не принято «как есть»', async () => {
  const { book, draft } = await draftOf({ totalOff: { kg: 100 } });
  const d = clone(draft);
  let r = C.check(d, { book, settings: S });
  assert.deepEqual(codes(r.blocking), ['total']); assert.match(r.blocking[0].text, /кг 6400,7 против 6500,7/);
  d.ack = { total: true };
  r = C.check(d, { book, settings: S });
  assert.equal(r.ok, true); assert.ok(codes(r.warnings).includes('total-ack'));
});

test('допуск итога: м³ — max(0,01; 0,1 %) (здесь 0,029), кг — max(0,5; 0,1 %) (здесь 6,4), места — точно', async () => {
  for (const [off, ok] of [[{ cbm: 0.02 }, true], [{ cbm: 0.05 }, false], [{ kg: 6 }, true], [{ kg: 10 }, false], [{ places: 1 }, false]]) {
    const { book, draft } = await draftOf({ totalOff: off });
    assert.equal(C.check(draft, { book, settings: S }).ok, ok, JSON.stringify(off));
  }
});

test('ИИ прочитал итог иначе, чем в ячейках — берётся итог из ячеек', async () => {
  const { book, draft } = await draftOf();
  const d = clone(draft); d.meta.total.kg = 1;
  const r = C.check(d, { book, settings: S });
  assert.equal(r.ok, true); assert.ok(codes(r.warnings).includes('total-ai')); assert.equal(r.doc.kg, TOTAL.kg);
});

test('маркировка без решения и строка без маркировки блокируют; «без клиента» — решение', async () => {
  const { book, draft } = await draftOf();
  const d = clone(draft);
  d.marks.ALFA = { ...d.marks.ALFA, decided: false, client: null };
  d.rows.push({ id: 'rx', mark: '', places: 1, cbm: 0.1, kg: 10, src: { sheet: 'Manifest', row: 99, page: null, text: '' }, note: '' });
  let r = C.check(d, { book, settings: S });
  assert.ok(codes(r.blocking).includes('no-client')); assert.ok(codes(r.blocking).includes('no-mark'));
  assert.match(r.blocking.find(b => b.code === 'no-client').text, /«ALFA» без решения/);
  d.marks.ALFA = { ...d.marks.ALFA, decided: true, client: null, byUser: true };            // «без клиента»
  d.rows.pop();
  r = C.check(d, { book, settings: S });
  assert.equal(r.ok, true); assert.deepEqual(r.lists.unknown.items.map(x => x.mark).sort(), ['ALFA', 'BL-00']);
});

test('новый клиент: без BL — блокирует, с BL — в партию под этим BL и не «без клиента»', async () => {
  const { book, draft } = await draftOf({ rows: [...ROWS, ['KARA CHICKEN', 4, 0.8, 120]] });
  const d = clone(draft), k = L.key('KARA CHICKEN');
  let r = C.check(d, { book, settings: S });
  assert.ok(!codes(r.blocking).includes('total'));
  assert.deepEqual(r.blocking.map(b => b.code), ['new-bl']); assert.match(r.blocking[0].text, /«KARA CHICKEN» — новый клиент: впишите его BL/);
  assert.ok(r.lists.unknown.items.some(x => x.mark === 'KARA CHICKEN'));
  d.marks[k] = { ...d.marks[k], client: 'BL-03' };
  r = C.check(d, { book, settings: S });
  assert.equal(r.ok, true); assert.ok(!r.lists.unknown.items.some(x => x.mark === 'KARA CHICKEN'));
  const sh = C.shipmentsOf(d, '').find(x => x.bl === 'BL-03');
  assert.deepEqual([sh.places, sh.cbm, sh.kg], [4, 0.8, 120]);
});

test('плотность вне пределов «Тарифов» — предупреждение и «тяжёлые»', async () => {
  const { book, draft } = await draftOf();
  const r = C.check(draft, { book, settings: { ...S, densityMin: 195, densityMax: 240 } });
  const w = r.warnings.filter(x => x.code === 'density').map(x => x.text);
  assert.ok(w.some(t => /«BL-905»: плотность 248 кг\/м³ — больше 240/.test(t)), w.join('\n'));
  assert.ok(w.some(t => /«CBETA»: плотность 185 кг\/м³ — меньше 195/.test(t)));
  assert.deepEqual(r.lists.heavy.items.map(x => x.mark), ['BL-905']); assert.equal(r.ok, true);
});

test('не число и не положительное — предупреждения у строки', async () => {
  const { book, draft } = await draftOf();
  const d = clone(draft); d.rows[0].kg = null; d.rows[0].ai.kg = null; d.rows[1].places = 0; d.rows[1].ai.places = 0;
  const r = C.check(d, { book, settings: S });
  assert.ok(codes(r.warnings).includes('nan')); assert.ok(codes(r.warnings).includes('neg'));
  assert.ok(r.flags[d.rows[0].id].some(f => f.code === 'nan-kg'));
});

test('дубликаты: тот же итог в журнале за дату, подтверждённый импорт, другой черновик', async () => {
  const { book, draft } = await draftOf();
  const ships = [{ date: '2026-09-20', places: TOTAL.places, cbm: TOTAL.cbm, kg: TOTAL.kg }];
  let r = C.check(draft, { book, settings: S, shipments: ships });
  assert.match(r.warnings.find(w => w.code === 'duplicate').text, /в журнале за 2026-09-20/); assert.equal(r.ok, true);
  r = C.check(draft, { book, settings: S, imports: [{ date: '2026-09-20', route: draft.meta.route, ...TOTAL, at: '2026-09-21T10:00:00Z' }] });
  assert.match(r.warnings.find(w => w.code === 'duplicate').text, /уже подтверждён \(2026-09-21\)/);
  r = C.check(draft, { book, settings: S, drafts: [{ id: 'd2', status: 'draft', journalDate: '2026-09-20', route: draft.meta.route, totals: TOTAL, fileName: 'копия.xlsx' }] });
  assert.match(r.warnings.find(w => w.code === 'duplicate').text, /копия\.xlsx/);
  r = C.check(draft, { book, settings: S, imports: [{ date: '2026-09-20', route: 'ДРУГОЙ МАРШРУТ', ...TOTAL }], shipments: [{ date: '2026-09-19', ...TOTAL }] });
  assert.equal(r.warnings.find(w => w.code === 'duplicate'), undefined);
});

test('заголовки нашёл только код (ИИ не указал) — сверка всё равно идёт', async () => {
  const { book, draft } = await draftOf();
  const d = clone(draft); d.meta.header = null; d.rows[0].kg = 999; d.rows[0].ai.kg = 999;
  const r = C.check(d, { book, settings: S });
  assert.equal(r.header.by, 'code'); assert.ok(codes(r.blocking).includes('cell'));
});

test('PDF: числа ищутся в тексте страницы; скан — предупреждение', () => {
  const draft = { id: 'p', file: { kind: 'pdf' }, journalDate: '2026-09-20', meta: { total: { places: 32, cbm: 7.8, kg: 1570, sheet: null, row: null, page: 1 } },
    rows: [{ id: 'a', mark: 'BL-901', places: 12, cbm: 1.0, kg: 250, src: { page: 1 }, ai: {} }, { id: 'b', mark: 'BL-902', places: 20, cbm: 6.8, kg: 1320, src: { page: 2 }, ai: {} }],
    marks: { BL901: { decided: true, client: 'BL-901' }, BL902: { decided: true, client: 'BL-902' } } };
  const pages = [{ page: 1, text: 'BL-901 12 1,00 251\nTOTAL 32 7.8 1570' }, { page: 2, text: '' }];
  const r = C.check(draft, { pages, settings: S });
  assert.ok(codes(r.warnings).includes('scan'));
  assert.ok(r.flags.a.some(f => f.code === 'pdf-kg' && /250 не найдено в тексте страницы 1/.test(f.text)));
  assert.ok(!r.flags.a.some(f => f.code === 'pdf-cbm'));                    // 1,00 = 1
  assert.ok(r.flags.b.some(f => f.code === 'scan')); assert.equal(r.ok, true);
});

test('партия для журнала: одна отгрузка на клиента, маркировки в примечании; BL-00 — как в документе', async () => {
  const { draft } = await draftOf();
  const d = clone(draft); d.marks.CBETA = { ...d.marks.CBETA, client: 'BL-904' };           // CBETA и ALFA — один клиент
  const s = C.shipmentsOf(d, 'TESTCO');
  const by = Object.fromEntries(s.map(x => [x.bl, x]));
  assert.deepEqual(Object.keys(by).sort(), ['BL-00', 'BL-901', 'BL-902', 'BL-903', 'BL-904', 'BL-905']);
  assert.deepEqual([by['BL-904'].places, by['BL-904'].cbm, by['BL-904'].kg], [50, 7.25, 1410]); assert.equal(by['BL-904'].note, 'TESTCO · маркировка: ALFA, CBETA');
  assert.deepEqual([by['BL-905'].places, by['BL-905'].note], [82, 'TESTCO']);
  assert.equal(by['BL-00'].client, null); assert.equal(by['BL-00'].date, '2026-09-20'); assert.equal(by['BL-901'].status, 'Rejada'); assert.equal(by['BL-901'].truck, 'Belgilanmagan');
  assert.equal(s.reduce((a, x) => a + x.places, 0), TOTAL.places);
});

test('счётчик ручных правок', async () => {
  const { draft } = await draftOf();
  const d = clone(draft);
  assert.equal(C.editStats(d).total, 0);
  d.rows[0].cbm = 9; d.rows[1].mark = 'X';                                                     // два поля
  d.rows.push({ id: 'n1', mark: 'NEW', places: 1, cbm: 1, kg: 1, src: {} });                   // добавленная строка
  d.deleted = ['r3'];                                                                           // удалённая
  d.marks.ALFA = { ...d.marks.ALFA, client: 'BL-901', byUser: true, auto: { client: 'BL-904' } };   // клиент не как у кода
  const e = C.editStats(d);
  assert.deepEqual([e.fields, e.added, e.deleted, e.clients, e.total], [2, 1, 1, 1, 5]);
});
