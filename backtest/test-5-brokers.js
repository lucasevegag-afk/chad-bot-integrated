/**
 * backtest/test-5-brokers.js
 *
 * Test exhaustivo de los 5 brokers ganadores contra el registry completo:
 *   1. IBKR (Interactive Brokers)
 *   2. BlackBull Prime
 *   3. Exness Raw Spread
 *   4. Tickmill Pro
 *   5. Pepperstone Razor
 *
 * Spreads efectivos en unidades de precio del activo (round-trip).
 */
const { spawnSync } = require('child_process');
const path = require('path');
const { STRATEGIES } = require('../server/bot/strategies/registry');

// Spreads EFECTIVOS (spread + commission) por broker/activo
// FX: en unidades de precio (ej 0.000014 = 0.14 pip EUR/USD)
// XAU: USD por oz · BTC: USD por coin
const BROKERS = {
  'IBKR': {
    EURUSD:  0.000014,  // 0.14 pip
    GBPUSD:  0.000024,
    USDJPY:  0.0024,    // 0.24 pip JPY
    AUDUSD:  0.000024,
    USDCAD:  0.000034,
    XAUUSD:  0.09,
    BTCUSDT: 6,
    NAS100:  0.7,
    SPX500:  0.5,
  },
  'BlackBull Prime': {
    EURUSD:  0.000006,  // 0.06 pip
    GBPUSD:  0.000036,
    USDJPY:  0.0036,
    AUDUSD:  0.000036,
    USDCAD:  0.000066,
    XAUUSD:  0.14,
    BTCUSDT: 10,
    NAS100:  0.8,
    SPX500:  0.6,
  },
  'Exness Raw': {
    EURUSD:  0.000007,  // 0.07 pip
    GBPUSD:  0.000047,
    USDJPY:  0.0027,
    AUDUSD:  0.000047,
    USDCAD:  0.000067,
    XAUUSD:  0.11,
    BTCUSDT: 12,
    NAS100:  1.0,
    SPX500:  0.7,
  },
  'Tickmill Pro': {
    EURUSD:  0.000004,  // 0.04 pip (el más barato FX)
    GBPUSD:  0.000034,
    USDJPY:  0.0034,
    AUDUSD:  0.000034,
    USDCAD:  0.000064,
    XAUUSD:  0.09,
    BTCUSDT: 40,        // BTC mas caro
    NAS100:  1.2,
    SPX500:  0.8,
  },
  'Pepperstone Razor': {
    EURUSD:  0.000007,
    GBPUSD:  0.000037,
    USDJPY:  0.0027,
    AUDUSD:  0.000037,
    USDCAD:  0.000057,
    XAUUSD:  0.14,
    BTCUSDT: 25,
    NAS100:  1.0,
    SPX500:  0.7,
  },
};

// Estrategias prioritarias (Tier A según análisis previo)
const PICKS = [
  // XAU
  'J3', 'PA3', 'PA1',
  // BTC
  'J3-BTC', 'PA3-BTC', 'PA1-BTC',
  // GBP
  'J3-GBP', 'PA1-GBP', 'PA3-GBP',
  // CAD
  'PA1-CAD', 'J3-CAD',
  // JPY
  'PA1-JPY', 'J3-JPY',
  // EUR
  'PA1-EUR',
];

const TEST = { from: '2025-01-01', to: '2026-12-31' };

function runOne(env, asset) {
  const child = spawnSync('node', [path.join(__dirname, 'run.js'), asset], { env, encoding: 'utf8' });
  const out = child.stdout || '';
  const grab = (re, fb = '0') => { const m = out.match(re); return m ? m[1].trim() : fb; };
  return {
    totalR:  Number(grab(/Total R:\s+([\d.-]+)/)),
    winRate: Number(grab(/Wins:\s+\d+\s+\(([\d.]+)%\)/)),
    avgR:    Number(grab(/Avg R:\s+([\d.-]+)/)),
  };
}

const matrix = {}; // strategy → { broker: result }

for (const id of PICKS) {
  const strat = STRATEGIES.find(s => s.id === id);
  if (!strat) continue;
  matrix[id] = { asset: strat.asset, brokers: {} };
  console.log(`\n🧪 ${id} (${strat.asset})`);

  // NO SPREAD reference
  const envNo = { ...process.env, ...strat.config, S1_DATE_FROM: TEST.from, S1_DATE_TO: TEST.to, S1_SPREAD: '0' };
  matrix[id].brokers['NO_SPREAD'] = runOne(envNo, strat.asset);
  console.log(`   ${'NO SPREAD'.padEnd(22)}: ${matrix[id].brokers['NO_SPREAD'].totalR.toFixed(1)}R`);

  for (const [brokerName, spreads] of Object.entries(BROKERS)) {
    const spread = spreads[strat.asset] || 0;
    const env = { ...process.env, ...strat.config, S1_DATE_FROM: TEST.from, S1_DATE_TO: TEST.to, S1_SPREAD: String(spread) };
    matrix[id].brokers[brokerName] = runOne(env, strat.asset);
    console.log(`   ${brokerName.padEnd(22)}: ${matrix[id].brokers[brokerName].totalR.toFixed(1)}R · spread ${spread}`);
  }
}

// Tabla matriz
console.log('\n\n' + '═'.repeat(135));
console.log('📊 MATRIZ ESTRATEGIA × BROKER · TEST OOS (2025-2026) · TotalR');
console.log('═'.repeat(135));
console.log(
  'Strategy'.padEnd(13) +
  'Activo'.padEnd(10) +
  'NoSpread'.padStart(11) +
  'IBKR'.padStart(11) +
  'BlackBull'.padStart(11) +
  'Exness Raw'.padStart(11) +
  'Tickmill'.padStart(11) +
  'Pepperstone'.padStart(13) +
  '  Veredicto'
);
console.log('─'.repeat(135));

const BROKER_ORDER = ['IBKR', 'BlackBull Prime', 'Exness Raw', 'Tickmill Pro', 'Pepperstone Razor'];

const brokerScores = {};
BROKER_ORDER.forEach(b => brokerScores[b] = { total: 0, viable: 0 });

for (const [id, data] of Object.entries(matrix)) {
  const no = data.brokers['NO_SPREAD'].totalR;
  const vals = BROKER_ORDER.map(b => data.brokers[b].totalR);

  const viableCount = vals.filter(v => v > 10).length;
  let verdict;
  if (viableCount === 5) verdict = '⭐ TODOS aguantan';
  else if (viableCount >= 3) verdict = `✅ ${viableCount}/5 aguantan`;
  else if (viableCount >= 1) verdict = `⚠ Solo ${viableCount}/5`;
  else verdict = '❌ NADIE aguanta';

  console.log(
    id.padEnd(13) +
    data.asset.padEnd(10) +
    (no.toFixed(1) + 'R').padStart(11) +
    vals.map(v => (v.toFixed(1) + 'R').padStart(11)).join('').slice(0, 11*5+2) +
    '  ' + verdict
  );

  // Acumular para ranking de brokers
  BROKER_ORDER.forEach((b, i) => {
    brokerScores[b].total += vals[i];
    if (vals[i] > 10) brokerScores[b].viable++;
  });
}
console.log('═'.repeat(135));

// Ranking final de brokers
console.log('\n🏆 RANKING BROKERS (suma TotalR todas las estrategias)');
console.log('─'.repeat(75));
const ranked = Object.entries(brokerScores).sort((a, b) => b[1].total - a[1].total);
ranked.forEach(([b, s], i) => {
  const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '  ';
  console.log(`${medal} ${(i+1)+'.'.padEnd(2)} ${b.padEnd(22)} TotalR suma: ${s.total.toFixed(0)}R · ${s.viable}/${PICKS.length} estrategias viables`);
});
console.log('─'.repeat(75));
