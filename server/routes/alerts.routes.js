/**
 * server/routes/alerts.routes.js
 *
 * Endpoints para push de alertas a Supabase desde el frontend del bot.
 * Usado por TrapDetector y BasicSignals cuando emiten señales relevantes.
 */

const { Router } = require('express');
const { pushAlert, pushTestAlert, isConfigured, supabase } = require('../services/supabase.service');
const { runNewsCycle, runCalendarCycle } = require('../services/news/news-collector');
const preEvent = require('../services/news/pre-event-scheduler');
const { fetchPexelsImage, pickKeywords } = require('../services/news/og-image-scraper');

const router = Router();

/**
 * POST /api/alerts/news/run
 * Fuerza un ciclo manual de fetch de noticias (Finnhub).
 */
router.post('/alerts/news/run', async (req, res) => {
  try {
    const stats = await runNewsCycle();
    res.json({ ok: true, stats });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/alerts/calendar/run
 * Fuerza un ciclo manual de calendario económico (Finnhub + Twelve Data).
 */
router.post('/alerts/calendar/run', async (req, res) => {
  try {
    const stats = await runCalendarCycle();
    res.json({ ok: true, stats });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/alerts/preevent/run
 * Fuerza un tick del scheduler de pre-eventos.
 */
router.post('/alerts/preevent/run', async (req, res) => {
  try {
    await preEvent.runOnce();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/alerts/news/backfill-images
 * Reemplaza imágenes existentes por Pexels (finance-themed).
 * Body opcional:
 *   - limit: 100 (cuántas filas procesar)
 *   - mode: 'picsum' (default) | 'logos' | 'all-non-pexels'
 *
 * mode picsum: solo URLs picsum.photos
 * mode logos:  URLs típicas de logos de publishers (yimg.com, etc.)
 * mode all-non-pexels: cualquier imagen que no sea ya de Pexels ni og:image (escapes especiales)
 */
router.post('/alerts/news/backfill-images', async (req, res) => {
  if (!supabase) return res.status(500).json({ ok: false, error: 'supabase not configured' });
  const limit = Math.min(200, Math.max(1, parseInt(req.body?.limit || 50, 10)));
  const mode = (req.body?.mode || 'picsum').toLowerCase();

  // Build query según mode
  let query = supabase
    .from('news_events')
    .select('id, affected_assets, source, title')
    .limit(limit);

  if (mode === 'picsum') {
    query = query.like('image_url', 'https://picsum.photos%');
  } else if (mode === 'logos') {
    // Logos típicos de publishers (Yahoo CDN para Reuters, etc.)
    query = query.or('image_url.like.%yimg.com%,image_url.like.%/logo%,image_url.like.%apple-touch-icon%');
  } else if (mode === 'null') {
    // Filas con image_url NULL (típicamente las que nullificamos a mano)
    query = query.is('image_url', null);
  } else if (mode === 'all-non-pexels') {
    query = query.or('image_url.like.https://picsum.photos%,image_url.like.%yimg.com%');
  } else {
    return res.status(400).json({ ok: false, error: 'mode debe ser picsum | logos | null | all-non-pexels' });
  }

  const { data: rows, error } = await query;
  if (error) return res.status(500).json({ ok: false, error: error.message });
  if (!rows || rows.length === 0) {
    return res.json({ ok: true, updated: 0, scanned: 0, mode, message: 'Nada para hacer' });
  }

  let updated = 0, skipped = 0;
  for (const row of rows) {
    const category = row.source === 'finnhub' ? '' : 'calendar';
    const keywords = pickKeywords(row.affected_assets || [], category);
    const url = await fetchPexelsImage(keywords, row.id);
    if (url) {
      const { error: upErr } = await supabase
        .from('news_events')
        .update({ image_url: url })
        .eq('id', row.id);
      if (!upErr) updated++;
      else skipped++;
    } else {
      skipped++;
    }
    await new Promise(r => setTimeout(r, 150));
  }
  res.json({ ok: true, scanned: rows.length, updated, skipped, mode });
});

/**
 * POST /api/alerts/push
 * Body: { asset, type, level, title, message, price?, plan?, timeframe? }
 *
 * Recibe una alerta del frontend del bot y la inserta en Supabase
 * para que aparezca en la app chad-alerts-mobile.
 */
router.post('/alerts/push', async (req, res) => {
  const alert = req.body || {};
  const result = await pushAlert(alert);
  if (result.ok) {
    res.json({ ok: true, id: result.id });
  } else {
    // 202 (accepted but not processed) si es solo dedup; 400 si es error real
    const status = (result.error || '').includes('dedup') ? 202 : 400;
    res.status(status).json(result);
  }
});

/**
 * GET /api/alerts/status
 * Devuelve si Supabase está configurado y operativo.
 */
router.get('/alerts/status', (req, res) => {
  res.json({
    supabaseConfigured: isConfigured(),
    pushEnabled: (process.env.SUPABASE_PUSH_ALERTS || 'true').toLowerCase() !== 'false',
  });
});

/**
 * POST /api/alerts/test
 * Inserta una alerta de prueba en Supabase. Útil para validar la conexión.
 */
router.post('/alerts/test', async (req, res) => {
  const result = await pushTestAlert();
  res.json(result);
});

module.exports = router;
