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

test('шапка в три строки: 长/宽/高 сверху, «总箱数» двумя строками ниже; «内装尺寸» (штук в коробке) и «数量» — не коробки', () => {
  const book = [sheet('装箱单', [
    [18, { A: 'Customer shipping mark 客户唛头' }],
    [19, { A: 'Photo 照片', B: 'Name产品名称', C: 'MODEL 型号', E: 'QUANTITY 数量', F: '长', G: '宽', H: '高', I: 'CBM体积', J: 'T.CBM 总体积', K: 'NW 净重' }],
    [20, { A: '序号', C: '型号', E: '数量', F: '纸箱尺寸', I: '纸箱' }],
    [21, { C: '名称', F: 'L', G: 'W', H: 'H', I: '体积', J: '总体积', K: '内装尺寸', L: '总箱数', M: '净重' }],
    [22, { B: '壁灯', C: 'MD-1', E: 10, F: 84, G: 51, H: 27, I: 0.115668, J: 0.115668, K: 10, L: 1, M: 7.5 }],
    [23, { B: '壁灯', C: 'MD-2', E: 10, F: 84, G: 51, H: 27, I: 0.115668, J: 0.115668, K: 10, L: 1, M: 7.5 }],
    [24, { E: 20, J: 0.231336, L: 2 }],
    [25, { B: '吊灯', C: 'MD-3', E: 5, F: 88.5, G: 88, H: 26, I: 0.202488, J: 1.01244, K: 1, L: 5, M: 11 }]])];
  const r = P.parseBook(book, { fileName: 'STILLUX  39 MESTA LYUSTRA.xlsx', bls: ['STILLUX', 'BL-39'] });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual([r.unit, r.n, r.bl, r.text], ['cm', 7, 'STILLUX', '84×51×27×2; 88,5×88×26×5']);
  assert.deepEqual(r.notes, []);
});

test('шапка сбита (над размерами написано CBM): размеры и объём — по произведению, коробки — по заголовку MECTA латиницей; манифест по объёму не читается', () => {
  const book = [sheet('Sheet1', [
    [1, { E: 'FURANUMUR;宁CG0205', I: '2026-05-17' }],
    [3, { A: 'DUKAN-NO', C: 'ITEM.NO', D: 'MECTA', E: 'mecta', F: '1mecta/danisi', G: 'CBM', J: 'CBM', K: 'T.CBM', L: 'N.W', M: 'T.NW' }],
    [5, { C: '80灵蝶路引', D: 8, E: 5, F: 40, G: 82.5, H: 82.5, I: 17, J: 0.11570625, K: 0.92565, L: 13.22, M: 105.76 }],
    [6, { C: '底座', D: 8, E: 6, G: 30.5, H: 30.5, I: 28, J: 0.026047, K: 0.208376, L: 6.22, M: 49.76 }],
    [7, { A: 'TOTAL', D: 16, F: 40, K: 1.134026, M: 155.52 }]])];
  const r = P.parseBook(book, { fileName: 'BL-118 16 MESTA.xlsx', bls: ['BL-118', 'BL-11'] });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual([r.unit, r.n, r.m3, r.bl, r.text], ['cm', 16, 1.134, 'BL-118', '82,5×82,5×17×8; 30,5×30,5×28×8']);
  assert.match(r.notes.join(' '), /по объёму/);
  // без заголовка MECTA — число коробок по «объём × n = общий объём»
  const b2 = [sheet('S', [[5, { C: 'a', D: 8, E: 5, G: 82.5, H: 82.5, I: 17, J: 0.11570625, K: 0.92565 }], [6, { C: 'b', D: 8, E: 6, G: 30.5, H: 30.5, I: 28, J: 0.026047, K: 0.208376 }]])];
  assert.deepEqual([P.parseBook(b2, {}).ok, P.parseBook(b2, {}).n], [true, 16]);
  // манифест (места, м³, кг) — три числа подряд, но их произведение ни с чем не сходится → ошибка, а не мусор
  const man = [sheet('Manifest', [[4, { A: 'SHIPPING MARK', B: 'CTN/件数', C: 'T/CBM', D: 'KG' }], [5, { A: 'BL-901', B: 12, C: 1.234, D: 250.5 }], [6, { A: 'BL-902', B: 40, C: 6.8, D: 1320 }], [7, { A: 'TOTAL', B: 52, C: 8.034, D: 1570.5 }]])];
  assert.equal(P.parseBook(man, { fileName: 'BL27082026.xlsx' }).ok, false);
});


test('ИИ: запрос — текст книги / PDF-документ / картинка, схема по инструменту, BL партии в подсказке; документ — только данные', () => {
  const book = [sheet('Лист1', [[1, { A: 'Customer shipping mark', C: 'BL-71 <ignore this>' }], [2, { A: '长', B: '宽', C: '高', D: '件数' }], [3, { A: 103, B: 50, C: 50, D: 66 }]])];
  const rx = P.aiRequest({ kind: 'xlsx', book }, { fileName: 'BL-71 68 MESTA.xlsx', bls: ['BL-71', 'BL-7'] });
  assert.equal(rx.schema.name, 'packing_list'); assert.equal(rx.schema.input_schema.additionalProperties, false);
  assert.deepEqual(rx.schema.input_schema.required.slice().sort(), ['bl', 'groups', 'marks', 'notes', 'total', 'unit']);
  assert.equal(rx.content.length, 1); assert.equal(rx.content[0].type, 'text');
  assert.match(rx.content[0].text, /<document name="BL-71 68 MESTA.xlsx" kind="xlsx">/);
  assert.match(rx.content[0].text, /R3: A=103 \| B=50 \| C=50 \| D=66/);
  assert.match(rx.content[0].text, /BL-71 ‹ignore this›/, 'угловые скобки из ячеек экранируются');
  assert.match(rx.content[0].text, /BL партии в журнале: BL-71, BL-7/);
  assert.match(rx.system, /инструкции.*игнорируй/);
  assert.deepEqual([rx.max_tokens, rx.effort, rx.meta], [4000, 'low', { file: 'BL-71 68 MESTA.xlsx', step: 'пакинг-лист' }]);
  const rp = P.aiRequest({ kind: 'pdf', base64: 'AAAA', pages: 2 }, { fileName: 'list.pdf' });
  assert.deepEqual(rp.content[0], { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'AAAA' } });
  assert.match(rp.content[1].text, /страниц: 2/);
  const ri = P.aiRequest({ kind: 'image', base64: 'BBBB', mediaType: 'image/jpeg' }, { fileName: 'photo.jpg' });
  assert.deepEqual(ri.content[0], { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'BBBB' } });
  assert.match(ri.content[1].text, /фотография/);
});

test('ИИ: ответ → группы в см, число, объём, текст, BL из списка партии, сверка с итогом; мусор — ошибка, не исключение', () => {
  const r = P.fromAi({ unit: 'm', groups: [{ desc: 'lamp', l: 1.55, w: 0.205, h: 0.28, n: 4, row: '5' }, { desc: 'cob', l: 0.47, w: 0.33, h: 0.45, n: 3, row: '6' }, { desc: 'нет', l: 0, w: 0, h: 0, n: 1, row: '7' }],
    marks: ['BMW-86'], bl: 'bl 86', total: { n: 7, m3: 0.565 }, notes: ['строка 7 без размеров'] }, { fileName: 'street light.xlsx', bls: ['BL-86', 'BL-8'] });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual([r.ai, r.unit, r.n, r.m3, r.text, r.bl], [true, 'm', 7, 0.565, '155×20,5×28×4; 47×33×45×3', 'BL-86']);
  assert.deepEqual(r.marks, ['BMW-86', 'BL 86']);
  assert.deepEqual(r.notes, ['ИИ: строка 7 без размеров']);
  // итог не сходится — заметка; единицы не указаны — по величинам; одинаковые группы складываются
  const r2 = P.fromAi({ groups: [{ desc: '', l: 60, w: 40, h: 50, n: 10, row: null }, { desc: '', l: 60, w: 40, h: 50, n: 2, row: null }], marks: [], bl: null, total: { n: 13, m3: null }, notes: [] }, { bls: ['BL-1'] });
  assert.deepEqual([r2.unit, r2.n, r2.text, r2.bl, r2.notes], ['cm', 12, '60×40×50×12', '', ['в итоге документа коробок: 13, в строках: 12 — проверьте']]);
  // bl из документа совпадает с BL партии по написанию — берётся он
  assert.equal(P.fromAi({ unit: 'cm', groups: [{ desc: '', l: 60, w: 40, h: 50, n: 1, row: null }], marks: [], bl: 'BL-640', total: null, notes: [] }, { bls: ['BL-64', 'BL-640'] }).bl, 'BL-640');
  assert.match(P.fromAi({ groups: [], notes: ['это не пакинг-лист'] }, {}).error, /не нашёл.*коробок.*это не пакинг-лист/);
  assert.match(P.fromAi(null, {}).error, /не нашёл/);
  assert.match(P.fromAi({ unit: 'cm', groups: [{ desc: '', l: 6000, w: 40, h: 50, n: 1, row: '2' }], marks: [], bl: null, total: null, notes: [] }, {}).error, /вне 1–500 см/);
});
