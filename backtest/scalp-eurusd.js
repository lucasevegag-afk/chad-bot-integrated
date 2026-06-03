/**
 * backtest/scalp-xau.js
 * Sweep de estrategias scalping (TPs ajustados) sobre EUR/USD con walk-forward.
 */
const { spawnSync } = require('child_process');
const path = require('path');

const PERIODS = [
  { name: 'TRAIN', from: '2022-01-01', to: '2024-12-31' },
  { name: 'TEST',  from: '2025-01-01', to: '2026-12-31' },
];

// Base: filtros J3 (probados robustos)
const BASE_J3 = {
  S1_BAD_SESSIONS: 'NY_PM',
  S1_BAD_HOURS: '10,15,18',
  S1_BAD_DOWS: '1',
};

// Base: killzones (P1 style)
const BASE_KZ = {
  S1_BAD_SESSIONS: 'NY_PM',
  S1_BAD_DOWS: '1',
  S1_KILLZONES: '7,8,9,12,13,14',
};

const EXPERIMENTS = [
  // Referencias
  { name: 'P1 XAU (referencia killzones)', env: { ...BASE_KZ, S1_SL_MULT: '1',   S1_TP_MULT: '0.5' } },

  // Grupo A · Stop ajustado tradicional
  { name: 'A1: SL×0.5 TP×0.3 J3 (1:0.6)', env: { ...BASE_J3, S1_SL_MULT: '0.5', S1_TP_MULT: '0.3' } },
  { name: 'A2: SL×0.5 TP×0.2 J3 (1:0.4)', env: { ...BASE_J3, S1_SL_MULT: '0.5', S1_TP_MULT: '0.2' } },

  // Grupo B · Stop amplio estilo S8 (lo que ganó en índices)
  { name: 'B1: SL×1.5 TP×0.3 J3 (S8 en XAU)', env: { ...BASE_J3, S1_SL_MULT: '1.5', S1_TP_MULT: '0.3' } },
  { name: 'B2: SL×2.0 TP×0.3 J3 (extremo)',   env: { ...BASE_J3, S1_SL_MULT: '2.0', S1_TP_MULT: '0.3' } },
  { name: 'B3: SL×1.0 TP×0.2 J3 (1:0.2)',     env: { ...BASE_J3, S1_SL_MULT: '1.0', S1_TP_MULT: '0.2' } },

  // Grupo C · Multi-target (partial)
  { name: 'C1: partial TP1×0.2/50%+TP×0.7/SL×0.7', env: { ...BASE_J3, S1_SL_MULT: '0.7', S1_TP_MULT: '0.7', S1_PARTIAL_TP_MULT: '0.2', S1_PARTIAL_FRACTION: '0.5' } },
  { name: 'C2: partial TP1×0.3/70%+TP×0.7/SL×1.0', env: { ...BASE_J3, S1_SL_MULT: '1.0', S1_TP_MULT: '0.7', S1_PARTIAL_TP_MULT: '0.3', S1_PARTIAL_FRACTION: '0.7' } },

  // Grupo D · Killzones + tight TP
  { name: 'D1: KZ SL×0.7 TP×0.3', env: { ...BASE_KZ, S1_SL_MULT: '0.7', S1_TP_MULT: '0.3' } },
  { name: 'D2: KZ SL×0.7 TP×0.4', env: { ...BASE_KZ, S1_SL_MULT: '0.7', S1_TP_MULT: '0.4' } },
  { name: 'D3: KZ SL×1.5 TP×0.3 (S8 en XAU+KZ)', env: { ...BASE_KZ, S1_SL_MULT: '1.5', S1_TP_MULT: '0.3' } },
];

function runOne(env) {
  const child = spawnSync('node', [path.join(__dirname, 'run.js'), 'EURUSD'], { env, encoding: 'utf8' });
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

console.log('🧪 SCALPING SWEEP · EUR/USD · IS vs OS\n');

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
console.log('📊 SCALPING SWEEP · EUR/USD · in-sample vs out-of-sample');
console.log('═'.repeat(125));
console.log(
  'Variante'.padEnd(38) +
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
    r.name.padEnd(38) +
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
