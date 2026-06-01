/**
 * server/bot/engines/biasEngine.js
 *
 * BIAS ENGINE — Detecta el sesgo direccional (alcista / bajista / neutro)
 * en múltiples timeframes, combinando:
 *   - estructura HH/HL (alcista) o LH/LL (bajista),
 *   - posición relativa a EMAs (50/200),
 *   - posición respecto a pivots H1/H4.
 *
 * El bias H4/H1 → htfBias.
 * El bias M15/M5 → tacticalBias.
 *
 * Salida estándar:
 *   { bias: 'LONG'|'SHORT'|'NEUTRAL', strength: 0..1, reasons: [] }
 *
 * NOTA: Este es el esqueleto. La lógica fina se replica de indexbot_3.html
 * (ver `computeBias`/`computeContext` originales) en una iteración posterior.
 */

const { createLogger } = require('../../utils/logger');
const log = createLogger('biasEngine');

function _ema(values, period) {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
  }
  return ema;
}

function _structureBias(candles) {
  if (candles.length < 20) return { bias: 'NEUTRAL', strength: 0 };
  const recent = candles.slice(-20);
  const highs = recent.map((c) => c.high);
  const lows  = recent.map((c) => c.low);
  const hh = highs[highs.length - 1] > Math.max(...highs.slice(0, -1));
  const ll = lows[lows.length - 1]  < Math.min(...lows.slice(0, -1));
  if (hh && !ll) return { bias: 'LONG',  strength: 0.6 };
  if (ll && !hh) return { bias: 'SHORT', strength: 0.6 };
  return { bias: 'NEUTRAL', strength: 0.2 };
}

function _emaBias(candles) {
  const closes = candles.map((c) => c.close);
  const ema50  = _ema(closes, 50);
  const ema200 = _ema(closes, 200);
  if (ema50 == null || ema200 == null) return { bias: 'NEUTRAL', strength: 0 };
  if (ema50 > ema200) return { bias: 'LONG',  strength: 0.5 };
  if (ema50 < ema200) return { bias: 'SHORT', strength: 0.5 };
  return { bias: 'NEUTRAL', strength: 0.2 };
}

/**
 * Calcula bias para un timeframe concreto.
 */
function computeBias(candles) {
  if (!Array.isArray(candles) || candles.length < 10) {
    return { bias: 'NEUTRAL', strength: 0, reasons: ['Datos insuficientes'] };
  }
  const s = _structureBias(candles);
  const e = _emaBias(candles);
  const reasons = [];
  let score = 0;
  if (s.bias === 'LONG')  score += s.strength;
  if (s.bias === 'SHORT') score -= s.strength;
  if (e.bias === 'LONG')  score += e.strength;
  if (e.bias === 'SHORT') score -= e.strength;
  reasons.push(`Estructura: ${s.bias}`);
  reasons.push(`EMAs: ${e.bias}`);
  let bias = 'NEUTRAL';
  if (score >  0.3) bias = 'LONG';
  if (score < -0.3) bias = 'SHORT';
  return { bias, strength: Math.min(1, Math.abs(score)), reasons };
}

function evaluate({ symbol, candlesByTf }) {
  const h4  = candlesByTf['4h']  || [];
  const h1  = candlesByTf['1h']  || [];
  const m15 = candlesByTf['15m'] || [];
  const m5  = candlesByTf['5m']  || [];

  // HTF: prioriza H4, fallback H1.
  const htf = computeBias(h4.length >= 50 ? h4 : h1);
  // LTF táctico: prioriza M15, fallback M5.
  const ltf = computeBias(m15.length >= 50 ? m15 : m5);

  log.debug(`${symbol} bias HTF=${htf.bias} LTF=${ltf.bias}`);
  return {
    htfBias: htf.bias,
    tacticalBias: ltf.bias,
    htfStrength: htf.strength,
    tacticalStrength: ltf.strength,
    reasons: { htf: htf.reasons, ltf: ltf.reasons },
  };
}

module.exports = { evaluate, computeBias };
