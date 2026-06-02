/**
 * backtest/sweep.js
 *
 * Corre múltiples configs en serie y muestra tabla comparativa.
 */

const { spawnSync } = require('child_process');
const path = require('path');

// Base D: HTF bias + sin NY_PM + sin horas malas
const BASE_D = {
  S1_BAD_SESSIONS: 'NY_PM',
  S1_BAD_HOURS: '10,15,18',
};

// Base N3 ganadora (London + NY KZ)
const BASE_N3 = {
  S1_BAD_SESSIONS: 'NY_PM',
  S1_BAD_DOWS: '1',
  S1_KILLZONES: '7,8,9,12,13,14',
};

// Base P1 = N3 con SL×1 TP×0.5 (70.9% wr)
const BASE_P1 = {
  S1_BAD_SESSIONS: 'NY_PM',
  S1_BAD_DOWS: '1',
  S1_KILLZONES: '7,8,9,12,13,14',
  S1_SL_MULT: '1',
  S1_TP_MULT: '0.5',
};

const EXPERIMENTS = [
  // Baseline para comparar
  { name: 'P1 · baseline (SL×1 TP×0.5)', env: { ...BASE_P1 } },

  // Propuesta A · quirúrgica
  // - Eliminar hora 09 UTC (worst en killzone London)
  // - Eliminar Martes (avgR +0.016)
  // - Eliminar sweep > 80% ATR (volatilidad caótica)
  {
    name: 'A · quirúrgica (sin 09 + sin Mar + sin sweep gigante)',
    env: {
      ...BASE_P1,
      S1_KILLZONES: '7,8,12,13,14',      // sin 09
      S1_BAD_DOWS: '1,2',                 // sin Mon + Mar
      S1_MAX_SWEEP_ATR: '80',
    },
  },

  // Propuesta B · sniper (solo lo mejor)
  // - Solo horas 07, 08, 14 (los outliers ganadores)
  // - Solo Jue, Vie, Mié (días positivos)
  // - Solo sweep depth 25-50% (la zona dorada)
  // - Solo reclaim 2-bar
  {
    name: 'B · sniper (solo lo mejor en TODO)',
    env: {
      ...BASE_P1,
      S1_KILLZONES: '7,8,14',
      S1_BAD_DOWS: '0,1,2,6',             // sin Dom/Lun/Mar/Sab
      S1_MIN_SWEEP_ATR: '25',
      S1_MAX_SWEEP_ATR: '50',
      S1_RECLAIM_BARS: '2',
    },
  },

  // Variantes B suavizadas (B es muy restrictivo, exploramos B-)
  {
    name: 'B- · sniper suave (sin solo-2-bar)',
    env: {
      ...BASE_P1,
      S1_KILLZONES: '7,8,14',
      S1_BAD_DOWS: '0,1,2,6',
      S1_MIN_SWEEP_ATR: '25',
      S1_MAX_SWEEP_ATR: '50',
    },
  },
  {
    name: 'B-- · sniper muy suave (solo h+día)',
    env: {
      ...BASE_P1,
      S1_KILLZONES: '7,8,14',
      S1_BAD_DOWS: '0,1,2,6',
    },
  },
];

const results = [];

for (const exp of EXPERIMENTS) {
  console.log(`\n🧪 ${exp.name}`);

  const child = spawnSync('node', [path.join(__dirname, 'run.js')], {
    env: { ...process.env, ...exp.env },
    encoding: 'utf8',
  });

  const out = child.stdout || '';

  const grab = (re, fallback = '—') => {
    const m = out.match(re);
    return m ? m[1].trim() : fallback;
  };

  const r = {
    name: exp.name,
    trades:   grab(/Trades:\s+(\d+)/),
    wins:     grab(/Wins:\s+(\d+)/),
    winRate:  grab(/Wins:\s+\d+\s+\(([\d.]+)%\)/),
    avgR:     grab(/Avg R:\s+([\d.-]+)/),
    totalR:   grab(/Total R:\s+([\d.-]+)/),
    maxDD:    grab(/Max DD:\s+([\d.-]+)/),
    maxLoss:  grab(/Max losing streak:\s+(\d+)/),
  };
  results.push(r);

  console.log(`   → ${r.trades} trades · ${r.winRate}% wr · ${r.totalR}R · DD ${r.maxDD}R · streak ${r.maxLoss}`);
}

console.log('\n\n' + '═'.repeat(105));
console.log('📊 COMPARATIVA · XAU/USD S1 · iteración 5 (exit + day + depth)');
console.log('═'.repeat(105));
console.log(
  'Experimento'.padEnd(42) +
  'Trades'.padStart(8) +
  'Win%'.padStart(8) +
  'AvgR'.padStart(8) +
  'TotR'.padStart(9) +
  'MaxDD'.padStart(8) +
  'Streak'.padStart(8) +
  '  R/DD'
);
console.log('─'.repeat(105));
for (const r of results) {
  const rOverDd = (Number(r.totalR) / Number(r.maxDD || 1)).toFixed(1);
  console.log(
    r.name.padEnd(42) +
    r.trades.padStart(8) +
    (r.winRate + '%').padStart(8) +
    r.avgR.padStart(8) +
    r.totalR.padStart(9) +
    r.maxDD.padStart(8) +
    r.maxLoss.padStart(8) +
    '   ' + rOverDd
  );
}
console.log('═'.repeat(105) + '\n');
