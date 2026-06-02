/**
 * backtest/download.js
 *
 * Descarga histórico de velas desde Dukascopy y las guarda como CSV.
 * Uso:
 *   node backtest/download.js                   # XAU/USD, 5 años, M5+M15+H1+H4
 *   node backtest/download.js XAUUSD 2020-01-01 # custom start
 *
 * Output:
 *   backtest/data/XAUUSD-M5-2021-2026.csv
 *   backtest/data/XAUUSD-M15-2021-2026.csv
 *   backtest/data/XAUUSD-H1-2021-2026.csv
 *   backtest/data/XAUUSD-H4-2021-2026.csv
 *
 * Formato CSV:
 *   timestamp,open,high,low,close,volume
 *   1609459200000,1898.45,1899.50,1898.10,1898.95,1234.56
 */

const fs = require('fs');
const path = require('path');
const { getHistoricalRates } = require('dukascopy-node');

// ─────────────────────────────────────────
// Mapeo de símbolos del bot → instrumentos Dukascopy
// ─────────────────────────────────────────
const SYMBOL_MAP = {
  XAUUSD: 'xauusd',
  EURUSD: 'eurusd',
  GBPUSD: 'gbpusd',
  USDJPY: 'usdjpy',
  USOIL:  'lightcmdusd',  // WTI light crude
  // Crypto Dukascopy también tiene BTC pero menos profundo que Binance
  BTCUSDT: 'btcusd',
};

// Timeframes que queremos. Dukascopy usa nombres propios:
//   tick · m1 · m5 · m15 · m30 · h1 · h4 · d1 · mn1
// Orden: los chicos primero (más rápidos) para validar antes de M5.
const TIMEFRAMES = ['h4', 'h1', 'm15', 'm5'];

// Tag de archivo: m5 → M5
const tfLabel = (tf) => tf.toUpperCase();

const DATA_DIR = path.join(__dirname, 'data');

// ─────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const symbol = (args[0] || 'XAUUSD').toUpperCase();
  const startStr = args[1] || null;

  const today = new Date();
  const from = startStr
    ? new Date(startStr)
    : new Date(Date.UTC(today.getUTCFullYear() - 5, today.getUTCMonth(), today.getUTCDate()));

  const to = today;
  return { symbol, from, to };
}

function dateToYMD(d) {
  return d.toISOString().slice(0, 10);
}

function toCsvRow(candle) {
  // dukascopy-node format: { timestamp, open, high, low, close, volume }
  return `${candle.timestamp},${candle.open},${candle.high},${candle.low},${candle.close},${candle.volume ?? 0}`;
}

async function fetchChunk(instrument, tf, from, to, attempt = 1) {
  const MAX_ATTEMPTS = 4;
  try {
    return await getHistoricalRates({
      instrument,
      dates: { from, to },
      timeframe: tf,
      format: 'json',
      priceType: 'bid',
      volumes: true,
      useCache: true,
      cacheFolderPath: path.join(DATA_DIR, '.cache'),
      batchSize: 10,                  // bajamos para evitar Promise.all rejections
      pauseBetweenBatchesMs: 400,
      retryCount: 3,
      retryOnEmpty: true,
      failAfterRetryCount: false,
    });
  } catch (e) {
    if (attempt >= MAX_ATTEMPTS) {
      console.warn(`   ⚠️ Chunk ${dateToYMD(from)}→${dateToYMD(to)} falló tras ${attempt} intentos: ${e.message}`);
      return []; // devolvemos vacío para no romper
    }
    const wait = 2000 * attempt;
    console.warn(`   ⏳ Reintento ${attempt+1}/${MAX_ATTEMPTS} en ${wait}ms (${e.message})`);
    await new Promise(r => setTimeout(r, wait));
    return fetchChunk(instrument, tf, from, to, attempt + 1);
  }
}

async function downloadOne(symbol, tf, from, to) {
  const instrument = SYMBOL_MAP[symbol];
  if (!instrument) throw new Error(`Símbolo no mapeado: ${symbol}`);

  console.log(`📥 ${symbol} ${tfLabel(tf)} · ${dateToYMD(from)} → ${dateToYMD(to)}`);
  const tStart = Date.now();

  // Chunkeamos POR AÑO: si falla un año, los demás siguen.
  const chunks = [];
  const startYear = from.getUTCFullYear();
  const endYear   = to.getUTCFullYear();
  for (let y = startYear; y <= endYear; y++) {
    const chunkFrom = y === startYear ? from : new Date(Date.UTC(y, 0, 1));
    const chunkTo   = y === endYear   ? to   : new Date(Date.UTC(y, 11, 31, 23, 59, 59));
    chunks.push({ from: chunkFrom, to: chunkTo, year: y });
  }

  const all = [];
  for (const ch of chunks) {
    process.stdout.write(`   ⏬ ${ch.year}… `);
    const t0 = Date.now();
    const data = await fetchChunk(instrument, tf, ch.from, ch.to);
    const sec = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`${data.length.toLocaleString().padStart(7)} velas · ${sec}s`);
    all.push(...data);
  }

  // Dedup (chunks pueden solapar en bordes) y orden por timestamp
  const seen = new Set();
  const deduped = [];
  for (const c of all) {
    if (seen.has(c.timestamp)) continue;
    seen.add(c.timestamp);
    deduped.push(c);
  }
  deduped.sort((a, b) => a.timestamp - b.timestamp);

  const data = deduped;
  const elapsed = ((Date.now() - tStart) / 1000).toFixed(1);
  console.log(`   ⏱️  Total ${tfLabel(tf)}: ${elapsed}s`);

  if (!data || data.length === 0) {
    console.warn(`⚠️ Sin datos para ${symbol} ${tf}`);
    return;
  }

  const fileName = `${symbol}-${tfLabel(tf)}-${from.getUTCFullYear()}-${to.getUTCFullYear()}.csv`;
  const filePath = path.join(DATA_DIR, fileName);

  const header = 'timestamp,open,high,low,close,volume\n';
  const rows = data.map(toCsvRow).join('\n');
  fs.writeFileSync(filePath, header + rows + '\n', 'utf8');

  const sizeMb = (fs.statSync(filePath).size / 1024 / 1024).toFixed(2);
  console.log(`   ✅ ${data.length.toLocaleString()} velas → ${fileName} (${sizeMb} MB)`);
}

async function main() {
  const { symbol, from, to } = parseArgs();

  console.log(`\n🚀 Descarga Dukascopy`);
  console.log(`   Activo: ${symbol}`);
  console.log(`   Rango:  ${dateToYMD(from)} → ${dateToYMD(to)}`);
  console.log(`   TFs:    ${TIMEFRAMES.map(tfLabel).join(', ')}\n`);

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  for (const tf of TIMEFRAMES) {
    try {
      await downloadOne(symbol, tf, from, to);
    } catch (err) {
      console.error(`❌ Falló ${symbol} ${tf}: ${err.message}`);
    }
  }

  console.log(`\n✨ Descarga completa. Archivos en ${DATA_DIR}\n`);
}

main().catch((err) => {
  console.error('Error fatal:', err);
  process.exit(1);
});
