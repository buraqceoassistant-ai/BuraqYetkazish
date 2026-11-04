// Обезличенная база клиентов по образцу CRM отдела продаж: шапка в строке 1 (в A1 — случайный «BL-17»), «Name» —
// тип груза, «Column 9» — безымянный столбец с телефонами, паспорта, зарезервированные коды без данных, повтор строки,
// два разных клиента под одним BL, телефон неверной длины, строка без BL. Имена, номера и паспорта — вымышленные.
// Книга .xlsx собирается в памяти — реальные базы клиентов в репозиторий не кладём.
import { bookXlsx } from './manifest.mjs';

export const HEAD = ['BL-17', 'Sales Manager', 'Shipping mark', 'Name', 'Customer Name', 'Brand name/Company name', 'Business type',
  'Shop/Office address', 'Column 9', 'Phone number', 'PASSPORT', 'RASM', 'Remark', 'Cargo location', 'Added date'];
// строки 2…14: A №, B менеджер, C BL, D тип, E клиент, F бренд, G вид деятельности, H адрес, I и J телефоны, K паспорт, L фото, M примечание, N место груза, O дата
export const ROWS = [
  [1, 'Aziza', 'BL-1', 'Сборный', 'Akmal Testov', 'NUR TEST', 'Mebel', 'Chilonzor 5', 901112233, '+998 93 444 55 66', 'AA0000001', '', '', '', '2026-01-10'],
  [2, 'Aziza', 'BL-2', 'Целый', 'Dilshod', '-', 'Kiyim', '-', 998901234567, '', 'AB0000002', '', '', '', ''],
  [3, '', 'BL-3', '', '', '', '', '', '', '', '', '', '', '', ''],
  [4, '', 'BL-4', '', '', '', '', '', '', '', '', '', '', '', ''],
  [5, 'Bekzod', 'BL-05', 'Сборный', 'Sardor', 'ZAMON TEST', '', '', '90 765 43 21', '', '-', '', '', '', ''],
  [6, 'Bekzod', 'BL-6', 'Сборный', 'Nodir', 'OMEGA TEST', '', '', 99890123, '', '', '', '', 'Yiwu', ''],
  [7, 'Aziza', 'BL-7', 'Целый', 'Rustam A', '', '', '', 901110001, '', '', '', '', '', ''],
  [8, 'Aziza', 'BL-7', 'Целый', 'Bobur B', '', '', '', 901110002, '', '', '', '', '', ''],
  [9, 'Bekzod', 'BL-8', 'Сборный', 'Jasur', 'ORIENT T', '', '', 901110003, '', '', '', '', '', ''],
  [10, 'Bekzod', 'BL-8', 'Сборный', 'Jasur', 'ORIENT T', '', '', 901110003, '', '', '', '', '', ''],
  [11, 'Aziza', '', 'Сборный', 'Bez Koda', '', '', '', 901110004, '', '', '', '', '', ''],
  [12, 'Bekzod', 'BL-9', 'Сборный', '', '', 'Oziq-ovqat', '', '', '', '', '', '', '', ''],
  [13, 'Aziza', 'BL-10', 'Сборный', 'Kamola', '', '', '', '', '', 'AC0000003', '', 998901110005, '', '']
];
export const PASSPORTS = ['AA0000001', 'AB0000002', 'AC0000003'];
// справочник сайта до загрузки (вымышленный)
export const SITE = [
  { bl: 'BL-1', brand: 'NUR TEST', name: '', tel1: '+998901112233', tel2: '', receiver: '', receiverTel: '', district: 'Chilonzor', address: '', lat: 41.28, lon: 69.2, note: 'старое', manualZone: '', link: '', marks: '', locs: '' },
  { bl: 'BL-5', brand: 'ZAMON', name: 'Sardor', tel1: '+998901112299', tel2: '', receiver: '', receiverTel: '', district: 'Aniqlanmagan', address: '', lat: null, lon: null, note: '', manualZone: '', link: '', marks: '', locs: '' },
  { bl: 'BL-08', brand: 'ORIENT T', name: 'Jasur', tel1: '+998901110003', tel2: '', receiver: '', receiverTel: '', district: 'Yunusobod', address: '', lat: null, lon: null, note: 'x', manualZone: '', link: '', marks: '', locs: '' }
];

const COLS = 'ABCDEFGHIJKLMNO';
// сетка как у XlsxIO.readGrid: пустые ячейки не пишутся
export function baseGrid(rows = ROWS) {
  const out = { 1: {} };
  HEAD.forEach((h, j) => { out[1][COLS[j]] = h; });
  rows.forEach((r, i) => { const o = out[i + 2] = {}; r.forEach((v, j) => { if (v !== '' && v != null) o[COLS[j]] = typeof v === 'string' ? v.trim() : v; }); });
  return [{ name: 'ACB(LTLLCL)', hidden: false, rows: out, merges: [] }];
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export function baseXlsx(rows = ROWS) {
  const cell = (ref, v) => typeof v === 'number' ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`;
  const line = (r, vals) => `<row r="${r}">${vals.map((v, j) => v === '' || v == null ? '' : cell(COLS[j] + r, v)).join('')}</row>`;
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${[line(1, HEAD), ...rows.map((r, i) => line(i + 2, r))].join('')}</sheetData></worksheet>`;
  return bookXlsx('ACB(LTLLCL)', xml);
}
