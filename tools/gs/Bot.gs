// ───────────── Телеграм-бот для водителей (версия 9) ─────────────
// Токен бота — в свойстве скрипта TG_TOKEN (от @BotFather); на сайт и в репозиторий он не попадает.
// Telegram присылает обновления на ссылку веб-приложения с ?tg=<секрет> (TG_SECRET создаётся при «Подключить бота» на сайте).
// Ответ Telegram — через HtmlService: ContentService отвечает переадресацией 302, и Telegram слал бы обновление повторно;
// повторы одного update_id всё равно отсекаются (CacheService).
// Водитель: /start → язык → имя → машина из автопарка → госномер → заявка в группу офиса («Разрешить / Отклонить» —
// только администраторы группы) → меню. Рабочий день: «Ishni boshlash» (геолокация) → точки по одной: «Yetkazildi»
// (фото → геолокация) или «Yetkazilmadi» (причина, фото по желанию, геолокация) → статус в журнале, фото на Google Диск,
// отчёт в группу → следующая точка — ближайшая к месту отметки; рейс 2 — после возвращения на склад; «Ishni tugatish».
// Листы: «Haydovchilar» (водители и состояние диалога), «Yetkazish» (отметки доставки), «Ish kuni» (начало и конец дня).
var TG_API = 'https://api.telegram.org/';
var TG = { drivers: 'Haydovchilar', log: 'Yetkazish', days: 'Ish kuni', problems: 'Muammolar', subs: 'Obunalar' };
var TG_HEAD = {
  drivers: ['Telegram ID', 'Ism', 'Mashina', 'Davlat raqami', 'Til', 'Holat', 'Ro‘yxatdan o‘tgan', 'Tasdiqlagan', 'Telegram', 'Bot holati (tizim uchun)', 'Telefon',
    'Mashina turi', 'Marka va model', 'Kuzov (U×K×B), m', 'Hajm, m³', 'Yuk, kg'],
  log: ['Vaqt', 'Sana', 'Haydovchi', 'Mashina', 'BL', 'Mijoz', 'Natija', 'Sabab', 'Rasmlar', 'Joylashuv', 'Telegram ID', 'Reys', 'Kutdi (daq)', 'Mijozgacha (km)'],
  days: ['Sana', 'Haydovchi', 'Mashina', 'Boshlandi', 'Boshlanish joyi', 'Tugadi', 'Tugash joyi', 'Yetkazildi', 'Yetkazilmadi', 'Telegram ID', 'Partiya'],
  problems: ['Vaqt', 'Haydovchi', 'Mashina', 'Turi', 'Izoh', 'Rasmlar', 'Joylashuv', 'Telegram ID'],
  subs: ['Telegram ID', 'BL', 'Ism', 'Telefon', 'Holat', 'Sana', 'Tasdiqlagan', 'Holat (tizim uchun)']
};
// ── клиенты: подписка на уведомления о своём грузе (тексты для клиентов — на узбекском, латиницей) ──
var TXC = {
  hello: 'Assalomu alaykum! Bu — BURAQ logistics boti.\nYukingiz yo‘lga chiqqanda va yetkazilganda shu yerga xabar beramiz.',
  askPhone: 'Obuna bo‘lish uchun telefon raqamingizni yuboring — pastdagi tugmani bosing 👇', bPhone: '📱 Raqamni yuborish',
  askBl: 'BL kodingizni yozing (masalan: BL-202).', badBl: 'Bunday BL kod topilmadi. Tekshirib, qayta yozing yoki menejerga murojaat qiling.',
  notOwn: 'Iltimos, o‘zingizning raqamingizni pastdagi tugma orqali yuboring 👇',
  ok: '✅ Obuna bo‘ldingiz: {bl}. Yukingiz yo‘lga chiqqanda va yetkazilganda xabar beramiz.\nObunani bekor qilish: /stop',
  pending: 'Raqamingiz mijoz kartasida topilmadi. Menejer tasdiqlagach, xabarlar kela boshlaydi.',
  rejected: 'Obuna tasdiqlanmadi. Savollar bo‘lsa, menejerga murojaat qiling.',
  stopped: 'Obuna bekor qilindi. Qayta obuna bo‘lish uchun menejerdan havola so‘rang.',
  help: 'Yukingiz holati haqida xabarlar shu yerga keladi.{disp}\nObunani bekor qilish: /stop',
  today: '📦 BURAQ logistics: yukingiz ({bl} · {places} joy) bugun yetkaziladi. Haydovchi yo‘lga chiqqanda xabar beramiz.',
  onWay: '🚚 Haydovchi sizga yo‘lda! {eta}\nMashina: {truck}.{disp}',
  eta: 'Taxminan {time} da yetib boradi.', etaNone: 'Tez orada yetib boradi.',
  noAnswer: '📞 Haydovchi manzilingiz yonida, lekin telefoningizga javob yo‘q. Iltimos, qo‘ng‘iroqqa javob bering.{disp}',
  delivered: '✅ Yukingiz yetkazildi: {bl} · {places} joy. BURAQ logistics bilan ishlaganingiz uchun rahmat!',
  failed: 'Bugun yukingizni ({bl}) yetkazib bera olmadik. Sabab: {reason}.\nYetkazish qayta rejalashtiriladi.{disp}',
  disp: '\nSavollar bo‘lsa: {phone}'
};
function txc_(k, vars) {
  var p = tgDispatcher_().phone, v = Object.assign({ disp: p ? TXC.disp.replace('{phone}', p) : '' }, vars || {}), out = TXC[k];
  Object.keys(v).forEach(function (x) { out = out.split('{' + x + '}').join(v[x]); });
  return out;
}
// «Проблема в пути»: вид — кнопкой; в таблицу и на сайт — по-русски, без значка
var TG_PROBLEMS = { uz: ['🔧 Mashina buzildi', '🚦 Tirbandlik', '💥 YTH (avariya)', '👮 YPX / jarima', '⛽ Yoqilg‘i', '✍️ Boshqa'], ru: ['🔧 Поломка', '🚦 Пробка', '💥 ДТП', '👮 ГАИ / штраф', '⛽ Топливо', '✍️ Другое'] };
var TG_DONE = ['Yetkazildi', 'Qolib ketgan', 'Mijoz ozi oldi', 'Bekor qilindi'];   // точка с таким статусом водителю больше не нужна
var TG_NOT_TRUCKS = ['Belgilanmagan', 'Mijoz ozi oladi'];
var TG_REASONS = { uz: ['Mijoz yo‘q', 'Telefonga javob bermayapti', 'Yukni olmadi', 'Boshqa sabab'], ru: ['Клиента нет на месте', 'Не отвечает на телефон', 'Отказался от груза', 'Другая причина'] };

// Тексты: водителю — на его языке (узбекский латиницей или русский), в группу офиса — по-русски.
var TX = {
  uz: {
    hello: 'Assalomu alaykum! Bu BURAQ logistics haydovchilari uchun bot.\nTilni tanlang:',
    askName: 'Ismingiz va familiyangizni yozing (masalan: Akmal Karimov).',
    badName: 'Ismni harflar bilan yozing (2–40 belgi).',
    askPlate: 'Mashinaning davlat raqamini yozing (masalan: 01 A 123 BC).',
    badPlate: 'Raqamni harf va raqamlar bilan yozing (masalan: 01 A 123 BC).',
    check: 'Tekshiring:\n👤 {name}\n🚚 {truck}\n🔢 {plate}', send: '✅ Yuborish', redo: '✏️ Qaytadan',
    askPhone: 'Telefon raqamingizni yuboring: pastdagi «📞 Raqamni yuborish» tugmasini bosing yoki raqamni yozing (masalan: +998 90 123 45 67).',
    bPhone: '📞 Raqamni yuborish', badPhone: 'Raqamni to‘liq yozing: 9–15 raqam (masalan: +998 90 123 45 67).', notOwnPhone: 'O‘zingizning raqamingizni yuboring — tugma orqali.',
    askKind: 'Mashinangiz qanday? Turini tanlang:',
    askModel: 'Mashina markasi va modelini yozing (masalan: GAZelle Next).', badModel: 'Marka va modelni yozing (2–40 belgi).',
    askBody: 'Kuzov o‘lchamlari, metrda: uzunlik × kenglik × balandlik (masalan: 4.2 2.1 2.2).',
    badBody: 'Uchta sonni metrda yozing: uzunlik, kenglik, balandlik (masalan: 4.2 2.1 2.2).',
    askKg: 'Yuk ko‘tarish quvvati, kg (masalan: 1500).', badKg: 'Yuk ko‘tarish quvvatini kg da yozing: 100 dan 40 000 gacha (masalan: 1500).',
    checkCar: 'Tekshiring:\n👤 {name}\n📞 {phone}\n🚚 {kind} · {plate}\n🏷 {model}\n📐 Kuzov {body} m — {m3} m³\n⚖️ {kg} kg',
    sent: 'Arizangiz rahbarga yuborildi. Tasdiqlanganda xabar beramiz.',
    pending: 'Arizangiz ko‘rib chiqilmoqda. Tasdiqlanganda xabar beramiz.',
    approved: 'Ruxsat berildi ✅ Ish kuningizni «🚚 Ishni boshlash» tugmasi bilan boshlang.',
    rejected: 'Arizangiz rad etildi. Savol bo‘lsa, rahbarga murojaat qiling.',
    off: 'Sizga botdan foydalanish ruxsati yo‘q. Rahbarga murojaat qiling.',
    bStart: '🚚 Ishni boshlash', bCur: '📍 Joriy manzil', bEnd: '🏁 Ishni tugatish', bLang: '🌐 Til',
    bLoc: '📍 Joylashuvni yuborish', bCancel: '↩️ Bekor qilish', bDone: '✅ Tayyor', bSkip: '➡️ Rasmsiz davom etish',
    menu: 'Menyu 👇', langSet: 'Til: o‘zbekcha ✅',
    askLocStart: 'Ishni boshlash uchun joylashuvingizni yuboring 👇', askLocEnd: 'Ishni tugatish uchun joylashuvingizni yuboring 👇', askLoc: 'Joylashuvingizni yuboring 👇',
    needLoc: 'Pastdagi «📍 Joylashuvni yuborish» tugmasini bosing.',
    noStops: 'Bugun {truck} uchun manzillar yo‘q. Reja jurnalga yozilgach, «📍 Joriy manzil» tugmasini bosing.',
    truckSet: '🚚 Sizga mashina biriktirildi: {truck}', truckOff: '🚚 {truck} mashinasi endi sizga biriktirilmagan. Yangisini dispetcher biriktiradi.',
    noTruck: '🚚 Sizda hozircha mashina yo‘q. Dispetcherga murojaat qiling.',
    stop: '📦 {i}/{n} manzil · {round}-reys', client: 'Mijoz', addr: 'Manzil', from: 'Qayerdan', to: 'Qayerga', noAddr: 'manzil ko‘rsatilmagan', recv: 'Qabul qiluvchi', tel: 'Tel', cargo: '{places} joy · {cbm} m³ · {kg} kg', note: 'Izoh', noCoords: 'Xaritada nuqta yo‘q — manzil bo‘yicha boring.',
    bOk: '✅ Yetkazildi', bFail: '❌ Yetkazilmadi',
    askPhoto: '📷 Yukni suratga oling 👇',
    askPhotoChat: 'Yetkazilgan yukning rasmini yuboring (bir yoki bir nechta), keyin «✅ Tayyor» tugmasini bosing.',
    photoOk: '✅ Rasm qabul qilindi ({n}). «✅ Tayyor» tugmasini bosing.', needPhoto: '📷 Avval suratga oling 👇', photoCap: '✅ Rasm qabul qilindi', bCamMore: '📷 Yana rasm',
    bCam: '📷 Suratga olish', camOnly: 'Rasm — faqat shu tugma orqali 👇',
    bRoute: '🧭 Yo‘nalish (Yandex)', bRouteG: '🧭 Google Maps', bWait: '⏳ Mijozni kutyapman',
    waiting: '⏳ Mijozni {until} gacha kutasiz. Mijoz kelsa — «✅ Yetkazildi», kelmasa — «❌ Yetkazilmadi».', waitOver: '⏰ {min} daqiqa o‘tdi. Mijoz keldimi?', bMore: '⏳ Yana {min} daqiqa',
    askReason: 'Sababni tanlang:', askReasonText: 'Sababni qisqacha yozing.',
    askPhotoFail: '📷 Joyni suratga oling (eshik, manzil) 👇',
    askPhotoFailChat: 'Joyning rasmini yuboring (yopiq eshik, manzil), keyin «✅ Tayyor» tugmasini bosing.',
    saved: 'Saqlandi ✅', next: 'Keyingi manzil 👇',
    roundDone: '{round}-reys tugadi. Omborga qayting, {next}-reys yukini oling va tugmani bosing.', bRound: '▶️ {next}-reysni boshlash',
    allDone: 'Bugungi barcha manzillar tugadi 👏 «🏁 Ishni tugatish» tugmasini bosing.',
    endDay: 'Ish kuni tugadi. Yetkazildi: {ok}, yetkazilmadi: {fail}, qoldi: {left}. Rahmat!',
    notWorking: 'Avval «🚚 Ishni boshlash» tugmasini bosing.', already: 'Ish kuni allaqachon boshlangan.',
    stale: 'Bu tugma eskirgan — joriy manzil pastda.', staleNow: 'Bu tugma eskirgan — joriy manzil:', changed: '⚠️ Bugungi reyslaringiz o‘zgardi.', busy: 'Avval joriy manzilni yakunlang.',
    unknown: 'Tugmalardan foydalaning 👇',
    assign: '📋 Topshiriq: {date} partiyasi\n🚚 {truck} · {n} ta manzil{rounds}{from}\n\nBoshlash uchun «🚚 Ishni boshlash» tugmasini bosing — bot birinchi manzilni yuboradi. Keyingisi faqat yetkazish rasmidan keyin keladi.', assignRounds: ' · {r} ta reys',
    assignNow: '📋 Yangi topshiriq: {date} partiyasi — {n} ta manzil. Birinchi manzil pastda 👇',
    assignChanged: '⚠️ Topshiriq o‘zgardi.', round: '{round}-reys', msg: '📩 Rahbardan xabar:\n{text}',
    bProblem: '⚠️ Muammo', askProblem: 'Nima bo‘ldi?', probAsk: 'Qisqacha yozing va rasm yuboring (ixtiyoriy), keyin joylashuvni yuboring 👇',
    probPhoto: '📷 Rasm qo‘shildi: {n}. Endi joylashuvni yuboring 👇', probText: 'Yozildi. Endi joylashuvni yuboring 👇', probSent: 'Xabar dispetcherga yuborildi ✅ Kerak bo‘lsa, «📞 Dispetcher» tugmasi bilan qo‘ng‘iroq qiling.',
    bCall: '📞 Dispetcher', dispatcher: '📞 Dispetcher: {name}\n{phone}\nQo‘ng‘iroq qilish uchun raqamni bosing.', noDispatcher: 'Dispetcher raqami hali kiritilmagan. Rahbarga murojaat qiling.',
    noAnswer: '📵 Mijoz telefonga javob bermayapti. Nima qilamiz?', bCallDisp: '📞 Dispetcherga qo‘ng‘iroq', bClientTel: '☎️ Mijoz raqamlari',
    bAnswered: '✅ Mijoz javob berdi — yetkazaman', bStillFail: '❌ Baribir yetkazilmadi', dispAlerted: 'Dispetcherga xabar berildi — u ham mijozga qo‘ng‘iroq qiladi.',
    clientTels: '☎️ {bl} raqamlari:\n{list}', noClientTel: 'Mijozning telefon raqami yo‘q.',
    remindCard: '⏰ {bl}: yetkazdingizmi?', remindEnd: '⏰ Bugungi ish tugadimi? 👇', remindStart: '⏰ Bugun sizni {n} ta manzil kutmoqda 👇'
  },
  ru: {
    hello: 'Здравствуйте! Это бот для водителей BURAQ logistics.\nВыберите язык:',
    askName: 'Напишите имя и фамилию (например: Акмал Каримов).',
    badName: 'Напишите имя буквами (2–40 символов).',
    askPlate: 'Напишите госномер машины (например: 01 A 123 BC).',
    badPlate: 'Напишите номер буквами и цифрами (например: 01 A 123 BC).',
    check: 'Проверьте:\n👤 {name}\n🚚 {truck}\n🔢 {plate}', send: '✅ Отправить', redo: '✏️ Заново',
    askPhone: 'Отправьте номер телефона: нажмите «📞 Отправить номер» внизу или напишите номер (например: +998 90 123 45 67).',
    bPhone: '📞 Отправить номер', badPhone: 'Напишите номер полностью: 9–15 цифр (например: +998 90 123 45 67).', notOwnPhone: 'Отправьте свой номер — кнопкой.',
    askKind: 'Какая у вас машина? Выберите вид:',
    askModel: 'Напишите марку и модель машины (например: GAZelle Next).', badModel: 'Напишите марку и модель (2–40 символов).',
    askBody: 'Размеры кузова в метрах: длина × ширина × высота (например: 4.2 2.1 2.2).',
    badBody: 'Напишите три числа в метрах: длина, ширина, высота (например: 4.2 2.1 2.2).',
    askKg: 'Грузоподъёмность, кг (например: 1500).', badKg: 'Напишите грузоподъёмность в кг: от 100 до 40 000 (например: 1500).',
    checkCar: 'Проверьте:\n👤 {name}\n📞 {phone}\n🚚 {kind} · {plate}\n🏷 {model}\n📐 Кузов {body} м — {m3} м³\n⚖️ {kg} кг',
    sent: 'Заявка отправлена руководителю. Сообщим, когда её подтвердят.',
    pending: 'Заявка на рассмотрении. Сообщим, когда её подтвердят.',
    approved: 'Доступ открыт ✅ Начинайте рабочий день кнопкой «🚚 Начать работу».',
    rejected: 'Заявка отклонена. Если есть вопросы — обратитесь к руководителю.',
    off: 'У вас нет доступа к боту. Обратитесь к руководителю.',
    bStart: '🚚 Начать работу', bCur: '📍 Текущая точка', bEnd: '🏁 Закончить работу', bLang: '🌐 Язык',
    bLoc: '📍 Отправить геолокацию', bCancel: '↩️ Отмена', bDone: '✅ Готово', bSkip: '➡️ Без фото',
    menu: 'Меню 👇', langSet: 'Язык: русский ✅',
    askLocStart: 'Чтобы начать работу, отправьте геолокацию 👇', askLocEnd: 'Чтобы закончить работу, отправьте геолокацию 👇', askLoc: 'Отправьте геолокацию 👇',
    needLoc: 'Нажмите кнопку «📍 Отправить геолокацию» внизу.',
    noStops: 'На сегодня у {truck} точек нет. Когда план запишут в журнал, нажмите «📍 Текущая точка».',
    truckSet: '🚚 Вам назначена машина: {truck}', truckOff: '🚚 Машина {truck} больше не за вами. Новую назначит диспетчер.',
    noTruck: '🚚 У вас пока нет машины. Обратитесь к диспетчеру.',
    stop: '📦 Точка {i} из {n} · рейс {round}', client: 'Клиент', addr: 'Адрес', from: 'Откуда', to: 'Куда', noAddr: 'адрес не указан', recv: 'Получатель', tel: 'Тел', cargo: '{places} мест · {cbm} м³ · {kg} кг', note: 'Примечание', noCoords: 'Точки на карте нет — езжайте по адресу.',
    bOk: '✅ Доставлено', bFail: '❌ Не доставлено',
    askPhoto: '📷 Сфотографируйте груз 👇',
    askPhotoChat: 'Отправьте фото доставленного груза (одно или несколько), затем нажмите «✅ Готово».',
    photoOk: '✅ Фото принято ({n}). Нажмите «✅ Готово».', needPhoto: '📷 Сначала сделайте фото 👇', photoCap: '✅ Фото принято', bCamMore: '📷 Ещё фото',
    bCam: '📷 Сфотографировать', camOnly: 'Фото — только этой кнопкой 👇',
    bRoute: '🧭 Маршрут (Яндекс)', bRouteG: '🧭 Google Maps', bWait: '⏳ Жду клиента',
    waiting: '⏳ Ждёте клиента до {until}. Придёт — «✅ Доставлено», не придёт — «❌ Не доставлено».', waitOver: '⏰ Прошло {min} мин. Клиент пришёл?', bMore: '⏳ Ещё {min} мин',
    askReason: 'Выберите причину:', askReasonText: 'Коротко напишите причину.',
    askPhotoFail: '📷 Сфотографируйте место (ворота, адрес) 👇',
    askPhotoFailChat: 'Отправьте фото места (закрытые ворота, адрес), затем нажмите «✅ Готово».',
    saved: 'Сохранено ✅', next: 'Следующая точка 👇',
    roundDone: 'Рейс {round} закончен. Вернитесь на склад, загрузите рейс {next} и нажмите кнопку.', bRound: '▶️ Начать рейс {next}',
    allDone: 'Все точки на сегодня пройдены 👏 Нажмите «🏁 Закончить работу».',
    endDay: 'Рабочий день закончен. Доставлено: {ok}, не доставлено: {fail}, осталось: {left}. Спасибо!',
    notWorking: 'Сначала нажмите «🚚 Начать работу».', already: 'Рабочий день уже начат.',
    stale: 'Эта кнопка устарела — текущая точка ниже.', staleNow: 'Эта кнопка устарела — вот текущая точка:', changed: '⚠️ Ваши рейсы на сегодня изменились.', busy: 'Сначала завершите текущую точку.',
    unknown: 'Пользуйтесь кнопками 👇',
    assign: '📋 Задание: партия {date}\n🚚 {truck} · точек: {n}{rounds}{from}\n\nЧтобы начать, нажмите «🚚 Начать работу» — бот пришлёт первую точку. Следующая придёт только после фото доставки.', assignRounds: ' · рейсов: {r}',
    assignNow: '📋 Новое задание: партия {date} — точек: {n}. Первая точка ниже 👇',
    assignChanged: '⚠️ Задание изменилось.', round: 'рейс {round}', msg: '📩 Сообщение от руководителя:\n{text}',
    bProblem: '⚠️ Проблема', askProblem: 'Что случилось?', probAsk: 'Коротко опишите и пришлите фото (по желанию), затем отправьте геолокацию 👇',
    probPhoto: '📷 Фото добавлено: {n}. Теперь отправьте геолокацию 👇', probText: 'Записал. Теперь отправьте геолокацию 👇', probSent: 'Сообщение отправлено диспетчеру ✅ Если нужно — позвоните кнопкой «📞 Диспетчер».',
    bCall: '📞 Диспетчер', dispatcher: '📞 Диспетчер: {name}\n{phone}\nНажмите на номер, чтобы позвонить.', noDispatcher: 'Номер диспетчера ещё не указан. Обратитесь к руководителю.',
    noAnswer: '📵 Клиент не отвечает на телефон. Что делаем?', bCallDisp: '📞 Позвонить диспетчеру', bClientTel: '☎️ Номера клиента',
    bAnswered: '✅ Клиент ответил — доставляю', bStillFail: '❌ Всё равно не доставлено', dispAlerted: 'Диспетчеру отправлено сообщение — он тоже позвонит клиенту.',
    clientTels: '☎️ Номера {bl}:\n{list}', noClientTel: 'У клиента нет номера телефона.',
    remindCard: '⏰ {bl}: доставили?', remindEnd: '⏰ Работа на сегодня закончена? 👇', remindStart: '⏰ Сегодня вас ждут точек: {n} 👇'
  }
};
// нажатая кнопка меню — на любом из двух языков (после смены языка у водителя может остаться старая клавиатура)
function tgIs_(text, k) { return text === TX.uz[k] || text === TX.ru[k]; }
function tx_(lang, k, vars) {
  var s = (TX[lang] || TX.uz)[k] || TX.uz[k] || k;
  Object.keys(vars || {}).forEach(function (v) { s = s.split('{' + v + '}').join(vars[v]); });
  return s;
}

// ── Telegram API ──
function tg_(method, payload) {
  var token = prop_('TG_TOKEN');
  if (!token) return { ok: false, description: 'нет TG_TOKEN' };
  var j;
  try {
    var r = UrlFetchApp.fetch(TG_API + 'bot' + token + '/' + method, { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload || {}), muteHttpExceptions: true });
    j = JSON.parse(r.getContentText() || '{}');
  } catch (err) { return { ok: false, description: String((err && err.message) || err) }; }
  // группа стала супергруппой (Telegram меняет её адрес) — запоминаем новый и повторяем
  var to = j && j.parameters && j.parameters.migrate_to_chat_id;
  if (!j.ok && to && payload && String(payload.chat_id) === prop_('TG_GROUP')) { props_().setProperty('TG_GROUP', String(to)); payload.chat_id = to; return tg_(method, payload); }
  return j;
}
function tgSend_(chat, text, markup) { return tg_('sendMessage', { chat_id: chat, text: text, reply_markup: markup, disable_web_page_preview: true }); }
function tgMenu_(lang) {
  var kb = [[tx_(lang, 'bStart'), tx_(lang, 'bCur')], [tx_(lang, 'bEnd'), tx_(lang, 'bLang')], [tx_(lang, 'bProblem')]];
  if (tgDispatcher_().phone) kb[2].push(tx_(lang, 'bCall'));
  return { keyboard: kb, resize_keyboard: true, is_persistent: true };
}
// диспетчер: имя и телефон — свойства скрипта TG_DISP_NAME / TG_DISP_PHONE, задаются на сайте («Водители»)
function tgDispatcher_() { return { name: prop_('TG_DISP_NAME') || 'BURAQ', phone: prop_('TG_DISP_PHONE') }; }
// номер диспетчера — текстом (Telegram делает его ссылкой для звонка) и карточкой контакта с кнопкой «Позвонить»
function tgSendDispatcher_(d) {
  var p = tgDispatcher_();
  if (!p.phone) return tgSend_(d.id, tx_(d.lang, 'noDispatcher'));
  tgSend_(d.id, tx_(d.lang, 'dispatcher', { name: p.name, phone: p.phone }));
  return tg_('sendContact', { chat_id: d.id, phone_number: p.phone, first_name: p.name.slice(0, 64), last_name: d.lang === 'ru' ? 'диспетчер' : 'dispetcher' });
}
// номера клиента точки: телефон клиента, второй, получателя — без повторов
function tgClientTels_(c) {
  var out = [];
  [[c.recvTel, c.receiver], [c.tel1, c.name || c.brand], [c.tel2, '']].forEach(function (x) { var t = String(x[0] || '').trim(); if (t && !out.some(function (o) { return o.t === t; })) out.push({ t: t, who: String(x[1] || '').trim() }); });
  return out;
}
// ── фото только с камеры: мини-приложение сайта (driver.html) открывает камеру, ставит штамп и шлёт снимок в скрипт ──
// TG_SITE — адрес сайта (…/BuraqYetkazish/), TG_URL — ссылка веб-приложения скрипта; TG_CAMERA = 0 — принимать фото из чата
function tgCamera_() { return prop_('TG_CAMERA') !== '0' && /^https:\/\//.test(prop_('TG_SITE')) && !!prop_('TG_URL'); }
function tgCamUrl_(d, w) {
  return prop_('TG_SITE') + 'driver.html?s=' + encodeURIComponent(prop_('TG_URL')) + '&k=' + encodeURIComponent(w.cur.key) + '&bl=' + encodeURIComponent(w.cur.bl) + '&l=' + d.lang + '&m=' + (w.result === 'ok' ? 'ok' : 'fail');
}
function tgPhotoKb_(d, w) {
  var L = d.lang;
  return tgInline_([[{ text: tx_(L, 'bCam'), web_app: { url: tgCamUrl_(d, w) } }], [{ text: tx_(L, 'bCancel'), callback_data: 'pcancel' }]]);
}
function tgPhotoDoneKb_(d, w) {
  var L = d.lang;
  return tgInline_([[{ text: tx_(L, 'bDone'), callback_data: 'pdone' }], [{ text: tx_(L, 'bCamMore'), web_app: { url: tgCamUrl_(d, w) } }]]);
}
// шаг «фото»: с камерой — кнопки в сообщении; без неё — фото из чата и клавиатура «Готово / Отмена»
function tgPhotoAsk_(d, w, key, pre) {
  var L = d.lang;
  if (!tgCamera_()) return tgSend_(d.id, (pre || '') + tx_(L, key + 'Chat'), { keyboard: [[tx_(L, 'bDone')], [tx_(L, 'bCancel')]], resize_keyboard: true });
  return tgSend_(d.id, (pre || '') + tx_(L, key), tgPhotoKb_(d, w));
}
function tgReasonKb_(L) { return tgInline_(TG_REASONS[L].map(function (r, i) { return [{ text: r, callback_data: 'why:' + i }]; })); }
// «Готово» после фото: без фото нельзя; место — со снимка камеры, иначе — геолокация
function tgPhotoDone_(d, w) {
  var L = d.lang;
  if (!(w.photos || []).length) return tgSend_(d.id, tx_(L, 'needPhoto'), tgCamera_() ? tgPhotoKb_(d, w) : undefined);
  if (w.photoLL) return tgFinish_(d, w, w.photoLL);
  w.stage = 'loc'; tgSave_(d);
  return tgSend_(d.id, tx_(L, 'askLoc'), tgLocKb_(L));
}
// карточка точки: доставлено / не доставлено, жду клиента, маршрут в навигаторе
function tgStopKb_(d, s) {
  var L = d.lang, rows = [[{ text: tx_(L, 'bOk'), callback_data: 'ok:' + s.key }, { text: tx_(L, 'bFail'), callback_data: 'fail:' + s.key }], [{ text: tx_(L, 'bWait'), callback_data: 'wait:' + s.key }]];
  if (s.c && s.c.lat && s.c.lon) rows.push([{ text: tx_(L, 'bRoute'), url: 'https://yandex.uz/maps/?rtext=~' + s.c.lat + ',' + s.c.lon + '&rtt=auto' }, { text: tx_(L, 'bRouteG'), url: 'https://www.google.com/maps/dir/?api=1&destination=' + s.c.lat + ',' + s.c.lon + '&travelmode=driving' }]);
  return tgInline_(rows);
}
function tgOkFailKb_(d, key) { return tgInline_([[{ text: tx_(d.lang, 'bOk'), callback_data: 'ok:' + key }, { text: tx_(d.lang, 'bFail'), callback_data: 'fail:' + key }]]); }
function tgWaitMin_() { var n = Math.round(Number(prop_('TG_WAIT_MIN'))); return n >= 5 && n <= 120 ? n : 15; }
function tgMaxKm_() { var n = Number(prop_('TG_MAX_KM')); return n > 0 && n <= 50 ? n : 1; }
// напоминания водителям (TG_REMIND = 0 — выключены); план дня утром — TG_MORNING «ЧЧ:ММ» (05:00–11:00), off — выключен
function tgRemind_() { return prop_('TG_REMIND') !== '0'; }
function tgMorningOk_(s) { return /^(0[5-9]|10):[0-5]\d$|^11:00$/.test(String(s || '')); }
function tgMorning_() { var s = prop_('TG_MORNING'); return s === 'off' ? '' : tgMorningOk_(s) ? s : '08:30'; }
function tgHm_(ms) { return Utilities.formatDate(new Date(ms), SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(), 'HH:mm'); }
function tgLocKb_(lang) { return { keyboard: [[{ text: tx_(lang, 'bLoc'), request_location: true }], [tx_(lang, 'bCancel')]], resize_keyboard: true }; }
function tgInline_(rows) { return { inline_keyboard: rows }; }
function tgNow_(f) { return Utilities.formatDate(new Date(), SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(), f || 'yyyy-MM-dd HH:mm'); }
function tgMap_(ll) { return ll ? 'https://maps.google.com/?q=' + ll[0] + ',' + ll[1] : ''; }
function tgEsc_(s) { return String(s == null ? '' : s); }

// ── листы бота ──
function tgSheet_(k) {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), sh = ss.getSheetByName(TG[k]);
  if (!sh) { sh = ss.insertSheet(TG[k]); sh.getRange(1, 1, 1, TG_HEAD[k].length).setValues([TG_HEAD[k]]).setFontWeight('bold'); sh.setFrozenRows(1); }
  return sh;
}
// лист бота с заголовком нужной длины (новые столбцы дописываются в заголовок листа прошлой версии)
function tgHead_(k) {
  var sh = tgSheet_(k), n = TG_HEAD[k].length, h = sh.getRange(1, 1, 1, n).getValues()[0];
  if (String(h[n - 1] || '') === '') sh.getRange(1, 1, 1, n).setValues([TG_HEAD[k]]);
  return sh;
}
function tgDmy_(iso) { return String(iso || '').split('+').map(function (x) { var p = x.split('-'); return p.length === 3 ? p[2] + '.' + p[1] + '.' + p[0] : x; }).join(' + '); }
// партия бота — одна дата или две через «+» (версия 28: план на две партии — одно задание водителю)
function tgDates_(date) { return String(date || '').split('+').filter(function (x) { return x; }); }
function tgDrivers_() {
  var sh = tgSheet_('drivers'), last = sh.getLastRow(), out = [];
  if (last < 2) return out;
  sh.getRange(2, 1, last - 1, TG_HEAD.drivers.length).getValues().forEach(function (r, i) {
    if (r[0] === '' || r[0] === null) return;
    var st = {}; try { st = JSON.parse(r[9] || '{}'); } catch (err) { st = {}; }
    out.push({ row: 2 + i, id: String(r[0]), name: String(r[1]), truck: String(r[2]), plate: String(r[3]), lang: String(r[4] || 'uz'), status: String(r[5] || ''), at: r[6], by: String(r[7] || ''), user: String(r[8] || ''), st: st,
      phone: String(r[10] == null ? '' : r[10]),   // K «Telefon» — версия 30 (сайт), версия 31 — при регистрации
      kind: String(r[11] || ''), model: String(r[12] || ''), body: String(r[13] || ''), m3: r[14] === '' || r[14] == null ? '' : Number(r[14]), kg: r[15] === '' || r[15] == null ? '' : Number(r[15]) });   // L:P — своя машина (версия 31)
  });
  return out;
}
function tgDriver_(id) { var d = tgDrivers_().filter(function (x) { return x.id === String(id); }); return d[0] || null; }
function tgSave_(d) {
  var sh = tgSheet_('drivers'), row = d.row;
  if (!row) { row = Math.max(2, sh.getLastRow() + 1); d.row = row; }
  sh.getRange(row, 1, 1, TG_HEAD.drivers.length).setValues([[d.id, d.name || '', d.truck || '', d.plate || '', d.lang || 'uz', d.status || '', d.at || '', d.by || '', d.user || '', JSON.stringify(d.st || {}), d.phone || '', d.kind || '', d.model || '', d.body || '', d.m3 === '' || d.m3 == null ? '' : d.m3, d.kg === '' || d.kg == null ? '' : d.kg]]);
  sh.getRange(row, 1).setNumberFormat('@');
  if (d.phone) sh.getRange(row, 11).setNumberFormat('@');   // «+998…» — текстом, не числом
}
function tgTrucks_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH.set);
  if (!sh) return [];
  // машину в ремонте (Sozlamalar E = ta’mirda, версия 21) водителю не предлагаем
  return sh.getRange(TRUCKS_ROW, 3, TRUCKS_N, sh.getMaxColumns() >= 5 ? 3 : 1).getValues().filter(function (r) { return String(r[2] || '').trim() !== FLEET_REPAIR; })
    .map(function (r) { return String(r[0]).trim(); }).filter(function (t) { return t && TG_NOT_TRUCKS.indexOf(t) < 0; });
}

// рабочий день водителя: сегодня начат и не закончен; w.day — календарный день, w.date — дата развозимой партии
function tgWork_(d) {
  var w = d.st && d.st.work;
  if (!w) return null;
  if (!w.day) w.day = w.date;   // состояние версии 9
  return w.day === tgNow_('yyyy-MM-dd') && !w.ended ? w : null;
}
// партия из «Отправить» на сайте (действует 3 дня, до начала работы), иначе — сегодняшняя дата
function tgAssigned_(d) {
  var a = d.st && d.st.assign;
  if (!a || a.used) return null;
  var age = (Date.parse(tgNow_('yyyy-MM-dd')) - Date.parse(a.day)) / 864e5;
  return age >= 0 && age <= 3 ? a : null;
}
function tgPlates_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH.set), out = {};
  if (!sh || sh.getMaxColumns() < 4) return out;   // столбца госномеров ещё нет
  sh.getRange(TRUCKS_ROW, 3, TRUCKS_N, 2).getValues().forEach(function (r) { var t = String(r[0]).trim(), p = String(r[1] || '').trim(); if (t && p) out[t] = p; });
  return out;
}

// ── вход: обновление от Telegram ──
function tgWebhook_(e) {
  var ok = HtmlService.createHtmlOutput('ok'), secret = prop_('TG_SECRET');
  if (!secret || e.parameter.tg !== secret) return ok;
  var u = null;
  try { u = JSON.parse((e.postData && e.postData.contents) || '{}'); } catch (err) { return ok; }
  if (!u || u.update_id == null) return ok;
  var cache = CacheService.getScriptCache(), k = 'tgu:' + u.update_id;
  if (cache.get(k)) return ok;
  cache.put(k, '1', 21600);
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
    tgHandle_(u);
  } catch (err) {
    console.error('Телеграм-бот: ' + ((err && err.stack) || err));
  } finally { try { lock.releaseLock(); } catch (err) { /* блокировку не получили */ } }
  return ok;
}

function tgHandle_(u) {
  if (u.callback_query) return tgCallback_(u.callback_query);
  var m = u.message;
  if (!m || !m.chat) return;
  if (m.chat.type === 'group' || m.chat.type === 'supergroup') return tgGroupMsg_(m);
  if (m.chat.type !== 'private') return;
  var id = String(m.from.id), d = tgDriver_(id), text = String(m.text || '').trim();
  // клиент: ссылка t.me/<бот>?start=<BL> или уже подписан (водители с доступом и заявкой — не клиенты)
  if (!(d && (d.status === 'ruxsat' || d.status === 'kutilmoqda'))) {
    var sp = (text.match(/^\/start\s+(\S+)/) || [])[1], cbl = sp ? tgClientBl_(sp) : '', cs = tgSub_(id);
    if (cbl) return tgClientStart_(id, m, cbl, d);
    if (cs) return tgClientMsg_(cs, m, text);
  }
  if (!d) {
    d = { id: id, lang: 'uz', status: 'yangi', user: m.from.username ? '@' + m.from.username : [m.from.first_name, m.from.last_name].filter(Boolean).join(' '), st: { step: 'lang' } };
    tgSave_(d);
    return tgSend_(id, TX.uz.hello + '\n' + TX.ru.hello.split('\n')[1], tgHelloKb_());
  }
  var L = d.lang;
  if (/^\/start\b/.test(text) && d.status !== 'ruxsat' && d.status !== 'kutilmoqda') { d.st = { step: 'lang' }; tgSave_(d); return tgSend_(id, TX.uz.hello + '\n' + TX.ru.hello.split('\n')[1], tgInline_([[{ text: 'O‘zbekcha', callback_data: 'lang:uz' }, { text: 'Русский', callback_data: 'lang:ru' }]])); }
  // регистрация
  if (d.status !== 'ruxsat') {
    var st = d.st || {};
    if (d.status === 'kutilmoqda') return tgSend_(id, tx_(L, 'pending'));
    if (d.status === 'rad' || d.status === 'o‘chirilgan') return tgSend_(id, tx_(L, d.status === 'rad' ? 'rejected' : 'off'));
    // версия 31: своя машина — имя → телефон → вид → госномер → марка → кузов → грузоподъёмность → проверка
    if (st.step === 'name') {
      if (!/^[^\d\/@#]{2,40}$/.test(text)) return tgSend_(id, tx_(L, 'badName'));
      d.name = text.replace(/\s+/g, ' '); d.st = { step: 'phone' }; tgSave_(d);
      return tgSend_(id, tx_(L, 'askPhone'), tgPhoneKb_(L));
    }
    if (st.step === 'phone') {
      if (m.contact && String(m.contact.user_id || '') !== String(m.from.id)) return tgSend_(id, tx_(L, 'notOwnPhone'), tgPhoneKb_(L));   // чужой контакт
      var dg = String(m.contact ? m.contact.phone_number : text).replace(/[^\d]/g, '');
      if (dg.length < 9 || dg.length > 15) return tgSend_(id, tx_(L, 'badPhone'), tgPhoneKb_(L));
      d.phone = '+' + (dg.length === 9 ? '998' + dg : dg); d.st = { step: 'kind' }; tgSave_(d);
      tgSend_(id, '✅ ' + d.phone, { remove_keyboard: true });
      return tgAskKind_(d);
    }
    if (st.step === 'plate') {
      var plate = text.toUpperCase().replace(/[^0-9A-ZА-ЯЁ]+/g, ' ').trim();
      if (!/^[0-9A-ZА-ЯЁ ]{5,12}$/.test(plate) || !/\d/.test(plate)) return tgSend_(id, tx_(L, 'badPlate'));
      d.plate = plate; d.st = { step: 'model' }; tgSave_(d);
      return tgSend_(id, tx_(L, 'askModel'));
    }
    if (st.step === 'model') {
      if (!/^.{2,40}$/.test(text) || /^\//.test(text)) return tgSend_(id, tx_(L, 'badModel'));
      d.model = text.replace(/\s+/g, ' '); d.st = { step: 'body' }; tgSave_(d);
      return tgSend_(id, tx_(L, 'askBody'));
    }
    if (st.step === 'body') {
      var b = tgBodyParse_(text);
      if (!b) return tgSend_(id, tx_(L, 'badBody'));
      d.body = b.text; d.m3 = b.m3; d.st = { step: 'kg' }; tgSave_(d);
      return tgSend_(id, tx_(L, 'askKg'));
    }
    if (st.step === 'kg') {
      var kg = tgKgParse_(text);
      if (!kg) return tgSend_(id, tx_(L, 'badKg'));
      d.kg = kg; d.st = { step: 'confirm' }; tgSave_(d);
      return tgCheckCar_(d);
    }
    if (st.step === 'kind' || st.step === 'truck') return tgAskKind_(d);   // «truck» — заявка, начатая кодом до 31
    if (st.step === 'confirm') return d.kind ? tgCheckCar_(d) : tgSend_(id, tx_(L, 'check', { name: d.name, truck: d.truck, plate: d.plate }), tgInline_([[{ text: tx_(L, 'send'), callback_data: 'reg:send' }, { text: tx_(L, 'redo'), callback_data: 'reg:redo' }]]));
    if (st.step === 'name') return tgSend_(id, tx_(L, 'askName'));
    return tgSend_(id, TX.uz.hello + '\n' + TX.ru.hello.split('\n')[1], tgInline_([[{ text: 'O‘zbekcha', callback_data: 'lang:uz' }, { text: 'Русский', callback_data: 'lang:ru' }]]));
  }
  // водитель с доступом
  var w = tgWork_(d), pr = d.st.pr;
  if (tgIs_(text, 'bProblem') || /^\/muammo\b/.test(text)) {
    d.st.pr = { stage: 'type' }; tgSave_(d);
    return tgSend_(id, tx_(L, 'askProblem'), tgInline_(TG_PROBLEMS[L].map(function (x, i) { return [{ text: x, callback_data: 'pr:' + i }]; })));
  }
  if (pr && pr.stage === 'info') {   // проблема: описание, фото (можно из галереи), затем геолокация
    if (m.location) return tgProblemDone_(d, w, [m.location.latitude, m.location.longitude]);
    if (m.photo && m.photo.length) { pr.photos = (pr.photos || []).concat([m.photo[m.photo.length - 1].file_id]).slice(0, 5); tgSave_(d); return tgSend_(id, tx_(L, 'probPhoto', { n: pr.photos.length }), tgLocKb_(L)); }
    if (tgIs_(text, 'bCancel')) { delete d.st.pr; tgSave_(d); return tgSend_(id, tx_(L, 'menu'), tgMenu_(L)); }
    if (text && text.charAt(0) !== '/' && !['bStart', 'bCur', 'bEnd', 'bLang', 'bCall'].some(function (k) { return tgIs_(text, k); })) { pr.text = ((pr.text ? pr.text + ' ' : '') + text).slice(0, 300); tgSave_(d); return tgSend_(id, tx_(L, 'probText'), tgLocKb_(L)); }
  }
  if (m.location) return tgLocation_(d, w, [m.location.latitude, m.location.longitude]);
  if (m.photo && m.photo.length) return tgPhoto_(d, w, m.photo[m.photo.length - 1].file_id);
  if (tgIs_(text, 'bCall') || /^\/dispetcher\b/.test(text)) return tgSendDispatcher_(d);
  if (tgIs_(text, 'bLang') || /^\/til\b|^\/lang\b/.test(text)) { d.lang = L === 'uz' ? 'ru' : 'uz'; tgSave_(d); return tgSend_(id, tx_(d.lang, 'langSet'), tgMenu_(d.lang)); }
  if (tgIs_(text, 'bStart') || /^\/ish\b/.test(text)) return tgStartAsk_(d, w);
  if (tgIs_(text, 'bEnd') || /^\/tugatish\b/.test(text)) return tgEndAsk_(d, w);
  if (tgIs_(text, 'bCur') || /^\/hozir\b/.test(text)) {
    if (!w || !w.started) return tgSend_(id, tx_(L, 'notWorking'), tgMenu_(L));
    return tgCurrent_(d, w);
  }
  if (tgIs_(text, 'bCancel')) return tgCancel_(d, w);
  if (w && (w.stage === 'photo' || w.stage === 'failPhoto') && tgIs_(text, 'bDone')) return tgPhotoDone_(d, w);
  if (w && w.stage === 'reasonText' && text) { w.reason = text.slice(0, 200); w.stage = 'failPhoto'; tgSave_(d); return tgPhotoAsk_(d, w, 'askPhotoFail'); }
  if (w && /Loc$|^loc$/.test(w.stage || '')) return tgSend_(id, tx_(L, 'needLoc'), tgLocKb_(L));
  return tgSend_(id, tx_(L, 'unknown'), tgMenu_(L));
}

// «Начать работу» / «Закончить работу» — кнопкой меню, командой или кнопкой в напоминании
function tgStartAsk_(d, w) {
  var L = d.lang;
  if (w && w.started) return tgSend_(d.id, tx_(L, 'already'), tgMenu_(L)) && tgCurrent_(d, w);
  if (!d.truck) return tgSend_(d.id, tx_(L, 'noTruck'), tgMenu_(L));
  var a = tgAssigned_(d);
  d.st.work = { day: tgNow_('yyyy-MM-dd'), date: a ? a.date : tgNow_('yyyy-MM-dd'), stage: 'startLoc' }; tgSave_(d);
  return tgSend_(d.id, tx_(L, 'askLocStart'), tgLocKb_(L));
}
function tgEndAsk_(d, w) {
  var L = d.lang;
  if (!w || !w.started) return tgSend_(d.id, tx_(L, 'notWorking'), tgMenu_(L));
  w.stage = 'endLoc'; tgSave_(d);
  return tgSend_(d.id, tx_(L, 'askLocEnd'), tgLocKb_(L));
}
function tgHelloKb_() { return tgInline_([[{ text: 'O‘zbekcha', callback_data: 'lang:uz' }, { text: 'Русский', callback_data: 'lang:ru' }], [{ text: '📦 Men mijozman — yuk holati', callback_data: 'client' }]]); }
// ── подписки клиентов: лист «Obunalar» ──
function tgSubs_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TG.subs), out = [];   // лист появляется с первым клиентом
  var last = sh ? sh.getLastRow() : 0;
  if (last < 2) return out;
  sh.getRange(2, 1, last - 1, TG_HEAD.subs.length).getValues().forEach(function (r, i) {
    if (r[0] === '' || r[0] === null) return;
    var st = {}; try { st = JSON.parse(r[7] || '{}'); } catch (err) { st = {}; }
    out.push({ row: 2 + i, id: String(r[0]), bl: String(r[1]), name: String(r[2]), phone: String(r[3]), status: String(r[4]), at: r[5], by: String(r[6] || ''), st: st });
  });
  return out;
}
function tgSub_(id) { return tgSubs_().filter(function (c) { return c.id === String(id); })[0] || null; }
function tgSubSave_(c) {
  var sh = tgSheet_('subs'), row = c.row;
  if (!row) { row = Math.max(2, sh.getLastRow() + 1); c.row = row; }
  sh.getRange(row, 1, 1, TG_HEAD.subs.length).setValues([[c.id, c.bl || '', c.name || '', c.phone || '', c.status || '', c.at || '', c.by || '', JSON.stringify(c.st || {})]]);
  sh.getRange(row, 1).setNumberFormat('@');
}
// BL клиента из справочника (без учёта регистра)
function tgClientBl_(x) {
  var u = String(x || '').trim().toUpperCase(), cl = tgData_().cl;
  return Object.keys(cl).filter(function (k) { return k.toUpperCase() === u; })[0] || '';
}
function tgContactKb_() { return { keyboard: [[{ text: TXC.bPhone, request_contact: true }]], resize_keyboard: true, one_time_keyboard: true }; }
function tgClientStart_(id, m, bl, d) {
  if (d && d.row && (!d.status || d.status === 'yangi')) tgSheet_('drivers').deleteRow(d.row);   // начал регистрацию водителя — это клиент
  var c = tgSub_(id) || { id: id };
  c.bl = bl; c.name = [m.from.first_name, m.from.last_name].filter(Boolean).join(' ') + (m.from.username ? ' @' + m.from.username : ''); c.status = 'yangi'; c.st = { step: 'phone', sent: (c.st && c.st.sent) || {} };
  tgSubSave_(c);
  return tgSend_(id, TXC.hello + '\n\n' + TXC.askPhone, tgContactKb_());
}
function tgClientMsg_(c, m, text) {
  var id = c.id, st = c.st || {};
  if (/^\/stop\b/.test(text)) { c.status = 'o‘chirilgan'; tgSubSave_(c); return tgSend_(id, TXC.stopped, { remove_keyboard: true }); }
  if (c.status === 'rad') return tgSend_(id, TXC.rejected);
  if (c.status === 'o‘chirilgan') return tgSend_(id, TXC.stopped);
  if (st.step === 'bl') {
    var bl = tgClientBl_(text);
    if (!bl) return tgSend_(id, TXC.badBl);
    c.bl = bl; c.st.step = 'phone'; tgSubSave_(c);
    return tgSend_(id, TXC.askPhone, tgContactKb_());
  }
  if (st.step === 'phone') {
    if (!m.contact) return tgSend_(id, TXC.askPhone, tgContactKb_());
    if (String(m.contact.user_id || '') !== String(m.from.id)) return tgSend_(id, TXC.notOwn, tgContactKb_());   // чужой контакт не подходит
    var dg = String(m.contact.phone_number || '').replace(/\D/g, ''), cl = tgData_().cl[c.bl] || {};
    var match = dg.length >= 9 && [cl.tel1, cl.tel2, cl.recvTel].some(function (t) { var x = String(t || '').replace(/\D/g, ''); return x.length >= 9 && x.slice(-9) === dg.slice(-9); });
    c.phone = '+' + dg; c.st.step = ''; c.status = match ? 'faol' : 'kutilmoqda'; c.at = tgNow_(); tgSubSave_(c);
    if (match) return tgSend_(id, txc_('ok', { bl: c.bl }), { remove_keyboard: true });
    tgSend_(id, TXC.pending, { remove_keyboard: true });
    var g = tgGroup_();
    if (g) tgSend_(g, '🆕 Клиент хочет получать уведомления о грузе: ' + c.bl + ([cl.brand, cl.name].filter(Boolean).length ? ' ' + [cl.brand, cl.name].filter(Boolean).join(' — ') : '') +
      '\nTelegram: ' + c.name + ' · ' + c.phone + '\nНомера в карточке: ' + ([cl.tel1, cl.tel2, cl.recvTel].filter(Boolean).join(', ') || 'нет') + '\nЭтого номера в карточке нет — подтвердите, если это клиент.',
      tgInline_([[{ text: '✅ Разрешить', callback_data: 'callow:' + c.id }, { text: '❌ Отклонить', callback_data: 'cdeny:' + c.id }]]));
    return;
  }
  if (c.status === 'kutilmoqda') return tgSend_(id, TXC.pending);
  return tgSend_(id, txc_('help'));
}
// уведомление подписчикам BL — один раз на событие (key)
function tgNotify_(bl, key, text, photo) {
  var u = String(bl || '').toUpperCase();
  tgSubs_().filter(function (c) { return c.status === 'faol' && c.bl.toUpperCase() === u; }).forEach(function (c) {
    c.st = c.st || {}; c.st.sent = c.st.sent || {};
    if (c.st.sent[key]) return;
    if (photo) tg_('sendPhoto', { chat_id: c.id, photo: photo, caption: text.slice(0, 1000) }); else tgSend_(c.id, text);
    c.st.sent[key] = 1;
    var ks = Object.keys(c.st.sent); if (ks.length > 30) ks.slice(0, ks.length - 30).forEach(function (k) { delete c.st.sent[k]; });
    tgSubSave_(c);
  });
}
// когда водитель будет у клиента: от места последней отметки, скорость и коэффициент дороги — из «Sozlamalar»
function tgEta_(pos, c) {
  var min = tgTravelMin_(pos, c);
  if (min == null) return TXC.etaNone;
  return TXC.eta.replace('{time}', tgHm_(Math.ceil((new Date().getTime() + min * 60000) / 300000) * 300000));
}
// минут в пути до клиента (null — нет координат)
function tgTravelMin_(pos, c) {
  if (!pos || !c || !c.lat || !c.lon) return null;
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH.set), speed = sh ? Number(sh.getRange(SET_ROWS.speed, 2).getValue()) : 0, k = sh ? Number(sh.getRange(SET_ROWS.roadK, 2).getValue()) : 0;
  return tgKm_(pos, [c.lat, c.lon]) * (k > 0 ? k : 1.3) / (speed > 0 ? speed : 30) * 60 + 5;
}
function tgReasonUz_(reason) { var i = TG_REASONS.ru.indexOf(reason); return i >= 0 ? TG_REASONS.uz[i] : reason || TG_REASONS.uz[3]; }
function tgCancel_(d, w) {
  if (w) { w.stage = w.started ? null : 'none'; w.wait = null; w.photoLL = null; if (!w.started) delete d.st.work; tgSave_(d); }
  return tgSend_(d.id, tx_(d.lang, 'menu'), tgMenu_(d.lang));
}
// ── своя машина водителя (версия 31) ──
var CAR_KINDS = { gazel: 'Gazel', labo: 'Labo', changan: 'Changan', kamaz: 'Kamaz' };
var CAR_COUNT = { gazel: 'gazelCount', labo: 'laboCount', changan: 'changanCount', kamaz: 'cTrucks' };
function tgNum_(x) { return x === '' || x == null ? '—' : String(Math.round(Number(x) * 10) / 10).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
function tgPhoneKb_(L) { return { keyboard: [[{ text: tx_(L, 'bPhone'), request_contact: true }]], resize_keyboard: true, one_time_keyboard: true }; }
function tgAskKind_(d) {
  return tgSend_(d.id, tx_(d.lang, 'askKind'), tgInline_([[{ text: 'Gazel', callback_data: 'kind:gazel' }, { text: 'Labo', callback_data: 'kind:labo' }], [{ text: 'Changan', callback_data: 'kind:changan' }, { text: 'Kamaz', callback_data: 'kind:kamaz' }]]));
}
function tgCheckCar_(d) {
  var L = d.lang;
  return tgSend_(d.id, tx_(L, 'checkCar', { name: d.name, phone: d.phone, kind: CAR_KINDS[d.kind] || d.kind, plate: d.plate, model: d.model, body: d.body, m3: tgNum_(d.m3), kg: tgNum_(d.kg) }),
    tgInline_([[{ text: tx_(L, 'send'), callback_data: 'reg:send' }, { text: tx_(L, 'redo'), callback_data: 'reg:redo' }]]));
}
// кузов «4.2 2.1 2.2», «4,2x2,1x2,2», «420 210 220» (см) → { text: '4,2×2,1×2,2', m3 }; длина 0,5–16, ширина 0,5–3, высота 0,3–4,5 м
function tgBodyParse_(text) {
  var s = String(text || '').replace(/[x×*хХ;\/]/gi, ' ').replace(/(\d),(\d)/g, '$1.$2').replace(/,/g, ' ');
  var n = (s.match(/\d+(?:\.\d+)?/g) || []).map(Number);
  if (n.length !== 3) return null;
  if (n.every(function (x) { return x > 20; })) n = n.map(function (x) { return x / 100; });   // сантиметры
  if (!(n[0] >= 0.5 && n[0] <= 16 && n[1] >= 0.5 && n[1] <= 3 && n[2] >= 0.3 && n[2] <= 4.5)) return null;
  return { text: n.map(function (x) { return String(Math.round(x * 100) / 100).replace('.', ','); }).join('×'), l: n[0], w: n[1], h: n[2], m3: Math.round(n[0] * n[1] * n[2] * 10) / 10 };
}
// грузоподъёмность: «1500», «1 500 кг», «1,5 т» → кг; 100–40 000
function tgKgParse_(text) {
  var t = String(text || ''), m = t.replace(/\s+(?=\d{3}\b)/g, '').replace(',', '.').match(/\d+(?:\.\d+)?/);
  if (!m) return 0;
  var x = Number(m[0]);
  if (/т|t|tonna|тонн/i.test(t) || x <= 40) x *= 1000;
  x = Math.round(x);
  return x >= 100 && x <= 40000 ? x : 0;
}
function tgKind_(t) { t = String(t || ''); return /^gazel/i.test(t) ? 'gazel' : /^labo/i.test(t) ? 'labo' : /^kamaz/i.test(t) ? 'kamaz' : /^changan/i.test(t) ? 'changan' : ''; }
function tgPlateKey_(p) { return String(p || '').toUpperCase().replace(/[^0-9A-ZА-ЯЁ]/g, ''); }
// «Разрешить»: машина водителя — в автопарк (Sozlamalar C24:C39). car — с сайта: { to: машина автопарка, toNew: новая,
// kind, plate, model, l, w, h, m3, kg } (поправленные руководителем); null — из заявки. Машина: to; иначе тот же госномер
// того же вида; иначе свободная машина вида без госномера и водителя (не в ремонте); иначе новая «Вид-N» в пустой строке.
// Пишутся госномер (D), марка (F), объём (H), вес (I), кузов (K:M); год, ремонт и примечание не трогаются.
function tgCarApply_(d, car) {
  var c = car || {}, ss = SpreadsheetApp.getActiveSpreadsheet(), sh = ss.getSheetByName(SH.set);
  var kind = c.kind || d.kind, label = CAR_KINDS[kind];
  if (!sh) return { error: 'Нет листа Sozlamalar' };
  if (!label) return { error: 'Неизвестный вид машины' };
  var num = function (v, lo, hi) { var x = Number(String(v == null ? '' : v).replace(',', '.')); return v !== '' && v != null && isFinite(x) && x >= lo && x <= hi ? x : ''; };
  var bd = tgBodyParse_(d.body) || {}, l = c.l != null ? num(c.l, 0.3, 16) : bd.l || '', w = c.w != null ? num(c.w, 0.3, 3) : bd.w || '', h = c.h != null ? num(c.h, 0.2, 4.5) : bd.h || '';
  var m3 = num(c.m3 != null ? c.m3 : d.m3, 0.1, 200), kg = num(c.kg != null ? c.kg : d.kg, 10, 60000);
  var plate = String(c.plate != null ? c.plate : d.plate || '').toUpperCase().replace(/\s+/g, ' ').trim().slice(0, 16), model = String(c.model != null ? c.model : d.model || '').trim().slice(0, 40);
  if (sh.getMaxColumns() < 13) sh.insertColumnsAfter(sh.getMaxColumns(), 13 - sh.getMaxColumns());
  var head = sh.getRange(TRUCKS_ROW - 1, 5, 1, 6).getValues()[0];
  if (head.some(function (x, i) { x = String(x).trim(); return x !== '' && x !== FLEET_HEAD[i]; }))
    return { error: 'На листе Sozlamalar ячейки E23:J23 заняты — карточка машины пишется в E:J строк 23–39. Освободите их', code: 'busy' };
  var rows = sh.getRange(TRUCKS_ROW, 3, TRUCKS_N, 3).getValues(), names = rows.map(function (r) { return String(r[0]).trim(); }), busy = {};
  tgDrivers_().forEach(function (x) { if (x.id !== d.id && x.truck && (x.status === 'ruxsat' || x.status === 'kutilmoqda')) busy[x.truck] = 1; });
  var i = -1, isNew = false, pk = tgPlateKey_(plate);
  if (c.to) {
    i = names.indexOf(String(c.to).trim());
    if (i < 0) return { error: 'Нет машины «' + c.to + '» в автопарке' };
    if (String(rows[i][2]).trim() === FLEET_REPAIR) return { error: 'Машина «' + c.to + '» в ремонте — выберите другую' };
  }
  else if (!c.toNew) {
    rows.forEach(function (r, j) { if (i < 0 && pk && tgKind_(names[j]) === kind && tgPlateKey_(r[1]) === pk && String(r[2]).trim() !== FLEET_REPAIR) i = j; });
    rows.forEach(function (r, j) { if (i < 0 && tgKind_(names[j]) === kind && !String(r[1]).trim() && !busy[names[j]] && String(r[2]).trim() !== FLEET_REPAIR) i = j; });
  }
  if (i < 0) {
    i = names.indexOf('');
    if (i < 0) return { error: 'В автопарке нет места для новой машины (Sozlamalar C24:C39) — удалите лишнюю или выберите машину автопарка на сайте' };
  }
  sh.getRange(TRUCKS_ROW - 1, 5, 1, 6).setValues([FLEET_HEAD]).setFontWeight('bold');   // проверено — теперь пишем
  var body = bodyHead_(sh), hd = sh.getRange(TRUCKS_ROW - 1, 4); if (String(hd.getValue()).trim() === '') hd.setValue('Davlat raqami');
  if (names[i] === '') {
    var n = 1; while (names.indexOf(label + '-' + n) >= 0 || (n === 1 && names.indexOf(label) >= 0)) n++;   // как на сайте: есть «Labo» — новая «Labo-2»
    names[i] = label + '-' + n; isNew = true;
    sh.getRange(TRUCKS_ROW + i, 3).setValue(names[i]);
    var row = SET_ROWS[CAR_COUNT[kind]], have = names.filter(function (t) { return tgKind_(t) === kind; }).length;   // машин вида в автопарке — с новой
    if (row && (Number(sh.getRange(row, 2).getValue()) || 0) < have) sh.getRange(row, 2).setValue(have);
  }
  var r0 = TRUCKS_ROW + i;
  if (plate) sh.getRange(r0, 4).setNumberFormat('@').setValue(plate);
  if (model) sh.getRange(r0, 6).setValue(model);
  if (m3 !== '') sh.getRange(r0, 8).setValue(m3);
  if (kg !== '') sh.getRange(r0, 9).setValue(kg);
  if (body && l !== '' && w !== '' && h !== '') sh.getRange(r0, 11, 1, 3).setValues([[l, w, h]]);
  return { name: names[i], isNew: isNew };
}

function tgCallback_(q) {
  var data = String(q.data || ''), chat = q.message && q.message.chat, from = String(q.from.id);
  if (chat && (chat.type === 'group' || chat.type === 'supergroup')) return tgGroupCallback_(q, data);
  var d = tgDriver_(from);
  tg_('answerCallbackQuery', { callback_query_id: q.id });
  if (data === 'client' && !(d && (d.status === 'ruxsat' || d.status === 'kutilmoqda'))) {
    if (d && d.row && (!d.status || d.status === 'yangi')) tgSheet_('drivers').deleteRow(d.row);
    var c = tgSub_(from) || { id: from };
    c.name = [q.from.first_name, q.from.last_name].filter(Boolean).join(' ') + (q.from.username ? ' @' + q.from.username : ''); c.status = 'yangi'; c.st = { step: 'bl', sent: (c.st && c.st.sent) || {} };
    tgSubSave_(c);
    return tgSend_(from, TXC.askBl, { remove_keyboard: true });
  }
  if (!d) return;
  var L = d.lang;
  if (/^lang:(uz|ru)$/.test(data) && d.status !== 'ruxsat') {
    d.lang = data.slice(5); d.st = { step: 'name' }; tgSave_(d);
    return tgSend_(d.id, tx_(d.lang, 'askName'), { remove_keyboard: true });
  }
  if (/^kind:(gazel|labo|changan|kamaz)$/.test(data) && d.status !== 'ruxsat' && (d.st.step === 'kind' || d.st.step === 'truck')) {
    d.kind = data.slice(5); d.truck = ''; d.st = { step: 'plate' }; tgSave_(d);
    return tgSend_(d.id, tx_(L, 'askPlate'));
  }
  if (/^trk:\d+$/.test(data) && d.st.step === 'truck' && d.status !== 'ruxsat') return tgAskKind_(d);   // кнопка из списка машин (код до 31)
  if (data === 'reg:redo' && d.status !== 'ruxsat') { d.st = { step: 'name' }; tgSave_(d); return tgSend_(d.id, tx_(L, 'askName')); }
  if (data === 'reg:send' && d.st.step === 'confirm') {
    d.status = 'kutilmoqda'; d.at = tgNow_(); d.st = {}; tgSave_(d);
    tgSend_(d.id, tx_(L, 'sent'), { remove_keyboard: true });
    return tgAskApproval_(d);
  }
  if (d.status !== 'ruxsat') return;
  if (/^pr:\d$/.test(data)) {   // вид проблемы — и до начала рабочего дня
    if (!d.st.pr || d.st.pr.stage !== 'type') return tgSend_(d.id, tx_(L, 'menu'), tgMenu_(L));
    d.st.pr = { stage: 'info', type: Number(data.slice(3)), text: '', photos: [] }; tgSave_(d);
    return tgSend_(d.id, TG_PROBLEMS[L][d.st.pr.type] + '\n' + tx_(L, 'probAsk'), tgLocKb_(L));
  }
  var w = tgWork_(d);
  if (data === 'start') return tgStartAsk_(d, w);   // кнопки из напоминаний
  if (data === 'end') return tgEndAsk_(d, w);
  // кнопки карточек версии 15 («☰ Ещё» и её меню), оставшиеся в чате после обновления
  if (data === 'lang') { d.lang = L === 'uz' ? 'ru' : 'uz'; tgSave_(d); return tgSend_(d.id, tx_(d.lang, 'langSet'), tgMenu_(d.lang)); }
  if (data === 'prob') { d.st.pr = { stage: 'type' }; tgSave_(d); return tgSend_(d.id, tx_(L, 'askProblem'), tgInline_(TG_PROBLEMS[L].map(function (x, i) { return [{ text: x, callback_data: 'pr:' + i }]; }))); }
  if (!w || !w.started) return tgSend_(d.id, tx_(L, 'notWorking'), tgMenu_(L));
  if (data === 'more' || data === 'tels') return tgCurrent_(d, w);
  var m = data.match(/^(ok|fail):(.+)$/);
  if (m) {
    if (!w.cur || w.cur.key !== m[2] || (w.stage && w.stage !== 'wait')) return tgCurrent_(d, w, tx_(L, w.stage ? 'busy' : 'staleNow'));
    w.waited = w.wait && w.wait.key === m[2] ? Math.max(1, Math.round((new Date().getTime() - w.wait.since) / 60000)) : 0; w.wait = null;
    w.result = m[1]; w.photos = []; w.reason = ''; w.photoLL = null;
    if (m[1] === 'ok') { w.stage = 'photo'; tgSave_(d); return tgPhotoAsk_(d, w, 'askPhoto'); }
    w.stage = 'reason'; tgSave_(d);
    return tgSend_(d.id, tx_(L, 'askReason'), tgReasonKb_(L));
  }
  if (/^why:\d$/.test(data) && w.stage === 'reason') {
    var i = Number(data.slice(4));
    if (i === 3) { w.stage = 'reasonText'; tgSave_(d); return tgSend_(d.id, tx_(L, 'askReasonText')); }
    w.reason = TG_REASONS.ru[i];
    if (i === 1) return tgNoAnswer_(d, w);
    w.stage = 'failPhoto'; tgSave_(d);
    return tgPhotoAsk_(d, w, 'askPhotoFail');
  }
  // шаг «фото»: кнопки в сообщении
  if (data === 'pdone' || data === 'pcancel') {
    if (w.stage !== 'photo' && w.stage !== 'failPhoto') return tgCurrent_(d, w, tx_(L, 'staleNow'));
    return data === 'pdone' ? tgPhotoDone_(d, w) : tgCancel_(d, w);
  }
  // «⏳ Жду клиента»: таймер (tgTick раз в 5 минут напомнит водителю и напишет в группу)
  if (/^wait:.+$/.test(data)) {
    var wk = data.slice(5);
    if (!w.cur || w.cur.key !== wk || (w.stage && w.stage !== 'wait' && w.stage !== 'noAnswer')) return tgCurrent_(d, w, tx_(L, w.stage ? 'busy' : 'staleNow'));
    var t0 = new Date().getTime();
    w.wait = { key: wk, since: w.wait && w.wait.key === wk ? w.wait.since : t0, until: t0 + tgWaitMin_() * 60000 }; w.stage = 'wait'; tgSave_(d);
    return tgSend_(d.id, tx_(L, 'waiting', { until: tgHm_(w.wait.until) }), tgOkFailKb_(d, wk));
  }
  // меню «клиент не отвечает»: позвонить диспетчеру, номера клиента, клиент ответил, всё равно не доставлено
  if (/^na:(call|tel|ok|fail)$/.test(data)) {
    if (w.stage !== 'noAnswer' || !w.cur) return tgCurrent_(d, w, tx_(L, 'staleNow'));
    var act = data.slice(3);
    if (act === 'call') return tgSendDispatcher_(d);
    if (act === 'tel') {
      var st = tgStops_(d.truck, w.date).filter(function (x) { return x.key === w.cur.key; })[0], tels = st ? tgClientTels_(st.c) : [];
      return tgSend_(d.id, tels.length ? tx_(L, 'clientTels', { bl: w.cur.bl, list: tels.map(function (x) { return x.t + (x.who ? ' — ' + x.who : ''); }).join('\n') }) : tx_(L, 'noClientTel'));
    }
    if (act === 'ok') {
      w.result = 'ok'; w.reason = ''; w.photos = []; w.photoLL = null; w.stage = 'photo'; tgSave_(d);
      tgReport_('✅ ' + d.truck + ' · ' + d.name + ': клиент ' + w.cur.bl + ' ответил — водитель доставляет.');
      return tgPhotoAsk_(d, w, 'askPhoto');
    }
    w.stage = 'failPhoto'; tgSave_(d);
    return tgPhotoAsk_(d, w, 'askPhotoFail');
  }
  if (/^round:\d+$/.test(data) && w.stage === 'roundWait') {
    w.round = Number(data.slice(6)); w.stage = null; w.pos = tgDepot_(); tgSave_(d);
    return tgNext_(d, w);
  }
}

// проблема в пути: лист «Muammolar», фото на Диск, тревога в группу; водителю — подтверждение и меню
function tgProblemDone_(d, w, ll) {
  var pr = d.st.pr, kind = TG_PROBLEMS.ru[pr.type] || TG_PROBLEMS.ru[5], now = tgNow_(), label = kind.replace(/^\S+\s/, '');
  delete d.st.pr; if (w) { w.pos = ll; w.posAt = now.slice(11); } d.st.probAt = new Date().getTime(); tgSave_(d);   // час после проблемы — без напоминаний
  var photos = pr.photos || [], links = tgSavePhotos_(photos, now.slice(0, 10), d.truck, 'muammo');
  tgHead_('problems').appendRow([now, d.name, d.truck, label, pr.text || '', links.join(' '), ll.join(','), d.id]);
  tgReport_('⚠️ ПРОБЛЕМА: ' + kind + ' — ' + d.truck + ' · ' + d.name + (pr.text ? '\n' + pr.text : '') + (w && w.cur ? '\nТекущая точка: ' + w.cur.bl : '') + '\n' + now.slice(11) + ' · 📍 ' + tgMap_(ll), photos);
  return tgSend_(d.id, tx_(d.lang, 'probSent'), tgMenu_(d.lang));
}

// клиент не отвечает: водителю — меню, в группу — тревога с номерами клиента, чтобы диспетчер позвонил сам
function tgNoAnswer_(d, w) {
  var L = d.lang, s = tgStops_(d.truck, w.date).filter(function (x) { return x.key === w.cur.key; })[0], c = (s && s.c) || {};
  w.stage = 'noAnswer'; tgSave_(d);
  tgNotify_(w.cur.bl, 'na:' + w.date + ':' + w.cur.key, txc_('noAnswer'));
  var tels = tgClientTels_(c), who = [c.brand, c.name].filter(Boolean).join(' — '), g = tgGroup_();
  if (g) tgReport_('📵 ' + d.truck + ' · ' + d.name + ': клиент ' + w.cur.bl + (who ? ' ' + who : '') + ' не отвечает на телефон.\n' +
    (tels.length ? '☎️ ' + tels.map(function (x) { return x.t + (x.who ? ' (' + x.who + ')' : ''); }).join(', ') + '\n' : 'Номера клиента нет в справочнике.\n') +
    (c.district || c.address ? '📍 ' + [c.district, c.address].filter(Boolean).join(', ') + '\n' : '') + 'Позвоните клиенту — водитель ждёт на точке.' + (w.pos ? '\n🚚 Последняя отметка водителя: ' + tgMap_(w.pos) : ''));
  return tgSend_(d.id, tx_(L, 'noAnswer') + (g ? '\n' + tx_(L, 'dispAlerted') : ''), tgNoAnswerKb_(d, w));
}
function tgNoAnswerKb_(d, w) {
  var L = d.lang;
  return tgInline_([[{ text: tx_(L, 'bCallDisp'), callback_data: 'na:call' }], [{ text: tx_(L, 'bClientTel'), callback_data: 'na:tel' }], [{ text: tx_(L, 'bWait'), callback_data: 'wait:' + w.cur.key }], [{ text: tx_(L, 'bAnswered'), callback_data: 'na:ok' }], [{ text: tx_(L, 'bStillFail'), callback_data: 'na:fail' }]]);
}

// ── группа офиса: привязка, подтверждение водителей ──
function tgGroupMsg_(m) {
  var text = String(m.text || '').trim(), mm = text.match(/^\/ulash(?:@\w+)?\s+(\S+)/);
  if (!mm) return;
  if (mm[1] !== prop_('TG_GROUP_CODE')) return tgSend_(m.chat.id, 'Код не подходит. Возьмите его на сайте: «Настройки связи» → «Телеграм-бот для водителей».');
  var p = props_();
  p.setProperty('TG_GROUP', String(m.chat.id)); p.setProperty('TG_GROUP_TITLE', String(m.chat.title || ''));
  tgSend_(m.chat.id, 'Группа привязана ✅ Сюда будут приходить заявки водителей и отчёты о доставке. Подтверждать водителей могут администраторы группы.');
  tgDrivers_().filter(function (d) { return d.status === 'kutilmoqda'; }).forEach(tgAskApproval_);
}
function tgGroup_() { return prop_('TG_GROUP'); }
function tgAskApproval_(d) {
  var g = tgGroup_();
  if (!g) return;
  var same = tgDrivers_().filter(function (x) { return x.status === 'ruxsat' && x.truck === d.truck && x.id !== d.id; }).map(function (x) { return x.name; });
  var car = d.kind ? '\n📞 ' + d.phone + '\n🚚 ' + CAR_KINDS[d.kind] + ' · ' + d.plate + ' · ' + d.model + '\n📐 ' + d.body + ' м — ' + tgNum_(d.m3) + ' м³ · ⚖️ ' + tgNum_(d.kg) + ' кг'
    : '\n🚚 ' + d.truck + ' · ' + d.plate;
  tgSend_(g, '🆕 Новый водитель: ' + d.name + car + '\nTelegram: ' + (d.user || d.id) + (same.length ? '\nНа этой машине уже: ' + same.join(', ') : '') +
    (d.kind ? '\n«Разрешить» — машина в автопарк (тот же госномер — та же машина, иначе свободная или новая). Проверить и поправить — на сайте, вкладка «Водители».' : ''),
    tgInline_([[{ text: '✅ Разрешить', callback_data: 'allow:' + d.id }, { text: '❌ Отклонить', callback_data: 'deny:' + d.id }]]));
}
function tgGroupCallback_(q, data) {
  var chat = q.message.chat, m = data.match(/^(allow|deny|callow|cdeny):(\d+)$/);
  if (!m || String(chat.id) !== tgGroup_()) return tg_('answerCallbackQuery', { callback_query_id: q.id });
  var mem = tg_('getChatMember', { chat_id: chat.id, user_id: q.from.id }), role = mem.ok && mem.result && mem.result.status;
  if (role !== 'creator' && role !== 'administrator') return tg_('answerCallbackQuery', { callback_query_id: q.id, text: 'Подтверждать водителей могут только администраторы группы', show_alert: true });
  tg_('answerCallbackQuery', { callback_query_id: q.id });
  var who = [q.from.first_name, q.from.last_name].filter(Boolean).join(' ');
  if (m[1] === 'callow' || m[1] === 'cdeny') {   // клиент: номера нет в карточке — решает администратор группы
    var c = tgSub_(m[2]);
    if (!c || c.status !== 'kutilmoqda') return;
    c.status = m[1] === 'callow' ? 'faol' : 'rad'; c.by = who; tgSubSave_(c);
    tgSend_(c.id, c.status === 'faol' ? txc_('ok', { bl: c.bl }) : TXC.rejected);
    return tg_('editMessageText', { chat_id: chat.id, message_id: q.message.message_id, text: q.message.text + '\n\n' + (c.status === 'faol' ? '✅ Разрешено' : '❌ Отклонено') + ' — ' + who + ', ' + tgNow_('dd.MM HH:mm') });
  }
  var d = tgDriver_(m[2]);
  if (!d) return;
  var note = '';
  if (m[1] === 'allow' && d.kind && d.status === 'kutilmoqda') {   // своя машина (31) — в автопарк
    var ca = tgCarApply_(d, null), ts = ca.error ? ca : tgSetTruck_(d, ca.name);
    note = ts.error ? '\n⚠️ Машина не записана: ' + ts.error : '\n🚚 В автопарке: ' + ca.name + (ca.isNew ? ' (новая)' : '');
  }
  tgSetStatus_(d, m[1] === 'allow' ? 'ruxsat' : 'rad', who);
  tg_('editMessageText', { chat_id: chat.id, message_id: q.message.message_id, text: q.message.text + '\n\n' + (m[1] === 'allow' ? '✅ Разрешено' : '❌ Отклонено') + ' — ' + who + ', ' + tgNow_('dd.MM HH:mm') + note });
}
function tgSetStatus_(d, status, who) {
  d.status = status; d.by = who + ' · ' + tgNow_(); if (status !== 'ruxsat') d.st = {};
  tgSave_(d);
  if (status === 'ruxsat') tgSend_(d.id, tx_(d.lang, 'approved'), tgMenu_(d.lang));
  else tgSend_(d.id, tx_(d.lang, status === 'rad' ? 'rejected' : 'off'), { remove_keyboard: true });
}
// машина водителя — с сайта (версия 23): владелец выбирает, кто на какой машине. Одна машина — один водитель: у другого
// водителя этой машины (подтверждённого или с заявкой) она снимается — водитель без машины, пока не назначат новую.
// truck '' — снять машину. Госномер — из автопарка (Sozlamalar D). Ответ: имена водителей, с которых сняли машину.
function tgTruckErr_(truck) {
  truck = String(truck || '').trim();
  return truck && tgTrucks_().indexOf(truck) < 0 ? 'Машины «' + truck + '» нет в автопарке или она в ремонте' : '';
}
function tgSetTruck_(d, truck) {
  truck = String(truck || '').trim();
  var err = tgTruckErr_(truck), freed = [];
  if (err) return { error: err };
  if (truck) tgDrivers_().forEach(function (x) {
    if (x.id === d.id || x.truck !== truck || (x.status !== 'ruxsat' && x.status !== 'kutilmoqda')) return;
    x.truck = ''; x.plate = ''; freed.push(x.name);
    if (x.status === 'ruxsat') tgTruckMoved_(x, tx_(x.lang, 'truckOff', { truck: truck }));
    else tgSave_(x);
  });
  if (truck === d.truck) return { freed: freed };
  var old = d.truck;
  d.truck = truck; d.plate = truck ? tgPlates_()[truck] || '' : '';
  if (d.status === 'ruxsat') tgTruckMoved_(d, truck ? tx_(d.lang, 'truckSet', { truck: truck + (d.plate ? ' · ' + d.plate : '') }) : tx_(d.lang, 'truckOff', { truck: old }));
  else tgSave_(d);
  return { freed: freed };
}
// водителю сменили машину: в рабочем дне — точки новой машины с начала (шаг на старой машине сброшен, точка осталась
// открытой у старой машины), без машины — только сообщение; задание партии — пересчитано по новой машине
function tgTruckMoved_(x, head) {
  var w = tgWork_(x), a = tgAssigned_(x), L = x.lang, st = tgStops_(x.truck, (w && w.date) || (a && a.date) || '');
  if (w && w.started) {
    w.round = null; w.cur = null; w.stage = null; w.wait = null; w.photos = []; w.photoLL = null; w.result = null; w.reason = null;
    if (x.truck) return tgNext_(x, w, head);
    w.sig = tgSig_(st); tgSave_(x);
    return tgSend_(x.id, head, tgMenu_(L));
  }
  if (a) a.sig = tgSig_(st);
  tgSave_(x);
  if (a && st.some(function (s) { return s.open; })) return tgSend_(x.id, head + '\n\n' + tgAssignText_(x, a.date, st), tgMenu_(L));
  return tgSend_(x.id, head, tgMenu_(L));
}

// ── рабочий день ──
// склад отправки для водителя (версия 22): название (Sozlamalar B7) и адрес по координатам склада — геокодер Google,
// один раз на язык: хранится в свойстве TG_DEPOT_ADDR, пока координаты склада те же. Геокодер недоступен — только название.
function tgDepotText_(L) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH.set);
  if (!sh) return '';
  var name = String(sh.getRange(SET_ROWS.depotName, 2).getValue() || '').trim(), ll = tgDepot_(), addr = '';
  if (ll) {
    var p = props_(), at = ll.join(','), lang = L === 'ru' ? 'ru' : 'uz', memo = {};
    try { memo = JSON.parse(p.getProperty('TG_DEPOT_ADDR') || '{}'); } catch (err) { memo = {}; }
    if (memo.at !== at) memo = { at: at };
    if (memo[lang] === undefined) {
      try {
        var g = Maps.newGeocoder().setLanguage(lang).reverseGeocode(ll[0], ll[1]);
        var res = (g.results || []).filter(function (x) { return (x.types || []).indexOf('plus_code') < 0; })[0];   // без «9GHQ+X2»
        memo[lang] = res ? String(res.formatted_address || '').replace(/,\s*(Uzbekistan|Oʻzbekiston|O‘zbekiston|Ўзбекистон|Узбекистан)$/i, '') : '';
        p.setProperty('TG_DEPOT_ADDR', JSON.stringify(memo));
      } catch (err) { memo[lang] = ''; }
    }
    addr = memo[lang] || '';
  }
  return name && addr && addr.indexOf(name) < 0 ? name + ' — ' + addr : name || addr;
}
function tgDepot_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH.set);
  if (!sh) return null;
  var lat = Number(sh.getRange(SET_ROWS.depotLat, 2).getValue()), lon = Number(sh.getRange(SET_ROWS.depotLon, 2).getValue());
  return lat && lon ? [lat, lon] : null;
}
// журнал и клиенты читаются один раз за запрос (после записи статуса — заново)
var TG_MEMO = null;
function tgData_() {
  if (TG_MEMO) return TG_MEMO;
  var ss = SpreadsheetApp.getActiveSpreadsheet(), sh = ss.getSheetByName(SH.ship), cs = ss.getSheetByName(SH.cli), rows = [], cl = {};
  var last = sh ? lastRow_(sh, 3, 5) : 0;
  if (last >= 5) rows = sh.getRange(5, 1, last - 4, 16).getValues();
  if (last >= 5 && locOn_(sh)) {   // V — куда везти (версия 25): 22-й элемент строки
    var lv = sh.getRange(5, LOC_COL, last - 4, 1).getValues();
    rows.forEach(function (r, i) { while (r.length < LOC_COL - 1) r.push(''); r[LOC_COL - 1] = lv[i][0]; });
  }
  var cl_last = cs ? lastRow_(cs, 1, 5) : 0;
  var zl = cl_last >= 5 && colOn_(cs, LOCS_COL, LOCS_HEAD) ? cs.getRange(5, LOCS_COL, cl_last - 4, 1).getValues() : null;   // точки клиента (версия 27)
  if (cl_last >= 5) cs.getRange(5, 1, cl_last - 4, 15).getValues().forEach(function (r, i) {
    cl[String(r[0]).trim()] = { brand: String(r[1] || ''), name: String(r[2] || ''), tel1: String(r[3] || ''), tel2: String(r[4] || ''), receiver: String(r[5] || ''), recvTel: String(r[6] || ''), district: String(r[7] || ''), address: String(r[8] || ''), lat: Number(r[10]) || null, lon: Number(r[11]) || null, note: String(r[14] || ''), locs: zl ? String(zl[i][0] || '') : '' };
  });
  TG_MEMO = { rows: rows, cl: cl, tz: ss.getSpreadsheetTimeZone() };
  return TG_MEMO;
}
// склад клиента по названию (в V вписали название из «Qoshimcha omborlar» без координат); листа нет — null
function tgWhLoc_(D, bl, name) {
  if (!D.wh) {
    D.wh = {};
    var ws = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH.wh), wl = ws ? lastRow_(ws, 1, 5) : 0;
    if (wl >= 5) ws.getRange(5, 1, wl - 4, 5).getValues().forEach(function (r) {
      var lat = Number(r[3]), lon = Number(r[4]), k = String(r[0]).trim();
      if (k && lat && lon) (D.wh[k] = D.wh[k] || []).push({ name: String(r[2] || '').trim(), lat: lat, lon: lon });
    });
  }
  var n = String(name).trim().toLowerCase(), w = (D.wh[bl] || []).filter(function (x) { return x.name.toLowerCase() === n; })[0];
  if (w) return { name: w.name, lat: w.lat, lon: w.lon };
  // точка из анкеты клиента (Mijozlar Z, версия 27) с тем же названием; «Mijoz manzili» — адрес клиента
  var ls = String((D.cl[bl] || {}).locs || '').split('\n').map(locParse_).filter(function (x) { return x && x.name.toLowerCase() === n; });
  return ls[0] || null;
}
// точки машины на дату: строки журнала этой машины, по клиенту и номеру рейса; клиент — адрес, получатель, координаты
function tgStops_(truck, date) {
  if (!truck) return [];   // водитель без машины (версия 23): иначе совпали бы строки журнала без машины
  var D = tgData_(), tz = D.tz, out = {}, order = [], ds = tgDates_(date);
  D.rows.forEach(function (r, i) {
    var dt = r[0] instanceof Date ? day_(r[0], tz) : String(r[0]).slice(0, 10);
    if (ds.indexOf(dt) < 0 || String(r[12]).trim() !== truck) return;
    var bl = String(r[2]).trim(), round = Number(r[13]) || 1, key = bl + '|' + round;
    if (!out[key]) { out[key] = { key: key, bl: bl, round: round, date: dt, rows: [], places: 0, cbm: 0, kg: 0, notes: [], open: false, statuses: [] }; order.push(key); }
    var s = out[key], st = String(r[14]).trim();
    s.rows.push(5 + i); s.places += Number(r[11]) || 0; s.cbm += Number(r[9]) || 0; s.kg += Number(r[10]) || 0;
    if (r[15]) s.notes.push(String(r[15]));
    // куда везти (версия 25) — у строк BL в партии одна: «название · широта, долгота» или название склада клиента
    if (!s.loc && String(r[LOC_COL - 1] || '').trim()) s.loc = locParse_(r[LOC_COL - 1]) || tgWhLoc_(D, bl, r[LOC_COL - 1]);
    s.statuses.push(st);
    if (TG_DONE.indexOf(st) < 0) s.open = true;
  });
  if (!order.length) return [];
  // своя точка отгрузки — вместо адреса клиента: карточка («Куда»), маршрут, ближайшая точка, отметка «далеко»
  return order.map(function (k) {
    var s = out[k], c = D.cl[s.bl] || {};
    s.c = s.loc ? Object.assign({}, c, { lat: s.loc.lat, lon: s.loc.lon, district: '', address: s.loc.name || s.loc.lat + ', ' + s.loc.lon }) : c;
    s.cbm = Math.round(s.cbm * 1000) / 1000; s.kg = Math.round(s.kg * 10) / 10; return s;
  });
}
function tgKm_(a, b) {
  var R = 6371, rad = Math.PI / 180, dLa = (b[0] - a[0]) * rad, dLo = (b[1] - a[1]) * rad;
  var h = Math.sin(dLa / 2) * Math.sin(dLa / 2) + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLo / 2) * Math.sin(dLo / 2);
  return 2 * R * Math.asin(Math.sqrt(h));
}
// следующая точка: в текущем рейсе, ближайшая к месту последней отметки (как в плане — от склада к ближайшей)
function tgPick_(stops, round, pos) {
  var open = stops.filter(function (s) { return s.open && s.round === round; });
  if (!open.length) return null;
  if (!pos) return open[0];
  var best = null, bd = Infinity;
  open.forEach(function (s) { var dd = s.c.lat && s.c.lon ? tgKm_(pos, [s.c.lat, s.c.lon]) : 1e6; if (dd < bd) { bd = dd; best = s; } });
  return best;
}
function tgSig_(stops) { return stops.map(function (s) { return s.key + (s.open ? '' : '✓'); }).join(';'); }
function tgFmt_(x) { return String(Math.round(x * 1000) / 1000).replace('.', ','); }
function tgCard_(d, s, stops) {
  var L = d.lang, inRound = stops.filter(function (x) { return x.round === s.round; }), done = inRound.filter(function (x) { return !x.open; }).length, c = s.c;
  var lines = [tx_(L, 'stop', { i: done + 1, n: inRound.length, round: s.round }), '',
    '🏷 ' + s.bl + (c.brand || c.name ? ' · ' + [c.brand, c.name].filter(Boolean).join(' — ') : '')];
  var from = tgDepotText_(L);
  if (from) lines.push('🏭 ' + tx_(L, 'from') + ': ' + from);
  lines.push('📍 ' + tx_(L, 'to') + ': ' + ([c.district, c.address].filter(Boolean).join(', ') || tx_(L, 'noAddr')));
  if (c.receiver || c.recvTel) lines.push('👤 ' + tx_(L, 'recv') + ': ' + [c.receiver, c.recvTel].filter(Boolean).join(' · '));
  if (c.tel1 && c.tel1 !== c.recvTel) lines.push('☎️ ' + tx_(L, 'tel') + ': ' + c.tel1);
  lines.push('📦 ' + tx_(L, 'cargo', { places: s.places, cbm: tgFmt_(s.cbm), kg: tgFmt_(s.kg) }));
  var notes = s.notes.concat(c.note ? [c.note] : []);
  if (notes.length) lines.push('📝 ' + tx_(L, 'note') + ': ' + notes.join(' · '));
  if (!(c.lat && c.lon)) lines.push('', tx_(L, 'noCoords'));
  return lines.join('\n');
}
// head — строка над сообщением («Новое задание…», «Рейсы изменились»): одно сообщение вместо двух
function tgNext_(d, w, head) {
  var L = d.lang, stops = tgStops_(d.truck, w.date), h = head ? head + '\n\n' : '';
  w.sig = tgSig_(stops);
  if (!d.truck) { w.cur = null; tgSave_(d); return tgSend_(d.id, h + tx_(L, 'noTruck'), tgMenu_(L)); }
  if (!stops.length) { w.cur = null; tgSave_(d); return tgSend_(d.id, h + tx_(L, 'noStops', { truck: d.truck }), tgMenu_(L)); }
  var round = w.round || Math.min.apply(null, stops.filter(function (s) { return s.open; }).map(function (s) { return s.round; }).concat([99]));
  if (round === 99) { w.cur = null; tgSave_(d); return tgSend_(d.id, h + tx_(L, 'allDone'), tgMenu_(L)); }
  var s = tgPick_(stops, round, w.pos || tgDepot_());
  if (!s) {
    var later = stops.filter(function (x) { return x.open && x.round > round; }).map(function (x) { return x.round; });
    if (!later.length) { w.cur = null; tgSave_(d); return tgSend_(d.id, h + tx_(L, 'allDone'), tgMenu_(L)); }
    var nx = Math.min.apply(null, later);
    w.cur = null; w.stage = 'roundWait'; tgSave_(d);
    return tgSend_(d.id, h + tx_(L, 'roundDone', { round: round, next: nx }), tgInline_([[{ text: tx_(L, 'bRound', { next: nx }), callback_data: 'round:' + nx }]]));
  }
  w.round = round; w.cur = { key: s.key, bl: s.bl, round: s.round }; w.stage = null; tgSave_(d);
  tgSend_(d.id, h + tgCard_(d, s, stops), tgStopKb_(d, s));
  tgNotify_(s.bl, 'way:' + w.date + ':' + s.key, txc_('onWay', { eta: tgEta_(w.pos || tgDepot_(), s.c), truck: d.truck }));
  if (s.c.lat && s.c.lon) tg_('sendLocation', { chat_id: d.id, latitude: s.c.lat, longitude: s.c.lon, reply_markup: tgMenu_(L) });
  else tgSend_(d.id, tx_(L, 'menu'), tgMenu_(L));
}
function tgCurrent_(d, w, head) {
  if (w.stage === 'roundWait' || !w.cur) return tgNext_(d, w, head);
  var stops = tgStops_(d.truck, w.date), s = stops.filter(function (x) { return x.key === w.cur.key && x.open; })[0];
  if (!s) return tgNext_(d, w, head);
  w.sig = tgSig_(stops); tgSave_(d);
  tgSend_(d.id, (head ? head + '\n\n' : '') + tgCard_(d, s, stops), tgStopKb_(d, s));
  if (s.c.lat && s.c.lon) tg_('sendLocation', { chat_id: d.id, latitude: s.c.lat, longitude: s.c.lon });
}
function tgPhoto_(d, w, fileId) {
  if (!w || (w.stage !== 'photo' && w.stage !== 'failPhoto')) return tgSend_(d.id, tx_(d.lang, w && w.started ? 'unknown' : 'notWorking'), tgMenu_(d.lang));
  if (tgCamera_()) return tgSend_(d.id, tx_(d.lang, 'camOnly'), tgPhotoKb_(d, w));   // из галереи или чата — нельзя, только камерой
  w.photos = (w.photos || []).concat([fileId]).slice(0, 10); tgSave_(d);
  return tgSend_(d.id, tx_(d.lang, 'photoOk', { n: w.photos.length }), { keyboard: [[tx_(d.lang, 'bDone')], [tx_(d.lang, 'bCancel')]], resize_keyboard: true });
}
function tgLocation_(d, w, ll) {
  var L = d.lang;
  if (!w) return tgSend_(d.id, tx_(L, 'notWorking'), tgMenu_(L));
  if (w.stage === 'startLoc') {
    w.started = tgNow_('HH:mm'); w.stage = null; w.pos = ll; w.posAt = w.started; w.round = null; w.ok = 0; w.fail = 0;
    if (d.st.assign && !d.st.assign.used && d.st.assign.date === w.date) d.st.assign.used = w.day;
    tgSave_(d);
    tgHead_('days').appendRow([w.day, d.name, d.truck, w.started, ll.join(','), '', '', '', '', d.id, w.date]);
    var stops = tgStops_(d.truck, w.date);
    tgReport_('🚚 ' + d.name + ' (' + d.truck + ') начал работу в ' + w.started + ' · ' + (w.date !== w.day ? 'партия ' + tgDmy_(w.date) + ' · ' : '') + 'точек: ' + stops.filter(function (s) { return s.open; }).length + ' · 📍 ' + tgMap_(ll));
    return tgNext_(d, w);
  }
  if (w.stage === 'endLoc') {
    var all = tgStops_(d.truck, w.date), left = all.filter(function (s) { return s.open; }).length, end = tgNow_('HH:mm');
    w.ended = end; w.stage = null; w.pos = ll; w.posAt = end; tgSave_(d);
    tgDayEnd_(d, w, end, ll);
    tgReport_('🏁 ' + d.name + ' (' + d.truck + ') закончил работу в ' + end + ': доставлено ' + (w.ok || 0) + ', не доставлено ' + (w.fail || 0) + ', осталось ' + left + ' · 📍 ' + tgMap_(ll));
    return tgSend_(d.id, tx_(L, 'endDay', { ok: w.ok || 0, fail: w.fail || 0, left: left }), tgMenu_(L));
  }
  if (w.stage === 'loc' && w.cur) return tgFinish_(d, w, ll);
  w.pos = ll; w.posAt = tgNow_('HH:mm'); tgSave_(d);
  return tgSend_(d.id, tx_(L, 'unknown'), tgMenu_(L));
}
function tgDayEnd_(d, w, end, ll) {
  var sh = tgSheet_('days'), last = sh.getLastRow();
  if (last < 2) return;
  var v = sh.getRange(2, 1, last - 1, 10).getValues();
  for (var i = v.length - 1; i >= 0; i--) {
    var dt = v[i][0] instanceof Date ? Utilities.formatDate(v[i][0], SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(), 'yyyy-MM-dd') : String(v[i][0]);
    if (String(v[i][9]) === d.id && dt === (w.day || w.date)) { sh.getRange(2 + i, 6, 1, 4).setValues([[end, ll.join(','), w.ok || 0, w.fail || 0]]); return; }
  }
}
// точка закрыта: статус в журнале, фото на Диск, строка в «Yetkazish», отчёт в группу, следующая точка
function tgFinish_(d, w, ll) {
  var ok = w.result === 'ok', stops = tgStops_(d.truck, w.date), s = stops.filter(function (x) { return x.key === w.cur.key; })[0];
  var photos = (w.photos || []).slice(), reason = w.reason || '', cur = w.cur, now = tgNow_(), waited = w.waited || 0;
  w.pos = ll; w.posAt = now.slice(11); w.cur = null; w.stage = null; w.photos = []; w.reason = ''; w.photoLL = null; w.waited = 0; w.wait = null; w[ok ? 'ok' : 'fail'] = (w[ok ? 'ok' : 'fail'] || 0) + 1;
  tgSave_(d);
  if (s) {
    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH.ship);
    s.rows.forEach(function (r) { if (String(sh.getRange(r, 3).getValue()).trim() === s.bl && String(sh.getRange(r, 13).getValue()).trim() === d.truck) sh.getRange(r, 15).setValue(ok ? 'Yetkazildi' : 'Qolib ketgan'); });
    TG_MEMO = null;   // журнал изменился — следующую точку считаем по свежим данным
  }
  var links = tgSavePhotos_(photos, w.day || w.date, d.truck, cur.bl);
  var c = (s && s.c) || {}, who = [c.brand, c.name].filter(Boolean).join(' — ');
  var km = c.lat && c.lon ? Math.round(tgKm_(ll, [c.lat, c.lon]) * 10) / 10 : '', far = km !== '' && km > tgMaxKm_();   // отметка далеко от клиента — видно в группе и на сайте
  tgHead_('log').appendRow([now, (s && s.date) || w.date, d.name, d.truck, cur.bl, who, ok ? 'Yetkazildi' : 'Yetkazilmadi', reason, links.join(' '), ll.join(','), d.id, cur.round, waited || '', km]);
  var cap = (ok ? '✅ ' : '❌ ') + d.truck + ' · ' + d.name + ' — ' + (ok ? 'доставлено' : 'не доставлено') + ': ' + cur.bl + (who ? ' ' + who : '') +
    (reason ? '\nПричина: ' + reason : '') + (waited ? '\n⏳ Ждал клиента ' + waited + ' мин' : '') + (far ? '\n⚠️ Отметка в ' + String(km).replace('.', ',') + ' км от точки клиента' : '') + '\n' + now.slice(11) + ' · 📍 ' + tgMap_(ll);
  tgReport_(cap, photos);
  tgNotify_(cur.bl, 'end:' + w.date + ':' + cur.key, ok ? txc_('delivered', { bl: cur.bl, places: s ? s.places : '' }) : txc_('failed', { bl: cur.bl, reason: tgReasonUz_(reason) }), ok ? photos[0] : null);
  tgSend_(d.id, tx_(d.lang, 'saved') + '\n' + tx_(d.lang, 'next'), tgMenu_(d.lang));
  return tgNext_(d, w);
}
// фото — на Google Диск: «BURAQ yetkazish» / дата / «дата машина BL n.jpg»; ссылки — в «Yetkazish»
function tgSavePhotos_(ids, date, truck, bl) {
  if (!ids.length) return [];
  var out = [];
  try {
    var p = props_(), rootId = p.getProperty('TG_DRIVE'), root = null;
    if (rootId) { try { root = DriveApp.getFolderById(rootId); } catch (err) { root = null; } }
    if (!root) { root = DriveApp.createFolder('BURAQ yetkazish'); p.setProperty('TG_DRIVE', root.getId()); }
    var it = root.getFoldersByName(date), day = it.hasNext() ? it.next() : root.createFolder(date);
    ids.forEach(function (id, i) {
      var f = tg_('getFile', { file_id: id });
      if (!f.ok) return;
      var blob = UrlFetchApp.fetch(TG_API + 'file/bot' + prop_('TG_TOKEN') + '/' + f.result.file_path, { muteHttpExceptions: true }).getBlob();
      blob.setName(date + ' ' + truck + ' ' + bl + ' ' + (i + 1) + '.jpg');
      out.push(day.createFile(blob).getUrl());
    });
  } catch (err) { console.error('Фото на Диск: ' + ((err && err.message) || err)); }
  return out;
}
// отчёт в группу офиса: текст или фото (альбомом, подпись у первого)
function tgReport_(text, photos) {
  var g = tgGroup_();
  if (!g) return;
  photos = photos || [];
  if (!photos.length) return tgSend_(g, text);
  if (photos.length === 1) return tg_('sendPhoto', { chat_id: g, photo: photos[0], caption: text.slice(0, 1000) });
  return tg_('sendMediaGroup', { chat_id: g, media: photos.map(function (p, i) { return i ? { type: 'photo', media: p } : { type: 'photo', media: p, caption: text.slice(0, 1000) }; }) });
}

// ── изменения на сайте: водителю, который работает с партией или получил её заданием, — если его точки поменялись ──
// Сайт пишет журнал порциями по 40 правок. Раньше водитель получал «задание изменилось» со всем списком после каждой
// порции, а потом ещё и само задание — один план приходил 2–3 раза подряд. Теперь (версия 18) промежуточные порции
// (more) и запись перед «Отправить» (quiet) водителям не пишут, только запоминают, что точки менялись: сообщение —
// одно, после последней порции; перед отправкой — только само задание (tgDispatch_ сообщит остальным).
function tgAfterOps_(ops, hold) {
  if (!prop_('TG_TOKEN')) return;
  var ship = (ops || []).some(function (op) { return /^ship\./.test(op.t); }), c = CacheService.getScriptCache();
  if (hold) { if (ship) c.put('tg:ops', String(new Date().getTime()), 3600); return; }
  if (!ship && !c.get('tg:ops')) return;
  c.remove('tg:ops');
  tgChanged_({});
}
function tgChanged_(skip) {
  TG_MEMO = null;
  tgDrivers_().forEach(function (d) {
    if (d.status !== 'ruxsat' || skip[d.id] || !d.truck) return;
    var w = tgWork_(d), a = tgAssigned_(d);
    if (w && w.started) {
      var sig = tgSig_(tgStops_(d.truck, w.date));
      if (sig === w.sig) return;
      if (!w.stage || w.stage === 'roundWait') tgCurrent_(d, w, tx_(d.lang, 'changed'));   // одним сообщением с карточкой
      else { w.sig = sig; tgSave_(d); tgSend_(d.id, tx_(d.lang, 'changed')); }
    } else if (a) {
      var st = tgStops_(d.truck, a.date), sg = tgSig_(st);
      if (sg === a.sig) return;
      a.sig = sg; tgSave_(d);
      tgSend_(d.id, tx_(d.lang, 'assignChanged') + '\n\n' + tgAssignText_(d, a.date, st), tgMenu_(d.lang));
    }
  });
}

// ── задание водителю: партия, число точек и рейсов ──
// Списка точек нет (версия 20): адрес, телефон и метку водитель видит по одной точке — следующую только после фото
// доставки (или фото места, если не доставлено) и геолокации предыдущей.
function tgAssignText_(d, date, stops) {
  var open = stops.filter(function (x) { return x.open; }), rounds = {};
  open.forEach(function (x) { rounds[x.round] = 1; });
  var r = Object.keys(rounds).length;
  var from = tgDepotText_(d.lang);
  return tx_(d.lang, 'assign', { date: tgDmy_(date), truck: d.truck, n: open.length, rounds: r > 1 ? tx_(d.lang, 'assignRounds', { r: r }) : '', from: from ? '\n🏭 ' + tx_(d.lang, 'from') + ': ' + from : '' });
}
// «Отправить» с сайта: водителям (всем с точками в партии или выбранным) — задание; тем, кто уже работает, — сразу первая точка.
// «Всем» (ids пусто) не повторяет водителю тот же план: кто уже получил эту партию с теми же точками (утром или раньше)
// или уже везёт её — в ответе сайту «уже получил». Выбранному водителю («Отправить» в его строке) — всегда.
// Кто уже везёт эту партию, того не сбрасываем на начало: текущая точка и шаг (фото, ожидание) остаются.
// auto (утром по расписанию): кто уже работает или уже получил эту партию — не трогаем
function tgDispatch_(date, ids, auto) {
  var sent = [], skipped = [], already = [], today = tgNow_('yyyy-MM-dd'), drivers = tgDrivers_().filter(function (d) { return d.status === 'ruxsat'; });
  TG_MEMO = null;
  var one = !!(ids && ids.length), done = {};
  var targets = one ? drivers.filter(function (d) { return ids.indexOf(d.id) >= 0; }) : drivers;
  targets.forEach(function (d) {
    if (!d.truck) { if (!auto) skipped.push({ id: d.id, name: d.name, truck: '', why: 'нет машины' }); return; }
    var stops = tgStops_(d.truck, date), open = stops.filter(function (x) { return x.open; }), sig = tgSig_(stops);
    if (!open.length) { if (!auto) skipped.push({ id: d.id, name: d.name, truck: d.truck, why: 'нет точек' }); return; }
    var w = tgWork_(d), a0 = tgAssigned_(d), who = { id: d.id, name: d.name, truck: d.truck, n: open.length };
    if (auto && ((w && w.started) || (a0 && (a0.date === date || tgDates_(a0.date).indexOf(date) >= 0)))) return;   // утром не сбивать задание на две партии
    done[d.id] = 1;
    if (w && w.started && w.date === date) {
      var free = !w.stage || w.stage === 'roundWait';
      if (w.sig === sig && (!one || !free)) { already.push(Object.assign(who, { why: 'уже везёт эту партию' })); return; }
      if (free) tgCurrent_(d, w, w.sig === sig ? '' : tx_(d.lang, 'changed'));
      else { w.sig = sig; tgSave_(d); tgSend_(d.id, tx_(d.lang, 'changed')); }
    } else if (w && w.started) {
      w.date = date; w.round = null; w.cur = null; w.stage = null; tgSave_(d);
      tgNext_(d, w, tx_(d.lang, 'assignNow', { date: tgDmy_(date), n: open.length }));   // одним сообщением с первой точкой
    } else {
      if (!one && a0 && a0.date === date && a0.sig === sig) { already.push(Object.assign(who, { why: 'уже получил этот план в ' + String(a0.at || '').slice(11, 16) })); return; }
      d.st.assign = { date: date, day: today, at: tgNow_(), sig: sig }; tgSave_(d);
      tgSend_(d.id, tgAssignText_(d, date, stops), tgMenu_(d.lang));
    }
    open.forEach(function (x) { tgNotify_(x.bl, 'today:' + date, txc_('today', { bl: x.bl, places: x.places })); });
    sent.push(who);
  });
  // правки журнала перед отправкой (quiet) водителям не писали: у кого точки изменились, а задание сейчас не ушло, — сообщение
  if (!auto) { CacheService.getScriptCache().remove('tg:ops'); tgChanged_(done); }
  // машины с точками, у которых нет водителя в боте
  if (!(ids && ids.length)) {
    var has = {}; drivers.forEach(function (d) { has[d.truck] = 1; });
    var D = tgData_(), trucks = {};
    D.rows.forEach(function (r) { var dt = r[0] instanceof Date ? day_(r[0], D.tz) : String(r[0]).slice(0, 10), t = String(r[12]).trim(); if (tgDates_(date).indexOf(dt) >= 0 && t && TG_NOT_TRUCKS.indexOf(t) < 0 && TG_DONE.indexOf(String(r[14]).trim()) < 0 && !has[t]) trucks[t] = 1; });
    Object.keys(trucks).forEach(function (t) { skipped.push({ truck: t, why: 'нет водителя в боте' }); });
  }
  return { sent: sent, skipped: skipped, already: already };
}
// «📤 В группу» с сайта (версия 29): партия — в группу отчётов, как водителю: сначала сводка, потом каждый клиент
// отдельной карточкой (BL и клиент, куда — своя точка или адрес клиента, получатель, груз) с кнопками маршрута
// «🧭 Яндекс» и «🗺 Google». Telegram пускает в группу не больше 20 сообщений в минуту — после 19-го пауза ~3 с;
// ответ 429 — ждём, сколько сказал Telegram, и повторяем. Не больше 100 клиентов за раз.
function tgBatchInfo_(b) {
  var g = tgGroup_();
  if (!g) return { error: 'Группа отчётов не привязана: отправьте в группе /ulash и код с сайта' };
  var all = (b && b.items) || [], items = all.slice(0, 100);
  if (!items.length) return { error: 'В партии нет отгрузок' };
  var cut = function (x, n) { return String(x == null ? '' : x).slice(0, n || 300); };
  var title = cut((b && b.title) || 'Партия', 80), msgs = [];
  var head = ((b && b.head) || []).slice(0, 6).map(function (l) { return cut(l); });
  if (all.length > items.length) head.push('Показаны первые ' + items.length + ' из ' + all.length + ' клиентов.');
  if (head.length) msgs.push({ text: head.join('\n') });
  items.forEach(function (x, i) {
    var lat = Number(x.lat), lon = Number(x.lon), ll = x.lat !== '' && x.lat != null && isFinite(lat) && isFinite(lon) && (lat || lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
    var lines = ['📦 ' + title + ' · ' + (i + 1) + ' из ' + items.length, '', '🏷 ' + cut(x.bl, 60) + (x.who ? ' · ' + cut(x.who, 120) : ''),
      '📍 Куда: ' + (cut(x.place) || 'адрес не указан') + (x.own ? ' (своя точка)' : '')];
    if (x.recv) lines.push('👤 Получатель: ' + cut(x.recv, 120));
    if (x.cargo) lines.push('📦 ' + cut(x.cargo, 120));
    if (!ll) lines.push('', 'Точки на карте нет — по адресу.');
    msgs.push({ text: lines.join('\n'), kb: ll ? tgInline_([[{ text: '🧭 Яндекс', url: 'https://yandex.uz/maps/?rtext=~' + lat + ',' + lon + '&rtt=auto' },
      { text: '🗺 Google', url: 'https://www.google.com/maps/dir/?api=1&destination=' + lat + ',' + lon }]]) : undefined });
  });
  var sent = 0, err = '';
  msgs.forEach(function (m, i) {
    if (i >= 19) Utilities.sleep(3100);   // не больше 20 сообщений в минуту в одну группу
    var r = tgSend_(g, m.text, m.kb);
    if (r && !r.ok && r.error_code === 429) { Utilities.sleep(Math.min(60, Number((r.parameters || {}).retry_after) || 5) * 1000 + 500); r = tgSend_(g, m.text, m.kb); }
    if (r && r.ok) sent++; else if (!err) err = (r && r.description) || 'ошибка Telegram';
  });
  return sent ? { sent: sent, of: msgs.length } : { error: 'Telegram не принял сообщение: ' + err };
}
// «Написать водителю»: одному, выбранным или всем, кто сегодня на линии
function tgMessage_(ids, text) {
  text = String(text || '').trim().slice(0, 1500);
  if (!text) return { error: 'Пустое сообщение' };
  var list = tgDrivers_().filter(function (d) { return d.status === 'ruxsat' && (ids === 'online' ? (tgWork_(d) || {}).started : (ids || []).indexOf(d.id) >= 0); });
  list.forEach(function (d) { tgSend_(d.id, tx_(d.lang, 'msg', { text: text })); });
  return { sent: list.length };
}

// ── итог дня в группу: по каждой машине, где работали или было задание ──
function tgSummaryText_(day) {
  var tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(), rec = tgRecent_(1), byTruck = {};
  var put = function (t) { return (byTruck[t] = byTruck[t] || { truck: t, names: [], ok: 0, fail: 0, left: 0, start: '', end: '', dates: {} }); };
  rec.days.filter(function (x) { return x.day === day; }).forEach(function (x) { var o = put(x.truck); if (o.names.indexOf(x.name) < 0) o.names.push(x.name); o.start = o.start || x.start; o.end = x.end || o.end; o.dates[x.date || day] = 1; });
  rec.log.filter(function (x) { return String(x.t).slice(0, 10) === day; }).forEach(function (x) { var o = put(x.truck); if (o.names.indexOf(x.name) < 0) o.names.push(x.name); o[x.ok ? 'ok' : 'fail']++; tgDates_(x.date).forEach(function (dt) { o.dates[dt] = 1; }); });
  tgDrivers_().forEach(function (d) { var a = d.st && d.st.assign; if (d.status === 'ruxsat' && d.truck && a && a.day === day && !a.used) { var o = put(d.truck); if (o.names.indexOf(d.name) < 0) o.names.push(d.name); o.dates[a.date] = 1; o.noStart = true; } });
  var list = Object.keys(byTruck).sort().map(function (k) { return byTruck[k]; });
  if (!list.length) return '';
  TG_MEMO = null;
  var tot = { ok: 0, fail: 0, left: 0 };
  var lines = list.map(function (o) {
    Object.keys(o.dates).forEach(function (dt) { o.left += tgStops_(o.truck, dt).filter(function (x) { return x.open; }).length; });
    tot.ok += o.ok; tot.fail += o.fail; tot.left += o.left;
    return '🚚 ' + o.truck + ' · ' + (o.names.join(', ') || '—') + ': ' + (o.noStart && !o.start ? 'не вышел на линию' : 'доставлено ' + o.ok + ', не доставлено ' + o.fail + ', осталось ' + o.left + (o.start ? ' (' + o.start + '–' + (o.end || 'не закончил') + ')' : ''));
  });
  return '📊 Итог дня ' + tgDmy_(day) + '\n\n' + lines.join('\n') + '\n\nВсего: доставлено ' + tot.ok + ', не доставлено ' + tot.fail + ', осталось ' + tot.left;
}
// по расписанию (триггер создаётся при «Подключить бота»): итог дня в группу
function tgDailySummary() {
  if (!prop_('TG_TOKEN')) return;
  var day = tgNow_('yyyy-MM-dd'), text = tgGroup_() ? tgSummaryText_(day) : '';
  // недоставленные партий, которые сегодня развозили, — на завтра (TG_CARRY = 0 — не переносить)
  if (prop_('TG_CARRY') !== '0') {
    var rec = tgRecent_(1), dates = {};
    rec.days.forEach(function (x) { if (x.day === day) tgDates_(x.date).forEach(function (dt) { dates[dt] = 1; }); });
    rec.log.forEach(function (x) { if (String(x.t).slice(0, 10) === day) tgDates_(x.date).forEach(function (dt) { dates[dt] = 1; }); });
    var to = Utilities.formatDate(new Date(new Date().getTime() + 864e5), SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
    var moved = Object.keys(dates).length ? tgCarry_(Object.keys(dates), to) : [];
    if (moved.length) text += (text ? '\n\n' : '') + '↪️ Не доставленные перенесены на ' + tgDmy_(to) + ': ' + moved.length + ' (' + moved.join(', ') + '). Машину назначьте в «Планах».';
  }
  if (text && tgGroup_()) tgSend_(tgGroup_(), text);
}
// утром по расписанию (tgTick, время TG_MORNING): план дня — водителям, в группу — кому ушёл, кому нет и что без машины.
// Плана на сегодня нет — тишина.
function tgMorningRun_(today) {
  var r = tgDispatch_(today, null, true), D = tgData_(), free = [];
  D.rows.forEach(function (x) {
    var dt = x[0] instanceof Date ? day_(x[0], D.tz) : String(x[0]).slice(0, 10), t = String(x[12]).trim(), bl = String(x[2]).trim();
    if (dt === today && bl && (!t || t === 'Belgilanmagan') && TG_DONE.indexOf(String(x[14]).trim()) < 0 && free.indexOf(bl) < 0) free.push(bl);
  });
  if (!tgGroup_() || !(r.sent.length || r.skipped.length || free.length)) return r;
  var lines = ['🌅 План на ' + tgDmy_(today) + (r.sent.length ? ' отправлен водителям:' : ': водителям ничего не отправлено.')];
  r.sent.forEach(function (x) { lines.push('🚚 ' + x.truck + ' · ' + x.name + ' — точек: ' + x.n); });
  if (r.skipped.length) lines.push('', 'Не отправлено: ' + r.skipped.map(function (x) { return x.truck + ' — ' + x.why; }).join('; '));
  if (free.length) lines.push('', '⚠️ Без машины: ' + free.length + ' (' + free.slice(0, 15).join(', ') + (free.length > 15 ? '…' : '') + ') — назначьте в «Планах» и нажмите «Отправить» на сайте.');
  tgSend_(tgGroup_(), lines.join('\n'));
  return r;
}
// перенос недоставленных («Qolib ketgan») партий dates на дату to: статус «Rejada», без машины и рейса, пометка в примечании;
// попытка доставки с причиной остаётся в «Yetkazish». Возвращает BL (без повторов).
function tgCarry_(dates, to) {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), sh = ss.getSheetByName(SH.ship);
  if (!sh) return [];
  var last = lastRow_(sh, 3, 5);
  if (last < 5) return [];
  var tz = ss.getSpreadsheetTimeZone(), moved = [];
  sh.getRange(5, 1, last - 4, 16).getValues().forEach(function (r, i) {
    var dt = r[0] instanceof Date ? day_(r[0], tz) : String(r[0]).slice(0, 10);
    if (dates.indexOf(dt) < 0 || dt === to || String(r[14]).trim() !== 'Qolib ketgan') return;
    var row = 5 + i, note = String(r[15] || '').trim();
    sh.getRange(row, 1).setValue(date_(to));
    sh.getRange(row, 13, 1, 4).setValues([['Belgilanmagan', '', 'Rejada', (note ? note + ' · ' : '') + 'повторно: не доставлено ' + tgDmy_(dt)]]);
    var bl = String(r[2]).trim(); if (moved.indexOf(bl) < 0) moved.push(bl);
  });
  TG_MEMO = null;
  return moved;
}
function tgEnsureTrigger_() {
  try {
    // итог дня — заново: после смены часового пояса таблицы он должен приходить в 20:00 по Ташкенту
    ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'tgDailySummary') ScriptApp.deleteTrigger(t); });
    var fns = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
    if (fns.indexOf('tgDailySummary') < 0) ScriptApp.newTrigger('tgDailySummary').timeBased().atHour(TG_SUMMARY_HOUR).everyDays(1).inTimezone(SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone()).create();
    if (fns.indexOf('tgTick') < 0) ScriptApp.newTrigger('tgTick').timeBased().everyMinutes(5).create();
    return '';
  } catch (err) { return 'Итог дня по расписанию не включился: ' + ((err && err.message) || err) + '. Выполните в Apps Script функцию authorize и нажмите «Подключить бота» ещё раз.'; }
}
var TG_SUMMARY_HOUR = 20;

// ── раз в 5 минут (триггер): план дня утром; таймер «Жду клиента»; напоминания водителям, которые застряли ──
function tgTick() {
  if (!prop_('TG_TOKEN')) return;
  var hm = tgNow_('HH:mm'), h = Number(hm.slice(0, 2));
  if (h < 5 || h > 22) return;
  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (err) { return; }
  try {
    var t = new Date().getTime(), today = tgNow_('yyyy-MM-dd'), mo = tgMorning_();
    TG_MEMO = null;
    // план дня — один раз в день, в течение 3 часов после заданного времени (день запоминается до отправки)
    if (mo && hm >= mo && hm < tgHmAdd_(mo, 180) && prop_('TG_MORNING_DAY') !== today) {
      props_().setProperty('TG_MORNING_DAY', today);
      try { tgMorningRun_(today); } catch (err) { console.error('План утром: ' + ((err && err.stack) || err)); }
    }
    // правки журнала, о которых водители ещё не знают (сайт не дописал порции или не отправил задание), — через 2 минуты
    var pend = Number(CacheService.getScriptCache().get('tg:ops') || 0);
    if (pend && t - pend > 120000) { try { tgAfterOps_([], false); } catch (err) { console.error('Правки для водителей: ' + ((err && err.stack) || err)); } }
    if (h < 7) return;
    tgDrivers_().forEach(function (d) {
      if (d.status !== 'ruxsat') return;
      var w = tgWork_(d);
      if (!w || w.stage !== 'wait' || !w.wait || !w.cur || w.wait.key !== w.cur.key) { if (h < 22 && tgRemind_()) tgNudge_(d, w, t, today, hm, mo); return; }
      if (t < w.wait.until || w.wait.alerted === w.wait.until) return;
      w.wait.alerted = w.wait.until; tgSave_(d);
      var L = d.lang, mins = Math.round((t - w.wait.since) / 60000), key = w.cur.key;
      tgSend_(d.id, tx_(L, 'waitOver', { min: mins }), tgInline_([[{ text: tx_(L, 'bOk'), callback_data: 'ok:' + key }, { text: tx_(L, 'bFail'), callback_data: 'fail:' + key }], [{ text: tx_(L, 'bMore', { min: tgWaitMin_() }), callback_data: 'wait:' + key }]]));
      var s = tgStops_(d.truck, w.date).filter(function (x) { return x.key === key; })[0], tels = s ? tgClientTels_(s.c) : [];
      tgReport_('⏰ ' + d.truck + ' · ' + d.name + ': ждёт клиента ' + w.cur.bl + ' уже ' + mins + ' мин.' + (tels.length ? '\n☎️ ' + tels.map(function (x) { return x.t; }).join(', ') : ''));
    });
  } finally { lock.releaseLock(); }
}
function tgHmAdd_(hm, min) { var m = Math.min(23 * 60 + 59, Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5)) + min); return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + m % 60).slice(-2); }

// ── напоминания: что бот сейчас ждёт от водителя. Одно и то же состояние дольше порога — напомнить той же кнопкой,
// дольше второго порога — ещё раз и в группу офиса; дальше тишина, пока водитель что-нибудь не нажмёт.
// Состояние («подпись»: шаг, точка, число фото, закрытые точки) тик запоминает в st.nudge — время считается от того,
// как тик его впервые увидел (точность — 5 минут).
var TG_STEP_RU = { photo: 'фото', failPhoto: 'фото места', loc: 'геолокация', reason: 'причина', reasonText: 'причина', startLoc: 'начало работы', endLoc: 'конец работы', noAnswer: 'клиент не отвечает' };
function tgNudge_(d, w, t, today, hm, mo) {
  var st = d.st = d.st || {}, stage = w ? w.stage || '' : '', kind = '', a = null, x = {};
  if (st.pr || (st.probAt && t - st.probAt < 3600e3)) return;   // сообщает о проблеме или только что сообщил
  if (w && !w.started) { if (stage === 'startLoc') kind = 'step'; }
  else if (w) {
    if (stage === 'noAnswer' && w.cur) kind = 'na';
    else if (TG_STEP_RU[stage] && (w.cur || stage === 'endLoc')) kind = 'step';
    else if (stage === 'roundWait') kind = 'round';
    else if (!stage && w.cur) kind = 'card';
    else if (!stage) { var all = tgStops_(d.truck, w.date); if (all.length && !all.some(function (s) { return s.open; })) kind = 'done'; }
  } else {
    var w0 = st.work;
    a = tgAssigned_(d);
    if (a && a.date <= today && !(w0 && (w0.day || w0.date) === today && w0.ended)) kind = 'start';
  }
  if (!kind) { if (st.nudge) { delete st.nudge; tgSave_(d); } return; }
  var sig = kind + '|' + (w ? [stage, w.cur ? w.cur.key : '', (w.photos || []).length, (w.ok || 0) + (w.fail || 0), w.round || ''].join('|') : a.date + '|' + a.at);
  var n = st.nudge;
  if (!n || n.sig !== sig || n.day !== today) {
    st.nudge = { sig: sig, since: t, n: 0, day: today }; tgSave_(d);
    return;
  }
  var mins = Math.round((t - n.since) / 60000), due1 = false, due2 = false;
  if (kind === 'start') {
    x.n = tgStops_(d.truck, a.date).filter(function (s) { return s.open; }).length;
    if (!x.n) return;
    due1 = hm >= tgHmAdd_(mo || '08:30', 60) && mins >= 30; due2 = !!n.at && t - n.at >= 30 * 60000;   // задание днём — не раньше чем через 30 минут
  } else if (kind === 'card') {
    var s = tgStops_(d.truck, w.date).filter(function (y) { return y.key === w.cur.key && y.open; })[0];
    if (!s) return;
    var tr = tgTravelMin_(w.pos || tgDepot_(), s.c), T1 = Math.max(45, Math.round(tr == null ? 30 : tr) + 30);
    due1 = mins >= T1; due2 = mins >= T1 + 30;
  } else if (kind === 'round') {
    var nx = tgStops_(d.truck, w.date).filter(function (y) { return y.open; }).map(function (y) { return y.round; }).sort(function (p, q) { return p - q; });
    x.next = nx.filter(function (r) { return r > (w.round || 0); })[0] || nx[0];
    if (!x.next) return;
    due1 = mins >= 60;
  } else if (kind === 'done') due1 = mins >= 30;
  else if (kind === 'na') { due1 = mins >= 30; due2 = mins >= 60; }
  else { due1 = mins >= 10; due2 = mins >= 20; }
  if (n.n === 0 && due1) { n.n = 1; n.at = t; tgSave_(d); tgNudgeSend_(d, w, kind, x); }
  else if (n.n === 1 && due2) {
    n.n = 2; n.at = t; tgSave_(d); tgNudgeSend_(d, w, kind, x);
    var who = d.truck + ' · ' + d.name;
    if (kind === 'start') tgReport_('🚚 ' + who + ' ещё не вышел на линию (партия ' + tgDmy_(a.date) + ', точек: ' + x.n + ').');
    else if (kind === 'card') tgReport_('⏰ ' + who + ': ' + mins + ' мин без отметки у ' + w.cur.bl + '.' + (w.pos ? '\n🚚 Последняя отметка' + (w.posAt ? ' в ' + w.posAt : '') + ': ' + tgMap_(w.pos) : ''));
    else tgReport_('⏰ ' + who + ': ' + mins + ' мин на шаге «' + TG_STEP_RU[stage] + '»' + (w.cur ? ' — ' + w.cur.bl : '') + '. Позвоните водителю.');
  }
}
// напоминание водителю — тот же шаг и те же кнопки, что он пропустил
function tgNudgeSend_(d, w, kind, x) {
  var L = d.lang, id = d.id, pre = '⏰ ', sg = w ? w.stage : '';
  if (kind === 'start') return tgSend_(id, tx_(L, 'remindStart', { n: x.n }), tgInline_([[{ text: tx_(L, 'bStart'), callback_data: 'start' }]]));
  if (kind === 'done') return tgSend_(id, tx_(L, 'remindEnd'), tgInline_([[{ text: tx_(L, 'bEnd'), callback_data: 'end' }]]));
  if (kind === 'card') return tgSend_(id, tx_(L, 'remindCard', { bl: w.cur.bl }), tgInline_([[{ text: tx_(L, 'bOk'), callback_data: 'ok:' + w.cur.key }, { text: tx_(L, 'bFail'), callback_data: 'fail:' + w.cur.key }], [{ text: tx_(L, 'bWait'), callback_data: 'wait:' + w.cur.key }]]));
  if (kind === 'round') return tgSend_(id, pre + tx_(L, 'roundDone', { round: w.round, next: x.next }), tgInline_([[{ text: tx_(L, 'bRound', { next: x.next }), callback_data: 'round:' + x.next }]]));
  if (kind === 'na') return tgSend_(id, pre + tx_(L, 'noAnswer'), tgNoAnswerKb_(d, w));
  if (sg === 'photo' || sg === 'failPhoto') {
    if ((w.photos || []).length) return tgSend_(id, pre + tx_(L, 'photoOk', { n: w.photos.length }), tgCamera_() ? tgPhotoDoneKb_(d, w) : { keyboard: [[tx_(L, 'bDone')], [tx_(L, 'bCancel')]], resize_keyboard: true });
    return tgPhotoAsk_(d, w, sg === 'photo' ? 'askPhoto' : 'askPhotoFail', pre);
  }
  if (sg === 'reason') return tgSend_(id, pre + tx_(L, 'askReason'), tgReasonKb_(L));
  if (sg === 'reasonText') return tgSend_(id, pre + tx_(L, 'askReasonText'));
  return tgSend_(id, pre + tx_(L, sg === 'startLoc' ? 'askLocStart' : sg === 'endLoc' ? 'askLocEnd' : 'askLoc'), tgLocKb_(L));
}

// ── фото с камеры (driver.html): вход по подписи Telegram (initData), а не по паролю таблицы ──
function tgInitUser_(init) {
  var token = prop_('TG_TOKEN');
  if (!token || !init) return null;
  var data = {}, hash = '';
  try { String(init).split('&').forEach(function (p) { var i = p.indexOf('='); if (i < 0) return; var k = decodeURIComponent(p.slice(0, i)), v = decodeURIComponent(p.slice(i + 1)); if (k === 'hash') hash = v; else data[k] = v; }); }
  catch (err) { return null; }   // испорченная строка — не подпись Telegram
  if (!hash || !data.user) return null;
  var dcs = Object.keys(data).sort().map(function (k) { return k + '=' + data[k]; }).join('\n');
  var key = Utilities.computeHmacSha256Signature(token, 'WebAppData');
  var hex = Utilities.computeHmacSha256Signature(Utilities.newBlob(dcs).getBytes(), key).map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
  if (hex !== hash || new Date().getTime() / 1000 - Number(data.auth_date || 0) > 86400) return null;
  try { return JSON.parse(data.user); } catch (err) { return null; }
}
function tgUpload_(method, fields, name, blob) {
  var payload = {};
  Object.keys(fields).forEach(function (k) { payload[k] = typeof fields[k] === 'object' ? JSON.stringify(fields[k]) : String(fields[k]); });
  payload[name] = blob;
  try { return JSON.parse(UrlFetchApp.fetch(TG_API + 'bot' + prop_('TG_TOKEN') + '/' + method, { method: 'post', payload: payload, muteHttpExceptions: true }).getContentText() || '{}'); }
  catch (err) { return { ok: false, description: String((err && err.message) || err) }; }
}
// снимок водителя: в чат водителя (так у фото появляется file_id Telegram), в шаг «фото» текущей точки; место — со снимка
function tgPhotoUpload_(p) {
  var u = tgInitUser_(p && p.init);
  if (!u) return { error: 'Откройте камеру кнопкой в боте: подпись Telegram не подходит или устарела', code: 'auth', v: VERSION };
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    TG_MEMO = null;
    var d = tgDriver_(u.id), w = d && d.status === 'ruxsat' ? tgWork_(d) : null;
    if (!w) return { error: 'Рабочий день не начат', code: 'stage', v: VERSION };
    // камера с карточки версии 15, оставшейся в чате после обновления: снимок открытой точки — как «✅ Доставлено»
    if ((!w.stage || w.stage === 'wait') && w.cur && w.cur.key === String(p.key || '') && !p.done) {
      if (p.ping) return { ok: true, ping: true, n: 0, v: VERSION };
      w.waited = w.wait && w.wait.key === w.cur.key ? Math.max(1, Math.round((new Date().getTime() - w.wait.since) / 60000)) : 0; w.wait = null;
      w.result = 'ok'; w.photos = []; w.reason = ''; w.photoLL = null; w.stage = 'photo';
    }
    if ((w.stage !== 'photo' && w.stage !== 'failPhoto') || !w.cur || w.cur.key !== String(p.key || '')) return { error: tx_(d.lang, 'stale'), code: 'stage', v: VERSION };
    if (p.ping) return { ok: true, ping: true, n: (w.photos || []).length, v: VERSION };   // страница камеры открылась: связь и шаг — в порядке
    if (p.done) {   // «✅ Готово» в мини-приложении: точка закрывается, как по кнопке в боте
      if (!(w.photos || []).length) return { error: tx_(d.lang, 'needPhoto'), code: 'nophoto', v: VERSION };
      var needLoc = !w.photoLL;
      tgPhotoDone_(d, w);
      return { ok: true, done: true, needLoc: needLoc, v: VERSION };
    }
    if ((w.photos || []).length >= 10) return { error: 'Не больше 10 фото на точку', code: 'many', v: VERSION };
    var b64 = String(p.img || '').replace(/^data:image\/\w+;base64,/, '');
    if (!b64 || b64.length > 8e6) return { error: 'Фото не пришло или слишком большое', code: 'img', v: VERSION };
    var r = tgUpload_('sendPhoto', { chat_id: d.id, caption: tx_(d.lang, 'photoCap') + ' · ' + w.cur.bl + ' · ' + tgNow_('HH:mm'), reply_markup: tgPhotoDoneKb_(d, w) }, 'photo', Utilities.newBlob(Utilities.base64Decode(b64), 'image/jpeg', w.cur.bl + '.jpg'));
    if (!r.ok || !r.result || !r.result.photo) return { error: 'Telegram не принял фото: ' + (r.description || 'нет ответа'), code: 'tg', v: VERSION };
    w.photos = (w.photos || []).concat([r.result.photo[r.result.photo.length - 1].file_id]);
    var ll = p.ll;
    if (ll && ll.length === 2 && isFinite(ll[0]) && isFinite(ll[1]) && Math.abs(ll[0]) <= 90 && Math.abs(ll[1]) <= 180 && (ll[0] || ll[1])) w.photoLL = [Number(ll[0]), Number(ll[1])];
    tgSave_(d);
    return { ok: true, n: w.photos.length, v: VERSION };
  } finally { lock.releaseLock(); }
}

// ── для сайта: отметки доставки и рабочие дни за последние дни ──
function tgRecent_(days) {
  var tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(), from = Utilities.formatDate(new Date(Date.now() - (days - 1) * 864e5), tz, 'yyyy-MM-dd');
  var iso = function (v) { return v instanceof Date ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : String(v || '').slice(0, 10); };
  var rows = function (k, n) { var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TG[k]); if (!sh || sh.getLastRow() < 2) return []; var last = sh.getLastRow(), first = Math.max(2, last - 2999); return sh.getRange(first, 1, last - first + 1, n).getValues(); };
  var log = rows('log', 14).filter(function (r) { return r[0] !== '' && iso(r[0] instanceof Date ? r[0] : String(r[0]).slice(0, 10)) >= from; }).map(function (r) {
    var t = r[0] instanceof Date ? Utilities.formatDate(r[0], tz, 'yyyy-MM-dd HH:mm') : String(r[0]);
    return { t: t, date: iso(r[1]), name: String(r[2]), truck: String(r[3]), bl: String(r[4]), client: String(r[5]), ok: String(r[6]) === 'Yetkazildi', reason: String(r[7] || ''), photos: String(r[8] || '').split(/\s+/).filter(Boolean), ll: String(r[9] || ''), id: String(r[10]), round: Number(r[11]) || 1, wait: Number(r[12]) || 0, km: r[13] === '' || r[13] == null ? null : Number(r[13]) };
  });
  var hm = function (v) { return v instanceof Date ? Utilities.formatDate(v, tz, 'HH:mm') : String(v || ''); };
  var dys = rows('days', 11).filter(function (r) { return r[0] !== '' && iso(r[0]) >= from; }).map(function (r) {
    return { day: iso(r[0]), name: String(r[1]), truck: String(r[2]), start: hm(r[3]), startLL: String(r[4] || ''), end: hm(r[5]), endLL: String(r[6] || ''), ok: Number(r[7]) || 0, fail: Number(r[8]) || 0, id: String(r[9]), date: r[10] ? iso(r[10]) : iso(r[0]) };
  });
  var probs = rows('problems', 8).filter(function (r) { return r[0] !== '' && iso(r[0] instanceof Date ? r[0] : String(r[0]).slice(0, 10)) >= from; }).map(function (r) {
    return { t: r[0] instanceof Date ? Utilities.formatDate(r[0], tz, 'yyyy-MM-dd HH:mm') : String(r[0]), name: String(r[1]), truck: String(r[2]), type: String(r[3]), text: String(r[4] || ''), photos: String(r[5] || '').split(/\s+/).filter(Boolean), ll: String(r[6] || ''), id: String(r[7]) };
  });
  return { log: log, days: dys, problems: probs };
}

// номер и имя диспетчера: 998… и 9 цифр → +998…; пусто — убрать
function tgSetDispatcher_(p, a) {
  var ph = String(a.phone || '').replace(/[^\d+]/g, ''), nm = String(a.name || '').trim().slice(0, 40);
  if (ph && !/^\+?\d{9,15}$/.test(ph)) return 'Телефон диспетчера — 9–15 цифр, например +998 77 017 66 11';
  if (ph && ph.charAt(0) !== '+' && ph.length === 12 && ph.slice(0, 3) === '998') ph = '+' + ph;
  if (ph && ph.charAt(0) !== '+' && ph.length === 9) ph = '+998' + ph;
  if (ph) p.setProperty('TG_DISP_PHONE', ph); else p.deleteProperty('TG_DISP_PHONE');
  if (nm) p.setProperty('TG_DISP_NAME', nm); else p.deleteProperty('TG_DISP_NAME');
  return '';
}
// ── сайт: подключить бота, водители ──
// действия сайта с ботом — под той же блокировкой, что и кнопки водителей: два «Отправить» подряд (или с двух устройств)
// и нажатие водителя в ту же секунду не перезаписывают состояние друг друга и не шлют задание дважды
function tgSiteLocked_(body) {
  if ((body.tg || {}).action === 'batchinfo') return tgSite_(body);   // в группу — минуты (паузы Telegram), таблицу не трогает: без блокировки
  var lock = LockService.getScriptLock();
  try { lock.waitLock(25000); } catch (err) { return { error: 'Бот сейчас занят — нажмите ещё раз через несколько секунд.', v: VERSION }; }
  try { return tgSite_(body); } finally { lock.releaseLock(); }
}
function tgSite_(body) {
  var a = body.tg || {};
  // без EDITOR_TOKEN — отказ (версия 19; раньше бота с сайта мог настраивать любой, кто знает пароль таблицы)
  var deny = editor_(body.editor, 'Бот настраивает только руководитель: секрет редактора не подходит');
  if (deny) return deny;
  if (!prop_('TG_TOKEN')) return { error: 'В свойствах скрипта нет TG_TOKEN — впишите токен бота от @BotFather и нажмите «Сохранить свойства скрипта». ' + propNames_(), code: 'notoken', v: VERSION };
  var p = props_();
  // адрес сайта (кнопка камеры открывает его driver.html) и ссылка веб-приложения — с каждого запроса сайта
  if (/^https:\/\/[^\s?#]+\/$/.test(String(body.site || '')) && prop_('TG_SITE') !== body.site) p.setProperty('TG_SITE', body.site);
  var hookUrl = String(a.url || body.hook || '');
  if (/^https:\/\/script\.google\.com\/(a\/macros\/[^\/]+|macros)\/s\/[\w-]+\/exec$/.test(hookUrl) && prop_('TG_URL') !== hookUrl) p.setProperty('TG_URL', hookUrl);
  if (a.action === 'settings') {
    if (a.phone != null) { var se = tgSetDispatcher_(p, a); if (se) return { error: se, v: VERSION }; }
    if (a.camera != null) p.setProperty('TG_CAMERA', a.camera ? '1' : '0');
    if (a.waitMin != null) { var wm = Math.round(Number(a.waitMin)); if (!(wm >= 5 && wm <= 120)) return { error: 'Ожидание клиента — от 5 до 120 минут', v: VERSION }; p.setProperty('TG_WAIT_MIN', String(wm)); }
    if (a.maxKm != null) { var mk = Number(a.maxKm); if (!(mk > 0 && mk <= 50)) return { error: 'Расстояние до клиента — от 0,1 до 50 км', v: VERSION }; p.setProperty('TG_MAX_KM', String(mk)); }
    if (a.carry != null) p.setProperty('TG_CARRY', a.carry ? '1' : '0');
    if (a.remind != null) p.setProperty('TG_REMIND', a.remind ? '1' : '0');
    if (a.morning != null) {
      var mo = String(a.morning).trim();
      if (mo && mo !== 'off' && !tgMorningOk_(mo)) return { error: 'План утром — время от 05:00 до 11:00 (ЧЧ:ММ) или «выкл»', v: VERSION };
      p.setProperty('TG_MORNING', mo && mo !== 'off' ? mo : 'off');
    }
    return { ok: true, v: VERSION, tg: tgInfo_(body.tgdays) };
  }
  if (a.action === 'setup') {
    var me = tg_('getMe', {});
    if (!me.ok) return { error: 'Telegram не принял токен из TG_TOKEN: ' + (me.description || 'нет ответа') + '. Проверьте токен у @BotFather.', code: 'badtoken', v: VERSION };
    if (!/^https:\/\/script\.google\.com\/(a\/macros\/[^\/]+|macros)\/s\/[\w-]+\/exec$/.test(String(a.url || ''))) return { error: 'Нужна ссылка веб-приложения …/exec', code: 'url', v: VERSION };
    var secret = prop_('TG_SECRET') || Utilities.getUuid().replace(/-/g, '');
    p.setProperty('TG_SECRET', secret); p.setProperty('TG_BOT', me.result.username);
    if (!prop_('TG_GROUP_CODE')) p.setProperty('TG_GROUP_CODE', String(100000 + Math.floor(Math.random() * 900000)));
    var hook = tg_('setWebhook', { url: a.url + '?tg=' + secret, allowed_updates: ['message', 'callback_query'], max_connections: 10 });
    if (!hook.ok) return { error: 'Telegram не принял ссылку бота: ' + (hook.description || 'нет ответа'), code: 'hook', v: VERSION };
    var cmd = function (l) { return [{ command: 'start', description: l === 'ru' ? 'Регистрация' : 'Ro‘yxatdan o‘tish' }, { command: 'ish', description: tx_(l, 'bStart').slice(2) }, { command: 'hozir', description: tx_(l, 'bCur').slice(2) }, { command: 'tugatish', description: tx_(l, 'bEnd').slice(2) }, { command: 'til', description: tx_(l, 'bLang').slice(2) }, { command: 'dispetcher', description: tx_(l, 'bCall').slice(2) }, { command: 'muammo', description: tx_(l, 'bProblem').slice(2) }]; };
    tg_('setMyCommands', { commands: cmd('uz') });
    tg_('setMyCommands', { commands: cmd('ru'), language_code: 'ru' });
    var warn = tgEnsureTrigger_();
    return { ok: true, v: VERSION, tg: tgInfo_(body.tgdays), warn: warn };
  }
  if (a.action === 'dispatch') {
    if (!/^20\d\d-\d\d-\d\d(\+20\d\d-\d\d-\d\d)?$/.test(String(a.date || ''))) return { error: 'Выберите партию', v: VERSION };   // «A+B» — две партии одним заданием (версия 28)
    var r = tgDispatch_(a.date, a.ids);
    return { ok: true, v: VERSION, sent: r.sent, skipped: r.skipped, already: r.already, tg: tgInfo_(body.tgdays) };
  }
  if (a.action === 'dispatcher') {
    var de = tgSetDispatcher_(p, a);
    return de ? { error: de, v: VERSION } : { ok: true, v: VERSION, tg: tgInfo_(body.tgdays) };
  }
  if (a.action === 'carry') {
    if (!/^20\d\d-\d\d-\d\d(\+20\d\d-\d\d-\d\d)?$/.test(String(a.from || '')) || !/^20\d\d-\d\d-\d\d$/.test(String(a.to || '')) || tgDates_(a.from).indexOf(a.to) >= 0) return { error: 'Выберите партию и другую дату', v: VERSION };
    return { ok: true, v: VERSION, moved: tgCarry_(tgDates_(a.from), a.to) };   // «A+B» — недоставленные обеих партий
  }
  if (a.action === 'batchinfo') { var bi = tgBatchInfo_(a.batch); return bi.error ? { error: bi.error, v: VERSION } : { ok: true, v: VERSION, sent: bi.sent, of: bi.of }; }   // версия 29
  if (a.action === 'message') { var mr = tgMessage_(a.ids, a.text); return mr.error ? { error: mr.error, v: VERSION } : { ok: true, v: VERSION, sent: mr.sent }; }
  if (a.action === 'summary') {
    if (!tgGroup_()) return { error: 'Группа отчётов не привязана: отправьте в группе /ulash и код с сайта', v: VERSION };
    var tx = tgSummaryText_(tgNow_('yyyy-MM-dd'));
    if (!tx) return { error: 'Сегодня водители ещё не работали', v: VERSION };
    tgSend_(tgGroup_(), tx);
    return { ok: true, v: VERSION, text: tx };
  }
  if (a.action === 'driver') {
    var d = tgDriver_(a.id), fr = [];
    if (!d) return { error: 'Нет такого водителя', v: VERSION };
    if (['ruxsat', 'rad', 'o‘chirilgan'].indexOf(a.status) < 0) return { error: 'Неизвестный статус', v: VERSION };
    var give = a.status === 'ruxsat' && a.truck != null, te = give ? tgTruckErr_(a.truck) : '', car = null;   // заявка с машиной, выбранной на сайте
    if (a.status === 'ruxsat' && a.car && d.status !== 'ruxsat') {   // версия 31: своя машина водителя — в автопарк, потом доступ
      car = tgCarApply_(d, a.car);
      if (car.error) return { error: car.error, v: VERSION };
      var ts = tgSetTruck_(d, car.name);
      if (ts.error) return { error: ts.error, v: VERSION };
      fr = ts.freed;
      tgSetStatus_(d, a.status, 'сайт');
      return { ok: true, v: VERSION, freed: fr, truck: car.name, isNew: car.isNew, tg: tgInfo_(body.tgdays) };
    }
    if (te) return { error: te, v: VERSION };
    tgSetStatus_(d, a.status, 'сайт');
    if (give) fr = tgSetTruck_(d, a.truck).freed;
    return { ok: true, v: VERSION, freed: fr, tg: tgInfo_(body.tgdays) };
  }
  // версия 30: карточка водителя — имя и телефон (машина — action 'truck'); удалить водителя — строка листа убирается
  if (a.action === 'drvedit') {
    var de = tgDriver_(a.id);
    if (!de) return { error: 'Нет такого водителя', v: VERSION };
    var nm = String(a.name == null ? de.name : a.name).replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!nm) return { error: 'Укажите имя водителя', v: VERSION };
    var ph = String(a.phone == null ? de.phone : a.phone).replace(/[^\d+]/g, '').slice(0, 20);
    if (ph && !/^\+?\d{7,15}$/.test(ph)) return { error: 'Телефон: 7–15 цифр, например +998901234567', v: VERSION };
    tgHead_('drivers');
    de.name = nm; de.phone = ph;
    tgSave_(de);
    return { ok: true, v: VERSION, tg: tgInfo_(body.tgdays) };
  }
  if (a.action === 'drvdel') {
    var dd = tgDriver_(a.id);
    if (!dd) return { error: 'Нет такого водителя', v: VERSION };
    if (dd.status === 'ruxsat' || dd.status === 'kutilmoqda') tgSend_(dd.id, tx_(dd.lang, 'off'), { remove_keyboard: true });
    tgSheet_('drivers').deleteRow(dd.row);
    return { ok: true, v: VERSION, tg: tgInfo_(body.tgdays) };
  }
  if (a.action === 'truck') {
    var dt = tgDriver_(a.id);
    if (!dt || dt.status === 'yangi') return { error: 'Нет такого водителя', v: VERSION };
    var tr = tgSetTruck_(dt, a.truck);
    return tr.error ? { error: tr.error, v: VERSION } : { ok: true, v: VERSION, freed: tr.freed, tg: tgInfo_(body.tgdays) };
  }
  return { ok: true, v: VERSION, tg: tgInfo_(body.tgdays) };
}
// для сайта: бот, группа, код привязки группы, водители (без состояния диалога), отметки и рабочие дни за days дней
// (по умолчанию 2 — сайт опрашивает таблицу каждые 30 с; до 45 — вкладка «Водители» за период)
function tgInfo_(days) {
  if (!prop_('TG_TOKEN')) return null;
  var span = Math.min(45, Math.max(1, Math.round(Number(days)) || 2));
  var tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(), rec = tgRecent_(span);
  return { bot: prop_('TG_BOT'), hooked: !!prop_('TG_SECRET'), group: prop_('TG_GROUP_TITLE') || '', grouped: !!prop_('TG_GROUP'), code: prop_('TG_GROUP_CODE'), summaryHour: TG_SUMMARY_HOUR, span: span,
    dispatcher: { name: prop_('TG_DISP_NAME'), phone: prop_('TG_DISP_PHONE') },
    tz: tz, scriptTz: Session.getScriptTimeZone(),   // сайт предупредит, если не Ташкент: иначе «сегодня» и время водителей сдвинуты
    settings: { camera: prop_('TG_CAMERA') !== '0', cameraReady: tgCamera_(), site: prop_('TG_SITE'), waitMin: tgWaitMin_(), maxKm: tgMaxKm_(), carry: prop_('TG_CARRY') !== '0',
      remind: tgRemind_(), morning: tgMorning_(), morningDay: prop_('TG_MORNING_DAY') || '' },
    drivers: tgDrivers_().filter(function (d) { return d.status !== 'yangi'; }).map(function (d) {
      var w = d.st && d.st.work, today = tgNow_('yyyy-MM-dd'), a = tgAssigned_(d), day = w && (w.day || w.date);
      return { id: d.id, name: d.name, phone: d.phone, truck: d.truck, plate: d.plate, lang: d.lang, status: d.status,
        car: d.kind ? { kind: d.kind, plate: d.plate, model: d.model, body: d.body, m3: d.m3, kg: d.kg } : null, at: d.at instanceof Date ? Utilities.formatDate(d.at, tz, 'yyyy-MM-dd HH:mm') : String(d.at || ''), user: d.user,
        today: w && day === today && w.started ? { started: w.started, ended: w.ended || '', ok: w.ok || 0, fail: w.fail || 0, pos: w.pos || null, posAt: w.posAt || '', date: w.date, cur: w.cur ? { bl: w.cur.bl, round: w.cur.round } : null } : null,
        assign: a ? { date: a.date, at: a.at } : null };
    }), log: rec.log, days: rec.days, problems: rec.problems,
    subs: tgSubs_().filter(function (c) { return c.status !== 'yangi'; }).map(function (c) { return { bl: c.bl, name: c.name, phone: c.phone, status: c.status, at: c.at instanceof Date ? Utilities.formatDate(c.at, tz, 'yyyy-MM-dd HH:mm') : String(c.at || '') }; }) };
}
