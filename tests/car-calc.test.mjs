// Новая машина (js/car-calc.js): какие рейсы возьмёт, расходы в месяц, наличные или лизинг, окупаемость.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const C = createRequire(import.meta.url)('../js/car-calc.js');

const trip = (price, km, cbm, kg) => ({ price, km, cbm, kg });
const near = (a, b, eps = 1) => assert.ok(Math.abs(a - b) <= eps, a + ' ≈ ' + b);

test('аннуитет: как в банковском калькуляторе; 0 % — поровну', () => {
  near(C.annuity(1000000, 24, 12), 94559.6, 0.5);   // 1 млн на год под 24 %
  assert.equal(C.annuity(1200, 0, 12), 100);
  assert.equal(C.annuity(0, 20, 12), 0);
});

test('рейсы: самые дорогие из тех, что помещаются, не больше рейсов в день и запаса хода', () => {
  const b = [{ date: '2026-10-01', trips: [trip(500000, 40, 15, 1200), trip(450000, 30, 10, 800), trip(400000, 20, 5, 300), trip(600000, 30, 20, 1000), trip(350000, 10, 3, 2000), trip(0, 10, 1, 10)] }];
  const r = C.calc(b, { m3: 16, kg: 1500, rangeKm: 100, count: 1 }, { fill: 1, perDay: 2 });
  // 20 м³ и 2000 кг не помещаются, без тарифа — не считается; берёт 500 и 450 тыс. (2 рейса в день)
  assert.deepEqual([r.T.all, r.T.fit, r.T.bigger, r.T.taken, r.T.saved, r.T.km], [5, 3, 2, 2, 950000, 70]);
  const r2 = C.calc(b, { m3: 16, kg: 1500, rangeKm: 50, count: 1 }, { fill: 1, perDay: 3 });
  // запас хода 50 км: 40 км + 20 км уже не войдёт, 30 км — тоже; берёт 500 тыс. (40 км), остальные — «не хватило заряда»
  assert.deepEqual([r2.T.taken, r2.T.saved, r2.T.byRange], [1, 500000, 2]);
  const r3 = C.calc(b, { m3: 16, kg: 1500, rangeKm: 0, count: 2 }, { fill: 0.88, perDay: 1 });   // 16 × 0,88 = 14,08 м³: 15 м³ уже не помещается
  assert.deepEqual([r3.T.fit, r3.T.taken, r3.T.saved], [2, 2, 850000]);
});

test('в месяц: среднее на партию × партий в месяц; расходы своей машины; наличные и лизинг', () => {
  // 6 партий за 61 день (2 месяца) → 3 партии в месяц; в каждой — рейс 500 тыс., 50 км
  const b = ['2026-08-01', '2026-08-11', '2026-08-21', '2026-09-01', '2026-09-15', '2026-09-30'].map(date => ({ date, trips: [trip(500000, 50, 10, 500)] }));
  const p = { price: 120000000, kwh100: 30, kwhPrice: 1000, salary: 0, upkeepYear: 0, leaseAdv: 0, leaseRate: 0, leaseMonths: 24 };
  const r = C.calc(b, p, { fill: 1, perDay: 2 });
  near(r.M.perMonth, 6 / (61 / 30.44), 0.01);
  near(r.M.saved, 500000 * r.M.perMonth); near(r.M.energy, 50 * r.M.perMonth * 0.3 * 1000);
  const [cash, lease] = r.V;
  assert.deepEqual(r.V.map(v => v.key), ['cash', 'lease']);   // кредита нет — только наличные и лизинг
  assert.equal(cash.upfront, 120000000); assert.equal(cash.pay, 0); assert.equal(cash.overpay, 0);
  assert.equal(cash.payback, Math.ceil(120000000 / r.M.net));
  assert.equal(lease.upfront, 0); near(lease.pay, 5000000);
  near(cash.five, 60 * r.M.net - 120000000, 5);
  // своя машина дороже наёмных рейсов — не окупается
  const bad = C.calc(b, { ...p, salary: 50000000 }, { fill: 1, perDay: 2 });
  assert.ok(bad.M.net < 0); assert.equal(bad.V[0].payback, null);
});

test('ввод: пустое и неверное — по умолчанию, «партий в месяц» пустое — по данным, машин не меньше одной', () => {
  const p = C.params({ price: '350 000 000', m3: 'abc', count: '0', perMonth: '', kwhPrice: '1 250,5' });
  assert.deepEqual([p.price, p.m3, p.count, p.perMonth, p.kwhPrice, p.name], [350000000, C.DEFAULTS.m3, 1, null, 1250.5, C.DEFAULTS.name]);
  assert.equal(C.calc([], {}).M.saved, 0);
});

test('что нужно, чтобы окупилась: рейсов в месяц, зарплата, цена; кривая окупаемости по месяцам', () => {
  // 3 партии в месяц (6 за 61 день), в каждой — 1 рейс 2 млн, 0 км; водитель 3 млн, ТО 0
  const b = ['2026-08-01', '2026-08-11', '2026-08-21', '2026-09-01', '2026-09-15', '2026-09-30'].map(date => ({ date, trips: [trip(2000000, 0, 10, 500)] }));
  const r = C.calc(b, { price: 60000000, salary: 3000000, upkeepYear: 0, perMonth: 3, leaseAdv: 100 }, { fill: 1, perDay: 2 });
  near(r.M.net, 3000000);                          // 3 рейса × 2 млн − 3 млн
  assert.equal(r.B.perTrip, 2000000); assert.equal(r.B.tripsEven, 1.5);   // 3 млн / 2 млн
  near(r.B.tripsIn3y, (3000000 + 60000000 / 36) / 2000000, 0.001);
  near(r.B.maxSalary, 6000000); near(r.B.maxPrice3y, 3000000 * 36);
  assert.equal(r.B.cap, 2 * 3); assert.equal(r.B.fitMonth, 3);
  const cash = r.V[0];
  assert.equal(cash.curve.length, 61); assert.equal(cash.curve[0], -60000000); near(cash.curve[20], 0); assert.equal(cash.payback, 20);
});

test('лизинг: окупилась — только когда итог больше не уходит в минус (платежи идут и после первого «плюса»)', () => {
  // аванс 0, экономия 1 млн в месяц, платёж лизинга больше экономии — итог в минусе весь срок, после выплаты растёт
  const b = [{ date: '2026-10-01', trips: [trip(1000000, 0, 5, 100)] }];
  const r = C.calc(b, { price: 24000000, salary: 0, upkeepYear: 0, perMonth: 1, leaseAdv: 0, leaseRate: 0, leaseMonths: 12 }, { fill: 1, perDay: 2 });
  const lease = r.V[1];
  near(lease.pay, 2000000); assert.ok(lease.curve[12] < 0);
  assert.equal(lease.payback, 24);                 // −12 млн за год лизинга, потом +1 млн в месяц → ноль на 24-м
  assert.equal(r.V[0].payback, 24);                // наличными: 24 млн / 1 млн
});
