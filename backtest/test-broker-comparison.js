/**
 * backtest/test-broker-comparison.js
 *
 * Compara performance de las 9 top estrategias bajo 3 escenarios:
 *   1. Sin spread (ideal teórico)
 *   2. Exness Pro (retail estándar)
 *   3. IC Markets Raw / Pepperstone Razor (Raw spread + commission)
 *
 * Para que el user vea qué broker desbloquea qué activos.
 */
const { spawnSync } = require('child_process');
const path = require('path');
const { STRATEGIES } = require('../server/bot/strategies/registry');

// Spreads efectivos por broker (incluye comisión convertida)
const BROKERS = {
  'NO SPREAD': {
    XAUUSD: 0, EURUSD: 0, GBPUSD: 0, USDCAD: 0, USDJPY: 0,
    AUDUSD: 0, GBPAUD: 0, BTCUSDT: 0, NAS100: 0, SPX500: 0,
  },
  'EXNESS PRO (retail)': {
    XAUUSD:  0.25,
    EURUSD:  0.00007,
    GBPUSD:  0.0001,
    USDCAD:  0.0001,
    USDJPY:  0.007,
    AUDUSD:  0.00008,
    GBPAUD:  0.00015,
    BTCUSDT: 30,
    NAS100:  1.5,
    SPX500:  0.5,
  },
  'IC MARKETS / RAW': {
    // Spread + commission ($3.5/lot per side = $7/round)
    XAUUSD:  0.14,      // 0.07 spread + 0.07 commission
    EURUSD:  0.000012,  // 0.05 + 0.07 = 0.12 pip
    GBPUSD:  0.000015,  // 0.08 + 0.07
    USDCAD:  0.000017,  // 0.10 + 0.07
    USDJPY:  0.0014,    // 0.07 + 0.07 pip
    AUDUSD:  0.000013,  // 0.06 + 0.07
    GBPAUD:  0.000022,  // 0.15 + 0.07
    BTCUSDT: 17,        // 10 spread + 7 commission per BTC
    NAS100:  0.8,
    SPX500:  0.5,
  },
};

// Picks: las 9 más prometedoras del registry (Tier A según análisis previo)
const PICKS = [
  'J3', 'PA3', 'PA1',           // XAU top
  'J3-BTC', 'PA3-BTC',          // BTC main
  'J3-GBP', 'PA1-GBP', 'PA3-GBP', // GBPUSD top
  'PA1-CAD',                     // USDCAD
];

function runOne(env, asset) {
  const child = spawnSync('node', [path.join(__dirname, 'run.js'), asset], { env, encoding: 'utf8' });
  const out = child.stdout || '';
  const grab = (re, fb = '0') => { const m = out.match(re); return m ? m[1].trim() : fb; };
  return {
    totalR:  Number(grab(/Total R:\s+([\d.-]+)/)),
    winRate: Number(grab(/Wins:\s+\d+\s+\(([\d.]+)%\)/)),
    avgR:    Number(grab(/Avg R:\s+([\d.-]+)/)),
    maxDD:   Number(grab(/Max DD:\s+([\d.-]+)/)),
  };
}

const results = [];
const TEST_PERIOD = { from: '2025-01-01', to: '2026-12-31' };

for (const id of PICKS) {
  const strat = STRATEGIES.find(s => s.id === id);
  if (!strat) continue;

  console.log(`\n🧪 ${id} (${strat.asset})`);
  const row = { id, asset: strat.asset };

  for (const [brokerName, spreads] of Object.entries(BROKERS)) {
    const spread = spreads[strat.asset] || 0;
    const env = {
      ...process.env,
      ...strat.config,
      S1_DATE_FROM: TEST_PERIOD.from,
      S1_DATE_TO: TEST_PERIOD.to,
      S1_SPREAD: String(spread),
    };
    const r = runOne(env, strat.asset);
    row[brokerName] = r;
    console.log(`   ${brokerName.padEnd(22)}: ${r.totalR.toFixed(1)}R · ${r.winRate.toFixed(1)}% · AvgR ${r.avgR.toFixed(3)}`);
  }
  results.push(row);
}

// Tabla comparativa
console.log('\n\n' + '═'.repeat(135));
console.log('📊 COMPARATIVA POR BROKER · TEST PERIOD OOS (2025-2026)');
console.log('═'.repeat(135));
console.log(
  'Strategy'.padEnd(13) +
  'Activo'.padEnd(10) +
  '  │  ' +
  'No Spread'.padStart(13) +
  '  │  ' +
  'Exness Pro'.padStart(13) +
  '   %loss'.padStart(9) +
  '  │  ' +
  'IC/Raw'.padStart(13) +
  '   %loss'.padStart(9) +
  '  │  ' +
  'Veredicto'
);
console.log('─'.repeat(135));

for (const r of results) {
  const no = r['NO SPREAD'].totalR;
  const ex = r['EXNESS PRO (retail)'].totalR;
  const raw = r['IC MARKETS / RAW'].totalR;
  const lossEx = no !== 0 ? ((1 - ex/no) * 100).toFixed(0) : 'N/A';
  const lossRaw = no !== 0 ? ((1 - raw/no) * 100).toFixed(0) : 'N/A';

  let verdict;
  if (ex > 30 && raw > 50) verdict = '⭐ AMBOS aguantan';
  else if (ex > 10) verdict = '✅ Exness OK · Raw mejor';
  else if (raw > 30) verdict = '🔄 Solo Raw funciona';
  else if (raw > 0) verdict = '⚠ Marginal hasta en Raw';
  else verdict = '❌ Ninguno funciona';

  console.log(
    r.id.padEnd(13) +
    r.asset.padEnd(10) +
    '  │  ' +
    (no.toFixed(1) + 'R').padStart(13) +
    '  │  ' +
    (ex.toFixed(1) + 'R').padStart(13) +
    (lossEx + '%').padStart(9) +
    '  │  ' +
    (raw.toFixed(1) + 'R').padStart(13) +
    (lossRaw + '%').padStart(9) +
    '  │  ' +
    verdict
  );
}
console.log('═'.repeat(135));

// Resumen viability
console.log('\n📋 ACTIVOS DESBLOQUEADOS POR BROKER:');
const byAsset = {};
for (const r of results) {
  if (!byAsset[r.asset]) byAsset[r.asset] = { exness: 0, raw: 0 };
  if (r['EXNESS PRO (retail)'].totalR > 10) byAsset[r.asset].exness++;
  if (r['IC MARKETS / RAW'].totalR > 30) byAsset[r.asset].raw++;
}
for (const [asset, counts] of Object.entries(byAsset)) {
  console.log(`   ${asset.padEnd(10)}: Exness Pro ${counts.exness}/${results.filter(r=>r.asset===asset).length} · IC/Raw ${counts.raw}/${results.filter(r=>r.asset===asset).length}`);
}
