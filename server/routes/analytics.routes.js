/**
 * server/routes/analytics.routes.js
 *
 * POST /api/analytics/event    → trackear evento desde el frontend
 * GET  /api/analytics/summary  → resumen de contadores
 */

const { Router } = require('express');
const { analyticsService } = require('../services/analyticsService');

const router = Router();

router.post('/analytics/event', (req, res) => {
  const { event, props } = req.body || {};
  if (!event) return res.status(400).json({ error: 'Falta "event"' });
  const item = analyticsService.track({
    event,
    props,
    ip: req.ip,
    ua: req.headers['user-agent'],
  });
  res.json({ ok: true, item });
});

router.get('/analytics/summary', (_req, res) => {
  res.json(analyticsService.summary());
});

module.exports = router;
