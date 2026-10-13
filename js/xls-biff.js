/* Старый Excel (.xls, BIFF8 — Excel 97–2003): чтение книги в ту же сетку, что XlsxIO.readGrid даёт для .xlsx:
   [{ name, hidden, rows: { строка: { A: значение } }, merges: ['A5:A6'] }]. Значения — числа, строки, логические;
   числа с форматом даты — строкой YYYY-MM-DD (с временем — YYYY-MM-DD HH:MM), у формул — сохранённый результат.
   Файл — контейнер OLE2 (сектора, FAT, каталог, мини-поток) с потоком «Workbook»; внутри — записи BIFF
   (BOUNDSHEET, SST с CONTINUE, LABELSST, NUMBER, RK, MULRK, FORMULA + STRING, LABEL, BOOLERR, MERGEDCELLS, FORMAT, XF).
   BIFF5 («Book», Excel 5/95) читается в пределах тех же записей. Подключается из XlsxIO.readGrid по сигнатуре файла. */
(function () {
  'use strict';
  const SIG = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
  const isOle = ab => { const u = new Uint8Array(ab, 0, Math.min(8, ab.byteLength)); return u.length === 8 && SIG.every((b, i) => u[i] === b); };

  // ---------- OLE2: поток по имени ----------
  function oleStream(ab, names) {
    const u = new Uint8Array(ab), dv = new DataView(ab);
    const secSz = 1 << dv.getUint16(0x1E, true), miniSz = 1 << dv.getUint16(0x20, true), nFat = dv.getUint32(0x2C, true);
    const dirStart = dv.getUint32(0x30, true), cutoff = dv.getUint32(0x38, true), miniStart = dv.getUint32(0x3C, true), difatStart = dv.getUint32(0x44, true);
    const END = 0xFFFFFFFE, FREE = 0xFFFFFFFF, perSec = secSz / 4, secOff = s => (s + 1) * secSz;
    if (secOff(0) > u.length) throw new Error('Файл .xls повреждён');
    // DIFAT: 109 ссылок в заголовке + цепочка DIFAT-секторов
    const fatSecs = [];
    for (let i = 0; i < 109 && fatSecs.length < nFat; i++) { const s = dv.getUint32(0x4C + i * 4, true); if (s < FREE - 1) fatSecs.push(s); }
    for (let d = difatStart, guard = 0; d < END && fatSecs.length < nFat && guard < 1e4; guard++) {
      const base = secOff(d); if (base + secSz > u.length) break;
      for (let i = 0; i < perSec - 1 && fatSecs.length < nFat; i++) { const s = dv.getUint32(base + i * 4, true); if (s < FREE - 1) fatSecs.push(s); }
      d = dv.getUint32(base + (perSec - 1) * 4, true);
    }
    const fat = new Uint32Array(fatSecs.length * perSec);
    fatSecs.forEach((s, k) => { const base = secOff(s); for (let i = 0; i < perSec; i++) fat[k * perSec + i] = base + i * 4 + 4 <= u.length ? dv.getUint32(base + i * 4, true) : END; });
    const chain = (start, table) => { const out = []; for (let s = start, g = 0; s < END && g < 1e6; g++) { out.push(s); s = s < table.length ? table[s] : END; } return out; };
    const readChain = (start, size, table, szOne, offOf) => {
      const out = new Uint8Array(size); let pos = 0;
      for (const s of chain(start, table)) { if (pos >= size) break; const off = offOf(s), n = Math.min(szOne, size - pos); if (off + n > u.length) break; out.set(u.subarray(off, off + n), pos); pos += n; }
      return out;
    };
    // каталог: записи по 128 байт
    const dir = readChain(dirStart, chain(dirStart, fat).length * secSz, fat, secSz, secOff), ddv = new DataView(dir.buffer, dir.byteOffset, dir.byteLength), entries = [];
    for (let o = 0; o + 128 <= dir.length; o += 128) {
      const nlen = ddv.getUint16(o + 0x40, true), type = dir[o + 0x42]; if (!type || nlen < 2) continue;
      let name = ''; for (let i = 0; i < nlen - 2; i += 2) name += String.fromCharCode(ddv.getUint16(o + i, true));
      entries.push({ name, type, start: ddv.getUint32(o + 0x74, true), size: ddv.getUint32(o + 0x78, true) });
    }
    const root = entries.find(e => e.type === 5), want = names.map(n => n.toLowerCase());
    const e = entries.find(x => x.type === 2 && want.includes(x.name.toLowerCase()));
    if (!e) throw new Error('В файле .xls нет книги Excel (потока Workbook)');
    if (e.size >= cutoff || !root) return readChain(e.start, e.size, fat, secSz, secOff);
    // маленький поток лежит в мини-потоке корня
    const mini = readChain(root.start, root.size, fat, secSz, secOff), mfSecs = chain(miniStart, fat), mfat = new Uint32Array(mfSecs.length * perSec);
    mfSecs.forEach((s, k) => { const base = secOff(s); for (let i = 0; i < perSec; i++) mfat[k * perSec + i] = base + i * 4 + 4 <= u.length ? dv.getUint32(base + i * 4, true) : END; });
    const out = new Uint8Array(e.size); let pos = 0;
    for (const s of chain(e.start, mfat)) { if (pos >= e.size) break; const off = s * miniSz, n = Math.min(miniSz, e.size - pos); if (off + n > mini.length) break; out.set(mini.subarray(off, off + n), pos); pos += n; }
    return out;
  }

  // ---------- BIFF ----------
  const colName = c => { let s = ''; c += 1; while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = (c - 1 - m) / 26; } return s; };
  const rk = v => { const f = (v & 1) !== 0, int = (v & 2) !== 0; let x; if (int) x = v >> 2; else { const b = new DataView(new ArrayBuffer(8)); b.setUint32(4, (v & 0xFFFFFFFC) >>> 0, true); b.setUint32(0, 0, true); x = b.getFloat64(0, true); } return f ? x / 100 : x; };
  const serialDate = v => { const ms = Math.round((v - 25569) * 864e5), d = new Date(ms), iso = d.toISOString(); return Math.abs(v - Math.round(v)) < 1e-9 ? iso.slice(0, 10) : iso.slice(0, 10) + ' ' + iso.slice(11, 16); };
  const builtinDate = id => (id >= 14 && id <= 22) || (id >= 27 && id <= 36) || (id >= 45 && id <= 47) || (id >= 50 && id <= 58);
  const customDate = f => /[dmyhs]/i.test(String(f).replace(/"[^"]*"|\[[^\]]*\]|\\./g, '')) && !/^(general|@)$/i.test(String(f));

  // курсор по записи с продолжениями (CONTINUE): строки SST переходят из записи в запись
  function Cursor(recs, i) { this.recs = recs; this.i = i; this.p = 0; }
  Cursor.prototype.more = function () { while (this.p >= this.recs[this.i].len) { if (this.i + 1 < this.recs.length && this.recs[this.i + 1].id === 0x3C) { this.i++; this.p = 0; return true; } return false; } return true; };
  Cursor.prototype.u8 = function () { this.more(); return this.recs[this.i].dv.getUint8(this.p++); };
  Cursor.prototype.u16 = function () { return this.u8() | (this.u8() << 8); };
  Cursor.prototype.u32 = function () { return (this.u16() | (this.u16() << 16)) >>> 0; };
  Cursor.prototype.skip = function (n) { while (n > 0) { if (!this.more()) return; const k = Math.min(n, this.recs[this.i].len - this.p); this.p += k; n -= k; } };
  // юникод-строка BIFF8: длина (8 или 16 бит), флаги (бит 0 — 16-битные символы, бит 2 — доп. данные, бит 3 — форматирование),
  // символы (на границе CONTINUE — новый байт флагов), затем пропуск форматирования и доп. данных
  Cursor.prototype.str = function (len16) {
    const n = len16 ? this.u16() : this.u8(); let flags = this.u8();
    const rich = flags & 8 ? this.u16() : 0, ext = flags & 4 ? this.u32() : 0;
    let s = '';
    for (let k = 0; k < n; k++) {
      if (this.p >= this.recs[this.i].len) { if (!this.more()) break; flags = this.u8(); }
      s += String.fromCharCode(flags & 1 ? this.u16() : this.u8());
    }
    this.skip(rich * 4 + ext);
    return s;
  };
  // строка BIFF5 (байтовая, длина 8 или 16 бит)
  Cursor.prototype.str5 = function (len16) { const n = len16 ? this.u16() : this.u8(); let s = ''; for (let k = 0; k < n; k++) s += String.fromCharCode(this.u8()); return s; };

  function records(stream) {
    const dv = new DataView(stream.buffer, stream.byteOffset, stream.byteLength), out = [];
    for (let p = 0; p + 4 <= stream.length;) {
      const id = dv.getUint16(p, true), len = dv.getUint16(p + 2, true), off = p + 4;
      if (off + len > stream.length) break;
      out.push({ id, len, off, dv: new DataView(stream.buffer, stream.byteOffset + off, len) });
      p = off + len;
    }
    return out;
  }

  function readGrid(ab) {
    if (!isOle(ab)) throw new Error('Это не файл Excel 97–2003 (.xls)');
    const stream = oleStream(ab, ['Workbook', 'Book']), recs = records(stream);
    const byOff = new Map(recs.map((r, i) => [r.off - 4, i]));
    // глобальная часть: версия, листы, общие строки, форматы, XF
    let biff8 = true, i0 = 0; const sheets = [], sst = [], fmt = {}, xfs = [];
    if (recs.length && recs[0].id === 0x809) biff8 = recs[0].len >= 2 ? recs[0].dv.getUint16(0, true) >= 0x600 : true;
    for (let i = i0; i < recs.length; i++) {
      const r = recs[i], c = new Cursor(recs, i);
      if (r.id === 0x0A) { i0 = i + 1; break; }   // EOF глобальной части
      if (r.id === 0x85) { const pos = c.u32(), vis = c.u8(); c.u8(); sheets.push({ pos, hidden: vis !== 0, name: biff8 ? c.str(false) : c.str5(false) }); }
      else if (r.id === 0xFC) { c.u32(); const n = c.u32(); for (let k = 0; k < n; k++) { if (!c.more()) break; sst.push(c.str(true)); } }
      else if (r.id === 0x41E) { const id = c.u16(); fmt[id] = biff8 ? c.str(true) : c.str5(false); }
      else if (r.id === 0x1E && !biff8) { const id = c.u16(); fmt[id] = c.str5(false); }
      else if (r.id === 0xE0) { c.u16(); xfs.push(c.u16()); }
    }
    const isDate = xf => { const id = xfs[xf]; return id != null && (builtinDate(id) || (fmt[id] != null && customDate(fmt[id]))); };
    const out = [];
    sheets.forEach(sh => {
      const start = byOff.get(sh.pos); if (start == null) return;
      const rows = {}, merges = [];
      const put = (row, col, v) => { if (v === '' || v == null) return; (rows[row + 1] = rows[row + 1] || {})[colName(col)] = typeof v === 'string' ? v.trim() : v; };
      const numv = (row, col, xf, v) => put(row, col, isDate(xf) && v > 0 ? serialDate(v) : v);
      let pend = null;   // формула со строковым результатом — значение в следующей записи STRING
      for (let i = start + 1; i < recs.length; i++) {
        const r = recs[i], c = new Cursor(recs, i);
        if (r.id === 0x0A) break;
        if (r.id === 0xFD) { const row = c.u16(), col = c.u16(); c.u16(); const k = c.u32(); put(row, col, sst[k]); }
        else if (r.id === 0x203) { const row = c.u16(), col = c.u16(), xf = c.u16(); numv(row, col, xf, r.dv.getFloat64(6, true)); }
        else if (r.id === 0x27E) { const row = c.u16(), col = c.u16(), xf = c.u16(); numv(row, col, xf, rk(c.u32())); }
        else if (r.id === 0xBD) { const row = c.u16(), col0 = c.u16(), n = (r.len - 6) / 6; for (let k = 0; k < n; k++) { const xf = c.u16(); numv(row, col0 + k, xf, rk(c.u32())); } }
        else if (r.id === 0x06) {
          const row = c.u16(), col = c.u16(), xf = c.u16();
          if (r.dv.getUint16(12, true) === 0xFFFF) { const t = r.dv.getUint8(6); if (t === 0) pend = { row, col }; else if (t === 1) put(row, col, r.dv.getUint8(8) === 1); else if (t === 2) put(row, col, '#ERR'); }
          else numv(row, col, xf, r.dv.getFloat64(6, true));
        }
        else if (r.id === 0x207) { if (pend) { put(pend.row, pend.col, biff8 ? c.str(true) : c.str5(true)); pend = null; } }
        else if (r.id === 0x204) { const row = c.u16(), col = c.u16(); c.u16(); put(row, col, biff8 ? c.str(true) : c.str5(true)); }
        else if (r.id === 0xD6) { const row = c.u16(), col = c.u16(); c.u16(); put(row, col, c.str5(true)); }
        else if (r.id === 0x205) { const row = c.u16(), col = c.u16(); c.u16(); const v = c.u8(), err = c.u8(); put(row, col, err ? '#ERR' : v === 1); }
        else if (r.id === 0xE5) { const n = c.u16(); for (let k = 0; k < n; k++) { const r1 = c.u16(), r2 = c.u16(), c1 = c.u16(), c2 = c.u16(); merges.push(colName(c1) + (r1 + 1) + ':' + colName(c2) + (r2 + 1)); } }
      }
      out.push({ name: sh.name, hidden: sh.hidden, rows, merges });
    });
    if (!out.length) throw new Error('В файле .xls нет листов');
    return out;
  }

  window.XlsBiff = { isOle, readGrid };
})();
