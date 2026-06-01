/**
 * server/services/news/pre-event-scheduler.js
 *
 * Lookahead scheduler: cada 2 min consulta news_events buscando eventos HIGH
 * cuyo event_time esté entre +25min y +35min de ahora, y dispara una alerta
 * anticipada vía pushAlert.
 *
 * Las "news" tienen event_time = published_at (pasado) → no califican.
 * Solo los "calendar" events tienen event_time futuro → estos sí.
 */

const { createLogger } = require('../../utils/logger');
const { supabase, pushAlert } = require('../supabase.service');

const log = createLogger('pre-event');

const ENABLED = (process.env.PRE_EVENT_ENABLED || 'true').toLowerCase() !== 'false';
const LOOKAHEAD_MIN = parseInt(process.env.PRE_EVENT_LOOKAHEAD_MIN || '30', 10);
const WINDOW_MIN    = parseInt(process.env.PRE_EVENT_WINDOW_MIN    || '5',  10);
const POLL_SEC      = parseInt(process.env.PRE_EVENT_POLL_SEC      || '120', 10);

// IDs de news_events ya pre-alertados (memoria; TTL ~2h)
const _alertedIds = new Map(); // id → ts
const _TTL_MS = 2 * 60 * 60 * 1000;
function _cleanAlerted() {
  const cutoff = Date.now() - _TTL_MS;
  for (const [k, ts] of _alertedIds.entries()) if (ts < cutoff) _alertedIds.delete(k);
}

let _timer = null;

async function _findUpcoming() {
  if (!supabase) return [];
  const now = new Date();
  const lo = new Date(now.getTime() + (LOOKAHEAD_MIN - WINDOW_MIN) * 60 * 1000);
  const hi = new Date(now.getTime() + (LOOKAHEAD_MIN + WINDOW_MIN) * 60 * 1000);

  try {
    const { data, error } = await supabase
      .from('news_events')
      .select('id, title, body, affected_assets, impact, event_time')
      .eq('impact', 'high')
      .gte('event_time', lo.toISOString())
      .lte('event_time', hi.toISOString())
      .order('event_time', { ascending: true });
    if (error) {
      log.error(`Query upcoming err: ${error.message}`);
      return [];
    }
    return data || [];
  } catch (err) {
    log.error(`Query upcoming exception: ${err.message}`);
    return [];
  }
}

async function _alertedRecently(title) {
  // Chequea si ya hay un alert con prefijo "⏰" para este título en última hora.
  // Defensa contra restarts del proceso.
  if (!supabase) return false;
  try {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data } = await supabase
      .from('alerts')
      .select('id')
      .ilike('narrative', `%${title.slice(0, 60)}%`)
      .gte('created_at', since)
      .limit(1);
    return !!(data && data.length);
  } catch {
    return false;
  }
}

async function _tick() {
  if (!ENABLED) return;
  const events = await _findUpcoming();
  if (!events.length) return;

  let pushed = 0, skipped = 0;
  for (const ev of events) {
    if (_alertedIds.has(ev.id)) { skipped++; continue; }

    // Dedup contra alerts (por si el proceso se reinició)
    const dupe = await _alertedRecently(ev.title);
    if (dupe) {
      _alertedIds.set(ev.id, Date.now());
      skipped++;
      continue;
    }

    const assets = Array.isArray(ev.affected_assets) && ev.affected_assets.length
      ? ev.affected_assets
      : ['XAUUSD']; // fallback razonable para macro USA si no se pudo mapear

    // Solo el top-1 activo para no spammear
    const asset = assets[0];
    const minsLeft = Math.round((new Date(ev.event_time).getTime() - Date.now()) / 60000);

    const res = await pushAlert({
      asset,
      type: 'macro_event',
      level: 'high',
      title: `⏰ En ${minsLeft} min: ${ev.title}`,
      message: ev.body || 'Evento macro de alto impacto inminente. Revisar exposición.',
    });
    if (res.ok) {
      _alertedIds.set(ev.id, Date.now());
      pushed++;
    } else if ((res.error || '').includes('dedup')) {
      _alertedIds.set(ev.id, Date.now());
      skipped++;
    } else {
      log.warn(`Push pre-event falló: ${res.error}`);
    }
  }
  _cleanAlerted();
  if (pushed || skipped) {
    log.info(`Pre-event tick: found=${events.length} pushed=${pushed} skipped=${skipped}`);
  }
}

function start() {
  if (!ENABLED) {
    log.warn('Pre-event scheduler DESHABILITADO (PRE_EVENT_ENABLED=false).');
    return;
  }
  log.info(`Pre-event scheduler iniciado · lookahead=${LOOKAHEAD_MIN}min · window=±${WINDOW_MIN}min · poll=${POLL_SEC}s`);
  // Primer tick desfasado para no chocar con news/calendar fetchers
  setTimeout(_tick, 30 * 1000);
  _timer = setInterval(_tick, POLL_SEC * 1000);
}

function stop() {
  if (_timer) clearInterval(_timer);
  _timer = null;
}

module.exports = {
  start,
  stop,
  // Para forzar manualmente desde la ruta
  runOnce: _tick,
};
