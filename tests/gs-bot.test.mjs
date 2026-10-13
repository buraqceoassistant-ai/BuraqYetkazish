// Телеграм-бот для водителей (tools/gs/Bot.gs) на заглушках: Telegram API, Google Диск, листы таблицы.
// Подключение с сайта, регистрация, привязка группы, подтверждение администратором, рабочий день по точкам
// (фото, геолокация, статус в журнале, отчёт в группу), отказ с причиной, второй рейс, изменения с сайта, конец дня.
// Данные вымышленные. Запуск: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { loadScript } from './gs-mock.mjs';

const TODAY = '2026-09-26', day = (y, m, d) => new Date(Date.UTC(y, m - 1, d) - 5 * 3600e3);   // полночь по Ташкенту
const DEPOT = [41.30, 69.20];
function book() {
  const set = []; set[7] = ['', DEPOT[0]]; set[8] = ['', DEPOT[1]];
  ['Gazel-1', 'Gazel-2', 'Gazel-3', 'Labo', 'Kamaz-1', 'Mijoz ozi oladi', 'Belgilanmagan'].forEach((t, i) => { set[23 + i] = ['', '', t]; });
  const ship = [[], [], [], ['Sana']];
  const row = (date, bl, cbm, kg, places, truck, route, status = 'Rejada', note = '') => { const r = []; r[0] = date; r[2] = bl; r[9] = cbm; r[10] = kg; r[11] = places; r[12] = truck; r[13] = route; r[14] = status; r[15] = note; ship.push(r); };
  row(day(2026, 9, 26), 'BL-901', 1.2, 200, 10, 'Gazel-2', 1);
  row(day(2026, 9, 26), 'BL-902', 2, 300, 12, 'Gazel-2', 1, 'Rejada', 'осторожно, стекло');
  row(day(2026, 9, 26), 'BL-901', 0.3, 50, 2, 'Gazel-2', 1, 'Rejada', 'часть 2/2');
  row(day(2026, 9, 26), 'BL-903', 4, 900, 30, 'Gazel-2', 2);
  row(day(2026, 9, 26), 'BL-904', 1, 100, 5, 'Gazel-3', 1);
  row(day(2026, 9, 25), 'BL-905', 1, 100, 5, 'Gazel-2', 1);
  const cli = [[], [], [], ['BL kodi']];
  const c = (bl, brand, name, tel, recv, recvTel, district, address, lat, lon) => { const r = []; Object.assign(r, { 0: bl, 1: brand, 2: name, 3: tel, 5: recv, 6: recvTel, 7: district, 8: address, 10: lat, 11: lon }); cli.push(r); };
  c('BL-901', 'NOVA', 'Aziz', '+998900000001', 'Aziz', '+998900000001', 'Chilonzor', 'Bunyodkor 1', 41.31, 69.21);
  c('BL-902', '', 'Botir', '+998900000002', 'Omon', '+998900000022', 'Yunusobod', 'Amir Temur 2', 41.36, 69.28);
  c('BL-903', 'STAR', 'Dilshod', '+998900000003', '', '', 'Sergeli', 'Yangi Sergeli 3', 41.22, 69.22);
  const dense = rows => Array.from(rows, r => Array.from(r || []));   // без «дыр» в массивах
  return { Yuborishlar: { rows: dense(ship), maxCols: 21 }, Mijozlar: { rows: dense(cli), maxCols: 25 }, Sozlamalar: { rows: dense(set), maxCols: 3 } };
}
function fakeTelegram() {
  const sent = []; let mid = 100;
  const admins = { 900: 'administrator', 901: 'creator' };
  const fetch = (req, opts, n, url) => {
    if (/\/file\/bot/.test(url)) return { body: 'JPEG' };
    const m = url.match(/^https:\/\/api\.telegram\.org\/bot[^/]+\/(\w+)$/);
    if (!m) return { status: 404, body: {} };
    sent.push({ method: m[1], ...req });
    if (m[1] === 'getMe') return { body: { ok: true, result: { id: 1, username: 'buraq_test_bot', first_name: 'BURAQ' } } };
    if (m[1] === 'getChatMember') return { body: { ok: true, result: { status: admins[req.user_id] || 'member' } } };
    if (m[1] === 'getFile') return { body: { ok: true, result: { file_path: 'photos/' + req.file_id + '.jpg' } } };
    if (m[1] === 'sendPhoto' && req.photo && typeof req.photo === 'object') return { body: { ok: true, result: { message_id: ++mid, photo: [{ file_id: 'cam-s' }, { file_id: 'cam-' + mid }] } } };   // снимок с камеры — файлом
    return { body: { ok: true, result: { message_id: ++mid } } };
  };
  return { sent, fetch };
}
function setup(props = {}) {
  const tg = fakeTelegram(), now = { value: new Date(Date.UTC(2026, 8, 26, 4, 0)) };   // 09:00 по Ташкенту
  const s = loadScript({ props: { TG_TOKEN: '123:ABC', ...props }, sheets: book(), fetch: tg.fetch, now });
  let uid = 1;
  const upd = x => s.tgPost({ update_id: uid++, ...x });
  const msg = (from, text, extra = {}) => upd({ message: { message_id: uid, from: { id: from, first_name: 'Akmal', username: 'akmal' }, chat: { id: from, type: 'private' }, text, ...extra } });
  const loc = (from, ll) => msg(from, undefined, { location: { latitude: ll[0], longitude: ll[1] } });
  const photo = (from, fid) => msg(from, undefined, { photo: [{ file_id: fid + '-s' }, { file_id: fid }] });
  const cb = (from, data, chat = { id: from, type: 'private' }, message = { message_id: 7, text: 'x', chat }) => upd({ callback_query: { id: 'q' + uid, from: { id: from, first_name: 'Boss' }, data, message } });
  const group = { id: -100500, type: 'supergroup', title: 'BURAQ — доставки' };
  const gmsg = (from, text) => upd({ message: { message_id: uid, from: { id: from, first_name: 'Boss' }, chat: group, text } });
  const last = (method, chat) => [...tg.sent].reverse().find(x => x.method === method && (chat == null || String(x.chat_id) === String(chat)));
  const texts = chat => tg.sent.filter(x => x.method === 'sendMessage' && String(x.chat_id) === String(chat)).map(x => x.text);
  const status = bl => s.book.sheets.Yuborishlar.rows.filter(r => r[2] === bl).map(r => r[14]);
  return { s, tg, now, upd, msg, loc, photo, cb, group, gmsg, last, texts, status };
}
const connect = t => t.s.post({ token: '', tg: { action: 'setup', url: 'https://script.google.com/macros/s/AKfy-test_1/exec' } });

test('подключение с сайта: токен из свойств, вебхук с секретом, команды на двух языках; без токена и со старой ссылкой — ошибки', () => {
  const t = setup();
  const r = connect(t);
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.v, 32); assert.deepEqual(t.s.triggers.map(x => x.fn), ['tgDailySummary', 'tgTick']); assert.equal(t.s.triggers[1].minutes, 5); assert.equal(t.s.triggers[0].fn, 'tgDailySummary'); assert.equal(t.s.triggers[0].hour, 20); assert.equal(r.tg.bot, 'buraq_test_bot'); assert.match(r.tg.code, /^\d{6}$/);
  const hook = t.last('setWebhook');
  assert.equal(hook.url, 'https://script.google.com/macros/s/AKfy-test_1/exec?tg=' + t.s.props.TG_SECRET);
  assert.deepEqual(hook.allowed_updates, ['message', 'callback_query']);
  const cmds = t.tg.sent.filter(x => x.method === 'setMyCommands');
  assert.equal(cmds.length, 2); assert.equal(cmds[1].language_code, 'ru'); assert.deepEqual(cmds[0].commands.map(c => c.command), ['start', 'ish', 'hozir', 'tugatish', 'til', 'dispetcher', 'muammo']);
  assert.equal(connect(t).tg.code, r.tg.code, 'повторное подключение — тот же код группы');
  const n = setup({ TG_TOKEN: '' }), e = connect(n);
  assert.equal(e.code, 'notoken'); assert.match(e.error, /TG_TOKEN/);
  assert.equal(t.s.post({ token: '', tg: { action: 'setup', url: 'https://example.com/x' } }).code, 'url');
  const ed = setup({ EDITOR_TOKEN: 'sec' }), setupReq = extra => ed.s.post({ tg: { action: 'setup', url: 'https://script.google.com/macros/s/AKfy-test_1/exec' }, ...extra });
  assert.equal(setupReq({ editor: '' }).code, 'editor'); assert.equal(setupReq({ editor: 'чужой' }).code, 'editor'); assert.equal(setupReq({ editor: 'sec' }).ok, true);
  // ссылка скрипта рабочего аккаунта Google
  assert.equal(t.s.post({ token: '', tg: { action: 'setup', url: 'https://script.google.com/a/macros/buraq.uz/s/AKfy1/exec' } }).ok, true);
});

test('группа стала супергруппой: бот запоминает её новый адрес и повторяет отправку', () => {
  const t = setup(); const r = connect(t);
  t.gmsg(900, '/ulash ' + r.tg.code);
  let migrated = false;
  t.s.props.TG_GROUP = String(t.group.id);
  const orig = t.s.ctx.UrlFetchApp.fetch;
  t.s.ctx.UrlFetchApp.fetch = (url, opts) => {
    const req = opts && opts.payload ? JSON.parse(opts.payload) : {};
    if (!migrated && /sendMessage$/.test(url) && String(req.chat_id) === String(t.group.id)) { migrated = true; return { getContentText: () => JSON.stringify({ ok: false, error_code: 400, description: 'group chat was upgraded to a supergroup chat', parameters: { migrate_to_chat_id: -1009999 } }) }; }
    return orig(url, opts);
  };
  register(t);
  assert.equal(t.s.props.TG_GROUP, '-1009999');
  assert.match(t.last('sendMessage', -1009999).text, /Новый водитель/);
});

test('обновление без секрета или с чужим — не обрабатывается; ответ Telegram — HtmlService (без переадресации)', () => {
  const t = setup(); connect(t); const n = t.tg.sent.length;
  const out = t.s.tgPost({ update_id: 1, message: { from: { id: 5 }, chat: { id: 5, type: 'private' }, text: '/start' } }, 'чужой');
  assert.deepEqual(out, { html: 'ok' }); assert.equal(t.tg.sent.length, n);
});

// регистрация (версия 31): своя машина — телефон, вид, госномер, марка, кузов, грузоподъёмность. Чтобы «Разрешить» в группе
// поставил водителя на машину автопарка с номером truckIdx, её госномер в автопарке — тот же, что пишет водитель
const TRUCKS = ['Gazel-1', 'Gazel-2', 'Gazel-3', 'Labo', 'Kamaz-1'];
const plateOf = idx => idx === 1 ? '01A 123 BC' : '01A ' + (150 + idx) + ' BC';
function register(t, id = 501, lang = 'ru', truckIdx = 1, name = 'Akmal Karimov') {
  const truck = TRUCKS[truckIdx], kind = truck.toLowerCase().replace(/-\d+$/, ''), set = t.s.book.sheets.Sozlamalar;
  set.maxCols = Math.max(set.maxCols, 13); set.set(24 + truckIdx, 4, plateOf(truckIdx));
  t.msg(id, '/start');
  t.cb(id, 'lang:' + lang);
  t.msg(id, name);
  t.msg(id, '+998 90 123 45 6' + (id % 10));
  t.cb(id, 'kind:' + kind);
  t.msg(id, truckIdx === 1 ? '01a 123-bc' : plateOf(truckIdx));
  t.msg(id, 'GAZelle Next');
  t.msg(id, '4.2 2.1 2.2');
  t.msg(id, '1500');
  t.cb(id, 'reg:send');
}

test('регистрация (версия 31): язык, имя, телефон кнопкой, своя машина — вид, госномер, марка, кузов, грузоподъёмность; заявка в группу; «Разрешить» — машина в автопарк', () => {
  const t = setup(); const r = connect(t);
  t.msg(501, '/start');
  assert.match(t.last('sendMessage', 501).text, /Tilni tanlang[\s\S]*Выберите язык/);
  t.cb(501, 'lang:ru');
  assert.match(t.last('sendMessage', 501).text, /имя и фамилию/);
  t.msg(501, '12');
  assert.match(t.last('sendMessage', 501).text, /буквами/);
  t.msg(501, 'Akmal Karimov');
  const ph = t.last('sendMessage', 501);
  assert.match(ph.text, /номер телефона/); assert.equal(ph.reply_markup.keyboard[0][0].request_contact, true);
  t.msg(501, undefined, { contact: { phone_number: '+998 90 000 00 01', user_id: 999 } });
  assert.match(t.last('sendMessage', 501).text, /свой номер/, 'чужой контакт — нет');
  t.msg(501, '123');
  assert.match(t.last('sendMessage', 501).text, /9–15 цифр/);
  t.msg(501, undefined, { contact: { phone_number: '998901234567', user_id: 501 } });
  const kinds = t.last('sendMessage', 501);
  assert.match(kinds.text, /Какая у вас машина/);
  assert.deepEqual(kinds.reply_markup.inline_keyboard.flat().map(b => b.callback_data), ['kind:gazel', 'kind:labo', 'kind:changan', 'kind:kamaz'], 'машины автопарка не предлагаются — своя');
  t.cb(501, 'kind:gazel');
  assert.match(t.last('sendMessage', 501).text, /госномер/);
  t.msg(501, '01a 777-xy');
  assert.match(t.last('sendMessage', 501).text, /марку и модель/);
  t.msg(501, 'GAZelle Next');
  assert.match(t.last('sendMessage', 501).text, /длина × ширина × высота/);
  t.msg(501, 'большой');
  assert.match(t.last('sendMessage', 501).text, /три числа/);
  t.msg(501, '420x210x220');
  assert.match(t.last('sendMessage', 501).text, /Грузоподъёмность/);
  t.msg(501, '50 000');
  assert.match(t.last('sendMessage', 501).text, /от 100 до 40 000/);
  t.msg(501, '1,5 т');
  assert.equal(t.last('sendMessage', 501).text, 'Проверьте:\n👤 Akmal Karimov\n📞 +998901234567\n🚚 Gazel · 01A 777 XY\n🏷 GAZelle Next\n📐 Кузов 4,2×2,1×2,2 м — 19,4 м³\n⚖️ 1 500 кг');
  t.cb(501, 'reg:send');
  assert.match(t.last('sendMessage', 501).text, /Заявка отправлена/);
  const d = t.s.book.sheets.Haydovchilar.rows[1];
  assert.deepEqual([d[0], d[1], d[2], d[3], d[4], d[5], d[10], d[11], d[12], d[13], d[14], d[15]], ['501', 'Akmal Karimov', '', '01A 777 XY', 'ru', 'kutilmoqda', '+998901234567', 'gazel', 'GAZelle Next', '4,2×2,1×2,2', 19.4, 1500]);
  assert.deepEqual(t.s.get({}).data.tg.drivers[0].car, { kind: 'gazel', plate: '01A 777 XY', model: 'GAZelle Next', body: '4,2×2,1×2,2', m3: 19.4, kg: 1500 }, 'сайту — машина из заявки');
  // группа: неверный код, верный код — привязка и заявка с машиной и кнопками
  t.gmsg(900, '/ulash 000000');
  assert.match(t.last('sendMessage', t.group.id).text, /Код не подходит/);
  t.gmsg(900, '/ulash@buraq_test_bot ' + r.tg.code);
  assert.equal(t.s.props.TG_GROUP, String(t.group.id));
  const ask = t.last('sendMessage', t.group.id);
  assert.match(ask.text, /Новый водитель: Akmal Karimov\n📞 \+998901234567\n🚚 Gazel · 01A 777 XY · GAZelle Next\n📐 4,2×2,1×2,2 м — 19,4 м³ · ⚖️ 1 500 кг\nTelegram: @akmal/);
  assert.deepEqual(ask.reply_markup.inline_keyboard[0].map(b => b.callback_data), ['allow:501', 'deny:501']);
  // пока нет разрешения — бот ничего не показывает
  t.msg(501, '🚚 Начать работу');
  assert.match(t.last('sendMessage', 501).text, /на рассмотрении/);
  // не администратор группы
  t.cb(777, 'allow:501', t.group);
  assert.equal(t.last('answerCallbackQuery').show_alert, true);
  assert.equal(t.s.book.sheets.Haydovchilar.rows[1][5], 'kutilmoqda');
  // «Разрешить»: свободная Gazel без госномера (Gazel-1) — машина водителя: госномер, марка, объём, вес, кузов
  t.cb(900, 'allow:501', t.group, { message_id: 55, text: ask.text, chat: t.group });
  assert.equal(t.s.book.sheets.Haydovchilar.rows[1][5], 'ruxsat');
  assert.equal(t.s.book.sheets.Haydovchilar.rows[1][2], 'Gazel-1');
  const set = t.s.book.sheets.Sozlamalar.rows;
  assert.deepEqual(set[23].slice(2, 13), ['Gazel-1', '01A 777 XY', '', 'GAZelle Next', '', 19.4, 1500, '', 4.2, 2.1, 2.2]);
  assert.deepEqual([set[22][3], set[22][4], set[22][10], set[22][12]], ['Davlat raqami', 'Holati', 'Uzunlik, m', 'Balandlik, m']);
  assert.match(t.last('sendMessage', 501).text, /Доступ открыт/);
  assert.deepEqual(t.last('sendMessage', 501).reply_markup.keyboard, [['🚚 Начать работу', '📍 Текущая точка'], ['🏁 Закончить работу', '🌐 Язык'], ['⚠️ Проблема']]);
  assert.match(t.last('editMessageText').text, /✅ Разрешено — Boss, [\d.: ]+\n🚚 В автопарке: Gazel-1$/);
  // выгрузка для сайта — Sozlamalar до M (кузов)
  assert.equal(t.s.get({}).data.sheets.Sozlamalar[23].length, 13);
});

// версия 31: «Разрешить» на сайте — руководитель проверил машину из заявки (мог поправить) и выбрал: новая или машина автопарка
test('версия 31: «Разрешить» с сайта — машина из заявки с правками: новая в автопарк или выбранная; ошибка — доступ не открыт', () => {
  const t = setup(); const r = connect(t); t.gmsg(900, '/ulash ' + r.tg.code);
  const reg = (id, name, kind, plate) => { t.msg(id, '/start'); t.cb(id, 'lang:ru'); t.msg(id, name); t.msg(id, '+998 90 123 45 6' + (id % 10)); t.cb(id, 'kind:' + kind); t.msg(id, plate); t.msg(id, 'Isuzu'); t.msg(id, '4.2 2.1 2.2'); t.msg(id, '1500'); t.cb(id, 'reg:send'); };
  reg(501, 'Akmal Karimov', 'labo', '01b 555 kk'); reg(502, 'Bobur Aliev', 'gazel', '01 C 777 DD');
  const set = t.s.book.sheets.Sozlamalar, drv = id => t.s.get({}).data.tg.drivers.find(d => d.id === id);
  set.set(67, 2, 1);
  // нет такой машины или она в ремонте — статус прежний, в автопарке ничего не меняется
  set.maxCols = Math.max(set.maxCols, 5); set.set(23, 5, 'Holati'); set.set(24, 5, 'ta’mirda');
  const before = JSON.stringify(set.rows);
  assert.match(t.s.post({ tg: { action: 'driver', id: '501', status: 'ruxsat', car: { to: 'Labo-9', kind: 'labo' } } }).error, /Нет машины «Labo-9»/);
  assert.match(t.s.post({ tg: { action: 'driver', id: '502', status: 'ruxsat', car: { to: 'Gazel-1', kind: 'gazel' } } }).error, /Машина «Gazel-1» в ремонте/);
  assert.equal(drv('501').status, 'kutilmoqda'); assert.equal(drv('502').status, 'kutilmoqda'); assert.equal(JSON.stringify(set.rows), before);
  set.set(24, 5, '');
  // новая машина с правками руководителя; счётчик Labo в настройках — по автопарку
  const a = t.s.post({ tg: { action: 'driver', id: '501', status: 'ruxsat', car: { toNew: true, kind: 'labo', plate: '01b 555 kk', model: 'Damas Labo', l: 2.4, w: 1.4, h: 1.3, m3: 4.4, kg: 550 } } });
  assert.deepEqual([a.ok, a.truck, a.isNew, a.freed], [true, 'Labo-2', true, []], JSON.stringify(a));
  const row = set.rows.findIndex(x => x[2] === 'Labo-2');
  assert.equal(row, 30, 'первая пустая строка автопарка — после «Mijoz ozi oladi» и «Belgilanmagan»');
  assert.deepEqual(set.rows[row].slice(2, 13), ['Labo-2', '01B 555 KK', '', 'Damas Labo', '', 4.4, 550, '', 2.4, 1.4, 1.3]);
  assert.equal(set.rows[66][1], 2, 'Labo в автопарке — 2');
  assert.deepEqual([drv('501').truck, drv('501').status], ['Labo-2', 'ruxsat']);
  assert.equal(a.tg.drivers.find(d => d.id === '501').truck, 'Labo-2', 'ответ — свежий список водителей');
  assert.ok(t.texts(501).some(x => /Доступ открыт/.test(x)));
  // машина автопарка: госномер, марка, кузов и вес — из заявки; повторное «Разрешить» машину не трогает
  const b = t.s.post({ tg: { action: 'driver', id: '502', status: 'ruxsat', car: { to: 'Gazel-3', kind: 'gazel' } } });
  assert.deepEqual([b.ok, b.truck, b.isNew], [true, 'Gazel-3', false], JSON.stringify(b));
  assert.deepEqual(set.rows[25].slice(2, 4).concat(set.rows[25].slice(5, 13)), ['Gazel-3', '01 C 777 DD', 'Isuzu', '', 19.4, 1500, '', 4.2, 2.1, 2.2]);
  const k = JSON.stringify(set.rows);
  assert.equal(t.s.post({ tg: { action: 'driver', id: '502', status: 'ruxsat', car: { toNew: true, kind: 'gazel' } } }).ok, true);
  assert.equal(JSON.stringify(set.rows), k); assert.equal(drv('502').truck, 'Gazel-3');
  // «Разрешить» в группе: машина с тем же госномером в ремонте — не берётся, водителю свободная Gazel без госномера
  reg(503, 'Sanjar Toshev', 'gazel', '01 A 111 AA');
  set.set(24, 4, '01 A 111 AA'); set.set(24, 5, 'ta’mirda');
  t.cb(900, 'allow:503', t.group, { message_id: 56, text: 'x', chat: t.group });
  assert.deepEqual([drv('503').truck, drv('503').status], ['Gazel-2', 'ruxsat']);
  assert.match(t.last('editMessageText').text, /🚚 В автопарке: Gazel-2$/);
  assert.deepEqual([set.rows[23][3], set.rows[24][3]], ['01 A 111 AA', '01 A 111 AA'], 'госномер записан в Gazel-2, у Gazel-1 прежний');
});

test('повтор того же update_id не обрабатывается дважды', () => {
  const t = setup(); connect(t);
  const u = { update_id: 42, message: { from: { id: 7 }, chat: { id: 7, type: 'private' }, text: '/start' } };
  t.s.tgPost(u); const n = t.tg.sent.length; t.s.tgPost(u);
  assert.equal(t.tg.sent.length, n);
});

function approved(props) {
  const t = setup(props); const r = connect(t);
  t.gmsg(900, '/ulash ' + r.tg.code);
  register(t);
  t.cb(900, 'allow:501', t.group);
  return t;
}

test('рабочий день: геолокация → ближайшая точка рейса 1 (части одной отгрузки — одна точка), фото → геолокация → «Yetkazildi», Диск, «Yetkazish», отчёт в группу', () => {
  const t = approved(), g = t.group.id;
  t.msg(501, '🚚 Начать работу');
  assert.match(t.last('sendMessage', 501).text, /отправьте геолокацию/);
  assert.equal(t.last('sendMessage', 501).reply_markup.keyboard[0][0].request_location, true);
  t.loc(501, DEPOT);
  assert.match(t.last('sendMessage', g).text, /Akmal Karimov \(Gazel-2\) начал работу в 09:00 · точек: 3/);
  const day = t.s.book.sheets['Ish kuni'].rows[1];
  assert.deepEqual([day[0], day[2], day[3], day[4]], [TODAY, 'Gazel-2', '09:00', DEPOT.join(',')]);
  // первая точка — ближайшая к складу: BL-901 (две строки журнала — одна точка, груз сложен)
  const card = t.tg.sent.filter(x => x.method === 'sendMessage' && x.chat_id === '501').map(x => x.text).find(x => /Точка/.test(x));
  assert.match(card, /📦 Точка 1 из 2 · рейс 1/); assert.match(card, /🏷 BL-901 · NOVA — Aziz/); assert.match(card, /📍 Куда: Chilonzor, Bunyodkor 1/);
  assert.match(card, /👤 Получатель: Aziz · \+998900000001/); assert.match(card, /📦 12 мест · 1,5 м³ · 250 кг/);
  assert.deepEqual([t.last('sendLocation', 501).latitude, t.last('sendLocation', 501).longitude], [41.31, 69.21]);
  // «Доставлено»: без фото нельзя
  t.cb(501, 'ok:BL-901|1');
  assert.match(t.last('sendMessage', 501).text, /Отправьте фото/);
  t.msg(501, '✅ Готово');
  assert.match(t.last('sendMessage', 501).text, /Сначала сделайте фото/);
  t.photo(501, 'PH1'); t.photo(501, 'PH2');
  assert.match(t.last('sendMessage', 501).text, /Фото принято \(2\)/);
  t.msg(501, '✅ Готово');
  assert.match(t.last('sendMessage', 501).text, /Отправьте геолокацию/);
  t.msg(501, 'привет');
  assert.match(t.last('sendMessage', 501).text, /Отправить геолокацию/);
  t.loc(501, [41.311, 69.211]);
  assert.deepEqual(t.status('BL-901'), ['Yetkazildi', 'Yetkazildi']);
  assert.deepEqual(t.s.files.map(f => f.name), ['2026-09-26 Gazel-2 BL-901 1.jpg', '2026-09-26 Gazel-2 BL-901 2.jpg']);
  const log = t.s.book.sheets.Yetkazish.rows[1];
  assert.deepEqual([log[1], log[2], log[3], log[4], log[5], log[6]], [TODAY, 'Akmal Karimov', 'Gazel-2', 'BL-901', 'NOVA — Aziz', 'Yetkazildi']);
  assert.match(log[8], /drive\.google\.com\/file\/d\/file1 https:\/\/drive\.google\.com\/file\/d\/file2/); assert.equal(log[9], '41.311,69.211');
  const album = t.last('sendMediaGroup', g);
  assert.deepEqual(album.media.map(m => m.media), ['PH1', 'PH2']);
  assert.match(album.media[0].caption, /✅ Gazel-2 · Akmal Karimov — доставлено: BL-901 NOVA — Aziz\n09:00 · 📍 https:\/\/maps\.google\.com\/\?q=41\.311,69\.211/);
  // следующая точка — BL-902 (последняя в рейсе 1)
  assert.match(t.texts(501).filter(x => /Точка/.test(x)).pop(), /Точка 2 из 2 · рейс 1[\s\S]*BL-902[\s\S]*Получатель: Omon[\s\S]*☎️ Тел: \+998900000002[\s\S]*Примечание: осторожно, стекло/);
  // старая кнопка — одним сообщением: «устарела» над текущей карточкой (версия 18; раньше — отдельное сообщение)
  const nOld = t.texts(501).length;
  t.cb(501, 'ok:BL-901|1');
  const st = t.texts(501).slice(nOld);
  assert.equal(st.length, 1); assert.match(st[0], /^Эта кнопка устарела — вот текущая точка:\n\n📦 Точка 2 из 2 · рейс 1/);
});

test('«Не доставлено»: причина, фото места (обязательно), геолокация → «Qolib ketgan», отчёт с причиной; конец рейса 1 → рейс 2 со склада', () => {
  const t = approved(), g = t.group.id;
  t.msg(501, '🚚 Начать работу'); t.loc(501, DEPOT);
  t.cb(501, 'ok:BL-901|1'); t.photo(501, 'P'); t.msg(501, '✅ Готово'); t.loc(501, [41.31, 69.21]);
  t.cb(501, 'fail:BL-902|1');
  assert.deepEqual(t.last('sendMessage', 501).reply_markup.inline_keyboard.map(r => r[0].text), ['Клиента нет на месте', 'Не отвечает на телефон', 'Отказался от груза', 'Другая причина']);
  t.cb(501, 'why:0');
  assert.match(t.last('sendMessage', 501).text, /Отправьте фото места/);
  t.msg(501, '✅ Готово');
  assert.match(t.last('sendMessage', 501).text, /Сначала сделайте фото/, 'фото обязательно и при «не доставлено»');
  t.photo(501, 'F'); t.msg(501, '✅ Готово');
  t.loc(501, [41.36, 69.28]);
  assert.deepEqual(t.status('BL-902'), ['Qolib ketgan']);
  assert.match(t.last('sendPhoto', g).caption, /❌ Gazel-2 · Akmal Karimov — не доставлено: BL-902 Botir\nПричина: Клиента нет на месте/);
  const round = t.last('sendMessage', 501);
  assert.match(round.text, /Рейс 1 закончен/); assert.equal(round.reply_markup.inline_keyboard[0][0].callback_data, 'round:2');
  t.cb(501, 'round:2');
  assert.match(t.texts(501).filter(x => /Точка/.test(x)).pop(), /Точка 1 из 1 · рейс 2[\s\S]*BL-903 · STAR — Dilshod/);
  // «другая причина» — текстом
  const u = approved();
  u.msg(501, '🚚 Начать работу'); u.loc(501, DEPOT); u.cb(501, 'fail:BL-901|1'); u.cb(501, 'why:3');
  assert.match(u.last('sendMessage', 501).text, /Коротко напишите причину/);
  u.msg(501, 'ворота закрыты'); u.photo(501, 'F'); u.msg(501, '✅ Готово'); u.loc(501, DEPOT);
  assert.match(u.last('sendPhoto', u.group.id).caption, /Причина: ворота закрыты/);
});

test('правки на сайте: статус от бота не затирается старым значением сайта; водителю — «рейсы изменились» и новая текущая точка', () => {
  const t = approved();
  t.msg(501, '🚚 Начать работу'); t.loc(501, DEPOT);
  t.cb(501, 'ok:BL-901|1'); t.photo(501, 'P'); t.msg(501, '✅ Готово'); t.loc(501, [41.31, 69.21]);
  // сайт не знает о доставке: шлёт статус «Rejada», но меняет только примечание — статус в таблице остаётся
  const was = { date: TODAY, bl: 'BL-901', cbm: 1.2, kg: 200, places: 10, truck: 'Gazel-2', route: 1, status: 'Rejada', note: '' };
  t.s.post({ token: '', ops: [{ t: 'ship.upsert', row: 5, guard: { bl: 'BL-901', date: TODAY }, was, v: { ...was, note: 'позвонить заранее' } }] });
  assert.equal(t.s.book.sheets.Yuborishlar.rows[4][14], 'Yetkazildi'); assert.equal(t.s.book.sheets.Yuborishlar.rows[4][15], 'позвонить заранее');
  // старый сайт (без was) пишет всё, как раньше
  t.s.post({ token: '', ops: [{ t: 'ship.upsert', row: 8, guard: { bl: 'BL-903', date: TODAY }, v: { date: TODAY, bl: 'BL-903', cbm: 4, kg: 900, places: 30, truck: 'Gazel-2', route: 2, status: 'Rejada', note: 'x' } }] });
  assert.equal(t.s.book.sheets.Yuborishlar.rows[7][15], 'x');
  // текущую точку BL-902 перевели на другую машину — водителю сообщение и конец рейса 1
  const n = t.texts(501).length;
  const w2 = { date: TODAY, bl: 'BL-902', cbm: 2, kg: 300, places: 12, truck: 'Gazel-2', route: 1, status: 'Rejada', note: 'осторожно, стекло' };
  t.s.post({ token: '', ops: [{ t: 'ship.upsert', row: 6, guard: { bl: 'BL-902', date: TODAY }, was: w2, v: { ...w2, truck: 'Gazel-3' } }] });
  const after = t.texts(501).slice(n);
  // одним сообщением (версия 18): «рейсы изменились» над «Рейс 1 закончен»
  assert.equal(after.length, 1); assert.match(after[0], /рейсы на сегодня изменились\.\n\n[\s\S]*Рейс 1 закончен/);
  // правки не про отгрузки — водителям ничего
  const m = t.tg.sent.length; t.s.post({ token: '', ops: [{ t: 'set', v: { speed: 30 } }] }); assert.equal(t.tg.sent.length, m);
});

test('дата с неполным годом («0001-01-01») не пишется в таблицу — иначе строка стала бы 1900 годом и пропала с сайта', () => {
  const t = setup(); const n = t.s.book.sheets.Yuborishlar.rows.length;
  const r = t.s.post({ token: '', ops: [{ t: 'ship.upsert', v: { date: '0001-01-01', bl: 'BL-908', cbm: 1, kg: 1, places: 1, truck: 'Belgilanmagan', route: '', status: 'Rejada', note: '' } }] });
  assert.equal(r.results[0].error, 'bad date'); assert.equal(t.s.book.sheets.Yuborishlar.rows.length, n);
  const ok = t.s.post({ token: '', ops: [{ t: 'ship.upsert', v: { date: '2026-09-26', bl: 'BL-908', cbm: 1, kg: 1, places: 1, truck: 'Belgilanmagan', route: '', status: 'Rejada', note: '' } }] });
  assert.equal(ok.results[0].row, n + 1);
});

test('конец дня: геолокация → «Ish kuni» (конец, итоги), итог водителю и в группу; выгрузка для сайта — водители без состояния диалога', () => {
  const t = approved(), g = t.group.id;
  t.msg(501, '🏁 Закончить работу');
  assert.match(t.last('sendMessage', 501).text, /Сначала нажмите/);
  t.msg(501, '🚚 Начать работу'); t.loc(501, DEPOT);
  t.cb(501, 'ok:BL-901|1'); t.photo(501, 'P'); t.msg(501, '✅ Готово'); t.loc(501, [41.31, 69.21]);
  t.now.value = new Date(Date.UTC(2026, 8, 26, 13, 30));   // 18:30
  t.msg(501, '🏁 Закончить работу'); t.loc(501, DEPOT);
  const day = t.s.book.sheets['Ish kuni'].rows[1];
  assert.deepEqual([day[5], day[6], day[7], day[8]], ['18:30', DEPOT.join(','), 1, 0]);
  assert.match(t.last('sendMessage', 501).text, /Доставлено: 1, не доставлено: 0, осталось: 2/);
  assert.match(t.last('sendMessage', g).text, /Akmal Karimov \(Gazel-2\) закончил работу в 18:30: доставлено 1, не доставлено 0, осталось 2/);
  const info = t.s.get({}).data.tg;
  assert.equal(info.bot, 'buraq_test_bot'); assert.equal(info.grouped, true); assert.equal(info.group, 'BURAQ — доставки');
  assert.equal(info.drivers.length, 1); assert.deepEqual(info.drivers[0].today, { started: '09:00', ended: '18:30', ok: 1, fail: 0, pos: DEPOT, posAt: '18:30', date: TODAY, cur: { bl: 'BL-902', round: 1 } });
  assert.equal(info.log.length, 1); assert.equal(info.log[0].bl, 'BL-901'); assert.equal(info.log[0].ok, true); assert.equal(info.log[0].photos.length, 1);
  assert.deepEqual([info.days[0].day, info.days[0].start, info.days[0].end, info.days[0].ok, info.days[0].date], [TODAY, '09:00', '18:30', 1, TODAY]);
  assert.equal(info.drivers[0].st, undefined);
  // отметки: по умолчанию за 2 дня (опрос каждые 30 с), вкладка «Водители» просит до 45
  t.s.book.sheets.Yetkazish.rows.push(['2026-09-16 10:00', '2026-09-16', 'Akmal Karimov', 'Gazel-2', 'BL-800', 'Old', 'Yetkazildi', '', '', '', '501', 1]);
  assert.deepEqual([info.span, info.log.length], [2, 1]);
  const all = t.s.get({ tgdays: '45' }).data.tg;
  assert.deepEqual([all.span, all.log.map(x => x.bl).sort().join(',')], [45, 'BL-800,BL-901']);
  assert.equal(t.s.get({ tgdays: '999' }).data.tg.span, 45, 'не больше 45');
});

test('сайт отключает водителя: бот ему больше ничего не показывает; язык переключается кнопкой', () => {
  const t = approved();
  t.msg(501, '🌐 Язык');
  assert.match(t.last('sendMessage', 501).text, /Til: o‘zbekcha/);
  assert.equal(t.last('sendMessage', 501).reply_markup.keyboard[0][0], '🚚 Ishni boshlash');
  const r = t.s.post({ token: '', tg: { action: 'driver', id: '501', status: 'o‘chirilgan' } });
  assert.equal(r.ok, true); assert.equal(r.tg.drivers[0].status, 'o‘chirilgan');
  assert.match(t.last('sendMessage', 501).text, /ruxsati yo‘q/);
  t.msg(501, '🚚 Ishni boshlash');
  assert.match(t.last('sendMessage', 501).text, /ruxsati yo‘q/);
});

// автопарк с госномерами: Sozlamalar D24:D39
function withPlates(t) { const sh = t.s.book.sheets.Sozlamalar; sh.maxCols = Math.max(sh.maxCols, 4); sh.set(25, 4, '01 A 222 BB'); return t; }

test('госномер: «Разрешить» по тому же госномеру ставит на ту же машину; «plates» с сайта пишет столбец D; список — вместе с номерами и кузовом', () => {
  const t = withPlates(setup()); const c = connect(t);
  t.gmsg(900, '/ulash ' + c.tg.code);
  t.msg(501, '/start'); t.cb(501, 'lang:ru'); t.msg(501, 'Akmal Karimov'); t.msg(501, '901234567');
  t.cb(501, 'kind:gazel'); t.msg(501, '01 a 222 bb'); t.msg(501, 'Gazel Business'); t.msg(501, '3 2 1.9'); t.msg(501, '1500');
  assert.match(t.last('sendMessage', 501).text, /📞 \+998901234567\n🚚 Gazel · 01 A 222 BB/, '9 цифр — с кодом страны');
  t.cb(501, 'reg:send');
  t.cb(900, 'allow:501', t.group);
  assert.equal(t.s.book.sheets.Haydovchilar.rows[1][2], 'Gazel-2', 'тот же госномер — та же машина');
  assert.deepEqual(t.s.book.sheets.Sozlamalar.rows[24].slice(2, 13), ['Gazel-2', '01 A 222 BB', '', 'Gazel Business', '', 11.4, 1500, '', 3, 2, 1.9]);
  const r = t.s.post({ token: '', ops: [{ t: 'plates', v: { 'Gazel-1': '01 A 111 AA', 'Kamaz-1': '01 K 555 KK' } }] });
  assert.equal(r.results[0].ok, true);
  const set = t.s.book.sheets.Sozlamalar.rows;
  assert.deepEqual([set[23][3], set[24][3], set[27][3], set[22][3]], ['01 A 111 AA', '', '01 K 555 KK', 'Davlat raqami']);
  assert.equal(t.s.get({}).data.sheets.Sozlamalar[23].length, 13, 'выгрузка — до M (кузов)');
  // список машин поменялся (Gazel-1 убрали, Kamaz-3 добавили) — номера остаются у своих машин
  const names = set.slice(23, 39).map(r => r[2]).filter(Boolean), next = names.filter(n => n !== 'Gazel-1').concat(['Kamaz-3']);
  assert.equal(t.s.post({ token: '', ops: [{ t: 'trucks', v: next }] }).results[0].ok, true);
  const now = Object.fromEntries(set.slice(23, 39).filter(r => r[2]).map(r => [r[2], r[3] || '']));
  assert.deepEqual([now['Gazel-1'], now['Gazel-2'], now['Kamaz-1'], now['Kamaz-3']], [undefined, '', '01 K 555 KK', '']);
  const g2 = set.slice(23, 39).find(r => r[2] === 'Gazel-2');
  assert.deepEqual([g2[5], g2[7], g2[10], g2[11], g2[12]], ['Gazel Business', 11.4, 3, 2, 1.9], 'марка, объём и кузов переехали вместе с Gazel-2');
  assert.equal(set[26][2] + ' ' + set[26][3], 'Kamaz-1 01 K 555 KK', 'Kamaz-1 сдвинулась вверх вместе с номером');
});

test('«Отправить» партию с сайта: задание — число точек и рейсов, без списка; «Начать работу» — точки этой партии, даже если дата не сегодня', () => {
  const t = approved(), g = t.group.id;
  // партия вчерашняя (25.09): переносим отгрузки Gazel-2 на 25.09
  t.s.book.sheets.Yuborishlar.rows.forEach(r => { if (r[12] === 'Gazel-2' && r[2] !== 'BL-905') r[0] = day(2026, 9, 25); });
  const r = t.s.post({ token: '', tg: { action: 'dispatch', date: '2026-09-25' } });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.sent.map(x => [x.truck, x.n]), [['Gazel-2', 4]]);
  assert.deepEqual(r.skipped, []);
  const a = t.last('sendMessage', 501).text;
  // версия 20: только число точек и рейсов — адрес и телефон следующей точки водитель видит только после фото предыдущей
  assert.equal(a, '📋 Задание: партия 25.09.2026\n🚚 Gazel-2 · точек: 4 · рейсов: 2\n\nЧтобы начать, нажмите «🚚 Начать работу» — бот пришлёт первую точку. Следующая придёт только после фото доставки.');
  assert.doesNotMatch(a, /BL-9|NOVA|Chilonzor/, 'списка точек нет');
  assert.equal(r.tg.drivers[0].assign.date, '2026-09-25');
  t.msg(501, '🚚 Начать работу'); t.loc(501, DEPOT);
  assert.match(t.last('sendMessage', g).text, /партия 25\.09\.2026 · точек: 4/);
  assert.match(t.texts(501).filter(x => /Точка/.test(x)).pop(), /BL-901/);
  const dayRow = t.s.book.sheets['Ish kuni'].rows[1];
  assert.deepEqual([dayRow[0], dayRow[10]], [TODAY, '2026-09-25']);
  // водитель уже работает — новое задание сразу меняет партию и присылает первую точку
  t.s.book.sheets.Yuborishlar.rows.forEach(r => { if (r[2] === 'BL-904') r[12] = 'Gazel-2'; });
  const r2 = t.s.post({ token: '', tg: { action: 'dispatch', date: TODAY, ids: ['501'] } });
  assert.deepEqual(r2.sent.map(x => x.n), [1]);
  // одним сообщением с карточкой первой точки (версия 18; раньше — «Новое задание» отдельно)
  const last1 = t.texts(501).filter(x => /Новое задание/.test(x)).pop();
  assert.match(last1, /^📋 Новое задание: партия 26\.09\.2026 — точек: 1\. Первая точка ниже 👇\n\n📦 Точка 1 из 1 · рейс 1\n\n🏷 BL-904\n📍 Куда: адрес не указан\n📦 5 мест/);
  // партия без водителя в боте — в пропущенных
  const r3 = t.s.post({ token: '', tg: { action: 'dispatch', date: '2026-09-25' } });
  assert.ok(r3.skipped.some(x => x.truck === 'Gazel-2' && x.why === 'нет точек') || r3.sent.length === 1);
});

test('«Отправить всем»: машины с точками, но без водителя в боте — в ответе сайту', () => {
  const t = approved();
  const r = t.s.post({ token: '', tg: { action: 'dispatch', date: TODAY } });
  assert.deepEqual(r.sent.map(x => x.truck), ['Gazel-2']); assert.deepEqual(r.skipped, [{ truck: 'Gazel-3', why: 'нет водителя в боте' }]);
  assert.equal(t.s.post({ token: '', tg: { action: 'dispatch', date: '26.09.2026' } }).error, 'Выберите партию');
});

test('задание изменилось на сайте до начала работы — водителю новый список', () => {
  const t = approved();
  t.s.post({ token: '', tg: { action: 'dispatch', date: TODAY } });
  const n = t.texts(501).length;
  const w2 = { date: TODAY, bl: 'BL-902', cbm: 2, kg: 300, places: 12, truck: 'Gazel-2', route: 1, status: 'Rejada', note: 'осторожно, стекло' };
  t.s.post({ token: '', ops: [{ t: 'ship.upsert', row: 6, guard: { bl: 'BL-902', date: TODAY }, was: w2, v: { ...w2, truck: 'Gazel-3' } }] });
  const m = t.texts(501).slice(n);
  assert.equal(m.length, 1); assert.match(m[0], /Задание изменилось\.\n\n📋 Задание: партия 26\.09\.2026\n🚚 Gazel-2 · точек: 2/);
});

test('«Написать водителю»: выбранным и всем на линии', () => {
  const t = approved();
  assert.equal(t.s.post({ token: '', tg: { action: 'message', ids: ['501'], text: 'Позвоните в офис' } }).sent, 1);
  assert.match(t.last('sendMessage', 501).text, /Сообщение от руководителя:\nПозвоните в офис/);
  assert.equal(t.s.post({ token: '', tg: { action: 'message', ids: 'online', text: 'x' } }).sent, 0, 'никто не на линии');
  t.msg(501, '🚚 Начать работу'); t.loc(501, DEPOT);
  assert.equal(t.s.post({ token: '', tg: { action: 'message', ids: 'online', text: 'Обед до 14:00' } }).sent, 1);
  assert.equal(t.s.post({ token: '', tg: { action: 'message', ids: ['501'], text: '  ' } }).error, 'Пустое сообщение');
});

test('итог дня в группу: по машинам — доставлено, не доставлено, осталось, время; по кнопке и по расписанию', () => {
  const t = approved(), g = t.group.id;
  assert.match(t.s.post({ token: '', tg: { action: 'summary' } }).error, /ещё не работали/);
  t.msg(501, '🚚 Начать работу'); t.loc(501, DEPOT);
  t.cb(501, 'ok:BL-901|1'); t.photo(501, 'P'); t.msg(501, '✅ Готово'); t.loc(501, [41.31, 69.21]);
  t.cb(501, 'fail:BL-902|1'); t.cb(501, 'why:0'); t.photo(501, 'F'); t.msg(501, '✅ Готово'); t.loc(501, DEPOT);
  const r = t.s.post({ token: '', tg: { action: 'summary' } });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(r.text, /Итог дня 26\.09\.2026\n\n🚚 Gazel-2 · Akmal Karimov: доставлено 1, не доставлено 1, осталось 1 \(09:00–не закончил\)\n\nВсего: доставлено 1, не доставлено 1, осталось 1/);
  assert.equal(t.last('sendMessage', g).text, r.text);
  const n = t.tg.sent.length; t.s.ctx.tgDailySummary(); assert.equal(t.tg.sent.length, n + 1);
});

test('«Не отвечает на телефон»: водителю меню (диспетчер, номера клиента, клиент ответил, всё равно не доставлено), в группу — тревога с номерами', () => {
  const t = approved(), g = t.group.id;
  // номер диспетчера — с сайта; неверный номер не принимается
  assert.match(t.s.post({ token: '', tg: { action: 'dispatcher', phone: '12-34', name: 'Jasur' } }).error, /9–15 цифр/);
  const r = t.s.post({ token: '', tg: { action: 'dispatcher', phone: '998 77 017 66 11', name: 'Jasur' } });
  assert.equal(r.ok, true); assert.deepEqual(r.tg.dispatcher, { name: 'Jasur', phone: '+998770176611' });
  t.msg(501, '🚚 Начать работу'); t.loc(501, DEPOT);
  const kb = [...t.tg.sent].reverse().find(x => String(x.chat_id) === '501' && x.reply_markup && x.reply_markup.keyboard && JSON.stringify(x.reply_markup.keyboard).includes('Начать работу'));
  assert.deepEqual(kb.reply_markup.keyboard.slice(-1)[0], ['⚠️ Проблема', '📞 Диспетчер'], 'кнопка «Диспетчер» в меню');
  t.cb(501, 'fail:BL-901|1'); t.cb(501, 'why:1');
  const menu = t.last('sendMessage', 501);
  assert.match(menu.text, /Клиент не отвечает на телефон[\s\S]*Диспетчеру отправлено сообщение/);
  assert.deepEqual(menu.reply_markup.inline_keyboard.map(x => x[0].callback_data), ['na:call', 'na:tel', 'wait:BL-901|1', 'na:ok', 'na:fail']);
  assert.match(t.last('sendMessage', g).text, /📵 Gazel-2 · Akmal Karimov: клиент BL-901 NOVA — Aziz не отвечает на телефон\.\n☎️ \+998900000001 \(Aziz\)\n📍 Chilonzor, Bunyodkor 1\nПозвоните клиенту/);
  t.cb(501, 'na:call');
  const c = t.last('sendContact', 501);
  assert.deepEqual([c.phone_number, c.first_name], ['+998770176611', 'Jasur']);
  assert.match(t.last('sendMessage', 501).text, /Диспетчер: Jasur\n\+998770176611/);
  t.cb(501, 'na:tel');
  assert.match(t.last('sendMessage', 501).text, /Номера BL-901:\n\+998900000001 — Aziz/);
  // клиент ответил — обычная доставка с фото
  t.cb(501, 'na:ok');
  assert.match(t.last('sendMessage', 501).text, /Отправьте фото/);
  assert.match(t.last('sendMessage', g).text, /клиент BL-901 ответил/);
  t.photo(501, 'P'); t.msg(501, '✅ Готово'); t.loc(501, [41.31, 69.21]);
  assert.deepEqual(t.status('BL-901'), ['Yetkazildi', 'Yetkazildi']);
  // следующая точка: не ответил — «всё равно не доставлено», причина в журнале доставок
  t.cb(501, 'fail:BL-902|1'); t.cb(501, 'why:1'); t.cb(501, 'na:fail');
  assert.match(t.last('sendMessage', 501).text, /Отправьте фото места/);
  t.photo(501, 'F'); t.msg(501, '✅ Готово'); t.loc(501, [41.36, 69.28]);
  assert.deepEqual(t.status('BL-902'), ['Qolib ketgan']);
  const log = t.s.book.sheets.Yetkazish.rows.slice(1).map(x => [x[4], x[6], x[7]]);
  assert.deepEqual(log, [['BL-901', 'Yetkazildi', ''], ['BL-902', 'Yetkazilmadi', 'Не отвечает на телефон']]);
  // старая кнопка меню после выбора — «устарела»
  t.cb(501, 'na:call');
  assert.match(t.texts(501).slice(-2).join(' '), /устарела/);
  // кнопка «Диспетчер» в любой момент; без номера — подсказка
  t.msg(501, '📞 Диспетчер');
  assert.equal(t.last('sendContact', 501).phone_number, '+998770176611');
  t.s.post({ token: '', tg: { action: 'dispatcher', phone: '', name: '' } });
  t.msg(501, '/dispetcher');
  assert.match(t.last('sendMessage', 501).text, /Номер диспетчера ещё не указан/);
  assert.equal(t.s.get({}).data.tg.dispatcher.phone, '');
});

// подпись мини-приложения, как у Telegram: HMAC-SHA256 с ключом из токена бота
function initData(user, { token = '123:ABC', at = Date.UTC(2026, 8, 26, 4, 0) / 1000 } = {}) {
  const f = { auth_date: String(at), query_id: 'AAQ1', user: JSON.stringify(user) };
  const dcs = Object.keys(f).sort().map(k => k + '=' + f[k]).join('\n');
  const hash = createHmac('sha256', createHmac('sha256', 'WebAppData').update(token).digest()).update(dcs).digest('hex');
  return Object.entries({ ...f, hash }).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
}
const JPEG = Buffer.from('ffd8ffe000104a464946', 'hex').toString('base64');

test('фото только с камеры: кнопка открывает driver.html, фото из чата не принимается, снимок по подписи Telegram, место — со снимка, далеко от клиента — отметка', () => {
  const t = approved(), g = t.group.id;
  t.s.post({ token: '', site: 'https://buraq.example/xeeds/', tg: { action: 'status' } });
  assert.equal(t.s.props.TG_SITE, 'https://buraq.example/xeeds/');
  t.msg(501, '🚚 Начать работу'); t.loc(501, DEPOT);
  t.cb(501, 'ok:BL-901|1');
  const ask = t.last('sendMessage', 501), cam = ask.reply_markup.inline_keyboard[0][0];
  assert.equal(ask.text, '📷 Сфотографируйте груз 👇');
  assert.deepEqual(ask.reply_markup.inline_keyboard.map(r => r.map(b => b.text)), [['📷 Сфотографировать'], ['↩️ Отмена']], 'сначала — только камера и отмена');
  assert.equal(cam.web_app.url, 'https://buraq.example/xeeds/driver.html?s=' + encodeURIComponent('https://script.google.com/macros/s/AKfy-test_1/exec') + '&k=BL-901%7C1&bl=BL-901&l=ru&m=ok');
  t.photo(501, 'GALLERY');
  assert.match(t.last('sendMessage', 501).text, /Фото — только этой кнопкой/);
  const up = (extra, init = initData({ id: 501, first_name: 'Akmal' })) => t.s.post({ tgphoto: { init, key: 'BL-901|1', img: JPEG, ...extra } });
  assert.equal(up({}, initData({ id: 501 }, { token: 'чужой' })).code, 'auth', 'подпись другим токеном');
  assert.equal(up({}, initData({ id: 501 }, { at: Date.UTC(2026, 8, 24) / 1000 })).code, 'auth', 'подпись старше суток');
  assert.equal(up({ key: 'BL-902|1' }).code, 'stage', 'снимок не той точки');
  assert.deepEqual(t.s.post({ tgphoto: { init: initData({ id: 501 }), key: 'BL-901|1', ping: 1 } }), { ok: true, ping: true, n: 0, v: 32 }, 'проверка связи со страницы камеры');
  assert.equal(t.s.post({ tgphoto: { init: initData({ id: 501 }), key: 'BL-902|1', ping: 1 } }).code, 'stage');
  const r = up({ ll: [41.3105, 69.2102] });
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.n, 1);
  const sent = t.last('sendPhoto', 501);
  assert.equal(typeof sent.photo, 'object'); assert.equal(sent.caption, '✅ Фото принято · BL-901 · 09:00');
  const under = JSON.parse(sent.reply_markup).inline_keyboard;   // кнопки прямо под снимком
  assert.deepEqual(under.map(r => r[0].text), ['✅ Готово', '📷 Ещё фото']); assert.equal(under[0][0].callback_data, 'pdone'); assert.match(under[1][0].web_app.url, /driver\.html\?/);
  t.cb(501, 'pdone');   // место — со снимка: без шага «геолокация»
  assert.deepEqual(t.status('BL-901'), ['Yetkazildi', 'Yetkazildi']);
  const cap = t.last('sendPhoto', g).caption;
  assert.match(cap, /✅ Gazel-2 · Akmal Karimov — доставлено: BL-901/); assert.doesNotMatch(cap, /⚠️/);
  // «не доставлено» — тоже со снимком; отметка в нескольких км от клиента
  t.cb(501, 'fail:BL-902|1'); t.cb(501, 'why:0');
  t.cb(501, 'pdone');
  assert.match(t.last('sendMessage', 501).text, /Сначала сделайте фото/);
  assert.equal(t.s.post({ tgphoto: { init: initData({ id: 501 }), key: 'BL-902|1', img: JPEG, ll: [41.30, 69.20] } }).ok, true);
  t.cb(501, 'pdone');
  assert.deepEqual(t.status('BL-902'), ['Qolib ketgan']);
  assert.match(t.last('sendPhoto', g).caption, /⚠️ Отметка в 9,4 км от точки клиента/);
  const log = t.s.book.sheets.Yetkazish.rows;
  assert.deepEqual(log[0].slice(12, 14), ['Kutdi (daq)', 'Mijozgacha (km)']);
  assert.deepEqual(log.slice(1).map(x => x[13]), [0.1, 9.4]);
  assert.deepEqual(t.s.get({ tgdays: '2' }).data.tg.log.map(x => x.km), [0.1, 9.4]);
  // камера выключена на сайте — фото из чата снова принимаются
  assert.equal(t.s.post({ token: '', tg: { action: 'settings', camera: false } }).tg.settings.camera, false);
  t.cb(501, 'round:2');
  t.cb(501, 'ok:BL-903|2');
  assert.match(t.last('sendMessage', 501).text, /Отправьте фото доставленного груза/);
  t.photo(501, 'P2');
  assert.match(t.last('sendMessage', 501).text, /Фото принято \(1\)/);
});

test('карточка точки: маршрут в Яндекс и Google; «Жду клиента» — таймер, напоминание водителю и группе раз в 5 минут, минуты ожидания в журнале', () => {
  const t = approved({ TG_MORNING: 'off' }), g = t.group.id;
  assert.match(t.s.post({ token: '', tg: { action: 'settings', waitMin: 3 } }).error, /от 5 до 120/);
  t.s.post({ token: '', tg: { action: 'settings', waitMin: 15 } });
  t.msg(501, '🚚 Начать работу'); t.loc(501, DEPOT);
  const card = [...t.tg.sent].reverse().find(x => x.method === 'sendMessage' && /Точка 1 из/.test(x.text || ''));
  const kb = card.reply_markup.inline_keyboard;
  assert.deepEqual(kb[1].map(b => b.callback_data), ['wait:BL-901|1']);
  assert.equal(kb[2][0].url, 'https://yandex.uz/maps/?rtext=~41.31,69.21&rtt=auto');
  assert.equal(kb[2][1].url, 'https://www.google.com/maps/dir/?api=1&destination=41.31,69.21&travelmode=driving');
  t.cb(501, 'wait:BL-901|1');
  assert.match(t.last('sendMessage', 501).text, /Ждёте клиента до 09:15/);
  const n0 = t.tg.sent.length;
  t.s.ctx.tgTick();
  assert.equal(t.tg.sent.length, n0, 'до конца ожидания — тишина');
  t.now.value = new Date(Date.UTC(2026, 8, 26, 4, 16));
  t.s.ctx.tgTick();
  assert.match(t.last('sendMessage', 501).text, /Прошло 16 мин. Клиент пришёл\?/);
  assert.deepEqual(t.last('sendMessage', 501).reply_markup.inline_keyboard[1].map(b => [b.text, b.callback_data]), [['⏳ Ещё 15 мин', 'wait:BL-901|1']]);
  assert.match(t.last('sendMessage', g).text, /⏰ Gazel-2 · Akmal Karimov: ждёт клиента BL-901 уже 16 мин\.\n☎️ \+998900000001/);
  const n1 = t.tg.sent.length; t.s.ctx.tgTick(); assert.equal(t.tg.sent.length, n1, 'одно напоминание');
  t.cb(501, 'wait:BL-901|1');
  assert.match(t.last('sendMessage', 501).text, /до 09:31/);
  t.now.value = new Date(Date.UTC(2026, 8, 26, 4, 20));
  t.cb(501, 'ok:BL-901|1'); t.photo(501, 'P'); t.msg(501, '✅ Готово'); t.loc(501, [41.31, 69.21]);
  assert.equal(t.s.book.sheets.Yetkazish.rows[1][12], 20, 'ждал 20 минут');
  assert.match(t.last('sendPhoto', g).caption, /⏳ Ждал клиента 20 мин/);
  // ночью «тик» ничего не делает
  t.now.value = new Date(Date.UTC(2026, 8, 26, 18, 0));   // 23:00
  const n2 = t.tg.sent.length; t.s.ctx.tgTick(); assert.equal(t.tg.sent.length, n2);
});

test('«⚠️ Проблема»: вид кнопкой, описание, фото из галереи, геолокация → «Muammolar», фото на Диск, тревога в группу; на сайте — за период', () => {
  const t = approved(), g = t.group.id;
  t.msg(501, '🚚 Начать работу'); t.loc(501, DEPOT);
  t.msg(501, '⚠️ Проблема');
  assert.deepEqual(t.last('sendMessage', 501).reply_markup.inline_keyboard.map(r => r[0].text), ['🔧 Поломка', '🚦 Пробка', '💥 ДТП', '👮 ГАИ / штраф', '⛽ Топливо', '✍️ Другое']);
  t.cb(501, 'pr:0');
  assert.match(t.last('sendMessage', 501).text, /🔧 Поломка\nКоротко опишите/);
  t.msg(501, 'пробило колесо'); t.photo(501, 'WHEEL');
  assert.match(t.last('sendMessage', 501).text, /Фото добавлено: 1/);
  t.loc(501, [41.33, 69.25]);
  const alert = t.last('sendPhoto', g);
  assert.match(alert.caption, /⚠️ ПРОБЛЕМА: 🔧 Поломка — Gazel-2 · Akmal Karimov\nпробило колесо\nТекущая точка: BL-901\n09:00 · 📍 https:\/\/maps\.google\.com\/\?q=41\.33,69\.25/);
  assert.match(t.last('sendMessage', 501).text, /Сообщение отправлено диспетчеру/);
  const row = t.s.book.sheets.Muammolar.rows[1];
  assert.deepEqual([row[1], row[2], row[3], row[4], row[6]], ['Akmal Karimov', 'Gazel-2', 'Поломка', 'пробило колесо', '41.33,69.25']);
  assert.match(row[5], /^https:\/\/drive\.google\.com\/file\/d\//);
  const pr = t.s.get({}).data.tg.problems;
  assert.deepEqual(pr.map(x => [x.type, x.text, x.truck]), [['Поломка', 'пробило колесо', 'Gazel-2']]);
  // проблема не мешает доставке: текущая точка на месте
  t.msg(501, '📍 Текущая точка');
  assert.match(t.texts(501).filter(x => /Точка/.test(x)).pop(), /BL-901/);
  // отмена
  t.msg(501, '⚠️ Проблема'); t.cb(501, 'pr:1'); t.msg(501, '↩️ Отмена');
  assert.equal(t.s.book.sheets.Muammolar.rows.length, 2);
});


test('недоставленные — на завтра: в 20:00 вместе с итогом дня (статус «Rejada», без машины, пометка), выключается настройкой; с сайта — любая партия на выбранную дату', () => {
  const t = approved(), g = t.group.id;
  t.msg(501, '🚚 Начать работу'); t.loc(501, DEPOT);
  t.cb(501, 'ok:BL-901|1'); t.photo(501, 'P'); t.msg(501, '✅ Готово'); t.loc(501, [41.31, 69.21]);
  t.cb(501, 'fail:BL-902|1'); t.cb(501, 'why:0'); t.photo(501, 'F'); t.msg(501, '✅ Готово'); t.loc(501, [41.36, 69.28]);
  t.now.value = new Date(Date.UTC(2026, 8, 26, 15, 0));   // 20:00
  t.s.ctx.tgDailySummary();
  const r902 = t.s.book.sheets.Yuborishlar.rows.find(r => r[2] === 'BL-902');
  const iso = v => t.s.ctx.Utilities.formatDate(v, 'Asia/Tashkent', 'yyyy-MM-dd');
  assert.deepEqual([iso(r902[0]), r902[12], r902[13], r902[14]], ['2026-09-27', 'Belgilanmagan', '', 'Rejada']);
  assert.match(r902[15], /осторожно, стекло · повторно: не доставлено 26\.09\.2026/);
  assert.match(t.last('sendMessage', g).text, /📊 Итог дня 26\.09\.2026[\s\S]*↪️ Не доставленные перенесены на 27\.09\.2026: 1 \(BL-902\)/);
  assert.deepEqual(t.status('BL-901'), ['Yetkazildi', 'Yetkazildi'], 'доставленные не трогаем');
  // с сайта: партия 25.09 → 28.09
  t.s.book.sheets.Yuborishlar.rows.find(r => r[2] === 'BL-905')[14] = 'Qolib ketgan';
  assert.match(t.s.post({ token: '', tg: { action: 'carry', from: '2026-09-25', to: '2026-09-25' } }).error, /другую дату/);
  const r = t.s.post({ token: '', tg: { action: 'carry', from: '2026-09-25', to: '2026-09-28' } });
  assert.deepEqual(r.moved, ['BL-905']);
  assert.equal(iso(t.s.book.sheets.Yuborishlar.rows.find(x => x[2] === 'BL-905')[0]), '2026-09-28');
  // выключено — не переносим
  const u = approved();
  u.s.post({ token: '', tg: { action: 'settings', carry: false } });
  u.msg(501, '🚚 Начать работу'); u.loc(501, DEPOT);
  u.cb(501, 'fail:BL-901|1'); u.cb(501, 'why:0'); u.photo(501, 'F'); u.msg(501, '✅ Готово'); u.loc(501, DEPOT);
  u.now.value = new Date(Date.UTC(2026, 8, 26, 15, 0));
  u.s.ctx.tgDailySummary();
  assert.deepEqual(u.status('BL-901'), ['Qolib ketgan', 'Qolib ketgan']);
  assert.doesNotMatch(u.last('sendMessage', u.group.id).text, /перенесены/);
});

test('клиенты: подписка по ссылке и номеру (свой номер из карточки — сразу, чужой — через группу), уведомления на узбекском: сегодня, в пути, не отвечает, доставлено с фото, не доставлено; /stop', () => {
  const t = approved(), g = t.group.id;
  t.s.post({ token: '', tg: { action: 'dispatcher', phone: '+998770176611', name: 'Jasur' } });
  const cmsg = (from, text, extra = {}) => t.upd({ message: { message_id: 1, from: { id: from, first_name: 'Aziz', username: 'aziz' }, chat: { id: from, type: 'private' }, text, ...extra } });
  const contact = (from, phone, owner = from) => cmsg(from, undefined, { contact: { phone_number: phone, user_id: owner } });
  assert.equal(t.s.book.sheets.Obunalar, undefined, 'лист подписок — с первым клиентом');
  cmsg(700, '/start bl-901');
  const hi = t.last('sendMessage', 700);
  assert.match(hi.text, /BURAQ logistics boti[\s\S]*telefon raqamingizni yuboring/);
  assert.equal(hi.reply_markup.keyboard[0][0].request_contact, true);
  contact(700, '+998 90 000 00 01', 999);
  assert.match(t.last('sendMessage', 700).text, /o‘zingizning raqamingizni/);
  contact(700, '998900000001');
  assert.match(t.last('sendMessage', 700).text, /✅ Obuna bo‘ldingiz: BL-901/);
  // номера нет в карточке — решает администратор группы
  cmsg(701, '/start BL-902'); contact(701, '+998911111111');
  assert.match(t.last('sendMessage', 701).text, /Menejer tasdiqlagach/);
  const ask = t.last('sendMessage', g);
  assert.match(ask.text, /Клиент хочет получать уведомления о грузе: BL-902 Botir\nTelegram: Aziz @aziz · \+998911111111\nНомера в карточке: \+998900000002, \+998900000022/);
  t.cb(555, 'callow:701', t.group);
  assert.equal(t.s.book.sheets.Obunalar.rows.find(r => r[0] === '701')[4], 'kutilmoqda', 'не администратор — не может');
  t.cb(900, 'callow:701', t.group);
  assert.match(t.last('sendMessage', 701).text, /✅ Obuna bo‘ldingiz: BL-902/);
  // без ссылки: кнопка «я клиент» → BL → номер
  cmsg(702, '/start');
  assert.equal(t.last('sendMessage', 702).reply_markup.inline_keyboard[1][0].callback_data, 'client');
  t.cb(702, 'client');
  assert.match(t.last('sendMessage', 702).text, /BL kodingizni yozing/);
  cmsg(702, 'BL-999'); assert.match(t.last('sendMessage', 702).text, /topilmadi/);
  cmsg(702, 'BL-903'); contact(702, '+998900000003');
  assert.match(t.last('sendMessage', 702).text, /Obuna bo‘ldingiz: BL-903/);
  assert.equal(t.s.book.sheets.Haydovchilar.rows.filter(r => r[0] === '702').length, 0, 'клиент не остаётся в листе водителей');
  // сегодня доставим
  t.s.post({ token: '', tg: { action: 'dispatch', date: '2026-09-26' } });
  assert.match(t.last('sendMessage', 700).text, /📦 BURAQ logistics: yukingiz \(BL-901 · 12 joy\) bugun yetkaziladi/);
  // в пути — время прибытия
  t.msg(501, '🚚 Начать работу'); t.loc(501, DEPOT);
  assert.match(t.last('sendMessage', 700).text, /🚚 Haydovchi sizga yo‘lda! Taxminan 09:\d\d da yetib boradi\.\nMashina: Gazel-2\.\nSavollar bo‘lsa: \+998770176611/);
  // не отвечает → клиенту просьба ответить
  t.cb(501, 'fail:BL-901|1'); t.cb(501, 'why:1');
  assert.match(t.last('sendMessage', 700).text, /Haydovchi manzilingiz yonida, lekin telefoningizga javob yo‘q/);
  t.cb(501, 'na:ok'); t.photo(501, 'P1'); t.msg(501, '✅ Готово'); t.loc(501, [41.31, 69.21]);
  const done = t.last('sendPhoto', 700);
  assert.equal(done.photo, 'P1'); assert.match(done.caption, /✅ Yukingiz yetkazildi: BL-901 · 12 joy/);
  // не доставлено — причина по-узбекски
  t.cb(501, 'fail:BL-902|1'); t.cb(501, 'why:0'); t.photo(501, 'F'); t.msg(501, '✅ Готово'); t.loc(501, [41.36, 69.28]);
  assert.match(t.last('sendMessage', 701).text, /Bugun yukingizni \(BL-902\) yetkazib bera olmadik\. Sabab: Mijoz yo‘q\./);
  const n701 = t.texts(701).length;
  t.cb(501, 'round:2');   // BL-903 → 702 «в пути»; 701 больше не пишем
  assert.match(t.last('sendMessage', 702).text, /Haydovchi sizga yo‘lda/);
  assert.equal(t.texts(701).length, n701);
  // отписка
  cmsg(700, '/stop'); assert.match(t.last('sendMessage', 700).text, /Obuna bekor qilindi/);
  const subs = t.s.get({}).data.tg.subs;
  assert.deepEqual(subs.map(x => [x.bl, x.status]), [['BL-901', 'o‘chirilgan'], ['BL-902', 'faol'], ['BL-903', 'faol']]);
});

test('камера: испорченная подпись — отказ без сбоя; клиентская ссылка не удаляет отключённого водителя', () => {
  const t = approved();
  assert.equal(t.s.post({ tgphoto: { init: 'user=%E0%A4%A&hash=%', key: 'x', img: JPEG } }).code, 'auth');
  assert.equal(t.s.post({ tgphoto: { init: '', key: 'x', img: JPEG } }).code, 'auth');
  t.s.post({ token: '', tg: { action: 'driver', id: '501', status: 'o‘chirilgan' } });
  t.msg(501, '/start BL-901');
  assert.equal(t.s.book.sheets.Haydovchilar.rows.filter(r => r[0] === '501').length, 1, 'строка водителя на месте');
});

test('«✅ Готово» в камере закрывает точку (без кнопки в чате); без фото — просьба снять; при переподключении итог дня ставится заново; часовой пояс — на сайт', () => {
  const t = approved(), g = t.group.id;
  t.s.post({ token: '', site: 'https://buraq.example/xeeds/', tg: { action: 'status' } });
  t.msg(501, '🚚 Начать работу'); t.loc(501, DEPOT);
  t.cb(501, 'ok:BL-901|1');
  const cam = (extra) => t.s.post({ tgphoto: { init: initData({ id: 501 }), key: 'BL-901|1', ...extra } });
  assert.equal(cam({ done: 1 }).code, 'nophoto');
  assert.equal(cam({ img: JPEG, ll: [41.3101, 69.2101] }).ok, true);
  const r = cam({ done: 1 });
  assert.deepEqual([r.ok, r.done, r.needLoc], [true, true, false]);
  assert.deepEqual(t.status('BL-901'), ['Yetkazildi', 'Yetkazildi']);
  assert.match(t.last('sendPhoto', g).caption, /доставлено: BL-901/);
  assert.match(t.texts(501).filter(x => /Точка/.test(x)).pop(), /BL-902/, 'следующая точка');
  // без места на снимке — бот спросит геолокацию
  t.cb(501, 'ok:BL-902|1');
  cam({ key: 'BL-902|1', img: JPEG });
  assert.deepEqual(cam({ key: 'BL-902|1', done: 1 }).needLoc, true);
  assert.match(t.last('sendMessage', 501).text, /Отправьте геолокацию/);
  // переподключение: итог дня — один триггер, заново
  connect(t); connect(t);
  assert.deepEqual(t.s.triggers.map(x => x.fn).sort(), ['tgDailySummary', 'tgTick']);
  const info = t.s.get({}).data.tg;
  assert.deepEqual([info.tz, info.scriptTz], ['Asia/Tashkent', 'Asia/Tashkent']);
});

// ── версия 14: план дня утром и напоминания водителям (триггер tgTick) ──
const at = (t, h, m, d = 26) => { t.now.value = new Date(Date.UTC(2026, 8, d, h - 5, m)); };   // время по Ташкенту
const sentTo = (t, chat) => t.tg.sent.filter(x => String(x.chat_id) === String(chat)).length;
const addShip = (t, bl, truck) => { const r = new Array(16).fill(''); r[0] = day(2026, 9, 26); r[2] = bl; r[9] = 1; r[10] = 100; r[11] = 3; r[12] = truck; r[14] = 'Rejada'; t.s.book.sheets.Yuborishlar.rows.push(r); };

test('план дня утром: в 08:30 водителям — задание, в группу — кому ушло, машины без водителя и партии без машины; один раз в день', () => {
  const t = approved(), g = t.group.id;
  addShip(t, 'BL-906', 'Belgilanmagan');
  at(t, 8, 25); let n = t.tg.sent.length; t.s.ctx.tgTick();
  assert.equal(t.tg.sent.length, n, 'до 08:30 — тишина');
  at(t, 8, 35); t.s.ctx.tgTick();
  assert.match(t.last('sendMessage', 501).text, /Задание: партия 26\.09\.2026\n🚚 Gazel-2 · точек: 3/);
  assert.equal(t.last('sendMessage', g).text, '🌅 План на 26.09.2026 отправлен водителям:\n🚚 Gazel-2 · Akmal Karimov — точек: 3\n\nНе отправлено: Gazel-3 — нет водителя в боте\n\n⚠️ Без машины: 1 (BL-906) — назначьте в «Планах» и нажмите «Отправить» на сайте.');
  assert.equal(t.s.props.TG_MORNING_DAY, TODAY);
  const info = t.s.get({}).data.tg;
  assert.deepEqual([info.settings.morning, info.settings.morningDay, info.settings.remind], ['08:30', TODAY, true]);
  assert.equal(info.drivers[0].assign.date, TODAY);
  at(t, 8, 40); n = t.tg.sent.length; t.s.ctx.tgTick();
  assert.equal(t.tg.sent.length, n, 'второй раз не отправляет');
  // на следующий день плана нет — группа молчит
  at(t, 8, 35, 27); n = sentTo(t, g); t.s.ctx.tgTick();
  assert.equal(sentTo(t, g), n); assert.equal(t.s.props.TG_MORNING_DAY, '2026-09-27');
});

test('план дня утром: кто уже работает — не трогаем; «выкл» и позже 3 часов после времени — не отправляет', () => {
  const t = approved(), g = t.group.id;
  at(t, 8, 0); t.msg(501, '🚚 Начать работу'); t.loc(501, DEPOT);
  at(t, 8, 35); t.s.ctx.tgTick();
  assert.ok(!t.texts(501).some(x => /Задание/.test(x)), 'работающему задание не шлём');
  assert.equal(t.last('sendMessage', g).text, '🌅 План на 26.09.2026: водителям ничего не отправлено.\n\nНе отправлено: Gazel-3 — нет водителя в боте');
  const off = approved({ TG_MORNING: 'off' });
  at(off, 8, 35); let n = off.tg.sent.length; off.s.ctx.tgTick();
  assert.equal(off.tg.sent.length, n); assert.equal(off.s.props.TG_MORNING_DAY, undefined);
  const late = approved();
  at(late, 11, 35); n = late.tg.sent.length; late.s.ctx.tgTick();
  assert.equal(late.tg.sent.length, n); assert.equal(late.s.props.TG_MORNING_DAY, undefined);
});

test('напоминание «не начал работу»: в 09:30 — кнопка «Начать работу», в 10:00 — ещё раз и в группу; без геолокации через 10 минут — снова', () => {
  const t = approved(), g = t.group.id;
  at(t, 8, 35); t.s.ctx.tgTick();
  at(t, 9, 25); let n = t.tg.sent.length; t.s.ctx.tgTick(); assert.equal(t.tg.sent.length, n);
  at(t, 9, 30); t.s.ctx.tgTick();
  const r = t.last('sendMessage', 501);
  assert.equal(r.text, '⏰ Сегодня вас ждут точек: 3 👇');
  assert.deepEqual(r.reply_markup.inline_keyboard, [[{ text: '🚚 Начать работу', callback_data: 'start' }]]);
  at(t, 9, 35); n = t.tg.sent.length; t.s.ctx.tgTick(); assert.equal(t.tg.sent.length, n);
  at(t, 10, 0); t.s.ctx.tgTick();
  assert.equal(t.last('sendMessage', g).text, '🚚 Gazel-2 · Akmal Karimov ещё не вышел на линию (партия 26.09.2026, точек: 3).');
  assert.equal(t.last('sendMessage', 501).text, '⏰ Сегодня вас ждут точек: 3 👇');
  at(t, 10, 30); n = t.tg.sent.length; t.s.ctx.tgTick(); assert.equal(t.tg.sent.length, n, 'дальше — тишина');
  t.cb(501, 'start');
  const ask = t.last('sendMessage', 501);
  assert.match(ask.text, /Чтобы начать работу, отправьте геолокацию/); assert.equal(ask.reply_markup.keyboard[0][0].request_location, true);
  t.s.ctx.tgTick(); at(t, 10, 40); t.s.ctx.tgTick();
  assert.match(t.last('sendMessage', 501).text, /^⏰ Чтобы начать работу, отправьте геолокацию/);
  t.loc(501, DEPOT);
  assert.match(t.texts(501).filter(x => /Точка/.test(x)).pop(), /Точка 1 из 2/);
});

test('напоминание «не отметил точку»: время пути + 30 мин (не меньше 45) — «доставили?» с кнопками, ещё через 30 — в группу с последней отметкой', () => {
  const t = approved({ TG_MORNING: 'off' }), g = t.group.id;
  t.msg(501, '🚚 Начать работу'); t.loc(501, DEPOT);
  t.s.ctx.tgTick();   // 09:00 — тик запомнил состояние
  at(t, 9, 40); let n = t.tg.sent.length; t.s.ctx.tgTick(); assert.equal(t.tg.sent.length, n, 'рано');
  at(t, 9, 45); t.s.ctx.tgTick();
  const r = t.last('sendMessage', 501);
  assert.equal(r.text, '⏰ BL-901: доставили?');
  assert.deepEqual(r.reply_markup.inline_keyboard.map(x => x.map(b => b.callback_data)), [['ok:BL-901|1', 'fail:BL-901|1'], ['wait:BL-901|1']]);
  at(t, 10, 15); t.s.ctx.tgTick();
  assert.equal(t.last('sendMessage', g).text, '⏰ Gazel-2 · Akmal Karimov: 75 мин без отметки у BL-901.\n🚚 Последняя отметка в 09:00: https://maps.google.com/?q=41.3,69.2');
  at(t, 10, 45); n = t.tg.sent.length; t.s.ctx.tgTick(); assert.equal(t.tg.sent.length, n, 'дальше — тишина');
  t.cb(501, 'ok:BL-901|1');   // кнопка из напоминания работает
  assert.match(t.last('sendMessage', 501).text, /Отправьте фото доставленного груза/);
});

test('напоминание «застрял на шаге»: через 10 минут — тот же шаг с кнопкой камеры, через 20 — в группу; снимок есть — «Готово»', () => {
  const t = approved({ TG_MORNING: 'off' }), g = t.group.id;
  t.s.post({ token: '', site: 'https://buraq.example/xeeds/', tg: { action: 'status' } });
  t.msg(501, '🚚 Начать работу'); t.loc(501, DEPOT);
  t.cb(501, 'ok:BL-901|1'); t.s.ctx.tgTick();
  at(t, 9, 10); t.s.ctx.tgTick();
  let r = t.last('sendMessage', 501);
  assert.equal(r.text, '⏰ 📷 Сфотографируйте груз 👇');
  assert.match(r.reply_markup.inline_keyboard[0][0].web_app.url, /^https:\/\/buraq\.example\/xeeds\/driver\.html\?/);
  at(t, 9, 20); t.s.ctx.tgTick();
  assert.equal(t.last('sendMessage', g).text, '⏰ Gazel-2 · Akmal Karimov: 20 мин на шаге «фото» — BL-901. Позвоните водителю.');
  at(t, 9, 22);
  assert.equal(t.s.post({ tgphoto: { init: initData({ id: 501 }), key: 'BL-901|1', img: JPEG, ll: [41.3101, 69.2101] } }).ok, true);
  t.s.ctx.tgTick(); at(t, 9, 32); t.s.ctx.tgTick();
  r = t.last('sendMessage', 501);
  assert.equal(r.text, '⏰ ✅ Фото принято (1). Нажмите «✅ Готово».');
  assert.deepEqual(r.reply_markup.inline_keyboard[0], [{ text: '✅ Готово', callback_data: 'pdone' }]);
  t.cb(501, 'pdone');
  assert.deepEqual(t.status('BL-901'), ['Yetkazildi', 'Yetkazildi']);
});

test('напоминания: рейс закончен — через час снова кнопка рейса; все точки пройдены — через 30 минут «закончена?» с кнопкой; день закрыт — тишина', () => {
  const t = approved({ TG_MORNING: 'off' });
  const done = (key, ll) => { t.cb(501, 'ok:' + key); t.photo(501, 'P' + key); t.msg(501, '✅ Готово'); t.loc(501, ll); };
  t.msg(501, '🚚 Начать работу'); t.loc(501, DEPOT);
  done('BL-901|1', [41.31, 69.21]); done('BL-902|1', [41.36, 69.28]);
  assert.match(t.last('sendMessage', 501).text, /Рейс 1 закончен/);
  t.s.ctx.tgTick(); at(t, 9, 55); let n = t.tg.sent.length; t.s.ctx.tgTick(); assert.equal(t.tg.sent.length, n);
  at(t, 10, 0); t.s.ctx.tgTick();
  const r = t.last('sendMessage', 501);
  assert.match(r.text, /^⏰ Рейс 1 закончен/); assert.deepEqual(r.reply_markup.inline_keyboard, [[{ text: '▶️ Начать рейс 2', callback_data: 'round:2' }]]);
  t.cb(501, 'round:2'); done('BL-903|2', [41.22, 69.22]);
  assert.match(t.last('sendMessage', 501).text, /Все точки на сегодня пройдены/);
  t.s.ctx.tgTick(); at(t, 10, 30); t.s.ctx.tgTick();
  const e = t.last('sendMessage', 501);
  assert.equal(e.text, '⏰ Работа на сегодня закончена? 👇'); assert.deepEqual(e.reply_markup.inline_keyboard, [[{ text: '🏁 Закончить работу', callback_data: 'end' }]]);
  t.cb(501, 'end');
  assert.match(t.last('sendMessage', 501).text, /Чтобы закончить работу, отправьте геолокацию/);
  t.loc(501, DEPOT);
  assert.match(t.last('sendMessage', 501).text, /Рабочий день закончен\. Доставлено: 3/);
  at(t, 11, 30); n = t.tg.sent.length; t.s.ctx.tgTick(); assert.equal(t.tg.sent.length, n, 'день закончен — тишина');
});

test('напоминания выключаются настройкой; час после «Проблемы» — без напоминаний', () => {
  const t = approved({ TG_MORNING: 'off' });
  t.msg(501, '🚚 Начать работу'); t.loc(501, DEPOT); t.s.ctx.tgTick();
  t.msg(501, '⚠️ Проблема'); t.cb(501, 'pr:1'); t.loc(501, DEPOT);   // пробка в 09:00
  assert.match(t.last('sendMessage', 501).text, /отправлено диспетчеру/);
  at(t, 9, 55); let n = t.tg.sent.length; t.s.ctx.tgTick(); assert.equal(t.tg.sent.length, n, 'после проблемы — тишина');
  at(t, 10, 5); t.s.ctx.tgTick(); assert.equal(t.last('sendMessage', 501).text, '⏰ BL-901: доставили?');
  const off = approved({ TG_MORNING: 'off' });
  assert.equal(off.s.post({ token: '', tg: { action: 'settings', remind: false } }).tg.settings.remind, false);
  off.msg(501, '🚚 Начать работу'); off.loc(501, DEPOT); off.s.ctx.tgTick();
  at(off, 11, 0); n = off.tg.sent.length; off.s.ctx.tgTick(); assert.equal(off.tg.sent.length, n);
});

test('настройки v14 с сайта: план утром — время 05:00–11:00 или «выкл», напоминания вкл/выкл', () => {
  const t = approved();
  const set = x => t.s.post({ token: '', tg: { action: 'settings', ...x } });
  const cfg = t.s.get({}).data.tg.settings;
  assert.deepEqual([cfg.morning, cfg.remind, cfg.morningDay], ['08:30', true, '']);
  assert.match(set({ morning: '12:00' }).error, /от 05:00 до 11:00/);
  assert.match(set({ morning: '8:3' }).error, /от 05:00 до 11:00/);
  assert.equal(set({ morning: '07:30' }).tg.settings.morning, '07:30');
  assert.equal(set({ morning: 'off' }).tg.settings.morning, ''); assert.equal(t.s.props.TG_MORNING, 'off');
  assert.equal(set({ morning: '' }).tg.settings.morning, '');
  const r = set({ remind: false });
  assert.equal(r.tg.settings.remind, false); assert.equal(t.s.props.TG_REMIND, '0');
  assert.equal(set({ remind: true, morning: '11:00' }).tg.settings.morning, '11:00');
});

test('напоминания: не выбрал причину — через 10 минут снова причины; «клиент не отвечает» — через 30 минут снова то же меню, через 60 — в группу', () => {
  const t = approved({ TG_MORNING: 'off' }), g = t.group.id;
  t.msg(501, '🚚 Начать работу'); t.loc(501, DEPOT);
  t.cb(501, 'fail:BL-901|1'); t.s.ctx.tgTick();
  at(t, 9, 10); t.s.ctx.tgTick();
  const r = t.last('sendMessage', 501);
  assert.equal(r.text, '⏰ Выберите причину:');
  assert.deepEqual(r.reply_markup.inline_keyboard.map(x => x[0].callback_data), ['why:0', 'why:1', 'why:2', 'why:3']);
  t.cb(501, 'why:1'); t.s.ctx.tgTick();
  at(t, 9, 35); let n = t.tg.sent.length; t.s.ctx.tgTick(); assert.equal(t.tg.sent.length, n);
  at(t, 9, 40); t.s.ctx.tgTick();
  const m = t.last('sendMessage', 501);
  assert.equal(m.text, '⏰ 📵 Клиент не отвечает на телефон. Что делаем?');
  assert.deepEqual(m.reply_markup.inline_keyboard.map(x => x[0].callback_data), ['na:call', 'na:tel', 'wait:BL-901|1', 'na:ok', 'na:fail']);
  at(t, 10, 10); t.s.ctx.tgTick();
  assert.equal(t.last('sendMessage', g).text, '⏰ Gazel-2 · Akmal Karimov: 60 мин на шаге «клиент не отвечает» — BL-901. Позвоните водителю.');
});

test('напоминание «не начал»: задание с сайта днём — не раньше чем через 30 минут', () => {
  const t = approved({ TG_MORNING: 'off' });
  at(t, 14, 0);
  assert.equal(t.s.post({ token: '', tg: { action: 'dispatch', date: TODAY } }).sent.length, 1);
  let n = t.tg.sent.length; t.s.ctx.tgTick(); at(t, 14, 25); t.s.ctx.tgTick(); assert.equal(t.tg.sent.length, n, 'сразу не напоминает');
  at(t, 14, 30); t.s.ctx.tgTick();
  assert.equal(t.last('sendMessage', 501).text, '⏰ Сегодня вас ждут точек: 3 👇');
});

test('бот читает дату партии с поправкой на прежний сдвиг пояса: 23:00 вчера и 13:00 сегодня — сегодняшняя партия, 18:00 сегодня — завтрашняя', () => {
  const t = approved({ TG_MORNING: 'off' });
  const add = (h, d, bl) => { const r = new Array(16).fill(''); r[0] = new Date(Date.UTC(2026, 8, d, h) - 5 * 3600e3); r[2] = bl; r[9] = 1; r[10] = 10; r[11] = 1; r[12] = 'Gazel-2'; r[13] = 1; r[14] = 'Rejada'; t.s.book.sheets.Yuborishlar.rows.push(r); };
  add(23, 25, 'BL-907'); add(13, 26, 'BL-908'); add(18, 26, 'BL-909');
  const r = t.s.post({ token: '', tg: { action: 'dispatch', date: TODAY } });
  assert.deepEqual(r.sent.map(x => x.n), [5], 'BL-901, 902, 903 + BL-907 и BL-908');
  assert.match(t.last('sendMessage', 501).text, /🚚 Gazel-2 · точек: 5/, 'BL-909 — партия 27.09, в задание не вошла');
});

test('версия 17: кнопки карточки версии 15, оставшиеся в чате, работают — язык, проблема, «☰ Ещё» (текущая точка), камера с карточки', () => {
  const t = approved();
  t.s.post({ token: '', site: 'https://buraq.example/xeeds/', tg: { action: 'status' } });
  t.msg(501, '🚚 Начать работу'); t.loc(501, DEPOT);
  const card = t.last('sendMessage', 501);
  assert.match(card.text, /BL-901/);
  assert.ok(card.reply_markup.inline_keyboard.some(r => r.some(b => b.callback_data === 'ok:BL-901|1')), 'карточка версии 14: «Доставлено» — кнопкой');
  // «☰ Ещё» и «Номера клиента» из старой карточки — текущая точка с прежними кнопками
  const n = t.texts(501).length;
  t.cb(501, 'more');
  assert.ok(t.texts(501).length > n && /BL-901/.test(t.texts(501).slice(n).join('\n')), 'текущая точка заново');
  t.cb(501, 'tels');
  assert.match(t.texts(501).slice(-2).join('\n'), /BL-901/);
  // камера с карточки версии 15: проверка связи не меняет шаг, снимок — как «Доставлено»
  const cam = extra => t.s.post({ tgphoto: { init: initData({ id: 501 }), key: 'BL-901|1', ...extra } });
  assert.deepEqual(cam({ ping: 1 }), { ok: true, ping: true, n: 0, v: 32 });
  assert.equal(cam({ key: 'BL-902|1', img: JPEG }).code, 'stage', 'не та точка');
  const r = cam({ img: JPEG, ll: [41.3105, 69.2102] });
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.n, 1);
  assert.equal(cam({ done: 1 }).done, true, '«Готово» закрывает точку');
  assert.ok(t.status('BL-901').length && t.status('BL-901').every(x => x === 'Yetkazildi'), 'точка доставлена');
  // язык и проблема
  t.cb(501, 'lang');
  assert.match(t.last('sendMessage', 501).text, /O‘zbek|o‘zbek|Til/i);
  t.cb(501, 'prob');
  assert.ok(t.last('sendMessage', 501).reply_markup.inline_keyboard.every(row => /^pr:\d$/.test(row[0].callback_data)), 'виды проблем кнопками');
});

// ── версия 18: один план — одно сообщение ──
const b902 = { date: TODAY, bl: 'BL-902', cbm: 2, kg: 300, places: 12, truck: 'Gazel-2', route: 1, status: 'Rejada', note: 'осторожно, стекло' };
const move902 = (to, extra = {}) => ({ t: 'ship.upsert', row: 6, guard: { bl: 'BL-902', date: TODAY }, was: b902, v: { ...b902, truck: to }, ...extra });

test('версия 18: правки журнала порциями — водителю одно «Задание изменилось» после последней порции, а не после каждой', () => {
  const t = approved();
  t.s.post({ token: '', tg: { action: 'dispatch', date: TODAY } });
  const n = t.texts(501).length;
  t.s.post({ token: '', more: true, ops: [move902('Gazel-3')] });
  t.s.post({ token: '', more: true, ops: [{ ...move902('Gazel-3'), was: { ...b902, truck: 'Gazel-3' }, v: { ...b902, truck: 'Gazel-3', note: 'x' } }] });
  assert.equal(t.texts(501).length, n, 'промежуточные порции — водителю ничего');
  // последняя порция — без отгрузок, но точки менялись в прошлых порциях
  t.s.post({ token: '', ops: [{ t: 'set', v: { speed: 30 } }] });
  const m = t.texts(501).slice(n);
  assert.equal(m.length, 1); assert.match(m[0], /Задание изменилось\.\n\n📋 Задание: партия 26\.09\.2026\n🚚 Gazel-2 · точек: 2/);
  t.s.post({ token: '', ops: [{ t: 'set', v: { speed: 31 } }] });
  assert.equal(t.texts(501).length, n + 1, 'дальше правки не про отгрузки — тишина');
});

test('версия 18: «Отправить» после правок журнала — только новое задание; «всем» тот же план не повторяет; выбранному — всегда', () => {
  const t = approved();
  assert.equal(t.s.post({ token: '', tg: { action: 'dispatch', date: TODAY } }).sent.length, 1);
  const n = t.texts(501).length;
  const r2 = t.s.post({ token: '', tg: { action: 'dispatch', date: TODAY } });
  assert.deepEqual([r2.sent.length, r2.already.length], [0, 1]); assert.match(r2.already[0].why, /^уже получил этот план в \d\d:\d\d$/);
  assert.equal(t.texts(501).length, n, 'тот же план второй раз не пришёл');
  // сайт дописывает журнал перед отправкой (quiet) — водителю ничего; «Отправить» — одно сообщение с новым заданием
  t.s.post({ token: '', quiet: true, ops: [move902('Gazel-3')] });
  assert.equal(t.texts(501).length, n);
  const r3 = t.s.post({ token: '', tg: { action: 'dispatch', date: TODAY } });
  assert.deepEqual([r3.sent.length, r3.already.length], [1, 0]);
  const m = t.texts(501).slice(n);
  assert.equal(m.length, 1); assert.match(m[0], /^📋 Задание: партия 26\.09\.2026\n🚚 Gazel-2 · точек: 2/);
  // «Отправить» в строке водителя — отправляется, даже если план тот же (водитель удалил сообщение)
  assert.equal(t.s.post({ token: '', tg: { action: 'dispatch', date: TODAY, ids: ['501'] } }).sent.length, 1);
  assert.equal(t.texts(501).length, n + 2);
});

test('версия 18: водитель уже везёт партию — «Отправить всем» его не сбрасывает (шаг «фото» остаётся); изменения — одним сообщением с карточкой', () => {
  const t = approved(), g = t.group.id;
  t.msg(501, '🚚 Начать работу'); t.loc(501, DEPOT);
  t.cb(501, 'ok:BL-901|1');
  const n = t.texts(501).length;
  const r = t.s.post({ token: '', tg: { action: 'dispatch', date: TODAY } });
  assert.deepEqual([r.sent.length, r.already.map(x => x.why)], [0, ['уже везёт эту партию']]);
  assert.equal(t.texts(501).length, n, 'водителю ничего');
  t.photo(501, 'P'); t.msg(501, '✅ Готово'); t.loc(501, [41.31, 69.21]);
  assert.match(t.last('sendPhoto', g).caption, /доставлено: BL-901/, 'шаг «фото» не сброшен — доставка записана');
  // на карточке BL-902: точку рейса 2 (BL-903) отдали другой машине — одно сообщение: «рейсы изменились» над карточкой
  const k = t.texts(501).length, b3 = { date: TODAY, bl: 'BL-903', cbm: 4, kg: 900, places: 30, truck: 'Gazel-2', route: 2, status: 'Rejada', note: '' };
  t.s.post({ token: '', ops: [{ t: 'ship.upsert', row: 8, guard: { bl: 'BL-903', date: TODAY }, was: b3, v: { ...b3, truck: 'Gazel-3' } }] });
  const m = t.texts(501).slice(k);
  assert.equal(m.length, 1); assert.match(m[0], /^⚠️ Ваши рейсы на сегодня изменились\.\n\n📦 Точка 2 из 2 · рейс 1\n\n🏷 BL-902/);
});

test('версия 18: «Отправить» одному водителю после правок — другому, чей план тоже изменился, одно «Задание изменилось»', () => {
  const t = approved();
  register(t, 502, 'ru', 2); t.cb(900, 'allow:502', t.group);
  const r1 = t.s.post({ token: '', tg: { action: 'dispatch', date: TODAY } });
  assert.deepEqual(r1.sent.map(x => x.truck).sort(), ['Gazel-2', 'Gazel-3']);
  const a = t.texts(501).length, b = t.texts(502).length;
  t.s.post({ token: '', quiet: true, ops: [move902('Gazel-3')] });
  assert.deepEqual([t.texts(501).length, t.texts(502).length], [a, b]);
  t.s.post({ token: '', tg: { action: 'dispatch', date: TODAY, ids: ['501'] } });
  const m1 = t.texts(501).slice(a), m2 = t.texts(502).slice(b);
  assert.equal(m1.length, 1); assert.match(m1[0], /^📋 Задание: партия 26\.09\.2026\n🚚 Gazel-2 · точек: 2/);
  assert.equal(m2.length, 1); assert.match(m2[0], /^⚠️ Задание изменилось\.\n\n📋 Задание: партия 26\.09\.2026\n🚚 Gazel-3/);
});

test('версия 18: сайт не дописал порции — водитель узнаёт об изменении по таймеру через 2 минуты, один раз', () => {
  const t = approved();
  t.s.post({ token: '', tg: { action: 'dispatch', date: TODAY } });
  const n = t.texts(501).length;
  at(t, 10, 0); t.s.post({ token: '', more: true, ops: [move902('Gazel-3')] });
  at(t, 10, 1); t.s.ctx.tgTick(); assert.equal(t.texts(501).length, n, 'через минуту — ещё ждём');
  at(t, 10, 5); t.s.ctx.tgTick(); assert.equal(t.texts(501).length, n + 1);
  assert.match(t.texts(501).pop(), /Задание изменилось/);
  at(t, 10, 10); t.s.ctx.tgTick(); assert.equal(t.texts(501).length, n + 1);
});

test('версия 18: «Принять план» → «Позже»: тихая запись, затем пустая — водителю с прежним заданием одно «Задание изменилось»', () => {
  const t = approved();
  t.s.post({ token: '', tg: { action: 'dispatch', date: TODAY } });
  const n = t.texts(501).length;
  t.s.post({ token: '', quiet: true, ops: [move902('Gazel-3')] });
  assert.equal(t.texts(501).length, n);
  t.s.post({ token: '', ops: [] });
  const m = t.texts(501).slice(n);
  assert.equal(m.length, 1); assert.match(m[0], /^⚠️ Задание изменилось\./);
  t.s.post({ token: '', ops: [] });
  assert.equal(t.texts(501).length, n + 1, 'повторная пустая запись — тишина');
});

test('версия 20: следующая точка — только после фото и геолокации предыдущей; в задании списка нет (узбекский тоже)', () => {
  const t = approved();
  const seen = () => t.tg.sent.filter(x => String(x.chat_id) === '501').map(x => (x.text || '') + (x.latitude ? ' LL' + x.latitude : '')).join('\n');
  const next = () => /BL-902|Yunusobod|Amir Temur|LL41\.36/.test(seen());   // адрес, телефон, метка второй точки
  t.s.post({ token: '', tg: { action: 'dispatch', date: TODAY } });
  assert.ok(!/BL-90/.test(seen()), 'в задании нет ни одного BL');
  t.msg(501, '🚚 Начать работу'); t.loc(501, DEPOT);
  assert.match(seen(), /BL-901/); assert.ok(!next(), 'после начала — только первая точка');
  t.cb(501, 'ok:BL-901|1'); t.msg(501, '✅ Готово');
  assert.match(t.texts(501).pop(), /Сначала сделайте фото/); assert.ok(!next(), '«Готово» без фото — вторая точка не пришла');
  t.photo(501, 'P1'); assert.ok(!next(), 'фото есть, но «Готово» не нажато');
  t.msg(501, '✅ Готово'); assert.match(t.texts(501).pop(), /Отправьте геолокацию/); assert.ok(!next(), 'ждём геолокацию');
  t.loc(501, [41.311, 69.211]);
  assert.ok(next(), 'после фото и геолокации — вторая точка'); assert.match(t.texts(501).filter(x => /Точка/.test(x)).pop(), /Точка 2 из 2 · рейс 1[\s\S]*BL-902/);
  // «Не доставлено»: без фото места тоже дальше не пускает
  const u = approved(), seenU = () => u.tg.sent.filter(x => String(x.chat_id) === '501').map(x => x.text || '').join('\n');
  u.msg(501, '🚚 Начать работу'); u.loc(501, DEPOT);
  u.cb(501, 'fail:BL-901|1'); u.cb(501, 'why:0'); u.msg(501, '✅ Готово');
  assert.match(u.texts(501).pop(), /Сначала сделайте фото/); assert.ok(!/BL-902/.test(seenU()), 'не доставлено без фото места — вторая точка не пришла');
  u.photo(501, 'F1'); u.msg(501, '✅ Готово'); u.loc(501, DEPOT);
  assert.match(seenU(), /BL-902/);
  // узбекский: в задании тоже только число точек
  const z = setup(); const r = connect(z); z.gmsg(900, '/ulash ' + r.tg.code); register(z, 501, 'uz'); z.cb(900, 'allow:501', z.group);
  z.s.post({ token: '', tg: { action: 'dispatch', date: TODAY } });
  const a = z.last('sendMessage', 501).text;
  assert.match(a, /^📋 Topshiriq: 26\.09\.2026 partiyasi\n🚚 Gazel-2 · 3 ta manzil · 2 ta reys\n\n.*Keyingisi faqat yetkazish rasmidan keyin keladi\.$/s); assert.doesNotMatch(a, /BL-9/);
});

// версия 22: откуда и куда — склад отправки (название и адрес по координатам) и адрес клиента
test('версия 22: водителю — «Откуда» (склад отправки и его адрес) и «Куда» (адрес клиента) в задании и в карточке точки', () => {
  const t = approved(), calls = [];
  t.s.book.sheets.Sozlamalar.rows[6] = ['', 'Chuqursoy sklad'];
  const addr = { ru: 'улица Чукурсой 5, Ташкент, Узбекистан', uz: 'Chuqursoy ko‘chasi 5, Toshkent, Oʻzbekiston' };
  let fail = false;
  t.s.ctx.Maps.newGeocoder = () => { let lang; const g = { setLanguage: l => { lang = l; return g; },
    reverseGeocode: (a, b) => { if (fail) throw new Error('quota'); calls.push([lang, a, b]); return { results: [{ types: ['plus_code'], formatted_address: '9GHQ+X2' }, { types: ['street_address'], formatted_address: addr[lang] }] }; } }; return g; };
  const r = t.s.post({ tg: { action: 'dispatch', date: TODAY } });
  assert.deepEqual(r.sent.map(x => x.truck), ['Gazel-2'], JSON.stringify(r));
  const a = t.last('sendMessage', 501).text;
  assert.match(a, /^📋 Задание: партия 26\.09\.2026\n🚚 Gazel-2 · точек: 3 · рейсов: 2\n🏭 Откуда: Chuqursoy sklad — улица Чукурсой 5, Ташкент\n\nЧтобы начать/, a);
  t.msg(501, '🚚 Начать работу'); t.loc(501, DEPOT);
  const card = t.texts(501).filter(x => /Точка 1 из/.test(x)).pop();
  assert.match(card, /🏷 BL-9\d\d[^\n]*\n🏭 Откуда: Chuqursoy sklad — улица Чукурсой 5, Ташкент\n📍 Куда: (Chilonzor, Bunyodkor 1|Yunusobod, Amir Temur 2)\n/, card);
  assert.deepEqual(calls, [['ru', DEPOT[0], DEPOT[1]]], 'адрес склада — один раз, дальше из памяти');
  // по-узбекски — свой адрес, один раз
  assert.equal(t.s.ctx.tgDepotText_('uz'), 'Chuqursoy sklad — Chuqursoy ko‘chasi 5, Toshkent');
  assert.equal(t.s.ctx.tgDepotText_('uz'), 'Chuqursoy sklad — Chuqursoy ko‘chasi 5, Toshkent');
  assert.equal(calls.length, 2);
  // склад переехал — адрес заново; геокодер недоступен — только название
  t.s.book.sheets.Sozlamalar.rows[7] = ['', 41.35];
  fail = true;
  assert.equal(t.s.ctx.tgDepotText_('ru'), 'Chuqursoy sklad');
  fail = false;
  assert.equal(t.s.ctx.tgDepotText_('ru'), 'Chuqursoy sklad — улица Чукурсой 5, Ташкент');
  assert.deepEqual(calls[2], ['ru', 41.35, DEPOT[1]]);
});

// версия 23: кто на какой машине — выбирает владелец на сайте; одна машина — один водитель
test('версия 23: машину назначает сайт — у прежнего водителя она снимается; в рабочем дне — точки новой машины; без машины работу не начать', () => {
  const t = withPlates(approved());
  register(t, 502, 'ru', 2, 'Bobur Aliev'); t.cb(900, 'allow:502', t.group);
  const drv = () => Object.fromEntries(t.s.get({}).data.tg.drivers.map(d => [d.id, [d.truck, d.plate]]));
  assert.deepEqual(drv(), { 501: ['Gazel-2', '01A 123 BC'], 502: ['Gazel-3', '01A 152 BC'] });
  // 501 в работе на Gazel-2, на шаге «фото»
  t.msg(501, '🚚 Начать работу'); t.loc(501, DEPOT);
  const cur = t.s.get({}).data.tg.drivers.find(d => d.id === '501').today.cur.bl;
  t.cb(501, 'ok:' + cur + '|1');
  // сайт: 501 — на Gazel-3; Bobur без машины
  const r = t.s.post({ tg: { action: 'truck', id: '501', truck: 'Gazel-3' } });
  assert.equal(r.ok, true, JSON.stringify(r)); assert.deepEqual(r.freed, ['Bobur Aliev']);
  assert.deepEqual(drv(), { 501: ['Gazel-3', '01A 152 BC'], 502: ['', ''] }, 'госномер — из автопарка');
  assert.equal(t.last('sendMessage', 502).text, '🚚 Машина Gazel-3 больше не за вами. Новую назначит диспетчер.');
  assert.match(t.texts(501).filter(x => /назначена машина/.test(x)).pop(), /^🚚 Вам назначена машина: Gazel-3 · 01A 152 BC\n\n📦 Точка 1 из 1 · рейс 1\n[\s\S]*BL-904/, 'шаг на старой машине сброшен — точка новой');
  assert.deepEqual(t.s.get({}).data.tg.drivers.find(d => d.id === '501').today.cur, { bl: 'BL-904', round: 1 });
  assert.deepEqual(t.status(cur), t.status(cur).map(() => 'Rejada'), 'точка старой машины осталась открытой');
  // без машины: работу не начать, «Отправить» — «нет машины»
  t.msg(502, '🚚 Начать работу');
  assert.equal(t.last('sendMessage', 502).text, '🚚 У вас пока нет машины. Обратитесь к диспетчеру.');
  const dr = t.s.post({ tg: { action: 'dispatch', date: TODAY } });
  assert.ok(dr.skipped.some(x => x.name === 'Bobur Aliev' && x.why === 'нет машины'), JSON.stringify(dr.skipped));
  assert.ok(dr.skipped.some(x => x.truck === 'Gazel-2' && x.why === 'нет водителя в боте'), JSON.stringify(dr.skipped));
  // нет в автопарке или в ремонте — отказ, ничего не меняется
  assert.match(t.s.post({ tg: { action: 'truck', id: '502', truck: 'Gazel-9' } }).error, /^Машины «Gazel-9» нет в автопарке или она в ремонте/);
  const set = t.s.book.sheets.Sozlamalar; set.maxCols = 10; set.set(24, 5, 'ta’mirda');
  assert.match(t.s.post({ tg: { action: 'truck', id: '502', truck: 'Gazel-1' } }).error, /в ремонте/);
  assert.equal(t.s.post({ tg: { action: 'truck', id: '999', truck: 'Gazel-2' } }).error, 'Нет такого водителя');
  // снять машину: водитель в работе остаётся без точек
  const n = t.s.post({ tg: { action: 'truck', id: '501', truck: '' } });
  assert.deepEqual([n.ok, n.freed], [true, []]);
  assert.equal(t.last('sendMessage', 501).text, '🚚 Машина Gazel-3 больше не за вами. Новую назначит диспетчер.');
  assert.deepEqual(drv(), { 501: ['', ''], 502: ['', ''] });
  t.msg(501, '📍 Текущая точка');
  assert.equal(t.last('sendMessage', 501).text, '🚚 У вас пока нет машины. Обратитесь к диспетчеру.');
  // заявка (старый сайт — машина без карточки из заявки): сайт подтверждает с машиной автопарка; у заявок машины нет —
  // снимать не у кого
  register(t, 503, 'uz', 1, 'Dilshod Umarov');
  register(t, 504, 'ru', 0, 'Sardor Nazarov');
  const a = t.s.post({ tg: { action: 'driver', id: '503', status: 'ruxsat', truck: 'Gazel-2' } });
  assert.deepEqual([a.ok, a.freed], [true, []], JSON.stringify(a));
  assert.deepEqual(t.texts(503).slice(-2), ['Ruxsat berildi ✅ Ish kuningizni «🚚 Ishni boshlash» tugmasi bilan boshlang.', '🚚 Sizga mashina biriktirildi: Gazel-2 · 01A 123 BC']);
  assert.ok(!t.texts(504).some(x => /Машина/.test(x)), 'водителю с заявкой не пишем');
  const inf = Object.fromEntries(t.s.get({}).data.tg.drivers.map(d => [d.id, [d.truck, d.status]]));
  assert.deepEqual([inf[503], inf[504]], [['Gazel-2', 'ruxsat'], ['', 'kutilmoqda']]);
  // подтверждение без машины на сайте (старый сайт) — машина из заявки; отказ по машине — статус не меняется
  assert.match(t.s.post({ tg: { action: 'driver', id: '504', status: 'ruxsat', truck: 'Gazel-9' } }).error, /Gazel-9/);
  assert.equal(t.s.get({}).data.tg.drivers.find(d => d.id === '504').status, 'kutilmoqda');
  // тот же водитель, та же машина — без сообщений
  const k = t.tg.sent.length;
  assert.deepEqual(t.s.post({ tg: { action: 'truck', id: '503', truck: 'Gazel-2' } }).freed, []);
  assert.equal(t.tg.sent.filter(x => x.method === 'sendMessage').length, t.tg.sent.slice(0, k).filter(x => x.method === 'sendMessage').length);
});

// версия 25: своя точка отгрузки (Yuborishlar V) — бот ведёт туда, а не на адрес клиента
test('версия 25: локация отгрузки — в карточке «Куда» склад, маршрут на его координаты, ближайшая точка — по ним', () => {
  const t = approved();
  const Y = t.s.book.sheets.Yuborishlar;
  Y.maxCols = 22;
  Y.rows.forEach(r => { if (r[2] === 'BL-901') r[21] = 'Sklad Sergeli · 41.200000, 69.150000'; });   // BL-901 (обе части) — на другой склад
  t.msg(501, '🚚 Начать работу'); t.loc(501, [41.21, 69.16]);   // водитель рядом со складом Sergeli
  const card = t.texts(501).filter(x => /Точка 1 из/.test(x)).pop();
  assert.match(card, /BL-901/, 'ближайшая — по координатам склада, а не по адресу клиента (Chilonzor)');
  assert.match(card, /📍 Куда: Sklad Sergeli\n/, card);
  assert.doesNotMatch(card, /Bunyodkor/);
  const kb = t.last('sendMessage', 501).reply_markup.inline_keyboard.flat().map(b => b.url || '').join(' ');
  assert.match(kb, /rtext=~41\.2,69\.15/, 'маршрут — на склад: ' + kb);
});

test('версия 25: в V вписано название склада клиента (без координат) — точка из «Qoshimcha omborlar»; чужой склад — адрес клиента', () => {
  const t = approved(), ctx = t.s.ctx;
  const Y = t.s.book.sheets.Yuborishlar;
  Y.maxCols = 22;
  Y.rows.forEach(r => { if (r[2] === 'BL-903') r[21] = 'ombor chilonzor'; if (r[2] === 'BL-902') r[21] = 'Ombor Chilonzor'; });
  const W = ctx.SpreadsheetApp.getActiveSpreadsheet().insertSheet('Qoshimcha omborlar');
  W.rows = [[], [], [], ['BL kodi'], ['BL-903', 'STAR', 'Ombor Chilonzor', 41.3, 69.2]];
  ctx.TG_MEMO = null;
  const st = ctx.tgStops_('Gazel-2', '2026-09-26'), by = bl => st.find(s => s.bl === bl);
  assert.deepEqual([by('BL-903').c.lat, by('BL-903').c.lon, by('BL-903').c.address], [41.3, 69.2, 'Ombor Chilonzor']);
  assert.deepEqual([by('BL-902').c.lat, by('BL-902').c.address], [41.36, 'Amir Temur 2'], 'склад другого клиента не подходит');
  assert.equal(by('BL-901').c.address, 'Bunyodkor 1', 'пустой V — адрес клиента');
});

test('версия 27: в V — название точки из анкеты клиента (Mijozlar Z) — бот ведёт туда; «Mijoz manzili» — адрес клиента', () => {
  const t = approved(), ctx = t.s.ctx;
  const Y = t.s.book.sheets.Yuborishlar, C = t.s.book.sheets.Mijozlar;
  Y.maxCols = 22; C.maxCols = 26; C.rows[3][25] = 'Lokatsiyalar';
  C.rows.forEach(r => { if (r[0] === 'BL-903') r[25] = 'Yangi ombor · 41.35, 69.3\nEski · 41.2, 69.1'; });
  Y.rows.forEach(r => { if (r[2] === 'BL-903') r[21] = 'Yangi ombor'; if (r[2] === 'BL-902') r[21] = 'Mijoz manzili'; });
  ctx.TG_MEMO = null;
  const st = ctx.tgStops_('Gazel-2', '2026-09-26'), by = bl => st.find(s => s.bl === bl);
  assert.deepEqual([by('BL-903').c.lat, by('BL-903').c.lon, by('BL-903').c.address], [41.35, 69.3, 'Yangi ombor']);
  assert.deepEqual([by('BL-902').c.lat, by('BL-902').c.address], [41.36, 'Amir Temur 2'], '«Mijoz manzili» — адрес из анкеты');
});

test('версия 28: «Отправить» две партии одним заданием — точки обеих, рейсы общие; утром задание не сбивается', () => {
  const t = approved(), g = t.group.id, ctx = t.s.ctx;
  const r = t.s.post({ token: '', tg: { action: 'dispatch', date: '2026-09-25+2026-09-26' } });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.sent.map(x => [x.truck, x.n]), [['Gazel-2', 4]], 'точки обеих партий: BL-905 (25.09) и 3 точки 26.09');
  assert.match(t.last('sendMessage', 501).text, /^📋 Задание: партия 25\.09\.2026 \+ 26\.09\.2026\n🚚 Gazel-2 · точек: 4 · рейсов: 2/);
  assert.equal(r.tg.drivers[0].assign.date, '2026-09-25+2026-09-26');
  ctx.TG_MEMO = null;
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.tgStops_('Gazel-2', '2026-09-25+2026-09-26').map(s => s.bl + '@' + s.date))), ['BL-901@2026-09-26', 'BL-902@2026-09-26', 'BL-903@2026-09-26', 'BL-905@2026-09-25']);
  // утром по расписанию (партия сегодня) — задание на две партии остаётся
  ctx.tgMorningRun_(TODAY);
  assert.equal(t.s.post({ token: '', tg: { action: 'info' } }).tg.drivers[0].assign.date, '2026-09-25+2026-09-26');
  t.msg(501, '🚚 Начать работу'); t.loc(501, DEPOT);
  assert.match(t.last('sendMessage', g).text, /партия 25\.09\.2026 \+ 26\.09\.2026 · точек: 4/);
  // неверная дата — ошибка
  assert.equal(t.s.post({ token: '', tg: { action: 'dispatch', date: '2026-09-25+x' } }).error, 'Выберите партию');
});

test('версия 29: «📤 В группу» — сводка, потом каждый клиент отдельной карточкой с кнопками маршрута; больше 19 — с паузами', () => {
  const t = approved(), g = t.group.id;
  const items = [
    { bl: 'BL-901', who: 'NOVA — Aziz', own: true, place: 'Sklad Sergeli', lat: 41.2205, lon: 69.2201, cargo: '2,5 м³ · 300 кг · 12 мест', recv: 'Omon · +998900000022' },
    { bl: 'BL-902', who: 'Botir', own: false, place: 'Amir Temur 2, Yunusobod', lat: 41.36, lon: 69.28, cargo: '1 м³ · 100 кг', recv: '' },
    { bl: 'BL-903', who: 'STAR', own: false, place: 'Yangi Sergeli 3', lat: '', lon: '', cargo: '', recv: '' }];
  const n0 = t.tg.sent.length;
  const r = t.s.post({ token: '', tg: { action: 'batchinfo', batch: { title: 'Партия 26.09.2026', head: ['📦 Партия 26.09.2026 — клиентов: 3', '3,5 м³ · 400 кг'], items } } });
  assert.equal(r.ok, true, JSON.stringify(r)); assert.deepEqual([r.sent, r.of], [4, 4], 'сводка + 3 карточки');
  const ms = t.tg.sent.slice(n0).filter(x => x.method === 'sendMessage' && String(x.chat_id) === String(g));
  assert.equal(ms[0].text, '📦 Партия 26.09.2026 — клиентов: 3\n3,5 м³ · 400 кг');
  assert.equal(ms[1].text, '📦 Партия 26.09.2026 · 1 из 3\n\n🏷 BL-901 · NOVA — Aziz\n📍 Куда: Sklad Sergeli (своя точка)\n👤 Получатель: Omon · +998900000022\n📦 2,5 м³ · 300 кг · 12 мест');
  assert.deepEqual(JSON.parse(JSON.stringify(ms[1].reply_markup.inline_keyboard[0].map(b => b.text + ' ' + b.url))), ['🧭 Яндекс https://yandex.uz/maps/?rtext=~41.2205,69.2201&rtt=auto', '🗺 Google https://www.google.com/maps/dir/?api=1&destination=41.2205,69.2201']);
  assert.equal(ms[2].text, '📦 Партия 26.09.2026 · 2 из 3\n\n🏷 BL-902 · Botir\n📍 Куда: Amir Temur 2, Yunusobod\n📦 1 м³ · 100 кг');
  assert.equal(ms[3].text, '📦 Партия 26.09.2026 · 3 из 3\n\n🏷 BL-903 · STAR\n📍 Куда: Yangi Sergeli 3\n\nТочки на карте нет — по адресу.');
  assert.equal(ms[3].reply_markup, undefined, 'без координат — без кнопок');
  assert.ok(!(t.s.book.slept || []).length, 'до 19 сообщений — без пауз');
  // 30 клиентов — после 19-го сообщения паузы ~3 с (не больше 20 в минуту в группу)
  const many = Array.from({ length: 30 }, (_, i) => ({ bl: 'BL-' + (1000 + i), who: 'Mijoz ' + i, own: false, place: 'Manzil ' + i, lat: 41.3, lon: 69.2, cargo: '1 м³', recv: '' }));
  const r2 = t.s.post({ token: '', tg: { action: 'batchinfo', batch: { title: 'Партия', head: ['📦 Партия'], items: many } } });
  assert.deepEqual([r2.sent, r2.of], [31, 31]);
  assert.equal((t.s.book.slept || []).length, 12, '31 сообщение — 12 пауз');
  assert.ok(t.s.book.slept.every(x => x >= 3000));
  // пустая партия — ошибка
  assert.match(t.s.post({ token: '', tg: { action: 'batchinfo', batch: { items: [] } } }).error, /нет отгрузок/);
});

// версия 30: карточка водителя с сайта — имя и телефон (Haydovchilar K), удалить водителя
test('версия 30: имя и телефон водителя с сайта, телефон — текстом в K; удалить — строка убрана, водителю «нет доступа»', () => {
  const t = approved();
  register(t, 502, 'uz', 2, 'Bobur Aliev'); t.cb(900, 'allow:502', t.group);
  const drv = id => t.s.get({}).data.tg.drivers.find(d => d.id === id);
  const sh = t.s.book.sheets.Haydovchilar;
  assert.equal(drv('501').phone, '+998901234561', 'телефон — с регистрации');
  let r = t.s.post({ tg: { action: 'drvedit', id: '501', name: '  Akmal   Karimov aka ', phone: '+998 90 123-45-67' } });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual([drv('501').name, drv('501').phone], ['Akmal Karimov aka', '+998901234567']);
  assert.equal(sh.rows[0][10], 'Telefon', 'заголовок K дописан');
  const row = sh.rows.find(x => String(x[0]) === '501');
  assert.deepEqual([row[1], row[10]], ['Akmal Karimov aka', '+998901234567']);
  assert.equal(r.tg.drivers.find(d => d.id === '501').phone, '+998901234567', 'ответ — свежий список водителей');
  // только телефон — имя прежнее; пустое имя и кривой телефон — отказ
  t.s.post({ tg: { action: 'drvedit', id: '501', phone: '' } });
  assert.deepEqual([drv('501').name, drv('501').phone], ['Akmal Karimov aka', '']);
  assert.equal(t.s.post({ tg: { action: 'drvedit', id: '501', name: '   ' } }).error, 'Укажите имя водителя');
  assert.match(t.s.post({ tg: { action: 'drvedit', id: '501', phone: '12' } }).error, /^Телефон: 7–15 цифр/);
  assert.equal(t.s.post({ tg: { action: 'drvedit', id: '999', name: 'X' } }).error, 'Нет такого водителя');
  // правка не трогает машину, язык и состояние бота
  assert.deepEqual([drv('501').truck, drv('501').status, drv('501').lang], ['Gazel-2', 'ruxsat', 'ru']);
  // удалить: строка убрана, водителю — «нет доступа», клавиатура снята; второй водитель на месте
  const n0 = sh.rows.length;
  r = t.s.post({ tg: { action: 'drvdel', id: '502' } });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(sh.rows.length, n0 - 1);
  assert.equal(drv('502'), undefined);
  assert.ok(drv('501'), 'другой водитель на месте');
  const m = t.last('sendMessage', 502);
  assert.equal(m.text, 'Sizga botdan foydalanish ruxsati yo‘q. Rahbarga murojaat qiling.');
  assert.deepEqual(m.reply_markup, { remove_keyboard: true });
  assert.equal(t.s.post({ tg: { action: 'drvdel', id: '502' } }).error, 'Нет такого водителя');
  // написал боту снова — как новый: регистрация заново
  t.msg(502, '/start');
  assert.match(t.last('sendMessage', 502).text, /til|язык|Tilni/i);
});
