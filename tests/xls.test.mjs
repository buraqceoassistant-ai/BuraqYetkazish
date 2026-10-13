// Старый Excel (.xls, BIFF8): js/xls-biff.js читает книгу в сетку readGrid; XlsxIO.readGrid сам распознаёт .xls;
// пакинг-лист из .xls разбирается как из .xlsx.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { xlsBuffer } from './fixtures/xls-sample.mjs';

const win = {};
for (const f of ['xls-biff.js', 'xlsx-io.js', 'packing.js']) new Function('window', 'atob', 'btoa', fs.readFileSync(new URL('../js/' + f, import.meta.url), 'utf8'))(win, s => Buffer.from(s, 'base64').toString('binary'), s => Buffer.from(s, 'binary').toString('base64'));

test('xls: листы, строки, числа (RK/NUMBER/MULRK), общие строки, дата по формату, формулы с результатом, объединения', () => {
  const ab = xlsBuffer();
  assert.equal(win.XlsBiff.isOle(ab), true);
  const g = win.XlsBiff.readGrid(ab);
  assert.deepEqual(g.map(s => [s.name, s.hidden]), [['Packing 装箱单', false], ['Лист2', false]]);
  const r = g[0].rows;
  assert.deepEqual(r[1], { A: 'Customer shipping mark 客户唛头', C: 'BL-901', D: '2026-09-20' });
  assert.deepEqual(r[2], { A: 'Name产品名称', B: 'CTN/件数', C: '长', D: '宽', E: '高', F: 'CBM体积', G: 'Примечание' });
  assert.deepEqual([r[3].A, r[3].B, r[3].C, r[3].D, r[3].E, r[3].F], ['стул chair 椅子', 66, 103, 50, 50, 0.2575]);
  assert.ok(r[3].G.startsWith('Очень длинное примечание') && r[3].G.endsWith('конец') && r[3].G.length > 300, 'длинная строка целиком');
  assert.deepEqual(r[4], { B: 1, C: 120, D: 49.5, E: 25, F: 0.1485, G: 1 });
  assert.deepEqual(r[5], { A: 'TOTAL', B: 67, F: 17.144, G: 'итого 67' });   // SUM и CONCATENATE — сохранённые результаты
  assert.deepEqual(r[6], { A: -12.5, B: 123456789.25, C: 0.000001, D: 'с пробелами' });
  assert.deepEqual(g[0].merges, ['A3:A4']);
  assert.deepEqual(g[1].rows, { 1: { A: 'второй лист', B: 2 } });
});

test('XlsxIO.readGrid распознаёт .xls по сигнатуре; не-Excel — понятная ошибка; пакинг-лист из .xls разбирается', async () => {
  const g = await win.XlsxIO.readGrid(xlsBuffer());
  assert.equal(g[0].rows[3].B, 66);
  await assert.rejects(() => win.XlsxIO.readGrid(new TextEncoder().encode('not an excel file at all').buffer), /xlsx|Excel/);
  assert.throws(() => win.XlsBiff.readGrid(new TextEncoder().encode('xx').buffer), /не файл Excel 97–2003/);
  const r = win.LogiPacking.parseBook(g, { fileName: 'BL-901 67 MESTA.xls', bls: ['BL-90', 'BL-901'] });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual([r.unit, r.n, r.m3, r.bl, r.text, r.marks], ['cm', 67, 17.144, 'BL-901', '103×50×50×66; 120×49,5×25×1', ['BL-901']]);
});
