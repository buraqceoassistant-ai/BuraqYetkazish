// Партии (js/batches.js): сводка, похожие на повтор, удалить, перенести / объединить, корзина и возврат.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const B = createRequire(import.meta.url)('../js/batches.js');

const sh = (id, date, bl, cbm, kg, extra = {}) => ({ id, date, bl, cbm, kg, places: 1, truck: 'Belgilanmagan', route: null, status: 'Rejada', note: '', ...extra });
const data = () => ({ clients: [{ bl: 'BL-1' }, { bl: 'BL-2' }, { bl: 'BL-3' }], shipments: [
  sh('s5', '2026-10-01', 'BL-1', 1.5, 100, { status: 'Yetkazildi', truck: 'Gazel 1', route: 1 }), sh('s6', '2026-10-01', 'BL-2', 2, 200, { status: 'Yolda', truck: 'Gazel 1', route: 1 }),
  sh('s7', '2026-10-01', 'BL-3', 0.5, 50), sh('s8', '2026-10-01', 'BL-9', 1, 10),
  sh('s9', '2026-10-08', 'BL-1', 1.5, 100), sh('s10', '2026-10-08', 'bl-2', 2, 200), sh('s11', '2026-10-08', 'BL-3', 0.5, 50),
  sh('s12', '2026-10-15', 'BL-1', 3, 300, { status: 'Bekor qilindi' }), sh('s13', '', 'BL-1', 1, 1)] });

test('сводка: новые сверху, отгрузки, клиенты, груз, статусы, машины, BL не из справочника', () => {
  const L = B.summary(data());
  assert.deepEqual(L.map(x => x.date), ['2026-10-15', '2026-10-08', '2026-10-01']);   // строка без даты — не партия
  const o = L[2];
  assert.deepEqual([o.n, o.clients, o.cbm, o.kg, o.places, o.done, o.road, o.cancel, o.trucks, o.planned, o.unknown], [4, 4, 5, 360, 4, 1, 1, 0, 1, 2, 1]);
  assert.equal(L[0].cancel, 1);
});

test('похожие на повтор: 80 % строк (BL, объём, вес) совпадают; маленькие партии не сравниваются', () => {
  const L = B.summary(data()), by = d => L.find(x => x.date === d);
  assert.deepEqual(by('2026-10-08').dupOf.map(x => x.date), ['2026-10-01']);   // 3 из 3 строк есть в партии 01.10 (регистр BL не важен)
  assert.deepEqual(by('2026-10-01').dupOf.map(x => x.date), ['2026-10-08']);
  assert.deepEqual(by('2026-10-15').dupOf, []);
  const d2 = data(); d2.shipments[5].cbm = 9;   // одна из трёх строк другая — 67 % < 80 %
  assert.deepEqual(B.summary(d2).find(x => x.date === '2026-10-08').dupOf, []);
});

test('удалить партии: остальные отгрузки на месте, удалённые — для корзины', () => {
  const r = B.remove(data(), ['2026-10-01', '2026-10-15']);
  assert.deepEqual(r.data.shipments.map(s => s.id), ['s9', 's10', 's11', 's13']);
  assert.deepEqual(r.removed.map(s => s.id), ['s5', 's6', 's7', 's8', 's12']);
  assert.equal(r.data.clients.length, 3);   // справочник клиентов не трогаем
});

test('перенести партию: другая дата, объединение с партией этой даты, неверная дата', () => {
  const m = B.move(data(), '2026-10-15', '2026-10-20');
  assert.deepEqual([m.n, m.merged], [1, false]); assert.equal(m.data.shipments.find(s => s.id === 's12').date, '2026-10-20');
  const j = B.move(data(), '2026-10-08', '2026-10-01');
  assert.deepEqual([j.n, j.merged], [3, true]); assert.equal(B.summary(j.data).find(x => x.date === '2026-10-01').n, 7);
  assert.equal(B.move(data(), '2026-10-08', '2026-10-08').error, 'same');
  assert.equal(B.move(data(), '2026-10-08', '0026-10-08').error, 'date');
  assert.equal(B.move(data(), '2026-11-01', '2026-11-02').error, 'empty');
});

test('корзина: новые сверху, 30 дней, не больше 20; вернуть — новыми строками, без повторов', () => {
  const now = Date.parse('2026-10-30T10:00:00Z'), r = B.remove(data(), ['2026-10-01']);
  let T = B.trashAdd([], { dates: ['2026-10-01'], ships: r.removed }, now);
  assert.equal(T.length, 1); assert.deepEqual(T[0].dates, ['2026-10-01']); assert.equal(T[0].at, '2026-10-30T10:00:00.000Z');
  assert.equal(B.prune(T, now + 31 * 864e5).length, 0);   // старше 30 дней — убраны
  for (let i = 0; i < 25; i++) T = B.trashAdd(T, { dates: ['x'], ships: [r.removed[0]] }, now + i);
  assert.equal(T.length, B.TRASH_MAX);
  const back = B.restore(r.data, { ships: r.removed }, now);
  assert.deepEqual([back.added, back.skipped], [4, 0]);
  assert.ok(back.data.shipments.slice(-4).every(s => /^s\d+_\d$/.test(s.id)));   // новые строки: id не номер строки таблицы
  assert.deepEqual(B.summary(back.data).map(x => [x.date, x.n]), B.summary(data()).map(x => [x.date, x.n]));
  const twice = B.restore(back.data, { ships: r.removed }, now + 1);   // уже вернули — второй раз не добавляется
  assert.deepEqual([twice.added, twice.skipped], [0, 4]);
});
