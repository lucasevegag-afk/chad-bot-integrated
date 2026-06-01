/**
 * server/services/news/finnhub-news.js
 *
 * Fetcher para Finnhub:
 *   - /news?category=general|forex|crypto|merger   → breaking news
 *   - /calendar/economic                            → calendario macro
 *
 * Doc: https://finnhub.io/docs/api
 */

const { createLogger } = require('../../utils/logger');
const log = createLogger('finnhub');

const API_KEY = process.env.FINNHUB_API_KEY || '';
const BASE = 'https://finnhub.io/api/v1';

async function _get(pathQs) {
  if (!API_KEY) throw new Error('FINNHUB_API_KEY no configurada');
  const sep = pathQs.includes('?') ? '&' : '?';
  const url = `${BASE}${pathQs}${sep}token=${API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Finnhub ${res.status}: ${await res.text().catch(() => '')}`);
  return res.json();
}

/**
 * Categorías soportadas por Finnhub: general, forex, crypto, merger
 */
async function fetchMarketNews(category = 'general') {
  try {
    const arr = await _get(`/news?category=${category}`);
    if (!Array.isArray(arr)) return [];
    return arr.map((n) => ({
      source: 'finnhub',
      external_id: `finnhub:${n.id}`,
      title: n.headline || '',
      body: n.summary || '',
      url: n.url || null,
      image: n.image || null, // ⭐ imagen del artículo (URL CDN de Finnhub)
      category, // 'general' | 'forex' | 'crypto' | 'merger'
      published_at: n.datetime ? new Date(n.datetime * 1000) : new Date(),
      related: typeof n.related === 'string' ? n.related.split(',').filter(Boolean) : [],
    }));
  } catch (err) {
    log.error(`fetchMarketNews(${category}): ${err.message}`);
    return [];
  }
}

/**
 * Calendario económico Finnhub. Devuelve eventos macro.
 * Doc: /calendar/economic?from=YYYY-MM-DD&to=YYYY-MM-DD
 */
async function fetchEconomicCalendar(daysAhead = 2) {
  try {
    const today = new Date();
    const to = new Date(today.getTime() + daysAhead * 24 * 3600 * 1000);
    const fmt = (d) => d.toISOString().slice(0, 10);
    const data = await _get(`/calendar/economic?from=${fmt(today)}&to=${fmt(to)}`);
    const events = (data && data.economicCalendar) || [];
    return events.map((ev) => ({
      source: 'finnhub',
      external_id: `finnhub-cal:${ev.event}:${ev.time}:${ev.country}`,
      title: `${ev.country || ''} · ${ev.event || 'Evento'}`.trim(),
      body: [
        ev.actual != null ? `Actual: ${ev.actual}${ev.unit || ''}` : null,
        ev.estimate != null ? `Estimado: ${ev.estimate}${ev.unit || ''}` : null,
        ev.prev != null ? `Previo: ${ev.prev}${ev.unit || ''}` : null,
      ].filter(Boolean).join(' · ') || null,
      url: null,
      category: 'calendar',
      event_time: ev.time ? new Date(ev.time) : new Date(),
      country: ev.country || null,
      impactRaw: ev.impact || null, // 'low'|'medium'|'high'
    }));
  } catch (err) {
    log.error(`fetchEconomicCalendar: ${err.message}`);
    return [];
  }
}

module.exports = {
  fetchMarketNews,
  fetchEconomicCalendar,
  isConfigured: () => !!API_KEY,
};
