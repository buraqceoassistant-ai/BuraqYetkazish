// План X (пробный): один район — одна машина (districtTrips в js/logi-engine.js). Данные выдуманные.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const win = {};
new Function('window', fs.readFileSync(new URL('../js/logi-engine.js', import.meta.url), 'utf8'))(win);
const E = win.LogiEngine;

// автопарк и тарифы как на сайте: Gazel 19 м³ / 4 000 кг, Labo 3 м³ / 550 кг, Kamaz 50 м³ без тарифа
const S = { depotLat: 41.38, depotLon: 69.23, speed: 25, roadK: 1.3, unloadMin: 15, dayStart: 0.375, tripsPerVehicle: 2, aMaxStops: 12, bcMaxStops: 15, maxPlaces: null,
  gazelM3: 19, gazelKg: 4000, gazelBase: 300000, gazelHeavy: 400000, gazelHeavyKg: 3000, gazelPtIn: 50000, gazelPtOut: 80000, baseIncludesPts: 1, gazelCount: 9,
  laboM3: 3, laboKg: 550, laboBase: 150000, laboPt: 30000, laboBaseIncludesPts: 0, laboCount: 1, smartLabo: 1,
  changanM3: 9, changanKg: 2000, changanBase: null, changanPt: null, changanCount: 1,
  cM3: 50, cKg: 15000, kamazBase: null, kamazPt: null, cTrucks: 2, bTolM3: 5, bTolKg: 500, freeOutM3: 1 };
let n = 0;
// точка района: центр района + сдвиг в километрах (1 км ≈ 0,009° широты, 0,012° долготы)
const pt = (district, [lat, lon], dxKm, dyKm, cbm, kg) => ({ id: 's' + (++n), bl: 'BL-' + n, cbm, kg: kg ?? cbm * 150, places: 1,
  lat: lat + dyKm * 0.009, lon: lon + dxKm * 0.012, zone: 'in', client: { district } });
const C1 = [41.30, 69.20], C2 = [41.31, 69.17], FAR = [41.36, 69.34];   // Chilonzor, Uchtepa рядом (≈ 3 км); Yunusobod далеко (≈ 12 км)
const dOf = s => s.client.district && s.client.district !== 'Aniqlanmagan' ? s.client.district : '';
const tripsOf = (P, d) => P.X.trips.filter(t => t.stops.some(s => dOf(s) === d));

test('план X: есть в buildPlans рядом с A, B, C', () => {
  const P = E.buildPlans([pt('Chilonzor', C1, 0, 0, 5), pt('Uchtepa', C2, 0, 0, 5)], S);
  assert.ok(P.X && Array.isArray(P.X.trips) && P.X.sum && Array.isArray(P.X.districts));
  assert.ok(P.A && P.B && P.C, 'A, B, C на месте');
  assert.equal(P.X.sum.trips, P.X.trips.length);
});

test('каждый район, который помещается в машину, едет целиком одной машиной', () => {
  const st = [0, 1, 2].map(i => pt('Chilonzor', C1, i * 0.5, 0, 5)).concat([0, 1].map(i => pt('Yunusobod', FAR, i * 0.5, 0, 3)))
    .concat([0, 1].map(i => pt('Uchtepa', C2, 0, i * 0.5, 4)));
  const P = E.buildPlans(st, S);
  ['Chilonzor', 'Yunusobod', 'Uchtepa'].forEach(d => assert.equal(tripsOf(P, d).length, 1, d + ' — одна машина'));
  P.X.trips.forEach(t => assert.ok(t.cbm <= S.gazelM3 + 1e-6 || t.kind === 'kamaz', 'Gazel строго по кузову: ' + t.cbm));
  assert.deepEqual(P.X.districts, [], 'больших районов нет');
});

test('большой район: полный рейс — дальние от соседа точки, остаток — с машиной соседнего района', () => {
  const big = [0, 1, 2, 3, 4, 5].map(i => pt('Chilonzor', C1, i * 0.6, 0, 4));    // 24 м³ — больше Gazel; точка 0 — ближе всех к Uchtepa (он западнее)
  const nb = [0, 1].map(i => pt('Uchtepa', C2, 0, i * 0.4, 3));                   // 6 м³: остаток 8 м³ + 6 м³ помещается в Gazel
  const P = E.buildPlans(big.concat(nb), S);
  const ch = tripsOf(P, 'Chilonzor'), uc = tripsOf(P, 'Uchtepa');
  assert.equal(uc.length, 1, 'Uchtepa — одна машина');
  assert.equal(ch.length, 2, 'Chilonzor — две машины: полная и соседа');
  const withNb = uc[0], own = ch.find(t => t !== withNb);
  assert.ok(own && own.stops.every(s => dOf(s) === 'Chilonzor'), 'полный рейс — только Chilonzor');
  const moved = withNb.stops.filter(s => dOf(s) === 'Chilonzor').map(s => s.bl);
  assert.ok(moved.length > 0 && moved.includes(big[0].bl), 'к соседу уходят ближайшие к нему точки: ' + moved);
  assert.ok(!moved.includes(big[5].bl), 'самая дальняя от соседа точка — в полном рейсе');
  assert.deepEqual(P.X.districts.map(x => [x.district, x.trips, x.neighbor]), [['Chilonzor', 2, 'Uchtepa']]);
  P.X.trips.forEach(t => assert.ok(t.cbm <= S.gazelM3 + 1e-6, 'без перегруза: ' + t.cbm));
});

test('малые районы: сначала соседние, дальний — отдельно, если вместе не помещаются', () => {
  const st = [pt('Chilonzor', C1, 0, 0, 8), pt('Uchtepa', C2, 0, 0, 8), pt('Yunusobod', FAR, 0, 0, 8)];   // любые два — 16 м³, все три — 24 м³
  const P = E.buildPlans(st, S);
  assert.equal(P.X.trips.length, 2);
  const pair = P.X.trips.find(t => t.stops.length === 2);
  assert.deepEqual(pair.stops.map(dOf).sort(), ['Chilonzor', 'Uchtepa'], 'вместе — соседние районы');
});

test('машина с местом берёт и дальний район, если так дешевле', () => {
  // 4 далёких района по 2 м³: четыре Labo по одной точке дороже одной Gazel на все
  const st = [pt('Chilonzor', C1, 0, 0, 2), pt('Yunusobod', FAR, 0, 0, 2), pt('Sergeli', [41.22, 69.22], 0, 0, 2), pt('Yashnobod', [41.30, 69.34], 0, 0, 2)];
  const P = E.buildPlans(st, S);
  assert.equal(P.X.trips.length, 1, 'всё помещается в одну машину — один рейс, как в плане A');
});

test('клиенты без района — отдельная группа (пусто и «Aniqlanmagan» — одна группа)', () => {
  const st = [pt('', C1, 0, 0, 7), pt('Aniqlanmagan', C1, 0.5, 0, 7), pt('Chilonzor', C1, 0.2, 0.2, 10), pt('Chilonzor', C1, 0.3, 0.1, 5)];
  const P = E.buildPlans(st, S);
  const none = P.X.trips.filter(t => t.stops.some(s => !dOf(s)));
  assert.equal(none.length, 1, 'без района — одна машина');
  assert.equal(tripsOf(P, 'Chilonzor').length, 1, 'Chilonzor — одна машина');
});

test('загрузка как в плане A: груз больше Gazel — Kamaz, остальное района — Gazel', () => {
  const st = [pt('Chilonzor', C1, 0, 0, 25, 3000), pt('Chilonzor', C1, 0.5, 0, 4), pt('Chilonzor', C1, 1, 0, 4)];
  const P = E.buildPlans(st, S);
  const kz = P.X.trips.filter(t => t.kind === 'kamaz');
  assert.equal(kz.length, 1);
  assert.deepEqual(kz[0].stops.map(s => s.cbm), [25], 'Kamaz — только груз, который не влезает в Gazel');
  assert.ok(P.X.trips.filter(t => t.kind !== 'kamaz').every(t => t.cbm <= 19 + 1e-6));
  assert.equal(P.X.districts[0].big, 1, 'в заметке — груз только для Kamaz');
});

test('без координат — в планах как точка у склада: «без точки», своя доплата за точку; список — для заметки', () => {
  const st = [pt('Chilonzor', C1, 0, 0, 5), { ...pt('Chilonzor', C1, 0, 0, 5), lat: null, lon: null }];
  const P = E.buildPlans(st, S);
  for (const k of ['A', 'B', 'X']) {
    const all = P[k].trips.flatMap(t => t.stops);
    assert.equal(all.length, 2, k + ': обе отгрузки в плане');
    const nl = all.find(x => x.noLoc);
    assert.ok(nl && nl.lat === S.depotLat && nl.lon === S.depotLon && nl.zone === 'in', k + ': без точки — у склада, тариф внутри кольца');
  }
  assert.equal(P.noCoords.length, 1);
  assert.equal(st[1].lat, null, 'исходная отгрузка не меняется');
  // две отгрузки без координат — два места (цена за каждую точку), а не «одно место» у склада
  const two = [{ id: 'n1', bl: 'BL-N1', cbm: 1, kg: 100, lat: S.depotLat, lon: S.depotLon, noLoc: true, zone: 'in' }, { id: 'n2', bl: 'BL-N2', cbm: 1, kg: 100, lat: S.depotLat, lon: S.depotLon, noLoc: true, zone: 'in' }];
  const near = two.map(x => ({ ...x, noLoc: false }));
  assert.ok(E.priceTrip(two, 'gazel', S).total > E.priceTrip(near, 'gazel', S).total, 'без точки — каждая отгрузка своя точка');
  // склад без координат — как раньше: без координат в планы не входят
  const P0 = E.buildPlans([pt('Chilonzor', C1, 0, 0, 5), { ...pt('Chilonzor', C1, 0, 0, 5), lat: null, lon: null }], { ...S, depotLat: null, depotLon: null });
  assert.ok(!P0.A.trips.some(t => t.stops.some(x => x.noLoc)));
});
