// Коробки по пакинг-листу: разбор текста «60×40×50×12», укладка в кузов, 3D-раскладка по коробкам. Данные выдуманные.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const win = {};
new Function('window', fs.readFileSync(new URL('../js/logi-engine.js', import.meta.url), 'utf8'))(win);
const vw = {};
new Function('window', fs.readFileSync(new URL('../js/logi-viz.js', import.meta.url), 'utf8'))(vw);
const E = win.LogiEngine, V = vw.LogiViz;

test('parseBoxes: группы через «;», размеры через × x * х, штук в конце, впереди или без («одна коробка»), одинаковые — складываются', () => {
  assert.deepEqual(E.parseBoxes('60×40×50×12; 80x60x40 ×3'), { list: [{ l: 60, w: 40, h: 50, n: 12 }, { l: 80, w: 60, h: 40, n: 3 }], n: 15, m3: 2.016 });
  assert.deepEqual(E.parseBoxes('12 шт 60*40*50\n60х40х50 - 3\n100×50×50'), { list: [{ l: 60, w: 40, h: 50, n: 15 }, { l: 100, w: 50, h: 50, n: 1 }], n: 16, m3: 2.05 });
  assert.deepEqual(E.parseBoxes('52,5×21×14.5×162 кор'), { list: [{ l: 52.5, w: 21, h: 14.5, n: 162 }], n: 162, m3: 2.59 });
  assert.deepEqual(E.parseBoxes(''), { list: [], n: 0, m3: 0 });
  assert.match(E.parseBoxes('большие коробки').error, /^Не понял «большие коробки»/);
  assert.match(E.parseBoxes('60×40').error, /Не понял/);
  assert.match(E.parseBoxes('600×40×50').error, /от 1 до 500 см/);
  assert.match(E.parseBoxes('60×40×50×0').error, /Число коробок/);
  assert.equal(E.boxesText([{ l: 60, w: 40, h: 50, n: 12 }, { l: 52.5, w: 21, h: 14.5, n: 1 }]), '60×40×50×12; 52,5×21×14,5×1');
});

const body = { l: 4.2, w: 2.1, h: 2.2 };   // Gazel внутри

test('packBoxes: одинаковые коробки — столбиками в стенки, занятая длина по числу стенок; поворот — больше коробок на метр', () => {
  // 60×40×50 см стоя: поперёк 2,1 / 0,6 = 3, ввысь 2,2 / 0,5 = 4 → 12 в стенке глубиной 0,4; 24 коробки — 2 стенки = 0,8 м
  const r = V.packBoxes([{ p: 1, l: 0.6, w: 0.4, h: 0.5, n: 24 }], body);
  assert.equal(r.boxes.length, 24); assert.equal(r.overN, 0); assert.equal(r.bigN, 0);
  assert.ok(Math.abs(r.usedLen - 0.8) < 1e-6, 'занято 0,8 м: ' + r.usedLen);
  const first = r.boxes[0];
  assert.deepEqual([first.x, first.y, first.z], [0, 0, 0]);
  assert.ok(r.boxes.every(q => q.x + q.dx <= body.l + 1e-9 && q.y + q.dy <= body.h + 1e-9 && q.z + q.dz <= body.w + 1e-9), 'все в кузове');
  // коробки не пересекаются
  const hit = (a, b) => a.x < b.x + b.dx - 1e-9 && b.x < a.x + a.dx - 1e-9 && a.y < b.y + b.dy - 1e-9 && b.y < a.y + a.dy - 1e-9 && a.z < b.z + b.dz - 1e-9 && b.z < a.z + a.dz - 1e-9;
  for (let i = 0; i < r.boxes.length; i++) for (let j = i + 1; j < r.boxes.length; j++) assert.ok(!hit(r.boxes[i], r.boxes[j]), 'пересечение ' + i + '/' + j);
});

test('packBoxes: не помещается — коробки за дверями (over), слишком большая в сечение — big; длинный профиль ложится вдоль', () => {
  const r = V.packBoxes([{ p: 1, l: 1, w: 1, h: 1, n: 10 }], body);   // 2 × 2 в стенке по 1 м → 3 стенки (12) влезут в 4,2? 2 в ряд поперёк, 2 ввысь = 4 на стенку; 10 → 3 стенки = 3 м
  assert.equal(r.overN, 0); assert.ok(Math.abs(r.usedLen - 3) < 1e-6);
  const r2 = V.packBoxes([{ p: 1, l: 1, w: 1, h: 1, n: 20 }], body);   // 5 стенок = 5 м > 4,2 — последняя стенка за дверями
  assert.equal(r2.overN, 4); assert.ok(r2.boxes.filter(q => q.over).every(q => q.x >= 4 - 1e-9));
  const r3 = V.packBoxes([{ p: 1, l: 2.5, w: 2.3, h: 0.5, n: 1 }], body);
  assert.equal(r3.bigN, 1); assert.equal(r3.boxes.length, 0);
  const r4 = V.packBoxes([{ p: 1, l: 3.08, w: 0.225, h: 0.105, n: 40 }], body);   // алюминиевый профиль: вдоль кузова
  assert.equal(r4.overN, 0); assert.ok(r4.boxes.every(q => Math.abs(q.dx - 3.08) < 1e-9), 'длинная сторона вдоль');
});

test('packBoxes: точки по порядку — первая группа глубже всех; следующая группа добирает свободную ширину последней стенки', () => {
  const r = V.packBoxes([{ p: 2, l: 1, w: 1, h: 2, n: 2 }, { p: 1, l: 0.5, w: 0.5, h: 0.5, n: 8 }], body);   // 2 × (1×2 стоя) поперёк = 2 м, остаётся 0,1 → мелкие в новую стенку? 0,5 > 0,1 — новая стенка
  const p2 = r.boxes.filter(q => q.p === 2), p1 = r.boxes.filter(q => q.p === 1);
  assert.ok(Math.max(...p2.map(q => q.x + q.dx)) <= Math.min(...p1.map(q => q.x)) + 1e-9, 'точка 2 ближе к кабине');
  const r2 = V.packBoxes([{ p: 2, l: 1, w: 1, h: 1, n: 1 }, { p: 1, l: 0.5, w: 0.5, h: 0.5, n: 4 }], body);   // 1 м³ занимает 1 из 2,1 ширины; мелкие — рядом в той же стенке
  assert.ok(r2.boxes.filter(q => q.p === 1).every(q => q.x === 0), 'мелкие в первой стенке рядом с большой');
  assert.ok(Math.abs(r2.usedLen - 1) < 1e-9);
});

const trip = (stops, dims) => ({ name: 'Gazel-1', kind: 'gazel', vehicle: { kind: 'gazel', label: 'Gazel', nomM3: 19.4, nomKg: 4000, fill: 0.88, dims: dims === undefined ? { l: 4.2, w: 2.1, h: 2.2 } : dims }, stops });

test('layout по коробкам: коробки своих размеров, точка без списка — условный блок, итог — занятая длина и «не помещается»', () => {
  const L = V.layout(trip([{ bl: 'A', cbm: 2, kg: 300, boxList: [{ l: 60, w: 40, h: 50, n: 24 }] }, { bl: 'B', cbm: 3, kg: 400 }]));
  assert.equal(L.byBoxes, true); assert.equal(L.cells.length, 0);
  assert.equal(L.boxes.filter(q => !q.approx).length, 24); assert.equal(L.boxes.filter(q => q.approx).length, 1);
  assert.deepEqual([L.pack.n, L.pack.approxN, L.pack.overN, L.pack.bigN], [24, 1, 0, 0]);
  const blk = L.boxes.find(q => q.approx);
  assert.ok(Math.abs(blk.sx - 3 / 0.88 / (2.1 * 2.2)) < 1e-9 && blk.sz === 2.1 && blk.sy === 2.2, 'блок точки B на весь поперечник: ' + JSON.stringify(blk));
  assert.ok(blk.cx < L.boxes.find(q => !q.approx).cx, 'точка 2 (последняя) глубже точки 1');
  assert.ok(Math.abs(L.usedLen - (blk.sx + 0.8)) < 1e-9);
  assert.equal(L.overM3, 0); assert.ok(L.points[0].boxN === 24 && L.points[0].top > 0 && L.points[0].x > 0);
  // не помещается: 200 коробок 60×40×50 — 17 стенок по 0,4 = 6,8 м > 4,2
  const L2 = V.layout(trip([{ bl: 'A', cbm: 24, kg: 1000, boxList: [{ l: 60, w: 40, h: 50, n: 200 }] }]));
  assert.ok(L2.pack.overN > 0 && L2.overM3 > 0 && L2.boxes.some(q => q.over), 'лишние коробки за дверями');
  // без списков — прежние кубики по объёму, boxes — те же кубики
  const L3 = V.layout(trip([{ bl: 'A', cbm: 2, kg: 300 }]));
  assert.equal(L3.byBoxes, false); assert.ok(L3.cells.length > 0 && L3.boxes.length === L3.cells.length && L3.pack === null);
  // кузова в карточке нет — типичный кузов вида
  const L4 = V.layout(trip([{ bl: 'A', cbm: 2, kg: 300, boxList: [{ l: 60, w: 40, h: 50, n: 2 }] }], null));
  assert.ok(L4.byBoxes && L4.body.w === 2.1 && !L4.body.own);
});
