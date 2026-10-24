/* Обвязка сайта вокруг приложения: service worker (офлайн и установка на телефон),
   кнопка «Установить приложение», подсказка «Добавить в Dock» для Safari на Mac, плашка «браузер устарел»,
   высота липкой шапки (--sticky-top) и прокрутка вкладок к активной на узком экране.
   Само приложение (разметка и логика) — в index.html. */
(function () {
  'use strict';

  // ── Service worker ──
  // На localhost не регистрируется, чтобы правки были видны сразу; ?sw=1 включает его для проверки.
  var local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) && !/[?&]sw=1\b/.test(location.search);
  // Новая версия сайта: приложение на телефоне открыто неделями и не перезагружается — само оно новую сборку не
  // увидит (браузер проверяет её только при открытии страницы). Проверяем раз в 30 минут и при возврате в приложение;
  // когда новая сборка установилась, внизу — «Вышла новая версия сайта · Обновить» (перезагрузка — по кнопке:
  // правки журнала хранятся на устройстве, но открытое окно с несохранённым вводом закрылось бы).
  if ('serviceWorker' in navigator && location.protocol !== 'file:' && !local) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').then(function (reg) {
        var check = function () { reg.update().catch(function () { /* нет сети — в следующий раз */ }); };
        setInterval(check, 30 * 60 * 1000);
        document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') check(); });
      }).catch(function (e) { console.warn('[sw] регистрация не удалась:', e); });
    });
    var hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!hadController) { hadController = true; return; }   // первая установка — это не новая версия
      showUpdate();
    });
  }
  function showUpdate() {
    if (document.getElementById('new-version')) return;
    var box = document.createElement('div');
    box.id = 'new-version';
    box.className = 'install-app new-version';
    box.innerHTML = '<span class="new-version-text">Вышла новая версия сайта</span>' +
      '<button type="button" class="btn btn-primary" data-act="reload">Обновить</button>' +
      '<button type="button" class="btn btn-ghost" data-act="close" aria-label="Скрыть">✕</button>';
    box.addEventListener('click', function (e) {
      var act = e.target.closest('[data-act]');
      if (!act) return;
      if (act.dataset.act === 'reload') location.reload();
      else box.remove();
    });
    document.body.appendChild(box);
  }
  window.LogiShowUpdate = showUpdate;   // для проверки

  // ── Кнопка установки (Android / Chrome / Edge; на iPhone — «Поделиться → На экран „Домой“») ──
  var DISMISS_KEY = 'logi-install-dismissed';
  var deferred = null;
  function dismissed() { try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch (e) { return false; } }
  function removeInstall() { var el = document.getElementById('install-app'); if (el) el.remove(); }
  function showInstall() {
    if (!deferred || dismissed() || document.getElementById('install-app')) return;
    var box = document.createElement('div');
    box.id = 'install-app';
    box.className = 'install-app';
    box.innerHTML = '<button type="button" class="btn btn-primary" data-act="install">Установить приложение</button>' +
      '<button type="button" class="btn btn-ghost" data-act="close" aria-label="Скрыть">✕</button>';
    box.addEventListener('click', function (e) {
      var act = e.target.closest('[data-act]');
      if (!act) return;
      if (act.dataset.act === 'install' && deferred) {
        deferred.prompt();
        deferred.userChoice.finally(function () { deferred = null; removeInstall(); });
      } else {
        try { localStorage.setItem(DISMISS_KEY, '1'); } catch (err) { /* private mode */ }
        removeInstall();
      }
    });
    document.body.appendChild(box);
  }
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferred = e;
    showInstall();
  });
  window.addEventListener('appinstalled', function () { deferred = null; removeInstall(); });

  // ── Приложение на компьютере и телефоне: как поставить в этом браузере (окно «Аккаунт», js/auth.js) ──
  var ua = navigator.userAgent || '';
  var touchMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;   // iPad пишет «Macintosh», но с касаниями
  var isMac = /Macintosh/.test(ua) && !touchMac, isIOS = /iPhone|iPad|iPod/.test(ua) || touchMac, isAndroid = /Android/.test(ua);
  var isSafari = /Safari\//.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS|YaBrowser/.test(ua), isFirefox = /Firefox|FxiOS/.test(ua);
  function standalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  }
  window.LogiInstall = {
    how: function () {
      if (standalone()) return { kind: 'installed', text: 'BURAQ открыт как приложение.' };
      if (deferred) return { kind: 'prompt', text: 'Значок BURAQ появится в Dock (на Mac), в меню «Пуск» или на экране телефона; сайт откроется отдельным окном, как программа.' };
      if (isIOS) return { kind: 'ios', text: 'Safari: «Поделиться» → «На экран „Домой“».' };
      if (isMac && isSafari) return { kind: 'mac-safari', text: 'Safari: меню «Файл» → «Добавить в Dock». Значок BURAQ появится в Dock и Launchpad, сайт откроется отдельным окном (macOS 14 Sonoma и новее; на старой macOS — через Chrome).' };
      if (isFirefox) return { kind: 'firefox', text: 'Firefox не ставит сайты как приложение — откройте сайт в Safari или Chrome.' };
      if (isAndroid) return { kind: 'android', text: 'Chrome: ⋮ → «Установить приложение».' };
      return { kind: 'desktop', text: 'Chrome / Edge: значок «Установить» в конце адресной строки или меню ⋮ → «Установить BURAQ…». Значок появится в Dock (на Mac) или в меню «Пуск».' };
    },
    prompt: function () {
      if (!deferred) return false;
      deferred.prompt();
      deferred.userChoice.finally(function () { deferred = null; removeInstall(); });
      return true;
    }
  };
  // Safari на Mac не показывает кнопку установки сам — один раз подсказка внизу (✕ — больше не показывать)
  var MAC_KEY = 'logi-mac-dock-hint';
  function macHint() {
    if (!(isMac && isSafari) || standalone() || document.getElementById('auth') || document.getElementById('mac-dock')) return;
    try { if (localStorage.getItem(MAC_KEY) === '1') return; } catch (e) { return; }
    var box = document.createElement('div');
    box.id = 'mac-dock';
    box.className = 'install-app mac-dock';
    box.innerHTML = '<span class="mac-dock-text">BURAQ — приложением на Mac: меню «Файл» → «Добавить в Dock»</span>' +
      '<button type="button" class="btn btn-ghost" data-act="close" aria-label="Скрыть">✕</button>';
    box.addEventListener('click', function (e) {
      if (!e.target.closest('[data-act="close"]')) return;
      try { localStorage.setItem(MAC_KEY, '1'); } catch (err) { /* закрытый режим */ }
      box.remove();
    });
    document.body.appendChild(box);
  }
  // после входа (экран входа #auth к этому времени закрыт)
  window.addEventListener('load', function () { setTimeout(macHint, 6000); setTimeout(macHint, 30000); });

  // ── Браузер устарел (Safari до 16.4 на старой macOS): цвета сайта и чтение Excel не работают — сказать, что делать ──
  function oldBrowser() {
    var css = window.CSS && CSS.supports && CSS.supports('color', 'color-mix(in srgb, red, blue)');
    return !css || typeof DecompressionStream === 'undefined';
  }
  function oldHint() {
    if (!oldBrowser() || document.getElementById('old-browser')) return;
    try { if (sessionStorage.getItem('logi-old-browser') === '1') return; } catch (e) { /* закрытый режим */ }
    var box = document.createElement('div');
    box.id = 'old-browser';
    box.className = 'install-app old-browser';
    box.setAttribute('role', 'alert');
    box.innerHTML = '<span class="old-browser-text">Браузер устарел — часть сайта может не работать. Обновите Safari (macOS: «Системные настройки» → «Обновление ПО») или откройте сайт в Chrome.</span>' +
      '<button type="button" class="btn btn-ghost" data-act="close" aria-label="Скрыть">✕</button>';
    box.addEventListener('click', function (e) {
      if (!e.target.closest('[data-act="close"]')) return;
      try { sessionStorage.setItem('logi-old-browser', '1'); } catch (err) { /* закрытый режим */ }
      box.remove();
    });
    document.body.appendChild(box);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', oldHint); else oldHint();

  // ── Высота липкой шапки сайта: шапки таблиц на ноутбуке липнут под ней (css/mobile.css, --sticky-top) ──
  var hdrObs = window.ResizeObserver ? new ResizeObserver(function () { syncStickyTop(); }) : null, hdrEl = null;
  function syncStickyTop() {
    var h = document.querySelector('.app-header');
    if (!h) return false;
    if (hdrObs && h !== hdrEl) { if (hdrEl) hdrObs.unobserve(hdrEl); hdrEl = h; hdrObs.observe(h); }   // шапка появляется после входа
    var v = Math.round(h.getBoundingClientRect().height) + 'px', root = document.documentElement;
    if (root.style.getPropertyValue('--sticky-top') !== v) root.style.setProperty('--sticky-top', v);
    return true;
  }
  // шапки нет, пока открыт экран входа: ждём её появления (дальше высоту следит ResizeObserver, без него — клики и resize)
  var waitHdr = setInterval(function () { if (syncStickyTop()) clearInterval(waitHdr); }, 500);
  document.addEventListener('click', function () { setTimeout(syncStickyTop, 0); }, true);
  window.addEventListener('resize', syncStickyTop);

  // ── Активная вкладка всегда видна в прокручиваемой строке вкладок ──
  function syncTabs() {
    var nav = document.querySelector('.app-tabs');
    if (!nav || nav.scrollWidth <= nav.clientWidth + 1) return;
    var active = null;
    for (var i = 0; i < nav.children.length; i++) {
      var b = nav.children[i];
      if (b.style.borderBottom && b.style.borderBottom.indexOf('transparent') < 0) { active = b; break; }
    }
    if (!active) return;
    var nr = nav.getBoundingClientRect(), br = active.getBoundingClientRect();
    if (br.left < nr.left + 12 || br.right > nr.right - 28) {
      nav.scrollBy({ left: br.left - nr.left - (nr.width - br.width) / 2, behavior: 'smooth' });
    }
  }
  // Вкладка меняется только после нажатия (вкладка, «Журнал»/«Планы» на дашборде, «Исправить» и т. п.).
  document.addEventListener('click', function () { setTimeout(syncTabs, 0); }, true);
  window.addEventListener('resize', syncTabs);
})();
