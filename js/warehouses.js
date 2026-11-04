/* Дополнительные склады клиентов: одинаковые и похожие склады одного клиента — найти и оставить один.
   Одинаковые — тот же BL («BL-03» = «BL-3»), то же название (без регистра и лишних пробелов) и та же точка (ближе 50 м)
   или у обоих нет координат. Похожие — тот же BL и та же точка с разными названиями или одно название в разных местах.
   При объединении остаётся выбранный склад (пустые поля дополняются из остальных); отгрузки, у которых точка записана
   названием убранного склада, переходят на название оставленного. Подключается в index.html («Клиенты» →
   «Дополнительные склады», «Проверка данных»), в node — тесты (tests/warehouses.test.mjs). */
(function (root) {
  'use strict';
  const NEAR_M = 50;
  const S = v => v == null ? '' : String(v).replace(/\s+/g, ' ').trim();
  const nameKey = s => S(s).toUpperCase().replace(/[\s.,;:'"«»‘’`№#-]+/g, ' ').trim();
  const blKey = bl => { const m = S(bl).toUpperCase().match(/^([A-Z]{2,4})\s*[-_.№#]?\s*0*(\d{1,6})$/); return m ? m[1] + '-' + m[2] : S(bl).toUpperCase(); };
  const has = w => w.lat != null && w.lon != null && w.lat !== '' && w.lon !== '' && !isNaN(+w.lat) && !isNaN(+w.lon);
  // расстояние в метрах
  function meters(a, b) {
    const R = 6371000, r = x => x * Math.PI / 180, dLa = r(b.lat - a.lat), dLo = r(b.lon - a.lon);
    const h = Math.sin(dLa / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLo / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  const samePlace = (a, b) => (!has(a) && !has(b)) || (has(a) && has(b) && meters({ lat: +a.lat, lon: +a.lon }, { lat: +b.lat, lon: +b.lon }) <= NEAR_M);
  const sameName = (a, b) => !!nameKey(a.name) && nameKey(a.name) === nameKey(b.name);
  // какой оставить: больше заполненных полей, при равенстве — первый (строка выше в таблице)
  const filled = w => [w.brand, w.name].filter(x => S(x)).length + (has(w) ? 2 : 0);
  // отпечаток группы — для «Оставить все» (группа больше не предлагается, пока склады те же)
  const sig = items => items.map(w => [w.id, blKey(w.bl), nameKey(w.name), has(w) ? (+w.lat).toFixed(5) + ',' + (+w.lon).toFixed(5) : ''].join('~')).sort().join('|');

  // группы складов одного клиента: kind 'same' — одинаковые, 'place' — одна точка, разные названия, 'name' — одно название, разные точки
  function groups(ws) {
    const list = (ws || []).filter(w => w && S(w.bl)), byBl = new Map();
    list.forEach(w => { const k = blKey(w.bl); if (!byBl.has(k)) byBl.set(k, []); byBl.get(k).push(w); });
    const out = [];
    byBl.forEach(arr => {
      if (arr.length < 2) return;
      const up = arr.map((_, i) => i), find = i => up[i] === i ? i : (up[i] = find(up[i]));
      for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++)
        if (samePlace(arr[i], arr[j]) || sameName(arr[i], arr[j])) up[find(j)] = find(i);
      const by = new Map(); arr.forEach((w, i) => { const r = find(i); if (!by.has(r)) by.set(r, []); by.get(r).push(w); });
      by.forEach(items => {
        if (items.length < 2) return;
        const a = items[0], allPlace = items.every(w => samePlace(a, w)), allName = items.every(w => nameKey(w.name) === nameKey(a.name));
        const kind = allPlace && allName ? 'same' : allPlace ? 'place' : 'name';
        const keep = items.reduce((b, w) => filled(w) > filled(b) ? w : b, items[0]);
        const far = has(a) ? Math.max(...items.filter(has).map(w => meters({ lat: +a.lat, lon: +a.lon }, { lat: +w.lat, lon: +w.lon }))) : 0;
        out.push({ bl: S(a.bl), kind, items, keep: keep.id, far: Math.round(far), sig: sig(items) });
      });
    });
    return out;
  }

  // объединить: picks — [{ keep: id, drop: [id] }]. { data, removed, renamed, undo } (undo — для «Вернуть»)
  function merge(data, picks) {
    const ws = (data.warehouses || []).map(w => ({ ...w })), byId = new Map(ws.map(w => [w.id, w]));
    const drop = new Set(), rename = [], undo = { removed: [], kept: [], ships: [] };
    (picks || []).forEach(p => {
      const k = byId.get(p.keep), ds = (p.drop || []).map(id => byId.get(id)).filter(w => w && w !== k && !drop.has(w.id));
      if (!k || !ds.length) return;
      undo.kept.push({ id: k.id, before: { brand: k.brand, name: k.name, lat: k.lat, lon: k.lon } });
      ds.forEach(d => {
        if (!S(k.brand) && S(d.brand)) k.brand = d.brand;
        if (!S(k.name) && S(d.name)) k.name = d.name;
        if (!has(k) && has(d)) { k.lat = d.lat; k.lon = d.lon; }
        drop.add(d.id); undo.removed.push({ ...(data.warehouses || []).find(w => w.id === d.id) });
      });
      ds.forEach(d => { if (nameKey(d.name) && nameKey(d.name) !== nameKey(k.name)) rename.push({ bl: blKey(k.bl), from: nameKey(d.name), to: k.name }); });
    });
    let renamed = 0;
    const shipments = (data.shipments || []).map(s => {
      const r = rename.find(x => x.bl === blKey(s.bl) && x.from === nameKey(s.loc));
      if (!r || !S(s.loc)) return s;
      renamed++; undo.ships.push({ id: s.id, loc: s.loc });
      return { ...s, loc: r.to };
    });
    return { data: { ...data, warehouses: ws.filter(w => !drop.has(w.id)), shipments }, removed: drop.size, renamed, undo };
  }
  // вернуть объединение: убранные склады — новыми строками, оставленным — прежние поля, отгрузкам — прежняя точка
  function unmerge(data, undo, now) {
    const t = now || Date.now(), kept = new Map((undo.kept || []).map(k => [k.id, k.before])), back = new Map((undo.ships || []).map(s => [s.id, s.loc]));
    const ws = (data.warehouses || []).map(w => kept.has(w.id) ? { ...w, ...kept.get(w.id) } : w)
      .concat((undo.removed || []).map((w, i) => ({ ...w, id: 'w' + t + '_' + i })));
    return { ...data, warehouses: ws, shipments: (data.shipments || []).map(s => back.has(s.id) ? { ...s, loc: back.get(s.id) } : s) };
  }
  // такой же склад уже есть (для «+ Добавить склад» и правки): тот же BL, название и точка
  const findSame = (ws, rec, exceptId) => (ws || []).find(w => w.id !== exceptId && blKey(w.bl) === blKey(rec.bl) && nameKey(w.name) === nameKey(rec.name) && samePlace(w, rec)) || null;

  const API = { groups, merge, unmerge, findSame, sig, meters, NEAR_M };
  root.LogiWarehouses = API;
  if (typeof module === 'object' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
