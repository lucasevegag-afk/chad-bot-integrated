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

// ─────────────────────────────────────────
// GET /api/bot-live/state?asset=XAUUSD
// ─────────────────────────────────────────
// Devuelve velas M5 + señales + estado bot + posiciones MT5
// para el chart en vivo /bot-live.html
router.get('/bot-live/state', async (req, res) => {
  const asset = (req.query.asset || 'XAUUSD').toUpperCase();
  const limit = Math.min(500, Math.max(50, Number(req.query.limit) || 200));

  // Velas M5
  let candles = [];
  try {
    const { timeframeStore } = require('../candles/timeframeStore');
    const m5 = timeframeStore.getCandles(asset, '5m') || [];
    candles = m5.slice(-limit).map(c => ({
      time: Math.floor(c.timestamp / 1000),
      open: c.open, high: c.high, low: c.low, close: c.close,
    }));
  } catch (e) { /* sin candles */ }

  // Bot state
  let botState = null;
  try {
    const { botStateStore } = require('../bot/botStateStore');
    const s = botStateStore.ensure(asset);
    botState = {
      htfBias: s.htfBias,
      tacticalBias: s.tacticalBias,
      sessionState: s.sessionState,
      isLateralizing: s.isLateralizing,
      manipulationDetected: s.manipulationDetected,
      expansionPhase: s.expansionPhase,
    };
  } catch (e) { /* sin state */ }

  // Señales recientes filtradas por asset
  const allSignals = monitorService.getSignals(50);
  const signals = allSignals.filter(s => s.asset === asset);

  // Posiciones MT5 (vía bridge)
  let positions = [];
  if (MT5_URL && MT5_TOKEN) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      const r = await fetch(`${MT5_URL}/status`, {
        headers: {
          'Authorization': `Bearer ${MT5_TOKEN}`,
          'ngrok-skip-browser-warning': 'true',
          'user-agent': 'chad-bot-live/1.0',
        },
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (r.ok) {
        const data = await r.json();
        positions = data.open_positions || [];
      }
    } catch (e) { /* sin posiciones */ }
  }

  res.json({
    ts: Date.now(),
    asset,
    candles,
    signals,
    botState,
    positions,
  });
});

module.exports = router;
