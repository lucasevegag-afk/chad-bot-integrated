/**
 * backtest/tune-spx500.js
 * Optimización TPs ajustados para SPX500 (rangos chicos).
 */
const { spawnSync } = require('child_process');
const path = require('path');

const PERIODS = [
  { name: 'TRAIN', from: '2022-01-01', to: '2024-12-31' },
  { name: 'TEST',  from: '2025-01-01', to: '2026-12-31' },
];

// Base común a todas: filtros J3 (killzones LON+NY, sin lunes, sin NY_PM)
const BASE = {
  S1_BAD_SESSIONS: 'NY_PM',
  S1_BAD_DOWS: '1',
  S1_KILLZONES: '7,8,9,12,13,14',
};

const EXPERIMENTS = [
  // P1 actual (referencia)
  { name: 'P1 base   (SL×1   TP×0.5)', env: { ...BASE, S1_SL_MULT: '1',   S1_TP_MULT: '0.5' } },

  // TP más chico
  { name: 'S1: SL×1   TP×0.3',         env: { ...BASE, S1_SL_MULT: '1',   S1_TP_MULT: '0.3' } },
  { name: 'S2: SL×1   TP×0.4',         env: { ...BASE, S1_SL_MULT: '1',   S1_TP_MULT: '0.4' } },
  { name: 'S3: SL×0.7 TP×0.3',         env: { ...BASE, S1_SL_MULT: '0.7', S1_TP_MULT: '0.3' } },
  { name: 'S4: SL×0.7 TP×0.5',         env: { ...BASE, S1_SL_MULT: '0.7', S1_TP_MULT: '0.5' } },
  { name: 'S5: SL×0.5 TP×0.3',         env: { ...BASE, S1_SL_MULT: '0.5', S1_TP_MULT: '0.3' } },
  { name: 'S6: SL×0.5 TP×0.5',         env: { ...BASE, S1_SL_MULT: '0.5', S1_TP_MULT: '0.5' } },

  // SL más amplio + TP corto (catcher de winrate alto)
  { name: 'S7: SL×1.5 TP×0.5',         env: { ...BASE, S1_SL_MULT: '1.5', S1_TP_MULT: '0.5' } },
  { name: 'S8: SL×1.5 TP×0.3',         env: { ...BASE, S1_SL_MULT: '1.5', S1_TP_MULT: '0.3' } },

  // Partial profit-taking con TP final corto
  { name: 'S9: partial 0.3/SL0.7/TP1.5',  env: { ...BASE, S1_SL_MULT: '0.7', S1_TP_MULT: '1.5', S1_PARTIAL_TP_MULT: '0.3', S1_PARTIAL_FRACTION: '0.5' } },
  { name: 'S10: partial 0.5/SL0.7/TP1.5', env: { ...BASE, S1_SL_MULT: '0.7', S1_TP_MULT: '1.5', S1_PARTIAL_TP_MULT: '0.5', S1_PARTIAL_FRACTION: '0.5' } },
  { name: 'S11: partial 0.3/SL1/TP1',     env: { ...BASE, S1_SL_MULT: '1',   S1_TP_MULT: '1',   S1_PARTIAL_TP_MULT: '0.3', S1_PARTIAL_FRACTION: '0.5' } },
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

const results = [];
for (const exp of EXPERIMENTS) {
  console.log(`\n🧪 ${exp.name}`);
  const periodResults = {};
  for (const p of PERIODS) {
    const env = { ...process.env, ...exp.env, S1_DATE_FROM: p.from, S1_DATE_TO: p.to };
    periodResults[p.name] = runOne(env);
    console.log(`   ${p.name}: ${periodResults[p.name].trades} trades · ${periodResults[p.name].winRate}% wr · AvgR ${periodResults[p.name].avgR.toFixed(3)}`);
  }
  const decay = periodResults.TRAIN.avgR !== 0
    ? ((periodResults.TEST.avgR - periodResults.TRAIN.avgR) / Math.abs(periodResults.TRAIN.avgR) * 100)
    : 0;
  results.push({ name: exp.name, train: periodResults.TRAIN, test: periodResults.TEST, decay });
}

console.log('\n\n' + '═'.repeat(125));
console.log('📊 TUNE TPs SPX500 · in-sample vs out-of-sample con decay');
console.log('═'.repeat(125));
console.log(
  'Variante'.padEnd(34) +
  'IS Trades'.padStart(11) +
  'IS WR'.padStart(8) +
  'IS AvgR'.padStart(9) +
  'OS Trades'.padStart(11) +
  'OS WR'.padStart(8) +
  'OS AvgR'.padStart(9) +
  'OS TotR'.padStart(9) +
  'OS DD'.padStart(8) +
  'Decay'.padStart(9) +
  '  Verdict'
);
console.log('─'.repeat(125));
for (const r of results) {
  let verdict = '';
  if (r.test.avgR > 0 && Math.abs(r.decay) < 25) verdict = '  ⭐ excelente';
  else if (r.test.avgR > 0 && Math.abs(r.decay) < 50) verdict = '  ✓ ok';
  else if (r.test.avgR > 0) verdict = '  ⚠ marginal';
  else verdict = '  ❌ neg OOS';
  console.log(
    r.name.padEnd(34) +
    String(r.train.trades).padStart(11) +
    (r.train.winRate.toFixed(1) + '%').padStart(8) +
    r.train.avgR.toFixed(3).padStart(9) +
    String(r.test.trades).padStart(11) +
    (r.test.winRate.toFixed(1) + '%').padStart(8) +
    r.test.avgR.toFixed(3).padStart(9) +
    r.test.totalR.toFixed(1).padStart(9) +
    r.test.maxDD.toFixed(1).padStart(8) +
    (r.decay.toFixed(1) + '%').padStart(9) +
    verdict
  );
}
console.log('═'.repeat(125) + '\n');
