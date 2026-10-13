// Код Apps Script (tools/gs/Code.gs) на заглушках: ИИ-посредник, секрет редактора, «ИИ-журнал»,
// маркировки клиентов (Mijozlar Y) и новые строки «Sozlamalar». Запуск: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScript } from './gs-mock.mjs';

const toolReply = (input, usage = { input_tokens: 120, output_tokens: 30 }) => ({ body: { content: [{ type: 'tool_use', name: 'ping', input }], stop_reason: 'tool_use', usage, model: 'claude-sonnet-5' } });
const book = () => ({
  Yuborishlar: { rows: [[], [], [], ['Sana']], maxCols: 21 },
  Mijozlar: { rows: [[], [], [], ['BL kodi']], maxCols: 24 },
  Sozlamalar: { rows: [] },
  'Halqa zonasi': { rows: [] }
});
const ping = (extra = {}) => ({ token: '', login: 'buraq', ai: { action: 'ping', meta: { file: '' } }, ...extra });
const schema = { name: 'manifest', description: 'разбор', input_schema: { type: 'object', properties: { rows: { type: 'array', items: { type: 'object', properties: { m: { type: 'string' } }, required: ['m'], additionalProperties: false } } }, required: ['rows'], additionalProperties: false } };
const call = (extra = {}) => ({ token: '', login: 'buraq', ai: { action: 'call', system: 'данные', content: [{ type: 'text', text: 'S1 R5 | A:BL-1' }], schema, max_tokens: 3000, effort: 'low', meta: { file: 'm.xlsx', draft: 'd1', part: '1/1' } }, ...extra });

test('проверка связи: ключ из свойств, модель по умолчанию, инструмент strict и tool_choice на него, запись в журнал', () => {
  const s = loadScript({ props: { ANTHROPIC_API_KEY: 'sk-test' }, sheets: book(), fetch: () => toolReply({ reply: 'готов' }) });
  const r = s.post(ping());
  assert.equal(r.ok, true); assert.equal(r.v, 33); assert.equal(r.model, 'claude-sonnet-5'); assert.deepEqual(r.result, { reply: 'готов' });
  assert.equal(r.mode, 'tool'); assert.equal(r.editorSet, true); assert.deepEqual(r.usage, { in: 120, cache: 0, out: 30 });
  const c = s.calls[0];
  assert.equal(c.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(c.opts.headers['x-api-key'], 'sk-test'); assert.equal(c.opts.headers['anthropic-version'], '2023-06-01');
  assert.equal(c.req.model, 'claude-sonnet-5'); assert.equal(c.req.tools[0].strict, true); assert.deepEqual(c.req.tool_choice, { type: 'tool', name: 'ping' });
  const log = s.book.sheets['ИИ-журнал'];
  assert.equal(log.rows[0][0], 'Время'); assert.equal(log.rows[1][1], 'buraq'); assert.equal(log.rows[1][4], 'проверка связи'); assert.equal(log.rows[1][11], 'ok');
  assert.equal(log.rows[1][7], 120); assert.equal(log.rows[1][9], 30); assert.ok(log.rows[1][10] >= 0);
});

test('нет ключа — понятная ошибка, в API ничего не уходит', () => {
  const s = loadScript({ sheets: book(), fetch: () => { throw new Error('не должно вызываться'); } });
  const r = s.post(ping());
  assert.equal(r.code, 'nokey'); assert.match(r.error, /ANTHROPIC_API_KEY/); assert.equal(s.calls.length, 0);
});

test('нет ключа — в ошибке имена свойств, которые видит скрипт (без значений)', () => {
  const s = loadScript({ props: { EDITOR_TOKEN: 'ed-secret', AI_MODEL: 'claude-sonnet-5' }, sheets: book(), fetch: () => { throw new Error('не должно вызываться'); } });
  const r = s.post(ping({ editor: 'ed-secret' }));
  assert.equal(r.code, 'nokey'); assert.match(r.error, /Сохранить свойства скрипта/); assert.match(r.error, /видит свойства: EDITOR_TOKEN, AI_MODEL/);
  assert.doesNotMatch(r.error, /ed-secret/);
  const bare = loadScript({ sheets: book() }).post(ping()).error;   // TOKEN и EDITOR_TOKEN теперь есть всегда (версия 19)
  assert.match(bare, /видит свойства: TOKEN, EDITOR_TOKEN\./); assert.doesNotMatch(bare, /pw-test|ed-test/);
});

test('имя свойства в другом регистре или с пробелами и ключ под другим именем — находятся', () => {
  for (const props of [{ 'anthropic_api_key ': ' sk-ant-1\n' }, { 'ANTHROPIC API KEY': 'sk-ant-1' }, { CLAUDE_KEY: 'sk-ant-1' }]) {
    const s = loadScript({ props, sheets: book(), fetch: () => toolReply({ reply: 'готов' }) });
    const r = s.post(ping());
    assert.equal(r.ok, true, JSON.stringify(props)); assert.equal(s.calls[0].opts.headers['x-api-key'], 'sk-ant-1');
  }
  const s = loadScript({ props: { ANTHROPIC_API_KEY: 'k', ' editor_token': 'ed-secret\n', ai_model: ' claude-opus-5-5 ' }, sheets: book(), fetch: () => toolReply({ reply: 'готов' }) });
  assert.equal(s.post(ping({ editor: '' })).code, 'editor');
  const r = s.post(ping({ editor: 'ed-secret' }));
  assert.equal(r.editorSet, true); assert.equal(r.model, 'claude-opus-5-5');
});

test('нет разрешения на внешние запросы — подсказка про authorize; authorize() делает внешний запрос', () => {
  const denied = new Error('У вас нет разрешения на вызов функции "UrlFetchApp.fetch". Требуемые разрешения: https://www.googleapis.com/auth/script.external_request');
  const s = loadScript({ props: { ANTHROPIC_API_KEY: 'sk-ant-1' }, sheets: book(), fetch: () => denied });
  const r = s.post(ping());
  assert.equal(r.ok, undefined); assert.match(r.error, /функцию authorize → ▶ Выполнить/); assert.match(r.error, /Выбрать все/);
  const a = loadScript({ sheets: book(), fetch: () => ({ status: 401, body: {} }) });
  a.ctx.authorize();
  assert.equal(a.logs[0], 'requireAllScopes FULL');
  assert.equal(a.calls[0].url, 'https://api.anthropic.com/v1/models'); assert.match(a.logs[1], /Разрешения выданы.*401/);
});

test('секрет редактора: без него и с неверным — отказ; с верным — вызов', () => {
  const s = loadScript({ props: { ANTHROPIC_API_KEY: 'k', EDITOR_TOKEN: 'ed-secret' }, sheets: book(), fetch: () => toolReply({ reply: 'готов' }) });
  assert.equal(s.post(ping({ editor: '' })).code, 'editor');
  assert.equal(s.post(ping({ editor: 'чужой' })).code, 'editor');
  assert.equal(s.calls.length, 0);
  const r = s.post(ping({ editor: 'ed-secret' }));
  assert.equal(r.ok, true); assert.equal(r.editorSet, true);
});

test('пароль скрипта из свойства TOKEN проверяется и для ИИ, и для выгрузки', () => {
  const s = loadScript({ props: { TOKEN: 'pw', ANTHROPIC_API_KEY: 'k' }, sheets: book(), fetch: () => toolReply({ reply: 'готов' }) });
  assert.equal(s.post(ping({ token: 'x' })).error, 'Неверный пароль');
  assert.equal(s.get({ token: 'x' }).error, 'Неверный пароль');
  assert.equal(s.post(ping({ token: 'pw' })).ok, true);
  assert.equal(s.get({ token: 'pw' }).v, 33);
});

test('Opus 5.5 и Fable 5.1 не принимают принудительный tool_choice — схема уходит через output_config.format', () => {
  for (const model of ['claude-opus-5-5', 'claude-fable-5-1']) {
    const s = loadScript({ props: { ANTHROPIC_API_KEY: 'k', AI_MODEL: model }, sheets: book(), fetch: () => ({ body: { content: [{ type: 'text', text: '{"rows":[{"m":"BL-1"}]}' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } } }) });
    const r = s.post(call());
    const q = s.calls[0].req;
    assert.equal(r.ok, true, model); assert.equal(r.mode, 'json'); assert.deepEqual(r.result, { rows: [{ m: 'BL-1' }] });
    assert.equal(q.tools, undefined); assert.equal(q.tool_choice, undefined);
    assert.deepEqual(q.output_config.format, { type: 'json_schema', schema: schema.input_schema }); assert.equal(q.output_config.effort, 'low');
  }
});

test('если API отвечает 400 на tool_choice — повтор через output_config.format', () => {
  const s = loadScript({ props: { ANTHROPIC_API_KEY: 'k', AI_MODEL: 'claude-new-model' }, sheets: book(), fetch: (req, o, n) => n === 1
    ? { status: 400, body: { type: 'error', error: { type: 'invalid_request_error', message: 'tool_choice type "tool" is not supported for this model' } } }
    : { body: { content: [{ type: 'text', text: '{"rows":[]}' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } } } });
  const r = s.post(call());
  assert.equal(r.ok, true); assert.equal(r.mode, 'json'); assert.equal(s.calls.length, 2);
  assert.ok(s.calls[0].req.tool_choice); assert.ok(!s.calls[1].req.tool_choice);
});

test('Haiku 4.5 — без effort; max_tokens ограничен', () => {
  const s = loadScript({ props: { ANTHROPIC_API_KEY: 'k', AI_MODEL: 'claude-haiku-4-5' }, sheets: book(), fetch: () => ({ body: { content: [{ type: 'tool_use', name: 'manifest', input: { rows: [] } }], stop_reason: 'tool_use', usage: {} } }) });
  const b = call(); b.ai.max_tokens = 999999;
  assert.equal(s.post(b).ok, true);
  assert.equal(s.calls[0].req.output_config, undefined); assert.equal(s.calls[0].req.max_tokens, 16000);
});

test('ошибки API и тайм-аут — понятные сообщения, строка «ошибка» в журнале', () => {
  const cases = [
    [{ status: 401, body: { error: { message: 'invalid x-api-key' } } }, /ANTHROPIC_API_KEY/, 'http401'],
    [{ status: 404, body: { error: { message: 'model: claude-x' } } }, /AI_MODEL/, 'http404'],
    [{ status: 400, body: { error: { message: 'Your credit balance is too low' } } }, /закончились деньги/, 'http400'],
    [{ status: 529, body: { error: { message: 'Overloaded' } } }, /перегружен/, 'http529'],
    [new Error('Timeout: https://api.anthropic.com/v1/messages'), /не ответил вовремя/, 'timeout'],
    [{ body: { content: [], stop_reason: 'max_tokens', usage: { output_tokens: 3000 } } }, /не поместился/, 'truncated']
  ];
  for (const [resp, re, code] of cases) {
    const s = loadScript({ props: { ANTHROPIC_API_KEY: 'k' }, sheets: book(), fetch: () => resp });
    const r = s.post(call());
    assert.equal(r.ok, undefined); assert.match(r.error, re); assert.equal(r.code, code);
    assert.match(s.book.sheets['ИИ-журнал'].rows[1][11], /^ошибка/);
  }
});

test('слишком большой запрос не уходит в API', () => {
  const s = loadScript({ props: { ANTHROPIC_API_KEY: 'k' }, sheets: book(), fetch: () => toolReply({}) });
  const b = call(); b.ai.content = [{ type: 'text', text: 'x'.repeat(15 * 1024 * 1024 + 10) }];
  const r = s.post(b);
  assert.equal(r.code, 'size'); assert.equal(s.calls.length, 0);
});

test('подтверждение пишется в журнал и возвращается в выгрузке для проверки дубликатов', () => {
  const s = loadScript({ props: { ANTHROPIC_API_KEY: 'k' }, sheets: book(), fetch: () => toolReply({ reply: 'готов' }) });
  s.post(ping());
  const data = { date: '2026-09-20', route: 'HORGOS TO TASHKENT', places: 120, cbm: 45.5, kg: 9100, edits: 3 };
  assert.equal(s.post({ token: '', login: 'buraq', ai: { action: 'log', meta: { status: 'confirmed', draft: 'd7', file: 'm.xlsx', data } } }).ok, true);
  s.post({ token: '', login: 'buraq', ai: { action: 'log', meta: { status: 'rejected', draft: 'd8', data: { date: '2026-09-21' } } } });
  const log = s.book.sheets['ИИ-журнал'].rows;
  assert.deepEqual(log.slice(2).map(r => [r[4], r[11]]), [['подтверждение', 'подтверждён'], ['отклонение', 'отклонён']]);
  const d = s.get();
  assert.equal(d.data.imports.length, 1); assert.equal(d.data.imports[0].route, 'HORGOS TO TASHKENT'); assert.equal(d.data.imports[0].draft, 'd7'); assert.equal(d.data.imports[0].edits, 3);
});

test('маркировки клиента — столбец Y (добавляется, если листа не хватает) и выгрузка 25 столбцов', () => {
  const s = loadScript({ sheets: book(), fetch: () => toolReply({}) });
  const r = s.post({ token: '', ops: [{ t: 'cli.upsert', v: { bl: 'BL-7', brand: 'SVETKO', marks: 'CBETKO, СВЕТКО' } }] });
  assert.equal(r.ok, true);
  const m = s.book.sheets.Mijozlar;
  assert.equal(m.maxCols, 25); assert.equal(m.rows[3][24], 'Markirovkalar'); assert.equal(m.rows[4][0], 'BL-7'); assert.equal(m.rows[4][24], 'CBETKO, СВЕТКО');
  assert.equal(r.data.sheets.Mijozlar[4][24], 'CBETKO, СВЕТКО');
  // правка без marks не трогает столбец Y
  s.post({ token: '', ops: [{ t: 'cli.upsert', key: 'BL-7', v: { bl: 'BL-7', brand: 'SVETKO 2' } }] });
  assert.equal(m.rows[4][24], 'CBETKO, СВЕТКО'); assert.equal(m.rows[4][1], 'SVETKO 2');
});

test('пределы плотности — строки 71–72 листа «Sozlamalar» с подписями', () => {
  const s = loadScript({ sheets: book(), fetch: () => toolReply({}) });
  s.post({ token: '', ops: [{ t: 'set', v: { densityMin: 40, densityMax: 800 } }] });
  const z = s.book.sheets.Sozlamalar.rows;
  assert.equal(z[70][1], 40); assert.equal(z[71][1], 800); assert.match(z[70][0], /zichlik/i); assert.match(z[71][0], /zichlik/i);
});

// Сайт выбирает дату партии 04.05.2006, скрипт с поясом «Алматы» (в 2006 году — UTC+6) записывал её как полночь
// своего пояса = 23:00 03.05.2006 в таблице с поясом Ташкента (UTC+5), и дата на сайте становилась 03.05.2006.
// В заглушке таблица — Ташкент; пояс скрипта — это пояс процесса Node (new Date(г, м, д) в скрипте).
test('дата партии — полночь по поясу таблицы, а не скрипта: при поясе скрипта «Алматы» 04.05.2006 не становится 03.05.2006', () => {
  const tz0 = process.env.TZ; process.env.TZ = 'Asia/Almaty';
  try {
    const s = loadScript({ props: { TOKEN: 'pw' }, sheets: book() });
    const up = (row, date, bl) => s.post({ token: 'pw', ops: [{ t: 'ship.upsert', row, guard: { bl, date }, v: { date, bl, cbm: 1, kg: 10, places: 1, truck: 'Gazel-1', route: 1, status: 'Rejada', note: '' } }] });
    up(0, '2006-05-04', 'BL-1'); up(0, '2026-09-28', 'BL-2'); up(0, '2023-02-01', 'BL-3');
    const tash = d => new Date(d.getTime() + 5 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
    assert.deepEqual(s.book.sheets.Yuborishlar.rows.slice(4).map(r => tash(r[0])), ['2006-05-04 00:00', '2026-09-28 00:00', '2023-02-01 00:00'], 'в таблице — полночь нужного дня');
    // сайт получает дату целым числом дней: 04.05.2006 → 38841
    const ship = s.get({ token: 'pw' }).data.sheets.Yuborishlar.slice(4).map(r => r[0]);
    assert.deepEqual(ship, [38841, 46293, 44958]);
    // правка той же строки по дате находит её (защита от сдвига строк)
    assert.equal(up(9, '2006-05-04', 'BL-1').results[0].row, 5);
  } finally { if (tz0 === undefined) delete process.env.TZ; else process.env.TZ = tz0; }
});

test('даты, которые прежний код уже записал со сдвигом пояса, исправляются один раз сами: 18:00 и позже — следующий день, раньше — тот же', () => {
  const sheets = book(), tash = (y, m, d, h = 0) => new Date(Date.UTC(y, m - 1, d, h) - 5 * 3600e3);
  sheets.Yuborishlar.rows.push([tash(2006, 5, 3, 23), '', 'BL-1'], [tash(2026, 9, 28), '', 'BL-2'], [tash(2026, 9, 27, 5), '', 'BL-3'], ['31.08.2026', '', 'BL-4'],
    [tash(2026, 9, 27, 13), '', 'BL-5'], [tash(2026, 9, 26, 21), '', 'BL-6']);
  const s = loadScript({ props: { TOKEN: 'pw' }, sheets });
  const ship = s.get({ token: 'pw' }).data.sheets.Yuborishlar.slice(4).map(r => r[0]);
  // 23:00 (скрипт в «Алматы», 2006) и 21:00 (скрипт в Китае) → следующий день; 05:00 (UTC) и 13:00 (Лос-Анджелес) → тот же
  assert.deepEqual(ship, [38841, 46293, 46292, '31.08.2026', 46292, 46292], 'текст не трогаем');
  assert.equal(s.props.SHIP_DATES_FIXED, '1');
  // второй раз не трогает: даже если кто-то вписал время руками
  s.book.sheets.Yuborishlar.rows[5][0] = tash(2026, 9, 28, 23);
  assert.ok(Math.abs(s.get({ token: 'pw' }).data.sheets.Yuborishlar[5][0] - (46293 + 23 / 24)) < 1e-6, 'повторно не исправляет');
});

// ── версия 19: без пароля скрипт закрыт ──
import { TEST_TOKEN, TEST_EDITOR } from './gs-mock.mjs';
const noFetch = () => { throw new Error('внешний запрос не должен уходить'); };

test('версия 19: без свойства TOKEN скрипт никого не пускает — «Задайте TOKEN…», данные и ИИ не отдаются', () => {
  const s = loadScript({ auth: false, props: { ANTHROPIC_API_KEY: 'k', EDITOR_TOKEN: 'ed' }, sheets: book(), fetch: noFetch });
  for (const r of [s.rawGet({}), s.rawGet({ token: 'что-угодно' }), s.rawGet({ resolve: 'https://maps.app.goo.gl/x' }), s.rawPost({ ops: [] }), s.rawPost(ping({ token: '', editor: 'ed' })), s.rawPost({ token: 'x', tg: { action: 'setup' }, editor: 'ed' })]) {
    assert.equal(r.code, 'nopass', JSON.stringify(r)); assert.match(r.error, /^Задайте TOKEN в свойствах скрипта/); assert.equal(r.v, 33);
    assert.equal(r.data, undefined); assert.equal(r.ok, undefined);
  }
  assert.equal(s.calls.length, 0, 'ни ИИ, ни раскрытия ссылок');
  assert.equal(s.book.sheets.Yuborishlar.rows.length, 4, 'запись в таблицу не прошла');
  assert.equal(s.rawPost({ token: '', ops: [{ t: 'ship.upsert', v: { date: '2026-09-28', bl: 'BL-1', cbm: 1, kg: 1, places: 1, truck: 'Gazel-1', route: 1, status: 'Rejada', note: '' } }] }).code, 'nopass');
  assert.equal(s.book.sheets.Yuborishlar.rows.length, 4);
});

test('версия 19: TOKEN задан — без пароля и с чужим «Неверный пароль» (code pass); свойство находится и в другом регистре', () => {
  const s = loadScript({ auth: false, props: { ' token ': ' pw \n', EDITOR_TOKEN: 'ed' }, sheets: book(), fetch: noFetch });
  for (const r of [s.rawGet({}), s.rawGet({ token: '' }), s.rawGet({ token: 'PW' }), s.rawPost({ ops: [] }), s.rawPost({ token: 'x', ops: [] })]) {
    assert.deepEqual([r.error, r.code, r.v, r.data], ['Неверный пароль', 'pass', 33, undefined]);
  }
  const ok = s.rawGet({ token: 'pw' });
  assert.equal(ok.ok, true); assert.ok(ok.data.sheets.Yuborishlar);
  assert.equal(s.rawPost({ token: 'pw', ops: [] }).ok, true);
});

test('версия 19: обновления Telegram (?tg=) и фото с камеры водителя проверяются своей подписью, TOKEN им не нужен', () => {
  const sent = [];
  const s = loadScript({ auth: false, props: { TG_TOKEN: '123:ABC', TG_SECRET: 'hook-secret' }, sheets: book(), fetch: (req, o, n, url) => { sent.push(url); return { body: { ok: true, result: { message_id: 1 } } }; } });
  const out = s.tgPost({ update_id: 1, message: { message_id: 1, from: { id: 501, first_name: 'Akmal' }, chat: { id: 501, type: 'private' }, text: '/start' } });
  assert.deepEqual(out, { html: 'ok' }); assert.ok(sent.some(u => /sendMessage$/.test(u)), 'бот ответил без TOKEN');
  const n = sent.length;
  s.tgPost({ update_id: 2, message: { message_id: 2, from: { id: 501 }, chat: { id: 501, type: 'private' }, text: '/start' } }, 'чужой');
  assert.equal(sent.length, n, 'с чужим секретом — не обрабатывается');
  const ph = s.rawPost({ tgphoto: { init: 'испорчено', key: 'BL-1|1', ping: 1 } });
  assert.notEqual(ph.code, 'nopass'); assert.ok(ph.error, 'фото: отказ по подписи Telegram, а не по TOKEN');
});

test('версия 19: без EDITOR_TOKEN — отказ ИИ и боту с сайта («Задайте EDITOR_TOKEN…»), а не доступ по паролю таблицы', () => {
  const s = loadScript({ auth: false, props: { TOKEN: 'pw', ANTHROPIC_API_KEY: 'k', TG_TOKEN: '123:ABC' }, sheets: book(), fetch: noFetch });
  for (const r of [s.rawPost(ping({ token: 'pw' })), s.rawPost(ping({ token: 'pw', editor: 'любой' })), s.rawPost({ token: 'pw', tg: { action: 'setup', url: 'https://script.google.com/macros/s/A/exec' } }),
    s.rawPost({ token: 'pw', editor: '', tg: { action: 'dispatch', date: '2026-09-28' } })]) {
    assert.equal(r.code, 'noeditor', JSON.stringify(r)); assert.match(r.error, /^Задайте EDITOR_TOKEN в свойствах скрипта/); assert.equal(r.v, 33);
  }
  assert.equal(s.calls.length, 0, 'ни Claude, ни Telegram');
  assert.equal(s.book.sheets['ИИ-журнал'], undefined, 'в журнал ИИ ничего не записано');
  // с EDITOR_TOKEN: пустой и чужой — «editor», свой — работает
  const e = loadScript({ auth: false, props: { TOKEN: 'pw', EDITOR_TOKEN: 'ed', ANTHROPIC_API_KEY: 'k' }, sheets: book(), fetch: () => toolReply({ reply: 'готов' }) });
  assert.equal(e.rawPost(ping({ token: 'pw', editor: '' })).code, 'editor'); assert.equal(e.rawPost(ping({ token: 'pw', editor: 'ED' })).code, 'editor');
  assert.equal(e.rawPost(ping({ token: 'pw', editor: 'ed' })).ok, true);
});

// ── раскрытие ссылок на карту: только Google Карты, goo.gl, Яндекс Карты, 2ГИС ──
function mapScript(routes) {
  const s = loadScript({ sheets: book(), fetch: (req, o, n, url) => { const r = routes[url]; if (!r) throw new Error('непредусмотренный запрос: ' + url); return r; } });
  s.resolve = link => s.get({ resolve: link });
  s.urls = () => s.calls.map(c => c.url);
  return s;
}
const to = loc => ({ status: 302, headers: { Location: loc }, body: '' });

test('версия 19: чужие адреса не открываются — ни исходная ссылка, ни с «логин@», портом или путём не /maps', () => {
  const s = mapScript({});
  for (const bad of ['https://evil.example/x', 'http://169.254.169.254/latest/meta-data', 'https://maps.google.com@evil.example/x', 'https://maps.google.com.evil.example/maps',
    'https://www.google.com/search?q=1', 'https://yandex.ru/search?text=1', 'https://maps.google.com:8080/x', 'https://evil.example/?u=https://maps.google.com', 'ftp://maps.google.com/x',
    'https://maps.google.com\\@evil.example/', 'https://docs.google.com/maps/x', 'javascript:alert(1)']) {
    const r = s.resolve(bad);
    assert.equal(r.code, 'host', bad + ' → ' + JSON.stringify(r)); assert.match(r.error, /не ссылка на карту/);
  }
  assert.equal(s.calls.length, 0, 'ни одного внешнего запроса');
});

test('версия 19: короткие ссылки Google, goo.gl, Яндекс и 2ГИС раскрываются, в том числе по относительной переадресации', () => {
  const s = mapScript({
    'https://maps.app.goo.gl/abc': to('https://www.google.com/maps/place/@41.311,69.279,17z'),
    'https://www.google.com/maps/place/@41.311,69.279,17z': { body: '<html></html>' },
    'https://goo.gl/maps/xyz': to('https://maps.app.goo.gl/abc2'),
    'https://maps.app.goo.gl/abc2': to('/maps/place/@41.3,69.2,17z'),
    'https://maps.app.goo.gl/maps/place/@41.3,69.2,17z': to('https://maps.google.com/?q=41.3,69.2'),
    'https://maps.google.com/?q=41.3,69.2': { body: '' },
    'https://yandex.uz/maps/-/CDabc': to('https://yandex.uz/maps/10335/tashkent/?ll=69.2%2C41.3&z=17'),
    'https://yandex.uz/maps/10335/tashkent/?ll=69.2%2C41.3&z=17': { body: '"coordinates":[69.2,41.3]' },
    'https://go.2gis.com/k1': to('https://2gis.uz/tashkent/geo/70000001/69.2,41.3'),
    'https://2gis.uz/tashkent/geo/70000001/69.2,41.3': { body: '' }
  });
  let r = s.resolve('https://maps.app.goo.gl/abc');
  assert.equal(r.ok, true); assert.deepEqual(r.hops, ['https://maps.app.goo.gl/abc', 'https://www.google.com/maps/place/@41.311,69.279,17z']);
  r = s.resolve('https://goo.gl/maps/xyz');
  assert.equal(r.ok, true); assert.equal(r.url, 'https://maps.google.com/?q=41.3,69.2'); assert.equal(r.hops.length, 4);
  r = s.resolve('https://yandex.uz/maps/-/CDabc');
  assert.equal(r.ok, true); assert.deepEqual(r.ll, [41.3, 69.2]);
  r = s.resolve('https://go.2gis.com/k1');
  assert.equal(r.ok, true); assert.equal(r.url, 'https://2gis.uz/tashkent/geo/70000001/69.2,41.3');
});

test('версия 19: переадресация на чужой адрес не открывается — ни полная, ни «//хост», ни на Яндекс не /maps', () => {
  const s = mapScript({
    'https://maps.app.goo.gl/a': to('https://evil.example/steal'),
    'https://maps.app.goo.gl/b': to('//evil.example/steal'),
    'https://goo.gl/c': to('https://maps.app.goo.gl/d'),
    'https://maps.app.goo.gl/d': to('http://169.254.169.254/'),
    'https://yandex.ru/maps/-/e': to('https://yandex.ru/showcaptcha?retpath=x')
  });
  for (const [link, host] of [['https://maps.app.goo.gl/a', 'evil.example'], ['https://maps.app.goo.gl/b', 'evil.example'], ['https://goo.gl/c', '169.254.169.254'], ['https://yandex.ru/maps/-/e', 'yandex.ru']]) {
    const r = s.resolve(link);
    assert.equal(r.code, 'host', link); assert.match(r.error, new RegExp('ведёт не на карту \\(' + host.replace(/\./g, '\\.') + '\\)'));
  }
  assert.ok(!s.urls().some(u => /evil|169\.254|showcaptcha/.test(u)), 'чужие адреса не запрашивались: ' + s.urls().join(' '));
});

// ── версия 21: карточка машины на листе Sozlamalar (E:J), переименование машины, машина в ремонте — не в боте ──
const fleetBook = () => {
  const set = []; set[22] = ['', '', 'Mashinalar', 'Davlat raqami'];
  ['Gazel-1', 'Gazel-2', 'Labo'].forEach((t, i) => { set[23 + i] = ['', '', t, i === 1 ? '01B777CC' : '']; });
  const ship = [[], [], [], ['Sana']], row = (bl, truck) => { const r = Array(16).fill(''); r[2] = bl; r[12] = truck; return r; };
  ship.push(row('BL-1', 'Gazel-2'), row('BL-2', 'Gazel-1'), row('BL-3', 'Gazel-2'));
  return { ...book(), Sozlamalar: { rows: set, maxCols: 4 }, Yuborishlar: { rows: ship, maxCols: 21 },
    Haydovchilar: { rows: [['Telegram ID', 'Ism', 'Mashina', 'Davlat raqami', 'Til', 'Holat', '', '', '', ''], ['501', 'Akmal', 'Gazel-2', '01B777CC', 'ru', 'ruxsat', '', '', '', '{}']], maxCols: 10 } };
};
const card = { repair: true, model: 'GAZelle Next', year: 2021, m3: 17.5, kg: 3500, note: 'длинная база' };

test('версия 21: карточка машины — Sozlamalar E:J напротив названия, заголовки в строке 23, сайт получает E:J', () => {
  const s = loadScript({ sheets: fleetBook() });
  const r = s.post({ ops: [{ t: 'fleet', v: { 'Gazel-2': card } }] });
  assert.equal(r.v, 33); assert.deepEqual(r.results[0], { ok: true });
  const z = s.book.sheets.Sozlamalar.rows;
  assert.deepEqual(z[22].slice(4, 10), ['Holati', 'Marka', 'Yili', 'Hajm, m³', 'Yuk, kg', 'Izoh']);
  assert.deepEqual(z[24].slice(2, 10), ['Gazel-2', '01B777CC', 'ta’mirda', 'GAZelle Next', 2021, 17.5, 3500, 'длинная база']);
  assert.deepEqual(z[23].slice(4, 10), ['', '', '', '', '', ''], 'у Gazel-1 карточка пустая');
  assert.deepEqual(s.get({}).data.sheets.Sozlamalar[24].slice(2, 10), ['Gazel-2', '01B777CC', 'ta’mirda', 'GAZelle Next', 2021, 17.5, 3500, 'длинная база']);
  // пустое — стирается
  s.post({ ops: [{ t: 'fleet', v: { 'Gazel-2': { model: 'GAZelle' } } }] });
  assert.deepEqual(z[24].slice(4, 10), ['', 'GAZelle', '', '', '', '']);
});

test('версия 31: кузов машины — Sozlamalar K:M (длина, ширина, высота), только когда сайт его передаёт; K23:M23 заняты — не пишется', () => {
  const s = loadScript({ sheets: fleetBook() }), z = s.book.sheets.Sozlamalar.rows;
  assert.deepEqual(s.post({ ops: [{ t: 'fleet', v: { 'Gazel-2': { ...card, l: 4.2, w: 2.1, h: 2.2 } }, body: 1 }] }).results[0], { ok: true });
  assert.deepEqual(z[22].slice(10, 13), ['Uzunlik, m', 'Kenglik, m', 'Balandlik, m']);
  assert.deepEqual([z[24].slice(10, 13), z[23].slice(10, 13)], [[4.2, 2.1, 2.2], ['', '', '']]);
  assert.deepEqual(s.get({}).data.sheets.Sozlamalar[24].slice(10, 13), [4.2, 2.1, 2.2], 'сайт получает K:M');
  // старый сайт (без body) кузов не трогает; новый — стирает пустое
  s.post({ ops: [{ t: 'fleet', v: { 'Gazel-2': card } }] });
  assert.deepEqual(z[24].slice(10, 13), [4.2, 2.1, 2.2]);
  s.post({ ops: [{ t: 'fleet', v: { 'Gazel-2': { ...card, l: null, w: 0, h: '' } }, body: 1 }] });
  assert.deepEqual(z[24].slice(10, 13), ['', '', '']);
  // список машин поменялся — кузов переезжает с названием
  s.post({ ops: [{ t: 'fleet', v: { 'Gazel-2': { l: 3, w: 1.8, h: 1.9 } }, body: 1 }] });
  s.post({ ops: [{ t: 'trucks', v: ['Labo', 'Gazel-1', 'Gazel-2'] }] });
  assert.deepEqual([z[25][2]].concat(z[25].slice(10, 13)), ['Gazel-2', 3, 1.8, 1.9]);
  // чужое в K23:M23 — карточка E:J пишется, кузов нет
  const b = fleetBook(); b.Sozlamalar.rows[22][11] = 'моё'; b.Sozlamalar.maxCols = 13;
  const s2 = loadScript({ sheets: b });
  assert.deepEqual(s2.post({ ops: [{ t: 'fleet', v: { 'Gazel-2': { ...card, l: 4.2, w: 2.1, h: 2.2 } }, body: 1 }] }).results[0], { ok: true });
  assert.equal(s2.book.sheets.Sozlamalar.rows[24][5], 'GAZelle Next'); assert.equal(s2.book.sheets.Sozlamalar.rows[24][10] ?? '', '');
});

test('версия 21: чужие данные в E23:J23 — карточка не пишется (code busy)', () => {
  const b = fleetBook(); b.Sozlamalar.rows[22][6] = 'моя заметка';
  const s = loadScript({ sheets: b });
  const r = s.post({ ops: [{ t: 'fleet', v: { 'Gazel-2': card } }] }).results[0];
  assert.equal(r.code, 'busy'); assert.match(r.error, /E23:J23 заняты/);
  assert.equal((s.book.sheets.Sozlamalar.rows[24][4] ?? ''), '', 'ничего не записано');
});

test('версия 21: список машин поменялся — госномер и карточка переезжают вместе с названием', () => {
  const s = loadScript({ sheets: fleetBook() });
  s.post({ ops: [{ t: 'fleet', v: { 'Gazel-2': card } }] });
  s.post({ ops: [{ t: 'trucks', v: ['Labo', 'Gazel-2', 'Gazel-1', 'Kamaz-1'] }] });
  const z = s.book.sheets.Sozlamalar.rows;
  assert.deepEqual(z[24].slice(2, 10), ['Gazel-2', '01B777CC', 'ta’mirda', 'GAZelle Next', 2021, 17.5, 3500, 'длинная база']);
  assert.deepEqual([z[23][2], z[23][3], z[23][4]], ['Labo', '', '']);
  assert.deepEqual([z[26][2], z[26][3], z[26][4]], ['Kamaz-1', '', '']);
});

test('версия 21: переименование — в списке (госномер и карточка на месте), в журнале и у водителей бота', () => {
  const s = loadScript({ sheets: fleetBook() });
  s.post({ ops: [{ t: 'fleet', v: { 'Gazel-2': card } }] });
  const r = s.post({ ops: [{ t: 'rename', from: 'Gazel-2', to: 'Gazel-Ali' }] }).results[0];
  assert.deepEqual(r, { ok: true, ships: 2, drivers: 1 });
  const z = s.book.sheets.Sozlamalar.rows, y = s.book.sheets.Yuborishlar.rows;
  assert.deepEqual(z[24].slice(2, 5), ['Gazel-Ali', '01B777CC', 'ta’mirda']);
  assert.deepEqual(y.slice(4).map(x => x[12]), ['Gazel-Ali', 'Gazel-1', 'Gazel-Ali']);
  assert.equal(s.book.sheets.Haydovchilar.rows[1][2], 'Gazel-Ali');
  assert.equal(s.post({ ops: [{ t: 'rename', from: 'Gazel-1', to: 'Gazel-Ali' }] }).results[0].code, 'exists', 'имя занято');
  assert.equal(s.post({ ops: [{ t: 'rename', from: 'Gazel-9', to: 'Gazel-X' }] }).results[0].code, 'nofrom');
  assert.equal(z[23][2], 'Gazel-1', 'после ошибок ничего не поменялось');
});

test('версия 21: машину в ремонте бот водителю не предлагает', () => {
  const s = loadScript({ sheets: fleetBook() });
  assert.deepEqual(s.ctx.tgTrucks_(), ['Gazel-1', 'Gazel-2', 'Labo']);
  s.post({ ops: [{ t: 'fleet', v: { 'Gazel-2': card } }] });
  assert.deepEqual(s.ctx.tgTrucks_(), ['Gazel-1', 'Labo']);
});

// ошибка скрипта — сайту текстом (иначе Google отдаёт свою страницу, а сайт видит только «Failed to fetch»)
test('ошибка кода или таблицы — ответ JSON с текстом ошибки (code script); таблица занята дольше 25 с — code busy', () => {
  const s = loadScript({ props: { TOKEN: 'pw' }, sheets: book() });
  s.ctx.dump_ = () => { throw new Error('Service Spreadsheets failed'); };
  const r = s.post({ token: 'pw', ops: [] });
  assert.deepEqual(r, { error: 'Ошибка скрипта таблицы: Service Spreadsheets failed', code: 'script', v: 33 });
  assert.deepEqual(s.get({ token: 'pw' }), { error: 'Ошибка скрипта таблицы: Service Spreadsheets failed', code: 'script', v: 33 });
  s.ctx.LockService.getScriptLock = () => ({ waitLock() { throw new Error('Lock timeout: another process was holding the lock for too long.'); }, releaseLock() {} });
  const b = s.post({ token: 'pw', ops: [] });
  assert.deepEqual([b.code, b.error], ['busy', 'Таблица занята другой записью — сайт повторит сам через полминуты']);
  // пароль по-прежнему проверяется до всего остального
  assert.equal(s.post({ token: 'чужой', ops: [] }).code, 'pass');
});

// версия 24: правка, которую таблица не приняла (проверка данных «отклонять ввод»), не останавливает остальные
const valBook = () => {
  const b = book();
  b.Mijozlar.maxCols = 25;
  b.Mijozlar.rows.push(['BL-1', 'NOVA', 'Aziz', '+998900000001', '+998900000011', '', '', 'Chilonzor', 'Bunyodkor 1']);   // строка 5
  b.Mijozlar.rows.push(['BL-2', 'STAR', 'Bobur', '+998900000002', '', '', '', '', '']);   // строка 6
  return b;
};
const cli = (bl, x = {}) => ({ bl, brand: '', name: '', tel1: '', tel2: '', receiver: '', receiverTel: '', district: '', address: '', lat: '', lon: '', note: '', manualZone: '', link: '', marks: '', ...x });
test('версия 24: ячейку не приняла проверка данных — эта правка не записана (строка как была), остальные записаны; ответ code cell с листом и строкой', () => {
  const s = loadScript({ props: { TOKEN: 'pw' }, sheets: valBook() });
  const M = s.book.sheets.Mijozlar, OK = ['+998900000011', '+998900000022'];
  M.reject = (r, c, x) => c === 5 && x !== '' && !OK.includes(String(x)) ? 'В ячейке E' + r + ' нарушены правила проверки данных. Укажите одно из следующих значений: ' + OK.join(', ') + '.' : null;
  const was2 = cli('BL-2', { brand: 'STAR', name: 'Bobur', tel1: '+998900000002' });
  const r = s.post({ token: 'pw', ops: [
    { t: 'cli.upsert', key: 'BL-2', was: was2, v: { ...was2, name: 'Bobur A', tel2: '+998977777777', district: 'Sergeli' } },   // телефон не из списка
    { t: 'cli.upsert', v: cli('BL-3', { name: 'Dilshod', tel1: '+998900000003', tel2: '+998900000099' }) },   // новый клиент, телефон не из списка
    { t: 'ship.upsert', v: { date: '2026-09-29', bl: 'BL-1', cbm: 1, kg: 10, places: 1, truck: 'Gazel-1', route: 1, status: 'Rejada', note: '' } }] });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.results[0].code, 'cell'); assert.match(r.results[0].error, /^Mijozlar, строка 6: В ячейке E6 нарушены правила проверки данных/);
  assert.match(r.results[1].error, /^Mijozlar, строка 7: В ячейке E7 /);
  assert.equal(r.results[2].row, 5, 'отгрузка записана');
  assert.deepEqual(M.rows[5].slice(0, 9), ['BL-2', 'STAR', 'Bobur', '+998900000002', '', '', '', '', ''], 'строка клиента — как была (имя не записано наполовину)');
  assert.ok(!(M.rows[6] || []).some(x => x !== '' && x != null), 'новый клиент не остался записанным наполовину: ' + JSON.stringify(M.rows[6]));
  assert.equal(s.book.sheets.Yuborishlar.rows[4][2], 'BL-1');
});
test('версия 24: правка клиента с прежними значениями пишет только изменённые ячейки — телефон не переписывается', () => {
  const s = loadScript({ props: { TOKEN: 'pw' }, sheets: valBook() });
  const M = s.book.sheets.Mijozlar, cols = [];
  M.reject = (r, c) => { cols.push(c); return c === 5 ? 'В ячейке E' + r + ' нарушены правила проверки данных.' : null; };   // E целиком «под проверкой»
  const was1 = cli('BL-1', { brand: 'NOVA', name: 'Aziz', tel1: '+998900000001', tel2: '+998900000011', district: 'Chilonzor', address: 'Bunyodkor 1' });
  const r = s.post({ token: 'pw', ops: [{ t: 'cli.upsert', key: 'BL-1', was: was1, v: { ...was1, district: 'Yunusobod', lat: 41.36, lon: 69.28 } }] });
  assert.deepEqual(r.results[0], { row: 5 }, JSON.stringify(r.results));
  assert.deepEqual(cols.sort((a, b) => a - b), [8, 11, 12], 'только район и координаты');
  assert.deepEqual([M.rows[4][4], M.rows[4][7], M.rows[4][10]], ['+998900000011', 'Yunusobod', 41.36]);
  // без was (старый сайт) и новый клиент — все поля, как раньше
  cols.length = 0; M.reject = (r, c) => { cols.push(c); return null; };
  s.post({ token: 'pw', ops: [{ t: 'cli.upsert', key: 'BL-1', v: { ...was1, district: 'Sergeli' } }] });
  assert.ok([1, 2, 3, 4, 5, 8].every(c => cols.includes(c)), 'без was — вся строка: ' + cols.join());
});

// версия 25: куда везти — у отгрузки (Yuborishlar V)
test('версия 25: локация отгрузки — V с подписью в строке 4, сайт получает V, без изменения не переписывается, удаление строки сдвигает V', () => {
  const b = book();
  const s = loadScript({ props: { TOKEN: 'pw' }, sheets: b });
  const Y = s.book.sheets.Yuborishlar;
  const v1 = { date: '2026-09-29', bl: 'BL-1', cbm: 1, kg: 10, places: 1, truck: 'Gazel-1', route: 1, status: 'Rejada', note: '' };
  const r = s.post({ token: 'pw', ops: [
    { t: 'ship.upsert', v: { ...v1, loc: 'Sklad Sergeli · 41.250000, 69.200000' } },
    { t: 'ship.upsert', v: { ...v1, bl: 'BL-2', loc: '' } },
    { t: 'ship.upsert', v: { ...v1, bl: 'BL-3', loc: 'Ombor 2 · 41.300000, 69.300000' } }] });
  assert.deepEqual(r.results.map(x => x.row), [5, 6, 7], JSON.stringify(r.results));
  assert.ok(Y.maxCols >= 22, 'столбец V добавлен');
  assert.deepEqual([Y.rows[3][21], Y.rows[4][21], Y.rows[5][21] ?? '', Y.rows[6][21]], ['Yetkazish joyi', 'Sklad Sergeli · 41.250000, 69.200000', '', 'Ombor 2 · 41.300000, 69.300000']);
  const sheet = s.get({ token: 'pw' }).data.sheets.Yuborishlar;
  assert.equal(sheet[4][21], 'Sklad Sergeli · 41.250000, 69.200000', 'сайт получает V 22-м элементом строки');
  assert.ok(sheet[4].length === 22 && sheet[4][16] === '', 'Q:U (формулы) сайту не отдаются');
  // правка статуса с прежними значениями — V не трогается (в таблице поменяли вручную — остаётся)
  Y.rows[4][21] = 'вручную · 41.1, 69.1';
  s.post({ token: 'pw', ops: [{ t: 'ship.upsert', row: 5, guard: { bl: 'BL-1', date: '2026-09-29' }, was: { ...v1, loc: 'Sklad Sergeli · 41.250000, 69.200000' }, v: { ...v1, status: 'Yolda', loc: 'Sklad Sergeli · 41.250000, 69.200000' } }] });
  assert.deepEqual([Y.rows[4][14], Y.rows[4][21]], ['Yolda', 'вручную · 41.1, 69.1']);
  // удаление строки BL-2 — V строки BL-3 поднимается вместе с ней
  s.post({ token: 'pw', ops: [{ t: 'ship.delete', row: 6, guard: { bl: 'BL-2', date: '2026-09-29' } }] });
  assert.deepEqual([Y.rows[5][2], Y.rows[5][21]], ['BL-3', 'Ombor 2 · 41.300000, 69.300000']);
  assert.ok(!(Y.rows[6] || []).some(x => x !== '' && x != null), 'последняя строка очищена, включая V');
  // разбор: название и координаты; без координат — нет точки
  const lp = x => JSON.parse(JSON.stringify(s.ctx.locParse_(x)));   // объект из контекста скрипта — сравнение по содержимому
  assert.deepEqual(lp('Sklad Sergeli · 41.25, 69.2'), { name: 'Sklad Sergeli', lat: 41.25, lon: 69.2 });
  assert.deepEqual(lp('41.3; 69.3'), { name: '', lat: 41.3, lon: 69.3 });
  assert.deepEqual(lp('Ombor 12, 41.3, 69.2'), { name: 'Ombor 12', lat: 41.3, lon: 69.2 });
  assert.equal(lp('Sklad Sergeli'), null);
  assert.equal(lp(''), null);
});

// версия 33: коробки по пакинг-листу — Yuborishlar W
test('версия 33: коробки отгрузки — W с подписью «Qutilar, sm», сайт получает W, без изменения не переписывается, чужой W — code cell, удаление сдвигает W', () => {
  const s = loadScript({ props: { TOKEN: 'pw' }, sheets: book() }), Y = s.book.sheets.Yuborishlar;
  const v1 = { date: '2026-09-29', bl: 'BL-1', cbm: 1, kg: 10, places: 1, truck: 'Gazel-1', route: 1, status: 'Rejada', note: '' };
  assert.equal(s.get({ token: 'pw' }).data.sheets.Yuborishlar[3].length <= 22, true, 'пока коробок не было — столбец W сайту не отдаётся');
  const r = s.post({ token: 'pw', ops: [{ t: 'ship.upsert', v: { ...v1, boxes: '60×40×50×12; 80×60×40×3' } }, { t: 'ship.upsert', v: { ...v1, bl: 'BL-2', boxes: '' } }, { t: 'ship.upsert', v: { ...v1, bl: 'BL-3' } }] });
  assert.deepEqual(r.results.map(x => x.row), [5, 6, 7], JSON.stringify(r.results));
  assert.deepEqual([Y.rows[3][22], Y.rows[4][22], Y.rows[5][22] ?? '', Y.rows[6][22] ?? ''], ['Qutilar, sm', '60×40×50×12; 80×60×40×3', '', '']);
  const sheet = s.get({ token: 'pw' }).data.sheets.Yuborishlar;
  assert.equal(sheet[4][22], '60×40×50×12; 80×60×40×3', 'сайт получает W 23-м элементом строки'); assert.equal(sheet[4].length, 23);
  // правка без изменения коробок их не трогает; изменение — пишет; пустое — стирает
  s.post({ token: 'pw', ops: [{ t: 'ship.upsert', row: 5, guard: { bl: 'BL-1', date: '2026-09-29' }, was: { ...v1, boxes: '60×40×50×12; 80×60×40×3' }, v: { ...v1, note: 'x', boxes: '60×40×50×12; 80×60×40×3' } }] });
  assert.equal(Y.rows[4][22], '60×40×50×12; 80×60×40×3');
  s.post({ token: 'pw', ops: [{ t: 'ship.upsert', row: 5, guard: { bl: 'BL-1', date: '2026-09-29' }, was: { ...v1, boxes: '60×40×50×12; 80×60×40×3' }, v: { ...v1, boxes: '' } }] });
  assert.equal(Y.rows[4][22], '');
  // удаление строки сдвигает W
  s.post({ token: 'pw', ops: [{ t: 'ship.upsert', row: 7, guard: { bl: 'BL-3', date: '2026-09-29' }, was: v1, v: { ...v1, bl: 'BL-3', boxes: '100×50×50×2' } }] });
  s.post({ token: 'pw', ops: [{ t: 'ship.delete', row: 6, guard: { bl: 'BL-2', date: '2026-09-29' } }] });
  assert.deepEqual([Y.rows[5][2], Y.rows[5][22]], ['BL-3', '100×50×50×2']);
  // чужая подпись в W4 — коробки не пишутся (code cell), остальное пишется, W сайту не отдаётся
  const b = book(); b.Yuborishlar.maxCols = 26; b.Yuborishlar.rows[3][22] = 'Моё';
  const s2 = loadScript({ props: { TOKEN: 'pw' }, sheets: b });
  const r2 = s2.post({ token: 'pw', ops: [{ t: 'ship.upsert', v: { ...v1, boxes: '60×40×50×1' } }, { t: 'ship.upsert', v: { ...v1, bl: 'BL-2' } }] });
  assert.equal(r2.results[0].code, 'cell'); assert.match(r2.results[0].error, /столбец W занят \(«Моё»\)/); assert.equal(r2.results[1].row, 5);
  s2.book.sheets.Yuborishlar.rows[4][22] = 'своё';
  assert.equal(s2.get({ token: 'pw' }).data.sheets.Yuborishlar[4][22], undefined, 'чужой W сайту не отдаётся');
});

test('версия 25: столбец V занят своим (другая подпись в строке 4) — локация не пишется (code cell), V сайту не отдаётся, остальное пишется', () => {
  const b = book(); b.Yuborishlar.maxCols = 26; b.Yuborishlar.rows[3][21] = 'Мои заметки';
  const s = loadScript({ props: { TOKEN: 'pw' }, sheets: b });
  const v1 = { date: '2026-09-29', bl: 'BL-1', cbm: 1, kg: 10, places: 1, truck: 'Gazel-1', route: 1, status: 'Rejada', note: '' };
  const r = s.post({ token: 'pw', ops: [{ t: 'ship.upsert', v: { ...v1, loc: 'Sklad · 41.25, 69.2' } }, { t: 'ship.upsert', v: { ...v1, bl: 'BL-2', loc: '' } }] });
  assert.equal(r.results[0].code, 'cell'); assert.match(r.results[0].error, /столбец V занят \(«Мои заметки»\)/);
  assert.equal(r.results[1].row, 5, 'строка без локации записана');
  assert.equal(s.book.sheets.Yuborishlar.rows[3][21], 'Мои заметки', 'подпись не тронута');
  s.book.sheets.Yuborishlar.rows[4][21] = 'что-то своё';
  assert.equal(s.get({ token: 'pw' }).data.sheets.Yuborishlar[4][21], undefined, 'чужой V сайту не отдаётся');
  // удаление строки чужой V не сдвигает
  s.post({ token: 'pw', ops: [{ t: 'ship.delete', row: 5, guard: { bl: 'BL-2', date: '2026-09-29' } }] });
  assert.deepEqual([s.book.sheets.Yuborishlar.rows[4][2] ?? '', s.book.sheets.Yuborishlar.rows[4][21]], ['', 'что-то своё']);
});

// версия 26: выпадающий список («отклонять ввод») не мешает записи — правило столбца переключается на предупреждение
test('версия 26: значение не из выпадающего списка — правило столбца становится «предупреждением», правка записана; relaxed в ответе', () => {
  const b = valBook(); b.Mijozlar.dv = { 6: { values: ['Aziz', 'Omon'], allowInvalid: false } };   // F — получатель: список имён
  const s = loadScript({ props: { TOKEN: 'pw' }, sheets: b });
  const M = s.book.sheets.Mijozlar;
  const was2 = cli('BL-2', { brand: 'STAR', name: 'Bobur', tel1: '+998900000002' });
  const r = s.post({ token: 'pw', ops: [
    { t: 'cli.upsert', key: 'BL-2', was: was2, v: { ...was2, receiver: 'Yangi Ism', district: 'Sergeli' } },
    { t: 'cli.upsert', v: cli('BL-3', { name: 'Dilshod', receiver: 'Boshqa Ism' }) }] });
  assert.ok(r.results.every(x => !x.error), JSON.stringify(r.results));
  assert.deepEqual([M.rows[5][5], M.rows[5][7], M.rows[6][5]], ['Yangi Ism', 'Sergeli', 'Boshqa Ism']);
  assert.deepEqual(M.dv[6], { values: ['Aziz', 'Omon'], allowInvalid: true }, 'список остался, ввод не из списка разрешён');
  assert.deepEqual(r.relaxed, ['Mijozlar F']);
  assert.equal(M.dvSets, 1, 'правило переключено один раз');
  // без проверки данных — relaxed нет; защищённый диапазон (не проверка данных) — по-прежнему ошибка этой правки
  M.reject = (rr, c) => c === 4 ? 'Вы пытаетесь изменить защищенную ячейку' : null;
  const r2 = s.post({ token: 'pw', ops: [{ t: 'cli.upsert', key: 'BL-2', v: { ...was2, tel1: '+998900000777' } }] });
  assert.equal(r2.results[0].code, 'cell'); assert.equal(r2.relaxed, undefined);
});

// версия 27: варианты точек клиента — в анкете (Mijozlar Z «Lokatsiyalar»)
test('версия 27: точки клиента — Mijozlar Z с подписью, сайт получает Z, без изменения не переписывается; Z занят своим — ошибка правки', () => {
  const b = valBook(); b.Mijozlar.maxCols = 25;
  const s = loadScript({ props: { TOKEN: 'pw' }, sheets: b });
  const M = s.book.sheets.Mijozlar;
  const was2 = cli('BL-2', { brand: 'STAR', name: 'Bobur', tel1: '+998900000002' });
  const L = 'Yangi ombor · 41.350000, 69.300000\nSklad · 41.250000, 69.200000';
  const r = s.post({ token: 'pw', ops: [{ t: 'cli.upsert', key: 'BL-2', was: was2, v: { ...was2, locs: L } }, { t: 'cli.upsert', v: cli('BL-3', { name: 'Dilshod' }) }] });
  assert.ok(r.results.every(x => !x.error), JSON.stringify(r.results));
  assert.ok(M.maxCols >= 26, 'столбец Z добавлен');
  assert.deepEqual([M.rows[3][25], M.rows[5][25], M.rows[6][25] ?? ''], ['Lokatsiyalar', L, ''], 'подпись Z4, точки BL-2; новый клиент без точек Z не трогает');
  const sheet = s.get({ token: 'pw' }).data.sheets.Mijozlar;
  assert.equal(sheet[5][25], L, 'сайт получает Z 26-м элементом строки');
  // правка района с прежними точками — Z не переписывается (в таблице поправили вручную — остаётся)
  M.rows[5][25] = 'вручную · 41.1, 69.1';
  s.post({ token: 'pw', ops: [{ t: 'cli.upsert', key: 'BL-2', was: { ...was2, locs: L }, v: { ...was2, locs: L, district: 'Sergeli' } }] });
  assert.deepEqual([M.rows[5][7], M.rows[5][25]], ['Sergeli', 'вручную · 41.1, 69.1']);
  // Z занят своим — точки не пишутся, остальное пишется; Z сайту не отдаётся
  const b2 = valBook(); b2.Mijozlar.maxCols = 26; b2.Mijozlar.rows[3][25] = 'Мои заметки';
  const s2 = loadScript({ props: { TOKEN: 'pw' }, sheets: b2 });
  const r2 = s2.post({ token: 'pw', ops: [{ t: 'cli.upsert', key: 'BL-2', was: was2, v: { ...was2, locs: L } }, { t: 'cli.upsert', key: 'BL-2', was: was2, v: { ...was2, district: 'Chilonzor' } }] });
  assert.equal(r2.results[0].code, 'cell'); assert.match(r2.results[0].error, /столбец Z занят \(«Мои заметки»\)/);
  assert.equal(s2.book.sheets.Mijozlar.rows[5][7], 'Chilonzor');
  assert.equal(s2.get({ token: 'pw' }).data.sheets.Mijozlar[5].length <= 25, true, 'чужой Z сайту не отдаётся');
});
