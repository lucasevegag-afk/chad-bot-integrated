/**
 * backtest/test-spx500.js
 * Corre las 4 estrategias del registry sobre SPX500.
 */
const { spawnSync } = require('child_process');
const path = require('path');
const { STRATEGIES } = require('../server/bot/strategies/registry');

const STRATEGY_IDS = ['J3', 'P1', 'PA1', 'PA3'];
const TO_TEST = STRATEGIES.filter(s => STRATEGY_IDS.includes(s.id));

const PERIODS = [
  { name: 'FULL',  from: '2022-01-01', to: '2026-12-31' },
  { name: 'TRAIN', from: '2022-01-01', to: '2024-12-31' },
  { name: 'TEST',  from: '2025-01-01', to: '2026-12-31' },
];

function runOne(env) {
  const child = spawnSync('node', [path.join(__dirname, 'run.js'), 'SPX500'], { env, encoding: 'utf8' });
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

console.log('🧪 TESTING 4 STRATEGIES ON SPX500 (342k velas M5)\n');

const results = [];
for (const strat of TO_TEST) {
  console.log(`\n🧪 ${strat.id} — ${strat.name}`);
  const periodResults = {};
  for (const p of PERIODS) {
    const env = { ...process.env, ...strat.config, S1_DATE_FROM: p.from, S1_DATE_TO: p.to };
    periodResults[p.name] = runOne(env);
    console.log(`   ${p.name}: ${periodResults[p.name].trades} trades · ${periodResults[p.name].winRate}% wr · AvgR ${periodResults[p.name].avgR.toFixed(3)}`);
  }
  const decay = periodResults.TRAIN.avgR !== 0
    ? ((periodResults.TEST.avgR - periodResults.TRAIN.avgR) / Math.abs(periodResults.TRAIN.avgR) * 100)
    : 0;
  results.push({ id: strat.id, name: strat.name, xau: strat.metrics, full: periodResults.FULL, train: periodResults.TRAIN, test: periodResults.TEST, decay });
}

console.log('\n\n' + '═'.repeat(120));
console.log('📊 SPX500 vs XAU/USD — transferencia');
console.log('═'.repeat(120));
console.log(
  'Strat'.padEnd(8) +
  'XAU WR'.padStart(9) +
  'XAU TotR'.padStart(10) +
  '  │  ' +
  'SPX Trades'.padStart(12) +
  'SPX WR IS'.padStart(11) +
  'SPX WR OS'.padStart(11) +
  'SPX TotR'.padStart(10) +
  'SPX DD'.padStart(9) +
  'SPX Decay'.padStart(11) +
  '  Verdict'
);
console.log('─'.repeat(120));
for (const r of results) {
  let verdict = '';
  if (r.test.avgR > 0 && Math.abs(r.decay) < 35) verdict = '  ⭐ transfiere';
  else if (r.test.avgR > 0) verdict = '  ✓ ok marginal';
  else if (r.full.totalR > 0) verdict = '  ⚠️  IS+OOS mixto';
  else verdict = '  ❌ no transfiere';
  console.log(
    r.id.padEnd(8) +
    (r.xau.winRate_OS.toFixed(1) + '%').padStart(9) +
    (r.xau.totalR_5y.toFixed(0) + 'R').padStart(10) +
    '  │  ' +
    String(r.full.trades).padStart(12) +
    (r.train.winRate.toFixed(1) + '%').padStart(11) +
    (r.test.winRate.toFixed(1) + '%').padStart(11) +
    (r.full.totalR.toFixed(0) + 'R').padStart(10) +
    (r.full.maxDD.toFixed(0) + 'R').padStart(9) +
    (r.decay.toFixed(1) + '%').padStart(11) +
    verdict
  );
}
console.log('═'.repeat(120) + '\n');
