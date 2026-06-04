/**
 * backtest/test-btc-brokers.js
 *
 * Compara performance de las 4 estrategias BTC con costos reales de varios brokers.
 *
 * Nota: BTC average price during 5y backtest (~2021-2026) = ~$50-80k
 * Las comisiones porcentuales se traducen a costos efectivos asumiendo
 * BTC ~$60k promedio durante el backtest.
 */
const { spawnSync } = require('child_process');
const path = require('path');
const { STRATEGIES } = require('../server/bot/strategies/registry');

// Costo total round-trip por BTC (entrada + salida) en USD
// Calculado con BTC promedio $60k durante backtest
const BTC_BROKERS = {
  'NO SPREAD (teórico)':        0,
  'BlackBull CFD (ECN)':        15,    // $10 spread + $5 commission
  'Binance Spot (maker)':       90,    // 0.075% × 2 × $60k = $90 (con BNB discount)
  'Binance Spot (taker)':       120,   // 0.1% × 2 × $60k = $120
  'Libertex CFD':               50,    // wide spread $50
  'eToro CFD':                  100,   // retail spread $80-120
  'IBKR Crypto (direct)':       216,   // 0.18% × 2 × $60k = $216
  'Exness Pro (referencia)':    30,    // ya testeada
};

const PICKS = ['J3-BTC', 'PA3-BTC', 'PA1-BTC', 'C2-BTC-SCALP'];

function runOne(env) {
  const child = spawnSync('node', [path.join(__dirname, 'run.js'), 'BTCUSDT'], { env, encoding: 'utf8' });
  const out = child.stdout || '';
  const grab = (re, fb = '0') => { const m = out.match(re); return m ? m[1].trim() : fb; };
  return {
    totalR:  Number(grab(/Total R:\s+([\d.-]+)/)),
    winRate: Number(grab(/Wins:\s+\d+\s+\(([\d.]+)%\)/)),
    avgR:    Number(grab(/Avg R:\s+([\d.-]+)/)),
    maxDD:   Number(grab(/Max DD:\s+([\d.-]+)/)),
  };
}

const results = {};
const TEST = { from: '2025-01-01', to: '2026-12-31' };

for (const id of PICKS) {
  const strat = STRATEGIES.find(s => s.id === id);
  if (!strat) continue;
  results[id] = {};
  console.log(`\n🧪 ${id}`);

  for (const [brokerName, spread] of Object.entries(BTC_BROKERS)) {
    const env = {
      ...process.env, ...strat.config,
      S1_DATE_FROM: TEST.from, S1_DATE_TO: TEST.to,
      S1_SPREAD: String(spread),
    };
    const r = runOne(env);
    results[id][brokerName] = r;
    console.log(`   ${brokerName.padEnd(28)} $${String(spread).padStart(4)}: ${r.totalR.toFixed(1)}R · ${r.winRate.toFixed(1)}% · AvgR ${r.avgR.toFixed(3)}`);
  }
}

// Tabla comparativa
console.log('\n\n' + '═'.repeat(115));
console.log('📊 BTCUSDT · COMPARATIVA DE BROKERS · TEST OOS (2025-2026)');
console.log('═'.repeat(115));
console.log(
  'Broker'.padEnd(28) +
  'Cost'.padStart(7) +
  '  │  ' +
  'J3-BTC'.padStart(11) +
  'PA3-BTC'.padStart(11) +
  'PA1-BTC'.padStart(11) +
  'C2-BTC'.padStart(11) +
  '  │  ' +
  'Verdict'
);
console.log('─'.repeat(115));

for (const broker of Object.keys(BTC_BROKERS)) {
  const cost = BTC_BROKERS[broker];
  const j3   = results['J3-BTC'][broker].totalR;
  const pa3  = results['PA3-BTC'][broker].totalR;
  const pa1  = results['PA1-BTC'][broker].totalR;
  const c2   = results['C2-BTC-SCALP'][broker].totalR;

  const positives = [j3, pa3, pa1, c2].filter(x => x > 10).length;
  let verdict;
  if (positives === 4) verdict = '⭐ Las 4 funcionan';
  else if (positives >= 2) verdict = `✅ ${positives}/4 funcionan`;
  else if (positives === 1) verdict = `⚠ Solo ${positives}/4 funciona`;
  else verdict = '❌ Ninguna funciona';

  console.log(
    broker.padEnd(28) +
    ('$' + cost).padStart(7) +
    '  │  ' +
    (j3.toFixed(1) + 'R').padStart(11) +
    (pa3.toFixed(1) + 'R').padStart(11) +
    (pa1.toFixed(1) + 'R').padStart(11) +
    (c2.toFixed(1) + 'R').padStart(11) +
    '  │  ' +
    verdict
  );
}
console.log('═'.repeat(115));

// Ranking de brokers
console.log('\n📋 RANKING DE BROKERS PARA BTC (por TotalR sumado de las 4):');
const brokerScores = Object.keys(BTC_BROKERS).map(b => ({
  broker: b,
  cost: BTC_BROKERS[b],
  total: Object.values(results).reduce((acc, r) => acc + r[b].totalR, 0),
}));
brokerScores.sort((a, b) => b.total - a.total);
brokerScores.forEach((b, i) => {
  console.log(`   ${(i+1)+'.'} ${b.broker.padEnd(28)} · cost $${b.cost} · TotalR suma: ${b.total.toFixed(1)}R`);
});
