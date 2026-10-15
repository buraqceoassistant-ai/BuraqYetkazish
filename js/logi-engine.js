(function () {
  const R = 6371;
  const rad = d => d * Math.PI / 180;
  function km(a, b) {
    const dLat = rad(b[0] - a[0]), dLon = rad(b[1] - a[1]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function bearing(o, p) {
    const y = Math.sin(rad(p[1] - o[1])) * Math.cos(rad(p[0]));
    const x = Math.cos(rad(o[0])) * Math.sin(rad(p[0])) - Math.sin(rad(o[0])) * Math.cos(rad(p[0])) * Math.cos(rad(p[1] - o[1]));
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }
  function inside(pt, poly) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [yi, xi] = poly[i], [yj, xj] = poly[j];
      if ((yi > pt[0]) !== (yj > pt[0]) && pt[1] < (xj - xi) * (pt[0] - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  }
  function distToRing(pt, poly) {
    const kx = 111.32 * Math.cos(rad(pt[0])), ky = 110.57;
    let best = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const ax = (a[1] - pt[1]) * kx, ay = (a[0] - pt[0]) * ky, bx = (b[1] - pt[1]) * kx, by = (b[0] - pt[0]) * ky;
      const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
      let t = L ? -(ax * dx + ay * dy) / L : 0; t = Math.max(0, Math.min(1, t));
      best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
    }
    return best;
  }
  function zoneOf(client, ring, buffer) {
    if (!client) return { zone: '', dist: null, border: false };
    if (client.lat == null || client.lon == null) return { zone: '', dist: null, border: false };
    const p = [client.lat, client.lon];
    const d = distToRing(p, ring);
    const mz = String(client.manualZone || '').toLowerCase();
    if (mz === 'ichida' || mz === 'tashqarida') return { zone: mz === 'ichida' ? 'in' : 'out', dist: d, border: false, manual: true };
    return { zone: inside(p, ring) ? 'in' : 'out', dist: d, border: d < (buffer || 1) };
  }

  const NO_PRICE = ['Bekor qilindi', 'Mijoz ozi oldi', 'Qolib ketgan'];
  const NO_PLAN = ['Bekor qilindi', 'Mijoz ozi oldi'];

  // Коробки отгрузки (пакинг-лист) — текст «60×40×50×12; 80×60×40×3»: длина × ширина × высота, см, × штук. Группы —
  // через «;» или с новой строки; размеры — через × x * (и русскую х); «×12» можно опустить — одна коробка; число штук
  // можно писать и впереди («12 шт 60×40×50»). Результат: { list: [{ l, w, h, n }], n, m3 } или { error }.
  const BOX_DIM = /(\d+(?:[.,]\d+)?)\s*[×xX*хХ]\s*(\d+(?:[.,]\d+)?)\s*[×xX*хХ]\s*(\d+(?:[.,]\d+)?)/;
  function parseBoxes(text) {
    const src = String(text || '').trim(), list = [];
    if (!src) return { list, n: 0, m3: 0 };
    for (const g0 of src.split(/[;\n]+/)) {
      const g = g0.trim(); if (!g) continue;
      const m = g.match(BOX_DIM);
      if (!m) return { error: 'Не понял «' + g.slice(0, 30) + '»: нужно длина×ширина×высота в см, например 60×40×50×12' };
      const dims = [m[1], m[2], m[3]].map(x => +String(x).replace(',', '.'));
      const rest = (g.slice(0, m.index) + ' ' + g.slice(m.index + m[0].length)).replace(/(см|cm|sm|шт|кор|pcs|dona|ta|мест)\.?/gi, ' '), nm = rest.match(/\d+/);
      const n = nm ? +nm[0] : 1;
      if (dims.some(x => !(x >= 1 && x <= 500))) return { error: 'Размеры коробки — от 1 до 500 см: «' + g.slice(0, 30) + '»' };
      if (!(n >= 1 && n <= 5000) || !Number.isInteger(n)) return { error: 'Число коробок — от 1 до 5 000: «' + g.slice(0, 30) + '»' };
      const same = list.find(x => x.l === dims[0] && x.w === dims[1] && x.h === dims[2]);
      if (same) same.n += n; else list.push({ l: dims[0], w: dims[1], h: dims[2], n });
    }
    return { list, n: list.reduce((a, x) => a + x.n, 0), m3: Math.round(list.reduce((a, x) => a + x.l * x.w * x.h * x.n, 0) / 1e6 * 1000) / 1000 };
  }
  const boxesText = list => (list || []).map(x => [x.l, x.w, x.h].map(v => String(v).replace('.', ',')).join('×') + '×' + x.n).join('; ');
  // малые грузовики одного класса (≈ 8–9 м³, 1,5–2 т) — вид «changan»: Changan, Shineray (Шинерей)
  const SMALL_TRUCK = /^(changan|shineray|shinaray|шинер[ае]й|шинарай)/i;
  function vehicleKind(truck) {
    if (/^gazel/i.test(truck)) return 'gazel';
    if (/^labo/i.test(truck)) return 'labo';
    if (/^kamaz/i.test(truck)) return 'kamaz';
    if (SMALL_TRUCK.test(truck)) return 'changan';
    return null;
  }
  // марка по названию для подписи: «Shineray» у машины вида changan, иначе подпись вида
  function vehicleBrand(truck) {
    const m = String(truck || '').match(/^(shineray|shinaray|шинер[ае]й|шинарай)/i);
    return m ? 'Shineray' : { gazel: 'Gazel', labo: 'Labo', kamaz: 'Kamaz', changan: 'Changan' }[vehicleKind(truck)] || '';
  }
  // клиенты ближе 200 м друг к другу (один рынок, один дом) — одно место: перевозчик берёт доплату за адрес, а не за клиента
  const PLACE_KM = 0.2;
  // тариф точки машины: заезд внутри кольца и за кольцом (у Labo, Changan и Kamaz — один)
  function pointTariff(kind, S) {
    if (kind === 'labo') return { ptIn: S.laboPt, ptOut: S.laboPt };
    if (kind === 'kamaz') return { ptIn: S.kamazPt, ptOut: S.kamazPt };
    if (kind === 'changan') return { ptIn: S.changanPt, ptOut: S.changanPt };
    return { ptIn: S.gazelPtIn, ptOut: S.gazelPtOut };
  }
  // stops: [{bl, zone, cbm, kg, lat, lon}] in order. kind: gazel|labo|kamaz|auto. Повтор BL и клиент в том же месте
  // (ближе PLACE_KM к уже учтённой точке) — без доплаты; доля такой точки делится между её клиентами по объёму
  function priceTrip(stops, kind, S) {
    const kg = stops.reduce((a, s) => a + (s.kg || 0), 0);
    const cbm = stops.reduce((a, s) => a + (s.cbm || 0), 0);
    let label, base, ptIn, ptOut;
    if (kind === 'auto') kind = (cbm <= S.laboM3 && kg <= S.laboKg) ? 'labo' : 'gazel';
    if (kind === 'labo') { label = 'Labo'; base = S.laboBase; ptIn = ptOut = S.laboPt; }
    else if (kind === 'kamaz') { label = 'Kamaz'; base = S.kamazBase; ptIn = ptOut = S.kamazPt; }
    else if (kind === 'changan') { label = 'Changan'; base = S.changanBase; ptIn = ptOut = S.changanPt; }
    else { const heavy = kg > S.gazelHeavyKg; label = heavy ? 'Gazel (тяжёлый)' : 'Gazel'; base = heavy ? S.gazelHeavy : S.gazelBase; ptIn = S.gazelPtIn; ptOut = S.gazelPtOut; }
    if (base == null || ptIn == null) return { label, kind, total: null, points: 0, formula: 'нет тарифа', perStop: stops.map(() => null) };
    // points already included in the base price: separate setting per vehicle (Gazel B52, Labo B55, Kamaz B56)
    const inc = +(kind === 'labo' ? S.laboBaseIncludesPts : kind === 'kamaz' ? S.kamazBaseIncludesPts : kind === 'changan' ? S.changanBaseIncludesPts : S.baseIncludesPts) || 0;
    const seen = {}, places = []; let idx = 0;
    const pts = [];
    stops.forEach((s, i) => {
      if (seen[s.bl] != null) { pts.push({ dup: seen[s.bl] }); return; }
      const near = s.lat != null && s.lon != null ? places.find(q => km([q.lat, q.lon], [s.lat, s.lon]) <= PLACE_KM) : null;
      if (near) { seen[s.bl] = near.i; pts.push({ dup: near.i, place: true }); return; }
      seen[s.bl] = i; idx++;
      if (s.lat != null && s.lon != null) places.push({ i, lat: s.lat, lon: s.lon });
      const w = s.zone === 'out' ? ptOut : ptIn;
      pts.push({ tariff: idx <= inc ? 0 : w, weight: w, zone: s.zone });
    });
    const uniq = pts.filter(p => p.dup == null);
    const total = base + uniq.reduce((a, p) => a + p.tariff, 0);
    const nIn = uniq.filter(p => p.zone !== 'out' && p.tariff).length, nOut = uniq.filter(p => p.zone === 'out' && p.tariff).length;
    let formula = Math.round(base / 1000) + '';
    if (ptIn === ptOut) { if (nIn + nOut) formula += ' + ' + (nIn + nOut) + '×' + Math.round(ptIn / 1000); }
    else {
      if (nIn) formula += ' + ' + nIn + '×' + Math.round(ptIn / 1000);
      if (nOut) formula += ' + ' + nOut + '×' + Math.round(ptOut / 1000);
    }
    // share: proportional to the zone tariff of the point (also for points included in the base,
    // so the first client does not get a zero share); duplicates split their point by cbm
    const sumW = uniq.reduce((a, p) => a + p.weight, 0);
    const perStop = stops.map(() => 0);
    stops.forEach((s, i) => {
      const p = pts[i]; if (p.dup != null) return;
      const group = stops.map((x, j) => j).filter(j => j === i || pts[j].dup === i);
      const pointShare = total * (sumW ? p.weight / sumW : 1 / uniq.length);
      const gc = group.reduce((a, j) => a + (stops[j].cbm || 0), 0);
      group.forEach(j => { perStop[j] = gc ? pointShare * (stops[j].cbm || 0) / gc : pointShare / group.length; });
    });
    // addr — к какому адресу относится строка (номер первой строки этого адреса); fee — что адрес добавляет к цене рейса
    // у перевозчика: первые адреса — в базе (0), дальше — заезд; у строк того же адреса — null
    return { label, kind, total, base, points: uniq.length, formula: formula + ' тыс.', perStop, dupFlags: pts.map(p => p.dup != null), placeFlags: pts.map(p => !!p.place),
      addr: pts.map((p, i) => p.dup != null ? p.dup : i), fee: pts.map(p => p.dup != null ? null : p.tariff), weight: pts.map(p => p.dup != null ? null : p.weight) };
  }

  // Расходы рейса тремя частями: 1) компания платит — внутри кольца, груз точки от порога (S.freeOutM3, обычно 1 м³);
  // 2) с клиента — груз точки меньше порога (внутри кольца); 3) с клиента — за кольцом, при любом объёме.
  // Рейсы и груз не меняются, делится только цена. С клиента — фиксированно (charge по строкам): заезд по тарифу
  // точки машины, машина только к нему — вся цена рейса; компания — остальное. Точка — BL в рейсе, её объём —
  // отгрузки целиком (у разделённой — вся). Груз без объёма — «компания»: объём неизвестен.
  // (freeOutM3 — имя настройки порога мелкого груза, строка 70 «Sozlamalar».)
  function costSplit(stops, price, S) {
    if (!price || price.total == null) return null;
    const lim = +S.freeOutM3 || 0, vol = {};
    stops.forEach(s => { vol[s.bl] = (vol[s.bl] || 0) + (+(s.whole != null ? s.whole : s.cbm) || 0); });
    const why = stops.map(s => s.zone === 'out' ? 'out' : lim > 0 && vol[s.bl] > 0 && vol[s.bl] < lim - 1e-9 ? 'small' : null);
    // с клиента — фиксированная доплата: заезд по тарифу точки этой машины (за кольцом — свой) — с каждого такого
    // клиента, даже если рядом другие (решение владельца); машина только к нему — вся цена рейса. Больше цены рейса со
    // всех вместе не берём. Доплата клиента делится между его строками по объёму
    const bls = [...new Set(stops.map(s => s.bl))], pt = pointTariff(price.kind, S), fee = {}, addr = price.addr || stops.map((s, i) => i);
    bls.forEach(bl => { const i = stops.findIndex(s => s.bl === bl); if (why[i]) fee[bl] = bls.length === 1 ? price.total : +(why[i] === 'out' ? pt.ptOut : pt.ptIn) || 0; });
    const sum = Object.values(fee).reduce((a, b) => a + b, 0), k = sum > price.total ? price.total / sum : 1;
    const charge = stops.map(() => 0);
    Object.keys(fee).forEach(bl => {
      const idx = stops.map((s, i) => s.bl === bl ? i : -1).filter(i => i >= 0), v = idx.reduce((a, i) => a + (+stops[i].cbm || 0), 0);
      idx.forEach(i => { charge[i] = fee[bl] * k * (v ? (+stops[i].cbm || 0) / v : 1 / idx.length); });
    });
    // доля строки в цене рейса (журнал, отчёты, Excel): у клиента с доплатой — его доплата; остальное (платит компания) —
    // строкам без доплаты: поровну на адрес (по тарифу заезда, как у перевозчика), внутри адреса — по объёму.
    // Все клиенты рейса с доплатой — остаток делится так же между всеми строками. Сумма долей — цена рейса
    const wt = price.weight || [], payer = i => fee[stops[i].bl] == null;
    const anyOurs = stops.some((s, i) => payer(i)), take = i => !anyOurs || payer(i);
    const rest = Math.max(0, price.total - charge.reduce((a, b) => a + b, 0)), share = charge.slice();
    const heads = [...new Set(stops.map((s, i) => i).filter(take).map(i => addr[i]))], sumW = heads.reduce((a, h) => a + (+wt[h] || 1), 0);
    heads.forEach(h => {
      const rows = stops.map((s, i) => i).filter(i => addr[i] === h && take(i)), part = rest * (+wt[h] || 1) / sumW, v = rows.reduce((a, i) => a + (+stops[i].cbm || 0), 0);
      rows.forEach(i => { share[i] += v ? part * (+stops[i].cbm || 0) / v : part / rows.length; });
    });
    const r = { paid: 0, small: 0, outside: 0, why, free: why.map(Boolean), charge, share };
    stops.forEach((s, i) => { if (why[i] === 'out') r.outside += charge[i]; else if (why[i] === 'small') r.small += charge[i]; });
    r.paid = price.total - r.small - r.outside;
    const pts = w => new Set(stops.filter((s, i) => why[i] === w).map(s => s.bl)).size;
    r.smallPts = pts('small'); r.outPts = pts('out'); r.ours = r.paid; r.notPaid = r.small + r.outside;
    return r;
  }


  // Координаты из ссылки на карту или из текста «41.31, 69.27». Понимает Google, Яндекс, 2ГИС, Apple, OSM и geo:.
  // Возвращает { lat, lon, how }; { short: true }, если это короткая ссылка (maps.app.goo.gl, yandex…/maps/-/…),
  // которую сначала надо раскрыть (это делает скрипт таблицы); иначе null. Если широта и долгота перепутаны,
  // они встают на место по границам Узбекистана.
  function coordsFromLink(text) {
    let t = String(text || '').trim();
    if (!t) return null;
    for (let i = 0; i < 3; i++) { let d; try { d = decodeURIComponent(t); } catch (e) { break; } if (d === t) break; t = d; }
    t = t.replace(/\+/g, ' ');
    const NUM = '(-?\\d{1,3}(?:\\.\\d+)?)', SEP = '\\s*,\\s*';
    const rx = src => new RegExp(src.split('N').join(NUM), 'i');
    const uz = (a, b) => a >= 36 && a <= 46.5 && b >= 55 && b <= 74;
    const pair = (a, b, latFirst) => {
      a = +a; b = +b;
      if (!isFinite(a) || !isFinite(b) || (!a && !b)) return null;
      let lat = latFirst ? a : b, lon = latFirst ? b : a;
      if (!uz(lat, lon) && uz(lon, lat)) { const z = lat; lat = lon; lon = z; }
      return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
    };
    // [регулярное выражение, широта первой?, откуда]
    const first = rules => { for (const [r, latFirst, how] of rules) { const m = t.match(r); const p = m && pair(m[1], m[2], latFirst); if (p) return { ...p, how }; } return null; };
    const plain = t.match(rx('^N(?:' + SEP + '|\\s+)N$'));
    if (plain) { const p = pair(plain[1], plain[2], true); return p && { ...p, how: 'координаты' }; }
    if (/^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs|go\.2gis\.com)\//i.test(t) || /yandex\.[a-z.]+\/maps\/-\//i.test(t)) return { short: true };
    if (/yandex\.|ya\.ru\//i.test(t)) {
      const route = (t.match(/rtext=([^&#]*)/i) || [])[1];
      const end = route ? route.split('~').filter(Boolean).pop() : '';
      const m = end && end.match(rx('^N' + SEP + 'N$'));
      const r = first([[rx('[?&](?:pt|poi\\[point\\])=N' + SEP + 'N'), false, 'Яндекс: метка'], [rx('whatshere\\[point\\]=N' + SEP + 'N'), false, 'Яндекс: «Что здесь»'],
        [rx('[?&]text=N' + SEP + 'N(?:&|#|$)'), true, 'Яндекс: поиск по координатам']]);
      if (r) return r;
      if (m) { const p = pair(m[1], m[2], true); if (p) return { ...p, how: 'Яндекс: маршрут' }; }
      return first([[rx('[?&]sll=N' + SEP + 'N'), false, 'Яндекс: точка поиска'], [rx('[?&]ll=N' + SEP + 'N'), false, 'Яндекс: центр карты']]);
    }
    if (/2gis\./i.test(t)) return first([[rx('/geo/[^/?#]*/N' + SEP + 'N'), false, '2ГИС: объект'], [rx('[?&]m=N' + SEP + 'N'), false, '2ГИС: центр карты']]);
    return first([[rx('!3dN!4dN'), true, 'Google: метка'],
      [rx('[?&](?:q|query|destination|daddr|ll|sll|center)=(?:loc:)?N' + SEP + 'N'), true, 'Google: координаты'],
      [rx('/maps/(?:search|place|dir)/(?:[^/]*/)?N' + SEP + 'N'), true, 'Google: координаты'], [rx('@N' + SEP + 'N'), true, 'Google: центр карты'],
      [rx('mlat=N&mlon=N'), true, 'OSM'], [rx('#map=[\\d.]+/N/N'), true, 'OSM'], [rx('^geo:N' + SEP + 'N'), true, 'geo:']]);
  }

  function nnOrder(depot, stops) {
    const left = stops.slice(), out = []; let cur = depot;
    while (left.length) {
      let bi = 0, bd = Infinity;
      left.forEach((s, i) => { const d = km(cur, [s.lat, s.lon]); if (d < bd) { bd = d; bi = i; } });
      const s = left.splice(bi, 1)[0]; out.push(s); cur = [s.lat, s.lon];
    }
    return out;
  }
  // start — minutes from midnight when the trip leaves the depot (default: the start of the day)
  function tripMetrics(depot, stops, S, start) {
    let cur = depot, dist = 0, t = start != null ? start : S.dayStart * 24 * 60; const arrivals = [];
    stops.forEach(s => { const d = km(cur, [s.lat, s.lon]); dist += d; t += d / S.speed * 60 * S.roadK; arrivals.push(t); t += (s.bl === (arrivals.length > 1 ? stops[arrivals.length - 2].bl : null) ? 0 : S.unloadMin); cur = [s.lat, s.lon]; });
    const back = stops.length ? km(cur, depot) : 0;
    return { dist, back, real: (dist + back) * S.roadK, arrivals, finish: t };
  }
  // ---------- planner ----------
  // Every trip gets a vehicle (Labo, Changan, Gazel or Kamaz) that carries its whole load: volume, weight,
  // places and number of points. A shipment bigger than the largest vehicle is split into parts.
  // Among vehicles that fit, the cheapest by tariff wins. In plans A and B Kamaz (and any vehicle without
  // a tariff) carries only cargo that fits no regular vehicle: Gazel first, Kamaz only when it does not fit.
  // Plan B may load a Gazel above its body by a tolerance (bTolM3 / bTolKg), so Kamaz there only takes cargo bigger than that.
  // Plan A keeps every vehicle within its body: Gazel up to gazelM3 / gazelKg.
  const EPS = 1e-6, UNPRICED = 1e8, KM_COST = 1000, MAX_SPREAD = 120;
  const known = s => (s.cbm || 0) > 0 || (s.kg || 0) > 0;
  const small = v => v.kind === 'labo' || v.kind === 'changan';   // груз без объёма и веса на маленькую машину не ставим
  // полезный объём кузова (S.fillPct, %): между коробками воздух — машина берёт меньше, чем объём кузова. 100 — весь объём
  const fillOf = S => { const f = +S.fillPct; return f > 0 && f <= 100 ? f / 100 : 1; };
  const useful = (m3, S) => Math.round(m3 * fillOf(S) * 100) / 100;
  function fleetOf(S, kinds, opt = {}) {
    const fill = fillOf(S), all = {
      labo: { kind: 'labo', label: 'Labo', m3: +S.laboM3, kg: +S.laboKg },
      gazel: { kind: 'gazel', label: 'Gazel', m3: +S.gazelM3, kg: +S.gazelKg },
      changan: { kind: 'changan', label: 'Changan', m3: +S.changanM3, kg: +S.changanKg },
      kamaz: { kind: 'kamaz', label: 'Kamaz', m3: +S.cM3, kg: +S.cKg }
    };
    const onlyIfNeeded = opt.onlyIfNeeded || [], tol = opt.tol || {}, classes = opt.classes || {}, avail = opt.avail || {};
    Object.keys(all).forEach(k => { all[k].nom = all[k].m3; all[k].m3 = useful(all[k].m3, S); });
    // classes (машины автопарка поимённо) — по классу на каждую вместимость вида, по возрастанию: { m3 (полезный), kg, nom, n — машин }.
    // Машины одного вида разной вместимости (Gazel 17 и 35 м³) — разные классы: рейс встаёт в машину по её кузову, а
    // fitFleet знает, сколько машин каждого класса. Без классов — один класс вида с объёмом из настроек, машин без счёта
    const out = [];
    kinds.forEach(k => {
      const base = all[k], cl = (classes[k] || []).length ? classes[k] : [null];
      if (!base || avail[k] === 0) return;
      cl.forEach((c, i) => {
        const v = c ? { ...base, m3: +c.m3, kg: +c.kg, nom: c.nom != null ? +c.nom : +c.m3 } : base;
        if (!(v.m3 > 0 && v.kg > 0)) return;
        const tM3 = Math.max(0, +(tol[k] || {}).m3 || 0), tKg = Math.max(0, +(tol[k] || {}).kg || 0);
        out.push({ ...v, cls: cl.length > 1 ? k + '#' + (i + 1) : k, count: c ? c.n : null, nomM3: v.nom, nomKg: v.kg, useM3: v.m3, fill, tolM3: tM3, tolKg: tKg, m3: v.m3 + tM3, kg: v.kg + tKg, places: +S.maxPlaces || 0,
          priced: priceTrip([{ bl: '-', zone: 'in', cbm: 0, kg: 0 }], k, S).total != null, onlyIfNeeded: onlyIfNeeded.includes(k) });
      });
    });
    return out;
  }
  function load(stops) {
    let cbm = 0, kg = 0, places = 0; const bl = new Set();
    stops.forEach(s => { cbm += s.cbm || 0; kg += s.kg || 0; places += s.places || 0; bl.add(s.bl); });
    return { cbm, kg, places, points: bl.size };
  }
  const fitsIn = (l, v) => l.cbm <= v.m3 + EPS && l.kg <= v.kg + EPS && (!v.places || l.places <= v.places + EPS);
  // load exceeds every vehicle or the point limit — longer segments will not fit either
  const tooBig = (l, fleet, maxStops) => l.points > maxStops || !fleet.some(v => fitsIn(l, v));
  // Направление рейса (планы A и B, S.maxSpread): точки дальше SPREAD_KM от склада лежат в секторе не шире maxSpread
  // градусов — машина едет в одну сторону. Так мелкий груз и точки за кольцом едут попутно с машиной своего
  // направления, а не крюком через весь город. Точки у склада (ближе SPREAD_KM) — в любой рейс.
  const SPREAD_KM = 3;
  function spreadOk(stops, S, depot) {
    if (!S.maxSpread) return true;
    const a = stops.filter(s => s.lat != null && (s.depotKm != null ? s.depotKm : km(depot, [s.lat, s.lon])) > SPREAD_KM)
      .map(s => s.angle != null ? s.angle : bearing(depot, [s.lat, s.lon])).sort((x, y) => x - y);
    if (a.length < 2) return true;
    let gap = 360 - (a[a.length - 1] - a[0]);
    for (let i = 1; i < a.length; i++) gap = Math.max(gap, a[i] - a[i - 1]);
    return 360 - gap <= S.maxSpread + 1e-9;
  }
  function evalTrip(stops, fleet, maxStops, S, depot) {
    const l = load(stops);
    if (l.points > maxStops) return null;
    if (!spreadOk(stops, S, depot)) return null;
    const ordered = nnOrder(depot, stops);
    const regular = fleet.filter(v => v.priced && !v.onlyIfNeeded);
    const needsBig = s => !regular.some(v => fitsIn(load([s]), v) && (!small(v) || known(s)));
    let best = null;
    fleet.forEach(v => {
      if (!fitsIn(l, v)) return;
      if (small(v) && !stops.every(known)) return;   // cargo without volume and weight never goes on a Labo or Changan
      // Kamaz in A/B and vehicles without a tariff carry only cargo that fits no regular vehicle
      if ((v.onlyIfNeeded || !v.priced) && regular.length && !stops.every(needsBig)) return;
      const price = priceTrip(ordered, v.kind, S);
      const cost = price.total != null ? price.total : UNPRICED;
      if (!best || cost < best.cost) best = { v, cost, price };
    });
    if (!best) return null;
    const m = tripMetrics(depot, ordered, S);
    return { stops: ordered, l, ...best, real: m.real, val: best.cost + KM_COST * m.real };
  }
  // a single cargo that fits no vehicle (e.g. one piece that cannot be split): the largest vehicle, flagged as overloaded
  function overTrip(s, fleet, S, depot) {
    const v = fleet.reduce((a, b) => (b.m3 + b.kg / 1000 > a.m3 + a.kg / 1000 ? b : a));
    const price = priceTrip([s], v.kind, S), m = tripMetrics(depot, [s], S);
    return { stops: [s], l: load([s]), v, price, cost: UNPRICED, real: m.real, val: UNPRICED * 2, over: true };
  }
  // A shipment bigger than the largest vehicle: full loads for the largest vehicle, and the rest as one smaller
  // part that the plan treats like any other cargo — it can go on a Gazel or Labo, together with other points.
  function splitOversize(items, fleet, notes) {
    if (!fleet.length) return items;
    const M3 = Math.max(...fleet.map(v => v.m3)), KG = Math.max(...fleet.map(v => v.kg)), PL = fleet[0].places;
    const out = [];
    items.forEach(s => {
      const cbm = s.cbm || 0, kg = s.kg || 0, places = s.places || 0;
      const k = Math.max(1, Math.ceil(cbm / M3 - EPS), Math.ceil(kg / KG - EPS), PL ? Math.ceil(places / PL - EPS) : 1);
      if (k === 1) { out.push(s); return; }
      // share of the shipment one full vehicle takes (the cargo is split in proportion: volume, weight and places together)
      const f = Math.min(cbm > 0 ? M3 / cbm : 1, kg > 0 ? KG / kg : 1, PL && places > 0 ? PL / places : 1);
      let shares = Array.from({ length: k - 1 }, () => f).concat([1 - f * (k - 1)]);
      let pl = shares.slice(0, -1).map(x => Math.floor(places * x + EPS));
      pl.push(places - pl.reduce((a, b) => a + b, 0));
      if (PL && pl[k - 1] > PL) { shares = Array(k).fill(1 / k); const b = Math.floor(places / k), e = places - b * k; pl = shares.map((_, i) => b + (i < e ? 1 : 0)); }
      const parts = shares.map((x, i) => ({ ...s, cbm: cbm * x, kg: kg * x, places: pl[i], part: i + 1, parts: k, whole: cbm }));   // whole — объём всей отгрузки
      notes.push({ bl: s.bl, client: s.client, cbm, kg, places, parts: k, sizes: parts.map(x => ({ cbm: x.cbm, kg: x.kg })), indivisible: places > 0 && places < k });
      out.push(...parts);
    });
    return out;
  }
  // points around the depot by direction, starting after the widest empty sector
  function sweepOrder(items) {
    const seq = items.slice().sort((a, b) => a.angle - b.angle || a.depotKm - b.depotKm);
    if (seq.length < 2) return seq;
    let cut = 0, gap = -1;
    seq.forEach((s, i) => { const g = (seq[(i + 1) % seq.length].angle - s.angle + 360) % 360; if (g > gap) { gap = g; cut = (i + 1) % seq.length; } });
    return seq.slice(cut).concat(seq.slice(0, cut));
  }
  // A trip depends only on its set of points: each set is evaluated once (key — sorted item numbers)
  function evaluator(items, fleet, maxStops, S, depot) {
    const id = new Map(items.map((s, i) => [s, i])), memo = new Map();
    const key = stops => stops.map(s => id.get(s)).sort((a, b) => a - b).join(',');
    const ev = stops => {
      const k = key(stops);
      if (!memo.has(k)) memo.set(k, evalTrip(k.split(',').map(i => items[+i]), fleet, maxStops, S, depot));
      return memo.get(k);
    };
    return { ev, key, id: s => id.get(s) };
  }
  // cut the sweep into consecutive arcs, each with its best vehicle, at the lowest total cost (dynamic programming)
  function partition(seq, fleet, maxStops, S, depot, ev = stops => evalTrip(stops, fleet, maxStops, S, depot)) {
    const n = seq.length, best = new Array(n + 1).fill(Infinity), prev = new Array(n + 1);
    best[0] = 0;
    for (let j = 1; j <= n; j++) {
      for (let i = j - 1; i >= 0; i--) {
        const seg = seq.slice(i, j);
        if (i < j - 1 && tooBig(load(seg), fleet, maxStops)) break;
        if (best[i] === Infinity) continue;
        const t = ev(seg);
        if (t && best[i] + t.val < best[j]) { best[j] = best[i] + t.val; prev[j] = { i, t }; }
      }
      if (best[j] === Infinity) { const t = overTrip(seq[j - 1], fleet, S, depot); best[j] = best[j - 1] + t.val; prev[j] = { i: j - 1, t }; }
    }
    const trips = [];
    for (let j = n; j > 0; j = prev[j].i) trips.unshift(prev[j].t);
    return trips;
  }
  // plan B: start with one trip per cargo and keep merging the pair that saves the most (savings method),
  // then move single points between trips while that lowers the total
  function consolidate(items, fleet, maxStops, S, depot, ev = stops => evalTrip(stops, fleet, maxStops, S, depot)) {
    const mk = stops => ev(stops) || (stops.length === 1 ? overTrip(stops[0], fleet, S, depot) : null);
    let trips = items.map(s => mk([s]));
    const maxM3 = Math.max(...fleet.map(v => v.m3)), maxKg = Math.max(...fleet.map(v => v.kg));
    for (;;) {
      let best = null;
      for (let a = 0; a < trips.length; a++) for (let b = a + 1; b < trips.length; b++) {
        const A = trips[a], B = trips[b];
        if (A.over || B.over || A.l.cbm + B.l.cbm > maxM3 + EPS || A.l.kg + B.l.kg > maxKg + EPS) continue;
        const m = ev(A.stops.concat(B.stops));
        if (!m) continue;
        const gain = A.val + B.val - m.val;
        if (gain > EPS && (!best || gain > best.gain + EPS)) best = { a, b, m, gain };
      }
      if (!best) break;
      trips = trips.filter((_, i) => i !== best.a && i !== best.b).concat([best.m]);
    }
    for (let pass = 0, moved = true; moved && pass < 4; pass++) {
      moved = false;
      for (let a = 0; a < trips.length; a++) for (let k = 0; k < trips[a].stops.length && trips[a].stops.length > 1; k++) {
        const s = trips[a].stops[k], rest = trips[a].stops.filter((_, i) => i !== k), A2 = ev(rest);
        if (!A2) continue;
        for (let b = 0; b < trips.length; b++) {
          if (b === a || trips[b].over) continue;
          const B2 = ev(trips[b].stops.concat([s]));
          if (B2 && A2.val + B2.val < trips[a].val + trips[b].val - EPS) { trips[a] = A2; trips[b] = B2; moved = true; k = -1; break; }
        }
      }
    }
    return trips;
  }
  // plan A — the cheapest: many starting plans (the sweep cut at different directions, the savings method), then local search
  // while the total goes down: empty a whole trip into the others, move one point, swap two points of different trips.
  // The total is the tariff sum plus a small cost per km, so fewer trips come first and routes stay compact.
  function cheapest(items, fleet, maxStops, S, depot) {
    if (!items.length) return [];
    const { ev, key, id } = evaluator(items, fleet, maxStops, S, depot), n = items.length;
    const total = ts => ts.reduce((a, t) => a + t.val, 0);
    const size = s => Math.max((s.cbm || 0) / (+S.gazelM3 || 1), (s.kg || 0) / (+S.gazelKg || 1));
    // quick check before the full evaluation: the load must fit the biggest vehicle and the point limit
    const M3 = Math.max(...fleet.map(v => v.m3)), KG = Math.max(...fleet.map(v => v.kg)), PL = fleet[0].places;
    const has = (t, s) => t.stops.some(x => x !== s && x.bl === s.bl);
    const can = (t, add, rem) => {
      const cbm = t.l.cbm + (add ? add.cbm || 0 : 0) - (rem ? rem.cbm || 0 : 0), kg = t.l.kg + (add ? add.kg || 0 : 0) - (rem ? rem.kg || 0 : 0);
      const pts = t.l.points + (add && !has(t, add) ? 1 : 0), pl = t.l.places + (add ? add.places || 0 : 0) - (rem ? rem.places || 0 : 0);
      return cbm <= M3 + EPS && kg <= KG + EPS && pts <= maxStops + (rem && !has(t, rem) ? 1 : 0) && (!PL || pl <= PL + EPS);
    };
    const EMPTY = { val: 0, empty: true }, evOr = st => st.length ? ev(st) : EMPTY;
    function improve(start) {
      const fixed = start.filter(t => t.over);   // a cargo that fits no vehicle stays as it is
      let ts = start.filter(t => !t.over), cur = total(ts);
      const set = (a, A2, b, B2) => { ts = ts.map((t, i) => i === a ? A2 : i === b ? B2 : t).filter(t => !t.empty); cur = total(ts); };
      // 1) empty a trip: its points go where they add least, the biggest first
      const emptyOne = () => {
        const order = ts.map((_, i) => i).sort((a, b) => ts[a].stops.length - ts[b].stops.length || ts[a].l.cbm - ts[b].l.cbm || a - b);
        for (const r of order) {
          const rest = ts.filter((_, i) => i !== r);
          let ok = true;
          for (const s of ts[r].stops.slice().sort((a, b) => size(b) - size(a))) {
            let bi = -1, bd = Infinity, bt = null;
            rest.forEach((t, i) => { if (!can(t, s)) return; const t2 = ev(t.stops.concat([s])); if (t2 && t2.val - t.val < bd - EPS) { bd = t2.val - t.val; bi = i; bt = t2; } });
            if (bi < 0) { ok = false; break; }
            rest[bi] = bt;
          }
          if (ok && total(rest) < cur - EPS) { ts = rest; cur = total(rest); return true; }
        }
        return false;
      };
      // 2) move one point to another trip (a full pass, improvements applied as found)
      const moveAll = () => {
        let any = false;
        for (let a = 0; a < ts.length; a++) for (let k = 0; k < ts[a].stops.length; k++) {
          const s = ts[a].stops[k], A2 = evOr(ts[a].stops.filter(x => x !== s));
          if (!A2) continue;
          for (let b = 0; b < ts.length; b++) {
            if (b === a || !can(ts[b], s)) continue;
            const B2 = ev(ts[b].stops.concat([s]));
            if (B2 && A2.val + B2.val < ts[a].val + ts[b].val - EPS) { const gone = A2.empty; set(a, A2, b, B2); any = true; if (gone) return true; k = -1; break; }
          }
        }
        return any;
      };
      // 3) swap two points of different trips
      const swapAll = () => {
        let any = false;
        for (let a = 0; a < ts.length; a++) for (let b = a + 1; b < ts.length; b++) {
          scan: for (const s of ts[a].stops) for (const u of ts[b].stops) {
            if (!can(ts[a], u, s) || !can(ts[b], s, u)) continue;
            const A2 = ev(ts[a].stops.filter(x => x !== s).concat([u])), B2 = A2 && ev(ts[b].stops.filter(x => x !== u).concat([s]));
            if (B2 && A2.val + B2.val < ts[a].val + ts[b].val - EPS) { set(a, A2, b, B2); any = true; break scan; }
          }
        }
        return any;
      };
      for (let round = 0; round < 30; round++) {
        if (emptyOne()) continue;
        const moved = moveAll(), swapped = swapAll();
        if (!moved && !swapped) break;
      }
      return ts.concat(fixed);
    }
    // the tightest packing: the fewest vehicles that hold the cargo (search with a node limit); each point goes first
    // to the trip whose points are nearest, so the trips stay compact. Cargo for Kamaz is packed separately.
    function packStart() {
      const bigOf = list => list.reduce((a, v) => (v.m3 + v.kg / 1000 > a.m3 + a.kg / 1000 ? v : a));
      const regular = fleet.filter(v => v.priced && !v.onlyIfNeeded), cap = regular.length ? bigOf(regular) : null;
      const fitsCap = (s, c) => (s.cbm || 0) <= c.m3 + EPS && (s.kg || 0) <= c.kg + EPS;
      const big = bigOf(fleet), per = Math.max(1, S.tripsPerVehicle | 0 || 1);
      // корзины — машины автопарка от большой к маленькой (у каждой — её кузов), затем их вторые рейсы; машин вида без счёта —
      // сколько угодно самой большой. Корзин больше, чем машин × рейсов, — самой большой (fitFleet и раздача по машинам разберутся)
      const slotsOf = c => {
        if (c !== cap || regular.some(v => v.count == null)) return [];
        const one = regular.slice().sort((a, b) => b.m3 - a.m3 || b.kg - a.kg).flatMap(v => Array(v.count).fill({ m3: v.m3, kg: v.kg }));
        return Array.from({ length: per }, () => one).flat();
      };
      const groups = cap ? [[items.filter(s => fitsCap(s, cap)), cap], [items.filter(s => !fitsCap(s, cap)), big]] : [[items, big]];
      const out = [];
      for (const [list, c] of groups) {
        if (!list.length) continue;
        const its = list.slice().sort((a, b) => Math.max(b.cbm / c.m3, b.kg / c.kg) - Math.max(a.cbm / c.m3, a.kg / c.kg) || id(a) - id(b));
        const pts = new Set(its.map(s => s.bl)).size, slots = slotsOf(c);
        const lb = Math.max(1, Math.ceil(its.reduce((a, s) => a + (s.cbm || 0), 0) / c.m3 - EPS), Math.ceil(its.reduce((a, s) => a + (s.kg || 0), 0) / c.kg - EPS), Math.ceil(pts / maxStops));
        let found = null;
        for (let K = lb; K <= its.length && !found; K++) {
          const bins = Array.from({ length: K }, (_, i) => ({ cm3: (slots[i] || c).m3, ckg: (slots[i] || c).kg, c: 0, k: 0, p: 0, bl: new Map(), lat: 0, lon: 0, m: 0, st: [] }));
          let nodes = 0;
          const put = (b, s, sign) => { b.c += sign * (s.cbm || 0); b.k += sign * (s.kg || 0); b.p += sign * (s.places || 0); b.lat += sign * s.lat; b.lon += sign * s.lon; b.m += sign; b.bl.set(s.bl, (b.bl.get(s.bl) || 0) + sign); if (!b.bl.get(s.bl)) b.bl.delete(s.bl); if (sign > 0) b.st.push(s); else b.st.pop(); };
          const rec = i => {
            if (i === its.length) return true;
            if (++nodes > 20000) return false;
            const s = its[i], d = b => b.m ? Math.hypot(b.lat / b.m - s.lat, (b.lon / b.m - s.lon) * 0.75) : Infinity;
            const emptyTried = new Set();
            for (const b of bins.slice().sort((x, y) => d(x) - d(y))) {
              if (!b.m) { const ek = b.cm3 + '|' + b.ckg; if (emptyTried.has(ek)) continue; emptyTried.add(ek); }   // пустые корзины одной вместимости — одна попытка
              if (b.c + (s.cbm || 0) > b.cm3 + EPS || b.k + (s.kg || 0) > b.ckg + EPS || (PL && b.p + (s.places || 0) > PL + EPS) || (!b.bl.has(s.bl) && b.bl.size >= maxStops)) continue;
              put(b, s, 1);
              if (rec(i + 1)) return true;
              put(b, s, -1);
            }
            return false;
          };
          if (rec(0)) found = bins.filter(b => b.m).map(b => b.st.slice());
          else if (nodes > 20000) break;   // too hard to prove — the other starts will do
        }
        if (!found) return null;
        for (const st of found) { const t = ev(st); if (!t) return null; out.push(t); }
      }
      return out;
    }
    const seq = sweepOrder(items), starts = Math.min(n, 24), cands = [];
    const packed = packStart();
    if (packed) cands.push(packed);
    for (let k = 0; k < starts; k++) { const r = Math.floor(k * n / starts); cands.push(partition(seq.slice(r).concat(seq.slice(0, r)), fleet, maxStops, S, depot, ev)); }
    cands.push(consolidate(items, fleet, maxStops, S, depot, ev));
    const sig = ts => ts.map(t => key(t.stops)).sort().join('|'), tried = new Set(), tries = n <= 30 ? 4 : 2;
    let best = null;
    for (const c of cands.map((ts, i) => ({ ts, v: total(ts), i })).sort((x, y) => x.v - y.v || x.i - y.i)) {
      if (tried.has(sig(c.ts))) continue;
      tried.add(sig(c.ts));
      const ts = improve(c.ts), v = total(ts);
      if (!best || v < best.v - EPS) best = { ts, v };
      if (tried.size >= tries) break;
    }
    return best.ts;
  }
  // plan C: only Kamaz; the trucks share the sweep into sectors of similar load, each truck makes several trips
  function kamazRuns(items, fleet, S, depot) {
    const v = fleet[0], trucks = Math.max(1, S.cTrucks | 0), seq = sweepOrder(items);
    const w = s => Math.max((s.cbm || 0) / v.m3, (s.kg || 0) / v.kg, 1e-3), total = seq.reduce((a, s) => a + w(s), 0);
    const sectors = [[]]; let acc = 0;
    seq.forEach(s => {
      if (sectors[sectors.length - 1].length && sectors.length < trucks && acc + w(s) / 2 > total * sectors.length / trucks) sectors.push([]);
      sectors[sectors.length - 1].push(s); acc += w(s);
    });
    const out = [];
    sectors.forEach((sec, k) => partition(sec, fleet, S.bcMaxStops || 99, S, depot).forEach((t, i) => out.push({ ...t, name: 'Kamaz-' + (k + 1) + ' · рейс ' + (i + 1), car: k + 1, round: i + 1 })));
    return out;
  }

  // ---------- план X (пробный): один район — одна машина ----------
  // Точки группируются по району клиента; без района — отдельная группа. Район, который помещается в одну машину, едет
  // целиком одним рейсом. Район больше машины: полные рейсы — из точек, дальних от соседнего района, а остаток (точки,
  // ближайшие к соседу) едет с машиной соседнего района, если вместе помещаются. Потом районы объединяются в один рейс,
  // пока это дешевле (тариф + немного за километры, как в плане A): сначала соседние (X_NEAR ближайших, центры не дальше
  // X_KM км), затем, если у машины осталось место, — и дальние.
  // Загрузка — как в плане A: строго по кузову, самая дешёвая машина, Kamaz — только для груза больше Gazel.
  // Чтобы убрать план: эта функция, строка X в buildPlans и места «план X» в index.html (поиск по «план X»).
  const X_NEAR = 3, X_KM = 10;
  function districtTrips(items, fleet, maxStops, S, depot, notes) {
    if (!items.length) return [];
    const { ev } = evaluator(items, fleet, maxStops, S, depot);
    const mk = st => ev(st) || (st.length === 1 ? overTrip(st[0], fleet, S, depot) : null);
    const dOf = s => { const d = String((s.client || {}).district || '').trim(); return d && d !== 'Aniqlanmagan' ? d : ''; };
    const center = st => [st.reduce((a, s) => a + s.lat, 0) / st.length, st.reduce((a, s) => a + s.lon, 0) / st.length];
    const regular = fleet.filter(v => v.priced && !v.onlyIfNeeded);
    const needsBig = s => !regular.some(v => fitsIn(load([s]), v) && (!small(v) || known(s)));
    const byD = new Map();
    items.forEach(s => { const k = dOf(s); if (!byD.has(k)) byD.set(k, []); byD.get(k).push(s); });
    const cen = new Map([...byD].map(([k, st]) => [k, center(st)]));
    const nearOf = k => [...cen.keys()].filter(x => x !== k).sort((a, b) => km(cen.get(k), cen.get(a)) - km(cen.get(k), cen.get(b)));
    const fixed = [], groups = [];   // fixed — полные рейсы больших районов; groups — район (или его остаток) одним рейсом
    for (const [d, st] of byD) {
      if (ev(st)) { groups.push({ d: [d], st }); continue; }
      const note = { district: d, trips: 0, neighbor: null, big: 0 };
      notes.push(note);
      // груз, который помещается только в Kamaz, — своими рейсами, как в плане A
      const big = st.filter(needsBig), rest = st.filter(s => !needsBig(s));
      if (big.length) partition(sweepOrder(big), fleet, maxStops, S, depot, ev).forEach(t => { fixed.push(t); note.trips++; note.big++; });
      if (!rest.length) continue;
      const nb = nearOf(d), to = nb.length ? cen.get(nb[0]) : depot;
      let left = rest.slice().sort((a, b) => km(to, [b.lat, b.lon]) - km(to, [a.lat, a.lon]));   // сначала дальние от соседа
      while (left.length && !ev(left)) {
        let cur = [];
        left.forEach(s => { if (ev(cur.concat([s]))) cur.push(s); });
        if (!cur.length) cur = [left[0]];   // не помещается ни в одну машину — рейс с пометкой «перегруз»
        fixed.push(mk(cur)); note.trips++;
        left = left.filter(s => !cur.includes(s));
      }
      if (left.length) groups.push({ d: [d], st: left, part: true, near: nb, note });
    }
    // остаток большого района — с машиной ближайшего соседнего района, с которым помещается в одну машину
    groups.filter(g => g.part).forEach(g => {
      const n = g.near.slice(0, X_NEAR).map(x => groups.find(h => h !== g && h.d.includes(x))).find(h => h && ev(h.st.concat(g.st)));
      g.note.trips++;
      if (!n) return;
      n.st = n.st.concat(g.st); n.d = n.d.concat(g.d); g.note.neighbor = n.d[0];
      groups.splice(groups.indexOf(g), 1);
    });
    // районы — в один рейс, пока это дешевле: сначала соседние, потом (far) любые
    let ts = groups.map(g => ({ d: g.d, st: g.st, t: mk(g.st) })).filter(g => g.t);
    for (const far of [false, true]) for (;;) {
      const cs = ts.map(g => center(g.st));
      let best = null;
      for (let a = 0; a < ts.length; a++) {
        const nbs = ts.map((_, b) => b).filter(b => b !== a).sort((x, y) => km(cs[a], cs[x]) - km(cs[a], cs[y])).slice(0, far ? ts.length : X_NEAR);
        for (const b of nbs) {
          if ((!far && km(cs[a], cs[b]) > X_KM) || ts[a].t.over || ts[b].t.over) continue;
          const m = ev(ts[a].st.concat(ts[b].st));
          if (!m) continue;
          const gain = ts[a].t.val + ts[b].t.val - m.val;
          if (gain > EPS && (!best || gain > best.gain + EPS)) best = { a, b, m, gain };
        }
      }
      if (!best) break;
      const A = ts[best.a], B = ts[best.b];
      ts = ts.filter((_, i) => i !== best.a && i !== best.b).concat([{ d: A.d.concat(B.d), st: A.st.concat(B.st), t: best.m }]);
    }
    return fixed.concat(ts.map(g => g.t));
  }

  // Рейсов класса — не больше, чем машин этого класса (класс — вид машины и её вместимость, fleetOf; count — машин, без счёта —
  // без ограничения). Лишний рейс уходит на машину другого класса: целиком (того же вида другой вместимости или другого
  // вида), в другой рейс, где есть место (машин не прибавится), или делится на несколько рейсов свободных машин — что
  // дешевле. Свободные — обычные машины с тарифом (Kamaz в A и B — только груз, который больше никуда не влезает).
  // Сначала у каждой машины один рейс; второй круг (до per = tripsPerVehicle) — только когда свободных машин нет, и тоже
  // без рейсов сверх числа машин × кругов: Labo не едет второй раз, пока стоят свободные Gazel, а 30 м³ большой Gazel не
  // ждут её второго рейса, если груз помещается в две маленькие. join = false (план X: район — одна машина) — в чужой
  // рейс не добавляем и не делим.
  const clsOf = v => v.cls || v.kind;
  function fitFleet(trips, fleet, per, maxStops, S, depot, join) {
    const sub = keys => fleet.filter(v => keys.includes(clsOf(v)));
    const ev = (stops, keys) => evalTrip(stops, sub(keys), maxStops, S, depot);
    const split = (stops, keys) => { const f = sub(keys); if (!f.length || stops.length < 2) return null; const parts = partition(sweepOrder(stops), f, maxStops, S, depot); return parts.length > 1 && !parts.some(p => p.over) ? parts : null; };
    for (let r = 1; r <= per; r++) {
      const lim = k => { const v = fleet.find(x => clsOf(x) === k); return v && v.count != null ? v.count * r : Infinity; };
      const freeOf = c => fleet.filter(v => v.priced && !v.onlyIfNeeded && (c[clsOf(v)] || 0) < lim(clsOf(v))).map(clsOf);
      const within = (c, add) => { const d = { ...c }; add.forEach(t => { d[clsOf(t.v)] = (d[clsOf(t.v)] || 0) + 1; }); return add.every(t => d[clsOf(t.v)] <= lim(clsOf(t.v))); };
      for (let guard = 0; guard < 200; guard++) {
        const c = {}; trips.forEach(t => { if (!t.over) c[clsOf(t.v)] = (c[clsOf(t.v)] || 0) + 1; });
        const over = Object.keys(c).filter(k => c[k] > lim(k));
        if (!over.length) return trips;
        let best = null;
        trips.forEach((t, i) => {
          if (t.over || !over.includes(clsOf(t.v))) return;
          const c1 = { ...c, [clsOf(t.v)]: c[clsOf(t.v)] - 1 }, free = freeOf(c1).filter(k => k !== clsOf(t.v));
          const alt = free.length && ev(t.stops, free);
          if (alt && (!best || alt.val - t.val < best.d - EPS)) best = { drop: [i], add: [alt], d: alt.val - t.val };
          if (!join) return;
          trips.forEach((u, j) => {
            if (j === i || u.over) return;
            const m = ev(u.stops.concat(t.stops), [...new Set([clsOf(u.v)].concat(free))]);
            if (m && clsOf(m.v) !== clsOf(t.v) && m.val - u.val - t.val < (best ? best.d : Infinity) - EPS) best = { drop: [i, j], add: [m], d: m.val - u.val - t.val };
          });
          // рейс не помещается ни в одну свободную машину целиком — делим на несколько рейсов свободных машин
          const parts = !alt && free.length && split(t.stops, free);
          if (parts && within(c1, parts)) { const d = parts.reduce((a, p) => a + p.val, 0) - t.val; if (!best || d < best.d - EPS) best = { drop: [i], add: parts, d }; }
        });
        if (!best) break;   // этот круг не разгрузить — разрешаем следующий
        trips = trips.filter((_, i) => !best.drop.includes(i)).concat(best.add);
      }
    }
    return trips;
  }

  // ключ точки плана: отгрузка и её часть (большая отгрузка делится на части)
  const stopKey = s => s.id + '#' + (s.part || 1);
  function buildPlans(stopsAll, S) {
    const depot = [S.depotLat, S.depotLon];
    const withC = stopsAll.filter(s => s.lat != null), noC = stopsAll.filter(s => s.lat == null);
    withC.forEach(s => { s.angle = bearing(depot, [s.lat, s.lon]); s.depotKm = km(depot, [s.lat, s.lon]); });
    // Trips go to the vehicles of the fleet (Gazel 9, Changan 1, Labo 1, Kamaz 2 — «Тарифы»): the longest trips first,
    // one per vehicle; the rest as a second trip of the vehicle that is back first (up to tripsPerVehicle a day).
    // Plans A, B and X first move trips beyond the count of a kind to free vehicles of other kinds (fitFleet), so a second
    // trip only happens when every vehicle is busy.
    // A trip beyond that gets no vehicle and is flagged. Plan C brings its own trucks and runs (car, round).
    const COUNT = { gazel: S.gazelCount, changan: S.changanCount, labo: S.laboCount, kamaz: S.cTrucks }, PER = Math.max(1, S.tripsPerVehicle | 0 || 1);
    // Машины поимённо (S.vehicles с сайта: список машин, у каждой — свой объём и вес, «в ремонте»). Машин вида для планов —
    // «Машин в автопарке» минус те, что в ремонте: сначала названные машины по порядку списка, недостающие — с вместимостью
    // вида и именем «Вид-N». Без S.vehicles — как раньше: число машин и вместимость вида из настроек.
    const LABEL = { gazel: 'Gazel', changan: 'Changan', labo: 'Labo', kamaz: 'Kamaz' };
    const DEF = { gazel: [+S.gazelM3, +S.gazelKg], changan: [+S.changanM3, +S.changanKg], labo: [+S.laboM3, +S.laboKg], kamaz: [+S.cM3, +S.cKg] };
    const CARS = {};
    Object.keys(COUNT).forEach(k => {
      const named = (S.vehicles || []).filter(v => v.kind === k), active = named.filter(v => !v.repair);
      if ((COUNT[k] == null || COUNT[k] === '') && !named.length) return;   // число машин не задано — без ограничения; 0 — машин этого вида нет
      const n = Math.max(0, (COUNT[k] | 0 || named.length) - (named.length - active.length)), used = new Set(named.map(v => v.name));
      // m3 — полезный объём (кузов × полезный процент), nom — объём кузова
      const cars = active.slice(0, n).map(v => ({ name: v.name, nom: +v.m3 || DEF[k][0], m3: useful(+v.m3 || DEF[k][0], S), kg: +v.kg || DEF[k][1], dims: v.l > 0 && v.w > 0 && v.h > 0 ? { l: +v.l, w: +v.w, h: +v.h } : null }));
      for (let i = 1; cars.length < n; i++) if (!used.has(LABEL[k] + '-' + i)) cars.push({ name: LABEL[k] + '-' + i, nom: DEF[k][0], m3: useful(DEF[k][0], S), kg: DEF[k][1], unnamed: true });
      CARS[k] = cars.map((c, i) => ({ ...c, no: i + 1 }));
    });
    // классы вместимости: машины вида с одинаковым полезным объёмом и весом — один класс (n — сколько их), по возрастанию
    const CLASSES = {}, AVAIL = {};
    Object.keys(CARS).forEach(k => {
      const m = new Map(); AVAIL[k] = CARS[k].length;
      CARS[k].forEach(c => { const key = c.m3 + '|' + c.kg, e = m.get(key) || { m3: c.m3, kg: c.kg, nom: c.nom, n: 0 }; e.n++; e.nom = Math.max(e.nom, c.nom); m.set(key, e); });
      CLASSES[k] = [...m.values()].sort((a, b) => a.m3 - b.m3 || a.kg - b.kg);
    });
    const back = t => t.finish + t.back / S.speed * 60 * S.roadK;
    const RANK = { labo: 0, changan: 1, gazel: 2, kamaz: 3 };
    const finish = raw => {
      const trips = raw.map(t => ({ name: t.name, car: t.car, round: t.round, manual: !!t.manual, stops: t.stops, cbm: t.l.cbm, kg: t.l.kg, places: t.l.places, ...tripMetrics(depot, t.stops, S), start: S.dayStart * 1440,
        price: t.price, kind: t.v.kind, vehicle: t.v, over: !!t.over, outside: t.stops.filter(s => s.zone === 'out') }));
      const leave = (t, at) => Object.assign(t, tripMetrics(depot, t.stops, S, at), { start: at });   // the trip starts later: arrivals move
      // рейс на конкретной машине: её имя и вместимость (у плана B — плюс допуск Gazel), кузов из карточки (скрипт 31)
      const onCar = (t, c, round, name) => Object.assign(t, { name, car: c.no, round, carName: c.name,
        vehicle: { ...t.vehicle, m3: c.m3 + (t.vehicle.tolM3 || 0), kg: c.kg + (t.vehicle.tolKg || 0), nomM3: c.nom, useM3: c.m3, nomKg: c.kg, dims: c.dims || null } });
      const fits = (t, c) => t.over || (t.cbm <= c.m3 + (t.vehicle.tolM3 || 0) + EPS && t.kg <= c.kg + (t.vehicle.tolKg || 0) + EPS);
      const blocked = [];
      // runs given by the plan: each next run of a truck leaves when the previous one is back
      const own = {};
      trips.filter(t => t.car).forEach(t => (own[t.kind + t.car] = own[t.kind + t.car] || []).push(t));
      Object.values(own).forEach(runs => runs.sort((a, b) => a.round - b.round).reduce((at, t) => {
        const c = (CARS[t.kind] || [])[t.car - 1];
        if (c) onCar(t, c, t.round, t.manual && t.round === 1 ? c.name : c.name + ' · рейс ' + t.round);
        return (leave(t, at), back(t));
      }, S.dayStart * 1440));
      const byKind = {};
      trips.filter(t => !t.car).forEach(t => (byKind[t.kind] = byKind[t.kind] || []).push(t));
      Object.keys(byKind).forEach(kind => {
        const list = byKind[kind], cars = CARS[kind], label = list[0].vehicle.label;
        if (!cars) { list.forEach((t, k) => { t.name = label + '-' + (k + 1); }); return; }   // число машин не задано
        const dur = t => back(t) - t.start, slots = cars.map(c => ({ ...c, free: S.dayStart * 1440, used: 0 }));
        // сначала рейсы, которые помещаются в меньшее число машин (большой груз — в большую), потом самые длинные
        const nFit = t => slots.filter(x => fits(t, x)).length, order = list.slice().sort((a, b) => nFit(a) - nFit(b) || dur(b) - dur(a)), rest = [];
        // первый рейс: самые длинные — по одному на машину, каждому — самая маленькая свободная машина, в которую он помещается
        order.forEach(t => {
          const c = slots.filter(x => !x.used && fits(t, x)).sort((a, b) => a.m3 - b.m3 || a.kg - b.kg || a.no - b.no)[0];
          if (!c || slots.filter(x => x.used).length >= slots.length) { rest.push(t); return; }
          c.used = 1; c.free = back(t); onCar(t, c, 1, c.name);
        });
        // остальные — вторым кругом той машины, что раньше вернётся и в которую помещается рейс
        rest.sort((a, b) => dur(a) - dur(b)).forEach(t => {
          const c = slots.filter(x => x.used < PER && fits(t, x)).sort((a, b) => a.free - b.free || a.no - b.no)[0];
          if (!c) {
            if (slots.some(x => x.used < PER)) blocked.push(kind);   // машины есть, но рейс в них не помещается
            Object.assign(t, { name: label + ' · нет машины', noVehicle: true }); return;
          }
          c.used++;
          leave(t, c.free);
          onCar(t, c, c.used, c.used > 1 ? c.name + ' · рейс ' + c.used : c.name);
          c.free = back(t);
        });
      });
      // по машинам: Labo, Changan, Gazel, Kamaz; у каждой — её рейсы по порядку
      const out = trips.map((t, i) => ({ t, i })).sort((a, b) => (RANK[a.t.kind] - RANK[b.t.kind]) || ((a.t.car || 999) - (b.t.car || 999)) || ((a.t.round || 0) - (b.t.round || 0)) || a.i - b.i).map(x => x.t);
      out.blocked = [...new Set(blocked)];
      return out;
    };
    // Машины вида разной вместимости — план считается в трёх вариантах и берётся лучший: по кузову каждой машины (классы),
    // все машины вида как самая маленькая (любой рейс встаёт в любую машину) и как самая большая (меньше рейсов, если
    // большие машины успевают). Лучший — без «нет машины», без рейсов сверх кузова своей машины, дешевле (тариф и км).
    // Машины вида одной вместимости — один вариант, как раньше
    const one = f => Object.fromEntries(Object.entries(CLASSES).map(([k, c]) => [k, c.length > 1 ? [{ m3: f(c.map(x => x.m3)), kg: f(c.map(x => x.kg)), nom: f(c.map(x => x.nom)), n: c.reduce((a, x) => a + x.n, 0) }] : c]));
    const VARIANTS = Object.values(CLASSES).some(c => c.length > 1) ? [CLASSES, one(a => Math.min(...a)), one(a => Math.max(...a))] : [CLASSES];
    const score = trips => [trips.filter(t => t.noVehicle).length, trips.filter(t => !t.over && (t.cbm > t.vehicle.m3 + EPS || t.kg > t.vehicle.kg + EPS)).length,
      trips.reduce((a, t) => a + (t.price.total != null ? t.price.total : UNPRICED) + KM_COST * t.real, 0)];
    const better = (a, b) => { for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > EPS) return a[i] < b[i]; return false; };
    const plan = (kinds, build, opt = {}) => {
      let best = null, shown = null;
      const vs = kinds.some(k => (CLASSES[k] || []).length > 1) ? VARIANTS : [CLASSES];   // в плане нет машин разной вместимости — один вариант
      for (const classes of vs) {
        const fleet = fleetOf(S, kinds, { ...opt, classes, avail: AVAIL }), splits = [];
        if (!shown) shown = fleet;   // в заметке «Машины: …» — машины по кузовам
        if (!fleet.length) return { trips: [], splits, noFleet: true };
        const items = splitOversize(withC, fleet, splits), raw = build(items, fleet);
        const trips = finish(opt.fit ? fitFleet(raw, fleet, PER, opt.fit.maxStops, opt.fit.S || S, depot, opt.fit.join) : raw), sc = score(trips);
        if (!best || better(sc, best.sc)) best = { trips, splits, sc, vi: vs.indexOf(classes) };
      }
      return { trips: best.trips, splits: best.splits, fleet: shown, variant: best.vi };
    };
    const lab = kinds => S.smartLabo !== 0 ? kinds : kinds.filter(k => k !== 'labo');
    // планы A и B: рейс — в одну сторону (сектор не шире MAX_SPREAD), мелкий груз и точки за кольцом — попутно
    const SD = { ...S, maxSpread: S.maxSpread != null ? +S.maxSpread : MAX_SPREAD };
    const A = plan(lab(['labo', 'changan', 'gazel', 'kamaz']), (items, fleet) => cheapest(items, fleet, S.aMaxStops || 99, SD, depot), { onlyIfNeeded: ['kamaz'], fit: { maxStops: S.aMaxStops || 99, join: true, S: SD } });   // строго по кузову
    const B = plan(lab(['labo', 'changan', 'gazel', 'kamaz']), (items, fleet) => cheapest(items, fleet, S.bcMaxStops || 99, SD, depot),   // тот же поиск, свои правила; Changan/Shineray — тоже
      { onlyIfNeeded: ['kamaz'], tol: { gazel: { m3: S.bTolM3, kg: S.bTolKg } }, fit: { maxStops: S.bcMaxStops || 99, join: true, S: SD } });   // Gazel с допуском
    const C = plan(['kamaz'], (items, fleet) => kamazRuns(items, fleet, CARS.kamaz ? { ...S, cTrucks: CARS.kamaz.length } : S, depot));
    const xNotes = [], X = plan(lab(['labo', 'changan', 'gazel', 'kamaz']), (items, fleet) => districtTrips(items, fleet, S.aMaxStops || 99, S, depot, xNotes), { onlyIfNeeded: ['kamaz'], fit: { maxStops: S.aMaxStops || 99, join: false } });   // план X (пробный): загрузка как в A
    X.districts = xNotes;
    const sum = trips => {
      const priced = trips.filter(t => t.price.total != null), n = k => trips.filter(t => t.kind === k).length;
      return {
        trips: trips.length,
        km: trips.reduce((a, t) => a + t.dist, 0),
        real: trips.reduce((a, t) => a + t.real, 0),
        outside: trips.reduce((a, t) => a + t.outside.length, 0),
        outsideCbm: trips.reduce((a, t) => a + t.outside.reduce((x, s) => x + s.cbm, 0), 0),
        price: priced.reduce((a, t) => a + t.price.total, 0),
        unpriced: trips.length - priced.length,
        labo: n('labo'), changan: n('changan'), gazel: n('gazel'), kamaz: n('kamaz'), over: trips.filter(t => t.over).length,
        noVehicle: trips.filter(t => t.noVehicle).length, second: trips.filter(t => t.round > 1).length
      };
    };
    const out = { noCoords: noC };
    [['A', A], ['B', B], ['C', C], ['X', X]].forEach(([k, p]) => { out[k] = { ...p, sum: sum(p.trips) }; });
    // Ручная правка плана (вкладка «Планы»): руководитель сам разложил точки по рейсам. groups — [{ kind, car, round, keys }],
    // ключ точки — stopKey (id отгрузки и часть). Машина и круг — как в группе; рейс без машины или со сменой вида
    // получает свободную машину вида (или следующий круг самой свободной). Порядок объезда, цена и время — заново.
    // Точки плана, которых в группах нет (план изменился после правки), едут отдельными рейсами своего вида.
    out.cars = CARS; out.per = PER;
    out.manual = (key, groups) => {
      const base = out[key], fleet = base.fleet || [], by = new Map(), used = new Set();
      base.trips.forEach(t => t.stops.forEach(s => by.set(stopKey(s), { s, t })));
      const gs = groups.map(g => {
        const stops = [];
        (g.keys || []).forEach(k => { const x = by.get(k); if (x && !used.has(k)) { used.add(k); stops.push(x.s); } });
        return { kind: g.kind, car: g.car || null, round: g.round || null, stops };
      });
      let extra = 0;
      base.trips.forEach(t => { const rest = t.stops.filter(s => !used.has(stopKey(s))); if (rest.length) { extra += rest.length; gs.push({ kind: t.kind, car: null, round: null, stops: rest }); } });
      // вида нет в этом плане (правка от другого плана) — вид рейса, где точка была в плане
      const live = gs.filter(g => g.stops.length);
      live.forEach(g => { if (!fleet.some(v => v.kind === g.kind)) { g.kind = by.get(stopKey(g.stops[0])).t.kind; g.car = null; } });
      // машина: та же (если вид её), иначе свободная машина вида, иначе следующий круг той, у которой меньше рейсов
      const taken = {};
      live.forEach(g => { if (g.car && (!CARS[g.kind] || CARS[g.kind][g.car - 1])) { const k = g.kind + g.car; taken[k] = Math.max(taken[k] || 0, g.round || 1); } else g.car = null; });
      live.filter(g => !g.car).forEach(g => {
        const cars = CARS[g.kind], n = cars ? cars.length : live.length;
        let best = null;
        for (let no = 1; no <= Math.max(1, n); no++) { const r = taken[g.kind + no] || 0; if (!best || r < best.r) best = { no, r }; }
        g.car = best.no; g.round = best.r + 1; taken[g.kind + best.no] = g.round;
      });
      const raw = live.map(g => {
        const v = fleet.find(x => x.kind === g.kind), ordered = nnOrder(depot, g.stops);
        return { stops: ordered, l: load(ordered), v, price: priceTrip(ordered, g.kind, S), car: g.car, round: g.round, manual: true,
          name: LABEL[g.kind] + '-' + g.car + (g.round > 1 ? ' · рейс ' + g.round : '') };
      });
      const trips = finish(raw);
      trips.forEach(t => {
        t.overload = t.cbm > t.vehicle.m3 + EPS || t.kg > t.vehicle.kg + EPS || (!!t.vehicle.places && t.places > t.vehicle.places + EPS);
        t.extraRound = t.round > PER;
      });
      return { ...base, trips, sum: sum(trips), manual: true, extra };
    };
    return out;
  }

  function yRoute(depot, pts) {
    return 'https://yandex.uz/maps/?rtt=auto&rtext=' + [depot].concat(pts).map(p => p[0].toFixed(6) + ',' + p[1].toFixed(6)).join('~');
  }
  function yPoint(lat, lon) { return 'https://yandex.uz/maps/?pt=' + lon + ',' + lat + '&z=17&l=map'; }

  // ---- minimal XLSX writer (stored zip) ----
  const crcT = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = u => { let c = 0xFFFFFFFF; for (let i = 0; i < u.length; i++) c = crcT[(c ^ u[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function zip(files) {
    const enc = new TextEncoder(), parts = [], cd = []; let off = 0;
    files.forEach(f => {
      const name = enc.encode(f.name), data = enc.encode(f.data), crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(8, 0, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true);
      parts.push(new Uint8Array(h.buffer), name, data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
      cd.push(new Uint8Array(c.buffer), name);
      off += 30 + name.length + data.length;
    });
    const cdSize = cd.reduce((a, p) => a + p.length, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cdSize, true); e.setUint32(16, off, true);
    return new Blob([...parts, ...cd, new Uint8Array(e.buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const col = i => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = (i - m - 1) / 26; } return s; };
  function xlsx(sheets) {
    const sx = sheets.map(sh => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
      sh.rows.map((r, ri) => '<row r="' + (ri + 1) + '">' + r.map((v, ci) => {
        if (v === null || v === undefined || v === '') return '';
        const ref = col(ci) + (ri + 1);
        return typeof v === 'number' ? '<c r="' + ref + '"><v>' + v + '</v></c>' : '<c r="' + ref + '" t="inlineStr"' + (ri === 0 ? ' s="1"' : '') + '><is><t xml:space="preserve">' + esc(v) + '</t></is></c>';
      }).join('') + '</row>').join('') + '</sheetData></worksheet>');
    const files = [
      { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + sheets.map((s, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') + '</Types>' },
      { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + sheets.map((s, i) => '<sheet name="' + esc(s.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + sheets.map((s, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') + '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
      { name: 'xl/styles.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>' }
    ].concat(sx.map((d, i) => ({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: d })));
    return zip(files);
  }

  // ТКАД по карте Яндекса (сверено со станциями метро Yashnobod/Rohat), с петлёй вокруг Keles
  const TKAD_V2 = [[41.350512,69.166316],[41.361015,69.173959],[41.368162,69.185104],[41.386242,69.184761],[41.401736,69.189561],[41.413095,69.201906],[41.419807,69.22248],[41.419807,69.243054],[41.413095,69.260199],[41.402769,69.267057],[41.391678,69.270552],[41.385972,69.279892],[41.383978,69.290981],[41.384639,69.304957],[41.38366,69.317525],[41.38211,69.32878],[41.371779,69.335638],[41.360067,69.33781],[41.349017,69.355149],[41.341911,69.367905],[41.333414,69.377178],[41.328781,69.372809],[41.320367,69.360817],[41.312367,69.34838],[41.305017,69.340823],[41.298795,69.349027],[41.2874,69.359336],[41.277685,69.361699],[41.270253,69.363818],[41.260881,69.375284],[41.252141,69.386138],[41.244139,69.395349],[41.236824,69.383579],[41.229201,69.371626],[41.223081,69.36307],[41.213753,69.347811],[41.204424,69.332895],[41.194229,69.32215],[41.186798,69.311635],[41.177061,69.298871],[41.170853,69.288917],[41.164085,69.273847],[41.164622,69.26387],[41.165623,69.250141],[41.166661,69.236425],[41.170279,69.223166],[41.174431,69.209553],[41.180712,69.200534],[41.187602,69.194396],[41.193674,69.188876],[41.201177,69.185519],[41.211816,69.191511],[41.219154,69.197538],[41.226826,69.192367],[41.22809,69.180025],[41.234959,69.168512],[41.234921,69.162232],[41.24795,69.151842],[41.260972,69.14954],[41.271255,69.147041],[41.281583,69.148016],[41.292051,69.150242],[41.302377,69.15156],[41.312788,69.15394],[41.323016,69.158504],[41.332873,69.162923],[41.34281,69.1648]];
  const KELES = [41.398, 69.205];
  const KELES_BULGE = [[41.3860, 69.1830], [41.4020, 69.1800], [41.4160, 69.1900], [41.4190, 69.2080], [41.4130, 69.2260], [41.3980, 69.2340], [41.3850, 69.2360]];
  function withKeles(ring) {
    if (!ring || ring.length < 3 || inside(KELES, ring)) return ring;
    let s = 0; ring.forEach((p, i) => { if (p[0] < ring[s][0]) s = i; });
    const rot = ring.slice(s).concat(ring.slice(0, s));
    const drop = p => p[0] > 41.37 && p[1] > 69.195 && p[1] < 69.239;
    let j = rot.findIndex(drop);
    const kept = rot.filter(p => !drop(p));
    if (j < 0) { let best = 0, bd = Infinity; kept.forEach((p, i) => { const d = km(p, [41.378, 69.195]); if (d < bd) { bd = d; best = i; } }); j = best + 1; }
    kept.splice(j, 0, ...KELES_BULGE);
    return kept;
  }
  function ringLength(ring) { let d = 0; for (let i = 0; i < ring.length; i++) d += km(ring[i], ring[(i + 1) % ring.length]); return d; }

  const DISTRICT_ANCHORS = [['Chilonzor', 41.275, 69.205], ['Uchtepa', 41.300, 69.165], ['Olmazor', 41.345, 69.215], ['Yunusobod', 41.365, 69.285], ['Yashnobod', 41.300, 69.335], ['Shayxontohur', 41.325, 69.240], ['Sergeli', 41.225, 69.225], ['Yangihayot', 41.228, 69.180], ["Mirzo Ulug'bek", 41.335, 69.335], ['Mirobod', 41.290, 69.285], ['Bektemir', 41.210, 69.335], ['Yakkasaroy', 41.285, 69.250]];
  // район по координатам: ближайшие клиенты с известным районом + опорные точки районов
  function guessDistrict(lat, lon, clients, exceptBl) {
    if (lat == null || lon == null) return null;
    const pts = [];
    (clients || []).forEach(c => { if (c.bl !== exceptBl && c.lat != null && c.district && c.district !== 'Aniqlanmagan' && !c.districtAuto) pts.push([c.district, km([lat, lon], [c.lat, c.lon])]); });
    DISTRICT_ANCHORS.forEach(([d, a, b]) => pts.push([d, km([lat, lon], [a, b]) * 1.15]));
    pts.sort((a, b) => a[1] - b[1]);
    const votes = {};
    pts.slice(0, 5).forEach(([d, dist]) => { votes[d] = (votes[d] || 0) + 1 / Math.max(dist, 0.3); });
    const best = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
    return best ? { district: best[0], km: pts[0][1] } : null;
  }

  window.LogiEngine = { parseBoxes, boxesText, vehicleBrand, guessDistrict, km, bearing, inside, distToRing, zoneOf, nnOrder, tripMetrics, priceTrip, pointTariff, PLACE_KM, costSplit, coordsFromLink, vehicleKind, buildPlans, stopKey, yRoute, yPoint, xlsx, NO_PRICE, NO_PLAN, withKeles, ringLength, KELES, TKAD_V2 };
})();
