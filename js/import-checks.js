/* ИИ-импорт манифестов: проверки черновика кодом — цифрам ИИ не доверяем.
   Блокирующие (без них партию не создать):
     - Excel: маркировка или число строки не совпадает с ячейкой документа; строка документа пропущена;
       у строки нет ссылки на строку документа; две строки черновика ссылаются на одну строку документа;
     - сумма строк не сходится с итогом документа (TOTAL) — места точно, м³ до max(0,01; 0,1 %), кг до max(0,5; 0,1 %);
       итог, который неверен в самом документе, можно принять как есть (ack.total) — тогда это предупреждение;
     - у маркировки нет решения по клиенту (клиент из справочника, новый клиент или «без клиента»); новый клиент без BL;
       строка без маркировки; нет даты партии.
   Предупреждения: число не распознано или не положительное; плотность кг/м³ вне пределов из «Тарифов»;
     PDF: число не найдено в тексте страницы, скан (сверить не с чем); итога в документе нет; похоже на дубликат.
   Списки: мелкие маркировки (меньше порога «не платим»), неизвестные маркировки и BL-00. */
(function (root) {
  'use strict';
  const L = root.LogiImport || (typeof require === 'function' ? require('./import-core.js') : null);
  const { key, codeOf, cellOf, ownCell, rowNums, isUnknownOwner } = L;

  const num = v => {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (v == null) return null;
    let s = String(v).replace(/[\s ]/g, '');
    if (!s) return null;
    if (s.includes(',') && !s.includes('.')) s = s.replace(',', '.'); else s = s.replace(/,/g, '');
    return /^-?\d+(\.\d+)?$/.test(s) ? +s : null;
  };
  const same = (a, b) => a != null && b != null && Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));
  const r3 = x => Math.round(x * 1000) / 1000;
  const fmt = x => x == null ? '—' : String(+(+x).toFixed(3)).replace('.', ',');
  const TOL = { places: () => 0, cbm: t => Math.max(0.01, Math.abs(t) * 0.001), kg: t => Math.max(0.5, Math.abs(t) * 0.001) };
  const FIELDS = ['places', 'cbm', 'kg'], NAMES = { mark: 'маркировка', places: 'места', cbm: 'м³', kg: 'кг' };

  // Столбцы таблицы манифеста находит и сам код — по заголовкам; ответу ИИ верим, только если он с ними совпадает.
  // У каждого поля — варианты заголовка по приоритету: общий вес брутто (G.W.) раньше просто «KG», итоговый объём (T/CBM) раньше «CBM»;
  // NOT — заголовки, которые этим полем не бывают (нетто, объём одной коробки).
  const HEAD = {
    mark: [/SHIPPING\s*MARKS?|唛头|МАРКИР|MARKIROVKA/i, /^\s*MARKS?\b/i, /CUSTOMER|CLIENT|客户|КЛИЕНТ|MIJOZ/i],
    places: [/T(OTAL)?\.?\s*CTNS?|总件数|总箱数/i, /CTNS?|件数|箱数|PKGS?|PACKAGES|CARTONS?|МЕСТ/i, /QTY|КОЛ/i],
    cbm: [/T(OTAL)?\.?\s*\/?\s*CBM|TOTAL\s*(VOLUME|M3|M³)|总体积/i, /CBM|M3|M³|М3|М³|体积|VOLUME|ОБ[ЪЬ]?[ЁЕ]М/i],
    kg: [/T(OTAL)?\.?\s*\/?\s*G\.?\s?W|TOTAL\s*(G\.?\s?W|WEIGHT|KGS?)|总毛重/i, /G\.?\s?W|GROSS|毛重|БРУТТО/i, /(^|[^A-Z])KGS?([^A-Z]|$)|ВЕС|WEIGHT|重量/i]
  };
  const NOT = { kg: /N\.?\s?W|NET|净重|НЕТТО/i, cbm: /(CBM|M3)\s*\/\s*(CTN|CARTON)|PER\s*(CTN|CARTON)|单箱|单件/i, places: /PCS|PIECES|件\/箱|ШТ/i };
  // приоритет заголовка v для поля f: 0 — лучший, -1 — не подходит
  const headRank = (f, v) => typeof v !== 'string' || (NOT[f] && NOT[f].test(v)) ? -1 : HEAD[f].findIndex(re => re.test(v));
  const TOTAL_RE = /TOTAL|合计|总计|ИТОГО|JAMI|ВСЕГО/i, SUBTOTAL_RE = /SUB\s*-?\s*TOTAL|小计|ПОДЫТОГ|ПРОМЕЖУТ/i;
  // строка заголовков: столбцы по приоритету (при равенстве — левее); маркировка и м³ или кг обязательны
  function headerIn(sh, r) {
    const cols = {}, rank = {};
    for (const [c, v] of Object.entries(sh.rows[r] || {})) {
      if (typeof v !== 'string' || v.length > 60) continue;
      for (const f of Object.keys(HEAD)) {
        if (Object.values(cols).includes(c)) break;
        const k = headRank(f, v);
        if (k >= 0 && (rank[f] == null || k < rank[f])) { cols[f] = c; rank[f] = k; break; }
      }
    }
    return cols.mark && (cols.cbm || cols.kg) ? { sheet: sh.name, row: r, mark: cols.mark, places: cols.places || null, cbm: cols.cbm || null, kg: cols.kg || null } : null;
  }
  // ближайшая непустая маркировка выше строки r в таблице (до строки заголовков; итоги и подытоги её обрывают)
  function markAbove(sh, r, h) {
    for (let n = r - 1; n > h.row; n--) {
      const row = sh.rows[n]; if (!row) continue;
      if (TOTAL_RE.test(Object.values(row).filter(v => typeof v === 'string').join(' '))) return null;
      const m = cellOf(sh, n, h.mark); if (key(m)) return m;
    }
    return null;
  }
  function findHeader(book) {
    for (const sh of book) for (const r of rowNums(sh)) { const h = headerIn(sh, r); if (h) return h; }
    return null;
  }
  function headerOf(book, ai) {
    const found = findHeader(book);
    if (ai && ai.sheet && ai.row) {
      const sh = book.find(s => s.name === ai.sheet), row = sh && sh.rows[ai.row];
      const fits = row && ['mark', 'cbm', 'kg'].every(f => !ai[f] || headRank(f, row[ai[f]]) >= 0);
      if (fits && (!found || (found.sheet === ai.sheet && found.row === ai.row))) return { ...ai, by: 'ai+code' };
    }
    return found ? { ...found, by: 'code' } : null;
  }

  // строки черновика → группы по маркировке (объединение строк одной маркировки)
  function groupsOf(draft) {
    const g = {};
    draft.rows.forEach(r => {
      const k = key(r.mark) || '∅' + r.id;
      const x = g[k] = g[k] || { key: k, mark: r.mark, rowIds: [], places: 0, cbm: 0, kg: 0, anyPlaces: false, anyCbm: false, anyKg: false };
      x.rowIds.push(r.id);
      if (num(r.places) != null) { x.places += num(r.places); x.anyPlaces = true; }
      if (num(r.cbm) != null) { x.cbm += num(r.cbm); x.anyCbm = true; }
      if (num(r.kg) != null) { x.kg += num(r.kg); x.anyKg = true; }
    });
    return Object.values(g).map(x => ({ ...x, cbm: r3(x.cbm), kg: r3(x.kg), decision: (draft.marks || {})[x.key] || null }));
  }

  // ctx: { book (Excel) | pages (PDF: [{ page, text }]), settings, shipments (журнал), imports (подтверждённые из «ИИ-журнала»), drafts (другие черновики) }
  function check(draft, ctx = {}) {
    const S = ctx.settings || {}, blocking = [], warnings = [], flags = {};
    const flag = (id, level, code, text, field) => { (flags[id] = flags[id] || []).push({ level, code, text, field }); };
    const block = (code, text, extra) => blocking.push({ code, text, ...extra }), warn = (code, text, extra) => warnings.push({ code, text, ...extra });
    const rows = draft.rows || [], byId = Object.fromEntries(rows.map(r => [r.id, r])), kind = draft.file && draft.file.kind;
    const edited = (r, f) => r.ai && f in r.ai && String(r.ai[f] ?? '') !== String(r[f] ?? '');

    // ── Excel: каждая строка — с ячейкой документа ──
    let header = null, totalCells = null;
    if (kind === 'xlsx' && ctx.book) {
      header = headerOf(ctx.book, draft.meta && draft.meta.header);
      if (!header) warn('no-header', 'Не найдена строка заголовков таблицы (SHIPPING MARK, CTN, CBM, KG) — числа не сверены с ячейками. Проверьте строки вручную.');
      const seen = {};
      rows.forEach(r => {
        const s = r.src || {}, sh = s.sheet ? ctx.book.find(b => b.name === s.sheet) : null;
        if (!sh || !s.row || !sh.rows[s.row]) { block('no-src', 'У строки нет ссылки на строку документа', { rowIds: [r.id] }); flag(r.id, 'block', 'no-src', 'Нет ссылки на строку документа'); return; }
        const k = s.sheet + '!' + s.row;
        if (seen[k]) { block('dup-src', 'Две строки черновика ссылаются на одну строку документа: ' + k, { rowIds: [seen[k], r.id] }); flag(r.id, 'block', 'dup-src', 'Та же строка документа, что и у другой строки'); }
        seen[k] = r.id;
        if (!header || header.sheet !== s.sheet) return;
        if (header.row >= s.row) { block('src-header', 'Строка ' + s.row + ' — это шапка документа, а не груз', { rowIds: [r.id] }); flag(r.id, 'block', 'src-header', 'Это шапка документа'); return; }
        let cm = cellOf(sh, s.row, header.mark);
        // пустая ячейка маркировки — строка продолжает маркировку сверху (как у объединённой ячейки)
        if (!key(cm)) { const up = markAbove(sh, s.row, header); if (up && key(up) === key(r.mark)) { cm = up; flag(r.id, 'warn', 'mark-above', 'Маркировка взята из строки выше: в документе ячейка пустая', 'mark'); } }
        if (key(cm) !== key(r.mark)) {
          const txt = 'маркировка в документе «' + (cm ?? '') + '», в строке «' + r.mark + '»';
          if (edited(r, 'mark')) { flag(r.id, 'warn', 'cell-mark', 'Исправлено вами: ' + txt, 'mark'); }
          else { block('cell', 'R' + s.row + ': ' + txt, { rowIds: [r.id] }); flag(r.id, 'block', 'cell-mark', 'Не совпадает с ячейкой: ' + txt, 'mark'); }
        }
        FIELDS.forEach(f => {
          if (!header[f]) return;
          const cv = num(ownCell(sh, s.row, header[f])), v = num(r[f]);
          if (cv == null && v == null) return;
          if (!same(v, cv)) {
            const txt = NAMES[f] + ': в документе ' + fmt(cv) + ', в строке ' + fmt(v);
            if (edited(r, f)) flag(r.id, 'warn', 'cell-' + f, 'Исправлено вами — ' + txt, f);
            else { block('cell', 'R' + s.row + ' — ' + txt, { rowIds: [r.id] }); flag(r.id, 'block', 'cell-' + f, 'Не совпадает с ячейкой — ' + txt, f); }
          }
        });
      });
      // строки документа между заголовком и итогом, которых нет в черновике
      if (header) {
        const sh = ctx.book.find(b => b.name === header.sheet), taken = new Set(rows.filter(r => r.src && r.src.sheet === header.sheet).map(r => r.src.row));
        for (const n of rowNums(sh).filter(n => n > header.row)) {
          const texts = Object.values(sh.rows[n]).filter(v => typeof v === 'string').join(' ');
          if (SUBTOTAL_RE.test(texts)) continue;
          if (TOTAL_RE.test(texts)) { totalCells = { row: n, places: header.places ? num(cellOf(sh, n, header.places)) : null, cbm: header.cbm ? num(cellOf(sh, n, header.cbm)) : null, kg: header.kg ? num(cellOf(sh, n, header.kg)) : null }; break; }
          const vals = FIELDS.filter(f => header[f]).map(f => num(ownCell(sh, n, header[f])));
          if (vals.some(v => v != null && v !== 0) && !taken.has(n) && !(draft.skipped || []).includes(header.sheet + '!' + n))
            block('missed', 'Строка документа R' + n + ' (' + (cellOf(sh, n, header.mark) ?? 'без маркировки') + ') не попала в черновик', { src: { sheet: header.sheet, row: n } });
        }
      }
    }
    // ── PDF: числа строки — в тексте страницы ──
    if (kind === 'pdf' && ctx.pages) {
      const scans = ctx.pages.filter(p => !String(p.text || '').trim()).map(p => p.page);
      if (scans.length) warn('scan', 'Страниц без текста (скан): ' + scans.length + ' — числа на них не сверены с документом. Проверьте строки вручную.');
      // запятая в тексте: десятичная (1,234 → 1.234) или тысячи (1,320 → 1320) — число ищется в обоих вариантах
      const norm = t => String(t || '').replace(/(\d),(\d)/g, '$1.$2').replace(/\s+/g, ' ') + '\n' + String(t || '').replace(/(\d),(\d{3})(?!\d)/g, '$1$2').replace(/\s+/g, ' ');
      rows.forEach(r => {
        const p = r.src && r.src.page, pg = ctx.pages.find(x => x.page === p);
        if (!p || !pg) { block('no-src', 'У строки нет номера страницы', { rowIds: [r.id] }); flag(r.id, 'block', 'no-src', 'Нет номера страницы'); return; }
        if (!String(pg.text || '').trim()) { flag(r.id, 'warn', 'scan', 'Скан — не сверено с текстом'); return; }
        const t = norm(pg.text), tk = key(pg.text);
        if (r.mark && !tk.includes(key(r.mark))) flag(r.id, 'warn', 'pdf-mark', 'Маркировка не найдена в тексте страницы ' + p, 'mark');
        FIELDS.forEach(f => { const v = num(r[f]); if (v == null) return;
          const re = new RegExp('(^|[^\\d.])' + String(v).replace('.', '\\.') + '(0*)(?![\\d])');
          if (!re.test(t)) flag(r.id, 'warn', 'pdf-' + f, NAMES[f] + ' ' + fmt(v) + ' не найдено в тексте страницы ' + p, f); });
      });
    }

    // ── числа строк ──
    rows.forEach(r => {
      if (!String(r.mark || '').trim()) { block('no-mark', 'Строка без маркировки', { rowIds: [r.id] }); flag(r.id, 'block', 'no-mark', 'Нет маркировки', 'mark'); }
      FIELDS.forEach(f => { const v = num(r[f]);
        if (v == null) { flag(r.id, 'warn', 'nan-' + f, NAMES[f] + ' не распознано', f); warn('nan', 'Строка «' + (r.mark || '—') + '»: ' + NAMES[f] + ' не распознано', { rowIds: [r.id] }); }
        else if (v <= 0) { flag(r.id, 'warn', 'neg-' + f, NAMES[f] + ' не больше нуля', f); warn('neg', 'Строка «' + (r.mark || '—') + '»: ' + NAMES[f] + ' = ' + fmt(v), { rowIds: [r.id] }); } });
    });

    // ── итог документа ──
    const sum = rows.reduce((a, r) => ({ places: a.places + (num(r.places) || 0), cbm: a.cbm + (num(r.cbm) || 0), kg: a.kg + (num(r.kg) || 0) }), { places: 0, cbm: 0, kg: 0 });
    sum.cbm = r3(sum.cbm); sum.kg = r3(sum.kg);
    const aiT = draft.meta && draft.meta.total;
    let doc = null;
    if (totalCells) {
      doc = { places: totalCells.places, cbm: totalCells.cbm, kg: totalCells.kg, src: { sheet: header.sheet, row: totalCells.row } };
      if (aiT && FIELDS.some(f => aiT[f] != null && doc[f] != null && !same(num(aiT[f]), doc[f]))) warn('total-ai', 'ИИ прочитал итог иначе, чем в ячейках — взят итог из ячеек документа');
    } else if (aiT && FIELDS.some(f => aiT[f] != null)) doc = { places: num(aiT.places), cbm: num(aiT.cbm), kg: num(aiT.kg), src: { sheet: aiT.sheet, row: aiT.row, page: aiT.page } };
    const diff = {};
    if (!doc) warn('no-total', 'В документе не найдена итоговая строка (TOTAL) — сумма не проверена');
    else {
      const bad = FIELDS.filter(f => doc[f] != null && Math.abs(sum[f] - doc[f]) > TOL[f](doc[f]) + 1e-9);
      bad.forEach(f => { diff[f] = r3(sum[f] - doc[f]); });
      if (bad.length) {
        const txt = 'Сумма строк не сходится с итогом документа: ' + bad.map(f => NAMES[f] + ' ' + fmt(sum[f]) + ' против ' + fmt(doc[f])).join(', ');
        if (draft.ack && draft.ack.total) warn('total-ack', txt + ' — принято как есть (итог документа неверный)');
        else block('total', txt);
      }
    }

    // ── маркировки: объединение, клиенты, плотность, мелкие, неизвестные ──
    const groups = groupsOf(draft), lim = +S.freeOutM3 || 0, dMin = +S.densityMin || 0, dMax = +S.densityMax || 0;
    groups.forEach(g => {
      const d = g.decision;
      g.density = g.cbm > 0 && g.kg > 0 ? Math.round(g.kg / g.cbm) : null;
      if (!String(g.mark || '').trim()) return;
      if (!d || !d.decided) { block('no-client', 'Маркировка «' + g.mark + '» без решения: выберите клиента или «без клиента»', { markKey: g.key, rowIds: g.rowIds }); g.rowIds.forEach(id => flag(id, 'block', 'no-client', 'Нет решения по клиенту', 'client')); }
      else if (d.isNew && !String(d.client || '').trim()) { block('new-bl', 'Маркировка «' + g.mark + '» — новый клиент: впишите его BL (или выберите клиента / «без клиента»)', { markKey: g.key, rowIds: g.rowIds }); g.rowIds.forEach(id => flag(id, 'block', 'new-bl', 'Новый клиент без BL', 'client')); }
      if (g.density != null && ((dMin && g.density < dMin) || (dMax && g.density > dMax))) {
        g.heavy = dMax && g.density > dMax; g.light = dMin && g.density < dMin;
        warn('density', '«' + g.mark + '»: плотность ' + g.density + ' кг/м³ — ' + (g.heavy ? 'больше ' + dMax : 'меньше ' + dMin) + ' кг/м³ из «Тарифов»', { markKey: g.key, rowIds: g.rowIds });
        g.rowIds.forEach(id => flag(id, 'warn', 'density', 'Плотность ' + g.density + ' кг/м³'));
      }
    });
    const pack = list => ({ items: list.map(g => ({ key: g.key, mark: g.mark, places: g.places, cbm: g.cbm, kg: g.kg, rowIds: g.rowIds })), n: list.length,
      places: list.reduce((a, g) => a + g.places, 0), cbm: r3(list.reduce((a, g) => a + g.cbm, 0)), kg: r3(list.reduce((a, g) => a + g.kg, 0)) });
    const small = pack(groups.filter(g => lim > 0 && g.anyCbm && g.cbm < lim - 1e-9));
    const unknown = pack(groups.filter(g => String(g.mark || '').trim() && (isUnknownOwner(g.mark) || !g.decision || !g.decision.client)));
    const heavy = pack(groups.filter(g => g.heavy));

    // ── дубликаты: та же дата и те же итоги (и маршрут, если он известен) ──
    const tot = doc || sum, date = draft.journalDate, route = key((draft.meta || {}).route);
    const close = (a, b) => a && b && FIELDS.every(f => a[f] == null || b[f] == null || Math.abs(num(a[f]) - num(b[f])) <= TOL[f](num(b[f]) || 0) + 1e-9) && FIELDS.some(f => a[f] != null && b[f] != null);
    const dups = [];
    const jr = (ctx.shipments || []).filter(s => s.date === date);
    if (jr.length) {
      const add = (m, k, v) => { const x = m[k] = m[k] || { places: 0, cbm: 0, kg: 0 }; FIELDS.forEach(f => { x[f] += +v[f] || 0; }); };
      const js = {}; jr.forEach(s => add(js, '*', s));
      if (close(js['*'], tot)) dups.push('в журнале за ' + date + ' уже ' + jr.length + ' отгрузок с теми же итогами');
      else {
        // по клиентам: итог партии мог разойтись из-за одной строки, а остальные клиенты уже внесены с теми же цифрами
        const J = {}, M = {}; jr.forEach(s => add(J, s.bl, s)); groups.forEach(g => { if (g.decision && g.decision.client) add(M, g.decision.client, g); });
        const same = Object.keys(M).filter(c => J[c] && close(J[c], M[c])), n = Object.keys(M).length;
        const odd = Object.keys(M).filter(c => J[c] && !close(J[c], M[c])), v3 = x => x.places + ' мест · ' + fmt(r3(x.cbm)) + ' м³ · ' + fmt(r3(x.kg)) + ' кг';
        if (same.length >= 2 && same.length * 2 >= n) dups.push('в журнале за ' + date + ' у ' + same.length + ' из ' + n + ' клиентов этого манифеста уже есть отгрузки с теми же цифрами (' + same.slice(0, 6).join(', ') + (same.length > 6 ? '…' : '') + ')' +
          (odd.length ? '; расходится: ' + odd.slice(0, 3).map(c => c + ' — в журнале ' + v3(J[c]) + ', в манифесте ' + v3(M[c])).join('; ') : ''));
      }
    }
    (ctx.imports || []).forEach(im => { if (im.date === date && close(im, tot) && (!route || !im.route || key(im.route) === route)) dups.push('этот манифест уже подтверждён' + (im.at ? ' (' + String(im.at).slice(0, 10) + ')' : '')); });
    (ctx.drafts || []).forEach(o => { if (o.id !== draft.id && o.status !== 'rejected' && o.journalDate === date && close(o.totals, tot) && (!route || !o.route || key(o.route) === route)) dups.push('есть другой черновик с тем же манифестом (' + (o.fileName || o.id) + ')'); });
    if (dups.length) warn('duplicate', 'Похоже на повторный импорт: ' + [...new Set(dups)].join('; '));

    if (!/^20\d\d-\d{2}-\d{2}$/.test(draft.journalDate || '')) block('no-date', 'Укажите дату партии в журнале (год полностью: 2026)');
    return { ok: !blocking.length, blocking, warnings, flags, header, groups, sum, doc, diff, lists: { small, unknown, heavy } };
  }

  // Партия для журнала: строки одной маркировки — одна отгрузка; маркировки одного клиента — тоже одна (в примечании все маркировки).
  // «Без клиента» — BL как в документе (например, BL-00): такие отгрузки видны в «Проверке» как «BL не из справочника».
  function shipmentsOf(draft, extraNote) {
    const by = {};
    groupsOf(draft).forEach(g => {
      if (!String(g.mark || '').trim()) return;
      const d = g.decision || {}, c = codeOf(g.mark), bl = d.client || (c && !isUnknownOwner(g.mark) ? c : String(g.mark).trim().toUpperCase());
      const x = by[bl] = by[bl] || { bl, cbm: 0, kg: 0, places: 0, marks: [], client: d.client || null };
      x.cbm += g.cbm; x.kg += g.kg; x.places += g.places; x.marks.push(g.mark);
    });
    return Object.values(by).map(x => ({ date: draft.journalDate, bl: x.bl, cbm: r3(x.cbm), kg: r3(x.kg), places: x.places, truck: 'Belgilanmagan', route: null, status: 'Rejada',
      note: [extraNote, x.marks.filter(m => key(m) !== key(x.bl)).length ? 'маркировка: ' + x.marks.join(', ') : ''].filter(Boolean).join(' · '), client: x.client }));
  }

  // Ручные правки: поля строк, отличающиеся от ответа ИИ, добавленные и удалённые строки, решения по клиентам не как у ИИ / кода
  function editStats(draft) {
    const rows = draft.rows || [];
    let fields = 0; rows.forEach(r => { if (!r.ai) return; ['mark', ...FIELDS].forEach(f => { if (String(r.ai[f] ?? '') !== String(r[f] ?? '')) fields++; }); });
    const added = rows.filter(r => !r.ai).length, deleted = (draft.deleted || []).length;
    const clients = Object.values(draft.marks || {}).filter(m => m.decided && m.byUser && m.client !== (m.auto ? m.auto.client : (m.suggest ? m.suggest.client : null))).length;
    const total = fields + added + deleted + clients, of = rows.length * 4 + Object.keys(draft.marks || {}).length;
    return { fields, added, deleted, clients, total, of };
  }

  const API = { check, groupsOf, shipmentsOf, editStats, findHeader, headerIn, headerOf, headRank, markAbove, num, TOTAL_RE, SUBTOTAL_RE };
  root.LogiImport = Object.assign(root.LogiImport || {}, API);
  if (typeof module === 'object' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
