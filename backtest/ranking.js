/**
 * backtest/ranking.js
 * Ranking definitivo de las estrategias del registry,
 * de la más rentable a la menos, con temporalidad / horario / explicación.
 */
const { STRATEGIES } = require('../server/bot/strategies/registry');

function sessionFromConfig(c) {
  if (c.S1_KILLZONES) {
    const kz = c.S1_KILLZONES;
    if (kz === '7,8,9,12,13,14') return 'London KZ (7-9 UTC) + NY KZ (12-14 UTC)';
    if (kz === '8,13') return 'London 8 UTC + NY 13 UTC (centros)';
    return 'Killzones: ' + kz + ' UTC';
  }
  // sin killzones explícitas, usa BAD_HOURS/SESSIONS
  let s = 'London + NY (24h FX)';
  if (c.S1_BAD_SESSIONS) s += ' · sin ' + c.S1_BAD_SESSIONS;
  if (c.S1_BAD_HOURS) s += ' · sin ' + c.S1_BAD_HOURS + ' UTC';
  if (c.S1_BAD_DOWS) {
    const d = c.S1_BAD_DOWS.split(',').map(Number).map(n => ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'][n]).join(',');
    s += ' · sin ' + d;
  }
  return s;
}

function timeframeFromConfig(c) {
  // Todas las estrategias operan en M5 base con multi-TF context (M5/M15/H1/H4).
  // Duración estimada según TP:
  const tp = Number(c.S1_TP_MULT || 2);
  const partial = c.S1_PARTIAL_TP_MULT;
  if (partial) {
    return `M5 · partial 3-15min · final ${(tp*8).toFixed(0)}-${(tp*15).toFixed(0)}min`;
  }
  if (tp <= 0.3) return 'M5 · scalp 3-8 min';
  if (tp <= 0.5) return 'M5 · scalp 5-15 min';
  if (tp <= 1.0) return 'M5 · intradía 10-30 min';
  if (tp <= 2.0) return 'M5 · intradía 20-60 min';
  return 'M5 · swing intradía 30-90 min';
}

function mechanicsFromConfig(c) {
  const sl = c.S1_SL_MULT || '1.0';
  const tp = c.S1_TP_MULT || '2.0';
  const partial = c.S1_PARTIAL_TP_MULT;
  const partFrac = c.S1_PARTIAL_FRACTION;

  let mech = `Sweep+Reclaim · SL ${sl}×ATR · TP ${tp}×ATR`;
  if (partial) {
    mech += ` · Partial: ${(Number(partFrac)*100).toFixed(0)}% cierra en +${partial}×ATR → SL→BE → resto a +${tp}×ATR`;
  }
  return mech;
}

const all = STRATEGIES.map(s => {
  const tp = Number(s.config.S1_TP_MULT || 2);
  const partial = s.config.S1_PARTIAL_TP_MULT;
  // Tipo
  let tipo = 'main';
  if (s.category === 'scalping') tipo = 'scalp';
  return {
    id: s.id,
    asset: s.asset,
    tipo,
    timeframe: timeframeFromConfig(s.config),
    horario: sessionFromConfig(s.config),
    mecanica: mechanicsFromConfig(s.config),
    winRate_OS: s.metrics.winRate_OS,
    avgR_OS: s.metrics.avgR_OS,
    totalR: s.metrics.totalR_5y,
    maxDD: s.metrics.maxDD_R,
    streak: s.metrics.maxStreakLosses,
    decay: s.metrics.decay_pct,
    robust: s.robustness,
  };
});

// Ordenar por TotalR descendente
all.sort((a, b) => b.totalR - a.totalR);

// ─── Imprimir tabla ───
console.log('\n' + '═'.repeat(165));
console.log('🏆 RANKING DEFINITIVO · 53 ESTRATEGIAS · de MÁS rentable a MENOS rentable (Total R 5 años)');
console.log('═'.repeat(165));

const w = {
  rank: 4, id: 18, asset: 8, tipo: 6,
  wr: 6, avgR: 7, totR: 8, dd: 6, streak: 6, decay: 8,
};

console.log(
  '#'.padEnd(w.rank) + ' ' +
  'Strategy'.padEnd(w.id) + ' ' +
  'Activo'.padEnd(w.asset) + ' ' +
  'Tipo'.padEnd(w.tipo) + ' ' +
  'WR'.padStart(w.wr) + ' ' +
  'AvgR'.padStart(w.avgR) + ' ' +
  'TotR'.padStart(w.totR) + ' ' +
  'DD'.padStart(w.dd) + ' ' +
  'Streak'.padStart(w.streak) + ' ' +
  'Decay'.padStart(w.decay) + ' ' +
  'Horario / Mecánica / Temporalidad'
);
console.log('─'.repeat(165));

let i = 1;
for (const s of all) {
  const wrStr = s.winRate_OS.toFixed(1) + '%';
  const avgRStr = (s.avgR_OS > 0 ? '+' : '') + s.avgR_OS.toFixed(3);
  const totRStr = (s.totalR > 0 ? '+' : '') + s.totalR.toFixed(0) + 'R';
  const ddStr = s.maxDD.toFixed(0) + 'R';
  const decayStr = (s.decay > 0 ? '+' : '') + s.decay.toFixed(0) + '%';

  console.log(
    String(i).padEnd(w.rank) + ' ' +
    s.id.padEnd(w.id) + ' ' +
    s.asset.padEnd(w.asset) + ' ' +
    s.tipo.padEnd(w.tipo) + ' ' +
    wrStr.padStart(w.wr) + ' ' +
    avgRStr.padStart(w.avgR) + ' ' +
    totRStr.padStart(w.totR) + ' ' +
    ddStr.padStart(w.dd) + ' ' +
    String(s.streak).padStart(w.streak) + ' ' +
    decayStr.padStart(w.decay) + ' ' +
    s.timeframe
  );
  i++;
}
console.log('═'.repeat(165));

// Top 10 detallado
console.log('\n🥇 TOP 10 DETALLADO');
console.log('═'.repeat(120));
let n = 1;
for (const s of all.slice(0, 10)) {
  console.log(`\n[${n}] ${s.id} (${s.asset} · ${s.tipo})`);
  console.log(`   Mecánica:    ${s.mecanica}`);
  console.log(`   Timeframe:   ${s.timeframe}`);
  console.log(`   Horario:     ${s.horario}`);
  console.log(`   Performance: ${s.winRate_OS.toFixed(1)}% wr OS · AvgR ${s.avgR_OS.toFixed(3)} · TotalR ${s.totalR.toFixed(0)}R · DD ${s.maxDD.toFixed(0)}R · Decay ${s.decay.toFixed(0)}%`);
  n++;
}
console.log('\n' + '═'.repeat(120));
