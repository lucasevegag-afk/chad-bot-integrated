/**
 * backtest/rankings-multi.js
 * 3 rankings adicionales: por AvgR, por R/DD, por composite score.
 */
const { STRATEGIES } = require('../server/bot/strategies/registry');

const all = STRATEGIES.map(s => {
  const m = s.metrics;
  const rdd = m.maxDD_R > 0 ? m.totalR_5y / m.maxDD_R : 0;
  // Composite: AvgR × WR × max(0.5, 1 + decay/100) × (1 / (1 + DD/50))
  // - AvgR: peso por trade
  // - WR/100: psicología
  // - decay factor: robustez (negativo penaliza)
  // - DD penalty: penaliza DDs grandes
  const decayFactor = Math.max(0.5, 1 + m.decay_pct / 100);
  const ddPenalty = 1 / (1 + m.maxDD_R / 50);
  const composite = m.avgR_OS * (m.winRate_OS / 100) * decayFactor * ddPenalty;
  return {
    id: s.id,
    asset: s.asset,
    tipo: s.category === 'scalping' ? 'scalp' : 'main',
    wr: m.winRate_OS,
    avgR: m.avgR_OS,
    totalR: m.totalR_5y,
    dd: m.maxDD_R,
    decay: m.decay_pct,
    streak: m.maxStreakLosses,
    trades: m.trades_5y || 0,
    rdd,
    composite,
  };
});

function printRanking(title, sorted, valueKey, valueFmt) {
  console.log('\n' + '═'.repeat(110));
  console.log(`🏆 ${title}`);
  console.log('═'.repeat(110));
  console.log(
    '#'.padEnd(4) +
    'Strategy'.padEnd(20) +
    'Activo'.padEnd(10) +
    'Tipo'.padEnd(7) +
    'WR'.padStart(8) +
    'AvgR'.padStart(9) +
    'TotR'.padStart(10) +
    'DD'.padStart(8) +
    'Decay'.padStart(9) +
    valueKey.padStart(12) +
    '  Verdict'
  );
  console.log('─'.repeat(110));
  sorted.forEach((s, i) => {
    const wrStr = s.wr.toFixed(1) + '%';
    const avgRStr = (s.avgR > 0 ? '+' : '') + s.avgR.toFixed(3);
    const totRStr = (s.totalR > 0 ? '+' : '') + s.totalR.toFixed(0) + 'R';
    const ddStr = s.dd.toFixed(0) + 'R';
    const decayStr = (s.decay > 0 ? '+' : '') + s.decay.toFixed(0) + '%';
    const valStr = valueFmt(s);

    let verdict = '';
    if (i === 0) verdict = ' 🥇';
    else if (i === 1) verdict = ' 🥈';
    else if (i === 2) verdict = ' 🥉';

    console.log(
      String(i + 1).padEnd(4) +
      s.id.padEnd(20) +
      s.asset.padEnd(10) +
      s.tipo.padEnd(7) +
      wrStr.padStart(8) +
      avgRStr.padStart(9) +
      totRStr.padStart(10) +
      ddStr.padStart(8) +
      decayStr.padStart(9) +
      valStr.padStart(12) +
      verdict
    );
  });
}

// ─── RANKING 1: Por AvgR (eficiencia por trade) ───
const byAvgR = [...all].sort((a, b) => b.avgR - a.avgR);
printRanking(
  'RANKING POR AvgR · Eficiencia por trade (cuánto produce cada trade individual)',
  byAvgR,
  'AvgR',
  s => (s.avgR > 0 ? '+' : '') + s.avgR.toFixed(3)
);

// ─── RANKING 2: Por R/DD (risk-adjusted) ───
const byRDD = [...all].sort((a, b) => b.rdd - a.rdd);
printRanking(
  'RANKING POR R/DD · Riesgo-ajustado (TotalR / Max DD — cuánto ganás por unidad de riesgo)',
  byRDD,
  'R/DD',
  s => s.rdd.toFixed(2)
);

// ─── RANKING 3: Por composite score ───
const byComposite = [...all].sort((a, b) => b.composite - a.composite);
printRanking(
  'RANKING COMPOSITE · AvgR × WR × decayFactor × ddPenalty (combina rentabilidad, psicología, robustez, control de riesgo)',
  byComposite,
  'Composite',
  s => s.composite.toFixed(3)
);
