/**
 * server/utils/time.js
 *
 * Helpers de tiempo: conversión de timeframes a milisegundos, alineación
 * de timestamps al inicio de la vela correspondiente, etc.
 */

const TIMEFRAME_MS = {
  '1m':  60 * 1000,
  '5m':  5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '30m': 30 * 60 * 1000,
  '1h':  60 * 60 * 1000,
  '4h':  4 * 60 * 60 * 1000,
  '1d':  24 * 60 * 60 * 1000,
};

const SUPPORTED_TIMEFRAMES = Object.keys(TIMEFRAME_MS);

function tfToMs(tf) {
  return TIMEFRAME_MS[tf] || null;
}

/**
 * Devuelve el timestamp de apertura de la vela que contiene `ts`
 * para el timeframe dado.
 */
function alignToTimeframe(ts, tf) {
  const ms = tfToMs(tf);
  if (!ms) return ts;
  return Math.floor(ts / ms) * ms;
}

function isValidTimeframe(tf) {
  return SUPPORTED_TIMEFRAMES.includes(tf);
}

function nowMs() {
  return Date.now();
}

function nowIso() {
  return new Date().toISOString();
}

module.exports = {
  TIMEFRAME_MS,
  SUPPORTED_TIMEFRAMES,
  tfToMs,
  alignToTimeframe,
  isValidTimeframe,
  nowMs,
  nowIso,
};
