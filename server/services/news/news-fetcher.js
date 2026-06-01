/**
 * server/services/news/news-fetcher.js
 *
 * Scheduler: corre ciclos de noticias + calendario en intervalos.
 * Lanzado desde server.js en el bootstrap.
 */

const { createLogger } = require('../../utils/logger');
const { runNewsCycle, runCalendarCycle } = require('./news-collector');
const finnhub = require('./finnhub-news');
const twelvedata = require('./twelvedata-news');
const preEvent = require('./pre-event-scheduler');

const log = createLogger('news-fetcher');

const ENABLED = (process.env.NEWS_FETCHER_ENABLED || 'true').toLowerCase() !== 'false';
const NEWS_MIN = Math.max(2, parseInt(process.env.NEWS_POLL_INTERVAL_MIN || '10', 10));
const CAL_MIN  = Math.max(15, parseInt(process.env.CALENDAR_POLL_INTERVAL_MIN || '60', 10));

let _newsTimer = null;
let _calTimer  = null;

async function _safeRunNews() {
  try { await runNewsCycle(); }
  catch (e) { log.error(`news cycle err: ${e.message}`); }
}
async function _safeRunCalendar() {
  try { await runCalendarCycle(); }
  catch (e) { log.error(`calendar cycle err: ${e.message}`); }
}

function start() {
  if (!ENABLED) {
    log.warn('News fetcher DESHABILITADO (NEWS_FETCHER_ENABLED=false).');
    return;
  }
  if (!finnhub.isConfigured() && !twelvedata.isConfigured()) {
    log.warn('No hay API keys de noticias configuradas. Skip.');
    return;
  }

  log.info(`Iniciando news fetcher · news=${NEWS_MIN}min · calendar=${CAL_MIN}min`);

  // Primer disparo desfasado para no saturar al boot
  setTimeout(_safeRunNews, 15 * 1000);
  setTimeout(_safeRunCalendar, 45 * 1000);

  _newsTimer = setInterval(_safeRunNews, NEWS_MIN * 60 * 1000);
  _calTimer  = setInterval(_safeRunCalendar, CAL_MIN  * 60 * 1000);

  // Scheduler de pre-eventos (mira la tabla, no consume APIs)
  preEvent.start();
}

function stop() {
  if (_newsTimer) clearInterval(_newsTimer);
  if (_calTimer)  clearInterval(_calTimer);
  _newsTimer = _calTimer = null;
  preEvent.stop();
}

module.exports = { start, stop };
