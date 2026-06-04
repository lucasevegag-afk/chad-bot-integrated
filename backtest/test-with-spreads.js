/**
 * backtest/test-with-spreads.js
 *
 * Aplica spreads reales de Exness Pro a las 5 estrategias más prometedoras
 * y compara performance ANTES vs DESPUÉS del spread.
 *
 * Spreads Exness Pro típicos (en unidades de precio):
 *   XAU/USD:  $0.25  (25 cents oro round-trip)
 *   BTC/USD:  $30    (BTC tiene spreads variables, conservador)
 *   EUR/USD:  0.00007 (0.7 pip)
 *   GBP/USD:  0.0001  (1.0 pip)
 *   USD/CAD:  0.0001  (1.0 pip)
 *   USD/JPY:  0.007   (0.7 pip JPY)
 *   AUD/USD:  0.00008 (0.8 pip)
 *   GBP/AUD:  0.00015 (1.5 pip, cross más amplio)
 *   NAS100:   1.5     (1.5 puntos)
 *   SPX500:   0.5     (0.5 puntos)
 */
const { spawnSync } = require('child_process');
const path = require('path');
const { STRATEGIES } = require('../server/bot/strategies/registry');

const EXNESS_PRO_SPREADS = {
  XAUUSD:  0.25,
  BTCUSDT: 30,
  EURUSD:  0.00007,
  GBPUSD:  0.0001,
  USDCAD:  0.0001,
  USDJPY:  0.007,
  AUDUSD:  0.00008,
  GBPAUD:  0.00015,
  NAS100:  1.5,
  SPX500:  0.5,
};

// Las 5 más prometedoras según análisis Claude
// + J3 (TPs amplios, más resistente a spread)
const PICKS = ['PA3', 'PA1', 'PA3-BTC', 'PA1-GBP', 'PA1-CAD', 'J3', 'J3-BTC', 'J3-GBP', 'J3-CAD'];

const PERIODS = [
  { name: 'TRAIN', from: '2022-01-01', to: '2024-12-31' },
  { name: 'TEST',  from: '2025-01-01', to: '2026-12-31' },
];

function runOne(env, asset) {
  const child = spawnSync('node', [path.join(__dirname, 'run.js'), asset], { env, encoding: 'utf8' });
  const out = child.stdout || '';
  const grab = (re, fb = '0') => { const m = out.match(re); return m ? m[1].trim() : fb; };
  return {
    trades:  Number(grab(/Trades:\s+(\d+)/)),
    winRate: Number(grab(/Wins:\s+\d+\s+\(([\d.]+)%\)/)),
    avgR:    Number(grab(/Avg R:\s+([\d.-]+)/)),
    totalR:  Number(grab(/Total R:\s+([\d.-]+)/)),
    maxDD:   Number(grab(/Max DD:\s+([\d.-]+)/)),
  };
}

const results = [];

for (const id of PICKS) {
  const strat = STRATEGIES.find(s => s.id === id);
  if (!strat) { console.error('NOT FOUND:', id); continue; }

  const spread = EXNESS_PRO_SPREADS[strat.asset] || 0;
  console.log(`\n🧪 ${id} (${strat.asset}) · Exness spread = ${spread}`);

  const periodResults = { NO_SPREAD: {}, WITH_SPREAD: {} };

  for (const p of PERIODS) {
    // Sin spread
    const envNoSp = { ...process.env, ...strat.config, S1_DATE_FROM: p.from, S1_DATE_TO: p.to, S1_SPREAD: '0' };
    periodResults.NO_SPREAD[p.name] = runOne(envNoSp, strat.asset);

    // Con spread Exness
    const envSp = { ...process.env, ...strat.config, S1_DATE_FROM: p.from, S1_DATE_TO: p.to, S1_SPREAD: String(spread) };
    periodResults.WITH_SPREAD[p.name] = runOne(envSp, strat.asset);

    console.log(`   ${p.name}: NO=${periodResults.NO_SPREAD[p.name].totalR.toFixed(1)}R · CON=${periodResults.WITH_SPREAD[p.name].totalR.toFixed(1)}R · diff=${(periodResults.WITH_SPREAD[p.name].totalR - periodResults.NO_SPREAD[p.name].totalR).toFixed(1)}R`);
  }

  results.push({
    id, asset: strat.asset, spread,
    noSpread: periodResults.NO_SPREAD,
    withSpread: periodResults.WITH_SPREAD,
  });
}

// Tabla comparativa final
console.log('\n\n' + '═'.repeat(135));
console.log('📊 IMPACTO DEL SPREAD EXNESS PRO · 5 estrategias más prometedoras');
console.log('═'.repeat(135));
console.log(
  'Strategy'.padEnd(15) +
  'Activo'.padEnd(10) +
  'Spread'.padStart(10) +
  '  │  ' +
  'TRAIN noSp'.padStart(12) +
  'TRAIN spr'.padStart(12) +
  'Δ'.padStart(8) +
  '  │  ' +
  'TEST noSp'.padStart(11) +
  'TEST spr'.padStart(11) +
  'Δ'.padStart(8) +
  '  │  ' +
  'Veredict OOS'
);
console.log('─'.repeat(135));

for (const r of results) {
  const trNoR = r.noSpread.TRAIN.totalR;
  const trSpR = r.withSpread.TRAIN.totalR;
  const teNoR = r.noSpread.TEST.totalR;
  const teSpR = r.withSpread.TEST.totalR;
  const trDelta = trSpR - trNoR;
  const teDelta = teSpR - teNoR;

  let verdict = '';
  if (teSpR > 30) verdict = '✅ Aguanta spread (rentable)';
  else if (teSpR > 0) verdict = '⚠️  Marginal con spread';
  else verdict = '❌ Spread la mata';

  console.log(
    r.id.padEnd(15) +
    r.asset.padEnd(10) +
    String(r.spread).padStart(10) +
    '  │  ' +
    (trNoR.toFixed(1) + 'R').padStart(12) +
    (trSpR.toFixed(1) + 'R').padStart(12) +
    ((trDelta>0?'+':'') + trDelta.toFixed(1)).padStart(8) +
    '  │  ' +
    (teNoR.toFixed(1) + 'R').padStart(11) +
    (teSpR.toFixed(1) + 'R').padStart(11) +
    ((teDelta>0?'+':'') + teDelta.toFixed(1)).padStart(8) +
    '  │  ' +
    verdict
  );
}
console.log('═'.repeat(135));

// AvgR comparison
console.log('\n📊 AvgR por trade (cómo afecta el spread)');
console.log('─'.repeat(95));
console.log(
  'Strategy'.padEnd(15) +
  'noSpread Train'.padStart(16) +
  'withSpread Tr'.padStart(15) +
  'noSpread Test'.padStart(15) +
  'withSpread Te'.padStart(15) +
  'Loss %'.padStart(12)
);
console.log('─'.repeat(95));
for (const r of results) {
  const trNo = r.noSpread.TRAIN.avgR;
  const trSp = r.withSpread.TRAIN.avgR;
  const teNo = r.noSpread.TEST.avgR;
  const teSp = r.withSpread.TEST.avgR;
  const lossPct = teNo !== 0 ? ((1 - teSp / teNo) * 100).toFixed(1) : 'N/A';

  console.log(
    r.id.padEnd(15) +
    (trNo.toFixed(3)+'R').padStart(16) +
    (trSp.toFixed(3)+'R').padStart(15) +
    (teNo.toFixed(3)+'R').padStart(15) +
    (teSp.toFixed(3)+'R').padStart(15) +
    (lossPct + '%').padStart(12)
  );
}
console.log('─'.repeat(95));
