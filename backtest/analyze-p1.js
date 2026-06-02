/**
 * backtest/analyze-p1.js
 *
 * Análisis profundo del CSV de trades de P1.
 * Bucketea por múltiples dimensiones y emite tabla comparativa
 * para identificar QUE buckets ELIMINAR sin perder demasiados trades.
 *
 * Uso: node backtest/analyze-p1.js [path-to-csv]
 */

const fs = require('fs');
const path = require('path');

const CSV = process.argv[2] || path.join(__dirname, 'results', 'XAUUSD-S1-2021-2026-trades.csv');

if (!fs.existsSync(CSV)) {
  console.error('❌ No existe:', CSV);
  process.exit(1);
}

console.log('📂 Leyendo:', CSV);
const lines = fs.readFileSync(CSV, 'utf8').trim().split('\n');
const header = lines.shift().split(',');
const idx = Object.fromEntries(header.map((h, i) => [h, i]));

const trades = lines.map(line => {
  const c = line.split(',');
  return {
    entryTime:        new Date(c[idx.entryTime]),
    direction:        c[idx.direction],
    atr:              Number(c[idx.atr]),
    result:           c[idx.result],
    rMultiple:        Number(c[idx.rMultiple]),
    barsHeld:         Number(c[idx.barsHeld]),
    session:          c[idx.session],
    sweepSide:        c[idx.sweepSide],
    htfBias:          c[idx.htfBias],
    sweepDepthAtrPct: Number(c[idx.sweepDepthAtrPct] || 0),
    reclaimBars:      Number(c[idx.reclaimBars] != null ? c[idx.reclaimBars] : -1),
    stopSizePts:      Number(c[idx.stopSizePts] || 0),
  };
});

console.log(`✅ ${trades.length} trades cargados\n`);

// ─────────────────────────────────────────
// Helpers de análisis
// ─────────────────────────────────────────
function bucketize(trades, getKey) {
  const groups = {};
  for (const t of trades) {
    const k = getKey(t);
    if (k == null) continue;
    (groups[k] ||= []).push(t);
  }
  return groups;
}

function computeStats(arr) {
  if (arr.length === 0) return null;
  const wins   = arr.filter(t => t.result === 'win').length;
  const losses = arr.filter(t => t.result === 'loss').length;
  const flats  = arr.filter(t => t.result === 'flat').length;
  const decided = wins + losses;
  const totalR = arr.reduce((s, t) => s + t.rMultiple, 0);
  return {
    trades:  arr.length,
    wins, losses, flats,
    winRate: decided > 0 ? (wins / decided * 100) : 0,
    avgR:    totalR / arr.length,
    totalR,
  };
}

function tableize(title, groups, sortByTotal = true) {
  const rows = Object.entries(groups)
    .map(([k, arr]) => ({ key: k, ...computeStats(arr) }))
    .filter(r => r && r.trades >= 20);  // ignorar buckets < 20 trades
  rows.sort((a, b) => sortByTotal ? b.totalR - a.totalR : b.avgR - a.avgR);

  console.log(`\n📌 ${title}`);
  console.log('─'.repeat(70));
  console.log('  Bucket              Trades   Win%    AvgR    TotalR   Decisión');
  console.log('─'.repeat(70));
  for (const r of rows) {
    let veredict = '   →';
    if (r.avgR < -0.02) veredict = '   ❌ ELIMINAR';
    else if (r.avgR < 0.01) veredict = '   ⚠️  marginal';
    else if (r.avgR > 0.10) veredict = '   ⭐ priorizar';
    else veredict = '   ✓ ok';

    console.log(
      `  ${String(r.key).padEnd(18)}` +
      `${String(r.trades).padStart(7)}  ` +
      `${r.winRate.toFixed(1).padStart(5)}%  ` +
      `${r.avgR.toFixed(3).padStart(6)}  ` +
      `${r.totalR.toFixed(1).padStart(7)} ` +
      veredict
    );
  }
}

// ─────────────────────────────────────────
// 1 · POR SESIÓN
// ─────────────────────────────────────────
tableize('1 · POR SESIÓN', bucketize(trades, t => {
  const h = t.entryTime.getUTCHours();
  if (h >= 7 && h <= 9)   return 'London KZ';
  if (h >= 10 && h <= 11) return 'London (post-KZ)';
  if (h >= 12 && h <= 14) return 'NY KZ';
  if (h >= 15 && h <= 16) return 'NY AM (post-KZ)';
  if (h >= 17 && h <= 20) return 'NY PM';
  return 'Off-hours';
}));

// ─────────────────────────────────────────
// 2 · POR HORA UTC EXACTA
// ─────────────────────────────────────────
tableize('2 · POR HORA UTC EXACTA', bucketize(trades, t => {
  return String(t.entryTime.getUTCHours()).padStart(2, '0') + ' UTC';
}));

// ─────────────────────────────────────────
// 3 · LONG vs SHORT
// ─────────────────────────────────────────
tableize('3 · DIRECCIÓN (long vs short)', bucketize(trades, t => t.direction));

// ─────────────────────────────────────────
// 4 · DÍA DE SEMANA
// ─────────────────────────────────────────
const DOW = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
tableize('4 · DÍA DE SEMANA', bucketize(trades, t => DOW[t.entryTime.getUTCDay()]));

// ─────────────────────────────────────────
// 5 · POR RÉGIMEN ATR (cuartiles)
// ─────────────────────────────────────────
const atrs = trades.map(t => t.atr).sort((a, b) => a - b);
const q25 = atrs[Math.floor(atrs.length * 0.25)];
const q50 = atrs[Math.floor(atrs.length * 0.50)];
const q75 = atrs[Math.floor(atrs.length * 0.75)];
console.log(`\n[Quartiles ATR: q25=${q25.toFixed(2)} q50=${q50.toFixed(2)} q75=${q75.toFixed(2)}]`);
tableize('5 · POR RÉGIMEN ATR (cuartiles)', bucketize(trades, t => {
  if (t.atr < q25) return 'ATR bajo (<q25)';
  if (t.atr < q50) return 'ATR normal-bajo';
  if (t.atr < q75) return 'ATR normal-alto';
  return 'ATR extremo (>q75)';
}));

// ─────────────────────────────────────────
// 6 · POR PROFUNDIDAD DE SWEEP (% del ATR)
// ─────────────────────────────────────────
tableize('6 · POR PROFUNDIDAD DEL SWEEP (% del ATR)', bucketize(trades, t => {
  const p = t.sweepDepthAtrPct;
  if (p < 10)  return 'micro (<10%)';
  if (p < 25)  return 'small (10-25%)';
  if (p < 50)  return 'medio (25-50%)';
  if (p < 80)  return 'grande (50-80%)';
  return 'gigante (>80%)';
}));

// ─────────────────────────────────────────
// 7 · POR TAMAÑO STOP (puntos absolutos, cuartiles)
// ─────────────────────────────────────────
const stops = trades.map(t => t.stopSizePts).sort((a, b) => a - b);
const sq25 = stops[Math.floor(stops.length * 0.25)];
const sq50 = stops[Math.floor(stops.length * 0.50)];
const sq75 = stops[Math.floor(stops.length * 0.75)];
console.log(`\n[Quartiles stop pts: q25=${sq25.toFixed(2)} q50=${sq50.toFixed(2)} q75=${sq75.toFixed(2)}]`);
tableize('7 · POR TAMAÑO DE STOP (puntos)', bucketize(trades, t => {
  if (t.stopSizePts < sq25) return 'pequeño';
  if (t.stopSizePts < sq50) return 'normal-bajo';
  if (t.stopSizePts < sq75) return 'normal-alto';
  return 'grande';
}));

// ─────────────────────────────────────────
// 8 · POR TIPO DE RECLAIM (velas entre sweep y reclaim)
// ─────────────────────────────────────────
tableize('8 · POR TIPO DE RECLAIM', bucketize(trades, t => {
  if (t.reclaimBars === 0)  return 'mismo (0 velas)';
  if (t.reclaimBars === 1)  return '1 vela despues';
  if (t.reclaimBars === 2)  return '2 velas despues';
  if (t.reclaimBars >= 3)   return '3+ velas';
  return 'unknown';
}));

// ─────────────────────────────────────────
// RECOMENDACIONES
// ─────────────────────────────────────────
console.log('\n\n' + '═'.repeat(75));
console.log('🎯 RECOMENDACIONES DE FILTROS (eliminan trades malos sin sacrificar mucho)');
console.log('═'.repeat(75));

const totalTrades = trades.length;
const totalProfit = trades.reduce((s, t) => s + t.rMultiple, 0);
console.log(`\nBase P1: ${totalTrades} trades · +${totalProfit.toFixed(1)}R total · ${(trades.filter(t=>t.result==='win').length/(trades.filter(t=>t.result==='win').length+trades.filter(t=>t.result==='loss').length)*100).toFixed(1)}% winrate\n`);

// Identificar buckets a eliminar (avgR < -0.02)
const DIMS = [
  { name: 'session', fn: t => {
    const h = t.entryTime.getUTCHours();
    if (h >= 7 && h <= 9)   return 'London KZ';
    if (h >= 10 && h <= 11) return 'London (post-KZ)';
    if (h >= 12 && h <= 14) return 'NY KZ';
    if (h >= 15 && h <= 16) return 'NY AM (post-KZ)';
    if (h >= 17 && h <= 20) return 'NY PM';
    return 'Off-hours';
  }},
  { name: 'hour', fn: t => t.entryTime.getUTCHours() + ' UTC' },
  { name: 'direction', fn: t => t.direction },
  { name: 'dow', fn: t => DOW[t.entryTime.getUTCDay()] },
  { name: 'sweep depth', fn: t => {
    const p = t.sweepDepthAtrPct;
    if (p < 10) return 'micro';
    if (p < 25) return 'small';
    if (p < 50) return 'medio';
    if (p < 80) return 'grande';
    return 'gigante';
  }},
  { name: 'reclaim', fn: t => {
    if (t.reclaimBars === 0) return 'same-bar';
    if (t.reclaimBars === 1) return '1-bar';
    if (t.reclaimBars === 2) return '2-bar';
    return '3+';
  }},
];

const badBuckets = [];
for (const dim of DIMS) {
  const groups = bucketize(trades, dim.fn);
  for (const [k, arr] of Object.entries(groups)) {
    if (arr.length < 30) continue;
    const s = computeStats(arr);
    if (s.avgR < -0.02) {
      badBuckets.push({ dim: dim.name, bucket: k, ...s });
    }
  }
}
badBuckets.sort((a, b) => a.avgR - b.avgR);

console.log('Buckets PERDEDORES (avgR < -0.02, sample ≥30):\n');
console.log('  Dim         Bucket                Trades  WinR   AvgR     LossR');
console.log('  ' + '─'.repeat(65));
for (const b of badBuckets) {
  console.log(
    '  ' +
    b.dim.padEnd(11) +
    String(b.bucket).padEnd(22) +
    String(b.trades).padStart(6) +
    `  ${b.winRate.toFixed(1).padStart(5)}%` +
    `  ${b.avgR.toFixed(3).padStart(7)}` +
    `  ${b.totalR.toFixed(1).padStart(6)}R`
  );
}
console.log('');
