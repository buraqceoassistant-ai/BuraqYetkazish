(function () {
  const dec = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCharCode(parseInt(n, 16))).replace(/&amp;/g, '&');
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const TD = new TextDecoder(), TE = new TextEncoder();

  async function pipe(u8, stream) { return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(stream)).arrayBuffer()); }
  async function readZip(ab) {
    const buf = new Uint8Array(ab), dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let e = buf.length - 22; while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error('Это не файл .xlsx');
    const n = dv.getUint16(e + 10, true); let off = dv.getUint32(e + 16, true);
    const files = {}, order = [];
    for (let i = 0; i < n; i++) {
      const method = dv.getUint16(off + 10, true), csize = dv.getUint32(off + 20, true), nl = dv.getUint16(off + 28, true), el = dv.getUint16(off + 30, true), cl = dv.getUint16(off + 32, true), lho = dv.getUint32(off + 42, true);
      const name = TD.decode(buf.slice(off + 46, off + 46 + nl));
      const lnl = dv.getUint16(lho + 26, true), lel = dv.getUint16(lho + 28, true);
      const data = buf.slice(lho + 30 + lnl + lel, lho + 30 + lnl + lel + csize);
      files[name] = method === 0 ? data : await pipe(data, new DecompressionStream('deflate-raw'));
      order.push(name); off += 46 + nl + el + cl;
    }
    return { files, order };
  }
  const crcT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = u => { let c = 0xFFFFFFFF; for (let i = 0; i < u.length; i++) c = crcT[(c ^ u[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  async function writeZip(files, order) {
    const parts = [], cd = []; let off = 0;
    for (const nm of order) {
      const raw = files[nm], name = TE.encode(nm), crc = crc32(raw), comp = await pipe(raw, new CompressionStream('deflate-raw'));
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 8, true); h.setUint16(12, 0x21, true);
      h.setUint32(14, crc, true); h.setUint32(18, comp.length, true); h.setUint32(22, raw.length, true); h.setUint16(26, name.length, true);
      parts.push(new Uint8Array(h.buffer), name, comp);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 8, true); c.setUint16(14, 0x21, true);
      c.setUint32(16, crc, true); c.setUint32(20, comp.length, true); c.setUint32(24, raw.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
      cd.push(new Uint8Array(c.buffer), name);
      off += 30 + name.length + comp.length;
    }
    const size = cd.reduce((a, p) => a + p.length, 0), e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, order.length, true); e.setUint16(10, order.length, true); e.setUint32(12, size, true); e.setUint32(16, off, true);
    return new Blob([...parts, ...cd, new Uint8Array(e.buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  const txt = (z, p) => z.files[p] ? TD.decode(z.files[p]) : '';
  const put = (z, p, s) => { z.files[p] = TE.encode(s); };
  function sheetPaths(z) {
    const wb = txt(z, 'xl/workbook.xml'), rels = txt(z, 'xl/_rels/workbook.xml.rels'), rmap = {}, out = {};
    for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) { const id = m[0].match(/Id="([^"]+)"/), t = m[0].match(/Target="([^"]+)"/); if (id && t) rmap[id[1]] = t[1]; }
    for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) { const nm = m[0].match(/name="([^"]+)"/), id = m[0].match(/r:id="([^"]+)"/); if (nm && id && rmap[id[1]]) out[dec(nm[1])] = rmap[id[1]].startsWith('/') ? rmap[id[1]].slice(1) : 'xl/' + rmap[id[1]]; }
    return out;
  }
  function shared(z) { return [...txt(z, 'xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => dec([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join(''))); }
  function readSheet(xml, ss) {
    const rows = {};
    for (const r of xml.matchAll(/<row\b[^>]*?\br="(\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      if (!r[2]) continue; const cells = {};
      for (const c of r[2].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const body = c[3] || '', t = (c[2].match(/\bt="(\w+)"/) || [])[1], v = body.match(/<v>([\s\S]*?)<\/v>/);
        let val = null;
        if (t === 'inlineStr') val = dec([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join(''));
        else if (!v) continue;
        else if (t === 's') val = ss[+v[1]];
        else if (t === 'str' || t === 'e') val = dec(v[1]);
        else if (t === 'b') val = v[1] === '1';
        else val = +v[1];
        if (val === '' || val == null) continue;
        cells[c[1]] = val;
      }
      rows[+r[1]] = cells;
    }
    return rows;
  }
  const str = v => v == null ? '' : String(v).trim();
  const num = v => v == null || v === '' || isNaN(+v) ? null : +v;
  // дата партии: прежний скрипт таблицы писал полночь по поясу скрипта, и в ячейке оказывалось не 00:00. 18:00 и позже —
  // это полночь следующего дня из пояса восточнее (так 04.05.2006 становилось 03.05.2006 23:00), раньше 18:00 — тот же
  // день из пояса западнее (Москва — 02:00, Лос-Анджелес — 12:00–13:00)
  const serialToISO = s => { if (!num(s)) return ''; return new Date(Math.floor(+s - 25569 + 0.25) * 864e5).toISOString().slice(0, 10); };
  const isoToSerial = d => { const [y, m, dd] = d.split('-').map(Number); return Date.UTC(y, m - 1, dd) / 864e5 + 25569; };

  const SET_ROWS = { isuzuM3: 5, isuzuKg: 6, depotName: 7, depotLat: 8, depotLon: 9, unloadMin: 10, dayStart: 11, speed: 12, aMaxStops: 13, maxPlaces: 14, bSmallM3: 15, bcMaxStops: 16, cM3: 17, cKg: 18, cTrucks: 19, roadK: 20, gazelBase: 43, gazelHeavy: 44, gazelHeavyKg: 45, gazelPtIn: 46, gazelPtOut: 47, laboBase: 48, laboPt: 49, laboM3: 50, laboKg: 51, baseIncludesPts: 52, kamazBase: 53, kamazPt: 54, laboBaseIncludesPts: 55, kamazBaseIncludesPts: 56, gazelM3: 57, gazelKg: 58, bTolM3: 59, bTolKg: 60,
    changanM3: 61, changanKg: 62, changanBase: 63, changanPt: 64, changanBaseIncludesPts: 65, gazelCount: 66, laboCount: 67, changanCount: 68, tripsPerVehicle: 69, freeOutM3: 70, densityMin: 71, densityMax: 72, fillPct: 73 };
  const SH = { ship: 'Yuborishlar', cli: 'Mijozlar', wh: 'Qoshimcha omborlar', set: 'Sozlamalar', ring: 'Halqa zonasi', notes: 'O‘zgarishlar' };

  function hyperlinksOf(z, path, xml) {
    const relPath = path.replace(/([^/]+)$/, '_rels/$1.rels'), rels = txt(z, relPath), rmap = {}, out = {};
    for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) { const id = m[0].match(/Id="([^"]+)"/), t = m[0].match(/Target="([^"]+)"/); if (id && t) rmap[id[1]] = dec(t[1]); }
    for (const m of xml.matchAll(/<hyperlink\b[^>]*>/g)) { const ref = m[0].match(/ref="([A-Z]+\d+)"/), id = m[0].match(/r:id="([^"]+)"/); if (ref && id && rmap[id[1]]) out[ref[1]] = rmap[id[1]]; }
    return out;
  }

  async function parse(ab) {
    const z = await readZip(ab), P = sheetPaths(z), ss = shared(z);
    if (!P[SH.ship] || !P[SH.cli]) throw new Error('В файле нет листов «Yuborishlar» и «Mijozlar»');
    const R = k => P[k] ? readSheet(txt(z, P[k]), ss) : {};
    return { tpl: z, data: buildData(R, hyperlinksOf(z, P[SH.cli], txt(z, P[SH.cli]))) };
  }
  const colName = i => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = (i - m - 1) / 26; } return s; };
  function fromSheets(j) {
    const sh = j.sheets || {};
    if (!sh[SH.ship] || !sh[SH.cli]) throw new Error('В таблице нет листов «Yuborishlar» и «Mijozlar»');
    const R = name => { const o = {}; (sh[name] || []).forEach((row, i) => { const c = {}; row.forEach((v, ci) => { if (v === '' || v == null) return; c[colName(ci)] = v; }); o[i + 1] = c; }); return o; };
    return buildData(R, j.links || {});
  }
  function buildData(R, links) {
    const Ys = R(SH.ship), Ms = R(SH.cli), Ws = R(SH.wh), Ss = R(SH.set), Hs = R(SH.ring), Ns = R(SH.notes);
    const clients = Object.keys(Ms).map(Number).filter(r => r >= 5 && str(Ms[r].A)).sort((a, b) => a - b).map(r => { const c = Ms[r]; return {
      bl: str(c.A), brand: str(c.B), name: str(c.C), tel1: str(c.D), tel2: str(c.E), receiver: str(c.F), receiverTel: str(c.G), district: str(c.H) || 'Aniqlanmagan', address: str(c.I),
      link: links['J' + r] || '', lat: num(c.K), lon: num(c.L), note: str(c.O), manualZone: str(c.X), marks: str(c.Y), locs: str(c.Z) }; });
    // Date in column A: a real date (Excel/Sheets serial number) or typed by hand as text — 31.08.2026,
    // 31.08.26, 31/08/2026, 2026-08-31, 31.08 — or turned into a number by a sheet in another locale
    // ("04.09" → 4.09). Such dates are read as DD.MM (year from the other rows) and reported in `textDates`;
    // rows with a BL but no readable date are reported in `skipped` instead of being dropped silently.
    const serialOk = v => typeof v === 'number' && v > 20000 && v < 80000;
    const years = Object.keys(Ys).map(Number).filter(r => r >= 5 && serialOk(Ys[r].A)).map(r => +serialToISO(Ys[r].A).slice(0, 4));
    const yearGuess = years.length ? Math.max(...years) : new Date().getFullYear();
    const iso = (y, m, d) => { const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? t.toISOString().slice(0, 10) : ''; };
    const dateOf = v => {
      if (serialOk(v)) return serialToISO(v);
      if (typeof v === 'number' && v > 0 && v < 1000) { const d = Math.floor(v), mo = Math.round((v - d) * 100); return iso(yearGuess, mo, d); }
      const t = str(v); let m;
      if (/^\d{5}(\.\d+)?$/.test(t) && serialOk(+t)) return serialToISO(+t);
      if ((m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return iso(+m[1], +m[2], +m[3]);
      if ((m = t.match(/^(\d{1,2})[.\/,-](\d{1,2})(?:[.\/,-](\d{2}|\d{4}))?\.?$/))) return iso(m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : yearGuess, +m[2], +m[1]);
      return '';
    };
    const shipRows = Object.keys(Ys).map(Number).filter(r => r >= 5 && str(Ys[r].C)).sort((a, b) => a - b);
    const skipped = shipRows.filter(r => !dateOf(Ys[r].A)).map(r => ({ row: r, bl: str(Ys[r].C), value: str(Ys[r].A) }));
    const textDates = shipRows.filter(r => !serialOk(Ys[r].A) && dateOf(Ys[r].A)).map(r => ({ row: r, bl: str(Ys[r].C), value: str(Ys[r].A), date: dateOf(Ys[r].A) }));
    const shipments = shipRows.filter(r => dateOf(Ys[r].A)).map(r => { const c = Ys[r]; return {
      id: 's' + r, date: dateOf(c.A), bl: str(c.C), cbm: num(c.J) || 0, kg: num(c.K) || 0, places: num(c.L) || 0, truck: str(c.M) || 'Belgilanmagan', route: num(c.N), status: str(c.O) || 'Rejada', note: str(c.P), loc: str(c.V), boxes: str(c.W) }; });   // W — коробки по пакинг-листу (версия 33)
    const warehouses = Object.keys(Ws).map(Number).filter(r => r >= 5 && str(Ws[r].A)).sort((a, b) => a - b).map(r => { const c = Ws[r]; return { id: 'w' + r, bl: str(c.A), brand: str(c.B), name: str(c.C), lat: num(c.D), lon: num(c.E) }; });
    const ring = Object.keys(Hs).map(Number).filter(r => r >= 11).sort((a, b) => a - b).map(r => [num(Hs[r].B), num(Hs[r].C)]).filter(p => p[0] && p[1]);
    const settings = {};
    for (const [k, r] of Object.entries(SET_ROWS)) { const v = (Ss[r] || {}).B; settings[k] = k === 'depotName' ? str(v) : num(v); }
    settings.ringBuffer = num((Hs[4] || {}).B) ?? 1;
    // older workbooks have no rows 55–69 yet: Labo/Kamaz/Changan charge every point (0), Gazel holds 19 m³ / 4 000 kg,
    // plan B may load a Gazel 5 m³ / 500 kg above that; the fleet — 9 Gazel, 1 Changan (9 m³ / 2 000 kg), 1 Labo,
    // up to 2 trips a day each; outside the ring a point under 1 m³ is not paid by the company;
    // manifest import warns about cargo lighter than 40 or heavier than 800 kg/m³ (rows 71–72).
    // `defaults` lists what was filled in, so it can be written back.
    const DEF = { laboBaseIncludesPts: 0, kamazBaseIncludesPts: 0, gazelM3: 19, gazelKg: 4000, bTolM3: 5, bTolKg: 500,
      changanM3: 9, changanKg: 2000, changanBaseIncludesPts: 0, gazelCount: 9, laboCount: 1, changanCount: 1, tripsPerVehicle: 2, freeOutM3: 1, densityMin: 40, densityMax: 800, fillPct: 88 };
    const defaults = Object.keys(DEF).filter(k => settings[k] == null);
    defaults.forEach(k => { settings[k] = DEF[k]; });
    const col = (c, a, b) => { const o = []; for (let r = a; r <= b; r++) if (Ss[r] && str(Ss[r][c])) o.push(str(Ss[r][c])); return o; };
    // госномера машин — D24:D39 напротив названия машины в C
    const plates = {}; for (let r = 24; r <= 39; r++) if (Ss[r] && str(Ss[r].C) && str(Ss[r].D)) plates[str(Ss[r].C)] = str(Ss[r].D);
    // карточка машины — E:J (скрипт версии 21): в ремонте, марка, год, объём м³, грузоподъёмность кг, примечание;
    // K:M (версия 31) — кузов: длина, ширина, высота, м
    const bodyOn = str((Ss[23] || {}).K) === 'Uzunlik, m';   // K:M — кузов, только под своим заголовком (иначе там что-то своё)
    const fleet = {}, dim = v => { const x = bodyOn ? num(v) : null; return x > 0 ? x : null; };
    for (let r = 24; r <= 39; r++) {
      const c = Ss[r], t = c && str(c.C); if (!t) continue;
      const x = { repair: /ta.?mirda|ремонт/i.test(str(c.E)), model: str(c.F), year: num(c.G), m3: num(c.H), kg: num(c.I), note: str(c.J), l: dim(c.K), w: dim(c.L), h: dim(c.M) };
      if (x.repair || x.model || x.year != null || x.m3 != null || x.kg != null || x.note || x.l != null || x.w != null || x.h != null) fleet[t] = x;
    }
    const lists = { districts: col('A', 24, 39), statuses: col('B', 24, 29), trucks: col('C', 24, 39), plates, fleet };
    const notes = []; let sec = null;
    Object.keys(Ns).map(Number).sort((a, b) => a - b).forEach(r => {
      const c = Ns[r];
      if (c.A && !c.B && /^\d+\./.test(str(c.A))) { sec = { title: str(c.A), items: [] }; notes.push(sec); }
      else if (sec && c.B && c.C && str(c.A) !== '№') sec.items.push({ n: str(c.A), what: str(c.B), why: str(c.C) });
    });
    return { clients, shipments, warehouses, ring, settings, lists, skipped, textDates, defaults, notes: notes.filter(s => /E’TIBOR|TEKSHIRING/i.test(s.title)) };
  }

  // ---------- writing into the original workbook ----------
  const colIdx = c => { let n = 0; for (const ch of c) n = n * 26 + ch.charCodeAt(0) - 64; return n; };
  function splitSheet(xml) {
    const a = xml.indexOf('<sheetData'), aEnd = xml.indexOf('>', a) + 1, b = xml.indexOf('</sheetData>');
    const rows = new Map();
    for (const m of xml.slice(aEnd, b).matchAll(/<row\b([^>]*?)(\/>|>([\s\S]*?)<\/row>)/g)) {
      const r = +m[1].match(/\br="(\d+)"/)[1], cells = new Map();
      if (m[3]) for (const c of m[3].matchAll(/<c r="([A-Z]+)\d+"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)) cells.set(c[1], c[0]);
      rows.set(r, { attrs: m[1], cells });
    }
    return { head: xml.slice(0, aEnd), rows, tail: xml.slice(b) };
  }
  function joinSheet(s) {
    const rs = [...s.rows.keys()].sort((a, b) => a - b).map(r => { const row = s.rows.get(r); const cs = [...row.cells.keys()].sort((a, b) => colIdx(a) - colIdx(b)).map(k => row.cells.get(k)).join(''); return '<row' + row.attrs + '>' + cs + '</row>'; });
    return s.head + rs.join('') + s.tail;
  }
  const sOf = x => { const m = x && x.match(/\bs="(\d+)"/); return m ? m[1] : null; };
  const fOf = x => { const m = x && x.match(/<f\b[^>]*?(?:\/>|>[\s\S]*?<\/f>)/); return m ? m[0] : null; };
  const shiftF = (f, from, to) => from === to ? f : f.replace(new RegExp('(?<![A-Za-z_0-9.])(\\$?[A-Z]{1,3})' + from + '(?![0-9])', 'g'), (m, c) => c + to);
  function vCell(ref, s, val) {
    const sa = s != null ? ' s="' + s + '"' : '';
    if (val == null || val === '') return '<c r="' + ref + '"' + sa + '/>';
    if (typeof val === 'number' && isFinite(val)) return '<c r="' + ref + '"' + sa + ' t="n"><v>' + val + '</v></c>';
    return '<c r="' + ref + '"' + sa + ' t="inlineStr"><is><t xml:space="preserve">' + esc(val) + '</t></is></c>';
  }
  function fCell(ref, s, f, cached) {
    const sa = s != null ? ' s="' + s + '"' : '';
    if (typeof cached === 'number' && isFinite(cached)) return '<c r="' + ref + '"' + sa + ' t="n">' + f + '<v>' + cached + '</v></c>';
    return '<c r="' + ref + '"' + sa + ' t="str">' + f + '<v>' + esc(cached == null ? '' : cached) + '</v></c>';
  }
  function patchTable(xml, o) {
    const s = splitSheet(xml);
    let oldLast = o.firstRow - 1;
    for (const [r, row] of s.rows) { const k = row.cells.get(o.keyCol); if (r >= o.firstRow && k && /<v>|<is>/.test(k) && !/<v><\/v>/.test(k)) oldLast = Math.max(oldLast, r); }
    const tpl = (s.rows.get(o.tplRow) || { cells: new Map() }).cells;
    const blankRow = oldLast + 1, blank = (s.rows.get(blankRow) || { cells: new Map() }).cells;
    const last = Math.max(oldLast, o.firstRow + o.items.length - 1);
    for (let r = o.firstRow; r <= last; r++) {
      const row = s.rows.get(r) || { attrs: ' r="' + r + '"', cells: new Map() }, it = o.items[r - o.firstRow];
      for (const [col, fn] of Object.entries(o.inputs)) row.cells.set(col, vCell(col + r, sOf(row.cells.get(col)) ?? sOf(tpl.get(col)), it ? fn(it) : null));
      for (const [col, fn] of Object.entries(o.formulas)) {
        const st = sOf(row.cells.get(col)) ?? sOf(tpl.get(col));
        if (it) { const f = fOf(tpl.get(col)); row.cells.set(col, f ? fCell(col + r, st, shiftF(f, o.tplRow, r), fn(it)) : vCell(col + r, st, fn(it))); }
        else { const bf = fOf(blank.get(col)); row.cells.set(col, bf ? fCell(col + r, st, shiftF(bf, blankRow, r), '') : vCell(col + r, st, null)); }
      }
      s.rows.set(r, row);
    }
    const newLast = Math.max(o.firstRow + o.items.length - 1, o.firstRow);
    s.tail = s.tail.replace(/(<autoFilter ref="[A-Z]+\d+:[A-Z]+)\d+"/, '$1' + (newLast) + '"');
    return { xml: joinSheet(s), last: newLast };
  }
  function setCells(xml, cells) {
    const s = splitSheet(xml);
    for (const [ref, val] of Object.entries(cells)) {
      const [, col, r] = ref.match(/([A-Z]+)(\d+)/), row = s.rows.get(+r) || { attrs: ' r="' + r + '"', cells: new Map() };
      row.cells.set(col, vCell(ref, sOf(row.cells.get(col)), val)); s.rows.set(+r, row);
    }
    return joinSheet(s);
  }

  async function write(tpl, data) {
    const E = window.LogiEngine, S = data.settings, ring = data.ring;
    const z = { files: Object.assign({}, tpl.files), order: tpl.order.slice() };
    const P = sheetPaths(z);
    const cmap = {}, zones = {}; data.clients.forEach(c => { cmap[c.bl] = c; zones[c.bl] = E.zoneOf(c, ring, S.ringBuffer); });
    const agg = {}; data.shipments.forEach(s => { const a = agg[s.bl] = agg[s.bl] || { n: 0, last: 0, cbm: 0, kg: 0 }; a.n++; a.cbm += +s.cbm || 0; a.kg += +s.kg || 0; a.last = Math.max(a.last, isoToSerial(s.date)); });
    const zt = z0 => z0 === 'in' ? 'Ichida' : z0 === 'out' ? 'TASHQARIDA' : '';
    const coord = (la, lo) => la == null || lo == null ? '' : la.toFixed(6) + ', ' + lo.toFixed(6);
    const C = bl => cmap[bl] || {};
    // trips for R–U
    const trips = {}, share = {};
    data.shipments.forEach(s => { const k = E.vehicleKind(s.truck); if (!k || s.route == null || E.NO_PRICE.includes(s.status)) return; const key = s.date + '|' + s.truck + '|' + s.route; (trips[key] = trips[key] || { k, items: [] }).items.push(s); });
    Object.values(trips).forEach(t => { const st = t.items.map(s => ({ bl: s.bl, cbm: s.cbm, kg: s.kg, zone: (zones[s.bl] || {}).zone, lat: C(s.bl).lat, lon: C(s.bl).lon })), p = E.priceTrip(st, t.k, S), c = E.costSplit(st, p, S);   // доля — как на сайте: с доплатой клиента — его доплата
      t.items.forEach((s, i) => { share[s.id] = { label: p.label, pts: p.points, total: p.total, part: c ? c.share[i] : p.perStop[i] }; }); });

    const ship = patchTable(txt(z, P[SH.ship]), { firstRow: 5, tplRow: 6, keyCol: 'C', items: data.shipments,
      inputs: { A: s => isoToSerial(s.date), C: s => s.bl, J: s => +s.cbm || null, K: s => +s.kg || null, L: s => +s.places || null, M: s => s.truck, N: s => s.route ?? null, O: s => s.status, P: s => s.note, V: s => s.loc || null, W: s => s.boxes || null },
      formulas: { B: s => s.date.slice(8, 10) + '.' + s.date.slice(5, 7), D: s => C(s.bl).brand || '', E: s => C(s.bl).name || '', F: s => C(s.bl).district || '', G: s => C(s.bl).receiver || '', H: s => C(s.bl).receiverTel || '', I: s => coord(C(s.bl).lat, C(s.bl).lon), Q: s => zt((zones[s.bl] || {}).zone),
        R: s => share[s.id] ? share[s.id].label : '', S: s => share[s.id] ? share[s.id].pts : '', T: s => share[s.id] ? (share[s.id].total ?? 'narx yo‘q') : '', U: s => share[s.id] && share[s.id].part != null ? Math.round(share[s.id].part) : '' } });
    const shipHead = { ...(data.shipments.some(s => s.loc) ? { V4: 'Yetkazish joyi' } : {}), ...(data.shipments.some(s => s.boxes) ? { W4: 'Qutilar, sm' } : {}) };   // подписи столбцов V (куда везти) и W (коробки)
    put(z, P[SH.ship], Object.keys(shipHead).length ? setCells(ship.xml, shipHead) : ship.xml);

    const cli = patchTable(txt(z, P[SH.cli]), { firstRow: 5, tplRow: 5, keyCol: 'A', items: data.clients,
      inputs: { A: c => c.bl, B: c => c.brand, C: c => c.name, D: c => c.tel1, E: c => c.tel2, F: c => c.receiver, G: c => c.receiverTel, H: c => c.district, I: c => c.address, J: c => c.link ? 'Xaritada ochish' : '', K: c => c.lat, L: c => c.lon, O: c => c.note, X: c => c.manualZone, Y: c => c.marks, Z: c => c.locs || null },
      formulas: { M: c => coord(c.lat, c.lon), N: c => c.lat != null ? 'Yandex xarita' : '', P: c => (agg[c.bl] || {}).n || 0, Q: c => (agg[c.bl] || {}).last || '', R: c => (agg[c.bl] || {}).cbm || 0, S: c => (agg[c.bl] || {}).kg || 0,
        T: c => ([c.brand, c.name, c.tel1, c.receiver, c.address].filter(Boolean).length + (c.lat != null ? 1 : 0)) / 6,
        U: c => zt((zones[c.bl] || {}).zone), V: c => { const q = zones[c.bl] || {}; return q.dist != null ? q.dist : ''; }, W: c => { const q = zones[c.bl] || {}; return !q.zone ? '' : q.manual ? 'Qo‘lda belgilangan' : q.border ? 'Chegarada — tekshiring' : 'Aniq'; } } });
    // hyperlinks in J
    let cx = data.clients.some(c => c.locs) ? setCells(cli.xml, { Z4: 'Lokatsiyalar' }) : cli.xml;   // точки клиента — подпись столбца Z
    const relPath = P[SH.cli].replace(/([^/]+)$/, '_rels/$1.rels');
    let rels = txt(z, relPath) || '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
    rels = rels.replace(/<Relationship\b[^>]*Type="[^"]*\/hyperlink"[^>]*\/>/g, '');
    let hl = '', add = '';
    data.clients.forEach((c, i) => { if (!c.link) return; const id = 'rIdHL' + (i + 1); hl += '<hyperlink ref="J' + (5 + i) + '" r:id="' + id + '" display="Xaritada ochish"/>'; add += '<Relationship Id="' + id + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="' + esc(c.link) + '" TargetMode="External"/>'; });
    const block = hl ? '<hyperlinks>' + hl + '</hyperlinks>' : '';
    if (/<hyperlinks>[\s\S]*?<\/hyperlinks>/.test(cx)) cx = cx.replace(/<hyperlinks>[\s\S]*?<\/hyperlinks>/, block);
    else if (block) cx = cx.replace(/(<printOptions|<pageMargins|<pageSetup|<drawing|<\/worksheet>)/, block + '$1');
    rels = rels.replace('</Relationships>', add + '</Relationships>');
    put(z, P[SH.cli], cx); put(z, relPath, rels);
    if (!z.order.includes(relPath)) z.order.push(relPath);

    if (P[SH.wh]) {
      const wh = patchTable(txt(z, P[SH.wh]), { firstRow: 5, tplRow: 5, keyCol: 'A', items: data.warehouses || [],
        inputs: { A: w => w.bl, B: w => w.brand || (C(w.bl).brand || ''), C: w => w.name, D: w => w.lat, E: w => w.lon },
        formulas: { F: w => coord(w.lat, w.lon), G: w => w.lat != null ? zt(E.zoneOf({ lat: w.lat, lon: w.lon }, ring, S.ringBuffer).zone) : '', H: w => w.lat != null ? E.distToRing([w.lat, w.lon], ring) : '' } });
      put(z, P[SH.wh], wh.xml);
    }
    if (P[SH.set]) {
      const cells = {}; for (const [k, r] of Object.entries(SET_ROWS)) cells['B' + r] = S[k] ?? null;
      // машины и их госномера: C24:C39, D24:D39
      const L = data.lists || {}, tr = L.trucks || [], pl = L.plates || {}, fl = L.fleet || {};
      if (tr.length) { cells.D23 = 'Davlat raqami'; for (let i = 0; i < 16; i++) { cells['C' + (24 + i)] = tr[i] ?? null; cells['D' + (24 + i)] = (tr[i] && pl[tr[i]]) || null; } }
      // карточка машины — E:J (как в скрипте таблицы версии 21)
      if (tr.some(t => fl[t])) {
        ['Holati', 'Marka', 'Yili', 'Hajm, m³', 'Yuk, kg', 'Izoh'].forEach((h, j) => { cells['EFGHIJ'[j] + 23] = h; });
        for (let i = 0; i < 16; i++) { const x = (tr[i] && fl[tr[i]]) || {};
          [x.repair ? 'ta’mirda' : null, x.model || null, x.year ?? null, x.m3 ?? null, x.kg ?? null, x.note || null].forEach((v, j) => { cells['EFGHIJ'[j] + (24 + i)] = v; }); }
        // кузов — K:M (версия 31), если он есть хоть у одной машины
        if (tr.some(t => fl[t] && (fl[t].l || fl[t].w || fl[t].h))) {
          ['Uzunlik, m', 'Kenglik, m', 'Balandlik, m'].forEach((h, j) => { cells['KLM'[j] + 23] = h; });
          for (let i = 0; i < 16; i++) { const x = (tr[i] && fl[tr[i]]) || {}; [x.l, x.w, x.h].forEach((v, j) => { cells['KLM'[j] + (24 + i)] = v || null; }); }
        }
      }
      put(z, P[SH.set], setCells(txt(z, P[SH.set]), cells));
    }
    if (P[SH.ring]) {
      const rc = { B4: S.ringBuffer ?? 1 };
      for (let i = 0; i < 210; i++) { const p = ring[i]; rc['B' + (11 + i)] = p ? p[0] : null; rc['C' + (11 + i)] = p ? p[1] : null; }
      put(z, P[SH.ring], setCells(txt(z, P[SH.ring]), rc));
    }

    let wb = txt(z, 'xl/workbook.xml');
    wb = wb.replace(/(Yuborishlar!\$A\$4:\$[A-Z]+\$)\d+/, '$1' + ship.last).replace(/(Mijozlar!\$A\$4:\$[A-Z]+\$)\d+/, '$1' + cli.last);
    if (/<calcPr\b/.test(wb)) { if (!/fullCalcOnLoad/.test(wb)) wb = wb.replace('<calcPr', '<calcPr fullCalcOnLoad="1"'); }
    else wb = wb.replace('</workbook>', '<calcPr fullCalcOnLoad="1"/></workbook>');
    put(z, 'xl/workbook.xml', wb);
    if (z.files['xl/calcChain.xml']) { delete z.files['xl/calcChain.xml']; z.order = z.order.filter(n => n !== 'xl/calcChain.xml'); put(z, '[Content_Types].xml', txt(z, '[Content_Types].xml').replace(/<Override[^>]*calcChain[^>]*\/>/, '')); put(z, 'xl/_rels/workbook.xml.rels', txt(z, 'xl/_rels/workbook.xml.rels').replace(/<Relationship[^>]*calcChain[^>]*\/>/, '')); }
    return writeZip(z.files, z.order);
  }

  // ---------- любая книга (импорт манифестов): все листы как есть ----------
  // Листы по порядку книги (и скрытые), значения ячеек (у формул — сохранённый результат), объединённые ячейки,
  // даты — по формату ячейки (числа с форматом даты становятся строкой YYYY-MM-DD, с временем — YYYY-MM-DD HH:MM).
  function dateStyles(z) {
    const x = txt(z, 'xl/styles.xml'); if (!x) return new Set();
    const custom = {}; for (const m of x.matchAll(/<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) custom[+m[1]] = dec(m[2]);
    const isDate = id => (id >= 14 && id <= 22) || (id >= 27 && id <= 36) || (id >= 45 && id <= 47) || (id >= 50 && id <= 58) ||
      (custom[id] != null && /[dmyhs]/i.test(custom[id].replace(/"[^"]*"|\[[^\]]*\]|\\./g, '')) && !/^(general|@)$/i.test(custom[id]));
    const xfs = (x.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/) || [])[1] || '', out = new Set();
    [...xfs.matchAll(/<xf\b[^>]*?>|<xf\b[^>]*?\/>/g)].forEach((m, i) => { const id = (m[0].match(/numFmtId="(\d+)"/) || [])[1]; if (id != null && isDate(+id)) out.add(i); });
    return out;
  }
  function serialDate(v) {
    const ms = Math.round((v - 25569) * 864e5), d = new Date(ms), iso = d.toISOString();
    return Math.abs(v - Math.round(v)) < 1e-9 ? iso.slice(0, 10) : iso.slice(0, 10) + ' ' + iso.slice(11, 16);
  }
  async function readGrid(ab) {
    if (window.XlsBiff && window.XlsBiff.isOle(ab)) return window.XlsBiff.readGrid(ab);   // старый .xls (Excel 97–2003)
    const z = await readZip(ab), ss = shared(z), dates = dateStyles(z);
    const wb = txt(z, 'xl/workbook.xml'), rels = txt(z, 'xl/_rels/workbook.xml.rels'), rmap = {};
    if (!wb) throw new Error('Это не книга Excel (.xlsx или .xls)');
    for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) { const id = m[0].match(/Id="([^"]+)"/), t = m[0].match(/Target="([^"]+)"/); if (id && t) rmap[id[1]] = t[1]; }
    const out = [];
    for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
      const nm = m[0].match(/name="([^"]+)"/), id = m[0].match(/r:id="([^"]+)"/); if (!nm || !id || !rmap[id[1]]) continue;
      const path = rmap[id[1]].startsWith('/') ? rmap[id[1]].slice(1) : 'xl/' + rmap[id[1]].replace(/^\.\//, ''), xml = txt(z, path);
      if (!xml) continue;
      const rows = {};
      for (const r of xml.matchAll(/<row\b[^>]*?\br="(\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
        if (!r[2]) continue; const cells = {};
        for (const c of r[2].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
          const body = c[3] || '', t = (c[2].match(/\bt="(\w+)"/) || [])[1], st = +((c[2].match(/\bs="(\d+)"/) || [])[1] || 0), v = body.match(/<v>([\s\S]*?)<\/v>/);
          let val = null;
          if (t === 'inlineStr') val = dec([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join(''));
          else if (!v) continue;
          else if (t === 's') val = ss[+v[1]];
          else if (t === 'str' || t === 'e') val = dec(v[1]);
          else if (t === 'b') val = v[1] === '1';
          else val = dates.has(st) && +v[1] > 0 ? serialDate(+v[1]) : +v[1];
          if (val === '' || val == null) continue;
          cells[c[1]] = typeof val === 'string' ? val.trim() : val;
        }
        rows[+r[1]] = cells;
      }
      const merges = [...xml.matchAll(/<mergeCell\b[^>]*ref="([A-Z]+\d+:[A-Z]+\d+)"/g)].map(x => x[1]);
      out.push({ name: dec(nm[1]), hidden: /state="(hidden|veryHidden)"/.test(m[0]), rows, merges });
    }
    return out;
  }

  function b64ToBuf(b64) { const s = atob(b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u.buffer; }
  window.XlsxIO = { parse, write, readZip, readGrid, b64ToBuf, fromSheets, SET_ROWS };
})();
