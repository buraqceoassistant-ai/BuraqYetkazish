/* Вход по логину и паролю, смена пароля.
   Данные сайта лежат только в зашифрованном data/vault.json (см. tools/vault.mjs).
   Пароль превращается в ключ (PBKDF2-SHA256), им расшифровывается ключ данных,
   а им — Excel-файл, из которого приложение строит журнал, клиентов и планы.
   Пока вход не выполнен, приложение ждёт window.LOGI_TEMPLATE_B64 и ничего не показывает.
   Смена пароля записывает новый vault.json в репозиторий через GitHub API
   (нужен токен с правом Contents: Read and write), после чего сайт пересобирается.
   Там же, зашифрованные тем же ключом, лежат общие настройки сайта (vault.config),
   например ссылка на Google Таблицу — её получают все устройства после входа.
   Роль пользователя — vault.users[…].role: нет роли — руководитель (всё можно), 'viewer' — только просмотр
   (сайт скрывает правки и ничего не записывает; см. index.html, readOnly).
   Настройки руководителя (vault.owner, например секрет редактора для ИИ-импорта) зашифрованы отдельным
   ключом руководителя: он завёрнут паролем только в записи руководителей (vault.users[…].okey),
   поэтому вход «только просмотр» их не расшифрует. */
(function () {
  'use strict';
  var REPO = { owner: 'buraqceoassistant-ai', repo: 'BuraqYetkazish', path: 'data/vault.json' };
  var VAULT_URL = REPO.path;
  var KEY = 'logi-auth-key';            // ключ данных: localStorage («запомнить») или sessionStorage
  var KEY_PREV = 'logi-auth-key-prev';  // прежний ключ, пока сайт не обновился после смены пароля
  var LOGIN = 'logi-auth-login';
  var GH_TOKEN = 'logi-gh-token';
  var OKEY = 'logi-auth-okey';          // ключ руководителя: открывает vault.owner (секрет редактора)
  var BAD = 'Неверный логин или пароль';
  var MIN_PASSWORD = 8;
  var subtle = window.crypto && window.crypto.subtle;
  var enc = new TextEncoder();

  function unb64(s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  function b64(u) { var s = ''; for (var i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (x) { return (x < 16 ? '0' : '') + x.toString(16); }).join(''); }
  function rand(n) { return window.crypto.getRandomValues(new Uint8Array(n)); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function normLogin(l) { return String(l || '').trim().toLowerCase(); }

  // ── Хранилище браузера ──
  function store(name) { try { return window[name]; } catch (e) { return null; } }
  function both() { return [store('localStorage'), store('sessionStorage')]; }
  function get(k) { var r = null; both().forEach(function (st) { try { if (!r && st) r = st.getItem(k); } catch (e) { /* нет доступа */ } }); return r; }
  function put(k, v, remember) { try { (remember ? store('localStorage') : store('sessionStorage')).setItem(k, v); } catch (e) { /* приватный режим: до перезагрузки */ } }
  function drop(k) { both().forEach(function (st) { try { st && st.removeItem(k); } catch (e) { /* нет доступа */ } }); }
  function remembered() { try { return !!store('localStorage').getItem(KEY); } catch (e) { return false; } }

  // ── Криптография хранилища (тот же формат, что в tools/vault.mjs) ──
  async function loginId(v, login) {
    var salt = unb64(v.userSalt), name = enc.encode(normLogin(login)), buf = new Uint8Array(salt.length + name.length);
    buf.set(salt); buf.set(name, salt.length);
    return hex(await subtle.digest('SHA-256', buf));
  }
  async function kek(v, password, salt, usage) {
    var base = await subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    return subtle.deriveKey({ name: 'PBKDF2', hash: v.kdf.hash, salt: salt, iterations: v.kdf.iterations }, base, { name: 'AES-GCM', length: 256 }, false, [usage]);
  }
  async function unwrapKey(v, login, password) {
    var u = v.users[await loginId(v, login)];
    if (!u) throw new Error(BAD);
    try { return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: unb64(u.iv) }, await kek(v, password, unb64(u.salt), 'decrypt'), unb64(u.key))); }
    catch (e) { throw new Error(BAD); }
  }
  async function wrapKey(v, login, password, dekRaw, okRaw) {
    var salt = rand(16), iv = rand(12), id = await loginId(v, login), role = (v.users[id] || {}).role, k = await kek(v, password, salt, 'encrypt');
    var key = await subtle.encrypt({ name: 'AES-GCM', iv: iv }, k, dekRaw);
    v.users[id] = { salt: b64(salt), iv: b64(iv), key: b64(new Uint8Array(key)) };
    if (role) v.users[id].role = role;   // смена пароля роль не меняет
    if (okRaw) v.users[id].okey = await wrapOwner(k, okRaw);   // и ключ руководителя — под новым паролем
  }
  // ключ руководителя: тем же ключом из пароля, что и ключ данных, со своим iv
  async function wrapOwner(k, okRaw) { var iv = rand(12); return { iv: b64(iv), key: b64(new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: iv }, k, okRaw))) }; }
  async function unwrapOwnerKey(v, login, password) {
    var u = v.users[await loginId(v, login)];
    if (!u || !u.okey) return null;
    try { return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: unb64(u.okey.iv) }, await kek(v, password, unb64(u.salt), 'decrypt'), unb64(u.okey.key))); }
    catch (e) { return null; }
  }
  async function decryptData(v, dekRaw) {
    var dek = await subtle.importKey('raw', dekRaw, 'AES-GCM', false, ['decrypt']);
    return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: unb64(v.data.iv) }, dek, unb64(v.data.ct)));
  }
  async function encryptData(v, dekRaw, bytes) {
    var iv = rand(12), dek = await subtle.importKey('raw', dekRaw, 'AES-GCM', false, ['encrypt']);
    v.data = { iv: b64(iv), ct: b64(new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: iv }, dek, bytes))) };
  }

  async function encryptJSON(dekRaw, obj) {
    var iv = rand(12), dek = await subtle.importKey('raw', dekRaw, 'AES-GCM', false, ['encrypt']);
    return { iv: b64(iv), ct: b64(new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: iv }, dek, enc.encode(JSON.stringify(obj))))) };
  }
  async function decryptJSON(dekRaw, box) {
    var dek = await subtle.importKey('raw', dekRaw, 'AES-GCM', false, ['decrypt']);
    return JSON.parse(new TextDecoder().decode(await subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, dek, unb64(box.ct))));
  }

  var vaultP = null, openKey = null, role = 'owner';
  var ownerCfg = null, ownerState = 'none';   // 'open' — секрет открыт; 'locked' — есть, но на этом устройстве нет ключа; 'none' — не задан; 'viewer'
  window.LOGI_CONFIG = {};
  // роль вошедшего: по логину, сохранённому при входе (старые входы без логина — руководитель)
  async function roleOf(v, login) {
    var u = login ? v.users[await loginId(v, login)] : null;
    role = u && u.role === 'viewer' ? 'viewer' : 'owner';
    document.documentElement.classList.toggle('read-only', role === 'viewer');
  }
  function vault() {
    return vaultP || (vaultP = fetch(VAULT_URL, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).catch(function (e) { vaultP = null; throw e; }));
  }
  async function openData(keyB64, login, okB64) {
    var v = await vault(), xlsx = await decryptData(v, unb64(keyB64));
    await roleOf(v, login || get(LOGIN));
    try { window.LOGI_CONFIG = v.config ? await decryptJSON(unb64(keyB64), v.config) : {}; } catch (e) { window.LOGI_CONFIG = {}; }
    await openOwner(v, login || get(LOGIN), okB64 || get(OKEY));
    openKey = keyB64;
    window.LOGI_TEMPLATE_B64 = b64(xlsx);
  }
  async function openOwner(v, login, okB64) {
    ownerCfg = null;
    if (role === 'viewer') { ownerState = 'viewer'; return; }
    var u = login ? v.users[await loginId(v, login)] : null;
    ownerState = v.owner && u && u.okey ? 'locked' : 'none';
    if (!v.owner || !okB64) return;
    try { ownerCfg = await decryptJSON(unb64(okB64), v.owner); ownerState = 'open'; } catch (e) { /* ключ устарел — нужен пароль */ }
  }
  // Сохранённые ключи: текущий и прежний (сразу после смены пароля сайт ещё отдаёт старый vault.json).
  async function openWithStored() {
    var cur = get(KEY), prev = get(KEY_PREV);
    var list = [cur, prev].filter(Boolean);
    for (var i = 0; i < list.length; i++) {
      try {
        await openData(list[i]);
        if (list[i] === cur) drop(KEY_PREV);
        return true;
      } catch (e) { if (!e || e.name !== 'OperationError') throw e; }
    }
    return list.length ? false : null;
  }

  // ── Экран входа ──
  var root, err, btn;
  function setState(s) { if (root) root.setAttribute('data-state', s); }
  function unlocked() {
    setState('open');
    document.documentElement.classList.remove('locked');
    setTimeout(function () { if (root) { root.remove(); root = null; } }, 250);
  }
  function showForm(message) {
    setState('login');
    err.textContent = message || '';
    var l = document.getElementById('auth-login');
    (l.value ? document.getElementById('auth-pass') : l).focus();
  }
  function netError(e) { return 'Не удалось загрузить данные: ' + (e && e.message || e) + '. Проверьте интернет и попробуйте снова.'; }

  async function onSubmit(e) {
    e.preventDefault();
    var login = normLogin(document.getElementById('auth-login').value);
    var pass = document.getElementById('auth-pass').value;
    if (!login || !pass) { err.textContent = 'Введите логин и пароль'; return; }
    setState('busy'); err.textContent = ''; btn.disabled = true; btn.textContent = 'Проверяю…';
    try {
      var v = await vault(), k = b64(await unwrapKey(v, login, pass)), okRaw = await unwrapOwnerKey(v, login, pass), ok = okRaw ? b64(okRaw) : '';
      await openData(k, login, ok);
      var remember = document.getElementById('auth-remember').checked;
      drop(KEY); drop(KEY_PREV); drop(LOGIN); drop(OKEY);
      put(KEY, k, remember); put(LOGIN, login, remember); if (ok) put(OKEY, ok, remember);
      document.getElementById('auth-pass').value = '';
      unlocked();
    } catch (ex) {
      showForm(ex.message === BAD ? BAD : netError(ex));
      if (ex.message === BAD) { var p = document.getElementById('auth-pass'); p.value = ''; p.focus(); }
    }
    btn.disabled = false; btn.textContent = 'Войти';
  }

  async function start() {
    root = document.getElementById('auth');
    if (!root) return;
    err = document.getElementById('auth-error'); btn = document.getElementById('auth-submit');
    document.getElementById('auth-form').addEventListener('submit', onSubmit);
    if (!subtle) { showForm('Браузер не поддерживает шифрование. Откройте сайт по https:// в Chrome, Safari, Edge или Firefox.'); btn.disabled = true; return; }
    try {
      var ok = await openWithStored();
      if (ok) return unlocked();
      if (ok === false) { drop(KEY); drop(KEY_PREV); return showForm('Данные на сайте обновились — войдите заново'); }
      showForm();
    } catch (e) { showForm(netError(e)); }
  }

  // Выход: стирает с устройства ключ, локальную копию данных, связь с Google Таблицей и Excel-файлом, черновики импорта.
  function logout() {
    if (!confirm('Выйти и удалить данные с этого устройства?\n\nПравки, которые не записаны в Excel-файл или Google Таблицу, пропадут. Чтобы сохранить их, сначала нажмите «Скачать Excel». Неподтверждённые черновики импорта манифестов тоже удалятся.')) return;
    both().forEach(function (st) {
      try { for (var i = st.length - 1; i >= 0; i--) { var k = st.key(i); if (k && k.indexOf('logi-') === 0) st.removeItem(k); } } catch (e) { /* нет доступа */ }
    });
    try { indexedDB.deleteDatabase('logi-db'); indexedDB.deleteDatabase('logi-import'); } catch (e) { /* нет IndexedDB */ }
    location.reload();
  }

  // ── Диалоги «Аккаунт» и «Смена пароля» ──
  var CORNERS = '<i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>';
  var openDialog = null;
  function closeDialog() { if (openDialog) { openDialog.remove(); openDialog = null; document.removeEventListener('keydown', onKey); } }
  function onKey(e) { if (e.key === 'Escape' && openDialog && !openDialog.hasAttribute('data-busy')) closeDialog(); }
  function dialog(title, bodyHtml, actionsHtml) {
    closeDialog();
    var bg = document.createElement('div');
    bg.className = 'dialog-backdrop acc-backdrop';
    bg.innerHTML = '<div class="dialog blueprint acc-dialog" role="dialog" aria-modal="true" aria-label="' + esc(title) + '">' + CORNERS +
      '<div class="dialog-title">' + esc(title) + '</div>' + bodyHtml + '<div class="dialog-actions">' + actionsHtml + '</div></div>';
    bg.addEventListener('click', function (e) { if (e.target === bg && !bg.hasAttribute('data-busy')) closeDialog(); });
    document.body.appendChild(bg);
    document.addEventListener('keydown', onKey);
    openDialog = bg;
    return bg;
  }

  function openAccount() {
    var login = get(LOGIN);
    var d = dialog('Аккаунт',
      '<div class="dialog-body">' + (login ? 'Вы вошли как <b>' + esc(login) + '</b>.' : 'Вход выполнен.') +
        (role === 'viewer' ? '<br>Доступ: <b>только просмотр</b> — всё видно, изменить ничего нельзя. Пароль этого входа меняет руководитель.' : '') + '</div>' +
      // тема (js/theme.js) — здесь тоже: на телефоне кнопки темы в шапке нет, там места только для вкладок
      '<div class="acc-theme"><span>Тема сайта</span><button type="button" class="btn btn-secondary" data-theme-toggle>Светлая / тёмная тема</button></div>',
      '<button class="btn btn-ghost" data-act="logout" style="margin-right:auto">Выйти</button>' +
      '<button class="btn btn-secondary" data-act="close">Закрыть</button>' +
      (role === 'viewer' ? '' : '<button class="btn btn-primary" data-act="passwd">Сменить пароль</button>'));
    d.addEventListener('click', function (e) {
      var a = e.target.closest('[data-act]'); if (!a) return;
      if (a.dataset.act === 'close') closeDialog();
      else if (a.dataset.act === 'logout') { closeDialog(); logout(); }
      else openPasswd();
    });
  }

  function field(id, label, type, value, extra) {
    return '<div class="field"><label for="' + id + '">' + label + '</label><input class="input" id="' + id + '" type="' + type + '" value="' + esc(value || '') + '" ' + (extra || '') + '></div>';
  }
  function openPasswd() {
    var token = get(GH_TOKEN) || '';
    var d = dialog('Смена пароля',
      '<form class="acc-form" id="pw-form" novalidate>' +
        field('pw-login', 'Логин', 'text', get(LOGIN) || '', 'autocomplete="username" autocapitalize="none" spellcheck="false"') +
        field('pw-old', 'Текущий пароль', 'password', '', 'autocomplete="current-password"') +
        field('pw-new', 'Новый пароль', 'password', '', 'autocomplete="new-password"') +
        field('pw-new2', 'Новый пароль ещё раз', 'password', '', 'autocomplete="new-password"') +
        field('pw-token', 'GitHub-токен', 'password', token, 'autocomplete="off" spellcheck="false" placeholder="github_pat_…"') +
        '<div class="acc-hint">Новый пароль сохраняется в репозиторий <b>' + esc(REPO.owner + '/' + REPO.repo) + '</b>, поэтому нужен токен GitHub. ' +
        'Создайте его на <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">github.com → Fine-grained token</a>: ' +
        'Repository access — только <b>' + esc(REPO.repo) + '</b>, Permissions → Contents — <b>Read and write</b>.</div>' +
        '<label class="auth-remember"><input type="checkbox" id="pw-remember"' + (token ? ' checked' : '') + '> Запомнить токен на этом устройстве</label>' +
        '<div class="auth-error" id="pw-error" role="alert"></div>' +
        '<div class="acc-ok" id="pw-ok" role="status"></div>' +
      '</form>',
      '<button class="btn btn-secondary" type="button" data-act="close">Отмена</button>' +
      '<button class="btn btn-primary" type="submit" form="pw-form" id="pw-submit">Сменить пароль</button>');
    d.querySelector('[data-act="close"]').addEventListener('click', function () { if (!d.hasAttribute('data-busy')) closeDialog(); });
    d.querySelector('#pw-form').addEventListener('submit', function (e) { e.preventDefault(); changePassword(d); });
    d.querySelector(get(LOGIN) ? '#pw-old' : '#pw-login').focus();
  }

  // ── GitHub API ──
  async function gh(token, path, opts) {
    opts = opts || {};
    var r;
    try {
      r = await fetch('https://api.github.com' + path, {
        method: opts.method || 'GET',
        headers: Object.assign({ Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token }, opts.body ? { 'Content-Type': 'application/json' } : {}, opts.headers || {}),
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        cache: 'no-store'
      });
    } catch (e) { throw new Error('Нет связи с GitHub. Проверьте интернет.'); }
    if (r.ok) return opts.raw ? r.text() : r.json();
    var msg = ''; try { msg = (await r.json()).message || ''; } catch (e) { /* не JSON */ }
    if (r.status === 401) throw new Error('GitHub-токен не подходит: неверный или просрочен.');
    if (r.status === 403 || r.status === 404) throw new Error('У токена нет доступа к репозиторию ' + REPO.repo + ' с правом Contents: Read and write.');
    if (r.status === 409) throw new Error('Файл на GitHub только что изменился. Нажмите «Сменить пароль» ещё раз.');
    throw new Error('GitHub ответил ошибкой ' + r.status + (msg ? ': ' + msg : ''));
  }
  async function loadRemoteVault(token) {
    var base = '/repos/' + REPO.owner + '/' + REPO.repo;
    var branch = (await gh(token, base)).default_branch;
    var file = await gh(token, base + '/contents/' + REPO.path + '?ref=' + encodeURIComponent(branch));
    var text = file.content && file.encoding === 'base64'
      ? atob(file.content.replace(/\s/g, ''))
      : await gh(token, base + '/contents/' + REPO.path + '?ref=' + encodeURIComponent(branch), { raw: true, headers: { Accept: 'application/vnd.github.raw+json' } });
    return { base: base, branch: branch, sha: file.sha, vault: JSON.parse(text) };
  }

  async function changePassword(d) {
    var $ = function (id) { return d.querySelector('#' + id); };
    var errEl = $('pw-error'), okEl = $('pw-ok'), submit = d.querySelector('#pw-submit');
    var login = normLogin($('pw-login').value), oldPw = $('pw-old').value, newPw = $('pw-new').value, newPw2 = $('pw-new2').value, token = $('pw-token').value.trim();
    errEl.textContent = ''; okEl.textContent = '';
    if (!login || !oldPw || !newPw || !token) { errEl.textContent = 'Заполните все поля'; return; }
    if (newPw.length < MIN_PASSWORD) { errEl.textContent = 'Новый пароль — не короче ' + MIN_PASSWORD + ' символов'; return; }
    if (newPw !== newPw2) { errEl.textContent = 'Новые пароли не совпадают'; $('pw-new2').focus(); return; }

    d.setAttribute('data-busy', ''); submit.disabled = true;
    try {
      submit.textContent = 'Загружаю…';
      var remote = await loadRemoteVault(token), v = remote.vault;
      submit.textContent = 'Проверяю пароль…';
      var oldKey;
      try { oldKey = await unwrapKey(v, login, oldPw); }
      catch (e) { throw new Error(e.message === BAD ? 'Неверный логин или текущий пароль' : e.message); }
      submit.textContent = 'Шифрую…';
      // Единственный пользователь — меняем и ключ данных: старый пароль из истории репозитория
      // перестаёт открывать текущие данные. Если пользователей несколько, их ключи не трогаем.
      var single = Object.keys(v.users).length === 1, newKey = oldKey, okRaw = await unwrapOwnerKey(v, login, oldPw);
      if (single) {
        newKey = rand(32);
        await encryptData(v, newKey, await decryptData(v, oldKey));
        if (v.config) v.config = await encryptJSON(newKey, await decryptJSON(oldKey, v.config));
        v.users = {};
      }
      await wrapKey(v, login, newPw, newKey, okRaw);
      submit.textContent = 'Сохраняю…';
      await gh(token, remote.base + '/contents/' + REPO.path, { method: 'PUT', body: {
        message: 'Смена пароля на сайте', content: btoa(JSON.stringify(v) + '\n'), sha: remote.sha, branch: remote.branch } });

      var remember = remembered();
      if ($('pw-remember').checked) put(GH_TOKEN, token, true); else drop(GH_TOKEN);
      if (single) { var cur = get(KEY); drop(KEY); drop(KEY_PREV); put(KEY, b64(newKey), remember); if (cur) put(KEY_PREV, cur, remember); openKey = b64(newKey); }
      drop(LOGIN); put(LOGIN, login, remember);
      ['pw-old', 'pw-new', 'pw-new2'].forEach(function (id) { $(id).value = ''; });
      okEl.textContent = 'Пароль изменён. Новый пароль заработает через 1–2 минуты, когда GitHub обновит сайт.' +
        (single ? ' На других устройствах нужно будет войти заново.' : '') + ' На этом устройстве вход сохранён.';
      submit.style.display = 'none';
      d.querySelector('[data-act="close"]').textContent = 'Готово';
    } catch (ex) {
      errEl.textContent = ex.message || String(ex);
      submit.textContent = 'Сменить пароль';
    }
    d.removeAttribute('data-busy'); submit.disabled = false;
    if (submit.style.display !== 'none') submit.textContent = 'Сменить пароль';
  }

  // Общие настройки сайта (например, ссылка на Google Таблицу) — в vault.json для всех устройств.
  async function saveConfig(patch, token) {
    token = String(token || get(GH_TOKEN) || '').trim();
    if (!token) throw new Error('Нужен GitHub-токен');
    if (!openKey) throw new Error('Сначала войдите на сайт');
    var remote = await loadRemoteVault(token), v = remote.vault, dek = unb64(openKey);
    try { await decryptData(v, dek); }
    catch (e) { throw new Error('Пароль сайта недавно меняли на другом устройстве — выйдите и войдите заново'); }
    var cfg = {};
    if (v.config) { try { cfg = await decryptJSON(dek, v.config); } catch (e) { cfg = {}; } }
    Object.keys(patch).forEach(function (k) { if (patch[k] === '' || patch[k] == null) delete cfg[k]; else cfg[k] = patch[k]; });
    v.config = await encryptJSON(dek, cfg);
    await gh(token, remote.base + '/contents/' + REPO.path, { method: 'PUT', body: {
      message: 'Общие настройки сайта', content: btoa(JSON.stringify(v) + '\n'), sha: remote.sha, branch: remote.branch } });
    window.LOGI_CONFIG = cfg;
    return cfg;
  }

  // Настройки руководителя (vault.owner) — секрет редактора для ИИ-импорта. Видны только руководителю.
  // Первый раз (или на устройстве, где ключа руководителя ещё нет) нужен пароль входа.
  async function saveOwnerConfig(patch, token, password) {
    token = String(token || get(GH_TOKEN) || '').trim();
    if (role === 'viewer') throw new Error('Только для руководителя');
    if (!token) throw new Error('Нужен GitHub-токен');
    var login = get(LOGIN); if (!login) throw new Error('Выйдите и войдите заново — сайт не знает ваш логин');
    var remote = await loadRemoteVault(token), v = remote.vault, u = v.users[await loginId(v, login)];
    if (!u) throw new Error('Вашего входа нет в хранилище — войдите заново');
    var okRaw = get(OKEY) ? unb64(get(OKEY)) : null;
    if (password) { await unwrapKey(v, login, password); okRaw = (await unwrapOwnerKey(v, login, password)) || okRaw; }   // неверный пароль — ошибка
    if (!okRaw && v.owner) throw new Error('Введите пароль входа: на этом устройстве нет ключа руководителя');
    if (!okRaw) { if (!password) throw new Error('Введите пароль входа — он нужен, чтобы создать ключ руководителя'); okRaw = rand(32); }
    if (password) u.okey = await wrapOwner(await kek(v, password, unb64(u.salt), 'encrypt'), okRaw);
    else if (!u.okey) throw new Error('Введите пароль входа');
    var cfg = {};
    if (v.owner) { try { cfg = await decryptJSON(okRaw, v.owner); } catch (e) { throw new Error('Ключ руководителя на этом устройстве устарел — введите пароль входа'); } }
    Object.keys(patch).forEach(function (k) { if (patch[k] === '' || patch[k] == null) delete cfg[k]; else cfg[k] = patch[k]; });
    v.owner = await encryptJSON(okRaw, cfg);
    await gh(token, remote.base + '/contents/' + REPO.path, { method: 'PUT', body: {
      message: 'Настройки руководителя', content: btoa(JSON.stringify(v) + '\n'), sha: remote.sha, branch: remote.branch } });
    put(OKEY, b64(okRaw), remembered()); ownerCfg = cfg; ownerState = 'open';
    return cfg;
  }
  // открыть настройки руководителя на этом устройстве паролем (если вход был до их появления)
  async function unlockOwner(password) {
    var v = await vault(), login = get(LOGIN);
    if (!login) throw new Error('Выйдите и войдите заново');
    await unwrapKey(v, login, password);   // неверный пароль — ошибка
    var okRaw = await unwrapOwnerKey(v, login, password);
    if (!okRaw) throw new Error('У этого входа нет ключа руководителя');
    put(OKEY, b64(okRaw), remembered());
    await openOwner(v, login, b64(okRaw));
    if (ownerState !== 'open') throw new Error('Не удалось открыть настройки руководителя');
    return ownerCfg;
  }

  window.LogiAuth = {
    logout: logout, openAccount: openAccount, saveConfig: saveConfig, saveOwnerConfig: saveOwnerConfig, unlockOwner: unlockOwner,
    owner: function () { return { state: ownerState, config: ownerCfg || {} }; },
    login: function () { return get(LOGIN) || ''; },
    config: function () { return window.LOGI_CONFIG || {}; },
    role: function () { return role; },
    hasGhToken: function () { return !!get(GH_TOKEN); }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
