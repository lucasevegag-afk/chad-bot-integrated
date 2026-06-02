/**
 * backtest/sweep-partial.js
 *
 * J3 con partial profit-taking variantes. Mide IS/OOS y decay.
 * Objetivo: subir winrate efectivo a 55-60% sin matar la robustez.
 */

const { spawnSync } = require('child_process');
const path = require('path');

const J3_FILTERS = {
  S1_BAD_SESSIONS: 'NY_PM',
  S1_BAD_HOURS: '10,15,18',
  S1_BAD_DOWS: '1',
  S1_SL_MULT: '0.7',
  S1_TP_MULT: '2.5',
};

const EXPERIMENTS = [
  { name: 'J3 base (sin partial)', env: { ...J3_FILTERS } },

  // Partial al +0.5 ATR (close 50%), SL→BE
  { name: 'PA1: TP1×0.5 50% + BE', env: { ...J3_FILTERS, S1_PARTIAL_TP_MULT: '0.5', S1_PARTIAL_FRACTION: '0.5' } },
  { name: 'PA2: TP1×0.7 50% + BE', env: { ...J3_FILTERS, S1_PARTIAL_TP_MULT: '0.7', S1_PARTIAL_FRACTION: '0.5' } },
  { name: 'PA3: TP1×1.0 50% + BE', env: { ...J3_FILTERS, S1_PARTIAL_TP_MULT: '1.0', S1_PARTIAL_FRACTION: '0.5' } },

  // Partial fraction más agresivo (close 70%)
  { name: 'PB1: TP1×0.5 70% + BE', env: { ...J3_FILTERS, S1_PARTIAL_TP_MULT: '0.5', S1_PARTIAL_FRACTION: '0.7' } },
  { name: 'PB2: TP1×0.7 70% + BE', env: { ...J3_FILTERS, S1_PARTIAL_TP_MULT: '0.7', S1_PARTIAL_FRACTION: '0.7' } },

  // Partial sin BE (deja correr full SL después)
  { name: 'PC1: TP1×0.5 50% sin BE', env: { ...J3_FILTERS, S1_PARTIAL_TP_MULT: '0.5', S1_PARTIAL_FRACTION: '0.5', S1_BE_AFTER_PARTIAL: '0' } },
  { name: 'PC2: TP1×0.7 50% sin BE', env: { ...J3_FILTERS, S1_PARTIAL_TP_MULT: '0.7', S1_PARTIAL_FRACTION: '0.5', S1_BE_AFTER_PARTIAL: '0' } },
];

const PERIODS = [
  { name: 'FULL',  from: '2022-01-01', to: '2026-12-31' },
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

  const periodResults = {};
  for (const p of PERIODS) {
    const env = { ...process.env, ...exp.env, S1_DATE_FROM: p.from, S1_DATE_TO: p.to };
    periodResults[p.name] = runOne(env);
    console.log(`   ${p.name}: ${periodResults[p.name].trades} trades · ${periodResults[p.name].winRate}% wr · AvgR ${periodResults[p.name].avgR.toFixed(3)}`);
  }

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

console.log('\n\n' + '═'.repeat(120));
console.log('📊 J3 + PARTIAL PROFIT TAKING · winrate / robustez');
console.log('═'.repeat(120));
console.log(
  'Variante'.padEnd(30) +
  'Trades'.padStart(8) +
  'IS WR'.padStart(8) +
  'OS WR'.padStart(8) +
  'IS AvgR'.padStart(9) +
  'OS AvgR'.padStart(9) +
  'OS TotR'.padStart(9) +
  'FULL TotR'.padStart(11) +
  'OS DD'.padStart(8) +
  'Decay'.padStart(9) +
  '  Verdict'
);
console.log('─'.repeat(120));
for (const r of results) {
  let verdict = '';
  if (Math.abs(r.decay) < 15) verdict = '  ⭐ robusta';
  else if (Math.abs(r.decay) < 35) verdict = '  ✓ ok';
  else if (Math.abs(r.decay) < 60) verdict = '  ⚠️  frágil';
  else verdict = '  ❌ overfit';

  console.log(
    r.name.padEnd(30) +
    String(r.full.trades).padStart(8) +
    (r.train.winRate.toFixed(1) + '%').padStart(8) +
    (r.test.winRate.toFixed(1) + '%').padStart(8) +
    r.train.avgR.toFixed(3).padStart(9) +
    r.test.avgR.toFixed(3).padStart(9) +
    r.test.totalR.toFixed(1).padStart(9) +
    r.full.totalR.toFixed(1).padStart(11) +
    r.test.maxDD.toFixed(1).padStart(8) +
    (r.decay.toFixed(1) + '%').padStart(9) +
    verdict
  );
}
console.log('═'.repeat(120) + '\n');
