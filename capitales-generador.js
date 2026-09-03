// capitales-generador.js
// Motor del juego "ordenar capitales" -- versión navegador (sin Node).
// Genera el puzzle del día en el propio cliente, en base a la fecha, igual que
// el resto de tus juegos con semilla mulberry32.
//
// Uso:
//   const gen = window.CapitalesGen;
//   gen.init(dbArray);                     // una vez, con el JSON ya cargado
//   const dayIndex = gen.dayIndexFromDate(new Date());
//   const puzzle = gen.generatePuzzle(dayIndex);
//   const datosCompletos = gen.getCapital('España');

(function (global) {
  'use strict';

  // ---------- PRNG (mulberry32, igual que en tus otros juegos) ----------
  function mulberry32(seed) {
    let a = seed;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ---------- Datos (se rellenan con init()) ----------
  let DB = [], NAMES = [], IDX = {};

  function init(dbArray) {
    DB = dbArray;
    NAMES = DB.map(d => d.pais);
    IDX = Object.fromEntries(DB.map(d => [d.pais, d]));
  }

  // ---------- Criterios ----------
  function cmpVal(a, b, key) {
    const va = a[key], vb = b[key];
    if (va == null || vb == null) return null;
    if (va > vb) return '>';
    if (va < vb) return '<';
    return '=';
  }

  const ORDINAL = {
    lat:       (a, b) => cmpVal(a, b, 'lat'),
    lng:       (a, b) => cmpVal(a, b, 'lng'),
    poblacion: (a, b) => cmpVal(a, b, 'poblacion_pais'),
    area:      (a, b) => cmpVal(a, b, 'area_km2'),
    densidad:  (a, b) => cmpVal(a, b, 'densidad'),
    utc:       (a, b) => cmpVal(a, b, 'utc_offset'),
    fronteras: (a, b) => cmpVal(a, b, 'num_fronteras'),
    // altitud: pendiente (sin datos todavía) - no se incluye en el pool activo
  };

  function compartenBandera(a, b) {
    const ca = new Set(a.bandera_colores.filter(c => c.pct >= 15).map(c => c.hex));
    const cb = new Set(b.bandera_colores.filter(c => c.pct >= 15).map(c => c.hex));
    for (const h of ca) if (cb.has(h)) return true;
    return false;
  }
  function compartenFrontera(a, b) { return a.fronteras.includes(b.cca3); }
  function compartenIdioma(a, b) {
    const sa = new Set(a.idiomas);
    return b.idiomas.some(i => sa.has(i));
  }

  const CATEGORICAL = {
    bandera: compartenBandera,
    frontera: compartenFrontera,
    idioma: compartenIdioma,
  };

  const ALL_CRITERIA = [...Object.keys(ORDINAL), ...Object.keys(CATEGORICAL)];

  // etiquetas en español para mostrar en la interfaz
  const LABELS = {
    lat: 'Norte / Sur', lng: 'Este / Oeste', poblacion: 'Población',
    area: 'Tamaño del país', densidad: 'Densidad', utc: 'Desfase horario',
    fronteras: 'Nº de fronteras', bandera: 'Bandera', frontera: 'Países vecinos',
    idioma: 'Idioma oficial',
  };

  function relationsTrueFor(a, b) {
    const out = [];
    for (const crit of Object.keys(ORDINAL)) {
      const r = ORDINAL[crit](a, b);
      if (r) out.push([crit, r]);
    }
    for (const crit of Object.keys(CATEGORICAL)) {
      if (CATEGORICAL[crit](a, b)) out.push([crit, true]);
    }
    return out;
  }

  function evalCriterion(crit, a, b) {
    return crit in ORDINAL ? ORDINAL[crit](a, b) : CATEGORICAL[crit](a, b);
  }

  function satisfies(order, slots) {
    for (let i = 0; i < slots.length; i++) {
      const [crit, rel] = slots[i];
      if (evalCriterion(crit, order[i], order[i + 1]) !== rel) return false;
    }
    return true;
  }

  function permutations(arr) {
    if (arr.length <= 1) return [arr];
    const out = [];
    for (let i = 0; i < arr.length; i++) {
      const rest = arr.slice(0, i).concat(arr.slice(i + 1));
      for (const p of permutations(rest)) out.push([arr[i], ...p]);
    }
    return out;
  }

  function countValidOrders(allPerms, slots, limit = 2) {
    let cnt = 0;
    for (const perm of allPerms) {
      if (satisfies(perm, slots)) {
        cnt++;
        if (cnt >= limit) return cnt;
      }
    }
    return cnt;
  }

  function strength(crit, caps6) {
    let cnt = 0;
    for (const x of caps6) for (const y of caps6) {
      if (x === y) continue;
      if (crit in ORDINAL) { if (ORDINAL[crit](x, y) !== null) cnt++; }
      else { if (CATEGORICAL[crit](x, y)) cnt++; }
    }
    return cnt;
  }

  function tryGenerate(caps6, rng, maxOrders = 720, maxCritTriesPerOrder = 40) {
    const basePerms = permutations(caps6);
    const allPerms = shuffle(basePerms, rng);
    const strengths = {};
    for (const c of ALL_CRITERIA) strengths[c] = strength(c, caps6);

    for (let oi = 0; oi < Math.min(maxOrders, allPerms.length); oi++) {
      const order = allPerms[oi];
      for (let t = 0; t < maxCritTriesPerOrder; t++) {
        const slots = [];
        const counts = {};
        let ok = true;
        for (let i = 0; i < 5; i++) {
          const opciones = shuffle(relationsTrueFor(order[i], order[i + 1]), rng)
            .sort((x, y) => (strengths[x[0]] - strengths[y[0]]) + (rng() - 0.5) * 2);
          let picked = null;
          for (const [crit, rel] of opciones) {
            if ((counts[crit] || 0) < 3) { picked = [crit, rel]; break; }
          }
          if (!picked) { ok = false; break; }
          slots.push(picked);
          counts[picked[0]] = (counts[picked[0]] || 0) + 1;
        }
        if (!ok) continue;
        if (countValidOrders(basePerms, slots, 2) === 1) return { order, slots };
      }
    }
    return null;
  }

  function generateWithFallback(caps6, rng, reservePool) {
    let res = tryGenerate(caps6, rng);
    if (res) return { ...res, swaps: 0 };

    const candidatos = shuffle(reservePool.concat(shuffle(NAMES, rng)), rng);
    for (let swapPos = 0; swapPos < 6; swapPos++) {
      for (const nombre of candidatos) {
        const candidato = IDX[nombre];
        if (caps6.includes(candidato)) continue;
        const nuevo6 = caps6.slice();
        nuevo6[swapPos] = candidato;
        res = tryGenerate(nuevo6, rng, 150, 25);
        if (res) return { ...res, swaps: swapPos + 1, capitalesFinales: nuevo6 };
      }
    }
    return null; // extremadamente improbable
  }

  // ---------- Rotación día a día ----------
  const MASTER_SEED = 20260101;
  const GROUP_SIZE = 6;

  function perLap() { return Math.floor(NAMES.length / GROUP_SIZE); }

  function lapShuffle(lap) {
    const rng = mulberry32((MASTER_SEED + lap * 7919) >>> 0);
    return shuffle(NAMES, rng);
  }

  function capitalsForDay(dayIndex) {
    const pl = perLap();
    const lap = Math.floor(dayIndex / pl);
    const dayInLap = dayIndex % pl;
    const pool = lapShuffle(lap);
    const start = dayInLap * GROUP_SIZE;
    return pool.slice(start, start + GROUP_SIZE).map(n => IDX[n]);
  }

  function reservePoolForDay(dayIndex) {
    const pl = perLap();
    const lap = Math.floor(dayIndex / pl);
    const pool = lapShuffle(lap);
    return pool.slice(pl * GROUP_SIZE);
  }

  // ---------- Punto de entrada ----------
  function generatePuzzle(dayIndex) {
    const caps6 = capitalsForDay(dayIndex);
    const reserve = reservePoolForDay(dayIndex);
    const rng = mulberry32((dayIndex * 2654435761) >>> 0);
    const res = generateWithFallback(caps6, rng, reserve);
    if (!res) throw new Error(`No se encontró solución única para el día ${dayIndex}`);

    const capitalesFinales = res.capitalesFinales || caps6;
    return {
      dia: dayIndex,
      capitales_mostradas: shuffle(capitalesFinales, rng).map(c => c.pais),
      solucion: res.order.map(c => c.pais),
      criterios: res.slots.map(([crit, rel]) => ({ criterio: crit, relacion: rel })),
      swaps_usados: res.swaps,
    };
  }

  // fecha -> índice de día (entero), usando fecha LOCAL del jugador (no UTC),
  // para que el puzzle cambie a medianoche de su propio huso horario.
  function dayIndexFromDate(date) {
    const epoch = new Date(2026, 0, 1); // 1 ene 2026 = día 0
    const d0 = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    return Math.round((d0 - epoch) / 86400000);
  }

  function getCapital(pais) { return IDX[pais]; }

  const api = {
    init, generatePuzzle, capitalsForDay, dayIndexFromDate, getCapital,
    mulberry32, ALL_CRITERIA, LABELS, evalCriterion,
  };
  global.CapitalesGen = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : global);
