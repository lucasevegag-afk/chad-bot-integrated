/**
 * backtest/sweep-j3-tune.js
 *
 * Tune de exits TP/SL alrededor de J3.
 * Mantiene los MISMOS filtros (no toca entrada).
 * Reporta IS, OOS y decay para cada variante — la robustez es prioridad.
 */

const { spawnSync } = require('child_process');
const path = require('path');

const J3_FILTERS = {
  S1_BAD_SESSIONS: 'NY_PM',
  S1_BAD_HOURS: '10,15,18',
  S1_BAD_DOWS: '1',
};

const EXPERIMENTS = [
  { name: 'J3 base (SL×0.7 TP×2.5)', sl: '0.7', tp: '2.5' },

  // SL fijo 0.7, variando TP
  { name: 'T1: SL×0.7 TP×2.0', sl: '0.7', tp: '2.0' },
  { name: 'T2: SL×0.7 TP×3.0', sl: '0.7', tp: '3.0' },
  { name: 'T3: SL×0.7 TP×3.5', sl: '0.7', tp: '3.5' },

  // TP fijo 2.5, variando SL
  { name: 'T4: SL×0.5 TP×2.5', sl: '0.5', tp: '2.5' },
  { name: 'T5: SL×1.0 TP×2.5', sl: '1.0', tp: '2.5' },

  // Combinaciones
  { name: 'T6: SL×0.5 TP×3.0', sl: '0.5', tp: '3.0' },
  { name: 'T7: SL×1.0 TP×3.0', sl: '1.0', tp: '3.0' },
  { name: 'T8: SL×0.7 TP×4.0', sl: '0.7', tp: '4.0' },
];

const PERIODS = [
  { name: 'FULL', from: '2022-01-01', to: '2026-12-31' },
  { name: 'TRAIN', from: '2022-01-01', to: '2024-12-31' },
  { name: 'TEST',  from: '2025-01-01', to: '2026-12-31' },
];

function runOne(env) {
  const child = spawnSync('node', [path.join(__dirname, 'run.js')], { env, encoding: 'utf8' });
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

const results = [];

for (const exp of EXPERIMENTS) {
  console.log(`\n🧪 ${exp.name}`);
  const baseEnv = {
    ...process.env,
    ...J3_FILTERS,
    S1_SL_MULT: exp.sl,
    S1_TP_MULT: exp.tp,
  };

  const periodResults = {};
  for (const p of PERIODS) {
    const env = { ...baseEnv, S1_DATE_FROM: p.from, S1_DATE_TO: p.to };
    periodResults[p.name] = runOne(env);
    console.log(`   ${p.name}: ${periodResults[p.name].trades} trades · ${periodResults[p.name].winRate}% wr · AvgR ${periodResults[p.name].avgR.toFixed(3)}`);
  }

  // Calcular decay sobre AvgR
  const decay = periodResults.TRAIN.avgR > 0
    ? ((periodResults.TEST.avgR - periodResults.TRAIN.avgR) / periodResults.TRAIN.avgR * 100)
    : 0;

  results.push({
    name: exp.name,
    full: periodResults.FULL,
    train: periodResults.TRAIN,
    test: periodResults.TEST,
    decay,
  });
}

console.log('\n\n' + '═'.repeat(115));
console.log('📊 TUNE EXITS J3 · in-sample vs out-of-sample con decay');
console.log('═'.repeat(115));
console.log(
  'Variante'.padEnd(28) +
  'Trades'.padStart(8) +
  'IS WR'.padStart(8) +
  'IS AvgR'.padStart(9) +
  'OS WR'.padStart(8) +
  'OS AvgR'.padStart(9) +
  'OS TotR'.padStart(9) +
  'FULL TotR'.padStart(11) +
  'Decay'.padStart(9) +
  '  Verdict'
);
console.log('─'.repeat(115));
for (const r of results) {
  let verdict = '';
  if (Math.abs(r.decay) < 15) verdict = '  ⭐ robusta';
  else if (Math.abs(r.decay) < 35) verdict = '  ✓ ok';
  else if (Math.abs(r.decay) < 60) verdict = '  ⚠️  frágil';
  else verdict = '  ❌ overfit';

  console.log(
    r.name.padEnd(28) +
    String(r.full.trades).padStart(8) +
    (r.train.winRate.toFixed(1) + '%').padStart(8) +
    r.train.avgR.toFixed(3).padStart(9) +
    (r.test.winRate.toFixed(1) + '%').padStart(8) +
    r.test.avgR.toFixed(3).padStart(9) +
    r.test.totalR.toFixed(1).padStart(9) +
    r.full.totalR.toFixed(1).padStart(11) +
    (r.decay.toFixed(1) + '%').padStart(9) +
    verdict
  );
}
console.log('═'.repeat(115) + '\n');
