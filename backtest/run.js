/**
 * backtest/run.js
 *
 * Entry point del backtest. Carga CSVs descargados por download.js,
 * corre el harness con la estrategia S1, y emite reporte + CSV de trades.
 *
 * Uso:
 *   node backtest/run.js                            # default: XAUUSD, autodetect range
 *   node backtest/run.js XAUUSD 2021 2026           # rango custom
 */

const path = require('path');
const fs = require('fs');

const { runBacktest, readCsv } = require('./harness');
const { computeStats, printReport, writeResults } = require('./report');

const DATA_DIR    = path.join(__dirname, 'data');
const RESULTS_DIR = path.join(__dirname, 'results');

function parseArgs() {
  const args = process.argv.slice(2);
  const symbol = (args[0] || 'XAUUSD').toUpperCase();

  // Si no pasaron from/to, escaneo data/ buscando el más reciente que matchee
  const files = fs.existsSync(DATA_DIR) ? fs.readdirSync(DATA_DIR) : [];
  const m5File = files.find((f) => f.startsWith(`${symbol}-M5-`) && f.endsWith('.csv'));
  if (!m5File) {
    console.error(`❌ No hay archivo M5 para ${symbol} en ${DATA_DIR}`);
    console.error(`   Corré primero: node backtest/download.js ${symbol}`);
    process.exit(1);
  }

  // Extraer rango del nombre: XAUUSD-M5-2021-2026.csv
  const m = m5File.match(/(\d{4})-(\d{4})\.csv$/);
  const from = args[1] || (m ? m[1] : '????');
  const to   = args[2] || (m ? m[2] : '????');

  return { symbol, from, to };
}

function fileFor(symbol, tf, from, to) {
  return path.join(DATA_DIR, `${symbol}-${tf}-${from}-${to}.csv`);
}

function main() {
  const { symbol, from, to } = parseArgs();

  console.log(`\n🧪 Iniciando backtest`);
  console.log(`   Activo:    ${symbol}`);
  console.log(`   Rango:     ${from} → ${to}`);
  console.log(`   Estrategia: S1 (sweep+reclaim + filtros)\n`);

  // Cargar CSVs
  const paths = {
    m5:  fileFor(symbol, 'M5',  from, to),
    m15: fileFor(symbol, 'M15', from, to),
    h1:  fileFor(symbol, 'H1',  from, to),
    h4:  fileFor(symbol, 'H4',  from, to),
  };

  for (const [tf, p] of Object.entries(paths)) {
    if (!fs.existsSync(p)) {
      console.error(`❌ Falta archivo ${tf}: ${p}`);
      console.error(`   Corré primero: node backtest/download.js ${symbol}`);
      process.exit(1);
    }
  }

  console.log('📂 Cargando CSVs...');
  const m5  = readCsv(paths.m5);
  const m15 = readCsv(paths.m15);
  const h1  = readCsv(paths.h1);
  const h4  = readCsv(paths.h4);
  console.log(`   M5:  ${m5.length.toLocaleString()} velas`);
  console.log(`   M15: ${m15.length.toLocaleString()} velas`);
  console.log(`   H1:  ${h1.length.toLocaleString()} velas`);
  console.log(`   H4:  ${h4.length.toLocaleString()} velas\n`);

  console.log('🚶 Walk-forward...');
  const t0 = Date.now();
  const trades = runBacktest({
    symbol, m5, m15, h1, h4,
    onProgress: ({ tradesSoFar, progressPct }) => {
      process.stdout.write(`\r   ${progressPct.toFixed(1)}% · trades: ${tradesSoFar}   `);
    },
  });
  const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n   ⏱️  ${elapsedSec}s\n`);

  const stats = computeStats(trades);
  const meta = {
    symbol,
    strategy: 'S1',
    from, to,
    totalBars: m5.length,
    runAt: new Date().toISOString(),
    config: {
      cooldownMs: 5 * 60 * 1000,
      timeoutBarsM5: 576,
      atrPeriod: 14,
      atrSlMult: 1,
      atrTpMult: 2,
    },
  };

  printReport(stats, meta);
  writeResults({ trades, stats, meta, outDir: RESULTS_DIR });
}

main();
