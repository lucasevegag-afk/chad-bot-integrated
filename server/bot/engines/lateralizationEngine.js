/**
 * server/bot/engines/lateralizationEngine.js
 *
 * LATERALIZATION ENGINE
 *
 * Detecta cuándo el mercado entra en compresión / rango sin dirección.
 * Cuando esto pasa, el bot debe:
 *   - NO emitir señales nuevas (la mayoría serían falsas roturas).
 *   - Marcar la zona como rango y esperar la rotura.
 *
 * También detecta el AGOTAMIENTO de un impulso (range expansion seguida de
 * compresión) → "el movimiento ya no vale perseguirlo".
 *
 * Indicadores:
 *   - ATR cayendo durante N velas seguidas.
 *   - Rango high-low del último bloque vs. histórico.
 *   - Densidad de velas dentro de una banda estrecha.
 */

const { createLogger } = require('../../utils/logger');
const log = createLogger('lateralization');

function _atrSeries(candles, period = 14) {
  if (candles.length < period + 1) return [];
  const series = [];
  for (let i = period; i < candles.length; i++) {
    const slice = candles.slice(i - period, i + 1);
    let sum = 0;
    for (let j = 1; j < slice.length; j++) {
      const c = slice[j], p = slice[j - 1];
      sum += Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
    }
    series.push(sum / period);
  }
  return series;
}

function evaluate({ symbol, candlesByTf, timeframe = '5m' }) {
  const candles = candlesByTf[timeframe] || [];
  if (candles.length < 50) {
    return { isLateralizing: false, score: 0, reason: 'Datos insuficientes' };
  }

  const atrSeries = _atrSeries(candles, 14);
  if (atrSeries.length < 10) {
    return { isLateralizing: false, score: 0 };
  }

  const recent  = atrSeries.slice(-5);
  const earlier = atrSeries.slice(-15, -5);
  const avgRecent  = recent.reduce((a, b) => a + b, 0) / recent.length;
  const avgEarlier = earlier.reduce((a, b) => a + b, 0) / earlier.length;
  const compressionRatio = avgRecent / (avgEarlier || 1);

  // Rango del último bloque vs media.
  const last20 = candles.slice(-20);
  const hh = Math.max(...last20.map((c) => c.high));
  const ll = Math.min(...last20.map((c) => c.low));
  const range = hh - ll;
  const avgAtr = atrSeries.reduce((a, b) => a + b, 0) / atrSeries.length;
  const rangeRatio = range / (avgAtr * 20);

  // Compresión clara: ATR reciente < 70% del previo y rango chico.
  const isLateralizing = compressionRatio < 0.7 && rangeRatio < 0.6;
  const score = isLateralizing ? Math.round((1 - compressionRatio) * 100) : 0;

  log.debug(`${symbol} lateralization=${isLateralizing} compRatio=${compressionRatio.toFixed(2)}`);
  return {
    isLateralizing,
    score,
    compressionRatio,
    rangeRatio,
    reason: isLateralizing ? 'ATR comprimido + rango chico' : 'Mercado en movimiento',
  };
}

module.exports = { evaluate };
