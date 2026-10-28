// Новая машина (js/car-calc.js): какие рейсы возьмёт, расходы в месяц, наличные или лизинг, окупаемость.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const C = createRequire(import.meta.url)('../js/car-calc.js');

const trip = (price, km, cbm, kg) => ({ price, km, cbm, kg });
const near = (a, b, eps = 1) => assert.ok(Math.abs(a - b) <= eps, a + ' ≈ ' + b);
// без «что ещё учесть» (зарядка, соцналог, простой, зима, продажа, депозит, рост цен) — чтобы цифры считались в уме
const Z = { charger: 0, regFee: 0, parking: 0, payrollTax: 0, downtime: 0, winterLoss: 0, resale: 0, deposit: 0, growth: 0 };

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
  const p = { ...Z, price: 120000000, kwh100: 30, kwhPrice: 1000, salary: 0, upkeepYear: 0, leaseAdv: 0, leaseRate: 0, leaseMonths: 24 };
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
  const r = C.calc(b, { ...Z, price: 60000000, salary: 3000000, upkeepYear: 0, perMonth: 3, leaseAdv: 100 }, { fill: 1, perDay: 2 });
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
  const r = C.calc(b, { ...Z, price: 24000000, salary: 0, upkeepYear: 0, perMonth: 1, leaseAdv: 0, leaseRate: 0, leaseMonths: 12 }, { fill: 1, perDay: 2 });
  const lease = r.V[1];
  near(lease.pay, 2000000); assert.ok(lease.curve[12] < 0);
  assert.equal(lease.payback, 24);                 // −12 млн за год лизинга, потом +1 млн в месяц → ноль на 24-м
  assert.equal(r.V[0].payback, 24);                // наличными: 24 млн / 1 млн
});

test('водитель за рейс, рейсов в день из формы, рейсы вне партий; по годам; один рейс', () => {
  const b = [{ date: '2026-10-01', trips: [trip(600000, 20, 5, 100), trip(500000, 20, 5, 100), trip(400000, 20, 5, 100)] }];
  const base = { ...Z, price: 36000000, salary: 0, driverPerTrip: 100000, upkeepYear: 0, kwh100: 0, perMonth: 10, leaseAdv: 50, leaseRate: 0, leaseMonths: 12 };
  const r = C.calc(b, base, { fill: 1, perDay: 2 });
  assert.equal(r.per, 2); near(r.M.trips, 20); near(r.M.saved, 11000000); near(r.M.salary, 2000000);   // 2 рейса × 10 партий; 600 + 500 тыс.
  const r3 = C.calc(b, { ...base, perDay: 3 }, { fill: 1, perDay: 2 });   // «Рейсов на машину в день» в форме — главнее «Тарифов»
  assert.equal(r3.per, 3); near(r3.M.trips, 30); near(r3.M.saved, 15000000);
  const rx = C.calc(b, { ...base, extraTrips: 10 }, { fill: 1, perDay: 2 });   // +10 рейсов по средней цене взятых (550 тыс.)
  near(rx.M.trips, 30); near(rx.M.saved, 11000000 + 10 * 550000); near(rx.M.km, 20 * 20 + 10 * 20);
  const [cash, lease] = r.V;
  assert.equal(cash.years.length, 5); assert.equal(cash.years[0].paid, 36000000); assert.equal(cash.years[1].paid, 0);
  near(lease.years[0].paid, 18000000 + 12 * 1500000); assert.equal(lease.years[1].paid, 0);
  near(cash.years[0].cum, cash.curve[12]); near(cash.years[0].result, 12 * r.M.net - 36000000);
  near(r.U.hired, 550000); near(r.U.driver, 100000); near(r.U.carCash, 36000000 / 60 / 20);
});

test('сценарии: как сейчас, 3 и 4 рейса в день, водитель за рейс, рейсы вне партий, ещё машина, вместе; самый быстрый', () => {
  const b = ['2026-08-01', '2026-08-15', '2026-09-01', '2026-09-15'].map(date => ({ date, trips: [trip(500000, 30, 5, 100), trip(500000, 30, 5, 100), trip(500000, 30, 5, 100), trip(500000, 30, 5, 100)] }));
  const S = C.scenarios(b, { ...Z, price: 200000000, salary: 7000000, upkeepYear: 12000000 }, { fill: 1, perDay: 2 });
  assert.deepEqual(S.map(s => s.key), ['now', 'per3', 'per4', 'driver', 'extra', 'more', 'combo']);
  const by = k => S.find(s => s.key === k);
  assert.equal(by('per3').r.per, 3); assert.equal(by('driver').r.M.salaryFixed, 0); assert.equal(by('driver').r.p.driverPerTrip, C.DRIVER_TRIP);
  assert.ok(by('per4').r.M.trips > by('now').r.M.trips); assert.equal(by('more').r.p.count, 2);
  assert.ok(by('extra').r.M.saved > by('now').r.M.saved);
  assert.equal(S.filter(s => s.fastest).length >= 1, true); assert.ok(!by('now').fastest);
});

test('что ещё учесть: зарядка и оформление сразу, соцналог, стоянка, простой, зима, продажа через 5 лет, депозит', () => {
  const b = ['2026-08-01', '2026-08-15', '2026-09-01', '2026-09-15'].map(date => ({ date, trips: [trip(1000000, 80, 5, 100), trip(900000, 80, 5, 100)] }));
  const base = { ...Z, price: 100000000, salary: 5000000, upkeepYear: 0, kwh100: 0, perMonth: 4, rangeKm: 200 };
  const r0 = C.calc(b, base, { fill: 1, perDay: 2 });
  assert.equal(r0.T.taken, 8); assert.equal(r0.V[0].upfront, 100000000);
  // зимой запас хода на 25 % меньше: 150 км — второй рейс 80 км уже не войдёт; в месяц — 9 месяцев по 2 рейса, 3 — по 1
  const rw = C.calc(b, { ...base, winterLoss: 25 }, { fill: 1, perDay: 2 });
  assert.deepEqual([rw.T.taken, rw.T.takenW, rw.T.byRange], [8, 4, 0]); assert.deepEqual(rw.T.days.map(d => d.takenW), [1, 1, 1, 1]);
  near(rw.M.trips, 8 * 0.75 + 4 * 0.25, 1e-9); near(rw.M.winterLess, 4); near(rw.M.saved, 7600000 * 0.75 + 4000000 * 0.25);
  assert.equal(C.calc(b, { ...base, winterLoss: 25, rangeKm: 0 }, { fill: 1, perDay: 2 }).T.takenW, 8);   // без ограничения — зима не мешает
  // зарядная станция (одна на склад) и оформление (на машину) — сразу, вместе с машиной
  const rc = C.calc(b, { ...base, count: 2, charger: 10000000, regFee: 1000000 }, { fill: 1, perDay: 2 });
  assert.equal(rc.V[0].upfront, 2 * 100000000 + 10000000 + 2 * 1000000); assert.equal(rc.V[0].overpay, 0);
  // соцналог 12 % сверх зарплаты, стоянка в месяц
  const rt = C.calc(b, { ...base, payrollTax: 12, parking: 500000 }, { fill: 1, perDay: 2 });
  near(rt.M.salary, 5600000); near(rt.M.parking, 500000); near(rt.M.opex, 6100000);
  // простой 10 %: рейсов в месяц меньше на 10 %
  const rd = C.calc(b, { ...base, downtime: 10 }, { fill: 1, perDay: 2 });
  near(rd.M.trips, r0.M.trips * 0.9, 1e-6); near(rd.M.saved, r0.M.saved * 0.9);
  // продажа через 5 лет: 40 % цены — к итогу за 5 лет
  const rs = C.calc(b, { ...base, resale: 40 }, { fill: 1, perDay: 2 });
  near(rs.V[0].fiveSale, rs.V[0].five + 40000000);
  // депозит: накопленный итог растёт (минус — тоже) под процент депозита; окупаемость позже, упущено > 0
  const rp = C.calc(b, { ...base, deposit: 12 }, { fill: 1, perDay: 2 });
  near(rp.V[0].curve[1], -100000000 * 1.01 + r0.M.net);
  assert.ok(rp.V[0].payback > r0.V[0].payback); assert.ok(rp.V[0].lost > 0); assert.equal(r0.V[0].lost, 0);
  // рост цен 10 % в год: со второго года экономия больше на 10 %, по годам — тоже
  const rg = C.calc(b, { ...base, growth: 10 }, { fill: 1, perDay: 2 }), [cg] = rg.V;
  near(cg.curve[12] - cg.curve[11], rg.M.net); near(cg.curve[13] - cg.curve[12], rg.M.net * 1.1); near(cg.years[1].saved, rg.M.saved * 12 * 1.1);
});

test('сценарии: больше рейсов в день не показываем, если машина не возьмёт ни одного рейса больше', () => {
  const b = [{ date: '2026-10-01', trips: [trip(500000, 30, 5, 100), trip(500000, 30, 5, 100)] }];
  const S = C.scenarios(b, { ...Z, price: 100000000 }, { fill: 1, perDay: 2 });
  assert.ok(!S.some(s => s.key === 'per3' || s.key === 'per4'));
  const b3 = [{ date: '2026-10-01', trips: [trip(500000, 30, 5, 100), trip(500000, 30, 5, 100), trip(500000, 30, 5, 100)] }];
  assert.deepEqual(C.scenarios(b3, { ...Z, price: 100000000 }, { fill: 1, perDay: 2 }).filter(s => /^per/.test(s.key)).map(s => s.key), ['per3']);
  // водитель уже за рейс без оклада — сценарий «водитель за рейс» ничего не меняет, его нет
  const Sd = C.scenarios(b3, { ...Z, price: 100000000, salary: 0, driverPerTrip: C.DRIVER_TRIP }, { fill: 1, perDay: 2 });
  assert.ok(!Sd.some(s => s.key === 'driver') && Sd.some(s => s.key === 'combo'));
});
