/**
 * server/routes/health.routes.js
 *
 * GET /api/health           → healthcheck básico
 * GET /api/platform/status  → estado de cada subsistema
 */

const os = require('os');
const { Router } = require('express');
const { assetScanner } = require('../bot/scanner/assetScanner');
const { wsServer } = require('../websocket/websocketServer');
const { nowIso } = require('../utils/time');

const router = Router();

router.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'Chad Inversor Platform',
    status: 'running',
  });
});

router.get('/platform/status', (req, res) => {
  res.json({
    website: 'online',
    bot: assetScanner.running ? 'running' : 'initializing',
    websocket: wsServer.isOnline() ? 'online' : 'offline',
    timestamp: nowIso(),
  });
});

/**
 * GET /api/sysmem
 * Devuelve memoria REAL del sistema operativo (no del browser).
 * Útil para que el frontend muestre RAM total de la PC en el footer.
 */
router.get('/sysmem', (req, res) => {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  res.json({
    total_bytes: total,
    free_bytes: free,
    used_bytes: used,
    total_mb: Math.round(total / 1024 / 1024),
    free_mb: Math.round(free / 1024 / 1024),
    used_mb: Math.round(used / 1024 / 1024),
    total_gb: +(total / 1024 / 1024 / 1024).toFixed(2),
    used_gb: +(used / 1024 / 1024 / 1024).toFixed(2),
    used_pct: +((used / total) * 100).toFixed(1),
    timestamp: nowIso(),
  });
});

module.exports = router;
