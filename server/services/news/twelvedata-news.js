/**
 * server/services/news/twelvedata-news.js
 *
 * Fetcher para Twelve Data:
 *   - /economic_calendar   → eventos macro (USD, EUR, ...)
 *   - /news (Pro)          → noticias por símbolo
 *
 * Doc: https://twelvedata.com/docs
 */

const { createLogger } = require('../../utils/logger');
const log = createLogger('twelvedata-news');

const API_KEY = process.env.TWELVE_DATA_API_KEY || '';
const BASE = 'https://api.twelvedata.com';

async function _get(pathQs) {
  if (!API_KEY) throw new Error('TWELVE_DATA_API_KEY no configurada');
  const sep = pathQs.includes('?') ? '&' : '?';
  const url = `${BASE}${pathQs}${sep}apikey=${API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TwelveData ${res.status}`);
  return res.json();
}

/**
 * Calendario macro Twelve Data.
 * Devuelve eventos con impact: 'Low' | 'Medium' | 'High'.
 */
async function fetchEconomicCalendar(daysAhead = 2) {
  try {
    const today = new Date();
    const to = new Date(today.getTime() + daysAhead * 24 * 3600 * 1000);
    const fmt = (d) => d.toISOString().slice(0, 10);
    const data = await _get(`/economic_calendar?country=US,EU,UK,JP,CN&start_date=${fmt(today)}&end_date=${fmt(to)}`);
    const events = data?.values || data?.events || [];
    if (!Array.isArray(events)) return [];
    return events.map((ev) => ({
      source: 'twelvedata',
      external_id: `td-cal:${ev.event || ''}:${ev.date || ''}:${ev.country || ''}`,
      title: `${ev.country || ''} · ${ev.event || 'Evento'}`.trim(),
      body: [
        ev.actual != null ? `Actual: ${ev.actual}` : null,
        ev.estimate != null ? `Estimado: ${ev.estimate}` : null,
        ev.previous != null ? `Previo: ${ev.previous}` : null,
      ].filter(Boolean).join(' · ') || null,
      url: null,
      category: 'calendar',
      event_time: ev.date ? new Date(ev.date) : new Date(),
      country: ev.country || null,
      impactRaw: (ev.importance || ev.impact || '').toLowerCase(),
    }));
  } catch (err) {
    log.error(`fetchEconomicCalendar: ${err.message}`);
    return [];
  }
}

module.exports = {
  fetchEconomicCalendar,
  isConfigured: () => !!API_KEY,
};
