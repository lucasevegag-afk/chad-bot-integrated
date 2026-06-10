/**
 * server/services/mt5Bridge.js
 *
 * Bridge: signalManager → MT5 Python executor (en PC del usuario).
 *
 * Cuando el bot detecta una señal de J3 sobre XAUUSD y estamos en horario válido,
 * envía POST al servidor Python local del usuario (vía ngrok).
 *
 * Env vars necesarias:
 *   MT5_BRIDGE_URL      → https://xxxx.ngrok-free.app
 *   MT5_BRIDGE_TOKEN    → api_token de config.json
 *   MT5_BRIDGE_ENABLED  → '1' para activar
 *
 * Configurables vía env:
 *   MT5_SYMBOL          → símbolo MT5 (default XAUUSD)
 *   MT5_LOT             → lot size (default 0.01)
 *   MT5_ALLOWED_HOURS   → horas UTC permitidas (default 11,12,13,14,16)
 *   MT5_ALLOWED_STRATS  → tipos de señal permitidos (default S1)
 *   MT5_ALLOWED_ASSETS  → activos permitidos (default XAUUSD)
 */

const { signalManager } = require('../bot/signalManager');
const { createLogger } = require('../utils/logger');

const log = createLogger('mt5-bridge');

const URL          = process.env.MT5_BRIDGE_URL || '';
const TOKEN        = process.env.MT5_BRIDGE_TOKEN || '';
const ENABLED      = process.env.MT5_BRIDGE_ENABLED === '1';

const SYMBOL       = process.env.MT5_SYMBOL || 'XAUUSDm';
const ALLOWED_HOURS = new Set((process.env.MT5_ALLOWED_HOURS || '11,12,13,14,16').split(',').map(Number));
const ALLOWED_STRATS = new Set((process.env.MT5_ALLOWED_STRATS || 'S1').split(','));
const ALLOWED_ASSETS = new Set((process.env.MT5_ALLOWED_ASSETS || 'XAUUSD').split(','));

// ⭐ Estrategias activas: cada signal abre una posición por entry de este array
// PA1 y PA3 tienen partial → se simulan como 2 posiciones split (legA cierra rápido, legB corre)
// Nota: BE-after-partial NO implementado todavía — cada leg corre con SL fijo.
// Lots: Exness XAUUSDm tiene volumen mínimo 0.01 (0.005 era rechazado con "invalid volume"),
// por eso cada leg usa el mínimo 0.01 — total 0.05 por señal.
const STRATEGIES = [
  // J3 · 1 posición, TP amplio
  { id: 'J3',    lot: 0.01, sl: 0.7, tp: 2.5, magic: 20250603 },
  // PA3 · 2 legs (partial 50% @ +1.0 ATR + runner @ +2.5 ATR)
  { id: 'PA3-A', lot: 0.01, sl: 0.7, tp: 1.0, magic: 20250604 },
  { id: 'PA3-B', lot: 0.01, sl: 0.7, tp: 2.5, magic: 20250605 },
  // PA1 · 2 legs (partial 50% @ +0.5 ATR + runner @ +2.5 ATR)
  { id: 'PA1-A', lot: 0.01, sl: 0.7, tp: 0.5, magic: 20250606 },
  { id: 'PA1-B', lot: 0.01, sl: 0.7, tp: 2.5, magic: 20250607 },
];

let _started = false;
let _executedCount = 0;
let _rejectedCount = 0;
let _failedCount = 0;

async function postToBridge(body) {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`${URL}/execute`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${TOKEN}`,
        'ngrok-skip-browser-warning': 'true',   // ⭐ skip ngrok warning si aplica
        'user-agent': 'chad-bot/1.0',
      },
      body: JSON.stringify(body),
    });
    const txt = await res.text();
    let data;
    try { data = JSON.parse(txt); } catch { data = { raw: txt }; }
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, error: e.message };
  } finally {
    clearTimeout(timeout);
  }
}

function start() {
  if (_started) return;
  _started = true;

  if (!ENABLED) {
    log.info('🔌 MT5 bridge DESHABILITADO (MT5_BRIDGE_ENABLED != 1)');
    return;
  }
  if (!URL || !TOKEN) {
    log.warn('⚠️ MT5_BRIDGE_URL o MT5_BRIDGE_TOKEN no configurados, bridge no se inicia');
    return;
  }

  log.info(`🟢 MT5 bridge activo`);
  log.info(`   URL: ${URL}`);
  log.info(`   Symbol: ${SYMBOL}`);
  log.info(`   Strategies activas (${STRATEGIES.length} legs/posiciones por señal):`);
  for (const s of STRATEGIES) {
    log.info(`     - ${s.id.padEnd(8)} lot ${s.lot} · SL×${s.sl} · TP×${s.tp} · magic ${s.magic}`);
  }
  log.info(`   Total lot por señal: ${STRATEGIES.reduce((acc, s) => acc + s.lot, 0).toFixed(3)}`);
  log.info(`   Allowed hours UTC: ${[...ALLOWED_HOURS].sort((a,b)=>a-b).join(',')}`);
  log.info(`   Allowed strategies: ${[...ALLOWED_STRATS].join(',')}`);
  log.info(`   Allowed assets: ${[...ALLOWED_ASSETS].join(',')}`);

  signalManager.on('signal_detected', async (sig) => {
    // Filtros
    const hour = new Date().getUTCHours();
    if (!ALLOWED_HOURS.has(hour)) {
      _rejectedCount++;
      log.debug(`⏭️ Skip ${sig.type} ${sig.asset}: hora ${hour} no permitida`);
      return;
    }
    if (!ALLOWED_STRATS.has(sig.type)) {
      _rejectedCount++;
      log.debug(`⏭️ Skip ${sig.type}: estrategia no permitida (allowed: ${[...ALLOWED_STRATS]})`);
      return;
    }
    if (!ALLOWED_ASSETS.has(sig.asset)) {
      _rejectedCount++;
      log.debug(`⏭️ Skip ${sig.asset}: activo no permitido (allowed: ${[...ALLOWED_ASSETS]})`);
      return;
    }

    // Obtener precio actual desde la última vela M5 (más robusto que botStateStore.price
    // que solo se llena con ticks Binance — XAU usa polling Twelve Data).
    const { timeframeStore } = require('../candles/timeframeStore');
    const m5 = timeframeStore.getCandles(sig.asset, '5m');

    if (!m5 || m5.length < 14) {
      log.warn(`⚠️ Sin velas M5 suficientes para ${sig.asset} (${m5?.length || 0}), skipping`);
      _failedCount++;
      return;
    }

    const lastCandle = m5[m5.length - 1];
    const price = lastCandle.close;

    if (!price || price <= 0) {
      log.warn(`⚠️ Precio inválido para ${sig.asset}: ${price}, skipping`);
      _failedCount++;
      return;
    }

    // ATR(14) de las últimas 14 velas M5 — cálculo real
    let trSum = 0;
    for (let i = m5.length - 14; i < m5.length; i++) {
      const c = m5[i];
      const p = m5[i - 1];
      if (!p) continue;
      const tr = Math.max(
        c.high - c.low,
        Math.abs(c.high - p.close),
        Math.abs(c.low - p.close)
      );
      trSum += tr;
    }
    const atr = trSum / 14;

    if (!atr || atr <= 0) {
      log.warn(`⚠️ ATR inválido para ${sig.asset}: ${atr}, skipping`);
      _failedCount++;
      return;
    }

    log.info(`🎯 Señal ${sig.type} ${sig.direction} ${sig.asset} @ ${price.toFixed(2)} · ATR ${atr.toFixed(2)}`);
    log.info(`   Fanout a ${STRATEGIES.length} estrategias en paralelo...`);

    // Fanout: iterar las estrategias activas, abrir 1 posición por cada una
    let successCount = 0;
    let failedCount = 0;
    const execResults = [];

    for (const strat of STRATEGIES) {
      const sl = sig.direction === 'long' ? price - strat.sl * atr : price + strat.sl * atr;
      const tp = sig.direction === 'long' ? price + strat.tp * atr : price - strat.tp * atr;

      const body = {
        symbol: SYMBOL,
        direction: sig.direction,
        lot: strat.lot,
        sl: Number(sl.toFixed(2)),
        tp: Number(tp.toFixed(2)),
        comment: `${strat.id}-${sig.direction}`.slice(0, 30),
        magic: strat.magic,
      };

      const result = await postToBridge(body);
      if (result.ok) {
        successCount++;
        log.info(`   ✅ ${strat.id.padEnd(8)} ticket ${result.data.ticket} · SL ${body.sl} TP ${body.tp}`);
        execResults.push({ stratId: strat.id, ok: true, ticket: result.data.ticket, sl: body.sl, tp: body.tp });
      } else {
        failedCount++;
        log.error(`   ❌ ${strat.id.padEnd(8)} FALLO: ${result.error || JSON.stringify(result.data)}`);
        execResults.push({ stratId: strat.id, ok: false, error: result.error || JSON.stringify(result.data) });
      }
    }

    _executedCount += successCount;
    _failedCount += failedCount;
    log.info(`📊 Fanout completo: ${successCount}/${STRATEGIES.length} ejecutados, ${failedCount} fallaron`);

    // Registrar en monitor para el dashboard
    try {
      const monitorService = require('./monitorService');
      monitorService.recordExecution(sig, execResults);
    } catch (e) { /* monitor optional */ }
  });

  log.info(`📊 Bridge listo. Esperando señales...`);
}

function getStats() {
  return {
    enabled: ENABLED,
    url: URL ? URL.replace(/\/\/.*@/, '//***@').slice(0, 60) : null,
    executed: _executedCount,
    rejected: _rejectedCount,
    failed: _failedCount,
  };
}

module.exports = { start, getStats };
