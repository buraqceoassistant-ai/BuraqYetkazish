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
    // цвета сцены — из токенов design-system.css, чтобы 3D менялся вместе с оформлением сайта
    const C = { danger: tok('--color-danger', '#c0392b'), ink: tok('--color-accent-900', '#1d2d3d'), envelope: tok('--color-accent-500', '#749dc4'),
      grid1: tok('--color-neutral-300', '#b7b7ba'), grid2: tok('--color-neutral-200', '#d4d4d7'), bg: tok('--color-surface', '#f3f6fa'),
      navy: tok('--buraq-navy', '#0E2E54'), red: tok('--buraq-red', '#DE0441') };
    const still = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };   // без анимаций
    const small = Math.min(window.innerWidth, window.innerHeight) < 700;

    // Скорость: чёткость не выше 1,5 (дальше разницы почти не видно, а кадр в 2–4 раза дороже) и снижается сама,
    // если устройство не успевает; сглаживание — только на обычных экранах; на ноутбуке — мощная видеокарта.
    const hiDpi = (window.devicePixelRatio || 1) >= 1.5;
    let dpr = Math.min(window.devicePixelRatio || 1, 1.5), slow = 0;
    const renderer = new T.WebGLRenderer({ antialias: !hiDpi, powerPreference: 'high-performance' });
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
    const pmrem = new T.PMREMGenerator(renderer), room = new T.RoomEnvironment(), envTex = pmrem.fromScene(room, 0.04).texture;
    pmrem.dispose(); if (room.dispose) room.dispose();
    scene.environment = envTex; scene.environmentIntensity = 0.55;
    const camera = new T.PerspectiveCamera(38, 1, 0.05, 500);
    const controls = new T.OrbitControls(camera, cv);
    controls.enableDamping = true; controls.dampingFactor = 0.085;   // вращение с инерцией
    controls.screenSpacePanning = true; controls.maxPolarAngle = Math.PI * 0.49;
    scene.add(new T.HemisphereLight(0xffffff, 0xcfd6df, 0.75));
    const sun = new T.DirectionalLight(0xffffff, 2.3);
    sun.castShadow = true; sun.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
    sun.shadow.radius = 4; sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
    scene.add(sun, sun.target);
    const fill = new T.DirectionalLight(0xffffff, 0.9); scene.add(fill, fill.target);   // со стороны камеры, без теней
    let root = null, ground = null, grid = null, pick = [], hits = [], cur = {}, disposed = false, raf = 0, tween = null, anims = [], compiling = null;

    // общие материалы сцены: создаются один раз, освобождаются в dispose()
    // Standard — с отражениями (краска, стёкла, диски); Lambert — проще и быстрее (груз, земля, резина, рама)
    const shared = new Set(), std = o => { const m = new T.MeshStandardMaterial(o); shared.add(m); return m; };
    const lam = o => { const m = new T.MeshLambertMaterial(o); shared.add(m); return m; };
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
    const M = {
      white: std({ color: '#f3f5f8', roughness: 0.3, metalness: 0.1 }),
      navy: std({ color: C.navy, roughness: 0.34, metalness: 0.15 }),
      red: std({ color: C.red, roughness: 0.4 }),
      glass: std({ color: '#15263c', roughness: 0.06, metalness: 0.4, envMapIntensity: 1.6 }),
      rubber: lam({ color: '#1d2126' }),
      rim: std({ color: '#cdd3da', roughness: 0.28, metalness: 0.75 }),
      dark: lam({ color: '#2b3138' }),
      fender: lam({ color: '#262b31' }),
      chassis: lam({ color: '#39414a' }),
      frame: std({ color: '#e7ebf0', roughness: 0.35, metalness: 0.35 }),
      floor: lam({ color: '#9aa3ad' }),
      board: lam({ color: '#eef1f5' }),
      panel: std({ color: '#dde7f3', roughness: 0.12, transparent: true, opacity: 0.12, depthWrite: false }),
      head: std({ color: '#ffffff', emissive: '#fff3d6', emissiveIntensity: 0.9, roughness: 0.2 }),
      tail: std({ color: C.red, emissive: C.red, emissiveIntensity: 0.5, roughness: 0.3 }),
      cargo: lam({ color: '#ffffff' }),
      cargoOut: lam({ color: '#ffffff', transparent: true, opacity: 0.5, depthWrite: false }),
      cargoApprox: lam({ color: '#ffffff', transparent: true, opacity: 0.32, depthWrite: false }),   // точка без списка коробок — условный блок
      ground: lam({ color: C.bg }),
      logo: logoMat('buraq-logo.svg'),            // на белой кабине — основной
      logoWhite: logoMat('buraq-logo-white.svg')  // на синей — белый
    };
    // невидимый объём кузова: тень от машины с грузом одним блоком, а не от сотен коробок
    const shadowOnly = new T.MeshBasicMaterial({ colorWrite: false, depthWrite: false }); shared.add(shadowOnly);
    const pickMat = new T.MeshBasicMaterial(); shared.add(pickMat);   // невидимые коробки-«мишени» машин для нажатия
    const noShadow = new Set([M.glass, M.logo, M.logoWhite, M.head, M.tail, M.red, M.panel]);
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
      if (slow > 10 && dpr > 0.75) { dpr = Math.max(0.75, dpr - 0.25); renderer.setPixelRatio(dpr); slow = 0; }
      last = now;
      let moving = false;
      if (tween) moving = stepTween(now) || moving;
      if (anims.length) moving = stepAnims(now) || moving;
      if (controls.update()) moving = true;
      frame();
      renderer.render(scene, camera);
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
    const render = () => { if (!disposed && !compiling && el) { frame(); renderer.render(scene, camera); } };
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
      const extr = (pts, mat) => {
        const bt = 0.05, depth = CW - 2 * bt;
        const geo = new T.ExtrudeGeometry(new T.Shape(pts.map(([u, v]) => new T.Vector2(X(u), Y(v)))), { depth, bevelEnabled: true, bevelThickness: bt, bevelSize: 0.05, bevelOffset: -0.05, bevelSegments: 3, curveSegments: 4 });
        geo.translate(0, 0, -depth / 2);
        return add(new T.Mesh(geo, mat));
      };
      extr(clipV(prof, split, true), M.navy);
      extr(clipV(prof, split, false), navyCab ? M.navy : M.white);
      [-1, 1].forEach(sd => box(cab - 0.12, 0.035, 0.006, X(cab / 2), Y(split + 0.035), sd * (CW / 2 + 0.003), M.red, false));
      // стёкла
      const [w1, w2] = F.ws, dx = X(w2[0]) - X(w1[0]), dy = w2[1] - w1[1], wl = Math.hypot(dx, dy);
      const ws = box(wl * 0.84, 0.012, CW * 0.84, X((w1[0] + w2[0]) / 2) + dy / wl * 0.006, Y((w1[1] + w2[1]) / 2) - dx / wl * 0.006, 0, M.glass, false);
      ws.rotation.z = Math.atan2(dy, dx);
      const uAt = v => Math.min(cab, w1[0] + (w2[0] - w1[0]) * (cH - v) / (cH - w2[1]));   // передний край окна — вдоль лобового стекла
      const vb = F.belt + 0.04, vt = cH - 0.1, ur = kind === 'kamaz' ? cab * 0.42 : cab * 0.1;
      const wgeo = new T.ShapeGeometry(new T.Shape([[ur, vb], [ur, vt], [uAt(vt) - 0.08, vt], [uAt(vb) - 0.08, vb]].map(([u, v]) => new T.Vector2(X(u), Y(v)))));
      [-1, 1].forEach(sd => { const m = new T.Mesh(wgeo, M.glass); m.position.z = sd * (CW / 2 + 0.002); m.scale.z = sd; add(m, false); });
      // логотип на дверях — пропорции 526 × 181, с полем вокруг
      const lw = Math.min(cab * 0.52, (F.belt - split) * 0.6 * 526 / 181), lh = lw * 181 / 526, lgeo = new T.PlaneGeometry(lw, lh);
      [-1, 1].forEach(sd => { const m = new T.Mesh(lgeo, navyCab ? M.logoWhite : M.logo); m.position.set(X(cab * 0.42), Y((split + F.belt) / 2 + 0.02), sd * (CW / 2 + 0.004)); if (sd < 0) m.rotation.y = Math.PI; add(m); });
      // передок: фары, решётка, бампер, зеркала, ручки дверей
      const xf = X(cab), lwid = Math.min(0.3, CW * 0.18);
      [-1, 1].forEach(sd => rbox(0.05, 0.11 + cH * 0.02, lwid, xf - 0.012, Y(F.light), sd * (CW / 2 - lwid / 2 - 0.08), M.head, 0.02, false));
      rbox(0.04, F.grille[1] - F.grille[0], CW * (navyCab ? 0.62 : 0.46), xf - 0.008, Y((F.grille[0] + F.grille[1]) / 2), 0, M.dark, 0.02, false);
      rbox(0.18, 0.2 + r * 0.1, CW + 0.04, xf - 0.04, CAB_Y + 0.03, 0, M.dark, 0.05);
      const mx = X(w2[0] - 0.06), my = Y(F.belt + cH * 0.08), mh = 0.18 + cH * 0.04;
      [-1, 1].forEach(sd => {
        box(0.03, 0.03, 0.16, mx, my, sd * (CW / 2 + 0.08), M.dark, false);
        rbox(0.06, mh, 0.11, mx - 0.02, my, sd * (CW / 2 + 0.17), M.dark, 0.02);
        box(0.1, 0.022, 0.02, X(ur + 0.14), Y(F.belt - 0.1), sd * (CW / 2 + 0.008), M.dark, false);
      });
      if (kind === 'kamaz') {
        rbox(0.32, 0.05, CW * 0.94, X(w1[0]) - 0.12, Y(cH) - 0.03, 0, M.navy, 0.02);   // козырёк над стеклом
        [-1, 1].forEach(sd => [0.1, 0.36].forEach(v => rbox(0.42, 0.045, 0.14, X(cab * 0.26), Y(v), sd * (CW / 2 + 0.03), M.dark, 0.02)));   // ступеньки
      }
      // рама, бак, колёса с дисками, крылья, брызговики
      const xr0 = xf + 0.1, xr1 = L + 0.04;
      [-1, 1].forEach(sd => box(xr1 - xr0, 0.14, 0.09, (xr0 + xr1) / 2, -0.19, sd * W * 0.28, M.chassis));
      if (kind !== 'labo') {
        const tr = kind === 'kamaz' ? 0.25 : 0.16, tl = kind === 'kamaz' ? 1.0 : 0.6, tank = new T.Mesh(new T.CylinderGeometry(tr, tr, tl, 24), M.rim);
        tank.rotation.z = Math.PI / 2; tank.position.set((fa + ra) / 2, -0.2 - tr, W / 2 - tr - 0.12); add(tank);
      }
      const tireG = new T.CylinderGeometry(r, r, tw, 32), rimG = new T.CylinderGeometry(r * 0.6, r * 0.6, tw + 0.012, 24), hubG = new T.CylinderGeometry(r * 0.18, r * 0.24, tw + 0.05, 12);
      axles.forEach(ax => [-1, 1].forEach(sd => [[tireG, M.rubber], [rimG, M.rim], [hubG, M.dark]].forEach(([geo, m], j) => {
        const w = new T.Mesh(geo, m); w.rotation.x = Math.PI / 2; w.position.set(ax, wy, sd * track); add(w, j === 0 ? undefined : false);
      })));
      const fendG = new T.CylinderGeometry(r + 0.05, r + 0.05, tw + 0.08, 20, 1, true, Math.PI / 2, Math.PI);
      axles.slice(1).forEach(ax => [-1, 1].forEach(sd => { const f = new T.Mesh(fendG, M.fender); f.rotation.x = Math.PI / 2; f.position.set(ax, wy, sd * track); add(f); }));
      const lastAx = axles[axles.length - 1];
      [-1, 1].forEach(sd => box(0.015, r * 1.1, tw, lastAx + r + 0.14, wy + r * 0.05, sd * track, M.fender));
      // задний свет и отбойник
      [-1, 1].forEach(sd => rbox(0.05, 0.1, 0.22, L + 0.02, -0.17, sd * (W / 2 - 0.17), M.tail, 0.02, false));
      rbox(0.08, 0.08, W * 0.84, L - 0.03, wy + 0.06, 0, M.dark, 0.02);
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
      }
      // груз: коробки по пакинг-листу — своих размеров (точка без списка — полупрозрачный блок); без списка — кубики по объёму
      const hidden = p => o.step && p <= o.step;   // уже выгруженные точки
      const cargo = [], byGeo = new Map();
      lay.boxes.forEach(q => { const key = (q.over ? 'o' : 'i') + (q.approx ? 'a' : '') + '|' + q.sx.toFixed(3) + '|' + q.sy.toFixed(3) + '|' + q.sz.toFixed(3); if (!byGeo.has(key)) byGeo.set(key, []); byGeo.get(key).push(q); });
      byGeo.forEach(list => {
        const q0 = list[0], sz = lay.byBoxes ? [q0.sx, q0.sy, q0.sz].map(v => Math.max(0.02, v - 0.012)) : [q0.sx * 0.94, q0.sy * 0.94, q0.sz * 0.94];
        const geo = o.labels ? new T.RoundedBoxGeometry(sz[0], sz[1], sz[2], 1, Math.min(sz[0], sz[1], sz[2]) * (lay.byBoxes ? 0.06 : 0.12))
          : new T.BoxGeometry(sz[0], sz[1], sz[2]);   // в обзоре коробки мелкие — скругления не видны
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
        g.position.z = z; prevW = W; g.userData.idx = it.idx; g.updateMatrix();
        root.add(g); pick.push(g);
        minY = Math.min(minY, wheelY(lay.body.wheel) - lay.body.wheel);
        const b = g.userData.bounds, hb = new T.Mesh(new T.BoxGeometry(b.x1 - b.x0, b.y1 - b.y0, b.w), pickMat);
        hb.position.set((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, z); hb.visible = false; hb.userData.idx = it.idx; root.add(hb); hits.push(hb);
      });
      mergeParts(pick);
      root.position.z = -z / 2;
      root.updateMatrixWorld(true);
      renderer.shadowMap.needsUpdate = true;
      if (items.length) {
        const bb = new T.Box3().setFromObject(root), sz = bb.getSize(new T.Vector3()), c = bb.getCenter(new T.Vector3());
        const size = Math.ceil(Math.max(sz.x, sz.z) + 8), rad = sz.length() / 2 + 1;
        ground = new T.Mesh(new T.CircleGeometry(size * 4, 72), M.ground);
        ground.rotation.x = -Math.PI / 2; ground.position.set(c.x, minY, c.z); ground.receiveShadow = true; scene.add(ground);
        grid = new T.GridHelper(size, size, C.grid1, C.grid2);
        grid.material.transparent = true; grid.material.opacity = 0.6; grid.position.set(c.x, minY + 0.003, c.z); scene.add(grid);
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
      const bb = new T.Box3().setFromObject(root), c = bb.getCenter(new T.Vector3()), r = Math.max(bb.getSize(new T.Vector3()).length() / 2, 0.8);
      const fov = camera.fov * Math.PI / 180, dist = r / Math.sin(fov / 2) / Math.min(1, Math.max(camera.aspect, 0.55)) * 0.92;
      const d = DIRS[view] || DIRS['3d'], dir = new T.Vector3(d[0], d[1], d[2]).normalize(), to = c.clone().addScaledVector(dir, dist);
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
        controls.dispose(); renderer.dispose(); if (renderer.forceContextLoss) renderer.forceContextLoss(); cv.remove();
      }
    };
  }

  window.LogiViz = { layout, packBoxes, bodyOf, colorOf, isLight: light, PALETTE, load, ready: () => !!T, createView };
})();
