/* ════════════════════════════════════════════════════════════════
   /api/photo · proxy a Pexels usando PEXELS_API_KEY de Fly secrets

   GET /api/photo?query=finance&seed=12345&count=20

   Cachea resultados por query en memoria (TTL 1h) para no hammer
   la API de Pexels (límite 200 req/h en free tier).
   ════════════════════════════════════════════════════════════════ */

const express = require('express');
const router = express.Router();

const TTL_MS = 60 * 60 * 1000;
const cache = new Map(); // query → { urls, ts }

async function fetchPexels(query, perPage) {
  const key = process.env.PEXELS_API_KEY;
  if (!key) throw new Error('PEXELS_API_KEY no configurada');

  const cached = cache.get(query);
  if (cached && Date.now() - cached.ts < TTL_MS && cached.urls.length >= perPage) {
    return cached.urls;
  }

  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=landscape`;
  const res = await fetch(url, { headers: { Authorization: key } });
  if (!res.ok) throw new Error(`Pexels HTTP ${res.status}`);
  const data = await res.json();
  const urls = (data.photos || []).map(p => p.src && p.src.large).filter(Boolean);
  cache.set(query, { urls, ts: Date.now() });
  return urls;
}

router.get('/photo', async (req, res) => {
  try {
    const query = String(req.query.query || 'finance business').slice(0, 80);
    const seed = Number(req.query.seed || 0);
    const perPage = Math.min(30, Math.max(5, Number(req.query.count || 20)));

    const urls = await fetchPexels(query, perPage);
    if (urls.length === 0) {
      return res.status(404).json({ error: 'sin resultados', query });
    }
    const picked = urls[Math.abs(seed) % urls.length];
    return res.json({ url: picked, total: urls.length, query });
  } catch (err) {
    console.error('[photo] error:', err.message);
    return res.status(500).json({ error: err.message || 'Error' });
  }
});

module.exports = router;
