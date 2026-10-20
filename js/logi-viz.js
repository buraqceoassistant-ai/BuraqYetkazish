/* Визуализация загрузки рейсов в 3D — вкладка «Визуализация».
 *
 * Размеров мест в данных нет, поэтому груз каждой точки раскладывается кубиками по его объёму (CBM):
 * кузов делится на ячейки, груз заполняет их стенка за стенкой от кабины к дверям, в стенке — снизу вверх.
 * Порядок — как при разгрузке: последнюю точку грузят первой (к кабине), точка 1 оказывается у дверей.
 * Кузов: Labo — бортовой, размеры производителя, высота груза — из объёма во «Тарифах»;
 * Changan, Gazel и Kamaz — фургоны с типичными шириной и высотой, длина — из объёма во «Тарифах».
 * Если в карточке машины есть кузов (длина × ширина × высота, скрипт 31) — он и рисуется.
 * Груз больше кузова (допуск плана B) показан за дверями полупрозрачным.
 *
 * layout() — чистый расчёт, работает и без 3D. Сцену рисует three.js
 * (js/vendor/three/three-viz.min.js), он загружается при первом открытии вкладки.
 */
(function () {
  'use strict';
  // flat — бортовой кузов: длина и ширина заданы, высота груза = объём / площадь пола.
  // Иначе фургон: ширина и высота заданы, длина = объём / (ширина × высота).
  // Labo (UzAuto): кузов 1,94 × 1,33 м, борт 0,29 м; машина 3,495 × 1,4 × 1,8 м, колёсная база 1,84 м.
  const BODY = {
    labo: { flat: true, l: 1.94, w: 1.33, side: 0.29, cab: 1.45, cabW: 1.4, cabH: 1.47, wheel: 0.27, front: 0.55, base: 1.84, cabColor: '#f1f2f4' },
    changan: { w: 1.75, h: 1.7, cab: 1.5, cabH: 1.95, wheel: 0.32, cabColor: '#f1f2f4' },   // точные размеры — когда придут от владельца
    gazel: { w: 2.1, h: 1.9, cab: 1.75, cabH: 2.15, wheel: 0.36, cabColor: '#f1f2f4' },
    kamaz: { w: 2.45, h: 2.6, cab: 2.2, cabH: 3.0, wheel: 0.5, cabColor: '#d9772b' }
  };
  // первая точка — фирменный синий BURAQ; красный бренда не используется: им помечено «сверх кузова»
  const PALETTE = ['#034CAA', '#f28e2b', '#59a14f', '#b07aa1', '#edc948', '#17becf', '#ff9da7', '#9c755f', '#76b7b2', '#bcbd22', '#6b6ecf', '#e377c2', '#0E2E54', '#98df8a', '#8c6d31'];
  const colorOf = n => PALETTE[(Math.max(1, n) - 1) % PALETTE.length];
  const light = hex => { const v = parseInt(hex.slice(1), 16), r = v >> 16, g = (v >> 8) & 255, b = v & 255; return 0.299 * r + 0.587 * g + 0.114 * b > 160; };

  // dims — кузов из карточки машины (скрипт 31, Sozlamalar K:M): длина, ширина, высота (у бортового — высота груза);
  // объём тогда — их произведение
  function bodyOf(kind, m3, dims) {
    const b = BODY[kind] || BODY.gazel;
    if (dims && dims.l > 0 && dims.w > 0 && dims.h > 0) return { ...b, l: +dims.l, w: +dims.w, h: +dims.h, v: dims.l * dims.w * dims.h, own: true };
    const v = Math.max(+m3 || 0, 0.5);
    return b.flat ? { ...b, v, h: v / (b.l * b.w) } : { ...b, v, l: v / (b.w * b.h) };
  }

  // точки рейса в порядке разгрузки; один BL — одна точка (части одной отгрузки и повторы складываются)
  function pointsOf(trip) {
    const pts = [], by = {};
    trip.stops.forEach(s => {
      let p = by[s.bl];
      if (!p) { p = by[s.bl] = { n: pts.length + 1, bl: s.bl, client: s.client || {}, cbm: 0, kg: 0, places: 0, parts: [], boxes: [] }; pts.push(p); }
      p.cbm += s.cbm || 0; p.kg += s.kg || 0; p.places += s.places || 0;
      if (s.parts) p.parts.push(s.part + '/' + s.parts);
      if (s.boxList && s.boxList.length) p.boxes = p.boxes.concat(s.boxList);   // коробки по пакинг-листу (см)
    });
    return pts;
  }

  // ---------- укладка коробок по пакинг-листу ----------
  // groups: [{ p, l, w, h, n, approx }] (м) в порядке укладки — первая группа глубже всех (к кабине). Коробки одного
  // размера ставятся столбиками в «стенку» поперёк кузова, стенка за стенкой к дверям; коробку можно повернуть любой
  // стороной (стоя — предпочтительнее); на столбик ставится коробка не шире его. body: { l, w, h } — кузов внутри, м.
  // Возвращает коробки с координатами (x от кабины, y от пола, z от левого борта), занятую длину, число не поместившихся
  // (over — за дверями, big — не проходят в сечение кузова).
  function packBoxes(groups, body) {
    const L = body.l, W = body.w, H = body.h, EPS = 1e-6, boxes = [], slices = [];
    let big = 0;
    const orient = g => {   // [поперёк a, ввысь b, вдоль c]: группе — меньше длины кузова; при равенстве — плотнее, потом стоя
      let best = null;
      [[g.w, g.h, g.l], [g.l, g.h, g.w], [g.w, g.l, g.h], [g.h, g.l, g.w], [g.l, g.w, g.h], [g.h, g.w, g.l]].forEach(([a, b, c], i) => {
        if (a > W + EPS || b > H + EPS) return;
        const per = Math.floor(W / a + EPS) * Math.floor(H / b + EPS), len = Math.ceil(g.n / per - EPS) * c, dens = per / c, up = i < 2 ? 1 : 0;
        if (!best || len < best.len - EPS || (Math.abs(len - best.len) <= EPS && (dens > best.dens + EPS || (Math.abs(dens - best.dens) <= EPS && up > best.up)))) best = { a, b, c, len, dens, up };
      });
      return best;
    };
    const last = () => slices[slices.length - 1];
    const newSlice = () => { const sl = { x0: slices.length ? last().x0 + last().d : 0, d: 0, cols: [], free: W }; slices.push(sl); return sl; };
    const placeOne = (g, o) => {
      const a = o.a, b = o.b, c = o.c;
      let sl = last(), col = sl ? sl.cols.find(k => k.a + EPS >= a && k.top + b <= H + EPS) || null : null;   // столбик последней стенки
      if (!col && sl && sl.free + EPS >= a) { col = { z0: W - sl.free, a, top: 0, ix: slices.length - 1, iz: sl.cols.length }; sl.cols.push(col); sl.free -= a; }
      if (!col) { sl = newSlice(); col = { z0: 0, a, top: 0, ix: slices.length - 1, iz: 0 }; sl.cols.push(col); sl.free -= a; }
      boxes.push({ p: g.p, approx: !!g.approx, ix: col.ix, iy: Math.round(col.top / b), iz: col.iz, x: sl.x0, y: col.top, z: col.z0, dx: c, dy: b, dz: a });
      col.top += b; sl.d = Math.max(sl.d, c);
    };
    groups.forEach(g => { const o = orient(g); if (!o) { big += g.n; return; } for (let i = 0; i < g.n; i++) placeOne(g, o); });
    let usedLen = 0, over = 0;
    boxes.forEach(q => { q.over = q.x + q.dx > L + EPS; usedLen = Math.max(usedLen, q.x + q.dx); if (q.over) over++; });
    return { boxes, usedLen, slices: slices.length, overN: over, bigN: big };
  }

  function layout(trip) {
    const veh = trip.vehicle || {}, kind = trip.kind || veh.kind || 'gazel';
    const B = bodyOf(kind, veh.nomM3 != null ? veh.nomM3 : veh.m3, veh.dims);
    const points = pointsOf(trip), byBoxes = points.some(p => p.boxes.length);
    const cbm = points.reduce((a, p) => a + p.cbm, 0), kg = points.reduce((a, p) => a + p.kg, 0);
    let n = null, cell = null, cellV = 0, cap = 0, k = 0, cells = [], boxes = [], pack = null, overM3 = Math.max(0, cbm - B.v);
    if (byBoxes) {
      // коробки точек в порядке разгрузки наоборот (последняя точка — к кабине); точка без списка — условный блок на весь
      // поперечник длиной по её объёму с воздухом (полезный процент машины)
      const fill = veh.fill > 0 && veh.fill <= 1 ? veh.fill : 0.88, groups = [];
      points.slice().reverse().forEach(p => {
        if (p.boxes.length) p.boxes.slice().sort((a, b) => b.l * b.w * b.h - a.l * a.w * a.h).forEach(g => groups.push({ p: p.n, l: g.l / 100, w: g.w / 100, h: g.h / 100, n: g.n }));
        else if (p.cbm > 0) groups.push({ p: p.n, l: Math.max(0.05, p.cbm / fill / (B.w * B.h)), w: B.w, h: B.h, n: 1, approx: true });
      });
      pack = packBoxes(groups, B);
      boxes = pack.boxes.map(q => ({ p: q.p, approx: q.approx, over: q.over, ix: q.ix, iy: q.iy, iz: q.iz, cx: q.x + q.dx / 2, cy: q.y + q.dy / 2, cz: -B.w / 2 + q.z + q.dz / 2, sx: q.dx, sy: q.dy, sz: q.dz }));
      overM3 = boxes.filter(q => q.over).reduce((a, q) => a + q.sx * q.sy * q.sz * (q.approx ? fill : 1), 0);
      points.forEach(p => {
        const own = boxes.filter(q => q.p === p.n);
        p.x = own.length ? own.reduce((a, q) => a + q.cx, 0) / own.length : 0;
        p.top = own.length ? Math.max(...own.map(q => q.cy + q.sy / 2)) : 0;
        p.over = own.some(q => q.over); p.boxN = own.filter(q => !q.approx).length;
      });
      pack = { usedLen: pack.usedLen, slices: pack.slices, overN: pack.overN, bigN: pack.bigN, n: boxes.filter(q => !q.approx).length, approxN: points.filter(p => !p.boxes.length && p.cbm > 0).length };
    } else {
      // размеров коробок нет: кузов делится на ячейки, груз точки — кубики по её объёму
      const c = Math.cbrt(B.v / (kind === 'labo' ? 250 : kind === 'changan' ? 450 : 700));   // ~700 ячеек в кузове: видно груз и быстро рисуется
      n = { x: Math.max(1, Math.round(B.l / c)), y: Math.max(1, Math.round(B.h / c)), z: Math.max(1, Math.round(B.w / c)) };
      cell = { x: B.l / n.x, y: B.h / n.y, z: B.w / n.z }; cellV = cell.x * cell.y * cell.z;
      const wall = n.y * n.z; cap = n.x * wall;
      let cum = 0;
      points.slice().reverse().forEach(p => {
        cum += p.cbm;
        const end = Math.max(k + 1, Math.round(cum / cellV));
        p.from = k; p.cells = end - k;
        for (; k < end; k++) cells.push({ p: p.n, ix: Math.floor(k / wall), iy: Math.floor((k % wall) / n.z), iz: k % n.z });
      });
      points.forEach(p => {
        const own = cells.slice(p.from, p.from + p.cells);
        p.x = own.reduce((a, q) => a + (q.ix + 0.5) * cell.x, 0) / own.length;   // середина груза точки от кабины, м
        p.top = (Math.max(...own.map(q => q.iy)) + 1) * cell.y;
        p.over = own.some(q => q.ix >= n.x);
      });
      boxes = cells.map(q => ({ p: q.p, approx: false, over: q.ix >= n.x, ix: q.ix, iy: q.iy, iz: q.iz, cx: (q.ix + 0.5) * cell.x, cy: (q.iy + 0.5) * cell.y, cz: -B.w / 2 + (q.iz + 0.5) * cell.z, sx: cell.x, sy: cell.y, sz: cell.z }));
    }
    let moment = 0;
    points.forEach(p => { moment += p.x * p.kg; });
    return {
      name: trip.name, kind, label: veh.label || kind, body: B, n, cell, cellV, cap, points, cells, boxes, byBoxes, pack, cbm, kg,
      usedLen: byBoxes ? pack.usedLen : Math.min(B.l, Math.ceil(k / Math.max(1, cap / n.x)) * cell.x),
      maxKg: veh.nomKg != null ? veh.nomKg : veh.kg, fill: cbm / B.v, overM3, overCells: byBoxes ? pack.overN : Math.max(0, k - cap),
      cg: kg ? moment / kg : null
    };
  }

  // ---------- 3D ----------
  let T = null, loading = null;
  function load() {
    if (T) return Promise.resolve(T);
    if (loading) return loading;
    loading = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = new URL('js/vendor/three/three-viz.min.js', document.baseURI).href; s.async = true;
      s.onload = () => { T = window.LogiThree || null; if (T) res(T); else { loading = null; rej(new Error('3D-библиотека не загрузилась')); } };
      s.onerror = () => { loading = null; s.remove(); rej(new Error('Не удалось загрузить 3D. Нужен интернет при первом открытии вкладки.')); };
      document.head.appendChild(s);
    });
    return loading;
  }

  // Качество 3D. «Высокое» — лак и хром, точёные колёса, мелкие детали кабины и фургона, картон коробок, мягкие тени
  // в щелях (GTAO), свечение фар (bloom), сглаживание MSAA, чёткость до 2. «Обычное» — проще и быстрее: телефоны и
  // слабые видеокарты. Само выбирается высокое на компьютере: экран от 700 px, мышь, от 4 ядер и 4 ГБ памяти и
  // настоящая видеокарта (не программная отрисовка).
  let gpu = null;
  function gpuName() {
    if (gpu != null) return gpu;
    gpu = '';
    try {
      const c = document.createElement('canvas'), gl = c.getContext('webgl2') || c.getContext('webgl');
      if (gl) {
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        gpu = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
        const lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
      }
    } catch (e) { gpu = ''; }
    return gpu;
  }
  function autoQuality() {
    const mm = q => !!(window.matchMedia && window.matchMedia(q).matches), nav = window.navigator || {};
    if (Math.min(window.innerWidth, window.innerHeight) < 700 || (mm('(pointer: coarse)') && !mm('(any-pointer: fine)'))) return 'std';
    if ((nav.deviceMemory && nav.deviceMemory < 4) || (nav.hardwareConcurrency && nav.hardwareConcurrency < 4)) return 'std';
    return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(gpuName()) ? 'std' : 'hq';
  }

  // тон NeutralToneMapping (как в three.js) и обратный к нему цвет: фон в высоком качестве проходит через тон
  const neutral = ([r, g, b]) => {
    const x = Math.min(r, g, b), off = x < 0.08 ? x - 6.25 * x * x : 0.04;
    r -= off; g -= off; b -= off;
    const peak = Math.max(r, g, b);
    if (peak < 0.76) return [r, g, b];
    const np = 1 - 0.0576 / (peak - 0.52), s = np / peak, k = 1 - 1 / (0.15 * (peak - np) + 1);
    return [r, g, b].map(v => v * s + (np - v * s) * k);
  };
  function untone(col) {
    const t = [col.r, col.g, col.b];
    let x = t.slice();
    for (let i = 0; i < 60; i++) {
      const y = neutral(x);
      x = x.map((v, c) => { const e = x.slice(); e[c] += 1e-4; return Math.max(0, v + (t[c] - y[c]) / Math.max((neutral(e)[c] - y[c]) / 1e-4, 0.02)); });
    }
    return col.setRGB(x[0], x[1], x[2]);
  }

  const DIRS = { '3d': [1, 0.8, 1.15], side: [0.001, 0.12, 1], top: [0.001, 1, 0.12], back: [1, 0.35, 0.001] };
  const GAP = 0.08, CAB_Y = -0.3;              // зазор между кабиной и кузовом; низ кабины (пол кузова — y = 0)
  const wheelY = r => -0.14 - r;               // центр колеса: верх колеса чуть ниже пола кузова
  const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const easeOut = t => 1 - Math.pow(1 - t, 3);
  const clamp01 = t => t < 0 ? 0 : t > 1 ? 1 : t;

  // Кабина сбоку: точки (u — вперёд от задней стенки кабины, v — вверх от её низа), ws — лобовое стекло сверху вниз,
  // belt — низ боковых окон, front — до какой высоты передок вертикальный, fa — передняя ось (доля длины кабины).
  function cabForm(kind, cab, H) {
    if (kind === 'gazel') return { pts: [[0, 0], [0, H], [cab * 0.58, H], [cab * 0.8, H * 0.56], [cab * 0.97, H * 0.47], [cab, H * 0.4], [cab, 0]],   // с коротким капотом
      ws: [[cab * 0.58, H], [cab * 0.8, H * 0.56]], belt: H * 0.56, light: H * 0.31, grille: [H * 0.1, H * 0.25], fa: 0.72 };
    if (kind === 'changan') return { pts: [[0, 0], [0, H], [cab * 0.64, H], [cab * 0.9, H * 0.56], [cab, H * 0.46], [cab, 0]],   // полукапотная
      ws: [[cab * 0.64, H], [cab * 0.9, H * 0.56]], belt: H * 0.56, light: H * 0.33, grille: [H * 0.12, H * 0.27], fa: 0.55 };
    return { pts: [[0, 0], [0, H], [cab - 0.14, H], [cab, H * 0.58], [cab, 0]],   // кабина над двигателем: Labo, Kamaz
      ws: [[cab - 0.14, H], [cab, H * 0.58]], belt: H * 0.58, light: H * 0.2, grille: [H * 0.27, H * 0.5], fa: 0.52 };
  }
  // многоугольник выше или ниже горизонтали v = s (для двухцветной кабины)
  function clipV(pts, s, below) {
    const out = [], inside = p => below ? p[1] <= s : p[1] >= s;
    pts.forEach((p, i) => {
      const q = pts[(i + 1) % pts.length], a = inside(p);
      if (a) out.push(p);
      if (a !== inside(q)) { const t = (s - p[1]) / (q[1] - p[1]); out.push([p[0] + (q[0] - p[0]) * t, s]); }
    });
    return out;
  }

  function createView(host, h) {
    if (!T) throw new Error('3D ещё не загружен');
    let el = host;   // вкладку можно покинуть и вернуться: холст переносится в новый контейнер (attach/detach)
    const css = getComputedStyle(document.documentElement), tok = (name, d) => css.getPropertyValue(name).trim() || d;
    const font = tok('--font-heading', 'system-ui, sans-serif');
    // цвета сцены — из токенов design-system.css, чтобы 3D менялся вместе с оформлением сайта (и темой: в тёмной
    // токены — смеси с прозрачностью, браузер считает их сам, прозрачные — накладываются на фон сцены)
    const probe = document.createElement('i'); probe.style.display = 'none'; document.body.appendChild(probe);
    const rgb = (name, d, under) => {
      probe.style.color = ''; probe.style.color = 'var(' + name + ', ' + d + ')';
      const c = getComputedStyle(probe).color, m = c.match(/-?[\d.]+(?:e-?\d+)?/g) || [], k = /^color\(/.test(c) ? 255 : 1;
      if (m.length < 3) return d;
      const a = m.length > 3 ? +m[3] : 1, ch = i => Math.round(+m[i] * k * a + (under ? under[i] : 255) * (1 - a));
      return 'rgb(' + ch(0) + ',' + ch(1) + ',' + ch(2) + ')';
    };
    const bgRgb = rgb('--viz-bg', '#f3f6fa'), under = bgRgb.match(/\d+/g).map(Number);
    const C = { danger: rgb('--color-danger', '#c0392b'), ink: rgb('--viz-ink', '#1d2d3d'), envelope: rgb('--color-accent-500', '#749dc4'),
      grid1: rgb('--color-neutral-300', '#b7b7ba', under), grid2: rgb('--color-neutral-200', '#d4d4d7', under), bg: bgRgb,
      navy: rgb('--buraq-navy', '#0E2E54'), red: rgb('--buraq-red', '#DE0441') };
    probe.remove();
    const still = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };   // без анимаций
    const small = Math.min(window.innerWidth, window.innerHeight) < 700;
    const HQ = (h.quality === 'hq' || h.quality === 'std' ? h.quality : autoQuality()) === 'hq';

    // Скорость: чёткость не выше 1,5 (в высоком качестве — 2) и снижается сама, если устройство не успевает;
    // сглаживание — только на обычных экранах (в высоком качестве — MSAA в буфере эффектов); на ноутбуке — мощная видеокарта.
    const hiDpi = (window.devicePixelRatio || 1) >= 1.5;
    let dpr = Math.min(window.devicePixelRatio || 1, HQ ? 2 : 1.5), slow = 0, aoMove = true;
    const renderer = new T.WebGLRenderer({ antialias: !hiDpi && !HQ, powerPreference: 'high-performance' });
    renderer.setPixelRatio(dpr);
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.NeutralToneMapping;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;   // машины стоят: тени считаются один раз на сцену, а не каждый кадр
    const cv = renderer.domElement;
    cv.style.display = 'block'; cv.style.touchAction = 'none'; cv.style.outline = 'none';
    cv.style.opacity = '0'; cv.style.transition = 'opacity .35s ease';   // проявляется, когда шейдеры готовы
    el.appendChild(cv);
    const scene = new T.Scene();
    scene.background = new T.Color(C.bg);
    scene.fog = new T.Fog(C.bg, 30, 90);
    // мягкие отражения на краске, стёклах и дисках — от «комнаты» вокруг сцены
    const pmrem = new T.PMREMGenerator(renderer), room = new T.RoomEnvironment(), envTex = pmrem.fromScene(room, HQ ? 0.02 : 0.04).texture;
    pmrem.dispose(); if (room.dispose) room.dispose();
    scene.environment = envTex; scene.environmentIntensity = HQ ? 0.7 : 0.55;
    const camera = new T.PerspectiveCamera(38, 1, 0.05, 500);
    const controls = new T.OrbitControls(camera, cv);
    controls.enableDamping = true; controls.dampingFactor = 0.085;   // вращение с инерцией
    controls.screenSpacePanning = true; controls.maxPolarAngle = Math.PI * 0.49;
    scene.add(new T.HemisphereLight(0xffffff, 0xcfd6df, 0.75));
    const sun = new T.DirectionalLight(0xffffff, 2.3);
    const sm = HQ ? 4096 : small ? 1024 : 2048;
    sun.castShadow = true; sun.shadow.mapSize.set(sm, sm);
    sun.shadow.radius = HQ ? 6 : 4; sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
    scene.add(sun, sun.target);
    const fill = new T.DirectionalLight(0xffffff, 0.9); scene.add(fill, fill.target);   // со стороны камеры, без теней
    // Эффекты высокого качества: кадр рисуется в буфер с MSAA, затем тени в щелях (GTAO — между коробками, под машиной,
    // у колёс), свечение фар и бликов лака (bloom: только ярче белого, фон не светится), тон и цвет — как у сайта.
    // Подписи рисуются после эффектов поверх кадра (слой 1), чтобы не темнели и не светились.
    let composer = null, gtao = null;
    if (HQ) {
      composer = new T.EffectComposer(renderer, new T.WebGLRenderTarget(1, 1, { type: T.HalfFloatType, samples: 4 }));
      composer.addPass(new T.RenderPass(scene, camera));
      gtao = new T.GTAOPass(scene, camera, 1, 1);
      gtao.updateGtaoMaterial({ radius: 0.42, distanceExponent: 1.6, thickness: 1.4, scale: 1.15, samples: 16 });
      gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
      gtao.blendIntensity = 0.9;
      // стёкла, стенки фургона, невидимый объём для тени, подписи и дальняя земля — не дают теней в щелях
      const hide = gtao._overrideVisibility.bind(gtao);
      gtao._overrideVisibility = function () {
        hide();
        scene.traverse(o => { if (o.visible && (o.isSprite || o.userData.noAO || (o.material && !Array.isArray(o.material) && (o.material.transparent || o.material.colorWrite === false)))) { o.visible = false; this._visibilityCache.push(o); } });
      };
      composer.addPass(gtao);
      composer.addPass(new T.UnrealBloomPass(new T.Vector2(1, 1), 0.25, 0.25, 2.2));
      composer.addPass(new T.OutputPass());
      // фон и дымка проходят через тон вместе с кадром — берём такой цвет, чтобы на экране он совпал с фоном сайта
      const bgc = untone(new T.Color(C.bg));
      scene.background = bgc; scene.fog.color.copy(bgc);
    }
    let root = null, ground = null, grid = null, bays = null, pick = [], hits = [], cur = {}, disposed = false, raf = 0, tween = null, anims = [], compiling = null;

    // общие материалы сцены: создаются один раз, освобождаются в dispose()
    // Standard — с отражениями (краска, стёкла, диски); Lambert — проще и быстрее (груз, земля, резина, рама)
    const shared = new Set(), std = o => { const m = new T.MeshStandardMaterial(o); shared.add(m); return m; };
    const lam = o => { const m = new T.MeshLambertMaterial(o); shared.add(m); return m; };
    const phys = o => { const m = new T.MeshPhysicalMaterial(o); shared.add(m); return m; };
    // краска: в высоком качестве — под лаком (второй слой бликов)
    const paint = (color, roughness, metalness) => HQ ? phys({ color, roughness, metalness, clearcoat: 1, clearcoatRoughness: 0.07 }) : std({ color, roughness, metalness });
    const logoTex = [];
    const logoMat = file => {   // логотип — готовый файл из бренд-бука, без изменений
      const c = document.createElement('canvas'); c.width = 1052; c.height = 362;
      const tex = new T.CanvasTexture(c); tex.colorSpace = T.SRGBColorSpace; tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      logoTex.push(tex);
      const m = std({ map: tex, transparent: true, roughness: 0.35, metalness: 0.1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
      m.visible = false;
      const img = new Image();
      img.onload = () => { if (disposed) return; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); tex.needsUpdate = true; m.visible = true; kick(); };
      img.src = new URL('buraq-brand/logo/' + file, document.baseURI).href;
      return m;
    };
    // картон коробок (высокое качество): светлый, чтобы цвет точки читался, края темнее, скотч сверху и на торцах,
    // наклейка сбоку. Три плитки в одной текстуре: верх — скотч вдоль, торцы — скотч сверху вниз, бока и низ — без скотча
    const boxTex = HQ ? (() => {
      const S = 128, c = document.createElement('canvas'), x = c.getContext('2d');
      c.width = S * 3; c.height = S;
      let seed = 7;
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      for (let t = 0; t < 3; t++) {
        const x0 = t * S;
        x.fillStyle = '#ebe3d5'; x.fillRect(x0, 0, S, S);
        for (let i = 0; i < 900; i++) { const v = 214 + Math.floor(rnd() * 36); x.fillStyle = 'rgba(' + v + ',' + (v - 7) + ',' + (v - 18) + ',0.3)'; x.fillRect(x0 + rnd() * S, rnd() * S, 1 + rnd() * 3, 1); }   // волокна
        [[0, 0, S, 10, 0, 0, 0, 10], [0, S - 10, S, 10, 0, S, 0, S - 10], [0, 0, 10, S, 0, 0, 10, 0], [S - 10, 0, 10, S, S, 0, S - 10, 0]].forEach(([a, b, w, hh, g0x, g0y, g1x, g1y]) => {
          const g = x.createLinearGradient(x0 + g0x, g0y, x0 + g1x, g1y); g.addColorStop(0, 'rgba(90,76,58,0.28)'); g.addColorStop(1, 'rgba(90,76,58,0)');
          x.fillStyle = g; x.fillRect(x0 + a, b, w, hh);
        });
        const tape = (tx, ty, tw, th) => { x.fillStyle = 'rgba(176,146,104,0.5)'; x.fillRect(tx, ty, tw, th); x.fillStyle = 'rgba(110,96,76,0.35)'; if (tw > th) { x.fillRect(tx, ty, tw, 1.5); x.fillRect(tx, ty + th - 1.5, tw, 1.5); } else { x.fillRect(tx, ty, 1.5, th); x.fillRect(tx + tw - 1.5, ty, 1.5, th); } };
        if (t === 0) tape(x0, S * 0.41, S, S * 0.18);
        if (t === 1) tape(x0 + S * 0.41, 0, S * 0.18, S * 0.36);
        if (t === 2) { x.fillStyle = 'rgba(255,255,255,0.85)'; x.fillRect(x0 + S * 0.56, S * 0.6, S * 0.3, S * 0.2); x.fillStyle = 'rgba(70,70,70,0.45)'; [0.65, 0.7, 0.75].forEach(v => x.fillRect(x0 + S * 0.59, S * v, S * 0.22, 1.5)); }
      }
      const tex = new T.CanvasTexture(c); tex.colorSpace = T.SRGBColorSpace; tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      logoTex.push(tex);
      return tex;
    })() : null;
    // номерной знак (высокое качество): белый, с тонкой рамкой; номер условный
    const plateTex = HQ ? (() => {
      const c = document.createElement('canvas'), x = c.getContext('2d'); c.width = 520; c.height = 112;
      x.fillStyle = '#ffffff'; x.fillRect(0, 0, 520, 112);
      x.strokeStyle = '#1d2126'; x.lineWidth = 6; x.strokeRect(5, 5, 510, 102); x.fillStyle = '#1d2126'; x.fillRect(118, 8, 4, 96);
      x.font = '500 76px ' + font; x.textBaseline = 'middle'; x.textAlign = 'center';
      x.fillText('01', 62, 60); x.fillText('A 777 BL', 312, 60);
      const tex = new T.CanvasTexture(c); tex.colorSpace = T.SRGBColorSpace; logoTex.push(tex);
      return tex;
    })() : null;
    const M = {
      white: paint('#f3f5f8', 0.3, 0.1),
      navy: paint(C.navy, 0.34, 0.15),
      red: paint(C.red, 0.4, 0),
      glass: HQ ? phys({ color: '#15263c', roughness: 0.04, metalness: 0.4, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.6 })
        : std({ color: '#15263c', roughness: 0.06, metalness: 0.4, envMapIntensity: 1.6 }),
      // боковые стёкла в высоком качестве — тонированные и прозрачные: окна прорезаны, за ними салон
      side: HQ ? phys({ color: '#0d1826', roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.55, envMapIntensity: 0.9 }) : null,
      rubber: HQ ? std({ color: '#1b1e22', roughness: 0.86, side: T.DoubleSide }) : lam({ color: '#1d2126' }),
      rim: HQ ? std({ color: '#cdd3da', roughness: 0.2, metalness: 0.9, side: T.DoubleSide }) : std({ color: '#cdd3da', roughness: 0.28, metalness: 0.75 }),
      chrome: std({ color: '#eef1f4', roughness: 0.1, metalness: 1 }),
      inner: lam({ color: '#2a2f36' }),       // салон: панель, сиденья, руль
      lens: phys({ color: '#f4f6f8', roughness: 0.05, clearcoat: 1 }),   // фонарь заднего хода — без свечения
      plate: lam({ map: plateTex }),
      dark: lam({ color: '#2b3138' }),
      fender: lam({ color: '#262b31' }),
      chassis: lam({ color: '#39414a' }),
      frame: std({ color: '#e7ebf0', roughness: 0.35, metalness: 0.35 }),
      floor: lam({ color: '#9aa3ad' }),
      board: lam({ color: '#eef1f5' }),
      panel: std({ color: '#dde7f3', roughness: 0.12, transparent: true, opacity: 0.12, depthWrite: false }),
      head: HQ ? phys({ color: '#ffffff', emissive: '#fff3d6', emissiveIntensity: 5, roughness: 0.05, clearcoat: 1 }) : std({ color: '#ffffff', emissive: '#fff3d6', emissiveIntensity: 0.9, roughness: 0.2 }),
      tail: std({ color: C.red, emissive: C.red, emissiveIntensity: HQ ? 12 : 0.5, roughness: 0.3 }),
      cargo: lam({ color: '#ffffff', map: boxTex }),
      cargoOut: lam({ color: '#ffffff', map: boxTex, transparent: true, opacity: 0.5, depthWrite: false }),
      cargoApprox: lam({ color: '#ffffff', transparent: true, opacity: 0.32, depthWrite: false }),   // точка без списка коробок — условный блок
      ground: lam({ color: C.bg }),
      bay: lam({ color: C.grid1 }),             // разметка стоянки (высокое качество)
      logo: logoMat('buraq-logo.svg'),            // на белой кабине — основной
      logoWhite: logoMat('buraq-logo-white.svg')  // на синей — белый
    };
    // невидимый объём кузова: тень от машины с грузом одним блоком, а не от сотен коробок
    const shadowOnly = new T.MeshBasicMaterial({ colorWrite: false, depthWrite: false }); shared.add(shadowOnly);
    const pickMat = new T.MeshBasicMaterial(); shared.add(pickMat);   // невидимые коробки-«мишени» машин для нажатия
    const noShadow = new Set([M.glass, M.side, M.logo, M.logoWhite, M.head, M.tail, M.red, M.panel, M.inner, M.plate, M.lens]);
    // слияние: все неподвижные детали всех машин — одна сетка на материал (десятки вызовов отрисовки вместо сотен)
    const m4b = new T.Matrix4();
    const flipWinding = geo => Object.values(geo.attributes).forEach(a => {   // зеркальная деталь: порядок вершин обратно
      const s = a.itemSize, arr = a.array;
      for (let i = 0; i + 2 < a.count; i += 3) for (let j = 0; j < s; j++) { const p = (i + 1) * s + j, q = (i + 2) * s + j, t = arr[p]; arr[p] = arr[q]; arr[q] = t; }
    });
    function mergeParts(trucks) {
      const byMat = new Map(), src = new Set();
      trucks.forEach(g => g.userData.parts.forEach(ms => {
        ms.updateMatrix(); m4b.multiplyMatrices(g.matrix, ms.matrix);
        const geo = ms.geometry.index ? ms.geometry.toNonIndexed() : ms.geometry.clone();
        Object.keys(geo.attributes).forEach(a => { if (a !== 'position' && a !== 'normal' && a !== 'uv') geo.deleteAttribute(a); });
        geo.clearGroups(); geo.applyMatrix4(m4b);
        if (m4b.determinant() < 0) flipWinding(geo);
        src.add(ms.geometry);
        if (!byMat.has(ms.material)) byMat.set(ms.material, []);
        byMat.get(ms.material).push(geo);
      }));
      byMat.forEach((list, mat) => {
        const geo = T.mergeGeometries(list, false);
        list.forEach(x => x.dispose());
        if (!geo) return;
        const mesh = new T.Mesh(geo, mat);
        mesh.castShadow = !noShadow.has(mat); mesh.matrixAutoUpdate = false;
        root.add(mesh);
      });
      src.forEach(x => x.dispose());
    }

    // кадры рисуются, только пока что-то движется: камера, инерция, анимация груза
    let last = 0;
    const tick = now => {
      if (compiling || !el) { raf = 0; last = 0; return; }   // пока шейдеры собираются в фоне — не рисуем, чтобы не блокировать страницу
      // первые кадры анимации задержались (сборка шейдеров) — она ждёт, а не проскакивает
      const lag = last ? now - last - 16 : 0, wait = a => { if (a.t0 != null && (a.f = (a.f || 0) + 1) <= 3 && lag > 84) a.t0 += lag; };
      anims.forEach(wait); if (tween) wait(tween);
      // устройство не успевает (кадр дольше 30 мс раз за разом) — чёткость ниже, движение плавнее
      if (last) { if (lag > 14) slow++; else if (slow) slow--; }
      // в высоком качестве сначала тени в щелях считаются только в покое, потом — ниже чёткость
      if (slow > 10 && gtao && aoMove) { aoMove = false; slow = 0; }
      else if (slow > 10 && dpr > 0.75) { dpr = Math.max(0.75, dpr - 0.25); renderer.setPixelRatio(dpr); if (composer) composer.setPixelRatio(dpr); slow = 0; }
      last = now;
      let moving = false;
      if (tween) moving = stepTween(now) || moving;
      if (anims.length) moving = stepAnims(now) || moving;
      if (controls.update()) moving = true;
      if (gtao) gtao.enabled = aoMove || !moving;   // последний кадр движения — всегда с тенями в щелях
      frame();
      draw();
      raf = 0;
      if (moving && !disposed) raf = requestAnimationFrame(tick); else last = 0;
    };
    const kick = () => { if (!raf && !disposed) raf = requestAnimationFrame(tick); };
    // дымка у горизонта и границы видимости — от текущего расстояния камеры (при подлёте и отдалении)
    const frame = () => {
      const d = Math.max(0.5, camera.position.distanceTo(controls.target));
      scene.fog.near = d * 1.6; scene.fog.far = d * 4.5;
      if (Math.abs(camera.near - d / 100) > d / 1000) { camera.near = d / 100; camera.far = d * 30; camera.updateProjectionMatrix(); }
    };
    const draw = () => {
      if (!composer) { renderer.render(scene, camera); return; }
      composer.render();
      const bg = scene.background;   // подписи (слой 1) — поверх готового кадра
      scene.background = null; camera.layers.set(1); renderer.autoClear = false;
      renderer.setRenderTarget(null); renderer.clearDepth(); renderer.render(scene, camera);
      renderer.autoClear = true; camera.layers.set(0); scene.background = bg;
    };
    const render = () => { if (!disposed && !compiling && el) { if (gtao) gtao.enabled = true; frame(); draw(); } };
    // шейдеры собираются параллельно, без подвисания страницы; сцена проявляется, когда всё готово
    const compile = () => {
      const job = compiling = (renderer.compileAsync ? renderer.compileAsync(scene, camera) : Promise.resolve()).catch(() => {}).then(() => {
        if (compiling !== job || disposed) return;
        compiling = null; kick();
        requestAnimationFrame(() => { cv.style.opacity = '1'; });
      });
    };
    controls.addEventListener('change', kick);
    controls.addEventListener('start', () => { tween = null; });   // пользователь взял камеру — перелёт останавливается
    const resize = () => {
      if (!el) return;
      const w = el.clientWidth || 1, hh = el.clientHeight || 1;
      renderer.setSize(w, hh, false); cv.style.width = w + 'px'; cv.style.height = hh + 'px';
      if (composer) { composer.setPixelRatio(dpr); composer.setSize(w, hh); }
      camera.aspect = w / hh; camera.updateProjectionMatrix(); render();
    };
    const ro = window.ResizeObserver ? new ResizeObserver(resize) : null;
    if (ro) ro.observe(el); else window.addEventListener('resize', resize);

    const sprite = (text, o) => {
      if (window.I18N) text = window.I18N.t(text);   // подпись на холсте — на языке сайта (js/i18n.js)
      const fs = 64, c = document.createElement('canvas'), x = c.getContext('2d');
      x.font = '500 ' + fs + 'px ' + font;
      const round = !!o.round, hgt = Math.round(fs * (round ? 1.5 : 1.35)), w = round ? hgt : Math.ceil(x.measureText(text).width) + 48;
      c.width = w; c.height = hgt;
      x.font = '500 ' + fs + 'px ' + font;
      x.fillStyle = o.bg;
      if (round) { x.beginPath(); x.arc(w / 2, hgt / 2, hgt / 2 - 5, 0, Math.PI * 2); x.fill(); x.lineWidth = 7; x.strokeStyle = '#ffffff'; x.stroke(); }
      else { const r = hgt / 2; x.beginPath(); x.moveTo(r, 0); x.arcTo(w, 0, w, hgt, r); x.arcTo(w, hgt, 0, hgt, r); x.arcTo(0, hgt, 0, 0, r); x.arcTo(0, 0, w, 0, r); x.fill(); }
      x.fillStyle = o.fg; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, w / 2, hgt / 2 + 3);
      const tex = new T.CanvasTexture(c); tex.colorSpace = T.SRGBColorSpace;
      const sp = new T.Sprite(new T.SpriteMaterial({ map: tex, depthTest: false, transparent: true, fog: false }));
      sp.scale.set(o.size * w / hgt, o.size, 1); sp.renderOrder = 10;
      if (composer) sp.layers.set(1);
      return sp;
    };

    // груз: положение и цвет каждого кубика; a — «присутствие» 0…1 для анимаций погрузки и разгрузки
    const m4 = new T.Matrix4(), q0 = new T.Quaternion(), v3 = new T.Vector3(), s3 = new T.Vector3(), col = new T.Color(), grey = new T.Color('#c9ccd1');
    const jitter = q => ((((q.ix * 73856093) ^ (q.iy * 19349663) ^ (q.iz * 83492791)) >>> 0) % 1000 / 1000 - 0.5) * 0.07;   // коробки чуть разные по тону
    const tint = (q, sel) => { col.set(colorOf(q.p)); if (sel && sel !== q.p) col.lerp(grey, 0.78); return col.offsetHSL(0, 0, jitter(q)); };
    function place(im, i, a, how) {
      const u = im.userData;
      u.pres[i] = a;
      if (a <= 0.001) m4.makeScale(0, 0, 0);
      else {
        v3.copy(u.base[i]);
        let s = 1;
        if (how === 'drop') { v3.y += (1 - easeOut(a)) * u.drop; s = 0.7 + 0.3 * Math.min(1, a * 3); }   // погрузка: коробки опускаются на место
        else if (how === 'slide') { v3.x += (1 - a) * u.slide; s = 0.4 + 0.6 * a; }   // разгрузка: выезжают через двери
        m4.compose(v3, q0, s3.set(s, s, s));
      }
      im.setMatrixAt(i, m4);
    }
    function stepAnims(now) {
      const dirty = new Set();
      anims = anims.filter(a => {
        if (a.t0 == null) a.t0 = now + a.delay;   // отсчёт — с первого кадра: первый кадр может рисоваться долго
        const t = clamp01((now - a.t0) / a.dur);
        if (a.colors) {
          const arr = a.im.instanceColor.array;
          for (let j = 0; j < arr.length; j++) arr[j] = a.from[j] + (a.to[j] - a.from[j]) * ease(t);
          a.im.instanceColor.needsUpdate = true;
        } else { place(a.im, a.i, a.from + (a.to - a.from) * (now < a.t0 ? 0 : a.how === 'drop' ? t : ease(t)), a.how); dirty.add(a.im); }
        return t < 1;
      });
      dirty.forEach(im => { im.instanceMatrix.needsUpdate = true; im.boundingSphere = null; });
      return anims.length > 0;
    }
    function stepTween(now) {
      const w = tween;
      if (w.t0 == null) w.t0 = now;
      const e = ease(clamp01((now - w.t0) / w.dur));
      const sph = (o, k) => o.r0 + (o.r1 - o.r0) * k;
      const r = Math.exp(sph({ r0: Math.log(w.a.r), r1: Math.log(w.b.r) }, e)), ph = sph({ r0: w.a.ph, r1: w.b.ph }, e);
      let dth = w.b.th - w.a.th; if (dth > Math.PI) dth -= 2 * Math.PI; if (dth < -Math.PI) dth += 2 * Math.PI;
      const th = w.a.th + dth * e;
      controls.target.lerpVectors(w.fromT, w.toT, e);
      camera.position.set(r * Math.sin(ph) * Math.sin(th), r * Math.cos(ph), r * Math.sin(ph) * Math.cos(th)).add(controls.target);
      if (e >= 1) { tween = null; return false; }
      return true;
    }

    // точёное колесо (высокое качество): шина с боковиной и тремя канавками протектора, диск-«тарелка» с гайками,
    // отверстиями и колпаком; тёмный диск за «тарелкой» закрывает шину изнутри. Ось колеса — y (как у цилиндра), наружу — +y.
    function hqWheel(r, tw) {
      const h = tw / 2, ri = r * 0.64, gr = r - Math.min(0.014, r * 0.04), V = pts => pts.map(([a, b]) => new T.Vector2(a, b));
      const tp = [[ri, -h * 0.8], [r * 0.8, -h], [r * 0.94, -h * 0.97], [r * 0.99, -h * 0.84], [r, -h * 0.7]];
      [-0.42, 0, 0.42].forEach(c => tp.push([r, (c - 0.1) * h], [gr, (c - 0.07) * h], [gr, (c + 0.07) * h], [r, (c + 0.1) * h]));
      tp.push([r, h * 0.7], [r * 0.99, h * 0.84], [r * 0.94, h * 0.97], [r * 0.8, h], [ri, h * 0.8]);
      const rim = [new T.LatheGeometry(V([[r * 0.13, h * 0.7], [r * 0.2, h * 0.66], [r * 0.34, h * 0.42], [r * 0.5, h * 0.44], [r * 0.58, h * 0.62], [ri + 0.006, h * 0.72], [ri + 0.006, h * 0.3]]), 48)];
      const hub = new T.CylinderGeometry(ri + 0.003, ri + 0.003, 0.02, 32), dark = [hub];
      hub.translate(0, h * 0.1, 0);
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * Math.PI * 2, nut = new T.CylinderGeometry(r * 0.04, r * 0.04, 0.05, 6), hole = new T.CylinderGeometry(r * 0.065, r * 0.065, 0.01, 16);
        nut.translate(Math.cos(a) * r * 0.25, h * 0.68, Math.sin(a) * r * 0.25); rim.push(nut);
        hole.translate(Math.cos(a + Math.PI / 6) * r * 0.42, h * 0.45, Math.sin(a + Math.PI / 6) * r * 0.42); dark.push(hole);
      }
      const cap = new T.SphereGeometry(r * 0.14, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2); cap.translate(0, h * 0.66, 0); rim.push(cap);
      const merge = list => { const g = T.mergeGeometries(list, false); list.forEach(x => x.dispose()); return g; };
      return { tire: new T.LatheGeometry(V(tp), 56), rim: merge(rim), dark: merge(dark) };
    }
    // грани коробки по порядку BoxGeometry: +x, −x — торцы (скотч сверху вниз), +y — верх (скотч вдоль), −y, ±z — без скотча
    const TILE = [1, 1, 0, 2, 2, 2];
    const boxUV = geo => { const uv = geo.attributes.uv, per = uv.count / 6; for (let i = 0; i < uv.count; i++) uv.setX(i, (TILE[Math.floor(i / per)] + uv.getX(i)) / 3); uv.needsUpdate = true; return geo; };

    // одна машина с грузом; кабина к x<0, кузов от x=0 (стенка кабины) до x=L (двери), y — вверх, z — поперёк
    function truck(lay, o) {
      const g = new T.Group(), B = lay.body, L = B.l, W = B.w, H = B.h, kind = lay.kind, parts = [];
      const add = ms => { parts.push(ms); return ms; };   // неподвижная деталь: после расстановки машин сольётся с остальными
      const box = (sx, sy, sz, x, y, z, m, shadow) => { const ms = new T.Mesh(new T.BoxGeometry(sx, sy, sz), m); ms.position.set(x, y, z); return add(ms, shadow); };
      const rbox = (sx, sy, sz, x, y, z, m, rad, shadow) => { const ms = new T.Mesh(new T.RoundedBoxGeometry(sx, sy, sz, 1, Math.min(rad, sx / 2.01, sy / 2.01, sz / 2.01)), m); ms.position.set(x, y, z); return add(ms, shadow); };
      const cab = B.cab, cH = B.cabH, CW = B.cabW || W * 0.97, F = cabForm(kind, cab, cH), k = Math.min(1, Math.max(0.5, (L + cab) / 7.5));   // подписи мельче у маленькой машины
      const X = u => -GAP - u, Y = v => CAB_Y + v;   // из координат кабины в координаты машины
      const r = B.wheel, wy = wheelY(r), tw = 0.22 + r * 0.24, track = Math.max(W, CW) / 2 - tw / 2 - 0.03;
      const fa = B.base ? X(cab - B.front) : X(cab * F.fa), ra = B.base ? fa + B.base : L * 0.7;   // оси: у Labo по колёсной базе
      const axles = [fa, ra].concat(kind === 'kamaz' ? [ra + r * 2.3] : []);
      const navyCab = kind === 'kamaz';

      // кабина: профиль сбоку с аркой над передним колесом, выдавлен на ширину кабины со скруглёнными краями;
      // низ — фирменный синий, верх — белый (у Kamaz вся синяя), между ними — тонкая красная полоса
      const rr = r + 0.07, vc = wy - CAB_Y, ua = -GAP - fa, d = Math.sqrt(Math.max(0, rr * rr - vc * vc)), prof = F.pts.slice();
      if (d > 0 && ua - d > 0.02 && ua + d < cab - 0.02) {
        const t0 = Math.asin(Math.max(-1, Math.min(1, -vc / rr)));
        for (let i = 0; i <= 14; i++) { const t = t0 + (Math.PI - 2 * t0) * i / 14; prof.push([ua + rr * Math.cos(t), vc + rr * Math.sin(t)]); }
      }
      const split = Math.max(cH * 0.2, vc + rr + 0.06);
      // боковые окна: сзади — от стойки, спереди — вдоль лобового стекла
      const [w1, w2] = F.ws;
      const uAt = v => Math.min(cab, w1[0] + (w2[0] - w1[0]) * (cH - v) / (cH - w2[1]));   // передний край окна — вдоль лобового стекла
      const vb = F.belt + 0.04, vt = cH - 0.1, ur = kind === 'kamaz' ? cab * 0.42 : cab * 0.1;
      const win = [[ur, vb], [ur, vt], [uAt(vt) - 0.08, vt], [uAt(vb) - 0.08, vb]], V2 = ([u, v]) => new T.Vector2(X(u), Y(v));
      const extr = (pts, mat, holes) => {
        const bt = 0.05, depth = CW - 2 * bt, sh = new T.Shape(pts.map(V2));
        (holes || []).forEach(hp => sh.holes.push(new T.Shape(hp.map(V2))));
        const geo = new T.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: bt, bevelSize: 0.05, bevelOffset: -0.05, bevelSegments: 3, curveSegments: 4 });
        geo.translate(0, 0, -depth / 2);
        return add(new T.Mesh(geo, mat));
      };
      extr(clipV(prof, split, true), M.navy);
      extr(clipV(prof, split, false), navyCab ? M.navy : M.white, HQ ? [win] : null);   // в высоком качестве окна прорезаны насквозь
      [-1, 1].forEach(sd => box(cab - 0.12, 0.035, 0.006, X(cab / 2), Y(split + 0.035), sd * (CW / 2 + 0.003), M.red, false));
      // стёкла
      const dx = X(w2[0]) - X(w1[0]), dy = w2[1] - w1[1], wl = Math.hypot(dx, dy);
      const ws = box(wl * 0.84, 0.012, CW * 0.84, X((w1[0] + w2[0]) / 2) + dy / wl * 0.006, Y((w1[1] + w2[1]) / 2) - dx / wl * 0.006, 0, M.glass, false);
      ws.rotation.z = Math.atan2(dy, dx);
      const wgeo = new T.ShapeGeometry(new T.Shape(win.map(V2)));
      [-1, 1].forEach(sd => { const m = new T.Mesh(wgeo, M.side || M.glass); m.position.z = sd * (CW / 2 + 0.002); m.scale.z = sd; add(m, false); });
      // логотип на дверях — пропорции 526 × 181, с полем вокруг
      const lw = Math.min(cab * 0.52, (F.belt - split) * 0.6 * 526 / 181), lh = lw * 181 / 526, lgeo = new T.PlaneGeometry(lw, lh);
      [-1, 1].forEach(sd => { const m = new T.Mesh(lgeo, navyCab ? M.logoWhite : M.logo); m.position.set(X(cab * 0.42), Y((split + F.belt) / 2 + 0.02), sd * (CW / 2 + 0.004)); if (sd < 0) m.rotation.y = Math.PI; add(m); });
      // передок: фары, решётка, бампер, зеркала, ручки дверей
      const xf = X(cab), lwid = Math.min(0.3, CW * 0.18);
      [-1, 1].forEach(sd => rbox(0.05, 0.11 + cH * 0.02, lwid, xf - 0.012, Y(F.light), sd * (CW / 2 - lwid / 2 - 0.08), M.head, 0.02, false));
      rbox(0.04, F.grille[1] - F.grille[0], CW * (navyCab ? 0.62 : 0.46), xf - 0.008, Y((F.grille[0] + F.grille[1]) / 2), 0, M.dark, 0.02, false);
      rbox(0.18, 0.2 + r * 0.1, CW + 0.04, xf - 0.04, CAB_Y + 0.03, 0, M.dark, 0.05);
      const mx = X(w2[0] - 0.06), my = Y(F.belt + cH * 0.08), mh = 0.18 + cH * 0.04;
      const trim = HQ ? M.chrome : M.dark;   // кронштейны зеркал и ручки дверей
      [-1, 1].forEach(sd => {
        box(0.03, 0.03, 0.16, mx, my, sd * (CW / 2 + 0.08), trim, false);
        rbox(0.06, mh, 0.11, mx - 0.02, my, sd * (CW / 2 + 0.17), M.dark, 0.02);
        box(0.1, 0.022, 0.02, X(ur + 0.14), Y(F.belt - 0.1), sd * (CW / 2 + 0.008), trim, false);
      });
      if (kind === 'kamaz') {
        rbox(0.32, 0.05, CW * 0.94, X(w1[0]) - 0.12, Y(cH) - 0.03, 0, M.navy, 0.02);   // козырёк над стеклом
        [-1, 1].forEach(sd => [0.1, 0.36].forEach(v => rbox(0.42, 0.045, 0.14, X(cab * 0.26), Y(v), sd * (CW / 2 + 0.03), M.dark, 0.02)));   // ступеньки
      }
      if (HQ) {
        // мелкие детали: шов двери, дворники, салон за стёклами, решётка с хромовыми планками, хромовые ободки фар и
        // ходовые огни, противотуманки и номер на бампере, стёкла зеркал
        const seam = (pts, sd) => pts.forEach((p, i) => {
          if (!i) return;
          const a = pts[i - 1], du = p[0] - a[0], dv = p[1] - a[1], len = Math.hypot(du, dv);
          if (len > 0.01) box(len + 0.009, 0.009, 0.004, X((a[0] + p[0]) / 2), Y((a[1] + p[1]) / 2), sd * (CW / 2 + 0.002), M.dark, false).rotation.z = Math.atan2(dv, -du);
        });
        // дверь: сзади — за окном, спереди — вдоль лобового стекла; над передним колесом низ двери обходит арку
        const archTop = vc + rr + 0.03, archBack = ua - rr - 0.03, u0 = Math.max(0.05, ur - 0.06), vtop = cH - 0.06, uf = uAt(F.belt) - 0.05;
        const overArch = d > 0 && uf > archBack && ua + rr > u0, notch = overArch && archBack > u0 + 0.2, vb0 = overArch && !notch ? archTop : 0.08;
        const door = [[u0, vb0], [u0, vtop], [uAt(vtop) - 0.05, vtop], [uf, F.belt]].concat(notch ? [[uf, archTop], [archBack, archTop], [archBack, vb0]] : [[uf, vb0]], [[u0, vb0]]);
        [-1, 1].forEach(sd => seam(door, sd));
        const wpx = X(w1[0]) + dx * 0.9 + dy / wl * 0.02, wpy = Y(w1[1]) + dy * 0.9 - dx / wl * 0.02;
        [-0.21, 0.19].forEach(zz => { box(0.014, 0.012, CW * 0.36, wpx, wpy, zz * CW, M.dark, false).rotation.z = Math.atan2(dy, dx); });
        const uw = Math.min(w2[0], cab - 0.05);   // низ лобового стекла
        box(0.36, 0.14, CW * 0.86, X(uw - 0.22), Y(F.belt - 0.05), 0, M.inner, false);   // панель приборов
        [-1, 1].forEach(sd => {
          rbox(0.42, 0.12, CW * 0.3, X(ur + 0.38), Y(F.belt - 0.42), sd * CW * 0.24, M.inner, 0.04);   // сиденье
          rbox(0.1, 0.66, CW * 0.3, X(ur + 0.14), Y(F.belt - 0.06), sd * CW * 0.24, M.inner, 0.04);    // спинка
          rbox(0.09, 0.17, CW * 0.17, X(ur + 0.13), Y(F.belt + 0.37), sd * CW * 0.24, M.inner, 0.04);   // подголовник
        });
        const sw = new T.Mesh(new T.TorusGeometry(0.17, 0.022, 8, 28), M.inner);   // руль — у водителя слева (+z)
        sw.position.set(X(uw - 0.42), Y(F.belt + 0.04), CW * 0.24); sw.rotation.set(0, Math.PI / 2, 0); sw.rotateOnWorldAxis(new T.Vector3(0, 0, 1), 0.5); add(sw);
        const gw = CW * (navyCab ? 0.62 : 0.46), g0 = F.grille[0], gh = F.grille[1] - g0, gx = xf - 0.03;
        for (let i = 1; i <= 3; i++) box(0.012, 0.014, gw * 0.9, gx, Y(g0 + gh * i / 4), 0, M.chrome, false);
        [g0 - 0.008, g0 + gh + 0.008].forEach(v => box(0.016, 0.018, gw + 0.03, gx, Y(v), 0, M.chrome, false));
        [-1, 1].forEach(sd => box(0.016, gh + 0.034, 0.018, gx, Y(g0 + gh / 2), sd * (gw / 2 + 0.006), M.chrome, false));
        const lhh = 0.11 + cH * 0.02, bx = xf - 0.133, by = CAB_Y + 0.03;
        [-1, 1].forEach(sd => {
          const lz = sd * (CW / 2 - lwid / 2 - 0.08);
          rbox(0.04, lhh + 0.035, lwid + 0.035, xf - 0.004, Y(F.light), lz, M.chrome, 0.02);
          box(0.012, 0.014, lwid * 0.85, xf - 0.006, Y(F.light) - lhh / 2 - 0.035, lz, M.head, false);
          const fl = new T.Mesh(new T.CylinderGeometry(0.04, 0.04, 0.02, 20), M.head); fl.rotation.z = Math.PI / 2; fl.position.set(bx, by, sd * CW * 0.36); add(fl);
          box(0.006, mh * 0.82, 0.088, mx + 0.012, my, sd * (CW / 2 + 0.17), M.chrome, false);
        });
        const pl = new T.Mesh(new T.PlaneGeometry(0.52, 0.112), M.plate); pl.position.set(bx - 0.001, by, 0); pl.rotation.y = -Math.PI / 2; add(pl);
        if (kind === 'kamaz') [-0.3, 0, 0.3].forEach(zz => box(0.05, 0.035, 0.09, X(cab - 0.3), Y(cH) + 0.035, zz, M.head, false));   // огни на крыше
      }
      // рама, бак, колёса с дисками, крылья, брызговики; у Kamaz в высоком качестве задние колёса спаренные
      const xr0 = xf + 0.1, xr1 = L + 0.04, dualRear = HQ && kind === 'kamaz', twd = tw * 0.8;
      const outerZ = dualRear ? track + (tw - twd) / 2 : track, innerZ = outerZ - twd - 0.03;
      const span = ai => dualRear && ai > 0 ? { z: (outerZ + innerZ) / 2, w: 2 * twd + 0.03 } : { z: track, w: tw };
      [-1, 1].forEach(sd => box(xr1 - xr0, 0.14, 0.09, (xr0 + xr1) / 2, -0.19, sd * W * (dualRear ? 0.18 : 0.28), M.chassis));
      if (kind !== 'labo') {
        const tr = kind === 'kamaz' ? 0.25 : 0.16, tl = kind === 'kamaz' ? 1.0 : 0.6, tank = new T.Mesh(new T.CylinderGeometry(tr, tr, tl, 24), M.rim);
        tank.rotation.z = Math.PI / 2; tank.position.set((fa + ra) / 2, -0.2 - tr, W / 2 - tr - 0.12); add(tank);
      }
      if (HQ) {
        const wf = hqWheel(r, tw), wr = dualRear ? hqWheel(r, twd) : wf;
        axles.forEach((ax, ai) => [-1, 1].forEach(sd => {
          const put = (geo, m, z) => { const ms = new T.Mesh(geo, m); ms.rotation.x = sd * Math.PI / 2; ms.position.set(ax, wy, sd * z); add(ms); };
          if (ai && dualRear) [[outerZ, true], [innerZ, false]].forEach(([z, out]) => { put(wr.tire, M.rubber, z); if (out) put(wr.rim, M.rim, z); put(wr.dark, M.dark, z); });
          else { put(wf.tire, M.rubber, track); put(wf.rim, M.rim, track); put(wf.dark, M.dark, track); }
        }));
      } else {
        const tireG = new T.CylinderGeometry(r, r, tw, 32), rimG = new T.CylinderGeometry(r * 0.6, r * 0.6, tw + 0.012, 24), hubG = new T.CylinderGeometry(r * 0.18, r * 0.24, tw + 0.05, 12);
        axles.forEach(ax => [-1, 1].forEach(sd => [[tireG, M.rubber], [rimG, M.rim], [hubG, M.dark]].forEach(([geo, m]) => {
          const w = new T.Mesh(geo, m); w.rotation.x = Math.PI / 2; w.position.set(ax, wy, sd * track); add(w);
        })));
      }
      axles.slice(1).forEach(ax => [-1, 1].forEach(sd => {
        const sp = span(axles.indexOf(ax)), f = new T.Mesh(new T.CylinderGeometry(r + 0.05, r + 0.05, sp.w + 0.08, 20, 1, true, Math.PI / 2, Math.PI), M.fender);
        f.rotation.x = Math.PI / 2; f.position.set(ax, wy, sd * sp.z); add(f);
      }));
      const lastAx = axles[axles.length - 1], sl = span(axles.length - 1);
      [-1, 1].forEach(sd => box(0.015, r * 1.1, sl.w, lastAx + r + 0.14, wy + r * 0.05, sd * sl.z, M.fender));
      // задний свет и отбойник; в высоком качестве — фонарь заднего хода и номер
      [-1, 1].forEach(sd => rbox(0.05, 0.1, 0.22, L + 0.02, -0.17, sd * (W / 2 - 0.17), M.tail, 0.02, false));
      rbox(0.08, 0.08, W * 0.84, L - 0.03, wy + 0.06, 0, M.dark, 0.02);
      if (HQ) {
        [-1, 1].forEach(sd => rbox(0.05, 0.1, 0.07, L + 0.02, -0.17, sd * (W / 2 - 0.33), M.lens, 0.02, false));
        const rp = new T.Mesh(new T.PlaneGeometry(0.52, 0.112), M.plate); rp.position.set(L + 0.045, wy + 0.17, 0); rp.rotation.y = Math.PI / 2; add(rp);
      }
      if (B.flat) {
        // бортовой кузов: низкие борта, над ними — контур, до какой высоты уложен груз по объёму из «Тарифов»
        rbox(L, 0.1, W, L / 2, -0.05, 0, M.floor, 0.02);
        const sh = B.side;
        [-1, 1].forEach(sd => rbox(L, sh, 0.04, L / 2, sh / 2, sd * (W / 2 - 0.02), M.board, 0.015));
        rbox(0.04, sh, W, 0.02, sh / 2, 0, M.board, 0.015); rbox(0.04, sh, W, L - 0.02, sh / 2, 0, M.board, 0.015);
        const env = new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(L, H, W)), new T.LineBasicMaterial({ color: C.envelope, transparent: true, opacity: 0.7 }));
        env.position.set(L / 2, H / 2, 0); g.add(env);
      } else {
        // фургон: стенки как тонированное стекло (груз видно), каркас, рёбра и створки дверей
        rbox(L, 0.1, W, L / 2, -0.05, 0, M.floor, 0.02);
        const shell = new T.Mesh(new T.BoxGeometry(L, H, W), M.panel); shell.position.set(L / 2, H / 2, 0); add(shell);
        const f = 0.05, fr = (sx, sy, sz, x, y, z) => rbox(sx, sy, sz, x, y, z, M.frame, 0.015);
        [0, H].forEach(y => [-1, 1].forEach(sd => fr(L + f, f, f, L / 2, y, sd * W / 2)));
        [0, L].forEach(x => { [-1, 1].forEach(sd => fr(f, H + f, f, x, H / 2, sd * W / 2)); fr(f, f, W, x, H, 0); });
        const ribs = Math.max(1, Math.round(L / 0.9));
        for (let i = 1; i < ribs; i++) [-1, 1].forEach(sd => box(0.03, H, 0.012, L * i / ribs, H / 2, sd * W / 2, M.frame, false));
        box(0.03, H, 0.03, L + 0.01, H / 2, 0, M.frame, false);
        if (HQ) {
          // двери фургона: петли, запорные штанги с упорами и ручками, верхние габариты; тонкая красная линия по низу борта
          const xd = L + 0.035;
          [-1, 1].forEach(sd => {
            [0.15, 0.5, 0.85].forEach(t => box(0.035, 0.08, 0.06, xd - 0.005, H * t, sd * (W / 2 - 0.025), M.chrome, false));
            [0.13, 0.36].forEach(zz => {
              const bar = new T.Mesh(new T.CylinderGeometry(0.014, 0.014, H * 0.94, 10), M.chrome); bar.position.set(xd + 0.012, H / 2, sd * W * zz); add(bar);
              [0.05, 0.95].forEach(t => box(0.03, 0.05, 0.05, xd + 0.006, H * t, sd * W * zz, M.chrome, false));
              box(0.035, 0.14, 0.03, xd + 0.03, H * 0.42, sd * (W * zz + 0.045), M.chrome, false);
            });
            rbox(0.03, 0.045, 0.1, xd, H - 0.07, sd * (W / 2 - 0.1), M.tail, 0.01, false);
            box(L - 0.1, 0.028, 0.004, L / 2, 0.075, sd * (W / 2 + 0.03), M.red, false);
          });
        }
      }
      // груз: коробки по пакинг-листу — своих размеров (точка без списка — полупрозрачный блок); без списка — кубики по объёму
      const hidden = p => o.step && p <= o.step;   // уже выгруженные точки
      const cargo = [], byGeo = new Map();
      lay.boxes.forEach(q => { const key = (q.over ? 'o' : 'i') + (q.approx ? 'a' : '') + '|' + q.sx.toFixed(3) + '|' + q.sy.toFixed(3) + '|' + q.sz.toFixed(3); if (!byGeo.has(key)) byGeo.set(key, []); byGeo.get(key).push(q); });
      byGeo.forEach(list => {
        const q0 = list[0], sz = lay.byBoxes ? [q0.sx, q0.sy, q0.sz].map(v => Math.max(0.02, v - 0.012)) : [q0.sx * 0.94, q0.sy * 0.94, q0.sz * 0.94];
        const geo = o.labels || HQ ? new T.RoundedBoxGeometry(sz[0], sz[1], sz[2], 1, Math.min(sz[0], sz[1], sz[2]) * (lay.byBoxes ? 0.06 : 0.12))
          : new T.BoxGeometry(sz[0], sz[1], sz[2]);   // в обзоре коробки мелкие — скругления не видны (кроме высокого качества)
        if (HQ && !q0.approx) boxUV(geo);   // картон: скотч сверху и на торцах
        const im = new T.InstancedMesh(geo, q0.over ? M.cargoOut : q0.approx ? M.cargoApprox : M.cargo, list.length);
        im.frustumCulled = false;
        im.userData = { cells: list, pres: new Float32Array(list.length), drop: Math.min(1.2, Math.max(0.5, H * 0.6)), slide: Math.max(1.2, L * 0.35),
          base: list.map(q => new T.Vector3(q.cx, q.cy, q.cz)) };
        list.forEach((q, i) => { place(im, i, hidden(q.p) ? 0 : 1); im.setColorAt(i, tint(q, o.sel)); });
        im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
        g.add(im); cargo.push(im);
      });
      const inC = lay.boxes.filter(q => !q.over), outC = lay.boxes.filter(q => q.over);
      const loadedX = inC.length ? Math.min(L, Math.max(...inC.map(q => q.cx + q.sx / 2))) : 0, px = B.flat ? loadedX : L;
      if (px > 0) { const sh = new T.Mesh(new T.BoxGeometry(px, H, W), shadowOnly); sh.position.set(px / 2, H / 2, 0); add(sh); }
      if (outC.length) {
        const x0 = lay.byBoxes ? L : lay.n.x * lay.cell.x, x1 = Math.max(x0 + 0.05, ...outC.map(q => q.cx + q.sx / 2));
        const ob = new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(x1 - x0, H, W)), new T.LineBasicMaterial({ color: C.danger }));
        ob.position.set((x0 + x1) / 2, H / 2, 0); g.add(ob);
        if (o.labels) { const s = sprite((lay.byBoxes ? 'не помещается ' + outC.filter(q => !q.approx).length + ' кор. · ' : 'сверх кузова ') + (Math.round(lay.overM3 * 10) / 10).toString().replace('.', ',') + ' м³', { bg: C.danger, fg: '#ffffff', size: 0.34 * k }); s.position.set((x0 + x1) / 2 + 0.4, -0.45, 0); g.add(s); }
      }
      const labels = {};
      if (o.labels) {
        const sz = Math.min(0.62, Math.max(0.34, (lay.cell ? lay.cell.y : 0.35) * 1.5)) * Math.max(0.7, k);
        lay.points.forEach(p => { const s = sprite(String(p.n), { round: true, bg: colorOf(p.n), fg: light(colorOf(p.n)) ? '#1d1f20' : '#ffffff', size: sz }); s.position.set(p.x, p.top + sz * 0.55, 0); s.visible = !hidden(p.n); g.add(s); labels[p.n] = s; });
        const d = sprite(B.flat ? 'задний борт' : 'двери', { bg: C.ink, fg: '#ffffff', size: 0.3 * k }); d.position.set(L + 0.15, H + 0.3 * k, 0); g.add(d);
      }
      if (o.title) { const s = sprite(o.title, { bg: C.ink, fg: '#ffffff', size: 0.5 }); s.position.set(L / 2 - cab / 2, Math.max(H, cH) + 0.75, 0); g.add(s); }
      g.userData.parts = parts; g.userData.cargo = cargo; g.userData.labels = labels;
      g.userData.bounds = { x0: xf - 0.3, x1: L + 0.35, y0: wy - r, y1: Math.max(H, Y(cH)) + 0.1, w: Math.max(W, CW) + 0.5 };
      return g;
    }

    function clear() {
      anims = [];
      if (root) {
        root.traverse(ob => {
          if (ob.geometry) ob.geometry.dispose();
          const ms = Array.isArray(ob.material) ? ob.material : ob.material ? [ob.material] : [];
          ms.forEach(m => { if (shared.has(m)) return; if (m.map) m.map.dispose(); m.dispose(); });
        });
        scene.remove(root);
      }
      if (ground) { scene.remove(ground); ground.geometry.dispose(); ground = null; }
      if (grid) { scene.remove(grid); grid.geometry.dispose(); grid.material.dispose(); grid = null; }
      if (bays) { scene.remove(bays); bays.children.forEach(m => m.geometry.dispose()); bays = null; }
      root = null; pick = []; hits = [];
    }

    function build(spec, animate) {
      clear();
      root = new T.Group(); scene.add(root);
      const items = spec.items || [];
      let z = 0, prevW = 0, minY = -0.3;
      items.forEach((it, i) => {
        const lay = it.lay, W = lay.body.w;
        const g = truck(lay, spec.mode === 'all' ? { title: it.title } : { labels: true, step: spec.step, sel: spec.sel });
        if (i) z += prevW / 2 + 1.6 + W / 2;
        g.position.z = -z; prevW = W; g.userData.idx = it.idx; g.updateMatrix();   // первый рейс — ближе к камере: дальние машины видны над ближними
        root.add(g); pick.push(g);
        minY = Math.min(minY, wheelY(lay.body.wheel) - lay.body.wheel);
        const b = g.userData.bounds, hb = new T.Mesh(new T.BoxGeometry(b.x1 - b.x0, b.y1 - b.y0, b.w), pickMat);
        hb.position.set((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, -z); hb.visible = false; hb.userData.idx = it.idx; root.add(hb); hits.push(hb);
      });
      mergeParts(pick);
      root.position.z = z / 2;
      root.updateMatrixWorld(true);
      renderer.shadowMap.needsUpdate = true;
      if (items.length) {
        const bb = new T.Box3().setFromObject(root), sz = bb.getSize(new T.Vector3()), c = bb.getCenter(new T.Vector3());
        const size = Math.ceil(Math.max(sz.x, sz.z) + 8), rad = sz.length() / 2 + 1;
        ground = new T.Mesh(new T.CircleGeometry(size * 4, 72), M.ground);
        ground.rotation.x = -Math.PI / 2; ground.position.set(c.x, minY, c.z); ground.receiveShadow = true; scene.add(ground);
        grid = new T.GridHelper(size, size, C.grid1, C.grid2);
        grid.material.transparent = true; grid.material.opacity = HQ ? 0.35 : 0.6; grid.position.set(c.x, minY + 0.003, c.z); scene.add(grid);
        if (HQ) {
          // разметка стоянки под каждой машиной: тонкие линии по бокам и спереди. Тени в щелях — только на земле
          // вокруг машин: у горизонта они дают тёмную полосу
          bays = new T.Group();
          ground.userData.noAO = true;
          const near = new T.Mesh(new T.CircleGeometry(size * 0.8, 72), M.ground);
          near.rotation.x = -Math.PI / 2; near.position.set(c.x, minY + 0.002, c.z); near.receiveShadow = true; bays.add(near);
          const line = (sx, sz, x, zz) => { const m = new T.Mesh(new T.PlaneGeometry(sx, sz), M.bay); m.rotation.x = -Math.PI / 2; m.position.set(x, minY + 0.006, zz); m.receiveShadow = true; bays.add(m); };
          pick.forEach(g => {
            const b = g.userData.bounds, z0 = g.position.z + root.position.z, x0 = b.x0 - 0.45, x1 = b.x1 + 0.9, hw = b.w / 2 + 0.3;
            [-1, 1].forEach(sd => line(x1 - x0, 0.06, (x0 + x1) / 2, z0 + sd * hw)); line(0.06, hw * 2 + 0.06, x0, z0);
          });
          scene.add(bays);
        }
        // солнце почти сверху, чуть из-за машин: мягкие тени ложатся под машины и к зрителю
        sun.position.set(c.x - rad * 0.35, c.y + rad * 1.9, c.z - rad * 0.45); sun.target.position.copy(c); sun.target.updateMatrixWorld();
        fill.position.set(c.x + rad, c.y + rad * 0.8, c.z + rad * 1.2); fill.target.position.copy(c); fill.target.updateMatrixWorld();
        const sc = sun.shadow.camera; sc.left = -rad; sc.right = rad; sc.top = rad; sc.bottom = -rad; sc.near = 0.1; sc.far = rad * 5; sc.updateProjectionMatrix();
      }
      compile();
      // погрузка: коробки опускаются на место по порядку — от кабины к дверям
      if (animate && spec.mode !== 'all' && !still.matches) {
        pick.forEach(g => g.userData.cargo.forEach(im => {
          const n = im.count;
          for (let i = 0; i < n; i++) if (im.userData.pres[i] > 0) { place(im, i, 0); anims.push({ im, i, from: 0, to: 1, how: 'drop', delay: 120 + i / n * 650, dur: 320 }); }
          im.instanceMatrix.needsUpdate = true;
        }));
      }
    }

    // разгрузка по шагам и выбор точки — без пересборки сцены, с анимацией
    function update(spec) {
      const dur = still.matches ? 0 : 1;
      pick.forEach(g => {
        const labels = g.userData.labels;
        Object.keys(labels).forEach(n => { labels[n].visible = !(spec.step && +n <= spec.step); });
        g.userData.cargo.forEach(im => {
          const u = im.userData, cells = u.cells, maxIx = cells.reduce((a, q) => Math.max(a, q.ix), 0);
          anims = anims.filter(a => a.im !== im);
          const from = im.instanceColor.array.slice(), to = new Float32Array(from.length);
          cells.forEach((q, i) => {
            tint(q, spec.sel).toArray(to, i * 3);
            const want = spec.step && q.p <= spec.step ? 0 : 1;
            if (Math.abs(u.pres[i] - want) > 0.001) {
              if (dur) anims.push({ im, i, from: u.pres[i], to: want, how: 'slide', delay: (maxIx - q.ix) * 14, dur: 420 });
              else place(im, i, want, 'slide');
            } else if (u.pres[i] < 1 && want === 1) place(im, i, 1);
          });
          if (dur) anims.push({ im, colors: true, from, to, delay: 0, dur: 220 });
          else { im.instanceColor.array.set(to); im.instanceColor.needsUpdate = true; }
          im.instanceMatrix.needsUpdate = true; im.boundingSphere = null;
        });
      });
    }

    function fit(view, how) {
      if (!root) return;
      root.updateMatrixWorld(true);
      // кадр — по каждой машине отдельно (её габарит и груз, в том числе за дверями) и верху подписей: рамка всей
      // сцены у ряда машин по диагонали оставляет пустые углы, и машины выходят мелкими и смещёнными вниз
      const d = DIRS[view] || DIRS['3d'], dir = new T.Vector3(d[0], d[1], d[2]).normalize();
      const fwd = dir.clone().negate(), right = new T.Vector3().crossVectors(fwd, new T.Vector3(0, 1, 0)).normalize(), up = new T.Vector3().crossVectors(right, fwd);
      const pts = [], ob3 = new T.Box3(), corners = (bx, m) => { for (let i = 0; i < 8; i++) pts.push(new T.Vector3(i & 1 ? bx.max.x : bx.min.x, i & 2 ? bx.max.y : bx.min.y, i & 4 ? bx.max.z : bx.min.z).applyMatrix4(m)); };
      pick.forEach(g => {
        const b = g.userData.bounds;
        corners(ob3.set(new T.Vector3(b.x0, b.y0, -b.w / 2), new T.Vector3(b.x1, b.y1, b.w / 2)), g.matrixWorld);
        g.userData.cargo.forEach(im => { im.computeBoundingBox(); if (!im.boundingBox.isEmpty()) corners(im.boundingBox, im.matrixWorld); });
        g.traverse(ob => { if (ob.isSprite) { const pv = ob.getWorldPosition(new T.Vector3()).addScaledVector(up, ob.scale.y / 2); [-1, 1].forEach(k => pts.push(pv.clone().addScaledVector(right, k * ob.scale.x / 2))); } });   // подпись повёрнута к камере
      });
      if (!pts.length) return;
      const tv = Math.tan(camera.fov * Math.PI / 360), th = tv * camera.aspect, rel = new T.Vector3();
      const c = new T.Box3().setFromPoints(pts).getCenter(new T.Vector3());
      // расстояние, при котором все точки в кадре; центр сдвигается к середине их проекции (три шага)
      const need = () => pts.reduce((a, p) => { rel.subVectors(p, c); const z = rel.dot(fwd); return Math.max(a, Math.abs(rel.dot(right)) / th - z, Math.abs(rel.dot(up)) / tv - z); }, 1);
      let dist = need();
      for (let it = 0; it < 3; it++) {
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        pts.forEach(p => { rel.subVectors(p, c); const k = dist + rel.dot(fwd), sx = rel.dot(right) / (k * th), sy = rel.dot(up) / (k * tv); x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy); });
        c.addScaledVector(right, (x0 + x1) / 2 * dist * th).addScaledVector(up, (y0 + y1) / 2 * dist * tv);
        dist = need();
      }
      dist *= pick.length > 1 ? 1.3 : 1.12;   // поле вокруг; у нескольких машин шире — ближняя не закрывает остальные
      const to = c.clone().addScaledVector(dir, dist);
      if (how === 'jump' || still.matches) {
        tween = null; camera.position.copy(to); controls.target.copy(c); controls.update(); render(); return;
      }
      const sph = v => { const rr = v.length(); return { r: rr, ph: Math.acos(Math.max(-1, Math.min(1, v.y / rr))), th: Math.atan2(v.x, v.z) }; };
      let fromT = controls.target.clone(), fromOff = camera.position.clone().sub(controls.target);
      if (how === 'intro' || fromOff.length() < 1e-6) { fromT = c.clone(); fromOff = to.clone().sub(c).applyAxisAngle(new T.Vector3(0, 1, 0), -0.55).multiplyScalar(1.45); fromOff.y *= 0.8; }   // первый показ: подлёт сбоку
      tween = { fromT, toT: c, a: sph(fromOff), b: sph(to.clone().sub(c)), t0: null, dur: how === 'intro' ? 1100 : 650 };
      kick();
    }

    // выбор мышью или пальцем: короткое нажатие без перетаскивания
    const ray = new T.Raycaster(), ndc = new T.Vector2();
    let down = null;
    const onDown = e => { down = { x: e.clientX, y: e.clientY }; };
    const onUp = e => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) { down = null; return; }
      down = null;
      const rc = cv.getBoundingClientRect();
      ndc.set(((e.clientX - rc.left) / rc.width) * 2 - 1, -((e.clientY - rc.top) / rc.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const visible = x => !(x.object.isInstancedMesh && x.object.userData.pres && x.object.userData.pres[x.instanceId] < 0.5);
      if (cur.mode === 'all') {
        const hit = ray.intersectObjects(hits, false)[0];   // невидимые коробки вокруг машин
        if (hit && h.onPickTrip) h.onPickTrip(hit.object.userData.idx);
      } else if (h.onPickPoint) {
        // в рейсе выбираются только коробки: каркас кузова не мешает нажать на груз
        const hit = ray.intersectObjects(pick.flatMap(g => g.userData.cargo), false).filter(visible)[0];
        const q = hit && hit.instanceId != null ? hit.object.userData.cells[hit.instanceId] : null;
        h.onPickPoint(q ? q.p : null);
      }
    };
    cv.addEventListener('pointerdown', onDown); cv.addEventListener('pointerup', onUp);

    return {
      quality: HQ ? 'hq' : 'std',
      // sceneKey — какие машины на сцене; шаг разгрузки и выбранная точка меняются без пересборки
      show(spec) {
        if (disposed) return;
        const sk = spec.sceneKey != null ? spec.sceneKey : spec.contentKey, first = cur.fitKey == null, rebuilt = sk !== cur.sceneKey;
        if (rebuilt) build(spec, true);
        else if (spec.step !== cur.step || spec.sel !== cur.sel) update(spec);
        if (spec.fitKey !== cur.fitKey) { resize(); fit(spec.view, first ? 'intro' : 'fly'); }
        cur = Object.assign({}, spec, { sceneKey: sk });
        kick();
      },
      resize,
      // уход с вкладки: сцена, шейдеры и отражения остаются — при возврате ничего не собирается заново
      detach() {
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
        last = 0; tween = null;
        if (ro) ro.disconnect();
        cv.remove(); el = null;
      },
      attach(target) {
        if (disposed || !target || target === el) return;
        el = target; el.appendChild(cv);
        if (ro) { ro.disconnect(); ro.observe(el); }
        resize(); kick();
      },
      dispose() {
        if (disposed) return;
        disposed = true; clear();
        if (raf) cancelAnimationFrame(raf);
        if (ro) ro.disconnect(); else window.removeEventListener('resize', resize);
        cv.removeEventListener('pointerdown', onDown); cv.removeEventListener('pointerup', onUp);
        shared.forEach(m => m.dispose()); logoTex.forEach(t => t.dispose()); envTex.dispose();
        if (composer) { composer.passes.forEach(ps => { if (ps.dispose) ps.dispose(); }); composer.dispose(); }
        controls.dispose(); renderer.dispose(); if (renderer.forceContextLoss) renderer.forceContextLoss(); cv.remove();
      }
    };
  }

  window.LogiViz = { layout, packBoxes, bodyOf, colorOf, isLight: light, PALETTE, load, ready: () => !!T, createView, autoQuality };
})();
