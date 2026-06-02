/**
 * backtest/report.js
 *
 * Calcula métricas sobre array de trades y emite reporte por consola + JSON/CSV.
 *
 * Métricas clave:
 *   - Win-rate %
 *   - Avg R · Expectancy (R promedio por trade)
 *   - Max consec losses · Max drawdown (en R)
 *   - Distribución por: año · sesión · día semana · hora UTC · sweepSide
 *   - Equity curve (suma acumulada de R)
 */

const fs = require('fs');
const path = require('path');

function pct(num, den) {
  return den > 0 ? (num / den) * 100 : 0;
}

function mean(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function computeStats(trades) {
  if (trades.length === 0) {
    return { total: 0, error: 'Sin trades generados' };
  }

  const wins   = trades.filter((t) => t.result === 'win');
  const losses = trades.filter((t) => t.result === 'loss');
  const flats  = trades.filter((t) => t.result === 'flat');

  // Equity & drawdown
  let equity = 0, peak = 0, maxDd = 0;
  const equityCurve = [];
  let curLossStreak = 0, maxLossStreak = 0;

  for (const t of trades) {
    equity += t.rMultiple;
    equityCurve.push({ time: t.entryTime, equity });
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDd) maxDd = dd;

    if (t.result === 'loss') {
      curLossStreak++;
      if (curLossStreak > maxLossStreak) maxLossStreak = curLossStreak;
    } else if (t.result === 'win') {
      curLossStreak = 0;
    }
  }

  // Distribuciones
  const bySession = {};
  const byYear    = {};
  const byDow     = {};
  const byHour    = {};
  const bySweep   = {};

  for (const t of trades) {
    const d = new Date(t.entryTime);
    const yr = d.getUTCFullYear();
    const dow = d.getUTCDay(); // 0=dom
    const hr = d.getUTCHours();

    (bySession[t.session]   ??= []).push(t);
    (byYear[yr]             ??= []).push(t);
    (byDow[dow]             ??= []).push(t);
    (byHour[hr]             ??= []).push(t);
    (bySweep[t.sweepSide]   ??= []).push(t);
  }

  const summarize = (group) => {
    const out = {};
    for (const [k, arr] of Object.entries(group)) {
      const w = arr.filter((t) => t.result === 'win').length;
      const l = arr.filter((t) => t.result === 'loss').length;
      const f = arr.filter((t) => t.result === 'flat').length;
      out[k] = {
        total: arr.length,
        wins: w,
        losses: l,
        flats: f,
        winRate: pct(w, w + l),
        avgR: mean(arr.map((t) => t.rMultiple)),
      };
    }
    return out;
  };

  return {
    total: trades.length,
    wins: wins.length,
    losses: losses.length,
    flats: flats.length,
    winRate: pct(wins.length, wins.length + losses.length),
    avgR: mean(trades.map((t) => t.rMultiple)),
    avgRWinning: mean(wins.map((t) => t.rMultiple)),
    avgRLosing: mean(losses.map((t) => t.rMultiple)),
    avgBarsHeld: mean(trades.map((t) => t.barsHeld)),
    expectancy: mean(trades.map((t) => t.rMultiple)),
    totalR: equity,
    peakR: peak,
    maxDrawdownR: maxDd,
    maxConsecLosses: maxLossStreak,
    bySession: summarize(bySession),
    byYear:    summarize(byYear),
    byDow:     summarize(byDow),
    byHour:    summarize(byHour),
    bySweep:   summarize(bySweep),
    equityCurve,
  };
}

// ─────────────────────────────────────────
// Pretty-print por consola
// ─────────────────────────────────────────
function printReport(stats, meta) {
  const line = '─'.repeat(60);
  console.log('\n' + line);
  console.log(`📊 BACKTEST REPORT · ${meta.symbol} · ${meta.strategy}`);
  console.log(line);
  console.log(`Período:    ${meta.from} → ${meta.to}`);
  console.log(`Velas M5:   ${meta.totalBars.toLocaleString()}`);
  console.log(`Trades:     ${stats.total}`);
  console.log(line);

  if (stats.total === 0) {
    console.log(`⚠️  ${stats.error}`);
    return;
  }

  console.log(`Wins:       ${stats.wins}  (${stats.winRate.toFixed(1)}%)`);
  console.log(`Losses:     ${stats.losses}`);
  console.log(`Flats:      ${stats.flats}`);
  console.log(`Avg R:      ${stats.avgR.toFixed(3)} R/trade`);
  console.log(`Total R:    ${stats.totalR.toFixed(2)} R acumulados`);
  console.log(`Max DD:     ${stats.maxDrawdownR.toFixed(2)} R`);
  console.log(`Max losing streak: ${stats.maxConsecLosses}`);
  console.log(`Avg bars held: ${stats.avgBarsHeld.toFixed(0)} velas M5`);
  console.log(line);

  const tablize = (title, group) => {
    console.log(`\n📌 ${title}`);
    const rows = Object.entries(group)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 20);
    console.log('  Bucket'.padEnd(20) + 'Trades  Win%   AvgR');
    for (const [k, s] of rows) {
      console.log(
        `  ${String(k).padEnd(18)}` +
        `${String(s.total).padStart(6)}  ` +
        `${s.winRate.toFixed(1).padStart(4)}%  ` +
        `${s.avgR.toFixed(2).padStart(5)}`
      );
    }
  };

  tablize('Por sesión',    stats.bySession);
  tablize('Por año',       stats.byYear);
  tablize('Por sweepSide', stats.bySweep);
  tablize('Por día semana (0=dom)', stats.byDow);
  tablize('Por hora UTC',  stats.byHour);
  console.log(line + '\n');
}

// ─────────────────────────────────────────
// Persistencia: JSON + CSV de trades
// ─────────────────────────────────────────
function writeResults({ trades, stats, meta, outDir }) {
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const stem = `${meta.symbol}-${meta.strategy}-${meta.from}-${meta.to}`;
  const jsonPath = path.join(outDir, `${stem}.json`);
  const csvPath  = path.join(outDir, `${stem}-trades.csv`);

  fs.writeFileSync(jsonPath, JSON.stringify({ meta, stats }, null, 2));

  const header = 'entryTime,entryPrice,direction,atr,sl,tp,exitTime,exitPrice,result,rMultiple,barsHeld,score,session,sweepSide,htfBias,sweepDepthAtrPct,reclaimBars,stopSizePts\n';
  const rows = trades.map((t) =>
    [
      new Date(t.entryTime).toISOString(),
      t.entryPrice.toFixed(2),
      t.direction,
      t.atr.toFixed(2),
      t.sl.toFixed(2),
      t.tp.toFixed(2),
      new Date(t.exitTime).toISOString(),
      t.exitPrice.toFixed(2),
      t.result,
      t.rMultiple.toFixed(3),
      t.barsHeld,
      t.score,
      t.session,
      t.sweepSide,
      t.htfBias,
      (t.sweepDepthAtrPct || 0).toFixed(2),
      t.reclaimBars != null ? t.reclaimBars : -1,
      (t.stopSizePts || 0).toFixed(2),
    ].join(',')
  ).join('\n');
  fs.writeFileSync(csvPath, header + rows + '\n');

  console.log(`💾 Resultados:`);
  console.log(`   ${jsonPath}`);
  console.log(`   ${csvPath}\n`);
}

module.exports = { computeStats, printReport, writeResults };
