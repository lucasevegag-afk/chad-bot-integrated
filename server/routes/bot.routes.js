/**
 * server/routes/bot.routes.js
 *
 * GET /api/bot/status       → estado del scanner + activos + señales activas
 * GET /api/bot/state/:asset → snapshot completo del activo (precio, velas, bot, signals)
 * GET /api/bot/signals      → últimas señales emitidas (todos los activos)
 */

const { Router } = require('express');
const { assetScanner } = require('../bot/scanner/assetScanner');
const { botStateStore } = require('../bot/botStateStore');

const router = Router();

router.get('/status', (_req, res) => {
  res.json(assetScanner.getStatus());
});

router.get('/state/:asset', (req, res) => {
  const asset = req.params.asset.toUpperCase();
  res.json(botStateStore.getSnapshot(asset));
});

router.get('/signals', (_req, res) => {
  const signals = botStateStore
    .listSymbols()
    .flatMap((s) => botStateStore.ensure(s).activeSignals);
  signals.sort((a, b) => b.timestamp - a.timestamp);
  res.json({ signals: signals.slice(0, 50) });
});

module.exports = router;
