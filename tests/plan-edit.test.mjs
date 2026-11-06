// Ручная правка плана (вкладка «Планы»): точки переложены по рейсам — машина та же, маршрут, цена и время заново.
// Данные выдуманные.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const win = {};
new Function('window', fs.readFileSync(new URL('../js/logi-engine.js', import.meta.url), 'utf8'))(win);
const E = win.LogiEngine;

const S = { depotLat: 41.38, depotLon: 69.23, speed: 25, roadK: 1.3, unloadMin: 15, dayStart: 0.375, tripsPerVehicle: 2, aMaxStops: 10, bcMaxStops: 15, maxPlaces: null,
  gazelM3: 19, gazelKg: 4000, gazelBase: 450000, gazelHeavy: 500000, gazelHeavyKg: 1500, gazelPtIn: 100000, gazelPtOut: 150000, baseIncludesPts: 1, gazelCount: 3,
  laboM3: 3, laboKg: 550, laboBase: 250000, laboPt: 75000, laboBaseIncludesPts: 1, laboCount: 1, smartLabo: 1,
  changanM3: 9, changanKg: 2000, changanBase: null, changanPt: null, changanCount: 1, cM3: 50, cKg: 15000, kamazBase: null, kamazPt: null, cTrucks: 2, bTolM3: 5, bTolKg: 500, freeOutM3: 1 };
const st = (id, lat, lon, cbm = 6, zone = 'in') => ({ id, bl: id, cbm, kg: cbm * 100, places: 2, lat, lon, zone, client: { district: 'D' } });
// север и юг — по машине, мелкий клиент на востоке
const stops = () => [st('N1', 41.46, 69.24), st('N2', 41.47, 69.25), st('S1', 41.29, 69.22), st('S2', 41.28, 69.21), st('E1', 41.36, 69.36, 1.5)];
const groupsOf = plan => plan.trips.map(t => ({ kind: t.kind, car: t.car, round: t.round, keys: t.stops.map(E.stopKey) }));
const where = (plan, id) => plan.trips.findIndex(t => t.stops.some(s => s.id === id));

test('без правки — тот же план; перенос точки: цена и маршрут заново, машины прежние', () => {
  const P = E.buildPlans(stops(), S), A = P.A;
  const same = P.manual('A', groupsOf(A));
  assert.deepEqual(same.trips.map(t => t.name), A.trips.map(t => t.name));
  assert.equal(same.sum.price, A.sum.price);
  assert.equal(same.manual, true);
  // N2 — в рейс с южными точками
  const g = groupsOf(A), from = where(A, 'N2'), to = where(A, 'S1');
  assert.notEqual(from, to);
  g[from].keys = g[from].keys.filter(k => k !== 'N2#1'); g[to].keys.push('N2#1');
  const M = P.manual('A', g.filter(x => x.keys.length));
  const t = M.trips[where(M, 'N2')];
  assert.ok(t.stops.some(s => s.id === 'S1'), 'N2 едет с S1');
  assert.equal(t.name, A.trips[to].name, 'машина рейса — та же');
  assert.equal(t.price.total, E.priceTrip(t.stops, t.kind, S).total, 'цена рейса — по его точкам');
  assert.equal(M.sum.price, M.trips.reduce((a, x) => a + x.price.total, 0));
  assert.ok(t.stops[0].lat < 41.38, 'маршрут заново: сначала ближние южные точки');
});

test('новый рейс и смена машины: свободная машина вида, иначе второй круг', () => {
  const P = E.buildPlans(stops(), S), A = P.A, g = groupsOf(A), i = where(A, 'E1');
  g[i].keys = g[i].keys.filter(k => k !== 'E1#1');
  g.push({ kind: 'labo', car: null, round: null, keys: ['E1#1'] });
  const M = P.manual('A', g.filter(x => x.keys.length)), t = M.trips[where(M, 'E1')];
  assert.equal(t.kind, 'labo');
  assert.equal(t.stops.length, 1);
  assert.equal(t.price.total, 250000, 'Labo — свой тариф');
  // ещё один рейс Labo: в автопарке одна Labo — второй круг
  const g2 = groupsOf(M), j = where(M, 'S2');
  g2[j].keys = g2[j].keys.filter(k => k !== 'S2#1');
  g2.push({ kind: 'labo', car: null, round: null, keys: ['S2#1'] });
  const M2 = P.manual('A', g2.filter(x => x.keys.length)), t2 = M2.trips[where(M2, 'S2')];
  assert.equal(t2.kind, 'labo');
  assert.equal(t2.round, 2);
  assert.match(t2.name, /рейс 2/);
  assert.ok(t2.overload, 'S2 6 м³ на Labo 3 м³ — сверх кузова');
  // смена вида рейса: Gazel → Labo с теми же точками
  const g3 = groupsOf(A), k = where(A, 'N1');
  g3[k] = { ...g3[k], kind: 'labo', car: null, round: null };
  const M3 = P.manual('A', g3), t3 = M3.trips[where(M3, 'N1')];
  assert.equal(t3.kind, 'labo');
  assert.ok(t3.overload);
});

test('план изменился после правки: новые точки — отдельным рейсом, пропавшие — убраны', () => {
  const P0 = E.buildPlans(stops(), S), g = groupsOf(P0.A);
  const more = stops().filter(s => s.id !== 'S2').concat([st('W1', 41.33, 69.12, 4)]);
  const P = E.buildPlans(more, S), M = P.manual('A', g);
  assert.equal(M.extra, 1, 'W1 — в отдельном рейсе');
  assert.ok(M.trips.some(t => t.stops.length === 1 && t.stops[0].id === 'W1'));
  assert.equal(where(M, 'S2'), -1);
  const ids = M.trips.flatMap(t => t.stops.map(s => s.id)).sort();
  assert.deepEqual(ids, more.map(s => s.id).sort(), 'каждая точка — в одном рейсе');
});

// планы из фонового потока (js/plan-worker.js): без функций, клонированием — на странице к ним только добавляется правка
test('планы из фонового потока: те же рейсы и итоги, ручная правка — как у планов, посчитанных на странице', () => {
  const plain = (v, seen = new Map()) => { if (typeof v === 'function') return undefined; if (!v || typeof v !== 'object') return v; if (seen.has(v)) return seen.get(v);
    const out = Array.isArray(v) ? [] : {}; seen.set(v, out); for (const k of Object.keys(v)) { const x = plain(v[k], seen); if (x !== undefined || Array.isArray(v)) out[k] = x; } return out; };
  const full = E.buildPlans(stops(), S), r = full;
  const pre = structuredClone(plain({ A: r.A, B: r.B, C: r.C, X: r.X, noCoords: r.noCoords }));
  const hyd = E.buildPlans(stops(), S, pre);
  ['A', 'B', 'X'].forEach(k => {
    assert.deepEqual(hyd[k].trips.map(t => [t.name, t.stops.map(s => s.id).join(), t.price.total]), full[k].trips.map(t => [t.name, t.stops.map(s => s.id).join(), t.price.total]), 'план ' + k);
    assert.deepEqual(hyd[k].sum, full[k].sum);
  });
  assert.equal(typeof hyd.manual, 'function'); assert.ok(hyd.cars && hyd.per);
  const g = groupsOf(full.A), from = where(full.A, 'N2'), to = where(full.A, 'S1');
  g[from].keys = g[from].keys.filter(k => k !== 'N2#1'); g[to].keys.push('N2#1');
  const a = full.manual('A', g), b = hyd.manual('A', g);
  assert.deepEqual(b.trips.map(t => [t.name, t.stops.map(s => s.id).join(), t.price.total, t.overload]), a.trips.map(t => [t.name, t.stops.map(s => s.id).join(), t.price.total, t.overload]));
  assert.equal(b.sum.price, a.sum.price);
  // план C сайт не показывает — можно не считать
  assert.equal(E.buildPlans(stops(), { ...S, noPlanC: true }).C.trips.length, 0);
});
