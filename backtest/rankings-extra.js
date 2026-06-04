/**
 * backtest/rankings-extra.js
 * 3 rankings adicionales: por consistency, por sample, por timeframe.
 */
const { STRATEGIES } = require('../server/bot/strategies/registry');

function classifyTimeframe(s) {
  const c = s.config;
  const hasPartial = !!c.S1_PARTIAL_TP_MULT;
  const tp = Number(c.S1_TP_MULT || 2);
  if (hasPartial) {
    if (tp >= 2.0) return 'PARTIAL-INTRADAY';
    return 'PARTIAL-SCALP';
  }
  if (tp <= 0.3) return 'SCALP';
  if (tp <= 0.5) return 'SCALP';
  if (tp <= 1.0) return 'INTRADAY';
  return 'SWING';
}

const all = STRATEGIES.map(s => {
  const m = s.metrics;
  // Consistency score:
  // - decay positivo o cero → premio
  // - streak bajo → premio
  // - WR estable (IS ≈ OS) → premio
  // Formula: (1 + decay) × (1/(1+streak/20)) × (1 - |IS-OS|/100) × |avgR|
  const decayBonus = Math.max(0.5, 1 + m.decay_pct / 100);
  const streakPenalty = 1 / (1 + m.maxStreakLosses / 20);
  const wrStability = 1 - Math.abs(m.winRate_IS - m.winRate_OS) / 100;
  const consistency = decayBonus * streakPenalty * wrStability * Math.max(0, m.avgR_OS) * 10;

  return {
    id: s.id, asset: s.asset, tipo: s.category === 'scalping' ? 'scalp' : 'main',
    wr: m.winRate_OS, wr_is: m.winRate_IS,
    avgR: m.avgR_OS, totalR: m.totalR_5y,
    dd: m.maxDD_R, decay: m.decay_pct, streak: m.maxStreakLosses,
    trades: m.trades_5y || 0,
    timeframe: classifyTimeframe(s),
    consistency,
    wrDelta: m.winRate_OS - m.winRate_IS,
  };
});

function printRanking(title, sorted, valueKey, valueFmt, extras = []) {
  console.log('\n' + '═'.repeat(120));
  console.log(`🏆 ${title}`);
  console.log('═'.repeat(120));
  let header =
    '#'.padEnd(4) +
    'Strategy'.padEnd(20) +
    'Activo'.padEnd(10) +
    'Tipo'.padEnd(7) +
    'WR OS'.padStart(8) +
    'AvgR'.padStart(9) +
    'TotR'.padStart(9) +
    'DD'.padStart(7) +
    'Decay'.padStart(8) +
    'Streak'.padStart(7);
  for (const e of extras) header += e.label.padStart(e.width);
  header += '  ' + valueKey.padStart(12);
  console.log(header);
  console.log('─'.repeat(120));
  sorted.forEach((s, i) => {
    const wrStr = s.wr.toFixed(1) + '%';
    const avgRStr = (s.avgR > 0 ? '+' : '') + s.avgR.toFixed(3);
    const totRStr = (s.totalR > 0 ? '+' : '') + s.totalR.toFixed(0) + 'R';
    const ddStr = s.dd.toFixed(0) + 'R';
    const decayStr = (s.decay > 0 ? '+' : '') + s.decay.toFixed(0) + '%';
    const valStr = valueFmt(s);

    let medal = '';
    if (i === 0) medal = ' 🥇';
    else if (i === 1) medal = ' 🥈';
    else if (i === 2) medal = ' 🥉';

    let line =
      String(i + 1).padEnd(4) +
      s.id.padEnd(20) +
      s.asset.padEnd(10) +
      s.tipo.padEnd(7) +
      wrStr.padStart(8) +
      avgRStr.padStart(9) +
      totRStr.padStart(9) +
      ddStr.padStart(7) +
      decayStr.padStart(8) +
      String(s.streak).padStart(7);
    for (const e of extras) line += e.fmt(s).padStart(e.width);
    line += '  ' + valStr.padStart(12) + medal;
    console.log(line);
  });
}

// ─── RANKING 1: CONSISTENCY ───
const byConsistency = [...all].sort((a, b) => b.consistency - a.consistency);
printRanking(
  'RANKING POR CONSISTENCY · Decay positivo + low streak + WR estable IS/OS + AvgR positivo',
  byConsistency,
  'Score',
  s => s.consistency.toFixed(3),
  [{ label: 'WRΔ', width: 8, fmt: s => (s.wrDelta > 0 ? '+' : '') + s.wrDelta.toFixed(1) + 'pp' }]
);

// ─── RANKING 2: SAMPLE SIZE (trades) — más confiable estadísticamente ───
const bySample = [...all].sort((a, b) => b.trades - a.trades);
printRanking(
  'RANKING POR SAMPLE SIZE · Más trades = mayor confianza estadística',
  bySample,
  'Trades',
  s => s.trades.toLocaleString()
);

// ─── RANKING 3: TOP por TIMEFRAME ───
console.log('\n' + '═'.repeat(120));
console.log(`🏆 RANKING POR TIMEFRAME · Top de cada categoría operativa`);
console.log('═'.repeat(120));

const byTf = {};
for (const s of all) {
  (byTf[s.timeframe] = byTf[s.timeframe] || []).push(s);
}

const tfOrder = ['SCALP', 'PARTIAL-SCALP', 'INTRADAY', 'PARTIAL-INTRADAY', 'SWING'];

for (const tf of tfOrder) {
  const list = byTf[tf] || [];
  // Sort by TotalR for each timeframe
  list.sort((a, b) => b.totalR - a.totalR);

  console.log('\n──── ' + tf + ' (' + list.length + ' estrategias) ─────────');
  console.log(
    '#'.padEnd(4) +
    'Strategy'.padEnd(22) +
    'Activo'.padEnd(10) +
    'WR'.padStart(8) +
    'AvgR'.padStart(9) +
    'TotR'.padStart(9) +
    'DD'.padStart(7) +
    'Decay'.padStart(8) +
    'Streak'.padStart(7) +
    '  Verdict'
  );
  console.log('─'.repeat(95));
  // Top 5 per category
  list.slice(0, 5).forEach((s, i) => {
    const wrStr = s.wr.toFixed(1) + '%';
    const avgRStr = (s.avgR > 0 ? '+' : '') + s.avgR.toFixed(3);
    const totRStr = (s.totalR > 0 ? '+' : '') + s.totalR.toFixed(0) + 'R';
    const ddStr = s.dd.toFixed(0) + 'R';
    const decayStr = (s.decay > 0 ? '+' : '') + s.decay.toFixed(0) + '%';
    let medal = '';
    if (i === 0) medal = '🥇';
    else if (i === 1) medal = '🥈';
    else if (i === 2) medal = '🥉';

    console.log(
      String(i + 1).padEnd(4) +
      s.id.padEnd(22) +
      s.asset.padEnd(10) +
      wrStr.padStart(8) +
      avgRStr.padStart(9) +
      totRStr.padStart(9) +
      ddStr.padStart(7) +
      decayStr.padStart(8) +
      String(s.streak).padStart(7) +
      '  ' + medal
    );
  });
}

console.log('\n' + '═'.repeat(120));
