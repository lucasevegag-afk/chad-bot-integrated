/**
 * backtest/profit-tiers.js
 * Categoriza las 53 estrategias por probabilidad de SER profitable en vivo.
 */
const { STRATEGIES } = require('../server/bot/strategies/registry');

function classify(s) {
  const m = s.metrics;
  const c = s.config;
  const sl = Number(c.S1_SL_MULT || 1);
  const tp = Number(c.S1_TP_MULT || 2);
  const partial = !!c.S1_PARTIAL_TP_MULT;
  const ptp = partial ? Number(c.S1_PARTIAL_TP_MULT) : tp;

  // Compute breakeven margin
  let rr;
  if (partial) {
    const pfrac = Number(c.S1_PARTIAL_FRACTION || 0.5);
    rr = (ptp * pfrac + tp * (1 - pfrac)) / sl;
  } else {
    rr = tp / sl;
  }
  const beWr = 100 / (1 + rr);
  const margin = m.winRate_OS - beWr;

  // Tiers
  const decayAbs = Math.abs(m.decay_pct);
  const lowSample = m.trades_5y < 1500;
  const veryThinTP = (tp <= 0.3 && !partial) || (partial && ptp <= 0.2);
  const lowMargin = margin < 2;
  const mediumMargin = margin < 4;
  const goodSample = m.trades_5y >= 1800;
  const decayPositive = m.decay_pct >= -15;  // <15% degradation
  const decayMild = m.decay_pct >= -40;

  let tier, reason;
  if (decayPositive && m.totalR_5y >= 100 && goodSample && margin >= 4) {
    tier = 'A — ROBUSTA';
    reason = 'Decay bajo + sample grande + margen sólido';
  } else if (decayPositive && m.totalR_5y >= 50 && !veryThinTP) {
    tier = 'A — ROBUSTA';
    reason = 'Decay bajo + profit razonable';
  } else if (decayMild && m.totalR_5y >= 50 && !lowSample && !veryThinTP) {
    tier = 'B — VIABLE';
    reason = 'Edge confirmado, algo frágil';
  } else if (decayMild && m.totalR_5y > 10) {
    tier = 'C — MARGINAL';
    reason = veryThinTP ? 'TP muy chico, spread crítico' : 'Edge fino';
  } else {
    tier = 'D — RIESGOSA';
    reason = 'Decay alto o sample chico o TP demasiado fino';
  }
  return { ...s, ...m, tier, margin, beWr, reason, decayAbs };
}

const classified = STRATEGIES.map(classify).map(s => ({
  id: s.id, asset: s.asset, tipo: s.category === 'scalping' ? 'scalp' : 'main',
  wr: s.winRate_OS, totalR: s.totalR_5y, dd: s.maxDD_R,
  decay: s.decay_pct, streak: s.maxStreakLosses,
  margin: s.margin, tier: s.tier, reason: s.reason,
}));

// Group
const tiers = { 'A — ROBUSTA': [], 'B — VIABLE': [], 'C — MARGINAL': [], 'D — RIESGOSA': [] };
for (const s of classified) tiers[s.tier].push(s);

// Sort each by TotalR
for (const k of Object.keys(tiers)) tiers[k].sort((a, b) => b.totalR - a.totalR);

console.log('═'.repeat(95));
console.log('📊 CATEGORIZACIÓN POR PROBABILIDAD DE SER PROFITABLE EN VIVO');
console.log('═'.repeat(95));

for (const tier of ['A — ROBUSTA', 'B — VIABLE', 'C — MARGINAL', 'D — RIESGOSA']) {
  const list = tiers[tier];
  if (list.length === 0) continue;
  let emoji = '';
  if (tier.startsWith('A')) emoji = '🟢';
  if (tier.startsWith('B')) emoji = '🟡';
  if (tier.startsWith('C')) emoji = '🟠';
  if (tier.startsWith('D')) emoji = '🔴';

  console.log('\n' + emoji + ' TIER ' + tier + ' · ' + list.length + ' estrategias');
  console.log('─'.repeat(95));
  console.log(
    '#'.padEnd(3) +
    'Strategy'.padEnd(22) +
    'Activo'.padEnd(10) +
    'WR'.padStart(8) +
    'TotR'.padStart(9) +
    'DD'.padStart(7) +
    'Decay'.padStart(8) +
    'MargenBE'.padStart(10)
  );
  console.log('─'.repeat(95));
  list.forEach((s, i) => {
    console.log(
      String(i+1).padEnd(3) +
      s.id.padEnd(22) +
      s.asset.padEnd(10) +
      (s.wr.toFixed(1)+'%').padStart(8) +
      ('+' + s.totalR.toFixed(0) + 'R').padStart(9) +
      (s.dd.toFixed(0) + 'R').padStart(7) +
      ((s.decay>0?'+':'') + s.decay.toFixed(0) + '%').padStart(8) +
      ('+' + s.margin.toFixed(1) + 'pp').padStart(10)
    );
  });
}

console.log('\n' + '═'.repeat(95));
console.log('RESUMEN:');
for (const tier of ['A — ROBUSTA', 'B — VIABLE', 'C — MARGINAL', 'D — RIESGOSA']) {
  console.log('  ' + tier + ': ' + tiers[tier].length + ' estrategias');
}
console.log('═'.repeat(95));
