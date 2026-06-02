/**
 * backtest/analyze-j3-stable.js
 *
 * Análisis "regime-stable" sobre J3.
 *
 * Para CADA bucket (hora, día, sweep depth, etc) calcula métricas
 * separadas en TRAIN (2022-2024) y TEST OOS (2025-2026).
 *
 * Filtros candidatos: solo buckets que sean MALOS EN AMBOS períodos.
 * Si un bucket es malo solo en train pero bueno en OOS → es noise, NO filtrar.
 *
 * Output: ranking de filtros propuestos con esperado decay <30% si los aplicamos.
 */

const fs = require('fs');
const path = require('path');

const CSV = process.argv[2] || path.join(__dirname, 'results', 'XAUUSD-S1-2021-2026-trades.csv');

if (!fs.existsSync(CSV)) {
  console.error('❌ No existe:', CSV);
  process.exit(1);
}

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

const TRAIN_END = new Date('2025-01-01').getTime();

function isTrain(t) { return t.entryTime.getTime() < TRAIN_END; }
function isTest(t)  { return t.entryTime.getTime() >= TRAIN_END; }

console.log(`📂 ${trades.length} trades cargados`);
console.log(`   Train (2022-2024): ${trades.filter(isTrain).length}`);
console.log(`   Test  (2025-2026): ${trades.filter(isTest).length}\n`);

// ─────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────
function stats(arr) {
  if (arr.length === 0) return { trades: 0, winRate: 0, avgR: 0, totalR: 0 };
  const wins = arr.filter(t => t.result === 'win').length;
  const losses = arr.filter(t => t.result === 'loss').length;
  return {
    trades: arr.length,
    winRate: (wins + losses) > 0 ? (wins / (wins + losses) * 100) : 0,
    avgR: arr.reduce((s, t) => s + t.rMultiple, 0) / arr.length,
    totalR: arr.reduce((s, t) => s + t.rMultiple, 0),
  };
}

function bucketize(trades, getKey) {
  const g = {};
  for (const t of trades) {
    const k = getKey(t);
    if (k == null) continue;
    (g[k] ||= []).push(t);
  }
  return g;
}

function compareIsOos(title, getKey) {
  const trainTrades = trades.filter(isTrain);
  const testTrades  = trades.filter(isTest);
  const trainG = bucketize(trainTrades, getKey);
  const testG  = bucketize(testTrades, getKey);

  const keys = new Set([...Object.keys(trainG), ...Object.keys(testG)]);
  const rows = [];
  for (const k of keys) {
    const tr = stats(trainG[k] || []);
    const te = stats(testG[k]  || []);
    if (tr.trades + te.trades < 30) continue;
    rows.push({ key: k, train: tr, test: te });
  }
  rows.sort((a, b) => (a.train.avgR + a.test.avgR) - (b.train.avgR + b.test.avgR));

  console.log(`\n📌 ${title}`);
  console.log('─'.repeat(95));
  console.log('  Bucket             ' +
    'Train(N/Wr/AvgR)            Test(N/Wr/AvgR)           Verdict');
  console.log('─'.repeat(95));

  const recommendations = [];
  for (const r of rows) {
    const trainBad = r.train.avgR < 0;
    const testBad  = r.test.avgR  < 0;
    const bothBad  = trainBad && testBad;
    const onlyOne  = trainBad !== testBad;

    let verdict = '  ';
    if (bothBad)       verdict = '  ❌ ELIMINAR (mal en IS Y OOS)';
    else if (onlyOne)  verdict = '  ⚠️  noise (mal en uno solo)';
    else if (r.train.avgR > 0.3 && r.test.avgR > 0.2) verdict = '  ⭐ excelente en ambos';
    else verdict = '  ✓ ok';

    console.log(
      `  ${String(r.key).padEnd(18)}` +
      `${String(r.train.trades).padStart(4)}/${r.train.winRate.toFixed(1).padStart(4)}%/${r.train.avgR.toFixed(2).padStart(6)}    ` +
      `${String(r.test.trades).padStart(4)}/${r.test.winRate.toFixed(1).padStart(4)}%/${r.test.avgR.toFixed(2).padStart(6)}  ` +
      verdict
    );

    if (bothBad) recommendations.push({ bucket: r.key, dim: title, ...r });
  }
  return recommendations;
}

// ─────────────────────────────────────────
// CORRER TODAS LAS DIMENSIONES
// ─────────────────────────────────────────
const DOW = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
const allRecs = [];

allRecs.push(...compareIsOos('1 · HORA UTC', t => t.entryTime.getUTCHours() + ' UTC'));
allRecs.push(...compareIsOos('2 · DÍA SEMANA', t => DOW[t.entryTime.getUTCDay()]));
allRecs.push(...compareIsOos('3 · DIRECCIÓN', t => t.direction));
allRecs.push(...compareIsOos('4 · SWEEP SIDE', t => t.sweepSide));
allRecs.push(...compareIsOos('5 · SWEEP DEPTH', t => {
  const p = t.sweepDepthAtrPct;
  if (p < 10) return 'micro <10%';
  if (p < 25) return 'small 10-25%';
  if (p < 50) return 'medio 25-50%';
  if (p < 80) return 'grande 50-80%';
  return 'gigante >80%';
}));
allRecs.push(...compareIsOos('6 · RECLAIM TYPE', t => {
  if (t.reclaimBars === 0) return 'same-bar';
  if (t.reclaimBars === 1) return '1-bar';
  if (t.reclaimBars === 2) return '2-bar';
  return '3+';
}));

// ATR quartiles (de TRAIN para no leakear OOS)
const trainAtrs = trades.filter(isTrain).map(t => t.atr).sort((a, b) => a - b);
const q25 = trainAtrs[Math.floor(trainAtrs.length * 0.25)];
const q50 = trainAtrs[Math.floor(trainAtrs.length * 0.50)];
const q75 = trainAtrs[Math.floor(trainAtrs.length * 0.75)];
allRecs.push(...compareIsOos(`7 · ATR REGIMEN (cuartiles TRAIN: ${q25.toFixed(2)}/${q50.toFixed(2)}/${q75.toFixed(2)})`, t => {
  if (t.atr < q25) return 'ATR bajo';
  if (t.atr < q50) return 'ATR med-bajo';
  if (t.atr < q75) return 'ATR med-alto';
  return 'ATR alto';
}));

// ─────────────────────────────────────────
// RECOMENDACIONES FINALES
// ─────────────────────────────────────────
console.log('\n\n' + '═'.repeat(75));
console.log('🎯 BUCKETS NEGATIVOS EN AMBOS PERÍODOS (candidatos a eliminar)');
console.log('═'.repeat(75));

if (allRecs.length === 0) {
  console.log('\n✅ NINGÚN bucket es consistentemente malo en ambos períodos.');
  console.log('   J3 ya está cerca del óptimo robusto. Mejoras solo via cambios en lógica/exits.');
} else {
  console.log(`\n${allRecs.length} buckets negativos en TRAIN y TEST simultáneamente:\n`);
  for (const r of allRecs) {
    console.log(`  • [${r.dim.split('·')[1].trim()}] ${r.bucket}`);
    console.log(`    Train: ${r.train.trades} trades, ${r.train.winRate.toFixed(1)}% wr, AvgR ${r.train.avgR.toFixed(3)}`);
    console.log(`    Test:  ${r.test.trades} trades, ${r.test.winRate.toFixed(1)}% wr, AvgR ${r.test.avgR.toFixed(3)}\n`);
  }
}
