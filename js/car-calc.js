/* Новая машина в автопарк (например, электрогрузовик BYD T5 EV): сколько обойдётся в месяц и когда окупится.
   Рейсы и их цена — из отчётов (по каждой партии: журнал или план A). Новая машина берёт самые дорогие рейсы, груз
   которых помещается в её кузов (полезный объём — как в планах), не больше «рейсов на машину в день» и не дальше
   запаса хода за день. Сэкономлено — тариф этих рейсов: сейчас его платим наёмной машине.
   Расходы своей машины: электричество (км × кВт·ч на 100 км × цена кВт·ч), зарплата водителя, ТО / шины / страховка.
   Покупка — наличными или в лизинг: платёж в месяц одинаковый (аннуитет).
   Подключается в index.html (вкладка «Отчёты» → «Новая машина»), в node — тесты (tests/car-calc.test.mjs). */
(function (root) {
  'use strict';
  // примерные цифры (октябрь 2026): цена — объявления BYD T5 EV на OLX.uz, электричество — тариф для юрлиц с 1.06.2026,
  // лизинг — средняя ставка по кредитам на машины; кузов, вес, расход и запас хода — по описаниям T5 EV у дилеров. Всё меняется в форме.
  const DEFAULTS = { name: 'BYD T5 EV', price: 400000000, m3: 16, kg: 1500, rangeKm: 250, count: 1,
    kwh100: 30, kwhPrice: 1100, salary: 7000000, upkeepYear: 12000000, perMonth: '',
    leaseAdv: 20, leaseRate: 26, leaseMonths: 36 };
  const YEARS = 5;   // итог «за 5 лет»

  const num = v => { const x = typeof v === 'number' ? v : parseFloat(String(v == null ? '' : v).replace(/\s+/g, '').replace(',', '.')); return isFinite(x) ? x : null; };
  // ввод формы → числа (пустое или неверное — значение по умолчанию; «партий в месяц» пустое — по данным)
  function params(raw) {
    const p = {};
    Object.keys(DEFAULTS).forEach(k => {
      const v = raw && raw[k] != null ? raw[k] : DEFAULTS[k];
      if (k === 'name') p[k] = String(v || '').trim() || DEFAULTS.name;
      else if (k === 'perMonth') { const x = num(v); p[k] = x > 0 ? x : null; }
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

  // batches: [{ date, trips: [{ price, km, cbm, kg }] }]; opt: { fill — доля полезного объёма (0–1), perDay — рейсов на машину в день }
  function calc(batches, raw, opt = {}) {
    const p = params(raw), fill = opt.fill > 0 && opt.fill <= 1 ? opt.fill : 1, per = Math.max(1, Math.round(+opt.perDay || 2));
    const capM3 = p.m3 * fill, range = p.rangeKm;
    const T = { batches: batches.length, all: 0, allSum: 0, fit: 0, taken: 0, saved: 0, km: 0, maxDayKm: 0, byRange: 0, bigger: 0 };
    batches.forEach(b => {
      const priced = (b.trips || []).filter(t => t.price > 0);
      T.all += priced.length; T.allSum += priced.reduce((a, t) => a + t.price, 0);
      const fits = priced.filter(t => (+t.cbm || 0) <= capM3 + 1e-9 && (+t.kg || 0) <= p.kg + 1e-9).sort((a, c) => c.price - a.price);
      T.fit += fits.length; T.bigger += priced.length - fits.length;
      const cars = Array.from({ length: p.count }, () => ({ n: 0, km: 0 }));
      fits.forEach(t => {
        const k = +t.km || 0, free = cars.filter(c => c.n < per);
        const car = free.filter(c => !range || c.km + k <= range).sort((a, c) => a.km - c.km)[0];
        if (!car) { if (free.length) T.byRange++; return; }
        car.n++; car.km += k; T.taken++; T.saved += t.price; T.km += k;
      });
      cars.forEach(c => { T.maxDayKm = Math.max(T.maxDayKm, c.km); });
    });
    // в месяц: среднее на партию × партий в месяц (по данным периода или как вписано)
    const dates = batches.map(b => b.date).filter(Boolean).sort();
    const autoPerMonth = batches.length ? batches.length / spanMonths(dates) : 0, perMonth = p.perMonth || autoPerMonth, k = batches.length ? perMonth / batches.length : 0;
    const M = { perMonth, autoPerMonth, trips: T.taken * k, saved: T.saved * k, km: T.km * k, allTrips: T.all * k, allSum: T.allSum * k };
    M.energy = M.km * p.kwh100 / 100 * p.kwhPrice;
    M.salary = p.salary * p.count; M.upkeep = p.upkeepYear / 12 * p.count;
    M.opex = M.energy + M.salary + M.upkeep;
    M.net = M.saved - M.opex;   // экономия в месяц до платежей за саму машину
    const price = p.price * p.count;
    const variant = (key, name, downPct, rate, months) => {
      const upfront = key === 'cash' ? price : price * Math.min(100, downPct) / 100, loan = price - upfront;
      const n = key === 'cash' || !(loan > 0) ? 0 : Math.max(1, Math.round(months)), pay = n ? annuity(loan, rate, n) : 0, total = upfront + pay * n;
      // окупится: месяц, когда экономия покрыла всё заплаченное за машину (до 20 лет); итог — за 5 лет
      let cum = -upfront, payback = null, five = 0;
      for (let m = 1; m <= 240; m++) { cum += M.net - (m <= n ? pay : 0); if (payback == null && cum >= 0) payback = m; if (m === YEARS * 12) five = cum; }
      return { key, name, upfront, loan, pay, months: n, rate: key === 'cash' ? 0 : rate, total, overpay: total - price, netDuring: M.net - pay, netAfter: M.net, payback, five };
    };
    const V = [variant('cash', 'Наличными'), variant('lease', 'Лизинг', p.leaseAdv, p.leaseRate, p.leaseMonths)];
    return { p, fill, per, capM3, T, M, V, price, years: YEARS };
  }

  const API = { DEFAULTS, params, annuity, calc, YEARS };
  root.LogiCarCalc = API;
  if (typeof module === 'object' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
