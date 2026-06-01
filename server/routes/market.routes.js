/**
 * server/routes/market.routes.js
 *
 * GET /api/markets/assets         → catálogo de activos
 * GET /api/history/:asset?tf=1m   → velas históricas (REST passthrough al provider)
 */

const { Router } = require('express');
const { manager: marketData } = require('../marketData/marketDataManager');
const { timeframeStore } = require('../candles/timeframeStore');
const { isValidTimeframe, isValidSymbol, clampInt } = require('../utils/validation');

const router = Router();

router.get('/markets/assets', (_req, res) => {
  res.json(marketData.listAssets());
});

router.get('/history/:asset', async (req, res) => {
  const asset = req.params.asset.toUpperCase();
  const tf = req.query.tf || '1m';
  const limit = clampInt(req.query.limit, 10, 1000, 300);

  if (!isValidSymbol(asset)) {
    return res.status(400).json({ error: 'Símbolo inválido' });
  }
  if (!isValidTimeframe(tf)) {
    return res.status(400).json({ error: 'Timeframe inválido' });
  }

  // Si tenemos el bucket en memoria, devolvemos eso (más rápido).
  if (timeframeStore.hasData(asset, tf)) {
    return res.json({
      asset, timeframe: tf,
      candles: timeframeStore.getCandles(asset, tf, limit),
      source: 'cache',
    });
  }

  // Fallback al provider directamente.
  try {
    const candles = await marketData.getHistory(asset, tf, limit);
    res.json({ asset, timeframe: tf, candles, source: 'provider' });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
