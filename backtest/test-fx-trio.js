/**
 * backtest/test-fx-trio.js
 * Test estrategias main (J3, P1, PA1, PA3, S8) sobre GBPUSD, AUDUSD, GBPAUD.
 */
const { spawnSync } = require('child_process');
const path = require('path');
const { STRATEGIES } = require('../server/bot/strategies/registry');

const ASSETS = ['GBPUSD', 'AUDUSD', 'GBPAUD'];
const STRATEGY_IDS = ['J3', 'P1', 'PA1', 'PA3', 'S8-SPX'];
const TO_TEST = STRATEGIES.filter(s => STRATEGY_IDS.includes(s.id));

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

const allResults = {};

for (const asset of ASSETS) {
  console.log('\n' + '═'.repeat(80));
  console.log(`🧪 TESTING 5 STRATEGIES ON ${asset}`);
  console.log('═'.repeat(80));

  const results = [];
  for (const strat of TO_TEST) {
    console.log(`\n🧪 ${strat.id}`);
    const periodResults = {};
    for (const p of PERIODS) {
      const env = { ...process.env, ...strat.config, S1_DATE_FROM: p.from, S1_DATE_TO: p.to };
      periodResults[p.name] = runOne(env, asset);
      console.log(`   ${p.name}: ${periodResults[p.name].trades} trades · ${periodResults[p.name].winRate}% wr · AvgR ${periodResults[p.name].avgR.toFixed(3)}`);
    }
    const decay = periodResults.TRAIN.avgR !== 0
      ? ((periodResults.TEST.avgR - periodResults.TRAIN.avgR) / Math.abs(periodResults.TRAIN.avgR) * 100)
      : 0;
    results.push({ id: strat.id, train: periodResults.TRAIN, test: periodResults.TEST, decay });
  }
  allResults[asset] = results;
}

// ─── Tabla consolidada ───
for (const [asset, results] of Object.entries(allResults)) {
  console.log('\n\n' + '═'.repeat(115));
  console.log(`📊 ${asset} — estrategias main`);
  console.log('═'.repeat(115));
  console.log(
    'Strat'.padEnd(10) +
    'IS Trades'.padStart(11) +
    'IS WR'.padStart(8) +
    'OS WR'.padStart(8) +
    'IS AvgR'.padStart(10) +
    'OS AvgR'.padStart(10) +
    'OS TotR'.padStart(10) +
    'OS DD'.padStart(8) +
    'Decay'.padStart(10) +
    '  Verdict'
  );
  console.log('─'.repeat(115));
  for (const r of results) {
    let verdict = '';
    if (r.test.avgR > 0 && Math.abs(r.decay) < 25) verdict = '  ⭐ excelente';
    else if (r.test.avgR > 0 && Math.abs(r.decay) < 50) verdict = '  ✓ ok';
    else if (r.test.avgR > 0) verdict = '  ⚠ marginal';
    else verdict = '  ❌ neg OOS';
    console.log(
      r.id.padEnd(10) +
      String(r.train.trades).padStart(11) +
      (r.train.winRate.toFixed(1) + '%').padStart(8) +
      (r.test.winRate.toFixed(1) + '%').padStart(8) +
      r.train.avgR.toFixed(3).padStart(10) +
      r.test.avgR.toFixed(3).padStart(10) +
      r.test.totalR.toFixed(1).padStart(10) +
      r.test.maxDD.toFixed(1).padStart(8) +
      (r.decay.toFixed(1) + '%').padStart(10) +
      verdict
    );
  }
  console.log('═'.repeat(115));
}
