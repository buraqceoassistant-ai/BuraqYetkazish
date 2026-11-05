// Заглушки сервисов Google Apps Script для тестов tools/gs/Code.gs в Node (без сети и без Google).
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createHmac } from 'node:crypto';

// байты как в Apps Script: знаковые (−128…127)
const sbytes = buf => Array.from(buf, b => (b > 127 ? b - 256 : b));
const ubuf = x => typeof x === 'string' ? Buffer.from(x, 'utf8') : Buffer.from(x.map(b => (b + 256) % 256));
const blob = (bytes, type = '', name = '') => { const b = { bytes, type, name, getBytes: () => bytes, getContentType: () => b.type, getName: () => b.name, setName(n) { b.name = n; return b; } }; return b; };

class Range {
  constructor(sh, r, c, nr = 1, nc = 1) { Object.assign(this, { sh, r, c, nr, nc }); }
  cell(i, j) { const row = this.sh.rows[this.r - 1 + i] || []; return row[this.c - 1 + j] ?? ''; }
  getValues() { return Array.from({ length: this.nr }, (_, i) => Array.from({ length: this.nc }, (_, j) => this.cell(i, j))); }
  getValue() { return this.cell(0, 0); }
  // как в Google: проверка данных смотрит каждую ячейку блока, и одна плохая отклоняет всю запись
  setValues(v) { v.forEach((row, i) => row.forEach((x, j) => this.check(this.r + i, this.c + j, x))); v.forEach((row, i) => row.forEach((x, j) => this.sh.set(this.r + i, this.c + j, x))); this.sh.writes = (this.sh.writes || 0) + 1; return this; }
  check(r, c, x) { const no = this.sh.reject && this.sh.reject(r, c, x); if (no) throw new Error(no); const d = this.sh.dvAt(r, c);
    if (d && !d.allowInvalid && x !== '' && x != null && !d.values.includes(String(x))) throw new Error('В ячейке ' + String.fromCharCode(64 + c) + r + ' нарушены правила проверки данных. Укажите одно из следующих значений: ' + d.values.join(', ') + '.'); }
  // проверка данных «отклонять ввод»: sh.reject(r, c, x) → текст ошибки Google или ничего
  setValue(x) { this.check(this.r, this.c, x); this.sh.set(this.r, this.c, x); this.sh.writes = (this.sh.writes || 0) + 1; return this; }
  // проверка данных: правило столбца (sh.dv[c] = { values, allowInvalid }) на строках с 5-й
  getDataValidations() { return Array.from({ length: this.nr }, (_, i) => Array.from({ length: this.nc }, (_, j) => { const d = this.sh.dvAt(this.r + i, this.c + j); return d ? dvRule(d) : null; })); }
  setDataValidations(v) { v.forEach((row, i) => row.forEach((x, j) => { if (this.r + i >= 5) { if (x) this.sh.dv[this.c + j] = { values: x.d.values, allowInvalid: x.d.allowInvalid }; else delete this.sh.dv[this.c + j]; } })); this.sh.dvSets = (this.sh.dvSets || 0) + 1; return this; }
  clearContent() { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.sh.set(this.r + i, this.c + j, ''); return this; }
  setNumberFormat() { return this; }
  setFontWeight() { return this; }
  getFormula() { return (this.sh.formulas || {})[this.r + ':' + this.c] || ''; }
  getFormulas() { return Array.from({ length: this.nr }, (_, i) => Array.from({ length: this.nc }, (_, j) => (this.sh.formulas || {})[(this.r + i) + ':' + (this.c + j)] || '')); }
  copyTo() { return this; }
  getRichTextValues() { return Array.from({ length: this.nr }, () => [null]); }
  setRichTextValue(v) { this.sh.set(this.r, this.c, v.text); return this; }
  setDataValidation() { return this; }
}
const dvRule = d => ({ d, getAllowInvalid: () => d.allowInvalid, copy: () => { const n = { values: d.values.slice(), allowInvalid: d.allowInvalid }, b = { setAllowInvalid: x => { n.allowInvalid = !!x; return b; }, build: () => dvRule(n) }; return b; } });
class Sheet {
  constructor(name, rows = [], maxCols = 26) { this.name = name; this.rows = rows.map(r => r.slice()); this.maxCols = maxCols; this.frozen = 0; this.dv = {}; }
  dvAt(r, c) { return r >= 5 ? this.dv[c] || null : null; }
  getMaxRows() { return Math.max(this.rows.length, 1000); }
  set(r, c, x) { if (c > this.maxCols) throw new Error('Координаты вне листа: столбец ' + c + ' > ' + this.maxCols); while (this.rows.length < r) this.rows.push([]); const row = this.rows[r - 1]; while (row.length < c) row.push(''); row[c - 1] = x; }
  getRange(r, c, nr, nc) { if (c + (nc || 1) - 1 > this.maxCols) throw new Error('Координаты вне листа'); return new Range(this, r, c, nr, nc); }
  getLastRow() { for (let i = this.rows.length; i > 0; i--) if (this.rows[i - 1].some(v => v !== '' && v != null)) return i; return 0; }
  getMaxColumns() { return this.maxCols; }
  getName() { return this.name; }
  insertColumnsAfter(after, n) { this.maxCols += n; }
  appendRow(row) { this.set(this.getLastRow() + 1, 1, row[0]); const r = this.getLastRow(); row.forEach((x, j) => this.set(r, j + 1, x)); }
  setFrozenRows(n) { this.frozen = n; }
  deleteRow(r) { this.rows.splice(r - 1, 1); }
}

// Пароль скрипта и секрет редактора обязательны (версия 19). Если тест их не задал, заглушка задаёт свои (TEST_TOKEN,
// TEST_EDITOR), а post/get подставляют их в запрос: пароль — если он пустой или не указан, секрет — если поля editor нет.
// Проверки «без пароля / без секрета» — через auth: false (свойств нет) и rawPost/rawGet (без подстановки).
export const TEST_TOKEN = 'pw-test', TEST_EDITOR = 'ed-test';
const norm = k => String(k).trim().toUpperCase().replace(/[\s-]+/g, '_');
export function loadScript({ props = {}, sheets = {}, fetch, now, auth = true } = {}) {
  const has = name => Object.keys(props).some(k => norm(k) === name && String(props[k]).trim());
  if (auth && !has('TOKEN')) props.TOKEN = TEST_TOKEN;
  if (auth && !has('EDITOR_TOKEN')) props.EDITOR_TOKEN = TEST_EDITOR;
  const pv = name => { const k = Object.keys(props).find(x => norm(x) === name && String(props[x]).trim()); return k ? String(props[k]).trim() : ''; };
  // «сейчас» для скрипта: new Date() без аргументов — now.value (если задано)
  class MockDate extends Date { constructor(...a) { if (!a.length && now && now.value) super(now.value.getTime()); else super(...a); } static now() { return now && now.value ? now.value.getTime() : Date.now(); } static [Symbol.hasInstance](x) { return x instanceof Date; } }
  const book = { name: 'Тест', sheets: Object.fromEntries(Object.entries(sheets).map(([n, s]) => [n, Object.assign(new Sheet(n, s.rows || [], s.maxCols || 26), s.dv ? { dv: { ...s.dv } } : {})])) };
  const calls = [], logs = [], cache = new Map(), triggers = []; let uuid = 0;
  // Google Диск: папки и файлы в памяти
  const files = [], folders = {};
  const folder = (name, parent) => { const id = 'f' + (Object.keys(folders).length + 1), f = { id, name, parent, getId: () => id,
    createFolder: n => folder(n, id), getFoldersByName: n => { const l = Object.values(folders).filter(x => x.parent === id && x.name === n); return { hasNext: () => l.length > 0, next: () => l.shift() }; },
    createFile: b => { const fid = 'file' + (files.length + 1); files.push({ id: fid, folder: id, name: b.name, bytes: b.bytes }); return { getUrl: () => 'https://drive.google.com/file/d/' + fid, getId: () => fid }; } }; folders[id] = f; return f; };
  const drive = { createFolder: n => folder(n, null), getFolderById: id => { if (!folders[id]) throw new Error('нет папки'); return folders[id]; } };
  const ctx = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] ?? null, getProperties: () => ({ ...props }), setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: k => { delete props[k]; } }) },
    UrlFetchApp: { fetch: (url, opts = {}) => { const req = typeof opts.payload === 'string' ? JSON.parse(opts.payload) : opts.payload || null; /* объект — multipart (фото) */ calls.push({ url, opts, req }); const r = fetch(req, opts, calls.length, url); if (r instanceof Error) throw r;
      return { getResponseCode: () => r.status ?? 200, getContentText: () => typeof r.body === 'string' ? r.body : JSON.stringify(r.body), getAllHeaders: () => r.headers || {},
        getBlob: () => { const b = { name: '', bytes: r.body, setName(n) { b.name = n; return b; } }; return b; } }; } },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({ getName: () => book.name, getSpreadsheetTimeZone: () => 'Asia/Tashkent', getSheetByName: n => book.sheets[n] || null,
        insertSheet: n => (book.sheets[n] = new Sheet(n)) }),
      flush() {}, newRichTextValue: () => { const o = { text: '', setText(t) { o.text = t; return o; }, setLinkUrl() { return o; }, build() { return o; } }; return o; },
      newDataValidation: () => { const o = { requireValueInRange: () => o, setAllowInvalid: () => o, build: () => o }; return o; }, CopyPasteType: { PASTE_FORMULA: 1 }
    },
    ContentService: { createTextOutput: s => ({ text: s, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    // время «сейчас» в тестах можно задать: now.value = new Date(…); часовой пояс таблицы — Ташкент (UTC+5)
    Utilities: { sleep: ms => { (book.slept = book.slept || []).push(ms); }, formatDate: (d, tz, f) => { const t = new Date(d.getTime() + 5 * 3600e3).toISOString(); return f.replace('yyyy', t.slice(0, 4)).replace('MM', t.slice(5, 7)).replace('dd', t.slice(8, 10)).replace('HH', t.slice(11, 13)).replace('mm', t.slice(14, 16)).replace('ss', t.slice(17, 19)); },
      // разбор даты в поясе таблицы (в заглушке — Ташкент, UTC+5): «2006-05-04» → полночь 04.05.2006 по Ташкенту
      parseDate: (str, tz, f) => { const m = String(str).match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/); if (!m) throw new Error('Unparseable date: ' + str); return new Date(Date.UTC(+m[1], m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)) - 5 * 3600e3); },
      getUuid: () => 'uuid-' + (++uuid) + '-0000-0000',
      computeHmacSha256Signature: (value, key) => sbytes(createHmac('sha256', ubuf(key)).update(ubuf(value)).digest()),
      base64Decode: s => sbytes(Buffer.from(String(s), 'base64')),
      newBlob: (data, type, name) => blob(typeof data === 'string' ? sbytes(Buffer.from(data, 'utf8')) : data, type, name) },
    CacheService: { getScriptCache: () => ({ get: k => cache.get(k) ?? null, put: (k, v) => cache.set(k, v), remove: k => cache.delete(k) }) },
    HtmlService: { createHtmlOutput: s => ({ html: s }) },
    DriveApp: drive,
    console: { error: m => logs.push('error: ' + m), log: m => logs.push(m) },
    Logger: { log: m => logs.push(m) },
    Session: { getScriptTimeZone: () => props.__scriptTz || 'Asia/Tashkent' },
    ScriptApp: { AuthMode: { FULL: 'FULL' }, requireAllScopes: m => logs.push('requireAllScopes ' + m), getProjectTriggers: () => triggers.map(t => ({ t, getHandlerFunction: () => t.fn })),
      deleteTrigger: w => { const i = triggers.indexOf(w.t); if (i >= 0) triggers.splice(i, 1); },
      newTrigger: fn => { const t = { fn }, b = { timeBased: () => b, atHour: h => { t.hour = h; return b; }, everyDays: n => { t.every = n; return b; }, everyMinutes: n => { t.minutes = n; return b; }, inTimezone: z => { t.tz = z; return b; }, create: () => { triggers.push(t); return t; } }; return b; } },
    Maps: {}, Date: MockDate, JSON, Math, String, Number, Object, Array, isNaN, RegExp, Error
  };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL('../tools/gs/Code.gs', import.meta.url), 'utf8') + '\n' + readFileSync(new URL('../tools/gs/Bot.gs', import.meta.url), 'utf8'), ctx);
  const rawPost = body => JSON.parse(ctx.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).text);
  const rawGet = (params = {}) => JSON.parse(ctx.doGet({ parameter: params }).text);
  const fill = b => ({ ...b, token: b.token === undefined || b.token === '' ? pv('TOKEN') : b.token, ...(b.editor === undefined && (b.ai || b.tg) ? { editor: pv('EDITOR_TOKEN') } : {}) });
  const post = body => rawPost(typeof body === 'string' ? body : fill(body));
  const get = (params = {}) => rawGet({ ...params, token: params.token === undefined || params.token === '' ? pv('TOKEN') : params.token });
  // обновление от Telegram: doPost с ?tg=<секрет>
  const tgPost = (update, secret = props.TG_SECRET) => ctx.doPost({ parameter: { tg: secret }, postData: { contents: JSON.stringify(update) } });
  return { ctx, book, calls, logs, post, get, rawPost, rawGet, tgPost, files, props, cache, triggers };
}
