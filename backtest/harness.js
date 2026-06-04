/**
 * backtest/harness.js
 *
 * Walk-forward engine para la estrategia S1.
 *
 * Para cada vela M5 desde i=200 (warmup EMA200) hasta el final:
 *   1. Construye candlesByTf con últimas N velas en cada TF.
 *   2. Llama s1Strategy.evaluate(...)
 *   3. Si firma señal:
 *        - entry = close[i]
 *        - ATR(14) en M5 → SL = entry ∓ 1×ATR, TP = entry ± 2×ATR
 *        - forward-walk hasta hit: low<=SL (loss) o high>=TP (win)
 *        - timeout: 48h sin hit → flat (0R)
 *   4. Registra trade.
 *
 * Cooldown: el mismo dedup que signalManager (5min) para no contar setups
 * duplicados como trades distintos.
 */

const fs = require('fs');
const path = require('path');

const s1Strategy = require('../server/bot/strategies/s1Strategy');

const COOLDOWN_MS    = 5 * 60 * 1000;      // mismo que signalManager
const TIMEOUT_BARS_M5 = 48 * 60 / 5;       // 48h en velas M5 = 576
const ATR_PERIOD     = 14;
// Configurable vía env para experimentos rápidos
const ATR_SL_MULT    = Number(process.env.S1_SL_MULT || 1);
const ATR_TP_MULT    = Number(process.env.S1_TP_MULT || 2);
// ⭐ Spread real del broker (en unidades de precio del activo).
// Aplica 1× por round-trip (entrada + salida). Restará al TP, sumará al SL.
// Para XAU = USD por oz · BTC = USD · FX = unidad (ej 0.00007 para 0.7 pip EUR)
const SPREAD_COST = Number(process.env.S1_SPREAD || 0);
// ⭐ Partial profit taking: TP1 cierra fracción del trade, después SL → BE
const PARTIAL_TP_MULT  = Number(process.env.S1_PARTIAL_TP_MULT  || 0); // 0 = desactivado
const PARTIAL_FRACTION = Number(process.env.S1_PARTIAL_FRACTION || 0.5);
const BE_AFTER_PARTIAL = process.env.S1_BE_AFTER_PARTIAL !== '0'; // default ON cuando hay partial

// Cuántas velas pasarle a la estrategia en cada TF (suficiente para EMA200 + estructura)
const TF_LOOKBACK = {
  '5m':  300,
  '15m': 300,
  '1h':  300,
  '4h':  300,
};

// ─────────────────────────────────────────
// Lectura CSV → array de velas
// ─────────────────────────────────────────
function readCsv(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.trim().split('\n');
  const header = lines.shift(); // descartar header
  return lines.map((line) => {
    const [ts, o, h, l, c, v] = line.split(',');
    return {
      timestamp: Number(ts),
      open:  Number(o),
      high:  Number(h),
      low:   Number(l),
      close: Number(c),
      volume: Number(v) || 0,
    };
  });
}

// ─────────────────────────────────────────
// ATR para sizing de SL/TP
// ─────────────────────────────────────────
function atrAt(candles, i, period = ATR_PERIOD) {
  if (i < period) return null;
  let sum = 0;
  for (let j = i - period + 1; j <= i; j++) {
    const c = candles[j], p = candles[j - 1];
    if (!p) continue;
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - p.close),
      Math.abs(c.low  - p.close)
    );
    sum += tr;
  }
  return sum / period;
}

// ─────────────────────────────────────────
// Slice del estado multi-TF en el instante i de M5
// ─────────────────────────────────────────
function buildCandlesByTf({ m5, m15, h1, h4 }, m5Index) {
  const tsNow = m5[m5Index].timestamp;

  const slice = (arr, lookback) => {
    // Buscamos el último índice cuyo timestamp <= tsNow (no leakeamos el futuro)
    let hi = arr.length - 1;
    let lo = 0;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (arr[mid].timestamp <= tsNow) lo = mid;
      else hi = mid - 1;
    }
    const endIdx = lo;
    const start = Math.max(0, endIdx - lookback + 1);
    return arr.slice(start, endIdx + 1);
  };

  return {
    '5m':  slice(m5,  TF_LOOKBACK['5m']),
    '15m': slice(m15, TF_LOOKBACK['15m']),
    '1h':  slice(h1,  TF_LOOKBACK['1h']),
    '4h':  slice(h4,  TF_LOOKBACK['4h']),
  };
}

// ─────────────────────────────────────────
// Simulación de un trade: forward-walk hasta hit
// Soporta partial profit taking: TP1 cierra fracción + SL → BE.
// ─────────────────────────────────────────
function simulateTrade({ candles, entryIdx, direction, entry, sl, tp, tp1, partialFrac, beAfter }) {
  const maxIdx = Math.min(candles.length - 1, entryIdx + TIMEOUT_BARS_M5);
  const usePartial = tp1 != null;
  let partialTaken = false;
  let currentSl = sl;
  let partialExitPrice = null;

  for (let j = entryIdx + 1; j <= maxIdx; j++) {
    const c = candles[j];

    if (direction === 'long') {
      // SL primero (conservador) si la misma vela toca SL y TP
      if (c.low <= currentSl) {
        if (partialTaken) {
          // Half cerrado en TP1, la otra mitad cierra en BE/SL
          return {
            result: currentSl >= entry ? 'partial_be' : 'partial_loss',
            exitIdx: j, exitPrice: currentSl, exitTime: c.timestamp,
            partialExitPrice, partialTaken: true,
          };
        }
        return { result: 'loss', exitIdx: j, exitPrice: currentSl, exitTime: c.timestamp, partialTaken: false };
      }

      // Partial TP1
      if (usePartial && !partialTaken && c.high >= tp1) {
        partialTaken = true;
        partialExitPrice = tp1;
        if (beAfter) currentSl = entry; // mueve SL a BE
      }

      // TP2 (final)
      if (c.high >= tp) {
        return {
          result: 'win', exitIdx: j, exitPrice: tp, exitTime: c.timestamp,
          partialExitPrice, partialTaken,
        };
      }
    } else {
      // SHORT
      if (c.high >= currentSl) {
        if (partialTaken) {
          return {
            result: currentSl <= entry ? 'partial_be' : 'partial_loss',
            exitIdx: j, exitPrice: currentSl, exitTime: c.timestamp,
            partialExitPrice, partialTaken: true,
          };
        }
        return { result: 'loss', exitIdx: j, exitPrice: currentSl, exitTime: c.timestamp, partialTaken: false };
      }

      if (usePartial && !partialTaken && c.low <= tp1) {
        partialTaken = true;
        partialExitPrice = tp1;
        if (beAfter) currentSl = entry;
      }

      if (c.low <= tp) {
        return {
          result: 'win', exitIdx: j, exitPrice: tp, exitTime: c.timestamp,
          partialExitPrice, partialTaken,
        };
      }
    }
  }

  // Timeout
  const last = candles[maxIdx];
  return {
    result: partialTaken ? 'partial_flat' : 'flat',
    exitIdx: maxIdx, exitPrice: last.close, exitTime: last.timestamp,
    partialExitPrice, partialTaken,
  };
}

// ─────────────────────────────────────────
// Main backtest
// ─────────────────────────────────────────
function runBacktest({ symbol, m5, m15, h1, h4, onProgress }) {
  const trades = [];
  let lastSignalTs = 0;

  const warmupIdx = 200; // necesitamos lookback para EMA200 y estructura

  // Filtros de rango fecha (para walk-forward)
  const DATE_FROM = process.env.S1_DATE_FROM ? new Date(process.env.S1_DATE_FROM).getTime() : 0;
  const DATE_TO   = process.env.S1_DATE_TO   ? new Date(process.env.S1_DATE_TO).getTime()   : Infinity;

  for (let i = warmupIdx; i < m5.length; i++) {
    const ts = m5[i].timestamp;
    if (ts < DATE_FROM || ts > DATE_TO) continue;

    // Cooldown
    if (ts - lastSignalTs < COOLDOWN_MS) continue;

    const candlesByTf = buildCandlesByTf({ m5, m15, h1, h4 }, i);

    // Si algún TF está vacío en este punto, saltar (warmup en TFs altos)
    if (
      candlesByTf['5m'].length  < 30  ||
      candlesByTf['15m'].length < 50  ||
      candlesByTf['1h'].length  < 50  ||
      candlesByTf['4h'].length  < 30
    ) continue;

    const signal = s1Strategy.evaluate({
      symbol,
      candlesByTf,
      now: ts,
    });

    if (!signal) continue;

    const atr = atrAt(m5, i, ATR_PERIOD);
    if (!atr || atr <= 0) continue;

    const entry = m5[i].close;
    const sl = signal.direction === 'long'
      ? entry - ATR_SL_MULT * atr
      : entry + ATR_SL_MULT * atr;
    const tp = signal.direction === 'long'
      ? entry + ATR_TP_MULT * atr
      : entry - ATR_TP_MULT * atr;
    const tp1 = PARTIAL_TP_MULT > 0
      ? (signal.direction === 'long'
          ? entry + PARTIAL_TP_MULT * atr
          : entry - PARTIAL_TP_MULT * atr)
      : null;

    const sim = simulateTrade({
      candles: m5, entryIdx: i, direction: signal.direction,
      entry, sl, tp, tp1,
      partialFrac: PARTIAL_FRACTION,
      beAfter: BE_AFTER_PARTIAL,
    });

    // R-multiple normalizado: 1R = riesgo (distancia entry → SL).
    const riskPerTrade = ATR_SL_MULT * atr;
    let rMultiple;
    let resultLabel = sim.result;

    if (sim.partialTaken) {
      // Trade con partial profit-taking activado
      const partialDelta = signal.direction === 'long'
        ? sim.partialExitPrice - entry
        : entry - sim.partialExitPrice;
      const finalDelta = signal.direction === 'long'
        ? sim.exitPrice - entry
        : entry - sim.exitPrice;
      // Aplicar spread: cada exit cuesta el spread. Con partial son 2 exits.
      const partialDeltaAdj = partialDelta - SPREAD_COST;
      const finalDeltaAdj = finalDelta - SPREAD_COST;
      rMultiple = (PARTIAL_FRACTION * partialDeltaAdj + (1 - PARTIAL_FRACTION) * finalDeltaAdj) / riskPerTrade;

      if (rMultiple > 0.001) resultLabel = 'win';
      else if (rMultiple < -0.001) resultLabel = 'loss';
      else resultLabel = 'flat';
    } else {
      const priceDelta = signal.direction === 'long'
        ? sim.exitPrice - entry
        : entry - sim.exitPrice;
      // Aplicar spread: trade tiene 1 entrada + 1 salida = 1 round-trip
      rMultiple = (priceDelta - SPREAD_COST) / riskPerTrade;
    }

    const sweep = signal.context.sweep;
    trades.push({
      idx: i,
      entryTime: ts,
      entryPrice: entry,
      direction: signal.direction,
      atr,
      sl,
      tp,
      score: signal.score,
      level: signal.level,
      session: signal.context.session.sessionState,
      htfBias: signal.context.bias.htfBias,
      tacticalBias: signal.context.bias.tacticalBias,
      sweepSide: sweep.sweepSide,
      sweepDepth: sweep.sweepDepth || 0,
      sweepDepthAtrPct: atr > 0 ? ((sweep.sweepDepth || 0) / atr * 100) : 0,
      reclaimBars: sweep.reclaimBars != null ? sweep.reclaimBars : -1,
      stopSizePts: Math.abs(entry - sl),
      result: resultLabel,                       // ⭐ reclassified post-partial
      partialTaken: sim.partialTaken || false,   // ⭐ trade tomó TP1?
      exitTime: sim.exitTime,
      exitPrice: sim.exitPrice,
      barsHeld: sim.exitIdx - i,
      rMultiple,
    });

    lastSignalTs = ts;

    if (onProgress && trades.length % 20 === 0) {
      onProgress({ tradesSoFar: trades.length, progressPct: (i / m5.length) * 100 });
    }
  }

  return trades;
}

module.exports = { runBacktest, readCsv };
