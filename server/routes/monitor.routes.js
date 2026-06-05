/**
 * server/routes/monitor.routes.js
 *
 * GET /api/monitor → estado completo del bot + bridge MT5 + posiciones MT5
 */

const { Router } = require('express');
const router = Router();

const monitorService = require('../services/monitorService');
const mt5Bridge      = require('../services/mt5Bridge');

const MT5_URL   = process.env.MT5_BRIDGE_URL || '';
const MT5_TOKEN = process.env.MT5_BRIDGE_TOKEN || '';

router.get('/monitor', async (req, res) => {
  const result = {
    ts: new Date().toISOString(),
    bot: {
      app: 'chad-bot',
      uptime_sec: process.uptime(),
    },
    signals: monitorService.getSignals(20),
    executions: monitorService.getExecutions(20),
    summary: monitorService.getSummary(),
    bridge_stats: mt5Bridge.getStats(),
    mt5: { ok: false, error: 'no consultado' },
  };

  // Intentar consultar el bridge MT5 (Python en PC del usuario)
  if (MT5_URL && MT5_TOKEN) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      const r = await fetch(`${MT5_URL}/status`, {
        headers: {
          'Authorization': `Bearer ${MT5_TOKEN}`,
          'ngrok-skip-browser-warning': 'true',
          'user-agent': 'chad-bot-monitor/1.0',
        },
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (r.ok) {
        result.mt5 = await r.json();
      } else {
        result.mt5 = { ok: false, error: `HTTP ${r.status}` };
      }
    } catch (e) {
      result.mt5 = { ok: false, error: e.message };
    }
  }

  res.json(result);
});

module.exports = router;
