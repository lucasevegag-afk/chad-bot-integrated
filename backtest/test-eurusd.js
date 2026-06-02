/**
 * backtest/test-eurusd.js
 *
 * Corre las 4 estrategias del registry sobre EUR/USD para ver si el edge
 * transfiere. Mide IS/OOS y decay (igual que en XAU/USD).
 *
 * Si las estrategias rinden similar en EUR/USD → edge genérico de FX.
 * Si rinden muy distinto → edge específico de XAU/USD (régimen, volatilidad).
 */

const { spawnSync } = require('child_process');
const path = require('path');
const { STRATEGIES } = require('../server/bot/strategies/registry');

// Solo las 4 estrategias XAU/USD (las usamos en EUR/USD para comparar)
const STRATEGY_IDS = ['J3', 'P1', 'PA1', 'PA3'];
const TO_TEST = STRATEGIES.filter(s => STRATEGY_IDS.includes(s.id));

const PERIODS = [
  { name: 'FULL',  from: '2022-01-01', to: '2026-12-31' },
  { name: 'TRAIN', from: '2022-01-01', to: '2024-12-31' },
  { name: 'TEST',  from: '2025-01-01', to: '2026-12-31' },
];

function runOne(env) {
  const child = spawnSync('node', [path.join(__dirname, 'run.js'), 'EURUSD'], {
    env, encoding: 'utf8',
  });
  const out = child.stdout || '';
  const grab = (re, fb = '0') => {
    const m = out.match(re);
    return m ? m[1].trim() : fb;
  };
  return {
    trades:  Number(grab(/Trades:\s+(\d+)/)),
    winRate: Number(grab(/Wins:\s+\d+\s+\(([\d.]+)%\)/)),
    avgR:    Number(grab(/Avg R:\s+([\d.-]+)/)),
    totalR:  Number(grab(/Total R:\s+([\d.-]+)/)),
    maxDD:   Number(grab(/Max DD:\s+([\d.-]+)/)),
  };
}

console.log('🧪 TESTING 4 STRATEGIES ON EUR/USD\n');
console.log('Estrategias originales (medidas en XAU/USD):');
for (const s of TO_TEST) {
  console.log(`  ${s.id}: ${s.metrics.winRate_OS}% wr · +${s.metrics.totalR_5y}R · decay ${s.metrics.decay_pct}%`);
}
console.log('');

const results = [];

for (const strat of TO_TEST) {
  console.log(`\n🧪 ${strat.id} — ${strat.name}`);

  const periodResults = {};
  for (const p of PERIODS) {
    const env = {
      ...process.env,
      ...strat.config,
      S1_DATE_FROM: p.from,
      S1_DATE_TO:   p.to,
    };
    periodResults[p.name] = runOne(env);
    console.log(`   ${p.name}: ${periodResults[p.name].trades} trades · ${periodResults[p.name].winRate}% wr · AvgR ${periodResults[p.name].avgR.toFixed(3)}`);
  }

  const decay = periodResults.TRAIN.avgR > 0
    ? ((periodResults.TEST.avgR - periodResults.TRAIN.avgR) / periodResults.TRAIN.avgR * 100)
    : 0;

  results.push({
    id: strat.id,
    name: strat.name,
    xauOriginal: strat.metrics,
    eurFull:  periodResults.FULL,
    eurTrain: periodResults.TRAIN,
    eurTest:  periodResults.TEST,
    eurDecay: decay,
  });
}

console.log('\n\n' + '═'.repeat(120));
console.log('📊 EUR/USD vs XAU/USD — comparativa de transferencia de edge');
console.log('═'.repeat(120));
console.log(
  'Strat'.padEnd(8) +
  'XAU WR OS'.padStart(11) +
  'XAU TotR'.padStart(10) +
  'XAU Decay'.padStart(11) +
  '  │  ' +
  'EUR Trades'.padStart(11) +
  'EUR WR IS'.padStart(11) +
  'EUR WR OS'.padStart(11) +
  'EUR TotR'.padStart(10) +
  'EUR Decay'.padStart(11) +
  '  Verdict'
);
console.log('─'.repeat(120));
for (const r of results) {
  let verdict = '';
  if (r.eurTest.avgR > 0 && Math.abs(r.eurDecay) < 35) verdict = '  ⭐ transfiere bien';
  else if (r.eurTest.avgR > 0) verdict = '  ✓ transfiere';
  else if (r.eurFull.totalR > 0) verdict = '  ⚠️  marginal';
  else verdict = '  ❌ no transfiere';

  console.log(
    r.id.padEnd(8) +
    (r.xauOriginal.winRate_OS.toFixed(1) + '%').padStart(11) +
    (r.xauOriginal.totalR_5y.toFixed(0) + 'R').padStart(10) +
    (r.xauOriginal.decay_pct.toFixed(1) + '%').padStart(11) +
    '  │  ' +
    String(r.eurFull.trades).padStart(11) +
    (r.eurTrain.winRate.toFixed(1) + '%').padStart(11) +
    (r.eurTest.winRate.toFixed(1) + '%').padStart(11) +
    (r.eurFull.totalR.toFixed(0) + 'R').padStart(10) +
    (r.eurDecay.toFixed(1) + '%').padStart(11) +
    verdict
  );
}
console.log('═'.repeat(120) + '\n');

// Análisis
console.log('🔍 ANÁLISIS\n');
const transferOk = results.filter(r => r.eurTest.avgR > 0 && r.eurFull.totalR > 0);
const transferBad = results.filter(r => r.eurFull.totalR <= 0);

if (transferOk.length === results.length) {
  console.log('   ✅ Las 4 estrategias rinden positivo en EUR/USD → edge es genérico de FX/sweep institucional');
} else if (transferOk.length > 0) {
  console.log(`   ✓ ${transferOk.length}/${results.length} estrategias transfieren a EUR/USD`);
  console.log(`     OK: ${transferOk.map(r => r.id).join(', ')}`);
  if (transferBad.length) console.log(`     Fallaron: ${transferBad.map(r => r.id).join(', ')}`);
} else {
  console.log('   ❌ Ninguna transfiere → edge es específico de XAU/USD');
}
