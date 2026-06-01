/**
 * server/bot/engines/nyManipulationEngine.js
 *
 * NY MANIPULATION ENGINE
 *
 * Detecta el patrón típico de NY (9:30–11:30 ET aprox.):
 *   1. Amague inicial en una dirección (false move).
 *   2. Mecha de manipulación con sweep de liquidez del lado contrario.
 *   3. Reversión real con displacement.
 *
 * Esta es la fase crítica del bot: distinguir el primer movimiento engañoso
 * del movimiento real que ocurre después.
 *
 * Inputs esperados: velas M1/M5/M15 + ventana horaria NY + ATR.
 * Output: { phase, manipulationDetected, reversalConfirmed, side, score }
 *
 * Lógica fina por replicar de indexbot_3.html (S1: sweep + displacement + FVG).
 */

const { createLogger } = require('../../utils/logger');
const log = createLogger('nyManip');

const NY_OPEN_UTC = 13;   // 09:30 ET ≈ 13:30 UTC (EDT). Ajuste estacional simple.
const NY_END_UTC  = 17;   // 13:00 ET ≈ 17:00 UTC.

function isInNyWindow(ts) {
  const d = new Date(ts);
  const h = d.getUTCHours();
  return h >= NY_OPEN_UTC && h <= NY_END_UTC;
}

function _detectSweep(candles, lookback = 10) {
  if (candles.length < lookback + 2) return { sweepHigh: false, sweepLow: false };
  const ref = candles.slice(-lookback - 2, -2);
  const last = candles[candles.length - 1];
  const maxH = Math.max(...ref.map((c) => c.high));
  const minL = Math.min(...ref.map((c) => c.low));
  return {
    sweepHigh: last.high > maxH && last.close < maxH,
    sweepLow:  last.low  < minL && last.close > minL,
  };
}

function _detectDisplacement(candles, atr) {
  if (candles.length < 2 || !atr) return { bull: false, bear: false };
  const last = candles[candles.length - 1];
  const body = Math.abs(last.close - last.open);
  if (body < atr * 1.5) return { bull: false, bear: false };
  return {
    bull: last.close > last.open,
    bear: last.close < last.open,
  };
}

function _atr(candles, period = 14) {
  if (candles.length < period + 1) return null;
  const trs = [];
  for (let i = candles.length - period; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  return trs.reduce((a, b) => a + b, 0) / trs.length;
}

function evaluate({ symbol, candlesByTf, now = Date.now() }) {
  if (!isInNyWindow(now)) {
    return { phase: 'OUT_OF_WINDOW', manipulationDetected: false, score: 0 };
  }
  const m5 = candlesByTf['5m'] || [];
  if (m5.length < 30) {
    return { phase: 'WARMUP', manipulationDetected: false, score: 0 };
  }
  const atr = _atr(m5, 14);
  const { sweepHigh, sweepLow } = _detectSweep(m5, 10);
  const { bull, bear } = _detectDisplacement(m5, atr);

  // Sweep + displacement contrario = manipulación detectada + reversión.
  const reversalLong  = sweepLow  && bull;
  const reversalShort = sweepHigh && bear;

  let phase = 'WATCHING';
  let manipulationDetected = sweepHigh || sweepLow;
  let reversalConfirmed = reversalLong || reversalShort;
  let side = reversalLong ? 'long' : reversalShort ? 'short' : null;

  if (reversalConfirmed) phase = 'REVERSAL_CONFIRMED';
  else if (manipulationDetected) phase = 'MANIPULATION';

  const score = (manipulationDetected ? 30 : 0) + (reversalConfirmed ? 40 : 0);
  log.debug(`${symbol} NY phase=${phase} side=${side} score=${score}`);
  return { phase, manipulationDetected, reversalConfirmed, side, score };
}

module.exports = { evaluate, isInNyWindow };
