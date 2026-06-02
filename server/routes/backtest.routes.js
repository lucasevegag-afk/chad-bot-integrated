/**
 * server/routes/backtest.routes.js
 *
 * Endpoints para la página /entrenamiento.html:
 *   GET  /api/backtest/dataset?symbol=XAUUSD   → stats del data/ (filas, rangos, tamaño)
 *   GET  /api/backtest/last?symbol=XAUUSD     → último backtest si existe
 *   POST /api/backtest/run    { symbol }       → corre un backtest sincrónico (block until done)
 *                                                Útil para datasets ya descargados.
 *
 * NO bloquea el bot live — corre en el mismo proceso pero con timeout protegido.
 */

const { Router } = require('express');
const fs = require('fs');
const path = require('path');
const stratRegistry = require('../bot/strategies/registry');

const BACKTEST_DIR = path.join(__dirname, '..', '..', 'backtest');
const DATA_DIR     = path.join(BACKTEST_DIR, 'data');
const RESULTS_DIR  = path.join(BACKTEST_DIR, 'results');

const router = Router();

// ─────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────
function findCsvForTf(symbol, tf) {
  if (!fs.existsSync(DATA_DIR)) return null;
  const files = fs.readdirSync(DATA_DIR);
  return files.find(f => f.startsWith(`${symbol}-${tf}-`) && f.endsWith('.csv')) || null;
}

function csvStats(filePath) {
  const stat = fs.statSync(filePath);
  const sizeMB = (stat.size / 1024 / 1024).toFixed(2);

  // Leer primera fila de datos y la última sin cargar todo en memoria
  const fd = fs.openSync(filePath, 'r');
  const headerBuf = Buffer.alloc(200);
  fs.readSync(fd, headerBuf, 0, 200, 0);
  const header = headerBuf.toString('utf8').split('\n')[0];

  // Primera línea de datos
  const firstBuf = Buffer.alloc(200);
  fs.readSync(fd, firstBuf, 0, 200, header.length + 1);
  const firstLine = firstBuf.toString('utf8').split('\n')[0];

  // Última línea: leer los últimos 500 bytes
  const tailSize = Math.min(stat.size, 500);
  const tailBuf = Buffer.alloc(tailSize);
  fs.readSync(fd, tailBuf, 0, tailSize, stat.size - tailSize);
  fs.closeSync(fd);
  const tailLines = tailBuf.toString('utf8').trim().split('\n');
  const lastLine = tailLines[tailLines.length - 1];

  const firstTs = Number(firstLine.split(',')[0]);
  const lastTs  = Number(lastLine.split(',')[0]);

  // Estimar # de filas: tamaño/promedio de fila. Cada fila ~60 bytes
  const avgRowSize = 65;
  const rows = Math.round((stat.size - header.length) / avgRowSize);

  return {
    sizeMB,
    rows,
    from: new Date(firstTs).toISOString().slice(0, 10),
    to:   new Date(lastTs).toISOString().slice(0, 10),
  };
}

// ─────────────────────────────────────────
// GET /api/backtest/dataset
// ─────────────────────────────────────────
router.get('/backtest/dataset', (req, res) => {
  const symbol = (req.query.symbol || 'XAUUSD').toUpperCase();
  const tfs = ['M5', 'M15', 'H1', 'H4'];
  const timeframes = {};

  for (const tf of tfs) {
    const file = findCsvForTf(symbol, tf);
    if (!file) continue;
    try {
      timeframes[tf] = {
        file,
        ...csvStats(path.join(DATA_DIR, file)),
      };
    } catch (e) {
      timeframes[tf] = { file, error: e.message };
    }
  }
  res.json({ symbol, timeframes });
});

// ─────────────────────────────────────────
// GET /api/backtest/last
// ─────────────────────────────────────────
router.get('/backtest/last', (req, res) => {
  const symbol = (req.query.symbol || 'XAUUSD').toUpperCase();
  if (!fs.existsSync(RESULTS_DIR)) return res.json({});

  const files = fs.readdirSync(RESULTS_DIR)
    .filter(f => f.startsWith(`${symbol}-S1-`) && f.endsWith('.json'))
    .sort((a, b) => b.localeCompare(a));

  if (files.length === 0) return res.json({});

  const latest = path.join(RESULTS_DIR, files[0]);
  try {
    const data = JSON.parse(fs.readFileSync(latest, 'utf8'));
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────
// POST /api/backtest/run
// ─────────────────────────────────────────
router.post('/backtest/run', async (req, res) => {
  const symbol = ((req.body && req.body.symbol) || 'XAUUSD').toUpperCase();

  try {
    // Lazy require para no cargar el harness al boot del server
    const { runBacktest, readCsv } = require('../../backtest/harness');
    const { computeStats } = require('../../backtest/report');

    // Buscar archivos
    const files = {};
    for (const tf of ['M5', 'M15', 'H1', 'H4']) {
      const f = findCsvForTf(symbol, tf);
      if (!f) {
        return res.status(400).json({
          ok: false,
          error: `Falta dataset ${tf} para ${symbol}. Corré npm run backtest:download primero.`,
        });
      }
      files[tf] = path.join(DATA_DIR, f);
    }

    const m5  = readCsv(files.M5);
    const m15 = readCsv(files.M15);
    const h1  = readCsv(files.H1);
    const h4  = readCsv(files.H4);

    const t0 = Date.now();
    const trades = runBacktest({ symbol, m5, m15, h1, h4 });
    const stats = computeStats(trades);
    const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);

    // Persistir
    if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });
    const fromYear = new Date(m5[0]?.timestamp || Date.now()).getUTCFullYear();
    const toYear   = new Date(m5[m5.length - 1]?.timestamp || Date.now()).getUTCFullYear();
    const meta = {
      symbol, strategy: 'S1', from: String(fromYear), to: String(toYear),
      totalBars: m5.length, runAt: new Date().toISOString(),
      elapsedSec: Number(elapsedSec),
    };
    const outPath = path.join(RESULTS_DIR, `${symbol}-S1-${fromYear}-${toYear}.json`);
    fs.writeFileSync(outPath, JSON.stringify({ meta, stats }, null, 2));

    res.json({ ok: true, meta, stats });
  } catch (e) {
    console.error('Backtest error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─────────────────────────────────────────
// GET /api/strategies?asset=XAUUSD
// ─────────────────────────────────────────
router.get('/strategies', (req, res) => {
  const asset = (req.query.asset || '').toUpperCase();
  let list = stratRegistry.getAll();
  if (asset) list = list.filter(s => s.asset === asset);
  const active = stratRegistry.getActive();
  res.json({
    strategies: list,
    active: active ? active.strategyId : null,
    activatedAt: active ? active.activatedAt : null,
  });
});

// ─────────────────────────────────────────
// POST /api/strategies/activate  { id }
// ─────────────────────────────────────────
router.post('/strategies/activate', (req, res) => {
  const id = (req.body && req.body.id) || '';
  try {
    const strat = stratRegistry.setActive(id);
    // Nota: el bot live ya hizo require() del s1Strategy en boot.
    // El active.json se aplica al PRÓXIMO restart. Hasta entonces sigue con env.
    res.json({
      ok: true,
      activated: strat.id,
      strategy: strat,
      note: 'Estrategia guardada. Aplica al próximo restart del proceso. En Fly: fly machine restart',
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

module.exports = router;
