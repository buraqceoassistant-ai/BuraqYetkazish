// Обезличенный манифест по шаблону консолидатора (как у YARGXOL): дата в B2, маршрут в B3, заголовки в строке 4,
// строки груза, в конце TOTAL. Маркировки и цифры вымышленные. Файл .xlsx собирается в памяти —
// реальные манифесты и любые .xlsx в репозиторий не кладём (см. .gitignore).
import { deflateRawSync, crc32 } from 'node:zlib';

// строки: [маркировка, места, м³, кг]; одна маркировка на нескольких строках — объединённая ячейка A
export const ROWS = [
  ['BL-901', 12, 1.234, 250.5],
  ['BL-902', 40, 6.8, 1320],
  ['BL-903', 8, 0.456, 88.2],       // меньше 1 м³ — «не платим»
  ['BL-903', 5, 0.3, 61],           // та же маркировка второй строкой (объединённая ячейка A7:A8)
  ['ALFA', 30, 4.5, 900],           // словесная маркировка — бренд клиента
  ['CBETA', 20, 2.75, 510],         // латиница, похожая на кириллицу: «СВЕТА» → SVETA
  ['BL-00', 3, 0.21, 40],           // груз без известного владельца
  ['BL-905', 60, 9.9, 2450.75],
  ['BL-905', 15, 2.1, 520.25],
  ['BL-905', 7, 1.05, 260]          // BL-905 — три строки (объединённая ячейка A12:A14)
];
export const DATE = '2026-09-20', ROUTE = 'HORGOS TO TASHKENT - YIWU TESTCO';
export const TOTAL = ROWS.reduce((a, r) => ({ places: a.places + r[1], cbm: +(a.cbm + r[2]).toFixed(3), kg: +(a.kg + r[3]).toFixed(2) }), { places: 0, cbm: 0, kg: 0 });
// справочник клиентов для сопоставления (вымышленный)
export const CLIENTS = [
  { bl: 'BL-901', brand: 'NUR MEBEL', name: 'Akmal' }, { bl: 'BL-902', brand: '', name: 'Dilshod' }, { bl: 'BL-903', brand: 'ORIENT', name: 'Bobur' },
  { bl: 'BL-904', brand: 'ALFA', name: 'Sardor' }, { bl: 'BL-906', brand: 'SVETA', name: 'Rustam' }, { bl: 'BL-905', brand: 'ZAMON', name: 'Jasur' },
  { bl: 'BL-907', brand: 'OMEGA', name: 'Nodir', marks: 'OMG, ОМЕГА' }
];

const serial = iso => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d) / 864e5 + 25569; };
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const str = (ref, v) => `<c r="${ref}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`;
const num = (ref, v, s) => `<c r="${ref}"${s ? ` s="${s}"` : ''}><v>${v}</v></c>`;

// opts: { totalOff: изменить TOTAL (ошибка консолидатора), rows: свои строки, noTotal: без строки итога }
export function manifestSheetXml(opts = {}) {
  const rows = opts.rows || ROWS, t = rows.reduce((a, r) => ({ places: a.places + r[1], cbm: +(a.cbm + r[2]).toFixed(3), kg: +(a.kg + r[3]).toFixed(2) }), { places: 0, cbm: 0, kg: 0 });
  const off = opts.totalOff || {};
  const x = [];
  x.push(`<row r="1">${str('A1', 'CARGO MANIFEST')}</row>`);
  x.push(`<row r="2">${str('A2', 'DATE')}${num('B2', serial(DATE), 1)}</row>`);
  x.push(`<row r="3">${str('A3', 'ROUTE')}${str('B3', ROUTE)}</row>`);
  x.push(`<row r="4">${str('A4', 'SHIPPING MARK')}${str('B4', 'CTN/件数')}${str('C4', 'T/CBM')}${str('D4', 'KG')}</row>`);
  const merges = [];
  let r = 5, i = 0;
  while (i < rows.length) {
    let j = i; while (j + 1 < rows.length && rows[j + 1][0] === rows[i][0]) j++;
    if (j > i) merges.push(`A${r}:A${r + j - i}`);
    for (let k = i; k <= j; k++, r++) x.push(`<row r="${r}">${k === i ? str('A' + r, rows[k][0]) : ''}${num('B' + r, rows[k][1])}${num('C' + r, rows[k][2])}${num('D' + r, rows[k][3])}</row>`);
    i = j + 1;
  }
  if (!opts.noTotal) x.push(`<row r="${r}">${str('A' + r, 'TOTAL')}<c r="B${r}"><f>SUM(B5:B${r - 1})</f><v>${t.places + (off.places || 0)}</v></c><c r="C${r}"><f>SUM(C5:C${r - 1})</f><v>${+(t.cbm + (off.cbm || 0)).toFixed(3)}</v></c><c r="D${r}"><f>SUM(D5:D${r - 1})</f><v>${+(t.kg + (off.kg || 0)).toFixed(2)}</v></c></row>`);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${x.join('')}</sheetData>${merges.length ? `<mergeCells count="${merges.length}">${merges.map(m => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : ''}</worksheet>`;
}

export function manifestXlsx(opts = {}) { return bookXlsx("Manifest", manifestSheetXml(opts)); }

// книга с одним листом (sheetXml — разметка листа) — для своих образцов в тестах
export function bookXlsx(sheetName, sheetXml) {
  const files = {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="' + esc(sheetName) + '" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    'xl/styles.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="165" formatCode="0.000"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/><xf numFmtId="165" applyNumberFormat="1"/></cellXfs></styleSheet>',
    'xl/worksheets/sheet1.xml': sheetXml
  };
  return zip(files);
}

// ZIP (deflate) для .xlsx
export function zip(files) {
  const parts = [], central = []; let off = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, 'utf8'), comp = deflateRawSync(data), nb = Buffer.from(name, 'utf8'), crc = crc32(data);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8); h.writeUInt32LE(crc, 14); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(nb.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10); c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(nb.length, 28); c.writeUInt32LE(off, 42);
    parts.push(h, nb, comp); central.push(c, nb); off += 30 + nb.length + comp.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  const buf = Buffer.concat([...parts, cd, end]);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}
