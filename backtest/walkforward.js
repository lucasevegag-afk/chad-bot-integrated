/**
 * backtest/walkforward.js
 *
 * Walk-forward test out-of-sample para detectar overfitting.
 *
 * Train: 2022-01 → 2024-12  (período donde tuneamos J3)
 * Test:  2025-01 → 2026-06  (período NO visto durante tuning)
 *
 * Si las métricas se mantienen en TEST → edge real.
 * Si TEST degrada mucho → J3 es overfit.
 */

const { spawnSync } = require('child_process');
const path = require('path');

const J3_CONFIG = {
  // P1 — killzones + SL×1 TP×0.5 (70.9% wr in-sample, +112R)
  S1_BAD_SESSIONS: 'NY_PM',
  S1_BAD_DOWS: '1',
  S1_KILLZONES: '7,8,9,12,13,14',
  S1_SL_MULT: '1',
  S1_TP_MULT: '0.5',
};

const SPLITS = [
  { name: 'FULL · 2022-01 → 2026-06', from: '2022-01-01', to: '2026-12-31' },
  { name: 'TRAIN · 2022-01 → 2024-12 (in-sample)', from: '2022-01-01', to: '2024-12-31' },
  { name: 'TEST · 2025-01 → 2026-06 (out-of-sample)', from: '2025-01-01', to: '2026-12-31' },
  // Sub-periods for stability check
  { name: '   • 2022 only', from: '2022-01-01', to: '2022-12-31' },
  { name: '   • 2023 only', from: '2023-01-01', to: '2023-12-31' },
  { name: '   • 2024 only', from: '2024-01-01', to: '2024-12-31' },
  { name: '   • 2025 only', from: '2025-01-01', to: '2025-12-31' },
  { name: '   • 2026 YTD', from: '2026-01-01', to: '2026-12-31' },
];

const results = [];

for (const split of SPLITS) {
  console.log(`\n🧪 ${split.name}`);

  const env = {
    ...process.env,
    ...J3_CONFIG,
    S1_DATE_FROM: split.from,
    S1_DATE_TO:   split.to,
  };

  const child = spawnSync('node', [path.join(__dirname, 'run.js')], {
    env,
    encoding: 'utf8',
  });

  const out = child.stdout || '';
  const grab = (re, fallback = '—') => {
    const m = out.match(re);
    return m ? m[1].trim() : fallback;
  };

  const r = {
    name: split.name,
    trades:  grab(/Trades:\s+(\d+)/),
    winRate: grab(/Wins:\s+\d+\s+\(([\d.]+)%\)/),
    avgR:    grab(/Avg R:\s+([\d.-]+)/),
    totalR:  grab(/Total R:\s+([\d.-]+)/),
    maxDD:   grab(/Max DD:\s+([\d.-]+)/),
  };
  results.push(r);
  console.log(`   → ${r.trades} trades · ${r.winRate}% wr · ${r.totalR}R · DD ${r.maxDD}R`);
}

console.log('\n\n' + '═'.repeat(95));
console.log('📊 WALK-FORWARD · XAU/USD P1 (70.9% wr) — in-sample vs out-of-sample');
console.log('═'.repeat(95));
console.log(
  'Período'.padEnd(50) +
  'Trades'.padStart(8) +
  'Win%'.padStart(8) +
  'AvgR'.padStart(8) +
  'TotR'.padStart(9) +
  'MaxDD'.padStart(8) +
  '  R/DD'
);
console.log('─'.repeat(95));
for (const r of results) {
  const rOverDd = (Number(r.totalR) / Number(r.maxDD || 1)).toFixed(1);
  console.log(
    r.name.padEnd(50) +
    r.trades.padStart(8) +
    (r.winRate + '%').padStart(8) +
    r.avgR.padStart(8) +
    r.totalR.padStart(9) +
    r.maxDD.padStart(8) +
    '   ' + rOverDd
  );
}
console.log('═'.repeat(95));

// Detección de overfit
const train = results.find(r => r.name.includes('TRAIN'));
const test  = results.find(r => r.name.includes('TEST'));
if (train && test) {
  const trainExp = Number(train.avgR);
  const testExp  = Number(test.avgR);
  const trainWr  = Number(train.winRate);
  const testWr   = Number(test.winRate);
  const decay = ((testExp - trainExp) / trainExp * 100).toFixed(1);

  console.log('\n🔍 ANÁLISIS DE OVERFITTING');
  console.log(`   Train expectancy: ${trainExp.toFixed(3)}R · win-rate ${trainWr.toFixed(1)}%`);
  console.log(`   Test  expectancy: ${testExp.toFixed(3)}R · win-rate ${testWr.toFixed(1)}%`);
  console.log(`   Decay test vs train: ${decay}%`);
  if (testExp > trainExp * 0.7) {
    console.log('   ✅ Edge se mantiene (decay <30%) — estrategia robusta');
  } else if (testExp > 0) {
    console.log('   ⚠️  Edge degrada >30% pero sigue positivo — algo de overfit');
  } else {
    console.log('   ❌ Edge desaparece en OOS — J3 es overfit, replantear');
  }
  console.log('');
}
