/**
 * server/bot/engines/sessionFlowEngine.js
 *
 * SESSION FLOW ENGINE
 *
 * Identifica en qué sesión global estamos (Asia / Londres / NY) y la fase
 * dentro de la sesión:
 *   - ASIA          (acumulación, rangos chicos)
 *   - LONDON_OPEN   (apertura Londres, alta volatilidad)
 *   - LONDON        (sesión Londres en curso)
 *   - NY_OPEN       (apertura NY, primer movimiento)
 *   - NY_AM         (sesión NY mañana)
 *   - NY_LUNCH      (compresión, evitar operar)
 *   - NY_PM         (sesión NY tarde, posibles reversiones)
 *   - CLOSE         (cierre, baja volatilidad)
 *
 * Las horas son UTC para que sirvan globalmente.
 */

const { createLogger } = require('../../utils/logger');
const log = createLogger('sessionFlow');

/**
 * Mapping aproximado UTC (puede afinarse según DST).
 */
function detectSession(ts = Date.now()) {
  const d = new Date(ts);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const total = h * 60 + m;

  // 00:00–07:00 UTC → Asia
  if (total >= 0 && total < 7 * 60) return 'ASIA';
  // 07:00–08:00 UTC → London open
  if (total >= 7 * 60 && total < 8 * 60) return 'LONDON_OPEN';
  // 08:00–13:30 UTC → London
  if (total >= 8 * 60 && total < 13 * 60 + 30) return 'LONDON';
  // 13:30–15:00 UTC → NY open
  if (total >= 13 * 60 + 30 && total < 15 * 60) return 'NY_OPEN';
  // 15:00–17:00 UTC → NY AM
  if (total >= 15 * 60 && total < 17 * 60) return 'NY_AM';
  // 17:00–18:00 UTC → NY lunch (evitar)
  if (total >= 17 * 60 && total < 18 * 60) return 'NY_LUNCH';
  // 18:00–20:00 UTC → NY PM
  if (total >= 18 * 60 && total < 20 * 60) return 'NY_PM';
  // 20:00–24:00 UTC → CLOSE
  return 'CLOSE';
}

const TRADEABLE = new Set(['LONDON_OPEN', 'LONDON', 'NY_OPEN', 'NY_AM', 'NY_PM']);
const AVOID     = new Set(['NY_LUNCH', 'CLOSE', 'ASIA']);

function evaluate({ symbol, now = Date.now() }) {
  const session = detectSession(now);
  const tradeable = TRADEABLE.has(session);
  const avoid = AVOID.has(session);
  log.debug(`${symbol} session=${session} tradeable=${tradeable}`);
  return {
    sessionState: session,
    tradeable,
    avoid,
  };
}

module.exports = { evaluate, detectSession };
