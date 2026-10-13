/* Пакинг-листы: разбор книги Excel (сетка из js/xlsx-io.js readGrid) в коробки отгрузки — «60×40×50×12; …».
   Шаблоны разные (китайские, русские, английские): ищется строка заголовка со столбцами длины, ширины и высоты коробки
   (长/宽/高, L/W/H, Length/Width/Height, Д/Ш/В, длина/ширина/высота) и столбец с числом коробок (件数, 箱数, CTN, CTNS,
   cartons, коробка, мест) — не «штук в коробке» (装箱数, QTY/CTN, PCS/CTN, 每箱数量, в упаковке). Единицы — по заголовку
   ((m), mm, см) и по значениям; если есть столбец объёма (体积, CBM, m³) — сверяется с ним (на коробку или всего).
   BL — по ячейке «Customer shipping mark / 客户唛头», столбцу «Mark», любой ячейке вида BL-71 или по имени файла.
   window.LogiPacking.parseBook(book, { fileName, bls }) → { ok, sheet, unit, groups: [{ l, w, h, n, desc, row }], n, m3,
   text, bl, marks, notes } или { ok: false, error }. Размеры в результате — см. */
(function () {
  'use strict';
  const str = v => v == null ? '' : String(v).replace(/\s+/g, ' ').trim();
  const num = v => { if (typeof v === 'number') return isFinite(v) ? v : null; const s = str(v).replace(',', '.'); if (!s) return null; const m = s.match(/^-?\d+(?:\.\d+)?$/); return m ? +m[0] : null; };
  const colIdx = c => { let n = 0; for (const ch of c) n = n * 26 + (ch.charCodeAt(0) - 64); return n; };
  const low = s => str(s).toLowerCase();
  // размеры коробки — заголовки столбцов (одно измерение в ячейке; «L*W*H» в одной ячейке — не заголовок размеров)
  // слово — где угодно в ячейке; одна буква (L/W/H, Д/Ш/В) — только в начале («L(长)», «Д 长»), иначе «в упаковке» стало бы высотой
  const DIM = {
    l: [/(^|[^a-zа-яё])(长度?|長|length|len|длина|дл\.|uzunlik|uzunligi)(\b|[^a-zа-яё]|$)/iu, /^(l|д)(\b|[^a-zа-яё]|$)/iu],
    w: [/(^|[^a-zа-яё])(宽度?|寬|width|ширина|шир\.|kenglik|kengligi)(\b|[^a-zа-яё]|$)/iu, /^(w|ш)(\b|[^a-zа-яё]|$)/iu],
    h: [/(^|[^a-zа-яё])(高度?|height|высота|выс\.|balandlik|balandligi)(\b|[^a-zа-яё]|$)/iu, /^(h|в)(\b|[^a-zа-яё]|$)/iu]
  };
  const dimOf = s => { const t = low(s).replace(/[（）()]/g, ' ').trim(); if (!t || t.length > 24) return null; const hits = ['l', 'w', 'h'].filter(k => DIM[k][0].test(' ' + t + ' ') || DIM[k][1].test(t)); return hits.length === 1 ? hits[0] : null; };
  const CNT = /(件数|箱数|箱\s*数|ctns?\b|cartons?|коробк|мест|qutilar|quti|joy)/i, NOT_CNT = /(qty\s*\/\s*ctn|pcs\s*\/\s*ctn|装箱|个\s*\/\s*箱|支\s*\/\s*箱|每箱|в упаковке|per\s*ctn|в коробке|в кор)/i;
  const VOL = /(体积|立方|cbm|volume|объ[её]м|hajm|m³|м³)/i, NOT_VOL = /(总|t\.\s*cbm|total|общ|jami)/i;
  const MARK = /(shipping\s*mark|唛头|唛|^mark$|маркировк|belgi)/i;
  const BL = /\b(BL|BMW|EURO|DREAM)[\s-]?\d{1,4}\b/i;
  function cellsOf(sh) { const rows = sh.rows || {}; return Object.keys(rows).map(Number).sort((a, b) => a - b).map(r => ({ r, c: rows[r] })); }
  // строка заголовка: три столбца размеров подряд (длина, ширина, высота — каждая не дальше двух столбцов) — первая сверху;
  // «长度» (длина товара) левее в той же строке не мешает: берётся тройка, что стоит рядом
  function findHeader(rows) {
    for (const { r, c } of rows) {
      const cols = { l: [], w: [], h: [] };
      Object.keys(c).forEach(k => { const d = dimOf(c[k]); if (d) cols[d].push(colIdx(k)); });
      for (const l of cols.l) for (const w of cols.w) for (const h of cols.h) if (w > l && w - l <= 2 && h > w && h - w <= 2) return { row: r, l, w, h };
    }
    return null;
  }
  // столбец с числом коробок: в строке заголовка или до двух строк выше, не столбцы размеров
  function findCol(rows, head, re, not, skip) {
    const cand = rows.filter(x => x.r <= head.row && x.r >= head.row - 2).sort((a, b) => b.r - a.r);
    for (const { c } of cand) for (const k of Object.keys(c)) {
      const i = colIdx(k), t = str(c[k]);
      if (skip.includes(i) || !t || !re.test(t) || not.test(t)) continue;
      return i;
    }
    return null;
  }
  const UNIT = { mm: 0.1, cm: 1, m: 100 };   // множитель к сантиметрам
  function unitFromText(t) { t = low(t); if (/\bmm\b|мм|毫米|mm[)）]/.test(t)) return 'mm'; if (/[(（]\s*m\s*[)）]|\bметр|metr|\b米\b|\(м\)|\bm\b/.test(t)) return 'm'; if (/\bcm\b|см|厘米|sm\b/.test(t)) return 'cm'; return null; }
  function parseSheet(sh, opts) {
    const rows = cellsOf(sh), head = findHeader(rows);
    if (!head) return null;
    const dimCols = [head.l, head.w, head.h];
    const nCol = findCol(rows, head, CNT, NOT_CNT, dimCols), vCol = findCol(rows, head, VOL, NOT_VOL, dimCols);
    if (!nCol) return { error: 'Нашёл размеры коробок (строка ' + head.row + '), но не столбец с числом коробок (件数 / CTN / коробок)' };
    const get = (c, i) => { for (const k of Object.keys(c)) if (colIdx(k) === i) return c[k]; return undefined; };
    const raw = [], notes = [];
    rows.filter(x => x.r > head.row).forEach(({ r, c }) => {
      const l = num(get(c, head.l)), w = num(get(c, head.w)), h = num(get(c, head.h)), n = num(get(c, nCol));
      const desc = Object.keys(c).filter(k => colIdx(k) < head.l && colIdx(k) !== nCol).map(k => c[k]).filter(v => typeof v === 'string' && str(v) && !/^(total|итого|合计|jami)$/i.test(str(v))).slice(0, 2).map(str).join(' · ');
      if (l > 0 && w > 0 && h > 0 && n >= 1) raw.push({ r, l, w, h, n: Math.round(n), v: vCol ? num(get(c, vCol)) : null, desc });
      else if (desc && n >= 1 && !(l > 0 && w > 0 && h > 0)) notes.push('строка ' + r + ' («' + desc.slice(0, 30) + '»): нет размеров коробки — пропущена');
    });
    if (!raw.length) return { error: 'Под заголовком (строка ' + head.row + ') нет строк с размерами и числом коробок' };
    // единицы: заголовок размеров или строка над ним → иначе по объёму → иначе по величинам
    const headText = rows.filter(x => x.r <= head.row && x.r >= head.row - 1).map(({ c }) => [head.l, head.w, head.h].map(i => str(get(c, i))).join(' ')).join(' ');
    let unit = unitFromText(headText);
    if (vCol && raw.some(x => x.v > 0)) {   // объём на коробку или всего: какие единицы сходятся
      let best = null;
      Object.keys(UNIT).forEach(u => { const k = UNIT[u] / 100, ok = raw.filter(x => x.v > 0).filter(x => { const per = x.l * x.w * x.h * k * k * k; return Math.abs(per - x.v) <= Math.max(0.003, x.v * 0.15) || Math.abs(per * x.n - x.v) <= Math.max(0.003, x.v * 0.15); }).length; if (!best || ok > best.ok) best = { u, ok }; });
      if (best && best.ok > 0) unit = best.u;
    }
    if (!unit) { const mx = Math.max(...raw.map(x => Math.max(x.l, x.w, x.h))); unit = mx <= 10 ? 'm' : mx > 500 ? 'mm' : 'cm'; }
    const k = UNIT[unit], groups = raw.map(x => ({ l: rnd(x.l * k), w: rnd(x.w * k), h: rnd(x.h * k), n: x.n, desc: x.desc, row: x.r }));
    const bad = groups.filter(g => [g.l, g.w, g.h].some(v => !(v >= 1 && v <= 500)));
    if (bad.length) notes.push('размеры вне 1–500 см: строки ' + bad.map(g => g.row).join(', ') + ' — проверьте единицы');
    return { sheet: sh.name, header: head, unit, groups: groups.filter(g => !bad.includes(g)), notes };
  }
  const rnd = v => Math.round(v * 10) / 10;
  // маркировки (BL) в книге: ячейка после «shipping mark / 唛头», столбец Mark, любая ячейка вида BL-71
  function findMarks(book) {
    const marks = [];
    book.forEach(sh => cellsOf(sh).forEach(({ c }) => {
      const keys = Object.keys(c).sort((a, b) => colIdx(a) - colIdx(b));
      keys.forEach((k, i) => { const t = str(c[k]); if (!t) return;
        if (MARK.test(t)) { const m = t.match(BL); if (m) marks.push(m[0]); else for (let j = i + 1; j < keys.length; j++) { const v = str(c[keys[j]]); if (v && v.length <= 20 && !/[\u4e00-\u9fff]/.test(v)) { marks.push(v); break; } } }
        else { const m = t.match(BL); if (m && t.length <= 20) marks.push(m[0]); } });
    }));
    return [...new Set(marks.map(x => x.toUpperCase()))];
  }
  const norm = s => str(s).toUpperCase().replace(/[^0-9A-ZА-ЯЁ]+/g, ' ').trim();
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // какой BL из списка партии упомянут в тексте: самый длинный; разделители не важны («BL-71» = «bl 71» = «BL71»),
  // код не часть большего («BL-7» не найдётся в «BL-71», «BL-71» — найдётся в «BL-71 68 MESTA»)
  function matchBl(text, bls) {
    const t = ' ' + norm(text) + ' '; let best = '';
    (bls || []).forEach(bl => {
      const b = norm(bl); if (!b || b.length <= best.length) return;
      const re = new RegExp('(^|[^0-9A-ZА-ЯЁ])' + b.split(' ').map(esc).join(' ?').replace(/([A-ZА-ЯЁ])(\d)/g, '$1 ?$2').replace(/(\d)([A-ZА-ЯЁ])/g, '$1 ?$2') + '(?![0-9A-ZА-ЯЁ])', 'i');
      if (re.test(t)) best = bl;
    });
    return best;
  }
  function parseBook(book, opts) {
    opts = opts || {};
    let res = null, firstErr = null;
    for (const sh of book || []) { const r = parseSheet(sh, opts); if (r && !r.error) { res = r; break; } if (r && r.error && !firstErr) firstErr = r.error; }
    if (!res) return { ok: false, error: firstErr || 'Не нашёл строку заголовка с длиной, шириной и высотой коробки (长/宽/高, L/W/H, Д/Ш/В)' };
    const merged = [];
    res.groups.forEach(g => { const s = merged.find(x => x.l === g.l && x.w === g.w && x.h === g.h); if (s) s.n += g.n; else merged.push({ l: g.l, w: g.w, h: g.h, n: g.n }); });
    const marks = findMarks(book), bls = opts.bls || [];
    const bl = marks.map(m => matchBl(m, bls)).find(Boolean) || matchBl(opts.fileName || '', bls) || '';
    return { ok: true, sheet: res.sheet, unit: res.unit, groups: res.groups, n: res.groups.reduce((a, g) => a + g.n, 0),
      m3: Math.round(res.groups.reduce((a, g) => a + g.l * g.w * g.h * g.n, 0) / 1e6 * 1000) / 1000,
      text: merged.map(g => [g.l, g.w, g.h].map(v => String(v).replace('.', ',')).join('×') + '×' + g.n).join('; '), bl, marks, notes: res.notes };
  }
  window.LogiPacking = { parseBook, findMarks, matchBl, dimOf };
})();
