/**
 * server/bot/engines/sweepReclaimEngine.js
 *
 * SWEEP & RECLAIM ENGINE
 *
 * Detecta el patrón institucional clásico:
 *   1. Sweep de un nivel obvio de liquidez (high o low previo).
 *   2. Reclaim: precio vuelve dentro del rango anterior tras romper.
 *   3. Confirmación con cierre por encima/debajo del nivel barrido.
 *
 * Es el patrón base de las estrategias S1 (sweep + displacement + FVG) y D2
 * del bot original. Identifica el momento exacto donde aparece una operación
 * de alto valor esperado.
 *
 * Output:
 *   { sweepDetected, sweepSide: 'high'|'low', reclaimed, level, score }
 */

const { createLogger } = require('../../utils/logger');
const log = createLogger('sweepReclaim');

function _pivots(candles, lookback = 30) {
  if (candles.length < lookback) return { highs: [], lows: [] };
  const slice = candles.slice(-lookback);
  const highs = slice.map((c) => c.high);
  const lows  = slice.map((c) => c.low);
  return { swingHigh: Math.max(...highs), swingLow: Math.min(...lows) };
}

function evaluate({ symbol, candlesByTf, timeframe = '5m' }) {
  const candles = candlesByTf[timeframe] || [];
  if (candles.length < 35) {
    return { sweepDetected: false, reclaimed: false, score: 0, level: null };
  }

  // Tomamos pivot del histórico EXCLUYENDO las últimas 3 velas (para no auto-detectarse).
  const ref = candles.slice(0, -3);
  const { swingHigh, swingLow } = _pivots(ref, 30);
  const last3 = candles.slice(-3);

  let sweepHigh = false, sweepLow = false, reclaimed = false, side = null, level = null;

  for (const c of last3) {
    if (c.high > swingHigh && c.close < swingHigh) {
      sweepHigh = true; side = 'high'; level = swingHigh;
    }
    if (c.low  < swingLow  && c.close > swingLow) {
      sweepLow  = true; side = 'low';  level = swingLow;
    }
  }
  const last = candles[candles.length - 1];
  if (sweepHigh && last.close < swingHigh) reclaimed = true;
  if (sweepLow  && last.close > swingLow)  reclaimed = true;

  const sweepDetected = sweepHigh || sweepLow;
  const score = (sweepDetected ? 25 : 0) + (reclaimed ? 25 : 0);

  log.debug(`${symbol} sweep=${sweepDetected} side=${side} reclaimed=${reclaimed} score=${score}`);
  return { sweepDetected, sweepSide: side, reclaimed, level, score };
}

module.exports = { evaluate };
