/**
 * backtest/test-nas100.js
 * Corre las 4 estrategias base + S8-SPX sobre NAS100 con data completa.
 */
const { spawnSync } = require('child_process');
const path = require('path');
const { STRATEGIES } = require('../server/bot/strategies/registry');

const STRATEGY_IDS = ['J3', 'P1', 'PA1', 'PA3', 'S8-SPX'];
const TO_TEST = STRATEGIES.filter(s => STRATEGY_IDS.includes(s.id));

const PERIODS = [
  { name: 'FULL',  from: '2022-01-01', to: '2026-12-31' },
  { name: 'TRAIN', from: '2022-01-01', to: '2024-12-31' },
  { name: 'TEST',  from: '2025-01-01', to: '2026-12-31' },
];

function runOne(env) {
  const child = spawnSync('node', [path.join(__dirname, 'run.js'), 'NAS100'], { env, encoding: 'utf8' });
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

console.log('🧪 TESTING 5 STRATEGIES ON NAS100\n');

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
  results.push({ id: strat.id, name: strat.name, full: periodResults.FULL, train: periodResults.TRAIN, test: periodResults.TEST, decay });
}

console.log('\n\n' + '═'.repeat(120));
console.log('📊 NAS100 — transferencia de estrategias');
console.log('═'.repeat(120));
console.log(
  'Strat'.padEnd(10) +
  'Trades'.padStart(8) +
  'IS WR'.padStart(9) +
  'OS WR'.padStart(9) +
  'IS AvgR'.padStart(10) +
  'OS AvgR'.padStart(10) +
  'OS TotR'.padStart(10) +
  'OS DD'.padStart(8) +
  'Decay'.padStart(10) +
  '  Verdict'
);
console.log('─'.repeat(120));
for (const r of results) {
  let verdict = '';
  if (r.test.avgR > 0 && Math.abs(r.decay) < 25) verdict = '  ⭐ excelente';
  else if (r.test.avgR > 0 && Math.abs(r.decay) < 50) verdict = '  ✓ ok';
  else if (r.test.avgR > 0) verdict = '  ⚠ marginal';
  else verdict = '  ❌ neg OOS';
  console.log(
    r.id.padEnd(10) +
    String(r.full.trades).padStart(8) +
    (r.train.winRate.toFixed(1) + '%').padStart(9) +
    (r.test.winRate.toFixed(1) + '%').padStart(9) +
    r.train.avgR.toFixed(3).padStart(10) +
    r.test.avgR.toFixed(3).padStart(10) +
    r.test.totalR.toFixed(1).padStart(10) +
    r.test.maxDD.toFixed(1).padStart(8) +
    (r.decay.toFixed(1) + '%').padStart(10) +
    verdict
  );
}
console.log('═'.repeat(120) + '\n');
