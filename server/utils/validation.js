/**
 * server/utils/validation.js
 *
 * Validadores reutilizables para inputs de la API.
 */

const { SUPPORTED_TIMEFRAMES } = require('./time');

const SYMBOL_RE = /^[A-Z0-9]{3,20}$/;

function isValidSymbol(s) {
  return typeof s === 'string' && SYMBOL_RE.test(s);
}

function isValidTimeframe(tf) {
  return typeof tf === 'string' && SUPPORTED_TIMEFRAMES.includes(tf);
}

function isJsonString(s) {
  if (typeof s !== 'string') return false;
  try { JSON.parse(s); return true; } catch { return false; }
}

function clampInt(n, min, max, fallback) {
  const x = parseInt(n, 10);
  if (Number.isNaN(x)) return fallback;
  return Math.max(min, Math.min(max, x));
}

module.exports = {
  isValidSymbol,
  isValidTimeframe,
  isJsonString,
  clampInt,
};
