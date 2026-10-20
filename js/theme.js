/* Тема сайта: светлая или тёмная (тёмная — стекло по buraq-brand/DESIGN-GLASS.md, css/glass-dark.css).
   Подключается в <head> без defer — тема ставится до первой отрисовки, страница не мигает белым.
   Выбор — кнопка [data-theme-toggle] (☾ / ☀ в шапке и на экране входа), хранится в localStorage (buraq-theme);
   пока не выбрана — как в системе. При смене — событие 'buraq-theme' на window (3D пересобирается).
   window.BuraqTheme: get() — 'light' | 'dark', set(t). */
(function () {
  var KEY = 'buraq-theme', root = document.documentElement;
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function saved() {
    try { var t = localStorage.getItem(KEY); return t === 'dark' || t === 'light' ? t : ''; } catch (e) { return ''; }
  }
  function apply(t) {
    if (root.getAttribute('data-theme') === t) return;
    root.setAttribute('data-theme', t);
    try { window.dispatchEvent(new CustomEvent('buraq-theme', { detail: t })); } catch (e) { /* старый браузер */ }
  }
  function set(t) {
    if (t !== 'dark' && t !== 'light') return;
    try { localStorage.setItem(KEY, t); } catch (e) { /* закрытый режим */ }
    apply(t);
  }
  apply(saved() || (mq && mq.matches ? 'dark' : 'light'));
  if (mq) {
    var follow = function () { if (!saved()) apply(mq.matches ? 'dark' : 'light'); };
    if (mq.addEventListener) mq.addEventListener('change', follow); else if (mq.addListener) mq.addListener(follow);
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-theme-toggle]');
    if (!b) return;
    e.preventDefault();
    set(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  });
  window.BuraqTheme = { get: function () { return root.getAttribute('data-theme') || 'light'; }, set: set };
})();
