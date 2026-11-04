// Доп. склады (js/warehouses.js): одинаковые и похожие склады одного клиента, объединение с переносом отгрузок, возврат.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const W = createRequire(import.meta.url)('../js/warehouses.js');

const wh = (id, bl, name, lat, lon, brand = '') => ({ id, bl, brand, name, lat, lon });
const WS = [
  wh('w5', 'BL-173', 'Склад 2', 41.331085, 69.187245, 'TRUST MEBEL,TRUST LIGHTING'),
  wh('w6', 'BL-173', 'склад  2', 41.331085, 69.187245, ''),                 // то же название и точка — одинаковые
  wh('w7', 'BL-173', 'Склад 1', 41.2, 69.3, 'TRUST MEBEL'),                  // другой склад того же клиента
  wh('w8', 'BL-245', 'MSV', 41.2858, 69.1616), wh('w9', 'BL-0245', 'Ombor', 41.28582, 69.16162),   // одна точка, разные названия (BL-0245 = BL-245)
  wh('w10', 'BL-300', 'Asosiy', 41.30, 69.20), wh('w11', 'BL-300', 'asosiy', 41.33, 69.25),        // одно название, разные места
  wh('w12', 'BL-301', 'A', null, null), wh('w13', 'BL-301', 'A', null, null),                      // без координат, одно название
  wh('w14', 'BL-302', 'Склад 2', 41.331085, 69.187245)                                             // другой клиент в той же точке — не повтор
];

test('группы: одинаковые, одна точка — разные названия, одно название — разные места; другие клиенты не смешиваются', () => {
  const g = W.groups(WS);
  assert.deepEqual(g.map(x => [x.bl, x.kind, x.items.map(w => w.id), x.keep]), [
    ['BL-173', 'same', ['w5', 'w6'], 'w5'], ['BL-245', 'place', ['w8', 'w9'], 'w8'], ['BL-300', 'name', ['w10', 'w11'], 'w10'], ['BL-301', 'same', ['w12', 'w13'], 'w12']]);
  assert.ok(g[2].far > 4000 && g[2].far < 7000, 'разные места: ' + g[2].far + ' м');
  assert.equal(W.groups([wh('a', 'BL-1', 'X', 41.3, 69.2), wh('b', 'BL-1', 'Y', 41.3003, 69.2)]).length, 1, '~33 м — та же точка');
  assert.equal(W.groups([wh('a', 'BL-1', 'X', 41.3, 69.2), wh('b', 'BL-1', 'Y', 41.301, 69.2)]).length, 0, '~110 м — разные склады');
  assert.notEqual(W.groups(WS)[0].sig, W.groups([WS[0], { ...WS[1], name: 'Склад 3' }])[0].sig);
});

test('объединить: оставленный склад дополняется, убранные удаляются, отгрузки с названием убранного — на оставленный', () => {
  const data = { warehouses: WS, shipments: [
    { id: 's1', bl: 'BL-245', loc: 'ombor' }, { id: 's2', bl: 'BL-245', loc: 'MSV' }, { id: 's3', bl: 'BL-999', loc: 'Ombor' },
    { id: 's4', bl: 'BL-173', loc: 'Склад 2' }, { id: 's5', bl: 'BL-173', loc: '41.331085, 69.187245' }] };
  const g = W.groups(WS);
  const r = W.merge(data, [{ keep: 'w6', drop: ['w5'] }, { keep: 'w8', drop: ['w9'] }]);
  assert.equal(r.removed, 2); assert.equal(r.renamed, 1);
  assert.deepEqual(r.data.warehouses.map(w => w.id), ['w6', 'w7', 'w8', 'w10', 'w11', 'w12', 'w13', 'w14']);
  assert.equal(r.data.warehouses[0].brand, 'TRUST MEBEL,TRUST LIGHTING', 'пустой бренд — из убранного');
  assert.deepEqual(r.data.shipments.map(s => s.loc), ['MSV', 'MSV', 'Ombor', 'Склад 2', '41.331085, 69.187245']);   // у чужого BL не трогаем
  assert.equal(data.warehouses.length, WS.length, 'исходные данные не меняются');
  // вернуть
  const back = W.unmerge(r.data, r.undo, 1000);
  assert.equal(back.warehouses.length, WS.length);
  assert.deepEqual(back.warehouses.slice(-2).map(w => [w.id, w.name]), [['w1000_0', 'Склад 2'], ['w1000_1', 'Ombor']]);
  assert.equal(back.warehouses[0].brand, '', 'оставленному — прежние поля');
  assert.deepEqual(back.shipments.map(s => s.loc), data.shipments.map(s => s.loc));
  assert.equal(g.length, 4);
});

test('такой же склад уже есть: BL, название и точка', () => {
  assert.equal(W.findSame(WS, { bl: 'bl-173', name: 'СКЛАД 2', lat: 41.33109, lon: 69.18725 }).id, 'w5');
  assert.equal(W.findSame(WS, { bl: 'BL-173', name: 'Склад 2', lat: 41.33109, lon: 69.18725 }, 'w5').id, 'w6');
  assert.equal(W.findSame(WS, { bl: 'BL-173', name: 'Склад 3', lat: 41.331085, lon: 69.187245 }), null);
  assert.equal(W.findSame(WS, { bl: 'BL-174', name: 'Склад 2', lat: 41.331085, lon: 69.187245 }), null);
});
