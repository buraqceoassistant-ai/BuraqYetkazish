// Разбор пакинг-листов разных шаблонов (сетки как из readGrid). Данные выдуманные, по образцам шаблонов поставщиков.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const win = {};
new Function('window', fs.readFileSync(new URL('../js/packing.js', import.meta.url), 'utf8'))(win);
const P = win.LogiPacking;
const sheet = (name, rows) => ({ name, rows: Object.fromEntries(rows.map(([r, c]) => [r, c])) });

test('китайский шаблон «Customer shipping mark»: 长/宽/高 в см, CTN/件数, CBM на коробку; BL из ячейки маркировки', () => {
  const book = [sheet('Лист1', [
    [13, { A: 'Phone number发货人电话号码：', C: 18923265452 }],
    [14, { A: 'Customer shipping mark 客户唛头', C: 'BL-71' }],
    [15, { A: 'Photo 照片', B: 'Name产品名称', C: 'MODEL 型号', D: 'QUANTITY 数量', E: 'QTY/CTN 装箱数', F: 'CTN/件数', G: '长', H: '宽', I: '高', J: 'CBM体积', K: 'T.CBM 总体积', L: 'NW 净重' }],
    [16, { B: 'chair', D: 400, E: 6, F: 66, G: 103, H: 50, I: 50, J: 0.2575, K: 16.995 }],
    [17, { B: 'table', D: 1, F: 1, G: 120, H: 49.5, I: 25, J: 0.1485, K: 0.1485 }],
    [20, { A: 'TOTAL', D: 401, F: 67, K: 17.14 }]])];
  const r = P.parseBook(book, { fileName: 'BL-71 68 MESTA STUL (3).xlsx', bls: ['BL-7', 'BL-71', 'BL-640'] });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual([r.unit, r.n, r.m3, r.bl, r.text], ['cm', 67, 17.144, 'BL-71', '103×50×50×66; 120×49,5×25×1']);
  assert.deepEqual(r.groups.map(g => g.desc), ['chair', 'table']);
  assert.deepEqual(r.marks, ['BL-71']); assert.deepEqual(r.notes, []);
});

test('английский шаблон: «cartons size(m)» с L(长)/W(宽)/H(高) на строке ниже CTNS — метры → см; BL из столбца Mark (BMW-86 ≠ BL)', () => {
  const book = [sheet('PACKING LIST', [
    [2, { A: 'BMW-86' }],
    [3, { B: '序号', C: 'Mark', D: 'ITEM NO（产品型号）', E: '(外箱尺寸)cartons size(m)', H: 'QTY （数量）', I: 'PCS/CTN （个/箱）', J: 'CTNS （箱数）', K: 'N.W(KGS)', O: 'CBM' }],
    [4, { B: 'NO.', E: 'L(长)', F: 'W(宽）', G: 'H（高）' }],
    [5, { B: 1, C: 'BMW-86-1-4', D: '1.5米壁灯', E: 1.55, F: 0.205, G: 0.28, H: 40, I: 10, J: 4, O: 0.35588 }],
    [6, { B: 2, C: 'BMW-86-5-7', D: '30W COB', E: 0.47, F: 0.33, G: 0.45, H: 36, I: 12, J: 3, O: 0.209385 }],
    [8, { D: 'Total', H: 76, J: 7, O: 0.565 }]])];
  const r = P.parseBook(book, { fileName: 'BL-86  8 MESTA STREET LIGHT.xlsx', bls: ['BL-86', 'BL-8'] });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual([r.unit, r.n, r.text, r.bl], ['m', 7, '155×20,5×28×4; 47×33×45×3', 'BL-86']);
  assert.ok(r.marks.includes('BMW-86'), 'маркировка BMW-86 найдена: ' + r.marks);
});

test('русский шаблон: Д/Ш/В в см, «коробка 件数», m³ — общий объём; подытоги без размеров пропускаются молча', () => {
  const book = [sheet('Лист1', [
    [1, { A: 'ОСВЕЩЕНИЕ' }],
    [3, { A: 'NO.', B: 'Фото 图片', C: 'модель 型号', D: 'цвет 颜色', E: 'Характеристики 尺寸及规格', F: 'Количество 数量', G: 'Кол-во в упаковке 装箱量', H: 'коробка 件数', I: 'Д 长', J: 'Ш 宽', K: 'В 高', L: 'm³ 立方', M: 'Нетто 净重' }],
    [4, { A: 1, C: 'B-1', E: 'L140*W77.5*H453mm', F: 162, G: 1, H: 162, I: 52.5, J: 21, K: 14.5, L: 2.5897725 }],
    [5, { A: 2, C: 'B-2', E: 'L150*W98*H452mm', F: 322, G: 1, H: 322, I: 52.5, J: 20.5, K: 17, L: 5.8913925 }],
    [6, { F: 484, H: 484, L: 8.481165 }],
    [9, { B: 'TOTAL', F: 484, H: 484, L: 8.48 }]])];
  const r = P.parseBook(book, { fileName: 'DREAM 646 MESTA BRA (2).xlsx', bls: ['DREAM', 'EURO'] });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual([r.unit, r.n, r.m3, r.bl], ['cm', 484, 8.481, 'DREAM']);
  assert.equal(r.text, '52,5×21×14,5×162; 52,5×20,5×17×322');
  assert.deepEqual(r.notes, []);
});

test('шаблон без единиц: 长/宽/高 в метрах (значения до 10) и 件数; сверка с 体积 на коробку; BL только по имени файла', () => {
  const book = [sheet('Sheet1', [
    [1, { A: '2026.9.30号 装箱清单' }],
    [5, { B: '型号', D: '长度', E: '装箱数量', F: '件数', G: '长', H: '宽', I: '高', J: '体积', K: '净重', O: '总体积', P: '总数量' }],
    [6, { A: 1, B: '7535铝材', D: 3060, E: 10, F: 40, G: 3.08, H: 0.225, I: 0.105, J: 0.072765, O: 2.9106, P: 400 }],
    [7, { A: 2, B: '7535 PC', D: 3060, E: 50, F: 8, G: 3.1, H: 0.16, I: 0.135, J: 0.06696 }],
    [8, { A: 3, B: '堵头', E: 1200, F: 2, G: 0.28, H: 0.28, I: 0.205, J: 0.016072 }],
    [9, { B: 'TOTAL', F: 50, O: 3.478 }]])];
  const r = P.parseBook(book, { fileName: 'DREAM 50 MESTA ALYUMIN PROFIL (2).xls', bls: ['DREAM', 'BL-50'] });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual([r.unit, r.n, r.bl, r.text], ['m', 50, 'DREAM', '308×22,5×10,5×40; 310×16×13,5×8; 28×28×20,5×2']);
});

test('шаблоны «箱数» и «箱 数» (с ценами): размеры в см, число коробок — не «支 / 箱»; нет заголовка — ошибка; нет столбца коробок — ошибка', () => {
  const b1 = [sheet('SHEET', [[2, { A: '图排片', B: '规格', C: '单价', D: '金额', E: '每箱数量', F: '箱数', G: '长', H: '宽', I: '高', J: '每箱体积', K: '总体积' }], [3, { B: 'D1000', C: 3950, F: 1, G: 112, H: 111, I: 17.5, J: 0.21756 }], [4, { F: 2, G: 70, H: 36, I: 23.5, J: 0.11844 }], [5, { A: 'TOTAL', F: 3 }]])];
  const r1 = P.parseBook(b1, { fileName: 'EURO 3 MESTA LYUSTRA.xlsx', bls: ['EURO'] });
  assert.deepEqual([r1.ok, r1.n, r1.text, r1.bl], [true, 3, '112×111×17,5×1; 70×36×23,5×2', 'EURO']);
  const b2 = [sheet('123', [[2, { A: '本厂型号', B: '图片', C: '数 量', D: '单价', E: '金额', F: '支 / 箱', G: '箱 数', H: '长', I: '宽', J: '高', K: '体积', L: '总体积' }], [3, { A: 'MD20276', C: 4, F: 1, G: 4, H: 86.5, I: 86.5, J: 10.5, K: 0.078563625 }], [5, { A: '合计', C: 8, G: 8 }]])];
  const r2 = P.parseBook(b2, { fileName: 'BL-640 8 MESTA LYUSTRA.xls', bls: ['BL-64', 'BL-640'] });
  assert.deepEqual([r2.ok, r2.n, r2.text, r2.bl], [true, 4, '86,5×86,5×10,5×4', 'BL-640']);
  assert.match(P.parseBook([sheet('x', [[1, { A: 'Товар', B: 'Цена' }], [2, { A: 'Стул', B: 100 }]])], {}).error, /Не нашёл строку заголовка/);
  assert.match(P.parseBook([sheet('x', [[1, { A: 'Товар', B: '长', C: '宽', D: '高' }], [2, { A: 'Стул', B: 60, C: 40, D: 50 }]])], {}).error, /не столбец с числом коробок/);
});

test('matchBl: самый длинный код, BL-7 не подходит к BL-71, регистр и разделители не важны', () => {
  assert.equal(P.matchBl('BL-71 68 MESTA STUL (3).xlsx', ['BL-7', 'BL-71', 'BL-716']), 'BL-71');
  assert.equal(P.matchBl('bl 7 stul', ['BL-7', 'BL-71']), 'BL-7');
  assert.equal(P.matchBl('EURO_4_MESTA.xlsx', ['EURO', 'EURO-4']), 'EURO-4');
  assert.equal(P.matchBl('DREAM 50', ['BL-1']), '');
});
