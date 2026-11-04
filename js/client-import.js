/* База клиентов из Excel (например, CRM отдела продаж: «Shipping mark», «Customer Name», «Brand name», телефоны,
   менеджер, тип груза) → справочник клиентов сайта. Столбцы узнаются по заголовкам (рус., англ., узб.), безымянный
   столбец с телефонами и столбец со ссылками на карту — по содержимому. Строки только с № и BL (зарезервированные
   коды) пропускаются. Сайт добавляет новых клиентов, у тех, кто уже есть (тот же BL: «BL-03» = «BL-3»), дополняет
   только пустые поля; отличия показывает и меняет, только если так выбрать. Паспорта на сайт не переносятся.
   Подключается в index.html («Клиенты» → «⇧ Загрузить базу»), в node — тесты (tests/client-import.test.mjs). */
(function (root) {
  'use strict';
  const S = v => v == null ? '' : String(v).replace(/\s+/g, ' ').trim();
  const DASH = /^[-–—.\s]*$/;   // «-», «—», «.» вместо данных — пусто
  const val = v => DASH.test(S(v)) ? '' : S(v);
  const KIND = /^(сборный|целый|сборн|lcl|ltl|ftl|fcl|yig‘ma|yig'ma|to‘liq|to'liq)$/i;
  const URL = /^https?:\/\/\S+$/i;
  // заголовок → поле (первое совпадение); passport — узнаём, чтобы сказать, что не переносится
  const HEAD = [
    ['passport', /passport|паспорт|pasport/i],
    ['bl', /shipping\s*mark|^bl(\s*code|\s*kod)?$|^код|маркировк|^kod$/i],
    ['name', /customer\s*name|client\s*name|^name$|^имя|^ф\.?\s*и\.?\s*о|^клиент$|mijoz\s*(ismi)?$|^fio$/i],
    ['brand', /brand|company|бренд|компани|firma|kompaniya/i],
    ['manager', /manager|менеджер|menejer/i],
    ['business', /business|вид\s*деят|faoliyat|soha/i],
    ['address', /address|адрес|manzil/i],
    ['district', /district|район|tuman/i],
    ['phone', /phone|телефон|^тел|telefon/i],
    ['remark', /remark|примечан|izoh|^note/i],
    ['kind', /^тип|cargo\s*type|^type$/i],
    ['link', /link|ссылк|havola|^map|карт|xarita|geo/i],
    ['added', /added|дата|date|sana/i],
    ['skip', /location|rasm|фото|photo|^№$|^n$|^#$/i]
  ];
  const digits = v => S(v).replace(/\D/g, '');
  const t9 = v => digits(v).slice(-9);
  const phoneLike = v => { const d = digits(v); return d.length >= 9 && d.length <= 13 && /^[\d\s+()\-./]+$/.test(S(v)); };
  // телефон → +998XXXXXXXXX; другое — как было (ok: false — показать «проверьте номер»)
  function phone(v) {
    v = val(v); if (!v) return null;
    const d = digits(v);
    if (/^998\d{9}$/.test(d)) return { v: '+' + d, ok: true };
    if (/^\d{9}$/.test(d)) return { v: '+998' + d, ok: true };
    if (/^8\d{9}$/.test(d)) return { v: '+998' + d.slice(1), ok: true };
    return { v, ok: false };
  }
  // в одной ячейке бывает несколько номеров: «90 123 45 67, 93 …» или по строкам
  const phones = v => typeof v === 'number' ? [phone(v)].filter(Boolean) : String(v == null ? '' : v).split(/[,;\n]+/).map(phone).filter(Boolean);
  const blNum = bl => { const m = S(bl).match(/^BL[-\s]*0*(\d+)$/i); return m ? +m[1] : null; };
  const blKey = bl => blNum(bl) != null ? 'BL#' + blNum(bl) : S(bl).toUpperCase();
  const blText = bl => { const m = S(bl).match(/^BL[-\s]*(\d+)$/i); return m ? 'BL-' + m[1] : S(bl).toUpperCase(); };

  // сетка книги (XlsxIO.readGrid: [{ name, rows: { 1: { A: … } } }]) → строки клиентов
  function parse(grid) {
    const sheets = Array.isArray(grid) ? grid : (grid && grid.sheets) || [];
    let best = null;
    sheets.forEach(sh => {
      const rows = sh.rows || {}, nums = Object.keys(rows).map(Number).sort((a, b) => a - b);
      nums.slice(0, 15).forEach(r => {
        const cols = {}, seen = {};
        Object.entries(rows[r] || {}).forEach(([c, v]) => { const h = S(v); if (!h) return; const f = (HEAD.find(([, re]) => re.test(h)) || [])[0]; if (f) { cols[c] = f; seen[f] = (seen[f] || 0) + 1; } });
        if (!Object.values(cols).includes('bl')) return;
        const score = Object.keys(seen).length;
        if (!best || score > best.score) best = { sh, r, cols, score, nums };
      });
    });
    if (!best) return { error: 'Не нашёл столбец с BL клиента («Shipping mark», «BL», «Маркировка»). Проверьте заголовки в первых строках листа.' };
    const { sh, r: hr, nums } = best, rows = sh.rows, cols = { ...best.cols }, body = nums.filter(r => r > hr);
    // по содержимому: «Name» со значениями «Сборный» / «Целый» — тип груза; безымянный («Column 9», пусто) или
    // «Remark» с номерами — телефон; столбец со ссылками — ссылка на место (координаты потом по ссылке)
    const allCols = [...new Set(body.flatMap(r => Object.keys(rows[r] || {})))];
    allCols.forEach(c => {
      if (['bl', 'passport'].includes(cols[c])) return;
      const vs = body.map(r => val((rows[r] || {})[c])).filter(Boolean);
      if (!vs.length) return;
      const share = re => vs.filter(v => re(v)).length / vs.length, h = S((rows[hr] || {})[c]);
      if ((cols[c] === 'name' || !cols[c]) && share(v => KIND.test(v)) > 0.7) cols[c] = 'kind';
      else if ((!cols[c] || cols[c] === 'remark' || /^column\s*\d+$/i.test(h)) && share(phoneLike) > 0.7) cols[c] = 'phone';
      else if ((!cols[c] || ['skip', 'remark', 'address'].includes(cols[c])) && share(v => URL.test(v)) > 0.7) cols[c] = 'link';
    });
    const by = f => Object.keys(cols).filter(c => cols[c] === f).sort((a, b) => a.length - b.length || a.localeCompare(b));
    const one = (row, f) => { for (const c of by(f)) { const v = val(row[c]); if (v) return v; } return ''; };
    const out = [], problems = [];
    let empty = 0;
    body.forEach(r => {
      const row = rows[r] || {}, bl = one(row, 'bl');
      const name = one(row, 'name'), brand = one(row, 'brand');
      const ph = []; by('phone').forEach(c => phones(row[c]).forEach(p => { if (!ph.some(x => digits(x.v) === digits(p.v))) ph.push(p); }));
      const rest = ['manager', 'business', 'address', 'district', 'kind', 'link'].some(f => one(row, f));
      if (!name && !brand && !ph.length && !rest) { empty++; return; }   // только № и BL — зарезервированный код
      if (!bl) { problems.push({ row: r, kind: 'nobl' }); return; }
      if (blNum(bl) === 0) { problems.push({ row: r, bl: blText(bl), kind: 'zero' }); return; }   // BL-00 — груз без владельца, не клиент
      ph.filter(p => !p.ok).forEach(() => problems.push({ row: r, bl: blText(bl), kind: 'phone' }));
      if (!name && !brand && !ph.length) problems.push({ row: r, bl: blText(bl), kind: 'thin' });
      const link = one(row, 'link');
      out.push({ row: r, bl: blText(bl), key: blKey(bl), name, brand, tel1: ph[0] ? ph[0].v : '', tel2: ph[1] ? ph[1].v : '',
        address: one(row, 'address'), district: one(row, 'district'), manager: one(row, 'manager'), business: one(row, 'business'),
        kind: one(row, 'kind'), remark: one(row, 'remark'), link: URL.test(link) ? link : '', more: ph.slice(2).map(p => p.v) });   // третий номер и дальше — в примечание
    });
    // один BL на нескольких строках: одинаковые — одна запись, разные клиенты — не загружаем (решает руководитель)
    const groups = new Map(); out.forEach(x => { if (!groups.has(x.key)) groups.set(x.key, []); groups.get(x.key).push(x); });
    const sig = x => [x.name, x.brand, x.tel1, x.tel2, x.address].join('|').toUpperCase();
    const list = [], dups = [], clash = [], drop = new Set();   // строки, о которых не говорим отдельно: повтор и «разные клиенты»
    groups.forEach(g => {
      if (g.length === 1) return list.push(g[0]);
      if (g.every(x => sig(x) === sig(g[0]))) { dups.push({ bl: g[0].bl, rows: g.map(x => x.row) }); g.slice(1).forEach(x => drop.add(x.row)); return list.push(g[0]); }
      clash.push({ bl: g[0].bl, rows: g.map(x => x.row), names: g.map(x => x.name || x.brand) }); g.forEach(x => drop.add(x.row));
    });
    return { sheet: sh.name, headerRow: hr, cols, rows: list, total: body.length, empty, dups, clash, problems: problems.filter(x => !drop.has(x.row)),
      passport: by('passport').length > 0, ignored: Object.keys(cols).filter(c => ['passport', 'added', 'skip'].includes(cols[c])).map(c => S((rows[hr] || {})[c])) };
  }

  const FIELDS = ['brand', 'name', 'address', 'district', 'link'];
  // примечание из файла: менеджер, тип груза, вид деятельности, примечание, номера сверх двух
  const noteOf = x => [x.manager && 'Менеджер: ' + x.manager, x.kind, x.business, x.remark, (x.more || []).length && 'Ещё телефон: ' + x.more.join(', ')].filter(Boolean).join(' · ');
  const blank = (f, a) => !a || (f === 'district' && a === 'Aniqlanmagan');
  // clients — справочник сайта; opts: fill — дополнить пустые поля (да), replace — заменить отличающиеся (нет),
  // notes — примечание из файла в пустое (да), districts — районы сайта (район из файла — их написанием)
  function merge(clients, parsed, opts = {}) {
    const o = { fill: true, replace: false, notes: true, ...opts }, list = clients.map(c => ({ ...c })), byKey = new Map();
    const dist = new Map((o.districts || []).map(d => [S(d).toUpperCase(), d]));
    const district = d => dist.get(S(d).toUpperCase()) || d;
    list.forEach((c, i) => { if (!byKey.has(blKey(c.bl))) byKey.set(blKey(c.bl), i); });
    const added = [], filled = [], diffs = [], same = [];
    parsed.rows.forEach(x0 => {
      const x = { ...x0, district: x0.district ? district(x0.district) : '' }, i = byKey.get(x.key), note = o.notes ? noteOf(x) : '';
      if (i == null) {
        const c = { bl: x.bl, brand: x.brand, name: x.name, tel1: x.tel1, tel2: x.tel2, receiver: '', receiverTel: '', district: x.district || 'Aniqlanmagan', address: x.address,
          lat: null, lon: null, note, manualZone: '', link: x.link, marks: '', locs: '' };
        byKey.set(x.key, list.push(c) - 1); added.push(c.bl); return;
      }
      const c = list[i], changed = {}, diff = [];
      FIELDS.forEach(f => {
        const a = S(c[f]), b = x[f];
        if (!b || a.toUpperCase() === b.toUpperCase()) return;
        if (blank(f, a)) { if (o.fill) changed[f] = b; }
        else if (o.replace) changed[f] = b;
        else diff.push({ f, site: a, file: b });
      });
      // телефоны сравниваются набором (последние 9 цифр): новый номер — в пустой tel1 / tel2, иначе — отличие
      const site = [S(c.tel1), S(c.tel2)], file = [x.tel1, x.tel2].filter(Boolean);
      const fresh = file.filter(p => !site.some(s => s && t9(s) === t9(p)));
      if (fresh.length && o.replace) {
        const keep = site.filter(s => s && !file.some(p => t9(p) === t9(s))), next = file.concat(keep).slice(0, 2);
        ['tel1', 'tel2'].forEach((f, k) => { if ((next[k] || '') !== site[k]) changed[f] = next[k] || ''; });
      } else if (fresh.length) {
        const free = [0, 1].filter(k => !site[k]);
        fresh.forEach(p => { if (o.fill && free.length) changed['tel' + (free.shift() + 1)] = p; else diff.push({ f: 'tel', site: site.filter(Boolean).join(', '), file: p }); });
      }
      if (note && !S(c.note)) changed.note = note;
      if (Object.keys(changed).length) { Object.assign(c, changed); filled.push({ bl: c.bl, fields: Object.keys(changed) }); }
      else same.push(c.bl);
      diff.forEach(d => diffs.push({ bl: c.bl, ...d }));
    });
    return { clients: list, added, filled, diffs, same };
  }

  const API = { parse, merge, phone, blKey, blText, noteOf };
  root.LogiClientImport = API;
  if (typeof module === 'object' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
