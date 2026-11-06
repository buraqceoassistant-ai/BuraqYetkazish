/* Планы партии — в фоне: buildPlans (js/logi-engine.js) для большой партии (100+ точек) считается секунды, в отдельном
   потоке страница не замирает (вкладки «Планы», «Карта», «Визуализация», отчёты и предварительные планы импорта). Ответ — планы без функций (для превью нужны итоги и машины);
   ссылки по кругу (рейсы ↔ машины) переносит само клонирование браузера (structured clone).
   Запускает index.html (importView → impPlansRun); без Worker или при ошибке план считается на странице, как раньше. */
self.window = self;
importScripts('logi-engine.js');
// копия без функций (их структурное клонирование не переносит); общие и круговые ссылки — те же
function plain(v, seen = new Map()) {
  if (typeof v === 'function') return undefined;
  if (!v || typeof v !== 'object') return v;
  if (seen.has(v)) return seen.get(v);
  const out = Array.isArray(v) ? [] : {};
  seen.set(v, out);
  for (const k of Object.keys(v)) { const x = plain(v[k], seen); if (x !== undefined || Array.isArray(v)) out[k] = x; }
  return out;
}
self.onmessage = e => {
  const { id, stops, S } = e.data || {};
  try {
    const r = self.LogiEngine.buildPlans(stops, S);
    self.postMessage({ id, ok: true, res: plain({ A: r.A, B: r.B, C: r.C, X: r.X, cars: r.cars, per: r.per, noCoords: r.noCoords }) });
  } catch (err) { self.postMessage({ id, ok: false, error: String((err && err.message) || err) }); }
};
