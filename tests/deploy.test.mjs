// Выкладка (GitHub Pages) и service worker: всё, что sw.js кладёт в кэш при установке, есть в репозитории и копируется
// на сайт. Иначе новая сборка не ставится, и у всех, кто уже открывал сайт, остаётся старая версия.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../', import.meta.url), read = f => fs.readFileSync(new URL(f, root), 'utf8');
const shell = (() => { const m = read('sw.js').match(/const SHELL = \[([\s\S]*?)\];/); return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]); })();
const copied = (() => {
  const wf = read('.github/workflows/pages.yml'), cp = wf.match(/cp -r ([^\n]+) _site\//)[1].split(/\s+/);
  return { top: new Set(cp), brand: /cp buraq-brand\/logo\/\*\.svg _site\/buraq-brand\/logo\//.test(wf) };
})();

test('каждый файл кэша service worker есть в репозитории', () => {
  const missing = shell.filter(f => !fs.existsSync(new URL(f, root)));
  assert.deepEqual(missing, []);
});

test('каждый файл кэша service worker копируется на сайт при выкладке', () => {
  const lost = shell.filter(f => {
    const top = f.split('/')[0];
    if (top === 'buraq-brand') return !(copied.brand && /^buraq-brand\/logo\/[^/]+\.svg$/.test(f));
    return !copied.top.has(top);
  });
  assert.deepEqual(lost, [], 'не попадут на сайт: ' + lost.join(', '));
});

test('недостающая картинка не мешает поставить новую сборку, страница и скрипты — обязательны', () => {
  const sw = read('sw.js');
  assert.match(sw, /const REQUIRED = u => \/\\\.\(html\|js\|css\|json\|webmanifest\)\$\/\.test\(u\)/);
  assert.match(sw, /cache\.add\(new Request\(u, \{ cache: 'reload' \}\)\)\.catch\(e => \{ if \(REQUIRED\(u\)\) throw e; \}\)/);
  assert.ok(!/cache\.addAll\(/.test(sw), 'addAll падает целиком из-за одного файла');
});
