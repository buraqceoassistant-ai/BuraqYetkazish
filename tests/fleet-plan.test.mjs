// Планы с машинами поимённо (S.vehicles, карточка машины): «в ремонте» не в планах, своя вместимость, имя машины в рейсе.
// Данные выдуманные.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const win = {};
new Function('window', fs.readFileSync(new URL('../js/logi-engine.js', import.meta.url), 'utf8'))(win);
const E = win.LogiEngine;

const S = { depotLat: 41.38, depotLon: 69.23, speed: 25, roadK: 1.3, unloadMin: 15, dayStart: 0.375, tripsPerVehicle: 2, aMaxStops: 12, bcMaxStops: 15, maxPlaces: null,
  gazelM3: 19, gazelKg: 4000, gazelBase: 300000, gazelHeavy: 400000, gazelHeavyKg: 3000, gazelPtIn: 50000, gazelPtOut: 80000, baseIncludesPts: 1, gazelCount: 3,
  laboM3: 3, laboKg: 550, laboBase: 150000, laboPt: 30000, laboBaseIncludesPts: 0, laboCount: 0, smartLabo: 0,
  changanM3: 9, changanKg: 2000, changanBase: null, changanPt: null, changanCount: 0,
  cM3: 50, cKg: 15000, kamazBase: null, kamazPt: null, cTrucks: 1, bTolM3: 5, bTolKg: 500, freeOutM3: 1 };
// по 4 точки в 4 направлениях от склада, по 4 м³ — рейсы по 16 м³
let n = 0;
const stops = () => { n = 0; const out = []; [[0.06, 0], [-0.06, 0], [0, 0.08], [0, -0.08]].forEach(([dy, dx]) => { for (let i = 0; i < 4; i++) out.push({ id: 's' + (++n), bl: 'BL-' + n, cbm: 4, kg: 500, places: 1, lat: 41.38 + dy + i * 0.003, lon: 69.23 + dx + i * 0.003, zone: 'in', client: { district: 'D' } }); }); return out; };
const veh = (name, x = {}) => ({ name, kind: E.vehicleKind(name), m3: null, kg: null, repair: false, ...x });

test('без машин поимённо — как раньше: имена «Вид-N»', () => {
  const P = E.buildPlans(stops(), S);
  assert.ok(P.A.trips.every(t => /^Gazel-\d( · рейс \d)?$/.test(t.name)), P.A.trips.map(t => t.name).join());
});

test('имя рейса — имя машины из автопарка; «Принять план» получает его в carName', () => {
  const P = E.buildPlans(stops(), { ...S, vehicles: [veh('Gazel-Ali'), veh('Gazel-Bek'), veh('Gazel-3'), veh('Kamaz-1')] });
  const names = P.A.trips.map(t => t.carName);
  assert.ok(names.every(x => ['Gazel-Ali', 'Gazel-Bek', 'Gazel-3'].includes(x)), names.join());
  assert.ok(P.A.trips.every(t => t.name.startsWith(t.carName)), P.A.trips.map(t => t.name).join());
});

test('машина в ремонте не идёт в планы: машин вида меньше, её рейсы — у других', () => {
  const P = E.buildPlans(stops(), { ...S, vehicles: [veh('Gazel-1'), veh('Gazel-2', { repair: true }), veh('Gazel-3'), veh('Kamaz-1')] });
  ['A', 'B', 'X'].forEach(k => assert.ok(!P[k].trips.some(t => t.carName === 'Gazel-2'), k + ': ' + P[k].trips.map(t => t.name).join()));
  const cars = new Set(P.A.trips.filter(t => t.kind === 'gazel').map(t => t.carName));
  assert.ok(cars.size <= 2, 'Gazel — две машины: ' + [...cars]);
  assert.ok(!P.A.trips.some(t => t.noVehicle), 'вторым рейсом хватает');
});

test('своя вместимость: маленькой машине — только рейсы, которые в неё помещаются', () => {
  const P = E.buildPlans(stops(), { ...S, vehicles: [veh('Gazel-1'), veh('Gazel-2', { m3: 9 }), veh('Gazel-3'), veh('Kamaz-1')] });
  ['A', 'X'].forEach(k => P[k].trips.filter(t => t.carName === 'Gazel-2').forEach(t => {
    assert.ok(t.cbm <= 9 + 1e-6, k + ': ' + t.name + ' везёт ' + t.cbm + ' м³');
    assert.equal(t.vehicle.nomM3, 9, 'в рейсе — вместимость машины');
  }));
});

test('все машины вида маленькие — рейсы строятся по их вместимости', () => {
  const P = E.buildPlans(stops(), { ...S, vehicles: [veh('Gazel-1', { m3: 9 }), veh('Gazel-2', { m3: 9 }), veh('Gazel-3', { m3: 9 }), veh('Kamaz-1')] });
  const g = P.A.trips.filter(t => t.kind === 'gazel');
  assert.ok(g.length && g.every(t => t.cbm <= 9 + 1e-6 && t.vehicle.nomM3 === 9), g.map(t => t.name + ':' + t.cbm).join());
});

test('«Машин в автопарке» больше, чем названных: недостающие — «Вид-N» с вместимостью вида', () => {
  const P = E.buildPlans(stops(), { ...S, gazelCount: 3, vehicles: [veh('Gazel-Ali'), veh('Kamaz-1')] });
  const names = [...new Set(P.A.trips.filter(t => t.kind === 'gazel').map(t => t.carName))].sort();
  assert.ok(names.every(x => ['Gazel-1', 'Gazel-2', 'Gazel-Ali'].includes(x)), names.join());
});

// группы по 3 мелких клиента (0,9 м³) в разных концах города: каждая группа — ровно Labo; Labo дешевле Gazel
const groups = k => { const out = []; let m = 0;
  for (let g = 0; g < k; g++) { const a = g * 2 * Math.PI / k;
    for (let i = 0; i < 3; i++) out.push({ id: 'g' + (++m), bl: 'BL-G' + m, cbm: 0.9, kg: 120, places: 2, lat: 41.38 + 0.11 * Math.sin(a) + i * 0.002, lon: 69.23 + 0.14 * Math.cos(a) + i * 0.002, zone: 'in', client: { district: 'G' + g } }); }
  return out; };
const SL = { ...S, gazelCount: 9, laboCount: 1, smartLabo: 1, laboBase: 150000, laboPt: 30000 };

test('рейсов Labo — не больше, чем Labo в автопарке, пока есть свободные Gazel; «нет машины» нет', () => {
  const P = E.buildPlans(groups(6), SL);
  ['A', 'B', 'X'].forEach(k => {
    const ts = P[k].trips, labo = ts.filter(t => t.kind === 'labo');
    assert.ok(labo.length <= 1, k + ': рейсов Labo ' + labo.length + ' — ' + ts.map(t => t.name).join());
    assert.ok(!ts.some(t => t.noVehicle || t.round > 1), k + ': ' + ts.map(t => t.name).join());
    assert.equal(ts.reduce((a, t) => a + t.stops.length, 0), 18, k + ': все точки в плане');
  });
});

test('второй рейс — только когда заняты все машины', () => {
  // 1 Gazel и 1 Labo, груза больше, чем на один круг: второй круг есть, но у каждой машины сначала первый рейс
  const P = E.buildPlans(groups(6), { ...SL, gazelCount: 1, cTrucks: 0, aMaxStops: 6, bcMaxStops: 6 });
  ['A', 'B'].forEach(k => {
    const ts = P[k].trips, kinds = new Set(ts.filter(t => (t.round || 1) === 1).map(t => t.kind));
    assert.ok(kinds.has('labo') && kinds.has('gazel'), k + ': первый круг у обеих машин — ' + ts.map(t => t.name).join());
    assert.ok(ts.some(t => t.round === 2), k + ': второй круг, раз машин не хватает — ' + ts.map(t => t.name).join());
  });
});

// скрипт 31: кузов машины (Sozlamalar K:M) — рейсу на этой машине, по нему 3D рисует кузов
test('кузов из карточки машины — у рейса на ней (vehicle.dims); 3D берёт его вместо типичного', () => {
  const P = E.buildPlans(stops(), { ...S, vehicles: [veh('Gazel-1', { l: 4.2, w: 2.1, h: 2.2 }), veh('Gazel-2'), veh('Gazel-3'), veh('Kamaz-1')] });
  const on = P.A.trips.filter(t => t.carName === 'Gazel-1'), other = P.A.trips.filter(t => t.carName && t.carName !== 'Gazel-1');
  assert.ok(on.length && other.length, P.A.trips.map(t => t.name).join());
  on.forEach(t => assert.deepEqual(t.vehicle.dims, { l: 4.2, w: 2.1, h: 2.2 }));
  other.forEach(t => assert.equal(t.vehicle.dims, null));
  const vw = {};
  new Function('window', fs.readFileSync(new URL('../js/logi-viz.js', import.meta.url), 'utf8'))(vw);
  const V = vw.LogiViz, b = V.layout(on[0]).body, g = V.layout(other[0]).body;
  assert.deepEqual([b.l, b.w, b.h, +b.v.toFixed(3), b.own], [4.2, 2.1, 2.2, 19.404, true]);
  assert.ok(!g.own && g.w === 2.1 && g.h === 1.9, 'без кузова — типичные ширина и высота Gazel');
  assert.equal(V.bodyOf('gazel', 19, { l: 0, w: 2, h: 2 }).own, undefined, 'неполный кузов — не берём');
});

test('Shineray — малый грузовик вида changan (как Changan): по названию, марка в подписи; план B берёт Changan/Shineray, когда есть тариф', () => {
  assert.deepEqual(['Shineray', 'Shinaray 2', 'Шинерей', 'Changan', 'Changan-1'].map(E.vehicleKind), ['changan', 'changan', 'changan', 'changan', 'changan']);
  assert.deepEqual(['Shineray', 'Changan-1', 'Gazel Umid'].map(E.vehicleBrand), ['Shineray', 'Changan', 'Gazel']);
  // малый груз в одну сторону: 2 точки по 3 м³ — в план B на Shineray (дешевле Gazel), в план A — тоже
  const S2 = { ...S, changanBase: 180000, changanPt: 40000, changanCount: 1, gazelCount: 2, vehicles: [veh('Shineray', { m3: 8, kg: 1500 }), veh('Gazel Umid'), veh('Gazel Katta', { m3: 35, kg: 4000 })] };
  const P = E.buildPlans([{ id: 'a', bl: 'BL-1', cbm: 3, kg: 300, places: 1, lat: 41.41, lon: 69.23, zone: 'in' }, { id: 'b', bl: 'BL-2', cbm: 3, kg: 300, places: 1, lat: 41.415, lon: 69.232, zone: 'in' }], S2);
  assert.deepEqual([P.B.trips.length, P.B.trips[0].kind, P.B.trips[0].carName], [1, 'changan', 'Shineray']);
  assert.equal(P.A.trips[0].carName, 'Shineray');
});

// автопарк компании: четыре Gazel разной вместимости (17, 18, 23, 35 м³) и Shineray; полезный объём 88%
const OWN = () => ({ ...S, fillPct: 88, gazelCount: 4, laboCount: 0, changanCount: 1, cTrucks: 0, changanBase: 200000, changanPt: 40000,
  vehicles: [veh('Gazel Umid', { m3: 18, kg: 3500 }), veh('Gazel Saidakmal', { m3: 23, kg: 3500 }), veh('Gazel Nuriddin', { m3: 17, kg: 3500 }), veh('Gazel Katta', { m3: 35, kg: 4000 }), veh('Shineray', { m3: 8, kg: 1500 })] });
const cluster = (k, n, cbm, dy, dx) => Array.from({ length: n }, (_, i) => ({ id: k + i, bl: k + '-' + i, cbm, kg: cbm * 100, places: 2, lat: 41.38 + dy + i * 0.002, lon: 69.23 + dx + i * 0.002, zone: 'in' }));

test('машины одного вида разной вместимости: большая Gazel берёт полный груз, рейс — не больше кузова своей машины', () => {
  // одно направление, 28 м³ — помещается только в Gazel Katta (30,8 м³ полезных), а не в 15–20 м³
  const P = E.buildPlans(cluster('N', 7, 4, 0.06, 0), OWN());
  for (const k of ['A', 'B']) {
    const ts = P[k].trips;
    assert.ok(ts.every(t => !t.noVehicle && !t.over), k + ': без «нет машины»');
    assert.ok(ts.every(t => t.cbm <= t.vehicle.m3 + 1e-6), k + ': каждый рейс — в кузов своей машины: ' + ts.map(t => t.carName + ' ' + t.cbm + '/' + t.vehicle.m3).join(', '));
  }
  assert.deepEqual(P.A.trips.map(t => [t.carName, t.cbm]), [['Gazel Katta', 28]], 'один рейс на большой Gazel');
  // классы в плане: четыре Gazel разной вместимости — четыре класса по возрастанию, Shineray — свой
  assert.deepEqual(P.A.fleet.filter(v => v.kind === 'gazel').map(v => [v.useM3, v.count]), [[14.96, 1], [15.84, 1], [20.24, 1], [30.8, 1]]);
});

test('груза больше, чем у большой машины за день: лишние рейсы — на маленькие машины, а не «нет машины»', () => {
  // четыре направления по 22–30 м³: 104 м³ — больше, чем Gazel Katta за два рейса; план раскладывает на все машины
  const st = cluster('N', 7, 4, 0.07, 0).concat(cluster('S', 6, 4, -0.07, 0), cluster('E', 6, 4.5, 0, 0.09), cluster('W', 6, 4, 0, -0.09));
  const P = E.buildPlans(st, OWN());
  const A = P.A.trips, cars = [...new Set(A.map(t => t.carName))];
  assert.ok(A.every(t => !t.noVehicle && !t.over && t.cbm <= t.vehicle.m3 + 1e-6), 'все рейсы в кузов своей машины: ' + A.map(t => t.name + ' ' + t.cbm + '/' + t.vehicle.m3).join(', '));
  assert.ok(A.filter(t => t.carName === 'Gazel Katta').length <= 2, 'Gazel Katta — не больше двух рейсов');
  assert.ok(cars.length >= 3, 'работают разные машины: ' + cars.join(', '));
  assert.ok(Math.abs(A.reduce((a, t) => a + t.cbm, 0) - st.reduce((a, s) => a + s.cbm, 0)) < 1e-6, 'весь груз в плане');
});

test('машин вида 0 — вида нет в планах (Labo с тарифом не появляется); число не задано — без ограничения, как раньше', () => {
  const st = cluster('N', 2, 1, 0.06, 0);   // 2 м³ — Labo дешевле Gazel
  const S1 = { ...OWN(), laboCount: 0, laboBase: 150000, laboPt: 30000, smartLabo: 1 };
  assert.ok(E.buildPlans(st, S1).A.trips.every(t => t.kind !== 'labo'), 'laboCount 0 — без Labo');
  assert.ok(E.buildPlans(st, { ...S1, laboCount: null }).A.trips.some(t => t.kind === 'labo'), 'laboCount не задан — Labo можно');
  const P = E.buildPlans(st, { ...OWN(), cTrucks: 0 });
  assert.equal(P.C.noFleet || P.C.trips.length === 0, true, 'Kamaz 0 — плана C нет');
});
