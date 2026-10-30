/* Партии (все отгрузки одной даты): сводка по партиям, похожие на повтор, удалить, перенести на другую дату
   (или объединить с партией этой даты), корзина удалённых партий на устройстве (30 дней) и возврат из неё.
   Запись в Google Таблицу — как у любой правки журнала: index.html сравнивает данные до и после (diffOps)
   и ставит в очередь удаление строк или новые строки.
   Подключается в index.html (журнал → «🗂 Партии»), в node — тесты (tests/batches.test.mjs). */
(function (root) {
  'use strict';
  const DONE = ['Yetkazildi', 'Mijoz ozi oldi'], ROAD = 'Yolda', CANCEL = 'Bekor qilindi', NO_TRUCK = ['', 'Belgilanmagan', 'Mijoz ozi oladi'];
  const TRASH_DAYS = 30, TRASH_MAX = 20, DUP_SHARE = 0.8, DUP_MIN = 3;
  const r3 = x => Math.round((+x || 0) * 1000) / 1000;
  const okDate = d => /^20\d\d-\d\d-\d\d$/.test(String(d || '')) && !isNaN(Date.parse(d + 'T00:00:00Z'));

  // одна строка отгрузки как «отпечаток» для поиска повторов: BL, объём и вес
  const print = s => String(s.bl || '').trim().toUpperCase() + '|' + r3(s.cbm) + '|' + Math.round(+s.kg || 0);

  // сводка по партиям, новые сверху. clients — справочник (для «BL нет в справочнике»)
  function summary(data) {
    const ships = (data && data.shipments) || [], known = new Set(((data && data.clients) || []).map(c => String(c.bl || '').trim().toUpperCase()));
    const by = new Map();
    ships.forEach(s => { if (!okDate(s.date)) return; if (!by.has(s.date)) by.set(s.date, []); by.get(s.date).push(s); });
    const list = [...by.entries()].map(([date, rows]) => {
      const st = k => rows.filter(s => s.status === k).length, trucks = new Set(), bls = new Set();
      rows.forEach(s => { if (!NO_TRUCK.includes(String(s.truck || '').trim())) trucks.add(String(s.truck).trim()); bls.add(String(s.bl || '').trim().toUpperCase()); });
      return { date, n: rows.length, clients: bls.size, cbm: r3(rows.reduce((a, s) => a + (+s.cbm || 0), 0)), kg: Math.round(rows.reduce((a, s) => a + (+s.kg || 0), 0)),
        places: rows.reduce((a, s) => a + (+s.places || 0), 0), done: rows.filter(s => DONE.includes(s.status)).length, road: st(ROAD), cancel: st(CANCEL),
        trucks: trucks.size, planned: rows.filter(s => !NO_TRUCK.includes(String(s.truck || '').trim())).length,
        unknown: [...bls].filter(b => b && !known.has(b)).length, prints: rows.map(print), dupOf: [] };
    }).sort((a, b) => b.date < a.date ? -1 : b.date > a.date ? 1 : 0);
    // похожие на повтор: у меньшей партии не меньше 80 % строк (BL, объём, вес) такие же, как в другой
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j], small = a.n <= b.n ? a : b, big = small === a ? b : a;
      if (small.n < DUP_MIN) continue;
      const pool = new Map(); big.prints.forEach(p => pool.set(p, (pool.get(p) || 0) + 1));
      let same = 0; small.prints.forEach(p => { const k = pool.get(p); if (k) { same++; pool.set(p, k - 1); } });
      const share = same / small.n;
      if (share >= DUP_SHARE) { a.dupOf.push({ date: b.date, share }); b.dupOf.push({ date: a.date, share }); }
    }
    list.forEach(x => { delete x.prints; });
    return list;
  }

  // удалить партии: { data — без этих дат, removed — удалённые отгрузки }
  function remove(data, dates) {
    const del = new Set(dates || []);
    const removed = data.shipments.filter(s => del.has(s.date));
    return { data: { ...data, shipments: data.shipments.filter(s => !del.has(s.date)) }, removed };
  }

  // перенести партию на другую дату; если там уже есть партия — объединятся. { data, n, merged } или { error }
  function move(data, from, to) {
    if (!okDate(to)) return { error: 'date' };
    if (to === from) return { error: 'same' };
    const n = data.shipments.filter(s => s.date === from).length;
    if (!n) return { error: 'empty' };
    const merged = data.shipments.some(s => s.date === to);
    return { data: { ...data, shipments: data.shipments.map(s => s.date === from ? { ...s, date: to } : s) }, n, merged };
  }

  // корзина: { id, at, dates, ships } — добавить (новые сверху), убрать старше 30 дней и лишние сверх 20
  function trashAdd(trash, item, now) {
    return prune([{ id: 't' + (now || Date.now()) + Math.random().toString(36).slice(2, 6), at: new Date(now || Date.now()).toISOString(), ...item }].concat(trash || []), now);
  }
  function prune(trash, now) {
    const edge = (now || Date.now()) - TRASH_DAYS * 864e5;
    return (Array.isArray(trash) ? trash : []).filter(t => t && Array.isArray(t.ships) && t.ships.length && Date.parse(t.at) >= edge).slice(0, TRASH_MAX);
  }
  // вернуть из корзины: отгрузки — новыми строками (в таблице допишутся в конец); такие же строки (дата, BL, объём, вес),
  // которые уже есть в журнале, второй раз не добавляются. { data, added, skipped }
  function restore(data, item, now) {
    const have = new Map(); data.shipments.forEach(s => { const k = s.date + '|' + print(s); have.set(k, (have.get(k) || 0) + 1); });
    const t = now || Date.now(), add = [];
    let skipped = 0;
    item.ships.forEach((s, i) => {
      const k = s.date + '|' + print(s), c = have.get(k);
      if (c) { have.set(k, c - 1); skipped++; return; }
      add.push({ ...s, id: 's' + t + '_' + i });
    });
    return { data: { ...data, shipments: data.shipments.concat(add) }, added: add.length, skipped };
  }

  const API = { summary, remove, move, trashAdd, prune, restore, okDate, TRASH_DAYS, TRASH_MAX };
  root.LogiBatches = API;
  if (typeof module === 'object' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
