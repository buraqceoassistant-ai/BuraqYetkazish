/* Новая машина в автопарк (например, электрогрузовик BYD T5 EV): сколько обойдётся в месяц и когда окупится.
   Рейсы и их цена — из отчётов (по каждой партии: журнал или план A). Новая машина берёт самые дорогие рейсы, груз
   которых помещается в её кузов (полезный объём — как в планах), не больше «рейсов на машину в день» и не дальше
   запаса хода за день. Сэкономлено — тариф этих рейсов: сейчас его платим наёмной машине.
   Расходы своей машины: электричество (км × кВт·ч на 100 км × цена кВт·ч), водитель (оклад и / или оплата за рейс,
   плюс налог с зарплаты), ТО / шины / страховка, стоянка. Ещё рейсов вне партий — по средней цене и пробегу рейса этой
   машины. Простой (ремонт, отпуск водителя) — рейсов меньше; зимой запас хода меньше — 3 месяца в году рейсов меньше.
   Покупка — наличными или в лизинг: платёж в месяц одинаковый (аннуитет); сразу — ещё зарядная станция и оформление.
   Окупаемость — с ростом цен (экономия дорожает каждый год) и с учётом депозита (сколько принесли бы деньги в банке);
   итог за 5 лет — и с продажей машины.
   scenarios() — что будет, если поменять одно условие (рейсов в день, водитель за рейс, рейсы вне партий, ещё машина,
   цена): тот же расчёт с правкой, чтобы было видно, при каких условиях машина окупается.
   Подключается в index.html (вкладка «Отчёты» → «Новая машина»), в node — тесты (tests/car-calc.test.mjs). */
(function (root) {
  'use strict';
  // примерные цифры (октябрь 2026): цена — объявления BYD T5 EV на OLX.uz, электричество — тариф для юрлиц с 1.06.2026,
  // лизинг — средняя ставка по кредитам на машины; кузов, вес, расход и запас хода — по описаниям T5 EV у дилеров. Всё меняется в форме.
  const DEFAULTS = { name: 'BYD T5 EV', price: 400000000, m3: 16, kg: 1500, rangeKm: 250, count: 1,
    kwh100: 30, kwhPrice: 1100, salary: 7000000, driverPerTrip: 0, upkeepYear: 12000000, perMonth: '', perDay: '', extraTrips: 0,
    leaseAdv: 20, leaseRate: 26, leaseMonths: 36,
    // что ещё учесть (примерно): зарядная станция на складе и оформление — сразу; стоянка — в месяц; соцналог с
    // зарплаты (12 %); простой (ремонт, ТО, отпуск водителя); зимой (3 месяца в году) запас хода меньше;
    // продажа через 5 лет — к итогу за 5 лет; деньги на депозите — сколько принесли бы эти деньги (средняя ставка
    // по срочным депозитам в сумах — 17,6 %, июнь 2026): накопленный итог растёт или тает под этот процент
    // рост цен (инфляция 6,4 % за год, сентябрь 2026): наёмные рейсы, зарплата, электричество и ТО каждый год дороже —
    // экономия растёт так же, платёж лизинга — нет
    charger: 10000000, regFee: 0, parking: 0, payrollTax: 12, downtime: 5, winterLoss: 25, resale: 40, deposit: 17.6, growth: 6.4 };
  const DRIVER_TRIP = 150000;   // сценарий «водитель за рейс», если своя оплата за рейс не вписана
  const YEARS = 5;   // итог «за 5 лет»
  const WINTER = 3 / 12;   // зима (декабрь — февраль) — доля года с меньшим запасом хода

  const num = v => { const x = typeof v === 'number' ? v : parseFloat(String(v == null ? '' : v).replace(/\s+/g, '').replace(',', '.')); return isFinite(x) ? x : null; };
  // ввод формы → числа (пустое или неверное — значение по умолчанию; «партий в месяц» пустое — по данным)
  function params(raw) {
    const p = {};
    Object.keys(DEFAULTS).forEach(k => {
      const v = raw && raw[k] != null ? raw[k] : DEFAULTS[k];
      if (k === 'name') p[k] = String(v || '').trim() || DEFAULTS.name;
      else if (k === 'perMonth' || k === 'perDay') { const x = num(v); p[k] = x > 0 ? x : null; }
      else { const x = num(v); p[k] = x != null && x >= 0 ? x : DEFAULTS[k]; }
    });
    p.count = Math.max(1, Math.round(p.count));
    return p;
  }
  // платёж в месяц по аннуитету: сумма, % годовых, месяцев
  function annuity(sum, ratePct, months) {
    if (!(sum > 0) || !(months > 0)) return 0;
    const r = ratePct / 1200;
    return r > 0 ? sum * r / (1 - Math.pow(1 + r, -months)) : sum / months;
  }
  const spanMonths = dates => {
    if (!dates.length) return 1;
    const t = d => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)), days = (t(dates[dates.length - 1]) - t(dates[0])) / 864e5 + 1;
    return Math.max(1, days / 30.44);
  };

  // batches: [{ date, trips: [{ price, km, cbm, kg }] }]; opt: { fill — доля полезного объёма (0–1), perDay — рейсов на машину в день
  // из «Тарифов» (вписанное в форме «Рейсов на машину в день» — главнее) }
  function calc(batches, raw, opt = {}) {
    const p = params(raw), fill = opt.fill > 0 && opt.fill <= 1 ? opt.fill : 1, per = Math.max(1, Math.round(p.perDay || +opt.perDay || 2));
    const capM3 = p.m3 * fill, fitsBody = t => (+t.cbm || 0) <= capM3 + 1e-9 && (+t.kg || 0) <= p.kg + 1e-9;
    const T = { batches: batches.length, all: 0, allSum: 0, fit: 0, taken: 0, saved: 0, km: 0, maxDayKm: 0, byRange: 0, bigger: 0, takenW: 0, savedW: 0, kmW: 0, days: [] };
    // зимой батарея на холоде отдаёт меньше: запас хода меньше на winterLoss %
    const rangeW = p.rangeKm * Math.max(0, 1 - Math.min(100, p.winterLoss) / 100);
    // раздать рейсы партии по машинам: самые дорогие первыми, не больше per в день и не дальше запаса хода
    const assign = (fits, range) => {
      const cars = Array.from({ length: p.count }, () => ({ n: 0, km: 0 })), o = { taken: 0, saved: 0, km: 0, maxKm: 0, byRange: 0 };
      fits.forEach(t => {
        const k = +t.km || 0, free = cars.filter(c => c.n < per);
        const car = free.filter(c => !range || c.km + k <= range).sort((a, c) => a.km - c.km)[0];
        if (!car) { if (free.length) o.byRange++; return; }
        car.n++; car.km += k; o.taken++; o.saved += t.price; o.km += k;
      });
      cars.forEach(c => { o.maxKm = Math.max(o.maxKm, c.km); });
      return o;
    };
    batches.forEach(b => {
      const priced = (b.trips || []).filter(t => t.price > 0);
      T.all += priced.length; T.allSum += priced.reduce((a, t) => a + t.price, 0);
      const fits = priced.filter(fitsBody).sort((a, c) => c.price - a.price);
      T.fit += fits.length; T.bigger += priced.length - fits.length;
      const o = assign(fits, p.rangeKm), w = p.rangeKm && rangeW < p.rangeKm ? assign(fits, rangeW) : o;
      T.taken += o.taken; T.saved += o.saved; T.km += o.km; T.byRange += o.byRange; T.maxDayKm = Math.max(T.maxDayKm, o.maxKm);
      T.takenW += w.taken; T.savedW += w.saved; T.kmW += w.km;
      T.days.push({ date: b.date, all: priced.length, fit: fits.length, taken: o.taken, saved: o.saved, km: o.km, maxKm: o.maxKm, byRange: o.byRange, takenW: w.taken });
    });
    // средний рейс этой машины (по взятым, иначе по подходящим по кузову) — для рейсов вне партий и «что нужно»
    const fitAll = []; batches.forEach(b => (b.trips || []).forEach(t => { if (t.price > 0 && fitsBody(t)) fitAll.push(t); }));
    const base = T.taken ? { price: T.saved / T.taken, km: T.km / T.taken } : fitAll.length ? { price: fitAll.reduce((a, t) => a + t.price, 0) / fitAll.length, km: fitAll.reduce((a, t) => a + (+t.km || 0), 0) / fitAll.length } : null;
    // в месяц: среднее на партию × партий в месяц (по данным периода или как вписано) + рейсы вне партий
    const dates = batches.map(b => b.date).filter(Boolean).sort();
    // простой (ремонт, ТО, водитель в отпуске) — машины нет в части дней: рейсов меньше на downtime %
    const up = Math.max(0, 1 - Math.min(100, p.downtime) / 100);
    const autoPerMonth = batches.length ? batches.length / spanMonths(dates) : 0, perMonth = p.perMonth || autoPerMonth, k = batches.length ? perMonth / batches.length * up : 0;
    const extra = base ? p.extraTrips * up : 0;
    // в среднем за год: 3 зимних месяца из 12 — рейсы как при зимнем запасе хода
    const ys = x => x * (1 - WINTER), ws = x => x * WINTER;
    const M = { perMonth, autoPerMonth, extra, trips: (ys(T.taken) + ws(T.takenW)) * k + extra, saved: (ys(T.saved) + ws(T.savedW)) * k + extra * (base ? base.price : 0),
      km: (ys(T.km) + ws(T.kmW)) * k + extra * (base ? base.km : 0), allTrips: T.all * k, allSum: T.allSum * k, winterLess: (T.taken - T.takenW) * k, winterLessSum: (T.saved - T.savedW) * k };
    M.energy = M.km * p.kwh100 / 100 * p.kwhPrice;
    const tax = 1 + p.payrollTax / 100;   // соцналог с зарплаты водителя — платит компания сверх зарплаты
    M.salaryFixed = p.salary * p.count * tax; M.salaryTrips = p.driverPerTrip * M.trips * tax; M.salary = M.salaryFixed + M.salaryTrips;
    M.upkeep = p.upkeepYear / 12 * p.count; M.parking = p.parking * p.count;
    M.opex = M.energy + M.salary + M.upkeep + M.parking;
    M.net = M.saved - M.opex;   // экономия в месяц до платежей за саму машину
    const price = p.price * p.count, oneTime = p.charger + p.regFee * p.count, dep = p.deposit / 1200;   // зарядка — одна на склад
    const grow = y => Math.pow(1 + p.growth / 100, y);   // цены в y-м году (0 — первый) к ценам сейчас
    const variant = (key, name, downPct, rate, months) => {
      const carNow = key === 'cash' ? price : price * Math.min(100, downPct) / 100, loan = price - carNow, upfront = carNow + oneTime;
      const n = key === 'cash' || !(loan > 0) ? 0 : Math.max(1, Math.round(months)), pay = n ? annuity(loan, rate, n) : 0, total = upfront + pay * n;   // с разовыми тратами
      // окупится: месяц, с которого накопленный итог (экономия минус всё заплаченное за машину) больше не уходит
      // в минус — при лизинге платежи идут и после первого «плюса» (считаем до 20 лет); итог — за 5 лет;
      // curve — накопленный итог по месяцам (0 … 5 лет) для графика
      // с депозитом: накопленный итог каждый месяц растёт (или минус тает) под процент депозита — так видно,
      // сколько потеряли, отдав деньги за машину, а не положив их в банк; lost — упущено за 5 лет
      let cum = -upfront, plain = -upfront, lastNeg = cum < 0 ? 0 : -1, five = 0, lost = 0; const curve = [cum];
      for (let m = 1; m <= 240; m++) { const flow = M.net * grow(Math.floor((m - 1) / 12)) - (m <= n ? pay : 0); cum = cum * (1 + dep) + flow; plain += flow; if (cum < 0) lastNeg = m; if (m <= YEARS * 12) curve.push(cum); if (m === YEARS * 12) { five = cum; lost = plain - cum; } }
      const payback = cum >= 0 ? Math.max(1, lastNeg + 1) : null, sale = price * p.resale / 100;
      // по годам: экономия, расходы машины, заплачено за машину (взнос / аванс — в первый год), итог за год и накопленный
      const years = Array.from({ length: YEARS }, (_, y) => { const paid = (y === 0 ? upfront : 0) + pay * Math.max(0, Math.min(12, n - y * 12));   // + разовые траты в первый год
        const g = grow(y); return { year: y + 1, saved: M.saved * 12 * g, opex: M.opex * 12 * g, paid, result: (M.saved - M.opex) * 12 * g - paid, cum: curve[(y + 1) * 12] }; });
      return { key, name, upfront, oneTime, loan, pay, months: n, rate: key === 'cash' ? 0 : rate, total, overpay: total - oneTime - price, netDuring: M.net - pay, netAfter: M.net,
        payback, five, sale, fiveSale: five + sale, lost, curve, years };
    };
    const V = [variant('cash', 'Наличными'), variant('lease', 'Лизинг', p.leaseAdv, p.leaseRate, p.leaseMonths)];
    // что нужно, чтобы окупилась: рейсов в месяц (по средней цене рейса этой машины), зарплата, цена машины
    const energyTrip = base ? base.km * p.kwh100 / 100 * p.kwhPrice : 0, perTrip = base ? base.price : null;
    const netPerTrip = base ? base.price - energyTrip - p.driverPerTrip * tax : null, fixed = M.salaryFixed + M.upkeep + M.parking;
    const need = n => netPerTrip > 0 ? n / netPerTrip : null;
    const B = { perTrip, netPerTrip, fixed, cap: per * p.count * perMonth, fitMonth: T.fit * k, trips: M.trips, days: perMonth,
      tripsEven: need(fixed), tripsIn3y: need(fixed + (price + oneTime) / 36),
      maxSalary: (M.saved - M.energy - M.upkeep - M.parking - M.salaryTrips) / tax / p.count, maxPrice3y: M.net > 0 ? Math.max(0, (M.net * 36 - oneTime) / p.count) : 0,
      up, tax };
    // один рейс: наёмной машине платим тариф; своя — электричество, водитель, ТО и (наличными) цена машины на 5 лет
    const tr = M.trips || 0, U = tr ? { hired: perTrip, energy: energyTrip, driver: M.salary / tr, upkeep: (M.upkeep + M.parking) / tr, carCash: (price + oneTime - price * p.resale / 100) / (YEARS * 12) / tr, carLease: V[1].pay / tr } : null;
    return { p, fill, per, capM3, T, M, V, B, U, base, price, years: YEARS };
  }

  // сценарии: одна правка к вписанным цифрам — и тот же расчёт (как сейчас, больше рейсов в день, водитель за рейс,
  // рейсы вне партий, ещё одна машина, цена машины для окупаемости за 3 года, вместе)
  function scenarios(batches, raw, opt = {}) {
    const now = calc(batches, raw, opt), p = now.p, per = now.per, dpt = p.driverPerTrip || DRIVER_TRIP, out = [];
    // сценарий, который ничего не меняет (условие уже вписано в форму), — не показываем
    const same = patch => Object.keys(patch).every(k => +p[k] === +patch[k] || (k === 'perDay' && +patch[k] === per));
    const run = (key, patch, extra) => { if (key !== 'now' && same(patch)) return null; const s = Object.assign({ key, patch, r: key === 'now' ? now : calc(batches, Object.assign({}, raw, patch), opt) }, extra || {}); out.push(s); return s; };
    run('now', {});
    // больше рейсов в день — только если машина правда возьмёт больше (иначе подходящих по кузову рейсов уже нет)
    let last = now;
    [3, 4].forEach(n => { if (per < n) { const s = run('per' + n, { perDay: n }, { n, was: per }); if (s && s.r.M.trips <= last.M.trips + 1e-6) out.pop(); else if (s) last = s.r; } });
    run('driver', { salary: 0, driverPerTrip: dpt }, { dpt });
    run('extra', { extraTrips: (p.extraTrips || 0) + 20 }, { n: 20, price: now.base ? now.base.price : 0 });
    run('more', { count: p.count + 1 }, { n: p.count + 1 });
    if (now.B.maxPrice3y > 0 && now.B.maxPrice3y < p.price) run('price', { price: Math.floor(now.B.maxPrice3y / 1e6) * 1e6 }, { price: Math.floor(now.B.maxPrice3y / 1e6) * 1e6 });
    run('combo', { perDay: Math.max(3, per), salary: 0, driverPerTrip: dpt, extraTrips: (p.extraTrips || 0) + 20 }, { n: Math.max(3, per), dpt });
    const best = r => Math.min(...r.V.map(v => v.payback == null ? Infinity : v.payback));
    out.forEach(s => { s.best = best(s.r); });
    const fast = Math.min(...out.map(s => s.best));
    out.forEach(s => { s.fastest = isFinite(fast) && s.best === fast && s.key !== 'now'; });
    return out;
  }

  const API = { DEFAULTS, DRIVER_TRIP, params, annuity, calc, scenarios, YEARS, WINTER };
  root.LogiCarCalc = API;
  if (typeof module === 'object' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
