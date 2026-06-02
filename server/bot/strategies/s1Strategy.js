/**
 * server/bot/strategies/s1Strategy.js
 *
 * Estrategia S1 — Sweep & Reclaim con filtros HTF/session/lateralization.
 *
 * Patrón base: el precio barre liquidez (mecha rompiendo swing reciente) y
 * vuelve dentro del rango (reclaim). Operamos en dirección contraria al sweep.
 *
 * Filtros antes de emitir señal:
 *   1. Sesión operable (London, NY) — sessionFlowEngine
 *   2. Mercado NO lateralizado — lateralizationEngine
 *   3. Bias táctico alineado o neutral — biasEngine
 *
 * Boost de score:
 *   - Ventana NY con manipulación detectada — nyManipulationEngine
 *
 * Inputs:
 *   { symbol, candlesByTf, now? }   ← idéntico a los engines
 *
 * Output:
 *   null  (no hay señal)
 *   | { type: 'S1', direction, score, level, notes, context }
 *
 * El llamador típico (live scanner o backtest harness) decide qué hacer con
 * la señal: pushear a Supabase, abrir trade simulado, etc.
 */

const biasEngine     = require('../engines/biasEngine');
const sessionFlow    = require('../engines/sessionFlowEngine');
const nyManip        = require('../engines/nyManipulationEngine');
const sweepReclaim   = require('../engines/sweepReclaimEngine');
const lateralization = require('../engines/lateralizationEngine');

// Si hay una active.json del registry, usar esos valores como base.
// Las env vars siempre ganan (para overrides locales / backtests).
let _registryConfig = {};
try { _registryConfig = require('./registry').getActiveConfig() || {}; } catch (_) {}
function pick(key, fallback) {
  return process.env[key] !== undefined ? process.env[key] : (_registryConfig[key] !== undefined ? _registryConfig[key] : fallback);
}

/**
 * Evalúa la estrategia S1 sobre un snapshot multi-timeframe.
 *
 * @param {Object} input
 * @param {string} input.symbol
 * @param {Object<string, Array>} input.candlesByTf  – velas por TF ('1m','5m','15m','1h','4h')
 * @param {number} [input.now]                       – timestamp para session/NY (default Date.now())
 * @returns {Object|null}                             – señal o null
 */
// Sesiones perdedoras a excluir (configurable via env o config)
const BAD_SESSIONS = new Set((pick('S1_BAD_SESSIONS', '') || '').split(',').filter(Boolean));
const BAD_HOURS = new Set((pick('S1_BAD_HOURS', '') || '').split(',').filter(Boolean).map(Number));
const REQUIRE_MOMENTUM = pick('S1_REQUIRE_MOMENTUM', '0') === '1';
const MIN_ATR_PCT = Number(pick('S1_MIN_ATR_PCT', 0));
const BAD_DOWS = new Set((pick('S1_BAD_DOWS', '') || '').split(',').filter(Boolean).map(Number));
const MIN_SWEEP_ATR_PCT = Number(pick('S1_MIN_SWEEP_ATR', 0));
const KILLZONES_ONLY = new Set((pick('S1_KILLZONES', '') || '').split(',').filter(Boolean).map(Number));
const MAX_SWEEP_ATR_PCT = Number(pick('S1_MAX_SWEEP_ATR', 0));
const RECLAIM_BARS_OK = new Set((pick('S1_RECLAIM_BARS', '') || '').split(',').filter(Boolean).map(Number));

function evaluate({ symbol, candlesByTf, now = Date.now() }) {
  // Necesitamos mínimo 30 velas M5 para que valga la pena
  if ((candlesByTf['5m'] || []).length < 30) return null;

  const bias    = biasEngine.evaluate({ symbol, candlesByTf });
  const session = sessionFlow.evaluate({ symbol, now });
  const ny      = nyManip.evaluate({ symbol, candlesByTf, now });
  const sweep   = sweepReclaim.evaluate({ symbol, candlesByTf, timeframe: '5m' });
  const lat     = lateralization.evaluate({ symbol, candlesByTf, timeframe: '5m' });

  const context = { bias, session, ny, sweep, lat };

  // ──────── Filtros (sin pasar, no hay señal) ────────
  if (!session.tradeable)                   return null;
  if (lat.isLateralizing)                   return null;
  if (!sweep.sweepDetected || !sweep.reclaimed) return null;

  // ⭐ Filtros configurables vía env (para experimentación)
  if (BAD_SESSIONS.has(session.sessionState)) return null;

  if (BAD_HOURS.size > 0) {
    const hourUtc = new Date(now).getUTCHours();
    if (BAD_HOURS.has(hourUtc)) return null;
  }

  // ⭐ Filtro killzones: si está activo, SOLO opera en estas horas
  if (KILLZONES_ONLY.size > 0) {
    const hourUtc = new Date(now).getUTCHours();
    if (!KILLZONES_ONLY.has(hourUtc)) return null;
  }

  if (BAD_DOWS.size > 0) {
    const dow = new Date(now).getUTCDay();
    if (BAD_DOWS.has(dow)) return null;
  }

  // Max sweep depth: descarta sweeps demasiado exagerados (volatilidad caótica)
  if (MAX_SWEEP_ATR_PCT > 0 && sweep.level != null && sweep.sweepDepth != null) {
    const m5b = candlesByTf['5m'];
    let trSumb = 0;
    for (let i = m5b.length - 14; i < m5b.length; i++) {
      const c = m5b[i], p = m5b[i - 1];
      if (!p) continue;
      trSumb += Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
    }
    const atrB = trSumb / 14;
    const depthPct = (sweep.sweepDepth / atrB) * 100;
    if (depthPct > MAX_SWEEP_ATR_PCT) return null;
  }

  // Reclaim bars: si está set, solo permite ciertos tipos de reclaim
  if (RECLAIM_BARS_OK.size > 0) {
    if (sweep.reclaimBars == null || !RECLAIM_BARS_OK.has(sweep.reclaimBars)) return null;
  }

  if (MIN_SWEEP_ATR_PCT > 0 && sweep.level != null) {
    const m5 = candlesByTf['5m'];
    const last = m5[m5.length - 1];
    let trSum = 0;
    for (let i = m5.length - 14; i < m5.length; i++) {
      const c = m5[i], p = m5[i - 1];
      if (!p) continue;
      trSum += Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
    }
    const atr = trSum / 14;
    // Calcular penetración: cuánto rompió la mecha más allá del nivel
    let maxPenetration = 0;
    for (const c of m5.slice(-3)) {
      const pen = sweep.sweepSide === 'high'
        ? Math.max(0, c.high - sweep.level)
        : Math.max(0, sweep.level - c.low);
      if (pen > maxPenetration) maxPenetration = pen;
    }
    const penPct = (maxPenetration / atr) * 100;
    if (penPct < MIN_SWEEP_ATR_PCT) return null;
  }

  if (MIN_ATR_PCT > 0) {
    const m5 = candlesByTf['5m'];
    const last = m5[m5.length - 1];
    // ATR simple aprox usando últimas 14 velas
    let trSum = 0;
    for (let i = m5.length - 14; i < m5.length; i++) {
      const c = m5[i], p = m5[i - 1];
      if (!p) continue;
      trSum += Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
    }
    const atrPct = (trSum / 14) / last.close * 100;
    if (atrPct < MIN_ATR_PCT) return null;
  }

  // Dirección: sweep low (cazaron stops bajos) → reversal LONG. Inverso para high.
  const dir =
    sweep.sweepSide === 'low'  ? 'long'  :
    sweep.sweepSide === 'high' ? 'short' : null;

  if (!dir) return null;

  // ⭐ Momentum filter: vela de entrada confirma dirección
  if (REQUIRE_MOMENTUM) {
    const m5 = candlesByTf['5m'];
    const last = m5[m5.length - 1];
    const bullish = last.close > last.open;
    if (dir === 'long' && !bullish) return null;
    if (dir === 'short' && bullish) return null;
  }

  // Bias filter (estricto): HTF bias DEBE estar alineado con la dirección.
  // NEUTRAL ya no pasa — solo HTF claramente LONG/SHORT en la misma dirección.
  // El tactical bias también debe acompañar (no contra-tendencia).
  const dirUpper = dir.toUpperCase();
  if (bias.htfBias !== dirUpper) return null;
  if (bias.tacticalBias === 'NEUTRAL') return null;
  if (bias.tacticalBias !== dirUpper) return null;

  // Score combinado: sweepReclaim (max 50) + nyManipulation (max 70).
  const score = (sweep.score || 0) + (ny.score || 0);

  // Score mínimo 50 (sweep+reclaim completo). NY score es bonus, no filter
  // — verificado en backtest: el score >=65 no mejora win-rate, solo reduce
  // sample y empeora risk-adjusted.
  if (score < 50) return null;

  const level = score >= 80 ? 4 : score >= 65 ? 3 : 2;

  return {
    type: 'S1',
    direction: dir,
    timeframe: '5m',
    level,
    score,
    notes: `Sweep ${sweep.sweepSide} + reclaim · sesión ${session.sessionState}` +
           (ny.manipulationDetected ? ' · NY manip detectada' : ''),
    sweepLevel: sweep.level,
    context,
  };
}

module.exports = { evaluate };
