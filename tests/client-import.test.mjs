// База клиентов из Excel (js/client-import.js): столбцы по заголовкам и содержимому, пустые коды, телефоны, повторы,
// разные клиенты под одним BL, дополнение справочника сайта без перезаписи, паспорта не переносятся.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { baseGrid, baseXlsx, SITE, PASSPORTS } from './fixtures/customer-base.mjs';
const C = createRequire(import.meta.url)('../js/client-import.js');

test('столбцы: шапка в строке 1, «Name» с «Сборный» — тип, «Column 9» и «Remark» с номерами — телефоны, паспорт узнан', () => {
  const p = C.parse(baseGrid());
  assert.equal(p.sheet, 'ACB(LTLLCL)'); assert.equal(p.headerRow, 1);
  assert.deepEqual(p.cols, { B: 'manager', C: 'bl', D: 'kind', E: 'name', F: 'brand', G: 'business', H: 'address', I: 'phone', J: 'phone',
    K: 'passport', L: 'skip', M: 'phone', N: 'skip', O: 'added' });
  assert.equal(p.passport, true);
  assert.deepEqual(p.ignored, ['PASSPORT', 'RASM', 'Cargo location', 'Added date']);
});

test('строки: зарезервированные коды пропущены, повтор — одна запись, два клиента под одним BL — не загружаются, проблемы', () => {
  const p = C.parse(baseGrid());
  assert.equal(p.total, 13); assert.equal(p.empty, 2);
  assert.deepEqual(p.rows.map(x => x.bl), ['BL-1', 'BL-2', 'BL-05', 'BL-6', 'BL-8', 'BL-9', 'BL-10']);
  assert.deepEqual(p.dups, [{ bl: 'BL-8', rows: [10, 11] }]);
  assert.deepEqual(p.clash, [{ bl: 'BL-7', rows: [8, 9], names: ['Rustam A', 'Bobur B'] }]);
  assert.deepEqual(p.problems, [{ row: 7, bl: 'BL-6', kind: 'phone' }, { row: 12, kind: 'nobl' }, { row: 13, bl: 'BL-9', kind: 'thin' }]);
  const one = p.rows[0];
  assert.deepEqual([one.name, one.brand, one.tel1, one.tel2, one.address, one.manager, one.kind, one.business], ['Akmal Testov', 'NUR TEST', '+998901112233', '+998934445566', 'Chilonzor 5', 'Aziza', 'Сборный', 'Mebel']);
  const two = p.rows[1];
  assert.deepEqual([two.brand, two.address, two.tel1], ['', '', '+998901234567']);   // «-» — пусто; 998… — с «+»
  assert.equal(p.rows.find(x => x.bl === 'BL-10').tel1, '+998901110005');   // номер из «Remark»
  assert.equal(p.rows.find(x => x.bl === 'BL-6').tel1, '99890123');          // неверная длина — как было, в «проверьте»
  const json = JSON.stringify(p);
  PASSPORTS.forEach(s => assert.ok(!json.includes(s), 'паспорт не попадает в разбор'));
});

test('телефоны: 9 цифр, 998…, 8…, пробелы и скобки; чужая длина — ok: false; прочерк — пусто', () => {
  assert.deepEqual(C.phone('90 123 45 67'), { v: '+998901234567', ok: true });
  assert.deepEqual(C.phone(998901234567), { v: '+998901234567', ok: true });
  assert.deepEqual(C.phone('+998 (93) 123-45-67'), { v: '+998931234567', ok: true });
  assert.deepEqual(C.phone('8 901234567'), { v: '+998901234567', ok: true });
  assert.deepEqual(C.phone('+7 999 123 45 67'), { v: '+7 999 123 45 67', ok: false });
  assert.equal(C.phone('—'), null);
  assert.deepEqual([C.blKey('BL-03'), C.blKey('bl 3'), C.blText('bl-3'), C.blKey('alfa')], ['BL#3', 'BL#3', 'BL-3', 'ALFA']);
});

test('дополнить: новые добавлены, у старых — только пустые поля, номер — во второй телефон, отличие показано; BL-08 = BL-8', () => {
  const p = C.parse(baseGrid()), m = C.merge(SITE, p);
  assert.deepEqual(m.added, ['BL-2', 'BL-6', 'BL-9', 'BL-10']);
  assert.deepEqual(m.filled, [{ bl: 'BL-1', fields: ['name', 'address', 'tel2'] }, { bl: 'BL-5', fields: ['tel2', 'note'] }]);
  assert.deepEqual(m.same, ['BL-08']);
  assert.deepEqual(m.diffs, [{ bl: 'BL-5', f: 'brand', site: 'ZAMON', file: 'ZAMON TEST' }]);
  const by = bl => m.clients.find(c => c.bl === bl);
  assert.equal(m.clients.length, 7);
  assert.deepEqual([by('BL-1').name, by('BL-1').tel2, by('BL-1').note, by('BL-1').district, by('BL-1').lat], ['Akmal Testov', '+998934445566', 'старое', 'Chilonzor', 41.28]);
  assert.deepEqual([by('BL-5').brand, by('BL-5').tel2, by('BL-5').note], ['ZAMON', '+998907654321', 'Менеджер: Bekzod · Сборный']);
  const n = by('BL-2');
  assert.deepEqual(n, { bl: 'BL-2', brand: '', name: 'Dilshod', tel1: '+998901234567', tel2: '', receiver: '', receiverTel: '', district: 'Aniqlanmagan', address: '',
    lat: null, lon: null, note: 'Менеджер: Aziza · Целый · Kiyim', manualZone: '', link: '', marks: '', locs: '' });
  assert.equal(SITE[0].name, '', 'справочник сайта не меняется на месте');
  PASSPORTS.forEach(s => assert.ok(!JSON.stringify(m).includes(s)));
});

test('заменить отличающиеся; без дополнения — номера в отличиях; без примечаний', () => {
  const p = C.parse(baseGrid());
  const r = C.merge(SITE, p, { replace: true });
  assert.equal(r.clients.find(c => c.bl === 'BL-5').brand, 'ZAMON TEST'); assert.deepEqual(r.diffs, []);
  const f = C.merge(SITE, p, { fill: false, notes: false });
  assert.deepEqual(f.filled, []); assert.deepEqual(f.same, ['BL-1', 'BL-5', 'BL-08']);
  assert.deepEqual(f.diffs.map(d => [d.bl, d.f]), [['BL-1', 'tel'], ['BL-5', 'brand'], ['BL-5', 'tel']]);
  assert.equal(f.clients.find(c => c.bl === 'BL-2').note, '');
  // замена телефонов: номера из файла первыми, старый — во второй, если есть место
  const t = C.merge([{ bl: 'BL-1', tel1: '+998900000001', tel2: '' }], { rows: [{ bl: 'BL-1', key: 'BL#1', tel1: '+998900000002', tel2: '' }] }, { replace: true });
  assert.deepEqual([t.clients[0].tel1, t.clients[0].tel2], ['+998900000002', '+998900000001']);
});

test('русские и узбекские заголовки, несколько номеров в ячейке, ссылка на карту, район — написанием сайта, примечание', () => {
  const grid = [{ name: 'Лист1', rows: {
    1: { A: 'Список клиентов' },
    2: { A: 'Код', B: 'ФИО', C: 'Компания', D: 'Телефон', E: 'Район', F: 'Адрес', G: 'Ссылка', H: 'Примечание' },
    3: { A: 'bl 20', B: 'Ali', D: '90 111 22 33; 93 111 22 34, 99 111 22 35', E: 'chilonzor', F: 'Bunyodkor 1', G: 'https://maps.app.goo.gl/abc', H: 'Har hafta' },
    4: { A: 'BL-21', C: 'SAVDO', D: '(97) 000-11-22' }, 5: { A: 'BL-00', B: 'Nobody' } } },
  { name: 'Mijozlar', rows: { 1: { A: 'Kod', B: 'Mijoz ismi', C: 'Telefon', D: 'Manzil', E: 'Izoh' }, 2: { A: 'BL-30', B: 'Vali', C: 901234567 } } }];
  const p = C.parse(grid);
  assert.equal(p.sheet, 'Лист1'); assert.equal(p.headerRow, 2);   // больше узнанных столбцов
  assert.deepEqual(p.rows.map(x => [x.bl, x.tel1, x.tel2, x.link, x.remark]), [['BL-20', '+998901112233', '+998931112234', 'https://maps.app.goo.gl/abc', 'Har hafta'], ['BL-21', '+998970001122', '', '', '']]);
  assert.deepEqual(p.problems, [{ row: 5, bl: 'BL-00', kind: 'zero' }]);   // BL-00 — груз без владельца, не клиент
  const m = C.merge([], p, { districts: ['Chilonzor', 'Yunusobod'] });
  assert.deepEqual([m.clients[0].district, m.clients[0].link, m.clients[1].district], ['Chilonzor', 'https://maps.app.goo.gl/abc', 'Aniqlanmagan']);
  assert.equal(m.clients[0].note, 'Har hafta · Ещё телефон: +998991112235');   // третий номер — в примечание
  assert.equal(C.parse([{ name: 'x', rows: { 1: { A: 'Имя', B: 'Телефон' }, 2: { A: 'Ali', B: 901234567 } } }]).error.startsWith('Не нашёл столбец с BL'), true);
});

test('книга .xlsx: XlsxIO.readGrid → разбор как у сетки', async () => {
  const win = {};
  new Function('window', 'atob', 'btoa', fs.readFileSync(new URL('../js/xlsx-io.js', import.meta.url), 'utf8'))(win, s => Buffer.from(s, 'base64').toString('binary'), s => Buffer.from(s, 'binary').toString('base64'));
  const g = await win.XlsxIO.readGrid(baseXlsx()), p = C.parse(g);
  assert.deepEqual(p.rows.map(x => x.bl), C.parse(baseGrid()).rows.map(x => x.bl));
  assert.equal(p.rows[0].tel1, '+998901112233');
});
